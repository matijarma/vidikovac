// The data contract of /snimka/, the replay of the ZET strike of 28 to 30
// September 2026 and the normal days after it (docs/snimka-2026-10.md
// section 5 and section 14, binding; dataset v2 of 2 October 2026). The
// offline pipeline (scripts/snimka/) writes these shapes, the worker route
// (worker/routes/snimka.ts) serves them unchanged, the page (app/src/snimka/)
// reads them. DOM-free; imports nothing outside shared/.
//
// Rules:
// - Every time column is a fixed-length array from `t0` by `step`. Missing is
//   `null` (or 255 in a byte column), never 0: zero is a count observed as
//   zero (a frame with no vehicles is a real 0).
// - All times are integer epoch seconds; coordinates are [lon, lat].
// - Every object except manifest.json is content-named
//   `<name>.<sha256 first 16 hex>.<ext>` and immutable; manifest paths are
//   relative to SNIMKA_API.
//
// The shape guards at the end are light: they check the fields the page reads
// and never reject an object for carrying a field they do not know.

export const SNIMKA_VERSION = 2;
export const SNIMKA_API = '/api/snimka/v2/';
/** Sun 27 Sep 20:00 to Fri 2 Oct 12:00 Zagreb: 112 hours (decision S-12). */
export const SNIMKA_WINDOW = { fromSec: 1790532000, toSec: 1790935200, minutes: 6720 } as const;
export interface Comparison { id: string; day: string; weekday: 1 | 4; fromSec: number; minutes: 1440; net: '395' }
/** The two normal days: Thu 24 Sep (Tue to Fri of the window) and Mon 21 Sep (the first strike day's weekday twin). */
export const SNIMKA_COMPARISONS = [
  { id: 'cet-0924', day: '2026-09-24', weekday: 4, fromSec: 1790200800, minutes: 1440, net: '395' },
  { id: 'pon-0921', day: '2026-09-21', weekday: 1, fromSec: 1789941600, minutes: 1440, net: '395' },
] as const satisfies readonly Comparison[];
/** @deprecated v1 name of the first comparison day; v2 readers take `SNIMKA_COMPARISONS` and `comparisonFor()` in app/src/snimka/context.ts. */
export const SNIMKA_COMPARISON = SNIMKA_COMPARISONS[0];
export const ZAGREB_OFFSET_S = 7200; // CEST for the whole window and both comparison days
export const MOTION_STEP_S = 10, MOTION_CHUNK_S = 600, MOTION_TICKS = 60, BAJS_STEP_S = 300, ROUTES_STEP_S = 300;
/** ZET's header this old is a feed that has stopped changing: one rule for the series, the stage, the strip and the cards (S-19). */
export const FROZEN_AFTER_S = 180;
/** The stop whose board the companion's voice reads: Trg bana J. Jelačića. */
export const VOICE_PLACE = '106_1';
export const SPEEDS = [1, 60, 600, 3600] as const; // replay seconds per wall second
export type Speed = (typeof SPEEDS)[number];
export type SnimkaState = 'normal' | 'reduced' | 'silent' | 'unknown';
export type Col<T> = (T | null)[];

export interface HashedRef { path: string; bytes: number; sha256: string }
export interface NetworkRef extends HashedRef { feedVersion: string; graphHash: string; paths: number; shapes: number }
export interface Attribution { id: 'zet' | 'zet-rss' | 'nextbike' | 'zagreb-closures' | 'dhmz' | 'news' | 'osm' | 'kajima'; text: string; url: string | null; licence: string; adaptation: string | null }

// ---- focus, mentions, facts (what an item points the instrument at) ----------

export type Focus =
  | { kind: 'city' }
  | { kind: 'place'; id: string; name?: string; lonLat?: [number, number]; zoom?: number }   // resolved from places.json at build
  | { kind: 'route'; id: string }
  | { kind: 'station'; id: string }     // BAJS station id (StationsFile)
  | { kind: 'stop'; id: string }        // network stop id (Glavni kolodvor 109_1)
  | { kind: 'layer'; layer: 'bikes' | 'closures' | 'live' }
  | { kind: 'none' };
