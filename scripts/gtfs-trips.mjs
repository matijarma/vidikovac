#!/usr/bin/env node
// Builds app/public/data/zet-trips.json: a compact, columnar trip index the
// twin (worker/do/twin-do.ts, task A3) bulk-loads once per GTFS feedVersion
// into its own SQLite tables, so a realtime trip_id resolves in one lookup
// to its direction, headsign, shape (or a `path:` id, task B1), block and
// pattern, and every pattern carries its ordered stop sequence with the
// median scheduled inter-stop seconds by hour band. The client never loads
// this file: app/public/data/ artefacts are build artefacts of the
// application, never published under /open (twin-engine global constraints).
//
// Reuses the zero-dependency zip reader and CSV parser from gtfs-routes.mjs,
// and streams stop_times.txt with the same inflate -> readline pattern as
// gtfs-shapes.mjs's streamTripEndpoints (92 MB uncompressed for the real
// feed, never held as one string) -- but needs every stop of every trip, not
// just the first/last, so it is its own streamer, not a reuse of that
// function. trips.txt likewise gets its own parser: gtfs-shapes.mjs's
// parseTripsTxt only reads route/trip/shape for the network artefact and the
// brief for this task asks not to change it.
//
// Run locally with `npm run build:trips` (optionally
// `-- --zip <path-to-local-copy.zip>` to skip the download) and commit the
// result; the Worker never downloads the 15 MB archive, exactly like
// gtfs-routes.mjs and gtfs-shapes.mjs.
import { createInflateRaw, gzipSync } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GTFS_URL, ZET_ATTRIBUTION, compareRouteIds, extractEntry, localFileDataOffset, parseCsv, readZipEntries } from './gtfs-routes.mjs';

export { GTFS_URL, ZET_ATTRIBUTION };
export const OUTPUT_PATH = 'app/public/data/zet-trips.json';

// Build-time download of a >10 MB archive: not a runtime fetch, so the
// spec's 6 s ceiling for live requests (worker/feed/http.ts) does not apply
// here -- same reasoning and same value as gtfs-routes.mjs/gtfs-shapes.mjs.
const DOWNLOAD_TIMEOUT_MS = 60_000;
const USER_AGENT = 'Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)';

/** The only version shared/motion/trips.ts's decodeTripIndex accepts. */
export const ARTEFACT_VERSION = 1;

// A pattern's schedule is bucketed by the hour of day (Zagreb wall clock, as
// GTFS's own HH:MM:SS already states it -- no timezone conversion needed),
// 24 bands so every hour of a service day gets its own median, matching the
// grain the static timetable itself is written at (a schedule never varies
// within an hour block in practice, only between them: peak vs off-peak vs
// night headways).
export const HOUR_BANDS = 24;

function columnIndexer(header, fileName) {
  return (name) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`${fileName} lacks the column ${name} (header: ${header.join(',')})`);
    return i;
  };
}

/** 'HH:MM:SS' to seconds past service midnight; hours may exceed 24 (GTFS's
 *  own past-midnight convention for a night trip that keeps its clock
 *  running after the calendar day rolls over, e.g. "25:10:00"). Throws on
 *  anything else: a blank or malformed scheduled time is a build-time data
 *  problem to fix in the source, never silently zeroed into a wrong plan. */
