// The frame's camera (seam S2's map half, WP2 step 4): a box of ground fitted
// to a field, and the square of side 2R around a place that "N stops around
// the place" measures (shared/city/frame.ts frameRadiusM). Pure, so a camera
// can be derived and tested in node; the kiosk's wall (kiosk/mapview.ts
// fieldView) and the phone's Karta (WP4's `frameAround` is frameView) read
// the same arithmetic.
import { EARTH_CIRCUMFERENCE_M } from './scale';

export interface LonLatBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Metres of ground per degree of latitude, as frameBounds lays out a radius. */
export const METRES_PER_DEGREE = 111_320;
/** The frame's default clearance, zoom floor and ceiling: the kiosk's CITY_WINDOW_PADDING_PX, FIELD_MIN_ZOOM and FIELD_MAX_ZOOM. */
export const FRAME_PADDING_PX = 24;
export const FRAME_MIN_ZOOM = 12.7;
export const FRAME_MAX_ZOOM = 15.5;

/** The camera that fits a lon/lat box in a widthPx x heightPx field with
 *  `paddingPx` of clearance on every side: the box's centre, and the zoom at
 *  which its ground fits -- one axis at a time, the tighter of the two
 *  winning, because a fit that honoured only the width would crop the top and
 *  the bottom off. Each axis is the inverse of metresPerPixel (map/scale.ts),
 *  the same arithmetic kiosk/mapview.ts fieldZoom states for a span; in Web
 *  Mercator a ground metre costs the same pixels north to south as east to
 *  west at a given latitude, so one metres-per-pixel serves both. Never past
 *  `maxZoom` and never below `minZoom`; a field not yet laid out (0 px) is
 *  minZoom, never NaN. */
export function boundsView(bounds: LonLatBounds, widthPx: number, heightPx: number, paddingPx: number, minZoom: number, maxZoom: number): { center: [number, number]; zoom: number } {
  const lat = (bounds.south + bounds.north) / 2;
  const across = EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180);
  const groundW = (across * (bounds.east - bounds.west)) / 360;
  const groundH = (EARTH_CIRCUMFERENCE_M * (bounds.north - bounds.south)) / 360;
  const axis = (px: number, groundM: number): number => Math.log2((across * Math.max(1, px - 2 * paddingPx)) / (512 * groundM));
  const fit = Math.min(axis(widthPx, groundW), axis(heightPx, groundH));
  return { center: [(bounds.west + bounds.east) / 2, lat], zoom: Math.min(maxZoom, Math.max(minZoom, Number.isFinite(fit) ? fit : minZoom)) };
}

/** The square of ground `radiusM` out from `center` on every side: 2R across
 *  and 2R up, in degrees at the centre's latitude. */
export function frameBounds(center: { lon: number; lat: number }, radiusM: number): LonLatBounds {
  const dLat = radiusM / METRES_PER_DEGREE;
  const dLon = radiusM / (METRES_PER_DEGREE * Math.cos((center.lat * Math.PI) / 180));
  return { west: center.lon - dLon, south: center.lat - dLat, east: center.lon + dLon, north: center.lat + dLat };
}

/** The frame's camera: the place at the centre, north up, and the zoom at
 *  which the whole square of side 2R fits the field's SHORTER side with the
 *  clearance (the tighter axis governs, so on a wide wall the frame's height
 *  is the field's and more ground shows east and west). The wall's 1250 x 870
 *  field frames 1300 / 2000 / 2700 m at z14.07 / 13.45 / 13.02; the compact
 *  wall's 794 x 610 clamps 2700 m to the floor, z12.7. */
export function frameView(
  center: { lon: number; lat: number },
  radiusM: number,
  widthPx: number,
  heightPx: number,
  paddingPx = FRAME_PADDING_PX,
  minZoom = FRAME_MIN_ZOOM,
  maxZoom = FRAME_MAX_ZOOM,
): { center: [number, number]; zoom: number } {
  const { zoom } = boundsView(frameBounds(center, radiusM), widthPx, heightPx, paddingPx, minZoom, maxZoom);
  return { center: [center.lon, center.lat], zoom };
}

/** The ground a placed wall presents (decision 58, 24 Sep): the circle of
 *  radius R round its place, R the "N stops around it" radius the camera,
 *  the "U blizini" circle and its pill read (shared/city/frame.ts). Nothing
 *  outside it is drawn as a stop, a BAJS disc, a venue or a name. */
export interface FrameCircle {
  lon: number;
  lat: number;
  radiusM: number;
}

/** Whether a point lies within the frame's radius, in the same metres per
 *  degree frameBounds lays the radius out with. */
export function inFrame(point: { lon: number; lat: number }, frame: FrameCircle): boolean {
  const dy = (point.lat - frame.lat) * METRES_PER_DEGREE;
  const dx = (point.lon - frame.lon) * METRES_PER_DEGREE * Math.cos((frame.lat * Math.PI) / 180);
  return dx * dx + dy * dy <= frame.radiusM * frame.radiusM;
}

/** The ids of the point features inside the frame, in source order: the
 *  stops a placed wall draws (map/city-map.ts hands them to the overlays). */
export function idsInFrame(features: readonly { geometry: { type?: string; coordinates: unknown }; properties: Record<string, unknown> }[], frame: FrameCircle): string[] {
  const out: string[] = [];
  for (const feature of features) {
    const c = feature.geometry.coordinates;
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    if (inFrame({ lon: c[0] as number, lat: c[1] as number }, frame)) out.push(String(feature.properties.id ?? ''));
  }
  return out;
}