export interface Mentions { routes?: string[]; stations?: string[]; places?: string[]; tags?: string[] }
export type FactKey = 'seen' | 'expected' | 'state' | 'bikes' | 'bikesEmpty' | 'closures' | 'temp' | 'feed' | `route:${string}` | `station:${string}`;

export interface SnimkaEvent { id: string; atSec: number; kind: 'zet' | 'court' | 'return' | 'service' | 'recording'; title: string; text: string | null;
  sources: { label: string; url: string }[]; derived: boolean; chapter: boolean;   // derived = computed from the replayed series; chapter = a scrubber mark
  focus: Focus; facts: FactKey[]; mentions: Mentions; dwellS?: number; spot?: 'stanje' | 'vozila' | 'linije' | 'mreza' | 'bicikli' | 'vrijeme' | 'zaslon' }
export interface EventsFile { v: 1; events: SnimkaEvent[] }
export interface NewsFile { v: 2; outlets: Record<'jutarnji' | 'vecernji' | 'n1', { name: string; home: string }>;
  items: { id: string; outlet: 'jutarnji' | 'vecernji' | 'n1'; title: string; link: string; pubSec: number; beat: string | null; focus: Focus; facts: FactKey[]; mentions: Mentions }[] }  // titles verbatim, no description
export interface NoticesFile { v: 2; items: { id: number; title: string; text: string | null; link: string; pubSec: number; focus: Focus; facts: FactKey[]; mentions: Mentions }[] }
export interface PlacesFile { v: 2; places: { id: string; name: string; lonLat: [number, number]; zoom: number; from: 'stop' | 'depot'; ref: string }[] }

// ---- the series --------------------------------------------------------------

export interface SeriesFile {
  v: 2; t0: number; step: 60; n: number;                           // 6720 for the window, 1440 for a comparison day
  seen: { all: Col<number>; tram: Col<number>; bus: Col<number> };           // the current twin replayed over the frames: fleetSeen at the minute's last frame; null = no frame in the minute
  expected: { all: Col<number>; tram: Col<number>; bus: Col<number> };       // expectationAt per minute (merged 000396 and 000395 calendars); null only where no calendar knows the date
  service: { state: Col<SnimkaState>; since: Col<number>; ratio: Col<number>; hold: Col<'below-min' | 'no-calendar' | 'gap'> };  // replayed state machine; 'gap' = no frame in the minute, state carried
  feed: { headerAgeS: Col<number>; entities: Col<number>; rejectedFuture: Col<number>; hiddenDepot: Col<number>; hiddenParked: Col<number>;
          frozen: Col<0 | 1>; alerts: Col<number>; cancelledTrips: Col<number> };   // frozen = headerAgeS over FROZEN_AFTER_S; alerts and cancelledTrips from ZET's own feed, null where the feed carries none
  published: { vehicles: Col<number>; itemCount: Col<number>; status: Col<'live' | 'stale' | 'down'>; service: Col<SnimkaState> } | null;   // what production said (teaser.jsonl); null for a comparison day
  bikes: { total: Col<number>; empty: Col<number>; reporting: Col<number> } | null;    // null for a comparison day
  closures: { active: Col<number>; version: Col<number> } | null;                       // null for a comparison day
  hourly: { t0: number; n: number; tempC: Col<number>; weather: Col<string>; newsPulse: number[] | null };  // DHMZ Zagreb-Maksimir; newsPulse = relevant press items per hour after de-duplication (not the curated list); null for a comparison day
}
/** Route-major; seen[i]/expected[i] are base64 uint8 columns of routes[i], n slots of ROUTES_STEP_S from t0; 255 = missing
 *  (seen: no frame in the slot; expected: no calendar). seen = distinct published vehicles of the route with a position at any tick of the slot. */
export interface RoutesFile { v: 2; t0: number; step: 300; n: number; net: '395' | '396+395'; routes: { id: string; shortName: string; type: 0 | 3 }[]; seen: string[]; expected: string[] }

// ---- motion ------------------------------------------------------------------

