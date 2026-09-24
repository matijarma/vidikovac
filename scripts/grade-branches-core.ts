// The wrong-branch grader's core (WP6 step 2): a TypeScript port of the
// review-only grader review.local/companion/replay/grade-branches-core.mjs
// (Track E, extended by WP0 with the loops, unplaced and silence blocks),
// plus what the companion plan judges WP0 by: the acceptance rows A to H and U
// (unplaced time without parked trams, decision 16) read from the report's own
// keys, row S (a silent tram's published anchor moving beyond the next stop it
// is held at),
// row I (an adoption onto a path no service of the day runs), the unknown-trip
// share that says whether the frames still join the committed artefacts, the
// stage targets and the judge.
//
// It replays recorded ZET frames through the twin's production `runTick`
// (worker/twin/tick.ts) with the joins, learning feedback and clock of
// scripts/replay-core.ts `replay()`, and reads the TwinState each tick left:
// nothing here changes engine behaviour. The grading is split from the loop,
// `createBranchGrader(engine, options)` with `observe()` and `report()`, so a
// unit test can rewrite a track's match between two observations and prove a
// counter counts what it is named for without exercising the engine;
// `grade()` is the loop that calls it. The loop re-states replay() rather
// than hooking it because replay()'s snapshot drops the matcher state this
// grader reads (residual, off-path and against counters, prior path).
//
// On the same frames the report equals the review grader's key for key, row
// S's `ghostAdvance` included (both carry the definition of 23 Sep); the keys
// only this port writes are `unknownTripShare`, `tripObservations`,
// `unknownTripObservations` and `serviceFilter` (row I).
// scripts/grade-branches.mjs is the CLI (bundled with esbuild, as
// scripts/replay-twin.mjs is); test/accept/wrong-turn.test.ts imports this
// file directly.

import { readFile, writeFile } from 'node:fs/promises';

import { vehicleFixes } from '../app/src/motion/fixes';
import { createIntegrator } from '../app/src/motion/integrator';
import { pushDwellRecent, trimDwellRecent } from '../shared/motion/dwell';
import { dist, toLonLat, toPlane, type XY } from '../shared/motion/geo';
import { recordEvidence } from '../shared/motion/learn';
import {
  ARC_PRIOR_WEIGHT,
  BACK_WINDOW_M,
  DIRECTION_PENALTY_M,
  FOLD_FIXES,
  FOLD_MOVE_M,
  NEAR_M,
  NEXT_STOP_DISTANCE_WEIGHT,
  OFF_GRAPH_M,
  OFF_PATH_FIXES,
  PAST_NEXT_STOP_PENALTY_M,
  REACH_SLACK_M,
} from '../shared/motion/match';
import type { GraphNetwork } from '../shared/motion/network';
import { mapArc } from '../shared/motion/order';
// EVICT_S / SILENCE_HOLD_S come from the graded tree itself (180 / 30 since
// WP0's T8; 300 / 30 before), so the silence rows measure the code's own rule.
import { evalPathPlan, EVICT_S, SILENCE_HOLD_S } from '../shared/motion/plan';
import { project, projectionsWithin, tangent } from '../shared/motion/polyline';
import { DEAD_ZONE_M, MAX_SPEED_MS, STOP_ZONE_M } from '../shared/motion/speed';
import { lastFix, type PathKnot, type Track } from '../shared/motion/track';
import type { TripIndex } from '../shared/motion/trips';
import { inTeaserBox, TEASER_BOX_CENTRE, TEASER_BOX_HALF_M } from '../worker/feed/modules/zet-rt';
import type { FeedPayload } from '../worker/feed/payload';
import type { FeedItem, ModuleSnapshot } from '../worker/feed/schema';
import { nextTickAt } from '../worker/twin/clock';
import type { Engine } from '../worker/twin/engine';
import type { DecodedFeed } from '../worker/twin/feed-decode';
import type { TripJoin } from '../worker/twin/publish';
import { emptyState, type TwinState } from '../worker/twin/state';
import { runTick } from '../worker/twin/tick';
import { CLIENT_MAX_GAP_S, CLIENT_POLL_LANDING_S, loadFrameFiles, loadRealEngine, orderFrames, REPLAY_NOW_CUSHION_S } from './replay-core';

export { loadRealEngine };

/** Zagreb is UTC+2 in September (CEST). */
const LOCAL_OFFSET_S = 2 * 3600;
/** A direction flip this close to a terminus platform is a real turnaround. */
const TERMINAL_NEAR_M = 150;
/** The client re-seed displacement a viewer reads as a snap (dossier's acceptance draft). */
const SNAP_M = 50;
/** An arc jump between two consecutive fixes on one path that no tram drives in one tick. */
const ARC_JUMP_M = 500;
/** A matched arc receding by more than this between two fresh fixes on one path is a backward step, not scatter (REGRESSION_M in replay-core). */
const BACKWARD_STEP_M = 25;
/** The two Glavni kolodvor detour paths (code-reality/data-and-motion.md B1 cause 1). */
const GK_PATH_IDS = ['path:9:0:892fe989', 'path:6:1:e641be7c'];
const GK_SIBLINGS: Record<string, string> = { 'path:9:0:892fe989': 'path:9:0:f42a655b', 'path:6:1:e641be7c': 'path:6:1:4e01aeae' };
/** The loop's first and last edge in the dossier's edge trace (113 -> ... -> 290 -> 211 -> 212 -> 213 -> 214 -> 291 -> 209 -> 292 -> ...). */
const GK_LOOP_FIRST_EDGE = 290;
const GK_LOOP_LAST_EDGE = 292;
/** The live monitor's window (dossier): 17:15-17:44 local. */
const WINDOW_FROM_S = 17 * 3600 + 15 * 60;
const WINDOW_TO_S = 17 * 3600 + 44 * 60;
/** Terminus loop paths (WP0 step 6, scripts/gtfs-shapes.mjs LOOP_ID_PREFIX): a
 *  tram entering or leaving one is doing what trams do at a terminus, so an
 *  own-route transition onto or off such a path is its own class
 *  ('loop-transition'), counted in `loops` and excluded from metric A. */
const LOOP_ID_PREFIX = 'loop:';
/** A hand-over onto or off a terminus loop path is a terminus turn within this
 *  of a terminal platform, row E's own band; farther from every terminal it is
 *  a direction flip like any other and counts in rows A and E (23 Sep, the
 *  review of lane/t-rail: 4 + 5 returns a day from a plan held at a loop stand,
 *  seven after 55 to 119 s of silence and two after 14 and 27 s, 249 to 754 m
 *  from the tram, read as loop transitions and so out of both rows). The
 *  distance is unrounded metres, as decision 16's parked radius: 300.4 m
 *  prints as 300 and is beyond 300 m. */
export const LOOP_HANDOVER_TERMINUS_M = 300;
/** The class of a same-trip path change (describeEvent), from what it joins.
 *  `diverted`: the matcher's TramTrack.diverted before or after the change
 *  (rail round 2), a tram running its line's rails off its own path
 *  mid-line; `turnaround`: the D4 mechanism fired (the tram moved against
 *  the rail it stood on), a reversal whatever the flag says. */
export function classifyEvent(x: { vehicleRoute: string; oldRoute: string; newRoute: string; oldId: string; newId: string; oldDirection: number; newDirection: number; terminalM: number | null; diverted?: boolean; turnaround?: boolean }): EventClass {
  if (x.newRoute !== x.vehicleRoute) return 'onto-other-route';
  if (x.oldRoute !== x.vehicleRoute) return 'back-to-own-route';
  // Own-route transitions onto or off a terminus loop path (direction -1) are
  // their own class at a terminus: otherwise they would read as direction flips.
  const loop = isLoopId(x.oldId) || isLoopId(x.newId);
  if (loop && (x.terminalM === null || x.terminalM <= LOOP_HANDOVER_TERMINUS_M)) return 'loop-transition';
  // A hop of a diverted tram between rails of its own line: the leaving, the
  // hops between variants and the return are one diversion, counted in the
  // diversions block and not in row A; a D4 reversal is still a flip.
  if (!loop && x.diverted === true && x.turnaround !== true) return 'diversion-hop';
  if (x.oldDirection !== x.newDirection) return 'direction-flip';
  return 'same-route-variant';
}
/** What row A counts, and A' inside the teaser box (decision 35): every
 *  same-trip path change but a direction flip at a terminal, a loop transition
 *  and a diversion hop (rail round 2). */
export function countsInA(e: { cls: string; atTerminus: boolean }): boolean {
  return e.cls !== 'loop-transition' && e.cls !== 'diversion-hop' && !(e.cls === 'direction-flip' && e.atTerminus);
}
/** Silence gaps (fresh fix to fresh fix of one vehicle) shorter than this are ZET's ordinary cadence. */
const GAP_MIN_S = 60;
/** How far ahead of the header a silent tram's published plan is read (WP0 step 7c). */
const SILENCE_LOOKAHEAD_S = 60;
/** Slack over the next stop's arc: the wire rounds arcs to 0.1 m and the planner to 0.1 m (round1). */
const PAST_STOP_SLACK_M = 1;
/** Row S (WP6 step 2, redefined by D1 decision 3 on 23 Sep): a tram whose
 *  newest fix is older than this, at the tick's own clock, is silent. T8 lets
 *  its published anchor finish the glide to the next stop and hold there;
 *  row S measures what the anchor does beyond that hold. */
const GHOST_SILENCE_S = 60;
/** Decision 16: an unplaced episode at least this long ... */
export const PARKED_MIN_S = 600;
/** ... whose fixes never leave this radius of its first fix is a parked tram
 *  (depot or layover): never drawn, so not counted in row U's share (A10). */
export const PARKED_RADIUS_M = 100;

// ---- the join builder -------------------------------------------------------

// Mirrors scripts/replay-core.ts `joinsFor` (module-private there; handoff
// V-A2 -> T1r2 asks for the export), which carries the trip's service id: the
// matcher filters paths by the services running in the frame (tick.ts builds
// `runningServices` from these joins) and silently disables that filter when
// no join names a service, which would make rows B, C and I meaningless.
// Hence the presence assertion.
function joinsFor(index: TripIndex, tripIds: Iterable<string>, patternPathIds: readonly (string | null)[] = []): Map<string, TripJoin> {
  const out = new Map<string, TripJoin>();
  for (const id of tripIds) {
    const record = index.tripsById.get(id);
    if (!record) continue;
    const pattern = index.patterns[record.pattern];
    if (!pattern) continue;
    const pathId = patternPathIds[record.pattern] ?? null;
    out.set(id, {
      direction: pattern.direction === 1 ? 1 : 0,
      headsign: pattern.headsign,
      shapeId: pattern.shape === '' ? null : pattern.shape,
      startSec: record.start,
      service: record.service,
      ...(pathId === null ? {} : { pathId }),
    });
  }
  assertJoinsCarryService(out);
  return out;
}

/** Fails the run the moment a join lacks its service id (a trip index cut
 *  without services, or a joinsFor that forgot the field). */
function assertJoinsCarryService(joins: ReadonlyMap<string, TripJoin>): void {
  for (const [id, join] of joins) {
    if (typeof join.service !== 'string' || join.service === '') {
      throw new Error(`grade-branches: the join for trip ${id} carries no service id (got ${JSON.stringify(join.service)}); the matcher's running-services filter would be silently off and rows B/C/I would not measure it`);
    }
  }
}

// ---- a read-only re-statement of match.ts `place()` -------------------------
// Used only to ask, at the tick a path changed, what residual the OLD path
// would have given this fix -- the number the matcher computed and threw
// away when it replaced track.match. Same constants, same window, same score.

interface MotionOf {
  dir: XY | null;
  groundM: number;
  dtSec: number;
  speed: number;
}

function dot(a: XY, b: XY): number {
  return a.x * b.x + a.y * b.y;
}

function placeLike(net: GraphNetwork, pathIdx: number, p: XY, motion: MotionOf, prevS: number | null, sNext: number | null): { s: number; d: number; via: 'window' | 'nearest' | 'all' } {
  const geo = net.pathGeometry(pathIdx);
  const pts = geo.pts;
  const cum = geo.cum;
  const len = net.paths[pathIdx].len;
  const agrees = (s: number): boolean => motion.dir === null || dot(tangent(pts, cum, s), motion.dir) >= 0;
  if (prevS !== null) {
    const dt = Math.max(motion.dtSec, 0);
    const window = projectionsWithin(pts, cum, p, prevS - BACK_WINDOW_M, prevS + MAX_SPEED_MS * dt + REACH_SLACK_M, OFF_GRAPH_M);
    if (window.length > 0) {
      const expected = prevS + Math.min(Math.max(motion.speed, 0), MAX_SPEED_MS) * dt;
      let best = window[0];
      let bestScore = Number.POSITIVE_INFINITY;
      for (const c of window) {
        const score = c.d + ARC_PRIOR_WEIGHT * Math.abs(c.s - expected);
        if (score < bestScore) {
          best = c;
          bestScore = score;
        }
      }
      const against = motion.dir !== null && motion.groundM >= FOLD_MOVE_M && !agrees(best.s);
      if (!against) return { s: best.s, d: best.d, via: 'window' };
    }
  }
  const all = projectionsWithin(pts, cum, p, 0, len, OFF_GRAPH_M);
  if (all.length === 0) {
    const proj = project(pts, cum, p);
    return { s: proj.s, d: proj.d, via: 'nearest' };
  }
  let best = all[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of all) {
    let score = c.d;
    if (!agrees(c.s)) score += DIRECTION_PENALTY_M;
    if (sNext !== null) {
      if (c.s > sNext + PAST_NEXT_STOP_PENALTY_M) score += PAST_NEXT_STOP_PENALTY_M;
      score += NEXT_STOP_DISTANCE_WEIGHT * Math.max(0, sNext - c.s);
    }
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return { s: best.s, d: best.d, via: 'all' };
}

function normalise(v: XY): XY {
  const len = Math.hypot(v.x, v.y);
  return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}

// ---- helpers ----------------------------------------------------------------

// Nullable numbers compare and sort as JavaScript coerces them (null reads 0)
// wherever the review grader let them: Number() states that coercion so the
// port counts exactly what the original counted.

function percentile(values: readonly (number | null)[], share: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => Number(a) - Number(b));
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
}

function localSecOfDay(sec: number): number {
  return (sec + LOCAL_OFFSET_S) % 86400;
}

function localHour(sec: number): number {
  return Math.floor(localSecOfDay(sec) / 3600);
}

function localClock(sec: number): string {
  const t = localSecOfDay(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function inWindow(sec: number): boolean {
  const t = localSecOfDay(sec);
  return t >= WINDOW_FROM_S && t < WINDOW_TO_S;
}

function inc<K>(map: Map<K, number>, key: K, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

/** Decision 16: a tram standing off-graph without moving for ten minutes or more is parked. The distance is
 *  the unrounded metres (the report prints it rounded); 100.4 m is beyond the radius. */
export function isParkedEpisode(durationS: number, maxDistFromStartM: number): boolean {
  return durationS >= PARKED_MIN_S && maxDistFromStartM <= PARKED_RADIUS_M;
}

function isLoopId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(LOOP_ID_PREFIX);
}

type AgeBucket = 'le30' | 'le60' | 'le120' | 'le180' | 'le300' | 'gt300';

/** Bucket of a published item's age (now minus its last fix), seconds. */
function ageBucket(ageS: number): AgeBucket {
  if (ageS <= 30) return 'le30';
  if (ageS <= 60) return 'le60';
  if (ageS <= 120) return 'le120';
  if (ageS <= 180) return 'le180';
  if (ageS <= 300) return 'le300';
  return 'gt300';
}

function emptyAgeHist(): Record<AgeBucket, number> {
  return { le30: 0, le60: 0, le120: 0, le180: 0, le300: 0, gt300: 0 };
}

/** Math.max without spreading: the silence rows can hold 10^5 values, past V8's argument limit. */
function maxOf(values: readonly number[]): number | null {
  let best: number | null = null;
  for (const v of values) if (best === null || v > best) best = v;
  return best;
}

function r2(n: number): number;
function r2(n: number | null | undefined): number | null;
function r2(n: number | null | undefined): number | null {
  return n === null || n === undefined ? null : Math.round(n * 100) / 100;
}

function r1(n: number): number;
function r1(n: number | null | undefined): number | null;
function r1(n: number | null | undefined): number | null {
  return n === null || n === undefined ? null : Math.round(n * 10) / 10;
}

type Key = string | number;
type Counted<K extends Key = Key> = [K, number][];

function sortedEntries<K extends Key>(map: Map<K, number>, limit?: number): Counted<K> {
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  return limit !== undefined ? entries.slice(0, limit) : entries;
}

function countBy<T, K extends Key>(arr: readonly T[], f: (x: T) => K, limit?: number): Counted<K> {
  const m = new Map<K, number>();
  for (const x of arr) inc(m, f(x));
  return sortedEntries(m, limit);
}

/** A stop of stops.json in the plane, with the network's terminus flag. */
export interface GradeStop {
  id: string;
  name: string;
  p: XY;
  routes: string[];
  terminal: boolean;
}

type NearestStop = (p: XY, filter?: (stop: GradeStop) => boolean) => { stop: GradeStop; d: number } | null;

/** Nearest stop by brute force over a coarse grid: 2529 stops, a few thousand queries. */
function stopFinder(stops: readonly GradeStop[]): NearestStop {
  const cell = 500;
  const grid = new Map<string, GradeStop[]>();
  const key = (x: number, y: number): string => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
  for (const stop of stops) {
    const k = key(stop.p.x, stop.p.y);
    const list = grid.get(k);
    if (list) list.push(stop);
    else grid.set(k, [stop]);
  }
  return function nearest(p, filter) {
    let best: { stop: GradeStop; d: number } | null = null;
    for (let r = 1; r <= 8 && best === null; r++) {
      const cx = Math.floor(p.x / cell);
      const cy = Math.floor(p.y / cell);
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          for (const stop of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
            if (filter && !filter(stop)) continue;
            const d = dist(p, stop.p);
            if (best === null || d < best.d) best = { stop, d };
          }
        }
      }
    }
    return best;
  };
}

/** stops.json (every platform, buses too) in the plane, terminus flags from the network. */
export async function loadStops(stopsPath: string, net: GraphNetwork): Promise<GradeStop[]> {
  const raw = JSON.parse(await readFile(stopsPath, 'utf8')) as { id: string; name: string; lon: number; lat: number; routes?: string[] }[];
  const terminalById = new Map(net.stops.map((s) => [s.id, s.terminal === true] as const));
  return raw.map((s) => ({ id: s.id, name: s.name, p: toPlane(s.lon, s.lat), routes: s.routes ?? [], terminal: terminalById.get(s.id) ?? false }));
}

/** Row I's lookup, once per engine: the services whose trips run each path
 *  (trip -> pattern -> path id via engine.patternPathIds -> path index). */
function servicesByPath(engine: Engine): Set<string>[] {
  const idxOf = new Map(engine.net.paths.map((p, i) => [p.id, i] as const));
  const out = engine.net.paths.map(() => new Set<string>());
  for (const record of engine.index.tripsById.values()) {
    const pathId = engine.patternPathIds[record.pattern] ?? null;
    if (pathId === null || !record.service) continue;
    const idx = idxOf.get(pathId);
    if (idx !== undefined) out[idx].add(record.service);
  }
  return out;
}

// ---- the grader -------------------------------------------------------------

/** One tram track as the grader saw it after one tick. */
interface TickRecord {
  h: number;
  gen: number;
  trip: string | null;
  route: string;
  fixAt: number;
  p: XY;
  lon: number;
  lat: number;
  inBox: boolean;
  path: number | null;
  edge: number | null;
  s: number;
  res: number;
  off: number;
  ag: number;
  prior: number | null;
  speed: number;
  planPath: number | null;
  planKnots: readonly PathKnot[] | null;
  anchor: number | null;
  held: boolean;
  fresh: boolean;
  /** match.ts TramTrack.diverted after the tick (rail round 2). */
  diverted: boolean;
}

export type EventClass = 'onto-other-route' | 'back-to-own-route' | 'loop-transition' | 'diversion-hop' | 'direction-flip' | 'same-route-variant';

/** One matched-path change within an unchanged trip. */
export interface BranchEvent {
  h: number;
  clock: string;
  hour: number;
  id: string;
  route: string;
  trip: string | null;
  cls: EventClass;
  mechanism: string;
  from: string;
  to: string;
  fromRoute: string;
  toRoute: string;
  fromDir: number;
  toDir: number;
  fromSynthetic: boolean;
  toSynthetic: boolean;
  fromS: number;
  toS: number;
  prior: string | null;
  oldWasPrior: boolean;
  newIsPrior: boolean;
  edge: number | null;
  poolSize: number;
  ownPoolSize: number;
  poolIds: string[];
  priorInPool: boolean;
  oldInPool: boolean;
  oldResidualNow: number;
  oldResidualVia: 'window' | 'nearest' | 'all';
  oldMinD: number;
  newResidual: number;
  newAtPrevFixD: number;
  priorMinD: number | null;
  prevOff: number;
  prevAg: number;
  againstDeg: number | null;
  oldFolds: number;
  groundM: number;
  dtSec: number;
  series: { h: number; fixAt: number; res: number; off: number; ag: number; path: string | null }[];
  excursionS: number;
  planGapM: number | null;
  held: boolean;
  heldBefore: boolean;
  inBox: boolean;
  lon: number;
  lat: number;
  nearestStop: string | null;
  nearestStopId: string | null;
  nearestStopM: number | null;
  nearestTerminal: string | null;
  nearestTerminalM: number | null;
  atTerminus: boolean;
  /** The matcher's diverted flag at the tick before and after the change (rail round 2). */
  divertedBefore: boolean;
  divertedAfter: boolean;
  revertedInS?: number;
  foreignDurationS?: number;
  foreignGroundM?: number;
  foreignFrom?: string;
  foreignPath?: string;
}

