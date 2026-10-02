// Encoders and decoders of the /snimka/ dataset (docs/snimka-2026-10.md
// section 5). The pipeline encodes in Node, the page decodes in the browser;
// everything here is plain arithmetic over the shapes of ./snimka.ts, with
// its own base64 so the two sides agree byte for byte (no Buffer, no atob).
// Hashing is the pipeline's (Node crypto): shared code names a content path
// from a hash it is handed and never computes one.
//
// Every decoder validates and throws SnimkaError on a violation; none of them
// minds a field it does not know.
import {
  BAJS_STEP_S, MOTION_CHUNK_S, MOTION_STEP_S, MOTION_TICKS, ROUTES_STEP_S, SNIMKA_COMPARISONS, SNIMKA_WINDOW, isBoardRef, isExportRef, isHashedRef,
  type BajsFile, type HashedRef, type MotionChunk, type MotionSegment, type MotionVehicle, type RoutesFile, type SnimkaManifest,
} from './snimka';

export class SnimkaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnimkaError';
  }
}

function fail(message: string): never {
  throw new SnimkaError(message);
}

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

// ---- base64 --------------------------------------------------------------
// The standard alphabet with '=' padding, identical in Node and the browser.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Int16Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_INDEX[B64.charCodeAt(i)] = i;

export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[n >> 18] + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  if (i < bytes.length) {
    const rest = bytes.length - i;
    const n = (bytes[i]! << 16) | ((rest > 1 ? bytes[i + 1]! : 0) << 8);
    out += B64[n >> 18] + B64[(n >> 12) & 63]! + (rest > 1 ? B64[(n >> 6) & 63]! : '=') + '=';
  }
  return out;
}

export function decodeBase64(text: string): Uint8Array {
  if (typeof text !== 'string' || text.length % 4 !== 0) return fail('base64: length is not a multiple of 4');
  let pad = 0;
  if (text.endsWith('==')) pad = 2;
  else if (text.endsWith('=')) pad = 1;
  const body = text.slice(0, text.length - pad);
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i);
    const value = code < 128 ? B64_INDEX[code]! : -1;
    if (value < 0) return fail(`base64: bad character at ${i}`);
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (o < out.length) out[o++] = (acc >> bits) & 255;
    }
  }
  if (o !== out.length) return fail('base64: truncated');
  return out;
}

// ---- motion ---------------------------------------------------------------

/** One vehicle at one ten-second tick: metres along a path (on 0) or a shape (on 1), or a free position (on 2). */
export type MotionSample = { on: 0 | 1; idx: number; s: number } | { on: 2; idx: -1; lon: number; lat: number };

export interface MotionChunkInput {
  net: '395' | '396';
  t0: number;
  vehicles: { id: string; route: string | null; label: string | null; kind: 0 | 3 | null; samples: (MotionSample | null)[] /* length 60 */ }[];
}

/** A vehicle's identity with its position at one tick (samplesAt). */
export type MotionPosition = { id: string; route: string | null; label: string | null; kind: 0 | 3 | null } & MotionSample;

const DEG_UNIT = 1e5; // 1e-5 degrees, about 1.1 m at Zagreb's latitude

const roundInt = (x: number, what: string): number => {
  if (typeof x !== 'number' || !Number.isFinite(x)) return fail(`motion: ${what} is not a finite number`);
  return Math.round(x);
};

/** Encodes one ten-minute chunk: a new segment at every null tick and at every change of `on` or `idx`;
 *  `s` to integer metres, lon/lat to integer 1e-5 degrees, both delta-encoded within a segment.
 *  A vehicle without any sample is dropped. */
