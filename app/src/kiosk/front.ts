// The public screen's front page: five panels of the city read from the
// teaser's nine modules, each a list a person in front of the screen can use
// (plan "/kiosk/: a screen a person can use"). Every source the app fetches
// is here with its credit; nothing is ranked away into one sentence. Pure:
// readers in, HTML strings out; kiosk/invitation.ts mounts the panels, hosts
// the map between them and hides the rows a panel's box does not hold whole.
//
//   tonight  today's events by start (running ones after the upcoming), then
//            tomorrow's, each marked; time · title · category, venue, source
//   weather  tomorrow's forecast as the figure, today's range under it (DHMZ)
//   city     the next Assembly session, the gazette's issue and its acts, the
//            kvart news (Skupština, Grad Zagreb)
//   promet   the stop's lines with their state words and vehicles near, the
//            last departures from 20:00, ZET's newest notice
//   around   closures within 1.5 km by distance, works under way in the city
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import type { ScreenStop } from '../core/contracts';
import type { LastRunSnapshot } from '../core/lastrun';
import { delayTone } from '../experience/delay';
import type { I18n } from '../i18n/i18n';
import { dataNumber, dataText } from '../panels/panel';
import { routeEnds } from '../transport/catalogue';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { clock, dayKey, dayMonth, fmtDistance, fmtNumber, sameZagrebDay, weekdayDayMonth, zagrebDayAfter } from './format';
import {
  byModule, cleanCondition, closuresByDistance, isLive, lastDeparturesAhead, linesAtStop, NEARBY_CLOSURE_M, nearbyVehicleCount, nextSession,
  routeDelays, sourceState, worksInKvart, type LinesBoard, type SourceState,
} from './local';
import { delayWord } from '../layers/shared';
import { arrivalsEmptyText, type BoardSubject } from './arrivals';
import { GAZETTE_CONTENTS_TITLE, kindOfRoute, rankedExceptions, zetNotices } from './exceptions';
import { kBadge } from './markup';
import { fill, plural, type KioskStrings } from './strings';
import { districtLabel } from './districts';
import type { Composition } from './layout';
import type { ActiveVenue } from '../../../shared/city/events';
import { venueOutsideZagreb, cultureEvents as clientCultureEvents, upcomingEvents, ongoingEvents } from '../layers/kultura';
import { weatherMarkup } from './markup';
import { weatherNow } from './local';
import { weatherIcon } from '../experience/weather-icon';
import { iconMarkup } from '../ui/icons';
import { externalHtml, optionalExternal } from './external';
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';

export type PanelId = 'tonight' | 'weather' | 'city' | 'promet' | 'around';
export const PANEL_IDS: readonly PanelId[] = ['tonight', 'weather', 'city', 'promet', 'around'];

export interface FrontInput {
  modules: readonly ModuleSnapshot[];
  stop: ScreenStop | null;
  now: number;
  lastRun: LastRunSnapshot | null;
  strings: KioskStrings;
  i18n: I18n;
  locale: string;
  /** R-L2: no map under lagano, so the field is the lines board and the promet panel does not repeat the lines. */
  lightweight: boolean;
  composition?: Composition;
  /** What the promet panel says: the stop's line board (the paired
   *  compositions, the default) or the city's exceptions (the front card). */
  prometMode?: PrometMode;
  /** Rows in place of the mode's own: a stop's arrivals, once settings can
   *  choose one (WP5b). The panel keeps its kicker and its credit. */
  prometRows?: FrontRow[];
  /** What those rows are a board OF: the stop's own state, how many rows the
   *  board actually holds, and how many platforms were merged into it. With
   *  this the card names its own subject rather than the city's counts, says
   *  how many departures it had no room for, and takes its note from the
   *  board -- never from the vehicle feed, whose being down is exactly when a
   *  timetable board is worth most. */
  prometBoard?: BoardSubject;
  /** How many rows the events card's measured room holds (kiosk/invitation.ts
   *  measures it); the composition's own cap otherwise. A card that fills the
   *  aside's height must be given enough rows to fill it with. */
  eventRows?: number;
  /** How many exception lines the aside can spare for the promet card, measured
   *  the same way; never more than the composition's cap (EXCEPTION_LINES). */
  prometLines?: number;
}

