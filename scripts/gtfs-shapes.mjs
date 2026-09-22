#!/usr/bin/env node
// Builds app/public/data/zet-network.json version 3 -- the tram rail GRAPH
// (directed edges shared by every line that runs them), every tram shape as
// a sequence of those edges, synthetic paths for tram patterns whose trips
// carry no shape_id (line 1), bus shapes as plain simplified polylines, stops
// with an exact arc on every tram edge and bus shape they sit on, and the
// octilinear schematic diagram -- plus the plain-constant summary
// app/src/motion/network-meta.ts, from ZET's static GTFS feed.
//
// Why a graph (plan "Static data -> Network artefact v2", R-TE11): ZET draws
// all 78 tram shapes from ONE rail centreline point set -- 98 % of shape
// segments are shared bit-for-bit across lines and the two directions of a
// line are separate tracks 3 to 6 m apart. So an edge is simply a maximal run
// of segments that exactly the same set of lines traverse, cut wherever that
// set changes or a third track attaches; no fuzzy merging is needed beyond a
// snapping pass for the 2 % of near-duplicate digitisations of one track.
// The twin (worker/do/twin-do.ts) map-matches trams onto these edges and
// keeps their order per edge; the client draws along the same geometry.
//
// Version 3 (F8) adds the SERVED-STOP TABLE. The geometric 40 m stop links
// below say which platforms a rail edge PASSES; they never said which ones a
// line CALLS AT, and on ZET's geometry the two differ by a factor of three
// (the opposite direction's platform lies 3 to 6 m away, other lines'
// platforms sit on the shared trunk, three platforms stand within a metre at
// Ljubijska). So every path now also carries `served`: the platforms the
// trips that run it actually call at, in arc order, read from stop_times --
// the union over every trip of a shape_id, and its own routed stop sequence
// for a synthetic path. Stops carry `terminal`, true where some trip starts
// or ends. The geometric `onEdge` links stay exactly as they were: the
// matcher and the city map's stop circles read those.
//
// Terminus loops and connectors (WP0, September 2026): where a trip ends at
// one platform and the route's next trip starts at another close by, and the
// rails between them are drawn, a `loop:` path (direction LOOP_DIRECTION)
// runs from the one path's last edge to the other's first; a turn no shape
// draws and no crossing can express comes from gtfs-shapes-overrides.json
// `connectors` as one directed edge (Glavni kolodvor). Every platform a
// shape's own trips call at must lie on that shape, or the build stops
// (servedGaps).
//
// Reuses the zero-dependency zip reader and CSV parser from gtfs-routes.mjs;
// run locally with `npm run build:network` (or `-- --zip <archive> --built-at
// <its Last-Modified>` to build from a downloaded archive) and commit both
// generated files.
// The Worker never downloads the 15 MB archive -- a local build step, and the
// trip index (scripts/gtfs-trips.mjs) must be cut from the same feed version
// (R-TE16: `npm run build:network && npm run build:trips`).
//
// Attribution obligation (Otvorena dozvola, ZET) carries over unchanged;
// see ZET_ATTRIBUTION in gtfs-routes.mjs.
import { createHash } from 'node:crypto';
import { createInflateRaw } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { compareRouteIds, extractEntry, localFileDataOffset, parseCsv, readZipEntries } from './gtfs-routes.mjs';

export const GTFS_URL = 'https://www.zet.hr/gtfs-scheduled/latest';
export const OUTPUT_PATH = 'app/public/data/zet-network.json';
export const META_OUTPUT_PATH = 'app/src/motion/network-meta.ts';
// Build-time overrides, read from the script's own directory: the allowlist
// of platforms the rail graph cannot reach (see the file's own _comment).
export const OVERRIDES_PATH = 'scripts/gtfs-shapes-overrides.json';

/** The wire version shared/motion/network.ts decodes; a cached version 2
 *  artefact must fail loudly there, never be misread. */
export const ARTEFACT_VERSION = 3;

const DOWNLOAD_TIMEOUT_MS = 60_000; // build-time download of a >10 MB archive, not a live request
const USER_AGENT = 'Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)';

// The artefact's delta-encoding origin and unit: every lon/lat in the file is
// stored as an integer (value - origin) / scale. 1e-5 deg is a ~1.1 m quantum
// at Zagreb's latitude -- the feed's own precision, and the quantum the rail
// graph is built on: two shapes share a segment when both quantised endpoints
// coincide.
export const ORIGIN = [15.9, 45.75]; // lon, lat
export const SCALE = 1e-5; // degrees per integer unit

// The equirectangular projection used ONLY for internal metre-space work
// (Douglas-Peucker, arc length, the 40 m stop radius, the snap distance, the
// octilinear diagram): a single cos(lat) factor around Zagreb's own latitude.
const PROJECTION_LAT_DEG = 45.8;
const EARTH_RADIUS_M = 6378137; // WGS84 equatorial radius; good enough at this scale
const DEG2RAD = Math.PI / 180;
const COS_LAT0 = Math.cos(PROJECTION_LAT_DEG * DEG2RAD);

// Simplify edge interiors and bus shapes at 5 m: well above the ~1.1 m
// coordinate quantum, so simplification error is never confused with
// quantisation noise. Edge endpoints (the graph's nodes) are always kept.
export const SIMPLIFY_METRES = 5;
// A stop is linked to an edge or a bus shape when it passes within 40 m of it.
export const STOP_SHAPE_MAX_METRES = 40;
// How far off a path a stop stop_times SAY it serves may lie and still be
// placed on it (F8). A stop that the timetable says is served IS served: the
// question is only where on the path to put it, not whether it belongs. 60 m
// is the matcher's own NEAR_M (shared/motion/match.ts) -- a fix within 60 m of
// an edge is taken to be on that edge, so a platform within 60 m of the rails
// it is served from is on them too. Wider than the 40 m geometric radius on
// purpose: that radius answers "which platforms does this track pass", which
// must stay tight or every line's stop list fills with its neighbours', while
// this one answers "where does THIS line's own stop sit", which the feed has
// already settled. Olipska 251_2 is the case that set it: 42.8 m from the
// rails of lines 2, 3, 13 and 33, every one of which calls there.
export const SERVED_STOP_MAX_METRES = 60;
// The first and last stop of a shapeless pattern may sit further from the
// rails any shape draws: a terminus platform served only by that line has
// no shape of its own in the feed (line 1 at Zapadni kolodvor, 168 m past
// the last drawn rail). Up to 200 m such a stop is linked to the nearest
// edge, the way the trip-endpoint override links a shaped route's terminus;
// an interior stop that far off the graph is a data error and fails the build.
export const TERMINUS_STOP_MAX_METRES = 200;
// How many stops a synthetic path may drop at either end when the rails
// there are drawn by no shape at all: one terminus and the stop after it,
// which is how far line 1 runs on its own rails out of Zapadni kolodvor.
export const TERMINUS_TRIM_STOPS = 2;
// A hop between two consecutive stops of a shapeless pattern should run about
// the way the street does. Over feed 000395's 984 such hops the routed chain
// is at most 1.78x the straight line between the two platforms and at most
// 189 m longer than it; the nine that come out 4.2 to 6.4x and 1.5 to 2.7 km
// longer are all one thing -- the rail graph has no node where the line
// turns, because no shape in the feed draws that turn, so the router goes the
// long way round (Botanicki vrt to Zrinjevac on six paths of routes 6, 9 and
// 17, which is how the artefact has stood since F8, and Subiceva to Trg
// zrtava fasizma on three of route 13, where Subiceva street crosses Kralja
// Zvonimira mid-edge and only the night line's two shapes draw the corridor).
// The build REPORTS those hops by name -- the honest measure of what the
// feed's shapes fail to draw -- and, since F8c, FAILS on any leg that is not
// named with its reason in gtfs-shapes-overrides.json longLegs (route-scoped):
// a silent detour would route every plan on that path the long way round.
export const HOP_DETOUR_FACTOR = 2; // past twice the straight line...
export const HOP_DETOUR_EXCESS_METRES = 500; // ...and past half a kilometre longer
// A turn no shape draws AND no crossing can express: two tracks that end and
// start a few metres apart without ever meeting (Glavni kolodvor, where the
// eastbound Mihanoviceva track ends 6.79 m short of the northbound Trg kralja
// Tomislava track). The overrides file names such a turn as a `connector`, a
// directed edge from one existing node to another; the build finds each node
// by its measured coordinate within CONNECTOR_SNAP_METRES and refuses a
// connector whose point matches no node, or more than one. 2.5 m is
// SNAP_METRES: under half the 3 to 6 m between a line's two tracks, so the
// point can never land on the opposite track's node.
export const CONNECTOR_SNAP_METRES = 2.5;
// Terminus loop paths. A tram that ends its trip at one platform and starts
// the next from another a few hundred metres away runs a loop or a reversing
// track between them that no trip's pattern names, so no path carries it and
// the matcher had only other lines' paths to put it on (441 of 441 foreign
// adoptions on Sunday 20 Sep had an empty own-route pool, 351 of them within
// 150 m of a terminal). For every tram route and every pair (L, F) of a
// path's last served platform L and another path's first served platform F,
// L != F, no more than LOOP_PAIR_MAX_METRES apart (59 such pairs on feed
// 000395, 0 to 354 m apart), the build routes over the directed graph from
// the end of the arriving path's last edge to the start of the departing
// path's first edge; what it finds becomes a path `loop:<route>:<hash>` with
// direction LOOP_DIRECTION, stops [L, F] and those of the two platforms that
// lie on it as its served list. Its first edge is the arriving path's last
// edge and its last edge the departing path's first, so a tram on the loop
// stays on its own line's rails from one trip to the next. The loop has to be
// DRAWN: at most termini of feed 000395 (Borongaj, Žitnjak, Savišće,
// Črnomerec, Ljubljanica, Prečko, Savski most, Park Maksimir, Sopot,
// Gračansko dolje) the arriving shape ends and the departing one starts 40 to
// 255 m apart with no track between, and the pair is skipped by name ("no
// directed route"). A route longer than LOOP_MAX_METRES is a detour through
// the network, not the loop (Zapruđe: 9.3 km round), and is skipped as well;
// the cap admits Ravnice, 1,370 m, where route 4's short workings turn round
// the Dubrava loop.
export const LOOP_DIRECTION = -1;
export const LOOP_ID_PREFIX = 'loop:';
export const LOOP_PAIR_MAX_METRES = 400;
export const LOOP_MAX_METRES = 1500;
// How much of the two boundary edges a loop keeps: from this far before the
// arriving platform to this far past the departing one (along the rails, from
// where the platform projects). The rest of a long boundary edge (3.3 km into
// Mihaljevac, 3.2 km out of Dubec) is no part of the turn, so the edge is cut
// there and the loop runs only the terminal end. 70 m holds a 32 m tram
// standing at the platform, and puts the new node past SERVED_STOP_MAX_METRES
// from the platform, so no link of it lands on the node; the cut then moves
// further out until every platform served over that edge is
// LOOP_CUT_CLEAR_METRES away. A boundary edge that would keep less than
// LOOP_CUT_MIN_METRES on the far side is kept whole: a sliver buys nothing.
export const LOOP_LEAD_METRES = 70;
export const LOOP_CUT_CLEAR_METRES = 65;
export const LOOP_CUT_MIN_METRES = 10;
// F8c NODES those crossings, one reported leg at a time. The search is
// deliberately narrow, because a node where two tracks cross grows turns in
// every direction and the graph must not sprout turns no tram takes:
// only edges that pass within JUNCTION_SEARCH_METRES of one of the leg's own
// two platforms are considered (on feed 000395 the rail a line turns onto is
// at most 60 m from the platform, and Subiceva 163_2 is 59.9 m from the
// street it comes down -- 120 m is that with room to spare and still local),
// and a candidate junction survives only if some path then actually turns
// there (see the prune pass in buildNetwork).
export const JUNCTION_SEARCH_METRES = 120;
// Below this the two polylines are not a street crossing but two
// digitisations of one corridor brushing past each other: on feed 000395 the
// two Kralja Zvonimira tracks "cross" at 6.8 and 8.1 degrees a kilometre and
// a half east of anything, while every real crossing the reported legs need
// meets at 48 to 50 degrees.
export const JUNCTION_MIN_ANGLE_DEG = 20;
// Two polylines that cross TWICE within this distance swap sides rather than
// meet: the two Zvonimira tracks cross and cross back over 9 m at Subiceva,
// the two Mihanoviceva tracks over 2 m at Botanicki vrt. Neither is a
// junction, and noding one would offer the router a crossover no tram uses.
// Thirty metres is the same length SNAP_MIN_RUN_METRES calls "a shared
// stretch worth an edge".
export const JUNCTION_TWIN_CROSSING_METRES = 30;
// The split point is the exact segment-segment intersection, rounded to the
// artefact's own 1e-5 deg lattice -- the only coordinates the graph and the
// wire can express. The rounding moves it at most half a cell in each axis,
// so it still lies on both polylines to within HALF a cell's diagonal
// (0.68 m at Zagreb's latitude, under the 1.1 m quantum the whole rail graph
// is built on). The build measures the offset for every junction it makes
// and refuses a larger one, which would mean the intersection did not lie on
// the segments the junction names.
export const JUNCTION_MAX_OFFSET_METRES = 0.5 * Math.hypot(SCALE * DEG2RAD * COS_LAT0 * EARTH_RADIUS_M, SCALE * DEG2RAD * EARTH_RADIUS_M);
// The diagram's second simplification pass, after the octilinear snap.
export const DIAGRAM_SIMPLIFY_METRES = 120;

// The snapping pass for near-duplicate digitisations of one track: a run of
// one shape's vertices all within 2.5 m of an earlier shape's polyline, in
// the same direction, sustained over at least 30 m, is replaced by that
// polyline so the two share segments exactly. 2.5 m is under half the
// measured 3 to 6 m between a line's two directions (which the direction
// test excludes anyway) and well over the 1.1 m quantum; 30 m is longer than
// any at-grade crossing's brush with another track, which touches at one
// point, and shorter than the shortest real shared stretch worth an edge.
export const SNAP_METRES = 2.5;
export const SNAP_MIN_RUN_METRES = 30;

// Bus stops link to bus shapes as a fraction of the shape's own simplified
// length, quantised to 1/500: on a 1 to 20 km bus shape that is 2 to 40 m of
// arc error, enough for the stop gate and the planner's dwell on a vehicle
// that runs no graph and obeys no ordering law, while exact decimetres for
// the ~19,500 bus links would cost about 60 KB of raw budget the tram graph
// does not save (R-TE11). Tram stops get exact decimetres on their edges.
export const BUS_ON_FRAC_SCALE = 500;

// Column order for the struct-of-arrays wire format (see toColumnar).
export const ROUTE_KEYS = ['id', 'short', 'type', 'rank', 'shapes'];
export const EDGE_KEYS = ['from', 'to', 'd'];
export const SHAPE_KEYS = ['id', 'route', 'dir', 'd', 'e', 'len', 'served'];
export const PATH_KEYS = ['id', 'route', 'dir', 'e', 'stops', 'served'];
export const STOP_KEYS = ['id', 'name', 'p', 'on', 'onEdge', 'terminal'];
export const LINE_KEYS = ['route', 'pts'];
// Diagram legibility cut: every tram route, plus this many of the busiest
// bus routes by trip count (19 trams + the top 20 buses mirrors how ZET's own
// printed network map picks its "trunk" lines).
export const DIAGRAM_BUS_COUNT = 20;

/** Converts lon/lat degrees to a local metre-space plane (translation
 *  doesn't matter here: only used for distances, lengths and angles). */
export function toMetres(lon, lat) {
  return { x: lon * DEG2RAD * COS_LAT0 * EARTH_RADIUS_M, y: lat * DEG2RAD * EARTH_RADIUS_M };
}

function deltaEncode(value, origin) {
  return Math.round((value - origin) / SCALE);
}

/** An integer unit pair back to the metre plane. */
function unitsToMetres([x, y]) {
  return toMetres(ORIGIN[0] + x * SCALE, ORIGIN[1] + y * SCALE);
}

/** The inverse: a metre-plane point onto the artefact's integer lattice.
 *  Lossy by up to half a cell in each axis -- the quantum every coordinate in
 *  this file already carries (JUNCTION_MAX_OFFSET_METRES). */
function unitsFromMetres(p) {
  const lon = p.x / (DEG2RAD * COS_LAT0 * EARTH_RADIUS_M);
  const lat = p.y / (DEG2RAD * EARTH_RADIUS_M);
  return [deltaEncode(lon, ORIGIN[0]), deltaEncode(lat, ORIGIN[1])];
}

/**
 * True delta (chain) encoding of a sequence of integer (x, y) units: every
 * point is stored as its difference from the *previous* point, the first
 * against (0, 0). Consecutive points are typically tens to a few hundred
 * metres apart -- far smaller numbers than their offset from ORIGIN -- which
 * is what keeps the artefact inside its byte budget. Lossless.
 */
export function chainEncodeXY(unitsList) {
  const out = [];
  let px = 0;
  let py = 0;
  for (const [x, y] of unitsList) {
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out;
}

/** Inverse of chainEncodeXY: returns the original [x, y] integer pairs. */
export function chainDecodeXY(flat) {
  const out = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < flat.length; i += 2) {
    x += flat[i];
    y += flat[i + 1];
    out.push([x, y]);
  }
  return out;
}

/** Edge geometry is one chain across the WHOLE edges array (each edge's
 *  first point is a delta from the previous edge's last point), so a
 *  junction where one edge starts where another ends costs two zeros, not a
 *  coordinate. Returns the absolute [x, y] units per edge. */
