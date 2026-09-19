import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import { TwinDO, twinStub } from '../../worker/do/twin-do';
import { setTwinIndexSourceForTest, setTwinNetworkSourceForTest, setTwinOverridesSourceForTest, setTwinUpstreamForTest } from '../../worker/twin/seams';
import { parseDwellOverrides } from '../../shared/motion/dwell';
import { fetchDwellOverrides } from '../../worker/twin/index-load';
import { corridorIndex } from './engine-fixture';
import { frame, type FrameVehicle } from './frames';
import { corridorSpec, lonLatOf, syntheticNetwork } from '../motion/synthetic-network';

const testEnv = env as unknown as Env;

// F11: two new things the twin must remember across an eviction -- the
// rolling window of measured dwells (`stop_dwell_recent`) and the junction
// cells (`node_wait`) -- and one it must throw away, because a rebuilt rail
// graph renumbers the nodes exactly as it renumbers the edges.
const NET = syntheticNetwork(corridorSpec());
const OTHER_GRAPH = { ...NET, graphHash: 'ffffffffffffffff' };
const INDEX = corridorIndex(NET, [{ tripId: 't1a', pathId: '1_0' }]);
const T0 = Math.floor(Date.now() / 1000) + 86_400;

let twinSeq = 0;
const freshTwin = () => twinStub(testEnv, `twin-dwell-${++twinSeq}`);

function tram(x: number, at: number): FrameVehicle {
  const { lon, lat } = lonLatOf({ x, y: 0 });
  return { vehicleId: 'v1', tripId: 't1a', routeId: '1', lon, lat, at };
}

/** Rows in the two F11 tables. */
const f11Rows = (stub: DurableObjectStub<TwinDO>) =>
  runInDurableObject(stub, (_i: TwinDO, state) => ({
    nodes: state.storage.sql.exec<{ c: number }>('SELECT count(*) AS c FROM node_wait').one().c,
    recent: state.storage.sql.exec<{ c: number }>('SELECT count(*) AS c FROM stop_dwell_recent').one().c,
  }));

/** The tables as a flush would have left them: a junction cell with four
 *  waits in ten passes, and six dwell samples inside the window. */
const seedF11 = (stub: DurableObjectStub<TwinDO>, nowSec: number) =>
  runInDurableObject(stub, (_i: TwinDO, state) => {
    const hist = new Array<number>(32).fill(0);
    hist[20] = 4;
    state.storage.sql.exec('INSERT OR REPLACE INTO node_wait (node, band, daytype, hist, n, passes) VALUES (?, ?, ?, ?, ?, ?)', 1, 3, 0, JSON.stringify(hist), 4, 10);
    for (let i = 0; i < 6; i++) {
      state.storage.sql.exec('INSERT OR REPLACE INTO stop_dwell_recent (stop, at, seconds) VALUES (?, ?, ?)', 'T600', nowSec - 60 * (i + 1), 18 + i);
    }
    // A sample far outside the 90 minute window: it must not come back.
    state.storage.sql.exec('INSERT OR REPLACE INTO stop_dwell_recent (stop, at, seconds) VALUES (?, ?, ?)', 'T600', nowSec - 40_000, 300);
  });

afterEach(() => {
  setTwinUpstreamForTest(null);
  setTwinIndexSourceForTest(null);
  setTwinNetworkSourceForTest(null);
  setTwinOverridesSourceForTest(null);
});

describe('TwinDO keeps the F11 tables across an eviction', () => {
  let network = NET;

  beforeEach(() => {
    network = NET;
    setTwinIndexSourceForTest(async () => INDEX);
    setTwinNetworkSourceForTest(async () => network);
    setTwinOverridesSourceForTest(async () => ({ overrides: parseDwellOverrides([{ stop: 'T600', defaultSec: 45, reason: 'test: an owner number' }]), error: null }));
    setTwinUpstreamForTest(async () => new Response(frame(T0, [tram(100, T0)], []), { status: 200, headers: { etag: 'W/"g1"' } }));
  });

  it('restores the recent dwell window inside its own window, loads the junction cells, reads the overrides, and drops the junction cells on a rebuilt graph', async () => {
    const stub = freshTwin();
    await stub.publish();
    const nowSec = await runInDurableObject(stub, (instance: TwinDO) => Math.floor(instance.now() / 1000));
    await seedF11(stub, nowSec);
    expect(await f11Rows(stub)).toEqual({ nodes: 1, recent: 7 });

    // An eviction: memory gone, storage kept. Both tables come back, and the
    // sample outside the window does not.
    await runInDurableObject(stub, (instance: TwinDO) => instance.forgetForTest());
    await stub.publish();
    const recent = await runInDurableObject(stub, (instance: TwinDO) => instance.dwellRecentForTest());
    expect(recent['T600']).toHaveLength(6);
    expect(recent['T600'].every(([, seconds]) => seconds < 30)).toBe(true);
    expect(await runInDurableObject(stub, (instance: TwinDO) => instance.junctionCellsForTest())).toEqual({ nodes: 1, passes: 1 });
    // The owner's file reached the engine: one entry, and the table shows it.
    expect((await stub.tables(nowSec)).overrides).toBe(1);

    // A rebuilt rail graph renumbers the nodes as it renumbers the edges, so
    // a wait learned for "node 1" is about a different crossing: it goes.
    network = OTHER_GRAPH;
    await runInDurableObject(stub, (instance: TwinDO) => instance.forgetForTest());
    await stub.publish();
    expect((await f11Rows(stub)).nodes).toBe(0);
    expect((await f11Rows(stub)).recent).toBeGreaterThan(0); // keyed by stop id: no rebuild renumbers those
    expect(await runInDurableObject(stub, (instance: TwinDO) => instance.junctionCellsForTest())).toEqual({ nodes: 0, passes: 0 });
  });

  // The review's I3. A file the owner has just broken used to be logged and
  // then be indistinguishable from "no overrides written": every hand-made
  // default silently out of the planner. The twin keeps planning -- the
  // layer is optional, and a broken file may never take the twin down -- but
  // it carries the parser's own complaint to /stats.
  it('keeps planning when the overrides file will not parse, and says why on the tables', async () => {
    // A real read of a real malformed file, through the real parser: only
    // the ASSETS binding under it is the test's.
    const assets = {
      fetch: async () =>
        new Response(JSON.stringify([{ stop: 'T600', defaultSec: 'pola minute', reason: 'test: a broken line' }]), {
          headers: { 'content-type': 'application/json' },
        }),
    };
    setTwinOverridesSourceForTest(() => fetchDwellOverrides({ ASSETS: assets } as unknown as Env));

    const stub = freshTwin();
    const payload = await stub.publish();
    const tables = await stub.tables();
    expect(tables.overrides).toBe(0);
    expect(tables.overridesError).toContain('defaultSec');
    // And the twin is still a twin: the tram in the frame is planned.
    expect(payload.items.some((item) => item.id.startsWith('vehicle:') && item.motion !== null)).toBe(true);
    expect((await runInDurableObject(stub, (instance: TwinDO) => instance.lastReportForTest()))?.networkLoaded ?? true).toBe(true);
  });

  it('reports no error for a file that simply is not there', async () => {
    setTwinOverridesSourceForTest(() => fetchDwellOverrides({ ASSETS: { fetch: async () => new Response('', { status: 404 }) } } as unknown as Env));
    const stub = freshTwin();
    await stub.publish();
    const tables = await stub.tables();
    expect(tables.overrides).toBe(0);
    expect(tables.overridesError).toBeNull();
  });
});
