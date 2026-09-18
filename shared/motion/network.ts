// Decodes app/public/data/zet-network.json version 3 -- the artefact
// scripts/gtfs-shapes.mjs builds -- into an in-memory network shared by the
// app (the motion model, the schematic, the map) and the Worker (the twin's
// matcher and planner, R-TE15). The wire is struct-of-arrays with every point
// chain-delta-encoded as integer units against `origin`/`scale`; this file
// undoes exactly that, once, at load time.
//
// Version 3 (F8) adds the SERVED-STOP TABLE: every path carries `served`,
// the platforms its own trips call at, in arc order, and every stop carries
// `terminal`. The geometric `onEdge` links stay exactly as they were -- they
// are what the matcher and the city map's stop circles read -- but the
// engine (planner, laws, learner, speed estimator, publisher) now reads the
// served list through graph.ts's `stopsOnPath`, so it no longer books a
// dwell at the opposite-direction platform 3 m away or at another line's
// platform on the same rails.
//
// Version 2 (B1/B2) carries the tram RAIL GRAPH: directed `edges` shared by
// every line that runs them, every tram shape as an edge sequence, synthetic
// `paths` for tram patterns whose trips have no shape_id (line 1), stops with
// an exact arc on each tram edge (and a 1/500 fraction on each bus shape).
// The decoded `Network` stays a SUPERSET of version 1's: `shapes` are
// polylines again (a tram shape rebuilt from its edges), `stops[].on` names a
// stop's arc on every SHAPE (derived from its edges through every shape that
// runs them), `routes`, `diagram` and `nextStop` are unchanged, so the phase A
// client reads it as before. The graph itself -- `edges`, `paths` and the
// helpers of shared/motion/graph.ts -- is what the twin's engine reads.
//
// Fetched, not imported: loadNetwork pulls the ~500 KB artefact from
// /data/zet-network.json after first paint, never in lightweight mode (R-L4).

import { toPlane, type XY } from './geo';
import { cumulative } from './polyline';
import { graphMethods, type GraphMethods } from './graph';

export interface Edge {
  from: number;
  to: number;
  pts: XY[];
  /** Cumulative arc length at each point (see polyline.cumulative). */
  cum: number[];
  len: number;
}

export interface Shape {
  id: string;
  route: string;
  pts: XY[];
  cum: number[];
  len: number;
  /** GTFS direction_id of the shape's trips (0 or 1); -1 for a bus shape, which runs no graph. */
  direction?: number;
  /** The rail edges a tram shape runs, in order; absent for a bus shape. */
  edges?: number[];
}

/** A path over the rail graph: every tram shape is one, and every synthetic
 *  path (a shapeless pattern routed through its stops) is one more. */
export interface Path {
  /** The GTFS shape_id, or `path:<route>:<dir>:<hash>` for a synthetic path. */
  id: string;
  route: string;
  direction: number;
  /** The shape this path is, or null for a synthetic one. */
  shape: number | null;
  edges: number[];
  /** Arc at which each edge starts within the path. */
  offsets: number[];
  len: number;
  /** The stop sequence a synthetic path was routed through. */
  stops?: string[];
  /** The platforms this path's own trips call at, in arc order: the stop's
   *  index into `stops` and its arc along the path, metres (F8). Absent for a
   *  path the artefact carries no served list for, and then the geometric
   *  derivation stands in (graph.ts stopsOnPath). */
  served?: { stop: number; s: number }[];
}

export interface Stop {
  id: string;
  name: string;
  p: XY;
  /** Every shape this stop lies on, with its arc-length position on that
   *  shape (metres, in the same units as that shape's own `cum`). */
  on: { shape: number; s: number }[];
  /** Every rail edge this stop lies on, with its arc on that edge. */
  onEdge?: { edge: number; s: number }[];
  /** First or last stop of some trip in the feed: a terminus platform. */
  terminal: boolean;
}

