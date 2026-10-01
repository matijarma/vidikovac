// The data contract of /snimka/, the replay of the ZET strike of 28 to 30
// September 2026 (docs/snimka-2026-10.md section 5, binding). The offline
// pipeline (scripts/snimka/) writes these shapes, the worker route
// (worker/routes/snimka.ts) serves them unchanged, the page (app/src/snimka/)
// reads them. DOM-free; imports nothing outside shared/.
//
// Rules:
// - Every time column is a fixed-length array from `t0` by `step`. Missing is
//   `null`, never 0: zero is a count observed as zero (a frame with no vehicles
//   is a real 0).
// - All times are integer epoch seconds; coordinates are [lon, lat].
// - Every object except manifest.json is content-named
//   `<name>.<sha256 first 16 hex>.<ext>` and immutable; manifest paths are
//   relative to SNIMKA_API.
//
// The shape guards at the end are light: they check the fields the page reads
// and never reject an object for carrying a field they do not know.

export const SNIMKA_VERSION = 1;
export const SNIMKA_API = '/api/snimka/v1/';
// Sun 27 Sep 20:00 to Thu 1 Oct 08:00 Zagreb: 84 hours. (The brief's block
// printed toSec 1790748000 and 3600 minutes, which is Wed 30 Sep 08:00; its
// own text, the chapters of Thursday morning and acceptance row SN-1 at Wed
// 20:30 need Thursday, so the end is Thu 1 Oct 06:00Z.)
export const SNIMKA_WINDOW = { fromSec: 1790532000, toSec: 1790834400, minutes: 5040 } as const;
export const SNIMKA_COMPARISON = { day: '2026-09-24', fromSec: 1790200800, minutes: 1440 } as const; // Thu 24 Sep 00:00 Zagreb
export const ZAGREB_OFFSET_S = 7200; // CEST for the whole window and the comparison day
export const MOTION_STEP_S = 10, MOTION_CHUNK_S = 600, MOTION_TICKS = 60, BAJS_STEP_S = 300;
export const SPEEDS = [1, 60, 600, 3600] as const; // replay seconds per wall second
export type Speed = (typeof SPEEDS)[number];
export type SnimkaState = 'normal' | 'reduced' | 'silent' | 'unknown';
export type Col<T> = (T | null)[];

export interface HashedRef { path: string; bytes: number; sha256: string }
export interface NetworkRef extends HashedRef { feedVersion: string; graphHash: string; paths: number; shapes: number }
export interface Attribution { id: 'zet' | 'zet-rss' | 'nextbike' | 'zagreb-closures' | 'dhmz' | 'news' | 'osm' | 'kajima'; text: string; url: string | null; licence: string; adaptation: string | null }

export interface SnimkaManifest {
  version: 1; builtAt: string; title: string;
  build: { commit: string; inputs: Record<string, string> };       // input fingerprint per stage
  window: typeof SNIMKA_WINDOW & { tz: 'Europe/Zagreb'; utcOffsetMin: 120 };
  comparison: typeof SNIMKA_COMPARISON;
  serviceLiveFromSec: number;                                      // first minute with a non-null published.service
  networks: { '395': NetworkRef; '396': NetworkRef };              // frozen byte copies of zet-network.json (feeds 000395 and 000396)
  files: { series: HashedRef; comparisonSeries: HashedRef; motionIndex: HashedRef; stations: HashedRef; bajs: HashedRef;
           closures: HashedRef; events: HashedRef; notices: HashedRef; news: HashedRef; screenIndex: HashedRef; board106: HashedRef;
           grid: HashedRef | null };                               // grid is null in v1
  attribution: Attribution[];
  notes: string[];                                                 // Croatian footnotes (gaps and caveats)
}

