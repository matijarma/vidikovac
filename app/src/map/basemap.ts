// The Kaj ima? basemap: the Protomaps v4 vector schema drawn by
// @protomaps/basemaps, served from this origin (MAP_CONFIG owns every URL;
// hosting is worker/routes/maps.ts), in a light and a dark face that share
// one layer list and differ only in colour. The two faces are two Flavors:
// the upstream light/dark flavour with the product's own palette laid over
// it -- mineral daylight and deep-neutral night, peacock water -- so the map
// reads as the same material as the sheet beside it, not a third-party
// embed. A theme flip is `styleDiff` applied through setPaintProperty on the
// live map (city-map.ts), never a setStyle that would throw away the
// vehicle, stop and route sources sitting on top.
//
// Pure: no DOM, no MapLibre import. The library that builds the layers is
// 38 kB and only ever loaded through maplibre-entry.ts's dynamic import, so
// the lightweight graph never carries it; a unit test imports this file
// directly in node.
import { layers as protomapsLayers, namedFlavor, type Flavor } from '@protomaps/basemaps';
import { MAP_CONFIG } from '../core/contracts';

export type MapTheme = 'light' | 'dark';

/** The one vector source every basemap layer reads from. */
export const BASEMAP_SOURCE = 'basemap';

/** The three glyph fontstacks the self-hosted glyph endpoint carries
 *  (scripts/map-assets.mjs copies exactly these; MAP_CONFIG.glyphs serves
 *  them). Requested one per path segment, so no comma-joined fallback list
 *  appears anywhere in the style. */
export const MAP_FONTS = Object.freeze({ regular: 'Noto Sans Regular', medium: 'Noto Sans Medium', italic: 'Noto Sans Italic' });

/** The point icons the self-hosted sprite carries (protomaps/basemaps-assets
 *  sprites/v4; scripts/map-assets.mjs copies it). @protomaps/basemaps 5.7.2's
 *  pois layer asks for every POI kind by name and its filter admits a kind the
 *  v4 sprite has no image for (townhall), which MapLibre reports as a missing
 *  image on every frame. The style built here asks only for what the sprite
 *  has; a kind without an image keeps its name label and gets no icon. */
export const SPRITE_V4_ICONS: readonly string[] = Object.freeze([
  'aerodrome', 'animal', 'arrow', 'artwork', 'attraction', 'bar', 'beach', 'beauty', 'bench', 'books', 'building', 'bus_stop', 'cafe',
  'capital', 'clothes', 'convenience', 'drinking_water', 'electronics', 'fast_food', 'ferry_terminal', 'forest', 'garden', 'library',
  'marina', 'museum', 'park', 'peak', 'post_office', 'restaurant', 'school', 'stadium', 'supermarket', 'theatre', 'toilets', 'townspot',
  'train_station', 'university', 'zoo',
]);

/** The pois layer with its icon bound to the sprite: station keeps upstream's train_station alias, anything else names itself only when the sprite has it. */
function boundPoiIcons(layer: StyleLayerLike): StyleLayerLike {
  const icon = ['case', ['==', ['get', 'kind'], 'station'], 'train_station', ['in', ['get', 'kind'], ['literal', SPRITE_V4_ICONS]], ['get', 'kind'], ''];
  return { ...layer, layout: { ...(layer.layout ?? {}), 'icon-image': icon } };
}

/** The tileset stops at 14; streets stay legible overzoomed to 18. */
export const MAP_MAX_ZOOM = 18;
/** Below this the bounded regional archive is a few tiles of nothing. */
export const MAP_MIN_ZOOM = 10;
/** The opening view: Trg bana Jelačića at this zoom fits the inner city on a
 *  phone and most of the tram network on a desk, and sits above
 *  overlays.ts's PILL_ZOOM so the first glance already reads numbered
 *  vehicles (thinned by collision), never a field of anonymous dots. */
export const CITY_ZOOM = 13;
/** Padding around MAP_CONFIG.bounds (degrees) the camera may not leave. */
const BOUNDS_MARGIN_DEG = 0.05;

/** What the camera may pan to: the archive's own bounds plus a hair, so a
 *  drag can never reach a grey nowhere outside the tiles. */
export function maxBounds(): [[number, number], [number, number]] {
  const [w, s, e, n] = MAP_CONFIG.bounds;
  return [[w - BOUNDS_MARGIN_DEG, s - BOUNDS_MARGIN_DEG], [e + BOUNDS_MARGIN_DEG, n + BOUNDS_MARGIN_DEG]];
}

/** 'en' labels prefer `name:en`, anything else `name:hr`; both fall back to
 *  the local `name` inside @protomaps/basemaps' own expression. */
