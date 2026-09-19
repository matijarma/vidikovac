// The header's one line of city news. The wall used to say nothing between
// the brand and the clock; the ticker puts the facts the feed already holds
// there, one item at a time -- a coloured kicker and one sentence, swapped
// every eight seconds. No marquee and no scrolling text: a person reading
// across a room needs a sentence that stands still long enough to be read.
//
// Pure: snapshots, the city catalogue, a clock reading and the copy in; an
// ordered, deduplicated list out. kiosk.ts owns the element, the period and
// the crossfade, so the order below can be tested without a DOM.
//
//   PROMET   the routes whose median is outside the on-time band, ZET's own
//            fresh notices, the closures with a stated end
//   RADOVI   communal works under way
//   VEČERAS  today's events that have both an hour and a verified venue
//   VRIJEME  DHMZ's narrative for today and for tomorrow
//   GRAD     the gazette's issue and its first act, the next Assembly
//            session, the neighbourhood news
//
// Long source texts (an act's title, a DHMZ narrative, a works description)
// are condensed once, server-side, into `FeedItem.brief` (worker/feed/brief.ts,
// WP6); until one exists the item's own title stands in, never a truncation.
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import type { CityState } from '../../../shared/city/types';
import { locatedEvents } from '../../../shared/city/events';
import { delayWord } from '../layers/shared';
import type { I18n } from '../i18n/i18n';
import { dataText } from '../panels/panel';
import { clock, dayKey, sameZagrebDay, weekdayDayMonth, zagrebDayAfter } from './format';
import { byModule, isLive, nextSession, windowOf } from './local';
import { GAZETTE_CONTENTS_TITLE, rankedExceptions, zetNotices } from './exceptions';
import { fill, type KioskStrings } from './strings';

/** One item on the line: a stable identity, a kicker word and one sentence. */
export interface TickerItem {
  /** The fact's own identity, so a swap happens when the sentence changes and not on a repaint. */
  key: string;
  /** VRIJEME / PROMET / RADOVI / VEČERAS / GRAD (strings.ticker.*). */
  kicker: string;
  /** One readable line. */
  text: string;
}

/** How long one item stands before the next takes its place. */
export const TICKER_PERIOD_MS = 8_000;

/** How many of each kind the line carries before the city starts repeating itself. */
const LATE_LINES = 3;
const ZET_NOTICES = 2;
const CLOSURES = 3;
const WORKS = 2;
const EVENTS = 3;
const KVART_NEWS = 2;

/** The item's one sentence: the worker's condensed reading when it has made
 *  one, else the item's own title -- or, where the title is only a label (a
 *  DHMZ forecast row is "Prognoza za ..."), the narrative under it. */
function sentence(item: FeedItem, narrative = false): string {
  const own = narrative ? item.summary ?? item.title : item.title;
  return (item.brief ?? own ?? '').replace(/\s+/g, ' ').trim();
}

function dogadanjaFrom(modules: readonly ModuleSnapshot[], source: string): FeedItem[] {
  const snap = byModule(modules).dogadanja;
  return (isLive(snap) ? snap.items : []).filter((item) => dataText(item, 'source') === source);
}

/** The routes whose median a rider would notice, in the card's own order
 *  (kiosk/exceptions.ts): late before early, trams first, then the largest. */
function lateLines(modules: readonly ModuleSnapshot[], strings: KioskStrings, i18n: I18n): TickerItem[] {
  return rankedExceptions(modules)
    .slice(0, LATE_LINES)
    .map(({ routeId, seconds }) => ({ key: `route:${routeId}`, kicker: strings.ticker.transit, text: `${routeId} ${delayWord(i18n, seconds)}` }));
}

/** ZET's own notices about the network, newest first while they are fresh. */
function noticeLines(modules: readonly ModuleSnapshot[], now: number, strings: KioskStrings): TickerItem[] {
  return zetNotices(modules, now)
    .slice(0, ZET_NOTICES)
    .map((item) => ({ key: `zet:${item.id}`, kicker: strings.ticker.transit, text: sentence(item) }));
}

/** Closures open right now; one that states when it reopens says so. */
function closures(modules: readonly ModuleSnapshot[], now: number, strings: KioskStrings): TickerItem[] {
  const snap = byModule(modules).prometnice;
  return (isLive(snap) ? snap.items : [])
    .filter((item) => windowOf(item, now) === 'active')
    .slice(0, CLOSURES)
    .map((item) => {
      const endsMs = item.until ? Date.parse(item.until) : NaN;
      const until = Number.isFinite(endsMs) && sameZagrebDay(endsMs, now) ? fill(strings.paired.untilTime, { time: clock(endsMs) }) : '';
      // A closure's title is often a street name; the word makes it a sentence.
      const what = sentence(item);
      const named = item.brief ? what : `${strings.say.closure}: ${what}`;
      return { key: `closure:${item.id}`, kicker: strings.ticker.transit, text: [named, until].filter(Boolean).join(' · ') };
    });
}

