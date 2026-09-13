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
// so no vehicle ever vanishes; from PILL_OVERLAP_ZOOM every pill and its nose
// draw unconditionally. The selected or followed vehicle draws at every
// zoom. Stop names come in by rank, the busiest corners first, one per
// named stop, and yield to the vehicles above them.
import { ROUTE_TYPE_BUS, ROUTE_TYPE_TRAM } from '../motion/schematic';
import { MAP_FONTS, type OverlayPalette, type StyleLayerLike } from './basemap';
import type { MapSelection, VehicleKind } from './city-map';
import { sdfRing, sdfRoundedRect, sdfTriangle, type SdfImage } from './sdf';

export const SOURCES = Object.freeze({
  network: 'network',
  stops: 'stops',
  closures: 'closures',
  places: 'places',
  vehicles: 'vehicles',
  screenStop: 'screen-stop',
});

export const LAYERS = Object.freeze({
  networkBus: 'network-bus',
  networkTram: 'network-tram',
  networkSelectedCasing: 'network-selected-casing',
  networkSelected: 'network-selected',
  closuresCasing: 'closures-casing',
  closures: 'closures',
  places: 'places',
  stopsRoute: 'stops-route',
  stops: 'stops',
  stopsSelected: 'stops-selected',
  screenStop: 'screen-stop',
  vehicleDots: 'vehicle-dots',
  vehicleNoses: 'vehicle-noses',
  vehicles: 'vehicles',
  stopLabels: 'stop-labels',
  screenStopLabel: 'screen-stop-label',
  vehicleSelectedNose: 'vehicle-selected-nose',
  vehicleSelected: 'vehicle-selected',
  selectionRing: 'selection-ring',
});

/** Layers drawn under the basemap's own labels, so street names still read over the network. */
export const BELOW_LABELS: ReadonlySet<string> = new Set([
  LAYERS.networkBus, LAYERS.networkTram, LAYERS.networkSelectedCasing, LAYERS.networkSelected, LAYERS.closuresCasing, LAYERS.closures,
]);

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
export const NOSE_IMAGE = 'vehicle-nose';
export const RING_IMAGE = 'selection-ring';

export interface OverlayImage { id: string; image: SdfImage }

