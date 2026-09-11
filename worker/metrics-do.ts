// MetricsDO: the aggregate-counter store. One named instance (METRICS_DO_NAME)
// for the whole deployment. Privacy is structural: a row is
// (day, hour, event, dim1, dim2) -> count in Europe/Zagreb; there is nowhere
// to put an identifier. Ported from psdlat worker/src/metrics-do.ts with the
// `hour` column the City dataset needs and the closed vocabulary from
// protocol.ts enforced at the write.
//
// The exported shape here (METRICS_DO_NAME, MetricsDailyRow, MetricsDO with
// record(event, dim1?, dim2?) / query(sinceDay)) is pinned by rulings.md
// R-14/R-20/R-29 and already committed against by Area D's task D3
// (worker/stats/export.ts, worker/stats/page.ts, worker/routes/stats.ts all
// import MetricsDailyRow and METRICS_DO_NAME from this module) — see
// worker/metrics.ts's header comment and this task's report for the full
// reconciliation against the plan text originally handed to this task.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { isMetricEvent, zagrebDayHour } from './metrics';

export { METRICS_DO_NAME } from './metrics';

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
   * depends on this method never rejecting for ordinary bad input).
   */
  async record(event: string, dim1 = '', dim2 = ''): Promise<void> {
    if (!isMetricEvent(event)) return;
    const { day, hour } = zagrebDayHour(new Date());
    this.ctx.storage.sql.exec(
      `INSERT INTO metrics_hourly (day, hour, event, dim1, dim2, count) VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT (day, hour, event, dim1, dim2) DO UPDATE SET count = count + 1`,
      day,
      hour,
      event,
      dim1.slice(0, STRING_MAX_CHARS),
      dim2.slice(0, STRING_MAX_CHARS),
    );
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
