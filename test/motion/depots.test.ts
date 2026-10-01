import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BED_ARRIVE_M, inDepot, isInBed, isParked, noteStand, PARKED_AFTER_S_BY_MODE, reachedLastPlatform } from '../../shared/motion/depots';
import { STOP_ZONE_M } from '../../shared/motion/speed';
import { corridorSpec, syntheticNetwork } from './synthetic-network';
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

// A pull-in (shared/city/depot-run.ts) at its last platform has set down its
// last passenger: from there the tram is in bed and off the map while it
// keeps that trip, whether it rolls on into the yard or goes silent where it
// stands (102105, 1 Oct 17:28 at Ljubljanica). A new trip wakes it.
describe('the pull-in bed', () => {
  const net = syntheticNetwork(corridorSpec());
  // Path 2's last platform, D900, lies at 2,400 m: the rails beyond it are the terminus loop's run-out.
  const last = net.stopsOnPath(2).at(-1)!;
  const far = { x: last.stop.p.x + 500, y: last.stop.p.y + 500 };

  it('is reached on the trip own path at the last platform zone, and anywhere within BED_ARRIVE_M of it', () => {
    expect(reachedLastPlatform(net, 2, { pathIdx: 2, s: last.s - STOP_ZONE_M }, far)).toBe(true);
    expect(reachedLastPlatform(net, 2, { pathIdx: 2, s: last.s + 200 }, far)).toBe(true);
    expect(reachedLastPlatform(net, 2, { pathIdx: 2, s: last.s - STOP_ZONE_M - 1 }, far)).toBe(false);
    expect(reachedLastPlatform(net, 2, { pathIdx: null, s: 0 }, { x: last.stop.p.x + BED_ARRIVE_M - 1, y: last.stop.p.y })).toBe(true);
    expect(reachedLastPlatform(net, 2, { pathIdx: null, s: 0 }, { x: last.stop.p.x + BED_ARRIVE_M + 1, y: last.stop.p.y })).toBe(false);
  });

  it('holds while the tram keeps the pull-in, and a new trip wakes it', () => {
    const track = newTrack('102105', '5', 'pull-in', 'tram');
    expect(isInBed(track)).toBe(false);
    track.bedTripId = 'pull-in';
    expect(isInBed(track)).toBe(true);
    track.tripId = 'first-of-the-block';
    expect(isInBed(track)).toBe(false);
  });
});
