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
  /** Epoch ms after which the fact no longer holds (a departure, a sunset); null when it holds all day. */
  validUntil: number | null;
}

/** A sentence ready for the header: its kicker, its text, the facts it rests on. */
export interface WrittenSentence {
  kicker: SentenceKicker;
  text: string;
  /** Ids of the SentenceFacts the text says. */
  refs: string[];
  /** The earliest validUntil of its refs; null when none expires. */
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
const FORBIDDEN = /(?:\bzid(?:a|u|om|ovi|ove)?\b|dohva[ćt]|ažuriran|osvježen|preuzeto|podat(?:ak|ci) od|zastarjel|nepotvrđen|neprovjeren|nedostupn|nije provjera|obuhvat zaštite|iz registra|nema podat|fetched|updated at|unavailable|unconfirmed|not verified|out of date)/iu;
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
  const times = facts.flatMap(fact => fact.validUntil === null ? [] : [fact.validUntil]);
  return times.length ? Math.min(...times) : null;
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
  if (FORBIDDEN.test(text)) return { ok: false, reason: 'forbidden-copy' };
  if (/^(?:\d+\s+(?:zatvaranja|radova|događanja|bicikl|closure|event|bike)|(?:radovi|događanja|zatvaranja)\s+(?:u gradu\s+)?\d)/iu.test(text)) {
    return { ok: false, reason: 'unnamed-count' };
  }
  const refs = sentenceRefs(text, ctx);
  if (!refs.length) return { ok: false, reason: 'unrelated' };
  if (ctx.now !== undefined && !Number.isFinite(ctx.now)) return { ok: false, reason: 'expired' };
  if (ctx.now !== undefined && (ctx.kicker ?? refs[0]!.kind) === 'nocas') {
    const hour = Number(NIGHT_HOUR.format(new Date(ctx.now)));
    if (hour >= 5 && hour < 20) return { ok: false, reason: 'wrong-kicker' };
  }
  if (ctx.now !== undefined && refs.some(fact => fact.validUntil === null
    && /(?:sunce (?:zalazi|izlazi)|sunrise|sunset|sun (?:sets|rises)|(?:zadnji|prvi) tramvaj|(?:last|first) tram)/i.test(fact.text))) {
    return { ok: false, reason: 'expired' };
  }
  if (refs.some(fact => fact.validUntil !== null
    && (!Number.isFinite(fact.validUntil) || (ctx.now !== undefined && fact.validUntil <= ctx.now)))) {
    return { ok: false, reason: 'expired' };
  }
  if (ctx.kicker && !refs.some(fact => fact.kind === ctx.kicker)) return { ok: false, reason: 'wrong-kicker' };
  // Numeric tokens, not substrings: 8 is not evidence for 18, nor 21 for -21.
  const knownNumbers = new Set(refs.flatMap(fact => numbers(fact.text)));
  if (numbers(text).some(number => !knownNumbers.has(number))) return { ok: false, reason: 'invented-number' };
  // Two cited facts cannot lend each other their times across clauses.
  for (const clause of text.split(/\s*;\s*|\s+(?:i|and)\s+/i)) {
    const anchored = refs.filter(fact => sharedToken(clause, fact));
    if (numbers(clause).length && (!anchored.length
      || numbers(clause).some(number => !anchored.some(fact => numbers(fact.text).includes(number))))) {
      return { ok: false, reason: 'invented-number' };
    }
  }
  const knownWords = new Set(refs.flatMap(fact => words(fact.text)));
  const solarVocabulary = refs.length === 1 ? solarWords(refs[0]!) : undefined;
  if (refs.some(fact => /\b(?:ne|nije|nisu|not|no)\b/i.test(fact.text))
    && !/\b(?:ne|nije|nisu|not|no)\b/i.test(text)) return { ok: false, reason: 'unrelated' };
  // A shared street name alone must not license an invented flood or location.
  if (words(text).some(word => !knownWords.has(word) && !GRAMMAR.has(word) && !solarVocabulary?.has(word))) {
    return { ok: false, reason: 'unrelated' };
  }
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
  return {
    text, kicker: ctx.kicker ?? refs[0]!.kind, refs: refs.map(fact => fact.id),
    validUntil: sentenceValidUntil(refs), origin,
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
    if (written && !result.some(other => other.text === written.text)) result.push(written);
  }
  return result;
}

/** These volatile facts stay client-side even when a caller forgets to filter. */
export function stableSentenceFacts(facts: readonly SentenceFact[], now?: number): SentenceFact[] {
  return facts.filter(fact => !/^(?:dep|departure):/.test(fact.id)
    && !/\b(?:za|in)\s+\d+\s+min\b/i.test(fact.text)
    && (now === undefined || fact.validUntil === null || fact.validUntil > now)).slice(0, 16);
}
