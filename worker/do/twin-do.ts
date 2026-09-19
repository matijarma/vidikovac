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
import type { OrderReport } from '../../shared/motion/order';
import { emptyPlanCountsByKind, PLAN_EVENTS, type PlanCountsByKind } from '../../shared/motion/plan';
import type { GraphNetwork } from '../../shared/motion/network';
import type { TripIndex } from '../../shared/motion/trips';
import type { Env } from '../env';
import type { TwinTickDim } from '../protocol';
import type { FeedPayload } from '../feed/payload';
import { loadZetRoutes, type ZetRoutes } from '../feed/modules/zet-routes';
import { logError, logInfo } from '../log';
import { metricsStub, recordMetric } from '../metrics';
import type { MetricsEntry } from '../metrics-do';
import { TICK_MIN_DELAY_MS, nextTickAt } from '../twin/clock';
import { createEngine, type Engine } from '../twin/engine';
import { patternPathResolver, zagrebBands, type PatternPathResolver } from '../../shared/motion/times';
import { decodeFeed } from '../twin/feed-decode';
import { BUCKETS, horizonKey, type HindsightCounts, type HindsightSignCounts, HORIZONS_S, SIGN_BUCKETS } from '../../shared/motion/hindsight';
import { emptyAggregates, emptyHistogram, histogramMedian, isEmptyAggregates, mergeAggregates, mergeHistograms, parseKey, recordEvidence, type LearnedAggregates } from '../../shared/motion/learn';
import { pushDwellRecent, trimDwellRecent, type DwellOverride, type DwellRecent, type DwellRow } from '../../shared/motion/dwell';
import type { JunctionRow } from '../../shared/motion/junction';
import { indexRowsFromIndex } from '../twin/index-load';
import {
  INDEX_RECHECK_MS,
  LEARN_FLUSH_MS,
  adoptGraph,
  ensureSchema,
  flushDwellRecent,
  flushLearned,
  indexCheckedAt,
  indexFeedVersion,
  learnFlushedAt,
  loadDwellRecent,
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
import { twinIndexSource, twinNetworkSource, twinOverridesSource, twinUpstream } from '../twin/seams';
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

/** The four outcomes a tick reports. The fifth dim the twin writes under
 *  `twin_tick`, `overrides_unreadable`, is a fault of the object and not of a
 *  tick, so it is not one of these; both live in protocol.ts's TWIN_TICK_DIMS. */
export type TickOutcome = Exclude<TwinTickDim, 'overrides_unreadable'>;

/** The live F11 tables, as /stats asks for them over RPC. */
export interface TwinTables {
  /** The instant the rows were read at, epoch seconds. */
  at: number;
  dwell: DwellRow[];
  junctions: JunctionRow[];
  /** Entries the owner's file carries. */
  overrides: number;
  /** Why the owner's file could not be read, when it could not be (I3).
   *  Null when it parsed, and null when it is simply not there: both of
   *  those are an honest empty table. Set, every owner default is missing
   *  and /stats says so in bold. */
  overridesError: string | null;
  /** Entries that matched no platform of the loaded network: a renamed stop,
   *  a typo. Shown rather than thrown, so a rebuilt artefact cannot take the
   *  twin down over one stale line of a hand-edited file. */
  unmatched: { stop: string; route: string | null }[];
}

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
  /** Evidence mined this tick (C1, F11): cruise samples per edge, standing
   *  samples per stop, junction waits and the node passes beside them. */
  learned: { edges: number; dwells: number; waits: number; passes: number };
  /** True when this tick flushed the pending aggregates into SQLite (once a minute). */
  learnedFlushed: boolean;
  /** What the planner had to intervene about this tick, by kind (F11). */
  plan: PlanCountsByKind;
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

/** The planner's own interventions this tick (F11) as metric cells: the
 *  published floor under a noisy anchor, a junction wait booked, a stand the
 *  D8 fix kept at its platform, and an ETA bound the planner refused to
 *  believe. Counters like the register's -- a tick's events, which MetricsDO
 *  sums over the hour. */
function planEntries(counts: PlanCountsByKind | null): MetricsEntry[] {
  if (!counts) return [];
  const entries: MetricsEntry[] = [];
  for (const kind of ['tram', 'bus'] as const) {
    for (const event of PLAN_EVENTS) {
      if (counts[kind][event] > 0) entries.push({ event: 'twin_plan', dim1: event, dim2: kind, count: counts[kind][event] });
    }
  }
  return entries;
}

/** The ordering register's pass as metric cells (E3): one entry per counter
 *  that moved, in the same batched write as the hindsight histograms.
 *
 *  `report.relations` is deliberately NOT among them. It is a gauge -- how
 *  many relations stand at the end of this pass -- and MetricsDO sums what it
 *  is given over the hour, which would make "relations" a meaningless running
 *  total of a standing count. The deltas (`established` and `dropped`) are
 *  what a counter can honestly carry; the standing count is derivable from
 *  them and is on the tick report either way. */
function orderEntries(report: OrderReport | null): MetricsEntry[] {
  if (!report) return [];
  const counts: [string, number][] = [
    ['established', report.established],
    ['dropped', report.dropped],
    ['hold', report.holds],
    ['push', report.pushes],
    ['concession', report.concessions],
    ['swap', report.swaps],
  ];
  return counts.filter(([, count]) => count > 0).map(([dim1, count]) => ({ event: 'twin_order' as const, dim1, dim2: 'tram', count }));
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
  /** Built on first use from the loaded network, for the SQLite join path. */
  private pathResolver: PatternPathResolver | null = null;
  private coldLoad: ColdLoad | null = null;
  /** Everything learned so far: the tables plus the unflushed minute; the engine's times read it live (C1). */
  private learned: LearnedAggregates = emptyAggregates();
  private learnedLoaded = false;
  /** The rolling window of measured dwells, by reference: the engine's dwell
   *  table reads THIS object, and every tick appends to it (F11). */
  private dwellRecent: DwellRecent = {};
  /** The owner's hand-edited dwell defaults, read once per life. */
  private dwellOverrides: DwellOverride[] = [];
  /** The parser's complaint about that file, when it had one (I3). */
  private dwellOverridesError: string | null = null;
  /** This life loaded a rail graph other than the one the stored rows were
   *  learned under, so nothing keyed by an edge index survives from before. */
  private graphChanged = false;

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
      learned: { edges: 0, dwells: 0, waits: 0, passes: 0 },
      learnedFlushed: false,
      plan: emptyPlanCountsByKind(),
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

    await this.ensureAssets(now, cold);
    const routes = await loadZetRoutes();

    if (response.status === 304) {
      // Nothing new from ZET: the plans still move on (D2), validUntil moves.
      const result = this.advance(prev, null, now, routes);
      recordMetric(this.env, 'twin_tick', 'unchanged', cold ? 'cold' : 'warm');
      return finish({ ...baseline('unchanged'), vehicles: Object.keys(result.state.tracks).length, evicted: result.evicted, order: result.order, stateBytes: result.stateBytes, learnedFlushed: result.learnedFlushed, plan: result.plan });
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const decoded = decodeFeed(bytes);
    const etag = response.headers.get('etag') ?? prev.etag;
    if (decoded.headerTs !== null && decoded.headerTs === prev.headerTs) {
      // The same frame again (the cushion beat ZET's publish): nothing new.
      const result = this.advance({ ...prev, etag }, null, now, routes);
      recordMetric(this.env, 'twin_tick', 'unchanged', cold ? 'cold' : 'warm');
      return finish({ ...baseline('unchanged'), vehicles: Object.keys(result.state.tracks).length, evicted: result.evicted, order: result.order, stateBytes: result.stateBytes, learnedFlushed: result.learnedFlushed, plan: result.plan });
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
      plan: result.plan,
    });
  }

  /** Runs the engine's tick over a frame (or none), publishes, persists,
   *  counts the hindsight. The one path every observation goes through. */
  private advance(
    prev: TwinState,
    feed: ReturnType<typeof decodeFeed> | null,
    nowMs: number,
    routes: ZetRoutes,
  ): { state: TwinState; newFixes: number; evicted: number; order: OrderReport | null; unknownTrips: number; tripIds: number; hindsightSamples: number; stateBytes: number; learned: TickReport['learned']; learnedFlushed: boolean; plan: PlanCountsByKind } {
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
    // The rolling window the dwell table reads lives here, beside the
    // aggregates, for the same reason: the engine holds it by reference.
    for (const dwell of result.learned.dwells) pushDwellRecent(this.dwellRecent, dwell.stopId, dwell.atSec, dwell.seconds);
    // In place: the engine's dwell table closes over THIS object (F11).
    trimDwellRecent(this.dwellRecent, Math.floor(nowMs / 1000));
    const learnedFlushed = this.flushLearnedIfDue(result.state, nowMs);
    this.state = result.state;
    this.payload = result.payload;
    const stateBytes = saveState(this.ctx.storage.sql, result.state);
    // Once a minute, on the same cadence as the flush: how big the serialized
    // row actually is, against the Durable Object's ~2 MB row cap (I5). The
    // round's own replay measured 1.42 MB at the morning peak and production
    // has never measured it at all; `published` is the part that grows with
    // the fleet, and shrinking it is the next round's work.
    if (learnedFlushed) logInfo('twin_state_size', { bytes: stateBytes, vehicles: Object.keys(result.state.tracks).length });

    let hindsightSamples = 0;
    const unsigned = hindsightEntries(result.hindsight);
    for (const entry of unsigned) hindsightSamples += entry.count ?? 0;
    const entries = [...unsigned, ...hindsightSignEntries(result.hindsightSign), ...orderEntries(result.order), ...planEntries(result.plan)];
    if (entries.length > 0) {
      // One batched write per tick, never one RPC per vehicle; the signed
      // histogram and the ordering register ride in the same batch, so none
      // of them drifts apart from the others.
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
      learned: { edges: result.learned.edges.length, dwells: result.learned.dwells.length, waits: result.learned.waits.length, passes: result.learned.passes.length },
      learnedFlushed,
      plan: result.plan,
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
    if (nowMs - flushedAt < LEARN_FLUSH_MS) return false;
    const nowSec = Math.floor(nowMs / 1000);
    // The rolling dwell window rides the same cadence: only the samples taken
    // since the last flush are written, and the ones that left the window are
    // deleted, so a minute costs a handful of row writes (F11).
    const wroteRecent = flushDwellRecent(this.ctx.storage, state.dwellRecent, Math.floor(flushedAt / 1000), nowSec) > 0;
    if (isEmptyAggregates(state.pendingLearned) && !wroteRecent) {
      markLearnFlushed(sql, nowMs);
      return false;
    }
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
    // Cold start, the index not decoded yet: the SQLite copy answers, and it
    // resolves the path the same way (F8), so an evicted twin does not put a
    // shapeless trip on the route and direction's first synthetic path for as
    // long as it takes the index to load.
    const net = this.net;
    const resolver = net ? (this.pathResolver ??= patternPathResolver(net)) : null;
    return lookupTrips(this.ctx.storage.sql, tripIds, resolver === null || net === null ? undefined : (pattern) => {
      const { pathIdx } = resolver.resolve({ route: pattern.route, direction: pattern.direction, shape: pattern.shape, stops: pattern.stops });
      return pathIdx === null ? null : net.paths[pathIdx].id;
    });
  }

  /** Cold start: the last state row becomes memory, and the payload follows
   *  from a re-plan on it (the assets load on the way). */
  private async restore(): Promise<void> {
    const saved = loadLatestState(this.ctx.storage.sql);
    if (!saved) return;
    const now = this.now();
    // A restore IS the cold start, whatever the tick that reached it thought.
    await this.ensureAssets(now, true);
    // The minute the last life had not flushed yet is knowledge too -- but
    // its EDGE and NODE keys name edges and junctions of the graph that life
    // ran, so if this one loaded a different graph (F8c) only the stop dwells
    // carry over, the same split adoptGraph makes in the tables. The row
    // itself is rewritten here and not only the live aggregates: `advance()`
    // copies `pendingLearned` into the next state row and the first flush
    // after this cold start would otherwise write the previous graph's minute
    // straight back into the tables adoptGraph has just emptied. `published`
    // goes the same way -- the hindsight rings hold plans indexed by the old
    // artefact's path indices, which name other rails now.
    const fromRow: TwinState = this.graphChanged
      ? { ...saved, pendingLearned: { ...emptyAggregates(), stops: saved.pendingLearned.stops }, published: {} }
      : saved;
    this.loadLearnedOnce();
    mergeAggregates(this.learned, fromRow.pendingLearned);
    // The rolling dwell window: what SQLite kept, plus whatever the last
    // life had in its state row but had not flushed, newest thirty per
    // platform inside the window (F11).
    const nowSec = Math.floor(now / 1000);
    const restored = loadDwellRecent(this.ctx.storage.sql, nowSec);
    for (const [stopId, samples] of Object.entries(saved.dwellRecent ?? {})) {
      const seen = new Set((restored[stopId] ?? []).map(([at]) => at));
      for (const [at, seconds] of samples) if (!seen.has(at)) pushDwellRecent(restored, stopId, at, seconds);
    }
    // Into the object the engine already holds, never over it.
    for (const key of Object.keys(this.dwellRecent)) delete this.dwellRecent[key];
    Object.assign(this.dwellRecent, trimDwellRecent(restored, nowSec));
    const forState: DwellRecent = {};
    for (const [stopId, samples] of Object.entries(this.dwellRecent)) forState[stopId] = [...samples];
    this.advance({ ...fromRow, dwellRecent: forState }, null, now, await loadZetRoutes());
  }

  /** Loads the trip index and the network once, re-checks them hourly, and
   *  builds the engine when both are present. Never throws: a missing asset
   *  leaves the twin joining less or planning in the free plane. */
  private ensureAssets(now: number, coldStart: boolean): Promise<void> {
    if (this.assetsReady && now - this.assetsCheckedMs < INDEX_RECHECK_MS) return this.assetsReady;
    this.assetsCheckedMs = now;
    this.assetsReady = this.loadAssets(now, coldStart).catch((error) => {
      logError('twin_assets_failed', error);
    });
    return this.assetsReady;
  }

  private async loadAssets(now: number, coldStart: boolean): Promise<void> {
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
      this.pathResolver = null; // a new network needs its own path indexes
      cold.networkMs = Date.now() - t0;
      // A rebuilt rail graph renumbers its edges (F8c), so everything keyed
      // by an edge index is about a different piece of track and goes. This
      // must happen BEFORE loadLearnedOnce reads the tables.
      if (this.net) {
        const dropped = adoptGraph(this.ctx.storage, this.net.graphHash);
        if (dropped !== null) {
          this.graphChanged = true;
          this.learned.edges = {};
          logInfo('twin_graph_changed', { graph: this.net.graphHash, droppedEdgeRows: dropped });
        }
      }
    }
    if (this.net && this.index && !this.engine) {
      this.loadLearnedOnce();
      // The owner's dwell defaults, read from the same ASSETS binding as the
      // two artefacts; a malformed file leaves the list empty and is logged.
      const overrides = await twinOverridesSource(this.env)();
      this.dwellOverrides = overrides.overrides;
      this.dwellOverridesError = overrides.error;
      // Once per load attempt, not once per tick: a file the owner has just
      // broken takes every hand-written default out of the planner, and the
      // counter is what says when that started (I3). /stats carries the
      // message itself beside the dwell table.
      if (overrides.error !== null) recordMetric(this.env, 'twin_tick', 'overrides_unreadable', coldStart ? 'cold' : 'warm');
      this.engine = createEngine(this.net, this.index, this.learned, { overrides: this.dwellOverrides, dwellRecent: this.dwellRecent });
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
    this.learned.nodes = fromTables.nodes;
    this.learned.nodePasses = fromTables.nodePasses;
    this.learnedLoaded = true;
  }

  /**
   * The two F11 tables as /stats renders them: what every platform the twin
   * knows anything about is planned to hold a tram for, and where the rails
   * branch and how long a tram waits there. Read from the live engine, so an
   * operator sees what the planner is using right now and not an hourly
   * counter of it. Empty before the assets load.
   */
  async tables(nowSec?: number): Promise<TwinTables> {
    const at = nowSec ?? Math.floor(this.now() / 1000);
    const bands = zagrebBands(at);
    if (!this.engine) return { at, dwell: [], junctions: [], overrides: 0, overridesError: this.dwellOverridesError, unmatched: [] };
    return {
      at,
      dwell: this.engine.dwell.rows(at, bands.hourBand, bands.dayType),
      junctions: this.engine.junctions.rows(bands.hourBand, bands.dayType),
      overrides: this.dwellOverrides.length,
      overridesError: this.dwellOverridesError,
      unmatched: this.engine.dwell.unmatchedOverrides.map((entry) => ({ stop: entry.stop, route: entry.route ?? null })),
    };
  }

  // ---- test seams ------------------------------------------------------------

  /** The rolling dwell window as the twin holds it, for a restore test. */
  dwellRecentForTest(): DwellRecent {
    return this.dwellRecent;
  }

  /** The junction cells the twin holds, for a restore and graph-change test. */
  junctionCellsForTest(): { nodes: number; passes: number } {
    return { nodes: Object.keys(this.learned.nodes).length, passes: Object.keys(this.learned.nodePasses).length };
  }


  /** The static join per trip id, as the tick sees it: which source answered
   *  is the point (the decoded index, or the SQLite copy after an eviction). */
  joinsForTest(tripIds: readonly string[]): Record<string, TripJoin> {
    return Object.fromEntries(this.joinsFor(tripIds));
  }

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
    this.pathResolver = null;
    this.coldLoad = null;
    this.learned = emptyAggregates();
    this.learnedLoaded = false;
    this.dwellRecent = {};
    this.dwellOverrides = [];
    this.dwellOverridesError = null;
    this.graphChanged = false;
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