/** The two readings of transit a panel can carry (prometPanel). */
export type PrometMode = 'lines' | 'exceptions';

/** One row of a panel's list: a lead cell (a time, a distance, a badge), a title, one line of context. */
export interface FrontRow {
  key: string;
  /** The lead cell's text: a clock, a distance, a day word; empty with a badge. */
  lead?: string;
  /** A day word over the lead ("sutra") when the row is not today's. */
  day?: string;
  /** Trusted markup for the lead cell (a line badge). */
  leadMarkup?: string;
  title: string;
  sub?: string;
  /** Trusted markup at the row's end, hard right: a departure's time. The
   *  time keeps its own column at every size -- a title too long for its cell
   *  wraps inside it, never under the trail and never cut -- because a board
   *  read from across a room is a column of times, not a column of paragraphs. */
  trail?: string;
  tone?: 'late' | 'early' | 'ontime' | 'unknown';
}

export interface FrontPanel {
  id: PanelId;
  kicker: string;
  meta?: string;
  rows: FrontRow[];
  /** A sentence in place of rows: loading, down, or a true empty. */
  note?: string;
  /** Trusted markup above the rows (the weather figure). */
  figureMarkup?: string;
  /** Trusted markup under the rows (the last departures line). */
  footMarkup?: string;
  credit?: string;
  state?: SourceState;
}

// --- Rows the panels share -------------------------------------------------------

const startOf = (item: FeedItem): number => (item.at ? Date.parse(item.at) : NaN);
const isDatedEvent = (item: FeedItem): boolean => item.dateBasis === 'event' && Number.isFinite(startOf(item));
const hasEnded = (item: FeedItem, now: number): boolean => {
  const end = item.until ? Date.parse(item.until) : NaN;
  return Number.isFinite(end) && end < now;
};

/** The i18n name of an events source ("Kulturpunkt", "Etnografski muzej"); '' for one the catalogue has no word for. */
function sourceName(i18n: I18n, source: string): string {
  const key = `events.sources.${source}`;
  const name = i18n.t(key);
  return name === key ? '' : name;
}

/** The kiosk's lowercase word for an event's category; '' when the catalogue has none. */
function categoryWord(s: KioskStrings, item: FeedItem): string {
  return s.events[dataText(item, 'category')] ?? '';
}

/** A dated event as a row: the clock (or the all-day word) in the lead, the title, category · venue · source under it. */
function eventRow(item: FeedItem, s: KioskStrings, i18n: I18n, day?: string): FrontRow {
  const timed = dataText(item, 'precision') === 'time';
  const source = dataText(item, 'source');
  return {
    key: `event:${item.id}`,
    lead: timed ? clock(item.at) : s.say.allDay,
    day,
    title: item.title,
    sub: [categoryWord(s, item), dataText(item, 'venue'), sourceName(i18n, source)].filter(Boolean).join(' · '),
  };
}

/** The source credit of a set of event rows, each source once, in order of first appearance. */
function eventCredit(items: readonly FeedItem[], i18n: I18n): string {
  const names: string[] = [];
  for (const item of items) {
    const name = sourceName(i18n, dataText(item, 'source'));
    if (name && !names.includes(name)) names.push(name);
  }
  return names.join(' · ');
}

// --- tonight -------------------------------------------------------------------------

/** Culture and community events: every dated row that is not the Assembly's (the city panel has those). */
function cultureEvents(dogadanja: ModuleSnapshot | undefined): FeedItem[] {
  return clientCultureEvents(dogadanja).filter(item => !venueOutsideZagreb(item) && isDatedEvent(item));
}

