// One map component for the whole app: the same-origin Protomaps v4 basemap
// (basemap.ts) with the motion model's vehicles as numbered pills, the route
// network and named stops from the GTFS artefact, closures as lines, places
// (quake epicentres) as circles, and one selection ring.
//
// The rule of area T holds here exactly as it does on the schematic (R-P2):
// a reported vehicle position is evidence, never output. A vehicle point
// handed to this map goes into the motion model as a Fix; what the GeoJSON
// source receives is the model's own estimate, stepped at the screen's
// refresh rate and pushed to MapLibre at 12 Hz. Nothing in this file ever
// writes a reported vehicle coordinate into a source.
//
// One MapLibre context per slot for the page's life (map-slots.ts): a poll
// hands in new evidence through update(); the camera, the selection, the
// followed vehicle and the theme all survive it. MapLibre and the style
// builder arrive through one dynamic import (maplibre-entry.ts), so the
// lightweight path never loads either (R-L2).
import type { ScreenStop } from '../core/contracts';
import { ZET_ROUTES } from '../data/routes';
import { toLonLat } from '../motion/geo';
import { createLoop, type Loop } from '../motion/loop';
import { createModel, type Drawn, type Fix, type Model } from '../motion/model';
import type { Network } from '../motion/network';
import { ROUTE_TYPE_BUS, ROUTE_TYPE_TRAM } from '../motion/schematic';
import { tr } from '../transport/strings';
import type { MapTheme, StyleLayerLike, StyleOp } from './basemap';
import type { OverlayOptions } from './overlays';
import { SDF_PIXEL_RATIO } from './sdf';

// --- Kept for callers: the first basemap was the OpenStreetMap community
// raster, whose usage policy forbids app traffic. The vector basemap
// (basemap.ts) replaced it and nothing in the app draws these any more. ---
export const OSM_RASTER_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const OSM_ATTRIBUTION_HTML = `<a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer" target="_blank">${OSM_ATTRIBUTION}</a>`;
/** [lon, lat], GeoJSON order, Trg bana Jelačića. */
export const ZAGREB_CENTER: [number, number] = [15.98, 45.815];
/** @deprecated The Modrotisak inks of the first map; the live palette is basemap.ts's overlayPalette(). */
export const CLOSURE_INK = '#ff9d9d';
/** @deprecated See CLOSURE_INK. */
export const VEHICLE_INK = '#f2ead8';
/** @deprecated See CLOSURE_INK. */
export const STROKE_INK = '#16226b';

export interface OsmStyle {
  version: 8;
  sources: { osm: { type: 'raster'; tiles: string[]; tileSize: 256; attribution: string } };
  layers: { id: 'osm'; type: 'raster'; source: 'osm' }[];
}

/** @deprecated The legacy raster style; createCityMap draws basemap.ts's vector style. */
export function osmStyle(): OsmStyle {
  return {
    version: 8,
    sources: { osm: { type: 'raster', tiles: [OSM_RASTER_URL], tileSize: 256, attribution: OSM_ATTRIBUTION } },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  };
}

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
/** A frame that lands within a millisecond of the 12 Hz grid is that tick. */
const PUSH_TOLERANCE_MS = 1;

/** Icon opacity floor: a vehicle the model is unsure of (a single fix, a
 *  free-plane guess) still has to be visible -- the same floor the schematic
 *  uses, so both renderers read alike. */
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

export type VehicleKind = 'tram' | 'bus' | 'other';

export interface VehicleFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: {
      id: string;
      icon: 'vehicle-tram' | 'vehicle-bus';
      kind: VehicleKind;
      /** The number on the front of the vehicle; '' when the route is unknown. */
      short: string;
      routeId: string;
      /** Degrees clockwise from north, the `icon-rotate` convention. */
      bearing: number;
      /** True when the model knows which way the vehicle faces (decision 5). */
      hasHeading: boolean;
      /** Confidence carried as opacity, floored at MIN_ICON_ALPHA. */
      alpha: number;
      /** Draw order: trams over buses, so a busy stop never buries a tram. */
      sort: number;
      held: boolean;
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

/** Plane direction (x east, y north) to compass degrees clockwise from north. */
export function bearingOf(dir: { x: number; y: number } | null | undefined): number {
  if (!dir) return 0;
  const deg = (Math.atan2(dir.x, dir.y) * 180) / Math.PI;
  return Math.round(((deg % 360) + 360) % 360);
}

export function vehicleKind(type: number): VehicleKind {
  return type === ROUTE_TYPE_TRAM ? 'tram' : type === ROUTE_TYPE_BUS ? 'bus' : 'other';
}

/** The number on the front of the vehicle: the network's own short name,
 *  else the static GTFS table's, else the route id itself; '' for a vehicle
 *  whose route nobody knows. */
export function vehicleLabel(v: { short?: string; routeId?: string }): string {
  if (v.short) return v.short;
  if (v.routeId === undefined) return '';
  return ZET_ROUTES[v.routeId]?.shortName || v.routeId;
}

/**
 * The model's output as the vehicle source: one feature per vehicle (the
 * model evicts what has gone quiet, R-F2, so everything it draws is fresh),
 * at the model's own position (R-P2), with its number, its facing when the
 * model knows it (decision 5: the nose is drawn only then; the bearing
 * otherwise follows the track so a tram's mark still lies along its rails)
 * and its confidence as alpha.
 */
export function vehiclesToGeoJson(drawn: readonly Drawn[]): VehicleFeatureCollection {
  const features: VehicleFeatureCollection['features'] = [];
  for (const v of drawn) {
    const kind = vehicleKind(v.type);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: toLonLat(v.p) },
      properties: {
        id: v.id,
        icon: kind === 'tram' ? 'vehicle-tram' : 'vehicle-bus',
        kind,
        short: vehicleLabel(v),
        routeId: v.routeId ?? '',
        bearing: bearingOf(v.heading ?? v.track),
        hasHeading: v.heading !== null,
        alpha: MIN_ICON_ALPHA + (1 - MIN_ICON_ALPHA) * Math.min(1, Math.max(0, v.confidence)),
        sort: kind === 'tram' ? 2 : 1,
        held: v.held === true,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

export interface NetworkFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    properties: { shape: number; route: string; short: string; kind: VehicleKind };
  }[];
}

/** Every shape of the artefact as one line, tagged with its route: the
 *  printed network under the vehicles, and what a selected route lights up. */
export function networkToGeoJson(net: Network): NetworkFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: net.shapes
      .filter((shape) => shape.pts.length >= 2)
      .map((shape, i) => {
        const route = net.routes.get(shape.route);
        return {
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: shape.pts.map(toLonLat) },
          properties: { shape: i, route: shape.route, short: route?.short ?? shape.route, kind: vehicleKind(route?.type ?? -1) },
        };
      }),
  };
}

