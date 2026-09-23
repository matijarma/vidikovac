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
import { bodiesToGeoJson } from '../motion/bodies';
import { clusterPills, createLineColours, pillChars, pillLabel, pillWidthPx, PILL_HEIGHT_PX, type Cluster, type PillPoint } from '../motion/pills';
import { MAP_PRESENTATIONS, type MapPresentation } from './presentation';
import LINE_COLOURS from '../data/zet-line-colours.json';
import type { GraphNetwork, Network } from '../../../shared/motion/network';
import { ROUTE_TYPE_BUS, ROUTE_TYPE_TRAM } from '../motion/schematic';
import { markAlpha, vehicleKind, type VehicleKind } from './vehicle-mark';
import { tr } from '../transport/strings';
import type { CityLabels } from './city-layers';
import type { BasemapProfile, BasemapStyleOptions, MapTheme, OverlayPalette, StyleLayerLike, StyleOp } from './basemap';
import type { OverlayOptions, ProzorOptions } from './overlays';
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

/** Every ring of every polygon as one multi-line feature; an outline with no
 *  ring produces an empty collection rather than a feature with no geometry. */
export function outlineToGeoJson(outline: MapOutline | null): LineStringFeatureCollection {
  const rings: [number, number][][] = [];
  for (const polygon of outline?.polygons ?? []) {
    for (const ring of polygon) if (ring.length >= 4) rings.push(ring);
  }
  if (!outline || rings.length === 0) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: rings }, properties: { id: outline.id } }] };
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

/** Keys a place's own props may never overwrite. */
const RESERVED_POINT_PROPS: ReadonlySet<string> = new Set(['id', 'title', 'routeId', 'place']);

/** Places only: a vehicle report never reaches a drawn source (R-P2). An
 *  untagged point produces exactly the properties it always did, so the
 *  dashboard's quake map is byte for byte unchanged. */
export function pointsToGeoJson(points: readonly MapPoint[]): PointFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points
      .filter((p) => !isVehicleReport(p) && Number.isFinite(p.lon) && Number.isFinite(p.lat))
      .map((p) => {
        const properties: PointProperties = p.routeId === undefined ? { id: p.id, title: p.title } : { id: p.id, title: p.title, routeId: p.routeId };
        if (p.place !== undefined) properties.place = p.place;
        for (const [key, value] of Object.entries(p.props ?? {})) {
          if (RESERVED_POINT_PROPS.has(key) || value === undefined) continue;
          properties[key] = value;
        }
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] as [number, number] },
          properties,
        };
      }),
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

/** The shortest way round the compass between two bearings, 0 to 180 degrees. */
function bearingGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** The number on the front of the vehicle: the network's own short name,
 *  else the static GTFS table's, else the route id itself; '' for a vehicle
 *  whose route nobody knows. Held to the widest capsule (pills.ts's
 *  pillLabel), so a standalone or selected pill obeys the same cap as a
 *  cluster's name. */
export function vehicleLabel(v: { short?: string; routeId?: string }): string {
  if (v.short) return pillLabel(v.short);
  if (v.routeId === undefined) return '';
  return pillLabel(ZET_ROUTES[v.routeId]?.shortName || v.routeId);
}

/** Draw order among the vehicle marks (overlays.ts reads `sort` straight as
 *  the symbol sort key, and with overlap allowed the higher one covers the
 *  lower). A cluster last, because it stands for the marks beneath it. */
const SORT_BUS = 1;
const SORT_TRAM = 2;
const SORT_CLUSTER = 3;

/** How far apart two merged members' bearings must be, the shortest way
 *  round the compass, before their mark says "both ways": two trams of one
 *  line passing each other at a stop are 180° apart, two following each
 *  other round the sharpest bend in the network are well under this. */
const TWO_WAY_MIN_DEG = 120;

/** The colour ZET prints a line in, from the table the schema build writes
 *  beside the artefact (scripts/zet-schema.mjs, F5). A route the table does
 *  not carry -- every bus, and a tram line added between two builds -- keeps
 *  its mode's pinned ink. */
const lineColour = createLineColours(LINE_COLOURS.colours);