export function tonightPanel(input: FrontInput): FrontPanel {
  const { strings: s, i18n, now } = input;
  const dogadanja = byModule(input.modules).dogadanja;
  const state = sourceState(dogadanja);
  const all = cultureEvents(dogadanja);
  const today = all.filter((item) => sameZagrebDay(item.at!, now) && !hasEnded(item, now));
  // What is still to come tonight first, then what is running (an exhibition opened at 19:00 that has not closed).
  const upcoming = today.filter((item) => startOf(item) >= now).sort((a, b) => startOf(a) - startOf(b));
  const running = today.filter((item) => startOf(item) < now).sort((a, b) => startOf(b) - startOf(a));
  const tomorrowKey = zagrebDayAfter(now, 1);
  const tomorrow = all.filter((item) => dayKey(item.at!) === tomorrowKey).sort((a, b) => startOf(a) - startOf(b));
  const future = upcomingEvents(all, now).filter(item => !sameZagrebDay(item.at!, now) && dayKey(item.at!) !== tomorrowKey);
  const ongoing = ongoingEvents(all, now).filter(item => !sameZagrebDay(item.at!, now));
  const rows = [
    ...upcoming.map((item) => eventRow(item, s, i18n)),
    ...running.map((item) => eventRow(item, s, i18n)),
    ...tomorrow.map((item) => eventRow(item, s, i18n, s.say.tomorrow)),
    ...ongoing.map(item => eventRow(item, s, i18n, s.paired.ongoingWord)),
    ...future.map(item => eventRow(item, s, i18n, weekdayDayMonth(input.locale, item.at!))),
  ];
  const meta = [today.length > 0 ? plural(input.locale, s.front.eventsToday, today.length) : '', tomorrow.length > 0 ? plural(input.locale, s.front.eventsTomorrow, tomorrow.length) : ''].filter(Boolean).join(' · ');
  const note = state === 'loading' ? i18n.t('status.loading') : state === 'down' ? s.paired.sourceDown : rows.length === 0 ? s.front.eventsNone : undefined;
  return {
    id: 'tonight',
    kicker: i18n.t('layers.kultura'),
    meta,
    rows,
    note,
    credit: eventCredit([...today, ...tomorrow, ...ongoing, ...future], i18n),
    state,
  };
}

// --- weather -------------------------------------------------------------------------

function forecastFor(snap: ModuleSnapshot | undefined, key: string): FeedItem | undefined {
  return snap?.items.find((item) => item.kind === 'forecast' && item.at && dayKey(item.at) === key);
}

function rangeOf(item: FeedItem, s: KioskStrings, locale: string): string {
  const tmin = dataNumber(item, 'tmin');
  const tmax = dataNumber(item, 'tmax');
  return tmin !== null && tmax !== null ? fill(s.weather.range, { min: fmtNumber(locale, tmin, 0), max: fmtNumber(locale, tmax, 0) }) : s.paired.rangeUnknown;
}

/** DHMZ's forecast 'vrijeme' is sometimes a symbol code, never a word to print. */
function conditionWord(item: FeedItem): string {
  const raw = dataText(item, 'weather');
  return /^\d+$/.test(raw) ? '' : cleanCondition(raw);
}

