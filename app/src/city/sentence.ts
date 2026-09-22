// The same candidate facts feed the public header and the personal sentence.
// No DOM, network or implicit clock. The template path works without AI.
import type { ArrivalRow } from '../../../shared/city/arrivals';
import { distanceM, located } from '../../../shared/city/geo';
import type { ScreenPlace } from '../../../shared/city/place';
import type { CityState } from '../../../shared/city/types';
import {
  acceptSentence, sentenceDeadline, sentenceValue, sentenceWithPeriod, stableSentenceFacts, writeSentence,
  type SentenceFact, type SentenceKicker, type WrittenSentence,
} from '../../../shared/kiosk/sentence';
import { zagrebIso } from '../../../worker/feed/time';
import type { FeedSnapshots } from '../core/contracts';
import { zagrebHour } from '../format';
import type { I18n } from '../i18n/i18n';
import { kindOfRoute } from '../kiosk/exceptions';
import { clock, dayKey, dayMonth, fmtNumber, sameZagrebDay } from '../kiosk/format';
import { weatherNow } from '../kiosk/local';
import { kioskStrings } from '../kiosk/strings';
import { dataNumber } from '../panels/panel';
import { sunTimes } from '../ui/solar';
import { dynamicPlaces } from './discovery';
import type { NearbyRow } from './nearby';
import { bikeCount } from './strings';

export type { SentenceFact, SentenceKicker, WrittenSentence } from '../../../shared/kiosk/sentence';
export { acceptSentence } from '../../../shared/kiosk/sentence';

export const SENTENCE_NO_REPEAT_MS = 600_000;
export const SENTENCE_REFRESH_MS = 600_000;
export const SENTENCE_HOLD_MS = 20_000;
export const MAX_FACTS = 16;
export const SENTENCE_BUDGET = { wide: 80, compact: 64, portrait: 64, handheld: 64 } as const;

// WP1-D owns the catalogues. These defaults keep this pure seam usable before
// that merge; an installed kiosk.sentence.* value always takes precedence.
// "smjer" preserves the source's destination name without guessing its case.
export const SENTENCE_COPY_HR = {
  departureIn: 'Tramvaj {route}, smjer {to}, polazi za {n} min.',
  departureAt: 'Tramvaj {route}, smjer {to}, polazi u {time}.',
  busIn: 'Autobus {route}, smjer {to}, polazi za {n} min.',
  busAt: 'Autobus {route}, smjer {to}, polazi u {time}.',
  closureUntil: '{street}: zatvoreno za promet do {until}.',
  weather: '{temp}, {condition}; danas do {max} °C.',
  weatherNoRange: '{temp}, {condition}.',
  weatherTemperature: 'Temperatura u Zagrebu je {temp}.',
  bikes: 'BAJS {station}: {bikes}.',
  sunset: 'Sunce zalazi u {time}.',
  sunsetAt: 'Zalazak sunca je u {time}.',
  sunsetTime: 'U {time} zalazi sunce.',
  sunrise: 'Sunce izlazi u {time}.',
  sunriseAt: 'Izlazak sunca je u {time}.',
  sunriseTime: 'U {time} izlazi sunce.',
  lastTram: 'Zadnji tramvaj {route} polazi {time}.',
  firstTram: 'Prvi tramvaj {route} polazi {time}.',
  event: '{time} počinje događanje „{title}“ ({venue}).',
  opening: '{name}: rad počinje {time}.',
  pharmacy: 'Dežurna ljekarna 24/7: {address}.',
  always: '{name}: {text}',
  outage: 'ZET ne šalje položaje vozila; polasci su po voznom redu.',
} as const;
export const SENTENCE_COPY_EN: Record<keyof typeof SENTENCE_COPY_HR, string> = {
  departureIn: 'Tram {route} towards {to} leaves in {n} min.',
  departureAt: 'Tram {route} towards {to} leaves at {time}.',
  busIn: 'Bus {route} towards {to} leaves in {n} min.',
  busAt: 'Bus {route} towards {to} leaves at {time}.',
  closureUntil: '{street} is closed to traffic until {until}.',
  weather: '{temp}, {condition}; up to {max} °C today.',
  weatherNoRange: '{temp}, {condition}.',
  weatherTemperature: 'The temperature in Zagreb is {temp}.',
  bikes: 'BAJS {station}: {bikes}.',
  sunset: 'The sun sets at {time}.',
  sunsetAt: 'Sunset is at {time}.',
  sunsetTime: 'At {time} the sun sets.',
  sunrise: 'The sun rises at {time}.',
  sunriseAt: 'Sunrise is at {time}.',
  sunriseTime: 'At {time} the sun rises.',
  lastTram: 'The last tram {route} leaves {time}.',
  firstTram: 'The first tram {route} leaves {time}.',
  event: '{title} starts {time}, {venue}.',
  opening: '{name} opens {time}.',
  pharmacy: '24/7 duty pharmacy: {address}.',
  always: '{name}: {text}',
  outage: 'ZET is not sending vehicle positions; departures follow the timetable.',
};

