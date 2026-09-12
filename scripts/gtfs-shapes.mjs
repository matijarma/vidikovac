#!/usr/bin/env node
// Builds app/public/data/zet-network.json (simplified route shapes, stop
// arc-fractions and an octilinear schematic diagram) plus the plain-constant
// summary app/src/motion/network-meta.ts, from ZET's static GTFS feed.
//
// Reuses the zero-dependency zip reader and CSV parser from gtfs-routes.mjs
// rather than adding a dependency; run locally with `npm run build:network`
// and commit both generated files. The Worker never downloads the 15 MB
// archive -- this is a local build step, exactly like gtfs-routes.
//
// Attribution obligation (Otvorena dozvola, ZET) carries over unchanged;
// see ZET_ATTRIBUTION in gtfs-routes.mjs.
import { createInflateRaw } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareRouteIds, extractEntry, localFileDataOffset, parseCsv, readZipEntries } from './gtfs-routes.mjs';

export const GTFS_URL = 'https://www.zet.hr/gtfs-scheduled/latest';
export const OUTPUT_PATH = 'app/public/data/zet-network.json';
export const META_OUTPUT_PATH = 'app/src/motion/network-meta.ts';

const DOWNLOAD_TIMEOUT_MS = 60_000; // build-time download of a >10 MB archive, not a live request
const USER_AGENT = 'Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)';

// The artefact's delta-encoding origin and unit: every lon/lat in the file is
// stored as an integer (value - origin) / scale, so shapes.txt's ~77k points
// become small integers instead of 8-decimal floats. 1e-5 deg is a ~1.1 m
// quantum at Zagreb's latitude -- comfortably finer than the 5 m shape
// simplification below, so quantisation never shows up as visible jitter.
export const ORIGIN = [15.9, 45.75]; // lon, lat
export const SCALE = 1e-5; // degrees per integer unit

// The equirectangular projection used ONLY for internal metre-space work
// (Douglas-Peucker, arc length, the 40 m stop radius, the octilinear
// diagram): a single cos(lat) factor around Zagreb's own latitude, rather
// than a projection library the brief explicitly says not to add.
const PROJECTION_LAT_DEG = 45.8;
const EARTH_RADIUS_M = 6378137; // WGS84 equatorial radius; good enough at this scale
const DEG2RAD = Math.PI / 180;
const COS_LAT0 = Math.cos(PROJECTION_LAT_DEG * DEG2RAD);

// Simplify shapes at 5 m: well above the ~1.1 m coordinate quantum above, so
// simplification error is never confused with quantisation noise.
export const SIMPLIFY_METRES = 5;
// A stop is linked to a shape when it passes within 40 m of it.
export const STOP_SHAPE_MAX_METRES = 40;
// The diagram's second simplification pass, after the octilinear snap.
export const DIAGRAM_SIMPLIFY_METRES = 120;
// Zagreb's real network is dense enough downtown that a stop is often within
// 40 m of a dozen different lines' shapes (524 shapes average ~57 linked
// stops each -- genuinely how many stops a route serves, not noise). Storing
// each stop's shape index as a plain absolute integer and its fraction as a
// four-decimal float does not fit the budget below, so both are quantised:
// the index as a delta from the previous (ascending) index in the same
// stop's own list, the fraction to the nearest 1/50th of the shape's own
// length -- at a typical 1-5 km shape that is 20-100 m of absolute error on
// *where along the shape* a stop sits, which only has to be tight enough to
// order stops correctly and gate dead reckoning at roughly the right one
// (one stop spacing, per the area's own motion-model tolerance), not to
// place a stop precisely.
export const ON_FRAC_SCALE = 50;
// Cap on how many shapes one stop links to, keeping the geometrically
// closest (see the stop-building loop below for the full reasoning). The
// real feed's median is 4 and its 90th percentile is 20; 12 trims only the
// long tail of the busiest interchanges while leaving the ordinary case
// untouched, and leaves the artefact with real headroom under the R-L4
// budget rather than skimming it, since the live feed grows between
// rebuilds.
// FLAGGED FOR CONTROLLER SIGN-OFF (not settled by this task alone): this cap
// trades against DIAGRAM_BUS_COUNT below for the same byte budget, and it is
// exactly the busiest interchanges -- real p90 20, max 63 links/stop -- that
// a later, mandated lightweight list (R-L2, "the nearest stops with the
// lines calling at them") would read. See task-T1-report.md's Rulings.
export const ON_MAX_PER_STOP = 12;

