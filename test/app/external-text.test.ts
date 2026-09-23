// Decision 21: shared structural layers, strict headers and contextual rows.
// Rejection omits only that surface. data-skipped-text counts omitted rows.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ScreenPlace } from '../../shared/city/place';
import { emptyCity, type CatalogueChunk, type CatalogueManifest, type CityState, type DepartureBoard, type Place, type Settlement, type StreetStory } from '../../shared/city/types';
import {
  externalText, externalTextVector, readerRequestRule, sensitiveTextPair,
  EXTERNAL_TEXT_RULES, INSTRUCTION_HOMOGRAPHS, SENTENCE_INSTRUCTION_PATTERNS,
  type ExternalTextKind, type ExternalTextRejection,
} from '../../shared/kiosk/external-text';
import { EXTERNAL_HEADER_LEXICON, EXTERNAL_SENSITIVE_LEXICON } from '../../shared/kiosk/external-text-policy';
import { CONTEXT_PAIR_REGRESSIONS, REVIEW_W2_REGRESSIONS, W_C2_ATTACKS } from '../fixtures/external-text-attacks';
import { SAMPLED_CLOSURE_TITLES, SAMPLED_EVENT_TITLES } from '../fixtures/external-text-corpus';
import { HERITAGE_ROW_RESIDUALS, STREET_ROW_RESIDUALS, TITLE_ROW_RESIDUALS, type RowTextResidual } from '../fixtures/external-text-residuals';
import { acceptSentence, sentenceTemplateChoices, type SentenceFact } from '../../shared/kiosk/sentence';
import { csvField, firstSentence, selectNearby, skippedTextCensus, type NearbyInput, type NearbyRow } from '../../app/src/city/nearby';
import { sentenceFacts, templateSentences } from '../../app/src/city/sentence';
import type { FeedItem, ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';

const i18n = createDefaultI18n('hr');
const KINDS = Object.keys(EXTERNAL_TEXT_RULES) as ExternalTextKind[];
const variants = (text: string): string[] => [text, text.toLocaleUpperCase('hr'), text.normalize('NFD'), text[0]!.toLocaleUpperCase('hr') + text.slice(1)];
const rowText = (kind: ExternalTextKind, value: string) => externalText(kind, value, { surface: 'row' });
const headerText = (kind: ExternalTextKind, value: string) => externalText(kind, value, { surface: 'header' });
function refusal(kind: ExternalTextKind, value: string) {
  const verdict = rowText(kind, value);
  if (verdict.ok) return [];
  const pair = verdict.reason === 'instruction' ? sensitiveTextPair(value) : null;
  return [{ kind, value, reason: verdict.reason,
    cause: pair ? { rule: pair.rule, left: pair.left.value, right: pair.right.value } : externalTextVector(value)?.value ?? null }];
}
const sortedResiduals = (rows: readonly RowTextResidual[]) =>
  [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));

