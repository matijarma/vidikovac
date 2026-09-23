// Seam S5 (docs/companion-2026-09-22.md §15.2 and §12): the "U blizini"
// timeline's selection layer, shared by the wall (app/src/kiosk/timeline.ts)
// and the phone's Sada and Karta sheet (WP4). Owned by WP1. Pure: no DOM, no
// fetch, no clock of its own; every surface passes the same boards, vehicles,
// snapshots and `now`, so every surface lists the same rows at the same second.
//
// What it lists, in this order (§4 ladder, §11 wall, §12 bounds):
//   - at most three departures at the place: blue when a tracked vehicle times
//     them inside the countdown horizon, grey timetable times otherwise, all
//     grey while ZET sends no vehicle positions;
//   - then the timed rows by their time: closures within the circle by their
//     end, events within the circle by their start with the venue and the tram
//     to it, the next solar event only, the evening's last trams as ONE row
//     from four hours ahead, the first morning tram from 22:00 until it leaves,
//     tomorrow's openings from the catalogue's hours when the evening empties;
//   - last, one timeless row: the place's naming story or a protected building
//     nearby, alternating every 20 minutes, and the 24/7 pharmacy at night.
// Never a fetch time, a disclaimer, a count without a name or a register
// caveat (§12 "Never"); a closure stays while its feed is stale (Q7).
//
// The circle is measured per place [O-68]: the caller passes `radiusM` from
// shared/city/frame.ts frameRadiusM(place, stops, frame), never a Kadar.
//
// Every third-party text a row shows (register names and descriptions, event
// titles and venues, closure titles and summaries, place names) passes the one
// validator shared with the header sentence, shared/kiosk/external-text.ts; a
// row whose text fails is not built, the next candidate stands in, and the
// reason goes to `onSkip` (the wall's data-skipped-text census, decision 18).
import { arrivalsAt, type ArrivalRow, type LiveVehicleRef } from '../../../shared/city/arrivals';
import { locatedEvents } from '../../../shared/city/events';
import { pillText } from '../../../shared/city/frame';
import { externalText, EXTERNAL_TEXT_REJECTIONS, type ExternalTextKind, type ExternalTextRejection } from '../../../shared/kiosk/external-text';
import { distanceM, inPolygons, located, matchStreet, normalName } from '../../../shared/city/geo';
import type { ScreenPlace } from '../../../shared/city/place';
import type { CityState, DepartureBoard, Place, StreetStory } from '../../../shared/city/types';
import type { FeedItem } from '../../../worker/feed/schema';
import { publicItemKey, type FeedSnapshots, type PublicSelection, type ScreenStop } from '../core/contracts';
import { firstDepartureOn, gtfsMinutes, lastDeparture, lastDepartureOn, nightService, type LastRunSnapshot } from '../core/lastrun';
import { ZET_ROUTES } from '../data/routes';
import { zagrebDayKey, zagrebHour, zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import { closuresByDistance, PHARMACY_POINTS, pharmaciesByDistance } from '../kiosk/local';
import { sortRouteIds } from '../kiosk/stops';
import type { MapHighlight } from '../map/city-map';
import { dataText } from '../panels/panel';
import { sunTimes } from '../ui/solar';
import { ct } from './strings';

export type NearbyKind = 'departure' | 'closure' | 'event' | 'solar' | 'last' | 'first' | 'opening' | 'always' | 'pharmacy';

/** One line of a last-trams or first-tram row: which line leaves, and when. */
export interface NearbyService {
  routeId: string;
  /** The line's short name as a rider reads it ("6"). */
  routeName: string;
  atMs: number;
}

/** One row of the timeline; the markup (li.nearby-row[data-id][data-kind]…) is derived from it. */
export interface NearbyRow {
  /** Stable across ticks, so a row that stays keeps its DOM node ("dep:<tripId>", "closure:<id>", …). */
  id: string;
  kind: NearbyKind;
  /** When the row happens, epoch ms; null for an "uvijek" row. */
  atMs: number | null;
  /** True for the "uvijek" row (data-always="1"). */
  always: boolean;
  title: string;
  sub: string;
  /**
   * A shorter title, complete in itself, that the wall prints where the full
   * one runs long (app/src/kiosk/timeline.ts): the source's own shorter words,
   * never a cut and never "…". Absent when no complete shorter label exists.
   */
  titleShort?: string;
  /** The same for the sub. */
  subShort?: string;
  /** A departure timed by a tracked vehicle (data-live="1"). */
  live: boolean;
  /** Where the row comes from (data-source): a feed module id or a static data set. */
  source: string;
  /** What the phone opens when the row is tapped. */
  selection?: PublicSelection;
  /** What the map highlights while the row is the subject. */
  map?: MapHighlight;
  /** A departure row's own arrival (route, headsign, countdown minutes), for the badge and the sentence. */
  arrival?: ArrivalRow;
  /** A last-trams or first-tram row's lines, soonest first; a line drops out once it has left. */
  services?: readonly NearbyService[];
}

/** Everything the selection reads; the caller owns every clock and cache. */
export interface NearbyInput {
  /** Never null: a screen without an address takes Trg bana J. Jelačića [O-65]. */
  place: ScreenPlace;
  /** The measured circle, metres (frameRadiusM). */
  radiusM: number;
  now: number;
  /** Scheduled boards of the place's platforms (shared/city/arrivals.ts reads them). */
  boards: readonly DepartureBoard[];
  /** Live vehicles, so a departure with a tracked vehicle counts down. */
  fixes: readonly LiveVehicleRef[];
  snapshots: FeedSnapshots;
  city: CityState;
  /** The place's stop file (core/lastrun.ts), for the last-trams and first-tram rows. */
  lastRun: LastRunSnapshot | null;
  locale: string;
  i18n: I18n;
  /** The stop table, when the caller holds it: names the tram to an event's venue. */
  stops?: readonly ScreenStop[];
  /** Told once per row left out because a third-party text failed externalText(), with the reason. */
  onSkip?: (reason: ExternalTextRejection) => void;
}

/** §12 bounds and the ladder's clock (§4). */
export const MAX_DEPARTURES = 3;
/** A countdown only this close (arrivalsAt's own horizon, passed explicitly); past it a departure is a timetable time. */
export const COUNTDOWN_HORIZON_MIN = 10;
/** A departure stays listed this long after its time, as arrivalsAt keeps it. */
const DEPARTURE_GRACE_MS = 60_000;
/** The morning a first tram belongs to: 03:00 to 12:00 of its service date's own calendar day, in GTFS minutes. */
const MORNING_FROM_MIN = 3 * 60;
const MORNING_UNTIL_MIN = 12 * 60;
export const LAST_DEPARTURES_AHEAD_MS = 4 * 3_600_000;
export const FIRST_TRAM_FROM_HOUR = 22;
/** The pharmacy takes the timeless row from 22:00 to 06:00. */
export const NIGHT_FROM_HOUR = 22;
export const NIGHT_UNTIL_HOUR = 6;
/** Tomorrow's openings join the list from 20:00 (and until 06:00), once no event is left tonight. */
export const OPENINGS_FROM_HOUR = 20;
export const ALWAYS_ALTERNATE_MS = 20 * 60_000;
/** A list, not a board: the nearest closures, the soonest events, the nearest openings. */
export const MAX_CLOSURES = 2;
export const MAX_EVENTS = 3;
export const MAX_OPENINGS = 2;
/** A tram stop this close to a venue is "the tram to it"; a venue this close to the place needs none. */
export const TRAM_TO_VENUE_M = 400;
/** The story's first sentence: cut after at least this many characters, never beyond the maximum. */
export const STORY_MIN_CHARS = 40;
export const STORY_MAX_CHARS = 140;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Ties at one instant: departures, then the timed kinds in the order §11 lists them, then the timeless row. */
const KIND_ORDER: Readonly<Record<NearbyKind, number>> = {
  departure: 0, closure: 1, event: 2, solar: 3, last: 4, first: 5, opening: 6, always: 7, pharmacy: 8,
};

/** The rows for a place, in time order with the departures first, within the bounds of §12. */
export function selectNearby(input: NearbyInput): NearbyRow[] {
  const outage = input.snapshots['zet-rt']?.status === 'down';
  const departures = departureRows(input, outage);
  const events = eventRows(input);
  const timed = [
    ...closureRows(input),
    ...events,
    ...solarRows(input),
    ...lastTramRows(input),
    ...firstTramRows(input),
    ...openingRows(input, events),
  ].sort(byTime);
  return [...departures, ...timed, ...timelessRows(input)];
}

function byTime(a: NearbyRow, b: NearbyRow): number {
  return (a.atMs ?? Infinity) - (b.atMs ?? Infinity) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id);
}

