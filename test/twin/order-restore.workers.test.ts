import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../worker/env';
import { TwinDO, twinStub } from '../../worker/do/twin-do';
import { metricsStub, zagrebDayHour } from '../../worker/metrics';
import { setTwinIndexSourceForTest, setTwinNetworkSourceForTest, setTwinUpstreamForTest, type TwinUpstream } from '../../worker/twin/seams';
import type { OrderState } from '../../shared/motion/track';
import { corridorIndex } from './engine-fixture';
import { frame, type FrameVehicle } from './frames';
import { corridorSpec, lonLatOf, syntheticNetwork } from '../motion/synthetic-network';

const testEnv = env as unknown as Env;

// F12: the ordering register (E3) is the one piece of twin memory that is
// written from evidence and then STANDS -- a relation survives bunching, a
// junction's micro-edges and ZET going quiet, so it had better survive the
// object being evicted too. A restore that lost it would look like nothing at
// all on the wire (the follower simply stops being `behind` anyone) and the
// two trams would have to earn the relation again from two fresh fixes, which
// is exactly the flapping the register replaced. These two go through the
// real alarm path (`alarm()` -> `tick()` -> `restore()`), not through
// `deserializeState` alone, because the register is restored in one place and
// re-enforced in another.
const NET = syntheticNetwork(corridorSpec());
const INDEX = corridorIndex(NET, [
  { tripId: 't1a', pathId: '1_0' },
  { tripId: 't1b', pathId: '1_0' },
]);
const T0 = Math.floor(Date.now() / 1000) + 86_400;

let twinSeq = 0;
const freshTwin = () => twinStub(testEnv, `twin-order-${++twinSeq}`);

/** A tram on the trunk at metre `x`, reported `at`. */
function tram(vehicleId: string, tripId: string, x: number, at: number): FrameVehicle {
  const { lon, lat } = lonLatOf({ x, y: 0 });
  return { vehicleId, tripId, routeId: '1', lon, lat, at };
}

/** Bunched on the trunk: 'a' all but standing at T1200, 'b' rolling up
 *  behind it, the pair always more than ORDER_ESTABLISH_M apart and always
 *  the same way round -- two consecutive fresh fixes, which is what the
 *  register asks for before it writes anything (test/motion/order.test.ts). */
const FRAMES = [
  frame(T0, [tram('a', 't1a', 1200, T0 - 2), tram('b', 't1b', 1000, T0 - 2)]),
  frame(T0 + 10, [tram('a', 't1a', 1210, T0 + 8), tram('b', 't1b', 1060, T0 + 8)]),
  frame(T0 + 20, [tram('a', 't1a', 1220, T0 + 18), tram('b', 't1b', 1120, T0 + 18)]),
];

/** The three frames, then 304s: after the eviction ZET says "nothing new",
 *  so the restored tick has no fresh fix for either tram and every relation
 *  it acts on can only have come off the state row. */
function upstreamThen304(): TwinUpstream {
  let i = 0;
  return async () => {
    const index = i++;
    const bytes = FRAMES[index];
    if (!bytes) return new Response(null, { status: 304 });
    return new Response(bytes, { status: 200, headers: { etag: `W/"frame-${index}"` } });
  };
}

async function pinClock(stub: DurableObjectStub<TwinDO>, ms: number): Promise<void> {
  await runInDurableObject(stub, (instance: TwinDO) => {
    vi.spyOn(instance, 'now').mockReturnValue(ms);
  });
}

const behindOf = (payload: { items: { id: string; data?: Record<string, unknown> }[] }, id: string): unknown =>
  payload.items.find((item) => item.id === `vehicle:${id}`)?.data?.behind;

/** The register as the newest state row carries it: what an eviction would
 *  hand the next life of the object. */
const storedOrder = (stub: DurableObjectStub<TwinDO>) =>
  runInDurableObject(stub, (_i: TwinDO, state) => {
    const row = state.storage.sql.exec<{ body: string }>('SELECT body FROM state ORDER BY tick_at DESC LIMIT 1').one();
    const parsed = JSON.parse(row.body) as { tracks: Record<string, { order: OrderState }> };
    return Object.fromEntries(Object.entries(parsed.tracks).map(([id, track]) => [id, track.order]));
  });

/** Rewrites the newest state row the way a life before F10 left it: the
 *  pairwise law's `behind` array and its per-partner contradiction counts,
 *  where the register wants a single leader. */
const seedPreF10Row = (stub: DurableObjectStub<TwinDO>) =>
  runInDurableObject(stub, (_i: TwinDO, state) => {
    const row = state.storage.sql.exec<{ tick_at: number; body: string }>('SELECT tick_at, body FROM state ORDER BY tick_at DESC LIMIT 1').one();
    const body = JSON.parse(row.body) as { tracks: Record<string, { order: unknown }> };
    body.tracks.a.order = { behind: [], contradictions: {} };
    body.tracks.b.order = { behind: ['a'], contradictions: { a: 2 } };
    state.storage.sql.exec('UPDATE state SET body = ? WHERE tick_at = ?', JSON.stringify(body), row.tick_at);
  });

