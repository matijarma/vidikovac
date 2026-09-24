// @vitest-environment happy-dom
// Sada's first seconds on the phone (lane/v-perf, Lighthouse CLS 0.135 to 0.154 on /d/ Sada, target under 0.1):
// what arrives late must not move what the reader is already looking at. The departures block and the title hold
// the height their answer will take; "U blizini" keeps its head and its reserved rows until the sources its rows come
// from have answered (the city catalogue above all, which lands last), then draws every row at once; and the phone's
// map band, a live MapLibre map, starts only then, so the map library is not evaluated in front of the first answer.
// A later catalogue load (Karta asking for streets) never takes the drawn rows back, a hold never outlasts
// NEARBY_HOLD_MS, and a context with no page behind it (a unit test, the Karta sheet) draws at once, as before.
import '../../shared/kiosk/external-text';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { emptyCity, type CityState, type DepartureBoard } from '../../shared/city/types';
import { loadSadaFeed, NEARBY_HOLD_MS, NEARBY_PHONE_ROWS } from '../../app/src/city/feed';
import { DEPARTURE_ROWS } from '../../app/src/city/next-departures';
import type { ScreenContext, ScreenStop } from '../../app/src/core/contracts';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { renderGradSada } from '../../app/src/layers/grad-sada';
import type { LayerContext } from '../../app/src/layers/types';
import type { CityMapOptions } from '../../app/src/map/city-map';
import { createMapSlots } from '../../app/src/map/map-slots';

const NOW = Date.parse('2026-09-11T12:32:00Z');
const iso = (ms: number): string => new Date(ms).toISOString();
const attribution = { text: 'Izvor', url: 'https://example.test/', licence: 'Otvorena dozvola' };
const snap = (module: ModuleSnapshot['module'], items: ModuleSnapshot['items']): ModuleSnapshot =>
  ({ module, tier: 'open', status: 'live', fetchedAt: iso(NOW - 60_000), attribution, items });
