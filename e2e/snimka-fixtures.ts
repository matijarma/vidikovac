// A synthetic, contract-exact v2 dataset for the /snimka/ specs, built with
// the real codec (shared/snimka-codec.ts) and hashed the way the pipeline
// hashes, so a fixture can never hold a shape the page would not accept.
// Nothing in it is a recording: the numbers follow the strike's outline (a
// fleet of about 170 on Sunday evening, under six from Monday 02:00, back to
// about 230 on Wednesday 20:30, a normal fleet of about 380 from Thursday
// 05:00 and Friday 05:00) only so that the page's logic has something to
// show. Deterministic: a small LCG, no Math.random, no clock.
//
// V2 to V5 may extend it additively (a new option, a new object), never
// change what is here. Every v1 export keeps its name.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { decodeNetwork, type GraphNetwork } from '../shared/motion/network';
import {
  BAJS_STEP_S, MOTION_CHUNK_S, MOTION_STEP_S, MOTION_TICKS, ROUTES_STEP_S, SNIMKA_API, SNIMKA_COMPARISONS, SNIMKA_WINDOW, VOICE_PLACE, ZAGREB_OFFSET_S,
  type Attribution, type BoardRef, type BoardSeries, type ClosuresFile, type Col, type Comparison, type EventsFile, type ExportRef, type FactKey, type Focus, type HashedRef,
  type Mentions, type MotionChunk, type MotionIndex, type NetworkRef, type NewsFile, type NoticesFile, type OpisFile, type PlacesFile, type RoutesFile, type ScreenIndex,
  type ScreenReading, type ScreenRow, type ScreenRun, type SeriesFile, type SnimkaEvent, type SnimkaManifest, type SnimkaState, type StationsFile, type VoiceFile, type VoiceIndex,
} from '../shared/snimka';
import { BAJS_MISSING, BAJS_NOT_RENTING, ROUTES_MISSING, contentPath, encodeBajs, encodeMotionChunk, encodeRoutes, type ContentExt, type MotionSample } from '../shared/snimka-codec';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
/** The two frozen network artefacts the manifest refers to, served from disk by routeSnimka. */
export const NETWORK_FILES = {
  '396': 'app/public/data/zet-network.json',
  '395': 'test/fixtures/frames/2026-09-21-1715-1744/artefacts/zet-network.json',
} as const;

export interface SnimkaFixtureOptions {
  /** The chunk whose t0 (epoch seconds) is left out of the motion index and the objects: a gap in the recording. */
  missingChunkAt?: number;
  /** routeSnimka answers 404 for manifest.json: the page shows its error card. */
  noManifest?: boolean;
}

export interface SnimkaFixture {
  manifest: SnimkaManifest;
  /** Every hashed object by its manifest path: parsed JSON, text for a CSV or GeoJSON download, or bytes for a capture. */
  objects: Map<string, unknown | string | Uint8Array>;
  noManifest: boolean;
  /** Handy instants (epoch seconds) the specs seek to. */
  marks: typeof MARKS;
}

// ---- time ------------------------------------------------------------------

/** Zagreb wall time to epoch seconds (CEST throughout the window). */
export const zg = (month: number, day: number, hour: number, minute = 0): number => Date.UTC(2026, month - 1, day, hour, minute) / 1000 - ZAGREB_OFFSET_S;
const hourOfDay = (sec: number): number => (((sec + ZAGREB_OFFSET_S) % 86_400) + 86_400) % 86_400 / 3600;

export const MARKS = {
  windowStart: SNIMKA_WINDOW.fromSec,
  seriesStart: zg(9, 27, 22, 7),
  depots: zg(9, 28, 0, 0),
  strikeStart: zg(9, 28, 3, 30),
  feedStojiPon: zg(9, 28, 5, 3),
  monday0745: zg(9, 28, 7, 45),
  vozniRed396: zg(9, 28, 8, 34),
  silentFrom: zg(9, 28, 2, 0),
  feedEmptyFrom: zg(9, 28, 18, 42),
  ghostAt: zg(9, 28, 19, 27),
  feedFrozenFrom: zg(9, 29, 6, 28),
  feedFrozenTo: zg(9, 29, 9, 0),
  line228: zg(9, 29, 9, 56),
  frameGapFrom: zg(9, 29, 3, 0),
  frameGapTo: zg(9, 29, 3, 5),
  serviceLive: zg(9, 29, 23, 17),
  wednesday0745: zg(9, 30, 7, 45),
  court: zg(9, 30, 11, 13),
  returnFrom: zg(9, 30, 18, 16),
  reducedAt: zg(9, 30, 19, 5),
  normalAt: zg(9, 30, 20, 20),
  recorderGapFrom: zg(9, 30, 22, 41),
  recorderGapTo: zg(9, 30, 22, 54),
  thursday0745: zg(10, 1, 7, 45),
  /** The normal fleet of the after-days starts here (Thu 05:00); Friday follows the same shape. */
  normalFrom: zg(10, 1, 5, 0),
  friday0745: zg(10, 2, 7, 45),
  windowEnd: SNIMKA_WINDOW.toSec,
  comparisonStart: SNIMKA_COMPARISONS[0].fromSec,
  comparisonMondayStart: SNIMKA_COMPARISONS[1].fromSec,
  motion396: [zg(9, 28, 7, 40), zg(9, 28, 7, 50)],
  motion395: [zg(9, 24, 7, 40), zg(9, 24, 7, 50)],
} as const;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// ---- hashing and naming ----------------------------------------------------

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

class Objects {
  readonly map = new Map<string, unknown | string | Uint8Array>();
  json(name: string, value: unknown): HashedRef {
    const text = JSON.stringify(value);
    const hash = sha256(text);
    const ref = { path: contentPath(name, hash, 'json'), bytes: Buffer.byteLength(text), sha256: hash };
    this.map.set(ref.path, value);
    return ref;
  }
  bytes(name: string, value: Uint8Array): HashedRef {
    const hash = sha256(value);
    const ref = { path: contentPath(name, hash, 'webp'), bytes: value.length, sha256: hash };
    this.map.set(ref.path, value);
    return ref;
  }
  /** A text download (CSV, GeoJSON), served verbatim. */
  text(name: string, value: string, ext: ContentExt): HashedRef {
    const hash = sha256(value);
    const ref = { path: contentPath(name, hash, ext), bytes: Buffer.byteLength(value), sha256: hash };
    this.map.set(ref.path, value);
    return ref;
  }
}

// ---- the series -------------------------------------------------------------

/** A normal weekday's fleet by Zagreb hour of day: quiet nights, a morning peak, a long evening fall. */
function normalFleet(hod: number): number {
  const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;
  if (hod < 4) return lerp(20, 4, hod / 4);
  if (hod < 7) return lerp(10, 230, (hod - 4) / 3);
  if (hod < 9) return lerp(230, 240, (hod - 7) / 2);
  if (hod < 14) return 200;
  if (hod < 18) return 230;
  if (hod < 21) return lerp(200, 160, (hod - 18) / 3);
  return lerp(160, 20, (hod - 21) / 3);
}
/** The after-days (Thu and Fri from 05:00) run a full fleet of about 380 at the peak; the strike days keep the v1 scale. */
const AFTER_SCALE = 1.6;
const afterDay = (sec: number): boolean => sec >= MARKS.normalFrom;

interface Minute {
  seen: number | null; expected: number; state: SnimkaState; since: number; hold: SeriesFile['service']['hold'][number];
  headerAgeS: number | null; entities: number | null; rejectedFuture: number | null; hiddenDepot: number | null; hiddenParked: number | null;
  frozen: 0 | 1 | null; alerts: number | null; cancelledTrips: number | null;
  published: { vehicles: number | null; itemCount: number | null; status: 'live' | 'stale' | 'down' | null; service: SnimkaState | null } | null;
  bikesTotal: number | null; bikesEmpty: number | null; reporting: number | null; closuresActive: number | null; closuresVersion: number | null;
}

