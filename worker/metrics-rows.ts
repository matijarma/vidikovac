// The shapes MetricsDO hands out, with no import of anything: worker/metrics-do.ts
// needs 'cloudflare:workers', and code that only reads rows (worker/stats/*,
// the e2e fixtures) must type-check without it.

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

/** One aggregated cell of MetricsDO.totals: `day` is '' when the window was
 *  summed across days. */
export type MetricsTotalRow = {
  day: string;
  event: string;
  dim1: string;
  dim2: string;
  count: number;
};
