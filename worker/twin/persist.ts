// What the twin keeps in its own SQLite: the last few tick states (so an
// object evicted between two 10 s alarms wakes up knowing the fleet), and a
// copy of the static trip index in tables, so a realtime trip id resolves in
// one indexed lookup when the decoded index is not in memory. Plain SQL over
// the storage the Durable Object hands in; no Cloudflare import.

import { toPlane } from '../../shared/motion/geo';
import { emptyAggregates, histogramCount, isEmptyAggregates, mergeHistograms, parseHistogram, parseKey, serializeHistogram, type LearnedAggregates } from '../../shared/motion/learn';
import { newOrderState, type PlaneFix, type Track } from '../../shared/motion/track';
import type { TripJoin } from './publish';
import type { TwinState } from './state';

/** Tick rows kept: the newest is the restore point, two more survive a row
 *  that was written half-way when the object died. Days of tick rows would
 *  be a second recording of what R2 already holds (record.ts). */
export const STATE_ROWS_KEPT = 3;

/** How often the twin re-reads the static assets to learn about a new
 *  deploy: the assets change only on a push, and a push restarts the
 *  isolate anyway, so an hourly check is a safety net, not the mechanism. */
export const INDEX_RECHECK_MS = 60 * 60 * 1000;

/** How often the learned aggregates reach SQLite (C1): once a minute, in
 *  one transaction, so a day of learning is about 1,400 batched writes over a
 *  few hundred rows rather than a row write per traversal (the plan's
 *  row-write budget); the state row carries the unflushed minute meanwhile. */
export const LEARN_FLUSH_MS = 60_000;

/** Rows per multi-row INSERT: 20 trips × 4 columns keeps a statement at 80
 *  bound parameters, comfortably under SQLite's conservative limits. */
const TRIP_ROWS_PER_INSERT = 20;
const PATTERN_ROWS_PER_INSERT = 10;
const BLOCK_ROWS_PER_INSERT = 40;
const LOOKUP_CHUNK = 50;

/** Coordinates in the state row keep the feed's own precision (~1.1 m);
 *  arcs a decimetre. The plane coordinates are recomputed on load. */
const COORD_PRECISION = 1e5;
const ARC_PRECISION = 10;

export interface IndexPattern {
  route: string;
  direction: 0 | 1;
  shape: string | null;
  headsign: string;
  stops: string[];
  sched: number[][];
  dwell: number[];
}

export interface IndexTrip {
  id: string;
  pattern: number;
  block: string;
  start: number;
}

export interface IndexRows {
  feedVersion: string;
  patterns: IndexPattern[];
  trips: IndexTrip[];
  blocks: { id: string; trips: string[] }[];
}

export interface TripLookup extends TripJoin {
  pattern: number;
  block: string;
}

/** Resolves the path id of a pattern of the SQLite copy, the way the decoded
 *  index does (times.ts patternPathResolver). Passed in rather than imported
 *  so this file keeps knowing nothing about the network geometry. */
export type PathIdOfPattern = (pattern: { idx: number; route: string; direction: 0 | 1; shape: string | null; stops: string[] }) => string | null;

export function ensureSchema(sql: SqlStorage): void {
  sql.exec(
    `CREATE TABLE IF NOT EXISTS state (
       tick_at INTEGER PRIMARY KEY,
       header_ts INTEGER,
       etag TEXT,
       body TEXT NOT NULL
     )`,
  );
  sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  sql.exec(
    `CREATE TABLE IF NOT EXISTS patterns (
       idx INTEGER PRIMARY KEY,
       route TEXT NOT NULL,
       direction INTEGER NOT NULL,
       shape TEXT,
       headsign TEXT NOT NULL,
       stops TEXT NOT NULL,
       sched TEXT NOT NULL,
       dwell TEXT NOT NULL
     )`,
  );
  sql.exec(
    `CREATE TABLE IF NOT EXISTS trips (
       trip_id TEXT PRIMARY KEY,
       pattern INTEGER NOT NULL,
       block TEXT NOT NULL,
       start INTEGER NOT NULL
     )`,
  );
  sql.exec('CREATE TABLE IF NOT EXISTS blocks (block TEXT PRIMARY KEY, trips TEXT NOT NULL)');
  // C1: one histogram per (edge, hour band, day type) and per (stop, hour band, day type).
  sql.exec(
    `CREATE TABLE IF NOT EXISTS edge_time (
       edge INTEGER NOT NULL,
       band INTEGER NOT NULL,
       daytype INTEGER NOT NULL,
       hist TEXT NOT NULL,
       n INTEGER NOT NULL,
       PRIMARY KEY (edge, band, daytype)
     )`,
  );
  sql.exec(
    `CREATE TABLE IF NOT EXISTS stop_dwell (
       stop TEXT NOT NULL,
       band INTEGER NOT NULL,
       daytype INTEGER NOT NULL,
       hist TEXT NOT NULL,
       n INTEGER NOT NULL,
       PRIMARY KEY (stop, band, daytype)
     )`,
  );
}

