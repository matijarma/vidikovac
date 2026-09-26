// @vitest-environment happy-dom
// The phone's renderers vet third-party text through the boundary, which refuses everything until the policy is installed: load it here as the page's chunks do.
import '../../shared/kiosk/external-text';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { closureWords } from '../../worker/feed/modules/prometnice';
import { publicItemKey, type CastState, type PublicSelection } from '../../app/src/core/contracts';
import { emptyCity } from '../../shared/city/types';
import { createMapModeStore } from '../../app/src/core/map-mode-store';
import type { PlaceContext } from '../../app/src/city/place';
import { FIT_MIN_ZOOM, FRAME_MIN_ZOOM, frameView, markZoomFor } from '../../app/src/map/frame';
import type { SavedRef } from '../../app/src/core/saved-store';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { renderLayer } from '../../app/src/layers';
import type { LayerContext } from '../../app/src/layers/types';
import type { CityMapHandle, CityMapOptions, MapSelection, MapStatus, VehicleInfo } from '../../app/src/map/city-map';
import { createMapSlots, type MapSlots } from '../../app/src/map/map-slots';
import { decodeNetwork, type Network } from '../../shared/motion/network';
import { reconcile } from '../../app/src/ui/dom/reconcile';
import { REFIT_SETTLE_MS } from '../../app/src/ui/canvas';
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

/** The page's "U blizini" list as the dashboard hands it (ctx.nearby): the shared component's markup, fixed here,
 *  and the circle it measured. The workspace only places it. */
const NEARBY_HTML = '<section class="nearby" data-testid="nearby"><h3 class="nearby-head" data-testid="nearby-head">U blizini · 2 km · ~15 min</h3>'
  + '<ol class="nearby-rows" data-testid="nearby-rows"><li class="nearby-row" data-id="dep:t1" data-kind="departure" data-when="2026-09-11T12:36:00.000Z" data-live="1"><span class="nearby-title">6 Sopot</span></li>'
  + '<li class="nearby-row" data-id="always:story" data-kind="always" data-always="1"><span class="nearby-title">Trg bana J. Jelačića</span></li></ol></section>';
const NEARBY: NonNullable<LayerContext['nearby']> = () => ({ html: NEARBY_HTML, pill: '2 km · ~15 min', radiusM: 2000 });
const placeAt = (name: string, lon: number, lat: number): PlaceContext => ({ name, lon, lat, kind: 'nearest', stop: null, departuresStop: null });
const KVATERNIKOV = placeAt('Kvaternikov trg', 15.9936, 45.8149);
const JELACIC = placeAt('Trg bana J. Jelačića', 15.9772, 45.8130);
/** A device store with nothing in it yet, for the map/schema switch. */
const memoryStorage = () => {
  const raw = new Map<string, string>();
  return { raw, storage: { getItem: (key: string) => raw.get(key) ?? null, setItem: (key: string, value: string) => { raw.set(key, value); } } };
};

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
      select: vi.fn(), follow: vi.fn(), fit: vi.fn(), setModes: vi.fn(), setClosuresVisible: vi.fn(), setFeedState: vi.fn(), setStop: vi.fn(), setTheme: vi.fn(), setLocale: vi.fn(), setView: vi.fn(), resize: vi.fn(), setFitPadding: vi.fn(), setLineFocus: vi.fn(), setMarkZoom: vi.fn(),
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
  saved?: readonly SavedRef[];
  cast?: CastState;
  /** The page's nearby list; the fixed NEARBY by default, null for a page that has none. */
  nearby?: LayerContext['nearby'] | null;
  place?: PlaceContext;
  /** The map half of the desk pair (LayerContext.pair). */
  pair?: boolean;
}

