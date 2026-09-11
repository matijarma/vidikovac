// @vitest-environment happy-dom
// The seam the unit tests could not see: real upstream samples go through the
// real module parsers, and the layers and the kiosk teaser render from that
// output. Hand-built fixtures let Area A and Area C use two different `data`
// vocabularies while every test stayed green and the dashboard showed
// "Nedostupno" over healthy data (final review, C1). Nothing here builds a
// FeedItem by hand.
import { describe, expect, it } from 'vitest';
import { MODULES, MODULE_IDS, OPEN_MODULES, TEASER_MODULES, teaserSubset } from '../../worker/feed/registry';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { LAYERS } from '../../worker/protocol';
import { FIXTURE_CONTEXTS, FIXTURE_NOW } from '../feed/fixture-contexts';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { renderLayer } from '../../app/src/layers';
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
    const body = panel(renderLayer('grad-sada', ctx()), 'grad-sada-observation');
    expect(clean(body.querySelector('[data-testid=temp]'))).toMatch(/^-?\d+([.,]\d+)? °C$/);
    const facts = clean(body.querySelector('.panel-facts'));
    expect(facts).toMatch(/vlaga \d+ %/);
    expect(facts).toMatch(/tlak \d+([.,]\d+)? hPa/);
    expect(facts).toMatch(/vjetar \S+ \d+([.,]\d+)? m\/s/);
    expect(clean(body)).not.toContain(UNAVAILABLE);
    expect(clean(body)).not.toContain(DASH);
  });

  it('shows today’s forecast as a real range on both layers that carry it', () => {
    for (const [layer, id] of [
      ['grad-sada', 'grad-sada-forecast'],
      ['zrak-i-nebo', 'zrak-i-nebo-forecast'],
    ] as const) {
      const body = panel(renderLayer(layer, ctx()), id);
      expect(clean(body.querySelector('.big-number')), id).toMatch(/^od -?\d+ do -?\d+ °C$/);
      expect(clean(body), id).not.toContain(DASH);
    }
  });

  it('shows every quake with a magnitude and a depth', () => {
    const body = panel(renderLayer('zrak-i-nebo', ctx()), 'zrak-i-nebo-quakes');
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

  it('numbers every act of the Glasnik', () => {
    const body = panel(renderLayer('uprava-i-pravo', ctx()), 'uprava-i-pravo-acts');
    const rows = [...body.querySelectorAll('[data-testid=act-row]')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(clean(row)).toMatch(/\d+\/\d{4}/);
  });

  it('labels every place in the city with its category', () => {
    const body = panel(renderLayer('sigurnost', ctx()), 'sigurnost-poi');
    const subs = [...body.querySelectorAll('.panel-sub')];
    expect(subs.length).toBeGreaterThan(0);
    for (const sub of subs) expect(clean(sub)).not.toBe('');
  });

  it('renders every layer without a single unavailable field', () => {
    for (const layer of LAYERS) {
      const section = renderLayer(layer, ctx());
      expect(clean(section), layer).not.toContain(UNAVAILABLE);
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

  it('keeps the safety strip counting real closures', () => {
    const strip = safetyStripText(teaser, i18n);
    expect(strip.closures).toMatch(/^\d+ zatvaranj/);
    expect(strip.cap).not.toBe('');
    expect(strip.pharmacy).not.toBe('');
  });
});