// ---- tick state -------------------------------------------------------------

type StoredFix = Omit<PlaneFix, 'x' | 'y'>;
type StoredTrack = Omit<Track, 'fixes'> & { fixes: StoredFix[] };
type StoredState = Omit<TwinState, 'tracks'> & { tracks: Record<string, StoredTrack> };

/** The state as one JSON string: plane coordinates dropped (recomputed on
 *  load), lon/lat and arcs rounded to what they mean. */
export function serializeState(state: TwinState): string {
  const tracks: Record<string, StoredTrack> = {};
  for (const [id, track] of Object.entries(state.tracks)) {
    tracks[id] = {
      ...track,
      fixes: track.fixes.map((fix) => {
        const stored: StoredFix = { lon: Math.round(fix.lon * COORD_PRECISION) / COORD_PRECISION, lat: Math.round(fix.lat * COORD_PRECISION) / COORD_PRECISION, atSec: fix.atSec };
        if (fix.arc) stored.arc = { key: fix.arc.key, s: Math.round(fix.arc.s * ARC_PRECISION) / ARC_PRECISION, atStop: fix.arc.atStop };
        return stored;
      }),
    };
  }
  const stored: StoredState = { ...state, tracks };
  return JSON.stringify(stored);
}

export function deserializeState(body: string): TwinState {
  const stored = JSON.parse(body) as StoredState;
  const tracks: Record<string, Track> = {};
  for (const [id, track] of Object.entries(stored.tracks ?? {})) {
    tracks[id] = {
      ...track,
      fixes: (track.fixes ?? []).map((fix) => {
        const plane = toPlane(fix.lon, fix.lat);
        return { ...fix, x: plane.x, y: plane.y };
      }),
      // A row written before F10 carries the pairwise law's `behind` array
      // instead of the register's single leader (shared/motion/track.ts): a
      // cold restore over one must not throw, it starts the register clean
      // and the next tick's fixes write it again within two fixes.
      order: track.order && typeof track.order.leader !== 'undefined' && track.order.witnesses ? track.order : newOrderState(),
    };
  }
  return { ...stored, tracks, published: stored.published ?? {}, learnedUpTo: stored.learnedUpTo ?? {}, pendingLearned: stored.pendingLearned ?? emptyAggregates() };
}

/** Writes the tick's state and keeps only the newest STATE_ROWS_KEPT rows. */
export function saveState(sql: SqlStorage, state: TwinState): number {
  const body = serializeState(state);
  sql.exec('INSERT OR REPLACE INTO state (tick_at, header_ts, etag, body) VALUES (?, ?, ?, ?)', state.tickAtMs, state.headerTs, state.etag, body);
  sql.exec(`DELETE FROM state WHERE tick_at NOT IN (SELECT tick_at FROM state ORDER BY tick_at DESC LIMIT ${STATE_ROWS_KEPT})`);
  return body.length;
}

export function loadLatestState(sql: SqlStorage): TwinState | null {
  const row = sql.exec<{ body: string }>('SELECT body FROM state ORDER BY tick_at DESC LIMIT 1').toArray()[0];
  if (!row) return null;
  try {
    return deserializeState(row.body);
  } catch {
    return null;
  }
}

// ---- the static index -------------------------------------------------------

function metaGet(sql: SqlStorage, key: string): string | null {
  const row = sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0];
  return row ? row.value : null;
}

