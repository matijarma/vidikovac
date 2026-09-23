import { describe, expect, it } from 'vitest';
import { externalText, vetExternal } from '../../shared/kiosk/external-text';
import { REVIEW_W2_REGRESSIONS, W_C2_ATTACKS } from '../fixtures/external-text-attacks';

// Independent paradigms: do not import regex sources or generate only forms
// that the implementation says it knows. Columns are imperative, present,
// infinitive and past/conditional. Auxiliaries do not determine row safety.
const LANGUAGES = {
  hr: {
    verbs: [
      ['pošalji', 'šaljete', 'poslati', 'poslali bismo'],
      ['otkrij', 'otkrivamo', 'otkriti', 'otkrili ste'],
      ['unesi', 'unosite', 'unijeti', 'unijeli bismo'],
      ['potvrdi', 'potvrđujemo', 'potvrditi', 'potvrdili ste'],
      ['predaj', 'predajete', 'predati', 'predali bismo'],
      ['piši', 'pišete', 'pisati', 'pisali bismo'],
      ['položi', 'deponiramo', 'deponirati', 'deponirali bismo'],
      ['autentificiraj', 'autentificiramo', 'autentificirati', 'autentificirali ste'],
      ['nazovi', 'zovete', 'nazvati', 'nazvali bismo'],
      ['koristi', 'koristimo', 'koristiti', 'koristili ste'],
    ],
    nouns: ['', 'lozinku', 'šifru', 'PIN', 'kod', 'token', 'račun', 'karticu', 'poveznicu', 'aplikaciju', 'broj'],
  },
  en: {
    verbs: [
      ['send', 'sends', 'to send', 'would have sent'],
      ['disclose', 'discloses', 'to disclose', 'would disclose'],
      ['enter', 'enters', 'to enter', 'would have entered'],
      ['confirm', 'confirms', 'to confirm', 'would confirm'],
      ['submit', 'submits', 'to submit', 'would have submitted'],
      ['write', 'writes', 'to write', 'would have written'],
      ['deposit', 'deposits', 'to deposit', 'would deposit'],
      ['authenticate', 'authenticates', 'to authenticate', 'would authenticate'],
      ['call', 'calls', 'to call', 'would have called'],
      ['use', 'uses', 'to use', 'would have used'],
    ],
    nouns: ['', 'password', 'passcode', 'PIN', 'code', 'token', 'account', 'card', 'link', 'app', 'number'],
  },
} as const;
const VECTORS = ['', 'secure.cc', '25 USD', '1 2 3 4', 'number 123'] as const;
const OBFUSCATIONS = {
  plain: (s: string) => s,
  caps: (s: string) => s.toLocaleUpperCase('hr'),
  nfd: (s: string) => s.normalize('NFD'),
  folded: (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gu, 'dj'),
  leet: (s: string) => s.replace(/[aeios]/gu, c => ({ a: '4', e: '3', i: '1', o: '0', s: '5' })[c]!),
  separated: (s: string) => s.replace(/\p{L}+/gu, word => [...word].join('-')),
  spaced: (s: string) => s.replace(/\p{L}+/gu, word => [...word].join(' ')),
  dotted: (s: string) => s.replace(/\p{L}+/gu, word => [...word].join('.')),
  hidden: (s: string) => s ? `${s[0]}\u200b${s.slice(1)}` : s,
  mixed: (s: string) => s.replace(/[aeio]/u, c => ({ a: 'а', e: 'е', i: 'і', o: 'о' })[c]!),
} as const;

// Every verbatim payload actually preserved by the three supplied review
// documents, including the Unicode originals preserved by W-C2. The historical
// 21-item fixture remains separate: its 17 reconstructed inputs are not originals.
export const SAVED_REVIEW_PROBES = [
  'Muzej: proslijedi lozinku.',
  'Muzej: koristi lozinku.',
  'biste li poslali lozinku?',
  'otvaraš poveznicu.',
  'dial 0800 123.',
  'Authenticate at secure.cc',
  'Deposit 25 USD',
  'Piši na broj 123',
  'Pošalji lozinku',
  'Potvrdi lozinku',
  'Submit passcode',
  'kod 1 2 3 4',
] as const;