const TRG: ScreenStop = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '13'] };
const board = (minutes: readonly number[]): DepartureBoard => ({
  operator: 'zet', stopId: TRG.id, stopName: TRG.name, status: 'live', generatedAt: iso(NOW - 60_000),
  departures: minutes.map((m, i) => ({ operator: 'zet', tripId: `t${i}`, routeId: '6', routeName: '6', headsign: 'Črnomerec', at: iso(NOW + m * 60_000) })),
});
const SNAPSHOTS: LayerContext['snapshots'] = {
  'zet-rt': snap('zet-rt', []),
  prometnice: snap('prometnice', [
    { id: 'c1', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Ilica', at: '2026-09-01T07:00:00Z', until: '2026-09-11T20:00:00Z', geo: { type: 'LineString', coordinates: [[15.9750, 45.8130], [15.9740, 45.8131]] }, data: { type: 'ROAD_CLOSED', subtype: 'ROAD_CLOSED_CONSTRUCTION' } },
  ]),
  dogadanja: snap('dogadanja', []),
};
const PHONE: ScreenContext = { surface: 'phone', locale: 'hr', theme: 'light', themePreference: 'light', lightweight: false, reducedMotion: false };
const loading = (): CityState => ({ ...emptyCity(), loading: true });
const answered = (): CityState => ({ ...emptyCity(), loading: false, manifest: { schema: 1, sources: [] } as unknown as CityState['manifest'] });
const fakeMaps = () => {
  const factory = vi.fn((_options: CityMapOptions) => ({ update: vi.fn(), destroy: vi.fn(), pause: vi.fn(), resume: vi.fn(), setView: vi.fn() }));
  return { maps: createMapSlots(factory as never), factory };
};
/** One page: its repaint hook is the page's identity (the dashboard passes the same function on every draw). */
function page(over: Partial<LayerContext> = {}) {
  const onLocalData = vi.fn();
  const { maps, factory } = fakeMaps();
  const draw = (more: Partial<LayerContext> = {}): HTMLElement => renderGradSada({
    i18n: createDefaultI18n('hr'), snapshots: SNAPSHOTS, now: NOW, screen: PHONE, stops: [TRG],
    boards: { ensure: vi.fn(), get: () => board([3, 9, 16]), destroy: vi.fn() } as never,
    onLocalData, maps, city: answered(), ...over, ...more,
  });
  return { draw, factory };
}
const rows = (el: HTMLElement) => el.querySelectorAll('[data-testid=nearby] li.nearby-row');
const reserved = (el: HTMLElement) => el.querySelectorAll('[data-testid=nearby] li.nearby-row-empty');

beforeAll(async () => { expect(await loadSadaFeed()).not.toBeNull(); });

describe('U blizini holds its rows until its sources have answered', () => {
  it('keeps the head and the phone\'s row budget as reserved rows while the city catalogue is loading, then draws every row at once', () => {
    const p = page();
    const held = p.draw({ city: loading() });
    const list = held.querySelector('[data-testid=nearby]')!;
    expect(list.getAttribute('aria-busy')).toBe('true');
    expect(rows(held)).toHaveLength(0);
    expect(reserved(held)).toHaveLength(NEARBY_PHONE_ROWS);
    // The head is the answer's own, so the rows arriving change nothing above them.
    expect(held.querySelector('[data-testid=nearby-head] .nearby-pill')?.textContent).toMatch(/km · ~\d+ min$/);
    const drawn = p.draw({ city: answered() });
    expect(drawn.querySelector('[data-testid=nearby]')!.hasAttribute('aria-busy')).toBe(false);
    expect(rows(drawn).length).toBeGreaterThan(0);
    expect(reserved(drawn)).toHaveLength(0);
    expect(drawn.querySelector('[data-testid=nearby-head]')?.textContent).toBe(held.querySelector('[data-testid=nearby-head]')?.textContent);
  });

  it('waits for the transit, closure and events feeds too, a failed one counting as answered', () => {
    const p = page();
    expect(rows(p.draw({ snapshots: { 'zet-rt': SNAPSHOTS['zet-rt'] } }))).toHaveLength(0);
    const drawn = p.draw({ snapshots: { 'zet-rt': SNAPSHOTS['zet-rt'], prometnice: SNAPSHOTS.prometnice }, errors: { dogadanja: 'down' } });
    expect(rows(drawn).length).toBeGreaterThan(0);
  });

  it('never takes the rows back once drawn: a later catalogue load (Karta asking for streets) leaves them standing', () => {
    const p = page();
    expect(rows(p.draw({ city: answered() })).length).toBeGreaterThan(0);
    expect(rows(p.draw({ city: loading() })).length).toBeGreaterThan(0);
  });

  it(`holds at most ${NEARBY_HOLD_MS} ms from the first draw that held`, () => {
    const p = page();
    expect(rows(p.draw({ city: loading() }))).toHaveLength(0);
    expect(rows(p.draw({ city: loading(), now: NOW + NEARBY_HOLD_MS - 1 }))).toHaveLength(0);
    expect(rows(p.draw({ city: loading(), now: NOW + NEARBY_HOLD_MS })).length).toBeGreaterThan(0);
  });

  it('draws at once with no page behind the context, and for a session that has ended', () => {
    const bare = renderGradSada({ i18n: createDefaultI18n('hr'), snapshots: SNAPSHOTS, now: NOW, screen: PHONE, stops: [TRG], city: loading() });
    expect(rows(bare).length).toBeGreaterThan(0);
    const p = page();
    expect(rows(p.draw({ city: loading(), frozenAt: NOW, session: { expiresAt: NOW, frozen: true } })).length).toBeGreaterThan(0);
  });
});

describe('the phone\'s map band starts once Sada has settled', () => {
  it('keeps the band\'s box (and its link to Karta) while the list holds, and makes the map only when the hold ends', () => {
    const p = page();
    const held = p.draw({ city: loading() });
    expect(held.querySelector('[data-testid=sada-map-band] a.sada-map-open')).not.toBeNull();
    expect(held.querySelector('[data-testid=sada-map-canvas]')).toBeNull();
    expect(p.factory).not.toHaveBeenCalled();
    const settled = p.draw({ city: answered() });
    expect(settled.querySelector('[data-testid=sada-map-canvas]')).not.toBeNull();
    expect(p.factory).toHaveBeenCalledTimes(1);
  });
});

describe('the boxes that fill late hold the height of their answer (overview.css)', () => {
  const css = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', 'overview.css'), 'utf8');
  const rule = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    expect(at, `overview.css has a rule for ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at));
  };
  it(`a departures block on its way reserves ${DEPARTURE_ROWS} rows of a departure's own height`, () => {
    const row = /min-block-size:\s*([\d.]+rem)/.exec(rule('.sada-departure, .sada-departure-empty'))![1];
    const busy = rule(".sada-departure-list[aria-busy='true'] > .sada-departure-empty");
    expect(busy).toContain(`min-block-size: calc(${DEPARTURE_ROWS} * ${row})`);
  });
  it('the place title keeps one line while its name is being checked', () => {
    expect(rule('.sada-place')).toContain('min-block-size: calc(var(--type-display) * var(--lh-title))');
  });
});