function ctx(o: CtxOptions = {}) {
  const navigate = vi.fn();
  const toggle = vi.fn();
  const savedList = o.saved ?? [];
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
    saved: { list: () => savedList, has: (kind, id) => savedList.some((ref) => ref.kind === kind && ref.id === id) },
    cast: o.cast,
    nearby: o.nearby === null ? undefined : o.nearby ?? NEARBY,
    place: o.place,
    pair: o.pair,
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
  it('switches map and schema on the same workspace, persisting only the device preference and preserving search, sheet, selection, follow and the geographic camera', async () => {
    const { MAP_MODE_STORAGE_KEY } = await import('../../app/src/core/map-mode-store');
    const { raw, storage } = memoryStorage();
    const mapMode = createMapModeStore({ storage });
    expect(mapMode.snapshot()).toBe('map');
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context, navigate } = ctx({ maps });
    context.mapMode = mapMode;
    const main = document.createElement('main');
    document.body.replaceChildren(main);
    // The dashboard reconciles its persistent workspace; replacing the whole
    // section in this test would itself blur the focused toggle.
    const paint = (): void => {
      const wrapper = document.createElement('div');
      wrapper.appendChild(renderLayer('u-pokretu', context));
      reconcile(main, wrapper);
      maps.sweep();
    };
    const stop = mapMode.subscribe(paint);
    const workspace = q<HTMLElement>('[data-testid=transport-workspace]');
    const toggle = q<HTMLButtonElement>('[data-testid=map-mode-toggle]');
    // One small control in the sheet's head [O-72], not a disclosure: it names where it goes, "Shema" on the map.
    expect(toggle.closest('[data-ref=sheet-head]')).not.toBeNull();
    expect(workspace.querySelectorAll('details')).toHaveLength(0);
    expect(toggle.hidden).toBe(false);
    expect(toggle.dataset.mode).toBe('map');
    expect(toggle.hasAttribute('aria-pressed')).toBe(false);
    expect(text(toggle)).toBe('Shema');
    expect(toggle.getAttribute('aria-label')).toBe('Shema linija');
    const geographic = last();
    const savedCamera = { center: [15.96, 45.8] as [number, number], zoom: 15 };
    // A fitted/followed camera need not have fired onUserMove; read it before disposal.
    geographic.camera = () => savedCamera;
    geographic.options.onSelect!({ kind: 'vehicle', id: 'vehicle:1' });
    q<HTMLButtonElement>('#t-follow').click();
    q<HTMLButtonElement>('.t-sheet-toggle').click();
    expect(workspace.dataset.sheet).toBe('open');
    const relays = navigate.mock.calls.length;
    toggle.focus();
    toggle.click();
    const schema = last();
    expect(schema).not.toBe(geographic);
    expect(schema.options).toMatchObject({ renderer: 'schema', ariaLabel: 'Shema linija: Shema prikazuje tramvaje', selection: { kind: 'vehicle', id: 'vehicle:1' }, follow: 'vehicle:1' });
    expect(maps.handle('u-pokretu-schema')).toBe(schema);
    expect(maps.handle('u-pokretu-map')).toBeNull();
    expect(geographic.destroy).toHaveBeenCalledTimes(1);
    expect(raw.get('kajima:map-mode:v1')).toBe('schema');
    expect(MAP_MODE_STORAGE_KEY).toBe('kajima:map-mode:v1');
    expect(createMapModeStore({ storage }).snapshot()).toBe('schema');
    expect(q('[data-testid=transport-workspace]')).toBe(workspace);
    expect(workspace.dataset.sheet).toBe('open');
    expect(document.activeElement).toBe(toggle);
    expect(toggle.dataset.mode).toBe('schema');
    expect(text(toggle)).toBe('Karta');
    expect(toggle.getAttribute('aria-label')).toBe('Karta grada');
    // The schema has trams alone; the city map, every mode.
    expect([...(schema.options.modes ?? [])]).toEqual([0]);
    expect(text(q('[data-testid=vehicle-title]'))).toContain('Tramvaj 6');
    schema.options.onUserMove!(null);
    expect(q('[data-testid=following-note]')).toBeNull();
    expect(schema.follow).toHaveBeenLastCalledWith(null);
    expect(navigate.mock.calls.length).toBe(relays);
    // Neither the schema's null camera nor a late callback from the old map may erase the saved one.
    geographic.options.onUserMove!({ center: [0, 0], zoom: 1 });
    toggle.click();
    expect(last().options).toMatchObject({ renderer: 'map', center: savedCamera.center, zoom: 15, selection: { kind: 'vehicle', id: 'vehicle:1' }, follow: null });
    expect(schema.destroy).toHaveBeenCalledTimes(1);
    expect(last().options.modes ?? null).toBeNull();
    expect(navigate.mock.calls.length).toBe(relays);
    const search = q<HTMLInputElement>('[data-testid=transport-search]');
    search.value = 'kva';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const detent = workspace.dataset.sheet;
    toggle.click();
    expect(q('[data-testid=transport-search]')).toBe(search);
    expect(search.value).toBe('kva');
    expect(workspace.dataset.sheet).toBe(detent);
    context.i18n = createDefaultI18n('en');
    paint();
    expect(text(toggle)).toBe('Map');
    expect(toggle.getAttribute('aria-label')).toBe('City map');
    context.lightweight = true;
    paint();
    // R-L2 (WP5 A3): the lightweight path is this same workspace; the toggle is not offered and the renderer is
    // never the schema. The page hands a lightweight workspace map slots without a factory (dashboard.ts), so no
    // canvas is made there at all (test/app/layers.test.ts); these slots keep their factory, so a map is made here.
    expect(document.querySelector<HTMLElement>('[data-testid=map-mode-toggle]')?.hidden ?? true).toBe(true);
    expect(last().options.renderer).toBe('map');
    stop();
    maps.destroy();
    // Private mode and stale values do not change the default or break an in-tab choice.
    expect(createMapModeStore({ storage: { getItem: () => 'other', setItem() {} } }).snapshot()).toBe('map');
    const privateMode = createMapModeStore({ storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
    privateMode.set('schema');
    expect(privateMode.snapshot()).toBe('schema');
  });

  it('offers "samo ova linija" under a selection, on by default, and the switch reaches the store and the map', async () => {
    const { createLineFocusStore, LINE_FOCUS_STORAGE_KEY } = await import('../../app/src/core/line-focus-store');
    const raw = new Map<string, string>();
    const storage = { getItem: (key: string) => raw.get(key) ?? null, setItem: (key: string, value: string) => { raw.set(key, value); } };
    const lineFocus = createLineFocusStore({ storage });
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps, selection: { kind: 'route', id: '6' } });
    context.lineFocus = lineFocus;
    // The store's own subscription re-renders the workspace, as the dashboard's does.
    const stop = lineFocus.subscribe(() => { render(context); });
    expect(last().options.lineFocus).toBe(true);
    const on = q<HTMLButtonElement>('[data-action=toggle-line-focus]');
    expect(on.getAttribute('role')).toBe('switch');
    expect(on.getAttribute('aria-checked')).toBe('true');
    expect(text(on)).toBe('Samo ova linija na karti');
    on.click();
    expect(raw.get('kajima:line-focus:v1')).toBe('false');
    expect(LINE_FOCUS_STORAGE_KEY).toBe('kajima:line-focus:v1');
    expect(last().setLineFocus).toHaveBeenLastCalledWith(false);
    const off = q<HTMLButtonElement>('[data-action=toggle-line-focus]');
    // A switch's name never moves; only aria-checked does. A label that
    // flipped would announce the off state as "Cijela mreža na karti, off".
    expect(off.getAttribute('aria-checked')).toBe('false');
    expect(text(off)).toBe('Samo ova linija na karti');
    // A vehicle detail carries the same row; a public screen carries none.
    last().options.onSelect!({ kind: 'vehicle', id: 'vehicle:1' });
    expect(q<HTMLButtonElement>('[data-action=toggle-line-focus]').getAttribute('aria-checked')).toBe('false');
    stop();
    // No device store to write to (the lightweight path, a unit context): no
    // switch is offered at all, the way the map-mode button is not.
    render(ctx({ maps, selection: { kind: 'route', id: '6' } }).context);
    expect(document.querySelector('[data-action=toggle-line-focus]')).toBeNull();
    render(ctx({ maps, kiosk: true, selection: { kind: 'route', id: '6' } }).context);
    expect(document.querySelector('[data-action=toggle-line-focus]')).toBeNull();
  });

  it('renders one persistent workspace: every vehicle drawn at once, no menus, and the sheet opens on the place and its "U blizini" rows with the honesty note, never a fleet count, a delay table or ZET notices', () => {
    const nearby = vi.fn(NEARBY);
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps, nearby });
    render(context);
    const ws = q<HTMLElement>('[data-testid=transport-workspace]');
    // No disclosure and no chips: the map carries only its status line, the sheet's head the one switch.
    expect(ws.querySelectorAll('details')).toHaveLength(0);
    expect(text(ws)).not.toMatch(/Alati karte|Što tražiš/);
    expect(document.querySelector('.t-map-menu, .t-map-chips, .t-map-tools, [data-action=toggle-mode], [data-action=toggle-closures], [data-action=fit-city], [data-testid=map-full-toggle], [data-action=city-group], [data-action=city-category]')).toBeNull();
    // The body is the page's list, asked for the phone's eight rows once per render.
    expect(nearby).toHaveBeenCalledTimes(1);
    expect(nearby).toHaveBeenCalledWith(8);
    expect(all('[data-testid=transport-detail] [data-testid=nearby] [data-testid=nearby-rows] .nearby-row')).toHaveLength(2);
    // Nothing the overview used to say: the fleet count, the running lines, the delays, the closures and ZET's notices left the phone.
    expect(document.querySelector('[data-testid=running-routes], [data-testid=transport-total], [data-testid=transport-notices], [data-testid=transport-closures], [data-testid=delay-row], #u-pokretu-delays, [data-testid=screen-stop], [data-action=toggle-fold]')).toBeNull();
    expect(text(q('[data-testid=transport-detail]'))).not.toMatch(/vozil[oa] u pokretu|Obavijesti ZET-a|Kašnjenja po linijama|Linije u pokretu/);
    expect(text(q('[data-testid=transport-note]'))).toContain('ZET ne objavljuje smjer ni brzinu');
    expect(document.querySelectorAll('[data-testid=transport-note]')).toHaveLength(1);
    // Every vehicle on the map from the first frame: no mode left out, the closures drawn.
    expect(last().options).toMatchObject({ interactive: true, symbolScale: 1, closures: true, attributionCompact: true });
    expect(last().options.cooperative).toBeUndefined();
    expect(last().options.modes ?? null).toBeNull();
    render(context);
    expect(q('[data-testid=transport-workspace]')).toBe(ws);
    expect(last().setModes).toHaveBeenLastCalledWith(null);
    expect(nearby).toHaveBeenCalledTimes(2);
    expect(last().update).toHaveBeenCalledTimes(1); // the second render fed the same live map, never a second one
  });
});

describe('the sheet', () => {
  it('peeks with the place and the list’s circle, nothing else: no line badges, no counts, nothing to press but the switch and the chevron', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps, stop: { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.977, lat: 45.813, routes: ['6', '11'] } });
    render(context);
    expect(last().options).toMatchObject({ interactive: true, symbolScale: 1, closures: true, locale: 'hr', theme: 'light' });
    expect(last().options.stop).toMatchObject({ id: '106_1' });
    const peek = q<HTMLElement>('[data-testid=transport-peek]');
    // The screen's stop is the place (city/place.ts), its name the peek's title; the pill is the list's own circle.
    expect(text(peek.querySelector('strong'))).toBe('Trg bana J. Jelačića');
    expect(text(peek.querySelector('.t-peek-pill'))).toBe('2 km · ~15 min');
    expect(peek.querySelector('.line, .t-peek-count, .t-peek-more, button')).toBeNull();
    expect(text(peek)).not.toMatch(/vozil|zatvaranj/);
    expect(q<HTMLElement>('[data-testid=map-status]').hidden).toBe(true);
    expect(q<HTMLElement>('[data-testid=transport-workspace]').dataset.sheet).toBe('peek');
  });

  it('while the page’s rows are on their way the sheet says so once, then shows them; a page with no list shows the place alone; the map says it is loading too', () => {
    const { maps } = fakeMaps({ status: 'loading', vehicles: [] });
    const { context } = ctx({ maps, nearby: () => null });
    render(context);
    const pending = q<HTMLElement>('[data-testid=nearby-pending]');
    expect(pending.getAttribute('aria-busy')).toBe('true');
    expect(text(pending)).toBe(createDefaultI18n('hr').t('status.loading'));
    // No place of its own on this context: Trg bana J. Jelačića [O-65], with no circle to print yet.
    expect(text(q('[data-testid=transport-peek]'))).toBe('Trg bana J. Jelačića');
    expect(text(q('[data-testid=map-status]'))).toBe('Karta se učitava');
    context.nearby = NEARBY;
    render(context);
    expect(q('[data-testid=nearby-pending]')).toBeNull();
    expect(q('[data-testid=transport-detail] [data-testid=nearby]')).not.toBeNull();
    render(ctx({ maps, nearby: null }).context);
    expect(document.querySelector('[data-testid=nearby], [data-testid=nearby-pending]')).toBeNull();
    expect(text(q('[data-testid=transport-peek]'))).toBe('Trg bana J. Jelačića');
  });
});