export interface SeriesFile {
  v: 1; t0: number; step: 60; n: number;                           // 5040 for the window, 1440 for the comparison day
  seen:     { all: Col<number>; tram: Col<number>; bus: Col<number> };       // the current twin replayed over the frames: fleetSeen at the minute's last frame; null = no frame in the minute
  expected: { all: Col<number>; tram: Col<number>; bus: Col<number> };       // expectationAt per minute (merged 000396 and 000395 calendars); null only where no calendar knows the date
  service:  { state: Col<SnimkaState>; since: Col<number>; ratio: Col<number>; hold: Col<'stale' | 'below-min' | 'no-calendar' | 'gap'> };  // replayed state machine; 'gap' = no frame in the minute, state carried
  feed:     { headerAgeS: Col<number>; entities: Col<number>; rejectedFuture: Col<number>; hiddenDepot: Col<number>; hiddenParked: Col<number> };
  published: { vehicles: Col<number>; itemCount: Col<number>; status: Col<'live' | 'stale' | 'down'>; service: Col<SnimkaState> } | null;   // what production said (teaser.jsonl); null for the comparison day
  bikes:    { total: Col<number>; empty: Col<number>; reporting: Col<number> } | null;    // null for the comparison day
  closures: { active: Col<number>; version: Col<number> } | null;                       // null for the comparison day
  hourly:   { t0: number; n: number; tempC: Col<number>; weather: Col<string>; newsPulse: number[] | null };  // DHMZ Zagreb-Maksimir; newsPulse = relevant press items per hour after de-duplication (not the curated list); null for the comparison day
}

export interface MotionSegment { k: number; on: 0 | 1 | 2; idx: number; v: number[] }
// k = first tick of the segment (0..59); on 0 = metres along net.paths[idx], on 1 = metres along net.shapes[idx], on 2 = free (idx -1)
// v for on 0/1: [s0, ds1, ds2, ...] integer metres, delta-encoded; for on 2: [lon0, lat0, dlon1, dlat1, ...] in 1e-5 degrees, delta-encoded
export interface MotionVehicle { id: string; route: string | null; label: string | null; kind: 0 | 3 | null; segs: MotionSegment[] }   // kind = GTFS route_type; label = the route's short name; a new segment at every gap or geometry change
export interface MotionChunk { v: 1; net: '395' | '396'; t0: number; step: 10; n: 60; vehicles: MotionVehicle[] }
export interface MotionIndex { v: 1; step: 10; chunkSec: 600; chunks: { path: string; sha256: string; bytes: number; net: '395' | '396'; t0: number; vehicles: number }[] }  // both segments; the page finds a chunk by t0

export interface StationsFile { v: 1; stations: { id: string; name: string; lon: number; lat: number; capacity: number | null }[] }
export interface BajsFile { v: 1; t0: number; step: 300; n: number; stations: string[]; bikes: string[] }   // bikes[i] = base64 of n uint8 for stations[i]: 0..250 bikes, 254 = not renting, 255 = missing

export interface ClosuresFile { v: 1;
  versions: { fromSec: number; toSec: number | null }[];                       // one per distinct copy of the dataset
  closures: { id: number; street: string; type: string; subtype: string | null; direction: string | null; line: [number, number][]; startSec: number | null }[];
  byVersion: [closureIdx: number, endSec: number | null][][] }                // per version: which closures, with the end as published in that copy (rolling ends stay visible)

export interface SnimkaEvent { id: string; atSec: number; kind: 'zet' | 'court' | 'return' | 'service' | 'recording'; title: string; text: string | null;
  sources: { label: string; url: string }[]; derived: boolean; chapter: boolean }   // derived = computed from the replayed series; chapter = a scrubber mark
export interface EventsFile { v: 1; events: SnimkaEvent[] }
export interface NoticesFile { v: 1; items: { id: number; title: string; text: string | null; link: string; pubSec: number }[] }
export interface NewsFile { v: 1; outlets: Record<'jutarnji' | 'vecernji' | 'n1', { name: string; home: string }>;
  items: { id: string; outlet: 'jutarnji' | 'vecernji' | 'n1'; title: string; link: string; pubSec: number; beat: string | null }[] }  // titles verbatim, no description

export type SentenceFamily = 'departure-timetable' | 'departure-live' | 'first-last' | 'service' | 'outage' | 'rail' | 'bikes' | 'closure' | 'event' | 'weather' | 'solar' | 'notice' | 'other';
export interface ScreenIndex { v: 1; runs: { id: string; kind: 'slot' | 'series' | 'return' | 'adhoc'; fromSec: number; toSec: number; readings: number;
  file: HashedRef; captures: { kiosk: HashedRef | null; phone: HashedRef | null };
  summary: { sentences: Partial<Record<SentenceFamily, number>>; departureRows: number; liveRows: number } }[] }
