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
// optional `profile: 'prozor'` pass on top of it, for the public screen that
// is read from three metres (kiosk/mapview.ts): a flavour override table
// applied before upstream generates its layers, and a layer pass over what it
// generated. The phone and the kvart thumbnail stay on 'default'.
//
// Pure: no DOM, no MapLibre import. The library that builds the layers is
// 38 kB and only ever loaded through maplibre-entry.ts's dynamic import, so
// the lightweight graph never carries it; a unit test imports this file
// directly in node.
import { layers as protomapsLayers, namedFlavor, type Flavor } from '@protomaps/basemaps';
import { MAP_CONFIG } from '../core/contracts';
import { PILL_INKS } from '../motion/pills';

export type MapTheme = 'light' | 'dark';

/** Which basemap the surface asks for: 'prozor' is the public screen's window
 *  onto the kvart, read from across a room (kiosk/mapview.ts, plan D3); the
 *  phone (transport/workspace.ts) and the kvart thumbnail (experience/kvart.ts)
 *  stay on 'default'. */
export type BasemapProfile = 'default' | 'prozor';

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
 *  four of them fail WCAG 4.5:1 outright (measured against #f1f4f7: pink
 *  2.80, blue 3.39, tangerine 3.42, green 4.25). `flavor.pois` is the one
 *  palette group the two override blocks below never reached, so the failure
 *  survived every other colour decision in this file.
 *
 *  It collapses onto the two inks the product already has, on every surface
 *  (phone, desk and screen alike -- this is a correctness fix, not a screen
 *  profile): full ink for what a person would walk to (nature, transport,
 *  civic, the sights) and muted ink for the commercial groups. The prozor
 *  profile drops the layer entirely. Measured: 15.40:1 and 6.85:1 by day,
 *  15.50:1 and 9.23:1 by night. The eight keys are upstream's whole group;
 *  `red` and `turquoise` reach no layer but are set so no future upstream
 *  layer can reintroduce an unmeasured hue. */
const POI_INK_LIGHT = Object.freeze({
  green: '#142334', lapis: '#142334', slategray: '#142334', pink: '#142334',
  blue: '#47586d', tangerine: '#47586d', red: '#47586d', turquoise: '#47586d',
});
const POI_INK_DARK = Object.freeze({
  green: '#f1f4f7', lapis: '#f1f4f7', slategray: '#f1f4f7', pink: '#f1f4f7',
  blue: '#b8c5d5', tangerine: '#b8c5d5', red: '#b8c5d5', turquoise: '#b8c5d5',
});

/** Mineral daylight: neutral buildings and roads, vegetation green and
 *  water blue. Brand saturation belongs to the transit overlay, not the
 *  ground. Labels use the product's ink and canvas halo. MapLibre consumes
 *  sRGB; tests bound these fills' OKLCH chroma and rendered label contrast.
 *  Bridges repeat their surface roads; tunnels recede to the canvas. */