describe('the desk pair (round 2, desktop F3 and F7)', () => {
  it('beside Sada the idle sheet lists nothing of its own, keeps the place and the circle in its peek, and grows for what the person picks', () => {
    const { maps } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const nearby = vi.fn(NEARBY);
    const { context } = ctx({ maps, nearby, pair: true });
    render(context);
    const ws = q<HTMLElement>('[data-testid=transport-workspace]');
    expect(q('[data-testid=transport-detail] [data-testid=nearby]')).toBeNull();
    expect(ws.dataset.idle).toBe('true');
    // The list is still asked for: its circle is the frame the map fits and the pill the peek prints.
    expect(nearby).toHaveBeenCalled();
    expect(text(q('[data-testid=transport-peek] .t-peek-pill'))).toBe('2 km · ~15 min');
    const input = q<HTMLInputElement>('[data-testid=transport-search]');
    input.value = 'crnomerec';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ws.dataset.idle).toBe('false');
    // Without the pair the phone's sheet keeps the list: the same workspace, its search cleared, lists the rows again.
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    render(ctx({ maps, nearby }).context);
    const phone = q<HTMLElement>('[data-testid=transport-workspace]');
    expect(phone).toBe(ws);
    expect(phone.dataset.idle).toBe('false');
    expect(all('[data-testid=transport-detail] [data-testid=nearby] .nearby-row')).toHaveLength(2);
    expect(text(q('[data-testid=transport-peek] .t-peek-pill'))).toBe('2 km · ~15 min');
  });

  it('a stop chosen from the search with the keyboard leaves the focus on its heading through the next poll, and the scrolling body is a Tab stop', () => {
    const { maps } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps, pair: true });
    // Reconciled in place, as dashboard.ts draws every poll: the workspace node never leaves the document.
    const main = document.createElement('main');
    document.body.replaceChildren(main);
    const poll = (): void => {
      const wrapper = document.createElement('div');
      wrapper.appendChild(renderLayer('u-pokretu', context));
      reconcile(main, wrapper);
      maps.sweep();
    };
    poll();
    expect(q('[data-testid=transport-detail]').getAttribute('tabindex')).toBe('0');
    const input = q<HTMLInputElement>('[data-testid=transport-search]');
    input.focus();
    input.value = 'crnomerec';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const option = document.getElementById(input.getAttribute('aria-activedescendant') ?? '')!;
    expect(option.dataset.action).toBe('select-stop');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const title = q<HTMLElement>('[data-testid=stop-title]');
    expect(document.activeElement).toBe(title);
    poll();
    expect(document.activeElement).toBe(q('[data-testid=stop-title]'));
    expect(document.activeElement).not.toBe(document.body);
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
    // The detail head: "Natrag" first as a 44 px ghost, the title, the kind and the delay at body.
    const back = q<HTMLButtonElement>('#t-clear-selection');
    expect(text(back)).toBe('Natrag');
    expect(back.classList.contains('btn-ghost')).toBe(true);
    expect(back.compareDocumentPosition(q('[data-testid=route-title]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(text(q('[data-testid=route-meta]'))).toBe('tramvaj · kasni 2 min');
    // A route is not a place to wait: the retired "ZET publishes no arrivals" sentence is gone from here, and arrivals live on the stop.
    expect(text(q('[data-testid=transport-detail]'))).not.toContain('ZET ne objavljuje dolaske');
    const vehicleRows = all<HTMLElement>('[data-testid=route-vehicles] .row');
    expect(vehicleRows).toHaveLength(2);
    expect(q<HTMLElement>('[data-testid=route-vehicles] button').id).toBe('t-row-vehicle-vehicle_1');
    expect(vehicleRows.every((row) => row.querySelector('button.t-row .line[data-size="m"]') !== null)).toBe(true);
    expect(vehicleRows.map((row) => text(row.querySelector('.row-title')))).toEqual(['Smjer istok', 'Smjer nepoznat']);
    expect(text(vehicleRows[1]!.querySelector('.row-sub'))).toBe('stoji na stajalištu');
    const stops = all<HTMLElement>('[data-testid=route-stops] li');
    expect(stops.length).toBeGreaterThan(15);
    expect(visible('[data-testid=route-stops] li')).toHaveLength(12);
    expect(text(q('[data-testid=route-stops] li'))).toBe('Črnomerec');
    expect(stops[0]!.classList.contains('row-dense')).toBe(true); // the sequence keeps its counter, in a dense row
    expect(q<HTMLElement>('[data-testid=route-stops] button').id).toMatch(/^t-row-stop-/);
    const allStops = q<HTMLButtonElement>('[data-testid=toggle-stops]');
    expect(allStops).toMatchObject({ dataset: { action: 'toggle-fold', fold: 'stops' } }); // the workspace's one fold contract
    expect(text(allStops)).toBe(`sva stajališta (${stops.length})`);
    expect(allStops.getAttribute('aria-expanded')).toBe('false');
    allStops.click();
    expect(visible('[data-testid=route-stops] li')).toHaveLength(stops.length);
    expect(q('[data-testid=toggle-stops]').getAttribute('aria-expanded')).toBe('true');
    // A stop by name, chosen with a tap on its row.
    input.value = 'crnomerec';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const stopOption = q<HTMLElement>('[role=option][data-action=select-stop]');
    expect(text(stopOption)).toContain('Črnomerec');
    stopOption.click();
    expect(last().select).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'stop', id: stopOption.dataset.id }), { fit: false }); // a stop opens the sheet, so no fit (§16.4);
    expect(navigate).toHaveBeenLastCalledWith('u-pokretu', { kind: 'stop', id: stopOption.dataset.id });
    expect(text(q('[data-testid=stop-title]'))).toBe('Črnomerec');
    expect(text(q('[data-testid=stop-meta]'))).toMatch(/^\d+ peron/); // "N perona" at secondary; the head never repeats "Stajalište"
    expect(text(q('[data-testid=stop-routes]'))).toContain('6');
    const stopRoute = q<HTMLElement>('[data-testid=stop-routes] .row');
    expect(stopRoute.querySelector('button.t-row .line[data-size="m"]')).not.toBeNull();
    expect(stopRoute.querySelector('.row-sub [role=img]')!.getAttribute('aria-label')).toMatch(/vozil/);
    expect(text(q('#t-clear-selection'))).toBe('Natrag');
    // Clearing tells the map and the paired screen once, and the search the person came from returns.
    q<HTMLButtonElement>('#t-clear-selection').click();
    expect(spy(last().select).mock.lastCall?.[0]).toBeNull();
    expect(navigate).toHaveBeenLastCalledWith('u-pokretu', null);
    expect(q<HTMLInputElement>('[data-testid=transport-search]').value).toBe('crnomerec');
    expect(q('[role=listbox]')).not.toBeNull();
  });
});

