// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
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
      select: vi.fn(), follow: vi.fn(), fit: vi.fn(), setModes: vi.fn(), setClosuresVisible: vi.fn(), setFeedState: vi.fn(), setStop: vi.fn(), setTheme: vi.fn(), setLocale: vi.fn(), setView: vi.fn(), resize: vi.fn(),
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

afterEach(() => { document.body.replaceChildren(); });

describe('the transport workspace', () => {
  it('renders one persistent workspace: the overview lists the routes moving now from the map\u2019s own estimate, trams first, with the closures, ZET\u2019s notices and the honesty note', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps });
    render(context);
    const ws = q<HTMLElement>('[data-testid=transport-workspace]');
    expect(text(q('[data-testid=transport-total]'))).toBe('3 vozila u pokretu');
    expect([...document.querySelectorAll('[data-testid=running-routes] .t-badge')].map(text)).toEqual(['6', '11']);
    expect(text(q('[data-testid=running-routes]'))).toContain('kasni 2 min');
    expect(text(q('[data-testid=transport-closures]'))).toContain('Grada Vukovara');
    expect(text(q('[data-testid=transport-notices]'))).toContain('Izmjena trase linije 6');
    expect(text(q('[data-testid=transport-note]'))).toContain('ZET ne objavljuje smjer ni brzinu');
    expect(last().options).toMatchObject({ interactive: true, symbolScale: 1, closures: true });
    expect([...(last().options.modes ?? [])]).toEqual([0]);
    // Buses join with one toggle; the list and the map follow, and the toggle survives the next poll.
    q<HTMLButtonElement>('[data-action=toggle-mode][data-mode="3"]').click();
    expect(last().setModes).toHaveBeenLastCalledWith(null);
    expect(text(q('[data-testid=transport-total]'))).toBe('4 vozila u pokretu');
    render(context);
    expect(q('[data-testid=transport-workspace]')).toBe(ws);
    expect(q<HTMLButtonElement>('[data-action=toggle-mode][data-mode="3"]').getAttribute('aria-pressed')).toBe('true');
    expect(last().update).toHaveBeenCalledTimes(1); // the second render fed the same live map, never a second one
  });
});

describe('the sheet', () => {
  it('shows what runs now from the model\u2019s vehicles (trams until buses are toggled on), the screen\u2019s stop, the closures and ZET notices, and the honesty note once', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps, stop: { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.977, lat: 45.813, routes: ['6', '11'] } });
    render(context);
    expect(last().options).toMatchObject({ interactive: true, symbolScale: 1, closures: true, locale: 'hr', theme: 'light' });
    expect(last().options.stop).toMatchObject({ id: '106_1' });
    expect(text(q('[data-testid=transport-total]'))).toBe('3 vozila u pokretu');
    expect(text(q('[data-testid=transport-peek]'))).toBe('3 vozila u pokretu');
    q<HTMLButtonElement>('[data-action=toggle-mode][data-mode="3"]').click();
    expect(text(q('[data-testid=transport-total]'))).toBe('4 vozila u pokretu');
    const rows = [...document.querySelectorAll('[data-testid=running-routes] .t-row')].map(text);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('2 vozila u pokretu · kasni 2 min');
    expect(rows[1]).toContain('1 vozilo u pokretu · rani 1 min');
    expect(rows[2]).toContain('109');
    expect(text(q('[data-testid=screen-stop]'))).toContain('Trg bana J. Jelačića');
    expect(text(q('[data-testid=transport-closures]'))).toContain('Grada Vukovara');
    expect(text(q('[data-testid=transport-closures]'))).toContain('radovi · jedan smjer');
    expect(text(q('[data-testid=transport-notices]'))).toContain('Izmjena trase linije 6');
    expect(document.querySelectorAll('[data-testid=transport-note]')).toHaveLength(1);
    expect(q<HTMLElement>('[data-testid=map-status]').hidden).toBe(true);
    expect(q<HTMLElement>('[data-testid=transport-workspace]').dataset.sheet).toBe('peek');
  });

  it('before the model has placed anything the reports are listed by route alone, with no position of any kind', () => {
    const { maps } = fakeMaps({ status: 'loading', vehicles: [] });
    const { context } = ctx({ maps });
    render(context);
    expect(text(q('[data-testid=transport-total]'))).toBe('3 vozila u pokretu'); // the three tram reports; the bus waits for its toggle
    expect(text(q('[data-testid=map-status]'))).toBe('Karta se učitava…');
    expect(text(q('[data-testid=transport-peek]'))).toBe('3 vozila u pokretu');
  });
});

