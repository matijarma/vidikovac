// Decodes app/public/data/zet-network.json -- the artefact
// scripts/gtfs-shapes.mjs builds -- into an in-memory Network the motion
// model (T5, T6) and the schematic (T7+) read from. The wire format is
// struct-of-arrays (toColumnar in the builder script) with every point
// chain-delta-encoded as integer units against `origin`/`scale`; this file
// undoes exactly that, once, at load time, so nothing downstream ever
// touches the wire encoding again.
//
// Fetched, not imported (decision 2 in the area preamble): loadNetwork pulls
// this from /data/zet-network.json rather than the module graph, so the
// ~500 KB artefact never lands in an entry chunk (R-L4) and never loads at
// all in lightweight mode.

import { toPlane, type XY } from './geo';
import { cumulative } from './polyline';

export interface Shape {
  id: string;
  route: string;
  pts: XY[];
  /** Cumulative arc length at each point (see polyline.cumulative). */
  cum: number[];
  len: number;
}

export interface Stop {
  id: string;
  name: string;
  p: XY;
  /** Every shape this stop lies on, with its arc-length position on that
   *  shape (metres, in the same units as that shape's own `cum`). */
  on: { shape: number; s: number }[];
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

/** The only version this decoder understands. A cached artefact from a
 *  different build (a different point/stop encoding) must never be decoded
 *  as if it were this one -- see NetworkVersionError. */
export const SUPPORTED_VERSION = 1;

/** Thrown by decodeNetwork when `raw.version` is missing or does not match
 *  SUPPORTED_VERSION. A stale cached artefact (an old service-worker cache,
 *  a CDN edge that didn't purge) must fail loudly here rather than have its
 *  bytes silently misread as a different encoding and draw nonsense. */
export class NetworkVersionError extends Error {
  readonly found: unknown;
  constructor(found: unknown) {
    super(`zet-network.json: unsupported artefact version ${JSON.stringify(found)}, expected ${SUPPORTED_VERSION}`);
    this.name = 'NetworkVersionError';
    this.found = found;
  }
}

// Must match ON_FRAC_SCALE in scripts/gtfs-shapes.mjs: a stop's fraction
// along a shape is quantised to the nearest 1/50th there and reconstructed
// against that same denominator here. Not carried in the artefact itself
// (unlike origin/scale below) because it only ever governs this one
// encoding choice, not the coordinate system; see geo.ts's PROJECTION_LAT_DEG
// for the same wire-boundary-constant pattern.
const ON_FRAC_SCALE = 50;

// The wire shape this module decodes, exactly as buildNetwork in
// scripts/gtfs-shapes.mjs writes it (struct-of-arrays; see toColumnar
// there). Kept private and loose (numbers, not branded types) because its
// only job is describing the untrusted `unknown` input after the version
// gate below has passed.
interface RawNetworkArtefact {
  version: number;
  feedVersion: string;
  origin: [number, number];
  scale: number;
  routes: { id: string[]; short: string[]; type: number[]; rank: number[]; shapes: number[][] };
  shapes: { id: string[]; route: string[]; d: number[][]; len: number[] };
  stops: { id: string[]; name: string[]; p: [number, number][]; on: [number, number][][] };
  diagram: { lines: { route: string[]; pts: [number, number][][] }; box: [number, number] };
}

/**
 * Inverse of chainEncodeXY in scripts/gtfs-shapes.mjs: `flat` is a flat
 * sequence of (dx, dy) pairs, each a delta from the previous point (the
 * first from (0, 0)); returns the running-sum absolute [x, y] integer
 * units, one pair per input pair, in the same order.
 */
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

/** Inverse of the stop `on` encoding: chain-deltas the shape index within
 *  this one stop's own list (resetting at 0), and undoes the ON_FRAC_SCALE
 *  quantisation, returning absolute [shapeIdx, frac (0..1)] pairs. */
function decodeStopOn(wireOn: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let idx = 0;
  for (const [dIdx, scaledFrac] of wireOn) {
    idx += dIdx;
    out.push([idx, scaledFrac / ON_FRAC_SCALE]);
  }
  return out;
}

/** Flattens an array of [a, b] pairs into a plain [a, b, a, b, ...] array. */
function flattenPairs(pairs: readonly (readonly number[])[]): number[] {
  const out: number[] = [];
  for (const [a, b] of pairs) out.push(a, b);
  return out;
}

/**
 * Undoes the network artefact's delta encoding, converts every point to the
 * local metre plane (geo.ts's toPlane) once, and precomputes each shape's
 * cumulative arc length -- so nothing downstream (the motion model, the
 * schematic) ever has to re-decode or re-derive this. Validates
 * `raw.version` first and throws NetworkVersionError otherwise, because a
 * stale cached artefact must fail loudly rather than draw nonsense.
 */
export function decodeNetwork(raw: unknown): Network {
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
    routes.set(r.routes.id[i], {
      short: r.routes.short[i],
      type: r.routes.type[i],
      rank: r.routes.rank[i],
      shapes: r.routes.shapes[i],
    });
  }