describe('the map, the paired screen and the feed', () => {
  it('a tap on the map opens the vehicle with its facing and a follow action, raising a peeking sheet to half; following relays the vehicle by public item key; a move the person makes ends the follow', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context, navigate } = ctx({ maps });
    render(context);
    const ws = q<HTMLElement>('[data-testid=transport-workspace]');
    expect(ws.dataset.sheet).toBe('peek');
    last().options.onSelect!({ kind: 'vehicle', id: 'vehicle:1' });
    expect(ws.dataset.sheet).toBe('half');
    expect(text(q('[data-testid=vehicle-title]'))).toBe('6Tramvaj 6');
    expect(q('[data-testid=vehicle-title] .line[data-size="l"]')).not.toBeNull();
    expect(text(q('[data-testid=vehicle-direction]'))).toBe('Smjer istok');
    expect(text(q('[data-testid=transport-peek]'))).toBe('Tramvaj 6 · smjer istok');
    expect(navigate).toHaveBeenLastCalledWith('u-pokretu', { kind: 'item', id: expect.stringMatching(/^[0-9a-f]{16}$/), module: 'zet-rt' });
    // "Prati vozilo" is the 48 px primary; the position sentence lives at the body's foot only, never repeated in the detail.
    const follow = q<HTMLButtonElement>('#t-follow');
    expect(text(follow)).toBe('Prati vozilo');
    expect(follow.className).toBe('btn btn-primary');
    expect(text(q('#t-clear-selection'))).toBe('Natrag');
    expect(text(q('[data-testid=transport-detail] .t-sheet-content'))).not.toContain('Položaj je');
    expect(document.querySelectorAll('[data-testid=transport-note]')).toHaveLength(1);
    follow.click();
    expect(last().follow).toHaveBeenLastCalledWith('vehicle:1');
    expect(text(q('[data-testid=transport-peek]'))).toContain('Praćenje');
    expect(q('[data-testid=following-note]')).not.toBeNull();
    last().options.onUserMove!({ center: [15.97, 45.81], zoom: 15 });
    expect(q('[data-testid=following-note]')).toBeNull();
    render(context);
    expect(text(q('[data-testid=vehicle-title]'))).toBe('6Tramvaj 6'); // the selection survives the poll
  });

  it('a selection the page navigated to is applied once with a fit: a route by id, a closure by public item key; one that names nothing here yields the place’s list', () => {
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
    expect(q('[data-testid=closure-title] .mark-closure')).not.toBeNull();
    const unknown = ctx({ maps, selection: { kind: 'item', id: '0123456789abcdef', module: 'zet-rt' } });
    render(unknown.context);
    expect(last().select).toHaveBeenLastCalledWith(null, { fit: false });
    expect(q('[data-testid=transport-detail] [data-testid=nearby]')).not.toBeNull();
  });

  it('a closure opens with the mark and the street at title size, the type words at body once, its window as one sentence, and a description as prose only when the module has one', () => {
    // The module's `summary` is, by default, its own wording of the two fields the type words already show (prometnice.ts
    // closureWords): that paraphrase is never repeated. Anything else the module writes there is the closure's description
    // and reads as prose after the window, with the type words still beside it.
    const boilerplate = { ...PROMETNICE.items[0]!, summary: closureWords('ROAD_CLOSED_CONSTRUCTION', 'ONE_DIRECTION') };
    const windowed = { ...boilerplate, id: 'c2', title: 'Ilica', at: '2026-09-08T06:00:00Z', until: '2026-09-13T04:00:00Z' };
    const described = { ...windowed, id: 'c3', title: 'Savska cesta', summary: 'Obilazak Vodnikovom ulicom; tramvaji 4 i 17 voze skraćeno do Savskog mosta.' };
    const { maps } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const snapshots = { 'zet-rt': ZET, prometnice: { ...PROMETNICE, items: [boilerplate, windowed, described] } };
    render(ctx({ maps, snapshots, selection: { kind: 'item', id: publicItemKey('prometnice', 'c2'), module: 'prometnice' } }).context);
    expect(q('[data-testid=closure-title] .mark-closure')).not.toBeNull();
    expect(text(q('[data-testid=closure-title]'))).toBe('Ilica');
    expect(text(q('[data-testid=transport-detail] .t-lead'))).toBe('radovi · jedan smjer');
    expect(text(q('[data-testid=closure-window]'))).toBe('od 8. 9. 08:00 do 13. 9. 06:00');
    const detail = text(q('[data-testid=transport-detail] .t-sheet-content'));
    expect(detail).not.toContain('zatvoreno zbog radova');
    expect(detail.split('jedan smjer').length - 1).toBe(1);
    expect(q('[data-testid=transport-detail] .t-prose')).toBeNull(); // the worker's paraphrase is not a description: no prose line
    expect(text(q('#t-clear-selection'))).toBe('Natrag');
    render(ctx({ maps, snapshots, selection: { kind: 'item', id: publicItemKey('prometnice', 'c3'), module: 'prometnice' } }).context);
    const prose = q('[data-testid=transport-detail] .t-prose');
    expect(prose).not.toBeNull();
    expect(text(prose)).toBe('Obilazak Vodnikovom ulicom; tramvaji 4 i 17 voze skraćeno do Savskog mosta.');
    expect(text(q('[data-testid=transport-detail] .t-lead'))).toBe('radovi · jedan smjer'); // the type words stay: the prose adds, never replaces
    expect(q('[data-testid=closure-window]').compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // title, words, window, then the prose
    expect(text(q('[data-testid=transport-detail] .t-sheet-content')).split('Obilazak').length - 1).toBe(1); // once
    render(ctx({ maps, snapshots, selection: { kind: 'item', id: publicItemKey('prometnice', 'c1'), module: 'prometnice' } }).context);
    expect(text(q('[data-testid=closure-window]'))).toBe('do 12. 9. 00:00'); // one end named: the sentence names that end only
  });

  it('a stale feed holds the map’s vehicles where they are; a kiosk gets a still map, bigger symbols, trams first, no controls and an open sheet', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const stale = { ...ZET, status: 'stale' as const, sourceUpdatedAt: new Date(NOW - 400_000).toISOString() };
    render(ctx({ maps, snapshots: { 'zet-rt': stale, prometnice: PROMETNICE } }).context);
    expect(last().setFeedState).toHaveBeenLastCalledWith('stale');
    const kiosk = fakeMaps({ vehicles: VEHICLES, net: NET });
    const board = ctx({ maps: kiosk.maps, kiosk: true }).context;
    board.mapMode = createMapModeStore({ storage: memoryStorage().storage });
    render(board);
    expect(kiosk.last().options).toMatchObject({ interactive: false, symbolScale: 1.35, attributionCompact: false });
    expect([...(kiosk.last().options.modes ?? [])]).toEqual([0]); // the board keeps trams first
    expect(q<HTMLElement>('[data-testid=transport-toolbar]').hidden).toBe(true);
    expect(q<HTMLElement>('[data-testid=map-mode-toggle]').hidden).toBe(true); // a public screen has no finger for the switch
    expect(q<HTMLElement>('[data-testid=transport-workspace]').dataset).toMatchObject({ kiosk: 'true', sheet: 'open' });
    // A public display prints no caveat under its sheet (companion brief §12); the phone keeps the note.
    expect(q<HTMLElement>('[data-testid=transport-note]').hidden).toBe(true);
    expect(text(q('[data-testid=transport-note]'))).toBe('');
  });
});