/**
 * The timeline's head: "U blizini · " and the measured circle, "U blizini · 2 km · ~15 min"
 * (a 2.0 km radius) or "U blizini · 2,2 km · ~16 min". The distance and the minutes are
 * shared/city/frame.ts pillText's, so the map and the list print one number; English
 * writes the decimal with a point.
 */
export function nearbyHead(i18n: I18n, radiusM: number): string {
  return `${i18n.t('kiosk.nearby.title')} · ${nearbyPill(i18n, radiusM)}`;
}

/** The pill alone, "2,2 km · ~16 min", from kiosk.nearby.pill. */
export function nearbyPill(i18n: I18n, radiusM: number): string {
  const text = pillText(radiusM);
  const m = /^(.+) km · ~(\d+) min$/.exec(text);
  if (!m) return text;
  const km = i18n.getLocale().startsWith('en') ? m[1]!.replace(',', '.') : m[1]!;
  return i18n.t('kiosk.nearby.pill', { km, min: m[2]! });
}

/** The smallest and the largest timeline row. */
export const ROW_MIN_PX = 64;
export const ROW_MAX_PX = 92;

/**
 * How tall the rows are and how many whole rows fit: few rows grow up to 92 px, many
 * shrink to 64 px, and only whole rows show (600 px for 3 rows → 92 px, 6 fit; for 12
 * → 64 px, 9 fit). An unbounded box (Infinity, the handheld list) shows every row at 64 px.
 */
export function rowBudget(availablePx: number, count: number): { rowPx: number; rows: number } {
  if (availablePx === Number.POSITIVE_INFINITY) return { rowPx: ROW_MIN_PX, rows: Math.max(0, count) };
  if (!(availablePx > 0)) return { rowPx: ROW_MIN_PX, rows: 0 };
  const rowPx = Math.min(ROW_MAX_PX, Math.max(ROW_MIN_PX, Math.floor(availablePx / Math.max(count, 1))));
  return { rowPx, rows: Math.floor(availablePx / rowPx) };
}

// --- (a) departures -----------------------------------------------------------

