#!/usr/bin/env node
// Builds app/src/data/zet-routes.json from ZET's static GTFS feed so the
// U pokretu layer can name a GTFS-RT routeId ("1" -> "Zap.kol. - Borongaj").
// Zero dependencies on purpose: the zip is walked from its central directory
// and inflated with node:zlib. Run locally with `npm run gtfs:routes` and
// commit the result; the Worker never downloads the 15 MB archive.
//
// Attribution obligation (Otvorena dozvola, ZET): wherever the generated file
// is used, show ZET_ATTRIBUTION verbatim.
import { inflateRawSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const GTFS_URL = 'https://www.zet.hr/gtfs-scheduled/latest';
export const OUTPUT_PATH = 'app/src/data/zet-routes.json';
export const ZET_ATTRIBUTION =
  'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669';

// Build-time download of a >10 MB archive: not a runtime fetch, so the
// spec's 6 s timeout for live requests does not apply here (60 s instead).
const DOWNLOAD_TIMEOUT_MS = 60_000;
const USER_AGENT = 'Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_MIN_LENGTH = 22;
const MAX_COMMENT_LENGTH = 0xffff;
const ZIP64_MARK = 0xffffffff;

/**
 * @typedef {{ name: string; method: number; compressedSize: number; uncompressedSize: number; localHeaderOffset: number }} ZipEntry
 */

function viewOf(buf) {
  if (!(buf instanceof Uint8Array)) throw new TypeError('expected a Uint8Array');
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

function findEocd(view) {
  const stop = Math.max(0, view.byteLength - EOCD_MIN_LENGTH - MAX_COMMENT_LENGTH);
  for (let p = view.byteLength - EOCD_MIN_LENGTH; p >= stop; p--) {
    if (view.getUint32(p, true) === SIG_EOCD) return p;
  }
  throw new Error('Not a zip archive: end-of-central-directory record not found');
}

/** Lists the archive's entries by walking the central directory. @returns {ZipEntry[]} */
export function readZipEntries(buf) {
  const view = viewOf(buf);
  const eocd = findEocd(view);
  const total = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset === ZIP64_MARK) throw new Error('ZIP64 archives are not supported');
  const decoder = new TextDecoder('utf-8');
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > view.byteLength || view.getUint32(p, true) !== SIG_CENTRAL) {
      throw new Error(`Bad central directory header at offset ${p}`);
    }
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const localHeaderOffset = view.getUint32(p + 42, true);
    if (compressedSize === ZIP64_MARK || uncompressedSize === ZIP64_MARK || localHeaderOffset === ZIP64_MARK) {
      throw new Error('ZIP64 archives are not supported');
    }
    const name = decoder.decode(buf.subarray(p + 46, p + 46 + nameLength));
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Decompresses one entry. Method 0 is stored, 8 is deflate; anything else is refused. */
export function extractEntry(buf, entry) {
  const view = viewOf(buf);
  const p = entry.localHeaderOffset;
  if (p + 30 > view.byteLength || view.getUint32(p, true) !== SIG_LOCAL) {
    throw new Error(`Bad local file header for ${entry.name} at offset ${p}`);
  }
  const nameLength = view.getUint16(p + 26, true);
  const extraLength = view.getUint16(p + 28, true);
  const start = p + 30 + nameLength + extraLength;
  const raw = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) {
    const out = inflateRawSync(raw);
    if (out.length !== entry.uncompressedSize) {
      throw new Error(`Size mismatch for ${entry.name}: expected ${entry.uncompressedSize} bytes, got ${out.length}`);
    }
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  }
  throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
}

/** RFC 4180 parser: quoted fields, doubled quotes, CR LF, optional BOM. */
export function parseCsv(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function compareRouteIds(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** routes.txt rows (header first) -> { [route_id]: { shortName, longName, type } }, keys sorted. */
export function buildRoutesIndex(rows) {
  if (rows.length === 0) throw new Error('routes.txt is empty');
  const header = rows[0];
  const column = (name) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`routes.txt lacks the column ${name} (header: ${header.join(',')})`);
    return i;
  };
  const idIdx = column('route_id');
  const shortIdx = column('route_short_name');
  const longIdx = column('route_long_name');
  const typeIdx = column('route_type');
  const unsorted = {};
  for (const r of rows.slice(1)) {
    const id = (r[idIdx] ?? '').trim();
    if (id === '') continue;
    const type = Number(r[typeIdx]);
    if (!Number.isInteger(type)) throw new Error(`route ${id} has a non-integer route_type "${r[typeIdx]}"`);
    unsorted[id] = {
      shortName: (r[shortIdx] ?? '').trim(),
      longName: (r[longIdx] ?? '').trim(),
      type,
    };
  }
  const sorted = {};
  for (const key of Object.keys(unsorted).sort(compareRouteIds)) sorted[key] = unsorted[key];
  return sorted;
}

export function routesFromZip(buf) {
  const entries = readZipEntries(buf);
  const routes = entries.find((e) => e.name === 'routes.txt' || e.name.endsWith('/routes.txt'));
  if (!routes) {
    throw new Error(`routes.txt not in archive (entries: ${entries.map((e) => e.name).join(', ')})`);
  }
  const text = new TextDecoder('utf-8').decode(extractEntry(buf, routes));
  return buildRoutesIndex(parseCsv(text));
}

export async function main({
  fetchImpl = fetch,
  url = GTFS_URL,
  out = OUTPUT_PATH,
  log = console.log,
  cwd = process.cwd(),
} = {}) {
  log(`Fetching ${url}`);
  const res = await fetchImpl(url, {
    headers: { 'user-agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GTFS download failed: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  log(`Downloaded ${(buf.byteLength / 1048576).toFixed(1)} MiB`);
  const index = routesFromZip(buf);
  const target = resolve(cwd, out);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(index, null, 1) + '\n', 'utf8');
  const count = Object.keys(index).length;
  log(`${count} routes -> ${out}`);
  log(`Attribution required wherever this file is used: ${ZET_ATTRIBUTION}`);
  return { count, target };
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
