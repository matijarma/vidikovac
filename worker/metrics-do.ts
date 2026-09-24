// MetricsDO: the aggregate-counter store. One named instance (METRICS_DO_NAME)
// for the whole deployment. Privacy is structural: a row is
// (day, hour, event, dim1, dim2) -> count in Europe/Zagreb; there is nowhere
// to put an identifier. Ported from psdlat worker/src/metrics-do.ts with the
// `hour` column the City dataset needs and the closed vocabulary from
// protocol.ts enforced at the write.
//
// The exported shape here (METRICS_DO_NAME, MetricsDailyRow, MetricsDO with
// record(event, dim1?, dim2?) / recordMany(entries) / query(sinceDay)) is
// pinned by rulings.md R-14/R-20/R-29/R-42 and already committed against by
// Area D's task D3 (worker/stats/export.ts, worker/stats/page.ts,
// worker/routes/stats.ts all import MetricsDailyRow and METRICS_DO_NAME from
// this module) — see worker/metrics.ts's header comment and task-B6b-report.md
// for the full reconciliation against the plan text originally handed to
// task B4.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { isMetricEvent, zagrebDayHour } from './metrics';

// METRICS_DO_NAME lives in the dependency-free worker/metrics-do-name.ts
// (fix round 1, R-42 finding), not declared directly here: this file imports
// 'cloudflare:workers', which only the `workers` vitest project can resolve,
// so a plain declaration here re-exported by metrics.ts would break the
// `unit` project's test/pairing/metrics.test.ts. See worker/metrics.ts's
// header comment for the full reconciliation.
export { METRICS_DO_NAME } from './metrics-do-name';

/** One row of the aggregate counter table. `day` is YYYY-MM-DD and `hour` is
 *  0-23, both Europe/Zagreb. A type alias, not an interface: SqlStorage#exec's
 *  row constraint is satisfied through the implicit index signature only
 *  aliases get. */
export type MetricsDailyRow = {
  day: string;
  hour: number;
  event: string;
  dim1: string;
  dim2: string;
  count: number;
};

/** One entry of a batched write via {@link MetricsDO.recordMany}; same shape
 *  {@link MetricsDO.record}'s parameters take. */
export interface MetricsEntry {
  event: string;
  dim1?: string;
  dim2?: string;
  /** How many of this event the entry stands for; 1 when absent. A producer
   *  that counts many observations per tick (the twin's hindsight histogram)
   *  writes one entry per cell instead of one RPC per observation. */
  count?: number;
}

/** A single entry never adds more than this: a runaway producer must not
 *  turn one bad tick into a year of counts. */
const COUNT_MAX = 1_000_000;

/** Longest event/dimension string ever stored; a defensive clamp, not a real limit. */
const STRING_MAX_CHARS = 64;
/** The cap exists so a query can never build an unbounded response. The
 *  engine and source counters alone fill about 50 cells an hour, so a long
 *  window can reach it: when it does, the OLDEST rows are the ones left out
 *  (the newest day is the one an operator came to see). */
export const QUERY_MAX_ROWS = 50_000;

/** How long an hourly cell is kept: 24 months, the promise of /privatnost/
 *  point 6. Enforced on write, at most once per Zagreb day. */
export const RETENTION_DAYS = 730;

/** One aggregated cell of {@link MetricsDO.totals}: `day` is '' when the
 *  window was summed across days. */
