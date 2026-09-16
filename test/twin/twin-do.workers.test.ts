import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../worker/env';
import { TwinDO, twinStub } from '../../worker/do/twin-do';
import { FEED_TICK_MS, TICK_CUSHION_MS, TICK_MIN_DELAY_MS, nextTickAt } from '../../worker/twin/clock';
import { setTwinIndexSourceForTest, setTwinUpstreamForTest } from '../../worker/twin/seams';
import { recordingKey } from '../../worker/twin/record';
import { HISTORY_FIXES } from '../../shared/motion/wire';
import { frame, v } from './frames';

const testEnv = env as unknown as Env;

// The trip index as scripts/gtfs-trips.mjs (task A1) writes it: columnar,
// dictionary-coded. Two patterns the tests join against; anything else is an
// unknown trip.
const WIRE_INDEX = {
  version: 1,
  feedVersion: '000395',
  builtAt: '2026-09-16T00:00:00.000Z',
  source: 'ZET GTFS',
  headsigns: ['Črnomerec', 'Savišće'],
  patterns: {
    route: ['6', '33'],
    direction: [1, 0],
    shape: ['6_12', '33_28'],
    headsign: [0, 1],
    stops: [
      ['264_2', '222_2', '197_2', '231_2'],
      ['177_4', '175_4', '128_4', '266_4'],
    ],
    sched: [
      Array.from({ length: 24 }, () => [91, 157, 72]),
      Array.from({ length: 24 }, () => [108, 105, 2382]),
    ],
    dwell: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    trips: [2, 1],
  },
  trips: {
    id: ['t33', 't6', 't6b'],
    pattern: [1, 0, 0],
    block: [1, 0, 0],
    start: [89154, 14400, 15000],
    service: [1, 0, 0],
  },
  blocks: { id: ['601', '3302'], trips: [[1, 2], [0]] },
  services: { id: ['0_20', '0_23'] },
};

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

beforeEach(() => {
  setTwinIndexSourceForTest(async () => WIRE_INDEX);
});

afterEach(() => {
  setTwinUpstreamForTest(null);
  setTwinIndexSourceForTest(null);
});

describe('TwinDO publish', () => {
  it('ticks inline on the first read and publishes joined pins with a one-fix history', async () => {
    const { upstream, seen } = scriptedUpstream([
      frame(T0, [v('a', T0 - 5, 15.97, 45.81, 't6', '6'), v('b', T0 - 2, 16.03709, 45.79139, 't33', '33')], [
        { tripId: 't6', routeId: '6', stops: [{ seq: 4, stopId: '231_2', delay: 45 }] },
      ]),
    ]);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);

    const payload = await stub.publish();
    expect(seen).toEqual([null]); // no ETag to send on the first fetch
    expect(payload.sourceUpdatedAt).toBe(new Date(T0 * 1000).toISOString());
    expect(payload.validUntil).toBe(new Date(T0 * 1000 + FEED_TICK_MS + TICK_CUSHION_MS).toISOString());
    expect(payload.sources?.zet.status).toBe('live');

    const a = payload.items.find((item) => item.id === 'vehicle:a')!;
    expect(a.data).toMatchObject({ routeId: '6', tripId: 't6', direction: 1, headsign: 'Črnomerec', shapeId: '6_12', nextStopId: '231_2', delaySeconds: 45 });
    expect(a.motion).toEqual({ history: [[-5, 15.97, 45.81]] });
    const b = payload.items.find((item) => item.id === 'vehicle:b')!;
    expect(b.data).toMatchObject({ direction: 0, headsign: 'Savišće', shapeId: '33_28' });
    expect(b.data).not.toHaveProperty('nextStopId');

    const armedAt = await runInDurableObject(stub, (_i: TwinDO, state) => state.storage.getAlarm());
    expect(armedAt).toBe(nextTickAt(T0, T0 * 1000 + 2_000));
  });

  it('grows the history across ticks and sends the ETag it was given', async () => {
    const { upstream, seen } = scriptedUpstream([
      frame(T0, [v('a', T0 - 5, 15.97, 45.81, 't6', '6')]),
      frame(T0 + 10, [v('a', T0 + 4, 15.971, 45.811, 't6', '6')]),
      frame(T0 + 20, [v('a', T0 + 15, 15.972, 45.812, 't6', '6')]),
    ]);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);
    await stub.publish();
    await pinClock(stub, (T0 + 10) * 1000 + 2_000);
    const second = await stub.tick();
    expect(second).toMatchObject({ outcome: 'ok', headerTs: T0 + 10, newFixes: 1, cold: false });
    await pinClock(stub, (T0 + 20) * 1000 + 2_000);
    await stub.tick();
    const payload = await stub.publish();
    const a = payload.items.find((item) => item.id === 'vehicle:a')!;
    expect(a.motion).toEqual({ history: [[-25, 15.97, 45.81], [-16, 15.971, 45.811], [-5, 15.972, 45.812]] });
    expect(seen).toEqual([null, 'W/"frame-0"', 'W/"frame-1"']);
  });

  it('treats a 304 and a repeated header as no new evidence, and still moves validUntil', async () => {
    const first = frame(T0, [v('a', T0 - 5)]);
    const { upstream } = scriptedUpstream([first, 304, first]);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);
    await stub.publish();
    await pinClock(stub, T0 * 1000 + 12_000);
    expect(await stub.tick()).toMatchObject({ outcome: 'unchanged', headerTs: T0, newFixes: 0 });
    await pinClock(stub, T0 * 1000 + 22_000);
    expect(await stub.tick()).toMatchObject({ outcome: 'unchanged', headerTs: T0, newFixes: 0 });
    const payload = await stub.publish();
    // Two ticks without a new header is not yet a stall: the next try comes at the floor.
    expect(payload.validUntil).toBe(new Date(nextTickAt(T0, T0 * 1000 + 22_000)).toISOString());
    expect(payload.items.find((item) => item.id === 'vehicle:a')!.motion).toEqual({ history: [[-5, 15.97, 45.81]] });
  });

  it('keeps the last payload and reports an error when the upstream fails', async () => {
    const { upstream } = scriptedUpstream([frame(T0, [v('a', T0 - 5)]), new Error('upstream 503 Service Unavailable')]);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);
    await stub.publish();
    await pinClock(stub, T0 * 1000 + 12_000);
    expect(await stub.tick()).toMatchObject({ outcome: 'error' });
    const payload = await stub.publish();
    expect(payload.items.some((item) => item.id === 'vehicle:a')).toBe(true);
  });

  it('never fetches twice within the floor: a retried alarm is a no-op', async () => {
    const { upstream, calls } = scriptedUpstream([frame(T0, [v('a', T0 - 5)])]);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);
    await stub.publish();
    await pinClock(stub, T0 * 1000 + 2_000 + TICK_MIN_DELAY_MS - 1);
    expect(await stub.tick()).toMatchObject({ outcome: 'unchanged' });
    expect(calls()).toBe(1);
  });
});

