// Shared helpers for Area B's workers-pool tests (R-12: test/pairing/** is
// Area B's test directory).
import type { MetricsDailyRow, MetricsDO } from '../../worker/metrics-do';

const EPOCH_DAY = '2020-01-01';

/**
 * Polls MetricsDO until predicate(rows) is true or timeoutMs elapses (R-31).
 * `recordMetric` is void and fire-and-forget (R-29): a caller has no promise
 * to await, so a test observes the resulting row this way instead of a fixed
 * setTimeout or an immediate read that may race the write.
 */
export async function waitForRow(
  stub: DurableObjectStub<MetricsDO>,
  predicate: (rows: MetricsDailyRow[]) => boolean,
  timeoutMs = 1000,
): Promise<MetricsDailyRow[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await stub.query(EPOCH_DAY);
    if (predicate(rows)) return rows;
    if (Date.now() >= deadline) throw new Error(`waitForRow: timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
