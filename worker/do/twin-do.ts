// TwinDO: the one observer of ZET's realtime feed and the one place the
// motion engine runs. A singleton that wakes on its own alarm every 10 s in
// step with the feed's republish, fetches the frame once with a conditional
// GET, hands it to the engine's tick (worker/twin/tick.ts: match, speed,
// plan, laws, hindsight), remembers the fleet in a state row so an eviction
// between two alarms loses nothing, records the raw bytes for replay, counts
// its own hindsight into MetricsDO, and publishes one payload the feed
// pipeline serves from its per-colo cache (worker/feed/modules/zet-rt.ts
// asks `publish()`). Owner decision D1: the engine lives here, on the
// server, so every viewer sees one world and the first frame of a fresh page
// already moves.
//
// Alarm discipline (the reviewer's A6): alarms are at-least-once and may run
// late, and the object may be evicted between two of them. So `alarm()` arms
// the next alarm before it does anything, never throws (a throwing alarm is
// retried with backoff and would double-fetch), keys a tick by the feed's
// header time (a repeat is "no new evidence", but still a re-plan), refuses
// to fetch twice within the floor, and rebuilds its memory from the last
// state row on a cold start. The static assets (index, network) load lazily
// behind memoised, never-throwing promises; a tick without them still
// publishes free-plane plans rather than nothing.

import { DurableObject } from 'cloudflare:workers';
import type { OrderReport } from '../../shared/motion/laws';
import type { GraphNetwork } from '../../shared/motion/network';
import type { TripIndex } from '../../shared/motion/trips';
import type { Env } from '../env';
import type { FeedPayload } from '../feed/payload';
import { loadZetRoutes, type ZetRoutes } from '../feed/modules/zet-routes';
import { logError, logInfo } from '../log';
import { metricsStub, recordMetric } from '../metrics';
import type { MetricsEntry } from '../metrics-do';
import { TICK_MIN_DELAY_MS, nextTickAt } from '../twin/clock';
import { createEngine, type Engine } from '../twin/engine';
import { decodeFeed } from '../twin/feed-decode';
import { BUCKETS, horizonKey, type HindsightCounts, type HindsightSignCounts, HORIZONS_S, SIGN_BUCKETS } from '../../shared/motion/hindsight';
import { emptyAggregates, emptyHistogram, histogramMedian, isEmptyAggregates, mergeAggregates, mergeHistograms, parseKey, recordEvidence, type LearnedAggregates } from '../../shared/motion/learn';
import { indexRowsFromIndex } from '../twin/index-load';
import {
  INDEX_RECHECK_MS,
  LEARN_FLUSH_MS,
  ensureSchema,
  flushLearned,
  indexCheckedAt,
  indexFeedVersion,
  learnFlushedAt,
  loadLatestState,
  loadLearned,
  lookupTrips,
  markIndexChecked,
  markLearnFlushed,
  replaceIndex,
  saveState,
} from '../twin/persist';
import { buildPayload, type TripJoin } from '../twin/publish';
import { recordFrame, type RecordOutcome } from '../twin/record';
import { twinIndexSource, twinNetworkSource, twinUpstream } from '../twin/seams';
import { emptyState, type TwinState } from '../twin/state';
import { runTick } from '../twin/tick';
import { TWIN_DO_NAME } from '../twin/twin-name';

export { TWIN_DO_NAME };

/** Above this share of tracked vehicles whose trip the index does not know,
 *  the static feed has moved on (ZET published a new timetable and the
 *  built index is behind): the tick reports `stale_index` so /stats shows
 *  it. Half, because a handful of unknown trips (an unscheduled extra, a
 *  depot move with a placeholder id) is normal on any day. */
export const STALE_INDEX_SHARE = 0.5;

export type TickOutcome = 'ok' | 'unchanged' | 'error' | 'stale_index';