export function encodeMotionChunk(input: MotionChunkInput): MotionChunk {
  if (input.net !== '395' && input.net !== '396') fail(`motion: unknown network ${String(input.net)}`);
  if (!isInt(input.t0)) fail('motion: t0 is not an integer');
  const vehicles: MotionVehicle[] = [];
  for (const v of input.vehicles) {
    if (v.samples.length !== MOTION_TICKS) fail(`motion: vehicle ${v.id} has ${v.samples.length} samples, not ${MOTION_TICKS}`);
    const segs: MotionSegment[] = [];
    let seg: MotionSegment | null = null;
    let prevA = 0;
    let prevB = 0;
    for (let k = 0; k < MOTION_TICKS; k++) {
      const sample = v.samples[k] ?? null;
      if (sample === null) { seg = null; continue; }
      if (sample.on === 2) {
        const lon = roundInt(sample.lon * DEG_UNIT, 'lon');
        const lat = roundInt(sample.lat * DEG_UNIT, 'lat');
        if (seg === null || seg.on !== 2) {
          seg = { k, on: 2, idx: -1, v: [lon, lat] };
          segs.push(seg);
        } else seg.v.push(lon - prevA, lat - prevB);
        prevA = lon;
        prevB = lat;
      } else {
        if ((sample.on !== 0 && sample.on !== 1) || !isInt(sample.idx) || sample.idx < 0) fail(`motion: vehicle ${v.id} tick ${k} has a bad geometry`);
        const s = roundInt(sample.s, 's');
        if (seg === null || seg.on !== sample.on || seg.idx !== sample.idx) {
          seg = { k, on: sample.on, idx: sample.idx, v: [s] };
          segs.push(seg);
        } else seg.v.push(s - prevA);
        prevA = s;
      }
    }
    if (segs.length === 0) continue;
    vehicles.push({ id: v.id, route: v.route, label: v.label, kind: v.kind, segs });
  }
  return { v: 1, net: input.net, t0: input.t0, step: MOTION_STEP_S, n: MOTION_TICKS, vehicles };
}

const segmentLength = (seg: MotionSegment): number => (seg.on === 2 ? seg.v.length / 2 : seg.v.length);

function checkSegment(seg: unknown, where: string): asserts seg is MotionSegment {
  if (!isRec(seg)) fail(`${where}: segment is not an object`);
  const s = seg as Rec;
  if (!isInt(s.k) || s.k < 0 || s.k >= MOTION_TICKS) fail(`${where}: k outside 0..${MOTION_TICKS - 1}`);
  if (s.on !== 0 && s.on !== 1 && s.on !== 2) fail(`${where}: on is not 0, 1 or 2`);
  if (!isInt(s.idx)) fail(`${where}: idx is not an integer`);
  if (s.on === 2 ? s.idx !== -1 : s.idx < 0) fail(`${where}: idx does not fit on ${String(s.on)}`);
  if (!Array.isArray(s.v) || s.v.length === 0 || !s.v.every(isInt)) fail(`${where}: v is not a non-empty integer array`);
  if (s.on === 2 && s.v.length % 2 !== 0) fail(`${where}: a free segment needs lon/lat pairs`);
  const len = s.on === 2 ? s.v.length / 2 : s.v.length;
  if ((s.k as number) + len > MOTION_TICKS) fail(`${where}: segment runs past tick ${MOTION_TICKS - 1}`);
}

/** Validates a chunk's shape (version, network, step 10, n 60, every segment inside 0..59 and in order). */
export function decodeMotionChunk(raw: unknown): MotionChunk {
  if (!isRec(raw)) fail('motion: not an object');
  const c = raw as Rec;
  if (c.v !== 1) fail(`motion: version ${String(c.v)}`);
  if (c.net !== '395' && c.net !== '396') fail(`motion: network ${String(c.net)}`);
  if (!isInt(c.t0)) fail('motion: t0');
  if (c.step !== MOTION_STEP_S) fail(`motion: step ${String(c.step)}`);
  if (c.n !== MOTION_TICKS) fail(`motion: n ${String(c.n)}`);
  if (!Array.isArray(c.vehicles)) fail('motion: vehicles');
  c.vehicles.forEach((v, i) => {
    if (!isRec(v)) fail(`motion: vehicle ${i} is not an object`);
    const veh = v as Rec;
    if (typeof veh.id !== 'string') fail(`motion: vehicle ${i} id`);
    if (veh.route !== null && typeof veh.route !== 'string') fail(`motion: vehicle ${veh.id} route`);
    if (veh.label !== null && typeof veh.label !== 'string') fail(`motion: vehicle ${veh.id} label`);
    if (veh.kind !== null && veh.kind !== 0 && veh.kind !== 3) fail(`motion: vehicle ${veh.id} kind`);
    if (!Array.isArray(veh.segs) || veh.segs.length === 0) fail(`motion: vehicle ${veh.id} has no segments`);
    let nextFree = 0;
    veh.segs.forEach((seg, j) => {
      const where = `motion: vehicle ${veh.id} segment ${j}`;
      checkSegment(seg, where);
      if (seg.k < nextFree) fail(`${where}: overlaps or precedes the segment before it`);
      nextFree = seg.k + segmentLength(seg);
    });
  });
  return raw as unknown as MotionChunk;
}