describe('detents on the phone stage', () => {
  it('starts at half; the chevron and a tap on the peek row cycle half → open → peek → half; Escape steps down; typing raises a peeking sheet; the map hears the covered height', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context, toggle } = ctx({ maps });
    render(context);
    const ws = q<HTMLElement>('[data-testid=transport-workspace]');
    const covered = (): number => Number.parseFloat(ws.style.getPropertyValue('--sheet-h'));
    expect(ws.dataset.sheet).toBe('peek');
    expect(covered()).toBeGreaterThan(0);
    expect(last().options.fitPadding).toEqual({ bottom: covered(), right: 0 });
    const chevron = q<HTMLButtonElement>('.t-sheet-toggle');
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    expect(chevron.getAttribute('aria-controls')).toBe(q('[data-testid=transport-detail]').id);
    chevron.click();
    expect(ws.dataset.sheet).toBe('half');
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
    expect(ws.dataset.sheet).toBe('open');
    // The page's map view (the desk's chevron, its Escape) moves the detent with it: into the view the sheet peeks,
    // out of it the sheet is back at half. Nothing on the phone asks for it any more: the map menu is gone.
    expect(document.querySelector('[data-testid=map-full-toggle]')).toBeNull();
    context.mapView = { full: true, toggle };
    render(context);
    expect(ws.dataset.sheet).toBe('peek');
    context.mapView = { full: false, toggle };
    render(context);
    expect(ws.dataset.sheet).toBe('half');
    expect(toggle).not.toHaveBeenCalled();
  });

  it('the desk has no detents: the board is open, nothing is covered, and the chevron only collapses or restores the board column', () => {
    fakeMedia({ wide: true });
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context, toggle } = ctx({ maps });
    render(context);
    const ws = q<HTMLElement>('[data-testid=transport-workspace]');
    expect(ws.dataset.sheet).toBe('open');
    expect(ws.style.getPropertyValue('--sheet-h')).toBe('');
    expect(last().options).toMatchObject({ attributionCompact: true, fitPadding: { bottom: 0, right: 0 } });
    q<HTMLButtonElement>('.t-sheet-toggle').click();
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(ws.dataset.sheet).toBe('open');
  });

  it('a selection made while the sheet is open brings it to half before the map moves, so the fit is padded for the detent the person will see: a search result, "Prikaži na karti", a selection the page navigated to', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps });
    render(context);
    const ws = q<HTMLElement>('[data-testid=transport-workspace]');
    // happy-dom lays nothing out: the stage is given the 740 px of a 390×844 phone, so half is 370 and open 700.
    Object.defineProperty(q<HTMLElement>('.transport-body'), 'clientHeight', { get: () => 740, configurable: true });
    const covered = (): number => Number.parseFloat(ws.style.getPropertyValue('--sheet-h'));
    const half = 740 * 0.38;
    const chevron = (): HTMLButtonElement => q<HTMLButtonElement>('.t-sheet-toggle');
    const handle = last();
    const reset = (): void => { for (const fn of [handle.select, handle.fit, handle.setFitPadding]) spy(fn).mockClear(); };
    chevron().click();
    chevron().click();
    expect(ws.dataset.sheet).toBe('open');
    expect(covered()).toBe(700);
    const search = q<HTMLInputElement>('[data-testid=transport-search]');
    search.value = '6';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ws.dataset.sheet).toBe('open');
    reset();
    q<HTMLElement>('[role=option][data-action=select-route][data-id="6"]').click();
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

describe('the detail head’s save toggle and cast button (T2.7, D5, B.3 saved-store)', () => {
  const CAN_CAST: CastState = { can: true, reason: null, screenLabel: 'Kavana Velebit', stopName: 'Trg bana J. Jelačića' };
  const NO_SCREEN: CastState = { can: false, reason: 'no-screen', screenLabel: null, stopName: null };

  it('a route detail carries the save toggle, unpressed and offering to save it, when it is not in the saved list', () => {
    const { maps } = fakeMaps({ vehicles: VEHICLES, net: NET });
    render(ctx({ maps, selection: { kind: 'route', id: '11' }, cast: CAN_CAST }).context);
    const save = q<HTMLButtonElement>('.t-save');
    expect(save.dataset.action).toBe('save');
    expect(save.dataset.kind).toBe('route');
    expect(save.dataset.id).toBe('11');
    expect(save.getAttribute('aria-pressed')).toBe('false');
    expect(save.getAttribute('aria-label')).toBe('Spremi liniju 11');
  });
  it('a saved route’s toggle offers to remove it instead, generically (the id already named it on the way in)', () => {
    const { maps } = fakeMaps({ vehicles: VEHICLES, net: NET });
    render(ctx({ maps, selection: { kind: 'route', id: '11' }, saved: [{ kind: 'route', id: '11' }] }).context);
    const save = q<HTMLButtonElement>('.t-save');
    expect(save.dataset.action).toBe('unsave');
    expect(save.getAttribute('aria-pressed')).toBe('true');
    expect(save.getAttribute('aria-label')).toBe('Ukloni iz spremljenog');
  });
  it('a stop detail carries the same toggle, by the stop’s own id', () => {
    const { maps } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const stop = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.978, lat: 45.813, routes: ['6'] };
    render(ctx({ maps, selection: { kind: 'stop', id: '106_1' }, stop, saved: [{ kind: 'stop', id: '106_1' }] }).context);
    const save = q<HTMLButtonElement>('.t-save');
    expect(save.dataset.kind).toBe('stop');
    expect(save.dataset.id).toBe('106_1');
    expect(save.dataset.action).toBe('unsave');
  });
  it('a vehicle and a closure detail carry no save toggle at all', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    render(ctx({ maps }).context);
    last().options.onSelect!({ kind: 'vehicle', id: 'vehicle:1' });
    expect(document.querySelector('.t-save')).toBeNull();
    render(ctx({ maps, selection: { kind: 'item', id: publicItemKey('prometnice', 'c1'), module: 'prometnice' } }).context);
    expect(document.querySelector('.t-save')).toBeNull();
  });
  it('details leave presentation to the shared header instead of duplicating the control', () => {
    const { maps } = fakeMaps({ vehicles: VEHICLES, net: NET });
    render(ctx({ maps, selection: { kind: 'route', id: '11' }, cast: CAN_CAST }).context);
    expect(document.querySelector('[data-testid=detail-cast]')).toBeNull();
    expect(q('[data-testid=route-title]').textContent).toContain('11');
  });
  it('a no-screen session keeps useful details without a dead presentation button', () => {
    const { maps } = fakeMaps({ vehicles: VEHICLES, net: NET });
    render(ctx({ maps, selection: { kind: 'route', id: '11' }, cast: NO_SCREEN }).context);
    expect(document.querySelector('[data-testid=detail-cast]')).toBeNull();
    expect(q('[data-testid=route-title]').textContent).toContain('11');
  });
  it('kiosk carries neither: a public screen has no finger to press them', () => {
    const { maps } = fakeMaps({ vehicles: VEHICLES, net: NET });
    render(ctx({ maps, kiosk: true, selection: { kind: 'route', id: '11' }, cast: CAN_CAST }).context);
    expect(document.querySelector('.t-save')).toBeNull();
    expect(document.querySelector('[data-testid=detail-cast]')).toBeNull();
  });
  it('save, unsave and cast bubble past the workspace to whatever wraps it (no stopPropagation on its own delegated handler)', () => {
    const { maps } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps, selection: { kind: 'route', id: '11' }, cast: CAN_CAST });
    const shell = document.createElement('div');
    document.body.replaceChildren(shell);
    shell.appendChild(renderLayer('u-pokretu', context));
    const heard: string[] = [];
    shell.addEventListener('click', (event) => {
      const target = (event.target as Element).closest<HTMLElement>('[data-action]');
      if (target) heard.push(target.dataset.action!);
    });
    shell.querySelector<HTMLButtonElement>('.t-save')!.click();
    expect(shell.querySelector('[data-testid=detail-cast]')).toBeNull();
    expect(heard).toEqual(['save']);
  });
});

