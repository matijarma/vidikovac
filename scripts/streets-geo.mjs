#!/usr/bin/env node
// Builds app/public/data/streets-geo.json: the offline street index behind the
// screen's one field "Adresa ili stajalište" (app/src/kiosk/places.ts). The
// street register (catalogue `streets` chunks) has names and settlements but
// no geometry, so the geometry comes from the map the application already
// serves: the named `roads` features of the self-hosted Protomaps archive
// zagreb-v1 at z14 (OpenStreetMap data). The output is a derived database of
// OpenStreetMap and is published under the ODbL 1.0 (docs/izvori.md,
// "Statički skupovi", and /izvori).
//
// This is the one scripts/*.mjs build tool with npm dependencies:
// @mapbox/vector-tile and pbf decode the Mapbox Vector Tile protobuf (a
// zigzag-encoded command stream that a hand-written reader would only
// duplicate), and pmtiles reads a local copy of the archive. All three are
// BSD-3-Clause and already in node_modules for the map itself
// (maplibre-gl, the Worker's /maps route). Everything else follows
// scripts/districts.mjs: deterministic (no clock, no environment, sorted
// output, coordinates rounded to 5 decimals), so two runs over the same
// tiles write the same bytes.
//
// `node scripts/streets-geo.mjs` reads the tiles cached in .cache/maps/zagreb-v1/
// (gitignored) and fails if one is missing.
// `node scripts/streets-geo.mjs --fetch` first downloads the missing tiles from
// the application's own public tile route. Served tiles are raw MVT: the
// Worker (worker/routes/maps.ts) already decompresses the archive's tiles,
// so a tile is gunzipped only when its first two bytes say gzip.
// `node scripts/streets-geo.mjs --archive <zagreb-v1.pmtiles>` reads a local
// copy of the archive instead (`wrangler r2 object get`, owner login); there
// the tiles are gunzipped when the archive header says so, as the Worker does.
// `--tiles <dir>` builds from whatever `{z}-{x}-{y}.mvt` files a directory
// holds (test/fixtures/maps), and `--out <path>` writes elsewhere; the test
// uses both so it never touches the committed file.
import { mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { douglasPeucker } from './districts.mjs';

export const MAP_VERSION = 'zagreb-v1';
export const ZOOM = 14;
/** MAP_CONFIG.bounds (app/src/core/contracts.ts): west, south, east, north. */
export const MAP_BOUNDS = [15.7, 45.5, 16.3, 46.02];
export const TILE_URL = `https://zagreb.aningfilm.hr/maps/${MAP_VERSION}/{z}/{x}/{y}.mvt`;
export const CACHE_DIR = `.cache/maps/${MAP_VERSION}`;
export const OUTPUT_PATH = 'app/public/data/streets-geo.json';
export const STOPS_PATH = 'app/public/data/stops.json';
export const MANIFEST_PATH = 'app/public/data/city/manifest.json';
export const CHUNKS_DIR = 'app/public/data/city/chunks';
export const MAX_BYTES = 409_600;
/** A stop this close to a street's line is one of the street's stops. */
export const STOP_NEAR_M = 60;
/** Streets longer than this carry a simplified line (the field offers such a street by its parts: app/src/kiosk/places.ts SEGMENT_MIN_M). */
export const LINE_MIN_M = 700;
export const SIMPLIFY_M = 15;
/** An unmatched piece of a name this close to a matched street of the same name joins it (a settlement border cuts the street). */
export const BORDER_JOIN_M = 200;
/** The register's settlement the coverage line counts, and the owner's floor for it. */
export const COVERAGE_SETTLEMENT = 'Zagreb';
export const COVERAGE_TARGET = 2_800;
/**
 * The wire format, struct of arrays (the convention of scripts/gtfs-shapes.mjs):
 * `streets[key][i]` per key below; `settlement` indexes `settlements` ([id, name]);
 * `lon`/`lat` are integers in 1/POINT_SCALE of a degree above ORIGIN (5 decimals,
 * the anchor a place is made from); `bbox` is [west, south, east, north] as
 * non-negative offsets from the point in 1/SHAPE_SCALE of a degree, rounded
 * outward; `lines[i]`, only for streets longer than LINE_MIN_M, is the
 * simplified line as deltas in 1/SHAPE_SCALE of a degree, the first from the
 * point. SHAPE_SCALE (about 10 m) is finer than the 15 m simplification.
 * app/src/core/streets.ts decodeStreets reads it back; decodeIndex below is its twin.
 */
export const STREET_KEYS = ['name', 'id', 'settlement', 'lon', 'lat', 'bbox', 'lengthM', 'stops'];
export const POINT_SCALE = 100_000;
export const SHAPE_SCALE = 10_000;
const SHAPE_STEP = POINT_SCALE / SHAPE_SCALE;
/** MAP_BOUNDS' south-west corner in POINT_SCALE units. */
export const ORIGIN = [1_570_000, 4_550_000];
/** Road kinds of the Protomaps `roads` layer that are not streets. */
const SKIP_KINDS = new Set(['rail', 'ferry', 'aerialway']);
/** Kinds a street without a register row must mostly be to be listed: roads, not paths, trails or driveways. */
const STREET_KINDS = new Set(['highway', 'major_road', 'minor_road', 'other']);
const isStreetKind = (piece) => STREET_KINDS.has(piece.kind) && piece.detail !== 'service';
/** A listed name has at least this many letters ("10" or "2A" on a driveway is a house number, not a street). */
const MIN_NAME_LETTERS = 3;
/** A name the register lacks is listed only for a street at least this long, not for a stray fragment. */
const MIN_UNMATCHED_M = 50;

const USER_AGENT = 'Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr) streets-geo';
const DOWNLOAD_TIMEOUT_MS = 30_000;
const FETCH_CONCURRENCY = 4;

// Local equirectangular metres around Zagreb's latitude, the same plane as
// scripts/districts.mjs (whose douglasPeucker this file reuses).
const LON_TO_M = Math.cos((45.8 * Math.PI) / 180) * 111_320;
const LAT_TO_M = 110_574;

/**
 * shared/city/geo.ts normalName, duplicated because a scripts/*.mjs tool does
 * not import a .ts module; test/scripts/streets-geo.test.ts asserts the two agree.
 */
export function normalName(value) {
  return value.toLocaleLowerCase('hr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[“”"'„]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// ---------------------------------------------------------------------------
// Tiles

export function lonToTileX(lon, z = ZOOM) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

export function latToTileY(lat, z = ZOOM) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * 2 ** z);
}

