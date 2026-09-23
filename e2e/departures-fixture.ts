// Fixture generators for the wall's timeline under a fake clock: a stop's
// departures board (the DepartureBoard of worker/city/schedules.ts
// departuresFrom, served at /api/city/departures) and its last-departure file
// (the shape of app/public/data/lastrun/<stopId>.json, served at
// /data/lastrun/<stopId>.json), both read at the scene's `now` so every
// scene of e2e/scenes.ts has departures to show (the rule of [O-65]: a
// departure row always exists, at 00:45 and at 04:30 too).
//
// The two agree with each other: each line runs from its first tram to its
// last departure in the last-run table, so the board never lists a tram the
// "last departures" row says has gone. Times are GTFS service-day times
// (Zagreb, hours past 24 belong to the night after the service date) and are
// resolved with worker/city/schedules.ts scheduleInstant, the board's own
// clock arithmetic.
//
// A live countdown needs a board row whose tripId a tracked vehicle carries
// (shared/city/arrivals.ts joins by trip id). `departuresBoard` therefore gives
// up to `tracked` of its rows the trip ids of the zet-rt fixture's `vehicle:`
// items (pass `vehicles`). Only vehicles on the stop's own lines are eligible,
// each is placed while it is being scheduled, in a slot within the live horizon
// where its own line runs, so a tracked row never breaks its line's service
// window. Their times use the scene-stamped vehicle observation, not the first
// poll's startup drift (the vehicles array retains that anchor across polls).
// Timetable rows use each line's first departure as a fixed service-day anchor,
// leaving room for the scene's tracked slots. Both kinds expire normally.
import east from '../app/public/data/lastrun/106_1.json';
import west from '../app/public/data/lastrun/106_2.json';
import busDeparture from '../app/public/data/lastrun/1849_23.json';
import busArrival from '../app/public/data/lastrun/1849_24.json';
import network from '../app/public/data/zet-network.json';
import type { DepartureBoard, ScheduledDeparture } from '../shared/city/types';
import type { FeedItem } from '../worker/feed/schema';
import { scheduleInstant, zagrebDay } from '../worker/city/schedules';
import { FIXTURE_STOP } from './experience-fixtures';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const PLATFORM_IDS = ['106_1', '106_2', '1849_23', '1849_24'] as const;
const TIMETABLES: Readonly<Record<string, LastRunFile>> = {
  '106_1': east as LastRunFile, '106_2': west as LastRunFile,
  '1849_23': busDeparture as LastRunFile, '1849_24': busArrival as LastRunFile,
};
// Daytime trams only: the scenes intentionally describe the gap after their
// last departures, not the separate night-line service (31/32/34).
const DAY_ROUTES = ['1', '6', '11', '12', '13', '14', '17'] as const;
const routesAt = (stopId: string): readonly string[] =>
  stopId === '1849_23' ? ['150'] : stopId === '1849_24' ? [] : DAY_ROUTES;
const timetableAt = (stopId: string): LastRunFile => TIMETABLES[stopId] ?? TIMETABLES[FIXTURE_STOP.id];

/** ZET's last departures from Trg bana Jelačića by line on a weekday (app/public/data/lastrun/106_1.json, 21 September 2026). */
export const FIXTURE_LAST_DEPARTURES: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(
  DAY_ROUTES.map((route) => [route, TIMETABLES['106_1'].routes[route]['2026-09-21']]),
));
/** Legacy fallback for a custom route without committed timetable data; not used for Trg's lines. */
export const FIXTURE_FIRST_TRAM = '04:16';
// Terminus platform ids corroborated by zet-trips.json patterns serving each
// platform. Read names from the network, as motion/vehicle-card.ts's terminus
// fallback does. nearby.ts renders a board's headsign verbatim, with no expansion
// of GTFS abbreviations, so the board must already carry the full network name.
const headsignsFor = (termini: Readonly<Record<string, string>>): Readonly<Record<string, string>> =>
  Object.freeze(Object.fromEntries(Object.entries(termini).map(([route, stop]) => {
    const name = network.stops.name[network.stops.id.indexOf(stop)];
    if (!name) throw new Error(`missing fixture terminus ${stop}`);
    return [route, name];
  })));