// WP4 integration review (P1): every third-party string the Karta sheet prints goes through the row rule first: the peek
// line, the search results, a place's, a street's, a route's, a stop's, a vehicle's and a closure's detail and prose.
describe('third-party text on the Karta sheet (WP4 review)', () => {
  const PROBE = 'Pošalji lozinku na 091 234 5678.';
  const peek = () => text(q('[data-testid=transport-peek]'));
  const sheet = () => text(q('[data-testid=transport-detail]'));

  it('a place whose name fails the row rule: the peek and the detail title are empty, the search lists no such row', () => {
    const { maps } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps, selection: { kind: 'place', id: 'hostile' } });
    context.city = { ...emptyCity(), places: [
      { id: 'hostile', name: PROBE, category: 'culture', sourceId: 'culture', sourceRecord: 'h', lon: 15.97, lat: 45.81, address: PROBE, description: PROBE },
      { id: 'gavella', name: 'Gavella', category: 'culture', sourceId: 'culture', sourceRecord: 'g', lon: 15.971, lat: 45.811 },
    ] };
    render(context);
    expect(q('[data-testid=city-detail]')).not.toBeNull();
    expect(text(q('#city-detail-title'))).toBe('');
    expect(peek()).toBe('');
    expect(sheet()).not.toContain('lozinku');
    // Typed for, it is not offered: a result whose name fails the rule is left out; the plain one stands.
    const input = q<HTMLInputElement>('[data-testid=transport-search]');
    input.value = 'lozinku';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(all('[role=option]')).toHaveLength(0);
    expect(document.body.textContent).not.toContain('lozinku');
    input.value = 'Gavella';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(all('[role=option][data-action=select-place]')).toHaveLength(1);
    expect(text(q('[role=option] strong'))).toBe('Gavella');
    // The results listbox keeps its probe (e2e/experience.spec.ts reads it without WebGL too).
    expect(q('[data-testid=transport-results][role=listbox]')).not.toBeNull();
  });

  it('a closure whose summary fails the row rule prints no prose; one whose title fails prints no title and no peek', () => {
    const { maps } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const hostileSummary = { ...PROMETNICE.items[0]!, id: 'c2', title: 'Ilica', summary: PROBE };
    const hostileTitle = { ...PROMETNICE.items[0]!, id: 'c3', title: PROBE };
    const snapshots = { 'zet-rt': ZET, prometnice: { ...PROMETNICE, items: [PROMETNICE.items[0]!, hostileSummary, hostileTitle] } };
    render(ctx({ maps, snapshots, selection: { kind: 'item', id: publicItemKey('prometnice', 'c2'), module: 'prometnice' } }).context);
    expect(text(q('[data-testid=closure-title]'))).toBe('Ilica');
    expect(q('[data-testid=transport-detail] .t-prose')).toBeNull();
    expect(sheet()).not.toContain('lozinku');
    expect(peek()).toBe('Ilica');
    render(ctx({ maps, snapshots, selection: { kind: 'item', id: publicItemKey('prometnice', 'c3'), module: 'prometnice' } }).context);
    expect(text(q('[data-testid=closure-title]'))).toBe('');
    expect(peek()).toBe('');
    expect(document.body.textContent).not.toContain('lozinku');
  });

  it('a vehicle whose headsign fails the row rule: the direction falls back and the peek says none of it; the route\'s rows read the same direction', () => {
    const hostile = vehicle('vehicle:9', '6', 0, { headsign: PROBE, bearing: 90 });
    const { maps, last } = fakeMaps({ vehicles: [...VEHICLES, hostile], net: NET });
    render(ctx({ maps }).context);
    // A vehicle is the map's own selection (a tap on the drawn tram), never a public one.
    last().options.onSelect!({ kind: 'vehicle', id: 'vehicle:9' });
    expect(text(q('[data-testid=vehicle-title]'))).toContain('6');
    expect(text(q('[data-testid=vehicle-direction]'))).not.toContain('lozinku');
    expect(text(q('[data-testid=vehicle-direction]')).length).toBeGreaterThan(0);
    expect(peek()).toContain('Tramvaj 6');
    expect(peek()).not.toContain('lozinku');
    expect(document.body.textContent).not.toContain('lozinku');
    // The route's rows read the same direction; the route's peek is its number and long name.
    render(ctx({ maps, selection: { kind: 'route', id: '6' } }).context);
    expect(text(q('[data-testid=route-vehicles]'))).not.toContain('lozinku');
    expect(peek()).toContain('6');
    expect(document.body.textContent).not.toContain('lozinku');
  });
});

describe('a stop opens the sheet (WP4 §11, §16.4)', () => {
  it('a stop chosen from the search opens the sheet with no map fit, so its three departures and "Vozni red" are in view; a route lifts it to half with a fit', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps });
    render(context);
    const ws = q<HTMLElement>('[data-testid=transport-workspace]');
    const input = q<HTMLInputElement>('[data-testid=transport-search]');
    input.value = 'crnomerec';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    q<HTMLElement>('[role=option][data-action=select-stop]').click();
    expect(ws.dataset.sheet).toBe('open');
    expect(last().select).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'stop' }), { fit: false });
    expect(q('[data-testid=stop-board]')).not.toBeNull();
    // A route is read beside the map: half, fitted.
    input.value = '6';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    q<HTMLElement>('[role=option][data-action=select-route][data-id="6"]').click();
    expect(ws.dataset.sheet).toBe('half');
    expect(last().select).toHaveBeenLastCalledWith({ kind: 'route', id: '6' }, { fit: true });
  });
});