function departureRows(input: NearbyInput, outage: boolean): NearbyRow[] {
  if (input.boards.length === 0) return [];
  const stopIds = [...new Set([...input.boards.map((b) => b.stopId), ...(input.place.stopId ? [input.place.stopId] : [])])];
  const { now } = input;
  // With ZET sending no positions every departure is a timetable time, whatever vehicles the caller still holds (§4.8).
  const { rows } = arrivalsAt(input.boards, outage ? [] : input.fixes, now, {
    stopIds, horizonMin: COUNTDOWN_HORIZON_MIN, pastGraceS: DEPARTURE_GRACE_MS / 1000, rows: Number.MAX_SAFE_INTEGER,
  });
  const operatorOf = new Map<string, 'zet' | 'hz'>();
  const scheduledOf = new Map<string, number>();
  for (const board of input.boards) for (const d of board.departures) {
    if (!d.tripId) continue;
    operatorOf.set(d.tripId, d.operator);
    const at = Date.parse(d.at);
    if (Number.isFinite(at) && at < (scheduledOf.get(d.tripId) ?? Infinity)) scheduledOf.set(d.tripId, at);
  }
  // Blue is a tracked vehicle inside the countdown horizon. Past it the row is grey, and a grey row is the
  // timetable: its scheduled instant and an arrival without the vehicle, before the rows are ordered and cut,
  // so a delayed tram never reads as a timetable time it does not have (17:57 ten minutes late is 17:57, not 18:07).
  const shown = rows
    .map((arrival): ArrivalRow | null => {
      if (!arrival.live || arrival.minutes !== null) return arrival;
      const scheduled = scheduledOf.get(arrival.tripId);
      if (scheduled === undefined) return null;
      const { vehicleId: _vehicle, ...timetable } = arrival;
      void _vehicle;
      const ahead = scheduled - now;
      return { ...timetable, atMs: scheduled, live: false, minutes: ahead <= COUNTDOWN_HORIZON_MIN * MINUTE_MS ? Math.max(0, Math.round(ahead / MINUTE_MS)) : null };
    })
    // A timetable time already past (its tram is late) is not a departure to wait for.
    .filter((arrival): arrival is ArrivalRow => arrival !== null && arrival.atMs >= now - DEPARTURE_GRACE_MS)
    // GTFS is external text too. Vet both fields before the cap, so a refused
    // headsign cannot hide in the route fallback or displace a safe departure.
    .filter(arrival => vetted(input, [['headsign', arrival.headsign || undefined], ['headsign', arrival.routeName]]))
    .sort((a, b) => a.atMs - b.atMs || a.routeName.localeCompare(b.routeName))
    .slice(0, MAX_DEPARTURES);
  return shown.map((arrival) => {
    const live = arrival.live;
    return {
      id: `dep:${arrival.tripId || `${arrival.routeId}:${arrival.atMs}`}`,
      kind: 'departure',
      atMs: arrival.atMs,
      always: false,
      title: arrival.headsign || arrival.routeName,
      sub: '',
      live,
      source: live ? 'zet-rt' : operatorOf.get(arrival.tripId) === 'hz' ? 'hz' : 'zet-gtfs',
      ...placeSelection(input.place),
      map: placePoint(input.place),
      arrival,
    };
  });
}

// --- (b) closures by their end --------------------------------------------------

function closureRows(input: NearbyInput): NearbyRow[] {
  const { place, now, radiusM } = input;
  return closuresByDistance(input.snapshots.prometnice, stopLike(place), now)
    .filter((c) => c.distanceM !== null && c.distanceM <= radiusM)
    .map((c) => ({ item: c.item, until: c.item.until ? Date.parse(c.item.until) : NaN }))
    // A closure without a published end is not a timed row.
    .filter((c) => Number.isFinite(c.until) && c.until > now)
    .filter(({ item }) => vetted(input, [['name', item.title], ['summary', item.brief], ['summary', item.summary]]))
    .map(({ item, until }) => {
      const map = itemMap(item);
      const sub = oneLine(item.brief ?? '');
      // The machine brief can run long; the feed's own summary ("zatvoreno zbog radova, oba smjera") is its complete short twin.
      const subShort = shorterLabel(sub, [item.summary]);
      return {
        id: `closure:${item.id}`,
        kind: 'closure' as const,
        atMs: until,
        always: false,
        title: item.title,
        sub,
        ...(subShort ? { subShort } : {}),
        live: false,
        source: 'prometnice',
        selection: { kind: 'item' as const, id: publicItemKey('prometnice', item.id), module: 'prometnice' as const },
        ...(map ? { map } : {}),
      };
    })
    // Before the bound, so the next closure stands in for one whose text is refused.
    .filter((row) => vetted(input, [['name', row.title], ['summary', row.sub], ['summary', row.subShort]]))
    .slice(0, MAX_CLOSURES);
}

// --- (c) events by their start, with the venue and the tram to it ---------------