interface Reseed {
  h: number;
  clock: string;
  id: string;
  route: string | null;
  from: string | null;
  to: string | null;
  kind: 'path->path' | 'free->path' | 'path->free' | 'free->free';
  sameTrip: boolean;
  snapped: boolean;
  jumpM: number;
  sBefore: number | null;
  sAfter: number | null;
  mappedS: number | null;
  holdingBefore: boolean;
  heldBefore: boolean;
  nearestStop: string | null;
  inBox: boolean;
}

interface ArcJump {
  h: number;
  clock: string;
  id: string;
  route: string;
  trip: string | null;
  path: string;
  fromS: number;
  toS: number;
  ds: number;
  dtSec: number;
  groundM: number;
  nearestStop: string | null;
  nearestStopM: number | null;
}

interface BackwardRunOpen {
  startH: number;
  startFix: number;
  startP: XY;
  path: number;
  trip: string | null;
  route: string;
  prior: number | null;
  steps: number;
  metres: number;
  endFix?: number;
  endP?: XY;
}

interface BackwardRun {
  id: string;
  route: string;
  trip: string | null;
  path: string;
  pathRoute: string;
  onPrior: boolean;
  start: string;
  durationS: number;
  steps: number;
  metres: number;
  groundM: number;
  endStop: string | null;
}

interface UnplacedOpen {
  gen: number;
  startH: number;
  route: string;
  trip: string | null;
  prior: string | null;
  /** match.ts TramTrack.unplacedReason at the episode's first tick, or 'unknown'. */
  reason: string;
  startP: XY;
  lastP: XY;
  sec: number;
  ticks: number;
  fresh: number;
  withEdgeTicks: number;
  /** The farthest fix of the episode from its first one, in metres. */
  maxDistFromStart: number;
}

interface UnplacedEpisode {
  start: string;
  id: string;
  route: string;
  trip: string | null;
  prior: string | null;
  /** Why the matcher left the tram unplaced ('terminus', 'diversion', 'no-path', or 'unknown'). */
  reason: string;
  durationS: number;
  ticks: number;
  freshFixes: number;
  withEdgeTicks: number;
  groundM: number;
  maxDistFromStartM: number;
  /** Decision 16 (isParkedEpisode): standing at a depot or layover, left out of row U. */
  parked: boolean;
  stop: string | null;
  stopM: number | null;
  terminal: string | null;
  terminalM: number | null;
}

interface DivertedOpen {
  gen: number;
  startH: number;
  lastH: number;
  route: string;
  trip: string | null;
  prior: string | null;
  startP: XY;
  lastP: XY;
  sec: number;
  ticks: number;
  fresh: number;
  hops: number;
  maxDistFromStart: number;
}

/** One diversion (rail round 2): the ticks a tram carried match.ts
 *  TramTrack.diverted, with the same-trip path changes classed
 *  `diversion-hop` that started it, moved it between variants and ended it. */
interface DiversionEpisode {
  start: string;
  end: string;
  id: string;
  route: string;
  trip: string | null;
  prior: string | null;
  hops: number;
  durationS: number;
  ticks: number;
  freshFixes: number;
  groundM: number;
  maxDistFromStartM: number;
  /** 'return' (back on the prior), 'trip-change', 'loop' (onto a terminus loop), 'evicted', 'other' (off the graph, or unplaced for another reason), 'open' (still diverted at the report). */
  endedBy: string;
  stop: string | null;
  endStop: string | null;
}

interface SilencePast {
  h: number;
  id: string;
  route: string;
  path: string;
  silenceS: number;
  nextStop: string;
  nextStopIs: 'here' | 'ahead' | 'path end';
  sRef: number;
  limitS: number;
  sAt60: number;
  overM: number;
}

interface SilenceGap {
  gapS: number;
  sameTrip: boolean;
  movedM: number;
  terminalM: number;
}

interface GkTrip {
  id: string;
  ticks: number;
  fresh: number;
  onPath: number;
  offPath: number;
  maxDs: number;
  maxDsAt: string | null;
  inLoopInterior: number;
  nearLoop: number;
  maxPlanAhead: number;
  minS: number;
  maxS: number;
}

interface GkEntry {
  idx: number;
  len: number;
  edges: number;
  sibling: string;
  siblingLen: number | null;
  extraEdgesVsSibling: number[];
  loop: { edges: number[]; sFrom: number; sTo: number } | null;
  trips: Map<string, GkTrip>;
}

/** Row S's watch over one track: the tick of its newest fresh fix, and what
 *  the published anchor did once that fix was more than GHOST_SILENCE_S old,
 *  against the hold of each such tick (holdOf). */
interface GhostWatch {
  gen: number;
  fixAt: number;
  route: string;
  trip: string | null;
  path: number | null;
  anchor0: number | null;
  /** The stop ZET's TripUpdate named as next at the fix tick, and its arc (context, S_pastNextStop). */
  nextStopId: string | null;
  sStop: number | null;
  openedH: number | null;
  maxSilenceS: number;
  /** Row S: the largest excess of the anchor over the tick's hold arc (negative while short of it). */
  maxBeyond: number | null;
  /** The hold at the tick of that excess. */
  holdStop: string | null;
  holdS: number | null;
  /** S-glide: the largest advance past anchor0, the anchor capped at the tick's hold arc. */
  maxGlide: number | null;
  passed: boolean;
  pathChanged: boolean;
}

interface GhostEpisode {
  start: string;
  id: string;
  route: string;
  trip: string | null;
  path: string | null;
  silenceS: number;
  /** Row S: metres the published anchor went beyond the hold (0 within PAST_STOP_SLACK_M). */
  beyondHoldM: number | null;
  /** S-glide: metres the published anchor travelled while silent, up to the hold. */
  glideM: number | null;
  holdStop: string | null;
  holdS: number | null;
  nextStop: string | null;
  pastNextStop: boolean;
  pathChanged: boolean;
}

/** A served platform on a path, as the network lists them (graph.ts stopsOnPath). */
type StopOnPath = ReturnType<GraphNetwork['stopsOnPath']>[number];

export interface BranchGraderOptions {
  /** Every platform, for the nearest-stop and nearest-terminal columns (loadStops). */
  stops: readonly GradeStop[];
  /** Client frames per second between polls; 0 steps the integrator only around each poll. Default 4. */
  clientHz?: number;
  label?: string | null;
  /** Files of the directory that carried no header (orderFrames). */
  dropped?: number;
  /** Frames the loop will observe, for the progress line only. */
  frameCount?: number;
  log?: (line: string) => void;
}

/**
 * The grader without the loop. `observe()` reads the TwinState one tick left
 * (tracks, their matches and plans, the trip updates) and the payload that
 * tick published (`held`, the silence rows, and the client integrator fed
 * exactly what a page would draw); `report()` closes the open runs and
 * returns the report. A track's freshness and its identity across ticks come
 * from the Track object itself (a new object is a new generation), as in the
 * review grader, so a test that observes one state several times with a
 * track's match rewritten in between sees one vehicle whose path changed.
 */