describe('what comes next at a stop', () => {
  const at = (minutes: number): string => new Date(NOW + minutes * 60_000).toISOString();
  const departure = (tripId: string, routeId: string, headsign: string, minutes: number) =>
    ({ operator: 'zet', tripId, routeId, routeName: routeId, headsign, at: at(minutes) });

  /** Every platform of the stop answers with the same three runs: one a tracked
   *  vehicle carries, one only the timetable knows, one that has already gone. */
  function stubBoards(asked: string[]): void {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const stop = new URL(url, 'http://test.local').searchParams.get('stop')!;
      asked.push(stop);
      return {
        ok: true,
        json: async () => ({
          operator: 'zet', stopId: stop, stopName: 'Črnomerec', status: 'live', generatedAt: at(0),
          departures: [departure('trip-live', '6', 'Sopot', 4), departure('trip-plan', '11', 'Dubec', 26), departure('trip-gone', '6', 'Sopot', -9)],
        }),
      };
    }));
  }

  it('asks every platform once, merges the boards with the live fleet and puts the list above everything else in the sheet', async () => {
    const asked: string[] = [];
    stubBoards(asked);
    const tracked = vehicle('vehicle:9', '6', 0, { tripId: 'trip-live', delaySeconds: 60 });
    const { maps } = fakeMaps({ vehicles: [...VEHICLES, tracked], net: NET });
    const { context } = ctx({ maps });
    render(context);
    const input = q<HTMLInputElement>('[data-testid=transport-search]');
    input.value = 'crnomerec';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    q<HTMLElement>('[role=option][data-action=select-stop]').click();
    // Before any board lands the section stands and says it is still loading.
    expect(q('[data-testid=stop-arrivals]')).not.toBeNull();
    await vi.waitFor(() => expect(q('[data-testid=arrival-rows]')).not.toBeNull());
    // One request per platform of the named stop, and no more.
    const platforms = Number(/^(\d+)/.exec(text(q('[data-testid=stop-meta]')))![1]);
    expect(platforms).toBeGreaterThan(1);
    expect(new Set(asked).size).toBe(platforms);
    expect(asked).toHaveLength(platforms);
    // The same trip on three sibling boards is one row; the run that has gone is none.
    const rows = all<HTMLElement>('[data-testid=arrival-rows] li');
    expect(rows).toHaveLength(2);
    // Scheduled 12:36 plus ZET's own minute of delay: five minutes away, and said so with the live dot.
    expect(text(rows[0])).toContain('Sopot');
    expect(text(rows[0])).toContain('za 5 min');
    expect(rows[0]!.querySelector('.t-live')).not.toBeNull();
    expect(rows[0]!.querySelector('.line[data-kind=tram]')).not.toBeNull();
    // Beyond the countdown horizon, and with no vehicle behind it: the clock and the timetable mark.
    expect(text(rows[1])).toContain('Dubec');
    expect(rows[1]!.dataset.live).toBe('false');
    expect(text(rows[1])).not.toContain('vozni red'); // the form says it, never a word per row [O-27]
    expect(rows[1]!.querySelector('time')).not.toBeNull();
    expect(rows[1]!.querySelector('.t-live')).toBeNull();
    // One note, first in the sheet, and the retired sentence and slot are gone.
    const detail = q<HTMLElement>('[data-testid=transport-detail]');
    expect(text(detail).split('Procjena iz ZET-ovih podataka o vozilima').length - 1).toBe(1);
    expect(text(detail)).not.toContain('ZET ne objavljuje dolaske');
    expect(detail.querySelector('[data-city-departures]')).toBeNull();
    const arrivals = q<HTMLElement>('[data-testid=stop-arrivals]');
    expect(arrivals.compareDocumentPosition(q('[data-testid=stop-meta]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(arrivals.compareDocumentPosition(q('[data-testid=stop-routes]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('leads with three departures, then lists the rest of the day’s board to the twelfth under "Vozni red"', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const stop = new URL(url, 'http://test.local').searchParams.get('stop')!;
      return {
        ok: true,
        json: async () => ({
          operator: 'zet', stopId: stop, stopName: 'Črnomerec', status: 'live', generatedAt: at(0),
          departures: Array.from({ length: 15 }, (_, i) => departure(`run-${i}`, '6', 'Sopot', 3 + i * 4)),
        }),
      };
    }));
    const { maps } = fakeMaps({ vehicles: VEHICLES, net: NET });
    render(ctx({ maps }).context);
    const input = q<HTMLInputElement>('[data-testid=transport-search]');
    input.value = 'crnomerec';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    q<HTMLElement>('[role=option][data-action=select-stop]').click();
    await vi.waitFor(() => expect(q('[data-testid=timetable-rows]')).not.toBeNull());
    expect(all('[data-testid=arrival-rows] > li.sada-departure')).toHaveLength(3);
    expect(all('[data-testid=timetable-rows] > li.sada-departure')).toHaveLength(9);
    expect(all('[data-testid=stop-arrivals] .t-head').map(text)).toEqual(['Vozni red']);
    // The three lead under the stop's own name, before the timetable and the note.
    const first = q('[data-testid=arrival-rows]');
    expect(q('[data-testid=stop-title]').compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(first.compareDocumentPosition(q('[data-testid=timetable-rows]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('puts no live time on a row while the feed is down or its last word is older than the twin keeps a fix, and none once the session flag says frozen (WP4 review)', () => {
    const tracked = vehicle('vehicle:9', '6', 0, { tripId: 'trip-live', delaySeconds: 60 });
    const stop = { id: '106_1', name: 'Črnomerec', lon: 15.87, lat: 45.82, routes: ['6', '11'] };
    // The stop's board is already in the page's hands: the sheet draws its rows on the first render.
    const held = { operator: 'zet', stopId: '106_1', stopName: stop.name, status: 'live', generatedAt: at(0), departures: [departure('trip-live', '6', 'Sopot', 4), departure('trip-plan', '11', 'Dubec', 26)] };
    const cache = { ensure: vi.fn(), get: () => held, destroy: vi.fn() };
    const open = (snapshots: LayerContext['snapshots'], session?: LayerContext['session']): HTMLElement => {
      const { maps } = fakeMaps({ vehicles: [...VEHICLES, tracked], net: NET });
      const { context } = ctx({ maps, snapshots, selection: { kind: 'stop', id: '106_1' }, stop });
      context.boards = cache as never;
      if (session) context.session = session;
      render(context);
      return q<HTMLElement>('[data-testid=stop-arrivals]');
    };
    const feed = { 'zet-rt': ZET, prometnice: PROMETNICE, dogadanja: DOGADANJA };
    // Live feed, the vehicle carries the first trip: the live dot and its countdown.
    const live = open(feed);
    const first = live.querySelector<HTMLElement>('[data-testid=arrival-rows] li')!;
    expect(first.dataset.live).toBe('true');
    expect(text(first)).toContain('za 5 min');
    // The feed is down: the same retained vehicle puts no live time on any row; the trip shows its timetable clock.
    const down = open({ ...feed, 'zet-rt': { ...ZET, status: 'down' } });
    expect(down.querySelectorAll('[data-live="true"], .t-live')).toHaveLength(0);
    expect(down.textContent).not.toContain('uživo');
    expect(down.textContent).not.toContain('za 5 min');
    expect(down.querySelector('[data-testid=arrival-rows] li time')).not.toBeNull();
    // The feed answers, but its last word is five minutes old: every fix has outlived the twin's eviction.
    const stale = open({ ...feed, 'zet-rt': { ...ZET, fetchedAt: new Date(NOW - 5 * 60_000).toISOString(), sourceUpdatedAt: new Date(NOW - 5 * 60_000).toISOString() } });
    expect(stale.querySelectorAll('[data-live="true"]')).toHaveLength(0);
    // The session flag alone, with the rows still in hand: no row says live and nothing is asked for.
    cache.ensure.mockClear();
    const frozen = open(feed, { expiresAt: null, frozen: true });
    expect(frozen.querySelectorAll('[data-testid=arrival-rows] li').length).toBeGreaterThan(0);
    expect(frozen.querySelectorAll('[data-live="true"]')).toHaveLength(0);
    expect(frozen.textContent).not.toContain('uživo');
    expect(cache.ensure).not.toHaveBeenCalled();
  });

  it('says the timetable is unavailable when every platform is down, and never invents a row', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    const { maps } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps });
    render(context);
    const input = q<HTMLInputElement>('[data-testid=transport-search]');
    input.value = 'crnomerec';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    q<HTMLElement>('[role=option][data-action=select-stop]').click();
    await vi.waitFor(() => expect(text(q('[data-testid=stop-arrivals]'))).toContain('Vozni red trenutačno nije dostupan.'));
    expect(q('[data-testid=arrival-rows]')).toBeNull();
  });
});

