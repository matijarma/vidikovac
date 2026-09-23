// Third-party text on the wall (decision 18, revised). Street and heritage
// descriptions, event titles and venues, place names and closure summaries come
// from registers and feeds nobody here reviews, refreshed at runtime. The rows
// of "U blizini" (app/src/city/nearby.ts) and the header sentence
// (./sentence.ts, including the `always` family's `register-text`) pass every
// such value through externalText() before it is shown. A value that fails is
// skipped, never repaired or shortened; the caller counts the reason code.
//
// The grammar below is data about Croatian and English verb forms addressed to
// the reader, not a classifier: a second-person or imperative form, a request
// word, a prompt role or a link. Accent folding is ONLY for this check; display
// and grounding always use the source text as it is.

export type ExternalTextKind = 'name' | 'address' | 'title' | 'summary' | 'register-text';
export const EXTERNAL_TEXT_REJECTIONS = ['empty', 'too-long', 'control', 'charset', 'link', 'instruction'] as const;
export type ExternalTextRejection = (typeof EXTERNAL_TEXT_REJECTIONS)[number];
export type ExternalTextVerdict = { ok: true } | { ok: false; reason: ExternalTextRejection };

interface ExternalTextRule {
  /** Unicode code points, spaces and punctuation included. */
  max: number;
  /** Punctuation allowed besides letters, digits and spaces. */
  punctuation: string;
}
// Names and addresses: what the registers write in a name (quotes, brackets,
// dashes, slashes, "&", "+" and the dagger of a date of death). Titles, summaries
// and descriptions also carry sentence marks, "%", "°", "=" and a quoted "…".
const NAME_PUNCTUATION = '.,;:\'’‘"„“”«»()–—-/&+†';
const PROSE_PUNCTUATION = `${NAME_PUNCTUATION}!?%°=…`;
// Lengths bound a flood, not the register: the longest committed heritage name
// and street description are 170 code points (app/public/data/city, 18 Sep).
export const EXTERNAL_TEXT_RULES: Readonly<Record<ExternalTextKind, ExternalTextRule>> = {
  name: { max: 180, punctuation: NAME_PUNCTUATION },
  address: { max: 120, punctuation: NAME_PUNCTUATION },
  title: { max: 180, punctuation: PROSE_PUNCTUATION },
  summary: { max: 180, punctuation: PROSE_PUNCTUATION },
  'register-text': { max: 180, punctuation: PROSE_PUNCTUATION },
};

// Invisible and layout characters are never benign: format controls, line and
// paragraph separators and every space but U+0020 and the no-break space.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u1680\u2000-\u200a\u202f\u205f\u3000]/u;
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

// --- the instruction grammar ----------------------------------------------------
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
  { id: 'hr-request', source: '(?:molimo|molim|nemoj|nemojmo|nemojte|hajde|hajdemo|hajdete|izvolite|vas|vase|vasa|vasu|vasi|vasim|vasih|vam|tvoj|tvoja|tvoje|tvoju|tvoji|tvom|tvog|tvojim|tvojih)',
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
export function instructionRule(text: string): string | null {
  const nfc = text.normalize('NFC');
  const folded = foldText(nfc);
  const singular = foldText(singularReading(nfc));
  for (const { id, pattern, singular: single } of instructionPatterns) {
    if (pattern.test(folded) || single?.test(singular)) return id;
  }
  if (SECOND_PERSON_UNFOLDED.test(nfc.toLocaleLowerCase('hr'))) return 'hr-second-person';
  return splitInstructions.test(folded) ? 'split-command' : null;
}
export function sentenceInstruction(text: string): boolean {
  return instructionRule(text) !== null;
}

// A web or mail address, or a handle, sends the reader somewhere: the wall never prints one.
const LINK = /https?:|www\.|@|(?<![\p{L}\p{N}])[a-z0-9-]+\.(?:hr|com|net|org|eu|info|io|me|app|link|ly)(?![\p{L}\p{N}])/u;

function check(kind: ExternalTextKind, value: string): ExternalTextVerdict {
  const rule = EXTERNAL_TEXT_RULES[kind];
  if (INVISIBLE.test(value)) return { ok: false, reason: 'control' };
  const text = value.normalize('NFC').replace(/\u00a0/gu, ' ');
  if (!/[\p{L}\p{N}]/u.test(text)) return { ok: false, reason: 'empty' };
  if ([...text].length > rule.max) return { ok: false, reason: 'too-long' };
  // Compatibility forms (fullwidth letters, ligatures, superscripts) are not register writing.
  if (text.replace(/…/gu, '').normalize('NFKC') !== text.replace(/…/gu, '')) return { ok: false, reason: 'charset' };
  const folded = foldText(text);
  if (LINK.test(folded)) return { ok: false, reason: 'link' };
  for (const ch of folded) {
    if (!/[a-z0-9 ]/u.test(ch) && !rule.punctuation.includes(ch)) return { ok: false, reason: 'charset' };
  }
  if (sentenceInstruction(text)) return { ok: false, reason: 'instruction' };
  return { ok: true };
}

// Every tick rebuilds the same rows from the same texts: remember the verdicts.
const verdicts = new Map<string, ExternalTextVerdict>();
/**
 * The one check for third-party text before the wall shows it, in a row or in the
 * header: per-kind length and character class, no invisible characters, no link,
 * no verb form addressed to the reader. Never repairs; a failing value is skipped.
 */
export function externalText(kind: ExternalTextKind, value: string): ExternalTextVerdict {
  const key = `${kind}\u0000${value}`;
  const known = verdicts.get(key);
  if (known) return known;
  const verdict = check(kind, value);
  if (verdicts.size >= 2048) verdicts.clear();
  verdicts.set(key, verdict);
  return verdict;
}
