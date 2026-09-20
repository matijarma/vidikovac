// What sits on top of the basemap -- the route network, closures, places,
// stops and their names, the screen's own stop, the motion model's vehicles
// as numbered pills with a direction nose, and the selection marks -- as
// MapLibre layer specs built from an OverlayPalette (basemap.ts). Pure: no
// DOM, no MapLibre import, so the layer list, the filters and the declutter
// thresholds are unit-tested in node, and a theme flip on the live map is
// styleDiff(overlayLayers(light), overlayLayers(dark)) through setPaintProperty.
//
// Declutter is scale-aware (never a pile of squares) and, since round F, never
// silent: below PILL_ZOOM every vehicle is a small dot in its mode's colour;
// from there numbered pills join and *always draw* -- overlap and
// ignore-placement are on at every zoom, so no pill is ever dropped by the
// collision pass and no pill ever pushes a stop name off the map. What keeps a
// busy corner readable instead is the cluster: city-map.ts merges pills whose
// boxes overlap on screen (motion/pills.ts) into one feature carrying
// `cluster`, the joined label and its members' ids before the source is
// pushed, so MapLibre only ever sees marks that fit. The direction nose draws
// inside its own band alone (NOSE_MIN_ZOOM to NOSE_MAX_ZOOM, or the public
// screen's own overlapZoom for its lower edge). A merged mark whose members
// face opposite ways (`twoWay`, city-map.ts) carries the same triangle fore
// and aft of its pill instead, at every pill zoom. The selected or followed
// vehicle draws at every zoom. Stop names come in by rank, the busiest corners
// first, one per named stop. From BODY_ZOOM a body of the mode's one length
// (shared/motion/vehicle.ts, built by motion/bodies.ts) lies under each pill,
// metres wide, so the map shows how long a tram is where the street is wide
// enough to show it.
import { PROJECTION_LAT_DEG } from '../../../shared/motion/geo';
import { VEHICLE_WIDTH_M } from '../../../shared/motion/vehicle';
import { NOSE_LENGTH_PX, NOSE_WIDTH_PX, PILL_HEIGHT_PX, PILL_IMAGE_PREFIX, PILL_MAX_CHARS_CLUSTER, PLATE_IMAGE_PREFIX, PLATE_RADIUS_PX, pillImageId, pillWidthPx } from '../motion/pills';
import { ROUTE_TYPE_BUS, ROUTE_TYPE_TRAM } from '../motion/schematic';
import { MAP_FONTS, type OverlayPalette, type StyleLayerLike } from './basemap';
import type { MapSelection, PlaceKind, VehicleKind } from './city-map';
import { metresPerPixel } from './scale';
import { sdfRing, sdfRoundedRect, sdfSquareRing, sdfTriangle, type SdfImage } from './sdf';

export const SOURCES = Object.freeze({
  network: 'network',
  stops: 'stops',
  closures: 'closures',
  places: 'places',
  vehicles: 'vehicles',
  bodies: 'bodies',
  screenStop: 'screen-stop',
  outline: 'outline',
});

export const LAYERS = Object.freeze({
  outline: 'kvart-outline',
  networkBus: 'network-bus',
  networkTram: 'network-tram',
  networkSelectedCasing: 'network-selected-casing',
  networkSelected: 'network-selected',
  closuresCasing: 'closures-casing',
  closures: 'closures',
  places: 'places',
  placeQuakes: 'place-quakes',
  stopsRoute: 'stops-route',
  stops: 'stops',
  stopsSelected: 'stops-selected',
  screenStop: 'screen-stop',
  vehicleBodies: 'vehicle-bodies',
  vehicleDots: 'vehicle-dots',
  vehicleNoses: 'vehicle-noses',
  vehicleTwoWayFore: 'vehicle-twoway-fore',
  vehicleTwoWayAft: 'vehicle-twoway-aft',
  vehicles: 'vehicles',
  stopLabels: 'stop-labels',
  placeWorks: 'place-works',
  placeEvents: 'place-events',
  placeAssembly: 'place-assembly',
  placePharmacy: 'place-pharmacy',
  placeSeat: 'place-seat',
  placeQuakeLabels: 'place-quake-labels',
  screenStopLabel: 'screen-stop-label',
  vehicleSelectedNose: 'vehicle-selected-nose',
  vehicleSelected: 'vehicle-selected',
  selectionRing: 'selection-ring',
});

/** Layers drawn under the basemap's own labels, so street names still read over the network. */
export const BELOW_LABELS: ReadonlySet<string> = new Set([
  LAYERS.outline, LAYERS.networkBus, LAYERS.networkTram, LAYERS.networkSelectedCasing, LAYERS.networkSelected, LAYERS.closuresCasing, LAYERS.closures,
]);

/** The district outline, in multiples of its own line width. Dashed because
 *  the rings are a build-time simplification of the City's polygons, and an
 *  approximation should look like one; solid at this weight it would read as
 *  one more closed road beside the closure red. */
export const OUTLINE_DASH: readonly number[] = Object.freeze([3, 3]);
export const OUTLINE_WIDTH_PX = 2;

/** Pills appear (dots alone below): just under basemap.ts's CITY_ZOOM, so the opening view and one step out still read numbers. */
export const PILL_ZOOM = 12.5;
/** The direction nose's band (plan section D). Below the lower edge the marks
 *  are too dense and too small for a triangle to say anything; from the upper
 *  one the rails themselves draw four pixels and more apart, and the rail a
 *  tram sits on already says which way it faces -- a nose there is a second
 *  arrow saying what the map has just said. The public screen keeps its own
 *  lower edge (ProzorOptions.overlapZoom, R-KP2). */
export const NOSE_MIN_ZOOM = 14.5;
export const NOSE_MAX_ZOOM = 16.5;
/** Stop circles appear. */
export const STOP_ZOOM = 12.5;
/** The lower end of the public screen's own stop ramp (ProzorOptions
 *  stopRadius): the floor of the whole-city window (kiosk/mapview.ts
 *  FIELD_MIN_ZOOM), a fifth above STOP_ZOOM, so the smallest ring the ramp
 *  states is the smallest ring the window ever draws. */
export const CITY_STOP_ZOOM = 12.7;
/** The vehicle bodies appear. At Zagreb's latitude (map/scale.ts) a 32 m tram
 *  is 38 px here, 77 at 17 and 154 at 18, against a 24 px two-character pill;
 *  a 12 m bus 14, 29 and 58 px. A zoom earlier the body is shorter than the
 *  pill over it and says nothing. Between here and NOSE_MAX_ZOOM the nose
 *  still draws ahead of the pill, on top of the body. */