export interface MotionSegment { k: number; on: 0 | 1 | 2; idx: number; v: number[] }
// k = first tick of the segment (0..59); on 0 = metres along net.paths[idx], on 1 = metres along net.shapes[idx], on 2 = free (idx -1)
// v for on 0/1: [s0, ds1, ds2, ...] integer metres, delta-encoded; for on 2: [lon0, lat0, dlon1, dlat1, ...] in 1e-5 degrees, delta-encoded
export interface MotionVehicle { id: string; route: string | null; label: string | null; kind: 0 | 3 | null; segs: MotionSegment[] }   // kind = GTFS route_type; label = the route's short name; a new segment at every gap or geometry change
export interface MotionChunk { v: 1; net: '395' | '396'; t0: number; step: 10; n: 60; vehicles: MotionVehicle[] }   // the chunk format is unchanged in v2
/** Slim in v2: a chunk's name carries its hash, so the index repeats no sha256. The page finds a chunk by net and t0. */
export interface MotionIndex { v: 2; step: 10; chunkSec: 600; chunks: { path: string; bytes: number; net: '395' | '396'; t0: number; vehicles: number }[] }

// ---- bikes, closures ------------------------------------------------------------

export interface StationsFile { v: 1; stations: { id: string; name: string; lon: number; lat: number; capacity: number | null }[] }
export interface BajsFile { v: 1; t0: number; step: 300; n: number; stations: string[]; bikes: string[] }   // bikes[i] = base64 of n uint8 for stations[i]: 0..250 bikes, 254 = not renting, 255 = missing

export interface ClosuresFile { v: 1;
  versions: { fromSec: number; toSec: number | null }[];                       // one per distinct copy of the dataset
  closures: { id: number; street: string; type: string; subtype: string | null; direction: string | null; line: [number, number][]; startSec: number | null }[];
  byVersion: [closureIdx: number, endSec: number | null][][] }                // per version: which closures, with the end as published in that copy (rolling ends stay visible)

// ---- the screen, the boards, the voice ---------------------------------------------

export type SentenceFamily = 'departure-timetable' | 'departure-live' | 'first-last' | 'service' | 'outage' | 'rail' | 'bikes' | 'closure' | 'event' | 'weather' | 'solar' | 'notice' | 'other';
export interface ScreenIndex { v: 1; runs: { id: string; kind: 'slot' | 'series' | 'return' | 'adhoc'; fromSec: number; toSec: number; readings: number;
  file: HashedRef; captures: { kiosk: HashedRef | null; phone: HashedRef | null };
  summary: { sentences: Partial<Record<SentenceFamily, number>>; departureRows: number; liveRows: number } }[] }
export interface ScreenRow { id: string; kind: string; source: string | null; live: boolean; title: string; whenText: string | null; sub: string | null; caveat: boolean }
export interface ScreenReading { at: number; sentence: string; kicker: string | null; kickerText: string | null; fact: string | null; family: SentenceFamily;
  rows: number[]; pills: string | null; mapNote: string | null; fleet: { pins: number | null; service: SnimkaState | null } | null }
export interface ScreenRun { v: 1; id: string; kind: ScreenIndex['runs'][number]['kind']; place: string; fromSec: number; toSec: number; rows: ScreenRow[]; readings: ScreenReading[] }   // one reading per 20 s
/** Every 5 min, up to three departures at or after the sample, never padded; one file per stop, `place` = a places.json id or null. */
export interface BoardSeries { v: 2; stop: string; name: string; place: string | null; samples: { at: number; status: string; next: [routeId: string, headsign: string, atSec: number][] }[] }
export interface BoardRef extends HashedRef { stop: string; name: string; samples: number }

export type VoiceState = 'loading' | 'down' | 'unconfirmed' | 'silent' | 'reduced' | 'normal' | 'unknown';
export interface VoiceFact { id: string; kind: string; wording: string | null; text: string }
export interface VoiceRow { id: string; kind: string; source: string | null; live: boolean; title: string; sub: string | null; atSec: number | null; caveat: boolean }
/** One minute of the replayed voice: indices into the day file's facts (`f`), rows (`r`) and sentences (`lead`). */
export interface VoiceMinute { at: number; f: number[]; r: number[]; lead: number | null; state: VoiceState; voice: 'all' | 'live-only' | 'none'; seen: number | null; expected: number | null; note: string | null }
/** The companion's own voice for every minute of one Zagreb day, computed offline with today's rules (S-15); `minutes[i]` null = no data for the minute. */
export interface VoiceFile { v: 2; place: string; day: string; t0: number; step: 60; n: number; facts: VoiceFact[]; rows: VoiceRow[]; sentences: string[]; minutes: (VoiceMinute | null)[] }
export interface VoiceIndex { v: 2; place: string; days: { day: string; t0: number; n: number; file: HashedRef }[] }

