import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../worker/env';
import { TwinDO, twinStub } from '../../worker/do/twin-do';
import { metricsStub, zagrebDayHour } from '../../worker/metrics';
import { FEED_TICK_MS, TICK_CUSHION_MS, TICK_MIN_DELAY_MS, nextTickAt } from '../../worker/twin/clock';
import { ensureSchema, indexCheckedAt, indexFeedVersion, indexNeedsBackfill, LEARN_FLUSH_MS, lookupTrips } from '../../worker/twin/persist';
import { setTwinIndexSourceForTest, setTwinNetworkSourceForTest, setTwinUpstreamForTest } from '../../worker/twin/seams';
import { recordingKey } from '../../worker/twin/record';
import { evalPathPlan } from '../../shared/motion/plan';
import { isFreeMotion, isPathMotion, type PathMotion } from '../../shared/motion/wire';
import { corridorIndex } from './engine-fixture';
import { frame, type FrameVehicle } from './frames';
import { corridorSpec, lonLatOf, syntheticNetwork } from '../motion/synthetic-network';

const testEnv = env as unknown as Env;

// The corridor (test/motion/synthetic-network.ts) as the twin's world: route
// '1' east along the trunk (path 1_0), route '2' north (path 2_0), bus '109'
// on a polyline south of the trunk. Trips t1a/t1b run 1_0, t2 runs 2_0, and
// t9 runs the shapeless pattern's synthetic path.
const NET = syntheticNetwork(corridorSpec());
const INDEX = corridorIndex(NET, [
  { tripId: 't1a', pathId: '1_0' },
  { tripId: 't1b', pathId: '1_0' },
  { tripId: 't2', pathId: '2_0' },
  { tripId: 't9', pathId: 'path:9:0:abc' },
]);

/** A tram on the trunk at metre `x`, reported `at`. */
function tram(vehicleId: string, tripId: string, routeId: string, x: number, at: number): FrameVehicle {
  const { lon, lat } = lonLatOf({ x, y: 0 });
  return { vehicleId, tripId, routeId, lon, lat, at };
}

// A day ahead of the real clock: the alarms the twin arms around T0 are then
// always in the future, so miniflare never fires one on its own mid-test;
// runDurableObjectAlarm fires them by hand where a test wants that.
const T0 = Math.floor(Date.now() / 1000) + 86_400;

// One object per test: the production singleton would carry memory and an
// alarm from one test into the next.
let twinSeq = 0;
function freshTwin(): DurableObjectStub<TwinDO> {
  return twinStub(testEnv, `twin-test-${++twinSeq}`);
}

/** An upstream that serves a scripted sequence of frames (or 304s, or throws). */
function scriptedUpstream(script: Array<Uint8Array | 304 | Error>, etag = (i: number) => `W/"frame-${i}"`) {
  let i = 0;
  const seen: Array<string | null> = [];
  const upstream = async (ifNoneMatch: string | null): Promise<Response> => {
    seen.push(ifNoneMatch);
    const step = script[Math.min(i, script.length - 1)];
    const index = i++;
    if (step instanceof Error) throw step;
    if (step === 304) return new Response(null, { status: 304 });
    return new Response(step, { status: 200, headers: { etag: etag(index), 'content-type': 'application/x-protobuf' } });
  };
  return { upstream, seen, calls: () => i };
}

async function pinClock(stub: DurableObjectStub<TwinDO>, ms: number): Promise<void> {
  await runInDurableObject(stub, (instance: TwinDO) => {
    vi.spyOn(instance, 'now').mockReturnValue(ms);
  });
}

const armedAlarm = (stub: DurableObjectStub<TwinDO>) => runInDurableObject(stub, (_i: TwinDO, state) => state.storage.getAlarm());
const pin = (payload: { items: { id: string }[] }, id: string) => payload.items.find((item) => item.id === `vehicle:${id}`) as { id: string; geo?: { coordinates: number[] }; data?: Record<string, unknown>; motion?: unknown } | undefined;

beforeEach(() => {
  setTwinIndexSourceForTest(async () => INDEX);
  setTwinNetworkSourceForTest(async () => NET);
});

