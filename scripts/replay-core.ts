// The replay harness's pure core (task B8): the same `runTick` every
// production tick goes through (worker/twin/tick.ts), driven over a
// directory of recorded frames instead of a live upstream fetch. Reads and
// decodes every `.pb` file, orders them by the frame's OWN header time (a
// directory listing promises nothing else, and a missed republish leaves no
// file, so the next one on disk is simply the next tick -- there is no 304
// to replay), then folds them through the engine one at a time exactly as
// the twin would, tallying the health numbers the plan's Verification
// section asks for. No upstream fetch, no R2, no Durable Object: this is
// `node`-only and reuses the identical engine code the worker imports
// (shared/motion/*, worker/twin/{tick,engine,feed-decode,state,publish,clock}).
//
// Round F (task F7) added the grader rows the engine rebuild is judged by,
// all measured here before any engine change and re-measured after each:
// the signed hindsight (plan ahead of the tram, or behind), between-plan
// regressions (a re-plan that put a tram behind where the previous plan had
// it), fix-order violations (two fresh fixes on shared rails that contradict
// the published order), the phantom-stop count per path (geometric stops the
// path's patterns never call at, E0's motivation), and a client simulation:
// the real integrator (app/src/motion/integrator.ts) fed the very payloads
// the twin published, on a client clock, counting what a viewer would see --
// marks drawn backwards, marks drawn in the wrong order, marks holding still
// while their plan moved. Definitions in docs/kaj-verification.md.
//
// Kept separate from scripts/replay-twin.mjs (the CLI) so a vitest test can
// import it directly (vitest transpiles TS on the fly) while the CLI, which
// plain `node` must run against the repo's extensionless imports, bundles
// this one file with esbuild first.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { vehicleFixes } from '../app/src/motion/fixes';
import { createIntegrator } from '../app/src/motion/integrator';
import { dist, toPlane } from '../shared/motion/geo';
import { BUCKETS, emptyCounts, emptySignCounts, HORIZONS_S, SIGN_BUCKETS, type Bucket, type HindsightSignCounts, type Horizon } from '../shared/motion/hindsight';
import { HEADWAY_M } from '../shared/motion/laws';
import { decodeNetwork, type GraphNetwork, type Path } from '../shared/motion/network';
import { evalFreePlan, evalPathPlan } from '../shared/motion/plan';
import { lastFix, type PathKnot, type Plan } from '../shared/motion/track';
import { decodeTripIndex, type TripIndex } from '../shared/motion/trips';
import type { FeedPayload } from '../worker/feed/payload';
import type { FeedItem, ModuleSnapshot } from '../worker/feed/schema';
import { nextTickAt } from '../worker/twin/clock';
import { createEngine, type Engine } from '../worker/twin/engine';
import { decodeFeed, type DecodedFeed } from '../worker/twin/feed-decode';
import type { TripJoin } from '../worker/twin/publish';
import { emptyState, type TwinState } from '../worker/twin/state';
import { runTick } from '../worker/twin/tick';
import type { ZetRoutes } from '../worker/feed/modules/zet-routes';

/** Wall-clock offset applied to a frame's header time to get the twin's own
 *  `now`: production fetches a few seconds after ZET publishes (the alarm's
 *  own cushion, worker/twin/clock.ts's TICK_CUSHION_MS), and the corridor
 *  tests already settled on +2 s as a representative delay
 *  (test/twin/tick.test.ts, test/motion/engine-envelope.test.ts); replay
 *  reuses that number rather than inventing a new one. */
export const REPLAY_NOW_CUSHION_S = 2;

/** How far ahead a plan is read to decide "is this vehicle's plan moving":
 *  long enough that a tram standing through one dwell (20 s in every
 *  fixture) has necessarily departed again, short enough to stay well
 *  inside the planner's own 90 s horizon (shared/motion/plan.ts
 *  PLAN_AHEAD_S). Matches the look-ahead test/motion/engine-envelope.test.ts
 *  already uses for the same judgement. */
export const MOVING_LOOKAHEAD_S = 30;

/** Metres of progress over that look-ahead below which a plan counts as
 *  "still", reusing the exact threshold test/motion/engine-envelope.test.ts
 *  validates against the simulator's own ground truth, rather than a new
 *  number nothing has proven. */
export const MOVING_MIN_M = 20;

/** A re-plan that puts a tram this far behind where the previous plan had
 *  it at the same instant is a between-plan regression: one tram length
 *  (HEADWAY_M) would be the mark visibly jumping back; 25 m is the first
 *  hindsight bucket's bound, the smallest step a viewer reads as a
 *  correction rather than jitter. */
export const REGRESSION_M = 25;

/** Two fresh fixes at most this far apart in time are read as simultaneous
 *  for the order check: half a tick, so ZET's own report latency between two
 *  vehicles in one frame cannot fake a crossing. */
export const ORDER_FIX_WINDOW_S = 5;

/** Fixes (or drawn marks) closer than one tram length along the rails have
 *  no order to violate (shared/motion/laws.ts: a pair within a headway is
 *  unordered), so a disagreement counts only beyond it. */
export const ORDER_MIN_GAP_M = HEADWAY_M;

/** The client clock: a poll lands this long after the header (the twin's
 *  own tick cushion of ~2 s plus the edge cache and the network), and the
 *  page draws at 12 Hz -- the kiosk's own frame budget under MapLibre, and
 *  coarse enough that a day of frames stays a minutes-long replay. */
export const CLIENT_POLL_LANDING_S = 3.5;
export const CLIENT_FRAME_HZ = 12;

/** A mark's arc receding by more than a centimetre between two frames is a
 *  backward frame: below that is floating point, above it is motion. */
export const BACKWARD_EPS_M = 0.01;