export interface TickReport {
  outcome: TickOutcome;
  headerTs: number | null;
  newFixes: number;
  evicted: number;
  unknownTrips: number;
  vehicles: number;
  /** True when this tick started with no state in memory (a fresh or evicted object). */
  cold: boolean;
  indexLoaded: boolean;
  networkLoaded: boolean;
  recorded: RecordOutcome | 'unchanged';
  order: OrderReport | null;
  /** Graded fixes this tick, summed over horizons. */
  hindsightSamples: number;
  /** Bytes of the state row written this tick. */
  stateBytes: number;
  /** Evidence mined this tick (C1): cruise samples per edge, standing samples per stop. */
  learned: { edges: number; dwells: number };
  /** True when this tick flushed the pending aggregates into SQLite (once a minute). */
  learnedFlushed: boolean;
}

/** What the cold start cost: decoding the two static assets, in milliseconds. */
export interface ColdLoad {
  networkMs: number;
  indexMs: number;
}

/** The singleton in production; a test names its own object so no state
 *  or alarm leaks from one test into the next within a file. */
export function twinStub(env: Env, name: string = TWIN_DO_NAME): DurableObjectStub<TwinDO> {
  const namespace = env.TWIN_DO as DurableObjectNamespace<TwinDO>;
  return namespace.get(namespace.idFromName(name));
}

/** The histogram as one batched metrics write: one entry per (horizon, bucket) with its count. */
function hindsightEntries(counts: HindsightCounts): MetricsEntry[] {
  const entries: MetricsEntry[] = [];
  for (const horizon of HORIZONS_S) {
    for (const bucket of BUCKETS) {
      const count = counts[horizon][bucket];
      if (count > 0) entries.push({ event: 'twin_hindsight', dim1: horizonKey(horizon), dim2: bucket, count });
    }
  }
  return entries;
}

/** The signed histogram (F7), written in the same batch as the unsigned one. */
function hindsightSignEntries(counts: HindsightSignCounts): MetricsEntry[] {
  const entries: MetricsEntry[] = [];
  for (const horizon of HORIZONS_S) {
    for (const bucket of SIGN_BUCKETS) {
      const count = counts[horizon][bucket];
      if (count > 0) entries.push({ event: 'twin_hindsight_sign', dim1: horizonKey(horizon), dim2: bucket, count });
    }
  }
  return entries;
}

