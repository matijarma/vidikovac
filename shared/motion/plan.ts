// The planner: from the last matched fix, where the vehicle will be over
// the next minute and a half. A plan is a handful of knots the client
// integrator (B6) reads by linear interpolation, so the twin reasons once
// and every viewer draws the same tram. The rules, each an owner decision or
// a plan section:
//   - the anchor is the last matched fix, never a guess before it (R-P2);
//   - to the next stop at the TripUpdate's time when that time is plausible
//     against the kinematics, else at the vehicle's own speed blended with
//     the timetable's expectation for the stretch;
//   - a dwell at every stop (learned or scheduled, else a default);
//   - the stretches beyond on expected times;
//   - a path end is a terminus: the plan holds there, never runs off;
//   - silence (T8, replacing D2's "stale evidence keeps moving"): a vehicle
//     with no fix for more than SILENCE_HOLD_S is held at its next stop and
//     never planned past it, while its confidence falls linearly to nothing
//     at EVICT_S, when the twin and every client drop it;
//   - off every geometry, the free plane: a straight line from the previous
//     fix to the latest over their own interval, then a hold.

import type { DwellPlanner } from './dwell';
import { dist } from './geo';
import type { GraphNetwork } from './network';
import { DEAD_ZONE_M, STOP_ZONE_M } from './speed';
import type { DayType, TimesProvider } from './times';
import { lastFix, type FreeKnot, type NextStop, type PathKnot, type PlaneFix, type Track, type VehicleKind } from './track';

/** How far back a plan reaches: a client whose clock runs behind the twin's
 *  by a poll still finds a knot to stand on. */
export const PLAN_PAST_S = 20;
/** How far ahead: nine ticks; a client that misses several polls still has
 *  a plan to follow, and beyond ninety seconds the timetable is guessing. */
export const PLAN_AHEAD_S = 90;
/** Doors open, people off and on: 15 to 30 s at a ZET inner-city stop. */
export const DWELL_DEFAULT_S = 20;
/** A ZET tram's measured cruise between stops is 7 to 10 m/s (probe of 12
 *  Sept); the default when neither the vehicle nor the timetable says. */
export const DEFAULT_CRUISE_MS = 8;
/** An own-speed estimate under this is a vehicle still standing. */
export const MIN_OWN_SPEED_MS = 0.5;
/** A TripUpdate's arrival time is believed when it lies between half and
 *  twice the kinematic estimate: inside that band it is better evidence
 *  than a two-interval speed; outside it is a stale update or a bad clock. */
export const ETA_BAND = [0.5, 2] as const;
/** Own speed is evidence about now and holds for this long from the anchor
 *  before the stretch's usual speed takes over (R-TE46): on the live feed
 *  a cruising tram kept its speed over the next interval far more often
 *  than it fell to the timetable's average, which folds in every signal and
 *  platform of the stretch (planned 4.2 m/s against a realised 11.3 m/s at
 *  a 16 s look-ahead, recording of 16 Sept). */
export const OWN_SPEED_HOLD_S = 15;
/** A vehicle standing off any platform (a signal, a queue, a layover track)
 *  is expected to stand about as long again as it already has, between one
 *  tick and a signal cycle (R-TE47): on the live feed the plan drove off
 *  while the vehicle stood 59 % of the time. */
export const STAND_HOLD_MIN_S = 10;
export const STAND_HOLD_MAX_S = 40;
/** A stand at a platform already past its dwell ends a tick from now, not
 *  this instant (R-TE48): the error of "leaving now" repeated every tick
 *  grows with the look-ahead, the error of a tick's delay does not. */
export const STAND_EXTEND_S = 12;
/** A trip's scheduled first departure is believed up to this far ahead
 *  (R-TE49); beyond it the start date or the join is wrong. */
export const TRIP_START_MAX_AHEAD_S = 45 * 60;
/** How far a TripUpdate's implied departure may stray from the dwell window
 *  the history allows and still be believed: a tick's worth of latency
 *  between the fix and the update. */