export const BODY_ZOOM = 16;
/** A body carries the dots' opacity at nine tenths: its confidence, stepped
 *  back under line focus with the rest of its line, and a little of the
 *  street still reading through a 32 m stroke. */
export const BODY_OPACITY = 0.9;
/** A body's width in pixels: its metres at the city's own latitude, one
 *  exponential ramp because the ground a pixel covers halves with every zoom
 *  (3 px at 16, 6 at 17, 12 at 18). Not scaled by the surface's symbol
 *  scale: a metre is a metre on every screen. */
const BODY_WIDTH: Expr = ['interpolate', ['exponential', 2], ['zoom'], BODY_ZOOM, VEHICLE_WIDTH_M / metresPerPixel(BODY_ZOOM, PROJECTION_LAT_DEG), 22, VEHICLE_WIDTH_M / metresPerPixel(22, PROJECTION_LAT_DEG)];
/** Pill geometry in CSS px, and the cluster label's cap: hoisted to
 *  motion/pills.ts (F1) so the schema paints the same pill; re-exported here
 *  under their long-standing names. */
export { PILL_HEIGHT_PX, PILL_IMAGE_PREFIX, PILL_MAX_CHARS_CLUSTER, PLATE_IMAGE_PREFIX, PLATE_RADIUS_PX };
/** The direction nose (pills.ts NOSE_LENGTH_PX by NOSE_WIDTH_PX) sits ahead
 *  of the pill, drawn under it, its centre this far out per label length. */
const NOSE_OFFSETS_PX: readonly number[] = [12, 14, 17, 20];
export const RING_DIAMETER_PX = 30;
export const RING_STROKE_PX = 2.5;

export const NOSE_IMAGE = 'vehicle-nose';
export const RING_IMAGE = 'selection-ring';

// --- The city, not only the network ---------------------------------------
//
// Three marks for the five kinds of point the city itself publishes, each
// chosen so the shape says what sort of claim the point is. A filled square
// is a thing the register says is happening at that spot (a communal work,
// and turned 45 degrees, a dated happening); a hollow square is a place named
// in a register with no claim about its state (an assembly point, a district
// seat); a hollow ring is a position the product itself only knows
// approximately (the on-duty pharmacy, whose coordinate is hand-entered and
// whose ADDRESS is the exact part). A quake is the one circle, because the
// one number it carries is a size.
export const PLACE_SQUARE_IMAGE = 'place-square';
export const PLACE_SQUARE_RING_IMAGE = 'place-square-ring';
export const PLACE_RING_IMAGE = 'place-ring';
export const PLACE_SQUARE_PX = 12;
export const PLACE_SQUARE_RING_PX = 14;
export const PLACE_RING_PX = 14;
export const PLACE_STROKE_PX = 2.5;
/** A place mark is a thing to walk to, so it appears once the camera is close
 *  enough that walking there is a real thought. */
export const PLACE_ZOOM = 11;
/** The name beside a place mark, in CSS px before the surface's scale; on the
 *  public screen (scale 2) that is 22 px, over the readability floor. */
export const PLACE_LABEL_PX = 11;
/** A dated happening is the events role; a communal work the muted-ink role. */
export const PLACE_EVENT_ROTATE_DEG = 45;
/** The komunalne register's own word for work that is under way. A row in any
 *  of its five other phases is announced, not happening, and never draws. */
export const WORKS_ONGOING_PHASE = 'Radovi u tijeku';
/** A quake's circle: a screen-fixed radius that encodes the magnitude and
 *  nothing else. Screen-fixed on purpose -- a radius in metres would read as
 *  a shaking footprint, which no part of this feed measures. */
export const QUAKE_BASE_RADIUS_PX = 2;
export const QUAKE_RADIUS_PER_MAG_PX = 3;

export interface OverlayImage { id: string; image: SdfImage }

/** The public screen's overlay set (plan D4, R-KP4): present, the tram network
 *  is a thin neutral rail (the `rail` palette key, 1.2 to 3 px on the kiosk),
 *  the bus lines and the stops off the screen's routes step aside, the
 *  screen's stop is the largest mark on the map, the seat is never lit, and
 *  the nose's lower edge and the stop names follow the field's own zoom
 *  (R-KP2). Absent, every surface draws exactly as before. (Trams as plates
 *  and buses as pills began here under D4 and are now every surface's rule:
 *  MARK_IMAGE.) */
export interface ProzorOptions {
  /** Which network lines are drawn; the kiosk passes ['tram']. */
  networkKinds: readonly ('tram' | 'bus')[];
  /** Route ids whose stops are drawn; null draws every stop (today's behaviour). */
  stopRoutes: readonly string[] | null;
  /** Stops labelled only from this rank (kiosk 4; today's gate is rank 2 at the overlap zoom). */
  stopLabelMinRank: number;
  /** The zoom from which the screen's stop names and the direction noses draw
   *  (the field's own zoom, R-KP2; NOSE_MIN_ZOOM elsewhere). Its name is
   *  older than the rule: pills place unconditionally at every zoom now. */
  overlapZoom: number;
  /** The stops of the screen's routes as rings that grow with the camera
   *  rather than one fixed dot: on the whole-city window (kiosk/mapview.ts
   *  CITY_WINDOW, z12.7) a dot sized for street level is a bead every few
   *  pixels across the whole picture, and at street level a city-sized dot is
   *  a crumb. false keeps the fixed dot. */
  stopRadius: boolean;
  /** Collision padding around a major street name, in the tile pixels
   *  basemap.ts's roads_labels_major reads (R-KP17: 24 on the wall's field).
   *  The kiosk raises it in step with the ground a field shows beyond the
   *  wall's -- doubled on the totem (kiosk/mapview.ts labelPadding) -- so a
   *  field of twice the ground still places at most eight names (contract 3);
   *  symbol-spacing is no lever for that count and stays the ruling's. */
  labelPadding: number;
  /** Ruling 31: false draws the square place marks (works, events, the seat
   *  and the civil-protection assembly points) with no title. Their names are
   *  the artefact's own -- "Igralište Sava", "Zagrebački velesajam" -- at the
   *  same 22 px a stop name gets, and on a picture of the whole city a
   *  gathering point's name is not something anyone acts on from three
   *  metres; the square is. The marks stay, and so does the quake's own
   *  label. Default true. */
  placeTitles?: boolean;
  /** Ruling 30: true names only the tram interchanges (the stop features'
   *  `tramInterchange`) and ignores the rank entirely -- what the whole-city
   *  window does. False keeps the ranked reading, which is what every frame
   *  from a quarter's own up has always had. */
  stopLabelTramInterchanges?: boolean;
  /** Ruling 29: false drops the promoted major street names outright
   *  (basemap.ts roads_labels_major). The promotion to a flat 22 px is sized
   *  for the wall's 2.8 km field; on a picture of the whole city those same
   *  names are the loudest thing on it and the route plates have to share
   *  their pixels. Default true -- only the kiosk's far window turns it off. */
  majorStreetNames?: boolean;
}