export function createBranchGrader(engine: Engine, options: BranchGraderOptions) {
  const net = engine.net;
  const log = options.log ?? (() => {});
  const clientHz = options.clientHz ?? 4;
  const nearestStop = stopFinder(options.stops);
  const paths = net.paths;
  const pathIdToIdx = new Map(paths.map((p, i) => [p.id, i] as const));
  const pathsByEdge = new Map<number, number[]>();
  paths.forEach((path, idx) => {
    for (const e of path.edges) {
      const list = pathsByEdge.get(e);
      if (list) list.push(idx);
      else pathsByEdge.set(e, [idx]);
    }
  });
  const isSynthetic = (idx: number): boolean => paths[idx].shape === null;
  const servicesByPathIdx = servicesByPath(engine);

  /** Where T8 holds a silent tram on path `pathIdx` (WP0 step 4; the rule A11's
   *  S2 counter and row S both read): from `sRef`, the arc its path plan
   *  starts at (buildPlan's first knot, the last fix, floored), the served
   *  platform whose STOP_ZONE_M zone holds that arc (held at the stop, or
   *  where it stands past the stop point: the larger of the two arcs), else
   *  the first served platform ahead, else the path's end (a terminus holds). */
  function holdOf(pathIdx: number, sRef: number): { limitS: number; here: StopOnPath | null; ahead: StopOnPath | null } {
    const served = net.stopsOnPath(pathIdx);
    let here: StopOnPath | null = null;
    for (const entry of served) if (Math.abs(entry.s - sRef) <= STOP_ZONE_M && (here === null || Math.abs(entry.s - sRef) < Math.abs(here.s - sRef))) here = entry;
    const ahead = here === null ? served.find((entry) => entry.s > sRef + 0.5) ?? null : null;
    return { limitS: here !== null ? Math.max(here.s, sRef) : ahead !== null ? ahead.s : paths[pathIdx].len, here, ahead };
  }

  // The Glavni kolodvor loop's arc range on each detour path.
  const gk: Record<string, GkEntry> = {};
  for (const id of GK_PATH_IDS) {
    const idx = pathIdToIdx.get(id);
    if (idx === undefined) continue;
    const path = paths[idx];
    const iFirst = path.edges.indexOf(GK_LOOP_FIRST_EDGE);
    const iLast = path.edges.indexOf(GK_LOOP_LAST_EDGE);
    const sibling = pathIdToIdx.get(GK_SIBLINGS[id]);
    const siblingEdges = sibling !== undefined ? new Set(paths[sibling].edges) : new Set<number>();
    const extraEdges = path.edges.filter((e) => !siblingEdges.has(e));
    let loop: GkEntry['loop'] = null;
    if (iFirst >= 0 && iLast > iFirst) {
      loop = { edges: path.edges.slice(iFirst, iLast + 1), sFrom: path.offsets[iFirst], sTo: iLast + 1 < path.offsets.length ? path.offsets[iLast + 1] : path.len };
    }
    gk[id] = { idx, len: path.len, edges: path.edges.length, sibling: GK_SIBLINGS[id], siblingLen: sibling !== undefined ? paths[sibling].len : null, extraEdgesVsSibling: extraEdges, loop, trips: new Map() };
  }

  // --- state
  const generation = new WeakMap<Track, number>();
  let nextGeneration = 1;
  /** Per vehicle: the last few per-tick records, and the last few FRESH-fix records (ZET reports a vehicle every ~20 s; ticks are 10 s). */
  const history = new Map<string, TickRecord[]>();
  const freshHistory = new Map<string, TickRecord[]>();
  const events: BranchEvent[] = [];
  /** Each event's unrounded distance to the nearest terminal platform, for the 300 m boundaries (the event prints it rounded). */
  const terminalDist = new WeakMap<BranchEvent, number>();
  const priorChanges: { h: number; id: string; trip: string | null; from: number | null; to: number | null }[] = [];
  const arcJumps: ArcJump[] = [];
  const tickDurations: number[] = [];
  let ticks = 0;
  let firstHeader: number | null = null;
  let lastHeader: number | null = null;
  let tramTrackedSec = 0;
  let tramFreshFixes = 0;
  let tripChanges = 0;
  let prevHeader: number | null = null;
  let tripObservations = 0;
  let unknownTripObservations = 0;
  const tramVehicles = new Set<string>();
  const tramSecByRoute = new Map<string, number>();
  const tramSecByHour = new Map<number, number>();
  const tramTripsSeen = new Set<string>();
  const servicesSeen = new Map<string, number>();
  const tripsByPriorPath = new Map<string, Set<string>>();
  let windowSec = 0;
  // The teaser box (worker/feed/modules/zet-rt.ts): what the live monitor saw.
  let boxSec = 0;
  let boxWindowSec = 0;
  let boxVehicleTicks = 0;
  let boxTicks = 0;
  // Time spent on a path other than the trip's own, and whether the own path fitted meanwhile.
  const foreign = { sec: 0, fresh: 0, freshPriorNear: 0, tripsAffected: new Set<string>() };
  const variant = { sec: 0, fresh: 0, freshPriorNear: 0, tripsAffected: new Set<string>() };
  let onPriorSec = 0;
  // Backward steps of the matched arc on one path (the tram driving against its adopted path).
  const backward = { steps: 0, metres: 0, runs: [] as BackwardRun[] };
  const backwardRun = new Map<string, BackwardRunOpen>();
  // Unplaced: a tram matched to no path while not off the graph
  // (`match.pathIdx === null && !offGraph`, the free plane on rails of WP0
  // step 2). `withEdgeSec` is the matcher's own unplaced flag (a nearest edge
  // is carried), `noEdgeSec` the rest (a match just reset, for a new track or
  // a new prior, whose fix lies beyond OFF_GRAPH_M before off-graph is declared).
  // Parked (decision 16): an episode of at least PARKED_MIN_S whose fixes never
  // leave PARKED_RADIUS_M of its first one is a tram standing off the graph at a
  // depot or layover. It is never drawn, so row U (A10) judges the share without
  // it; the raw share stays beside it.
  const unplaced = { sec: 0, withEdgeSec: 0, noEdgeSec: 0, fresh: 0, offGraphSec: 0, episodes: [] as UnplacedEpisode[] };
  const unplacedSecByRoute = new Map<string, number>();
  // Why the matcher left the tram unplaced (match.ts TramTrack.unplacedReason:
  // 'terminus' within TERMINUS_NEAR_M of a terminal platform, 'diversion'
  // mid-line, 'no-path' for a trip with no rails of its own; 'unknown' from an
  // engine that does not say), by seconds and by episode.
  const unplacedSecByReason = new Map<string, number>();
  const unplacedOpen = new Map<string, UnplacedOpen>(); // vehicle id -> the running episode
  // Diversions (rail round 2): ticks with match.ts TramTrack.diverted, per
  // vehicle as episodes, and the tram time they add up to.
  const divertedOpen = new Map<string, DivertedOpen>();
  const diversions: DiversionEpisode[] = [];
  let divertedSec = 0;
  const divertedSecByRoute = new Map<string, number>();
  // Silence: fresh-fix gaps per vehicle (keyed by vehicle id, so a gap that
  // outlives the track's eviction is still one gap), and what the payload
  // publishes for vehicles whose last fix is old.
  const lastFixByVehicle = new Map<string, { atSec: number; trip: string | null; p: XY }>();
  const silenceGaps: SilenceGap[] = [];
  const silence = {
    items: 0,
    tramItems: 0,
    ageHist: emptyAgeHist(),
    tramAgeHist: emptyAgeHist(),
    olderThanEvict: 0,
    olderThanEvictTram: 0,
    olderThanEvictFrames: 0,
    olderThanEvictSamples: [] as { clock: string; id: string; route: string | number | boolean | null; ageS: number }[],
    silentTramItems: 0,
    silentTramOnPath: 0,
    silentTramOffPath: 0,
    past: [] as SilencePast[],
    pastAtHorizon: 0,
  };
  // Row S: per track, the anchor at its newest fresh fix and what the anchor did once silent.
  const ghostWatch = new Map<string, GhostWatch>();
  const ghostEpisodes: GhostEpisode[] = [];

  // --- the client: the real integrator over the very payloads the twin publishes.
  const model = createIntegrator(net);
  let nextFrameMs: number | null = null;
  const frameMs = clientHz > 0 ? 1000 / clientHz : null;
  const reseeds: Reseed[] = [];
  let clientPolls = 0;
  let clientFrames = 0;
  let finished = false;

  function snapshotFor(payload: FeedPayload, landedMs: number): ModuleSnapshot {
    return {
      module: 'zet-rt',
      tier: 'open',
      status: 'live',
      fetchedAt: new Date(landedMs).toISOString(),
      ...(payload.sourceUpdatedAt !== undefined ? { sourceUpdatedAt: payload.sourceUpdatedAt } : {}),
      attribution: { text: '', url: '', licence: '' },
      items: payload.items as FeedItem[],
    };
  }

  function closeBackwardRun(id: string): void {
    const run = backwardRun.get(id);
    if (run && (run.steps >= 2 || run.metres >= 100)) {
      const near = nearestStop(run.endP!);
      backward.runs.push({
        id,
        route: run.route,
        trip: run.trip,
        path: paths[run.path].id,
        pathRoute: paths[run.path].route,
        onPrior: run.path === run.prior,
        start: localClock(run.startH),
        durationS: run.endFix! - run.startFix,
        steps: run.steps,
        metres: Math.round(run.metres),
        groundM: Math.round(dist(run.startP, run.endP!)),
        endStop: near ? near.stop.name : null,
      });
    }
    backwardRun.delete(id);
  }

  function closeUnplaced(id: string): void {
    const ep = unplacedOpen.get(id);
    if (!ep) return;
    unplacedOpen.delete(id);
    const near = nearestStop(ep.startP);
    const terminal = nearestStop(ep.startP, (s) => s.terminal);
    unplaced.episodes.push({
      start: localClock(ep.startH),
      id,
      route: ep.route,
      trip: ep.trip,
      prior: ep.prior,
      reason: ep.reason,
      durationS: ep.sec,
      ticks: ep.ticks,
      freshFixes: ep.fresh,
      withEdgeTicks: ep.withEdgeTicks,
      groundM: Math.round(dist(ep.startP, ep.lastP)),
      maxDistFromStartM: Math.round(ep.maxDistFromStart),
      // Decision 16's boundary on unrounded metres: 100.4 m is not parked, though it prints as 100.
      parked: isParkedEpisode(ep.sec, ep.maxDistFromStart),
      stop: near ? near.stop.name : null,
      stopM: near ? Math.round(near.d) : null,
      terminal: terminal ? terminal.stop.name : null,
      terminalM: terminal ? Math.round(terminal.d) : null,
    });
  }

  function closeDiverted(id: string, endedBy: string): void {
    const ep = divertedOpen.get(id);
    if (!ep) return;
    divertedOpen.delete(id);
    const near = nearestStop(ep.startP);
    const endNear = nearestStop(ep.lastP);
    diversions.push({
      start: localClock(ep.startH),
      end: localClock(ep.lastH),
      id,
      route: ep.route,
      trip: ep.trip,
      prior: ep.prior,
      hops: ep.hops,
      durationS: ep.sec,
      ticks: ep.ticks,
      freshFixes: ep.fresh,
      groundM: Math.round(dist(ep.startP, ep.lastP)),
      maxDistFromStartM: Math.round(ep.maxDistFromStart),
      endedBy,
      stop: near ? near.stop.name : null,
      endStop: endNear ? endNear.stop.name : null,
    });
  }

  function closeGhost(id: string): void {
    const watch = ghostWatch.get(id);
    if (!watch) return;
    ghostWatch.delete(id);
    if (watch.openedH === null) return;
    const nextStop = watch.nextStopId !== null ? net.stops.find((s) => s.id === watch.nextStopId)?.name ?? watch.nextStopId : null;
    ghostEpisodes.push({
      start: localClock(watch.openedH),
      id,
      route: watch.route,
      trip: watch.trip,
      path: watch.path !== null ? paths[watch.path].id : null,
      silenceS: watch.maxSilenceS,
      // The planner and the wire round arcs to 0.1 m: an excess within the slack is the hold itself.
      beyondHoldM: watch.maxBeyond === null ? null : watch.maxBeyond > PAST_STOP_SLACK_M ? r1(watch.maxBeyond) : 0,
      glideM: watch.maxGlide === null ? null : r1(Math.max(0, watch.maxGlide)),
      holdStop: watch.holdStop,
      holdS: r1(watch.holdS),
      nextStop,
      pastNextStop: watch.passed,
      pathChanged: watch.pathChanged,
    });
  }

  // ---- the event description --------------------------------------------------
  function describeEvent(track: Track, rec: TickRecord, prev: TickRecord, fh: readonly TickRecord[], stateNow: TwinState): BranchEvent {
    const oldIdx = prev.path!;
    const newIdx = rec.path!;
    const oldPath = paths[oldIdx];
    const newPath = paths[newIdx];
    const veh = rec.route;
    const near = nearestStop(rec.p);
    const terminal = nearestStop(rec.p, (s) => s.terminal);

    // Motion exactly as match.ts motionOf computed it for this fix.
    const groundM = dist(prev.p, rec.p);
    const dir = groundM >= DEAD_ZONE_M ? normalise({ x: rec.p.x - prev.p.x, y: rec.p.y - prev.p.y }) : null;
    const motion: MotionOf = { dir, groundM, dtSec: rec.fixAt - prev.fixAt, speed: prev.speed };
    const nextStopId = rec.trip !== null ? stateNow.tripUpdates[rec.trip]?.stopId ?? null : null;
    let sNextOld: number | null = null;
    if (nextStopId !== null) {
      const entry = net.stopsOnPath(oldIdx).find((e) => e.stop.id === nextStopId);
      sNextOld = entry ? entry.s : null;
    }
    const oldNow = placeLike(net, oldIdx, rec.p, motion, prev.s, sNextOld);
    const oldMinD = net.projectOntoPath(oldIdx, rec.p).d;
    const newAtPrev = net.projectOntoPath(newIdx, prev.p).d;
    const priorIdx = rec.prior;
    const priorMinD = priorIdx !== null ? net.projectOntoPath(priorIdx, rec.p).d : null;
    // The old path's tangent against the movement, and how many folds of the old path lie within 100 m (a path passing itself).
    const oldGeo = net.pathGeometry(oldIdx);
    const oldTan = tangent(oldGeo.pts, oldGeo.cum, prev.s);
    const againstDeg = dir ? Math.round((Math.acos(Math.max(-1, Math.min(1, dot(oldTan, dir)))) * 180) / Math.PI) : null;
    const oldFolds = projectionsWithin(oldGeo.pts, oldGeo.cum, rec.p, 0, oldPath.len, 100).length;

    let mechanism: string;
    if (prev.prior !== rec.prior) mechanism = 'prior-change';
    else if (oldNow.d > NEAR_M && prev.off === OFF_PATH_FIXES - 1) mechanism = 'off-path-rederive';
    else if (oldNow.d <= NEAR_M && prev.ag === FOLD_FIXES - 1 && oldPath.direction !== newPath.direction) mechanism = oldPath.route === newPath.route ? 'turnaround' : 'turnaround-cross-route';
    else if (oldNow.d > NEAR_M) mechanism = 'off-path-rederive?';
    else mechanism = 'unexplained';
    // The class reads the mechanism (a D4 reversal is never a diversion hop) and the matcher's diverted flag around the change.
    const cls = classifyEvent({ vehicleRoute: veh, oldRoute: oldPath.route, newRoute: newPath.route, oldId: oldPath.id, newId: newPath.id, oldDirection: oldPath.direction, newDirection: newPath.direction, terminalM: terminal ? terminal.d : null, diverted: prev.diverted || rec.diverted, turnaround: mechanism.startsWith('turnaround') });

    // The adoptPath pool at the adopted edge.
    const pool = rec.edge !== null ? pathsByEdge.get(rec.edge) ?? [] : [];
    const ownPool = pool.filter((p) => paths[p].route === veh);
    const priorInPool = priorIdx !== null && pool.includes(priorIdx);
    const oldInPool = pool.includes(oldIdx);
    const newIsPrior = newIdx === priorIdx;
    const oldWasPrior = oldIdx === priorIdx;

    const series = fh.slice(-3).map((r) => ({ h: r.h - rec.h, fixAt: r.fixAt - rec.fixAt, res: r1(r.res), off: r.off, ag: r.ag, path: r.path === oldIdx ? 'old' : r.path === null ? null : paths[r.path].id }));
    let excursionS = 0;
    for (let i = fh.length - 1; i >= 0; i--) {
      if (fh[i].res > NEAR_M && fh[i].path === oldIdx) excursionS = rec.fixAt - fh[i].fixAt;
      else break;
    }
    let planGapM: number | null = null;
    if (prev.planKnots && prev.planPath !== null) planGapM = dist(net.toPathPoint(prev.planPath, evalPathPlan(prev.planKnots, rec.h - prev.h)), rec.p);

    const event: BranchEvent = {
      h: rec.h,
      clock: localClock(rec.h),
      hour: localHour(rec.h),
      id: track.id,
      route: veh,
      trip: rec.trip,
      cls,
      mechanism,
      from: oldPath.id,
      to: newPath.id,
      fromRoute: oldPath.route,
      toRoute: newPath.route,
      fromDir: oldPath.direction,
      toDir: newPath.direction,
      fromSynthetic: isSynthetic(oldIdx),
      toSynthetic: isSynthetic(newIdx),
      fromS: Math.round(prev.s),
      toS: Math.round(rec.s),
      prior: priorIdx !== null ? paths[priorIdx].id : null,
      oldWasPrior,
      newIsPrior,
      edge: rec.edge,
      poolSize: pool.length,
      ownPoolSize: ownPool.length,
      poolIds: pool.map((p) => paths[p].id),
      priorInPool,
      oldInPool,
      oldResidualNow: r1(oldNow.d),
      oldResidualVia: oldNow.via,
      oldMinD: r1(oldMinD),
      newResidual: r1(rec.res),
      newAtPrevFixD: r1(newAtPrev),
      priorMinD: r1(priorMinD),
      prevOff: prev.off,
      prevAg: prev.ag,
      againstDeg,
      oldFolds,
      groundM: Math.round(groundM),
      dtSec: motion.dtSec,
      series,
      excursionS,
      planGapM: planGapM !== null ? Math.round(planGapM) : null,
      held: rec.held,
      heldBefore: prev.held,
      inBox: rec.inBox,
      lon: rec.lon,
      lat: rec.lat,
      nearestStop: near ? near.stop.name : null,
      nearestStopId: near ? near.stop.id : null,
      nearestStopM: near ? Math.round(near.d) : null,
      nearestTerminal: terminal ? terminal.stop.name : null,
      nearestTerminalM: terminal ? Math.round(terminal.d) : null,
      atTerminus: terminal ? terminal.d <= TERMINAL_NEAR_M : false,
      divertedBefore: prev.diverted,
      divertedAfter: rec.diverted,
    };
    if (terminal) terminalDist.set(event, terminal.d);
    return event;
  }

  /**
   * One tick: `state` as runTick returned it, at frame header `headerSec`;
   * `payload` what that tick published (null skips the silence rows, `held`
   * and the client); `tickMs` the wall time runTick took, for the tickMs row.
   */
  function observe(state: TwinState, headerSec: number, payload: FeedPayload | null, tickMs?: number): void {
    if (finished) throw new Error('grade-branches: observe() after report()');
    const frameNo = ticks++;
    if (firstHeader === null) firstHeader = headerSec;
    lastHeader = headerSec;
    if (tickMs !== undefined) tickDurations.push(tickMs);
    const nowMs = (headerSec + REPLAY_NOW_CUSHION_S) * 1000;
    const items = payload?.items ?? [];

    const dt = prevHeader === null ? 0 : Math.min(60, Math.max(0, headerSec - prevHeader));
    prevHeader = headerSec;
    const hour = localHour(headerSec);
    const windowTick = inWindow(headerSec);

    // `held` as published this tick, per vehicle.
    const heldById = new Map<string, boolean>();
    for (const item of items) {
      if (!item.id.startsWith('vehicle:')) continue;
      heldById.set(item.id.slice('vehicle:'.length), item.data?.['held'] === true);
    }

    // --- silence (WP0 step 7c), read from the published payload: a vehicle
    // item whose `at` (its last fix) is older than EVICT_S at the tick's own
    // clock, and a silent tram (last fix older than SILENCE_HOLD_S) whose
    // published plan at header + 60 s lies beyond its next served stop.
    const nowSec = Math.floor(nowMs / 1000);
    let olderThisFrame = 0;
    for (const item of items) {
      if (!item.id.startsWith('vehicle:')) continue;
      const vid = item.id.slice('vehicle:'.length);
      const atSec = Date.parse(item.at ?? '') / 1000;
      if (!Number.isFinite(atSec)) continue;
      const ageS = nowSec - atSec;
      const track: Track | undefined = state.tracks[vid];
      const isTram = track?.kind === 'tram';
      silence.items++;
      silence.ageHist[ageBucket(ageS)]++;
      if (isTram) {
        silence.tramItems++;
        silence.tramAgeHist[ageBucket(ageS)]++;
      }
      if (atSec < nowSec - EVICT_S) {
        silence.olderThanEvict++;
        if (isTram) silence.olderThanEvictTram++;
        olderThisFrame++;
        if (silence.olderThanEvictSamples.length < 10) silence.olderThanEvictSamples.push({ clock: localClock(headerSec), id: vid, route: item.data?.['routeId'] ?? null, ageS });
      }
      if (!track || !isTram || ageS <= SILENCE_HOLD_S) continue;
      silence.silentTramItems++;
      const motion = item.motion;
      const wireKnots = motion !== undefined && 'plan' in motion ? motion.plan : undefined;
      const motionPath = motion !== undefined && 'path' in motion ? motion.path : undefined;
      const pathIdx = track.plan?.on === 'path' && motionPath !== undefined ? pathIdToIdx.get(motionPath) : undefined;
      if (pathIdx === undefined || motionPath === undefined || !Array.isArray(wireKnots) || wireKnots.length === 0 || wireKnots[0].length !== 2) {
        silence.silentTramOffPath++;
        continue;
      }
      // A two-number knot is a path knot (wire.ts); evalPathPlan reads either tuple.
      const knots = wireKnots as unknown as readonly PathKnot[];
      silence.silentTramOnPath++;
      // The plan starts at the anchor arc (buildPlan's first knot, at the last
      // fix). Its next stop is the served platform whose zone it stands in
      // (held at that stop, or where it stands past the stop point), else the
      // first served platform ahead, else the path's end (a terminus holds).
      const sRef = knots[0][1];
      const { limitS, here, ahead } = holdOf(pathIdx, sRef);
      const sAhead = evalPathPlan(knots, SILENCE_LOOKAHEAD_S);
      if (knots[knots.length - 1][1] > limitS + PAST_STOP_SLACK_M) silence.pastAtHorizon++;
      if (sAhead > limitS + PAST_STOP_SLACK_M) {
        const stop = here ?? ahead;
        silence.past.push({ h: headerSec, id: vid, route: track.routeId, path: motionPath, silenceS: ageS, nextStop: stop ? stop.stop.name : '(path end)', nextStopIs: here !== null ? 'here' : ahead !== null ? 'ahead' : 'path end', sRef: Math.round(sRef), limitS: Math.round(limitS), sAt60: Math.round(sAhead), overM: r1(sAhead - limitS) });
      }
    }
    if (olderThisFrame > 0) silence.olderThanEvictFrames++;

    // --- observe every tram track
    let boxVehicles = 0;
    for (const track of Object.values(state.tracks)) {
      if (track.kind !== 'tram') continue;
      // The artefact guard (as scripts/replay-core.ts counts it, per tram track and tick):
      // a trip id the committed index cannot join means the frames outlived the artefact.
      if (track.tripId !== null) {
        tripObservations++;
        if (!engine.index.tripsById.has(track.tripId)) unknownTripObservations++;
      }
      const fix = lastFix(track);
      if (!fix) continue;
      let gen = generation.get(track);
      if (gen === undefined) {
        gen = nextGeneration++;
        generation.set(track, gen);
      }
      tramVehicles.add(track.id);
      if (track.tripId !== null && !tramTripsSeen.has(track.tripId)) {
        tramTripsSeen.add(track.tripId);
        const rec = engine.index.tripsById.get(track.tripId);
        inc(servicesSeen, rec ? rec.service : '?');
      }
      tramTrackedSec += dt;
      inc(tramSecByRoute, track.routeId, dt);
      inc(tramSecByHour, hour, dt);
      if (windowTick) windowSec += dt;
      const inBox = inTeaserBox(fix.lon, fix.lat);
      if (inBox) {
        boxSec += dt;
        boxVehicles++;
        if (windowTick) boxWindowSec += dt;
      }

      const planOnPath = track.plan && track.plan.on === 'path' ? track.plan : null;
      const rec: TickRecord = {
        h: headerSec,
        gen,
        trip: track.tripId,
        route: track.routeId,
        fixAt: fix.atSec,
        p: { x: fix.x, y: fix.y },
        lon: fix.lon,
        lat: fix.lat,
        inBox,
        path: track.match.pathIdx,
        edge: track.match.edge,
        s: track.match.s,
        res: track.match.residual,
        off: track.offPathCount,
        ag: track.againstCount ?? 0,
        prior: track.priorPath,
        speed: track.speed,
        planPath: planOnPath ? planOnPath.pathIdx : null,
        planKnots: planOnPath ? planOnPath.knots : null,
        anchor: planOnPath ? evalPathPlan(planOnPath.knots, 0) : null,
        held: heldById.get(track.id) ?? false,
        fresh: false,
        diverted: (track as { diverted?: true }).diverted === true,
      };
      const h = history.get(track.id) ?? [];
      const fh = freshHistory.get(track.id) ?? [];
      const prev = h.length > 0 ? h[h.length - 1] : null;
      const fresh = prev === null || prev.fixAt !== rec.fixAt || prev.gen !== rec.gen;
      rec.fresh = fresh;
      if (fresh) tramFreshFixes++;

      // Unplaced (WP0 step 7b): on no path, yet not off the graph.
      if (track.offGraph) unplaced.offGraphSec += dt;
      if (track.match.pathIdx === null && !track.offGraph) {
        unplaced.sec += dt;
        if (track.match.edge !== null) unplaced.withEdgeSec += dt;
        else unplaced.noEdgeSec += dt;
        if (fresh) unplaced.fresh++;
        inc(unplacedSecByRoute, track.routeId, dt);
        const unplacedReason = (track as { unplacedReason?: string }).unplacedReason ?? 'unknown';
        inc(unplacedSecByReason, unplacedReason, dt);
        let ep = unplacedOpen.get(track.id);
        if (ep && ep.gen !== gen) {
          closeUnplaced(track.id);
          ep = undefined;
        }
        if (!ep) {
          ep = { gen, startH: headerSec, route: track.routeId, trip: track.tripId, prior: rec.prior !== null ? paths[rec.prior].id : null, reason: unplacedReason, startP: rec.p, lastP: rec.p, sec: 0, ticks: 0, fresh: 0, withEdgeTicks: 0, maxDistFromStart: 0 };
          unplacedOpen.set(track.id, ep);
        }
        ep.sec += dt;
        ep.ticks++;
        if (fresh) ep.fresh++;
        if (track.match.edge !== null) ep.withEdgeTicks++;
        ep.maxDistFromStart = Math.max(ep.maxDistFromStart, dist(ep.startP, rec.p));
        ep.lastP = rec.p;
      } else if (unplacedOpen.has(track.id)) closeUnplaced(track.id);

      // Silence gaps (WP0 step 7c): fresh fix to fresh fix of one vehicle,
      // across an eviction too (keyed by vehicle id, not by Track object).
      const lastSeen = lastFixByVehicle.get(track.id);
      if (!lastSeen || fix.atSec > lastSeen.atSec) {
        if (lastSeen && fix.atSec - lastSeen.atSec > GAP_MIN_S) {
          const terminal = nearestStop(lastSeen.p, (s) => s.terminal);
          silenceGaps.push({ gapS: fix.atSec - lastSeen.atSec, sameTrip: lastSeen.trip === track.tripId, movedM: dist(lastSeen.p, rec.p), terminalM: terminal ? terminal.d : Number.POSITIVE_INFINITY });
        }
        lastFixByVehicle.set(track.id, { atSec: fix.atSec, trip: track.tripId, p: rec.p });
      }

      // Row S (WP6 step 2, redefined by D1 decision 3 on 23 Sep): per silent
      // episode, how far the published anchor went BEYOND the hold of the
      // tick (holdOf: the next stop T8 holds a silent tram at) once the newest
      // fresh fix was older than GHOST_SILENCE_S, and beside it S-glide, how
      // far the anchor travelled while silent up to that hold, from the anchor
      // published at the fix tick. Context: did it pass the stop ZET's
      // TripUpdate named as next at that tick?
      const watch = ghostWatch.get(track.id);
      if (fresh || !watch || watch.gen !== gen) {
        if (watch) closeGhost(track.id);
        const nextStopId = rec.trip !== null ? state.tripUpdates[rec.trip]?.stopId ?? null : null;
        const sStop = nextStopId !== null && rec.planPath !== null ? net.stopsOnPath(rec.planPath).find((e) => e.stop.id === nextStopId)?.s ?? null : null;
        ghostWatch.set(track.id, { gen, fixAt: rec.fixAt, route: rec.route, trip: rec.trip, path: rec.planPath, anchor0: rec.anchor, nextStopId, sStop, openedH: null, maxSilenceS: 0, maxBeyond: null, holdStop: null, holdS: null, maxGlide: null, passed: false, pathChanged: false });
      } else {
        const silentS = nowSec - rec.fixAt;
        if (silentS > GHOST_SILENCE_S) {
          if (watch.openedH === null) watch.openedH = headerSec;
          watch.maxSilenceS = Math.max(watch.maxSilenceS, silentS);
          if (watch.path !== null && rec.planPath === watch.path && rec.planKnots !== null && rec.anchor !== null && watch.anchor0 !== null) {
            const hold = holdOf(rec.planPath, rec.planKnots[0][1]);
            const beyond = rec.anchor - hold.limitS;
            if (watch.maxBeyond === null || beyond > watch.maxBeyond) {
              watch.maxBeyond = beyond;
              const stop = hold.here ?? hold.ahead;
              watch.holdStop = stop ? stop.stop.name : '(path end)';
              watch.holdS = hold.limitS;
            }
            const glide = Math.min(rec.anchor, hold.limitS) - watch.anchor0;
            if (watch.maxGlide === null || glide > watch.maxGlide) watch.maxGlide = glide;
            if (watch.sStop !== null && watch.anchor0 <= watch.sStop + PAST_STOP_SLACK_M && rec.anchor > watch.sStop + PAST_STOP_SLACK_M) watch.passed = true;
          } else if (watch.path !== null) watch.pathChanged = true;
        }
      }

      if (rec.prior !== null && rec.trip !== null) {
        const pid = paths[rec.prior].id;
        let set = tripsByPriorPath.get(pid);
        if (!set) tripsByPriorPath.set(pid, (set = new Set()));
        set.add(rec.trip);
      }
      // On a path other than the trip's own: how long, and did the own path fit meanwhile?
      if (rec.path !== null && rec.prior !== null) {
        if (rec.path === rec.prior) onPriorSec += dt;
        else {
          const bucket = paths[rec.path].route !== rec.route ? foreign : variant;
          bucket.sec += dt;
          if (rec.trip !== null) bucket.tripsAffected.add(rec.trip);
          if (fresh) {
            bucket.fresh++;
            if (net.projectOntoPath(rec.prior, rec.p).d <= NEAR_M) bucket.freshPriorNear++;
          }
        }
      }

      // Diversions (rail round 2): an episode per run of ticks with the flag;
      // its hops are counted as their events are described below.
      let divertedEp = divertedOpen.get(track.id);
      if (divertedEp && divertedEp.gen !== gen) {
        closeDiverted(track.id, 'evicted');
        divertedEp = undefined;
      }
      if (rec.diverted) {
        if (!divertedEp) {
          divertedEp = { gen, startH: headerSec, lastH: headerSec, route: track.routeId, trip: track.tripId, prior: rec.prior !== null ? paths[rec.prior].id : null, startP: rec.p, lastP: rec.p, sec: 0, ticks: 0, fresh: 0, hops: 0, maxDistFromStart: 0 };
          divertedOpen.set(track.id, divertedEp);
        }
        divertedEp.sec += dt;
        divertedEp.ticks++;
        if (fresh) divertedEp.fresh++;
        divertedEp.lastP = rec.p;
        divertedEp.lastH = headerSec;
        divertedEp.maxDistFromStart = Math.max(divertedEp.maxDistFromStart, dist(divertedEp.startP, rec.p));
        divertedSec += dt;
        inc(divertedSecByRoute, track.routeId, dt);
      }

      if (prev && prev.gen === gen) {
        if (prev.trip !== rec.trip) tripChanges++;
        if (prev.trip === rec.trip && prev.prior !== rec.prior) priorChanges.push({ h: headerSec, id: track.id, trip: rec.trip, from: prev.prior, to: rec.prior });
        if (fresh && prev.path !== null && prev.path === rec.path && prev.trip === rec.trip) {
          const ds = rec.s - prev.s;
          // Arc jump on one path between two consecutive fixes (the fix skipping a drawn detour, or a terminus fold).
          if (Math.abs(ds) >= ARC_JUMP_M) {
            const near = nearestStop(rec.p);
            arcJumps.push({ h: headerSec, clock: localClock(headerSec), id: track.id, route: rec.route, trip: rec.trip, path: paths[rec.path].id, fromS: Math.round(prev.s), toS: Math.round(rec.s), ds: Math.round(ds), dtSec: rec.fixAt - prev.fixAt, groundM: Math.round(dist(prev.p, rec.p)), nearestStop: near ? near.stop.name : null, nearestStopM: near ? Math.round(near.d) : null });
          }
          // Backward step: the matched arc receded (the tram driving against the path it is read on).
          if (ds < -BACKWARD_STEP_M && Math.abs(ds) < ARC_JUMP_M) {
            backward.steps++;
            backward.metres += -ds;
            let run = backwardRun.get(track.id);
            if (!run || run.path !== rec.path || run.trip !== rec.trip) {
              closeBackwardRun(track.id);
              run = { startH: prev.h, startFix: prev.fixAt, startP: prev.p, path: rec.path, trip: rec.trip, route: rec.route, prior: rec.prior, steps: 0, metres: 0 };
              backwardRun.set(track.id, run);
            }
            run.steps++;
            run.metres += -ds;
            run.endFix = rec.fixAt;
            run.endP = rec.p;
          } else if (backwardRun.has(track.id)) closeBackwardRun(track.id);
        } else if (fresh && backwardRun.has(track.id)) closeBackwardRun(track.id);
        // The event: matched path changed, trip unchanged, both paths real.
        if (prev.trip === rec.trip && prev.path !== null && rec.path !== null && prev.path !== rec.path) {
          const event = describeEvent(track, rec, prev, fh, state);
          events.push(event);
          if (event.cls === 'diversion-hop') {
            const ep = divertedOpen.get(track.id);
            if (ep) ep.hops++;
          }
        }
      } else if (prev && prev.gen !== gen) {
        h.length = 0;
        fh.length = 0;
        closeBackwardRun(track.id);
      }
      if (!rec.diverted && divertedOpen.has(track.id)) {
        const endedBy = prev && prev.trip !== rec.trip ? 'trip-change' : rec.path !== null && rec.path === rec.prior ? 'return' : rec.path !== null && isLoopId(paths[rec.path].id) ? 'loop' : 'other';
        closeDiverted(track.id, endedBy);
      }
      h.push(rec);
      if (h.length > 6) h.splice(0, h.length - 6);
      history.set(track.id, h);
      if (fresh) {
        fh.push(rec);
        if (fh.length > 5) fh.splice(0, fh.length - 5);
        freshHistory.set(track.id, fh);
      }

      // Glavni kolodvor detour paths: per-trip trace while the vehicle's prior is one of them.
      if (rec.prior !== null && GK_PATH_IDS.includes(paths[rec.prior].id) && rec.trip !== null) {
        const g = gk[paths[rec.prior].id];
        let t = g.trips.get(rec.trip);
        if (!t) {
          t = { id: track.id, ticks: 0, fresh: 0, onPath: 0, offPath: 0, maxDs: 0, maxDsAt: null, inLoopInterior: 0, nearLoop: 0, maxPlanAhead: 0, minS: Infinity, maxS: -Infinity };
          g.trips.set(rec.trip, t);
        }
        t.ticks++;
        if (fresh) t.fresh++;
        if (rec.path === rec.prior) {
          t.onPath++;
          t.minS = Math.min(t.minS, rec.s);
          t.maxS = Math.max(t.maxS, rec.s);
          if (g.loop) {
            const band = rec.s >= g.loop.sFrom - 300 && rec.s <= g.loop.sTo + 300;
            if (band) t.nearLoop++;
            if (rec.s > g.loop.sFrom + 50 && rec.s < g.loop.sTo - 50) t.inLoopInterior++;
            if (prev && prev.gen === gen && prev.path === rec.path && fresh) {
              const ds = rec.s - prev.s;
              if (Math.abs(ds) > Math.abs(t.maxDs) && (band || (prev.s >= g.loop.sFrom - 300 && prev.s <= g.loop.sTo + 300))) {
                t.maxDs = ds;
                t.maxDsAt = localClock(headerSec);
              }
            }
            if (prev && prev.gen === gen && prev.planKnots && prev.planPath === rec.path && band) {
              const gap = dist(net.toPathPoint(rec.path, evalPathPlan(prev.planKnots, headerSec - prev.h)), rec.p);
              if (gap > t.maxPlanAhead) t.maxPlanAhead = gap;
            }
          }
        } else t.offPath++;
      }
    }
    boxVehicleTicks += boxVehicles;
    boxTicks++;
    for (const id of [...history.keys()]) if (!state.tracks[id]) history.delete(id);
    for (const id of [...freshHistory.keys()]) if (!state.tracks[id]) freshHistory.delete(id);
    for (const id of [...backwardRun.keys()]) if (!state.tracks[id]) closeBackwardRun(id);
    for (const id of [...unplacedOpen.keys()]) if (!state.tracks[id]) closeUnplaced(id);
    for (const id of [...ghostWatch.keys()]) if (!state.tracks[id]) closeGhost(id);

    // --- the client, as scripts/replay-core.ts drives it, plus a pre/post step around each poll
    if (payload !== null) {
      const landedMs = (headerSec + CLIENT_POLL_LANDING_S) * 1000;
      if (frameMs !== null) {
        if (nextFrameMs === null) nextFrameMs = landedMs;
        else if (landedMs - nextFrameMs > CLIENT_MAX_GAP_S * 1000) nextFrameMs = landedMs - CLIENT_MAX_GAP_S * 1000;
        while (nextFrameMs < landedMs) {
          model.step(nextFrameMs);
          clientFrames++;
          nextFrameMs += frameMs;
        }
      }
      const before = new Map<string, { p: XY; path: number | undefined; s: number | undefined; trip: string | null; holding: boolean; held: boolean }>();
      for (const d of model.step(landedMs)) if (d.type === 0) before.set(d.id, { p: d.p, path: d.path, s: d.s, trip: d.tripId ?? null, holding: d.holding === true, held: d.held === true });
      clientFrames++;
      model.update(vehicleFixes(snapshotFor(payload, landedMs), landedMs), landedMs);
      clientPolls++;
      for (const d of model.step(landedMs + 1)) {
        if (d.type !== 0) continue;
        const b = before.get(d.id);
        if (!b) continue;
        const jump = dist(b.p, d.p);
        const snapped = d.lastSnapAt === landedMs;
        if (snapped || jump > 25) {
          const near = nearestStop(d.p);
          const from = b.path !== undefined ? paths[b.path]?.id ?? null : null;
          const to = d.path !== undefined ? paths[d.path]?.id ?? null : null;
          const mapped = b.path !== undefined && d.path !== undefined && b.s !== undefined ? mapArc(paths[b.path], b.s, paths[d.path]) : null;
          const [lon, lat] = toLonLat(d.p);
          reseeds.push({
            h: headerSec,
            clock: localClock(headerSec),
            id: d.id,
            route: d.routeId ?? null,
            from,
            to,
            kind: from !== null && to !== null ? 'path->path' : from === null && to !== null ? 'free->path' : from !== null && to === null ? 'path->free' : 'free->free',
            sameTrip: b.trip !== null && (d.tripId ?? null) === b.trip,
            snapped,
            jumpM: r1(jump),
            sBefore: b.s !== undefined ? Math.round(b.s) : null,
            sAfter: d.s !== undefined ? Math.round(d.s) : null,
            mappedS: mapped !== null ? Math.round(mapped) : null,
            holdingBefore: b.holding,
            heldBefore: b.held,
            nearestStop: near ? near.stop.name : null,
            inBox: inTeaserBox(lon, lat),
          });
        }
      }
      clientFrames++;
    }
    if (frameNo % 500 === 0) log(`  tick ${frameNo}/${options.frameCount ?? '?'} ${localClock(headerSec)} tracks ${Object.keys(state.tracks).length} events ${events.length} reseeds ${reseeds.length}`);
  }

  function report() {
    if (!finished) {
      for (const id of [...backwardRun.keys()]) closeBackwardRun(id);
      for (const id of [...unplacedOpen.keys()]) closeUnplaced(id);
      for (const id of [...divertedOpen.keys()]) closeDiverted(id, 'open');
      for (const id of [...ghostWatch.keys()]) closeGhost(id);
      finished = true;
    }

    // ---- post-passes over the events ---------------------------------------------
    // Reverts: the next path change of the same vehicle and trip going straight back.
    const byVehicle = new Map<string, number[]>();
    events.forEach((e, i) => {
      const list = byVehicle.get(e.id) ?? [];
      list.push(i);
      byVehicle.set(e.id, list);
    });
    for (const list of byVehicle.values()) {
      for (let k = 0; k + 1 < list.length; k++) {
        const a = events[list[k]];
        const b = events[list[k + 1]];
        if (a.trip === b.trip && b.to === a.from) a.revertedInS = b.h - a.h;
      }
      // Onto another route -> back: how long and how far the tram rode the foreign path.
      for (let k = 0; k < list.length; k++) {
        const back = events[list[k]];
        if (back.cls !== 'back-to-own-route') continue;
        for (let j = k - 1; j >= 0; j--) {
          const onto = events[list[j]];
          if (onto.trip !== back.trip) break;
          if (onto.cls === 'onto-other-route') {
            back.foreignDurationS = back.h - onto.h;
            back.foreignGroundM = Math.round(dist(toPlane(onto.lon, onto.lat), toPlane(back.lon, back.lat)));
            back.foreignFrom = `${onto.nearestStop} -> ${back.nearestStop}`;
            back.foreignPath = onto.to;
            break;
          }
        }
      }
    }

    // ---- aggregates ------------------------------------------------------------
    const vehicleHours = tramTrackedSec / 3600;
    const per100 = (n: number, vh = vehicleHours): number | null => (vh > 0 ? r1((100 * n) / vh) : null);
    const byClass = countBy(events, (e) => e.cls);
    const byMechanism = countBy(events, (e) => e.mechanism);
    const byClassMech = countBy(events, (e) => `${e.cls} / ${e.mechanism}`);
    const byRoute = new Map<string, number>();
    const byHour = new Map<number, number>();
    const byStop = new Map<string, number>();
    for (const e of events) {
      inc(byRoute, e.route);
      inc(byHour, e.hour);
      if (e.nearestStop) inc(byStop, e.nearestStop);
    }
    const routeRows = [...new Set([...byRoute.keys(), ...tramSecByRoute.keys()])]
      .map((r) => {
        const vh = (tramSecByRoute.get(r) ?? 0) / 3600;
        const n = byRoute.get(r) ?? 0;
        return { route: r, events: n, vehicleHours: r1(vh), per100vh: per100(n, vh) };
      })
      .sort((a, b) => b.events - a.events);
    const hourRows = [...Array(24).keys()].map((hr) => {
      const vh = (tramSecByHour.get(hr) ?? 0) / 3600;
      const n = byHour.get(hr) ?? 0;
      return { hour: hr, events: n, vehicleHours: r1(vh), per100vh: per100(n, vh) };
    });
    const hotSpots = sortedEntries(byStop, 15).map(([name, n]) => {
      const here = events.filter((e) => e.nearestStop === name);
      return {
        stop: name,
        events: n,
        classes: Object.fromEntries(countBy(here, (e) => e.cls)),
        topPairs: countBy(here, (e) => `${e.from} -> ${e.to} [${e.mechanism}]`, 4),
        terminalM: percentile(here.map((e) => e.nearestTerminalM), 0.5),
        inBox: here[0].inBox,
        lon: here[0].lon,
        lat: here[0].lat,
      };
    });

    const revertShare = (list: readonly BranchEvent[], within: number): number | null => (list.length > 0 ? r1((100 * list.filter((e) => e.revertedInS !== undefined && e.revertedInS <= within).length) / list.length) : null);
    const reverts = {
      all: { n: events.length, within60s: revertShare(events, 60), within120s: revertShare(events, 120), within300s: revertShare(events, 300) },
      byMechanism: Object.fromEntries([...byMechanism].map(([m]) => [m, { within120s: revertShare(events.filter((e) => e.mechanism === m), 120), within300s: revertShare(events.filter((e) => e.mechanism === m), 300) }])),
      byClass: Object.fromEntries([...byClass].map(([c]) => [c, { within120s: revertShare(events.filter((e) => e.cls === c), 120), within300s: revertShare(events.filter((e) => e.cls === c), 300) }])),
    };

    const flips = events.filter((e) => e.cls === 'direction-flip');
    const d4 = events.filter((e) => e.mechanism.startsWith('turnaround'));
    // The bands on unrounded metres (decision 35's boundary, as decision 16's radius): 300.4 m from a terminal prints as 300 and is beyond 300 m.
    const termM = (e: BranchEvent): number => terminalDist.get(e) ?? Number(e.nearestTerminalM);
    const termHist = (list: readonly BranchEvent[]) => ({
      le150: list.filter((e) => termM(e) <= 150).length,
      le300: list.filter((e) => termM(e) > 150 && termM(e) <= 300).length,
      le600: list.filter((e) => termM(e) > 300 && termM(e) <= 600).length,
      gt600: list.filter((e) => termM(e) > 600).length,
    });
    const d4Mid = d4.filter((e) => !e.atTerminus);
    const flipReport = {
      total: flips.length,
      atTerminus: flips.filter((e) => e.atTerminus).length,
      midNetwork: flips.filter((e) => !e.atTerminus).length,
      terminalDistanceHist: termHist(flips),
      byMechanism: Object.fromEntries(countBy(flips, (e) => e.mechanism)),
      midNetworkByMechanism: Object.fromEntries(countBy(flips.filter((e) => !e.atTerminus), (e) => e.mechanism)),
      midNetworkTopStops: countBy(flips.filter((e) => !e.atTerminus), (e) => e.nearestStop ?? '?', 15),
      d4: {
        total: d4.length,
        sameRoute: d4.filter((e) => e.mechanism === 'turnaround').length,
        crossRoute: d4.filter((e) => e.mechanism === 'turnaround-cross-route').length,
        atTerminus: d4.length - d4Mid.length,
        midNetwork: d4Mid.length,
        terminalDistanceHist: termHist(d4),
        midNetworkTerminalM: { p50: percentile(d4Mid.map((e) => e.nearestTerminalM), 0.5), max: d4Mid.length ? Math.max(...d4Mid.map((e) => Number(e.nearestTerminalM))) : null },
        midNetworkTopStops: countBy(d4Mid, (e) => e.nearestStop ?? '?', 12),
        midNetworkTopPairs: countBy(d4Mid, (e) => `${e.from} -> ${e.to} @ ${e.nearestStop}`, 12),
        midNetworkAgainstDeg: { p50: percentile(d4Mid.map((e) => e.againstDeg).filter((x) => x !== null), 0.5), p95: percentile(d4Mid.map((e) => e.againstDeg).filter((x) => x !== null), 0.95) },
        midNetworkOldFolds: Object.fromEntries(countBy(d4Mid, (e) => e.oldFolds)),
        midNetworkRevertedWithin120s: d4Mid.filter((e) => e.revertedInS !== undefined && e.revertedInS <= 120).length,
        midNetworkRevertedWithin300s: d4Mid.filter((e) => e.revertedInS !== undefined && e.revertedInS <= 300).length,
        midNetworkOldWasPrior: d4Mid.filter((e) => e.oldWasPrior).length,
      },
    };

    const rd = events.filter((e) => e.mechanism.startsWith('off-path-rederive'));
    const k1 = (e: BranchEvent) => e.series[e.series.length - 1];
    const k2 = (e: BranchEvent) => (e.series.length >= 2 ? e.series[e.series.length - 2] : null);
    const rederive = {
      n: rd.length,
      k1OffPath: rd.filter((e) => k1(e) && k1(e).res > NEAR_M).length,
      exactlyOneTolerated: rd.filter((e) => k1(e) && k1(e).res > NEAR_M && k2(e) && k2(e)!.res <= NEAR_M).length,
      k2AlsoOff: rd.filter((e) => k1(e) && k1(e).res > NEAR_M && k2(e) && k2(e)!.res > NEAR_M).length,
      shortHistory: rd.filter((e) => e.series.length < 2).length,
      priorInPoolButOtherAdopted: rd.filter((e) => e.priorInPool && !e.newIsPrior).length,
      ownPoolEmpty: rd.filter((e) => e.ownPoolSize === 0).length,
      newIsPrior: rd.filter((e) => e.newIsPrior).length,
      oldWasPrior: rd.filter((e) => e.oldWasPrior).length,
      priorWithin60mNow: rd.filter((e) => e.priorMinD !== null && e.priorMinD <= NEAR_M).length,
      excursionS: { p50: percentile(rd.map((e) => e.excursionS), 0.5), p95: percentile(rd.map((e) => e.excursionS), 0.95), max: rd.length ? Math.max(...rd.map((e) => e.excursionS)) : null },
      planGapM: {
        p50: percentile(rd.map((e) => e.planGapM).filter((x) => x !== null), 0.5),
        p95: percentile(rd.map((e) => e.planGapM).filter((x) => x !== null), 0.95),
        max: rd.length ? Math.max(...rd.map((e) => e.planGapM ?? 0)) : null,
        over50: rd.filter((e) => Number(e.planGapM) > 50).length,
        over100: rd.filter((e) => Number(e.planGapM) > 100).length,
        over250: rd.filter((e) => Number(e.planGapM) > 250).length,
      },
      poolSize: { p50: percentile(rd.map((e) => (e.ownPoolSize > 0 ? e.ownPoolSize : e.poolSize)), 0.5), hist: Object.fromEntries(countBy(rd, (e) => (e.ownPoolSize > 0 ? e.ownPoolSize : e.poolSize))) },
      oldResidualNow: { p50: percentile(rd.map((e) => e.oldResidualNow), 0.5), p95: percentile(rd.map((e) => e.oldResidualNow), 0.95) },
      newPathAtPreviousFixD: { p50: percentile(rd.map((e) => e.newAtPrevFixD), 0.5), within60: rd.filter((e) => e.newAtPrevFixD <= NEAR_M).length },
      sameRouteVariant: (() => {
        const srv = rd.filter((e) => e.cls === 'same-route-variant');
        return {
          n: srv.length,
          shapeToSynthetic: srv.filter((e) => !e.fromSynthetic && e.toSynthetic).length,
          syntheticToShape: srv.filter((e) => e.fromSynthetic && !e.toSynthetic).length,
          shapeToShape: srv.filter((e) => !e.fromSynthetic && !e.toSynthetic).length,
          syntheticToSynthetic: srv.filter((e) => e.fromSynthetic && e.toSynthetic).length,
          oldWasPrior: srv.filter((e) => e.oldWasPrior).length,
          newIsPrior: srv.filter((e) => e.newIsPrior).length,
          priorInPoolButOtherAdopted: srv.filter((e) => e.priorInPool && !e.newIsPrior).length,
          oldInPool: srv.filter((e) => e.oldInPool).length,
          shapeToSyntheticTopStops: countBy(srv.filter((e) => !e.fromSynthetic && e.toSynthetic), (e) => e.nearestStop ?? '?', 10),
          shapeToSyntheticTopPairs: countBy(srv.filter((e) => !e.fromSynthetic && e.toSynthetic), (e) => `${e.from} -> ${e.to} @ ${e.nearestStop}`, 10),
          leavingPriorTopPairs: countBy(srv.filter((e) => e.oldWasPrior), (e) => `${e.from} -> ${e.to} @ ${e.nearestStop}`, 12),
        };
      })(),
    };

    const other = events.filter((e) => e.cls === 'onto-other-route');
    const backs = events.filter((e) => e.cls === 'back-to-own-route' && e.foreignDurationS !== undefined);
    const otherRoute = {
      onto: other.length,
      back: events.filter((e) => e.cls === 'back-to-own-route').length,
      ontoOwnPoolEmpty: other.filter((e) => e.ownPoolSize === 0).length,
      ontoPriorWithin60m: other.filter((e) => e.priorMinD !== null && e.priorMinD <= NEAR_M).length,
      ontoPriorMinDP50: percentile(other.map((e) => e.priorMinD).filter((x) => x !== null), 0.5),
      ontoByVehicleRouteToPath: countBy(other, (e) => `${e.route} -> ${e.to} (route ${e.toRoute})`, 20),
      ontoByStop: countBy(other, (e) => e.nearestStop ?? '?', 12),
      backByMechanism: Object.fromEntries(countBy(events.filter((e) => e.cls === 'back-to-own-route'), (e) => e.mechanism)),
      foreignDurationS: {
        n: backs.length,
        p50: percentile(backs.map((e) => e.foreignDurationS!), 0.5),
        p95: percentile(backs.map((e) => e.foreignDurationS!), 0.95),
        max: backs.length ? Math.max(...backs.map((e) => e.foreignDurationS!)) : null,
        over60: backs.filter((e) => e.foreignDurationS! > 60).length,
        over300: backs.filter((e) => e.foreignDurationS! > 300).length,
      },
      foreignGroundM: {
        p50: percentile(backs.map((e) => e.foreignGroundM!), 0.5),
        p95: percentile(backs.map((e) => e.foreignGroundM!), 0.95),
        max: backs.length ? Math.max(...backs.map((e) => e.foreignGroundM!)) : null,
        over500: backs.filter((e) => e.foreignGroundM! > 500).length,
        over2000: backs.filter((e) => e.foreignGroundM! > 2000).length,
      },
      longestForeignRides: [...backs].sort((a, b) => b.foreignGroundM! - a.foreignGroundM!).slice(0, 12).map((e) => ({ clock: e.clock, id: e.id, route: e.route, path: e.foreignPath!, durationS: e.foreignDurationS!, groundM: e.foreignGroundM!, from: e.foreignFrom!, backTo: e.to, mechanism: e.mechanism })),
      foreignRidesByPath: (() => {
        const m = new Map<string, { n: number; dur: number[]; ground: number[]; routes: Map<string, number>; from: Map<string, number> }>();
        for (const e of backs) {
          const x = m.get(e.foreignPath!) ?? { n: 0, dur: [], ground: [], routes: new Map<string, number>(), from: new Map<string, number>() };
          x.n++;
          x.dur.push(e.foreignDurationS!);
          x.ground.push(e.foreignGroundM!);
          inc(x.routes, e.route);
          inc(x.from, e.foreignFrom!);
          m.set(e.foreignPath!, x);
        }
        return [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12).map(([path, x]) => ({ path, rides: x.n, vehicleRoutes: Object.fromEntries(x.routes), durationP50: percentile(x.dur, 0.5), groundP50: percentile(x.ground, 0.5), groundMax: Math.max(...x.ground), topFrom: sortedEntries(x.from, 2) }));
      })(),
      ticks: { foreignVehicleHours: r1(foreign.sec / 3600), foreignFreshFixes: foreign.fresh, foreignFreshFixesWithPriorWithin60m: foreign.freshPriorNear, foreignTrips: foreign.tripsAffected.size, variantVehicleHours: r1(variant.sec / 3600), variantFreshFixes: variant.fresh, variantFreshFixesWithPriorWithin60m: variant.freshPriorNear, variantTrips: variant.tripsAffected.size, onPriorVehicleHours: r1(onPriorSec / 3600) },
    };

    const windowEvents = events.filter((e) => inWindow(e.h));
    // Decision 35: A' is A inside the box, so the box rows take A's exclusions;
  // the counts of every class stay beside them as eventsAllClasses.
  const windowBoxEventsAll = windowEvents.filter((e) => e.inBox);
  const windowBoxEvents = windowBoxEventsAll.filter(countsInA);
    const boxEventsAll = events.filter((e) => e.inBox);
  const boxEvents = boxEventsAll.filter(countsInA);
    const windowVh = windowSec / 3600;
    const boxVh = boxSec / 3600;
    const boxWindowVh = boxWindowSec / 3600;

    const snaps = reseeds.filter((r) => r.snapped);
    const jumps = snaps.map((r) => r.jumpM);
    const sameTripPP = snaps.filter((r) => r.sameTrip && r.kind === 'path->path');
    const clientReport = {
      polls: clientPolls,
      frames: clientFrames,
      frameHz: clientHz,
      reseeds: snaps.length,
      reseedsPer100vh: per100(snaps.length),
      jumpP50: percentile(jumps, 0.5),
      jumpP95: percentile(jumps, 0.95),
      jumpMax: jumps.length ? Math.max(...jumps) : null,
      over25: jumps.filter((j) => j > 25).length,
      over50: jumps.filter((j) => j > SNAP_M).length,
      over100: jumps.filter((j) => j > 100).length,
      over250: jumps.filter((j) => j > 250).length,
      over1000: jumps.filter((j) => j > 1000).length,
      nonSnapJumpsOver25: reseeds.filter((r) => !r.snapped).length,
      byKind: Object.fromEntries(countBy(snaps, (r) => `${r.kind}${r.sameTrip ? ' same trip' : ' trip changed'}`)),
      sameTripPathToPath: sameTripPP.length,
      sameTripPathToPathZero: sameTripPP.filter((r) => r.jumpM < 1).length,
      sameTripPathToPathOver50: sameTripPP.filter((r) => r.jumpM > SNAP_M).length,
      sameTripPathToPathOver250: sameTripPP.filter((r) => r.jumpM > 250).length,
      sameTripPathToPathOver1000: sameTripPP.filter((r) => r.jumpM > 1000).length,
      sameTripPathToPathJumpP50: percentile(sameTripPP.map((r) => r.jumpM), 0.5),
      sameTripPathToPathJumpP95: percentile(sameTripPP.map((r) => r.jumpM), 0.95),
      sameTripPathToPathMapped: sameTripPP.filter((r) => r.mappedS !== null).length,
      sameTripPathToPathMappedOver50: sameTripPP.filter((r) => r.mappedS !== null && r.jumpM > SNAP_M).length,
      sameTripPathToPathUnmappedOver50: sameTripPP.filter((r) => r.mappedS === null && r.jumpM > SNAP_M).length,
      sameTripPathToPathHoldingBefore: sameTripPP.filter((r) => r.holdingBefore).length,
      sameTripPathToPathOver250HoldingBefore: sameTripPP.filter((r) => r.jumpM > 250 && r.holdingBefore).length,
      inBoxSameTripOver50: sameTripPP.filter((r) => r.inBox && r.jumpM > SNAP_M).length,
      byRoute: Object.fromEntries(countBy(snaps, (r) => r.route ?? '?')),
      topStops: countBy(snaps.filter((r) => r.jumpM > SNAP_M), (r) => r.nearestStop ?? '?', 15),
      topPairsOver250: countBy(sameTripPP.filter((r) => r.jumpM > 250), (r) => `${r.from} -> ${r.to}`, 12),
      largest: [...snaps].sort((a, b) => b.jumpM - a.jumpM).slice(0, 15),
    };

    const gkReport: Record<string, unknown> = {};
    for (const [id, g] of Object.entries(gk)) {
      const trips = [...g.trips.values()];
      const eventsOff = events.filter((e) => e.from === id);
      const eventsOn = events.filter((e) => e.to === id);
      const loopStart = g.loop ? net.toPathPoint(g.idx, g.loop.sFrom) : null;
      let loopRadius: number | null = null;
      let loopMidStop: string | null = null;
      let loopEndStop: string | null = null;
      if (g.loop && loopStart) {
        loopRadius = 0;
        for (let s = g.loop.sFrom; s <= g.loop.sTo; s += 25) loopRadius = Math.max(loopRadius, dist(net.toPathPoint(g.idx, s), loopStart));
        loopMidStop = nearestStop(net.toPathPoint(g.idx, (g.loop.sFrom + g.loop.sTo) / 2))?.stop.name ?? null;
        loopEndStop = nearestStop(net.toPathPoint(g.idx, g.loop.sTo))?.stop.name ?? null;
      }
      const eventsNearLoop = loopStart ? eventsOff.filter((e) => dist(toPlane(e.lon, e.lat), loopStart) <= 400) : [];
      gkReport[id] = {
        pathIdx: g.idx,
        lenM: Math.round(g.len),
        edges: g.edges,
        sibling: g.sibling,
        siblingLenM: g.siblingLen !== null ? Math.round(g.siblingLen) : null,
        extraEdgesVsSibling: g.extraEdgesVsSibling,
        loop: g.loop && loopStart ? { edges: g.loop.edges, sFrom: Math.round(g.loop.sFrom), sTo: Math.round(g.loop.sTo), lenM: Math.round(g.loop.sTo - g.loop.sFrom), startNearestStop: nearestStop(loopStart)?.stop.name ?? null, midNearestStop: loopMidStop, endNearestStop: loopEndStop, radiusM: Math.round(loopRadius!), startToEndM: Math.round(dist(loopStart, net.toPathPoint(g.idx, g.loop.sTo))) } : null,
        tripsWithThisPrior: trips.length,
        tripsReachingLoopBand: trips.filter((t) => t.nearLoop > 0).length,
        tripsWithFixInLoopInterior: trips.filter((t) => t.inLoopInterior > 0).length,
        tripsArcJumpOver500: trips.filter((t) => Math.abs(t.maxDs) >= ARC_JUMP_M).length,
        tripsPlanGapOver200: trips.filter((t) => t.maxPlanAhead > 200).length,
        pathChangesOffThisPath: eventsOff.length,
        pathChangesOffNearLoop: eventsNearLoop.length,
        pathChangesOffByStopAndMechanism: countBy(eventsOff, (e) => `${e.nearestStop} [${e.mechanism} -> ${e.to}]`, 8),
        pathChangesOntoThisPath: eventsOn.length,
        pathChangesOntoByStopAndMechanism: countBy(eventsOn, (e) => `${e.nearestStop} [${e.mechanism} from ${e.from}]`, 8),
        arcJumpsOnPath: arcJumps.filter((j) => j.path === id).length,
      };
    }

    const first = firstHeader;
    const last = lastHeader;
    const runsSorted = [...backward.runs].sort((a, b) => b.metres - a.metres);

    // ---- loops, unplaced, silence (WP0 step 7) ----------------------------------
    const loopEvents = events.filter((e) => e.cls === 'loop-transition');
    const loopTouching = events.filter((e) => isLoopId(e.from) || isLoopId(e.to));
    // Every loop-touching event once: an own-route transition within LOOP_HANDOVER_TERMINUS_M of a terminal (loop-transition), a loop
    // of another route adopted or left (row B), or an own-route hand-over beyond that distance (a direction flip, rows A and E).
    const loopForeign = loopTouching.filter((e) => e.cls === 'onto-other-route' || e.cls === 'back-to-own-route');
    const loopFar = loopTouching.filter((e) => e.cls !== 'loop-transition' && e.cls !== 'onto-other-route' && e.cls !== 'back-to-own-route');
    const loopsReport = {
      prefix: LOOP_ID_PREFIX,
      loopPaths: paths.filter((p) => isLoopId(p.id)).length,
      // Own-route transitions onto or off a loop path: metric A excludes exactly these.
      events: loopEvents.length,
      onto: loopEvents.filter((e) => isLoopId(e.to) && !isLoopId(e.from)).length,
      off: loopEvents.filter((e) => isLoopId(e.from) && !isLoopId(e.to)).length,
      loopToLoop: loopEvents.filter((e) => isLoopId(e.from) && isLoopId(e.to)).length,
      // A loop path of ANOTHER route adopted or left: classed onto-other-route / back-to-own-route, so still in row B.
      foreignEvents: loopForeign.length,
      // An own-route hand-over onto or off a loop more than LOOP_HANDOVER_TERMINUS_M from every terminal: a direction flip, in rows A and E.
      farEvents: loopFar.length,
      byMechanism: Object.fromEntries(countBy(loopEvents, (e) => e.mechanism)),
      terminalDistanceHist: termHist(loopEvents),
      byStop: countBy(loopEvents, (e) => e.nearestStop ?? '?', 15),
      byPath: countBy(loopTouching, (e) => (isLoopId(e.to) ? e.to : e.from), 15),
      byRoute: Object.fromEntries(countBy(loopEvents, (e) => e.route)),
    };

    // ---- diversions (rail round 2) ------------------------------------------------
    const diversionHops = events.filter((e) => e.cls === 'diversion-hop');
    const divertedEpisodesByRoute = new Map<string, number>();
    const divertedHopsByRoute = new Map<string, number>();
    for (const e of diversions) inc(divertedEpisodesByRoute, e.route);
    for (const e of diversionHops) inc(divertedHopsByRoute, e.route);
    const diversionsReport = {
      definition: 'ticks with match.ts TramTrack.diverted (a tram on its line\'s rails off its own path mid-line, or on no rails with the reason diversion), per vehicle as episodes; a same-trip path change of such a tram that is not a D4 reversal and touches no loop is a diversion hop, out of rows A and E',
      // Own-route hops of a diverted tram: metric A excludes exactly these.
      events: diversionHops.length,
      startHops: diversionHops.filter((e) => !e.divertedBefore && e.divertedAfter).length,
      midHops: diversionHops.filter((e) => e.divertedBefore && e.divertedAfter).length,
      returnHops: diversionHops.filter((e) => e.divertedBefore && !e.divertedAfter).length,
      directionIdChanged: diversionHops.filter((e) => e.fromDir !== e.toDir).length,
      vehicleHours: r2(divertedSec / 3600),
      shareOfTramVehicleHours: tramTrackedSec > 0 ? Math.round((divertedSec / tramTrackedSec) * 1e6) / 1e6 : null,
      episodes: diversions.length,
      endedBy: Object.fromEntries(countBy(diversions, (e) => e.endedBy)),
      durationS: { p50: percentile(diversions.map((e) => e.durationS), 0.5), p95: percentile(diversions.map((e) => e.durationS), 0.95), max: maxOf(diversions.map((e) => e.durationS)) },
      hopsPerEpisode: { p50: percentile(diversions.map((e) => e.hops), 0.5), p95: percentile(diversions.map((e) => e.hops), 0.95), max: maxOf(diversions.map((e) => e.hops)) },
      groundM: { p50: percentile(diversions.map((e) => e.groundM), 0.5), p95: percentile(diversions.map((e) => e.groundM), 0.95) },
      byMechanism: Object.fromEntries(countBy(diversionHops, (e) => e.mechanism)),
      byRoute: [...new Set([...divertedSecByRoute.keys(), ...divertedHopsByRoute.keys()])]
        .map((route) => {
          const sec = divertedSecByRoute.get(route) ?? 0;
          const routeSec = tramSecByRoute.get(route) ?? 0;
          return { route, episodes: divertedEpisodesByRoute.get(route) ?? 0, hops: divertedHopsByRoute.get(route) ?? 0, vehicleHours: r2(sec / 3600), shareOfRouteVehicleHours: routeSec > 0 ? Math.round((sec / routeSec) * 1e4) / 1e4 : null };
        })
        .sort((a, b) => b.hops - a.hops || b.vehicleHours - a.vehicleHours || String(a.route).localeCompare(String(b.route))),
      byStop: countBy(diversionHops, (e) => e.nearestStop ?? '?', 15),
      byPair: countBy(diversionHops, (e) => `${e.from} -> ${e.to} @ ${e.nearestStop}`, 15),
      byVehicle: countBy(diversionHops, (e) => e.id, 12),
      longest: [...diversions].sort((a, b) => b.hops - a.hops || b.durationS - a.durationS).slice(0, 12),
      all: diversions,
    };

    const eps = unplaced.episodes;
    const epTerminal = eps.map((e) => e.terminalM).filter((x): x is number => x !== null);
    const unplacedByStop = new Map<string, { stop: string; episodes: number; sec: number; terminalM: number[] }>();
    for (const e of eps) {
      const key = e.stop ?? '?';
      const row = unplacedByStop.get(key) ?? { stop: key, episodes: 0, sec: 0, terminalM: [] };
      row.episodes++;
      row.sec += e.durationS;
      if (e.terminalM !== null) row.terminalM.push(e.terminalM);
      unplacedByStop.set(key, row);
    }
    const unplacedEpisodesByRoute = new Map<string, number>();
    for (const e of eps) inc(unplacedEpisodesByRoute, e.route);
    const unplacedByReason = Object.fromEntries(
      [...unplacedSecByReason.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([reason, sec]) => [reason, { vehicleHours: r2(sec / 3600), shareOfTramVehicleHours: tramTrackedSec > 0 ? Math.round((sec / tramTrackedSec) * 1e6) / 1e6 : null, episodes: eps.filter((e) => e.reason === reason).length }]),
    );
    const parkedEps = eps.filter((e) => e.parked);
    const parkedSec = parkedEps.reduce((sum, e) => sum + e.durationS, 0);
    const unplacedReport = {
      definition: 'tram track after the tick with match.pathIdx === null && !offGraph',
      vehicleHours: r2(unplaced.sec / 3600),
      // Row U (A10): the unplaced share without parked episodes (decision 16).
      shareOfTramVehicleHours: tramTrackedSec > 0 ? Math.round(((unplaced.sec - parkedSec) / tramTrackedSec) * 1e6) / 1e6 : null,
      // Every unplaced second, parked or not (the share before decision 16).
      shareOfTramVehicleHoursRaw: tramTrackedSec > 0 ? Math.round((unplaced.sec / tramTrackedSec) * 1e6) / 1e6 : null,
      parkedRule: `episode durationS >= ${PARKED_MIN_S} && maxDistFromStartM <= ${PARKED_RADIUS_M}, on unrounded metres`,
      parkedEpisodes: parkedEps.length,
      parkedVehicleHours: r2(parkedSec / 3600),
      withEdgeVehicleHours: r2(unplaced.withEdgeSec / 3600),
      noEdgeVehicleHours: r2(unplaced.noEdgeSec / 3600),
      offGraphVehicleHours: r2(unplaced.offGraphSec / 3600),
      freshFixes: unplaced.fresh,
      // Why (match.ts TramTrack.unplacedReason), every unplaced second counted, parked or not.
      byReason: unplacedByReason,
      episodes: eps.length,
      durationS: { p50: percentile(eps.map((e) => e.durationS), 0.5), p95: percentile(eps.map((e) => e.durationS), 0.95), max: maxOf(eps.map((e) => e.durationS)) },
      terminalM: { p50: percentile(epTerminal, 0.5), p95: percentile(epTerminal, 0.95) },
      terminalDistanceHist: { le150: epTerminal.filter((d) => d <= 150).length, le300: epTerminal.filter((d) => d > 150 && d <= 300).length, le600: epTerminal.filter((d) => d > 300 && d <= 600).length, gt600: epTerminal.filter((d) => d > 600).length, unknown: eps.length - epTerminal.length },
      groundM: { p50: percentile(eps.map((e) => e.groundM), 0.5), p95: percentile(eps.map((e) => e.groundM), 0.95) },
      byStop: [...unplacedByStop.values()]
        .sort((a, b) => b.sec - a.sec || b.episodes - a.episodes || a.stop.localeCompare(b.stop))
        .slice(0, 15)
        .map((x) => ({ stop: x.stop, episodes: x.episodes, vehicleHours: r2(x.sec / 3600), terminalM: percentile(x.terminalM, 0.5) })),
      byRoute: [...unplacedSecByRoute.entries()]
        .map(([route, sec]) => {
          const routeSec = tramSecByRoute.get(route) ?? 0;
          return { route, episodes: unplacedEpisodesByRoute.get(route) ?? 0, vehicleHours: r2(sec / 3600), shareOfRouteVehicleHours: routeSec > 0 ? Math.round((sec / routeSec) * 1e4) / 1e4 : null };
        })
        .sort((a, b) => b.vehicleHours - a.vehicleHours || String(a.route).localeCompare(String(b.route))),
      longest: [...eps].sort((a, b) => b.durationS - a.durationS).slice(0, 12),
    };

    const past = silence.past;
    const pastOver = past.map((x) => x.overM);
    const silenceBand = (lo: number, hi: number): number => past.filter((x) => x.silenceS > lo && x.silenceS <= hi).length;
    const gapBucket = (lo: number, hi: number) => {
      const sel = silenceGaps.filter((g) => g.gapS > lo && g.gapS <= hi);
      const same = sel.filter((g) => g.sameTrip);
      return { n: sel.length, sameTrip: same.length, tripChanged: sel.length - same.length, sameTripMovedLe50m: same.filter((g) => g.movedM <= 50).length, sameTripWithin150mOfTerminal: same.filter((g) => g.terminalM <= 150).length };
    };
    const moved120to180 = silenceGaps.filter((g) => g.sameTrip && g.gapS > 120 && g.gapS <= 180 && g.movedM > 150).map((g) => Math.round(g.movedM));
    const silenceReport = {
      evictS: EVICT_S,
      holdS: SILENCE_HOLD_S,
      lookaheadS: SILENCE_LOOKAHEAD_S,
      // Must be 0: vehicle items (any kind) published with a last fix older than EVICT_S (item-frames).
      publishedOlderThanEvict: silence.olderThanEvict,
      publishedOlderThanEvictTram: silence.olderThanEvictTram,
      publishedOlderThanEvictFrames: silence.olderThanEvictFrames,
      publishedOlderThanEvictSamples: silence.olderThanEvictSamples,
      // Must be 0: silent tram items on a rail path whose plan at header + lookaheadS lies past the next served stop (item-frames).
      extrapolatedPastNextStop: past.length,
      extrapolatedPastNextStopVehicles: new Set(past.map((x) => x.id)).size,
      extrapolatedPastNextStopAtHorizon: silence.pastAtHorizon,
      extrapolatedPastNextStopM: { p50: percentile(pastOver, 0.5), p95: percentile(pastOver, 0.95), max: maxOf(pastOver) },
      extrapolatedPastNextStopBySilenceS: { '30-60': silenceBand(30, 60), '60-120': silenceBand(60, 120), '120-180': silenceBand(120, 180), '180-300': silenceBand(180, 300), over300: silenceBand(300, Number.POSITIVE_INFINITY) },
      extrapolatedPastNextStopByStop: countBy(past, (x) => x.nextStop, 15),
      extrapolatedPastNextStopLargest: [...past].sort((a, b) => b.overM - a.overM).slice(0, 12).map((x) => ({ ...x, clock: localClock(x.h) })),
      silentTramItems: silence.silentTramItems,
      silentTramItemsOnPath: silence.silentTramOnPath,
      silentTramItemsOffPath: silence.silentTramOffPath,
      publishedItems: silence.items,
      publishedTramItems: silence.tramItems,
      publishedAgeHist: silence.ageHist,
      publishedTramAgeHist: silence.tramAgeHist,
      // Fresh-fix gaps of tram vehicles (the table of review.local/companion/plan/WP0/notes.md), independent of the engine.
      gaps: {
        minS: GAP_MIN_S,
        total: silenceGaps.length,
        overEvictS: silenceGaps.filter((g) => g.gapS > EVICT_S).length,
        hist: { '60-120': gapBucket(60, 120), '120-180': gapBucket(120, 180), '180-300': gapBucket(180, 300), over300: gapBucket(300, Number.POSITIVE_INFINITY) },
        sameTrip120to180MovedOver150m: { n: moved120to180.length, p50: percentile(moved120to180, 0.5), p95: percentile(moved120to180, 0.95) },
      },
    };

    // ---- rows S and I (WP6 step 2; only this port writes them) ------------------
    const ghostMeasured = ghostEpisodes.filter((e) => e.beyondHoldM !== null);
    const ghostBeyond = ghostMeasured.map((e) => e.beyondHoldM!);
    const ghostGlides = ghostMeasured.map((e) => e.glideM!);
    const ghostReport = {
      definition: `tram tracks whose newest fix is older than ${GHOST_SILENCE_S} s at the tick clock (header + ${REPLAY_NOW_CUSHION_S} s), on the path plan of that fix: per silent episode, row S = the largest distance the published anchor (the path plan at the header) lies beyond the tick's hold, the next stop a silent tram is held at (the served platform whose ${STOP_ZONE_M} m zone holds the plan's first knot, at the larger of the two arcs, else the first served platform ahead, else the path's end; within ${PAST_STOP_SLACK_M} m reads 0); S-glide = the largest advance past the anchor published at the fix tick, up to that hold (no target); past the next stop = the anchor crossed the stop ZET's TripUpdate named as next at the fix tick (context)`,
      silenceS: GHOST_SILENCE_S,
      episodes: ghostEpisodes.length,
      measured: ghostMeasured.length,
      offPath: ghostEpisodes.filter((e) => e.path === null).length,
      pathChanged: ghostEpisodes.filter((e) => e.pathChanged && e.beyondHoldM === null).length,
      // Row S (target: max <= 50 m): the anchor beyond the hold, per episode.
      beyondHoldM: { p50: percentile(ghostBeyond, 0.5), p95: percentile(ghostBeyond, 0.95), max: maxOf(ghostBeyond) },
      beyondHold: ghostBeyond.filter((m) => m > 0).length,
      over50m: ghostBeyond.filter((m) => m > 50).length,
      // S-glide, printed without a target: the glide to the hold while silent, which T8 allows.
      glideM: { p50: percentile(ghostGlides, 0.5), p95: percentile(ghostGlides, 0.95), max: maxOf(ghostGlides) },
      pastNextStop: ghostEpisodes.filter((e) => e.pastNextStop).length,
      withoutNextStop: ghostMeasured.filter((e) => e.nextStop === null).length,
      silenceHist: { '60-120': ghostEpisodes.filter((e) => e.silenceS <= 120).length, '120-180': ghostEpisodes.filter((e) => e.silenceS > 120 && e.silenceS <= 180).length, over180: ghostEpisodes.filter((e) => e.silenceS > 180).length },
      byRoute: Object.fromEntries(countBy(ghostMeasured.filter((e) => e.beyondHoldM! > 0), (e) => e.route)),
      largestBeyondHold: ghostMeasured.filter((e) => e.beyondHoldM! > 0).sort((a, b) => b.beyondHoldM! - a.beyondHoldM!).slice(0, 12),
      largestGlides: [...ghostMeasured].sort((a, b) => b.glideM! - a.glideM!).slice(0, 12),
      pastNextStopSamples: ghostEpisodes.filter((e) => e.pastNextStop).slice(0, 12),
    };

    const seenServices = new Set([...servicesSeen.keys()].filter((s) => s !== '?'));
    const adoptions = events.filter((e) => e.cls === 'onto-other-route' || e.cls === 'same-route-variant');
    const serviceless = adoptions.filter((e) => {
      const idx = pathIdToIdx.get(e.to);
      const services = idx !== undefined ? servicesByPathIdx[idx] : undefined;
      return services === undefined || ![...services].some((s) => seenServices.has(s));
    });
    const serviceReport = {
      definition: "onto-other-route and same-route-variant adoptions whose adopted path runs no service of the trips seen in the frames (path -> patterns -> trips -> services, via engine.patternPathIds)",
      servicesSeen: [...seenServices].sort(),
      adoptions: adoptions.length,
      adoptionsWithoutService: serviceless.length,
      byClass: Object.fromEntries(countBy(serviceless, (e) => e.cls)),
      byPath: countBy(serviceless, (e) => e.to, 15),
      byStop: countBy(serviceless, (e) => e.nearestStop ?? '?', 15),
    };

    return {
      label: options.label ?? null,
      frames: ticks,
      droppedFrames: options.dropped ?? 0,
      firstHeader: first,
      lastHeader: last,
      firstClock: first !== null ? localClock(first) : null,
      lastClock: last !== null ? localClock(last) : null,
      spanHours: first !== null && last !== null ? Math.round(((last - first) / 3600) * 100) / 100 : null,
      tramVehicles: tramVehicles.size,
      tramTrips: tramTripsSeen.size,
      tramVehicleHours: r1(vehicleHours),
      tramFreshFixes,
      tripChanges,
      priorChangesSameTrip: priorChanges.length,
      servicesSeen: Object.fromEntries(sortedEntries(servicesSeen)),
      /** Share of tram track-ticks whose trip id the committed index cannot join (the artefact guard). */
      unknownTripShare: tripObservations > 0 ? unknownTripObservations / tripObservations : null,
      tripObservations,
      unknownTripObservations,
      tickMs: { p50: percentile(tickDurations, 0.5), p95: percentile(tickDurations, 0.95) },
      totals: {
        pathChangesSameTrip: events.length,
        per100VehicleHours: per100(events.length),
        perVehicleHour: vehicleHours > 0 ? Math.round((events.length / vehicleHours) * 100) / 100 : null,
        byClass: Object.fromEntries(byClass),
        byMechanism: Object.fromEntries(byMechanism),
        byClassAndMechanism: Object.fromEntries(byClassMech),
        heldAtEvent: events.filter((e) => e.held).length,
        heldBeforeEvent: events.filter((e) => e.heldBefore).length,
        leavingPriorPath: events.filter((e) => e.oldWasPrior).length,
        returningToPriorPath: events.filter((e) => e.newIsPrior).length,
        neitherPrior: events.filter((e) => !e.oldWasPrior && !e.newIsPrior).length,
      },
      reverts,
      teaserBox: {
        centre: TEASER_BOX_CENTRE,
        halfM: TEASER_BOX_HALF_M,
        events: boxEvents.length,
      eventsAllClasses: boxEventsAll.length,
        vehicleHours: r1(boxVh),
        per100vh: per100(boxEvents.length, boxVh),
        meanVehiclesInBoxPerTick: boxTicks > 0 ? r1(boxVehicleTicks / boxTicks) : null,
        byClass: Object.fromEntries(countBy(boxEventsAll, (e) => e.cls)),
        window: { events: windowBoxEvents.length, eventsAllClasses: windowBoxEventsAll.length, vehicleHours: r1(boxWindowVh), per100vh: per100(windowBoxEvents.length, boxWindowVh), byClass: Object.fromEntries(countBy(windowBoxEventsAll, (e) => e.cls)), topStops: countBy(windowBoxEventsAll, (e) => e.nearestStop ?? '?', 8) },
      },
      dossierWindow: { events: windowEvents.length, vehicleHours: r1(windowVh), per100vh: per100(windowEvents.length, windowVh), byClass: Object.fromEntries(countBy(windowEvents, (e) => e.cls)) },
      byRoute: routeRows,
      byHour: hourRows,
      hotSpots,
      oscillationPairs: countBy(events, (e) => [e.from, e.to].sort().join(' <-> '), 20),
      otherRoute,
      flips: flipReport,
      rederive,
      backward: {
        steps: backward.steps,
        metres: Math.round(backward.metres),
        runs: backward.runs.length,
        runsOver500m: backward.runs.filter((r) => r.metres >= 500).length,
        runsOver2000m: backward.runs.filter((r) => r.metres >= 2000).length,
        runsOnForeignPath: backward.runs.filter((r) => r.pathRoute !== r.route).length,
        runsOnPriorPath: backward.runs.filter((r) => r.onPrior).length,
        durationS: { p50: percentile(backward.runs.map((r) => r.durationS), 0.5), p95: percentile(backward.runs.map((r) => r.durationS), 0.95), max: backward.runs.length ? Math.max(...backward.runs.map((r) => r.durationS)) : null },
        metresPerRun: { p50: percentile(backward.runs.map((r) => r.metres), 0.5), p95: percentile(backward.runs.map((r) => r.metres), 0.95) },
        byPath: countBy(backward.runs, (r) => `${r.path} (route ${r.pathRoute}${r.onPrior ? ', prior' : ''})`, 12),
        byRoute: countBy(backward.runs, (r) => r.route, 12),
        longest: runsSorted.slice(0, 12),
      },
      arcJumps: { n: arcJumps.length, byPath: countBy(arcJumps, (j) => j.path, 15), byStop: countBy(arcJumps, (j) => j.nearestStop ?? '?', 15), byPathAndStop: countBy(arcJumps, (j) => `${j.path} @ ${j.nearestStop} (${j.ds > 0 ? '+' : '-'})`, 12), all: arcJumps },
      client: clientReport,
      loops: loopsReport,
      diversions: diversionsReport,
      unplaced: unplacedReport,
      silence: silenceReport,
      ghostAdvance: ghostReport,
      serviceFilter: serviceReport,
      glavniKolodvor: gkReport,
      tripsByPriorPath: Object.fromEntries([...tripsByPriorPath.entries()].map(([k, v]) => [k, v.size] as const).sort((a, b) => b[1] - a[1])),
      priorChangeSamples: priorChanges.slice(0, 10),
      events,
      reseeds: snaps,
    };
  }

  return { observe, report };
}

