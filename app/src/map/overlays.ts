// What sits on top of the basemap -- the route network, closures, places,
// stops and their names, the screen's own stop, the motion model's vehicles
// as numbered pills with a direction nose, and the selection marks -- as
// MapLibre layer specs built from an OverlayPalette (basemap.ts). Pure: no
// DOM, no MapLibre import, so the layer list, the filters and the declutter
// thresholds are unit-tested in node, and a theme flip on the live map is
// styleDiff(overlayLayers(light), overlayLayers(dark)) through setPaintProperty.
//
// Declutter is scale-aware (never a pile of squares): below PILL_ZOOM every
// vehicle is a small dot in its mode's colour; from there numbered pills
// join, thinned by MapLibre's collision pass with the dots still underneath
// so no vehicle ever vanishes; from PILL_OVERLAP_ZOOM (or the public screen's
// own overlapZoom, ProzorOptions) every pill and its nose draw
// unconditionally. The selected or followed vehicle draws at every zoom.
// Stop names come in by rank, the busiest corners first, one per named stop,
// and yield to the vehicles above them.
import { ROUTE_TYPE_BUS, ROUTE_TYPE_TRAM } from '../motion/schematic';
import { MAP_FONTS, type OverlayPalette, type StyleLayerLike } from './basemap';
import type { MapSelection, PlaceKind, VehicleKind } from './city-map';
import { sdfRing, sdfRoundedRect, sdfSquareRing, sdfTriangle, type SdfImage } from './sdf';

export const SOURCES = Object.freeze({
  network: 'network',
  stops: 'stops',
  closures: 'closures',
  places: 'places',
  vehicles: 'vehicles',
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
  vehicleDots: 'vehicle-dots',
  vehicleNoses: 'vehicle-noses',
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
/** Every pill and nose draws, collision or not; two trams at one stop are two trams. */
export const PILL_OVERLAP_ZOOM = 14.5;
/** Stop circles appear. */
export const STOP_ZOOM = 12.5;
/** Pill geometry in CSS px: one capsule per label length, 1 to 4 characters. */
export const PILL_HEIGHT_PX = 18;
export const PILL_WIDTHS_PX: readonly number[] = [18, 24, 31, 38];
export const PILL_MAX_CHARS = PILL_WIDTHS_PX.length;
/** The direction nose: an isosceles triangle ahead of the pill, drawn under it. */
export const NOSE_LENGTH_PX = 8;
export const NOSE_WIDTH_PX = 9;
const NOSE_OFFSETS_PX: readonly number[] = [12, 14, 17, 20];
export const RING_DIAMETER_PX = 30;
export const RING_STROKE_PX = 2.5;

export const PILL_IMAGE_PREFIX = 'vehicle-pill-';
/** The tram's plate on the public screen (plan D4, the badge rule: a tram is
 *  a plate, a bus a capsule): the pill's box with the corners barely rounded,
 *  one per label length like the pills. */
export const PLATE_IMAGE_PREFIX = 'vehicle-plate-';
export const PLATE_RADIUS_PX = 3;
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
 *  is the figure (the `figure` palette keys, 3 to 5 px), the bus lines and the
 *  stops off the screen's routes step aside, trams draw as plates and buses as
 *  the pills, the screen's stop is the largest mark on the map, the seat is
 *  never lit, and the fixed 14.5 overlap zoom follows the field's own zoom
 *  (R-KP2). Absent, every surface draws exactly as before. */
export interface ProzorOptions {
  /** Which network lines are drawn; the kiosk passes ['tram']. */
  networkKinds: readonly ('tram' | 'bus')[];
  /** Route ids whose stops are drawn; null draws every stop (today's behaviour). */
  stopRoutes: readonly string[] | null;
  /** Stops labelled only from this rank (kiosk 4; today's gate is rank 2 at the overlap zoom). */
  stopLabelMinRank: number;
  /** The zoom from which pills place unconditionally and noses draw (today's fixed 14.5). */
  overlapZoom: number;
}

/** Every SDF image the overlays reference, generated once per map. */
export function overlayImages(): OverlayImage[] {
  const pills = PILL_WIDTHS_PX.map((w, i) => ({ id: `${PILL_IMAGE_PREFIX}${i + 1}`, image: sdfRoundedRect(w, PILL_HEIGHT_PX, PILL_HEIGHT_PX / 2) }));
  const plates = PILL_WIDTHS_PX.map((w, i) => ({ id: `${PLATE_IMAGE_PREFIX}${i + 1}`, image: sdfRoundedRect(w, PILL_HEIGHT_PX, PLATE_RADIUS_PX) }));
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
/** The label length clamped to the pill sizes: '' (route unknown) takes the smallest pill. */
const PILL_CHARS: Expr = ['min', PILL_MAX_CHARS, ['max', 1, ['length', ['get', 'short']]]];
const PILL_IMAGE: Expr = ['concat', PILL_IMAGE_PREFIX, ['to-string', PILL_CHARS]];
/** The public screen's mark: a tram takes the plate of its label's length, anything else the pill. */
const PLATE_OR_PILL_IMAGE: Expr = ['concat', ['match', ['get', 'kind'], 'tram', PLATE_IMAGE_PREFIX, PILL_IMAGE_PREFIX], ['to-string', PILL_CHARS]];
const NOSE_OFFSET: Expr = ['match', PILL_CHARS, ...NOSE_OFFSETS_PX.slice(0, -1).flatMap((px, i) => [i + 1, ['literal', [px, 0]]]), ['literal', [NOSE_OFFSETS_PX[NOSE_OFFSETS_PX.length - 1], 0]]];
/** Trams over buses over unknown: the draw and placement order pills use. */
const SORT_KEY: Expr = ['-', 10, ['get', 'sort']];

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
/** The rest of the network while one route is selected. */
export const NETWORK_OPACITY_DIMMED = 0.14;
/** The other routes' vehicles while one route is selected: still there, stepped back like their lines. */
export const VEHICLE_OPACITY_DIMMED = 0.35;

/** A vehicle's opacity: its confidence, and a step back for every other route while one is selected. */
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

/** The filters the selection layers carry for `selection`: NEVER on every layer while nothing is selected. */
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
  /** Which kinds of city point this chapter lights. null, the default, lights
   *  every one -- the phone and the desk have no chapters. An unlit kind is
   *  hidden, not dimmed: a mark a reader cannot act on is not a quieter mark,
   *  it is a mark that should not be there. */
  emphasis?: readonly PlaceKind[] | null;
  /** The public screen's overlay set; null or absent draws every surface as before. */
  prozor?: ProzorOptions | null;
}

function pillLayer(id: string, filter: Expr, overlap: boolean | Expr, minzoom: number, s: number, inks: PillInks, image: Expr): StyleLayerLike {
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
      'icon-allow-overlap': overlap,
      'icon-padding': 1,
      'text-field': ['get', 'short'],
      'text-font': [MAP_FONTS.medium],
      'text-size': 12 * s,
      'text-allow-overlap': overlap,
      'text-rotation-alignment': 'viewport',
      'text-optional': false,
      'symbol-sort-key': SORT_KEY,
    },
    paint: {
      'icon-color': inks.fill,
      'icon-halo-color': inks.halo,
      'icon-halo-width': 1,
      'icon-opacity': 1,
      'text-color': inks.text,
      'text-opacity': 1,
    },
  };
}