// ---- the downloads ---------------------------------------------------------------------

export interface ExportRef extends HashedRef { name: string; format: 'csv' | 'json' | 'geojson'; mediaType: 'text/csv' | 'application/json' | 'application/geo+json'; title: string; rows: number | null }
export interface OpisFile { v: 2; title: string; licence: { text: string; url: string }; attribution: Attribution[];
  exports: (ExportRef & { description: string; columns: { name: string; type: 'int' | 'float' | 'text' | 'time' | 'bool'; unit: string | null; description: string }[] | null })[] }

// ---- the manifest --------------------------------------------------------------------------

export interface SnimkaManifest {
  version: 2; builtAt: string; title: string;
  build: { commit: string; inputs: Record<string, string> };       // input fingerprint per stage
  window: typeof SNIMKA_WINDOW & { tz: 'Europe/Zagreb'; utcOffsetMin: 120 };
  comparisons: (Comparison & { files: { series: HashedRef; routes: HashedRef }; notes: string[] })[];   // in SNIMKA_COMPARISONS order
  serviceLiveFromSec: number;                                      // first minute with a non-null published.service
  networks: { '395': NetworkRef; '396': NetworkRef };              // frozen byte copies of zet-network.json (feeds 000395 and 000396)
  files: { series: HashedRef; motionIndex: HashedRef; routes: HashedRef; stations: HashedRef; bajs: HashedRef; closures: HashedRef; events: HashedRef; notices: HashedRef; news: HashedRef;
           places: HashedRef; screenIndex: HashedRef; boards: BoardRef[]; voiceIndex: HashedRef; exports: ExportRef[]; opis: HashedRef; grid: null };   // every key required; grid stays null
  attribution: Attribution[];
  notes: string[];                                                 // Croatian footnotes (gaps and caveats)
}

// ---- light shape guards ---------------------------------------------------
// Each answers "does this look like the file I am about to read?" from the
// fields the page depends on. None throws; none minds an extra field. The
// strict validation (every number in range, every hash in its name) belongs
// to the codec's decoders.

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isCol = (x: unknown, n?: number): x is unknown[] => Array.isArray(x) && (n === undefined || x.length === n);
const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');
const isLonLat = (x: unknown): x is [number, number] => Array.isArray(x) && x.length === 2 && isNum(x[0]) && isNum(x[1]);

export function isHashedRef(x: unknown): x is HashedRef {
  return isRec(x) && typeof x.path === 'string' && isInt(x.bytes) && x.bytes >= 0 && typeof x.sha256 === 'string' && /^[0-9a-f]{64}$/.test(x.sha256);
}

const FOCUS_KINDS = new Set(['city', 'place', 'route', 'station', 'stop', 'layer', 'none']);
const FOCUS_LAYERS = new Set(['bikes', 'closures', 'live']);
export function isFocus(x: unknown): x is Focus {
  if (!isRec(x) || typeof x.kind !== 'string' || !FOCUS_KINDS.has(x.kind)) return false;
  if (x.kind === 'city' || x.kind === 'none') return true;
  if (x.kind === 'layer') return typeof x.layer === 'string' && FOCUS_LAYERS.has(x.layer);
  if (typeof x.id !== 'string') return false;
  if (x.kind === 'place') return (x.lonLat === undefined || isLonLat(x.lonLat)) && (x.zoom === undefined || isNum(x.zoom)) && (x.name === undefined || typeof x.name === 'string');
  return true;
}
export function isMentions(x: unknown): x is Mentions {
  return isRec(x) && (['routes', 'stations', 'places', 'tags'] as const).every((k) => x[k] === undefined || isStrings(x[k]));
}
/** focus, facts and mentions: the three fields every v2 item carries. */
const hasPointers = (x: Rec): boolean => isFocus(x.focus) && isStrings(x.facts) && isMentions(x.mentions);