describe('the reader-request signal (not a standalone rejection)', () => {
  it.each(SENTENCE_INSTRUCTION_PATTERNS)('$id catches its examples and lets its register and feed texts through', rule => {
    for (const example of rule.examples) for (const value of variants(example)) {
      expect(readerRequestRule(value), `${rule.id}: ${value}`).not.toBeNull();
    }
    for (const text of rule.passes) for (const value of [text, text.normalize('NFD')]) {
      expect(readerRequestRule(value), `${rule.id}: ${value}`).toBeNull();
    }
  });

  it.each(INSTRUCTION_HOMOGRAPHS)('reads the homograph %s as a noun or third person, but never its plural or second person', word => {
    expect(readerRequestRule(word)).toBeNull();
    expect(readerRequestRule(`Zbirka ${word} ime.`)).toBeNull();
    const stem = word.slice(0, -1);
    expect(readerRequestRule(`${stem}ite`), `${stem}ite`).not.toBeNull();
    expect(readerRequestRule(`${stem}imo`), `${stem}imo`).not.toBeNull();
    expect(readerRequestRule(`ako ${stem}iš`), `${stem}iš`).not.toBeNull();
  });

  it('reads a capitalised singular inside a clause as a name, and a command where a clause opens', () => {
    for (const name of ['naselje na Kupi', 'potoku Ivanovoj Reci', 'dvorac obitelji Ratkaj', 'uz rijeku Kupi i Savu']) {
      expect(readerRequestRule(name), name).toBeNull();
    }
    for (const command of ['Kupi kartu', 'kupi kartu', 'KUPI KARTU', 'Muzej: Kupi kartu', 'Muzej. Javi broj.', 'projekta „Javi se“',
      'Festival (Pošalji pjesmu)', 'Muzej – Reci lozinku', 'Muzej - Reci lozinku', 'Muzej; Nazovi broj', 'Muzej kupi kartu']) {
      expect(readerRequestRule(command), command).not.toBeNull();
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
    expect(rowText('title', title)).toEqual({ ok: true });
  });
  it.each([
    'Linija 3 ne koristi stajalište „Tehnički muzej“',
    'Kino na travi donosi besplatne filmske večeri u sedam novozagrebačkih kvartova',
    'Završena isporuka prvih 20 novih tramvaja, potpisani ugovori za nabavu dodatnih 20 tramvaja i 62 električna autobusa',
    'Sa zida na zid – od vezenih do virtualno dijeljenih vrijednosti',
    'Festival stripa i street arta OHOHO!',
    'Zoom + Igralke Festival: Nepokorena tijela',
  ])('keeps the sampled feed title %s', title => {
    expect(rowText('title', title)).toEqual({ ok: true });
  });
});

describe('decision 21 strict header surface', () => {
  it.each(W_C2_ATTACKS)('refuses the W-C2 header value %j in every kind, alone and after a name', attack => {
    for (const kind of KINDS) for (const value of [...variants(attack), `Muzej: ${attack}`, `Kino Europa, ${attack}`]) {
      expect(headerText(kind, value).ok, `${kind}: ${JSON.stringify(value)}`).toBe(false);
    }
  });

  it('pins all 50 W-C2 verdicts per surface, including the 16 unpaired row values', () => {
    expect(W_C2_ATTACKS).toHaveLength(50);
    expect(W_C2_ATTACKS.filter(value => !headerText('title', value).ok)).toHaveLength(50);
    expect(W_C2_ATTACKS.filter(value => rowText('title', value).ok)).toEqual([
      'molimo broj', 'pro.sli.jedi lozinku', 'p r o s l i j e d i', 'click here', 'call now',
      'please reply', 'could you reply', 'učini uslugu', 'dođi ovamo', 'moras poslati broj',
      "pro'slijedi", 'pro’slijedi', 'pro&slijedi', 'pro+slijedi', 'proslıjedi', 'prosłijedi',
    ]);
  });

  it.each(EXTERNAL_HEADER_LEXICON)('rejects single header hits in the full $id lexicon', rule => {
    for (const text of rule.examples) for (const value of variants(text)) for (const kind of KINDS) {
      expect(headerText(kind, value).ok, `${rule.id}/${kind}: ${value}`).toBe(false);
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
    expect(rowText(kind, value)).toEqual({ ok: true });
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
    expect(headerText(kind, value)).toEqual({ ok: false, reason });
  });
});

describe('decision 20 layered policy', () => {
  it('pins the provenance and size of the 21-case regression set', () => {
    expect(REVIEW_W2_REGRESSIONS).toHaveLength(21);
    expect(REVIEW_W2_REGRESSIONS.slice(0, 4)).toEqual([
      'Muzej: koristi lozinku.', 'biste li poslali lozinku?', 'otvaraš poveznicu.', 'dial 0800 123.',
    ]);
  });

  it.each(REVIEW_W2_REGRESSIONS)('rejects historical header probe %j in every kind and spelling variant', attack => {
    for (const kind of KINDS) for (const value of variants(attack)) {
      expect(headerText(kind, value).ok, `${kind}: ${value}`).toBe(false);
    }
  });

  it('pins 21/21 historical header refusals and the one unpaired row value', () => {
    expect(REVIEW_W2_REGRESSIONS.filter(value => !headerText('title', value).ok)).toHaveLength(21);
    expect(REVIEW_W2_REGRESSIONS.filter(value => rowText('title', value).ok)).toEqual(['javili ste se']);
  });

  it.each(EXTERNAL_SENSITIVE_LEXICON)('pairs every $id datum without rejecting a lone hit', rule => {
    for (const text of rule.examples) for (const value of variants(text)) for (const kind of KINDS) {
      expect(rowText(kind, value), `${rule.id}/${kind}: ${value}`).toEqual({ ok: true });
      const partner = rule.role === 'noun' ? 'unesi' : rule.role === 'action' ? 'lozinku' : 'broj';
      expect(rowText(kind, `${value} ${partner}`).ok, `${rule.id}/${kind}: ${value} ${partner}`).toBe(false);
    }
  });

  it.each([
    ['lozinka', 'unesi'], ['sifra', 'posalji'], ['password', 'send'], ['passcode', 'enter'], ['token', 'share'],
    ['posalji', 'kod'], ['proslijedi', 'lozinku'], ['unesite', 'PIN'], ['upisite', 'passcode'],
    ['nazovite', 'broj'], ['pozovite', 'broj'], ['poveznica', 'otvori'], ['klikni', 'link'],
    ['skeniraj', 'kod'], ['download', 'app'], ['forwarded', 'password'], ['installing', 'app'],
  ])('cannot disguise the pair %s + %s within a sentence', (word, partner) => {
      for (const separator of [' ', '-', '/', ':', "'", '’', '&', '+']) {
        const value = `${[...word].join(separator)} ${partner}`;
        for (const kind of KINDS) expect(rowText(kind, value).ok, `${kind}: ${value}`).toBe(false);
      }
      const leet = word.replace(/a/g, '4').replace(/e/g, '3').replace(/o/g, '0').replace(/i/g, '1');
      for (const kind of KINDS) expect(rowText(kind, `${leet} ${partner}`).ok, `${kind}: ${leet}`).toBe(false);
    });

  it.each(CONTEXT_PAIR_REGRESSIONS)('rejects the explicit contextual regression %j in every kind', value => {
    for (const kind of KINDS) for (const variant of variants(value)) {
      expect(rowText(kind, variant).ok, `${kind}: ${variant}`).toBe(false);
    }
  });

  it.each([
    'kod crkve sv. Marka', 'otvoren 1880.', 'ulaz slobodan', 'plaćanje karticom',
    'payment by card', 'Ljeto kod Bartola', 'Daj prijedlog za bolji kvart',
    'proslijedi', 'javili ste se', 'PIN', 'OTP', 'P4SSW0RD', 'k0d', 'pošaljite pjesmu',
  ])('keeps the unpaired value %j', value => {
    for (const kind of ['title', 'summary', 'register-text'] as const) for (const variant of variants(value)) {
      expect(rowText(kind, variant), `${kind}: ${variant}`).toEqual({ ok: true });
    }
  });

  it.each(['.', '!', '?', ';', '\n', '\r\n', '\u2028', '\u2029'])('never joins a pair across %j', separator => {
    for (const [left, right] of [['pošalji', 'lozinku'], ['kod', '1234'], ['javi', 'broj'], ['molimo', 'AB12']]) {
      const value = `${left}${separator}${right}`;
      expect(sensitiveTextPair(value), value).toBeNull();
      // Newlines remain independently refused by layer 1.
      expect(rowText('register-text', value)).toEqual(
        /[\r\n\u2028\u2029]/u.test(separator) ? { ok: false, reason: 'control' } : { ok: true });
    }
  });

  it('records the exact disjoint pair and does not combine fields or calls', () => {
    expect(sensitiveTextPair('kod: AB12')).toMatchObject({
      rule: 'noun-token', left: { value: 'kod' }, right: { list: 'uppercase-token', value: 'AB12' },
    });
    expect(sensitiveTextPair('AB12 je kod')).toMatchObject({ rule: 'noun-token' });
    expect(sensitiveTextPair('nazovi Ilica 2')).toMatchObject({ rule: 'contact-target' });
    expect(sensitiveTextPair('kod: ab12')).toBeNull();
    expect(sensitiveTextPair('pošalji')).toBeNull();
    expect(sensitiveTextPair('lozinku')).toBeNull();
    expect(sensitiveTextPair('p4ssw0rd')).toBeNull();
    expect(sensitiveTextPair('pro.sli.jedi lozinku')).toBeNull();
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
    for (const kind of KINDS) expect(rowText(kind, value), kind).toEqual({ ok: false, reason });
  });

  it.each(['Molimo, pričekajte.', 'Biste li učinili uslugu?', 'Možete li pričekati?', 'Please wait.', 'Could you help?'])(
    'never rejects the unpaired reader-action request %j', text => {
      expect(rowText('summary', text)).toEqual({ ok: true });
      expect(rowText('register-text', text)).toEqual({ ok: true });
      expect(rowText('title', text)).toEqual({ ok: true });
    });

  it('uses the reader signal only as a prose amplifier within a sentence', () => {
    for (const kind of ['summary', 'register-text'] as const) {
      expect(rowText(kind, 'Molimo AB12')).toEqual({ ok: false, reason: 'instruction' });
      expect(rowText(kind, 'Please 1234')).toEqual({ ok: false, reason: 'instruction' });
      expect(rowText(kind, 'Molimo. AB12')).toEqual({ ok: true });
    }
    expect(rowText('title', 'Molimo AB12')).toEqual({ ok: true });
    expect(rowText('title', 'Please 1234')).toEqual({ ok: true });
  });
  it('enforces each kind boundary without returning any repaired text', () => {
    for (const kind of KINDS) {
      expect(rowText(kind, 'Ć'.repeat(EXTERNAL_TEXT_RULES[kind].max))).toEqual({ ok: true });
      expect(rowText(kind, 'Ć'.repeat(EXTERNAL_TEXT_RULES[kind].max + 1))).toEqual({ ok: false, reason: 'too-long' });
      expect(rowText(kind, '')).toEqual({ ok: false, reason: 'empty' });
      for (const ch of ['\u200b', '\u200d', '\u2060', '\u202e', '\u00ad', '\u034f', '\ufe0f', '\n', '\t']) {
        expect(rowText(kind, `Kino${ch}Europa`), `${kind}/${JSON.stringify(ch)}`).toEqual({ ok: false, reason: 'control' });
      }
    }
    for (const value of ['Kino!', 'Kino:', 'Kino (Jug)', 'Kino&Jug', 'Kino\u00a0Jug', 'Kino+Jug', 'Kino/Jug']) {
      expect(rowText('headsign', value), value).toEqual({ ok: false, reason: 'charset' });
    }
    expect(rowText('headsign', "Črnomerec – Z. kolodvor, 1'")).toEqual({ ok: true });
  });
});

describe('decision 21 surface isolation', () => {
  it.each(['Vidimo se u Svetoj Klari!', 'Daj prijedlog', 'PIN', 'javili ste se', 'molimo javite se'])(
    'rejects %j only in the header, regardless of cache order', value => {
      for (const surface of ['row', 'header', 'row', 'header'] as const) {
        expect(externalText('title', value, { surface })).toEqual(
          surface === 'header' ? { ok: false, reason: 'instruction' } : { ok: true });
      }
      for (const surface of ['header', 'row', 'header', 'row'] as const) {
        expect(externalText('register-text', value, { surface })).toEqual(
          surface === 'header' ? { ok: false, reason: 'instruction' } : { ok: true });
      }
    });

  it.each(CONTEXT_PAIR_REGRESSIONS)('rejects phishing pair %j on both surfaces in every kind', value => {
    for (const kind of KINDS) for (const surface of ['header', 'row'] as const) {
      expect(externalText(kind, value, { surface }).ok, `${kind}/${surface}`).toBe(false);
    }
  });

  it('rejects reader-addressed commands in every header kind, not only prose', () => {
    for (const value of ['Vidimo se', 'Daj prijedlog', 'Molimo pričekajte', 'Please wait', 'učini uslugu',
      'Kino Kupi kartu', 'Kino Slijedi predstavu', 'D4j prijedlog']) {
      for (const kind of KINDS) {
        expect(headerText(kind, value)).toEqual({ ok: false, reason: 'instruction' });
        expect(rowText(kind, value)).toEqual({ ok: true });
      }
    }
  });

  it.each(INSTRUCTION_HOMOGRAPHS)('does not apply the row signal homograph exemption to header %s', value => {
    for (const variant of variants(value)) {
      expect(headerText('title', variant)).toEqual({ ok: false, reason: 'instruction' });
      expect(rowText('title', variant)).toEqual({ ok: true });
    }
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
  it('keeps every sampled event title except the pinned row exclusions, including their exact causes', () => {
    expect(SAMPLED_EVENT_TITLES).toHaveLength(150);
    const refused = SAMPLED_EVENT_TITLES.flatMap(value => refusal('title', value));
    expect(sortedResiduals(refused)).toEqual(sortedResiduals(TITLE_ROW_RESIDUALS));
  });

  it('keeps all 36 sampled closure names', () => {
    expect(SAMPLED_CLOSURE_TITLES).toHaveLength(36);
    for (const title of SAMPLED_CLOSURE_TITLES) expect(rowText('name', title), title).toEqual({ ok: true });
  });

  it('keeps every committed GTFS headsign and route short name', () => {
    const dir = join(CITY_DIR, '..');
    const { headsigns } = JSON.parse(readFileSync(join(dir, 'zet-trips.json'), 'utf8')) as { headsigns: string[] };
    const { routes } = JSON.parse(readFileSync(join(dir, 'zet-network.json'), 'utf8')) as { routes: { short: string[] } };
    expect(headsigns).toHaveLength(153);
    expect(routes.short).toHaveLength(154);
    for (const value of [...headsigns, ...routes.short]) expect(rowText('headsign', value), value).toEqual({ ok: true });
  });
});

describe('the committed registers under decision 21', () => {
  it('pins every raw/presented street and heritage exclusion, with exact pair/vector and row impact', () => {
    const rawStreet: RowTextResidual[] = [];
    const presentedStreet: RowTextResidual[] = [];
    const refusedHeritage: RowTextResidual[] = [];
    for (const street of streets) {
      const text = firstSentence(csvField(street.description));
      // Inspect raw fields as well as presentation text. A shortening/CSV
      // transformation must not hide a rejected suffix from this corpus test.
      rawStreet.push(...refusal('name', street.name), ...refusal('register-text', street.description));
      presentedStreet.push(...refusal('name', csvField(street.name)), ...refusal('register-text', text));
    }
    let heritageFields = 0;
    for (const place of heritage) {
      refusedHeritage.push(...refusal('name', place.name));
      heritageFields += 1;
      if (place.address) {
        refusedHeritage.push(...refusal('address', place.address));
        heritageFields += 1;
      }
    }
    // Each building through the row builder itself, as the wall builds its "uvijek" row.
    const city: CityState = { ...emptyCity(), places: heritage };
    const missingRows: string[] = [];
    const located = heritage.filter(place => typeof place.lon === 'number' && typeof place.lat === 'number');
    for (const place of heritage) {
      if (typeof place.lon !== 'number' || typeof place.lat !== 'number') continue;
      const out = selectNearby({ place: { kind: 'address', name: place.name, lon: place.lon, lat: place.lat }, radiusM: 0.001,
        now: HERITAGE_AT, boards: [], fixes: [], snapshots: {}, city, lastRun: null, locale: 'hr', i18n });
      if (!out.some(row => row.id.startsWith('always:heritage:'))) missingRows.push(place.name);
    }
    expect(streets).toHaveLength(3_795);
    expect(heritage).toHaveLength(763);
    expect(heritageFields).toBe(1_310);
    expect(located).toHaveLength(165);
    expect(sortedResiduals(rawStreet)).toEqual(sortedResiduals(STREET_ROW_RESIDUALS));
    expect(sortedResiduals(presentedStreet)).toEqual(sortedResiduals(STREET_ROW_RESIDUALS));
    expect(sortedResiduals(refusedHeritage)).toEqual(sortedResiduals(HERITAGE_ROW_RESIDUALS));
    expect(missingRows.sort()).toEqual([
      'Kuće Hrvatske banke za promet nekretninama, Prilaz Gjure Deželića 42, 44, 46,',
      'Ansambl gradskih vila u Novakovoj ulici',
      'Zgrada Osnovne škole "August Šenoa", Selska cesta 95-95/1-95/2',
      'Kompleks zgrada "Hrvatskog Sokola" i "Kola", Trg maršala Tita 5, 6, 6a, 7',
    ].sort());
  });

  it('applies strict header checks to all fitting register sentences, independently of row eligibility', () => {
    const reasons = new Map<string, number>();
    let strictRefusals = 0;
    let checked = 0;
    let accepted = 0;
    for (const street of streets) {
      const description = firstSentence(csvField(street.description));
      const text = `${street.name}: ${description}`;
      const sentence = /[.!?]$/u.test(text) ? text : `${text}.`;
      if ([...sentence].length > 80) continue;
      checked += 1;
      const strict = headerText('name', street.name).ok && headerText('register-text', description).ok;
      if (!strict) strictRefusals += 1;
      const fact: SentenceFact = { id: `always:story:${street.id}`, kind: 'kultura', text: sentence, validUntil: STORY_AT + 600_000 };
      const verdict = acceptSentence(sentence, { facts: [fact], now: STORY_AT });
      // Every strict slot refusal must omit the header, even for a passing row.
      if (!strict) expect(verdict.ok, sentence).toBe(false);
      if (verdict.ok) accepted += 1;
      else reasons.set(verdict.reason, (reasons.get(verdict.reason) ?? 0) + 1);
    }
    expect(checked).toBe(3_072);
    expect({ accepted, strictRefusals, reasons: Object.fromEntries(reasons) }).toEqual({
      accepted: 2_703, strictRefusals: 368,
      reasons: { instruction: 358, 'invalid-slot': 10, 'forbidden-copy': 1 },
    });
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

  it.each([...REVIEW_W2_REGRESSIONS, ...CONTEXT_PAIR_REGRESSIONS])('vets row headsigns AND route labels before the departure cap: %j', value => {
    for (const [headsign, routeName] of [[value, '6'], ['Črnomerec', value], ['', value]]) {
      const { input: nearby, skipped } = input();
      nearby.boards = [board(headsign!, routeName!)];
      const rows = selectNearby(nearby).filter(r => r.kind === 'departure');
      const unpaired = value === 'javili ste se';
      expect(rows.map(r => r.arrival?.tripId)).toEqual(unpaired ? ['bad', 'good-0', 'good-1'] : ['good-0', 'good-1', 'good-2']);
      expect(skipped).toHaveLength(unpaired ? 0 : 1);
      expect(skippedTextCensus(skipped) === 'count:0').toBe(unpaired);
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

  it.each([
    ['Molimo, zaobiđite Vlašku.', false],
    ['Molimo, pošaljite lozinku.', true],
  ] as const)('keeps an unpaired closure request but drops a paired summary: %s', (brief, paired) => {
    const { input: nearby, skipped } = input({ closures: [
      closure('c-hostile', HOSTILE, 15.978), closure('c-brief', 'Vlaška', 15.979, { brief }),
      closure('c-ilica', 'Ilica', 15.97), closure('c-branimirova', 'Branimirova', 15.99),
    ] });
    const rows = selectNearby(nearby).filter(row => row.kind === 'closure');
    expect(ids(rows).sort()).toEqual(paired ? ['closure:c-branimirova', 'closure:c-ilica'] : ['closure:c-brief', 'closure:c-ilica']);
    expect(skipped).toEqual(paired ? ['phone', 'instruction'] : ['phone']);
    expect(skippedTextCensus(skipped)).toBe(paired ? 'count:2;phone:1;instruction:1' : 'count:1;phone:1');
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

  it.each([
    ['Posjetite nas i pošaljite poruku.', false],
    ['Posjetite nas i pošaljite lozinku.', true],
  ] as const)('keeps an unpaired story request and uses heritage when a pair fails: %s', (description, paired) => {
    const at = NOW; // a story turn
    const { input: nearby, skipped } = input({ now: at, story: { ...STORY, description },
      places: [place('h-clean', 'heritage', 'Zakladni blok', 15.9765, 45.813, { address: 'Gajeva 2' })] });
    const row = selectNearby(nearby).find(r => r.kind === 'always')!;
    expect(row.id).toBe(paired ? 'always:heritage:h-clean' : `always:story:${STORY.id}`);
    expect(skipped).toEqual(paired ? ['instruction'] : []);
    const facts = sentenceFacts({ place: PLACE, rows: [row], snapshots: {}, city: nearby.city, now: at, outage: false, locale: 'hr', i18n });
    expect(facts.some(f => f.id === `always:story:${STORY.id}`)).toBe(false);
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

  it.each([
    ['Vidimo se u Svetoj Klari!', false],
    ['pošalji lozinku', true],
  ] as const)('keeps row-eligible %j as an item without authorising a header fact', (text, paired) => {
    const { input: nearby, skipped } = input({
      events: [event('surface', text, '2026-09-22T13:00:00Z')],
      story: { ...STORY, description: text },
    });
    const rows = selectNearby(nearby);
    expect(rows.some(row => row.id === 'event:surface')).toBe(!paired);
    expect(rows.some(row => row.id === `always:story:${STORY.id}`)).toBe(!paired);
    if (!paired) {
      expect(rows.find(row => row.id === 'event:surface')?.title).toBe(text);
      expect(rows.find(row => row.id === `always:story:${STORY.id}`)?.sub).toBe(text);
    }
    const facts = sentenceFacts({ place: PLACE, rows, snapshots: {}, city: nearby.city, now: NOW, outage: false, locale: 'hr', i18n });
    expect(facts.some(fact => fact.id === 'event:surface' || fact.id === `always:story:${STORY.id}`)).toBe(false);
    expect(templateSentences(facts, i18n, 80, NOW)).toHaveLength(3);
    expect(skippedTextCensus(skipped)).toBe(paired ? 'count:2;instruction:2' : 'count:0');
    // Header omission must not mutate the already selected row pool or census.
    expect(rows.some(row => row.id === 'event:surface')).toBe(!paired);
  });

  it('keeps imperative closure names, venues and opening names in rows but not sentence slots', () => {
    const { input: nearby, skipped } = input({
      closures: [closure('surface', 'Daj prijedlog', 15.978)],
      events: [event('surface', 'Film', '2026-09-22T13:00:00Z', 'Javi se')],
      places: [place('culture-request', 'culture', 'Javi se', PLACE.lon, PLACE.lat, { hours: 'pon-pet 08h-20h' })],
    });
    const rows = selectNearby(nearby);
    expect(rows.find(row => row.id === 'closure:surface')?.title).toBe('Daj prijedlog');
    expect(rows.find(row => row.id === 'event:surface')?.sub).toBe('Javi se');
    const build = (rows: NearbyRow[]) => sentenceFacts({
      place: PLACE, rows, snapshots: {}, city: nearby.city, now: nearby.now, outage: false, locale: 'hr', i18n,
    });
    expect(build(rows).some(fact => ['closure:surface', 'event:surface'].includes(fact.id))).toBe(false);
    nearby.now = Date.parse('2026-09-22T21:00:00+02:00');
    const evening = selectNearby(nearby);
    expect(evening.some(row => row.id === 'open:culture-request:2026-09-23')).toBe(true);
    expect(build(evening).some(fact => fact.id === 'open:culture-request:2026-09-23')).toBe(false);
    expect(skipped).toEqual([]);
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