/** One minute of the window, following the strike's outline and then two normal days. */
function windowMinute(sec: number, r: () => number): Minute {
  const hod = hourOfDay(sec);
  const scale = afterDay(sec) ? AFTER_SCALE : 1;
  const expected = Math.round(normalFleet(hod) * scale * (afterDay(sec) ? 1.03 : 1));
  let seen: number | null;
  let state: SnimkaState;
  let since: number;
  if (sec < MARKS.depots) { seen = Math.round(normalFleet(hod) * 1.02); state = 'normal'; since = MARKS.windowStart; }
  else if (sec < MARKS.silentFrom) { seen = Math.round(18 - (13 * (sec - MARKS.depots)) / (MARKS.silentFrom - MARKS.depots)); state = 'reduced'; since = MARKS.depots; }
  else if (sec < MARKS.returnFrom) { seen = sec >= MARKS.feedEmptyFrom && sec < MARKS.feedFrozenFrom ? 0 : (Math.floor((sec - MARKS.silentFrom) / 420) % 6); state = 'silent'; since = MARKS.silentFrom; }
  else if (sec < MARKS.reducedAt) { seen = Math.round(2 + (90 * (sec - MARKS.returnFrom)) / (MARKS.reducedAt - MARKS.returnFrom)); state = 'silent'; since = MARKS.silentFrom; }
  else if (sec < MARKS.normalAt) { seen = Math.round(92 + (120 * (sec - MARKS.reducedAt)) / (MARKS.normalAt - MARKS.reducedAt)); state = 'reduced'; since = MARKS.reducedAt; }
  else { seen = Math.round(Math.max(normalFleet(hod) * scale, sec < zg(9, 30, 21, 0) ? 212 + (18 * (sec - MARKS.normalAt)) / 600 : 0)); state = 'normal'; since = MARKS.normalAt; }
  if (sec >= zg(9, 30, 20, 30) && sec < zg(9, 30, 21, 0)) seen = Math.max(seen, 230);
  let hold: Minute['hold'] = null;
  // A frame gap: no frame in these minutes, the state carried.
  const frameGap = sec >= MARKS.frameGapFrom && sec < MARKS.frameGapTo;
  if (frameGap) { seen = null; hold = 'gap'; }
  const feedEmpty = sec >= MARKS.feedEmptyFrom && sec < MARKS.feedFrozenFrom;
  const frozen = sec >= MARKS.feedFrozenFrom && sec < MARKS.feedFrozenTo;
  const hiddenDepot = frameGap ? null : feedEmpty ? 0 : state === 'silent' ? 2 : 40;
  const hiddenParked = frameGap ? null : feedEmpty ? 0 : 10;
  const entities = frameGap ? null : feedEmpty ? 0 : (seen ?? 0) + hiddenDepot! + hiddenParked!;
  const headerAgeS = frameGap ? null : frozen ? 15 + Math.floor((sec - MARKS.feedFrozenFrom) / 60) * 60 : 10 + Math.floor(r() * 10);
  const rejectedFuture = frameGap ? null : sec >= MARKS.depots && sec < MARKS.strikeStart ? 5 : 0;
  // ZET's own alerts and cancellations: none during the strike days, a few on the normal days.
  const alerts = frameGap ? null : afterDay(sec) && hod >= 7 && hod < 9 ? 2 : 0;
  const cancelledTrips = frameGap ? null : afterDay(sec) && hod >= 6 && hod < 20 && Math.floor(sec / 60) % 60 === 0 ? 1 : 0;
  const recorderGap = sec >= MARKS.recorderGapFrom && sec < MARKS.recorderGapTo;
  const noPublished = sec < MARKS.seriesStart || recorderGap;
  const ghost = sec >= zg(9, 28, 17, 0) && sec < zg(9, 28, 21, 0) ? 5 : 0;
  const published = noPublished ? null : {
    vehicles: (seen ?? 0) + ghost,
    itemCount: 28 + Math.floor(r() * 6),
    status: frozen ? ('stale' as const) : ('live' as const),
    service: sec >= MARKS.serviceLive ? state : null,
  };
  // Bikes drain from Sunday to Wednesday noon and come back by Thursday morning; the after-days hold a normal level.
  const drainTo = zg(9, 30, 12, 0);
  const backBy = zg(10, 1, 8, 0);
  const bikesTotal = noPublished ? null : sec < drainTo ? Math.round(1866 - (1332 * (sec - MARKS.windowStart)) / (drainTo - MARKS.windowStart)) : sec < backBy ? Math.round(534 + (366 * (sec - drainTo)) / (backBy - drainTo)) : 900 + Math.round(60 * Math.sin(hod / 4));
  const bikesEmpty = noPublished ? null : sec < drainTo ? Math.round(5 + (105 * (sec - MARKS.windowStart)) / (drainTo - MARKS.windowStart)) : sec < backBy ? Math.round(110 - (70 * (sec - drainTo)) / (backBy - drainTo)) : 40 + Math.round(8 * Math.sin(hod / 3));
  const closuresVersion = noPublished ? null : sec < zg(9, 28, 12, 0) ? 0 : sec < zg(9, 30, 9, 0) ? 1 : 2;
  const closuresActive = closuresVersion === null ? null : [12, 14, 13][closuresVersion]!;
  return {
    seen, expected, state, since, hold, headerAgeS, entities, rejectedFuture, hiddenDepot, hiddenParked, frozen: frameGap ? null : frozen ? 1 : 0, alerts, cancelledTrips, published,
    bikesTotal, bikesEmpty, reporting: noPublished ? null : 200, closuresActive, closuresVersion,
  };
}

function split(all: number | null, share: number): [number | null, number | null] {
  if (all === null) return [null, null];
  const tram = Math.round(all * share);
  return [tram, all - tram];
}

const WEATHER = ['vedro', 'pretežno vedro', 'oblačno', 'kiša'] as const;

function hourly(t0: number, n: number, withNews: boolean, r: () => number): SeriesFile['hourly'] {
  const tempC: Col<number> = [];
  const weather: Col<string> = [];
  const newsPulse: number[] = [];
  for (let h = 0; h < n; h++) {
    const sec = t0 + h * 3600;
    const hod = hourOfDay(sec);
    const temp = Math.round((13 + 6 * Math.sin(((hod - 9) / 24) * 2 * Math.PI)) * 10) / 10;
    // One missing hour, so the strip has a real gap to draw.
    tempC.push(h === 40 ? null : temp);
    weather.push(h === 40 ? null : WEATHER[Math.floor(r() * WEATHER.length)]!);
    const dayIndex = Math.floor((sec + ZAGREB_OFFSET_S) / 86_400) - Math.floor((MARKS.windowStart + ZAGREB_OFFSET_S) / 86_400);
    newsPulse.push(hod >= 6 && hod <= 22 ? Math.min(4, Math.floor(r() * 3) + (dayIndex === 1 && hod < 10 ? 2 : dayIndex === 3 && hod >= 10 && hod <= 13 ? 2 : 0)) : 0);
  }
  return { t0, n, tempC, weather, newsPulse: withNews ? newsPulse : null };
}