export function weatherPanel(input: FrontInput): FrontPanel {
  const { strings: s, now, locale } = input;
  const snap = byModule(input.modules)['dhmz-forecast'];
  const state = sourceState(snap);
  const today = forecastFor(snap, dayKey(now));
  const tomorrow = forecastFor(snap, zagrebDayAfter(now, 1));
  // The card is the reading and the two ranges. DHMZ's narrative is a
  // sentence, not a figure, so the card leaves it out.
  const observed = weatherNow(input.modules, s, locale);
  const glyph = weatherIcon(observed.condition);
  // A source that is loading or down says so; only a live observation without a
  // number says "bez očitanja temperature". Never a dash (PRODUCT.md, principle 4).
  const reading = observed.temperature ?? (observed.state === 'loading' ? s.weather.loading : observed.state === 'down' ? s.weather.unavailable : s.weather.noReading);
  // The glyph and the reading, the condition word under them: inline it widens
  // the observation until the ranges beside it are clipped mid-degree.
  const figure = `<div class="k-weather-current"><div class="k-weather-main">${glyph ? iconMarkup(glyph, undefined, 'icon k-weather-icon') : ''}<span class="${observed.temperature === null ? 'k-weather-note' : 'k-temp'}">${escapeHtml(reading)}</span></div>${observed.condition ? `<p class="k-condition">${externalHtml('summary', observed.condition)}</p>` : ''}</div>`;
  const rows: FrontRow[] = [];
  for (const [key, day, item] of [['today', s.say.today, today], ['tomorrow', s.say.tomorrow, tomorrow]] as const) {
    if (item) rows.push({ key: `forecast:${key}`, lead: day, title: rangeOf(item, s, locale), sub: conditionWord(item) || undefined });
  }
  const note = rows.length > 0 ? undefined : state === 'loading' ? s.weather.loading : state === 'down' ? s.paired.sourceDown : s.paired.rangeUnknown;
  return {
    id: 'weather',
    kicker: input.i18n.t('layers.zrak-i-nebo'),
    // The source and the clock it read at, where every other panel puts its
    // meta; under a kicker that says VRIJEME the word "opaženo" is a wasted
    // line on a 254 px card, so the meta is the hour alone. No second credit.
    meta: [`DHMZ${observed.observedMs === null ? '' : ` · ${clock(observed.observedMs)}`}`, observed.state === 'stale' ? s.paired.stale : ''].filter(Boolean).join(' · '),
    rows,
    note,
    figureMarkup: figure,
    state,
  };
}

// --- city ------------------------------------------------------------------------------

const ASSEMBLY_SOURCE = 'Skupština Grada Zagreba';
const CITY_SOURCE = 'Grad Zagreb';
/** How many of the issue's acts the panel names; the fitter hides what the box does not hold. */
const GAZETTE_ACTS = 3;
const KVART_NEWS = 3;

export function cityPanel(input: FrontInput): FrontPanel {
  const { strings: s, now, locale } = input;
  const map = byModule(input.modules);
  const rows: FrontRow[] = [];
  const session = nextSession(input.modules, now);
  if (session?.at) {
    const at = Date.parse(session.at);
    const dayWord = sameZagrebDay(at, now) ? s.say.today : dayKey(at) === zagrebDayAfter(now, 1) ? s.say.tomorrow : weekdayDayMonth(locale, at);
    const timed = dataText(session, 'precision') === 'time';
    rows.push({ key: `session:${session.id}`, lead: timed ? clock(at) : s.say.allDay, day: dayWord, title: session.title, sub: [dataText(session, 'venue'), ASSEMBLY_SOURCE].filter(Boolean).join(' · ') });
  }
  const glasnik = map.glasnik;
  if (isLive(glasnik) && glasnik.items.length > 0) {
    const issue = glasnik.items[0]!;
    const number = `${dataText(issue, 'broj')}/${dataText(issue, 'godina')}`;
    const acts = glasnik.items.filter((act) => act.title !== GAZETTE_CONTENTS_TITLE);
    const published = issue.at ? fill(s.story.published, { time: dayMonth(issue.at) }) : '';
    rows.push({ key: 'gazette', lead: number, title: `${s.paired.acts} · ${plural(locale, s.front.acts, acts.length)}`, sub: [published, CITY_SOURCE].filter(Boolean).join(' · ') });
    for (const act of acts.slice(0, GAZETTE_ACTS)) rows.push({ key: `act:${act.id}`, lead: s.front.actLead, title: act.title, sub: `${s.paired.acts} ${number}` });
  }
  const dogadanja = map.dogadanja;
  const news = (isLive(dogadanja) ? dogadanja.items : []).filter((item) => dataText(item, 'source') === 'kvartovske').slice(0, KVART_NEWS);
  for (const item of news) rows.push({ key: `kvart:${item.id}`, lead: s.front.kvartLead, title: item.title, sub: s.story.neighbourhood });
  const state = sourceState(dogadanja);
  return {
    id: 'city',
    kicker: s.front.city,
    meta: CITY_SOURCE,
    rows,
    note: rows.length === 0 ? (state === 'loading' ? input.i18n.t('status.loading') : state === 'down' ? s.paired.sourceDown : s.story.empty) : undefined,
    credit: [ASSEMBLY_SOURCE, s.paired.acts, s.story.neighbourhood].join(' · '),
    state,
  };
}

