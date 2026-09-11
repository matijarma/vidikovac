// The closed counter vocabulary, the Zagreb clock and the fire-and-forget
// write path. Pure apart from recordMetric, so the unit project can load it;
// metrics-do.ts imports from here (never the other way at runtime).
//
// Contract note (see task-B4-report.md "Rulings"): the plan text originally
// handed to this task specified a batch `record(entries)` DO method and a
// Promise-returning `recordMetric`. The controller's rulings.md (R-14, R-17,
// R-20, R-24, R-29, R-31) pin a different, already-consumed shape: a single-
// event `record(event, dim1?, dim2?)`, `METRICS_DO_NAME`/`MetricsDailyRow`
// exported from worker/metrics-do.ts, and a void, fire-and-forget
// `recordMetric` observed in tests only via a polling helper (R-31). Area D's
// task D3 is already committed against exactly that shape (`worker/stats/
// export.ts`, `worker/stats/page.ts`, `worker/routes/stats.ts` on the area-D
// branch import `MetricsDailyRow`/`METRICS_DO_NAME` from `../metrics-do` and
// call `stub.query(sinceDay)`), so this file follows the rulings, not the
// stale plan text.
import type { Env } from './env';
import { logError } from './log';
import type { MetricsDO } from './metrics-do';
import { CLIENT_EVENTS, SERVER_EVENTS } from './protocol';
import type { ClientEvent, ServerEvent } from './protocol';

/** The one MetricsDO instance every writer and reader uses. Re-exported from
 *  worker/metrics-do.ts (R-14/R-20) so Area D's /stats page can import it
 *  from either module; declared here so this module stays free of
 *  'cloudflare:workers' and the unit project can load it. */
export const METRICS_DO_NAME = 'global';

/** Every countable event, derived from protocol.ts's own arrays (R-17/R-24):
 *  no second, hand-typed allowlist. */
export const METRIC_EVENTS: readonly (ServerEvent | ClientEvent)[] = [...SERVER_EVENTS, ...CLIENT_EVENTS];

const EVENT_SET: ReadonlySet<string> = new Set(METRIC_EVENTS);

export function isMetricEvent(name: unknown): name is ServerEvent | ClientEvent {
  return typeof name === 'string' && EVENT_SET.has(name);
}

/** Second dimension of the client `export` event; the first is the LayerId. */
export const EXPORT_KINDS = ['copy', 'link', 'ics', 'geojson', 'pdf'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

const ZAGREB = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Zagreb',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

/** Calendar day and hour in Europe/Zagreb, the grain the City dataset is counted at. */
export function zagrebDayHour(at: Date): { day: string; hour: number } {
  const parts: Record<string, string> = {};
  for (const part of ZAGREB.formatToParts(at)) parts[part.type] = part.value;
  const hour = Number(parts.hour) % 24;
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour };
}

/** The one shared stub every writer and reader builds from, so the two-line
 *  namespace/idFromName lookup exists in exactly one place. */
export function metricsStub(env: Env): DurableObjectStub<MetricsDO> {
  const namespace = env.METRICS_DO as DurableObjectNamespace<MetricsDO>;
  return namespace.get(namespace.idFromName(METRICS_DO_NAME));
}

/**
 * Fires one counter increment at MetricsDO and forgets it (R-29): returns
 * void, is never awaited or passed to `ctx.waitUntil` by a caller, and never
 * throws. An event outside the closed vocabulary is dropped silently; any
 * failure reaching the DO is dropped after one operational log line.
 */
export function recordMetric(env: Env, event: ServerEvent | ClientEvent, dim1?: string, dim2?: string): void {
  try {
    if (!isMetricEvent(event)) return;
    Promise.resolve(metricsStub(env).record(event, dim1, dim2)).catch((error) =>
      logError('metrics-write-failed', error, { event }),
    );
  } catch (error) {
    logError('metrics-write-failed', error, { event });
  }
}