export interface StopFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: {
      id: string;
      name: string;
      /** Routes whose shapes call here, in reading order. */
      routes: string[];
      /** How many: decides whose name wins a crowded corner. */
      rank: number;
      tram: boolean;
      bus: boolean;
      /** True on the one platform per name that carries the label. */
      label: boolean;
    };
  }[];
}

/** Every platform of the artefact, with the routes whose shapes call there,
 *  the modes among them (what a tram-only view keeps), a rank (how many) that
 *  decides whose label wins a crowded corner, and one labelled platform per
 *  name -- GTFS lists one platform per direction, and two labels reading
 *  "Kvaternikov trg" thirty metres apart is clutter, not information. */
export function stopsToGeoJson(net: Network): StopFeatureCollection {
  const rows = net.stops.map((stop) => {
    const routes = [...new Set(stop.on.map((on) => net.shapes[on.shape]?.route).filter((r): r is string => Boolean(r)))].sort((a, b) =>
      a.localeCompare(b, 'hr', { numeric: true }),
    );
    const types = routes.map((r) => net.routes.get(r)?.type);
    return { stop, routes, tram: types.includes(ROUTE_TYPE_TRAM), bus: types.includes(ROUTE_TYPE_BUS) };
  });
  const labelled = new Map<string, { id: string; rank: number }>();
  for (const { stop, routes } of rows) {
    const best = labelled.get(stop.name);
    if (!best || routes.length > best.rank || (routes.length === best.rank && stop.id < best.id)) labelled.set(stop.name, { id: stop.id, rank: routes.length });
  }
  return {
    type: 'FeatureCollection',
    features: rows.map(({ stop, routes, tram, bus }) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: toLonLat(stop.p) },
      properties: { id: stop.id, name: stop.name, routes, rank: routes.length, tram, bus, label: labelled.get(stop.name)?.id === stop.id },
    })),
  };
}

/** Coarse enough that convergence noise never keeps the loop awake, fine
 *  enough (a centimetre, a degree, a hundredth of alpha) that real motion
 *  always registers -- the same discipline as the schematic's signature. */
function signatureOf(fc: VehicleFeatureCollection): string {
  return fc.features
    .map((f) => `${f.properties.id}:${f.geometry.coordinates[0].toFixed(7)},${f.geometry.coordinates[1].toFixed(7)},${f.properties.bearing},${f.properties.hasHeading ? 1 : 0},${f.properties.alpha.toFixed(2)}`)
    .join('|');
}

/** What the map can have selected. Route and stop are the two kinds the
 *  public selection may relay to a paired screen (worker/public-selection.ts);
 *  a vehicle or a closure stays on the device that picked it. */
export type MapSelection =
  | { kind: 'route'; id: string }
  | { kind: 'stop'; id: string; ids?: readonly string[] }
  | { kind: 'vehicle'; id: string }
  | { kind: 'closure'; id: string };

/** loading: MapLibre not yet built. ready: drawing. tiles-failed: the
 *  basemap tiles are not answering while the overlays (network geometry,
 *  stops, vehicles, closures) still draw over the background -- they come
 *  from the artefact and the feed, not the tile service. unavailable: no
 *  WebGL, or the context was lost; the page should show its plain fallback. */
export type MapStatus = 'loading' | 'ready' | 'tiles-failed' | 'unavailable';

/** One vehicle as the model currently draws it, for lists and cards: the
 *  model's own estimate (R-P2), never a report. */
export interface VehicleInfo {
  id: string;
  routeId?: string;
  short: string;
  kind: VehicleKind;
  type: number;
  lon: number;
  lat: number;
  /** Compass degrees, or null when the model does not know the facing. */
  bearing: number | null;
  confidence: number;
  held: boolean;
  onShape: number | null;
}

export interface MapCamera {
  center: [number, number];
  zoom: number;
}

/** What a public screen asks of its one map (kiosk/mapview.ts's KioskMapView): every field optional. */
export interface MapView {
  center?: [number, number];
  zoom?: number;
  selectedRoute?: string;
  selectedStop?: string;
  follow?: boolean;
}