const LIGHT_OVERRIDES: Partial<Flavor> = {
  background: '#f1f4f7',
  earth: '#f1f4f7',
  park_a: '#d7e6dc',
  park_b: '#d1e1d5',
  wood_a: '#c5dace',
  wood_b: '#bfd5c9',
  scrub_a: '#dce8df',
  scrub_b: '#d1e2d7',
  glacier: '#f1f4f7',
  sand: '#ebe6d6',
  beach: '#ece7d7',
  aerodrome: '#e6ecf3',
  runway: '#d7e0eb',
  zoo: '#d7e6dc',
  military: '#e6ecf3',
  hospital: '#f0e6e2',
  industrial: '#e6ecf3',
  school: '#e6ecf3',
  pedestrian: '#e6ecf3',
  pier: '#e6ecf3',
  water: '#bad6ea',
  buildings: '#dde5ee',
  minor_service_casing: '#e0e6ee',
  minor_casing: '#d7e0eb',
  link_casing: '#cdd8e4',
  major_casing_late: '#c1cedd',
  highway_casing_late: '#b8c8dc',
  other: '#f1f4f7',
  minor_service: '#f1f4f7',
  minor_a: '#fbfcfe',
  minor_b: '#fbfcfe',
  link: '#fbfcfe',
  major_casing_early: '#c1cedd',
  major: '#fbfcfe',
  highway_casing_early: '#b8c8dc',
  highway: '#e8eef5',
  railway: '#9caabc',
  boundaries: '#a4b3c5',
  tunnel_other_casing: '#e3e9f0',
  tunnel_minor_casing: '#e3e9f0',
  tunnel_link_casing: '#e3e9f0',
  tunnel_major_casing: '#e3e9f0',
  tunnel_highway_casing: '#e3e9f0',
  tunnel_other: '#f1f4f7',
  tunnel_minor: '#f1f4f7',
  tunnel_link: '#f1f4f7',
  tunnel_major: '#f1f4f7',
  tunnel_highway: '#f1f4f7',
  bridges_other_casing: '#d7e0eb',
  bridges_minor_casing: '#d7e0eb',
  bridges_link_casing: '#cdd8e4',
  bridges_major_casing: '#c1cedd',
  bridges_highway_casing: '#b8c8dc',
  bridges_other: '#f1f4f7',
  bridges_minor: '#fbfcfe',
  bridges_link: '#fbfcfe',
  bridges_major: '#fbfcfe',
  bridges_highway: '#e8eef5',
  roads_label_minor: '#47586d',
  roads_label_minor_halo: '#f1f4f7',
  roads_label_major: '#47586d',
  roads_label_major_halo: '#f1f4f7',
  ocean_label: '#47586d',
  subplace_label: '#47586d',
  subplace_label_halo: '#f1f4f7',
  city_label: '#142334',
  city_label_halo: '#f1f4f7',
  state_label: '#47586d',
  state_label_halo: '#f1f4f7',
  country_label: '#47586d',
  address_label: '#142334',
  address_label_halo: '#f1f4f7',
  pois: POI_INK_LIGHT,
};

/** Charcoal night is separately tuned, not ultramarine or an inversion of
 *  daylight. The same three geographic roles remain legible with restrained
 *  chroma; bright Zagreb blue is reserved for actual tram routes and vehicles. */
const DARK_OVERRIDES: Partial<Flavor> = {
  background: '#111922',
  earth: '#111922',
  park_a: '#1d3534',
  park_b: '#1b3030',
  wood_a: '#214038',
  wood_b: '#1e3933',
  scrub_a: '#20332f',
  scrub_b: '#1b302c',
  glacier: '#111922',
  sand: '#192430',
  beach: '#192430',
  aerodrome: '#192430',
  runway: '#2a3b4b',
  zoo: '#1d3534',
  military: '#192430',
  hospital: '#192430',
  industrial: '#192430',
  school: '#192430',
  pedestrian: '#192430',
  pier: '#192430',
  water: '#0b2538',
  buildings: '#23313f',
  minor_service_casing: '#344457',
  minor_casing: '#344457',
  link_casing: '#344457',
  major_casing_late: '#344457',
  highway_casing_late: '#344457',
  other: '#111922',
  minor_service: '#23313f',
  minor_a: '#23313f',
  minor_b: '#23313f',
  link: '#23313f',
  major_casing_early: '#344457',
  major: '#23313f',
  highway_casing_early: '#344457',
  highway: '#3a4f62',
  railway: '#47586d',
  boundaries: '#55677c',
  tunnel_other_casing: '#172431',
  tunnel_minor_casing: '#172431',
  tunnel_link_casing: '#172431',
  tunnel_major_casing: '#172431',
  tunnel_highway_casing: '#172431',
  tunnel_other: '#111922',
  tunnel_minor: '#111922',
  tunnel_link: '#111922',
  tunnel_major: '#111922',
  tunnel_highway: '#111922',
  bridges_other_casing: '#344457',
  bridges_minor_casing: '#344457',
  bridges_link_casing: '#344457',
  bridges_major_casing: '#344457',
  bridges_highway_casing: '#344457',
  bridges_other: '#111922',
  bridges_minor: '#23313f',
  bridges_link: '#23313f',
  bridges_major: '#23313f',
  bridges_highway: '#3a4f62',
  roads_label_minor: '#b8c5d5',
  roads_label_minor_halo: '#111922',
  roads_label_major: '#b8c5d5',
  roads_label_major_halo: '#111922',
  ocean_label: '#b8c5d5',
  subplace_label: '#b8c5d5',
  subplace_label_halo: '#111922',
  city_label: '#f1f4f7',
  city_label_halo: '#111922',
  state_label: '#b8c5d5',
  state_label_halo: '#111922',
  country_label: '#b8c5d5',
  address_label: '#f1f4f7',
  address_label_halo: '#111922',
  pois: POI_INK_DARK,
};