describe('the frame: Karta opens on the place', () => {
  it('opens framed on the place with its measured circle (map/frame.ts, the wall’s arithmetic), follows a new place once, and never takes back a map the person moved', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps, place: KVATERNIKOV });
    render(context);
    // Not laid out yet (a unit context has no layout): a 390 x 600 phone stage stands in.
    const framed = frameView(KVATERNIKOV, 2000, 390, 600);
    expect(framed.center).toEqual([KVATERNIKOV.lon, KVATERNIKOV.lat]);
    expect(last().options).toMatchObject({ center: framed.center, zoom: framed.zoom });
    expect(text(q('[data-testid=transport-peek] strong'))).toBe('Kvaternikov trg');
    // The list's own circle is the one the camera fits: a tighter one frames closer (2 km across a phone is already
    // at the frame's 12.7 floor, as on the compact wall).
    const tight = fakeMaps({ vehicles: VEHICLES, net: NET });
    render(ctx({ maps: tight.maps, place: KVATERNIKOV, nearby: () => ({ html: NEARBY_HTML, pill: '0,9 km · ~7 min', radiusM: 900 }) }).context);
    expect(tight.last().options.zoom).toBeCloseTo(frameView(KVATERNIKOV, 900, 390, 600).zoom, 6);
    expect(tight.last().options.zoom!).toBeGreaterThan(framed.zoom);
    // Another place (a stop saved elsewhere on the page): the camera follows it once.
    render(context);
    context.place = JELACIC;
    render(context);
    expect(last().setView).toHaveBeenLastCalledWith({ center: [JELACIC.lon, JELACIC.lat], zoom: frameView(JELACIC, 2000, 390, 600).zoom, frame: true });
    expect(text(q('[data-testid=transport-peek] strong'))).toBe('Trg bana J. Jelačića');
    // The person moves the map: a later place change leaves the camera where they put it.
    last().options.onUserMove!({ center: [15.99, 45.8], zoom: 15 });
    spy(last().setView).mockClear();
    context.place = KVATERNIKOV;
    render(context);
    expect(last().setView).not.toHaveBeenCalled();
  });

  // Lane p-map (owner, 24 Sep: fullscreen on and off left part of the frame
  // off the map): the stage's first real layout frames at once; a later change
  // to its box -- a resize, a fullscreen change, a turn of the phone -- refits
  // once it has settled, the canvas resized to its new box first.
  it('refits the frame once a change to the stage box has settled, the canvas resized first', () => {
    vi.useFakeTimers();
    try {
      const observers: ResizeObserverCallback[] = [];
      vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { observers.push(callback); } observe(): void {} unobserve(): void {} disconnect(): void {} });
      const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
      const { context } = ctx({ maps, place: KVATERNIKOV });
      render(context);
      const stage = q<HTMLElement>('.transport-body');
      const box = (width: number, height: number): void => {
        Object.defineProperty(stage, 'clientWidth', { value: width, configurable: true });
        Object.defineProperty(stage, 'clientHeight', { value: height, configurable: true });
      };
      const observe = (): void => { for (const o of observers) o([], {} as ResizeObserver); };
      box(412, 700);
      observe();
      expect(last().setView).toHaveBeenLastCalledWith({ center: [KVATERNIKOV.lon, KVATERNIKOV.lat], zoom: frameView(KVATERNIKOV, 2000, 412, 700).zoom, frame: true });
      spy(last().setView).mockClear();
      spy(last().resize).mockClear();
      box(915, 412);
      observe();
      observe();
      expect(last().setView).not.toHaveBeenCalled();
      vi.advanceTimersByTime(REFIT_SETTLE_MS);
      expect(last().setView).toHaveBeenCalledTimes(1);
      expect(last().setView).toHaveBeenLastCalledWith({ center: [KVATERNIKOV.lon, KVATERNIKOV.lat], zoom: frameView(KVATERNIKOV, 2000, 915, 412).zoom, frame: true });
      expect(spy(last().resize).mock.invocationCallOrder[0]).toBeLessThan(spy(last().setView).mock.invocationCallOrder[0]!);
      // And back: the first frame again, nothing left of the larger box.
      box(412, 700);
      observe();
      vi.advanceTimersByTime(REFIT_SETTLE_MS);
      expect(last().setView).toHaveBeenLastCalledWith({ center: [KVATERNIKOV.lon, KVATERNIKOV.lat], zoom: frameView(KVATERNIKOV, 2000, 412, 700).zoom, frame: true });
    } finally { vi.useRealTimers(); }
  });

  // Lane p-map: the desk's Karta is a column of its own beside the sheet (at 1280 x 800, a 326 x 718 canvas in a
  // 694 px stage): the circle is fitted to the canvas, whole, below the marks' own floor, and the map is told to
  // draw its pills and rings from that zoom. A wider desk fits above the floor and asks for nothing.
  it('fits the desk\u2019s circle to its own canvas, not the stage, whole below the marks\u2019 floor with the marks drawn from the fit', () => {
    fakeMedia({ wide: true });
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps, place: KVATERNIKOV });
    const size = (selector: string, width: number, height: number): void => {
      const el = q<HTMLElement>(selector);
      Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
      Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
    };
    render(context);
    expect(q<HTMLElement>('[data-testid=transport-workspace]').dataset.sheet).toBe('open');
    size('.transport-body', 694, 718);
    size('.transport-map', 326, 718);
    render(context);
    const narrow = frameView(KVATERNIKOV, 2000, 326, 718, 24, FIT_MIN_ZOOM);
    expect(narrow.zoom).toBeLessThan(FRAME_MIN_ZOOM);
    expect(last().setView).toHaveBeenLastCalledWith({ center: [KVATERNIKOV.lon, KVATERNIKOV.lat], zoom: narrow.zoom, frame: true });
    expect(last().setMarkZoom).toHaveBeenLastCalledWith(markZoomFor(narrow.zoom));
    size('.transport-body', 1318, 998);
    size('.transport-map', 950, 998);
    render(context);
    expect(last().setView).toHaveBeenLastCalledWith({ center: [KVATERNIKOV.lon, KVATERNIKOV.lat], zoom: frameView(KVATERNIKOV, 2000, 950, 998).zoom, frame: true });
    expect(last().setMarkZoom).toHaveBeenLastCalledWith(null);
  });

  it('rings the place\'s departures stop as the map\'s own stop when the session has no screen stop, so the place carries a ring to tap; a screen stop keeps its own', () => {
    const trg = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '11'] };
    const place: PlaceContext = { ...JELACIC, kind: 'city', departuresStop: trg };
    // No screen (a screenless session, the default place Trg bana J. Jelačića): the departures stop, as Sada's band.
    const bare = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps: bare.maps, place });
    render(context);
    expect(bare.last().options.stop).toEqual(trg);
    // The catalogue settles the place on another stop: the live map moves its ring there.
    const kvaternikov = { id: '123_1', name: 'Kvaternikov trg', lon: 15.9936, lat: 45.8149, routes: ['4'] };
    context.place = { ...KVATERNIKOV, departuresStop: kvaternikov };
    render(context);
    expect(bare.last().setStop).toHaveBeenLastCalledWith(kvaternikov);
    // A screen stop is the screen's anchor and stays the ring.
    const screen = { id: '1849_23', name: 'Glavni kolodvor', lon: 15.978, lat: 45.805, routes: ['2'] };
    const paired = fakeMaps({ vehicles: VEHICLES, net: NET });
    render(ctx({ maps: paired.maps, place, stop: screen }).context);
    expect(paired.last().options.stop).toEqual(screen);
    // Neither: no ring.
    const none = fakeMaps({ vehicles: VEHICLES, net: NET });
    render(ctx({ maps: none.maps, place: KVATERNIKOV }).context);
    expect(none.last().options.stop).toBeNull();
  });

  it('draws every mode on the phone, trams alone on the schema, and trams first only on the kiosk board', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const phone = ctx({ maps }).context;
    phone.mapMode = createMapModeStore({ storage: memoryStorage().storage });
    render(phone);
    expect(last().options.modes ?? null).toBeNull();
    phone.mapMode.set('schema');
    render(phone);
    expect([...(last().options.modes ?? [])]).toEqual([0]);
    const board = fakeMaps({ vehicles: VEHICLES, net: NET });
    render(ctx({ maps: board.maps, kiosk: true }).context);
    expect([...(board.last().options.modes ?? [])]).toEqual([0]);
  });
});

describe('the map under the sheet (round 3, phone A)', () => {
  it('rests the vehicles\' motion while the sheet is open over the stage and lets it run again when the sheet comes down; a desk column never pauses', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps });
    render(context);
    const handle = last();
    expect(handle.pause).not.toHaveBeenCalled();
    const input = q<HTMLInputElement>('[data-testid=transport-search]');
    // Focus opens the sheet at once (its taller summary must never travel under the tab bar): the map rests.
    input.focus();
    input.dispatchEvent(new Event('focus'));
    expect(q<HTMLElement>('[data-testid=transport-workspace]').dataset.sheet).toBe('open');
    expect(handle.pause).toHaveBeenCalledTimes(1);
    expect(handle.resume).not.toHaveBeenCalled();
    // A poll while it rests changes nothing about the rest.
    render(context);
    expect(handle.pause).toHaveBeenCalledTimes(1);
    expect(handle.resume).not.toHaveBeenCalled();
    // Escape in the sheet steps it down: the map moves again.
    input.blur();
    q<HTMLElement>('[data-testid=transport-detail]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(q<HTMLElement>('[data-testid=transport-workspace]').dataset.sheet).not.toBe('open');
    expect(handle.resume).toHaveBeenCalledTimes(1);
    // The desk's column covers no map.
    fakeMedia({ wide: true });
    const desk = fakeMaps({ vehicles: VEHICLES, net: NET });
    render(ctx({ maps: desk.maps }).context);
    q<HTMLInputElement>('[data-testid=transport-search]').dispatchEvent(new Event('focus'));
    expect(desk.last().pause).not.toHaveBeenCalled();
  });

  it('never resumes the motion with nothing live behind the page: a refused ticket, a feed gone quiet; the next live render resumes it (review N2)', () => {
    const { maps, last } = fakeMaps({ vehicles: VEHICLES, net: NET });
    const { context } = ctx({ maps });
    // The room refused the ticket: the page paused the map and polls nothing.
    context.session = { expiresAt: null, frozen: false, live: false };
    render(context);
    const handle = last();
    const input = q<HTMLInputElement>('[data-testid=transport-search]');
    input.focus();
    input.dispatchEvent(new Event('focus'));
    expect(handle.pause).toHaveBeenCalledTimes(1);
    input.blur();
    q<HTMLElement>('[data-testid=transport-detail]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(q<HTMLElement>('[data-testid=transport-workspace]').dataset.sheet).not.toBe('open');
    expect(handle.resume, 'no feed behind the page: the vehicles are not extrapolated').not.toHaveBeenCalled();
    // A live page whose feed is down: the same.
    context.session = { expiresAt: null, frozen: false, live: true };
    context.snapshots = { ...context.snapshots, 'zet-rt': { ...ZET, status: 'down' } };
    render(context);
    expect(handle.resume).not.toHaveBeenCalled();
    // The feed is back and the page polls: the render resumes it.
    context.snapshots = { ...context.snapshots, 'zet-rt': ZET };
    render(context);
    expect(handle.resume).toHaveBeenCalledTimes(1);
  });
});