export interface Network {
  version: number;
  feedVersion: string;
  routes: Map<string, { short: string; type: number; rank: number; shapes: number[] }>;
  shapes: Shape[];
  stops: Stop[];
  diagram: { lines: { route: string; pts: XY[] }[]; box: [number, number] };
  /** The stop a vehicle would next pass on this shape after arc length s. */
  nextStop(shapeIdx: number, s: number): { stop: Stop; s: number } | null;
}

/** The decoded artefact: the phase A network plus the rail graph. */
export interface GraphNetwork extends Network, GraphMethods {
  edges: Edge[];
  paths: Path[];
}

/** The only version this decoder understands. A cached artefact from a
 *  different build must never be decoded as if it were this one. */
export const SUPPORTED_VERSION = 3;

/** Thrown by decodeNetwork when `raw.version` is missing or does not match
 *  SUPPORTED_VERSION: a stale cached artefact fails loudly here rather than
 *  having its bytes silently misread. */
export class NetworkVersionError extends Error {
  readonly found: unknown;
  constructor(found: unknown) {
    super(`zet-network.json: unsupported artefact version ${JSON.stringify(found)}, expected ${SUPPORTED_VERSION}`);
    this.name = 'NetworkVersionError';
    this.found = found;
  }
}

// Must match BUS_ON_FRAC_SCALE in scripts/gtfs-shapes.mjs: a bus stop's
// fraction along a bus shape is quantised to 1/500 there.
const BUS_ON_FRAC_SCALE = 500;
// Tram stops carry decimetres along their edge on the wire.
const DECIMETRES_PER_METRE = 10;

interface RawNetworkArtefact {
  version: number;
  feedVersion: string;
  origin: [number, number];
  scale: number;
  routes: { id: string[]; short: string[]; type: number[]; rank: number[]; shapes: number[][] };
  edges: { from: number[]; to: number[]; d: number[][] };
  shapes: { id: string[]; route: string[]; dir: number[]; d: number[][]; e: number[][]; len: number[]; served: [number, number][][] };
  paths: { id: string[]; route: string[]; dir: number[]; e: number[][]; stops: string[][]; served: [number, number][][] };
  stops: { id: string[]; name: string[]; p: [number, number][]; on: [number, number][][]; onEdge: [number, number][][]; terminal: number[] };
  diagram: { lines: { route: string[]; pts: [number, number][][] }; box: [number, number] };
}

/** Inverse of chainEncodeXY in scripts/gtfs-shapes.mjs. */
function chainDecodeXY(flat: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < flat.length; i += 2) {
    x += flat[i];
    y += flat[i + 1];
    out.push([x, y]);
  }
  return out;
}

/** Edge points are one chain across the whole edges array (each edge's first
 *  point a delta from the previous edge's last), see decodeEdgeChain there. */
function decodeEdgeChain(dList: readonly (readonly number[])[]): [number, number][][] {
  const flat: number[] = [];
  for (const d of dList) flat.push(...d);
  const units = chainDecodeXY(flat);
  const out: [number, number][][] = [];
  let at = 0;
  for (const d of dList) {
    const count = d.length / 2;
    out.push(units.slice(at, at + count));
    at += count;
  }
  return out;
}

