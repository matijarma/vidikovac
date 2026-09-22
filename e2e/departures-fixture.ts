// Fixture generators for the wall's timeline under a fake clock: a stop's
// departures board (the DepartureBoard of worker/city/schedules.ts
// departuresFrom, served at /api/city/departures) and its last-departure file
// (the shape of app/public/data/lastrun/<stopId>.json, served at
// /data/lastrun/<stopId>.json), both computed from the scene's `now` so every
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
// window; a live badge is possible for those rows only (the rows at now + 2 and
// now + 8 minutes with the default headway, when both lines run).
import type { DepartureBoard, ScheduledDeparture } from '../shared/city/types';
import type { FeedItem } from '../worker/feed/schema';
import { scheduleInstant, zagrebDay } from '../worker/city/schedules';
import { FIXTURE_STOP } from './experience-fixtures';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** ZET's last departures from Trg bana Jelačića by line on a weekday (app/public/data/lastrun/106_1.json, 21 September 2026). */
export const FIXTURE_LAST_DEPARTURES: Readonly<Record<string, string>> = Object.freeze({ '6': '24:27', '11': '24:09', '12': '23:45', '13': '24:30', '14': '24:31', '17': '24:01' });
/** The first tram of a service day, every line. */
export const FIXTURE_FIRST_TRAM = '04:16';
/** A plausible terminus per line, as the board's headsign. Fixture data, not interface copy. */
export const FIXTURE_HEADSIGNS: Readonly<Record<string, string>> = Object.freeze({ '6': 'Sopot', '11': 'Dubec', '12': 'Dubrava', '13': 'Žitnjak', '14': 'Zapruđe', '17': 'Borongaj' });
/** Rows a board carries (worker/city/schedules.ts DEPARTURES_ROWS). */
export const BOARD_ROWS = 12;
/** The first row is due this long after now. */
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
  /** Minutes between consecutive rows (across lines); each line runs every `headwayMin × routes.length`. */
  headwayMin?: number;
  routes?: readonly string[];
  headsigns?: Readonly<Record<string, string>>;
  /** How many rows within the live horizon take a tracked vehicle's trip id (default 2). */
  tracked?: number;
  /** The zet-rt snapshot's items: `vehicle:` items with `data.tripId` give the tracked rows their trip ids. */
  vehicles?: readonly Pick<FeedItem, 'id' | 'data'>[];
  /** Every line's last departure (GTFS 'HH:MM'); the per-line table FIXTURE_LAST_DEPARTURES when omitted. */
  serviceEnd?: string;
  /** Every line's first tram; FIXTURE_FIRST_TRAM when omitted. */
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

/**
 * A stop's departures board at `now`: `rows` future departures on a grid of `headwayMin`
 * starting at now + 2 min, each line inside its own service window (first tram to last
 * departure), so after the last tram the rows are the next morning's from the first tram.
 */
export function departuresBoard(options: DeparturesBoardOptions): DepartureBoard {
  const now = options.now;
  const stopId = options.stopId ?? FIXTURE_STOP.id;
  const routes = options.routes ?? FIXTURE_STOP.routes;
  const headwayMs = (options.headwayMin ?? 6) * MINUTE_MS;
  const headsigns = options.headsigns ?? FIXTURE_HEADSIGNS;
  const wanted = options.rows ?? BOARD_ROWS;
  const lastOf = (routeId: string): number => gtfsSeconds(options.serviceEnd ?? options.lastDepartures?.[routeId] ?? FIXTURE_LAST_DEPARTURES[routeId] ?? '24:00');
  const firstOf = (): number => gtfsSeconds(options.firstTram ?? FIXTURE_FIRST_TRAM);
  const days = serviceDays(now, 1, 2);
  const running = (routeId: string, at: number): boolean =>
    days.some((day) => at >= scheduleInstant(day, firstOf()) && at <= scheduleInstant(day, lastOf(routeId)));

  // Tracked trips are chosen before scheduling and placed slot by slot: a slot within the live horizon takes
  // the first eligible trip whose own line runs at that moment; every other slot takes the next line in turn.
  // Either way the row's line is checked against its service window before it is pushed.
  const pending = trackedTrips(options.vehicles ?? [], routes);
  let trackedLeft = Math.max(0, options.tracked ?? 2);
  const departures: ScheduledDeparture[] = [];
  const anchor = now + FIRST_ROW_AFTER_MS;
  const limit = now + 2 * DAY_MS;
  for (let m = 0; departures.length < wanted && anchor + m * headwayMs <= limit; m++) {
    const at = anchor + m * headwayMs;
    const stamp = new Date(at).toISOString();
    if (trackedLeft > 0 && at - now <= LIVE_HORIZON_MS) {
      const i = pending.findIndex((trip) => running(trip.routeId, at));
      if (i >= 0) {
        const [trip] = pending.splice(i, 1);
        trackedLeft--;
        departures.push({ operator: 'zet', tripId: trip.tripId, routeId: trip.routeId, routeName: trip.routeName || trip.routeId, headsign: headsigns[trip.routeId] ?? '', at: stamp });
        continue;
      }
    }
    const routeId = routes[m % routes.length];
    if (!running(routeId, at)) continue;
    departures.push({ operator: 'zet', tripId: `fixture-${stopId}-${routeId}-${stamp.slice(0, 16)}`, routeId, routeName: routeId, headsign: headsigns[routeId] ?? '', at: stamp });
  }

  return {
    operator: 'zet',
    stopId,
    stopName: options.stopName ?? (stopId === FIXTURE_STOP.id ? FIXTURE_STOP.name : stopId),
    status: options.status ?? 'live',
    generatedAt: new Date(now).toISOString(),
    validUntil: new Date(now + 7 * DAY_MS).toISOString(),
    departures,
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
  const routes = options.routes ?? (stopId === FIXTURE_STOP.id ? FIXTURE_STOP.routes : Object.keys(options.lastDepartures ?? FIXTURE_LAST_DEPARTURES));
  const last = options.lastDepartures ?? FIXTURE_LAST_DEPARTURES;
  const table = (time: (routeId: string) => string): Record<string, Record<string, string>> =>
    Object.fromEntries(routes.map((routeId) => [routeId, Object.fromEntries(days.map((day) => [day, time(routeId)]))]));
  const sorted = [...days].sort();
  return {
    generatedAt: new Date(scheduleInstant(sorted[0], 0) - 6 * 3_600_000).toISOString(),
    validUntil: new Date(scheduleInstant(sorted[sorted.length - 1], 30 * 3600)).toISOString(),
    source: 'ZET GTFS',
    routes: table((routeId) => last[routeId] ?? '24:00'),
    ...(options.withFirst === false ? {} : { first: table(() => options.firstTram ?? FIXTURE_FIRST_TRAM) }),
  };
}
