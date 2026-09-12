import { describe, expect, it, vi } from 'vitest';
import { toPlane } from '../../app/src/motion/geo';
import { cumulative } from '../../app/src/motion/polyline';
import { decodeNetwork, loadNetwork, NetworkVersionError, type Network } from '../../app/src/motion/network';

// A tiny hand-built artefact in the exact wire shape scripts/gtfs-shapes.mjs
// produces: struct-of-arrays routes/shapes/stops, chain-delta-encoded
// integer units for shape points and stop positions (relative to `origin`
// at `scale` degrees per unit), and each stop's `on` list chain-delta-encoding
// its own shape indices with the fraction scaled by 50 (ON_FRAC_SCALE in the
// builder script). Three points on one shape, three stops on it at fractions
// 0.2, 0.5 and 0.9 -- enough to exercise decode and nextStop's ordering.
const ORIGIN: [number, number] = [16, 45.8];
const SCALE = 0.0001;

// lon/lat chosen as exact origin + integer*scale, so delta-encoding and
// decoding round-trips exactly with no quantisation error to reason about.
const LONLAT: [number, number][] = [
  [16.0, 45.8], // unit (0, 0)
  [16.0003, 45.8], // unit (3, 0)
  [16.0003, 45.8002], // unit (3, 2)
];

function rawArtefact() {
  return {
    version: 1,
    feedVersion: '000123',
    origin: ORIGIN,
    scale: SCALE,
    routes: {
      id: ['R1'],
      short: ['1'],
      type: [0],
      rank: [1],
      shapes: [[0]],
    },
    shapes: {
      id: ['S1'],
      route: ['R1'],
      // chain-delta of units (0,0) -> (3,0) -> (3,2): [0,0, 3,0, 0,2]
      d: [[0, 0, 3, 0, 0, 2]],
      len: [999.9], // a sentinel distinct from any recomputed cum, to prove len is the wire value
    },
    stops: {
      id: ['A', 'B', 'C'],
      name: ['Stop A', 'Stop B', 'Stop C'],
      // chain-delta across the WHOLE stops array (not reset per stop): three
      // stops all placed at the same point here, since only `on` matters for
      // nextStop -- position correctness is covered by its own dedicated case.
      p: [
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      on: [
        [[0, 10]], // shape 0, scaledFrac 10 -> frac 0.2
        [[0, 25]], // shape 0, scaledFrac 25 -> frac 0.5
        [[0, 45]], // shape 0, scaledFrac 45 -> frac 0.9
      ],
    },
    diagram: {
      lines: { route: ['R1'], pts: [[[0, 0], [1, 0.5]]] },
      box: [1, 1],
    },
  };
}

describe('decodeNetwork', () => {
  it('undoes the delta encoding and converts shape points to the same plane as geo.ts', () => {
    const net = decodeNetwork(rawArtefact());
    const expectedPts = LONLAT.map(([lon, lat]) => toPlane(lon, lat));
    expect(net.shapes).toHaveLength(1);
    const shape = net.shapes[0];
    expect(shape.id).toBe('S1');
    expect(shape.route).toBe('R1');
    expect(shape.pts).toEqual(expectedPts);
  });

  it('precomputes cum per shape from the decoded points', () => {
    const net = decodeNetwork(rawArtefact());
    const expectedPts = LONLAT.map(([lon, lat]) => toPlane(lon, lat));
    expect(net.shapes[0].cum).toEqual(cumulative(expectedPts));
  });

  it('keeps the wire len value rather than recomputing it', () => {
    const net = decodeNetwork(rawArtefact());
    expect(net.shapes[0].len).toBe(999.9);
  });

  it('decodes routes into a Map keyed by route id', () => {
    const net = decodeNetwork(rawArtefact());
    expect(net.routes.get('R1')).toEqual({ short: '1', type: 0, rank: 1, shapes: [0] });
  });

  it('decodes feedVersion and version', () => {
    const net = decodeNetwork(rawArtefact());
    expect(net.version).toBe(1);
    expect(net.feedVersion).toBe('000123');
  });

  it('decodes the diagram as plain XY points, unaffected by the delta scheme', () => {
    const net = decodeNetwork(rawArtefact());
    expect(net.diagram.box).toEqual([1, 1]);
    expect(net.diagram.lines).toEqual([{ route: 'R1', pts: [{ x: 0, y: 0 }, { x: 1, y: 0.5 }] }]);
  });

  it('throws a typed NetworkVersionError when the version does not match', () => {
    const raw = rawArtefact();
    (raw as { version: number }).version = 2;
    expect(() => decodeNetwork(raw)).toThrow(NetworkVersionError);
  });

  it('throws NetworkVersionError on a non-object artefact', () => {
    expect(() => decodeNetwork(null)).toThrow(NetworkVersionError);
    expect(() => decodeNetwork('not json')).toThrow(NetworkVersionError);
  });
});

describe('Network.nextStop', () => {
  function network(): Network {
    return decodeNetwork(rawArtefact());
  }

  function stopArcLengths(net: Network) {
    const shapeLen = net.shapes[0].cum[net.shapes[0].cum.length - 1];
    return { a: 0.2 * shapeLen, b: 0.5 * shapeLen, c: 0.9 * shapeLen, shapeLen };
  }

  it('returns the next stop ahead of the given arc length', () => {
    const net = network();
    const { a, b } = stopArcLengths(net);
    const result = net.nextStop(0, (a + b) / 2);
    expect(result?.stop.id).toBe('B');
    expect(result?.s).toBeCloseTo(b, 9);
  });

  it('returns the stop right after the start of the shape', () => {
    const net = network();
    const { a } = stopArcLengths(net);
    const result = net.nextStop(0, 0);
    expect(result?.stop.id).toBe('A');
    expect(result?.s).toBeCloseTo(a, 9);
  });

  it('does not return the stop a vehicle sits exactly on -- only the one after it', () => {
    const net = network();
    const { a, b } = stopArcLengths(net);
    const result = net.nextStop(0, a);
    expect(result?.stop.id).toBe('B');
    void b;
  });

  it('returns null once the vehicle is past the last stop on the shape', () => {
    const net = network();
    const { c, shapeLen } = stopArcLengths(net);
    expect(net.nextStop(0, shapeLen)).toBeNull();
    void c;
  });

  it('returns null for a shape index with no linked stops', () => {
    const net = network();
    expect(net.nextStop(5, 0)).toBeNull();
  });
});

describe('loadNetwork', () => {
  it('returns null in lightweight mode without issuing a fetch', async () => {
    const fetchSpy = vi.fn();
    const result = await loadNetwork(fetchSpy as unknown as typeof fetch, true);
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches /data/zet-network.json and decodes it on success', async () => {
    const body = rawArtefact();
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toBe('/data/zet-network.json');
      return { ok: true, json: async () => body } as Response;
    });
    const result = await loadNetwork(fetchSpy as unknown as typeof fetch, false);
    expect(result?.feedVersion).toBe('000123');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns null when the response is not ok', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response);
    const result = await loadNetwork(fetchSpy as unknown as typeof fetch, false);
    expect(result).toBeNull();
  });

  it('returns null when the fetch itself rejects', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('offline');
    });
    const result = await loadNetwork(fetchSpy as unknown as typeof fetch, false);
    expect(result).toBeNull();
  });

  it('returns null when the fetched body fails to decode (e.g. a stale cached artefact)', async () => {
    const badBody = rawArtefact();
    (badBody as { version: number }).version = 999;
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => badBody }) as Response);
    const result = await loadNetwork(fetchSpy as unknown as typeof fetch, false);
    expect(result).toBeNull();
  });
});
