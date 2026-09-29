import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inDepot, isParked, noteStand, PARKED_AFTER_S_BY_MODE } from '../../shared/motion/depots';
import { toPlane } from '../../shared/motion/geo';
import { newTrack, type PlaneFix, type Track, type VehicleKind } from '../../shared/motion/track';

// U0 (October 2026): a tram standing in a depot, or any vehicle standing
// longer than its mode ever lays over in service, stays in the twin and off
// the map. The depot boxes come from the stands over two hours on five
// normal days; the platforms nearest them must stay outside, or trams laying
// over at the Ljubljanica terminus would vanish from the map at once.

const stops = JSON.parse(readFileSync(new URL('../../app/public/data/stops.json', import.meta.url), 'utf8')) as { id: string; lon: number; lat: number }[];
const stop = (id: string) => stops.find((s) => s.id === id)!;

describe('inDepot', () => {
  it('holds the long stands of 22132 at Ljubljanica and 102297 at Dubrava (24 Sep)', () => {
    expect(inDepot(15.93944, 45.79649)).toBe(true);
    expect(inDepot(16.03859, 45.82078)).toBe(true);
  });

  it('leaves the Ljubljanica terminus platforms and the stop nearest Dubrava outside', () => {
    for (const id of ['245_1', '245_2', '245_12', '1135_22']) {
      const { lon, lat } = stop(id);
      expect(inDepot(lon, lat), id).toBe(false);
    }
  });
});

describe('the stand and the parked rule', () => {
  const origin = toPlane(15.98, 45.81);
  const fixAt = (dxM: number, atSec: number): PlaneFix => {
    const x = origin.x + dxM;
    const y = origin.y;
    // lon/lat only matter to inDepot; the stand is judged in the plane.
    return { x, y, lon: 15.98, lat: 45.81, atSec };
  };
  const standing = (kind: VehicleKind, seconds: number): Track => {
    const track = newTrack('v', '6', 't', kind);
    for (const at of [0, seconds]) {
      const fix = fixAt(0, 1_800_000_000 + at);
      track.fixes.push(fix);
      noteStand(track, fix);
    }
    return track;
  };

  it('keeps the stand over a 39 m step and begins a new one at 41 m from where it began', () => {
    const track = newTrack('v', '6', 't', 'tram');
    noteStand(track, fixAt(0, 100));
    expect(track.stand).toMatchObject({ sinceSec: 100 });
    noteStand(track, fixAt(39, 200));
    expect(track.stand).toMatchObject({ x: origin.x, sinceSec: 100 });
    noteStand(track, fixAt(41, 300));
    expect(track.stand).toMatchObject({ x: origin.x + 41, sinceSec: 300 });
  });

  it('parks a tram at 1 800 s and not at 1 799, a bus at 2 760 s and not at 2 759', () => {
    expect(PARKED_AFTER_S_BY_MODE).toEqual({ tram: 1800, bus: 2760 });
    expect(isParked(standing('tram', 1799))).toBe(false);
    expect(isParked(standing('tram', 1800))).toBe(true);
    expect(isParked(standing('bus', 2759))).toBe(false);
    expect(isParked(standing('bus', 2760))).toBe(true);
    expect(isParked(newTrack('v', '6', 't', 'tram'))).toBe(false);
  });
});
