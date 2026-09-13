// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { publicItemKey, type PublicSelection } from '../../app/src/core/contracts';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { renderLayer } from '../../app/src/layers';
import type { LayerContext } from '../../app/src/layers/types';
import type { CityMapHandle, CityMapOptions, MapSelection, MapStatus, VehicleInfo } from '../../app/src/map/city-map';
import { createMapSlots, type MapSlots } from '../../app/src/map/map-slots';
import { decodeNetwork, type Network } from '../../app/src/motion/network';
import { reconcile } from '../../app/src/ui/dom/reconcile';
import { text } from './helpers';

const NOW = Date.parse('2026-09-11T12:32:00Z');
const NET = decodeNetwork(JSON.parse(readFileSync(resolve(import.meta.dirname, '../../app/public/data/zet-network.json'), 'utf8')));
const base = (module: ModuleSnapshot['module'], items: ModuleSnapshot['items']): ModuleSnapshot => ({
  module, tier: 'session', status: 'live', fetchedAt: new Date(NOW - 60_000).toISOString(),
  attribution: { text: `Izvor: ${module}`, url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' }, items,
});
const pin = (n: number, routeId: string, type: number, lon: number, lat: number): ModuleSnapshot['items'][number] => ({
  id: `vehicle:${n}`, module: 'zet-rt', kind: 'vehicle', tier: 'session', title: routeId, geo: { type: 'Point', coordinates: [lon, lat] }, data: { routeId, routeShortName: routeId, routeType: type },
});
const ZET = base('zet-rt', [
  pin(1, '6', 0, 15.97, 45.81), pin(2, '6', 0, 15.98, 45.82), pin(3, '11', 0, 15.99, 45.8), pin(4, '109', 3, 15.95, 45.79),
  { id: 'route:6', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', data: { routeId: '6', medianDelaySeconds: 90, vehicles: 2 } },
  { id: 'route:11', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '11', data: { routeId: '11', medianDelaySeconds: -30, vehicles: 1 } },
]);
const PROMETNICE = base('prometnice', [
  { id: 'c1', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Grada Vukovara', until: '2026-09-11T22:00:00Z', geo: { type: 'LineString', coordinates: [[15.959, 45.799], [15.957, 45.799]] }, data: { subtype: 'ROAD_CLOSED_CONSTRUCTION', direction: 'ONE_DIRECTION' } },
]);
const DOGADANJA = base('dogadanja', [
  { id: 'z1', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Izmjena trase linije 6', at: '2026-09-11T08:00:00Z', link: 'https://zet.hr/promet/1', data: { source: 'zet-promet' } },
]);

/** The model's vehicles as the fake map answers them: the 6 at two places, one with a heading, the 11 and the bus 109. */
const vehicle = (id: string, routeId: string, type: number, over: Partial<VehicleInfo> = {}): VehicleInfo => ({
  id, routeId, short: routeId, kind: type === 0 ? 'tram' : 'bus', type, lon: 15.97, lat: 45.81, bearing: null, confidence: 0.6, held: false, onShape: null, ...over,
});
const VEHICLES = [vehicle('vehicle:1', '6', 0, { bearing: 90, confidence: 0.9 }), vehicle('vehicle:2', '6', 0, { held: true }), vehicle('vehicle:3', '11', 0), vehicle('vehicle:4', '109', 3)];

interface FakeState { status?: MapStatus; net?: Network | null; vehicles?: VehicleInfo[] }
interface FakeHandle extends CityMapHandle { options: CityMapOptions; set(state: FakeState): void }

/** A map stand-in: records its options, answers the vehicles the test sets, and lets the test fire the callbacks the workspace passed. */
function fakeMaps(initial: FakeState = {}) {
  const made: FakeHandle[] = [];
  const factory = vi.fn((options: CityMapOptions): CityMapHandle => {
    let status: MapStatus = initial.status ?? 'ready';
    let net: Network | null = initial.net ?? null;
    let vehicles: VehicleInfo[] = initial.vehicles ?? [];
    const handle: FakeHandle = {
      options,
      update: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(),
      select: vi.fn(), follow: vi.fn(), fit: vi.fn(), setModes: vi.fn(), setClosuresVisible: vi.fn(), setFeedState: vi.fn(), setStop: vi.fn(), setTheme: vi.fn(), setLocale: vi.fn(), setView: vi.fn(), resize: vi.fn(), setFitPadding: vi.fn(),
      status: () => status, network: () => net, vehicles: () => vehicles, selection: () => null, following: () => null, camera: () => null,
      set(state) {
        if (state.status) status = state.status;
        if (state.net !== undefined) net = state.net;
        if (state.vehicles) vehicles = state.vehicles;
      },
    };
    made.push(handle);
    return handle;
  });
  return { maps: createMapSlots(factory as never), factory, made, last: () => made[made.length - 1]! };
}

interface CtxOptions {
  maps?: MapSlots;
  selection?: PublicSelection | null;
  kiosk?: boolean;
  lightweight?: boolean;
  snapshots?: Partial<Record<ModuleSnapshot['module'], ModuleSnapshot>>;
  locale?: 'hr' | 'en';
  stop?: { id: string; name: string; lon: number; lat: number; routes: string[] };
}

function ctx(o: CtxOptions = {}) {
  const navigate = vi.fn();
  const toggle = vi.fn();
  const context: LayerContext = {
    i18n: createDefaultI18n(o.locale ?? 'hr'),
    snapshots: o.snapshots ?? { 'zet-rt': ZET, prometnice: PROMETNICE, dogadanja: DOGADANJA },
    now: NOW,
    maps: o.maps,
    kiosk: o.kiosk,
    lightweight: o.lightweight,
    view: { layer: 'u-pokretu', selection: o.selection ?? null, filters: {} },
    navigate,
    mapView: o.kiosk ? undefined : { full: false, toggle },
    screen: { surface: 'phone', locale: o.locale ?? 'hr', theme: 'light', themePreference: 'light', lightweight: false, reducedMotion: false, stop: o.stop },
  };
  return { context, navigate, toggle };
}

/** Renders as the page does: a fresh section each poll, the old one gone, the slots swept. */
function render(c: LayerContext): HTMLElement {
  const section = renderLayer('u-pokretu', c);
  document.body.replaceChildren(section);
  c.maps?.sweep();
  return section;
}
const q = <T extends Element>(selector: string): T => document.body.querySelector<T>(selector)!;
const all = <T extends Element>(selector: string): T[] => [...document.body.querySelectorAll<T>(selector)];
const visible = (selector: string): HTMLElement[] => all<HTMLElement>(selector).filter((el) => !el.hidden);
const pressed = (selector: string): string | null => q(selector).getAttribute('aria-pressed');
const spy = (fn: unknown): Mock => fn as Mock;
/** Where a mock's latest call sits in the run's global call sequence (vitest's invocationCallOrder); -1 when it was never called. */
const lastCall = (fn: unknown): number => spy(fn).mock.invocationCallOrder.at(-1) ?? -1;

/** The workspace reads two media queries itself (the 60rem desk, the landscape phone); the portrait phone is the default here. */
function fakeMedia(o: { wide?: boolean; landscape?: boolean } = {}): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('60rem') ? Boolean(o.wide) : query.includes('landscape') ? Boolean(o.landscape) : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

beforeEach(() => fakeMedia());
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('the transport workspace', () => {
  it('renders one persistent workspace: the overview lists the routes moving now from the map’s own estimate, trams then buses, both on by default, with the closures, ZET’s notices and the honesty note', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps });
    render(context);
    const ws = q<HTMLElement>('[data-testid=transport-workspace]');
    expect(text(q('[data-testid=transport-total]'))).toBe('4 vozila u pokretu');
    expect(all('[data-testid=running-routes] .t-badge').map(text)).toEqual(['6', '11', '109']);
    expect(all('[data-testid=running-routes] .line[data-size="m"]').map((b) => b.getAttribute('data-kind'))).toEqual(['tram', 'tram', 'bus']);
    expect(all<HTMLElement>('[data-testid=running-routes] button').map((b) => b.id)).toEqual(['t-row-route-6', 't-row-route-11', 't-row-route-109']);
    expect(text(q('[data-testid=running-routes]'))).toContain('kasni 2 min');
    expect(text(q('[data-testid=transport-closures]'))).toContain('Grada Vukovara');
    expect(text(q('[data-testid=transport-notices]'))).toContain('Izmjena trase linije 6');
    expect(text(q('[data-testid=transport-note]'))).toContain('ZET ne objavljuje smjer ni brzinu');
    expect(last().options).toMatchObject({ interactive: true, symbolScale: 1, closures: true, attributionCompact: true });
    expect(last().options.cooperative).toBeUndefined();
    expect(last().options.modes ?? null).toBeNull(); // every mode on: the map draws every type
    expect(pressed('[data-action=toggle-mode][data-mode="0"]')).toBe('true');
    expect(pressed('[data-action=toggle-mode][data-mode="3"]')).toBe('true');
    // Buses leave with one toggle; the list and the map follow, and the toggle survives the next poll.
    q<HTMLButtonElement>('[data-action=toggle-mode][data-mode="3"]').click();
    expect(last().setModes).toHaveBeenLastCalledWith(new Set([0]));
    expect(text(q('[data-testid=transport-total]'))).toBe('3 vozila u pokretu');
    expect(all('[data-testid=running-routes] .t-badge').map(text)).toEqual(['6', '11']);
    render(context);
    expect(q('[data-testid=transport-workspace]')).toBe(ws);
    expect(pressed('[data-action=toggle-mode][data-mode="3"]')).toBe('false');
    expect(last().update).toHaveBeenCalledTimes(1); // the second render fed the same live map, never a second one
  });
});

describe('the sheet', () => {
  it('peeks with this stop’s lines and the two counts; the body lists what runs now, the screen’s stop, the closures and ZET notices under sentence-case heads, and the honesty note once', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps, stop: { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.977, lat: 45.813, routes: ['6', '11'] } });
    render(context);
    expect(last().options).toMatchObject({ interactive: true, symbolScale: 1, closures: true, locale: 'hr', theme: 'light' });
    expect(last().options.stop).toMatchObject({ id: '106_1' });
    expect(text(q('[data-testid=transport-total]'))).toBe('4 vozila u pokretu');
    const peek = q<HTMLElement>('[data-testid=transport-peek]');
    expect(all('[data-testid=transport-peek] .line[data-size="s"]').map(text)).toEqual(['6', '11', '12', '13']); // the artefact's ten lines at Jelačić square
    expect(text(peek.querySelector('.t-peek-more'))).toBe('+6');
    expect(text(peek.querySelector('.t-peek-count'))).toBe('4 vozila u pokretu · 1 zatvaranje');
    expect(peek.querySelector('button')).toBeNull();
    const rows = all('[data-testid=running-routes] .t-row').map(text);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('2 vozila u pokretu · kasni 2 min');
    expect(rows[1]).toContain('1 vozilo u pokretu · rani 1 min');
    expect(rows[2]).toContain('109');
    q<HTMLButtonElement>('[data-action=toggle-mode][data-mode="3"]').click();
    expect(text(q('[data-testid=transport-total]'))).toBe('3 vozila u pokretu');
    expect(all('[data-testid=running-routes] .t-row')).toHaveLength(2);
    expect(text(q('[data-testid=screen-stop]'))).toContain('Trg bana J. Jelačića');
    expect(q<HTMLElement>('[data-testid=screen-stop] button').id).toBe('t-row-stop-106_1');
    expect(text(q('[data-testid=transport-closures]'))).toContain('Grada Vukovara');
    expect(text(q('[data-testid=transport-closures]'))).toContain('radovi · jedan smjer');
    expect(q<HTMLElement>('[data-testid=transport-closures] button').id).toBe('t-row-closure-c1');
    expect(text(q('[data-testid=transport-notices]'))).toContain('Izmjena trase linije 6');
    expect(document.querySelectorAll('[data-testid=transport-note]')).toHaveLength(1);
    expect(q('[data-testid=transport-detail] [data-testid=transport-note]')).not.toBeNull(); // at the body's foot, not beside the map
    // Section heads in sentence case at head size; the uppercase kicker is gone from the sheet.
    expect(all('[data-testid=transport-detail] .t-head').map(text)).toEqual(['Linije u pokretu', 'Stanica ovog zaslona', 'Kašnjenja po linijama', 'Zatvorene prometnice', 'Obavijesti ZET-a']);
    expect(document.querySelector('.t-subtitle')).toBeNull();
    expect(q<HTMLElement>('[data-testid=map-status]').hidden).toBe(true);
    expect(q<HTMLElement>('[data-testid=transport-workspace]').dataset.sheet).toBe('half');
  });

  it('before the model has placed anything the reports are listed by route alone, with no position of any kind; the peek shows the busiest lines', () => {
    const { maps } = fakeMaps({ status: 'loading', vehicles: [] });
    const { context } = ctx({ maps });
    render(context);
    expect(text(q('[data-testid=transport-total]'))).toBe('4 vozila u pokretu'); // the three tram reports and the bus
    expect(text(q('[data-testid=map-status]'))).toBe('Karta se učitava…');
    expect(all('[data-testid=transport-peek] .line').map(text)).toEqual(['6', '11', '109']);
    expect(q('[data-testid=transport-peek] .t-peek-more')).toBeNull();
    expect(text(q('[data-testid=transport-peek] .t-peek-count'))).toBe('4 vozila u pokretu · 1 zatvaranje');
  });

  it('folds long lists in place: eight running routes, four closures, twelve stops, three notices, each behind one labelled button that keeps its focus', () => {
    const many = Array.from({ length: 11 }, (_, i) => vehicle(`vehicle:r${i}`, String(i + 1), 0));
    const closures = Array.from({ length: 6 }, (_, i) => ({ ...PROMETNICE.items[0]!, id: `c${i}`, title: `Ulica ${i}` }));
    const notices = Array.from({ length: 5 }, (_, i) => ({ ...DOGADANJA.items[0]!, id: `z${i}`, title: `Obavijest ${i}` }));
    const { maps } = fakeMaps({ vehicles: many, net: NET });
    render(ctx({ maps, snapshots: { 'zet-rt': ZET, prometnice: { ...PROMETNICE, items: closures }, dogadanja: { ...DOGADANJA, items: notices } } }).context);
    expect(all('[data-testid=running-routes] li')).toHaveLength(11);
    expect(visible('[data-testid=running-routes] li')).toHaveLength(8);
    const moreRoutes = q<HTMLButtonElement>('[data-action=toggle-fold][data-fold=routes]');
    expect(text(moreRoutes)).toBe('još 3 linije');
    moreRoutes.focus();
    moreRoutes.click();
    expect(visible('[data-testid=running-routes] li')).toHaveLength(11);
    expect(text(q('[data-action=toggle-fold][data-fold=routes]'))).toBe('Skupi');
    expect(document.activeElement).toBe(q('[data-action=toggle-fold][data-fold=routes]'));
    expect(visible('[data-testid=transport-closures] li')).toHaveLength(4);
    const moreClosures = q<HTMLButtonElement>('[data-action=toggle-fold][data-fold=closures]');
    expect(text(moreClosures)).toBe('sve zatvaranja (6)');
    moreClosures.click();
    expect(visible('[data-testid=transport-closures] li')).toHaveLength(6);
    expect(all('[data-testid=transport-notices] li')).toHaveLength(3);
  });
});

