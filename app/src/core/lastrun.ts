// The last scheduled departure per line from the screen's stop (plan A.6, D7,
// Task T3.1), and the first one of the morning beside it (WP1 step 1: the wall's
// "Prvi tramvaj" row from 22:00 until it leaves). The source is ZET's static
// GTFS, cut by scripts/gtfs-lastrun.mjs
// into one small JSON per stop under /data/lastrun/<stopId>.json and fetched
// once per session; nothing here reads the real-time feed, and the tile that
// reads this says "po rasporedu · ZET GTFS", never an arrival.
//
// The table keeps GTFS's own clock: a service day starts at noon minus twelve
// hours and runs past 24:00, so Friday's "24:15" is Saturday 00:15 and the
// night trams' "29:38" is 05:38 the next morning. Keying by service date and
// resolving the instant here (rather than normalising to the calendar date in
// the file) is what keeps a Saturday whose own service ends at 23:48 from
// colliding with Friday's departure that rolled into it: 968 of ZET's 5,106
// stop/line pairs mix the two patterns across their services.
import { zagrebDayKey, zagrebHour } from '../format';

/** `routeId -> service date (YYYY-MM-DD, Zagreb) -> 'HH:MM'` in GTFS hours (24:15 is a quarter past midnight of the next day). */
export type LastRunRoutes = Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface LastRunLive {
  status: 'live';
  /** When this loader read the file: never mistaken for the timetable's own time. */
  fetchedAt: string;
  /** The file's `generatedAt`: when the script cut it from the GTFS. */
  sourceUpdatedAt: string;
  /** The last instant the file speaks for; after it, no departure is known and nothing is shown. */
  validUntil: string;
  routes: LastRunRoutes;
  /** The earliest departure per line and service date, same shape as `routes`; absent in a file cut before it existed. */
  first?: LastRunRoutes;
}
export interface LastRunDown {
  status: 'down';
  fetchedAt: string;
}
export type LastRunSnapshot = LastRunLive | LastRunDown;

/** The file as the script writes it. */
interface LastRunFile {
  generatedAt: string;
  validUntil: string;
  routes: LastRunRoutes;
  first?: LastRunRoutes;
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** GTFS HH:MM: the hours may pass 24, so two digits carry a service day into its second morning. */
const GTFS_TIME = /^(\d{1,2}):(\d{2})$/;

/** The service date `days` days after `dayKey`, by calendar arithmetic (a 23- or 25-hour day never shifts it). */
function shiftDayKey(dayKey: string, days: number): string {
  const m = DAY_KEY.exec(dayKey);
  if (!m) return '';
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)).toISOString().slice(0, 10);
}

/**
 * The UTC instant of Zagreb's noon on `dayKey`. A CEST guess, corrected once
 * by the hour Zagreb's clock shows: noon never falls inside a DST cut and the
 * guess is at most an hour off, so one correction settles it.
 */
function zagrebNoon(dayKey: string): number {
  const m = DAY_KEY.exec(dayKey);
  if (!m) return NaN;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) - 2 * HOUR_MS;
  const hour = zagrebHour(guess);
  return hour === null ? guess : guess - (hour - 12) * HOUR_MS;
}

/**
 * The UTC instant of a GTFS time on a service date: noon minus twelve hours
 * plus the time, as the GTFS reference defines a service day, which is what
 * makes "27:30" on the night the clocks fall back 02:30 CET and not 03:30.
 * NaN when either part is not what the file promises.
 */
function serviceInstant(dayKey: string, time: string): number {
  const m = GTFS_TIME.exec(time);
  if (!m) return NaN;
  return zagrebNoon(dayKey) - 12 * HOUR_MS + Number(m[1]) * HOUR_MS + Number(m[2]) * MINUTE_MS;
}

/**
 * The current service day's last departure of `routeId` that still lies
 * ahead of `now`, or null: yesterday's entry when its time rolled past
 * midnight and has not left yet (Saturday 00:10 still belongs to Friday's
 * service), else today's. Null once `validUntil` has passed, on a down
 * snapshot, and for a line the stop does not know. What comes back may be
 * tomorrow night's departure when tonight's has left (today's service date
 * answers from 00:00); the producer's lane rule keeps that off the band.
 */