function copy(i18n: I18n, key: keyof typeof SENTENCE_COPY_HR, vars: Record<string, string | number> = {}): string {
  const strings = kioskStrings(i18n.getLocale()) as ReturnType<typeof kioskStrings> & {
    sentence?: Partial<Record<keyof typeof SENTENCE_COPY_HR, string>>;
  };
  const source = strings.sentence?.[key] ?? (i18n.getLocale().startsWith('en') ? SENTENCE_COPY_EN : SENTENCE_COPY_HR)[key];
  const values = Object.fromEntries(Object.entries(vars).map(([name, value]) => [name,
    typeof value === 'number' ? String(value) : value === '' ? '' : sentenceValue(value)]));
  if (Object.values(values).some(value => value === null)) return '';
  return source.replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all);
}

/** Additive metadata supplied by the selection builder, not parsed UI text. */
export interface SentenceNearbyRow extends NearbyRow {
  arrival?: ArrivalRow;
  services?: readonly { routeId: string; routeName: string; atMs: number }[];
}

export interface SentenceFactsInput {
  place: ScreenPlace;
  rows: readonly SentenceNearbyRow[];
  snapshots: FeedSnapshots;
  city: CityState;
  now: number;
  outage: boolean;
  locale: string;
  i18n: I18n;
  /** The very same measured circle as selectNearby. Absent: no bike claim. */
  radiusM?: number;
}

function nextMidnight(now: number): number {
  const [year, month, day] = dayKey(now).split('-').map(Number);
  return Date.parse(zagrebIso(year!, month!, day! + 1));
}

function nightEnd(now: number): number {
  const [year, month, day] = dayKey(now).split('-').map(Number);
  return Date.parse(zagrebIso(year!, month!, day! + ((zagrebHour(now) ?? 0) >= 20 ? 1 : 0), 5));
}

function nextSolar(now: number): { kind: 'sunrise' | 'sunset'; at: number } {
  // sunTimes uses the UTC date. Use Zagreb's calendar date even just after midnight.
  const today = new Date(`${dayKey(now)}T12:00:00Z`);
  const sun = sunTimes(today);
  if (now < sun.sunrise.getTime()) return { kind: 'sunrise', at: sun.sunrise.getTime() };
  if (now < sun.sunset.getTime()) return { kind: 'sunset', at: sun.sunset.getTime() };
  return { kind: 'sunrise', at: sunTimes(new Date(today.getTime() + 86_400_000)).sunrise.getTime() };
}

function timedLabel(at: number, input: SentenceFactsInput): string {
  const english = input.locale.startsWith('en');
  if (sameZagrebDay(at, input.now)) return `${english ? 'at' : 'u'} ${clock(at)}`;
  if (dayKey(at) === dayKey(nextMidnight(input.now) + 12 * 3_600_000)) {
    return `${english ? 'tomorrow at' : 'sutra u'} ${clock(at)}`;
  }
  return `${dayMonth(at)} ${english ? 'at' : 'u'} ${clock(at)}`;
}

