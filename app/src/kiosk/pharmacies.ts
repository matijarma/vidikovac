// The City's on-duty pharmacies (worker/hitno/ljekarne.ts), nearest a stop
// first. A module of its own, beside the wall's panels in local.ts (which
// re-exports it), so that a surface needing only this list -- the phone's
// Sigurnost -- can read it without the wall's panel builders and strings
// (test/app/budget.test.ts).
import { LJEKARNE } from '../../../worker/hitno/ljekarne';
import type { ScreenStop } from '../core/contracts';
import { stopDistanceM } from './stops';

/** Approximate geocodes of the curated on-duty addresses (worker/hitno/ljekarne.ts),
 *  used to order the list by distance from the screen's stop, and by the map
 *  to place the nearest one; the distance itself is never printed. Because
 *  these are hand-entered and the published address is the exact part, the map
 *  draws a hollow ring rather than a filled pin and labels it with the address
 *  (map/overlays.ts, kiosk/mapview.ts). */
export const PHARMACY_POINTS: Readonly<Record<string, { lon: number; lat: number }>> = {
  'Trg bana J. Jelačića 3': { lon: 15.9776, lat: 45.8131 },
  'Ilica 291': { lon: 15.934, lat: 45.811 },
  'Ozaljska 1': { lon: 15.956, lat: 45.8025 },
  'Grižanska 4': { lon: 16.058, lat: 45.8235 },
  'Av. V. Holjevca 22': { lon: 15.977, lat: 45.783 },
  'Ljekarna ZEUS': { lon: 16.0275, lat: 45.8145 },
};

/** `label` is the City's own short handle for the unit, which for five of the
 *  six is a street address; `name` is what the place is called -- the operator,
 *  the only one of the two a person reads as a name on a map. */
export interface OnDutyPharmacy { label: string; name: string; address: string; hours: string; phoneDisplay: string | null; distanceM: number | null }

export function pharmaciesByDistance(stop: ScreenStop | null): OnDutyPharmacy[] {
  return LJEKARNE.map((p) => {
    const point = PHARMACY_POINTS[p.label];
    return { label: p.label, name: p.operator, address: p.address, hours: p.hours, phoneDisplay: p.phoneDisplay, distanceM: stop && point ? stopDistanceM(point, stop) : null };
  }).sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
}

export function nearestPharmacy(stop: ScreenStop | null): OnDutyPharmacy {
  return pharmaciesByDistance(stop)[0]!;
}
