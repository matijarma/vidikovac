// A synthetic, contract-exact dataset for the /snimka/ specs, built with the
// real codec (shared/snimka-codec.ts) and hashed the way the pipeline hashes,
// so a fixture can never hold a shape the page would not accept. Nothing in
// it is a recording: the numbers follow the strike's outline (a fleet of
// about 170 on Sunday evening, under six from Monday 02:00, back to about
// 230 on Wednesday 20:30) only so that the page's logic has something to
// show. Deterministic: a small LCG, no Math.random, no clock.
//
// S2 and S3 may extend it additively (a new option, a new object), never
// change what is here.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { decodeNetwork, type GraphNetwork } from '../shared/motion/network';
import {
  BAJS_STEP_S, MOTION_CHUNK_S, MOTION_STEP_S, MOTION_TICKS, SNIMKA_API, SNIMKA_COMPARISON, SNIMKA_WINDOW, ZAGREB_OFFSET_S,
  type BoardSeries, type ClosuresFile, type Col, type EventsFile, type HashedRef, type MotionChunk, type MotionIndex, type NetworkRef,
  type NewsFile, type NoticesFile, type ScreenIndex, type ScreenReading, type ScreenRow, type ScreenRun, type SeriesFile, type SnimkaEvent,
  type SnimkaManifest, type SnimkaState, type StationsFile,
} from '../shared/snimka';
import { BAJS_MISSING, BAJS_NOT_RENTING, contentPath, encodeBajs, encodeMotionChunk, type MotionSample } from '../shared/snimka-codec';

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
  /** Every hashed object by its manifest path: parsed JSON, or bytes for a capture. */
  objects: Map<string, unknown | Uint8Array>;
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
  monday0745: zg(9, 28, 7, 45),
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
  windowEnd: SNIMKA_WINDOW.toSec,
  comparisonStart: SNIMKA_COMPARISON.fromSec,
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
  readonly map = new Map<string, unknown | Uint8Array>();
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

interface Minute {
  seen: number | null; expected: number; state: SnimkaState; since: number; hold: SeriesFile['service']['hold'][number];
  headerAgeS: number | null; entities: number | null; rejectedFuture: number | null; hiddenDepot: number | null; hiddenParked: number | null;
  published: { vehicles: number | null; itemCount: number | null; status: 'live' | 'stale' | 'down' | null; service: SnimkaState | null } | null;
  bikesTotal: number | null; bikesEmpty: number | null; reporting: number | null; closuresActive: number | null; closuresVersion: number | null;
}