describe('search and selection', () => {
  it('a number finds the route: arrows and Enter open it, the map selects it with a fit, the paired screen hears the public route, and the detail lists its vehicles with their facing and its stops in travel order; a name finds the artefact\u2019s stops', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context, navigate } = ctx({ maps });
    render(context);
    const input = q<HTMLInputElement>('[data-testid=transport-search]');
    input.value = '6';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const options = [...document.querySelectorAll<HTMLElement>('[role=option]')];
    expect(options[0]).toMatchObject({ dataset: { action: 'select-route', id: '6' } });
    expect(input.getAttribute('aria-expanded')).toBe('true');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]!.id);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(last().select).toHaveBeenLastCalledWith({ kind: 'route', id: '6' }, { fit: true });
    expect(navigate).toHaveBeenLastCalledWith('u-pokretu', { kind: 'route', id: '6' });
    expect(input.value).toBe('');
    expect(q<HTMLElement>('[data-testid=transport-workspace]').dataset.sheet).toBe('open');
    expect(text(q('[data-testid=route-title]'))).toContain('6');
    expect(document.querySelectorAll('[data-testid=route-vehicles] li')).toHaveLength(2);
    expect(text(q('[data-testid=route-vehicles]'))).toContain('smjer istok');
    expect(text(q('[data-testid=route-vehicles]'))).toContain('smjer nepoznat');
    expect(document.querySelectorAll('[data-testid=route-stops] li').length).toBeGreaterThan(15);
    expect(text(q('[data-testid=route-stops] li'))).toBe('Črnomerec');
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
  it('a tap on the map opens the vehicle with its facing and a follow action; following relays the vehicle by public item key; a move the person makes ends the follow', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context, navigate } = ctx({ maps });
    render(context);
    last().options.onSelect!({ kind: 'vehicle', id: 'vehicle:1' });
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

  it('a stale feed holds the map\u2019s vehicles and says so; a kiosk gets a still map, bigger symbols, no controls and an open sheet', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const stale = { ...ZET, status: 'stale' as const, sourceUpdatedAt: new Date(NOW - 400_000).toISOString() };
    render(ctx({ maps, snapshots: { 'zet-rt': stale, prometnice: PROMETNICE } }).context);
    expect(last().setFeedState).toHaveBeenLastCalledWith('stale');
    expect(text(q('[data-testid=transport-source-status]'))).toContain('izvor trenutačno ne odgovara');
    const kiosk = fakeMaps({ vehicles: VEHICLES, net: NET });
    render(ctx({ maps: kiosk.maps, kiosk: true }).context);
    expect(kiosk.last().options).toMatchObject({ interactive: false, symbolScale: 1.35 });
    expect(q<HTMLElement>('[data-testid=transport-toolbar]').hidden).toBe(true);
    expect(q<HTMLElement>('[data-testid=transport-workspace]').dataset).toMatchObject({ kiosk: 'true', sheet: 'open' });
    expect(q<HTMLElement>('[data-testid=map-full-toggle]').hidden).toBe(true);
  });

  it('lists the module\u2019s own per-route delays worst first, every row present with the tail folded behind one button, in words and never as an arrival', () => {
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
