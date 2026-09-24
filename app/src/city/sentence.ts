// The same candidate facts feed the public header and the personal sentence.
// No DOM, network or implicit clock. The template path works without AI.
import type { ArrivalRow } from '../../../shared/city/arrivals';
import { distanceM, located } from '../../../shared/city/geo';
import type { ScreenPlace } from '../../../shared/city/place';
import type { CityState } from '../../../shared/city/types';
import {
  acceptSentence, sentenceDeadline, sentenceValue, sentenceWithPeriod, stableSentenceFacts, typedSentenceFact, writeSentence,
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
/**
 * The header's fact list. Sixteen starved the night: the last and first rows carry seven lines each and
 * come after the departures and closures, so "Prvi tramvaj" and the pharmacy reached the header one slot
 * at a time as other facts expired, and the sequence held one sentence for minutes in between (D2 full
 * run, lastTrams2240 and the live block). Thirty-two holds a whole night list; the wire cap for the model
 * stays sixteen (shared/kiosk/sentence.ts stableSentenceFacts).
 */
export const MAX_FACTS = 32;
export const SENTENCE_BUDGET = { wide: 80, compact: 64, portrait: 64, handheld: 64 } as const;
/** Below this many distinct facts the ten-minute rule falls back to the wording alone. */
export const SENTENCE_MIN_FACTS = 3;

/** A fact as this client holds it. `factKey` names the fact's template family and subject
 * where its id is narrower: a departure's id is its trip, its fact is the line and direction
 * at this place. Client-side only (the S4/S6 signatures stay the wire types); modelSentenceFacts
 * never sends it. */
export interface CitySentenceFact extends SentenceFact {
  factKey?: string;
  /** The approved template family the text is written in (decision 29: a sentence keeps it for its dwell). */
  wording?: SentenceWording;
  /** Until when the fact can still be said in this wording: a countdown's "za N min" ends 30 s before
   *  its tram, when the minute rounds to 0 and only "u HH:MM" is left. Absent: `validUntil`. */
  formUntil?: number;
}
/** A written sentence as the rotation reads it, with its fact's `factKey`, `wording` and `formUntil`. */
export interface RotatingSentence extends WrittenSentence {
  factKey?: string;
  wording?: SentenceWording;
  formUntil?: number;
}
export type SentenceWording = keyof typeof SENTENCE_COPY_HR;

/** The facts a sentence says: every wording of one fact has the same keys. */
export function sentenceFactKeys(sentence: WrittenSentence): string[] {
  const { factKey } = sentence as RotatingSentence;
  return factKey ? [factKey] : [...new Set(sentence.refs)];
}

/**
 * Whether `a` is `b` in its refreshed words (decision 29): the same facts in the same approved
 * template family, as when a closure's end is restated, an estimate moves or a countdown reaches
 * its next minute. That is not a new sentence. The other family ("u 15:45" after "za 1 min") is
 * the fact reworded, and a model's sentence is never refreshed, only kept or left.
 */
export function isSameSentence(a: WrittenSentence | null, b: WrittenSentence | null): boolean {
  if (!a || !b || a.origin !== 'template' || b.origin !== 'template') return false;
  const wording = (a as RotatingSentence).wording;
  if (wording === undefined || wording !== (b as RotatingSentence).wording) return false;
  const keys = sentenceFactKeys(a), other = sentenceFactKeys(b);
  return keys.length === other.length && keys.every(key => other.includes(key));
}

/** The header's candidates: wordings shown in the last ten minutes leave the pool (they survive a
 *  rhythm change that restarts the sequence), except the sentence on screen and its refreshed words. */
export function sentencePool(candidates: readonly WrittenSentence[], current: WrittenSentence | null,
  shown: ReadonlyMap<string, number>): WrittenSentence[] {
  return candidates.filter(s => s.text === current?.text || isSameSentence(s, current) || !shown.has(s.text));
}

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
  event: '{time} počinje događanje „{title}” ({venue}).',
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
  /** The facts of the sentence on screen: never cut by the cap while the rows still produce them, so its dwell and refreshes hold. */
  pinned?: readonly string[];
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

/** "u 18:40", "sutra u 06:12", "25. 9. u 20:00": in the language the sentence's template is read in (copy() reads input.i18n). */
function timedLabel(at: number, input: SentenceFactsInput): string {
  const time = clock(at);
  if (sameZagrebDay(at, input.now)) return input.i18n.t('time.at', { time });
  if (dayKey(at) === dayKey(nextMidnight(input.now) + 12 * 3_600_000)) return input.i18n.t('time.tomorrowAt', { time });
  return input.i18n.t('time.dateAt', { date: dayMonth(at), time });
}

/** At most MAX_FACTS fact records, plus the pinned facts of the sentence on screen; solar is reserved even with a full timeline. */
export function sentenceFacts(input: SentenceFactsInput): SentenceFact[] {
  const { now, i18n, locale } = input;
  if (!Number.isFinite(now)) return [];
  const facts: CitySentenceFact[] = [];
  const add = (id: string, kind: SentenceKicker, text: string, validUntil: number,
    { factKey, wording, formUntil }: { factKey?: string; wording?: SentenceWording; formUntil?: number } = {}) => {
    text = sentenceWithPeriod(text);
    validUntil = sentenceDeadline(text, validUntil, now);
    if (!text || validUntil <= now || !Number.isFinite(validUntil) || text.length > 160 || facts.some(fact => fact.id === id)) return;
    const fact: CitySentenceFact = { id, kind, text, validUntil };
    // The decoder always uses strict header slots, even for accepted row text.
    // Long facts cross it before any shorter weather projection reaches AI.
    const typed = typedSentenceFact(fact);
    if (!typed.ok) { console.debug('sentence-rejected', typed.reason); return; }
    if (text.length <= 80 && !acceptSentence(text, { facts: [fact], now,
      onReject: reason => console.debug('sentence-rejected', reason) }).ok) return;
    facts.push({ ...fact, ...(factKey ? { factKey } : {}), ...(wording ? { wording } : {}),
      ...(formUntil !== undefined ? { formUntil } : {}) });
  };
  const solar = nextSolar(now);
  const solarRow = input.rows.find(row => row.kind === 'solar' && row.atMs !== null && row.atMs > now);
  const solarAt = solarRow?.atMs ?? solar.at;
  const solarKind = solarRow?.id.includes('sunset') ? 'sunset' : solarRow?.id.includes('sunrise') ? 'sunrise' : solar.kind;
  add(solarRow?.id ?? `solar:${solarKind}:${dayKey(solarAt)}`, 'vrijeme',
    copy(i18n, solarKind, { time: clock(solarAt) }), solarAt, { wording: solarKind });

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
    }), Math.min(weatherExpiry, nextMidnight(now)), { wording: key });
  }

  if (input.radiusM !== undefined && input.radiusM > 0) {
    const station = dynamicPlaces(input.city, now).filter(located).filter(place => place.sourceId === 'bajs'
      && place.facts?.fresh === true && place.facts.operational === true
      && typeof place.facts.bikes === 'number' && Number.isInteger(place.facts.bikes) && place.facts.bikes > 0
      && distanceM(input.place, place) <= input.radiusM!)
      .sort((a, b) => distanceM(input.place, a) - distanceM(input.place, b))[0];
    if (station) add(station.id, 'bicikli', copy(i18n, 'bikes', {
      station: station.name.replace(/^BAJS\s*[-:·]?\s*/i, ''), bikes: bikeCount(i18n, station.facts!.bikes),
    }), Date.parse(station.updatedAt!) + 180_000, { wording: 'bikes' });
  }
  if (input.outage) add('outage:zet', 'promet', copy(i18n, 'outage'), now + SENTENCE_REFRESH_MS, { wording: 'outage' });

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
      // One fact per line and direction at this place: the next trip, or the next minute of a
      // countdown, is that fact again in other words.
      const wording = mode === 'bus' ? (live ? 'busIn' : 'busAt') : (live ? 'departureIn' : 'departureAt');
      add(row.id, 'promet', copy(i18n, wording, {
        route: arrival.routeName, to: arrival.headsign, n: minutes, time: clock(at),
      }), expires, {
        factKey: `departure:${arrival.routeId}:${arrival.headsign}@${input.place.stopId ?? input.place.name}`,
        // "za N min" can be said until the minute rounds to 0; "u HH:MM" until the tram leaves.
        wording, formUntil: live ? at - 30_000 : at,
      });
    } else if (row.kind === 'closure' && row.atMs !== null) {
      add(row.id, 'radovi', copy(i18n, 'closureUntil', {
        // The template owns the final full stop, including after a Croatian ordinal date.
        street: row.title, until: sameZagrebDay(row.atMs, now) ? clock(row.atMs) : dayMonth(row.atMs).replace(/\.$/, ''),
      }), Math.min(row.atMs, nextMidnight(now)), { wording: 'closureUntil' });
    } else if ((row.kind === 'last' || row.kind === 'first') && row.services) {
      for (const service of row.services) {
        if (kindOfRoute(service.routeId) !== 'tram' || service.atMs <= now) continue;
        const text = copy(i18n, row.kind === 'last' ? 'lastTram' : 'firstTram', {
          route: service.routeName, time: timedLabel(service.atMs, input),
        });
        add(`${row.id}:${service.routeId}`, atNight ? 'nocas' : 'promet', text,
          Math.min(service.atMs, atNight ? nightEnd(now) : nextMidnight(now)), { wording: row.kind === 'last' ? 'lastTram' : 'firstTram' });
      }
    } else if (row.kind === 'event' && row.atMs !== null && row.sub) {
      const venue = row.sub.split(' · ')[0]!;
      const time = timedLabel(row.atMs, input);
      add(row.id, 'kultura', copy(i18n, 'event', { time: time[0]!.toLocaleUpperCase(locale) + time.slice(1), title: row.title, venue }),
        Math.min(row.atMs, nextMidnight(now)), { wording: 'event' });
    } else if (row.kind === 'opening' && row.atMs !== null) {
      add(row.id, 'kultura', copy(i18n, 'opening', { name: row.title, time: timedLabel(row.atMs, input) }),
        Math.min(row.atMs, nextMidnight(now)), { wording: 'opening' });
    } else if (row.kind === 'pharmacy' && atNight && row.sub) {
      add(row.id, 'nocas', copy(i18n, 'pharmacy', { address: row.sub }), Math.min(solar.at, nightEnd(now)), { wording: 'pharmacy' });
    } else if (row.kind === 'always' && row.sub) {
      // Entire source sentence or nothing. No mid-word or mid-sentence trimming.
      add(row.id, 'kultura', copy(i18n, 'always', { name: row.title, text: row.sub }), (Math.floor(now / 1_200_000) + 1) * 1_200_000,
        { wording: 'always' });
    }
  }
  const pinned = new Set(input.pinned ?? []);
  return [...facts.slice(0, MAX_FACTS), ...facts.slice(MAX_FACTS).filter(fact => pinned.has(fact.id))];
}

