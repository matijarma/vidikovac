// The one dependency-free geo helper (plan T3.2, fix round 1): the
// great-circle (haversine) distance between two lon/lat points, and the
// degree-to-radian step it needs. `core/mobility.ts`'s `nearestStation`
// (core/ must not depend on experience/) and `experience/text.ts`'s
// `distanceKm` (every other consumer's public name for the same formula)
// both import it from here rather than each carrying their own copy: two
// independent haversine implementations would silently diverge the moment
// either is tuned (an ellipsoid correction, a different Earth radius), and
// review flagged exactly that risk. One implementation, one constant.
const EARTH_RADIUS_KM = 6371;

export function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two lon/lat points, in kilometres. */
export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
