// The rail graph's helpers, attached to the decoded network by
// shared/motion/network.ts (they are closures over its edges, paths and
// stops, memoised where a per-frame caller would otherwise redo the work).
// What the twin's matcher and planner (B3, B4) and the client integrator
// (B6) read: which edges are near a fix, a path's geometry as one polyline,
// its stops in arc order, and arc <-> point on a path. DOM-free (R-TE15).

import type { XY } from './geo';
import { at, project, projectionsWithin } from './polyline';
import type { Edge, Path, Stop } from './network';

export interface EdgeHit {
  edge: number;
  /** Distance from the query point to the edge, metres. */
  d: number;
  /** Arc along the edge at the nearest point. */
  s: number;
}

export interface GraphMethods {
  /** The path index of a tram shape, or null for a bus shape. */
  pathOfShape(shapeIdx: number): number | null;
  /** The path's edges as one polyline with its cumulative arc, built once. */
  pathGeometry(pathIdx: number): { pts: XY[]; cum: number[] };
  /** The stops the path's own trips call at, in arc order, each at its arc
   *  along the path: the artefact's served list (F8) where it carries one,
   *  and the geometric derivation only for a path without one. This is what
   *  the engine reads -- the planner's dwells, the laws' concession gate, the
   *  learner's evidence, the speed estimator's charge, the published `held`. */
  stopsOnPath(pathIdx: number): { stop: Stop; s: number }[];
  /** Every platform that lies on the path's edges, served or not, in arc
   *  order: what stopsOnPath derived before the served list existed. The
   *  replay grader's phantom row and the build reports measure against it;
   *  no engine site may read it. */
  stopsOnPathGeometric(pathIdx: number): { stop: Stop; s: number }[];
  /** The first stop strictly ahead of arc `s` on the path, or null. */
  nextStopOnPath(pathIdx: number, s: number): { stop: Stop; s: number } | null;
  /** Every edge within `radiusM` of `p`, nearest first. */
  edgesNear(p: XY, radiusM: number): EdgeHit[];
  /** The point at arc `s` along the path. */
  toPathPoint(pathIdx: number, s: number): XY;
  /** The arc along the path nearest to `p`, and how far off the path `p` is. */
  projectOntoPath(pathIdx: number, p: XY): { s: number; d: number };
  /** Every local minimum of the distance from `p` to the path within the arc
   *  window and within `maxD`, nearest arc first (polyline.ts
   *  projectionsWithin): a circuit or a loop offers several, and the matcher
   *  chooses among them (R-TE45). */
  projectionsOntoPath(pathIdx: number, p: XY, sFrom: number, sTo: number, maxD: number): { s: number; d: number }[];
}

/** Spatial grid cell for edgesNear: 250 m is about one inner-city stop
 *  spacing, so a fix's 3x3 neighbourhood holds the handful of edges that
 *  could plausibly carry it and a whole route's worth of others stays out. */
const GRID_CELL_M = 250;