export function buildWindowSeries(): SeriesFile {
  const r = rng(28);
  const n = SNIMKA_WINDOW.minutes;
  const t0 = SNIMKA_WINDOW.fromSec;
  const cols = {
    seenAll: [] as Col<number>, seenTram: [] as Col<number>, seenBus: [] as Col<number>,
    expAll: [] as Col<number>, expTram: [] as Col<number>, expBus: [] as Col<number>,
    state: [] as Col<SnimkaState>, since: [] as Col<number>, ratio: [] as Col<number>, hold: [] as SeriesFile['service']['hold'],
    headerAgeS: [] as Col<number>, entities: [] as Col<number>, rejectedFuture: [] as Col<number>, hiddenDepot: [] as Col<number>, hiddenParked: [] as Col<number>,
    frozen: [] as Col<0 | 1>, alerts: [] as Col<number>, cancelledTrips: [] as Col<number>,
    pubVehicles: [] as Col<number>, pubItems: [] as Col<number>, pubStatus: [] as Col<'live' | 'stale' | 'down'>, pubService: [] as Col<SnimkaState>,
    bikesTotal: [] as Col<number>, bikesEmpty: [] as Col<number>, reporting: [] as Col<number>, closuresActive: [] as Col<number>, closuresVersion: [] as Col<number>,
  };
  for (let i = 0; i < n; i++) {
    const m = windowMinute(t0 + i * 60, r);
    const [tram, bus] = split(m.seen, 0.55);
    const [eTram, eBus] = split(m.expected, 0.55);
    cols.seenAll.push(m.seen); cols.seenTram.push(tram); cols.seenBus.push(bus);
    cols.expAll.push(m.expected); cols.expTram.push(eTram); cols.expBus.push(eBus);
    cols.state.push(m.state); cols.since.push(m.since); cols.ratio.push(m.seen === null ? null : Math.round((m.seen / Math.max(1, m.expected)) * 100) / 100); cols.hold.push(m.hold);
    cols.headerAgeS.push(m.headerAgeS); cols.entities.push(m.entities); cols.rejectedFuture.push(m.rejectedFuture); cols.hiddenDepot.push(m.hiddenDepot); cols.hiddenParked.push(m.hiddenParked);
    cols.frozen.push(m.frozen); cols.alerts.push(m.alerts); cols.cancelledTrips.push(m.cancelledTrips);
    cols.pubVehicles.push(m.published?.vehicles ?? null); cols.pubItems.push(m.published?.itemCount ?? null); cols.pubStatus.push(m.published?.status ?? null); cols.pubService.push(m.published?.service ?? null);
    cols.bikesTotal.push(m.bikesTotal); cols.bikesEmpty.push(m.bikesEmpty); cols.reporting.push(m.reporting); cols.closuresActive.push(m.closuresActive); cols.closuresVersion.push(m.closuresVersion);
  }
  return {
    v: 2, t0, step: 60, n,
    seen: { all: cols.seenAll, tram: cols.seenTram, bus: cols.seenBus },
    expected: { all: cols.expAll, tram: cols.expTram, bus: cols.expBus },
    service: { state: cols.state, since: cols.since, ratio: cols.ratio, hold: cols.hold },
    feed: { headerAgeS: cols.headerAgeS, entities: cols.entities, rejectedFuture: cols.rejectedFuture, hiddenDepot: cols.hiddenDepot, hiddenParked: cols.hiddenParked, frozen: cols.frozen, alerts: cols.alerts, cancelledTrips: cols.cancelledTrips },
    published: { vehicles: cols.pubVehicles, itemCount: cols.pubItems, status: cols.pubStatus, service: cols.pubService },
    bikes: { total: cols.bikesTotal, empty: cols.bikesEmpty, reporting: cols.reporting },
    closures: { active: cols.closuresActive, version: cols.closuresVersion },
    hourly: hourly(t0, n / 60, true, r),
  };
}

/** A normal day's series: Thu 24 Sep by default (as v1), or Mon 21 Sep with the same shape shifted to its own midnight. */
export function buildComparisonSeries(comparison: Comparison = SNIMKA_COMPARISONS[0]): SeriesFile {
  const r = rng(24);
  const n = comparison.minutes;
  const t0 = comparison.fromSec;
  const seenAll: Col<number> = []; const seenTram: Col<number> = []; const seenBus: Col<number> = [];
  const expAll: Col<number> = []; const expTram: Col<number> = []; const expBus: Col<number> = [];
  const ratio: Col<number> = [];
  const headerAgeS: Col<number> = []; const entities: Col<number> = []; const alerts: Col<number> = []; const cancelledTrips: Col<number> = [];
  for (let i = 0; i < n; i++) {
    const sec = t0 + i * 60;
    const hod = hourOfDay(sec);
    const expected = Math.round(normalFleet(hod));
    const seen = Math.round(expected * (0.96 + r() * 0.08));
    const [tram, bus] = split(seen, 0.55);
    const [eTram, eBus] = split(expected, 0.55);
    seenAll.push(seen); seenTram.push(tram); seenBus.push(bus);
    expAll.push(expected); expTram.push(eTram); expBus.push(eBus);
    ratio.push(Math.round((seen / Math.max(1, expected)) * 100) / 100);
    headerAgeS.push(10 + Math.floor(r() * 10)); entities.push(seen + 50);
    alerts.push(hod >= 7 && hod < 9 ? 1 : 0); cancelledTrips.push(hod >= 6 && hod < 20 && i % 120 === 0 ? 1 : 0);
  }
  const fill = <T,>(value: T): Col<T> => new Array<T>(n).fill(value);
  return {
    v: 2, t0, step: 60, n,
    seen: { all: seenAll, tram: seenTram, bus: seenBus },
    expected: { all: expAll, tram: expTram, bus: expBus },
    service: { state: fill<SnimkaState>('normal'), since: fill(t0), ratio, hold: fill(null) },
    feed: { headerAgeS, entities, rejectedFuture: fill(0), hiddenDepot: fill(40), hiddenParked: fill(10), frozen: fill<0 | 1>(0), alerts, cancelledTrips },
    published: null, bikes: null, closures: null,
    hourly: hourly(t0, 24, false, r),
  };
}

// ---- the routes (per line, every five minutes) ----------------------------------

const ZET_ROUTES = JSON.parse(readFileSync(join(ROOT, 'app/src/data/zet-routes.json'), 'utf8')) as Record<string, { shortName: string; longName: string; type: 0 | 3 }>;
/** The 19 tram ids, the three strike buses and ten more bus lines: the fixture's route list, in file order. */
export const FIXTURE_ROUTES: RoutesFile['routes'] = ((): RoutesFile['routes'] => {
  const ids = Object.keys(ZET_ROUTES);
  const trams = ids.filter((id) => ZET_ROUTES[id]!.type === 0);
  const strikeBuses = ['228', '116', '217'];
  const moreBuses = ids.filter((id) => ZET_ROUTES[id]!.type === 3 && !strikeBuses.includes(id)).slice(0, 10);
  return [...trams, ...strikeBuses, ...moreBuses].map((id) => ({ id, shortName: ZET_ROUTES[id]!.shortName, type: ZET_ROUTES[id]!.type }));
})();
const NIGHT_TRAMS = new Set(['31', '32', '33', '34']);
const STRIKE_BUSES_FROM_TUESDAY = new Set(['228', '116', '217']);

/** The timetable's runs of a route in the five minutes from `sec`: day trams by the fleet curve, night trams at night, buses by day. */
function routeExpected(route: RoutesFile['routes'][number], sec: number): number {
  const hod = hourOfDay(sec);
  if (route.type === 0) {
    if (NIGHT_TRAMS.has(route.id)) return hod < 4 ? 2 : 0;
    return hod >= 4 ? Math.max(1, Math.round((normalFleet(hod) / 240) * 12)) : 0;
  }
  return hod >= 5 && hod < 23 ? 4 : 0;
}

/** The vehicles a route had in the five minutes from `sec`, following the strike's outline. */
function routeSeen(route: RoutesFile['routes'][number], sec: number, expected: number): number {
  const hod = hourOfDay(sec);
  if (sec >= MARKS.frameGapFrom && sec < MARKS.frameGapTo) return ROUTES_MISSING;
  if (sec < MARKS.depots) return expected;
  if (sec < MARKS.silentFrom) return Math.round(expected * (1 - (sec - MARKS.depots) / (MARKS.silentFrom - MARKS.depots)));
  if (sec < MARKS.returnFrom) {
    // Lines 11 and 17 ran on Monday morning; 228, 116 and 217 from Tuesday 09:56 by day.
    if ((route.id === '11' || route.id === '17') && sec >= zg(9, 28, 5, 0) && sec < zg(9, 28, 9, 0)) return 1;
    if (STRIKE_BUSES_FROM_TUESDAY.has(route.id) && sec >= MARKS.line228 && hod >= 6 && hod < 22) return 2;
    return 0;
  }
  if (sec < MARKS.normalAt) return Math.round(expected * (sec - MARKS.returnFrom) / (MARKS.normalAt - MARKS.returnFrom));
  return expected;
}

/** The window's per-line counts: n 1344 slots of five minutes. */
export function buildRoutes(): RoutesFile {
  const n = (SNIMKA_WINDOW.minutes * 60) / ROUTES_STEP_S;
  const t0 = SNIMKA_WINDOW.fromSec;
  const seen = FIXTURE_ROUTES.map((route) => {
    const row = new Uint8Array(n);
    for (let j = 0; j < n; j++) { const sec = t0 + j * ROUTES_STEP_S; row[j] = routeSeen(route, sec, routeExpected(route, sec)); }
    return row;
  });
  const expected = FIXTURE_ROUTES.map((route) => {
    const row = new Uint8Array(n);
    for (let j = 0; j < n; j++) row[j] = routeExpected(route, t0 + j * ROUTES_STEP_S);
    return row;
  });
  return encodeRoutes(t0, ROUTES_STEP_S, FIXTURE_ROUTES, seen, expected, '396+395');
}