/** Directional headsigns for 106_1, byte-exact network terminus names. */
export const FIXTURE_HEADSIGNS: Readonly<Record<string, string>> = headsignsFor({ '1': '193_1', '6': '1794_12', '11': '206_11', '12': '209_12', '13': '236_13', '14': '177_3', '17': '193_1' });
const PLATFORM_HEADSIGNS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '106_1': FIXTURE_HEADSIGNS,
  '106_2': headsignsFor({ '1': '317_2', '6': '98_2', '11': '98_2', '12': '245_12', '13': '1781_11', '14': '1780_11', '17': '259_2' }),
  '1849_23': headsignsFor({ '150': '1840_23' }),
  // The return direction ends here; its committed last-run file is empty.
  '1849_24': {},
};
/** Rows a board carries (worker/city/schedules.ts DEPARTURES_ROWS). */
export const BOARD_ROWS = 12;
/** The first tracked row is due this long after the scene anchor. */
export const FIRST_ROW_AFTER_MS = 2 * MINUTE_MS;
/** The live horizon (shared/city/arrivals.ts HORIZON_MIN): a tracked trip due later is not given a countdown. */
export const LIVE_HORIZON_MS = 10 * MINUTE_MS;

/** 'HH:MM' in GTFS hours (24:15 is a quarter past midnight after the service date) to seconds. */
export function gtfsSeconds(time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) throw new Error(`not a GTFS time: ${time}`);
  return (Number(m[1]) * 60 + Number(m[2])) * 60;
}

