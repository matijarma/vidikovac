#!/usr/bin/env node
// Thin-spot KPI of the October 2026 round (docs/history/upgrade-2026-10-plan/U3.md O4), ported from the
// preparation phase's prototype (review.local/upgrade/kpi/thin-spot.mjs) with its predicates
// unchanged, plus what the product does from DU3 on: events without a point placed at their
// venue, and the "open now" row from OpenStreetMap opening hours.
//
// The question: at six places, how many non-transit facts worth showing did the public
// teaser carry per 30-minute sample, by hour band, and how many distinct such facts did the
// city have a day? A fact is a teaser item that passes four predicates at a place:
//   local       inside the place's frame radius (a Point, or the nearest point of a LineString);
//               a weather item counts for every place (a dhmz-hourly step only for the place's
//               nearest station); an item without geo is not local.
//   timely      a start (`at`) inside the sample's Zagreb day or an end (`until`) inside it
//               (an end at midnight ends today), and not over at the sample time (end, else start
//               + 2 h, after the sample); a forecast only as a step (window <= 6 h) that starts
//               within 2 h and has not ended; `at` values that are a publication, update or
//               unknown date (dateBasis published / updated / unknown) are not occurrences.
//   new         a per-day occurrence (the start or end falls today: today's closure end, today's
//               event, today's cut, this hour's forecast step) or first seen <= 24 h before the
//               sample across the whole folder sequence; a first sighting counts only when the
//               folder before it (<= 2 h earlier) lacked the item (the start of the sequence and
//               the first folder after a gap are censored, never "new").
//   actionable  a place plus a time: a closure / roadworks / cut / road / open item with an end and
//               a geo (a closure's end is unknown, as in plan Appendix A U0 step 4, when it started
//               > 7 days before the sample and ends < 24 h after it: the rolled placeholder of F4); a
//               timed event (dateBasis event, precision not 'day') with a Point, not spanning
//               >= 2 calendar days (exhibitions, festivals); a forecast step with rain
//               (precip >= 0.2 mm or prob >= 60 %, the S8 rain row's trigger). Never quakes, Glasnik
//               acts, POIs, observations, warnings without a place (DHMZ CAP carries no geo),
//               undated notices (ZET RSS, kvartovske, komunalne without an end).
// Excluded before the predicates: zet-rt (vehicles; departures boards and BAJS are not teaser
// items), ckan-geo (permanent POI layers, "uvijek" rows); the pharmacy and the solar rows are
// client-side rows and never appear in the teaser. city-live.json (BAJS, air, consultations,
// river) and departures-*.json are not scored.
//
// From DU3 (a sample whose teaser carries kultura-zg, or whose run saved /data/osm-hours.json in a
// folder at or before it; neither exists before DU3, so the zero baseline is reproduced):
//   placed      an event without a Point gets the point shared/city/venues.ts resolveVenuePoint
//               gives it, from the City's culture register (app/public/data/city, source
//               `culture`), the sample's kultura-zg items and the run's osm-hours.json, before the
//               predicates run, as the wall and Sada place it (U3 S2 eventRows).
//   open        per place and sample at most one item of kind 'open': the product's row (U3 S2): the
//               band's kinds in order (06-10 pekara, kafic, ljekarna; 10-17 ljekarna, posta,
//               knjiznica, trznica, trgovina; 17-20 ljekarna, trznica, trgovina; 20-02 kafic, bar,
//               restoran, ljekarna; none 02-06), the first kind open within the radius, its nearest
//               (shared/city/osm-hours.ts openPlacesNear: open now, closing 30 min or more later, no
//               holiday), `until` its closing time, then judged by the predicates above. The wall
//               hides the row while its night-pharmacy row stands; that row is client-side and is
//               not modelled here. An open row counts at the places that show it and in their
//               union, but not in the citywide distinct facts: those measure what the city's sources
//               carry, and every open door of the city would swamp them (on 28 September the rows of
//               the six places alone were 39 distinct facts, with no U3 source live). The distinct
//               open rows of a day are reported beside it.
// Confirmed 29 September 2026 at 20:48: open facts are excluded from the citywide distinct count, which measures the round's sources.
// Confirmed 29 September 2026 at 20:48: venue/open scoring starts at the DU3 capability marker so the measured baseline remains comparable.
//
// Output: per place x band (night 00-05, early 05-09, day 09-17, evening 17-22, late 22-24,
// Zagreb local hour of the sample) the mean count of facts per sample; per Zagreb day the
// citywide distinct facts (the local predicate replaced by "inside Grad Zagreb's bounding box",
// weather counted once) and the union over the six places; a funnel by kind; the list of items
// that qualified on one audit day. Markdown on stdout, the same numbers as JSON with --json.
//
// Usage: node scripts/thin-spot.mjs <data-calendar dir> --from YYYY-MM-DD [--to YYYY-MM-DD | --hours N]
//                           [--json out.json] [--audit-day YYYY-MM-DD] [--face-value-ends]
//   --from/--to are Zagreb dates, inclusive; --hours N scores N hours from --from's midnight
//   (overrides --to). --audit-day defaults to the first day in the window with >= 40 samples.
//   --face-value-ends is a sensitivity run that trusts rolled closure ends (the wall before U0);
//   it is never the KPI.
//   Summary keys for the U3-8 and U3-9 checks: summary.dayMedian, summary.eveningMedian,
//   summary.minDay, summary.minEvening, summary.cityPerDayMedian (full days), summary.cityPerDay.
//
// Radius: shared/city/frame.ts frameRadiusM(place, stops, 6) measured along the tram lines of
// app/public/data/zet-network.json with app/public/data/stops.json, computed by the preparation
// phase's review.local/upgrade/kpi/radius.ts (bundled with esbuild, the real function; it throws
// when its printed derivation disagrees with it) on feed 000395. Recomputed on feed 000396 (207
// tram lines, built 2026-09-28) for the port: the six radii are unchanged. Recompute them when the
// network artefact changes feed.
//
// shared/city/{venues,osm-hours}.ts are TypeScript with extensionless imports, which plain node
// cannot resolve; esbuild (already a dependency, as for scripts/replay-twin.mjs) bundles them into
// one throwaway module.
import { build } from 'esbuild';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const PLACES = [
  { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, radiusM: 2182,
    derivation: 'Kadar 4: median 1539 m of 9 distinct 4th stops (Sheraton 719, Branim. tržnica 1364, Kvaternikov trg 1459, Tehnički muzej 1497, Studentski centar 1539, Tuškanova 1583, Talovčeva 1603, Gupčeva zvijezda 1699, Slovenska 1919); Kadar 6: median 2182 m of 10 distinct 6th stops (Draškovićeva 487, Šubićeva 1305, Vrbik 1642, Držićeva 2003, Šulekova 2116, Učit. fakultet 2249, Trešnjevački trg 2264, Jordanovac 2453, Jandrićeva 2625, Sveti Duh 2775); radius = max(1539, 2182) clamped to [500, 3000] = 2182 m; platforms 106_1 106_2' },
  { id: '236_1', name: 'Kvaternikov trg', lon: 15.99592, lat: 45.81457, radiusM: 1705,
    derivation: 'Kadar 4: median 1243 m of 6 distinct 4th stops (Branim. tržnica 1001, Traumatologija 1082, Autobusni kol. 1215, Sheraton 1270, Trg bana J. Jelačića 1512, Hondlova 2200); Kadar 6: median 1705 m of 11 distinct 6th stops (Branim. tržnica 986, Sheraton 1179, Olipska 1504, Zrinjevac 1525, Strojarska 1608, Glavni kolodvor 1705, Držićeva-petlja 1980, Trg Rep. Hrvatske 2244, Britanski trg 2429, Mandlova 3250, Dubrava 3396); radius = max(1243, 1705) clamped to [500, 3000] = 1705 m; platforms 1043_43 1043_64 236_1 236_10 236_13 236_14 236_2' },
  { id: '98_1', name: 'Črnomerec', lon: 15.93493, lat: 45.815, radiusM: 2447,
    derivation: 'Kadar 4: median 1709 m of 1 distinct 4th stops (Trg dr. F. Tuđmana 1709); Kadar 6: median 2447 m of 2 distinct 6th stops (HNK 2 - Adžijina 2214, Frankopanska 2679); radius = max(1709, 2447) clamped to [500, 3000] = 2447 m; platforms 98_1 98_11 98_2 99_32 99_36 99_42 99_82' },
  { id: '208_24', name: 'Dubrava', lon: 16.03708, lat: 45.82448, radiusM: 2896,
    derivation: 'Kadar 4: median 2022 m of 2 distinct 4th stops (Dankovečka 1632, Jordanovac 2411); Kadar 6: median 2896 m of 2 distinct 6th stops (Aleja javora 2568, Kvaternikov trg 3224); radius = max(2022, 2896) clamped to [500, 3000] = 2896 m; platforms 208_21 208_24 208_34 208_44 208_54 209_1 209_12 209_13 209_14 209_2 209_7' },
  { id: '109_1', name: 'Glavni kolodvor', lon: 15.97928, lat: 45.80521, radiusM: 1904,
    derivation: 'Kadar 4: median 1390 m of 8 distinct 4th stops (Trg Rep. Hrvatske 922, Draškovićeva 962, Šubićeva 1296, Britanski trg 1384, Držićeva 1395, Zagrepčanka 1406, Badalićeva 1563, Jagićeva 1740); Kadar 6: median 1904 m of 13 distinct 6th stops (Sveučilišna al. 870, Studentski centar 1209, Tehnički muzej 1238, Petrova 1359, Kvaternikov trg 1722, Heinzelova-sjever 1869, Belostenčeva 1904, Radnička 1954, Vjesnik 2105, Slovenska 2226, Mašićeva 2266, Folnegovićevo 2288, Nehajska 2612); radius = max(1390, 1904) clamped to [500, 3000] = 1904 m; platforms 109_1 109_2' },
  { id: '245_1', name: 'Ljubljanica', lon: 15.93857, lat: 45.79723, radiusM: 2069,
    derivation: 'Kadar 4: median 1683 m of 1 distinct 4th stops (Badalićeva 1683); Kadar 6: median 2069 m of 3 distinct 6th stops (Zagrepčanka 1925, Studentski centar 2069, Vodnikova 2417); radius = max(1683, 2069) clamped to [500, 3000] = 2069 m; platforms 245_1 245_12 245_2' },
];
const RADIUS_SOURCE = 'frameRadiusM(place, stops, 6), zet-network.json feed 000395 (227 tram lines) and feed 000396 (207 tram lines, the same radii), stops.json';