export function decodeEdgeChain(dList) {
  const flat = [];
  for (const d of dList) flat.push(...d);
  const units = chainDecodeXY(flat);
  const out = [];
  let at = 0;
  for (const d of dList) {
    const count = d.length / 2;
    out.push(units.slice(at, at + count));
    at += count;
  }
  return out;
}

/** Inverse of the bus-shape `on` encoding: absolute [shapeIdx, frac] pairs. */
export function decodeStopOn(wireOn) {
  const out = [];
  let idx = 0;
  for (const [dIdx, scaledFrac] of wireOn) {
    idx += dIdx;
    out.push([idx, scaledFrac / BUS_ON_FRAC_SCALE]);
  }
  return out;
}

/** Inverse of the tram-edge `onEdge` encoding: absolute [edgeIdx, metres] pairs. */
export function decodeStopOnEdge(wireOn) {
  const out = [];
  let idx = 0;
  for (const [dIdx, decimetres] of wireOn) {
    idx += dIdx;
    out.push([idx, decimetres / 10]);
  }
  return out;
}

/** FNV-1a (32-bit) of the stop sequence, eight hex digits: names a synthetic
 *  path by what it visits, stable across builds of the same pattern. */
export function stopSequenceHash(stopIds) {
  let h = 0x811c9dc5;
  const text = stopIds.join(',');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** A stable name for the rail graph itself: SHA-256 over the ordered edges'
 *  endpoints and their polylines exactly as the wire carries them, truncated
 *  to GRAPH_HASH_HEX_CHARS. It changes whenever an edge is added, removed,
 *  split or re-drawn -- which is exactly when an edge INDEX stops meaning
 *  what it meant, so everything keyed by one (the twin's `edge_time`) must be
 *  thrown away. 16 hex digits is 64 bits: a collision between two builds of
 *  one city's rail graph is not a risk worth more bytes.
 *  @param {readonly {from: number, to: number, d: readonly number[]}[]} edges */
export const GRAPH_HASH_HEX_CHARS = 16;
export function graphHashOf(edges) {
  const hash = createHash('sha256');
  for (const e of edges) hash.update(`${e.from}:${e.to}:${e.d.join(',')}
`);
  return hash.digest('hex').slice(0, GRAPH_HASH_HEX_CHARS);
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function round4(x) {
  return Math.round(x * 10000) / 10000;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/**
 * Struct-of-arrays transposition: a row-major array of objects into a
 * column-major object of arrays, one array per key, index-aligned. Repeating
 * each object's key names on every row would cost tens of kilobytes of raw
 * JSON that carries no information; fromColumnar is the exact inverse.
 */
export function toColumnar(rows, keys) {
  const out = {};
  for (const key of keys) out[key] = rows.map((row) => row[key]);
  return out;
}

/** Inverse of toColumnar: rebuilds the row-major array of objects. */
export function fromColumnar(columns, keys) {
  const length = keys.length > 0 ? columns[keys[0]].length : 0;
  const rows = [];
  for (let i = 0; i < length; i++) {
    const row = {};
    for (const key of keys) row[key] = columns[key][i];
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Douglas-Peucker, on plane points, used for edge interiors and bus shapes
// (5 m) and, applied a second time to the octilinear diagram, at 120 m.

function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = clamp01(t);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Indices to keep, always including both endpoints. */
export function dpIndices(points, tolerance) {
  if (points.length < 3) return points.map((_, i) => i);
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop();
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = pointSegmentDistance(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > tolerance) {
      keep[maxIdx] = true;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }
  const indices = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) indices.push(i);
  return indices;
}

function cumulative(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return cum;
}

function bboxExpanded(points, margin) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX: minX - margin, maxX: maxX + margin, minY: minY - margin, maxY: maxY + margin };
}

function inBbox(p, bb) {
  return p.x >= bb.minX && p.x <= bb.maxX && p.y >= bb.minY && p.y <= bb.maxY;
}

function bboxesOverlap(a, b) {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/** Nearest point on a polyline (given its cumulative arc length), returning
 *  the perpendicular distance, the arc length at the nearest point, the
 *  segment index and the fraction along that segment. */
/** Where two plane segments cross, or null: `t`/`u` the fractions along a->b
 *  and c->d, `angle` the (acute) angle between them in degrees. Parallel
 *  segments never cross here, which is what we want -- two digitisations of
 *  one track must not become a junction. */
function segmentIntersection(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (den === 0) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  const deg = (Math.abs(Math.atan2(den, r.x * s.x + r.y * s.y)) * 180) / Math.PI;
  return { p: { x: a.x + t * r.x, y: a.y + t * r.y }, t, u, angle: Math.min(deg, 180 - deg) };
}

/** Every point at which two polylines cross, with the arc on each and the
 *  crossing angle. Quadratic in the segment counts, which is why the callers
 *  narrow the edge set to a leg's own neighbourhood first. */
function polylineCrossings(planeA, cumA, planeB, cumB) {
  const out = [];
  for (let i = 1; i < planeA.length; i++) {
    for (let j = 1; j < planeB.length; j++) {
      const hit = segmentIntersection(planeA[i - 1], planeA[i], planeB[j - 1], planeB[j]);
      if (!hit) continue;
      out.push({
        p: hit.p,
        angle: hit.angle,
        arcA: cumA[i - 1] + hit.t * (cumA[i] - cumA[i - 1]),
        arcB: cumB[j - 1] + hit.u * (cumB[j] - cumB[j - 1]),
        segA: i - 1,
        segB: j - 1,
      });
    }
  }
  return out;
}

function nearestOnPolyline(p, points, cum) {
  let best = Infinity;
  let bestArc = 0;
  let bestSeg = 0;
  let bestT = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq);
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    const d = Math.hypot(p.x - projX, p.y - projY);
    if (d < best) {
      best = d;
      bestArc = cum[i - 1] + t * Math.hypot(dx, dy);
      bestSeg = i - 1;
      bestT = t;
    }
  }
  return { dist: best, arc: bestArc, seg: bestSeg, t: bestT };
}

// ---------------------------------------------------------------------------
// The rail graph (B1).

const unitKey = (u) => `${u[0]},${u[1]}`;
const segmentKey = (a, b) => `${unitKey(a)}>${unitKey(b)}`;

/** A shape's digitisation noise a single-ended tram cannot run: an immediate
 *  reversal (a, b, a: out to a vertex and straight back) and a loop that
 *  returns to the same point within SPIKE_LOOP_METRES. Left in, such a run
 *  fragments a corridor every line shares into runs no other line has, one
 *  spike at a time. A real terminus loop is hundreds of metres long and
 *  never returns to a point it already left within thirty. */
const SPIKE_LOOP_METRES = 30;

function collapseSpikes(units) {
  let out = units.map((u) => [u[0], u[1]]);
  let removed = 0;
  // Immediate reversals, repeated until none is left (a spike can nest).
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 1; i + 1 < out.length; i++) {
      if (unitKey(out[i - 1]) === unitKey(out[i + 1])) {
        out.splice(i, 2);
        removed += 2;
        changed = true;
        break;
      }
    }
  }
  // Small loops: the path comes back to a point it left less than
  // SPIKE_LOOP_METRES ago; everything between goes.
  for (let i = 0; i < out.length; i++) {
    let length = 0;
    for (let j = i + 1; j < out.length; j++) {
      const a = unitsToMetres(out[j - 1]);
      const b = unitsToMetres(out[j]);
      length += Math.hypot(b.x - a.x, b.y - a.y);
      if (length > SPIKE_LOOP_METRES) break;
      if (unitKey(out[j]) === unitKey(out[i])) {
        out.splice(i + 1, j - i);
        removed += j - i;
        j = i;
        length = 0;
      }
    }
  }
  return { units: out, removed };
}

