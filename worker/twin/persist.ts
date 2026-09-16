// What the twin keeps in its own SQLite: one compact state row per tick (so
// an object evicted between two 10 s alarms wakes up knowing the fleet), and
// a copy of the static trip index (task A1's zet-trips.json) in tables, so a
// realtime trip id resolves in one indexed lookup instead of re-parsing 78k
// rows on every cold start. Everything here is plain SQL over the storage
// the Durable Object hands in; no Cloudflare import, so the shapes and the
// statements can be read in isolation.

import type { TwinState } from './history';
import type { TripJoin } from './publish';

/** How long tick rows are kept: two days covers a weekend of debugging a
 *  reported oddity by replaying the twin's own states, while 8,640 rows a
 *  day at well under 120 KB each stay far inside the storage the plan
 *  budgets. */
export const STATE_RETENTION_MS = 48 * 60 * 60 * 1000;

/** How often the twin re-reads the static index asset to learn about a
 *  new deploy: the asset changes only on a push, and a push restarts the
 *  isolate anyway, so an hourly check is a safety net, not the mechanism. */
export const INDEX_RECHECK_MS = 60 * 60 * 1000;

/** Rows per multi-row INSERT: 20 trips × 4 columns keeps a statement at 80
 *  bound parameters, comfortably under SQLite's conservative limits, while
 *  cutting the 78k-row load to about 4k statements. */
const TRIP_ROWS_PER_INSERT = 20;
const PATTERN_ROWS_PER_INSERT = 10;
const BLOCK_ROWS_PER_INSERT = 40;

/** Trip ids per lookup statement, for the same parameter-count reason. */
const LOOKUP_CHUNK = 50;

export interface IndexPattern {
  route: string;
  direction: 0 | 1;
  /** GTFS shape id, or null for a pattern whose trips carry none (line 1). */
  shape: string | null;
  headsign: string;
  /** Ordered stop ids. */
  stops: string[];
  /** Per hour band (0..23): median scheduled seconds between consecutive stops. */
  sched: number[][];
  /** Per stop: median scheduled dwell seconds (departure minus arrival). */
  dwell: number[];
}

export interface IndexTrip {
  id: string;
  pattern: number;
  block: string;
  /** First scheduled departure, seconds past service midnight (may exceed 86400). */
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
}

// ---- tick state -------------------------------------------------------------

export function saveState(sql: SqlStorage, state: TwinState): void {
  sql.exec('INSERT OR REPLACE INTO state (tick_at, header_ts, etag, body) VALUES (?, ?, ?, ?)', state.tickAtMs, state.headerTs, state.etag, JSON.stringify(state));
}

export function loadLatestState(sql: SqlStorage): TwinState | null {
  const row = sql.exec<{ body: string }>('SELECT body FROM state ORDER BY tick_at DESC LIMIT 1').toArray()[0];
  if (!row) return null;
  try {
    return JSON.parse(row.body) as TwinState;
  } catch {
    return null;
  }
}

/** Deletes tick rows older than `beforeMs`; returns how many went. */
export function pruneState(sql: SqlStorage, beforeMs: number): number {
  return sql.exec('DELETE FROM state WHERE tick_at < ?', beforeMs).rowsWritten;
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
    insertBatched(
      sql,
      'trips',
      ['trip_id', 'pattern', 'block', 'start'],
      rows.trips.map((t) => [t.id, t.pattern, t.block, t.start]),
      TRIP_ROWS_PER_INSERT,
    );
    insertBatched(
      sql,
      'blocks',
      ['block', 'trips'],
      rows.blocks.map((b) => [b.id, JSON.stringify(b.trips)]),
      BLOCK_ROWS_PER_INSERT,
    );
    metaSet(sql, 'feed_version', rows.feedVersion);
  });
}

/** The join for each known trip id; unknown ids are simply absent. */
export function lookupTrips(sql: SqlStorage, tripIds: readonly string[]): Map<string, TripLookup> {
  const out = new Map<string, TripLookup>();
  const unique = [...new Set(tripIds)];
  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + LOOKUP_CHUNK);
    const rows = sql
      .exec<{ trip_id: string; pattern: number; block: string; direction: number; shape: string | null; headsign: string }>(
        `SELECT t.trip_id, t.pattern, t.block, p.direction, p.shape, p.headsign
           FROM trips t JOIN patterns p ON p.idx = t.pattern
          WHERE t.trip_id IN (${chunk.map(() => '?').join(', ')})`,
        ...chunk,
      )
      .toArray();
    for (const row of rows) {
      out.set(row.trip_id, {
        direction: row.direction === 1 ? 1 : 0,
        headsign: row.headsign,
        shapeId: row.shape,
        pattern: row.pattern,
        block: row.block,
      });
    }
  }
  return out;
}