/** A frame counts as a hold when the mark did not advance (within the same
 *  centimetre) while its plan target advanced by more than half a metre --
 *  a target moving slower than that in one frame is a tram crawling into a
 *  stop, not a mark that fell behind. */
export const HOLD_TARGET_ADVANCE_M = 0.5;

/** A poll gap longer than this is a hole in the recording, not a client
 *  that kept drawing: the client clock jumps to a minute before the next
 *  landing instead of stepping through the silence frame by frame. */
export const CLIENT_MAX_GAP_S = 60;

export interface FrameFile {
  path: string;
  feed: DecodedFeed;
}

/** Reads and decodes every `.pb` file directly inside `dir` (no recursion:
 *  point the harness at one day's already-pulled folder, e.g. the
 *  `zet-rt/2026/09/17/` a wrangler loop below wrote). */
export async function loadFrameFiles(dir: string): Promise<FrameFile[]> {
  const names = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.pb'));
  const files: FrameFile[] = [];
  for (const name of names) {
    const path = join(dir, name);
    const bytes = new Uint8Array(await readFile(path));
    files.push({ path, feed: decodeFeed(bytes) });
  }
  return files;
}

/** Ascending by the frame's own header time -- the directory's file names
 *  are not trusted (R2 listing order is not header order, and the harness
 *  should not care how the frames were pulled). A frame with no header
 *  (empty bytes, a malformed capture) carries no ordering information and is
 *  dropped, counted separately. */
export function orderFrames(files: readonly FrameFile[]): { ordered: DecodedFeed[]; dropped: number } {
  const dated = files.filter((f) => f.feed.headerTs !== null);
  const ordered = [...dated].sort((a, b) => a.feed.headerTs! - b.feed.headerTs!).map((f) => f.feed);
  return { ordered, dropped: files.length - dated.length };
}

export interface BucketPercentile {
  bucket: Bucket;
  /** The bucket's own upper bound in metres (Infinity for `ge200`): the
   *  percentile is stated as "under this bucket's bound", never a guessed
   *  number inside it -- the same convention worker/stats/page.ts uses for
   *  the live /stats hindsight line, since the twin only ever counts
   *  buckets, not raw metres (R-TE31). */
  upperBoundM: number;
  samples: number;
}

const BUCKET_UPPER_BOUND_M: Record<Bucket, number> = { lt25: 25, lt50: 50, lt100: 100, lt200: 200, ge200: Infinity };

function bucketPercentile(counts: Record<Bucket, number>, share: number): BucketPercentile | null {
  const total = BUCKETS.reduce((sum, b) => sum + counts[b], 0);
  if (total === 0) return null;
  let cumulative = 0;
  for (const bucket of BUCKETS) {
    cumulative += counts[bucket];
    if (cumulative / total >= share) return { bucket, upperBoundM: BUCKET_UPPER_BOUND_M[bucket], samples: total };
  }
  return { bucket: 'ge200', upperBoundM: Infinity, samples: total };
}

function numericPercentile(values: readonly number[], share: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
}

export interface HorizonReport {
  horizon: Horizon;
  samples: number;
  p50: BucketPercentile | null;
  p95: BucketPercentile | null;
}

/** A counted event over the pairs it was checked on. */
export interface CountOf {
  count: number;
  pairs: number;
}

export interface ClientReport {
  /** Frames stepped, and tram-frames judged (a tram drawn on a graph path). */
  frames: number;
  tramFrames: number;
  /** A tram's drawn arc receding between two frames on one geometry. Must be 0 (round F). */
  backwardFrames: number;
  /** Pairs of trams on shared rails entering the state "drawn in the wrong
   *  order against plans more than a tram length apart". Must be 0 (round F). */
  crossings: number;
  holdFrames: number;
  holdShare: number | null;
  holds: number;
  meanHoldS: number | null;
}

export interface PathStopCount {
  pathIdx: number;
  id: string;
  route: string;
  synthetic: boolean;
  /** Patterns of the trip index that run this path (its shape, or the synthetic path itself). */
  patterns: number;
  /** Stops geometrically on the path's edges (graph.ts stopsOnPathGeometric). */
  geometric: number;
  /** Entries of the list the ENGINE reads (graph.ts stopsOnPath) that some
   *  pattern of the path calls at: the artefact's served list at v3, the
   *  geometric derivation for a path that carries none. */
  served: number;
  /** Entries of that same list no pattern of the path calls at: the phantoms
   *  E0 removes. Zero once every path carries a served list, by construction
   *  -- and a cross-check between the two artefacts, which are cut from the
   *  same feed but by different scripts. */
  phantom: number;
}

export interface PathStopTotals {
  paths: number;
  geometric: number;
  served: number;
  phantom: number;
  medianGeometric: number | null;
  medianServed: number | null;
  medianPhantom: number | null;
}

export interface PhantomReport {
  paths: PathStopCount[];
  total: PathStopTotals;
  shapePaths: PathStopTotals;
  syntheticPaths: PathStopTotals;
  /** Shape paths no pattern of the index runs: nothing to compare against, left out of the totals. */
  unusedPaths: number;
}

export interface ReplayReport {
  frames: number;
  droppedFrames: number;
  vehicles: number;
  hindsight: Record<Horizon, HorizonReport>;
  /** The same graded fixes by sign (F7): the ahead share is the round's target. */
  hindsightSign: HindsightSignCounts;
  regressions: CountOf;
  orderViolations: CountOf;
  phantoms: PhantomReport;
  client: ClientReport;
  /** Order-law violations the harness could not attribute to a concession
   *  that same tick (shared/motion/laws.ts: a concession is the only
   *  sanctioned way two trams swap places). Must be 0. */
  overtakes: number;
  /** A published plan whose arc ran backwards in time. Must be 0. */
  reversals: number;
  concessions: number;
  /** Share of vehicle-tick observations whose trip resolved to a direction. */
  directionKnownShare: number | null;
  /** Share of trip-tick observations the index could not join. */
  unknownTripShare: number | null;
  /** Seconds from a vehicle's first appearance to its first moving plan. */
  firstMovingS: { p50: number | null; p95: number | null };
  /** Vehicles that appeared but never had a moving plan in the window. */
  neverMoved: number;
  tickMs: { p50: number | null; p95: number | null };
}