// --- The prozor ground (plan D3, D12; R-KP3) --------------------------------
//
// Under the figure the public screen draws over it (the tram rails, the
// vehicles, the screen's stop: map/overlays.ts), the basemap is the ground and
// nothing on it competes. Upstream paints landuse as eleven layers from twenty
// flavour keys; here the whole of it collapses onto two tones -- one green for
// everything planted, the canvas for everything else -- with the buildings
// one step off the canvas as faint blocks. Applied over the house palette
// BEFORE upstream generates its layers, so every fill takes the tone from
// the same table, and the layer pass below only has to touch geometry, the
// streets and the labels.
//
// Every literal is a hand-copy of ui/tokens.css (MapLibre paints literals;
// the token is named beside each), except the two greens, which the token
// sheet does not carry: each is its canvas pulled a step toward the success
// role's hue and kept inside the canvas family (measured 1.08:1 by day and
// 1.16:1 by night against the ground -- texture, not a surface).
const PROZOR_LIGHT_GROUND = '#f1f4f7'; // --palette-light-canvas
const PROZOR_LIGHT_GREEN = '#dde9e2'; // the canvas toward --palette-light-success
const PROZOR_DARK_GROUND = '#111922'; // --palette-dark-canvas
const PROZOR_DARK_GREEN = '#1d3534'; // the canvas toward --palette-dark-success

const PROZOR_LIGHT: Partial<Flavor> = {
  background: PROZOR_LIGHT_GROUND,
  earth: PROZOR_LIGHT_GROUND,
  // Blocks: --palette-light-surface-2, the sheet's own raised surface.
  buildings: '#e5eaf0',
  // Planted: one green.
  park_a: PROZOR_LIGHT_GREEN,
  park_b: PROZOR_LIGHT_GREEN,
  wood_a: PROZOR_LIGHT_GREEN,
  wood_b: PROZOR_LIGHT_GREEN,
  scrub_a: PROZOR_LIGHT_GREEN,
  scrub_b: PROZOR_LIGHT_GREEN,
  zoo: PROZOR_LIGHT_GREEN,
  beach: PROZOR_LIGHT_GREEN,
  sand: PROZOR_LIGHT_GREEN,
  glacier: PROZOR_LIGHT_GREEN,
  // Every other landuse is the ground: a hospital, a school, a factory yard
  // are not figures on a screen about the tram.
  hospital: PROZOR_LIGHT_GROUND,
  school: PROZOR_LIGHT_GROUND,
  industrial: PROZOR_LIGHT_GROUND,
  pedestrian: PROZOR_LIGHT_GROUND,
  pier: PROZOR_LIGHT_GROUND,
  aerodrome: PROZOR_LIGHT_GROUND,
  runway: PROZOR_LIGHT_GROUND,
  military: PROZOR_LIGHT_GROUND,
  // Water as on every surface: ultramarine at 12 % over the canvas.
  water: '#bad6ea',
  // Neighbourhood names in the label role, street names in the muted tier, both haloed by the ground.
  subplace_label: '#40536b', // --palette-light-label
  subplace_label_halo: PROZOR_LIGHT_GROUND,
  roads_label_major: '#47586d', // --palette-light-text-muted
  roads_label_major_halo: PROZOR_LIGHT_GROUND,
};