function dedupeUnits(units) {
  const out = [];
  for (const u of units) {
    const last = out[out.length - 1];
    if (!last || last[0] !== u[0] || last[1] !== u[1]) out.push([u[0], u[1]]);
  }
  return out;
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** The direction (unit vector, metres) of a polyline around vertex i. */
function localDirection(plane, i) {
  const a = plane[Math.max(0, i - 1)];
  const b = plane[Math.min(plane.length - 1, i + 1)];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const mag = Math.hypot(dx, dy);
  return mag === 0 ? { x: 0, y: 0 } : { x: dx / mag, y: dy / mag };
}

function segmentDirection(plane, seg) {
  const a = plane[seg];
  const b = plane[seg + 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const mag = Math.hypot(dx, dy);
  return mag === 0 ? { x: 0, y: 0 } : { x: dx / mag, y: dy / mag };
}

/** Share of shape-segments whose exact quantised segment no other shape in
 *  the set traverses: the sharing measure the plan's findings quote (2 % for
 *  the tram shapes), reported before snapping. */
function unsharedShare(shapesUnits) {
  const owners = new Map();
  let total = 0;
  for (const [si, units] of shapesUnits.entries()) {
    for (let i = 1; i < units.length; i++) {
      total++;
      const k = segmentKey(units[i - 1], units[i]);
      let set = owners.get(k);
      if (!set) owners.set(k, (set = new Set()));
      set.add(si);
    }
  }
  if (total === 0) return 0;
  let unshared = 0;
  for (const set of owners.values()) if (set.size === 1) unshared += 1;
  return unshared / total;
}

/**
 * The snapping pass. Shapes are processed in index order; each is compared
 * with the shapes before it, so the reference geometry is always the
 * earliest shape's. Shape S is sampled every SNAP_SAMPLE_METRES along its
 * current geometry (a long chord with no vertex inside a shared stretch is
 * the common case, so vertices alone would miss it); a run of samples that
 * all lie within SNAP_METRES of one earlier shape T, moving the same way,
 * and spanning at least SNAP_MIN_RUN_METRES, is a stretch of one track drawn
 * twice. Its two ends are projected onto both shapes and inserted as
 * vertices -- into S and T, and into EVERY shape that shares the split
 * segment, or the exact sharing the graph is built on would break where a
 * third line ran the same segment -- and S's interior between them is
 * replaced by T's own sub-polyline, after which S and T share the stretch
 * segment for segment. A sample within the distance but heading the other
 * way (the opposite track of a double-track line) never counts; a single
 * touch at an at-grade crossing never spans the minimum run.
 */
const SNAP_SAMPLE_METRES = 2.5;
const SNAP_GRID_METRES = 50;

function snapNearDuplicates(shapesUnits, trace = null) {
  const shapes = shapesUnits.map((units) => units.map((u) => [u[0], u[1]]));
  let snappedRuns = 0;

  /** All shapes that currently run the segment a->b, in either direction. */
  const sharersOf = (a, b) => {
    const fwd = segmentKey(a, b);
    const rev = segmentKey(b, a);
    const out = [];
    shapes.forEach((U, si) => {
      for (let i = 1; i < U.length; i++) {
        const k = segmentKey(U[i - 1], U[i]);
        if (k === fwd || k === rev) out.push({ si, i });
      }
    });
    return out;
  };

  /** Places `unit` on shape `si` where plane point `p` projects: reuses a
   *  vertex already within a metre of it, moves the vertex there when the
   *  shape is the one being snapped (`move`: its own end is being put onto
   *  the reference, a stub beside it would be a second track), else inserts
   *  it into the segment -- and into every other shape sharing that segment,
   *  or the exact sharing the graph is built on would break there. Returns
   *  the unit's index in shape `si`. */
  const VERTEX_REUSE_M = 1; // under one coordinate quantum: the same point, rounded differently
  const insertAt = (si, p, unit, move) => {
    const U = shapes[si];
    const plane = U.map(unitsToMetres);
    const near = nearestOnPolyline(p, plane, cumulative(plane));
    const a = U[near.seg];
    const b = U[near.seg + 1];
    // The run ends exactly at one of this shape's vertices: that vertex IS the
    // end, and on the shape being snapped it moves onto the reference.
    const atVertex = near.t <= 1e-9 ? near.seg : near.t >= 1 - 1e-9 ? near.seg + 1 : -1;
    if (move && atVertex >= 0) {
      if (unitKey(U[atVertex]) !== unitKey(unit)) U[atVertex] = [unit[0], unit[1]];
      return atVertex;
    }
    const q = unitsToMetres(unit);
    const dA = Math.hypot(q.x - plane[near.seg].x, q.y - plane[near.seg].y);
    const dB = Math.hypot(q.x - plane[near.seg + 1].x, q.y - plane[near.seg + 1].y);
    const reuse = dA <= dB ? near.seg : near.seg + 1;
    if (Math.min(dA, dB) <= VERTEX_REUSE_M) return reuse;
    // Insert into every sharer, highest index first within each shape.
    const sharers = sharersOf(a, b).sort((x, y) => y.i - x.i);
    for (const { si: other, i } of sharers) shapes[other].splice(i, 0, [unit[0], unit[1]]);
    for (let i = 1; i < U.length; i++) if (unitKey(U[i]) === unitKey(unit) && (unitKey(U[i - 1]) === unitKey(a) || unitKey(U[i - 1]) === unitKey(b))) return i;
    return U.findIndex((u) => unitKey(u) === unitKey(unit));
  };

  // Each shape is snapped in passes: applying a run moves its ends onto the
  // reference, which can bring the stretch between two runs within reach,
  // so detection repeats until a pass finds nothing new (a few passes at
  // most; the cap only guards against a pathological ping-pong).
  const SNAP_MAX_PASSES = 6;
  for (let si = 1; si < shapes.length; si++) {
    for (let pass = 0; pass < SNAP_MAX_PASSES; pass++) {
    const S = shapes[si];
    if (S.length < 2) break;
    const plane = S.map(unitsToMetres);
    const cum = cumulative(plane);
    // A grid over the earlier shapes' segments for candidate discovery.
    const grid = new Map();
    const cell = (p) => `${Math.floor(p.x / SNAP_GRID_METRES)},${Math.floor(p.y / SNAP_GRID_METRES)}`;
    const refPlane = [];
    for (let ti = 0; ti < si; ti++) {
      const T = shapes[ti];
      const tp = T.map(unitsToMetres);
      refPlane.push(tp);
      for (let j = 1; j < tp.length; j++) {
        const a = tp[j - 1];
        const b = tp[j];
        const minX = Math.floor((Math.min(a.x, b.x) - SNAP_METRES) / SNAP_GRID_METRES);
        const maxX = Math.floor((Math.max(a.x, b.x) + SNAP_METRES) / SNAP_GRID_METRES);
        const minY = Math.floor((Math.min(a.y, b.y) - SNAP_METRES) / SNAP_GRID_METRES);
        const maxY = Math.floor((Math.max(a.y, b.y) + SNAP_METRES) / SNAP_GRID_METRES);
        for (let cx = minX; cx <= maxX; cx++) {
          for (let cy = minY; cy <= maxY; cy++) {
            const key = `${cx},${cy}`;
            let list = grid.get(key);
            if (!list) grid.set(key, (list = []));
            list.push([ti, j - 1]);
          }
        }
      }
    }
    if (grid.size === 0) break;

    // Samples along S: every vertex, and every SNAP_SAMPLE_METRES between.
    const total = cum[cum.length - 1];
    const samples = [];
    for (let seg = 0; seg < S.length - 1; seg++) {
      const a = plane[seg];
      const b = plane[seg + 1];
      const len = cum[seg + 1] - cum[seg];
      const dir = len === 0 ? { x: 0, y: 0 } : { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      const steps = Math.max(1, Math.ceil(len / SNAP_SAMPLE_METRES));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        samples.push({ arc: cum[seg] + t * len, seg, p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dir });
      }
    }
    samples.push({ arc: total, seg: S.length - 2, p: plane[plane.length - 1], dir: samples[samples.length - 1].dir });

    // For each sample: the earlier shapes within reach, moving the same way.
    const validAt = samples.map((smp) => {
      const found = new Map(); // ti -> distance
      for (const [ti, j] of grid.get(cell(smp.p)) ?? []) {
        const tp = refPlane[ti];
        const d = pointSegmentDistance(smp.p, tp[j], tp[j + 1]);
        if (d > SNAP_METRES) continue;
        const sd = segmentDirection(tp, j);
        if (smp.dir.x * sd.x + smp.dir.y * sd.y <= 0) continue;
        if (!found.has(ti) || d < found.get(ti)) found.set(ti, d);
      }
      return found;
    });
    // Runs of consecutive samples on one reference, with hysteresis: keep the
    // run's reference while it is still within reach, else the nearest.
    const runs = [];
    let run = null;
    for (let i = 0; i < samples.length; i++) {
      const valid = validAt[i];
      if (run && valid.has(run.ti)) {
        run.end = i;
        continue;
      }
      if (run) {
        if (samples[run.end].arc - samples[run.start].arc >= SNAP_MIN_RUN_METRES) runs.push(run);
        run = null;
      }
      if (valid.size > 0) {
        let best = null;
        for (const [ti, d] of valid) if (!best || d < best.d || (d === best.d && ti < best.ti)) best = { ti, d };
        run = { ti: best.ti, start: i, end: i };
      }
    }
    if (run && samples[run.end].arc - samples[run.start].arc >= SNAP_MIN_RUN_METRES) runs.push(run);
    trace?.(`shape ${si}: ${samples.length} samples, ${samples.filter((_, i) => validAt[i].size > 0).length} within reach, ${runs.length} runs`);

    // A run is worth applying only if the part of it S does not already share
    // with T segment for segment is itself a duplicate's length: an already
    // merged stretch has nothing left (so the passes converge), and at a
    // turnout the chord that leaves T at a shallow angle would otherwise be
    // merged a sample step further on every pass, a vertex at a time.
    const tKeys = new Map();
    const keysOf = (ti) => {
      let set = tKeys.get(ti);
      if (!set) {
        set = new Set();
        const T = shapes[ti];
        for (let j = 1; j < T.length; j++) set.add(segmentKey(T[j - 1], T[j]));
        tKeys.set(ti, set);
      }
      return set;
    };
    const worthIt = runs.filter((r) => {
      const keys = keysOf(r.ti);
      let unshared = 0;
      for (let seg = samples[r.start].seg; seg <= samples[r.end].seg && seg + 1 < S.length; seg++) {
        if (!keys.has(segmentKey(S[seg], S[seg + 1]))) unshared += cum[seg + 1] - cum[seg];
      }
      return unshared >= SNAP_MIN_RUN_METRES;
    });
    trace?.(`shape ${si}: ${runs.length - worthIt.length} of ${runs.length} runs already shared or a creep, skipped`);
    runs.length = 0;
    runs.push(...worthIt);
    if (runs.length === 0) break;
    // Apply from the last run back, so arcs before an edit stay valid.
    let applied = 0;
    for (const r of runs.reverse()) {
      const T = shapes[r.ti];
      const pA = samples[r.start].p;
      const pB = samples[r.end].p;
      const tPlane = T.map(unitsToMetres);
      const tCum = cumulative(tPlane);
      const nearA = nearestOnPolyline(pA, tPlane, tCum);
      const nearB = nearestOnPolyline(pB, tPlane, tCum);
      if (nearB.seg + nearB.t < nearA.seg + nearA.t) {
        trace?.(`shape ${si} run ${samples[r.start].arc.toFixed(0)}-${samples[r.end].arc.toFixed(0)} m on ${r.ti}: skipped, reference runs the other way`);
        continue;
      }
      const unitOnT = (near) => {
        const u0 = T[near.seg];
        const u1 = T[near.seg + 1];
        return [Math.round(u0[0] + (u1[0] - u0[0]) * near.t), Math.round(u0[1] + (u1[1] - u0[1]) * near.t)];
      };
      const unitA = unitOnT(nearA);
      const unitB = unitOnT(nearB);
      // Both ends become vertices of T (and of every shape sharing the split
      // segments), then of S: S's ends are placed on T's geometry.
      // On the reference the end may land on a vertex it already has (within a
      // metre); the snapped shape then takes THAT vertex, not the rounded
      // projection, or its boundary segments would miss the reference by a unit.
      const jA = insertAt(r.ti, pA, unitA, false);
      const jB = insertAt(r.ti, pB, unitB, false);
      const onA = shapes[r.ti][jA];
      const onB = shapes[r.ti][jB];
      const iA = insertAt(si, pA, onA, true);
      const iB = insertAt(si, pB, onB, true);
      if (jB < jA || iB < iA) {
        trace?.(`shape ${si} run ${samples[r.start].arc.toFixed(0)}-${samples[r.end].arc.toFixed(0)} m on ${r.ti}: skipped, indices ${jA}/${jB} ${iA}/${iB}`);
        continue;
      }
      trace?.(`shape ${si} run ${samples[r.start].arc.toFixed(0)}-${samples[r.end].arc.toFixed(0)} m on ${r.ti}: applied (T ${jA}..${jB}, S ${iA}..${iB})`);
      // S's interior between the two ends becomes T's own sub-polyline.
      const interior = shapes[r.ti].slice(jA + 1, jB).map((u) => [u[0], u[1]]);
      S.splice(iA + 1, iB - iA - 1, ...interior);
      snappedRuns++;
      applied++;
    }
    // A run's moved end can land a vertex behind its neighbour and leave a
    // zigzag or a metres-long loop no track has; those, and any zero-length
    // step, are collapsed again here on every shape touched so far.
    for (let k = 0; k <= si; k++) shapes[k] = collapseSpikes(dedupeUnits(shapes[k])).units;
    if (applied === 0) break;
    }
  }
  return { shapes, snappedRuns };
}

/**
 * Forces a vertex at each junction point on every shape that runs one of the
 * segments it was found on, so the run-splitting pass below cuts BOTH tracks
 * there: with two tracks through one vertex its undirected degree is four,
 * which is the same rule that already cuts an at-grade crossing the feed's
 * shapes happen to draw through a shared point. Splitting here, before the
 * runs are cut, is what keeps every edge a maximal run of segments with one
 * owner set -- nothing downstream has to be re-canonicalised.
 *
 * A junction is `{ u, segs }` in the same integer units as the shapes: `u`
 * the split point, `segs` the one or two segments it lies on, named by their
 * two endpoints. Naming the segments rather than measuring a distance is
 * deliberate: the opposite track can run under a metre away (Glavni kolodvor:
 * 0.14 m), and a tolerance would cut it too.
 */
function insertJunctionVertices(shapes, junctions) {
  const bySegment = new Map(); // segment key, both orders -> the units to put on it
  for (const { u, segs } of junctions) {
    for (const [a, b] of segs) {
      for (const key of [segmentKey(a, b), segmentKey(b, a)]) {
        let list = bySegment.get(key);
        if (!list) bySegment.set(key, (list = []));
        if (!list.some((v) => unitKey(v) === unitKey(u))) list.push(u);
      }
    }
  }
  let inserted = 0;
  for (const units of shapes) {
    for (let i = 1; i < units.length; i++) {
      const list = bySegment.get(segmentKey(units[i - 1], units[i]));
      if (!list) continue;
      // Already a vertex of this shape (the intersection rounded onto one):
      // the node is there, nothing to insert.
      const wanted = list.filter((u) => unitKey(u) !== unitKey(units[i - 1]) && unitKey(u) !== unitKey(units[i]));
      if (wanted.length === 0) continue;
      const from = unitsToMetres(units[i - 1]);
      const ordered = wanted
        .map((u) => {
          const q = unitsToMetres(u);
          return { u, d: Math.hypot(q.x - from.x, q.y - from.y) };
        })
        .sort((x, y) => x.d - y.d)
        .map((entry) => [entry.u[0], entry.u[1]]);
      units.splice(i, 0, ...ordered);
      inserted += ordered.length;
      i += ordered.length;
    }
  }
  return inserted;
}

/** Sampled points every `step` metres along a polyline, vertices included. */
function samplePolyline(plane, cum, step) {
  const out = [];
  const total = cum[cum.length - 1];
  for (let s = 0; s < total; s += step) out.push(pointAtArc(plane, cum, s));
  out.push(plane[plane.length - 1]);
  return out;
}

function pointAtArc(plane, cum, s) {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = plane[i - 1];
  const b = plane[i];
  const span = cum[i] - cum[i - 1];
  const t = span === 0 ? 0 : clamp01((s - cum[i - 1]) / span);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Same-direction edge pairs that still run within SNAP_METRES of each other
 *  over at least SNAP_MIN_RUN_METRES after the snapping pass: the residual
 *  the build report lists and the builder refuses to ship silently. */
function findNearParallel(edges) {
  const geo = edges.map((e) => {
    const plane = e.units.map(unitsToMetres);
    return { plane, cum: cumulative(plane), bbox: bboxExpanded(plane, SNAP_METRES) };
  });
  const pairs = [];
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (!bboxesOverlap(geo[i].bbox, geo[j].bbox)) continue;
      const samples = samplePolyline(geo[i].plane, geo[i].cum, 5);
      let run = 0;
      let longest = 0;
      let prevOn = null;
      for (const p of samples) {
        const near = nearestOnPolyline(p, geo[j].plane, geo[j].cum);
        const dirI = localDirection(geo[i].plane, Math.min(geo[i].plane.length - 1, nearestOnPolyline(p, geo[i].plane, geo[i].cum).seg + 1));
        const dirJ = segmentDirection(geo[j].plane, near.seg);
        const on = near.dist <= SNAP_METRES && dirI.x * dirJ.x + dirI.y * dirJ.y > 0;
        if (on) {
          run += prevOn ? Math.hypot(p.x - prevOn.x, p.y - prevOn.y) : 0;
          prevOn = p;
        } else {
          longest = Math.max(longest, run);
          run = 0;
          prevOn = null;
        }
      }
      longest = Math.max(longest, run);
      if (longest >= SNAP_MIN_RUN_METRES) pairs.push({ a: i, b: j, metres: round1(longest) });
    }
  }
  return pairs;
}

/**
 * Builds the directed rail graph from tram shapes given as integer unit
 * pairs. An edge is a maximal run of consecutive segments traversed by
 * exactly the same set of shapes, with no interior vertex where a third
 * track attaches (an undirected degree above two); a node is an edge
 * endpoint; a run traversed both ways yields two opposite edges. Returns the
 * edges (with the shapes that own each), every shape as an edge sequence, the
 * node count and a report (snapped runs, residual near-parallel pairs, the
 * unshared-segment share before snapping).
 *
 * Options: `snap: false` skips the near-duplicate merge (the residual-pair
 * report then shows what it would have merged); `trace(line)` receives one
 * line per detected run, for diagnosing a build whose residual check fails.
 * `junctions` (F8c) forces a node where two tracks only cross, so a turn the
 * feed's shapes never draw becomes expressible; see insertJunctionVertices.
 * `snappedShapes` in the result is the geometry after snapping, for the same
 * diagnostic use; the artefact is cut from the edges, not from it.
 */
export function buildRailGraph(shapesUnits, opts = {}) {
  const { snap = true, trace = null, junctions = [] } = opts;
  let spikePoints = 0;
  const deduped = shapesUnits.map((units) => {
    const cleaned = collapseSpikes(dedupeUnits(units));
    spikePoints += cleaned.removed;
    return cleaned.units;
  });
  const unsharedShareBefore = unsharedShare(deduped);
  let shapes = deduped;
  let snappedRuns = 0;
  if (snap) ({ shapes, snappedRuns } = snapNearDuplicates(deduped, trace));
  const junctionVertices = junctions.length > 0 ? insertJunctionVertices(shapes, junctions) : 0;

  const owners = new Map(); // segment key -> Set(shape index)
  const neighbours = new Map(); // unit key -> Set(unit key), undirected
  const addNeighbour = (a, b) => {
    const k = unitKey(a);
    let set = neighbours.get(k);
    if (!set) neighbours.set(k, (set = new Set()));
    set.add(unitKey(b));
  };
  for (const [si, units] of shapes.entries()) {
    for (let i = 1; i < units.length; i++) {
      const k = segmentKey(units[i - 1], units[i]);
      let set = owners.get(k);
      if (!set) owners.set(k, (set = new Set()));
      set.add(si);
      addNeighbour(units[i - 1], units[i]);
      addNeighbour(units[i], units[i - 1]);
    }
  }

  const nodeIds = new Map();
  const nodeOf = (u) => {
    const k = unitKey(u);
    let id = nodeIds.get(k);
    if (id === undefined) nodeIds.set(k, (id = nodeIds.size));
    return id;
  };
  const edgeByRun = new Map();
  const edges = [];
  const shapeEdges = [];
  for (const [si, units] of shapes.entries()) {
    const seq = [];
    let runStart = 0;
    for (let i = 1; i < units.length; i++) {
      const isLast = i === units.length - 1;
      let split = isLast;
      if (!isLast) {
        const own = owners.get(segmentKey(units[i - 1], units[i]));
        const next = owners.get(segmentKey(units[i], units[i + 1]));
        if (!sameSet(own, next) || neighbours.get(unitKey(units[i])).size > 2) split = true;
      }
      if (!split) continue;
      const runUnits = units.slice(runStart, i + 1);
      const runKey = runUnits.map(unitKey).join('>');
      let e = edgeByRun.get(runKey);
      if (e === undefined) {
        e = edges.length;
        edges.push({ from: nodeOf(runUnits[0]), to: nodeOf(runUnits[runUnits.length - 1]), units: runUnits, owners: new Set() });
        edgeByRun.set(runKey, e);
      }
      edges[e].owners.add(si);
      seq.push(e);
      runStart = i;
    }
    shapeEdges.push(seq);
  }
  const residualPairs = findNearParallel(edges);
  const junctionNodes = new Map(junctions.map(({ u }) => [unitKey(u), nodeIds.get(unitKey(u)) ?? null]));
  return {
    edges,
    shapeEdges,
    nodeCount: nodeIds.size,
    snappedShapes: shapes,
    junctionNodes,
    report: { snappedRuns, residualPairs, unsharedShareBefore, spikePoints, junctionVertices },
  };
}

/** Shortest path over directed edges from any of `sources` to any of
 *  `targets` (each {edge, s}), returning the edge sequence (source edge
 *  first) and the target reached, or null. Dijkstra over nodes with the
 *  edge lengths as costs; the graph has a few hundred edges, so a plain
 *  array stands in for a heap. */
function routeBetween(edges, outgoing, lens, sources, targets) {
  const targetOn = new Map();
  for (const t of targets) {
    const prev = targetOn.get(t.edge);
    if (prev === undefined || t.s < prev) targetOn.set(t.edge, t.s);
  }
  let best = null;
  const consider = (cost, path, end) => {
    if (!best || cost < best.cost) best = { cost, path, end };
  };
  const dist = new Map();
  const cameFrom = new Map(); // node -> { edge, node | null }
  const open = [];
  for (const src of sources) {
    const ts = targetOn.get(src.edge);
    if (ts !== undefined && ts >= src.s) consider(ts - src.s, [src.edge], { edge: src.edge, s: ts });
    const node = edges[src.edge].to;
    const cost = lens[src.edge] - src.s;
    if (!dist.has(node) || cost < dist.get(node)) {
      dist.set(node, cost);
      cameFrom.set(node, { edge: src.edge, node: null });
      open.push(node);
    }
  }
  const pathTo = (node) => {
    const path = [];
    let at = node;
    while (at !== null && at !== undefined) {
      const step = cameFrom.get(at);
      path.unshift(step.edge);
      at = step.node;
    }
    return path;
  };
  while (open.length > 0) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist.get(open[i]) < dist.get(open[bi])) bi = i;
    const node = open.splice(bi, 1)[0];
    const cost = dist.get(node);
    if (best && cost >= best.cost) break;
    for (const e of outgoing.get(node) ?? []) {
      const ts = targetOn.get(e);
      if (ts !== undefined) consider(cost + ts, [...pathTo(node), e], { edge: e, s: ts });
      const next = edges[e].to;
      const nextCost = cost + lens[e];
      if (!dist.has(next) || nextCost < dist.get(next)) {
        dist.set(next, nextCost);
        cameFrom.set(next, { edge: e, node });
        if (!open.includes(next)) open.push(next);
      }
    }
  }
  return best;
}

/** The edge sequence visiting `stopLinks` (one array of {edge, s} candidates
 *  per stop) in order: the cheapest chain over every stop's candidates at
 *  once, not leg by leg, because a stop within reach of both tracks of a line
 *  links to both, and the shorter first leg can land on the opposite track
 *  from which no leg to the next stop exists. The candidates are the stop's
 *  links within SERVED_STOP_MAX_METRES (F8b): at the 40 m geometric radius
 *  Olipska 251_2 reaches only the *opposite* rail, 39.4 m away, while the one
 *  its line runs is 42.8 m off, and six patterns of routes 2, 5 and 13 had no
 *  chain at all. Throws with the label when no chain visits every stop, the
 *  error carrying `leg`, the index of the stop it could not reach. */
export function pathThroughStops(edges, outgoing, lens, stopLinks, label, describe = (k) => `stop ${k}`) {
  let layer = stopLinks[0].map((link) => ({ cost: 0, link, legs: [] }));
  for (let k = 1; k < stopLinks.length; k++) {
    const next = [];
    for (const target of stopLinks[k]) {
      let best = null;
      for (const entry of layer) {
        const leg = routeBetween(edges, outgoing, lens, [entry.link], [target]);
        if (!leg) continue;
        const cost = entry.cost + leg.cost;
        if (!best || cost < best.cost) best = { cost, link: leg.end, legs: [...entry.legs, leg.path] };
      }
      if (best) next.push(best);
    }
    if (next.length === 0) {
      const error = new Error(`${label}: no route over the rail graph from ${describe(k - 1)} to ${describe(k)}`);
      error.leg = k;
      throw error;
    }
    layer = next;
  }
  let winner = layer[0];
  for (const entry of layer) if (entry.cost < winner.cost) winner = entry;
  const path = [];
  for (const leg of winner.legs) for (const e of leg) if (path.length === 0 || path[path.length - 1] !== e) path.push(e);
  return path;
}

// ---------------------------------------------------------------------------
// The octilinear diagram.

const EIGHTH_TURN = Math.PI / 4;

/** Rounds an angle (radians) to the nearest multiple of 45 degrees. */
export function snapOctant(angle) {
  return Math.round(angle / EIGHTH_TURN) * EIGHTH_TURN;
}

function dedupeConsecutive(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

/** Rebuilds a polyline where every point's direction from its immediate
 *  predecessor is snapped to the nearest 45 degrees, preserving each
 *  original segment's length. */
function snapChain(points) {
  if (points.length === 0) return [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const raw = points[i];
    const dx = raw.x - prev.x;
    const dy = raw.y - prev.y;
    const mag = Math.hypot(dx, dy);
    if (mag === 0) continue;
    const angle = snapOctant(Math.atan2(dy, dx));
    out.push({ x: prev.x + mag * Math.cos(angle), y: prev.y + mag * Math.sin(angle) });
  }
  return out;
}

/** Snaps a simplified shape onto the octilinear grid, then simplifies again
 *  at `tolerance` metres, re-snapping every surviving segment so the
 *  octilinear invariant holds for the final polyline. */
export function buildOctilinearLine(planePoints, tolerance = DIAGRAM_SIMPLIFY_METRES) {
  const dedup = dedupeConsecutive(planePoints);
  if (dedup.length < 2) return dedup;
  const snappedOnce = snapChain(dedup);
  if (snappedOnce.length < 2) return snappedOnce;
  const keepIdx = dpIndices(snappedOnce, tolerance);
  const reducedRaw = keepIdx.map((i) => dedup[i]);
  return snapChain(reducedRaw);
}

// ---------------------------------------------------------------------------
// GTFS table parsing (routes.txt, trips.txt, shapes.txt, stops.txt, feed_info.txt).

function columnIndexer(header, fileName) {
  return (name) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`${fileName} lacks the column ${name} (header: ${header.join(',')})`);
    return i;
  };
}