/** The vehicle's 60 ticks, undelta'd: null where it had no sample. */
export function expandVehicle(v: MotionVehicle): (MotionSample | null)[] {
  const out: (MotionSample | null)[] = new Array<MotionSample | null>(MOTION_TICKS).fill(null);
  for (const seg of v.segs) {
    if (seg.on === 2) {
      let lon = seg.v[0]!;
      let lat = seg.v[1]!;
      for (let i = 0; i * 2 < seg.v.length; i++) {
        if (i > 0) { lon += seg.v[i * 2]!; lat += seg.v[i * 2 + 1]!; }
        out[seg.k + i] = { on: 2, idx: -1, lon: lon / DEG_UNIT, lat: lat / DEG_UNIT };
      }
    } else {
      let s = seg.v[0]!;
      for (let i = 0; i < seg.v.length; i++) {
        if (i > 0) s += seg.v[i]!;
        out[seg.k + i] = { on: seg.on, idx: seg.idx, s };
      }
    }
  }
  return out;
}

/** Every vehicle present at `tick` (0..59) with its position. */
export function samplesAt(chunk: MotionChunk, tick: number): MotionPosition[] {
  if (!isInt(tick) || tick < 0 || tick >= MOTION_TICKS) fail(`motion: tick ${String(tick)} outside 0..${MOTION_TICKS - 1}`);
  const out: MotionPosition[] = [];
  for (const v of chunk.vehicles) {
    for (const seg of v.segs) {
      const len = segmentLength(seg);
      if (tick < seg.k || tick >= seg.k + len) continue;
      const i = tick - seg.k;
      const head = { id: v.id, route: v.route, label: v.label, kind: v.kind };
      if (seg.on === 2) {
        let lon = seg.v[0]!;
        let lat = seg.v[1]!;
        for (let j = 1; j <= i; j++) { lon += seg.v[j * 2]!; lat += seg.v[j * 2 + 1]!; }
        out.push({ ...head, on: 2, idx: -1, lon: lon / DEG_UNIT, lat: lat / DEG_UNIT });
      } else {
        let s = seg.v[0]!;
        for (let j = 1; j <= i; j++) s += seg.v[j]!;
        out.push({ ...head, on: seg.on, idx: seg.idx, s });
      }
      break;
    }
  }
  return out;
}

/** The ten-minute chunk start that holds the instant `sec`. */
export function chunkStart(sec: number): number {
  return Math.floor(sec / MOTION_CHUNK_S) * MOTION_CHUNK_S;
}

// ---- BAJS -----------------------------------------------------------------

export const BAJS_NOT_RENTING = 254;
export const BAJS_MISSING = 255;

const bajsByteOk = (b: number): boolean => b <= 250 || b === BAJS_NOT_RENTING || b === BAJS_MISSING;

/** One row of five-minute bike counts per station, as base64. Every row must have the same length. */
export function encodeBajs(t0: number, step: BajsFile['step'], stations: string[], matrix: Uint8Array[]): BajsFile {
  if (!isInt(t0)) fail('bajs: t0');
  if (step !== BAJS_STEP_S) fail(`bajs: step ${String(step)}`);
  if (stations.length !== matrix.length) fail(`bajs: ${stations.length} stations, ${matrix.length} rows`);
  const n = matrix[0]?.length ?? 0;
  const bikes = matrix.map((row, i) => {
    if (row.length !== n) fail(`bajs: row ${stations[i]} has ${row.length} samples, not ${n}`);
    for (let j = 0; j < row.length; j++) if (!bajsByteOk(row[j]!)) fail(`bajs: row ${stations[i]} sample ${j} is ${row[j]}, not 0..250, 254 or 255`);
    return encodeBase64(row);
  });
  return { v: 1, t0, step, n, stations: [...stations], bikes };
}

/** The rows back, one Uint8Array of `n` samples per station, in the file's station order. */
export function decodeBajs(file: BajsFile): Uint8Array[] {
  if (!isRec(file) || file.v !== 1) fail('bajs: version');
  if (!isInt(file.t0) || file.step !== BAJS_STEP_S || !isInt(file.n) || file.n < 0) fail('bajs: header');
  if (!Array.isArray(file.stations) || !Array.isArray(file.bikes) || file.stations.length !== file.bikes.length) fail('bajs: stations and bikes differ in length');
  return file.bikes.map((text, i) => {
    const row = decodeBase64(text);
    if (row.length !== file.n) fail(`bajs: row ${String(file.stations[i])} decodes to ${row.length} samples, not ${file.n}`);
    for (let j = 0; j < row.length; j++) if (!bajsByteOk(row[j]!)) fail(`bajs: row ${String(file.stations[i])} sample ${j} is ${row[j]}`);
    return row;
  });
}

// ---- routes (per-line five-minute counts) --------------------------------------