describe('search and selection', () => {
  it('a number finds the route: arrows and Enter open it, the map selects it with a fit, the paired screen hears the public route, and the detail lists its vehicles with their facing and its stops in travel order (twelve, then all); a name finds the artefact’s stops', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context, navigate } = ctx({ maps });
    render(context);
    const input = q<HTMLInputElement>('[data-testid=transport-search]');
    input.value = '6';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const options = all<HTMLElement>('[role=option]');
    expect(options[0]).toMatchObject({ dataset: { action: 'select-route', id: '6' } });
    expect(input.getAttribute('aria-expanded')).toBe('true');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]!.id);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(last().select).toHaveBeenLastCalledWith({ kind: 'route', id: '6' }, { fit: true });
    expect(navigate).toHaveBeenLastCalledWith('u-pokretu', { kind: 'route', id: '6' });
    expect(input.value).toBe('');
    expect(q<HTMLElement>('[data-testid=transport-workspace]').dataset.sheet).toBe('half');
    expect(text(q('[data-testid=route-title]'))).toContain('6');
    expect(q('[data-testid=route-title] .line[data-size="l"][data-kind="tram"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-testid=route-vehicles] li')).toHaveLength(2);
    expect(q<HTMLElement>('[data-testid=route-vehicles] button').id).toBe('t-row-vehicle-vehicle_1');
    expect(text(q('[data-testid=route-vehicles]'))).toContain('smjer istok');
    expect(text(q('[data-testid=route-vehicles]'))).toContain('smjer nepoznat');
    const stops = all<HTMLElement>('[data-testid=route-stops] li');
    expect(stops.length).toBeGreaterThan(15);
    expect(visible('[data-testid=route-stops] li')).toHaveLength(12);
    expect(text(q('[data-testid=route-stops] li'))).toBe('Črnomerec');
    expect(q<HTMLElement>('[data-testid=route-stops] button').id).toMatch(/^t-row-stop-/);
    const allStops = q<HTMLButtonElement>('[data-action=toggle-fold][data-fold=stops]');
    expect(text(allStops)).toBe(`sve stanice (${stops.length})`);
    allStops.click();
    expect(visible('[data-testid=route-stops] li')).toHaveLength(stops.length);
    // A stop by name, chosen with a tap on its row.
    input.value = 'crnomerec';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const stopOption = q<HTMLElement>('[role=option][data-action=select-stop]');
    expect(text(stopOption)).toContain('Črnomerec');
    stopOption.click();
    expect(last().select).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'stop', id: stopOption.dataset.id }), { fit: true });
    expect(navigate).toHaveBeenLastCalledWith('u-pokretu', { kind: 'stop', id: stopOption.dataset.id });
    expect(text(q('[data-testid=stop-title]'))).toBe('Črnomerec');
    expect(text(q('[data-testid=stop-routes]'))).toContain('6');
    // Clearing tells the map and the paired screen once, and the overview returns.
    q<HTMLButtonElement>('#t-clear-selection').click();
    expect(last().select!.mock.lastCall?.[0]).toBeNull();
    expect(navigate).toHaveBeenLastCalledWith('u-pokretu', null);
    expect(q('[data-testid=transport-total]')).not.toBeNull();
  });
});