const BANDS = [
  { id: 'night', label: 'night 00-05', from: 0, to: 5 },
  { id: 'early', label: 'early 05-09', from: 5, to: 9 },
  { id: 'day', label: 'day 09-17', from: 9, to: 17 },
  { id: 'evening', label: 'evening 17-22', from: 17, to: 22 },
  { id: 'late', label: 'late 22-24', from: 22, to: 24 },
];
/** Grad Zagreb's extent, generous: [west, south, east, north]. The citywide "local". */
const CITY_BBOX = [15.75, 45.6, 16.25, 45.98];
const HOUR = 3_600_000;
const EXCLUDED_MODULES = new Map([['zet-rt', 'transit (vehicles)'], ['ckan-geo', 'permanent POI layer']]);
const WEATHER_KINDS = new Set(['observation', 'forecast', 'warning']);
const FULL_DAY_SAMPLES = 40;
/** U0 step 4's CLOSURE_ROLLING_AGE_D: the product's own rule for a rolled closure end, applied here so the KPI counts what the wall may say. */
const CLOSURE_ROLLING_AGE_D = 7;

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const out = { dir: null, from: null, to: null, hours: null, json: null, auditDay: null, faceValueEnds: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') out.from = argv[++i];
    else if (a === '--to') out.to = argv[++i];
    else if (a === '--hours') out.hours = Number(argv[++i]);
    else if (a === '--json') out.json = argv[++i];
    else if (a === '--audit-day') out.auditDay = argv[++i];
    else if (a === '--face-value-ends') out.faceValueEnds = true;
    else if (!a.startsWith('--') && !out.dir) out.dir = a;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.dir) throw new Error('usage: node scripts/thin-spot.mjs <data-calendar dir> --from YYYY-MM-DD [--to YYYY-MM-DD | --hours N] [--json out.json] [--audit-day YYYY-MM-DD]');
  for (const k of ['from', 'to', 'auditDay']) if (out[k] && !/^\d{4}-\d{2}-\d{2}$/.test(out[k])) throw new Error(`--${k}: expected YYYY-MM-DD`);
  if (out.hours !== null && !(out.hours > 0)) throw new Error('--hours: expected a positive number');
  return out;
}

