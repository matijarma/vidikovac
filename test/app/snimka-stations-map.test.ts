// The Bicikli depth's station data (app/src/snimka/panel-depths.ts, V3-14):
// a dot per station by its byte (bikes there filled, 0 hollow, 254 grey, 255
// not drawn), the stations in the minimaps' projection, "Prazne sada, a u
// četvrtak 1. 10. nisu bile" (0 now, at least 3 at the reference minute,
// Thursday's fullest first) and BAJS's capitals in normal capitalisation.
import { describe, expect, it } from 'vitest';
import { toPlane } from '../../shared/motion/geo';
import { BAJS_MISSING, BAJS_NOT_RENTING } from '../../shared/snimka-codec';
import type { StationsFile } from '../../shared/snimka';
import { dotState, emptiedStations, lineChipText, stationName, stationPoints } from '../../app/src/snimka/panel-depths';

const stations: StationsFile = { v: 1, stations: [
  { id: 'a', name: 'TRG KRALJA TOMISLAVA', lon: 15.977, lat: 45.805, capacity: 20 },
  { id: 'b', name: 'S.D. STJEPAN RADIĆ', lon: 15.96, lat: 45.79, capacity: 20 },
  { id: 'c', name: 'Stanica 3', lon: 15.99, lat: 45.81, capacity: 20 },
  { id: 'd', name: 'MIHALJEVAC OKRETIŠTE', lon: 15.98, lat: 45.83, capacity: 20 },
] };

describe('dotState', () => {
  it('filled with bikes, hollow when empty, grey when not renting, nothing when missing', () => {
    expect(dotState(7)).toBe('full');
    expect(dotState(1)).toBe('full');
    expect(dotState(0)).toBe('empty');
    expect(dotState(BAJS_NOT_RENTING)).toBe('off');
    expect(dotState(BAJS_MISSING)).toBe('none');
    expect(dotState(undefined)).toBe('none');
  });
});

describe('stationPoints', () => {
  it('projects like the minimaps (toPlane, y down) inside a padded viewBox', () => {
    const { points, viewBox } = stationPoints(stations);
    const p = toPlane(15.977, 45.805);
    expect(points.get('a')).toEqual({ x: Math.round(p.x), y: Math.round(-p.y) });
    const [x, y, w, h] = viewBox.split(' ').map(Number) as [number, number, number, number];
    for (const q of points.values()) {
      expect(q.x).toBeGreaterThan(x);
      expect(q.x).toBeLessThan(x + w);
      expect(q.y).toBeGreaterThan(y);
      expect(q.y).toBeLessThan(y + h);
    }
  });
});

describe('emptiedStations', () => {
  it('0 now and at least 3 at the reference, the fullest on Thursday first; missing and not renting never count', () => {
    const file = { stations: ['a', 'b', 'c', 'd'] };
    // Sample 0 = now, sample 1 = the reference minute.
    const rows = [Uint8Array.from([0, 7]), Uint8Array.from([0, 12]), Uint8Array.from([0, 2]), Uint8Array.from([0, BAJS_NOT_RENTING])];
    expect(emptiedStations(stations, file, rows, 0, 1)).toEqual([
      { id: 'b', name: 'S.D. Stjepan Radić', ref: 12 },
      { id: 'a', name: 'Trg kralja Tomislava', ref: 7 },
    ]);
    const missingNow = [Uint8Array.from([BAJS_MISSING, 9])];
    expect(emptiedStations(stations, { stations: ['a'] }, missingNow, 0, 1)).toEqual([]);
    expect(emptiedStations(stations, file, rows, 0, -1)).toEqual([]);
  });
});

describe('stationName and the line chips', () => {
  it('BAJS capitals in normal capitalisation; acronyms, initials and mixed-case names kept', () => {
    expect(stationName('TRG KRALJA TOMISLAVA')).toBe('Trg kralja Tomislava');
    expect(stationName('MIHALJEVAC OKRETIŠTE')).toBe('Mihaljevac okretište');
    expect(stationName('VLAŠKA UL.')).toBe('Vlaška ul.');
    expect(stationName('KBC REBRO')).toBe('KBC Rebro');
    expect(stationName('TRATINSKA UL. - SAVSKA UL.')).toBe('Tratinska ul. - Savska ul.');
    expect(stationName('ORANICE - UL. I.BRLIĆ-MAŽURANIĆ')).toBe('Oranice - Ul. I.Brlić-Mažuranić');
    expect(stationName('Stanica 3')).toBe('Stanica 3');
  });
  it('a chip reads "228 3 · običan dan 4", bez podatka for a missing count', () => {
    expect(lineChipText('228', 3, 4)).toBe('228 3 · običan dan 4');
    expect(lineChipText('6', 1, null)).toBe('6 1 · običan dan bez podatka');
  });
});
