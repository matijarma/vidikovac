// Seam S3: shared/city/place.ts. The tram-400 m / bus-300 m / address rule
// [O-26], the stop and default places, the bounds and the input guard.
import { describe, expect, it } from 'vitest';
import stopsJson from '../../app/public/data/stops.json';
import { MAP_CONFIG } from '../../app/src/core/contracts';
import { distanceM } from '../../shared/city/geo';
import {
  BUS_NEAR_M,
  DEFAULT_PLACE_STOP_ID,
  PLACE_ADDRESS_MAX,
  PLACE_NAME_MAX,
  TRAM_NEAR_M,
  ZAGREB_BOUNDS,
  defaultPlace,
  derivePlace,
  inZagreb,
  isValidPlaceInput,
  nearestStops,
  placeFromStop,
  type NearStop,
  type PlaceAnchor,
  type ScreenPlace,
  type ScreenPlaceInput,
  type ScreenPlaceKind,
} from '../../shared/city/place';
import { isTramRoute } from '../../worker/pairing/place';
import type { ScreenStop } from '../../worker/protocol';

const STOPS = stopsJson as ScreenStop[];
const ORIGIN = { lon: 15.98, lat: 45.81 };
const M_PER_DEG = (6_371_000 * Math.PI) / 180;
/** A point `d` metres due north of `from`, so its air distance is exactly `d`. */
const north = (from: { lon: number; lat: number }, d: number) => ({ lon: from.lon, lat: from.lat + d / M_PER_DEG });
const stop = (id: string, name: string, d: number, routes: string[]): ScreenStop => ({ id, name, routes, ...north(ORIGIN, d) });
const anchor: PlaceAnchor = { ...ORIGIN, name: 'Ilica', address: 'Ilica 25' };

describe('place constants', () => {
  it('holds the owner’s distances and the default stop', () => {
    expect([TRAM_NEAR_M, BUS_NEAR_M, PLACE_NAME_MAX, PLACE_ADDRESS_MAX]).toEqual([400, 300, 80, 120]);
    expect(DEFAULT_PLACE_STOP_ID).toBe('106_1');
  });

  it('bounds Zagreb exactly as the served map does', () => {
    expect([ZAGREB_BOUNDS.west, ZAGREB_BOUNDS.south, ZAGREB_BOUNDS.east, ZAGREB_BOUNDS.north]).toEqual(MAP_CONFIG.bounds);
    expect(inZagreb(15.97726, 45.81286)).toBe(true);
    expect(inZagreb(15.69, 45.8)).toBe(false);
    expect(inZagreb(16.0, 46.03)).toBe(false);
    expect(inZagreb(Number.NaN, 45.8)).toBe(false);
  });
});

describe('derivePlace', () => {
  it('takes a tram platform within 400 m, even with a bus platform nearer', () => {
    const place = derivePlace(anchor, [stop('b', 'Bus', 100, ['101']), stop('t', 'Tram', 390, ['6'])], isTramRoute);
    expect(place).toEqual<ScreenPlace>({ kind: 'tram', name: 'Tram', ...north(ORIGIN, 390), stopId: 't', address: 'Ilica 25' });
  });

  it('else a bus platform within 300 m', () => {
    const place = derivePlace(anchor, [stop('b', 'Bus', 290, ['101']), stop('t', 'Tram', 410, ['6'])], isTramRoute);
    expect(place.kind).toBe('bus');
    expect(place.stopId).toBe('b');
  });

  it('else the address itself', () => {
    const place = derivePlace(anchor, [stop('b', 'Bus', 310, ['101']), stop('t', 'Tram', 410, ['6'])], isTramRoute);
    expect(place).toEqual<ScreenPlace>({ kind: 'address', name: 'Ilica', lon: ORIGIN.lon, lat: ORIGIN.lat, address: 'Ilica 25' });
    expect(derivePlace({ ...ORIGIN, name: 'Ilica' }, [], isTramRoute)).toEqual({ kind: 'address', name: 'Ilica', ...ORIGIN });
  });

  it('names Kvaternikov trg for a point 100 m from its tram platform (real stop table)', () => {
    const platform = STOPS.find((s) => s.id === '236_2')!;
    const place = derivePlace({ ...north(platform, 100), name: 'Kvaternikova ulica' }, STOPS, isTramRoute);
    expect(place.kind).toBe('tram');
    expect(place.name).toBe('Kvaternikov trg');
    expect(distanceM(place, north(platform, 100))).toBeLessThanOrEqual(TRAM_NEAR_M);
  });

  it('derives a bus place from a bus-only platform far from any tram (real stop table)', () => {
    const tram = STOPS.filter((s) => s.routes.some(isTramRoute));
    const lone = STOPS.find((s) => s.routes.length > 0 && !s.routes.some(isTramRoute)
      && Math.min(...tram.map((t) => distanceM(s, t))) > TRAM_NEAR_M + 200)!;
    const place = derivePlace({ ...north(lone, 50), name: 'x' }, STOPS, isTramRoute);
    expect(place.kind).toBe('bus');
    expect(distanceM(place, north(lone, 50))).toBeLessThanOrEqual(BUS_NEAR_M);
  });
});

