// Third-party text on the wall (decision 18, revised). Street and heritage
// descriptions, event titles and venues, place names and closure summaries come
// from registers and feeds nobody here reviews, refreshed at runtime. The rows
// of "U blizini" (app/src/city/nearby.ts) and the header sentence
// (./sentence.ts, including the `always` family's `register-text`) pass every
// such value through externalText() before it is shown. A value that fails is
// skipped, never repaired or shortened; the caller counts the reason code.
//
// Decision 21: structural limits/vectors are shared. Headers are the city's
// voice: every sensitive lexeme and reader request rejects. Rows quote items:
// sentence-local sensitive pairs reject, with requests only amplifying partial
// vectors in prose (decision 20). Single hits and imperative names pass rows.
// Folding is rejection-only; display/grounding always use the original text.
import {
  EXTERNAL_CONTACT_TARGETS, EXTERNAL_HEADER_LEXICON, EXTERNAL_HEADER_SEPARATORS,
  EXTERNAL_LEET, EXTERNAL_LEXICON_SEPARATORS, EXTERNAL_NAME_SENTENCE_BREAKS,
  EXTERNAL_NAME_SEPARATORS, EXTERNAL_NUMERIC_DATA,
  EXTERNAL_PAIR_RULES, EXTERNAL_PARTIAL_VECTORS, EXTERNAL_SENTENCE_BREAKS,
  EXTERNAL_SENSITIVE_LEXICON, EXTERNAL_VECTOR_PATTERNS,
  EXTERNAL_PLACE_ABBREVIATIONS,
} from './external-text-policy';
import { installExternalTextBoundary } from './external-text-boundary';
import { TOP_LEVEL_DOMAINS } from './tlds';
import { CODE_WORD_FIELDS, CODE_WORD_STREETS } from './code-word-streets';
import { ISO_4217_CODES } from './iso-4217';

export type ExternalTextKind = 'name' | 'address' | 'title' | 'summary' | 'register-text' | 'headsign';
export type ExternalTextSurface = 'header' | 'row';
export interface ExternalTextOptions { surface: ExternalTextSurface }
export const EXTERNAL_TEXT_REJECTIONS = ['empty', 'too-long', 'control', 'charset', 'link', 'phone', 'account', 'payment', 'qr', 'instruction'] as const;
export type ExternalTextRejection = (typeof EXTERNAL_TEXT_REJECTIONS)[number];
export type ExternalTextVerdict = { ok: true } | { ok: false; reason: ExternalTextRejection };
/** Names and addresses: the kinds whose register shorthand keeps its dots (W-C10). */
const isNameKind = (kind: ExternalTextKind | undefined): boolean => kind === 'name' || kind === 'address';

interface ExternalTextRule {
  /** Unicode code points, spaces and punctuation included. */
  max: number;
  /** Punctuation allowed besides letters, digits and spaces. */
  punctuation: string;
}
// Names and addresses: what the registers write in a name (quotes, brackets,
// dashes, slashes, "&", "+" and the dagger of a date of death). Titles, summaries
// and descriptions also carry sentence marks, "%", "°", "=" and a quoted "…".
const NAME_PUNCTUATION = '.,;:\'’‘"„“”«»()–—-/&+†·';
const PROSE_PUNCTUATION = `${NAME_PUNCTUATION}!?%°=…`;
// Lengths bound a flood, not the register: the longest committed heritage name
// and street description are 170 code points (app/public/data/city, 18 Sep).
export const EXTERNAL_TEXT_RULES: Readonly<Record<ExternalTextKind, ExternalTextRule>> = {
  name: { max: 180, punctuation: NAME_PUNCTUATION },
  address: { max: 120, punctuation: NAME_PUNCTUATION },
  title: { max: 180, punctuation: PROSE_PUNCTUATION },
  // DHMZ writes numeric comparisons such as "> 20 mm", escaped by the DOM.
  summary: { max: 180, punctuation: `${PROSE_PUNCTUATION}>` },
  'register-text': { max: 180, punctuation: PROSE_PUNCTUATION },
  // Both dash forms occur in the committed GTFS headsigns.
  headsign: { max: 40, punctuation: "–-.,'" },
};

