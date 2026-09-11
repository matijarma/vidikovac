// The closed counter vocabulary, the Zagreb clock and the fire-and-forget
// write path. Pure apart from recordMetric, so the unit project can load it;
// metrics-do.ts imports from here (never the other way at runtime).
//
// Contract note (B4, then B6b — see task-B4-report.md and task-B6b-report.md
// "Rulings"): rulings.md R-14/R-17/R-20/R-24/R-29/R-31/R-42/R-44 pin a
// single-event `record(event, dim1?, dim2?)` alongside a batch `recordMany`,
// `MetricsDailyRow`/`METRICS_DO_NAME` importable from worker/metrics-do.ts, a
// void fire-and-forget `recordMetric` that never throws (sync or async), and
// `EXPORT_KINDS`/`ExportKind` living only in protocol.ts — never a second list
// here. Area D's task D3 (already merged) imports
// `MetricsDailyRow`/`METRICS_DO_NAME` from `../metrics-do` and calls
// `stub.query(sinceDay)` directly. `METRICS_DO_NAME` itself now lives in the
// dependency-free `worker/metrics-do-name.ts` (fix round 1, R-42 finding):
// metrics-do.ts imports 'cloudflare:workers', which the `unit` vitest
// project's plain-node environment cannot resolve, so neither metrics.ts nor
// metrics-do.ts can own the constant via a re-export of the other without
// breaking one side's project — a third, importless module resolves that
// without either file being a value re-export of the other.
import type { Env } from './env';
import type { MetricsDO } from './metrics-do';
import { logError } from './log';
import { CLIENT_EVENTS, SERVER_EVENTS } from './protocol';
import type { ClientEvent, ServerEvent } from './protocol';

import { METRICS_DO_NAME } from './metrics-do-name';
export { METRICS_DO_NAME };

/** Every countable event, derived from protocol.ts's own arrays (R-17/R-24):
 *  no second, hand-typed allowlist. */
export const METRIC_EVENTS: readonly (ServerEvent | ClientEvent)[] = [...SERVER_EVENTS, ...CLIENT_EVENTS];

const EVENT_SET: ReadonlySet<string> = new Set(METRIC_EVENTS);

export function isMetricEvent(name: unknown): name is ServerEvent | ClientEvent {
  return typeof name === 'string' && EVENT_SET.has(name);
}

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
 * Fires one counter increment at MetricsDO and forgets it (R-29/R-42):
 * returns void, is never awaited or passed to `ctx.waitUntil` by a caller,
 * and never throws — synchronously or asynchronously. An event outside the
 * closed vocabulary is dropped silently. `metricsStub(env)` can throw
 * synchronously (e.g. `namespace.idFromName(...)` if `env.METRICS_DO` were
 * ever absent or misconfigured); the outer try/catch swallows that the same
 * way `.catch()` swallows a rejected write, in both cases logging the
 * failure so an operator has visibility without a broken request (fix
 * round 1: the R-29/R-42 finding that a synchronous throw here would
 * otherwise propagate uncaught into every bare `void recordMetric(...)`
 * call site).
 */
export function recordMetric(env: Env, event: ServerEvent | ClientEvent, dim1 = '', dim2 = ''): void {
  if (!isMetricEvent(event)) return;
  try {
    void metricsStub(env)
      .record(event, dim1, dim2)
      .catch((error: unknown) => {
        logError('metrics-write-failed', error, { event });
      });
  } catch (error) {
    logError('metrics-write-failed', error, { event });
  }
}