describe('nearestStops, placeFromStop, defaultPlace', () => {
  it('keeps one platform per name, nearest first, within the limit and the filter', () => {
    const stops = [stop('a1', 'A', 200, ['6']), stop('a2', 'A', 100, ['6']), stop('b', 'B', 150, ['101']), stop('c', 'C', 50, ['6'])];
    const near: NearStop[] = nearestStops(ORIGIN, stops, { limit: 3 });
    expect(near.map((s) => s.id)).toEqual(['c', 'a2', 'b']);
    expect(near[0]!.distanceM).toBeCloseTo(50, 6);
    expect(nearestStops(ORIGIN, stops, { limit: 5, only: (s) => s.routes.some(isTramRoute) }).map((s) => s.id)).toEqual(['c', 'a2']);
    expect(nearestStops(ORIGIN, stops, { limit: 0 })).toEqual([]);
  });

  it('makes a tram place of a stop with any tram route, else a bus place', () => {
    const kinds: ScreenPlaceKind[] = [
      placeFromStop(stop('m', 'Mixed', 0, ['101', '6']), isTramRoute).kind,
      placeFromStop(stop('b', 'Bus', 0, ['101']), isTramRoute).kind,
    ];
    expect(kinds).toEqual(['tram', 'bus']);
    expect(placeFromStop(stop('b', 'Bus', 0, ['101']), isTramRoute, 'Ilica 25').address).toBe('Ilica 25');
  });

  it('defaults to Trg bana J. Jelačića', () => {
    expect(defaultPlace(STOPS)).toEqual<ScreenPlace>({ kind: 'tram', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, stopId: '106_1' });
    expect(defaultPlace(STOPS)).toEqual(placeFromStop(STOPS.find((s) => s.id === '106_1')!, isTramRoute));
    expect(defaultPlace([])).toBeNull();
  });
});

describe('isValidPlaceInput', () => {
  it('accepts a stop by id and an address inside Zagreb', () => {
    const ok: ScreenPlaceInput[] = [
      { kind: 'stop', stopId: '106_1' },
      { kind: 'stop', stopId: '236_2', address: 'Kvaternikov trg 3' },
      { kind: 'address', name: 'Ilica', lon: 15.97, lat: 45.8135, address: 'Ilica 25' },
    ];
    expect(ok.every(isValidPlaceInput)).toBe(true);
  });

  it('refuses everything else', () => {
    const bad: unknown[] = [
      null, 'Ilica', [], {}, { kind: 'tram', stopId: '106_1' },
      { kind: 'stop' }, { kind: 'stop', stopId: '106 1' }, { kind: 'stop', stopId: 'x'.repeat(33) },
      { kind: 'address', name: 'X', lon: 0, lat: 0 },
      { kind: 'address', name: '  ', lon: 15.97, lat: 45.81 },
      { kind: 'address', name: 'x'.repeat(81), lon: 15.97, lat: 45.81 },
      { kind: 'address', name: 'Ilica\u0007', lon: 15.97, lat: 45.81 },
      { kind: 'address', name: 'Ilica', lon: '15.97', lat: 45.81 },
      { kind: 'stop', stopId: '106_1', address: 'x'.repeat(121) },
      { kind: 'stop', stopId: '106_1', address: 42 },
    ];
    expect(bad.filter(isValidPlaceInput)).toEqual([]);
  });
});