export type BranchGrader = ReturnType<typeof createBranchGrader>;
export type BranchReport = ReturnType<BranchGrader['report']>;

export interface GradeOptions extends BranchGraderOptions {
  /** Called after every observed tick with what the grader saw (a test keeps a copy of one). */
  onTick?: (tick: { frameNo: number; state: TwinState; headerSec: number; payload: FeedPayload }) => void;
}

/**
 * Folds `frames` (ordered by header time) through the twin's pure tick, one
 * call per frame, feeding each tick's evidence back into the engine exactly
 * as scripts/replay-core.ts `replay()` and the Durable Object do, and hands
 * every tick to the grader. Pure: no I/O.
 */
export function grade(frames: readonly DecodedFeed[], engine: Engine, options: GradeOptions): BranchReport {
  const grader = createBranchGrader(engine, { ...options, frameCount: options.frameCount ?? frames.length });
  let state = emptyState();
  frames.forEach((feed, frameNo) => {
    const headerSec = feed.headerTs ?? state.headerTs ?? 0;
    const nowMs = (headerSec + REPLAY_NOW_CUSHION_S) * 1000;
    const validUntilMs = nextTickAt(headerSec, nowMs);
    const tripIds = new Set<string>();
    for (const track of Object.values(state.tracks)) if (track.tripId !== null) tripIds.add(track.tripId);
    for (const vehicle of feed.vehicles) if (vehicle.tripId) tripIds.add(vehicle.tripId);
    const joins = joinsFor(engine.index, tripIds, engine.patternPathIds);

    const tickStart = performance.now();
    const result = runTick({ state, feed, nowMs, joins, routes: {}, engine, validUntilMs });
    const tickMs = performance.now() - tickStart;
    state = result.state;
    recordEvidence(engine.learned, result.learned);
    for (const dwell of result.learned.dwells) pushDwellRecent(engine.dwellRecent, dwell.stopId, dwell.atSec, dwell.seconds);
    trimDwellRecent(engine.dwellRecent, headerSec);

    grader.observe(state, headerSec, result.payload, tickMs);
    options.onTick?.({ frameNo, state, headerSec, payload: result.payload });
  });
  return grader.report();
}

