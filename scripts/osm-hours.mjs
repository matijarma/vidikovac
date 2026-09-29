#!/usr/bin/env node
// Builds app/public/data/osm-hours.json: the opening hours of the places people look for
// around Zagreb (pharmacies, post offices, libraries, markets, shops, bakeries, cafés,
// bars, restaurants, cinemas, banks, fuel stations, surgeries), plus a name-only list of
// venues (cafés, bars, clubs, cinemas, theatres, arts and community centres, libraries,
// museums, galleries) that shared/city/venues.ts uses to place an event whose source
// names its venue only in words. The input is OpenStreetMap; the output is a derived
// database published under the ODbL 1.0 (docs/izvori.md, "Statički skupovi", and /izvori).
// shared/city/osm-hours.ts decodes it and says which places are open now.
//
// `node scripts/osm-hours.mjs --fetch` downloads the Geofabrik Croatia extract
// (https://download.geofabrik.de/europe/croatia-latest.osm.pbf, about 200 MB, one
// request) to .cache/osm/ (gitignored), then builds from it.
// `node --max-old-space-size=3072 scripts/osm-hours.mjs [--pbf <file>]` builds from a
// local extract (default the cached one) through scripts/lib/osm-pbf.mjs.
// `--input <overpass.json>` builds from an Overpass JSON answer instead
// (test/fixtures/osm-hours-overpass.json; ways and relations there carry a centre).
// `--built-at <ISO instant>` stamps the file (default: the data's own date, so two runs
// over one extract write the same bytes); `--out <path>` writes elsewhere.
//
// Deterministic like scripts/streets-geo.mjs: no clock unless asked, records sorted by
// name then point, coordinates rounded to 1e-5 degrees (about a metre).
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { readPois } from './lib/osm-pbf.mjs';
import { parseOpeningHours, weekString } from './opening-hours.mjs';

export const PBF_URL = 'https://download.geofabrik.de/europe/croatia-latest.osm.pbf';
export const CACHE_PBF = '.cache/osm/croatia-latest.osm.pbf';
export const OUTPUT_PATH = 'app/public/data/osm-hours.json';
/** The Zagreb box [west, south, east, north]: the city and the first ring of its suburbs. */
export const BBOX = [15.87, 45.72, 16.16, 45.9];
/** Budgets of docs/upgrade-2026-10-plan/U3.md: 900 KB raw, 300 KB gzip. */
export const MAX_BYTES = 921_600;
export const MAX_GZIP_BYTES = 307_200;
/** The floor of hour records a real extract must reach (U3 §0.5). */
export const MIN_COUNT = 1_500;
export const POINT_SCALE = 100_000;
/** BBOX's south-west corner in 1/POINT_SCALE degrees: the first record's delta is from here. */
export const ORIGIN = [1_587_000, 4_572_000];
export const LICENCE = 'ODbL 1.0';
export const ATTRIBUTION = '© OpenStreetMap contributors';
/** shared/city/osm-hours.ts OPEN_KINDS, in that order (test/scripts/osm-hours.test.ts asserts the two agree). */
export const OPEN_KINDS = ['ljekarna', 'posta', 'knjiznica', 'trznica', 'trgovina', 'pekara', 'kafic', 'bar', 'restoran', 'kino', 'banka', 'benzinska', 'ordinacija'];
export const KINDS = [...OPEN_KINDS, 'venue'];

const HOURS_AMENITY = new Map([
  ['pharmacy', 'ljekarna'], ['post_office', 'posta'], ['library', 'knjiznica'], ['marketplace', 'trznica'],
  ['cafe', 'kafic'], ['bar', 'bar'], ['pub', 'bar'], ['restaurant', 'restoran'], ['fast_food', 'restoran'],
  ['cinema', 'kino'], ['bank', 'banka'], ['fuel', 'benzinska'], ['doctors', 'ordinacija'], ['clinic', 'ordinacija'], ['dentist', 'ordinacija'],
]);
const HOURS_SHOP = new Map([
  ['bakery', 'pekara'], ['supermarket', 'trgovina'], ['convenience', 'trgovina'], ['chemist', 'trgovina'], ['greengrocer', 'trgovina'],
  ['butcher', 'trgovina'], ['kiosk', 'trgovina'], ['hardware', 'trgovina'], ['florist', 'trgovina'],
]);
// `atm` and `theatre` have no hour records: a cash machine's or a box office's hours are not a visit.
const VENUE_AMENITY = new Set(['cafe', 'bar', 'pub', 'nightclub', 'cinema', 'theatre', 'arts_centre', 'community_centre', 'library']);
const VENUE_TOURISM = new Set(['museum', 'gallery']);
/** The keys the PBF reader pre-filters on before it builds an element's tags. */
export const SELECT_KEYS = ['amenity', 'shop', 'tourism'];

