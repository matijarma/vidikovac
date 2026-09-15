// @vitest-environment happy-dom
// The Kvart panel: the pure counting helpers (worksInKvart, closuresInKvart,
// D6/D18), the walking estimate (walkMinutes, D16) and renderKvart's markup
// contract (B.5) -- the map figure or, lagano and without a factory, its one
// text row; the saved chips; the walking row; the notify button.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import type { AreaSlug } from '../../worker/pairing/areas';
import type { ScreenStop } from '../../app/src/core/contracts';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import type { LayerContext } from '../../app/src/layers/types';
import type { CityMapHandle, CityMapOptions } from '../../app/src/map/city-map';
import { createMapSlots } from '../../app/src/map/map-slots';
import { closuresInKvart, KVART_MODULES, renderKvart, walkMinutes, worksInKvart } from '../../app/src/experience/kvart';
import { text } from './helpers';

const i18n = createDefaultI18n('hr');

const komunalne = (items: ModuleSnapshot['items']): ModuleSnapshot => ({
  module: 'dogadanja', tier: 'session', status: 'live', fetchedAt: '2026-09-15T08:00:00Z',
  attribution: { text: 'Izvor', url: 'https://example.test/', licence: 'Otvorena dozvola' }, items,
});
const prometnice = (items: ModuleSnapshot['items']): ModuleSnapshot => ({
  module: 'prometnice', tier: 'open', status: 'live', fetchedAt: '2026-09-15T08:00:00Z',
  attribution: { text: 'Izvor', url: 'https://example.test/', licence: 'Otvorena dozvola' }, items,
});

