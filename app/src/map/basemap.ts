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
// Upstream is never forked. Everything this file adds to @protomaps/basemaps'
// own output is a pure post-transform over the layer list it returns: one
// "house" pass that every surface gets (the POI palette collapsed onto the
// product's two inks, a label halo as strong as the glyph renderer allows,
// buildings, parks and water settled one step off the ground) and one
// optional `profile: 'sign'` pass on top of it, for the surface that is read
// from three metres (kiosk/mapview.ts). The phone and the kvart thumbnail
// stay on 'default'.
//
// Pure: no DOM, no MapLibre import. The library that builds the layers is
// 38 kB and only ever loaded through maplibre-entry.ts's dynamic import, so
// the lightweight graph never carries it; a unit test imports this file
// directly in node.
import { layers as protomapsLayers, namedFlavor, type Flavor } from '@protomaps/basemaps';
import { MAP_CONFIG } from '../core/contracts';

export type MapTheme = 'light' | 'dark';

/** Which basemap the surface asks for: 'sign' is the one surface read from
 *  across a room (kiosk/mapview.ts); the phone (transport/workspace.ts) and
 *  the kvart thumbnail (experience/kvart.ts) stay on 'default'. */
export type BasemapProfile = 'default' | 'sign';

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

/** Upstream paints POI names in six hues, and on this product's paper ground
 *  four of them fail WCAG 4.5:1 outright (measured against #f4f2ec: pink
 *  2.80, blue 3.39, tangerine 3.42, green 4.25). `flavor.pois` is the one
 *  palette group the two override blocks below never reached, so the failure
 *  survived every other colour decision in this file.
 *
 *  It collapses onto the two inks the product already has, on every surface
 *  (phone, desk and screen alike -- this is a correctness fix, not a sign
 *  profile): full ink for what a person would walk to (nature, transport,
 *  civic, the sights) and muted ink for the commercial groups, which the sign
 *  profile drops entirely anyway. Measured: 15.40:1 and 6.85:1 by day,
 *  15.50:1 and 9.23:1 by night. The eight keys are upstream's whole group;
 *  `red` and `turquoise` reach no layer but are set so no future upstream
 *  layer can reintroduce an unmeasured hue. */
const POI_INK_LIGHT = Object.freeze({
  green: '#0c1250', lapis: '#0c1250', slategray: '#0c1250', pink: '#0c1250',
  blue: '#4a5178', tangerine: '#4a5178', red: '#4a5178', turquoise: '#4a5178',
});
const POI_INK_DARK = Object.freeze({
  green: '#f4f2ec', lapis: '#f4f2ec', slategray: '#f4f2ec', pink: '#f4f2ec',
  blue: '#b6bbe0', tangerine: '#b6bbe0', red: '#b6bbe0', turquoise: '#b6bbe0',
});

/** The product palette laid over the upstream light flavour: land the paper
 *  canvas itself, parks a step of green kept just inside the paper family,
 *  roads white-on-tan casings, water an ultramarine tint at 12 % over
 *  canvas, labels in muted ink and full ink with the canvas as halo.
 *  Buildings, parks, woods and water sit one step off the canvas rather than
 *  a whisper away from it: at three metres a 1.05:1 fill is not a surface, it
 *  is noise, and the promoted labels of the sign profile need something to
 *  sit on. Measured against the canvas: buildings 1.32:1, parks 1.34:1, woods
 *  1.57:1, water 1.44:1. Tunnels
 *  and the "other" road class recede to the canvas exactly -- unclassified
 *  and buried paths read as bare page, marked only by a casing where one
 *  exists; bridges repeat their surface counterpart's fill and casing
 *  value for value, as at any zoom a bridge is the same road merely raised. */
