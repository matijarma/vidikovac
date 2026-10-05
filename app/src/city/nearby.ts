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
//   - right after them at most ONE ZET notice ("ZET javlja"), when ZET's own traffic
//     notice names a line the place's boards serve or its news feed states a service
//     change (shared/city/notices.ts): no time of its own, ZET's words and its link;
//   - then the timed rows by their time: closures within the circle by their
//     end, events within the circle by their start with the venue and the tram
//     to it, the next solar event only, the evening's last trams as ONE row
//     from four hours ahead, the next line to start from 22:00 until all have started (or 06:00),
//     tomorrow's openings from the catalogue's hours when the evening empties, and
//     the City's exhibitions by their venue's hours (at most two openings);
//   - last, one timeless row: the place's naming story or a protected building
//     nearby, alternating every 20 minutes, and the 24/7 pharmacy at night.
// The facts-breadth rows (docs/history/upgrade-2026-10-plan/U3.md S2, S3) join the timed
// rows: the next two HŽ trains from a station inside the circle (timetable only,
// never live; before the departures when the response policy asks), the nearest
// DHMZ station's next rain step, a power or water cut, a road state from HAK, and
// two places open now, one useful, one for leisure (OpenStreetMap hours); the events read
// the City's programme and the libraries' beside dogadanja.
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
import { isPublicHoliday } from '../../../shared/city/holidays';
import { containsStems, stemWords } from '../../../shared/city/stems';
import { noticeCandidates, zetNoticeLink } from '../../../shared/city/notices';
import { pillText, WALK_MIN_PER_KM } from '../../../shared/city/frame';
import { closureEndKnown } from '../../../shared/city/closures';
import { positionsUnavailable } from '../../../shared/city/service-state';
import { externalText, EXTERNAL_TEXT_REJECTIONS, type ExternalTextKind, type ExternalTextRejection } from '../../../shared/kiosk/external-text';
import { distanceM, inPolygons, located, matchStreet, normalName } from '../../../shared/city/geo';
import type { OpenKind, OpenPlace } from '../../../shared/city/osm-hours';
import type { ScreenPlace } from '../../../shared/city/place';
import type { CityState, DepartureBoard, Place, StreetStory } from '../../../shared/city/types';
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import { publicItemKey, type FeedSnapshots, type PublicSelection, type ScreenStop } from '../core/contracts';
import { firstDepartureOn, gtfsMinutes, lastDeparture, lastDepartureOn, nightService, type LastRunSnapshot } from '../core/lastrun';
import { ZET_ROUTES } from '../data/routes';
import { zagrebDayKey, zagrebHour, zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import { closuresByDistance, nearestHourlySteps, PHARMACY_POINTS, pharmaciesByDistance, radarNow } from '../kiosk/local';
import { sortRouteIds } from '../kiosk/stops';
import { kioskStrings } from '../kiosk/strings';
import type { MapHighlight } from '../map/city-map';
import { dataNumber, dataText } from '../panels/panel';
import { sunTimes } from '../ui/solar';
import { cancelledTrips, railPlaceName, RAIL_SHORT_NAME } from './feed';
export { railPlaceName };
import { ct } from './strings';

export type NearbyKind = 'departure' | 'notice' | 'closure' | 'event' | 'solar' | 'last' | 'first' | 'opening' | 'always' | 'pharmacy'
  | 'rail' | 'rain' | 'cut' | 'road' | 'open';

/** The facts-breadth modules the rows read by id (U3.md §0.2(d)): the schema that names them is U3-modules'. */
export type U3ModuleId = 'kultura-zg' | 'programi' | 'dhmz-hourly' | 'hak' | 'prekidi';

/** One of those modules' snapshots, read as data from the feeds in hand. */
export function u3Snapshot(snapshots: FeedSnapshots, id: U3ModuleId): ModuleSnapshot | undefined {
  return (snapshots as Readonly<Record<string, ModuleSnapshot | undefined>>)[id];
}

/** The rain row's word (kiosk.nearby.rain.*), from the Croatian word the worker writes on a wet step. */
export type RainWord = 'slaba' | 'kisa' | 'jaka';
/** A HAK road state (kiosk.nearby.road.*). */
export type RoadState = 'radovi' | 'regulacija' | 'zatvoreno' | 'zastoj';
/** What a rain, cut, road, open or exhibition row says, typed, so the header sentence (city/sentence.ts) and the wall's time
 *  column (kiosk/timeline.ts) never read it back from the row's words. */
export type NearbyDetail =
  | { kind: 'rain'; word: RainWord; percent: number | null }
  | { kind: 'cut'; utility: 'struja' | 'voda' | 'plin'; street: string; fromMs: number; untilMs: number; allDay: boolean }
  | { kind: 'road'; state: RoadState }
  | { kind: 'open'; openKind: OpenKind }
  | { kind: 'exhibit'; venue: string; openNow: boolean }
  /** DHMZ's radar composite shows rain near Zagreb (R3). */
  | { kind: 'radar' }
  /** The rail row's trains from its one station, soonest first (the first is the row's own time and title). */
  | { kind: 'rail'; trains: readonly NearbyTrain[] };

/** One train of the rail row: its trip, its timetable time and where it goes (the headsign as HŽ's data names it). */
export interface NearbyTrain { id: string; atMs: number; to: string }

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
  /** A closure's feed summary ("zatvoreno zbog radova, oba smjera", worker/feed/modules/prometnice.ts closureWords):
   *  the phone's sub when the brief is empty (city/nearby-markup.ts); the wall's row does not read it. */
  summary?: string;
  /** A departure timed by a tracked vehicle (data-live="1"). */
  live: boolean;
  /** Where the row comes from (data-source): a feed module id or a static data set. */
  source: string;
  /** What the phone opens when the row is tapped. */
  selection?: PublicSelection;
  /** A row without a subject of its own whose page is a layer: a sunrise, a sunset or rain opens Vrijeme on the phone
   *  (city/nearby-markup.ts). The wall ignores it. */
  layer?: 'zrak-i-nebo';
  /** What the map highlights while the row is the subject. */
  map?: MapHighlight;
  /** A departure row's own arrival (route, headsign, countdown minutes), for the badge and the sentence. */
  arrival?: ArrivalRow;
  /** A departure row: when the boards last named its trip (epoch ms). A row carried through a momentary gap keeps its earlier stamp. */
  confirmedAt?: number;
  /** When the boards' fix for this departure was last in hand (a tracked estimate): a row whose fix has just gone
   *  keeps its last estimate for HELD_LIVE_GRACE_MS rather than fall to the timetable and back (observe-d523). */
  liveAt?: number;
  /** A last-trams or first-tram row's lines, soonest first; a line drops out once it has left. */
  services?: readonly NearbyService[];
  /** A closure row: false when its published end is the City's rolling placeholder (shared/city/closures.ts), so the
   *  surfaces print "u tijeku" and the header states no end; `atMs` keeps the published end for order and data-when. */
  endKnown?: boolean;
  /** A notice row: ZET's own page of the notice (https, zet.hr only). The phone links it, the wall ignores it. */
  href?: string;
  /** When the row's fact ends, epoch ms, where it has an end of its own: an event's close, a cut's restoration, a rain step's end. */
  untilMs?: number;
  /** A rain, cut, road, open or rail row's typed facts. */
  detail?: NearbyDetail;
  /** The wall's compositions draw this rail row as a line of cells (kiosk/timeline.ts groupRail sets it); the phone
   *  and the handheld wall draw the same row as a row, its later trains after "zatim". */
  asLine?: boolean;
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
  /**
   * The departure rows on the wall now, in their order (kiosk.ts passes its previous selection). They hold
   * their slots on ETA jitter: a shown tram keeps its place while it reads the same minute as a newcomer, and
   * a newcomer takes the last slot only when it reads DISPLACE_MINUTES whole displayed minutes earlier (the D2
   * live block: one slot changed trips 37 times in ten minutes; the D5.3 observer: a live estimate crossing
   * the third row's minute swapped two trams twice in a minute). A shown departure whose trip the boards do
   * not name this instant is carried on its last estimate, with its own countdown, until they name it again,
   * HELD_DEPARTURE_GRACE_MS have passed since they last did (confirmedAt), or its time has passed (the twin
   * drops a vehicle for a snapshot, a platform board refetches without a trip: rows removed and re-created
   * within a minute in the D5.3 observation).
   */
  heldDepartures?: readonly NearbyRow[];
  /**
   * Departure rows that left the wall recently (row id, the moment they left; kiosk.ts keeps the list). A trip that
   * left does not come back within DEPARTED_HOLD_MS on an estimate that flapped back to now; re-estimated
   * DISPLACE_MINUTES ahead it is a departure to wait for again (D5.16 observer: the 1 and the 17 left and returned
   * on consecutive readings as the twin's estimate and next stop oscillated).
   */
  departedDepartures?: readonly { id: string; leftAt: number }[];
  /** The HŽ boards of the rail stations inside the circle, the two nearest (city/feed.ts railStationsNear). */
  railBoards?: readonly DepartureBoard[];
  /**
   * Whether the trains take a row of the list (railRows). The wall lists them; the phone keeps them behind the
   * departures block's train toggle instead (city/next-departures.ts, owner 5 Oct 2026: a train row all day on a
   * phone's timeline said nothing a person around town needed), so city/feed.ts nearbyInput passes false. Omitted: listed.
   */
  railInList?: boolean;
  /** The places open now inside the circle, closing 30 minutes or more from now (shared/city/osm-hours.ts openPlacesNear). */
  openPlaces?: readonly OpenPlace[];
  /** Where an event with neither a verified venue nor a point of its own takes place (the venue gazetteer), or null. */
  venuePoint?: (item: FeedItem) => { lon: number; lat: number } | null;
  /** The canonical name of that same resolved venue, never an unmatched source hint. */
  venueName?: (item: FeedItem) => string | null;
  /** The response policy's seam (U3.md §0.1; U2 sets it): `railMax` caps the rail row's trains (default 3), `railFirst`
   *  puts the row before the departure rows (default false). */
  policy?: { railMax?: number; railFirst?: boolean };
}