/** A comparison day's per-line counts: every route alive whenever it is scheduled. */
export function buildComparisonRoutes(comparison: Comparison = SNIMKA_COMPARISONS[0]): RoutesFile {
  const n = (comparison.minutes * 60) / ROUTES_STEP_S;
  const t0 = comparison.fromSec;
  const expected = FIXTURE_ROUTES.map((route) => {
    const row = new Uint8Array(n);
    for (let j = 0; j < n; j++) row[j] = routeExpected(route, t0 + j * ROUTES_STEP_S);
    return row;
  });
  const seen = expected.map((row) => Uint8Array.from(row));
  return encodeRoutes(t0, ROUTES_STEP_S, FIXTURE_ROUTES, seen, expected, '395');
}

// ---- places ------------------------------------------------------------------------

/** The curated places of Appendix C (coordinates from stops.json platforms and the depot centres), the fixture's copy. */
export function buildPlaces(): PlacesFile {
  const stop = (id: string, name: string, ref: string, lon: number, lat: number, zoom = 14): PlacesFile['places'][number] => ({ id, name, lonLat: [lon, lat], zoom, from: 'stop', ref });
  const depot = (id: string, name: string, ref: string, lon: number, lat: number): PlacesFile['places'][number] => ({ id, name, lonLat: [lon, lat], zoom: 14, from: 'depot', ref });
  return {
    v: 2,
    places: [
      stop('jelacic', 'Trg bana J. Jelačića', '106_1', 15.97726, 45.81286, 13.2),
      stop('glavni-kolodvor', 'Glavni kolodvor', '109_1', 15.97928, 45.80521),
      stop('crnomerec', 'Črnomerec', '98_1', 15.93493, 45.815),
      stop('dubrava', 'Dubrava', '208_24', 16.03708, 45.82448),
      stop('savski-most', 'Savski most', '271_24', 15.95284, 45.78585),
      stop('kvaternikov-trg', 'Kvaternikov trg', '236_1', 15.99592, 45.81457),
      stop('ljubljanica', 'Ljubljanica', '245_1', 15.93857, 45.79723),
      stop('borongaj', 'Borongaj', '192_22', 16.01865, 45.81479),
      stop('zaprude', 'Zapruđe', '1780_11', 16.0009, 45.77805),
      stop('rebro', 'Bolnica Rebro', '1123_23', 16.00759, 45.82309),
      depot('spremiste-dubrava', 'Spremište Dubrava', 'dubrava', 16.03995, 45.82043),
      depot('spremiste-ljubljanica', 'Spremište Ljubljanica', 'ljubljanica', 15.9386, 45.79618),
    ],
  };
}

// ---- events, notices, news ---------------------------------------------------

const ZET = (id: number): { label: string; url: string } => ({ label: `ZET, obavijest ${id}`, url: `https://www.zet.hr/obavijesti/${id}` });
const PRESS = { label: 'Jutarnji list', url: 'https://www.jutarnji.hr/' };
const CITY: Focus = { kind: 'city' };
const NONE: Focus = { kind: 'none' };
const JELACIC: Focus = { kind: 'place', id: 'jelacic', name: 'Trg bana J. Jelačića', lonLat: [15.97726, 45.81286], zoom: 13.2 };
const STATE_FACTS: FactKey[] = ['state', 'seen', 'expected'];

export function buildEvents(): EventsFile {
  type Extra = Partial<Pick<SnimkaEvent, 'derived' | 'text' | 'facts' | 'mentions' | 'dwellS' | 'spot' | 'chapter'>>;
  const event = (id: string, atSec: number, kind: SnimkaEvent['kind'], title: string, sources: SnimkaEvent['sources'], focus: Focus, extra: Extra = {}): SnimkaEvent => ({
    id, atSec, kind, title, text: extra.text ?? null, sources, derived: extra.derived ?? false, chapter: extra.chapter ?? true,
    focus, facts: extra.facts ?? STATE_FACTS, mentions: extra.mentions ?? {}, ...(extra.dwellS !== undefined ? { dwellS: extra.dwellS } : {}), ...(extra.spot ? { spot: extra.spot } : {}),
  });
  const events: SnimkaEvent[] = [
    event('vecer-prije', MARKS.windowStart, 'recording', 'Večer prije', [], CITY),
    event('spremista', MARKS.depots, 'service', 'Vozila se povlače u spremišta', [], { kind: 'place', id: 'spremiste-dubrava', name: 'Spremište Dubrava', lonLat: [16.03995, 45.82043], zoom: 14 }, { derived: true, text: 'Manje od dvadeset vozila u pokretu.', dwellS: 6, spot: 'vozila', facts: ['seen', 'expected'] }),
    event('pocetak', MARKS.strikeStart, 'zet', 'Početak štrajka', [ZET(10164), PRESS], NONE, { spot: 'stanje' }),
    event('feed-stoji-pon', MARKS.feedStojiPon, 'zet', 'ZET-ovi podaci se ne mijenjaju: prvi put', [], NONE, { derived: true, chapter: false, facts: ['feed', 'seen'] }),
    event('prvo-jutro', MARKS.monday0745, 'recording', 'Prvo jutro', [], JELACIC, { spot: 'zaslon', facts: ['seen', 'expected', 'state', 'bikesEmpty'] }),
    event('vozni-red-396', MARKS.vozniRed396, 'zet', 'ZET objavljuje novi vozni red (000396)', [{ label: 'ZET, GTFS', url: 'https://www.zet.hr/gtfs-scheduled/latest' }], NONE, { chapter: false, text: 'Aplikacija je vozni red zamijenila pri sljedećoj izgradnji.', facts: ['expected'] }),
    event('bez-vozila', MARKS.feedEmptyFrom, 'zet', 'ZET šalje podatke bez ijednog vozila', [], NONE, { derived: true, facts: ['feed', 'seen'] }),
    event('zamrznuto', MARKS.feedFrozenFrom, 'zet', 'ZET-ovi podaci se ne mijenjaju', [], NONE, { derived: true, facts: ['feed', 'seen'] }),
    event('linija-228', MARKS.line228, 'zet', 'Autobusna linija 228 do Rebra', [ZET(10166)], { kind: 'route', id: '228' }, { spot: 'linije', facts: ['route:228', 'seen'], mentions: { routes: ['228'], places: ['rebro'] } }),
    event('stanje-usluge', MARKS.serviceLive, 'recording', 'Aplikacija dobiva stanje usluge', [], NONE, { spot: 'stanje' }),
    event('trece-jutro', MARKS.wednesday0745, 'recording', 'Treće jutro', [], JELACIC, { spot: 'zaslon' }),
    event('sud', MARKS.court, 'court', 'Sud: štrajk u ZET-u nije zakonit', [PRESS, ZET(10167)], NONE, { spot: 'stanje' }),
    event('povratak', MARKS.returnFrom, 'return', 'Vozila se vraćaju', [], CITY, { derived: true, spot: 'vozila' }),
    event('uobicajeno', MARKS.normalAt, 'service', 'Uobičajeno stanje', [], CITY, { derived: true, spot: 'stanje' }),
    event('zapisivaci', MARKS.recorderGapFrom, 'recording', 'Zapisivači su stali na trinaest minuta', [], NONE, { chapter: false, text: 'Objavljeni brojevi nedostaju od 22:41 do 22:54; snimka ZET-ovih podataka je potpuna.', facts: ['seen'] }),
    event('cetvrto-jutro', MARKS.thursday0745, 'recording', 'Prvo uobičajeno jutro', [], JELACIC, { spot: 'zaslon' }),
    event('drugo-uobicajeno-jutro', MARKS.friday0745, 'recording', 'Drugo uobičajeno jutro', [], JELACIC, { spot: 'zaslon' }),
    event('kraj-snimke', MARKS.windowEnd, 'recording', 'Kraj snimke', [], CITY, { chapter: false, facts: ['seen', 'expected'] }),
  ];
  return { v: 1, events };
}

export function buildNotices(): NoticesFile {
  return {
    v: 2,
    items: [
      { id: 10164, title: 'Obavijest o prometu tramvaja i autobusa od ponedjeljka 28. rujna', text: null, link: 'https://www.zet.hr/obavijesti/10164', pubSec: zg(9, 27, 16, 27), focus: NONE, facts: STATE_FACTS, mentions: {} },
      { id: 10166, title: 'Autobusna linija 228 do Rebra', text: 'Od 10 sati vozi autobusna linija 228 između Kaptola i Rebra.', link: 'https://www.zet.hr/obavijesti/10166', pubSec: MARKS.line228, focus: { kind: 'route', id: '228' }, facts: ['route:228', 'seen'], mentions: { routes: ['228'], places: ['rebro'] } },
    ],
  };
}

