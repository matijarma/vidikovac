// The ordering register and the geometry it is built on (R-TE7, E3): where a
// vehicle sits on the rail graph, how one vehicle's arc reads in another's
// frame, whether two vehicles are on the same rails at all -- and, in the
// second half of this file, who is established behind whom. Both halves of
// the engine ask the geometric questions: the register below, of the plans
// the twin is about to publish, and the client's integrator
// (app/src/motion/integrator.ts), of the marks it is about to draw. So they
// live in one DOM-free module (R-TE15) that depends on nothing but the
// decoded network's `Path` and the plan's own evaluator.
//
// A path is a sequence of directed edges plus the arc each of them starts at;
// an arc is a distance along that sequence. Two paths that run the same edge
// run the same rails there, and an arc on one reads on the other as the same
// distance into that shared edge. Where the paths diverge there is no mapping
// at all, and null is the honest answer: a constraint that cannot be
// expressed in the other's frame is not a constraint.

import type { GraphNetwork, Path } from './network';
import { evalPathPlan, SILENCE_HOLD_S } from './plan';
import { lastFix, resetOrder, type PathKnot, type Track } from './track';
import { VEHICLE_LENGTH_M } from './vehicle';

/** A vehicle placed on the graph: the path it runs, and its arc along it. */
export interface Placed {
  path: Path;
  /** Metres along `path`. */
  s: number;
}

/** The index within `path.edges` of the edge under arc `s`: the last edge
 *  that starts at or before it, by binary search over the offsets (they
 *  ascend). The integrator's neighbourhood index needs the index, not only
 *  the edge -- a pair of marks a tram length apart is on one edge or the
 *  next, and the next is a step in this sequence, not a search over the
 *  whole graph -- and it asks once per mark per frame, sixty times a second,
 *  over paths of dozens of edges. */