describe('the band\'s map fills its 112 px box (overview.css; round 1 finding F1)', () => {
  const ui = (name: string): string => readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', name), 'utf8');
  const ruleOf = (css: string, selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    expect(at, `a rule for ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at));
  };
  it('the slot container takes the band\'s height itself: layers.css gives every .map-canvas an explicit 42vh clamp, and an absolutely placed box with an explicit height ignores its inset, so the band showed the top third of a 354 px map (the ground north of the place, never the place)', () => {
    expect(ruleOf(ui('layers.css'), '.map-canvas')).toMatch(/block-size: clamp\(/);
    const band = ruleOf(ui('overview.css'), '.sada-map');
    expect(band).toContain('block-size: 112px');
    expect(band).toContain('overflow: hidden');
    const canvas = ruleOf(ui('overview.css'), '.sada-map-canvas');
    expect(canvas).toContain('position: absolute');
    expect(canvas).toContain('inset: 0');
    expect(canvas).toMatch(/block-size: 100%/);
    expect(canvas).toMatch(/inline-size: 100%/);
  });
});

describe('Sada stays calm and fits a phone held sideways (overview.css; round 1 findings F13, F14, F15)', () => {
  const css = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', 'overview.css'), 'utf8');
  const ruleOf = (selector: string, scope = css): string => {
    const at = scope.indexOf(`${selector} {`);
    expect(at, `a rule for ${selector}`).toBeGreaterThanOrEqual(0);
    return scope.slice(at, scope.indexOf('}', at));
  };
  it('F15: the sentence card reserves two lines, so a one-line turn after a two-line one moves nothing below it', () => {
    expect(ruleOf('.sada-sentence-text')).toContain('min-block-size: calc(2 * var(--type-body) * var(--lh-body))');
  });
  it('F14: a row\'s wall-size line badge takes the phone\'s m geometry inside a U blizini row', () => {
    const badge = ruleOf(".nearby-row .k-line-badge[data-size='k']");
    expect(badge).toContain('block-size: 2rem');
    expect(badge).toContain('min-inline-size: 2.75rem');
    expect(badge).toContain('font-size: var(--type-head)');
  });
  it('F13: in a short landscape viewport the sentence card and the band share one row and everything else spans both columns', () => {
    const block = /@media \(max-height: 30rem\) and \(orientation: landscape\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(block).toContain(".ki[data-surface='phone'] .ws-sada { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);");
    expect(block).toContain(".ki[data-surface='phone'] .ws-sada > :not(.sada-sentence):not(.sada-map) { grid-column: 1 / -1; }");
  });
});
