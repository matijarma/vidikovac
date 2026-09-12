// One map component for the whole app: an open raster basemap with the
// motion model's vehicles as SDF icons, places (quake epicentres) as circles
// and closures as lines.
//
// The rule of area T holds here exactly as it does on the schematic (R-P2):
// a reported vehicle position is evidence, never output. A vehicle point
// handed to this map goes into the motion model as a Fix; what the GeoJSON
// source receives is the model's own estimate, stepped at the screen's
// refresh rate and pushed to MapLibre at 12 Hz. Nothing in this file ever
// writes a reported vehicle coordinate into a source.
//
// PRODUCTION NOTE: tile.openstreetmap.org is the OSMF community tile server. Its
// tile usage policy forbids heavy or app-like traffic, so before any public
// screen runs unattended this URL must move to a provider with a usage policy
// that covers applications (MapTiler, Protomaps on our own R2, or a self-hosted
// renderer). The attribution line below stays whatever happens; only the URL and
// the extra provider credit change.
import { toLonLat } from '../motion/geo';
import { createLoop, type Loop } from '../motion/loop';
import { createModel, type Drawn, type Fix, type Model } from '../motion/model';
import type { Network } from '../motion/network';
import { project, tangent } from '../motion/polyline';
import { BUS_SIDE_PX, ROUTE_TYPE_TRAM, TRAM_LENGTH_PX, TRAM_WIDTH_PX } from '../motion/schematic';
import { SDF_PIXEL_RATIO, sdfRectangle } from './sdf';

export const OSM_RASTER_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
/** [lon, lat], GeoJSON order, Trg bana Jelačića. */
export const ZAGREB_CENTER: [number, number] = [15.98, 45.815];

// --- Modrotisak on the map (R-O1): these three, here and nowhere else. ---
/** Closures: the spec's warning rose, legible over the pale raster. */
export const CLOSURE_INK = '#ff9d9d';
/** Vehicles and places: the cream the whole product draws its marks in. */
export const VEHICLE_INK = '#f2ead8';
/** Every outline -- icon halo, circle stroke, closure casing: the indigo ink. */
export const STROKE_INK = '#16226b';

/** How often the vehicle source is handed to MapLibre. `setData` on a
 *  GeoJSON source costs 1.5 to 3 ms (plan measurement, 12 September) --
 *  at 60 Hz that is up to a fifth of every frame budget spent re-tiling
 *  the same few hundred points, for motion of well under a pixel per frame
 *  at any city zoom (a 10 m/s tram at zoom 16 moves 0.35 px per 83 ms).
 *  Twelve a second keeps the motion continuous to the eye and leaves the
 *  frame budget to MapLibre's own render. The model still steps every
 *  frame, so a push always carries the estimate for *now*. */
export const SOURCE_UPDATE_HZ = 12;
const SOURCE_UPDATE_INTERVAL_MS = 1000 / SOURCE_UPDATE_HZ;
/** A frame that lands within a millisecond of the 12 Hz grid is that tick:
 *  60 Hz frames (16.67 ms) meet an 83.33 ms grid exactly every fifth frame
 *  only up to floating-point noise. */
const PUSH_TOLERANCE_MS = 1;

/** Icon opacity floor: a vehicle the model is unsure of (a single fix, a
 *  free-plane guess) still has to be visible -- the same floor T7's marks
 *  use on the schematic, so both renderers read alike. */
const MIN_ICON_ALPHA = 0.55;

export interface MapPoint {
  id: string;
  lon: number;
  lat: number;
  title: string;
  routeId?: string;
  /** Epoch ms of the report. A point that carries `at` is a vehicle's
   *  reported position: evidence for the motion model (R-P2), never drawn
   *  where reported. A point without one is a place (a quake epicentre)
   *  and is drawn where given. */
  at?: number;
  tripId?: string;
  /** GTFS route_type off the wire (zet-rt.ts's routeType). */
  type?: number;
}

export interface MapLine {
  id: string;
  title: string;
  coordinates: [number, number][];
}