export interface GradeDirectoryOptions extends Omit<GradeOptions, 'stops' | 'dropped'> {
  /** stops.json, for the nearest-stop columns. */
  stopsPath: string;
  /** Caps the number of (header-ordered) frames graded. */
  limit?: number;
}

/** Loads, orders and grades a directory of `.pb` frames in one call. */
export async function gradeDirectory(dir: string, engine: Engine, options: GradeDirectoryOptions): Promise<BranchReport> {
  const log = options.log ?? (() => {});
  const files = await loadFrameFiles(dir);
  const { ordered, dropped } = orderFrames(files);
  const frames = options.limit !== undefined ? ordered.slice(0, options.limit) : ordered;
  log(`frames: ${frames.length} (dropped ${dropped}); first header ${frames[0]?.headerTs} last ${frames[frames.length - 1]?.headerTs}`);
  const stops = await loadStops(options.stopsPath, engine.net);
  return grade(frames, engine, { ...options, stops, dropped });
}

// ---- acceptance rows, targets, judge ------------------------------------------

/** The report keys the acceptance rows read; a report written before a block
 *  existed (the review grader's, the committed aggregates fixture) lacks it. */
export interface AcceptanceSource {
  tramVehicleHours: number | null;
  totals: { pathChangesSameTrip: number };
  flips: { atTerminus: number; terminalDistanceHist: { le600: number; gt600: number } };
  loops?: { events: number };
  /** Rail round 2: the hops of diverted trams, absent in reports written before it. */
  diversions?: { events: number };
  teaserBox: { window: { per100vh: number | null } };
  otherRoute: { onto: number; ticks: { foreignVehicleHours: number | null; foreignFreshFixesWithPriorWithin60m: number } };
  rederive: { priorInPoolButOtherAdopted: number; planGapM: { p95: number | null } };
  backward: { runsOver500m: number };
  client: { sameTripPathToPathOver50: number; sameTripPathToPathJumpP95: number | null };
  /** `shareOfTramVehicleHoursRaw` and `parkedVehicleHours` arrived with decision 16; before it the share was the raw one. */
  unplaced?: { shareOfTramVehicleHours: number | null; shareOfTramVehicleHoursRaw?: number | null; parkedVehicleHours?: number };
  /** Row S as redefined on 23 Sep (D1 decision 3); a report of the first port (advanceM) predates it and reads not measured. */
  ghostAdvance?: { episodes: number; beyondHoldM?: { max: number | null }; glideM?: { max: number | null }; pastNextStop: number };
  serviceFilter?: { adoptionsWithoutService: number };
}