describe('the map, the paired screen and the feed', () => {
  it('a tap on the map opens the vehicle with its facing and a follow action, raising a peeking sheet to half; following relays the vehicle by public item key; a move the person makes ends the follow', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context, navigate } = ctx({ maps });
    render(context);
    const ws = q<HTMLElement>('[data-testid=transport-workspace]');
    q<HTMLButtonElement>('.t-sheet-toggle').click();
    q<HTMLButtonElement>('.t-sheet-toggle').click();
    expect(ws.dataset.sheet).toBe('peek');
    last().options.onSelect!({ kind: 'vehicle', id: 'vehicle:1' });
    expect(ws.dataset.sheet).toBe('half');
    expect(text(q('[data-testid=vehicle-title]'))).toBe('6Tramvaj 6');
    expect(text(q('[data-testid=vehicle-direction]'))).toBe('smjer istok');
    expect(text(q('[data-testid=transport-peek]'))).toBe('Tramvaj 6 · smjer istok');
    expect(navigate).toHaveBeenLastCalledWith('u-pokretu', { kind: 'item', id: expect.stringMatching(/^[0-9a-f]{16}$/), module: 'zet-rt' });
    q<HTMLButtonElement>('#t-follow').click();
    expect(last().follow).toHaveBeenLastCalledWith('vehicle:1');
    expect(text(q('[data-testid=transport-peek]'))).toContain('Praćenje');
    expect(q('[data-testid=following-note]')).not.toBeNull();
    last().options.onUserMove!({ center: [15.97, 45.81], zoom: 15 });
    expect(q('[data-testid=following-note]')).toBeNull();
    render(context);
    expect(text(q('[data-testid=vehicle-title]'))).toBe('6Tramvaj 6'); // the selection survives the poll
  });

  it('a selection the page navigated to is applied once with a fit: a route by id, a closure by public item key; one that names nothing here yields the overview', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const route = ctx({ maps, selection: { kind: 'route', id: '11' } });
    render(route.context);
    expect(last().select).toHaveBeenLastCalledWith({ kind: 'route', id: '11' }, { fit: true });
    expect(text(q('[data-testid=route-title]'))).toContain('11');
    render(route.context); // the same view again: not re-applied
    expect(last().select).toHaveBeenCalledTimes(1);
    const closure = ctx({ maps, selection: { kind: 'item', id: publicItemKey('prometnice', 'c1'), module: 'prometnice' } });
    render(closure.context);
    expect(last().select).toHaveBeenLastCalledWith({ kind: 'closure', id: 'c1' }, { fit: true });
    expect(text(q('[data-testid=closure-title]'))).toContain('Grada Vukovara');
    const unknown = ctx({ maps, selection: { kind: 'item', id: '0123456789abcdef', module: 'zet-rt' } });
    render(unknown.context);
    expect(last().select).toHaveBeenLastCalledWith(null, { fit: false });
    expect(q('[data-testid=transport-total]')).not.toBeNull();
  });

  it('a stale feed holds the map’s vehicles and says so; a kiosk gets a still map, bigger symbols, trams first, no controls and an open sheet', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const stale = { ...ZET, status: 'stale' as const, sourceUpdatedAt: new Date(NOW - 400_000).toISOString() };
    render(ctx({ maps, snapshots: { 'zet-rt': stale, prometnice: PROMETNICE } }).context);
    expect(last().setFeedState).toHaveBeenLastCalledWith('stale');
    expect(text(q('[data-testid=transport-source-status]'))).toContain('izvor trenutačno ne odgovara');
    const kiosk = fakeMaps({ vehicles: VEHICLES, net: NET });
    render(ctx({ maps: kiosk.maps, kiosk: true }).context);
    expect(kiosk.last().options).toMatchObject({ interactive: false, symbolScale: 1.35, attributionCompact: false });
    expect([...(kiosk.last().options.modes ?? [])]).toEqual([0]); // the board keeps trams first
    expect(q<HTMLElement>('[data-testid=transport-toolbar]').hidden).toBe(true);
    expect(q<HTMLElement>('[data-ref=modes]').hidden).toBe(true);
    expect(q<HTMLElement>('[data-testid=transport-workspace]').dataset).toMatchObject({ kiosk: 'true', sheet: 'open' });
    expect(q<HTMLElement>('[data-testid=map-full-toggle]').hidden).toBe(true);
  });

  it('lists the module’s own per-route delays worst first, every row present with the tail folded behind one button, in words and never as an arrival', () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ id: `route:${i + 1}`, module: 'zet-rt' as const, kind: 'vehicle' as const, tier: 'session' as const, title: String(i + 1), data: { routeId: String(i + 1), medianDelaySeconds: (i + 1) * 40, vehicles: 1 } }));
    const zet = { ...ZET, items: [...ZET.items.filter((i) => !i.id.startsWith('route:')), ...rows] };
    const { maps } = fakeMaps({ vehicles: VEHICLES, net: NET });
    render(ctx({ maps, snapshots: { 'zet-rt': zet, prometnice: PROMETNICE } }).context);
    const block = q<HTMLElement>('#u-pokretu-delays');
    const all = [...block.querySelectorAll<HTMLElement>('[data-testid=delay-row]')];
    expect(all).toHaveLength(11);
    expect(all.filter((li) => !li.hidden)).toHaveLength(8);
    expect(text(all[0]!)).toContain('kasni 7 min'); // 440 s, the worst, first
    expect(text(block)).not.toMatch(/\d+ s\b/);
    const more = q<HTMLButtonElement>('[data-action=toggle-delays]');
    expect(text(more)).toBe('još 3 linije');
    more.click();
    expect([...q<HTMLElement>('#u-pokretu-delays').querySelectorAll<HTMLElement>('[data-testid=delay-row]')].filter((li) => !li.hidden)).toHaveLength(11);
    expect(text(q('[data-action=toggle-delays]'))).toBe('Skupi');
  });
});