/** §12 bounds and the ladder's clock (§4). */
export const MAX_DEPARTURES = 3;
/** A countdown only this close (arrivalsAt's own horizon, passed explicitly); past it a departure is a timetable time. */
export const COUNTDOWN_HORIZON_MIN = 10;
/** A departure stays listed this long after its time, as arrivalsAt keeps it. */
const DEPARTURE_GRACE_MS = 60_000;
/** How long past its time a timetable row may still fill an otherwise empty block as "sada": the half minute
 *  its time rounds to now (review N3), never the whole grace. */
export const DUE_NOW_SLACK_MS = 30_000;
/** How long a shown departure is carried while the boards do not name its trip: one board TTL (city/boards.ts), the data's own staleness. */
export const HELD_DEPARTURE_GRACE_MS = 60_000;
/** A tram not on the wall displaces the shown last departure only when it reads this many displayed minutes earlier (hysteresis at the cap). */
export const DISPLACE_MINUTES = 2;
/** A shown tram's displayed minute changes only when its live estimate crosses the minute's boundary by this much (hysteresis on the countdown). */
export const MINUTE_MARGIN_MS = 15_000;
/** A tracked tram past its time is carried as "sada" this long while the twin still names one of the place's platforms as its vehicle's next stop. */
export const HELD_AT_STOP_MS = 3 * 60_000;
/** A departure that left the wall is not shown again this long on an estimate that flapped back, unless re-estimated DISPLACE_MINUTES ahead. */
export const DEPARTED_HOLD_MS = 60_000;
/** A shown tram whose fix has just gone keeps its last estimate this long while the boards still name its trip
 *  (observe-d523, 00:53: the 32's estimate, six minutes ahead of its timetable, came and went every few seconds and
 *  the row swapped places with the 34 three times in a minute). Past it the timetable, as before. */
export const HELD_LIVE_GRACE_MS = 60_000;
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
/** One rail row of up to three trains where a station is inside the circle; railRows emits none without one. */
export const RAIL_MAX_DEFAULT = 3;
/** An exhibition's venue and an open library or cinema this close are one place (the open place times it). */
const EXHIBIT_OPEN_PLACE_M = 60;
/** An exhibition open now stands at its closing time only while at least this much of the day is left. */
const EXHIBIT_OPEN_MIN_MS = 30 * 60_000;
/** A tram stop this close to a venue is "the tram to it"; a venue this close to the place needs none. */
export const TRAM_TO_VENUE_M = 400;
/** The story's first sentence: cut after at least this many characters, never beyond the maximum. */
export const STORY_MIN_CHARS = 40;
export const STORY_MAX_CHARS = 140;
/** The rain row: the nearest station's first wet step that has not ended and starts this soon. */
export const RAIN_AHEAD_MS = 2 * 3_600_000;
/** A cut that starts this soon, and a road state that ends this soon, is listed. */
export const CUT_AHEAD_MS = 36 * 3_600_000;
export const ROAD_AHEAD_MS = 36 * 3_600_000;
/** A cut's house numbers join its street on the row only while they are shorter than this. */
export const CUT_NUMBERS_MAX_CHARS = 24;
/** Two announcements of one event (the same title and start) this close together are one row. */
export const EVENT_SAME_M = 150;
/** An HŽ route name the badge prints as it stands (the sentence's route slot); any other reads arrivals.train. */
/** The worker's Croatian rain words (dhmz-hourly `weather`) and HAK's road states, to their catalogue keys. */
const RAIN_WORDS: Readonly<Record<string, RainWord>> = { 'slaba kiša': 'slaba', 'kiša': 'kisa', 'jaka kiša': 'jaka' };
const ROAD_STATES: Readonly<Record<string, RoadState>> = {
  radovi: 'radovi', 'privremena regulacija': 'regulacija', 'zatvoreno za promet': 'zatvoreno', zastoj: 'zastoj',
};
/** The open rows by the Zagreb hour: one useful kind and one leisure kind, the first kind present in each list winning,
 *  its nearest place; none from 02:00 to 06:00 (brief §3: two rows per band). */
const OPEN_BANDS: readonly { from: number; to: number; useful: readonly OpenKind[]; leisure: readonly OpenKind[] }[] = [
  { from: 6, to: 10, useful: ['ljekarna', 'trgovina', 'trznica', 'posta'], leisure: ['pekara', 'kafic'] },
  { from: 10, to: 17, useful: ['ljekarna', 'posta', 'knjiznica', 'trznica', 'trgovina'], leisure: ['kafic', 'pekara', 'restoran'] },
  { from: 17, to: 20, useful: ['ljekarna', 'knjiznica', 'trznica', 'trgovina'], leisure: ['restoran', 'kafic', 'bar'] },
  { from: 20, to: 26, useful: ['ljekarna', 'trgovina'], leisure: ['bar', 'kafic', 'restoran'] },
];
/** A sub that ends in our own clock range ("bez struje 08:00–14:00"): the words before it are what a check reads, the
 *  range is the grammar's (the prose check reads two clock times as a phone number). */
export const CLOCK_RANGE_TAIL = /\s(?:[01]\d|2[0-3]):[0-5]\d–(?:[01]\d|2[0-3]):[0-5]\d$/u;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Ties at one instant: departures, then the timed kinds in the order §11 lists them, then the timeless row. */
const KIND_ORDER: Readonly<Record<NearbyKind, number>> = {
  departure: 0, notice: 1, closure: 2, rail: 2.5, event: 3, rain: 3.5, solar: 4, last: 5, first: 6, opening: 7,
  cut: 7.1, road: 7.2, open: 7.3, always: 8, pharmacy: 9,
};

/** The rows for a place, in time order with the departures first, within the bounds of §12. */
export function selectNearby(input: NearbyInput): NearbyRow[] {
  // ZET down or unconfirmed (its newest word older than three minutes): every departure is a timetable time.
  const outage = positionsUnavailable(input.snapshots['zet-rt'], input.now);
  const departures = departureRows(input, outage);
  const events = eventRows(input);
  const timed = [
    ...closureRows(input),
    ...events,
    ...solarRows(input),
    ...lastTramRows(input),
    ...firstTramRows(input),
    ...openingRows(input, events),
  ];
  const rail = input.railInList === false ? [] : railRows(input);
  const breadth = [...rainRows(input), ...cutRows(input), ...roadRows(input)];
  const timeless = timelessRows(input);
  const open = openRows(input, timeless);
  // The response policy may put the trains before the trams (U3.md §0.1); by default they are timed rows like the rest.
  // ZET's notice sits directly after the departures (U1), so no promotion moves it.
  const railFirst = input.policy?.railFirst === true;
  return [
    ...(railFirst ? rail : []),
    ...departures,
    ...noticeRows(input),
    ...[...timed, ...(railFirst ? [] : rail), ...breadth, ...open].sort(byTime),
    ...timeless,
  ];
}

