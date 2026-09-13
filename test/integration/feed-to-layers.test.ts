// @vitest-environment happy-dom
// The seam the unit tests could not see: real upstream samples go through the
// real module parsers, and the layers and the kiosk teaser render from that
// output. Hand-built fixtures let Area A and Area C use two different `data`
// vocabularies while every test stayed green and the dashboard showed
// "Nedostupno" over healthy data (final review, C1). Nothing here builds a
// FeedItem by hand.
import { describe, expect, it } from 'vitest';
import { MODULES, MODULE_IDS, OPEN_LICENCE, OPEN_MODULES, TEASER_MODULES, teaserSubset } from '../../worker/feed/registry';
import { OPEN_LICENCE_EVENT_SOURCES, isOpenLicenceEvent } from '../../worker/feed/modules/dogadanja/licence';
import { OPEN_DATASETS } from '../../worker/open/catalog';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { LAYERS } from '../../worker/protocol';
import { FIXTURE_CONTEXTS, FIXTURE_NOW } from '../feed/fixture-contexts';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { renderLayer } from '../../app/src/layers';
import { dataText } from '../../app/src/panels/panel';
import { routeDelays } from '../../app/src/layers/u-pokretu';
import { safetyStripText, teaserCards } from '../../app/src/kiosk';

const NOW = FIXTURE_NOW.getTime();
const i18n = createDefaultI18n('hr');
const UNAVAILABLE = i18n.t('common.unavailable'); // "Nedostupno"
const DASH = '–';

const snapshots: Partial<Record<ModuleId, ModuleSnapshot>> = {};
await Promise.all(
  MODULE_IDS.map(async (id) => {
    const produced = await MODULES[id].fetcher(FIXTURE_CONTEXTS[id]);
    snapshots[id] = { ...produced, status: 'live' };
  }),
);

const ctx = () => ({ i18n, snapshots, now: NOW });
const clean = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const panel = (section: HTMLElement, id: string): HTMLElement => {
  const found = section.querySelector<HTMLElement>(`#${id}`);
  expect(found, `panel ${id}`).not.toBeNull();
  return found!;
};