const LIGHT_OVERRIDES: Partial<Flavor> = {
  background: '#f4f2ec',
  earth: '#f4f2ec',
  park_a: '#d5dcc2',
  park_b: '#cfd6bb',
  wood_a: '#c2cbb0',
  wood_b: '#bec7aa',
  scrub_a: '#d9dfc8',
  scrub_b: '#d1d8bc',
  glacier: '#f4f2ec',
  sand: '#ebe6d6',
  beach: '#ece7d7',
  aerodrome: '#e9e6dc',
  runway: '#dbd9ce',
  zoo: '#d5dcc2',
  military: '#e9e6dc',
  hospital: '#f0e6e2',
  industrial: '#e9e6dc',
  school: '#ece9dc',
  pedestrian: '#e9e6dc',
  pier: '#e9e6dc',
  water: '#c3cbe8',
  buildings: '#dad4c2',
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
  pois: POI_INK_LIGHT,
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
 *  halo. The built, planted and water tiers step off the ground by the same
 *  measure as by day (buildings 1.28:1, parks 1.33:1, woods 1.54:1, water
 *  1.18:1 -- water can only move away from an ink ground by going darker,
 *  and near-black is as far as that goes). */
const DARK_OVERRIDES: Partial<Flavor> = {
  background: '#0b1150',
  earth: '#0b1150',
  park_a: '#1a2d64',
  park_b: '#172a5e',
  wood_a: '#1d3a68',
  wood_b: '#1a3562',
  scrub_a: '#18295c',
  scrub_b: '#152657',
  glacier: '#0b1150',
  sand: '#121a63',
  beach: '#121a63',
  aerodrome: '#121a63',
  runway: '#1d266e',
  zoo: '#1a2d64',
  military: '#121a63',
  hospital: '#121a63',
  industrial: '#121a63',
  school: '#121a63',
  pedestrian: '#121a63',
  pier: '#121a63',
  water: '#02030f',
  buildings: '#1a2474',
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
  pois: POI_INK_DARK,
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
  /** A dated happening the source itself gave a coordinate: the events role. */
  event: string;
  /** A communal work the register files at a point: the muted-ink role, a
   *  step back from an event because a register entry is not an occasion. */
  work: string;
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
  event: '#6b3fa0',
  work: '#4a5178',
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
  event: '#c9b3ff',
  work: '#b6bbe0',
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
  /** false drops every `places_*` layer (city, region, country names): a kvart-sized thumbnail has no room for "Zagreb" over its streets. Default true. */
  placeLabels?: boolean;
  /** 'sign' promotes the basemap for a screen read from three metres and cuts
   *  what cannot reach the readability floor; 'default' (the phone, the desk,
   *  the kvart thumbnail) is the house pass alone. */
  profile?: BasemapProfile;
}

// --- Reading a map from three metres ---------------------------------------
//
// Every size in the sign profile comes out of one stated viewing geometry,
// not out of taste, and the derivation lives here so there is one place to
// argue with. A 55-inch 16:9 panel at 1920 x 1080 is 1218 mm of glass across,
// so one CSS pixel is about 0.625 mm. Noto Sans' cap height is 0.71 em, so
// the capitals of a label of n CSS px stand 0.71 * 0.625 * n mm tall, and
// from three metres that subtends
//
//     (0.71 * 0.625 * n / 3000) rad  =  0.509 n arcminutes.
//
// Ten arcminutes is where a known word stops being reliably recognised at a
// glance, which puts the floor at 20 CSS px; past 14 arcminutes (28 px) one
// name costs more of the box than the streets under it.
//
// The rule that follows, and the one thing a size table alone cannot say: a
// label that cannot reach the floor is DROPPED, never shrunk. An unreadable
// label is noise wearing a halo, and worse than noise -- it takes a collision
// slot a readable name would have had.
export const SIGN_PANEL_PX_MM = 0.625;
export const SIGN_VIEWING_MM = 3000;
export const SIGN_CAP_HEIGHT_EM = 0.71;
export const SIGN_ARCMIN_PER_PX = ((SIGN_CAP_HEIGHT_EM * SIGN_PANEL_PX_MM) / SIGN_VIEWING_MM) * (180 / Math.PI) * 60;
export const SIGN_RECOGNITION_ARCMIN = 10;
/** 20 px, derived from the geometry above rather than typed in. */
export const SIGN_TEXT_MIN_PX = Math.ceil(SIGN_RECOGNITION_ARCMIN / SIGN_ARCMIN_PER_PX);
/** 28 px, 14.2 arcminutes: the ceiling. */
export const SIGN_TEXT_MAX_PX = 28;
/** What a label of this many CSS px subtends at SIGN_VIEWING_MM, in arcminutes. */
export function signArcminutes(textSizePx: number): number {
  return textSizePx * SIGN_ARCMIN_PER_PX;
}
/** MapLibre's SDF glyph atlas carries a fixed spread, so a halo wider than an
 *  eighth of the text size clips against the edge of the field. Every halo in
 *  this file is capped through here, never typed in. */
export const HALO_LIMIT_RATIO = 0.125;
export function haloCap(textSizePx: number): number {
  return HALO_LIMIT_RATIO * textSizePx;
}

/** `text-size` at one zoom, for the expression shapes a basemap style uses: a
 *  number, a zoom `interpolate` (linear or exponential), a zoom `step`, and
 *  `case` branches, which reduce to their smallest branch. NaN for anything
 *  else -- which is itself the assertion that a promoted size stays simple
 *  enough to be checked against the floor. */
export function textSizeAt(expr: unknown, zoom: number): number {
  if (typeof expr === 'number') return expr;
  if (!Array.isArray(expr) || expr.length === 0) return Number.NaN;
  const [op, ...rest] = expr as [string, ...unknown[]];
  if (op === 'interpolate') {
    const [interpolation, input, ...flat] = rest;
    if (!Array.isArray(input) || input[0] !== 'zoom' || !Array.isArray(interpolation)) return Number.NaN;
    const stops: [number, unknown][] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) stops.push([flat[i] as number, flat[i + 1]]);
    if (stops.length === 0) return Number.NaN;
    if (zoom <= stops[0]![0]) return textSizeAt(stops[0]![1], zoom);
    const last = stops[stops.length - 1]!;
    if (zoom >= last[0]) return textSizeAt(last[1], zoom);
    let i = 0;
    while (i + 1 < stops.length && stops[i + 1]![0] <= zoom) i += 1;
    const [z0, o0] = stops[i]!;
    const [z1, o1] = stops[i + 1]!;
    const a = textSizeAt(o0, zoom);
    const b = textSizeAt(o1, zoom);
    const base = interpolation[0] === 'exponential' ? (interpolation[1] as number) : 1;
    const t = base === 1 ? (zoom - z0) / (z1 - z0) : (base ** (zoom - z0) - 1) / (base ** (z1 - z0) - 1);
    return a + t * (b - a);
  }
  if (op === 'step') {
    const [input, fallback, ...flat] = rest;
    if (!Array.isArray(input) || input[0] !== 'zoom') return Number.NaN;
    let out = fallback;
    for (let i = 0; i + 1 < flat.length; i += 2) if (zoom >= (flat[i] as number)) out = flat[i + 1];
    return textSizeAt(out, zoom);
  }
  if (op === 'case') {
    // [cond, out, cond, out, ..., fallback]: the outputs are the odd slots plus the last.
    const outs = rest.filter((_, i) => i % 2 === 1);
    if (rest.length % 2 === 1) outs.push(rest[rest.length - 1]);
    let best = Number.POSITIVE_INFINITY;
    for (const out of outs) {
      const n = textSizeAt(out, zoom);
      if (Number.isNaN(n)) return Number.NaN;
      if (n < best) best = n;
    }
    return Number.isFinite(best) ? best : Number.NaN;
  }
  return Number.NaN;
}