function eventRows(input: NearbyInput): NearbyRow[] {
  const { place, now, radiusM, city } = input;
  const snapshot = input.snapshots.dogadanja;
  if (!snapshot || snapshot.status === 'down') return [];
  const placeTrams = placeTramRoutes(input);
  const out: NearbyRow[] = [];
  for (const event of locatedEvents(snapshot.items, city.places, now, 'week')) {
    const item = event.item;
    if (dataText(item, 'precision') !== 'time') continue;
    const start = Date.parse(item.at ?? '');
    if (!(start >= now)) continue;
    const venue = event.venueIds.length === 1 ? city.places.find((p) => p.id === event.venueIds[0] && located(p)) : undefined;
    const point = venue && located(venue) ? { lon: venue.lon, lat: venue.lat } : pointOf(item);
    if (!point || distanceM(place, point) > radiusM) continue;
    // Before oneLine/trim/shorterLabel: controls or vectors cannot be repaired
    // away by presentation helpers or hidden in a discarded source suffix.
    if (!vetted(input, [['title', item.title], ['title', item.brief], ['name', venue?.name ?? dataText(item, 'venue')]])) continue;
    const venueName = (venue?.name ?? dataText(item, 'venue')).trim();
    if (!venueName) continue;
    const tram = distanceM(place, point) > TRAM_TO_VENUE_M ? tramTo(point, placeTrams, input.stops) : null;
    if (tram && !vetted(input, [['headsign', tram]])) continue;
    const title = oneLine(item.brief ?? item.title);
    // The source's own title where a machine brief stands in for it; nothing else. The words before a colon
    // or a dash are not a name the source gave ("Javno predavanje: Povijest Zagreba" is not "Javno
    // predavanje"), so without one the wall wraps the whole title (app/src/kiosk/timeline.ts).
    const titleShort = shorterLabel(title, [item.brief ? item.title : undefined]);
    out.push({
      id: `event:${item.id}`,
      kind: 'event',
      atMs: start,
      always: false,
      title,
      ...(titleShort ? { titleShort } : {}),
      sub: tram ? `${venueName} · ${input.i18n.t('kiosk.lines.tram')} ${tram}` : venueName,
      // The venue alone: the tram to it is the part a crowded list can do without.
      ...(tram ? { subShort: venueName } : {}),
      live: false,
      source: 'dogadanja',
      selection: { kind: 'item', id: publicItemKey('dogadanja', item.id), module: 'dogadanja' },
      map: { id: venue?.id ?? item.id, geometry: { type: 'Point', coordinates: [point.lon, point.lat] } },
    });
  }
  // The title, its shorter twin and the venue alone (the tram line after " · " is the wall's own words).
  return out.filter((row) => vetted(input, [['title', row.title], ['title', row.titleShort], ['name', row.subShort ?? row.sub]]))
    .sort(byTime).slice(0, MAX_EVENTS);
}

/** The tram lines that serve the place: its platforms in the stop table, its stop file, its boards. */
function placeTramRoutes(input: NearbyInput): string[] {
  const routes = new Set<string>();
  const name = normalName(input.place.name);
  for (const stop of input.stops ?? []) {
    if (stop.id === input.place.stopId || (normalName(stop.name) === name && distanceM(stop, input.place) <= TRAM_TO_VENUE_M)) {
      for (const r of stop.routes) routes.add(r);
    }
  }
  if (input.lastRun?.status === 'live') for (const r of Object.keys(input.lastRun.routes)) routes.add(r);
  for (const board of input.boards) for (const d of board.departures) if (d.operator === 'zet') routes.add(d.routeId);
  return sortRouteIds([...routes].filter(isTram));
}

/** The first tram line the place shares with the stop nearest the venue (within TRAM_TO_VENUE_M), or null. */
function tramTo(venue: { lon: number; lat: number }, placeTrams: readonly string[], stops: readonly ScreenStop[] | undefined): string | null {
  if (!stops || placeTrams.length === 0) return null;
  let best: { d: number; routes: string[] } | null = null;
  for (const stop of stops) {
    const shared = stop.routes.filter((r) => placeTrams.includes(r));
    if (shared.length === 0) continue;
    const d = distanceM(venue, stop);
    if (d <= TRAM_TO_VENUE_M && (!best || d < best.d)) best = { d, routes: shared };
  }
  if (!best) return null;
  const routeId = sortRouteIds(best.routes)[0]!;
  return ZET_ROUTES[routeId]?.shortName || routeId;
}

// --- (d) the next solar event only ----------------------------------------------

function solarRows(input: NearbyInput): NearbyRow[] {
  const { now, place, i18n } = input;
  const today = zagrebDayKey(now);
  const times = (day: string) => sunTimes(new Date(`${day}T10:00:00Z`), place.lat, place.lon);
  const t = times(today);
  let next: { kind: 'sunrise' | 'sunset'; at: number } | null = null;
  if (t.polar === 'none' && now < t.sunrise.getTime()) next = { kind: 'sunrise', at: t.sunrise.getTime() };
  else if (t.polar === 'none' && now < t.sunset.getTime()) next = { kind: 'sunset', at: t.sunset.getTime() };
  else {
    const tomorrow = times(shiftDay(today, 1));
    if (tomorrow.polar === 'none') next = { kind: 'sunrise', at: tomorrow.sunrise.getTime() };
  }
  if (!next) return [];
  return [{
    id: `solar:${next.kind}:${zagrebDayKey(next.at)}`,
    kind: 'solar',
    atMs: next.at,
    always: false,
    title: next.kind === 'sunrise' ? i18n.t('kiosk.nearby.sunrise') : i18n.t('kiosk.nearby.sunset'),
    sub: '',
    live: false,
    source: 'solar',
  }];
}

// --- (e) the evening's last trams, one row from four hours ahead -----------------