export function buildNews(): NewsFile {
  const item = (id: string, outlet: NewsFile['items'][number]['outlet'], title: string, link: string, pubSec: number, beat: string, focus: Focus, facts: FactKey[] = STATE_FACTS, mentions: Mentions = {}): NewsFile['items'][number] =>
    ({ id, outlet, title, link, pubSec, beat, focus, facts, mentions });
  return {
    v: 2,
    outlets: {
      jutarnji: { name: 'Jutarnji list', home: 'https://www.jutarnji.hr/' },
      vecernji: { name: 'Večernji list', home: 'https://www.vecernji.hr/' },
      n1: { name: 'N1', home: 'https://n1info.hr/' },
    },
    items: [
      item('j1', 'jutarnji', 'Zagreb bez tramvaja i autobusa: kako su građani stigli na posao', 'https://www.jutarnji.hr/vijesti/zagreb/primjer-1', zg(9, 28, 6, 10), 'pocetak', CITY),
      item('j2', 'jutarnji', 'Stanice BAJS-a prazne već do podneva', 'https://www.jutarnji.hr/vijesti/zagreb/primjer-4', zg(9, 28, 12, 30), 'bajs', { kind: 'layer', layer: 'bikes' }, ['bikes', 'bikesEmpty']),
      item('v1', 'vecernji', 'ZET uveo autobusnu liniju do Rebra', 'https://www.vecernji.hr/zagreb/primjer-2', zg(9, 29, 10, 30), 'linija-228', { kind: 'route', id: '228' }, ['route:228', 'seen'], { routes: ['228'], places: ['rebro'] }),
      item('n1', 'n1', 'Sud presudio: obustava rada u ZET-u nije zakonita', 'https://n1info.hr/vijesti/primjer-3', zg(9, 30, 11, 20), 'presuda', NONE),
      item('n2', 'n1', 'Dan nakon: tramvaji voze, grad se vraća u ritam', 'https://n1info.hr/vijesti/primjer-5', zg(10, 1, 9, 10), 'nakon', CITY),
    ],
  };
}

// ---- the screen ---------------------------------------------------------------