/**
 * The WP0 acceptance rows (brief §8, WP6 step 2). A distribution with no
 * sample reads 0 (no re-seed drawn, no correction, no silent episode);
 * null means the report cannot say: no tram time in the window, or a block
 * the report does not carry. `judge` fails a null row.
 */
export interface AcceptanceRows {
  /** (pathChangesSameTrip - flips.atTerminus - loops.events) / tramVehicleHours * 100. */
  A: number | null;
  /** teaserBox.window.per100vh: the teaser box, 17:15-17:44 Zagreb. */
  Aprime: number | null;
  /** otherRoute.onto. */
  B: number;
  /** otherRoute.ticks.foreignVehicleHours. */
  C_vh: number | null;
  /** otherRoute.ticks.foreignFreshFixesWithPriorWithin60m. */
  C_fixes: number;
  /** rederive.priorInPoolButOtherAdopted. */
  D: number;
  /** flips.terminalDistanceHist.le600 + gt600: direction flips > 300 m from a terminal. */
  E: number;
  /** backward.runsOver500m. */
  F: number;
  /** client.sameTripPathToPathOver50. */
  G: number;
  /** client.sameTripPathToPathJumpP95. */
  G_p95: number | null;
  /** rederive.planGapM.p95. */
  H: number | null;
  /** WP0 A10: unplaced.shareOfTramVehicleHours as a percent, parked trams left out (decision 16). */
  U: number | null;
  /** unplaced.shareOfTramVehicleHoursRaw as a percent, parked trams included (informational). */
  U_raw: number | null;
  /** unplaced.parkedVehicleHours: trams standing off the graph at a depot or layover (informational). */
  U_parkedVh: number | null;
  /** ghostAdvance.episodes: silent episodes over 60 s (informational). */
  S_count: number | null;
  /** Row S, "no movement beyond the current hold after 60 s of silence"
   *  (D1 decision 3): ghostAdvance.beyondHoldM.max, the metres a silent tram's
   *  published anchor went beyond the next stop it is held at. */
  S: number | null;
  /** S-glide: ghostAdvance.glideM.max, the metres it travelled while silent up to that hold (informational). */
  S_glide: number | null;
  /** ghostAdvance.pastNextStop: episodes whose anchor crossed the stop ZET's
   *  TripUpdate named next (informational; a hold in that stop's zone, past
   *  its point, counts here and not in S; A11's S2 is the trust rule). */
  S_pastNextStop: number | null;
  /** serviceFilter.adoptionsWithoutService. */
  I: number | null;
}

export const ACCEPTANCE_ROW_KEYS = ['A', 'Aprime', 'B', 'C_vh', 'C_fixes', 'D', 'E', 'F', 'G', 'G_p95', 'H', 'U', 'U_raw', 'U_parkedVh', 'S_count', 'S', 'S_glide', 'S_pastNextStop', 'I'] as const satisfies readonly (keyof AcceptanceRows)[];

/** Rows printed beside the judged ones, with no target of their own. */
export const INFORMATIONAL_ROW_KEYS = ['U_raw', 'U_parkedVh', 'S_count', 'S_glide', 'S_pastNextStop'] as const satisfies readonly (typeof ACCEPTANCE_ROW_KEYS)[number][];

/** Metric A as WP0 defines it: same-trip path changes less direction flips
 *  within 150 m of a terminal, own-route loop-path transitions and (rail
 *  round 2) the hops of diverted trams, per 100 tram vehicle-hours. `loops`
 *  is absent in reports written before WP0 step 7, `diversions` before rail round 2. */
export function metricA(r: AcceptanceSource): { n: number; per100vh: number | null } {
  const loops = r.loops?.events ?? 0;
  const diversions = r.diversions?.events ?? 0;
  const n = r.totals.pathChangesSameTrip - r.flips.atTerminus - loops - diversions;
  return { n, per100vh: r.tramVehicleHours !== null && r.tramVehicleHours > 0 ? (n / r.tramVehicleHours) * 100 : null };
}

/** A share (fraction) as a percent, to the 1e-6 the report rounds it to. */
function sharePercent(share: number | null | undefined): number | null {
  return share === null || share === undefined ? null : Math.round(share * 1e6) / 1e4;
}

export function acceptanceRows(r: AcceptanceSource): AcceptanceRows {
  const ghost = r.ghostAdvance;
  const u = r.unplaced;
  return {
    A: metricA(r).per100vh,
    Aprime: r.teaserBox.window.per100vh,
    B: r.otherRoute.onto,
    C_vh: r.otherRoute.ticks.foreignVehicleHours,
    C_fixes: r.otherRoute.ticks.foreignFreshFixesWithPriorWithin60m,
    D: r.rederive.priorInPoolButOtherAdopted,
    E: r.flips.terminalDistanceHist.le600 + r.flips.terminalDistanceHist.gt600,
    F: r.backward.runsOver500m,
    G: r.client.sameTripPathToPathOver50,
    G_p95: r.client.sameTripPathToPathJumpP95 ?? 0,
    H: r.rederive.planGapM.p95 ?? 0,
    U: u ? sharePercent(u.shareOfTramVehicleHours) : null,
    U_raw: u ? sharePercent(u.shareOfTramVehicleHoursRaw ?? u.shareOfTramVehicleHours) : null,
    U_parkedVh: u?.parkedVehicleHours ?? null,
    S_count: ghost ? ghost.episodes : null,
    S: ghost?.beyondHoldM ? ghost.beyondHoldM.max ?? 0 : null,
    S_glide: ghost?.glideM ? ghost.glideM.max ?? 0 : null,
    S_pastNextStop: ghost ? ghost.pastNextStop : null,
    I: r.serviceFilter ? r.serviceFilter.adoptionsWithoutService : null,
  };
}

export type InformationalRow = (typeof INFORMATIONAL_ROW_KEYS)[number];
export type TargetRow = Exclude<(typeof ACCEPTANCE_ROW_KEYS)[number], InformationalRow>;
export type Stage = 'stage1' | 'stage2';

/** A target set: the stage it belongs to, and the ceiling of every judged row. */
export type AcceptanceTargets = { stage: Stage } & Record<TargetRow, number>;

// Row S (D1 decision 3, 23 Sep): at most 50 m beyond the hold. It replaced
// "at most 50 m of anchor advance since the last fix, and never past the stop
// ZET named next", which T8's own rule (glide on to the next stop, then hold)
// could not meet: the glide alone reached 540 m on the committed sample.
const STAGE1: AcceptanceTargets = { stage: 'stage1', A: 5, Aprime: 5, B: 0, C_vh: 0, C_fixes: 0, D: 0, E: 0, F: 0, G: 0, G_p95: 50, H: 60, U: 3, S: 50, I: 0 };

/** Brief §8 / WP6 step 2: stage 1 is the coding session's gate, stage 2 the stretch (A and A' at most 1). */
export const ACCEPTANCE_TARGETS: Readonly<Record<Stage, AcceptanceTargets>> = {
  stage1: STAGE1,
  stage2: { ...STAGE1, stage: 'stage2', A: 1, Aprime: 1 },
};

export function isTargetRow(key: (typeof ACCEPTANCE_ROW_KEYS)[number]): key is TargetRow {
  return !(INFORMATIONAL_ROW_KEYS as readonly string[]).includes(key);
}

export const TARGET_ROWS = ACCEPTANCE_ROW_KEYS.filter(isTargetRow);

function fmtRow(n: number | null): string {
  if (n === null) return 'n/a';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Every judged row at most its target; a row the report cannot measure fails. */
export function judge(rows: AcceptanceRows, targets: AcceptanceTargets): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const key of TARGET_ROWS) {
    const value = rows[key];
    const target = targets[key];
    if (value === null) failures.push(`${key}: not measured (target <= ${target})`);
    else if (!(value <= target)) failures.push(`${key} ${fmtRow(value)} > ${target}`);
  }
  return { ok: failures.length === 0, failures };
}

/** The rows as a table, with the targets and a verdict per row when given. */
export function formatRows(rows: AcceptanceRows, targets: AcceptanceTargets | null = null): string {
  const L: string[] = [targets ? `acceptance rows against ${targets.stage}:` : 'acceptance rows:'];
  for (const key of ACCEPTANCE_ROW_KEYS) {
    const value = rows[key];
    const target = targets && isTargetRow(key) ? targets[key] : null;
    const verdict = target === null ? '' : value === null ? 'not measured' : value <= target ? 'ok' : 'FAIL';
    L.push(`  ${key.padEnd(15)}${fmtRow(value).padStart(10)}${target === null ? '' : `   <= ${String(target).padEnd(4)} ${verdict}`}`);
  }
  if (targets) {
    const { failures } = judge(rows, targets);
    L.push(failures.length === 0 ? `  verdict: ${targets.stage} met` : `  verdict: ${targets.stage} not met (${failures.length} rows)`);
  }
  return L.join('\n');
}

// ---- output -----------------------------------------------------------------

type Cell = string | number | boolean | null | undefined;

