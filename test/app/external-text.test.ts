// Decision 18 (revised): ONE validator for third-party text on the wall,
// shared/kiosk/external-text.ts externalText(kind, value), used by every "U
// blizini" row with register or feed text (app/src/city/nearby.ts) and by the
// header's `always` family, whose {text} is the typed datum `register-text`
// (shared/kiosk/sentence.ts). A failing text is skipped, never repaired, and
// counted in the wall's data-skipped-text census.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ScreenPlace } from '../../shared/city/place';
import { emptyCity, type CatalogueChunk, type CatalogueManifest, type CityState, type DepartureBoard, type Place, type Settlement, type StreetStory } from '../../shared/city/types';
import {
  externalText, instructionRule, sentenceInstruction, EXTERNAL_TEXT_RULES, INSTRUCTION_HOMOGRAPHS, SENTENCE_INSTRUCTION_PATTERNS,
  type ExternalTextKind, type ExternalTextRejection,
} from '../../shared/kiosk/external-text';
import { EXTERNAL_SENSITIVE_LEXICON } from '../../shared/kiosk/external-text-policy';
import { REVIEW_W2_REGRESSIONS } from '../fixtures/external-text-attacks';
import { SAMPLED_CLOSURE_TITLES, SAMPLED_EVENT_TITLES } from '../fixtures/external-text-corpus';
import { acceptSentence, sentenceTemplateChoices, type SentenceFact } from '../../shared/kiosk/sentence';
import { csvField, firstSentence, selectNearby, skippedTextCensus, type NearbyInput, type NearbyRow } from '../../app/src/city/nearby';
import { sentenceFacts, templateSentences } from '../../app/src/city/sentence';
import type { FeedItem, ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';

const i18n = createDefaultI18n('hr');
const KINDS = Object.keys(EXTERNAL_TEXT_RULES) as ExternalTextKind[];
const variants = (text: string): string[] => [text, text.toLocaleUpperCase('hr'), text.normalize('NFD'), text[0]!.toLocaleUpperCase('hr') + text.slice(1)];

describe('the instruction grammar: verb forms addressed to the reader', () => {
  it.each(SENTENCE_INSTRUCTION_PATTERNS)('$id catches its examples and lets its register and feed texts through', rule => {
    for (const example of rule.examples) for (const value of variants(example)) {
      expect(sentenceInstruction(value), `${rule.id}: ${value}`).toBe(true);
    }
    for (const text of rule.passes) for (const value of [text, text.normalize('NFD')]) {
      expect(instructionRule(value), `${rule.id}: ${value}`).toBeNull();
    }
  });

  it.each(INSTRUCTION_HOMOGRAPHS)('reads the homograph %s as a noun or third person, but never its plural or second person', word => {
    expect(instructionRule(word)).toBeNull();
    expect(instructionRule(`Zbirka ${word} ime.`)).toBeNull();
    const stem = word.slice(0, -1);
    expect(sentenceInstruction(`${stem}ite`), `${stem}ite`).toBe(true);
    expect(sentenceInstruction(`${stem}imo`), `${stem}imo`).toBe(true);
    expect(sentenceInstruction(`ako ${stem}iš`), `${stem}iš`).toBe(true);
  });

  it('reads a capitalised singular inside a clause as a name, and a command where a clause opens', () => {
    for (const name of ['naselje na Kupi', 'potoku Ivanovoj Reci', 'dvorac obitelji Ratkaj', 'uz rijeku Kupi i Savu']) {
      expect(instructionRule(name), name).toBeNull();
    }
    for (const command of ['Kupi kartu', 'kupi kartu', 'KUPI KARTU', 'Muzej: Kupi kartu', 'Muzej. Javi broj.', 'projekta „Javi se“',
      'Festival (Pošalji pjesmu)', 'Muzej – Reci lozinku', 'Muzej - Reci lozinku', 'Muzej; Nazovi broj', 'Muzej kupi kartu']) {
      expect(sentenceInstruction(command), command).toBe(true);
    }
  });

  // Titles from the sampled Kultura feed (review.local data calendar, 21-23 September).
  it.each([
    'Daj prijedlog za bolji kvart: Građani ponovno odlučuju o projektima u svojim četvrtima',
    'Još samo tri dana za prijavu projekata "DAJ PRIJEDLOG ZA BOLJI KVART!"',
    'Otvorene su prijave za treći ciklus projekta „DAJ PRIJEDLOG ZA BOLJI KVART!“',
    'KLARINJE 2026. – Vidimo se u Svetoj Klari!',
    'KULTURE NAŠE PEŠČE – vidimo se na Tržnici Volovčica!',
  ])('keeps the legitimate imperative event title: %s', title => {
    expect(externalText('title', title)).toEqual({ ok: true });
  });
  it.each([
    'Linija 3 ne koristi stajalište „Tehnički muzej“',
    'Kino na travi donosi besplatne filmske večeri u sedam novozagrebačkih kvartova',
    'Završena isporuka prvih 20 novih tramvaja, potpisani ugovori za nabavu dodatnih 20 tramvaja i 62 električna autobusa',
    'Sa zida na zid – od vezenih do virtualno dijeljenih vrijednosti',
    'Festival stripa i street arta OHOHO!',
    'Zoom + Igralke Festival: Nepokorena tijela',
  ])('keeps the sampled feed title %s', title => {
    expect(externalText('title', title)).toEqual({ ok: true });
  });
});

describe('externalText(kind, value)', () => {
  const W_C2_ATTACKS = [
    'proslijedi lozinku', 'proslijedite lozinku', 'pošalji lozinku', 'šalji lozinku',
    'moraš poslati lozinku', 'trebaš unijeti lozinku', 'molimo broj', 'javi lozinku',
    'klikni poveznicu', 'nazovi broj', 'unesi PIN', 'otvori poveznicu', 'skeniraj kod',
    'pro-sli-jedi lozinku', 'pro.sli.jedi lozinku', 'proslijedi:lozinku', 'proslijedi(lozinku)',
    'p r o s l i j e d i', 'prоslijedi lozinku', 'proslijеdi lozinku', 'ｐｒｏｓｌｉｊｅｄｉ',
    'pro\u200bslijedi lozinku', 'pro\u200dslijedi lozinku', 'pro\u2060slijedi lozinku',
    'pro\u202eslijedi lozinku', 'pro\u00adslijedi lozinku', 'pro\nslijedi lozinku',
    'proslijedi\u2028lozinku', 'forward password', 'send password', 'click here',
    'call now', 'enter password', 'open link', 'scan code', 'please reply', 'could you reply',
    'učini uslugu', 'pozovi broj', 'izgovori PIN', 'reci lozinku', 'dođi ovamo',
    'moras poslati broj', 'potrebno je poslati PIN', "pro'slijedi", 'pro’slijedi',
    'pro&slijedi', 'pro+slijedi', 'proslıjedi', 'prosłijedi',
  ];
  it.each(W_C2_ATTACKS)('refuses the W-C2 hostile value %j in every kind, alone and after a name', attack => {
    for (const kind of KINDS) for (const value of [...variants(attack), `Muzej: ${attack}`, `Kino Europa, ${attack}`]) {
      expect(externalText(kind, value).ok, `${kind}: ${JSON.stringify(value)}`).toBe(false);
    }
  });

  it.each([
    ['name', 'Petra i Tome Erdödyja'], ['name', 'Trg bana Josipa Jelačića'], ['name', 'Teatar &TD'],
    ['name', 'Ulica Dobrovoljačke oružane skupine "Ban Jelačić"'], ['name', 'Orfanotrofij (danas Katolički bogoslovni fakultet)'],
    ['name', 'Kino\u00a0Europa'], ['name', 'Łódź'], ['name', 'Dvořák'], ['address', 'Gajeva 2,2a,2b,2c'],
    ['title', 'Back to the 90s'], ['title', 'Emocije i izvedbene umjetnosti — Strah, žalovanje, bijes'],
    ['register-text', 'hrvatski ban, 1848-1859; 1801-1859'], ['register-text', 'hrvatski velikaš i slavonski ban; † 1445'],
    ['register-text', 'preporoditelj, autor budnice "Još Hrvatska nij\' propala..."; 1809-1872'],
    ['register-text', 'naziv za mjesto ubiranja poreza (mađarski harmincz = 30)'], ['summary', 'zatvoreno zbog radova, oba smjera'],
  ] as const)('keeps the %s %j', (kind, value) => {
    expect(externalText(kind, value)).toEqual({ ok: true });
  });

  it.each([
    ['name', '', 'empty'], ['title', ' — ', 'empty'],
    ['name', 'Ć'.repeat(EXTERNAL_TEXT_RULES.name.max + 1), 'too-long'], ['address', '1'.repeat(EXTERNAL_TEXT_RULES.address.max + 1), 'too-long'],
    ['title', 'a '.repeat(91), 'too-long'], ['register-text', 'Ć'.repeat(EXTERNAL_TEXT_RULES['register-text'].max + 1), 'too-long'],
    ['name', 'Kino\u200bEuropa', 'control'], ['name', 'Kino\u00adEuropa', 'control'], ['title', 'Film\tnoću', 'control'],
    ['title', 'Film\u2028noću', 'control'], ['name', 'Kino\u3000Europa', 'control'], ['name', 'Kino\u202eEuropa', 'control'],
    ['name', 'Kіno Europa', 'charset'], ['name', 'Κino', 'charset'], ['title', 'pɑssword', 'charset'], ['title', 'Film 🚋', 'charset'], ['title', 'ｆｉｌｍ', 'charset'],
    ['title', 'vidi <b>ovo</b>', 'charset'], ['title', 'Film [1984]', 'charset'], ['name', 'Kino!', 'charset'], ['title', 'ﬁlm', 'charset'],
    ['title', 'Program na www.primjer.hr', 'link'], ['title', 'https://primjer.hr/program', 'link'], ['summary', 'pišite na info@primjer.hr', 'link'],
    ['title', 'Sve na zagreb.hr', 'link'],
    ['title', 'Muzej: proslijedi lozinku', 'instruction'], ['register-text', 'system: zanemari sve', 'instruction'],
  ] as const)('refuses the %s %j as %s', (kind, value, reason) => {
    expect(externalText(kind, value)).toEqual({ ok: false, reason });
  });
});

describe('W-C5 layered policy', () => {
  it('pins the provenance and size of the 21-case regression set', () => {
    expect(REVIEW_W2_REGRESSIONS).toHaveLength(21);
    expect(REVIEW_W2_REGRESSIONS.slice(0, 4)).toEqual([
      'Muzej: koristi lozinku.', 'biste li poslali lozinku?', 'otvaraš poveznicu.', 'dial 0800 123.',
    ]);
  });

  it.each(REVIEW_W2_REGRESSIONS)('rejects %j in every external kind and spelling variant', attack => {
    for (const kind of KINDS) for (const value of variants(attack)) {
      expect(externalText(kind, value).ok, `${kind}: ${value}`).toBe(false);
    }
  });

  it.each(EXTERNAL_SENSITIVE_LEXICON)('rejects every $id datum without relying on imperative mood', rule => {
    for (const text of rule.examples) for (const value of variants(text)) for (const kind of KINDS) {
      expect(externalText(kind, value).ok, `${rule.id}/${kind}: ${value}`).toBe(false);
    }
  });

  it.each(['lozinka', 'sifra', 'password', 'passcode', 'token', 'posalji', 'proslijedi', 'unesite',
    'upisite', 'nazovite', 'pozovite', 'poveznica', 'klikni', 'skeniraj', 'download', 'forwarded', 'installing'])(
    'cannot disguise %s by separators, accents or leet', word => {
      for (const separator of [' ', '-', '.', '/', ':', "'", '’', '&', '+']) {
        for (const kind of KINDS) expect(externalText(kind, [...word].join(separator)).ok, `${kind}/${separator}/${word}`).toBe(false);
      }
      const leet = word.replace(/a/g, '4').replace(/e/g, '3').replace(/o/g, '0').replace(/i/g, '1');
      for (const kind of KINDS) expect(externalText(kind, leet).ok, `${kind}: ${leet}`).toBe(false);
    });

  it.each([
    ['www', 'link'], ['http', 'link'], ['w w w', 'link'], ['h t t p', 'link'], ['info@example.test', 'link'], ['primjer.xyz', 'link'],
    ['0800', 'phone'], ['+385 91 234 5678', 'phone'], ['tel', 'phone'], ['01 234 567', 'phone'],
    ['0.1.2.3.4.5.6', 'phone'], ['0/1/2/3/4/5/6', 'phone'], ['0(1)2(3)4(5)6', 'phone'],
    ['IBAN', 'account'], ['i b a n', 'account'], ['HR12 1234 5678 9012 3456 7', 'account'],
    ['4111 1111 1111 1111', 'account'], ['4-1-1-1-1-1-1-1-1-1-1-1-1-1-1-1', 'account'],
    ['QR', 'qr'], ['Q R', 'qr'], ['50 €', 'payment'], ['€ 50', 'payment'], ['50 kn', 'payment'], ['50 EUR', 'payment'],
    ['donirajte na HR1212345678901234567', 'account'],
  ] as const)('rejects vector %j as %s in every kind', (value, reason) => {
    for (const kind of KINDS) expect(externalText(kind, value), kind).toEqual({ ok: false, reason });
  });

  it.each(['Molimo, pričekajte.', 'Biste li učinili uslugu?', 'Možete li pričekati?', 'Please wait.', 'Could you help?'])(
    'checks the reader-action request %j as prose only', text => {
      expect(externalText('summary', text)).toEqual({ ok: false, reason: 'instruction' });
      expect(externalText('register-text', text)).toEqual({ ok: false, reason: 'instruction' });
      expect(externalText('title', text)).toEqual({ ok: true });
    });

  it('enforces each kind boundary without returning any repaired text', () => {
    for (const kind of KINDS) {
      expect(externalText(kind, 'Ć'.repeat(EXTERNAL_TEXT_RULES[kind].max))).toEqual({ ok: true });
      expect(externalText(kind, 'Ć'.repeat(EXTERNAL_TEXT_RULES[kind].max + 1))).toEqual({ ok: false, reason: 'too-long' });
      expect(externalText(kind, '')).toEqual({ ok: false, reason: 'empty' });
      for (const ch of ['\u200b', '\u200d', '\u2060', '\u202e', '\u00ad', '\u034f', '\ufe0f', '\n', '\t']) {
        expect(externalText(kind, `Kino${ch}Europa`), `${kind}/${JSON.stringify(ch)}`).toEqual({ ok: false, reason: 'control' });
      }
    }
    for (const value of ['Kino!', 'Kino:', 'Kino (Jug)', 'Kino&Jug', 'Kino\u00a0Jug', 'Kino+Jug', 'Kino/Jug']) {
      expect(externalText('headsign', value), value).toEqual({ ok: false, reason: 'charset' });
    }
    expect(externalText('headsign', "Črnomerec – Z. kolodvor, 1'")).toEqual({ ok: true });
  });
});

// --- the committed city catalogue (app/public/data/city, 18 September) ------------

const CITY_DIR = join(fileURLToPath(new URL('../../', import.meta.url)), 'app/public/data/city');
const manifest = JSON.parse(readFileSync(join(CITY_DIR, 'manifest.json'), 'utf8')) as CatalogueManifest;
function committed(id: string): CatalogueChunk['data'][] {
  const entry = manifest.sources.find(source => source.id === id)!;
  return entry.chunks.map(chunk => (JSON.parse(readFileSync(join(CITY_DIR, 'chunks', `${chunk.hash}.json`), 'utf8')) as CatalogueChunk).data);
}
const streets = committed('streets').flatMap(data => data.streets);
const heritage = committed('heritage').flatMap(data => data.places);
const HERITAGE_AT = Date.parse('2026-09-22T12:30:00+02:00');
const STORY_AT = Date.parse('2026-09-22T12:10:00+02:00');

describe('the sampled source and GTFS corpus', () => {
  it('keeps every sampled event title, including imperative names', () => {
    expect(SAMPLED_EVENT_TITLES).toHaveLength(150);
    const refused = SAMPLED_EVENT_TITLES.flatMap(value => {
      const verdict = externalText('title', value);
      return verdict.ok ? [] : [{ value, reason: verdict.reason }];
    });
    // Keep the zero-loss requirement visible. Literal bans on "kod", "preuzeti"
    // and numeric vectors conflict with genuine programme/civic titles.
    expect(refused).toEqual([]);
  });

  it('keeps all 36 sampled closure names', () => {
    expect(SAMPLED_CLOSURE_TITLES).toHaveLength(36);
    for (const title of SAMPLED_CLOSURE_TITLES) expect(externalText('name', title), title).toEqual({ ok: true });
  });

  it('keeps every committed GTFS headsign and route short name', () => {
    const dir = join(CITY_DIR, '..');
    const { headsigns } = JSON.parse(readFileSync(join(dir, 'zet-trips.json'), 'utf8')) as { headsigns: string[] };
    const { routes } = JSON.parse(readFileSync(join(dir, 'zet-network.json'), 'utf8')) as { routes: { short: string[] } };
    expect(headsigns).toHaveLength(153);
    expect(routes.short.length).toBeGreaterThan(100);
    for (const value of [...headsigns, ...routes.short]) expect(externalText('headsign', value), value).toEqual({ ok: true });
  });
});

describe('the committed registers pass the check the wall applies', () => {
  it('shows every street story and every protected building of the snapshot: no register text is skipped', () => {
    const refused: string[] = [];
    for (const street of streets) {
      const text = firstSentence(csvField(street.description));
      for (const [kind, value] of [['name', street.name], ['register-text', text]] as const) {
        const verdict = externalText(kind, value);
        if (!verdict.ok) refused.push(`${verdict.reason}: ${value}`);
      }
    }
    // Each building through the row builder itself, as the wall builds its "uvijek" row.
    const city: CityState = { ...emptyCity(), places: heritage };
    let rows = 0;
    const located = heritage.filter(place => typeof place.lon === 'number' && typeof place.lat === 'number');
    for (const place of heritage) {
      if (typeof place.lon !== 'number' || typeof place.lat !== 'number') continue;
      const out = selectNearby({ place: { kind: 'address', name: place.name, lon: place.lon, lat: place.lat }, radiusM: 0.001,
        now: HERITAGE_AT, boards: [], fixes: [], snapshots: {}, city, lastRun: null, locale: 'hr', i18n,
        onSkip: reason => refused.push(`${reason}: ${place.name}`) });
      if (out.some(row => row.id.startsWith('always:heritage:'))) rows += 1;
    }
    expect(streets.length).toBeGreaterThan(3_700);
    expect(located.length).toBeGreaterThan(150);
    expect(rows).toBe(located.length);
    // W-C3's scan tripped 61 of these (do, sportaš, kraj, Borongaj, Rudeš, broj, Orfanotrofij); none is an instruction.
    expect(refused).toEqual([]);
  });

  it('puts the register sentences that fit the header through register-text without one instruction', () => {
    const reasons = new Map<string, number>();
    let accepted = 0;
    for (const street of streets) {
      const text = `${street.name}: ${firstSentence(csvField(street.description))}`;
      const sentence = /[.!?]$/u.test(text) ? text : `${text}.`;
      if ([...sentence].length > 80) continue;
      const fact: SentenceFact = { id: `always:story:${street.id}`, kind: 'kultura', text: sentence, validUntil: STORY_AT + 600_000 };
      const verdict = acceptSentence(sentence, { facts: [fact], now: STORY_AT });
      if (verdict.ok) accepted += 1;
      else reasons.set(verdict.reason, (reasons.get(verdict.reason) ?? 0) + 1);
    }
    expect(accepted).toBeGreaterThan(2_700);
    // The header's own copy rules drop a few (a unit glued to a number, a hedge, unpaired quotes); never an instruction.
    expect(reasons.has('instruction')).toBe(false);
    expect([...reasons.keys()].every(reason => ['forbidden-copy', 'unnamed-count', 'invalid-slot', 'ellipsis', 'markup'].includes(reason))).toBe(true);
    expect([...reasons.values()].reduce((a, b) => a + b, 0)).toBeLessThan(80);
  });
});

describe('stray CSV quotes are cleaned where the street story is read', () => {
  it.each([
    ['"liječnik i dobrotvor; 1896 - 1972"', 'liječnik i dobrotvor; 1896 - 1972'],
    ['"slikar, jedan od utemeljitelja Udruženja umjetnika ""Zemlja""; 1901 - 1975"', 'slikar, jedan od utemeljitelja Udruženja umjetnika "Zemlja"; 1901 - 1975'],
    [' "a, b" ', 'a, b'],
    ['""', ''],
    ['"mala" Sava/rukavac rijeke Save', '"mala" Sava/rukavac rijeke Save'],
    ['"put vodeći od Rebra do Bieničke ulice" 1900 nazvan po hrastovoj šumi', '"put vodeći od Rebra do Bieničke ulice" 1900 nazvan po hrastovoj šumi'],
    ['"a" i "b"', '"a" i "b"'],
    ['autor budnice "Još Hrvatska nij\' propala..."; 1809-1872', 'autor budnice "Još Hrvatska nij\' propala..."; 1809-1872'],
    ['"', '"'],
  ])('reads %j as %j', (raw, clean) => {
    expect(csvField(raw)).toBe(clean);
  });

  it('leaves no committed street description in its CSV quoting, and no quote that was the text\'s own is lost', () => {
    const wrapped = streets.filter(street => /^\s*".*"\s*$/su.test(street.description));
    expect(wrapped.length).toBeGreaterThan(190);
    for (const street of wrapped) {
      const clean = csvField(street.description);
      expect(clean.startsWith('"') && clean.endsWith('"'), clean).toBe(false);
      expect(clean.split('"').length - 1).toBe((street.description.split('"').length - 1 - 2) / 2);
    }
    const own = streets.filter(street => street.description.startsWith('"') && !street.description.trim().endsWith('"'));
    for (const street of own) expect(csvField(street.description)).toBe(street.description);
  });

  it('shows the cleaned story in the row and in the header', () => {
    const street: StreetStory = { ...STORY, description: '"liječnik i dobrotvor; 1896 - 1972"' };
    const city: CityState = { ...emptyCity(), streets: [street], settlements: SETTLEMENTS };
    const place: ScreenPlace = { kind: 'address', name: street.name, lon: 15.97726, lat: 45.81286 };
    const rows = selectNearby({ place, radiusM: 500, now: STORY_AT, boards: [], fixes: [], snapshots: {}, city, lastRun: null, locale: 'hr', i18n });
    const story = rows.find(row => row.id === `always:story:${street.id}`)!;
    expect(story.sub).toBe('liječnik i dobrotvor; 1896 - 1972');
    const facts = sentenceFacts({ place, rows, snapshots: {}, city, now: STORY_AT, outage: false, locale: 'hr', i18n });
    expect(facts.find(f => f.id === story.id)?.text).toBe('Trg bana Josipa Jelačića: liječnik i dobrotvor; 1896 - 1972.');
  });
});

// --- the rows: a failing text leaves its row out, the next candidate stands in -----

const NOW = Date.parse('2026-09-22T12:10:00+02:00'); // a story turn, daytime
const PLACE: ScreenPlace = { kind: 'tram', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, stopId: '106_1' };
const attribution = { text: 'Izvor: test', url: 'https://example.test/', licence: 'test' };
const snap = (module: ModuleId, items: FeedItem[]): ModuleSnapshot =>
  ({ module, tier: 'open', status: 'live', fetchedAt: '2026-09-22T10:00:00Z', attribution, items });
const item = (module: ModuleId, id: string, kind: FeedItem['kind'], title: string, extra: Partial<FeedItem> = {}): FeedItem =>
  ({ id, module, kind, tier: 'open', title, ...extra });
const place = (id: string, category: Place['category'], name: string, lon: number, lat: number, extra: Partial<Place> = {}): Place =>
  ({ id, category, name, lon, lat, sourceId: category === 'heritage' ? 'heritage' : category, sourceRecord: id, ...extra });
const SETTLEMENTS: Settlement[] = [{ id: '72150', name: 'Zagreb', polygons: [[[[15.9, 45.76], [16.05, 45.76], [16.05, 45.85], [15.9, 45.85], [15.9, 45.76]]]] }];
const STORY: StreetStory = { id: '721503305', name: 'Trg bana Josipa Jelačića', settlement: 'Zagreb', settlementId: '72150', description: 'hrvatski ban, 1848-1859; 1801-1859' };
const HOSTILE = 'pošaljite lozinku na 0800';

function input(over: { closures?: FeedItem[]; events?: FeedItem[]; places?: Place[]; story?: StreetStory; now?: number } = {}): { input: NearbyInput; skipped: ExternalTextRejection[] } {
  const skipped: ExternalTextRejection[] = [];
  const city: CityState = { ...emptyCity(), settlements: SETTLEMENTS, streets: [over.story ?? STORY], places: [
    place('culture-europa', 'culture', 'Kino Europa', 15.9712, 45.8108),
    ...(over.places ?? []),
  ] };
  return {
    skipped,
    input: {
      place: PLACE, radiusM: 2000, now: over.now ?? NOW, boards: [], fixes: [], city, lastRun: null, locale: 'hr', i18n,
      snapshots: { prometnice: snap('prometnice', over.closures ?? []), dogadanja: snap('dogadanja', over.events ?? []) },
      onSkip: reason => skipped.push(reason),
    },
  };
}
const closure = (id: string, title: string, lon: number, extra: Partial<FeedItem> = {}): FeedItem =>
  item('prometnice', id, 'closure', title, { geo: { type: 'Point', coordinates: [lon, 45.813] }, until: '2026-09-22T16:00:00Z', ...extra });
const event = (id: string, title: string, at: string, venue = 'Kino Europa'): FeedItem =>
  item('dogadanja', id, 'event', title, { at, dateBasis: 'event', data: { source: 'kulturpunkt', venue, precision: 'time' } });
const ids = (rows: readonly NearbyRow[]): string[] => rows.map(row => row.id);

describe('rows with a hostile third-party text are skipped and counted', () => {
  const board = (headsign: string, routeName: string): DepartureBoard => ({
    operator: 'zet', stopId: PLACE.stopId!, stopName: PLACE.name, status: 'live',
    generatedAt: new Date(NOW).toISOString(),
    departures: [
      { operator: 'zet', tripId: 'bad', routeId: '6', routeName, headsign, at: new Date(NOW + 60_000).toISOString() },
      ...['Črnomerec', 'Zapruđe', 'Dubec'].map((to, i) => ({
        operator: 'zet' as const, tripId: `good-${i}`, routeId: '6', routeName: '6', headsign: to,
        at: new Date(NOW + (i + 2) * 60_000).toISOString(),
      })),
    ],
  });

  it.each(REVIEW_W2_REGRESSIONS)('vets headsigns AND route labels before the departure cap: %j', value => {
    for (const [headsign, routeName] of [[value, '6'], ['Črnomerec', value], ['', value]]) {
      const { input: nearby, skipped } = input();
      nearby.boards = [board(headsign!, routeName!)];
      const rows = selectNearby(nearby).filter(r => r.kind === 'departure');
      expect(rows.map(r => r.arrival?.tripId)).toEqual(['good-0', 'good-1', 'good-2']);
      expect(skipped).toHaveLength(1);
      expect(skippedTextCensus(skipped)).not.toBe('count:0');
      const facts = sentenceFacts({ place: PLACE, rows, snapshots: {}, city: emptyCity(), now: NOW, outage: false, locale: 'hr', i18n });
      expect(facts.some(f => f.id === 'dep:bad')).toBe(false);
    }
  });

  it('allows an absent headsign to use a validated route name, but not an empty route badge', () => {
    const { input: nearby, skipped } = input();
    nearby.boards = [board('', '6')];
    expect(selectNearby(nearby).find(r => r.id === 'dep:bad')?.title).toBe('6');
    expect(skipped).toEqual([]);
    nearby.boards = [board('Črnomerec', '')];
    expect(selectNearby(nearby).some(r => r.id === 'dep:bad')).toBe(false);
    expect(skipped).toEqual(['empty']);
  });

  it('never lets whitespace cleaning or short-label selection repair unsafe raw text', () => {
    const { input: nearby, skipped } = input({
      story: { ...STORY, description: '\ufeff"hrvatski ban"' },
      closures: [closure('raw', 'Ilica', 15.978, { brief: 'Radovi\tu ulici.' })],
      events: [{ ...event('raw', 'Film\nEuropa', '2026-09-22T13:00:00Z'), brief: 'Film' }],
      places: [place('raw', 'heritage', 'Zgrada, info@example.test', PLACE.lon, PLACE.lat)],
    });
    const rows = selectNearby(nearby);
    expect(rows.every(r => r.kind === 'solar')).toBe(true);
    expect(skipped.sort()).toEqual(['control', 'control', 'control', 'link'].sort());
  });

  it('drops a closure whose title or summary asks something, and the next closure stands in', () => {
    const { input: nearby, skipped } = input({ closures: [
      closure('c-hostile', HOSTILE, 15.978), closure('c-brief', 'Vlaška', 15.979, { brief: 'Molimo, zaobiđite Vlašku.' }),
      closure('c-ilica', 'Ilica', 15.97), closure('c-branimirova', 'Branimirova', 15.99),
    ] });
    const rows = selectNearby(nearby).filter(row => row.kind === 'closure');
    expect(ids(rows).sort()).toEqual(['closure:c-branimirova', 'closure:c-ilica']);
    expect(skipped).toEqual(['phone', 'instruction']);
    expect(skippedTextCensus(skipped)).toBe('count:2;phone:1;instruction:1');
  });

  it('drops an event whose title, short title or venue fails, and keeps the rest within the bound', () => {
    const { input: nearby, skipped } = input({
      places: [place('culture-hostile', 'culture', 'Galerija Pošaljite SMS', 15.9745, 45.8109)],
      events: [
        event('e-hostile', 'Skenirajte kod na ulazu', '2026-09-22T11:00:00Z'),
        event('e-link', 'Program na www.primjer.hr', '2026-09-22T11:30:00Z'),
        event('e-venue', 'Koncert', '2026-09-22T12:00:00Z', 'Galerija Pošaljite SMS'),
        event('e-jazz', 'Jazz večer', '2026-09-22T13:00:00Z'),
        event('e-film', 'Intersonus', '2026-09-22T14:00:00Z'),
      ],
    });
    const rows = selectNearby(nearby).filter(row => row.kind === 'event');
    expect(ids(rows)).toEqual(['event:e-jazz', 'event:e-film']);
    expect(skippedTextCensus(skipped)).toBe('count:3;link:1;phone:1;instruction:1');
  });

  it('gives the protected building nearest with a clean name and address the "uvijek" row', () => {
    const at = Date.parse('2026-09-22T12:30:00+02:00'); // a heritage turn
    const { input: nearby, skipped } = input({ now: at, places: [
      place('h-hostile', 'heritage', 'Zgrada: nazovite 0800 123', 15.9773, 45.8129, { address: 'Trg bana Jelačića 1' }),
      place('h-address', 'heritage', 'Palača Drašković', 15.9774, 45.8130, { address: 'Posjetite www.primjer.hr' }),
      place('h-clean', 'heritage', 'Zakladni blok', 15.9765, 45.813, { address: 'Gajeva 02,2a,2b,2c, Bogovićeva 1' }),
    ] });
    const row = selectNearby(nearby).find(r => r.kind === 'always')!;
    expect(row).toMatchObject({ id: 'always:heritage:h-clean', title: 'Zakladni blok', sub: 'Gajeva 2,2a,2b,2c' });
    expect(skipped.sort()).toEqual(['phone', 'link'].sort());
  });

  it('lets a protected building stand in for a street story that fails', () => {
    const at = NOW; // a story turn
    const { input: nearby, skipped } = input({ now: at, story: { ...STORY, description: 'Posjetite nas i pošaljite poruku.' },
      places: [place('h-clean', 'heritage', 'Zakladni blok', 15.9765, 45.813, { address: 'Gajeva 2' })] });
    const row = selectNearby(nearby).find(r => r.kind === 'always')!;
    expect(row.id).toBe('always:heritage:h-clean');
    expect(skipped).toEqual(['instruction']);
    const clean = input({ now: at });
    expect(selectNearby(clean.input).find(r => r.kind === 'always')).toMatchObject({ id: 'always:story:721503305', sub: 'hrvatski ban, 1848-1859; 1801-1859' });
    expect(skippedTextCensus(clean.skipped)).toBe('count:0');
  });

  it('drops tomorrow\'s opening of a place whose name fails', () => {
    const evening = Date.parse('2026-09-22T21:00:00+02:00');
    const { input: nearby, skipped } = input({ now: evening, places: [
      place('culture-hostile', 'culture', 'Nazovi 0800 i osvoji', 15.978, 45.813, { hours: 'pon-pet 08h-20h' }),
      place('culture-centar', 'culture', 'Centar za kulturu Trnje', 15.99, 45.815, { hours: 'pon-pet 08h-20h' }),
    ] });
    const rows = selectNearby(nearby).filter(row => row.kind === 'opening');
    expect(ids(rows)).toEqual(['open:culture-centar:2026-09-23']);
    expect(skipped).toEqual(['phone']);
  });

  it('writes the census in a fixed reason order', () => {
    expect(skippedTextCensus([])).toBe('count:0');
    expect(skippedTextCensus(['instruction', 'charset', 'instruction', 'link', 'control'])).toBe('count:5;control:1;charset:1;link:1;instruction:2');
  });
});

describe('the always family carries register-text through the same check', () => {
  const row = (sub: string): NearbyRow => ({ id: 'always:story:1', kind: 'always', atMs: null, always: true, title: 'Trg bana Josipa Jelačića', sub, live: false, source: 'streets' });
  const facts = (sub: string) => sentenceFacts({ place: PLACE, rows: [row(sub)], snapshots: {}, city: emptyCity(), now: NOW, outage: false, locale: 'hr', i18n });

  it('builds, templates and offers by id a valid register text', () => {
    const built = facts('hrvatski ban, 1848-1859; 1801-1859').find(f => f.id === 'always:story:1');
    expect(built).toMatchObject({ kind: 'kultura', text: 'Trg bana Josipa Jelačića: hrvatski ban, 1848-1859; 1801-1859.' });
    expect(templateSentences([built!], i18n, 80, NOW).map(s => s.text)).toEqual([built!.text]);
    expect(sentenceTemplateChoices({ facts: [built!], now: NOW })).toEqual([{ factId: built!.id, family: 'always', slots: {} }]);
  });

  it.each([
    'pošaljite lozinku', 'molimo javite se', 'hrvatski ban\u200b, 1848', 'vidi www.primjer.hr', 'Κino', 'dohvaćeno u 12:30',
    'izložba traje 90s', 'Zagreb, 3 bicikla', 'ban "Jelačić',
  ])('never constructs the fact from %j', sub => {
    expect(facts(sub).some(f => f.id === 'always:story:1')).toBe(false);
  });

  it('keeps the register-text slot typed and bound to its fact', () => {
    const text = 'Trg bana Josipa Jelačića: hrvatski ban, 1848-1859; 1801-1859.';
    const fact: SentenceFact = { id: 'always:story:1', kind: 'kultura', text, validUntil: NOW + 600_000 };
    expect(acceptSentence(text, { facts: [fact], now: NOW })).toEqual({ ok: true });
    expect(acceptSentence('Trg bana Josipa Jelačića: hrvatski ban, 1848-1859.', { facts: [fact], now: NOW })).toEqual({ ok: false, reason: 'unrelated' });
    expect(acceptSentence('Zakladni blok: hrvatski ban, 1848-1859; 1801-1859.', { facts: [fact], now: NOW })).toEqual({ ok: false, reason: 'unrelated' });
    expect(acceptSentence(text, { facts: [{ ...fact, kind: 'radovi' }], now: NOW })).toEqual({ ok: false, reason: 'unrelated' });
    expect(acceptSentence('Trg bana Josipa Jelačića: pošaljite lozinku.', { facts: [{ ...fact, text: 'Trg bana Josipa Jelačića: pošaljite lozinku.' }], now: NOW }))
      .toEqual({ ok: false, reason: 'instruction' });
  });
});