export interface CityMapOptions {
  container: HTMLElement;
  ariaLabel: string;
  points?: MapPoint[];
  lines?: MapLine[];
  reducedMotion?: boolean;
  /** The network artefact for the motion model (route geometry to snap
   *  to) and for the drawn network and stops. Absent, every vehicle
   *  free-planes -- still the model's motion, never a jump onto a report --
   *  and no network or stops are drawn. A page passes the same memoised
   *  loader its schematic uses so the artefact is fetched once (R-L4). */
  loadNetwork?: () => Promise<Network | null>;
  /** The page's clock-tick timer pair for the reduced-motion loop (R-F6,
   *  R-F12); bound by `withTimers`. Absent, the loop uses the globals. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;

  // --- Additive options; every one optional. The transport workspace and
  // a kiosk that mirrors a phone's route or stop use them. ---

  /** The face to draw. Absent, read from <html data-theme-resolved> at
   *  creation and followed live (theme.ts writes it for every preference). */
  theme?: MapTheme;
  /** The page's locale: decides the label language ('hr' by default). */
  locale?: string;
  /** The starting camera. Absent: the screen's stop when given, else the
   *  inner city; a map of places only (no vehicles) fits its places. */
  center?: [number, number];
  zoom?: number;
  /** What starts selected (a kiosk mirroring the phone's route or stop). */
  selection?: MapSelection | null;
  /** The kiosk adapter's shorthand for `selection`: a route id, or a stop id; the route wins when both are given. */
  selectedRoute?: string | null;
  selectedStop?: string | null;
  /** A vehicle id keeps the camera on that vehicle; `true` keeps the selected route's vehicles in frame. */
  follow?: string | boolean | null;
  /** The screen's own stop: marked and named on the map. */
  stop?: ScreenStop | null;
  /** GTFS route types drawn (0 trams, 3 buses); null, the default, is every type. */
  modes?: ReadonlySet<number> | null;
  /** false hides the closures until setClosuresVisible(true). */
  closures?: boolean;
  /** false: no pointer or keyboard handling and no controls (a public screen). */
  interactive?: boolean;
  /** Symbol and circle size multiplier: 1 on a phone or desk, more on a screen read from across a room. */
  symbolScale?: number;
  /** Pointer selection on the map: a vehicle, a stop, a closure, or nothing. */
  onSelect?: (selection: MapSelection | null) => void;
  onStatus?: (status: MapStatus) => void;
  /** The network artefact settled: the decoded network, or null when it could not load. */
  onNetwork?: (net: Network | null) => void;
  /** The person moved the camera themselves, which also ends a follow. */
  onUserMove?: (camera: MapCamera) => void;
}

export interface CityMapHandle {
  update(points: MapPoint[], lines: MapLine[]): void;
  /** Stops stepping the model and requesting frames (a frozen dashboard,
   *  R-F6). The map itself and the model's history stay; `resume()` picks
   *  the motion up again. */
  pause(): void;
  resume(): void;
  destroy(): void;

  // --- Additive; optional on the type so a page's stub factory (a test's
  // `{ update, destroy, pause }`) still satisfies it. createCityMap
  // implements every one. ---
  setTheme?(theme: MapTheme): void;
  setLocale?(locale: string): void;
  /** Selects (or clears with null) and, with `fit`, moves the camera to it. */
  select?(selection: MapSelection | null, options?: { fit?: boolean }): void;
  selection?(): MapSelection | null;
  /** A vehicle id keeps the camera on it, `true` keeps the selected route's vehicles in frame, until the person moves the map or `follow(null)`. */
  follow?(target: string | boolean | null): void;
  following?(): string | boolean | null;
  /** The kiosk adapter's view in one call: camera, selected route or stop, route follow. */
  setView?(view: MapView): void;
  /** After the container's box changed while it sat outside the layout. */
  resize?(): void;
  setModes?(modes: ReadonlySet<number> | null): void;
  setClosuresVisible?(visible: boolean): void;
  /** The feed's own state: anything but 'live' holds every vehicle where it is (an outage is no evidence of motion) until the feed is live again. */
  setFeedState?(state: 'live' | 'stale' | 'down'): void;
  setStop?(stop: ScreenStop | null): void;
  /** The inner city, the current selection, or the screen's stop. */
  fit?(target: 'city' | 'selection' | 'stop'): void;
  camera?(): MapCamera | null;
  status?(): MapStatus;
  network?(): Network | null;
  /** The vehicles as the model draws them right now. */
  vehicles?(): VehicleInfo[];
}

export type MapFactory = (options: CityMapOptions) => CityMapHandle;

/** Binds a network loader into a factory, so a page's map slots and its
 *  schematic share one artefact fetch. `undefined` in stays `undefined` out. */
export function withNetwork(factory: MapFactory | undefined, loadNetwork: () => Promise<Network | null>): MapFactory | undefined {
  return factory && ((options) => factory({ ...options, loadNetwork }));
}

/** Binds the page's timer pair into a factory, beside `withNetwork`, so the
 *  production factory ticks its reduced-motion loop on the pair the page
 *  injects rather than on the globals (R-F12). */
export function withTimers(factory: MapFactory | undefined, setTimer: (fn: () => void, ms: number) => unknown, clearTimer: (handle: unknown) => void): MapFactory | undefined {
  return factory && ((options) => factory({ ...options, setTimer, clearTimer }));
}

/** The slice of MapLibre and the style builder this wrapper drives; maplibre-entry.ts exports it. */
type MaplibreModule = typeof import('./maplibre-entry');

/** Injectable internals: the library import (never loaded under test), the
 *  loop's own clock and frame primitive (motion/loop.ts's LoopDeps), the
 *  origin the style's URLs resolve against and the document whose theme
 *  attribute is followed. */
export interface CityMapDeps {
  loadMaplibre?: () => Promise<MaplibreModule>;
  raf?: (cb: (t: number) => void) => number;
  cancel?: (h: number) => void;
  now?: () => number;
  origin?: string;
  documentRef?: Document;
}