export function parseRoutesTxt(rows) {
  if (rows.length === 0) throw new Error('routes.txt is empty');
  const col = columnIndexer(rows[0], 'routes.txt');
  const idIdx = col('route_id');
  const shortIdx = col('route_short_name');
  const typeIdx = col('route_type');
  const map = new Map();
  for (const r of rows.slice(1)) {
    const id = (r[idIdx] ?? '').trim();
    if (id === '') continue;
    const type = Number(r[typeIdx]);
    if (!Number.isInteger(type)) throw new Error(`route ${id} has a non-integer route_type "${r[typeIdx]}"`);
    map.set(id, { short: (r[shortIdx] ?? '').trim(), type });
  }
  return map;
}

/** trips.txt: which route each shape belongs to (first trip wins, no shape is
 *  shared between routes), a sample trip per shape for the terminus override,
 *  trip counts per route, the majority direction_id per shape, the shape each
 *  shaped trip runs (the served lists are the union over a shape's trips,
 *  F8), and the trips that carry no shape_id at all (route and direction),
 *  which the synthetic paths are built for. */
export function parseTripsTxt(rows) {
  if (rows.length === 0) throw new Error('trips.txt is empty');
  const col = columnIndexer(rows[0], 'trips.txt');
  const routeIdx = col('route_id');
  const tripIdx = col('trip_id');
  const shapeIdx = col('shape_id');
  const directionIdx = rows[0].indexOf('direction_id'); // optional in GTFS
  const tripCountByRoute = new Map();
  const shapeToRoute = new Map();
  const shapeSampleTrip = new Map();
  const directionVotes = new Map(); // shapeId -> [count0, count1]
  const shapelessTrips = new Map(); // tripId -> { route, direction }
  const shapeOfTrip = new Map(); // tripId -> shapeId, for the shaped trips
  for (const r of rows.slice(1)) {
    const routeId = r[routeIdx];
    const tripId = r[tripIdx];
    const shapeId = (r[shapeIdx] ?? '').trim();
    const direction = directionIdx === -1 ? 0 : Number(r[directionIdx]) === 1 ? 1 : 0;
    tripCountByRoute.set(routeId, (tripCountByRoute.get(routeId) ?? 0) + 1);
    if (shapeId === '') {
      if (tripId) shapelessTrips.set(tripId, { route: routeId, direction });
      continue;
    }
    if (tripId) shapeOfTrip.set(tripId, shapeId);
    if (!shapeToRoute.has(shapeId)) {
      shapeToRoute.set(shapeId, routeId);
      shapeSampleTrip.set(shapeId, tripId);
    }
    const votes = directionVotes.get(shapeId) ?? [0, 0];
    votes[direction]++;
    directionVotes.set(shapeId, votes);
  }
  const shapeDirection = new Map();
  for (const [shapeId, [zero, one]] of directionVotes) shapeDirection.set(shapeId, one > zero ? 1 : 0);
  return { tripCountByRoute, shapeToRoute, shapeSampleTrip, shapeDirection, shapelessTrips, shapeOfTrip };
}

export function parseShapesTxt(rows) {
  if (rows.length === 0) throw new Error('shapes.txt is empty');
  const col = columnIndexer(rows[0], 'shapes.txt');
  const idIdx = col('shape_id');
  const latIdx = col('shape_pt_lat');
  const lonIdx = col('shape_pt_lon');
  const seqIdx = col('shape_pt_sequence');
  const byId = new Map();
  for (const r of rows.slice(1)) {
    const id = r[idIdx];
    const pt = { lat: Number(r[latIdx]), lon: Number(r[lonIdx]), seq: Number(r[seqIdx]) };
    if (!Number.isFinite(pt.lat) || !Number.isFinite(pt.lon) || !Number.isFinite(pt.seq)) {
      throw new Error(`shapes.txt: non-numeric lat/lon/sequence for shape ${id}`);
    }
    let arr = byId.get(id);
    if (!arr) {
      arr = [];
      byId.set(id, arr);
    }
    arr.push(pt);
  }
  for (const arr of byId.values()) arr.sort((a, b) => a.seq - b.seq);
  return byId;
}

export function parseStopsTxt(rows) {
  if (rows.length === 0) throw new Error('stops.txt is empty');
  const col = columnIndexer(rows[0], 'stops.txt');
  const idIdx = col('stop_id');
  const nameIdx = col('stop_name');
  const latIdx = col('stop_lat');
  const lonIdx = col('stop_lon');
  // location_type 0 (the GTFS default when the column is blank) is an actual
  // boarding point; 1 is a parent "station" grouping several of those, never
  // itself a place a vehicle stops.
  const typeIdx = rows[0].indexOf('location_type');
  return rows
    .slice(1)
    .filter((r) => typeIdx === -1 || r[typeIdx] === '' || r[typeIdx] === '0')
    .map((r) => ({ id: r[idIdx], name: r[nameIdx], lat: Number(r[latIdx]), lon: Number(r[lonIdx]) }))
    .filter((s) => s.id !== '' && Number.isFinite(s.lat) && Number.isFinite(s.lon));
}

function feedInfoField(rows, field) {
  if (rows.length < 2) return null;
  const idx = rows[0].indexOf(field);
  if (idx === -1) return null;
  const v = (rows[1][idx] ?? '').trim();
  return v === '' ? null : v;
}

// ---------------------------------------------------------------------------
// stop_times.txt: 92 MB uncompressed, never held in memory as one string.
// Streamed as inflate -> line reader, once, keeping two things: every trip's
// first and last stop (the "stop-transfer helper": a terminus set back from
// the road, further than 40 m from the recorded geometry, still gets linked
// at the shape's own end), and the whole ordered stop sequence of the trips
// that carry no shape_id (the synthetic paths need it, and there are only a
// few thousand such trips).

function stopTimesStream(buf, entry) {
  const start = localFileDataOffset(buf, entry);
  const compressed = buf.subarray(start, start + entry.compressedSize);
  const source = Readable.from([Buffer.from(compressed)]);
  if (entry.method === 8) return source.pipe(createInflateRaw());
  if (entry.method === 0) return source;
  throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
}

/** Streams stop_times.txt and returns { endpoints: Map<tripId, {firstStop,
 *  lastStop}>, sequences: Map<tripId, stopId[]>, shapeStops: Map<shapeId,
 *  Set<stopId>> } -- the sequences only for the trip ids in `sequenceTrips`,
 *  sorted by stop_sequence, and the served set only for the trips named in
 *  `shapeOfTrip` (F8: one pass, no per-trip sequence held for the 70,000
 *  shaped trips, whose union per shape is all a served list needs). */
export async function streamStopTimes(buf, entry, sequenceTrips = new Set(), shapeOfTrip = new Map()) {
  const rl = createInterface({ input: stopTimesStream(buf, entry), crlfDelay: Infinity });
  const endpoints = new Map();
  const raw = new Map();
  const shapeStops = new Map();
  let header = null;
  let tripIdx = -1;
  let stopIdx = -1;
  let seqIdx = -1;
  for await (const line of rl) {
    if (header === null) {
      header = parseCsv(line)[0] ?? [];
      tripIdx = header.indexOf('trip_id');
      stopIdx = header.indexOf('stop_id');
      seqIdx = header.indexOf('stop_sequence');
      if (tripIdx === -1 || stopIdx === -1 || seqIdx === -1) {
        throw new Error('stop_times.txt lacks trip_id, stop_id or stop_sequence');
      }
      continue;
    }
    if (line.trim() === '') continue;
    const row = parseCsv(line)[0];
    if (!row) continue;
    const tripId = row[tripIdx];
    const stopId = row[stopIdx];
    const seq = Number(row[seqIdx]);
    const existing = endpoints.get(tripId);
    if (!existing) {
      endpoints.set(tripId, { firstStop: stopId, firstSeq: seq, lastStop: stopId, lastSeq: seq });
    } else {
      if (seq < existing.firstSeq) {
        existing.firstStop = stopId;
        existing.firstSeq = seq;
      }
      if (seq > existing.lastSeq) {
        existing.lastStop = stopId;
        existing.lastSeq = seq;
      }
    }
    if (sequenceTrips.has(tripId)) {
      let list = raw.get(tripId);
      if (!list) raw.set(tripId, (list = []));
      list.push({ seq, stopId });
    }
    const shapeId = shapeOfTrip.get(tripId);
    if (shapeId !== undefined) {
      let set = shapeStops.get(shapeId);
      if (!set) shapeStops.set(shapeId, (set = new Set()));
      set.add(stopId);
    }
  }
  const sequences = new Map();
  for (const [tripId, list] of raw) {
    list.sort((a, b) => a.seq - b.seq);
    sequences.set(tripId, list.map((x) => x.stopId));
  }
  return { endpoints, sequences, shapeStops };
}

/** Kept for callers that only want the endpoints (task A1's script imports it). */
export async function streamTripEndpoints(buf, entry) {
  return (await streamStopTimes(buf, entry)).endpoints;
}

// ---------------------------------------------------------------------------
// Orchestration.

/**
 * Builds the version 2 artefact from a fully-loaded GTFS zip buffer.
 * @param {Uint8Array} zipBuf
 * @param {{ now?: () => Date, diagramBusCount?: number, fallbackMtime?: string | null, log?: (s: string) => void,
 *   overrides?: { unreachableStops?: ({ id: string, name?: string, reason?: string } | string)[],
 *     servedGaps?: { path: string, stop: string, reason: string }[],
 *     connectors?: { from: [number, number], to: [number, number], routes: string[], reason: string }[],
 *     longLegs?: { route?: string, from: string, to: string, reason: string }[] } }} [opts]
 *   `overrides` is the parsed OVERRIDES_PATH file; main() reads it, tests pass their own.
 */