export const ETA_SLACK_S = 10;
/** Silence (T8). Two thirds of vehicles refresh each 10 s tick, so 30 s
 *  without a fix is ordinary: up to here the plan is the plan and the
 *  confidence is whole. Past it the vehicle is silent: buildPlan holds it at
 *  its next stop, never past it, and silenceDecay fades it linearly to 0 at
 *  EVICT_S. */
export const SILENCE_HOLD_S = 30;
/** @deprecated Unused since T8 made the fade linear; still exported only
 *  because a local replay investigation imports it. */
export const SILENCE_HALFLIFE_S = 60;
/** The silence after which a vehicle leaves the twin (worker/twin/state.ts
 *  TRACK_STALE_S) and every client's map (integrator.ts), in seconds.
 *
 *  180 s rather than the ~120 s T8 first proposed (brief §17 Q2, owner
 *  ruling of 22 Sep), because of what ZET's trams do when they fall silent.
 *  Monday 21 Sep, same trip across the gap: 3,505 silences of 120 to 180 s,
 *  91 % of them standing within 50 m and 90 % within 150 m of a terminal,
 *  against 72 of 180 to 300 s and 29 over 300 s. A drop at 120 s would
 *  blink about 3,200 standing terminus trams a day off the map and back at
 *  their next fix. */
export const EVICT_S = 180;
/** Confidence with movement evidence on geometry, with a single fix on
 *  geometry, and the cap off every geometry (nothing verifies a free fit). */
export const CONFIDENCE_ON_GEOMETRY = 0.9;
export const CONFIDENCE_SINGLE_FIX = 0.6;
export const CONFIDENCE_FREE_CAP = 0.5;

/** The side of a learned stretch's distribution the planner books (F11).
 *  A median stretch time puts half of every plan ahead of its tram by
 *  construction, and the round's rule is "bias behind, never ahead".
 *
 *  0.9 rather than something gentler because the replay of 17 Sept says so.
 *  Swept over the like-for-like window (2216 frames) against 0.7 dwells:
 *  0.65 gave 17.6 % of 30 s fixes ahead, 0.8 gave 16.5 %, 0.9 gave 15.6 %,
 *  and the cost of the whole sweep was 0.8 percentage points of "within
 *  50 m" at the 10 s horizon -- the horizon a viewer actually lives at,
 *  since the client polls every few seconds. Over the same sweep the
 *  between-plan regressions fell 24.608 -> 19.827 (-19 %), the visible
 *  crossings 6.108 -> 5.868 and the client's holds 20.281 -> 14.156 (-30 %),
 *  because a plan that is honestly late is one the next fix does not have to
 *  drag backwards. Higher was not tried: a quantile beyond the slowest tenth
 *  stops describing a stretch and starts describing its worst morning. */
export const PLAN_QUANTILE = 0.9;

/** How far two fixes may lie apart ALONG THE ARC and still be the same
 *  standing tram (F11). ZET's GPS scatters up to 30 m at a platform, so the
 *  15 m dead zone read a standing tram as moving and the planner then drove
 *  its plan off at the cruise measured before the stop (D8). At the feed's
 *  10 s tick 30 m is 3 m/s, which is a tram at rest in traffic either way. */
export const STAND_SCATTER_M = 30;

/** How far behind the plan published a tick ago an anchor may lie and still
 *  be read as noise rather than a reversal (F11). The client holds a mark
 *  rather than drawing it backwards, so a plan starting a few metres behind
 *  the published one buys nothing: the viewer sees a stopped tram either
 *  way, and the twin has thrown away an arc it already stood behind. Beyond
 *  this the disagreement is real and the honest plan goes out. */
export const ANCHOR_NOISE_M = 25;

/** What the planner had to intervene about this tick, counted for
 *  `twin_plan` on /stats: the published floor under a noisy anchor, a
 *  junction wait booked, a stand the D8 fix kept at its platform, and an
 *  ETA bound the planner refused to believe. */
export const PLAN_EVENTS = ['floor', 'junction_wait', 'stand_fix', 'eta_bound_skipped'] as const;
export type PlanEvent = (typeof PLAN_EVENTS)[number];
export type PlanCounts = Record<PlanEvent, number>;

export function emptyPlanCounts(): PlanCounts {
  return { floor: 0, junction_wait: 0, stand_fix: 0, eta_bound_skipped: 0 };
}