function mdTable(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  const line = (cells: readonly Cell[]): string => `| ${cells.map((c) => String(c ?? '')).join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

/** A fraction as a percent; a missing value stays missing (fmt prints n/a). */
function asPercent(x: number | null | undefined): number | null {
  return x === null || x === undefined ? null : x * 100;
}

function fmt(n: unknown, digits = 1): string {
  return n === null || n === undefined ? 'n/a' : typeof n === 'number' ? (Number.isInteger(n) ? String(n) : n.toFixed(digits)) : String(n);
}

const pairRows = (entries: readonly (readonly [Key, number])[]): Cell[][] => entries.map(([k, v]) => [k, v]);

export function formatSummary(r: BranchReport): string {
  const L: string[] = [];
  L.push(`wrong-branch grader: ${r.label}`);
  L.push(`frames ${r.frames} (${r.firstClock} -> ${r.lastClock} local, ${fmt(r.spanHours, 2)} h); tram vehicles ${r.tramVehicles}, trips ${r.tramTrips}, tram vehicle-hours ${r.tramVehicleHours}, fresh fixes ${r.tramFreshFixes}; services ${JSON.stringify(r.servicesSeen)}`);
  L.push(`path changes within an unchanged trip: ${r.totals.pathChangesSameTrip}  = ${fmt(r.totals.per100VehicleHours)} per 100 vehicle-hours (${fmt(r.totals.perVehicleHour, 2)} per vehicle-hour)`);
  L.push(`  by class:     ${Object.entries(r.totals.byClass).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  L.push(`  by mechanism: ${Object.entries(r.totals.byMechanism).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  L.push(`  teaser box: ${r.teaserBox.events} events over ${r.teaserBox.vehicleHours} vh = ${fmt(r.teaserBox.per100vh)} per 100 vh (mean ${fmt(r.teaserBox.meanVehiclesInBoxPerTick)} trams in box); window 17:15-17:44 in box: ${r.teaserBox.window.events} over ${r.teaserBox.window.vehicleHours} vh = ${fmt(r.teaserBox.window.per100vh)}`);
  L.push(`  direction flips: ${r.flips.total} (<=150 m of a terminal ${r.flips.atTerminus}, mid-network ${r.flips.midNetwork}); D4 rule fired ${r.flips.d4.total} (same route ${r.flips.d4.sameRoute}, cross-route ${r.flips.d4.crossRoute}; mid-network ${r.flips.d4.midNetwork})`);
  L.push(`  off-path re-derives: ${r.rederive.n}; exactly one tolerated ${r.rederive.exactlyOneTolerated}; prior in pool but another adopted ${r.rederive.priorInPoolButOtherAdopted}; own pool empty ${r.rederive.ownPoolEmpty}; plan gap p50 ${fmt(r.rederive.planGapM.p50)} m`);
  L.push(`  backward arc runs: ${r.backward.runs} (>=500 m ${r.backward.runsOver500m}, on a foreign path ${r.backward.runsOnForeignPath}); foreign rides ${r.otherRoute.foreignDurationS.n}, ground p50 ${fmt(r.otherRoute.foreignGroundM.p50)} m max ${fmt(r.otherRoute.foreignGroundM.max)} m`);
  L.push(`  client re-seeds: ${r.client.reseeds}; same-trip path->path ${r.client.sameTripPathToPath} (>50 m ${r.client.sameTripPathToPathOver50}, >250 m ${r.client.sameTripPathToPathOver250}, zero ${r.client.sameTripPathToPathZero}); p50 ${fmt(r.client.sameTripPathToPathJumpP50)} m p95 ${fmt(r.client.sameTripPathToPathJumpP95)} m`);
  L.push(`  per-tick wall time p50 ${fmt(r.tickMs.p50, 2)} ms p95 ${fmt(r.tickMs.p95, 2)} ms`);
  L.push(`  unknown trips: ${fmt(r.unknownTripShare === null ? null : r.unknownTripShare * 100, 3)} % of ${r.tripObservations} tram track-ticks carry a trip id the committed index cannot join  [precondition < 2 %]`);
  for (const line of acceptanceLines(r)) L.push(line);
  return L.join('\n');
}

/** The WP0 acceptance rows A-H, unplaced, silence and rows S and I on one screen (targets: ACCEPTANCE_TARGETS). */
function acceptanceLines(r: BranchReport): string[] {
  const A = metricA(r);
  const u = r.unplaced;
  const si = r.silence;
  const L: string[] = [];
  L.push('acceptance rows (targets: ACCEPTANCE_TARGETS in scripts/grade-branches-core.ts):');
  L.push(`  A  (pathChangesSameTrip ${r.totals.pathChangesSameTrip} - flips.atTerminus ${r.flips.atTerminus} - loops.events ${r.loops?.events ?? 0} - diversions.events ${r.diversions?.events ?? 0}) / ${r.tramVehicleHours} vh * 100 = ${fmt(A.per100vh, 2)} per 100 vh  [target <= 5, stretch <= 1]`);
  L.push(`  A' teaser box 17:15-17:44, with A's exclusions: ${fmt(r.teaserBox.window.per100vh)} per 100 vh (${r.teaserBox.window.events} events; every class ${r.teaserBox.window.eventsAllClasses})  [<= 5]`);
  L.push(`  B  onto another route's path: ${r.otherRoute.onto}  [0]`);
  L.push(`  C  foreign-path vehicle-hours ${r.otherRoute.ticks.foreignVehicleHours}; fresh fixes off the own path while it was within 60 m ${r.otherRoute.ticks.foreignFreshFixesWithPriorWithin60m}  [0; 0]`);
  L.push(`  D  re-derives with the own path in the pool but another adopted: ${r.rederive.priorInPoolButOtherAdopted}  [0]`);
  L.push(`  E  direction flips > 300 m from a terminal: ${r.flips.terminalDistanceHist.le600 + r.flips.terminalDistanceHist.gt600}  [0]`);
  L.push(`  F  backward arc runs >= 500 m: ${r.backward.runsOver500m}  [0]`);
  L.push(`  G  same-trip re-seeds > 50 m: ${r.client.sameTripPathToPathOver50}, p95 ${fmt(r.client.sameTripPathToPathJumpP95)} m  [0; < 50 m]`);
  L.push(`  H  visible correction at a re-derive, p95: ${fmt(r.rederive.planGapM.p95)} m  [< 60 m]`);
  L.push(`  loops: ${r.loops.events} own-route loop transitions (onto ${r.loops.onto}, off ${r.loops.off}, loop to loop ${r.loops.loopToLoop}); foreign loop events ${r.loops.foreignEvents} (in B); own-route hand-overs beyond ${LOOP_HANDOVER_TERMINUS_M} m of a terminal ${r.loops.farEvents ?? 0} (direction flips, in A and E); ${r.loops.loopPaths} loop paths in the network`);
  const dv = r.diversions;
  L.push(`  diversions: ${dv.events} hops of diverted trams (leaving ${dv.startHops}, between variants ${dv.midHops}, returning ${dv.returnHops}; direction id changed ${dv.directionIdChanged}; D4 reversals stay flips) in ${dv.episodes} episodes, ${fmt(dv.vehicleHours, 2)} vh = ${fmt(asPercent(dv.shareOfTramVehicleHours), 2)} % of tram vehicle-hours; ended by ${Object.entries(dv.endedBy).map(([k, v]) => `${k} ${v}`).join(', ') || 'n/a'}; by route ${dv.byRoute.slice(0, 6).map((x) => `${x.route} ${x.hops} hops/${x.episodes} ep`).join(', ') || 'none'}`);
  L.push(`  unplaced: share ${fmt(asPercent(u.shareOfTramVehicleHours), 2)} % of tram vehicle-hours without parked trams (raw ${fmt(asPercent(u.shareOfTramVehicleHoursRaw), 2)} %, ${u.vehicleHours} vh; parked ${fmt(u.parkedVehicleHours, 2)} vh in ${fmt(u.parkedEpisodes)} episodes; with a nearest edge ${u.withEdgeVehicleHours}, without ${u.noEdgeVehicleHours}); ${u.episodes} episodes, duration p50 ${fmt(u.durationS.p50)} s p95 ${fmt(u.durationS.p95)} s, nearest terminal p50 ${fmt(u.terminalM.p50)} m p95 ${fmt(u.terminalM.p95)} m; by reason ${Object.entries(u.byReason ?? {}).map(([reason, x]: [string, { vehicleHours: number; episodes: number }]) => `${reason} ${fmt(x.vehicleHours, 2)} vh in ${x.episodes} ep`).join(', ') || 'n/a'}  [share without parked <= 3 %]`);
  L.push(`  silence (EVICT_S ${si.evictS} s, SILENCE_HOLD_S ${si.holdS} s): published older than EVICT_S ${si.publishedOlderThanEvict} (tram ${si.publishedOlderThanEvictTram}, frames ${si.publishedOlderThanEvictFrames})  [0]; silent trams planned past the next stop at +${si.lookaheadS} s ${si.extrapolatedPastNextStop} of ${si.silentTramItemsOnPath} silent on-path items (${si.extrapolatedPastNextStopVehicles} vehicles; at the horizon ${si.extrapolatedPastNextStopAtHorizon})  [0]`);
  const g = si.gaps.hist;
  L.push(`  fresh-fix gaps > ${si.gaps.minS} s: ${si.gaps.total} (over EVICT_S ${si.gaps.overEvictS}); same trip 60-120 s ${g['60-120'].sameTrip}, 120-180 s ${g['120-180'].sameTrip} (moved <= 50 m ${g['120-180'].sameTripMovedLe50m}, <= 150 m of a terminal ${g['120-180'].sameTripWithin150mOfTerminal}), 180-300 s ${g['180-300'].sameTrip}, > 300 s ${g.over300.sameTrip}`);
  const gh = r.ghostAdvance;
  L.push(`  S  silent > ${gh.silenceS} s: ${gh.episodes} episodes (${gh.measured} on a path plan); published anchor beyond its hold at the next stop max ${fmt(gh.beyondHoldM.max)} m, p95 ${fmt(gh.beyondHoldM.p95)} m, in ${gh.beyondHold} episodes, > 50 m ${gh.over50m}  [max <= 50 m]; S-glide, silent up to the hold: max ${fmt(gh.glideM.max)} m, p95 ${fmt(gh.glideM.p95)} m; past the stop ZET's TripUpdate named next ${gh.pastNextStop} (context)`);
  const sf = r.serviceFilter;
  L.push(`  I  adoptions onto a path no service of the day runs: ${sf.adoptionsWithoutService} of ${sf.adoptions} onto/variant adoptions (services seen ${sf.servicesSeen.join(', ') || 'none'})  [0]`);
  return L;
}

export function formatMarkdown(r: BranchReport): string {
  const L: string[] = [];
  L.push(`# Wrong-branch grader: ${r.label}`);
  L.push('');
  L.push(`Frames ${r.frames} (dropped ${r.droppedFrames}), headers ${r.firstClock} -> ${r.lastClock} local (${fmt(r.spanHours, 2)} h). Tram vehicles ${r.tramVehicles}, tram trips ${r.tramTrips}, tram vehicle-hours ${r.tramVehicleHours}, fresh tram fixes ${r.tramFreshFixes}, trip changes ${r.tripChanges}, prior changes within a trip ${r.priorChangesSameTrip}. Services seen (trips): ${JSON.stringify(r.servicesSeen)}. Per-tick wall time p50 ${fmt(r.tickMs.p50, 2)} ms, p95 ${fmt(r.tickMs.p95, 2)} ms. Unknown trips: ${fmt(r.unknownTripShare === null ? null : r.unknownTripShare * 100, 3)} % of ${r.tripObservations} tram track-ticks.`);
  L.push('');
  L.push('## Acceptance rows (WP0; targets in scripts/grade-branches-core.ts ACCEPTANCE_TARGETS)');
  L.push('');
  L.push('```');
  for (const line of acceptanceLines(r)) L.push(line);
  L.push('');
  L.push(formatRows(acceptanceRows(r), ACCEPTANCE_TARGETS.stage1));
  L.push('```');
  L.push('');
  L.push('## Totals');
  L.push('');
  L.push(`- Path changes within an unchanged trip: **${r.totals.pathChangesSameTrip}** = **${fmt(r.totals.per100VehicleHours)} per 100 tram vehicle-hours** (${fmt(r.totals.perVehicleHour, 2)} per vehicle-hour). Leaving the trip's own path: ${r.totals.leavingPriorPath}; returning to it: ${r.totals.returningToPriorPath}; between two other paths: ${r.totals.neitherPrior}.`);
  L.push(`- Reverted (the next change of the same vehicle went straight back): within 60 s ${fmt(r.reverts.all.within60s)}%, 120 s ${fmt(r.reverts.all.within120s)}%, 300 s ${fmt(r.reverts.all.within300s)}%. By mechanism (within 300 s): ${Object.entries(r.reverts.byMechanism).map(([k, v]) => `${k} ${fmt(v.within300s)}%`).join(', ')}.`);
  L.push(`- Published \`held: true\` at the event tick: ${r.totals.heldAtEvent}; at the tick before: ${r.totals.heldBeforeEvent}.`);
  L.push(`- Teaser box (${r.teaserBox.halfM} m half-side around ${r.teaserBox.centre.lon}, ${r.teaserBox.centre.lat}; what the live monitor saw): ${r.teaserBox.events} events over ${r.teaserBox.vehicleHours} vehicle-hours = **${fmt(r.teaserBox.per100vh)} per 100 vh**, mean ${fmt(r.teaserBox.meanVehiclesInBoxPerTick)} trams in the box per tick; by class ${JSON.stringify(r.teaserBox.byClass)}.`);
  L.push(`- Teaser box, 17:15-17:44 local (the dossier's window): ${r.teaserBox.window.events} events over ${r.teaserBox.window.vehicleHours} vh = **${fmt(r.teaserBox.window.per100vh)} per 100 vh**; by class ${JSON.stringify(r.teaserBox.window.byClass)}; stops ${r.teaserBox.window.topStops.map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  L.push(`- City-wide, 17:15-17:44 local: ${r.dossierWindow.events} events over ${r.dossierWindow.vehicleHours} vh = ${fmt(r.dossierWindow.per100vh)} per 100 vh; by class ${JSON.stringify(r.dossierWindow.byClass)}.`);
  L.push('');
  L.push(mdTable(['class', 'events', 'share'], Object.entries(r.totals.byClass).map(([k, v]) => [k, v, `${((100 * v) / Math.max(1, r.totals.pathChangesSameTrip)).toFixed(1)}%`])));
  L.push('');
  L.push(mdTable(['mechanism (from matcher state)', 'events'], Object.entries(r.totals.byMechanism).map(([k, v]) => [k, v])));
  L.push('');
  L.push(mdTable(['class / mechanism', 'events'], Object.entries(r.totals.byClassAndMechanism).map(([k, v]) => [k, v])));
  L.push('');
  L.push("Mechanism legend: `off-path-rederive` = the fix's residual on the old path exceeded NEAR_M (60 m) with offPathCount already at 1 (match.ts:398-411: the second off-path fix re-derives via candidatesFor(restrictToRoute=false) -> adoptPath); `turnaround` = old-path residual <= 60 m, againstCount already at 1, same route, opposite direction id (D4, match.ts:380-394); `turnaround-cross-route` = the same D4 rule fired while the vehicle rode another route's path, landing on its own route's path of the other direction id (turnaroundMatch filters by prior.routeId, not by the current path's route); `prior-change` = the trip's prior path changed with the trip id unchanged; `unexplained` = none of the above.");
  L.push('');
  L.push("Class legend: `onto-other-route` = the new path belongs to another route; `back-to-own-route` = the old one did; `loop-transition` = both are the vehicle's own route and one of them is a terminus loop path (`loop:`, WP0 step 6), counted in the loops section and excluded from metric A; `direction-flip` = own route, opposite direction id; `same-route-variant` = own route, same direction id.");
  L.push('');
  L.push('## By route');
  L.push('');
  L.push(mdTable(['route', 'events', 'vehicle-hours', 'per 100 vh'], r.byRoute.map((x) => [x.route, x.events, x.vehicleHours, fmt(x.per100vh)])));
  L.push('');
  L.push('## By hour of day (local)');
  L.push('');
  L.push(mdTable(['hour', 'events', 'vehicle-hours', 'per 100 vh'], r.byHour.filter((x) => x.vehicleHours > 0).map((x) => [String(x.hour).padStart(2, '0'), x.events, x.vehicleHours, fmt(x.per100vh)])));
  L.push('');
  L.push('## Top 15 hot spots (nearest stop in stops.json, platforms of one name merged)');
  L.push('');
  L.push(mdTable(['stop', 'events', 'in box', 'terminal within (m, median)', 'by class', 'top pairs [mechanism]'], r.hotSpots.map((x) => [x.stop, x.events, x.inBox ? 'y' : 'n', fmt(x.terminalM), Object.entries(x.classes).map(([k, v]) => `${k} ${v}`).join(', '), x.topPairs.map(([k, v]) => `${k} ${v}`).join('; ')])));
  L.push('');
  L.push('## Oscillation pairs (top 20)');
  L.push('');
  L.push(mdTable(['pair', 'events'], pairRows(r.oscillationPairs)));
  L.push('');
  L.push('## Other-route adoptions (cause 2, restrictToRoute=false)');
  L.push('');
  L.push(`- Onto another route's path: ${r.otherRoute.onto} (own-route pool empty at the adopted edge: ${r.otherRoute.ontoOwnPoolEmpty}; the trip's own path within 60 m at that moment: ${r.otherRoute.ontoPriorWithin60m}; distance to own path p50 ${fmt(r.otherRoute.ontoPriorMinDP50)} m). Back to own route: ${r.otherRoute.back}, by mechanism ${JSON.stringify(r.otherRoute.backByMechanism)}.`);
  L.push(`- Rides on a foreign path (onto -> back, same trip): ${r.otherRoute.foreignDurationS.n}; duration p50 ${fmt(r.otherRoute.foreignDurationS.p50)} s, p95 ${fmt(r.otherRoute.foreignDurationS.p95)} s, max ${fmt(r.otherRoute.foreignDurationS.max)} s (> 60 s: ${r.otherRoute.foreignDurationS.over60}, > 300 s: ${r.otherRoute.foreignDurationS.over300}); ground distance between the two fixes p50 ${fmt(r.otherRoute.foreignGroundM.p50)} m, p95 ${fmt(r.otherRoute.foreignGroundM.p95)} m, max ${fmt(r.otherRoute.foreignGroundM.max)} m (> 500 m: ${r.otherRoute.foreignGroundM.over500}, > 2000 m: ${r.otherRoute.foreignGroundM.over2000}).`);
  L.push(`- Vehicle-hours matched on a foreign path: **${r.otherRoute.ticks.foreignVehicleHours}** (${r.otherRoute.ticks.foreignTrips} trips); fresh fixes there ${r.otherRoute.ticks.foreignFreshFixes}, of which the trip's OWN path was within 60 m: **${r.otherRoute.ticks.foreignFreshFixesWithPriorWithin60m}**. Vehicle-hours on a same-route non-prior variant: ${r.otherRoute.ticks.variantVehicleHours} (${r.otherRoute.ticks.variantTrips} trips); fresh fixes ${r.otherRoute.ticks.variantFreshFixes}, own path within 60 m ${r.otherRoute.ticks.variantFreshFixesWithPriorWithin60m}. On the own path: ${r.otherRoute.ticks.onPriorVehicleHours} vehicle-hours.`);
  L.push('');
  L.push(mdTable(['vehicle route -> adopted path', 'events'], pairRows(r.otherRoute.ontoByVehicleRouteToPath)));
  L.push('');
  L.push(mdTable(['nearest stop (onto-other-route)', 'events'], pairRows(r.otherRoute.ontoByStop)));
  L.push('');
  L.push(mdTable(['foreign path', 'rides', 'vehicle routes', 'duration p50 s', 'ground p50 m', 'ground max m', 'from -> back at'], r.otherRoute.foreignRidesByPath.map((x) => [x.path, x.rides, Object.entries(x.vehicleRoutes).map(([k, v]) => `${k}:${v}`).join(' '), x.durationP50, x.groundP50, x.groundMax, x.topFrom.map(([k, v]) => `${k} (${v})`).join('; ')])));
  L.push('');
  L.push(mdTable(['longest foreign rides', 'route', 'path', 'duration s', 'ground m', 'from -> back at', 'back to', 'via'], r.otherRoute.longestForeignRides.map((x) => [`${x.clock} ${x.id}`, x.route, x.path, x.durationS, x.groundM, x.from, x.backTo, x.mechanism])));
  L.push('');
  L.push('## Backward arc runs (the matched arc receding on one path: a tram driving against the path it is read on)');
  L.push('');
  L.push(`Backward steps (> ${BACKWARD_STEP_M} m between consecutive fixes on one path): ${r.backward.steps}, ${r.backward.metres} m in total. Runs (>= 2 steps or >= 100 m): **${r.backward.runs}**, >= 500 m: ${r.backward.runsOver500m}, >= 2000 m: ${r.backward.runsOver2000m}; on a foreign route's path ${r.backward.runsOnForeignPath}, on the trip's own path ${r.backward.runsOnPriorPath}. Duration p50 ${fmt(r.backward.durationS.p50)} s, p95 ${fmt(r.backward.durationS.p95)} s, max ${fmt(r.backward.durationS.max)} s; metres per run p50 ${fmt(r.backward.metresPerRun.p50)}, p95 ${fmt(r.backward.metresPerRun.p95)}. While the server anchor walks backwards the client mark, which may not reverse (integrator.ts convergeArc), holds still.`);
  L.push('');
  L.push(mdTable(['path (route)', 'runs'], pairRows(r.backward.byPath)));
  L.push('');
  L.push(mdTable(['longest runs', 'route', 'path', 'on prior', 'duration s', 'steps', 'arc m', 'ground m', 'ended near'], r.backward.longest.map((x) => [`${x.start} ${x.id}`, x.route, x.path, x.onPrior ? 'y' : 'n', x.durationS, x.steps, x.metres, x.groundM, x.endStop])));
  L.push('');
  L.push('## Direction flips and the turnaround rule (D4, cause 4)');
  L.push('');
  L.push(`- Direction flips (same route, opposite direction id): ${r.flips.total}; distance to the nearest terminal platform: <=150 m ${r.flips.terminalDistanceHist.le150}, 150-300 m ${r.flips.terminalDistanceHist.le300}, 300-600 m ${r.flips.terminalDistanceHist.le600}, >600 m ${r.flips.terminalDistanceHist.gt600}. By mechanism ${JSON.stringify(r.flips.byMechanism)}; mid-network (>150 m) by mechanism ${JSON.stringify(r.flips.midNetworkByMechanism)}.`);
  L.push(`- The D4 rule itself fired ${r.flips.d4.total} times (same route ${r.flips.d4.sameRoute}, cross-route ${r.flips.d4.crossRoute}); terminal distance <=150 m ${r.flips.d4.terminalDistanceHist.le150}, 150-300 m ${r.flips.d4.terminalDistanceHist.le300}, 300-600 m ${r.flips.d4.terminalDistanceHist.le600}, >600 m ${r.flips.d4.terminalDistanceHist.gt600}. Mid-network D4 flips: **${r.flips.d4.midNetwork}** (terminal distance p50 ${fmt(r.flips.d4.midNetworkTerminalM.p50)} m, max ${fmt(r.flips.d4.midNetworkTerminalM.max)} m); of these ${r.flips.d4.midNetworkOldWasPrior} left the trip's own path; reverted within 120 s ${r.flips.d4.midNetworkRevertedWithin120s}, within 300 s ${r.flips.d4.midNetworkRevertedWithin300s}; angle between movement and the old path's tangent p50 ${fmt(r.flips.d4.midNetworkAgainstDeg.p50)} deg, p95 ${fmt(r.flips.d4.midNetworkAgainstDeg.p95)} deg; folds of the old path within 100 m of the fix ${JSON.stringify(r.flips.d4.midNetworkOldFolds)}.`);
  L.push('');
  L.push(mdTable(['mid-network flip (any mechanism), nearest stop', 'events'], pairRows(r.flips.midNetworkTopStops)));
  L.push('');
  L.push(mdTable(['mid-network D4 flip: from -> to @ stop', 'events'], pairRows(r.flips.d4.midNetworkTopPairs)));
  L.push('');
  L.push('## Off-path re-derives: residual series (cause 3) and the adoptPath pool (cause 2)');
  L.push('');
  L.push(`- Re-derives: ${r.rederive.n}. Fresh fix k-1 had residual > 60 m (the tolerated fix): ${r.rederive.k1OffPath}. Exactly one tolerated fix (k-1 off, k-2 on): **${r.rederive.exactlyOneTolerated}**; k-2 also off (a re-derive at k-1 found no edge within 60 m): ${r.rederive.k2AlsoOff}; fewer than two fresh fixes of history: ${r.rederive.shortHistory}.`);
  L.push(`- Excursion length (seconds since the first consecutive off-path fresh fix): p50 ${fmt(r.rederive.excursionS.p50)} s, p95 ${fmt(r.rederive.excursionS.p95)} s, max ${fmt(r.rederive.excursionS.max)} s.`);
  L.push(`- Visible correction (previous tick's plan, evaluated now, vs the fix now): p50 **${fmt(r.rederive.planGapM.p50)} m**, p95 ${fmt(r.rederive.planGapM.p95)} m, max ${fmt(r.rederive.planGapM.max)} m; > 50 m: ${r.rederive.planGapM.over50}; > 100 m: ${r.rederive.planGapM.over100}; > 250 m: ${r.rederive.planGapM.over250}.`);
  L.push(`- Old path's residual for the triggering fix (place() re-stated): p50 ${fmt(r.rederive.oldResidualNow.p50)} m, p95 ${fmt(r.rederive.oldResidualNow.p95)} m. Distance of fix k-1 to the NEW path: p50 ${fmt(r.rederive.newPathAtPreviousFixD.p50)} m; within 60 m: ${r.rederive.newPathAtPreviousFixD.within60} (the tram was already on the new rails a tick earlier).`);
  L.push(`- Pool at the adopted edge: the trip's own path runs the edge but another variant was adopted **${r.rederive.priorInPoolButOtherAdopted}**; adopted the own path ${r.rederive.newIsPrior}; left the own path ${r.rederive.oldWasPrior}; own path within 60 m of the fix ${r.rederive.priorWithin60mNow}; own-route pool empty ${r.rederive.ownPoolEmpty}. Pool size chosen from (own-route paths on the edge, else all) p50 ${fmt(r.rederive.poolSize.p50)}, histogram ${JSON.stringify(r.rederive.poolSize.hist)}.`);
  const srv = r.rederive.sameRouteVariant;
  L.push(`- Same-route-variant re-derives: ${srv.n} = shape path -> synthetic path ${srv.shapeToSynthetic}, synthetic -> shape ${srv.syntheticToShape}, shape -> shape ${srv.shapeToShape}, synthetic -> synthetic ${srv.syntheticToSynthetic}. Leaving the own path ${srv.oldWasPrior}, returning to it ${srv.newIsPrior}, own path in the pool but another adopted ${srv.priorInPoolButOtherAdopted}, old path still in the pool ${srv.oldInPool}.`);
  L.push('');
  L.push(mdTable(['same-route variant, leaving the own path: from -> to @ stop', 'events'], pairRows(srv.leavingPriorTopPairs)));
  L.push('');
  L.push(mdTable(['shape -> synthetic, same route: from -> to @ stop', 'events'], pairRows(srv.shapeToSyntheticTopPairs)));
  L.push('');
  L.push('## Arc jumps on one path (>= 500 m between consecutive fixes)');
  L.push('');
  L.push(`Total ${r.arcJumps.n}.`);
  L.push('');
  L.push(mdTable(['path @ stop (sign)', 'jumps'], pairRows(r.arcJumps.byPathAndStop)));
  L.push('');
  L.push('## Client re-seeds (cause 5; real integrator, app/src/motion/integrator.ts, fed the published payloads)');
  L.push('');
  L.push(`Polls ${r.client.polls}, frames ${r.client.frames} at ${r.client.frameHz} Hz between polls plus a pre/post step around each poll. Re-seeds (lastSnapAt written at the poll): **${r.client.reseeds}** (${fmt(r.client.reseedsPer100vh)} per 100 vh). Displacement of the drawn mark across the poll: p50 ${fmt(r.client.jumpP50)} m, p95 ${fmt(r.client.jumpP95)} m, max ${fmt(r.client.jumpMax)} m; > 25 m: ${r.client.over25}; > 50 m: **${r.client.over50}**; > 100 m: ${r.client.over100}; > 250 m: ${r.client.over250}; > 1000 m: ${r.client.over1000}. Jumps > 25 m without a re-seed: ${r.client.nonSnapJumpsOver25} (the integrator never jumps except at a re-seed).`);
  L.push('');
  L.push(`Same-trip path->path re-seeds (a server-side path change reaching the page): **${r.client.sameTripPathToPath}**; zero displacement (arc mapped exactly onto the new path) ${r.client.sameTripPathToPathZero}; > 50 m **${r.client.sameTripPathToPathOver50}** (in the teaser box ${r.client.inBoxSameTripOver50}); > 250 m ${r.client.sameTripPathToPathOver250}; > 1000 m ${r.client.sameTripPathToPathOver1000}; p50 ${fmt(r.client.sameTripPathToPathJumpP50)} m, p95 ${fmt(r.client.sameTripPathToPathJumpP95)} m. mapArc found the mark's edge on the new path in ${r.client.sameTripPathToPathMapped} (of which > 50 m: ${r.client.sameTripPathToPathMappedOver50}); no mapping, window/plan fallback ${r.client.sameTripPathToPath - r.client.sameTripPathToPathMapped} (of which > 50 m: ${r.client.sameTripPathToPathUnmappedOver50}). The mark was HOLDING (plan behind it) in the frame before ${r.client.sameTripPathToPathHoldingBefore} of them, and in ${r.client.sameTripPathToPathOver250HoldingBefore} of the > 250 m ones. By kind: ${JSON.stringify(r.client.byKind)}.`);
  L.push('');
  L.push(mdTable(['same-trip re-seed > 250 m: from -> to', 'count'], pairRows(r.client.topPairsOver250)));
  L.push('');
  L.push(mdTable(['nearest stop (re-seeds > 50 m)', 'count'], pairRows(r.client.topStops)));
  L.push('');
  L.push(mdTable(['largest re-seeds', 'route', 'from', 'to', 'same trip', 'jump m', 's before -> after (mapped)', 'holding before', 'stop'], r.client.largest.map((x) => [`${x.clock} ${x.id}`, x.route, x.from, x.to, x.sameTrip ? 'y' : 'n', x.jumpM, `${x.sBefore} -> ${x.sAfter} (${x.mappedS ?? 'none'})`, x.holdingBefore ? 'y' : 'n', x.nearestStop])));
  L.push('');
  const lp = r.loops;
  L.push('## Terminus loop paths (`loop:`; excluded from metric A)');
  L.push('');
  L.push(`Loop paths in the network: ${lp.loopPaths}. Own-route transitions onto or off one (class \`loop-transition\`, not a direction flip): **${lp.events}** (onto ${lp.onto}, off ${lp.off}, loop to loop ${lp.loopToLoop}); by mechanism ${JSON.stringify(lp.byMechanism)}; terminal distance <=150 m ${lp.terminalDistanceHist.le150}, 150-300 m ${lp.terminalDistanceHist.le300}, 300-600 m ${lp.terminalDistanceHist.le600}, >600 m ${lp.terminalDistanceHist.gt600}. Loop paths of another route adopted or left (still counted in row B): ${lp.foreignEvents}. Own-route hand-overs beyond ${LOOP_HANDOVER_TERMINUS_M} m of every terminal (direction flips, rows A and E): ${lp.farEvents ?? 0}.`);
  L.push('');
  L.push(mdTable(['loop transition, nearest stop', 'events'], pairRows(lp.byStop)));
  L.push('');
  L.push(mdTable(['loop path', 'events (any class)'], pairRows(lp.byPath)));
  L.push('');
  const dv = r.diversions;
  L.push('## Diversions (`diversion-hop`, rail round 2; excluded from metric A)');
  L.push('');
  L.push(`Definition: ${dv.definition}. Hops: **${dv.events}** (leaving the own path ${dv.startHops}, between variants ${dv.midHops}, returning ${dv.returnHops}; direction id changed ${dv.directionIdChanged}); by mechanism ${JSON.stringify(dv.byMechanism)}. Episodes: **${dv.episodes}**, ended by ${JSON.stringify(dv.endedBy)}; duration p50 ${fmt(dv.durationS.p50)} s, p95 ${fmt(dv.durationS.p95)} s, max ${fmt(dv.durationS.max)} s; hops per episode p50 ${fmt(dv.hopsPerEpisode.p50)}, p95 ${fmt(dv.hopsPerEpisode.p95)}, max ${fmt(dv.hopsPerEpisode.max)}; ground from start to end p50 ${fmt(dv.groundM.p50)} m, p95 ${fmt(dv.groundM.p95)} m. Tram time diverted: ${dv.vehicleHours} vehicle-hours = ${fmt(asPercent(dv.shareOfTramVehicleHours), 2)} % of tram vehicle-hours.`);
  L.push('');
  L.push(mdTable(['route', 'hops', 'episodes', 'vehicle-hours', 'share of the route'], dv.byRoute.map((x) => [x.route, x.hops, x.episodes, x.vehicleHours, x.shareOfRouteVehicleHours === null ? 'n/a' : `${(x.shareOfRouteVehicleHours * 100).toFixed(2)}%`])));
  L.push('');
  L.push(mdTable(['diversion hop: from -> to @ stop', 'events'], pairRows(dv.byPair)));
  L.push('');
  L.push(mdTable(['vehicle', 'hops'], pairRows(dv.byVehicle)));
  L.push('');
  L.push(mdTable(['longest diversions', 'route', 'prior', 'hops', 'duration s', 'ground m', 'ended by', 'from', 'to'], dv.longest.map((x) => [`${x.start} ${x.id}`, x.route, x.prior, x.hops, x.durationS, x.groundM, x.endedBy, x.stop, x.endStop])));
  L.push('');
  const u = r.unplaced;
  L.push('## Unplaced trams (on no path, not off the graph)');
  L.push('');
  L.push(`Definition: ${u.definition}. Tram time unplaced: ${u.vehicleHours} vehicle-hours = ${fmt(asPercent(u.shareOfTramVehicleHoursRaw), 2)} % of tram vehicle-hours (raw). Parked (${u.parkedRule}: a tram standing off the graph at a depot or layover, never drawn): ${fmt(u.parkedVehicleHours, 2)} vehicle-hours in ${fmt(u.parkedEpisodes)} episodes. **Without parked trams (row A10): ${fmt(asPercent(u.shareOfTramVehicleHours), 2)} %** of tram vehicle-hours (with a nearest edge, the matcher's own unplaced flag: ${u.withEdgeVehicleHours} vh; without: ${u.noEdgeVehicleHours} vh). Off the graph, for comparison: ${u.offGraphVehicleHours} vh. Fresh fixes while unplaced: ${u.freshFixes}. Episodes: **${u.episodes}**, duration p50 ${fmt(u.durationS.p50)} s, p95 ${fmt(u.durationS.p95)} s, max ${fmt(u.durationS.max)} s; distance of the first fix to the nearest terminal platform p50 ${fmt(u.terminalM.p50)} m, p95 ${fmt(u.terminalM.p95)} m (<=150 m ${u.terminalDistanceHist.le150}, 150-300 m ${u.terminalDistanceHist.le300}, 300-600 m ${u.terminalDistanceHist.le600}, >600 m ${u.terminalDistanceHist.gt600}); ground covered p50 ${fmt(u.groundM.p50)} m, p95 ${fmt(u.groundM.p95)} m.`);
  L.push('');
  L.push(mdTable(['nearest stop (episode start)', 'episodes', 'vehicle-hours', 'terminal m (median)'], u.byStop.map((x) => [x.stop, x.episodes, x.vehicleHours, fmt(x.terminalM)])));
  L.push('');
  L.push(mdTable(['route', 'episodes', 'vehicle-hours', 'share of the route'], u.byRoute.slice(0, 20).map((x) => [x.route, x.episodes, x.vehicleHours, x.shareOfRouteVehicleHours === null ? 'n/a' : `${(x.shareOfRouteVehicleHours * 100).toFixed(2)}%`])));
  L.push('');
  L.push(mdTable(['longest episodes', 'route', 'prior', 'duration s', 'fresh fixes', 'ground m', 'max from start m', 'parked', 'stop (m)', 'terminal (m)'], u.longest.map((x) => [`${x.start} ${x.id}`, x.route, x.prior, x.durationS, x.freshFixes, x.groundM, x.maxDistFromStartM, x.parked ? 'yes' : 'no', `${x.stop} (${x.stopM})`, `${x.terminal} (${x.terminalM})`])));
  L.push('');
  const si = r.silence;
  L.push('## Silence (T8: hold at the next stop after SILENCE_HOLD_S, drop at EVICT_S)');
  L.push('');
  L.push(`Constants read from the graded tree: EVICT_S ${si.evictS} s, SILENCE_HOLD_S ${si.holdS} s. Vehicle items published with a last fix older than EVICT_S: **${si.publishedOlderThanEvict}** (tram ${si.publishedOlderThanEvictTram}; frames ${si.publishedOlderThanEvictFrames}). Silent tram items (last fix older than SILENCE_HOLD_S): ${si.silentTramItems}, on a rail path ${si.silentTramItemsOnPath}, free or elsewhere ${si.silentTramItemsOffPath}; planned past the next served stop at header + ${si.lookaheadS} s: **${si.extrapolatedPastNextStop}** (${si.extrapolatedPastNextStopVehicles} vehicles; by the end of the plan ${si.extrapolatedPastNextStopAtHorizon}); overshoot p50 ${fmt(si.extrapolatedPastNextStopM.p50)} m, p95 ${fmt(si.extrapolatedPastNextStopM.p95)} m, max ${fmt(si.extrapolatedPastNextStopM.max)} m; by silence ${JSON.stringify(si.extrapolatedPastNextStopBySilenceS)}.`);
  L.push('');
  L.push(mdTable(['published age (all vehicles)', 'items', 'tram items'], (Object.keys(si.publishedAgeHist) as AgeBucket[]).map((k) => [k, si.publishedAgeHist[k], si.publishedTramAgeHist[k]])));
  L.push('');
  L.push(`Fresh-fix gaps of tram vehicles longer than ${si.gaps.minS} s (per vehicle, across evictions): ${si.gaps.total}, longer than EVICT_S ${si.gaps.overEvictS}. Same trip, 120-180 s, moved > 150 m: ${si.gaps.sameTrip120to180MovedOver150m.n}, p50 ${fmt(si.gaps.sameTrip120to180MovedOver150m.p50)} m, p95 ${fmt(si.gaps.sameTrip120to180MovedOver150m.p95)} m.`);
  L.push('');
  L.push(mdTable(['gap', 'all', 'same trip', 'trip changed', 'same trip, moved <= 50 m', 'same trip, <= 150 m of a terminal'], Object.entries(si.gaps.hist).map(([k, v]) => [k, v.n, v.sameTrip, v.tripChanged, v.sameTripMovedLe50m, v.sameTripWithin150mOfTerminal])));
  L.push('');
  L.push(mdTable(['planned past the next stop: next stop', 'items'], pairRows(si.extrapolatedPastNextStopByStop)));
  L.push('');
  L.push(mdTable(['largest overshoots', 'route', 'path', 'silence s', 'next stop', 'limit s', 's at +60 s', 'over m'], si.extrapolatedPastNextStopLargest.map((x) => [`${x.clock} ${x.id}`, x.route, x.path, x.silenceS, `${x.nextStop} (${x.nextStopIs})`, x.limitS, x.sAt60, x.overM])));
  L.push('');
  const gh = r.ghostAdvance;
  L.push(`## Row S: the published anchor of a tram silent more than ${gh.silenceS} s, beyond its hold`);
  L.push('');
  L.push(`Definition: ${gh.definition}. Silent episodes: **${gh.episodes}** (on a path plan ${gh.measured}; no path plan at the last fix ${gh.offPath}; plan moved to another path while silent ${gh.pathChanged}); by longest silence ${JSON.stringify(gh.silenceHist)}. Beyond the hold per episode (row S): p50 ${fmt(gh.beyondHoldM.p50)} m, p95 ${fmt(gh.beyondHoldM.p95)} m, max **${fmt(gh.beyondHoldM.max)} m**; episodes beyond it ${gh.beyondHold}, > 50 m ${gh.over50m} (by route ${JSON.stringify(gh.byRoute)}). S-glide, the glide to the hold while silent: p50 ${fmt(gh.glideM.p50)} m, p95 ${fmt(gh.glideM.p95)} m, max ${fmt(gh.glideM.max)} m. Anchor past the stop ZET's TripUpdate named next: ${gh.pastNextStop}; measured episodes without that stop on the path: ${gh.withoutNextStop}.`);
  L.push('');
  const ghostRow = (x: (typeof gh.largestGlides)[number]): Cell[] => [`${x.start} ${x.id}`, x.route, x.path, x.silenceS, x.beyondHoldM, x.glideM, x.holdStop, x.nextStop, x.pastNextStop ? 'y' : 'n'];
  const ghostHeader = ['route', 'path', 'silence s', 'beyond hold m', 'glide m', 'hold', 'ZET next stop', 'past it'];
  L.push(mdTable(['beyond the hold', ...ghostHeader], gh.largestBeyondHold.map(ghostRow)));
  L.push('');
  L.push(mdTable(['longest glides', ...ghostHeader], gh.largestGlides.map(ghostRow)));
  L.push('');
  L.push(mdTable(['past the ZET next stop', ...ghostHeader], gh.pastNextStopSamples.map(ghostRow)));
  L.push('');
  const sf = r.serviceFilter;
  L.push('## Row I: adoptions onto a path no service of the day runs');
  L.push('');
  L.push(`Definition: ${sf.definition}. Services seen: ${sf.servicesSeen.join(', ') || 'none'}. Adoptions (onto another route, same-route variant): ${sf.adoptions}; onto a path without a seen service: **${sf.adoptionsWithoutService}** (by class ${JSON.stringify(sf.byClass)}).`);
  L.push('');
  L.push(mdTable(['adopted path without a seen service', 'events'], pairRows(sf.byPath)));
  L.push('');
  L.push('## Glavni kolodvor detour paths (cause 1)');
  L.push('');
  for (const [id, raw] of Object.entries(r.glavniKolodvor)) {
    const g = raw as {
      pathIdx: number; lenM: number; edges: number; sibling: string; siblingLenM: number | null; extraEdgesVsSibling: number[];
      loop: { edges: number[]; sFrom: number; sTo: number; lenM: number; startNearestStop: string | null; midNearestStop: string | null; endNearestStop: string | null; radiusM: number; startToEndM: number } | null;
      tripsWithThisPrior: number; tripsReachingLoopBand: number; tripsWithFixInLoopInterior: number; tripsArcJumpOver500: number; tripsPlanGapOver200: number;
      pathChangesOffThisPath: number; pathChangesOffNearLoop: number; pathChangesOffByStopAndMechanism: Counted<string>; pathChangesOntoThisPath: number; pathChangesOntoByStopAndMechanism: Counted<string>; arcJumpsOnPath: number;
    };
    L.push(`### ${id} (path ${g.pathIdx}, ${g.lenM} m over ${g.edges} edges; sibling ${g.sibling} ${fmt(g.siblingLenM)} m)`);
    L.push('');
    if (g.loop) L.push(`- Loop edges ${g.loop.edges.join('->')}, arc ${g.loop.sFrom}-${g.loop.sTo} m (${g.loop.lenM} m of path), start near ${g.loop.startNearestStop}, midpoint near ${g.loop.midNearestStop}, end near ${g.loop.endNearestStop}; farthest point ${g.loop.radiusM} m from the start, end ${g.loop.startToEndM} m from the start. Edges not on the sibling: ${g.extraEdgesVsSibling.join(',')}.`);
    L.push(`- Trips whose prior was this path: **${g.tripsWithThisPrior}**; reaching the loop band: ${g.tripsReachingLoopBand}; with a fix matched inside the loop: ${g.tripsWithFixInLoopInterior}; arc jump >= 500 m across the band: ${g.tripsArcJumpOver500}; plan gap > 200 m: ${g.tripsPlanGapOver200}.`);
    L.push(`- Path changes off this path: ${g.pathChangesOffThisPath} (within 400 m of the loop start: ${g.pathChangesOffNearLoop}): ${g.pathChangesOffByStopAndMechanism.map(([k, v]) => `${k} ${v}`).join('; ')}.`);
    L.push(`- Path changes onto this path: ${g.pathChangesOntoThisPath}: ${g.pathChangesOntoByStopAndMechanism.map(([k, v]) => `${k} ${v}`).join('; ')}. Arc jumps on it: ${g.arcJumpsOnPath}.`);
    L.push('');
  }
  L.push('## Trips by prior path (top 20)');
  L.push('');
  L.push(mdTable(['prior path', 'trips seen'], Object.entries(r.tripsByPriorPath).slice(0, 20)));
  L.push('');
  L.push('## Event samples (first 40)');
  L.push('');
  L.push(mdTable(['time', 'veh', 'route', 'class', 'mechanism', 'from -> to', 'res k-3,k-2,k-1 (fresh) | old path now', 'off/ag', 'pool own/all', 'prior in pool', 'exc s', 'plan gap m', 'reverted s', 'stop (m)', 'terminal (m)'], r.events.slice(0, 40).map((e) => [e.clock, e.id, e.route, e.cls, e.mechanism, `${e.from} -> ${e.to}`, `${e.series.map((s) => fmt(s.res, 0)).join(',')} | ${fmt(e.oldResidualNow, 0)}`, `${e.prevOff}/${e.prevAg}`, `${e.ownPoolSize}/${e.poolSize}`, e.priorInPool ? 'y' : 'n', e.excursionS, fmt(e.planGapM, 0), fmt(e.revertedInS), `${e.nearestStop} (${e.nearestStopM})`, `${e.nearestTerminal} (${e.nearestTerminalM})`])));
  return L.join('\n');
}

/** Writes `<outPrefix>.json` (events and aggregates) and `<outPrefix>.md` (the tables). */
export async function writeReport(report: BranchReport, outPrefix: string): Promise<void> {
  await writeFile(`${outPrefix}.json`, JSON.stringify(report, null, 1));
  await writeFile(`${outPrefix}.md`, formatMarkdown(report) + '\n');
}
