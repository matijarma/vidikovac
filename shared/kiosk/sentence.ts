// Sentence wire contract and conservative acceptance, shared by both clients
// and the Worker. Pure: every time comparison uses the caller's clock.

/** The six kickers, in the owner's words: Promet · Kultura · Vrijeme · Bicikli · Noćas · Radovi. */
export const SENTENCE_KICKERS = ['promet', 'kultura', 'vrijeme', 'bicikli', 'nocas', 'radovi'] as const;
export type SentenceKicker = (typeof SENTENCE_KICKERS)[number];

/** A sentence never runs longer than this on the widest wall; narrower compositions ask for less. */
export const SENTENCE_MAX_CHARS = 80;

/** One fact the sentence may say, already written as a short sentence of its own. */
export interface SentenceFact {
  id: string;
  kind: SentenceKicker;
  text: string;
  /** Epoch ms deadline. Legacy null is wire-compatible but cannot be displayed. */
  validUntil: number | null;
}

/** A sentence ready for the header: its kicker, its text, the facts it rests on. */
export interface WrittenSentence {
  kicker: SentenceKicker;
  text: string;
  /** Ids of the SentenceFacts the text says. */
  refs: string[];
  /** At most the earliest deadline of its refs. Accepted sentences are never timeless. */
  validUntil: number | null;
  origin: 'model' | 'template';
}

/** POST /api/kiosk/sentences, body. */
export interface SentenceRequest {
  locale: 'hr' | 'en';
  /** Characters the composition fits, 40..SENTENCE_MAX_CHARS. */
  budget: number;
  facts: SentenceFact[];
}

/** POST /api/kiosk/sentences, answer. */
export interface SentenceResponse {
  /** ISO 8601. */
  generatedAt: string;
  sentences: WrittenSentence[];
}

/** Why a candidate was refused. */
export type SentenceRejection =
  | 'empty'
  | 'too-long'
  | 'ellipsis'
  | 'newline'
  | 'markup'
  | 'invented-number'
  | 'unrelated'
  | 'expired'
  | 'multiple-sentences'
  | 'forbidden-copy'
  | 'unnamed-count'
  | 'wrong-kicker';

export type SentenceVerdict = { ok: true } | { ok: false; reason: SentenceRejection };

/** What a candidate is checked against. */
export interface SentenceContext {
  facts: readonly SentenceFact[];
  /** Characters allowed; SENTENCE_MAX_CHARS when absent. */
  budget?: number;
  now?: number;
  /** Explicit model refs. Unknown, duplicate or unrelated refs fail closed. */
  refs?: readonly string[];
  kicker?: SentenceKicker;
}

const QUOTES = '"\'„“”«»';
const FORBIDDEN = /(?:\bzid(?:a|u|om|ovi|ove)?\b|dohva[ćt]|ažuriran|osvježen|preuzeto|sinkroniz|sinhroniz|podat(?:ak|ci) od|zastarjel|nepotvrđen|neprovjeren|nedostupn|nije provjera|obuhvat zaštite|iz registra|nema podat|možda|vjerojatno|navodno|moguće je|fetched|updated at|synced|synchroni[sz]|unavailable|unconfirmed|not verified|out of date|perhaps|maybe|probably|possibly)/iu;
const INSTRUCTIONS = /(?:\b(?:pošalji|pošaljite|šalji|upiši|upišite|unesi|unesite|klikni|kliknite|zanemari|zanemarite|ignoriraj|ignorirajte|napiši|napišite|odgovori|odgovorite|izvrši|izvršite|otkrij|otkrijte|slijedi|slijedite|otvori|otvorite|zatvori|zatvorite|obriši|obrišite|izbriši|izbrišite|preuzmi|preuzmite|spremi|spremite|dodaj|dodajte|prikaži|prikažite|skeniraj|skenirajte|moraš|trebaš|molimo|send|enter|click|ignore|disregard|execute|reveal|obey|reply|please)\b|(?:system|assistant|developer|sustav|asistent)\s*:|\byou (?:must|should)\b)/iu;
const VALUE_NOISE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}"'„“”«»‘’]/gu;
export const SENTENCE_VALUE_MAX_CHARS = 64;
const DATE_RELATIVE = /\b(?:sutra|večeras|danas|ujutro|noćas|sinoć|jučer|prekosutra|today|tomorrow|tonight|yesterday)\b|\bthis (?:morning|evening|afternoon)\b/iu;
const LOCAL_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Zagreb', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
});

