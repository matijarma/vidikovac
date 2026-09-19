import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../worker/env';
import { TwinDO, twinStub } from '../../worker/do/twin-do';
import { learnedGraphHash } from '../../worker/twin/persist';
import { setTwinIndexSourceForTest, setTwinNetworkSourceForTest, setTwinUpstreamForTest } from '../../worker/twin/seams';
import { binOf, edgeKey, emptyHistogram, stopKey } from '../../shared/motion/learn';
import { nodeKey } from '../../shared/motion/junction';
import { LEARN_FLUSH_MS } from '../../worker/twin/persist';
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
    graph: learnedGraphHash(state.storage.sql),
  }));

/** One histogram in each table, as a flush would have left them. */
const seedLearned = (stub: DurableObjectStub<TwinDO>) =>
  runInDurableObject(stub, (_i: TwinDO, state) => {
    state.storage.sql.exec('INSERT OR REPLACE INTO edge_time (edge, band, daytype, hist, n) VALUES (?, ?, ?, ?, ?)', 0, 3, 0, '60:4', 4);
    state.storage.sql.exec('INSERT OR REPLACE INTO edge_time (edge, band, daytype, hist, n) VALUES (?, ?, ?, ?, ?)', 1, 3, 0, '90:2', 2);
    state.storage.sql.exec('INSERT OR REPLACE INTO stop_dwell (stop, band, daytype, hist, n) VALUES (?, ?, ?, ?, ?)', 'A', 3, 0, '20:5', 5);
  });

/** A minute of evidence the last life had not flushed yet, as the state row
 *  carries it: one edge histogram (which belongs to the graph that life ran)
 *  and one stop dwell (which belongs to no graph at all). */
const seedUnflushedMinute = (stub: DurableObjectStub<TwinDO>) =>
  runInDurableObject(stub, (_i: TwinDO, state) => {
    const row = state.storage.sql.exec<{ tick_at: number; body: string }>('SELECT tick_at, body FROM state ORDER BY tick_at DESC LIMIT 1').one();
    const body = JSON.parse(row.body) as { pendingLearned: Record<string, unknown> };
    const hist = emptyHistogram();
    hist[binOf(75)] = 3;
    body.pendingLearned = {
      edges: { [edgeKey(0, 3, 0)]: hist },
      stops: { [stopKey('B', 3, 0)]: hist },
      nodes: { [nodeKey(1, 3, 0)]: hist },
      nodePasses: { [nodeKey(1, 3, 0)]: 5 },
    };
    state.storage.sql.exec('UPDATE state SET body = ? WHERE tick_at = ?', JSON.stringify(body), row.tick_at);
  });

/** The hindsight rings the last life published, as the state row carries
 *  them: several plans for the tram in view and one for a vehicle the twin
 *  no longer follows. Every one of them indexes the OLD artefact's paths. */
const seedPublished = (stub: DurableObjectStub<TwinDO>) =>
  runInDurableObject(stub, (_i: TwinDO, state) => {
    const row = state.storage.sql.exec<{ tick_at: number; body: string }>('SELECT tick_at, body FROM state ORDER BY tick_at DESC LIMIT 1').one();
    const body = JSON.parse(row.body) as { published: Record<string, unknown[]> };
    const plan = (headerSec: number) => ({ headerSec, plan: { on: 'path', pathIdx: 0, anchorSec: headerSec, knots: [[0, 100], [30, 400]] } });
    body.published = { v1: [plan(T0 - 30), plan(T0 - 20), plan(T0 - 10), plan(T0)], ghost: [plan(T0 - 10)] };
    state.storage.sql.exec('UPDATE state SET body = ? WHERE tick_at = ?', JSON.stringify(body), row.tick_at);
  });

/** How many plans the state row holds per vehicle. */
const publishedRings = (stub: DurableObjectStub<TwinDO>) =>
  runInDurableObject(stub, (_i: TwinDO, state) => {
    const row = state.storage.sql.exec<{ body: string }>('SELECT body FROM state ORDER BY tick_at DESC LIMIT 1').one();
    const body = JSON.parse(row.body) as { published: Record<string, unknown[]> };
    return Object.fromEntries(Object.entries(body.published).map(([id, ring]) => [id, ring.length]));
  });

