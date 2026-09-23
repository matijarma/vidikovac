// The vehicle sources the city map pushes, in the MapLibre chunk
// (maplibre-entry.ts): the marks, merged into clusters where their pills
// would overlap on screen (motion/pills.ts), the signature a frame compares
// before it pays for that pass, and the bodies (motion/bodies.ts). Only a
// drawn map ever builds them, so the pill geometry and the clustering stay
// off the lightweight graph (test/app/budget.test.ts); city-map.ts reaches
// them through the loaded module, as it does the layers.
import { toLonLat } from '../../../shared/motion/geo';
import type { Drawn } from '../motion/integrator';
import { clusterPills, noseCentrePx, type Cluster, type PillPoint } from '../motion/pills';
import { bearingOf, vehicleLabel, type VehicleFeature, type VehicleFeatureCollection } from './city-map';
import { markAlpha, vehicleKind, type VehicleKind } from './vehicle-mark';

export { bodiesToGeoJson } from '../motion/bodies';

/** The shortest way round the compass between two bearings, 0 to 180 degrees. */
function bearingGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
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
      nose: noseCentrePx(cluster.label, kind, facing[0] ?? 0),
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
    const short = vehicleLabel(v);
    const bearing = bearingOf(v.heading ?? v.track);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: toLonLat(v.p) },
      properties: {
        id: v.id,
        icon: kind === 'tram' ? 'vehicle-tram' : 'vehicle-bus',
        kind,
        short,
        routeId: v.routeId ?? '',
        bearing,
        hasHeading: v.heading !== null,
        twoWay: false,
        nose: noseCentrePx(short, kind, bearing),
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
export function vehicleSignature(fc: VehicleFeatureCollection, selectedId: string | null): string {
  if (fc.features.length === 0) return '';
  return `${selectedId ?? ''}|${fc.features
    .map((f) => `${f.properties.id}:${f.geometry.coordinates[0].toFixed(7)},${f.geometry.coordinates[1].toFixed(7)},${f.properties.bearing},${f.properties.hasHeading ? 1 : 0},${f.properties.alpha.toFixed(2)},${f.properties.short}`)
    .join('|')}`;
}
