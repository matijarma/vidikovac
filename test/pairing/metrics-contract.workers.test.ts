// B6b (R-14, R-29, R-42, R-44): proves the shape Area D's already-merged
// /stats consumes — METRICS_DO_NAME and MetricsDailyRow importable from
// worker/metrics-do.ts, query() answering a Promise, recordMetric returning
// void, EXPORT_KINDS living only in protocol.ts — and that B4's batch path
// (recordMany) is present alongside the single-event record().
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { METRICS_DO_NAME, MetricsDO, type MetricsDailyRow, type MetricsEntry } from '../../worker/metrics-do';
import { recordMetric } from '../../worker/metrics';
import { EXPORT_KINDS, SERVER_EVENTS } from '../../worker/protocol';
import { waitForRows } from './helpers';

describe('metrics contract (R-14, R-29, R-42, R-44)', () => {
  it('exports the names Area D consumes and answers query as a Promise', async () => {
    expect(METRICS_DO_NAME).toBe('global');
    const id = env.METRICS_DO.idFromName(METRICS_DO_NAME);
    const stub = env.METRICS_DO.get(id) as unknown as DurableObjectStub<MetricsDO>;
    const before = stub.query('2000-01-01');
    // Not `toBeInstanceOf(Promise)`: a Durable Object RPC method accessed through
    // its stub returns a JsRpcPromise (workerd's cross-boundary thenable), never
    // a native Promise instance, even though `query` is declared `async` and
    // genuinely returns a Promise inside the DO. Thenable-ness is what R-14/R-42
    // actually require (the caller can `await` it); class identity is not.
    expect(typeof (before as PromiseLike<unknown>).then).toBe('function');
    expect(await before).toEqual([]);
  });

  it('record() writes one cell that query() returns with the documented row shape', async () => {
    const id = env.METRICS_DO.idFromName(METRICS_DO_NAME);
    const stub = env.METRICS_DO.get(id) as unknown as DurableObjectStub<MetricsDO>;
    await stub.record('kiosk_online', 'donji-grad', '');
    const rows = await stub.query('2000-01-01');
    expect(rows).toHaveLength(1);
    const row: MetricsDailyRow = rows[0]!;
    expect(row).toMatchObject({ event: 'kiosk_online', dim1: 'donji-grad', dim2: '', count: 1 });
    expect(row.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(row.hour).toBeGreaterThanOrEqual(0);
    expect(row.hour).toBeLessThanOrEqual(23);
  });

  it('recordMany writes multiple cells in one call and drops invalid entries', async () => {
    const id = env.METRICS_DO.idFromName(METRICS_DO_NAME);
    const stub = env.METRICS_DO.get(id) as unknown as DurableObjectStub<MetricsDO>;
    const entries: MetricsEntry[] = [
      { event: 'panel_open', dim1: 'kultura' },
      { event: 'panel_open', dim1: 'kultura' },
      { event: 'not_an_event', dim1: 'x' },
    ];
    await stub.recordMany(entries);
    const rows = await stub.query('2000-01-01');
    const cell = rows.find((r) => r.event === 'panel_open' && r.dim1 === 'kultura');
    expect(cell?.count).toBe(2);
    expect(rows.some((r) => r.event === 'not_an_event')).toBe(false);
  });

  it('recordMetric returns void and still lands a row', async () => {
    const result = recordMetric(env, 'session_start', 'kiosk', 'donji-grad');
    expect(result).toBeUndefined();
    const id = env.METRICS_DO.idFromName(METRICS_DO_NAME);
    const stub = env.METRICS_DO.get(id) as unknown as DurableObjectStub<MetricsDO>;
    // waitForRows (R-31) polls the whole row list; recordMetric is fire-and-forget
    // and hands the caller no promise to await, so a per-call predicate over the
    // returned rows is how a test observes the write landing.
    const rows = await waitForRows(stub, (list) => list.some((r) => r.event === 'session_start' && r.dim1 === 'kiosk'), 2000);
    const row = rows.find((r) => r.event === 'session_start' && r.dim1 === 'kiosk');
    expect(row?.count).toBe(1);
  });

  it('drops events outside SERVER_EVENTS and CLIENT_EVENTS and keeps EXPORT_KINDS in protocol.ts', async () => {
    const id = env.METRICS_DO.idFromName(METRICS_DO_NAME);
    await runInDurableObject(env.METRICS_DO.get(id) as unknown as DurableObjectStub<MetricsDO>, async (instance: MetricsDO) => {
      await instance.record('not_an_event', 'x', 'y');
      const rows = await instance.query('2000-01-01');
      expect(rows.some((r) => r.event === 'not_an_event')).toBe(false);
    });
    expect(SERVER_EVENTS).toContain('kiosk_online');
    expect(EXPORT_KINDS).toEqual(['copy', 'share', 'ics', 'geojson', 'print']);
  });
});