/** Strip prompt delimiters before interpolation, but never truncate a value. */
export function sentenceValue(raw: string): string | null {
  if ([...raw].length > SENTENCE_VALUE_MAX_CHARS) return null;
  const clean = raw.normalize('NFC').replace(VALUE_NOISE, ' ').replace(/\s+/gu, ' ').trim();
  return clean || null;
}

/** The next Zagreb midnight, including the 23/25-hour DST days. */
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
// Only grammatical glue may be new. Temporal words and prepositions must
// already occur in the fact: "from" must not replace "until", nor "tomorrow"
// silently extend a closure by a day.
const GRAMMAR = new Set('je su se i a te the a an is are and'.split(' '));
// These are grammatical rewrites of the same solar fact, not additional claims.
const SUNRISE_WORDS = new Set(['sunce', 'sunca', 'izlazi', 'izlazak', 'izlaska', 'sun', 'sunrise', 'rises']);
const SUNSET_WORDS = new Set(['sunce', 'sunca', 'zalazi', 'zalazak', 'zalaska', 'sun', 'sunset', 'sets']);
const words = (text: string): string[] => text.toLocaleLowerCase('hr').match(/\p{L}+/gu) ?? [];
const numbers = (text: string): string[] => text.match(/[-+−]?\d+(?:[.,:/]\d+)*/g) ?? [];
const NIGHT_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', hour: 'numeric', hourCycle: 'h23' });
const GENERIC_HEADS = new Set(['the', 'at', 'sunce', 'sunset', 'sunrise', 'zalazak', 'izlazak', 'tramvaj', 'autobus', 'tram', 'bus', 'prvi', 'zadnji', 'dežurna', 'temperatura', 'bajs', 'sutra']);
const solarWords = (fact: SentenceFact): ReadonlySet<string> | undefined =>
  fact.id.startsWith('solar:sunrise:') ? SUNRISE_WORDS : fact.id.startsWith('solar:sunset:') ? SUNSET_WORDS : undefined;

/** Unwrap even one stray quote; never flatten newlines or trim useful content. */
export function normalizeSentence(raw: string): string {
  let text = raw.trim().normalize('NFC');
  if (QUOTES.includes(text[0] ?? '\0')) text = text.slice(1);
  if (QUOTES.includes(text.at(-1) ?? '\0')) text = text.slice(0, -1);
  return text.trim();
}

/** A single terminal period is added, never a cut or an ellipsis. */
export function sentenceWithPeriod(raw: string): string {
  const text = normalizeSentence(raw);
  return text && !/[.!?]$/.test(text) ? `${text}.` : text;
}

/** Dates, decimal temperatures and name initials are not sentence boundaries. */
function hasSecondSentence(text: string): boolean {
  const withoutAbbreviations = text
    .replace(/\b\d{1,2}\.\s*\d{1,2}\.(?:\s*\d{4}\.)?/g, (date, offset: number) =>
      date.replace(/\./g, '') + (/^\s+\p{Lu}/u.test(text.slice(offset + date.length)) ? '.' : ''))
    .replace(/(?<![\d:.,])\d{1,2}\.(?=\s+\p{Ll})/gu, '')
    .replace(/(?<!\p{L})\p{Lu}\.(?=\s*\p{Lu})/gu, '')
    .replace(/\b(?:min|st|dr|sv|av)\.(?=\s)/gi, '');
  return /[.!?]\s*\S/u.test(withoutAbbreviations.replace(/(\d)[.,](?=\d)/g, '$1'));
}

