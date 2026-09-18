// A GraphNetwork built directly from edges, paths and stops, the way the
// decoder assembles the real one (shared/motion/network.ts), so the engine's
// tests run on geometry they can read in full: no fixtures, no artefact.
import { toLonLat, type XY } from '../../shared/motion/geo';
import { graphMethods } from '../../shared/motion/graph';
import type { Edge, GraphNetwork, Path, Shape, Stop } from '../../shared/motion/network';
import { cumulative } from '../../shared/motion/polyline';

export interface SynthEdge {
  from: number;
  to: number;
  pts: XY[];
}

export interface SynthPath {
  id: string;
  direction: 0 | 1;
  edges: number[];
  /** A synthetic path (no shape of its own), as the builder makes for shapeless patterns. */
  synthetic?: boolean;
  /** The stops this path's own trips call at (artefact v3's `served`, F8).
   *  Omitted, the path has no served list and stopsOnPath derives it from
   *  the geometry, as a version 2 artefact's path did. */
  served?: string[];
}

export interface SynthRoute {
  id: string;
  /** GTFS route_type: 0 tram (paths over the graph), 3 bus (polylines). */
  type: 0 | 3;
  paths?: SynthPath[];
  busShapes?: { id: string; pts: XY[] }[];
}

export interface SynthStop {
  id: string;
  name?: string;
  edge: number;
  /** Arc along the edge. */
  s: number;
  /** Further edges this platform lies within reach of, as the builder's 40 m
   *  radius links an opposite-direction platform to both tracks. */
  also?: { edge: number; s: number }[];
  /** First or last stop of some trip (artefact v3's `terminal`, F8). */
  terminal?: boolean;
}

export interface SynthSpec {
  edges: SynthEdge[];
  routes: SynthRoute[];
  stops: SynthStop[];
}