export function parseGtfsTime(text) {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec((text ?? '').trim());
  if (!m) throw new Error(`Not a GTFS HH:MM:SS time: ${JSON.stringify(text)}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** trips.txt rows (header first) -> Map<trip_id, {route, service, headsign,
 *  direction, block, shape}>. Written for this script rather than reusing
 *  gtfs-shapes.mjs's parseTripsTxt, which only reads route/trip/shape for
 *  the network artefact and the brief for this task asks not to change it. */
export function parseTripsForIndex(rows) {
  if (rows.length === 0) throw new Error('trips.txt is empty');
  const col = columnIndexer(rows[0], 'trips.txt');
  const routeIdx = col('route_id');
  const serviceIdx = col('service_id');
  const tripIdx = col('trip_id');
  const headsignIdx = col('trip_headsign');
  const directionIdx = col('direction_id');
  const blockIdx = col('block_id');
  const shapeIdx = col('shape_id');
  const trips = new Map();
  for (const r of rows.slice(1)) {
    const tripId = r[tripIdx];
    if (!tripId) continue;
    const direction = Number(r[directionIdx]);
    if (direction !== 0 && direction !== 1) {
      throw new Error(`trip ${tripId} has a non-binary direction_id ${JSON.stringify(r[directionIdx])}`);
    }
    const blockId = (r[blockIdx] ?? '').trim();
    if (blockId === '') throw new Error(`trip ${tripId} has no block_id`);
    trips.set(tripId, {
      route: r[routeIdx],
      service: r[serviceIdx],
      headsign: (r[headsignIdx] ?? '').trim(),
      direction,
      block: blockId,
      shape: (r[shapeIdx] ?? '').trim(),
    });
  }
  return trips;
}

// ---------------------------------------------------------------------------
// stop_times.txt: 92 MB uncompressed for the real feed, never held in memory
// as one string. Unlike gtfs-shapes.mjs's streamTripEndpoints (which only
// needs a trip's first/last stop to link a shape to its terminus stops),
// this keeps every stop of every trip: a pattern's ordered stop list and its
// per-pair scheduled seconds need the whole sequence.

/** Streams stop_times.txt and returns Map<trip_id, {seq, stopId, arrival,
 *  departure}[]>, sorted by stop_sequence (not trusted from file order, same
 *  reasoning as streamTripEndpoints). */
export async function streamStopTimes(buf, entry) {
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
  const byTrip = new Map();
  let header = null;
  let idx = null;
  for await (const line of rl) {
    if (header === null) {
      header = parseCsv(line)[0] ?? [];
      idx = {
        trip: header.indexOf('trip_id'),
        arrival: header.indexOf('arrival_time'),
        departure: header.indexOf('departure_time'),
        stop: header.indexOf('stop_id'),
        seq: header.indexOf('stop_sequence'),
      };
      if (Object.values(idx).some((i) => i === -1)) {
        throw new Error('stop_times.txt lacks trip_id, arrival_time, departure_time, stop_id or stop_sequence');
      }
      continue;
    }
    if (line.trim() === '') continue;
    const row = parseCsv(line)[0];
    if (!row) continue;
    const tripId = row[idx.trip];
    const stopRow = {
      seq: Number(row[idx.seq]),
      stopId: row[idx.stop],
      arrival: parseGtfsTime(row[idx.arrival]),
      departure: parseGtfsTime(row[idx.departure]),
    };
    let arr = byTrip.get(tripId);
    if (!arr) byTrip.set(tripId, (arr = []));
    arr.push(stopRow);
  }
  for (const arr of byTrip.values()) arr.sort((a, b) => a.seq - b.seq);
  return byTrip;
}

// ---------------------------------------------------------------------------
// Medians and the 24-band nearest-fill.

/** Sorted (ascending) array's median: for an even length this is the
 *  *lower* of the two middle values (index floor((n-1)/2)), never their
 *  average -- every number this artefact publishes is a real observed
 *  scheduled interval, not a synthetic blend of two (see the file header
 *  comment in shared/motion/trips.ts, which documents this for readers of
 *  the decoded form too). For an odd length this is the ordinary middle. */
export function median(sortedAscending) {
  if (sortedAscending.length === 0) throw new Error('median of an empty array');
  return sortedAscending[Math.floor((sortedAscending.length - 1) / 2)];
}

/** Circular distance between two hour bands on the 24-band cycle. */
function bandDistance(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, HOUR_BANDS - d);
}

/** Fills the empty (null) cells of one stop pair's 24-band schedule from the
 *  nearest populated band -- circular distance over the 24-hour cycle, a
 *  tie broken toward the lower band index. Applied independently per stop
 *  pair (not once per pattern): a long pattern's trips can drift across
 *  hour boundaries at different pairs, so one pair's populated bands need
 *  not match another's. Mutates and returns `bands`. */
function fillNearestBand(bands) {
  const populated = [];
  for (let b = 0; b < HOUR_BANDS; b++) if (bands[b] !== null) populated.push(b);
  if (populated.length === 0) throw new Error('a stop pair has zero scheduled observations in every hour band');
  for (let b = 0; b < HOUR_BANDS; b++) {
    if (bands[b] !== null) continue;
    let best = populated[0];
    let bestDist = bandDistance(b, best);
    for (let i = 1; i < populated.length; i++) {
      const p = populated[i];
      const d = bandDistance(b, p);
      if (d < bestDist || (d === bestDist && p < best)) {
        best = p;
        bestDist = d;
      }
    }
    bands[b] = bands[best];
  }
  return bands;
}

// ---------------------------------------------------------------------------
// Trip id and start-time encodings. Both exist solely to hit the 250 KB
// gzip budget on the real feed (measured, see buildTripIndex's own comment
// at the point these are used): gzip's LZ77 window is 32 KiB, far smaller
// than the ~78k-entry trip arrays, so redundancy far apart in either array
// is invisible to it and has to be removed explicitly instead.

/** Front-coding (incremental/prefix coding) for a *sorted* array of
 *  strings: returns parallel arrays `common` (characters shared with the
 *  previous string; 0 for the first entry) and `suffix` (the remainder).
 *  Lossless and exact -- chainDecodeIds (shared/motion/trips.ts) reverses
 *  it by chaining prev.slice(0, common[i]) + suffix[i]. ZET's own trip ids
 *  are `{service_id}_{block_id}_{route_id}_{sequential}`, so sorted
 *  neighbours share a long run of that prefix (measured on the real feed:
 *  ~17 of ~19 characters on average) -- this roughly halves that column's
 *  real gzip size, a bigger and more reliable win than leaving it to gzip's
 *  own window. */
export function chainEncodeIds(sortedIds) {
  const common = [];
  const suffix = [];
  let prev = '';
  for (const id of sortedIds) {
    let c = 0;
    const max = Math.min(prev.length, id.length);
    while (c < max && prev[c] === id[c]) c++;
    common.push(c);
    suffix.push(id.slice(c));
    prev = id;
  }
  return { common, suffix };
}

/** Inverse of chainEncodeIds, exported for this script's own tests (the
 *  real decoder is shared/motion/trips.ts's private chainDecodeIds, kept
 *  independent on purpose -- see that file's header comment for why). */
export function chainDecodeIds(common, suffix) {
  const ids = [];
  let prev = '';
  for (let i = 0; i < suffix.length; i++) {
    const id = prev.slice(0, common[i]) + suffix[i];
    ids.push(id);
    prev = id;
  }
  return ids;
}

/** Chain-delta encoding of a numeric sequence: the first value verbatim,
 *  every later one as its difference from the previous -- one-dimensional
 *  version of gtfs-shapes.mjs's chainEncodeXY. Trips are stored sorted by
 *  id, and a run of ids sharing a service/block/route prefix (see
 *  chainEncodeIds) are that block's own consecutive scheduled trips: their
 *  start times cluster far more tightly than their absolute values
 *  (measured on the real feed: a median |delta| of 2,655 s against
 *  absolute values spanning a whole service day, up to roughly 100,000),
 *  which is what actually shrinks the gzip size, not merely fewer digits. */
export function chainEncodeDeltas(values) {
  const out = [];
  let prev = 0;
  for (const v of values) {
    out.push(v - prev);
    prev = v;
  }
  return out;
}

/** Inverse of chainEncodeDeltas, exported for this script's own tests. */
export function chainDecodeDeltas(deltas) {
  const out = [];
  let sum = 0;
  for (const d of deltas) {
    sum += d;
    out.push(sum);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orchestration.

/**
 * Builds the trip index artefact from a fully loaded GTFS zip buffer.
 * @param {Uint8Array} zipBuf
 * @param {{ now?: () => Date, fallbackFeedVersion?: string | null, log?: (s: string) => void }} [opts]
 * @returns {Promise<{ artefact: import('../shared/motion/trips').TripIndexWire, report: { patterns: number, trips: number, blocks: number, multiRouteBlocks: number, tripsWithoutShapeByRoute: Record<string, number> } }>}
 */
export async function buildTripIndex(zipBuf, opts = {}) {
  const { now = () => new Date(), fallbackFeedVersion = null, log = () => {} } = opts;

  const entries = readZipEntries(zipBuf);
  const findEntry = (name) => {
    const e = entries.find((x) => x.name === name || x.name.endsWith('/' + name));
    if (!e) throw new Error(`${name} not in archive (entries: ${entries.map((x) => x.name).join(', ')})`);
    return e;
  };
  const textOf = (name) => new TextDecoder('utf-8').decode(extractEntry(zipBuf, findEntry(name)));

  let feedVersion = fallbackFeedVersion;
  try {
    const rows = parseCsv(textOf('feed_info.txt'));
    const idx = rows[0]?.indexOf('feed_version') ?? -1;
    const value = idx === -1 ? '' : (rows[1]?.[idx] ?? '').trim();
    if (value) feedVersion = value;
  } catch {
    // feed_info.txt is optional in GTFS; fall through to fallbackFeedVersion.
  }
  if (!feedVersion) {
    throw new Error('No feedVersion available: feed_info.txt lacks feed_version and no fallback was supplied');
  }

  const trips = parseTripsForIndex(parseCsv(textOf('trips.txt')));
  log(`${trips.size} trips`);

  log('Streaming stop_times.txt');
  const stopTimesByTrip = await streamStopTimes(zipBuf, findEntry('stop_times.txt'));

  for (const tripId of trips.keys()) {
    if (!stopTimesByTrip.has(tripId)) throw new Error(`stop_times.txt has no rows for trip ${tripId}`);
  }

  // Group trips into patterns: (route, direction, shape-or-'', ordered stop
  // sequence). A shared shape_id says nothing about which stops a trip
  // actually served, so two trips on the same shape but a different stop
  // sequence are different patterns (a short-turn, an express skip); keyed
  // on a delimiter (U+0001) that cannot appear in a GTFS id field, cheaper
  // and exact compared to JSON.stringify-ing the tuple.
  const patternGroups = new Map(); // key -> { route, direction, shape, stops, tripIds: [] }
  for (const [tripId, trip] of trips) {
    const stops = stopTimesByTrip.get(tripId).map((s) => s.stopId);
    const key = `${trip.route}${trip.direction}${trip.shape}${stops.join('')}`;
    let group = patternGroups.get(key);
    if (!group) {
      group = { route: trip.route, direction: trip.direction, shape: trip.shape, stops, tripIds: [] };
      patternGroups.set(key, group);
    }
    group.tripIds.push(tripId);
  }

  // Deterministic pattern order (R-TE9: no randomness, and no accidental
  // dependency on trips.txt's own row order or Map iteration order either):
  // route (numeric-aware, matching gtfs-routes.mjs/gtfs-shapes.mjs), then
  // direction, then shape ('' first), then the stop sequence itself.
  const patternKeys = [...patternGroups.keys()].sort((ka, kb) => {
    const a = patternGroups.get(ka);
    const b = patternGroups.get(kb);
    return (
      compareRouteIds(a.route, b.route) ||
      a.direction - b.direction ||
      (a.shape < b.shape ? -1 : a.shape > b.shape ? 1 : 0) ||
      (ka < kb ? -1 : ka > kb ? 1 : 0)
    );
  });

  const headsigns = [];
  const headsignIndex = new Map();
  const internHeadsign = (s) => {
    let i = headsignIndex.get(s);
    if (i === undefined) {
      i = headsigns.length;
      headsigns.push(s);
      headsignIndex.set(s, i);
    }
    return i;
  };

  const patterns = [];
  const tripPatternIndex = new Map(); // trip_id -> index into patterns[]
  const tripsWithoutShapeByRoute = new Map();

  for (const key of patternKeys) {
    const group = patternGroups.get(key);
    const stops = group.stops;
    const pairs = stops.length - 1;

    // Most common trip_headsign among the group's own trips (ties broken
    // alphabetically): almost always unanimous, but a pattern can carry a
    // handful of one-off variant spellings (a mid-season announcement
    // wording change) that must not each force their own pattern.
    const headsignCounts = new Map();
    for (const tripId of group.tripIds) {
      const h = trips.get(tripId).headsign;
      headsignCounts.set(h, (headsignCounts.get(h) ?? 0) + 1);
    }
    let bestHeadsign = '';
    let bestCount = -1;
    for (const h of [...headsignCounts.keys()].sort()) {
      const c = headsignCounts.get(h);
      if (c > bestCount) {
        bestCount = c;
        bestHeadsign = h;
      }
    }

    // Per-pair, per-hour-band raw observations, and per-stop dwell
    // observations (see shared/motion/trips.ts for exactly what a sample is
    // and how a band is chosen).
    const rawByBandPair = Array.from({ length: HOUR_BANDS }, () => Array.from({ length: pairs }, () => []));
    const dwellRaw = Array.from({ length: stops.length }, () => []);
    for (const tripId of group.tripIds) {
      const st = stopTimesByTrip.get(tripId);
      for (let i = 0; i < stops.length; i++) dwellRaw[i].push(st[i].departure - st[i].arrival);
      for (let i = 0; i < pairs; i++) {
        const travel = st[i + 1].arrival - st[i].departure;
        const band = Math.floor(st[i].departure / 3600) % HOUR_BANDS;
        rawByBandPair[band][i].push(travel);
      }
    }
    const sched = Array.from({ length: HOUR_BANDS }, () => new Array(pairs).fill(null));
    for (let band = 0; band < HOUR_BANDS; band++) {
      for (let i = 0; i < pairs; i++) {
        const samples = rawByBandPair[band][i];
        if (samples.length > 0) sched[band][i] = median(samples.slice().sort((a, b) => a - b));
      }
    }
    // Nearest-band fill, one stop pair (one column across the 24 bands) at
    // a time -- see fillNearestBand's own comment for why per-pair, not
    // once per pattern.
    for (let i = 0; i < pairs; i++) {
      const column = sched.map((row) => row[i]);
      fillNearestBand(column);
      for (let band = 0; band < HOUR_BANDS; band++) sched[band][i] = column[band];
    }
    const dwell = dwellRaw.map((arr) => median(arr.slice().sort((a, b) => a - b)));

    if (group.shape === '') {
      tripsWithoutShapeByRoute.set(group.route, (tripsWithoutShapeByRoute.get(group.route) ?? 0) + group.tripIds.length);
    }

    const patternIdx = patterns.length;
    for (const tripId of group.tripIds) tripPatternIndex.set(tripId, patternIdx);
    patterns.push({
      route: group.route,
      direction: group.direction,
      shape: group.shape,
      headsign: internHeadsign(bestHeadsign),
      stops,
      sched,
      dwell,
      trips: group.tripIds.length,
    });
  }

  // Trips: sorted by id, dictionary-coded pattern/block/service. The real
  // feed (77,905 trips) measured at 622 KB gzip with the brief's illustrative
  // per-field encoding, 2.5x the 250 KB target; profiling found three columns
  // responsible for nearly all of it: the trip id strings (222 KB gzip),
  // start times (150 KB) and a `blocks.trips` array (183 KB) that turned out
  // to be fully redundant with trips.block + trips.start (see below) -- gzip's
  // 32 KiB back-reference window cannot see repetition across a ~78k-entry
  // array, so leaving compression to gzip alone left real, measured
  // redundancy on the table. Two encodings below remove it explicitly.
  const tripIdsSorted = [...trips.keys()].sort();
  const blockIds = [...new Set(tripIdsSorted.map((id) => trips.get(id).block))].sort();
  const blockIndexById = new Map(blockIds.map((id, i) => [id, i]));
  const serviceIds = [...new Set(tripIdsSorted.map((id) => trips.get(id).service))].sort();
  const serviceIndexById = new Map(serviceIds.map((id, i) => [id, i]));
  const tripStartAbs = new Map(tripIdsSorted.map((id) => [id, stopTimesByTrip.get(id)[0].departure]));

  const idChain = chainEncodeIds(tripIdsSorted);
  const startChain = chainEncodeDeltas(tripIdsSorted.map((id) => tripStartAbs.get(id)));
  // pattern/block also chain-delta encoded (same helper as start): a run of
  // ids sharing a service/block/route prefix (see chainEncodeIds) is
  // usually one block's own consecutive trips on one route, so their
  // pattern and block indices repeat far more than they change -- measured
  // on the real feed, this trims a further ~2 KB of gzip size for
  // essentially no extra decode cost (chainDecodeDeltas, already needed for
  // `start`). `service` was measured too and is NOT delta-encoded: service
  // ids don't cluster with the trip id's own prefix the way block/route do,
  // so delta-encoding measured very slightly *larger* after gzip.
  const patternChain = chainEncodeDeltas(tripIdsSorted.map((id) => tripPatternIndex.get(id)));
  const blockChain = chainEncodeDeltas(tripIdsSorted.map((id) => blockIndexById.get(trips.get(id).block)));

  const tripsOut = {
    idCommon: idChain.common,
    idSuffix: idChain.suffix,
    pattern: patternChain,
    block: blockChain,
    start: startChain,
    service: tripIdsSorted.map((id) => serviceIndexById.get(trips.get(id).service)),
  };

  // Departure order and the multi-route-block count both need trip ids
  // grouped by block; this is worked out here for the build report only --
  // it is NOT written to the artefact (see the comment above), because a
  // reader can derive it in one pass over trips.block/trips.start (the
  // decoder in shared/motion/trips.ts does exactly that).
  const tripArrayIndexById = new Map(tripIdsSorted.map((id, i) => [id, i]));
  const blockTripsForReport = blockIds.map(() => []);
  for (const tripId of tripIdsSorted) {
    blockTripsForReport[blockIndexById.get(trips.get(tripId).block)].push(tripArrayIndexById.get(tripId));
  }
  for (const arr of blockTripsForReport) arr.sort((a, b) => tripStartAbs.get(tripIdsSorted[a]) - tripStartAbs.get(tripIdsSorted[b]));

  let multiRouteBlocks = 0;
  for (let bi = 0; bi < blockIds.length; bi++) {
    const routesInBlock = new Set(blockTripsForReport[bi].map((ti) => trips.get(tripIdsSorted[ti]).route));
    if (routesInBlock.size > 1) multiRouteBlocks++;
  }

  const artefact = {
    version: ARTEFACT_VERSION,
    feedVersion,
    builtAt: now().toISOString(),
    source: 'ZET GTFS',
    headsigns,
    patterns: {
      route: patterns.map((p) => p.route),
      direction: patterns.map((p) => p.direction),
      shape: patterns.map((p) => p.shape),
      headsign: patterns.map((p) => p.headsign),
      stops: patterns.map((p) => p.stops),
      sched: patterns.map((p) => p.sched),
      dwell: patterns.map((p) => p.dwell),
      trips: patterns.map((p) => p.trips),
    },
    trips: tripsOut,
    // No `trips` array here (contrast the brief's illustrative sketch): a
    // block's trip ids in departure order are wholly recoverable from
    // trips.block + trips.start, so shipping them again would spend ~183 KB
    // of the real feed's gzip size restating information already on the
    // wire (see shared/motion/trips.ts's decodeTripIndex, and the Rulings
    // section of the task report).
    blocks: { id: blockIds },
    services: { id: serviceIds },
  };

  const report = {
    patterns: patterns.length,
    trips: tripIdsSorted.length,
    blocks: blockIds.length,
    multiRouteBlocks,
    tripsWithoutShapeByRoute: Object.fromEntries([...tripsWithoutShapeByRoute.entries()].sort()),
  };

  return { artefact, report };
}

export async function main({
  fetchImpl = fetch,
  url = GTFS_URL,
  zipPath = null,
  out = OUTPUT_PATH,
  log = console.log,
  cwd = process.cwd(),
  now = () => new Date(),
} = {}) {
  let buf;
  let fallbackFeedVersion = null;
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

  const { artefact, report } = await buildTripIndex(buf, { now, fallbackFeedVersion, log });

  const target = resolve(cwd, out);
  await mkdir(dirname(target), { recursive: true });
  const json = JSON.stringify(artefact) + '\n';
  await writeFile(target, json, 'utf8');
  const rawBytes = Buffer.byteLength(json, 'utf8');
  const gzipBytes = gzipSync(Buffer.from(json, 'utf8')).length;

  log(
    `${report.patterns} patterns, ${report.trips} trips, ${report.blocks} blocks ` +
      `(${report.multiRouteBlocks} multi-route), feed ${artefact.feedVersion} -> ${out} ` +
      `(${rawBytes} bytes raw, ${gzipBytes} bytes gzip)`,
  );
  const withoutShapeEntries = Object.entries(report.tripsWithoutShapeByRoute);
  if (withoutShapeEntries.length > 0) {
    log(`Trips without a shape_id, by route: ${withoutShapeEntries.map(([r, n]) => `${r}=${n}`).join(', ')}`);
  }
  log(`Attribution required wherever this file is used: ${ZET_ATTRIBUTION}`);

  return { ...report, rawBytes, gzipBytes, target, feedVersion: artefact.feedVersion, builtAt: artefact.builtAt };
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