export interface OsmStyle {
  version: 8;
  sources: { osm: { type: 'raster'; tiles: string[]; tileSize: 256; attribution: string } };
  layers: { id: 'osm'; type: 'raster'; source: 'osm' }[];
}

export function osmStyle(): OsmStyle {
  return {
    version: 8,
    sources: {
      osm: { type: 'raster', tiles: [OSM_RASTER_URL], tileSize: 256, attribution: OSM_ATTRIBUTION },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  };
}

export interface PointFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: { id: string; title: string; routeId?: string };
  }[];
}

export interface LineFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    properties: { id: string; title: string };
  }[];
}

export interface VehicleFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: {
      id: string;
      icon: 'vehicle-tram' | 'vehicle-bus';
      /** Degrees clockwise from north, the `icon-rotate` convention. */
      bearing: number;
      /** Confidence carried as opacity, floored at MIN_ICON_ALPHA. */
      alpha: number;
    };
  }[];
}

export const isVehicleReport = (p: MapPoint): boolean => p.at !== undefined;

/** Places only: a vehicle report never reaches a drawn source (R-P2). */
export function pointsToGeoJson(points: readonly MapPoint[]): PointFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points
      .filter((p) => !isVehicleReport(p) && Number.isFinite(p.lon) && Number.isFinite(p.lat))
      .map((p) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] as [number, number] },
        properties: p.routeId === undefined ? { id: p.id, title: p.title } : { id: p.id, title: p.title, routeId: p.routeId },
      })),
  };
}

export function linesToGeoJson(lines: readonly MapLine[]): LineFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: lines
      .filter((l) => l.coordinates.length >= 2 && l.coordinates.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat)))
      .map((l) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: l.coordinates },
        properties: { id: l.id, title: l.title },
      })),
  };
}

/** The vehicle reports among `points`, as the model's evidence. */
export function pointsToFixes(points: readonly MapPoint[]): Fix[] {
  const fixes: Fix[] = [];
  for (const p of points) {
    if (p.at === undefined || !Number.isFinite(p.lon) || !Number.isFinite(p.lat)) continue;
    fixes.push({ id: p.id, lon: p.lon, lat: p.lat, at: p.at, tripId: p.tripId, routeId: p.routeId, type: p.type });
  }
  return fixes;
}

/** Direction a tram icon lies along, mirroring schematic.ts's tramDirection:
 *  the model's heading when it has one; else the track's tangent at the
 *  drawn position (the rails are known even when the facing is not); else
 *  nothing, and the icon stays unrotated. */
function tramDirection(net: Network | null, v: Drawn): { x: number; y: number } | null {
  if (v.heading) return v.heading;
  if (v.onShape === null || !net) return null;
  const shape = net.shapes[v.onShape];
  if (!shape || shape.pts.length < 2) return null;
  return tangent(shape.pts, shape.cum, project(shape.pts, shape.cum, v.p).s);
}

/** Plane direction (x east, y north) to compass degrees clockwise from north. */
function bearingOf(dir: { x: number; y: number } | null): number {
  if (!dir) return 0;
  const deg = (Math.atan2(dir.x, dir.y) * 180) / Math.PI;
  return Math.round(((deg % 360) + 360) % 360);
}

/**
 * The model's output as the vehicle source: one feature per vehicle that is
 * not stale, at the model's own position (R-P2), with the icon for its
 * shape, its bearing and its confidence as alpha.
 */
