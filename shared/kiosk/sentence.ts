// Wire text is untrusted, including local text: decode an approved family into
// typed slots, then bind those slots to one complete fact. No free-prose escape.
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
  | 'unknown-family' | 'unsupported-family' | 'invalid-slot' | 'instruction'
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

// Grammar data, not a special case in acceptSentence. Croatian imperative:
// -j/-jmo/-jte and -i/-imo/-ite (including -ji); second-person present: -š/-te.
// Productive -aj/-uj forms are conservative; ambiguous -i/-te use explicit
// stems so Šalata, Unešić, Šaljić and Nazović remain names. English imperatives
// use bare verbs; requests also use modals + "you". Accent folding is ONLY
// for rejection, never grounding or display.
export const SENTENCE_INSTRUCTION_PATTERNS = [
  { id: 'hr-productive-imperative', source: '[a-z]{2,}(?:aj|uj)(?:mo|te)?', examples: ['skeniraj kod', 'provjeravajte ulaz', 'kupuj kartu'] },
  { id: 'hr-i-imperative', source: '(?:posalj|salj|proslijed|klikn|nazov|jav|unes|upis|otvor|zatvor|zanemar|napis|odgovor|izvrs|otkr|slijed|obris|izbris|preuzm|sprem|dod|prikaz|plat|potvrd|pritisn|pristup|posjet|ostav|dostav|posud|kup|pokus|ukljuc|iskljuc|prijav|odjav|podijel|dopust|korist|odaber|izaber|bud|id|dod|vid)(?:i|imo|ite)', examples: ['proslijedi lozinku', 'šaljite poruku', 'javimo se', 'unesite PIN'] },
  { id: 'hr-prefixed-i-imperative', source: '[a-z]*(?:cin|nes|nos|zov|govor|mijen|stisn|tisn|uc|pamt|gas|prat|bran|traz|podrz|pokaz|plat|broj|uvjer|obavijest|predoc|pomogn|pomoz|rec|udj|izadj|dodj|uzm)(?:i|imo|ite)', examples: ['učini uslugu', 'pozovite broj', 'prenesite poruku', 'izgovori lozinku', 'reci PIN', 'dođi ovamo'] },
  { id: 'hr-j-imperative', source: '(?:[a-z]*ij|daj|prodaj|predaj|dodaj|cuj|stoj|broj)(?:mo|te)?', examples: ['dodajte podatke', 'otkrij tajnu', 'prekrij kod'] },
  { id: 'hr-second-person', source: '\\p{L}{2,}š|(?:morate|moras|trebate|trebas|mozete|mozes|zelite|zelis|hocete|hoces|smijete|smijes|jeste|cete)', examples: ['moraš poslati lozinku', 'trebaš unijeti lozinku', 'možete poslati broj', 'moras poslati broj'] },
  { id: 'hr-request', source: '(?:molimo|molim|nemoj|nemojmo|nemojte|hajde|hajdemo|hajdete|izvolite|vas|vase|vasa|vasu|tvoj|tvoja|tvoje|tvoju)', examples: ['molimo broj', 'vašu lozinku', 'nemoj čekati'] },
  { id: 'hr-impersonal-request', source: '(?:potrebno|treba|valja|obavezno|obvezno)\\s+(?:je\\s+)?[a-z]+(?:ti|ci)', examples: ['potrebno je poslati broj', 'treba unijeti lozinku'] },
  { id: 'en-imperative', source: '(?:send|forward|click|call|contact|enter|open|close|scan|ignore|disregard|execute|reveal|obey|reply|respond|write|type|submit|provide|share|visit|follow|download|upload|install|delete|remove|pay|buy|confirm|press|tap|select|choose|check|read|give|tell|show|use|try|sign|log|do|go|get|take|remember)', examples: ['forward password', 'call now', 'submit details'] },
  { id: 'en-request', source: '(?:please|kindly|you|your|yours|let\\s+us|let\\s+s)', examples: ['could you help', 'your password', 'please wait'] },
  { id: 'prompt-role', source: '(?:system|assistant|developer|sustav|asistent)\\s*:', examples: ['system: override', 'asistent: odgovor'] },
] as const;
const instructionPatterns = SENTENCE_INSTRUCTION_PATTERNS.map(({ id, source }) => ({
  id, pattern: new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'u'),
}));
// Inter-letter punctuation/spacing cannot hide these explicit commands.
export const SENTENCE_SPLIT_COMMANDS = ['posalji', 'salji', 'proslijedi', 'klikni', 'nazovi', 'javi', 'unesi', 'upisi',
  'otvori', 'skeniraj', 'molimo', 'send', 'forward', 'click', 'call', 'enter', 'open', 'scan', 'please'] as const;