// Invisible and layout characters are never benign: format controls, line and
// paragraph separators and every space but U+0020 and the no-break space.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u1680\u2000-\u200a\u202f\u205f\u3000]/u;
// Latin letters that NFKD leaves whole: folded so that "proslıjedi" and
// "prosłijedi" read as the verb they imitate. Any other letter left after
// folding (Cyrillic, Greek, any other script) fails the character class.
const FOLD: Readonly<Record<string, string>> = {
  đ: 'dj', ı: 'i', ł: 'l', ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe', þ: 'th', ð: 'd', ħ: 'h', ŧ: 't', ŋ: 'n', ſ: 's', ĸ: 'k',
};

/** Rejection-only folding: compatibility forms, no marks, lower case, the table above. */
export function foldText(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('hr').replace(/[^\x00-\x7f]/gu, ch => FOLD[ch] ?? ch);
}

// --- reader-action grammar: all header kinds; row prose amplifier only ---------
//
// Croatian i-verbs write the singular imperative and the third person present
// alike (javi, prati, slijedi), and some of those forms are also nouns (ugovori
// "contracts", koristi "benefits") or names (Ivanovoj Reci). So the rules are in
// two tiers:
//   - `source`: forms that can only address the reader, matched anywhere: the
//     plural and first-person-plural imperatives (-ite, -imo, -ajte, -ujte,
//     -ijte), the second person present (-iš, -eš, -ite, -ete), request words.
//   - `singular`: the singular imperative, matched in lower case or ALL CAPS, or
//     capitalised where a clause opens (the text's start, after . : ; ! ? ( – —
//     or an opening quote). A capitalised word inside a clause is a name
//     ("posjed Rudeš", "Aerodrom Borongaj", "potoku Ivanovoj Reci"). The few
//     homographs in INSTRUCTION_HOMOGRAPHS never match in the singular; their
//     plural and second person still do.
// W-C2's stems, less "pokus": "pokusi" is a noun (experiments) and no verb's imperative; "pokušajte" is -ajte.
const I_STEMS = 'posalj|salj|proslijed|klikn|nazov|jav|unes|upis|otvor|zatvor|zanemar|napis|odgovor|izvrs|otkr|slijed|obris|izbris|preuzm|sprem|dod|prikaz|plat|potvrd|pritisn|pristup|posjet|ostav|dostav|posud|kup|ukljuc|iskljuc|prijav|odjav|podijel|dopust|korist|odaber|izaber|bud|id|vid';
// Stems that take a prefix (po-zovi, na-uči, iz-govori): the plural and the
// second person with any prefix; the singular with the prefixes of the language.
const PREFIXED_STEMS = 'cin|nes|nos|zov|govor|mijen|stisn|tisn|uc|pamt|gas|prat|bran|traz|podrz|pokaz|plat|broj|uvjer|obavijest|predoc|pomogn|pomoz|rec|udj|izadj|dodj|uzm';
const PREFIXES = '(?:po|na|u|iz|is|pre|pri|za|do|od|o|ob|pro|s|raz|nad|pod)?';
// Singular -aj and -uj: only verb-forming suffixes (-iraj, -avaj, -ivaj, -uj) and
// common verbs; "kraj", "događaj", "Borongaj" and "Zelengaj" are nouns and names.
const AJ_VERBS = 'citaj|procitaj|gledaj|pogledaj|slusaj|poslusaj|pitaj|upitaj|igraj|zaigraj|cekaj|pricekaj|sacekaj|probaj|isprobaj|uzivaj|docekaj|znaj|imaj|daj|prodaj|predaj|dodaj|izdaj';
// Singular -j: explicit verbs only; "broj" and Latin nouns ("Orfanotrofij",
// "Planetarij", "Konzervatorij") are not imperatives.
const J_VERBS = 'cuj|stoj|otkrij|prekrij|pokrij|sakrij|skrij|popij|pij|ugrij|zagrij';

/** Singular forms the registers and feeds write as a noun or a third person present (folded); their plural and second person still match. */
export const INSTRUCTION_HOMOGRAPHS = [
  // Seen in the committed registers or the sampled feeds (22-23 Sep): "u obrani Sigeta", "Kino na travi donosi …",
  // "Linija 3 ne koristi stajalište", "potpisani ugovori".
  'obrani', 'donosi', 'koristi', 'ugovori',
  // Their commonest neighbours in register and programme prose: "ulica nosi ime", "izložbu prati katalog",
  // "park čini cjelinu", "govori autor", "Razgovori o gradu", "zbirka broji 500 predmeta", "nakon predavanja slijedi razgovor".
  'nosi', 'prenosi', 'prati', 'cini', 'govori', 'razgovori', 'dogovori', 'broji', 'slijedi',
] as const;
const notHomograph = `(?!(?:${INSTRUCTION_HOMOGRAPHS.join('|')})(?![\\p{L}\\p{N}]))`;