describe('every layer renders the real feed output', () => {
  it('shows the Maksimir observation as numbers, not placeholders', () => {
    const body = panel(renderLayer('grad-sada', ctx()), 'ov-weather');
    expect(clean(body.querySelector('[data-testid=temp]'))).toMatch(/^-?\d+([.,]\d+)? °C$/);
    const facts = clean(body.querySelector('.ov-weather-facts'));
    expect(facts).toMatch(/vlaga \d+ %/);
    expect(facts).toMatch(/\S+ \d+([.,]\d+)? m\/s/);
    expect(clean(body)).not.toContain(UNAVAILABLE);
    expect(clean(body)).not.toContain(DASH);
    // The full weather workspace also carries pressure as a measured fact.
    const weather = panel(renderLayer('zrak-i-nebo', ctx()), 'wx-now');
    expect(clean(weather.querySelector('.wx-figures'))).toMatch(/\d+([.,]\d+)? hPa/);
  });

  it('shows today’s forecast as a real range on both layers that carry it', () => {
    const overview = panel(renderLayer('grad-sada', ctx()), 'ov-weather');
    expect(clean(overview.querySelector('.ov-range-text'))).toMatch(/danas od -?\d+ do -?\d+ °C/);
    const weather = panel(renderLayer('zrak-i-nebo', ctx()), 'wx-range');
    expect(clean(weather.querySelector('[data-testid=forecast-range]'))).toMatch(/^od -?\d+ do -?\d+ °C$/);
    expect(clean(weather)).not.toContain(DASH);
  });

  it('shows every quake with a magnitude and a depth', () => {
    const body = panel(renderLayer('zrak-i-nebo', ctx()), 'wx-quakes');
    const rows = [...body.querySelectorAll('[data-testid=quake-row]')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(clean(row)).toMatch(/M \d+([.,]\d+)?/);
      expect(clean(row)).toMatch(/dubina \d+([.,]\d+)? km/);
      expect(clean(row)).not.toContain(DASH);
    }
  });

  it('counts vehicles and lists a delay per route', () => {
    const gradSada = renderLayer('grad-sada', ctx());
    const vehicles = clean(gradSada.querySelector('[data-testid=vehicle-count]'));
    expect(vehicles).toMatch(/^\d+ vozil/);
    expect(vehicles).not.toMatch(/^0 /);

    const delays = routeDelays(snapshots['zet-rt']);
    expect(delays.length).toBeGreaterThan(0);
    // The per-route summary rows are the only source of a delay; the pins carry none.
    expect(delays.length).toBe(snapshots['zet-rt']!.items.filter((i) => i.id.startsWith('route:')).length);

    const body = panel(renderLayer('u-pokretu', ctx()), 'u-pokretu-delays');
    expect(body.querySelectorAll('[data-testid=delay-row]').length).toBe(delays.length);
    expect(clean(body)).not.toContain(i18n.t('status.empty'));
    expect(clean(body)).not.toContain(DASH);
  });

  it('lists Događanja for culture/community sources and Grad radi for the Assembly and communal works, from the real dogadanja fixtures', () => {
    const kultura = renderLayer('kultura', ctx());
    const eventRows = [...kultura.querySelectorAll('[data-testid=event-row], [data-testid=undated-row]')];
    expect(eventRows.length).toBeGreaterThan(0);
    for (const row of eventRows) expect(clean(row)).not.toBe('');
    expect(clean(kultura)).not.toContain(UNAVAILABLE);
    expect(eventRows.map(clean).join(' ')).not.toContain('Skupština');

    const uprava = renderLayer('uprava-i-pravo', ctx());
    const cityRows = [...uprava.querySelectorAll('[data-testid=city-work-row]')];
    expect(cityRows.length).toBeGreaterThan(0);
    for (const row of cityRows) expect(clean(row)).not.toBe('');
    expect(clean(uprava)).not.toContain(UNAVAILABLE);
  });

  it('numbers every act of the Glasnik', () => {
    const body = panel(renderLayer('uprava-i-pravo', ctx()), 'cv-gazette');
    const rows = [...body.querySelectorAll('[data-testid=act-row]')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(clean(row)).toMatch(/\d+\/\d{4}/);
  });

  it('labels every place in the city with its category', () => {
    const body = panel(renderLayer('sigurnost', ctx()), 'sf-assembly');
    const rows = [...body.querySelectorAll('[data-testid=assembly-point]')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(clean(row.querySelector('.row-title'))).not.toBe('');
    expect(clean(body)).toMatch(/Na popisu je \d+ mjesta/);
  });

  it('renders every layer without a single unavailable field', () => {
    for (const layer of LAYERS) {
      const section = renderLayer(layer, ctx());
      expect(clean(section), layer).not.toContain(UNAVAILABLE);
    }
  });

  it('renders every layer without a raw brace anywhere in its text, not only the footer (E8)', () => {
    for (const layer of LAYERS) {
      const text = renderLayer(layer, ctx()).textContent ?? '';
      expect(text, layer).not.toContain('{');
      expect(text, layer).not.toContain('}');
    }
  });

  it('fills every attribution template so no brace reaches a panel footer (R-62)', () => {
    for (const layer of LAYERS) {
      const section = renderLayer(layer, ctx());
      for (const attr of section.querySelectorAll('[data-testid=panel-attr]')) {
        expect(attr.textContent, layer).not.toContain('{');
        expect(attr.textContent, layer).not.toContain('}');
      }
    }
  });
});

describe('the kiosk teaser renders the real feed output', () => {
  // Exactly what /api/teaser answers: the open modules plus the three session
  // teasers, each through teaserSubset (worker/routes/feed.ts).
  const teaser = [...OPEN_MODULES, ...TEASER_MODULES].map((id) => teaserSubset(snapshots[id]!));

  it('puts real values on every card and no "coming soon" sign', () => {
    const cards = teaserCards(teaser, i18n, NOW);
    const card = (id: string) => cards.find((c) => c.id === id)!;
    expect(card('weather').body).toMatch(/-?\d+([.,]\d+)? °C/);
    expect(card('quake').body).toMatch(/M \d+([.,]\d+)?/);
    expect(card('closures').body).toMatch(/^\d+ zatvaranj/);
    expect(card('news').body).not.toBe('');
    for (const c of cards) {
      expect(c.body, c.id).not.toContain(UNAVAILABLE);
      expect(c.body, c.id).not.toContain(DASH);
      expect(c.body, c.id).not.toBe(i18n.t('kiosk.teaserSoon'));
    }
  });

  it('fills every teaser card attribution so no brace reaches the kiosk (R-62)', () => {
    const cards = teaserCards(teaser, i18n, NOW);
    for (const c of cards) {
      for (const text of [c.title, c.body, c.attribution?.text ?? '']) {
        expect(text, c.id).not.toContain('{');
        expect(text, c.id).not.toContain('}');
      }
    }
  });

  it('puts one city row on the screen, from the real Skupština/kvartovske/komunalne/ZET fixtures, under the Otvorena dozvola', () => {
    const card = teaserCards(teaser, i18n, NOW).find((c) => c.id === 'city')!;
    expect(card).toBeDefined();
    expect(card.body).not.toBe('');
    expect(card.body).not.toBe(i18n.t('status.loading'));
    expect(card.body).not.toBe(i18n.t('kiosk.teaserCityEmpty'));
    expect(card.body).not.toContain(UNAVAILABLE);
    expect(card.attribution?.licence).toBe(OPEN_LICENCE);
    expect(card.attribution?.text).toContain('Otvorena dozvola');
    expect(card.attribution?.text).not.toContain('CC BY-SA');
  });

  it('keeps the safety strip counting real closures', () => {
    const strip = safetyStripText(teaser, i18n);
    expect(strip.closures).toMatch(/^\d+ zatvaranj/);
    expect(strip.cap).not.toBe('');
    expect(strip.pharmacy).not.toBe('');
  });
});

describe('the licence boundary: no CC BY-SA row ever reaches the open tier', () => {
  const merged = snapshots.dogadanja!;
  const source = (item: { data?: unknown }) => dataText(item as never, 'source');
  const notOpen = merged.items.filter((item) => !isOpenLicenceEvent(item));
  const notOpenTitles = notOpen.map((item) => item.title);

  it('starts from a merged module that really carries Kulturpunkt (CC BY-SA 3.0 HR) and Etnografski rows, so the filter is exercised, not vacuous', () => {
    expect(notOpen.some((item) => source(item) === 'kulturpunkt')).toBe(true);
    expect(notOpen.some((item) => source(item) === 'etnografski')).toBe(true);
    expect(new Set(notOpen.map(source))).toEqual(new Set(['kulturpunkt', 'etnografski']));
    // and every one of the five open sources is present too, so the teaser has something to carry.
    for (const s of OPEN_LICENCE_EVENT_SOURCES) expect(merged.items.some((item) => source(item) === s), s).toBe(true);
  });

  it('keeps dogadanja out of /open and its catalogue: the module is session tier as a whole', () => {
    expect(MODULES.dogadanja.tier).toBe('session');
    expect(OPEN_MODULES).not.toContain('dogadanja');
    expect(OPEN_DATASETS.map((d) => d.module)).not.toContain('dogadanja');
  });

  it('reduces the /api/teaser copy of dogadanja to Otvorena dozvola rows only, with an attribution that names no other licence', () => {
    expect(TEASER_MODULES).toContain('dogadanja');
    const reduced = teaserSubset(merged);
    expect(reduced.items.length).toBeGreaterThan(0);
    expect(reduced.items.every(isOpenLicenceEvent)).toBe(true);
    expect(reduced.items.map(source)).not.toContain('kulturpunkt');
    expect(reduced.items.map(source)).not.toContain('etnografski');
    expect(reduced.attribution.licence).toBe(OPEN_LICENCE);
    expect(reduced.attribution.text).not.toContain('CC BY-SA');
    expect(reduced.attribution.text).not.toContain('Kulturpunkt');
    const payload = JSON.stringify(reduced);
    for (const title of notOpenTitles) expect(payload).not.toContain(JSON.stringify(title).slice(1, -1));
  });

  it('shows no non-open title on any kiosk teaser card, whether or not the payload was filtered upstream', () => {
    const filtered = [...OPEN_MODULES, ...TEASER_MODULES].map((id) => teaserSubset(snapshots[id]!));
    const unfiltered = [...OPEN_MODULES, ...TEASER_MODULES].map((id) => (id === 'dogadanja' ? snapshots[id]! : teaserSubset(snapshots[id]!)));
    for (const modules of [filtered, unfiltered]) {
      for (const c of teaserCards(modules, i18n, NOW)) {
        const text = [c.title, c.body, c.attribution?.text ?? ''].join(' | ');
        for (const title of notOpenTitles) expect(text, c.id).not.toContain(title);
        expect(text, c.id).not.toContain('CC BY-SA');
      }
    }
  });

  it('still shows the CC BY-SA rows where they belong: the session-tier Kultura panel, attributed as such', () => {
    const kultura = clean(renderLayer('kultura', ctx()));
    expect(kultura).toContain('Kulturpunkt (CC BY-SA 3.0 HR)');
  });
});