export function labelLanguage(locale: string | undefined): 'hr' | 'en' {
  return locale?.toLowerCase().startsWith('en') ? 'en' : 'hr';
}

/** A root-relative MAP_CONFIG path as the absolute URL MapLibre wants for
 *  tiles, glyphs and sprites. `origin` is the page's when there is one;
 *  tests pass their own. */
export function absoluteMapUrl(path: string, origin?: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const base = origin ?? (typeof location !== 'undefined' ? location.origin : '');
  return base ? `${base}${path}` : path;
}

export function spriteUrl(theme: MapTheme, origin?: string): string {
  return absoluteMapUrl(theme === 'dark' ? MAP_CONFIG.darkSprite : MAP_CONFIG.sprite, origin);
}

/** The product palette laid over the upstream light flavour: land a shade
 *  cooler than the mineral sheet beside it, parks that read as parks from
 *  across a room, roads white on grey casings, water a soft peacock, labels
 *  in the product's ink and muted ink with the canvas as halo. */
const LIGHT_OVERRIDES: Partial<Flavor> = {
  background: '#e9eeec',
  earth: '#eef2f0',
  park_a: '#d3e6d6',
  park_b: '#c8ddcc',
  wood_a: '#c4d9c6',
  wood_b: '#b9d1bc',
  scrub_a: '#d9e6da',
  scrub_b: '#cfe0d1',
  glacier: '#eef2f0',
  sand: '#ebe6d6',
  beach: '#ece7d7',
  aerodrome: '#e3e8e6',
  runway: '#d5dbd8',
  zoo: '#d3e6d6',
  military: '#e3e6e4',
  hospital: '#efe4e4',
  industrial: '#e4e8e6',
  school: '#e8ebe2',
  pedestrian: '#e4e9e6',
  pier: '#e4e9e6',
  water: '#b9d6d9',
  buildings: '#dfe5e2',
  minor_service_casing: '#e0e5e2',
  minor_casing: '#d7ddda',
  link_casing: '#cfd6d2',
  major_casing_late: '#c9d1cd',
  highway_casing_late: '#d8cfa9',
  other: '#f3f5f4',
  minor_service: '#f7f9f8',
  minor_a: '#ffffff',
  minor_b: '#ffffff',
  link: '#ffffff',
  major_casing_early: '#c9d1cd',
  major: '#ffffff',
  highway_casing_early: '#d8cfa9',
  highway: '#f7f0da',
  railway: '#a9b5b0',
  boundaries: '#b5bfba',
  tunnel_other_casing: '#e6eae8',
  tunnel_minor_casing: '#e6eae8',
  tunnel_link_casing: '#e6eae8',
  tunnel_major_casing: '#e6eae8',
  tunnel_highway_casing: '#e6eae8',
  tunnel_other: '#f0f3f1',
  tunnel_minor: '#f0f3f1',
  tunnel_link: '#f0f3f1',
  tunnel_major: '#f0f3f1',
  tunnel_highway: '#f3f0e6',
  bridges_other_casing: '#d7ddda',
  bridges_minor_casing: '#d7ddda',
  bridges_link_casing: '#cfd6d2',
  bridges_major_casing: '#c9d1cd',
  bridges_highway_casing: '#d8cfa9',
  bridges_other: '#f3f5f4',
  bridges_minor: '#ffffff',
  bridges_link: '#ffffff',
  bridges_major: '#ffffff',
  bridges_highway: '#f7f0da',
  roads_label_minor: '#68766f',
  roads_label_minor_halo: '#f6f8f7',
  roads_label_major: '#526461',
  roads_label_major_halo: '#f6f8f7',
  ocean_label: '#3c7a80',
  subplace_label: '#6b7b76',
  subplace_label_halo: '#f6f8f7',
  city_label: '#182423',
  city_label_halo: '#f6f8f7',
  state_label: '#7f8d88',
  state_label_halo: '#f6f8f7',
  country_label: '#526461',
  address_label: '#8a978f',
  address_label_halo: '#f6f8f7',
};

/** Deep neutral night: the dark surface as ground, water a deep peacock,
 *  roads as lighter ribbons over a darker casing (three clear levels:
 *  ground, block, road), labels in the dark ink with the surface as halo. */
