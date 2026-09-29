#!/usr/bin/env node
// Builds app/public/data/zet-expect.json: the fleet the timetable declares,
// the "expected" side of the twin's comparison of what it sees with what ZET
// planned (upgrade plan U2, decision D1). For every service of the feed, per
// five-minute slot of a 30-hour service day, the number of vehicle runs
// (GTFS blocks) in service, all together and by mode, and the number of trips
// in service per route; and for every date the calendar names, which services
// run. The service day is 31 hours (372 slots), not 30: the Saturday and
// holiday-eve night trams 31 to 34 run to 30:11:56 in feeds 000395 and 000396,
// and 31 hours is the shortest whole-hour day that holds every trip. A runtime derivation from the trip index would be circular (the twin's
// "running services" are whatever it sees), and the schedule shards answer per
// stop, so the expectation is a build-time artefact of its own.
//
// A block is in service from its first trip's first departure to its last
// trip's last arrival, layovers included, because ZET publishes the vehicle
// throughout. A block or trip counts in a slot when its interval meets the
// slot: start < slot end and end >= slot start (an instant trip counts in the
// slot it falls in), so every trip is counted somewhere and a run is never
// dropped between two slots. The slots start at the service day's start (GTFS
// noon minus twelve hours, shared/motion/bands.ts serviceDayStartSec) and run
// 31 hours, so the night trips past 24:00 stay on the service day that owns
// them; the build refuses a trip that ends at or past 31:00.
//
// Reuses the zero-dependency zip reader and CSV parser of gtfs-routes.mjs and
// the calendar resolution of gtfs-lastrun.mjs (servicesByDate: calendar.txt's
// weekday flags within their range, then calendar_dates.txt's additions and
// removals). stop_times.txt (about 80 MB uncompressed) is streamed once, as
// gtfs-shapes.mjs's streamTripEndpoints does, keeping only each trip's first
// departure and last arrival.
//
// Run locally with `npm run build:expect -- --zip <archive> [--built-at
// <its Last-Modified>]` (without --zip it downloads the live archive) and
// commit the result; the Worker never downloads the archive. `builtAt` is the
// --built-at value, else the download's Last-Modified, else the wall clock.
// `--out <file>` writes elsewhere (the fixture variants of older feeds).
//
// Attribution obligation (Otvorena dozvola, ZET) carries over unchanged; see
// ZET_ATTRIBUTION in gtfs-routes.mjs and the "Statički skupovi" rows in
// docs/izvori.md.
import { createInflateRaw, gzipSync } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GTFS_URL, ZET_ATTRIBUTION, compareRouteIds, extractEntry, localFileDataOffset, parseCsv, readZipEntries } from './gtfs-routes.mjs';
import { parseGtfsTime, servicesByDate } from './gtfs-lastrun.mjs';

export { GTFS_URL, ZET_ATTRIBUTION };
export const OUTPUT_PATH = 'app/public/data/zet-expect.json';
export const ARTEFACT_VERSION = 1;
export const SLOT_SEC = 300;
/** 31 hours of five-minute slots: a service day and the night trips past 24:00 (the latest ends at 30:11:56). */
export const SLOTS = 372;
export const DAY_END_SEC = SLOT_SEC * SLOTS;
/** GTFS route_type values the artefact splits by; any other type counts in `all` only. */
export const TRAM_ROUTE_TYPE = 0;
export const BUS_ROUTE_TYPE = 3;

const DOWNLOAD_TIMEOUT_MS = 60_000; // build-time download of a >10 MB archive, not a live request
const USER_AGENT = 'Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)';
const WEEKDAY_COLUMNS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function columnIndexer(header, fileName) {
  return (name) => {
    const idx = header.indexOf(name);
    if (idx === -1) throw new Error(`${fileName} lacks the ${name} column`);
    return idx;
  };
}