// --- promet ---------------------------------------------------------------------------

/** The lines the panel lists before "+N": the stop's routes in rider order, trams first. */
const PROMET_LINES = 8;

/** The most exceptions a card will name before the rest are the ticker's and
 *  the meta's. A card, not a board: the aside's height belongs to the events
 *  card, whose two-row floor comes first, so kiosk/invitation.ts measures the
 *  room and asks for fewer (`prometLines`) when a card cannot hold all three. */
export const EXCEPTION_LINES: Readonly<Record<Composition, number>> = { wide: 3, compact: 2, portrait: 3, handheld: 3 };

/** The stop's line board: one row per route with its state word and the
 *  vehicles near, plus ZET's newest notice and the last departures. */
function linesRows(input: FrontInput, board: LinesBoard): FrontRow[] {
  const { strings: s, i18n, locale } = input;
  const delays = routeDelays(byModule(input.modules)['zet-rt']);
  return board.rows.map((row) => {
    const toneRaw = delayTone(i18n, delays.get(row.routeId));
    const kindWord = row.kind === 'tram' ? s.lines.tram : row.kind === 'bus' ? s.lines.bus : '';
    const near = row.nearby > 0 ? plural(locale, s.lines.nearby, row.nearby) : s.lines.noneNearby;
    return {
      key: `line:${row.routeId}`,
      leadMarkup: kBadge(row.label, row.kind, `${kindWord} ${row.label}`.trim()),
      title: routeEnds(row.longName) || row.longName,
      sub: [row.word || s.say.transitNoData, near].join(' · '),
      tone: toneRaw === 'none' ? 'unknown' : toneRaw,
    };
  });
}

/** The card's own reading of the city's exceptions (kiosk/exceptions.ts holds
 *  the filter and the order the header's line reads too): as many rows as the
 *  box was given, and how many were left over for the meta to count. A screen
 *  set to a stop reads its own lines first -- the count of the rest stays the
 *  city's, because a closed street two quarters away is still news on a wall. */
export function exceptionRows(input: FrontInput): { rows: FrontRow[]; more: number } {
  const { strings: s, i18n } = input;
  const all = rankedExceptions(input.modules, input.stop?.routes ?? null);
  const cap = EXCEPTION_LINES[input.composition ?? 'wide'];
  const rows = all.slice(0, Math.max(1, Math.min(input.prometLines ?? cap, cap))).map(({ routeId, seconds, kind }) => {
    const kindWord = kind === 'tram' ? s.lines.tram : kind === 'bus' ? s.lines.bus : '';
    const toneRaw = delayTone(i18n, seconds);
    return {
      key: `line:${routeId}`,
      leadMarkup: kBadge(routeId, kind, `${kindWord} ${routeId}`.trim()),
      title: delayWord(i18n, seconds),
      tone: toneRaw === 'none' ? 'unknown' : toneRaw,
    } satisfies FrontRow;
  });
  return { rows, more: all.length - rows.length };
}

/**
 * Transit, in one of two readings. `lines` is the stop's board -- the paired
 * compositions' Promet, a row per route with its state word, the newest ZET
 * notice and the last departures from 20:00 (R-KP6, R-KP14). `exceptions` is
 * the front page's card: only what departs from the timetable -- the late
 * lines, the closures counted, ZET's notices counted -- and "Linije voze po
 * redu" when the network has nothing to report. A caller that has a stop's
 * arrivals passes them as `prometRows` and the card becomes that board, with
 * the arrivals attribution under it.
 */