/** One minute of the window, following the strike's outline. */
function windowMinute(sec: number, r: () => number): Minute {
  const hod = hourOfDay(sec);
  const expected = Math.round(normalFleet(hod));
  let seen: number | null;
  let state: SnimkaState;
  let since: number;
  if (sec < MARKS.depots) { seen = Math.round(normalFleet(hod) * 1.02); state = 'normal'; since = MARKS.windowStart; }
  else if (sec < MARKS.silentFrom) { seen = Math.round(18 - (13 * (sec - MARKS.depots)) / (MARKS.silentFrom - MARKS.depots)); state = 'reduced'; since = MARKS.depots; }
  else if (sec < MARKS.returnFrom) { seen = sec >= MARKS.feedEmptyFrom && sec < MARKS.feedFrozenFrom ? 0 : (Math.floor((sec - MARKS.silentFrom) / 420) % 6); state = 'silent'; since = MARKS.silentFrom; }
  else if (sec < MARKS.reducedAt) { seen = Math.round(2 + (90 * (sec - MARKS.returnFrom)) / (MARKS.reducedAt - MARKS.returnFrom)); state = 'silent'; since = MARKS.silentFrom; }
  else if (sec < MARKS.normalAt) { seen = Math.round(92 + (120 * (sec - MARKS.reducedAt)) / (MARKS.normalAt - MARKS.reducedAt)); state = 'reduced'; since = MARKS.reducedAt; }
  else { seen = Math.round(Math.max(normalFleet(hod), sec < zg(9, 30, 21, 0) ? 212 + (18 * (sec - MARKS.normalAt)) / 600 : 0)); state = 'normal'; since = MARKS.normalAt; }
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
  const recorderGap = sec >= MARKS.recorderGapFrom && sec < MARKS.recorderGapTo;
  const noPublished = sec < MARKS.seriesStart || recorderGap;
  const ghost = sec >= zg(9, 28, 17, 0) && sec < zg(9, 28, 21, 0) ? 5 : 0;
  const published = noPublished ? null : {
    vehicles: (seen ?? 0) + ghost,
    itemCount: 28 + Math.floor(r() * 6),
    status: frozen ? ('stale' as const) : ('live' as const),
    service: sec >= MARKS.serviceLive ? state : null,
  };
  // Bikes drain from Sunday to Wednesday noon and come back by Thursday morning.
  const drainTo = zg(9, 30, 12, 0);
  const bikesTotal = noPublished ? null : sec < drainTo ? Math.round(1866 - (1332 * (sec - MARKS.windowStart)) / (drainTo - MARKS.windowStart)) : Math.round(534 + (366 * (sec - drainTo)) / (MARKS.windowEnd - drainTo));
  const bikesEmpty = noPublished ? null : sec < drainTo ? Math.round(5 + (105 * (sec - MARKS.windowStart)) / (drainTo - MARKS.windowStart)) : Math.round(110 - (70 * (sec - drainTo)) / (MARKS.windowEnd - drainTo));
  const closuresVersion = noPublished ? null : sec < zg(9, 28, 12, 0) ? 0 : sec < zg(9, 30, 9, 0) ? 1 : 2;
  const closuresActive = closuresVersion === null ? null : [12, 14, 13][closuresVersion]!;
  return {
    seen, expected, state, since, hold, headerAgeS, entities, rejectedFuture, hiddenDepot, hiddenParked, published,
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
    cols.pubVehicles.push(m.published?.vehicles ?? null); cols.pubItems.push(m.published?.itemCount ?? null); cols.pubStatus.push(m.published?.status ?? null); cols.pubService.push(m.published?.service ?? null);
    cols.bikesTotal.push(m.bikesTotal); cols.bikesEmpty.push(m.bikesEmpty); cols.reporting.push(m.reporting); cols.closuresActive.push(m.closuresActive); cols.closuresVersion.push(m.closuresVersion);
  }
  return {
    v: 1, t0, step: 60, n,
    seen: { all: cols.seenAll, tram: cols.seenTram, bus: cols.seenBus },
    expected: { all: cols.expAll, tram: cols.expTram, bus: cols.expBus },
    service: { state: cols.state, since: cols.since, ratio: cols.ratio, hold: cols.hold },
    feed: { headerAgeS: cols.headerAgeS, entities: cols.entities, rejectedFuture: cols.rejectedFuture, hiddenDepot: cols.hiddenDepot, hiddenParked: cols.hiddenParked },
    published: { vehicles: cols.pubVehicles, itemCount: cols.pubItems, status: cols.pubStatus, service: cols.pubService },
    bikes: { total: cols.bikesTotal, empty: cols.bikesEmpty, reporting: cols.reporting },
    closures: { active: cols.closuresActive, version: cols.closuresVersion },
    hourly: hourly(t0, n / 60, true, r),
  };
}