function sharedToken(text: string, fact: SentenceFact): boolean {
  if (normalizeSentence(text).toLocaleLowerCase('hr') === normalizeSentence(fact.text).toLocaleLowerCase('hr')) return true;
  const route = fact.text.match(/\b(tramvaj|autobus|tram|bus)\s+([a-z]?\d+[a-z]*)\b/i);
  if (route && !new RegExp(`\\b${route[1]}\\s+${route[2]}\\b`, 'i').test(text)) return false;
  const named = (fact.text.match(/(?<!\p{L})\p{Lu}[\p{L}-]{2,}/gu) ?? [])
    .map(name => name.toLocaleLowerCase('hr')).filter(name => !GENERIC_HEADS.has(name));
  // "zatvorena" does not make a Maksimir closure evidence about Ilica.
  if (named.length && !named.some(name => words(text).includes(name))) return false;
  if (words(text).some(word => solarWords(fact)?.has(word))
    && numbers(text).some(number => numbers(fact.text).includes(number))) return true;
  const source = new Set(words(fact.text).filter(word => word.length >= 5));
  if (words(text).some(word => source.has(word))) return true;
  // A short proper name still anchors a fact, e.g. BAJS or a named venue.
  return named.some(name => words(text).includes(name));
}

export function sentenceRefs(text: string, ctx: SentenceContext): SentenceFact[] {
  if (ctx.refs) {
    if (!ctx.refs.length || new Set(ctx.refs).size !== ctx.refs.length) return [];
    const selected = ctx.refs.map(id => ctx.facts.find(fact => fact.id === id));
    if (selected.some(fact => !fact || !sharedToken(text, fact))) return [];
    return selected as SentenceFact[];
  }
  return ctx.facts.filter(fact => sharedToken(text, fact));
}

export function sentenceValidUntil(facts: readonly SentenceFact[]): number | null {
  if (!facts.length || facts.some(fact => fact.validUntil === null || !Number.isFinite(fact.validUntil))) return null;
  return Math.min(...facts.map(fact => fact.validUntil!));
}

const withoutPeriod = (text: string): string => text.trim().replace(/\.$/u, '');

/** Recognise only our envelopes. Values are not a vocabulary for new prose. */
function opaqueValues(text: string): string[] {
  const event = text.match(/^.+ počinje događanje „(.+)“ \((.+)\)\.$/u);
  if (event) return [event[1]!, event[2]!];
  const englishEvent = text.match(/^(.+) starts .+?, (.+)\.$/u);
  if (englishEvent) return [englishEvent[1]!, englishEvent[2]!];
  const opening = text.match(/^(.+): rad počinje /u);
  if (opening) return [opening[1]!];
  const englishOpening = text.match(/^(.+) opens /u);
  if (englishOpening) return [englishOpening[1]!];
  const closure = text.match(/^(.+?)(?:: zatvoreno za promet|(?: je)? zatvoren[ao]?| is closed(?: to traffic)?) (?:do|until) /u);
  if (closure) return [closure[1]!];
  const destination = text.match(/(?:, smjer | towards )(.+?)(?:, polazi | leaves )/u);
  if (destination) return [destination[1]!];
  const named = text.match(/^([^:]+): (.+)\.$/u);
  if (named) return [named[1]!, named[2]!];
  return [];
}

/** Complete claims keep each quantity in its source role, not a token pool.
 * Unknown prose is one opaque claim. Only a weather range can be omitted;
 * source names/titles/descriptions are never split at their commas or verbs.
 */