/** The static join per trip id, from the trip index alone (no SQLite
 *  fallback: a one-shot replay never restarts mid-run the way the Durable
 *  Object does, worker/do/twin-do.ts's `joinsFor`). */
function joinsFor(index: TripIndex, tripIds: Iterable<string>): Map<string, TripJoin> {
  const out = new Map<string, TripJoin>();
  for (const id of tripIds) {
    const record = index.tripsById.get(id);
    if (!record) continue;
    const pattern = index.patterns[record.pattern];
    if (!pattern) continue;
    out.set(id, { direction: pattern.direction === 1 ? 1 : 0, headsign: pattern.headsign, shapeId: pattern.shape === '' ? null : pattern.shape, startSec: record.start });
  }
  return out;
}

// ---- Arcs between paths -----------------------------------------------------
//
// The same two helpers shared/motion/laws.ts keeps private (edgeAt, mapArc),
// copied here rather than exported so the laws file stays untouched, and
// with a binary search over the offsets and an edge index per path: the
// client simulation maps arcs a thousand times per frame, where the laws
// map them a few times per tick.

interface PathFrames {
  /** The edge under arc `s` of a path, and the arc within that edge. */
  edgeAt(pathIdx: number, s: number): { edge: number; arc: number };
  /** Arc `s` of path `from` expressed on path `to`, or null when `to` does
   *  not run the edge `from` is on at that arc (the two have diverged). */
  mapArc(from: number, s: number, to: number): number | null;
  /** Whether path `pathIdx` runs edge `edge`. */
  runs(pathIdx: number, edge: number): boolean;
}