const splitInstructions = new RegExp(`(?<![a-z0-9])(?:${SENTENCE_SPLIT_COMMANDS.map(word =>
  [...word].join("[\\s.,:;()'’&+\\-–/]*")).join('|')})(?:[\\s.,:;()'’&+\\-–/]*t[\\s.,:;()'’&+\\-–/]*e)?(?![a-z0-9])`, 'u');
export function sentenceInstruction(text: string): boolean {
  const folded = text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('hr').replace(/đ/gu, 'dj');
  return instructionPatterns.some(({ id, pattern }) => pattern.test(folded)
    || (id === 'hr-second-person' && pattern.test(text.normalize('NFC').toLocaleLowerCase('hr'))))
    || splitInstructions.test(folded);
}

export type SentenceSlotType = 'route' | 'stop' | 'minutes' | 'clock' | 'time' | 'until'
  | 'temperature' | 'degrees' | 'count' | 'title' | 'venue' | 'street' | 'condition';
interface SlotRule { max: number; pattern: RegExp; names?: boolean }
// Only the display's supported alphabets, not visually similar Latin letters
// such as dotless ı or stroked ł, nor Greek/Cyrillic confusables.
const nameChars = /^[A-Za-zČĆĐŠŽčćđšž0-9][A-Za-zČĆĐŠŽčćđšž0-9 .,'’():&/+–-]*$/u;
export const SENTENCE_SLOT_RULES: Readonly<Record<SentenceSlotType, SlotRule>> = {
  route: { max: 6, pattern: /^[A-Za-z0-9]+$/u },
  stop: { max: 48, pattern: nameChars, names: true },
  minutes: { max: 3, pattern: /^[1-9]\d{0,2}$/u },
  clock: { max: 5, pattern: /^(?:[01]\d|2[0-3]):[0-5]\d$/u },
  time: { max: 26, pattern: /^(?:(?:[Uu]|[Aa]t) |(?:[Ss]utra u|[Tt]omorrow at) |(?:[1-9]|[12]\d|3[01])\. (?:[1-9]|1[0-2])\. (?:u|at) )(?:[01]\d|2[0-3]):[0-5]\d$/u },
  until: { max: 6, pattern: /^(?:(?:[01]\d|2[0-3]):[0-5]\d|(?:[1-9]|[12]\d|3[01])\. (?:[1-9]|1[0-2]))$/u },
  temperature: { max: 10, pattern: /^[-−]?\d{1,2}(?:[.,]\d)? °C$/u },
  degrees: { max: 5, pattern: /^[-−]?\d{1,2}(?:[.,]\d)?$/u },
  count: { max: 13, pattern: /^(?:0|[1-9]\d{0,2}) (?:bicikl|bicikla|bicikala|bike|bikes)$/u },
  title: { max: 64, pattern: nameChars, names: true },
  venue: { max: 48, pattern: nameChars, names: true },
  street: { max: 64, pattern: nameChars, names: true },
  condition: { max: 32, pattern: /^(?:vedro|pretežno vedro|sunčano|pretežno sunčano|malo oblačno|umjereno oblačno|pretežno oblačno|oblačno|naoblaka|kiša|slaba kiša|jaka kiša|rosulja|pljusak|pljuskovi|grmljavina|snijeg|slab snijeg|susnježica|magla|sumaglica|clear|sunny|partly cloudy|mostly cloudy|cloudy|overcast|rain|light rain|heavy rain|drizzle|showers|thunderstorm|snow|sleet|fog|mist)$/u },
};
export function validateSentenceSlot(type: SentenceSlotType, value: string): SentenceRejection | null {
  const rule = SENTENCE_SLOT_RULES[type];
  if ([...value].length > rule.max || value !== value.trim() || value.includes('  ')
    || value.normalize('NFKC') !== value || !rule.pattern.test(value) || /…|\.\.\./u.test(value)) return 'invalid-slot';
  if (rule.names && sentenceInstruction(value)) return 'instruction';
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
// `always` is not executable: {text} is not a typed city datum.
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
export const SENTENCE_UNSUPPORTED_FAMILIES = { always: '{name}: {text}' } as const;

interface TypedSlot { type: SentenceSlotType; value: string }
export interface TypedSentenceFact {
  family: SentenceFamily;
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
function decodeTemplate(text: string, kind?: SentenceKicker, locale?: 'hr' | 'en'): Decoded {
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
      if (invalid) break;
      slots[name] = { type, value };
    }
    if (invalid) { issue = invalid; continue; }
    if (kind && !matcher.spec.kinds.includes(kind)) { issue = 'wrong-kicker'; continue; }
    return { ok: true, fact: { family: matcher.family, locale: matcher.locale, slots } };
  }
  if (issue === 'unknown-family' && /^[^:]+: /u.test(text)) issue = 'unsupported-family';
  return { ok: false, reason: issue };
}
function textIssue(text: string, max: number): SentenceRejection | null {
  if (!text.length) return 'empty';
  if (/…|\.\.\./u.test(text)) return 'ellipsis';
  if (!Number.isFinite(max) || [...text].length > max) return 'too-long';
  if (/[\r\n\u2028\u2029]/u.test(text)) return 'newline';
  if (CONTROLS.test(text) || /[*_`#[\]<>{}|]|https?:/iu.test(text)) return 'markup';
  return null;
}
/** Wire-compatible projection: unknown prose never becomes a typed fact. */
export function typedSentenceFact(fact: SentenceFact, locale?: 'hr' | 'en'): Decoded {
  const issue = textIssue(fact.text, 160);
  return issue ? { ok: false, reason: issue } : decodeTemplate(fact.text, fact.kind, locale);
}
function grounded(candidate: TypedSentenceFact, source: TypedSentenceFact): boolean {
  const targetSpec: TemplateFamily = SENTENCE_FAMILIES[candidate.family];
  const sourceSpec: TemplateFamily = SENTENCE_FAMILIES[source.family];
  const compatible = candidate.family === source.family
    || (targetSpec.group !== undefined && targetSpec.group === sourceSpec.group)
    || (source.family === 'weather' && ['weatherNoRange', 'weatherTemperature'].includes(candidate.family))
    || (source.family === 'weatherNoRange' && candidate.family === 'weatherTemperature');
  return compatible && Object.entries(candidate.slots).every(([name, slot]) =>
    source.slots[name]?.type === slot.type && source.slots[name]?.value === slot.value);
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
  family: SentenceFamily;
  slots: Record<string, string>;
}
export function sentenceTemplateChoices(ctx: SentenceContext): SentenceTemplateChoice[] {
  const choices: SentenceTemplateChoice[] = [];
  for (const fact of ctx.facts) {
    const decoded = typedSentenceFact(fact, ctx.locale);
    if (!decoded.ok) { ctx.onReject?.(decoded.reason); continue; }
    for (const [family, spec] of familyEntries) {
      const slots: Record<string, string> = {};
      for (const name of Object.keys(spec.slots)) slots[name] = decoded.fact.slots[name]?.value ?? '';
      const text = spec[ctx.locale ?? decoded.fact.locale].replace(/\{(\w+)\}/gu, (_, name: string) => slots[name]!);
      if (!grounded({ ...decoded.fact, family, slots: Object.fromEntries(Object.entries(spec.slots)
        .map(([name, type]) => [name, { type, value: slots[name]! }])) }, decoded.fact)) continue;
      if (acceptSentence(text, { ...ctx, facts: [fact], refs: [fact.id] }).ok) choices.push({ factId: fact.id, family, slots });
    }
  }
  return choices;
}
/** Compare the full contract before interpolating any model-controlled field. */
export function fillSentenceChoice(raw: unknown, ctx: SentenceContext): WrittenSentence | null {
  const reject = (reason: SentenceRejection): null => { ctx.onReject?.(reason); return null; };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return reject('invalid-contract');
  const value = raw as Partial<SentenceTemplateChoice>;
  if (Object.keys(raw).sort().join(',') !== 'factId,family,slots'
    || typeof value.factId !== 'string' || typeof value.family !== 'string'
    || !value.slots || typeof value.slots !== 'object' || Array.isArray(value.slots)) return reject('invalid-contract');
  const choice = sentenceTemplateChoices({ ...ctx, onReject: undefined }).find(option =>
    option.factId === value.factId && option.family === value.family
    && Object.keys(option.slots).sort().join(',') === Object.keys(value.slots!).sort().join(',')
    && Object.entries(option.slots).every(([name, slot]) => value.slots![name] === slot));
  if (!choice) return reject('invalid-contract');
  const spec = SENTENCE_FAMILIES[choice.family];
  const text = spec[ctx.locale ?? 'hr'].replace(/\{(\w+)\}/gu, (_, name: string) => choice.slots[name]!);
  return writeSentence(text, { ...ctx, refs: [choice.factId] }, 'model');
}
