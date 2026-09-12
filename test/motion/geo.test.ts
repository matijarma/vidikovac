import { describe, expect, it } from 'vitest';
import { dist, toLonLat, toPlane } from '../../app/src/motion/geo';

// Independent cross-check of the projection's scale, duplicated from
// well-known WGS84 geodesy rather than imported from the module under
// test: this is the thing that would catch a wrong radius, a missing
// degrees-to-radians conversion, or a reference latitude that silently
// drifted away from the brief's "about 45.8 N".
const EARTH_RADIUS_M = 6378137;
const DEG2RAD = Math.PI / 180;
const REFERENCE_LAT_DEG = 45.8;

describe('toPlane / toLonLat: the local metre plane', () => {
  it('is an exact inverse pair, round-tripping lon/lat through the plane and back', () => {
    const spots: Array<[number, number]> = [
      [15.9819, 45.8131], // Trg bana Jelačića
      [15.9, 45.75],
      [16.05, 45.85],
      [0, 0],
      [-10.5, 45.8],
    ];
    for (const [lon, lat] of spots) {
      const [lon2, lat2] = toLonLat(toPlane(lon, lat));
      expect(lon2).toBeCloseTo(lon, 9);
      expect(lat2).toBeCloseTo(lat, 9);
    }
  });

  it('round-trips a plane point through lon/lat and back to itself', () => {
    const points = [
      { x: 12345.678, y: -9876.543 },
      { x: 0, y: 0 },
      { x: -50000, y: 50000 },
    ];
    for (const p of points) {
      const back = toPlane(...toLonLat(p));
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
  });

  it('moving east increases x and moving north increases y', () => {
    const centre = toPlane(15.98, 45.81);
    const east = toPlane(15.99, 45.81);
    const north = toPlane(15.98, 45.82);
    expect(east.x).toBeGreaterThan(centre.x);
    expect(east.y).toBeCloseTo(centre.y, 9);
    expect(north.y).toBeGreaterThan(centre.y);
    expect(north.x).toBeCloseTo(centre.x, 9);
  });

  it('one degree of latitude is ~111.32 km, matching WGS84 independent of the module', () => {
    const metresPerDegreeLat = DEG2RAD * EARTH_RADIUS_M;
    const measured = dist(toPlane(15.9, 45.0), toPlane(15.9, 46.0));
    expect(measured).toBeCloseTo(metresPerDegreeLat, 3);
  });

  it('one degree of longitude at 45.8N is shortened by cos(45.8deg), the brief\'s own reference latitude', () => {
    const metresPerDegreeLonAt45_8 = DEG2RAD * EARTH_RADIUS_M * Math.cos(REFERENCE_LAT_DEG * DEG2RAD);
    const measured = dist(toPlane(15.0, 45.8), toPlane(16.0, 45.8));
    expect(measured).toBeCloseTo(metresPerDegreeLonAt45_8, 3);
  });
});

describe('dist', () => {
  it('is plain Euclidean distance in the plane', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(dist({ x: -1, y: -1 }, { x: -1, y: -1 })).toBe(0);
    expect(dist({ x: 10, y: 0 }, { x: 0, y: 0 })).toBe(10);
  });
});
