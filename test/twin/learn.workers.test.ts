import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../worker/env';
import { TwinDO, twinStub } from '../../worker/do/twin-do';
import { LEARN_FLUSH_MS } from '../../worker/twin/persist';
import { setTwinIndexSourceForTest, setTwinNetworkSourceForTest, setTwinUpstreamForTest } from '../../worker/twin/seams';
import { evalPathPlan } from '../../shared/motion/plan';
import type { PathMotion } from '../../shared/motion/wire';
import { corridorIndex } from './engine-fixture';
import { frame, type FrameTrip, type FrameVehicle } from './frames';
import { simulate, type SimFrame, type Simulation } from '../motion/simulator';
import { corridorSpec, syntheticNetwork } from '../motion/synthetic-network';

const testEnv = env as unknown as Env;

// C1 in the Durable Object: evidence accumulates tick by tick, reaches
// SQLite in one transaction a minute (never one row per event), survives an
// eviction (a restore rebuilds the learned provider from the tables), and
// the plans published after that run on the learned times, not the
// timetable the twin was handed.
const NET = syntheticNetwork(corridorSpec());

// A day ahead of the real clock: the alarms the twin arms around T0 are then
// always in the future, so miniflare never fires one on its own mid-test.
const T0 = Math.floor(Date.now() / 1000) + 86_400;

let twinSeq = 0;
function freshTwin(): DurableObjectStub<TwinDO> {
  return twinStub(testEnv, `twin-learn-${++twinSeq}`);
}

async function pinClock(stub: DurableObjectStub<TwinDO>, ms: number): Promise<void> {
  await runInDurableObject(stub, (instance: TwinDO) => {
    vi.spyOn(instance, 'now').mockReturnValue(ms);
  });
}

/** The simulator's frames as ZET's protobuf, for the twin's upstream. */
function bytesOf(sim: Simulation, simFrame: SimFrame): Uint8Array {
  const routeOf = new Map(sim.trams.map((t) => [t.tripId, t.routeId]));
  const vehicles: FrameVehicle[] = simFrame.fixes.map((f) => ({ vehicleId: f.id, tripId: f.tripId, routeId: f.routeId, lat: f.lat, lon: f.lon, at: f.atSec }));
  const trips: FrameTrip[] = simFrame.updates.map((u) => ({ tripId: u.tripId, routeId: routeOf.get(u.tripId)!, stops: [{ seq: 1, stopId: u.stopId, time: u.timeSec, delay: 0 }] }));
  return frame(simFrame.headerSec, vehicles, trips);
}

afterEach(() => {
  setTwinUpstreamForTest(null);
  setTwinIndexSourceForTest(null);
  setTwinNetworkSourceForTest(null);
});

describe('TwinDO learning', () => {
  // Twenty trams half a minute apart at 10 m/s for ten minutes: the first
  // clear the 1500 m trunk long before the end, so its edge gathers the
  // samples the wrapper needs before it speaks, and the last are still on
  // it when the run ends, to be planned on what was learned. The timetable
  // says 5 m/s.
  const sim = simulate(NET, ['1_0'], {
    trams: 20,
    headwaySec: 30,
    cruiseMs: 10,
    dwellSec: 20,
    noiseM: 8,
    refreshP: 2 / 3,
    latencyMinSec: 2,
    latencyMaxSec: 10,
    tickSec: 10,
    durationSec: 600,
    seed: 3,
    startSec: T0,
  });
  const INDEX = corridorIndex(NET, sim.trams.map((t) => ({ tripId: t.tripId, pathId: t.shapeId })));
  for (const pattern of INDEX.patterns) pattern.sched = pattern.sched.map((row) => row.map((s) => s * 2));

  beforeEach(() => {
    setTwinIndexSourceForTest(async () => INDEX);
    setTwinNetworkSourceForTest(async () => NET);
  });

  it('accumulates evidence, flushes once a minute, keeps what it learned across an eviction, and plans on it', async () => {
    let i = 0;
    setTwinUpstreamForTest(async () => new Response(bytesOf(sim, sim.frames[Math.min(i++, sim.frames.length - 1)]), { status: 200, headers: { etag: `W/"f${i}"` } }));
    const stub = freshTwin();
    let flushes = 0;
    let learnedEdges = 0;
    for (const simFrame of sim.frames) {
      await pinClock(stub, (simFrame.headerSec + 2) * 1000);
      const report = simFrame.headerSec === T0 ? (await stub.publish(), await runInDurableObject(stub, (instance: TwinDO) => instance.lastReportForTest()))! : await stub.tick();
      if (report.learnedFlushed) flushes++;
      learnedEdges += report.learned.edges;
    }
    expect(learnedEdges).toBeGreaterThan(20);
    // Six hundred seconds at one flush a minute, the first flush after the first full minute of evidence.
    const expectedFlushes = Math.floor((600 * 1000) / LEARN_FLUSH_MS);
    expect(flushes).toBeGreaterThanOrEqual(expectedFlushes - 2);
    expect(flushes).toBeLessThanOrEqual(expectedFlushes + 1);
    const rows = await runInDurableObject(stub, (_i: TwinDO, state) => ({
      edges: state.storage.sql.exec<{ c: number }>('SELECT count(*) AS c FROM edge_time').one().c,
      stops: state.storage.sql.exec<{ c: number }>('SELECT count(*) AS c FROM stop_dwell').one().c,
    }));
    expect(rows.edges).toBeGreaterThan(0);
    expect(rows.stops).toBeGreaterThan(0);

    // An eviction: memory gone, the tables stay; the restored twin plans on the learned trunk.
    await runInDurableObject(stub, (instance: TwinDO) => instance.forgetForTest());
    const last = sim.frames[sim.frames.length - 1];
    await pinClock(stub, (last.headerSec + 4) * 1000);
    const payload = await stub.publish();
    const learned = await runInDurableObject(stub, (instance: TwinDO) => instance.learnedForTest());
    expect(learned.edgeKeys).toBeGreaterThanOrEqual(rows.edges); // the tables plus the minute the row carried
    expect(learned.edgeMedians[0]).toBeGreaterThan(150 * 0.8); // the 1500 m trunk at 10 m/s
    expect(learned.edgeMedians[0]).toBeLessThan(150 * 1.2);
    // A tram still on the trunk plans its moving stretches at the learned 10 m/s, not the timetable's
    // 5 m/s: the fastest knot-to-knot speed on the trunk (the first stretch aside, which reconciles the
    // fix) lies well above the timetable. The ordering law knots plans finely, so speeds, not stretches.
    let fastest = 0;
    for (const item of payload.items) {
      if (!item.id.startsWith('vehicle:') || !item.motion || !('path' in item.motion)) continue;
      const knots = (item.motion as PathMotion).plan;
      for (let k = 1; k + 1 < knots.length; k++) {
        const [t0, s0] = knots[k];
        const [t1, s1] = knots[k + 1];
        if (s1 >= 1500 || s1 - s0 < 50 || t1 - t0 <= 0) continue;
        fastest = Math.max(fastest, (s1 - s0) / (t1 - t0));
      }
    }
    expect(fastest).toBeGreaterThan(7.5);
    expect(evalPathPlan((payload.items.find((item) => item.motion && 'path' in item.motion)!.motion as PathMotion).plan as [number, number][], 0)).toBeGreaterThanOrEqual(0);
  }, 20_000);
});