/** The smallest valid WebP (a 1 by 1 lossless image), held as bytes for the captures. */
export const TINY_WEBP = Uint8Array.from(Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64'));

const SCREEN_ROWS: ScreenRow[] = [
  { id: 'dep-6', kind: 'departure', source: 'zet-timetable', live: false, title: 'Tramvaj 6 prema Črnomercu', whenText: '07:52', sub: 'vozni red', caveat: false },
  { id: 'dep-11', kind: 'departure', source: 'zet-timetable', live: false, title: 'Tramvaj 11 prema Dupcu', whenText: '07:55', sub: 'vozni red', caveat: false },
  { id: 'dep-12', kind: 'departure', source: 'zet-timetable', live: false, title: 'Tramvaj 12 prema Ljubljanici', whenText: '07:58', sub: 'vozni red', caveat: false },
  { id: 'weather', kind: 'weather', source: 'dhmz', live: true, title: 'Vedro, 14 °C', whenText: null, sub: 'Zagreb-Maksimir', caveat: false },
];

function screenRun(id: string, fromSec: number, reading: (i: number) => Omit<ScreenReading, 'at' | 'rows'>, readings = 30): ScreenRun {
  return {
    v: 1, id, kind: 'slot', place: 'Trg bana J. Jelačića', fromSec, toSec: fromSec + readings * 20,
    rows: SCREEN_ROWS,
    readings: Array.from({ length: readings }, (_, i) => ({ at: fromSec + i * 20, rows: [0, 1, 2, 3], ...reading(i) })),
  };
}

function buildScreen(objects: Objects): HashedRef {
  const monday = screenRun('mon-0745', MARKS.monday0745, () => ({
    sentence: 'Tramvaj 6 prema Črnomercu polazi u 07:52 po voznom redu.', kicker: 'promet', kickerText: 'Promet', fact: 'departure-timetable', family: 'departure-timetable',
    pills: null, mapNote: null, fleet: { pins: 5, service: null },
  }));
  const wednesday = screenRun('wed-0745', MARKS.wednesday0745, () => ({
    sentence: 'U pokretu su 3 vozila, po voznom redu oko 230.', kicker: 'promet', kickerText: 'Promet', fact: 'service-silent', family: 'service',
    pills: null, mapNote: null, fleet: { pins: 3, service: 'silent' },
  }));
  const runs: ScreenIndex['runs'] = [monday, wednesday].map((run) => ({
    id: run.id, kind: run.kind, fromSec: run.fromSec, toSec: run.toSec, readings: run.readings.length,
    file: objects.json(`screen/run-${run.id}`, run),
    captures: { kiosk: objects.bytes(`captures/${run.id}-kiosk`, TINY_WEBP), phone: null },
    summary: { sentences: { [run.readings[0]!.family]: run.readings.length }, departureRows: 3, liveRows: 1 },
  }));
  return objects.json('screen/index', { v: 1, runs } satisfies ScreenIndex);
}

/** The eight boards of the plan (section 5): the stop, its name, its place id. */
export const BOARD_STOPS: readonly [stop: string, name: string, place: string][] = [
  ['106_1', 'Trg bana J. Jelačića', 'jelacic'], ['106_2', 'Trg bana J. Jelačića', 'jelacic'], ['98_1', 'Črnomerec', 'crnomerec'], ['208_24', 'Dubrava', 'dubrava'],
  ['271_24', 'Savski most', 'savski-most'], ['236_1', 'Kvaternikov trg', 'kvaternikov-trg'], ['109_1', 'Glavni kolodvor', 'glavni-kolodvor'], ['245_1', 'Ljubljanica', 'ljubljanica'],
];

/** The Jelačić board over the whole window (as v1, now v2-shaped) or a tiny board of six samples around Monday 07:30 for the other stops. */
export function buildBoard(stop = VOICE_PLACE, name = 'Trg bana J. Jelačića', place: string | null = 'jelacic', tiny = false): BoardSeries {
  const samples: BoardSeries['samples'] = [];
  const lines: [string, string][] = [['6', 'Črnomerec'], ['11', 'Dubec'], ['12', 'Ljubljanica']];
  const from = tiny ? zg(9, 28, 7, 30) : SNIMKA_WINDOW.fromSec;
  const to = tiny ? zg(9, 28, 8, 0) : SNIMKA_WINDOW.toSec;
  for (let sec = from; sec < to; sec += 300) {
    const hod = hourOfDay(sec);
    const night = hod < 4 || hod >= 23.5;
    samples.push({
      at: sec,
      status: 'timetable',
      next: night ? [] : lines.map(([route, headsign], k) => [route, headsign, sec + 180 * (k + 1) - (sec % 60)] as [string, string, number]),
    });
  }
  return { v: 2, stop, name, place, samples };
}

function buildBoards(objects: Objects): BoardRef[] {
  return BOARD_STOPS.map(([stop, name, place]) => {
    const board = buildBoard(stop, name, place, stop !== VOICE_PLACE);
    return { ...objects.json(`boards/${stop}`, board), stop, name, samples: board.samples.length };
  });
}

// ---- the voice (the companion's own sentence per minute) ----------------------------

/** A voice day file with a few dozen minutes filled around 07:30 to 08:15: Monday leads with the service fact, Thursday with a departure. */
export function buildVoiceDay(day: 'mon' | 'thu'): VoiceFile {
  const t0 = day === 'mon' ? zg(9, 28, 0, 0) : zg(10, 1, 0, 0);
  const n = 1440;
  const facts: VoiceFile['facts'] = day === 'mon'
    ? [
      { id: 'service:zet', kind: 'service', wording: 'silent', text: 'U pokretu su 2 vozila, po voznom redu oko 230.' },
      { id: 'bikes:total', kind: 'bikes', wording: null, text: 'Na stanicama je 1.500 bicikala.' },
    ]
    : [
      { id: 'dep:6:0752', kind: 'departure', wording: 'timetable', text: 'Tramvaj 6 prema Črnomercu polazi u 07:52.' },
      { id: 'service:zet', kind: 'service', wording: 'normal', text: 'Promet je uobičajen.' },
    ];
  const rows: VoiceFile['rows'] = [
    { id: 'dep-6', kind: 'departure', source: 'zet-timetable', live: day === 'thu', title: 'Tramvaj 6 prema Črnomercu', sub: 'vozni red', atSec: t0 + 7 * 3600 + 52 * 60, caveat: false },
    { id: 'weather', kind: 'weather', source: 'dhmz', live: true, title: 'Vedro, 14 °C', sub: 'Zagreb-Maksimir', atSec: null, caveat: false },
  ];
  const sentences = day === 'mon'
    ? ['U pokretu su 2 vozila, po voznom redu oko 230.', 'Na stanicama je 1.500 bicikala.']
    : ['Tramvaj 6 prema Črnomercu polazi u 07:52 po voznom redu.', 'Promet je uobičajen.'];
  const minutes: VoiceFile['minutes'] = new Array<VoiceFile['minutes'][number]>(n).fill(null);
  for (let m = 7 * 60 + 30; m <= 8 * 60 + 15; m++) {
    const alt = m % 3 === 2 ? 1 : 0;
    minutes[m] = {
      at: t0 + m * 60, f: [0, 1], r: [0, 1], lead: m === 7 * 60 + 45 ? 0 : alt,
      state: day === 'mon' ? 'silent' : 'normal', voice: day === 'mon' ? 'none' : 'all',
      seen: day === 'mon' ? 2 : 378, expected: day === 'mon' ? 230 : 396, note: null,
    };
  }
  return { v: 2, place: VOICE_PLACE, day: day === 'mon' ? '2026-09-28' : '2026-10-01', t0, step: 60, n, facts, rows, sentences, minutes };
}

function buildVoice(objects: Objects): HashedRef {
  const days: VoiceIndex['days'] = (['mon', 'thu'] as const).map((day) => {
    const file = buildVoiceDay(day);
    return { day: file.day, t0: file.t0, n: file.n, file: objects.json(`voice/${file.day}`, file) };
  });
  return objects.json('voice/index', { v: 2, place: VOICE_PLACE, days } satisfies VoiceIndex);
}

// ---- bikes and closures -----------------------------------------------------------

const STATIONS = 60;

export function buildStations(): StationsFile {
  return {
    v: 1,
    stations: Array.from({ length: STATIONS }, (_, i) => ({
      id: `bajs-${i + 1}`, name: `Stanica ${i + 1}`, lon: Math.round((15.93 + (i % 10) * 0.012) * 1e5) / 1e5, lat: Math.round((45.78 + Math.floor(i / 10) * 0.01) * 1e5) / 1e5, capacity: i % 7 === 0 ? null : 20,
    })),
  };
}

export function buildBajs(series: SeriesFile) {
  const r = rng(1866);
  const n = (SNIMKA_WINDOW.minutes * 60) / BAJS_STEP_S;
  const stations = buildStations().stations.map((s) => s.id);
  const matrix = stations.map((_, si) => {
    const row = new Uint8Array(n);
    for (let j = 0; j < n; j++) {
      const minute = (j * BAJS_STEP_S) / 60;
      const total = series.bikes!.total[minute];
      if (total === null) { row[j] = BAJS_MISSING; continue; }
      if (si === 6) { row[j] = BAJS_NOT_RENTING; continue; }
      const mean = total / STATIONS;
      row[j] = Math.max(0, Math.min(250, Math.round(mean * (0.4 + 1.2 * r()) - (si % 9 === 0 ? mean * 0.9 : 0))));
    }
    return row;
  });
  return encodeBajs(SNIMKA_WINDOW.fromSec, BAJS_STEP_S, stations, matrix);
}

export function buildClosures(): ClosuresFile {
  return {
    v: 1,
    versions: [
      { fromSec: SNIMKA_WINDOW.fromSec, toSec: zg(9, 28, 12, 0) },
      { fromSec: zg(9, 28, 12, 0), toSec: zg(9, 30, 9, 0) },
      { fromSec: zg(9, 30, 9, 0), toSec: null },
    ],
    closures: [
      { id: 1, street: 'Ilica', type: 'radovi', subtype: 'potpuno zatvaranje', direction: null, line: [[15.9603, 45.8131], [15.9668, 45.8129]], startSec: zg(9, 21, 6, 0) },
      { id: 2, street: 'Savska cesta', type: 'radovi', subtype: null, direction: 'prema jugu', line: [[15.9644, 45.8045], [15.9641, 45.7988], [15.9638, 45.7951]], startSec: zg(9, 14, 0, 0) },
      { id: 3, street: 'Maksimirska cesta', type: 'događanje', subtype: null, direction: null, line: [[16.0092, 45.8181], [16.0188, 45.8215]], startSec: zg(9, 28, 12, 0) },
      { id: 4, street: 'Ulica grada Vukovara', type: 'radovi', subtype: 'suženje', direction: null, line: [[15.9700, 45.7990], [15.9840, 45.8010]], startSec: null },
    ],
    byVersion: [
      [[0, zg(10, 15, 0, 0)], [1, null]],
      [[0, zg(10, 15, 0, 0)], [1, null], [2, zg(9, 30, 8, 0)], [3, null]],
      [[0, zg(10, 20, 0, 0)], [1, null], [3, null]],
    ],
  };
}

// ---- motion -----------------------------------------------------------------------

interface LoadedNetwork { ref: NetworkRef; net: GraphNetwork }

function loadNetwork(feed: '395' | '396'): LoadedNetwork {
  const bytes = readFileSync(join(ROOT, NETWORK_FILES[feed]));
  const raw = JSON.parse(bytes.toString('utf8')) as unknown;
  const net = decodeNetwork(raw);
  const hash = sha256(bytes);
  return { ref: { path: contentPath(`networks/zet-network-${net.feedVersion}`, hash, 'json'), bytes: bytes.length, sha256: hash, feedVersion: net.feedVersion, graphHash: net.graphHash, paths: net.paths.length, shapes: net.shapes.length }, net };
}

const TICKS_PER_VEHICLE = 2 * MOTION_TICKS; // two consecutive chunks
const MIN_PATH_LEN = 3000;

/** Three vehicles over two chunks on the network's longest tram paths of distinct routes, one bus on a bus shape, one free. */
function motionChunks(feed: '395' | '396', loaded: LoadedNetwork, starts: readonly number[], objects: Objects, skipAt: number | undefined): MotionIndex['chunks'] {
  const { net } = loaded;
  const paths = net.paths
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => p.len >= MIN_PATH_LEN)
    .sort((a, b) => b.p.len - a.p.len);
  const chosen: { idx: number; len: number; route: string }[] = [];
  for (const { p, idx } of paths) {
    if (chosen.some((c) => c.route === p.route)) continue;
    chosen.push({ idx, len: p.len, route: p.route });
    if (chosen.length === 3) break;
  }
  if (chosen.length < 3) throw new Error(`snimka fixture: network ${feed} has fewer than three tram paths over ${MIN_PATH_LEN} m`);
  const busShape = net.shapes.map((s, idx) => ({ s, idx })).filter(({ s }) => !s.edges && s.len >= MIN_PATH_LEN).sort((a, b) => b.s.len - a.s.len)[0] ?? null;
  const label = (route: string): string => net.routes.get(route)?.short ?? route;

  type Track = { id: string; route: string | null; label: string | null; kind: 0 | 3 | null; at: (tick: number) => MotionSample | null };
  const tracks: Track[] = chosen.map((c, i) => {
    const s0 = 100 + i * 150;
    const step = Math.min(70, Math.floor((c.len - s0 - 50) / TICKS_PER_VEHICLE));
    return {
      id: `v-${feed}-${i + 1}`, route: c.route, label: label(c.route), kind: 0,
      // The second vehicle sits out ticks 20 to 29 of the first chunk: a gap mid-chunk.
      at: (tick) => (i === 1 && tick >= 20 && tick < 30 ? null : { on: 0, idx: c.idx, s: s0 + step * tick }),
    };
  });
  if (busShape) {
    const step = Math.min(90, Math.floor((busShape.s.len - 150) / TICKS_PER_VEHICLE));
    tracks.push({ id: `v-${feed}-bus`, route: busShape.s.route, label: label(busShape.s.route), kind: 3, at: (tick) => ({ on: 1, idx: busShape.idx, s: 100 + step * tick }) });
  }
  tracks.push({ id: `v-${feed}-free`, route: null, label: null, kind: null, at: (tick) => ({ on: 2, idx: -1, lon: 15.9775 + tick * 0.00008, lat: 45.8125 - tick * 0.00004 }) });

  const chunks: MotionIndex['chunks'] = [];
  starts.forEach((t0, c) => {
    if (t0 === skipAt) return;
    const chunk: MotionChunk = encodeMotionChunk({
      net: feed, t0,
      vehicles: tracks.map((tr) => ({ id: tr.id, route: tr.route, label: tr.label, kind: tr.kind, samples: Array.from({ length: MOTION_TICKS }, (_, k) => tr.at(c * MOTION_TICKS + k)) })),
    });
    const local = new Date((t0 + ZAGREB_OFFSET_S) * 1000);
    const name = `motion/${feed}/${local.getUTCFullYear()}${String(local.getUTCMonth() + 1).padStart(2, '0')}${String(local.getUTCDate()).padStart(2, '0')}-${String(local.getUTCHours()).padStart(2, '0')}${String(local.getUTCMinutes()).padStart(2, '0')}`;
    const ref = objects.json(name, chunk);
    chunks.push({ path: ref.path, bytes: ref.bytes, net: feed, t0, vehicles: chunk.vehicles.length });
  });
  return chunks;
}