/** Tile pixel (px, py of `extent`) of tile x/y/z → [lon, lat]. */
export function tilePointToLonLat(x, y, z, px, py, extent) {
  const n = 2 ** z;
  const lon = ((x + px / extent) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / extent)) / n))) * 180) / Math.PI;
  return [lon, lat];
}

/** The z14 tiles that touch a settlement's bounding box, inside the map bounds, sorted by x then y. */
export function tilesFor(settlements, z = ZOOM) {
  const seen = new Set();
  const tiles = [];
  for (const settlement of settlements) {
    const [w, s, e, n] = settlement.bbox;
    const west = Math.max(w, MAP_BOUNDS[0]);
    const east = Math.min(e, MAP_BOUNDS[2]);
    const south = Math.max(s, MAP_BOUNDS[1]);
    const north = Math.min(n, MAP_BOUNDS[3]);
    if (west > east || south > north) continue;
    for (let x = lonToTileX(west, z); x <= lonToTileX(east, z); x += 1) {
      for (let y = latToTileY(north, z); y <= latToTileY(south, z); y += 1) {
        const key = `${x}/${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles.sort((a, b) => a.x - b.x || a.y - b.y);
}

export const tileFileName = ({ z, x, y }) => `${z}-${x}-${y}.mvt`;

export function isGzip(bytes) {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** A tile's bytes → VectorTile, or null for an empty tile. Gunzipped only when the bytes are gzip. */
export function decodeTile(bytes) {
  let buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (buf.length === 0) return null;
  if (isGzip(buf)) buf = new Uint8Array(gunzipSync(buf));
  return new VectorTile(new PbfReader(buf));
}

/** Liang-Barsky: the part of segment a→b inside [0, e]², or null. */
function clipSegment(ax, ay, bx, by, e) {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [ax, e - ax, ay, e - ay];
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  if (t0 >= t1) return null;
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
}

/** A tile line clipped to the tile's own square (tiles overlap by a buffer, so nothing is counted twice). */
function clipLine(points, extent) {
  const pieces = [];
  let current = null;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const seg = clipSegment(a.x, a.y, b.x, b.y, extent);
    if (!seg) {
      if (current && current.length >= 2) pieces.push(current);
      current = null;
      continue;
    }
    const last = current?.[current.length - 1];
    if (current && last[0] === seg[0] && last[1] === seg[1]) {
      current.push([seg[2], seg[3]]);
    } else {
      if (current && current.length >= 2) pieces.push(current);
      current = [[seg[0], seg[1]], [seg[2], seg[3]]];
    }
  }
  if (current && current.length >= 2) pieces.push(current);
  return pieces;
}

/** Named street lines of one tile as [lon, lat] polylines, clipped to the tile. */
export function roadPieces(tile, { z, x, y }) {
  const out = [];
  const roads = tile?.layers.roads;
  if (!roads) return out;
  for (let i = 0; i < roads.length; i += 1) {
    const feature = roads.feature(i);
    if (feature.type !== 2) continue;
    const raw = feature.properties.name;
    if (typeof raw !== 'string') continue;
    const name = raw.replace(/\s+/g, ' ').trim();
    if (name.length < 2) continue;
    const kind = String(feature.properties.kind ?? '');
    if (SKIP_KINDS.has(kind)) continue;
    const detail = String(feature.properties.kind_detail ?? '');
    for (const line of feature.loadGeometry()) {
      for (const piece of clipLine(line, roads.extent)) {
        out.push({ name, kind, detail, line: piece.map(([px, py]) => tilePointToLonLat(x, y, z, px, py, roads.extent)) });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Register, settlements, stops

function ringInside(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** shared/city/geo.ts inPolygons: inside an outer ring and outside its holes. */
function inPolygons(lon, lat, polygons) {
  return polygons.some(([outer, ...holes]) => outer && ringInside(lon, lat, outer) && !holes.some((hole) => ringInside(lon, lat, hole)));
}

function polygonsBbox(polygons) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [lon, lat] of ring) {
        if (lon < w) w = lon;
        if (lon > e) e = lon;
        if (lat < s) s = lat;
        if (lat > n) n = lat;
      }
    }
  }
  return [w, s, e, n];
}

/** The catalogue's street register and settlement polygons, from the chunks the manifest lists. */
export async function loadRegister(cwd = process.cwd()) {
  const manifest = JSON.parse(await readFile(resolve(cwd, MANIFEST_PATH), 'utf8'));
  const rows = async (kind, key) => {
    const out = [];
    for (const source of manifest.sources.filter((s) => s.kind === kind)) {
      for (const chunk of source.chunks) {
        const data = JSON.parse(await readFile(resolve(cwd, CHUNKS_DIR, `${chunk.hash}.json`), 'utf8'));
        out.push(...data.data[key]);
      }
    }
    return out;
  };
  const streets = await rows('streets', 'streets');
  const settlements = (await rows('settlements', 'settlements'))
    .map((s) => ({ id: String(s.id), name: s.name, polygons: s.polygons, bbox: polygonsBbox(s.polygons) }))
    .sort((a, b) => Number(a.id) - Number(b.id));
  return { streets, settlements };
}

export async function loadStops(cwd = process.cwd()) {
  return JSON.parse(await readFile(resolve(cwd, STOPS_PATH), 'utf8'));
}

function settlementAt(lon, lat, settlements) {
  for (const s of settlements) {
    const [w, south, e, n] = s.bbox;
    if (lon < w || lon > e || lat < south || lat > n) continue;
    if (inPolygons(lon, lat, s.polygons)) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Geometry in the local metre plane

const toXY = ([lon, lat]) => [lon * LON_TO_M, lat * LAT_TO_M];

function segmentLengthM(a, b) {
  return Math.hypot((b[0] - a[0]) * LON_TO_M, (b[1] - a[1]) * LAT_TO_M);
}

function lineLengthM(line) {
  let total = 0;
  for (let i = 1; i < line.length; i += 1) total += segmentLengthM(line[i - 1], line[i]);
  return total;
}

/** The point halfway along a line. */
function midpointOf(line) {
  const half = lineLengthM(line) / 2;
  let walked = 0;
  for (let i = 1; i < line.length; i += 1) {
    const d = segmentLengthM(line[i - 1], line[i]);
    if (walked + d >= half && d > 0) {
      const t = (half - walked) / d;
      return [line[i - 1][0] + t * (line[i][0] - line[i - 1][0]), line[i - 1][1] + t * (line[i][1] - line[i - 1][1])];
    }
    walked += d;
  }
  return line[0];
}

/** Nearest point of segment a→b to p, all in the plane; returns [x, y, distance]. */
function nearestOnSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const x = a[0] + t * dx;
  const y = a[1] + t * dy;
  return [x, y, Math.hypot(p[0] - x, p[1] - y)];
}

/** Nearest point of a set of plane polylines to p: [x, y, distance]. */
function nearestOnLines(p, lines) {
  let best = [p[0], p[1], Infinity];
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 1) {
      const hit = nearestOnSegment(p, line[i - 1], line[i]);
      if (hit[2] < best[2]) best = hit;
    }
  }
  return best;
}

/**
 * Joins pieces that meet end to end where exactly two ends meet, and returns
 * the longest continuous run: a street's line is its main carriageway, not
 * every branch and slip of the same name.
 */
function longestRun(pieces) {
  const keyOf = ([lon, lat]) => `${Math.round(lon * 1e6)},${Math.round(lat * 1e6)}`;
  const runs = pieces.map((line) => ({ line: line.slice(), alive: true }));
  const ends = new Map();
  const addEnd = (key, run) => {
    const list = ends.get(key);
    if (list) list.push(run);
    else ends.set(key, [run]);
  };
  for (const run of runs) {
    addEnd(keyOf(run.line[0]), run);
    addEnd(keyOf(run.line[run.line.length - 1]), run);
  }
  for (const key of [...ends.keys()].sort()) {
    const list = ends.get(key).filter((run) => run.alive);
    if (list.length !== 2 || list[0] === list[1]) continue;
    const [a, b] = list;
    const aEndsHere = keyOf(a.line[a.line.length - 1]) === key;
    const bStartsHere = keyOf(b.line[0]) === key;
    const left = aEndsHere ? a.line : a.line.slice().reverse();
    const right = bStartsHere ? b.line : b.line.slice().reverse();
    const merged = { line: left.concat(right.slice(1)), alive: true };
    a.alive = false;
    b.alive = false;
    const farA = keyOf(merged.line[0]);
    const farB = keyOf(merged.line[merged.line.length - 1]);
    for (const far of [farA, farB]) {
      const at = ends.get(far);
      if (!at) continue;
      for (let i = 0; i < at.length; i += 1) if (at[i] === a || at[i] === b) at[i] = merged;
    }
    ends.set(key, []);
    runs.push(merged);
  }
  let best = null;
  let bestLength = -1;
  for (const run of runs) {
    if (!run.alive) continue;
    const length = lineLengthM(run.line);
    if (length > bestLength) {
      best = run.line;
      bestLength = length;
    }
  }
  return best ?? [];
}

// ---------------------------------------------------------------------------
// The index

function bboxOfLines(lines) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const line of lines) {
    for (const [lon, lat] of line) {
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  }
  return [w, s, e, n];
}

function bboxGapM(a, b) {
  const dx = Math.max(0, a[0] - b[2], b[0] - a[2]) * LON_TO_M;
  const dy = Math.max(0, a[1] - b[3], b[1] - a[3]) * LAT_TO_M;
  return Math.hypot(dx, dy);
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const sumMetres = (pieces) => pieces.reduce((total, piece) => total + piece.metres, 0);

/** Single-linkage clusters of `items` under `near`, each in item order, ordered by first member. */
function clusters(items, near) {
  const parent = items.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (!near(items[i], items[j])) continue;
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  const out = new Map();
  items.forEach((item, i) => {
    const root = find(i);
    const list = out.get(root);
    if (list) list.push(item);
    else out.set(root, [item]);
  });
  return [...out.values()];
}

const pushTo = (map, key, value) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/**
 * Step 1: the named pieces of every tile per (normal name, settlement), groups sorted by
 * name then settlement, pieces in tile order. A piece outside every settlement of the
 * City of Zagreb (Samobor, Zaprešić, Velika Gorica share the tiles) is counted and left out.
 */
function groupPieces(tiles, settlements) {
  const groups = new Map();
  let tileCount = 0;
  let outside = 0;
  for (const tile of tiles) {
    tileCount += 1;
    for (const piece of roadPieces(decodeTile(tile.bytes), tile)) {
      const [lon, lat] = midpointOf(piece.line);
      const settlement = settlementAt(lon, lat, settlements);
      const norm = normalName(piece.name);
      if (!settlement || !norm) {
        outside += 1;
        continue;
      }
      const key = `${norm}\u0000${settlement.id}`;
      let group = groups.get(key);
      if (!group) {
        group = { norm, settlementId: settlement.id, pieces: [], row: null };
        groups.set(key, group);
      }
      group.pieces.push({ line: piece.line, name: piece.name, metres: lineLengthM(piece.line), road: isStreetKind(piece), bbox: bboxOfLines([piece.line]) });
    }
  }
  const sorted = [...groups.values()].sort((a, b) => compareText(a.norm, b.norm) || Number(a.settlementId) - Number(b.settlementId));
  return { groups: sorted, tiles: tileCount, outside };
}

/** Step 2: the register join, the same normal name in the same settlement and exactly one row (shared/city/geo.ts matchStreet). */
function joinRegister(groups, register) {
  const byKey = new Map();
  for (const row of register) pushTo(byKey, `${normalName(row.name)}\u0000${String(Number(row.settlementId))}`, row);
  const matched = [];
  const unmatched = [];
  for (const group of groups) {
    const rows = byKey.get(`${group.norm}\u0000${String(Number(group.settlementId))}`) ?? [];
    if (rows.length === 1) matched.push({ ...group, row: rows[0], bbox: bboxOfLines(group.pieces.map((piece) => piece.line)) });
    else unmatched.push(group);
  }
  return { matched, unmatched };
}

/**
 * Step 3, names the register lacks. The pieces of one name in one settlement can be
 * several streets, so they are split where they do not touch. A part touching a register
 * street of its name belongs to that street (a settlement border cuts it); touching parts
 * in neighbouring settlements are one street, filed under the settlement holding most of
 * it, and listed only when it is a street: mostly road, a real name, more than a fragment.
 * Returns every street to write, the register's first.
 */
function settleUnmatched(matched, unmatched) {
  const near = (a, b) => bboxGapM(a.bbox, b.bbox) <= BORDER_JOIN_M;
  const matchedByNorm = new Map();
  for (const group of matched) pushTo(matchedByNorm, group.norm, group);
  const looseByNorm = new Map();
  for (const group of unmatched) {
    for (const pieces of clusters(group.pieces, near)) {
      const part = { norm: group.norm, settlementId: group.settlementId, pieces, bbox: bboxOfLines(pieces.map((piece) => piece.line)) };
      let host = null;
      let hostGap = Infinity;
      for (const candidate of matchedByNorm.get(part.norm) ?? []) {
        const gap = bboxGapM(part.bbox, candidate.bbox);
        if (gap <= BORDER_JOIN_M && gap < hostGap) {
          host = candidate;
          hostGap = gap;
        }
      }
      if (host) host.pieces.push(...pieces);
      else pushTo(looseByNorm, part.norm, part);
    }
  }
  const streets = [...matched];
  for (const parts of looseByNorm.values()) {
    for (const cluster of clusters(parts, near)) {
      const pieces = cluster.flatMap((part) => part.pieces);
      const allM = sumMetres(pieces);
      const roadM = sumMetres(pieces.filter((piece) => piece.road));
      if (roadM * 2 < allM || allM < MIN_UNMATCHED_M) continue;
      if ((cluster[0].norm.match(/\p{L}/gu) ?? []).length < MIN_NAME_LETTERS) continue;
      const metresIn = new Map();
      for (const part of cluster) metresIn.set(part.settlementId, (metresIn.get(part.settlementId) ?? 0) + sumMetres(part.pieces));
      const [[settlementId]] = [...metresIn].sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]));
      streets.push({ norm: cluster[0].norm, settlementId, pieces, row: null });
    }
  }
  return streets;
}

/** The ids of the stops within STOP_NEAR_M of the lines, the nearest platform per name, ordered along `axis` through `centre`. */
function stopsAlong(planeLines, bbox, stopXY, centre, axis) {
  const marginLon = STOP_NEAR_M / LON_TO_M;
  const marginLat = STOP_NEAR_M / LAT_TO_M;
  const nearest = new Map();
  for (const { stop, xy } of stopXY) {
    if (stop.lon < bbox[0] - marginLon || stop.lon > bbox[2] + marginLon || stop.lat < bbox[1] - marginLat || stop.lat > bbox[3] + marginLat) continue;
    const [, , d] = nearestOnLines(xy, planeLines);
    if (d > STOP_NEAR_M) continue;
    const seen = nearest.get(stop.name);
    if (!seen || d < seen.d || (d === seen.d && compareText(stop.id, seen.stop.id) < 0)) nearest.set(stop.name, { stop, xy, d });
  }
  return [...nearest.values()]
    .map((hit) => ({ id: hit.stop.id, t: (hit.xy[0] - centre[0]) * axis[0] + (hit.xy[1] - centre[1]) * axis[1] }))
    .sort((a, b) => a.t - b.t || compareText(a.id, b.id))
    .map((hit) => hit.id);
}

/**
 * Step 4: one street as written, quantised (see STREET_KEYS): its length, its point (the
 * point of the street nearest its length-weighted centre, so always on the street), its
 * box, its stops along its principal axis and, when long, its simplified longest run.
 */
function streetRecord(group, stopXY) {
  const lines = group.pieces.map((piece) => piece.line);
  const bbox = bboxOfLines(lines);
  const planeLines = lines.map((line) => line.map(toXY));
  let lengthM = 0;
  let cx = 0;
  let cy = 0;
  const mids = [];
  for (const line of planeLines) {
    for (let i = 1; i < line.length; i += 1) {
      const d = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      const mx = (line[i][0] + line[i - 1][0]) / 2;
      const my = (line[i][1] + line[i - 1][1]) / 2;
      lengthM += d;
      cx += mx * d;
      cy += my * d;
      mids.push([mx, my, d]);
    }
  }
  if (lengthM <= 0) return null;
  cx /= lengthM;
  cy /= lengthM;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [mx, my, d] of mids) {
    sxx += (mx - cx) ** 2 * d;
    syy += (my - cy) ** 2 * d;
    sxy += (mx - cx) * (my - cy) * d;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const [ax, ay] = nearestOnLines([cx, cy], planeLines);

  // The register's spelling, else the spelling OpenStreetMap gives most of the street.
  let name = group.row?.name;
  if (!name) {
    const spellings = new Map();
    for (const piece of group.pieces) spellings.set(piece.name, (spellings.get(piece.name) ?? 0) + piece.metres);
    [[name]] = [...spellings].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]));
  }
  const lonQ = Math.round((ax / LON_TO_M) * POINT_SCALE);
  const latQ = Math.round((ay / LAT_TO_M) * POINT_SCALE);
  const px = Math.round(lonQ / SHAPE_STEP);
  const py = Math.round(latQ / SHAPE_STEP);
  let line = null;
  if (lengthM > LINE_MIN_M) {
    const run = douglasPeucker(longestRun(lines), SIMPLIFY_M)
      .map(([lon, lat]) => [Math.round(lon * SHAPE_SCALE), Math.round(lat * SHAPE_SCALE)])
      .filter((p, i, all) => i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1]);
    if (run.length >= 2) {
      line = [];
      let [x0, y0] = [px, py];
      for (const [x, y] of run) {
        line.push(x - x0, y - y0);
        [x0, y0] = [x, y];
      }
    }
  }
  return {
    norm: group.norm,
    name,
    id: group.row ? Number(group.row.id) : null,
    settlementId: group.settlementId,
    lon: lonQ - ORIGIN[0],
    lat: latQ - ORIGIN[1],
    bbox: [
      px - Math.floor(bbox[0] * SHAPE_SCALE),
      py - Math.floor(bbox[1] * SHAPE_SCALE),
      Math.ceil(bbox[2] * SHAPE_SCALE) - px,
      Math.ceil(bbox[3] * SHAPE_SCALE) - py,
    ],
    lengthM: Math.round(lengthM),
    stops: stopsAlong(planeLines, bbox, stopXY, [cx, cy], [Math.cos(theta), Math.sin(theta)]),
    line,
  };
}

/** Step 5, the wire: struct of arrays, settlements by index, lines sparse by row. */
function encodeIndex(streets, settlements, generatedFrom) {
  const used = [...new Set(streets.map((s) => s.settlementId))].sort((a, b) => Number(a) - Number(b));
  const settlementIndex = new Map(used.map((id, i) => [id, i]));
  const names = new Map(settlements.map((s) => [s.id, s.name]));
  const lines = {};
  streets.forEach((s, i) => {
    if (s.line) lines[String(i)] = s.line;
  });
  return {
    version: MAP_VERSION,
    source: `OpenStreetMap contributors via Protomaps ${MAP_VERSION}`,
    licence: 'ODbL 1.0',
    attribution: '© OpenStreetMap contributors · Protomaps',
    generatedFrom,
    origin: ORIGIN,
    pointScale: POINT_SCALE,
    shapeScale: SHAPE_SCALE,
    settlements: used.map((id) => [id, names.get(id) ?? '']),
    keys: STREET_KEYS,
    streets: toColumnar(streets.map((s) => ({ ...s, settlement: settlementIndex.get(s.settlementId) })), STREET_KEYS),
    lines,
  };
}

/**
 * The street index from tiles, with its coverage of the register's Zagreb streets.
 * @param {{ tiles: Iterable<{ z: number, x: number, y: number, bytes: Uint8Array }>, stops: { id: string, name: string, lon: number, lat: number, routes: string[] }[], register: { id: string, name: string, settlement: string, settlementId: string }[], settlements: { id: string, name: string, polygons: number[][][][], bbox: number[] }[], generatedFrom: string }} input
 */
export function buildIndex({ tiles, stops, register, settlements, generatedFrom }) {
  const grouped = groupPieces(tiles, settlements);
  const { matched, unmatched } = joinRegister(grouped.groups, register);
  const stopXY = stops.map((stop) => ({ stop, xy: toXY([stop.lon, stop.lat]) }));
  const streets = settleUnmatched(matched, unmatched)
    .map((group) => streetRecord(group, stopXY))
    .filter((street) => street !== null)
    .sort((a, b) => compareText(a.norm, b.norm) || compareText(a.name, b.name) || Number(a.settlementId) - Number(b.settlementId));
  const index = encodeIndex(streets, settlements, generatedFrom);
  const zagreb = register.filter((row) => row.settlement === COVERAGE_SETTLEMENT);
  const carried = new Set(streets.filter((s) => s.id !== null).map((s) => String(s.id)));
  const covered = zagreb.filter((row) => carried.has(String(row.id))).length;
  return { index, rows: decodeIndex(index), coverage: { matched: covered, total: zagreb.length }, tiles: grouped.tiles, outside: grouped.outside };
}

/** Struct of arrays: one array per key, null where a row has no value (a street without a register id). */
export function toColumnar(rows, keys) {
  const columns = {};
  for (const key of keys) columns[key] = rows.map((row) => row[key] ?? null);
  return columns;
}

/**
 * The wire back to street rows, exactly as app/src/core/streets.ts decodeStreets
 * reads it (test/scripts/streets-geo.test.ts holds the two to the same answer):
 * `{ name, id?, settlementId, settlement, lon, lat, bbox, lengthM, stops, line? }`.
 */
export function decodeIndex(index) {
  const [ox, oy] = index.origin;
  const point = index.pointScale;
  const shape = index.shapeScale;
  const step = point / shape;
  const c = index.streets;
  const rows = [];
  for (let i = 0; i < c.name.length; i += 1) {
    const lonQ = ox + c.lon[i];
    const latQ = oy + c.lat[i];
    const px = Math.round(lonQ / step);
    const py = Math.round(latQ / step);
    const [dw, ds, de, dn] = c.bbox[i];
    const [settlementId, settlement] = index.settlements[c.settlement[i]];
    const row = {
      name: c.name[i],
      ...(c.id[i] !== null ? { id: String(c.id[i]) } : {}),
      settlementId,
      settlement,
      lon: lonQ / point,
      lat: latQ / point,
      bbox: [(px - dw) / shape, (py - ds) / shape, (px + de) / shape, (py + dn) / shape],
      lengthM: c.lengthM[i],
      stops: c.stops[i],
    };
    const deltas = index.lines[String(i)];
    if (deltas) {
      const line = [];
      let x = px;
      let y = py;
      for (let k = 0; k + 1 < deltas.length; k += 2) {
        x += deltas[k];
        y += deltas[k + 1];
        line.push([x / shape, y / shape]);
      }
      row.line = line;
    }
    rows.push(row);
  }
  return rows;
}

export function serialise(index) {
  return `${JSON.stringify(index)}\n`;
}

// ---------------------------------------------------------------------------
// Tile sources

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Downloads every missing tile into the cache; an empty answer (204/404) is cached as an empty file. */
export async function fetchTiles(tiles, { cwd = process.cwd(), fetchImpl = fetch, log = console.log, url = TILE_URL } = {}) {
  const dir = resolve(cwd, CACHE_DIR);
  await mkdir(dir, { recursive: true });
  const missing = [];
  for (const tile of tiles) if (!(await exists(resolve(dir, tileFileName(tile))))) missing.push(tile);
  log(`${tiles.length} tiles, ${missing.length} to fetch into ${CACHE_DIR}`);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < missing.length) {
      const tile = missing[next];
      next += 1;
      const address = url.replace('{z}', String(tile.z)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y));
      const response = await fetchImpl(address, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      let bytes;
      if (response.status === 204 || response.status === 404) bytes = new Uint8Array(0);
      else if (response.ok) bytes = new Uint8Array(await response.arrayBuffer());
      else throw new Error(`streets-geo: HTTP ${response.status} for ${address}`);
      await writeFile(resolve(dir, tileFileName(tile)), bytes);
      done += 1;
      if (done % 100 === 0) log(`${done} / ${missing.length}`);
    }
  };
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
}

/** The cached tiles, in order; throws naming how many are missing. */
async function* cachedTiles(tiles, cwd) {
  const dir = resolve(cwd, CACHE_DIR);
  const missing = [];
  for (const tile of tiles) if (!(await exists(resolve(dir, tileFileName(tile))))) missing.push(tileFileName(tile));
  if (missing.length > 0) throw new Error(`streets-geo: ${missing.length} of ${tiles.length} tiles missing in ${CACHE_DIR} (first ${missing[0]}); run with --fetch`);
  for (const tile of tiles) yield { ...tile, bytes: new Uint8Array(await readFile(resolve(dir, tileFileName(tile)))) };
}

const TILE_FILE = /^(\d+)-(\d+)-(\d+)\.mvt$/;

/** Every `{z}-{x}-{y}.mvt` file of a directory, sorted by x then y. */
export async function directoryTiles(dir) {
  const tiles = [];
  for (const name of await readdir(dir)) {
    const match = TILE_FILE.exec(name);
    if (!match) continue;
    tiles.push({ z: Number(match[1]), x: Number(match[2]), y: Number(match[3]), bytes: new Uint8Array(await readFile(resolve(dir, name))) });
  }
  return tiles.sort((a, b) => a.x - b.x || a.y - b.y);
}

/** A local pmtiles file as a pmtiles Source (pmtiles' own FileSource wraps a browser File). */
class LocalFileSource {
  constructor(path) {
    this.path = path;
  }
  getKey() {
    return this.path;
  }
  async getBytes(offset, length) {
    const handle = await open(this.path, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead) };
    } finally {
      await handle.close();
    }
  }
}

/**
 * The tiles out of a local copy of the archive. The archive header names the
 * compression of its directories and of its tiles; both are gunzipped here, by
 * node:zlib, exactly when the header says gzip (pmtiles hands every buffer and
 * its header's compression to this function).
 */
async function* archiveTiles(tiles, path) {
  const { Compression, PMTiles, SharedPromiseCache } = await import('pmtiles');
  const decompress = async (buf, compression) => {
    if (compression === Compression.None || compression === Compression.Unknown) return buf;
    if (compression !== Compression.Gzip) throw new Error(`streets-geo: archive compression ${compression} is not supported`);
    const out = gunzipSync(new Uint8Array(buf));
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  };
  const archive = new PMTiles(new LocalFileSource(path), new SharedPromiseCache(100, true, decompress), decompress);
  for (const tile of tiles) {
    const hit = await archive.getZxy(tile.z, tile.x, tile.y);
    yield { ...tile, bytes: hit ? new Uint8Array(hit.data) : new Uint8Array(0) };
  }
}

/** Sync iteration over an async tile source (buildIndex is synchronous). */
async function collect(source) {
  const out = [];
  for await (const tile of source) out.push(tile);
  return out;
}

// ---------------------------------------------------------------------------
// CLI

function parseArgs(argv) {
  const args = { fetchFirst: false, archive: null, tilesDir: null, out: OUTPUT_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === '--fetch') args.fetchFirst = true;
    else if (argv[i] === '--archive' || argv[i] === '--tiles' || argv[i] === '--out') {
      if (!value || value.startsWith('--')) throw new Error(`${argv[i]} expects a path`);
      if (argv[i] === '--archive') args.archive = value;
      else if (argv[i] === '--tiles') args.tilesDir = value;
      else args.out = value;
      i += 1;
    } else {
      throw new Error(`streets-geo: unknown argument ${argv[i]}`);
    }
  }
  return args;
}

export async function main({ argv = process.argv.slice(2), cwd = process.cwd(), log = console.log, fetchImpl = fetch } = {}) {
  const args = parseArgs(argv);
  const { streets: register, settlements } = await loadRegister(cwd);
  const stops = await loadStops(cwd);
  let tiles;
  let generatedFrom;
  if (args.tilesDir) {
    tiles = await directoryTiles(resolve(cwd, args.tilesDir));
    generatedFrom = `${tiles.length} z${ZOOM} tiles`;
  } else {
    const wanted = tilesFor(settlements);
    if (args.archive) {
      tiles = await collect(archiveTiles(wanted, resolve(cwd, args.archive)));
    } else {
      if (args.fetchFirst) await fetchTiles(wanted, { cwd, fetchImpl, log });
      tiles = await collect(cachedTiles(wanted, cwd));
    }
    generatedFrom = `${wanted.length} z${ZOOM} tiles`;
  }

  const built = buildIndex({ tiles, stops, register, settlements, generatedFrom });
  const json = serialise(built.index);
  const bytes = Buffer.byteLength(json, 'utf8');
  const withLine = built.rows.filter((row) => row.line).length;
  const withId = built.rows.filter((row) => row.id).length;
  log(`${built.rows.length} streets from ${built.tiles} tiles (${withId} with a register id, ${withLine} with a line; ${built.outside} pieces outside the city left out)`);
  const { matched, total } = built.coverage;
  const percent = total > 0 ? ((100 * matched) / total).toFixed(1) : '0.0';
  log(`coverage: ${matched} of ${total} register streets in ${COVERAGE_SETTLEMENT} (${percent} %; target ${COVERAGE_TARGET})`);
  if (bytes > MAX_BYTES) {
    log(`streets-geo: ${bytes} bytes exceeds the ${MAX_BYTES} byte budget; nothing written`);
    process.exitCode = 1;
    return { ...built, bytes, written: false };
  }
  const target = resolve(cwd, args.out);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, json, 'utf8');
  log(`${bytes} bytes -> ${args.out}`);
  return { ...built, bytes, written: true, target };
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