/** The same counters kept apart by vehicle kind. A tram and a bus meet
 *  different rules -- a bus may overtake and reverse, and its plan runs a
 *  shape rather than a path, so it books no junction wait at all -- and a
 *  single total would hide which of the two an intervention was about. */
export type PlanCountsByKind = Record<VehicleKind, PlanCounts>;

export function emptyPlanCountsByKind(): PlanCountsByKind {
  return { tram: emptyPlanCounts(), bus: emptyPlanCounts() };
}

export interface NextStopUpdate {
  stopId: string;
  timeSec: number | null;
  delaySec: number | null;
  /** When ZET issued the update (the frame header it came in), or null for
   *  a caller that does not know. The "departed by the header" bound needs
   *  it to tell a current update from one about a platform the tram is
   *  still standing at (F11). */
  atSec?: number | null;
}

/** The junction waits to book ahead on a path, already bound to an hour band
 *  and day type (shared/motion/junction.ts). */
export interface JunctionWaits {
  aheadOf(pathIdx: number, s: number): { s: number; waitSec: number }[];
}

/** Everything F11 added to the planner's inputs. Every field is optional and
 *  every default is the behaviour before F11, so a caller that only wants a
 *  plan (a test, the schematic's preview) still gets one. */
export interface PlanContext {
  /** The per-stop dwell table, bound to this instant and band. Without it
   *  the planner falls back to the TimesProvider and DWELL_DEFAULT_S. */
  dwell?: DwellPlanner;
  junctions?: JunctionWaits;
  /** The arc the previously published plan puts this vehicle at, at THIS
   *  header, or null when there is none on the same geometry. */
  publishedArcS?: number | null;
  counts?: PlanCounts;
}

export interface Bands {
  hourBand: number;
  dayType: DayType;
}

/** The share of its confidence a vehicle keeps after `silenceSec` without a
 *  fix (T8): whole up to SILENCE_HOLD_S, then falling linearly to 0 at
 *  EVICT_S, so a fading mark is gone exactly when it is dropped. */
export function silenceDecay(silenceSec: number): number {
  if (silenceSec <= SILENCE_HOLD_S) return 1;
  if (silenceSec >= EVICT_S) return 0;
  return 1 - (silenceSec - SILENCE_HOLD_S) / (EVICT_S - SILENCE_HOLD_S);
}

/** Linear interpolation between knots; held flat before the first and after the last. */
export function evalPathPlan(knots: readonly PathKnot[], tRel: number): number {
  if (knots.length === 0) return 0;
  if (tRel <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [t0, s0] = knots[i - 1];
    const [t1, s1] = knots[i];
    if (tRel <= t1) {
      if (t1 === t0) return s1;
      return s0 + ((tRel - t0) / (t1 - t0)) * (s1 - s0);
    }
  }
  return knots[knots.length - 1][1];
}

export function evalFreePlan(knots: readonly FreeKnot[], tRel: number): [lon: number, lat: number] {
  if (knots.length === 0) return [0, 0];
  if (tRel <= knots[0][0]) return [knots[0][1], knots[0][2]];
  for (let i = 1; i < knots.length; i++) {
    const [t0, lon0, lat0] = knots[i - 1];
    const [t1, lon1, lat1] = knots[i];
    if (tRel <= t1) {
      if (t1 === t0) return [lon1, lat1];
      const f = (tRel - t0) / (t1 - t0);
      return [lon0 + f * (lon1 - lon0), lat0 + f * (lat1 - lat0)];
    }
  }
  const last = knots[knots.length - 1];
  return [last[1], last[2]];
}

/** Where a plan stands still on its way: a platform (with its dwell) or a
 *  junction node (with its wait). The loop treats both the same way -- run
 *  to the arc, hold, run on -- and only a platform becomes `track.next`. */
interface Halt {
  /** The platform's id, or null for a junction wait. */
  stopId: string | null;
  s: number;
  holdSec: number;
}

interface ArcGeometry {
  len: number;
  /** Stops strictly ahead of arc s, nearest first. */
  stopsAhead(s: number): { stopId: string; s: number }[];
  /** The stop whose zone the arc lies in, if any. */
  stopAt(s: number): { stopId: string; s: number } | null;
  /** The key the TimesProvider knows this geometry by, or null (a bus shape). */
  timesPath: number | null;
}

