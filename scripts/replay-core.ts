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
// Kept separate from scripts/replay-twin.mjs (the CLI) so a vitest test can
// import it directly (vitest transpiles TS on the fly) while the CLI, which
// plain `node` must run against the repo's extensionless imports, bundles
// this one file with esbuild first.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { dist, toPlane } from '../shared/motion/geo';
import { BUCKETS, emptyCounts, HORIZONS_S, type Bucket, type Horizon } from '../shared/motion/hindsight';
import { decodeNetwork, type GraphNetwork } from '../shared/motion/network';
import { evalFreePlan, evalPathPlan } from '../shared/motion/plan';
import type { Plan } from '../shared/motion/track';
import { decodeTripIndex, type TripIndex } from '../shared/motion/trips';
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

export interface ReplayReport {
  frames: number;
  droppedFrames: number;
  vehicles: number;
  hindsight: Record<Horizon, HorizonReport>;
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
    out.set(id, { direction: pattern.direction === 1 ? 1 : 0, headsign: pattern.headsign, shapeId: pattern.shape === '' ? null : pattern.shape });
  }
  return out;
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

/**
 * Drives `frames` (already ordered by header time) through the twin's pure
 * tick, one call per frame -- a recorded directory holds only genuinely new
 * frames (worker/twin/record.ts records on a new header, never on a 304), so
 * there is no gap tick to synthesise here. Pure: no I/O, so a test can call
 * it directly over a hand-built frame list.
 */
export function replay(frames: readonly DecodedFeed[], engine: Engine, routes: ZetRoutes = {}): ReplayReport {
  let state: TwinState = emptyState();
  const hindsightTotals = emptyCounts();
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
    if (result.order) concessions += result.order.concessions;

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

export interface ReplayDirectoryOptions {
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
  const report = replay(limited, engine, options.routes ?? {});
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
  lines.push(`overtakes (must be 0):   ${report.overtakes}`);
  lines.push(`reversals (must be 0):   ${report.reversals}`);
  lines.push(`concessions:             ${report.concessions}`);
  lines.push(`direction known share:   ${fmtShare(report.directionKnownShare)}`);
  lines.push(`unknown-trip share:      ${fmtShare(report.unknownTripShare)}`);
  lines.push(`first moving plan (s):   p50 ${fmtS(report.firstMovingS.p50)}  p95 ${fmtS(report.firstMovingS.p95)}  (never moved: ${report.neverMoved})`);
  lines.push(`per-tick wall time (ms): p50 ${fmtMs(report.tickMs.p50)}  p95 ${fmtMs(report.tickMs.p95)}`);
  return lines.join('\n');
}