describe('TwinDO alarm chain', () => {
  it('the alarm ticks and re-arms itself one tick plus the cushion after the new header', async () => {
    const { upstream } = scriptedUpstream([frame(T0, [v('a', T0 - 5)]), frame(T0 + 10, [v('a', T0 + 4, 15.971, 45.811)])]);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);
    await stub.publish();
    const alarmNow = T0 * 1000 + FEED_TICK_MS + TICK_CUSHION_MS;
    await pinClock(stub, alarmNow);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const armedAt = await runInDurableObject(stub, (_i: TwinDO, state) => state.storage.getAlarm());
    expect(armedAt).toBe(nextTickAt(T0 + 10, alarmNow));
    const payload = await stub.publish();
    expect(payload.items.find((item) => item.id === 'vehicle:a')!.motion).toEqual({ history: [[-15, 15.97, 45.81], [-6, 15.971, 45.811]] });
  });

  it('ensureRunning arms an alarm when none is set and leaves an existing one alone', async () => {
    setTwinUpstreamForTest(scriptedUpstream([frame(T0, [])]).upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000);
    expect(await runInDurableObject(stub, (_i: TwinDO, state) => state.storage.getAlarm())).toBeNull();
    await stub.ensureRunning();
    const first = await runInDurableObject(stub, (_i: TwinDO, state) => state.storage.getAlarm());
    expect(first).toBe(nextTickAt(null, T0 * 1000));
    await pinClock(stub, T0 * 1000 + 5_000);
    await stub.ensureRunning();
    expect(await runInDurableObject(stub, (_i: TwinDO, state) => state.storage.getAlarm())).toBe(first);
  });
});