/** The slice of a MapLibre Map this wrapper drives, structurally, so a test's stand-in stays small. */
interface MapApi {
  on(type: string, listener: (event: MapEventLike) => void): unknown;
  once(type: string, listener: (event: MapEventLike) => void): unknown;
  addControl(control: unknown, position?: string): unknown;
  getCanvas(): HTMLCanvasElement;
  addImage(id: string, image: { width: number; height: number; data: Uint8ClampedArray }, options?: Record<string, unknown>): void;
  hasImage?(id: string): boolean;
  addSource(id: string, spec: Record<string, unknown>): void;
  getSource(id: string): { setData(data: unknown): void } | undefined;
  addLayer(layer: Record<string, unknown>, beforeId?: string): void;
  setPaintProperty(id: string, key: string, value: unknown): void;
  setLayoutProperty(id: string, key: string, value: unknown): void;
  setFilter(id: string, filter: unknown): void;
  setSprite?(url: string): void;
  queryRenderedFeatures(geometry: unknown, options?: { layers?: string[] }): { layer: { id: string }; properties: Record<string, unknown> }[];
  easeTo(options: Record<string, unknown>): void;
  jumpTo(options: Record<string, unknown>): void;
  fitBounds(bounds: [[number, number], [number, number]], options?: Record<string, unknown>): void;
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  resize(): unknown;
  remove(): void;
}

/** What the wrapper reads off a MapLibre event, whatever its type. */
interface MapEventLike {
  type?: string;
  point?: { x: number; y: number };
  /** Set on a move a person made (drag, wheel, keyboard); absent on the wrapper's own easeTo. */
  originalEvent?: unknown;
  sourceId?: string;
  tile?: unknown;
  error?: { url?: string; message?: string } | null;
  /** styleimagemissing: the image name the style asked for. */
  id?: string;
}

/** The resolved theme theme.ts writes on <html>; light when unset, the app's first-paint fallback. */
export function documentTheme(doc: Document | undefined): MapTheme {
  return doc?.documentElement?.getAttribute('data-theme-resolved') === 'dark' ? 'dark' : 'light';
}

/** The camera zooms in to here for one stop or vehicle, never out. */
export const FOCUS_ZOOM = 15.5;
/** How far from a mark a tap may land and still pick it, CSS px. */
const HIT_TOLERANCE_PX = 8;
/** The camera's move to a selection, ms; 0 under reduced motion. */
const CAMERA_MS = 600;
/** Padding around a fitted route or closure, CSS px. */
const FIT_PADDING_PX = 40;
/** Route follow refits the selected route's vehicles at most this often, so the camera settles between moves. */
const ROUTE_FOLLOW_MS = 5000;

/** The kiosk adapter's shorthand as a selection: the route wins when both are given. */
export function viewSelection(route: string | null | undefined, stopId: string | null | undefined): MapSelection | null {
  if (route) return { kind: 'route', id: route };
  if (stopId) return { kind: 'stop', id: stopId };
  return null;
}

let mapUid = 0;

