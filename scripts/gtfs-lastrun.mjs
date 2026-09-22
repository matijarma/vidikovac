#!/usr/bin/env node
// Builds app/public/data/lastrun/<stopId>.json, one small file per stop in
// app/public/data/stops.json: for every line that departs from the stop, the
// latest scheduled departure per GTFS service date (`routes`) and the earliest
// one (`first`, the wall's "Prvi tramvaj" row, WP1 step 1), over 21 days from
// the run plus the service day before it (a reader at 00:10 still asks about
// yesterday's service). The app fetches one file per session behind
// FEED_LASTRUN (plan A.6, D7, Task T3.1) and never bundles any of them.
//
// Reuses the zero-dependency zip reader and CSV parser from gtfs-routes.mjs
// and the stop_times streamer from gtfs-shapes.mjs: stop_times.txt is 92 MB
// uncompressed and is never held as one string. It is streamed twice, once
// for every trip's last stop_sequence (that row is the trip's arrival at its
// terminus, never a departure) and once for the departures themselves. Run
// locally with `node scripts/gtfs-lastrun.mjs [--zip <archive>]` and commit
// the directory; the Worker never downloads the 15 MB archive.
//
// The files keep GTFS's own clock, keyed by *service date*: a service day
// starts at noon minus twelve hours and runs past 24:00, so Friday's "24:15"
// is Saturday 00:15 and the night trams' "29:38" is 05:38 the next morning.
// Normalising those to the calendar date would make a Saturday whose own
// service ends at 23:48 collide with Friday's departure that rolled into it,
// and 968 of ZET's 5,106 stop/line pairs mix the two patterns across their
// services; app/src/core/lastrun.ts resolves the instant instead.
//
// Attribution obligation (Otvorena dozvola, ZET) carries over unchanged;
// see ZET_ATTRIBUTION in gtfs-routes.mjs and the "Statički skupovi" row in
// docs/izvori.md.
import { createInflateRaw } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareRouteIds, extractEntry, localFileDataOffset, parseCsv, readZipEntries } from './gtfs-routes.mjs';
import { streamTripEndpoints } from './gtfs-shapes.mjs';

export const GTFS_URL = 'https://www.zet.hr/gtfs-scheduled/latest';
export const OUTPUT_DIR = 'app/public/data/lastrun';
export const STOPS_PATH = 'app/public/data/stops.json';
/** The `source` every file states; the tile's context names it too ("po rasporedu · ZET GTFS"). */
export const SOURCE = 'ZET GTFS';
/** Service days from the run, the day before it added on top. */
export const HORIZON_DAYS = 21;

const DOWNLOAD_TIMEOUT_MS = 60_000; // build-time download of a >10 MB archive, not a live request
const USER_AGENT = 'Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)';
const ZAGREB_TZ = 'Europe/Zagreb';
const HOUR_MS = 3_600_000;
/** ZET's stop ids are `<code>_<platform>`; anything else is refused rather than written as an odd path. */
const STOP_ID = /^[A-Za-z0-9_-]+$/;

// ---------------------------------------------------------------------------
// GTFS time and Zagreb dates