const USER_AGENT = 'Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr) osm-hours';

const nameOf = (tags) => String(tags.name ?? '').replace(/\s+/g, ' ').trim();
/** The open kind of an hour record, or null: the amenity decides before the shop. */
export function hoursKind(tags) {
  return HOURS_AMENITY.get(tags.amenity) ?? HOURS_SHOP.get(tags.shop) ?? null;
}
export function isVenue(tags) {
  return VENUE_AMENITY.has(tags.amenity) || VENUE_TOURISM.has(tags.tourism);
}
/** Whether an element can become a record: named, and an hour kind or a venue. */
export function selectElement(tags) {
  return nameOf(tags) !== '' && (hoursKind(tags) !== null || isVenue(tags));
}

/**
 * Elements ({ lon, lat, tags }) → records { name, kind, lon, lat, week } inside BBOX.
 * An hour kind with an `opening_hours` outside the parser's subset (or never open) is
 * dropped and counted; if it is also a venue it stays as a venue record (name only).
 */
export function buildRecords(elements) {
  const records = [];
  const reasons = {};
  let dropped = 0;
  const [west, south, east, north] = BBOX;
  for (const { lon, lat, tags } of elements) {
    if (!(lon >= west && lon <= east && lat >= south && lat <= north) || !selectElement(tags)) continue;
    const name = nameOf(tags);
    const kind = hoursKind(tags);
    const point = { lon: Math.round(lon * POINT_SCALE), lat: Math.round(lat * POINT_SCALE) };
    if (kind && tags.opening_hours !== undefined) {
      const parsed = parseOpeningHours(tags.opening_hours);
      const reason = parsed.reason ?? (parsed.days.every((ranges) => ranges.length === 0) ? 'never open' : null);
      if (!reason) {
        records.push({ name, kind, ...point, week: weekString(parsed.days) });
        continue;
      }
      dropped += 1;
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
    if (isVenue(tags)) records.push({ name, kind: 'venue', ...point, week: null });
  }
  records.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.lon - b.lon || a.lat - b.lat || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)));
  return { records, dropped, reasons };
}

/** Records → the struct-of-arrays file (shared/city/osm-hours.ts OsmHoursFile). */
export function encode(records, { builtAt, osmDate, dropped }) {
  const file = {
    version: 1, builtAt, osmDate, licence: LICENCE, attribution: ATTRIBUTION,
    count: records.filter((r) => r.week !== null).length,
    venues: records.filter((r) => r.week === null).length,
    dropped, origin: ORIGIN, kinds: KINDS,
    name: [], kind: [], lon: [], lat: [], week: [],
  };
  let [lon, lat] = ORIGIN;
  for (const r of records) {
    file.name.push(r.name);
    file.kind.push(KINDS.indexOf(r.kind));
    file.lon.push(r.lon - lon);
    file.lat.push(r.lat - lat);
    file.week.push(r.week);
    lon = r.lon; lat = r.lat;
  }
  return file;
}

export const serialise = (file) => `${JSON.stringify(file)}\n`;

