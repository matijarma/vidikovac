// Wire text is untrusted, including local text: decode an approved family into
// typed slots, then bind those slots to one complete fact. No free-prose escape;
// the one prose family, `always`, carries register text only as the typed datum
// `register-text`. Every external slot uses the strict header surface, never
// the contextual row surface (./external-text.ts, decision 21).
import { externalText, type ExternalTextKind } from './external-text';
export { SENTENCE_INSTRUCTION_PATTERNS, SENTENCE_SPLIT_COMMANDS, sentenceInstruction } from './external-text';

export const SENTENCE_KICKERS = ['promet', 'kultura', 'vrijeme', 'bicikli', 'nocas', 'radovi'] as const;
export type SentenceKicker = (typeof SENTENCE_KICKERS)[number];
export const SENTENCE_MAX_CHARS = 80;
export const SENTENCE_VALUE_MAX_CHARS = 64;

export interface SentenceFact {
  id: string;
  kind: SentenceKicker;
  text: string;
  validUntil: number | null;
}
export interface WrittenSentence {
  kicker: SentenceKicker;
  text: string;
  refs: string[];
  validUntil: number | null;
  origin: 'model' | 'template';
}
export interface SentenceRequest {
  locale: 'hr' | 'en';
  budget: number;
  facts: SentenceFact[];
}
export interface SentenceResponse {
  generatedAt: string;
  sentences: WrittenSentence[];
}
export type SentenceRejection =
  | 'empty' | 'too-long' | 'ellipsis' | 'newline' | 'markup'
  | 'invented-number' | 'unrelated' | 'expired' | 'multiple-sentences'
  | 'forbidden-copy' | 'unnamed-count' | 'wrong-kicker'
  | 'unknown-family' | 'invalid-slot' | 'instruction'
  | 'invalid-contract';
export type SentenceVerdict = { ok: true } | { ok: false; reason: SentenceRejection };
export interface SentenceContext {
  facts: readonly SentenceFact[];
  budget?: number;
  now?: number;
  refs?: readonly string[];
  kicker?: SentenceKicker;
  locale?: 'hr' | 'en';
  /** Callers log codes only, never hostile source text. */
  onReject?: (reason: SentenceRejection) => void;
}

const QUOTES = '"\'„“”«»';
const CONTROLS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const DATE_RELATIVE = /(?<!\p{L})(?:sutra|večeras|danas|ujutro|noćas|sinoć|jučer|prekosutra|today|tomorrow|tonight|yesterday)(?!\p{L})|\bthis (?:morning|evening|afternoon)\b/iu;
const LOCAL_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Zagreb', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
});
const NIGHT_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', hour: 'numeric', hourCycle: 'h23' });