const shiftDay = (day: string, days: number): string => {
  const [y, mo, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
};

/** The Zagreb service dates around `now`: `before` days back, `after` days ahead, oldest first. */
export function serviceDays(now: number, before = 1, after = 7): string[] {
  const today = zagrebDay(now);
  const out: string[] = [];
  for (let i = -before; i <= after; i++) out.push(shiftDay(today, i));
  return out;
}

export interface DeparturesBoardOptions {
  now: number;
  stopId?: string;
  stopName?: string;
  /** Average minutes between rows; each line runs every `headwayMin × routes.length` from its own first departure. */
  headwayMin?: number;
  routes?: readonly string[];
  headsigns?: Readonly<Record<string, string>>;
  /** How many rows within the live horizon take a tracked vehicle's trip id (default 2). */
  tracked?: number;
  /** The scene's stable zet-rt items array. Reuse it across polls; a new array starts an independent scene. */
  vehicles?: readonly Pick<FeedItem, 'id' | 'data'>[];
  /** Every line's last departure (GTFS 'HH:MM'); the per-line table FIXTURE_LAST_DEPARTURES when omitted. */
  serviceEnd?: string;
  /** Override every line's first tram; the committed per-line time when omitted. */
  firstTram?: string;
  lastDepartures?: Readonly<Record<string, string>>;
  rows?: number;
  status?: DepartureBoard['status'];
}

interface TrackedTrip { tripId: string; routeId: string; routeName: string }

/** The trips eligible for a board's live rows: `vehicle:` items with a trip id on one of the stop's own lines, in feed order, each trip once. */
export function trackedTrips(vehicles: readonly Pick<FeedItem, 'id' | 'data'>[], routes: readonly string[], count = Infinity): TrackedTrip[] {
  const seen = new Set<string>();
  const out: TrackedTrip[] = [];
  for (const v of vehicles) {
    if (out.length >= count) break;
    if (!v.id.startsWith('vehicle:') || typeof v.data?.tripId !== 'string' || v.data.tripId === '') continue;
    const routeId = String(v.data.routeId ?? '');
    if (!routes.includes(routeId) || seen.has(v.data.tripId)) continue;
    seen.add(v.data.tripId);
    out.push({ tripId: v.data.tripId, routeId, routeName: String(v.data.routeShortName ?? routeId) });
  }
  return out;
}

/** Exact dates where present; outside the committed horizon reuse the same weekday
 * (the phone's older scene is 11 September). Never fill a non-operating line's missing date. */
function timetableTime(stopId: string, field: 'routes' | 'first', routeId: string, day: string): string | undefined {
  const file = timetableAt(stopId);
  const dates = [...new Set(Object.values(file.routes).flatMap((row) => Object.keys(row)))].sort();
  const weekday = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();
  const sourceDay = dates.includes(day) ? day : dates.find((date) => weekday(date) === weekday(day));
  return sourceDay === undefined ? undefined : file[field]?.[routeId]?.[sourceDay];
}

// The unchanged wall/phone callers retain this array for the whole scene, even
// in the outage. Weak keys avoid leaking state across pages or parallel tests.
const SCENE_ANCHORS = new WeakMap<NonNullable<DeparturesBoardOptions['vehicles']>, number>();

function sceneAnchor(vehicles: NonNullable<DeparturesBoardOptions['vehicles']>, now: number): number {
  const held = SCENE_ANCHORS.get(vehicles);
  if (held !== undefined) return held;
  // installKioskFeedFixture stamps every vehicle at the pinned scene clock.
  // Legacy callers may pass only id/data, or the unrelocated September 11
  // parser snapshot: those retain the first-read fallback, never Date.now().
  const observed = vehicles.flatMap((v) => {
    const at = v.id.startsWith('vehicle:') && 'at' in v && typeof v.at === 'string' ? Date.parse(v.at) : NaN;
    return at <= now && now - at < DAY_MS ? [at] : [];
  });
  const anchor = observed.length ? Math.min(...observed) : now;
  SCENE_ANCHORS.set(vehicles, anchor);
  return anchor;
}

/** Fixed service-day departures plus up to two scene-anchored tracked trips.
 * Only freshness and the future-row window change on a later poll. */
export function departuresBoard(options: DeparturesBoardOptions): DepartureBoard {
  const now = options.now;
  const stopId = options.stopId ?? FIXTURE_STOP.id;
  const routes = options.routes ?? routesAt(stopId);
  const headwayMs = (options.headwayMin ?? 6) * MINUTE_MS;
  if (!Number.isFinite(headwayMs) || headwayMs <= 0) throw new Error('headwayMin must be positive');
  const headsigns = options.headsigns ?? PLATFORM_HEADSIGNS[stopId] ?? FIXTURE_HEADSIGNS;
  const wanted = options.rows ?? BOARD_ROWS;
  const timeOf = (field: 'routes' | 'first', routeId: string, day: string): string | undefined => {
    const override = field === 'first' ? options.firstTram : options.serviceEnd ?? options.lastDepartures?.[routeId];
    if (override !== undefined) return override;
    const committed = timetableTime(stopId, field, routeId, day);
    if (committed !== undefined || routeId in timetableAt(stopId).routes) return committed;
    return field === 'first' ? FIXTURE_FIRST_TRAM : '24:00';
  };
  const window = (routeId: string, day: string): [number, number] | null => {
    const first = timeOf('first', routeId, day);
    const last = timeOf('routes', routeId, day);
    return first === undefined || last === undefined ? null : [scheduleInstant(day, gtfsSeconds(first)), scheduleInstant(day, gtfsSeconds(last))];
  };
  const days = serviceDays(now, 1, 2);
  const row = (routeId: string, at: number, tripId: string, routeName = routeId): ScheduledDeparture => ({
    operator: 'zet', tripId, routeId, routeName, headsign: headsigns[routeId] ?? '', at: new Date(at).toISOString(),
  });
  const departures: ScheduledDeparture[] = [];
  let reservedFrom = Infinity;
  let reservedThrough = -Infinity;

  // The fixture's tracked vehicles belong to 106_1, not simultaneously to the
  // opposite direction or the bus terminal. Synthetic custom stops retain the
  // previous opt-in via vehicles/routes.
  if (options.vehicles && !['106_2', '1849_23', '1849_24'].includes(stopId)) {
    const anchor = sceneAnchor(options.vehicles, now);
    const pending = trackedTrips(options.vehicles, routes);
    let left = Math.max(0, options.tracked ?? 2);
    const sceneDays = serviceDays(anchor, 1, 1);
    for (let offset = FIRST_ROW_AFTER_MS; left > 0 && offset <= LIVE_HORIZON_MS; offset += headwayMs) {
      const at = anchor + offset;
      const i = pending.findIndex((trip) => sceneDays.some((day) => {
        const bounds = window(trip.routeId, day);
        return bounds !== null && at >= bounds[0] && at <= bounds[1];
      }));
      if (i >= 0) {
        const [trip] = pending.splice(i, 1);
        left--;
        reservedFrom = anchor;
        reservedThrough = at;
        if (at >= now) departures.push(row(trip.routeId, at, trip.tripId, trip.routeName || trip.routeId));
      }
    }
  }

  for (const day of days) for (const routeId of routes) {
    const bounds = window(routeId, day);
    if (!bounds) continue;
    const [first, last] = bounds;
    const period = headwayMs * routes.length;
    const slot = Math.max(0, Math.ceil((now - first) / period));
    for (let n = slot; n < slot + wanted && first + n * period <= last; n++) {
      const at = first + n * period;
      // These interior grid times are synthetic, not committed departures.
      // Reserve this platform's initial slots for its tracked trips so grid
      // fillers do not hide them in the wall's real three-row selection.
      // Never suppress a committed first/last boundary, nor move the reserved
      // interval as polls advance and the tracked trips leave.
      if (at >= reservedFrom && at <= reservedThrough && at !== first && at !== last) continue;
      departures.push(row(routeId, at, `fixture-${stopId}-${routeId}-${new Date(at).toISOString()}`));
    }
  }

  return {
    operator: 'zet',
    stopId,
    stopName: options.stopName ?? (PLATFORM_IDS.some((id) => id === stopId) ? FIXTURE_STOP.name : stopId),
    status: options.status ?? 'live',
    generatedAt: new Date(now).toISOString(),
    validUntil: new Date(now + 7 * DAY_MS).toISOString(),
    departures: departures.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.tripId.localeCompare(b.tripId)).slice(0, wanted),
  };
}

