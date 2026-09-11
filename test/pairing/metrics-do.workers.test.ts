import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import { recordMetric, zagrebDayHour } from '../../worker/metrics';
import { METRICS_DO_NAME, MetricsDO, type MetricsDailyRow } from '../../worker/metrics-do';
import { waitForRow } from './helpers';

const testEnv = env as unknown as Env;

function stub(): DurableObjectStub<MetricsDO> {
  const namespace = testEnv.METRICS_DO as DurableObjectNamespace<MetricsDO>;
  return namespace.get(namespace.idFromName(METRICS_DO_NAME));
}

async function rows(): Promise<MetricsDailyRow[]> {
  return stub().query('2020-01-01');
}

function total(list: MetricsDailyRow[], event: string, dim1 = '', dim2 = ''): number {
  return list.filter((r) => r.event === event && r.dim1 === dim1 && r.dim2 === dim2).reduce((s, r) => s + r.count, 0);
}

describe('MetricsDO', () => {
  it('is addressed by the shared name and starts empty', async () => {
    const namespace = testEnv.METRICS_DO as DurableObjectNamespace<MetricsDO>;
    const s = namespace.get(namespace.idFromName(METRICS_DO_NAME));
    expect(await s.query('2020-01-01')).toEqual([]);
  });

  it('upserts (day, hour, event, dim1, dim2) and stores the Zagreb hour', async () => {
    const s = stub();
    await s.record('session_start', 'kiosk', 'donji-grad');
    await s.record('session_start', 'kiosk', 'donji-grad');
    await s.record('session_start', 'phone');
    const list = await rows();
    expect(total(list, 'session_start', 'kiosk', 'donji-grad')).toBe(2);
    expect(total(list, 'session_start', 'phone')).toBe(1);
    const expected = zagrebDayHour(new Date());
    for (const row of list) {
      expect(row.day).toBe(expected.day);
      expect(row.hour).toBe(expected.hour);
    }
  });

  it('drops events outside the closed vocabulary instead of throwing, and clamps long dimensions', async () => {
    const s = stub();
    await s.record('page_view');
    await s.record('');
    await s.record('hitno_view', 'x'.repeat(200));
    const list = await rows();
    expect(list.filter((r) => r.event === 'page_view')).toHaveLength(0);
    expect(list.filter((r) => r.event === '')).toHaveLength(0);
    expect(total(list, 'hitno_view', 'x'.repeat(64))).toBe(1);
  });

  it('query validates the day shape and orders rows', async () => {
    const s = stub();
    // Asserted on the instance directly (not through the stub's RPC boundary): a
    // rejection from an RPC method is correctly delivered to the caller as a
    // rejected promise, but vitest-pool-workers *also* reports it to workerd's
    // top-level exception log (verified with a minimal throwing DO unrelated to
    // this one), which fails the run even though the rejection was properly
    // asserted. Calling the instance in-process sidesteps that RPC-layer
    // artifact while still exercising the exact validation logic `query` runs.
    await runInDurableObject(s, async (instance: MetricsDO) => {
      await expect(instance.query('yesterday')).rejects.toThrow(/invalid-since-day/);
    });
    await s.record('scan_fail', 'code-used');
    await s.record('over_cap', 'kiosk');
    const list = await rows();
    const keys = list.map((r) => `${r.day}|${r.hour}|${r.event}|${r.dim1}|${r.dim2}`);
    expect(keys).toEqual([...keys].sort());
  });

  it('the schema has no identifier column', async () => {
    const s = stub();
    const columns = await runInDurableObject(s, (_instance: MetricsDO, state) =>
      state.storage.sql.exec<{ name: string }>(`PRAGMA table_info(metrics_hourly)`).toArray().map((c) => c.name),
    );
    expect(columns).toEqual(['day', 'hour', 'event', 'dim1', 'dim2', 'count']);
  });

  it('recordMetric is void and fire-and-forget: it never throws, and the write lands', async () => {
    expect(recordMetric(testEnv, 'kiosk_online', 'sesvete')).toBeUndefined();
    expect(recordMetric(testEnv, 'not_an_event' as never)).toBeUndefined();
    const list = await waitForRow(stub(), (list) => total(list, 'kiosk_online', 'sesvete') > 0);
    expect(total(list, 'kiosk_online', 'sesvete')).toBe(1);
    expect(list.filter((r) => r.event === 'not_an_event')).toHaveLength(0);
  });
});