// ---- the downloads ----------------------------------------------------------------

const ATTRIBUTION: Attribution[] = [
  { id: 'zet', text: 'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669', url: 'http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669', licence: 'Open license', adaptation: 'Položaji vozila izvedeni su modelom kretanja aplikacije iz snimljenih GTFS-RT podataka u koraku od 10 sekundi; sirovi podaci ne objavljuju se.' },
  { id: 'zet-rss', text: 'Obavijesti ZET-a (RSS): naslov, datum i poveznica', url: 'https://www.zet.hr/', licence: 'uvjeti nisu objavljeni', adaptation: null },
  { id: 'nextbike', text: 'nextbike (BAJS), GBFS', url: 'https://www.nextbike.hr/', licence: 'CC0 1.0', adaptation: null },
  { id: 'zagreb-closures', text: 'Grad Zagreb, zatvorene prometnice', url: 'https://data.zagreb.hr/', licence: 'Otvorena dozvola', adaptation: null },
  { id: 'dhmz', text: 'DHMZ, postaja Zagreb-Maksimir', url: 'https://meteo.hr/', licence: 'Otvorena dozvola', adaptation: null },
  { id: 'news', text: 'Jutarnji list, Večernji list i N1: naslovi i poveznice uz navođenje izvora, bez teksta članaka', url: null, licence: 'navođenje naslova', adaptation: null },
  { id: 'osm', text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL', adaptation: 'Protomaps' },
  { id: 'kajima', text: 'Kaj ima?: snimke zaslona i objavljeni brojevi', url: 'https://zagreb.aningfilm.hr/', licence: 'AGPL-3.0-or-later', adaptation: null },
];

type ExportSpec = { name: string; format: ExportRef['format']; title: string; rows: number | null; description: string; columns: OpisFile['exports'][number]['columns']; body: string | unknown };
const MEDIA: Record<ExportRef['format'], ExportRef['mediaType']> = { csv: 'text/csv', json: 'application/json', geojson: 'application/geo+json' };

/** Nine downloads, tiny: a three-row series.csv, a two-feature closures.geojson, a small events.json, the rest one line, and the opis listing them. */
function buildExports(objects: Objects, events: EventsFile): { exports: ExportRef[]; opis: HashedRef } {
  const col = (name: string, type: 'int' | 'float' | 'text' | 'time' | 'bool', description: string, unit: string | null = null): NonNullable<OpisFile['exports'][number]['columns']>[number] => ({ name, type, unit, description });
  const tCols = [col('t_local', 'time', 'lokalno vrijeme, ISO 8601 s pomakom +02:00'), col('t_epoch', 'int', 'sekunde od 1970-01-01T00:00Z', 's')];
  const specs: ExportSpec[] = [
    { name: 'series', format: 'csv', title: 'Stanje usluge i vozila po minuti', rows: 3, description: 'Po minuti: vozila u pokretu i po voznom redu, stanje usluge, pouzdanost ZET-ovih podataka, bicikli, zatvorene ulice.',
      columns: [...tCols, col('seen_all', 'int', 'vozila u pokretu'), col('expected_all', 'int', 'vozila po voznom redu'), col('state', 'text', 'stanje usluge')],
      body: 't_local,t_epoch,seen_all,expected_all,state\n2026-09-28T07:45:00+02:00,1790574300,2,230,silent\n2026-09-28T07:46:00+02:00,1790574360,2,230,silent\n2026-09-28T07:47:00+02:00,1790574420,,230,silent\n' },
    { name: 'hourly', format: 'csv', title: 'Brojevi po satu', rows: 1, description: 'Po satu: temperatura, vrijeme, naslovi.', columns: [...tCols, col('temp_c', 'float', 'temperatura', '°C'), col('weather', 'text', 'riječ DHMZ-a')], body: 't_local,t_epoch,temp_c,weather\n2026-09-28T07:00:00+02:00,1790571600,12.5,vedro\n' },
    { name: 'routes-5min', format: 'csv', title: 'Vozila po liniji svakih pet minuta', rows: 1, description: 'Po liniji i petominutnom razmaku: vozila u pokretu i po voznom redu.', columns: [...tCols, col('route', 'text', 'GTFS id linije'), col('short_name', 'text', 'broj linije'), col('type', 'int', '0 tramvaj, 3 autobus'), col('seen', 'int', 'vozila u pokretu'), col('expected', 'int', 'vozila po voznom redu')], body: 't_local,t_epoch,route,short_name,type,seen,expected\n2026-09-29T10:00:00+02:00,1790668800,228,228,3,2,4\n' },
    { name: 'bikes-5min', format: 'csv', title: 'Bicikli po stanici svakih pet minuta', rows: 1, description: 'Po petominutnom razmaku: bicikala na svakoj stanici; prazno = bez podatka, nr = ne iznajmljuje.', columns: null, body: 't_local,t_epoch,bajs-1,bajs-2\n2026-09-28T07:45:00+02:00,1790574300,3,0\n' },
    { name: 'stations', format: 'csv', title: 'Stanice BAJS-a', rows: 1, description: 'Stanice s položajem i kapacitetom.', columns: [col('id', 'text', 'id stanice'), col('name', 'text', 'ime'), col('lon', 'float', 'zemljopisna dužina'), col('lat', 'float', 'zemljopisna širina'), col('capacity', 'int', 'mjesta')], body: 'id,name,lon,lat,capacity\nbajs-1,Stanica 1,15.93,45.78,\n' },
    { name: 'sentences', format: 'csv', title: 'Rečenice zaslona, zapisane i izračunane', rows: 1, description: 'Po minuti: zapis zaslona gdje postoji i rečenica današnjih pravila.', columns: [...tCols, col('observed', 'text', 'zapis zaslona'), col('replayed', 'text', 'rečenica današnjih pravila')], body: 't_local,t_epoch,observed,replayed\n2026-09-28T07:45:00+02:00,1790574300,"Tramvaj 6 prema Črnomercu polazi u 07:52 po voznom redu.","U pokretu su 2 vozila, po voznom redu oko 230."\n' },
    { name: 'events', format: 'json', title: 'Događaji snimke', rows: null, description: 'Poglavlja i događaji s izvorima.', columns: null, body: { v: 1, events: events.events.slice(0, 3) } },
    { name: 'closures', format: 'geojson', title: 'Zatvorene ulice po inačici skupa', rows: null, description: 'Jedna značajka po zatvaranju s krajem kako ga je svaka inačica objavila.', columns: null,
      body: JSON.stringify({ type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { id: 1, street: 'Ilica', ends: { 0: '2026-10-15T00:00:00+02:00' } }, geometry: { type: 'LineString', coordinates: [[15.9603, 45.8131], [15.9668, 45.8129]] } },
        { type: 'Feature', properties: { id: 2, street: 'Savska cesta', ends: { 0: null } }, geometry: { type: 'LineString', coordinates: [[15.9644, 45.8045], [15.9641, 45.7988]] } },
      ] }) },
  ];
  const refs: ExportRef[] = specs.map((s) => {
    const ref = typeof s.body === 'string' ? objects.text(`exports/${s.name}`, s.body, s.format) : objects.json(`exports/${s.name}`, s.body);
    return { ...ref, name: s.name, format: s.format, mediaType: MEDIA[s.format], title: s.title, rows: s.rows };
  });
  const opis: OpisFile = {
    v: 2, title: 'Snimka dana bez tramvaja, 27. rujna do 2. listopada 2026.: izvedeni podaci',
    licence: { text: 'Otvorena dozvola, uz navođenje izvora', url: 'https://data.gov.hr/otvorena-dozvola' },
    attribution: ATTRIBUTION,
    exports: refs.map((ref, i) => ({ ...ref, description: specs[i]!.description, columns: specs[i]!.columns })),
  };
  const opisRef = objects.json('exports/opis', opis);
  refs.push({ ...opisRef, name: 'opis', format: 'json', mediaType: 'application/json', title: 'Opis skupa', rows: null });
  return { exports: refs, opis: opisRef };
}