// Column order for the struct-of-arrays wire format (see toColumnar).
export const ROUTE_KEYS = ['id', 'short', 'type', 'rank', 'shapes'];
export const SHAPE_KEYS = ['id', 'route', 'd', 'len'];
export const STOP_KEYS = ['id', 'name', 'p', 'on'];
export const LINE_KEYS = ['route', 'pts'];
// Diagram legibility cut: every tram route, plus this many of the busiest
// bus routes by trip count (154 routes total would not read as a schematic
// map; 19 trams + the top 20 buses mirrors how ZET's own printed network map
// picks its "trunk" lines).
// FLAGGED FOR CONTROLLER SIGN-OFF: kept generous over ON_MAX_PER_STOP above
// (a lower bus count was the live alternative that would have bought room to
// raise the per-stop cap instead) -- see task-T1-report.md's Rulings.
export const DIAGRAM_BUS_COUNT = 20;

/** Converts lon/lat degrees to a local metre-space plane (translation
 *  doesn't matter here: only used for distances, lengths and angles, all of
 *  which are translation-invariant). */
export function toMetres(lon, lat) {
  return { x: lon * DEG2RAD * COS_LAT0 * EARTH_RADIUS_M, y: lat * DEG2RAD * EARTH_RADIUS_M };
}

function deltaEncode(value, origin) {
  return Math.round((value - origin) / SCALE);
}

/**
 * True delta (chain) encoding of a sequence of integer (x, y) units: every
 * point is stored as its difference from the *previous* point, not from a
 * shared origin. The first point's difference is taken against (0, 0), so
 * the whole shape still anchors to ORIGIN through the caller's own
 * deltaEncode of its first lon/lat. Consecutive shape (or stop) points are
 * typically tens to a few hundred metres apart -- far smaller numbers than
 * their several-kilometre offset from ORIGIN -- which is what actually keeps
 * the artefact inside its byte budget; a per-point offset from one shared
 * origin does not. Lossless: summing the deltas back (chainDecodeXY)
 * reproduces the exact original integers, because integer subtraction has no
 * rounding error.
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

/** Inverse of the stop-transfer-sorted, chain-delta-and-scaled `on` encoding
 *  built in buildNetwork: returns absolute [shapeIdx, frac] pairs. */
