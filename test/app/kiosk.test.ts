// @vitest-environment happy-dom
// The kiosk controller with every dependency faked: the setup wizard, the
// invitation (the front page: the map and three cards), codes, the paired
// compositions, expiry and revocation, the basics panel, alerts, polling and
// disposal. The panels are the real kiosk/front.ts over the fixture teaser;
// what is proven here is that the controller paints them on the right beats,
// reconciles what changed and hides what the box does not hold.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import type { CodeSlot, ScreenMetadata } from '../../worker/protocol';
import { BEACON_STORAGE_KEY } from '../../app/src/beacon';
import type { LastRunSnapshot } from '../../app/src/core/lastrun';
import { ScreenError } from '../../app/src/core/screens';
import { publicItemKey } from '../../app/src/core/contracts';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { CODE_SWAP_MS, CODE_TICK_MS, ESSENTIALS_IDLE_MS, LASTRUN_DOWN_RETRY_MS, mountKiosk, REFRESH_MS, type KioskDeps } from '../../app/src/kiosk';
import { SAVE_TIMEOUT_MS, SETTINGS_IDLE_MS } from '../../app/src/kiosk/settings';
import { TICKER_PERIOD_MS } from '../../app/src/kiosk/ticker';
import { FIELD_DESIGN_HEIGHT, FIELD_DESIGN_WIDTH } from '../../app/src/kiosk/layout';
import { cityWindowView, DISTRICT_SPAN_M, FIELD_SPAN_M, fieldZoom, HANDHELD_SPAN_M, KIOSK_EMPHASIS, labelPadding } from '../../app/src/kiosk/mapview';
import { districtBySlug } from '../../app/src/kiosk/districts';
import { POLL_FALLBACK_MS } from '../../app/src/motion/loop';
import { THEME_PREFERENCES, type ThemeController, type ThemePreference } from '../../app/src/ui/theme';
import { createBoardCache, type BoardCache } from '../../app/src/city/boards';
import type { MapSelection } from '../../app/src/map/city-map';
import type { DepartureBoard, ScheduledDeparture } from '../../shared/city/types';
import { fakeCityStore } from '../city/fake-store';
import { emptyCity } from '../../shared/city/types';