function noseLayer(p: OverlayPalette, id: string, filter: Expr, minzoom: number, s: number, opacity: Expr): StyleLayerLike {
  return {
    id,
    type: 'symbol',
    source: SOURCES.vehicles,
    ...(minzoom > 0 ? { minzoom } : {}),
    filter,
    layout: {
      'icon-image': NOSE_IMAGE,
      'icon-size': s,
      // The triangle points along its own +x; compass degrees clockwise from
      // north less 90 stand a north-bound vehicle's nose upright.
      'icon-rotate': ['-', ['get', 'bearing'], 90],
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
  const selectedVehicle = sel?.kind === 'vehicle' ? sel.id : null;
  const selectedClosure = sel?.kind === 'closure' ? sel.id : null;
  const selectedRoute = sel?.kind === 'route' ? sel.id : null;
  const alpha = vehicleOpacity(selectedRoute);
  const inks = pillInks(p, selectedRoute);
  const filters = selectionFilters(sel);
  const kinds = vehicleKinds(modes);
  const round = { 'line-cap': 'round', 'line-join': 'round' };
  const visible = (on: boolean): Record<string, unknown> => ({ visibility: on ? 'visible' : 'none' });
  const closures = visible(options.closuresVisible !== false);
  const dimmed = sel?.kind === 'route';
  // The public screen's thresholds follow the field's own zoom (R-KP2); every other surface keeps the fixed one.
  const overlapZoom = prozor?.overlapZoom ?? PILL_OVERLAP_ZOOM;
  const overlap: Expr = ['step', ['zoom'], false, overlapZoom, true];
  const mark: Expr = prozor ? PLATE_OR_PILL_IMAGE : PILL_IMAGE;
  /** A network is drawn for its mode when the modes admit it and, on the public screen, when the option set names it. */
  const drawn = (kind: 'tram' | 'bus'): boolean => kinds.includes(kind) && (prozor === null || prozor.networkKinds.includes(kind));
  const network = (id: string, kind: 'tram' | 'bus', color: string, width: Expr, opacity: Expr | number = NETWORK_OPACITY): StyleLayerLike => ({
    id,
    type: 'line',
    source: SOURCES.network,
    filter: ['==', ['get', 'kind'], kind],
    layout: { ...round, ...visible(drawn(kind)) },
    paint: { 'line-color': color, 'line-width': width, 'line-opacity': dimmed ? NETWORK_OPACITY_DIMMED : opacity },
  });
  // The tram rails as the figure (plan D4): the ink itself, 3 to 5 px across
  // the field's zoom, over hairline streets. Elsewhere the pinned tram blue at
  // the network's own weight and opacity, as always.
  const tramNetwork = prozor
    ? network(LAYERS.networkTram, 'tram', p.figure, zoomInterpolate(14, 3, 15, 5, 16, 6), p.figureOpacity)
    : network(LAYERS.networkTram, 'tram', p.routeTram, zoomInterpolate(10, 1, 13, 1.8, 16, 4.5));
  const stops = routeStopsFilter(modes, prozor ? prozor.stopRoutes : null);
  const labelInk = { 'text-color': p.label, 'text-halo-color': p.halo };
  const circle = (id: string, source: string, paint: Record<string, unknown>, extra: Partial<StyleLayerLike> = {}): StyleLayerLike => ({ id, type: 'circle', source, paint, ...extra });
  // The seat of the quarter is never lit on the public screen (R-KP9): a register address is not a thing to walk to from a café.
  const lit = (kind: PlaceKind): boolean => (kind !== 'seat' || prozor === null) && (options.emphasis == null || options.emphasis.includes(kind));
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
      'text-field': ['get', 'title'],
      'text-font': [MAP_FONTS.medium],
      'text-size': PLACE_LABEL_PX * s,
      'text-anchor': 'top',
      'text-offset': [0, 0.9],
      'text-max-width': 10,
      'text-optional': true,
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
    network(LAYERS.networkBus, 'bus', p.routeBus, zoomInterpolate(10, 0.7, 13, 1.4, 16, 3.5)),
    tramNetwork,
    { id: LAYERS.networkSelectedCasing, type: 'line', source: SOURCES.network, filter: filters[LAYERS.networkSelectedCasing], layout: round, paint: { 'line-color': p.selectionHalo, 'line-width': zoomInterpolate(10, 5, 16, 11) } },
    { id: LAYERS.networkSelected, type: 'line', source: SOURCES.network, filter: filters[LAYERS.networkSelected], layout: round, paint: { 'line-color': ['match', ['get', 'kind'], 'tram', p.routeTram, 'bus', p.routeBus, p.other], 'line-width': zoomInterpolate(10, 2.5, 16, 6.5) } },
    { id: LAYERS.closuresCasing, type: 'line', source: SOURCES.closures, layout: { ...round, ...closures }, paint: { 'line-color': p.closureCasing, 'line-width': closureWidth(selectedClosure, 7) } },
    { id: LAYERS.closures, type: 'line', source: SOURCES.closures, layout: { ...round, ...closures }, paint: { 'line-color': p.closure, 'line-width': closureWidth(selectedClosure, 4) } },
    // A point with no `place` is the plain circle this map has always drawn:
    // the dashboard's quake map and the kvart thumbnail's work points keep it.
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
    // dots in the figure colour, no stroke: beads on the rails, not rings
    // competing with the screen's stop. Elsewhere the hollow ring as always.
    circle(
      LAYERS.stops,
      SOURCES.stops,
      prozor
        ? {
            'circle-radius': 3 * s,
            'circle-color': p.figure,
            'circle-stroke-color': p.figure,
            'circle-stroke-width': 0,
            'circle-opacity': p.figureOpacity,
            'circle-stroke-opacity': 0,
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
    noseLayer(p, LAYERS.vehicleNoses, vehicleFilter(modes, selectedVehicle, true), overlapZoom, s, alpha),
    pillLayer(LAYERS.vehicles, vehicleFilter(modes, selectedVehicle), overlap, PILL_ZOOM, s, inks, mark),
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
      filter: prozor ? ['all', stops, ['get', 'label'], ['>=', ['get', 'rank'], prozor.stopLabelMinRank]] : stopLabelFilter(stops),
      layout: {
        'text-field': ['get', 'name'],
        'text-font': [MAP_FONTS.medium],
        'text-size': prozor ? 11 * s : zoomInterpolate(STOP_LABEL_ZOOM, 11 * s, 16, 13 * s),
        'text-anchor': 'top',
        'text-offset': [0, 0.7],
        'text-max-width': 9,
        'text-padding': 3,
        'symbol-sort-key': ['-', 100, ['get', 'rank']],
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
    noseLayer(p, LAYERS.vehicleSelectedNose, filters[LAYERS.vehicleSelectedNose], 0, s, alpha),
    pillLayer(LAYERS.vehicleSelected, filters[LAYERS.vehicleSelected], true, 0, s, pillInks(p, null), mark),
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
