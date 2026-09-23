// @vitest-environment happy-dom
// The seam the unit tests could not see: real upstream samples go through the
// real module parsers, and the layers and the wall's safety strip render from
// that output. Hand-built fixtures let Area A and Area C use two different `data`
// vocabularies while every test stayed green and the dashboard showed
// "Nedostupno" over healthy data (final review, C1). Nothing here builds a
// FeedItem by hand.
import { describe, expect, it } from 'vitest';
import { MODULES, MODULE_IDS, OPEN_LICENCE, OPEN_MODULES, TEASER_MODULES, teaserSubset } from '../../worker/feed/registry';
import { isOpenLicenceEvent } from '../../worker/feed/modules/dogadanja/licence';
import { OPEN_DATASETS } from '../../worker/open/catalog';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { LAYERS } from '../../worker/protocol';
import { FIXTURE_CONTEXTS, FIXTURE_NOW } from '../feed/fixture-contexts';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { delayTone } from '../../app/src/experience/delay';
import { renderLayer } from '../../app/src/layers';
import { dataText } from '../../app/src/panels/panel';
import { routeDelays } from '../../app/src/layers/u-pokretu';
import { safetyStrip } from '../../app/src/kiosk/local';
import { kioskStrings } from '../../app/src/kiosk/strings';

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
  it('shows the Maksimir observation as numbers with pressure as a measured fact', () => {
    const weather = renderLayer('zrak-i-nebo', ctx());
    expect(clean(weather.querySelector('.wx-figures'))).toMatch(/\d+([.,]\d+)? hPa/);
    expect(clean(weather)).not.toContain(UNAVAILABLE);
    expect(clean(weather)).not.toContain(DASH);
  });

  it('grad-sada never renders the unavailable word or a dash: every source is live, so every lane is tiles or an honest empty word', () => {
    const section = renderLayer('grad-sada', ctx());
    expect(section.querySelector('[data-testid=tb]')).not.toBeNull();
    expect(section.querySelectorAll('.tl:not([data-skeleton])').length).toBeGreaterThan(0);
    expect(section.querySelectorAll('.tl[data-skeleton], [aria-busy="true"], [data-action=retry]')).toHaveLength(0);
    expect(clean(section)).not.toContain(UNAVAILABLE);
    // A dash where a figure should stand is the placeholder this guards against; a title is the
    // source's own words (Kulturpunkt writes "zrcala – psihoanaliza"), so titles are not read here,
    // and neither is a line's course beside its badge (GTFS writes "Črnomerec – Sopot").
    const figures = section.querySelectorAll('.tb-h, .tb-more, .tb-empty, .tl-label, .tl-value, .tl-time, .tl-context, .tl-trail');
    expect(figures.length).toBeGreaterThan(0);
    for (const figure of figures) {
      const probe = figure.cloneNode(true) as Element;
      for (const course of probe.querySelectorAll('.tl-label-title')) course.remove();
      expect(clean(probe), figure.outerHTML).not.toContain(DASH);
    }
  });

  it('shows today’s forecast as a real range', () => {
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

  it('tiles the deviating lines on Sada and lists a delay per route in Promet', () => {
    const delays = routeDelays(snapshots['zet-rt']);
    expect(delays.length).toBeGreaterThan(0);
    // Without a screen stop the sada lane boards the lines deviating most, at most four on a desk,
    // and every value is a delay word: never an arrival, never the fleet count.
    const deviating = delays.filter((d) => delayTone(i18n, d.meanDelay) !== 'none');
    expect(deviating.length).toBeGreaterThan(0);
    const gradSada = renderLayer('grad-sada', ctx());
    const tiles = [...gradSada.querySelectorAll('.tl[data-domain=transit]:not([data-skeleton])')];
    expect(tiles).toHaveLength(0);
    expect(gradSada.querySelector('.day-stop-prompt')).not.toBeNull();
    for (const tile of tiles) expect(clean(tile.querySelector('.tl-value'))).toMatch(/^(na vrijeme|kasni \d+ min|rani \d+ min)$/);
    expect(clean(gradSada)).not.toMatch(/\d+ vozil/);
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

describe('the wall\u2019s safety strip reads the real feed output', () => {
  // Exactly what /api/teaser answers: the open modules plus the three session
  // teasers, each through teaserSubset (worker/routes/feed.ts).
  const teaser = [...OPEN_MODULES, ...TEASER_MODULES].map((id) => teaserSubset(snapshots[id]!));

  it('keeps the safety strip counting real closures', () => {
    const strip = safetyStrip(teaser, null, i18n, kioskStrings('hr'), Date.now());
    expect(strip.closures.text).toMatch(/^\d+ zatvaranj/);
    expect(strip.warning.text).not.toBe('');
    expect(strip.pharmacy.label).not.toBe('');
  });
});

describe('every source reaches the public screen; only /open stays licence-selected', () => {
  const merged = snapshots.dogadanja!;
  const source = (item: { data?: unknown }) => dataText(item as never, 'source');

  it('starts from a merged module that really carries Kulturpunkt and Etnografski rows beside the City\u2019s and ZET\u2019s', () => {
    const sources = new Set(merged.items.map(source));
    for (const s of ['kulturpunkt', 'etnografski', 'skupstina', 'kvartovske', 'komunalne']) expect(sources.has(s), s).toBe(true);
  });

  it('keeps dogadanja out of /open and its catalogue: the module is session tier as a whole', () => {
    expect(MODULES.dogadanja.tier).toBe('session');
    expect(OPEN_MODULES).not.toContain('dogadanja');
    expect(OPEN_DATASETS.map((d) => d.module)).not.toContain('dogadanja');
    expect(merged.items.some((item) => !isOpenLicenceEvent(item))).toBe(true);
  });

  it('carries the whole module to /api/teaser: Kulturpunkt and Etnografski rows included, the module\u2019s own attribution kept', () => {
    expect(TEASER_MODULES).toContain('dogadanja');
    expect(TEASER_MODULES).toContain('dhmz-forecast');
    expect(TEASER_MODULES).toContain('glasnik');
    const passed = teaserSubset(merged);
    expect(passed.items.map(source)).toContain('kulturpunkt');
    expect(passed.items.map(source)).toContain('etnografski');
    expect(passed.items).toHaveLength(merged.items.length);
    expect(passed.attribution).toBe(merged.attribution);
  });
});
