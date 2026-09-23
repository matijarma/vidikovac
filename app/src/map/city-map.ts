// One map component for the whole app: the same-origin Protomaps v4 basemap
// (basemap.ts) with the motion model's vehicles as numbered pills, the route
// network and named stops from the GTFS artefact, closures as lines, places
// (quake epicentres) as circles, and one selection ring.
//
// The rule of area T holds here exactly as it does on the schematic (R-P2):
// a reported vehicle position is evidence, never output. A vehicle point
// handed to this map goes into the integrator as a Fix with the twin's plan;
// what the GeoJSON source receives is the integrator's own estimate, stepped
// at the screen's refresh rate and pushed to MapLibre at 12 Hz. Nothing in this file ever
// writes a reported vehicle coordinate into a source.
//
// One MapLibre context per slot for the page's life (map-slots.ts): a poll
// hands in new evidence through update(); the camera, the selection, the
// followed vehicle and the theme all survive it. MapLibre and the style
// builder arrive through one dynamic import (maplibre-entry.ts), so the
// lightweight path never loads either (R-L2).
import type { ScreenStop } from '../core/contracts';
import { ZET_ROUTES } from '../data/routes';
import { toLonLat } from '../../../shared/motion/geo';
import { createLoop, type Loop } from '../motion/loop';
import { createIntegrator, type Drawn, type Fix, type Model } from '../motion/integrator';
import { pillLabel } from '../motion/pill-label';
import { MAP_PRESENTATIONS, type MapPresentation } from './presentation';
import { loadNetwork, type GraphNetwork, type Network } from '../../../shared/motion/network';
import type { MotionMetadata } from '../../../shared/motion/wire';
import { ROUTE_TYPE_TRAM } from '../motion/schematic';
import { vehicleKind, type VehicleKind } from './vehicle-mark';
import { tr } from '../transport/strings';
import type { CityLabels } from './city-layers';
import type { BasemapProfile, BasemapStyleOptions, MapTheme, OverlayPalette, StyleLayerLike, StyleOp } from './basemap';
import type { OverlayOptions, ProzorOptions } from './overlays';
import type { RenderedFeature, SourcePoint } from './name-census';
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';
import type { TileLabelFeature } from './external-labels';

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

/** What a drawn point IS, when it is more than an untyped place. A point with
 *  no `place` keeps the one plain circle this map has always drawn, which is
 *  what the dashboard's quake map and its work points still ask for; a point
 *  with one is drawn by its own layer, with its own mark and
 *  its own honesty rule (map/overlays.ts). */
export type PlaceKind = 'event' | 'quake' | 'assembly' | 'pharmacy' | 'seat' | 'city';

/** A value a place may carry alongside its name, flat, for a layer filter to
 *  read: an event's `source` and `phase`, a quake's `mag`, a pharmacy's
 *  published `address`. Flat and few on purpose -- a filter cannot reach into
 *  a nested object, and a rule this map will not draw without has to be
 *  expressible as a filter, not as a comment. */
export type PointProp = string | number | boolean;

/** A vehicle as the wire reports it (a Fix with a title), or a place. A
 *  point that carries `at` is a vehicle: evidence for the integrator (R-P2),
 *  with the twin's plan and scalars riding along, never drawn where
 *  reported. A point without one is a place (a quake epicentre) and is
 *  drawn where given. */
export interface MapPoint extends Omit<Fix, 'at'> {
  title: string;
  at?: number;
  /** Absent: the plain place circle, exactly as before. */
  place?: PlaceKind;
  props?: Readonly<Record<string, PointProp>>;
}

export interface MapLine {
  id: string;
  title: string;
  coordinates: [number, number][];
}

/** One district's boundary, as the closed rings of its polygons ([outer,
 *  ...holes] per polygon, [lon, lat]). Drawn as lines, and dashed: the rings
 *  are a build-time Douglas-Peucker simplification of the City's own polygons,
 *  so a solid hairline would claim a precision they do not have -- and at this
 *  weight it would read as one more closed road beside the closure red. */
export interface MapOutline {
  id: string;
  polygons: [number, number][][][];
}

export interface LineStringFeatureCollection {
  type: 'FeatureCollection';
  features: { type: 'Feature'; geometry: { type: 'MultiLineString'; coordinates: [number, number][][] }; properties: { id: string } }[];
}

export interface PointProperties {
  id: string;
  title: string;
  routeId?: string;
  place?: PlaceKind;
  [key: string]: PointProp | undefined;
}

export interface PointFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: PointProperties;
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

/** A vehicle's kind by GTFS route type and its confidence as alpha live in
 *  vehicle-mark.ts, shared with the body builder; the kind keeps its
 *  long-standing home here for the pages that read it. */
export { vehicleKind, type VehicleKind };

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
      /** True on a merged mark whose members face opposite ways (more than
       *  TWO_WAY_MIN_DEG of bearing apart): the two-way arrow layers filter on
       *  it. Written on every feature, false on a single, as `cluster` is. */
      twoWay: boolean;
      /** How far from the mark's centre the direction nose (or a two-way
       *  arrow) stands along `bearing`, in CSS px before the symbol scale:
       *  motion/pills.ts noseCentrePx for this label's capsule and this
       *  kind's mark, which overlays.ts NOSE_OFFSET reads. Written on every
       *  feature, since a layer reading a missing property falls back. */
      nose: number;
      /** Confidence carried as opacity, floored at vehicle-mark.ts's MIN_ICON_ALPHA. */
      alpha: number;
      /** Draw order (overlays.ts SORT_KEY, higher over lower): a cluster over
       *  a tram over a bus, so a busy stop never buries a tram and a merged
       *  mark is never half-hidden under one of the marks it stands for. */
      sort: number;
      held: boolean;
      /** True on a merged mark. Written on every feature, never left off a
       *  single: the pill layer's cluster ring is a `case` on this property,
       *  and a MapLibre `case` on a missing property is a runtime error. */
      cluster: boolean;
      /** A cluster's members, and how many; absent on a single. */
      ids?: string[];
      n?: number;
    };
  }[];
}

/** One feature of the vehicle source. */
export type VehicleFeature = VehicleFeatureCollection['features'][number];

export const isVehicleReport = (p: MapPoint): boolean => p.at !== undefined;

/** The vehicle reports among `points`, as the model's evidence. */
export function pointsToFixes(points: readonly MapPoint[]): Fix[] {
  const fixes: Fix[] = [];
  for (const p of points) {
    if (p.at === undefined || !Number.isFinite(p.lon) || !Number.isFinite(p.lat)) continue;
    const { title: _title, ...fix } = p;
    fixes.push({ ...fix, at: p.at });
  }
  return fixes;
}

/** Plane direction (x east, y north) to compass degrees clockwise from north. */
export function bearingOf(dir: { x: number; y: number } | null | undefined): number {
  if (!dir) return 0;
  const deg = (Math.atan2(dir.x, dir.y) * 180) / Math.PI;
  return Math.round(((deg % 360) + 360) % 360);
}

/** The number on the front of the vehicle: the network's own short name,
 *  else the static GTFS table's, else the route id itself; '' for a vehicle
 *  whose route nobody knows. Held to the widest capsule (pills.ts's
 *  pillLabel), so a standalone or selected pill obeys the same cap as a
 *  cluster's name. */
export function vehicleLabel(v: { short?: string; routeId?: string }): string {
  if (v.short) return vetExternal('headsign', v.short, 'row') === null ? '' : pillLabel(v.short);
  if (v.routeId === undefined) return '';
  const text = ZET_ROUTES[v.routeId]?.shortName || v.routeId;
  return vetExternal('headsign', text, 'row') === null ? '' : pillLabel(text);
}

export interface NetworkFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    properties: { shape: number; route: string; short: string; kind: VehicleKind };
  }[];
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
      /** Ruling 30: a tram calls here and some trip starts or ends here --
       *  the interchanges the whole-city window names. A property of the
       *  name, so every platform of it carries the same answer. */
      tramInterchange: boolean;
    };
  }[];
}

/** Every platform of the artefact, with the routes whose shapes call there,
 *  the modes among them (what a tram-only view keeps), a rank (how many) that
 *  decides whose label wins a crowded corner, one labelled platform per name
 *  -- GTFS lists one platform per direction, and two labels reading
 *  "Kvaternikov trg" thirty metres apart is clutter, not information -- and
 *  whether the stop is a tram interchange (Ruling 30).
 *
 *  `tramInterchange` is a property of the NAME, not of the platform: every
 *  platform that shares a name carries the answer for all of them, because
 *  which of them holds the label is decided by route count and the question
 *  "is this an interchange" is not. A stop qualifies when some tram calls
 *  there AND some trip in the feed starts or ends there -- in this network
 *  that is the tram termini and the junctions the lines turn at, which is
 *  what a rider means by an interchange. Route count is NOT the test: the
 *  city's 19 tram routes overlap so heavily that 111 of the 114 tram-served
 *  names see two or more of them, so "two trams" names nearly every tram
 *  stop there is (measured against the shipped artefact, 20 Sept 2026). */
/** What the map can have selected. Route and stop are the two kinds the
 *  public selection may relay to a paired screen (worker/public-selection.ts);
 *  a vehicle or a closure stays on the device that picked it. */