// ---- the manifest ----------------------------------------------------------------

export function buildSnimkaFixture(opts: SnimkaFixtureOptions = {}): SnimkaFixture {
  const objects = new Objects();
  const net396 = loadNetwork('396');
  const net395 = loadNetwork('395');
  const series = buildWindowSeries();
  const chunks = [
    ...motionChunks('396', net396, MARKS.motion396, objects, opts.missingChunkAt),
    ...motionChunks('395', net395, MARKS.motion395, objects, opts.missingChunkAt),
  ];
  const motionIndex: MotionIndex = { v: 2, step: MOTION_STEP_S, chunkSec: MOTION_CHUNK_S, chunks };
  const events = buildEvents();
  const { exports, opis } = buildExports(objects, events);
  const manifest: SnimkaManifest = {
    version: 2,
    builtAt: '2026-10-02T12:00:00.000Z',
    title: 'Tri dana bez tramvaja',
    build: { commit: 'fixture', inputs: { fixture: 'e2e/snimka-fixtures.ts' } },
    window: { ...SNIMKA_WINDOW, tz: 'Europe/Zagreb', utcOffsetMin: 120 },
    comparisons: SNIMKA_COMPARISONS.map((c) => ({
      ...c,
      files: { series: objects.json(`series/day-${c.id}`, buildComparisonSeries(c)), routes: objects.json(`routes/day-${c.id}`, buildComparisonRoutes(c)) },
      notes: c.id === 'cet-0924' ? ['Običan dan, četvrtak 24. rujna, nema snimljenih ZET-ovih podataka od ponoći do 02:00.'] : ['Običan ponedjeljak 21. rujna: u snimci nedostaju dva okvira.'],
    })),
    serviceLiveFromSec: MARKS.serviceLive,
    networks: { '395': net395.ref, '396': net396.ref },
    files: {
      series: objects.json('series', series),
      motionIndex: objects.json('motion/index', motionIndex),
      routes: objects.json('routes/window', buildRoutes()),
      stations: objects.json('stations', buildStations()),
      bajs: objects.json('bajs', buildBajs(series)),
      closures: objects.json('closures', buildClosures()),
      events: objects.json('events', events),
      notices: objects.json('notices', buildNotices()),
      news: objects.json('news', buildNews()),
      places: objects.json('places', buildPlaces()),
      screenIndex: buildScreen(objects),
      boards: buildBoards(objects),
      voiceIndex: buildVoice(objects),
      exports,
      opis,
      grid: null,
    },
    attribution: ATTRIBUTION,
    notes: [
      'Minutne serije počinju u nedjelju 27. rujna u 22:07; ranije minute nemaju objavljeni broj.',
      'Zapisivači su stali u srijedu 30. rujna od 22:41 do 22:54; snimka ZET-ovih podataka je potpuna.',
      'Snimka završava u petak 2. listopada u 12:00.',
    ],
  };
  return { manifest, objects: objects.map, noManifest: Boolean(opts.noManifest), marks: MARKS };
}

// ---- routing -----------------------------------------------------------------------

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' };
const IMMUTABLE = 'public, max-age=31536000, immutable';
const CONTENT_TYPES: Record<string, string> = { json: 'application/json; charset=utf-8', webp: 'image/webp', csv: 'text/csv; charset=utf-8', geojson: 'application/geo+json; charset=utf-8' };
const LATEST = /^exports\/latest\/([a-z0-9-]+)\.(csv|json|geojson)$/;

/** Answers every /api/snimka/v2/ request from the fixture: the manifest, the hashed objects with their content types, the two
 *  network files from disk, a 302 for exports/latest/<name>.<ext> to the hashed path, 404 for anything else (the v1 prefix included). */
export async function routeSnimka(page: Page, fixture: SnimkaFixture): Promise<void> {
  const networkPaths = new Map<string, string>([
    [fixture.manifest.networks['396'].path, NETWORK_FILES['396']],
    [fixture.manifest.networks['395'].path, NETWORK_FILES['395']],
  ]);
  await page.route('**/api/snimka/**', async (route) => {
    const url = new URL(route.request().url());
    const rest = url.pathname.startsWith(SNIMKA_API) ? url.pathname.slice(SNIMKA_API.length) : '';
    const notFound = (): Promise<void> => route.fulfill({ status: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'not found', path: url.pathname }) });
    if (!rest) return notFound();
    if (rest === 'manifest.json') {
      if (fixture.noManifest) return notFound();
      return route.fulfill({ status: 200, headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=60, s-maxage=300' }, body: JSON.stringify(fixture.manifest) });
    }
    const latest = LATEST.exec(rest);
    if (latest) {
      const found = fixture.manifest.files.exports.find((e) => e.name === latest[1] && e.format === latest[2]);
      if (!found) return notFound();
      return route.fulfill({ status: 302, headers: { location: `${SNIMKA_API}${found.path}`, 'cache-control': 'public, max-age=60, s-maxage=300', 'access-control-allow-origin': '*' }, body: '' });
    }
    const file = networkPaths.get(rest);
    if (file) return route.fulfill({ status: 200, headers: { ...JSON_HEADERS, 'cache-control': IMMUTABLE }, body: readFileSync(join(ROOT, file)) });
    const object = fixture.objects.get(rest);
    if (object === undefined) return notFound();
    const ext = rest.slice(rest.lastIndexOf('.') + 1);
    const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
    const headers = { 'content-type': contentType, 'access-control-allow-origin': '*', 'cache-control': IMMUTABLE };
    if (object instanceof Uint8Array) return route.fulfill({ status: 200, headers, body: Buffer.from(object) });
    if (typeof object === 'string') return route.fulfill({ status: 200, headers, body: object });
    return route.fulfill({ status: 200, headers, body: JSON.stringify(object) });
  });
}

// ---- the live card's one read (V5) ----------------------------------------------------

/** A minimal /api/teaser answer: the zet-rt module with its service verdict, as shared/city/service-state.ts reads it. */
function teaserBody(service: { state: 'normal' | 'reduced' | 'silent' | 'unknown'; seen: number; expected: number } | null, status: 'live' | 'down'): unknown {
  const now = '2026-10-02T12:00:00.000Z';
  const module = {
    module: 'zet-rt', tier: 'live', status, fetchedAt: now, sourceUpdatedAt: now,
    attribution: { text: 'Public dataset by ZET provided under Open license', url: 'http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669' },
    sources: service ? { zet: { status: 'live', sourceUpdatedAt: now, service: { state: service.state, since: '2026-10-02T05:00:00.000Z', expected: service.expected, seen: service.seen, ratio: Math.round((service.seen / service.expected) * 100) / 100, confidence: 0.9, baseline: 'declared', byMode: { tram: [Math.round(service.seen * 0.55), Math.round(service.expected * 0.55)], bus: [service.seen - Math.round(service.seen * 0.55), service.expected - Math.round(service.expected * 0.55)] } } } } : {},
    items: [],
  };
  return { generatedAt: now, modules: [module] };
}

/** /api/teaser answers a normal service: 380 vehicles in motion of 400 scheduled. */
export async function stubTeaserNormal(page: Page): Promise<void> {
  await page.route('**/api/teaser*', (route) => route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(teaserBody({ state: 'normal', seen: 380, expected: 400 }, 'live')) }));
}

/** /api/teaser answers with the zet-rt module down: no service verdict. */
export async function stubTeaserDown(page: Page): Promise<void> {
  await page.route('**/api/teaser*', (route) => route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(teaserBody(null, 'down')) }));
}