export function prometPanel(input: FrontInput): FrontPanel {
  const { strings: s, i18n, now, locale, stop } = input;
  const zet = byModule(input.modules)['zet-rt'];
  const state = sourceState(zet);
  const exceptions = input.prometMode === 'exceptions';
  const board = linesAtStop(input.modules, stop, i18n, PROMET_LINES);
  const supplied = input.prometRows;
  const boardOf = supplied ? input.prometBoard : undefined;
  const late = exceptions && !supplied && !input.lightweight ? exceptionRows(input) : { rows: [], more: 0 };
  const rows: FrontRow[] = supplied ?? (input.lightweight ? [] : exceptions ? late.rows : linesRows(input, board));
  const notices = zetNotices(input.modules, now);
  if (!exceptions && !supplied && notices[0]) {
    // The newest ZET notice as the board's last row: what the network says about itself.
    const notice = notices[0];
    rows.push({ key: `notice:${notice.id}`, lead: 'ZET', title: notice.title, sub: `${s.say.zet} · ${clock(notice.at)}` });
  }
  // From 20:00: the last departures, soonest first, as one line of badge-and-time pairs (R-KP6, R-KP14).
  const departures = exceptions ? [] : lastDeparturesAhead(input.lastRun, stop, now);
  // A trimmed board says so in the row fitter's own words (paired.ts fitRows,
  // "prikazano N od M"): a card that quietly dropped the next three trams
  // would read as a stop with nothing else coming.
  const trimmed = supplied && boardOf && boardOf.total > supplied.length
    ? `<p class="k-line-more k-row-more">${escapeHtml(fill(s.paired.coverage, { shown: supplied.length, total: boardOf.total }))}</p>`
    : '';
  // No estimate on a public screen stands unattributed: the sentence the phone
  // sheet and the tapped card carry goes under the rows here too, at the
  // card's credit size -- a note's size wrapped it to five lines of a 320 px
  // column and pushed the QR card out of the aside.
  const foot = supplied && supplied.length > 0
    ? `${trimmed}<p class="k-panel-attrib">${escapeHtml(s.arrivals.note)}</p>`
    : departures.length > 0
      ? `<p class="k-panel-foot" data-testid="kiosk-lastrun"><span class="k-panel-foot-label">${escapeHtml(i18n.t('tiles.lastRun'))}</span> ${departures.map((d) => `<span class="k-pair">${kBadge(d.routeId, kindAtStop(board, d.routeId), '')} <time datetime="${escapeAttribute(new Date(d.at).toISOString())}">${escapeHtml(clock(d.at))}</time></span>`).join(' ')} <span class="k-panel-foot-note">${escapeHtml(i18n.t('tiles.scheduled'))}</span></p>`
      : undefined;
  const nearby = nearbyVehicleCount(zet, stop);
  const time = clock(zet?.sourceUpdatedAt ?? zet?.fetchedAt);
  const closed = closuresByDistance(byModule(input.modules).prometnice, null, now).length;
  // A board's caption is the board's own subject -- which stop this is, and
  // how many platforms were merged into it. The city's closure and notice
  // counts belong to the card that is showing the city. The exceptions card
  // counts what it does not list; the lines board names the vehicles near.
  const meta = supplied
    ? [stop?.name ?? '', boardOf && boardOf.platforms > 1 ? plural(locale, s.platforms, boardOf.platforms) : ''].filter(Boolean).join(' · ')
    : state === 'loading' || state === 'down'
    ? ''
    : exceptions
      ? [late.more > 0 ? plural(locale, s.front.moreLate, late.more) : '', closed > 0 ? plural(locale, s.front.closures, closed) : '', notices.length > 0 ? plural(locale, s.front.notices, notices.length) : ''].filter(Boolean).join(' · ')
      : [nearby === 0 ? s.say.nearbyNone : plural(locale, s.say.nearby, nearby), board.more > 0 ? plural(locale, s.lines.more, board.more) : ''].filter(Boolean).join(' · ');
  const empty = exceptions ? s.front.linesRegular : rows.length === 0 && !foot ? s.lines.noneNearby : undefined;
  // A board answers for itself. The vehicle feed being down is not a reason to
  // print "ZET trenutačno ne odgovara" under four good scheduled departures --
  // that is the hour a timetable board is worth most, and those rows are
  // simply schedule-only, which the estimate note under them already allows for.
  const note = supplied
    ? (rows.length > 0 ? undefined : arrivalsEmptyText(boardOf?.status ?? 'none', s))
    : state === 'loading' ? s.lines.loading : state === 'down' ? s.lines.unavailable : rows.length === 0 ? empty : undefined;
  return {
    id: 'promet',
    kicker: s.say.transit,
    meta,
    rows,
    note: input.lightweight && rows.length === 0 ? undefined : note,
    footMarkup: foot,
    credit: [time ? `ZET ${time}` : 'ZET', state === 'stale' ? s.paired.stale : ''].filter(Boolean).join(' · '),
    state,
  };
}

