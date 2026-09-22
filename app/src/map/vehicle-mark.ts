// What every mark of one vehicle shares, whichever layer draws it -- the pill
// and the dot (city-map.ts's vehicle source) and the body under them
// (motion/bodies.ts): the kind its GTFS route type makes it, and its
// confidence as opacity. Its own module so the body builder needs nothing
// from city-map.ts, which imports it.
import { ROUTE_TYPE_BUS, ROUTE_TYPE_TRAM } from '../motion/schematic';

export type VehicleKind = 'tram' | 'bus' | 'other';

export function vehicleKind(type: number): VehicleKind {
  return type === ROUTE_TYPE_TRAM ? 'tram' : type === ROUTE_TYPE_BUS ? 'bus' : 'other';
}

/** Icon opacity floor: a vehicle the model is unsure of (a single fix, a
 *  free-plane guess, a tram fading through its silence) still has to be
 *  visible -- the same floor the schematic uses, so both renderers read
 *  alike. A silent vehicle's confidence falls linearly to 0 at EVICT_S
 *  (180 s, T8), where the integrator drops it: it never lingers at the
 *  floor, it fades to it and leaves. */
export const MIN_ICON_ALPHA = 0.55;

/** The model's confidence (0 to 1) as the alpha every mark of the vehicle carries. */
export function markAlpha(confidence: number): number {
  return MIN_ICON_ALPHA + (1 - MIN_ICON_ALPHA) * Math.min(1, Math.max(0, confidence));
}