function metaSet(sql: SqlStorage, key: string, value: string): void {
  sql.exec('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
}

export function indexFeedVersion(sql: SqlStorage): string | null {
  return metaGet(sql, 'feed_version');
}

export function indexCheckedAt(sql: SqlStorage): number | null {
  const value = metaGet(sql, 'index_checked_at');
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function markIndexChecked(sql: SqlStorage, atMs: number): void {
  metaSet(sql, 'index_checked_at', String(atMs));
}

function insertBatched(sql: SqlStorage, table: string, columns: string[], rows: unknown[][], perStatement: number): void {
  const placeholders = `(${columns.map(() => '?').join(', ')})`;
  for (let i = 0; i < rows.length; i += perStatement) {
    const chunk = rows.slice(i, i + perStatement);
    sql.exec(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${chunk.map(() => placeholders).join(', ')}`, ...chunk.flat());
  }
}

/** Replaces the whole index in one transaction and records its feed version. */
export function replaceIndex(storage: DurableObjectStorage, rows: IndexRows): void {
  const sql = storage.sql;
  storage.transactionSync(() => {
    sql.exec('DELETE FROM patterns');
    sql.exec('DELETE FROM trips');
    sql.exec('DELETE FROM blocks');
    insertBatched(
      sql,
      'patterns',
      ['idx', 'route', 'direction', 'shape', 'headsign', 'stops', 'sched', 'dwell'],
      rows.patterns.map((p, idx) => [idx, p.route, p.direction, p.shape, p.headsign, JSON.stringify(p.stops), JSON.stringify(p.sched), JSON.stringify(p.dwell)]),
      PATTERN_ROWS_PER_INSERT,
    );
    insertBatched(sql, 'trips', ['trip_id', 'pattern', 'block', 'start'], rows.trips.map((t) => [t.id, t.pattern, t.block, t.start]), TRIP_ROWS_PER_INSERT);
    insertBatched(sql, 'blocks', ['block', 'trips'], rows.blocks.map((b) => [b.id, JSON.stringify(b.trips)]), BLOCK_ROWS_PER_INSERT);
    metaSet(sql, 'feed_version', rows.feedVersion);
  });
}

/** The join for each known trip id; unknown ids are simply absent. */
export function lookupTrips(sql: SqlStorage, tripIds: readonly string[], pathIdOf?: PathIdOfPattern): Map<string, TripLookup> {
  const out = new Map<string, TripLookup>();
  const unique = [...new Set(tripIds)];
  // One resolution per pattern, not per trip: a rush-hour tick looks up
  // hundreds of trips over a few dozen patterns, and the shapeless ones cost
  // a JSON parse of the stop sequence each.
  const pathIdByPattern = new Map<number, string | null>();
  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + LOOKUP_CHUNK);
    const rows = sql
      .exec<{ trip_id: string; pattern: number; block: string; start: number; route: string; direction: number; shape: string | null; headsign: string; stops: string }>(
        `SELECT t.trip_id, t.pattern, t.block, t.start, p.route, p.direction, p.shape, p.headsign, p.stops
           FROM trips t JOIN patterns p ON p.idx = t.pattern
          WHERE t.trip_id IN (${chunk.map(() => '?').join(', ')})`,
        ...chunk,
      )
      .toArray();
    for (const row of rows) {
      const direction = row.direction === 1 ? 1 : 0;
      let pathId = pathIdByPattern.get(row.pattern) ?? null;
      if (pathIdOf && !pathIdByPattern.has(row.pattern)) {
        let stops: string[] = [];
        try {
          const parsed: unknown = JSON.parse(row.stops);
          if (Array.isArray(parsed)) stops = parsed as string[];
        } catch {
          // A pattern row written by an older build, or a truncated one: the
          // join goes out without a path id, as it did before F8.
        }
        pathId = pathIdOf({ idx: row.pattern, route: row.route, direction, shape: row.shape, stops });
        pathIdByPattern.set(row.pattern, pathId);
      }
      out.set(row.trip_id, {
        direction,
        headsign: row.headsign,
        shapeId: row.shape,
        startSec: row.start,
        pattern: row.pattern,
        block: row.block,
        ...(pathId === null ? {} : { pathId }),
      });
    }
  }
  return out;
}

// ---- the learned aggregates (C1) --------------------------------------------------

export function learnFlushedAt(sql: SqlStorage): number | null {
  const value = metaGet(sql, 'learn_flushed_at');
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function markLearnFlushed(sql: SqlStorage, atMs: number): void {
  metaSet(sql, 'learn_flushed_at', String(atMs));
}

/**
 * The graph the learned edge rows belong to. `edge_time` is keyed by edge
 * INDEX, and an index only means something within one rail graph: the F8c
 * builder nodes a crossing where a line turns and renumbers everything after
 * it, so a histogram for "edge 137" would then be about a different piece of
 * track. On a change every edge-keyed row goes and the new name is recorded;
 * `stop_dwell` is keyed by stop id, which no rebuild renumbers, so it stays.
 * Returns the rows dropped, or null when the graph is the one already
 * recorded (nothing to do, nothing to say).
 */
export function adoptGraph(storage: DurableObjectStorage, graphHash: string): number | null {
  const sql = storage.sql;
  const stored = metaGet(sql, 'graph_hash');
  if (stored === graphHash) return null;
  let dropped = 0;
  storage.transactionSync(() => {
    dropped = sql.exec<{ c: number }>('SELECT count(*) AS c FROM edge_time').one().c;
    sql.exec('DELETE FROM edge_time');
    metaSet(sql, 'graph_hash', graphHash);
  });
  return dropped;
}

/** The graph the learned edge rows were gathered under, or null before any. */
export function learnedGraphHash(sql: SqlStorage): string | null {
  return metaGet(sql, 'graph_hash');
}

/** Every learned histogram the tables hold. */
export function loadLearned(sql: SqlStorage): LearnedAggregates {
  const agg = emptyAggregates();
  for (const row of sql.exec<{ edge: number; band: number; daytype: number; hist: string }>('SELECT edge, band, daytype, hist FROM edge_time').toArray()) {
    agg.edges[`${row.edge}|${row.band}|${row.daytype}`] = parseHistogram(row.hist);
  }
  for (const row of sql.exec<{ stop: string; band: number; daytype: number; hist: string }>('SELECT stop, band, daytype, hist FROM stop_dwell').toArray()) {
    agg.stops[`${row.stop}|${row.band}|${row.daytype}`] = parseHistogram(row.hist);
  }
  return agg;
}

/** Merges the pending aggregates into the tables in one transaction; returns the rows written. */
export function flushLearned(storage: DurableObjectStorage, pending: LearnedAggregates): number {
  if (isEmptyAggregates(pending)) return 0;
  const sql = storage.sql;
  let rows = 0;
  storage.transactionSync(() => {
    for (const [key, h] of Object.entries(pending.edges)) {
      const parsed = parseKey(key);
      if (!parsed) continue;
      const edge = Number(parsed.id);
      const existing = sql.exec<{ hist: string }>('SELECT hist FROM edge_time WHERE edge = ? AND band = ? AND daytype = ?', edge, parsed.hourBand, parsed.dayType).toArray()[0];
      const merged = existing ? mergeHistograms(parseHistogram(existing.hist), h) : h;
      sql.exec('INSERT OR REPLACE INTO edge_time (edge, band, daytype, hist, n) VALUES (?, ?, ?, ?, ?)', edge, parsed.hourBand, parsed.dayType, serializeHistogram(merged), histogramCount(merged));
      rows++;
    }
    for (const [key, h] of Object.entries(pending.stops)) {
      const parsed = parseKey(key);
      if (!parsed) continue;
      const existing = sql.exec<{ hist: string }>('SELECT hist FROM stop_dwell WHERE stop = ? AND band = ? AND daytype = ?', parsed.id, parsed.hourBand, parsed.dayType).toArray()[0];
      const merged = existing ? mergeHistograms(parseHistogram(existing.hist), h) : h;
      sql.exec('INSERT OR REPLACE INTO stop_dwell (stop, band, daytype, hist, n) VALUES (?, ?, ?, ?, ?)', parsed.id, parsed.hourBand, parsed.dayType, serializeHistogram(merged), histogramCount(merged));
      rows++;
    }
  });
  return rows;
}