function pathFrames(paths: readonly Path[]): PathFrames {
  // First occurrence wins, exactly as laws.ts's `to.edges.indexOf(edge)`
  // does: no path in the artefact runs an edge twice today, but a measurement
  // that judged a law must map arcs the way that law does.
  const edgeIndex: Map<number, number>[] = paths.map((path) => {
    const index = new Map<number, number>();
    path.edges.forEach((e, k) => {
      if (!index.has(e)) index.set(e, k);
    });
    return index;
  });
  function edgeAt(pathIdx: number, s: number): { edge: number; arc: number } {
    const path = paths[pathIdx];
    let lo = 0;
    let hi = path.edges.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (path.offsets[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return { edge: path.edges[lo], arc: s - path.offsets[lo] };
  }
  return {
    edgeAt,
    mapArc(from, s, to) {
      if (from === to) return s;
      const { edge, arc } = edgeAt(from, s);
      const k = edgeIndex[to].get(edge);
      return k === undefined ? null : paths[to].offsets[k] + arc;
    },
    runs: (pathIdx, edge) => edgeIndex[pathIdx].has(edge),
  };
}

// ---- The grader over published plans ---------------------------------------

/** One tram as the grader reads it at one tick: its published path plan
 *  (knots relative to that tick's header), its latest fix's arc on the same
 *  path and report time, whether that fix arrived this tick, and the rail
 *  edge under the fix. */
export interface GradedVehicle {
  id: string;
  tripId: string | null;
  pathIdx: number;
  knots: readonly PathKnot[];
  fixS: number;
  fixSec: number;
  fresh: boolean;
  edge: number | null;
}

export interface TickSnapshot {
  headerSec: number;
  vehicles: GradedVehicle[];
}

export interface Grader {
  observe(snapshot: TickSnapshot): void;
  report(): { regressions: CountOf; orderViolations: CountOf };
}

/** Every tram with a path plan this tick, as the grader wants it. `fresh`
 *  names the vehicles whose newest fix arrived this tick. `fixS` is the
 *  match's arc, which shared/motion/plan.ts builds the plan from in the same
 *  tick, so the two are arcs on one path; the guard states that invariant
 *  rather than trusting it, since a fix arc read against another path's
 *  offsets would silently poison both counters. */
export function snapshotOf(state: TwinState, headerSec: number, fresh: ReadonlySet<string>): TickSnapshot {
  const vehicles: GradedVehicle[] = [];
  for (const track of Object.values(state.tracks)) {
    if (track.kind !== 'tram' || !track.plan || track.plan.on !== 'path') continue;
    if (track.match.pathIdx !== track.plan.pathIdx) continue;
    const fix = lastFix(track);
    if (!fix) continue;
    vehicles.push({
      id: track.id,
      tripId: track.tripId,
      pathIdx: track.plan.pathIdx,
      knots: track.plan.knots.map(([t, s]) => [t, s] as PathKnot),
      fixS: track.match.s,
      fixSec: fix.atSec,
      fresh: fresh.has(track.id),
      edge: track.match.edge,
    });
  }
  return { headerSec, vehicles };
}

/**
 * Counts, tick by tick, the two things a published plan can do wrong that
 * hindsight alone does not show:
 *
 * Between-plan regression: for a tram with plans at consecutive ticks k and
 * k+1 (same trip), both evaluated at the header of k+1; counted when plan
 * k+1 is behind plan k by more than REGRESSION_M. A trip change is a
 * turnaround, not a regression, and is skipped.
 *
 * Fix-order violation: two trams on shared rails (one's edge under its fix
 * lies on the other's path) whose fresh fixes are within ORDER_FIX_WINDOW_S
 * of each other; both fixes and both plans (at the header) are mapped onto
 * one of the two paths; counted when the plans' order contradicts the
 * fixes' order and the fixes differ by more than ORDER_MIN_GAP_M.
 */
export function createGrader(net: GraphNetwork): Grader {
  const frames = pathFrames(net.paths);
  const regressions: CountOf = { count: 0, pairs: 0 };
  const orderViolations: CountOf = { count: 0, pairs: 0 };
  let previous: TickSnapshot | null = null;

  /** Both vehicles' fixes and plans (at the header) on one path, or null when the paths have diverged at either. */
  function commonFrame(a: GradedVehicle, b: GradedVehicle): { fixA: number; fixB: number; planA: number; planB: number } | null {
    const planA = evalPathPlan(a.knots, 0);
    const planB = evalPathPlan(b.knots, 0);
    const onA = { fixB: frames.mapArc(b.pathIdx, b.fixS, a.pathIdx), planB: frames.mapArc(b.pathIdx, planB, a.pathIdx) };
    if (onA.fixB !== null && onA.planB !== null) return { fixA: a.fixS, fixB: onA.fixB, planA, planB: onA.planB };
    const onB = { fixA: frames.mapArc(a.pathIdx, a.fixS, b.pathIdx), planA: frames.mapArc(a.pathIdx, planA, b.pathIdx) };
    if (onB.fixA !== null && onB.planA !== null) return { fixA: onB.fixA, fixB: b.fixS, planA: onB.planA, planB };
    return null;
  }

  return {
    observe(snapshot) {
      if (previous) {
        const dt = snapshot.headerSec - previous.headerSec;
        const before = new Map(previous.vehicles.map((v) => [v.id, v]));
        for (const v of snapshot.vehicles) {
          const u = before.get(v.id);
          if (!u || u.tripId !== v.tripId) continue;
          const then = frames.mapArc(u.pathIdx, evalPathPlan(u.knots, dt), v.pathIdx);
          if (then === null) continue;
          regressions.pairs++;
          if (then - evalPathPlan(v.knots, 0) > REGRESSION_M) regressions.count++;
        }
      }
      previous = snapshot;

      const fresh = snapshot.vehicles.filter((v) => v.fresh && v.edge !== null);
      for (let i = 0; i < fresh.length; i++) {
        for (let j = i + 1; j < fresh.length; j++) {
          const a = fresh[i];
          const b = fresh[j];
          if (Math.abs(a.fixSec - b.fixSec) > ORDER_FIX_WINDOW_S) continue;
          if (!frames.runs(b.pathIdx, a.edge!) && !frames.runs(a.pathIdx, b.edge!)) continue;
          const common = commonFrame(a, b);
          if (!common) continue;
          const fixDiff = common.fixA - common.fixB;
          if (Math.abs(fixDiff) <= ORDER_MIN_GAP_M) continue;
          orderViolations.pairs++;
          if ((common.planA - common.planB) * fixDiff < 0) orderViolations.count++;
        }
      }
    },
    report: () => ({ regressions: { ...regressions }, orderViolations: { ...orderViolations } }),
  };
}

// ---- The client simulation --------------------------------------------------

export interface ClientSimulation {
  /** Fold one published payload as the client's poll lands at `landedMs`. */
  poll(payload: FeedPayload, landedMs: number): void;
  /** Draw one frame at `nowMs` and judge it. */
  step(nowMs: number): void;
  report(): ClientReport;
}

/** The wire decoder's own evaluation of a plan at an absolute instant (app/src/motion/integrator.ts evalPath). */
function evalAbsolute(knots: readonly (readonly [number, number])[], tMs: number): number {
  if (knots.length === 0) return 0;
  if (tMs <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [t0, s0] = knots[i - 1];
    const [t1, s1] = knots[i];
    if (tMs <= t1) return t1 === t0 ? s1 : s0 + ((tMs - t0) / (t1 - t0)) * (s1 - s0);
  }
  return knots[knots.length - 1][1];
}

/**
 * The real integrator over the real wire: every payload the replayed twin
 * published is decoded exactly as the page decodes it (app/src/motion/fixes.ts
 * resolves the header-relative knot times against `sourceUpdatedAt`) and
 * folded at the poll's landing; frames are drawn at CLIENT_FRAME_HZ between
 * polls. Judged per tram drawn on a graph path:
 *
 * - backward frame: the drawn arc receded by more than BACKWARD_EPS_M since
 *   the previous frame on the same geometry;
 * - hold frame: the drawn arc did not advance while the plan target did by
 *   more than HOLD_TARGET_ADVANCE_M; consecutive hold frames are one hold,
 *   whose length is reported in seconds;
 * - crossing: two trams on shared rails whose drawn order, mapped onto one
 *   path, contradicts their plan targets' order while those targets are
 *   more than ORDER_MIN_GAP_M apart; counted once per pair entering that
 *   state, not per frame it lasts.
 */
export function createClientSimulation(net: GraphNetwork): ClientSimulation {
  const model = createIntegrator(net);
  const frames = pathFrames(net.paths);
  const pathIndex = new Map(net.paths.map((p, i) => [p.id, i] as const));
  /** The latest folded path plan per tram, absolute knot times. */
  const plans = new Map<string, { pathIdx: number; knots: readonly (readonly [number, number])[] }>();
  let previous = new Map<string, { path: number; s: number; target: number }>();
  const holdRun = new Map<string, number>();
  const holdLengths: number[] = [];
  let candidates: [string, string, string][] = [];
  const crossed = new Set<string>();
  const counts = { frames: 0, tramFrames: 0, backwardFrames: 0, crossings: 0, holdFrames: 0 };

  function endHold(id: string): void {
    const run = holdRun.get(id);
    if (run) holdLengths.push(run / CLIENT_FRAME_HZ);
    holdRun.delete(id);
  }

  return {
    poll(payload, landedMs) {
      // Only what vehicleFixes reads: the snapshot's source time, its fetch
      // time as the fallback date, and the items.
      const snapshot = {
        module: 'zet-rt',
        tier: 'open',
        status: 'live',
        fetchedAt: new Date(landedMs).toISOString(),
        ...(payload.sourceUpdatedAt !== undefined ? { sourceUpdatedAt: payload.sourceUpdatedAt } : {}),
        attribution: { text: '', url: '', licence: '' },
        items: payload.items as FeedItem[],
      } satisfies ModuleSnapshot;
      const fixes = vehicleFixes(snapshot, landedMs);
      model.update(fixes, landedMs);

      plans.clear();
      for (const fix of fixes) {
        if (!fix.plan || fix.plan.on !== 'path' || fix.path === undefined) continue;
        const pathIdx = pathIndex.get(fix.path);
        if (pathIdx === undefined) continue; // a bus shape: no rails, no order
        const type = (fix.routeId !== undefined ? net.routes.get(fix.routeId)?.type : undefined) ?? fix.type;
        if (type !== 0) continue;
        plans.set(fix.id, { pathIdx, knots: fix.plan.knots });
      }
      // Candidate pairs on shared rails, from where the plans put the trams
      // as this poll lands: one's edge lies on the other's path.
      const byEdge = new Map<number, string[]>();
      for (const [id, plan] of plans) {
        const { edge } = frames.edgeAt(plan.pathIdx, evalAbsolute(plan.knots, landedMs));
        const list = byEdge.get(edge);
        if (list) list.push(id);
        else byEdge.set(edge, [id]);
      }
      candidates = [];
      const seen = new Set<string>();
      for (const [id, plan] of plans) {
        for (const edge of net.paths[plan.pathIdx].edges) {
          for (const other of byEdge.get(edge) ?? []) {
            if (other === id) continue;
            const key = id < other ? `${id}|${other}` : `${other}|${id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            candidates.push([key, id, other]);
          }
        }
      }
      for (const key of crossed) if (!seen.has(key)) crossed.delete(key);
    },

    step(nowMs) {
      const drawn = model.step(nowMs);
      counts.frames++;
      const current = new Map<string, { path: number; s: number; target: number }>();
      for (const d of drawn) {
        if (d.type !== 0 || d.path === undefined || d.s === undefined) continue;
        const plan = plans.get(d.id);
        if (!plan || plan.pathIdx !== d.path) continue;
        const target = evalAbsolute(plan.knots, nowMs);
        counts.tramFrames++;
        const prev = previous.get(d.id);
        if (prev && prev.path === d.path) {
          const ds = d.s - prev.s;
          if (ds < -BACKWARD_EPS_M) counts.backwardFrames++;
          if (ds <= BACKWARD_EPS_M && target - prev.target > HOLD_TARGET_ADVANCE_M) {
            counts.holdFrames++;
            holdRun.set(d.id, (holdRun.get(d.id) ?? 0) + 1);
          } else {
            endHold(d.id);
          }
        } else {
          endHold(d.id);
        }
        current.set(d.id, { path: d.path, s: d.s, target });
      }
      for (const id of previous.keys()) if (!current.has(id)) endHold(id);
      previous = current;

      for (const [key, a, b] of candidates) {
        const da = current.get(a);
        const db = current.get(b);
        if (!da || !db) continue;
        let sA: number | null = da.s;
        let tA: number | null = da.target;
        let sB = frames.mapArc(db.path, db.s, da.path);
        let tB = frames.mapArc(db.path, db.target, da.path);
        if (sB === null || tB === null) {
          sB = db.s;
          tB = db.target;
          sA = frames.mapArc(da.path, da.s, db.path);
          tA = frames.mapArc(da.path, da.target, db.path);
          if (sA === null || tA === null) continue;
        }
        const planDiff = tA - tB;
        const isCrossed = Math.abs(planDiff) > ORDER_MIN_GAP_M && (sA - sB) * planDiff < 0;
        if (!isCrossed) crossed.delete(key);
        else if (!crossed.has(key)) {
          crossed.add(key);
          counts.crossings++;
        }
      }
    },

    report() {
      for (const id of [...holdRun.keys()]) endHold(id);
      const holds = holdLengths.length;
      return {
        ...counts,
        holdShare: counts.tramFrames > 0 ? counts.holdFrames / counts.tramFrames : null,
        holds,
        meanHoldS: holds > 0 ? holdLengths.reduce((a, b) => a + b, 0) / holds : null,
      };
    },
  };
}

// ---- Phantom stops -------------------------------------------------------------

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stopTotals(paths: readonly PathStopCount[]): PathStopTotals {
  return {
    paths: paths.length,
    geometric: paths.reduce((sum, p) => sum + p.geometric, 0),
    served: paths.reduce((sum, p) => sum + p.served, 0),
    phantom: paths.reduce((sum, p) => sum + p.phantom, 0),
    medianGeometric: median(paths.map((p) => p.geometric)),
    medianServed: median(paths.map((p) => p.served)),
    medianPhantom: median(paths.map((p) => p.phantom)),
  };
}

/**
 * Per path, the stops geometrically on its edges against the list the engine
 * reads and the stops its patterns actually call at: for a shape path the
 * union of every pattern of the trip index that runs that shape (short-turn
 * variants included), for a synthetic `path:` id the stop sequence the path
 * itself was routed through. An entry of the engine's list whose stop id is
 * in neither is a phantom -- a platform of another line on the same rails
 * that the planner would dwell at (design section E0). Static: depends on
 * the two artefacts, not the frames.
 */
export function phantomStops(engine: Engine): PhantomReport {
  const servedByShape = new Map<string, { stops: Set<string>; patterns: number }>();
  for (const pattern of engine.index.patterns) {
    if (pattern.shape === '') continue;
    const entry = servedByShape.get(pattern.shape) ?? { stops: new Set<string>(), patterns: 0 };
    for (const stop of pattern.stops) entry.stops.add(stop);
    entry.patterns++;
    servedByShape.set(pattern.shape, entry);
  }
  const paths: PathStopCount[] = [];
  let unusedPaths = 0;
  engine.net.paths.forEach((path, pathIdx) => {
    const synthetic = path.shape === null;
    const served = synthetic ? { stops: new Set(path.stops ?? []), patterns: 1 } : servedByShape.get(path.id);
    if (!served) {
      unusedPaths++;
      return;
    }
    const entries = engine.net.stopsOnPath(pathIdx);
    const servedCount = entries.filter((entry) => served.stops.has(entry.stop.id)).length;
    paths.push({
      pathIdx,
      id: path.id,
      route: path.route,
      synthetic,
      patterns: served.patterns,
      geometric: engine.net.stopsOnPathGeometric(pathIdx).length,
      served: servedCount,
      phantom: entries.length - servedCount,
    });
  });
  return {
    paths,
    total: stopTotals(paths),
    shapePaths: stopTotals(paths.filter((p) => !p.synthetic)),
    syntheticPaths: stopTotals(paths.filter((p) => p.synthetic)),
    unusedPaths,
  };
}

/** Metres (or, off geometry, plane metres) a plan covers between now and the
 *  look-ahead: the "is this vehicle's plan moving" test, both for tram/bus
 *  path plans and for a free-plane one. */
function movedM(plan: Plan): number {
  if (plan.on === 'free') {
    const a = evalFreePlan(plan.knots, 0);
    const b = evalFreePlan(plan.knots, MOVING_LOOKAHEAD_S);
    return dist(toPlane(a[0], a[1]), toPlane(b[0], b[1]));
  }
  return evalPathPlan(plan.knots, MOVING_LOOKAHEAD_S) - evalPathPlan(plan.knots, 0);
}

export interface ReplayOptions {
  /** Called with every tick's grader snapshot, for a test that wants to write a fault into one. */
  onSnapshot?: (snapshot: TickSnapshot) => void;
}

/**
 * Drives `frames` (already ordered by header time) through the twin's pure
 * tick, one call per frame -- a recorded directory holds only genuinely new
 * frames (worker/twin/record.ts records on a new header, never on a 304), so
 * there is no gap tick to synthesise here. Pure: no I/O, so a test can call
 * it directly over a hand-built frame list.
 */
export function replay(frames: readonly DecodedFeed[], engine: Engine, routes: ZetRoutes = {}, options: ReplayOptions = {}): ReplayReport {
  let state: TwinState = emptyState();
  const hindsightTotals = emptyCounts();
  const hindsightSignTotals = emptySignCounts();
  const grader = createGrader(engine.net);
  const client = createClientSimulation(engine.net);
  const frameMs = 1000 / CLIENT_FRAME_HZ;
  let nextFrameMs: number | null = null;
  const lastFixSec = new Map<string, number>();
  let concessions = 0;
  let reversals = 0;
  let overtakes = 0;
  let tripObservations = 0;
  let unknownTripObservations = 0;
  let vehicleObservations = 0;
  let directionKnownObservations = 0;
  const vehiclesSeen = new Set<string>();
  const firstSeenSec = new Map<string, number>();
  const firstMovingSec = new Map<string, number>();
  const tickMs: number[] = [];
  let previousBehind: Map<string, ReadonlySet<string>> | null = null;

  for (const feed of frames) {
    const headerSec = feed.headerTs ?? state.headerTs ?? 0;
    const nowMs = (headerSec + REPLAY_NOW_CUSHION_S) * 1000;
    const validUntilMs = nextTickAt(headerSec, nowMs);

    // Joins for every trip in view this tick (the frame's own plus every
    // track still followed), the same set worker/do/twin-do.ts builds.
    const tripIds = new Set<string>();
    for (const track of Object.values(state.tracks)) if (track.tripId !== null) tripIds.add(track.tripId);
    for (const vehicle of feed.vehicles) if (vehicle.tripId) tripIds.add(vehicle.tripId);
    const joins = joinsFor(engine.index, tripIds);
    for (const id of tripIds) {
      tripObservations++;
      if (!joins.has(id)) unknownTripObservations++;
    }

    const t0 = performance.now();
    const result = runTick({ state, feed, nowMs, joins, routes, engine, validUntilMs });
    tickMs.push(performance.now() - t0);
    state = result.state;

    for (const horizon of HORIZONS_S) for (const bucket of BUCKETS) hindsightTotals[horizon][bucket] += result.hindsight[horizon][bucket];
    for (const horizon of HORIZONS_S) for (const bucket of SIGN_BUCKETS) hindsightSignTotals[horizon][bucket] += result.hindsightSign[horizon][bucket];
    if (result.order) concessions += result.order.concessions;

    // The grader's view of this tick: which vehicles' newest fix is new
    // since the last tick (the tick's own `fresh` set, re-derived here).
    const fresh = new Set<string>();
    for (const track of Object.values(state.tracks)) {
      const fix = lastFix(track);
      if (!fix) continue;
      if (lastFixSec.get(track.id) !== fix.atSec) fresh.add(track.id);
      lastFixSec.set(track.id, fix.atSec);
    }
    for (const id of [...lastFixSec.keys()]) if (!state.tracks[id]) lastFixSec.delete(id);
    const snapshot = snapshotOf(state, headerSec, fresh);
    options.onSnapshot?.(snapshot);
    grader.observe(snapshot);

    // The client: frames up to this poll's landing, then the poll folds.
    // Nothing is drawn before the first payload lands (a page opens on an
    // empty map), and a hole in the recording is not a client that kept
    // drawing for hours: the clock skips to CLIENT_MAX_GAP_S before the next
    // landing rather than stepping through the silence frame by frame.
    const landedMs = (headerSec + CLIENT_POLL_LANDING_S) * 1000;
    if (nextFrameMs === null) nextFrameMs = landedMs;
    else if (landedMs - nextFrameMs > CLIENT_MAX_GAP_S * 1000) nextFrameMs = landedMs - CLIENT_MAX_GAP_S * 1000;
    while (nextFrameMs < landedMs) {
      client.step(nextFrameMs);
      nextFrameMs += frameMs;
    }
    client.poll(result.payload, landedMs);

    // Reversals: every tram plan's arc must be non-decreasing (R-TE7).
    // Buses are exempt (they may reverse); free plans carry no such law.
    for (const track of Object.values(state.tracks)) {
      if (track.kind !== 'tram' || !track.plan || track.plan.on === 'free') continue;
      const knots = track.plan.knots;
      for (let i = 1; i < knots.length; i++) if (knots[i][1] < knots[i - 1][1] - 1e-6) reversals++;
    }

    // Overtakes: enforceOrder's own bookkeeping (track.order.behind) records
    // who leads whom, and changes that relationship only through a
    // concession (shared/motion/laws.ts swaps leader and follower there and
    // nowhere else). So a "behind" flip this tick that is not covered by
    // this tick's concession count is a law violation the engine itself
    // failed to prevent -- the thing R-TE30's gate calls an overtake.
    const behindNow = new Map<string, ReadonlySet<string>>();
    for (const track of Object.values(state.tracks)) behindNow.set(track.id, new Set(track.order.behind));
    if (previousBehind) {
      let flips = 0;
      for (const [id, behindSet] of behindNow) {
        for (const leaderId of behindSet) if (previousBehind.get(leaderId)?.has(id)) flips++;
      }
      overtakes += Math.max(0, flips - (result.order?.concessions ?? 0));
    }
    previousBehind = behindNow;

    for (const item of result.payload.items) {
      if (!item.id.startsWith('vehicle:')) continue;
      vehicleObservations++;
      const vehicleId = item.id.slice('vehicle:'.length);
      vehiclesSeen.add(vehicleId);
      if (!firstSeenSec.has(vehicleId)) firstSeenSec.set(vehicleId, headerSec);
      if (item.data?.['direction'] !== undefined) directionKnownObservations++;
      const track = state.tracks[vehicleId];
      if (!firstMovingSec.has(vehicleId) && track?.plan && movedM(track.plan) >= MOVING_MIN_M) firstMovingSec.set(vehicleId, headerSec);
    }
  }

  // The last payload is drawn for one more tick, as a page would before its next poll.
  if (nextFrameMs !== null) {
    for (let k = 0; k < CLIENT_FRAME_HZ * 10; k++) {
      client.step(nextFrameMs);
      nextFrameMs += frameMs;
    }
  }

  const firstMovingDelays: number[] = [];
  for (const [id, seenSec] of firstSeenSec) {
    const movingSec = firstMovingSec.get(id);
    if (movingSec !== undefined) firstMovingDelays.push(movingSec - seenSec);
  }

  const hindsight = {} as Record<Horizon, HorizonReport>;
  for (const horizon of HORIZONS_S) {
    const counts = hindsightTotals[horizon];
    const samples = BUCKETS.reduce((sum, b) => sum + counts[b], 0);
    hindsight[horizon] = { horizon, samples, p50: bucketPercentile(counts, 0.5), p95: bucketPercentile(counts, 0.95) };
  }

  return {
    frames: frames.length,
    droppedFrames: 0,
    vehicles: vehiclesSeen.size,
    hindsight,
    hindsightSign: hindsightSignTotals,
    ...grader.report(),
    phantoms: phantomStops(engine),
    client: client.report(),
    overtakes,
    reversals,
    concessions,
    directionKnownShare: vehicleObservations > 0 ? directionKnownObservations / vehicleObservations : null,
    unknownTripShare: tripObservations > 0 ? unknownTripObservations / tripObservations : null,
    firstMovingS: { p50: numericPercentile(firstMovingDelays, 0.5), p95: numericPercentile(firstMovingDelays, 0.95) },
    neverMoved: firstSeenSec.size - firstMovingDelays.length,
    tickMs: { p50: numericPercentile(tickMs, 0.5), p95: numericPercentile(tickMs, 0.95) },
  };
}

export interface ReplayDirectoryOptions extends ReplayOptions {
  /** Caps the number of (header-ordered) frames replayed, for a quick pass over a large day. */
  limit?: number;
  routes?: ZetRoutes;
}

/** Loads, orders and replays a directory in one call -- what the CLI and a
 *  test both want, minus the CLI's own artefact loading. */
export async function replayDirectory(dir: string, engine: Engine, options: ReplayDirectoryOptions = {}): Promise<ReplayReport> {
  const files = await loadFrameFiles(dir);
  const { ordered, dropped } = orderFrames(files);
  const limited = options.limit !== undefined ? ordered.slice(0, options.limit) : ordered;
  const report = replay(limited, engine, options.routes ?? {}, { onSnapshot: options.onSnapshot });
  return { ...report, droppedFrames: dropped };
}

/** The engine over the two committed artefacts, decoded exactly as the twin
 *  decodes them (shared/motion/{network,trips}.ts) -- read from disk rather
 *  than fetched, since node has no ASSETS binding. For the CLI only; a test
 *  builds its own synthetic engine directly. */
export async function loadRealEngine(networkPath: string, tripsPath: string): Promise<Engine> {
  const [networkRaw, tripsRaw] = await Promise.all([
    readFile(networkPath, 'utf8').then((text) => JSON.parse(text) as unknown),
    readFile(tripsPath, 'utf8').then((text) => JSON.parse(text) as unknown),
  ]);
  const net: GraphNetwork = decodeNetwork(networkRaw);
  const index: TripIndex = decodeTripIndex(tripsRaw);
  return createEngine(net, index);
}

function fmtBucket(b: BucketPercentile | null): string {
  if (!b) return 'n/a';
  return b.upperBoundM === Infinity ? 'ge200m' : `<${b.upperBoundM}m`;
}

function fmtMs(n: number | null): string {
  return n === null ? 'n/a' : n.toFixed(2);
}

function fmtS(n: number | null): string {
  return n === null ? 'n/a' : String(n);
}

function fmtShare(n: number | null): string {
  return n === null ? 'n/a' : `${(n * 100).toFixed(1)}%`;
}

function fmtN(n: number | null, digits = 1): string {
  return n === null ? 'n/a' : n.toFixed(digits);
}

function fmtStopTotals(t: PathStopTotals): string {
  return `${t.paths} paths, ${t.geometric} geometric / ${t.served} served / ${t.phantom} phantom, median per path ${fmtN(t.medianGeometric)} / ${fmtN(t.medianServed)} / ${fmtN(t.medianPhantom)}`;
}

/** The one table the harness prints: everything the plan's Verification →
 *  Replay section asks for, in reading order. */
export function formatTable(report: ReplayReport): string {
  const lines: string[] = [];
  lines.push('twin replay report');
  lines.push('-------------------');
  lines.push(`frames processed:        ${report.frames} (dropped, no header: ${report.droppedFrames})`);
  lines.push(`vehicles seen:           ${report.vehicles}`);
  lines.push('');
  lines.push('hindsight, bucket p50 / p95 (n graded fixes):');
  for (const horizon of HORIZONS_S) {
    const h = report.hindsight[horizon];
    lines.push(`  ${String(horizon).padStart(2, ' ')}s:  p50 ${fmtBucket(h.p50).padEnd(7)} p95 ${fmtBucket(h.p95).padEnd(7)} (n=${h.samples})`);
  }
  lines.push('');
  lines.push('signed hindsight, share of graded fixes (plan >=50 m ahead of the tram / within 50 m / >=50 m behind):');
  for (const horizon of HORIZONS_S) {
    const signed = report.hindsightSign[horizon];
    const n = signed.ahead_ge50 + signed.within50 + signed.behind_ge50;
    const share = (k: number) => (n > 0 ? fmtShare(k / n) : 'n/a');
    lines.push(`  ${String(horizon).padStart(2, ' ')}s:  ahead ${share(signed.ahead_ge50).padEnd(6)} within ${share(signed.within50).padEnd(6)} behind ${share(signed.behind_ge50).padEnd(6)} (n=${n})`);
  }
  lines.push('');
  // The two grader labels carry their own constants, so they are padded to a
  // common width rather than spaced by hand: the table is pasted verbatim
  // into docs/kaj-verification.md and has to line up there.
  const graderLabel = (text: string): string => text.padEnd(38, ' ');
  lines.push(`${graderLabel(`between-plan regressions (>${REGRESSION_M} m):`)}${report.regressions.count}  (of ${report.regressions.pairs} consecutive plan pairs)`);
  lines.push(`${graderLabel(`fix-order violations (<=${ORDER_FIX_WINDOW_S} s, >${ORDER_MIN_GAP_M} m):`)}${report.orderViolations.count}  (of ${report.orderViolations.pairs} fresh pairs on shared rails)`);
  lines.push(`phantom stops:           ${report.phantoms.total.phantom} of ${report.phantoms.total.geometric} geometric entries on ${report.phantoms.total.paths} paths (${report.phantoms.total.served} served)`);
  lines.push(`  shape paths:           ${fmtStopTotals(report.phantoms.shapePaths)}`);
  lines.push(`  synthetic paths:       ${fmtStopTotals(report.phantoms.syntheticPaths)}`);
  lines.push(`  paths without pattern: ${report.phantoms.unusedPaths} (left out)`);
  lines.push('');
  lines.push(`client simulation (polls land at header + ${CLIENT_POLL_LANDING_S} s, ${CLIENT_FRAME_HZ} Hz; ${report.client.frames} frames, ${report.client.tramFrames} tram-frames):`);
  lines.push(`  backward frames (must be 0):        ${report.client.backwardFrames}`);
  lines.push(`  visible crossings (must be 0):      ${report.client.crossings}`);
  lines.push(`  hold-time share:                    ${fmtShare(report.client.holdShare)}  mean hold length: ${fmtN(report.client.meanHoldS)} s  (${report.client.holds} holds)`);
  lines.push('');
  lines.push(`overtakes (must be 0):   ${report.overtakes}`);
  lines.push(`reversals (must be 0):   ${report.reversals}`);
  lines.push(`concessions:             ${report.concessions}`);
  lines.push(`direction known share:   ${fmtShare(report.directionKnownShare)}`);
  lines.push(`unknown-trip share:      ${fmtShare(report.unknownTripShare)}`);
  lines.push(`first moving plan (s):   p50 ${fmtS(report.firstMovingS.p50)}  p95 ${fmtS(report.firstMovingS.p95)}  (never moved: ${report.neverMoved})`);
  lines.push(`per-tick wall time (ms): p50 ${fmtMs(report.tickMs.p50)}  p95 ${fmtMs(report.tickMs.p95)}`);
  return lines.join('\n');
}