export async function buildNetwork(zipBuf, opts = {}) {
  const { now = () => new Date(), diagramBusCount = DIAGRAM_BUS_COUNT, fallbackMtime = null, log = () => {}, overrides = {} } = opts;

  const entries = readZipEntries(zipBuf);
  const findEntry = (name) => {
    const e = entries.find((x) => x.name === name || x.name.endsWith('/' + name));
    if (!e) throw new Error(`${name} not in archive (entries: ${entries.map((x) => x.name).join(', ')})`);
    return e;
  };
  const textOf = (name) => new TextDecoder('utf-8').decode(extractEntry(zipBuf, findEntry(name)));

  const routesMeta = parseRoutesTxt(parseCsv(textOf('routes.txt')));
  const { tripCountByRoute, shapeToRoute, shapeSampleTrip, shapeDirection, shapelessTrips, shapeOfTrip } = parseTripsTxt(parseCsv(textOf('trips.txt')));
  const rawShapesByShapeId = parseShapesTxt(parseCsv(textOf('shapes.txt')));
  const rawStops = parseStopsTxt(parseCsv(textOf('stops.txt')));

  let feedVersion = fallbackMtime;
  try {
    const fv = feedInfoField(parseCsv(textOf('feed_info.txt')), 'feed_version');
    if (fv) feedVersion = fv;
  } catch {
    // feed_info.txt is optional in GTFS; fall through to fallbackMtime.
  }
  if (!feedVersion) {
    throw new Error('No feedVersion available: feed_info.txt lacks feed_version and no fallback mtime was supplied');
  }

  const isTramRoute = (routeId) => routesMeta.get(routeId)?.type === 0;
  const shapelessTramTrips = new Set([...shapelessTrips].filter(([, t]) => isTramRoute(t.route)).map(([id]) => id));
  // Only the tram shapes need a served list: a bus shape runs no path.
  const tramShapeOfTrip = new Map();
  for (const [tripId, shapeId] of shapeOfTrip) if (isTramRoute(shapeToRoute.get(shapeId))) tramShapeOfTrip.set(tripId, shapeId);
  // A shape's sample trip also gets its ordered sequence: where a path runs
  // out and back on parallel rails, a platform lies within 40 m of both, and
  // only the call order says which of the two arcs is the one the line stops
  // at on this leg (servedFor's cursor).
  const tramSampleTrips = new Set();
  for (const [shapeId, tripId] of shapeSampleTrip) {
    if (tripId && isTramRoute(shapeToRoute.get(shapeId))) tramSampleTrips.add(tripId);
  }
  const { endpoints: tripEndpoints, sequences: tripSequences, shapeStops: servedByShape } = await streamStopTimes(
    zipBuf,
    findEntry('stop_times.txt'),
    new Set([...shapelessTramTrips, ...tramSampleTrips]),
    tramShapeOfTrip,
  );
  // A platform some trip starts or ends at: a terminus, wherever it is.
  const terminalStops = new Set();
  for (const ends of tripEndpoints.values()) {
    terminalStops.add(ends.firstStop);
    terminalStops.add(ends.lastStop);
  }
  // The same per tram shape: the platforms a trip that runs the shape starts
  // or ends at. The shape's served list may put such a platform at the
  // shape's own end when it lies past it (the coverage rule in servedFor).
  const shapeTermini = new Map(); // shapeId -> Set<stopId>
  for (const [tripId, shapeId] of tramShapeOfTrip) {
    const ends = tripEndpoints.get(tripId);
    if (!ends) continue;
    let set = shapeTermini.get(shapeId);
    if (!set) shapeTermini.set(shapeId, (set = new Set()));
    set.add(ends.firstStop);
    set.add(ends.lastStop);
  }

  // Shapes in id order, split by mode: trams go to the graph, buses stay polylines.
  const shapeIds = [...rawShapesByShapeId.keys()].sort();
  const shapeRows = []; // { id, route, dir, kind: 'tram' | 'bus', rawPts }
  for (const shapeId of shapeIds) {
    const routeId = shapeToRoute.get(shapeId);
    if (!routeId) {
      log(`Skipping shape ${shapeId}: no trip references it`);
      continue;
    }
    shapeRows.push({ id: shapeId, route: routeId, dir: isTramRoute(routeId) ? shapeDirection.get(shapeId) ?? 0 : -1, kind: isTramRoute(routeId) ? 'tram' : 'bus', rawPts: rawShapesByShapeId.get(shapeId) });
  }

  // --- The rail graph from the RAW tram points (before any simplification).
  const tramRows = shapeRows.filter((s) => s.kind === 'tram');
  const tramUnits = tramRows.map((s) => s.rawPts.map((p) => [deltaEncode(p.lon, ORIGIN[0]), deltaEncode(p.lat, ORIGIN[1])]));
  const baseGraph = buildRailGraph(tramUnits);
  const refuseResidualPairs = (g) => {
    if (g.report.residualPairs.length === 0) return;
    const listed = g.report.residualPairs.map((p) => `edges ${p.a} and ${p.b} run together for ${p.metres} m`).join('; ');
    throw new Error(`Rail graph: ${g.report.residualPairs.length} same-direction near-parallel edge pair(s) survived the snapping pass: ${listed}`);
  };
  refuseResidualPairs(baseGraph);
  // The same graph with junction vertices forced (F8c). The near-duplicate
  // snapping pass is most of the build's time and its output is what a
  // junction's segments are named against, so it runs once: cutting the
  // SNAPPED shapes again with snapping off gives byte-identical edges (the
  // snapping pass is idempotent on its own output), plus the junction splits.
  const cutWithJunctions = (junctions) => {
    if (junctions.length === 0) return baseGraph;
    const cut = buildRailGraph(baseGraph.snappedShapes, { snap: false, junctions });
    cut.report.snappedRuns = baseGraph.report.snappedRuns;
    cut.report.unsharedShareBefore = baseGraph.report.unsharedShareBefore;
    cut.report.spikePoints = baseGraph.report.spikePoints;
    refuseResidualPairs(cut);
    return cut;
  };

  // Bus sharing ratio, informational: the same segment measure on bus shapes.
  const busRows = shapeRows.filter((s) => s.kind === 'bus');
  const busUnsharedShare = unsharedShare(busRows.map((s) => s.rawPts.map((p) => [deltaEncode(p.lon, ORIGIN[0]), deltaEncode(p.lat, ORIGIN[1])])));

  const shapeIdxByRoute = new Map();
  for (let i = 0; i < shapeRows.length; i++) {
    const list = shapeIdxByRoute.get(shapeRows[i].route);
    if (list) list.push(i);
    else shapeIdxByRoute.set(shapeRows[i].route, [i]);
  }

  // Rank: every tram route, then every other route, each group ordered by
  // trip count descending; dense 1..N; the diagram keeps ranks up to the cut.
  const withCounts = [...routesMeta.entries()].map(([id, meta]) => ({
    id,
    type: meta.type,
    short: meta.short,
    count: tripCountByRoute.get(id) ?? 0,
  }));
  const trams = withCounts.filter((r) => r.type === 0).sort((a, b) => b.count - a.count || compareRouteIds(a.id, b.id));
  const others = withCounts.filter((r) => r.type !== 0).sort((a, b) => b.count - a.count || compareRouteIds(a.id, b.id));
  const ranked = [...trams, ...others];
  const diagramCutRank = trams.length + diagramBusCount;

  const routes = ranked.map((r, i) => ({
    id: r.id,
    short: r.short,
    type: r.type,
    rank: i + 1,
    shapes: (shapeIdxByRoute.get(r.id) ?? []).slice().sort((a, b) => a - b),
  }));
  const diagramRouteIds = new Set(routes.filter((r) => r.rank <= diagramCutRank).map((r) => r.id));

  // --- Stops: position chained across the array; tram stops linked to edges
  // with an exact arc, bus stops to bus shapes with the 1/500 fraction.
  const stopIndexById = new Map();
  const stopPlane = [];
  const stopUnits = rawStops.map((s) => [deltaEncode(s.lon, ORIGIN[0]), deltaEncode(s.lat, ORIGIN[1])]);
  const stopPChain = chainEncodeXY(stopUnits);
  const stops = rawStops.map((s, i) => {
    stopIndexById.set(s.id, i);
    // Linked from the QUANTISED position, the one the decoder reconstructs, so
    // a stop 39.9 m from a track is linked by the builder exactly when the
    // client would measure it so; the raw coordinate can differ by half a unit.
    stopPlane.push(unitsToMetres(stopUnits[i]));
    return { id: s.id, name: s.name, p: [stopPChain[2 * i], stopPChain[2 * i + 1]], on: [], onEdge: [], terminal: terminalStops.has(s.id) ? 1 : 0 };
  });
  /**
   * Everything the rail graph decides: the edges' geometry, every tram shape
   * as a sequence of them, the stops' links to them, the served lists and the
   * synthetic paths routed over them. A function because F8c may cut the
   * graph again with junction vertices forced, which moves every edge index,
   * and then all of this has to follow.
   */
  function deriveFromGraph(graph) {
    // Edge interiors simplified at 5 m, endpoints kept (the graph's nodes).
    const edgeUnits = graph.edges.map((e) => {
      const plane = e.units.map(unitsToMetres);
      const keep = dpIndices(plane, SIMPLIFY_METRES);
      return keep.map((i) => e.units[i]);
    });
    const edgePlane = edgeUnits.map((units) => units.map(unitsToMetres));
    const edgeCum = edgePlane.map(cumulative);
    const edgeLen = edgeCum.map((cum) => cum[cum.length - 1]);
    // Wide enough for BOTH stop radii: the 40 m geometric links the wire
    // carries and the 60 m links the synthetic-path router walks (F8b).
    const edgeBbox = edgePlane.map((plane) => bboxExpanded(plane, SERVED_STOP_MAX_METRES));
    const outgoing = new Map();
    graph.edges.forEach((e, idx) => {
      const list = outgoing.get(e.from);
      if (list) list.push(idx);
      else outgoing.set(e.from, [idx]);
    });

    // --- Shapes: trams as edge sequences (geometry reconstructed for the
    // diagram and the length), buses simplified and chain-encoded as in v1.
    const shapes = [];
    const planeByShapeIdx = [];
    const cumByShapeIdx = [];
    const bboxByShapeIdx = [];
    let tramCursor = 0;
    for (const row of shapeRows) {
      if (row.kind === 'tram') {
        const seq = graph.shapeEdges[tramCursor++];
        const plane = [];
        for (const e of seq) {
          const pts = edgePlane[e];
          for (let i = plane.length === 0 ? 0 : 1; i < pts.length; i++) plane.push(pts[i]);
        }
        const cum = cumulative(plane);
        shapes.push({ id: row.id, route: row.route, dir: row.dir, d: [], e: seq, len: round1(cum[cum.length - 1]) });
        planeByShapeIdx.push(plane);
        cumByShapeIdx.push(cum);
        bboxByShapeIdx.push(bboxExpanded(plane, STOP_SHAPE_MAX_METRES));
      } else {
        const plane = row.rawPts.map((p) => toMetres(p.lon, p.lat));
        const keepIdx = dpIndices(plane, SIMPLIFY_METRES);
        const simplifiedLonLat = keepIdx.map((i) => row.rawPts[i]);
        const simplifiedPlane = keepIdx.map((i) => plane[i]);
        const cum = cumulative(simplifiedPlane);
        const units = simplifiedLonLat.map((p) => [deltaEncode(p.lon, ORIGIN[0]), deltaEncode(p.lat, ORIGIN[1])]);
        shapes.push({ id: row.id, route: row.route, dir: -1, d: chainEncodeXY(units), e: [], len: round1(cum[cum.length - 1]) });
        planeByShapeIdx.push(simplifiedPlane);
        cumByShapeIdx.push(cum);
        bboxByShapeIdx.push(bboxExpanded(simplifiedPlane, STOP_SHAPE_MAX_METRES));
      }
    }

    const edgeLinks = stops.map(() => []); // stopIdx -> [{ edge, s }] in metres, within STOP_SHAPE_MAX_METRES
    // The same, within SERVED_STOP_MAX_METRES: which rails a line's own stop
    // may sit on, which is the question the synthetic-path router asks. A
    // superset of edgeLinks, and never written to the wire (F8b).
    const routerLinks = stops.map(() => []); // stopIdx -> [{ edge, s }] in metres
    const shapeLinks = stops.map(() => []); // stopIdx -> [{ shape, frac }]

    // Stop-transfer overrides: the sample trip's first and last stop of every
    // shape link to its first edge at arc 0 and its last edge at its full
    // length (trams), or to the shape at fraction 0 and 1 (buses).
    const overriddenEdge = stops.map(() => new Set());
    const overriddenShape = stops.map(() => new Set());
    shapes.forEach((shape, shapeIdx) => {
      const sampleTripId = shapeSampleTrip.get(shape.id);
      const ends = sampleTripId ? tripEndpoints.get(sampleTripId) : undefined;
      if (!ends) return;
      const first = stopIndexById.get(ends.firstStop);
      const last = stopIndexById.get(ends.lastStop);
      if (shape.e.length > 0) {
        const firstEdge = shape.e[0];
        const lastEdge = shape.e[shape.e.length - 1];
        if (first !== undefined) {
          edgeLinks[first].push({ edge: firstEdge, s: 0 });
          routerLinks[first].push({ edge: firstEdge, s: 0 });
          overriddenEdge[first].add(firstEdge);
        }
        if (last !== undefined) {
          edgeLinks[last].push({ edge: lastEdge, s: edgeLen[lastEdge] });
          routerLinks[last].push({ edge: lastEdge, s: edgeLen[lastEdge] });
          overriddenEdge[last].add(lastEdge);
        }
      } else {
        if (first !== undefined) {
          shapeLinks[first].push({ shape: shapeIdx, frac: 0 });
          overriddenShape[first].add(shapeIdx);
        }
        if (last !== undefined) {
          shapeLinks[last].push({ shape: shapeIdx, frac: 1 });
          overriddenShape[last].add(shapeIdx);
        }
      }
    });

    for (let si = 0; si < stops.length; si++) {
      const p = stopPlane[si];
      for (let e = 0; e < graph.edges.length; e++) {
        if (overriddenEdge[si].has(e) || !inBbox(p, edgeBbox[e])) continue;
        const near = nearestOnPolyline(p, edgePlane[e], edgeCum[e]);
        if (near.dist > SERVED_STOP_MAX_METRES) continue;
        routerLinks[si].push({ edge: e, s: near.arc });
        if (near.dist <= STOP_SHAPE_MAX_METRES) edgeLinks[si].push({ edge: e, s: near.arc });
      }
      for (let shapeIdx = 0; shapeIdx < shapes.length; shapeIdx++) {
        if (shapes[shapeIdx].e.length > 0 || overriddenShape[si].has(shapeIdx) || !inBbox(p, bboxByShapeIdx[shapeIdx])) continue;
        const poly = planeByShapeIdx[shapeIdx];
        if (poly.length < 2) continue;
        const near = nearestOnPolyline(p, poly, cumByShapeIdx[shapeIdx]);
        if (near.dist <= STOP_SHAPE_MAX_METRES) {
          const len = cumByShapeIdx[shapeIdx][cumByShapeIdx[shapeIdx].length - 1];
          shapeLinks[si].push({ shape: shapeIdx, frac: len > 0 ? clamp01(near.arc / len) : 0 });
        }
      }
    }
    // Encode: sorted by index, chain-delta on the index, the arc as decimetres
    // (edges) or as the scaled fraction (bus shapes). One link per edge or
    // shape per stop -- a stop within reach of an edge twice (a loop) keeps the
    // nearer, first-found arc.
    const encodeEdgeLinks = (links) => {
      const byEdge = new Map();
      for (const link of links) if (!byEdge.has(link.edge)) byEdge.set(link.edge, link.s);
      let prev = 0;
      return [...byEdge]
        .sort((a, b) => a[0] - b[0])
        .map(([edge, s]) => {
          const wire = [edge - prev, Math.round(s * 10)];
          prev = edge;
          return wire;
        });
    };
    // Held here, not written onto the shared `stops` rows: this derivation may
    // be the one on a graph the build goes on to discard (the prune pass
    // below), and an edge index from a graph that was not shipped is a stop
    // sitting on the wrong rail, or on no rail at all. The chosen derivation's
    // links are copied onto the rows once, after the graph is settled.
    const stopOnEdge = [];
    const stopOn = [];
    for (let si = 0; si < stops.length; si++) {
      stopOnEdge.push(encodeEdgeLinks(edgeLinks[si]));
      let prev = 0;
      const byShape = new Map();
      for (const link of shapeLinks[si]) if (!byShape.has(link.shape)) byShape.set(link.shape, link.frac);
      stopOn.push(
        [...byShape]
          .sort((a, b) => a[0] - b[0])
          .map(([shape, frac]) => {
            const wire = [shape - prev, Math.round(frac * BUS_ON_FRAC_SCALE)];
            prev = shape;
            return wire;
          }),
      );
    }

    // --- Served stops (F8): per path, the platforms its own trips call at, in
    // arc order, as [stopIdx, decimetres] pairs. The arc is the stop's own
    // geometric link on an edge of that path -- the first one past the stop
    // called before it, so an out-and-back path puts a platform on the leg the
    // line is actually on when it calls there. A served stop the path's edges
    // do not link -- a platform just outside the 40 m radius of the rails this
    // line runs -- is projected onto the path's polyline when it lies within
    // SERVED_STOP_MAX_METRES of it, and otherwise reported by name and dropped,
    // since an invented arc would move the planner's dwell to the wrong place.
    // A projected stop takes the path's nearest point outright: having no edge
    // link on this path it has only the one candidate, so the call order has
    // nothing to choose between.
    const linksByEdge = stops.map((_, si) => {
      const byEdge = new Map();
      for (const link of edgeLinks[si]) if (!byEdge.has(link.edge)) byEdge.set(link.edge, link.s);
      return byEdge;
    });
    const offsetsOfEdges = (edgeSeq) => {
      const offsets = [];
      let len = 0;
      for (const e of edgeSeq) {
        offsets.push(len);
        len += edgeLen[e];
      }
      return offsets;
    };
    const planeOfEdges = (edgeSeq) => {
      const plane = [];
      for (const e of edgeSeq) {
        const pts = edgePlane[e];
        for (let i = plane.length === 0 ? 0 : 1; i < pts.length; i++) plane.push(pts[i]);
      }
      return plane;
    };
    const ARC_QUANTUM = 0.1; // the wire's decimetre
    /** The nearer of a polyline's two ends to `p`, with its arc. */
    const nearestEnd = (p, plane, cum) => {
      const first = plane[0];
      const last = plane[plane.length - 1];
      const toFirst = Math.hypot(p.x - first.x, p.y - first.y);
      const toLast = Math.hypot(p.x - last.x, p.y - last.y);
      return toLast <= toFirst ? { at: 'end', arc: cum[cum.length - 1], dist: toLast } : { at: 'start', arc: 0, dist: toFirst };
    };
    let servedProjected = 0;
    let servedUnordered = 0;
    const servedDropped = [];
    const servedTerminus = [];
    /**
     * @param {string} label the path's id, for the report
     * @param {string} routeId
     * @param {readonly number[]} edgeSeq the path's edges
     * @param {Iterable<string>} stopIds the stops its trips call at
     * @param {Map<string, Map<number, number>> | null} extraLinks links the
     *   router used that the wire does not carry (a terminus set back from the
     *   rails, TERMINUS_STOP_MAX_METRES), so a synthetic path keeps its own end
     * @param {readonly string[] | null} order the call order of a trip that runs
     *   this path, which alone resolves a platform lying within reach of both
     *   legs of an out-and-back path (8 paths, 50 platforms on feed 000395)
     * @param {ReadonlySet<string> | null} termini the platforms a trip of this
     *   path starts or ends at: one of those beyond SERVED_STOP_MAX_METRES but
     *   within TERMINUS_STOP_MAX_METRES of the path's first or last point is a
     *   terminus set back past the drawn rails, and is served at that end
     */
    function servedFor(label, routeId, edgeSeq, stopIds, extraLinks = null, order = null, termini = null) {
      const offsets = offsetsOfEdges(edgeSeq);
      let plane = null;
      let cum = null;
      const wanted = new Set(stopIds);
      // The stops the call order knows, in that order, then the rest (a
      // short-turn variant's platform the sample trip never calls at), sorted
      // so the bytes do not depend on a hash iteration order.
      const ordered = [];
      const seen = new Set();
      for (const stopId of order ?? []) {
        if (wanted.has(stopId) && !seen.has(stopId)) {
          seen.add(stopId);
          ordered.push(stopId);
        }
      }
      const rest = [...wanted].filter((id) => !seen.has(id)).sort();
      servedUnordered += rest.length;
      const out = [];
      const place = (stopId, cursor) => {
        const si = stopIndexById.get(stopId);
        if (si === undefined) {
          servedDropped.push({ path: label, route: routeId, stop: stopId, name: '?', metres: null });
          return null;
        }
        const byEdge = extraLinks?.get(stopId) ?? linksByEdge[si];
        const candidates = [];
        for (let k = 0; k < edgeSeq.length; k++) {
          const onEdge = byEdge.get(edgeSeq[k]);
          if (onEdge !== undefined) candidates.push(offsets[k] + onEdge);
        }
        candidates.sort((a, b) => a - b);
        // The first arc past the stop called before this one; failing that the
        // last, which is as far forward as this path can put it.
        let arc = candidates.find((c) => c > cursor);
        if (arc === undefined) arc = candidates[candidates.length - 1];
        if (plane === null) {
          plane = planeOfEdges(edgeSeq);
          cum = cumulative(plane);
        }
        if (arc !== undefined) {
          // A link says where on the path the stop is; the geometry must agree,
          // because not every link was measured: a shape's sample trip has its
          // first and last stop linked to the shape's ends whatever the
          // distance, and a synthetic path's terminus may be linked up to
          // TERMINUS_STOP_MAX_METRES off. So the platform must lie within
          // SERVED_STOP_MAX_METRES of the point it is served at, or, when a
          // trip of this path starts or ends there, within
          // TERMINUS_STOP_MAX_METRES; otherwise it is dropped and reported
          // like a stop no link reached (and on a shape the build refuses it).
          const at = plane.length >= 2 ? pointAtArc(plane, cum, arc) : null;
          const d = at ? Math.hypot(stopPlane[si].x - at.x, stopPlane[si].y - at.y) : 0;
          if (d > SERVED_STOP_MAX_METRES) {
            if (termini?.has(stopId) && d <= TERMINUS_STOP_MAX_METRES) {
              const len = cum[cum.length - 1];
              servedTerminus.push({ path: label, route: routeId, stop: stopId, name: stops[si].name, metres: round1(d), at: arc <= ARC_QUANTUM ? 'start' : arc >= len - ARC_QUANTUM ? 'end' : 'side' });
            } else {
              servedDropped.push({ path: label, route: routeId, stop: stopId, name: stops[si].name, metres: round1(d) });
              return null;
            }
          }
        } else {
          const near = plane.length >= 2 ? nearestOnPolyline(stopPlane[si], plane, cum) : null;
          // A trip's own first or last platform past the end of the drawn rails
          // (Zapruđe 1780_18 lies 130 m beyond the end of 8_18 and 8_42): the
          // tram stands at the end of the path, so that is where it is served.
          const end = near && near.dist > SERVED_STOP_MAX_METRES && termini?.has(stopId) ? nearestEnd(stopPlane[si], plane, cum) : null;
          if (near && near.dist <= SERVED_STOP_MAX_METRES) {
            arc = near.arc;
            servedProjected++;
          } else if (end && end.dist <= TERMINUS_STOP_MAX_METRES) {
            arc = end.arc;
            servedTerminus.push({ path: label, route: routeId, stop: stopId, name: stops[si].name, metres: round1(end.dist), at: end.at });
          } else {
            servedDropped.push({ path: label, route: routeId, stop: stopId, name: stops[si].name, metres: near ? round1(near.dist) : null });
            return null;
          }
        }
        out.push([si, Math.round(arc * 10)]);
        return arc;
      };
      let cursor = -Infinity;
      for (const stopId of ordered) {
        const arc = place(stopId, cursor);
        if (arc !== null) cursor = arc;
      }
      for (const stopId of rest) place(stopId, -Infinity);
      // Arc order, a tie broken by stop index: the same feed must give the same bytes.
      out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      return out;
    }

    // --- Synthetic paths for tram patterns whose trips carry no shape_id
    // (lines 1, 2, 4, 5, 6, 7, 9, 12, 13, 14, 17): the shortest path over the
    // directed graph visiting the pattern's stops in order, one per distinct
    // (route, direction, stop sequence). The router walks the stops' links
    // within SERVED_STOP_MAX_METRES, not the 40 m geometric ones (F8b): the
    // question here is which rails the line's own stop sits on, the same
    // question the served list answers. A stop with no rail within that radius
    // -- and not a terminus the 200 m override reaches -- fails the build by
    // name, unless `unreachableStops` in the overrides file says why it is
    // right to route past it.
    const allowedUnreachable = new Map(
      (overrides.unreachableStops ?? []).map((entry) => [typeof entry === 'string' ? entry : entry.id, entry]),
    );
    const unreachableAllowed = [];
    const patterns = new Map(); // key -> { route, dir, stops }
    for (const tripId of shapelessTramTrips) {
      const seq = tripSequences.get(tripId);
      const trip = shapelessTrips.get(tripId);
      if (!seq || seq.length < 2 || !trip) continue;
      const key = `${trip.route}|${trip.direction}|${seq.join(',')}`;
      if (!patterns.has(key)) patterns.set(key, { route: trip.route, dir: trip.direction, stops: seq });
    }
    const paths = [];
    const trimmed = [];
    const unroutable = [];
    const longLegs = [];
    for (const pattern of [...patterns.values()].sort((a, b) => compareRouteIds(a.route, b.route) || a.dir - b.dir || a.stops.join().localeCompare(b.stops.join()))) {
      const label = `path:${pattern.route}:${pattern.dir}:${stopSequenceHash(pattern.stops)}`;
      const routedStops = [];
      const links = [];
      pattern.stops.forEach((stopId, k) => {
        const si = stopIndexById.get(stopId);
        if (si === undefined) throw new Error(`${label}: stop ${stopId} of route ${pattern.route} is not in stops.txt`);
        // The 60 m router radius is for a line's INTERIOR stops, where the
        // platform can sit nearer the opposite track than its own (Olipska,
        // F8b). At an end it only widens the choice of where to START, and the
        // router then prefers whichever edge leaves least to walk -- which put
        // three route-4 paths on a 61 m lead-in edge their own shape does not
        // draw instead of the 1,009 m one it does. The ends therefore keep the
        // 40 m geometric list, and the 200 m terminus override below still
        // covers the real case (line 1 out of Zapadni kolodvor).
        const atEnd = k === 0 || k === pattern.stops.length - 1;
        let list = atEnd ? edgeLinks[si] : routerLinks[si];
        if (list.length === 0 && atEnd) {
          // A terminus set back from the drawn rails: the nearest edge within the
          // terminus tolerance starts or ends the route (TERMINUS_STOP_MAX_METRES).
          // For routing only: the stop is NOT linked to that edge on the wire,
          // whose lines do not serve it (Zapadni kolodvor would list lines 2 and
          // 11); the twin runs the stretch to the platform off-graph.
          const p = stopPlane[si];
          let best = null;
          for (let e = 0; e < graph.edges.length; e++) {
            const near = nearestOnPolyline(p, edgePlane[e], edgeCum[e]);
            if (near.dist <= TERMINUS_STOP_MAX_METRES && (!best || near.dist < best.dist)) best = { edge: e, s: near.arc, dist: near.dist };
          }
          if (best) list = [{ edge: best.edge, s: best.s }];
        }
        if (list.length === 0) {
          const allowed = allowedUnreachable.get(stopId);
          if (!allowed) {
            throw new Error(
              `${label} (route ${pattern.route}): stop ${stopId} "${stops[si].name}" is more than ${SERVED_STOP_MAX_METRES} m ` +
                `from every rail edge the feed's shapes draw. If the line really calls at a platform off the rails, name it in ` +
                `unreachableStops in ${OVERRIDES_PATH} with the reason; otherwise the feed or the graph is wrong.`,
            );
          }
          unreachableAllowed.push({ path: label, route: pattern.route, stop: stopId, name: stops[si].name, reason: typeof allowed === 'string' ? '' : (allowed.reason ?? '') });
          return; // routed past: the path neither runs to it nor serves it
        }
        routedStops.push(stopId);
        links.push(list);
      });
      // A terminus stretch no shape draws (line 1 leaving Zapadni kolodvor runs
      // rails only its own missing shape would carry) cannot be routed; up to
      // TERMINUS_TRIM_STOPS stops at either end are dropped from the path, said
      // so in the report, and left to the twin as off-graph running. A gap in
      // the middle of a pattern is a data error and fails the build.
      let from = 0;
      let to = routedStops.length - 1;
      let edgesOnPath = null;
      if (to < 1) throw new Error(`${label} (route ${pattern.route}): fewer than two stops on the rail graph`);
      while (edgesOnPath === null) {
        try {
          edgesOnPath = pathThroughStops(graph.edges, outgoing, edgeLen, links.slice(from, to + 1), `${label} (route ${pattern.route})`, (k) => {
            const stopId = routedStops[from + k];
            const si = stopIndexById.get(stopId);
            const name = si === undefined ? "?" : stops[si].name;
            const on = links[from + k].map((l) => `${l.edge}@${Math.round(l.s)}m`).join(",");
            return `stop ${from + k} ${stopId} "${name}" [edges ${on}]`;
          });
        } catch (error) {
          const leg = typeof error.leg === "number" ? from + error.leg : -1;
          if (leg >= 0 && leg <= from + TERMINUS_TRIM_STOPS) from = leg;
          else if (leg >= 0 && leg >= to - TERMINUS_TRIM_STOPS + 1) to = leg - 1;
          else {
            // Rails between two interior stops that no shape draws (a diversion
            // or a crossover only short-turning trips use): the pattern gets no
            // path rather than a wrong one, and the report says so by name; its
            // trips stay on geometric matching within their route.
            unroutable.push({ id: label, route: pattern.route, reason: error.message });
            edgesOnPath = undefined;
            break;
          }
          if (to - from < 1) throw new Error(`${label} (route ${pattern.route}): fewer than two stops on the rail graph`);
        }
      }
      if (edgesOnPath === undefined) continue;
      const covered = routedStops.slice(from, to + 1);
      if (from > 0 || to < routedStops.length - 1) {
        trimmed.push({ id: label, leading: routedStops.slice(0, from), trailing: routedStops.slice(to + 1) });
      }
      // The served list of a synthetic path is its own routed stop sequence.
      // Its links are the ones the router walked, which for a terminus set
      // back from the rails is the nearest edge within TERMINUS_STOP_MAX_METRES
      // and is on no wire link of that stop.
      const routed = new Map();
      for (let k = from; k <= to; k++) {
        const byEdge = new Map();
        for (const link of links[k]) if (!byEdge.has(link.edge)) byEdge.set(link.edge, link.s);
        routed.set(routedStops[k], byEdge);
      }
      const served = servedFor(label, pattern.route, edgesOnPath, covered, routed, covered, new Set([covered[0], covered[covered.length - 1]]));
      // The honest measure of what the feed's shapes fail to draw: a hop whose
      // routed arc runs far past the straight line between its two platforms
      // means the graph has no node where the line turns (HOP_DETOUR_FACTOR).
      for (let k = 1; k < served.length; k++) {
        const [prevIdx, prevDm] = served[k - 1];
        const [thisIdx, thisDm] = served[k];
        const along = (thisDm - prevDm) / 10;
        const a = stopPlane[prevIdx];
        const b = stopPlane[thisIdx];
        const straight = Math.hypot(a.x - b.x, a.y - b.y);
        if (along > straight * HOP_DETOUR_FACTOR && along - straight > HOP_DETOUR_EXCESS_METRES) {
          longLegs.push({ path: label, route: pattern.route, from: stops[prevIdx].name, to: stops[thisIdx].name, along: round1(along), straight: round1(straight), fromIdx: prevIdx, toIdx: thisIdx });
        }
      }
      paths.push({ id: label, route: pattern.route, dir: pattern.dir, e: edgesOnPath, stops: covered, served });
    }

    // Every tram shape is a path too: the union of the stops of every trip that
    // runs it, so a short-turn variant's platforms are covered as well.
    for (const shape of shapes) {
      const sample = shapeSampleTrip.get(shape.id);
      shape.served =
        shape.e.length > 0
          ? servedFor(shape.id, shape.route, shape.e, servedByShape.get(shape.id) ?? [], null, (sample && tripSequences.get(sample)) ?? null, shapeTermini.get(shape.id) ?? null)
          : [];
    }
    servedDropped.sort((a, b) => a.path.localeCompare(b.path) || a.stop.localeCompare(b.stop));

    // --- Terminus loop paths (see LOOP_DIRECTION). Held apart from `paths`
    // until the artefact is assembled: the junction prune pass and the
    // long-leg rule are about the patterns' own paths, and a loop runs from
    // one trip's end to the next trip's start, which is no hop of any
    // timetable. Its served list is the two platforms at the arcs they have
    // on the arriving path's last edge and the departing path's first edge;
    // a platform that lies on neither (the arriving path runs on past its
    // last stop) is simply not on the loop.
    const loopPaths = [];
    const loopSkipped = [];
    const loopDuplicates = [];
    let loopPairs = 0;
    {
      const ARC_EPS = 0.1; // the wire's decimetre quantum
      const lengthOf = (edgeSeq) => edgeSeq.reduce((n, e) => n + edgeLen[e], 0);
      const ends = new Map(); // route -> Map<L stopIdx, Map<last edge, arc of L on it | null>>
      const starts = new Map(); // route -> Map<F stopIdx, Map<first edge, arc of F on it | null>>
      const arrivingIds = new Map(); // `${L}|${edge}` -> the ids of the paths that end at L on that edge
      const note = (byRoute, route, stopIdx, edge, arcOnEdge) => {
        let byStop = byRoute.get(route);
        if (!byStop) byRoute.set(route, (byStop = new Map()));
        let byEdge = byStop.get(stopIdx);
        if (!byEdge) byStop.set(stopIdx, (byEdge = new Map()));
        if (!byEdge.has(edge) || (byEdge.get(edge) === null && arcOnEdge !== null)) byEdge.set(edge, arcOnEdge);
      };
      const routePaths = [
        ...shapes.filter((sh) => sh.e.length > 0).map((sh) => ({ id: sh.id, route: sh.route, e: sh.e, served: sh.served })),
        ...paths.map((pa) => ({ id: pa.id, route: pa.route, e: pa.e, served: pa.served })),
      ];
      for (const { id, route, e, served } of routePaths) {
        if (served.length > 0) {
          const key = `${served[served.length - 1][0]}|${e[e.length - 1]}`;
          if (!arrivingIds.has(key)) arrivingIds.set(key, []);
          arrivingIds.get(key).push(id);
        }
        if (served.length === 0) continue;
        const lastEdge = e[e.length - 1];
        const [lIdx, lDm] = served[served.length - 1];
        const onLast = lDm / 10 - (lengthOf(e) - edgeLen[lastEdge]);
        // Clamped to the edge: the served arc is rounded to the decimetre, and a
        // platform at the very end must not land a quantum into the next edge.
        note(ends, route, lIdx, lastEdge, onLast >= -ARC_EPS ? Math.min(edgeLen[lastEdge], Math.max(0, onLast)) : null);
        const firstEdge = e[0];
        const [fIdx, fDm] = served[0];
        const onFirst = fDm / 10;
        note(starts, route, fIdx, firstEdge, onFirst <= edgeLen[firstEdge] + ARC_EPS ? Math.min(edgeLen[firstEdge], onFirst) : null);
      }
      const byStopId = (map) => [...map.keys()].sort((a, b) => stops[a].id.localeCompare(stops[b].id));
      // Where a boundary edge may be cut: at least LOOP_CUT_CLEAR_METRES from
      // every platform a path over that edge serves, so the new node draws no
      // platform's link to itself (a link to an edge's end stands in for a
      // projection past it, and the served list would take the earlier arc).
      const servedOn = new Map(); // edge -> stop indices served by a path over it
      for (const { e, served } of routePaths) {
        for (const edge of e) {
          if (!servedOn.has(edge)) servedOn.set(edge, new Set());
          for (const [si] of served) servedOn.get(edge).add(si);
        }
      }
      const clearAt = (edge, arc) => {
        const p = pointAtArc(edgePlane[edge], edgeCum[edge], arc);
        for (const si of servedOn.get(edge) ?? []) if (Math.hypot(stopPlane[si].x - p.x, stopPlane[si].y - p.y) < LOOP_CUT_CLEAR_METRES) return false;
        return true;
      };
      const CUT_STEP_METRES = 5;
      /** The loop's start on its arriving edge: `arc`, or earlier until clear. */
      const cutBefore = (edge, arc) => {
        for (let at = arc; at > LOOP_CUT_MIN_METRES; at -= CUT_STEP_METRES) if (clearAt(edge, at)) return at;
        return 0;
      };
      /** The loop's end on its departing edge: `arc`, or later until clear. */
      const cutAfter = (edge, arc) => {
        for (let at = arc; at < edgeLen[edge] - LOOP_CUT_MIN_METRES; at += CUT_STEP_METRES) if (clearAt(edge, at)) return at;
        return edgeLen[edge];
      };
      const usedIds = new Set();
      for (const route of [...ends.keys()].sort(compareRouteIds)) {
        const arrivalsAt = ends.get(route);
        const departuresFrom = starts.get(route);
        if (!departuresFrom) continue;
        const seen = new Set(); // edge sequences already built for this route
        for (const L of byStopId(arrivalsAt)) {
          for (const F of byStopId(departuresFrom)) {
            if (L === F) continue;
            const apart = Math.hypot(stopPlane[L].x - stopPlane[F].x, stopPlane[L].y - stopPlane[F].y);
            if (apart > LOOP_PAIR_MAX_METRES) continue;
            loopPairs++;
            const departures = departuresFrom.get(F);
            const targets = [...departures.keys()].sort((a, b) => a - b).map((edge) => ({ edge, s: 0 }));
            const arrivals = arrivalsAt.get(L);
            // One route per arriving edge: two variants that reach L along
            // different rails each need their own way round.
            const viaOf = (edge) => [...(arrivingIds.get(`${L}|${edge}`) ?? [])].sort()[0] ?? '';
            for (const lastEdge of [...arrivals.keys()].sort((a, b) => viaOf(a).localeCompare(viaOf(b)) || a - b)) {
              const named = { route, from: stops[L].id, fromName: stops[L].name, to: stops[F].id, toName: stops[F].name, apart: round1(apart) };
              const leg = routeBetween(graph.edges, outgoing, edgeLen, [{ edge: lastEdge, s: edgeLen[lastEdge] }], targets);
              if (!leg) {
                loopSkipped.push({ ...named, reason: 'no directed route' });
                continue;
              }
              const e = leg.path;
              const onL = arrivals.get(lastEdge);
              const onF = departures.get(leg.end.edge);
              // Only the terminal end of the two boundary edges belongs to the
              // loop: from LOOP_LEAD_METRES before the arriving platform (or the
              // edge's last LOOP_LEAD_METRES when the platform is not on it) and
              // to LOOP_LEAD_METRES past the departing one. Longer boundary edges
              // are cut there (splitLoopEdges), so the length the cap is held to
              // is the length the exported path has.
              const departEdge = e[e.length - 1];
              const projL = nearestOnPolyline(stopPlane[L], edgePlane[lastEdge], edgeCum[lastEdge]).arc;
              const projF = nearestOnPolyline(stopPlane[F], edgePlane[departEdge], edgeCum[departEdge]).arc;
              const cutFirst = cutBefore(lastEdge, (onL !== null ? Math.min(onL, projL) : edgeLen[lastEdge]) - LOOP_LEAD_METRES);
              const cutLast = cutAfter(departEdge, (onF !== null ? Math.max(onF, projF) : 0) + LOOP_LEAD_METRES);
              const metres = lengthOf(e) - cutFirst - (edgeLen[departEdge] - cutLast);
              if (metres > LOOP_MAX_METRES) {
                loopSkipped.push({ ...named, reason: 'too long', metres: round1(metres) });
                continue;
              }
              const key = e.join(',');
              if (seen.has(key)) {
                loopDuplicates.push(named);
                continue;
              }
              const lastOffset = lengthOf(e) - edgeLen[departEdge];
              const served = [];
              if (onL !== null) served.push([L, Math.round(onL * 10)]);
              if (onF !== null) served.push([F, Math.round((lastOffset + onF) * 10)]);
              served.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
              if (served.length === 0) {
                loopSkipped.push({ ...named, reason: 'neither platform on the loop' });
                continue;
              }
              seen.add(key);
              // Named by what it joins, like a synthetic path by what it visits;
              // a second way round between the same two platforms is named by
              // the arriving path as well (the first of them by id), which no
              // cut of the graph renumbers.
              let id = `${LOOP_ID_PREFIX}${route}:${stopSequenceHash([stops[L].id, stops[F].id])}`;
              if (usedIds.has(id)) id = `${LOOP_ID_PREFIX}${route}:${stopSequenceHash([stops[L].id, stops[F].id, viaOf(lastEdge)])}`;
              usedIds.add(id);
              const cuts = [];
              if (cutFirst > LOOP_CUT_MIN_METRES) cuts.push({ edge: lastEdge, at: cutFirst });
              if (edgeLen[departEdge] - cutLast > LOOP_CUT_MIN_METRES) cuts.push({ edge: departEdge, at: cutLast });
              loopPaths.push({ id, route, dir: LOOP_DIRECTION, e, stops: [stops[L].id, stops[F].id], served, metres: round1(metres), between: round1(leg.cost), cuts, ...named });
            }
          }
        }
      }
    }

    return {
      edgeUnits, shapes, planeByShapeIdx, stopOn, stopOnEdge, paths, trimmed, unroutable, longLegs, unreachableAllowed,
      servedProjected, servedUnordered, servedDropped, servedTerminus, loopPaths, loopPairs, loopSkipped, loopDuplicates,
    };
  }

  // --- F8c: node the crossings the reported long legs need, and only those.
  //
  // ZET's shapes draw every movement some trip runs, so where a line turns
  // out of one street into another and NO shape draws that turn, the two
  // polylines merely cross and the graph has no node there: the router goes
  // round the block, and a plan 2 km long for 300 m of ground puts a phantom
  // tram on other lines' shared rails, where the ordering law then constrains
  // real ones. The repair is driven by the long legs the router itself
  // reports, never by the geometry at large -- a node where two tracks cross
  // grows turns in every direction, and a network full of turns no tram takes
  // is a worse model than one detour.
  //
  // Three cuts at most: the plain one, one with every crossing the reported
  // legs could use, and one with only the crossings a path then actually
  // turns at. A crossing nothing turns at is not a junction this feed needs.

  /** Every crossing the given long legs could turn at: a true segment-segment
   *  intersection between two edges that both pass near one of the leg's own
   *  platforms and that share no node yet. */
  const junctionsForLegs = (graph, longLegs) => {
    const rawPlane = graph.edges.map((e) => e.units.map(unitsToMetres));
    const rawCum = rawPlane.map(cumulative);
    const rawBbox = rawPlane.map((plane) => bboxExpanded(plane, JUNCTION_SEARCH_METRES));
    const found = new Map(); // unit key -> the junction
    for (const leg of longLegs) {
      const { fromIdx, toIdx, ...named } = leg;
      const ends = [stopPlane[fromIdx], stopPlane[toIdx]];
      const near = [];
      for (let e = 0; e < rawPlane.length; e++) {
        if (!ends.some((p) => inBbox(p, rawBbox[e]))) continue;
        if (ends.some((p) => nearestOnPolyline(p, rawPlane[e], rawCum[e]).dist <= JUNCTION_SEARCH_METRES)) near.push(e);
      }
      for (let i = 0; i < near.length; i++) {
        for (let j = i + 1; j < near.length; j++) {
          const a = near[i];
          const b = near[j];
          // Already one junction: the feed draws these two meeting, so the
          // movement the leg wants is not the one missing here.
          const [ea, eb] = [graph.edges[a], graph.edges[b]];
          if (ea.from === eb.from || ea.from === eb.to || ea.to === eb.from || ea.to === eb.to) continue;
          const hits = polylineCrossings(rawPlane[a], rawCum[a], rawPlane[b], rawCum[b]).filter((h) => h.angle >= JUNCTION_MIN_ANGLE_DEG);
          if (hits.length === 0) continue;
          // Two tracks that cross and cross straight back swap sides rather
          // than meet; a node there would offer a crossover no tram uses.
          const twin = hits.some((h, k) =>
            hits.some((o, m) => m !== k && (Math.abs(o.arcA - h.arcA) <= JUNCTION_TWIN_CROSSING_METRES || Math.abs(o.arcB - h.arcB) <= JUNCTION_TWIN_CROSSING_METRES)),
          );
          if (twin) continue;
          for (const hit of hits) {
            const u = unitsFromMetres(hit.p);
            const q = unitsToMetres(u);
            const offset = Math.max(nearestOnPolyline(q, rawPlane[a], rawCum[a]).dist, nearestOnPolyline(q, rawPlane[b], rawCum[b]).dist);
            if (offset > JUNCTION_MAX_OFFSET_METRES) continue; // rounded off both polylines: not a split point
            const key = unitKey(u);
            let junction = found.get(key);
            if (!junction) {
              found.set(key, (junction = { u, key, lonLat: [round4(ORIGIN[0] + u[0] * SCALE), round4(ORIGIN[1] + u[1] * SCALE)], angle: round1(hit.angle), offsetMetres: Math.round(offset * 100) / 100, segs: [], edgesBefore: [], legs: [] }));
            }
            for (const [edge, seg] of [[a, hit.segA], [b, hit.segB]]) {
              const pair = [graph.edges[edge].units[seg], graph.edges[edge].units[seg + 1]];
              if (!junction.segs.some(([x, y]) => unitKey(x) === unitKey(pair[0]) && unitKey(y) === unitKey(pair[1]))) junction.segs.push(pair);
              if (!junction.edgesBefore.includes(edge)) junction.edgesBefore.push(edge);
            }
            if (!junction.legs.some((l) => l.path === named.path && l.from === named.from && l.to === named.to)) junction.legs.push(named);
          }
        }
      }
    }
    // Sorted by the split point, so the same feed always makes the same graph.
    return [...found.values()].sort((x, y) => x.u[0] - y.u[0] || x.u[1] - y.u[1]);
  };

  /** True when some synthetic path TURNS at this junction's node: arrives on
   *  one track and leaves on the other. A path that runs straight through did
   *  not need the node -- before the split those two pieces were one edge. */
  const turnsAt = (graph, derived, junction) => {
    const node = graph.junctionNodes.get(junction.key);
    if (node === null || node === undefined) return false;
    const unitDir = (from, to) => {
      const d = { x: to.x - from.x, y: to.y - from.y };
      const mag = Math.hypot(d.x, d.y);
      return mag === 0 ? null : { x: d.x / mag, y: d.y / mag };
    };
    for (const path of derived.paths) {
      for (let k = 1; k < path.e.length; k++) {
        const into = graph.edges[path.e[k - 1]];
        const out = graph.edges[path.e[k]];
        if (into.to !== node || out.from !== node) continue;
        const a = into.units.map(unitsToMetres);
        const b = out.units.map(unitsToMetres);
        const inDir = unitDir(a[a.length - 2], a[a.length - 1]);
        const outDir = unitDir(b[0], b[1]);
        if (!inDir || !outDir) continue;
        const deg = (Math.acos(Math.max(-1, Math.min(1, inDir.x * outDir.x + inDir.y * outDir.y))) * 180) / Math.PI;
        if (deg >= JUNCTION_MIN_ANGLE_DEG) return true;
      }
    }
    return false;
  };

  // --- Connectors: the turns the overrides file names because no shape draws
  // them and no crossing could be noded (see CONNECTOR_SNAP_METRES). Each is
  // one directed edge between two nodes the chosen graph already has, found by
  // coordinate and appended after its own edges, so no other edge index moves.
  // They are added AFTER the junction pass, and everything the graph decides
  // is then derived once more: present earlier, a connector would steer that
  // pass -- on feed 000395 the westbound Zrinjevac -> Botanički vrt legs of
  // routes 6 and 17 route round the block through the Glavni kolodvor
  // connector, stop being long, and the crossing they really turn at is never
  // noded. A connector therefore repairs a turn the router otherwise takes the
  // long way round; it cannot give a pattern its only route.
  const connectorEntries = overrides.connectors ?? [];
  const connect = (g) => {
    if (connectorEntries.length === 0) return { graph: g, connectors: [] };
    const nodeUnits = new Map(); // node -> units, from any edge that starts or ends there
    const endsAt = new Set(); // nodes some edge ends at
    const startsAt = new Set(); // nodes some edge starts at
    for (const e of g.edges) {
      nodeUnits.set(e.from, e.units[0]);
      nodeUnits.set(e.to, e.units[e.units.length - 1]);
      startsAt.add(e.from);
      endsAt.add(e.to);
    }
    const nodeNear = (lonLat, among, what, entry) => {
      const p = toMetres(lonLat[0], lonLat[1]);
      const found = [...among].filter((node) => {
        const q = unitsToMetres(nodeUnits.get(node));
        return Math.hypot(p.x - q.x, p.y - q.y) <= CONNECTOR_SNAP_METRES;
      });
      if (found.length !== 1) {
        throw new Error(
          `Connector ${JSON.stringify(entry.from)} -> ${JSON.stringify(entry.to)} (routes ${(entry.routes ?? []).join(', ')}): ` +
            `${found.length === 0 ? 'no' : found.length} node(s) where an edge ${what} within ${CONNECTOR_SNAP_METRES} m of ${lonLat.join(',')}. ` +
            `A connector joins two nodes the rail graph already has; fix the coordinate in ${OVERRIDES_PATH} or remove the entry.`,
        );
      }
      return found[0];
    };
    const added = [];
    const listed = [];
    for (const entry of connectorEntries) {
      const from = nodeNear(entry.from, endsAt, 'ends', entry);
      const to = nodeNear(entry.to, startsAt, 'starts', entry);
      const units = [nodeUnits.get(from), nodeUnits.get(to)].map((u) => [u[0], u[1]]);
      const a = unitsToMetres(units[0]);
      const b = unitsToMetres(units[1]);
      // Refused when it joins nothing, repeats another connector, or the feed
      // itself now draws a track about as direct between the two nodes: then
      // the turn is no longer missing and the entry is stale.
      const chord = Math.hypot(a.x - b.x, a.y - b.y);
      const drawn = g.edges.find((e) => e.from === from && e.to === to && cumulative(e.units.map(unitsToMetres)).at(-1) <= 2 * chord);
      if (from === to || drawn || added.some((e) => e.from === from && e.to === to)) {
        throw new Error(`Connector ${JSON.stringify(entry.from)} -> ${JSON.stringify(entry.to)}: nodes ${from} -> ${to} are already joined; the connector adds nothing.`);
      }
      listed.push({ ...entry, fromNode: from, toNode: to, edge: g.edges.length + added.length, metres: Math.round(chord * 100) / 100 });
      added.push({ from, to, units, owners: new Set() });
    }
    return { graph: { ...g, edges: [...g.edges, ...added] }, connectors: listed };
  };

  let graph = baseGraph;
  let derived = deriveFromGraph(graph);
  let junctions = [];
  let junctionsConsidered = 0;
  const longLegsBeforeNoding = derived.longLegs.length;
  if (derived.longLegs.length > 0) {
    const candidates = junctionsForLegs(baseGraph, derived.longLegs);
    junctionsConsidered = candidates.length;
    if (candidates.length > 0) {
      const wide = cutWithJunctions(candidates);
      const wideDerived = deriveFromGraph(wide);
      const kept = candidates.filter((junction) => turnsAt(wide, wideDerived, junction));
      if (kept.length === candidates.length) {
        graph = wide;
        derived = wideDerived;
      } else if (kept.length > 0) {
        graph = cutWithJunctions(kept);
        derived = deriveFromGraph(graph);
      }
      junctions = kept;
      for (const junction of junctions) {
        const node = graph.junctionNodes.get(junction.key);
        junction.node = node;
        junction.edgesAfter = graph.edges.flatMap((e, idx) => (e.from === node || e.to === node ? [idx] : []));
      }
    }
  }
  const { graph: connected, connectors } = connect(graph);
  if (connectors.length > 0) {
    graph = connected;
    derived = deriveFromGraph(graph);
  }

  // --- Terminus loops keep only the terminal end of their two boundary edges
  // (LOOP_LEAD_METRES): each long boundary edge is cut at a vertex of its own
  // rails there, the loops and everything else are derived once more, and a
  // loop is then held to LOOP_MAX_METRES on the path it exports. Cutting an
  // edge moves no rail: every path over it runs the two halves instead. The
  // first half keeps the edge's index and the others are appended, so no
  // other edge index moves.
  const cutsByEdge = new Map();
  for (const loop of derived.loopPaths) {
    for (const cut of loop.cuts) {
      if (!cutsByEdge.has(cut.edge)) cutsByEdge.set(cut.edge, []);
      cutsByEdge.get(cut.edge).push(cut.at);
    }
  }
  let loopCuts = [];
  if (cutsByEdge.size > 0) {
    const edges = graph.edges.map((e) => e);
    const pieces = new Map(); // edge -> its pieces' indices, in travel order
    let nodeCount = graph.nodeCount;
    for (const edge of [...cutsByEdge.keys()].sort((a, b) => a - b)) {
      const e = graph.edges[edge];
      if (e.owners.size === 0) continue; // a connector is never cut
      const simple = derived.edgeUnits[edge].map(unitsToMetres);
      const simpleCum = cumulative(simple);
      const len = simpleCum[simpleCum.length - 1];
      const arcs = [];
      for (const arc of [...cutsByEdge.get(edge)].sort((a, b) => a - b)) {
        if (arc <= LOOP_CUT_MIN_METRES || arc >= len - LOOP_CUT_MIN_METRES) continue;
        if (arcs.length > 0 && arc - arcs[arcs.length - 1] < LOOP_CUT_MIN_METRES) continue;
        arcs.push(arc);
      }
      const units = e.units.map((u) => [u[0], u[1]]);
      const cutKeys = [];
      for (const arc of arcs) {
        // The point at that arc of the wire's geometry, placed on the edge's
        // own rails: an existing vertex within a metre, else the lattice
        // point nearest the projection (JUNCTION_MAX_OFFSET_METRES).
        const p = pointAtArc(simple, simpleCum, arc);
        const raw = units.map(unitsToMetres);
        const near = nearestOnPolyline(p, raw, cumulative(raw));
        const a = raw[near.seg];
        const b = raw[near.seg + 1];
        const q = { x: a.x + (b.x - a.x) * near.t, y: a.y + (b.y - a.y) * near.t };
        let idx;
        if (Math.hypot(q.x - a.x, q.y - a.y) <= 1) idx = near.seg;
        else if (Math.hypot(q.x - b.x, q.y - b.y) <= 1) idx = near.seg + 1;
        else {
          const u = unitsFromMetres(q);
          if (unitKey(u) === unitKey(units[near.seg])) idx = near.seg;
          else if (unitKey(u) === unitKey(units[near.seg + 1])) idx = near.seg + 1;
          else {
            units.splice(near.seg + 1, 0, u);
            idx = near.seg + 1;
          }
        }
        if (idx > 0 && idx < units.length - 1) cutKeys.push(unitKey(units[idx]));
      }
      const cutAt = [...new Set(cutKeys)].map((key) => units.findIndex((u, i) => i > 0 && unitKey(u) === key)).sort((x, y) => x - y);
      if (cutAt.length === 0) continue;
      const bounds = [0, ...cutAt, units.length - 1];
      const nodes = [e.from, ...cutAt.map(() => nodeCount++), e.to];
      const list = [];
      for (let k = 0; k + 1 < bounds.length; k++) {
        const piece = { from: nodes[k], to: nodes[k + 1], units: units.slice(bounds[k], bounds[k + 1] + 1), owners: new Set(e.owners) };
        const index = k === 0 ? edge : edges.length;
        if (k === 0) edges[edge] = piece;
        else edges.push(piece);
        list.push(index);
      }
      pieces.set(edge, list);
      loopCuts.push({ edge, pieces: list, at: arcs.map(round1) });
    }
    if (pieces.size > 0) {
      graph = { ...graph, edges, nodeCount, shapeEdges: graph.shapeEdges.map((seq) => seq.flatMap((e) => pieces.get(e) ?? [e])) };
      derived = deriveFromGraph(graph);
    }
  }
  // Held to the cap on the path it exports: the loop's own edges, end to end.
  {
    const edgeLength = (e) => cumulative(derived.edgeUnits[e].map(unitsToMetres)).at(-1);
    const kept = [];
    for (const loop of derived.loopPaths) {
      const metres = loop.e.reduce((n, e) => n + edgeLength(e), 0);
      const { route, from, fromName, to, toName, apart } = loop;
      if (metres > LOOP_MAX_METRES) derived.loopSkipped.push({ route, from, fromName, to, toName, apart, reason: 'too long', metres: round1(metres) });
      else kept.push({ ...loop, metres: round1(metres) });
    }
    derived.loopPaths = kept;
  }
  // A connector is a turn named for its lines. Every path that runs it must
  // belong to one of them, and some path must: one nothing runs is stale.
  for (const connector of connectors) {
    const users = [...derived.paths, ...derived.loopPaths].filter((path) => path.e.includes(connector.edge));
    connector.usedBy = users.map((path) => path.id);
    const foreign = users.filter((path) => !(connector.routes ?? []).includes(path.route));
    if (users.length === 0 || foreign.length > 0) {
      throw new Error(
        `Connector ${JSON.stringify(connector.from)} -> ${JSON.stringify(connector.to)} (routes ${(connector.routes ?? []).join(', ')}): ` +
          (users.length === 0 ? 'no path runs it, so the turn it names is not one this feed needs' : `run by ${foreign.map((path) => `${path.id} (route ${path.route})`).join(', ')}, a line it does not name`) +
          `; update the entry in ${OVERRIDES_PATH}.`,
      );
    }
  }

  // A leg that still runs long is either a turn the feed's geometry cannot
  // express -- two digitisations that stop near each other without crossing --
  // or a repair that did not take. Either way the build refuses it unless the
  // overrides file says, with a reason, why the detour has to stand.
  const allowedLongLegs = overrides.longLegs ?? [];
  const longLegAllowance = (leg) => allowedLongLegs.find((entry) => entry.from === leg.from && entry.to === leg.to && (!entry.route || entry.route === leg.route));
  const longLegs = derived.longLegs.map(({ fromIdx, toIdx, ...named }) => ({ ...named, allowed: longLegAllowance(named)?.reason ?? null }));
  const refusedLongLegs = longLegs.filter((leg) => leg.allowed === null);
  if (refusedLongLegs.length > 0) {
    const listed = refusedLongLegs.map((leg) => `${leg.path} (route ${leg.route}) ${leg.from} -> ${leg.to}: ${leg.along} m of arc for ${leg.straight} m of ground`).join('; ');
    throw new Error(
      `Rail graph: ${refusedLongLegs.length} hop(s) still route past ${HOP_DETOUR_FACTOR}x the straight line after noding ${junctions.length} crossing(s): ${listed}. ` +
        `If the rails really run that way, name the leg in longLegs in ${OVERRIDES_PATH} with the reason; otherwise the crossing the line turns at is missing from the graph.`,
    );
  }

  // The coverage rule: every platform a trip of a tram SHAPE calls at is on
  // that shape's path -- within SERVED_STOP_MAX_METRES of its rails, or a
  // terminus of one of its trips within TERMINUS_STOP_MAX_METRES of an end
  // (servedFor). Anything else the feed calls at off the drawn rails is a
  // wrong coordinate or a missing shape, and the build refuses it by name
  // unless `servedGaps` in the overrides file says why the gap is real. A
  // synthetic path is held to the same rule as it is routed (unreachableStops,
  // TERMINUS_TRIM_STOPS).
  const allowedGaps = overrides.servedGaps ?? [];
  const tramShapeIds = new Set(derived.shapes.filter((sh) => sh.e.length > 0).map((sh) => sh.id));
  const servedGaps = derived.servedDropped
    .filter((drop) => tramShapeIds.has(drop.path))
    .map((drop) => ({ ...drop, allowed: allowedGaps.find((entry) => entry.path === drop.path && entry.stop === drop.stop)?.reason ?? null }));
  const refusedGaps = servedGaps.filter((gap) => gap.allowed === null);
  if (refusedGaps.length > 0) {
    const listed = refusedGaps.map((gap) => `${gap.path} (route ${gap.route}) calls at ${gap.stop} "${gap.name}", ${gap.metres === null ? 'not in stops.txt' : `${gap.metres} m off its rails`}`).join('; ');
    throw new Error(
      `Served stops: ${refusedGaps.length} platform(s) a shape's own trips call at lie off that shape: ${listed}. ` +
        `If the line really calls there off its drawn rails, name it in servedGaps in ${OVERRIDES_PATH} with the reason; otherwise the stop or the shape is wrong.`,
    );
  }

  const { edgeUnits, shapes, planeByShapeIdx, paths, trimmed, unroutable, unreachableAllowed, servedProjected, servedUnordered, servedDropped, servedTerminus, loopPaths } = derived;
  // The graph is settled: the stops take the links of THAT derivation, and of
  // no other one the prune pass may have made along the way.
  for (let si = 0; si < stops.length; si++) {
    stops[si].onEdge = derived.stopOnEdge[si];
    stops[si].on = derived.stopOn[si];
  }

  // --- The octilinear diagram: one line per shape of every diagram-cut route.
  const rawLines = [];
  for (const route of routes) {
    if (!diagramRouteIds.has(route.id)) continue;
    for (const shapeIdx of route.shapes) {
      const octi = buildOctilinearLine(planeByShapeIdx[shapeIdx], DIAGRAM_SIMPLIFY_METRES);
      if (octi.length < 2) continue;
      rawLines.push({ route: route.id, pts: octi });
    }
  }
  let diagram;
  if (rawLines.length === 0) {
    diagram = { lines: [], box: [0, 0] };
  } else {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const line of rawLines) {
      for (const p of line.pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
    const span = Math.max(maxX - minX, maxY - minY, 1e-6);
    const s = 1 / span;
    diagram = {
      lines: rawLines.map((line) => ({
        route: line.route,
        pts: line.pts.map((p) => [round4((p.x - minX) * s), round4((p.y - minY) * s)]),
      })),
      box: [round4((maxX - minX) * s), round4((maxY - minY) * s)],
    };
  }

  // --- Edges on the wire: one chain across the whole array (decodeEdgeChain).
  const flatUnits = [];
  for (const units of edgeUnits) flatUnits.push(...units);
  const chained = chainEncodeXY(flatUnits);
  const edgeD = [];
  let at = 0;
  for (const units of edgeUnits) {
    edgeD.push(chained.slice(2 * at, 2 * (at + units.length)));
    at += units.length;
  }
  const edges = graph.edges.map((e, idx) => ({ from: e.from, to: e.to, d: edgeD[idx] }));

  const report = {
    tramShapes: tramRows.length,
    edges: edges.length,
    nodes: graph.nodeCount,
    snappedRuns: graph.report.snappedRuns,
    unsharedShareBefore: graph.report.unsharedShareBefore,
    spikePoints: graph.report.spikePoints,
    busUnsharedShare,
    paths: paths.length,
    loopPaths: loopPaths.map(({ id, route, from, fromName, to, toName, apart, metres, between, e, served }) => ({ id, route, from, fromName, to, toName, apart, metres, between, edges: e.length, served: served.length })),
    loopCuts,
    loopPairs: derived.loopPairs,
    loopSkipped: derived.loopSkipped,
    loopDuplicates: derived.loopDuplicates,
    connectors: connectors.map(({ from, to, routes: connectorRoutes, fromNode, toNode, edge, metres, usedBy }) => ({ from, to, routes: connectorRoutes, fromNode, toNode, edge, metres, usedBy })),
    trimmedPaths: trimmed,
    unroutablePaths: unroutable,
    longLegs: longLegs.filter((leg) => leg.allowed === null),
    longLegsAllowed: longLegs.filter((leg) => leg.allowed !== null),
    junctions: junctions.map(({ u, key, segs, ...named }) => ({ ...named, unit: u })),
    junctionsConsidered,
    longLegsBeforeNoding,
    unreachableAllowed,
    residualPairs: graph.report.residualPairs,
    servedPaths: shapes.filter((sh) => sh.served.length > 0).length + paths.filter((pa) => pa.served.length > 0).length,
    servedEntries: shapes.reduce((n, sh) => n + sh.served.length, 0) + paths.reduce((n, pa) => n + pa.served.length, 0),
    servedProjected,
    servedUnordered,
    servedDropped,
    servedTerminus,
    servedGapsAllowed: servedGaps.filter((gap) => gap.allowed !== null),
    terminalStops: stops.filter((st) => st.terminal === 1).length,
  };

  return {
    version: ARTEFACT_VERSION,
    feedVersion,
    // The graph the edge INDICES below belong to (F8c): anything a consumer
    // keys by one -- the twin's learned edge times -- is about a different
    // piece of track once this changes.
    graphHash: graphHashOf(edges),
    builtAt: now().toISOString(),
    origin: ORIGIN,
    scale: SCALE,
    routes: toColumnar(routes, ROUTE_KEYS),
    edges: toColumnar(edges, EDGE_KEYS),
    shapes: toColumnar(shapes, SHAPE_KEYS),
    // The loops go after every pattern's path, so the synthetic paths keep
    // the indices they had before loops existed.
    paths: toColumnar([...paths, ...loopPaths], PATH_KEYS),
    stops: toColumnar(stops, STOP_KEYS),
    diagram: { lines: toColumnar(diagram.lines, LINE_KEYS), box: diagram.box },
    report,
  };
}

function renderNetworkMeta({ feedVersion, builtAt, routeCount, edgeCount, byteSize }) {
  return (
    `// Generated by scripts/gtfs-shapes.mjs -- do not edit by hand.\n` +
    `// Lets the app state the network artefact's age and size without fetching\n` +
    `// or parsing app/public/data/zet-network.json.\n` +
    `export const FEED_VERSION = ${JSON.stringify(feedVersion)};\n` +
    `export const BUILT_AT = ${JSON.stringify(builtAt)};\n` +
    `export const ROUTE_COUNT = ${routeCount};\n` +
    `export const EDGE_COUNT = ${edgeCount};\n` +
    `export const BYTE_SIZE = ${byteSize};\n`
  );
}

/**
 * The command-line build. `zipPath` reads an archive already on disk (the
 * same archive scripts/gtfs-trips.mjs --zip reads, so the network and the
 * trip index are cut from one feed version); otherwise the live archive is
 * downloaded. `metaOut: null` writes the artefact alone.
 *
 * `builtAt` is the ARCHIVE's publication time as ZET's server states it, its
 * Last-Modified, never the wall clock and never a file's own time: a download
 * reads the header; a build from `zipPath` must be told it (`builtAt`, the
 * CLI's `--built-at`), since a copied or re-downloaded file need not keep the
 * server's time. Two builds from the same archive bytes and the same stamp are
 * then the same bytes on any machine, and the static-feed watch
 * (worker/feed/static-watch.ts), which calls a feed newer when the live
 * Last-Modified is later than BUILT_AT, stays exact. `now` overrides it
 * (tests).
 */
export async function main({
  fetchImpl = fetch,
  url = GTFS_URL,
  zipPath = null,
  builtAt: builtAtArg = null,
  out = OUTPUT_PATH,
  metaOut = META_OUTPUT_PATH,
  log = console.log,
  cwd = process.cwd(),
  now = null,
  diagramBusCount = DIAGRAM_BUS_COUNT,
  overrides = null,
} = {}) {
  const stampOf = (text, what) => {
    const ms = text === null || text === undefined ? NaN : Date.parse(text);
    if (!Number.isFinite(ms)) throw new Error(`${what} ${JSON.stringify(text)} is not a time`);
    return new Date(ms);
  };
  let buf;
  let fallbackMtime = null; // names the feed only when feed_info.txt does not
  let stamp = builtAtArg === null ? null : stampOf(builtAtArg, '--built-at');
  if (zipPath) {
    if (stamp === null && now === null) {
      throw new Error(
        '--zip needs --built-at <the archive\'s Last-Modified, e.g. 2026-09-01T08:50:29Z>: builtAt is what the static-feed watch ' +
          'compares the live archive\'s Last-Modified with, and a file on disk does not carry the server\'s time reliably.',
      );
    }
    log(`Reading ${zipPath}`);
    buf = new Uint8Array(await readFile(resolve(cwd, zipPath)));
  } else {
    log(`Fetching ${url}`);
    const res = await fetchImpl(url, {
      headers: { 'user-agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GTFS download failed: HTTP ${res.status}`);
    fallbackMtime = res.headers.get('last-modified');
    if (stamp === null && fallbackMtime !== null) stamp = stampOf(fallbackMtime, 'Last-Modified');
    buf = new Uint8Array(await res.arrayBuffer());
    log(`Downloaded ${(buf.byteLength / 1048576).toFixed(1)} MiB`);
  }
  if (fallbackMtime === null && stamp !== null) fallbackMtime = stamp.toISOString();
  const builtAt = now ?? (() => stamp ?? new Date());

  // The overrides live beside the script, not beside its output: they belong
  // to the build, so `cwd` (which tests point at a temp directory) must not
  // move them. A missing file is an empty allowlist, which is the strict case.
  if (overrides === null) {
    const overridesFile = resolve(import.meta.dirname, '..', OVERRIDES_PATH);
    overrides = JSON.parse(await readFile(overridesFile, 'utf8').catch(() => '{}'));
  }

  const { report, ...artefact } = await buildNetwork(buf, { now: builtAt, diagramBusCount, fallbackMtime, log, overrides });

  const target = resolve(cwd, out);
  await mkdir(dirname(target), { recursive: true });
  const json = JSON.stringify(artefact) + '\n';
  await writeFile(target, json, 'utf8');
  const bytes = Buffer.byteLength(json, 'utf8');
  const gzipBytes = gzipSync(Buffer.from(json, 'utf8')).byteLength;

  const routeCount = artefact.routes.id.length;
  const shapeCount = artefact.shapes.id.length;
  const edgeCount = artefact.edges.from.length;
  const pathCount = artefact.paths.id.length;
  const stopCount = artefact.stops.id.length;
  const diagramLineCount = artefact.diagram.lines.route.length;

  const metaTarget = metaOut ? resolve(cwd, metaOut) : null;
  if (metaTarget) {
    await mkdir(dirname(metaTarget), { recursive: true });
    await writeFile(
      metaTarget,
      renderNetworkMeta({ feedVersion: artefact.feedVersion, builtAt: artefact.builtAt, routeCount, edgeCount, byteSize: bytes }),
      'utf8',
    );
  }

  log(
    `${routeCount} routes, ${shapeCount} shapes (${report.tramShapes} tram), ${edgeCount} edges over ${report.nodes} nodes, ` +
      `${report.paths} synthetic paths and ${report.loopPaths.length} terminus loops, ${stopCount} stops, ${diagramLineCount} diagram lines -> ${out} ` +
      `(${bytes} bytes raw, ${gzipBytes} gzip; feed ${artefact.feedVersion}, graph ${artefact.graphHash}, built ${artefact.builtAt})`,
  );
  for (const c of report.connectors) {
    log(`Connector ${c.from.join(',')} -> ${c.to.join(',')}: node ${c.fromNode} -> ${c.toNode}, ${c.metres} m, edge ${c.edge}, run by ${c.usedBy.join(', ')}`);
  }
  log(
    `Terminus loops: ${report.loopPaths.length} built from ${report.loopPairs} platform pairs within ${LOOP_PAIR_MAX_METRES} m ` +
      `(${report.loopSkipped.length} skipped, ${report.loopDuplicates.length} the same rails as a loop already built)`,
  );
  for (const l of report.loopPaths) {
    log(`Loop ${l.id}: ${l.fromName} ${l.from} -> ${l.toName} ${l.to} (${l.apart} m apart), ${l.metres} m long, ${l.between} m between the two paths, ${l.served} platform(s) served`);
  }
  for (const c of report.loopCuts) log(`Edge ${c.edge} cut at ${c.at.join(', ')} m for the loops that end or start on it: pieces ${c.pieces.join(', ')}`);
  for (const l of report.loopSkipped) {
    log(`Loop skipped on route ${l.route}: ${l.fromName} ${l.from} -> ${l.toName} ${l.to} (${l.apart} m apart): ${l.reason}${l.metres === undefined ? '' : ` (${l.metres} m, past ${LOOP_MAX_METRES} m)`}`);
  }
  for (const t of report.servedTerminus) {
    log(`Served at the ${t.at} of ${t.path} (route ${t.route}): terminus ${t.stop} "${t.name}", ${t.metres} m past the drawn rails`);
  }
  for (const g of report.servedGapsAllowed) {
    log(`Served gap allowed by ${OVERRIDES_PATH}: ${g.stop} "${g.name}" off ${g.path} (route ${g.route}) -- ${g.allowed}`);
  }
  log(
    `Rail graph report: ${(report.unsharedShareBefore * 100).toFixed(1)} % of tram shape-segments unshared before snapping, ` +
      `${report.spikePoints} spike points collapsed, ${report.snappedRuns} runs snapped, ${report.residualPairs.length} residual near-parallel pairs; ` +
      `bus shapes ${(report.busUnsharedShare * 100).toFixed(1)} % unshared (informational, buses stay polylines)`,
  );
  log(
    `Served stops: ${report.servedPaths} paths carry a served list (${report.servedEntries} entries), ` +
      `${report.servedProjected} projected onto the path within ${SERVED_STOP_MAX_METRES} m where no edge link reached, ${report.servedDropped.length} dropped, ` +
      `${report.servedUnordered} placed without a call order; ` +
      `${report.terminalStops} stops are a terminus of some trip`,
  );
  for (const d of report.servedDropped) {
    log(`Served stop dropped from ${d.path} (route ${d.route}): ${d.stop} "${d.name}" is ${d.metres === null ? 'not in stops.txt' : `${d.metres} m off the path`}`);
  }
  for (const u of report.unroutablePaths) log(`Synthetic path skipped, rails not drawn by any shape: ${u.reason}`);
  for (const u of report.unreachableAllowed) {
    log(`Stop routed past by allowlist (${OVERRIDES_PATH}): ${u.stop} "${u.name}" on ${u.path} (route ${u.route}) -- ${u.reason}`);
  }
  log(
    `Junctions noded: ${report.junctions.length} of ${report.junctionsConsidered} crossings considered for ` +
      `${report.longLegsBeforeNoding} long hops; ${report.longLegs.length + report.longLegsAllowed.length} hops still route past ${HOP_DETOUR_FACTOR}x the straight line ` +
      `(${report.longLegsAllowed.length} allowlisted in ${OVERRIDES_PATH})`,
  );
  for (const j of report.junctions) {
    log(
      `Junction at ${j.lonLat[0]},${j.lonLat[1]} (${j.angle} deg, ${j.offsetMetres} m off the exact crossing): ` +
        `edges ${j.edgesBefore.join(' x ')} -> ${j.edgesAfter.join(',')} at node ${j.node}; ` +
        `found for ${j.legs.map((l) => `${l.from} -> ${l.to} (route ${l.route}, ${l.along} m of arc for ${l.straight} m of ground)`).join('; ')}`,
    );
  }
  for (const l of [...report.longLegs, ...report.longLegsAllowed]) {
    log(
      `Long leg on ${l.path} (route ${l.route}): ${l.from} -> ${l.to} runs ${l.along} m of arc for ${l.straight} m of ground` +
        (l.allowed ? ` -- allowed: ${l.allowed}` : ''),
    );
  }
  for (const t of report.trimmedPaths) {
    log(`Synthetic path ${t.id}: off-graph terminus stretch dropped, leading [${t.leading.join(", ")}], trailing [${t.trailing.join(", ")}]`);
  }
  return {
    routeCount,
    shapeCount,
    edgeCount,
    pathCount,
    stopCount,
    bytes,
    gzipBytes,
    target,
    metaTarget,
    feedVersion: artefact.feedVersion,
    builtAt: artefact.builtAt,
    report,
  };
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  // `--zip <archive> --built-at <Last-Modified>` builds from a file instead of
  // the download; `--out <file>` writes the artefact there and, unless
  // `--meta-out <file>` names a place for it, leaves network-meta.ts alone, so
  // a determinism check (`--zip <archive> --built-at <time> --out
  // /tmp/zn.json`, then compare) touches nothing.
  const flag = (name) => {
    const i = process.argv.indexOf(name);
    if (i === -1) return null;
    const value = process.argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} needs a path`);
    return value;
  };
  Promise.resolve()
    .then(() => {
      const out = flag('--out');
      return main({ zipPath: flag('--zip'), builtAt: flag('--built-at'), ...(out ? { out, metaOut: flag('--meta-out') } : {}) });
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