/** How `vehiclesToGeoJson` is asked to merge overlapping pills. */
export interface VehicleGeoJsonOptions {
  /** [lon, lat] to CSS px on the live camera (MapLibre's own `map.project`).
   *  Absent, nothing is merged and every vehicle is its own mark, exactly as
   *  before -- clustering is a screen-space question and there is no screen
   *  without a camera. A point the camera cannot place (null) keeps its own
   *  mark too, rather than joining a group it was never measured against. */
  project?: (lonLat: [number, number]) => { x: number; y: number } | null;
  /** The selected or followed vehicle: never absorbed into a cluster, so a
   *  tap never loses the mark it was aimed at (motion/pills.ts). */
  selectedId?: string | null;
  /** The map's symbol scale (CityMapOptions.symbolScale; 2 on the public
   *  screen). motion/pills.ts writes its boxes in the CSS px the pill geometry
   *  itself is stated in, while the layer paints them at `icon-size: scale`:
   *  the projected positions are divided by it so two marks are compared at
   *  the size they are actually drawn. Without this the public screen would
   *  merge only inside half the distance at which its pills really overlap --
   *  and with the collision pass no longer thinning anything, a busy hub would
   *  pile up worse than before. */
  symbolScale?: number;
  /** The line the map is about (F5). A cluster of several routes has no one
   *  route id and carries '' -- which, under a selection, is every route but
   *  the lit one, so a merged mark standing partly *on* the lit line took the
   *  stepped-back ink of the lines it is not. Named here, a cluster with any
   *  member on that line answers with it, and the mark reads as what it
   *  partly is. Absent, the '' of a mixed cluster stands as before. */
  focusedRoute?: string;
}

/** A vehicle's mark as `clusterPills` measures it: its pill's centre on screen
 *  and the label written in it, with the feature it came from riding along. */
interface VehiclePillPoint extends PillPoint {
  feature: VehicleFeature;
}

/** One merged mark for a group of overlapping pills: the members' joined label
 *  ("6·11"), their ids, their centroid, and the properties a layer still has
 *  to be able to read -- the mode they all share (the group is built inside
 *  one mode, see below), the one route id they share or none at all, the
 *  members' best alpha, and no single heading, because a merged mark has no
 *  one facing and draws no direction nose. What it does say is whether its
 *  members face opposite ways: its bearing is the first member's that knows
 *  its facing, and `twoWay` is set when two such members are more than
 *  TWO_WAY_MIN_DEG apart -- two trams of one line passing each other read as
 *  one number with an arrow each way (the owner's ruling), while a merge
 *  going one way changes nothing. */
function clusterToFeature(cluster: Cluster<VehiclePillPoint>, focusedRoute?: string): VehicleFeature {
  const members = cluster.members.map((m) => m.feature);
  const kind: VehicleKind = members[0]!.properties.kind;
  const facing = members.filter((f) => f.properties.hasHeading).map((f) => f.properties.bearing);
  const twoWay = facing.some((a, i) => facing.slice(i + 1).some((b) => bearingGap(a, b) > TWO_WAY_MIN_DEG));
  const routes = new Set(members.map((f) => f.properties.routeId));
  const routeId = routes.size === 1 ? [...routes][0]!
    : focusedRoute !== undefined && routes.has(focusedRoute) ? focusedRoute : '';
  const lon = members.reduce((sum, f) => sum + f.geometry.coordinates[0], 0) / members.length;
  const lat = members.reduce((sum, f) => sum + f.geometry.coordinates[1], 0) / members.length;
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      id: cluster.id,
      icon: kind === 'tram' ? 'vehicle-tram' : 'vehicle-bus',
      kind,
      short: cluster.label,
      routeId,
      bearing: facing[0] ?? 0,
      hasHeading: false,
      twoWay,
      alpha: Math.max(...members.map((f) => f.properties.alpha)),
      sort: SORT_CLUSTER,
      held: false,
      cluster: true,
      ids: members.map((f) => f.properties.id),
      n: members.length,
    },
  };
}

/**
 * The model's output as the vehicle source: one feature per vehicle (the
 * model evicts what has gone quiet, R-F2, so everything it draws is fresh),
 * at the model's own position (R-P2), with its number, its facing when the
 * model knows it (decision 5: the nose is drawn only then; the bearing
 * otherwise follows the track so a tram's mark still lies along its rails)
 * and its confidence as alpha.
 *
 * With a `project` (the live camera's), tram and bus marks whose pills would
 * overlap on screen leave as one cluster feature instead of a pile: the pill
 * layer draws every mark it is given, so the thinning happens here, where the
 * app knows what the marks mean, rather than in MapLibre's collision pass,
 * which only knew that two boxes touched. Trams merge with trams and buses
 * with buses, never across (see below); an untyped mark ('other') is never
 * merged at all -- it has no number to join a label with.
 */