export interface ScreenRow { id: string; kind: string; source: string | null; live: boolean; title: string; whenText: string | null; sub: string | null; caveat: boolean }
export interface ScreenReading { at: number; sentence: string; kicker: string | null; kickerText: string | null; fact: string | null; family: SentenceFamily;
  rows: number[]; pills: string | null; mapNote: string | null; fleet: { pins: number | null; service: SnimkaState | null } | null }
export interface ScreenRun { v: 1; id: string; kind: ScreenIndex['runs'][number]['kind']; place: string; fromSec: number; toSec: number; rows: ScreenRow[]; readings: ScreenReading[] }   // one reading per 20 s
export interface BoardSeries { v: 1; stop: '106_1'; name: string; samples: { at: number; status: string; next: [routeId: string, headsign: string, atSec: number][] }[] }  // every 5 min, up to three departures at or after the sample, never padded

// ---- light shape guards ---------------------------------------------------
// Each answers "does this look like the file I am about to read?" from the
// fields the page depends on. None throws; none minds an extra field. The
// strict validation (every number in range, every hash in its name) belongs
// to the codec's decoders.

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isCol = (x: unknown, n?: number): x is unknown[] => Array.isArray(x) && (n === undefined || x.length === n);

export function isHashedRef(x: unknown): x is HashedRef {
  return isRec(x) && typeof x.path === 'string' && isInt(x.bytes) && x.bytes >= 0 && typeof x.sha256 === 'string' && /^[0-9a-f]{64}$/.test(x.sha256);
}

export function isSeriesFile(x: unknown): x is SeriesFile {
  if (!isRec(x) || x.v !== 1 || !isInt(x.t0) || x.step !== 60 || !isInt(x.n) || x.n <= 0) return false;
  const n = x.n;
  const cols = (group: unknown, names: string[]): boolean => isRec(group) && names.every((name) => isCol(group[name], n));
  if (!cols(x.seen, ['all', 'tram', 'bus']) || !cols(x.expected, ['all', 'tram', 'bus'])) return false;
  if (!cols(x.service, ['state', 'since', 'ratio', 'hold'])) return false;
  if (!cols(x.feed, ['headerAgeS', 'entities', 'rejectedFuture', 'hiddenDepot', 'hiddenParked'])) return false;
  if (x.published !== null && !cols(x.published, ['vehicles', 'itemCount', 'status', 'service'])) return false;
  if (x.bikes !== null && !cols(x.bikes, ['total', 'empty', 'reporting'])) return false;
  if (x.closures !== null && !cols(x.closures, ['active', 'version'])) return false;
  const h = x.hourly;
  if (!isRec(h) || !isInt(h.t0) || !isInt(h.n) || !isCol(h.tempC, h.n) || !isCol(h.weather, h.n)) return false;
  if (h.newsPulse !== null && !isCol(h.newsPulse, h.n)) return false;
  return true;
}

export function isMotionChunk(x: unknown): x is MotionChunk {
  return isRec(x) && x.v === 1 && (x.net === '395' || x.net === '396') && isInt(x.t0) && x.step === MOTION_STEP_S && x.n === MOTION_TICKS && Array.isArray(x.vehicles);
}

export function isMotionIndex(x: unknown): x is MotionIndex {
  return isRec(x) && x.v === 1 && x.step === MOTION_STEP_S && x.chunkSec === MOTION_CHUNK_S && Array.isArray(x.chunks)
    && x.chunks.every((c) => isRec(c) && typeof c.path === 'string' && typeof c.sha256 === 'string' && isInt(c.bytes) && (c.net === '395' || c.net === '396') && isInt(c.t0) && isInt(c.vehicles));
}