/** Every SDF image the overlays reference, generated once per map. One pill
 *  and one plate per label length a *cluster* can take, not only a route
 *  number's four: a merged mark writes "6·11·12·14 +2" and must have a capsule
 *  that long to write it in. */
export function overlayImages(): OverlayImage[] {
  const lengths = Array.from({ length: PILL_MAX_CHARS_CLUSTER }, (_, i) => i + 1);
  const pills = lengths.map((n) => ({ id: pillImageId(n), image: sdfRoundedRect(pillWidthPx(n), PILL_HEIGHT_PX, PILL_HEIGHT_PX / 2) }));
  const plates = lengths.map((n) => ({ id: pillImageId(n, true), image: sdfRoundedRect(pillWidthPx(n), PILL_HEIGHT_PX, PLATE_RADIUS_PX) }));
  return [
    ...pills,
    ...plates,
    { id: NOSE_IMAGE, image: sdfTriangle(NOSE_LENGTH_PX, NOSE_WIDTH_PX) },
    { id: RING_IMAGE, image: sdfRing(RING_DIAMETER_PX, RING_STROKE_PX) },
    { id: PLACE_SQUARE_IMAGE, image: sdfRoundedRect(PLACE_SQUARE_PX, PLACE_SQUARE_PX, 0) },
    { id: PLACE_SQUARE_RING_IMAGE, image: sdfSquareRing(PLACE_SQUARE_RING_PX, PLACE_STROKE_PX) },
    { id: PLACE_RING_IMAGE, image: sdfRing(PLACE_RING_PX, PLACE_STROKE_PX) },
  ];
}

type Expr = unknown[];

/** A filter that matches nothing: what a selection layer carries while nothing
 *  is selected. An expression, never a legacy-shaped comparison: MapLibre reads
 *  `['==', 1, 2]` as a legacy filter on a property called 1 and rejects the
 *  layer at validation, silently dropping it from the style. */
export const NEVER: Expr = ['literal', false];

const zoomInterpolate = (...stops: number[]): Expr => ['interpolate', ['linear'], ['zoom'], ...stops];
/** The label length clamped to the pill sizes, pills.ts's pillChars as an
 *  expression: '' (route unknown) takes the smallest pill, a cluster label
 *  past the cap the widest. */
const PILL_CHARS: Expr = ['min', PILL_MAX_CHARS_CLUSTER, ['max', 1, ['length', ['get', 'short']]]];
/** The vehicle's mark, the badge rule of signage.css on every surface (the
 *  kiosk's plan D4 first, the legend chips and the city map since): a tram
 *  takes the plate of its label's length, anything else the pill, so the two
 *  modes differ in shape as well as ink. */
const MARK_IMAGE: Expr = ['concat', ['match', ['get', 'kind'], 'tram', PLATE_IMAGE_PREFIX, PILL_IMAGE_PREFIX], ['to-string', PILL_CHARS]];
const NOSE_OFFSET: Expr = ['match', PILL_CHARS, ...NOSE_OFFSETS_PX.slice(0, -1).flatMap((px, i) => [i + 1, ['literal', [px, 0]]]), ['literal', [NOSE_OFFSETS_PX[NOSE_OFFSETS_PX.length - 1], 0]]];
/** The nose's turn from the feature's compass bearing. The triangle points
 *  along its own +x, so degrees clockwise from north less 90 stand a
 *  north-bound vehicle's nose upright. Plus 90 is the same triangle turned
 *  about -- and since the offset turns with it, it lands behind the pill,
 *  pointing back: the aft arrow of an opposed merge. */
const NOSE_ROTATE: Expr = ['-', ['get', 'bearing'], 90];
const NOSE_ROTATE_AFT: Expr = ['+', ['get', 'bearing'], 90];
/** A cluster over a tram over a bus over an unknown: the `sort` the vehicle
 *  source writes (city-map.ts), read straight. With overlap allowed MapLibre
 *  draws the *higher* sort key last, over the rest -- where under the old
 *  collision rule the same number decided who survived placement. Nothing is
 *  dropped any more, so this is now purely who covers whom. */
const SORT_KEY: Expr = ['get', 'sort'];

function kindColor(p: OverlayPalette, role: 'fill' | 'text'): Expr {
  return role === 'fill'
    ? ['match', ['get', 'kind'], 'tram', p.tram, 'bus', p.bus, p.other]
    : ['match', ['get', 'kind'], 'tram', p.tramText, 'bus', p.busText, p.otherText];
}

/** The vehicle kinds `modes` (GTFS route types) admits; null admits every kind, unknown included. */
export function vehicleKinds(modes: ReadonlySet<number> | null | undefined): VehicleKind[] {
  if (!modes) return ['tram', 'bus', 'other'];
  const kinds: VehicleKind[] = [];
  if (modes.has(ROUTE_TYPE_TRAM)) kinds.push('tram');
  if (modes.has(ROUTE_TYPE_BUS)) kinds.push('bus');
  return kinds;
}

export function kindFilter(modes: ReadonlySet<number> | null | undefined): Expr {
  return ['in', ['get', 'kind'], ['literal', vehicleKinds(modes)]];
}

/** Vehicles of the admitted kinds, less the selected one (its own layers draw it at every zoom). */
export function vehicleFilter(modes: ReadonlySet<number> | null | undefined, excludeId: string | null, headingOnly = false): Expr {
  const parts: Expr[] = [kindFilter(modes), ['!=', ['get', 'id'], excludeId ?? '']];
  if (headingOnly) parts.push(['get', 'hasHeading']);
  return ['all', ...parts];
}

/** Stops served by at least one admitted mode. */
export function stopFilter(modes: ReadonlySet<number> | null | undefined): Expr {
  const kinds = vehicleKinds(modes).filter((k): k is 'tram' | 'bus' => k !== 'other');
  if (kinds.length === 0) return NEVER;
  return ['any', ...kinds.map((k): Expr => ['==', ['get', k], true])];
}