export type MetricsTotalRow = {
  day: string;
  event: string;
  dim1: string;
  dim2: string;
  count: number;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The first Zagreb day still kept on `today`: RETENTION_DAYS back, calendar days. */
export function retentionCutoff(today: string): string {
  const t = Date.parse(`${today}T00:00:00Z`) - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

/** The events a caller asks for, cleaned: only vocabulary words, each once. */
function eventList(events: readonly string[]): string[] {
  return [...new Set(events.filter((e) => isMetricEvent(e)))];
}

export class MetricsDO extends DurableObject<Env> {
  /** The Zagreb day the retention sweep last ran on, in this instance's life. */
  private prunedDay = '';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS metrics_hourly (
           day TEXT NOT NULL,
           hour INTEGER NOT NULL,
           event TEXT NOT NULL,
           dim1 TEXT NOT NULL DEFAULT '',
           dim2 TEXT NOT NULL DEFAULT '',
           count INTEGER NOT NULL DEFAULT 0,
           PRIMARY KEY (day, hour, event, dim1, dim2)
         )`,
      );
    });
  }

  /**
   * Increment one counter cell for the current Zagreb day and hour. An event
   * outside the closed vocabulary is dropped, never thrown on: a bad write
   * must not become anyone's error path (recordMetric's whole contract, R-29,
   * depends on this method never rejecting for ordinary bad input). Delegates
   * to the same insert path as {@link recordMany} (R-42), as a single-entry batch.
   */
  async record(event: string, dim1 = '', dim2 = ''): Promise<void> {
    await this.recordMany([{ event, dim1, dim2 }]);
  }

  /**
   * Batched form of `record` (R-29/R-42's "batch method ... never
   * substituted"): every entry outside the closed vocabulary is dropped, the
   * rest upsert through the identical (day, hour, event, dim1, dim2) cell
   * `record` writes to. One Zagreb (day, hour) stamp covers the whole call —
   * the entries in a single batch are effectively simultaneous.
   */
  async recordMany(entries: readonly MetricsEntry[]): Promise<void> {
    const { day, hour } = zagrebDayHour(new Date());
    this.prune(day);
    for (const entry of entries) {
      if (!isMetricEvent(entry.event)) continue;
      const count = Math.max(1, Math.min(COUNT_MAX, Math.floor(entry.count ?? 1)));
      this.ctx.storage.sql.exec(
        `INSERT INTO metrics_hourly (day, hour, event, dim1, dim2, count) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (day, hour, event, dim1, dim2) DO UPDATE SET count = count + excluded.count`,
        day,
        hour,
        entry.event,
        (entry.dim1 ?? '').slice(0, STRING_MAX_CHARS),
        (entry.dim2 ?? '').slice(0, STRING_MAX_CHARS),
        count,
      );
    }
  }

  /**
   * Every row on or after sinceDay (YYYY-MM-DD, Zagreb), ordered by day, hour,
   * event, dim1, dim2. A bad argument throws: the only callers are the /stats
   * page and its exports, where a programmer error should surface, not read
   * as an empty deployment.
   */
  async query(sinceDay: string): Promise<MetricsDailyRow[]> {
    if (!DAY_RE.test(sinceDay)) throw new Error('invalid-since-day');
    return this.newestFirstCapped(
      `SELECT day, hour, event, dim1, dim2, count FROM metrics_hourly
        WHERE day >= ?
        ORDER BY day DESC, hour DESC, event DESC, dim1 DESC, dim2 DESC
        LIMIT ${QUERY_MAX_ROWS}`,
      [sinceDay],
    );
  }

  /**
   * The hourly rows of the named events only, on or after sinceDay, in the
   * same order and under the same cap as {@link query}. The City export and
   * the public report read their few events here, so the engine's thousands
   * of cells never crowd a person-event out of a long window. Words outside
   * the vocabulary are ignored; none left is an empty answer.
   */
  async queryEvents(sinceDay: string, events: readonly string[]): Promise<MetricsDailyRow[]> {
    if (!DAY_RE.test(sinceDay)) throw new Error('invalid-since-day');
    const wanted = eventList(events);
    if (wanted.length === 0) return [];
    return this.newestFirstCapped(
      `SELECT day, hour, event, dim1, dim2, count FROM metrics_hourly
        WHERE day >= ? AND event IN (${wanted.map(() => '?').join(', ')})
        ORDER BY day DESC, hour DESC, event DESC, dim1 DESC, dim2 DESC
        LIMIT ${QUERY_MAX_ROWS}`,
      [sinceDay, ...wanted],
    );
  }

  /**
   * The named events summed over hours: per Zagreb day when `byDay`, else
   * over the whole window (day ''). Ordered by day, event, dim1, dim2. Only
   * for counters with no person in them (the engine, the sources): the public
   * page shows those exactly, and a sum over hours is all it draws.
   */
  async totals(sinceDay: string, events: readonly string[], byDay: boolean): Promise<MetricsTotalRow[]> {
    if (!DAY_RE.test(sinceDay)) throw new Error('invalid-since-day');
    const wanted = eventList(events);
    if (wanted.length === 0) return [];
    const day = byDay ? 'day' : "''";
    return this.ctx.storage.sql
      .exec<MetricsTotalRow>(
        `SELECT ${day} AS day, event, dim1, dim2, SUM(count) AS count FROM metrics_hourly
          WHERE day >= ? AND event IN (${wanted.map(() => '?').join(', ')})
          GROUP BY ${byDay ? 'day, ' : ''}event, dim1, dim2
          ORDER BY ${byDay ? 'day, ' : ''}event, dim1, dim2
          LIMIT ${QUERY_MAX_ROWS}`,
        sinceDay,
        ...wanted,
      )
      .toArray();
  }

  /** Runs a newest-first capped select and hands the rows back oldest first. */
  private newestFirstCapped(sql: string, bindings: unknown[]): MetricsDailyRow[] {
    return this.ctx.storage.sql.exec<MetricsDailyRow>(sql, ...bindings).toArray().reverse();
  }

  /** Deletes the cells older than RETENTION_DAYS, once per Zagreb day. */
  private prune(today: string): void {
    if (this.prunedDay === today) return;
    this.prunedDay = today;
    this.ctx.storage.sql.exec(`DELETE FROM metrics_hourly WHERE day < ?`, retentionCutoff(today));
  }
}
