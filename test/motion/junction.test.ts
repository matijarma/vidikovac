import { describe, expect, it } from 'vitest';
import {
  createJunctionTable,
  JUNCTION_MIN_PASSES,
  JUNCTION_STOP_SHARE,
  JUNCTION_ZONE_M,
  junctionsOnPath,
  nodeKey,
} from '../../shared/motion/junction';
import { addSample, emptyAggregates, emptyHistogram, extractEvidence, recordEvidence } from '../../shared/motion/learn';
import { zagrebBands } from '../../shared/motion/times';
import { newTrack, type PlaneFix } from '../../shared/motion/track';
import { corridorSpec, syntheticNetwork } from './synthetic-network';

// F11 junction waits: a tram held at a signal short of a crossing stands off
// every platform, so the dwell table never hears about it and the planner
// used to drive straight through. The learner mines those stands per rail
// NODE of degree above two, counts every pass of the node beside them so
// p(stop) is a share and not a count, and the planner books the median wait
// only where the share is high enough to be a rule of that crossing.
describe('junction waits', () => {
  const net = syntheticNetwork(corridorSpec());
  const pathIdx = net.paths.findIndex((p) => p.id === '1_0');
  const start = 1_800_000_000;
  const { hourBand, dayType } = zagrebBands(start);

  it('finds only nodes where three ways meet, at their arc along the path', () => {
    // The corridor's node 1 (x = 1500) carries the trunk, the eastern branch
    // and the northern branch: three edge ends, the one junction of the map.
    expect(junctionsOnPath(net, pathIdx)).toEqual([{ node: 1, s: 1500 }]);
    // Path 1_1 is the single return edge between two nodes of degree two.
    expect(junctionsOnPath(net, net.paths.findIndex((p) => p.id === '1_1'))).toEqual([]);
  });

  it('counts a pass without a wait, a stand as a wait, and nothing from a tram standing at a platform', () => {
    const fixAt = (s: number, atSec: number, atStop: boolean): PlaneFix => ({ x: 0, y: 0, lon: 0, lat: 0, atSec, arc: { key: `p${pathIdx}`, s, atStop } });
    const tenMs = (_p: number, fromS: number, toS: number): number => (toS - fromS) / 10;

    // Straight through: a fix well before the zone, one inside it, one past
    // the node, all 100 m apart. One pass, no wait.
    const through = newTrack('through', '1', 't', 'tram');
    through.fixes = [fixAt(1300, 1000, false), fixAt(1450, 1015, false), fixAt(1600, 1030, false)];
    const passOnly = extractEvidence(net, through, Number.NEGATIVE_INFINITY, () => 20, tenMs);
    expect(passOnly.passes).toEqual([{ node: 1, atSec: 1030 }]);
    expect(passOnly.waits).toEqual([]);

    // Held at the signal: two fixes within the dead zone at 1460 m, inside
    // the 60 m zone before the node and 260 m clear of T1200's platform.
    const held = newTrack('held', '1', 't', 'tram');
    held.fixes = [fixAt(1300, 1000, false), fixAt(1460, 1016, false), fixAt(1462, 1026, false), fixAt(1600, 1060, false)];
    const waited = extractEvidence(net, held, Number.NEGATIVE_INFINITY, () => 20, tenMs);
    expect(waited.passes).toEqual([{ node: 1, atSec: 1060 }]);
    // 60 s from 1300 m to 1600 m, of which 30 s is travel at 10 m/s: 30 s stood.
    expect(waited.waits).toEqual([{ node: 1, seconds: expect.closeTo(30, 5), atSec: 1060 }]);

    // The same stand, but the matcher read those fixes at a platform: that is
    // the dwell table's business, not the junction's.
    const atPlatform = newTrack('platform', '1', 't', 'tram');
    atPlatform.fixes = [fixAt(1300, 1000, false), fixAt(1460, 1016, true), fixAt(1462, 1026, true), fixAt(1600, 1060, false)];
    const none = extractEvidence(net, atPlatform, Number.NEGATIVE_INFINITY, () => 20, tenMs);
    expect(none.passes).toEqual([{ node: 1, atSec: 1060 }]);
    expect(none.waits).toEqual([]);

    // Nothing is mined twice: everything older than `sinceSec` stays counted.
    expect(extractEvidence(net, held, 1060, () => 20, tenMs).passes).toEqual([]);
  });

  it('books the median wait only when trams stop there at least JUNCTION_STOP_SHARE of the time', () => {
    const aggregates = emptyAggregates();
    const key = nodeKey(1, hourBand, dayType);
    const waits = emptyHistogram();
    for (let i = 0; i < 4; i++) addSample(waits, 24);
    aggregates.nodes[key] = waits;
    aggregates.nodePasses[key] = 10; // four stands in ten passes: 0.4, exactly the bar

    const table = createJunctionTable({ net, aggregates });
    const ahead = table.waitsAhead(pathIdx, 1000, hourBand, dayType);
    expect(ahead).toHaveLength(1);
    expect(ahead[0].node).toBe(1);
    expect(ahead[0].s).toBe(1500);
    expect(ahead[0].waitSec).toBeGreaterThan(18);
    expect(ahead[0].waitSec).toBeLessThan(32);
    // Past the node there is nothing left to book on this path.
    expect(table.waitsAhead(pathIdx, 1600, hourBand, dayType)).toEqual([]);

    // One pass more and the share falls below the bar: nothing is booked.
    aggregates.nodePasses[key] = 11;
    expect(createJunctionTable({ net, aggregates }).waitsAhead(pathIdx, 1000, hourBand, dayType)).toEqual([]);
    expect(JUNCTION_STOP_SHARE).toBe(0.4);

    // Too few passes to know anything: the crossing stays silent.
    aggregates.nodePasses[key] = JUNCTION_MIN_PASSES - 1;
    expect(createJunctionTable({ net, aggregates }).waitsAhead(pathIdx, 1000, hourBand, dayType)).toEqual([]);
  });

  it('records mined evidence into the aggregates and reports it for /stats', () => {
    const aggregates = emptyAggregates();
    recordEvidence(
      aggregates,
      { edges: [], dwells: [], waits: [{ node: 1, seconds: 30, atSec: start }], passes: [{ node: 1, atSec: start }, { node: 1, atSec: start }] },
      zagrebBands,
    );
    expect(aggregates.nodePasses[nodeKey(1, hourBand, dayType)]).toBe(2);
    const rows = createJunctionTable({ net, aggregates, minPasses: 1 }).rows(hourBand, dayType);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ node: 1, passes: 2, waits: 1, share: 0.5 });
    expect(rows[0].p50).toBeGreaterThan(20);
    expect(JUNCTION_ZONE_M).toBe(60);
  });
});