function factClaims(fact: SentenceFact): string[] {
  const text = withoutPeriod(normalizeSentence(fact.text));
  const claims = [text];
  // The optional copula belongs to the closure envelope, not its street name.
  const closure = text.match(/^(.+?)(?: je)? (zatvoren[ao]? do .+)$/u);
  if (closure) claims.push(`${closure[1]} ${closure[2]}`, `${closure[1]} je ${closure[2]}`);
  const weather = text.match(/^([-+−]?\d+(?:,\d+)? °C, [^;]+); (danas do [-+−]?\d+(?:,\d+)? °C)$/u)
    ?? text.match(/^([-+−]?\d+(?:[.,]\d+)? °C, [^;]+); (up to [-+−]?\d+(?:[.,]\d+)? °C today)$/u);
  if (weather) claims.push(weather[1]!, weather[2]!);
  const time = text.match(/\b\d{2}:\d{2}\b/)?.[0];
  const solar = solarWords(fact);
  const solarEnvelope = solar === SUNRISE_WORDS
    ? /^(?:Sunce izlazi u \d{2}:\d{2}|Izlazak sunca je u \d{2}:\d{2}|U \d{2}:\d{2} izlazi sunce|The sun rises at \d{2}:\d{2}|Sunrise is at \d{2}:\d{2}|At \d{2}:\d{2} the sun rises)$/u
    : /^(?:Sunce zalazi u \d{2}:\d{2}|Zalazak sunca je u \d{2}:\d{2}|U \d{2}:\d{2} zalazi sunce|The sun sets at \d{2}:\d{2}|Sunset is at \d{2}:\d{2}|At \d{2}:\d{2} the sun sets)$/u;
  if (solar && time && solarEnvelope.test(text)) {
    const rise = solar === SUNRISE_WORDS;
    if (/[A-Za-z]/.test(text) && /(?:The sun|Sunset|Sunrise|At )/.test(text)) {
      claims.push(`The sun ${rise ? 'rises' : 'sets'} at ${time}`,
        `${rise ? 'Sunrise' : 'Sunset'} is at ${time}`, `At ${time} the sun ${rise ? 'rises' : 'sets'}`);
    } else {
      claims.push(`Sunce ${rise ? 'izlazi' : 'zalazi'} u ${time}`,
        `${rise ? 'Izlazak' : 'Zalazak'} sunca je u ${time}`, `U ${time} ${rise ? 'izlazi' : 'zalazi'} sunce`);
    }
  }
  // Only the grammatical sentence head changes case, never an opaque name.
  return claims.flatMap(claim => /^(?:Sunce|Zalazak|Izlazak|U |The |Sunset|Sunrise|At |danas |up to )/u.test(claim)
    ? [claim, claim[0]!.toLocaleLowerCase('hr') + claim.slice(1), claim[0]!.toLocaleUpperCase('hr') + claim.slice(1)] : [claim]);
}

function coveredByClaims(text: string, refs: readonly SentenceFact[]): boolean {
  const claims = refs.flatMap((fact, index) => factClaims(fact).map(claim => ({ claim, index })));
  const target = withoutPeriod(text);
  const visit = (rest: string, used: number, depth: number): boolean => {
    if (!rest) return used === (1 << refs.length) - 1;
    if (depth >= 4) return false;
    for (const { claim, index } of claims) {
      if (!rest.startsWith(claim)) continue;
      const tail = rest.slice(claim.length);
      if (!tail && visit('', used | (1 << index), depth + 1)) return true;
      const separator = tail.match(/^(?:[;,]\s+|\s+(?:i|and)\s+)/u);
      if (separator && visit(tail.slice(separator[0].length), used | (1 << index), depth + 1)) return true;
    }
    return false;
  };
  return refs.length <= 2 && visit(target, 0, 0);
}