export type MapSelection =
  | { kind: 'place'; id: string }
  | { kind: 'street'; id: string }
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
  /** The trip's headsign from the twin's join, when known (R-TE2). */
  headsign?: string;
  /** The realtime trip id from the twin's join, when known: what shared/city/
   *  arrivals.ts matches a scheduled departure against (WP5). */
  tripId?: string;
  /** The next stop's id from the twin, when known. */
  nextStopId?: string;
  /** ZET's reported delay at that stop, seconds; negative is early. */
  delaySeconds?: number;
  /** The twin's own planned arrival at that stop, epoch ms. It refines the
   *  arrivals row for the platform the vehicle is actually approaching. */
  nextStopEtaMs?: number;
}

export interface MapCamera {
  center: [number, number];
  zoom: number;
}

/** What a public screen asks of its one map (kiosk/mapview.ts's KioskMapView): every field optional. */
export interface MapView {
  center?: [number, number];
  zoom?: number;
  /** Sides of the map something else is drawn over: the kiosk's tile rail
   *  along the foot. A camera given this centres inside the part a reader can
   *  actually see, instead of behind the cards. Standing, exactly as
   *  setFitPadding: applied to this move and to every later one.
   *  (kiosk/INTEGRATION.md listed this as the one thing pending on the map
   *  side; kiosk/mapview.ts's boardCentre faked it by shifting latitude.) */
  padding?: FitPadding;
  selectedRoute?: string;
  selectedStop?: string;
  selection?: MapSelection | null;
  follow?: boolean;
  /** Which kinds of city point this chapter lights; null lights every one. */
  emphasis?: readonly PlaceKind[] | null;
}

/** Sides of the viewport a fit must keep clear, CSS px; a missing side is 0. */
export interface FitPadding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface MapHighlight {
  id: string;
  geometry: {type:'Point';coordinates:[number,number]} | {type:'LineString';coordinates:[number,number][]} | {type:'MultiPolygon';coordinates:[number,number][][][]};
}
export interface CityMapOptions {
  presentationProfile?: MapPresentation;
  container: HTMLElement;
  ariaLabel: string;
  /** The page factory's output; absent means the geographic city map.
   *  The schema implementation is loaded only when that renderer is requested. */
  renderer?: 'map' | 'schema';
  points?: MapPoint[];
  lines?: MapLine[];
  reducedMotion?: boolean;
  /** The network artefact for the motion model (route geometry to snap
   *  to) and for the drawn network and stops. Absent, every vehicle
   *  free-planes -- still the model's motion, never a jump onto a report --
   *  and no network or stops are drawn. A page passes the same memoised
   *  loader its schematic uses so the artefact is fetched once (R-L4). */
  loadNetwork?: () => Promise<Network | null>;
  /** A non-memoised load after motion names a different graph. */
  reloadNetwork?: () => Promise<Network | null>;
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
  /** A stop whose name the schema's collision pass places first and never
   *  drops, for a surface handed no stop to crop round: the wall's
   *  whole-network Prikaz shema [O-72] still names its own place [O-65]
   *  (setPriorityStop live). The geographic map has its screen-stop label. */
  priorityStopId?: string | null;
  /** The district outline to draw, dashed; null draws none. */
  outline?: MapOutline | null;
  /** GTFS route types drawn (0 trams, 3 buses); null, the default, is every type. */
  modes?: ReadonlySet<number> | null;
  /** Which kinds of city point are lit. null, the default, lights every one;
   *  a kiosk chapter passes the subset it is about (kiosk/mapview.ts). */
  emphasis?: readonly PlaceKind[] | null;
  /** "Only this line on the map" at creation (core/line-focus-store.ts, F5).
   *  Absent is off -- a surface that never asks for it, the kiosk among them,
   *  draws the whole network as before. Changed live with setLineFocus. */
  lineFocus?: boolean;
  /** false hides the closures until setClosuresVisible(true). */
  closures?: boolean;
  /** false: no pointer or keyboard handling and no controls (a public screen). */
  interactive?: boolean;
  /** Symbol and circle size multiplier: 1 on a phone or desk, more on a screen read from across a room. */
  symbolScale?: number;
  /** MapLibre's cooperative gestures (two fingers to pan, Ctrl to zoom). Off by
   *  default on every surface: Promet is a fixed stage, so a one-finger drag
   *  never fights the page. A documented fallback for a scrolling host. */
  cooperative?: boolean;
  /** A compact attribution control (the credit behind one button) for the phone stage. */
  attributionCompact?: boolean;
  /** false leaves the city, region and country names off the basemap, for a map inset too small to carry them. No surface asks for it today. */
  placeLabels?: boolean;
  /** Which of the city places' own names are drawn (map/city-layers.ts
   *  CityLabels): 'all' (default), 'venues' on the framed wall (a venue with
   *  a programme tonight is named, a BAJS station is its counted disc alone),
   *  'none' on the unframed window onto the whole city. true and false are
   *  the older switch for 'all' and 'none'. Changed live with setCityLabels. */
  cityLabels?: CityLabels | boolean;
  /** How far from a mark a tap may land and still pick it, CSS px. The public
   *  screen raises it: a finger on a wall is not a mouse on a desk, and its
   *  stop rings are small at city zoom. Default HIT_TOLERANCE_PX. */
  hitTolerancePx?: number;
  /** Which basemap this surface reads: 'prozor' for the public screen, whose
   *  ground is two landuse tones under hairline streets, with no POI, no
   *  neighbourhood name and every label that remains sized from a stated
   *  viewing geometry (map/basemap.ts). Default 'default'. */
  basemapProfile?: BasemapProfile;
  /** The public screen's overlay set (map/overlays.ts ProzorOptions, plan D4); absent, today's drawing. Changed live with setProzor. */
  prozor?: ProzorOptions;
  /** CSS px of the map covered by something (the sheet along the bottom): every
   *  fit keeps its geometry inside the uncovered part. Changed live with setFitPadding. */
  fitPadding?: FitPadding;
  /** Pointer selection on the map: a vehicle, a stop, a closure, or nothing. */
  onSelect?: (selection: MapSelection | null) => void;
  /** Resolves a rendered basemap label against verified street/settlement data. */
  resolveStreet?: (name: string, point: {lon:number;lat:number}) => string | null;
  onStatus?: (status: MapStatus) => void;
  /** The network artefact settled: the decoded network, or null when it could not load. */
  onNetwork?: (net: Network | null) => void;
  /** A user gesture ends a follow. The schema reports null because its
   *  viewport is not a geographic camera; callers must keep their saved map camera. */
  onUserMove?: (camera: MapCamera | null) => void;
  /** Every zoom that settles, whoever asked for it (a person's gesture or one
   *  of the wrapper's own eases): the public screen decides from it whether
   *  the buses are on the picture (kiosk/mapview.ts busesVisible). */
  onCamera?: (camera: MapCamera) => void;
}

/** CityMapOptions.cityLabels as one of its three answers. */
export function cityLabelsOf(on: CityLabels | boolean | undefined): CityLabels {
  return on === undefined || on === true ? 'all' : on === false ? 'none' : on;
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
  /** Which of the city places' own names are drawn, on the one live map. */
  setCityLabels?(on: CityLabels | boolean): void;
  /** The kinds of city point this chapter lights; null lights every one. */
  setEmphasis?(emphasis: readonly PlaceKind[] | null): void;
  /** "Only this line on the map": the reader's own switch, per device. A
   *  separate name from setEmphasis, which already means city-point kinds. */
  setLineFocus?(on: boolean): void;
  setClosuresVisible?(visible: boolean): void;
  /** The feed's own state: 'down' stops the motion and takes the vehicles off the map (an outage is no evidence of where a tram is) until the feed is live again; 'stale' keeps the motion. */
  setFeedState?(state: 'live' | 'stale' | 'down'): void;
  setStop?(stop: ScreenStop | null): void;
  /** CityMapOptions.priorityStopId, live. */
  setPriorityStop?(id: string | null): void;
  /** The district outline to draw, dashed; null clears it. */
  setOutline?(outline: MapOutline | null): void;
  setCityPaths?(lines: MapLine[]): void;
  /** Ambient emphasis never changes personal selection, camera or follow. */
  setHighlight?(highlight: MapHighlight | null): void;
  setPresentationProfile?(profile: MapPresentation, symbolScale?: number): void;
  /** The inner city, the current selection, or the screen's stop. */
  fit?(target: 'city' | 'selection' | 'stop'): void;
  /** The covered part of the viewport every later fit keeps clear (the sheet's height on the phone stage). */
  setFitPadding?(padding: FitPadding): void;
  camera?(): MapCamera | null;
  status?(): MapStatus;
  network?(): Network | null;
  /** The vehicles as the model draws them right now. */
  vehicles?(): VehicleInfo[];
  /** The public screen's overlay set, changed live: the stop's routes when the
   *  stop changes, the field's zoom when it is re-measured (one map lives for
   *  the screen's life, R-54). null draws every surface as before. */
  setProzor?(prozor: ProzorOptions | null): void;
  /** Unique `name` values of the symbols MapLibre actually placed for a layer
   *  (the e2e's proof that the prozor profile places few street names);
   *  [] before the style loads or for a layer the style does not carry. */
  placedNames?(layerId: string): string[];
}

export type MapFactory = (options: CityMapOptions) => CityMapHandle;

/** Binds a network loader into a factory, so a page's map slots and its
 *  schematic share one artefact fetch. `undefined` in stays `undefined` out. */
