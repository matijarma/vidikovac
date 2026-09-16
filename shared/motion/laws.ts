// The ordering law (R-TE7): trams on one directed track keep their order at
// every knot of their plans, a tram length apart. Physically true on a single
// track, and the one thing a viewer notices first when it is not. When fresh
// evidence contradicts the established order, the vehicle with the OLDER
// evidence gives way: a newer follower fix is a lower bound that pushes the
// stale leader's plan forward (on single track the stale leader is what is
// wrong), a newer leader fix holds the follower's plan back. A pair within a
// tram length is unordered. A vehicle without a new fix for more than two
// ticks constrains nobody (it can still be moved). A genuine swap (a tram
// short-turned or withdrawn into a siding) is conceded only after three
// consecutive contradicting fixes with the leader's last fix at a stop or at
// the end of its path, the only places a tram leaves a single track. Plans
// never run backwards: a hold or a push keeps every plan monotone.
// Buses are exempt: they overtake.

import type { GraphNetwork, Path } from './network';
import { evalPathPlan } from './plan';
import { lastFix, type PathKnot, type Track } from './track';

/** One ZET tram: a TMK 2200 is 32 m, a Crotram low-floor 35 m over buffers. */
export const HEADWAY_M = 35;
/** Two ticks of ZET's feed: a vehicle silent this long has stale evidence and constrains nobody. */
export const SILENT_AFTER_S = 20;
/** Contradicting fixes in a row before a swap is believed. */
export const CONCESSION_FIXES = 3;
/** How near a stop or the path end the leader must be for a swap to be physically possible. */
export const CONCESSION_NEAR_STOP_M = 40;

export interface OrderReport {
  pushes: number;
  holds: number;
  concessions: number;
}

interface Framed {
  track: Track;
  path: Path;
  knots: PathKnot[];
  fixSec: number;
}

/** The edge under arc s of a path, and the arc within that edge. */
function edgeAt(path: Path, s: number): { edge: number; arc: number } {
  let k = 0;
  while (k + 1 < path.edges.length && path.offsets[k + 1] <= s) k++;
  return { edge: path.edges[k], arc: s - path.offsets[k] };
}

/** Arc `s` of `from` expressed on `to`, or null when `to` does not run the
 *  edge `from` is on at that arc (the two have diverged). */
function mapArc(from: Path, s: number, to: Path): number | null {
  const { edge, arc } = edgeAt(from, s);
  const k = to.edges.indexOf(edge);
  if (k < 0) return null;
  return to.offsets[k] + arc;
}

