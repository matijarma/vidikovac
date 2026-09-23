// @vitest-environment happy-dom
// The city conditions (air, Sava, consultations) and the two layers that carry
// them read their words from the catalogue: city.airMethod, city.airIndex-1…6,
// city.consultationsNote, weather.reference and civic.consultations, never an
// inline Croatian/English pair. Also the bike-count plural keys lane C's
// bikeCount() adapter will read (city.bikeCount_*, city.bikeCountUnknown).
// The phone's renderers vet third-party text through the boundary, which refuses everything until the policy is installed: load it here as the page's chunks do.
import '../../shared/kiosk/external-text';
import { describe, expect, it } from 'vitest';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { airIndexLabel } from '../../app/src/city/air';
import { conditionsMarkup, consultationsMarkup } from '../../app/src/city/conditions';
import { bikeCount } from '../../app/src/city/strings';
import { renderLayer } from '../../app/src/layers';
import type { LayerContext } from '../../app/src/layers/types';
import { emptyCity, type CityLive, type CitySource } from '../../shared/city/types';

const NOW = Date.parse('2026-09-22T10:00:00Z');
const source = (id: string): CitySource => ({ id, name: id, url: 'https://example.test/', licence: 'Otvorena dozvola', status: 'live', count: 1, fetchedAt: '2026-09-22T09:00:00Z' });
const LIVE: CityLive = {
  schema: 1,
  generatedAt: '2026-09-22T09:30:00Z',
  sources: [source('air'), source('river'), source('consultations')],
  bikes: [],
  air: [{ id: '155', name: 'Zagreb-1', lon: 15.97, lat: 45.81, index: 2, observedAt: '2026-09-22T09:00:00Z' }],
  river: { text: 'Vodostaj Save je u padu.', publishedAt: '2026-09-22T07:00:00Z', period: 'jutro' },
  consultations: [{ id: 'c1', title: 'Nacrt pravilnika', institution: 'Ministarstvo', status: 'open', start: '2026-09-01', end: '2026-09-30', url: 'https://esavjetovanja.gov.hr/1' }],
};
const ctx = (locale: 'hr' | 'en'): LayerContext => ({ i18n: createDefaultI18n(locale), snapshots: {}, now: NOW, city: { ...emptyCity(), live: LIVE } });
const CATALOGUE = { hr, en } as const;

describe('air index classes', () => {
  it.each(['hr', 'en'] as const)('%s: names the six classes from city.airIndex-1…6', (locale) => {
    const i18n = createDefaultI18n(locale);
    const city = CATALOGUE[locale].city;
    expect([1, 2, 3, 4, 5, 6].map((n) => airIndexLabel(i18n, n))).toEqual([city['airIndex-1'], city['airIndex-2'], city['airIndex-3'], city['airIndex-4'], city['airIndex-5'], city['airIndex-6']]);
  });
  it('keeps the Croatian class names and falls back to "no data" outside 1…6', () => {
    const i18n = createDefaultI18n('hr');
    expect([1, 2, 3, 4, 5, 6].map((n) => airIndexLabel(i18n, n))).toEqual(['Dobra', 'Prihvatljiva', 'Umjerena', 'Loša', 'Vrlo loša', 'Izrazito loša']);
    for (const odd of [0, 7, 2.5, '2', null, undefined, Number.NaN]) expect(airIndexLabel(i18n, odd)).toBe('Nema podatka');
    expect(airIndexLabel({ getLocale: () => 'en' }, 4)).toBe('Poor');
    expect(airIndexLabel({ getLocale: () => 'en' }, 9)).toBe('No data');
  });
});

describe('conditions and consultations', () => {
  it.each(['hr', 'en'] as const)('%s: the air method line and the consultations heading and note come from the catalogue', (locale) => {
    const c = CATALOGUE[locale];
    const air = conditionsMarkup(ctx(locale));
    expect(air).toContain(`<p class="city-meta">${c.city.airMethod}</p>`);
    expect(air).toContain(c.city['airIndex-2']);
    const other = CATALOGUE[locale === 'hr' ? 'en' : 'hr'];
    expect(air).not.toContain(other.city.airMethod);
    const consultations = consultationsMarkup(ctx(locale));
    expect(consultations).toContain(`<h3>${c.civic.consultations}</h3><p class="city-meta">${c.city.consultationsNote}</p>`);
    expect(consultations).not.toContain(other.city.consultationsNote);
  });
  it('keeps the approved Croatian wording', () => {
    expect(conditionsMarkup(ctx('hr'))).toContain('Opažanja postaja su preliminarna, ne ocjena za cijeli grad. Indeksi čestica koriste pomične prosjeke.');
    expect(consultationsMarkup(ctx('hr'))).toContain('<h3>Nacionalna savjetovanja</h3><p class="city-meta">Nacionalni izvori, ne savjetovanja Grada Zagreba.</p>');
  });
});

describe('the layers that carry them', () => {
  it.each(['hr', 'en'] as const)('%s: Vrijeme names its reference disclosure with weather.reference', (locale) => {
    const section = renderLayer('zrak-i-nebo', ctx(locale));
    expect(section.querySelector('.wx-reference > summary')!.textContent).toBe(CATALOGUE[locale].weather.reference);
  });
  it.each(['hr', 'en'] as const)('%s: Grad jumps to the consultations with the same words its heading says (civic.consultations)', (locale) => {
    const section = renderLayer('uprava-i-pravo', ctx(locale));
    const jump = section.querySelector('[data-action=section-jump][data-id=cv-consultations]')!;
    expect(jump.textContent).toBe(CATALOGUE[locale].civic.consultations);
    expect(section.querySelector('#cv-consultations h3')!.textContent).toBe(jump.textContent);
  });
  it('keeps the Croatian words', () => {
    expect(hr.weather.reference).toBe('Mjerenja, sunce, zrak i bilten Save');
    expect(hr.civic.consultations).toBe('Nacionalna savjetovanja');
  });
});

describe('bike-count plural keys', () => {
  it.each(['hr', 'en'] as const)('%s: city.bikeCount_* says what bikeCount() says for every count', (locale) => {
    const i18n = createDefaultI18n(locale);
    for (const n of [0, 1, 2, 3, 4, 5, 10, 11, 12, 14, 21, 22, 25, 101, 111, 112, 122]) {
      expect(i18n.t('city.bikeCount', { count: n }), String(n)).toBe(bikeCount(i18n, n));
    }
  });
  it('an unknown count is a dash and the noun, never "?"', () => {
    expect(hr.city.bikeCount_one).toBe('{count} bicikl');
    expect(hr.city.bikeCount_few).toBe('{count} bicikla');
    expect(hr.city.bikeCount_other).toBe('{count} bicikala');
    expect(hr.city.bikeCountUnknown).toBe('– bicikala');
    expect(en.city.bikeCountUnknown).toBe('– bikes');
    for (const value of [hr.city.bikeCountUnknown, en.city.bikeCountUnknown]) expect(value).not.toMatch(/[?—]/);
  });
});
