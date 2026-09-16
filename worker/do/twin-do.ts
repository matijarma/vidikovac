// TwinDO: the one observer of ZET's realtime feed. A singleton that wakes on
// its own alarm every 10 s in step with the feed's republish, fetches the
// frame once with a conditional GET, folds every vehicle's report into that
// vehicle's own short history, joins the trip to the static timetable
// (direction, headsign, shape, block), remembers the fleet in one SQLite row
// per tick so an eviction between two alarms loses nothing, records the raw
// bytes for replay, and publishes one payload the feed pipeline serves from
// its per-colo cache (worker/feed/modules/zet-rt.ts asks `publish()`).
//
// Phase A (this file's first form) publishes history and the join; phase B
// adds the engine (match, plan, laws) in worker/twin/tick.ts. Owner decision
// D1: the engine lives here, on the server, so every viewer sees one world
// and the first frame of a fresh page already moves.
//
// Alarm discipline (the reviewer's A6): alarms are at-least-once and may run
// late, and the object may be evicted between two of them. So `alarm()` arms
// the next alarm before it does anything, never throws (a throwing alarm is
// retried with backoff and would double-fetch), keys a tick by the feed's
// header time (a repeat is "no new evidence"), refuses to fetch twice within
// the floor, and rebuilds its memory from the last state row on a cold start.

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import type { FeedPayload } from '../feed/payload';
import { loadZetRoutes } from '../feed/modules/zet-routes';
import { logError } from '../log';
import { recordMetric } from '../metrics';
import { TICK_MIN_DELAY_MS, nextTickAt } from '../twin/clock';
import { decodeFeed } from '../twin/feed-decode';
import { emptyState, foldFeed, type TwinState } from '../twin/history';
import { indexRowsFromIndex } from '../twin/index-load';
import {
  INDEX_RECHECK_MS,
  STATE_RETENTION_MS,
  ensureSchema,
  indexCheckedAt,
  indexFeedVersion,
  loadLatestState,
  lookupTrips,
  markIndexChecked,
  pruneState,
  replaceIndex,
  saveState,
} from '../twin/persist';
import { buildPayload, type TripJoin } from '../twin/publish';
import { recordFrame, type RecordOutcome } from '../twin/record';
import { twinIndexSource, twinUpstream } from '../twin/seams';

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
  recorded: RecordOutcome | 'unchanged';
}

/** The singleton in production; a test names its own object so no state
 *  or alarm leaks from one test into the next within a file. */
export function twinStub(env: Env, name: string = TWIN_DO_NAME): DurableObjectStub<TwinDO> {
  const namespace = env.TWIN_DO as DurableObjectNamespace<TwinDO>;
  return namespace.get(namespace.idFromName(name));
}

export class TwinDO extends DurableObject<Env> {
  private state: TwinState | null = null;
  private payload: FeedPayload | null = null;
  private warm = false;
  private lastTickMs = 0;
  private lastReport: TickReport | null = null;
  private indexReady: Promise<boolean> | null = null;
  private indexCheckedMs = 0;

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
    return buildPayload(emptyState(), new Map(), await loadZetRoutes(), now, nextTickAt(null, now));
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
    const sql = this.ctx.storage.sql;

    const finish = async (report: TickReport): Promise<TickReport> => {
      this.lastReport = report;
      await this.ctx.storage.setAlarm(nextTickAt(this.state?.headerTs ?? null, this.now()));
      return report;
    };
    const unchanged = (indexLoaded: boolean): TickReport => ({
      outcome: 'unchanged',
      headerTs: prev.headerTs,
      newFixes: 0,
      evicted: 0,
      unknownTrips: 0,
      vehicles: Object.keys(prev.vehicles).length,
      cold,
      indexLoaded,
      recorded: 'unchanged',
    });

    // A retried or early alarm inside the floor: no second fetch (R-TE8).
    if (this.lastTickMs > 0 && now - this.lastTickMs < TICK_MIN_DELAY_MS) return finish(unchanged(this.indexReady !== null));
    this.lastTickMs = now;

    let response: Response;
    try {
      response = await twinUpstream()(prev.etag);
    } catch (error) {
      logError('twin_fetch_failed', error);
      recordMetric(this.env, 'twin_tick', 'error', cold ? 'cold' : 'warm');
      return finish({ ...unchanged(this.indexReady !== null), outcome: 'error' });
    }