/** Chain-delta on the index within one stop's own list; the value stays as is. */
function decodeIndexed(wire: readonly (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = [];
  let idx = 0;
  for (const [dIdx, value] of wire) {
    idx += dIdx;
    out.push([idx, value]);
  }
  return out;
}

function flattenPairs(pairs: readonly (readonly number[])[]): number[] {
  const out: number[] = [];
  for (const [a, b] of pairs) out.push(a, b);
  return out;
}

/** Concatenates polylines that meet end to start, keeping the junction point once. */
function concatPolylines(parts: readonly (readonly XY[])[]): XY[] {
  const out: XY[] = [];
  for (const pts of parts) {
    for (let i = out.length === 0 ? 0 : 1; i < pts.length; i++) out.push(pts[i]);
  }
  return out;
}

export function decodeNetwork(raw: unknown): GraphNetwork {
  if (typeof raw !== 'object' || raw === null || !('version' in raw)) {
    throw new NetworkVersionError(undefined);
  }
  const version = (raw as { version: unknown }).version;
  if (version !== SUPPORTED_VERSION) {
    throw new NetworkVersionError(version);
  }
  const r = raw as RawNetworkArtefact;
  const [originLon, originLat] = r.origin;
  const scale = r.scale;
  const toPoint = (ux: number, uy: number): XY => toPlane(originLon + ux * scale, originLat + uy * scale);

  const routes = new Map<string, { short: string; type: number; rank: number; shapes: number[] }>();
  for (let i = 0; i < r.routes.id.length; i++) {
    routes.set(r.routes.id[i], { short: r.routes.short[i], type: r.routes.type[i], rank: r.routes.rank[i], shapes: r.routes.shapes[i] });
  }

  const edges: Edge[] = decodeEdgeChain(r.edges.d).map((units, i) => {
    const pts = units.map(([ux, uy]) => toPoint(ux, uy));
    const cum = cumulative(pts);
    return { from: r.edges.from[i], to: r.edges.to[i], pts, cum, len: cum[cum.length - 1] ?? 0 };
  });

  const shapes: Shape[] = r.shapes.id.map((id, i) => {
    const edgeSeq = r.shapes.e[i];
    if (edgeSeq.length > 0) {
      const pts = concatPolylines(edgeSeq.map((e) => edges[e].pts));
      const cum = cumulative(pts);
      return { id, route: r.shapes.route[i], pts, cum, len: cum[cum.length - 1] ?? 0, direction: r.shapes.dir[i], edges: edgeSeq };
    }
    const pts = chainDecodeXY(r.shapes.d[i]).map(([ux, uy]) => toPoint(ux, uy));
    return { id, route: r.shapes.route[i], pts, cum: cumulative(pts), len: r.shapes.len[i], direction: r.shapes.dir[i] };
  });

  // Paths: every tram shape (in shape order), then every synthetic path.
  const offsetsOf = (edgeSeq: readonly number[]): { offsets: number[]; len: number } => {
    const offsets: number[] = [];
    let len = 0;
    for (const e of edgeSeq) {
      offsets.push(len);
      len += edges[e].len;
    }
    return { offsets, len };
  };
  // A path's served list on the wire is [stopIdx, decimetres] pairs, already
  // in arc order; an empty list means the artefact knows of none, and the
  // geometric derivation stands in (graph.ts).
  const decodeServed = (wire: readonly (readonly [number, number])[] | undefined): { stop: number; s: number }[] | undefined => {
    if (!wire || wire.length === 0) return undefined;
    return wire.map(([stop, dm]) => ({ stop, s: dm / DECIMETRES_PER_METRE }));
  };
  const paths: Path[] = [];
  const pathOfShapeIdx = new Map<number, number>();
  shapes.forEach((shape, shapeIdx) => {
    if (!shape.edges) return;
    const { offsets, len } = offsetsOf(shape.edges);
    pathOfShapeIdx.set(shapeIdx, paths.length);
    const served = decodeServed(r.shapes.served?.[shapeIdx]);
    paths.push({ id: shape.id, route: shape.route, direction: shape.direction ?? 0, shape: shapeIdx, edges: shape.edges, offsets, len, ...(served ? { served } : {}) });
  });
  for (let i = 0; i < r.paths.id.length; i++) {
    const { offsets, len } = offsetsOf(r.paths.e[i]);
    const served = decodeServed(r.paths.served?.[i]);
    paths.push({ id: r.paths.id[i], route: r.paths.route[i], direction: r.paths.dir[i], shape: null, edges: r.paths.e[i], offsets, len, stops: r.paths.stops[i], ...(served ? { served } : {}) });
  }

  // A stop on an edge is on every shape that runs the edge, at the shape's
  // own offset of that edge plus the arc along it.
  const edgeInShapes = new Map<number, { shape: number; offset: number }[]>();
  shapes.forEach((shape, shapeIdx) => {
    if (!shape.edges) return;
    const { offsets } = offsetsOf(shape.edges);
    shape.edges.forEach((e, k) => {
      const list = edgeInShapes.get(e);
      const entry = { shape: shapeIdx, offset: offsets[k] };
      if (list) list.push(entry);
      else edgeInShapes.set(e, [entry]);
    });
  });

  const stopUnits = chainDecodeXY(flattenPairs(r.stops.p));
  const stops: Stop[] = r.stops.id.map((id, i) => {
    const [ux, uy] = stopUnits[i];
    const onEdge = decodeIndexed(r.stops.onEdge[i]).map(([edge, dm]) => ({ edge, s: dm / DECIMETRES_PER_METRE }));
    const on: { shape: number; s: number }[] = [];
    for (const [shapeIdx, scaled] of decodeIndexed(r.stops.on[i])) {
      // Against the rebuilt arc, never the wire len: nextStop compares arcs in cum units.
      const shapeCum = shapes[shapeIdx].cum;
      on.push({ shape: shapeIdx, s: (scaled / BUS_ON_FRAC_SCALE) * (shapeCum[shapeCum.length - 1] ?? 0) });
    }
    for (const link of onEdge) {
      for (const { shape, offset } of edgeInShapes.get(link.edge) ?? []) on.push({ shape, s: offset + link.s });
    }
    on.sort((a, b) => a.shape - b.shape || a.s - b.s);
    return { id, name: r.stops.name[i], p: toPoint(ux, uy), on, onEdge, terminal: r.stops.terminal?.[i] === 1 };
  });

  const diagram = {
    lines: r.diagram.lines.route.map((route, i) => ({ route, pts: r.diagram.lines.pts[i].map(([x, y]) => ({ x, y })) })),
    box: r.diagram.box,
  };

  // Per-shape, arc-sorted stop lists for nextStop's binary search.
  const byShape: { stop: Stop; s: number }[][] = shapes.map(() => []);
  for (const stop of stops) {
    for (const { shape: shapeIdx, s } of stop.on) {
      if (shapeIdx >= 0 && shapeIdx < byShape.length) byShape[shapeIdx].push({ stop, s });
    }
  }
  for (const list of byShape) list.sort((a, b) => a.s - b.s);

  function nextStop(shapeIdx: number, s: number): { stop: Stop; s: number } | null {
    const list = byShape[shapeIdx];
    if (!list || list.length === 0) return null;
    // Upper bound: the first entry strictly after s -- a vehicle sitting
    // exactly at a stop has already reached it.
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].s > s) hi = mid;
      else lo = mid + 1;
    }
    if (lo >= list.length) return null;
    return { stop: list[lo].stop, s: list[lo].s };
  }

  return {
    version: r.version,
    feedVersion: r.feedVersion,
    routes,
    shapes,
    stops,
    diagram,
    nextStop,
    edges,
    paths,
    ...graphMethods(edges, paths, stops, pathOfShapeIdx),
  };
}

const NETWORK_URL = '/data/zet-network.json';

/**
 * Fetches /data/zet-network.json once, after first paint, and never in
 * lightweight mode. Returns null in lightweight mode without issuing a
 * request (R-L4), and null on any failure (a bad status, a network error, a
 * body that fails to decode, including a stale cached artefact rejected by
 * version), so every caller has exactly one fallback path to write.
 */
export async function loadNetwork(fetchImpl: typeof fetch = fetch, lightweight = false): Promise<GraphNetwork | null> {
  if (lightweight) return null;
  try {
    const res = await fetchImpl(NETWORK_URL);
    if (!res.ok) return null;
    const raw = await res.json();
    return decodeNetwork(raw);
  } catch {
    return null;
  }
}