export function createCityMap(options: CityMapOptions, deps: CityMapDeps = {}): CityMapHandle {
  const { container } = options;
  const now = deps.now ?? (() => Date.now());
  const loadMaplibre = deps.loadMaplibre ?? (() => import('./maplibre-entry'));
  const doc = deps.documentRef ?? (typeof document === 'undefined' ? undefined : document);
  const interactive = options.interactive !== false;
  const reduced = options.reducedMotion === true;
  const scale = options.symbolScale ?? 1;
  let points = options.points ?? [];
  let lines = options.lines ?? [];
  let disposed = false;
  // The loop starts on MapLibre's 'load'; a pause() before that must still
  // win, so 'load' consults this instead of starting unconditionally.
  let paused = false;
  let net: Network | null = null;
  let model: Model | null = null;
  let lib: MaplibreModule | null = null;
  let map: MapApi | null = null;
  /** True once the overlays sit on the style: the point from which state changes reach the map directly. */
  let styled = false;
  let theme: MapTheme = options.theme ?? documentTheme(doc);
  let locale = options.locale ?? 'hr';
  let selection: MapSelection | null = options.selection ?? viewSelection(options.selectedRoute, options.selectedStop);
  /** A vehicle id, or true for the selected route's vehicles (a kiosk mirroring a phone's route). */
  let following: string | boolean | null = options.follow ?? null;
  let routeFollowAt = -Infinity;
  let modes: ReadonlySet<number> | null = options.modes ?? null;
  let closuresVisible = options.closures !== false;
  let stop: ScreenStop | null = options.stop ?? null;
  let status: MapStatus = 'loading';
  /** A basemap asset has failed since the last tile that loaded; reported as tiles-failed once the style is up. */
  let basemapFailing = false;
  /** The feed is stale or down: the loop holds, separately from pause(), so old evidence is never reckoned forward as if live. */
  let held = false;
  /** The basemap and overlay layer lists as the live style carries them: what the next change is diffed against. */
  let basemap: StyleLayerLike[] = [];
  let overlays: StyleLayerLike[] = [];
  let lastDrawn: Drawn[] = [];
  let lastPushedSignature = '';
  let nextPushAt = -Infinity;
  let observer: MutationObserver | null = null;
  const strings = { getLocale: () => locale };

  // R-F5: the container is a named region, so MapLibre's zoom buttons and
  // the attribution link inside it are exposed by name; the image is the
  // canvas alone (set once the library has built it). An id the page
  // already gave the element is kept: the canvas points its label at it.
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', options.ariaLabel);
  if (!container.id) container.id = `city-map-${++mapUid}`;
  container.dataset.mapStatus = status;

  function setStatus(next: MapStatus): void {
    if (status === next) return;
    status = next;
    container.dataset.mapStatus = next;
    options.onStatus?.(next);
  }

  function overlayOptions(): OverlayOptions {
    return { scale, modes, closuresVisible, selection };
  }

  /** One frame: the model stepped to `t`, the source pushed at 12 Hz when it changed, the camera kept on a followed vehicle. */
  function draw(t: number): boolean {
    // Detached (the dashboard swapped layers and took the workspace along):
    // paint nothing, report no change, let the loop park; the next render's
    // update() nudges it awake.
    const l = lib;
    if (!model || !map || !styled || !l || !container.isConnected) return false;
    lastDrawn = model.step(t);
    const fc = vehiclesToGeoJson(lastDrawn);
    container.dataset.frames = String(loop.frames());
    const signature = signatureOf(fc);
    const changed = signature !== lastPushedSignature;
    if (changed && t >= nextPushAt - PUSH_TOLERANCE_MS) {
      map.getSource(l.SOURCES.vehicles)?.setData(fc);
      lastPushedSignature = signature;
      // Stay on the 12 Hz grid while frames keep coming; re-anchor after a
      // park, when the old grid is long behind us.
      nextPushAt = nextPushAt + SOURCE_UPDATE_INTERVAL_MS > t ? nextPushAt + SOURCE_UPDATE_INTERVAL_MS : t + SOURCE_UPDATE_INTERVAL_MS;
      if (following === true) followRoute(fc);
      else if (following) followCamera(fc);
    }
    return changed;
  }

  const loop: Loop = createLoop(draw, {
    raf: deps.raf,
    cancel: deps.cancel,
    now,
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
    reducedMotion: options.reducedMotion,
  });

  /** One linear glide per push keeps a followed vehicle centred without a jump; a person's own move ends the follow (onMoveEnd). */
  function followCamera(fc: VehicleFeatureCollection): void {
    const feature = fc.features.find((f) => f.properties.id === following);
    if (!feature || !map) return;
    map.easeTo({ center: feature.geometry.coordinates, duration: reduced ? 0 : SOURCE_UPDATE_INTERVAL_MS, easing: (x: number) => x, essential: true });
  }

  /** Route follow: the selected route's vehicles kept in frame, refitted at most every ROUTE_FOLLOW_MS. */
  function followRoute(fc: VehicleFeatureCollection): void {
    const sel = selection;
    if (!map || sel?.kind !== 'route') return;
    const t = now();
    if (t - routeFollowAt < ROUTE_FOLLOW_MS) return;
    const coords = fc.features.filter((f) => f.properties.routeId === sel.id).map((f) => f.geometry.coordinates);
    if (coords.length === 0) return;
    routeFollowAt = t;
    fitCoordinates(coords, FOCUS_ZOOM);
  }

  function setData(id: string, data: unknown): void {
    map?.getSource(id)?.setData(data);
  }

  /** Places and closures do not move: re-set at once on every update. */
  function applyStatic(): void {
    if (!styled || !lib) return;
    setData(lib.SOURCES.places, pointsToGeoJson(points));
    setData(lib.SOURCES.closures, linesToGeoJson(lines));
  }

  function screenStopGeoJson(): { type: 'FeatureCollection'; features: unknown[] } {
    if (!stop || !Number.isFinite(stop.lon) || !Number.isFinite(stop.lat)) return { type: 'FeatureCollection', features: [] };
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] }, properties: { id: stop.id, name: stop.name } }] };
  }

  void (async () => {
    // Both arrive after first paint; the model wants the geometry from its
    // first step, so the two waits run side by side. loadNetwork() resolves
    // null on failure by its own contract; a loader that throws anyway
    // degrades to the same honest state (free-plane motion), not a crash.
    // The library failing to load (an old browser, a blocked chunk) leaves
    // the model and the network for the lists: the page's plain alternative.
    const [loaded, network] = await Promise.all([
      loadMaplibre().then((m) => m, () => null),
      options.loadNetwork ? options.loadNetwork().catch(() => null) : Promise.resolve(null),
    ]);
    if (disposed) return;
    net = network;
    model = createModel(net);
    model.update(pointsToFixes(points), now());
    options.onNetwork?.(net);
    if (!loaded) {
      setStatus('unavailable');
      return;
    }
    lib = loaded;
    try {
      buildMap(loaded);
    } catch {
      // No WebGL (an old GPU, a driver on a blocklist): the workspace shows
      // its route and stop alternative; the model still answers vehicles().
      map = null;
      setStatus('unavailable');
    }
  })();

  /** MapLibre's own control labels in the page's language. The canvas label is replaced below by the region's. */
  function controlStrings(): Record<string, string> {
    return {
      'NavigationControl.ZoomIn': tr(strings, 'zoomIn'),
      'NavigationControl.ZoomOut': tr(strings, 'zoomOut'),
      'NavigationControl.ResetBearing': tr(strings, 'resetBearing'),
      'ScaleControl.Meters': 'm',
      'ScaleControl.Kilometers': 'km',
    };
  }

  /** A map of places alone (a quake map) fits its places once the style is up. */
  function placesOnly(): boolean {
    return points.length > 0 && points.every((p) => !isVehicleReport(p));
  }

  function initialCamera(l: MaplibreModule): MapCamera {
    if (options.center) return { center: options.center, zoom: options.zoom ?? FOCUS_ZOOM };
    if (stop && Number.isFinite(stop.lon) && Number.isFinite(stop.lat)) return { center: [stop.lon, stop.lat], zoom: options.zoom ?? 15 };
    return { center: ZAGREB_CENTER, zoom: options.zoom ?? l.CITY_ZOOM };
  }

  function buildMap(l: MaplibreModule): void {
    const style = l.basemapStyle(theme, { locale, origin: deps.origin });
    basemap = style.layers;
    const start = initialCamera(l);
    const created = new l.Map({
      container,
      style: style as never,
      center: start.center,
      zoom: start.zoom,
      minZoom: l.MAP_MIN_ZOOM,
      maxZoom: l.MAP_MAX_ZOOM,
      maxBounds: l.maxBounds(),
      attributionControl: false,
      interactive,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: reduced ? 0 : 300,
      locale: controlStrings(),
    }) as unknown as MapApi;
    map = created;
    // MapLibre names its canvas a focusable region called "Map" (English,
    // whatever the page's language). It becomes the image with the same
    // label as the region -- aria-labelledby, so the per-poll label rewrite
    // in map-slots.ts reaches both -- and keeps its tab stop: the arrow
    // keys pan and +/- zoom, and taking that away would fail WCAG 2.1.1.
    const canvas = created.getCanvas();
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-labelledby', container.id);
    canvas.removeAttribute('aria-label');
    created.addControl(new l.AttributionControl({ compact: false, customAttribution: l.MAP_ATTRIBUTION_HTML }), 'bottom-right');
    created.addControl(new l.ScaleControl({ maxWidth: 80, unit: 'metric' }), 'bottom-left');
    if (interactive) created.addControl(new l.NavigationControl({ showCompass: false }), 'top-right');
    created.on('error', onMapError);
    created.on('styleimagemissing', (event) => onImageMissing(created, event));
    created.on('sourcedata', onSourceData);
    created.on('webglcontextlost', () => setStatus('unavailable'));
    created.on('webglcontextrestored', () => setStatus(styled ? 'ready' : 'loading'));
    created.on('moveend', onMoveEnd);
    if (interactive) bindPointer(created);
    created.once('load', () => onLoad(l, created));
    watchTheme();
  }

  /** The style is up: images, sources and overlay layers go on, then the loop starts. */
  function onLoad(l: MaplibreModule, created: MapApi): void {
    if (disposed || map !== created) return;
    for (const { id, image } of l.overlayImages()) created.addImage(id, image, { sdf: true, pixelRatio: SDF_PIXEL_RATIO });
    const empty = { type: 'FeatureCollection', features: [] };
    const geojson = (data: unknown): Record<string, unknown> => ({ type: 'geojson', data });
    created.addSource(l.SOURCES.network, geojson(net ? networkToGeoJson(net) : empty));
    created.addSource(l.SOURCES.stops, geojson(net ? stopsToGeoJson(net) : empty));
    created.addSource(l.SOURCES.closures, geojson(linesToGeoJson(lines)));
    created.addSource(l.SOURCES.places, geojson(pointsToGeoJson(points)));
    created.addSource(l.SOURCES.vehicles, geojson(empty));
    created.addSource(l.SOURCES.screenStop, geojson(screenStopGeoJson()));
    overlays = l.overlayLayers(l.overlayPalette(theme), overlayOptions());
    const beforeId = l.firstSymbolLayer(basemap);
    for (const layer of overlays) created.addLayer(layer as unknown as Record<string, unknown>, l.BELOW_LABELS.has(layer.id) ? beforeId : undefined);
    styled = true;
    if (status === 'loading') setStatus(basemapFailing ? 'tiles-failed' : 'ready');
    if (!options.center && !stop && placesOnly()) fitPlaces();
    else if (!options.center && options.selection) fitSelection();
    if (typeof following === 'string') centreOn(following);
    if (!paused && !held) loop.start();
  }

  function fitPlaces(): void {
    fitCoordinates(points.filter((p) => !isVehicleReport(p) && Number.isFinite(p.lon) && Number.isFinite(p.lat)).map((p): [number, number] => [p.lon, p.lat]), 11);
  }

  function fitCoordinates(coords: readonly [number, number][], maxZoom: number): void {
    if (!map || coords.length === 0) return;
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    for (const [lon, lat] of coords) {
      w = Math.min(w, lon);
      e = Math.max(e, lon);
      s = Math.min(s, lat);
      n = Math.max(n, lat);
    }
    if (w === e && s === n) map.easeTo({ center: [w, s], zoom: maxZoom, duration: reduced ? 0 : CAMERA_MS });
    else map.fitBounds([[w, s], [e, n]], { padding: FIT_PADDING_PX, maxZoom, duration: reduced ? 0 : CAMERA_MS });
  }

  /** A basemap asset not answering (a tile, a glyph range, the sprite): the overlays still draw over the background, so the status says so instead of the map going blank. */
  function onMapError(event: MapEventLike): void {
    const url = event.error?.url ?? '';
    const ours = (lib !== null && event.sourceId === lib.BASEMAP_SOURCE) || event.tile !== undefined || url.includes('/maps/');
    if (!ours) {
      // Anything else (a rejected layer, a bad expression) is a bug in this
      // file, never a network condition: it goes to the console, where
      // MapLibre's own default handler would have put it had none been bound.
      console.error('[city-map] MapLibre error', event.error ?? event);
      return;
    }
    basemapFailing = true;
    if (status === 'ready') setStatus('tiles-failed');
  }

  /** A basemap tile arriving after a failure: the basemap is back. */
  function onSourceData(event: MapEventLike): void {
    if (lib === null || event.sourceId !== lib.BASEMAP_SOURCE || event.tile === undefined) return;
    basemapFailing = false;
    if (status === 'tiles-failed') setStatus('ready');
  }

  /** An image the style names but the sprite lacks (basemap.ts bounds the known
   *  gap; this catches the rest): one transparent pixel under that name, so
   *  MapLibre neither logs the miss on every frame nor drops the label beside
   *  it. Nothing is drawn and nothing is invented. */
  function onImageMissing(m: MapApi, event: MapEventLike): void {
    const id = event.id;
    if (!id || m.hasImage?.(id)) return;
    m.addImage(id, { width: 1, height: 1, data: new Uint8ClampedArray(4) });
  }

  function cameraOf(m: MapApi): MapCamera {
    const c = m.getCenter();
    return { center: [c.lng, c.lat], zoom: m.getZoom() };
  }

  /** A move a person made (drag, wheel, keyboard) ends a follow; the wrapper's own easeTo carries no originalEvent. */
  function onMoveEnd(event: MapEventLike): void {
    if (!event.originalEvent || !map) return;
    following = null;
    options.onUserMove?.(cameraOf(map));
  }

  /** Every platform of the artefact sharing a name: one stop, whichever side of the street. */
  function siblingPlatforms(name: string): string[] | undefined {
    if (!net) return undefined;
    const ids = net.stops.filter((s) => s.name === name).map((s) => s.id);
    return ids.length > 1 ? ids : undefined;
  }

  /** The mark under a tap, by priority: a vehicle over a stop over a closure; nothing under it clears. */
  function pick(m: MapApi, point: { x: number; y: number }): MapSelection | null {
    const l = lib;
    if (!l) return null;
    const box = [
      [point.x - HIT_TOLERANCE_PX, point.y - HIT_TOLERANCE_PX],
      [point.x + HIT_TOLERANCE_PX, point.y + HIT_TOLERANCE_PX],
    ];
    const first = (layers: string[]): { properties: Record<string, unknown> } | undefined => m.queryRenderedFeatures(box, { layers })[0];
    const vehicle = first([l.LAYERS.vehicleSelected, l.LAYERS.vehicles, l.LAYERS.vehicleDots]);
    if (vehicle) return { kind: 'vehicle', id: String(vehicle.properties.id) };
    const platform = first([l.LAYERS.stopsSelected, l.LAYERS.stopsRoute, l.LAYERS.stops, l.LAYERS.stopLabels]);
    if (platform) return { kind: 'stop', id: String(platform.properties.id), ids: siblingPlatforms(String(platform.properties.name)) };
    const closure = closuresVisible ? first([l.LAYERS.closures, l.LAYERS.closuresCasing]) : undefined;
    if (closure) return { kind: 'closure', id: String(closure.properties.id) };
    return null;
  }

  function bindPointer(m: MapApi): void {
    const canvas = m.getCanvas();
    m.on('click', (event) => {
      if (!styled || !event.point) return;
      const picked = pick(m, event.point);
      select(picked);
      options.onSelect?.(picked);
    });
    m.on('mousemove', (event) => {
      if (!styled || !event.point) return;
      canvas.style.cursor = pick(m, event.point) ? 'pointer' : '';
    });
    // Escape on the map clears the selection: the keyboard's tap on nothing.
    // Stopped here so the page's own Escape (leaving the full map) takes a second press.
    container.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !selection) return;
      event.preventDefault();
      event.stopPropagation();
      select(null);
      options.onSelect?.(null);
    });
  }

  /** Applies style ops to the live map; a layer the style lost is skipped, never fatal. */
  function applyOps(m: MapApi, ops: readonly StyleOp[]): void {
    for (const op of ops) {
      try {
        if (op.kind === 'paint') m.setPaintProperty(op.id, op.key, op.value);
        else if (op.kind === 'layout') m.setLayoutProperty(op.id, op.key, op.value);
        else m.setFilter(op.id, op.value);
      } catch {
        /* a layer id the style does not carry */
      }
    }
  }

  /** Re-derives the overlays for the current state and applies what changed: paint on a theme flip, filters and visibility for a selection or a mode toggle. */
  function applyOverlays(): void {
    const l = lib;
    if (!map || !styled || !l) return;
    const next = l.overlayLayers(l.overlayPalette(theme), overlayOptions());
    applyOps(map, l.styleDiff(overlays, next));
    overlays = next;
  }

  /** Selects (or clears with null) and marks it on the map; `fit` moves the camera to it. */
  function select(next: MapSelection | null, opts: { fit?: boolean } = {}): void {
    selection = next;
    // A vehicle follow ends with any other selection; a route follow ends with anything but a route.
    if (typeof following === 'string' && next?.kind !== 'vehicle') following = null;
    if (following === true && next?.kind !== 'route') following = null;
    applyOverlays();
    if (opts.fit) fitSelection();
  }

  function centreOn(vehicleId: string): void {
    const v = lastDrawn.find((d) => d.id === vehicleId);
    if (!v || !map) return;
    map.easeTo({ center: toLonLat(v.p), zoom: Math.max(map.getZoom(), FOCUS_ZOOM), duration: reduced ? 0 : CAMERA_MS });
  }

  /** The camera to the selection: a route's whole geometry, a closure's line, a stop or a vehicle centred, zoomed in to FOCUS_ZOOM and never out. */
  function fitSelection(): void {
    const sel = selection;
    if (!map || !sel) return;
    switch (sel.kind) {
      case 'route': {
        if (!net) return;
        const coords: [number, number][] = [];
        for (const idx of net.routes.get(sel.id)?.shapes ?? []) for (const p of net.shapes[idx]?.pts ?? []) coords.push(toLonLat(p));
        fitCoordinates(coords, 15);
        return;
      }
      case 'stop': {
        const ids = new Set([sel.id, ...(sel.ids ?? [])]);
        const coords = (net?.stops ?? []).filter((s) => ids.has(s.id)).map((s) => toLonLat(s.p));
        if (coords.length === 0 && stop && ids.has(stop.id)) coords.push([stop.lon, stop.lat]);
        if (coords.length === 0) return;
        const centre = coords.reduce<[number, number]>(([a, b], [x, y]) => [a + x / coords.length, b + y / coords.length], [0, 0]);
        map.easeTo({ center: centre, zoom: Math.max(map.getZoom(), FOCUS_ZOOM), duration: reduced ? 0 : CAMERA_MS });
        return;
      }
      case 'vehicle':
        centreOn(sel.id);
        return;
      case 'closure': {
        const line = lines.find((c) => c.id === sel.id);
        if (line) fitCoordinates(line.coordinates, 16);
      }
    }
  }

  function setTheme(next: MapTheme): void {
    if (next === theme) return;
    theme = next;
    const l = lib;
    if (!map || !styled || !l) return;
    const nextBasemap = l.basemapLayers(next, { locale, origin: deps.origin });
    applyOps(map, l.styleDiff(basemap, nextBasemap));
    basemap = nextBasemap;
    map.setSprite?.(l.spriteUrl(next, deps.origin));
    applyOverlays();
  }

  function setLocale(next: string): void {
    if (next === locale) return;
    locale = next;
    const l = lib;
    if (!map || !styled || !l) return;
    const nextBasemap = l.basemapLayers(theme, { locale, origin: deps.origin });
    applyOps(map, l.styleDiff(basemap, nextBasemap));
    basemap = nextBasemap;
    relabelControls();
  }

  /** MapLibre labelled its controls at construction; a locale switch re-labels the buttons in place. */
  function relabelControls(): void {
    const labels = controlStrings();
    const pairs: [string, string][] = [
      ['.maplibregl-ctrl-zoom-in', labels['NavigationControl.ZoomIn']],
      ['.maplibregl-ctrl-zoom-out', labels['NavigationControl.ZoomOut']],
    ];
    for (const [selector, label] of pairs) {
      const el = container.querySelector<HTMLElement>(selector);
      if (!el) continue;
      el.setAttribute('aria-label', label);
      el.title = label;
    }
  }

  /** Without an explicit theme, follow <html data-theme-resolved> live (theme.ts writes it for every preference). */
  function watchTheme(): void {
    if (options.theme !== undefined || !doc || typeof MutationObserver === 'undefined' || observer) return;
    observer = new MutationObserver(() => setTheme(documentTheme(doc)));
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme-resolved'] });
  }

  /** A vehicle id: the camera keeps on it, selecting it. `true`: the selected route's vehicles stay in frame. Either ends when the person moves the map, or on follow(null). */
  function follow(target: string | boolean | null): void {
    following = target === false ? null : target;
    if (typeof target === 'string') {
      selection = { kind: 'vehicle', id: target };
      applyOverlays();
      centreOn(target);
    } else if (target === true) {
      routeFollowAt = -Infinity;
      if (selection?.kind === 'route') followRoute(vehiclesToGeoJson(lastDrawn));
      else fitSelection();
    }
    loop.nudge();
  }

  /** The vehicles as the model draws them right now (R-P2): the last frame while the loop runs, one fresh step when there is no map to run it. */
  function vehicles(): VehicleInfo[] {
    if (!model) return [];
    const drawn = paused || styled ? lastDrawn : (lastDrawn = model.step(now()));
    return drawn.map((v) => {
      const [lon, lat] = toLonLat(v.p);
      return {
        id: v.id,
        routeId: v.routeId,
        short: vehicleLabel(v),
        kind: vehicleKind(v.type),
        type: v.type,
        lon,
        lat,
        bearing: v.heading ? bearingOf(v.heading) : null,
        confidence: v.confidence,
        held: v.held === true,
        onShape: v.onShape,
      };
    });
  }

  const move = (center: [number, number], zoom: number): void => {
    map?.easeTo({ center, zoom, duration: reduced ? 0 : CAMERA_MS });
  };

  return {
    update(nextPoints, nextLines) {
      points = nextPoints;
      lines = nextLines;
      // Evidence in, motion out: the model folds the reports into each
      // vehicle's own history and the loop draws where it says. Places and
      // closures do not move and are re-set at once.
      model?.update(pointsToFixes(points), now());
      applyStatic();
      loop.nudge();
    },
    pause() {
      paused = true;
      loop.stop();
    },
    resume() {
      paused = false;
      if (styled && !held) loop.start(); // before 'load' the load handler starts it
    },
    destroy() {
      disposed = true;
      loop.stop();
      observer?.disconnect();
      observer = null;
      styled = false;
      map?.remove();
      map = null;
    },
    setTheme,
    setLocale,
    select,
    selection: () => selection,
    follow,
    following: () => following,
    setView(view) {
      const next = viewSelection(view.selectedRoute, view.selectedStop);
      if (next?.kind === 'stop') {
        const platform = net?.stops.find((s) => s.id === next.id);
        if (platform) next.ids = siblingPlatforms(platform.name);
      }
      const changed = JSON.stringify(next) !== JSON.stringify(selection);
      if (changed) select(next);
      if (view.center) move(view.center, view.zoom ?? (map ? map.getZoom() : FOCUS_ZOOM));
      else if (changed && next) fitSelection();
      follow(view.follow === true ? true : null);
    },
    resize() {
      map?.resize();
    },
    setModes(next) {
      modes = next;
      applyOverlays();
    },
    setClosuresVisible(visible) {
      closuresVisible = visible;
      applyOverlays();
    },
    setFeedState(state) {
      const next = state !== 'live';
      container.dataset.feed = state;
      if (next === held) return;
      held = next;
      if (held) loop.stop();
      else if (styled && !paused) loop.start();
    },
    setStop(next) {
      stop = next;
      if (styled && lib) setData(lib.SOURCES.screenStop, screenStopGeoJson());
    },
    fit(target) {
      if (!map || !lib) return;
      if (target === 'city') move(ZAGREB_CENTER, lib.CITY_ZOOM);
      else if (target === 'selection') fitSelection();
      else if (stop && Number.isFinite(stop.lon) && Number.isFinite(stop.lat)) move([stop.lon, stop.lat], Math.max(map.getZoom(), 15));
    },
    camera: () => (map ? cameraOf(map) : null),
    status: () => status,
    network: () => net,
    vehicles,
  };
}