/** The smallest size a `text-size` expression ever draws at, over every zoom
 *  the archive covers. Zero is skipped on purpose: upstream writes 0 for "no
 *  label at this zoom or population rank", which is the drop this profile
 *  asks for, not a size. NaN when the expression is not one this file reads. */
export function minTextSize(expr: unknown): number {
  let best = Number.POSITIVE_INFINITY;
  let seen = false;
  for (let zoom = MAP_MIN_ZOOM; zoom <= MAP_MAX_ZOOM; zoom += 0.5) {
    const n = textSizeAt(expr, zoom);
    if (Number.isNaN(n)) return Number.NaN;
    if (n <= 0) continue;
    seen = true;
    if (n < best) best = n;
  }
  return seen ? best : Number.NaN;
}

// --- The house pass: every surface, phone and desk included ----------------

/** The widest label halo the product wants; each layer takes the lesser of
 *  this and haloCap() of the smallest size it ever draws. */
const HOUSE_HALO_PX = 1.5;

function withHalo(layer: StyleLayerLike, want: number): StyleLayerLike {
  const width = layer.paint?.['text-halo-width'];
  if (typeof width !== 'number') return layer;
  const min = minTextSize(layer.layout?.['text-size']);
  if (!Number.isFinite(min)) return layer;
  const capped = Math.min(want, haloCap(min));
  if (capped === width) return layer;
  return { ...layer, paint: { ...layer.paint, 'text-halo-width': capped } };
}

/** What every surface gets over upstream's own output: the pois icons bound
 *  to the sprite this origin actually serves, buildings at full opacity (at
 *  0.5 over near-identical paper a building is a 1.05:1 whisper, and the
 *  letters above it have nothing to sit on), and every label halo taken to
 *  the widest the glyph renderer allows. */
