// The MetricsDO instance name, alone: R-42 requires it live in
// worker/metrics-do.ts (moved from metrics.ts, which re-exports it), but
// worker/metrics-do.ts imports `DurableObject` from 'cloudflare:workers',
// which only the `workers` vitest project can resolve (see
// vitest.config.ts — the `unit` project runs pure Node, no cloudflareTest
// shim). worker/metrics.ts must stay loadable there (test/pairing/metrics.test.ts
// runs under `unit`), so a barrel `export { METRICS_DO_NAME } from
// './metrics-do'` inside metrics.ts would evaluate metrics-do.ts's module
// body — including its 'cloudflare:workers' import — at unit-test load time
// and fail. This module has no imports at all, so both worker/metrics.ts and
// worker/metrics-do.ts can depend on it without either one owning the
// constant via a re-export of the other. See task-B6b-report.md's
// fix-round-1 entry (R-42 finding) for the full reconciliation.
export const METRICS_DO_NAME = 'global';