export class TwinDO extends DurableObject<Env> {
  private state: TwinState | null = null;
  private payload: FeedPayload | null = null;
  private warm = false;
  private lastTickMs = 0;
  private lastReport: TickReport | null = null;
  private assetsReady: Promise<void> | null = null;
  private assetsCheckedMs = 0;
  private index: TripIndex | null = null;
  private net: GraphNetwork | null = null;
  private engine: Engine | null = null;
  private coldLoad: ColdLoad | null = null;
  /** Everything learned so far: the tables plus the unflushed minute; the engine's times read it live (C1). */
  private learned: LearnedAggregates = emptyAggregates();
  private learnedLoaded = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ensureSchema(ctx.storage.sql);
    });
  }

  /** Wall clock; a method so tests can pin it with vi.spyOn. */
  now(): number {
    return Date.now();
  }

  /** The current payload for the feed pipeline. The first reader ever pays
   *  for one inline tick; every later reader gets what the alarm produced. */
  async publish(): Promise<FeedPayload> {
    await this.ensureRunning();
    if (!this.payload) await this.restore();
    if (!this.payload) await this.tick();
    if (this.payload) return this.payload;
    const now = this.now();
    return buildPayload(emptyState(), new Map(), await loadZetRoutes(), now, nextTickAt(null, now), null);
  }

  /** Arms the alarm chain when none is pending; a no-op otherwise. Called on
   *  every read and by the cron as a watchdog, so a chain that died (an
   *  isolate reset mid-alarm) restarts within one read or five minutes. */
  async ensureRunning(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(nextTickAt(this.state?.headerTs ?? null, this.now()));
    }
  }

  async alarm(): Promise<void> {
    // Provisional re-arm first: whatever happens below, the chain survives.
    await this.ctx.storage.setAlarm(nextTickAt(this.state?.headerTs ?? null, this.now()));
    try {
      await this.tick();
    } catch (error) {
      logError('twin_tick_failed', error);
      recordMetric(this.env, 'twin_tick', 'error', this.warm ? 'warm' : 'cold');
    }
  }

  /** One observation of the feed. Exposed for tests and for the alarm. */
  async tick(): Promise<TickReport> {
    const now = this.now();
    const cold = !this.warm;
    this.warm = true;
    if (!this.state) await this.restore();
    const prev = this.state ?? emptyState();

    const finish = async (report: TickReport): Promise<TickReport> => {
      this.lastReport = report;
      await this.ctx.storage.setAlarm(nextTickAt(this.state?.headerTs ?? null, this.now()));
      return report;
    };
    const baseline = (outcome: TickOutcome): TickReport => ({
      outcome,
      headerTs: prev.headerTs,
      newFixes: 0,
      evicted: 0,
      unknownTrips: 0,
      vehicles: Object.keys(prev.tracks).length,
      cold,
      indexLoaded: this.index !== null,
      networkLoaded: this.net !== null,
      recorded: 'unchanged',
      order: null,
      hindsightSamples: 0,
      stateBytes: 0,
      learned: { edges: 0, dwells: 0 },
      learnedFlushed: false,
    });

    // A retried or early alarm inside the floor: no second fetch (R-TE8).
    if (this.lastTickMs > 0 && now - this.lastTickMs < TICK_MIN_DELAY_MS) return finish(baseline('unchanged'));
    this.lastTickMs = now;

    let response: Response;
    try {
      response = await twinUpstream()(prev.etag);
    } catch (error) {
      logError('twin_fetch_failed', error);
      recordMetric(this.env, 'twin_tick', 'error', cold ? 'cold' : 'warm');
      return finish(baseline('error'));
    }

    await this.ensureAssets(now);
    const routes = await loadZetRoutes();

    if (response.status === 304) {
      // Nothing new from ZET: the plans still move on (D2), validUntil moves.
      const result = this.advance(prev, null, now, routes);
      recordMetric(this.env, 'twin_tick', 'unchanged', cold ? 'cold' : 'warm');
      return finish({ ...baseline('unchanged'), vehicles: Object.keys(result.state.tracks).length, evicted: result.evicted, order: result.order, stateBytes: result.stateBytes, learnedFlushed: result.learnedFlushed });
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const decoded = decodeFeed(bytes);
    const etag = response.headers.get('etag') ?? prev.etag;
    if (decoded.headerTs !== null && decoded.headerTs === prev.headerTs) {
      // The same frame again (the cushion beat ZET's publish): nothing new.
      const result = this.advance({ ...prev, etag }, null, now, routes);
      recordMetric(this.env, 'twin_tick', 'unchanged', cold ? 'cold' : 'warm');
      return finish({ ...baseline('unchanged'), vehicles: Object.keys(result.state.tracks).length, evicted: result.evicted, order: result.order, stateBytes: result.stateBytes, learnedFlushed: result.learnedFlushed });
    }

    const result = this.advance({ ...prev, etag }, decoded, now, routes);
    const recorded = decoded.headerTs !== null ? await recordFrame(this.env.RECORDINGS, decoded.headerTs, bytes) : 'skipped';
    const outcome: TickOutcome = this.index !== null && result.tripIds > 0 && result.unknownTrips / result.tripIds > STALE_INDEX_SHARE ? 'stale_index' : 'ok';
    recordMetric(this.env, 'twin_tick', outcome, cold ? 'cold' : 'warm');
    return finish({
      outcome,
      headerTs: result.state.headerTs,
      newFixes: result.newFixes,
      evicted: result.evicted,
      unknownTrips: result.unknownTrips,
      vehicles: Object.keys(result.state.tracks).length,
      cold,
      indexLoaded: this.index !== null,
      networkLoaded: this.net !== null,
      recorded,
      order: result.order,
      hindsightSamples: result.hindsightSamples,
      stateBytes: result.stateBytes,
      learned: result.learned,
      learnedFlushed: result.learnedFlushed,
    });
  }

  /** Runs the engine's tick over a frame (or none), publishes, persists,
   *  counts the hindsight. The one path every observation goes through. */
  private advance(
    prev: TwinState,
    feed: ReturnType<typeof decodeFeed> | null,
    nowMs: number,
    routes: ZetRoutes,
  ): { state: TwinState; newFixes: number; evicted: number; order: OrderReport | null; unknownTrips: number; tripIds: number; hindsightSamples: number; stateBytes: number; learned: { edges: number; dwells: number }; learnedFlushed: boolean } {
    const headerTs = feed?.headerTs ?? prev.headerTs;
    // The joins for every trip in view: the frame's trips plus the tracks already followed.
    const tripIds = new Set<string>();
    for (const track of Object.values(prev.tracks)) if (track.tripId !== null) tripIds.add(track.tripId);
    if (feed) for (const v of feed.vehicles) if (v.tripId) tripIds.add(v.tripId);
    const joins = this.joinsFor([...tripIds]);
    const unknownTrips = [...tripIds].filter((id) => !joins.has(id)).length;

    const result = runTick({ state: prev, feed, nowMs, joins, routes, engine: this.engine, validUntilMs: nextTickAt(headerTs, nowMs) });
    // What the tick learned joins the live aggregates the planner reads now,
    // and the pending minute in the state row; once a minute the pending
    // minute reaches the tables in one transaction and the row starts over.
    recordEvidence(this.learned, result.learned);
    const learnedFlushed = this.flushLearnedIfDue(result.state, nowMs);
    this.state = result.state;
    this.payload = result.payload;
    const stateBytes = saveState(this.ctx.storage.sql, result.state);

    let hindsightSamples = 0;
    const unsigned = hindsightEntries(result.hindsight);
    for (const entry of unsigned) hindsightSamples += entry.count ?? 0;
    const entries = [...unsigned, ...hindsightSignEntries(result.hindsightSign)];
    if (entries.length > 0) {
      // One batched write per tick, never one RPC per vehicle; the signed
      // histogram rides in the same batch, so the two never drift apart.
      void metricsStub(this.env)
        .recordMany(entries)
        .catch((error: unknown) => logError('twin_hindsight_failed', error));
    }
    return {
      state: result.state,
      newFixes: result.newFixes,
      evicted: result.evicted,
      order: result.order,
      unknownTrips,
      tripIds: tripIds.size,
      hindsightSamples,
      stateBytes,
      learned: { edges: result.learned.edges.length, dwells: result.learned.dwells.length },
      learnedFlushed,
    };
  }

  /** The minute's evidence into SQLite, once a minute, in one transaction
   *  (LEARN_FLUSH_MS): the clock lives in the meta table so an eviction does
   *  not reset it, and the unflushed minute lives in the state row so an
   *  eviction does not lose it. */
  private flushLearnedIfDue(state: TwinState, nowMs: number): boolean {
    const sql = this.ctx.storage.sql;
    const flushedAt = learnFlushedAt(sql);
    if (flushedAt === null) {
      markLearnFlushed(sql, nowMs);
      return false;
    }
    if (nowMs - flushedAt < LEARN_FLUSH_MS || isEmptyAggregates(state.pendingLearned)) return false;
    flushLearned(this.ctx.storage, state.pendingLearned);
    state.pendingLearned = emptyAggregates();
    markLearnFlushed(sql, nowMs);
    return true;
  }

  /** The static join per trip id: from the decoded index in memory when it
   *  loaded, else from the SQLite copy an earlier life of the object made. */
  private joinsFor(tripIds: readonly string[]): Map<string, TripJoin> {
    if (this.index) {
      const out = new Map<string, TripJoin>();
      for (const id of tripIds) {
        const record = this.index.tripsById.get(id);
        if (!record) continue;
        const pattern = this.index.patterns[record.pattern];
        if (!pattern) continue;
        const pathId = this.engine?.patternPathIds[record.pattern] ?? null;
        out.set(id, {
          direction: pattern.direction === 1 ? 1 : 0,
          headsign: pattern.headsign,
          shapeId: pattern.shape === '' ? null : pattern.shape,
          startSec: record.start,
          ...(pathId === null ? {} : { pathId }),
        });
      }
      return out;
    }
    return lookupTrips(this.ctx.storage.sql, tripIds);
  }

  /** Cold start: the last state row becomes memory, and the payload follows
   *  from a re-plan on it (the assets load on the way). */
  private async restore(): Promise<void> {
    const saved = loadLatestState(this.ctx.storage.sql);
    if (!saved) return;
    const now = this.now();
    await this.ensureAssets(now);
    // The minute the last life had not flushed yet is knowledge too.
    this.loadLearnedOnce();
    mergeAggregates(this.learned, saved.pendingLearned);
    this.advance(saved, null, now, await loadZetRoutes());
  }

  /** Loads the trip index and the network once, re-checks them hourly, and
   *  builds the engine when both are present. Never throws: a missing asset
   *  leaves the twin joining less or planning in the free plane. */
  private ensureAssets(now: number): Promise<void> {
    if (this.assetsReady && now - this.assetsCheckedMs < INDEX_RECHECK_MS) return this.assetsReady;
    this.assetsCheckedMs = now;
    this.assetsReady = this.loadAssets(now).catch((error) => {
      logError('twin_assets_failed', error);
    });
    return this.assetsReady;
  }

  private async loadAssets(now: number): Promise<void> {
    const sql = this.ctx.storage.sql;
    const cold: ColdLoad = { networkMs: 0, indexMs: 0 };
    if (!this.index) {
      const t0 = Date.now();
      const index = await twinIndexSource(this.env)();
      cold.indexMs = Date.now() - t0;
      if (index) {
        this.index = index;
        const stored = indexFeedVersion(sql);
        const checked = indexCheckedAt(sql);
        if (index.feedVersion !== stored || checked === null || now - checked >= INDEX_RECHECK_MS) {
          if (index.feedVersion !== stored) replaceIndex(this.ctx.storage, indexRowsFromIndex(index));
          markIndexChecked(sql, now);
        }
      }
    }
    if (!this.net) {
      const t0 = Date.now();
      this.net = await twinNetworkSource(this.env)();
      cold.networkMs = Date.now() - t0;
    }
    if (this.net && this.index && !this.engine) {
      this.loadLearnedOnce();
      this.engine = createEngine(this.net, this.index, this.learned);
      this.coldLoad = cold;
      logInfo('twin_assets_loaded', { networkMs: cold.networkMs, indexMs: cold.indexMs, edges: this.net.edges.length, trips: this.index.tripsById.size });
    }
  }

  /** The learned tables into memory, once per life; later ticks add to it in place. */
  private loadLearnedOnce(): void {
    if (this.learnedLoaded) return;
    const fromTables = loadLearned(this.ctx.storage.sql);
    // Anything already counted this life (a tick before the assets arrived) stays.
    mergeAggregates(fromTables, this.learned);
    this.learned.edges = fromTables.edges;
    this.learned.stops = fromTables.stops;
    this.learnedLoaded = true;
  }

  // ---- test seams ------------------------------------------------------------

  /** Simulates an eviction: memory gone, storage kept. */
  forgetForTest(): void {
    this.state = null;
    this.payload = null;
    this.warm = false;
    this.lastTickMs = 0;
    this.lastReport = null;
    this.assetsReady = null;
    this.assetsCheckedMs = 0;
    this.index = null;
    this.net = null;
    this.engine = null;
    this.coldLoad = null;
    this.learned = emptyAggregates();
    this.learnedLoaded = false;
  }

  /** What the twin has learned, for a test: cells per table and the median
   *  edge time per edge over every band and day type. */
  learnedForTest(): { edgeKeys: number; stopKeys: number; edgeMedians: Record<number, number> } {
    const perEdge = new Map<number, number[]>();
    for (const [key, h] of Object.entries(this.learned.edges)) {
      const parsed = parseKey(key);
      if (!parsed) continue;
      const edge = Number(parsed.id);
      perEdge.set(edge, mergeHistograms(perEdge.get(edge) ?? emptyHistogram(), h));
    }
    const edgeMedians: Record<number, number> = {};
    for (const [edge, h] of perEdge) {
      const median = histogramMedian(h);
      if (median !== null) edgeMedians[edge] = median;
    }
    return { edgeKeys: Object.keys(this.learned.edges).length, stopKeys: Object.keys(this.learned.stops).length, edgeMedians };
  }

  lastReportForTest(): TickReport | null {
    return this.lastReport;
  }

  coldLoadForTest(): ColdLoad | null {
    return this.coldLoad;
  }
}
