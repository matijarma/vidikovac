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
    paths.push({ id: path.id, route, direction: path.direction, shape: null, edges: path.edges, offsets, len, stops: [] });
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
    const on = (edgeInShapes.get(st.edge) ?? []).map(({ shape, offset }) => ({ shape, s: offset + st.s }));
    return { id: st.id, name: st.name ?? st.id, p, on, onEdge: [{ edge: st.edge, s: st.s }] };
  });

  const byShape: { stop: Stop; s: number }[][] = shapes.map(() => []);
  for (const stop of stops) for (const { shape, s } of stop.on) byShape[shape].push({ stop, s });
  for (const list of byShape) list.sort((a, b) => a.s - b.s);
  const nextStop = (shapeIdx: number, s: number): { stop: Stop; s: number } | null => {
    const list = byShape[shapeIdx] ?? [];
    for (const entry of list) if (entry.s > s) return entry;
    return null;
  };

  return {
    version: 2,
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
 */
export function corridorSpec(): SynthSpec {
  const stops: SynthStop[] = [];
  const addStops = (edge: number, len: number, prefix: string) => {
    for (let s = 300; s < len; s += 300) stops.push({ id: `${prefix}${s}`, edge, s });
  };
  addStops(0, 1500, 'T');
  stops.push({ id: 'T0', edge: 0, s: 0 });
  addStops(1, 1200, 'C');
  stops.push({ id: 'C1200', edge: 1, s: 1200 });
  addStops(2, 1200, 'D');
  stops.push({ id: 'W750', edge: 5, s: 750 });
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
      { id: '1', type: 0, paths: [{ id: '1_0', direction: 0, edges: [0, 1] }, { id: '1_1', direction: 1, edges: [5] }] },
      { id: '2', type: 0, paths: [{ id: '2_0', direction: 0, edges: [0, 2] }] },
      { id: '9', type: 0, paths: [{ id: 'path:9:0:abc', direction: 0, edges: [0, 1], synthetic: true }] },
      { id: '109', type: 3, busShapes: [{ id: 'B109', pts: straight(0, 2700, -30) }] },
    ],
    stops,
  };
}