const DARK_OVERRIDES: Partial<Flavor> = {
  background: '#151d1c',
  earth: '#1b2523',
  park_a: '#20322b',
  park_b: '#1d2e28',
  wood_a: '#1c2c26',
  wood_b: '#192823',
  scrub_a: '#1f2f29',
  scrub_b: '#1d2c27',
  glacier: '#1f2927',
  sand: '#272c25',
  beach: '#272c25',
  aerodrome: '#212a28',
  runway: '#2c3633',
  zoo: '#20322b',
  military: '#222b29',
  hospital: '#2c2728',
  industrial: '#212b29',
  school: '#242d28',
  pedestrian: '#26322f',
  pier: '#26322f',
  water: '#102a2e',
  buildings: '#263532',
  minor_service_casing: '#161f1d',
  minor_casing: '#161f1d',
  link_casing: '#161f1d',
  major_casing_late: '#161f1d',
  highway_casing_late: '#161f1d',
  other: '#2b3936',
  minor_service: '#293735',
  minor_a: '#2f3e3b',
  minor_b: '#2f3e3b',
  link: '#3a4c48',
  major_casing_early: '#161f1d',
  major: '#42554f',
  highway_casing_early: '#161f1d',
  highway: '#55675f',
  railway: '#4a5c57',
  boundaries: '#3f4f4b',
  tunnel_other_casing: '#161f1d',
  tunnel_minor_casing: '#161f1d',
  tunnel_link_casing: '#161f1d',
  tunnel_major_casing: '#161f1d',
  tunnel_highway_casing: '#161f1d',
  tunnel_other: '#25312f',
  tunnel_minor: '#25312f',
  tunnel_link: '#2b3936',
  tunnel_major: '#2b3936',
  tunnel_highway: '#33413d',
  bridges_other_casing: '#161f1d',
  bridges_minor_casing: '#161f1d',
  bridges_link_casing: '#161f1d',
  bridges_major_casing: '#161f1d',
  bridges_highway_casing: '#161f1d',
  bridges_other: '#2b3936',
  bridges_minor: '#2f3e3b',
  bridges_link: '#3a4c48',
  bridges_major: '#42554f',
  bridges_highway: '#55675f',
  roads_label_minor: '#8fa09a',
  roads_label_minor_halo: '#17201f',
  roads_label_major: '#b8c7c1',
  roads_label_major_halo: '#17201f',
  ocean_label: '#73b5bb',
  subplace_label: '#95a8a2',
  subplace_label_halo: '#17201f',
  city_label: '#eff6f3',
  city_label_halo: '#17201f',
  state_label: '#8b9c96',
  state_label_halo: '#17201f',
  country_label: '#b8c7c1',
  address_label: '#7d8d88',
  address_label_halo: '#17201f',
};

/** The upstream flavour for `theme` with the product palette over it and
 *  the three self-hosted fontstacks named, so no layer ever asks the glyph
 *  endpoint for a face it does not carry. */
export function flavorFor(theme: MapTheme): Flavor {
  const base = namedFlavor(theme);
  return { ...base, ...(theme === 'dark' ? DARK_OVERRIDES : LIGHT_OVERRIDES), regular: MAP_FONTS.regular, bold: MAP_FONTS.medium, italic: MAP_FONTS.italic };
}

/** What sits on top of the basemap -- vehicles, the route network, stops,
 *  closures, places, the selection -- in each face. A number on a pill must
 *  read at 4.5:1 against it (test/app/map.test.ts checks every pair). */
export interface OverlayPalette {
  tram: string;
  tramText: string;
  bus: string;
  busText: string;
  other: string;
  otherText: string;
  routeTram: string;
  routeBus: string;
  stopFill: string;
  stopStroke: string;
  label: string;
  halo: string;
  closure: string;
  closureCasing: string;
  place: string;
  selection: string;
  selectionHalo: string;
  screenStop: string;
}

/* The mode colours repeat the interface roles value for value: a bus and its
 * route line are the transit role (--tone-transit, #0b4f6c light, #8fd0ec
 * dark), a closure the urgency role (#b3271e, #ff9d9d), a tram the brand
 * (#08777b, #63d7c3), another mode the muted text colour. One blue and one
 * rose across the map, the badges (ui/signage.css) and the mode chips
 * (ui/map.css). MapLibre paints from literals, so these are the token hexes
 * written out; tokens.css stays their single source (R-D2). */
export const OVERLAY_LIGHT: Readonly<OverlayPalette> = Object.freeze({
  tram: '#08777b',
  tramText: '#ffffff',
  bus: '#0b4f6c',
  busText: '#ffffff',
  other: '#526461',
  otherText: '#ffffff',
  routeTram: '#08777b',
  routeBus: '#0b4f6c',
  stopFill: '#f6f8f7',
  stopStroke: '#526461',
  label: '#182423',
  halo: '#f6f8f7',
  closure: '#b3271e',
  closureCasing: '#f6f8f7',
  place: '#b8731a',
  selection: '#182423',
  selectionHalo: '#f6f8f7',
  screenStop: '#08777b',
});