/** app/public/data/lastrun/<stopId>.json as scripts/gtfs-lastrun.mjs writes it, with WP1's optional `first` sibling. */
export interface LastRunFile {
  generatedAt: string;
  validUntil: string;
  source: 'ZET GTFS';
  /** routeId → service date → last departure 'HH:MM' (GTFS hours). */
  routes: Record<string, Record<string, string>>;
  /** routeId → service date → first departure 'HH:MM'. */
  first?: Record<string, Record<string, string>>;
}

export interface LastRunOptions {
  routes?: readonly string[];
  lastDepartures?: Readonly<Record<string, string>>;
  firstTram?: string;
  /** False leaves `first` out (a file cut before WP1). */
  withFirst?: boolean;
}

/** The stop's last-departure file for the given service dates, consistent with `departuresBoard`. */
export function lastRunSnapshot(stopId: string, days: readonly string[], options: LastRunOptions = {}): LastRunFile {
  if (days.length === 0) throw new Error('lastRunSnapshot needs at least one service date');
  const routes = options.routes ?? (options.lastDepartures ? Object.keys(options.lastDepartures) : routesAt(stopId));
  const table = (field: 'routes' | 'first'): Record<string, Record<string, string>> =>
    Object.fromEntries(routes.map((routeId) => [routeId, Object.fromEntries(days.flatMap((day) => {
      const override = field === 'first' ? options.firstTram : options.lastDepartures?.[routeId];
      const time = override ?? timetableTime(stopId, field, routeId, day);
      if (time !== undefined) return [[day, time]];
      if (routeId in timetableAt(stopId).routes) return [];
      return [[day, field === 'first' ? FIXTURE_FIRST_TRAM : '24:00']];
    }))]));
  const sorted = [...days].sort();
  return {
    generatedAt: new Date(scheduleInstant(sorted[0], 0) - 6 * 3_600_000).toISOString(),
    validUntil: new Date(scheduleInstant(sorted[sorted.length - 1], 30 * 3600)).toISOString(),
    source: 'ZET GTFS',
    routes: table('routes'),
    ...(options.withFirst === false ? {} : { first: table('first') }),
  };
}