/** Stop names appear here for the busiest corners (rank 4+), a zoom later for rank 2+, two later for the rest. */
export const STOP_LABEL_ZOOM = 13.5;

/** One label per named stop (`label`), by rank. `zoom` may only drive a filter through a top-level step. */
function stopLabelFilter(stops: Expr): Expr {
  const base: Expr = ['all', stops, ['get', 'label']];
  return ['step', ['zoom'], ['all', base, ['>=', ['get', 'rank'], 4]], STOP_LABEL_ZOOM + 1, ['all', base, ['>=', ['get', 'rank'], 2]], STOP_LABEL_ZOOM + 2, base];
}

/** Stops called at by one of `routes` (the features carry their route ids);
 *  null is every stop, an empty list none. */
export function routeStopsFilter(modes: ReadonlySet<number> | null | undefined, routes: readonly string[] | null): Expr {
  const byMode = stopFilter(modes);
  if (routes === null) return byMode;
  if (routes.length === 0) return NEVER;
  return ['all', byMode, ['any', ...routes.map((id): Expr => ['in', id, ['get', 'routes']])]];
}

/** A closure's width, the selected one three pixels heavier. */
export function closureWidth(selectedId: string | null, base: number): Expr {
  return ['case', ['==', ['get', 'id'], selectedId ?? ''], base + 3, base];
}

export const NETWORK_OPACITY: Expr = zoomInterpolate(10, 0.4, 14, 0.55, 17, 0.7);
/** The rest of the network while one route is selected and line focus is off
 *  (on, the other lines are hidden outright, not faded). */
export const NETWORK_OPACITY_DIMMED = 0.14;
/** The other routes' vehicles while one line is lit: still there, stepped back like their lines. */
export const VEHICLE_OPACITY_DIMMED = 0.35;

/** A vehicle's opacity: its confidence, and a step back for every other route while one line is lit. */
export function vehicleOpacity(selectedRoute: string | null): Expr {
  return selectedRoute === null ? ['get', 'alpha'] : ['*', ['get', 'alpha'], ['case', ['==', ['get', 'routeId'], selectedRoute], 1, VEHICLE_OPACITY_DIMMED]];
}

export interface PillInks {
  fill: Expr;
  text: Expr;
  halo: Expr | string;
}

/** A pill is always opaque: a number over a street is read, never inferred (map review round 1). Confidence lives in
 *  the dots, the nose and the sheet. While one route is selected, every other route's pill inverts -- the surface as
 *  fill, its own colour as the number and outline -- so it steps back without a line ever showing through its digits. */
export function pillInks(p: OverlayPalette, selectedRoute: string | null): PillInks {
  const fill = kindColor(p, 'fill');
  if (selectedRoute === null) return { fill, text: kindColor(p, 'text'), halo: p.halo };
  const mine: Expr = ['==', ['get', 'routeId'], selectedRoute];
  return { fill: ['case', mine, fill, p.stopFill], text: ['case', mine, kindColor(p, 'text'), fill], halo: ['case', mine, p.halo, fill] };
}

/** The filters the selection layers carry for `selection`: NEVER on every layer
 *  while nothing is selected. The two network layers are the one pair
 *  `overlayLayers` may widen past this: under line focus they carry the
 *  focused route, which a vehicle selection names and this function cannot. */
export function selectionFilters(selection: MapSelection | null): Record<string, Expr> {
  const routeId = selection?.kind === 'route' ? selection.id : null;
  const stopIds = selection?.kind === 'stop' ? [...new Set([selection.id, ...(selection.ids ?? [])])] : [];
  const vehicleId = selection?.kind === 'vehicle' ? selection.id : null;
  const route: Expr = routeId ? ['==', ['get', 'route'], routeId] : NEVER;
  const vehicle: Expr = vehicleId ? ['==', ['get', 'id'], vehicleId] : NEVER;
  return {
    [LAYERS.networkSelectedCasing]: route,
    [LAYERS.networkSelected]: route,
    [LAYERS.stopsRoute]: routeId ? ['in', routeId, ['get', 'routes']] : NEVER,
    [LAYERS.stopsSelected]: stopIds.length > 0 ? ['in', ['get', 'id'], ['literal', stopIds]] : NEVER,
    [LAYERS.vehicleSelectedNose]: vehicleId ? ['all', vehicle, ['get', 'hasHeading']] : NEVER,
    [LAYERS.vehicleSelected]: vehicle,
    [LAYERS.selectionRing]: vehicle,
  };
}

export interface OverlayOptions {
  /** Symbol and circle size multiplier: 1 on a phone or desk, larger on a screen read from across a room. */
  scale?: number;
  modes?: ReadonlySet<number> | null;
  closuresVisible?: boolean;
  selection?: MapSelection | null;
  /** Which kinds of city point this map lights (the kiosk passes its own
   *  set, kiosk/mapview.ts KIOSK_EMPHASIS, R-KP9). null, the default, lights
   *  every one -- the phone and the desk light everything. An unlit kind is
   *  hidden, not dimmed: a mark a reader cannot act on is not a quieter mark,
   *  it is a mark that should not be there. */
  emphasis?: readonly PlaceKind[] | null;
  /** The public screen's overlay set; null or absent draws every surface as before. */
  prozor?: ProzorOptions | null;
  /** The screen's own stop id: under prozor the hub-label tier never names it,
   *  because the 30 px anchor label already does and the two stacked at
   *  Jelačić (R-KP25). */
  screenStopId?: string | null;
  /** The line the map is about and the colour ZET prints it in (F5 section C):
   *  the selected route, or the route of the selected/followed vehicle, which
   *  city-map.ts resolves from what the model is drawing. Its colour comes
   *  from the build's own table (data/zet-line-colours.json), with the mode's
   *  pinned ink as the fallback for a route the table does not carry. Null
   *  means nothing is in focus -- nothing is selected, or the selected vehicle
   *  has not been drawn yet. */
  focus?: { routeId: string; colour: string } | null;
  /** The reader's "only this line" switch (core/line-focus-store.ts), off by
   *  default here: a surface that never asks for it (the kiosk) draws the
   *  whole network exactly as before. On, and with a `focus`, the rest of the
   *  network is hidden rather than dimmed -- a line nobody asked about is not
   *  a quieter line, it is one the reader is not looking for -- while every
   *  pill still draws, so no tram ever disappears from the map. */
  lineFocus?: boolean;
}