export function decodeStopOn(wireOn) {
  const out = [];
  let idx = 0;
  for (const [dIdx, scaledFrac] of wireOn) {
    idx += dIdx;
    out.push([idx, scaledFrac / ON_FRAC_SCALE]);
  }
  return out;
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
 * Struct-of-arrays transposition: turns a row-major array of objects into a
 * column-major object of arrays, one array per key, index-aligned. Applied
 * to routes/shapes/stops/diagram-lines below in place of the row-major
 * array-of-objects shown in the brief's illustrative interface: with 524
 * shapes and 2,529 stops (after the parent-station filter), repeating each
 * object's key names (`"id":`, `"name":`, `"p":`, `"on":`, …) as literal text
 * on every row costs tens of kilobytes of raw JSON that carries no
 * information -- gzip erases most of it, but the artefact's raw-byte budget
 * (R-L4) does not get that discount. Every field name and value from the
 * documented shape survives exactly, just transposed; fromColumnar (below,
 * exported for tests and for T4's future decodeNetwork) is its exact
 * inverse, so nothing the interface promises is lost, only how it is laid
 * out on disk.
 *
 * FLAGGED FOR CONTROLLER SIGN-OFF before T4 begins: this is a documented-
 * interface deviation (the brief's sketch is row-major array-of-objects),
 * not merely an implementation detail -- T4/T7/T8 must read this artefact
 * via fromColumnar/decodeStopOn/chainDecodeXY, never the brief's illustrative
 * JSON directly. See task-T1-report.md's Rulings for why a literal reading
 * is mathematically incompatible with the R-L4 byte budget.
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
// Douglas-Peucker, on plane points, used both for shape simplification (5 m)
// and, applied a second time to the octilinear diagram, at 120 m.

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

/** Nearest point on a polyline (given its cumulative arc length), returning
 *  the perpendicular distance and the arc length at the nearest point. */
function nearestOnPolyline(p, points, cum) {
  let best = Infinity;
  let bestArc = 0;
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
    }
  }
  return { dist: best, arc: bestArc };
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
 *  original segment's length. Every point in the input must differ from its
 *  predecessor (see dedupeConsecutive), so this never drops a point. */
function snapChain(points) {
  if (points.length === 0) return [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const raw = points[i];
    const dx = raw.x - prev.x;
    const dy = raw.y - prev.y;
    const mag = Math.hypot(dx, dy);
    if (mag === 0) continue; // defensive; dedupeConsecutive already rules this out
    const angle = snapOctant(Math.atan2(dy, dx));
    out.push({ x: prev.x + mag * Math.cos(angle), y: prev.y + mag * Math.sin(angle) });
  }
  return out;
}

/** Snaps a simplified shape onto the octilinear grid, then simplifies again
 *  at `tolerance` metres. The second pass re-snaps every surviving segment
 *  (rather than connecting the chosen points with a raw chord), so the
 *  octilinear invariant holds for the *final* polyline, not just the first
 *  pass -- a plain Douglas-Peucker chord across two non-collinear octilinear
 *  steps would generally point in some other, non-octilinear direction. */
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

export function parseTripsTxt(rows) {
  if (rows.length === 0) throw new Error('trips.txt is empty');
  const col = columnIndexer(rows[0], 'trips.txt');
  const routeIdx = col('route_id');
  const tripIdx = col('trip_id');
  const shapeIdx = col('shape_id');
  const tripCountByRoute = new Map();
  const shapeToRoute = new Map();
  const shapeSampleTrip = new Map();
  for (const r of rows.slice(1)) {
    const routeId = r[routeIdx];
    const tripId = r[tripIdx];
    const shapeId = (r[shapeIdx] ?? '').trim();
    tripCountByRoute.set(routeId, (tripCountByRoute.get(routeId) ?? 0) + 1);
    if (shapeId !== '' && !shapeToRoute.has(shapeId)) {
      // "No shape is shared between routes" (verified fact); the first trip
      // seen for a shape_id decides its route and stands in as the sample
      // trip the stop-transfer helper below reads its endpoints from.
      shapeToRoute.set(shapeId, routeId);
      shapeSampleTrip.set(shapeId, tripId);
    }
  }
  return { tripCountByRoute, shapeToRoute, shapeSampleTrip };
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
  // itself a place a vehicle stops. ZET's feed also carries 1,276 such
  // grouping rows (a third of stops.txt) that would otherwise inflate the
  // artefact with entries no vehicle ever reaches.
  const typeIdx = rows[0].indexOf('location_type'); // absent header -> -1, treated as "no filter"
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
// Streamed as inflate -> line reader, keeping only a Map<tripId, {first,
// last} stop_id> -- the "stop-transfer helper": all a shape's own endpoints
// need to know is which stop each end trip started and finished at, so a
// terminus reachable only from a driveway or loop set back from the road
// (a real GTFS pattern, and further than 40 m from the recorded shape) still
// gets linked to its shape rather than silently missing from `on`.
//
// localFileDataOffset (the header/offset arithmetic that locates where the
// entry's compressed bytes start) is imported from gtfs-routes.mjs rather
// than duplicated here: extractEntry there needs the identical offset, but
// inflates the whole entry synchronously, which would defeat the point of
// streaming this specific 92 MB file. compareRouteIds is imported for the
// same reason -- gtfs-shapes.mjs's own tram/bus ranking below needs the
// exact same numeric-aware id ordering gtfs-routes.mjs already implements.

/** Streams stop_times.txt and returns Map<tripId, {firstStop, lastStop}>,
 *  determined by stop_sequence rather than file order (correct even if a
 *  future export is not grouped by trip). */
export async function streamTripEndpoints(buf, entry) {
  const start = localFileDataOffset(buf, entry);
  const compressed = buf.subarray(start, start + entry.compressedSize);
  const source = Readable.from([Buffer.from(compressed)]);
  let stream;
  if (entry.method === 8) {
    stream = source.pipe(createInflateRaw());
  } else if (entry.method === 0) {
    stream = source;
  } else {
    throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
  }
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const endpoints = new Map();
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
      continue;
    }
    if (seq < existing.firstSeq) {
      existing.firstStop = stopId;
      existing.firstSeq = seq;
    }
    if (seq > existing.lastSeq) {
      existing.lastStop = stopId;
      existing.lastSeq = seq;
    }
  }
  return endpoints;
}

// ---------------------------------------------------------------------------
// Orchestration.

/**
 * Builds the network artefact object (see the artefact shape documented in
 * the T1 brief) from a fully-loaded GTFS zip buffer.
 * @param {Uint8Array} zipBuf
 * @param {{ now?: () => Date, diagramBusCount?: number, fallbackMtime?: string | null, log?: (s: string) => void }} [opts]
 */
export async function buildNetwork(zipBuf, opts = {}) {
  const { now = () => new Date(), diagramBusCount = DIAGRAM_BUS_COUNT, fallbackMtime = null, log = () => {} } = opts;

  const entries = readZipEntries(zipBuf);
  const findEntry = (name) => {
    const e = entries.find((x) => x.name === name || x.name.endsWith('/' + name));
    if (!e) throw new Error(`${name} not in archive (entries: ${entries.map((x) => x.name).join(', ')})`);
    return e;
  };
  const textOf = (name) => new TextDecoder('utf-8').decode(extractEntry(zipBuf, findEntry(name)));

  const routesMeta = parseRoutesTxt(parseCsv(textOf('routes.txt')));
  const { tripCountByRoute, shapeToRoute, shapeSampleTrip } = parseTripsTxt(parseCsv(textOf('trips.txt')));
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

  const tripEndpoints = await streamTripEndpoints(zipBuf, findEntry('stop_times.txt'));

  // Shapes: simplify, delta-encode, and keep the plane-space simplified
  // points (with a per-shape cumulative arc length and expanded bbox) around
  // for the stop-on-shape pass and the diagram below.
  const shapeIds = [...rawShapesByShapeId.keys()].sort();
  const shapes = [];
  const planeByShapeIdx = [];
  const cumByShapeIdx = [];
  const bboxByShapeIdx = [];
  for (const shapeId of shapeIds) {
    const routeId = shapeToRoute.get(shapeId);
    if (!routeId) {
      log(`Skipping shape ${shapeId}: no trip references it`);
      continue;
    }
    const rawPts = rawShapesByShapeId.get(shapeId);
    const plane = rawPts.map((p) => toMetres(p.lon, p.lat));
    const keepIdx = dpIndices(plane, SIMPLIFY_METRES);
    const simplifiedLonLat = keepIdx.map((i) => rawPts[i]);
    const simplifiedPlane = keepIdx.map((i) => plane[i]);
    const cum = cumulative(simplifiedPlane);
    const len = cum[cum.length - 1];
    const units = simplifiedLonLat.map((p) => [deltaEncode(p.lon, ORIGIN[0]), deltaEncode(p.lat, ORIGIN[1])]);
    const d = chainEncodeXY(units);
    shapes.push({ id: shapeId, route: routeId, d, len: round1(len) });
    planeByShapeIdx.push(simplifiedPlane);
    cumByShapeIdx.push(cum);
    bboxByShapeIdx.push(bboxExpanded(simplifiedPlane, STOP_SHAPE_MAX_METRES));
  }

  const shapeIdxByRoute = new Map();
  for (let i = 0; i < shapes.length; i++) {
    const list = shapeIdxByRoute.get(shapes[i].route);
    if (list) list.push(i);
    else shapeIdxByRoute.set(shapes[i].route, [i]);
  }

  // Rank: every tram route, then every other route, each group ordered by
  // trip count descending (the plan's "all tram routes, then bus routes by
  // trip count"). Rank is dense 1..N across the full route list; the
  // diagram keeps only ranks at or above the cut.
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

  // Stops: chain-delta-encode position across the output array (see
  // chainEncodeXY), then link to every shape within 40 m.
  const stopIndexById = new Map();
  const stopPlane = [];
  const stopUnits = rawStops.map((s) => [deltaEncode(s.lon, ORIGIN[0]), deltaEncode(s.lat, ORIGIN[1])]);
  const stopPChain = chainEncodeXY(stopUnits);
  const stops = rawStops.map((s, i) => {
    stopIndexById.set(s.id, i);
    stopPlane.push(toMetres(s.lon, s.lat));
    return {
      id: s.id,
      name: s.name,
      p: [stopPChain[2 * i], stopPChain[2 * i + 1]],
      on: [],
    };
  });
  // Stop-transfer overrides (see streamTripEndpoints above): computed first
  // and kept per stop index, so the cap below can prioritise them -- a
  // verified terminus link must survive even at a hub whose plain geometric
  // match count alone would already fill ON_MAX_PER_STOP.
  const overridesByStop = new Map(); // stopIdx -> [shapeIdx, frac][]
  for (let shapeIdx = 0; shapeIdx < shapes.length; shapeIdx++) {
    const sampleTripId = shapeSampleTrip.get(shapes[shapeIdx].id);
    if (!sampleTripId) continue;
    const endpoints = tripEndpoints.get(sampleTripId);
    if (!endpoints) continue;
    const add = (stopId, frac) => {
      const stopIdx = stopIndexById.get(stopId);
      if (stopIdx === undefined) return;
      const list = overridesByStop.get(stopIdx);
      if (list) list.push([shapeIdx, frac]);
      else overridesByStop.set(stopIdx, [[shapeIdx, frac]]);
    };
    add(endpoints.firstStop, 0);
    add(endpoints.lastStop, 1);
  }

  for (let si = 0; si < stops.length; si++) {
    const p = stopPlane[si];
    const overrides = overridesByStop.get(si) ?? [];
    const overrideShapeIdx = new Set(overrides.map(([idx]) => idx));
    const candidates = [];
    for (let shapeIdx = 0; shapeIdx < planeByShapeIdx.length; shapeIdx++) {
      if (overrideShapeIdx.has(shapeIdx)) continue; // the override already links this pair
      const poly = planeByShapeIdx[shapeIdx];
      if (poly.length < 2) continue;
      const bb = bboxByShapeIdx[shapeIdx];
      if (p.x < bb.minX || p.x > bb.maxX || p.y < bb.minY || p.y > bb.maxY) continue;
      const { dist, arc } = nearestOnPolyline(p, poly, cumByShapeIdx[shapeIdx]);
      if (dist <= STOP_SHAPE_MAX_METRES) {
        const len = cumByShapeIdx[shapeIdx][cumByShapeIdx[shapeIdx].length - 1];
        const frac = len > 0 ? clamp01(arc / len) : 0;
        candidates.push([shapeIdx, frac, dist]);
      }
    }
    // At a handful of big interchanges a stop sits within 40 m of dozens of
    // overlapping lines (real, not a bug: Zagreb's dense core shares
    // corridors between many routes). ON_MAX_PER_STOP keeps only the
    // closest ones per stop, so the byte budget holds. This can only trim
    // the most marginal, near-the-40-m-edge, likely-coincidental geometric
    // associations at a busy stop -- a stop's own serving route sits a few
    // metres away and so is essentially always among the closest kept, and
    // every stop-transfer override survives regardless of the cap.
    candidates.sort((a, b) => a[2] - b[2]);
    const geometricSlots = Math.max(0, ON_MAX_PER_STOP - overrides.length);
    for (const [shapeIdx, frac] of overrides) stops[si].on.push([shapeIdx, frac]);
    for (const [shapeIdx, frac] of candidates.slice(0, geometricSlots)) stops[si].on.push([shapeIdx, frac]);
  }
  // Encode each stop's `on` list: sort by shapeIdx (both passes above appended
  // in different orders), then chain-delta the index and scale the fraction
  // (see ON_FRAC_SCALE). decodeStopOn is the exact inverse.
  for (const stop of stops) {
    stop.on.sort((a, b) => a[0] - b[0]);
    let prevIdx = 0;
    stop.on = stop.on.map(([idx, frac]) => {
      const wire = [idx - prevIdx, Math.round(frac * ON_FRAC_SCALE)];
      prevIdx = idx;
      return wire;
    });
  }

  // The octilinear diagram: one line per shape of every diagram-cut route.
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

  // Every array below is struct-of-arrays (toColumnar), not the row-major
  // array-of-objects the brief's interface sketch shows -- see toColumnar's
  // own comment for why. ROUTE_KEYS / SHAPE_KEYS / STOP_KEYS / LINE_KEYS name
  // exactly the fields that sketch shows, in the same order; fromColumnar is
  // the exact inverse and is what a decoder (T4) reads with.
  return {
    version: 1,
    feedVersion,
    builtAt: now().toISOString(),
    origin: ORIGIN,
    scale: SCALE,
    routes: toColumnar(routes, ROUTE_KEYS),
    shapes: toColumnar(shapes, SHAPE_KEYS),
    stops: toColumnar(stops, STOP_KEYS),
    diagram: { lines: toColumnar(diagram.lines, LINE_KEYS), box: diagram.box },
  };
}

function renderNetworkMeta({ feedVersion, builtAt, routeCount, byteSize }) {
  return (
    `// Generated by scripts/gtfs-shapes.mjs -- do not edit by hand.\n` +
    `// Lets the app state the network artefact's age and size without fetching\n` +
    `// or parsing app/public/data/zet-network.json.\n` +
    `export const FEED_VERSION = ${JSON.stringify(feedVersion)};\n` +
    `export const BUILT_AT = ${JSON.stringify(builtAt)};\n` +
    `export const ROUTE_COUNT = ${routeCount};\n` +
    `export const BYTE_SIZE = ${byteSize};\n`
  );
}

export async function main({
  fetchImpl = fetch,
  url = GTFS_URL,
  out = OUTPUT_PATH,
  metaOut = META_OUTPUT_PATH,
  log = console.log,
  cwd = process.cwd(),
  now = () => new Date(),
  diagramBusCount = DIAGRAM_BUS_COUNT,
} = {}) {
  log(`Fetching ${url}`);
  const res = await fetchImpl(url, {
    headers: { 'user-agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GTFS download failed: HTTP ${res.status}`);
  const fallbackMtime = res.headers.get('last-modified');
  const buf = new Uint8Array(await res.arrayBuffer());
  log(`Downloaded ${(buf.byteLength / 1048576).toFixed(1)} MiB`);

  const artefact = await buildNetwork(buf, { now, diagramBusCount, fallbackMtime, log });

  const target = resolve(cwd, out);
  await mkdir(dirname(target), { recursive: true });
  const json = JSON.stringify(artefact) + '\n';
  await writeFile(target, json, 'utf8');
  const bytes = Buffer.byteLength(json, 'utf8');

  const routeCount = artefact.routes.id.length;
  const shapeCount = artefact.shapes.id.length;
  const stopCount = artefact.stops.id.length;
  const diagramLineCount = artefact.diagram.lines.route.length;

  const metaTarget = resolve(cwd, metaOut);
  await mkdir(dirname(metaTarget), { recursive: true });
  await writeFile(
    metaTarget,
    renderNetworkMeta({ feedVersion: artefact.feedVersion, builtAt: artefact.builtAt, routeCount, byteSize: bytes }),
    'utf8',
  );

  log(`${routeCount} routes, ${shapeCount} shapes, ${stopCount} stops, ${diagramLineCount} diagram lines -> ${out} (${bytes} bytes)`);
  return {
    routeCount,
    shapeCount,
    stopCount,
    bytes,
    target,
    metaTarget,
    feedVersion: artefact.feedVersion,
    builtAt: artefact.builtAt,
  };
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