afterEach(() => {
  setTwinUpstreamForTest(null);
  setTwinIndexSourceForTest(null);
  setTwinNetworkSourceForTest(null);
});

describe('TwinDO', () => {
  it('ticks inline on the first read: a path plan per tram with the pin at the plan, the join and the twin scalars, no history, the alarm armed, the frame recorded', async () => {
    const bytes = frame(T0, [tram('a', 't1a', '1', 400, T0 - 5), tram('c', 't2', '2', 900, T0 - 2)]);
    const { upstream, seen } = scriptedUpstream([bytes]);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);

    const payload = await stub.publish();
    expect(seen).toEqual([null]);
    expect(payload.sourceUpdatedAt).toBe(new Date(T0 * 1000).toISOString());
    expect(payload.validUntil).toBe(new Date(T0 * 1000 + FEED_TICK_MS + TICK_CUSHION_MS).toISOString());
    expect(payload.sources?.zet.status).toBe('live');
    const a = pin(payload, 'a')!;
    expect(a.data).toMatchObject({ routeId: '1', tripId: 't1a', direction: 0, headsign: 'Kraj 1_0', shapeId: '1_0' });
    expect(typeof a.data?.speed).toBe('number');
    expect(typeof a.data?.confidence).toBe('number');
    expect(typeof a.data?.held).toBe('boolean');
    expect(a.motion && isPathMotion(a.motion as PathMotion)).toBe(true);
    const motion = a.motion as PathMotion;
    expect(motion.path).toBe('1_0');
    expect(motion).not.toHaveProperty('history');
    const [lon, lat] = (() => {
      const pathIdx = NET.paths.findIndex((p) => p.id === '1_0');
      const p = NET.toPathPoint(pathIdx, evalPathPlan(motion.plan, 0));
      return [lonLatOf(p).lon, lonLatOf(p).lat];
    })();
    expect(a.geo!.coordinates[0]).toBeCloseTo(lon, 4);
    expect(a.geo!.coordinates[1]).toBeCloseTo(lat, 4);
    expect((pin(payload, 'c')!.motion as PathMotion).path).toBe('2_0');
    expect(await armedAlarm(stub)).toBe(nextTickAt(T0, T0 * 1000 + 2_000));
    const stored = await testEnv.RECORDINGS!.get(recordingKey(T0));
    expect(Array.from(new Uint8Array(await stored!.arrayBuffer()))).toEqual(Array.from(bytes));
    const report = await runInDurableObject(stub, (instance: TwinDO) => instance.lastReportForTest());
    expect(report).toMatchObject({ outcome: 'ok', indexLoaded: true, networkLoaded: true, cold: true });
  });

  it('carries the plan forward across ticks, sends the ETag it was given, refuses a second fetch inside the floor, and grades its own plans into one batched histogram write', async () => {
    const script = [0, 1, 2, 3].map((k) => frame(T0 + 10 * k, [tram('a', 't1a', '1', 400 + 100 * k, T0 + 10 * k - 3)]));
    const { upstream, seen, calls } = scriptedUpstream(script);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    const day = zagrebDayHour(new Date()).day;
    const before = (await metricsStub(testEnv).query(day)).filter((r) => r.event === 'twin_hindsight').reduce((sum, r) => sum + r.count, 0);
    await pinClock(stub, T0 * 1000 + 2_000);
    await stub.publish();
    let graded = 0;
    for (let k = 1; k <= 3; k++) {
      await pinClock(stub, (T0 + 10 * k) * 1000 + 2_000);
      const report = await stub.tick();
      expect(report).toMatchObject({ outcome: 'ok', headerTs: T0 + 10 * k, newFixes: 1, cold: false });
      graded += report.hindsightSamples;
    }
    expect(seen).toEqual([null, 'W/"frame-0"', 'W/"frame-1"', 'W/"frame-2"']);
    expect(graded).toBeGreaterThan(0);
    const payload = await stub.publish();
    const a = pin(payload, 'a')!;
    expect(evalPathPlan((a.motion as PathMotion).plan, 0)).toBeGreaterThan(600); // the plan has followed the tram east
    // The histogram reached MetricsDO as counted cells, not one write per vehicle.
    const after = (await metricsStub(testEnv).query(day)).filter((r) => r.event === 'twin_hindsight');
    expect(after.reduce((sum, r) => sum + r.count, 0) - before).toBe(graded);
    expect(after.every((r) => ['10s', '30s', '60s'].includes(r.dim1) && ['lt25', 'lt50', 'lt100', 'lt200', 'ge200'].includes(r.dim2))).toBe(true);
    // A retried alarm inside the floor is a no-op, not a second fetch.
    await pinClock(stub, (T0 + 30) * 1000 + 2_000 + TICK_MIN_DELAY_MS - 1);
    expect(await stub.tick()).toMatchObject({ outcome: 'unchanged' });
    expect(calls()).toBe(4);
  });

  it('writes what the ordering register did into one twin_order batch per tick', async () => {
    // Two trams on the trunk, the leader 400 m ahead and both moving: by the
    // second frame the register has written the relation, and every tick
    // reports what it DID (E3) -- dim1 the register's own event vocabulary,
    // dim2 the kind.
    const script = [0, 1, 2].map((k) =>
      frame(T0 + 10 * k, [tram('a', 't1a', '1', 1000 + 80 * k, T0 + 10 * k - 2), tram('b', 't1b', '1', 600 + 80 * k, T0 + 10 * k - 2)]),
    );
    const { upstream } = scriptedUpstream(script);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    const day = zagrebDayHour(new Date()).day;
    const orderRows = async () => (await metricsStub(testEnv).query(day)).filter((r) => r.event === 'twin_order');
    const before = (await orderRows()).reduce((sum, r) => sum + r.count, 0);
    await pinClock(stub, T0 * 1000 + 2_000);
    await stub.publish();
    for (let k = 1; k <= 2; k++) {
      await pinClock(stub, (T0 + 10 * k) * 1000 + 2_000);
      expect(await stub.tick()).toMatchObject({ outcome: 'ok' });
    }
    const after = await orderRows();
    expect(after.reduce((sum, r) => sum + r.count, 0)).toBeGreaterThan(before);
    expect(after.every((r) => ['established', 'dropped', 'hold', 'push', 'concession', 'swap'].includes(r.dim1))).toBe(true);
    expect(after.every((r) => r.dim2 === 'tram')).toBe(true);
    expect(after.some((r) => r.dim1 === 'established')).toBe(true);
    // The standing count of relations is a gauge and this table sums over the
    // hour, so it is never written as a counter cell.
    expect(after.some((r) => r.dim1 === 'relation')).toBe(false);
  });

  it('treats a 304 and a repeated header as no new evidence but still re-plans: validUntil moves, the plan stands, nothing new is recorded; an upstream error keeps the last payload', async () => {
    const first = frame(T0, [tram('a', 't1a', '1', 400, T0 - 5)]);
    const { upstream } = scriptedUpstream([first, 304, first, new Error('upstream 503 Service Unavailable')]);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);
    await stub.publish();
    const recordedBefore = (await testEnv.RECORDINGS!.list({ prefix: 'zet-rt/' })).objects.length;
    await pinClock(stub, T0 * 1000 + 12_000);
    expect(await stub.tick()).toMatchObject({ outcome: 'unchanged', headerTs: T0, newFixes: 0 });
    await pinClock(stub, T0 * 1000 + 22_000);
    expect(await stub.tick()).toMatchObject({ outcome: 'unchanged', headerTs: T0, newFixes: 0 });
    let payload = await stub.publish();
    expect(payload.validUntil).toBe(new Date(nextTickAt(T0, T0 * 1000 + 22_000)).toISOString());
    expect((pin(payload, 'a')!.motion as PathMotion).path).toBe('1_0');
    expect((await testEnv.RECORDINGS!.list({ prefix: 'zet-rt/' })).objects.length).toBe(recordedBefore);
    await pinClock(stub, T0 * 1000 + 32_000);
    expect(await stub.tick()).toMatchObject({ outcome: 'error' });
    payload = await stub.publish();
    expect(pin(payload, 'a')).toBeDefined();
  });

  it('the alarm ticks and re-arms one tick plus the cushion after the new header; ensureRunning arms once and leaves an armed alarm alone', async () => {
    const { upstream } = scriptedUpstream([frame(T0, [tram('a', 't1a', '1', 400, T0 - 5)]), frame(T0 + 10, [tram('a', 't1a', '1', 500, T0 + 4)])]);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);
    await stub.publish();
    const alarmNow = T0 * 1000 + FEED_TICK_MS + TICK_CUSHION_MS;
    await pinClock(stub, alarmNow);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await armedAlarm(stub)).toBe(nextTickAt(T0 + 10, alarmNow));
    expect((await runInDurableObject(stub, (instance: TwinDO) => instance.lastReportForTest()))?.headerTs).toBe(T0 + 10);

    const idle = freshTwin();
    await pinClock(idle, T0 * 1000);
    expect(await armedAlarm(idle)).toBeNull();
    await idle.ensureRunning();
    const first = await armedAlarm(idle);
    expect(first).toBe(nextTickAt(null, T0 * 1000));
    await pinClock(idle, T0 * 1000 + 5_000);
    await idle.ensureRunning();
    expect(await armedAlarm(idle)).toBe(first);
  });

  it('restores the fleet from its last state row after losing its memory, rebuilding the plans from the persisted tracks; the next tick says cold', async () => {
    const { upstream } = scriptedUpstream([frame(T0, [tram('a', 't1a', '1', 400, T0 - 5)]), frame(T0 + 10, [tram('a', 't1a', '1', 500, T0 + 4)])]);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);
    await stub.publish();
    await pinClock(stub, (T0 + 10) * 1000 + 2_000);
    const live = await stub.tick();
    expect(live.stateBytes).toBeGreaterThan(0);
    await runInDurableObject(stub, (instance: TwinDO) => instance.forgetForTest());
    const restored = await stub.publish();
    const a = pin(restored, 'a')!;
    expect((a.motion as PathMotion).path).toBe('1_0');
    expect(a.data).toMatchObject({ direction: 0, headsign: 'Kraj 1_0' });
    expect(evalPathPlan((a.motion as PathMotion).plan, 0)).toBeGreaterThan(450);
    await pinClock(stub, (T0 + 20) * 1000 + 2_000);
    expect(await stub.tick()).toMatchObject({ cold: true });
  });

  // F8: a shapeless pattern runs the synthetic path built from its own stop
  // sequence. The decoded index resolves that once at load; the SQLite copy an
  // earlier life wrote has to resolve it the same way, or an evicted twin whose
  // index asset is slow (or unreadable) would put such a trip on the route and
  // direction's FIRST synthetic path until the index came back.
  it('carries the resolved path id in the SQLite join too, not only in the decoded index', async () => {
    const { upstream } = scriptedUpstream([
      frame(T0, [tram('a', 't9', '9', 400, T0 - 5)]),
      frame(T0 + 10, [tram('a', 't9', '9', 500, T0 + 4)]),
    ]);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);
    await stub.publish(); // the index is in memory, and its rows reach SQLite

    const warm = await runInDurableObject(stub, (instance: TwinDO) => instance.joinsForTest(['t9']));
    expect(warm.t9).toMatchObject({ shapeId: null, pathId: 'path:9:0:abc', service: 'wd' });

    // Memory gone and the index asset unreadable: only the SQLite copy answers.
    await runInDurableObject(stub, (instance: TwinDO) => instance.forgetForTest());
    setTwinIndexSourceForTest(async () => null);
    await pinClock(stub, (T0 + 10) * 1000 + 2_000);
    const report = await stub.tick();
    expect(report).toMatchObject({ indexLoaded: false, networkLoaded: true });
    const cold = await runInDurableObject(stub, (instance: TwinDO) => instance.joinsForTest(['t9']));
    expect(cold.t9).toMatchObject({ shapeId: null, pathId: 'path:9:0:abc', service: 'wd' });
    // (The plans themselves are free-plane while the index is missing -- the
    // engine needs both assets -- so it is the join that is worth asserting:
    // the moment the index returns, that join already names the right path.)
  });

  it('migrates an existing trip table without losing rows and leaves unknown legacy services absent', async () => {
    const stub = freshTwin();
    const migrated = await runInDurableObject(stub, (_instance: TwinDO, state) => {
      const sql = state.storage.sql;
      sql.exec('ALTER TABLE trips DROP COLUMN service');
      sql.exec("INSERT INTO trips VALUES ('legacy', 0, 'legacy-block', 100)");
      ensureSchema(sql);
      ensureSchema(sql); // an already-migrated database is safe too
      sql.exec("INSERT INTO patterns VALUES (0, '1', 0, '1_0', 'Terminus', '[]', '[]', '[]')");
      const before = lookupTrips(sql, ['legacy']).get('legacy');
      sql.exec("UPDATE trips SET service = 'wd' WHERE trip_id = 'legacy'");
      return { before, after: lookupTrips(sql, ['legacy']).get('legacy') };
    });
    expect(migrated.before).toMatchObject({ shapeId: '1_0', startSec: 100, block: 'legacy-block' });
    expect(migrated.before).not.toHaveProperty('service');
    expect(migrated.after).toMatchObject({ service: 'wd' });
  });

  it.each(['missing-column', 'unmarked-column'])('backfills a same-version %s index before a later cold lookup', async (legacy) => {
    setTwinUpstreamForTest(scriptedUpstream([
      frame(T0, [tram('a', 't9', '9', 400, T0 - 5)]),
      frame(T0 + 10, [tram('a', 't9', '9', 500, T0 + 4)]),
    ]).upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);
    await stub.publish();

    // Keep the feed version and fresh checked-at time. Simulate either a
    // pre-service database or the earlier migration that left empty rows.
    const upgraded = await runInDurableObject(stub, (instance: TwinDO, state) => {
      const sql = state.storage.sql;
      sql.exec("DELETE FROM meta WHERE key = 'index_schema_version'");
      if (legacy === 'missing-column') sql.exec('ALTER TABLE trips DROP COLUMN service');
      else sql.exec("UPDATE trips SET service = ''");
      ensureSchema(sql);
      ensureSchema(sql);
      instance.forgetForTest();
      return {
        feedVersion: indexFeedVersion(sql),
        checkedAt: indexCheckedAt(sql),
        pending: indexNeedsBackfill(sql),
        join: lookupTrips(sql, ['t9']).get('t9'),
      };
    });
    expect(upgraded).toMatchObject({ feedVersion: INDEX.feedVersion, checkedAt: T0 * 1000 + 2_000, pending: true });
    expect(upgraded.join).not.toHaveProperty('service');

    await stub.publish(); // same version, same clock, but backfill is pending
    const refreshed = await runInDurableObject(stub, (_instance: TwinDO, state) => {
      ensureSchema(state.storage.sql); // must not re-arm a completed backfill
      return {
        feedVersion: indexFeedVersion(state.storage.sql),
        pending: indexNeedsBackfill(state.storage.sql),
        join: lookupTrips(state.storage.sql, ['t9']).get('t9'),
      };
    });
    expect(refreshed).toMatchObject({ feedVersion: INDEX.feedVersion, pending: false, join: { service: 'wd' } });

    await runInDurableObject(stub, (instance: TwinDO) => instance.forgetForTest());
    setTwinIndexSourceForTest(async () => null);
    await pinClock(stub, (T0 + 10) * 1000 + 2_000);
    expect(await stub.tick()).toMatchObject({ indexLoaded: false, networkLoaded: true });
    const cold = await runInDurableObject(stub, (instance: TwinDO) => instance.joinsForTest(['t9']));
    expect(cold.t9).toMatchObject({ shapeId: null, pathId: 'path:9:0:abc', service: 'wd' });
  });

  it('evicts a vehicle silent for more than three minutes', async () => {
    const { upstream } = scriptedUpstream([
      frame(T0, [tram('a', 't1a', '1', 400, T0 - 5), tram('b', 't1b', '1', 100, T0 - 5)]),
      frame(T0 + 320, [tram('a', 't1a', '1', 1400, T0 + 318)]),
    ]);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);
    let payload = await stub.publish();
    expect(pin(payload, 'b')).toBeDefined();
    await pinClock(stub, (T0 + 320) * 1000 + 2_000);
    expect((await stub.tick()).evicted).toBe(1);
    payload = await stub.publish();
    expect(pin(payload, 'b')).toBeUndefined();
  });

  it('gives an unknown trip on a known route a path from the route edges (R-TE22) and flags a mostly-unknown frame; without any network every vehicle rides a free plan', async () => {
    setTwinUpstreamForTest(scriptedUpstream([frame(T0, [tram('a', 'new-1', '1', 400, T0 - 5), tram('b', 'new-2', '1', 800, T0 - 5), tram('c', 't1a', '1', 1200, T0 - 5)])]).upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);
    const payload = await stub.publish();
    expect(await runInDurableObject(stub, (instance: TwinDO) => instance.lastReportForTest())).toMatchObject({ outcome: 'stale_index', unknownTrips: 2, vehicles: 3 });
    const a = pin(payload, 'a')!;
    expect(a.data).not.toHaveProperty('headsign');
    expect(a.motion && isPathMotion(a.motion as PathMotion)).toBe(true); // the route's own edges still carry it
    expect(pin(payload, 'c')!.data).toMatchObject({ direction: 0, headsign: 'Kraj 1_0' });

    setTwinNetworkSourceForTest(async () => null);
    setTwinUpstreamForTest(scriptedUpstream([frame(T0, [tram('a', 't1a', '1', 400, T0 - 5)]), frame(T0 + 10, [tram('a', 't1a', '1', 500, T0 + 5)])]).upstream);
    const blind = freshTwin();
    await pinClock(blind, T0 * 1000 + 2_000);
    await blind.publish();
    await pinClock(blind, (T0 + 10) * 1000 + 2_000);
    await blind.tick();
    const noGeometry = await blind.publish();
    const free = pin(noGeometry, 'a')!;
    expect(free.motion && isFreeMotion(free.motion as never)).toBe(true);
    expect(free.data).toMatchObject({ headsign: 'Kraj 1_0' }); // the join needs no geometry
    expect(await runInDurableObject(blind, (instance: TwinDO) => instance.lastReportForTest())).toMatchObject({ outcome: 'ok', networkLoaded: false, indexLoaded: true });
  });

  // The review's I5. The serialized state row measured 1.42 MB at the
  // morning peak against the Durable Object's ~2 MB row cap, and nothing in
  // production ever saw the number: one line a minute, beside the flush.
  it('logs how big the state row is, once a minute beside the learning flush', async () => {
    const script = [0, 1].map((k) => frame(T0 + 10 * k, [tram('a', 't1a', '1', 400 + 100 * k, T0 + 10 * k - 3)]));
    setTwinUpstreamForTest(scriptedUpstream(script).upstream);
    const stub = freshTwin();
    const logged = vi.spyOn(console, 'log');
    try {
      await pinClock(stub, T0 * 1000 + 2_000);
      await stub.publish(); // the first tick only starts the flush clock
      expect(logged.mock.calls.flat().filter((line) => String(line).includes('twin_state_size'))).toHaveLength(0);
      // A minute and a second on: the flush is due, and the line goes with it.
      await pinClock(stub, (T0 + 10) * 1000 + 2_000 + LEARN_FLUSH_MS + 1_000);
      const report = await stub.tick();
      expect(report.learnedFlushed).toBe(true);
      const lines = logged.mock.calls.flat().map(String).filter((line) => line.includes('twin_state_size'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/twin_state_size bytes=\d+ vehicles=1$/);
      // The same number the tick report carries, so /stats and the log agree.
      expect(lines[0]).toContain(`bytes=${report.stateBytes}`);
    } finally {
      logged.mockRestore();
    }
  });
});