function lastTramRows(input: NearbyInput): NearbyRow[] {
  const { now, lastRun, place, i18n } = input;
  if (lastRun?.status !== 'live') return [];
  const services: NearbyService[] = [];
  const today = zagrebDayKey(now);
  // Night lines are the night service, not the evening's last trams.
  for (const routeId of Object.keys(lastRun.routes).filter((r) => isTram(r) && !nightService(lastRun, r))) {
    const last = lastDeparture(lastRun, routeId, now);
    if (!last || last.at - now > LAST_DEPARTURES_AHEAD_MS) continue;
    // The service date it belongs to (yesterday's while its rolled time is still ahead), read in GTFS time:
    // a last run in that service day's morning is a line that only pulls out early here, not an evening's last tram.
    const serviceDate = [shiftDay(today, -1), today].find((day) => lastDepartureOn(lastRun, routeId, day)?.at === last.at);
    const minutes = serviceDate ? gtfsMinutes(lastRun.routes[routeId]?.[serviceDate]) : null;
    if (minutes === null || minutes < MORNING_UNTIL_MIN) continue;
    const routeName = shortName(routeId);
    if (vetted(input, [['headsign', routeName]])) services.push({ routeId, routeName, atMs: last.at });
  }
  if (services.length === 0) return [];
  services.sort(byService);
  return [{
    // The evening's service day, so the id holds across midnight while the last trams run.
    id: `last:${zagrebDayKey(now - 6 * HOUR_MS)}`,
    kind: 'last',
    atMs: services[0]!.atMs,
    always: false,
    title: i18n.t('kiosk.nearby.lastTrams'),
    sub: servicesLine(services),
    live: false,
    source: 'zet-gtfs',
    ...placeSelection(place),
    services,
  }];
}

// --- (f) the first morning tram, from 22:00 until it leaves -----------------------

function firstTramRows(input: NearbyInput): NearbyRow[] {
  const { now, lastRun, place, i18n } = input;
  if (lastRun?.status !== 'live') return [];
  const today = zagrebDayKey(now);
  const hour = zagrebHour(now) ?? 12;
  // From 22:00 the next morning is tomorrow's service date; after midnight it is today's.
  const serviceDate = hour >= FIRST_TRAM_FROM_HOUR ? shiftDay(today, 1) : today;
  const services: NearbyService[] = [];
  // Night lines' service days start around midnight and run past 26:00: never the morning's first tram.
  for (const routeId of Object.keys(lastRun.routes).filter((r) => isTram(r) && !nightService(lastRun, r))) {
    // GTFS time on that service date: 03:00 to 12:00 is the morning of the date itself; 24:00 or later
    // (line 33's "28:15" at 112_1) is the calendar day after it, so a different morning.
    const minutes = gtfsMinutes(lastRun.first?.[routeId]?.[serviceDate]);
    if (minutes === null || minutes < MORNING_FROM_MIN || minutes >= MORNING_UNTIL_MIN) continue;
    const first = firstDepartureOn(lastRun, routeId, serviceDate);
    const routeName = shortName(routeId);
    if (first && vetted(input, [['headsign', routeName]])) services.push({ routeId, routeName, atMs: first.at });
  }
  if (services.length === 0) return [];
  services.sort(byService);
  // The row belongs to the stop's first tram: once that one has left, the morning has begun.
  if (!(services[0]!.atMs > now)) return [];
  return [{
    id: `first:${serviceDate}`,
    kind: 'first',
    atMs: services[0]!.atMs,
    always: false,
    title: i18n.t('kiosk.nearby.firstTram'),
    sub: servicesLine(services),
    live: false,
    source: 'zet-gtfs',
    ...placeSelection(place),
    services,
  }];
}

// --- (g) tomorrow's openings, when the evening empties ---------------------------

function openingRows(input: NearbyInput, events: readonly NearbyRow[]): NearbyRow[] {
  const { now, place, radiusM, city, i18n } = input;
  const hour = zagrebHour(now) ?? 12;
  if (!(hour >= OPENINGS_FROM_HOUR || hour < NIGHT_UNTIL_HOUR)) return [];
  const today = zagrebDayKey(now);
  const morning = hour >= OPENINGS_FROM_HOUR ? shiftDay(today, 1) : today;
  // The horizon reaches into the morning only when nothing is left tonight.
  const morningStart = localInstant(morning, NIGHT_UNTIL_HOUR, 0);
  if (events.some((e) => e.atMs !== null && e.atMs < morningStart)) return [];
  const weekday = weekdayOf(morning);
  const found: { place: Place & { lon: number; lat: number }; at: number; d: number }[] = [];
  for (const p of city.places) {
    if ((p.category !== 'culture' && p.category !== 'market') || !located(p) || !p.hours) continue;
    const d = distanceM(place, p);
    if (d > radiusM) continue;
    const minutes = openingTimes(p.hours)?.get(weekday);
    if (minutes === undefined || minutes === null) continue;
    const at = localInstant(morning, Math.floor(minutes / 60), minutes % 60);
    if (at > now && vetted(input, [['name', p.name]])) found.push({ place: p, at, d });
  }
  return found
    .sort((a, b) => a.d - b.d || a.at - b.at || a.place.id.localeCompare(b.place.id))
    .slice(0, MAX_OPENINGS)
    .map(({ place: p, at }) => ({
      id: `open:${p.id}:${morning}`,
      kind: 'opening' as const,
      atMs: at,
      always: false,
      title: p.name,
      sub: ct(i18n, p.category === 'market' ? 'market' : 'culture'),
      live: false,
      source: p.sourceId,
      ...placeRef(p),
      map: { id: p.id, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] as [number, number] } },
    }));
}

const DAY_NUMBER: Readonly<Record<string, number>> = { pon: 1, uto: 2, sri: 3, čet: 4, cet: 4, pet: 5, sub: 6, ned: 0 };
/** Monday first, so "sub-ned" is Saturday and Sunday. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_RE = '(?:pon|uto|sri|čet|cet|pet|sub|ned)';
const DAYS_RE = `${DAY_RE}(?:\\s*[-–]\\s*${DAY_RE})?(?:\\s*(?:,|\\si)\\s*${DAY_RE}(?:\\s*[-–]\\s*${DAY_RE})?)*`;
const TIME_RE = '\\d{1,2}(?:[.:]\\d{2})?h?';
const RANGE_RE = `${TIME_RE}\\s*[-–]\\s*${TIME_RE}`;
const RANGES_RE = `${RANGE_RE}(?:\\s*(?:,|\\si)\\s*${RANGE_RE})*`;
/** A catalogue phrase this parser does not trust: box offices, seasons, "every other", holidays, appointments, notes. */
const DOUBT = /[()]|blagajn|prije|poslije|zimsk|ljetn|svak|praznik|blagdan|dogovor|ovisno|najav|osim|\bod\b|\bdo\b|http|www/;