function pathGeometryOf(net: GraphNetwork, pathIdx: number): ArcGeometry {
  const stops = net.stopsOnPath(pathIdx);
  return {
    len: net.paths[pathIdx].len,
    stopsAhead: (s) => stops.filter((entry) => entry.s > s + 0.5).map((entry) => ({ stopId: entry.stop.id, s: entry.s })),
    stopAt: (s) => {
      let best: { stopId: string; s: number } | null = null;
      for (const entry of stops) if (Math.abs(entry.s - s) <= STOP_ZONE_M && (!best || Math.abs(entry.s - s) < Math.abs(best.s - s))) best = { stopId: entry.stop.id, s: entry.s };
      return best;
    },
    timesPath: pathIdx,
  };
}

function shapeGeometryOf(net: GraphNetwork, shapeIdx: number): ArcGeometry {
  const shape = net.shapes[shapeIdx];
  return {
    len: shape.len,
    stopsAhead: (s) => {
      const out: { stopId: string; s: number }[] = [];
      let cursor = s + 0.5;
      for (;;) {
        const next = net.nextStop(shapeIdx, cursor);
        if (!next) break;
        out.push({ stopId: next.stop.id, s: next.s });
        cursor = next.s;
      }
      return out;
    },
    stopAt: (s) => {
      const before = net.nextStop(shapeIdx, s - STOP_ZONE_M - 0.5);
      return before && Math.abs(before.s - s) <= STOP_ZONE_M ? { stopId: before.stop.id, s: before.s } : null;
    },
    timesPath: null,
  };
}

/** How far two fixes lie apart along the geometry they were both placed on,
 *  or across the plane when they were not. */
function separation(a: PlaneFix, b: PlaneFix): number {
  if (a.arc && b.arc && a.arc.key === b.arc.key) return Math.abs(b.arc.s - a.arc.s);
  return dist(a, b);
}

/**
 * How much of a dwell remains at the platform the anchor fix lies at. The
 * fix alone says nothing about how long the tram has stood; the history
 * does: the stationary run of fixes in the stop's zone says when it began,
 * and the fix before that run says when the tram must have arrived at its
 * speed.
 *
 * D8, fixed in F11: an anchor INSIDE a stop zone is a stand. Departure is
 * proven only by a LATER FIX: either one beyond the zone by more than the
 * dead zone -- which the anchor, being inside the zone, never is -- or the
 * anchor itself, past the stop point and reached by real movement over the
 * last interval. Before this, ANY fix past the stop point by more than the
 * dead zone with no stationary run behind it got no dwell at all, so the
 * FIRST time the twin saw a tram at a platform it drove the plan off at the
 * cruise measured before that platform: a mark ahead of a standing tram,
 * the one error the round forbids. One fix proves nothing either way, and
 * the round's rule is to be late rather than early.
 */
function dwellRemaining(track: Track, stop: { stopId: string; s: number }, dwellSec: number, speed: number, counts?: PlanCounts): number | null {
  const fixes = track.fixes;
  const last = fixes[fixes.length - 1];
  const key = last.arc?.key;
  if (!key) return dwellSec;
  let i = fixes.length - 1;
  while (i > 0 && fixes[i - 1].arc?.key === key && Math.abs(fixes[i - 1].arc!.s - stop.s) <= STOP_ZONE_M) i--;
  const run = fixes.slice(i);
  const pastThePoint = track.match.s > stop.s + DEAD_ZONE_M;
  if (pastThePoint) {
    // Moving NOW, judged at the same scatter `standing` is judged at: a tram
    // that covered more than a GPS scatter over its LAST interval and lies
    // past the stop point has left, whatever it did before that. The guard
    // is on `fixes`, which is what the interval is read from -- `run` counts
    // only the fixes inside this stop's zone, so guarding on it read a tram
    // cruising through the zone from 80 m before it as a stand, purely
    // because only one of its reports landed in the zone (F11 review).
    const movingNow = fixes.length >= 2 && separation(fixes[fixes.length - 2], last) >= STAND_SCATTER_M;
    if (movingNow) return null;
    if (counts) counts.stand_fix++;
  }
  let arrivalSec = run[0].atSec;
  const before = i > 0 ? fixes[i - 1] : null;
  if (before?.arc && before.arc.key === key && before.arc.s < stop.s - STOP_ZONE_M) {
    const estimate = before.atSec + (stop.s - before.arc.s) / speed;
    arrivalSec = Math.min(run[0].atSec, Math.max(before.atSec, estimate));
  }
  return Math.max(0, dwellSec - (last.atSec - arrivalSec));
}