export function vehiclesToGeoJson(drawn: readonly Drawn[], options: VehicleGeoJsonOptions = {}): VehicleFeatureCollection {
  const features: VehicleFeature[] = [];
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
        twoWay: false,
        alpha: markAlpha(v.confidence),
        sort: kind === 'tram' ? SORT_TRAM : SORT_BUS,
        held: v.held === true,
        cluster: false,
      },
    });
  }
  const project = options.project;
  if (!project) return { type: 'FeatureCollection', features };
  const scale = options.symbolScale ?? 1;
  const selectedId = options.selectedId ?? null;

  // One group per mode, never across them. Every vehicle layer filters on
  // `kind` (overlays.ts kindFilter), and the mode toggle is a live control: a
  // bus swallowed into a cluster that called itself a tram would disappear
  // from the pills *and* the dots the moment a reader turned trams off. A pill
  // also carries its mode's ink, and a tram-blue capsule labelled with a bus
  // route would be a lie about both.
  const byKind = new Map<VehicleKind, VehiclePillPoint[]>();
  const alone: VehicleFeature[] = [];
  for (const feature of features) {
    const kind = feature.properties.kind;
    const at = kind === 'other' ? null : project(feature.geometry.coordinates);
    if (!at) {
      alone.push(feature);
      continue;
    }
    const point: VehiclePillPoint = { id: feature.properties.id, x: at.x / scale, y: at.y / scale, label: feature.properties.short, feature };
    const mode = byKind.get(kind);
    if (mode) mode.push(point);
    else byKind.set(kind, [point]);
  }
  const merged: VehicleFeature[] = [...alone];
  for (const points of byKind.values()) {
    for (const group of clusterPills(points, { selectedId })) {
      merged.push(group.kind === 'single' ? group.point.feature : clusterToFeature(group, options.focusedRoute));
    }
  }
  return { type: 'FeatureCollection', features: merged };
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
export function stopsToGeoJson(net: Network): StopFeatureCollection {
  const rows = net.stops.map((stop) => {
    const routes = [...new Set(stop.on.map((on) => net.shapes[on.shape]?.route).filter((r): r is string => Boolean(r)))].sort((a, b) =>
      a.localeCompare(b, 'hr', { numeric: true }),
    );
    const types = routes.map((r) => net.routes.get(r)?.type);
    return { stop, routes, tram: types.includes(ROUTE_TYPE_TRAM), bus: types.includes(ROUTE_TYPE_BUS) };
  });
  const labelled = new Map<string, { id: string; rank: number }>();
  const interchange = new Map<string, { tram: boolean; terminal: boolean }>();
  for (const { stop, routes, tram } of rows) {
    const best = labelled.get(stop.name);
    if (!best || routes.length > best.rank || (routes.length === best.rank && stop.id < best.id)) labelled.set(stop.name, { id: stop.id, rank: routes.length });
    const seen = interchange.get(stop.name) ?? { tram: false, terminal: false };
    interchange.set(stop.name, { tram: seen.tram || tram, terminal: seen.terminal || stop.terminal });
  }
  return {
    type: 'FeatureCollection',
    features: rows.map(({ stop, routes, tram, bus }) => {
      const hub = interchange.get(stop.name)!;
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: toLonLat(stop.p) },
        properties: {
          id: stop.id, name: stop.name, routes, rank: routes.length, tram, bus,
          label: labelled.get(stop.name)?.id === stop.id,
          tramInterchange: hub.tram && hub.terminal,
        },
      };
    }),
  };
}

/** Coarse enough that convergence noise never keeps the loop awake, fine
 *  enough (a centimetre, a degree, a hundredth of alpha) that real motion
 *  always registers -- the same discipline as the schematic's signature.
 *
 *  It is taken over the *unclustered* marks, and `selectedId` is the second
 *  half of the question: the merged collection a frame would push is a pure
 *  function of these features, the camera (a move clears the signature in
 *  onCameraMove), the map's fixed symbol scale and the one vehicle the
 *  clustering must leave standing. So a frame can decide whether to push
 *  without running the clustering pass first. An empty fleet keeps its empty
 *  signature, selected vehicle or not: there is nothing to push either way. */
function signatureOf(fc: VehicleFeatureCollection, selectedId: string | null): string {
  if (fc.features.length === 0) return '';
  return `${selectedId ?? ''}|${fc.features
    .map((f) => `${f.properties.id}:${f.geometry.coordinates[0].toFixed(7)},${f.geometry.coordinates[1].toFixed(7)},${f.properties.bearing},${f.properties.hasHeading ? 1 : 0},${f.properties.alpha.toFixed(2)},${f.properties.short}`)
    .join('|')}`;
}

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
  /** The feed's own state: anything but 'live' holds every vehicle where it is (an outage is no evidence of motion) until the feed is live again. */
  setFeedState?(state: 'live' | 'stale' | 'down'): void;
  setStop?(stop: ScreenStop | null): void;
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