/**
 * The grammar, rule by rule, with forms it must catch (`examples`) and register
 * or feed text it must let through (`passes`); test/app/kiosk-sentence.test.ts and
 * test/app/external-text.test.ts check both, in NFC, NFD and capitals.
 */
export const SENTENCE_INSTRUCTION_PATTERNS = [
  { id: 'hr-productive-imperative', source: '[a-z]{2,}(?:aj|uj|ij)(?:mo|te)', singular: `[a-z]{2,}(?:iraj|avaj|ivaj)|[a-z]{2,}uj|(?:${AJ_VERBS})`,
    examples: ['skeniraj kod', 'provjeravajte ulaz', 'kupuj kartu', 'pogledaj ovo', 'otkrijte tajnu', 'DAJ PRIJEDLOG'],
    passes: ['naselje kraj Božjakovine', 'Aerodrom Borongaj', 'Zelengaj: naziv zemljišta', 'dvorac obitelji Ratkaj', 'događaj u gradu'] },
  { id: 'hr-i-imperative', source: `(?:${I_STEMS})(?:imo|ite)`, singular: `(?:${I_STEMS})i`,
    examples: ['proslijedi lozinku', 'šaljite poruku', 'javimo se', 'unesite PIN', 'posjetite stranicu', 'Muzej: kupi kartu'],
    passes: ['Nakon predavanja slijedi razgovor', 'Linija 3 ne koristi stajalište', 'naselje na Kupi', 'Kemijski pokusi'] },
  { id: 'hr-prefixed-i-imperative', source: `[a-z]*(?:${PREFIXED_STEMS})(?:imo|ite)`, singular: `${PREFIXES}(?:${PREFIXED_STEMS})i`,
    examples: ['učini uslugu', 'pozovite broj', 'prenesite poruku', 'izgovori lozinku', 'reci PIN', 'dođi ovamo', 'pozovi broj'],
    passes: ['ulica nosi ime po gradu', 'Izložbu prati katalog', 'potpisani ugovori za nabavu', 'potoku Ivanovoj Reci', 'Park čini cjelinu'] },
  { id: 'hr-j-imperative', source: `(?:${J_VERBS})(?:mo|te)`, singular: `(?:${J_VERBS})`,
    examples: ['dodajte podatke', 'otkrij tajnu', 'prekrij kod'],
    passes: ['cesta broj 44', 'Orfanotrofij (danas Katolički bogoslovni fakultet)', 'Planetarij'] },
  { id: 'hr-second-person', source: `(?:morate|moras|trebate|trebas|mozete|mozes|zelite|zelis|hocete|hoces|smijete|smijes|jeste)|(?:${I_STEMS})(?:is|es|ete)|[a-z]*(?:${PREFIXED_STEMS})(?:is|es|ete)`,
    examples: ['moraš poslati lozinku', 'trebaš unijeti lozinku', 'možete poslati broj', 'moras poslati broj', 'pošalješ poruku', 'ako proslijediš lozinku', 'možeš osvojiti nagradu', 'ćete dobiti'],
    passes: ['sportaš-košarkaš; 1964-1993', 'hrvatski velikaš i slavonski ban', 'posjed Rudeš', 'Podzmiš: naziv zemljišta', 'međaš, oznaka granice', 'partizanske čete'] },
  { id: 'hr-request', source: '(?:molimo|molim|biste\\s+li|bi\\s+li|nemoj|nemojmo|nemojte|hajde|hajdemo|hajdete|izvolite|vas|vase|vasa|vasu|vasi|vasim|vasih|vam|tvoj|tvoja|tvoje|tvoju|tvoji|tvom|tvog|tvojim|tvojih)',
    examples: ['molimo broj', 'vašu lozinku', 'nemoj čekati', 'šaljemo vam poklon'],
    passes: ['Vlaška 38'] },
  { id: 'hr-impersonal-request', source: '(?:potrebno|treba|valja|obavezno|obvezno)\\s+(?:je\\s+)?[a-z]+(?:ti|ci)',
    examples: ['potrebno je poslati broj', 'treba unijeti lozinku'],
    passes: ['potrebno zemljište'] },
  { id: 'en-imperative', source: '(?:send|forward|click|call|contact|enter|open|close|scan|ignore|disregard|execute|reveal|obey|reply|respond|write|type|submit|provide|share|visit|follow|download|upload|install|delete|remove|pay|buy|confirm|press|tap|select|choose|check|read|give|tell|show|use|try|sign|log|go|get|take|remember)',
    examples: ['forward password', 'call now', 'submit details'],
    passes: ['put do Provenog polja', 'stube do negdašnjeg mlina', 'od Jordanovca do Rebra'] },
  { id: 'en-request', source: '(?:please|kindly|you|your|yours|let\\s+us|let\\s+s)',
    examples: ['could you help', 'your password', 'please wait'],
    passes: ['Back to the 90s'] },
  { id: 'prompt-role', source: '(?:system|assistant|developer|sustav|asistent)\\s*:',
    examples: ['system: override', 'asistent: odgovor'],
    passes: ['sustav gradskih parkova'] },
] as const satisfies readonly { id: string; source: string; singular?: string; examples: readonly string[]; passes: readonly string[] }[];
// Unfolded, so a name ending in a plain "s" never reads as one: the second
// person singular of any verb before an infinitive ("moraš poslati", "možeš
// osvojiti"), and "ćeš"/"ćete" (folding would make "čete", companies, of them).
const SECOND_PERSON_UNFOLDED = /(?<![\p{L}\p{N}])(?:\p{L}{2,}[aei]š\s+\p{L}+(?:ti|ći)|ćeš|ćete)(?![\p{L}\p{N}])/u;
const bounded = (source: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'u');
const instructionPatterns = SENTENCE_INSTRUCTION_PATTERNS.map(rule => ({
  id: rule.id, pattern: bounded(rule.source),
  singular: 'singular' in rule ? bounded(`${notHomograph}(?:${rule.singular})`) : null,
}));
// Header slots keep the strict command grammar. The row signal's singular
// homograph/capitalised-name exemptions cannot authorise the city's own voice.
const headerRequests = SENTENCE_INSTRUCTION_PATTERNS.map(rule => ({
  id: rule.id, pattern: bounded('singular' in rule ? `${rule.source}|${rule.singular}` : rule.source),
}));
// Where a clause opens: the start, sentence and clause marks, a spaced dash, an opening bracket or quote.
const CLAUSE_OPENS = /(?:^|[.:;!?(\[–—„“"«]|\s-)[\s"„“«(]*$/u;
/**
 * The folded text with every capitalised word inside a clause blanked: the text
 * the singular imperatives are read in. "Borongaj", "Reci" or "Kupi" mid-clause
 * are names; "Kupi kartu", "kupi kartu" and "KUPI KARTU" are not.
 */
function singularReading(text: string): string {
  return text.replace(/\p{L}[\p{L}\p{M}]*/gu, (word, offset: number) => {
    const named = /^\p{Lu}/u.test(word) && /\p{Ll}/u.test(word) && !CLAUSE_OPENS.test(text.slice(0, offset));
    return named ? ' ' : word;
  });
}

// Inter-letter punctuation/spacing cannot hide these explicit commands.
export const SENTENCE_SPLIT_COMMANDS = ['posalji', 'salji', 'proslijedi', 'klikni', 'nazovi', 'javi', 'unesi', 'upisi',
  'otvori', 'skeniraj', 'molimo', 'send', 'forward', 'click', 'call', 'enter', 'open', 'scan', 'please'] as const;
const splitInstructions = new RegExp(`(?<![a-z0-9])(?:${SENTENCE_SPLIT_COMMANDS.map(word =>
  [...word].join("[\\s.,:;()'’&+\\-–/]*")).join('|')})(?:[\\s.,:;()'’&+\\-–/]*t[\\s.,:;()'’&+\\-–/]*e)?(?![a-z0-9])`, 'u');

/** The rule a text trips ('hr-i-imperative', …, 'hr-second-person', 'split-command'), or null. */
export function readerRequestRule(text: string): string | null {
  const nfc = text.normalize('NFC');
  const folded = foldText(nfc);
  const singular = foldText(singularReading(nfc));
  for (const { id, pattern, singular: single } of instructionPatterns) {
    if (pattern.test(folded) || single?.test(singular)) return id;
  }
  if (SECOND_PERSON_UNFOLDED.test(nfc.toLocaleLowerCase('hr'))) return 'hr-second-person';
  return splitInstructions.test(folded) ? 'split-command' : null;
}
// Tokenize the small policy grammar, keeping character classes and quantifiers
// intact. Separators may occur at a stem/suffix boundary too ("n a z o v i").
function separatedLexeme(source: string, separators = EXTERNAL_LEXICON_SEPARATORS): string {
  return (source.match(/\[a-z\]\*|[a-z]| \*?|[^a-z]/gu) ?? []).map(token => {
    // Prefer the first whole-word boundary: a greedy suffix would swallow the
    // partner ("p a s s w o r d send") and turn two disjoint lexemes into one.
    if (token === '[a-z]*') return `(?:[a-z]${separators})*?`;
    if (/^[a-z]$/u.test(token)) return `(?:${token}${separators})`;
    if (token.startsWith(' ')) return separators;
    return token;
  }).join('');
}
const sensitivePatterns = EXTERNAL_SENSITIVE_LEXICON.map(rule => ({
  id: rule.id,
  role: rule.role,
  pattern: bounded(rule.source),
  separated: bounded(separatedLexeme(rule.source)),
  nameSeparated: bounded(separatedLexeme(rule.source, EXTERNAL_NAME_SEPARATORS)),
}));
const headerPatterns = EXTERNAL_HEADER_LEXICON.map(rule => ({
  id: rule.id, pattern: bounded(rule.source),
  separated: bounded(separatedLexeme(rule.source, EXTERNAL_HEADER_SEPARATORS)),
}));

interface Evidence { list: string; value: string; start: number; end: number }
export interface SensitiveTextPair {
  rule: (typeof EXTERNAL_PAIR_RULES)[number]['id'];
  sentence: string;
  left: Evidence;
  right: Evidence;
}
const partialPatterns = EXTERNAL_PARTIAL_VECTORS.map(rule => ({ ...rule, pattern: bounded(rule.source) }));
const contactPatterns = EXTERNAL_CONTACT_TARGETS.map(rule => ({ ...rule, pattern: bounded(rule.source) }));
function readings(text: string): string[] {
  const folded = foldText(text);
  const leet = folded.replace(/[0134578]/gu, ch => EXTERNAL_LEET[ch]!);
  const leetL = folded.replace(/[0134578]/gu, ch => ch === '1' ? 'l' : EXTERNAL_LEET[ch]!);
  return [...new Set([folded, leet, leetL])];
}
function evidence(text: string, list: string, pattern: RegExp): Evidence[] {
  return [...text.matchAll(new RegExp(pattern.source, 'gu'))].map(match => ({
    list, value: match[0].trim(), start: match.index, end: match.index + match[0].trimEnd().length,
  }));
}
function caseReading(text: string): string {
  // Preserve case while retaining folded offsets (Đ -> DJ, ß -> ss).
  return text.normalize('NFC').replace(/\p{L}[\p{L}\p{M}]*/gu,
    word => word === word.toLocaleUpperCase('hr') ? foldText(word).toUpperCase() : foldText(word));
}
function partialVectors(text: string): Evidence[] {
  const cased = caseReading(text);
  return partialPatterns.flatMap(rule => evidence(rule.casing === 'original' ? cased : foldText(text), rule.id, rule.pattern));
}
const disjoint = (a: Evidence, b: Evidence): boolean => a.end <= b.start || b.end <= a.start;

/** Only the geographic preposition, never "kod:", digits or a code token.
 * Preserve all other lexemes: a geographic phrase cannot excuse an action
 * paired with a credential elsewhere in the same sentence. In a name or an
 * address, a house number is a place too when "kod" hangs on a street word by
 * a hyphen ("Sopnička-kod 10D", the stop at number 10D). */
function geographicReading(text: string, names = false): string {
  const insensitive = (word: string) => !sensitivePatterns.some(({ pattern }) => pattern.test(foldText(word)));
  return text.replace(/(?<![\p{L}\p{N}])kod(?= +([\p{L}\p{N}]+))/giu, (word, next: string, offset: number) => {
    const place = /^\p{Lu}\p{Ll}{2,}$/u.test(next);
    const genitive = /^(?:crkve|crkvice|kapele|groblja|groblj[a-z]*|škole|skole|kuće|kuce|mosta|potoka|rijeke|jezera|grada|sela|naselja|dvorca|parka|parkirališta|parkiralista|hotela|samostana|mlina|planine|brda|benzinske)$/iu.test(next);
    const street = names && /^\d{1,3}\p{L}?$/u.test(next)
      ? /(?<![\p{L}\p{N}])(\p{Lu}\p{Ll}{2,})-$/u.exec(text.slice(0, offset))?.[1] : undefined;
    const house = street !== undefined && insensitive(street);
    return (place || genitive || house) && insensitive(next) ? ' '.repeat(word.length) : word;
  });
}

/** Exact pair evidence for tests/audits; callers still log reason codes only.
 * A name or an address (`kind`) is split and read with its dots kept inside words. */
export function sensitiveTextPair(text: string, kind?: ExternalTextKind): SensitiveTextPair | null {
  const names = isNameKind(kind);
  for (const sentence of text.split(names ? EXTERNAL_NAME_SENTENCE_BREAKS : EXTERNAL_SENTENCE_BREAKS)) {
    const groups: Record<(typeof EXTERNAL_PAIR_RULES)[number]['left' | 'right'], Evidence[]> = {
      noun: [], action: [], contact: [], 'partial-vector': partialVectors(sentence),
      'contact-target': contactPatterns.flatMap(rule => evidence(foldText(sentence), rule.id, rule.pattern)),
    };
    for (const reading of readings(geographicReading(sentence, names))) {
      for (const { id, role, pattern, separated, nameSeparated } of sensitivePatterns) {
        groups[role].push(...evidence(reading, id, pattern), ...evidence(reading, id, names ? nameSeparated : separated));
      }
    }
    for (const rule of EXTERNAL_PAIR_RULES) for (const left of groups[rule.left]) {
      const right = groups[rule.right].find(candidate => disjoint(left, candidate));
      if (right) return { rule: rule.id, sentence, left, right };
    }
  }
  return null;
}

/** A sensitive noun/verb is evidence only when it has a sentence-local partner. */
export function sensitiveTextRule(text: string, kind?: ExternalTextKind): string | null {
  return sensitiveTextPair(text, kind)?.rule ?? null;
}

/** Prose-only layer 3: a reader request amplifies a pair or partial vector. */
export function instructionRule(text: string): string | null {
  const pair = sensitiveTextRule(text);
  if (pair) return pair;
  for (const sentence of text.split(EXTERNAL_SENTENCE_BREAKS)) {
    if (!readerRequestRule(sentence)) continue;
    for (const token of partialVectors(sentence)) {
      // Do not turn an uppercase/leet command into its own second signal.
      const cased = caseReading(sentence);
      const request = readerRequestRule(`${cased.slice(0, token.start)} ${cased.slice(token.end)}`);
      if (request) return `reader-${request}`;
    }
  }
  return null;
}
/** Strict header policy: single sensitive hits and reader requests in any slot. */
export function headerInstructionRule(text: string, kind?: ExternalTextKind): string | null {
  const folded = readings(geographicReading(text, isNameKind(kind)));
  for (const reading of folded) {
    for (const { id, pattern, separated } of headerPatterns) {
      if (pattern.test(reading) || separated.test(reading)) return id;
    }
  }
  for (const reading of folded) for (const { id, pattern } of headerRequests) {
    if (pattern.test(reading)) return id;
  }
  return readerRequestRule(text);
}
export function sentenceInstruction(text: string): boolean {
  return headerInstructionRule(text) !== null;
}

// A word of a committed street's own name that is spelled like an ISO 4217 code ("Nova Ves":
// VES) is that street, not a currency, in exactly two cases (decision 41): the bare address
// "<register street> <house number>" (1-3 digits and an optional letter, nothing else), and the
// committed register fields pinned byte-exact in CODE_WORD_FIELDS. Any other text, a free-text
// prefix above all, is judged by the normal rules with no exception. Only the currency-amount
// vector is affected, only on a row's name or address; the header surface keeps the code a
// currency (review-w-fix6, -6b, -6c).
const CURRENCY_CODES = new Set(ISO_4217_CODES.map(code => code.toLowerCase()));
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const REGISTER_STREETS = [...CODE_WORD_STREETS].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
const BARE_STREET_ADDRESS = new RegExp(`^(?:${REGISTER_STREETS}) \\d{1,3}[a-z]?$`, 'u');
const STREET_IN_FIELD = new RegExp(`(?<![\\p{L}\\p{N}])(?:${REGISTER_STREETS})(?= \\d)`, 'gu');
const REGISTER_FIELDS = new Set(CODE_WORD_FIELDS);
/** Decided on the ORIGINAL string, before NFC or NBSP normalization: byte-exact equality with a
 *  pinned field, or the bare grammar on the raw text. A canonical equivalent (NFD, a Kelvin sign,
 *  an NBSP) is not the pinned field and gets no exception (review-w-fix6d). */
function registerStreetEligible(raw: string): boolean {
  return REGISTER_FIELDS.has(raw) || BARE_STREET_ADDRESS.test(raw);
}
function maskRegisterStreet(text: string): string {
  return text.replace(STREET_IN_FIELD, street => street.replace(/\p{L}+/gu, word => CURRENCY_CODES.has(word.toLowerCase()) ? '___' : word));
}

/** Structural evidence for corpus audits; production callers log codes only. `raw` is the text as
 *  it arrived, before normalization: the register-street exception is decided on it alone. */
export function externalTextVector(value: string, kind?: ExternalTextKind, surface?: ExternalTextSurface, raw = value): { reason: ExternalTextRejection; value: string } | null {
  const text = foldText(value);
  const named = surface === 'row' && isNameKind(kind) && registerStreetEligible(raw) ? foldText(maskRegisterStreet(value.normalize('NFC'))) : text;
  for (const entry of EXTERNAL_VECTOR_PATTERNS) {
    const match = entry.source.exec('currency' in entry ? named : text);
    if (match) return { reason: entry.reason, value: match[0] };
  }
  // Names and addresses write register shorthand without a space: "Muzej
  // suv.umjetnosti", "Inst. R.Bošković", "N.S.knjižnica", "Stud.dom S.Radić",
  // "d.d.". There a dotted token is a web address only when its last label is
  // a top-level domain (dr.ai, secure.cc, muzej.hr, kino.xyz); www, http and @
  // are refused above in every kind. The lexical layer reads such a name with
  // its dots inside words (EXTERNAL_NAME_SENTENCE_BREAKS).
  if (isNameKind(kind)) {
    for (const match of text.matchAll(/(?<![a-z0-9_-])[a-z0-9_-]+(?:\.[a-z0-9_-]+)+/gu)) {
      const last = match[0].slice(match[0].lastIndexOf('.') + 1).replace(/^[_-]+|[_-]+$/gu, '');
      if (TOP_LEVEL_DOMAINS.has(last) || last.startsWith('xn--')) return { reason: 'link', value: match[0] };
    }
    return numericVector(text, kind);
  }
  // Other kinds: abbreviations "sv.", "dr.", "kn.", "br.", "tzv.", "npr.", "sl."
  // followed by space/end contain no letter-dot-letter token. Never exempt
  // their prefixes in dr.ai, sv.example, etc. The existing exact GTFS tokens
  // also occur in route names and accessible summaries, not just headsigns.
  for (const match of text.matchAll(/(?<![a-z0-9])([a-z0-9_-]+)\.([a-z][a-z0-9_-]*)(?![a-z0-9])/gu)) {
    if ((EXTERNAL_PLACE_ABBREVIATIONS.has(match[0])
      && !/^\.[a-z0-9]/u.test(text.slice(match.index + match[0].length)))
      || /^t\.b\.j\.jelacica(?![a-z0-9]|\.[a-z0-9])/u.test(text.slice(match.index))) continue;
    return { reason: 'link', value: match[0] };
  }
  // A dotted run of single letters is not a sequence of independent safe
  // sentences. The sole multi-initial GTFS place spelling is explicit.
  for (const match of text.matchAll(/(?<![a-z0-9])(?:[a-z0-9]\.){2,}[a-z0-9]/gu)) {
    if (!/[a-z]/u.test(match[0])) continue; // Numeric runs retain phone/account evidence.
    if (/^t\.b\.j\.jelacica(?![a-z0-9]|\.[a-z0-9])/u.test(text.slice(match.index))) continue;
    return { reason: 'link', value: match[0] };
  }
  return numericVector(text, kind);
}

function numericVector(text: string, kind: ExternalTextKind | undefined): { reason: ExternalTextRejection; value: string } | null {
  // Match the complete numeric run before counting, never just six adjacent
  // digits: spacing, slashes, punctuation and parentheses cannot hide a number.
  for (const match of text.matchAll(/\d(?:[\d .,/'’():+–-]*\d)?/gu)) {
    const run = match[0];
    const digits = run.replace(/\D/gu, '');
    // House-number ranges in names/addresses are data, not phone formatting.
    // Require a preceding street-name word and the WHOLE run to be one range:
    // 50-52 passes; 50-52-1234, numeric lists and unanchored 50-52 do not.
    if ((kind === 'address' || kind === 'name') && /^\d{1,4} *[-–] *\d{1,4}$/u.test(run)
      && /[a-z][a-z'’-]* +$/u.test(text.slice(0, match.index))) continue;
    const formatted = digits.length >= 4 && /^\d+(?:[ –-]+\d+)+$/u.test(run);
    if ((!formatted && digits.length < 6) || EXTERNAL_NUMERIC_DATA.some(pattern => pattern.test(run))) continue;
    return { reason: digits.length >= 13 ? 'account' : 'phone', value: run };
  }
  return null;
}

function check(kind: ExternalTextKind, value: string, surface: ExternalTextSurface, vectorsOnly = false): ExternalTextVerdict {
  const rule = EXTERNAL_TEXT_RULES[kind];
  if (INVISIBLE.test(value)) return { ok: false, reason: 'control' };
  if (kind === 'headsign' && value.includes('\u00a0')) return { ok: false, reason: 'charset' };
  const text = value.normalize('NFC').replace(/\u00a0/gu, ' ');
  if (!/[\p{L}\p{N}]/u.test(text)) return { ok: false, reason: 'empty' };
  if ([...text].length > rule.max) return { ok: false, reason: 'too-long' };
  // Compatibility forms (fullwidth letters, ligatures, superscripts) are not register writing.
  if (text.replace(/…/gu, '').normalize('NFKC') !== text.replace(/…/gu, '')) return { ok: false, reason: 'charset' };
  const folded = foldText(text);
  const vector = externalTextVector(text, kind, surface, value);
  if (vector) return { ok: false, reason: vector.reason };
  for (const ch of text) {
    if (!/[\p{Script=Latin}0-9 ]/u.test(ch) && !rule.punctuation.includes(ch)) return { ok: false, reason: 'charset' };
  }
  // Latin phonetic/lookalike letters not covered by the folding table cannot
  // stand in for a lexeme's letters (for example pɑssword). Do not widen W-C4's
  // supported alphabet merely because a character has Script=Latin.
  for (const ch of folded) {
    if (!/[a-z0-9 ]/u.test(ch) && !rule.punctuation.includes(ch)) return { ok: false, reason: 'charset' };
  }
  if (vectorsOnly) return { ok: true };
  const instruction = surface === 'row'
    ? (kind === 'summary' || kind === 'register-text') ? instructionRule(text) : sensitiveTextRule(text, kind)
    : headerInstructionRule(text, kind);
  if (instruction) {
    return { ok: false, reason: 'instruction' };
  }
  return { ok: true };
}

// Every tick rebuilds the same rows from the same texts: remember the verdicts.
const verdicts = new Map<string, ExternalTextVerdict>();
/**
 * The one check for third-party text before the wall shows it, in a row or in the
 * header. The surface is required: header slots must never inherit row leniency.
 * Never repairs; a failing value is skipped on that surface only.
 */
export function externalText(kind: ExternalTextKind, value: string, { surface }: ExternalTextOptions): ExternalTextVerdict {
  // Do not retain arbitrarily large rejected source strings in the tick cache.
  if (value.length > EXTERNAL_TEXT_RULES[kind].max * 3) return check(kind, value, surface);
  const key = `${surface}\u0000${kind}\u0000${value}`;
  const known = verdicts.get(key);
  if (known) return known;
  const verdict = check(kind, value, surface);
  if (verdicts.size >= 2048) verdicts.clear();
  verdicts.set(key, verdict);
  return verdict;
}

/** Render-boundary API. Return the exact input or null, never a repair.
 * Runtime checks also cover untyped callers and malformed remote payloads. */
export function vetExternal(kind: ExternalTextKind, value: unknown, surface: ExternalTextSurface): string | null {
  if (typeof value !== 'string' || !Object.hasOwn(EXTERNAL_TEXT_RULES, kind)
    || (surface !== 'header' && surface !== 'row')) return null;
  return externalText(kind, value, { surface }).ok ? value : null;
}
/** Personal maps retain quoted content unless the shared structural layer
 * refuses it. Public maps keep the full contextual row check. */
export function vetExternalMap(kind: ExternalTextKind, value: unknown, publicDisplay: boolean): string | null {
  if (publicDisplay) return vetExternal(kind, value, 'row');
  if (typeof value !== 'string' || !Object.hasOwn(EXTERNAL_TEXT_RULES, kind)) return null;
  return check(kind, value, 'row', true).ok ? value : null;
}
installExternalTextBoundary(vetExternal, vetExternalMap);