describe('detents on the phone stage', () => {
  it('starts at half; the chevron and a tap on the peek row cycle half → open → peek → half; Escape steps down; typing raises a peeking sheet; the map hears the covered height', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context, toggle } = ctx({ maps });
    render(context);
    const ws = q<HTMLElement>('[data-testid=transport-workspace]');
    const covered = (): number => Number.parseFloat(ws.style.getPropertyValue('--sheet-h'));
    expect(ws.dataset.sheet).toBe('half');
    expect(covered()).toBeGreaterThan(0);
    expect(last().options.fitPadding).toEqual({ bottom: covered(), right: 0 });
    const chevron = q<HTMLButtonElement>('.t-sheet-toggle');
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
    expect(chevron.getAttribute('aria-controls')).toBe(q('[data-testid=transport-detail]').id);
    chevron.click();
    expect(ws.dataset.sheet).toBe('open');
    expect(last().setFitPadding).toHaveBeenLastCalledWith({ bottom: covered(), right: 0 });
    chevron.click();
    expect(ws.dataset.sheet).toBe('peek');
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    q<HTMLElement>('[data-testid=transport-peek]').click();
    expect(ws.dataset.sheet).toBe('half');
    ws.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ws.dataset.sheet).toBe('peek');
    const input = q<HTMLInputElement>('[data-testid=transport-search]');
    input.value = '6';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ws.dataset.sheet).toBe('half');
    // "Proširi kartu" collapses to peek and asks the page for the map view; "Skupi kartu" returns to half.
    q<HTMLButtonElement>('[data-testid=map-full-toggle]').click();
    expect(ws.dataset.sheet).toBe('peek');
    expect(toggle).toHaveBeenCalledTimes(1);
    context.mapView = { full: true, toggle };
    render(context);
    expect(ws.dataset.sheet).toBe('peek');
    expect(text(q('[data-testid=map-full-toggle]'))).toBe('Skupi kartu');
    q<HTMLButtonElement>('[data-testid=map-full-toggle]').click();
    expect(ws.dataset.sheet).toBe('half');
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it('the desk has no detents: the board is open, nothing is covered, and the chevron only collapses or restores the board column', () => {
    fakeMedia({ wide: true });
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context, toggle } = ctx({ maps });
    render(context);
    const ws = q<HTMLElement>('[data-testid=transport-workspace]');
    expect(ws.dataset.sheet).toBe('open');
    expect(ws.style.getPropertyValue('--sheet-h')).toBe('');
    expect(last().options).toMatchObject({ attributionCompact: false, fitPadding: { bottom: 0, right: 0 } });
    q<HTMLButtonElement>('.t-sheet-toggle').click();
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(ws.dataset.sheet).toBe('open');
  });

  it('a selection made while the sheet is open brings it to half before the map moves, so the fit is padded for the detent the person will see: a row, "Prikaži na karti", a selection the page navigated to', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps });
    render(context);
    const ws = q<HTMLElement>('[data-testid=transport-workspace]');
    // happy-dom lays nothing out: the stage is given the 740 px of a 390×844 phone, so half is 370 and open 700.
    Object.defineProperty(q<HTMLElement>('.transport-body'), 'clientHeight', { get: () => 740, configurable: true });
    const covered = (): number => Number.parseFloat(ws.style.getPropertyValue('--sheet-h'));
    const half = 370;
    const chevron = (): HTMLButtonElement => q<HTMLButtonElement>('.t-sheet-toggle');
    const handle = last();
    const reset = (): void => { for (const fn of [handle.select, handle.fit, handle.setFitPadding]) spy(fn).mockClear(); };
    chevron().click();
    expect(ws.dataset.sheet).toBe('open');
    expect(covered()).toBe(700);
    reset();
    q<HTMLButtonElement>('#t-row-route-6').click();
    expect(ws.dataset.sheet).toBe('half');
    expect(covered()).toBe(half);
    expect(handle.setFitPadding).toHaveBeenLastCalledWith({ bottom: half, right: 0 });
    expect(handle.select).toHaveBeenLastCalledWith({ kind: 'route', id: '6' }, { fit: true });
    expect(lastCall(handle.setFitPadding)).toBeLessThan(lastCall(handle.select));
    // "Prikaži na karti" pressed with the sheet open: the sheet comes down, then the map fits.
    chevron().click();
    expect(ws.dataset.sheet).toBe('open');
    reset();
    q<HTMLButtonElement>('[data-action=fit-selection]').click();
    expect(ws.dataset.sheet).toBe('half');
    expect(handle.fit).toHaveBeenLastCalledWith('selection');
    expect(handle.setFitPadding).toHaveBeenLastCalledWith({ bottom: half, right: 0 });
    expect(lastCall(handle.setFitPadding)).toBeLessThan(lastCall(handle.fit));
    // A selection the page navigated to (history, a paired screen) applied on a poll while the sheet is open.
    chevron().click();
    expect(ws.dataset.sheet).toBe('open');
    reset();
    context.view = { layer: 'u-pokretu', selection: { kind: 'route', id: '11' }, filters: {} };
    render(context);
    expect(ws.dataset.sheet).toBe('half');
    expect(handle.select).toHaveBeenLastCalledWith({ kind: 'route', id: '11' }, { fit: true });
    expect(handle.setFitPadding).toHaveBeenLastCalledWith({ bottom: half, right: 0 });
    expect(lastCall(handle.setFitPadding)).toBeLessThan(lastCall(handle.select));
    expect(text(q('[data-testid=route-title]'))).toContain('11');
  });

  it('the landscape phone reports half with no drag controller; the column’s covered width reaches the map at the stage’s first layout and on every poll, not only after a rotation', () => {
    fakeMedia({ landscape: true });
    const observers: ResizeObserverCallback[] = [];
    vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { observers.push(callback); } observe(): void {} unobserve(): void {} disconnect(): void {} });
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps });
    render(context);
    const ws = q<HTMLElement>('[data-testid=transport-workspace]');
    expect(ws.dataset.sheet).toBe('half');
    expect(ws.style.getPropertyValue('--sheet-h')).toBe('');
    // The first render happens before the element is in the document (layers/u-pokretu.ts): nothing to measure yet.
    expect(last().options.fitPadding).toEqual({ bottom: 0, right: 0 });
    // 844×390: the stage spans the width and the 45 % column starts at 464.
    const rect = (left: number, right: number): DOMRect => ({ left, right, top: 0, bottom: 286, x: left, y: 0, width: right - left, height: 286, toJSON: () => ({}) });
    q<HTMLElement>('.transport-body').getBoundingClientRect = () => rect(0, 844);
    q<HTMLElement>('.transport-sheet').getBoundingClientRect = () => rect(464, 844);
    expect(observers).toHaveLength(1); // the workspace watches its stage; there is no detent controller in landscape
    for (const observe of observers) observe([], {} as ResizeObserver);
    expect(last().setFitPadding).toHaveBeenLastCalledWith({ bottom: 0, right: 380 });
    spy(last().setFitPadding).mockClear();
    render(context); // the poll: the live element is in the document, so its box is real
    expect(last().setFitPadding).toHaveBeenLastCalledWith({ bottom: 0, right: 380 });
  });
});