function houseLayer(layer: StyleLayerLike): StyleLayerLike {
  if (layer.id === 'buildings') return { ...layer, paint: { ...(layer.paint ?? {}), 'fill-opacity': 1 } };
  return withHalo(layer.id === 'pois' ? boundPoiIcons(layer) : layer, HOUSE_HALO_PX);
}

// --- The sign profile ------------------------------------------------------

/** Layers the sign profile drops outright. A road shield and a one-way arrow
 *  are instructions to a driver; a house number needs z18, which this archive
 *  does not have; a region, a country and an island name answer a question
 *  nobody standing at a Zagreb tram stop is asking; no country border crosses
 *  this box. */
export const SIGN_DROPPED_LAYERS: readonly string[] = Object.freeze([
  'address_label', 'boundaries_country', 'earth_label_islands', 'places_country', 'places_region', 'roads_oneway', 'roads_shields',
]);
const SIGN_DROPPED = new Set<string>(SIGN_DROPPED_LAYERS);

/** Rank 1: what you would tell a stranger to walk to. These win collision. */
export const SIGN_POI_RANK1: readonly string[] = Object.freeze([
  'hospital', 'university', 'library', 'museum', 'theatre', 'station', 'marketplace', 'stadium', 'park', 'cemetery',
]);
/** Rank 2: civic too, and worth a name once the camera is one zoom closer. */
export const SIGN_POI_RANK2: readonly string[] = Object.freeze([
  'school', 'post_office', 'townhall', 'zoo', 'garden', 'attraction', 'artwork', 'aerodrome', 'ferry_terminal', 'peak',
]);
export const SIGN_POI_KINDS: readonly string[] = Object.freeze([...SIGN_POI_RANK1, ...SIGN_POI_RANK2]);
/** A filter's `["zoom"]` is evaluated at the tile's integer overscaledZ, so
 *  both thresholds are integers and rank 2 joins exactly one of them later. */
export const SIGN_POI_RANK1_ZOOM = 12;
export const SIGN_POI_RANK2_ZOOM = 13;
/** From here the city's own name stops being an orientation cue and becomes a
 *  word printed across its own streets. */
export const SIGN_LOCALITY_DROP_ZOOM = 12;
export const SIGN_HOME_LOCALITY = 'Zagreb';
/** The sign profile's halo, still capped per layer by haloCap(). */
const SIGN_HALO_PX = 2;

type SignExpr = unknown[];
const zoomSize = (...stops: number[]): SignExpr => ['interpolate', ['linear'], ['zoom'], ...stops];

interface SignSpec {
  size: SignExpr | number;
  font?: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  filter?: unknown;
  minzoom?: number;
}

/** One promoted label layer: the new size, the halo recomputed from it, and
 *  whatever else that layer needs. */
function promoted(layer: StyleLayerLike, spec: SignSpec): StyleLayerLike {
  const layout: Record<string, unknown> = { ...(layer.layout ?? {}), 'text-size': spec.size, ...(spec.layout ?? {}) };
  if (spec.font) layout['text-font'] = [spec.font];
  const min = minTextSize(spec.size);
  const paint: Record<string, unknown> = {
    ...(layer.paint ?? {}),
    ...(spec.paint ?? {}),
    'text-halo-width': Math.min(SIGN_HALO_PX, haloCap(Number.isFinite(min) ? min : SIGN_TEXT_MIN_PX)),
  };
  const out: StyleLayerLike = { ...layer, layout, paint };
  if (spec.filter !== undefined) out.filter = spec.filter;
  if (spec.minzoom !== undefined) out.minzoom = spec.minzoom;
  return out;
}

/**
 * One pure post-transform over the house pass, applied only for the screen.
 *
 * In order of how much it changes the picture: the 224 neighbourhood names
 * the tiles already carry (Jarun, Knezija, Spansko, Sveti Duh, Kustosija,
 * Vrbani, Stara Tresnjevka) come up from about 15 px to sign sizes, which is
 * the single biggest "this is Zagreb, not a transit diagram" change and costs
 * nothing on the wire; the major street names follow, spaced wide enough that
 * Ilica does not print five times across one box; the water labels follow,
 * because the Sava is the best orientation cue this city has; and the POI
 * layer is cut from the 36 kinds upstream admits with no sort key at all --
 * about 90 of which compete in one viewport, and which of them survives is
 * feature order, so the set flickers as the camera moves -- down to a ranked
 * civic list that resolves collision by meaning.
 */