describe('decision 22 class product, independent of the policy regexes', () => {
  for (const [language, data] of Object.entries(LANGUAGES)) for (const surface of ['header', 'row'] as const) {
    it(`${language}/${surface}: verb × noun × vector × mood × obfuscation`, () => {
      let generated = 0, required = 0, rejected = 0;
      const passed: string[] = [];
      for (const paradigm of data.verbs) for (const verb of paradigm) for (const noun of data.nouns) {
        for (const vector of VECTORS) for (const disguise of Object.values(OBFUSCATIONS)) {
          const value = [disguise(verb), disguise(noun), vector].filter(Boolean).join(' ');
          generated++;
          if (surface === 'row' && noun === '' && vector === '') continue;
          required++;
          if (!externalText('title', value, { surface }).ok) rejected++;
          else passed.push(value);
        }
      }
      expect(generated).toBe(22_000);
      expect(required).toBe(surface === 'header' ? 22_000 : 21_600);
      expect(passed).toEqual([]);
      expect(rejected).toBe(required);
    }, 60_000);
  }

  it.each(SAVED_REVIEW_PROBES)('rejects saved review payload %j on both surfaces', value => {
    for (const surface of ['header', 'row'] as const) for (const kind of ['title', 'headsign', 'name', 'summary', 'address', 'register-text'] as const) {
      expect(vetExternal(kind, value, surface), `${kind}/${surface}`).toBeNull();
    }
  });

  it('keeps the full W-C2 and historical input sets exercised', () => {
    expect(W_C2_ATTACKS).toHaveLength(50);
    expect(REVIEW_W2_REGRESSIONS).toHaveLength(21);
    for (const value of [...W_C2_ATTACKS, ...REVIEW_W2_REGRESSIONS]) expect(vetExternal('title', value, 'header'), value).toBeNull();
  });

  it('covers all six persons, imperative number, gender and both Croatian aspects independently', () => {
    const forms = [
      'potvrdi', 'potvrdimo', 'potvrdite', 'potvrđuj', 'potvrđujmo', 'potvrđujte',
      'potvrđujem', 'potvrđuješ', 'potvrđuje', 'potvrđujemo', 'potvrđujete', 'potvrđuju',
      'potvrdio', 'potvrdila', 'potvrdilo', 'potvrdili', 'potvrdile', 'potvrdit', 'potvrđivati',
      'pišem', 'pišeš', 'piše', 'pišemo', 'pišete', 'pišu', 'piši', 'pišimo', 'pišite',
      'napisao', 'napisala', 'napisali', 'pisat', 'napisati',
      'deponiram', 'deponiraš', 'deponira', 'deponiramo', 'deponirate', 'deponiraju',
      'deponiraj', 'deponirajmo', 'deponirajte', 'deponirao', 'deponirala', 'deponirali',
      'autentificiram', 'autentificiraš', 'autentificira', 'autentificiramo', 'autentificirate', 'autentificiraju',
      'autentificiraj', 'autentificirajmo', 'autentificirajte', 'autentificirao', 'autentificirala', 'autentificirali',
      'utipkajte', 'popunite', 'zalijepi', 'podnesi', 'predočite', 'paste', 'key in', 'filled',
    ];
    for (const form of forms) for (const disguise of Object.values(OBFUSCATIONS)) {
      for (const surface of ['header', 'row'] as const) {
        const value = `${disguise(form)} ${disguise('lozinku')}`;
        expect(vetExternal('title', value, surface), `${surface}: ${value}`).toBeNull();
      }
    }
  });

  it.each(['cc', 'xyz', 'io', 'hr', 'com', 'technology', 'futuretld'])('rejects any domain suffix, including %s', tld => {
    for (const surface of ['header', 'row'] as const) expect(vetExternal('title', `Authenticate at secure.${tld}`, surface)).toBeNull();
  });
  it.each(['€', '$', 'kn', 'EUR', 'USD', 'HRK'])('rejects number/currency class %s in both orders', currency => {
    for (const value of [`25 ${currency}`, `${currency}25`]) expect(vetExternal('title', value, 'row')).toBeNull();
  });
  it.each(['broj 123', 'number 123', '1 2 3 4', '12-34-56', '0800 123', '@', 'www', 'http', 'tel:',
    'DE89 3704 0044 0532 0130 00', '4111 1111 1111 1111'])('rejects structural vector %j without a verb', value => {
    expect(vetExternal('title', value, 'row')).toBeNull();
  });
  it.each(['\u200b', '\u200d', '\u2060', '\u202e', '\u00ad', '\u034f', '\ufe0f', 'о', 'ɑ'])('does not let hidden/confusable %j authorize a name', ch => {
    expect(vetExternal('name', `Kin${ch} Europa`, 'row')).toBeNull();
  });
  it.each(['kod crkve sv. Marka', 'dvorac iz 1546 kod Zaprešića', 'planina (1182 mnv) kod Ogulina',
    'Ljeto kod Bartola', 'sv. Marka', 'dr. Tuđmana'])('keeps geographic grammar %j', value => {
    expect(vetExternal('title', value, 'row')).toBe(value);
  });
  it.each(['sv.Marka', 'dr.Tuđmana'])('requires whitespace after abbreviation %j under decision 24', value => {
    for (const surface of ['header', 'row'] as const) expect(vetExternal('title', value, surface)).toBeNull();
  });
  it.each(['kod: 1234', 'kod AB12', 'kod 1 2 3 4', 'unesi kod Lozinka', 'pošalji kod Marka lozinku'])(
    'geographic grammar cannot hide credential text %j', value => expect(vetExternal('title', value, 'row')).toBeNull());
});