export function isSeriesFile(x: unknown): x is SeriesFile {
  if (!isRec(x) || x.v !== 2 || !isInt(x.t0) || x.step !== 60 || !isInt(x.n) || x.n <= 0) return false;
  const n = x.n;
  const cols = (group: unknown, names: string[]): boolean => isRec(group) && names.every((name) => isCol(group[name], n));
  if (!cols(x.seen, ['all', 'tram', 'bus']) || !cols(x.expected, ['all', 'tram', 'bus'])) return false;
  if (!cols(x.service, ['state', 'since', 'ratio', 'hold'])) return false;
  if (!cols(x.feed, ['headerAgeS', 'entities', 'rejectedFuture', 'hiddenDepot', 'hiddenParked', 'frozen', 'alerts', 'cancelledTrips'])) return false;
  if (x.published !== null && !cols(x.published, ['vehicles', 'itemCount', 'status', 'service'])) return false;
  if (x.bikes !== null && !cols(x.bikes, ['total', 'empty', 'reporting'])) return false;
  if (x.closures !== null && !cols(x.closures, ['active', 'version'])) return false;
  const h = x.hourly;
  if (!isRec(h) || !isInt(h.t0) || !isInt(h.n) || !isCol(h.tempC, h.n) || !isCol(h.weather, h.n)) return false;
  if (h.newsPulse !== null && !isCol(h.newsPulse, h.n)) return false;
  return true;
}

export function isRoutesFile(x: unknown): x is RoutesFile {
  return isRec(x) && x.v === 2 && isInt(x.t0) && x.step === ROUTES_STEP_S && isInt(x.n) && x.n >= 0 && (x.net === '395' || x.net === '396+395')
    && Array.isArray(x.routes) && x.routes.every((r) => isRec(r) && typeof r.id === 'string' && typeof r.shortName === 'string' && (r.type === 0 || r.type === 3))
    && isStrings(x.seen) && isStrings(x.expected) && x.seen.length === x.routes.length && x.expected.length === x.routes.length;
}

export function isMotionChunk(x: unknown): x is MotionChunk {
  return isRec(x) && x.v === 1 && (x.net === '395' || x.net === '396') && isInt(x.t0) && x.step === MOTION_STEP_S && x.n === MOTION_TICKS && Array.isArray(x.vehicles);
}