/** Only stable facts go to AI; countdowns must never enter a twenty-minute cache. */
export function modelSentenceFacts(facts: readonly SentenceFact[], now?: number): SentenceFact[] {
  // The wire shape only: a client-side factKey is the rotation's, not the request's.
  return stableSentenceFacts(facts, now).map(({ id, kind, text, validUntil }) => ({ id, kind, text, validUntil }));
}

/** Three solar phrasings keep the cold/offline path useful without inventing facts. */
export function templateSentences(facts: readonly SentenceFact[], i18n: I18n, budget = 80, now?: number): WrittenSentence[] {
  const sentences: WrittenSentence[] = [];
  const add = (text: string, fact: SentenceFact, wording = (fact as CitySentenceFact).wording) => {
    const s = writeSentence(text, { facts: [fact], budget, now, refs: [fact.id] }, 'template');
    const { factKey, formUntil } = fact as CitySentenceFact;
    if (s && !sentences.some(other => other.text === s.text)) {
      sentences.push(factKey || wording || formUntil !== undefined ? { ...s, ...(factKey ? { factKey } : {}), ...(wording ? { wording } : {}),
        ...(formUntil !== undefined ? { formUntil } : {}) } as RotatingSentence : s);
    }
  };
  for (const fact of facts) add(fact.text, fact);
  for (const fact of facts) {
    const kind = fact.id.startsWith('solar:sunrise:') ? 'sunrise' : fact.id.startsWith('solar:sunset:') ? 'sunset' : null;
    const time = fact.text.match(/\b\d{2}:\d{2}\b/)?.[0];
    if (kind && time) {
      add(copy(i18n, `${kind}At`, { time }), fact, `${kind}At`);
      add(copy(i18n, `${kind}Time`, { time }), fact, `${kind}Time`);
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
  /** A new cadence for the same rotation: the sentence on screen, its dwell start and the ten-minute
   *  memory of shown wordings and facts stay (decision 29); only the next boundary moves. */
  setRhythm(rhythmMs: number): void;
}

/** Cadence is a chance to change, not permission to repeat or to show expired data.
 * A fact (its template family and subject, sentenceFactKeys) is on screen once per noRepeat
 * window whatever its wording; with fewer than SENTENCE_MIN_FACTS distinct facts at hand the
 * window binds the wording alone, so the three solar phrasings still rotate on a cold screen. */
export function createSentenceSequence(options: SentenceSequenceOptions): SentenceSequence {
  const cadence = (ms: number) => Number.isFinite(ms) && ms > 0 ? ms : SENTENCE_HOLD_MS;
  let rhythm = cadence(options.rhythmMs);
  const noRepeat = Number.isFinite(options.noRepeatMs)
    ? Math.max(SENTENCE_NO_REPEAT_MS, options.noRepeatMs!) : SENTENCE_NO_REPEAT_MS;
  const lastSeen = new Map<string, number>();
  /** Per fact: when it was last on screen, and until when it holds. */
  const factSeen = new Map<string, { at: number; until: number }>();
  const kickers = new Map<SentenceKicker, number>();
  let current: WrittenSentence | null = null;
  let heldSince = -Infinity;
  let previousNow = -Infinity;
  const remember = (s: WrittenSentence, now: number, until: number | null) => {
    lastSeen.set(s.text, now);
    for (const key of sentenceFactKeys(s)) {
      factSeen.set(key, { at: now, until: Math.max(factSeen.get(key)?.until ?? -Infinity, until ?? -Infinity) });
    }
  };
  return {
    read(sentences, now, suspended = false, overflowed = () => false) {
      if (!Number.isFinite(now)) return null;
      // A backward clock jump cannot make a recently displayed line or fact eligible.
      if (now < previousNow) {
        for (const text of lastSeen.keys()) lastSeen.set(text, now);
        for (const seen of factSeen.values()) seen.at = now;
        heldSince = now;
      }
      previousNow = now;
      // Strictly more than the window since the sentence last showed: a return exactly at 600 s is inside the ten
      // minutes to the harness and to a passer-by (release smoke on D5.8: a verbatim return at 600.0 s).
      for (const [text, at] of lastSeen) if (now - at > noRepeat && text !== current?.text) lastSeen.delete(text);
      const valid = (s: WrittenSentence) => (s.validUntil !== null && Number.isFinite(s.validUntil) && s.validUntil > now)
        && acceptSentence(s.text, { facts: [{ id: 'self', kind: s.kicker, text: s.text, validUntil: s.validUntil }], now }).ok
        && !overflowed(s);
      let held = current && valid(current) && sentences.find(s => s.text === current!.text && valid(s));
      // Decision 29: the sentence on screen in its refreshed words (a restated end, a moved estimate,
      // a countdown's next minute) is the same sentence. It keeps its dwell and its wording; only a
      // fact that can no longer be said in that wording ends the dwell early.
      if (!held && current) {
        const leased = current.refs.some(ref => ref.startsWith('always:')) && current.kicker === 'kultura';
        const refreshed = sentences.find(s => s.text !== current!.text && isSameSentence(s, current) && valid(s)
          && (!leased || current!.validUntil! > now));
        if (refreshed) {
          remember(current, now, current.validUntil);
          current = leased ? { ...refreshed, validUntil: Math.min(refreshed.validUntil!, current.validUntil!) } : refreshed;
          held = refreshed;
        }
      }
      // D2 ruling on decision 29: a re-selection never ends a dwell. A poll that re-ranks the rows, a tram
      // that fell to fourth, a fact past the cap: a template sentence stays to its boundary, and only its
      // own fact expiring (or a hostile or overflowing line) ends it early. A changed fact restates a
      // template sentence in place (the refresh above); a model sentence leaves the pool only when it no
      // longer grounds against the current facts (kiosk.ts readWrittenSentences), which is that exception.
      if (!held && current && current.origin === 'template' && valid(current) && now - heldSince < rhythm) held = current;
      // Retain object identity on ordinary refreshes, but update a shortened deadline.
      if (held && current && (held.validUntil! < current.validUntil! || held.kicker !== current.kicker
        || held.refs.length !== current.refs.length || held.refs.some((ref, index) => ref !== current!.refs[index]))) {
        current = held.validUntil! <= current.validUntil! ? held
          : { ...held, validUntil: current.validUntil };
      }
      const onScreen = current ? sentenceFactKeys(current) : [];
      for (const [key, seen] of factSeen) if (now - seen.at > noRepeat && !onScreen.includes(key)) factSeen.delete(key);
      if (suspended) {
        if (held && current) { remember(current, now, held.validUntil); return current; }
        if (current) remember(current, now, current.validUntil);
        current = null;
        return null;
      }
      if (held && current && now - heldSince < rhythm) { remember(current, now, held.validUntil); return current; }
      const usable = sentences.filter(valid);
      const fresh = usable.filter(s => s.text !== current?.text && !lastSeen.has(s.text));
      // Facts at hand: the usable pool plus facts shown recently that still hold (a caller may
      // already have dropped their shown wordings from the pool).
      const facts = new Set(usable.flatMap(sentenceFactKeys));
      for (const [key, seen] of factSeen) if (seen.until > now) facts.add(key);
      const byFact = facts.size >= SENTENCE_MIN_FACTS;
      const choices = byFact ? fresh.filter(s => sentenceFactKeys(s).every(key => !factSeen.has(key))) : fresh;
      const factAge = (s: WrittenSentence) => Math.max(...sentenceFactKeys(s).map(key => factSeen.get(key)?.at ?? -Infinity));
      const kickerAge = (s: WrittenSentence) => kickers.get(s.kicker) ?? -Infinity;
      // A sentence that can be said in its words for a whole rhythm comes first: "za 1 min" ten
      // seconds before its minute rounds to 0 would stand ten seconds (decision 29).
      const lasts = (s: WrittenSentence) => ((s as RotatingSentence).formUntil ?? s.validUntil!) - now >= rhythm ? 0 : 1;
      choices.sort((a, b) => (lasts(a) - lasts(b)) || (factAge(a) - factAge(b)) || (kickerAge(a) - kickerAge(b)));
      // No restatement in another wording: with three facts at hand the header waits for a fact it has
      // not shown rather than say the one that just left in other words.
      const next = choices[0] ?? (held ? current : null);
      if (next !== current) {
        if (current) remember(current, now, current.validUntil);
        // Timeless source descriptions are only leased for this display rhythm.
        // Their fact deadline still bounds the 20-minute source selection turn.
        current = next && next.refs.some(ref => ref.startsWith('always:')) && next.kicker === 'kultura'
          ? { ...next, validUntil: Math.min(next.validUntil!, now + rhythm) } : next;
        heldSince = now;
        if (current) kickers.set(current.kicker, now);
      }
      if (current) remember(current, now, next === current && held ? held.validUntil : next!.validUntil);
      return current;
    },
    setRhythm(rhythmMs) { rhythm = cadence(rhythmMs); },
  };
}