/** A pill layer. Overlap and ignore-placement are on for both the capsule and
 *  the number, at every zoom and on every surface: a vehicle the map knows
 *  about is a vehicle the map draws (plan section A), and a pill that ignores
 *  placement also stops pushing the stop name beneath it off the map. What
 *  keeps the picture readable is upstream -- the overlapping marks arrive
 *  already merged into one cluster feature -- and a cluster says so with a
 *  ring: the selection ink at twice a pill's own halo width. Every vehicle
 *  feature carries `cluster` (city-map.ts writes false on a single), so the
 *  case never meets a missing property. */
function pillLayer(id: string, filter: Expr, minzoom: number, s: number, p: OverlayPalette, inks: PillInks, image: Expr): StyleLayerLike {
  return {
    id,
    type: 'symbol',
    source: SOURCES.vehicles,
    ...(minzoom > 0 ? { minzoom } : {}),
    filter,
    layout: {
      'icon-image': image,
      'icon-size': s,
      'icon-rotation-alignment': 'viewport',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-padding': 1,
      'text-field': ['get', 'short'],
      'text-font': [MAP_FONTS.medium],
      'text-size': 12 * s,
      // A pill's number is one line, always: in ems, and a hundred of them is
      // wider than any label can be. MapLibre's default is 10 em, which broke
      // a bus cluster ("109·113·119·120 +3") at its space and hung the tail
      // under the capsule instead of inside it.
      'text-max-width': 100,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-rotation-alignment': 'viewport',
      'text-optional': false,
      'symbol-sort-key': SORT_KEY,
    },
    paint: {
      'icon-color': inks.fill,
      'icon-halo-color': ['case', ['get', 'cluster'], p.selection, inks.halo],
      'icon-halo-width': ['case', ['get', 'cluster'], 2, 1],
      'icon-opacity': 1,
      'text-color': inks.text,
      'text-opacity': 1,
    },
  };
}

/** The SDF triangle at a pill's edge -- the direction nose, or one arrow of an
 *  opposed merge -- turned by `rotate` from the feature's bearing, inside the
 *  zoom band `minzoom` to `maxzoom` (no maxzoom: open upward). */
function noseLayer(p: OverlayPalette, id: string, filter: Expr, minzoom: number, maxzoom: number | undefined, rotate: Expr, s: number, opacity: Expr): StyleLayerLike {
  return {
    id,
    type: 'symbol',
    source: SOURCES.vehicles,
    ...(minzoom > 0 ? { minzoom } : {}),
    ...(maxzoom !== undefined ? { maxzoom } : {}),
    filter,
    layout: {
      'icon-image': NOSE_IMAGE,
      'icon-size': s,
      'icon-rotate': rotate,
      'icon-rotation-alignment': 'map',
      'icon-offset': NOSE_OFFSET,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': SORT_KEY,
    },
    paint: { 'icon-color': kindColor(p, 'fill'), 'icon-halo-color': p.halo, 'icon-halo-width': 1, 'icon-opacity': opacity },
  };
}

/** The filter each place layer carries. Every one of these is a rule the
 *  product will not draw without, written where MapLibre itself enforces it
 *  rather than where a reader has to trust a comment:
 *
 *  - a communal work draws only in the register's "under way" phase, so an
 *    announced work is never a hole in the road;
 *  - a happening draws wherever its own source published a coordinate, and
 *    nowhere else -- a venue name is never geocoded into a position;
 *  - an on-duty pharmacy draws only with its published address, because the
 *    address is the exact part and the coordinate is hand-entered;
 *  - a quake draws a circle only with a magnitude, because a circle without
 *    one would be the claim "M 0".
 *
 *  What would widen the placed-event layer is data, not design: more of the
 *  City's event sources publishing coordinates at all, and the planned static
 *  gazetteer of known venues with fuzzy name matching, which could say how it
 *  matched a venue string. Until that exists the line holds: a point is drawn
 *  only where a source put one. */
export const PLACE_FILTERS: Readonly<Record<string, Expr>> = Object.freeze({
  [LAYERS.placeWorks]: ['all', ['==', ['get', 'place'], 'event'], ['==', ['get', 'source'], 'komunalne'], ['==', ['get', 'phase'], WORKS_ONGOING_PHASE]],
  [LAYERS.placeEvents]: ['all', ['==', ['get', 'place'], 'event'], ['!=', ['get', 'source'], 'komunalne']],
  [LAYERS.placeAssembly]: ['==', ['get', 'place'], 'assembly'],
  [LAYERS.placePharmacy]: ['all', ['==', ['get', 'place'], 'pharmacy'], ['has', 'address']],
  [LAYERS.placeSeat]: ['==', ['get', 'place'], 'seat'],
  [LAYERS.placeQuakes]: ['all', ['==', ['get', 'place'], 'quake'], ['has', 'mag']],
  [LAYERS.placeQuakeLabels]: ['==', ['get', 'place'], 'quake'],
});

interface PlaceMarkSpec {
  id: string;
  kind: PlaceKind;
  image: string;
  color: string;
  /** Draw order among the place marks; lower wins a crowded viewport. */
  sort: number;
  rotate?: number;
}

/** The basemap layer the line overlays are inserted before: its first label layer. */
export function firstSymbolLayer(layers: readonly StyleLayerLike[]): string | undefined {
  return layers.find((layer) => layer.type === 'symbol')?.id;
}

/**
 * Every overlay layer in draw order, bottom first. city-map.ts inserts the
 * BELOW_LABELS ones before the basemap's first label layer and appends the
 * rest on top. The same list for two palettes differs only in paint, so a
 * theme flip is one styleDiff(); the same palette with other options
 * differs in filters and layout, so a selection, a mode toggle or hiding
 * the closures is the same diff applied the same way.
 */