/** Communal works the register says are under way (komunalne's own phase word). */
function works(modules: readonly ModuleSnapshot[], strings: KioskStrings): TickerItem[] {
  return dogadanjaFrom(modules, 'komunalne')
    .filter((item) => /tijek/i.test(dataText(item, 'phase') || dataText(item, 'status')))
    .slice(0, WORKS)
    .map((item) => ({ key: `works:${item.id}`, kicker: strings.ticker.works, text: sentence(item, true) }));
}

/** Today's events that carry both an hour and one verified venue: the two
 *  facts that make an event worth a passer-by's glance. */
function tonight(modules: readonly ModuleSnapshot[], city: CityState | null, now: number, strings: KioskStrings): TickerItem[] {
  if (!city?.places.length) return [];
  const snap = byModule(modules).dogadanja;
  const names = new Map(city.places.map((place) => [place.id, place.name]));
  return locatedEvents(isLive(snap) ? snap.items : [], city.places, now, 'today')
    .filter((event) => event.venueIds.length === 1 && dataText(event.item, 'precision') === 'time' && Date.parse(event.item.at!) >= now)
    .slice(0, EVENTS)
    .map((event) => ({
      key: `event:${event.item.id}`,
      kicker: strings.ticker.tonight,
      text: [clock(event.item.at), sentence(event.item), names.get(event.venueIds[0]!) ?? ''].filter(Boolean).join(' · '),
    }));
}

/** DHMZ's narrative for today and for tomorrow; the card carries the ranges. */
function forecast(modules: readonly ModuleSnapshot[], now: number, strings: KioskStrings): TickerItem[] {
  const snap = byModule(modules)['dhmz-forecast'];
  if (!isLive(snap)) return [];
  const days = [{ key: 'today', word: strings.say.today, day: dayKey(now) }, { key: 'tomorrow', word: strings.say.tomorrow, day: zagrebDayAfter(now, 1) }];
  return days.flatMap(({ key, word, day }) => {
    const item = snap.items.find((row) => row.kind === 'forecast' && row.at && dayKey(row.at) === day);
    const text = item ? sentence(item, true) : '';
    return item && (item.brief || item.summary) ? [{ key: `forecast:${key}`, kicker: strings.ticker.weather, text: `${word}: ${text}` }] : [];
  });
}

/** The gazette's newest issue with its first act, the next Assembly session and the neighbourhood news. */
function cityHall(modules: readonly ModuleSnapshot[], now: number, strings: KioskStrings, locale: string): TickerItem[] {
  const out: TickerItem[] = [];
  const glasnik = byModule(modules).glasnik;
  if (isLive(glasnik) && glasnik.items.length > 0) {
    const issue = glasnik.items[0]!;
    const act = glasnik.items.find((row) => row.title !== GAZETTE_CONTENTS_TITLE);
    const number = `${dataText(issue, 'broj')}/${dataText(issue, 'godina')}`;
    out.push({ key: `glasnik:${issue.id}`, kicker: strings.ticker.city, text: [`${strings.paired.acts} ${number}`, act ? sentence(act) : ''].filter(Boolean).join(' · ') });
  }
  const session = nextSession(modules, now);
  if (session?.at) {
    const at = Date.parse(session.at);
    const day = sameZagrebDay(at, now) ? strings.say.today : dayKey(at) === zagrebDayAfter(now, 1) ? strings.say.tomorrow : weekdayDayMonth(locale, at);
    const when = dataText(session, 'precision') === 'time' ? `${day} ${clock(at)}` : day;
    out.push({ key: `session:${session.id}`, kicker: strings.ticker.city, text: `${sentence(session)} · ${when}` });
  }
  for (const item of dogadanjaFrom(modules, 'kvartovske').slice(0, KVART_NEWS)) {
    out.push({ key: `kvart:${item.id}`, kicker: strings.ticker.city, text: sentence(item) });
  }
  return out;
}

/**
 * The city's news in the order the header says it: what a person's next hour
 * depends on first (the network, then the street), then what is on tonight,
 * then the sky, then the city's own business. Items with no sentence are
 * dropped and a sentence already said is said once.
 */
export function tickerItems(
  modules: readonly ModuleSnapshot[],
  city: CityState | null,
  now: number,
  strings: KioskStrings,
  i18n: I18n,
): TickerItem[] {
  const locale = i18n.getLocale();
  const all = [
    ...lateLines(modules, strings, i18n),
    ...noticeLines(modules, now, strings),
    ...closures(modules, now, strings),
    ...works(modules, strings),
    ...tonight(modules, city, now, strings),
    ...forecast(modules, now, strings),
    ...cityHall(modules, now, strings, locale),
  ];
  const seen = new Set<string>();
  const out: TickerItem[] = [];
  for (const item of all) {
    const said = item.text.toLocaleLowerCase('hr');
    if (!item.text || seen.has(item.key) || seen.has(said)) continue;
    seen.add(item.key);
    seen.add(said);
    out.push(item);
  }
  return out;
}

/** Which of `count` items the clock is on; -1 when there is nothing to say. */
export function tickerIndex(count: number, now: number, periodMs: number = TICKER_PERIOD_MS): number {
  if (count <= 0) return -1;
  return Math.floor(now / periodMs) % count;
}