export function withNetwork(factory: MapFactory | undefined, loadNetwork: () => Promise<Network | null>, motionFor?: (id: string) => MotionMetadata | undefined, reloadNetwork?: () => Promise<Network | null>): MapFactory | undefined {
  return factory && ((options) => {
    // The kiosk has the raw snapshot even during the decoder's one-deploy
    // transition. Forward metadata before either renderer sees a point.
    const enrich = (points: MapPoint[]) => motionFor ? points.map(p => ({ ...p, ...motionFor(p.id) })) : points;
    const handle = factory({ ...options, loadNetwork, ...(reloadNetwork ? { reloadNetwork } : {}), points: enrich(options.points ?? []) });
    return motionFor ? { ...handle, update: (points, lines) => handle.update(enrich(points), lines) } : handle;
  });
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

// --- The marker census (WP2, the probe contract of the companion plan §15.6)
//
// What the wall promises about its city marks is a claim about the screen:
// every BAJS station a disc with its count in it (a grey "0" when it has no
// bike, a grey disc without a number when the count is unknown or the
// station is not renting, never "?"), every venue on it named, nothing a
// mark without a word. So the census reads back what MapLibre drew -- the
// dots, the counts and the names it placed -- rather than the points it was
// handed, like data-pills does for the vehicles. The census (markerCensus,
// pillBox) and the passes that feed it (createRenderCensus, bound below in
// buildMap) live in name-census.ts, in the MapLibre chunk.

/** The slice of a MapLibre Map this wrapper drives, structurally, so a test's stand-in stays small. */
interface MapApi {
  on(type: string, listener: (event: MapEventLike) => void): unknown;
  once(type: string, listener: (event: MapEventLike) => void): unknown;
  addControl(control: unknown, position?: string): unknown;
  getCanvas(): HTMLCanvasElement;
  addImage(id: string, image: { width: number; height: number; data: Uint8ClampedArray }, options?: Record<string, unknown>): void;
  hasImage?(id: string): boolean;
  /** Only to replace the scale-drawn pill images (putOverlayImages); a
   *  stand-in without it still satisfies this slice. */
  removeImage?(id: string): void;
  addSource(id: string, spec: Record<string, unknown>): void;
  getSource(id: string): { setData(data: unknown): void } | undefined;
  addLayer(layer: Record<string, unknown>, beforeId?: string): void;
  setPaintProperty(id: string, key: string, value: unknown): void;
  setLayoutProperty(id: string, key: string, value: unknown): void;
  /** The two getters that go with the setters above. Read only by the
   *  `data-focus` probe, so a test stand-in need not carry them. */
  getPaintProperty?(id: string, key: string): unknown;
  getLayoutProperty?(id: string, key: string): unknown;
  setFilter(id: string, filter: unknown): void;
  setLayerZoomRange?(id: string, minzoom: number, maxzoom: number): void;
  getLayer?(id: string): unknown;
  setSprite?(url: string): void;
  queryRenderedFeatures(geometry: unknown, options?: { layers?: string[] }): RenderedFeature[];
  querySourceFeatures?(source: string, options: { sourceLayer: string }): TileLabelFeature[];
  /** Decision 19's name hysteresis only; a stand-in without them runs none. */
  setFeatureState?(feature: { source: string; id: string }, state: Record<string, unknown>): void;
  easeTo(options: Record<string, unknown>): void;
  jumpTo(options: Record<string, unknown>): void;
  fitBounds(bounds: [[number, number], [number, number]], options?: Record<string, unknown>): void;
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  /** Whether the camera is being moved (a pan, a zoom, an ease). Read only
   *  by the census's still-frame fallback (name-census.ts settled), so a stand-in
   *  without it counts as still. */
  isMoving?(): boolean;
  /** [lon, lat] to CSS px on the current camera; how the pills are clustered
   *  and how a tap on a cluster finds the member nearest to it. Optional so a
   *  stand-in without a camera still satisfies this slice. */
  project?(lonLat: [number, number]): { x: number; y: number };
  unproject?(point: {x:number;y:number}): {lng:number;lat:number};
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
/** How far from a mark a tap may land and still pick it, CSS px; a surface
 *  read and touched from further away raises it (CityMapOptions.hitTolerancePx). */
const HIT_TOLERANCE_PX = 8;
/** The camera's move to a selection, ms; 0 under reduced motion. */
const CAMERA_MS = 600;
/** Padding around a fitted route or closure, CSS px. */
const FIT_PADDING_PX = 40;
/** The least of the viewport a fit may be squeezed into on either axis, whatever covers the rest. */
const FIT_ROOM_PX = 2 * FIT_PADDING_PX;
/** Route follow refits the selected route's vehicles at most this often, so the camera settles between moves. */
const ROUTE_FOLLOW_MS = 5000;
/** A tap on a cluster below this zoom moves the camera onto its members
 *  instead of choosing one of them for the reader: while the pills are merged
 *  the tap cannot mean one vehicle, and half a step from the map's own maximum
 *  (basemap.ts MAP_MAX_ZOOM, 18) is the last point where there is still camera
 *  left to spend. At or above it the tap picks the member nearest to it. */
export const CLUSTER_ZOOM_IN_UNTIL = 17.5;

/** The kiosk adapter's shorthand as a selection: the route wins when both are given. */
export function viewSelection(route: string | null | undefined, stopId: string | null | undefined): MapSelection | null {
  if (route) return { kind: 'route', id: route };
  if (stopId) return { kind: 'stop', id: stopId };
  return null;
}

let mapUid = 0;

/** MapLibre refuses a fit whose padding leaves it no room (cameraForBounds warns and moves nothing), so along each
 *  axis the two sides together leave at least FIT_ROOM_PX of the box: the excess comes off the larger side first and
 *  the breathing space last. A box with no size yet (not laid out) has nothing to fit inside and is left alone. */
function fitInside(p: Required<FitPadding>, a: 'top' | 'left', b: 'bottom' | 'right', size: number): void {
  if (!(size > 0)) return;
  const room = Math.max(0, size - FIT_ROOM_PX);
  let excess = p[a] + p[b] - room;
  if (excess <= 0) return;
  for (const key of p[a] >= p[b] ? [a, b] : [b, a]) {
    const take = Math.min(excess, Math.max(0, p[key] - FIT_PADDING_PX));
    p[key] -= take;
    excess -= take;
  }
  if (excess > 0) {
    // Even the breathing space is too much for this box: share what room there is in proportion.
    const total = p[a] + p[b];
    p[a] = total > 0 ? Math.floor((p[a] * room) / total) : 0;
    p[b] = total > 0 ? Math.floor((p[b] * room) / total) : 0;
  }
}

export function createCityMap(options: CityMapOptions, deps: CityMapDeps = {}): CityMapHandle {
  const { container } = options;
  const now = deps.now ?? (() => Date.now());
  const loadMaplibre = deps.loadMaplibre ?? (() => import('./maplibre-entry'));
  const doc = deps.documentRef ?? (typeof document === 'undefined' ? undefined : document);
  const interactive = options.interactive !== false;
  const reduced = options.reducedMotion === true;
  let fitPadding: FitPadding = { ...options.fitPadding };

  /** FIT_PADDING_PX of breathing space on every side, plus the covered part, plus a call's own extra, kept inside the container's box. */
  function paddingFor(extra: FitPadding = {}): Required<FitPadding> {
    const side = (key: keyof FitPadding): number => FIT_PADDING_PX + (fitPadding[key] ?? 0) + (extra[key] ?? 0);
    const p = { top: side('top'), right: side('right'), bottom: side('bottom'), left: side('left') };
    fitInside(p, 'top', 'bottom', container.clientHeight);
    fitInside(p, 'left', 'right', container.clientWidth);
    return p;
  }
  /** A point eased to (not fitted) lands in the middle of the uncovered area: half the padding difference, as MapLibre's `offset`. */
  function offsetFor(extra: FitPadding = {}): [number, number] {
    const p = paddingFor(extra);
    return [(p.left - p.right) / 2, (p.top - p.bottom) / 2];
  }
  let profile=MAP_PRESENTATIONS[options.presentationProfile??'desktop'];
  container.dataset.presentationProfile=options.presentationProfile??'desktop';
  let scale = options.symbolScale ?? profile.symbolScale;
  let highlight: MapHighlight | null = null;
  const highlightData=()=>({type:'FeatureCollection',features:highlight?[{type:'Feature',properties:{id:highlight.id},geometry:highlight.geometry}]:[]});
  let points = options.points ?? [];
  let lines = options.lines ?? [];
  let disposed = false;
  // The loop starts on MapLibre's 'load'; a pause() before that must still
  // win, so 'load' consults this instead of starting unconditionally.
  let paused = false;
  let net: Network | null = null;
  /** The same object as `net` when it carries the rail graph -- what
   *  loadNetwork() (shared/motion/network.ts) always decodes -- typed so the
   *  bodies can read a path's geometry; the option's type is the phase A
   *  superset, so the graph is checked for, as the integrator checks. */
  let graph: GraphNetwork | null = null;
  let expectedNetwork: string | undefined;
  let networkRequest: Promise<void> | null = null;
  let networkBlocked = false;
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
  let emphasis: readonly PlaceKind[] | null = options.emphasis ?? null;
  /** Three states, not two: `null` is a surface that never asked for line
   *  focus at all (the kiosk passes no `lineFocus`), and it must draw exactly
   *  what it drew before F5 -- no ZET colour on the lit route, no focused
   *  route on a cluster. `false` is a reader who has the switch and turned it
   *  off, which is a different picture and keeps both. */
  let lineFocus: boolean | null = options.lineFocus ?? null;
  /** The focused route the overlays on the style were last built for, so a
   *  vehicle arriving (or leaving) re-derives them once, not every frame. */
  let focusedApplied: string | null = null;
  let prozor: ProzorOptions | null = options.prozor ?? null;
  let cityLabels: CityLabels = cityLabelsOf(options.cityLabels);
  let hitTolerance = options.hitTolerancePx ?? profile.hitTolerancePx;
  let closuresVisible = options.closures !== false;
  let stop: ScreenStop | null = options.stop ?? null;
  let outline: MapOutline | null = options.outline ?? null;
  let status: MapStatus = 'loading';
  let pendingCamera: MapCamera | null = null;
  let pendingSelectionFit: { padding?: FitPadding } | null = null;
  let cameraMovedByUser = false;
  /** A basemap asset has failed since the last tile that loaded. Before a
   *  usable style exists, the route/stop alternative must replace loading. */
  let basemapFailing = false;
  /** The feed is stale or down: the loop holds, separately from pause(), so old evidence is never reckoned forward as if live. */
  let held = false;
  /** The basemap and overlay layer lists as the live style carries them: what the next change is diffed against. */
  let basemap: StyleLayerLike[] = [];
  let overlays: StyleLayerLike[] = [];
  let cityOverlays: StyleLayerLike[] = [];
  /** The stops the map's `stops` source was built with (the census reads them for the names it would draw). */
  let stopsData: { features: readonly SourcePoint[] } = { features: [] };
  let cityPaths: MapLine[] = [];
  let lastDrawn: Drawn[] = [];
  let lastPushedSignature = '';
  /** Whether the bodies source last received bodies rather than the empty collection; see pushBodies. */
  let bodiesShown = false;
  let nextPushAt = -Infinity;
  let observer: MutationObserver | null = null;
  const strings = { getLocale: () => locale };

  // R-F5: the container is a named region, so MapLibre's zoom buttons and
  // the attribution link inside it are exposed by name; the image is the
  // canvas alone (set once the library has built it). An id the page
  // already gave the element is kept: the canvas points its label at it.
  container.setAttribute('role', 'region');
  function labelRegion(): void {
    container.setAttribute('aria-label', vetExternal('summary', options.ariaLabel, 'row') ?? '');
  }
  labelRegion();
  if (!container.id) container.id = `city-map-${++mapUid}`;
  container.dataset.mapStatus = status;

  function setStatus(next: MapStatus): void {
    if (status === next) return;
    status = next;
    container.dataset.mapStatus = next;
    options.onStatus?.(next);
  }

  /** The line the map is about: the selected route, or the route of the
   *  selected or followed vehicle, read off what the model is actually
   *  drawing. A vehicle the model has not placed yet focuses nothing -- there
   *  is no honest answer to "which line" until it has. */
  function focusedRouteId(): string | null {
    if (selection?.kind === 'route') return selection.id;
    const id = selection?.kind === 'vehicle' ? selection.id : typeof following === 'string' ? following : null;
    if (id === null) return null;
    return lastDrawn.find((v) => v.id === id)?.routeId ?? null;
  }

  /** The line the overlays are built for, or null on a surface that never
   *  asked for line focus -- which then gets no `focus` at all, and with it
   *  neither the ZET colour on the lit route nor a focused route on a
   *  cluster: the picture it drew before F5, to the pixel. */
  function focusRouteId(): string | null {
    return lineFocus === null ? null : focusedRouteId();
  }

  /** The route the pills and the network are lit for: under line focus the
   *  focused one, with the switch off the selected route alone (today's
   *  rule), and on a surface without the switch nothing -- a mixed cluster
   *  there keeps the '' it has always carried. */
  function litRouteId(): string | null {
    if (lineFocus === null) return null;
    if (lineFocus) return focusedRouteId();
    return selection?.kind === 'route' ? selection.id : null;
  }

  function overlayOptions(l: MaplibreModule, p: OverlayPalette): OverlayOptions {
    const routeId = focusRouteId();
    const type = routeId === null ? undefined : net?.routes.get(routeId)?.type ?? ZET_ROUTES[routeId]?.type;
    const focus = routeId === null
      ? null
      : { routeId, colour: l.lineColour(routeId, vehicleKind(type ?? ROUTE_TYPE_TRAM) === 'bus' ? p.routeBus : p.routeTram) };
    return { scale, modes, closuresVisible, selection, emphasis, prozor, screenStopId: stop?.id ?? null, lineFocus: lineFocus === true, focus, heldNames };
  }

  /** The vehicle the clustering must leave standing: the selected one, or the
   *  one the camera is following. */
  function keptVehicleId(): string | null {
    if (selection?.kind === 'vehicle') return selection.id;
    return typeof following === 'string' ? following : null;
  }

  // --- Read-only probe attributes -----------------------------------------
  //
  // `data-frames` has been written on this container since T11 for one
  // reason: a browser-level proof has to read what the renderer did without
  // diffing pixels. Round F adds three more of the same kind here, and a
  // fourth (`data-focus`) beside applyOverlays(). None of them changes what
  // is drawn, and each says what MapLibre did rather than what it was asked:
  //
  //   data-zoom   the camera's zoom at this frame, so an e2e states the zoom
  //               its assertion is about instead of trusting a fit to land
  //               there. Free: the value is read for the clustering anyway.
  //   data-pills  the label of every pill MapLibre actually renders, from the
  //               two pill layers (`vehicles` and, for the selected mark,
  //               `vehicle-selected`), '|'-joined in id order. Read from the
  //               screen, not from the collection that was pushed: what F2
  //               fixed is that a pill is never dropped at placement time,
  //               and the source carried both numbers before F2 as well, so
  //               a source-side list would pass against the old behaviour.
  //   data-noses  how many `vehicle-noses` features MapLibre renders. The
  //               nose band (overlays.ts NOSE_MIN_ZOOM/NOSE_MAX_ZOOM) is a
  //               claim about rendering, so this asks MapLibre too. The
  //               selected mark's own `vehicle-selected-nose` is deliberately
  //               not counted: it is a second layer with its own zoom range,
  //               and mixing the two would hide which of them the band moved.
  //   data-bodies how many vehicles `vehicle-bodies` renders a body for: the
  //               body's zoom floor (overlays.ts BODY_ZOOM) and the push that
  //               stops below it are both claims about what is on the screen.
  //               By vehicle, not by feature: MapLibre answers per tile, and
  //               a 32 m line over a tile seam comes back once from each side
  //               (the round-F pair at zoom 17 read three bodies for two).
  //   data-twoway how many opposed merges `vehicle-twoway-fore` renders an
  //               arrow for, by mark id for the same reason. The fore layer
  //               alone -- the aft one draws the same marks turned about, and
  //               counting both would say two for one pair. data-noses keeps
  //               to `vehicle-noses`, so the nose band's edges are still read
  //               off one layer.
  //
  // All of these come from ONE queryRenderedFeatures over those layers --
  // the call placedNames() already makes, scoped to the vehicles source -- on
  // MapLibre's `idle`, the one moment it has finished painting what it was
  // given. A live wall never reaches it: the pushes at 12 Hz keep MapLibre
  // painting, and a browser round on 23 September counted one `idle` in a
  // minute (the cold map's, before the fleet) against some 500 frames. So a
  // `render` on a still camera takes the census too, once the key it would be
  // taken for has waited PROBE_SETTLE_MS (name-census.ts settled) -- the same
  // passes as below, whichever of the two events comes first.
  //
  // It is taken only when the answer can have changed: the camera's
  // zoom (which layer draws, and which pills merge), the selection (which
  // layer the selected mark is in), whether the source has any marks at
  // all (the first snapshot landing on a cold map), and new evidence (below).
  // Precise cost: one pass per settled zoom, one per selection change, one
  // when the fleet first appears, one per update() -- and none while a
  // reader watches a still map, however many times a second the marks move
  // under it.
  //
  // What it deliberately does not follow is the fleet changing beneath a
  // fixed camera at the pushes' rate: a vehicle stepping on does not re-take
  // the census, because that would be a query per 12 Hz push for a test hook.
  // What it does follow is the evidence: every update() (a poll's beat, the
  // city's points changing) and every change to the city layers re-take it
  // at the next idle, because a wall's camera never moves and a census taken
  // once at start-up would say nothing about the hours after it.
  //
  // WP2 adds the marker census of the city layers to the same pass (see
  // name-census.ts markerCensus), written beside the vehicle attributes:
  //
  //   data-markers    the curated city marks drawn with their centre on the
  //                   screen (dots, once each)
  //   data-unlabelled the marks among them with neither a whole-number count
  //                   nor a name, the deliberate grey blank and far dot aside:
  //                   the wall's "every mark says something" (must be 0)
  //   data-bajs       `counted:N;zero:N;blank:N;far:N`, the BAJS discs by
  //                   what they say
  //   data-overlaps   `discs:N;names:N`: marks whose number a pill covers,
  //                   and the app's own names and place marks (stop names,
  //                   the screen's stop, city and place labels) a pill's box
  //                   (the capsule as drawn) crosses. One small query per
  //                   rendered pill.
  //   data-disc-pills the pills over those numbers, per mark: `discs` never
  //                   exceeds it, because a covered number is a pill passing
  //   data-own-name   the screen's own name as MapLibre drew it ('' when
  //                   not): decision 19 draws it always, and data-overlaps
  //                   counts every OTHER name a pill crosses
  //   data-own-name-crossed the seconds a pill has crossed the own name, on
  //                   the public screen (name-census.ts nameTick, ten looks a
  //                   second)
  //   data-hidden-names the names the style would draw on the screen (the
  //                   name layers' own filter, text and zoom over what their
  //                   sources were handed, nameCandidates) that the collision
  //                   pass held back: where the wall's names yield to its
  //                   pills (decision 17), this is how many are yielding
  /** Whether the last pushed collection had any mark at all; see probeKeyOf. */
  let probeHasMarks = false;
  /** Bumped by update() and applyCityOverlays(): the census is re-taken at the next idle, or the next settled still frame. */
  let probeVersion = 0;

  function writeMarkProbe(m: MapApi, pushed: VehicleFeatureCollection | null): void {
    container.dataset.zoom = m.getZoom().toFixed(2);
    if (pushed) probeHasMarks = pushed.features.length > 0;
  }

  /** The census key for the map as it stands: zoom, selection, "has any marks" and the evidence version. */
  function probeKeyOf(m: MapApi): string {
    return `${m.getZoom().toFixed(2)}|${selection ? `${selection.kind}:${selection.id}` : ''}|${probeHasMarks ? 1 : 0}|${probeVersion}`;
  }
  /** The names decision 19's hysteresis holds on the public screen
   *  (name-census.ts createRenderCensus), which the overlays are built with. */
  let heldNames: readonly string[] = [];

  /** The point features a name layer's source was last handed, for
   *  nameCandidates: the stops as the map was built with them, the screen's
   *  stop, the places and the city's own places as update() last set them. */
  function sourcePoints(l: MaplibreModule, id: string): readonly SourcePoint[] {
    if (id === l.SOURCES.stops) return stopsData.features;
    if (id === l.SOURCES.screenStop) return l.screenStopGeoJson(stop).features as SourcePoint[];
    if (id === l.SOURCES.places) return l.pointsToGeoJson(points.filter((p) => p.place !== 'city'), wallLabels).features;
    if (l.CITY_POINTS && id === l.CITY_POINTS) return l.pointsToGeoJson(points.filter((p) => p.place === 'city'), wallLabels).features;
    return [];
  }

  /** `data-focus`: what line focus did, read back off the live style once the
   *  diff has been applied -- the focused route, whether the tram network is
   *  still drawn, and the ink `network-selected` carries (a plain colour when
   *  the ZET table knows the route, '-' while it is the by-mode expression).
   *  Written once per overlay re-derive (a selection, the switch, a theme
   *  flip), never per frame; two MapLibre getters and no work of the map's. */
  function writeFocusProbe(m: MapApi, l: MaplibreModule): void {
    const colour = m.getPaintProperty?.(l.LAYERS.networkSelected, 'line-color');
    const visibility = m.getLayoutProperty?.(l.LAYERS.networkTram, 'visibility');
    container.dataset.focus = [
      focusRouteId() ?? '-',
      typeof visibility === 'string' ? visibility : '-',
      typeof colour === 'string' ? colour : '-',
    ].join(' ');
  }

  /** One frame: the model stepped to `t`, the source pushed at 12 Hz when it changed, the camera kept on a followed vehicle. */
  function draw(t: number): boolean {
    // Detached (the dashboard swapped layers and took the workspace along):
    // paint nothing, report no change, let the loop park; the next render's
    // update() nudges it awake.
    const l = lib;
    const m = map;
    if (!model || !m || !styled || !l || !container.isConnected) return false;
    lastDrawn = model.step(t);
    // The selected vehicle's line becomes knowable the moment the model first
    // places it, and stops being so when it goes quiet: one re-derive on the
    // change, never a styleDiff per frame.
    if (focusRouteId() !== focusedApplied) applyOverlays();
    // What a frame costs when nothing is pushed: one feature per vehicle and
    // the string over it. The clustering is a screen-space pass over every
    // mark, and it runs where its result is used -- inside the push below --
    // not sixty times a second to answer a question the plain marks already
    // answer (vehicle-features.ts vehicleSignature).
    const kept = keptVehicleId();
    container.dataset.frames = String(loop.frames());
    const signature = l.vehicleSignature(l.vehiclesToGeoJson(lastDrawn), kept);
    const changed = signature !== lastPushedSignature;
    const pushing = changed && t >= nextPushAt - PUSH_TOLERANCE_MS;
    let fc: VehicleFeatureCollection | null = null;
    if (pushing) {
      // The pills are merged against the camera of this very frame, so a mark
      // never merges with one the reader can see is somewhere else -- and only
      // where pills are drawn at all: below PILL_ZOOM every vehicle is a small
      // dot, nothing can pile up, and merging there would empty the city of the
      // marks that say it is moving.
      const project = m.project && m.getZoom() >= l.PILL_ZOOM ? (lonLat: [number, number]) => m.project!(lonLat) : undefined;
      fc = l.vehiclesToGeoJson(lastDrawn, { project, selectedId: kept, symbolScale: scale, focusedRoute: litRouteId() ?? undefined });
      m.getSource(l.SOURCES.vehicles)?.setData(fc);
      pushBodies(m, l);
      lastPushedSignature = signature;
      // Stay on the 12 Hz grid while frames keep coming; re-anchor after a
      // park, when the old grid is long behind us.
      nextPushAt = nextPushAt + SOURCE_UPDATE_INTERVAL_MS > t ? nextPushAt + SOURCE_UPDATE_INTERVAL_MS : t + SOURCE_UPDATE_INTERVAL_MS;
      if (following === true) followRoute();
      else if (following) followCamera(fc);
    }
    writeMarkProbe(m, fc);
    return changed;
  }

  /** The outage (setFeedState('down')): every vehicle mark off the map and
   *  out of the model, so neither a held mark nor a vehicle's history outlives
   *  it; the stops, the network, the places and the city's own marks are
   *  other sources and stay. The census follows at the next idle. */
  function clearVehicles(): void {
    if (model) model = createIntegrator(net);
    lastDrawn = [];
    lastPushedSignature = '';
    const m = map;
    const l = lib;
    if (m && styled && l) {
      const empty: VehicleFeatureCollection = { type: 'FeatureCollection', features: [] };
      m.getSource(l.SOURCES.vehicles)?.setData(empty);
      m.getSource(l.SOURCES.bodies)?.setData({ type: 'FeatureCollection', features: [] });
      bodiesShown = false;
      writeMarkProbe(m, empty);
    }
    probeVersion++;
  }

  /** The bodies go with the pills on the frames that push, from BODY_ZOOM up.
   *  Below it the layer draws nothing whatever the source holds, so the
   *  source is emptied once and then left alone -- one setData per push
   *  again the moment the camera comes back in, not one per push for a
   *  layer that is not drawing. */
  function pushBodies(m: MapApi, l: MaplibreModule): void {
    const shown = m.getZoom() >= l.BODY_ZOOM;
    if (!shown && !bodiesShown) return;
    m.getSource(l.SOURCES.bodies)?.setData(shown ? l.bodiesToGeoJson(lastDrawn, graph) : { type: 'FeatureCollection', features: [] });
    bodiesShown = shown;
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

  /** Route follow: the selected route's vehicles kept in frame, refitted at
   *  most every ROUTE_FOLLOW_MS. Read off the model's own output rather than
   *  the pushed source: a clustered feature belongs to several routes at once
   *  and would drop half the route out of the frame. */
  function followRoute(): void {
    const sel = selection;
    if (!map || sel?.kind !== 'route') return;
    const t = now();
    if (t - routeFollowAt < ROUTE_FOLLOW_MS) return;
    const coords = lastDrawn.filter((v) => v.routeId === sel.id).map((v) => toLonLat(v.p));
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
    setData(lib.SOURCES.places, lib.pointsToGeoJson(points.filter(p=>p.place!=='city'), wallLabels));
    if (lib.CITY_POINTS) setData(lib.CITY_POINTS, lib.pointsToGeoJson(points.filter(p=>p.place==='city'), wallLabels));
    setData(lib.SOURCES.closures, lib.linesToGeoJson(lines, wallLabels));
  }

  function installNetwork(network: Network | null): void {
    net = network;
    graph = network && 'paths' in network ? network as GraphNetwork : null;
    model = createIntegrator(net);
    lastDrawn = [];
    lastPushedSignature = '';
    nextPushAt = -Infinity;
    if (styled && lib) {
      // The named features come from the lazy renderer (external-features.ts
      // through maplibre-entry), and the census reads the stops it was last handed.
      const empty = { type: 'FeatureCollection', features: [] };
      setData(lib.SOURCES.network, net ? lib.networkToGeoJson(net) : empty);
      const stops = net ? lib.stopsToGeoJson(net) : empty;
      stopsData = stops;
      setData(lib.SOURCES.stops, stops);
      applyOverlays();
    }
    options.onNetwork?.(net);
  }

  /** Never evaluate a new arc on old rails, even for the frame before an
   *  async reload settles. A failed load stays empty and retries next poll. */
  function acceptNetwork(fixes: readonly Fix[]): boolean {
    expectedNetwork = fixes.find(f => f.network)?.network ?? expectedNetwork;
    if (!expectedNetwork || (graph?.graphHash === expectedNetwork && !networkBlocked)) return true;
    if (!networkBlocked) {
      networkBlocked = true;
      container.dataset.networkStale = 'true';
      installNetwork(null);
      model = null;
      const empty = { type: 'FeatureCollection', features: [] };
      if (styled && lib) {
        setData(lib.SOURCES.vehicles, empty);
        setData(lib.SOURCES.bodies, empty);
      }
    }
    if (!networkRequest) {
      const requested = expectedNetwork;
      const reload = options.reloadNetwork ?? (() => loadNetwork((input, init) => fetch(input, { ...init, cache: 'reload' })));
      networkRequest = (async () => {
        const network = await reload();
        if (disposed || requested !== expectedNetwork || !network || !('graphHash' in network) || network.graphHash !== expectedNetwork) return;
        networkBlocked = false;
        delete container.dataset.networkStale;
        installNetwork(network);
        model!.update(pointsToFixes(points), now());
        loop.nudge();
      })().catch(() => {
        // Last-good geometry is not usable for this payload. Retry next poll.
      }).finally(() => {
        networkRequest = null;
        if (!disposed && requested !== expectedNetwork) acceptNetwork(pointsToFixes(points));
      });
    }
    return false;
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
    installNetwork(network);
    const fixes = pointsToFixes(points);
    if (acceptNetwork(fixes)) model!.update(fixes, now());
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
      'AttributionControl.ToggleAttribution': tr(strings, 'mapAttribution'),
      'GeolocateControl.FindMyLocation': tr(strings, 'findMyLocation'),
      'GeolocateControl.LocationNotAvailable': tr(strings, 'locationUnavailable'),
      'CooperativeGesturesHandler.WindowsHelpText': tr(strings, 'coopWindows'),
      'CooperativeGesturesHandler.MacHelpText': tr(strings, 'coopMac'),
      'CooperativeGesturesHandler.MobileHelpText': tr(strings, 'coopMobile'),
      'ScaleControl.Meters': 'm',
      'ScaleControl.Kilometers': 'km',
    };
  }

  /** A map of places alone (the dashboard's quake map) fits its places once
   *  the style is up. Tagged city points do not count: a public screen whose
   *  stop is not set yet still carries the on-duty pharmacy and the recent
   *  quakes, and fitting the camera to those would frame a pharmacy instead of
   *  the city. */
  function placesOnly(): boolean {
    const drawn = points.filter((p) => !isVehicleReport(p));
    return drawn.length > 0 && drawn.length === points.length && drawn.every((p) => p.place === undefined);
  }

  function initialCamera(l: MaplibreModule): MapCamera {
    if (pendingCamera) return pendingCamera;
    if (options.center) return { center: options.center, zoom: options.zoom ?? FOCUS_ZOOM };
    if (stop && Number.isFinite(stop.lon) && Number.isFinite(stop.lat)) return { center: [stop.lon, stop.lat], zoom: options.zoom ?? 15 };
    return { center: ZAGREB_CENTER, zoom: options.zoom ?? l.CITY_ZOOM };
  }

  let updateTileLabels: ((map: MapApi, locale: string) => void) | undefined;
  const wallLabels = options.presentationProfile === 'public-display' || options.basemapProfile === 'prozor';
  function refreshTileLabels(): void {
    if (styled && map) updateTileLabels?.(map, locale ?? 'hr');
  }
  function buildMap(l: MaplibreModule): void {
    // Personal pages load the boundary with the renderer, after the initial
    // fail-closed region write. Restore its safe name once that import settles.
    labelRegion();
    const style = l.basemapStyle(theme, basemapOptions());
    const vetted = wallLabels ? l.prepareWallStyle(style) : null;
    updateTileLabels = vetted?.refresh;
    const safeStyle = vetted?.style ?? style;
    basemap = safeStyle.layers;
    const start = initialCamera(l);
    const created = new l.Map({
      container,
      style: safeStyle as never,
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
      cooperativeGestures: options.cooperative === true,
      // The collision fade: 300 ms, and on the public screen always (decision
      // 19): a name yielding to a passing pill fades rather than blinks, and a
      // fade is no movement across the screen.
      fadeDuration: reduced && !options.prozor ? 0 : 300,
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
    // The compact credit sits bottom-left: on the phone stage the right edge holds the zoom and the tools, and on a
    // short stage (a small phone, a landscape one) the two would collide.
    const compact = options.attributionCompact === true;
    created.addControl(new l.AttributionControl({ compact, customAttribution: l.MAP_ATTRIBUTION_HTML }), 'bottom-right');
    if (compact) {
      // MapLibre initially expands even its compact control. Keep the full
      // credit in the native disclosure, without covering the phone's map
      // before a reader asks for it. Subsequent toggles remain library-owned.
      const credit = container.querySelector<HTMLDetailsElement>('details.maplibregl-ctrl-attrib');
      if (credit) { credit.open = false; credit.classList.remove('maplibregl-compact-show'); }
    }
    // A scale bar belongs to a map one can move; on a thumbnail it only collided with the credit (kajimafix 01.8).
    if (interactive) created.addControl(new l.ScaleControl({ maxWidth: 80, unit: 'metric' }), 'bottom-left');
    if (interactive) created.addControl(new l.NavigationControl({ showCompass: false }), 'top-right');
    // A person's own position, under the zoom on the right: asked for only on the tap, never on load. A public wall has no owner to locate.
    if (interactive && !options.prozor && typeof l.GeolocateControl === 'function') created.addControl(new l.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, fitBoundsOptions: { maxZoom: 16 }, showAccuracyCircle: true }), 'top-right');
    created.on('error', onMapError);
    created.on('styleimagemissing', (event) => onImageMissing(created, event));
    created.on('sourcedata', onSourceData);
    created.on('webglcontextlost', () => setStatus('unavailable'));
    created.on('webglcontextrestored', () => setStatus(styled ? 'ready' : 'loading'));
    created.on('move', onCameraMove);
    created.on('moveend', onMoveEnd);
    created.on('moveend', refreshTileLabels);
    if (options.onCamera) created.on('zoomend', () => { const camera = cameraOf(created); if (camera) options.onCamera!(camera); });
    // The one moment MapLibre has finished painting what it was given: the
    // honest place to ask it what it drew (see the probe comment above), and,
    // for the live wall that never gets there, a still frame that has settled.
    const census = l.createRenderCensus(created, l, {
      container,
      now,
      styled: () => styled && map === created,
      key: () => probeKeyOf(created),
      scale: () => scale,
      overlays: () => overlays,
      cityOverlays: () => cityOverlays,
      sourcePoints: (id) => sourcePoints(l, id),
      stop: () => stop,
      prozor: () => prozor !== null,
      hold: (names) => { heldNames = names; applyOverlays(); },
    });
    created.on('idle', census.idle);
    created.on('render', census.settled);
    created.on('render', census.nameTick);
    if (interactive) {
      l.bindCityMapPointer(created, l, {
        container,
        styled: () => styled,
        hitTolerance: () => hitTolerance,
        closuresVisible: () => closuresVisible,
        basemap: () => basemap,
        resolveStreet: options.resolveStreet,
        siblingPlatforms,
        drawn: () => lastDrawn,
        fitCoordinates,
        selection: () => selection,
        choose: (next) => {
          select(next);
          options.onSelect?.(next);
        },
      });
    }
    created.once('load', () => onLoad(l, created));
    watchTheme();
  }

  /** The style is up: images, sources and overlay layers go on, then the loop starts. */
  function onLoad(l: MaplibreModule, created: MapApi): void {
    if (disposed || map !== created) return;
    putOverlayImages(created, l, false);
    const empty = { type: 'FeatureCollection', features: [] };
    const geojson = (data: unknown): Record<string, unknown> => ({ type: 'geojson', data });
    created.addSource(l.SOURCES.network, geojson(net ? l.networkToGeoJson(net) : empty));
    const stops = net ? l.stopsToGeoJson(net) : empty;
    stopsData = stops;
    // Keyed by the platform id, so the name hysteresis addresses one stop's
    // name by feature state (decision 19).
    created.addSource(l.SOURCES.stops, { ...geojson(stops), promoteId: 'id' });
    created.addSource(l.SOURCES.closures, geojson(l.linesToGeoJson(lines, wallLabels)));
    created.addSource(l.SOURCES.places, geojson(l.pointsToGeoJson(points.filter(p=>p.place!=='city'), wallLabels)));
    if (l.CITY_POINTS) {
      created.addSource(l.CITY_POINTS, geojson(l.pointsToGeoJson(points.filter(p=>p.place==='city'), wallLabels)));
      created.addSource(l.CITY_PATHS, geojson(l.linesToGeoJson(cityPaths, wallLabels)));
    }
    created.addSource(l.SOURCES.vehicles, geojson(empty));
    created.addSource(l.SOURCES.bodies, geojson(empty));
    created.addSource(l.SOURCES.screenStop, geojson(l.screenStopGeoJson(stop)));
    created.addSource(l.SOURCES.outline, geojson(l.outlineToGeoJson(outline)));
    const palette = l.overlayPalette(theme);
    created.addSource('ambient-highlight',geojson(highlightData()));
    created.addLayer({id:'ambient-highlight-area',type:'fill',source:'ambient-highlight',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':palette.selection,'fill-opacity':0.12}});
    overlays = l.overlayLayers(palette, overlayOptions(l, palette));
    focusedApplied = focusRouteId();
    const beforeId = l.firstSymbolLayer(basemap);
    for (const layer of overlays) created.addLayer(layer as unknown as Record<string, unknown>, l.BELOW_LABELS.has(layer.id) ? beforeId : undefined);
    if (l.cityLayers) {
      cityOverlays = l.cityLayers(l.overlayPalette(theme),selection?.kind==='place'?selection.id:null,scale,cityLabels);
      // Under the vehicles. A BAJS station stands still and a tram does not:
      // appended on top, a standing teal dot sat over the plate of a passing
      // cluster, hiding the one mark on this map that is about right now.
      // Only the selection ring stays over them, so what a person just tapped
      // is never hidden by a pill crossing it.
      for (const layer of cityOverlays) created.addLayer(layer as unknown as Record<string,unknown>, layer.id === l.CITY_SELECTION ? undefined : l.LAYERS.vehicleDots);
    }
    created.addLayer({id:'ambient-highlight-line',type:'line',source:'ambient-highlight',filter:['!=',['geometry-type'],'Point'],paint:{'line-color':palette.selection,'line-width':3*scale}});
    created.addLayer({id:'ambient-highlight-point',type:'circle',source:'ambient-highlight',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':18*scale,'circle-opacity':0,'circle-stroke-color':palette.selection,'circle-stroke-width':2*scale}});
    styled = true;
    refreshTileLabels();
    // A resize or a deliberate presentation can arrive before the library or
    // style finishes loading. Apply the latest request before reporting ready,
    // never certify the constructor's now-obsolete frame.
    if (pendingCamera) {
      const camera = pendingCamera;
      pendingCamera = null;
      created.jumpTo({ ...camera, offset: offsetFor() });
    } else if (pendingSelectionFit) {
      const fit = pendingSelectionFit;
      pendingSelectionFit = null;
      fitSelection(fit.padding);
    } else if (!cameraMovedByUser && !options.center && !stop && placesOnly()) fitPlaces();
    else if (!cameraMovedByUser && !options.center && selection) fitSelection();
    if (typeof following === 'string') centreOn(following);
    setStatus(basemapFailing ? 'tiles-failed' : 'ready');
    if (!paused && !held) loop.start();
  }

  function fitPlaces(): void {
    fitCoordinates(points.filter((p) => !isVehicleReport(p) && Number.isFinite(p.lon) && Number.isFinite(p.lat)).map((p): [number, number] => [p.lon, p.lat]), 11);
  }

  function fitCoordinates(coords: readonly [number, number][], maxZoom: number, padding?: FitPadding): void {
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
    if (w === e && s === n) map.easeTo({ center: [w, s], zoom: maxZoom, offset: offsetFor(padding), duration: reduced ? 0 : CAMERA_MS });
    else map.fitBounds([[w, s], [e, n]], { padding: paddingFor(padding), maxZoom, duration: reduced ? 0 : CAMERA_MS });
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
    if (!styled) setStatus('unavailable');
    else if (status === 'ready') setStatus('tiles-failed');
  }

  /** A basemap tile arriving after a failure: the basemap is back. */
  function onSourceData(event: MapEventLike): void {
    if (lib === null || event.sourceId !== lib.BASEMAP_SOURCE || event.tile === undefined) return;
    refreshTileLabels();
    basemapFailing = false;
    if (styled && status === 'tiles-failed') setStatus('ready');
  }

  /** The overlays' SDF images at the map's symbol scale. The pill and the
   *  plate stretch to their numbers (icon-text-fit) and are drawn at that
   *  scale, since MapLibre places a stretchable image's fixed ends in pixels
   *  it never multiplies by icon-size (overlays.ts overlayImages); so a new
   *  scale replaces exactly the images that carry stretch options, and the
   *  fixed marks, sized by icon-size, stay. MapLibre re-lays out the tiles
   *  that use a replaced image. */
  function putOverlayImages(m: MapApi, l: MaplibreModule, replace: boolean): void {
    for (const { id, image, options } of l.overlayImages(scale)) {
      if (replace && !options) continue;
      if (replace && m.hasImage?.(id)) m.removeImage?.(id);
      m.addImage(id, image, { sdf: true, pixelRatio: l.SDF_PIXEL_RATIO, ...options });
    }
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

  /** The camera moved (a drag, a wheel, one of the wrapper's own eases). Which
   *  pills overlap is a screen-space question, so the same vehicles standing
   *  still merge at one zoom and separate at the next: the next frame has to
   *  push again even though nothing in the model changed, and the loop has to
   *  be awake to draw it. */
  function onCameraMove(): void {
    lastPushedSignature = '';
    loop.nudge();
  }

  /** A move a person made (drag, wheel, keyboard) ends a follow; the wrapper's own easeTo carries no originalEvent. */
  function onMoveEnd(event: MapEventLike): void {
    if (!event.originalEvent || !map) return;
    pendingCamera = null;
    pendingSelectionFit = null;
    cameraMovedByUser = true;
    following = null;
    options.onUserMove?.(cameraOf(map));
  }

  /** Every platform of the artefact sharing a name: one stop, whichever side of the street. */
  function siblingPlatforms(name: string): string[] | undefined {
    if (!net) return undefined;
    const ids = net.stops.filter((s) => s.name === name).map((s) => s.id);
    return ids.length > 1 ? ids : undefined;
  }

  /** Applies style ops to the live map; a layer the style lost is skipped, never fatal. */
  function applyOps(m: MapApi, ops: readonly StyleOp[]): void {
    for (const op of ops) {
      try {
        if (op.kind === 'paint') m.setPaintProperty(op.id, op.key, op.value);
        else if (op.kind === 'layout') m.setLayoutProperty(op.id, op.key, op.value);
        else if (op.kind === 'filter') m.setFilter(op.id, op.value);
        else {
          const [minzoom, maxzoom] = op.value as [number, number];
          m.setLayerZoomRange?.(op.id, minzoom, maxzoom);
        }
      } catch {
        /* a layer id the style does not carry */
      }
    }
  }

  /** The names MapLibre actually placed for one layer, once each: what the
   *  collision pass let through, not what the tiles carry. Nothing before the
   *  style is up, and nothing for a layer the style does not carry (asking
   *  MapLibre about one would fire an error event, which onMapError logs as a
   *  bug). */
  function placedNames(layerId: string): string[] {
    const m = map;
    if (!m || !styled || (m.getLayer && !m.getLayer(layerId))) return [];
    const names = new Set<string>();
    for (const feature of m.queryRenderedFeatures(undefined, { layers: [layerId] })) {
      const name = feature.properties.name;
      if (typeof name === 'string' && name) names.add(name);
    }
    return [...names];
  }

  /** Re-derives the overlays for the current state and applies what changed: paint on a theme flip, filters and visibility for a selection or a mode toggle. */
  function applyOverlays(): void {
    const l = lib;
    if (!map || !styled || !l) return;
    const palette = l.overlayPalette(theme);
    const next = l.overlayLayers(palette, overlayOptions(l, palette));
    applyOps(map, l.styleDiff(overlays, next));
    overlays = next;
    focusedApplied = focusRouteId();
    writeFocusProbe(map, l);
  }

  /** Re-derives the city-place layers for the current theme, selection and
   *  label switch and applies what changed -- the sibling of applyOverlays for
   *  the layers city-layers.ts owns. */
  function applyCityOverlays(): void {
    const l = lib;
    if (!map || !styled || !l?.cityLayers) return;
    const next = l.cityLayers(l.overlayPalette(theme), selection?.kind === 'place' ? selection.id : null, scale, cityLabels);
    applyOps(map, l.styleDiff(cityOverlays, next));
    cityOverlays = next;
    probeVersion++;
  }

  /** Selects (or clears with null) and marks it on the map; `fit` moves the camera to it. */
  function select(next: MapSelection | null, opts: { fit?: boolean } = {}): void {
    selection = next;
    // A vehicle follow ends with any other selection; a route follow ends with anything but a route.
    if (typeof following === 'string' && next?.kind !== 'vehicle') following = null;
    if (following === true && next?.kind !== 'route') following = null;
    applyOverlays();
    applyCityOverlays();
    if (opts.fit) fitSelection();
  }

  function centreOn(vehicleId: string, padding?: FitPadding): void {
    const v = lastDrawn.find((d) => d.id === vehicleId);
    if (!v || !map) return;
    map.easeTo({ center: toLonLat(v.p), zoom: Math.max(map.getZoom(), FOCUS_ZOOM), offset: offsetFor(padding), duration: reduced ? 0 : CAMERA_MS });
  }

  /** The camera to the selection: a route's whole geometry, a closure's line, a stop or a vehicle centred, zoomed in to FOCUS_ZOOM and never out.
   *  `padding` is this fit's own extra clearance beyond the standing fitPadding. */
  function fitSelection(padding?: FitPadding): void {
    const sel = selection;
    if (!sel) return;
    pendingCamera = null;
    if (!map) { pendingSelectionFit = { padding }; return; }
    pendingSelectionFit = null;
    switch (sel.kind) {
      case 'place': {
        const point=points.find(p=>p.place==='city'&&p.id===sel.id);
        if(point)fitCoordinates([[point.lon,point.lat]],16,padding);
        return;
      }
      case 'street': return;
      case 'route': {
        if (!net) return;
        const coords: [number, number][] = [];
        for (const idx of net.routes.get(sel.id)?.shapes ?? []) for (const p of net.shapes[idx]?.pts ?? []) coords.push(toLonLat(p));
        fitCoordinates(coords, 15, padding);
        return;
      }
      case 'stop': {
        const ids = new Set([sel.id, ...(sel.ids ?? [])]);
        const coords = (net?.stops ?? []).filter((s) => ids.has(s.id)).map((s) => toLonLat(s.p));
        if (coords.length === 0 && stop && ids.has(stop.id)) coords.push([stop.lon, stop.lat]);
        if (coords.length === 0) return;
        const centre = coords.reduce<[number, number]>(([a, b], [x, y]) => [a + x / coords.length, b + y / coords.length], [0, 0]);
        map.easeTo({ center: centre, zoom: Math.max(map.getZoom(), FOCUS_ZOOM), offset: offsetFor(padding), duration: reduced ? 0 : CAMERA_MS });
        return;
      }
      case 'vehicle':
        centreOn(sel.id, padding);
        return;
      case 'closure': {
        const line = lines.find((c) => c.id === sel.id);
        if (line) fitCoordinates(line.coordinates, 16, padding);
      }
    }
  }

  /** Every option the basemap is built from, in one place. A theme or locale
   *  flip rebuilds the layer list, and before this builder existed both sites
   *  wrote the object out by hand and dropped anything not in that literal --
   *  a silent regression on the surface that flips theme twice a day. The
   *  kiosk set's street-name padding rides along (basemap.ts roads_labels_major). */
  function basemapOptions(): BasemapStyleOptions {
    return { locale, origin: deps.origin, placeLabels: options.placeLabels, profile: options.basemapProfile, ...(prozor ? { labelPadding: prozor.labelPadding, majorStreetNames: prozor.majorStreetNames !== false } : {}) };
  }

  /** Re-derives the basemap for the current theme and options and applies what moved: a face flip, a locale switch, a changed prozor set. */
  function applyBasemap(): void {
    const l = lib;
    if (!map || !styled || !l) return;
    const raw = l.basemapLayers(theme, basemapOptions());
    const nextBasemap = wallLabels ? l.wallLabelLayers(raw).layers : raw;
    applyOps(map, l.styleDiff(basemap, nextBasemap));
    basemap = nextBasemap;
    refreshTileLabels();
  }

  function setTheme(next: MapTheme): void {
    if (next === theme) return;
    theme = next;
    const l = lib;
    if (!map || !styled || !l) return;
    applyBasemap();
    map.setSprite?.(l.spriteUrl(next, deps.origin));
    applyOverlays();
    applyCityOverlays();
    applyHighlightStyle();
  }

  function applyHighlightStyle(): void {
    if(!map||!styled||!lib)return;
    const color=lib.overlayPalette(theme).selection;
    map.setPaintProperty('ambient-highlight-area','fill-color',color);
    map.setPaintProperty('ambient-highlight-line','line-color',color);
    map.setPaintProperty('ambient-highlight-line','line-width',3*scale);
    map.setPaintProperty('ambient-highlight-point','circle-stroke-color',color);
    map.setPaintProperty('ambient-highlight-point','circle-radius',18*scale);
    map.setPaintProperty('ambient-highlight-point','circle-stroke-width',2*scale);
  }

  function setLocale(next: string): void {
    if (next === locale) return;
    locale = next;
    if (!map || !styled || !lib) return;
    applyBasemap();
    relabelControls();
  }

  /** MapLibre labelled its controls at construction; a locale switch re-labels the buttons in place. */
  function relabelControls(): void {
    const labels = controlStrings();
    const pairs: [string, string][] = [
      ['.maplibregl-ctrl-zoom-in', labels['NavigationControl.ZoomIn']],
      ['.maplibregl-ctrl-zoom-out', labels['NavigationControl.ZoomOut']],
      ['.maplibregl-ctrl-attrib-button', labels['AttributionControl.ToggleAttribution']],
      ['.maplibregl-ctrl-geolocate', labels['GeolocateControl.FindMyLocation']],
    ];
    for (const [selector, label] of pairs) {
      const el = container.querySelector<HTMLElement>(selector);
      if (!el) continue;
      const controlLabel = vetExternal('summary', label, 'row') ?? '';
      el.setAttribute('aria-label', controlLabel);
      el.title = controlLabel;
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
      if (selection?.kind === 'route') followRoute();
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
        ...(v.headsign !== undefined ? { headsign: v.headsign } : {}),
        ...(v.tripId !== undefined ? { tripId: v.tripId } : {}),
        ...(v.nextStopId !== undefined ? { nextStopId: v.nextStopId } : {}),
        ...(v.delaySeconds !== undefined ? { delaySeconds: v.delaySeconds } : {}),
        ...(v.nextStopEtaMs !== undefined ? { nextStopEtaMs: v.nextStopEtaMs } : {}),
      };
    });
  }

  function setEmphasis(next: readonly PlaceKind[] | null): void {
    if (JSON.stringify(next ?? null) === JSON.stringify(emphasis ?? null)) return;
    emphasis = next;
    applyOverlays();
  }

  const move = (center: [number, number], zoom: number): void => {
    pendingSelectionFit = null;
    if (!styled) pendingCamera = { center: [...center], zoom };
    map?.easeTo({ center, zoom, offset: offsetFor(), duration: reduced ? 0 : CAMERA_MS });
  };

  return {
    update(nextPoints, nextLines) {
      points = nextPoints;
      lines = nextLines;
      // Evidence in, motion out: the model folds the reports into each
      // vehicle's own history and the loop draws where it says. Places and
      // closures do not move and are re-set at once.
      const fixes = pointsToFixes(points);
      if (model || networkBlocked) {
        if (acceptNetwork(fixes)) model?.update(fixes, now());
      }
      applyStatic();
      probeVersion++;
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
      if (view.padding) fitPadding = { ...view.padding };
      if (view.emphasis !== undefined) setEmphasis(view.emphasis);
      const next = view.selection ?? viewSelection(view.selectedRoute, view.selectedStop);
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
    setCityLabels(on) {
      const next = cityLabelsOf(on);
      if (next === cityLabels) return;
      cityLabels = next;
      applyCityOverlays();
    },
    setEmphasis,
    setLineFocus(on) {
      if (on === lineFocus) return;
      lineFocus = on;
      applyOverlays();
    },
    setCityPaths(next) { cityPaths=next; if(styled&&lib?.CITY_PATHS)setData(lib.CITY_PATHS,lib.linesToGeoJson(next,wallLabels)); },
    setHighlight(next) {
      if(JSON.stringify(next)===JSON.stringify(highlight))return;
      highlight=next;
      if(styled)setData('ambient-highlight',highlightData());
    },
    setPresentationProfile(name,nextScale) {
      const next=MAP_PRESENTATIONS[name],size=nextScale??next.symbolScale;
      if(next===profile&&size===scale)return;
      const rescaled=size!==scale;
      profile=next;scale=size;hitTolerance=next.hitTolerancePx;
      container.dataset.presentationProfile=name;
      if(rescaled&&map&&styled&&lib)putOverlayImages(map,lib,true);
      lastPushedSignature='';
      applyOverlays();applyCityOverlays();applyHighlightStyle();
    },
    setClosuresVisible(visible) {
      closuresVisible = visible;
      applyOverlays();
    },
    setFeedState(state) {
      // R-TE5: the snapshot's status is the twin's health. `stale` is the
      // twin's last-good copy, whose vehicles carry their own history and
      // confidence, so the motion keeps integrating and fades on its own;
      // only `down` (nothing at all) stops it -- and takes the vehicles off
      // the map (review-w, P1): an outage is no evidence of where a tram is,
      // and a mark held where it last was said so for as long as the outage
      // lasted. Live again, a vehicle is drawn from a fresh report only.
      const next = state === 'down';
      container.dataset.feed = state;
      if (next === held) return;
      held = next;
      if (held) {
        loop.stop();
        clearVehicles();
      } else if (styled && !paused) loop.start();
    },
    setStop(next) {
      stop = next;
      if (styled && lib) setData(lib.SOURCES.screenStop, lib.screenStopGeoJson(stop));
    },
    setOutline(next) {
      if (next?.id === outline?.id) return;
      outline = next;
      if (styled && lib) setData(lib.SOURCES.outline, lib.outlineToGeoJson(outline));
    },
    fit(target) {
      if (!map || !lib) return;
      if (target === 'city') move(ZAGREB_CENTER, lib.CITY_ZOOM);
      else if (target === 'selection') fitSelection();
      else if (stop && Number.isFinite(stop.lon) && Number.isFinite(stop.lat)) move([stop.lon, stop.lat], Math.max(map.getZoom(), 15));
    },
    setFitPadding(next) {
      fitPadding = { ...next };
    },
    camera: () => (map ? cameraOf(map) : null),
    status: () => status,
    network: () => net,
    vehicles,
    setProzor(next) {
      if (JSON.stringify(next) === JSON.stringify(prozor)) return;
      prozor = next;
      // The set's street-name padding lives on a basemap layer; the rest on the overlays.
      applyBasemap();
      applyOverlays();
    },
    placedNames,
  };
}