export function overlayLayers(p: OverlayPalette, options: OverlayOptions = {}): StyleLayerLike[] {
  const s = options.scale ?? 1;
  const modes = options.modes ?? null;
  const sel = options.selection ?? null;
  const prozor = options.prozor ?? null;
  const screenStopId = options.screenStopId ?? null;
  const selectedVehicle = sel?.kind === 'vehicle' ? sel.id : null;
  const selectedClosure = sel?.kind === 'closure' ? sel.id : null;
  const selectedRoute = sel?.kind === 'route' ? sel.id : null;
  // Line focus, once the switch is on and something is in focus: the one line
  // is what the map draws, whether the reader asked for it by number or by
  // tapping a tram on it. Off, the focus is still handed in (the selected
  // route's own colour), but it changes nothing but that colour.
  const focus = (options.lineFocus === true ? options.focus : null) ?? null;
  /** The route the pills, the dots and the network layer are about. */
  const litRoute = focus?.routeId ?? selectedRoute;
  const alpha = vehicleOpacity(litRoute);
  const inks = pillInks(p, litRoute);
  const filters = selectionFilters(sel);
  /** The lit line's own geometry: the selection's, or the focused route's under a vehicle. */
  const litLine: Expr = litRoute ? ['==', ['get', 'route'], litRoute] : NEVER;
  /** The colour it is drawn in: ZET's own where the build's table knows the route, the mode's ink otherwise. */
  const litColour: string | Expr = options.focus && options.focus.routeId === litRoute
    ? options.focus.colour
    : ['match', ['get', 'kind'], 'tram', p.routeTram, 'bus', p.routeBus, p.other];
  const kinds = vehicleKinds(modes);
  const round = { 'line-cap': 'round', 'line-join': 'round' };
  const visible = (on: boolean): Record<string, unknown> => ({ visibility: on ? 'visible' : 'none' });
  const closures = visible(options.closuresVisible !== false);
  /** Under line focus the plain network is gone, not faded, so 0.14 never applies. */
  const dimmed = focus === null && sel?.kind === 'route';
  // The public screen's nose threshold follows the field's own zoom (R-KP2); every other surface keeps the fixed one.
  const noseZoom = prozor?.overlapZoom ?? NOSE_MIN_ZOOM;
  /** The pills' own filter in front, so the mode toggle hides the arrows with their pill. */
  const twoWayFilter: Expr = ['all', vehicleFilter(modes, selectedVehicle), ['get', 'cluster'], ['get', 'twoWay']];
  const mark: Expr = MARK_IMAGE;
  /** A network is drawn for its mode when nothing is in focus (line focus
   *  leaves only the focused route's own layer), when the modes admit it and,
   *  on the public screen, when the option set names it. */
  const drawn = (kind: 'tram' | 'bus'): boolean => focus === null && kinds.includes(kind) && (prozor === null || prozor.networkKinds.includes(kind));
  const network = (id: string, kind: 'tram' | 'bus', color: string, width: Expr, opacity: Expr | number = NETWORK_OPACITY): StyleLayerLike => ({
    id,
    type: 'line',
    source: SOURCES.network,
    filter: ['==', ['get', 'kind'], kind],
    layout: { ...round, ...visible(drawn(kind)) },
    paint: { 'line-color': color, 'line-width': width, 'line-opacity': dimmed ? NETWORK_OPACITY_DIMMED : opacity },
  });
  // The tram network's own line, one neutral grey well below the marks it
  // carries (owner ruling, round F "kiosk window"): on the public screen 1.2
  // to 3 px across the field's zoom at a flat 0.8; elsewhere the network's
  // own weight and zoom-based opacity, as always.
  const tramNetwork = prozor
    ? network(LAYERS.networkTram, 'tram', p.rail, zoomInterpolate(12.5, 1.2, 14, 2, 16, 3), 0.8)
    : network(LAYERS.networkTram, 'tram', p.rail, zoomInterpolate(10, 0.6, 13, 1.1, 16, 2.4));
  /** Which platforms the ordinary ring field is about. Under line focus it is
   *  the focused line's own stops: with every other line hidden, every other
   *  line's rings are hundreds of grey circles with nothing under them to read
   *  them against (F6 review, round-f-city-desktop-focus-on). The selection
   *  layer (stops-route) still lights the route's platforms over these, and the
   *  screen's own stop draws from its own source whatever this says. The ranked
   *  names follow the rings, because a name over a platform with neither ring
   *  nor line under it is the same clutter by another means. Focus off, every
   *  stop the modes admit, exactly as before. */
  const stopRoutes = focus ? [focus.routeId] : prozor ? prozor.stopRoutes : null;
  const stops = routeStopsFilter(modes, stopRoutes);
  const labelInk = { 'text-color': p.label, 'text-halo-color': p.halo };
  const circle = (id: string, source: string, paint: Record<string, unknown>, extra: Partial<StyleLayerLike> = {}): StyleLayerLike => ({ id, type: 'circle', source, paint, ...extra });
  // The seat of the quarter is never lit on the public screen (R-KP9): a register address is not a thing to walk to from a café.
  const lit = (kind: PlaceKind): boolean => (kind !== 'seat' || prozor === null) && (options.emphasis == null || options.emphasis.includes(kind));
  /** Ruling 31: the square marks carry their names from THIN_NAMES_ZOOM up
   *  and nowhere below it; outside the kiosk's option set they always do. */
  const placeTitles = prozor === null || prozor.placeTitles !== false;
  /** One city point: its mark, its own name under it, and the honesty rule in
   *  its filter. The name is `text-optional`: the mark is the claim, the name
   *  is the convenience, and a crowded viewport drops the second, never the
   *  first. */
  const placeMark = (spec: PlaceMarkSpec): StyleLayerLike => ({
    id: spec.id,
    type: 'symbol',
    source: SOURCES.places,
    minzoom: PLACE_ZOOM,
    filter: PLACE_FILTERS[spec.id]!,
    layout: {
      ...visible(lit(spec.kind)),
      'icon-image': spec.image,
      'icon-size': s,
      'icon-rotation-alignment': 'viewport',
      ...(spec.rotate ? { 'icon-rotate': spec.rotate } : {}),
      // No allow-overlap: a crowded quarter thins its own marks, and
      // symbol-sort-key decides which survive -- the pharmacy and the assembly
      // points first, the seat last. A pile of squares is not more honest than
      // a chosen one, it is only less readable.
      // Ruling 31: on the whole-city window the squares draw without names.
      ...(placeTitles ? {
        'text-field': ['get', 'title'],
        'text-font': [MAP_FONTS.medium],
        'text-size': PLACE_LABEL_PX * s,
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
        'text-max-width': 10,
        'text-optional': true,
      } : {}),
      'symbol-sort-key': spec.sort,
    },
    paint: {
      'icon-color': spec.color,
      'icon-halo-color': p.halo,
      'icon-halo-width': 1,
      'text-color': spec.color,
      'text-halo-color': p.halo,
      'text-halo-width': 1.6,
    },
  });
  return [
    {
      id: LAYERS.outline,
      type: 'line',
      source: SOURCES.outline,
      layout: round,
      paint: { 'line-color': p.other, 'line-width': OUTLINE_WIDTH_PX * s, 'line-dasharray': [...OUTLINE_DASH], 'line-opacity': 0.8 },
    },
    network(LAYERS.networkBus, 'bus', p.routeBus, zoomInterpolate(10, 0.45, 13, 0.85, 16, 1.9)),
    tramNetwork,
    { id: LAYERS.networkSelectedCasing, type: 'line', source: SOURCES.network, filter: litLine, layout: round, paint: { 'line-color': p.selectionHalo, 'line-width': zoomInterpolate(10, 5, 16, 11) } },
    { id: LAYERS.networkSelected, type: 'line', source: SOURCES.network, filter: litLine, layout: round, paint: { 'line-color': litColour, 'line-width': zoomInterpolate(10, 2.5, 16, 6.5) } },
    { id: LAYERS.closuresCasing, type: 'line', source: SOURCES.closures, layout: { ...round, ...closures }, paint: { 'line-color': p.closureCasing, 'line-width': closureWidth(selectedClosure, 7) } },
    { id: LAYERS.closures, type: 'line', source: SOURCES.closures, layout: { ...round, ...closures }, paint: { 'line-color': p.closure, 'line-width': closureWidth(selectedClosure, 4) } },
    // A point with no `place` is the plain circle this map has always drawn:
    // the dashboard's quake map and its work points keep it.
    circle(LAYERS.places, SOURCES.places, { 'circle-radius': 6 * s, 'circle-color': p.place, 'circle-stroke-color': p.halo, 'circle-stroke-width': 1.5 }, { filter: ['!', ['has', 'place']] }),
    // The radius is the magnitude and nothing else. A quake the source gave no
    // magnitude draws no circle at all -- its label alone names its region,
    // because a circle with no magnitude would be the claim "M 0".
    circle(
      LAYERS.placeQuakes,
      SOURCES.places,
      {
        'circle-radius': ['*', s, ['+', QUAKE_BASE_RADIUS_PX, ['*', QUAKE_RADIUS_PER_MAG_PX, ['get', 'mag']]]],
        'circle-color': p.place,
        'circle-opacity': 0.25,
        'circle-stroke-color': p.place,
        'circle-stroke-width': 2,
      },
      { filter: PLACE_FILTERS[LAYERS.placeQuakes]!, layout: visible(lit('quake')) },
    ),
    circle(LAYERS.stopsRoute, SOURCES.stops, { 'circle-radius': zoomInterpolate(11, 2 * s, 14, 3.5 * s, 16, 5.5 * s), 'circle-color': p.selection, 'circle-stroke-color': p.selectionHalo, 'circle-stroke-width': 1.5 }, { minzoom: 11, filter: filters[LAYERS.stopsRoute] }),
    // On the public screen the stops of the screen's own routes are filled
    // dots in the figure colour: beads on the rails, not rings competing with
    // the screen's stop. With stopRadius they grow with the camera instead of
    // holding one size: 1.5 px at the whole-city window's own floor, 5 at
    // street level, with a one-pixel stroke of the same ink under them, which
    // is what keeps a three-pixel bead legible over the street grid. These
    // are drawn pixels, NOT multiplied by the surface's symbol scale as the
    // marks are: a stop is the one thing on this map a person reads by where
    // it is and not by what it says, and at the screen's scale 2 the street
    // end came out heavier than the plates standing on it. Elsewhere the
    // hollow ring as always.
    circle(
      LAYERS.stops,
      SOURCES.stops,
      prozor
        ? {
            'circle-radius': prozor.stopRadius ? zoomInterpolate(CITY_STOP_ZOOM, 1.5, 15.5, 5) : 3 * s,
            'circle-color': p.figure,
            'circle-stroke-color': p.figure,
            'circle-stroke-width': prozor.stopRadius ? 1 : 0,
            'circle-opacity': p.figureOpacity,
            'circle-stroke-opacity': prozor.stopRadius ? p.figureOpacity : 0,
          }
        : {
            'circle-radius': zoomInterpolate(STOP_ZOOM, 1.5 * s, 14, 2.6 * s, 16, 4.5 * s),
            'circle-color': p.stopFill,
            'circle-stroke-color': p.stopStroke,
            'circle-stroke-width': zoomInterpolate(STOP_ZOOM, 0.8, 16, 1.6),
            'circle-opacity': zoomInterpolate(STOP_ZOOM, 0.5, 14, 1),
            'circle-stroke-opacity': zoomInterpolate(STOP_ZOOM, 0.5, 14, 1),
          },
      { minzoom: STOP_ZOOM, filter: stops },
    ),
    circle(LAYERS.stopsSelected, SOURCES.stops, { 'circle-radius': zoomInterpolate(11, 6 * s, 16, 11 * s), 'circle-color': p.selection, 'circle-opacity': 0, 'circle-stroke-color': p.selection, 'circle-stroke-width': 3 }, { filter: filters[LAYERS.stopsSelected] }),
    // The screen's own stop: on the public screen the largest ring on the map
    // (R-KP4: 9 x s, a 2 x s halo), the anchor the whole picture is about.
    circle(LAYERS.screenStop, SOURCES.screenStop, { 'circle-radius': (prozor ? 9 : 7) * s, 'circle-color': p.screenStop, 'circle-stroke-color': p.halo, 'circle-stroke-width': prozor ? 2 * s : 2 }),
    // The bodies: over the rails and the stop rings, under every dot, nose and
    // pill. Flat-ended, because a vehicle ends flat and a round cap would add
    // a width to the length; the pill inks, so a body is its pill's colour
    // laid on the street; the mode filter, so the toggles hide bodies with
    // their pills. The selected vehicle's body is in here too -- the ring
    // marks it, and it needs no layer of its own.
    {
      id: LAYERS.vehicleBodies,
      type: 'line',
      source: SOURCES.bodies,
      minzoom: BODY_ZOOM,
      filter: kindFilter(modes),
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': kindColor(p, 'fill'), 'line-width': BODY_WIDTH, 'line-opacity': ['*', alpha, BODY_OPACITY] },
    },
    circle(
      LAYERS.vehicleDots,
      SOURCES.vehicles,
      {
        'circle-radius': zoomInterpolate(10, 2 * s, PILL_ZOOM, 3.2 * s, 16, 4.5 * s),
        'circle-color': kindColor(p, 'fill'),
        'circle-opacity': alpha,
        'circle-stroke-color': p.halo,
        'circle-stroke-width': 1,
        'circle-stroke-opacity': alpha,
      },
      { filter: kindFilter(modes) },
    ),
    // The nose band's upper edge is the same on every surface: past it the rails say the direction themselves.
    noseLayer(p, LAYERS.vehicleNoses, vehicleFilter(modes, selectedVehicle, true), noseZoom, NOSE_MAX_ZOOM, NOSE_ROTATE, s, alpha),
    // An opposed merge (city-map.ts `twoWay`: two members facing more than its
    // TWO_WAY_MIN_DEG apart, two trams of one line passing at a stop) keeps
    // its one pill and gets the triangle fore and aft along the first member's
    // bearing. From the first pill zoom and with no upper edge: the nose band
    // closes at 16.5 because the rail under a tram says which way it faces,
    // but no rail can say which way a pair going both ways is heading, so the
    // arrows stay for as long as the two marks stay merged.
    noseLayer(p, LAYERS.vehicleTwoWayFore, twoWayFilter, PILL_ZOOM, undefined, NOSE_ROTATE, s, alpha),
    noseLayer(p, LAYERS.vehicleTwoWayAft, twoWayFilter, PILL_ZOOM, undefined, NOSE_ROTATE_AFT, s, alpha),
    pillLayer(LAYERS.vehicles, vehicleFilter(modes, selectedVehicle), PILL_ZOOM, s, p, inks, mark),
    // Stop names: on the public screen the hubs alone (rank from the option
    // set), from the field's zoom and never below it -- as the layer's own
    // minzoom, which MapLibre reads against the camera's fractional zoom,
    // where a `zoom` step inside the filter would be read at the tile's
    // integer zoom and arrive one whole level late. Elsewhere the ranked
    // steps as always.
    {
      id: LAYERS.stopLabels,
      type: 'symbol',
      source: SOURCES.stops,
      minzoom: prozor ? prozor.overlapZoom : STOP_LABEL_ZOOM,
      filter: prozor
        ? ['all', stops, ['get', 'label'],
          // Ruling 30: the far window names interchanges, not the busiest
          // corners -- route count put Elka and Savski gaj-rotor on the
          // picture and left Trg bana Jelačića, Glavni kolodvor and Savski
          // most off it. Nearer in, the rank is still what names a stop.
          prozor.stopLabelTramInterchanges ? ['get', 'tramInterchange'] : ['>=', ['get', 'rank'], prozor.stopLabelMinRank],
          ['!=', ['get', 'id'], screenStopId ?? '']]
        : stopLabelFilter(stops),
      layout: {
        'text-field': ['get', 'name'],
        'text-font': [MAP_FONTS.medium],
        'text-size': prozor ? 11 * s : zoomInterpolate(STOP_LABEL_ZOOM, 11 * s, 16, 13 * s),
        'text-anchor': 'top',
        'text-offset': [0, 0.7],
        'text-max-width': 9,
        'text-padding': 3,
        // Lower sorts first. Route count alone decided this, which is the
        // scale Ruling 30 threw out: below the line an interchange is placed
        // before anything else and the rank is only the tiebreak among them.
        'symbol-sort-key': prozor?.stopLabelTramInterchanges
          ? ['-', ['case', ['get', 'tramInterchange'], 0, 100], ['get', 'rank']]
          : ['-', 100, ['get', 'rank']],
      },
      paint: { ...labelInk, 'text-halo-width': 1.4 },
    },
    placeMark({ id: LAYERS.placeWorks, kind: 'event', image: PLACE_SQUARE_IMAGE, color: p.work, sort: 30 }),
    placeMark({ id: LAYERS.placeEvents, kind: 'event', image: PLACE_SQUARE_IMAGE, color: p.event, sort: 20, rotate: PLACE_EVENT_ROTATE_DEG }),
    placeMark({ id: LAYERS.placeSeat, kind: 'seat', image: PLACE_SQUARE_RING_IMAGE, color: p.other, sort: 40, rotate: PLACE_EVENT_ROTATE_DEG }),
    // In ink, never alarm red, and only while the safety state is urgent
    // (kiosk/mapview.ts decides that; nothing here can). A screen permanently
    // covered in emergency marks is fearmongering, and it teaches people to
    // stop seeing them on the day it matters.
    placeMark({ id: LAYERS.placeAssembly, kind: 'assembly', image: PLACE_SQUARE_RING_IMAGE, color: p.label, sort: 10 }),
    // Hollow, never a filled pin: the coordinate is approximate and the
    // published address under it is the exact part.
    placeMark({ id: LAYERS.placePharmacy, kind: 'pharmacy', image: PLACE_RING_IMAGE, color: p.label, sort: 5 }),
    {
      id: LAYERS.placeQuakeLabels,
      type: 'symbol',
      source: SOURCES.places,
      minzoom: PLACE_ZOOM,
      filter: PLACE_FILTERS[LAYERS.placeQuakeLabels]!,
      layout: {
        ...visible(lit('quake')),
        'text-field': ['get', 'title'],
        'text-font': [MAP_FONTS.medium],
        'text-size': PLACE_LABEL_PX * s,
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
        'text-max-width': 10,
        'symbol-sort-key': 15,
      },
      paint: { 'text-color': p.place, 'text-halo-color': p.halo, 'text-halo-width': 1.6 },
    },
    // The screen's stop's name: on the public screen the biggest name on the
    // map (15 x s = 30 px at the screen's scale), always placed.
    {
      id: LAYERS.screenStopLabel,
      type: 'symbol',
      source: SOURCES.screenStop,
      layout: { 'text-field': ['get', 'name'], 'text-font': [MAP_FONTS.medium], 'text-size': (prozor ? 15 : 13) * s, 'text-anchor': 'top', 'text-offset': [0, 0.9], 'text-max-width': 9, 'text-allow-overlap': true, 'text-ignore-placement': true },
      paint: { ...labelInk, 'text-halo-width': 1.6 },
    },
    // The selected vehicle's nose keeps the general nose's band (design D):
    // the triangle says the direction only between 14.5 and 16.5, and a
    // selection is no reason to draw one over a city-wide view where nothing
    // else carries one -- or past 16.5, where the rails say it themselves.
    noseLayer(p, LAYERS.vehicleSelectedNose, filters[LAYERS.vehicleSelectedNose], noseZoom, NOSE_MAX_ZOOM, NOSE_ROTATE, s, alpha),
    pillLayer(LAYERS.vehicleSelected, filters[LAYERS.vehicleSelected], 0, s, p, pillInks(p, null), mark),
    {
      id: LAYERS.selectionRing,
      type: 'symbol',
      source: SOURCES.vehicles,
      filter: filters[LAYERS.selectionRing],
      layout: { 'icon-image': RING_IMAGE, 'icon-size': s, 'icon-rotation-alignment': 'viewport', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
      paint: { 'icon-color': p.selection, 'icon-halo-color': p.selectionHalo, 'icon-halo-width': 1 },
    },
  ];
}
