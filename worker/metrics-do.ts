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
}

/** Longest event/dimension string ever stored; a defensive clamp, not a real limit. */
const STRING_MAX_CHARS = 64;
/** More rows than a year of every event x dimension combination could plausibly
 *  produce — the cap exists so a query can never build an unbounded response. */
const QUERY_MAX_ROWS = 50_000;

export class MetricsDO extends DurableObject<Env> {
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
    for (const entry of entries) {
      if (!isMetricEvent(entry.event)) continue;
      this.ctx.storage.sql.exec(
        `INSERT INTO metrics_hourly (day, hour, event, dim1, dim2, count) VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT (day, hour, event, dim1, dim2) DO UPDATE SET count = count + 1`,
        day,
        hour,
        entry.event,
        (entry.dim1 ?? '').slice(0, STRING_MAX_CHARS),
        (entry.dim2 ?? '').slice(0, STRING_MAX_CHARS),
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDay)) throw new Error('invalid-since-day');
    return this.ctx.storage.sql
      .exec<MetricsDailyRow>(
        `SELECT day, hour, event, dim1, dim2, count FROM metrics_hourly
          WHERE day >= ?
          ORDER BY day, hour, event, dim1, dim2
          LIMIT ${QUERY_MAX_ROWS}`,
        sinceDay,
      )
      .toArray();
  }
}