/** twin_order rows for today, by the register's own event vocabulary. */
async function orderCounts(): Promise<Record<string, number>> {
  const rows = (await metricsStub(testEnv).query(zagrebDayHour(new Date()).day)).filter((r) => r.event === 'twin_order');
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.dim1] = (counts[row.dim1] ?? 0) + row.count;
  return counts;
}

beforeEach(() => {
  setTwinIndexSourceForTest(async () => INDEX);
  setTwinNetworkSourceForTest(async () => NET);
  setTwinUpstreamForTest(upstreamThen304());
});

afterEach(() => {
  setTwinUpstreamForTest(null);
  setTwinIndexSourceForTest(null);
  setTwinNetworkSourceForTest(null);
});

/** The three live frames, leaving the register written and the plans held. */
async function driveUntilEstablished(stub: DurableObjectStub<TwinDO>): Promise<void> {
  await pinClock(stub, T0 * 1000 + 2_000);
  await stub.publish();
  for (let k = 1; k <= 2; k++) {
    await pinClock(stub, (T0 + 10 * k) * 1000 + 2_000);
    expect(await stub.tick()).toMatchObject({ outcome: 'ok', headerTs: T0 + 10 * k });
  }
}

describe('TwinDO keeps the ordering register across an eviction', () => {
  it('restores the relation from the state row and still enforces it on a tick with no fresh fix', async () => {
    const stub = freshTwin();
    await driveUntilEstablished(stub);
    // Established from fixes, and on the wire: the client draws 'b' behind 'a',
    // and the leader is behind nobody.
    const live = await stub.publish();
    expect(behindOf(live, 'b')).toBe('a');
    expect(behindOf(live, 'a')).toBeUndefined();
    const written = await storedOrder(stub);
    expect(written.b).toMatchObject({ leader: 'a', contradictions: 0 });
    expect(written.b.since).toBeGreaterThan(0);
    const before = await orderCounts();

    // The eviction: memory gone, storage kept, the alarm still armed. The
    // next alarm is the object's first act in its new life, and ZET answers
    // it with a 304 -- so nothing the register does now comes from a fix.
    await runInDurableObject(stub, (instance: TwinDO) => instance.forgetForTest());
    await pinClock(stub, (T0 + 30) * 1000 + 2_000);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const report = await runInDurableObject(stub, (instance: TwinDO) => instance.lastReportForTest());
    expect(report).toMatchObject({ outcome: 'unchanged', cold: true, newFixes: 0, vehicles: 2 });
    // (a) the relation came off the row, (b) it is still on the wire.
    expect(report?.order?.relations).toBe(1);
    expect((await storedOrder(stub)).b).toMatchObject({ leader: 'a' });
    expect(behindOf(await stub.publish(), 'b')).toBe('a');
    // (c) and it did something: the restored tick re-plans both trams from
    // scratch before it enforces, so the follower's rebuilt plan is clamped
    // behind its leader again and the tick's twin_order batch says so.
    const after = await orderCounts();
    expect(after.hold ?? 0).toBeGreaterThan(before.hold ?? 0);
    expect(Object.keys(after).every((dim1) => ['established', 'dropped', 'hold', 'push', 'concession', 'swap'].includes(dim1))).toBe(true);
  });

  it('starts the register clean on a row written before F10, without throwing the row away', async () => {
    const stub = freshTwin();
    await driveUntilEstablished(stub);
    await seedPreF10Row(stub);

    await runInDurableObject(stub, (instance: TwinDO) => instance.forgetForTest());
    await pinClock(stub, (T0 + 30) * 1000 + 2_000);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    // The row is read, not discarded -- both trams are still followed -- and
    // the pairwise law's shape is gone: no leader anywhere, nothing on the
    // wire, and the pair back at one witness, one short of the two the
    // register asks for before it writes a relation at all.
    const report = await runInDurableObject(stub, (instance: TwinDO) => instance.lastReportForTest());
    expect(report).toMatchObject({ outcome: 'unchanged', cold: true, vehicles: 2 });
    expect(report?.order?.relations).toBe(0);
    const cleaned = await storedOrder(stub);
    expect(cleaned.b).toEqual({ leader: null, since: 0, contradictions: 0, countedAt: 0, witnesses: {} });
    expect(cleaned.a).toMatchObject({ leader: null, since: 0, contradictions: 0, countedAt: 0 });
    expect(cleaned.a.witnesses.b).toMatchObject({ n: 1, lead: 'a' });
    expect(behindOf(await stub.publish(), 'b')).toBeUndefined();
  });
});
