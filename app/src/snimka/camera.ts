// Where the stage's camera looks when the fleet is small. The replay opens
// on the inner city (map-layer.ts STAGE_ZOOM), which is right for a normal
// morning of two hundred vehicles and wrong for the strike's first morning,
// when the one tram that ran is the story and stood outside that view. So,
// on load and on a seek while paused, when at most SMALL_FLEET_MAX vehicles
// are drawn and none of them is inside the view, the camera eases to fit
// them, between FIT_MIN_ZOOM and FIT_MAX_ZOOM; a normal fleet keeps today's
// view, and a reader who moved the map keeps their own. Pure arithmetic in
// Web Mercator with MapLibre's 512 px tiles; the map does the easing.

export type LonLat = readonly [lon: number, lat: number];
export interface LonLatBounds { west: number; south: number; east: number; north: number }

/** A fleet this small gets the camera's help; from the first tram back on Wednesday evening the view is the city's. */
export const SMALL_FLEET_MAX = 12;
/** The zoom band of a fit: never further out than the whole network, never closer than the opening view. */
export const FIT_MIN_ZOOM = 11.5;
export const FIT_MAX_ZOOM = 12.6;
/** CSS px kept clear around the fitted vehicles, so a pill at the edge is a pill, not a sliver. */
export const FIT_PADDING_PX = 72;

const TILE_PX = 512;
const MAX_LAT = 85.05112878;

/** Lon/lat to Web Mercator in world units (0..1), as MapLibre lays its 512 px tiles. */
export function toWorld([lon, lat]: LonLat): { x: number; y: number } {
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return { x: (lon + 180) / 360, y: (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2 };
}

export function fromWorld(x: number, y: number): [number, number] {
  const n = Math.PI - 2 * Math.PI * y;
  return [x * 360 - 180, (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))];
}

/** The lon/lat box a camera shows on a canvas of `width` by `height` CSS px. */
export function viewBounds(center: LonLat, zoom: number, width: number, height: number): LonLatBounds {
  const scale = TILE_PX * 2 ** zoom;
  const c = toWorld(center);
  const halfW = width / 2 / scale;
  const halfH = height / 2 / scale;
  const [west, north] = fromWorld(c.x - halfW, c.y - halfH);
  const [east, south] = fromWorld(c.x + halfW, c.y + halfH);
  return { west, south, east, north };
}

export function inBounds([lon, lat]: LonLat, b: LonLatBounds): boolean {
  return lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
}

export type FitDecision =
  | { fit: false; reason: 'none' | 'many' | 'inView' | 'userMoved' }
  | { fit: true; bounds: LonLatBounds };

/**
 * Whether the camera should go to the fleet: yes when there are vehicles, no more than `maxFleet` of them, none
 * inside the view, and the reader has not moved the map; then their envelope. Order of the reasons: a reader's own
 * move wins over everything, an empty fleet gives the camera nothing to find, a normal fleet keeps the view, and a
 * fleet already on screen needs no help.
 */
export function fitDecision(points: readonly LonLat[], view: LonLatBounds, userMoved: boolean, maxFleet = SMALL_FLEET_MAX): FitDecision {
  if (userMoved) return { fit: false, reason: 'userMoved' };
  const finite = points.filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  if (finite.length === 0) return { fit: false, reason: 'none' };
  if (finite.length > maxFleet) return { fit: false, reason: 'many' };
  if (finite.some((p) => inBounds(p, view))) return { fit: false, reason: 'inView' };
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lon, lat] of finite) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { fit: true, bounds: { west, south, east, north } };
}

export interface FitOptions { paddingPx?: number; minZoom?: number; maxZoom?: number }

/** The camera that shows `bounds` with `paddingPx` clear on every side of a `width` by `height` canvas, its zoom held inside the band. */
export function cameraFor(bounds: LonLatBounds, width: number, height: number, o: FitOptions = {}): { center: [number, number]; zoom: number } {
  const pad = o.paddingPx ?? FIT_PADDING_PX;
  const minZoom = o.minZoom ?? FIT_MIN_ZOOM;
  const maxZoom = o.maxZoom ?? FIT_MAX_ZOOM;
  const sw = toWorld([bounds.west, bounds.south]);
  const ne = toWorld([bounds.east, bounds.north]);
  const dx = Math.abs(ne.x - sw.x);
  const dy = Math.abs(ne.y - sw.y);
  const innerW = Math.max(1, width - 2 * pad);
  const innerH = Math.max(1, height - 2 * pad);
  // The zoom at which the span fills the inner box: scale = inner / span, zoom = log2(scale / 512).
  const zoomX = dx > 0 ? Math.log2(innerW / dx / TILE_PX) : Infinity;
  const zoomY = dy > 0 ? Math.log2(innerH / dy / TILE_PX) : Infinity;
  const zoom = Math.max(minZoom, Math.min(maxZoom, Math.min(zoomX, zoomY)));
  const center = fromWorld((sw.x + ne.x) / 2, (sw.y + ne.y) / 2);
  return { center, zoom };
}