export function syntheticNetwork(spec: SynthSpec): GraphNetwork {
  const edges: Edge[] = spec.edges.map((e) => {
    const cum = cumulative(e.pts);
    return { from: e.from, to: e.to, pts: e.pts, cum, len: cum[cum.length - 1] ?? 0 };
  });
  const offsetsOf = (edgeSeq: readonly number[]): { offsets: number[]; len: number } => {
    const offsets: number[] = [];
    let len = 0;
    for (const e of edgeSeq) {
      offsets.push(len);
      len += edges[e].len;
    }
    return { offsets, len };
  };
  const concat = (edgeSeq: readonly number[]): XY[] => {
    const pts: XY[] = [];
    for (const e of edgeSeq) for (let i = pts.length === 0 ? 0 : 1; i < edges[e].pts.length; i++) pts.push(edges[e].pts[i]);
    return pts;
  };

  const shapes: Shape[] = [];
  const paths: Path[] = [];
  const pathOfShapeIdx = new Map<number, number>();
  const routes = new Map<string, { short: string; type: number; rank: number; shapes: number[] }>();
  const synthetic: { path: SynthPath; route: string }[] = [];
  const served: { at: number; ids: string[] | undefined }[] = [];
  let rank = 1;
  for (const route of spec.routes) {
    const shapeIdxs: number[] = [];
    for (const path of route.paths ?? []) {
      if (path.synthetic) {
        synthetic.push({ path, route: route.id });
        continue;
      }
      const pts = concat(path.edges);
      const cum = cumulative(pts);
      const shapeIdx = shapes.length;
      shapes.push({ id: path.id, route: route.id, pts, cum, len: cum[cum.length - 1] ?? 0, direction: path.direction, edges: path.edges });
      shapeIdxs.push(shapeIdx);
      const { offsets, len } = offsetsOf(path.edges);
      pathOfShapeIdx.set(shapeIdx, paths.length);
      served.push({ at: paths.length, ids: path.served });
      paths.push({ id: path.id, route: route.id, direction: path.direction, shape: shapeIdx, edges: path.edges, offsets, len });
    }
    for (const bus of route.busShapes ?? []) {
      const cum = cumulative(bus.pts);
      shapeIdxs.push(shapes.length);
      shapes.push({ id: bus.id, route: route.id, pts: bus.pts, cum, len: cum[cum.length - 1] ?? 0, direction: -1 });
    }
    routes.set(route.id, { short: route.id, type: route.type, rank: rank++, shapes: shapeIdxs });
  }
  for (const { path, route } of synthetic) {
    const { offsets, len } = offsetsOf(path.edges);
    served.push({ at: paths.length, ids: path.served });
    paths.push({ id: path.id, route, direction: path.direction, shape: null, edges: path.edges, offsets, len, stops: path.served ?? [] });
  }

  // A stop on an edge is on every shape running that edge, at the shape's
  // offset of the edge plus the arc along it (as the decoder derives `on`).
  const edgeInShapes = new Map<number, { shape: number; offset: number }[]>();
  shapes.forEach((shape, shapeIdx) => {
    if (!shape.edges) return;
    const { offsets } = offsetsOf(shape.edges);
    shape.edges.forEach((e, k) => {
      const list = edgeInShapes.get(e) ?? [];
      list.push({ shape: shapeIdx, offset: offsets[k] });
      edgeInShapes.set(e, list);
    });
  });
  const stops: Stop[] = spec.stops.map((st) => {
    const edge = edges[st.edge];
    const idx = edge.cum.findIndex((c, i) => i === edge.cum.length - 1 || edge.cum[i + 1] > st.s);
    const seg = Math.max(0, Math.min(idx, edge.pts.length - 2));
    const a = edge.pts[seg];
    const b = edge.pts[seg + 1];
    const segLen = edge.cum[seg + 1] - edge.cum[seg];
    const t = segLen > 0 ? (st.s - edge.cum[seg]) / segLen : 0;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const onEdge = [{ edge: st.edge, s: st.s }, ...(st.also ?? [])];
    const on = onEdge.flatMap((link) => (edgeInShapes.get(link.edge) ?? []).map(({ shape, offset }) => ({ shape, s: offset + link.s })));
    on.sort((a, b) => a.shape - b.shape || a.s - b.s);
    return { id: st.id, name: st.name ?? st.id, p, on, onEdge, terminal: st.terminal ?? false };
  });

  // The served lists, as arcs along each path: the decoder's `served` field,
  // built here from stop ids so a fixture can name the stops a line calls at.
  const stopIdxById = new Map(stops.map((stop, i) => [stop.id, i] as const));
  for (const { at: pathIdx, ids } of served) {
    if (!ids) continue;
    const path = paths[pathIdx];
    const list: { stop: number; s: number }[] = [];
    for (const id of ids) {
      const stopIdx = stopIdxById.get(id);
      if (stopIdx === undefined) throw new Error(`path ${path.id} serves unknown stop ${id}`);
      const k = path.edges.findIndex((e) => (stops[stopIdx].onEdge ?? []).some((link) => link.edge === e));
      if (k < 0) throw new Error(`path ${path.id} serves ${id}, which lies on none of its edges`);
      const link = (stops[stopIdx].onEdge ?? []).find((l) => l.edge === path.edges[k])!;
      list.push({ stop: stopIdx, s: path.offsets[k] + link.s });
    }
    list.sort((a, b) => a.s - b.s);
    path.served = list;
  }

  const byShape: { stop: Stop; s: number }[][] = shapes.map(() => []);
  for (const stop of stops) for (const { shape, s } of stop.on) byShape[shape].push({ stop, s });
  for (const list of byShape) list.sort((a, b) => a.s - b.s);
  const nextStop = (shapeIdx: number, s: number): { stop: Stop; s: number } | null => {
    const list = byShape[shapeIdx] ?? [];
    for (const entry of list) if (entry.s > s) return entry;
    return null;
  };

  return {
    version: 3,
    feedVersion: 'synthetic',
    routes,
    shapes,
    stops,
    diagram: { lines: [], box: [1, 1] },
    nextStop,
    edges,
    paths,
    ...graphMethods(edges, paths, stops, pathOfShapeIdx),
  };
}

/** A straight edge from a to b along the x axis at height y, one metre per unit. */
export function straight(x0: number, x1: number, y = 0): XY[] {
  return [
    { x: x0, y },
    { x: x1, y },
  ];
}