// --- The marker census (WP2, the probe contract of the companion plan §15.6)
//
// What the wall promises about its city marks is a claim about the screen:
// every BAJS station a disc with its count in it (a grey "0" when it has no
// bike, a grey disc without a number when the count is unknown or the
// station is not renting, never "?"), every venue on it named, nothing a
// mark without a word. So the census reads back what MapLibre drew -- the
// dots, the counts and the names it placed -- rather than the points it was
// handed, like data-pills does for the vehicles. Pure, so the rules are
// tested without a map; writeRenderProbe (below) feeds it.

/** The city-place layers the census reads. map/city-layers.ts owns them, and
 *  it lives in the MapLibre chunk this module must not import, so the ids are
 *  written out here; test/motion/city-map.test.ts holds the two together. */
export const CENSUS_LAYERS = Object.freeze({ dots: 'city-place-dots', badges: 'city-place-badges', labels: 'city-place-labels' });
/** Half the side of the square a disc's number takes, in CSS px before the
 *  symbol scale: half of city-layers.ts BIKE_COUNT_PX (12). A pill lying over
 *  that square hides the number, whatever the disc's own radius. */
export const CENSUS_COUNT_HALF_PX = 6;

/** A feature as queryRenderedFeatures answers it; the geometry is there on a
 *  real map and may be missing on a stand-in. */
export interface RenderedFeature {
  layer: { id: string };
  properties: Record<string, unknown>;
  geometry?: { type: string; coordinates: unknown };
}

/** A box on the screen in CSS px, as a pill's is reckoned (motion/pills.ts). */
export interface ScreenBox { left: number; top: number; right: number; bottom: number }

export interface MarkerCensus {
  /** data-markers: the curated city marks drawn with their centre on the screen, once each. */
  markers: number;
  /** data-unlabelled: marks drawn with neither a whole-number count nor a
   *  name, the two deliberate exceptions below aside. Must be 0. */
  unlabelled: number;
  /** data-bajs, by what a station's disc says: `counted` a number above
   *  zero, `zero` the grey "0", `blank` the grey disc without a number (the
   *  count unknown, the station not renting: city/curated.ts bikeDisc), `far`
   *  the whole-city window's small dot without its number (points carrying
   *  `far`). The last two are deliberate and never unlabelled. */
  bajs: { counted: number; zero: number; blank: number; far: number };
  /** data-overlaps `discs`: marks whose number (or, for a disc without one,
   *  its centre) lies under a pill, so the reader sees the pill, not the mark.
   *  Transient on a live map: a tram passing a station covers it for as long
   *  as it takes to pass. */
  covered: number;
}

function boxesMeet(a: ScreenBox, b: ScreenBox): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * The census of the city marks from what the three census layers rendered.
 * `anchorOf` places a feature on the screen (null when it cannot: the mark
 * then counts, since MapLibre drew it); `view` is the map's box, 0 x 0 before
 * layout (every mark counts), so a disc whose edge alone reaches in from off
 * the screen, number outside, is not a mark somebody sees; `pills` are the
 * rendered pills' boxes at the map's `scale`.
 */