export function vehiclesToGeoJson(drawn: readonly Drawn[], net: Network | null): VehicleFeatureCollection {
  const features: VehicleFeatureCollection['features'] = [];
  for (const v of drawn) {
    if (v.stale) continue;
    const tram = v.type === ROUTE_TYPE_TRAM;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: toLonLat(v.p) },
      properties: {
        id: v.id,
        icon: tram ? 'vehicle-tram' : 'vehicle-bus',
        bearing: tram ? bearingOf(tramDirection(net, v)) : 0,
        alpha: MIN_ICON_ALPHA + (1 - MIN_ICON_ALPHA) * Math.min(1, Math.max(0, v.confidence)),
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Coarse enough that convergence noise never keeps the loop awake, fine
 *  enough (a centimetre, a degree, a hundredth of alpha) that real motion
 *  always registers -- the same discipline as the schematic's signature. */
function signatureOf(fc: VehicleFeatureCollection): string {
  return fc.features
    .map((f) => `${f.properties.id}:${f.geometry.coordinates[0].toFixed(7)},${f.geometry.coordinates[1].toFixed(7)},${f.properties.bearing},${f.properties.alpha.toFixed(2)}`)
    .join('|');
}

export interface CityMapOptions {
  container: HTMLElement;
  ariaLabel: string;
  points?: MapPoint[];
  lines?: MapLine[];
  reducedMotion?: boolean;
  /** The network artefact for the motion model (route geometry to snap
   *  to). Absent, every vehicle free-planes -- still the model's motion,
   *  never a jump onto a report. A page passes the same memoised loader its
   *  schematic uses so the artefact is fetched once (R-L4). */
  loadNetwork?: () => Promise<Network | null>;
}

export interface CityMapHandle {
  update(points: MapPoint[], lines: MapLine[]): void;
  destroy(): void;
}

// Contract: installed maplibre-gl is ^5 (GHSA-jrc7-96c5-q579, a sanitizer XSS
// bypass fixed only in 6.9.0+ — tracked as a separate major-version upgrade,
// not done here). Until that upgrade lands, no caller of a MapFactory may pass
// feed-derived (external) text into a MapLibre Popup or marker HTML; this
// wrapper itself only ever hands MapLibre the static OSM_ATTRIBUTION string.
export type MapFactory = (options: CityMapOptions) => CityMapHandle;

/** Binds a network loader into a factory, so a page's map slots and its
 *  schematic share one artefact fetch. `undefined` in stays `undefined` out. */
export function withNetwork(factory: MapFactory | undefined, loadNetwork: () => Promise<Network | null>): MapFactory | undefined {
  return factory && ((options) => factory({ ...options, loadNetwork }));
}

/** The slice of MapLibre this wrapper drives; maplibre-entry.ts exports it. */
type MaplibreModule = typeof import('./maplibre-entry');

/** Injectable internals: the library import (never loaded under test), and
 *  the loop's own clock and frame primitive (motion/loop.ts's LoopDeps). */
export interface CityMapDeps {
  loadMaplibre?: () => Promise<MaplibreModule>;
  raf?: (cb: (t: number) => void) => number;
  cancel?: (h: number) => void;
  now?: () => number;
}

export function createCityMap(options: CityMapOptions, deps: CityMapDeps = {}): CityMapHandle {
  const { container } = options;
  const now = deps.now ?? (() => Date.now());
  const loadMaplibre = deps.loadMaplibre ?? (() => import('./maplibre-entry'));
  let points = options.points ?? [];
  let lines = options.lines ?? [];
  let disposed = false;
  let net: Network | null = null;
  let model: Model | null = null;
  let applyStatic: (() => void) | null = null;
  let pushVehicles: ((fc: VehicleFeatureCollection) => void) | null = null;
  let destroyMap: (() => void) | null = null;
  let lastPushedSignature = '';
  let nextPushAt = -Infinity;

  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', options.ariaLabel);

  function draw(t: number): boolean {
    // Detached (the dashboard swapped layers and took the panel along):
    // paint nothing, report no change, let the loop park; the next render's
    // update() nudges it awake.
    if (!model || !pushVehicles || !container.isConnected) return false;
    const fc = vehiclesToGeoJson(model.step(t), net);
    container.dataset.frames = String(loop.frames());
    const signature = signatureOf(fc);
    const changed = signature !== lastPushedSignature;
    if (changed && t >= nextPushAt - PUSH_TOLERANCE_MS) {
      pushVehicles(fc);
      lastPushedSignature = signature;
      // Stay on the 12 Hz grid while frames keep coming; re-anchor after a
      // park, when the old grid is long behind us.
      nextPushAt = nextPushAt + SOURCE_UPDATE_INTERVAL_MS > t ? nextPushAt + SOURCE_UPDATE_INTERVAL_MS : t + SOURCE_UPDATE_INTERVAL_MS;
    }
    return changed;
  }

  const loop: Loop = createLoop(draw, { raf: deps.raf, cancel: deps.cancel, now, reducedMotion: options.reducedMotion });

  void (async () => {
    // Both arrive after first paint; the model wants the geometry from its
    // first step, so the two waits run side by side. loadNetwork() resolves
    // null on failure by its own contract; a loader that throws anyway
    // degrades to the same honest state (free-plane motion), not a crash.
    const [lib, loaded] = await Promise.all([loadMaplibre(), options.loadNetwork ? options.loadNetwork().catch(() => null) : Promise.resolve(null)]);
    if (disposed) return;
    net = loaded;
    model = createModel(net);
    model.update(pointsToFixes(points), now());
    const map = new lib.Map({
      container,
      style: osmStyle() as never,
      center: ZAGREB_CENTER,
      zoom: 12,
      attributionControl: false,
      fadeDuration: options.reducedMotion ? 0 : 300,
    });
    map.addControl(new lib.AttributionControl({ compact: false, customAttribution: OSM_ATTRIBUTION }));
    map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
    destroyMap = () => map.remove();

    map.on('load', () => {
      // T7's mark sizes, so the two renderers agree on what a tram and a bus look like.
      map.addImage('vehicle-tram', sdfRectangle(TRAM_LENGTH_PX, TRAM_WIDTH_PX), { sdf: true, pixelRatio: SDF_PIXEL_RATIO });
      map.addImage('vehicle-bus', sdfRectangle(BUS_SIDE_PX, BUS_SIDE_PX), { sdf: true, pixelRatio: SDF_PIXEL_RATIO });
      map.addSource('closures', { type: 'geojson', data: linesToGeoJson(lines) as never });
      map.addSource('places', { type: 'geojson', data: pointsToGeoJson(points) as never });
      map.addSource('vehicles', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as never });
      map.addLayer({
        id: 'closures-casing',
        type: 'line',
        source: 'closures',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 6, 'line-color': STROKE_INK },
      });
      map.addLayer({
        id: 'closures',
        type: 'line',
        source: 'closures',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 4, 'line-color': CLOSURE_INK },
      });
      map.addLayer({
        id: 'places',
        type: 'circle',
        source: 'places',
        paint: { 'circle-radius': 5, 'circle-color': VEHICLE_INK, 'circle-stroke-width': 1.5, 'circle-stroke-color': STROKE_INK },
      });
      map.addLayer({
        id: 'vehicles',
        type: 'symbol',
        source: 'vehicles',
        layout: {
          'icon-image': ['get', 'icon'],
          // The tram image lies along its own x axis (east-west at rest), and
          // `bearing` is compass degrees clockwise from north: a north-bound
          // tram must turn 90 degrees anticlockwise from that to stand upright.
          'icon-rotate': ['-', ['get', 'bearing'], 90],
          'icon-rotation-alignment': 'map',
          // Every vehicle is drawn; none is hidden by MapLibre's collision
          // pass -- two trams at one stop are two trams, not one.
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-padding': 0,
        },
        paint: { 'icon-color': VEHICLE_INK, 'icon-halo-color': STROKE_INK, 'icon-halo-width': 1, 'icon-opacity': ['get', 'alpha'] },
      });
      const source = (id: string) => map.getSource(id) as { setData(d: unknown): void } | undefined;
      applyStatic = () => {
        source('places')?.setData(pointsToGeoJson(points));
        source('closures')?.setData(linesToGeoJson(lines));
      };
      pushVehicles = (fc) => source('vehicles')?.setData(fc);
      loop.start();
    });
  })();

  return {
    update(nextPoints, nextLines) {
      points = nextPoints;
      lines = nextLines;
      // Evidence in, motion out: the model folds the reports into each
      // vehicle's own history and the loop draws where it says. Places and
      // closures do not move and are re-set at once.
      model?.update(pointsToFixes(points), now());
      applyStatic?.();
      loop.nudge();
    },
    destroy() {
      disposed = true;
      loop.stop();
      applyStatic = null;
      pushVehicles = null;
      destroyMap?.();
    },
  };
}