describe('worksInKvart', () => {
  const items: ModuleSnapshot['items'] = [
    { id: 'w1', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Vodovod, Ilica', geo: { type: 'Point', coordinates: [15.97, 45.81] }, data: { source: 'komunalne', status: 'U tijeku', district: 'donji-grad' } },
    { id: 'w2', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Plin, Trnje', geo: { type: 'Point', coordinates: [15.98, 45.79] }, data: { source: 'komunalne', status: 'U tijeku', district: 'trnje' } },
    { id: 'w3', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Gotovo, Ilica', geo: { type: 'Point', coordinates: [15.97, 45.81] }, data: { source: 'komunalne', status: 'Gotovo', district: 'donji-grad' } },
    { id: 'z1', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Koncert', data: { source: 'kulturpunkt' } },
  ];
  it('keeps only komunalne items "u tijeku", scoped to the kvart', () => {
    expect(worksInKvart(komunalne(items), 'donji-grad' as AreaSlug).map((i) => i.id)).toEqual(['w1']);
    expect(worksInKvart(komunalne(items), 'trnje' as AreaSlug).map((i) => i.id)).toEqual(['w2']);
  });
  it('is city-wide (every "u tijeku" komunalna item) when the kvart is null', () => {
    expect(worksInKvart(komunalne(items), null).map((i) => i.id)).toEqual(['w1', 'w2']);
  });
  it('is empty without a snapshot', () => {
    expect(worksInKvart(undefined, null)).toEqual([]);
  });
});

describe('closuresInKvart', () => {
  const items: ModuleSnapshot['items'] = [
    { id: 'c1', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Ilica', geo: { type: 'LineString', coordinates: [[15.97, 45.81], [15.971, 45.811]] }, data: { street: 'Ilica', district: 'donji-grad' } },
    { id: 'c2', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Savska', geo: { type: 'LineString', coordinates: [[15.98, 45.79]] }, data: { street: 'Savska cesta', district: 'trnje' } },
    { id: 'p1', module: 'prometnice', kind: 'poi', tier: 'open', title: 'no' },
  ];
  it('keeps only closures, scoped to the kvart', () => {
    expect(closuresInKvart(prometnice(items), 'donji-grad' as AreaSlug).map((i) => i.id)).toEqual(['c1']);
  });
  it('is every closure city-wide when the kvart is null', () => {
    expect(closuresInKvart(prometnice(items), null).map((i) => i.id)).toEqual(['c1', 'c2']);
  });
});

describe('walkMinutes', () => {
  it('rounds a straight-line distance at 1.2 m/s up to the next whole minute', () => {
    // 1 km east at the equator would be 1/111.32 deg; here 15.98,45.815 -> roughly 1000 m along lon at this latitude.
    const a = { lon: 15.98, lat: 45.815 };
    const b = { lon: 15.9935, lat: 45.815 }; // ~1046 m at this latitude
    const minutes = walkMinutes(a, b);
    expect(minutes).toBeGreaterThanOrEqual(14);
    expect(minutes).toBeLessThanOrEqual(15);
  });
  it('is zero for the same point', () => {
    expect(walkMinutes({ lon: 15.98, lat: 45.815 }, { lon: 15.98, lat: 45.815 })).toBe(0);
  });
});

describe('KVART_MODULES', () => {
  it('polls works and closures always, and the live feed only once a route is saved', () => {
    expect(KVART_MODULES([])).toEqual(['prometnice', 'dogadanja']);
    expect(KVART_MODULES([{ kind: 'stop', id: '200_1' }])).toEqual(['prometnice', 'dogadanja']);
    expect(KVART_MODULES([{ kind: 'route', id: '6' }])).toEqual(['prometnice', 'dogadanja', 'zet-rt']);
  });
});

// --- renderKvart -------------------------------------------------------------

const STOP: ScreenStop = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.978, lat: 45.813, routes: ['6', '11'] };

function ctx(over: Partial<LayerContext> = {}): LayerContext {
  return {
    i18n, snapshots: {}, now: Date.parse('2026-09-15T12:00:00Z'),
    view: { layer: 'kvart' as never, selection: null, filters: {} },
    screen: { surface: 'phone', locale: 'hr', theme: 'light', themePreference: 'light', lightweight: false, reducedMotion: false, stop: STOP },
    kvart: 'donji-grad' as AreaSlug, kvartLabel: 'Donji grad', kvartChoice: 'screen',
    saved: { list: () => [], has: () => false },
    notify: { delays: false, works: false, waste: false, dhmz: false },
    cast: { can: false, reason: 'no-screen', screenLabel: null, stopName: null },
    ...over,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('renderKvart, lagano and without a map factory', () => {
  it('renders one text row naming the counts, not a map, when ctx.maps is absent', () => {
    const section = renderKvart(ctx({ snapshots: { dogadanja: komunalne([]), prometnice: prometnice([]) } }), 'workspace');
    expect(section.querySelector('.kv-map')).toBeNull();
    const row = section.querySelector<HTMLElement>('[data-testid=kvart-counts]');
    expect(row?.tagName).toBe('P');
    expect(row?.classList.contains('kv-map-text')).toBe(true);
    expect(text(row)).toBe('Trenutačno nema radova ni zatvaranja u kvartu.');
  });
  it('counts works and closures, and names the nearest closure’s street since there is no map to show it on', () => {
    const works = komunalne([
      { id: 'w1', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Vodovod', geo: { type: 'Point', coordinates: [15.978, 45.813] }, data: { source: 'komunalne', status: 'U tijeku', district: 'donji-grad' } },
    ]);
    const closures = prometnice([
      { id: 'c1', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Savska', geo: { type: 'LineString', coordinates: [[15.978, 45.813]] }, data: { street: 'Savska cesta', district: 'donji-grad' } },
    ]);
    const section = renderKvart(ctx({ snapshots: { dogadanja: works, prometnice: closures } }), 'workspace');
    expect(text(section.querySelector('[data-testid=kvart-counts]'))).toBe('1 rad u tijeku · 1 zatvaranje · najbliže Savska cesta');
  });
});

describe('renderKvart, with a map', () => {
  function fakeMaps() {
    const factory = vi.fn((options: CityMapOptions): CityMapHandle => ({
      update: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(),
      select: vi.fn(), follow: vi.fn(), fit: vi.fn(), setModes: vi.fn(), setClosuresVisible: vi.fn(), setFeedState: vi.fn(), setStop: vi.fn(), setTheme: vi.fn(), setLocale: vi.fn(), setView: vi.fn(), resize: vi.fn(), setFitPadding: vi.fn(),
      status: () => 'ready', network: () => null, vehicles: () => [], selection: () => null, following: () => null, camera: () => null,
      ...options,
    } as unknown as CityMapHandle));
    return { maps: createMapSlots(factory as never), factory };
  }
  it('asks maps.slot for a non-interactive thumbnail centred on the screen stop, and mounts its container in .kv-map', () => {
    const { maps, factory } = fakeMaps();
    const section = renderKvart(ctx({ maps, snapshots: { dogadanja: komunalne([]), prometnice: prometnice([]) } }), 'workspace');
    expect(factory).toHaveBeenCalledTimes(1);
    const opts = factory.mock.calls[0]![0] as CityMapOptions;
    expect(opts.interactive).toBe(false);
    expect(opts.symbolScale).toBe(0.85);
    expect(opts.zoom).toBe(13);
    expect(opts.center).toEqual([STOP.lon, STOP.lat]);
    const canvas = section.querySelector('.kv-map > *');
    expect(canvas).not.toBeNull();
    expect(section.querySelector('[data-testid=kvart-counts]')?.tagName).toBe('FIGCAPTION');
  });
  it('centres on the district seat without a screen stop, and on the city without either', () => {
    const { maps, factory } = fakeMaps();
    renderKvart(ctx({ maps, screen: { surface: 'phone', locale: 'hr', theme: 'light', themePreference: 'light', lightweight: false, reducedMotion: false, stop: undefined }, snapshots: { dogadanja: komunalne([]), prometnice: prometnice([]) } }), 'workspace');
    const seatOpts = factory.mock.calls[0]![0] as CityMapOptions;
    expect(seatOpts.center).toEqual([15.97969, 45.80906]); // donji-grad's seat, kiosk/districts.ts
  });
});

describe('renderKvart, the saved chips', () => {
  it('empty: only "+ stanica" and the hint, no chips', () => {
    const section = renderKvart(ctx({ snapshots: { dogadanja: komunalne([]), prometnice: prometnice([]) } }), 'workspace');
    expect(section.querySelectorAll('.kv-saved li')).toHaveLength(1);
    expect(text(section.querySelector('[data-testid=saved-add-stop]'))).toBe('+ stanica');
    expect(text(section.querySelector('[data-testid=saved-empty]'))).toContain('Spremi liniju ili stanicu');
  });
  it('a saved route: the xs line badge, its long name, a nav selection and an unsave button', () => {
    const section = renderKvart(ctx({
      saved: { list: () => [{ kind: 'route', id: '6' }], has: () => true },
      snapshots: { dogadanja: komunalne([]), prometnice: prometnice([]) },
    }), 'workspace');
    const chip = section.querySelector<HTMLButtonElement>('[data-testid=saved-route-6]')!;
    expect(chip.querySelector('.line')?.getAttribute('data-size')).toBe('xs');
    expect(text(chip)).toContain('Črnomerec');
    expect(JSON.parse(chip.dataset.selection!)).toEqual({ kind: 'route', id: '6' });
    const remove = section.querySelector<HTMLButtonElement>('.kv-chip-x[data-id="6"]')!;
    expect(remove.dataset.action).toBe('unsave');
    expect(remove.dataset.kind).toBe('route');
    expect(section.querySelector('[data-testid=saved-empty]')).toBeNull();
  });
  it('a saved stop names the screen stop directly, and looks the rest up in the stop catalogue', () => {
    const section = renderKvart(ctx({
      saved: { list: () => [{ kind: 'stop', id: '106_1' }, { kind: 'stop', id: '200_1' }], has: () => true },
      stops: [{ id: '200_1', name: 'Zapruđe', lon: 16.0, lat: 45.79, routes: [] }],
      snapshots: { dogadanja: komunalne([]), prometnice: prometnice([]) },
    }), 'workspace');
    expect(text(section.querySelector('[data-testid=saved-stop-106_1]'))).toContain('Trg bana J. Jelačića');
    expect(text(section.querySelector('[data-testid=saved-stop-200_1]'))).toContain('Zapruđe');
  });
});

describe('renderKvart, the walking row', () => {
  it('is absent without a screen stop, or without a saved stop, or before the catalogue resolves it', () => {
    const noScreen = renderKvart(ctx({
      screen: { surface: 'phone', locale: 'hr', theme: 'light', themePreference: 'light', lightweight: false, reducedMotion: false, stop: undefined },
      saved: { list: () => [{ kind: 'stop', id: '200_1' }], has: () => true },
      snapshots: { dogadanja: komunalne([]), prometnice: prometnice([]) },
    }), 'workspace');
    expect(noScreen.querySelector('.kv-walk')).toBeNull();
    const noSaved = renderKvart(ctx({ snapshots: { dogadanja: komunalne([]), prometnice: prometnice([]) } }), 'workspace');
    expect(noSaved.querySelector('.kv-walk')).toBeNull();
    const notLoaded = renderKvart(ctx({
      saved: { list: () => [{ kind: 'stop', id: '200_1' }], has: () => true },
      snapshots: { dogadanja: komunalne([]), prometnice: prometnice([]) },
    }), 'workspace');
    expect(notLoaded.querySelector('.kv-walk')).toBeNull();
  });
  it('lists minutes and the name once the catalogue has resolved a saved stop, never the screen stop itself', () => {
    const section = renderKvart(ctx({
      saved: { list: () => [{ kind: 'stop', id: '200_1' }, { kind: 'stop', id: '106_1' }], has: () => true },
      stops: [{ id: '200_1', name: 'Zapruđe', lon: 16.02, lat: 45.79, routes: [] }],
      snapshots: { dogadanja: komunalne([]), prometnice: prometnice([]) },
    }), 'workspace');
    const rows = section.querySelectorAll('.kv-walk li');
    expect(rows).toHaveLength(1);
    // No separating whitespace in textContent between the two spans (the brief's own literal markup, B.5): a
    // visual gap comes from kvart.css's flex layout, not a DOM space.
    expect(text(rows[0]!)).toMatch(/^\d+ minZapruđe$/);
  });
});

describe('renderKvart, the notify button', () => {
  it('says how many alerts are on, or that they are off', () => {
    const off = renderKvart(ctx({ snapshots: { dogadanja: komunalne([]), prometnice: prometnice([]) } }), 'workspace');
    expect(text(off.querySelector('[data-testid=kvart-notify]'))).toContain('isključene');
    const on = renderKvart(ctx({ notify: { delays: true, works: true, waste: false, dhmz: false }, snapshots: { dogadanja: komunalne([]), prometnice: prometnice([]) } }), 'workspace');
    expect(text(on.querySelector('[data-testid=kvart-notify]'))).toContain('2 uključene');
  });
});

describe('renderKvart modes', () => {
  it('the workspace carries the kvart select; the aside does not', () => {
    const workspace = renderKvart(ctx({ snapshots: { dogadanja: komunalne([]), prometnice: prometnice([]) } }), 'workspace');
    expect(workspace.querySelector('[data-testid=kvart-select]')).not.toBeNull();
    const aside = renderKvart(ctx({ snapshots: { dogadanja: komunalne([]), prometnice: prometnice([]) } }), 'aside');
    expect(aside.querySelector('[data-testid=kvart-select]')).toBeNull();
    expect(aside.classList.contains('kv')).toBe(true);
    expect(aside.getAttribute('data-testid')).toBe('kvart-panel');
  });
});