    if (response.status === 304) {
      this.state = { ...prev, tickAtMs: now };
      await this.republish(now);
      recordMetric(this.env, 'twin_tick', 'unchanged', cold ? 'cold' : 'warm');
      return finish(unchanged(await this.ensureIndex(now)));
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const decoded = decodeFeed(bytes);
    if (decoded.headerTs !== null && decoded.headerTs === prev.headerTs) {
      // The same frame again (the cushion beat ZET's publish): nothing new.
      this.state = { ...prev, tickAtMs: now, etag: response.headers.get('etag') ?? prev.etag };
      await this.republish(now);
      recordMetric(this.env, 'twin_tick', 'unchanged', cold ? 'cold' : 'warm');
      return finish(unchanged(await this.ensureIndex(now)));
    }

    const { state, newFixes, evicted } = foldFeed(prev, decoded, now);
    state.etag = response.headers.get('etag') ?? prev.etag;
    this.state = state;

    const indexLoaded = await this.ensureIndex(now);
    const tripIds = [...new Set(Object.values(state.vehicles).map((t) => t.tripId).filter((id): id is string => id !== null))];
    const joins: Map<string, TripJoin> = indexLoaded ? lookupTrips(sql, tripIds) : new Map();
    const unknownTrips = tripIds.filter((id) => !joins.has(id)).length;

    this.payload = buildPayload(state, joins, await loadZetRoutes(), now, nextTickAt(state.headerTs, now));
    saveState(sql, state);
    pruneState(sql, now - STATE_RETENTION_MS);

    const recorded = decoded.headerTs !== null ? await recordFrame(this.env.RECORDINGS, decoded.headerTs, bytes) : 'skipped';
    const outcome: TickOutcome = indexLoaded && tripIds.length > 0 && unknownTrips / tripIds.length > STALE_INDEX_SHARE ? 'stale_index' : 'ok';
    recordMetric(this.env, 'twin_tick', outcome, cold ? 'cold' : 'warm');
    return finish({
      outcome,
      headerTs: state.headerTs,
      newFixes,
      evicted,
      unknownTrips,
      vehicles: Object.keys(state.vehicles).length,
      cold,
      indexLoaded,
      recorded,
    });
  }

  /** Rebuilds the payload from the state in memory (a 304 or a repeated
   *  frame moves validUntil and the source's freshness without new fixes). */
  private async republish(now: number): Promise<void> {
    if (!this.state) return;
    const indexLoaded = await this.ensureIndex(now);
    const tripIds = [...new Set(Object.values(this.state.vehicles).map((t) => t.tripId).filter((id): id is string => id !== null))];
    const joins: Map<string, TripJoin> = indexLoaded ? lookupTrips(this.ctx.storage.sql, tripIds) : new Map();
    this.payload = buildPayload(this.state, joins, await loadZetRoutes(), now, nextTickAt(this.state.headerTs, now));
  }

  /** Cold start: the last state row becomes memory, and the payload follows. */
  private async restore(): Promise<void> {
    const saved = loadLatestState(this.ctx.storage.sql);
    if (!saved) return;
    this.state = saved;
    await this.republish(this.now());
  }

  /** True when the trip tables hold an index. Loads or refreshes the asset
   *  at most once an hour; a missing or broken asset keeps the stored copy
   *  and never throws out of here (the join simply degrades). */
  private ensureIndex(now: number): Promise<boolean> {
    if (this.indexReady && now - this.indexCheckedMs < INDEX_RECHECK_MS) return this.indexReady;
    this.indexCheckedMs = now;
    this.indexReady = this.loadIndex(now).catch((error) => {
      logError('twin_index_failed', error);
      return indexFeedVersion(this.ctx.storage.sql) !== null;
    });
    return this.indexReady;
  }

  private async loadIndex(now: number): Promise<boolean> {
    const sql = this.ctx.storage.sql;
    const stored = indexFeedVersion(sql);
    const checked = indexCheckedAt(sql);
    if (stored !== null && checked !== null && now - checked < INDEX_RECHECK_MS) return true;
    const index = await twinIndexSource(this.env)();
    if (index === null) return stored !== null;
    const rows = indexRowsFromIndex(index);
    if (rows.feedVersion !== stored) replaceIndex(this.ctx.storage, rows);
    markIndexChecked(sql, now);
    return true;
  }

  // ---- test seams ------------------------------------------------------------

  /** Simulates an eviction: memory gone, storage kept. */
  forgetForTest(): void {
    this.state = null;
    this.payload = null;
    this.warm = false;
    this.lastTickMs = 0;
    this.lastReport = null;
    this.indexReady = null;
    this.indexCheckedMs = 0;
  }

  lastReportForTest(): TickReport | null {
    return this.lastReport;
  }
}