function signLayer(layer: StyleLayerLike, flavor: Flavor): StyleLayerLike | null {
  if (SIGN_DROPPED.has(layer.id)) return null;
  const rank1: SignExpr = ['in', ['get', 'kind'], ['literal', SIGN_POI_RANK1]];
  const ready: SignExpr = ['>=', ['zoom'], ['+', ['get', 'min_zoom'], 0]];
  const isLocality: SignExpr = ['==', ['get', 'kind'], 'locality'];
  switch (layer.id) {
    case 'places_subplace':
      return promoted(layer, {
        size: zoomSize(11, 22, 14, 25, 18, SIGN_TEXT_MAX_PX),
        font: MAP_FONTS.medium,
        layout: { 'text-letter-spacing': 0.12, 'text-max-width': 8 },
      });
    case 'places_locality':
      return promoted(layer, {
        size: zoomSize(10, 22, 13, 25, 18, SIGN_TEXT_MAX_PX),
        font: MAP_FONTS.medium,
        // Upstream's own filter rewritten as an expression: a legacy filter
        // may not be nested inside one, and the step below has to nest it.
        filter: [
          'step',
          ['zoom'],
          isLocality,
          SIGN_LOCALITY_DROP_ZOOM,
          ['all', isLocality, ['!=', ['coalesce', ['get', 'name:hr'], ['get', 'name'], ''], SIGN_HOME_LOCALITY]],
        ],
      });
    case 'roads_labels_major':
      // 250 px of symbol-spacing prints one street name about five times
      // across a 1250 px box; 600 prints it twice, which is what a reader
      // following a street actually needs.
      return promoted(layer, { size: zoomSize(11, SIGN_TEXT_MIN_PX, 14, 21, 18, 22), font: MAP_FONTS.medium, layout: { 'symbol-spacing': 600 } });
    case 'roads_labels_minor':
      // At the floor, and upstream's own z15 keeps it to the stop camera alone.
      return promoted(layer, { size: SIGN_TEXT_MIN_PX });
    case 'water_waterway_label':
      return promoted(layer, { size: zoomSize(11, SIGN_TEXT_MIN_PX, 14, 22, 18, 24), layout: { 'symbol-spacing': 700 }, minzoom: 11 });
    case 'water_label_lakes':
    case 'water_label_ocean':
      return promoted(layer, { size: zoomSize(11, SIGN_TEXT_MIN_PX, 14, 22, 18, 24) });
    case 'pois':
      return promoted(layer, {
        size: zoomSize(SIGN_POI_RANK1_ZOOM, SIGN_TEXT_MIN_PX, 15, 21, 18, 24),
        layout: {
          'text-max-width': 9,
          'icon-size': 1.4,
          'text-font': ['case', rank1, ['literal', [MAP_FONTS.medium]], ['literal', [MAP_FONTS.regular]]],
          // A real sort key: meaning first, then the archive's own min_zoom
          // within a rank, so which names survive a crowded viewport stops
          // being an accident of feature order.
          'symbol-sort-key': ['+', ['case', rank1, 0, 100], ['+', ['get', 'min_zoom'], 0]],
        },
        paint: {
          'text-color': ['case', rank1, flavor.city_label, flavor.subplace_label],
          'text-halo-color': flavor.city_label_halo,
        },
        filter: [
          'step',
          ['zoom'],
          ['literal', false],
          SIGN_POI_RANK1_ZOOM,
          ['all', rank1, ready],
          SIGN_POI_RANK2_ZOOM,
          ['all', ['in', ['get', 'kind'], ['literal', SIGN_POI_KINDS]], ready],
        ],
      });
    default:
      return layer;
  }
}

/** The basemap layers alone for `theme`: what a live map diffs on a theme
 *  or locale change. */
export function basemapLayers(theme: MapTheme, options: BasemapStyleOptions = {}): StyleLayerLike[] {
  const flavor = flavorFor(theme);
  const upstream = protomapsLayers(BASEMAP_SOURCE, flavor, { lang: labelLanguage(options.locale) }) as unknown as StyleLayerLike[];
  const out: StyleLayerLike[] = [];
  for (const raw of upstream) {
    if (options.placeLabels === false && raw.id.startsWith('places_')) continue;
    const house = houseLayer(raw);
    const layer = options.profile === 'sign' ? signLayer(house, flavor) : house;
    if (layer) out.push(layer);
  }
  return out;
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