export function markerCensus(
  rendered: readonly RenderedFeature[],
  anchorOf: (feature: RenderedFeature) => { x: number; y: number } | null,
  view: { width: number; height: number },
  pills: readonly ScreenBox[],
  scale: number,
): MarkerCensus {
  // By feature id: a point on a tile seam comes back once from each tile.
  const dots = new Map<string, RenderedFeature>();
  const counts = new Map<string, string>();
  const named = new Set<string>();
  for (const feature of rendered) {
    const id = String(feature.properties.id ?? '');
    if (!id) continue;
    if (feature.layer.id === CENSUS_LAYERS.dots) {
      if (!dots.has(id)) dots.set(id, feature);
    } else if (feature.layer.id === CENSUS_LAYERS.badges) {
      // The badge layer draws nothing for '' (and for a `far` point), so a
      // rendered badge is a rendered word.
      const text = String(feature.properties.badge ?? '');
      if (text) counts.set(id, text);
    } else if (feature.layer.id === CENSUS_LAYERS.labels && String(feature.properties.title ?? '')) {
      named.add(id);
    }
  }
  const census: MarkerCensus = { markers: 0, unlabelled: 0, bajs: { counted: 0, zero: 0, blank: 0, far: 0 }, covered: 0 };
  const laidOut = view.width > 0 && view.height > 0;
  const half = CENSUS_COUNT_HALF_PX * scale;
  for (const [id, feature] of dots) {
    const at = anchorOf(feature);
    if (at && laidOut && (at.x < 0 || at.y < 0 || at.x > view.width || at.y > view.height)) continue;
    census.markers++;
    const p = feature.properties;
    const bike = p.category === 'bikes';
    const count = counts.get(id);
    // A count is a whole number: "?", "—" or a "+3" is a mark without one.
    const counted = count !== undefined && /^\d+$/.test(count);
    const far = bike && p.far === true;
    const blank = bike && !far && count === undefined && p.spent === true && String(p.badge ?? '') === '';
    if (far) census.bajs.far++;
    else if (bike && counted) census.bajs[count === '0' ? 'zero' : 'counted']++;
    else if (blank) census.bajs.blank++;
    if (!counted && !named.has(id) && !far && !blank) census.unlabelled++;
    if (at && pills.some((box) => boxesMeet(box, { left: at.x - half, top: at.y - half, right: at.x + half, bottom: at.y + half }))) census.covered++;
  }
  return census;
}

/** A rendered pill's box as motion/pills.ts reckons it for the clustering:
 *  pillWidthPx(pillChars(label)) x PILL_HEIGHT_PX, at the map's symbol scale,
 *  centred on the mark -- the box the merge decisions are made with. Where
 *  the capsule is drawn to fit its text, a merged label's narrow "·" makes the
 *  drawn capsule a little shorter than this, so the overlaps it finds are an
 *  upper bound by those few pixels, never a miss. */