/** The mode a departure's route is drawn in, as the board beside it read it. */
function kindAtStop(board: LinesBoard, routeId: string): 'tram' | 'bus' | 'other' {
  return board.rows.find((row) => row.routeId === routeId)?.kind ?? kindOfRoute(routeId);
}

// --- around ---------------------------------------------------------------------------

const AROUND_CLOSURES = 5;

export function aroundPanel(input: FrontInput): FrontPanel {
  const { strings: s, now, locale, stop } = input;
  const prometnice = byModule(input.modules).prometnice;
  const state = sourceState(prometnice);
  const rows: FrontRow[] = [];
  const near = closuresByDistance(prometnice, stop, now).filter((c) => stop === null || (c.distanceM !== null && c.distanceM <= NEARBY_CLOSURE_M)).slice(0, AROUND_CLOSURES);
  for (const { item, distanceM } of near) {
    const untilMs = item.until ? Date.parse(item.until) : NaN;
    const until = Number.isFinite(untilMs) ? (sameZagrebDay(untilMs, now) ? fill(s.paired.untilTime, { time: clock(untilMs) }) : weekdayDayMonth(locale, untilMs)) : '';
    rows.push({ key: `closure:${item.id}`, lead: distanceM === null ? s.say.closure : fmtDistance(locale, distanceM), title: item.title, sub: [item.summary ?? '', until].filter(Boolean).join(' · ') });
  }
  const works = worksInKvart(input.modules, stop, now);
  if (works.count > 0 && (works.state === 'live' || works.state === 'stale')) {
    const label = s.say.worksCity;
    rows.push({
      key: 'works',
      lead: s.front.worksLead,
      title: works.nearest?.title ?? label,
      sub: [plural(locale, s.say.works, works.count), works.nearest?.distanceM != null ? fmtDistance(locale, works.nearest.distanceM) : '', CITY_SOURCE].filter(Boolean).join(' · '),
    });
  }
  const district = stop?.district ? districtLabel(stop.district) : '';
  return {
    id: 'around',
    kicker: s.front.around,
    meta: district,
    rows,
    note: rows.length === 0 ? (state === 'loading' ? input.i18n.t('status.loading') : state === 'down' ? s.safety.closuresUnknown : s.paired.closuresNone) : undefined,
    credit: CITY_SOURCE,
    state,
  };
}

// --- All five, and their markup ---------------------------------------------------

/** The events card's rows in the order its room is filled: the active venues
 *  nearest the screen, each with its own count, then the dated events those
 *  venues do not already stand for, nearest in time first (tonightPanel's own
 *  order: tonight, tomorrow, then the week). The budget is the measured room
 *  (kiosk/invitation.ts), never a constant, and nothing is half-shown: a row
 *  either fits whole or is not there. */
export function eventCardRows(venues: readonly ActiveVenue[], events: readonly FrontRow[], budget: number): FrontRow[] {
  const shown = venues.slice(0, budget);
  const rows: FrontRow[] = shown.map((venue) => ({
    key: venue.place.id, lead: String(venue.count), title: venue.place.name, sub: venue.events[0]!.item.title,
  }));
  // A venue row already says what is on there; the fill is what it does not cover.
  const said = new Set(shown.flatMap((venue) => venue.events.map((event) => `event:${event.item.id}`)));
  for (const row of events) {
    if (rows.length >= budget) break;
    if (said.has(row.key)) continue;
    rows.push(row);
  }
  return rows;
}