/**
 * The first opening per weekday (0 Sunday … 6 Saturday, minutes after midnight; null for a day
 * the text calls closed) from a catalogue `hours` text such as "pon-pet 08h-20h, sub 08h-14h" or
 * "uto-pet 11h-19h, sub i ned 11h-14h, pon zatvoreno". Conservative on purpose: any phrase it
 * cannot read whole, a range without a day ("08h-16h" says nothing about Saturday), and a day
 * given two different openings make it answer null, and no row is shown.
 */
export function openingTimes(hours: string): Map<number, number | null> | null {
  const text = hours.toLocaleLowerCase('hr').replace(/\s+/g, ' ').trim();
  if (!text || DOUBT.test(text)) return null;
  const segment = new RegExp(`\\s*[,.]?\\s*(${DAYS_RE})\\s+(${RANGES_RE}|zatvoreno)`, 'y');
  const out = new Map<number, number | null>();
  const doubtful = new Set<number>();
  let pos = 0;
  while (pos < text.length) {
    segment.lastIndex = pos;
    const m = segment.exec(text);
    if (!m) {
      if (/^[\s.,]*$/.test(text.slice(pos))) break;
      return null;
    }
    pos = segment.lastIndex;
    const days = expandDays(m[1]!);
    if (!days) return null;
    const opening = m[2] === 'zatvoreno' ? null : firstOpening(m[2]!);
    if (opening === undefined) return null;
    for (const day of days) {
      if (out.has(day) && out.get(day) !== opening) doubtful.add(day);
      out.set(day, opening);
    }
  }
  for (const day of doubtful) out.delete(day);
  return out.size > 0 ? out : null;
}

function expandDays(spec: string): number[] | null {
  const days: number[] = [];
  for (const part of spec.split(/\s*(?:,|\si\s)\s*/)) {
    const [from, to] = part.split(/\s*[-–]\s*/);
    const a = WEEK_ORDER.indexOf(DAY_NUMBER[from!] ?? -1);
    const b = to === undefined ? a : WEEK_ORDER.indexOf(DAY_NUMBER[to] ?? -1);
    if (a === -1 || b === -1 || b < a) return null;
    for (let i = a; i <= b; i++) days.push(WEEK_ORDER[i]!);
  }
  return days;
}

/** The first range's opening in minutes; undefined when a time is not a clock time or the range runs backwards. */
function firstOpening(ranges: string): number | undefined {
  const m = /^(\d{1,2})(?:[.:](\d{2}))?h?\s*[-–]\s*(\d{1,2})(?:[.:](\d{2}))?h?/.exec(ranges);
  if (!m) return undefined;
  const open = Number(m[1]) * 60 + Number(m[2] ?? 0);
  const close = Number(m[3]) * 60 + Number(m[4] ?? 0);
  if (Number(m[1]) > 23 || Number(m[2] ?? 0) > 59 || Number(m[4] ?? 0) > 59 || close > 24 * 60 || close <= open) return undefined;
  return open;
}

// --- (h) the timeless row ---------------------------------------------------------

function timelessRows(input: NearbyInput): NearbyRow[] {
  const hour = zagrebHour(input.now) ?? 12;
  if (hour >= NIGHT_FROM_HOUR || hour < NIGHT_UNTIL_HOUR) {
    const row = pharmacyRow(input);
    return vetted(input, [['address', row.sub]]) ? [row] : [];
  }
  const story = storyRow(input);
  const heritage = heritageRow(input);
  // Alternate on the clock's 20-minute boundaries; either one stands in when the other has nothing to say.
  const turn = Math.floor(input.now / ALWAYS_ALTERNATE_MS) % 2;
  const row = turn === 0 ? story ?? heritage : heritage ?? story;
  return row ? [row] : [];
}

function pharmacyRow(input: NearbyInput): NearbyRow {
  const pharmacy = pharmaciesByDistance(stopLike(input.place))[0]!;
  const point = PHARMACY_POINTS[pharmacy.label];
  return {
    id: 'always:pharmacy',
    kind: 'pharmacy',
    atMs: null,
    always: true,
    title: '24/7',
    sub: pharmacy.label,
    live: false,
    source: 'ljekarne',
    ...(point ? { map: { id: 'pharmacy', geometry: { type: 'Point' as const, coordinates: [point.lon, point.lat] as [number, number] } } } : {}),
  };
}

function storyRow(input: NearbyInput): NearbyRow | null {
  const story = placeStory(input.place, input.city);
  if (story && !vetted(input, [['name', story.name], ['register-text', story.description]])) return null;
  const text = story ? firstSentence(csvField(story.description)) : '';
  if (!story || !text || !vetted(input, [['name', story.name], ['register-text', text]])) return null;
  // The register's full name ("Trg bana Josipa Jelačića") and, where the stop's own name abbreviates it, that
  // name ("Trg bana J. Jelačića", the one in the header): the same place, whole, only shorter.
  const own = oneLine(input.place.name);
  const titleShort = abbreviates(normalName(own).split(' '), normalName(story.name).split(' ')) ? shorterLabel(story.name, [own]) : undefined;
  if (titleShort && !vetted(input, [['name', input.place.name], ['name', titleShort]])) return null;
  return {
    id: `always:story:${story.id}`,
    kind: 'always',
    atMs: null,
    always: true,
    title: story.name,
    ...(titleShort ? { titleShort } : {}),
    sub: text,
    live: false,
    source: 'streets',
    ...(/^[0-9A-Za-z_-]{1,80}$/.test(story.id) ? { selection: { kind: 'street' as const, id: story.id } } : {}),
  };
}