/** Reject invisible input before interpolation; never repair an obfuscated verb. */
export function sentenceValue(raw: string): string | null {
  if (CONTROLS.test(raw) || [...raw].length > SENTENCE_VALUE_MAX_CHARS) return null;
  const clean = raw.normalize('NFC').trim();
  return clean || null;
}
export function normalizeSentence(raw: string): string {
  let text = raw.trim().normalize('NFC');
  if (QUOTES.includes(text[0] ?? '\0')) text = text.slice(1);
  if (QUOTES.includes(text.at(-1) ?? '\0')) text = text.slice(0, -1);
  return text.trim();
}
export function sentenceWithPeriod(raw: string): string {
  const text = normalizeSentence(raw);
  return text && !/[.!?]$/.test(text) ? `${text}.` : text;
}
export function sentenceMidnight(now: number): number {
  const parts = (at: number) => Object.fromEntries(LOCAL_PARTS.formatToParts(at)
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const local = parts(now);
  const midnight = Date.UTC(local.year!, local.month! - 1, local.day! + 1);
  let at = midnight;
  for (let pass = 0; pass < 2; pass++) {
    const p = parts(at);
    at += midnight - Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  }
  return at;
}
export function sentenceDeadline(text: string, validUntil: number, now: number): number {
  return DATE_RELATIVE.test(text) ? Math.min(validUntil, sentenceMidnight(now)) : validUntil;
}

export type SentenceSlotType = 'route' | 'stop' | 'minutes' | 'clock' | 'time' | 'until'
  | 'temperature' | 'degrees' | 'count' | 'title' | 'venue' | 'street' | 'condition';
interface SlotRule { max: number; pattern: RegExp; names?: ExternalTextKind }
// Only the display's supported alphabets, not visually similar Latin letters
// such as dotless ı or stroked ł, nor Greek/Cyrillic confusables.
const nameChars = /^[A-Za-zČĆĐŠŽčćđšž0-9][A-Za-zČĆĐŠŽčćđšž0-9 .,'’():&/+–-]*$/u;
export const SENTENCE_SLOT_RULES: Readonly<Record<SentenceSlotType, SlotRule>> = {
  route: { max: 6, pattern: /^[A-Za-z0-9]+$/u, names: 'headsign' },
  stop: { max: 48, pattern: nameChars, names: 'name' },
  minutes: { max: 3, pattern: /^[1-9]\d{0,2}$/u },
  clock: { max: 5, pattern: /^(?:[01]\d|2[0-3]):[0-5]\d$/u },
  time: { max: 26, pattern: /^(?:(?:[Uu]|[Aa]t) |(?:[Ss]utra u|[Tt]omorrow at) |(?:[1-9]|[12]\d|3[01])\. (?:[1-9]|1[0-2])\. (?:u|at) )(?:[01]\d|2[0-3]):[0-5]\d$/u },
  until: { max: 6, pattern: /^(?:(?:[01]\d|2[0-3]):[0-5]\d|(?:[1-9]|[12]\d|3[01])\. (?:[1-9]|1[0-2]))$/u },
  temperature: { max: 10, pattern: /^[-−]?\d{1,2}(?:[.,]\d)? °C$/u },
  degrees: { max: 5, pattern: /^[-−]?\d{1,2}(?:[.,]\d)?$/u },
  count: { max: 13, pattern: /^(?:0|[1-9]\d{0,2}) (?:bicikl|bicikla|bicikala|bike|bikes)$/u },
  title: { max: 64, pattern: nameChars, names: 'title' },
  venue: { max: 48, pattern: nameChars, names: 'name' },
  street: { max: 64, pattern: nameChars, names: 'address' },
  condition: { max: 32, pattern: /^(?:vedro|pretežno vedro|sunčano|pretežno sunčano|malo oblačno|umjereno oblačno|pretežno oblačno|oblačno|naoblaka|kiša|slaba kiša|jaka kiša|rosulja|pljusak|pljuskovi|grmljavina|snijeg|slab snijeg|susnježica|magla|sumaglica|clear|sunny|partly cloudy|mostly cloudy|cloudy|overcast|rain|light rain|heavy rain|drizzle|showers|thunderstorm|snow|sleet|fog|mist)$/u },
};
export function validateSentenceSlot(type: SentenceSlotType, value: string): SentenceRejection | null {
  const rule = SENTENCE_SLOT_RULES[type];
  if ([...value].length > rule.max || value !== value.trim() || value.includes('  ')
    || value.normalize('NFKC') !== value || !rule.pattern.test(value) || /…|\.\.\./u.test(value)) return 'invalid-slot';
  // A sentence speaks for the city even when its source is an accepted row.
  if (rule.names) {
    const verdict = externalText(rule.names, value, { surface: 'header' });
    if (!verdict.ok) return verdict.reason === 'instruction' ? 'instruction' : 'invalid-slot';
  }
  if (type === 'minutes' && Number(value) > 180) return 'invalid-slot';
  if ((type === 'temperature' || type === 'degrees')
    && Math.abs(Number(value.replace(' °C', '').replace('−', '-').replace(',', '.'))) > 65) return 'invalid-slot';
  return null;
}

interface TemplateFamily {
  hr: string;
  en: string;
  slots: Record<string, SentenceSlotType>;
  kinds: readonly SentenceKicker[];
  group?: string;
}
// Mirrors owner-reviewed copy byte-for-byte, pinned against both catalogues.
// `always` is not among them: its {text} is register prose, typed as `register-text` below.
export const SENTENCE_FAMILIES = {
  departureIn: { hr: 'Tramvaj {route}, smjer {to}, polazi za {n} min.', en: 'Tram {route} towards {to} leaves in {n} min.', slots: { route: 'route', to: 'stop', n: 'minutes' }, kinds: ['promet'] },
  departureAt: { hr: 'Tramvaj {route}, smjer {to}, polazi u {time}.', en: 'Tram {route} towards {to} leaves at {time}.', slots: { route: 'route', to: 'stop', time: 'clock' }, kinds: ['promet'] },
  busIn: { hr: 'Autobus {route}, smjer {to}, polazi za {n} min.', en: 'Bus {route} towards {to} leaves in {n} min.', slots: { route: 'route', to: 'stop', n: 'minutes' }, kinds: ['promet'] },
  busAt: { hr: 'Autobus {route}, smjer {to}, polazi u {time}.', en: 'Bus {route} towards {to} leaves at {time}.', slots: { route: 'route', to: 'stop', time: 'clock' }, kinds: ['promet'] },
  closureUntil: { hr: '{street}: zatvoreno za promet do {until}.', en: '{street} is closed to traffic until {until}.', slots: { street: 'street', until: 'until' }, kinds: ['radovi'] },
  weather: { hr: '{temp}, {condition}; danas do {max} °C.', en: '{temp}, {condition}; up to {max} °C today.', slots: { temp: 'temperature', condition: 'condition', max: 'degrees' }, kinds: ['vrijeme'] },
  weatherNoRange: { hr: '{temp}, {condition}.', en: '{temp}, {condition}.', slots: { temp: 'temperature', condition: 'condition' }, kinds: ['vrijeme'] },
  weatherTemperature: { hr: 'Temperatura u Zagrebu je {temp}.', en: 'The temperature in Zagreb is {temp}.', slots: { temp: 'temperature' }, kinds: ['vrijeme'] },
  bikes: { hr: 'BAJS {station}: {bikes}.', en: 'BAJS {station}: {bikes}.', slots: { station: 'stop', bikes: 'count' }, kinds: ['bicikli'] },
  sunset: { hr: 'Sunce zalazi u {time}.', en: 'The sun sets at {time}.', slots: { time: 'clock' }, kinds: ['vrijeme'], group: 'sunset' },
  sunsetAt: { hr: 'Zalazak sunca je u {time}.', en: 'Sunset is at {time}.', slots: { time: 'clock' }, kinds: ['vrijeme'], group: 'sunset' },
  sunsetTime: { hr: 'U {time} zalazi sunce.', en: 'At {time} the sun sets.', slots: { time: 'clock' }, kinds: ['vrijeme'], group: 'sunset' },
  sunrise: { hr: 'Sunce izlazi u {time}.', en: 'The sun rises at {time}.', slots: { time: 'clock' }, kinds: ['vrijeme'], group: 'sunrise' },
  sunriseAt: { hr: 'Izlazak sunca je u {time}.', en: 'Sunrise is at {time}.', slots: { time: 'clock' }, kinds: ['vrijeme'], group: 'sunrise' },
  sunriseTime: { hr: 'U {time} izlazi sunce.', en: 'At {time} the sun rises.', slots: { time: 'clock' }, kinds: ['vrijeme'], group: 'sunrise' },
  lastTram: { hr: 'Zadnji tramvaj {route} polazi {time}.', en: 'The last tram {route} leaves {time}.', slots: { route: 'route', time: 'time' }, kinds: ['promet', 'nocas'] },
  firstTram: { hr: 'Prvi tramvaj {route} polazi {time}.', en: 'The first tram {route} leaves {time}.', slots: { route: 'route', time: 'time' }, kinds: ['promet', 'nocas'] },
  event: { hr: '{time} počinje događanje „{title}“ ({venue}).', en: '{title} starts {time}, {venue}.', slots: { time: 'time', title: 'title', venue: 'venue' }, kinds: ['kultura'] },
  opening: { hr: '{name}: rad počinje {time}.', en: '{name} opens {time}.', slots: { name: 'venue', time: 'time' }, kinds: ['kultura'] },
  pharmacy: { hr: 'Dežurna ljekarna 24/7: {address}.', en: '24/7 duty pharmacy: {address}.', slots: { address: 'street' }, kinds: ['nocas'] },
  outage: { hr: 'ZET ne šalje položaje vozila; polasci su po voznom redu.', en: 'ZET is not sending vehicle positions; departures follow the timetable.', slots: {}, kinds: ['promet'] },
} as const satisfies Record<string, TemplateFamily>;
export type SentenceFamily = keyof typeof SENTENCE_FAMILIES;
// Decision 18 (revised): "{name}: {text}" shows a place's register story or a
// protected building nearby. Both values are third-party text: `register-name`
// and `register-text`, each checked by externalText() on the header surface,
// never by identity with a snapshot. The model selects such a fact by id only
// and is never offered its text to copy or write.
export const SENTENCE_REGISTER_FAMILIES = { always: '{name}: {text}' } as const;
export type SentenceRegisterFamily = keyof typeof SENTENCE_REGISTER_FAMILIES;
export type SentenceChoiceFamily = SentenceFamily | SentenceRegisterFamily;
const REGISTER_KINDS: readonly SentenceKicker[] = ['kultura'];
const REGISTER_SLOTS = { name: 'name', text: 'register-text' } as const satisfies Record<string, ExternalTextKind>;
// The header is the wall's own voice, so register prose in it also keeps the
// slop register (docs/companion-2026-09-22.md §12 "Never", §13): no fetch or sync
// times, no hedges or register caveats, no "zid", no unit glued to a number, no
// count without a name. The row keeps showing the text as the register writes it.
// A proper name keeps its own words: the street "Pod zidom", the one name in the
// committed registers with the word in it, is data and never the screen [O-66].
// It counts only as the registers write it; every other "zid" stays refused.
const ZID_PROPER_NAMES = /(?<![\p{L}\p{N}_])Pod zidom(?![\p{L}\p{N}_])/gu;
const REGISTER_SLOP = /(?:\bzid(?:a|u|om|ovi|ove)?\b|dohva[ćt]|ažuriran|osvježen|preuzeto|sinkroniz|sinhroniz|podat(?:ak|ci) od|zastarjel|nepotvrđen|neprovjeren|nedostupn|nije provjera|obuhvat zaštite|iz registra|nema podat|možda|vjerojatno|navodno|moguće je|fetched|updated at|synced|synchroni[sz]|unavailable|unconfirmed|not verified|out of date|perhaps|maybe|probably|possibly)/iu;
function registerCopyIssue(text: string): SentenceRejection | null {
  if (REGISTER_SLOP.test(text.normalize('NFC').replace(ZID_PROPER_NAMES, ' ').toLocaleLowerCase('hr')) || /\d(?:°|\s+°\s+[CF]\b|(?:min|km|m|h|s)\b)/u.test(text)) return 'forbidden-copy';
  if (/(?:^|[;,]\s*|^(?:danas|sutra|večeras|ujutro|today|tomorrow|tonight)\s+)(?:\d+\s+(?:zatvaranja|radova|događanja|bicikl|closure|event|bike)|(?:radovi|događanja|zatvaranja)\s+(?:u gradu\s+)?\d)/iu.test(text)) {
    return 'unnamed-count';
  }
  return null;
}

interface TypedSlot { type: SentenceSlotType | 'register-name' | 'register-text'; value: string }
export interface TypedSentenceFact {
  family: SentenceChoiceFamily;
  locale: 'hr' | 'en';
  slots: Record<string, TypedSlot>;
}
const familyEntries = Object.entries(SENTENCE_FAMILIES) as [SentenceFamily, TemplateFamily][];
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matchers = familyEntries.flatMap(([family, spec]) => (['hr', 'en'] as const).map(locale => {
  const names: string[] = [];
  const source = spec[locale].split(/(\{\w+\})/u).map(part => {
    if (!part.startsWith('{')) return escapeRegex(part);
    names.push(part.slice(1, -1));
    return '(.+?)';
  }).join('');
  return { family, spec, locale, names, pattern: new RegExp(`^${source}$`, 'u') };
}));
type Decoded = { ok: true; fact: TypedSentenceFact } | { ok: false; reason: SentenceRejection };
function decodeTyped(text: string, kind?: SentenceKicker, locale?: 'hr' | 'en'): Decoded {
  let issue: SentenceRejection = 'unknown-family';
  for (const matcher of matchers) {
    if (locale && matcher.locale !== locale) continue;
    const match = matcher.pattern.exec(text);
    if (!match) continue;
    const slots: Record<string, TypedSlot> = {};
    let invalid: SentenceRejection | null = null;
    for (const [index, name] of matcher.names.entries()) {
      const type = matcher.spec.slots[name]!;
      const value = match[index + 1]!;
      invalid = validateSentenceSlot(type, value);
      // The same stop slot also carries BAJS station names. Only departure
      // destinations have GTFS's stricter headsign grammar; typed identity stays.
      if (!invalid && name === 'to') {
        const verdict = externalText('headsign', value, { surface: 'header' });
        if (!verdict.ok) invalid = verdict.reason === 'instruction' ? 'instruction' : 'invalid-slot';
      }
      if (invalid) break;
      slots[name] = { type, value };
    }
    if (invalid) { issue = invalid; continue; }
    if (kind && !matcher.spec.kinds.includes(kind)) { issue = 'wrong-kicker'; continue; }
    return { ok: true, fact: { family: matcher.family, locale: matcher.locale, slots } };
  }
  return { ok: false, reason: issue };
}
/**
 * The `always` family: the name before the first ": ", the register text after it
 * up to the sentence's own full stop (a text ending in "!" or "?" keeps it). Both
 * cross externalText(); nothing is trimmed, unquoted or repaired.
 */
function decodeRegister(text: string, kind?: SentenceKicker, locale?: 'hr' | 'en'): Decoded {
  const colon = text.indexOf(': ');
  if (colon <= 0 || !/[.!?]$/u.test(text)) return { ok: false, reason: 'unknown-family' };
  const values = { name: text.slice(0, colon), text: text.endsWith('.') ? text.slice(colon + 2, -1) : text.slice(colon + 2) };
  for (const [slot, type] of Object.entries(REGISTER_SLOTS) as [keyof typeof values, ExternalTextKind][]) {
    const value = values[slot];
    // Whole values only: the header's unquoting (normalizeSentence) must not have cut a quote off either end.
    if (!value || value !== value.trim() || !quotesPaired(value)) return { ok: false, reason: 'invalid-slot' };
    const verdict = externalText(type, value, { surface: 'header' });
    if (!verdict.ok) return { ok: false, reason: verdict.reason === 'instruction' ? 'instruction' : 'invalid-slot' };
  }
  const copy = registerCopyIssue(values.text);
  if (copy) return { ok: false, reason: copy };
  if (kind && !REGISTER_KINDS.includes(kind)) return { ok: false, reason: 'wrong-kicker' };
  return { ok: true, fact: { family: 'always', locale: locale ?? 'hr', slots: {
    name: { type: 'register-name', value: values.name }, text: { type: 'register-text', value: values.text },
  } } };
}
function decodeTemplate(text: string, kind?: SentenceKicker, locale?: 'hr' | 'en'): Decoded {
  const typed = decodeTyped(text, kind, locale);
  if (typed.ok || !text.includes(': ')) return typed;
  // A typed family that matched whole keeps its finding: register text never stands in for a closure or an opening.
  if (typed.reason === 'instruction' || typed.reason === 'wrong-kicker') return typed;
  return decodeRegister(text, kind, locale);
}
/** Straight and curly double quotes come in pairs, as do « and ». */
function quotesPaired(value: string): boolean {
  const count = (pattern: RegExp) => (value.match(pattern) ?? []).length;
  return count(/"/gu) % 2 === 0 && count(/[„“”]/gu) % 2 === 0 && count(/«/gu) === count(/»/gu);
}
/** The header sentence of a register row: "{name}: {text}" and the template's full stop, as fact construction writes it. */
function registerSentence(name: string, text: string): string {
  return sentenceWithPeriod(`${name}: ${text}`);
}
function textIssue(text: string, max: number): SentenceRejection | null {
  if (!text.length) return 'empty';
  if (/…|\.\.\./u.test(text)) return 'ellipsis';
  if (!Number.isFinite(max) || [...text].length > max) return 'too-long';
  if (/[\r\n\u2028\u2029]/u.test(text)) return 'newline';
  if (CONTROLS.test(text) || /[*_`#[\]<>{}|]|https?:/iu.test(text)) return 'markup';
  return null;
}
/** Header-only wire projection: no caller can opt sentence facts into row rules. */
export function typedSentenceFact(fact: SentenceFact, locale?: 'hr' | 'en'): Decoded {
  const issue = textIssue(fact.text, 160);
  return issue ? { ok: false, reason: issue } : decodeTemplate(fact.text, fact.kind, locale);
}
function grounded(candidate: TypedSentenceFact, source: TypedSentenceFact): boolean {
  const same = ([name, slot]: [string, TypedSlot]) => source.slots[name]?.type === slot.type && source.slots[name]?.value === slot.value;
  if (candidate.family === 'always' || source.family === 'always') {
    return candidate.family === source.family && Object.keys(candidate.slots).length === Object.keys(source.slots).length
      && Object.entries(candidate.slots).every(same);
  }
  const targetSpec: TemplateFamily = SENTENCE_FAMILIES[candidate.family];
  const sourceSpec: TemplateFamily = SENTENCE_FAMILIES[source.family];
  const compatible = candidate.family === source.family
    || (targetSpec.group !== undefined && targetSpec.group === sourceSpec.group)
    || (source.family === 'weather' && ['weatherNoRange', 'weatherTemperature'].includes(candidate.family))
    || (source.family === 'weatherNoRange' && candidate.family === 'weatherTemperature');
  return compatible && Object.entries(candidate.slots).every(same);
}
export function sentenceRefs(text: string, ctx: SentenceContext): SentenceFact[] {
  const candidate = decodeTemplate(normalizeSentence(text), ctx.kicker, ctx.locale);
  if (!candidate.ok || (ctx.refs && ctx.refs.length !== 1)) return [];
  const candidates = ctx.refs ? ctx.facts.filter(fact => fact.id === ctx.refs![0]) : ctx.facts;
  // Duplicate IDs are ambiguous even if only one happens to match.
  return candidates.filter(fact => {
    if (ctx.facts.filter(other => other.id === fact.id).length !== 1) return false;
    const source = typedSentenceFact(fact, ctx.locale);
    return source.ok && grounded(candidate.fact, source.fact);
  }).slice(0, 1);
}
export function sentenceValidUntil(facts: readonly SentenceFact[]): number | null {
  if (!facts.length || facts.some(fact => fact.validUntil === null || !Number.isFinite(fact.validUntil))) return null;
  return Math.min(...facts.map(fact => fact.validUntil!));
}

export function acceptSentence(candidate: string, ctx: SentenceContext): SentenceVerdict {
  const reject = (reason: SentenceRejection): SentenceVerdict => { ctx.onReject?.(reason); return { ok: false, reason }; };
  // Check before trim/unquote: leading/trailing invisible input is not benign.
  if (CONTROLS.test(candidate)) return reject(/[\r\n\u2028\u2029]/u.test(candidate) ? 'newline' : 'markup');
  const text = normalizeSentence(candidate);
  const issue = textIssue(text, Math.min(SENTENCE_MAX_CHARS, ctx.budget ?? SENTENCE_MAX_CHARS));
  if (issue) return reject(issue);
  const decoded = decodeTemplate(text, ctx.kicker, ctx.locale);
  if (!decoded.ok) return reject(decoded.reason);
  const refs = sentenceRefs(text, ctx);
  if (!refs.length) return reject('unrelated');
  if (ctx.kicker && refs[0]!.kind !== ctx.kicker) return reject('wrong-kicker');
  if (ctx.now !== undefined && !Number.isFinite(ctx.now)) return reject('expired');
  const until = sentenceValidUntil(refs);
  if (until === null || (ctx.now !== undefined && until <= ctx.now)) return reject('expired');
  if (ctx.now !== undefined && refs[0]!.kind === 'nocas') {
    const hour = Number(NIGHT_HOUR.format(ctx.now));
    if (hour >= 5 && hour < 20) return reject('wrong-kicker');
  }
  return { ok: true };
}
export function writeSentence(raw: string, ctx: SentenceContext, origin: WrittenSentence['origin']): WrittenSentence | null {
  if (CONTROLS.test(raw)) { acceptSentence(raw, ctx); return null; }
  const text = sentenceWithPeriod(raw);
  if (!acceptSentence(text, ctx).ok) return null;
  const refs = sentenceRefs(text, ctx);
  const until = sentenceValidUntil(refs)!;
  return { text, kicker: refs[0]!.kind, refs: refs.map(fact => fact.id),
    validUntil: ctx.now === undefined ? until : sentenceDeadline(text, until, ctx.now), origin };
}
export function readWrittenSentences(raw: unknown, ctx: SentenceContext): WrittenSentence[] {
  if (!Array.isArray(raw)) return [];
  const result: WrittenSentence[] = [];
  for (const value of raw.slice(0, 64)) {
    if (!value || typeof value !== 'object') continue;
    const s = value as Partial<WrittenSentence>;
    if (typeof s.text !== 'string' || !Array.isArray(s.refs)
      || !s.refs.every(ref => typeof ref === 'string') || !SENTENCE_KICKERS.includes(s.kicker!)
      || (s.origin !== 'model' && s.origin !== 'template')) continue;
    const written = writeSentence(s.text, { ...ctx, refs: s.refs, kicker: s.kicker }, s.origin);
    if (written && typeof s.validUntil === 'number' && Number.isFinite(s.validUntil)) {
      written.validUntil = Math.min(written.validUntil!, s.validUntil);
      if (ctx.now !== undefined && written.validUntil <= ctx.now) continue;
    }
    if (written && !result.some(other => other.text === written.text)) result.push(written);
  }
  return result;
}
export function stableSentenceFacts(facts: readonly SentenceFact[], now?: number): SentenceFact[] {
  return facts.filter(fact => !/^(?:dep|departure):/.test(fact.id)
    && !/\b(?:za|in)\s+\d+\s+min\b/i.test(fact.text)
    && typedSentenceFact(fact).ok
    && fact.validUntil !== null && Number.isFinite(fact.validUntil)
    && (now === undefined || fact.validUntil > now)).slice(0, 16);
}

/** The model chooses a family and copies only complete slot assignments. */
export interface SentenceTemplateChoice {
  factId: string;
  family: SentenceChoiceFamily;
  slots: Record<string, string>;
}
interface TemplateOption { choice: SentenceTemplateChoice; text: string }
function templateOptions(ctx: SentenceContext): TemplateOption[] {
  const options: TemplateOption[] = [];
  for (const fact of ctx.facts) {
    const decoded = typedSentenceFact(fact, ctx.locale);
    if (!decoded.ok) { ctx.onReject?.(decoded.reason); continue; }
    const accepted = (text: string) => acceptSentence(text, { ...ctx, facts: [fact], refs: [fact.id] }).ok;
    if (decoded.fact.family === 'always') {
      // Selected by id only: no slot is offered, so the model can neither copy nor write the text.
      const text = registerSentence(decoded.fact.slots.name!.value, decoded.fact.slots.text!.value);
      if (accepted(text)) options.push({ choice: { factId: fact.id, family: 'always', slots: {} }, text });
      continue;
    }
    for (const [family, spec] of familyEntries) {
      const slots: Record<string, string> = {};
      for (const name of Object.keys(spec.slots)) slots[name] = decoded.fact.slots[name]?.value ?? '';
      const text = spec[ctx.locale ?? decoded.fact.locale].replace(/\{(\w+)\}/gu, (_, name: string) => slots[name]!);
      if (!grounded({ ...decoded.fact, family, slots: Object.fromEntries(Object.entries(spec.slots)
        .map(([name, type]) => [name, { type, value: slots[name]! }])) }, decoded.fact)) continue;
      if (accepted(text)) options.push({ choice: { factId: fact.id, family, slots }, text });
    }
  }
  return options;
}
export function sentenceTemplateChoices(ctx: SentenceContext): SentenceTemplateChoice[] {
  return templateOptions(ctx).map(option => option.choice);
}
/** Compare the full contract, then write our own rendering; no model-controlled field is interpolated. */
export function fillSentenceChoice(raw: unknown, ctx: SentenceContext): WrittenSentence | null {
  const reject = (reason: SentenceRejection): null => { ctx.onReject?.(reason); return null; };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return reject('invalid-contract');
  const value = raw as Partial<SentenceTemplateChoice>;
  if (Object.keys(raw).sort().join(',') !== 'factId,family,slots'
    || typeof value.factId !== 'string' || typeof value.family !== 'string'
    || !value.slots || typeof value.slots !== 'object' || Array.isArray(value.slots)) return reject('invalid-contract');
  const option = templateOptions({ ...ctx, onReject: undefined }).find(({ choice }) =>
    choice.factId === value.factId && choice.family === value.family
    && Object.keys(choice.slots).sort().join(',') === Object.keys(value.slots!).sort().join(',')
    && Object.entries(choice.slots).every(([name, slot]) => value.slots![name] === slot));
  if (!option) return reject('invalid-contract');
  return writeSentence(option.text, { ...ctx, refs: [option.choice.factId] }, 'model');
}