/** One request for the Geofabrik extract, streamed to disk and renamed when complete. */
export async function fetchPbf(target, { fetchImpl = fetch } = {}) {
  await mkdir(dirname(target), { recursive: true });
  const response = await fetchImpl(PBF_URL, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`osm-hours: ${PBF_URL} answered HTTP ${response.status}`);
  const partial = `${target}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  await rename(partial, target);
  return (await stat(target)).size;
}

/** An Overpass JSON answer → elements; relations are skipped and counted, as the PBF reader does. */
export function overpassElements(json) {
  if (!json || !Array.isArray(json.elements)) throw new Error('osm-hours: an Overpass answer has an `elements` array');
  const elements = [];
  let relationsSkipped = 0;
  for (const e of json.elements) {
    if (!e || typeof e !== 'object' || !['node', 'way', 'relation'].includes(e.type)) throw new Error('osm-hours: invalid Overpass element type');
    const tags = e.tags ?? {};
    if (typeof tags !== 'object' || Array.isArray(tags) || !Object.values(tags).every((value) => typeof value === 'string')) {
      throw new Error('osm-hours: Overpass tags must be strings');
    }
    if (e.type === 'relation') { if (selectElement(tags)) relationsSkipped += 1; continue; }
    const lon = e.type === 'node' ? e.lon : e.center?.lon, lat = e.type === 'node' ? e.lat : e.center?.lat;
    if ((!Number.isFinite(lon) || !Number.isFinite(lat)) && selectElement(tags)) throw new Error('osm-hours: selected Overpass element has no point');
    if (Number.isFinite(lon) && Number.isFinite(lat)) elements.push({ lon, lat, tags });
  }
  const osmDate = json.osm3s?.timestamp_osm_base ?? null;
  if (osmDate !== null && (typeof osmDate !== 'string' || !Number.isFinite(Date.parse(osmDate)))) throw new Error('osm-hours: invalid Overpass data date');
  return { elements, relationsSkipped, osmDate };
}

function parseArgs(argv) {
  const args = { fetchFirst: false, pbf: null, input: null, builtAt: null, out: OUTPUT_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i], value = argv[i + 1];
    if (flag === '--fetch') { args.fetchFirst = true; continue; }
    if (!['--pbf', '--input', '--built-at', '--out'].includes(flag)) throw new Error(`osm-hours: unknown argument ${flag}`);
    if (!value || value.startsWith('--')) throw new Error(`${flag} expects a value`);
    if (flag === '--pbf') args.pbf = value;
    else if (flag === '--input') args.input = value;
    else if (flag === '--built-at') args.builtAt = value;
    else args.out = value;
    i += 1;
  }
  if (args.input && (args.pbf || args.fetchFirst)) throw new Error('osm-hours: --input excludes --pbf and --fetch');
  if (args.builtAt !== null && !Number.isFinite(Date.parse(args.builtAt))) throw new Error('--built-at expects an ISO instant');
  return args;
}

export async function main({ argv = process.argv.slice(2), cwd = process.cwd(), log = console.log, fetchImpl = fetch } = {}) {
  const started = Date.now();
  const args = parseArgs(argv);
  let elements, relationsSkipped, osmDate, source, reader = null;
  if (args.input) {
    const read = overpassElements(JSON.parse(await readFile(resolve(cwd, args.input), 'utf8')));
    ({ elements, relationsSkipped, osmDate } = read);
    source = args.input;
  } else {
    const path = resolve(cwd, args.pbf ?? CACHE_PBF);
    if (args.fetchFirst) log(`${await fetchPbf(path, { fetchImpl })} bytes <- ${PBF_URL}`);
    const read = readPois(path, { bbox: BBOX, keys: SELECT_KEYS, select: selectElement });
    elements = read.elements;
    relationsSkipped = read.stats.relationsSkipped;
    const ts = read.header.replicationTimestamp;
    osmDate = ts ? new Date(ts * 1000).toISOString().replace('.000Z', 'Z') : null;
    source = args.pbf ?? CACHE_PBF;
    reader = read.stats;
  }
  if (!osmDate) throw new Error('osm-hours: the input carries no data date (PBF osmosis_replication_timestamp, Overpass timestamp_osm_base)');
  const { records, dropped, reasons } = buildRecords(elements);
  const file = encode(records, { builtAt: args.builtAt ?? osmDate, osmDate, dropped });
  const json = serialise(file);
  const bytes = Buffer.byteLength(json, 'utf8');
  const gzipBytes = gzipSync(json, { level: 9 }).length;
  const seconds = (Date.now() - started) / 1000;
  const summary = { source, osmDate, elements: elements.length, count: file.count, venues: file.venues, dropped, reasons, relationsSkipped, reader, bytes, gzipBytes, seconds };
  log(`${file.count} hour records, ${file.venues} venues, ${dropped} dropped (${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}), ${relationsSkipped} relations skipped; OSM data of ${osmDate}`);
  log(`${bytes} bytes raw, ${gzipBytes} gzip (budgets ${MAX_BYTES} and ${MAX_GZIP_BYTES}); ${seconds.toFixed(1)} s`);
  if (bytes > MAX_BYTES || gzipBytes > MAX_GZIP_BYTES) {
    log('osm-hours: over budget; nothing written');
    process.exitCode = 1;
    return { ...summary, file, written: false };
  }
  // The small --input fixture is deliberately exempt from the production floor.
  // A partial/corrupt real extract must not replace the last usable artefact.
  if (!args.input && (file.count < MIN_COUNT || dropped / (file.count + dropped) >= 0.25)) {
    log('osm-hours: below the record floor or above the dropped-record limit; nothing written');
    process.exitCode = 1;
    return { ...summary, file, written: false };
  }
  const target = resolve(cwd, args.out);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, json, 'utf8');
  log(`-> ${args.out}`);
  return { ...summary, file, written: true, target };
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
