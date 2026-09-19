import { describe, expect, it } from 'vitest';
import { bodiesToGeoJson, bodyOf } from '../../app/src/motion/bodies';
import type { Drawn } from '../../app/src/motion/integrator';
import { vehiclesToGeoJson } from '../../app/src/map/city-map';
import { toPlane, type XY } from '../../shared/motion/geo';
import { VEHICLE_LENGTH_M } from '../../shared/motion/vehicle';
import { syntheticNetwork } from './synthetic-network';

// One tram path over one edge with a right-angle bend at (100, 0): east for
// 100 m, then north for 100 m. Arc 100 is the bend itself.
const NET = syntheticNetwork({
  edges: [{ from: 0, to: 1, pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }],
  routes: [{ id: '1', type: 0, paths: [{ id: '1_0', direction: 0, edges: [0] }] }],
  stops: [],
});
const TRAM = VEHICLE_LENGTH_M.tram;
const BUS = VEHICLE_LENGTH_M.bus;

const tram = (over: Partial<Drawn>): Drawn =>
  ({ id: 't', type: 0, routeId: '1', short: '1', p: { x: 0, y: 0 }, heading: null, speed: 5, confidence: 1, onShape: 0, ...over });
const length = (pts: readonly XY[]): number => pts.reduce((sum, q, i) => (i === 0 ? 0 : sum + Math.hypot(q.x - pts[i - 1]!.x, q.y - pts[i - 1]!.y)), 0);

describe('bodyOf: where a vehicle of one length lies, centred on its mark', () => {
  it('follows the rail: a tram with a path and an arc is the path sliced L/2 each way, the bend kept, and a terminus clamps the slice', () => {
    const onBend = bodyOf(tram({ path: 0, s: 100, p: { x: 100, y: 0 } }), NET, TRAM)!;
    expect(onBend).toEqual([{ x: 100 - TRAM / 2, y: 0 }, { x: 100, y: 0 }, { x: 100, y: TRAM / 2 }]);
    expect(length(onBend)).toBeCloseTo(TRAM, 9);
    // At the start of the line the body cannot reach behind the terminus: it is what is left, not a body hanging off the rail.
    expect(bodyOf(tram({ path: 0, s: 5, p: { x: 5, y: 0 } }), NET, TRAM)).toEqual([{ x: 0, y: 0 }, { x: 5 + TRAM / 2, y: 0 }]);
  });

  it('lies straight along the heading, or the track, when there is no rail to follow: a bus, a free-plane tram, a path without a network', () => {
    const bus: Drawn = { id: 'b', type: 3, routeId: '109', p: { x: 10, y: 10 }, heading: { x: 0, y: 1 }, speed: 8, confidence: 1, onShape: 3 };
    expect(bodyOf(bus, NET, BUS)).toEqual([{ x: 10, y: 10 - BUS / 2 }, { x: 10, y: 10 + BUS / 2 }]);
    // A heading the model is unsure of is null; the geometry's own tangent still says which way the mark lies.
    expect(bodyOf(tram({ p: { x: 50, y: 0 }, heading: null, track: { x: 1, y: 0 } }), NET, TRAM)).toEqual([{ x: 50 - TRAM / 2, y: 0 }, { x: 50 + TRAM / 2, y: 0 }]);
    // The heading wins over the track when both are known.
    expect(bodyOf(tram({ p: { x: 50, y: 0 }, heading: { x: 0, y: -1 }, track: { x: 1, y: 0 } }), NET, TRAM)).toEqual([{ x: 50, y: TRAM / 2 }, { x: 50, y: -TRAM / 2 }]);
    // A path and an arc mean nothing without the network that holds the geometry; the straight segment stands in.
    expect(bodyOf(tram({ path: 0, s: 100, p: { x: 100, y: 0 }, heading: { x: 1, y: 0 } }), null, TRAM)).toEqual([{ x: 100 - TRAM / 2, y: 0 }, { x: 100 + TRAM / 2, y: 0 }]);
    // A direction that is not a unit vector still gives a body of the one length.
    expect(length(bodyOf(tram({ p: { x: 0, y: 0 }, heading: { x: 3, y: 4 } }), null, TRAM)!)).toBeCloseTo(TRAM, 9);
  });

  it('draws nothing for a mark that does not know which way it lies', () => {
    expect(bodyOf(tram({ heading: null }), NET, TRAM)).toBeNull();
    expect(bodyOf(tram({ path: 0, heading: null }), NET, TRAM)).toBeNull(); // an arc-less path is no rail position
    expect(bodyOf(tram({ heading: { x: 0, y: 0 } }), NET, TRAM)).toBeNull(); // a zero vector points nowhere
  });
});

describe('bodiesToGeoJson: one LineString per vehicle, never per cluster', () => {
  const drawn: Drawn[] = [
    tram({ id: 'a', path: 0, s: 100, p: { x: 100, y: 0 } }),
    tram({ id: 'a2', routeId: '1', path: 0, s: 100, p: { x: 100, y: 0 } }), // the same spot: on the map these merge into one pill
    { id: 'b', type: 3, routeId: '109', p: { x: 10, y: 10 }, heading: { x: 0, y: 1 }, speed: 8, confidence: 0.3, onShape: 3 },
    { id: 'u', type: 999, p: { x: 20, y: 20 }, heading: { x: 1, y: 0 }, speed: 0, confidence: 1, onShape: null },
    tram({ id: 'blind', heading: null }),
  ];

  it('writes every vehicle with a direction, the merged pair as two bodies, lengths by kind with an unknown kind at the tram\u2019s, through toLonLat', () => {
    const fc = bodiesToGeoJson(drawn, NET);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.map((f) => f.properties.id)).toEqual(['a', 'a2', 'b', 'u']);
    for (const f of fc.features) expect(f.geometry.type).toBe('LineString');
    const metres = (id: string): number => length(fc.features.find((f) => f.properties.id === id)!.geometry.coordinates.map(([lon, lat]) => toPlane(lon, lat)));
    expect(metres('a')).toBeCloseTo(TRAM, 6);
    expect(metres('b')).toBeCloseTo(BUS, 6);
    expect(metres('u')).toBeCloseTo(TRAM, 6);
    expect(fc.features[0]!.geometry.coordinates).toHaveLength(3); // the bend, kept
  });

  it('carries the properties the layer reads -- id, kind, routeId and the same alpha the pills carry -- and nothing else', () => {
    const fc = bodiesToGeoJson(drawn, NET);
    const pills = vehiclesToGeoJson(drawn);
    for (const f of fc.features) {
      const pill = pills.features.find((p) => p.properties.id === f.properties.id)!;
      expect(f.properties).toEqual({ id: pill.properties.id, kind: pill.properties.kind, routeId: pill.properties.routeId, alpha: pill.properties.alpha });
    }
    expect(fc.features.map((f) => f.properties.kind)).toEqual(['tram', 'tram', 'bus', 'other']);
    expect(fc.features.find((f) => f.properties.id === 'u')!.properties.routeId).toBe('');
    expect(fc.features.find((f) => f.properties.id === 'b')!.properties.alpha).toBeLessThan(1);
  });

  it('is empty for no vehicles and with no network still draws the straight bodies', () => {
    expect(bodiesToGeoJson([], NET)).toEqual({ type: 'FeatureCollection', features: [] });
    expect(bodiesToGeoJson(drawn, null).features.map((f) => f.properties.id)).toEqual(['b', 'u']);
  });
});