/**
 * The street register's story for the place: an exact name in the settlement that contains it
 * (matchStreet), else the one register name the place's name abbreviates ("Trg bana J.
 * Jelačića" → "Trg bana Josipa Jelačića") in that settlement. Never the first street of the
 * settlement: Zagreb's own has 3,289, and a random one is not the place's story.
 */
export function placeStory(place: { name: string; lon: number; lat: number }, city: Pick<CityState, 'streets' | 'settlements'>): StreetStory | null {
  const exact = matchStreet(place.name, place, city.streets, city.settlements);
  if (exact) return exact;
  const area = city.settlements.filter((s) => inPolygons(place.lon, place.lat, s.polygons));
  if (area.length !== 1) return null;
  const tokens = normalName(place.name).split(' ');
  const hits = city.streets.filter((s) =>
    (Number(s.settlementId) === Number(area[0]!.id) || normalName(s.settlement) === normalName(area[0]!.name))
    && abbreviates(tokens, normalName(s.name).split(' ')));
  return hits.length === 1 ? hits[0]! : null;
}

function abbreviates(short: readonly string[], full: readonly string[]): boolean {
  return short.length === full.length && short.some((t, i) => t !== full[i])
    && short.every((t, i) => t === full[i] || (t.length === 1 && full[i]!.length > 1 && full[i]!.startsWith(t)));
}

/**
 * The first sentence, cut at the first full stop after STORY_MIN_CHARS that a capital follows
 * (so "1848. godine", an ordinal, is not an end), at most STORY_MAX_CHARS and never mid-word.
 */
export function firstSentence(text: string): string {
  const clean = oneLine(text);
  const end = /\.\s+(?=\p{Lu})/gu;
  end.lastIndex = STORY_MIN_CHARS;
  const stop = end.exec(clean);
  let out = stop ? clean.slice(0, stop.index + 1) : clean;
  if (out.length > STORY_MAX_CHARS) {
    const cut = out.lastIndexOf(' ', STORY_MAX_CHARS);
    out = (cut > 0 ? out.slice(0, cut) : out.slice(0, STORY_MAX_CHARS)).replace(/[\s,;:–-]+$/, '');
  }
  return out;
}

function heritageRow(input: NearbyInput): NearbyRow | null {
  const { place, radiusM } = input;
  // The nearest protected building whose name and address pass externalText(); a refused one gives way to the next.
  const refused = new Set<string>();
  let best: { p: Place & { lon: number; lat: number }; d: number } | null = null;
  for (;;) {
    best = null;
    for (const p of input.city.places) {
      if (p.category !== 'heritage' || !located(p) || refused.has(p.id)) continue;
      const d = distanceM(place, p);
      if (d <= radiusM && (!best || d < best.d || (d === best.d && p.id < best.p.id))) best = { p, d };
    }
    if (!best) return null;
    if (vetted(input, [['name', best.p.name], ['address', best.p.address],
      ['name', heritageName(best.p.name)], ['address', best.p.address ? firstStreet(best.p.address) : '']])) break;
    refused.add(best.p.id);
  }
  const p = best.p;
  return {
    id: `always:heritage:${p.id}`,
    kind: 'always',
    atMs: null,
    always: true,
    title: heritageName(p.name),
    // The address, never the register's subtype or a "not an entrance" caveat (slop #12, #13).
    sub: p.address ? firstStreet(p.address) : '',
    live: false,
    source: p.sourceId,
    ...placeRef(p),
    map: p.polygons
      ? { id: p.id, geometry: { type: 'MultiPolygon', coordinates: p.polygons } }
      : { id: p.id, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } },
  };
}

/** "Zgrada nekadašnje Gradske štedionice, Trg bana Jelačića 9 i 10" reads as its name; the address goes under it. */
function heritageName(name: string): string {
  const clean = oneLine(name);
  const comma = clean.indexOf(', ');
  if (comma === -1) return clean;
  const head = clean.slice(0, comma);
  return /\d/.test(clean.slice(comma)) && head.split(' ').length >= 2 ? head : clean;
}

/**
 * The first street of a register address, with the house numbers a reader writes: "Gajeva
 * 02,2a,2b,2c, Bogovićeva 1,1a…" reads "Gajeva 2,2a,2b,2c"; "Ilica 005 - Margaretska 01-03"
 * reads "Ilica 5" (the register pads numbers and lists every street a block touches).
 */
function firstStreet(address: string): string {
  const [first] = oneLine(address).split(/,\s+(?=\p{L})|\s+[-–]\s+(?=\p{L})/u);
  return (first ?? '').replace(/\b0+(\d)/g, '$1');
}

/**
 * A register field still in its CSV quoting, as 201 street descriptions of the
 * committed catalogue are: '"slikar, jedan od utemeljitelja Udruženja umjetnika
 * ""Zemlja""; 1901 - 1975"' reads 'slikar, jedan od utemeljitelja Udruženja
 * umjetnika "Zemlja"; 1901 - 1975' (RFC 4180: the outer pair goes, a doubled
 * quote is one). Quotes that are the text's own ('"mala" Sava/rukavac rijeke
 * Save', a lone quote inside) are left as they are.
 */