export function isBajsFile(x: unknown): x is BajsFile {
  return isRec(x) && x.v === 1 && isInt(x.t0) && x.step === BAJS_STEP_S && isInt(x.n) && x.n >= 0
    && Array.isArray(x.stations) && Array.isArray(x.bikes) && x.stations.length === x.bikes.length
    && x.stations.every((s) => typeof s === 'string') && x.bikes.every((b) => typeof b === 'string');
}

export function isStationsFile(x: unknown): x is StationsFile {
  return isRec(x) && x.v === 1 && Array.isArray(x.stations)
    && x.stations.every((s) => isRec(s) && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.lon === 'number' && typeof s.lat === 'number' && (s.capacity === null || isInt(s.capacity)));
}

export function isClosuresFile(x: unknown): x is ClosuresFile {
  return isRec(x) && x.v === 1 && Array.isArray(x.versions) && Array.isArray(x.closures) && Array.isArray(x.byVersion) && x.byVersion.length === x.versions.length;
}

const EVENT_KINDS = new Set(['zet', 'court', 'return', 'service', 'recording']);
export function isSnimkaEvent(x: unknown): x is SnimkaEvent {
  return isRec(x) && typeof x.id === 'string' && isInt(x.atSec) && typeof x.kind === 'string' && EVENT_KINDS.has(x.kind)
    && typeof x.title === 'string' && (x.text === null || typeof x.text === 'string') && Array.isArray(x.sources)
    && x.sources.every((s) => isRec(s) && typeof s.label === 'string' && typeof s.url === 'string')
    && typeof x.derived === 'boolean' && typeof x.chapter === 'boolean';
}
export function isEventsFile(x: unknown): x is EventsFile {
  return isRec(x) && x.v === 1 && Array.isArray(x.events) && x.events.every(isSnimkaEvent);
}

export function isNoticesFile(x: unknown): x is NoticesFile {
  return isRec(x) && x.v === 1 && Array.isArray(x.items)
    && x.items.every((i) => isRec(i) && isInt(i.id) && typeof i.title === 'string' && (i.text === null || typeof i.text === 'string') && typeof i.link === 'string' && isInt(i.pubSec));
}

const OUTLETS = ['jutarnji', 'vecernji', 'n1'] as const;
export function isNewsFile(x: unknown): x is NewsFile {
  return isRec(x) && x.v === 1 && isRec(x.outlets) && OUTLETS.every((o) => isRec((x.outlets as Rec)[o]))
    && Array.isArray(x.items)
    && x.items.every((i) => isRec(i) && typeof i.id === 'string' && (OUTLETS as readonly string[]).includes(i.outlet as string) && typeof i.title === 'string' && typeof i.link === 'string' && isInt(i.pubSec) && (i.beat === null || typeof i.beat === 'string'));
}

export function isScreenIndex(x: unknown): x is ScreenIndex {
  return isRec(x) && x.v === 1 && Array.isArray(x.runs)
    && x.runs.every((r) => isRec(r) && typeof r.id === 'string' && typeof r.kind === 'string' && isInt(r.fromSec) && isInt(r.toSec) && isInt(r.readings)
      && isHashedRef(r.file) && isRec(r.captures) && (r.captures.kiosk === null || isHashedRef(r.captures.kiosk)) && (r.captures.phone === null || isHashedRef(r.captures.phone))
      && isRec(r.summary) && isRec(r.summary.sentences) && isInt(r.summary.departureRows) && isInt(r.summary.liveRows));
}

export function isScreenRun(x: unknown): x is ScreenRun {
  return isRec(x) && x.v === 1 && typeof x.id === 'string' && typeof x.place === 'string' && isInt(x.fromSec) && isInt(x.toSec)
    && Array.isArray(x.rows) && Array.isArray(x.readings)
    && x.readings.every((r) => isRec(r) && isInt(r.at) && typeof r.sentence === 'string' && typeof r.family === 'string' && Array.isArray(r.rows));
}

export function isBoardSeries(x: unknown): x is BoardSeries {
  return isRec(x) && x.v === 1 && x.stop === '106_1' && typeof x.name === 'string' && Array.isArray(x.samples)
    && x.samples.every((s) => isRec(s) && isInt(s.at) && typeof s.status === 'string' && Array.isArray(s.next) && s.next.length <= 3);
}