describe('TwinDO memory', () => {
  it('restores the fleet from its last state row after losing its memory (eviction between ticks)', async () => {
    const { upstream } = scriptedUpstream([frame(T0, [v('a', T0 - 5, 15.97, 45.81, 't6', '6')]), frame(T0 + 10, [v('a', T0 + 4, 15.971, 45.811, 't6', '6')])]);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);
    await stub.publish();
    await pinClock(stub, (T0 + 10) * 1000 + 2_000);
    await stub.tick();
    await runInDurableObject(stub, (instance: TwinDO) => instance.forgetForTest());
    const restored = await stub.publish();
    expect(restored.items.find((item) => item.id === 'vehicle:a')!.motion).toEqual({ history: [[-15, 15.97, 45.81], [-6, 15.971, 45.811]] });
    expect(restored.items.find((item) => item.id === 'vehicle:a')!.data).toMatchObject({ direction: 1, headsign: 'Črnomerec' });
    // The next tick after a restore is a cold one and says so.
    await pinClock(stub, (T0 + 20) * 1000 + 2_000);
    expect(await stub.tick()).toMatchObject({ cold: true });
  });

  it('caps every ring at HISTORY_FIXES and evicts a vehicle silent for five minutes', async () => {
    const frames: Uint8Array[] = [];
    for (let i = 0; i < HISTORY_FIXES + 2; i++) {
      frames.push(frame(T0 + 10 * i, [v('a', T0 + 10 * i - 2, 15.97 + i * 0.001, 45.81), ...(i === 0 ? [v('b', T0 - 2, 15.99, 45.82)] : [])]));
    }
    frames.push(frame(T0 + 400, [v('a', T0 + 398, 15.999, 45.81)]));
    const { upstream } = scriptedUpstream(frames);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    for (let i = 0; i < HISTORY_FIXES + 2; i++) {
      await pinClock(stub, (T0 + 10 * i) * 1000 + 2_000);
      await stub.tick();
    }
    let payload = await stub.publish();
    expect((payload.items.find((item) => item.id === 'vehicle:a')!.motion as { history: unknown[] }).history).toHaveLength(HISTORY_FIXES);
    expect(payload.items.some((item) => item.id === 'vehicle:b')).toBe(true);
    await pinClock(stub, (T0 + 400) * 1000 + 2_000);
    const report = await stub.tick();
    expect(report.evicted).toBe(1);
    payload = await stub.publish();
    expect(payload.items.some((item) => item.id === 'vehicle:b')).toBe(false);
  });
});

describe('TwinDO index and recording', () => {
  it('publishes no join for a trip the index does not know and flags a mostly-unknown frame', async () => {
    const { upstream } = scriptedUpstream([
      frame(T0, [v('a', T0 - 5, 15.97, 45.81, 'new-static-trip-1', '6'), v('b', T0 - 5, 15.98, 45.82, 'new-static-trip-2', '6'), v('c', T0 - 5, 15.99, 45.83, 't6', '6')]),
    ]);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);
    await stub.publish();
    const report = await runInDurableObject(stub, (instance: TwinDO) => instance.lastReportForTest());
    expect(report).toMatchObject({ outcome: 'stale_index', unknownTrips: 2, vehicles: 3 });
    const payload = await stub.publish();
    const a = payload.items.find((item) => item.id === 'vehicle:a')!;
    expect(a.data).not.toHaveProperty('direction');
    expect(a.data).not.toHaveProperty('headsign');
    expect(payload.items.find((item) => item.id === 'vehicle:c')!.data).toMatchObject({ direction: 1 });
  });

  it('still publishes when the index cannot be loaded, without a join', async () => {
    setTwinIndexSourceForTest(async () => null);
    setTwinUpstreamForTest(scriptedUpstream([frame(T0, [v('a', T0 - 5, 15.97, 45.81, 't6', '6')])]).upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);
    const payload = await stub.publish();
    const a = payload.items.find((item) => item.id === 'vehicle:a')!;
    expect(a.data).toMatchObject({ routeId: '6', tripId: 't6' });
    expect(a.data).not.toHaveProperty('headsign');
    expect(await runInDurableObject(stub, (instance: TwinDO) => instance.lastReportForTest())).toMatchObject({ outcome: 'ok', indexLoaded: false });
  });

  it('records each new frame in R2 under its header key and skips an unchanged one', async () => {
    const bytes = frame(T0, [v('a', T0 - 5)]);
    const { upstream } = scriptedUpstream([bytes, 304]);
    setTwinUpstreamForTest(upstream);
    const stub = freshTwin();
    await pinClock(stub, T0 * 1000 + 2_000);
    await stub.publish();
    const stored = await testEnv.RECORDINGS!.get(recordingKey(T0));
    expect(stored).not.toBeNull();
    expect(Array.from(new Uint8Array(await stored!.arrayBuffer()))).toEqual(Array.from(bytes));
    // The bucket is shared by every test in this file, so count relative to now.
    const before = (await testEnv.RECORDINGS!.list({ prefix: 'zet-rt/' })).objects.length;
    await pinClock(stub, T0 * 1000 + 12_000);
    await stub.tick();
    const after = (await testEnv.RECORDINGS!.list({ prefix: 'zet-rt/' })).objects.length;
    expect(after).toBe(before);
  });
});