const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb
const STOP = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '11', '12', '13', '14', '17', '31', '32', '34'] };
const STOPS = [STOP, { id: '106_2', name: 'Trg bana J. Jelačića', lon: 15.9779, lat: 45.81286, routes: ['6', '11'] }, { id: '200_1', name: 'Zapruđe', lon: 15.99, lat: 45.77, routes: ['7'] }];
const SCREEN: ScreenMetadata = { kind: 'temporary', expiresAt: NOW + 20 * 3_600_000, stop: STOP, area: 'gornji-grad-medvescak' };
/** What one press of Pokreni zaslon makes: the whole city, no stop. */
const CITY_SCREEN: ScreenMetadata = { kind: 'temporary', expiresAt: NOW + 20 * 3_600_000, stop: null, area: 'zagreb' };
const STORED = JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna', screen: SCREEN });
const STORED_CITY = JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna', screen: CITY_SCREEN });
const attr = { text: 'Izvor: test', url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' };
type Item = ModuleSnapshot['items'][number];
function snap(module: ModuleId, items: Item[], status: ModuleSnapshot['status'] = 'live'): ModuleSnapshot {
  return { module, tier: 'open', status, fetchedAt: new Date(NOW - 30_000).toISOString(), attribution: attr, items };
}
function item(module: ModuleId, id: string, kind: Item['kind'], title: string, extra: Partial<Item> = {}): Item {
  return { id, module, kind, tier: 'open', title, ...extra };
}
const MODULES: ModuleSnapshot[] = [
  snap('dhmz-now', [item('dhmz-now', 'o1', 'observation', 'Zagreb-Maksimir', { at: '2026-09-11T12:00:00Z', data: { temp: 21, humidity: 55, windDir: 'NW', windSpeed: 2.3, weather: 'vedro' } })]),
  snap('dhmz-cap', [item('dhmz-cap', 'w1', 'warning', 'Grmljavina', { severity: 'moderate' })]),
  snap('prometnice', [item('prometnice', 'c1', 'closure', 'Ilica', { geo: { type: 'LineString', coordinates: [[15.9705, 45.813], [15.972, 45.8131]] }, data: { subtype: 'ROAD_CLOSED' } })]),
  snap('zet-rt', [
    item('zet-rt', 'vozila', 'vehicle', '156 vozila u pokretu', { data: { vehicles: 156 } }),
    item('zet-rt', 'vehicle:1', 'vehicle', '6', { at: '2026-09-11T12:31:40Z', geo: { type: 'Point', coordinates: [15.977, 45.813] }, data: { routeId: '6', routeType: 0 } }),
    item('zet-rt', 'route:6', 'vehicle', '6', { data: { routeId: '6', routeShortName: '6', medianDelaySeconds: 240, vehicles: 12 } }),
  ]),
  snap('emsc', [item('emsc', 'q1', 'quake', 'Potres', { at: '2026-09-11T10:11:00Z', data: { mag: 1.6, depth: 10, region: 'CROATIA' } })]),
  snap('dogadanja', [item('dogadanja', 'skupstina:13', 'event', '13. sjednica Gradske skupštine', { at: '2026-09-17T07:00:00Z', dateBasis: 'event', data: { source: 'skupstina', precision: 'time' } })]),
  snap('ckan-geo', [item('ckan-geo', 'p1', 'poi', 'Ljekarna Centar, Ilica 1', { data: { category: 'ljekarne' } })]),
];
const CODE_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function batch(start: number, count = 20): CodeSlot[] {
  return Array.from({ length: count }, (_, i) => ({ code: `ABCDEFG${CODE_CHARS[i]}`, slotStart: start + i * 30_000, slotEnd: start + (i + 1) * 30_000 }));
}

interface Timer { fn: () => void; ms: number; cleared: boolean }
type MountOptions = Partial<Pick<KioskDeps, 'cityStore' | 'hash' | 'reducedMotion' | 'lightweight' | 'fetchTeaser' | 'mapFactory' | 'createScreen' | 'loadStops' | 'viewport' | 'locale' | 'now' | 'i18n' | 'codeBase' | 'loadLastRun' | 'mapMode' | 'createBoards'>> & { stored?: string | null; themeInitial?: ThemePreference } & { modules?: ModuleSnapshot[] };

/** A theme controller the test drives and inspects: every `setPreference` call
 *  is recorded in order, and `onChange` behaves exactly like the real one
 *  (fires once, synchronously, with the current state, per ui/theme.ts). */
function fakeThemeController(initial: ThemePreference): { theme: ThemeController; calls: ThemePreference[]; listenerCount: () => number } {
  let preference = initial;
  const calls: ThemePreference[] = [];
  const listeners = new Set<(state: { preference: ThemePreference; resolved: 'light' | 'dark' }) => void>();
  const notify = () => { for (const l of listeners) l({ preference, resolved: 'light' }); };
  const theme: ThemeController = {
    getPreference: () => preference,
    getResolvedTheme: () => 'light',
    setPreference(next) { preference = next; calls.push(next); notify(); },
    onChange(listener) { listeners.add(listener); listener({ preference, resolved: 'light' }); return () => { listeners.delete(listener); }; },
    destroy() { listeners.clear(); },
  };
  return { theme, calls, listenerCount: () => listeners.size };
}

/** No test reaches the network for a departure board: a kiosk given no board
 *  seam of its own gets a cache whose every request answers "down", so a
 *  configured stop's card says so instead of the suite talking to port 3000. */
const offlineBoards = (): BoardCache => createBoardCache({ fetchImpl: (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof globalThis.fetch });

function mount(opts: MountOptions = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const raw: Record<string, string> = {};
  if (opts.stored) raw[BEACON_STORAGE_KEY] = opts.stored;
  const storage = { getItem: (k: string) => raw[k] ?? null, setItem: (k: string, v: string) => { raw[k] = v; }, removeItem: (k: string) => { delete raw[k]; } };
  let beaconStatus: 'live' | 'offline' = 'live';
  const beacon = { connect: vi.fn(), requestMore: vi.fn(), status: () => beaconStatus, close: vi.fn(), acknowledgePresentation: vi.fn(), stopPresentation: vi.fn(), setScreen: vi.fn() };
  let handlers: Parameters<NonNullable<KioskDeps['createBeacon']>>[0] | null = null;
  const timers: Timer[] = [];
  const sessions: { close: ReturnType<typeof vi.fn> }[] = [];
  let sessionExpired: (() => void) | null = null;
  let sessionView: ((layer: string, params?: Record<string, string>) => void) | null = null;
  let secondsLeft = 600;
  const modules = opts.modules ?? MODULES;
  const fetchData = vi.fn(async (module: ModuleId, _token: string) => modules.find((m) => m.module === module) ?? snap(module, []));
  const createScreen = opts.createScreen ?? vi.fn(async () => ({ beaconId: 'NEW00001', secret: 'nova', provisionUrl: 'https://zagreb.aningfilm.hr/kiosk/#NEW00001.nova', screen: CITY_SCREEN }));
  const loadStops = opts.loadStops ?? vi.fn(async () => STOPS);
  /** The stop's last-departure table: none by default (the stop is not in the generated set), so nothing reaches the wire from here. */
  const loadLastRun = opts.loadLastRun ?? vi.fn(async () => null);
  const requestFullscreen = vi.fn(async () => {});
  const requestWakeLock = vi.fn(async () => {});
  /** The theme-or-resize listener the controller registers; a test fires it after mutating its viewport object. */
  let repaint: (() => void) | null = null;
  const themeFake = fakeThemeController(opts.themeInitial ?? 'solar');
  const handle = mountKiosk(root, {
    cityStore:opts.cityStore??fakeCityStore(),
    i18n: opts.i18n ?? createDefaultI18n('hr'), hash: opts.hash ?? '', storage, now: opts.now ?? (() => NOW), codeBase: opts.codeBase ?? 'https://zagreb.aningfilm.hr',
    onRepaint: (listener) => { repaint = listener; return () => { repaint = null; }; },
    reducedMotion: opts.reducedMotion ?? false, lightweight: opts.lightweight ?? false, viewport: opts.viewport ?? { width: 1920, height: 1080 }, locale: opts.locale, mapMode: opts.mapMode,
    fetchTeaser: opts.fetchTeaser ?? (async () => ({ modules })), loadNetwork: async () => null, mapFactory: opts.mapFactory, fetchData, createScreen, loadStops, loadLastRun, createBoards: opts.createBoards ?? offlineBoards,
    theme: themeFake.theme,
    createBeacon: (deps) => { handlers = deps; return beacon; },
    createSession: () => {
      const joined = { phase: 'live' as const, role: 'kiosk' as const, expiresAt: NOW + 600_000, dataToken: 'dt1', participants: 2, secondsLeft: 600 };
      const s = { connect: vi.fn(), snapshot: () => joined, serverNow: () => NOW, secondsLeft: () => secondsLeft, onJoined: (l: (snapshot: typeof joined) => void) => { queueMicrotask(() => l(joined)); return () => {}; }, onExpiring: () => () => {}, onExpired: (l: () => void) => { sessionExpired = l; return () => {}; }, onView: (l: typeof sessionView) => { sessionView = l; return () => {}; }, onCodes: () => () => {}, onCount: () => () => {}, onError: () => () => {}, onClose: () => () => {}, sendView: vi.fn(), share: vi.fn(), event: vi.fn(), close: vi.fn() };
      sessions.push(s);
      return s as unknown as ReturnType<NonNullable<KioskDeps['createSession']>>;
    },
    setInterval: (fn: () => void, ms: number) => { const t: Timer = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearInterval: (h: unknown) => { (h as Timer).cleared = true; },
    requestFullscreen, requestWakeLock,
  });
  /** The timers mountKiosk arms synchronously (the 1 s and 20 s ticks); the teaser poll arms itself only after the first load settles. */
  const armedAtMount = new Set(timers);
  return {
    root, handle, beacon, timers, raw, sessions, fetchData, createScreen, loadStops, loadLastRun, requestFullscreen, requestWakeLock,
    theme: themeFake.theme, themeCalls: themeFake.calls, themeListenerCount: themeFake.listenerCount,
    goOffline: () => { beaconStatus = 'offline'; },
    get handlers() { return handlers!; },
    repaint: () => repaint?.(),
    expire: () => sessionExpired?.(),
    view: (layer: string, params?: Record<string, string>) => sessionView?.(layer, params),
    runOut: () => { secondsLeft = 0; },
    /** The latest still-armed registration at a delay. */
    fire: (ms: number) => [...timers].reverse().find((t) => t.ms === ms && !t.cleared),
    /** Fires every armed timer registered at a delay, oldest first. */
    tick: (ms: number) => { for (const t of [...timers]) if (t.ms === ms && !t.cleared) t.fn(); },
    /** Fires the teaser poll alone (the fallback delay is the feed's own 10 s tick, R-TE4, distinct from the 20 s paired refresh). */
    poll: () => {
      const armed = [...timers].reverse().find((t) => t.ms === POLL_FALLBACK_MS && !t.cleared && !armedAtMount.has(t));
      if (!armed) throw new Error('no teaser poll is armed');
      armed.fn();
    },
  };
}
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const q = (root: ParentNode, sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);

const submit = (root: ParentNode) => { q(root, 'form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); };

describe('passive public city',()=>{
  it('has no touch discovery, holds a pause through refreshes and yields to explicit presentation',async()=>{
    const cityStore=fakeCityStore({...emptyCity(),places:[{id:'culture-a',name:'Gavella',category:'culture',sourceId:'culture',sourceRecord:'a',lon:15.97,lat:45.81}]});
    let now=NOW;
    const k=mount({stored:STORED,cityStore,now:()=>now});await flush();
    expect(q(k.root,'[data-action=kiosk-explore]')).toBeNull();
    expect(q(k.root,'#kiosk-city-search')).toBeNull();
    const previous=q(k.root,'.k-highlight-content')!.dataset.highlight;
    now+=20_000;k.tick(CODE_TICK_MS);
    const highlight=q(k.root,'.k-highlight-content')!;
    expect(highlight.dataset.highlight).not.toBe(previous);
    q(k.root,'[data-action=pause-highlights]')!.click();
    const content=highlight.textContent;
    cityStore.set({...cityStore.snapshot()});
    now+=90_000;k.tick(CODE_TICK_MS);
    expect(highlight.textContent).toBe(content);
    expect(q(k.root,'[data-action=pause-highlights]')?.getAttribute('aria-pressed')).toBe('true');
    k.handlers.onPresentation?.({version:1,revision:1,target:{layer:'u-pokretu',selection:{kind:'place',id:'culture-a'}},expiresAt:now+600000,dataToken:'dt'});
    await flush();cityStore.set({...cityStore.snapshot()});
    expect(q(k.root,'[data-testid=kiosk-highlight]')).toBeNull();expect(text(q(k.root,'[data-testid=city-detail]'))).toContain('Gavella');
    k.handle.destroy();
  });
});

describe('clipboard copy', () => {
  it('copies the current visible code, including after rotation', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    try {
      let now = NOW;
      const k = mount({ stored: STORED, now: () => now });
      k.handlers.onCodes(batch(NOW), NOW);
      q(k.root, '[data-testid=pair-copy]')!.click();
      await flush();
      expect(write).toHaveBeenLastCalledWith('ABCD-EFG0');
      expect(text(q(k.root, '[data-testid=pair-copy-status]'))).toBe('Kod je kopiran.');
      now += 30_000;
      k.tick(250);
      q(k.root, '[data-testid=pair-copy]')!.click();
      await flush();
      expect(write).toHaveBeenLastCalledWith('ABCD-EFG1');
      k.handle.destroy();
    } finally { write.mockRestore(); }
  });
  it('keeps the visible text available when clipboard access is denied', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    try {
      const k = mount({ stored: STORED });
      k.handlers.onCodes(batch(NOW), NOW);
      q(k.root, '[data-testid=pair-copy]')!.click();
      await flush();
      expect(text(q(k.root, '[data-testid=pair-code]'))).toBe('ABCD·EFG0');
      expect(text(q(k.root, '[data-testid=pair-copy-status]'))).toBe('Kopiranje nije uspjelo.');
      expect((q(k.root, '[data-testid=pair-copy]') as HTMLButtonElement).disabled).toBe(false);
      k.handle.destroy();
    } finally { write.mockRestore(); }
  });
});

describe('versioned explicit public presentation', () => {
  it('the initial idle state preserves the mounted overview and a recent scan notice', async () => {
    const k = mount({ stored: STORED });
    await flush();
    const overview = q(k.root, '[data-testid=kiosk-invitation]');
    const rows = q(k.root, '[data-testid=kiosk-panel-promet]');
    k.handlers.onPresentation?.({ version: 1, revision: 0, target: null, expiresAt: null });
    expect(q(k.root, '[data-testid=kiosk-invitation]')).toBe(overview);
    expect(q(k.root, '[data-testid=kiosk-panel-promet]')).toBe(rows);
    k.handlers.onPaired?.(NOW + 600_000);
    k.handlers.onPresentation?.({ version: 1, revision: 1, target: null, expiresAt: null });
    expect(q(k.root, '[data-testid=kiosk-invitation]')).toBe(overview);
    expect(text(q(k.root, '[data-testid=kiosk-head-mid]'))).toContain('otvoren');
  });
  it('a scan acknowledges access without changing the useful overview or joining a room', async () => {
    const k = mount({ stored: STORED });
    await flush();
    const overview = q(k.root, '[data-testid=kiosk-invitation]');
    const board = q(k.root, '[data-testid=kiosk-panel-promet]');
    k.handlers.onPaired?.(NOW + 600_000);
    expect(k.handle.phase()).toBe('invitation');
    expect(q(k.root, '[data-testid=kiosk-invitation]')).toBe(overview);
    expect(q(k.root, '[data-testid=kiosk-panel-promet]')).toBe(board);
    expect(k.sessions).toHaveLength(0);
    expect(text(q(k.root, '[data-testid=kiosk-head-mid]'))).toContain('otvoren');
    expect(k.handlers.presentationVersion).toBe(1);
  });
  it('renders an explicit route, then acknowledges it after its data is ready', async () => {
    const k = mount({ stored: STORED });
    await flush();
    k.handlers.onPresentation?.({ version: 1, revision: 1, target: { layer: 'u-pokretu', selection: { kind: 'route', id: '6' } }, expiresAt: NOW + 600_000, dataToken: 'v1-test-token' });
    expect(k.beacon.acknowledgePresentation).not.toHaveBeenCalled();
    await flush();
    expect(k.handle.phase()).toBe('paired');
    expect(k.sessions).toHaveLength(0);
    expect(text(q(k.root, '.k-present-board .k-select-main'))).toContain('Črnomerec');
    expect(k.beacon.acknowledgePresentation).toHaveBeenCalledWith(1, 'displayed');
    expect(k.root.innerHTML).not.toContain('v1-test-token');
    expect(q(k.root, '[data-testid=kiosk-stop-presentation]')).not.toBeNull();
    q(k.root, '[data-testid=kiosk-stop-presentation]')!.click();
    expect(k.beacon.stopPresentation).toHaveBeenCalledWith(1);
  });
  it('a second scan and an older frame cannot replace an active presentation', async () => {
    const k = mount({ stored: STORED });
    await flush();
    k.handlers.onPresentation?.({ version: 1, revision: 3, target: { layer: 'zrak-i-nebo' }, expiresAt: NOW + 600_000, dataToken: 'dt' });
    await flush();
    k.handlers.onPaired?.(NOW + 600_000);
    k.handlers.onPresentation?.({ version: 1, revision: 2, target: { layer: 'kultura' }, expiresAt: NOW + 600_000, dataToken: 'old' });
    expect(q(k.root, '[data-testid=kiosk-layer]')!.dataset.layer).toBe('zrak-i-nebo');
    expect(k.sessions).toHaveLength(0);
  });
  it('a missing selected item is explicit and is never acknowledged as displayed', async () => {
    const k = mount({ stored: STORED });
    await flush();
    k.handlers.onPresentation?.({ version: 1, revision: 4, target: { layer: 'kultura', selection: { kind: 'item', module: 'dogadanja', id: '0123456789abcdef' } }, expiresAt: NOW + 600_000, dataToken: 'dt' });
    await flush();
    expect(q(k.root, '[data-testid=k-selection-unavailable]')).not.toBeNull();
    expect(k.beacon.acknowledgePresentation).toHaveBeenCalledWith(4, 'unavailable');
    expect(k.beacon.acknowledgePresentation).not.toHaveBeenCalledWith(4, 'displayed');
  });
  it('updates the receipt when a displayed item disappears and recovers, without repeating unchanged acknowledgements', async () => {
    const k = mount({ stored: STORED });
    await flush();
    const chosen = MODULES.find(m => m.module === 'dogadanja')!.items[0]!;
    k.handlers.onPresentation?.({ version: 1, revision: 5, target: { layer: 'kultura', selection: { kind: 'item', module: 'dogadanja', id: publicItemKey('dogadanja', chosen.id) } }, expiresAt: NOW + 600_000, dataToken: 'dt' });
    await flush();
    expect(text(q(k.root, '[data-testid=k-selection]'))).toContain(chosen.title);
    expect(k.beacon.acknowledgePresentation.mock.calls).toEqual([[5, 'displayed']]);
    k.tick(CODE_TICK_MS);
    k.tick(REFRESH_MS);
    await flush();
    expect(k.beacon.acknowledgePresentation).toHaveBeenCalledTimes(1);

    k.fetchData.mockResolvedValue(snap('dogadanja', []));
    k.tick(REFRESH_MS);
    await flush();
    expect(q(k.root, '[data-testid=k-selection-unavailable]')).not.toBeNull();
    expect(k.beacon.acknowledgePresentation.mock.calls).toEqual([[5, 'displayed'], [5, 'unavailable']]);
    k.tick(CODE_TICK_MS);
    k.tick(REFRESH_MS);
    await flush();
    expect(k.beacon.acknowledgePresentation).toHaveBeenCalledTimes(2);

    k.fetchData.mockResolvedValue(snap('dogadanja', [chosen], 'stale'));
    k.tick(REFRESH_MS);
    await flush();
    expect(text(q(k.root, '[data-testid=k-selection]'))).toContain(chosen.title);
    expect(k.beacon.acknowledgePresentation.mock.calls).toEqual([[5, 'displayed'], [5, 'unavailable'], [5, 'displayed']]);
  });
  it.each([
    { kind: 'item' as const, module: 'prometnice' as const, id: '0123456789abcdef' },
    { kind: 'route' as const, id: '99999' },
    { kind: 'stop' as const, id: 'not-a-stop' },
  ])('a missing transport $kind stays an explicit unavailable subject, not the host route board', async (selection) => {
    const k = mount({ stored: STORED });
    await flush();
    k.handlers.onPresentation?.({ version: 1, revision: 1, target: { layer: 'u-pokretu', selection }, expiresAt: NOW + 600_000, dataToken: 'dt' });
    await flush();
    expect(q(k.root, '.k-present-board [data-testid=k-selection-unavailable]')).not.toBeNull();
    expect(q(k.root, '.k-present-board .k-line')).toBeNull();
    expect(k.beacon.acknowledgePresentation.mock.calls).toEqual([[1, 'unavailable']]);
  });
  it('a selected stop waits for its name, and a failed stop lookup resolves as unavailable', async () => {
    let fail!: (error: Error) => void;
    const k = mount({ stored: STORED, loadStops: () => new Promise((_resolve, reject) => { fail = reject; }) });
    await flush();
    k.handlers.onPresentation?.({ version: 1, revision: 1, target: { layer: 'u-pokretu', selection: { kind: 'stop', id: '200_1' } }, expiresAt: NOW + 600_000, dataToken: 'dt' });
    await flush();
    expect(q(k.root, '[data-testid=k-selection-loading]')).not.toBeNull();
    expect(k.beacon.acknowledgePresentation).not.toHaveBeenCalled();
    fail(new Error('offline'));
    await flush();
    expect(q(k.root, '[data-testid=k-selection-unavailable]')).not.toBeNull();
    expect(k.beacon.acknowledgePresentation.mock.calls).toEqual([[1, 'unavailable']]);
  });
  it('fetches the selected public item even when its source is outside the base layer module list', async () => {
    const k = mount({ stored: STORED });
    await flush();
    const chosen = MODULES.find(m => m.module === 'dogadanja')!.items[0]!;
    k.handlers.onPresentation?.({ version: 1, revision: 1, target: { layer: 'u-pokretu', selection: { kind: 'item', module: 'dogadanja', id: publicItemKey('dogadanja', chosen.id) } }, expiresAt: NOW + 600_000, dataToken: 'dt' });
    await flush();
    expect(k.fetchData).toHaveBeenCalledWith('dogadanja', 'dt');
    expect(text(q(k.root, '.k-present-board [data-testid=k-selection]'))).toContain(chosen.title);
    expect(k.beacon.acknowledgePresentation.mock.calls).toEqual([[1, 'displayed']]);
  });
  it('a repeated pending frame neither restarts loading nor certifies an unfinished render', async () => {
    const k = mount({ stored: STORED });
    await flush();
    let finish!: (snapshot: ModuleSnapshot) => void;
    k.fetchData.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const request = { version: 1 as const, revision: 1, target: { layer: 'kultura' as const }, expiresAt: NOW + 600_000, dataToken: 'dt' };
    k.handlers.onPresentation?.(request);
    const first = q(k.root, '[data-testid=kiosk-layer]');
    k.handlers.onPresentation?.(request);
    expect(q(k.root, '[data-testid=kiosk-layer]')).toBe(first);
    expect(k.fetchData).toHaveBeenCalledTimes(1);
    expect(k.beacon.acknowledgePresentation).not.toHaveBeenCalled();
    finish(snap('dogadanja', []));
    await flush();
    expect(k.beacon.acknowledgePresentation.mock.calls).toEqual([[1, 'displayed']]);
  });
  it('creating a new screen resets revisions and ignores callbacks from the forgotten beacon', async () => {
    const k = mount({ stored: STORED });
    await flush();
    const old = k.handlers;
    old.onPresentation?.({ version: 1, revision: 9, target: { layer: 'kultura' }, expiresAt: NOW + 600_000, dataToken: 'old' });
    await flush();
    old.onPresentation?.({ version: 1, revision: 10, target: null, expiresAt: null });
    old.onRevoked();
    q(k.root, '[data-testid=kiosk-setup-again]')!.click();
    await flush();
    submit(k.root);
    await flush();
    expect(k.handle.phase()).toBe('invitation');
    expect(k.handlers).not.toBe(old);
    old.onPresentation?.({ version: 1, revision: 100, target: { layer: 'sigurnost' }, expiresAt: NOW + 600_000, dataToken: 'forgotten' });
    old.onRevoked();
    expect(k.handle.phase()).toBe('invitation');
    k.handlers.onPresentation?.({ version: 1, revision: 0, target: null, expiresAt: null });
    k.handlers.onPresentation?.({ version: 1, revision: 1, target: { layer: 'u-pokretu', selection: { kind: 'route', id: '6' } }, expiresAt: NOW + 600_000, dataToken: 'fresh' });
    await flush();
    expect(text(q(k.root, '[data-testid=k-selection]'))).toContain('Črnomerec');
    expect(k.beacon.acknowledgePresentation).toHaveBeenLastCalledWith(1, 'displayed');
    expect(k.fetchData.mock.calls.some(call => call[1] === 'forgotten')).toBe(false);
  });
  it('a server stop restores the overview and discards session presentation data', async () => {
    const k = mount({ stored: STORED });
    await flush();
    k.handlers.onPresentation?.({ version: 1, revision: 1, target: { layer: 'kultura' }, expiresAt: NOW + 600_000, dataToken: 'dt' });
    await flush();
    k.handlers.onPresentation?.({ version: 1, revision: 2, target: null, expiresAt: null });
    expect(k.handle.phase()).toBe('invitation');
    expect(q(k.root, '[data-testid=kiosk-layer]')).toBeNull();
    expect(q(k.root, '[data-testid=kiosk-invitation]')).not.toBeNull();
    expect(q(k.root, '[data-testid=kiosk-stop-presentation]')).toBeNull();
  });
  it('keeps a presentation through a dropped screen socket but returns at the grant deadline', async () => {
    let now = NOW;
    const k = mount({ stored: STORED, now: () => now });
    await flush();
    k.handlers.onCodes(batch(NOW), NOW);
    k.handlers.onPresentation?.({ version: 1, revision: 1, target: { layer: 'grad-sada' }, expiresAt: NOW + 12_000, dataToken: 'dt' });
    await flush();
    k.handlers.onStatus('offline');
    expect(k.handle.phase()).toBe('paired');
    now += 12_001;
    k.tick(CODE_TICK_MS);
    expect(k.handle.phase()).toBe('invitation');
  });
});

describe('start: one button, one creation per press', () => {
  it('offers one button and nothing to choose when nothing is provisioned; the strip is already there', () => {
    const k = mount();
    expect(k.handle.phase()).toBe('setup');
    expect(q(k.root, '[data-testid=kiosk-setup]')).not.toBeNull();
    expect(text(q(k.root, 'h1'))).toBe('Pokreni gradski zaslon');
    expect(text(q(k.root, '[data-testid=setup-create]'))).toBe('Pokreni zaslon');
    // No district, no stop, no list to load: the choice moved onto the screen itself.
    expect(q(k.root, 'select[name=district]')).toBeNull();
    expect(k.root.querySelectorAll('input[name=stop]')).toHaveLength(0);
    expect(k.loadStops).not.toHaveBeenCalled();
    expect(k.beacon.connect).not.toHaveBeenCalled();
    // The gear belongs to a screen that exists.
    expect(q(k.root, '[data-testid=kiosk-settings]')!.hidden).toBe(true);
    expect(q(k.root, '[data-testid=kiosk-essentials-open]')).toBeNull(); // the verdict is a plain word while the start screen or a session owns the screen
    expect(q(k.root, 'span.k-strip-verdict[data-testid=strip-verdict]')).not.toBeNull();
    expect(text(q(k.root, '[data-testid=safety-strip]'))).toContain('Sigurnost');
    expect(q(k.root, '[data-testid=kiosk-alert]')!.hidden).toBe(true);
  });
  it('creates the whole-city screen with no area and no stop on one press, and boots the beacon', async () => {
    const createScreen = vi.fn(async () => ({ beaconId: 'NEW00001', secret: 'S3CR3TXYZ', provisionUrl: 'https://zagreb.aningfilm.hr/kiosk/#NEW00001.S3CR3TXYZ', screen: CITY_SCREEN }));
    const k = mount({ createScreen });
    await flush();
    submit(k.root);
    await flush();
    expect(createScreen).toHaveBeenCalledTimes(1);
    expect(createScreen).toHaveBeenCalledWith();
    expect(k.handle.phase()).toBe('invitation');
    expect(JSON.parse(k.raw[BEACON_STORAGE_KEY]!)).toEqual({ beaconId: 'NEW00001', secret: 'S3CR3TXYZ', screen: CITY_SCREEN });
    expect(k.beacon.connect).toHaveBeenCalledTimes(1);
    expect(k.root.innerHTML).not.toContain('S3CR3TXYZ');
    expect(q(k.root, '[data-testid=kiosk-setup]')).toBeNull();
    // A whole-city screen names no place in the header; the gear is there instead.
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('');
    expect(q(k.root, '[data-testid=kiosk-settings]')!.hidden).toBe(false);
  });
  it('a 403 ends in the refused-connection sentence with no retry, a 429 counts its retry down, a network failure offers one; nothing loops', async () => {
    const attempts: unknown[] = [new ScreenError('evaluation-access-required', 403), new ScreenError('screen-limit', 429, 90), new TypeError('Failed to fetch')];
    const createScreen = vi.fn(async () => { throw attempts.shift(); });
    const k = mount({ createScreen });
    await flush();
    submit(k.root);
    await flush();
    expect(text(q(k.root, '[data-testid=setup-error]'))).toBe('Poslužitelj je odbio postavljanje s ove veze. Pokušaj ponovno s druge mreže.');
    expect(q(k.root, '[data-testid=setup-retry]')!.hidden).toBe(true);
    submit(k.root);
    await flush();
    expect(text(q(k.root, '[data-testid=setup-error]'))).toBe('Dosegnut je broj privremenih zaslona za ovaj sat.');
    const retry = q(k.root, '[data-testid=setup-retry]') as HTMLButtonElement;
    expect(retry.hidden).toBe(false);
    expect(retry.disabled).toBe(true);
    expect(retry.textContent).toBe('Pokušaj ponovno za 1:30');
    submit(k.root);
    await flush();
    expect(text(q(k.root, '[data-testid=setup-error]'))).toBe('Poslužitelj nije dostupan. Provjeri vezu i pokušaj ponovno.');
    expect(createScreen).toHaveBeenCalledTimes(3);
    expect(k.handle.phase()).toBe('setup');
    expect(k.beacon.connect).not.toHaveBeenCalled();
  });
});

describe('settings: the panel on the screen itself', () => {
  const open = (k: ReturnType<typeof mount>) => { q(k.root, '[data-testid=kiosk-settings]')!.click(); };
  const panel = (k: ReturnType<typeof mount>) => q(k.root, '[data-testid=kiosk-settings-panel]');

  it('opens from the header gear with the screen’s own area and stop, the whole city first in the list', async () => {
    const k = mount({ stored: STORED });
    await flush();
    expect(panel(k)).toBeNull(); // built on the first press, not at mount
    open(k);
    await flush();
    const box = panel(k)!;
    expect(box.hidden).toBe(false);
    expect([...box.querySelectorAll('.k-settings-row')].map((el) => (el as HTMLElement).dataset.row)).toEqual(['area', 'stop', 'theme', 'screen']);
    const area = q(box, '[data-testid=settings-area]') as HTMLSelectElement;
    expect(area.options).toHaveLength(18);
    expect(area.options[0]!.textContent).toBe('Cijeli grad');
    expect(area.value).toBe('gornji-grad-medvescak');
    // The stop list carries "no stop" and the screen's own stop, checked.
    expect(k.loadStops).toHaveBeenCalledTimes(1);
    const chosen = q(box, 'input[name=settings-stop]:checked') as HTMLInputElement;
    expect(chosen.value).toBe('106_1');
    expect(text(box.querySelector('input[name=settings-stop]')!.parentElement)).toBe('Bez stajališta');
    // Twenty hours from 14:32 is tomorrow morning, so the day goes with the clock.
    expect(text(q(box, '[data-testid=settings-expiry]'))).toBe('Vrijedi do sub 12. 9. 10:32');
    expect(text(q(box, '[data-testid=settings-theme]'))).toBe('Tema: po suncu');
  });

  // A temporary screen is good for 24 hours, so its end is almost always
  // tomorrow -- and a clock with no day reads as "it is over now" at the very
  // hour it matters. Both sides of Zagreb midnight, from the same panel.
  it('names the day with the hour when the screen outlives today, and the hour alone when it does not', async () => {
    const sameDay = JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna', screen: { ...SCREEN, expiresAt: NOW + 2 * 3_600_000 } });
    const today = mount({ stored: sameDay });
    await flush();
    open(today);
    await flush();
    // 14:32 + 2 h is still Friday in Zagreb: the hour says everything.
    expect(text(q(panel(today)!, '[data-testid=settings-expiry]'))).toBe('Vrijedi do 16:32');

    const overMidnight = JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna', screen: { ...SCREEN, expiresAt: NOW + 12 * 3_600_000 } });
    const tomorrow = mount({ stored: overMidnight });
    await flush();
    open(tomorrow);
    await flush();
    // 14:32 + 12 h is 02:32 on Saturday: without the day this reads as the small hours of today.
    expect(text(q(panel(tomorrow)!, '[data-testid=settings-expiry]'))).toBe('Vrijedi do sub 12. 9. 02:32');

    // A screen that never expires says so, with no clock at all.
    const forever = JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna', screen: { kind: 'venue', expiresAt: null, stop: STOP, area: 'zagreb' } });
    const venue = mount({ stored: forever });
    await flush();
    open(venue);
    await flush();
    expect(text(q(panel(venue)!, '[data-testid=settings-expiry]'))).toBe('Vrijedi do opoziva.');
  });

  it('saves the chosen area and stop as one screen-set frame and closes; the DO’s answer re-frames the header', async () => {
    const k = mount({ stored: STORED_CITY });
    await flush();
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('');
    open(k);
    await flush();
    const box = panel(k)!;
    const area = q(box, '[data-testid=settings-area]') as HTMLSelectElement;
    area.value = 'trnje';
    area.dispatchEvent(new Event('change', { bubbles: true }));
    const search = q(box, '[data-testid=settings-search]') as HTMLInputElement;
    search.value = 'zapr';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const zaprude = q(box, 'input[name=settings-stop][value=200_1]') as HTMLInputElement;
    zaprude.checked = true;
    zaprude.dispatchEvent(new Event('change', { bubbles: true }));
    q(box, '[data-testid=settings-save]')!.click();
    expect(k.beacon.setScreen).toHaveBeenCalledTimes(1);
    expect(k.beacon.setScreen).toHaveBeenCalledWith('200_1', 'trnje');
    // The panel waits for the answer rather than claiming the change itself.
    expect(box.hidden).toBe(false);
    expect((q(box, '[data-testid=settings-save]') as HTMLButtonElement).disabled).toBe(true);
    expect(text(q(box, '[data-testid=settings-save]'))).toBe('Spremanje…');
    // Nothing is painted from the panel: the DO's answer is what re-frames the screen.
    k.handlers.onContext?.({ kind: 'temporary', expiresAt: NOW + 20 * 3_600_000, stop: STOPS[2]!, area: 'trnje' });
    expect(box.hidden).toBe(true);
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('Zapruđe');
    expect(JSON.parse(k.raw[BEACON_STORAGE_KEY]!).screen).toMatchObject({ area: 'trnje', stop: { id: '200_1' } });
  });

  it('names the četvrt in the header when the screen has an area and no stop', async () => {
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna', screen: { ...CITY_SCREEN, area: 'trnje' } }) });
    await flush();
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('Trnje');
  });

  it('chooses no stop at all, and says so when the socket cannot carry the change', async () => {
    const k = mount({ stored: STORED });
    await flush();
    open(k);
    await flush();
    const box = panel(k)!;
    const none = box.querySelector('input[name=settings-stop]') as HTMLInputElement;
    none.checked = true;
    none.dispatchEvent(new Event('change', { bubbles: true }));
    k.goOffline();
    q(box, '[data-testid=settings-save]')!.click();
    expect(k.beacon.setScreen).not.toHaveBeenCalled();
    expect(box.hidden).toBe(false);
    expect(text(q(box, '[data-testid=settings-error]'))).toBe('Promjena nije poslana: zaslon trenutačno nema vezu s poslužiteljem. Pokušaj ponovno.');
    expect((q(box, '[data-testid=settings-save]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a refused pair and a repeat inside the DO\u2019s window each keep the panel open with their own sentence', async () => {
    const k = mount({ stored: STORED });
    await flush();
    open(k); await flush();
    const box = panel(k)!;
    const saveBtn = q(box, '[data-testid=settings-save]') as HTMLButtonElement;
    saveBtn.click();
    expect(k.beacon.setScreen).toHaveBeenCalledTimes(1);
    // An error word that belongs to something else on the socket is not this panel's.
    k.handlers.onError?.('bad-frame');
    expect(saveBtn.disabled).toBe(true);
    k.handlers.onError?.('bad-stop');
    expect(box.hidden).toBe(false);
    expect(saveBtn.disabled).toBe(false);
    expect(text(q(box, '[data-testid=settings-error]'))).toBe('Poslužitelj nije prihvatio odabir. Odaberi područje i stajalište ponovno.');
    saveBtn.click();
    k.handlers.onError?.('screen-set-rate');
    expect(box.hidden).toBe(false);
    expect(text(q(box, '[data-testid=settings-error]'))).toBe('Pričekaj koji trenutak pa spremi ponovno.');
    expect(k.beacon.setScreen).toHaveBeenCalledTimes(2);
  });

  it('a save with no answer in eight seconds gives the button back, and the late answer still closes the panel', async () => {
    const k = mount({ stored: STORED });
    await flush();
    open(k); await flush();
    const box = panel(k)!;
    const saveBtn = q(box, '[data-testid=settings-save]') as HTMLButtonElement;
    saveBtn.click();
    expect(k.beacon.setScreen).toHaveBeenCalledTimes(1);
    expect(saveBtn.disabled).toBe(true);
    k.tick(SAVE_TIMEOUT_MS);
    expect(box.hidden).toBe(false);
    expect(saveBtn.disabled).toBe(false);
    expect(text(saveBtn)).toBe('Spremi');
    expect(text(q(box, '[data-testid=settings-error]'))).toBe('Promjena nije poslana: zaslon trenutačno nema vezu s poslužiteljem. Pokušaj ponovno.');
    // Nothing is re-sent by the clock: one press is one screen-set.
    expect(k.beacon.setScreen).toHaveBeenCalledTimes(1);
    // The DO's answer is the truth whenever it lands: late, it re-frames the
    // screen and closes the panel that is still open on it.
    k.handlers.onContext?.({ kind: 'temporary', expiresAt: NOW + 20 * 3_600_000, stop: STOP, area: 'gornji-grad-medvescak' });
    expect(box.hidden).toBe(true);
  });

  it('an expiring screen takes the stage back from an open panel, so the notice is what shows', async () => {
    const k = mount({ stored: STORED });
    await flush();
    open(k); await flush();
    expect(panel(k)!.hidden).toBe(false);
    expect(q(k.root, '[data-testid=kiosk-stage]')!.hidden).toBe(true);
    k.timers.find((t) => t.ms === SCREEN.expiresAt! - NOW && !t.cleared)!.fn();
    expect(k.handle.phase()).toBe('expired');
    expect(panel(k)!.hidden).toBe(true);
    expect(q(k.root, '[data-testid=kiosk-stage]')!.hidden).toBe(false);
    expect(text(q(k.root, '[data-testid=kiosk-notice]'))).toContain('Ovaj privremeni zaslon je istekao.');
    expect(q(k.root, '[data-testid=kiosk-settings]')!.hidden).toBe(true);
  });

  it('closes on Escape, on the close button and after 90 seconds untouched', async () => {
    const k = mount({ stored: STORED });
    await flush();
    open(k); await flush();
    panel(k)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel(k)!.hidden).toBe(true);
    open(k);
    q(panel(k)!, '[data-testid=kiosk-settings-close]')!.click();
    expect(panel(k)!.hidden).toBe(true);
    open(k);
    expect(panel(k)!.hidden).toBe(false);
    k.tick(SETTINGS_IDLE_MS);
    expect(panel(k)!.hidden).toBe(true);
  });

  it('forgets the screen only after an inline confirmation, and never opens over a granted session', async () => {
    const k = mount({ stored: STORED });
    await flush();
    k.handlers.onPresentation?.({ version: 1, revision: 1, target: { layer: 'grad-sada' }, expiresAt: NOW + 600_000, dataToken: 'dt' });
    await flush();
    expect(k.handle.phase()).toBe('paired');
    expect(q(k.root, '[data-testid=kiosk-settings]')!.hidden).toBe(true);
    open(k);
    expect(panel(k)).toBeNull();
    k.handlers.onPresentation?.({ version: 1, revision: 2, target: null, expiresAt: null });
    await flush();
    open(k); await flush();
    const box = panel(k)!;
    q(box, '[data-testid=settings-forget]')!.click();
    expect(q(box, '[data-testid=settings-forget-confirm]')!.hidden).toBe(false);
    q(box, '[data-testid=settings-forget-no]')!.click();
    expect(q(box, '[data-testid=settings-forget-confirm]')!.hidden).toBe(true);
    expect(k.handle.phase()).toBe('invitation');
    q(box, '[data-testid=settings-forget]')!.click();
    q(box, '[data-testid=settings-forget-yes]')!.click();
    expect(k.handle.phase()).toBe('setup');
    expect(k.raw[BEACON_STORAGE_KEY]).toBeUndefined();
    expect(box.hidden).toBe(true);
    expect(k.beacon.close).toHaveBeenCalled();
  });

  it('a stop list that fails to load is one sentence in the panel, and the rest of it still works', async () => {
    const loadStops = vi.fn(async () => { throw new Error('stops-unavailable'); });
    const k = mount({ stored: STORED, loadStops });
    await flush();
    open(k);
    await flush();
    const box = panel(k)!;
    expect(text(q(box, '[data-testid=settings-error]'))).toBe('Popis stanica nije dostupan.');
    expect(box.querySelectorAll('input[name=settings-stop]')).toHaveLength(0);
    expect(loadStops).toHaveBeenCalledTimes(1);
    q(box, '[data-testid=settings-save]')!.click();
    expect(k.beacon.setScreen).toHaveBeenCalledWith('106_1', 'gornji-grad-medvescak');
  });

  it('cycles the theme from the panel, through the one controller the header button uses', async () => {
    const k = mount({ stored: STORED, themeInitial: 'auto' });
    await flush();
    open(k); await flush();
    q(panel(k)!, '[data-testid=settings-theme]')!.click();
    expect(k.themeCalls).toEqual(['light']);
    expect(text(q(panel(k)!, '[data-testid=settings-theme]'))).toBe('Tema: svijetla');
  });
});

describe('invitation: the screen a passer-by sees', () => {
  it('boots the beacon from stored credentials and composes the stop context, the map as the whole left column, the three cards over the invitation, the header ticker and the strip', async () => {
    const k = mount({ stored: STORED });
    await flush();
    expect(k.handle.phase()).toBe('invitation');
    expect(k.beacon.connect).toHaveBeenCalledTimes(1);
    const rootEl = q(k.root, '[data-testid=kiosk]')!;
    expect(rootEl.dataset.size).toBe('wide');
    expect(rootEl.dataset.mode).toBe('teaser');
    // The stage's padding rule reads the phase off the root (kiosk.css): the invitation is edge to edge, the wizard and the notices keep their room.
    expect(rootEl.dataset.phase).toBe('invitation');
    // The chip is the stop's name alone (kajimafix 03.1): a temporary screen's expiry is an operator fact.
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('Trg bana J. Jelačića');
    expect(text(q(k.root, '.k-brand'))).toBe('Kaj ima?');
    expect(text(q(k.root, '.k-lead'))).toBe('Skeniraj za 10 minuta grada.');
    // One field (R-KP1): a labelled section holding the map's box and nothing else on the picture.
    const field = q(k.root, '[data-testid=kiosk-invitation] [data-testid=kiosk-live]')!;
    expect(field.tagName).toBe('SECTION');
    expect(field.classList.contains('k-field')).toBe(true);
    expect(field.getAttribute('aria-label')).toBe('Trg bana J. Jelačića');
    expect([...field.children].map((el) => (el as HTMLElement).dataset.testid)).toEqual(['kiosk-map-host']);
    expect(k.root.querySelectorAll('[data-testid=kiosk-live]')).toHaveLength(1);
    // The front page: the map the whole left column, the aside of weather, the network's exceptions and tonight over the card (kiosk/invitation.ts).
    const front = q(k.root, '[data-testid=kiosk-invitation]')!;
    expect(front.className).toBe('k-city-window');
    expect([...front.children].map((el) => (el as HTMLElement).dataset.panel ?? el.className)).toEqual(['k-handheld-info', 'k-geography', 'k-overview']);
    expect(q(front, '.k-geography .k-field')).not.toBeNull();
    const column = q(front, '.k-overview')!;
    expect(column.tagName).toBe('ASIDE');
    expect([...column.children].map((el) => (el as HTMLElement).dataset.panel ?? el.className)).toEqual(['weather', 'k-highlight','k-panel--card']);
    expect(q(column, '.k-panel--card [data-testid=kiosk-invite]')).not.toBeNull();
    // The three panels the front page dropped are the paired compositions' now: closures are on the map and in the ticker.
    for (const gone of ['around', 'city']) expect(q(front, `[data-testid=kiosk-panel-${gone}]`), gone).toBeNull();
    // The promet card is exceptions only: the one route whose median a rider would notice, and the closures counted beside it.
    const highlight = q(front, '[data-testid=kiosk-highlight]')!;
    expect(text(highlight)).toContain('Ilica');
    expect(text(highlight)).toContain('Grad Zagreb');
    expect(q(front,'[data-testid=kiosk-panel-promet]')).toBeNull();
    // The weather card: the observation, and an honest word where the forecast would be (this teaser carries none).
    expect(text(q(front, '[data-testid=kiosk-panel-weather] .k-weather-current .k-temp'))).toBe('21 °C');
    expect(text(q(front, '[data-testid=kiosk-panel-weather] .k-panel-note'))).toBe('Učitavanje podataka DHMZ-a…');
    expect(q(front, '[data-testid=kiosk-panel-tonight]')).toBeNull();
    for (const gone of ['kiosk-scene', 'kiosk-scene-meta', 'kiosk-tiles', 'tile-vehicles', 'tile-closures', 'kiosk-tonight', 'kiosk-city', 'k-city-ink']) expect(q(k.root, `[data-testid=${gone}]`), gone).toBeNull();
    for (const gone of ['.k-scene', '.k-rail', '.k-side-tiles', '.k-dot', '.k-scene-head']) expect(q(k.root, gone), gone).toBeNull();
    // The header's middle says the city in one line (kiosk/ticker.ts); the weather is the card's and nowhere else.
    expect(q(k.root,'[data-testid=kiosk-ticker]')).toBeNull();
    expect(q(k.root,'.k-map-legend')).not.toBeNull();
    expect(q(k.root, '[data-testid=kiosk-weather]')).toBeNull();
    expect(k.root.querySelectorAll('.k-weather-current .k-temp')).toHaveLength(1);
    const strip = text(q(k.root, '[data-testid=safety-strip]'));
    expect(strip).toContain('žuto upozorenje · Grmljavina');
    expect(strip).not.toContain('zatvaranj'); // closures are the column's (kajimafix 03.5)
    expect(strip).toContain('Trg bana J. Jelačića 3');
    expect(k.root.querySelectorAll('canvas')).toHaveLength(0);
    expect(k.root.innerHTML).not.toContain('tajna');
    expect(text(q(k.root, '[data-testid=kiosk-clock]'))).toBe('14:32');
  });
  it('shows the current code as two groups with a QR of the scan URL and its payload link, and asks for more when low', () => {
    const k = mount({ stored: STORED });
    k.handlers.onCodes(batch(NOW), NOW);
    expect(text(q(k.root, '[data-testid=code-a]'))).toBe('ABCD');
    expect(text(q(k.root, '[data-testid=code-b]'))).toBe('EFG0');
    expect(text(q(k.root, '[data-testid=pair-code]'))).toBe('ABCD·EFG0');
    const qr = q(k.root, '[data-testid=kiosk-qr] .qr')!;
    expect(qr.getAttribute('role')).toBe('img');
    expect(qr.getAttribute('aria-label')).toContain('A B C D, E F G 0');
    expect(k.root.querySelector('svg')).not.toBeNull();
    const link = q(k.root, '[data-testid=pair-url]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://zagreb.aningfilm.hr/s/#ABCD-EFG0');
    expect(link.hidden).toBe(false);
    expect(q(k.root, '[data-testid=code-progress]')!.dataset.pct).toBe('1.00');
    k.handlers.onCodes(batch(NOW - 17 * 30_000), NOW);
    expect(k.beacon.requestMore).toHaveBeenCalledTimes(1);
  });
  it('keeps the link out of the page and the QR waiting until a code exists; the bar is quantised under reduced motion', () => {
    const k = mount({ stored: STORED, reducedMotion: true });
    expect((q(k.root, '[data-testid=pair-url]') as HTMLAnchorElement).hidden).toBe(true);
    expect(text(q(k.root, '[data-testid=kiosk-qr]'))).toBe('Kod stiže…');
    k.handlers.onCodes(batch(NOW - 7_000), NOW);
    expect(q(k.root, '[data-testid=code-progress]')!.dataset.pct).toBe('0.80');
  });
  it('only the header ticker rotates (R-KP1, R-KP11): the ticks at mount are the 1 s clock, the poll and the 20 s paired refresh, the strip counts nothing down, and twenty seconds change nothing on the page itself', async () => {
    let now = NOW;
    const k = mount({ stored: STORED, now: () => now });
    await flush();
    // The clock, the teaser poll, the paired refresh and the screen's own expiry: no rotation clock among them.
    expect(k.timers.map((t) => t.ms).sort((a, b) => a - b)).toEqual([CODE_TICK_MS, POLL_FALLBACK_MS, REFRESH_MS, SCREEN.expiresAt! - NOW]);
    expect(REFRESH_MS).toBe(20_000);
    // The strip's countdown element survives until wave B removes it from frame.ts; the controller passes it no rotation, so it is hidden and empty.
    const next = q(k.root, '[data-testid=strip-next]');
    expect(next?.hidden ?? true).toBe(true);
    expect(text(next)).toBe('');
    const before = k.root.querySelector('[data-testid=kiosk-invitation]')!.innerHTML;
    k.tick(REFRESH_MS);
    expect(k.root.querySelector('[data-testid=kiosk-invitation]')!.innerHTML).toBe(before);
    expect(k.timers.filter((t) => t.ms === CODE_TICK_MS && !t.cleared)).toHaveLength(1);
    // The one thing that does move: the header's line, one item per 8 s period, with the page beneath it untouched.
    const highlight = q(k.root, '.k-highlight-content')!;
    const firstKey = highlight.dataset.highlight;
    now += 19_000;k.tick(CODE_TICK_MS);
    expect(highlight.dataset.highlight).toBe(firstKey);
    expect(q(k.root,'[data-testid=kiosk-ticker]')).toBeNull();
    now += 1_000;k.tick(CODE_TICK_MS);
    expect(highlight.dataset.highlight).toBe(firstKey);
    expect(text(highlight)).toContain('Ilica');
  });
  it('the pairing notice borrows the header\u2019s middle and gives it back: the ticker returns when the notice expires', async () => {
    let now = NOW;
    const k = mount({ stored: STORED, now: () => now });
    await flush();
    const headMid = q(k.root, '[data-testid=kiosk-head-mid]')!;
    expect(q(headMid, '[data-testid=kiosk-ticker]')).toBeNull();
    const highlight=q(k.root,'.k-highlight-content')!;
    const key=highlight.dataset.highlight;
    // A phone pairs: the notice speaks, and it speaks as a status region, so the ticker stands aside.
    k.handlers.onPaired!();
    expect(text(headMid)).toBe('Pogled je otvoren na tvom uređaju.');
    expect(headMid.getAttribute('role')).toBe('status');
    k.tick(CODE_TICK_MS);
    expect(q(headMid, '[data-testid=kiosk-ticker]')).toBeNull();
    // Four and a half seconds later the notice is done -- and takes its role with it, or the middle reads as taken for the life of the screen.
    now += 5_000;
    k.tick(CODE_TICK_MS);
    expect(headMid.getAttribute('role')).toBeNull();
    expect(q(headMid, '[data-testid=kiosk-ticker]')).toBeNull();
    expect(highlight.dataset.highlight).toBe(key);
  });
  it('stores fresher screen metadata from the beacon beside the same secret and names the stop, nothing else', () => {
    const k = mount({ hash: '#BEACON01.tajna' });
    expect(JSON.parse(k.raw[BEACON_STORAGE_KEY]!)).toEqual({ beaconId: 'BEACON01', secret: 'tajna' });
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('');
    // Without a stop the field is labelled by the lines title, never left nameless.
    expect(q(k.root, '[data-testid=kiosk-live]')!.getAttribute('aria-label')).toBe('Linije s ove stanice');
    k.handlers.onContext!({ kind: 'venue', expiresAt: null, stop: STOP });
    expect(JSON.parse(k.raw[BEACON_STORAGE_KEY]!)).toEqual({ beaconId: 'BEACON01', secret: 'tajna', screen: { kind: 'venue', expiresAt: null, stop: STOP } });
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe(STOP.name);
    expect(q(k.root, '[data-testid=kiosk-live]')!.getAttribute('aria-label')).toBe(STOP.name);
  });
  it('the strip keeps its two cells in one wrapping box and never steps the type down; closures are the column\'s, not the strip\'s', async () => {
    const k = mount({ stored: STORED, viewport: { width: 1366, height: 768 } });
    await flush();
    const strip = q(k.root, '[data-testid=safety-strip]')!;
    expect(q(strip, '[data-testid=strip-items] [data-testid=strip-warning]')).not.toBeNull();
    expect(q(strip, '[data-testid=strip-items] [data-testid=strip-pharmacy]')).not.toBeNull();
    expect(strip.className).not.toContain('k-strip--tight');
    expect(strip.className).not.toContain('k-strip--nonext');
    // Closures are said once, in the column (kajimafix 03.5); the strip carries none.
    expect(q(strip, '[data-testid=strip-closures]')).toBeNull();
  });
  it('lightweight: the map host is hidden, the lines board is the field with the stop\'s lines, nothing is a canvas, and the column still says', async () => {
    const k = mount({ stored: STORED, lightweight: true });
    await flush();
    const field = q(k.root, '[data-testid=kiosk-live]')!;
    expect(field.dataset.board).toBe('1');
    expect(q(field, '[data-testid=kiosk-map-host]')!.hidden).toBe(true);
    const board = q(field, '[data-testid=kiosk-lines]')!;
    expect(board.classList.contains('k-lines--board')).toBe(true);
    expect(board.querySelectorAll('li.k-line')).toHaveLength(9);
    expect(text(board)).toContain('kasni 4 min');
    expect(k.root.querySelectorAll('canvas')).toHaveLength(0);
    // The promet card does not repeat the board's rows (R-L2); the other cards stand.
    expect(q(k.root, '[data-testid=kiosk-panel-promet] li.k-fr')).toBeNull();
    expect(text(q(k.root, '[data-testid=kiosk-panel-weather] .k-weather-current .k-temp'))).toBe('21 °C');
    // Ten rows at most, then "još N" (R-V1, e2e/lagano.spec.ts): the board's cap is its own, not the composition's slot count.
    const eleven = MODULES.map((m) => (m.module === 'zet-rt' ? snap('zet-rt', Array.from({ length: 11 }, (_, i) => item('zet-rt', `vehicle:${i}`, 'vehicle', String(i + 1), { geo: { type: 'Point', coordinates: [15.977, 45.813] }, data: { routeId: String(i + 1), routeType: 0 } }))) : m));
    const many = mount({ hash: '#BEACON01.tajna', lightweight: true, fetchTeaser: async () => ({ modules: eleven }) });
    await flush();
    expect(many.root.querySelectorAll('[data-testid=kiosk-live] li.k-line')).toHaveLength(10);
    expect(text(q(many.root, '[data-testid=kiosk-live] .k-line-more'))).toBe('još 1 linija');
  });
});

async function pairedKiosk(opts: MountOptions = {}) {
  const k = mount({ stored: STORED, ...opts });
  await flush();
  k.handlers.onCodes(batch(NOW), NOW);
  k.handlers.onUnlocked({ roomId: 'r1', ticket: 't1', expiresAt: NOW + 600_000 });
  await flush();
  return k;
}

describe('paired: the phone steers, the screen mirrors glanceably', () => {
  it('joins the room on unlock, shows the overview with the map column, the session label and the join QR, and hides the basics button', async () => {
    const k = await pairedKiosk();
    expect(k.handle.phase()).toBe('paired');
    expect(q(k.root, '[data-testid=kiosk]')!.dataset.mode).toBe('unlocked');
    expect(q(k.root, '[data-testid=kiosk-layer]')!.dataset.layer).toBe('grad-sada');
    expect(q(k.root, '[data-testid=kiosk-layer] [data-testid=kiosk-main]')).not.toBeNull();
    const label = q(k.root, '[data-testid=session-label]')!;
    expect(label.dataset.expiresAt).toBe(String(NOW + 600_000));
    expect(text(label)).toBe('Otključano do 14:42 · Sada');
    expect(q(k.root, '[data-testid=kiosk-qr] .qr')).not.toBeNull();
    expect(text(q(k.root, '[data-testid=pair-code]'))).toBe('ABCD·EFG0');
    expect(q(k.root, '[data-testid=kiosk-essentials-open]')).toBeNull(); // the verdict is a plain word while the wizard or a session owns the screen
    expect(q(k.root, 'span.k-strip-verdict[data-testid=strip-verdict]')).not.toBeNull();
    // The Sada *rail* holds the warnings and the closures only -- Vrijeme's own
    // block belongs to the zrak-i-nebo layer -- and a session owns the header's
    // middle: no ticker beside the pill.
    expect(q(k.root, '[data-testid=kiosk-layer] [data-testid=k-weather]')).toBeNull();
    expect(q(k.root, '[data-testid=kiosk-ticker]')).toBeNull();
    expect(text(q(k.root, '[data-testid=k-warnings]'))).toContain('Grmljavina');
    expect(k.fetchData).toHaveBeenCalled();
    expect(q(k.root, '[data-testid=kiosk-invitation]')).toBeNull();
  });
  // Ruling 18: the header's weather group is gone for good (WP3), so the paired
  // Sada must carry the city's weather itself. It does -- renderSada's main
  // column is front.ts's own cards, and the VRIJEME card is the observation as
  // its figure with today's and tomorrow's ranges under it, capped at the two
  // rows the paired column holds. This case is the proof that the one weather
  // a paired screen shows is really on the screen.
  it('the paired Sada carries the city weather itself: the observation as the figure, today and tomorrow as its two rows', async () => {
    const withForecast = [...MODULES, snap('dhmz-forecast', [
      item('dhmz-forecast', 'f-today', 'forecast', 'Prognoza 11.9.', { at: '2026-09-11T00:00:00Z', data: { tmin: 16, tmax: 25 } }),
      item('dhmz-forecast', 'f-tomorrow', 'forecast', 'Prognoza 12.9.', { at: '2026-09-12T00:00:00Z', data: { tmin: 13, tmax: 27 } }),
      item('dhmz-forecast', 'f-later', 'forecast', 'Prognoza 13.9.', { at: '2026-09-13T00:00:00Z', data: { tmin: 12, tmax: 26 } }),
    ])];
    const k = await pairedKiosk({ modules: withForecast });
    expect(q(k.root, '[data-testid=kiosk-layer]')!.dataset.layer).toBe('grad-sada');
    const weather = q(k.root, '[data-testid=kiosk-layer] [data-testid=kiosk-main] [data-panel=weather]')!;
    expect(weather).not.toBeNull();
    expect(text(q(weather, '.k-panel-kicker'))).toBe('Vrijeme');
    // The reading the header used to carry, now inside the card.
    expect(text(q(weather, '.k-weather-current .k-temp'))).toBe('21 °C');
    expect(text(q(weather, '.k-condition'))).toBe('vedro');
    expect(text(q(weather, '.k-panel-meta'))).toBe('DHMZ · 14:00');
    // Sized for the paired column: two ranges, never the whole forecast run.
    const rows = [...weather.querySelectorAll('.k-panel-rows .k-fr')];
    expect(rows.map((row) => text(row.querySelector('.k-fr-lead')))).toEqual(['danas', 'sutra']);
    expect(rows.map((row) => text(row.querySelector('.k-fr-title')))).toEqual(['16 do 25 °C', '13 do 27 °C']);
    expect(q(weather, '.k-panel-note')).toBeNull();
  });
  it('on a calm day the Sada column gives the closures the whole column and shows no warnings block: green notices stay one line on the strip', async () => {
    const calm = MODULES.map((m) => (m.module === 'dhmz-cap' ? snap('dhmz-cap', [item('dhmz-cap', 'w1', 'warning', 'Zeleno upozorenje za vjetar', { severity: 'minor' })]) : m));
    const k = await pairedKiosk({ modules: calm });
    expect(q(k.root, '[data-testid=kiosk-layer]')!.dataset.layer).toBe('grad-sada');
    expect(q(k.root, '[data-testid=k-warnings]')).toBeNull();
    expect(q(k.root, '[data-testid=k-closures]')).not.toBeNull();
    expect(text(q(k.root, '[data-testid=strip-verdict]'))).toBe('mirno');
  });
  it('under a yellow warning the wide Sada column leads with the warning and keeps it in the strip', async () => {
    const k = await pairedKiosk();
    expect(q(k.root, '[data-testid=k-warnings]')).not.toBeNull();
    expect(text(q(k.root, '[data-testid=safety-strip]'))).toContain('Grmljavina');
  });
  it('compact Sada keeps a useful local summary and an explicit warning in the permanent safety strip', async () => {
    const k = await pairedKiosk({ viewport: { width: 1366, height: 768 } });
    expect(q(k.root, '[data-testid=kiosk]')!.dataset.size).toBe('compact');
    expect(text(q(k.root, '.k-rail-summary'))).toContain('Ilica');
    expect(text(q(k.root, '[data-testid=safety-strip]'))).toContain('Grmljavina');
    expect(q(k.root, '.k-strip-hitno')?.getAttribute('href')).toBe('/hitno');
    expect(q(k.root, '[data-testid=k-closures]')).toBeNull();
    expect(q(k.root, '[data-testid=strip-closures]')).toBeNull();
  });
  it('mirrors each of the six domains with its own blocks; the join QR survives every layer change', async () => {
    const k = await pairedKiosk();
    const expectations: [string, string[]][] = [
      ['u-pokretu', ['kiosk-lines', 'kiosk-map-host']],
      ['zrak-i-nebo', ['k-weather', 'k-forecast', 'k-sun', 'k-quakes', 'k-warnings']],
      ['sigurnost', ['k-warnings', 'k-closures', 'k-quakes', 'k-assembly', 'k-pharmacies']],
      ['uprava-i-pravo', ['k-acts', 'k-sessions', 'k-works']],
      ['kultura', ['k-today', 'k-tomorrow', 'k-later', 'k-notices']],
    ];
    for (const [layer, ids] of expectations) {
      k.view(layer);
      await flush();
      expect(q(k.root, '[data-testid=kiosk-layer]')!.dataset.layer).toBe(layer);
      for (const id of ids) expect(q(k.root, `[data-testid=${id}]`), `${layer} ${id}`).not.toBeNull();
      expect(q(k.root, '[data-testid=kiosk-qr] .qr'), layer).not.toBeNull();
    }
    expect(q(k.root, '[data-testid=kiosk-layer] [data-testid=kiosk-map-host]')).toBeNull();
  });
});

describe('paired: selection and ending', () => {
  it('names the public selection the phone relayed -- a route, a stop, an item -- and ignores anything private', async () => {
    const k = await pairedKiosk();
    k.view('u-pokretu', { kind: 'route', id: '6' });
    await flush();
    const route = text(q(k.root, '[data-testid=k-selection]'));
    expect(route).toContain('Odabrano na telefonu');
    expect(route).toContain('kasni 4 min');
    expect(route).toContain('12 vozila');
    k.view('u-pokretu', { kind: 'stop', id: '200_1' });
    await flush();
    expect(k.loadStops).toHaveBeenCalledTimes(1);
    expect(text(q(k.root, '[data-testid=k-selection]'))).toContain('Zapruđe');
    k.view('uprava-i-pravo', { kind: 'item', id: publicItemKey('dogadanja', 'skupstina:13'), module: 'dogadanja' });
    await flush();
    expect(text(q(k.root, '[data-testid=k-selection]'))).toContain('13. sjednica');
    k.view('uprava-i-pravo', { q: 'private search', lat: '45.8' });
    await flush();
    expect(q(k.root, '[data-testid=k-selection]')).toBeNull();
    expect(k.root.innerHTML).not.toContain('private search');
  });
  it('returns to the invitation on expiry with the label gone and the room closed; a mid-session hand-off closes the earlier room', async () => {
    const k = await pairedKiosk();
    k.handlers.onUnlocked({ roomId: 'r2', ticket: 't2', expiresAt: NOW + 600_000 });
    await flush();
    expect(k.sessions).toHaveLength(2);
    expect(k.sessions[0]!.close).toHaveBeenCalledTimes(1);
    expect(k.sessions[1]!.close).not.toHaveBeenCalled();
    k.expire();
    expect(k.handle.phase()).toBe('invitation');
    expect(q(k.root, '[data-testid=session-label]')).toBeNull();
    expect(q(k.root, '[data-testid=kiosk-invitation]')).not.toBeNull();
    expect(text(q(k.root, '[data-testid=pair-code]'))).toBe('ABCD·EFG0');
    expect(k.sessions[1]!.close).toHaveBeenCalledTimes(1);
  });
  it('re-polls the layer on every 20 s tick while paired and returns on its own when the room clock ran out without an expired frame', async () => {
    const k = await pairedKiosk();
    k.fetchData.mockClear();
    k.tick(REFRESH_MS);
    await flush();
    expect(k.fetchData).toHaveBeenCalled();
    expect(k.handle.phase()).toBe('paired');
    k.runOut();
    k.tick(REFRESH_MS);
    expect(k.handle.phase()).toBe('invitation');
    expect(k.sessions[0]!.close).toHaveBeenCalled();
  });
});

describe('expiry and revocation: no codes, no loop, one manual way back', () => {
  it('a stored screen already past its 24 h never connects and shows the expired notice; the button forgets it and opens the wizard', () => {
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna', screen: { ...SCREEN, expiresAt: NOW - 1 } }) });
    expect(k.handle.phase()).toBe('expired');
    expect(k.beacon.connect).not.toHaveBeenCalled();
    expect(text(q(k.root, '[data-testid=kiosk-notice]'))).toContain('Ovaj privremeni zaslon je istekao.');
    expect(q(k.root, '[data-testid=pair-code]')).toBeNull();
    q(k.root, '[data-testid=kiosk-setup-again]')!.click();
    expect(k.handle.phase()).toBe('setup');
    expect(k.raw[BEACON_STORAGE_KEY]).toBeUndefined();
    expect(k.createScreen).not.toHaveBeenCalled();
  });
  it('the expiry clock ends the codes at 24 h but never an active grant: the session runs to its end, then the notice shows', async () => {
    const k = await pairedKiosk();
    const expiry = k.timers.find((t) => t.ms === SCREEN.expiresAt! - NOW && !t.cleared)!;
    expect(expiry).toBeDefined();
    expiry.fn();
    expect(k.handle.phase()).toBe('paired');
    expect(q(k.root, '[data-testid=session-label]')).not.toBeNull();
    expect(q(k.root, '[data-testid=kiosk-qr] .qr')).toBeNull();
    expect(text(q(k.root, '[data-testid=kiosk-qr]'))).toBe('Otvorena sesija traje do svog kraja; zaslon zatim prestaje izdavati kodove.');
    expect(k.beacon.close).toHaveBeenCalledTimes(1);
    k.expire();
    expect(k.handle.phase()).toBe('expired');
    expect(k.createScreen).not.toHaveBeenCalled();
  });
  it('a revoked frame ends the codes and shows the revoked notice on an unpaired screen', () => {
    const k = mount({ stored: STORED });
    k.handlers.onCodes(batch(NOW), NOW);
    k.handlers.onRevoked();
    expect(k.handle.phase()).toBe('revoked');
    expect(text(q(k.root, '[data-testid=kiosk-notice]'))).toContain('Ovaj je zaslon isključen.');
    expect(q(k.root, '[data-testid=kiosk-qr]')).toBeNull();
    expect(q(k.root, '[data-testid=kiosk-essentials-open]')!.hidden).toBe(false);
  });
  it('a fresh screen after starting over rotates only its own codes', async () => {
    const k = mount({ stored: JSON.stringify({ beaconId: 'OLD00001', secret: 'stara', screen: { ...SCREEN, expiresAt: NOW - 1 } }) });
    q(k.root, '[data-testid=kiosk-setup-again]')!.click();
    await flush();
    submit(k.root);
    await flush();
    expect(k.handle.phase()).toBe('invitation');
    expect(k.createScreen).toHaveBeenCalledTimes(1);
    k.handlers.onCodes(batch(NOW), NOW);
    expect(text(q(k.root, '[data-testid=pair-code]'))).toBe('ABCD·EFG0');
  });
});

describe('basics: sessionless, one touch, 90 s idle only outside a grant', () => {
  it('opens with the five rows, re-arms on a touch, closes on Escape with focus back, and closes on its own after 90 s', async () => {
    const k = mount({ stored: STORED });
    await flush();
    const open = q(k.root, '[data-testid=kiosk-essentials-open]') as HTMLButtonElement;
    expect(open.hidden).toBe(false);
    open.click();
    const panel = q(k.root, '[data-testid=kiosk-essentials]')!;
    expect(panel.hidden).toBe(false);
    expect(q(k.root, '[data-testid=kiosk-stage]')!.hidden).toBe(true);
    expect(document.activeElement?.id).toBe('ess-title');
    const labels = [...k.root.querySelectorAll('[data-testid=ess-row] .k-ess-label')].map((el) => text(el));
    expect(labels).toEqual(['Upozorenja', 'Zatvorene prometnice', 'Linije u blizini', 'Vrijeme sada', 'Dežurna ljekarna']);
    expect(text(q(k.root, '[data-row=pharmacy]'))).toContain('Ljekarna Centar, Ilica 1');
    expect([...k.root.querySelectorAll('.ess-attr')].every((el) => !(el.textContent ?? '').includes('{'))).toBe(true);
    expect(ESSENTIALS_IDLE_MS).toBe(90_000);
    const first = k.fire(ESSENTIALS_IDLE_MS)!;
    panel.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(first.cleared).toBe(true);
    expect(k.fire(ESSENTIALS_IDLE_MS)).not.toBe(first);
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.hidden).toBe(true);
    expect(q(k.root, '[data-testid=kiosk-stage]')!.hidden).toBe(false);
    expect(document.activeElement).toBe(open);
    open.click();
    k.fire(ESSENTIALS_IDLE_MS)!.fn();
    expect(panel.hidden).toBe(true);
  });
  it('never opens over a grant (the verdict is a plain word then, not a button), and the close button closes it', async () => {
    const k = await pairedKiosk();
    expect(q(k.root, '[data-testid=kiosk-essentials-open]')).toBeNull();
    expect(q(k.root, '[data-testid=kiosk-essentials]')!.hidden).toBe(true);
    k.expire();
    (q(k.root, '[data-testid=kiosk-essentials-open]') as HTMLButtonElement).click();
    expect(q(k.root, '[data-testid=kiosk-essentials]')!.hidden).toBe(false);
    (q(k.root, '[data-testid=kiosk-essentials-close]') as HTMLButtonElement).click();
    expect(q(k.root, '[data-testid=kiosk-essentials]')!.hidden).toBe(true);
  });
  it('with every source down the panel says so once and points at /hitno', async () => {
    const down = (module: ModuleId): ModuleSnapshot => snap(module, [], 'down');
    const k = mount({ stored: STORED, fetchTeaser: async () => ({ modules: (['dhmz-cap', 'prometnice', 'zet-rt', 'dhmz-now', 'ckan-geo'] as ModuleId[]).map(down) }) });
    await flush();
    (q(k.root, '[data-testid=kiosk-essentials-open]') as HTMLButtonElement).click();
    expect(k.root.querySelectorAll('[data-testid=ess-row]')).toHaveLength(1);
    expect(text(q(k.root, '[data-testid=kiosk-essentials-rows]'))).toBe('Izvor trenutačno ne odgovara. Sigurnosni sloj radi na /hitno.');
    expect(text(q(k.root, '[data-testid=strip-warning]'))).toBe('Upozorenja DHMZ-a: podaci trenutačno nedostupni');
  });
});

describe('alerts, polling, the first tap and disposal', () => {
  it('a cold screen waits for readings: every card says it is loading, no row is invented, and the header says nothing', async () => {
    const k = mount({ stored: STORED, fetchTeaser: () => new Promise(() => {}) });
    await flush();
    // Nothing has answered: no exception is claimed, no range is invented, and no venue is listed.
    expect(k.root.querySelectorAll('[data-testid=kiosk-invitation] li.k-fr')).toHaveLength(0);
    expect(text(q(k.root, '[data-testid=kiosk-highlight]'))).toContain('Čekamo gradske podatke');
    expect(text(q(k.root, '[data-testid=kiosk-panel-weather] .k-panel-note'))).toBe('Učitavanje podataka DHMZ-a…');
    expect(text(q(k.root, '[data-testid=kiosk-panel-weather] .k-weather-note'))).toBe('Učitavanje podataka DHMZ-a…');
    // A ticker with nothing to say is not there at all: the header never prints an empty line.
    expect(q(k.root, '[data-testid=kiosk-ticker]')).toBeNull();
    k.handle.destroy();
  });
  it('the paired safety strip agrees with the live session copy when the preview request fails', async () => {
    let fail = false;
    const k = mount({ stored: STORED, fetchTeaser: async () => {
      if (fail) throw new Error('preview unavailable');
      return { modules: MODULES };
    } });
    await flush();
    k.handlers.onCodes(batch(NOW), NOW);
    k.handlers.onUnlocked({ roomId: 'r1', ticket: 't1', expiresAt: NOW + 600_000 });
    await flush();
    k.view('sigurnost');
    await flush();
    fail = true;
    k.tick(POLL_FALLBACK_MS);
    await flush();
    expect(q(k.root, '[data-testid=k-warnings]')!.dataset.status).toBe('live');
    expect(text(q(k.root, '[data-testid=kiosk-alert]'))).toBe('Osvježavanje pregleda zaslona nije uspjelo.');
    expect(text(q(k.root, '[data-testid=strip-warning]'))).not.toContain('zastarjelo');
    expect(text(q(k.root, '[data-testid=strip-warning]'))).toContain('Grmljavina');
  });
  it('a thrown teaser fetch marks every last-good copy stale, holds the map and hands the column the stale copies; the next good answer brings it back', async () => {
    let fail = false;
    const calls: string[] = [];
    const handle = { update: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(), setFeedState: (s: string) => { calls.push(s); } };
    const k = mount({ stored: STORED, mapFactory: vi.fn(() => handle) as never, fetchTeaser: async () => { if (fail) throw new TypeError('Failed to fetch'); return { modules: MODULES }; } });
    await flush();
    expect(calls.at(-1)).toBe('live');
    expect(q(k.root, '[data-testid=strip-closures]')).toBeNull();
    fail = true;
    k.poll();
    await flush();
    expect(calls.at(-1)).toBe('stale');
    expect(q(k.root, '[data-testid=kiosk-alert]')!.hidden).toBe(false);
    expect(text(q(k.root, '[data-testid=strip-warning]'))).toBe('žuto upozorenje · Grmljavina · zastarjelo');
    // The panels are told, source by source: the last-good copies are stale (the lines panel says so in its credit), and the field is still one field with its map.
    expect(text(q(k.root,'[data-testid=kiosk-highlight]'))).not.toContain('Ilica');
    expect(text(q(k.root, '[data-testid=kiosk-panel-weather] .k-panel-meta'))).toContain('zastarjelo');
    expect(q(k.root, '[data-testid=kiosk-live] [data-testid=kiosk-map]')).not.toBeNull();
    fail = false;
    k.poll();
    await flush();
    expect(calls.at(-1)).toBe('live');
    expect(text(q(k.root,'[data-testid=kiosk-highlight]'))).toContain('Ilica');
    expect(q(k.root, '[data-testid=kiosk-alert]')!.hidden).toBe(true);
  });
  it('a fetch that never succeeded reads as down once it fails: unknown, not loading and never clear', async () => {
    const k = mount({ stored: STORED, fetchTeaser: async () => { throw new Error('down'); } });
    await flush();
    expect(text(q(k.root, '[data-testid=strip-warning]'))).toBe('Upozorenja DHMZ-a: podaci trenutačno nedostupni');
    // Every card reads its source as down (never absent, which would read as loading): the honest word in rose, no loading word anywhere.
    expect(q(k.root,'[data-testid=kiosk-panel-weather]')!.dataset.state).toBe('down');
    expect(text(q(k.root,'[data-testid=kiosk-highlight]'))).toContain('Čekamo gradske podatke');
    expect(text(q(k.root, '[data-testid=kiosk-invitation]'))).not.toContain('Učitavanje');
    // No source answers, so the header's line has nothing to say and is not drawn; no dash stands in for the reading.
    expect(q(k.root, '[data-testid=kiosk-ticker]')).toBeNull();
    expect(text(q(k.root, '.k-head'))).not.toMatch(/[\u2013\u2014]/);
  });
  it('a failed session request leaves its copy stale and the teaser\u2019s live copy speaks; only when both fail does the map hold', async () => {
    let failZet = false;
    let failTeaser = false;
    const calls: string[] = [];
    const handle = { update: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(), setFeedState: (s: string) => { calls.push(s); } };
    const k = mount({ stored: STORED, mapFactory: vi.fn(() => handle) as never, fetchTeaser: async () => { if (failTeaser) throw new Error('down'); return { modules: MODULES }; } });
    k.fetchData.mockImplementation(async (module: ModuleId) => { if (module === 'zet-rt' && failZet) throw new Error('down'); return MODULES.find((m) => m.module === module) ?? snap(module, []); });
    await flush();
    k.handlers.onCodes(batch(NOW), NOW);
    k.handlers.onUnlocked({ roomId: 'r1', ticket: 't1', expiresAt: NOW + 600_000 });
    await flush();
    expect(calls.at(-1)).toBe('live');
    k.view('u-pokretu');
    await flush();
    failZet = true;
    k.tick(REFRESH_MS);
    await flush();
    expect(calls.at(-1)).toBe('live'); // the teaser's live copy outranks the stale session copy
    failTeaser = true;
    k.tick(REFRESH_MS);
    k.poll(); // the teaser poll has its own 10 s beat (R-TE4), not the paired refresh's
    await flush();
    expect(calls.at(-1)).toBe('stale');
    expect(text(q(k.root, '.k-present-board'))).toContain('zastarjelo');
  });
  it('a late answer from an earlier session request never overwrites a newer one', async () => {
    const pending: ((value: ModuleSnapshot) => void)[] = [];
    const k = mount({ stored: STORED });
    const zet = MODULES.find((m) => m.module === 'zet-rt')!;
    k.fetchData.mockImplementation((module: ModuleId) => (module === 'zet-rt' ? new Promise<ModuleSnapshot>((resolve) => { pending.push(resolve); }) : Promise.resolve(MODULES.find((m) => m.module === module) ?? snap(module, []))));
    await flush();
    k.handlers.onCodes(batch(NOW), NOW);
    k.handlers.onUnlocked({ roomId: 'r1', ticket: 't1', expiresAt: NOW + 600_000 });
    await flush();
    k.view('u-pokretu');
    await flush();
    expect(pending).toHaveLength(2);
    pending[1]!(zet); // the newer request answers first, live
    await flush();
    pending[0]!({ ...zet, status: 'stale' }); // then the older one, with older words: dropped
    await flush();
    expect(q(k.root, '.k-present-board')!.dataset.status).toBe('live');
  });
  function fakeMap() {
    const calls: string[] = [];
    const handle = { update: vi.fn(), pause: () => { calls.push('pause'); }, resume: () => { calls.push('resume'); }, destroy: vi.fn(), resize: () => { calls.push('resize'); }, setFeedState: (s: string) => { calls.push(`feed:${s}`); }, setView: vi.fn() };
    return { factory: vi.fn(() => handle), handle, calls };
  }
  it('the map hears the ZET feed state on every paint: a stale teaser holds it, a reparent resizes and re-asserts the hold right after resume, basics pause and resume the same way', async () => {
    const stale = MODULES.map((m) => (m.module === 'zet-rt' ? { ...m, status: 'stale' as const } : m));
    const map = fakeMap();
    const k = mount({ stored: STORED, mapFactory: map.factory as never, fetchTeaser: async () => ({ modules: stale }) });
    // Created before any snapshot: held at once, told again on the paint, then appended (resize, resume, hold re-asserted).
    expect(map.calls.slice(0, 5)).toEqual(['feed:down', 'feed:down', 'resize', 'resume', 'feed:down']);
    await flush();
    expect(map.calls.at(-1)).toBe('feed:stale');
    expect(q(k.root, '[data-testid=kiosk-map]')).not.toBeNull();
    (q(k.root, '[data-testid=kiosk-essentials-open]') as HTMLButtonElement).click();
    expect(map.calls.at(-1)).toBe('pause');
    q(k.root, '[data-testid=kiosk-essentials]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(map.calls.slice(-2)).toEqual(['resume', 'feed:stale']);
    const before = map.calls.length;
    k.handlers.onCodes(batch(NOW), NOW);
    k.handlers.onUnlocked({ roomId: 'r1', ticket: 't1', expiresAt: NOW + 600_000 });
    await flush();
    k.view('u-pokretu');
    await flush();
    // Parked on Sada, then re-parented when transport is explicitly shown.
    const resize = map.calls.lastIndexOf('resize');
    expect(resize).toBeGreaterThan(before);
    expect(map.calls.slice(before, resize)).toContain('pause');
    expect(map.calls.slice(resize, resize + 3)).toEqual(['resize', 'resume', 'feed:live']);
    expect(map.calls.at(-1)).toBe('feed:live'); // the session's own zet-rt answered live
    const beforeKultura = map.calls.length;
    k.view('kultura');
    await flush();
    // A domain without a map parks it, never destroys it, and every paint since (the view's own, then the session refresh's) still tells it the feed.
    expect(map.calls.slice(beforeKultura)).toEqual(['pause', 'feed:live', 'feed:live']);
    expect(map.factory).toHaveBeenCalledTimes(1);
    k.view('u-pokretu');
    await flush();
    const again = map.calls.lastIndexOf('resume');
    expect(map.calls[again - 1]).toBe('resize');
    expect(map.calls[again + 1]).toBe('feed:live');
    expect(map.handle.destroy).not.toHaveBeenCalled();
  });
  it('a beacon outage and a teaser outage are independent alerts; the poll chain stays armed and clears its own alert on recovery', async () => {
    let fail = true;
    const k = mount({ stored: STORED, fetchTeaser: async () => { if (fail) throw new Error('down'); return { modules: MODULES }; } });
    const armedAtMount = k.timers.length;
    await flush();
    const alert = q(k.root, '[data-testid=kiosk-alert]')!;
    expect(alert.hidden).toBe(false);
    expect(text(alert)).toBe('Osvježavanje pregleda zaslona nije uspjelo.');
    k.handlers.onStatus('offline');
    expect(text(alert)).toBe('Bez veze sa zaslonom; kod se ne može izdati');
    k.handlers.onStatus('live');
    expect(alert.hidden).toBe(false);
    expect(text(alert)).toBe('Osvježavanje pregleda zaslona nije uspjelo.');
    // The chain re-armed itself after the failed load, at the fallback delay.
    const poll = k.timers.slice(armedAtMount).filter((t) => t.ms === POLL_FALLBACK_MS && !t.cleared);
    expect(poll).toHaveLength(1);
    fail = false;
    poll[0]!.fn();
    await flush();
    expect(alert.hidden).toBe(true);
    expect(text(q(k.root, '.k-weather-current .k-temp'))).toBe('21 °C');
    // The one that fired cleared itself; exactly one fresh poll is armed (still the fallback: the fixture has no source timestamp).
    expect(k.timers.slice(armedAtMount).filter((t) => t.ms === POLL_FALLBACK_MS && !t.cleared)).toHaveLength(1);
  });
  it('a reconnect after a healthy stretch is said as such, then cleared', () => {
    const k = mount({ stored: STORED });
    k.handlers.onStatus('connecting');
    expect(q(k.root, '[data-testid=kiosk-alert]')!.hidden).toBe(true);
    k.handlers.onStatus('live');
    k.handlers.onStatus('connecting');
    expect(text(q(k.root, '[data-testid=kiosk-alert]'))).toBe('Ponovno povezivanje…');
    k.handlers.onStatus('live');
    expect(q(k.root, '[data-testid=kiosk-alert]')!.hidden).toBe(true);
  });
  it('asks for fullscreen and a wake lock on the first tap only', () => {
    const k = mount({ stored: STORED });
    q(k.root, '[data-testid=kiosk]')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    q(k.root, '[data-testid=kiosk]')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(k.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(k.requestWakeLock).toHaveBeenCalledTimes(1);
  });
  it('speaks English when the page does, panels included', async () => {
    const k = mount({ stored: STORED, locale: 'en', i18n:createDefaultI18n('en') });
    await flush();
    expect(text(q(k.root, '.k-lead'))).toBe('Scan for 10 minutes of the city.');
    expect(text(q(k.root, '.k-highlight-kicker'))).toBe('Traffic change');
    expect(text(q(k.root, '.k-map-legend'))).toContain('Tram route');
  });
  it('destroy() clears every timer, closes both sockets and removes the DOM', async () => {
    const k = await pairedKiosk();
    k.handle.destroy();
    expect(k.timers.every((t) => t.cleared)).toBe(true);
    expect(k.beacon.close).toHaveBeenCalledTimes(1);
    expect(k.sessions[0]!.close).toHaveBeenCalledTimes(1);
    expect(k.root.childElementCount).toBe(0);
  });
});

// The invitation composed (plan "Frame", R-KP1, R-KP5): the map, the three
// cards over the invitation card, the header's ticker, the strip.
describe('the invitation composition: the cards, the header ticker, the strip', () => {
  it('orders the aside weather, promet, tonight, then the card; the weather card carries the condition icon and the reading; the card is the QR beside the lead, the hint and the code (R-KP21)', async () => {
    const k = mount({ stored: STORED });
    await flush();
    const column = q(k.root, '[data-testid=kiosk-invitation] .k-overview')!;
    expect([...column.children].map((el) => (el as HTMLElement).dataset.panel ?? el.className)).toEqual(['weather', 'k-highlight','k-panel--card']);
    const weather = q(k.root, '[data-testid=kiosk-panel-weather]')!;
    expect(q(weather, '.k-weather-icon use')!.getAttribute('href')).toBe('#icon-sun'); // 'vedro'
    expect(text(q(weather, '.k-weather-current .k-temp'))).toBe('21 °C');
    expect(text(q(weather, '.k-panel-meta'))).toBe('DHMZ · 14:00');
    expect(q(weather, '.k-weather-details')).toBeNull();
    expect(q(k.root, '[data-testid=strip-sun]')).toBeNull();
    const card = q(k.root, '[data-testid=kiosk-invite]')!;
    expect(q(card, '.k-support')).toBeNull();
    expect(q(card, '.k-invite-text')).toBeNull();
    expect(text(q(card, 'h1.k-lead'))).toBe('Skeniraj za 10 minuta grada.');
    // The typed address is whole: it may break at its dots beside the QR (kiosk.css), never ellipsise.
    expect(text(q(card, '.k-hint-host'))).toBe('zagreb.aningfilm.hr/s');
    expect(q(card, '.k-hint-host')!.querySelectorAll('wbr').length).toBeGreaterThan(0);
    expect(text(q(card, '.k-hint'))).toBe('ili upiši kod na zagreb.aningfilm.hr/s');
    // The card is one row: the column of words the code closes, and the QR beside it.
    expect([...card.children].map((el) => el.className)).toEqual(['k-invite-side', 'k-qr']);
    expect([...q(card, '.k-invite-side')!.children].map((el) => el.className)).toEqual(['k-lead', 'k-invite-benefit', 'k-hint', 'k-invite-code']);
    expect(q(card, '.k-invite-side .k-invite-code [data-testid=pair-code]')).not.toBeNull();
    expect(q(card, '.k-invite-code [data-testid=code-progress] .k-progress-bar')).not.toBeNull();
    // One h1 on the screen (the card's lead); each of the three cards is headed by its kicker as an h2, the field is a labelled section.
    expect(k.root.querySelectorAll('h1')).toHaveLength(1);
    expect(k.root.querySelectorAll('[data-testid=kiosk-invitation] h2')).toHaveLength(2);
  });
  it('DHMZ down: the weather card says so in a word, the header carries no reading and no dash stands in for one', async () => {
    const down = MODULES.map((m) => (m.module === 'dhmz-now' ? snap('dhmz-now', [], 'down') : m));
    const k = mount({ stored: STORED, fetchTeaser: async () => ({ modules: down }) });
    await flush();
    const weather = q(k.root, '[data-testid=kiosk-panel-weather]')!;
    expect(text(q(weather, '.k-weather-note'))).toBe('Podaci DHMZ-a trenutačno nisu dostupni.');
    expect(q(weather, '.k-temp')).toBeNull();
    expect(text(q(k.root, '[data-testid=kiosk-clock]'))).toBe('14:32');
    const head = text(q(k.root, '.k-head'));
    expect(head).not.toMatch(/[\u2013\u2014]|(^|\s)-(\s|$)/);
    expect(head).not.toContain('°C');
    expect(head).not.toContain('DHMZ');
    expect(q(k.root, '[data-testid=kiosk-temp]')).toBeNull();
    // The rest of the screen is unaffected: the strip still speaks and the promet card still names its exception.
    expect(text(q(k.root, '[data-testid=safety-strip]'))).toContain('Grmljavina');
    expect(text(q(k.root,'[data-testid=kiosk-highlight]'))).toContain('Ilica');
  });
  it('builds the hostname sentence from codeBase, never from a literal', async () => {
    const k = mount({ stored: STORED, codeBase: 'https://example.test' });
    await flush();
    expect(k.root.innerHTML).not.toContain('zagreb.aningfilm.hr');
    expect(text(q(k.root, '.k-hint-host'))).toBe('example.test/s');
    expect(text(q(k.root, '.k-hint'))).toBe('ili upiši kod na example.test/s');
    const phone = mount({ stored: STORED, codeBase: 'https://example.test', viewport: { width: 390, height: 844 } });
    expect(phone.root.innerHTML).not.toContain('zagreb.aningfilm.hr');
    expect(text(q(phone.root, '.k-hint'))).toBe('ili upiši kod na example.test/s');
  });
  it('the strip label carries the shield and the pill reads Sigurnost, linking the same page', async () => {
    const k = mount({ stored: STORED });
    await flush();
    const label = q(k.root, '.k-strip-label')!;
    expect(q(label, 'svg use')!.getAttribute('href')).toBe('#icon-shield');
    expect(text(label)).toBe('Sigurnost');
    const pill = q(k.root, '.k-strip-hitno') as HTMLAnchorElement;
    expect(text(pill)).toBe('Sigurnost');
    expect(pill.getAttribute('href')).toBe('/hitno');
    expect(k.root.innerHTML).not.toContain('>/hitno<');
  });
  it('paired: the header centre names the mirrored domain and follows every layer change', async () => {
    const k = await pairedKiosk();
    const label = q(k.root, '[data-testid=session-label]')!;
    expect(text(label)).toBe('Otključano do 14:42 · Sada');
    k.view('u-pokretu');
    await flush();
    expect(text(q(k.root, '[data-testid=session-label]'))).toBe('Otključano do 14:42 · Promet');
    k.view('kultura');
    await flush();
    expect(text(q(k.root, '[data-testid=session-label]'))).toBe('Otključano do 14:42 · Događanja');
  });
  it('paired Promet: the board shows the stop\u2019s lines first, then the five largest deviations with vehicle counts, and says how many of all lines it shows', async () => {
    const route = (id: string, delay: number, vehicles: number) => item('zet-rt', 'route:' + id, 'vehicle', id, { data: { routeId: id, routeShortName: id, medianDelaySeconds: delay, vehicles } });
    const zet = snap('zet-rt', [
      item('zet-rt', 'vozila', 'vehicle', '156 vozila u pokretu', { data: { vehicles: 156 } }),
      route('6', 130, 12), route('11', -5, 8),
      route('109', 600, 3), route('268', -500, 2), route('7', 400, 9), route('205', 300, 4), route('2', -200, 6), route('4', 100, 5),
    ]);
    const modules = MODULES.map((m) => (m.module === 'zet-rt' ? zet : m));
    const k = await pairedKiosk({ fetchTeaser: async () => ({ modules }) });
    k.fetchData.mockImplementation(async (module: ModuleId) => modules.find((m) => m.module === module) ?? snap(module, []));
    k.view('u-pokretu');
    await flush();
    const board = q(k.root, '.k-present-board')!;
    const rows = [...board.querySelectorAll<HTMLElement>('.k-line')];
    expect(rows.map((r) => r.dataset.route)).toEqual(['6', '11', '12', '13', '14']);
    const first = rows[0]!;
    expect(q(first, '.line[data-size=k][data-kind=tram]')!.textContent).toBe('6');
    expect(text(q(first, '.k-line-word'))).toBe('kasni 2 min');
    expect(text(q(rows[2]!, '.k-line-word'))).toBe('Nema podataka o kašnjenju');
    expect(text(q(board, '.k-line-more'))).toBe('još 4 linije');
    expect(board.closest('.k-map')).toBeNull();
  });
  it('paired: a warning row names its level as a badge word with its shape', async () => {
    const k = await pairedKiosk();
    k.view('zrak-i-nebo');
    await flush();
    const badge = q(k.root, '[data-testid=k-warnings] .k-row .badge')!;
    expect(badge.dataset.tone).toBe('moderate');
    expect(text(badge)).toBe('žuto upozorenje');
    expect(text(q(k.root, '[data-testid=k-warnings] .k-row-main'))).toBe('žuto upozorenje Grmljavina');
  });
  it('a slot change crossfades the code digits under data-swap for 180 ms, with the old digits as a ghost beside the live code; the first code never swaps', () => {
    let now = NOW;
    const k = mount({ stored: STORED, now: () => now });
    k.handlers.onCodes(batch(NOW), NOW);
    const code = q(k.root, '[data-testid=pair-code]')!;
    expect(code.dataset.swap).toBeUndefined();
    expect(q(k.root, '.k-code-ghost')).toBeNull();
    now = NOW + 30_000;
    k.tick(250); // the code rotation's own tick
    expect(text(code)).toBe('ABCD·EFG1');
    expect(code.dataset.swap).toBe('1');
    const ghost = q(k.root, '.k-code-ghost')!;
    expect(text(ghost)).toBe('ABCD·EFG0');
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    // The ghost repeats the live code's three spans (digits, the dimmed dash with its margins, digits), so the crossfade never reads as the second half sliding sideways; it borrows no testid, so pair-code stays one element mid-swap.
    expect([...ghost.children].map((child) => child.textContent)).toEqual(['ABCD', '·', 'EFG0']);
    expect([...ghost.children].map((child) => child.className)).toEqual([...code.children].map((child) => child.className));
    expect(ghost.children[1]!.classList.contains('k-code-dash')).toBe(true);
    expect(ghost.querySelectorAll('[data-testid]')).toHaveLength(0);
    expect(k.root.querySelectorAll('[data-testid=pair-code]')).toHaveLength(1);
    expect(CODE_SWAP_MS).toBe(180);
    k.tick(CODE_SWAP_MS);
    expect(code.dataset.swap).toBeUndefined();
    expect(q(k.root, '.k-code-ghost')).toBeNull();
    expect(text(code)).toBe('ABCD·EFG1');
  });
});

// The field, the column and the one map (plan "Camera and data plumbing",
// contracts 3 to 5): the map is built once and stands through every poll,
// resize and phase round trip; the column is ranked and reconciled, never
// rebuilt; the composition's tables reach the ranker; last departures are
// fetched on stop change and again once their table expires.
describe('the field, the column and the one map', () => {
  function spyMap(extra: Record<string, unknown> = {}) {
    const calls: string[] = [];
    const handle = { update: vi.fn(), pause: () => { calls.push('pause'); }, resume: () => { calls.push('resume'); }, destroy: vi.fn(), resize: () => { calls.push('resize'); }, setFeedState: (s: string) => { calls.push(`feed:${s}`); }, setView: vi.fn(), ...extra };
    return { factory: vi.fn(() => handle), handle, calls };
  }
  /** happy-dom lays nothing out: a host width is stubbed so the camera can be seen to follow it. */
  const layOut = (host: HTMLElement, width: number) => Object.defineProperty(host, 'clientWidth', { value: width, configurable: true });

  it.each(['map', 'schema'] as const)('one %s renderer for the screen\u2019s life: created once, following resize, parked and returned through a session', async (mapMode) => {
    const map = spyMap();
    const k = mount({ stored: STORED, mapMode, mapFactory: map.factory as never });
    await flush();
    expect(map.factory).toHaveBeenCalledTimes(1);
    const options = map.factory.mock.calls[0]![0] as Record<string, unknown>;
    // Before layout the wide drawing's design width stands; the field carries the kiosk emphasis and no selection (R-KP11).
    expect(options.zoom).toBe(fieldZoom(FIELD_DESIGN_WIDTH.wide, STOP.lat, FIELD_SPAN_M));
    expect(options.selectedStop).toBeUndefined();
    expect(options.padding).toBeUndefined();
    expect(options.emphasis).toEqual(KIOSK_EMPHASIS);
    // The invitation is the transit picture on either renderer now: the gate that emptied the
    // geographic map whenever the default 'living' group was active is gone.
    expect((options.prozor as { stopRoutes: string[] }).stopRoutes).toEqual(STOP.routes);
    expect(map.factory.mock.calls[0]?.[0]).toMatchObject({ renderer: mapMode, interactive: false, stop: STOP });
    expect(map.calls.at(-1)).toBe('feed:live');
    const container = q(k.root, '[data-testid=kiosk-map]')!;
    const host = q(k.root, '[data-testid=kiosk-map-host]')!;
    expect(container.parentElement).toBe(host);
    // A poll re-hosts nothing and re-creates nothing; the view is unchanged so nothing is pushed.
    k.poll();
    await flush();
    expect(map.factory).toHaveBeenCalledTimes(1);
    expect(map.handle.setView).not.toHaveBeenCalled();
    expect(container.parentElement).toBe(host);
    // A resize within the same composition re-measures the field and moves the camera on the same map.
    layOut(host, 700);
    k.repaint();
    expect(map.handle.setView).toHaveBeenCalledTimes(1);
    expect(map.handle.setView).toHaveBeenLastCalledWith({ zoom: fieldZoom(700, STOP.lat, FIELD_SPAN_M), emphasis: KIOSK_EMPHASIS, center: [STOP.lon, STOP.lat] });
    expect(map.factory).toHaveBeenCalledTimes(1);
    // A session parks the container (paused), the paired Sada view re-hosts it at street zoom with the stop selected; the invitation takes it back.
    k.handlers.onCodes(batch(NOW), NOW);
    k.handlers.onUnlocked({ roomId: 'r1', ticket: 't1', expiresAt: NOW + 600_000 });
    await flush();
    expect(k.handle.phase()).toBe('paired');
    expect(map.calls).toContain('pause');
    k.view('u-pokretu');
    await flush();
    expect(map.handle.setView).toHaveBeenLastCalledWith({ zoom: 15, emphasis: KIOSK_EMPHASIS, center: [STOP.lon, STOP.lat], selectedStop: STOP.id });
    expect(container.parentElement).toBe(q(k.root, '[data-testid=kiosk-layer] [data-testid=kiosk-map-host]'));
    k.expire();
    expect(k.handle.phase()).toBe('invitation');
    expect(container.parentElement).toBe(q(k.root, '[data-testid=kiosk-live] [data-testid=kiosk-map-host]'));
    expect(map.factory).toHaveBeenCalledTimes(1);
    expect(map.handle.destroy).not.toHaveBeenCalled();
    k.handle.destroy();
    expect(map.handle.destroy).toHaveBeenCalledTimes(1);
  });

  it('the panels are reconciled: an unchanged row keeps its node, a changed reading rewrites its own row and nothing else, a new row joins without rebuilding the panel', async () => {
    let modules = MODULES;
    const k = mount({ stored: STORED, fetchTeaser: async () => ({ modules }) });
    await flush();
    const weather = q(k.root, '[data-testid=kiosk-panel-weather]')!;
    const reading = q(weather, '.k-temp')!;
    expect(text(reading)).toBe('21 °C');
    // The same answer on the next poll: the same nodes stand (a reader mid-glance is never interrupted).
    k.poll();
    await flush();
    expect(q(k.root, '[data-testid=kiosk-panel-weather]')).toBe(weather);
    expect(q(weather,'.k-temp')).toBe(reading);
    // Line 6 recovers and a second vehicle arrives: the row's context changes in place, the panel and the row are the same nodes.
    modules = MODULES.map(m=>m.module==='dhmz-now'?{...m,items:m.items.map(item=>({...item,data:{...item.data,temp:22}}))}:m);
    k.poll();
    await flush();
    // Line 6 comes back inside the on-time band: it is no exception any more, so the card says the network runs to plan.
    expect(q(k.root,'[data-testid=kiosk-panel-weather]')).toBe(weather);
    expect(q(weather,'.k-temp')).toBe(reading);
    expect(text(reading)).toBe('22 °C');
    // A ZET notice arrives: the card counts it rather than printing it; the header's line carries its words.
    modules = modules.map((m) => (m.module === 'dogadanja' ? snap('dogadanja', [...m.items, item('dogadanja', 'zet-promet:1', 'event', 'Linija 6 mijenja trasu', { at: '2026-09-11T10:00:00Z', dateBasis: 'published', data: { source: 'zet-promet' } })]) : m));
    k.poll();
    await flush();
    expect(q(k.root,'[data-testid=kiosk-panel-weather]')).toBe(weather);
    expect(q(weather,'.k-temp')).toBe(reading);
    expect(q(k.root,'[data-testid=kiosk-ticker]')).toBeNull();
  });

  it('reports a layout defect instead of silently hiding useful rows to pass a geometry check', async () => {
    const k = mount({ stored: STORED });
    await flush();
    const promet = q(k.root, '.k-highlight-content')!;
    const rows = [...promet.querySelectorAll<HTMLElement>('h2')];
    expect(rows).toHaveLength(1);
    // A box smaller than its own rows (happy-dom lays nothing out: the box is stubbed and each shown row costs 60).
    let height = 40;
    Object.defineProperty(promet, 'clientHeight', { get: () => height, configurable: true });
    Object.defineProperty(promet, 'scrollHeight', { get: () => rows.filter((el) => !el.hidden).length * 60, configurable: true });
    k.tick(CODE_TICK_MS);
    expect(rows.every((el) => !el.hidden)).toBe(true); // the tick measures nothing
    k.repaint();
    expect(rows.every(el => !el.hidden)).toBe(true);
    expect(promet.dataset.overflow).toBe('true');
    // Even a broken box cannot erase useful rows to pretend that it fits.
    height = 10;
    k.repaint();
    expect(rows.every((el) => !el.hidden)).toBe(true);
    // The box grows (a resize): every row comes back.
    height = 600;
    k.repaint();
    expect(rows.every((el) => !el.hidden)).toBe(true);
  });

  it('a handheld frames 1400 m across its band and a totem 1500 m across its map panel, each at its design box before layout; the names’ padding follows the ground the panel shows and the measured box on a repaint (R-KP17, contract 3)', async () => {
    type Prozor = { prozor: { labelPadding: number } };
    const phone = spyMap();
    mount({ stored: STORED, viewport: { width: 390, height: 844 }, mapFactory: phone.factory as never });
    await flush();
    expect((phone.factory.mock.calls[0]![0] as { zoom: number }).zoom).toBe(fieldZoom(FIELD_DESIGN_WIDTH.handheld, STOP.lat, HANDHELD_SPAN_M));
    // A phone's band is taller than it is wide, so it shows more ground north to south than the wall's field and pads its names by that ratio.
    expect((phone.factory.mock.calls[0]![0] as Prozor).prozor.labelPadding).toBe(labelPadding(FIELD_DESIGN_WIDTH.handheld, FIELD_DESIGN_HEIGHT.handheld, HANDHELD_SPAN_M));
    expect(labelPadding(FIELD_DESIGN_WIDTH.handheld, FIELD_DESIGN_HEIGHT.handheld, HANDHELD_SPAN_M)).toBeGreaterThan(24);
    const totem = spyMap({ setProzor: vi.fn() });
    const k = mount({ stored: STORED, viewport: { width: 1080, height: 1920 }, mapFactory: totem.factory as never });
    await flush();
    expect((totem.factory.mock.calls[0]![0] as { zoom: number }).zoom).toBe(fieldZoom(FIELD_DESIGN_WIDTH.portrait, STOP.lat, FIELD_SPAN_M));
    expect((totem.factory.mock.calls[0]![0] as Prozor).prozor.labelPadding).toBe(labelPadding(FIELD_DESIGN_WIDTH.portrait, FIELD_DESIGN_HEIGHT.portrait, FIELD_SPAN_M));
    // The wall's own panel is the ruling's 24; the totem's taller panel shows more ground north to south and pads its names more.
    expect(labelPadding(FIELD_DESIGN_WIDTH.wide, FIELD_DESIGN_HEIGHT.wide, FIELD_SPAN_M)).toBe(24);
    expect(labelPadding(FIELD_DESIGN_WIDTH.portrait, FIELD_DESIGN_HEIGHT.portrait, FIELD_SPAN_M)).toBeGreaterThan(24);
    // Laid out taller than the design table says, the measured box wins and the live map hears the new padding.
    const host = q(k.root, '[data-testid=kiosk-map-host]')!;
    Object.defineProperty(host, 'clientWidth', { value: 1080, configurable: true });
    Object.defineProperty(host, 'clientHeight', { value: 1500, configurable: true });
    k.repaint();
    await flush();
    expect(totem.handle.setProzor).toHaveBeenLastCalledWith(expect.objectContaining({ labelPadding: labelPadding(1080, 1500, FIELD_SPAN_M) }));
    expect(labelPadding(1080, 1500, FIELD_SPAN_M)).toBeGreaterThan(labelPadding(FIELD_DESIGN_WIDTH.portrait, FIELD_DESIGN_HEIGHT.portrait, FIELD_SPAN_M));
  });

  it('last departures (R-KP6): the stop\u2019s table is fetched once on stop change behind FEED_LASTRUN and again once now passes validUntil; the exceptions card does not print it (the arrivals board will, WP5b)', async () => {
    // 21:32 in Zagreb: the evening window is open and the 23:58 departure is ahead within ten hours.
    const EVENING = NOW + 7 * 3_600_000;
    let now = EVENING;
    const live = (validUntil: number): LastRunSnapshot => ({ status: 'live', fetchedAt: new Date(now).toISOString(), sourceUpdatedAt: '2026-09-15T00:00:00Z', validUntil: new Date(validUntil).toISOString(), routes: { '6': { '2026-09-11': '23:58' } } });
    const loadLastRun = vi.fn(async () => live(EVENING + 60_000));
    const k = mount({ stored: STORED, now: () => now, loadLastRun });
    await flush();
    expect(loadLastRun).toHaveBeenCalledTimes(1);
    expect(loadLastRun).toHaveBeenCalledWith('106_1');
    expect(q(k.root, '[data-testid=kiosk-panel-promet] [data-testid=kiosk-lastrun]')).toBeNull();
    // Polls within the table's validity never refetch.
    k.poll();
    await flush();
    k.poll();
    await flush();
    expect(loadLastRun).toHaveBeenCalledTimes(1);
    // A new stop drops the old table at once (it must not pose as the new stop's) and fetches the new one.
    k.handlers.onContext!({ kind: 'venue', expiresAt: null, stop: STOPS[2]! });
    expect(q(k.root, '[data-testid=kiosk-lastrun]')).toBeNull();
    await flush();
    expect(loadLastRun).toHaveBeenCalledTimes(2);
    expect(loadLastRun).toHaveBeenLastCalledWith('200_1');
    // The new stop's line 7 has no row in the table: nothing is shown for it.
    expect(q(k.root, '[data-testid=kiosk-lastrun]')).toBeNull();
    // The table expires: the next paint asks again (the loader refetches past validUntil; one call per expiry).
    now = EVENING + 61_000;
    k.poll();
    await flush();
    expect(loadLastRun).toHaveBeenCalledTimes(3);
    expect(loadLastRun).toHaveBeenLastCalledWith('200_1');
  });

  it('a down last-run answer is asked for again on the first paint an hour after it was fetched (R-KP23), not on the polls before; a live answer then stands for its validity', async () => {
    let now = NOW;
    const down: LastRunSnapshot = { status: 'down', fetchedAt: new Date(NOW).toISOString() };
    const live: LastRunSnapshot = { status: 'live', fetchedAt: new Date(NOW + LASTRUN_DOWN_RETRY_MS).toISOString(), sourceUpdatedAt: '2026-09-15T00:00:00Z', validUntil: new Date(NOW + 30 * 24 * 3_600_000).toISOString(), routes: { '6': { '2026-09-11': '23:58' } } };
    const loadLastRun = vi.fn(async () => down);
    const k = mount({ stored: STORED, now: () => now, loadLastRun });
    await flush();
    expect(loadLastRun).toHaveBeenCalledTimes(1);
    now = NOW + LASTRUN_DOWN_RETRY_MS - 60_000;
    k.poll();
    await flush();
    expect(loadLastRun).toHaveBeenCalledTimes(1); // one bad answer is not hammered
    now = NOW + LASTRUN_DOWN_RETRY_MS;
    loadLastRun.mockResolvedValue(live);
    k.poll();
    await flush();
    expect(loadLastRun).toHaveBeenCalledTimes(2);
    now = NOW + 5 * LASTRUN_DOWN_RETRY_MS;
    k.poll();
    await flush();
    expect(loadLastRun).toHaveBeenCalledTimes(2); // a live table inside its validity is never asked for again
    expect(LASTRUN_DOWN_RETRY_MS).toBe(3_600_000);
  });

  it('the placed-labels seam (contract 3, R-KP19): the count is stamped on the map host after each map paint and once when the map first reports ready; the 1 s tick polls readiness only until then; a stub stamps nothing', async () => {
    const stub = spyMap();
    const k = mount({ stored: STORED, mapFactory: stub.factory as never });
    await flush();
    k.tick(CODE_TICK_MS);
    expect(q(k.root, '[data-testid=kiosk-map-host]')!.dataset.majorLabels).toBeUndefined();
    let status = 'loading';
    let names = ['Ilica', 'Savska cesta', 'Ilica'];
    const real = spyMap({ status: () => status, placedNames: (layer: string) => (layer === 'roads_labels_major' ? names : []) });
    const seam = mount({ stored: STORED, mapFactory: real.factory as never });
    await flush();
    const host = q(seam.root, '[data-testid=kiosk-map-host]')!;
    seam.tick(CODE_TICK_MS);
    expect(host.dataset.majorLabels).toBeUndefined(); // [] before the style loads is not a count of zero
    status = 'ready';
    seam.tick(CODE_TICK_MS);
    expect(host.dataset.majorLabels).toBe('2'); // the one sample the tick takes, when ready first reads true
    names = ['Ilica'];
    seam.tick(CODE_TICK_MS);
    expect(host.dataset.majorLabels).toBe('2'); // the tick is done polling; the count follows the paints
    seam.poll();
    await flush();
    expect(host.dataset.majorLabels).toBe('1');
    names = ['Ilica', 'Vlaška ulica', 'Savska cesta'];
    seam.repaint();
    expect(host.dataset.majorLabels).toBe('3');
  });

  it('lightweight: no map factory, no fetch for the quarter, the field is the board and the other panels stand', async () => {
    const map = spyMap();
    const k = mount({ stored: STORED, lightweight: true, mapFactory: map.factory as never });
    await flush();
    expect(map.factory).not.toHaveBeenCalled();
    expect(q(k.root, '[data-testid=kiosk-map]')).toBeNull();
    expect(q(k.root, '[data-testid=kiosk-live] [data-testid=kiosk-lines] li.k-line')).not.toBeNull();
    expect(text(q(k.root, '[data-testid=kiosk-panel-weather] .k-weather-current .k-temp'))).toBe('21 °C');
  });

  // What Postavke set the screen to is what the invitation frames when no stop
  // does. The header chip and the camera read the one answer, so a screen set
  // to the whole city cannot name a quarter in words and show one in picture.
  it('frames the invitation on the četvrt the screen was set to', async () => {
    const map = spyMap();
    const seat = districtBySlug('trnje')!.seat;
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna', screen: { ...CITY_SCREEN, area: 'trnje' } }), mapFactory: map.factory as never });
    await flush();
    const options = map.factory.mock.calls[0]![0] as Record<string, unknown>;
    // The seat camera holds the frame until the quarter's own rings land (mapview.ts fieldView).
    expect(options.center).toEqual([seat.lon, seat.lat]);
    expect(options.zoom).toBe(fieldZoom(FIELD_DESIGN_WIDTH.wide, seat.lat, DISTRICT_SPAN_M));
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('Trnje');
  });

  it('opens on the whole city for `zagreb` and for a screen that named no area at all', async () => {
    const window = cityWindowView(FIELD_DESIGN_WIDTH.wide, FIELD_DESIGN_HEIGHT.wide);
    const city = spyMap();
    const k = mount({ stored: STORED_CITY, mapFactory: city.factory as never });
    await flush();
    // 'zagreb' is the whole city, not a quarter: no outline, and the city window's own frame.
    expect(city.factory.mock.calls[0]![0]).toMatchObject({ center: window.center, zoom: window.zoom, outline: null });
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('');
    k.handle.destroy();
    const none = spyMap();
    const n = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna', screen: { kind: 'temporary', expiresAt: NOW + 20 * 3_600_000, stop: null } }), mapFactory: none.factory as never });
    await flush();
    expect(none.factory.mock.calls[0]![0]).toMatchObject({ center: window.center, zoom: window.zoom, outline: null });
    expect(text(q(n.root, '[data-testid=kiosk-context]'))).toBe('');
  });

  it('re-frames the one live map when the DO answers a Postavke save with another area', async () => {
    const map = spyMap();
    const k = mount({ stored: STORED_CITY, mapFactory: map.factory as never });
    await flush();
    expect(map.factory).toHaveBeenCalledTimes(1);
    k.handlers.onContext?.({ kind: 'temporary', expiresAt: NOW + 20 * 3_600_000, stop: null, area: 'maksimir' });
    await flush();
    const seat = districtBySlug('maksimir')!.seat;
    // The same map, moved -- never a second one built for the new frame.
    expect(map.factory).toHaveBeenCalledTimes(1);
    expect(map.handle.setView).toHaveBeenLastCalledWith(expect.objectContaining({ center: [seat.lon, seat.lat] }));
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('Maksimir');
  });
  // The camera above is pushed on the beat Postavke closes, and while the
  // panel was open the stage -- and with it the map's box -- was hidden. A
  // MapLibre transform measured behind the panel is 0 x 0, and a move against
  // it lands the subject about a third of the field off centre (seen on the
  // real map: correct after a reload, wrong after a save). The order is the
  // whole fix, so the order is what this case holds.
  it('re-measures the map before it moves it when Postavke closes: a box behind the panel is no box at all', async () => {
    const order: string[] = [];
    const handle = {
      update: vi.fn(), destroy: vi.fn(), setFeedState: vi.fn(),
      pause: () => { order.push('pause'); },
      resume: () => { order.push('resume'); },
      resize: () => { order.push('resize'); },
      setView: vi.fn(() => { order.push('setView'); }),
    };
    const k = mount({ stored: STORED_CITY, mapFactory: vi.fn(() => handle) as never });
    await flush();
    q(k.root, '[data-testid=kiosk-settings]')!.click();
    await flush();
    // The panel is over the stage and the map is held.
    expect(order).toContain('pause');
    expect(q(k.root, '.k-stage')!.hidden).toBe(true);
    const box = q(k.root, '[data-testid=kiosk-settings-panel]')!;
    const chosen = q(box, 'input[name=settings-stop][value=106_1]') as HTMLInputElement;
    chosen.checked = true;
    chosen.dispatchEvent(new Event('change', { bubbles: true }));
    q(box, '[data-testid=settings-save]')!.click();
    expect(k.beacon.setScreen).toHaveBeenCalledWith('106_1', 'zagreb');
    order.length = 0;
    k.handlers.onContext?.({ kind: 'temporary', expiresAt: NOW + 20 * 3_600_000, stop: STOP, area: 'zagreb' });
    await flush();
    expect(box.hidden).toBe(true);
    expect(handle.setView).toHaveBeenCalled();
    expect(order).toContain('resize');
    expect(order).toContain('setView');
    expect(order.indexOf('resize')).toBeLessThan(order.indexOf('setView'));
    // And the stage is back, so the box the resize read is the real one.
    expect(q(k.root, '.k-stage')!.hidden).toBe(false);
  });
});

// T4.4: /kiosk/ opened on a phone. A handheld (kiosk/layout.ts, below
// core/breakpoints.ts KIOSK_HANDHELD_MAX_PX) still asks for no fullscreen and
// no wake lock and still scrolls its wizard -- but there is no separate
// handheld composition: after creation a phone gets the same page a wall
// gets, drawn with the handheld tokens and scrolling. Setup is one button
// (T3), so nothing tells the hand to open an address on the wall.
describe('handheld: the kiosk on a phone', () => {
  const PHONE = { width: 390, height: 844 };
  it('lays out as handheld and never asks for fullscreen or a wake lock, however often it is tapped', () => {
    const k = mount({ stored: STORED, viewport: PHONE });
    expect(q(k.root, '[data-testid=kiosk]')!.dataset.size).toBe('handheld');
    q(k.root, '[data-testid=kiosk]')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    q(k.root, '[data-testid=kiosk]')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(k.requestFullscreen).not.toHaveBeenCalled();
    expect(k.requestWakeLock).not.toHaveBeenCalled();
    k.handle.destroy();
  });
  it('kiosk.css lets a handheld scroll instead of cropping (the body through :has, no mirrored attribute), keeps the stage padding a wall drops, folds the wizard grids and stacks the window under a 420 px map band', () => {
    const css = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', 'kiosk.css'), 'utf8');
    const city = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', 'kiosk-city.css'), 'utf8');
    expect(css).toMatch(/\.kiosk\[data-size='handheld'\] \{[^}]*block-size: auto;\s*overflow: visible;/);
    expect(css).toContain(".kiosk-body:has(.kiosk[data-size='handheld']) { overflow: visible; }");
    expect(css).toContain(".kiosk[data-size='handheld'] .k-choice-grid, .kiosk[data-size='handheld'] .k-stop-list { grid-template-columns: repeat(auto-fit, minmax(min(10rem, 100%), 1fr)); }");
    expect(css).not.toContain('data-kiosk-size');
    // No separate handheld composition: the phone draws the same window with a map band and the cards in flow beneath it.
    expect(css).toContain('--k-map-band: 420px;');
    expect(css).toContain(".kiosk[data-size='handheld'] .k-field { height: var(--k-map-band); border-radius: var(--k-radius); }");
    expect(city).toContain(".kiosk[data-size=handheld] .k-city-window{display:flex;flex-direction:column;");
    expect(city).toContain(".kiosk[data-size=handheld] .k-panel--card{order:0}");
    expect(css).toMatch(/\.kiosk\[data-size='handheld'\]\[data-phase='invitation'\] \.k-stage \{ padding: var\(--k-pad\); \}/);
    for (const dead of ['k-handheld', 'k-invite-text', 'k-support', 'k-scene', 'k-rail', 'k-provision']) expect(css, dead).not.toMatch(new RegExp(`\\.${dead}(?![\\w-])`));
  });
  it('after creation gives a phone the whole page, with no address to open on a wall', async () => {
    const k = mount({ viewport: PHONE });
    expect(k.handle.phase()).toBe('setup');
    await flush();
    submit(k.root);
    await flush();
    expect(k.handle.phase()).toBe('invitation');
    expect(k.beacon.connect).toHaveBeenCalledTimes(1);
    // The same composition a wall gets: the field with its map host, the three cards and the invitation card.
    for (const present of ['kiosk-invitation', 'kiosk-live', 'kiosk-map-host', 'kiosk-highlight', 'kiosk-panel-weather', 'kiosk-invite']) {
      expect(q(k.root, `[data-testid=${present}]`), present).not.toBeNull();
    }
    // Setup is one button now: no address to type on the wall, so no footnote and no second heading.
    expect(q(k.root, '[data-testid=handheld-link-block]')).toBeNull();
    expect(q(k.root, '[data-testid=handheld-link]')).toBeNull();
    expect(k.root.querySelectorAll('h1')).toHaveLength(1);
    expect(text(q(k.root, 'h1.k-lead'))).toBe('Skeniraj za 10 minuta grada.');
    // The code card is the same one the rotation paints on a wall.
    k.handlers.onCodes(batch(NOW), NOW);
    expect(text(q(k.root, '[data-testid=pair-code]'))).toBe('ABCD·EFG0');
    expect(k.root.querySelector('[data-testid=kiosk-qr] svg')).not.toBeNull();
    expect((q(k.root, '[data-testid=pair-url]') as HTMLAnchorElement).getAttribute('href')).toBe('https://zagreb.aningfilm.hr/s/#ABCD-EFG0');
    expect(q(k.root, '[data-testid=code-progress]')!.dataset.pct).toBe('1.00');
    // The weather is the card's on a phone as on a wall, and the header's line still says the city.
    expect(k.root.querySelectorAll('[data-testid=kiosk-weather]')).toHaveLength(0);
    expect(text(q(k.root, '.k-weather-current .k-temp'))).toBe('21 °C');
  });
  it('speaks English when the page does', () => {
    const k = mount({ stored: STORED, viewport: PHONE, i18n: createDefaultI18n('en'), locale: 'en' });
    expect(text(q(k.root, '.k-lead'))).toBe('Scan for 10 minutes of the city.');
  });
  it('crossing the handheld bound keeps the same page both ways, with no provisioning footnote either side', () => {
    const viewport = { ...PHONE };
    const k = mount({ stored: STORED, viewport });
    expect(q(k.root, '[data-testid=handheld-link-block]')).toBeNull();
    expect(q(k.root, '[data-testid=kiosk-live]')).not.toBeNull();
    viewport.width = 1366; viewport.height = 768;
    k.repaint();
    expect(q(k.root, '[data-testid=kiosk]')!.dataset.size).toBe('compact');
    expect(q(k.root, '[data-testid=handheld-link-block]')).toBeNull();
    expect(q(k.root, '[data-testid=kiosk-live]')).not.toBeNull();
    expect(text(q(k.root, '.k-lead'))).toBe('Skeniraj za 10 minuta grada.');
    viewport.width = 390; viewport.height = 844;
    k.repaint();
    expect(q(k.root, '[data-testid=kiosk-live]')).not.toBeNull();
    expect(k.handle.phase()).toBe('invitation');
  });
});

// T5.3: a 44 px header button left of the clock, labelled "Tema: <word>" from
// the theme controller's own preference, cycling auto -> light -> dark ->
// solar through setPreference (which persists vidikovac-theme itself --
// ui/theme.ts is untouched and does the writing). The controller is always
// supplied: entries/kiosk.ts hands mountKiosk the same instance bootPage()
// created and resolved (default solar, or ?tema=) before this component ever
// sees it, so the label is correct on the very first paint.
describe('T5.3: the theme button', () => {
  it('sits left of the clock as a glyph named by the current preference, and four clicks cycle auto -> light -> dark -> solar in order', () => {
    const k = mount(); // themeInitial defaults to 'solar', the kiosk's own default
    const btn = q(k.root, '[data-testid=kiosk-theme]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.type).toBe('button');
    expect(btn.getAttribute('aria-label')).toBe('Tema: po suncu');
    expect(btn.title).toBe('Tema: po suncu');
    expect(text(btn)).toBe('');
    expect(q(btn, 'use')!.getAttribute('href')).toBe('#icon-sunset');
    // Left of the clock: its very next sibling is the clock itself.
    expect(btn.nextElementSibling?.getAttribute('data-testid')).toBe('kiosk-clock');
    btn.click();
    expect(btn.getAttribute('aria-label')).toBe('Tema: automatski');
    expect(q(btn, 'use')!.getAttribute('href')).toBe('#icon-sun-moon');
    btn.click();
    expect(btn.getAttribute('aria-label')).toBe('Tema: svijetla');
    expect(q(btn, 'use')!.getAttribute('href')).toBe('#icon-sun');
    btn.click();
    expect(btn.getAttribute('aria-label')).toBe('Tema: tamna');
    expect(q(btn, 'use')!.getAttribute('href')).toBe('#icon-moon');
    btn.click();
    expect(btn.getAttribute('aria-label')).toBe('Tema: po suncu');
    expect(btn.title).toBe('Tema: po suncu');
    expect(text(btn)).toBe('');
    expect(q(btn, 'use')!.getAttribute('href')).toBe('#icon-sunset');
    expect(k.themeCalls).toEqual(['auto', 'light', 'dark', 'solar']);
  });
  it('reads every word straight from the theme controller, never the locale it started in', () => {
    const k = mount({ locale: 'en', themeInitial: 'light' });
    const btn = q(k.root, '[data-testid=kiosk-theme]') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Theme: light');
    btn.click();
    expect(btn.getAttribute('aria-label')).toBe('Theme: dark');
  });
  it('lets go of the theme controller on destroy, like every other subscription', () => {
    const k = mount();
    expect(k.themeListenerCount()).toBe(1);
    k.handle.destroy();
    expect(k.themeListenerCount()).toBe(0);
  });
});


// --- WP5b: what comes next at a stop, on the public screen ------------------
// The shared merge (shared/city/arrivals.ts) and the board cache
// (app/src/city/boards.ts) are proven where they live; what is proven here is
// the kiosk's own half: the card a tap opens leads with the arrivals, a
// configured stop turns the Promet card into its board, the cache is made once
// and let go with the screen, and nothing is asked for that nobody is looking
// at.

/** A tracked trip and an untracked one at the screen's own platform, and a
 *  third at its sibling: 14:32 in Zagreb is the test's `NOW`. */
const TRIP_LIVE = 'trip-6-live';
function dep(tripId: string, routeId: string, headsign: string, at: string): ScheduledDeparture {
  return { operator: 'zet', tripId, routeId, routeName: routeId, headsign, at };
}
function board(stopId: string, departures: ScheduledDeparture[]): DepartureBoard {
  return { operator: 'zet', stopId, stopName: 'Trg bana J. Jelačića', status: 'live', generatedAt: new Date(NOW).toISOString(), departures };
}
const JELACIC_BOARDS: Record<string, DepartureBoard> = {
  // 12:33:00Z + ZET's own 120 s delay = 12:35 = "za 3 min"; the 11 is the
  // timetable alone, six minutes out; the 13 at the sibling platform is past
  // the countdown horizon and shows a clock.
  '106_1': board('106_1', [dep(TRIP_LIVE, '6', 'Črnomerec', '2026-09-11T12:33:00Z'), dep('trip-11', '11', 'Velika Gorica', '2026-09-11T12:38:00Z')]),
  '106_2': board('106_2', [dep('trip-13', '13', 'Žitnjak', '2026-09-11T12:45:00Z')]),
};
/** The teaser with one tracked vehicle on the 6, carrying the trip the board names. */
const ARRIVAL_MODULES: ModuleSnapshot[] = MODULES.map((m) => (m.module !== 'zet-rt' ? m : snap('zet-rt', [
  item('zet-rt', 'vozila', 'vehicle', '156 vozila u pokretu', { data: { vehicles: 156 } }),
  item('zet-rt', 'vehicle:1', 'vehicle', '6', { at: '2026-09-11T12:31:40Z', geo: { type: 'Point', coordinates: [15.977, 45.813] }, data: { routeId: '6', routeType: 0, tripId: TRIP_LIVE, delaySeconds: 120 } }),
  item('zet-rt', 'route:6', 'vehicle', '6', { data: { routeId: '6', routeShortName: '6', medianDelaySeconds: 240, vehicles: 12 } }),
])));

/** The real cache (its memo and its listener set are the thing under test)
 *  over a fetch this test answers: every platform asked for is recorded, and a
 *  platform with no board answers like the Worker being down. */
function fakeBoards(available: Record<string, DepartureBoard> = {}) {
  const asked: string[] = [];
  const fetchImpl = vi.fn(async (input: unknown) => {
    const id = decodeURIComponent(String(input).split('stop=')[1] ?? '');
    asked.push(id);
    const found = available[id];
    if (!found) return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
    return { ok: true, status: 200, json: async () => found } as unknown as Response;
  });
  const made: { destroy: ReturnType<typeof vi.fn> }[] = [];
  const create = vi.fn((): BoardCache => {
    const real = createBoardCache({ fetchImpl: fetchImpl as unknown as typeof globalThis.fetch, now: () => NOW });
    const wrapped = { get: real.get, ensure: real.ensure, destroy: vi.fn(() => { real.destroy(); }) };
    made.push(wrapped);
    return wrapped;
  });
  return { create, asked, made };
}

describe('the kiosk grid places every region explicitly', () => {
  const css = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', 'kiosk.css'), 'utf8');
  it('gives the alert its own row and every other region a named one, the essentials panel included', () => {
    // Four rows: the header, the alert (collapsed to nothing while there is
    // none), the stage, the safety strip. Nothing may auto-place, or the next
    // region added shuffles the page.
    expect(css).toContain('grid-template-rows: var(--k-head-h) auto minmax(0, 1fr) var(--k-strip-h);');
    expect(css).toMatch(/\.k-head \{ grid-row: 1;/);
    expect(css).toMatch(/\.k-alert \{ grid-row: 2;/);
    expect(css).toMatch(/\.k-stage \{ grid-row: 3;/);
    expect(css).toMatch(/\.k-strip \{ grid-row: 4;/);
    // The essentials panel is absolute at every size but the handheld, where
    // it is in the flow and must be told it belongs in the stage's row --
    // auto-placed it lands in a fifth row, under the strip and off the screen.
    expect(css).toMatch(/\.kiosk\[data-size='handheld'\] \.k-basics \{ position: static; grid-row: 3; \}/);
  });
});

describe('arrivals on the public screen', () => {
  /** A map whose only seam this test needs is the tap: the kiosk hands
   *  `onSelect` to the factory (kiosk/mapview.ts), and a tap on a stop is that
   *  callback with the stop's id. */
  function tappableMap() {
    const handle = { update: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(), resize: vi.fn(), setFeedState: vi.fn(), setView: vi.fn() };
    return { factory: vi.fn(() => handle), handle };
  }

  it('a tapped stop says first which trams come next: the tracked row, then the timetable, the note once, the lines under them', async () => {
    const map = tappableMap();
    const b = fakeBoards(JELACIC_BOARDS);
    const k = mount({ stored: STORED, modules: ARRIVAL_MODULES, mapFactory: map.factory as never, createBoards: b.create });
    await flush();
    const options = map.factory.mock.calls[0]![0] as { onSelect: (selection: MapSelection | null) => void };
    expect(options.onSelect).toBeUndefined();
    k.handlers.onPresentation?.({version:1,revision:1,target:{layer:'u-pokretu',selection:{kind:'stop',id:'106_1'}},expiresAt:NOW+600_000,dataToken:'dt'});
    await flush();
    const card = q(k.root, '[data-testid=k-selection]')!;
    const rows = [...card.querySelectorAll<HTMLElement>('[data-testid=k-arrivals] .k-row')];
    // One line per row: the time, the plate, where it is going -- and no
    // per-row "po redu vožnje", which doubled the height of every untracked row.
    expect(rows.map((row) => text(row))).toEqual(['za 3 minuživo6 Črnomerec', '14:38po redu vožnje11 Velika Gorica', '14:45po redu vožnje13 Žitnjak']);
    // The tracked row, and only it, carries the live dot and is marked live;
    // the note under the list says what the unmarked times are.
    expect(rows.map((row) => row.querySelector('.k-live') !== null)).toEqual([true, false, false]);
    expect(rows[0]!.querySelector('[data-live=true]')).not.toBeNull();
    expect(text(card)).toContain('po redu vožnje');
    // One note for the list, not one per row, and the stop's lines keep their place under it.
    expect(text(card).split('Procjena iz ZET-ovih podataka').length - 1).toBe(1);
    expect(text(card)).toContain('linija 6, 11, 12');
    const order = [...card.querySelectorAll<HTMLElement>('.k-select-main, [data-testid=k-arrivals], .k-board-note, .k-select-sub')].map((el) => el.className.split(' ')[0]);
    expect(order).toEqual(['k-select-main', 'k-rows', 'k-board-note', 'k-select-sub']);
    // The card is the column while it is open (kiosk-city.css hides the screen's
    // own board behind this flag); going back gives the board the rail again.
    expect(q(k.root,'[data-testid=kiosk-invitation]')).toBeNull();
    k.handlers.onPresentation?.({version:1,revision:2,target:null,expiresAt:null});
    expect(q(k.root,'[data-testid=kiosk-invitation]')).not.toBeNull();
    k.handle.destroy();
  });

  it('a configured stop is the Promet card, asked for once a minute however often the screen paints', async () => {
    const b = fakeBoards(JELACIC_BOARDS);
    const k = mount({ stored: STORED, modules: ARRIVAL_MODULES.filter(m=>m.module!=='prometnice'), createBoards: b.create });
    await flush();
    const promet = q(k.root, '[data-testid=kiosk-highlight]')!;
    // The stop list has not been loaded, so the screen asks about the platform it knows.
    expect(b.asked).toEqual(['106_1']);
    // A board row is the exceptions row's shape: plate, destination, time at
    // the end, one line -- so the card costs the aside what it always cost it.
    expect(promet.querySelectorAll('h2')).toHaveLength(1);
    expect(text(promet)).toContain('Črnomerec');
    expect(text(promet)).toContain('Procjena: 3 min');
    // No figure on a public screen stands unattributed: the board says under itself where it came from.
    expect(text(promet)).toContain('ZET');
    // Ten seconds later the poll comes round again; the minute's memo answers it.
    k.poll();
    await flush();
    expect(b.asked).toEqual(['106_1']);
    k.handle.destroy();
  });

  it("says what a tapped stop's empty list means: a board that failed is not an evening with no trams", async () => {
    const map = tappableMap();
    const b = fakeBoards({});
    const k = mount({ stored: STORED, modules: ARRIVAL_MODULES, mapFactory: map.factory as never, createBoards: b.create });
    await flush();
    k.handlers.onPresentation?.({version:1,revision:1,target:{layer:'u-pokretu',selection:{kind:'stop',id:'106_1'}},expiresAt:NOW+600_000,dataToken:'dt'});
    await flush();
    const card = q(k.root, '[data-testid=k-selection]')!;
    expect(card.querySelector('[data-testid=k-arrivals]')).toBeNull();
    expect(text(card)).toContain('Vozni red trenutačno nije dostupan.');
    expect(q(card, '.k-board-note')!.dataset.state).toBe('down');
    // The stop is still named, and its lines are still there to read.
    expect(text(card)).toContain('Trg bana J. Jelačića');
    expect(text(card)).toContain('linija 6, 11, 12');
    k.handle.destroy();
  });

  it("gives the narrow drawing three rows, not four: the board feeds the aside's one budget", async () => {
    const b = fakeBoards({
      '106_1': board('106_1', [
        dep(TRIP_LIVE, '6', 'Črnomerec', '2026-09-11T12:33:00Z'), dep('trip-11', '11', 'Velika Gorica', '2026-09-11T12:38:00Z'),
        dep('trip-12', '12', 'Ljubljanica', '2026-09-11T12:40:00Z'), dep('trip-14', '14', 'Mihaljevac', '2026-09-11T12:42:00Z'),
      ]),
    });
    const wide = mount({ stored: STORED, modules: ARRIVAL_MODULES, createBoards: b.create });
    await flush();
    expect(q(wide.root, '[data-testid=kiosk-highlight]')!.querySelectorAll('h2')).toHaveLength(1);
    wide.handle.destroy();
    const compact = mount({ stored: STORED, modules: ARRIVAL_MODULES, createBoards: b.create, viewport: { width: 1366, height: 768 } });
    await flush();
    expect(q(compact.root, '.kiosk')!.dataset.size).toBe('compact');
    const narrow = q(compact.root, '[data-testid=kiosk-highlight]')!;
    expect(narrow.querySelectorAll('h2')).toHaveLength(1);
    // And the fourth is not dropped in silence: the card counts it in the row
    // fitter's own words, so the stop does not read as having nothing else.
    expect(narrow.querySelector('.k-row-more')).toBeNull();
    expect(q(compact.root,'[data-testid=kiosk-invite]')).not.toBeNull();
    compact.handle.destroy();
  });

  it('captions the board with its own stop and counts what it could not show', async () => {
    const map = tappableMap();
    const b = fakeBoards(JELACIC_BOARDS);
    const k = mount({ stored: STORED, modules: ARRIVAL_MODULES.filter(m=>m.module!=='prometnice'), mapFactory: map.factory as never, createBoards: b.create });
    await flush();
    const promet = q(k.root, '[data-testid=kiosk-highlight]')!;
    // Before the catalogue is in hand the screen knows one platform and says
    // only the name -- never a platform count it cannot stand behind.
    expect(text(q(promet, '.k-highlight-where'))).toBe('Trg bana J. Jelačića');
    // The city's own counts belong to the card that is showing the city.
    expect(text(promet)).not.toContain('zatvaranja');
    // A tap loads the stop list; the board is then of both platforms.
    k.handlers.onPresentation?.({version:1,revision:1,target:{layer:'u-pokretu',selection:{kind:'stop',id:'106_1'}},expiresAt:NOW+600_000,dataToken:'dt'});
    await flush();
    expect(b.asked).toContain('106_2');
    // Three departures, three rows on a wide screen: nothing counted away.
    expect(q(k.root, '[data-testid=k-arrivals]')!.querySelectorAll('.k-row')).toHaveLength(3);
    k.handle.destroy();
  });

  it('keeps the city-wide exceptions when the stop board is down', async () => {
    const b = fakeBoards({});
    const k = mount({ stored: STORED, modules: ARRIVAL_MODULES, createBoards: b.create });
    await flush();
    const promet = q(k.root, '[data-testid=kiosk-highlight]')!;
    expect(b.asked).toEqual(['106_1']);
    expect(text(promet)).not.toContain('za 3 min');
    expect(text(promet)).toContain('Ilica');
    k.handle.destroy();
  });

  it('makes one cache for the screen, asks for nothing without a stop, and lets it go on destroy', async () => {
    const b = fakeBoards(JELACIC_BOARDS);
    const k = mount({ stored: STORED_CITY, modules: ARRIVAL_MODULES, createBoards: b.create });
    await flush();
    k.poll();
    await flush();
    expect(b.create).toHaveBeenCalledTimes(1);
    expect(b.asked).toEqual([]);
    k.handle.destroy();
    expect(b.made[0]!.destroy).toHaveBeenCalledTimes(1);
  });

  it('fetches for a presented stop -- the phone is asking for exactly that board -- and for no other presented subject', async () => {
    const b = fakeBoards(JELACIC_BOARDS);
    const k = mount({ stored: STORED, modules: ARRIVAL_MODULES, createBoards: b.create });
    k.handlers.onPresentation?.({ version: 1, revision: 1, target: { layer: 'u-pokretu', selection: { kind: 'stop', id: '106_1' } }, expiresAt: NOW + 600_000, dataToken: 'dt' });
    await flush();
    expect(b.asked).toContain('106_1');
    // And the wall shows the rows, not an empty card under the stop's name.
    const card = q(k.root, '[data-testid=k-selection]')!;
    expect([...card.querySelectorAll<HTMLElement>('[data-testid=k-arrivals] .k-row')].map((row) => text(row)))
      .toEqual(['za 3 minuživo6 Črnomerec', '14:38po redu vožnje11 Velika Gorica', '14:45po redu vožnje13 Žitnjak']);
    // A presented route is not a stop: the screen keeps quiet behind it, and
    // the screen's own stop is not polled behind the phone's subject either.
    const other = fakeBoards(JELACIC_BOARDS);
    const o = mount({ stored: STORED, modules: ARRIVAL_MODULES, createBoards: other.create });
    o.handlers.onPresentation?.({ version: 1, revision: 2, target: { layer: 'u-pokretu', selection: { kind: 'route', id: '6' } }, expiresAt: NOW + 600_000, dataToken: 'dt' });
    await flush();
    o.poll();
    await flush();
    expect(other.asked).toEqual([]);
    k.handle.destroy();
    o.handle.destroy();
  });

  it('a dead vehicle feed does not speak for a live board: four scheduled departures, no "ZET ne odgovara"', async () => {
    const b = fakeBoards(JELACIC_BOARDS);
    // The realtime module is down; the schedule is not. This is the hour the
    // board matters most, and every row it shows is schedule-only.
    const down = MODULES.map((m) => (m.module === 'zet-rt' ? snap('zet-rt', [], 'down') : m));
    const k = mount({ stored: STORED, modules: down.filter(m=>m.module!=='prometnice'), createBoards: b.create });
    await flush();
    const promet = q(k.root, '[data-testid=kiosk-highlight]')!;
    expect(promet.querySelectorAll('h2')).toHaveLength(1);
    expect(text(promet)).not.toContain('ZET trenutačno ne odgovara');
    expect(promet.querySelector('.k-panel-note')).toBeNull();
    // No vehicle is tracked, so no row claims to be live.
    expect(promet.querySelector('.k-live')).toBeNull();
    expect(text(promet)).toContain('Po rasporedu');
    expect(text(promet)).toContain('ZET');
    k.handle.destroy();
  });
});
