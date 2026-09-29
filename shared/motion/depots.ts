// Vehicles the twin keeps but does not publish (U0 of the October 2026
// round): a tram standing inside one of the two tram depots, and any vehicle
// that has stood in one place longer than its mode ever lays over in service.
// ZET sends every vehicle with a trip (0 of 10,582 reports on 24 Sep had
// none), so "it has a trip" says nothing about service; on a normal Thursday
// 44 vehicles stood over 30 minutes and 8 over two hours. Such a vehicle stays
// in the twin's state with its history, and its first fix more than
// STOP_ZONE_M away publishes it again. Whether a vehicle ought to be moving is
// the expectation layer's question, not this one's.

import { dist } from './geo';
import { STOP_ZONE_M } from './speed';
import { lastFix, type PlaneFix, type Track, type VehicleKind } from './track';

/** Standing time after which a vehicle is parked, by mode, in seconds. The
 *  longest scheduled terminus layover of feed 000395 over five weekdays is
 *  22.7 min for a tram (p99 14.2) and 113.5 min for a bus (p99 40.2): a tram
 *  at 30 min, a bus at its p99 plus five, 46 min. */
export const PARKED_AFTER_S_BY_MODE: Record<VehicleKind, number> = { tram: 1800, bus: 2760 };

/** A depot as a box in degrees plus a margin in metres around it. */
export interface Depot {
  name: string;
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
  marginM: number;
}

/** The two tram depots, measured from the stands over two hours on five
 *  normal days (26 stands by 19 vehicles at Dubrava, 6 by 5 at Ljubljanica).
 *  Dubrava's nearest stop is 237 m from its box, so 60 m is safe; the
 *  Ljubljanica terminus platforms lie 82 to 89 m from its box, so its margin
 *  stays under 30 m or trams laying over there would vanish. No bus garage
 *  appears: buses leave the feed during their long breaks, and the twin
 *  evicts them after EVICT_S. */
export const DEPOTS: readonly Depot[] = [
  { name: 'Dubrava', minLat: 45.81971, minLon: 16.03815, maxLat: 45.82114, maxLon: 16.04175, marginM: 60 },
  { name: 'Ljubljanica', minLat: 45.79587, minLon: 15.93776, maxLat: 45.79649, maxLon: 15.93944, marginM: 25 },
];

/** Metres per degree of latitude; a degree of longitude is this times the
 *  cosine of the latitude. */
const M_PER_DEG = 111_320;

/** Is the position within its margin of a depot box (the box itself, or at
 *  most `marginM` metres from its nearest edge or corner)? */
export function inDepot(lon: number, lat: number): boolean {
  const mPerDegLon = M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  for (const depot of DEPOTS) {
    const dLon = Math.max(depot.minLon - lon, 0, lon - depot.maxLon) * mPerDegLon;
    const dLat = Math.max(depot.minLat - lat, 0, lat - depot.maxLat) * M_PER_DEG;
    if (Math.hypot(dLon, dLat) <= depot.marginM) return true;
  }
  return false;
}

/** Folds a fresh fix into the vehicle's stand: a new stand at the fix when
 *  there is none or the fix lies more than STOP_ZONE_M from where the stand
 *  began; otherwise the stand goes on. Stand time is fix time, so a frozen
 *  feed parks nobody. */
export function noteStand(track: Track, fix: PlaneFix): void {
  if (track.stand === null || dist(track.stand, fix) > STOP_ZONE_M) track.stand = { x: fix.x, y: fix.y, sinceSec: fix.atSec };
}

/** Has the vehicle stood at its stand for its mode's limit or longer, by its
 *  own report times? */
export function isParked(track: Track): boolean {
  const last = lastFix(track);
  return track.stand !== null && last !== null && last.atSec - track.stand.sinceSec >= PARKED_AFTER_S_BY_MODE[track.kind];
}
