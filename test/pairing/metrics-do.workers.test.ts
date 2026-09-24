import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import { metricsStub, recordMetric, zagrebDayHour } from '../../worker/metrics';
import { METRICS_DO_NAME, MetricsDO, RETENTION_DAYS, retentionCutoff, type MetricsDailyRow } from '../../worker/metrics-do';
import { waitForRows } from './helpers';

const testEnv = env as unknown as Env;

function stub(): DurableObjectStub<MetricsDO> {
  return metricsStub(testEnv);
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
    const list = await waitForRows(stub(), (list) => total(list, 'kiosk_online', 'sesvete') > 0);
    expect(total(list, 'kiosk_online', 'sesvete')).toBe(1);
    expect(list.filter((r) => r.event === 'not_an_event')).toHaveLength(0);
  });

  it('queryEvents reads only the named events, ignores words outside the vocabulary, oldest first', async () => {
    const s = stub();
    await s.recordMany([
      { event: 'session_start', dim1: 'knjiznica', dim2: 'trnje', count: 4 },
      { event: 'twin_tick', dim1: 'ok', dim2: 'warm', count: 90 },
      { event: 'hitno_view', dim1: 'page', count: 2 },
    ]);
    const list = await s.queryEvents('2020-01-01', ['session_start', 'hitno_view', 'no_such_event']);
    expect(new Set(list.map((r) => r.event))).toEqual(new Set(['session_start', 'hitno_view']));
    expect(total(list, 'session_start', 'knjiznica', 'trnje')).toBe(4);
    const keys = list.map((r) => `${r.day}|${r.hour}|${r.event}|${r.dim1}|${r.dim2}`);
    expect(keys).toEqual([...keys].sort());
    expect(await s.queryEvents('2020-01-01', ['no_such_event'])).toEqual([]);
  });

  it('totals sums the named events over hours, per day or over the window', async () => {
    const s = stub();
    await runInDurableObject(s, (_instance: MetricsDO, state) => {
      for (const [day, hour, count] of [['2026-09-20', 1, 5], ['2026-09-20', 2, 7], ['2026-09-21', 3, 11]] as const) {
        state.storage.sql.exec(`INSERT INTO metrics_hourly (day, hour, event, dim1, dim2, count) VALUES (?, ?, 'source_fetch', 'zet-rt', 'ok', ?)`, day, hour, count);
      }
    });
    expect(await s.totals('2026-09-20', ['source_fetch'], true)).toEqual([
      { day: '2026-09-20', event: 'source_fetch', dim1: 'zet-rt', dim2: 'ok', count: 12 },
      { day: '2026-09-21', event: 'source_fetch', dim1: 'zet-rt', dim2: 'ok', count: 11 },
    ]);
    expect(await s.totals('2026-09-21', ['source_fetch'], false)).toEqual([{ day: '', event: 'source_fetch', dim1: 'zet-rt', dim2: 'ok', count: 11 }]);
  });

  it('keeps the newest rows when a window runs past the cap', async () => {
    const s = stub();
    await runInDurableObject(s, async (instance: MetricsDO, state) => {
      state.storage.sql.exec(`INSERT INTO metrics_hourly (day, hour, event, dim1, dim2, count) VALUES ('2026-01-01', 0, 'hitno_view', 'page', '', 1)`);
      state.storage.sql.exec(`INSERT INTO metrics_hourly (day, hour, event, dim1, dim2, count) VALUES ('2026-09-01', 0, 'hitno_view', 'page', '', 1)`);
      // The same select the cap guards, at a cap of one: the newest day must win.
      const newest = (instance as unknown as { newestFirstCapped(sql: string, b: unknown[]): MetricsDailyRow[] }).newestFirstCapped(
        `SELECT day, hour, event, dim1, dim2, count FROM metrics_hourly WHERE day >= ? AND day <= '2026-09-01' ORDER BY day DESC, hour DESC, event DESC, dim1 DESC, dim2 DESC LIMIT 1`,
        ['2020-01-01'],
      );
      expect(newest.map((r) => r.day)).toEqual(['2026-09-01']);
    });
  });

  it('drops cells older than 24 months on the first write of a Zagreb day', async () => {
    const s = stub();
    const today = zagrebDayHour(new Date()).day;
    const old = retentionCutoff(today);
    const tooOld = new Date(Date.parse(`${old}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    await runInDurableObject(s, (instance: MetricsDO, state) => {
      (instance as unknown as { prunedDay: string }).prunedDay = '';
      for (const day of [tooOld, old]) {
        state.storage.sql.exec(`INSERT INTO metrics_hourly (day, hour, event, dim1, dim2, count) VALUES (?, 0, 'hitno_view', 'page', '', 1)`, day);
      }
    });
    await s.record('hitno_view', 'page');
    const days = (await s.query('2000-01-01')).map((r) => r.day);
    expect(days).not.toContain(tooOld);
    expect(days).toContain(old);
    expect(RETENTION_DAYS).toBe(730);
    expect(retentionCutoff('2028-09-24')).toBe('2026-09-25');
  });

  it('publicCells folds every hourly row of the window where it lives, city and evaluation apart', async () => {
    const s = stub();
    await runInDurableObject(s, (_instance: MetricsDO, state) => {
      const put = (day: string, hour: number, event: string, dim1: string, dim2: string, count: number) =>
        state.storage.sql.exec(`INSERT INTO metrics_hourly (day, hour, event, dim1, dim2, count) VALUES (?, ?, ?, ?, ?, ?)`, day, hour, event, dim1, dim2, count);
      put('2026-03-01', 10, 'session_start', 'knjiznica', 'trnje', 23);
      put('2026-03-01', 11, 'session_start', 'kafic', 'trnje', 4);
      put('2026-03-01', 12, 'evaluation', 'session_start', 'maksimir', 12);
      put('2026-03-01', 12, 'twin_tick', 'ok', 'warm', 360);
    });
    const cells = await s.publicCells('2026-03-01');
    const march = (list: { day: string }[]) => list.filter((c) => c.day === '2026-03-01');
    expect(march(cells.city)).toEqual([{ month: '2026-03', day: '2026-03-01', hour: '10', event: 'session_start', dim1: 'knjiznica', dim2: 'trnje', count: 25 }]);
    expect(march(cells.evaluation)).toEqual([{ month: '2026-03', day: '2026-03-01', hour: '12', event: 'session_start', dim1: 'privremeni', dim2: 'maksimir', count: 10 }]);
  });
});