export function csvField(text: string): string {
  const field = text.trim();
  if (field.length < 2 || !field.startsWith('"') || !field.endsWith('"')) return text;
  const inner = field.slice(1, -1);
  // Inside a quoted field every quote is doubled.
  return inner.replace(/""/g, '').includes('"') ? text : inner.replace(/""/g, '"');
}

// --- third-party text -------------------------------------------------------------

/** Required labels cannot be empty; optional prose/address fields may be absent. Count one failure per omitted candidate. */
function vetted(input: NearbyInput, texts: readonly (readonly [ExternalTextKind, string | undefined])[]): boolean {
  for (const [kind, value] of texts) {
    if (value === undefined || (value === '' && (kind === 'summary' || kind === 'address' || kind === 'register-text'))) continue;
    const verdict = externalText(kind, value);
    if (!verdict.ok) { input.onSkip?.(verdict.reason); return false; }
  }
  return true;
}

/**
 * The wall's `data-skipped-text` census: "count:0", or "count:3;instruction:2;charset:1",
 * the rows the last selection left out and why, reasons in EXTERNAL_TEXT_REJECTIONS order.
 */
export function skippedTextCensus(reasons: readonly ExternalTextRejection[]): string {
  const parts = [`count:${reasons.length}`];
  for (const reason of EXTERNAL_TEXT_REJECTIONS) {
    const n = reasons.filter((r) => r === reason).length;
    if (n > 0) parts.push(`${reason}:${n}`);
  }
  return parts.join(';');
}

// --- shorter complete labels ------------------------------------------------------

const ELLIPSIS = /…|\.\.\./;

/**
 * The first candidate that is shorter than `full` and whole: the source's own
 * words, trimmed to one line, never with an ellipsis. Undefined when none
 * is, so the row offers no short label and the wall keeps the full one or drops
 * the row; a label is never cut to fit.
 */
export function shorterLabel(full: string, candidates: readonly (string | undefined)[]): string | undefined {
  const whole = oneLine(full);
  for (const candidate of candidates) {
    const text = oneLine(candidate ?? '');
    if (text && text.length < whole.length && !ELLIPSIS.test(text)) return text;
  }
  return undefined;
}

// --- helpers ----------------------------------------------------------------------

/** The place as the kiosk's stop-shaped readers take it (distance only reads lon/lat). */
function stopLike(place: ScreenPlace): ScreenStop {
  return { id: place.stopId ?? 'place', name: place.name, lon: place.lon, lat: place.lat, routes: [] };
}

function placeSelection(place: ScreenPlace): { selection?: PublicSelection } {
  return place.stopId && /^[0-9A-Za-z_-]{1,32}$/.test(place.stopId) ? { selection: { kind: 'stop', id: place.stopId } } : {};
}

function placeRef(p: Place): { selection?: PublicSelection } {
  return /^[0-9A-Za-z_-]{1,80}$/.test(p.id) ? { selection: { kind: 'place', id: p.id } } : {};
}

function placePoint(place: ScreenPlace): MapHighlight {
  return { id: place.stopId ?? 'place', geometry: { type: 'Point', coordinates: [place.lon, place.lat] } };
}

function itemMap(item: FeedItem): MapHighlight | null {
  const geo = item.geo;
  if (geo?.type === 'Point') {
    const [lon, lat] = geo.coordinates as number[];
    return Number.isFinite(lon) && Number.isFinite(lat) ? { id: item.id, geometry: { type: 'Point', coordinates: [lon!, lat!] } } : null;
  }
  if (geo?.type === 'LineString') return { id: item.id, geometry: { type: 'LineString', coordinates: geo.coordinates as [number, number][] } };
  return null;
}

function pointOf(item: FeedItem): { lon: number; lat: number } | null {
  if (item.geo?.type !== 'Point') return null;
  const [lon, lat] = item.geo.coordinates as number[];
  return Number.isFinite(lon) && Number.isFinite(lat) ? { lon: lon!, lat: lat! } : null;
}

function isTram(routeId: string): boolean {
  return ZET_ROUTES[routeId]?.type === 0;
}

function shortName(routeId: string): string {
  return ZET_ROUTES[routeId]?.shortName || routeId;
}

function byService(a: NearbyService, b: NearbyService): number {
  return a.atMs - b.atMs || a.routeId.localeCompare(b.routeId, 'hr', { numeric: true });
}

/** "6 23:52 · 11 23:58 · 12 00:04": the lines with their times, soonest first. */
function servicesLine(services: readonly NearbyService[]): string {
  return services.map((s) => `${s.routeName} ${zagrebTime(s.atMs)}`).join(' · ');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function shiftDay(dayKey: string, days: number): string {
  const m = DAY_KEY.exec(dayKey);
  if (!m) return '';
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)).toISOString().slice(0, 10);
}

function weekdayOf(dayKey: string): number {
  const m = DAY_KEY.exec(dayKey);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() : -1;
}

/** The instant of a Zagreb wall-clock time on `dayKey`: noon on that day (a CEST guess corrected once), shifted. */
function localInstant(dayKey: string, hours: number, minutes: number): number {
  const m = DAY_KEY.exec(dayKey);
  if (!m) return NaN;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) - 2 * HOUR_MS;
  const hour = zagrebHour(guess);
  const noon = hour === null ? guess : guess - (hour - 12) * HOUR_MS;
  return noon + (hours - 12) * HOUR_MS + minutes * MINUTE_MS;
}