const PROZOR_DARK: Partial<Flavor> = {
  background: PROZOR_DARK_GROUND,
  earth: PROZOR_DARK_GROUND,
  // Blocks: --palette-dark-surface-1.
  buildings: '#192430',
  park_a: PROZOR_DARK_GREEN,
  park_b: PROZOR_DARK_GREEN,
  wood_a: PROZOR_DARK_GREEN,
  wood_b: PROZOR_DARK_GREEN,
  scrub_a: PROZOR_DARK_GREEN,
  scrub_b: PROZOR_DARK_GREEN,
  zoo: PROZOR_DARK_GREEN,
  beach: PROZOR_DARK_GREEN,
  sand: PROZOR_DARK_GREEN,
  glacier: PROZOR_DARK_GREEN,
  hospital: PROZOR_DARK_GROUND,
  school: PROZOR_DARK_GROUND,
  industrial: PROZOR_DARK_GROUND,
  pedestrian: PROZOR_DARK_GROUND,
  pier: PROZOR_DARK_GROUND,
  aerodrome: PROZOR_DARK_GROUND,
  runway: PROZOR_DARK_GROUND,
  military: PROZOR_DARK_GROUND,
  // A restrained river blue, shared with the interactive map.
  water: '#0b2538',
  subplace_label: '#b8c5d5', // --palette-dark-label
  subplace_label_halo: PROZOR_DARK_GROUND,
  roads_label_major: '#9badc2', // --palette-dark-text-subtle
  roads_label_major_halo: PROZOR_DARK_GROUND,
};

/** The upstream flavour for `theme` with the product palette over it, the
 *  prozor ground over that when asked, and the three self-hosted fontstacks
 *  named, so no layer ever asks the glyph endpoint for a face it does not
 *  carry. */