/**
 * The next departures (brief §5.2 (d), R2 reads it for the line's advance): the three departures after the shown
 * ones, in arrangeDepartures order, `kind: 'departure'`, ids distinct from the shown; empty when fewer than four
 * exist. Pure: the shown rows are read as the held ones, nothing is remembered.
 */
export function nextDepartures(input: NearbyInput, shown: readonly NearbyRow[]): NearbyRow[] {
  const outage = positionsUnavailable(input.snapshots['zet-rt'], input.now);
  return departureRows({ ...input, heldDepartures: shown.filter((row) => row.kind === 'departure') }, outage, 'next');
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

function departureRows(input: NearbyInput, outage: boolean, mode: 'shown' | 'next' = 'shown'): NearbyRow[] {
  // No board in hand is a moment, not a verdict: the shown departures ride through it on their grace below
  // (observe-d521b, item 2: the wall listed no departure for 25 to 46 s while the trams ran). Without held rows
  // there is nothing to carry, and nothing is invented.
  if (input.boards.length === 0 && !(input.heldDepartures ?? []).some((row) => row.kind === 'departure')) return [];
  const stopIds = [...new Set([...input.boards.map((b) => b.stopId), ...(input.place.stopId ? [input.place.stopId] : [])])];
  const { now } = input;
  // With ZET sending no positions every departure is a timetable time, whatever vehicles the caller still holds (§4.8).
  // A trip ZET's no-service alerts name leaves the board unless a vehicle has taken it (arrivalsAt's `cancelled`).
  const cancelled = cancelledTrips(input.snapshots['zet-rt']);
  const { rows } = arrivalsAt(input.boards, outage ? [] : input.fixes, now, {
    stopIds, horizonMin: COUNTDOWN_HORIZON_MIN, pastGraceS: DEPARTURE_GRACE_MS / 1000, rows: Number.MAX_SAFE_INTEGER, cancelled,
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
  const steadied = rows
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
    .filter(arrival => vetted(input, [['headsign', arrival.headsign || undefined], ['headsign', arrival.routeName]]));
  const held = (input.heldDepartures ?? []).filter((row) => row.kind === 'departure');
  const rank = new Map(held.map((row, index) => [row.id, index] as const));
  const heldById = new Map(held.map((row) => [row.id, row] as const));
  const departed = new Map((input.departedDepartures ?? []).map((d) => [d.id, d.leftAt] as const));
  const fresh = steadied
    .filter((arrival) => {
      const leftAt = departed.get(departureId(arrival));
      return leftAt === undefined || now - leftAt > DEPARTED_HOLD_MS || arrival.atMs - now >= DISPLACE_MINUTES * MINUTE_MS;
    })
    // A timetable row whose time has already passed enters no wall: the grace after a departure's time is for a
    // row already shown, so it does not vanish at the second, and a newcomer with nothing to promise would stand
    // "sada" for what is left of its minute and go (observe-d524, 01:58: the 32 Borongaj entered 38 s past its
    // time, the fitter dropped the 31 for it, and 22 s later the 32 left and the 31 came back as a new row).
    .filter((arrival) => arrival.live || arrival.atMs >= now || heldById.has(departureId(arrival)))
    // A shown tracked row whose fix is not in hand this instant keeps its last estimate for HELD_LIVE_GRACE_MS (its
    // timetable would put it below the tram it was ahead of, and back above once the fix returns), never in an outage.
    .map((arrival) => {
      const shown = heldById.get(departureId(arrival));
      if (!outage && !arrival.live && shown?.live && shown.arrival?.live && shown.liveAt !== undefined && now - shown.liveAt <= HELD_LIVE_GRACE_MS
        && shown.arrival.atMs >= now - DEPARTURE_GRACE_MS) {
        return { ...shown.arrival, minutes: countdownMinutes(shown.arrival.atMs, now) };
      }
      return arrival;
    })
    .map((arrival) => steadyMinute(arrival, heldById.get(departureId(arrival)), now));
  /** The fix for a fresh live row is in hand now; a carried estimate keeps the stamp of the fix it came from. */
  const liveNow = new Set(steadied.filter((arrival) => arrival.live).map(departureId));
  const freshIds = new Set(fresh.map(departureId));
  const vehicleOf = new Map(input.fixes.filter((v) => v.tripId).map((v) => [v.tripId!, v] as const));
  // A shown departure whose trip ZET has since cancelled, with no vehicle on it, does not ride the grace below: it
  // goes with the next update, as the row that was never listed would have (an HZ row is never asked).
  const withdrawn = (row: NearbyRow): boolean =>
    row.source !== 'hz' && row.arrival !== undefined && cancelled.has(row.arrival.tripId) && !vehicleOf.has(row.arrival.tripId);
  // A shown departure the boards do not name this instant is carried on its last estimate: the twin drops a
  // vehicle for a snapshot, a platform board refetches without a trip (D5.3 observer: rows 34 and 32 removed and
  // re-created within a minute). It goes when the boards have not named it for HELD_DEPARTURE_GRACE_MS, when its
  // time has passed, or, in an outage, when it is a live row (§4.8: every departure is then the timetable).
  const carried = held
    .filter((row): row is NearbyRow & { arrival: ArrivalRow; confirmedAt: number } => row.arrival !== undefined && row.confirmedAt !== undefined
      && !withdrawn(row)
      && !freshIds.has(row.id) && !(outage && row.live)
      && now - row.confirmedAt <= HELD_DEPARTURE_GRACE_MS && row.arrival.atMs >= now - DEPARTURE_GRACE_MS)
    .map((row) => ({ ...row.arrival, minutes: countdownMinutes(row.arrival.atMs, now) }));
  const carriedIds = new Set(carried.map(departureId));
  // A tracked tram whose estimate has passed but whose vehicle the twin still reports with one of these platforms as
  // its next stop is at or before the stop: it reads "sada" until the vehicle moves on, HELD_AT_STOP_MS after its
  // time at most (D5.8 observer: the 17 left 61 s past its estimate and came back re-estimated 50 s later, a row
  // removed and re-created). In an outage no live row is carried (§4.8).
  const dwelling = outage ? [] : held
    .filter((row): row is NearbyRow & { arrival: ArrivalRow } => row.arrival !== undefined && row.live
      && !withdrawn(row)
      && !freshIds.has(row.id) && !carriedIds.has(row.id)
      && now - row.arrival.atMs > DEPARTURE_GRACE_MS && now - row.arrival.atMs <= HELD_AT_STOP_MS
      && stopIds.includes(vehicleOf.get(row.arrival.tripId)?.nextStopId ?? ''))
    .map((row) => ({ ...row.arrival, minutes: 0 }));
  const dwellingIds = new Set(dwelling.map(departureId));
  // The block never stands empty while a departure is due on a board in hand: the departed hold above keeps a
  // trip that just left from flapping back, but with nothing else to list the next due trip is the wall's first
  // answer, hold or no hold (the wall-side guard of observe-d521b, item 2). Due means its minute is now: a
  // timetable row reads "sada" for the half minute its time still rounds to now (DUE_NOW_SLACK_MS) and not
  // for the rest of its grace, or the wall would print a time 50 s gone as now (review N3); a tracked tram at
  // the stop is due while the twin reports it.
  const due = steadied.find((arrival) => arrival.live || arrival.atMs >= now - DUE_NOW_SLACK_MS);
  const pool = fresh.length === 0 && carried.length === 0 && dwelling.length === 0 && due
    ? [steadyMinute(due, heldById.get(departureId(due)), now)]
    : [...fresh, ...carried, ...dwelling];
  // 'next' (nextDepartures, brief §5.2 (d)): the departures after the shown ones, in the same order, never one of them.
  const heldIds = new Set(held.map((row) => row.id));
  const minute = displayedMinute(now);
  const shown = mode === 'shown' ? arrangeDepartures(pool, held, minute)
    : pool.length > MAX_DEPARTURES ? orderDepartures(pool, held, minute).ordered.filter((a) => !heldIds.has(departureId(a))).slice(0, MAX_DEPARTURES) : [];
  return shown.map((arrival) => {
    const live = arrival.live;
    const id = departureId(arrival);
    return {
      id,
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
      confirmedAt: carriedIds.has(id) || dwellingIds.has(id) ? held[rank.get(id)!]!.confirmedAt ?? now : now,
      ...(live ? { liveAt: liveNow.has(id) ? now : heldById.get(id)?.liveAt ?? now } : {}),
    };
  });
}

const departureId = (arrival: ArrivalRow): string => `dep:${arrival.tripId || `${arrival.routeId}:${arrival.atMs}`}`;

/**
 * Hysteresis on a shown tram's countdown. A live estimate hovering on a rounding boundary read "za 2 min" and
 * "za 3 min" five times in thirty seconds (fix9 live block, 05:15), and the header's countdown sentence bounced
 * with it, which the harness reads as a verbatim repeat. While the fresh estimate stays inside the displayed
 * minute's band widened by MINUTE_MARGIN_MS, the row keeps the estimate it shows; a move past the margin, a
 * whole-minute jump, time passing, or the vehicle leaving the twin (a timetable row) all follow the data.
 */
function steadyMinute(arrival: ArrivalRow, shown: NearbyRow | undefined, now: number): ArrivalRow {
  if (!shown?.live || shown.atMs === null || !arrival.live || arrival.minutes === null) return arrival;
  const heldMinutes = countdownMinutes(shown.atMs, now);
  if (heldMinutes === null || heldMinutes === arrival.minutes) return arrival;
  const ahead = arrival.atMs - now;
  const low = (heldMinutes - 0.5) * MINUTE_MS - MINUTE_MARGIN_MS;
  const high = (heldMinutes + 0.5) * MINUTE_MS + MINUTE_MARGIN_MS;
  if (ahead < low || ahead > high) return arrival;
  return { ...arrival, atMs: shown.atMs, minutes: heldMinutes };
}

/** The countdown a row shows: rounded minutes inside the horizon, none (a clock time) beyond it; shared/city/arrivals.ts's rule. */
function countdownMinutes(atMs: number, now: number): number | null {
  const ahead = atMs - now;
  return ahead <= COUNTDOWN_HORIZON_MIN * MINUTE_MS ? Math.max(0, Math.round(ahead / MINUTE_MS)) : null;
}

/**
 * The minute a passer-by reads: a countdown's rounded minutes, a clock time's minute from now's, never below
 * zero: a timetable time inside its grace is due now, like "sada" (D5.8 observer, reading 26: the clock crossed
 * the minute and a timetable row climbed above two "sada" trams, a move of two records).
 */
function displayedMinute(now: number): (row: ArrivalRow) => number {
  return (row) => (row.live && row.minutes !== null ? row.minutes : Math.max(0, Math.floor(row.atMs / MINUTE_MS) - Math.floor(now / MINUTE_MS)));
}

/**
 * The order the wall prints, built from the wall's current order rather than sorted afresh, so that staying rows
 * never move for a minute of difference (principle 7; a node moved is two records to the recorder):
 * - the shown trams keep their order; one climbs above the tram before it only when it reads DISPLACE_MINUTES
 *   whole displayed minutes earlier (a one-minute difference is inside two estimates' jitter);
 * - a newcomer, by its minute then line and trip, enters before the first shown tram it is a whole minute
 *   earlier than, after the ones it is not (the D2 rule: a shown tram yields only to a tram a minute earlier);
 * - at the cap a newcomer displaces the last shown tram only when it reads DISPLACE_MINUTES earlier (fix9).
 * A tram due now or a whole minute earlier still enters at once; a departed one has already left the pool.
 */
function arrangeDepartures(pool: readonly ArrivalRow[], held: readonly NearbyRow[], minute: (row: ArrivalRow) => number): ArrivalRow[] {
  return orderDepartures(pool, held, minute).chosen;
}

/** arrangeDepartures' body: `chosen` is what the wall prints, `ordered` the whole pool in that order before the cap
 *  (the shown trams, then the newcomers inserted by minute), which nextDepartures reads past the shown ones. */
function orderDepartures(pool: readonly ArrivalRow[], held: readonly NearbyRow[], minute: (row: ArrivalRow) => number): { chosen: ArrivalRow[]; ordered: ArrivalRow[] } {
  const byId = new Map(pool.map((a) => [departureId(a), a] as const));
  const shownIds = new Set(held.map((row) => row.id));
  const shown: ArrivalRow[] = [];
  for (const row of held) { const a = byId.get(row.id); if (a) shown.push(a); }
  for (let i = 1; i < shown.length; i++) {
    for (let j = i; j > 0 && minute(shown[j]!) <= minute(shown[j - 1]!) - DISPLACE_MINUTES; j--) {
      [shown[j - 1], shown[j]] = [shown[j]!, shown[j - 1]!];
    }
  }
  const newcomers = pool.filter((a) => !shownIds.has(departureId(a)))
    .sort((a, b) => minute(a) - minute(b) || a.routeName.localeCompare(b.routeName) || a.tripId.localeCompare(b.tripId));
  const ordered = [...shown];
  for (const newcomer of newcomers) {
    const at = ordered.findIndex((a) => minute(a) > minute(newcomer));
    ordered.splice(at === -1 ? ordered.length : at, 0, newcomer);
  }
  let chosen = ordered.slice(0, MAX_DEPARTURES);
  for (const heldOut of ordered.slice(MAX_DEPARTURES).filter((a) => shownIds.has(departureId(a)))) {
    const newcomer = [...chosen].reverse().find((a) => !shownIds.has(departureId(a)));
    if (!newcomer || minute(newcomer) <= minute(heldOut) - DISPLACE_MINUTES) continue;
    const keep = new Set(chosen.filter((a) => a !== newcomer));
    keep.add(heldOut);
    chosen = ordered.filter((a) => keep.has(a));
  }
  return { chosen, ordered };
}

// --- (a2) ZET's own notice, right after the departures ----------------------------

/** The words a row never carries (the harness reads them as a caveat line, e2e/inventory.ts DISCL): honesty about a timetable lives in the header sentence, the map note and the status line. */
const CAVEAT = /po voznom redu|nepotvrđen|nije potvrđen|procjena iz|izvor:/i;

/**
 * At most one ZET notice (upgrade U1): its traffic notice when it names a line the place's boards serve, the news
 * feed's service statement anywhere (shared/city/notices.ts noticeCandidates), newest first. The title is ZET's own
 * and passes the row policy or the next candidate stands in; the sub is the start of ZET's description (its whole
 * sentences, zet-rss.ts noticeSummary) when that passes too and carries no caveat word, else nothing. The row has no
 * time of its own (the wall prints "ZET javlja" where a time would stand), no selection and no map; the phone links
 * ZET's page. It stands in every service state: it is ZET's word, not the product's, and no cause is ever added.
 */
function noticeRows(input: NearbyInput): NearbyRow[] {
  const snapshot = input.snapshots.dogadanja;
  if (!snapshot || snapshot.status === 'down') return [];
  const lines = new Set<string>();
  for (const board of input.boards) for (const d of board.departures) if (d.operator === 'zet') lines.add(d.routeName.toUpperCase());
  for (const item of noticeCandidates(snapshot.items, input.now, lines)) {
    if (CAVEAT.test(item.title) || !vetted(input, [['title', item.title]])) continue;
    const summary = item.summary !== undefined && !CAVEAT.test(item.summary) && externalText('summary', item.summary, { surface: 'row' }).ok ? item.summary : '';
    const href = zetNoticeLink(item.link);
    // The words before ZET's own separator, whole: the wall prints them where the full headline runs past its lines.
    // A short form the row policy refuses is not carried; the row stands on its full headline (and counts no skip).
    const short = noticeShortTitle(item.title);
    const titleShort = short !== undefined && externalText('title', short, { surface: 'row' }).ok ? short : undefined;
    return [{
      id: `notice:${item.id}`,
      kind: 'notice',
      atMs: Date.parse(item.at!),
      always: false,
      title: item.title,
      ...(titleShort ? { titleShort } : {}),
      sub: summary,
      live: false,
      source: String(item.data?.source ?? 'dogadanja'),
      ...(href ? { href } : {}),
    }];
  }
  return [];
}

/**
 * A notice headline's own shorter form: the words before its first separator (" (", " – " or ": ") after the
 * first character, trimmed, when they are whole, shorter and non-empty (shorterLabel); else undefined.
 * "Uspostavljena autobusna linija 228 (Borongaj – Rebro – Borongaj)" is "Uspostavljena autobusna linija 228".
 */
export function noticeShortTitle(title: string): string | undefined {
  const cuts = [' (', ' – ', ': '].map((sep) => title.indexOf(sep)).filter((i) => i > 0);
  if (cuts.length === 0) return undefined;
  return shorterLabel(title, [title.slice(0, Math.min(...cuts)).trim()]);
}

// --- (b) closures by their end --------------------------------------------------

function closureRows(input: NearbyInput): NearbyRow[] {
  const { place, now, radiusM } = input;
  return closuresByDistance(input.snapshots.prometnice, stopLike(place), now)
    .filter((c) => c.distanceM !== null && c.distanceM <= radiusM)
    .map((c) => ({ item: c.item, until: c.item.until ? Date.parse(c.item.until) : NaN }))
    // A closure without a published end is not a timed row.
    .filter((c) => Number.isFinite(c.until) && c.until > now)
    .filter(({ item }) => vetted(input, [['name', item.title], ['summary', item.brief]]))
    .map(({ item, until }) => {
      const map = itemMap(item);
      const brief = oneLine(item.brief ?? '');
      // The feed's own summary ("zatvoreno zbog radova, oba smjera"): the complete short twin of a machine brief that
      // runs long, and the sub when the brief is empty. A summary the row rule refuses is simply not carried: the row
      // stands on its title and brief (round 3 review, N5).
      const summary = oneLine(item.summary ?? '');
      const summaryOk = summary !== '' && externalText('summary', summary, { surface: 'row' }).ok;
      // The row says the street is closed: the brief, else the summary, else the words the wall's sentence uses
      // (round 1 F11: "do 21:45 Gundulićeva" with nothing under it left the amber dot as the only cue). One key for
      // both surfaces: the phone's row reads the same sub (city/nearby-markup.ts).
      const closed = input.i18n.t('kiosk.nearby.closed');
      const sub = brief || (summaryOk ? summary : '') || closed;
      // The wall prints a closure's sub on one line or not at all (kiosk/timeline.ts, decision 66): its shorter twin
      // is the shortest complete alternative, the wall's own words before the feed's summary, so the twin fits a line
      // wherever the sub does not (release smoke run 5: the summary "zatvoreno zbog radova, oba smjera" wrapped at
      // 1920 x 1080, every closure row was two lines and the second and third departures went for them).
      const subShort = shorterLabel(sub, [closed, summaryOk ? summary : undefined]);
      return {
        id: `closure:${item.id}`,
        kind: 'closure' as const,
        atMs: until,
        endKnown: closureEndKnown(item, now),
        always: false,
        title: item.title,
        sub,
        ...(subShort ? { subShort } : {}),
        ...(summaryOk ? { summary } : {}),
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

/** The event modules the list reads, each on its own: a module that is down leaves the others standing. */
function eventItems(input: NearbyInput): FeedItem[] {
  const snapshots = [input.snapshots.dogadanja, u3Snapshot(input.snapshots, 'kultura-zg'), u3Snapshot(input.snapshots, 'programi')];
  return snapshots.flatMap((snapshot) => (snapshot && snapshot.status !== 'down' ? snapshot.items : []));
}

function eventRows(input: NearbyInput): NearbyRow[] {
  const { place, now, radiusM, city } = input;
  const items = eventItems(input);
  if (items.length === 0) return [];
  const placeTrams = placeTramRoutes(input);
  /** The rows built so far, each with its point, whether that point is the item's own, and its title and start. */
  const out: { row: NearbyRow; point: { lon: number; lat: number }; own: boolean; key: string }[] = [];
  for (const event of locatedEvents(items, city.places, now, 'week')) {
    const item = event.item;
    if (dataText(item, 'precision') !== 'time') continue;
    const start = Date.parse(item.at ?? '');
    if (!(start >= now)) continue;
    const venue = event.venueIds.length === 1 ? city.places.find((p) => p.id === event.venueIds[0] && located(p)) : undefined;
    // A verified venue, else the item's own point, else the gazetteer's venue point (shared/city/venues.ts).
    const own = pointOf(item);
    const resolved = !venue && !own ? input.venuePoint?.(item) ?? null : null;
    const point = venue && located(venue) ? { lon: venue.lon, lat: venue.lat } : own ?? resolved;
    if (!point || distanceM(place, point) > radiusM) continue;
    const venueLabel = venue?.name ?? (dataText(item, 'venue') || (resolved ? input.venueName?.(item) : null) || '');
    // Before oneLine/trim/shorterLabel: controls or vectors cannot be repaired
    // away by presentation helpers or hidden in a discarded source suffix.
    if (!vetted(input, [['title', item.title], ['title', item.brief], ['name', venueLabel]])) continue;
    const venueName = venueLabel.trim();
    if (!venueName) continue;
    const tram = distanceM(place, point) > TRAM_TO_VENUE_M ? tramTo(point, placeTrams, input.stops) : null;
    if (tram && !vetted(input, [['headsign', tram]])) continue;
    const title = oneLine(item.brief ?? item.title);
    // The source's own title where a machine brief stands in for it; nothing else. The words before a colon
    // or a dash are not a name the source gave ("Javno predavanje: Povijest Zagreba" is not "Javno
    // predavanje"), so without one the wall wraps the whole title (app/src/kiosk/timeline.ts).
    const titleShort = shorterLabel(title, [item.brief ? item.title : undefined]);
    const until = Date.parse(item.until ?? '');
    const row: NearbyRow = {
      id: `event:${item.id}`,
      kind: 'event',
      atMs: start,
      ...(Number.isFinite(until) && until > start ? { untilMs: until } : {}),
      always: false,
      title,
      ...(titleShort ? { titleShort } : {}),
      sub: tram ? `${venueName} · ${input.i18n.t('kiosk.lines.tram')} ${tram}` : venueName,
      // The venue alone: the tram to it is the part a crowded list can do without.
      ...(tram ? { subShort: venueName } : {}),
      live: false,
      source: item.module,
      selection: { kind: 'item', id: publicItemKey(item.module, item.id), module: item.module },
      map: { id: venue?.id ?? item.id, geometry: { type: 'Point', coordinates: [point.lon, point.lat] } },
    };
    // One event announced by two modules (the same title and start, EVENT_SAME_M apart) is one row: the
    // announcement that carries its own point stands, else the first.
    const key = `${normalName(item.title)}|${start}`;
    const twin = out.findIndex((other) => other.key === key && distanceM(other.point, point) < EVENT_SAME_M);
    if (twin === -1) out.push({ row, point, own: own !== null, key });
    else if (!out[twin]!.own && own !== null) out[twin] = { row, point, own: true, key };
  }
  // The title, its shorter twin and the venue alone (the tram line after " · " is the wall's own words).
  return out.map(({ row }) => row)
    .filter((row) => vetted(input, [['title', row.title], ['title', row.titleShort], ['name', row.subShort ?? row.sub]]))
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
    layer: 'zrak-i-nebo',
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
    // The shorter complete label (timeline.ts): the next two lines, one line at every wall width.
    ...(services.length > 2 ? { subShort: servicesLine(services.slice(0, 2)) } : {}),
    live: false,
    source: 'zet-gtfs',
    ...placeSelection(place),
    services,
  }];
}

// --- (f) the next morning line to start, from 22:00 until all start or 06:00 -------

function firstTramRows(input: NearbyInput): NearbyRow[] {
  const { now, lastRun, place, i18n } = input;
  if (lastRun?.status !== 'live') return [];
  const today = zagrebDayKey(now);
  const hour = zagrebHour(now) ?? 12;
  if (hour < FIRST_TRAM_FROM_HOUR && hour >= NIGHT_UNTIL_HOUR) return [];
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
    if (first && first.at > now && vetted(input, [['headsign', routeName]])) services.push({ routeId, routeName, atMs: first.at });
  }
  if (services.length === 0) return [];
  services.sort(byService);
  // Decision 27: one line starting does not mean all lines are running.
  return [{
    id: `first:${serviceDate}`,
    kind: 'first',
    atMs: services[0]!.atMs,
    always: false,
    title: i18n.t('kiosk.nearby.firstTram'),
    sub: servicesLine(services),
    // The shorter complete label (timeline.ts): the next two lines, one line at every wall width.
    ...(services.length > 2 ? { subShort: servicesLine(services.slice(0, 2)) } : {}),
    live: false,
    source: 'zet-gtfs',
    ...placeSelection(place),
    services,
  }];
}

// --- (g) openings: exhibitions by their venue's hours, tomorrow's openings when the evening empties ---------

/**
 * The opening rows: the exhibitions of the City's programme and the libraries' (exhibitionRows) and the catalogue's
 * openings of tomorrow (from 20:00 to 06:00, only when no event is left tonight, never on a holiday morning), a
 * catalogue row left out where an exhibition row stands at the same verified venue; nearest first, then by time,
 * at most MAX_OPENINGS.
 */
function openingRows(input: NearbyInput, events: readonly NearbyRow[]): NearbyRow[] {
  const exhibits = exhibitionRows(input, events);
  const venues = new Set(exhibits.map((e) => e.venueId).filter((id): id is string => id !== undefined));
  const catalogue = catalogueOpenings(input, events).filter((o) => !venues.has(o.venueId!));
  return [...exhibits, ...catalogue]
    .sort((a, b) => a.d - b.d || (a.row.atMs ?? 0) - (b.row.atMs ?? 0) || a.row.id.localeCompare(b.row.id))
    .slice(0, MAX_OPENINGS)
    .map(({ row }) => row);
}

interface OpeningCandidate { row: NearbyRow; d: number; venueId?: string }

function catalogueOpenings(input: NearbyInput, events: readonly NearbyRow[]): OpeningCandidate[] {
  const { now, place, radiusM, city, i18n } = input;
  const hour = zagrebHour(now) ?? 12;
  if (!(hour >= OPENINGS_FROM_HOUR || hour < NIGHT_UNTIL_HOUR)) return [];
  const today = zagrebDayKey(now);
  const morning = hour >= OPENINGS_FROM_HOUR ? shiftDay(today, 1) : today;
  // OSM and the catalogue do not say holiday hours: nothing opens on a public holiday (shared/city/holidays.ts).
  if (isPublicHoliday(morning)) return [];
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
    .map(({ place: p, at, d }) => ({
      d,
      venueId: p.id,
      row: {
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
      },
    }));
}

/**
 * The exhibitions (a day's listing of kultura-zg or programi) inside the circle, timed by their venue's hours and
 * never by a guess: an open library or cinema of the same name beside the point (OSM hours, until it closes), else
 * the verified venue's catalogue hours (openingSpans). Open now with 30 minutes or more left, a row stands at the
 * closing time ("do 19:00"); before the venue opens today, at the opening time; from 20:00, at tomorrow's first
 * opening. Nothing on a public holiday, nothing for an exhibition a timed event row already names.
 */
function exhibitionRows(input: NearbyInput, events: readonly NearbyRow[]): OpeningCandidate[] {
  const { now, place, radiusM, city } = input;
  const items = eventItems(input).filter((item) => (item.module === 'kultura-zg' || item.module === 'programi')
    && dataText(item, 'precision') === 'day' && item.until !== undefined);
  if (items.length === 0) return [];
  const hour = zagrebHour(now) ?? 12;
  const today = zagrebDayKey(now);
  const evening = hour >= OPENINGS_FROM_HOUR;
  const day = evening ? shiftDay(today, 1) : today;
  if (isPublicHoliday(day)) return [];
  const weekday = weekdayOf(day);
  const timedTitles = new Set(events.map((e) => normalName(e.title)));
  const out: OpeningCandidate[] = [];
  const seen = new Set<string>();
  for (const event of locatedEvents(items, city.places, now, 'week')) {
    const item = event.item;
    const start = Date.parse(item.at ?? '');
    const end = Date.parse(item.until ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || zagrebDayKey(start) > day) continue;
    const venue = event.venueIds.length === 1 ? city.places.find((p) => p.id === event.venueIds[0] && located(p)) : undefined;
    const point = pointOf(item) ?? (venue && located(venue) ? { lon: venue.lon, lat: venue.lat } : null) ?? input.venuePoint?.(item) ?? null;
    if (!point) continue;
    const d = distanceM(place, point);
    if (d > radiusM) continue;
    const venueLabel = venue?.name ?? (dataText(item, 'venue') || input.venueName?.(item) || '');
    // Check the external bytes first: collapsing whitespace must not repair a refused source name.
    if (!venueLabel || !vetted(input, [['title', item.title], ['name', venueLabel]])) continue;
    const venueName = oneLine(venueLabel);
    if (timedTitles.has(normalName(item.title))) continue;
    const timing = exhibitTiming(input, { point, venueName, venue, day, weekday, evening });
    // An exhibition that has ended before the venue's opening that day is not on show.
    if (!timing || end <= Math.max(now, timing.opensAt)) continue;
    const id = `open:exhibit:${item.id}:${day}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      d,
      ...(venue ? { venueId: venue.id } : {}),
      row: {
        id,
        kind: 'opening',
        atMs: timing.atMs,
        ...(timing.openNow ? { untilMs: timing.atMs } : {}),
        always: false,
        title: oneLine(item.title),
        sub: venueName,
        live: false,
        source: item.module,
        selection: { kind: 'item', id: publicItemKey(item.module, item.id), module: item.module },
        map: { id: venue?.id ?? item.id, geometry: { type: 'Point', coordinates: [point.lon, point.lat] } },
        detail: { kind: 'exhibit', venue: venueName, openNow: timing.openNow },
      },
    });
  }
  return out;
}

/** When an exhibition's row stands: open now until `atMs`, or opening at `atMs`; `opensAt` is that day's opening. */
function exhibitTiming(
  input: NearbyInput,
  at: { point: { lon: number; lat: number }; venueName: string; venue: Place | undefined; day: string; weekday: number; evening: boolean },
): { atMs: number; openNow: boolean; opensAt: number } | null {
  const { now } = input;
  if (!at.evening) {
    // (i) An open library or cinema of that name beside the point: OSM's hours, open now until it closes.
    const stems = stemWords(at.venueName);
    const open = (input.openPlaces ?? [])
      .filter((p) => (p.kind === 'knjiznica' || p.kind === 'kino') && Number.isFinite(p.closesAt) && p.closesAt - now >= EXHIBIT_OPEN_MIN_MS
        && distanceM(at.point, p) <= EXHIBIT_OPEN_PLACE_M && containsStems(stemWords(p.name), stems))
      .sort((a, b) => distanceM(at.point, a) - distanceM(at.point, b) || a.id.localeCompare(b.id))[0];
    if (open) return { atMs: open.closesAt, openNow: true, opensAt: now };
  }
  // (ii) The verified venue's catalogue hours for that weekday.
  const ranges = at.venue?.hours ? openingSpans(at.venue.hours)?.get(at.weekday) : undefined;
  if (!ranges) return null;
  // Source order is not clock order; touching or overlapping ranges describe one uninterrupted opening.
  const spans: { open: number; close: number }[] = [];
  for (const range of [...ranges].sort((a, b) => a.open - b.open || a.close - b.close)) {
    const previous = spans.at(-1);
    if (previous && range.open <= previous.close) previous.close = Math.max(previous.close, range.close);
    else spans.push({ ...range });
  }
  const instant = (minutes: number): number => localInstant(at.day, Math.floor(minutes / 60), minutes % 60);
  if (at.evening) {
    const first = spans[0]!;
    return { atMs: instant(first.open), openNow: false, opensAt: instant(first.open) };
  }
  for (const span of spans) {
    const open = instant(span.open);
    const close = instant(span.close);
    if (open <= now && now < close) return close - now >= EXHIBIT_OPEN_MIN_MS ? { atMs: close, openNow: true, opensAt: open } : null;
    if (open > now) return { atMs: open, openNow: false, opensAt: open };
  }
  return null;
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

type Spans = readonly { open: number; close: number }[] | null;

/**
 * The opening hours per weekday (0 Sunday … 6 Saturday; each range in minutes after midnight, in the text's order;
 * null for a day the text calls closed) from a catalogue `hours` text such as "pon-pet 08h-20h, sub 08h-14h" or
 * "uto-pet 11h-19h, sub i ned 11h-14h, pon zatvoreno". Conservative on purpose: any phrase it cannot read whole, a
 * range without a day ("08h-16h" says nothing about Saturday) and a range that is not a clock range running forwards
 * make it answer null; a day given two different sets of hours is left out.
 */
export function openingSpans(hours: string): Map<number, Spans> | null {
  return byDay(parseHours(hours), spansKey);
}

/**
 * The first opening per weekday (minutes after midnight; null for a day the text calls closed), as conservative as
 * openingSpans; a day given two different first openings is left out.
 */
export function openingTimes(hours: string): Map<number, number | null> | null {
  const firsts = byDay(parseHours(hours), (spans) => (spans === null ? 'closed' : String(spans[0]!.open)));
  return firsts ? new Map([...firsts].map(([day, spans]) => [day, spans === null ? null : spans[0]!.open])) : null;
}

/** Each day's hours as the text assigns them, in order; null when the text is not read whole. */
function parseHours(hours: string): { day: number; spans: Spans }[] | null {
  const text = hours.toLocaleLowerCase('hr').replace(/\s+/g, ' ').trim();
  if (!text || DOUBT.test(text)) return null;
  const segment = new RegExp(`\\s*[,.]?\\s*(${DAYS_RE})\\s+(${RANGES_RE}|zatvoreno)`, 'y');
  const out: { day: number; spans: Spans }[] = [];
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
    const spans = m[2] === 'zatvoreno' ? null : rangeSpans(m[2]!);
    if (spans === undefined) return null;
    for (const day of days) out.push({ day, spans });
  }
  return out;
}

/** The assignments per day, a day whose assignments disagree (by `key`) left out; null when none is left. */
function byDay(assigned: readonly { day: number; spans: Spans }[] | null, key: (spans: Spans) => string): Map<number, Spans> | null {
  if (!assigned) return null;
  const out = new Map<number, Spans>();
  const doubtful = new Set<number>();
  for (const { day, spans } of assigned) {
    if (out.has(day) && key(out.get(day)!) !== key(spans)) doubtful.add(day);
    out.set(day, spans);
  }
  for (const day of doubtful) out.delete(day);
  return out.size > 0 ? out : null;
}

function spansKey(spans: Spans): string {
  return spans === null ? 'closed' : spans.map((r) => `${r.open}-${r.close}`).join(',');
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

/** Every range of a segment in minutes; undefined when a time is not a clock time or a range runs backwards. */
function rangeSpans(ranges: string): { open: number; close: number }[] | undefined {
  const out: { open: number; close: number }[] = [];
  for (const range of ranges.split(/\s*(?:,|\si)\s*/)) {
    const m = /^(\d{1,2})(?:[.:](\d{2}))?h?\s*[-–]\s*(\d{1,2})(?:[.:](\d{2}))?h?$/.exec(range);
    if (!m) return undefined;
    const open = Number(m[1]) * 60 + Number(m[2] ?? 0);
    const close = Number(m[3]) * 60 + Number(m[4] ?? 0);
    if (Number(m[1]) > 23 || Number(m[2] ?? 0) > 59 || Number(m[4] ?? 0) > 59 || close > 24 * 60 || close <= open) return undefined;
    out.push({ open, close });
  }
  return out.length > 0 ? out : undefined;
}

// --- (i) the facts-breadth rows, one of each (U3.md S2, S3) ------------------------

/**
 * The trains from the nearest HŽ station inside the circle (the caller passes the two nearest stations' boards), as
 * ONE row: most people in the city rarely take a train, and Glavni kolodvor has one every few minutes, so the trains
 * take a single row however many there are (the wall draws it as a line of cells, the phone as a row with "zatim").
 * Only the trains still reachable on foot (WALK_MIN_PER_KM from the place to the station), at most `policy.railMax`
 * (RAIL_MAX_DEFAULT, three), the timetable's times, never live. The row is the first train's (time, headsign, badge:
 * the HŽ short name, "Vlak" where there is none) with the station under it; its id is the station's, so a train
 * leaving changes the row and does not replace it. A farther station is read only when the nearest has no train left.
 */
function railRows(input: NearbyInput): NearbyRow[] {
  const max = Math.max(0, Math.floor(input.policy?.railMax ?? RAIL_MAX_DEFAULT));
  const boards = (input.railBoards ?? []).filter((board) => board.operator === 'hz');
  if (max === 0 || boards.length === 0) return [];
  const { now, place, radiusM } = input;
  const stations: { station: Place & { lon: number; lat: number }; board: DepartureBoard; distance: number }[] = [];
  for (const p of input.city.places) {
    if (p.category !== 'rail' || !located(p)) continue;
    const distance = distanceM(place, p);
    const board = boards.find((b) => b.stopId === p.sourceRecord);
    if (distance <= radiusM && board && !stations.some((s) => s.station.sourceRecord === p.sourceRecord)) stations.push({ station: p, board, distance });
  }
  stations.sort((a, b) => a.distance - b.distance || a.station.id.localeCompare(b.station.id));
  for (const { station, board, distance } of stations) {
    if (!vetted(input, [['name', station.name]])) continue;
    // A train that leaves before the walk to its station is over is not one to wait for.
    const reachableAt = now + (distance / 1000) * WALK_MIN_PER_KM * MINUTE_MS;
    const { rows } = arrivalsAt([board], [], now, { stopIds: [board.stopId], rows: 12 });
    const trains: ArrivalRow[] = [];
    for (const arrival of rows) {
      if (trains.length >= max) break;
      if (arrival.atMs < reachableAt || !arrival.headsign) continue;
      if (!vetted(input, [['headsign', arrival.headsign]])) continue;
      trains.push(arrival);
    }
    const first = trains[0];
    if (!first) continue;
    const routeName = RAIL_SHORT_NAME.test(first.routeName) ? first.routeName : input.i18n.t('arrivals.train');
    if (!vetted(input, [['headsign', routeName]])) continue;
    const title = oneLine(first.headsign);
    const sub = oneLine(station.name);
    const titleShort = railPlaceName(title);
    const subShort = railPlaceName(sub);
    return [{
      id: `rail:${station.sourceRecord}`,
      kind: 'rail',
      atMs: first.atMs,
      always: false,
      title,
      sub,
      ...(titleShort !== title ? { titleShort } : {}),
      ...(subShort !== sub ? { subShort } : {}),
      live: false,
      source: 'hz',
      ...placeRef(station),
      map: { id: station.id, geometry: { type: 'Point', coordinates: [station.lon, station.lat] } },
      arrival: { ...first, routeName, live: false, minutes: null },
      detail: { kind: 'rail', trains: trains.map((t) => ({ id: t.tripId || `${t.routeId}:${t.atMs}`, atMs: t.atMs, to: oneLine(t.headsign) })) },
    }];
  }
  return [];
}

/**
 * The nearest DHMZ station's first wet step (dhmz-hourly) that has not ended and starts within RAIN_AHEAD_MS: the
 * weather of the area, so the station is the nearest one whatever the circle (the KPI's rule). Titled by the rain
 * word the worker wrote, in the locale's words; the chance under it.
 */
function rainRows(input: NearbyInput): NearbyRow[] {
  const snapshot = u3Snapshot(input.snapshots, 'dhmz-hourly');
  const { now, place, i18n } = input;
  // The station is chosen as the inset and the dry-spell fact choose it (kiosk/local.ts nearestHourlySteps).
  const hourly = snapshot ? nearestHourlySteps(snapshot, place) : null;
  if (hourly) {
    const words = kioskStrings(i18n.getLocale()).nearby.rain;
    const steps = hourly.steps.filter(({ at, until }) => until > now && at <= now + RAIN_AHEAD_MS);
    for (const { item, at, until } of steps) {
      // A wet step carries its word; a step without one (dry, or too near freezing to call it rain) says nothing.
      const word = RAIN_WORDS[dataText(item, 'weather')];
      if (!word) continue;
      const prob = dataNumber(item, 'prob');
      const percent = prob !== null && Math.round(prob) >= 1 && Math.round(prob) <= 100 ? Math.round(prob) : null;
      const condition = words[word];
      const title = condition.charAt(0).toLocaleUpperCase(i18n.getLocale()) + condition.slice(1);
      const sub = percent === null ? '' : i18n.t('kiosk.nearby.rainChance', { p: percent });
      if (!vetted(input, [['title', title], ['summary', sub]])) continue;
      return [{
        id: `rain:${item.id}`,
        kind: 'rain',
        atMs: at,
        untilMs: until,
        always: false,
        title,
        sub,
        live: false,
        source: 'dhmz-hourly',
        layer: 'zrak-i-nebo',
        detail: { kind: 'rain', word, percent },
      }];
    }
  }
  // R3: no wet step within two hours, but DHMZ's radar shows rain near Zagreb now: one row at the image's time (stable
  // between paints) for as long as the radar item stands. A wet step keeps the forecast row (it has the time and the
  // chance); there is one rain row either way.
  const radar = radarNow(Object.values(input.snapshots).filter((s): s is ModuleSnapshot => s !== undefined), now);
  if (!radar?.rainNear) return [];
  const radarWord = kioskStrings(i18n.getLocale()).nearby.rainRadar;
  const title = radarWord.charAt(0).toLocaleUpperCase(i18n.getLocale()) + radarWord.slice(1);
  if (!vetted(input, [['title', title]])) return [];
  return [{
    id: `rain:radar:dhmz-radar:${radar.src.split('?v=')[1]}`,
    kind: 'rain',
    atMs: radar.atMs,
    untilMs: radar.untilMs,
    always: false,
    title,
    sub: '',
    live: false,
    source: 'dhmz-radar',
    layer: 'zrak-i-nebo',
    detail: { kind: 'radar' },
  }];
}

/**
 * The nearest power, water or gas cut inside the circle (prekidi) that has not ended and starts within CUT_AHEAD_MS: the
 * street as the index spells it (with its house numbers while they are short), "bez struje 08:00–14:00" under it,
 * or "bez vode" for a whole day. Before it starts the row stands at its start, once it runs at its end.
 */
function cutRows(input: NearbyInput): NearbyRow[] {
  const snapshot = u3Snapshot(input.snapshots, 'prekidi');
  if (!snapshot || snapshot.status === 'down') return [];
  const { now, place, radiusM, i18n } = input;
  const candidates = nearestItems(snapshot.items.filter((item) => String(item.kind) === 'cut'), place, radiusM)
    .map((c) => ({ ...c, start: Date.parse(c.item.at ?? ''), until: Date.parse(c.item.until ?? '') }))
    .filter(({ start, until }) => Number.isFinite(start) && until > start && until > now && start <= now + CUT_AHEAD_MS);
  for (const { item, point, start, until } of candidates) {
    const utility = dataText(item, 'utility');
    if (utility !== 'struja' && utility !== 'voda' && utility !== 'plin') continue;
    const allDay = dataText(item, 'precision') === 'day';
    // A whole-day notice is the water or gas utility's (VIO, GPZ); a power cut always has its hours (HEP).
    if (allDay && utility === 'struja') continue;
    if (!vetted(input, [['address', item.title]])) continue;
    const street = oneLine(item.title);
    // The house numbers ride on the street while they are short and the street with them still reads as an address
    // (alone, "12-20" is a phone number to the check); refused, they are simply not carried and the street stands.
    const numbers = oneLine(dataText(item, 'houseNumbers'));
    const numbered = numbers && numbers.length < CUT_NUMBERS_MAX_CHARS ? `${street} ${numbers}` : '';
    const title = numbered && externalText('address', `${item.title} ${dataText(item, 'houseNumbers')}`, { surface: 'row' }).ok ? numbered : street;
    const range = { from: zagrebTime(start), until: zagrebTime(until) };
    const sub = allDay ? i18n.t(utility === 'plin' ? 'kiosk.nearby.cut.plinDay' : 'kiosk.nearby.cut.vodaDay')
      : i18n.t(utility === 'struja' ? 'kiosk.nearby.cut.struja' : utility === 'plin' ? 'kiosk.nearby.cut.plin' : 'kiosk.nearby.cut.voda', range);
    if (!vetted(input, [['address', title], ['summary', sub.replace(CLOCK_RANGE_TAIL, '')]])) continue;
    return [{
      id: `cut:${item.id}`,
      kind: 'cut',
      atMs: now < start ? start : until,
      untilMs: until,
      always: false,
      title,
      // The street alone, whole: the house numbers are the part a crowded list can do without.
      ...(title !== street ? { titleShort: street } : {}),
      sub,
      live: false,
      source: 'prekidi',
      map: { id: item.id, geometry: { type: 'Point', coordinates: [point.lon, point.lat] } },
      detail: { kind: 'cut', utility, street, fromMs: start, untilMs: until, allDay },
    }];
  }
  return [];
}

/** The nearest HAK road state inside the circle (hak) whose end is within ROAD_AHEAD_MS: the row stands at its end, as a closure's does. */
function roadRows(input: NearbyInput): NearbyRow[] {
  const snapshot = u3Snapshot(input.snapshots, 'hak');
  if (!snapshot || snapshot.status === 'down') return [];
  const { now, place, radiusM } = input;
  const words = kioskStrings(input.i18n.getLocale()).nearby.road;
  const candidates = nearestItems(snapshot.items.filter((item) => String(item.kind) === 'road'), place, radiusM)
    .map((c) => ({ ...c, until: Date.parse(c.item.until ?? '') }))
    .filter(({ until }) => until > now && until <= now + ROAD_AHEAD_MS);
  for (const { item, point, until } of candidates) {
    const state = ROAD_STATES[dataText(item, 'state')];
    if (!state || !vetted(input, [['name', item.title]])) continue;
    return [{
      id: `road:${item.id}`,
      kind: 'road',
      atMs: until,
      always: false,
      title: oneLine(item.title),
      sub: words[state],
      live: false,
      source: 'hak',
      map: { id: item.id, geometry: { type: 'Point', coordinates: [point.lon, point.lat] } },
      detail: { kind: 'road', state },
    }];
  }
  return [];
}

/**
 * The places open now inside the circle (OpenStreetMap hours), at most two: by the Zagreb hour's band (OPEN_BANDS),
 * one of a useful kind and one of a leisure kind, in each list the first kind present, its nearest place (ties by
 * id), standing at its closing time ("do 22:00"). Beside the night pharmacy row the useful list skips pharmacies
 * (the duty pharmacy row names one); the last band runs to 02:00, so a bar open until 04:00 is a fact until 02:00.
 * Never the same place twice.
 */
function openRows(input: NearbyInput, timeless: readonly NearbyRow[]): NearbyRow[] {
  const places = input.openPlaces ?? [];
  if (places.length === 0) return [];
  const hour = zagrebHour(input.now) ?? 12;
  const band = OPEN_BANDS.find((b) => (hour >= b.from && hour < b.to) || (hour + 24 >= b.from && hour + 24 < b.to));
  if (!band) return [];
  const { now, place, radiusM } = input;
  const words = kioskStrings(input.i18n.getLocale()).nearby.openKind;
  const nightPharmacy = timeless.some((row) => row.kind === 'pharmacy');
  const useful = nightPharmacy ? band.useful.filter((kind) => kind !== 'ljekarna') : band.useful;
  const out: NearbyRow[] = [];
  const taken = new Set<string>();
  for (const kinds of [useful, band.leisure]) {
    const row = firstOpen(kinds);
    if (row) out.push(row);
  }
  return out;

  function firstOpen(kinds: readonly OpenKind[]): NearbyRow | null {
    for (const kind of kinds) {
      const found = places
        .filter((p) => p.kind === kind && !taken.has(p.id) && Number.isFinite(p.lon) && Number.isFinite(p.lat) && Number.isFinite(p.closesAt) && p.closesAt > now)
        .map((p) => ({ p, d: distanceM(place, p) }))
        .filter(({ d }) => d <= radiusM)
        .sort((a, b) => a.d - b.d || a.p.id.localeCompare(b.p.id));
      for (const { p } of found) {
        if (!vetted(input, [['name', p.name]])) continue;
        taken.add(p.id);
        return {
          id: `opennow:${p.id}`,
          kind: 'open',
          atMs: p.closesAt,
          always: false,
          title: oneLine(p.name),
          sub: words[kind],
          live: false,
          source: 'osm-hours',
          map: { id: `opennow:${p.id}`, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } },
          detail: { kind: 'open', openKind: kind },
        };
      }
    }
    return null;
  }
}

/** Items with a point inside the circle, nearest first (ties by id). */
function nearestItems(items: readonly FeedItem[], place: ScreenPlace, radiusM: number): { item: FeedItem; point: { lon: number; lat: number }; d: number }[] {
  const out: { item: FeedItem; point: { lon: number; lat: number }; d: number }[] = [];
  for (const item of items) {
    const point = pointOf(item);
    if (!point) continue;
    const d = distanceM(place, point);
    if (d <= radiusM) out.push({ item, point, d });
  }
  return out.sort((a, b) => a.d - b.d || a.item.id.localeCompare(b.item.id));
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
    const verdict = externalText(kind, value, { surface: 'row' });
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