  const shapes: Shape[] = r.shapes.id.map((id, i) => {
    const units = chainDecodeXY(r.shapes.d[i]);
    const pts = units.map(([ux, uy]) => toPoint(ux, uy));
    return { id, route: r.shapes.route[i], pts, cum: cumulative(pts), len: r.shapes.len[i] };
  });

  // Stop positions are chain-delta-encoded across the WHOLE stops array (one
  // running sum, not reset per stop -- see buildNetwork's stopPChain), so
  // they are decoded the same way: flatten every stop's [dx, dy] pair in
  // array order, then one chainDecodeXY over the lot.
  const stopUnits = chainDecodeXY(flattenPairs(r.stops.p));
  const stops: Stop[] = r.stops.id.map((id, i) => {
    const [ux, uy] = stopUnits[i];
    const onAbs = decodeStopOn(r.stops.on[i]);
    // A stop's wire fraction is relative to its own shape's length; turned
    // into an arc length in the same metres as that shape's own `cum` here,
    // once, so nextStop below (and the motion model after it) never has to
    // convert a fraction again or reconcile it against a different length
    // than the one its own binary search runs over.
    const on = onAbs.map(([shapeIdx, frac]) => {
      const shapeLen = shapes[shapeIdx]?.cum[shapes[shapeIdx].cum.length - 1] ?? 0;
      return { shape: shapeIdx, s: frac * shapeLen };
    });
    return { id, name: r.stops.name[i], p: toPoint(ux, uy), on };
  });

  const diagram = {
    lines: r.diagram.lines.route.map((route, i) => ({
      route,
      pts: r.diagram.lines.pts[i].map(([x, y]) => ({ x, y })),
    })),
    box: r.diagram.box,
  };

  // Per-shape, arc-length-sorted stop lists for nextStop's binary search.
  // Built once here rather than searched for on every call.
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
    // Upper bound: the first entry strictly after s. A vehicle sitting
    // exactly at a stop (s === that stop's own arc length) has already
    // reached it -- the "next" one is the one after, never the one it is
    // sitting on (decision: "never show or care about the reported
    // position" extends to "never re-announce the stop already reached").
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
  };
}

const NETWORK_URL = '/data/zet-network.json';

/**
 * Fetches /data/zet-network.json once, after first paint, and never in
 * lightweight mode. Returns null in lightweight mode without issuing a
 * request (R-L4), and null on any failure -- a bad HTTP status, a network
 * error, or a body that fails to decode (including a stale cached artefact
 * decodeNetwork rejects by version) -- so every caller has exactly one
 * fallback path to write. "Once, after first paint" describes how the
 * caller is expected to use this (call it a single time after mount, never
 * from the entry chunk's own module graph); this function itself does not
 * memoise, since no caller in this wave exists yet to depend on that.
 */
export async function loadNetwork(fetchImpl: typeof fetch = fetch, lightweight = false): Promise<Network | null> {
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
