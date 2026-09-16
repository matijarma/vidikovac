import { describe, expect, it, vi } from 'vitest';
import { toPlane } from '../../shared/motion/geo';
import { cumulative } from '../../shared/motion/polyline';
import { decodeNetwork, loadNetwork, NetworkVersionError } from '../../shared/motion/network';
import * as shim from '../../app/src/motion/network';

import { B1_LONLAT, E0_LONLAT, E1_LONLAT, rawArtefactV2, unitLonLat } from './network-fixture';

const plane = (lonlat: [number, number][]) => lonlat.map(([lon, lat]) => toPlane(lon, lat));
const lenOf = (pts: { x: number; y: number }[]) => cumulative(pts)[pts.length - 1];

describe('decodeNetwork', () => {
  it('decodes version 2 into the superset the client reads: edges, tram shapes rebuilt from them, bus polylines, paths with offsets, stops at exact arcs on every shape through their edges, nextStop; rejects a version 1 artefact; loads only outside lightweight mode', async () => {
    const net = decodeNetwork(rawArtefactV2());
    expect(net.version).toBe(2);
    expect(net.feedVersion).toBe('000123');
    expect(net.routes.get('R1')).toEqual({ short: '1', type: 0, rank: 1, shapes: [0] });
    expect(net.diagram.lines).toEqual([{ route: 'R1', pts: [{ x: 0, y: 0 }, { x: 1, y: 0.5 }] }]);

    expect(net.edges.map((e) => e.pts)).toEqual([plane(E0_LONLAT), plane(E1_LONLAT)]);
    expect(net.edges[0]).toMatchObject({ from: 0, to: 1, cum: cumulative(plane(E0_LONLAT)) });
    const [s1, b1] = net.shapes;
    expect(s1).toMatchObject({ id: 'S1', route: 'R1', edges: [0, 1], direction: 0, pts: [...plane(E0_LONLAT), plane(E1_LONLAT)[1]] });
    expect(s1.len).toBeCloseTo(lenOf(s1.pts), 9); // rebuilt from the edges, not the sentinel
    expect(b1).toMatchObject({ pts: plane(B1_LONLAT), len: 888.8, direction: -1 });
    expect(b1.edges).toBeUndefined();

    const [shapePath, synthetic] = net.paths;
    expect(shapePath).toMatchObject({ id: 'S1', route: 'R1', direction: 0, shape: 0, edges: [0, 1], offsets: [0, net.edges[0].len] });
    expect(shapePath.len).toBeCloseTo(net.edges[0].len + net.edges[1].len, 9);
    expect(synthetic).toMatchObject({ id: 'path:R1:1:deadbeef', shape: null, edges: [1], offsets: [0], stops: ['B', 'C'] });
    expect(net.pathOfShape(0)).toBe(0);
    expect(net.pathOfShape(1)).toBeNull();

    const [a, b, c, d] = net.stops;
    expect(a.onEdge).toEqual([{ edge: 0, s: 4.7 }]);
    expect(a.on).toEqual([{ shape: 0, s: 4.7 }]);
    expect(b.on).toEqual([{ shape: 0, s: net.edges[0].len + 10 }]);
    expect(c.on).toEqual([{ shape: 0, s: net.edges[0].len + 15 }]);
    expect(d.on).toEqual([{ shape: 1, s: 0.5 * lenOf(plane(B1_LONLAT)) }]);
    expect(d.p).toEqual(toPlane(...unitLonLat(10, 10)));
    expect(net.nextStop(0, 0)?.stop.id).toBe('A');
    expect(net.nextStop(0, 4.7)?.stop.id).toBe('B'); // never the stop a vehicle sits on
    expect(net.nextStop(0, 4.8)?.s).toBeCloseTo(net.edges[0].len + 10, 9);
    expect(net.nextStop(0, s1.len)).toBeNull();
    expect(net.nextStop(5, 0)).toBeNull();

    const stale = rawArtefactV2();
    (stale as { version: number }).version = 1;
    expect(() => decodeNetwork(stale)).toThrow(NetworkVersionError);
    expect(() => decodeNetwork(null)).toThrow(NetworkVersionError);
    expect(shim.decodeNetwork).toBe(decodeNetwork); // the app-side path is a shim (R-TE15)

    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toBe('/data/zet-network.json');
      return { ok: true, json: async () => rawArtefactV2() } as Response;
    });
    expect(await loadNetwork(fetchSpy as unknown as typeof fetch, true)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await loadNetwork(fetchSpy as unknown as typeof fetch, false))?.feedVersion).toBe('000123');
    expect(await loadNetwork(vi.fn(async () => ({ ok: true, json: async () => stale }) as Response) as unknown as typeof fetch, false)).toBeNull();
    expect(
      await loadNetwork(
        vi.fn(async () => {
          throw new Error('offline');
        }) as unknown as typeof fetch,
        false,
      ),
    ).toBeNull();
  });
});