export function lonLatOf(p: XY): { lon: number; lat: number } {
  const [lon, lat] = toLonLat(p);
  return { lon, lat };
}

/**
 * The corridor the engine tests share. Edges (metres, x east, y north):
 *   0: A(0,0) → B(1500,0)           the shared trunk
 *   1: B → C(2700,0)                route 1 continues east
 *   2: B → D(1500,1200) via a bend  route 2 turns north at the junction
 *   3: C → C' loop back to (2700,-60) and (2400,-60): a balloon terminus stub
 *   4: E(0,60) → F(1500,60)         the opposite track of the trunk, westbound is edge 5
 *   5: F(1500,60) → E(0,60)
 * Routes: '1' (paths 1_0: edges 0,1; 1_1: edge 5 only, the return), '2'
 * (path 2_0: edges 0,2), '9' (synthetic-only route: path over edges 0,1 with
 * no shape, the shapeless-pattern case), bus '109' (a polyline 30 m south of
 * the trunk). Stops every 300 m on the trunk and on both branches.
 *
 * Two platforms on the trunk are phantoms for route 1 eastbound (F8): W750,
 * the westbound platform of the same place, and X750, the platform only line
 * 2 calls at. Both lie on edge 0, so the geometric derivation lists them on
 * every path over the trunk; neither is in path 1_0's served list. W750's
 * second link is declared rather than measured -- the corridor holds its two
 * tracks 60 m apart so the matcher's fold tests have room, while the real
 * builder's 40 m radius links an opposite-direction platform to both tracks
 * (they run 3 to 6 m apart in ZET's own geometry).
 */
export function corridorSpec(): SynthSpec {
  const stops: SynthStop[] = [];
  const addStops = (edge: number, len: number, prefix: string) => {
    for (let s = 300; s < len; s += 300) stops.push({ id: `${prefix}${s}`, edge, s });
  };
  addStops(0, 1500, 'T');
  stops.push({ id: 'T0', edge: 0, s: 0, terminal: true });
  addStops(1, 1200, 'C');
  stops.push({ id: 'C1200', edge: 1, s: 1200, terminal: true });
  addStops(2, 1200, 'D');
  stops.push({ id: 'W750', name: 'Zapad 750', edge: 5, s: 750, also: [{ edge: 0, s: 752 }] });
  stops.push({ id: 'X750', name: 'Druga linija 750', edge: 0, s: 748 });
  const trunk = ['T0', 'T300', 'T600', 'T900', 'T1200'];
  const east = [...trunk, 'C300', 'C600', 'C900', 'C1200'];
  const north = [...trunk, 'X750', 'D300', 'D600', 'D900'];
  return {
    edges: [
      { from: 0, to: 1, pts: straight(0, 1500) },
      { from: 1, to: 2, pts: straight(1500, 2700) },
      { from: 1, to: 3, pts: [{ x: 1500, y: 0 }, { x: 1560, y: 60 }, { x: 1560, y: 1200 }] },
      { from: 2, to: 4, pts: [{ x: 2700, y: 0 }, { x: 2760, y: -30 }, { x: 2700, y: -60 }, { x: 2400, y: -60 }] },
      { from: 5, to: 6, pts: straight(0, 1500, 60) },
      { from: 6, to: 5, pts: [{ x: 1500, y: 60 }, { x: 0, y: 60 }] },
    ],
    routes: [
      { id: '1', type: 0, paths: [{ id: '1_0', direction: 0, edges: [0, 1], served: east }, { id: '1_1', direction: 1, edges: [5], served: ['W750'] }] },
      { id: '2', type: 0, paths: [{ id: '2_0', direction: 0, edges: [0, 2], served: north }] },
      { id: '9', type: 0, paths: [{ id: 'path:9:0:abc', direction: 0, edges: [0, 1], synthetic: true, served: east }] },
      { id: '109', type: 3, busShapes: [{ id: 'B109', pts: straight(0, 2700, -30) }] },
    ],
    stops,
  };
}
