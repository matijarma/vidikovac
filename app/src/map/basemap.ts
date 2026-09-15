// The Kaj ima? basemap: the Protomaps v4 vector schema drawn by
// @protomaps/basemaps, served from this origin (MAP_CONFIG owns every URL;
// hosting is worker/routes/maps.ts), in a light and a dark face that share
// one layer list and differ only in colour. The two faces are two Flavors:
// the upstream light/dark flavour with the product's own palette laid over
// it -- paper by day, ultramarine ink by night -- so the map reads as the
// same material as the sheet beside it, not a third-party embed. A theme
// flip is `styleDiff` applied through setPaintProperty on the live map
// (city-map.ts), never a setStyle that would throw away the vehicle, stop
// and route sources sitting on top.
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

/** The product palette laid over the upstream light flavour: land the paper
 *  canvas itself, parks a step of green kept just inside the paper family,
 *  roads white-on-tan casings, water an ultramarine tint at 12 % over
 *  canvas, labels in muted ink and full ink with the canvas as halo. Tunnels
 *  and the "other" road class recede to the canvas exactly -- unclassified
 *  and buried paths read as bare page, marked only by a casing where one
 *  exists; bridges repeat their surface counterpart's fill and casing
 *  value for value, as at any zoom a bridge is the same road merely raised. */
const LIGHT_OVERRIDES: Partial<Flavor> = {
  background: '#f4f2ec',
  earth: '#f4f2ec',
  park_a: '#e3e6d6',
  park_b: '#dbdfcc',
  wood_a: '#cfd8bf',
  wood_b: '#c4cfb3',
  scrub_a: '#e4e6d2',
  scrub_b: '#d9dec8',
  glacier: '#f4f2ec',
  sand: '#ebe6d6',
  beach: '#ece7d7',
  aerodrome: '#e9e6dc',
  runway: '#dbd9ce',
  zoo: '#e3e6d6',
  military: '#e9e6dc',
  hospital: '#f0e6e2',
  industrial: '#e9e6dc',
  school: '#ece9dc',
  pedestrian: '#e9e6dc',
  pier: '#e9e6dc',
  water: '#cdd3ea',
  buildings: '#e6e2d6',
  minor_service_casing: '#e4e0d4',
  minor_casing: '#ddd9cc',
  link_casing: '#d3cebe',
  major_casing_late: '#cdc8b8',
  highway_casing_late: '#d8cfa9',
  other: '#f4f2ec',
  minor_service: '#f7f5ef',
  minor_a: '#fbfaf6',
  minor_b: '#fbfaf6',
  link: '#fbfaf6',
  major_casing_early: '#cdc8b8',
  major: '#fbfaf6',
  highway_casing_early: '#d8cfa9',
  highway: '#f5efdc',
  railway: '#aeb0bd',
  boundaries: '#b9bccb',
  tunnel_other_casing: '#e8e5da',
  tunnel_minor_casing: '#e8e5da',
  tunnel_link_casing: '#e8e5da',
  tunnel_major_casing: '#e8e5da',
  tunnel_highway_casing: '#e8e5da',
  tunnel_other: '#f4f2ec',
  tunnel_minor: '#f4f2ec',
  tunnel_link: '#f4f2ec',
  tunnel_major: '#f4f2ec',
  tunnel_highway: '#f4f2ec',
  bridges_other_casing: '#ddd9cc',
  bridges_minor_casing: '#ddd9cc',
  bridges_link_casing: '#d3cebe',
  bridges_major_casing: '#cdc8b8',
  bridges_highway_casing: '#d8cfa9',
  bridges_other: '#f4f2ec',
  bridges_minor: '#fbfaf6',
  bridges_link: '#fbfaf6',
  bridges_major: '#fbfaf6',
  bridges_highway: '#f5efdc',
  roads_label_minor: '#4a5178',
  roads_label_minor_halo: '#f4f2ec',
  roads_label_major: '#4a5178',
  roads_label_major_halo: '#f4f2ec',
  ocean_label: '#4a5178',
  subplace_label: '#4a5178',
  subplace_label_halo: '#f4f2ec',
  city_label: '#0c1250',
  city_label_halo: '#f4f2ec',
  state_label: '#4a5178',
  state_label_halo: '#f4f2ec',
  country_label: '#4a5178',
  address_label: '#0c1250',
  address_label_halo: '#f4f2ec',
};

/** Ultramarine night: the dark ink itself as ground, water a step darker
 *  still, and roads simplified to two levels instead of the daylight's
 *  three -- one ribbon tone for every ordinary road (fills flatten to one
 *  value, casings to another) with only the highway breaking free as its
 *  own brighter fill, the way a paper map keeps its road hierarchy in white
 *  variants but a night map keeps only the one road that matters. Land-use
 *  polygons rarely seen on this city's tiles (aerodrome, hospital, school,
 *  sand and the rest) recede to the built tier so nothing carries the old
 *  mineral hue after dark; "other" and every tunnel fill drop to the ground
 *  colour exactly, matched to the light face's identical treatment. Labels
 *  sit in the dark muted tier or the bright ink tier with the ground as
 *  halo. */
