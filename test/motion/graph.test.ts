import { describe, expect, it } from 'vitest';
import { toPlane } from '../../shared/motion/geo';
import { decodeNetwork } from '../../shared/motion/network';
import { rawArtefactV2 } from './network-fixture';

// The graph helpers B3 onward lean on (shared/motion/graph.ts), on the same
// hand-built artefact network.test.ts decodes: E0 east, E1 north, the tram
// shape S1 over both, a synthetic path over E1 alone.
describe('the graph helpers', () => {
  it('find the edges near a point nearest first, build and memoise a path geometry, list a path\'s stops in arc order, and round-trip an arc through a point', () => {
    const net = decodeNetwork(rawArtefactV2());

    const onE0 = net.edgesNear(toPlane(16.00015, 45.8), 5);
    expect(onE0.map((h) => h.edge)).toEqual([0]);
    expect(onE0[0].d).toBeLessThan(0.01);
    expect(onE0[0].s).toBeCloseTo(net.edges[0].len / 2, 6);
    const nearCorner = net.edgesNear(toPlane(16.00031, 45.80001), 10);
    expect(nearCorner.map((h) => h.edge).sort()).toEqual([0, 1]);
    expect(nearCorner[0].d).toBeLessThanOrEqual(nearCorner[1].d);
    expect(net.edgesNear(toPlane(16.01, 45.81), 50)).toEqual([]);

    const geo = net.pathGeometry(0);
    expect(geo.pts).toEqual(net.shapes[0].pts);
    expect(geo.cum[geo.cum.length - 1]).toBeCloseTo(net.paths[0].len, 9);
    expect(net.pathGeometry(0)).toBe(geo);
    expect(net.pathGeometry(1).pts).toEqual(net.edges[1].pts);

    expect(net.stopsOnPath(0).map((x) => [x.stop.id, x.s])).toEqual([['A', 4.7], ['B', net.edges[0].len + 10], ['C', net.edges[0].len + 15]]);
    expect(net.stopsOnPath(1).map((x) => [x.stop.id, x.s])).toEqual([['B', 10], ['C', 15]]); // re-based to the synthetic path's own arc
    expect(net.nextStopOnPath(0, 4.7)?.stop.id).toBe('B');
    expect(net.nextStopOnPath(1, 12)?.stop.id).toBe('C');
    expect(net.nextStopOnPath(1, 15)).toBeNull();

    const s = net.edges[0].len + 5;
    const p = net.toPathPoint(0, s);
    expect(net.projectOntoPath(0, p).s).toBeCloseTo(s, 6);
    expect(net.projectOntoPath(0, p).d).toBeLessThan(1e-6);
    expect(net.projectOntoPath(0, { x: p.x + 7, y: p.y }).d).toBeCloseTo(7, 6);
  });
});