export function edgeIndexAt(path: Path, s: number): number {
  let lo = 0;
  let hi = path.edges.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (path.offsets[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The edge under arc s of a path, and the arc within that edge. */
export function edgeAt(path: Path, s: number): { edge: number; arc: number } {
  const k = edgeIndexAt(path, s);
  return { edge: path.edges[k], arc: s - path.offsets[k] };
}

/** Arc `s` of `from` expressed on `to`, or null when `to` does not run the
 *  edge `from` is on at that arc (the two have diverged). */
export function mapArc(from: Path, s: number, to: Path): number | null {
  const { edge, arc } = edgeAt(from, s);
  const k = to.edges.indexOf(edge);
  if (k < 0) return null;
  return to.offsets[k] + arc;
}

/** The pairing test the law and the integrator share: two vehicles are on the
 *  same rails when either one's current edge lies on the other's path. It is
 *  deliberately one-sided-or-the-other: a tram that has just turned off a
 *  shared trunk is still ordered against the one behind it on the trunk,
 *  because the trunk is on its own path even though its edge no longer is. */
export function onSharedRails(a: Placed, b: Placed): boolean {
  return b.path.edges.includes(edgeAt(a.path, a.s).edge) || a.path.edges.includes(edgeAt(b.path, b.s).edge);
}

/**
 * The stretch of rails the two have in common ahead of `a`: the run of edges
 * beginning at the edge `a`'s arc is on that `b`'s path also runs, in the
 * same order, following `a`'s path forward until the paths diverge. Null when
 * `b`'s path does not run `a`'s current edge at all -- then the two share no
 * rails where `a` stands, whatever they may share elsewhere.
 *
 * This is the shape of the key a relation is filed under (E3): keying it to
 * the leader's current edge instead drops the relation every time either of
 * them crosses one of the metre-long edges a noded junction leaves behind,
 * and a relation that has to be established afresh at every junction is no
 * relation at all.
 *
 * The register itself asks the cheaper question -- `onSharedRails`, which is
 * exactly "this stretch is non-empty one way round or the other" and costs
 * two array scans instead of a walk -- because nothing downstream reads WHICH
 * edges are shared, only whether any are. This function stays exported and
 * tested as the statement of what that test means, and for any caller that
 * one day does need the run itself.
 */
export function sharedStretch(a: Placed, b: Placed): { edges: number[] } | null {
  const edges: number[] = [];
  let after = -1;
  for (let k = edgeIndexAt(a.path, a.s); k < a.path.edges.length; k++) {
    const edge = a.path.edges[k];
    // From `after + 1`, so the run is one b also traverses in a's order: a
    // path that meets the same rails again later meets them going somewhere
    // else, and that is a different stretch.
    const j = b.path.edges.indexOf(edge, after + 1);
    if (j < 0) break;
    edges.push(edge);
    after = j;
  }
  return edges.length > 0 ? { edges } : null;
}

/** Arc `s` of `from` expressed on `to`, choosing the occurrence of the edge
 *  NEAREST `nearS` when `to` runs that edge more than once, and null when it
 *  does not run it at all.
 *
 *  `mapArc` takes the first occurrence, which is right for a path that runs
 *  an edge once and wrong for every circuit and balloon in ZET's network: a
 *  line 6 path runs its terminal loop's edges on the way out and again on the
 *  way back, and the first occurrence places a leader a whole circuit behind
 *  the follower asking about it -- a ceiling a kilometre back, which freezes
 *  the follower for as long as the relation lasts (the F9 review's finding).
 *  The caller always has a reference arc on `to` (its own position, or the
 *  arc it last read the other at), and the occurrence nearest that reference
 *  is the one on the stretch the two actually share.
 *
 *  `from` and `to` may be the same path, and then this is not the identity:
 *  it is "which lap is this arc on, read from where I am", which is the
 *  question a circuit makes worth asking and the one the identity would get
 *  wrong. A path that runs each edge once answers it with `s` either way.
 */
export function mapArcNear(from: Path, s: number, to: Path, nearS: number): number | null {
  const { edge, arc } = edgeAt(from, s);
  return arcOnPath(to, edge, arc, nearS);
}

/** The arc along `path` of a point `arc` metres into `edge`: the occurrence
 *  of that edge nearest `nearS`, or the first one when there is no reference
 *  to read it against. Null when the path does not run the edge. The matcher
 *  asks this of a raw edge hit (match.ts), mapArcNear of an arc on another
 *  path; both mean the same thing on a path that laps its own rails. */
export function arcOnPath(path: Path, edge: number, arc: number, nearS: number | null): number | null {
  let best: number | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (let k = path.edges.indexOf(edge); k >= 0; k = path.edges.indexOf(edge, k + 1)) {
    const candidate = path.offsets[k] + arc;
    if (nearS === null) return candidate;
    const gap = Math.abs(candidate - nearS);
    if (gap < bestGap) {
      best = candidate;
      bestGap = gap;
    }
  }
  return best;
}

// ---- the ordering register (R-TE7, E3) --------------------------------------
//
// Trams on one directed track keep their order, a tram length apart, and it
// is the first thing a viewer notices when they do not. Round F replaces the
// pairwise law that re-derived that order from two PLANS at every tick
// (the old shared/motion/laws.ts, diagnoses D5 to D7) with a register: who is
// behind whom is written down once, from EVIDENCE, and then it stands.
//
//   - Establishment uses fixes, never extrapolated plans: two fixes more
//     than ORDER_ESTABLISH_M apart along the stretch the two share, reading
//     the same way round on ORDER_WITNESSES consecutive fresh fixes -- or,
//     at once, ZET's own TripUpdates naming served stops in strict sequence
//     on that path, which is a statement about the trams and not about our
//     arithmetic. The two never overrule each other: a TripUpdate pair that
//     contradicts a fix witness holds the pair, it does not establish it.
//   - A relation is sticky. Bunching does not end it (that is exactly when
//     the order matters most and the evidence is weakest), and neither does
//     a junction's metre-long micro-edge: it is filed against the rails the
//     two share, not against the leader's current edge.
//   - It ends only three ways: the two leave each other's rails; the
//     follower's fix is further ahead than any swap could put it
//     (SWAP_LIMIT_M, a relation that has stopped meaning anything); or the
//     leader concedes, after CONCESSION_FIXES fresh follower fixes ahead of
//     it with the leader beside a served stop or at its path's end, the only
//     places a tram leaves a single track. A follower whose fix has left the
//     shared stretch AHEAD of its leader is decisive on the spot.
//   - Enforcement sweeps the register leader-first, once, and does not depend
//     on the order the tracks arrive in: a HOLD clamps a follower's knots to
//     one tram length behind its leader, never behind the follower's own
//     fix; a PUSH raises a stale leader's knots at times at or after the
//     follower's fix -- that fix is a lower bound on where the leader was
//     FROM THEN ON, not before, so the leader's anchor never moves (D6).
//     A push never lifts a SILENT leader (T8: no fix for SILENCE_HOLD_S)
//     past the arc its own plan holds at, its next stop: the follower's plan
//     is an extrapolation too, and T8 forbids extrapolating a silent tram
//     past its next stop by any route. The client's clamp keeps the order
//     on screen: the follower's mark waits a tram length behind.
//
// Buses are exempt: they overtake. Plans never run backwards: a hold or a
// push keeps every plan monotone.

/** One ZET tram plus buffers: the drawn length of a TMK 2200 (32 m) and
 *  3 m, which is a Crotram low-floor over its buffers. */
export const HEADWAY_M = VEHICLE_LENGTH_M.tram + 3;
/** Two ticks of ZET's feed: a vehicle silent this long has stale evidence and constrains nobody. */
export const SILENT_AFTER_S = 20;
/** Fixes this far apart along the shared stretch are an order, not scatter:
 *  ZET's GPS lands within about 30 m of the rail it is on, so 60 m is two
 *  scatters and cannot be manufactured by noise between two trams standing
 *  nose to tail. */
export const ORDER_ESTABLISH_M = 60;
/** Fresh fixes of a pair that must read the same way round before the
 *  relation is written: one reading is a reading, two in a row is evidence.
 *  Writing from a single reading is precisely the flapping the pairwise law
 *  produced every time two plans crossed (D5). */
export const ORDER_WITNESSES = 2;
/** Contradicting fresh follower fixes in a row before a swap is believed. */
export const CONCESSION_FIXES = 3;
/** How near a served stop or the path end the leader must be for a swap to
 *  be physically possible: nowhere else does a tram leave a single track. */
export const CONCESSION_NEAR_STOP_M = 40;
/** Two stop spacings: a follower whose fix leads its leader's by more than
 *  this is not overtaking on single track, it is in a relation that has
 *  stopped meaning anything (the leader began its next trip at a circuit's
 *  start, a fold flipped, a vehicle id changed hands), and the relation is
 *  dropped rather than enforced (R-TE52). On the live feed a follower six
 *  kilometres on was held at arc zero for minutes this way (16 Sept). */
export const SWAP_LIMIT_M = 300;
/** A pair's witness is dropped when neither of them has been seen near the
 *  other for this long: two witnesses have to be CONSECUTIVE fresh fixes, so
 *  an older one can no longer contribute to anything -- and a day's worth of
 *  every tram that ever passed every other would otherwise ride in the state
 *  row (persist.ts) for no purpose. */
export const WITNESS_TTL_S = 60;

/** What one pass of the register did, for the twin_order metric on /stats. */
export interface OrderReport {
  /** Relations standing after the pass. */
  relations: number;
  /** Relations written this pass (a re-point onto a nearer leader counts here). */
  established: number;
  /** Relations ended this pass other than by a swap. */
  dropped: number;
  holds: number;
  pushes: number;
  /** Swaps granted by the three-fix concession gate at a stop. */
  concessions: number;
  /** Swaps granted at once, the follower's fix having left the stretch ahead. */
  swaps: number;
}

/** The one TripUpdate field the register reads (worker/twin/state.ts's
 *  TripNext satisfies it): the stop ZET says the trip calls at next. Its
 *  `seq` is a sequence within ITS OWN trip and means nothing between two
 *  trips; what compares is where the two stops sit on the path both trams
 *  run, which is the served list's own order (E0). */
export interface OrderNextStop {
  stopId: string | null;
}

interface Framed {
  track: Track;
  path: Path;
  pathIdx: number;
  knots: PathKnot[];
  fixSec: number;
  /** The arc of the vehicle's own last fix: evidence, never the plan. */
  s: number;
  /** The highest arc a push may lift this vehicle's plan to: its own hold
   *  arc while it is silent (T8), else no bound beyond the path's end. */
  ceilingS: number;
}

function endRelation(track: Track): void {
  track.order.leader = null;
  track.order.since = 0;
  track.order.contradictions = 0;
  track.order.countedAt = 0;
}

function beginRelation(follower: Framed, leaderId: string): void {
  follower.track.order.leader = leaderId;
  follower.track.order.since = follower.fixSec;
  follower.track.order.contradictions = 0;
  follower.track.order.countedAt = follower.fixSec;
}

/** Both fixes read on one path: the candidate follower's frame, whichever of
 *  the two can express the other. Null when neither can -- the two share no
 *  rails where they stand, and a constraint that cannot be stated in one
 *  frame is not a constraint. */
function pairFrame(a: Framed, b: Framed): { path: Path; pathIdx: number; sa: number; sb: number } | null {
  const bOnA = mapArcNear(b.path, b.s, a.path, a.s);
  if (bOnA !== null) return { path: a.path, pathIdx: a.pathIdx, sa: a.s, sb: bOnA };
  const aOnB = mapArcNear(a.path, a.s, b.path, b.s);
  if (aOnB !== null) return { path: b.path, pathIdx: b.pathIdx, sa: aOnB, sb: b.s };
  return null;
}

/** ZET's own witness: the two trips' next stops, read in the order the path
 *  serves them. The tram whose next stop lies further along the path is the
 *  one ahead. Null unless both stops are on that path's served list and they
 *  are different stops. */
function tripWitness(
  net: GraphNetwork,
  frame: { pathIdx: number },
  a: Framed,
  b: Framed,
  updates: Readonly<Record<string, OrderNextStop>>,
): string | null {
  const stopA = a.track.tripId !== null ? updates[a.track.tripId]?.stopId ?? null : null;
  const stopB = b.track.tripId !== null ? updates[b.track.tripId]?.stopId ?? null : null;
  if (stopA === null || stopB === null || stopA === stopB) return null;
  const list = net.stopsOnPath(frame.pathIdx);
  const ia = list.findIndex((entry) => entry.stop.id === stopA);
  const ib = list.findIndex((entry) => entry.stop.id === stopB);
  if (ia < 0 || ib < 0 || ia === ib) return null;
  return ia > ib ? a.track.id : b.track.id;
}

function nearStopOrEnd(net: GraphNetwork, f: Framed): boolean {
  if (f.path.len - f.s <= CONCESSION_NEAR_STOP_M) return true;
  for (const entry of net.stopsOnPath(f.pathIdx)) if (Math.abs(entry.s - f.s) <= CONCESSION_NEAR_STOP_M) return true;
  return false;
}

/** Inserts knots at the given relative times (interpolating the arc), so two
 *  plans compared knot by knot are compared over the same breakpoints: the
 *  difference of two piecewise-linear functions with shared breakpoints has
 *  its extremes at those breakpoints, so a constraint met at every knot is
 *  met everywhere. */
function withBreakpoints(knots: PathKnot[], timesRel: readonly number[]): void {
  for (const t of timesRel) {
    if (t < knots[0][0] || t > knots[knots.length - 1][0]) continue;
    if (knots.some((k) => k[0] === t)) continue;
    const s = evalPathPlan(knots, t);
    const at = knots.findIndex((k) => k[0] > t);
    knots.splice(at, 0, [t, s]);
  }
}

function monotone(knots: PathKnot[]): void {
  for (let i = 1; i < knots.length; i++) if (knots[i][1] < knots[i - 1][1]) knots[i][1] = knots[i - 1][1];
}

/** Clamps the follower one tram length behind the leader's plan, never
 *  behind the follower's own fix: that fix is evidence (R-P2), and a
 *  contradiction it makes is counted, not overwritten. */
function hold(follower: Framed, leader: Framed): boolean {
  withBreakpoints(follower.knots, leader.knots.map((k) => k[0]));
  let changed = false;
  for (const knot of follower.knots) {
    const ahead = mapArcNear(leader.path, evalPathPlan(leader.knots, knot[0]), follower.path, follower.s);
    if (ahead === null) continue;
    const ceiling = Math.max(ahead - HEADWAY_M, follower.s);
    if (knot[1] > ceiling) {
      knot[1] = Math.max(0, ceiling);
      changed = true;
    }
  }
  if (changed) monotone(follower.knots);
  return changed;
}

/** Raises the stale leader to a tram length ahead of the follower, from the
 *  follower's fix time on and never at the anchor: the fix says where the
 *  leader must already have been AT THAT MOMENT, and says nothing at all
 *  about where it was a minute earlier (D6's teleport). Never above the
 *  leader's ceiling: a silent leader stays at its next stop (T8). */
function push(leader: Framed, follower: Framed, tFrom: number): boolean {
  withBreakpoints(leader.knots, [tFrom, ...follower.knots.map((k) => k[0]).filter((t) => t > tFrom)]);
  let changed = false;
  for (let i = 1; i < leader.knots.length; i++) {
    const knot = leader.knots[i];
    if (knot[0] < tFrom) continue;
    const behind = mapArcNear(follower.path, evalPathPlan(follower.knots, knot[0]), leader.path, leader.s);
    if (behind === null) continue;
    const floor = Math.min(behind + HEADWAY_M, leader.path.len, leader.ceilingS);
    if (knot[1] < floor) {
      knot[1] = floor;
      changed = true;
    }
  }
  if (changed) monotone(leader.knots);
  return changed;
}

/**
 * One pass of the register over every tram the twin follows: prune, read the
 * fresh fixes, write or end relations, then enforce what stands. Mutates the
 * tracks' plans and their `order` in place and reports what it did.
 */
export function enforceOrder(
  tracks: readonly Track[],
  net: GraphNetwork,
  nowSec: number,
  headerSec: number,
  updates: Readonly<Record<string, OrderNextStop>> = {},
): OrderReport {
  const report: OrderReport = { relations: 0, established: 0, dropped: 0, holds: 0, pushes: 0, concessions: 0, swaps: 0 };
  const framed: Framed[] = [];
  const known = new Set<string>();
  for (const track of tracks) {
    known.add(track.id);
    // A state row written before F10 carries the pairwise law's own shape; a
    // cold restore must not throw over it, it must start the register clean.
    if (!track.order || track.order.witnesses === undefined || track.order.leader === undefined) resetOrder(track);
    if (track.kind !== 'tram' || track.offGraph || !track.plan || track.plan.on !== 'path') continue;
    if (track.match.edge === null || track.match.pathIdx !== track.plan.pathIdx) continue;
    const fix = lastFix(track);
    if (!fix) continue;
    // buildPlan held a silent vehicle at its next stop (T8): the last knot of
    // its monotone plan is that hold, and the most any push may lift it to.
    const knots = track.plan.knots;
    const ceilingS = nowSec - fix.atSec > SILENCE_HOLD_S && knots.length > 0 ? knots[knots.length - 1][1] : Number.POSITIVE_INFINITY;
    framed.push({ track, path: net.paths[track.plan.pathIdx], pathIdx: track.plan.pathIdx, knots, fixSec: fix.atSec, s: track.match.s, ceilingS });
  }
  framed.sort((a, b) => a.track.id.localeCompare(b.track.id));
  const byId = new Map(framed.map((f) => [f.track.id, f] as const));

  // A leader the twin no longer follows at all takes its relation with it.
  for (const track of tracks) {
    if (track.order.leader !== null && !known.has(track.order.leader)) {
      endRelation(track);
      report.dropped++;
    }
    for (const [id, seen] of Object.entries(track.order.witnesses)) if (!known.has(id) || nowSec - seen.at > WITNESS_TTL_S) delete track.order.witnesses[id];
  }

  // The one geometric end: the two have left each other's rails. Read from
  // the pair's CURRENT arcs (onSharedRails either way round), so a junction's
  // micro-edge under one of them drops nothing (D7). A leader the twin still
  // follows but could not frame this tick keeps its relation waiting.
  for (const f of framed) {
    const leaderId = f.track.order.leader;
    if (leaderId === null) continue;
    const leader = byId.get(leaderId);
    if (!leader) continue;
    if (!onSharedRails({ path: f.path, s: f.s }, { path: leader.path, s: leader.s })) {
      endRelation(f.track);
      report.dropped++;
    }
  }

  for (let i = 0; i < framed.length; i++) {
    for (let j = i + 1; j < framed.length; j++) {
      const a = framed[i];
      const b = framed[j];
      if (!onSharedRails({ path: a.path, s: a.s }, { path: b.path, s: b.s })) continue;
      const frame = pairFrame(a, b);
      if (frame === null) continue;

      // The pair's witness, kept on the track whose id sorts first so one
      // pair is counted once whichever way round it is reached.
      const host = a.track.id < b.track.id ? a.track : b.track;
      const key = host === a.track ? b.track.id : a.track.id;
      const seen = host.order.witnesses[key];
      const evidenceSec = Math.max(a.fixSec, b.fixSec);
      if (seen === undefined || evidenceSec > seen.at) {
        const gap = frame.sa - frame.sb;
        const reads = Math.abs(gap) > ORDER_ESTABLISH_M ? (gap > 0 ? a.track.id : b.track.id) : null;
        host.order.witnesses[key] =
          reads === null ? { n: 0, at: evidenceSec, lead: '' } : { n: seen !== undefined && seen.lead === reads ? seen.n + 1 : 1, at: evidenceSec, lead: reads };
      }
      const witness = host.order.witnesses[key];

      const aLeads = b.track.order.leader === a.track.id;
      const bLeads = a.track.order.leader === b.track.id;
      if (aLeads || bLeads) {
        const leader = aLeads ? a : b;
        const follower = aLeads ? b : a;
        const leaderS = aLeads ? frame.sa : frame.sb;
        const followerS = aLeads ? frame.sb : frame.sa;
        const ahead = followerS - leaderS;
        if (ahead > SWAP_LIMIT_M) {
          endRelation(follower.track);
          report.dropped++;
          continue;
        }
        // Decisive: the follower's own edge is no longer on the leader's path
        // while it reads ahead of it. It has run out of the stretch in front
        // of its leader, which no ordering of these two rails allows.
        if (ahead > ORDER_ESTABLISH_M && mapArcNear(follower.path, follower.s, leader.path, leader.s) === null) {
          endRelation(follower.track);
          beginRelation(leader, follower.track.id);
          report.swaps++;
          continue;
        }
        // Contradictions count per FRESH follower fix, never per pass: a pass
        // is our clock, and three passes over one fix is one observation.
        if (follower.track.order.countedAt < follower.fixSec) {
          follower.track.order.countedAt = follower.fixSec;
          follower.track.order.contradictions = ahead > ORDER_ESTABLISH_M ? follower.track.order.contradictions + 1 : 0;
        }
        if (follower.track.order.contradictions >= CONCESSION_FIXES && nearStopOrEnd(net, leader)) {
          endRelation(follower.track);
          beginRelation(leader, follower.track.id);
          report.concessions++;
        }
        continue;
      }

      // ZET's own witness is believed only where the fixes do not say
      // otherwise. `next_stop` runs a stop ahead of a late tram -- the very
      // reason F11 gated the planner's ETA bound -- so a TripUpdate pair that
      // reads the opposite way round from two fixes more than
      // ORDER_ESTABLISH_M apart is not better evidence than the physics, it
      // is a contradiction, and a contradicted pair establishes nothing this
      // tick. (A witness of '' is the pair inside the establishing gap: it
      // reads nothing, so it contradicts nothing, and ZET still decides.)
      const trip = tripWitness(net, frame, a, b, updates);
      if (trip !== null && witness.lead !== '' && witness.lead !== trip) continue;
      const lead = trip ?? (witness.n >= ORDER_WITNESSES ? witness.lead : null);
      if (lead === null || lead === '') continue;
      const leader = lead === a.track.id ? a : b;
      const follower = lead === a.track.id ? b : a;
      const leaderS = lead === a.track.id ? frame.sa : frame.sb;
      const followerS = lead === a.track.id ? frame.sb : frame.sa;
      if (follower.track.order.leader === null) {
        beginRelation(follower, leader.track.id);
        report.established++;
        continue;
      }
      // The follower is already behind someone further up the queue and a
      // nearer tram has come between them: the relation is not reversed (that
      // takes a concession), it is re-filed against the tram immediately
      // ahead, which is the one whose headway actually binds.
      const standing = byId.get(follower.track.order.leader);
      if (!standing) continue;
      const standingS = mapArcNear(standing.path, standing.s, frame.path, followerS);
      if (standingS === null || leaderS >= standingS - ORDER_ESTABLISH_M) continue;
      beginRelation(follower, leader.track.id);
      report.established++;
    }
  }

  // The sweep. Leader-first over the register (every track has at most one
  // leader, so it is a forest once a cycle is broken), and the roots are
  // taken oldest fix first, then by id, so the pass does not depend on the
  // order the tracks were handed in.
  const sweep: Framed[] = [];
  const mark = new Map<string, number>();
  const visit = (f: Framed): void => {
    if ((mark.get(f.track.id) ?? 0) !== 0) return;
    mark.set(f.track.id, 1);
    const leaderId = f.track.order.leader;
    const leader = leaderId !== null ? byId.get(leaderId) : undefined;
    if (leader) {
      if ((mark.get(leader.track.id) ?? 0) === 1) {
        // A ring of relations: the one that closes it is the one just
        // reached, the youngest in the ring, and it is the one dropped.
        endRelation(f.track);
        report.dropped++;
      } else visit(leader);
    }
    mark.set(f.track.id, 2);
    sweep.push(f);
  };
  for (const f of [...framed].sort((x, y) => x.fixSec - y.fixSec || x.track.id.localeCompare(y.track.id))) visit(f);

  const tRelOf = (sec: number): number => Math.round(sec - headerSec);
  // Pushes first, deepest follower forward, so a chain of fresh fixes reaches
  // the front of the queue before anything is held behind anything.
  for (let k = sweep.length - 1; k >= 0; k--) {
    const f = sweep[k];
    const leaderId = f.track.order.leader;
    const leader = leaderId !== null ? byId.get(leaderId) : undefined;
    if (!leader || f.fixSec <= leader.fixSec) continue;
    if (nowSec - f.fixSec > SILENT_AFTER_S) continue; // the follower's own evidence is stale: it moves nobody
    if (push(leader, f, tRelOf(f.fixSec))) report.pushes++;
  }
  // Then the holds, leader-first, each follower reading a leader already settled.
  for (const f of sweep) {
    const leaderId = f.track.order.leader;
    const leader = leaderId !== null ? byId.get(leaderId) : undefined;
    if (!leader || f.fixSec > leader.fixSec) continue;
    if (nowSec - leader.fixSec > SILENT_AFTER_S) continue; // a silent leader constrains nobody
    if (hold(f, leader)) report.holds++;
  }

  for (const track of tracks) if (track.order.leader !== null) report.relations++;
  return report;
}