export function graphMethods(edges: readonly Edge[], paths: readonly Path[], stops: readonly Stop[], pathOfShapeIdx: ReadonlyMap<number, number>): GraphMethods {
  const geometry = new Map<number, { pts: XY[]; cum: number[] }>();
  const pathStops = new Map<number, { stop: Stop; s: number }[]>();
  const pathStopsGeometric = new Map<number, { stop: Stop; s: number }[]>();
  let grid: Map<string, number[]> | null = null;

  const stopsByEdge = new Map<number, { stop: Stop; s: number }[]>();
  for (const stop of stops) {
    for (const link of stop.onEdge ?? []) {
      const list = stopsByEdge.get(link.edge);
      const entry = { stop, s: link.s };
      if (list) list.push(entry);
      else stopsByEdge.set(link.edge, [entry]);
    }
  }

  function pathGeometry(pathIdx: number): { pts: XY[]; cum: number[] } {
    let geo = geometry.get(pathIdx);
    if (geo) return geo;
    const path = paths[pathIdx];
    const pts: XY[] = [];
    let cum: number[] = [];
    for (const e of path.edges) {
      const edge = edges[e];
      const base = cum.length > 0 ? cum[cum.length - 1] : 0;
      for (let i = pts.length === 0 ? 0 : 1; i < edge.pts.length; i++) {
        pts.push(edge.pts[i]);
        cum.push(base + edge.cum[i]);
      }
      if (cum.length === 0) cum = [0];
    }
    geo = { pts, cum };
    geometry.set(pathIdx, geo);
    return geo;
  }

  function stopsOnPathGeometric(pathIdx: number): { stop: Stop; s: number }[] {
    let list = pathStopsGeometric.get(pathIdx);
    if (list) return list;
    const path = paths[pathIdx];
    list = [];
    path.edges.forEach((e, k) => {
      for (const entry of stopsByEdge.get(e) ?? []) list!.push({ stop: entry.stop, s: path.offsets[k] + entry.s });
    });
    list.sort((a, b) => a.s - b.s);
    pathStopsGeometric.set(pathIdx, list);
    return list;
  }

  function stopsOnPath(pathIdx: number): { stop: Stop; s: number }[] {
    let list = pathStops.get(pathIdx);
    if (list) return list;
    const served = paths[pathIdx]?.served;
    if (!served || served.length === 0) return stopsOnPathGeometric(pathIdx);
    list = served
      .map((entry) => ({ stop: stops[entry.stop], s: entry.s }))
      .filter((entry) => entry.stop !== undefined)
      .sort((a, b) => a.s - b.s);
    pathStops.set(pathIdx, list);
    return list;
  }

  function nextStopOnPath(pathIdx: number, s: number): { stop: Stop; s: number } | null {
    const list = stopsOnPath(pathIdx);
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].s > s) hi = mid;
      else lo = mid + 1;
    }
    return lo < list.length ? list[lo] : null;
  }

  const cellKey = (cx: number, cy: number): string => `${cx},${cy}`;

  function buildGrid(): Map<string, number[]> {
    const map = new Map<string, number[]>();
    edges.forEach((edge, idx) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of edge.pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      if (!Number.isFinite(minX)) return;
      for (let cx = Math.floor(minX / GRID_CELL_M); cx <= Math.floor(maxX / GRID_CELL_M); cx++) {
        for (let cy = Math.floor(minY / GRID_CELL_M); cy <= Math.floor(maxY / GRID_CELL_M); cy++) {
          const key = cellKey(cx, cy);
          const list = map.get(key);
          if (list) list.push(idx);
          else map.set(key, [idx]);
        }
      }
    });
    return map;
  }

  function edgesNear(p: XY, radiusM: number): EdgeHit[] {
    grid ??= buildGrid();
    const candidates = new Set<number>();
    for (let cx = Math.floor((p.x - radiusM) / GRID_CELL_M); cx <= Math.floor((p.x + radiusM) / GRID_CELL_M); cx++) {
      for (let cy = Math.floor((p.y - radiusM) / GRID_CELL_M); cy <= Math.floor((p.y + radiusM) / GRID_CELL_M); cy++) {
        for (const idx of grid.get(cellKey(cx, cy)) ?? []) candidates.add(idx);
      }
    }
    const hits: EdgeHit[] = [];
    for (const idx of candidates) {
      const edge = edges[idx];
      if (edge.pts.length < 2) continue;
      const proj = project(edge.pts, edge.cum, p);
      if (proj.d <= radiusM) hits.push({ edge: idx, d: proj.d, s: proj.s });
    }
    hits.sort((a, b) => a.d - b.d || a.edge - b.edge);
    return hits;
  }

  return {
    pathOfShape: (shapeIdx) => pathOfShapeIdx.get(shapeIdx) ?? null,
    pathGeometry,
    stopsOnPath,
    stopsOnPathGeometric,
    nextStopOnPath,
    edgesNear,
    toPathPoint(pathIdx, s) {
      const geo = pathGeometry(pathIdx);
      return at(geo.pts, geo.cum, s);
    },
    projectOntoPath(pathIdx, p) {
      const geo = pathGeometry(pathIdx);
      const proj = project(geo.pts, geo.cum, p);
      return { s: proj.s, d: proj.d };
    },
    projectionsOntoPath(pathIdx, p, sFrom, sTo, maxD) {
      const geo = pathGeometry(pathIdx);
      return projectionsWithin(geo.pts, geo.cum, p, sFrom, sTo, maxD).map((proj) => ({ s: proj.s, d: proj.d }));
    },
  };
}