/** Hard constraints are checked again on cache reads and on the client. */
export function acceptSentence(candidate: string, ctx: SentenceContext): SentenceVerdict {
  const text = normalizeSentence(candidate);
  if (text.length === 0) return { ok: false, reason: 'empty' };
  if (text.includes('…') || text.includes('...')) return { ok: false, reason: 'ellipsis' };
  const budget = Math.min(SENTENCE_MAX_CHARS, ctx.budget ?? SENTENCE_MAX_CHARS);
  if (!Number.isFinite(budget) || [...text].length > budget) return { ok: false, reason: 'too-long' };
  if (/[\r\n\u2028\u2029]/u.test(candidate)) return { ok: false, reason: 'newline' };
  if (/[*_`#[\]<>{}|]|https?:|^\s*(?:-\s+|•)|\p{Cc}|\p{Cf}/iu.test(text)) return { ok: false, reason: 'markup' };
  if (hasSecondSentence(text)) return { ok: false, reason: 'multiple-sentences' };
  if (FORBIDDEN.test(text) || INSTRUCTIONS.test(text)) return { ok: false, reason: 'forbidden-copy' };
  if (/\d(?:°|\s+°\s+[CF]\b|(?:min|km|m|h|s)\b)/u.test(text)) return { ok: false, reason: 'forbidden-copy' };
  if (/(?:^|[;,]\s*|^(?:danas|sutra|večeras|ujutro|today|tomorrow|tonight)\s+)(?:\d+\s+(?:zatvaranja|radova|događanja|bicikl|closure|event|bike)|(?:radovi|događanja|zatvaranja)\s+(?:u gradu\s+)?\d)/iu.test(text)) {
    return { ok: false, reason: 'unnamed-count' };
  }
  const refs = sentenceRefs(text, ctx);
  if (!refs.length) return { ok: false, reason: 'unrelated' };
  if (ctx.now !== undefined && !Number.isFinite(ctx.now)) return { ok: false, reason: 'expired' };
  if (ctx.now !== undefined && (ctx.kicker ?? refs[0]!.kind) === 'nocas') {
    const hour = Number(NIGHT_HOUR.format(new Date(ctx.now)));
    if (hour >= 5 && hour < 20) return { ok: false, reason: 'wrong-kicker' };
  }
  if (refs.some(fact => fact.validUntil === null
    || !Number.isFinite(fact.validUntil) || (ctx.now !== undefined && fact.validUntil <= ctx.now))) {
    return { ok: false, reason: 'expired' };
  }
  if (ctx.kicker && !refs.some(fact => fact.kind === ctx.kicker)) return { ok: false, reason: 'wrong-kicker' };
  if (refs.some(fact => FORBIDDEN.test(fact.text) || INSTRUCTIONS.test(fact.text)
    || opaqueValues(fact.text).some(value => sentenceValue(value) !== value))) {
    return { ok: false, reason: 'forbidden-copy' };
  }
  // Numeric tokens, not substrings: 8 is not evidence for 18, nor 21 for -21.
  const knownNumbers = new Set(refs.flatMap(fact => numbers(fact.text)));
  if (numbers(text).some(number => !knownNumbers.has(number))) return { ok: false, reason: 'invented-number' };
  const knownWords = new Set(refs.flatMap(fact => words(fact.text)));
  const solarVocabulary = refs.length === 1 ? solarWords(refs[0]!) : undefined;
  if (refs.some(fact => /\b(?:ne|nije|nisu|not|no)\b/i.test(fact.text))
    && !/\b(?:ne|nije|nisu|not|no)\b/i.test(text)) return { ok: false, reason: 'unrelated' };
  // A shared street name alone must not license an invented flood or location.
  if (words(text).some(word => !knownWords.has(word) && !GRAMMAR.has(word) && !solarVocabulary?.has(word))) {
    return { ok: false, reason: 'unrelated' };
  }
  if (!coveredByClaims(text, refs)) return { ok: false, reason: numbers(text).length ? 'invented-number' : 'unrelated' };
  return { ok: true };
}

/** Rebuild metadata from facts; never trust the model's kicker or expiry. */
export function writeSentence(
  raw: string,
  ctx: SentenceContext,
  origin: WrittenSentence['origin'],
): WrittenSentence | null {
  const text = sentenceWithPeriod(raw);
  if (!acceptSentence(text, ctx).ok) return null;
  const refs = sentenceRefs(text, ctx);
  const until = sentenceValidUntil(refs);
  if (until === null) return null;
  return {
    text, kicker: ctx.kicker ?? refs[0]!.kind, refs: refs.map(fact => fact.id),
    validUntil: ctx.now === undefined ? until : sentenceDeadline(text, until, ctx.now), origin,
  };
}

/** Wire decoder used on both sides of the HTTP/cache boundary. */
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
    // A previously imposed midnight/rhythm deadline cannot roll forward on
    // decoding. Untrusted metadata may shorten validity, never extend it.
    if (written && typeof s.validUntil === 'number' && Number.isFinite(s.validUntil)) {
      written.validUntil = Math.min(written.validUntil!, s.validUntil);
      if (ctx.now !== undefined && written.validUntil <= ctx.now) continue;
    }
    if (written && !result.some(other => other.text === written.text)) result.push(written);
  }
  return result;
}

/** These volatile facts stay client-side even when a caller forgets to filter. */
export function stableSentenceFacts(facts: readonly SentenceFact[], now?: number): SentenceFact[] {
  return facts.filter(fact => !/^(?:dep|departure):/.test(fact.id)
    && !/\b(?:za|in)\s+\d+\s+min\b/i.test(fact.text)
    && [...fact.text].length <= 160
    && opaqueValues(fact.text).every(value => [...value].length <= SENTENCE_VALUE_MAX_CHARS)
    && fact.validUntil !== null && Number.isFinite(fact.validUntil)
    && (now === undefined || fact.validUntil > now)).slice(0, 16);
}