/** At most sixteen fact records; solar is reserved even with a full timeline. */
export function sentenceFacts(input: SentenceFactsInput): SentenceFact[] {
  const { now, i18n, locale } = input;
  if (!Number.isFinite(now)) return [];
  const facts: SentenceFact[] = [];
  const add = (id: string, kind: SentenceKicker, text: string, validUntil: number) => {
    text = sentenceWithPeriod(text);
    validUntil = sentenceDeadline(text, validUntil, now);
    if (!text || validUntil <= now || !Number.isFinite(validUntil) || text.length > 160 || facts.some(fact => fact.id === id)) return;
    const fact: SentenceFact = { id, kind, text, validUntil };
    // A long weather fact can still supply one complete shorter claim to AI.
    if (text.length <= 80 && !acceptSentence(text, { facts: [fact], now }).ok) return;
    facts.push(fact);
  };
  const solar = nextSolar(now);
  const solarRow = input.rows.find(row => row.kind === 'solar' && row.atMs !== null && row.atMs > now);
  const solarAt = solarRow?.atMs ?? solar.at;
  const solarKind = solarRow?.id.includes('sunset') ? 'sunset' : solarRow?.id.includes('sunrise') ? 'sunrise' : solar.kind;
  add(solarRow?.id ?? `solar:${solarKind}:${dayKey(solarAt)}`, 'vrijeme',
    copy(i18n, solarKind, { time: clock(solarAt) }), solarAt);

  const observation = weatherNow(Object.values(input.snapshots), kioskStrings(locale), locale);
  const weatherExpiry = observation.observedMs === null ? 0 : observation.observedMs + 3 * 3_600_000;
  if (observation.state !== 'down' && observation.temperature && observation.observedMs !== null
    && observation.observedMs <= now && weatherExpiry > now) {
    const forecast = input.snapshots['dhmz-forecast'];
    const today = forecast?.status !== 'down' ? forecast?.items.find(item => item.kind === 'forecast'
      && item.at && sameZagrebDay(item.at, now)) : undefined;
    const max = today ? dataNumber(today, 'tmax') : null;
    // DHMZ conditions are Croatian. English still gets the numerical observation,
    // rather than pretending untranslated source text is an English sentence.
    const condition = locale.startsWith('en') ? '' : observation.condition.toLocaleLowerCase('hr');
    const key = condition ? (max === null ? 'weatherNoRange' : 'weather') : 'weatherTemperature';
    add('weather:now', 'vrijeme', copy(i18n, key, {
      temp: observation.temperature, condition, max: max === null ? '' : fmtNumber(locale, max),
    }), Math.min(weatherExpiry, nextMidnight(now)));
  }

  if (input.radiusM !== undefined && input.radiusM > 0) {
    const station = dynamicPlaces(input.city, now).filter(located).filter(place => place.sourceId === 'bajs'
      && place.facts?.fresh === true && place.facts.operational === true
      && typeof place.facts.bikes === 'number' && Number.isInteger(place.facts.bikes) && place.facts.bikes > 0
      && distanceM(input.place, place) <= input.radiusM!)
      .sort((a, b) => distanceM(input.place, a) - distanceM(input.place, b))[0];
    if (station) add(station.id, 'bicikli', copy(i18n, 'bikes', {
      station: station.name.replace(/^BAJS\s*[-:·]?\s*/i, ''), bikes: bikeCount(i18n, station.facts!.bikes),
    }), Date.parse(station.updatedAt!) + 180_000);
  }
  if (input.outage) add('outage:zet', 'promet', copy(i18n, 'outage'), now + SENTENCE_REFRESH_MS);

  const hour = zagrebHour(now) ?? 12;
  const atNight = hour >= 20 || hour < 5;
  let departures = 0;
  for (const row of input.rows) {
    if (row.kind === 'solar' || (row.kind !== 'last' && row.kind !== 'first'
      && row.atMs !== null && (!Number.isFinite(row.atMs) || row.atMs <= now))) continue;
    if (row.kind === 'departure') {
      const arrival = row.arrival;
      if (!arrival || ++departures > 3 || !arrival.headsign) continue;
      // An ETA cannot be made into a timetable by changing its colour or words.
      // The selector must rebuild these rows without fixes during an outage.
      if (input.outage && (row.live || arrival.live)) continue;
      const mode = kindOfRoute(arrival.routeId);
      if (mode === 'other') continue;
      const at = row.atMs;
      if (at === null || at <= now || !sameZagrebDay(at, now)) continue;
      const minutes = Math.max(0, Math.round((at - now) / 60_000));
      const live = row.live && !input.outage && arrival.minutes !== null && minutes > 0;
      // The exact minute boundary, not "now + a minute", invalidates a countdown.
      const expires = live ? Math.min(at, at - (minutes - 0.5) * 60_000) : at;
      add(row.id, 'promet', copy(i18n, mode === 'bus' ? (live ? 'busIn' : 'busAt') : (live ? 'departureIn' : 'departureAt'), {
        route: arrival.routeName, to: arrival.headsign, n: minutes, time: clock(at),
      }), expires);
    } else if (row.kind === 'closure' && row.atMs !== null) {
      add(row.id, 'radovi', copy(i18n, 'closureUntil', {
        // The template owns the final full stop, including after a Croatian ordinal date.
        street: row.title, until: sameZagrebDay(row.atMs, now) ? clock(row.atMs) : dayMonth(row.atMs).replace(/\.$/, ''),
      }), Math.min(row.atMs, nextMidnight(now)));
    } else if ((row.kind === 'last' || row.kind === 'first') && row.services) {
      for (const service of row.services) {
        if (kindOfRoute(service.routeId) !== 'tram' || service.atMs <= now) continue;
        const text = copy(i18n, row.kind === 'last' ? 'lastTram' : 'firstTram', {
          route: service.routeName, time: timedLabel(service.atMs, input),
        });
        add(`${row.id}:${service.routeId}`, atNight ? 'nocas' : 'promet', text,
          Math.min(service.atMs, atNight ? nightEnd(now) : nextMidnight(now)));
      }
    } else if (row.kind === 'event' && row.atMs !== null && row.sub) {
      const venue = row.sub.split(' · ')[0]!;
      const time = timedLabel(row.atMs, input);
      add(row.id, 'kultura', copy(i18n, 'event', { time: time[0]!.toLocaleUpperCase(locale) + time.slice(1), title: row.title, venue }),
        Math.min(row.atMs, nextMidnight(now)));
    } else if (row.kind === 'opening' && row.atMs !== null) {
      add(row.id, 'kultura', copy(i18n, 'opening', { name: row.title, time: timedLabel(row.atMs, input) }),
        Math.min(row.atMs, nextMidnight(now)));
    } else if (row.kind === 'pharmacy' && atNight && row.sub) {
      add(row.id, 'nocas', copy(i18n, 'pharmacy', { address: row.sub }), Math.min(solar.at, nightEnd(now)));
    } else if (row.kind === 'always' && row.sub) {
      // Entire source sentence or nothing. No mid-word or mid-sentence trimming.
      add(row.id, 'kultura', copy(i18n, 'always', { name: row.title, text: row.sub }), (Math.floor(now / 1_200_000) + 1) * 1_200_000);
    }
  }
  return facts.slice(0, MAX_FACTS);
}

