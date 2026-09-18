import { describe, expect, it } from 'vitest';
import { toPlane } from '../../shared/motion/geo';
import { decodeNetwork } from '../../shared/motion/network';
import { rawArtefactV3 } from './network-fixture';
import { corridorSpec, syntheticNetwork } from './synthetic-network';

// The graph helpers B3 onward lean on (shared/motion/graph.ts), on the same
// hand-built artefact network.test.ts decodes: E0 east, E1 north, the tram
// shape S1 over both, a synthetic path over E1 alone.
describe('the graph helpers', () => {
  it('find the edges near a point nearest first, build and memoise a path geometry, list a path\'s stops in arc order, and round-trip an arc through a point', () => {
    const net = decodeNetwork(rawArtefactV3());

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

    // F8: stopsOnPath is the SERVED list where the artefact carries one --
    // C lies on E1 but S1's trips never call there, so the planner never sees
    // it; the geometric derivation still does, for the replay grader's row.
    expect(net.stopsOnPath(0).map((x) => [x.stop.id, x.s])).toEqual([['A', 4.7], ['B', 33.3]]);
    expect(net.stopsOnPathGeometric(0).map((x) => [x.stop.id, x.s])).toEqual([['A', 4.7], ['B', net.edges[0].len + 10], ['C', net.edges[0].len + 15]]);
    expect(net.stopsOnPath(1).map((x) => [x.stop.id, x.s])).toEqual([['B', 10], ['C', 15]]); // re-based to the synthetic path's own arc
    expect(net.nextStopOnPath(0, 4.7)?.stop.id).toBe('B');
    expect(net.nextStopOnPath(0, 33.3)).toBeNull(); // past the last stop S1 serves
    expect(net.nextStopOnPath(1, 12)?.stop.id).toBe('C');
    expect(net.nextStopOnPath(1, 15)).toBeNull();

    const s = net.edges[0].len + 5;
    const p = net.toPathPoint(0, s);
    expect(net.projectOntoPath(0, p).s).toBeCloseTo(s, 6);
    expect(net.projectOntoPath(0, p).d).toBeLessThan(1e-6);
    expect(net.projectOntoPath(0, { x: p.x + 7, y: p.y }).d).toBeCloseTo(7, 6);
  });

  // F8: the served list is what the engine reads on a corridor where the
  // trunk carries three sets of platforms -- route 1's own, the westbound
  // platform of the same place and the platform only route 2 calls at.
  it("keeps the opposite-direction platform and another line's platform off a path's served list, and both on its geometric one", () => {
    const net = syntheticNetwork(corridorSpec());
    const path = net.paths.findIndex((p) => p.id === '1_0');
    const served = net.stopsOnPath(path).map((x) => x.stop.id);
    const geometric = net.stopsOnPathGeometric(path).map((x) => x.stop.id);

    expect(served).toEqual(['T0', 'T300', 'T600', 'T900', 'T1200', 'C300', 'C600', 'C900', 'C1200']);
    expect(geometric).toContain('W750'); // the westbound platform, 40 m across the trunk
    expect(geometric).toContain('X750'); // route 2's own platform on the shared rails
    expect(served).not.toContain('W750');
    expect(served).not.toContain('X750');
    expect(geometric.length).toBe(served.length + 2);
    // Both phantoms sit between T600 and T900, so the stop the planner aims
    // at after 600 m is the one route 1 actually calls at.
    expect(net.nextStopOnPath(path, 601)?.stop.id).toBe('T900');
    // Route 2 does call at X750, and its own served list says so.
    expect(net.stopsOnPath(net.paths.findIndex((p) => p.id === '2_0')).map((x) => x.stop.id)).toContain('X750');
  });
});