/** 'HH:MM:SS' to seconds since the service day's noon minus twelve hours; hours may pass 24. Null for anything else. */
export function parseGtfsTime(text) {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(text ?? '');
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Seconds back to GTFS 'HH:MM' (whole minutes; '24:05' stays '24:05'). */
export function formatGtfsTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const DAY_PARTS = new Intl.DateTimeFormat('en-GB', { timeZone: ZAGREB_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const HOUR_PART = new Intl.DateTimeFormat('en-GB', { timeZone: ZAGREB_TZ, hour: '2-digit', hourCycle: 'h23' });

/** 'YYYY-MM-DD' of `date` on Zagreb's calendar. */
export function zagrebDayKey(date) {
  const p = {};
  for (const part of DAY_PARTS.formatToParts(date)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

function zagrebHour(ms) {
  return Number(HOUR_PART.formatToParts(new Date(ms)).find((part) => part.type === 'hour').value);
}

/** The UTC instant of Zagreb's noon on `dayKey`: a CEST guess corrected once by the hour the clock shows (noon never sits in a DST cut). */
function zagrebNoon(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 12) - 2 * HOUR_MS;
  return guess - (zagrebHour(guess) - 12) * HOUR_MS;
}

/** The UTC instant of a GTFS time on a service date, as the reference defines it: noon minus twelve hours, plus the time. */
function serviceInstant(dayKey, seconds) {
  return zagrebNoon(dayKey) - 12 * HOUR_MS + seconds * 1000;
}

function shiftDay(dayKey, days) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function dayKeys(from, count) {
  return Array.from({ length: count }, (_, i) => shiftDay(from, i));
}

// ---------------------------------------------------------------------------
// calendar.txt + calendar_dates.txt

const WEEKDAY_COLUMNS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']; // Date#getUTCDay order

/** '20260914' to '2026-09-14'; null for anything else. */
function gtfsDateKey(text) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec((text ?? '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function weekdayOf(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The services active on each of `days`: calendar.txt's weekday flags within
 * [start_date, end_date], then calendar_dates.txt's additions (1) and removals
 * (2). Either file may be empty; ZET's calendar.txt carries every weekday at
 * 0 and defines each service day through calendar_dates alone.
 * @returns {Map<string, Set<string>>}
 */
export function servicesByDate(calendarText, calendarDatesText, days) {
  const active = new Map(days.map((day) => [day, new Set()]));
  const calendar = parseCsv(calendarText);
  if (calendar.length > 1) {
    const h = calendar[0];
    const idIdx = h.indexOf('service_id');
    const startIdx = h.indexOf('start_date');
    const endIdx = h.indexOf('end_date');
    const weekdayIdx = WEEKDAY_COLUMNS.map((name) => h.indexOf(name));
    if (idIdx === -1 || startIdx === -1 || endIdx === -1 || weekdayIdx.includes(-1)) {
      throw new Error('calendar.txt lacks service_id, the seven weekday columns, start_date or end_date');
    }
    for (const row of calendar.slice(1)) {
      const id = row[idIdx];
      const start = gtfsDateKey(row[startIdx]);
      const end = gtfsDateKey(row[endIdx]);
      if (!id || !start || !end) continue;
      for (const day of days) {
        if (day < start || day > end) continue;
        if (row[weekdayIdx[weekdayOf(day)]] === '1') active.get(day).add(id);
      }
    }
  }
  const exceptions = parseCsv(calendarDatesText);
  if (exceptions.length > 1) {
    const h = exceptions[0];
    const idIdx = h.indexOf('service_id');
    const dateIdx = h.indexOf('date');
    const typeIdx = h.indexOf('exception_type');
    if (idIdx === -1 || dateIdx === -1 || typeIdx === -1) throw new Error('calendar_dates.txt lacks service_id, date or exception_type');
    for (const row of exceptions.slice(1)) {
      const set = active.get(gtfsDateKey(row[dateIdx]));
      if (!set || !row[idIdx]) continue;
      if (row[typeIdx] === '1') set.add(row[idIdx]);
      else if (row[typeIdx] === '2') set.delete(row[idIdx]);
    }
  }
  return active;
}

// ---------------------------------------------------------------------------
// trips.txt and stop_times.txt

/** @returns {Map<string, { routeId: string; serviceId: string }>} */
function parseTrips(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error('trips.txt is empty');
  const h = rows[0];
  const tripIdx = h.indexOf('trip_id');
  const routeIdx = h.indexOf('route_id');
  const serviceIdx = h.indexOf('service_id');
  if (tripIdx === -1 || routeIdx === -1 || serviceIdx === -1) throw new Error('trips.txt lacks trip_id, route_id or service_id');
  const trips = new Map();
  for (const row of rows.slice(1)) {
    if (row[tripIdx]) trips.set(row[tripIdx], { routeId: row[routeIdx], serviceId: row[serviceIdx] });
  }
  return trips;
}

function inflateLines(buf, entry) {
  const start = localFileDataOffset(buf, entry);
  const source = Readable.from([Buffer.from(buf.subarray(start, start + entry.compressedSize))]);
  if (entry.method === 8) return createInterface({ input: source.pipe(createInflateRaw()), crlfDelay: Infinity });
  if (entry.method === 0) return createInterface({ input: source, crlfDelay: Infinity });
  throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
}

/**
 * Streams stop_times.txt once more and keeps, per stop, line and service, the
 * latest and the earliest departure in seconds. A row is a departure only when
 * a passenger can board there: never the trip's last stop (its arrival at the
 * terminus, by stop_sequence, so file order does not matter) and never a
 * pickup_type 1 row.
 * @returns {Promise<{ latest: Map<string, Map<string, Map<string, number>>>; earliest: Map<string, Map<string, Map<string, number>>> }>}
 */
export async function streamDepartureBounds(buf, entry, { trips, endpoints, stopIds }) {
  const latest = new Map();
  const earliest = new Map();
  const keep = (table, stopId, routeId, serviceId, seconds, better) => {
    let byRoute = table.get(stopId);
    if (!byRoute) table.set(stopId, (byRoute = new Map()));
    let byService = byRoute.get(routeId);
    if (!byService) byRoute.set(routeId, (byService = new Map()));
    const known = byService.get(serviceId);
    if (known === undefined || better(seconds, known)) byService.set(serviceId, seconds);
  };
  let header = null;
  let idx = null;
  for await (const line of inflateLines(buf, entry)) {
    if (header === null) {
      header = parseCsv(line)[0] ?? [];
      idx = {
        trip: header.indexOf('trip_id'),
        departure: header.indexOf('departure_time'),
        stop: header.indexOf('stop_id'),
        seq: header.indexOf('stop_sequence'),
        pickup: header.indexOf('pickup_type'),
      };
      if (idx.trip === -1 || idx.departure === -1 || idx.stop === -1 || idx.seq === -1) {
        throw new Error('stop_times.txt lacks trip_id, departure_time, stop_id or stop_sequence');
      }
      continue;
    }
    if (line.trim() === '') continue;
    const row = parseCsv(line)[0];
    if (!row) continue;
    const stopId = row[idx.stop];
    if (!stopIds.has(stopId)) continue;
    const tripId = row[idx.trip];
    const ends = endpoints.get(tripId);
    if (ends && Number(row[idx.seq]) === ends.lastSeq) continue;
    if (idx.pickup !== -1 && row[idx.pickup] === '1') continue;
    const seconds = parseGtfsTime(row[idx.departure]);
    if (seconds === null) continue;
    const trip = trips.get(tripId);
    if (!trip) continue;
    keep(latest, stopId, trip.routeId, trip.serviceId, seconds, (a, b) => a > b);
    keep(earliest, stopId, trip.routeId, trip.serviceId, seconds, (a, b) => a < b);
  }
  return { latest, earliest };
}

function feedVersionOf(text) {
  const rows = parseCsv(text);
  const idx = rows[0]?.indexOf('feed_version') ?? -1;
  const value = idx === -1 ? '' : (rows[1]?.[idx] ?? '').trim();
  return value === '' ? null : value;
}

// ---------------------------------------------------------------------------
// The files

/**
 * One file per requested stop, from a fully loaded GTFS zip buffer.
 * `today` is the run's Zagreb date; the window is the day before it plus
 * `days` from it. `validUntil` is the last instant a file speaks for: its
 * latest resolved departure, or the midnight ending the window for a stop
 * with none. Routes are ordered as gtfs-routes orders them, dates ascending;
 * `first` carries the same lines and dates as `routes`, with the earliest
 * departure of each service date instead of the latest.
 * @param {Uint8Array} zipBuf
 * @returns {Promise<Map<string, { generatedAt: string; validUntil: string; source: string; routes: Record<string, Record<string, string>>; first: Record<string, Record<string, string>> }>>}
 */
export async function buildLastRun(zipBuf, { stopIds, today, generatedAt, days = HORIZON_DAYS, log = () => {} }) {
  const entries = readZipEntries(zipBuf);
  const entryOf = (name) => entries.find((e) => e.name === name);
  const textOf = (name) => {
    const entry = entryOf(name);
    return entry ? new TextDecoder('utf-8').decode(extractEntry(zipBuf, entry)) : '';
  };
  const stopTimes = entryOf('stop_times.txt');
  if (!stopTimes) throw new Error('stop_times.txt not in archive');
  if (!entryOf('trips.txt')) throw new Error('trips.txt not in archive');

  const trips = parseTrips(textOf('trips.txt'));
  const window = dayKeys(shiftDay(today, -1), days + 1);
  const active = servicesByDate(textOf('calendar.txt'), textOf('calendar_dates.txt'), window);
  log(`${trips.size} trips; service days ${window[0]} to ${window.at(-1)}`);

  log('Streaming stop_times.txt for every trip’s last stop');
  const endpoints = await streamTripEndpoints(zipBuf, stopTimes);
  log('Streaming stop_times.txt for the departures');
  const { latest, earliest } = await streamDepartureBounds(zipBuf, stopTimes, { trips, endpoints, stopIds: new Set(stopIds) });

  const files = new Map();
  for (const stopId of stopIds) {
    const byRoute = latest.get(stopId) ?? new Map();
    const firstByRoute = earliest.get(stopId) ?? new Map();
    const routes = {};
    const first = {};
    let lastInstant = -Infinity;
    for (const routeId of [...byRoute.keys()].sort(compareRouteIds)) {
      const byService = byRoute.get(routeId);
      const firstByService = firstByRoute.get(routeId) ?? new Map();
      const table = {};
      const firstTable = {};
      for (const day of window) {
        let best = -1;
        let earliestSeconds = Infinity;
        for (const serviceId of active.get(day)) {
          const seconds = byService.get(serviceId);
          if (seconds !== undefined && seconds > best) best = seconds;
          const early = firstByService.get(serviceId);
          if (early !== undefined && early < earliestSeconds) earliestSeconds = early;
        }
        if (best < 0) continue;
        const minute = Math.floor(best / 60) * 60; // what the file states, so validUntil agrees with what the app resolves
        table[day] = formatGtfsTime(minute);
        lastInstant = Math.max(lastInstant, serviceInstant(day, minute));
        // Whole minutes, as `routes` states them: 04:37:30 is written 04:37.
        if (earliestSeconds < Infinity) firstTable[day] = formatGtfsTime(Math.floor(earliestSeconds / 60) * 60);
      }
      if (Object.keys(table).length > 0) routes[routeId] = table;
      if (Object.keys(firstTable).length > 0) first[routeId] = firstTable;
    }
    const validUntil = new Date(lastInstant > -Infinity ? lastInstant : zagrebNoon(window.at(-1)) + 12 * HOUR_MS).toISOString();
    files.set(stopId, { generatedAt, validUntil, source: SOURCE, routes, first });
  }
  return files;
}

export async function main({
  fetchImpl = fetch,
  url = GTFS_URL,
  zipPath = /** @type {string | null} */ (null),
  out = OUTPUT_DIR,
  stopsPath = STOPS_PATH,
  cwd = process.cwd(),
  now = () => new Date(),
  log = console.log,
} = {}) {
  let buf;
  if (zipPath) {
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
    buf = new Uint8Array(await res.arrayBuffer());
    log(`Downloaded ${(buf.byteLength / 1048576).toFixed(1)} MiB`);
  }

  const stops = JSON.parse(await readFile(resolve(cwd, stopsPath), 'utf8'));
  if (!Array.isArray(stops)) throw new Error(`${stopsPath} is not a stop list`);
  const stopIds = stops.map((stop) => stop?.id).filter((id) => typeof id === 'string' && id !== '');
  const odd = stopIds.find((id) => !STOP_ID.test(id));
  if (odd !== undefined) throw new Error(`Stop id ${JSON.stringify(odd)} is not a safe file name`);

  const runAt = now();
  const files = await buildLastRun(buf, { stopIds, today: zagrebDayKey(runAt), generatedAt: runAt.toISOString(), log });
  const feedInfo = readZipEntries(buf).find((e) => e.name === 'feed_info.txt');
  const feedVersion = feedInfo ? feedVersionOf(new TextDecoder('utf-8').decode(extractEntry(buf, feedInfo))) : null;

  const dir = resolve(cwd, out);
  await mkdir(dir, { recursive: true });
  let bytes = 0;
  let withDepartures = 0;
  for (const [stopId, file] of files) {
    const json = JSON.stringify(file) + '\n';
    bytes += Buffer.byteLength(json, 'utf8');
    if (Object.keys(file.routes).length > 0) withDepartures += 1;
    await writeFile(resolve(dir, `${stopId}.json`), json, 'utf8');
  }
  // The directory mirrors stops.json: a stop that left the catalogue leaves no file behind.
  const keep = new Set([...files.keys()].map((id) => `${id}.json`));
  let removed = 0;
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.json') || keep.has(name)) continue;
    await unlink(resolve(dir, name));
    removed += 1;
  }
  log(`${files.size} stops, ${withDepartures} with departures, feed ${feedVersion ?? 'unknown'} -> ${out} (${bytes} bytes, ${removed} stale files removed)`);
  return { stops: stopIds.length, written: files.size, withDepartures, removed, bytes, feedVersion, target: dir };
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  const zipFlag = process.argv.indexOf('--zip');
  main({ zipPath: zipFlag === -1 ? null : process.argv[zipFlag + 1] ?? null }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