export const OVERLAY_DARK: Readonly<OverlayPalette> = Object.freeze({
  tram: '#63d7c3',
  tramText: '#17201f',
  bus: '#8fd0ec',
  busText: '#17201f',
  other: '#8fa09a',
  otherText: '#17201f',
  routeTram: '#63d7c3',
  routeBus: '#8fd0ec',
  stopFill: '#17201f',
  stopStroke: '#b8c7c1',
  label: '#eff6f3',
  halo: '#17201f',
  closure: '#ff9d9d',
  closureCasing: '#17201f',
  place: '#f0c060',
  selection: '#eff6f3',
  selectionHalo: '#17201f',
  screenStop: '#63d7c3',
});

export function overlayPalette(theme: MapTheme): Readonly<OverlayPalette> {
  return theme === 'dark' ? OVERLAY_DARK : OVERLAY_LIGHT;
}

/** The credit as the attribution control shows it: the OpenStreetMap words
 *  MAP_CONFIG carries, as the link to the copyright page the ODbL asks for,
 *  and Protomaps as the archive builder. Static markup, never feed text. */
export const MAP_ATTRIBUTION_HTML =
  '<a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer" target="_blank">© OpenStreetMap contributors</a> · <a href="https://protomaps.com" rel="noopener noreferrer" target="_blank">Protomaps</a>';

/** A loose structural view of a style layer: enough for the diff below and
 *  the tests without binding this module to the style-spec types. The
 *  wrapper casts at the MapLibre boundary. */
export interface StyleLayerLike {
  id: string;
  type: string;
  source?: string;
  'source-layer'?: string;
  minzoom?: number;
  maxzoom?: number;
  filter?: unknown;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
}

export interface BasemapStyle {
  version: 8;
  name: string;
  glyphs: string;
  sprite: string;
  sources: Record<string, Record<string, unknown>>;
  layers: StyleLayerLike[];
}

export interface BasemapStyleOptions {
  /** The page's locale; decides which `name:*` the labels prefer. */
  locale?: string;
  /** Resolves MAP_CONFIG's root-relative paths; defaults to the document's origin. */
  origin?: string;
}

/** The basemap layers alone for `theme`: what a live map diffs on a theme
 *  or locale change. */
export function basemapLayers(theme: MapTheme, options: BasemapStyleOptions = {}): StyleLayerLike[] {
  const layers = protomapsLayers(BASEMAP_SOURCE, flavorFor(theme), { lang: labelLanguage(options.locale) }) as unknown as StyleLayerLike[];
  return layers.map((layer) => (layer.id === 'pois' ? boundPoiIcons(layer) : layer));
}

/**
 * The whole basemap style for one theme: the one same-origin vector source,
 * the self-hosted glyphs and the face's sprite, and the layer list. Nothing
 * in it reaches a third-party host. The source carries the credit as the
 * linked HTML above, so the attribution control shows it exactly once.
 */
export function basemapStyle(theme: MapTheme, options: BasemapStyleOptions = {}): BasemapStyle {
  const { origin } = options;
  return {
    version: 8,
    name: `Kaj ima? ${theme}`,
    glyphs: absoluteMapUrl(MAP_CONFIG.glyphs, origin),
    sprite: spriteUrl(theme, origin),
    sources: {
      [BASEMAP_SOURCE]: {
        type: 'vector',
        tiles: [absoluteMapUrl(MAP_CONFIG.tiles, origin)],
        minzoom: MAP_CONFIG.minzoom,
        maxzoom: MAP_CONFIG.maxzoom,
        bounds: [...MAP_CONFIG.bounds],
        attribution: MAP_ATTRIBUTION_HTML,
      },
    },
    layers: basemapLayers(theme, options),
  };
}

/** One property change a live map applies to move from one face to another. */
export interface StyleOp {
  id: string;
  kind: 'paint' | 'layout' | 'filter';
  key: string;
  value: unknown;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Every paint, layout and filter difference between two layer lists that
 * share their ids, as the operations a live map applies through
 * setPaintProperty / setLayoutProperty / setFilter. Layers only one side
 * has are ignored: the two faces of this basemap share one layer list by
 * construction, and the overlays are not part of either.
 */
export function styleDiff(from: readonly StyleLayerLike[], to: readonly StyleLayerLike[]): StyleOp[] {
  const before = new Map(from.map((layer) => [layer.id, layer]));
  const ops: StyleOp[] = [];
  for (const layer of to) {
    const previous = before.get(layer.id);
    if (!previous) continue;
    for (const kind of ['paint', 'layout'] as const) {
      const a = previous[kind] ?? {};
      const b = layer[kind] ?? {};
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (!same(a[key], b[key])) ops.push({ id: layer.id, kind, key, value: b[key] });
      }
    }
    if (!same(previous.filter, layer.filter)) ops.push({ id: layer.id, kind: 'filter', key: 'filter', value: layer.filter });
  }
  return ops;
}