export function buildComparisonSeries(): SeriesFile {
  const r = rng(24);
  const n = SNIMKA_COMPARISON.minutes;
  const t0 = SNIMKA_COMPARISON.fromSec;
  const seenAll: Col<number> = []; const seenTram: Col<number> = []; const seenBus: Col<number> = [];
  const expAll: Col<number> = []; const expTram: Col<number> = []; const expBus: Col<number> = [];
  const ratio: Col<number> = [];
  const headerAgeS: Col<number> = []; const entities: Col<number> = [];
  for (let i = 0; i < n; i++) {
    const sec = t0 + i * 60;
    const expected = Math.round(normalFleet(hourOfDay(sec)));
    const seen = Math.round(expected * (0.96 + r() * 0.08));
    const [tram, bus] = split(seen, 0.55);
    const [eTram, eBus] = split(expected, 0.55);
    seenAll.push(seen); seenTram.push(tram); seenBus.push(bus);
    expAll.push(expected); expTram.push(eTram); expBus.push(eBus);
    ratio.push(Math.round((seen / Math.max(1, expected)) * 100) / 100);
    headerAgeS.push(10 + Math.floor(r() * 10)); entities.push(seen + 50);
  }
  const fill = <T,>(value: T): Col<T> => new Array<T>(n).fill(value);
  return {
    v: 1, t0, step: 60, n,
    seen: { all: seenAll, tram: seenTram, bus: seenBus },
    expected: { all: expAll, tram: expTram, bus: expBus },
    service: { state: fill<SnimkaState>('normal'), since: fill(t0), ratio, hold: fill(null) },
    feed: { headerAgeS, entities, rejectedFuture: fill(0), hiddenDepot: fill(40), hiddenParked: fill(10) },
    published: null, bikes: null, closures: null,
    hourly: hourly(t0, 24, false, r),
  };
}

// ---- events, notices, news ---------------------------------------------------

const ZET = (id: number): { label: string; url: string } => ({ label: `ZET, obavijest ${id}`, url: `https://www.zet.hr/obavijesti/${id}` });
const PRESS = { label: 'Jutarnji list', url: 'https://www.jutarnji.hr/' };

export function buildEvents(): EventsFile {
  const chapter = (id: string, atSec: number, kind: SnimkaEvent['kind'], title: string, sources: SnimkaEvent['sources'], derived = false, text: string | null = null): SnimkaEvent =>
    ({ id, atSec, kind, title, text, sources, derived, chapter: true });
  const events: SnimkaEvent[] = [
    chapter('vecer-prije', MARKS.windowStart, 'recording', 'Večer prije', []),
    chapter('spremista', MARKS.depots, 'service', 'Vozila se povlače u spremišta', [], true, 'Manje od dvadeset vozila u pokretu.'),
    chapter('pocetak', MARKS.strikeStart, 'zet', 'Početak štrajka', [ZET(10164), PRESS]),
    chapter('prvo-jutro', MARKS.monday0745, 'recording', 'Prvo jutro', []),
    chapter('bez-vozila', MARKS.feedEmptyFrom, 'zet', 'ZET šalje podatke bez ijednog vozila', [], true),
    chapter('zamrznuto', MARKS.feedFrozenFrom, 'zet', 'ZET-ovi podaci se ne mijenjaju', [], true),
    chapter('linija-228', MARKS.line228, 'zet', 'Autobusna linija 228 do Rebra', [ZET(10166)]),
    chapter('stanje-usluge', MARKS.serviceLive, 'recording', 'Aplikacija dobiva stanje usluge', []),
    chapter('trece-jutro', MARKS.wednesday0745, 'recording', 'Treće jutro', []),
    chapter('sud', MARKS.court, 'court', 'Sud: štrajk u ZET-u nije zakonit', [PRESS, ZET(10167)]),
    chapter('povratak', MARKS.returnFrom, 'return', 'Vozila se vraćaju', [], true),
    chapter('uobicajeno', MARKS.normalAt, 'service', 'Uobičajeno stanje', [], true),
    chapter('cetvrto-jutro', MARKS.thursday0745, 'recording', 'Prvo uobičajeno jutro', []),
    { id: 'zapisivaci', atSec: MARKS.recorderGapFrom, kind: 'recording', title: 'Zapisivači su stali na trinaest minuta', text: 'Objavljeni brojevi nedostaju od 22:41 do 22:54; snimka ZET-ovih podataka je potpuna.', sources: [], derived: false, chapter: false },
  ];
  return { v: 1, events };
}