export function isMotionIndex(x: unknown): x is MotionIndex {
  return isRec(x) && x.v === 2 && x.step === MOTION_STEP_S && x.chunkSec === MOTION_CHUNK_S && Array.isArray(x.chunks)
    && x.chunks.every((c) => isRec(c) && typeof c.path === 'string' && isInt(c.bytes) && (c.net === '395' || c.net === '396') && isInt(c.t0) && isInt(c.vehicles));
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

export function isPlacesFile(x: unknown): x is PlacesFile {
  return isRec(x) && x.v === 2 && Array.isArray(x.places)
    && x.places.every((p) => isRec(p) && typeof p.id === 'string' && typeof p.name === 'string' && isLonLat(p.lonLat) && isNum(p.zoom) && (p.from === 'stop' || p.from === 'depot') && typeof p.ref === 'string');
}

const EVENT_KINDS = new Set(['zet', 'court', 'return', 'service', 'recording']);
const SPOTS = new Set(['stanje', 'vozila', 'linije', 'mreza', 'bicikli', 'vrijeme', 'zaslon']);
export function isSnimkaEvent(x: unknown): x is SnimkaEvent {
  return isRec(x) && typeof x.id === 'string' && isInt(x.atSec) && typeof x.kind === 'string' && EVENT_KINDS.has(x.kind)
    && typeof x.title === 'string' && (x.text === null || typeof x.text === 'string') && Array.isArray(x.sources)
    && x.sources.every((s) => isRec(s) && typeof s.label === 'string' && typeof s.url === 'string')
    && typeof x.derived === 'boolean' && typeof x.chapter === 'boolean'
    && hasPointers(x) && (x.dwellS === undefined || isNum(x.dwellS)) && (x.spot === undefined || (typeof x.spot === 'string' && SPOTS.has(x.spot)));
}
export function isEventsFile(x: unknown): x is EventsFile {
  return isRec(x) && x.v === 1 && Array.isArray(x.events) && x.events.every(isSnimkaEvent);
}

export function isNoticesFile(x: unknown): x is NoticesFile {
  return isRec(x) && x.v === 2 && Array.isArray(x.items)
    && x.items.every((i) => isRec(i) && isInt(i.id) && typeof i.title === 'string' && (i.text === null || typeof i.text === 'string') && typeof i.link === 'string' && isInt(i.pubSec) && hasPointers(i));
}

const OUTLETS = ['jutarnji', 'vecernji', 'n1'] as const;
export function isNewsFile(x: unknown): x is NewsFile {
  return isRec(x) && x.v === 2 && isRec(x.outlets) && OUTLETS.every((o) => isRec((x.outlets as Rec)[o]))
    && Array.isArray(x.items)
    && x.items.every((i) => isRec(i) && typeof i.id === 'string' && (OUTLETS as readonly string[]).includes(i.outlet as string) && typeof i.title === 'string' && typeof i.link === 'string' && isInt(i.pubSec) && (i.beat === null || typeof i.beat === 'string') && hasPointers(i));
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
  return isRec(x) && x.v === 2 && typeof x.stop === 'string' && typeof x.name === 'string' && (x.place === null || typeof x.place === 'string') && Array.isArray(x.samples)
    && x.samples.every((s) => isRec(s) && isInt(s.at) && typeof s.status === 'string' && Array.isArray(s.next) && s.next.length <= 3);
}
export function isBoardRef(x: unknown): x is BoardRef {
  if (!isHashedRef(x)) return false;
  const b = x as unknown as Rec;
  return typeof b.stop === 'string' && typeof b.name === 'string' && isInt(b.samples);
}

const VOICE_STATES = new Set(['loading', 'down', 'unconfirmed', 'silent', 'reduced', 'normal', 'unknown']);
const VOICES = new Set(['all', 'live-only', 'none']);
export function isVoiceFile(x: unknown): x is VoiceFile {
  if (!isRec(x) || x.v !== 2 || typeof x.place !== 'string' || typeof x.day !== 'string' || !isInt(x.t0) || x.step !== 60 || !isInt(x.n) || x.n <= 0) return false;
  if (!Array.isArray(x.facts) || !x.facts.every((f) => isRec(f) && typeof f.id === 'string' && typeof f.kind === 'string' && (f.wording === null || typeof f.wording === 'string') && typeof f.text === 'string')) return false;
  if (!Array.isArray(x.rows) || !x.rows.every((r) => isRec(r) && typeof r.id === 'string' && typeof r.kind === 'string' && typeof r.title === 'string' && typeof r.live === 'boolean')) return false;
  if (!isStrings(x.sentences) || !isCol(x.minutes, x.n)) return false;
  return x.minutes.every((m) => m === null || (isRec(m) && isInt(m.at) && Array.isArray(m.f) && Array.isArray(m.r) && (m.lead === null || isInt(m.lead))
    && typeof m.state === 'string' && VOICE_STATES.has(m.state) && typeof m.voice === 'string' && VOICES.has(m.voice)));
}
export function isVoiceIndex(x: unknown): x is VoiceIndex {
  return isRec(x) && x.v === 2 && typeof x.place === 'string' && Array.isArray(x.days)
    && x.days.every((d) => isRec(d) && typeof d.day === 'string' && isInt(d.t0) && isInt(d.n) && isHashedRef(d.file));
}

const EXPORT_FORMATS = new Set(['csv', 'json', 'geojson']);
const EXPORT_TYPES = new Set(['text/csv', 'application/json', 'application/geo+json']);
export function isExportRef(x: unknown): x is ExportRef {
  if (!isHashedRef(x)) return false;
  const e = x as unknown as Rec;
  return typeof e.name === 'string' && typeof e.format === 'string' && EXPORT_FORMATS.has(e.format) && typeof e.mediaType === 'string' && EXPORT_TYPES.has(e.mediaType)
    && typeof e.title === 'string' && (e.rows === null || isInt(e.rows));
}
export function isOpisFile(x: unknown): x is OpisFile {
  return isRec(x) && x.v === 2 && typeof x.title === 'string' && isRec(x.licence) && typeof x.licence.text === 'string' && typeof x.licence.url === 'string'
    && Array.isArray(x.attribution) && Array.isArray(x.exports)
    && x.exports.every((e) => isExportRef(e) && typeof (e as unknown as Rec).description === 'string' && ((e as unknown as Rec).columns === null || Array.isArray((e as unknown as Rec).columns)));
}