export function pillBox(at: { x: number; y: number }, label: string, scale: number): ScreenBox {
  const halfW = (pillWidthPx(pillChars(label)) * scale) / 2;
  const halfH = (PILL_HEIGHT_PX * scale) / 2;
  return { left: at.x - halfW, top: at.y - halfH, right: at.x + halfW, bottom: at.y + halfH };
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
  /** The two getters that go with the setters above. Read only by the
   *  `data-focus` probe, so a test stand-in need not carry them. */
  getPaintProperty?(id: string, key: string): unknown;
  getLayoutProperty?(id: string, key: string): unknown;
  setFilter(id: string, filter: unknown): void;
  setLayerZoomRange?(id: string, minzoom: number, maxzoom: number): void;
  getLayer?(id: string): unknown;
  setSprite?(url: string): void;
  queryRenderedFeatures(geometry: unknown, options?: { layers?: string[] }): RenderedFeature[];
  easeTo(options: Record<string, unknown>): void;
  jumpTo(options: Record<string, unknown>): void;
  fitBounds(bounds: [[number, number], [number, number]], options?: Record<string, unknown>): void;
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
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
  container.setAttribute('aria-label', options.ariaLabel);
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

  function overlayOptions(p: OverlayPalette): OverlayOptions {
    const routeId = focusRouteId();
    const type = routeId === null ? undefined : net?.routes.get(routeId)?.type ?? ZET_ROUTES[routeId]?.type;
    const focus = routeId === null
      ? null
      : { routeId, colour: lineColour(routeId, vehicleKind(type ?? ROUTE_TYPE_TRAM) === 'bus' ? p.routeBus : p.routeTram) };
    return { scale, modes, closuresVisible, selection, emphasis, prozor, screenStopId: stop?.id ?? null, lineFocus: lineFocus === true, focus };
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
  // given. It is taken only when the answer can have changed: the camera's
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
  // markerCensus above), written beside the vehicle attributes:
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
  //                   crosses -- the pills ignore placement, so neither ever
  //                   pushes the other off the map, and this counts where
  //                   they meet instead. One small query per rendered pill.
  /** zoom, selection, "has any marks" and the evidence version the census was last taken for. */
  let renderProbeKey = '';
  /** Whether the last pushed collection had any mark at all; see the key above. */
  let probeHasMarks = false;
  /** Bumped by update() and applyCityOverlays(): the census is re-taken at the next idle. */
  let probeVersion = 0;

  function writeMarkProbe(m: MapApi, pushed: VehicleFeatureCollection | null): void {
    container.dataset.zoom = m.getZoom().toFixed(2);
    if (pushed) probeHasMarks = pushed.features.length > 0;
  }

  function writeRenderProbe(): void {
    const m = map;
    const l = lib;
    if (!m || !styled || !l) return;
    const key = `${m.getZoom().toFixed(2)}|${selection ? `${selection.kind}:${selection.id}` : ''}|${probeHasMarks ? 1 : 0}|${probeVersion}`;
    if (key === renderProbeKey) return;
    renderProbeKey = key;
    // Asking MapLibre about a layer the style does not carry fires an error
    // event, which onMapError logs as a bug; placedNames() guards the same way.
    const ids = [l.LAYERS.vehicles, l.LAYERS.vehicleSelected, l.LAYERS.vehicleNoses, l.LAYERS.vehicleBodies, l.LAYERS.vehicleTwoWayFore]
      .filter((id) => !m.getLayer || m.getLayer(id));
    // By feature id, so a mark queried twice (a point on a tile seam, a line
    // across one) is one pill, one body, one arrow; the pills in id order, so
    // the attribute is stable frame to frame.
    const pills = new Map<string, string>();
    const pillFeatures = new Map<string, RenderedFeature>();
    const bodies = new Set<string>();
    const twoWay = new Set<string>();
    let noses = 0;
    for (const feature of ids.length === 0 ? [] : m.queryRenderedFeatures(undefined, { layers: ids })) {
      if (feature.layer.id === l.LAYERS.vehicleNoses) noses++;
      else if (feature.layer.id === l.LAYERS.vehicleBodies) bodies.add(String(feature.properties.id));
      else if (feature.layer.id === l.LAYERS.vehicleTwoWayFore) twoWay.add(String(feature.properties.id));
      else {
        pills.set(String(feature.properties.id), String(feature.properties.short ?? ''));
        pillFeatures.set(String(feature.properties.id), feature);
      }
    }
    container.dataset.pills = [...pills.keys()].sort().map((id) => pills.get(id)!).join('|');
    container.dataset.noses = String(noses);
    container.dataset.bodies = String(bodies.size);
    container.dataset.twoway = String(twoWay.size);
    writeMarkerCensus(m, l, [...pillFeatures.values()]);
  }

  /** The marker census and the overlaps (see the probe comment above), from
   *  the pills the vehicle census just read. */
  function writeMarkerCensus(m: MapApi, l: MaplibreModule, pillFeatures: readonly RenderedFeature[]): void {
    const has = (id: string): boolean => !m.getLayer || Boolean(m.getLayer(id));
    const anchorOf = (feature: RenderedFeature): { x: number; y: number } | null => {
      const g = feature.geometry;
      if (!m.project || g?.type !== 'Point' || !Array.isArray(g.coordinates)) return null;
      const [lon, lat] = g.coordinates as number[];
      return Number.isFinite(lon) && Number.isFinite(lat) ? m.project([lon!, lat!]) : null;
    };
    const pillBoxes: ScreenBox[] = [];
    for (const feature of pillFeatures) {
      const at = anchorOf(feature);
      if (at) pillBoxes.push(pillBox(at, String(feature.properties.short ?? ''), scale));
    }
    const cityIds = [CENSUS_LAYERS.dots, CENSUS_LAYERS.badges, CENSUS_LAYERS.labels].filter(has);
    const census = markerCensus(
      cityIds.length === 0 ? [] : m.queryRenderedFeatures(undefined, { layers: cityIds }),
      anchorOf, { width: container.clientWidth, height: container.clientHeight }, pillBoxes, scale,
    );
    const nameIds = [l.LAYERS.stopLabels, l.LAYERS.screenStopLabel, l.LAYERS.placeQuakeLabels, l.LAYERS.placeWorks, l.LAYERS.placeEvents,
      l.LAYERS.placeSeat, l.LAYERS.placeAssembly, l.LAYERS.placePharmacy, CENSUS_LAYERS.labels].filter(has);
    const crossed = new Set<string>();
    if (nameIds.length > 0) {
      for (const box of pillBoxes) {
        for (const feature of m.queryRenderedFeatures([[box.left, box.top], [box.right, box.bottom]], { layers: nameIds })) {
          crossed.add(`${feature.layer.id}:${String(feature.properties.id ?? feature.properties.name ?? '')}`);
        }
      }
    }
    container.dataset.markers = String(census.markers);
    container.dataset.unlabelled = String(census.unlabelled);
    container.dataset.bajs = `counted:${census.bajs.counted};zero:${census.bajs.zero};blank:${census.bajs.blank};far:${census.bajs.far}`;
    container.dataset.overlaps = `discs:${census.covered};names:${crossed.size}`;
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
    // answer (signatureOf).
    const kept = keptVehicleId();
    container.dataset.frames = String(loop.frames());
    const signature = signatureOf(vehiclesToGeoJson(lastDrawn), kept);
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
      fc = vehiclesToGeoJson(lastDrawn, { project, selectedId: kept, symbolScale: scale, focusedRoute: litRouteId() ?? undefined });
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

  /** The bodies go with the pills on the frames that push, from BODY_ZOOM up.
   *  Below it the layer draws nothing whatever the source holds, so the
   *  source is emptied once and then left alone -- one setData per push
   *  again the moment the camera comes back in, not one per push for a
   *  layer that is not drawing. */
  function pushBodies(m: MapApi, l: MaplibreModule): void {
    const shown = m.getZoom() >= l.BODY_ZOOM;
    if (!shown && !bodiesShown) return;
    m.getSource(l.SOURCES.bodies)?.setData(shown ? bodiesToGeoJson(lastDrawn, graph) : { type: 'FeatureCollection', features: [] });
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
    setData(lib.SOURCES.places, pointsToGeoJson(points.filter(p=>p.place!=='city')));
    if (lib.CITY_POINTS) setData(lib.CITY_POINTS, pointsToGeoJson(points.filter(p=>p.place==='city')));
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
    graph = network && 'paths' in network ? (network as GraphNetwork) : null;
    model = createIntegrator(net);
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

  function buildMap(l: MaplibreModule): void {
    const style = l.basemapStyle(theme, basemapOptions());
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
      cooperativeGestures: options.cooperative === true,
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
    if (options.onCamera) created.on('zoomend', () => { const camera = cameraOf(created); if (camera) options.onCamera!(camera); });
    // The one moment MapLibre has finished painting what it was given: the
    // honest place to ask it what it drew (see the probe comment above).
    created.on('idle', writeRenderProbe);
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
    created.addSource(l.SOURCES.places, geojson(pointsToGeoJson(points.filter(p=>p.place!=='city'))));
    if (l.CITY_POINTS) {
      created.addSource(l.CITY_POINTS, geojson(pointsToGeoJson(points.filter(p=>p.place==='city'))));
      created.addSource(l.CITY_PATHS, geojson(linesToGeoJson(cityPaths)));
    }
    created.addSource(l.SOURCES.vehicles, geojson(empty));
    created.addSource(l.SOURCES.bodies, geojson(empty));
    created.addSource(l.SOURCES.screenStop, geojson(screenStopGeoJson()));
    created.addSource(l.SOURCES.outline, geojson(outlineToGeoJson(outline)));
    const palette = l.overlayPalette(theme);
    created.addSource('ambient-highlight',geojson(highlightData()));
    created.addLayer({id:'ambient-highlight-area',type:'fill',source:'ambient-highlight',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':palette.selection,'fill-opacity':0.12}});
    overlays = l.overlayLayers(palette, overlayOptions(palette));
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
    basemapFailing = false;
    if (styled && status === 'tiles-failed') setStatus('ready');
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

  /** A cluster mark's members, or null when the picked feature is one vehicle.
   *  MapLibre hands an array property back as an array (it JSON-tags the value
   *  through its own tile encoding and parses it again on the way out), so the
   *  ids the source wrote are the ids read here. */
  function clusterMembers(properties: Record<string, unknown>): string[] | null {
    if (properties.cluster !== true) return null;
    const ids = properties.ids;
    return Array.isArray(ids) ? ids.map(String) : [];
  }

  /** Where the model currently draws each of these vehicles; one that has gone
   *  since the frame the tap hit is simply left out. */
  function memberCoordinates(ids: readonly string[]): [number, number][] {
    const coords: [number, number][] = [];
    for (const id of ids) {
      const v = lastDrawn.find((d) => d.id === id);
      if (v) coords.push(toLonLat(v.p));
    }
    return coords;
  }

  /** A tap on a merged mark. While the members are a few pixels apart no tap
   *  can mean one of them, so the camera goes in on them instead of guessing
   *  (CLUSTER_ZOOM_IN_UNTIL); close in, the pills are apart and the tap means
   *  the one under it. Nothing is selected on the way in: a selection the
   *  reader did not aim at is worse than one more tap. */
  function openCluster(m: MapApi, ids: readonly string[], point: { x: number; y: number }): void {
    const coords = memberCoordinates(ids);
    if (coords.length === 0) return;
    if (m.getZoom() < CLUSTER_ZOOM_IN_UNTIL) {
      fitCoordinates(coords, CLUSTER_ZOOM_IN_UNTIL);
      return;
    }
    let nearest: string | null = null;
    let best = Infinity;
    for (const id of ids) {
      const v = lastDrawn.find((d) => d.id === id);
      if (!v) continue;
      const at = m.project?.(toLonLat(v.p));
      const distance = at ? Math.hypot(at.x - point.x, at.y - point.y) : 0;
      if (distance < best) {
        best = distance;
        nearest = id;
      }
    }
    if (!nearest) return;
    const picked: MapSelection = { kind: 'vehicle', id: nearest };
    select(picked);
    options.onSelect?.(picked);
  }

  /** What a tap landed on: one of the map's selectable things, or a cluster of
   *  vehicles, which is not a selection but a request to look closer. */
  type Picked = MapSelection | { kind: 'cluster'; ids: string[] };

  /** The mark under a tap, by priority: a vehicle over a city place over a
   *  stop over a closure; nothing under it clears. The vehicle wins because a
   *  numbered pill is what this map is for -- it is drawn last, over
   *  everything, and it moves; a place dot standing under one is still
   *  reachable by tapping beside the pill or by zooming, where a pill covered
   *  by a dot could not be tapped at all. */
  function pick(m: MapApi, point: { x: number; y: number }): Picked | null {
    const l = lib;
    if (!l) return null;
    const box = [
      [point.x - hitTolerance, point.y - hitTolerance],
      [point.x + hitTolerance, point.y + hitTolerance],
    ];
    const first = (layers: string[]): { properties: Record<string, unknown> } | undefined => m.queryRenderedFeatures(box, { layers })[0];
    const vehicle = first([l.LAYERS.vehicleSelected, l.LAYERS.vehicles, l.LAYERS.vehicleDots]);
    if (vehicle) {
      const members = clusterMembers(vehicle.properties);
      return members ? { kind: 'cluster', ids: members } : { kind: 'vehicle', id: String(vehicle.properties.id) };
    }
    const place = l.CITY_LAYERS ? first(['city-place-dots','city-place-badges','city-place-labels']) : undefined;
    if (place) return {kind:'place',id:String(place.properties.id)};
    const platform = first([l.LAYERS.stopsSelected, l.LAYERS.stopsRoute, l.LAYERS.stops, l.LAYERS.stopLabels]);
    if (platform) return { kind: 'stop', id: String(platform.properties.id), ids: siblingPlatforms(String(platform.properties.name)) };
    const closure = closuresVisible ? first([l.LAYERS.closures, l.LAYERS.closuresCasing]) : undefined;
    if (closure) return { kind: 'closure', id: String(closure.properties.id) };
    if (options.resolveStreet && m.unproject) {
      const labelLayers=basemap.filter(layer=>layer.type==='symbol'&&layer.id.startsWith('roads_labels')).map(layer=>layer.id);
      const road=labelLayers.length?first(labelLayers):undefined;
      const name=road?.properties['name:hr']??road?.properties.name;
      if (typeof name==='string') {
        const p=m.unproject(point),id=options.resolveStreet(name,{lon:p.lng,lat:p.lat});
        if(id)return {kind:'street',id};
      }
    }
    return null;
  }

  function bindPointer(m: MapApi): void {
    const canvas = m.getCanvas();
    m.on('click', (event) => {
      if (!styled || !event.point) return;
      const picked = pick(m, event.point);
      if (picked?.kind === 'cluster') {
        openCluster(m, picked.ids, event.point);
        return;
      }
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
    const next = l.overlayLayers(palette, overlayOptions(palette));
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
    const nextBasemap = l.basemapLayers(theme, basemapOptions());
    applyOps(map, l.styleDiff(basemap, nextBasemap));
    basemap = nextBasemap;
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
      model?.update(pointsToFixes(points), now());
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
    setCityPaths(next) { cityPaths=next; if(styled&&lib?.CITY_PATHS)setData(lib.CITY_PATHS,linesToGeoJson(next)); },
    setHighlight(next) {
      if(JSON.stringify(next)===JSON.stringify(highlight))return;
      highlight=next;
      if(styled)setData('ambient-highlight',highlightData());
    },
    setPresentationProfile(name,nextScale) {
      const next=MAP_PRESENTATIONS[name],size=nextScale??next.symbolScale;
      if(next===profile&&size===scale)return;
      profile=next;scale=size;hitTolerance=next.hitTolerancePx;
      container.dataset.presentationProfile=name;
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
      // only `down` (nothing at all) holds every mark where it is.
      const next = state === 'down';
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
    setOutline(next) {
      if (next?.id === outline?.id) return;
      outline = next;
      if (styled && lib) setData(lib.SOURCES.outline, outlineToGeoJson(outline));
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