export function buildNotices(): NoticesFile {
  return {
    v: 1,
    items: [
      { id: 10164, title: 'Obavijest o prometu tramvaja i autobusa od ponedjeljka 28. rujna', text: null, link: 'https://www.zet.hr/obavijesti/10164', pubSec: zg(9, 27, 16, 27) },
      { id: 10166, title: 'Autobusna linija 228 do Rebra', text: 'Od 10 sati vozi autobusna linija 228 između Kaptola i Rebra.', link: 'https://www.zet.hr/obavijesti/10166', pubSec: MARKS.line228 },
    ],
  };
}

export function buildNews(): NewsFile {
  return {
    v: 1,
    outlets: {
      jutarnji: { name: 'Jutarnji list', home: 'https://www.jutarnji.hr/' },
      vecernji: { name: 'Večernji list', home: 'https://www.vecernji.hr/' },
      n1: { name: 'N1', home: 'https://n1info.hr/' },
    },
    items: [
      { id: 'j1', outlet: 'jutarnji', title: 'Zagreb bez tramvaja i autobusa: kako su građani stigli na posao', link: 'https://www.jutarnji.hr/vijesti/zagreb/primjer-1', pubSec: zg(9, 28, 6, 10), beat: 'početak' },
      { id: 'v1', outlet: 'vecernji', title: 'ZET uveo autobusnu liniju do Rebra', link: 'https://www.vecernji.hr/zagreb/primjer-2', pubSec: zg(9, 29, 10, 30), beat: 'ZET-obavijest' },
      { id: 'n1', outlet: 'n1', title: 'Sud presudio: obustava rada u ZET-u nije zakonita', link: 'https://n1info.hr/vijesti/primjer-3', pubSec: zg(9, 30, 11, 20), beat: 'sud' },
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

export function buildBoard(): BoardSeries {
  const samples: BoardSeries['samples'] = [];
  const lines: [string, string][] = [['6', 'Črnomerec'], ['11', 'Dubec'], ['12', 'Ljubljanica']];
  for (let sec = SNIMKA_WINDOW.fromSec; sec < SNIMKA_WINDOW.toSec; sec += 300) {
    const hod = hourOfDay(sec);
    const night = hod < 4 || hod >= 23.5;
    samples.push({
      at: sec,
      status: 'timetable',
      next: night ? [] : lines.map(([route, headsign], k) => [route, headsign, sec + 180 * (k + 1) - (sec % 60)] as [string, string, number]),
    });
  }
  return { v: 1, stop: '106_1', name: 'Trg bana J. Jelačića', samples };
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
    chunks.push({ path: ref.path, sha256: ref.sha256, bytes: ref.bytes, net: feed, t0, vehicles: chunk.vehicles.length });
  });
  return chunks;
}

// ---- the manifest ----------------------------------------------------------------

export function buildSnimkaFixture(opts: SnimkaFixtureOptions = {}): SnimkaFixture {
  const objects = new Objects();
  const net396 = loadNetwork('396');
  const net395 = loadNetwork('395');
  const series = buildWindowSeries();
  const comparison = buildComparisonSeries();
  const chunks = [
    ...motionChunks('396', net396, MARKS.motion396, objects, opts.missingChunkAt),
    ...motionChunks('395', net395, MARKS.motion395, objects, opts.missingChunkAt),
  ];
  const motionIndex: MotionIndex = { v: 1, step: MOTION_STEP_S, chunkSec: MOTION_CHUNK_S, chunks };
  const manifest: SnimkaManifest = {
    version: 1,
    builtAt: '2026-10-01T12:00:00.000Z',
    title: 'Tri dana bez tramvaja',
    build: { commit: 'fixture', inputs: { fixture: 'e2e/snimka-fixtures.ts' } },
    window: { ...SNIMKA_WINDOW, tz: 'Europe/Zagreb', utcOffsetMin: 120 },
    comparison: { ...SNIMKA_COMPARISON },
    serviceLiveFromSec: MARKS.serviceLive,
    networks: { '395': net395.ref, '396': net396.ref },
    files: {
      series: objects.json('series', series),
      comparisonSeries: objects.json('series-2026-09-24', comparison),
      motionIndex: objects.json('motion/index', motionIndex),
      stations: objects.json('stations', buildStations()),
      bajs: objects.json('bajs', buildBajs(series)),
      closures: objects.json('closures', buildClosures()),
      events: objects.json('events', buildEvents()),
      notices: objects.json('notices', buildNotices()),
      news: objects.json('news', buildNews()),
      screenIndex: buildScreen(objects),
      board106: objects.json('board-106-1', buildBoard()),
      grid: null,
    },
    attribution: [
      { id: 'zet', text: 'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669', url: 'http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669', licence: 'Open license', adaptation: 'Položaji vozila izvedeni su modelom kretanja aplikacije iz snimljenih GTFS-RT podataka u koraku od 10 sekundi; sirovi podaci ne objavljuju se.' },
      { id: 'zet-rss', text: 'Obavijesti ZET-a (RSS): naslov, datum i poveznica', url: 'https://www.zet.hr/', licence: 'uvjeti nisu objavljeni', adaptation: null },
      { id: 'nextbike', text: 'nextbike (BAJS), GBFS', url: 'https://www.nextbike.hr/', licence: 'CC0 1.0', adaptation: null },
      { id: 'zagreb-closures', text: 'Grad Zagreb, zatvorene prometnice', url: 'https://data.zagreb.hr/', licence: 'Otvorena dozvola', adaptation: null },
      { id: 'dhmz', text: 'DHMZ, postaja Zagreb-Maksimir', url: 'https://meteo.hr/', licence: 'Otvorena dozvola', adaptation: null },
      { id: 'news', text: 'Jutarnji list, Večernji list i N1: naslovi i poveznice uz navođenje izvora, bez teksta članaka', url: null, licence: 'navođenje naslova', adaptation: null },
      { id: 'osm', text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL', adaptation: 'Protomaps' },
      { id: 'kajima', text: 'Kaj ima?: snimke zaslona i objavljeni brojevi', url: 'https://zagreb.aningfilm.hr/', licence: 'AGPL-3.0-or-later', adaptation: null },
    ],
    notes: [
      'Minutne serije počinju u nedjelju 27. rujna u 22:07; ranije minute nemaju objavljeni broj.',
      'Zapisivači su stali u srijedu 30. rujna od 22:41 do 22:54; snimka ZET-ovih podataka je potpuna.',
    ],
  };
  return { manifest, objects: objects.map, noManifest: Boolean(opts.noManifest), marks: MARKS };
}

// ---- routing -----------------------------------------------------------------------

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' };

/** Answers every /api/snimka/v1/ request from the fixture: the manifest, the hashed objects, the two network files from disk, 404 for anything else. */
export async function routeSnimka(page: Page, fixture: SnimkaFixture): Promise<void> {
  const networkPaths = new Map<string, string>([
    [fixture.manifest.networks['396'].path, NETWORK_FILES['396']],
    [fixture.manifest.networks['395'].path, NETWORK_FILES['395']],
  ]);
  await page.route('**/api/snimka/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const rest = url.pathname.startsWith(SNIMKA_API) ? url.pathname.slice(SNIMKA_API.length) : '';
    const notFound = (): Promise<void> => route.fulfill({ status: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'not found', path: rest }) });
    if (rest === 'manifest.json') {
      if (fixture.noManifest) return notFound();
      return route.fulfill({ status: 200, headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=60, s-maxage=300' }, body: JSON.stringify(fixture.manifest) });
    }
    const file = networkPaths.get(rest);
    if (file) return route.fulfill({ status: 200, headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=31536000, immutable' }, body: readFileSync(join(ROOT, file)) });
    const object = fixture.objects.get(rest);
    if (object === undefined) return notFound();
    if (object instanceof Uint8Array) {
      return route.fulfill({ status: 200, headers: { 'content-type': rest.endsWith('.webp') ? 'image/webp' : 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=31536000, immutable' }, body: Buffer.from(object) });
    }
    return route.fulfill({ status: 200, headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=31536000, immutable' }, body: JSON.stringify(object) });
  });
}
