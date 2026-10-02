// Where the stage's camera looks (snimka v3, decision V3-13). The passive
// frame is the whole tram network: networkBounds() over the decoded
// artefact's tram shapes, networkFrame() the camera that shows it with a
// margin, computed once per box size (map-layer.ts) and never moved by the
// size of the fleet. A vehicle outside that frame is said, not chased: the
// edge marker (edgeMarkerFor) stands on the map's edge toward the nearest
// off-frame vehicle with "→ {n} vozila izvan kadra". The v2 small-fleet
// fit (fitDecision, cameraFor's band) stays here as pure arithmetic: the
// pill rule still uses SMALL_FLEET_MAX, and cameraFor frames the network.
// Pure arithmetic in Web Mercator with MapLibre's 512 px tiles; the map
// does the easing.
import type { Network } from '../../../shared/motion/network';
import { toLonLat } from '../../../shared/motion/geo';
import { ROUTE_TYPE_TRAM } from '../motion/schematic';

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

// ---- the passive frame: the whole tram network (V3-13) ---------------------------------------------------

/** CSS px kept clear around the network in the passive frame: a terminus pill is a pill, not a sliver. */
export const NETWORK_FRAME_PADDING_PX = 24;
/** The frame never goes further out than this (the artefact's outliers, a depot run, never pull the city small). */
export const NETWORK_FRAME_MIN_ZOOM = 10.5;

/** The lon/lat envelope of the tram network: every point of every normal shape of a tram route (shared/motion/
 *  network.ts `main`, else all of the route's shapes); null when the artefact has no tram geometry. */
export function networkBounds(net: Pick<Network, 'routes' | 'shapes'>): LonLatBounds | null {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const route of net.routes.values()) {
    if (route.type !== ROUTE_TYPE_TRAM) continue;
    const shapes = route.main && route.main.length > 0 ? route.main : route.shapes;
    for (const idx of shapes) {
      for (const p of net.shapes[idx]?.pts ?? []) {
        const [lon, lat] = toLonLat(p);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        if (lon < west) west = lon;
        if (lon > east) east = lon;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
    }
  }
  return Number.isFinite(west) && Number.isFinite(north) ? { west, south, east, north } : null;
}

/** The passive frame for a box: the network with NETWORK_FRAME_PADDING_PX clear, never closer than `maxZoom`
 *  (the stage's opening zoom) and never further out than NETWORK_FRAME_MIN_ZOOM. */
export function networkFrame(bounds: LonLatBounds, width: number, height: number, maxZoom: number): { center: [number, number]; zoom: number } {
  return cameraFor(bounds, width, height, { paddingPx: NETWORK_FRAME_PADDING_PX, minZoom: NETWORK_FRAME_MIN_ZOOM, maxZoom });
}

// ---- the edge marker: a vehicle outside the frame (V3-13) --------------------------------------------------

/** The marker's centre sits this far inside the map's edge. */
export const EDGE_INSET_PX = 14;
export interface EdgeMarker { count: number; x: number; y: number; angle: number }

/**
 * The one marker for the vehicles outside a `width` by `height` box (CSS px from the box's top left): how many
 * are outside, where on the inset edge the marker stands (on the ray from the centre to the nearest off-frame
 * vehicle, the one a viewer would reach first), and the ray's angle in degrees (0 = right, 90 = down). Null when
 * every vehicle is inside, or when there is none.
 */
export function edgeMarkerFor(points: readonly { x: number; y: number }[], width: number, height: number, inset = EDGE_INSET_PX): EdgeMarker | null {
  const cx = width / 2;
  const cy = height / 2;
  let count = 0;
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height) continue;
    count += 1;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best) return null;
  const dx = best.x - cx;
  const dy = best.y - cy;
  const halfW = Math.max(1, cx - inset);
  const halfH = Math.max(1, cy - inset);
  // The ray leaves the inset box on whichever side it meets first.
  const t = Math.min(dx === 0 ? Infinity : halfW / Math.abs(dx), dy === 0 ? Infinity : halfH / Math.abs(dy));
  return { count, x: cx + dx * t, y: cy + dy * t, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}