export const ROUTES_MISSING = 255;

/** One row of five-minute counts per route for `seen` and for `expected`, as base64; 255 = missing. Every row must have `n` samples. */
export function encodeRoutes(t0: number, step: RoutesFile['step'], routes: RoutesFile['routes'], seen: Uint8Array[], expected: Uint8Array[], net: RoutesFile['net'] = '396+395'): RoutesFile {
  if (!isInt(t0)) fail('routes: t0');
  if (step !== ROUTES_STEP_S) fail(`routes: step ${String(step)}`);
  if (routes.length !== seen.length || routes.length !== expected.length) fail(`routes: ${routes.length} routes, ${seen.length} seen rows, ${expected.length} expected rows`);
  const n = seen[0]?.length ?? expected[0]?.length ?? 0;
  const encode = (rows: Uint8Array[], what: string): string[] => rows.map((row, i) => {
    if (row.length !== n) fail(`routes: ${what} row ${routes[i]?.id} has ${row.length} samples, not ${n}`);
    return encodeBase64(row);
  });
  return { v: 2, t0, step, n, net, routes: routes.map((r) => ({ ...r })), seen: encode(seen, 'seen'), expected: encode(expected, 'expected') };
}

/** The rows back, one Uint8Array of `n` samples per route for seen and for expected, in the file's route order. */
export function decodeRoutes(file: RoutesFile): { seen: Uint8Array[]; expected: Uint8Array[] } {
  if (!isRec(file) || file.v !== 2) fail('routes: version');
  if (!isInt(file.t0) || file.step !== ROUTES_STEP_S || !isInt(file.n) || file.n < 0) fail('routes: header');
  if (!Array.isArray(file.routes) || !Array.isArray(file.seen) || !Array.isArray(file.expected) || file.seen.length !== file.routes.length || file.expected.length !== file.routes.length) {
    fail('routes: routes, seen and expected differ in length');
  }
  const decode = (rows: string[], what: string): Uint8Array[] => rows.map((text, i) => {
    const row = decodeBase64(text);
    if (row.length !== file.n) fail(`routes: ${what} row ${String(file.routes[i]?.id)} decodes to ${row.length} samples, not ${file.n}`);
    return row;
  });
  return { seen: decode(file.seen, 'seen'), expected: decode(file.expected, 'expected') };
}

// ---- names and the manifest ------------------------------------------------

const HASH_PREFIX = 16;
export type ContentExt = 'json' | 'webp' | 'csv' | 'geojson';
const CONTENT_EXTS: ReadonlySet<string> = new Set(['json', 'webp', 'csv', 'geojson']);

/** `<name>.<first 16 hex of the sha256>.<ext>`; `name` may carry directories ("motion/396/20260928-0730"). */
export function contentPath(name: string, sha256Hex: string, ext: ContentExt): string {
  if (!/^[0-9a-f]{64}$/.test(sha256Hex)) fail('contentPath: sha256 must be 64 lowercase hex characters');
  if (!name || name.startsWith('/') || name.includes('..') || name.includes('\\')) fail(`contentPath: bad name ${JSON.stringify(name)}`);
  if (!CONTENT_EXTS.has(ext)) fail(`contentPath: bad extension ${String(ext)}`);
  return `${name}.${sha256Hex.slice(0, HASH_PREFIX)}.${ext}`;
}

/** A manifest ref's path is relative, climbs nowhere and carries the first 16 hex of its own hash. */
export function checkRefPath(ref: HashedRef, where: string): void {
  const path = ref.path;
  if (path.startsWith('/') || path.includes('\\') || /^[a-z]+:/i.test(path)) fail(`${where}: path ${JSON.stringify(path)} is not relative`);
  const parts = path.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) fail(`${where}: path ${JSON.stringify(path)} climbs or has an empty segment`);
  if (!path.includes(`.${ref.sha256.slice(0, HASH_PREFIX)}.`)) fail(`${where}: path ${JSON.stringify(path)} does not carry its hash`);
  const ext = path.slice(path.lastIndexOf('.') + 1);
  if (!CONTENT_EXTS.has(ext)) fail(`${where}: path ${JSON.stringify(path)} has an unknown extension`);
}

const FILE_KEYS = ['series', 'motionIndex', 'routes', 'stations', 'bajs', 'closures', 'events', 'notices', 'news', 'places', 'screenIndex', 'voiceIndex', 'opis'] as const;
const ATTRIBUTION_IDS = new Set(['zet', 'zet-rss', 'nextbike', 'zagreb-closures', 'dhmz', 'news', 'osm', 'kajima']);
const EXPORT_EXT: Record<string, string> = { csv: 'csv', json: 'json', geojson: 'geojson' };