export function lastDeparture(snapshot: LastRunSnapshot | null | undefined, routeId: string, now: number): { at: number } | null {
  if (!snapshot || snapshot.status !== 'live') return null;
  if (!(now < Date.parse(snapshot.validUntil))) return null;
  const table = snapshot.routes[routeId];
  if (!table) return null;
  const today = zagrebDayKey(now);
  for (const day of [shiftDayKey(today, -1), today]) {
    const time = table[day];
    if (!time) continue;
    const at = serviceInstant(day, time);
    if (Number.isFinite(at) && at >= now) return { at };
  }
  return null;
}

/**
 * A GTFS 'HH:MM' as minutes from the start of its service day (noon minus twelve hours); the
 * hours may pass 24, and 24:00 or later belongs to the calendar day after the service date.
 * Null for anything else.
 */
export function gtfsMinutes(time: string | undefined): number | null {
  const m = GTFS_TIME.exec(time ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** From here on a line's service is extended-hour night service: 26:00 is 02:00 the next morning. */
export const NIGHT_SERVICE_FROM_MIN = 26 * 60;

/**
 * True when the stop's file shows `routeId` as extended-hour night service: on some service
 * date its last departure from this stop is at or after NIGHT_SERVICE_FROM_MIN. ZET's day
 * trams end by 25:06 at every stop; the night trams run to 27:25–30:09.
 */
export function nightService(snapshot: LastRunSnapshot | null | undefined, routeId: string): boolean {
  if (!snapshot || snapshot.status !== 'live') return false;
  return Object.values(snapshot.routes[routeId] ?? {}).some((time) => (gtfsMinutes(time) ?? 0) >= NIGHT_SERVICE_FROM_MIN);
}

/** The last departure of `routeId` on the service date `serviceDate`, resolved to its instant, or null (no clock check). */
export function lastDepartureOn(snapshot: LastRunSnapshot | null | undefined, routeId: string, serviceDate: string): { at: number } | null {
  if (!snapshot || snapshot.status !== 'live') return null;
  const time = snapshot.routes[routeId]?.[serviceDate];
  if (!time) return null;
  const at = serviceInstant(serviceDate, time);
  return Number.isFinite(at) ? { at } : null;
}

/**
 * The first departure of `routeId` on the service date `serviceDate` (YYYY-MM-DD), resolved to
 * its instant, or null: on a down snapshot, for a line or a date the file's `first` table does
 * not carry, and for a file cut before `first` existed. It does not look at the clock; the
 * caller decides whether that morning is still ahead.
 */
export function firstDepartureOn(snapshot: LastRunSnapshot | null | undefined, routeId: string, serviceDate: string): { at: number } | null {
  if (!snapshot || snapshot.status !== 'live') return null;
  const time = snapshot.first?.[routeId]?.[serviceDate];
  if (!time) return null;
  const at = serviceInstant(serviceDate, time);
  return Number.isFinite(at) ? { at } : null;
}

/**
 * The next first departure of `routeId` that still lies ahead of `now`: today's service date
 * first (Saturday 00:10 still waits for Saturday's 04:16), then tomorrow's (Friday 22:40 gets
 * Saturday's 04:16), mirroring lastDeparture. Null once `validUntil` has passed, on a down
 * snapshot, without a `first` table and for a line the stop does not know.
 */
export function firstDeparture(snapshot: LastRunSnapshot | null | undefined, routeId: string, now: number): { at: number } | null {
  if (!snapshot || snapshot.status !== 'live') return null;
  if (!(now < Date.parse(snapshot.validUntil))) return null;
  const today = zagrebDayKey(now);
  for (const day of [today, shiftDayKey(today, 1)]) {
    const first = firstDepartureOn(snapshot, routeId, day);
    if (first && first.at >= now) return first;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One `routeId -> service date -> 'HH:MM'` table, checked entry by entry; null when any entry is not a string. */
function parseRoutes(body: Record<string, unknown>): Record<string, Record<string, string>> | null {
  const routes: Record<string, Record<string, string>> = {};
  for (const [routeId, table] of Object.entries(body)) {
    if (!isRecord(table)) return null;
    const days: Record<string, string> = {};
    for (const [day, time] of Object.entries(table)) {
      if (typeof time !== 'string') return null;
      days[day] = time;
    }
    routes[routeId] = days;
  }
  return routes;
}

/**
 * The file's shape, checked field by field; anything else is a down answer, never a half-read
 * table. `first` is optional (a file cut before it existed still reads), but when present it
 * is checked like `routes`.
 */
function parseFile(body: unknown): LastRunFile | null {
  if (!isRecord(body) || typeof body.generatedAt !== 'string' || typeof body.validUntil !== 'string' || !isRecord(body.routes)) return null;
  const routes = parseRoutes(body.routes);
  if (!routes) return null;
  if (body.first === undefined) return { generatedAt: body.generatedAt, validUntil: body.validUntil, routes };
  const first = isRecord(body.first) ? parseRoutes(body.first) : null;
  if (!first) return null;
  return { generatedAt: body.generatedAt, validUntil: body.validUntil, routes, first };
}

async function fetchSnapshot(stopId: string, fetchImpl: typeof fetch): Promise<LastRunSnapshot | null> {
  const fetchedAt = new Date().toISOString();
  try {
    const response = await fetchImpl(`/data/lastrun/${encodeURIComponent(stopId)}.json`);
    if (response.status === 404) return null;
    if (!response.ok) return { status: 'down', fetchedAt };
    const file = parseFile(await response.json());
    if (!file) return { status: 'down', fetchedAt };
    return { status: 'live', fetchedAt, sourceUpdatedAt: file.generatedAt, validUntil: file.validUntil, routes: file.routes, ...(file.first ? { first: file.first } : {}) };
  } catch {
    return { status: 'down', fetchedAt };
  }
}

const cache = new Map<string, Promise<LastRunSnapshot | null>>();
/** What each cached promise resolved to (absent while it is still pending),
 *  kept alongside the promise so a later call can judge `validUntil` without
 *  waiting on the fetch a second time. */
const resolvedSnapshot = new Map<string, LastRunSnapshot | null>();

/**
 * True once `now` has passed a live snapshot's own `validUntil`: the table
 * promises nothing beyond it, so a caller holding it must fetch again before
 * trusting it further (plan D6: "the kiosk fetches its stop's table on stop
 * change ... and again once now >= validUntil"). A down snapshot, or none at
 * all, has nothing to expire -- the existing down-retry rule already covers
 * those -- so only a live one can be expired.
 */
export function lastRunExpired(snapshot: LastRunSnapshot | null, now: number): boolean {
  return snapshot !== null && snapshot.status === 'live' && now >= Date.parse(snapshot.validUntil);
}

/**
 * The stop's table, fetched once per stop and kept in memory: a live file and
 * a missing one (null: the stop is not in the generated set) are remembered,
 * a down answer is not, so the next caller may try again (the kiosk does, an
 * hour after the down answer it holds was fetched: kiosk.ts
 * LASTRUN_DOWN_RETRY_MS). A live table is
 * remembered only until its own `validUntil`: past that instant this drops
 * the cache entry and fetches a fresh one, the same way a down answer already
 * lets the next call retry, rather than serving a table that has run out for
 * the rest of the screen's life (today's cache-forever behaviour this fixes).
 * `now` defaults to the wall clock; a caller (or a test) may pin it.
 */
export function loadLastRun(stopId: string, fetchImpl: typeof fetch = fetch, now: number = Date.now()): Promise<LastRunSnapshot | null> {
  const cached = cache.get(stopId);
  if (cached) {
    if (!resolvedSnapshot.has(stopId) || !lastRunExpired(resolvedSnapshot.get(stopId)!, now)) return cached;
    cache.delete(stopId);
    resolvedSnapshot.delete(stopId);
  }
  const pending = fetchSnapshot(stopId, fetchImpl).then((snapshot) => {
    resolvedSnapshot.set(stopId, snapshot);
    if (snapshot?.status === 'down') {
      cache.delete(stopId);
      resolvedSnapshot.delete(stopId);
    }
    return snapshot;
  });
  cache.set(stopId, pending);
  return pending;
}
