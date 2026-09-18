import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import { TwinDO, twinStub } from '../../worker/do/twin-do';
import { setTwinIndexSourceForTest, setTwinNetworkSourceForTest, setTwinUpstreamForTest } from '../../worker/twin/seams';
import { corridorIndex } from './engine-fixture';
import { frame, type FrameVehicle } from './frames';
import { corridorSpec, lonLatOf, syntheticNetwork } from '../motion/synthetic-network';

const testEnv = env as unknown as Env;

// F8c: the edge indices of the rail graph move whenever the builder nodes a
// crossing, so a histogram learned for "edge 137" under the old graph is
// about a different piece of track under the new one. The artefact names its
// graph (`graphHash`); the twin records the name it learned under and drops
// every edge-keyed row when it changes. `stop_dwell` is keyed by stop id,
// which no rebuild renumbers, so it survives.
const NET = syntheticNetwork(corridorSpec());
const OTHER_GRAPH = { ...NET, graphHash: 'ffffffffffffffff' };
const INDEX = corridorIndex(NET, [{ tripId: 't1a', pathId: '1_0' }]);
const T0 = Math.floor(Date.now() / 1000) + 86_400;

let twinSeq = 0;
const freshTwin = () => twinStub(testEnv, `twin-graph-${++twinSeq}`);

function tram(x: number, at: number): FrameVehicle {
  const { lon, lat } = lonLatOf({ x, y: 0 });
  return { vehicleId: 'v1', tripId: 't1a', routeId: '1', lon, lat, at };
}

/** Rows in each learned table, and the graph the twin says it learned under. */
const learnedRows = (stub: DurableObjectStub<TwinDO>) =>
  runInDurableObject(stub, (_i: TwinDO, state) => ({
    edges: state.storage.sql.exec<{ c: number }>('SELECT count(*) AS c FROM edge_time').one().c,
    stops: state.storage.sql.exec<{ c: number }>('SELECT count(*) AS c FROM stop_dwell').one().c,
    graph: state.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'graph_hash'").toArray()[0]?.value ?? null,
  }));

/** One histogram in each table, as a flush would have left them. */
const seedLearned = (stub: DurableObjectStub<TwinDO>) =>
  runInDurableObject(stub, (_i: TwinDO, state) => {
    state.storage.sql.exec('INSERT OR REPLACE INTO edge_time (edge, band, daytype, hist, n) VALUES (?, ?, ?, ?, ?)', 0, 3, 0, '60:4', 4);
    state.storage.sql.exec('INSERT OR REPLACE INTO edge_time (edge, band, daytype, hist, n) VALUES (?, ?, ?, ?, ?)', 1, 3, 0, '90:2', 2);
    state.storage.sql.exec('INSERT OR REPLACE INTO stop_dwell (stop, band, daytype, hist, n) VALUES (?, ?, ?, ?, ?)', 'A', 3, 0, '20:5', 5);
  });

afterEach(() => {
  setTwinUpstreamForTest(null);
  setTwinIndexSourceForTest(null);
  setTwinNetworkSourceForTest(null);
});

describe('TwinDO on a rebuilt rail graph', () => {
  let network = NET;

  beforeEach(() => {
    network = NET;
    setTwinIndexSourceForTest(async () => INDEX);
    setTwinNetworkSourceForTest(async () => network);
    setTwinUpstreamForTest(async () => new Response(frame(T0, [tram(100, T0)], []), { status: 200, headers: { etag: 'W/"g1"' } }));
  });

  it('drops the edge-keyed rows when the graph hash changes and keeps them when it does not, keeping the stop dwells either way', async () => {
    const stub = freshTwin();
    await stub.publish();
    expect((await learnedRows(stub)).graph).toBe(NET.graphHash); // learned under the graph it loaded
    await seedLearned(stub);
    expect(await learnedRows(stub)).toEqual({ edges: 2, stops: 1, graph: NET.graphHash });

    // The same artefact after an eviction: nothing is thrown away.
    await runInDurableObject(stub, (instance: TwinDO) => instance.forgetForTest());
    await stub.publish();
    expect(await learnedRows(stub)).toEqual({ edges: 2, stops: 1, graph: NET.graphHash });

    // A rebuilt graph: the edge histograms go, the stop dwells stay.
    network = OTHER_GRAPH;
    await runInDurableObject(stub, (instance: TwinDO) => instance.forgetForTest());
    await stub.publish();
    expect(await learnedRows(stub)).toEqual({ edges: 0, stops: 1, graph: 'ffffffffffffffff' });
    // And what the twin plans on no longer carries the dropped edge times.
    const learned = await runInDurableObject(stub, (instance: TwinDO) => instance.learnedForTest());
    expect(learned.edgeKeys).toBe(0);
    expect(learned.stopKeys).toBe(1);
  });
});