export function flavorFor(theme: MapTheme, profile: BasemapProfile = 'default'): Flavor {
  const base = namedFlavor(theme);
  const house = theme === 'dark' ? DARK_OVERRIDES : LIGHT_OVERRIDES;
  const prozor = profile === 'prozor' ? (theme === 'dark' ? PROZOR_DARK : PROZOR_LIGHT) : {};
  return { ...base, ...house, ...prozor, regular: MAP_FONTS.regular, bold: MAP_FONTS.medium, italic: MAP_FONTS.italic };
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
  /** The tram network's own line, well under the marks it carries (owner
   *  ruling, round F "kiosk window"): one neutral grey, day or night, on
   *  every surface (overlays.ts's tramNetwork). `routeTram` stays the tram
   *  plate's blue; `rail` is only the thin line under it. */
  rail: string;
  /** BAJS bike-share: one teal for the station dot and the cycle path, the
   *  same in both faces (city-layers.ts's cityLayers()). */
  bike: string;
  /** The count badge's ink over a bike dot (city-layers.ts's badges layer);
   *  dark enough to read against `bike` in both faces. */
  bikeText: string;
  /** The public screen's own figure (plan D4): the ink itself by day, the
   *  muted paper tier by night, at `figureOpacity`; drawn only under a
   *  ProzorOptions set, now just the screen's own stop dots (the tram
   *  network's colour moved to `rail` above). */
  figure: string;
  figureOpacity: number;
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
 * its route line are the accent role (--tone-accent, #0751bf light, #84b5ff
 * dark); a bus and its route line the transit role (--tone-transit, #34465c
 * light, #b8c9dc dark); a closure the urgency role (#b72d39, #ff9aa5). The
 * tram network's own line is the new rail role, one neutral grey in both
 * faces (#8d99a8 light, #5b6a7c dark), well under the plate it carries; BAJS
 * bike-share is the new bike role, one teal in both faces (#178f7f), its
 * count badge read in bikeText (#08131f). The stop fill and every halo take
 * the canvas or its brighter paper-white sibling; the selection and the
 * screen stop pin take the ink and accent roles. One Zagreb blue and one ink
 * across the map, the badges (ui/signage.css) and the mode chips
 * (ui/map.css). MapLibre paints from literals, so these are the token hexes
 * written out; tokens.css stays their single source (R-D2). */
export const OVERLAY_LIGHT: Readonly<OverlayPalette> = Object.freeze({
  ...PILL_INKS.light, // tram/tramText/bus/busText/other/otherText/halo: motion/pills.ts (F1)
  routeTram: '#0751bf',
  routeBus: '#34465c',
  rail: '#8d99a8',
  bike: '#178f7f',
  bikeText: '#08131f',
  figure: '#142334', // --palette-light-text-primary, the ink
  figureOpacity: 0.9,
  stopFill: '#f1f4f7',
  stopStroke: '#47586d',
  label: '#142334',
  closure: '#b72d39',
  closureCasing: '#fbfcfe',
  place: '#b8731a',
  event: '#7040a2',
  work: '#47586d',
  selection: '#142334',
  selectionHalo: '#fbfcfe',
  screenStop: '#0751bf',
});

export const OVERLAY_DARK: Readonly<OverlayPalette> = Object.freeze({
  ...PILL_INKS.dark, // tram/tramText/bus/busText/other/otherText/halo: motion/pills.ts (F1)
  routeTram: '#84b5ff',
  routeBus: '#b8c9dc',
  rail: '#5b6a7c',
  bike: '#178f7f',
  bikeText: '#08131f',
  figure: '#b8c5d5', // --palette-dark-text-muted: the screen's own stop dots, a step under the paper the plates are cut from
  figureOpacity: 0.7,
  stopFill: '#111922',
  stopStroke: '#b8c5d5',
  label: '#f1f4f7',
  closure: '#ff9aa5',
  closureCasing: '#111922',
  place: '#f0c060',
  event: '#c9aff0',
  work: '#b8c5d5',
  selection: '#f1f4f7',
  selectionHalo: '#111922',
  screenStop: '#84b5ff',
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
  /** 'prozor' draws the public screen's ground: two landuse tones, hairline
   *  streets, faint blocks, the neighbourhood names promoted, and nothing that
   *  cannot reach the readability floor; 'default' (the phone, the desk, the
   *  kvart thumbnail) is the house pass alone. */
  profile?: BasemapProfile;
  /** The prozor profile's collision padding around a major street name, in
   *  tile pixels: PROZOR_LABEL_PADDING_PX unless the kiosk's option set widens
   *  it for a field that shows more ground than the wall's
   *  (overlays.ts ProzorOptions.labelPadding). */
  labelPadding?: number;
}

// --- Reading a map from three metres ---------------------------------------
//
// Every size in the prozor profile comes out of one stated viewing geometry,
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
export const PROZOR_PANEL_PX_MM = 0.625;
export const PROZOR_VIEWING_MM = 3000;
export const PROZOR_CAP_HEIGHT_EM = 0.71;
export const PROZOR_ARCMIN_PER_PX = ((PROZOR_CAP_HEIGHT_EM * PROZOR_PANEL_PX_MM) / PROZOR_VIEWING_MM) * (180 / Math.PI) * 60;
export const PROZOR_RECOGNITION_ARCMIN = 10;
/** 20 px, derived from the geometry above rather than typed in. */
export const PROZOR_TEXT_MIN_PX = Math.ceil(PROZOR_RECOGNITION_ARCMIN / PROZOR_ARCMIN_PER_PX);
/** 28 px, 14.2 arcminutes: the ceiling. */
export const PROZOR_TEXT_MAX_PX = 28;
/** What a label of this many CSS px subtends at PROZOR_VIEWING_MM, in arcminutes. */
export function prozorArcminutes(textSizePx: number): number {
  return textSizePx * PROZOR_ARCMIN_PER_PX;
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

// --- The prozor profile ----------------------------------------------------

/** Layers the prozor profile drops outright, over and above every tunnel
 *  layer and every `*_casing` layer (streets are hairlines with no casing,
 *  R-KP3). A POI, a shield, a one-way arrow, a minor street name and a house
 *  number are what a person zooms in for on a phone; a region, a country, an
 *  island and the city's own name over its own streets orient nobody who is
 *  already standing in Zagreb; no country border crosses this box; a service
 *  road and a footpath are ground texture the figure does not need. */
export const PROZOR_DROPPED_LAYERS: readonly string[] = Object.freeze([
  'pois', 'roads_labels_minor', 'roads_shields', 'roads_oneway', 'address_label', 'boundaries', 'boundaries_country',
  'places_locality', 'places_region', 'places_country', 'earth_label_islands', 'water_waterway_label', 'roads_other', 'roads_minor_service',
]);
const PROZOR_DROPPED = new Set<string>(PROZOR_DROPPED_LAYERS);
function prozorDrops(id: string): boolean {
  return PROZOR_DROPPED.has(id) || id.startsWith('roads_tunnels_') || id.endsWith('_casing');
}

/** Of the major roads, the ones whose names a field of 2.8 km can afford:
 *  the trunk of the hierarchy by OSM class. Tertiary and below stay drawn and
 *  unnamed; the count of names placed is proven in e2e, never assumed. */
export const PROZOR_MAJOR_ROAD_DETAILS: readonly string[] = Object.freeze(['motorway', 'trunk', 'primary', 'secondary']);

/** Collision padding around a major street name, in tile pixels at the
 *  archive's z14 (R-KP17): measured on the 1920 x 1080 wall's field, where
 *  the profile places two to three names around Jelačić beside the plates
 *  and the hub names. The kiosk widens it for a field that shows more ground
 *  than that wall's (BasemapStyleOptions.labelPadding, from kiosk/mapview.ts
 *  labelPadding, which keeps its own copy of this literal because it stays
 *  off this module's graph). */
export const PROZOR_LABEL_PADDING_PX = 24;

/** Streets are ground texture, never the figure (plan D12, R-KP3), and the
 *  two faces get there by opposite moves. By day the paper roads of the house
 *  palette left 1.09:1 against the canvas, invisible at three metres, so the
 *  streets are the ink itself let through thinly: --palette-light-text-primary
 *  at the --palette-light-border tint for the minor ones (0.14 in the token
 *  sheet, taken to 0.18 so a one-pixel hairline survives the panel), at
 *  --palette-light-border-strong (0.34) for the majors. By night the minor
 *  streets are --palette-dark-surface-2, a whisper over the canvas, and the
 *  majors are the paper (--palette-dark-text-primary) at a quarter -- about
 *  #454b86 composited, 2.5:1 -- so Ilica and Savska orient the eye without
 *  competing with the rails drawn over them. */
const PROZOR_STREETS: Readonly<Record<MapTheme, { minor: string; minorOpacity: number; major: string; majorOpacity: number }>> = Object.freeze({
  light: { minor: '#142334', minorOpacity: 0.18, major: '#142334', majorOpacity: 0.34 },
  dark: { minor: '#23313f', minorOpacity: 1, major: '#f1f4f7', majorOpacity: 0.25 },
});
/** Which street layers take which of the two weights; a bridge draws exactly
 *  as its surface road (the same table row), and the footbridge -- the one
 *  `other` kind kept, because a bridge over the Sava is an orientation cue --
 *  as a minor. */
const PROZOR_MINOR_ROADS = new Set(['roads_minor', 'roads_link', 'roads_bridges_minor', 'roads_bridges_link', 'roads_bridges_other']);
const PROZOR_MAJOR_ROADS = new Set(['roads_major', 'roads_bridges_major']);
const PROZOR_HIGHWAYS = new Set(['roads_highway', 'roads_bridges_highway']);

type ZoomExpr = unknown[];
const zoomSize = (...stops: number[]): ZoomExpr => ['interpolate', ['linear'], ['zoom'], ...stops];

/** Line widths in CSS px across the field's own zoom range (13.5…15.5, the
 *  clamp of kiosk/mapview.ts's fieldZoom): a hairline, a line, a heavier
 *  line. Under 1 px MapLibre still draws a crisp translucent hairline; above
 *  it the majors stay thinner than the 3 to 5 px rails of the figure. */
const PROZOR_MINOR_WIDTH = zoomSize(13.5, 0.8, 15.5, 1.2);
const PROZOR_MAJOR_WIDTH = zoomSize(13.5, 1.6, 15.5, 2.4);
const PROZOR_HIGHWAY_WIDTH = zoomSize(13.5, 2, 15.5, 3);

/** The prozor profile's halo, still capped per layer by haloCap(). */
const PROZOR_HALO_PX = 2;

interface PromotedSpec {
  size: ZoomExpr | number;
  font?: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  filter?: unknown;
  minzoom?: number;
}

/** One promoted label layer: the new size, the halo recomputed from it, and
 *  whatever else that layer needs. */
function promoted(layer: StyleLayerLike, spec: PromotedSpec): StyleLayerLike {
  const layout: Record<string, unknown> = { ...(layer.layout ?? {}), 'text-size': spec.size, ...(spec.layout ?? {}) };
  if (spec.font) layout['text-font'] = [spec.font];
  const min = minTextSize(spec.size);
  const paint: Record<string, unknown> = {
    ...(layer.paint ?? {}),
    ...(spec.paint ?? {}),
    'text-halo-width': Math.min(PROZOR_HALO_PX, haloCap(Number.isFinite(min) ? min : PROZOR_TEXT_MIN_PX)),
  };
  const out: StyleLayerLike = { ...layer, layout, paint };
  if (spec.filter !== undefined) out.filter = spec.filter;
  if (spec.minzoom !== undefined) out.minzoom = spec.minzoom;
  return out;
}

/** One street layer: a flat colour (upstream interpolates two tints for the
 *  minor roads; here there is one), its face's opacity and its weight. */
function street(layer: StyleLayerLike, color: string, opacity: number, width: ZoomExpr): StyleLayerLike {
  return { ...layer, paint: { ...(layer.paint ?? {}), 'line-color': color, 'line-opacity': opacity, 'line-width': width } };
}

/**
 * The layer pass over the house pass, applied only for the public screen,
 * after flavorFor('prozor') has already collapsed the fills.
 *
 * What it does, in order of how much it changes the picture: it drops the
 * layers listed above, so no POI name, no shop and no minor street name
 * competes with the figure; it draws every street as a hairline of one
 * colour with no casing; it brings the 224 neighbourhood names the tiles carry
 * (Jarun, Knezija, Spansko, Sveti Duh, Kustosija, Vrbani, Stara Tresnjevka)
 * up to the largest words on the ground; it keeps only the trunk of the
 * street hierarchy named, spaced so a field holds a handful of names and not
 * Ilica five times; and it keeps the water labels at the promoted sizes,
 * because the Sava is the best orientation cue this city has.
 */
function prozorLayer(layer: StyleLayerLike, flavor: Flavor, theme: MapTheme, labelPadding: number): StyleLayerLike | null {
  if (prozorDrops(layer.id)) return null;
  const streets = PROZOR_STREETS[theme];
  if (PROZOR_MINOR_ROADS.has(layer.id)) return street(layer, streets.minor, streets.minorOpacity, PROZOR_MINOR_WIDTH);
  if (PROZOR_MAJOR_ROADS.has(layer.id)) return street(layer, streets.major, streets.majorOpacity, PROZOR_MAJOR_WIDTH);
  if (PROZOR_HIGHWAYS.has(layer.id)) return street(layer, streets.major, streets.majorOpacity, PROZOR_HIGHWAY_WIDTH);
  switch (layer.id) {
    case 'landuse_park':
      // Upstream paints a barracks, a naval base and an airfield from the zoo
      // key, which this profile turns green; they are ground here, and the
      // flavour's own `military` key, which no upstream layer reads, says so.
      return {
        ...layer,
        paint: {
          ...(layer.paint ?? {}),
          'fill-color': ['case', ['in', ['get', 'kind'], ['literal', ['military', 'naval_base', 'airfield']]], flavor.military, layer.paint?.['fill-color']],
        },
      };
    case 'landuse_urban_green':
      // Allotments and playgrounds at upstream's 0.7 would be a third tone between the green and the ground.
      return { ...layer, paint: { ...(layer.paint ?? {}), 'fill-opacity': 1 } };
    case 'places_subplace':
      // 26 to 28 px across the field's zoom range: 13.2 to 14.2 arcminutes,
      // under the ceiling, and the biggest words on the ground. The colour is
      // the flavour's own (the label role), haloed by the ground; padding 12
      // keeps two names a word apart, max-width 8 keeps "Stara Tresnjevka"
      // on one line.
      return promoted(layer, {
        size: zoomSize(13.5, 26, 15.5, 28),
        font: MAP_FONTS.medium,
        layout: { 'text-letter-spacing': 0.12, 'text-max-width': 8, 'text-padding': 12, 'text-transform': 'uppercase' },
      });
    case 'roads_labels_major':
      // Upstream's legacy kind filter rewritten as an expression (a legacy
      // filter may not nest), narrowed to the four classes above. MapLibre
      // reads symbol-spacing and text-padding in TILE pixels at the tile's
      // own zoom, and the archive stops at z14 (about 4.7 m per tile pixel
      // here), so these are ground distances, not screen ones: 360 keeps
      // consecutive anchors on one street about 1.7 km apart (a name at most
      // twice across the 2.8 km field), 24 is about 40 screen px of padding
      // at the field's z14.7 (R-KP17; the first drawing's 900 / 40 read as
      // screen px and placed one name in the whole field). How many names a
      // field holds is the padding's to set, not the spacing's: MapLibre
      // anchors every road once per tile whatever the spacing (360, 473, 745
      // and 1100 all placed 7 to 8 on the totem, 16 Sept 2026), so a field
      // that shows more ground than the wall's gets a wider padding from the
      // kiosk (PROZOR_LABEL_PADDING_PX, kiosk/mapview.ts labelPadding). 22 px
      // flat: 11.2 arcminutes, over the floor and under the neighbourhood
      // names, so the two tiers never read as one.
      return promoted(layer, {
        size: 22,
        font: MAP_FONTS.medium,
        layout: { 'symbol-spacing': 360, 'text-padding': labelPadding },
        filter: ['all', ['in', ['get', 'kind'], ['literal', ['highway', 'major_road']]], ['in', ['get', 'kind_detail'], ['literal', PROZOR_MAJOR_ROAD_DETAILS]]],
      });
    case 'water_label_lakes':
    case 'water_label_ocean':
      return promoted(layer, { size: zoomSize(11, PROZOR_TEXT_MIN_PX, 14, 22, 18, 24) });
    default:
      return layer;
  }
}

/** The basemap layers alone for `theme`: what a live map diffs on a theme
 *  or locale change. */
export function basemapLayers(theme: MapTheme, options: BasemapStyleOptions = {}): StyleLayerLike[] {
  const flavor = flavorFor(theme, options.profile);
  const upstream = protomapsLayers(BASEMAP_SOURCE, flavor, { lang: labelLanguage(options.locale) }) as unknown as StyleLayerLike[];
  const out: StyleLayerLike[] = [];
  for (const raw of upstream) {
    if (options.placeLabels === false && raw.id.startsWith('places_')) continue;
    const house = houseLayer(raw);
    const layer = options.profile === 'prozor' ? prozorLayer(house, flavor, theme, options.labelPadding ?? PROZOR_LABEL_PADDING_PX) : house;
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

/** One property change a live map applies to move from one face to another;
 *  a 'zoom' op carries the layer's [minzoom, maxzoom]. */
export interface StyleOp {
  id: string;
  kind: 'paint' | 'layout' | 'filter' | 'zoom';
  key: string;
  value: unknown;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** What an absent minzoom / maxzoom means, in the style spec's own numbers:
 *  the range a `zoom` op hands setLayerZoomRange when a layer has no limit. */
const ZOOM_RANGE_MIN = 0;
const ZOOM_RANGE_MAX = 24;
function zoomRange(layer: StyleLayerLike): [number, number] {
  return [layer.minzoom ?? ZOOM_RANGE_MIN, layer.maxzoom ?? ZOOM_RANGE_MAX];
}

/**
 * Every paint, layout, filter and zoom-range difference between two layer
 * lists that share their ids, as the operations a live map applies through
 * setPaintProperty / setLayoutProperty / setFilter / setLayerZoomRange.
 * Layers only one side has are ignored: the two faces of this basemap share
 * one layer list by construction, and the overlays are not part of either.
 * A theme flip never moves a zoom range; the public screen's option set does
 * (the noses and the stop names follow the field's own zoom, overlays.ts).
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
    if (!same(zoomRange(previous), zoomRange(layer))) ops.push({ id: layer.id, kind: 'zoom', key: 'range', value: zoomRange(layer) });
  }
  return ops;
}
