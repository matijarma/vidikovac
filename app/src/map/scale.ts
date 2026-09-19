// Ground per pixel, for every layer that states a size in metres and every
// camera that derives a zoom from a span (kiosk/mapview.ts fieldZoom). Pure,
// so a layer spec can be built and tested in node.

/** Metres of equator per tile row, as MapLibre counts (512 px tiles). */
export const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

/** Metres per CSS pixel at a zoom and latitude, on the 512 px tiles MapLibre
 *  counts in: the equator's circumference over 512 x 2^zoom, shrunk by the
 *  latitude's cosine. At Zagreb's latitude (shared/motion/geo.ts) that is
 *  0.83 m/px at zoom 16, 0.42 at 17 and 0.21 at 18, so a 32 m tram body
 *  (shared/motion/vehicle.ts) is 38, 77 and 154 px long there, against a
 *  24 px two-character pill. */
export function metresPerPixel(zoom: number, lat: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}