function checkRef(ref: unknown, where: string): asserts ref is HashedRef {
  if (!isHashedRef(ref)) fail(`${where}: not a hashed ref`);
  checkRefPath(ref, where);
}

/** Validates manifest.json: version 2, the window and both comparisons as the constants say, every file key present,
 *  every ref relative with its hash in its name, every export's path ending in its format. */
export function decodeManifest(raw: unknown): SnimkaManifest {
  if (!isRec(raw)) fail('manifest: not an object');
  const m = raw as Rec;
  if (m.version !== 2) fail(`manifest: version ${String(m.version)}, expected 2`);
  if (typeof m.builtAt !== 'string' || typeof m.title !== 'string') fail('manifest: builtAt and title');
  if (!isRec(m.build) || typeof m.build.commit !== 'string' || !isRec(m.build.inputs)) fail('manifest: build');
  const w = m.window;
  if (!isRec(w) || w.fromSec !== SNIMKA_WINDOW.fromSec || w.toSec !== SNIMKA_WINDOW.toSec || w.minutes !== SNIMKA_WINDOW.minutes || w.tz !== 'Europe/Zagreb' || w.utcOffsetMin !== 120) {
    fail('manifest: window differs from SNIMKA_WINDOW');
  }
  if (!Array.isArray(m.comparisons) || m.comparisons.length !== SNIMKA_COMPARISONS.length) fail('manifest: comparisons differ from SNIMKA_COMPARISONS');
  SNIMKA_COMPARISONS.forEach((want, i) => {
    const c = (m.comparisons as unknown[])[i];
    const where = `manifest: comparisons[${i}]`;
    if (!isRec(c) || c.id !== want.id || c.day !== want.day || c.fromSec !== want.fromSec || c.minutes !== want.minutes || c.net !== want.net || c.weekday !== want.weekday) fail(`${where} differs from SNIMKA_COMPARISONS`);
    if (!isRec(c.files)) fail(`${where}.files`);
    checkRef(c.files.series, `${where}.files.series`);
    checkRef(c.files.routes, `${where}.files.routes`);
    if (!Array.isArray(c.notes) || !c.notes.every((n) => typeof n === 'string')) fail(`${where}.notes`);
  });
  if (!isInt(m.serviceLiveFromSec)) fail('manifest: serviceLiveFromSec');
  if (!isRec(m.networks)) fail('manifest: networks');
  for (const net of ['395', '396'] as const) {
    const ref = m.networks[net];
    checkRef(ref, `manifest: networks.${net}`);
    const n = ref as unknown as Rec;
    if (typeof n.feedVersion !== 'string' || typeof n.graphHash !== 'string' || !isInt(n.paths) || !isInt(n.shapes)) fail(`manifest: networks.${net} is not a network ref`);
  }
  if (!isRec(m.files)) fail('manifest: files');
  const files = m.files;
  for (const key of FILE_KEYS) checkRef(files[key], `manifest: files.${key}`);
  if (!Array.isArray(files.boards)) fail('manifest: files.boards');
  files.boards.forEach((b, i) => {
    if (!isBoardRef(b)) fail(`manifest: files.boards[${i}] is not a board ref`);
    checkRefPath(b, `manifest: files.boards[${i}]`);
  });
  if (!Array.isArray(files.exports)) fail('manifest: files.exports');
  files.exports.forEach((e, i) => {
    if (!isExportRef(e)) fail(`manifest: files.exports[${i}] is not an export ref`);
    checkRefPath(e, `manifest: files.exports[${i}]`);
    if (!e.path.endsWith(`.${EXPORT_EXT[e.format]}`)) fail(`manifest: files.exports[${i}] path does not end in .${e.format}`);
  });
  if (files.grid !== null) fail('manifest: files.grid must be null');
  if (!Array.isArray(m.attribution)) fail('manifest: attribution');
  m.attribution.forEach((a, i) => {
    if (!isRec(a) || typeof a.id !== 'string' || !ATTRIBUTION_IDS.has(a.id) || typeof a.text !== 'string' || (a.url !== null && typeof a.url !== 'string')
      || typeof a.licence !== 'string' || (a.adaptation !== null && typeof a.adaptation !== 'string')) fail(`manifest: attribution ${i}`);
  });
  if (!Array.isArray(m.notes) || !m.notes.every((n) => typeof n === 'string')) fail('manifest: notes');
  return raw as unknown as SnimkaManifest;
}