function evalOn(f: Framed, tRel: number, target: Path): number | null {
  return mapArc(f.path, evalPathPlan(f.knots, tRel), target);
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

function nearStopOrEnd(net: GraphNetwork, f: Framed): boolean {
  const s = f.track.match.s;
  if (f.path.len - s <= CONCESSION_NEAR_STOP_M) return true;
  for (const entry of net.stopsOnPath(f.track.match.pathIdx!)) if (Math.abs(entry.s - s) <= CONCESSION_NEAR_STOP_M) return true;
  return false;
}

export function enforceOrder(tracks: Track[], net: GraphNetwork, nowSec: number, headerSec: number): OrderReport {
  const report: OrderReport = { pushes: 0, holds: 0, concessions: 0 };
  const framed: Framed[] = [];
  for (const track of tracks) {
    if (track.kind !== 'tram' || track.offGraph || !track.plan || track.plan.on !== 'path' || track.match.edge === null) continue;
    const fix = lastFix(track);
    if (!fix) continue;
    framed.push({ track, path: net.paths[track.plan.pathIdx], knots: track.plan.knots, fixSec: fix.atSec });
  }
  const byId = new Map(framed.map((f) => [f.track.id, f]));

  // Relations survive only while the follower's path still runs the leader's edge.
  for (const f of framed) {
    f.track.order.behind = f.track.order.behind.filter((id) => {
      const leader = byId.get(id);
      return leader !== undefined && f.path.edges.includes(leader.track.match.edge!);
    });
    for (const id of Object.keys(f.track.order.contradictions)) if (!f.track.order.behind.includes(id)) delete f.track.order.contradictions[id];
  }

  const tRelOf = (sec: number) => Math.round(sec - headerSec);

  for (let i = 0; i < framed.length; i++) {
    for (let j = i + 1; j < framed.length; j++) {
      const a = framed[i];
      const b = framed[j];
      // Same track: one's path runs the edge the other is on.
      const aOnB = b.path.edges.includes(a.track.match.edge!);
      const bOnA = a.path.edges.includes(b.track.match.edge!);
      if (!aOnB && !bOnA) continue;

      let leader: Framed;
      let follower: Framed;
      if (a.track.order.behind.includes(b.track.id)) {
        leader = b;
        follower = a;
      } else if (b.track.order.behind.includes(a.track.id)) {
        leader = a;
        follower = b;
      } else {
        // Establish from the two plans read at the header, in a's frame.
        const sa = evalPathPlan(a.knots, 0);
        const sb = evalOn(b, 0, a.path);
        if (sb === null || Math.abs(sa - sb) <= HEADWAY_M) continue;
        if (sa > sb) {
          leader = a;
          follower = b;
        } else {
          leader = b;
          follower = a;
        }
        follower.track.order.behind.push(leader.track.id);
        follower.track.order.contradictions[leader.track.id] = 0;
      }

      // Contradiction: the follower's own fix lies ahead of where the leader's plan puts the leader at that moment.
      const followerFixOnLeader = mapArc(follower.path, follower.track.match.s, leader.path);
      const leaderAtFollowerFix = evalPathPlan(leader.knots, tRelOf(follower.fixSec));
      const contradicts = followerFixOnLeader !== null && followerFixOnLeader > leaderAtFollowerFix;
      const count = (follower.track.order.contradictions[leader.track.id] ?? 0) + (contradicts ? 1 : 0);
      follower.track.order.contradictions[leader.track.id] = contradicts ? count : 0;
      if (contradicts && count >= CONCESSION_FIXES && nearStopOrEnd(net, leader)) {
        // A genuine swap: the leader was short-turned or set aside.
        follower.track.order.behind = follower.track.order.behind.filter((id) => id !== leader.track.id);
        delete follower.track.order.contradictions[leader.track.id];
        leader.track.order.behind.push(follower.track.id);
        leader.track.order.contradictions[follower.track.id] = 0;
        report.concessions++;
        [leader, follower] = [follower, leader];
      }

      const followerSilent = nowSec - follower.fixSec > SILENT_AFTER_S;
      const leaderSilent = nowSec - leader.fixSec > SILENT_AFTER_S;
      if (follower.fixSec > leader.fixSec) {
        // Newer follower evidence: push the leader ahead of it, unless the follower is itself silent.
        if (followerSilent) continue;
        withBreakpoints(leader.knots, follower.knots.map((k) => k[0]));
        let changed = false;
        for (const knot of leader.knots) {
          const required = evalOn(follower, knot[0], leader.path);
          if (required === null) continue;
          const floor = Math.min(required + HEADWAY_M, leader.path.len);
          if (knot[1] < floor) {
            knot[1] = floor;
            changed = true;
          }
        }
        if (changed) {
          monotone(leader.knots);
          report.pushes++;
        }
      } else {
        // Newer (or equal) leader evidence: hold the follower behind it, unless the leader is silent.
        if (leaderSilent) continue;
        withBreakpoints(follower.knots, leader.knots.map((k) => k[0]));
        let changed = false;
        for (const knot of follower.knots) {
          const ahead = evalOn(leader, knot[0], follower.path);
          if (ahead === null) continue;
          const ceiling = ahead - HEADWAY_M;
          if (knot[1] > ceiling) {
            knot[1] = Math.max(0, ceiling);
            changed = true;
          }
        }
        if (changed) {
          monotone(follower.knots);
          report.holds++;
        }
      }
    }
  }
  return report;
}