/** Only stable facts go to AI; countdowns must never enter a twenty-minute cache. */
export function modelSentenceFacts(facts: readonly SentenceFact[], now?: number): SentenceFact[] {
  return stableSentenceFacts(facts, now);
}

/** Three solar phrasings keep the cold/offline path useful without inventing facts. */
export function templateSentences(facts: readonly SentenceFact[], i18n: I18n, budget = 80, now?: number): WrittenSentence[] {
  const sentences: WrittenSentence[] = [];
  const add = (text: string, fact: SentenceFact) => {
    const s = writeSentence(text, { facts: [fact], budget, now, refs: [fact.id] }, 'template');
    if (s && !sentences.some(other => other.text === s.text)) sentences.push(s);
  };
  for (const fact of facts) add(fact.text, fact);
  for (const fact of facts) {
    const kind = fact.id.startsWith('solar:sunrise:') ? 'sunrise' : fact.id.startsWith('solar:sunset:') ? 'sunset' : null;
    const time = fact.text.match(/\b\d{2}:\d{2}\b/)?.[0];
    if (kind && time) {
      add(copy(i18n, `${kind}At`, { time }), fact);
      add(copy(i18n, `${kind}Time`, { time }), fact);
    }
  }
  return sentences;
}

export interface SentenceSequenceOptions {
  rhythmMs: number;
  noRepeatMs?: number;
}
export interface SentenceSequence {
  read(sentences: readonly WrittenSentence[], now: number, suspended?: boolean, overflowed?: (s: WrittenSentence) => boolean): WrittenSentence | null;
}

