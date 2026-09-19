import { describe, expect, it } from 'vitest';
import { edgeAt, mapArc, onSharedRails, sharedStretch } from '../../shared/motion/order';
import { corridorSpec, syntheticNetwork } from './synthetic-network';

// The geometry the ordering register and the client's clamp share (E3): the
// corridor's trunk (edge 0, 0 to 1500 m) is run by route 1 east (path 1_0,
// edges 0 and 1), route 2 north (path 2_0, edges 0 and 2) and the shapeless
// pattern of route 9 (edges 0 and 1); edge 5 is the opposite track, which
// path 1_1 runs alone.
describe('order.ts over the corridor', () => {
  const net = syntheticNetwork(corridorSpec());
  const path = (id: string) => net.paths[net.paths.findIndex((p) => p.id === id)];
  const east = path('1_0');
  const north = path('2_0');
  const shapeless = path('path:9:0:abc');
  const back = path('1_1');

  it('reads the edge under an arc and maps an arc into another path frame', () => {
    expect(edgeAt(east, 700)).toEqual({ edge: 0, arc: 700 });
    expect(edgeAt(east, 1500)).toEqual({ edge: 1, arc: 0 });
    expect(edgeAt(east, 2000)).toEqual({ edge: 1, arc: 500 });
    // On the trunk the two routes share the edge, so the arc is the same
    // number; past the junction route 2 does not run route 1's edge at all.
    expect(mapArc(east, 700, north)).toBe(700);
    expect(mapArc(north, 700, east)).toBe(700);
    expect(mapArc(east, 2000, north)).toBeNull();
    expect(mapArc(east, 700, back)).toBeNull();
  });

  it('pairs two vehicles when either one is on rails the other runs', () => {
    // Both on the trunk, and one past the junction while the other is still
    // on the trunk the first one's path also runs: still the same rails.
    expect(onSharedRails({ path: east, s: 700 }, { path: north, s: 200 })).toBe(true);
    expect(onSharedRails({ path: east, s: 2000 }, { path: north, s: 200 })).toBe(true);
    // Past the junction on both: route 1 runs east, route 2 north.
    expect(onSharedRails({ path: east, s: 2000 }, { path: north, s: 1800 })).toBe(false);
    // The opposite track is never the same rails as the trunk.
    expect(onSharedRails({ path: east, s: 700 }, { path: back, s: 700 })).toBe(false);
  });

  it('gives the run of edges both paths keep running from where the first one stands', () => {
    // Route 1 and route 2 share the trunk and part at the junction.
    expect(sharedStretch({ path: east, s: 700 }, { path: north, s: 200 })).toEqual({ edges: [0] });
    // Route 1 and the shapeless pattern of route 9 run the same two edges.
    expect(sharedStretch({ path: east, s: 700 }, { path: shapeless, s: 100 })).toEqual({ edges: [0, 1] });
    expect(sharedStretch({ path: east, s: 1600 }, { path: shapeless, s: 100 })).toEqual({ edges: [1] });
    // Nothing in common where the first one stands, whatever they share behind it.
    expect(sharedStretch({ path: east, s: 2000 }, { path: north, s: 200 })).toBeNull();
    expect(sharedStretch({ path: east, s: 700 }, { path: back, s: 700 })).toBeNull();
  });
});