/** The report time of the newest fix a vehicle reached by MOVING: the
 *  anchor when the last interval covered more than the dead zone, else null.
 *  A TripUpdate that post-dates one is evidence about a tram in motion; one
 *  that merely post-dates a standing tram's last report is not (F11). */
function movingAnchorSec(track: Track): number | null {
  const n = track.fixes.length;
  if (n < 2) return null;
  const last = track.fixes[n - 1];
  return separation(track.fixes[n - 2], last) >= DEAD_ZONE_M ? last.atSec : null;
}

/** Sets track.plan, track.next and track.confidence for the frame at headerSec, seen at nowSec. */
export function buildPlan(
  track: Track,
  net: GraphNetwork,
  times: TimesProvider,
  next: NextStopUpdate | null,
  nowSec: number,
  headerSec: number,
  bands: Bands,
  context: PlanContext = {},
): void {
  const last = lastFix(track);
  if (!last) {
    track.plan = null;
    track.next = null;
    track.confidence = 0;
    return;
  }
  const silenceSec = nowSec - last.atSec;
  const decay = silenceDecay(silenceSec);
  // T8: past SILENCE_HOLD_S the evidence is too old to move on. The plan
  // still reaches the next stop, and holds there to the horizon.
  const silent = silenceSec > SILENCE_HOLD_S;
  const rel = (tSec: number): number => Math.round(tSec - headerSec);
  const horizonEnd = nowSec + PLAN_AHEAD_S;

  const geometry: ArcGeometry | null =
    track.match.pathIdx !== null ? pathGeometryOf(net, track.match.pathIdx) : track.match.shapeIdx !== null ? shapeGeometryOf(net, track.match.shapeIdx) : null;

  if (!geometry) {
    // The free plane: previous fix to latest over their interval, then hold.
    const prev = track.fixes.length >= 2 ? track.fixes[track.fixes.length - 2] : null;
    const knots: FreeKnot[] = [];
    if (prev) knots.push([rel(prev.atSec), prev.lon, prev.lat]);
    knots.push([rel(last.atSec), last.lon, last.lat]);
    knots.push([rel(horizonEnd), last.lon, last.lat]);
    track.plan = { on: 'free', knots };
    track.next = null;
    track.confidence = Math.min(CONFIDENCE_FREE_CAP, CONFIDENCE_FREE_CAP * decay);
    return;
  }

  const counts = context.counts;
  const ownSpeed = track.speed >= MIN_OWN_SPEED_MS ? track.speed : null;
  const knots: PathKnot[] = [];
  let t = last.atSec;
  let s = track.match.s;
  // The published floor (F11): an anchor a few metres behind the arc the
  // last published plan puts this vehicle at right now is GPS scatter, not a
  // tram that reversed, and the client would hold the mark rather than draw
  // it backwards. Starting from the published arc keeps the mark moving;
  // beyond ANCHOR_NOISE_M the disagreement is real and the honest plan goes.
  const floorS = context.publishedArcS ?? null;
  if (floorS !== null && Number.isFinite(floorS) && s < floorS && floorS - s < ANCHOR_NOISE_M) {
    s = floorS;
    if (counts) counts.floor++;
  }
  knots.push([rel(t), round1(s)]);
  let nextStop: NextStop | null = null;
  const first = true;
  // The stand the history shows: how long the fixes have sat within the GPS
  // SCATTER of the latest one, along the arc where both were placed on the
  // same geometry (F11). A standing vehicle's speed estimate is its last
  // cruise, stale evidence about now.
  let stoodSec = 0;
  for (let i = track.fixes.length - 2; i >= 0 && separation(track.fixes[i], last) < STAND_SCATTER_M; i--) stoodSec = last.atSec - track.fixes[i].atSec;
  const standing = stoodSec > 0;

  // The dwell every stop of this plan is booked at: the table's answer where
  // the caller handed one in (the twin always does), the TimesProvider's
  // otherwise, and the flat default failing both (F11).
  const dwellOf = (stopId: string): number => context.dwell?.plannedSec(stopId) ?? times.dwellSeconds(stopId, bands.hourBand, bands.dayType) ?? DWELL_DEFAULT_S;
  // Stretches are booked at PLAN_QUANTILE of what they are measured to take,
  // not at the median (F11): the round's rule is to be late rather than early.
  const segmentTime = (fromS: number, toS: number): number => {
    const scheduled = geometry.timesPath !== null ? times.segmentSeconds(geometry.timesPath, fromS, toS, bands.hourBand, bands.dayType, PLAN_QUANTILE) : null;
    return scheduled !== null && scheduled > 0 ? scheduled : (toS - fromS) / (ownSpeed ?? DEFAULT_CRUISE_MS);
  };
  /** Every place the plan stands still after arc `from`, in arc order: the
   *  platforms the line calls at, and the junctions its trams wait at. */
  const haltsAfter = (from: number): Halt[] => {
    const halts: Halt[] = geometry.stopsAhead(from).map((stop) => ({ stopId: stop.stopId, s: stop.s, holdSec: dwellOf(stop.stopId) }));
    if (context.junctions && geometry.timesPath !== null) {
      for (const wait of context.junctions.aheadOf(geometry.timesPath, from)) {
        if (wait.waitSec > 0) halts.push({ stopId: null, s: wait.s, holdSec: wait.waitSec });
      }
    }
    halts.sort((a, b) => a.s - b.s);
    return halts;
  };
  /** The speed a vehicle short of a platform's point is taken to reach it at. */
  const approachSpeedTo = (stopS: number): number =>
    ownSpeed ?? (Math.min(stopS, 300) > 0 ? Math.min(stopS, 300) / segmentTime(Math.max(0, stopS - 300), stopS) : DEFAULT_CRUISE_MS);

  // At a platform: when the tram moves on decides everything after. The
  // history says how long it has stood (dwellRemaining); ZET's ETA for the
  // stop beyond says when it must leave to make it; and a TripUpdate that
  // already names the stop beyond says it has left by the header at the
  // latest (the update is current, the fix may be 30 s old).
  const here = geometry.stopAt(s);
  // T8's platform is read off the evidence: the zone the observed fix lies
  // in, before the published floor raised the anchor (a fix 30 m past a stop
  // point, floored 20 m further, is still a tram at that stop, not one on its
  // way to the next). Failing that, the zone the floored anchor lies in,
  // which can only be a stop ahead of the fix.
  const silentHere = silent ? geometry.stopAt(track.match.s) ?? here : null;
  if (silentHere) {
    // T8 at a platform: a silent vehicle stays at the stop it was last seen
    // at, whatever the dwell history says. This comes before dwellRemaining,
    // which may know nothing of the stand (null) and would otherwise hand
    // the tram to the run below, past the very platform it stands at. Up to
    // the stop point when the anchor fell short of it; never back to it from
    // beyond, since no plan runs backwards.
    if (s < silentHere.s) {
      const arrive = t + (silentHere.s - s) / approachSpeedTo(silentHere.s);
      knots.push([rel(arrive), round1(silentHere.s)]);
      t = arrive;
      s = silentHere.s;
    }
    nextStop = { stopId: silentHere.stopId, s: round1(silentHere.s), etaSec: Math.round(t) };
    knots.push([rel(Math.max(horizonEnd, t)), round1(s)]);
    t = horizonEnd;
  } else if (here) {
    const aheadOfHere = geometry.stopsAhead(here.s);
    const haltsBeyond = haltsAfter(here.s);
    /** Seconds from leaving this platform to arriving at arc toS, every dwell and junction wait on the way included. */
    const travelTo = (toS: number): number => {
      let total = 0;
      let from = here.s;
      for (const halt of haltsBeyond) {
        if (halt.s >= toS - 0.5) break;
        total += segmentTime(from, halt.s) + halt.holdSec;
        from = halt.s;
      }
      return total + segmentTime(from, toS);
    };
    const dwellHere = dwellOf(here.stopId);
    const beyond = next && next.stopId !== here.stopId ? aheadOfHere.find((ahead) => ahead.stopId === next.stopId) ?? null : null;
    const approachSpeed = approachSpeedTo(here.s);
    const remaining = dwellRemaining(track, here, dwellHere, approachSpeed, counts);
    if (remaining !== null) {
      // The dwell that is left; a stand already past it ends a tick from now (R-TE48).
      let departure = t + (remaining > 0 ? remaining : STAND_EXTEND_S);
      if (beyond && next?.timeSec !== null && next?.timeSec !== undefined) {
        // ZET's arrival time at the stop beyond, less the travel to it (with
        // the dwells at every platform in between), is when the tram leaves here.
        const implied = next.timeSec - travelTo(beyond.s);
        if (implied >= t - ETA_SLACK_S && implied <= t + dwellHere + ETA_SLACK_S) departure = Math.max(t, implied);
      }
      if (beyond) {
        // The update is current while the fix may be old: the tram has at least
        // left the last platform before the one ZET names, so by the header it
        // had departed here that long ago.
        //
        // F11 gates it. Applied to any update this bound drove a LATE tram
        // off its platform on ZET's word alone (D8): ZET names the next stop
        // for a tram that has not left yet all day long. It is evidence only
        // when the named stop is at least two ahead -- something was passed
        // in between, so the tram cannot still be here -- or when the update
        // post-dates a fix that showed the tram MOVING.
        const between = aheadOfHere.filter((stop) => stop.s < beyond.s - 0.5);
        const movingSec = movingAnchorSec(track);
        const updateAtSec = next?.atSec ?? null;
        const postDatesMotion = updateAtSec !== null && movingSec !== null && updateAtSec > movingSec;
        if (between.length >= 1 || postDatesMotion) {
          const lastBetween = between[between.length - 1];
          const latest = lastBetween ? headerSec - travelTo(lastBetween.s) - dwellOf(lastBetween.stopId) : headerSec;
          departure = Math.min(departure, Math.max(t, latest));
        } else {
          if (counts) counts.eta_bound_skipped++;
        }
      }
      // A trip that has not started does not leave its first platform (R-TE49).
      const scheduledStart = tripStartAfter(track, next, t);
      if (scheduledStart !== null) departure = Math.max(departure, scheduledStart);
      if (s < here.s) {
        const arrive = Math.min(departure, t + (here.s - s) / approachSpeed);
        knots.push([rel(arrive), round1(here.s)]);
        t = arrive;
        s = here.s;
      }
      nextStop = { stopId: here.stopId, s: round1(here.s), etaSec: Math.round(t) };
      if (departure > t) {
        knots.push([rel(departure), round1(s)]);
        t = departure;
      }
    }
  } else if (standing && silent) {
    // T8 off a platform: a silent vehicle last seen standing (a signal, a
    // queue, a layover track) stays where it stood. Its next stop is still
    // the first platform ahead, but the plan does not reach it, so no time.
    const ahead = geometry.stopsAhead(s)[0];
    if (ahead) nextStop = { stopId: ahead.stopId, s: round1(ahead.s), etaSec: null };
    knots.push([rel(horizonEnd), round1(s)]);
    t = horizonEnd;
  } else if (standing) {
    // Standing off any platform: about as long again, within bounds (R-TE47),
    // and never before a trip that has not started (R-TE49).
    let hold = Math.min(Math.max(stoodSec, STAND_HOLD_MIN_S), STAND_HOLD_MAX_S);
    const scheduledStart = tripStartAfter(track, next, t);
    if (scheduledStart !== null) hold = Math.max(hold, scheduledStart - t);
    knots.push([rel(t + hold), round1(s)]);
    t += hold;
  }

  const halts = haltsAfter(s);
  let stopIdx = 0;
  /** Nothing ahead has been reached yet: ZET's ETA is about the first
   *  PLATFORM ahead, which a junction wait in front of it must not displace. */
  let firstPlatformAhead = true;

  while (t < horizonEnd) {
    const stop = stopIdx < halts.length ? halts[stopIdx] : null;
    const target = stop ? Math.min(stop.s, geometry.len) : geometry.len;
    if (target <= s + 0.5) {
      if (!stop) break; // at the path end already
      stopIdx++;
      continue;
    }
    const scheduled = geometry.timesPath !== null ? times.segmentSeconds(geometry.timesPath, s, target, bands.hourBand, bands.dayType, PLAN_QUANTILE) : null;
    const scheduledSpeed = scheduled !== null && scheduled > 0 ? (target - s) / scheduled : null;
    // Own speed is evidence about now: a moving vehicle's first stretch runs
    // at it for OWN_SPEED_HOLD_S, then at what the stretch usually takes
    // (R-TE46); a standing vehicle's own speed is its last cruise, not now.
    const firstStretch = first && knots.length <= 2 && !standing;
    const own = firstStretch ? ownSpeed : null;
    const cruise = scheduledSpeed ?? ownSpeed ?? DEFAULT_CRUISE_MS;
    const ownLeg = own !== null ? Math.min(target - s, own * OWN_SPEED_HOLD_S) : 0;
    const kinematic = (own !== null ? ownLeg / own : 0) + (target - s - ownLeg) / cruise;
    let arrive = t + kinematic;
    let viaEta = false;
    if (firstPlatformAhead && stop && stop.stopId !== null && next && next.stopId === stop.stopId && next.timeSec !== null) {
      const eta = next.timeSec - t;
      if (eta >= ETA_BAND[0] * kinematic && eta <= ETA_BAND[1] * kinematic) {
        arrive = next.timeSec;
        viaEta = true;
      }
    }
    if (own !== null && !viaEta && ownLeg > 0.5 && ownLeg < target - s - 0.5) knots.push([rel(t + ownLeg / own), round1(s + ownLeg)]);
    knots.push([rel(arrive), round1(target)]);
    if (!stop) {
      // The end of the path is a terminus: hold until the trip changes.
      knots.push([rel(Math.max(horizonEnd, arrive)), round1(target)]);
      t = horizonEnd;
      break;
    }
    if (stop.stopId !== null) {
      if (!nextStop) nextStop = { stopId: stop.stopId, s: round1(stop.s), etaSec: Math.round(arrive) };
      firstPlatformAhead = false;
      if (silent) {
        // T8: a silent vehicle is never planned past its next stop. It
        // arrives (after any junction wait booked before it) and holds.
        if (arrive < horizonEnd) knots.push([rel(horizonEnd), round1(target)]);
        t = horizonEnd;
        break;
      }
    } else if (stop.holdSec > 0) {
      if (counts) counts.junction_wait++;
    }
    const dwell = stop.holdSec;
    if (dwell > 0) knots.push([rel(arrive + dwell), round1(target)]);
    t = arrive + dwell;
    s = target;
    stopIdx++;
    if (stopIdx >= halts.length && target >= geometry.len - 0.5) {
      knots.push([rel(Math.max(horizonEnd, t)), round1(target)]);
      t = horizonEnd;
      break;
    }
  }
  if (knots[knots.length - 1][0] < rel(horizonEnd)) knots.push([rel(horizonEnd), knots[knots.length - 1][1]]);

  track.plan = track.match.pathIdx !== null ? { on: 'path', pathIdx: track.match.pathIdx, knots } : { on: 'shape', shapeIdx: track.match.shapeIdx!, knots };
  track.next = nextStop;
  const base = track.fixes.length >= 2 ? CONFIDENCE_ON_GEOMETRY : CONFIDENCE_SINGLE_FIX;
  track.confidence = base * decay;
}

/** The trip's scheduled first departure with ZET's delay added, when it is
 *  still ahead by less than TRIP_START_MAX_AHEAD_S (R-TE49); null otherwise.
 *  A negative delay is a vehicle waiting early, not a trip leaving early. */
function tripStartAfter(track: Track, next: NextStopUpdate | null, tSec: number): number | null {
  if (track.tripStartSec === null) return null;
  const start = track.tripStartSec + Math.max(0, next?.delaySec ?? 0);
  return start > tSec && start - tSec <= TRIP_START_MAX_AHEAD_S ? start : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