const DARK_OVERRIDES: Partial<Flavor> = {
  background: '#0b1150',
  earth: '#0b1150',
  park_a: '#182060',
  park_b: '#151d5c',
  wood_a: '#0f1a5a',
  wood_b: '#0d1755',
  scrub_a: '#0f1a5a',
  scrub_b: '#0d1755',
  glacier: '#0b1150',
  sand: '#121a63',
  beach: '#121a63',
  aerodrome: '#121a63',
  runway: '#1d266e',
  zoo: '#0f1a5a',
  military: '#121a63',
  hospital: '#121a63',
  industrial: '#121a63',
  school: '#121a63',
  pedestrian: '#121a63',
  pier: '#121a63',
  water: '#080c40',
  buildings: '#121a63',
  minor_service_casing: '#26307f',
  minor_casing: '#26307f',
  link_casing: '#26307f',
  major_casing_late: '#26307f',
  highway_casing_late: '#26307f',
  other: '#0b1150',
  minor_service: '#1a2373',
  minor_a: '#1a2373',
  minor_b: '#1a2373',
  link: '#1a2373',
  major_casing_early: '#26307f',
  major: '#1a2373',
  highway_casing_early: '#26307f',
  highway: '#2a347f',
  railway: '#4a5178',
  boundaries: '#5a6187',
  tunnel_other_casing: '#192168',
  tunnel_minor_casing: '#192168',
  tunnel_link_casing: '#192168',
  tunnel_major_casing: '#192168',
  tunnel_highway_casing: '#192168',
  tunnel_other: '#0b1150',
  tunnel_minor: '#0b1150',
  tunnel_link: '#0b1150',
  tunnel_major: '#0b1150',
  tunnel_highway: '#0b1150',
  bridges_other_casing: '#26307f',
  bridges_minor_casing: '#26307f',
  bridges_link_casing: '#26307f',
  bridges_major_casing: '#26307f',
  bridges_highway_casing: '#26307f',
  bridges_other: '#0b1150',
  bridges_minor: '#1a2373',
  bridges_link: '#1a2373',
  bridges_major: '#1a2373',
  bridges_highway: '#2a347f',
  roads_label_minor: '#b6bbe0',
  roads_label_minor_halo: '#0b1150',
  roads_label_major: '#b6bbe0',
  roads_label_major_halo: '#0b1150',
  ocean_label: '#b6bbe0',
  subplace_label: '#b6bbe0',
  subplace_label_halo: '#0b1150',
  city_label: '#f4f2ec',
  city_label_halo: '#0b1150',
  state_label: '#b6bbe0',
  state_label_halo: '#0b1150',
  country_label: '#b6bbe0',
  address_label: '#f4f2ec',
  address_label_halo: '#0b1150',
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

/* The mode colours repeat the interface roles value for value: a tram and
 * its route line are the accent role (--tone-accent, #03409c light, #f4f2ec
 * dark, paper-on-night so its text inverts to the dark ink); a bus and its
 * route line the transit role (--tone-transit, #0c1250 light, the same hex
 * as ink -- #9fb4ff dark); a closure the urgency role (#b3271e, #ff9d9d).
 * The stop fill and every halo take the canvas or its brighter paper-white
 * sibling; the selection and the screen stop pin take the ink and accent
 * roles. One Zagreb blue and one ink across the map, the badges
 * (ui/signage.css) and the mode chips (ui/map.css). MapLibre paints from
 * literals, so these are the token hexes written out; tokens.css stays
 * their single source (R-D2). */
export const OVERLAY_LIGHT: Readonly<OverlayPalette> = Object.freeze({
  tram: '#03409c',
  tramText: '#ffffff',
  bus: '#0c1250',
  busText: '#ffffff',
  other: '#4a5178',
  otherText: '#fbfaf6',
  routeTram: '#03409c',
  routeBus: '#0c1250',
  stopFill: '#f4f2ec',
  stopStroke: '#4a5178',
  label: '#0c1250',
  halo: '#fbfaf6',
  closure: '#b3271e',
  closureCasing: '#fbfaf6',
  place: '#b8731a',
  selection: '#0c1250',
  selectionHalo: '#fbfaf6',
  screenStop: '#03409c',
});

export const OVERLAY_DARK: Readonly<OverlayPalette> = Object.freeze({
  tram: '#f4f2ec',
  tramText: '#0b1150',
  bus: '#9fb4ff',
  busText: '#0b1150',
  other: '#b6bbe0',
  otherText: '#0b1150',
  routeTram: '#f4f2ec',
  routeBus: '#9fb4ff',
  stopFill: '#0b1150',
  stopStroke: '#b6bbe0',
  label: '#f4f2ec',
  halo: '#0b1150',
  closure: '#ff9d9d',
  closureCasing: '#0b1150',
  place: '#f0c060',
  selection: '#f4f2ec',
  selectionHalo: '#0b1150',
  screenStop: '#f4f2ec',
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