/** '20260914' to '2026-09-14'; null for anything else. */
function gtfsDateKey(text) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec((text ?? '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function shiftDay(dayKey, days) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Every date the calendar names, from the first date some service runs to the
 * last: calendar.txt rows with a weekday flag set span their start to end
 * date, calendar_dates.txt additions name their date. A date in between on
 * which no service runs is kept, with no service: the calendar says so.
 * @returns {Map<string, Set<string>>} date -> service ids, dates ascending
 */
export function calendarDates(calendarText, calendarDatesText) {
  const bounds = [];
  const calendar = parseCsv(calendarText);
  if (calendar.length > 1) {
    const col = columnIndexer(calendar[0], 'calendar.txt');
    const flags = WEEKDAY_COLUMNS.map((name) => col(name));
    const startIdx = col('start_date');
    const endIdx = col('end_date');
    for (const row of calendar.slice(1)) {
      if (!flags.some((i) => row[i] === '1')) continue;
      const start = gtfsDateKey(row[startIdx]);
      const end = gtfsDateKey(row[endIdx]);
      if (start && end && start <= end) bounds.push(start, end);
    }
  }
  const exceptions = parseCsv(calendarDatesText);
  if (exceptions.length > 1) {
    const col = columnIndexer(exceptions[0], 'calendar_dates.txt');
    const dateIdx = col('date');
    const typeIdx = col('exception_type');
    for (const row of exceptions.slice(1)) {
      const day = gtfsDateKey(row[dateIdx]);
      if (day && row[typeIdx] === '1') bounds.push(day);
    }
  }
  if (bounds.length === 0) return new Map();
  bounds.sort();
  const days = [];
  for (let day = bounds[0]; day <= bounds.at(-1); day = shiftDay(day, 1)) days.push(day);
  const active = servicesByDate(calendarText, calendarDatesText, days);
  // Trim the empty ends a calendar.txt range without a running weekday can leave.
  const named = days.filter((day) => active.get(day).size > 0);
  if (named.length === 0) return new Map();
  return new Map(days.filter((day) => day >= named[0] && day <= named.at(-1)).map((day) => [day, active.get(day)]));
}

function inflateLines(buf, entry) {
  const start = localFileDataOffset(buf, entry);
  const source = Readable.from([Buffer.from(buf.subarray(start, start + entry.compressedSize))]);
  if (entry.method === 8) return createInterface({ input: source.pipe(createInflateRaw()), crlfDelay: Infinity });
  if (entry.method === 0) return createInterface({ input: source, crlfDelay: Infinity });
  throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
}

/**
 * Streams stop_times.txt once and keeps, per trip, the departure at its first
 * stop and the arrival at its last, by stop_sequence (file order is not
 * trusted), in seconds past the service day's start. A missing time falls
 * back to the other one of the same row.
 * @returns {Promise<Map<string, { start: number; end: number }>>}
 */
export async function streamTripSpans(buf, entry) {
  const spans = new Map(); // tripId -> { firstSeq, start, lastSeq, end }
  let idx = null;
  for await (const line of inflateLines(buf, entry)) {
    if (idx === null) {
      const col = columnIndexer(parseCsv(line)[0] ?? [], 'stop_times.txt');
      idx = { trip: col('trip_id'), arrival: col('arrival_time'), departure: col('departure_time'), seq: col('stop_sequence') };
      continue;
    }
    if (line.trim() === '') continue;
    const row = parseCsv(line)[0];
    if (!row) continue;
    const tripId = row[idx.trip];
    const seq = Number(row[idx.seq]);
    const departure = parseGtfsTime(row[idx.departure]) ?? parseGtfsTime(row[idx.arrival]);
    const arrival = parseGtfsTime(row[idx.arrival]) ?? departure;
    if (!tripId || !Number.isFinite(seq) || departure === null) continue;
    const known = spans.get(tripId);
    if (!known) {
      spans.set(tripId, { firstSeq: seq, start: departure, lastSeq: seq, end: arrival });
      continue;
    }
    if (seq < known.firstSeq) {
      known.firstSeq = seq;
      known.start = departure;
    }
    if (seq > known.lastSeq) {
      known.lastSeq = seq;
      known.end = arrival;
    }
  }
  const out = new Map();
  for (const [tripId, s] of spans) out.set(tripId, { start: s.start, end: Math.max(s.start, s.end) });
  return out;
}

/** Adds one to every slot the interval [start, end] meets (start < slot end, end >= slot start). */
function addSpan(slots, start, end) {
  const first = Math.max(0, Math.floor(start / SLOT_SEC));
  const last = Math.min(SLOTS - 1, Math.floor(end / SLOT_SEC));
  for (let k = first; k <= last; k++) slots[k] += 1;
}

function feedVersionOf(text) {
  const rows = parseCsv(text);
  const idx = rows[0]?.indexOf('feed_version') ?? -1;
  const value = idx === -1 ? '' : (rows[1]?.[idx] ?? '').trim();
  return value === '' ? null : value;
}

/**
 * The artefact from a fully loaded GTFS zip buffer.
 * @param {Uint8Array} zipBuf
 * @param {{ builtAt: string; log?: (line: string) => void }} opts
 */
export async function buildExpectIndex(zipBuf, { builtAt, log = () => {} }) {
  const entries = readZipEntries(zipBuf);
  const entryOf = (name) => entries.find((e) => e.name === name || e.name.endsWith('/' + name));
  const textOf = (name) => {
    const entry = entryOf(name);
    return entry ? new TextDecoder('utf-8').decode(extractEntry(zipBuf, entry)) : '';
  };
  for (const name of ['routes.txt', 'trips.txt', 'stop_times.txt']) if (!entryOf(name)) throw new Error(`${name} not in archive`);
  const feedVersion = feedVersionOf(textOf('feed_info.txt'));
  if (!feedVersion) throw new Error('feed_info.txt names no feed_version');

  const routeRows = parseCsv(textOf('routes.txt'));
  const routeCol = columnIndexer(routeRows[0] ?? [], 'routes.txt');
  const routeIdIdx = routeCol('route_id');
  const routeTypeIdx = routeCol('route_type');
  const typeOf = new Map();
  for (const row of routeRows.slice(1)) if (row[routeIdIdx]) typeOf.set(row[routeIdIdx], Number(row[routeTypeIdx]));
  const routeIds = [...typeOf.keys()].sort(compareRouteIds);

  const tripRows = parseCsv(textOf('trips.txt'));
  const tripCol = columnIndexer(tripRows[0] ?? [], 'trips.txt');
  const tIdx = { route: tripCol('route_id'), service: tripCol('service_id'), trip: tripCol('trip_id') };
  const blockIdx = tripRows[0].indexOf('block_id'); // optional in GTFS; a trip without one is its own run
  const trips = [];
  for (const row of tripRows.slice(1)) {
    const tripId = row[tIdx.trip];
    if (!tripId) continue;
    const route = row[tIdx.route];
    if (!typeOf.has(route)) throw new Error(`trip ${tripId} names route ${route}, which routes.txt lacks`);
    const block = blockIdx === -1 ? '' : (row[blockIdx] ?? '').trim();
    trips.push({ tripId, route, service: row[tIdx.service], block: block === '' ? `trip:${tripId}` : block });
  }
  log(`${trips.length} trips over ${routeIds.length} routes; streaming stop_times.txt`);
  const spans = await streamTripSpans(zipBuf, entryOf('stop_times.txt'));

  const calendar = calendarDates(textOf('calendar.txt'), textOf('calendar_dates.txt'));
  const serviceIds = [...new Set([...trips.map((t) => t.service), ...[...calendar.values()].flatMap((set) => [...set])])].sort((a, b) =>
    a.localeCompare(b, 'en', { numeric: true }),
  );
  const serviceIndex = new Map(serviceIds.map((id, i) => [id, i]));

  // Per service: blocks (vehicle runs) as spans, trips per route as slot counts.
  const blockSpans = new Map(); // service -> Map<block, { start, end, types: Set }>
  const tripSlots = new Map(); // service -> Map<route, number[]>
  let late = null;
  for (const trip of trips) {
    const span = spans.get(trip.tripId);
    if (!span) throw new Error(`stop_times.txt has no rows for trip ${trip.tripId}`);
    if (span.end >= DAY_END_SEC && (late === null || span.end > late.end)) late = { tripId: trip.tripId, end: span.end };
    let byBlock = blockSpans.get(trip.service);
    if (!byBlock) blockSpans.set(trip.service, (byBlock = new Map()));
    const run = byBlock.get(trip.block);
    if (!run) byBlock.set(trip.block, { start: span.start, end: span.end, types: new Set([typeOf.get(trip.route)]) });
    else {
      run.start = Math.min(run.start, span.start);
      run.end = Math.max(run.end, span.end);
      run.types.add(typeOf.get(trip.route));
    }
    let byRoute = tripSlots.get(trip.service);
    if (!byRoute) tripSlots.set(trip.service, (byRoute = new Map()));
    let slots = byRoute.get(trip.route);
    if (!slots) byRoute.set(trip.route, (slots = new Array(SLOTS).fill(0)));
    addSpan(slots, span.start, span.end);
  }
  if (late !== null) {
    const h = Math.floor(late.end / 3600);
    const m = Math.floor((late.end % 3600) / 60);
    throw new Error(`trip ${late.tripId} ends at ${h}:${String(m).padStart(2, '0')}, past the ${SLOTS * SLOT_SEC / 3600}-hour service day the artefact covers`);
  }

  /** @type {Record<string, { all: number[]; tram: number[]; bus: number[] }>} */
  const blocks = {};
  /** @type {Record<string, Record<string, number[]>>} */
  const tripsOut = {};
  let mixed = 0;
  let longest = 0;
  for (const service of serviceIds) {
    const all = new Array(SLOTS).fill(0);
    const tram = new Array(SLOTS).fill(0);
    const bus = new Array(SLOTS).fill(0);
    for (const run of blockSpans.get(service)?.values() ?? []) {
      addSpan(all, run.start, run.end);
      longest = Math.max(longest, run.end);
      if (run.types.size > 1) mixed += 1;
      // A run is one vehicle: a tram block counts as a tram, a bus block as a bus.
      if (run.types.size === 1 && run.types.has(TRAM_ROUTE_TYPE)) addSpan(tram, run.start, run.end);
      else if (run.types.size === 1 && run.types.has(BUS_ROUTE_TYPE)) addSpan(bus, run.start, run.end);
    }
    blocks[service] = { all, tram, bus };
    const byRoute = tripSlots.get(service) ?? new Map();
    tripsOut[service] = Object.fromEntries([...byRoute.keys()].sort(compareRouteIds).map((route) => [route, byRoute.get(route)]));
  }
  if (mixed > 0) log(`${mixed} runs mix route types: counted in "all" only`);

  const artefact = {
    version: ARTEFACT_VERSION,
    feedVersion,
    builtAt,
    source: 'ZET GTFS',
    slotSec: SLOT_SEC,
    slots: SLOTS,
    services: serviceIds,
    calendar: Object.fromEntries([...calendar].map(([day, set]) => [day, [...set].map((id) => serviceIndex.get(id)).sort((a, b) => a - b)])),
    routes: { id: routeIds, type: routeIds.map((id) => typeOf.get(id)) },
    blocks,
    trips: tripsOut,
  };
  const days = [...calendar.keys()];
  const report = {
    trips: trips.length,
    services: serviceIds.length,
    runs: [...blockSpans.values()].reduce((n, m) => n + m.size, 0),
    mixedRuns: mixed,
    latestEndSec: longest,
    firstDate: days[0] ?? null,
    lastDate: days.at(-1) ?? null,
    dates: days.length,
  };
  return { artefact, report };
}

export async function main({
  fetchImpl = fetch,
  url = GTFS_URL,
  zipPath = /** @type {string | null} */ (null),
  builtAt: builtAtArg = /** @type {string | null} */ (null),
  out = OUTPUT_PATH,
  log = console.log,
  cwd = process.cwd(),
  now = () => new Date(),
} = {}) {
  const stampOf = (text, what) => {
    const ms = Date.parse(text);
    if (!Number.isFinite(ms)) throw new Error(`${what} ${JSON.stringify(text)} is not a time`);
    return new Date(ms).toISOString();
  };
  let buf;
  let builtAt = builtAtArg === null ? null : stampOf(builtAtArg, '--built-at');
  if (zipPath) {
    log(`Reading ${zipPath}`);
    buf = new Uint8Array(await readFile(resolve(cwd, zipPath)));
  } else {
    log(`Fetching ${url}`);
    const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`GTFS download failed: HTTP ${res.status}`);
    const lastModified = res.headers.get('last-modified');
    if (builtAt === null && lastModified !== null) builtAt = stampOf(lastModified, 'Last-Modified');
    buf = new Uint8Array(await res.arrayBuffer());
    log(`Downloaded ${(buf.byteLength / 1048576).toFixed(1)} MiB`);
  }
  if (builtAt === null) builtAt = now().toISOString();

  const started = Date.now();
  const { artefact, report } = await buildExpectIndex(buf, { builtAt, log });
  const target = resolve(cwd, out);
  await mkdir(dirname(target), { recursive: true });
  const json = JSON.stringify(artefact) + '\n';
  await writeFile(target, json, 'utf8');
  const rawBytes = Buffer.byteLength(json, 'utf8');
  const gzipBytes = gzipSync(Buffer.from(json, 'utf8')).length;
  log(
    `${report.services} services, ${report.runs} runs, ${report.trips} trips; calendar ${report.firstDate} to ${report.lastDate} (${report.dates} dates); ` +
      `feed ${artefact.feedVersion} -> ${out} (${rawBytes} bytes raw, ${gzipBytes} bytes gzip, ${Date.now() - started} ms)`,
  );
  log(`Attribution required wherever this file is used: ${ZET_ATTRIBUTION}`);
  return { ...report, rawBytes, gzipBytes, target, feedVersion: artefact.feedVersion, builtAt };
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  const flag = (name) => {
    const i = process.argv.indexOf(name);
    if (i === -1) return null;
    const value = process.argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
    return value;
  };
  Promise.resolve()
    .then(() => main({ zipPath: flag('--zip'), builtAt: flag('--built-at'), out: flag('--out') ?? OUTPUT_PATH }))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