export function frontPanels(input: FrontInput): Record<PanelId, FrontPanel> {
  const all = { tonight: tonightPanel(input), weather: weatherPanel(input), city: cityPanel(input), promet: prometPanel(input), around: aroundPanel(input) };
  const compact = input.composition === 'compact';
  const handheld = input.composition === 'handheld';
  // The weather card's two rows are today's range and tomorrow's; the
  // exceptions card counts against nothing, having no board to be a part of.
  const lineBoard = input.prometMode !== 'exceptions';
  const caps: Record<PanelId, number> = handheld
    ? { tonight: input.eventRows ?? 5, weather: 2, city: 3, promet: 6, around: 3 }
    : { tonight: input.eventRows ?? (compact ? 1 : 2), weather: 2, city: 1, promet: compact ? 3 : 6, around: 1 };
  for (const id of PANEL_IDS) {
    const p = all[id];
    const total = id === 'promet' && input.stop && lineBoard ? input.stop.routes.length : p.rows.length;
    p.rows = p.rows.slice(0, caps[id]);
    if (id === 'city' && p.rows.length) {
      p.credit = [...new Set(p.rows.map(row => row.key.startsWith('session:') ? ASSEMBLY_SOURCE : row.key === 'gazette' || row.key.startsWith('act:') ? input.strings.paired.acts : CITY_SOURCE))].join(' · ');
    }
    if (total > p.rows.length && ((id === 'promet' && lineBoard) || id === 'tonight')) {
      p.meta = `${p.rows.length} / ${total}${p.meta ? ` · ${p.meta}` : ''}`;
    }
  }
  return all;
}

function rowMarkup(row: FrontRow): string {
  if (vetExternal('title', row.title, 'row') === null || !optionalExternal('summary', row.sub)) return '';
  const leadText = vetExternal('name', row.lead ?? '', 'row') ?? '';
  const dayText = vetExternal('name', row.day ?? '', 'row') ?? '';
  const lead = row.leadMarkup
    ? `<span class="k-fr-lead k-fr-lead--badge">${row.leadMarkup}</span>`
    : `<span class="k-fr-lead">${dayText ? `<span class="k-fr-day">${escapeHtml(dayText)}</span>` : ''}${escapeHtml(leadText)}</span>`;
  const tone = row.tone ? ` data-tone="${escapeAttribute(row.tone)}"` : '';
  const trail = row.trail ? `<span class="k-fr-trail">${row.trail}</span>` : '';
  return `<li class="k-fr" data-key="${escapeAttribute(row.key)}"${row.trail ? ' data-trail="1"' : ''}${tone}>${lead}<span class="k-fr-main"><span class="k-fr-title">${escapeHtml(row.title)}</span>${row.sub ? `<span class="k-fr-sub">${escapeHtml(row.sub)}</span>` : ''}</span>${trail}</li>`;
}

/** One panel's inner markup: the head (kicker and meta), the figure, the rows or the note, the foot, the credit. */
export function panelMarkup(panel: FrontPanel): string {
  const head = `<header class="k-panel-head"><h2 class="k-panel-kicker">${escapeHtml(panel.kicker)}</h2>${panel.meta ? `<p class="k-panel-meta">${externalHtml('summary', panel.meta)}</p>` : ''}</header>`;
  const rowsId = panel.id === 'promet' ? ' data-testid="kiosk-lines"' : '';
  const body = panel.rows.length > 0 ? `<ul class="k-panel-rows"${rowsId}>${panel.rows.map(rowMarkup).join('')}</ul>` : '';
  const note = panel.note ? `<p class="k-panel-note"${panel.state === 'down' ? ' data-state="down"' : ''}>${escapeHtml(panel.note)}</p>` : '';
  const credit = panel.credit ? `<p class="k-panel-credit">${escapeHtml(panel.credit)}</p>` : '';
  return `${head}${panel.figureMarkup ?? ''}${body}${note}${panel.footMarkup ?? ''}${credit}`;
}