/** Rows in the junction table, which a rebuilt graph renumbers exactly as it renumbers the edges. */
const nodeRows = (stub: DurableObjectStub<TwinDO>) =>
  runInDurableObject(stub, (_i: TwinDO, state) => state.storage.sql.exec<{ c: number }>('SELECT count(*) AS c FROM node_wait').one().c);

/** The twin's own clock, so a flush can be made due without waiting a minute. */
const pinClock = (stub: DurableObjectStub<TwinDO>, ms: number) =>
  runInDurableObject(stub, (instance: TwinDO) => {
    vi.spyOn(instance, 'now').mockReturnValue(ms);
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
    await seedUnflushedMinute(stub);
    await runInDurableObject(stub, (instance: TwinDO) => instance.forgetForTest());
    await stub.publish();
    expect(await learnedRows(stub)).toEqual({ edges: 0, stops: 1, graph: 'ffffffffffffffff' });
    // And what the twin plans on no longer carries the dropped edge times --
    // not from the tables, and not from the minute the state row still held,
    // whose edge keys named edges of the graph before the rebuild. Its stop
    // dwell does carry over, alongside the one the table kept.
    const learned = await runInDurableObject(stub, (instance: TwinDO) => instance.learnedForTest());
    expect(learned.edgeKeys).toBe(0);
    expect(learned.stopKeys).toBe(2);
  });

  // The review's I1. `restore()` scrubbed the edge keys out of the live
  // aggregates but handed `saved` -- pendingLearned whole -- to `advance()`,
  // which copies it into the next state row; the first flush after that cold
  // start then wrote the PREVIOUS graph's minute straight back into the
  // tables `adoptGraph` had just emptied. The minute has to be dropped where
  // the rows were, and the hindsight rings with it: they hold plans indexed
  // by the old artefact's path indices, which name other rails now.
  it('never re-flushes the previous graph unflushed minute into the tables it just emptied, and drops the published rings', async () => {
    const stub = freshTwin();
    await pinClock(stub, (T0 + 2) * 1000);
    await stub.publish();
    await seedLearned(stub);
    await runInDurableObject(stub, (_i: TwinDO, state) => {
      state.storage.sql.exec('INSERT OR REPLACE INTO node_wait (node, band, daytype, hist, n, passes) VALUES (?, ?, ?, ?, ?, ?)', 1, 3, 0, JSON.stringify(emptyHistogram()), 0, 9);
    });
    await seedUnflushedMinute(stub);
    await seedPublished(stub);
    expect(await publishedRings(stub)).toEqual({ v1: 4, ghost: 1 });
    expect(await nodeRows(stub)).toBe(1);

    // A rebuilt graph, a cold start, and the clock a second past the flush
    // cadence: the restore's own advance() is the tick a flush is due on.
    network = OTHER_GRAPH;
    await runInDurableObject(stub, (instance: TwinDO) => instance.forgetForTest());
    await pinClock(stub, (T0 + 2) * 1000 + LEARN_FLUSH_MS + 1000);
    await stub.publish();
    expect(await runInDurableObject(stub, (instance: TwinDO) => instance.lastReportForTest())).toBeNull(); // restore(), not tick()

    // The edge and node tables adoptGraph emptied stay empty; the stop dwells
    // -- keyed by a platform id no rebuild renumbers -- keep the table's row
    // and gain the one the unflushed minute carried.
    const rows = await learnedRows(stub);
    expect(rows.edges).toBe(0);
    expect(await nodeRows(stub)).toBe(0);
    expect(rows.stops).toBe(2);
    expect(rows.graph).toBe('ffffffffffffffff');
    expect(await runInDurableObject(stub, (instance: TwinDO) => instance.junctionCellsForTest())).toEqual({ nodes: 0, passes: 0 });

    // And the rings: what comes out of the restore is only what this life
    // published, one plan for the tram in view and nothing for the ghost.
    expect(await publishedRings(stub)).toEqual({ v1: 1 });
  });
});
