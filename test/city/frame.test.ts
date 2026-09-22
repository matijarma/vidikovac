// Seam S2: shared/city/frame.ts. The measured radius (air distance to the N-th
// distinct-name tram stop, bus stops as the fallback, clamped 0.5–3 km), the
// camera span and the "U blizini" pill.
import { describe, expect, it } from 'vitest';
import stopsJson from '../../app/public/data/stops.json';
import {
  DEFAULT_FRAME_STOPS,
  FRAME_RADIUS_M,
  FRAME_RADIUS_MAX_M,
  FRAME_RADIUS_MIN_M,
  FRAME_STOPS,
  FRAME_TRAM_REACH_M,
  WALK_MIN_PER_KM,
  frameRadiusM,
  frameSpanM,
  frameStopsFrom,
  isFrameStops,
  pillText,
  type FrameStop,
  type FrameStops,
} from '../../shared/city/frame';
import { isTramRoute } from '../../worker/pairing/place';
import type { ScreenStop } from '../../worker/protocol';

const PLACE = { lon: 16.0, lat: 45.8 };
/** Metres per degree of latitude on the sphere shared/city/geo.ts distanceM uses (R = 6,371 km). */
const M_PER_DEG = (6_371_000 * Math.PI) / 180;
/** A stop `d` metres due north of PLACE, so its air distance is exactly `d`. */
const north = (name: string, d: number, tram = true): FrameStop => ({ name, lon: PLACE.lon, lat: PLACE.lat + d / M_PER_DEG, tram });
/** Tram stops every `step` metres, named S1, S2, … */
const line = (step: number, count: number, tram = true): FrameStop[] => Array.from({ length: count }, (_, i) => north(`S${i + 1}`, step * (i + 1), tram));

describe('frame constants', () => {
  it('offers Kadar 4, 6 and 8, six by default', () => {
    expect(FRAME_STOPS).toEqual([4, 6, 8]);
    expect(DEFAULT_FRAME_STOPS).toBe(6);
    expect([4, 6, 8].every(isFrameStops)).toBe(true);
    expect([5, '6', null, undefined, 6.5].some(isFrameStops)).toBe(false);
  });

  it('keeps the fallback table and the bounds', () => {
    expect(FRAME_RADIUS_M).toEqual({ 4: 1300, 6: 2000, 8: 2700 });
    expect(Object.isFrozen(FRAME_RADIUS_M)).toBe(true);
    expect([FRAME_RADIUS_MIN_M, FRAME_RADIUS_MAX_M, FRAME_TRAM_REACH_M, WALK_MIN_PER_KM]).toEqual([500, 3000, 3000, 7.5]);
  });
});

describe('frameRadiusM', () => {
  it('is the air distance to the N-th tram stop', () => {
    const stops = line(300, 10);
    expect(frameRadiusM(PLACE, stops, 4)).toBeCloseTo(1200, 3);
    expect(frameRadiusM(PLACE, stops, 6)).toBeCloseTo(1800, 3);
    expect(frameRadiusM(PLACE, stops, 8)).toBeCloseTo(2400, 3);
  });

  it('grows with N', () => {
    for (const stops of [line(250, 12), line(420, 12)]) {
      const [r4, r6, r8] = FRAME_STOPS.map((n: FrameStops) => frameRadiusM(PLACE, stops, n));
      expect(r4).toBeLessThanOrEqual(r6!);
      expect(r6).toBeLessThanOrEqual(r8!);
    }
  });

  it('counts platforms that share a name once and skips the place’s own stop', () => {
    const stops = [north('Trg', 0), north('Trg', 40), north('A', 300), north('A', 330), north('B', 600), north('C', 900), north('D', 1200)];
    expect(frameRadiusM({ ...PLACE, name: 'Trg', kind: 'tram' }, stops, 4)).toBeCloseTo(1200, 3);
    // An address named like a stop still counts that stop: only a stop place skips its own name.
    expect(frameRadiusM({ ...PLACE, name: 'Trg', kind: 'address' }, stops, 4)).toBeCloseTo(900, 3);
  });

  it('counts bus stops only when no tram stop lies within 3 km', () => {
    const buses = line(400, 10, false);
    expect(frameRadiusM(PLACE, [...buses, north('Far tram', 3200)], 4)).toBeCloseTo(1600, 3);
    expect(frameRadiusM(PLACE, [...buses, ...line(700, 10)], 4)).toBeCloseTo(2800, 3);
  });

  it('clamps to half a kilometre and three', () => {
    expect(frameRadiusM(PLACE, line(50, 10), 4)).toBe(FRAME_RADIUS_MIN_M);
    expect(frameRadiusM(PLACE, line(1000, 10), 8)).toBe(FRAME_RADIUS_MAX_M);
    expect(frameRadiusM(PLACE, line(300, 3), 6)).toBe(FRAME_RADIUS_MAX_M);
  });

  it('falls back to the table when no stops are loaded', () => {
    expect(FRAME_STOPS.map((n) => frameRadiusM(PLACE, [], n))).toEqual([1300, 2000, 2700]);
  });

  it('measures the real stop table around Trg bana J. Jelačića within the bounds, monotone', () => {
    const table = stopsJson as ScreenStop[];
    const stops = frameStopsFrom(table, isTramRoute);
    expect(stops.filter((s) => s.tram).length).toBeGreaterThan(300);
    const trg = table.find((s) => s.id === '106_1')!;
    const radii = FRAME_STOPS.map((n) => frameRadiusM(trg, stops, n));
    expect(radii[0]).toBeLessThanOrEqual(radii[1]!);
    expect(radii[1]).toBeLessThanOrEqual(radii[2]!);
    for (const r of radii) {
      expect(r).toBeGreaterThanOrEqual(FRAME_RADIUS_MIN_M);
      expect(r).toBeLessThanOrEqual(FRAME_RADIUS_MAX_M);
    }
  });
});

describe('frameSpanM and pillText', () => {
  it('spans the whole circle', () => {
    expect(frameSpanM(2000)).toBe(4000);
    expect(frameSpanM(650)).toBe(1300);
  });

  it('prints a whole kilometre without a decimal', () => {
    expect(pillText(2000)).toBe('2 km · ~15 min');
    expect(pillText(1960)).toBe('2 km · ~15 min');
    expect(pillText(3000)).toBe('3 km · ~22 min');
  });

  it('prints one decimal with a comma and the minutes of the printed distance', () => {
    expect(pillText(2200)).toBe('2,2 km · ~16 min');
    expect(pillText(2170)).toBe('2,2 km · ~16 min');
    expect(pillText(1300)).toBe('1,3 km · ~10 min');
    expect(pillText(2700)).toBe('2,7 km · ~20 min');
    expect(pillText(500)).toBe('0,5 km · ~4 min');
    expect(pillText(680)).toBe('0,7 km · ~5 min');
  });

  it('matches the probe the wall spec reads', () => {
    for (let r = FRAME_RADIUS_MIN_M; r <= FRAME_RADIUS_MAX_M; r += 37) expect(`U blizini · ${pillText(r)}`).toMatch(/^U blizini · \d+(,\d)? km · ~\d+ min$/);
  });
});