describe('one workspace node for the page’s life', () => {
  it('reconciled in place (dashboard.ts through ui/dom/reconcile.ts) a poll never detaches the workspace, so a focused search keeps its focus and text; a host that replaces children gets the same node through the persist slot', () => {
    const { maps } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps });
    const main = document.createElement('main');
    document.body.replaceChildren(main);
    const mount = (): void => {
      const wrapper = document.createElement('div');
      wrapper.appendChild(renderLayer('u-pokretu', context));
      reconcile(main, wrapper);
      maps.sweep();
    };
    mount();
    const root = q<HTMLElement>('[data-testid=transport-workspace]');
    expect(root.id).toMatch(/-root$/);
    expect(main.querySelector('section[data-layer=u-pokretu]')!.hasAttribute('data-reconcile')).toBe(true);
    expect(document.querySelector('kaj-persist')).toBeNull(); // the slot swapped the live element in on first mount
    const input = q<HTMLInputElement>('[data-testid=transport-search]');
    input.focus();
    input.value = 'kva';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const removed: Node[] = [];
    const observer = new MutationObserver((records) => { for (const r of records) removed.push(...r.removedNodes); });
    observer.observe(main, { childList: true, subtree: true });
    mount(); // the poll
    observer.disconnect();
    expect(removed).not.toContain(root);
    expect(q('[data-testid=transport-workspace]')).toBe(root);
    expect(document.querySelectorAll('[data-testid=transport-workspace]')).toHaveLength(1);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('kva');
    expect(document.querySelectorAll('[role=option]').length).toBeGreaterThan(0);
    // A stage that replaces its children: the inserted slot resolves to the very same node.
    main.replaceChildren(renderLayer('u-pokretu', context));
    expect(q('[data-testid=transport-workspace]')).toBe(root);
    expect(document.querySelector('kaj-persist')).toBeNull();
  });
});
