// The places stage (scripts/snimka/stage-places.ts) against the committed
// stops.json and the depots: the committed places.json resolves, a typed
// coordinate more than 5 m off fails, Rebro is the line-228 platform near KBC Rebro.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPlaceEntries, resolvePlaces, type StopRow } from '../../scripts/snimka/stage-places';
import { DEPOTS } from '../../shared/motion/depots';
import { isPlacesFile } from '../../shared/snimka';

const stops = JSON.parse(readFileSync('app/public/data/stops.json', 'utf8')) as StopRow[];

describe('places.json', () => {
  const file = resolvePlaces(readPlaceEntries('.'), stops);

  it('resolves every entry from stops.json or a depot box, inside Zagreb', () => {
    expect(isPlacesFile(file)).toBe(true);
    expect(file.places.map((p) => p.id)).toEqual(['jelacic', 'glavni-kolodvor', 'crnomerec', 'dubrava', 'savski-most', 'kvaternikov-trg', 'ljubljanica', 'borongaj', 'zaprude', 'rebro', 'spremiste-dubrava', 'spremiste-ljubljanica']);
    for (const p of file.places) {
      expect(p.lonLat[0]).toBeGreaterThan(15.8);
      expect(p.lonLat[0]).toBeLessThan(16.2);
      expect(p.lonLat[1]).toBeGreaterThan(45.7);
      expect(p.lonLat[1]).toBeLessThan(45.95);
    }
    const jelacic = file.places.find((p) => p.id === 'jelacic')!;
    expect(jelacic).toMatchObject({ ref: '106_1', from: 'stop', zoom: 13.2, lonLat: [15.97726, 45.81286] });
    expect(file.places.find((p) => p.id === 'crnomerec')!.zoom).toBe(14);
  });

  it('takes a depot at the centre of its box', () => {
    const box = DEPOTS.find((d) => d.name === 'Dubrava')!;
    const place = file.places.find((p) => p.id === 'spremiste-dubrava')!;
    expect(place.from).toBe('depot');
    expect(place.lonLat[0]).toBeCloseTo((box.minLon + box.maxLon) / 2, 4);
    expect(place.lonLat[1]).toBeCloseTo((box.minLat + box.maxLat) / 2, 4);
  });

  it('finds Rebro as the line-228 platform by name near KBC Rebro, never the Rebro 5 of line 283', () => {
    const rebro = file.places.find((p) => p.id === 'rebro')!;
    expect(rebro.ref).toBe('1123_23');
    expect(rebro.name).toBe('Bolnica Rebro');
    expect(rebro.ref).not.toBe('1909_22');
  });

  it('refuses a typed coordinate more than 5 m from its stop, an unknown stop and a duplicate id', () => {
    expect(() => resolvePlaces([{ id: 'x', from: 'stop', ref: '106_1', lonLat: [15.97726, 45.81296] }], stops)).toThrow(/m from its stop 106_1/);
    expect(() => resolvePlaces([{ id: 'x', from: 'stop', ref: '106_1', lonLat: [15.97727, 45.81287] }], stops)).not.toThrow();
    expect(() => resolvePlaces([{ id: 'x', from: 'stop', ref: 'nope' }], stops)).toThrow(/stops.json does not have/);
    expect(() => resolvePlaces([{ id: 'x', from: 'depot', ref: 'Savica' }], stops)).toThrow(/depots.ts does not have/);
    expect(() => resolvePlaces([{ id: 'x', from: 'stop', ref: '106_1' }, { id: 'x', from: 'stop', ref: '109_1' }], stops)).toThrow(/twice/);
    expect(() => resolvePlaces([{ id: 'r', from: 'stop', find: { route: '228', name: 'Rebro', near: [15.9, 45.7], withinM: 500 } }], stops)).toThrow(/finds no platform/);
  });
});