/** Cadence is a chance to change, not permission to repeat or to show expired data. */
export function createSentenceSequence(options: SentenceSequenceOptions): SentenceSequence {
  const rhythm = Number.isFinite(options.rhythmMs) && options.rhythmMs > 0 ? options.rhythmMs : SENTENCE_HOLD_MS;
  const noRepeat = Number.isFinite(options.noRepeatMs)
    ? Math.max(SENTENCE_NO_REPEAT_MS, options.noRepeatMs!) : SENTENCE_NO_REPEAT_MS;
  const lastSeen = new Map<string, number>();
  const kickers = new Map<SentenceKicker, number>();
  let current: WrittenSentence | null = null;
  let heldSince = -Infinity;
  let previousNow = -Infinity;
  return {
    read(sentences, now, suspended = false, overflowed = () => false) {
      if (!Number.isFinite(now)) return null;
      // A backward clock jump cannot make a recently displayed line eligible.
      if (now < previousNow) {
        for (const text of lastSeen.keys()) lastSeen.set(text, now);
        heldSince = now;
      }
      previousNow = now;
      for (const [text, at] of lastSeen) if (now - at >= noRepeat && text !== current?.text) lastSeen.delete(text);
      const valid = (s: WrittenSentence) => (s.validUntil !== null && Number.isFinite(s.validUntil) && s.validUntil > now)
        && acceptSentence(s.text, { facts: [{ id: 'self', kind: s.kicker, text: s.text, validUntil: s.validUntil }], now }).ok
        && !overflowed(s);
      const held = current && valid(current) && sentences.find(s => s.text === current!.text && valid(s));
      // Retain object identity on ordinary refreshes, but update a shortened deadline.
      if (held && current && (held.validUntil! < current.validUntil! || held.kicker !== current.kicker
        || held.refs.length !== current.refs.length || held.refs.some((ref, index) => ref !== current!.refs[index]))) {
        current = held.validUntil! <= current.validUntil! ? held
          : { ...held, validUntil: current.validUntil };
      }
      if (suspended) {
        if (held && current) { lastSeen.set(current.text, now); return current; }
        if (current) lastSeen.set(current.text, now);
        current = null;
        return null;
      }
      if (held && current && now - heldSince < rhythm) { lastSeen.set(current.text, now); return current; }
      const choices = sentences.filter(s => s.text !== current?.text && valid(s) && !lastSeen.has(s.text));
      choices.sort((a, b) => (kickers.get(a.kicker) ?? -Infinity) - (kickers.get(b.kicker) ?? -Infinity));
      const next = choices[0] ?? (held ? current : null);
      if (next !== current) {
        if (current) lastSeen.set(current.text, now);
        // Timeless source descriptions are only leased for this display rhythm.
        // Their fact deadline still bounds the 20-minute source selection turn.
        current = next && next.refs.some(ref => ref.startsWith('always:')) && next.kicker === 'kultura'
          ? { ...next, validUntil: Math.min(next.validUntil!, now + rhythm) } : next;
        heldSince = now;
        if (current) kickers.set(current.kicker, now);
      }
      if (current) lastSeen.set(current.text, now);
      return current;
    },
  };
}