// ---------------------------------------------------------------- Zagreb time
const ZG = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function zg(ms) {
  const p = Object.fromEntries(ZG.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, minute: +p.minute, offsetMs: wall - Math.floor(ms / 1000) * 1000 };
}
function dayStartMs(date) {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d);
  let s = wall - zg(wall).offsetMs;
  s = wall - zg(s).offsetMs;
  return s;
}
function nextDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
function hhmm(ms) { const z = zg(ms); return `${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}`; }
function parseMs(s) { if (!s) return null; const v = Date.parse(s); return Number.isFinite(v) ? v : null; }

// ---------------------------------------------------------------- geometry
function haversineM(a, b) { // shared/city/geo.ts distanceM
  const rad = Math.PI / 180;
  const y = (b.lat - a.lat) * rad, x = (b.lon - a.lon) * rad;
  const h = Math.sin(y / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(x / 2) ** 2;
  return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function coordsOf(geo) {
  if (!geo || !Array.isArray(geo.coordinates)) return [];
  const flat = [];
  const walk = (c) => { if (typeof c[0] === 'number') flat.push(c); else for (const x of c) walk(x); };
  walk(geo.coordinates);
  return flat.filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
}
/** Metres from a place to a geo: a Point's air distance, a line's nearest point (local plane around the place). */
function geoDistanceM(geo, place) {
  const pts = coordsOf(geo);
  if (pts.length === 0) return Infinity;
  if (geo.type === 'Point' || pts.length === 1) return haversineM(place, { lon: pts[0][0], lat: pts[0][1] });
  const k = 6_371_000 * Math.PI / 180, kx = k * Math.cos(place.lat * Math.PI / 180);
  const xy = pts.map(([lon, lat]) => [(lon - place.lon) * kx, (lat - place.lat) * k]);
  let best = Infinity;
  const segs = geo.type === 'LineString' || geo.type === 'MultiLineString' || geo.type === 'Polygon' || geo.type === 'MultiPolygon';
  for (let i = 0; i < xy.length; i++) {
    best = Math.min(best, Math.hypot(xy[i][0], xy[i][1]));
    if (!segs || i === 0) continue;
    const [ax, ay] = xy[i - 1], [bx, by] = xy[i];
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    if (len === 0) continue;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
function inCity(geo) {
  const [w, s, e, n] = CITY_BBOX;
  return coordsOf(geo).some(([lon, lat]) => lon >= w && lon <= e && lat >= s && lat <= n);
}

// ---------------------------------------------------------------- predicates
const UNDATED_BASES = new Set(['published', 'updated', 'unknown']);
function isStep(atMs, untilMs) { return atMs !== null && untilMs !== null && untilMs - atMs <= 6 * HOUR; }
function spanDays(atMs, untilMs) {
  if (atMs === null || untilMs === null) return 0;
  return Math.round((dayStartMs(zg(untilMs).date) - dayStartMs(zg(atMs).date)) / (24 * HOUR));
}
function rainy(d) { return (Number(d?.precip) >= 0.2) || (Number(d?.prob) >= 60); }

/** Everything about an item that does not depend on the place: timely, new, actionable, and why not. */
function judge(item, t, ds, de, first, faceValueEnds) {
  const atMs = parseMs(item.at);
  const d = item.data || {};
  const kind = item.kind;
  // Plan Appendix A U0 step 4 (F4): a closure older than 7 days whose end is < 24 h ahead carries a
  // rolled placeholder end (19 of 39 move +1 day every night); its end is unknown, never a fact.
  const rawUntil = parseMs(item.until);
  const rolled = !faceValueEnds && kind === 'closure' && atMs !== null && rawUntil !== null && t - atMs > CLOSURE_ROLLING_AGE_D * 24 * HOUR && rawUntil - t < 24 * HOUR;
  const untilMs = rolled ? null : rawUntil;
  const perDay = (atMs !== null && atMs >= ds && atMs < de) || (untilMs !== null && untilMs > ds && untilMs <= de);
  let timely, over = false;
  if (kind === 'forecast') timely = isStep(atMs, untilMs) && atMs <= t + 2 * HOUR && untilMs > t;
  else if (UNDATED_BASES.has(item.dateBasis)) timely = false;
  else { over = perDay && !((untilMs ?? (atMs !== null ? atMs + 2 * HOUR : -Infinity)) > t); timely = perDay && !over; }
  const recent = !!(first && first.observed && t - first.ms <= 24 * HOUR);
  const isNew = perDay || recent;
  let actionable = false, why = '';
  const hasGeo = coordsOf(item.geo).length > 0;
  switch (kind) {
    case 'closure': case 'cut': case 'road': case 'open':
      actionable = untilMs !== null && hasGeo; why = actionable ? '' : (rolled ? 'rolled end (U0 rule)' : 'no end or no geo'); break;
    case 'event':
      if (d.source === 'komunalne') { actionable = untilMs !== null && hasGeo; why = actionable ? '' : 'works without an end'; }
      else if (item.dateBasis !== 'event') why = 'undated notice';
      else if (d.precision === 'day') why = 'no time of day';
      else if (spanDays(atMs, untilMs) >= 2) why = 'spans >= 2 days';
      else if (!(item.geo && item.geo.type === 'Point')) why = 'no point';
      else actionable = true;
      break;
    case 'forecast':
      actionable = isStep(atMs, untilMs) && rainy(d); why = actionable ? '' : (isStep(atMs, untilMs) ? 'no rain' : 'day forecast, not a step'); break;
    case 'warning':
      actionable = hasGeo && untilMs !== null; why = actionable ? '' : 'warning without a place'; break;
    default:
      why = `never (${kind})`;
  }
  return { timely, over, isNew, actionable, why, atMs, untilMs, rolled };
}

/** Local at a place: weather everywhere (a dhmz-hourly step only at its nearest station), otherwise geo inside the radius. */
function isLocal(item, place, stationOf) {
  if (WEATHER_KINDS.has(item.kind)) {
    const st = item.data?.station;
    if (item.module === 'dhmz-hourly' && st && stationOf.size > 1) return stationOf.get(place.id) === st;
    return true;
  }
  return geoDistanceM(item.geo, place) <= place.radiusM;
}
/** DHMZ stations the dhmz-hourly module will read (S4), for items that carry a station name but no geo. */
const STATION_POINTS = [[/gric/, { lon: 15.9719, lat: 45.8144 }], [/maksimir/, { lon: 16.034, lat: 45.822 }]];
function stationPoint(name) {
  const n = String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return STATION_POINTS.find(([re]) => re.test(n))?.[1] ?? null;
}
function nearestStations(items) {
  const stations = new Map();
  for (const i of items) {
    if (i.module !== 'dhmz-hourly' || !i.data?.station || stations.has(i.data.station)) continue;
    const c = coordsOf(i.geo)[0];
    const pt = c ? { lon: c[0], lat: c[1] } : stationPoint(i.data.station);
    if (pt) stations.set(i.data.station, pt);
  }
  const out = new Map();
  for (const p of PLACES) {
    let best = null, bd = Infinity;
    for (const [st, pt] of stations) { const dd = haversineM(p, pt); if (dd < bd) { bd = dd; best = st; } }
    if (best) out.set(p.id, best);
  }
  return out;
}

function fkind(item) {
  if (item.kind === 'event') return `event:${item.data?.source ?? '?'}`;
  return `${item.kind}:${item.module}`;
}


/** Bundles shared/city/{venues,osm-hours}.ts and imports them, once a process. */
let sharedModule = null;
async function loadShared() {
  if (sharedModule) return sharedModule;
  const tmpDir = await mkdtemp(join(tmpdir(), 'thin-spot-'));
  const outfile = join(tmpDir, 'shared.mjs');
  try {
    await build({
      stdin: {
        contents: "export { decodeOsmHours, openPlacesNear, osmVenues } from './shared/city/osm-hours';\nexport { buildGazetteer, resolveVenuePoint } from './shared/city/venues';\n",
        resolveDir: repoRoot,
        loader: 'ts',
      },
      outfile, bundle: true, platform: 'node', format: 'esm', target: 'node18', logLevel: 'silent',
    });
    sharedModule = await import(pathToFileURL(outfile).href);
    return sharedModule;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/** The City's culture register as the catalogue ships it (the gazetteer's first source). */
function culturePlaces() {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'app/public/data/city/manifest.json'), 'utf8'));
  return manifest.sources.filter((s) => s.id === 'culture')
    .flatMap((s) => s.chunks.flatMap((c) => JSON.parse(readFileSync(join(repoRoot, 'app/public/data/city/chunks', `${c.hash}.json`), 'utf8')).data?.places ?? []));
}

/** U3 S2: the kinds the open row offers per Zagreb hour, in order. */
function openKindsAt(hour) {
  if (hour >= 6 && hour < 10) return ['pekara', 'kafic', 'ljekarna'];
  if (hour >= 10 && hour < 17) return ['ljekarna', 'posta', 'knjiznica', 'trznica', 'trgovina'];
  if (hour >= 17 && hour < 20) return ['ljekarna', 'trznica', 'trgovina'];
  if (hour >= 20 || hour < 2) return ['kafic', 'bar', 'restoran', 'ljekarna'];
  return [];
}
/** The product's one open row at a place: the band's first kind present, its nearest (openPlacesNear sorts by distance). */
function openRow(open, hour) {
  for (const kind of openKindsAt(hour)) { const hit = open.find((p) => p.kind === kind); if (hit) return hit; }
  return null;
}

// ---------------------------------------------------------------- main
export async function main({ argv = process.argv.slice(2), log = console.log } = {}) {
  const args = parseArgs(argv);
  /** --face-value-ends: a sensitivity run that trusts rolled closure ends, as the wall does before U0 (F4). Never the KPI. */
  const FACE_VALUE_ENDS = args.faceValueEnds;
  const folders = readdirSync(args.dir).filter((f) => /^\d{8}T\d{6}Z$/.test(f)).sort();
  if (folders.length === 0) throw new Error(`${args.dir}: no sample folders`);
  const folderMs = (f) => Date.UTC(+f.slice(0, 4), +f.slice(4, 6) - 1, +f.slice(6, 8), +f.slice(9, 11), +f.slice(11, 13), +f.slice(13, 15));
  const lastDay = zg(folderMs(folders.at(-1))).date;
  const from = args.from ?? zg(folderMs(folders[0])).date;
  const winStart = dayStartMs(from);
  const winEnd = args.hours ? winStart + args.hours * HOUR : dayStartMs(nextDate(args.to ?? lastDay));

  const shared = await loadShared();
  const places = culturePlaces();
  let osmIndex = null, osmFolder = null; // the run's osm-hours.json: the latest decodable one at or before the sample
  let gazetteerKey = null, gazetteer = null;
  const placedKeys = new Set();

  const firstSeen = new Map(); // key -> { ms, observed }
  let prevKeys = null, prevMs = null;
  const samples = []; // { ms, date, band, counts: {placeId: n} }
  const cityDays = new Map(); // date -> { samples, city:Set, union:Set }
  const funnel = new Map(); // fkind -> { local, localActionable, localActionableTimely, fact } summed over sample x place
  const facts = new Map(); // key -> audit record
  const localAudit = new Map(); // date -> Map(key -> predicate tallies) for every item local at one of the six places
  let scanned = 0, overDropped = 0;
  const closureUntils = new Map(); // closure key -> Set of until values seen across the whole sequence
  const ruleFlags = []; // [key, flagged] per closure item-sample in the window

  for (const f of folders) {
    const ms = folderMs(f);
    const path = join(args.dir, f, 'teaser.json');
    const osmPath = join(args.dir, f, 'osm-hours.json');
    if (existsSync(osmPath)) {
      let decoded = null;
      try { decoded = shared.decodeOsmHours(JSON.parse(readFileSync(osmPath, 'utf8'))); } catch { decoded = null; }
      if (decoded) { osmIndex = decoded; osmFolder = f; }
    }
    if (!existsSync(path)) continue;
    let teaser;
    try { teaser = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
    scanned++;
    const items = [];
    for (const m of teaser.modules ?? []) for (const it of m.items ?? []) items.push({ ...it, module: it.module ?? m.module });
    const keys = new Set();
    const observedGap = prevMs !== null && ms - prevMs <= 2 * HOUR;
    for (const it of items) {
      const key = `${it.module}:${it.id}`;
      keys.add(key);
      if (!firstSeen.has(key)) firstSeen.set(key, { ms, observed: observedGap && prevKeys !== null && !prevKeys.has(key) });
      if (it.kind === 'closure') { const u = closureUntils.get(key) ?? new Set(); u.add(it.until ?? ''); closureUntils.set(key, u); }
    }
    prevKeys = keys; prevMs = ms;
    if (ms < winStart || ms >= winEnd) continue;

    // From DU3: place events without a point, as the wall and Sada do.
    const placedNow = new Set();
    const kulturaModule = (teaser.modules ?? []).find((m) => m.module === 'kultura-zg');
    if (kulturaModule || osmIndex) {
      const key = `${kulturaModule?.fetchedAt ?? ''}|${osmFolder ?? ''}`;
      if (key !== gazetteerKey) {
        gazetteerKey = key;
        gazetteer = shared.buildGazetteer({ places, kultura: items.filter((it) => it.module === 'kultura-zg'), osm: shared.osmVenues(osmIndex) });
      }
      for (const it of items) {
        if (it.kind !== 'event' || it.geo?.type === 'Point') continue;
        const point = shared.resolveVenuePoint(it, gazetteer);
        if (!point) continue;
        it.geo = { type: 'Point', coordinates: [point.lon, point.lat] };
        placedNow.add(`${it.module}:${it.id}`);
      }
    }

    const z = zg(ms);
    const ds = dayStartMs(z.date), de = dayStartMs(nextDate(z.date));
    const band = BANDS.find((b) => z.hour >= b.from && z.hour < b.to).id;
    const stationOf = nearestStations(items);
    const counts = Object.fromEntries(PLACES.map((p) => [p.id, 0]));
    const day = cityDays.get(z.date) ?? { samples: 0, city: new Set(), union: new Set(), placeless: new Set(), placed: new Set(), openRows: new Set() };
    day.samples++;
    cityDays.set(z.date, day);
    // The open row per place, as an item of its own (at most one per place and sample).
    const openAt = new Map(); // placeId -> item
    if (osmIndex) {
      for (const p of PLACES) {
        const row = openRow(shared.openPlacesNear(osmIndex, p, p.radiusM, ms, false), z.hour);
        if (row) openAt.set(p.id, { module: 'osm-hours', id: `opennow:${row.id}`, kind: 'open', title: row.name, until: new Date(row.closesAt).toISOString(), geo: { type: 'Point', coordinates: [row.lon, row.lat] }, data: { kind: row.kind } });
      }
    }
    const openItems = [...new Map([...openAt.values()].map((it) => [it.id, it])).values()];
    const seenHere = new Set();
    for (const it of [...items, ...openItems]) {
      if (EXCLUDED_MODULES.has(it.module) || it.kind === 'vehicle' || it.kind === 'rail') continue;
      const key = `${it.module}:${it.id}`;
      if (seenHere.has(key)) continue;
      seenHere.add(key);
      if (placedNow.has(key)) { day.placed.add(key); placedKeys.add(key); }
      const j = judge(it, ms, ds, de, firstSeen.get(key) ?? (it.kind === 'open' ? { ms, observed: false } : undefined), FACE_VALUE_ENDS);
      const fk = fkind(it);
      const fu = funnel.get(fk) ?? { items: 0, timely: 0, timelyActionable: 0, local: 0, localActionable: 0, localActionableTimely: 0, fact: 0, why: new Map() };
      funnel.set(fk, fu);
      fu.items++;
      if (j.timely) { fu.timely++; if (j.actionable) fu.timelyActionable++; }
      if (!j.actionable) fu.why.set(j.why, (fu.why.get(j.why) ?? 0) + 1);
      const good = j.timely && j.isNew && j.actionable;
      if (it.kind === 'closure') ruleFlags.push([key, j.rolled]);
      const cityLocal = WEATHER_KINDS.has(it.kind) || inCity(it.geo);
      if (j.over && j.actionable && cityLocal) overDropped++;
      if (it.kind === 'event' && j.timely && j.isNew && j.why === 'no point') day.placeless.add(key);
      if (good && cityLocal && it.kind !== 'open') day.city.add(key);
      if (good && it.kind === 'open') day.openRows.add(key);
      // An open item is the row of the places that chose it, never of a place that chose another.
      const localHere = (p) => (it.kind === 'open' ? openAt.get(p.id)?.id === it.id : isLocal(it, p, stationOf));
      const at = [];
      for (const p of PLACES) {
        const local = localHere(p);
        if (!local) continue;
        fu.local++;
        if (j.actionable) fu.localActionable++;
        if (j.actionable && j.timely) fu.localActionableTimely++;
        if (good) { fu.fact++; counts[p.id]++; at.push(p.id); day.union.add(key); }
      }
      const localAt = PLACES.filter(localHere).map((p) => p.id);
      if (localAt.length) {
        const dm = localAudit.get(z.date) ?? new Map();
        const la = dm.get(key) ?? { key, kind: fkind(it), title: it.title, at: it.at ?? null, until: it.until ?? null, samples: 0, timely: 0, new: 0, actionable: 0, fact: 0, why: new Set(), places: new Set() };
        la.samples++; la.timely += j.timely ? 1 : 0; la.new += j.isNew ? 1 : 0; la.actionable += j.actionable ? 1 : 0; la.fact += good ? 1 : 0;
        if (j.why) la.why.add(j.why);
        if (j.over) la.why.add('over');
        for (const pid of localAt) la.places.add(pid);
        dm.set(key, la); localAudit.set(z.date, dm);
      }
      if (good && (at.length || cityLocal)) {
        const rec = facts.get(key) ?? { key, module: it.module, kind: it.kind, source: it.data?.source, title: it.title, at: it.at, days: new Map() };
        const dr = rec.days.get(z.date) ?? { samples: 0, places: new Set(), first: ms, last: ms, until: it.until };
        dr.samples++; dr.last = ms; for (const p of at) dr.places.add(p);
        rec.days.set(z.date, dr);
        facts.set(key, rec);
      }
    }
    samples.push({ ms, date: z.date, band, counts });
  }

  // ---------------------------------------------------------------- aggregate
  const round = (x, n = 2) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n);
  const median = (v) => { const s = v.filter((x) => x !== null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const bandSamples = Object.fromEntries(BANDS.map((b) => [b.id, samples.filter((s) => s.band === b.id).length]));
  const table = {};
  for (const p of PLACES) {
    table[p.id] = {};
    for (const b of BANDS) {
      const sel = samples.filter((s) => s.band === b.id);
      table[p.id][b.id] = sel.length ? round(sel.reduce((a, s) => a + s.counts[p.id], 0) / sel.length) : null;
    }
  }
  const bandMedian = Object.fromEntries(BANDS.map((b) => [b.id, round(median(PLACES.map((p) => table[p.id][b.id])))]));
  const bandMin = Object.fromEntries(BANDS.map((b) => { const v = PLACES.map((p) => table[p.id][b.id]).filter((x) => x !== null); return [b.id, v.length ? Math.min(...v) : null]; }));
  const perDay = [...cityDays.entries()].sort().map(([date, d]) => ({ date, samples: d.samples, full: d.samples >= FULL_DAY_SAMPLES, city: d.city.size, unionSix: d.union.size, timedEventsWithoutPoint: d.placeless.size, placedByVenue: d.placed.size, openRows: d.openRows.size }));
  const fullDays = perDay.filter((d) => d.full);
  const cityPerDayMedian = median((fullDays.length ? fullDays : perDay).map((d) => d.city));
  const auditDay = args.auditDay ?? (fullDays[0] ?? perDay[0])?.date ?? null;
  const audit = [...facts.values()].filter((r) => r.days.has(auditDay)).map((r) => {
    const dr = r.days.get(auditDay);
    return { key: r.key, module: r.module, kind: r.kind, source: r.source ?? null, title: r.title, at: r.at ?? null, until: dr.until ?? null, samples: dr.samples, places: [...dr.places], firstSample: hhmm(dr.first), lastSample: hhmm(dr.last) };
  }).sort((a, b) => b.places.length - a.places.length || a.key.localeCompare(b.key));
  const auditLocal = [...(localAudit.get(auditDay)?.values() ?? [])].map((n) => ({ ...n, why: [...n.why], places: [...n.places] })).sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
  const funnelOut = [...funnel.entries()].sort((a, b) => b[1].local - a[1].local).map(([k, v]) => ({ kind: k, itemsPerSample: round(v.items / Math.max(1, samples.length), 1), timelyPerSample: round(v.timely / Math.max(1, samples.length)), timelyActionablePerSample: round(v.timelyActionable / Math.max(1, samples.length)), localPerPlaceSample: round(v.local / Math.max(1, samples.length * PLACES.length)), localActionable: round(v.localActionable / Math.max(1, samples.length * PLACES.length)), localActionableTimely: round(v.localActionableTimely / Math.max(1, samples.length * PLACES.length)), facts: round(v.fact / Math.max(1, samples.length * PLACES.length)), notActionable: Object.fromEntries([...v.why.entries()].sort((a, b) => b[1] - a[1])) }));

  const rolledKeys = new Set([...closureUntils].filter(([, u]) => u.size > 1).map(([k]) => k));
  const rolling = { closureKeysInSequence: closureUntils.size, keysWhoseEndMoved: rolledKeys.size, itemSamples: ruleFlags.length,
    flaggedAndMoved: ruleFlags.filter(([k, f]) => f && rolledKeys.has(k)).length, flaggedNeverMoved: ruleFlags.filter(([k, f]) => f && !rolledKeys.has(k)).length,
    notFlaggedButMoved: ruleFlags.filter(([k, f]) => !f && rolledKeys.has(k)).length, notFlaggedNeverMoved: ruleFlags.filter(([k, f]) => !f && !rolledKeys.has(k)).length };
  const result = {
    generatedAt: new Date().toISOString(),
    mode: FACE_VALUE_ENDS ? 'face-value-ends (sensitivity, not the KPI)' : 'kpi',
    dir: args.dir,
    window: { from, to: args.hours ? null : (args.to ?? lastDay), hours: args.hours, startUtc: new Date(winStart).toISOString(), endUtc: new Date(winEnd).toISOString() },
    foldersScanned: scanned,
    lastFolder: folders.at(-1),
    osmHours: osmFolder ? { folder: osmFolder, builtAt: osmIndex.builtAt, osmDate: osmIndex.osmDate, records: osmIndex.size } : null,
    eventsPlacedByVenue: placedKeys.size,
    samples: samples.length,
    bandSamples,
    radius: { source: RADIUS_SOURCE, places: PLACES.map(({ id, name, lon, lat, radiusM, derivation }) => ({ id, name, lon, lat, radiusM, derivation })) },
    places: table,
    summary: { dayMedian: bandMedian.day, eveningMedian: bandMedian.evening, minDay: bandMin.day, minEvening: bandMin.evening, bandMedian, bandMin, cityPerDayMedian, cityPerDay: Object.fromEntries(perDay.map((d) => [d.date, d.city])) },
    days: perDay,
    endedTodayDropped: overDropped,
    rolling,
    funnel: funnelOut,
    auditDay,
    auditItems: audit,
    auditLocal,
  };
  if (args.json) writeFileSync(args.json, JSON.stringify(result, null, 1) + '\n');

  // ---------------------------------------------------------------- markdown
  const L = [];
  const fmt = (x) => (x === null ? 'n/a' : String(x));
  L.push(`# Thin-spot KPI${FACE_VALUE_ENDS ? ' (SENSITIVITY: rolled closure ends taken at face value, as the wall did before U0; not the KPI)' : ''}: ${from} to ${result.window.to ?? `+${args.hours} h`} (Zagreb)`);
  L.push('');
  L.push(`Source: \`${args.dir}\` (read-only samples of \`/api/teaser\`, 30-minute cadence), ${scanned} folders scanned for first sightings (last ${result.lastFolder}), ${samples.length} samples in the window. Generated ${result.generatedAt} by scripts/thin-spot.mjs. Predicates: see the script header. ${result.osmHours ? `Venue placement and open rows from ${result.osmHours.folder}/osm-hours.json (OSM data of ${result.osmHours.osmDate}, ${result.osmHours.records} records); ${placedKeys.size} events placed at their venue.` : (placedKeys.size ? `Venue placement without osm-hours.json; ${placedKeys.size} events placed at their venue.` : 'No osm-hours.json and no kultura-zg in the samples: no venue placement, no open rows (the product before DU3).')}`);
  L.push('');
  L.push('## Radius per place');
  L.push('');
  L.push(`${RADIUS_SOURCE}.`);
  L.push('');
  L.push('| place | stop | radius | derivation |');
  L.push('|---|---|---:|---|');
  for (const p of PLACES) L.push(`| ${p.name} | ${p.id} | ${p.radiusM} m | ${p.derivation} |`);
  L.push('');
  L.push('## Facts per sample, place x band (mean)');
  L.push('');
  L.push(`| place | ${BANDS.map((b) => b.label).join(' | ')} |`);
  L.push(`|---|${BANDS.map(() => '---:').join('|')}|`);
  L.push(`| samples | ${BANDS.map((b) => bandSamples[b.id]).join(' | ')} |`);
  for (const p of PLACES) L.push(`| ${p.name} | ${BANDS.map((b) => fmt(table[p.id][b.id])).join(' | ')} |`);
  L.push(`| **median of six** | ${BANDS.map((b) => `**${fmt(bandMedian[b.id])}**`).join(' | ')} |`);
  L.push(`| min of six | ${BANDS.map((b) => fmt(bandMin[b.id])).join(' | ')} |`);
  L.push('');
  L.push('## Distinct facts per Zagreb day');
  L.push('');
  L.push('The last three columns are not part of the citywide count: timely, new events still without a point (after venue placement), the distinct events venue placement gave a point, and the distinct open rows the six places showed (counted at the places, not citywide).');
  L.push('');
  L.push('| day | samples | citywide distinct | union of the six places | timed events today without a point | events placed at their venue | open rows |');
  L.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const d of perDay) L.push(`| ${d.date}${d.full ? '' : ' (partial)'} | ${d.samples} | ${d.city} | ${d.unionSix} | ${d.timedEventsWithoutPoint} | ${d.placedByVenue} | ${d.openRows} |`);
  L.push('');
  L.push(`Summary: day-band median ${fmt(bandMedian.day)}, evening-band median ${fmt(bandMedian.evening)}, lowest place in the day band ${fmt(bandMin.day)} and in the evening band ${fmt(bandMin.evening)}; citywide distinct facts per full day (>= ${FULL_DAY_SAMPLES} samples), median ${fmt(cityPerDayMedian)}. Citywide item-samples dropped as over (a start or end today, already past at the sample): ${overDropped}.`);
  L.push('');
  L.push(`Rolled closure ends (U0 rule: start > ${CLOSURE_ROLLING_AGE_D} d ago, end < 24 h ahead) against the sequence: ${rolling.closureKeysInSequence} closure items seen, ${rolling.keysWhoseEndMoved} of them changed their end while keeping their id; of ${rolling.itemSamples} closure item-samples in the window the rule flagged ${rolling.flaggedAndMoved + rolling.flaggedNeverMoved} (${rolling.flaggedAndMoved} on items whose end moved, ${rolling.flaggedNeverMoved} on items whose end never moved in the sequence) and passed ${rolling.notFlaggedButMoved + rolling.notFlaggedNeverMoved} (${rolling.notFlaggedButMoved} on items whose end moved).`);
  L.push('');
  L.push('## Funnel by kind (per place and sample, means)');
  L.push('');
  L.push('Columns 3 and 4 are per sample and ignore the place; columns 5 to 8 are per place and sample.');
  L.push('');
  L.push('| kind:source | items per sample | timely (anywhere) | timely + actionable (anywhere) | local | + actionable | + timely | facts (+ new) | why not actionable (item-samples) |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const r of funnelOut) L.push(`| ${r.kind} | ${r.itemsPerSample} | ${r.timelyPerSample} | ${r.timelyActionablePerSample} | ${r.localPerPlaceSample} | ${r.localActionable} | ${r.localActionableTimely} | ${r.facts} | ${Object.entries(r.notActionable).map(([k, v]) => `${k} ${v}`).join('; ') || '-'} |`);
  L.push('');
  L.push(`## Items that qualified on ${auditDay ?? 'n/a'} (audit)`);
  L.push('');
  if (!audit.length) L.push('None.');
  else {
    L.push('| item | kind | title | at | until | samples | places | first-last sample |');
    L.push('|---|---|---|---|---|---:|---|---|');
    for (const a of audit) L.push(`| \`${a.key}\` | ${a.kind}${a.source ? `:${a.source}` : ''} | ${String(a.title ?? '').replace(/\|/g, '/')} | ${a.at ?? ''} | ${a.until ?? ''} | ${a.samples} | ${a.places.join(' ') || '(city only)'} | ${a.firstSample}-${a.lastSample} |`);
  }
  L.push('');
  L.push(`## Every item local at one of the six places on ${auditDay ?? 'n/a'} (predicate audit)`);
  L.push('');
  L.push('Counts are samples of that day in which the item was in the teaser and local; T, N, A = samples in which it was timely, new, actionable; F = samples in which it was a fact.');
  L.push('');
  if (!auditLocal.length) L.push('None.');
  else {
    L.push('| item | kind | title | at | until (first that day) | samples | T | N | A | F | why not | places |');
    L.push('|---|---|---|---|---|---:|---:|---:|---:|---:|---|---|');
    for (const n of auditLocal) L.push(`| \`${n.key}\` | ${n.kind} | ${String(n.title ?? '').replace(/\|/g, '/')} | ${n.at ?? ''} | ${n.until ?? ''} | ${n.samples} | ${n.timely} | ${n.new} | ${n.actionable} | ${n.fact} | ${n.why.join('; ')} | ${n.places.join(' ')} |`);
  }
  log(L.join('\n'));
  return result;
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