/** Every SDF image the overlays reference, generated once per map. */
export function overlayImages(): OverlayImage[] {
  const pills = PILL_WIDTHS_PX.map((w, i) => ({ id: `${PILL_IMAGE_PREFIX}${i + 1}`, image: sdfRoundedRect(w, PILL_HEIGHT_PX, PILL_HEIGHT_PX / 2) }));
  return [...pills, { id: NOSE_IMAGE, image: sdfTriangle(NOSE_LENGTH_PX, NOSE_WIDTH_PX) }, { id: RING_IMAGE, image: sdfRing(RING_DIAMETER_PX, RING_STROKE_PX) }];
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
function stopLabelFilter(modes: ReadonlySet<number> | null | undefined): Expr {
  const base: Expr = ['all', stopFilter(modes), ['get', 'label']];
  return ['step', ['zoom'], ['all', base, ['>=', ['get', 'rank'], 4]], STOP_LABEL_ZOOM + 1, ['all', base, ['>=', ['get', 'rank'], 2]], STOP_LABEL_ZOOM + 2, base];
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
}

function pillLayer(p: OverlayPalette, id: string, filter: Expr, overlap: boolean | Expr, minzoom: number, s: number, opacity: Expr): StyleLayerLike {
  return {
    id,
    type: 'symbol',
    source: SOURCES.vehicles,
    ...(minzoom > 0 ? { minzoom } : {}),
    filter,
    layout: {
      'icon-image': PILL_IMAGE,
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
      'icon-color': kindColor(p, 'fill'),
      'icon-halo-color': p.halo,
      'icon-halo-width': 1,
      'icon-opacity': opacity,
      'text-color': kindColor(p, 'text'),
      'text-opacity': opacity,
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
  const selectedVehicle = sel?.kind === 'vehicle' ? sel.id : null;
  const selectedClosure = sel?.kind === 'closure' ? sel.id : null;
  const alpha = vehicleOpacity(sel?.kind === 'route' ? sel.id : null);
  const filters = selectionFilters(sel);
  const kinds = vehicleKinds(modes);
  const round = { 'line-cap': 'round', 'line-join': 'round' };
  const visible = (on: boolean): Record<string, unknown> => ({ visibility: on ? 'visible' : 'none' });
  const closures = visible(options.closuresVisible !== false);
  const networkOpacity = sel?.kind === 'route' ? NETWORK_OPACITY_DIMMED : NETWORK_OPACITY;
  const overlap: Expr = ['step', ['zoom'], false, PILL_OVERLAP_ZOOM, true];
  const network = (id: string, kind: 'tram' | 'bus', color: string, width: Expr): StyleLayerLike => ({
    id,
    type: 'line',
    source: SOURCES.network,
    filter: ['==', ['get', 'kind'], kind],
    layout: { ...round, ...visible(kinds.includes(kind)) },
    paint: { 'line-color': color, 'line-width': width, 'line-opacity': networkOpacity },
  });
  const labelInk = { 'text-color': p.label, 'text-halo-color': p.halo };
  const circle = (id: string, source: string, paint: Record<string, unknown>, extra: Partial<StyleLayerLike> = {}): StyleLayerLike => ({ id, type: 'circle', source, paint, ...extra });
  return [
    network(LAYERS.networkBus, 'bus', p.routeBus, zoomInterpolate(10, 0.7, 13, 1.4, 16, 3.5)),
    network(LAYERS.networkTram, 'tram', p.routeTram, zoomInterpolate(10, 1, 13, 1.8, 16, 4.5)),
    { id: LAYERS.networkSelectedCasing, type: 'line', source: SOURCES.network, filter: filters[LAYERS.networkSelectedCasing], layout: round, paint: { 'line-color': p.selectionHalo, 'line-width': zoomInterpolate(10, 5, 16, 11) } },
    { id: LAYERS.networkSelected, type: 'line', source: SOURCES.network, filter: filters[LAYERS.networkSelected], layout: round, paint: { 'line-color': ['match', ['get', 'kind'], 'tram', p.routeTram, 'bus', p.routeBus, p.other], 'line-width': zoomInterpolate(10, 2.5, 16, 6.5) } },
    { id: LAYERS.closuresCasing, type: 'line', source: SOURCES.closures, layout: { ...round, ...closures }, paint: { 'line-color': p.closureCasing, 'line-width': closureWidth(selectedClosure, 7) } },
    { id: LAYERS.closures, type: 'line', source: SOURCES.closures, layout: { ...round, ...closures }, paint: { 'line-color': p.closure, 'line-width': closureWidth(selectedClosure, 4) } },
    circle(LAYERS.places, SOURCES.places, { 'circle-radius': 6 * s, 'circle-color': p.place, 'circle-stroke-color': p.halo, 'circle-stroke-width': 1.5 }),
    circle(LAYERS.stopsRoute, SOURCES.stops, { 'circle-radius': zoomInterpolate(11, 2 * s, 14, 3.5 * s, 16, 5.5 * s), 'circle-color': p.selection, 'circle-stroke-color': p.selectionHalo, 'circle-stroke-width': 1.5 }, { minzoom: 11, filter: filters[LAYERS.stopsRoute] }),
    circle(
      LAYERS.stops,
      SOURCES.stops,
      {
        'circle-radius': zoomInterpolate(STOP_ZOOM, 1.5 * s, 14, 2.6 * s, 16, 4.5 * s),
        'circle-color': p.stopFill,
        'circle-stroke-color': p.stopStroke,
        'circle-stroke-width': zoomInterpolate(STOP_ZOOM, 0.8, 16, 1.6),
        'circle-opacity': zoomInterpolate(STOP_ZOOM, 0.5, 14, 1),
        'circle-stroke-opacity': zoomInterpolate(STOP_ZOOM, 0.5, 14, 1),
      },
      { minzoom: STOP_ZOOM, filter: stopFilter(modes) },
    ),
    circle(LAYERS.stopsSelected, SOURCES.stops, { 'circle-radius': zoomInterpolate(11, 6 * s, 16, 11 * s), 'circle-color': p.selection, 'circle-opacity': 0, 'circle-stroke-color': p.selection, 'circle-stroke-width': 3 }, { filter: filters[LAYERS.stopsSelected] }),
    circle(LAYERS.screenStop, SOURCES.screenStop, { 'circle-radius': 7 * s, 'circle-color': p.screenStop, 'circle-stroke-color': p.halo, 'circle-stroke-width': 2 }),
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
    noseLayer(p, LAYERS.vehicleNoses, vehicleFilter(modes, selectedVehicle, true), PILL_OVERLAP_ZOOM, s, alpha),
    pillLayer(p, LAYERS.vehicles, vehicleFilter(modes, selectedVehicle), overlap, PILL_ZOOM, s, alpha),
    {
      id: LAYERS.stopLabels,
      type: 'symbol',
      source: SOURCES.stops,
      minzoom: STOP_LABEL_ZOOM,
      filter: stopLabelFilter(modes),
      layout: {
        'text-field': ['get', 'name'],
        'text-font': [MAP_FONTS.medium],
        'text-size': zoomInterpolate(STOP_LABEL_ZOOM, 11 * s, 16, 13 * s),
        'text-anchor': 'top',
        'text-offset': [0, 0.7],
        'text-max-width': 9,
        'text-padding': 3,
        'symbol-sort-key': ['-', 100, ['get', 'rank']],
      },
      paint: { ...labelInk, 'text-halo-width': 1.4 },
    },
    {
      id: LAYERS.screenStopLabel,
      type: 'symbol',
      source: SOURCES.screenStop,
      layout: { 'text-field': ['get', 'name'], 'text-font': [MAP_FONTS.medium], 'text-size': 13 * s, 'text-anchor': 'top', 'text-offset': [0, 0.9], 'text-max-width': 9, 'text-allow-overlap': true, 'text-ignore-placement': true },
      paint: { ...labelInk, 'text-halo-width': 1.6 },
    },
    noseLayer(p, LAYERS.vehicleSelectedNose, filters[LAYERS.vehicleSelectedNose], 0, s, alpha),
    pillLayer(p, LAYERS.vehicleSelected, filters[LAYERS.vehicleSelected], true, 0, s, alpha),
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
