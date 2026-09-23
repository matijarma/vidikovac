// @vitest-environment happy-dom
// The kiosk controller with every dependency faked: the setup wizard, the
// invitation (map, nearby timeline and code card), codes, the paired
// compositions, expiry and revocation, the basics panel, alerts, polling and
// disposal. The panels are the real kiosk/front.ts over the fixture teaser;
// what is proven here is that the controller paints them on the right beats,
// reconciles what changed and hides what the box does not hold.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { SCREEN_SET_MIN_MS, type CodeSlot, type ScreenMetadata } from '../../worker/protocol';
import { BEACON_STORAGE_KEY } from '../../app/src/beacon';
import type { LastRunSnapshot } from '../../app/src/core/lastrun';
import { ScreenError } from '../../app/src/core/screens';
import { publicItemKey } from '../../app/src/core/contracts';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { CODE_SWAP_MS, CODE_TICK_MS, ESSENTIALS_IDLE_MS, LASTRUN_DOWN_RETRY_MS, mountKiosk, REFRESH_MS, type KioskDeps } from '../../app/src/kiosk';
import { SAVE_TIMEOUT_MS, SETTINGS_IDLE_MS, SETTINGS_SEND_DELAY_MS } from '../../app/src/kiosk/settings';
import { LONG_PRESS_MS } from '../../app/src/kiosk/constants';
import { RHYTHM_STORAGE_KEY, type Rhythm } from '../../app/src/kiosk/prefs';
import { FIELD_DESIGN_HEIGHT, FIELD_DESIGN_WIDTH } from '../../app/src/kiosk/layout';
import { cityWindowView, FIELD_SPAN_M, fieldZoom, HANDHELD_SPAN_M, KIOSK_EMPHASIS, labelPadding } from '../../app/src/kiosk/mapview';
import { FRAME_RADIUS_M, frameLinesOf, frameRadiusM, frameSpanM, frameStopsFrom } from '../../shared/city/frame';
import { decodeNetwork, type Network } from '../../shared/motion/network';
import type { SentenceRequest, WrittenSentence } from '../../shared/kiosk/sentence';
import { nearbyHead } from '../../app/src/city/nearby';
import { routeType } from '../../app/src/kiosk/stops';
import * as pairedRenderer from '../../app/src/kiosk/paired';
import { frameView } from '../../app/src/map/frame';
import { POLL_FALLBACK_MS } from '../../app/src/motion/loop';
import { THEME_PREFERENCES, type ThemeController, type ThemePreference } from '../../app/src/ui/theme';
import { createBoardCache, type BoardCache } from '../../app/src/city/boards';
import type { MapPoint, MapSelection } from '../../app/src/map/city-map';
import type { DepartureBoard, ScheduledDeparture } from '../../shared/city/types';
import { fakeCityStore } from '../city/fake-store';
import { emptyCity } from '../../shared/city/types';
import { BUILT_AT } from '../../app/src/motion/network-meta';


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
  snap('prometnice', [item('prometnice', 'c1', 'closure', 'Ilica', { until: '2026-09-11T18:00:00Z', geo: { type: 'LineString', coordinates: [[15.9705, 45.813], [15.972, 45.8131]] }, data: { subtype: 'ROAD_CLOSED' } })]),
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
type MountOptions = Partial<Pick<KioskDeps, 'cityStore' | 'hash' | 'reducedMotion' | 'lightweight' | 'fetchTeaser' | 'fetchSentences' | 'loadNetwork' | 'loadPaired' | 'mapFactory' | 'createScreen' | 'loadStops' | 'loadStreets' | 'viewport' | 'locale' | 'now' | 'i18n' | 'codeBase' | 'loadLastRun' | 'mapMode' | 'createBoards' | 'storage'>> & { stored?: string | null; themeInitial?: ThemePreference; rhythm?: Rhythm } & { modules?: ModuleSnapshot[] };

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
  if (opts.rhythm) raw[RHYTHM_STORAGE_KEY] = String(opts.rhythm);
  const storage = { getItem: (k: string) => raw[k] ?? null, setItem: (k: string, v: string) => { raw[k] = v; }, removeItem: (k: string) => { delete raw[k]; } };
  let beaconStatus: 'live' | 'offline' = 'live';
  const beacon = { connect: vi.fn(), requestMore: vi.fn(), status: () => beaconStatus, close: vi.fn(), acknowledgePresentation: vi.fn(), setScreen: vi.fn() };
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
  /** The offline street index: empty unless a test hands one in, so the place field never fetches. */
  const loadStreets = opts.loadStreets ?? vi.fn(async () => []);
  /** The stop's last-departure table: none by default (the stop is not in the generated set), so nothing reaches the wire from here. */
  const loadLastRun = opts.loadLastRun ?? vi.fn(async () => null);
  const fetchSentences = opts.fetchSentences ?? vi.fn(async () => []);
  const requestFullscreen = vi.fn(async () => {});
  const requestWakeLock = vi.fn(async () => {});
  /** The theme-or-resize listener the controller registers; a test fires it after mutating its viewport object. */
  let repaint: (() => void) | null = null;
  const themeFake = fakeThemeController(opts.themeInitial ?? 'solar');
  const handle = mountKiosk(root, {
    cityStore:opts.cityStore??fakeCityStore(),
    i18n: opts.i18n ?? createDefaultI18n('hr'), hash: opts.hash ?? '', storage: opts.storage === undefined ? storage : opts.storage, now: opts.now ?? (() => NOW), codeBase: opts.codeBase ?? 'https://zagreb.aningfilm.hr',
    onRepaint: (listener) => { repaint = listener; return () => { repaint = null; }; },
    reducedMotion: opts.reducedMotion ?? false, lightweight: opts.lightweight ?? false, viewport: opts.viewport ?? { width: 1920, height: 1080 }, locale: opts.locale, mapMode: opts.mapMode,
    fetchTeaser: opts.fetchTeaser ?? (async () => ({ modules })), fetchSentences, loadNetwork: opts.loadNetwork ?? (async () => null), mapFactory: opts.mapFactory, fetchData, createScreen, loadStops, loadStreets, loadLastRun, createBoards: opts.createBoards ?? offlineBoards,
    theme: themeFake.theme,
    loadPaired: opts.loadPaired ?? (() => pairedRenderer),
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
    root, handle, beacon, timers, raw, sessions, fetchData, fetchSentences, createScreen, loadStops, loadStreets, loadLastRun, requestFullscreen, requestWakeLock,
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
const flush = async () => { for (let i = 0; i < 24; i += 1) await Promise.resolve(); };
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const q = (root: ParentNode, sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
const departures = (root: ParentNode): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-testid=nearby-rows] [data-kind=departure]')];
const sentenceText = (root: ParentNode): string => text(q(root, '[data-testid=kiosk-sentence-text]'));

const submit = (root: ParentNode) => { q(root, 'form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); };

describe('passive public city',()=>{
  it('keeps nearby nodes through sentence changes and yields to explicit presentation',async()=>{
    const cityStore=fakeCityStore({...emptyCity(),places:[{id:'culture-a',name:'Gavella',category:'culture',sourceId:'culture',sourceRecord:'a',lon:15.97,lat:45.81}]});
    let now=NOW;
    const b=fakeBoards(JELACIC_BOARDS);
    const k=mount({stored:STORED,cityStore,now:()=>now,createBoards:b.create});await flush();
    expect(q(k.root,'[data-action=kiosk-explore]')).toBeNull();
    expect(q(k.root,'#kiosk-city-search')).toBeNull();
    const previous=sentenceText(k.root);
    const rows=departures(k.root);
    expect(rows).toHaveLength(3);
    now+=20_000;k.tick(CODE_TICK_MS);
    expect(sentenceText(k.root)).not.toBe(previous);
    expect(departures(k.root)).toEqual(rows);
    expect(q(k.root,'[data-testid=kiosk-invitation] button')).toBeNull();
    cityStore.set({...cityStore.snapshot()});
    now+=90_000;k.tick(CODE_TICK_MS);
    expect(departures(k.root).filter(row=>rows.includes(row))).toHaveLength(3);
    k.handlers.onPresentation?.({version:1,revision:1,target:{layer:'u-pokretu',selection:{kind:'place',id:'culture-a'}},expiresAt:now+600000,dataToken:'dt'});
    await flush();cityStore.set({...cityStore.snapshot()});
    expect(q(k.root,'[data-testid=nearby]')).toBeNull();
    expect(q(k.root,'[data-testid=kiosk-sentence]')!.hidden).toBe(true);
    expect(text(q(k.root,'[data-testid=city-detail]'))).toContain('Gavella');
    k.handle.destroy();
  });
});

describe('the passive code card', () => {
  it('keeps the code readable after rotation without an operator control', async () => {
    let now = NOW;
    const k = mount({ stored: STORED, now: () => now });
    k.handlers.onCodes(batch(NOW), NOW);
    await flush();
    const card = q(k.root, '[data-testid=kiosk-invite]')!;
    expect(card.querySelectorAll('button, input')).toHaveLength(0);
    expect(text(q(card, '[data-testid=kiosk-code]'))).toBe('ABCD·EFG0');
    now += 30_000;
    k.tick(250);
    expect(text(q(card, '[data-testid=kiosk-code]'))).toBe('ABCD·EFG1');
    expect(text(q(card, '.k-hint-host'))).toBe('zagreb.aningfilm.hr/s');
    k.handle.destroy();
  });
});

describe('the integrated companion sentence', () => {
  it.each([20, 30, 60] as const)('reads a stored %s-second rhythm and keeps a finite deadline', async rhythm => {
    let now = NOW;
    const k = mount({ stored: STORED, rhythm, now: () => now });
    await flush();
    const first = sentenceText(k.root);
    expect(first).not.toBe('');
    expect(q(k.root, '.kiosk')!.dataset.rhythm).toBe(String(rhythm));
    now += rhythm * 1000 - 1;
    k.tick(CODE_TICK_MS);
    expect(sentenceText(k.root)).toBe(first);
    now += 1;
    k.tick(CODE_TICK_MS);
    expect(sentenceText(k.root)).not.toBe(first);
    expect(Number(q(k.root, '[data-testid=kiosk-sentence]')!.dataset.validUntil)).toBeGreaterThan(now);
    k.handle.destroy();
  });

  it('keeps at least three distinct template sentences across ten minutes without an AI response', async () => {
    let now = NOW;
    const k = mount({ stored: STORED, modules: [], now: () => now, fetchSentences: () => new Promise(() => {}) });
    const changes: string[] = [];
    for (let seconds = 0; seconds <= 600; seconds += 20) {
      now = NOW + seconds * 1000;
      k.tick(CODE_TICK_MS);
      const line = sentenceText(k.root);
      expect(line).not.toBe('');
      expect(line.length).toBeLessThanOrEqual(80);
      expect(line).not.toMatch(/…|\.\.\./);
      expect(Number(q(k.root, '[data-testid=kiosk-sentence]')!.dataset.validUntil)).toBeGreaterThan(now);
      if (changes.at(-1) !== line) changes.push(line);
    }
    expect(new Set(changes).size).toBeGreaterThanOrEqual(3);
    expect(new Set(changes).size).toBe(changes.length);
    k.handle.destroy();
  });

  it('never paints a late model answer whose fact has left the current timeline', async () => {
    let now = NOW;
    let modules = MODULES;
    const requests: { request: SentenceRequest; resolve: (answer: WrittenSentence[]) => void }[] = [];
    const b = fakeBoards(JELACIC_BOARDS);
    const k = mount({ stored: STORED, now: () => now, createBoards: b.create, fetchTeaser: async () => ({ modules }),
      fetchSentences: request => new Promise(resolve => { requests.push({ request, resolve }); }),
    });
    expect(sentenceText(k.root)).not.toBe(''); // no wait for inference, even on the first paint
    await flush();
    const pending = requests.find(({ request }) => request.facts.some(fact => fact.id === 'closure:c1'))!;
    const fact = pending.request.facts.find(fact => fact.id === 'closure:c1')!;
    expect(requests.every(({ request }) => request.facts.every(fact => !fact.id.startsWith('dep:')))).toBe(true);
    modules = MODULES.filter(module => module.module !== 'prometnice');
    k.poll();
    await flush();
    pending.resolve([{ text: fact.text, kicker: fact.kind, refs: [fact.id], validUntil: fact.validUntil, origin: 'model' }]);
    await flush();
    for (let i = 0; i < 8; i += 1) {
      now += 20_000;
      k.tick(CODE_TICK_MS);
      expect(sentenceText(k.root)).not.toContain('Ilica');
      expect(q(k.root, '.nearby-row[data-kind=closure]')).toBeNull();
    }
    k.handle.destroy();
  });

  it('uses a laid-out probe to skip an overflowing candidate even after a pairing notice', async () => {
    let now = NOW;
    const k = mount({ stored: STORED, now: () => now });
    await flush();
    const probe = q(k.root, '.k-sentence-probe')!;
    const probeText = q(probe, '.k-sentence-text')!;
    Object.defineProperty(probe, 'clientWidth', { value: 500, configurable: true });
    Object.defineProperty(probeText, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(probeText, 'scrollWidth', { get: () => probeText.textContent?.includes('Ilica') ? 800 : 300, configurable: true });
    k.handlers.onPaired?.(NOW + 600_000);
    expect(q(k.root, '[data-testid=kiosk-sentence]')!.hidden).toBe(true);
    now += 20_000;
    k.tick(CODE_TICK_MS);
    expect(q(k.root, '.k-sentence-probe')).toBe(probe);
    expect(probe.hidden).toBe(false);
    expect(q(k.root, '[data-testid=kiosk-sentence]')!.hidden).toBe(false);
    expect(sentenceText(k.root)).not.toContain('Ilica');
    k.handle.destroy();
  });

  it('highlights a sentence reference without moving the map, then removes only vehicles on outage', async () => {
    let now = NOW;
    let modules = MODULES;
    const handle = { update: vi.fn(), pause: vi.fn(), resume: vi.fn(), resize: vi.fn(), destroy: vi.fn(),
      setView: vi.fn(), setHighlight: vi.fn(), setFeedState: vi.fn(), setModes: vi.fn() };
    const factory = vi.fn((_options: unknown) => handle);
    const k = mount({ stored: STORED, now: () => now, mapFactory: factory as never, fetchTeaser: async () => ({ modules }) });
    await flush();
    expect((handle.update.mock.lastCall?.[0] as MapPoint[]).some(point => point.routeId === '6')).toBe(true);
    handle.setView.mockClear();
    now += 20_000;
    k.tick(CODE_TICK_MS);
    expect(q(k.root, '[data-testid=kiosk-sentence]')!.dataset.kicker).toBe('radovi');
    expect(handle.setHighlight).toHaveBeenLastCalledWith(expect.objectContaining({ geometry: { type: 'LineString', coordinates: [[15.9705, 45.813], [15.972, 45.8131]] } }));
    expect(handle.setView).not.toHaveBeenCalled();
    modules = MODULES.map(module => module.module === 'zet-rt' ? { ...module, status: 'down' as const } : module);
    k.poll();
    await flush();
    const points = handle.update.mock.lastCall?.[0] as MapPoint[];
    expect(points.some(point => point.routeId !== undefined)).toBe(false);
    expect(points.some(point => point.id === 'stop:106_1')).toBe(true);
    expect(points.some(point => point.place === 'pharmacy')).toBe(true);
    expect(handle.setModes.mock.calls.every(([modes]) => modes === null || modes.size > 0)).toBe(true);
    expect(q(k.root, '[data-testid=map-note]')!.hidden).toBe(false);
    expect(k.root.querySelectorAll('[data-testid=map-note]')).toHaveLength(1);
    k.handle.destroy();
  });

  it.each([true, false])('shares the measured network radius with the timeline (chosen place: %s)', async chosen => {
    const allStops = JSON.parse(readFileSync(join(import.meta.dirname, '../../app/public/data/stops.json'), 'utf8')) as Awaited<ReturnType<NonNullable<KioskDeps['loadStops']>>>;
    const network = decodeNetwork(JSON.parse(readFileSync(join(import.meta.dirname, '../../app/public/data/zet-network.json'), 'utf8')));
    const place = { kind: 'tram' as const, name: STOP.name, lon: STOP.lon, lat: STOP.lat, stopId: STOP.id };
    const radius = frameRadiusM(place, frameStopsFrom(allStops, id => routeType(id) === 0, frameLinesOf(network)), 6);
    let deliver!: (network: Network) => void;
    const pending = new Promise<Network>(resolve => { deliver = resolve; });
    const map = { update: vi.fn(), pause: vi.fn(), resume: vi.fn(), resize: vi.fn(), destroy: vi.fn(), setView: vi.fn(), setFeedState: vi.fn() };
    const factory = vi.fn((_options: unknown) => map);
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna',
      screen: { ...SCREEN, stop: chosen ? STOP : null, place, placeSet: chosen, frame: 6 } }),
      loadStops: async () => allStops, loadNetwork: () => pending, mapFactory: factory as never,
    });
    await flush();
    expect(text(q(k.root, '[data-testid=nearby-head]'))).toBe('U blizini · 2 km · ~15 min');
    map.setView.mockClear();
    deliver(network);
    await flush();
    expect(text(q(k.root, '[data-testid=nearby-head]'))).toBe(nearbyHead(createDefaultI18n('hr'), radius));
    expect(q(k.root, '[data-testid=kiosk-map-host]')!.dataset.frame).toBe('6');
    expect(factory).toHaveBeenCalledTimes(1);
    if (chosen) expect(map.setView).toHaveBeenLastCalledWith(expect.objectContaining(frameView(place, radius, FIELD_DESIGN_WIDTH.wide, FIELD_DESIGN_HEIGHT.wide)));
    else expect(map.setView).not.toHaveBeenCalled();
    k.handle.destroy();
  });
});

describe('versioned explicit public presentation', () => {
  it('loads presented-view code only on an explicit request and acknowledges after the renderer arrives', async () => {
    let deliver!: (renderer: typeof pairedRenderer) => void;
    const pending = new Promise<typeof pairedRenderer>(resolve => { deliver = resolve; });
    const loadPaired = vi.fn(() => pending);
    const k = mount({ stored: STORED, loadPaired });
    await flush();
    k.handlers.onCodes(batch(NOW), NOW);
    k.handlers.onPaired?.(NOW + 600_000);
    expect(loadPaired).not.toHaveBeenCalled();
    k.handlers.onPresentation?.({ version: 1, revision: 1, target: { layer: 'u-pokretu', selection: { kind: 'route', id: '6' } }, expiresAt: NOW + 600_000, dataToken: 'dt' });
    await flush();
    expect(loadPaired).toHaveBeenCalledTimes(1);
    expect(q(k.root, '[data-testid=kiosk-layer]')!.dataset.presentationStatus).toBe('loading');
    expect(q(k.root, '[data-testid=kiosk-qr] svg')).not.toBeNull();
    expect(q(k.root, '[data-testid=strip-pharmacy]')).not.toBeNull();
    expect(k.beacon.acknowledgePresentation).not.toHaveBeenCalled();
    deliver(pairedRenderer);
    await flush();
    expect(q(k.root, '[data-testid=kiosk-layer]')!.dataset.presentationStatus).toBe('displayed');
    expect(k.beacon.acknowledgePresentation).toHaveBeenCalledWith(1, 'displayed');
    k.handle.destroy();
  });

  it('a late renderer cannot resurrect a cancelled presentation and is reused by the next one', async () => {
    let deliver!: (renderer: typeof pairedRenderer) => void;
    const pending = new Promise<typeof pairedRenderer>(resolve => { deliver = resolve; });
    const loadPaired = vi.fn(() => pending);
    const k = mount({ stored: STORED, loadPaired });
    k.handlers.onPresentation?.({ version: 1, revision: 1, target: { layer: 'u-pokretu', selection: { kind: 'route', id: '6' } }, expiresAt: NOW + 600_000, dataToken: 'dt' });
    await flush();
    k.handlers.onPresentation?.({ version: 1, revision: 2, target: null, expiresAt: null });
    const invitation = q(k.root, '[data-testid=kiosk-invitation]');
    deliver(pairedRenderer);
    await flush();
    expect(q(k.root, '[data-testid=kiosk-invitation]')).toBe(invitation);
    expect(q(k.root, '[data-testid=kiosk-layer]')).toBeNull();
    expect(k.beacon.acknowledgePresentation).not.toHaveBeenCalledWith(1, 'displayed');
    k.handlers.onPresentation?.({ version: 1, revision: 3, target: { layer: 'u-pokretu', selection: { kind: 'route', id: '7' } }, expiresAt: NOW + 600_000, dataToken: 'dt2' });
    await flush();
    expect(loadPaired).toHaveBeenCalledTimes(1);
    expect(k.beacon.acknowledgePresentation).toHaveBeenCalledWith(3, 'displayed');
    k.handle.destroy();
  });

  it('a failed presentation chunk keeps the QR and sends only an unavailable receipt', async () => {
    const loadPaired = vi.fn(async () => { throw new Error('chunk unavailable'); });
    const k = mount({ stored: STORED, loadPaired });
    k.handlers.onCodes(batch(NOW), NOW);
    k.handlers.onPresentation?.({ version: 1, revision: 1, target: { layer: 'zrak-i-nebo' }, expiresAt: NOW + 600_000, dataToken: 'dt' });
    await flush();
    expect(q(k.root, '[data-testid=kiosk-layer]')!.dataset.presentationStatus).toBe('unavailable');
    expect(q(k.root, '[data-testid=kiosk-qr] svg')).not.toBeNull();
    expect(k.beacon.acknowledgePresentation).toHaveBeenCalledWith(1, 'unavailable');
    expect(k.beacon.acknowledgePresentation).not.toHaveBeenCalledWith(1, 'displayed');
    expect(loadPaired).toHaveBeenCalledTimes(1);
    k.handle.destroy();
  });

  it('the initial idle state preserves the mounted overview and a recent scan notice', async () => {
    const k = mount({ stored: STORED });
    await flush();
    const overview = q(k.root, '[data-testid=kiosk-invitation]');
    const rows = q(k.root, '[data-testid=nearby-rows]');
    k.handlers.onPresentation?.({ version: 1, revision: 0, target: null, expiresAt: null });
    expect(q(k.root, '[data-testid=kiosk-invitation]')).toBe(overview);
    expect(q(k.root, '[data-testid=nearby-rows]')).toBe(rows);
    k.handlers.onPaired?.(NOW + 600_000);
    k.handlers.onPresentation?.({ version: 1, revision: 1, target: null, expiresAt: null });
    expect(q(k.root, '[data-testid=kiosk-invitation]')).toBe(overview);
    expect(text(q(k.root, '[data-testid=kiosk-head-mid]'))).toContain('otvoren');
  });
  it('a scan acknowledges access without changing the useful overview or joining a room', async () => {
    const k = mount({ stored: STORED });
    await flush();
    const overview = q(k.root, '[data-testid=kiosk-invitation]');
    const board = q(k.root, '[data-testid=nearby-rows]');
    k.handlers.onPaired?.(NOW + 600_000);
    expect(k.handle.phase()).toBe('invitation');
    expect(q(k.root, '[data-testid=kiosk-invitation]')).toBe(overview);
    expect(q(k.root, '[data-testid=nearby-rows]')).toBe(board);
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
    expect(q(k.root, '[data-testid=kiosk-stop-presentation]'), 'no control at the screen ends a presentation (T6)').toBeNull();
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

describe('start: one field, one line, Pokreni', () => {
  it('offers the one field, the whole-city line and Pokreni; nothing loads before the field is touched; the strip is already there', () => {
    const k = mount();
    expect(k.handle.phase()).toBe('setup');
    expect(q(k.root, '[data-testid=kiosk-setup]')).not.toBeNull();
    expect(text(q(k.root, 'h1'))).toBe('Pokreni gradski zaslon');
    const field = k.root.querySelector<HTMLInputElement>('[data-testid=kiosk-setup] input[data-testid=setup-place]')!;
    expect(field.getAttribute('role')).toBe('combobox');
    expect(text(field.closest('label'))).toBe('Adresa ili stajalište');
    expect(field.value).toBe('');
    expect(k.root.querySelector<HTMLElement>('[data-testid=setup-suggestions]')!.hidden).toBe(true);
    expect(text(q(k.root, '[data-testid=setup-preview]'))).toBe('Na zaslonu: cijeli grad.');
    expect(text(q(k.root, '[data-testid=setup-create]'))).toBe('Pokreni');
    // One optional field and nothing else to decide: no district, no stop list, no paragraphs around it.
    expect(q(k.root, '[data-testid=kiosk-setup] select')).toBeNull();
    expect(k.root.querySelectorAll('[data-testid=kiosk-setup] input')).toHaveLength(1);
    expect(q(k.root, '.k-setup-intro')).toBeNull();
    expect(q(k.root, '.k-setup-meta')).toBeNull();
    expect(k.loadStops).not.toHaveBeenCalled();
    expect(k.beacon.connect).not.toHaveBeenCalled();
    expect(q(k.root, '[data-testid=kiosk-essentials-open]')).toBeNull(); // the verdict is a plain word while the start screen or a session owns the screen
    expect(q(k.root, 'span.k-strip-verdict[data-testid=strip-verdict]')).not.toBeNull();
    expect(text(q(k.root, '[data-testid=safety-strip]'))).toContain('Sigurnost');
    expect(q(k.root, '[data-testid=kiosk-alert]')!.hidden).toBe(true);
  });
  it('an empty field posts exactly {} on one press, the whole city as before, and boots the beacon', async () => {
    const createScreen = vi.fn(async () => ({ beaconId: 'NEW00001', secret: 'S3CR3TXYZ', provisionUrl: 'https://zagreb.aningfilm.hr/kiosk/#NEW00001.S3CR3TXYZ', screen: CITY_SCREEN }));
    const k = mount({ createScreen });
    await flush();
    submit(k.root);
    await flush();
    expect(createScreen).toHaveBeenCalledTimes(1);
    expect(createScreen).toHaveBeenCalledWith({});
    // Only after creation: the default place's radius and platform boards need the stop table.
    expect(k.loadStops).toHaveBeenCalledTimes(1);
    expect(k.loadStreets).not.toHaveBeenCalled();
    expect(k.handle.phase()).toBe('invitation');
    expect(JSON.parse(k.raw[BEACON_STORAGE_KEY]!)).toEqual({ beaconId: 'NEW00001', secret: 'S3CR3TXYZ', screen: CITY_SCREEN });
    expect(k.beacon.connect).toHaveBeenCalledTimes(1);
    expect(k.root.innerHTML).not.toContain('S3CR3TXYZ');
    expect(q(k.root, '[data-testid=kiosk-setup]')).toBeNull();
  });
  it('through the kiosk: the first touch loads both lists, typing suggests after the pause on the kiosk timers, and the pick is what Pokreni posts', async () => {
    const createScreen = vi.fn(async (_input: object) => ({ beaconId: 'NEW00001', secret: 'nova', provisionUrl: 'https://zagreb.aningfilm.hr/kiosk/#NEW00001.nova', screen: SCREEN }));
    const k = mount({ createScreen });
    const field = k.root.querySelector<HTMLInputElement>('[data-testid=setup-place]')!;
    field.dispatchEvent(new FocusEvent('focus'));
    await flush();
    expect(k.loadStops).toHaveBeenCalledTimes(1);
    expect(k.loadStreets).toHaveBeenCalledTimes(1);
    field.value = 'Zapr';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    k.tick(120);
    const rows = k.root.querySelectorAll<HTMLElement>('[data-testid=setup-suggestions] > [data-testid=setup-suggestion]');
    expect(text(rows[0]!.querySelector('.k-suggest-name'))).toBe('Zapruđe');
    rows[0]!.click();
    expect(text(k.root.querySelector('[data-testid=setup-preview]'))).toBe('Na zaslonu: Zapruđe i 6 stajališta uokolo');
    k.root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(createScreen).toHaveBeenCalledWith({ place: { kind: 'stop', stopId: '200_1' }, frame: 6 });
    expect(k.handle.phase()).toBe('invitation');
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

// The field itself (kiosk/place-field.ts) through the start screen alone. The
// ranking of suggestions is places.ts's and has its own tests
// (kiosk-places.test.ts); here the test decides what is suggested, and
// everything after it is real: the pause, the rows, the pick, the derivation
// of the place, the line under the field and what Pokreni posts.
describe('start: the field turns what is typed into the screen’s place', () => {
  type StartModule = typeof import('../../app/src/kiosk/start');
  type KioskStrings = import('../../app/src/kiosk/strings').KioskStrings;
  /** Typing rests this long before the rows are worked out (place-field.ts PLACE_DEBOUNCE_MS). */
  const PAUSE_MS = 120;
  type Suggestion = import('../../app/src/kiosk/places').PlaceSuggestion;
  type Street = import('../../app/src/kiosk/places').StreetGeo;
  const PLACES_MODULE = '../../app/src/kiosk/places';
  const street = (name: string, lon: number, lat: number): Street => ({ name, lon, lat, bbox: [lon - 0.002, lat - 0.001, lon + 0.002, lat + 0.001], lengthM: 400, stops: [] });
  /** 170 m from the Zapruđe tram platform: a pick here is that stop. */
  const NEAR_ZAPRUDJE = street('Meštrovićev trg', 15.9905, 45.7715);
  /** About 1.7 km from every stop of the fixture: a pick here stays the street. */
  const ILICA = street('Ilica', 15.955, 45.8125);
  const ZAPRUDJE_ROW: Suggestion = { kind: 'stop', stop: { ...STOPS[2], distanceM: null } };
  const NO_MATCH = 'Nema takvog stajališta ni ulice. Odaberi prijedlog ili ostavi polje prazno za cijeli grad.';

  interface StartEnv { mountStart: StartModule['mountStart']; strings: KioskStrings; isTram: (routeId: string) => boolean }
  /** start.ts over a places.ts whose suggestPlaces answers `suggest`; the rest of that module stays real. */
  async function startWith(suggest: (query: string) => Suggestion[]): Promise<StartEnv> {
    vi.resetModules();
    vi.doMock(PLACES_MODULE, async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../app/src/kiosk/places')>()),
      suggestPlaces: (query: string) => suggest(query),
    }));
    try {
      // The real kiosk entry installs the canonical boundary before mounting
      // start/settings. resetModules above deliberately removed that bootstrap.
      await import('../../shared/kiosk/external-text');
      const [start, field, strings, stops] = await Promise.all([import('../../app/src/kiosk/start'), import('../../app/src/kiosk/place-field'), import('../../app/src/kiosk/strings'), import('../../app/src/kiosk/stops')]);
      expect(field.PLACE_DEBOUNCE_MS).toBe(PAUSE_MS);
      return { mountStart: start.mountStart, strings: strings.kioskStrings('hr'), isTram: (routeId) => stops.routeType(routeId) === 0 };
    } finally { vi.doUnmock(PLACES_MODULE); }
  }
  const suggestBox = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>('.k-suggest-box')!;
  function harness(mod: StartEnv, opts: { loadStops?: () => Promise<typeof STOPS>; loadStreets?: () => Promise<Street[]> } = {}) {
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    const timers: Timer[] = [];
    const createScreen = vi.fn(async (_input: object) => ({ beaconId: 'NEW00001', secret: 'nova', provisionUrl: 'https://zagreb.aningfilm.hr/kiosk/#NEW00001.nova', screen: CITY_SCREEN }));
    const loadStops = vi.fn(opts.loadStops ?? (async () => STOPS));
    const loadStreets = vi.fn(opts.loadStreets ?? (async () => [NEAR_ZAPRUDJE, ILICA]));
    const onCreated = vi.fn();
    const handle = mod.mountStart(host, {
      strings: mod.strings, locale: 'hr', createScreen, loadStops, loadStreets, isTram: mod.isTram, onCreated, now: () => NOW,
      setTimeout: (fn, ms) => { const t: Timer = { fn, ms, cleared: false }; timers.push(t); return t; },
      clearTimeout: (h) => { (h as Timer).cleared = true; },
    });
    const input = host.querySelector<HTMLInputElement>('[data-testid=setup-place]')!;
    const list = host.querySelector<HTMLElement>('[data-testid=setup-suggestions]')!;
    return {
      host, handle, input, list, timers, createScreen, loadStops, loadStreets, onCreated,
      focus: () => { input.dispatchEvent(new FocusEvent('focus')); },
      /** The focus leaves the field for somewhere outside it. */
      blur: () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null })); },
      box: () => suggestBox(host),
      type: (value: string) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); },
      key: (key: string) => { input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); },
      /** Fires the armed timers registered at a delay, as the kiosk's oneShot would. */
      tick: (ms: number) => { for (const t of [...timers]) if (t.ms === ms && !t.cleared) { t.cleared = true; t.fn(); } },
      rows: () => [...list.querySelectorAll<HTMLElement>(':scope > [data-testid=setup-suggestion]')],
      names: () => [...list.querySelectorAll('.k-suggest-name')].map(text),
      status: () => text(host.querySelector<HTMLElement>('.k-suggest-status')),
      preview: () => text(host.querySelector<HTMLElement>('[data-testid=setup-preview]')),
      error: () => text(host.querySelector<HTMLElement>('[data-testid=setup-error]')),
      submit: () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); },
    };
  }

  it('typing a stop name suggests it after the pause; picking it writes the line, and Pokreni posts the stop with Kadar 6', async () => {
    const h = harness(await startWith((query) => (query === 'Zapr' ? [ZAPRUDJE_ROW] : [])));
    h.focus();
    await flush();
    expect(h.loadStops).toHaveBeenCalledTimes(1);
    expect(h.loadStreets).toHaveBeenCalledTimes(1);
    h.type('Zapr');
    // Nothing before the pause, and typed text is not a place yet: the line says nothing rather than "cijeli grad".
    expect(h.rows()).toHaveLength(0);
    expect(h.preview()).toBe('');
    h.tick(PAUSE_MS);
    expect(h.names()).toEqual(['Zapruđe']);
    expect(text(h.list.querySelector('.k-suggest-meta'))).toBe('linije 7');
    expect(h.rows()[0]!.dataset.kind).toBe('stop');
    expect(h.rows()[0]!.getAttribute('role')).toBe('option');
    expect(h.input.getAttribute('aria-expanded')).toBe('true');
    h.rows()[0]!.click();
    expect(h.input.value).toBe('Zapruđe');
    expect(h.list.hidden).toBe(true);
    expect(h.preview()).toBe('Na zaslonu: Zapruđe i 6 stajališta uokolo');
    h.submit();
    await flush();
    expect(h.createScreen).toHaveBeenCalledTimes(1);
    expect(h.createScreen).toHaveBeenCalledWith({ place: { kind: 'stop', stopId: '200_1' }, frame: 6 });
    expect(h.onCreated).toHaveBeenCalledTimes(1);
    expect(h.loadStops).toHaveBeenCalledTimes(1);
  });
  it('a street becomes the tram stop within 400 m of it; farther from every stop it stays the street and keeps the typed number', async () => {
    const h = harness(await startWith((query) => (query === 'Meštr' ? [{ kind: 'street', street: NEAR_ZAPRUDJE }] : query === 'Ilica 25' ? [{ kind: 'street', street: ILICA, number: '25' }] : [])));
    h.type('Meštr');
    await flush();
    h.tick(PAUSE_MS);
    expect(h.names()).toEqual(['Meštrovićev trg']);
    h.rows()[0]!.click();
    expect(h.input.value).toBe('Meštrovićev trg');
    expect(h.preview()).toBe('Na zaslonu: Zapruđe i 6 stajališta uokolo');
    // Editing the picked text undoes the pick until another row is picked.
    h.type('Ilica 25');
    expect(h.preview()).toBe('');
    h.tick(PAUSE_MS);
    expect(h.names()).toEqual(['Ilica 25']);
    expect(h.rows()[0]!.dataset.kind).toBe('street');
    h.rows()[0]!.click();
    expect(h.preview()).toBe('Na zaslonu: Ilica i 6 stajališta uokolo');
    h.submit();
    await flush();
    expect(h.createScreen).toHaveBeenCalledWith({ place: { kind: 'address', name: 'Ilica', lon: 15.955, lat: 45.8125, address: 'Ilica 25' }, frame: 6 });
  });
  it('text that matches nothing creates nothing: the field and Pokreni both say so, and an emptied field is the whole city again', async () => {
    const h = harness(await startWith(() => []));
    h.type('Xyzzy');
    await flush();
    h.tick(PAUSE_MS);
    expect(h.rows()).toHaveLength(0);
    expect(h.status()).toBe(NO_MATCH);
    h.submit();
    await flush();
    expect(h.createScreen).not.toHaveBeenCalled();
    expect(h.error()).toBe(NO_MATCH);
    expect(h.host.querySelector<HTMLElement>('[data-testid=setup-retry]')!.hidden).toBe(true);
    expect(text(h.host.querySelector<HTMLElement>('[data-testid=setup-create]'))).toBe('Pokreni');
    h.type('');
    expect(h.host.querySelector<HTMLElement>('[data-testid=setup-error]')!.hidden).toBe(true);
    expect(h.preview()).toBe('Na zaslonu: cijeli grad.');
    h.submit();
    await flush();
    expect(h.createScreen).toHaveBeenCalledTimes(1);
    expect(h.createScreen).toHaveBeenCalledWith({});
  });
  it('a full stop name typed and never picked still becomes that stop on Pokreni', async () => {
    const h = harness(await startWith(() => []));
    h.type('zapruđe');
    h.submit();
    await flush();
    expect(h.input.value).toBe('Zapruđe');
    expect(h.preview()).toBe('Na zaslonu: Zapruđe i 6 stajališta uokolo');
    expect(h.createScreen).toHaveBeenCalledWith({ place: { kind: 'stop', stopId: '200_1' }, frame: 6 });
  });
  it('the keyboard walks the rows: arrows highlight, Enter picks, Escape closes the list and keeps the text', async () => {
    const h = harness(await startWith((query) => (query.startsWith('Zapr') ? [ZAPRUDJE_ROW, { kind: 'street', street: NEAR_ZAPRUDJE }] : [])));
    h.type('Zapr');
    await flush();
    h.tick(PAUSE_MS);
    expect(h.rows()).toHaveLength(2);
    h.key('Escape');
    expect(h.host.querySelector<HTMLElement>('.k-suggest-box')!.hidden).toBe(true);
    expect(h.input.value).toBe('Zapr');
    h.type('Zapru');
    h.tick(PAUSE_MS);
    h.key('ArrowDown');
    h.key('ArrowDown');
    expect(h.rows().map((row) => row.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(h.input.getAttribute('aria-activedescendant')).toBe(h.rows()[1]!.id);
    h.key('ArrowUp');
    expect(h.rows().map((row) => row.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    h.key('Enter');
    expect(h.input.value).toBe('Zapruđe');
    expect(h.preview()).toBe('Na zaslonu: Zapruđe i 6 stajališta uokolo');
    expect(h.createScreen).not.toHaveBeenCalled();
  });
  it('editing the text retires the rows on show at once: Enter inside the pause picks nothing stale, and a stale row does not answer a click', async () => {
    const kvaternikov: Suggestion = { kind: 'stop', stop: { id: '236_2', name: 'Kvaternikov trg', lon: 15.9975, lat: 45.815, routes: ['4', '7'], distanceM: null } };
    const h = harness(await startWith((query) => (query === 'Kvatern' ? [kvaternikov] : query === 'Zapruđe' ? [ZAPRUDJE_ROW] : [])));
    h.type('Kvatern');
    await flush();
    h.tick(PAUSE_MS);
    h.key('ArrowDown');
    const stale = h.rows()[0]!;
    expect(stale.getAttribute('aria-selected')).toBe('true');
    h.type('Zapruđe');
    expect(stale.getAttribute('aria-selected')).toBe('false');
    expect(h.input.hasAttribute('aria-activedescendant')).toBe(false);
    stale.click();
    expect(h.input.value).toBe('Zapruđe');
    expect(h.preview()).toBe('');
    h.key('Enter');
    await flush();
    expect(h.input.value).toBe('Zapruđe');
    expect(h.preview()).toBe('Na zaslonu: Zapruđe i 6 stajališta uokolo');
    h.submit();
    await flush();
    expect(h.createScreen).toHaveBeenCalledWith({ place: { kind: 'stop', stopId: '200_1' }, frame: 6 });
  });
  it('streets that share a name show their settlements, and a shared name typed in full waits for a pick instead of choosing one', async () => {
    const inSettlement = (name: string, lon: number, lat: number, settlement: string): Street => ({ ...street(name, lon, lat), settlement } as Street);
    const gajevaZagreb = inSettlement('Gajeva ulica', 15.9745, 45.811, 'Zagreb');
    const gajevaSesvete = inSettlement('Gajeva ulica', 16.11, 45.83, 'Sesvete');
    const ilica = inSettlement('Ilica', 15.955, 45.8125, 'Zagreb');
    const offer = (query: string): Suggestion[] => (query.startsWith('Gajeva') ? [{ kind: 'street', street: gajevaZagreb }, { kind: 'street', street: gajevaSesvete }] : query === 'Ilica' ? [{ kind: 'street', street: ilica }] : []);
    const h = harness(await startWith(offer), { loadStreets: async () => [gajevaZagreb, gajevaSesvete, ilica] });
    h.type('Ilica');
    await flush();
    h.tick(PAUSE_MS);
    // A name only one street carries needs no settlement.
    expect(h.list.querySelector('.k-suggest-meta')).toBeNull();
    h.type('Gajeva ulica');
    h.submit();
    await flush();
    expect(h.createScreen).not.toHaveBeenCalled();
    expect(h.error()).toBe('Više ulica ima to ime. Odaberi prijedlog s popisa.');
    expect(h.preview()).toBe('');
    expect(h.names()).toEqual(['Gajeva ulica', 'Gajeva ulica']);
    expect([...h.list.querySelectorAll('.k-suggest-meta')].map(text)).toEqual(['Zagreb', 'Sesvete']);
    expect(h.status()).toBe('Više ulica ima to ime. Odaberi prijedlog s popisa.');
    h.rows()[1]!.click();
    expect(h.preview()).toBe('Na zaslonu: Gajeva ulica i 6 stajališta uokolo');
    h.submit();
    await flush();
    expect(h.createScreen).toHaveBeenCalledWith({ place: { kind: 'address', name: 'Gajeva ulica', lon: 16.11, lat: 45.83 }, frame: 6 });
  });
  it('Escape or a focus that leaves the field keeps the list shut through a pending pause or load; coming back shows the rows again at once', async () => {
    let release!: (stops: typeof STOPS) => void;
    const pending = new Promise<typeof STOPS>((resolve) => { release = resolve; });
    const h = harness(await startWith((query) => (query.startsWith('Zapr') ? [ZAPRUDJE_ROW] : [])), { loadStops: () => pending });
    h.type('Zapr');
    h.tick(PAUSE_MS);
    expect(h.status()).toBe('Učitavanje adresa i stajališta');
    h.blur();
    expect(h.box().hidden).toBe(true);
    release(STOPS);
    await flush();
    expect(h.box().hidden).toBe(true);
    // Back in the field: the loaded rows at once, nothing fetched again.
    h.focus();
    expect(h.names()).toEqual(['Zapruđe']);
    expect(h.box().hidden).toBe(false);
    expect(h.loadStops).toHaveBeenCalledTimes(1);
    // Escape inside the pause: the pending refresh is dropped.
    h.type('Zapru');
    h.key('Escape');
    h.tick(PAUSE_MS);
    expect(h.box().hidden).toBe(true);
    h.focus();
    expect(h.names()).toEqual(['Zapruđe']);
    h.key('Escape');
    expect(h.box().hidden).toBe(true);
    expect(h.input.value).toBe('Zapru');
  });
  it('the lists load on the first touch and say so; a failed load is said in the field and on Pokreni, and only a person tries again', async () => {
    let release!: (stops: typeof STOPS) => void;
    const pending = new Promise<typeof STOPS>((resolve) => { release = resolve; });
    const h = harness(await startWith((query) => (query === 'Zapr' ? [ZAPRUDJE_ROW] : [])), { loadStops: () => pending, loadStreets: async () => { throw new Error('streets-unavailable'); } });
    h.type('Zapr');
    h.tick(PAUSE_MS);
    // A status in the field is a whole phrase, never trailed by an ellipsis (§13), in both catalogues.
    expect(h.status()).toBe('Učitavanje adresa i stajališta');
    expect(createDefaultI18n('en').t('kiosk.setup.loadingPlaces')).toBe('Loading addresses and stops');
    release(STOPS);
    await flush();
    // The street index failing leaves the stops to suggest from.
    expect(h.names()).toEqual(['Zapruđe']);
    expect(h.loadStops).toHaveBeenCalledTimes(1);

    const down = harness(await startWith(() => []), { loadStops: async () => { throw new Error('stops-unavailable'); } });
    down.focus();
    await flush();
    down.type('Zapr');
    await flush();
    down.tick(PAUSE_MS);
    expect(down.status()).toBe('Popis adresa i stajališta nije dostupan.');
    const attempts = down.loadStops.mock.calls.length;
    for (const t of [...down.timers]) if (!t.cleared) t.fn();
    await flush();
    expect(down.loadStops).toHaveBeenCalledTimes(attempts);
    down.submit();
    await flush();
    expect(down.error()).toBe('Popis adresa i stajališta nije dostupan.');
    expect(down.createScreen).not.toHaveBeenCalled();
    down.type('');
    down.submit();
    await flush();
    expect(down.createScreen).toHaveBeenCalledWith({});
  });
});

describe('settings: the panel on the screen itself', () => {
  const brand = (k: ReturnType<typeof mount>) => q(k.root, '[data-testid=kiosk-brand]') as HTMLButtonElement;
  const press = (k: ReturnType<typeof mount>, type: string, init: PointerEventInit = {}) => brand(k).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init }));
  /** A press held on the brand: Postavke open after LONG_PRESS_MS on the kiosk's own clock. */
  const open = (k: ReturnType<typeof mount>) => { press(k, 'pointerdown'); k.tick(LONG_PRESS_MS); press(k, 'pointerup'); };
  const panel = (k: ReturnType<typeof mount>) => q(k.root, '[data-testid=kiosk-settings-panel]');
  const toggle = (k: ReturnType<typeof mount>, name: string) => q(panel(k)!, `[data-testid=toggle-${name}]`) as HTMLButtonElement;
  const TRG_PLACE = { kind: 'tram' as const, name: 'Trg bana J. Jelačića', lon: STOP.lon, lat: STOP.lat, stopId: '106_1' };
  const ZAPRUDE_PLACE = { kind: 'tram' as const, name: 'Zapruđe', lon: 15.99, lat: 45.77, stopId: '200_1' };
  /** The DO's answer to a v2 frame for the fixture stops: the screen as it stores and enriches it. */
  const answer = (k: ReturnType<typeof mount>, place: typeof TRG_PLACE | null, frame: 4 | 6 | 8) => k.handlers.onContext?.({
    kind: 'temporary', expiresAt: NOW + 20 * 3_600_000, stop: place ? STOPS.find((stop) => stop.id === place.stopId)! : null,
    area: place ? 'gornji-grad-medvescak' : 'zagreb', place: place ?? TRG_PLACE, placeSet: place !== null, frame,
  });

  it('the invitation header has no button except the brand', async () => {
    const k = mount({ stored: STORED });
    await flush();
    const buttons = [...k.root.querySelectorAll<HTMLElement>('.k-head button')];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.dataset.testid).toBe('kiosk-brand');
    expect(buttons[0]!.getAttribute('aria-label')).toBe('Kaj ima? · Postavke zaslona');
    expect(text(buttons[0]!)).toBe('Kaj ima?');
    expect(q(k.root, '[data-testid=kiosk-settings]')).toBeNull();
    expect(q(k.root, '[data-testid=kiosk-theme]')).toBeNull();
  });

  it('opens on a press held on the brand, with the screen’s own place and frame; a tap opens nothing', async () => {
    const k = mount({ stored: STORED });
    await flush();
    brand(k).click();
    press(k, 'pointerdown');
    k.tick(CODE_TICK_MS);
    press(k, 'pointerup');
    k.tick(LONG_PRESS_MS);
    expect(panel(k)).toBeNull(); // built on the first long press, not at mount
    open(k);
    await flush();
    const box = panel(k)!;
    expect(box.hidden).toBe(false);
    expect([...box.querySelectorAll('.k-settings-row')].map((el) => (el as HTMLElement).dataset.row)).toEqual(['place', 'frame', 'view', 'theme', 'rhythm', 'screen']);
    // A screen from before place-v2 names its stop: that stop is its place.
    expect(text(q(box, '[data-testid=settings-place]'))).toBe('Trg bana J. Jelačića');
    expect(text(toggle(k, 'frame'))).toBe('Kadar: 6 stajališta odavde');
    expect(toggle(k, 'frame').dataset.value).toBe('6');
    expect(text(toggle(k, 'view'))).toBe('Prikaz: karta');
    expect(text(toggle(k, 'theme'))).toBe('Tema: po suncu');
    expect(text(toggle(k, 'rhythm'))).toBe('Ritam: 20 s');
    // Twenty hours from 14:32 is tomorrow morning, so the day goes with the clock.
    expect(text(q(box, '[data-testid=settings-expiry]'))).toBe('Vrijedi do sub 12. 9. 10:32');
    // The wall already loaded its stop table; opening settings adds no place-field request.
    expect(q(box, '[data-testid=settings-save]')).toBeNull();
    expect(k.loadStops).toHaveBeenCalledTimes(1);
    expect(k.loadStreets).not.toHaveBeenCalled();
  });

  it('a short press or a moved finger does not open settings; Enter on the brand does at once', async () => {
    const k = mount({ stored: STORED });
    await flush();
    press(k, 'pointerdown');
    press(k, 'pointerup');
    k.tick(LONG_PRESS_MS);
    press(k, 'pointerdown', { clientX: 10, clientY: 10 });
    press(k, 'pointermove', { clientX: 30, clientY: 10 });
    k.tick(LONG_PRESS_MS);
    expect(panel(k)).toBeNull();
    brand(k).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(panel(k)!.hidden).toBe(false);
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

  it('Kadar click changes the text at once and sends one v2 frame after the debounce; the DO’s answer sets data-frame on the shell', async () => {
    const k = mount({ stored: STORED });
    await flush();
    const shell = q(k.root, '[data-testid=kiosk]')!;
    expect(shell.dataset.frame).toBe('6');
    expect(shell.dataset.placeKind).toBe('tram');
    open(k);
    toggle(k, 'frame').click();
    expect(text(toggle(k, 'frame'))).toBe('Kadar: 8 stajališta odavde');
    expect(k.beacon.setScreen).not.toHaveBeenCalled();
    k.tick(SETTINGS_SEND_DELAY_MS);
    expect(k.beacon.setScreen).toHaveBeenCalledTimes(1);
    expect(k.beacon.setScreen).toHaveBeenCalledWith({ place: { kind: 'stop', stopId: '106_1' }, frame: 8 });
    // Nothing is painted from the panel: the DO's answer is what re-frames the screen.
    expect(shell.dataset.frame).toBe('6');
    answer(k, TRG_PLACE, 8);
    expect(shell.dataset.frame).toBe('8');
    // Toggles stay open: the panel is still there for the next click.
    expect(panel(k)!.hidden).toBe(false);
    expect(JSON.parse(k.raw[BEACON_STORAGE_KEY]!).screen).toMatchObject({ frame: 8, place: { stopId: '106_1' }, placeSet: true });
    k.tick(SCREEN_SET_MIN_MS);
    expect(k.beacon.setScreen).toHaveBeenCalledTimes(1);
  });

  it('three quick clicks send one frame carrying the last value', async () => {
    const k = mount({ stored: STORED });
    await flush();
    open(k);
    toggle(k, 'frame').click(); // 8
    toggle(k, 'frame').click(); // 4
    toggle(k, 'place').click();
    q(panel(k)!, '[data-testid=settings-place-city]')!.click(); // the whole city
    expect(text(q(panel(k)!, '[data-testid=settings-place]'))).toBe('Cijeli grad');
    k.tick(SETTINGS_SEND_DELAY_MS);
    expect(k.beacon.setScreen.mock.calls).toEqual([[{ place: null, frame: 4 }]]);
  });

  it('a second change inside five seconds waits for the window', async () => {
    const k = mount({ stored: STORED });
    await flush();
    open(k);
    toggle(k, 'frame').click();
    k.tick(SETTINGS_SEND_DELAY_MS);
    answer(k, TRG_PLACE, 8);
    toggle(k, 'frame').click();
    expect(text(toggle(k, 'frame'))).toBe('Kadar: 4 stajališta odavde');
    k.tick(SETTINGS_SEND_DELAY_MS);
    expect(k.beacon.setScreen).toHaveBeenCalledTimes(1);
    k.tick(SCREEN_SET_MIN_MS);
    expect(k.beacon.setScreen).toHaveBeenCalledTimes(2);
    expect(k.beacon.setScreen).toHaveBeenLastCalledWith({ place: { kind: 'stop', stopId: '106_1' }, frame: 4 });
  });

  it('a refusal repaints the toggle from the DO’s truth, and a repeat inside the DO’s window says so', async () => {
    const k = mount({ stored: STORED });
    await flush();
    open(k);
    const box = panel(k)!;
    toggle(k, 'frame').click();
    k.tick(SETTINGS_SEND_DELAY_MS);
    expect(k.beacon.setScreen).toHaveBeenCalledTimes(1);
    // An error word that belongs to something else on the socket is not this panel's.
    k.handlers.onError?.('auth-required');
    expect(text(toggle(k, 'frame'))).toBe('Kadar: 8 stajališta odavde');
    expect(q(box, '[data-testid=settings-error]')!.hidden).toBe(true);
    k.handlers.onError?.('bad-place');
    expect(box.hidden).toBe(false);
    expect(text(toggle(k, 'frame'))).toBe('Kadar: 6 stajališta odavde');
    expect(text(q(box, '[data-testid=settings-error]'))).toBe('Poslužitelj nije prihvatio mjesto. Odaberi ponovno.');
    // Nothing is re-sent by the clock.
    k.tick(SETTINGS_SEND_DELAY_MS);
    k.tick(SCREEN_SET_MIN_MS);
    expect(k.beacon.setScreen).toHaveBeenCalledTimes(1);
    toggle(k, 'frame').click();
    k.tick(SETTINGS_SEND_DELAY_MS);
    k.tick(SCREEN_SET_MIN_MS);
    expect(k.beacon.setScreen).toHaveBeenCalledTimes(2);
    k.handlers.onError?.('screen-set-rate');
    expect(text(q(box, '[data-testid=settings-error]'))).toBe('Pričekaj koji trenutak pa odaberi ponovno.');
    expect(text(toggle(k, 'frame'))).toBe('Kadar: 6 stajališta odavde');
  });

  it('a frame with no answer in eight seconds says so and goes back; the late answer is still the truth', async () => {
    const k = mount({ stored: STORED });
    await flush();
    open(k);
    const box = panel(k)!;
    toggle(k, 'frame').click();
    k.tick(SETTINGS_SEND_DELAY_MS);
    k.tick(SAVE_TIMEOUT_MS);
    expect(box.hidden).toBe(false);
    expect(text(q(box, '[data-testid=settings-error]'))).toBe('Promjena nije poslana: zaslon trenutačno nema vezu s poslužiteljem. Pokušaj ponovno.');
    expect(text(toggle(k, 'frame'))).toBe('Kadar: 6 stajališta odavde');
    expect(k.beacon.setScreen).toHaveBeenCalledTimes(1);
    answer(k, TRG_PLACE, 8);
    expect(text(toggle(k, 'frame'))).toBe('Kadar: 8 stajališta odavde');
    expect(q(k.root, '[data-testid=kiosk]')!.dataset.frame).toBe('8');
  });

  it('says so when the socket cannot carry the change, and sends nothing', async () => {
    const k = mount({ stored: STORED });
    await flush();
    open(k);
    k.goOffline();
    toggle(k, 'frame').click();
    k.tick(SETTINGS_SEND_DELAY_MS);
    expect(k.beacon.setScreen).not.toHaveBeenCalled();
    expect(panel(k)!.hidden).toBe(false);
    expect(text(q(panel(k)!, '[data-testid=settings-error]'))).toBe('Promjena nije poslana: zaslon trenutačno nema vezu s poslužiteljem. Pokušaj ponovno.');
    expect(text(toggle(k, 'frame'))).toBe('Kadar: 6 stajališta odavde');
  });

  it('"Cijeli grad" sends place null; the chip then names the place the DO lists for the whole city', async () => {
    const k = mount({ stored: STORED });
    await flush();
    open(k);
    toggle(k, 'place').click();
    // Promijeni opens the shared "Adresa ili stajalište" field inside the row.
    expect(toggle(k, 'place').getAttribute('aria-expanded')).toBe('true');
    expect(q(panel(k)!, '[data-testid=setup-place]')).not.toBeNull();
    q(panel(k)!, '[data-testid=settings-place-city]')!.click();
    expect(q(panel(k)!, '[data-testid=setup-place]')).toBeNull();
    k.tick(SETTINGS_SEND_DELAY_MS);
    expect(k.beacon.setScreen).toHaveBeenCalledWith({ place: null, frame: 6 });
    answer(k, null, 6);
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('Trg bana J. Jelačića');
    expect(q(k.root, '[data-testid=kiosk]')!.dataset.placeKind).toBe('city');
    expect(text(q(panel(k)!, '[data-testid=settings-place]'))).toBe('Cijeli grad');
  });

  it('a stop typed in full in the field is the new place, sent as its id alone', async () => {
    const k = mount({ stored: STORED_CITY });
    await flush();
    open(k);
    toggle(k, 'place').click();
    const input = q(panel(k)!, '[data-testid=setup-place]') as HTMLInputElement;
    input.dispatchEvent(new FocusEvent('focus'));
    await flush();
    expect(k.loadStops).toHaveBeenCalledTimes(1);
    input.value = 'Zapruđe';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flush();
    expect(text(q(panel(k)!, '[data-testid=settings-place]'))).toBe('Zapruđe');
    k.tick(SETTINGS_SEND_DELAY_MS);
    expect(k.beacon.setScreen).toHaveBeenCalledWith({ place: { kind: 'stop', stopId: '200_1' }, frame: 6 });
    answer(k, ZAPRUDE_PLACE, 6);
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('Zapruđe');
  });

  it('keeps Ritam and Prikaz in this browser, on the shell at once and never on the wire', async () => {
    const k = mount({ stored: STORED });
    await flush();
    const shell = q(k.root, '[data-testid=kiosk]')!;
    expect(shell.dataset.rhythm).toBe('20');
    expect(shell.dataset.view).toBe('map');
    open(k);
    toggle(k, 'rhythm').click();
    toggle(k, 'view').click();
    expect(shell.dataset.rhythm).toBe('30');
    expect(shell.dataset.view).toBe('schema');
    expect(k.raw['vidikovac-kiosk-rhythm']).toBe('30');
    expect(k.raw['vidikovac-kiosk-view']).toBe('schema');
    k.tick(SETTINGS_SEND_DELAY_MS);
    k.tick(SCREEN_SET_MIN_MS);
    expect(k.beacon.setScreen).not.toHaveBeenCalled();
  });

  it('names the place the DO lists in the header, and Zagreb for a record that names none', async () => {
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna', screen: { ...CITY_SCREEN, area: 'trnje' } }) });
    await flush();
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('Zagreb');
    answer(k, null, 6);
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('Trg bana J. Jelačića');
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
    // The brand stays the wordmark; over a notice a long press opens nothing.
    open(k);
    expect(panel(k)!.hidden).toBe(true);
  });

  it('closes on Escape, on the close button and after 90 seconds untouched, and gives the focus back to the brand', async () => {
    const k = mount({ stored: STORED });
    await flush();
    open(k); await flush();
    panel(k)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel(k)!.hidden).toBe(true);
    expect(document.activeElement).toBe(brand(k));
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

  it('cycles the theme from the panel, through the one controller the header glyph used', async () => {
    const k = mount({ stored: STORED, themeInitial: 'auto' });
    await flush();
    open(k); await flush();
    toggle(k, 'theme').click();
    expect(k.themeCalls).toEqual(['light']);
    expect(text(toggle(k, 'theme'))).toBe('Tema: svijetla');
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
    // Two independent regions beside the map: the timeline and the card.
    const front = q(k.root, '[data-testid=kiosk-invitation]')!;
    expect(front.className).toBe('k-city-window');
    expect([...front.children].map((el) => (el as HTMLElement).dataset.panel ?? el.className)).toEqual(['k-handheld-info', 'k-geography', 'k-overview']);
    expect(q(front, '.k-geography .k-field')).not.toBeNull();
    const column = q(front, '.k-overview')!;
    expect(column.tagName).toBe('ASIDE');
    expect([...column.children].map((el) => el.className)).toEqual(['k-nearby-host', 'k-panel--card']);
    expect(q(column, '.k-panel--card [data-testid=kiosk-invite]')).not.toBeNull();
    // Paired cards are not duplicated on the public overview.
    for (const gone of ['around', 'city']) expect(q(front, `[data-testid=kiosk-panel-${gone}]`), gone).toBeNull();
    const closure = q(front, '.nearby-row[data-kind=closure]')!;
    expect(text(closure)).toContain('Ilica');
    expect(closure.dataset.source).toBe('prometnice');
    expect(text(q(front, '[data-testid=nearby]'))).not.toMatch(/Dohvaćeno|zastarjelo|nepotvrđeno/);
    expect(q(front,'[data-testid=kiosk-panel-promet]')).toBeNull();
    expect(q(front, '[data-testid=kiosk-panel-weather]')).toBeNull();
    expect(q(front, '[data-testid=nearby-head]')).not.toBeNull();
    expect(q(front, '[data-testid=kiosk-panel-tonight]')).toBeNull();
    for (const gone of ['kiosk-scene', 'kiosk-scene-meta', 'kiosk-tiles', 'tile-vehicles', 'tile-closures', 'kiosk-tonight', 'kiosk-city', 'k-city-ink']) expect(q(k.root, `[data-testid=${gone}]`), gone).toBeNull();
    for (const gone of ['.k-scene', '.k-rail', '.k-side-tiles', '.k-dot', '.k-scene-head']) expect(q(k.root, gone), gone).toBeNull();
    const sentence = q(k.root, '[data-testid=kiosk-sentence]')!;
    expect(sentence.hidden).toBe(false);
    expect(sentence.dataset.kicker).toBeTruthy();
    expect(Number(sentence.dataset.validUntil)).toBeGreaterThan(NOW);
    expect(sentenceText(k.root).length).toBeLessThanOrEqual(80);
    expect(q(k.root,'.k-map-legend')).not.toBeNull();
    // Three plain items from kiosk.legend.* (WP2), never a caveat: a BAJS disc with no count is grey and blank, not "?".
    expect(k.root.querySelectorAll('.k-map-legend span')).toHaveLength(3);
    expect(text(q(k.root, '.k-map-legend'))).not.toContain('?');
    expect(q(k.root, '[data-testid=kiosk-weather]')).toBeNull();
    expect(k.root.querySelectorAll('.k-weather-current .k-temp')).toHaveLength(0);
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
    expect(text(q(k.root, '[data-testid=kiosk-code]'))).toBe('ABCD·EFG0');
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
    expect(text(q(k.root, '[data-testid=kiosk-qr]'))).toBe('Kod stiže');
    k.handlers.onCodes(batch(NOW - 7_000), NOW);
    expect(q(k.root, '[data-testid=code-progress]')!.dataset.pct).toBe('0.80');
  });
  it('the header sentence changes on the rhythm without rebuilding the timeline or adding a rotation clock', async () => {
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
    const firstText = sentenceText(k.root);
    now += 19_000;k.tick(CODE_TICK_MS);
    expect(sentenceText(k.root)).toBe(firstText);
    now += 1_000;k.tick(CODE_TICK_MS);
    expect(sentenceText(k.root)).not.toBe(firstText);
    expect(k.root.querySelector('[data-testid=kiosk-invitation]')!.innerHTML).toBe(before);
  });
  it('the pairing notice borrows the middle and returns it to the sentence after 4.5 seconds', async () => {
    let now = NOW;
    const k = mount({ stored: STORED, now: () => now });
    await flush();
    const headMid = q(k.root, '[data-testid=kiosk-head-mid]')!;
    const sentence=q(headMid,'[data-testid=kiosk-sentence]')!;
    const probe=q(headMid,'.k-sentence-probe')!;
    expect(sentence.hidden).toBe(false);
    // A phone pairs: the notice speaks, and it speaks as a status region, so the ticker stands aside.
    k.handlers.onPaired!(NOW + 600_000);
    expect(text(q(headMid, '.k-pairing-notice'))).toBe('Pogled je otvoren na tvom uređaju.');
    expect(headMid.getAttribute('role')).toBe('status');
    k.tick(CODE_TICK_MS);
    expect(sentence.hidden).toBe(true);
    expect(q(headMid, '.k-sentence-probe')).toBe(probe);
    expect(probe.hidden).toBe(false);
    // Four and a half seconds later the notice is done -- and takes its role with it, or the middle reads as taken for the life of the screen.
    now += 5_000;
    k.tick(CODE_TICK_MS);
    expect(headMid.getAttribute('role')).toBeNull();
    expect(sentence.hidden).toBe(false);
    expect(sentenceText(k.root)).not.toBe('');
  });
  it('stores fresher screen metadata from the beacon beside the same secret and names the stop, nothing else', () => {
    const k = mount({ hash: '#BEACON01.tajna' });
    expect(JSON.parse(k.raw[BEACON_STORAGE_KEY]!)).toEqual({ beaconId: 'BEACON01', secret: 'tajna' });
    // Credentials that carry no screen yet name the city until the DO says which place (WP3).
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('Zagreb');
    // Without a stop the field is labelled by the lines title, never left nameless. The default Trg
    // is the list's place, not the map's: the field follows the whole-city map [O-52], [O-65].
    expect(q(k.root, '[data-testid=kiosk-live]')!.getAttribute('aria-label')).toBe('Linije s ovog stajališta');
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
    expect(q(k.root, '[data-testid=nearby]')).not.toBeNull();
    expect(q(k.root, '.k-map-legend')).toBeNull();
    expect(k.fetchSentences).not.toHaveBeenCalled();
    // Ten rows at most, then "još N" (R-V1, e2e/lagano.spec.ts): the board's cap is its own, not the composition's slot count.
    const eleven = MODULES.map((m) => (m.module === 'zet-rt' ? snap('zet-rt', Array.from({ length: 11 }, (_, i) => item('zet-rt', `vehicle:${i}`, 'vehicle', String(i + 1), { geo: { type: 'Point', coordinates: [15.977, 45.813] }, data: { routeId: String(i + 1), routeType: 0 } }))) : m));
    const many = mount({ hash: '#BEACON01.tajna', lightweight: true, fetchTeaser: async () => ({ modules: eleven }) });
    await flush();
    // No chosen place: the board is the whole-city map's lightweight twin, the lines in the box, not Trg's own lines.
    expect(many.root.querySelectorAll('[data-testid=kiosk-live] li.k-line')).toHaveLength(10);
    expect(text(q(many.root, '[data-testid=kiosk-live] .k-line-more'))).toBe('još 1 linija');
    expect(text(q(many.root, '[data-testid=nearby-head]'))).toContain('U blizini');
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
    expect(text(q(k.root, '[data-testid=kiosk-code]'))).toBe('ABCD·EFG0');
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
    expect(text(q(k.root, '[data-testid=kiosk-code]'))).toBe('ABCD·EFG0');
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
    expect(q(k.root, '[data-testid=kiosk-code]')).toBeNull();
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
    expect(text(q(k.root, '[data-testid=kiosk-code]'))).toBe('ABCD·EFG0');
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
  it('a cold screen immediately shows the solar fallback without inventing departures or waiting on AI', async () => {
    const k = mount({ stored: STORED, fetchTeaser: () => new Promise(() => {}) });
    await flush();
    // Nothing has answered: no exception is claimed, no range is invented, and no venue is listed.
    expect(departures(k.root)).toHaveLength(0);
    expect(k.root.querySelectorAll('.nearby-row[data-kind=solar]')).toHaveLength(1);
    expect(sentenceText(k.root)).toMatch(/^Sunce zalazi u \d\d:\d\d\.$/);
    expect(q(k.root, '[data-testid=kiosk-sentence]')!.hidden).toBe(false);
    expect(text(q(k.root, '[data-testid=nearby]'))).not.toMatch(/Učitavanje|Čekamo/);
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
    expect(q(k.root, '[data-testid=kiosk-alert]')!.hidden).toBe(true);
    expect(text(q(k.root, '[data-testid=strip-warning]'))).toBe('žuto upozorenje · Grmljavina · zastarjelo');
    // The panels are told, source by source: the last-good copies are stale (the lines panel says so in its credit), and the field is still one field with its map.
    expect(text(q(k.root, '.nearby-row[data-kind=closure]'))).toContain('Ilica');
    expect(text(q(k.root, '[data-testid=nearby]'))).not.toContain('zastarjelo');
    expect(q(k.root, '[data-testid=kiosk-live] [data-testid=kiosk-map]')).not.toBeNull();
    fail = false;
    k.poll();
    await flush();
    expect(calls.at(-1)).toBe('live');
    expect(text(q(k.root, '.nearby-row[data-kind=closure]'))).toContain('Ilica');
    expect(q(k.root, '[data-testid=kiosk-alert]')!.hidden).toBe(true);
  });
  it('a fetch that never succeeded reads as down once it fails: unknown, not loading and never clear', async () => {
    const k = mount({ stored: STORED, fetchTeaser: async () => { throw new Error('down'); } });
    await flush();
    expect(text(q(k.root, '[data-testid=strip-warning]'))).toBe('Upozorenja DHMZ-a: podaci trenutačno nedostupni');
    expect(q(k.root, '[data-testid=map-note]')!.hidden).toBe(false);
    expect(k.root.querySelectorAll('[data-testid=map-note]')).toHaveLength(1);
    expect(departures(k.root).some(row => row.dataset.live === '1')).toBe(false);
    expect(text(q(k.root, '[data-testid=kiosk-invitation]'))).not.toContain('Učitavanje');
    expect(q(k.root, '[data-testid=kiosk-alert]')!.hidden).toBe(true);
    expect(sentenceText(k.root)).not.toMatch(/nedostupn|Čekamo/);
    expect(sentenceText(k.root)).not.toBe('');
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
  it('forwards motion identity and generation through the kiosk factory on stale repaints', async () => {
    const motion = { path: '6_1', plan: [[0, 100], [60, 600]] as [number, number][], network: 'new-graph', generatedAt: NOW, builtAt: BUILT_AT };
    const modules = MODULES.map(m => m.module !== 'zet-rt' ? m : {
      ...m, fetchedAt: new Date(NOW).toISOString(),
      items: m.items.map(i => i.id === 'vehicle:1' ? { ...i, motion } : i),
    });
    const map = fakeMap();
    let fail = false;
    const k = mount({ stored: STORED, mapFactory: map.factory as never, fetchTeaser: async () => {
      if (fail) throw new Error('offline');
      return { modules };
    } });
    await flush();
    const check = () => {
      const points = map.handle.update.mock.calls.at(-1)![0] as { id: string; network?: string; generatedAt?: number; plan?: { knots: number[][] } }[];
      const p = points.find(p => p.id === 'vehicle:1')!;
      expect(p).toMatchObject({ network: 'new-graph', generatedAt: NOW });
      expect(p.plan?.knots[0][0]).toBe(NOW); // never overwritten by raw relative knots
    };
    check();
    fail = true;
    k.poll();
    await flush();
    check();
    k.handle.destroy();
  });

  it('reloads a stale kiosk bundle once before handing incompatible motion to the map', async () => {
    const reload = vi.spyOn(globalThis.location, 'reload').mockImplementation(() => {});
    const map = fakeMap();
    const modules = MODULES.map(m => m.module !== 'zet-rt' ? m : {
      ...m, items: m.items.map(i => i.id === 'vehicle:1' ? {
        ...i, motion: { path: '6_1', plan: [[0, 100]] as [number, number][], network: 'deployed-graph', generatedAt: NOW, builtAt: 'different-build' },
      } : i),
    });
    const k = mount({ stored: STORED, mapFactory: map.factory as never, modules });
    await flush();
    k.repaint();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(map.calls).toContain('pause');
    const points = map.handle.update.mock.calls.flatMap(call => call[0] as { id: string }[]);
    expect(points.some(p => p.id === 'vehicle:1')).toBe(false);
    expect(JSON.parse(k.raw[BEACON_STORAGE_KEY]).secret).toBe('tajna');
    k.handle.destroy();
    reload.mockRestore();
  });

  it('reloads an unresolved identity pair only once across three fresh mounts', async () => {
    const reload = vi.spyOn(globalThis.location, 'reload').mockImplementation(() => {});
    const raw: Record<string, string> = { [BEACON_STORAGE_KEY]: STORED };
    const storage = {
      getItem: (key: string) => raw[key] ?? null,
      setItem: (key: string, value: string) => { raw[key] = value; },
      removeItem: (key: string) => { delete raw[key]; },
    };
    const modules = MODULES.map(m => m.module !== 'zet-rt' ? m : {
      ...m, items: m.items.map(i => i.id === 'vehicle:1' ? {
        ...i, motion: { path: '6_1', plan: [[0, 100]] as [number, number][], network: 'deployed-graph', generatedAt: NOW, builtAt: 'different-build' },
      } : i),
    });
    try {
      for (let n = 0; n < 3; n++) {
        const map = fakeMap();
        const k = mount({ storage, modules, mapFactory: map.factory as never });
        await flush();
        k.repaint();
        try {
          expect(reload).toHaveBeenCalledTimes(1);
          expect(readStored()).toEqual(JSON.parse(STORED));
          if (n > 0) {
            expect(q(k.root, '[data-testid=kiosk-map-host]')?.dataset.networkStale).toBe('true');
            const points = map.handle.update.mock.calls.at(-1)![0];
            expect(points).toContainEqual(expect.objectContaining({ id: 'vehicle:1', network: 'deployed-graph', generatedAt: NOW }));
            expect(map.calls.at(-1)).toBe('feed:live');
          }
        } finally { k.handle.destroy(); }
      }
    } finally { reload.mockRestore(); }
    function readStored() { return JSON.parse(raw[BEACON_STORAGE_KEY]); }
  });

  it('keeps reconciling without pausing when the reload latch cannot persist', async () => {
    const reload = vi.spyOn(globalThis.location, 'reload').mockImplementation(() => {});
    const modules = MODULES.map(m => m.module !== 'zet-rt' ? m : {
      ...m, items: m.items.map(i => i.id === 'vehicle:1' ? {
        ...i, motion: { path: '6_1', plan: [[0, 100]] as [number, number][], network: 'deployed-graph', generatedAt: NOW, builtAt: 'different-build' },
      } : i),
    });
    const storage = {
      getItem: (key: string) => key === BEACON_STORAGE_KEY ? STORED : null,
      setItem: () => { throw new Error('storage full'); }, removeItem: () => {},
    };
    const map = fakeMap();
    const k = mount({ storage, modules, mapFactory: map.factory as never });
    await flush();
    try {
      k.repaint();
      expect(reload).not.toHaveBeenCalled();
      expect(map.calls).not.toContain('pause');
      expect(q(k.root, '[data-testid=kiosk-map-host]')?.dataset.networkStale).toBe('true');
      expect(map.handle.update.mock.calls.at(-1)![0]).toContainEqual(expect.objectContaining({ network: 'deployed-graph' }));
    } finally { k.handle.destroy(); reload.mockRestore(); }
  });

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
    expect(alert.hidden).toBe(true);
    k.handlers.onStatus('offline');
    expect(text(alert)).toBe('Bez veze sa zaslonom; kod se ne može izdati');
    k.handlers.onStatus('live');
    expect(alert.hidden).toBe(true);
    // The chain re-armed itself after the failed load, at the fallback delay.
    const poll = k.timers.slice(armedAtMount).filter((t) => t.ms === POLL_FALLBACK_MS && !t.cleared);
    expect(poll).toHaveLength(1);
    fail = false;
    poll[0]!.fn();
    await flush();
    expect(alert.hidden).toBe(true);
    expect(sentenceText(k.root)).not.toBe('');
    expect(q(k.root, '[data-testid=map-note]')!.hidden).toBe(true);
    // The one that fired cleared itself; exactly one fresh poll is armed (still the fallback: the fixture has no source timestamp).
    expect(k.timers.slice(armedAtMount).filter((t) => t.ms === POLL_FALLBACK_MS && !t.cleared)).toHaveLength(1);
  });
  it('a reconnect after a healthy stretch is said as such, then cleared', () => {
    const k = mount({ stored: STORED });
    k.handlers.onStatus('connecting');
    expect(q(k.root, '[data-testid=kiosk-alert]')!.hidden).toBe(true);
    k.handlers.onStatus('live');
    k.handlers.onStatus('connecting');
    expect(text(q(k.root, '[data-testid=kiosk-alert]'))).toBe('Ponovno povezivanje');
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
    expect(['Transit', 'Culture', 'Weather', 'Bikes', 'Tonight', 'Works']).toContain(text(q(k.root, '[data-testid=kiosk-sentence-kicker]')));
    expect(text(q(k.root, '[data-testid=nearby-head]'))).toMatch(/^Nearby · \d/);
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

// The invitation: map, nearby list, QR, header sentence and safety strip.
describe('the invitation composition: the timeline, sentence and strip', () => {
  it('orders the timeline above the QR card, whose only copy is the lead, code and typed address', async () => {
    const k = mount({ stored: STORED });
    await flush();
    const column = q(k.root, '[data-testid=kiosk-invitation] .k-overview')!;
    expect([...column.children].map(el => el.className)).toEqual(['k-nearby-host', 'k-panel--card']);
    expect(q(column, '[data-testid=nearby] > [data-testid=nearby-head]')).not.toBeNull();
    expect(q(column, '[data-testid=nearby] > ol[data-testid=nearby-rows]')).not.toBeNull();
    expect(q(column, '[data-testid=kiosk-panel-weather]')).toBeNull();
    expect(column.querySelectorAll('button, input, a:not([data-testid=pair-url])')).toHaveLength(0);
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
    expect([...q(card, '.k-invite-side')!.children].map((el) => el.className)).toEqual(['k-lead', 'k-invite-code', 'k-hint']);
    expect(q(card, '.k-invite-side .k-invite-code [data-testid=kiosk-code]')).not.toBeNull();
    expect(q(card, '.k-invite-code [data-testid=code-progress] .k-progress-bar')).not.toBeNull();
    // One h1 on the screen (the card's lead); each of the three cards is headed by its kicker as an h2, the field is a labelled section.
    expect(k.root.querySelectorAll('h1')).toHaveLength(1);
    expect(k.root.querySelectorAll('[data-testid=kiosk-invitation] h2')).toHaveLength(1);
  });
  it('DHMZ down: the sentence uses another supported fact and the timeline keeps closures', async () => {
    const down = MODULES.map((m) => (m.module === 'dhmz-now' ? snap('dhmz-now', [], 'down') : m));
    const k = mount({ stored: STORED, fetchTeaser: async () => ({ modules: down }) });
    await flush();
    expect(q(k.root, '[data-testid=kiosk-panel-weather]')).toBeNull();
    expect(text(q(k.root, '[data-testid=kiosk-clock]'))).toBe('14:32');
    const head = text(q(k.root, '.k-head'));
    expect(head).not.toMatch(/[\u2013\u2014]|(^|\s)-(\s|$)/);
    expect(head).not.toContain('°C');
    expect(head).not.toContain('DHMZ');
    expect(q(k.root, '[data-testid=kiosk-temp]')).toBeNull();
    // The rest of the screen is unaffected: the strip still speaks and the promet card still names its exception.
    expect(text(q(k.root, '[data-testid=safety-strip]'))).toContain('Grmljavina');
    expect(text(q(k.root, '.nearby-row[data-kind=closure]'))).toContain('Ilica');
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
    expect(text(q(k.root, '[data-testid=session-label]'))).toBe('Otključano do 14:42 · Karta');
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
    const code = q(k.root, '[data-testid=kiosk-code]')!;
    expect(code.dataset.swap).toBeUndefined();
    expect(q(k.root, '.k-code-ghost')).toBeNull();
    now = NOW + 30_000;
    k.tick(250); // the code rotation's own tick
    expect(text(code)).toBe('ABCD·EFG1');
    expect(code.dataset.swap).toBe('1');
    const ghost = q(k.root, '.k-code-ghost')!;
    expect(text(ghost)).toBe('ABCD·EFG0');
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    // The ghost repeats the live code's three spans (digits, the dimmed dash with its margins, digits), so the crossfade never reads as the second half sliding sideways; it borrows no testid, so kiosk-code stays one element mid-swap.
    expect([...ghost.children].map((child) => child.textContent)).toEqual(['ABCD', '·', 'EFG0']);
    expect([...ghost.children].map((child) => child.className)).toEqual([...code.children].map((child) => child.className));
    expect(ghost.children[1]!.classList.contains('k-code-dash')).toBe(true);
    expect(ghost.querySelectorAll('[data-testid]')).toHaveLength(0);
    expect(k.root.querySelectorAll('[data-testid=kiosk-code]')).toHaveLength(1);
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
  function spyMap<E extends object = Record<never, never>>(extra: E = {} as E) {
    const calls: string[] = [];
    const handle = { update: vi.fn(), pause: () => { calls.push('pause'); }, resume: () => { calls.push('resume'); }, destroy: vi.fn(), resize: () => { calls.push('resize'); }, setFeedState: (s: string) => { calls.push(`feed:${s}`); }, setView: vi.fn(), ...extra };
    return { factory: vi.fn((_options: unknown) => handle), handle, calls };
  }
  /** happy-dom lays nothing out: a host width is stubbed so the camera can be seen to follow it. */
  const layOut = (host: HTMLElement, width: number) => Object.defineProperty(host, 'clientWidth', { value: width, configurable: true });

  it.each(['map', 'schema'] as const)('one %s renderer for the screen\u2019s life: created once, following resize, parked and returned through a session', async (mapMode) => {
    const map = spyMap();
    const k = mount({ stored: STORED, mapMode, mapFactory: map.factory as never });
    await flush();
    expect(map.factory).toHaveBeenCalledTimes(1);
    const options = map.factory.mock.calls[0]![0] as Record<string, unknown>;
    // Before layout the wide drawing's design box stands, framed on the screen's stop at Kadar 6 (WP2: the fallback
    // 2 km until the stop table and the network's line order are in); the field carries the kiosk emphasis and no selection (R-KP11).
    expect(options.zoom).toBe(frameView(STOP, FRAME_RADIUS_M[6], FIELD_DESIGN_WIDTH.wide, FIELD_DESIGN_HEIGHT.wide).zoom);
    expect(options.selectedStop).toBeUndefined();
    expect(options.padding).toBeUndefined();
    expect(options.emphasis).toEqual(KIOSK_EMPHASIS);
    // The invitation is the transit picture on either renderer now: the gate that emptied the
    // geographic map whenever the default 'living' group was active is gone.
    // The frame draws every stop in it and both networks.
    expect((options.prozor as { stopRoutes: string[] | null }).stopRoutes).toBeNull();
    expect((options.prozor as { networkKinds: string[] }).networkKinds).toEqual(['tram', 'bus']);
    // ?prikaz=shema on the wall is the whole network without zoom [O-72]: the diagram is handed no stop to crop round.
    expect(map.factory.mock.calls[0]?.[0]).toMatchObject({ renderer: mapMode, interactive: false, stop: mapMode === 'schema' ? null : STOP });
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
    expect(map.handle.setView).toHaveBeenLastCalledWith({ zoom: frameView(STOP, FRAME_RADIUS_M[6], 700, FIELD_DESIGN_HEIGHT.wide).zoom, emphasis: KIOSK_EMPHASIS, center: [STOP.lon, STOP.lat] });
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

  it('reconciles a changed closure in place and adds a new row without rebuilding the timeline', async () => {
    let modules = MODULES;
    const k = mount({ stored: STORED, fetchTeaser: async () => ({ modules }) });
    await flush();
    const timeline = q(k.root, '[data-testid=nearby]')!;
    const row = q(timeline, '.nearby-row[data-kind=closure]')!;
    const title = q(row, '.nearby-title')!;
    expect(text(title)).toBe('Ilica');
    // The same answer on the next poll: the same nodes stand (a reader mid-glance is never interrupted).
    k.poll();
    await flush();
    expect(q(k.root, '[data-testid=nearby]')).toBe(timeline);
    expect(q(timeline, '.nearby-row[data-kind=closure]')).toBe(row);
    // Line 6 recovers and a second vehicle arrives: the row's context changes in place, the panel and the row are the same nodes.
    modules = MODULES.map(m=>m.module==='prometnice'?{...m,items:m.items.map(item=>({...item,title:'Ilica i Frankopanska'}))}:m);
    k.poll();
    await flush();
    // Line 6 comes back inside the on-time band: it is no exception any more, so the card says the network runs to plan.
    expect(q(k.root,'[data-testid=nearby]')).toBe(timeline);
    expect(q(row,'.nearby-title')).toBe(title);
    expect(text(title)).toBe('Ilica i Frankopanska');
    // A ZET notice arrives: the card counts it rather than printing it; the header's line carries its words.
    modules = modules.map(m => m.module === 'prometnice' ? { ...m, items: [...m.items, { ...m.items[0]!, id: 'c2', title: 'Savska', until: '2026-09-11T19:00:00Z' }] } : m);
    k.poll();
    await flush();
    expect(q(k.root,'[data-testid=nearby]')).toBe(timeline);
    expect(q(row,'.nearby-title')).toBe(title);
    expect(timeline.querySelectorAll('.nearby-row[data-kind=closure]')).toHaveLength(2);
  });

  it('refits whole rows on resize and keeps the reserved timeless row without hidden remnants', async () => {
    const cityStore = fakeCityStore({ ...emptyCity(), places: [
      { id: 'heritage-a', name: 'Palača', category: 'heritage', sourceId: 'heritage', sourceRecord: 'a', lon: STOP.lon, lat: STOP.lat, address: 'Ilica 1' },
    ] });
    const b = fakeBoards(JELACIC_BOARDS);
    const k = mount({ stored: STORED, cityStore, createBoards: b.create });
    await flush();
    const list = q(k.root, '[data-testid=nearby-rows]')!;
    const always = q(list, '[data-always="1"]')!;
    let height = 192;
    Object.defineProperty(list, 'clientHeight', { get: () => height, configurable: true });
    Object.defineProperty(list, 'scrollHeight', { get: () => list.children.length * 64, configurable: true });
    k.repaint();
    expect(list.children).toHaveLength(3);
    expect(q(list, '[data-always="1"]')).toBe(always);
    expect(list.querySelector('[hidden]')).toBeNull();
    height = 128;
    k.repaint();
    expect(list.children).toHaveLength(2);
    expect(departures(k.root)).toHaveLength(1);
    expect(q(list, '[data-always="1"]')).toBe(always);
    // The box grows (a resize): every row comes back.
    height = 600;
    k.repaint();
    expect(list.children.length).toBeGreaterThan(2);
    expect(list.querySelector('[hidden]')).toBeNull();
    k.handle.destroy();
  });

  it('a handheld frames 1400 m across its band and a totem frames Kadar 6 on its map panel, each at its design box before layout; the names’ padding follows the ground the panel shows and the measured box on a repaint (R-KP17, contract 3)', async () => {
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
    // The totem is a wall: the frame's 2R (Kadar 6's fallback 2 km) on its panel, the names padded for the frame's 4 km of ground.
    expect((totem.factory.mock.calls[0]![0] as { zoom: number }).zoom).toBe(frameView(STOP, FRAME_RADIUS_M[6], FIELD_DESIGN_WIDTH.portrait, FIELD_DESIGN_HEIGHT.portrait).zoom);
    expect((totem.factory.mock.calls[0]![0] as Prozor).prozor.labelPadding).toBe(labelPadding(FIELD_DESIGN_WIDTH.portrait, FIELD_DESIGN_HEIGHT.portrait, frameSpanM(FRAME_RADIUS_M[6])));
    // The wall's own panel is the ruling's 24; the totem's taller panel shows more ground north to south and pads its names more.
    expect(labelPadding(FIELD_DESIGN_WIDTH.wide, FIELD_DESIGN_HEIGHT.wide, FIELD_SPAN_M)).toBe(24);
    expect(labelPadding(FIELD_DESIGN_WIDTH.portrait, FIELD_DESIGN_HEIGHT.portrait, FIELD_SPAN_M)).toBeGreaterThan(24);
    // Laid out taller than the design table says, the measured box wins and the live map hears the new padding.
    const host = q(k.root, '[data-testid=kiosk-map-host]')!;
    Object.defineProperty(host, 'clientWidth', { value: 1080, configurable: true });
    Object.defineProperty(host, 'clientHeight', { value: 1500, configurable: true });
    k.repaint();
    await flush();
    expect(totem.handle.setProzor).toHaveBeenLastCalledWith(expect.objectContaining({ labelPadding: labelPadding(1080, 1500, frameSpanM(FRAME_RADIUS_M[6])) }));
    expect(labelPadding(1080, 1500, frameSpanM(FRAME_RADIUS_M[6]))).toBeGreaterThan(labelPadding(FIELD_DESIGN_WIDTH.portrait, FIELD_DESIGN_HEIGHT.portrait, frameSpanM(FRAME_RADIUS_M[6])));
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
    const loadLastRun = vi.fn(async (): Promise<LastRunSnapshot> => down);
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
    expect(q(k.root, '[data-testid=nearby]')).not.toBeNull();
    expect(q(k.root, '.k-map-legend')).toBeNull();
    expect(sentenceText(k.root)).not.toBe('');
  });

  // The place the operator chose frames the invitation at its Kadar, measured
  // around the place (shared/city/frame.ts; the table's radius until the stop
  // list has loaded). The header chip and the camera read the one answer
  // (kiosk/settings.ts wallPlaceOf), so a screen cannot name one place in
  // words and show another in the picture.
  it('frames the invitation on the screen’s place at its frame', async () => {
    const map = spyMap();
    const zaprude = { kind: 'tram' as const, name: 'Zapruđe', lon: 15.99, lat: 45.77, stopId: '200_1' };
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna', screen: { ...CITY_SCREEN, stop: STOPS[2], place: zaprude, placeSet: true, frame: 8 } }), mapFactory: map.factory as never });
    await flush();
    const options = map.factory.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.center).toEqual([15.99, 45.77]);
    // WP2: the square of side 2R on the field's shorter side (map/frame.ts frameView), Kadar 8's fallback until the stop table is in.
    expect(options.zoom).toBe(frameView({ lon: 15.99, lat: 45.77 }, FRAME_RADIUS_M[8], FIELD_DESIGN_WIDTH.wide, FIELD_DESIGN_HEIGHT.wide).zoom);
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('Zapruđe');
    expect(q(k.root, '[data-testid=kiosk]')!.dataset.frame).toBe('8');
  });

  it('opens on the whole city for a screen set up with an empty field, and for one that names no place at all', async () => {
    const window = cityWindowView(FIELD_DESIGN_WIDTH.wide, FIELD_DESIGN_HEIGHT.wide);
    const trg = { kind: 'tram' as const, name: STOP.name, lon: STOP.lon, lat: STOP.lat, stopId: STOP.id };
    // An empty field is Trg bana J. Jelačića for the header, the list and the departures, and the whole city on the map [O-65].
    const empty = spyMap();
    const e = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna', screen: { ...CITY_SCREEN, place: trg, placeSet: false, frame: 6 } }), mapFactory: empty.factory as never });
    await flush();
    expect(empty.factory.mock.calls[0]![0]).toMatchObject({ center: window.center, zoom: window.zoom, outline: null });
    expect(text(q(e.root, '[data-testid=kiosk-context]'))).toBe('Trg bana J. Jelačića');
    expect(q(e.root, '[data-testid=kiosk]')!.dataset.placeKind).toBe('city');
    e.handle.destroy();
    // 'zagreb' is the whole city, not a quarter; and a record from before place-v2 with no stop names the city until the DO answers.
    const city = spyMap();
    const k = mount({ stored: STORED_CITY, mapFactory: city.factory as never });
    await flush();
    expect(city.factory.mock.calls[0]![0]).toMatchObject({ center: window.center, zoom: window.zoom, outline: null });
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('Zagreb');
    k.handle.destroy();
    const none = spyMap();
    const n = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna', screen: { kind: 'temporary', expiresAt: NOW + 20 * 3_600_000, stop: null, area: 'trnje' } }), mapFactory: none.factory as never });
    await flush();
    expect(none.factory.mock.calls[0]![0]).toMatchObject({ center: window.center, zoom: window.zoom, outline: null });
    expect(text(q(n.root, '[data-testid=kiosk-context]'))).toBe('Zagreb');
  });

  it('re-frames the one live map when the DO answers with a place the operator chose', async () => {
    const map = spyMap();
    const k = mount({ stored: STORED_CITY, mapFactory: map.factory as never });
    await flush();
    expect(map.factory).toHaveBeenCalledTimes(1);
    k.handlers.onContext?.({ kind: 'temporary', expiresAt: NOW + 20 * 3_600_000, stop: STOPS[2]!, area: 'novi-zagreb-istok', place: { kind: 'tram', name: 'Zapruđe', lon: 15.99, lat: 45.77, stopId: '200_1' }, placeSet: true, frame: 6 });
    await flush();
    // The same map, moved -- never a second one built for the new frame.
    expect(map.factory).toHaveBeenCalledTimes(1);
    expect(map.handle.setView).toHaveBeenLastCalledWith(expect.objectContaining({ center: [15.99, 45.77], zoom: frameView({ lon: 15.99, lat: 45.77 }, FRAME_RADIUS_M[6], FIELD_DESIGN_WIDTH.wide, FIELD_DESIGN_HEIGHT.wide).zoom }));
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('Zapruđe');
  });
  // While Postavke is open the stage -- and with it the map's box -- is
  // hidden, and the toggles keep the panel open when the DO answers. A
  // MapLibre transform measured behind the panel is 0 x 0, and a move against
  // it lands the subject about a third of the field off centre (seen on the
  // real map: correct after a reload, wrong after a save). So the camera
  // waits: nothing moves while the panel is open, and the close re-measures
  // before it moves. The order is the whole fix, so the order is what this
  // case holds.
  it('re-measures the map before it moves it when Postavke closes: a box behind the panel is no box at all', async () => {
    const order: string[] = [];
    const handle = {
      update: vi.fn(), destroy: vi.fn(), setFeedState: vi.fn(),
      pause: () => { order.push('pause'); },
      resume: () => { order.push('resume'); },
      resize: () => { order.push('resize'); },
      setView: vi.fn(() => { order.push('setView'); }),
    };
    const k = mount({ stored: STORED, mapFactory: vi.fn(() => handle) as never });
    await flush();
    q(k.root, '[data-testid=kiosk-brand]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    k.tick(LONG_PRESS_MS);
    await flush();
    // The panel is over the stage and the map is held.
    expect(order).toContain('pause');
    expect(q(k.root, '.k-stage')!.hidden).toBe(true);
    const box = q(k.root, '[data-testid=kiosk-settings-panel]')!;
    q(box, '[data-testid=toggle-frame]')!.click();
    k.tick(SETTINGS_SEND_DELAY_MS);
    expect(k.beacon.setScreen).toHaveBeenCalledWith({ place: { kind: 'stop', stopId: '106_1' }, frame: 8 });
    order.length = 0;
    k.handlers.onContext?.({ ...SCREEN, place: { kind: 'tram', name: STOP.name, lon: STOP.lon, lat: STOP.lat, stopId: STOP.id }, placeSet: true, frame: 8 });
    await flush();
    // The answer lands with the panel still open: the camera waits for the box.
    expect(box.hidden).toBe(false);
    expect(handle.setView).not.toHaveBeenCalled();
    q(box, '[data-testid=kiosk-settings-close]')!.click();
    expect(handle.setView).toHaveBeenCalledTimes(1);
    expect(order.indexOf('resize')).toBeGreaterThanOrEqual(0);
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
    for (const present of ['kiosk-invitation', 'kiosk-live', 'kiosk-map-host', 'nearby', 'kiosk-sentence', 'kiosk-invite']) {
      expect(q(k.root, `[data-testid=${present}]`), present).not.toBeNull();
    }
    // Setup is one button now: no address to type on the wall, so no footnote and no second heading.
    expect(q(k.root, '[data-testid=handheld-link-block]')).toBeNull();
    expect(q(k.root, '[data-testid=handheld-link]')).toBeNull();
    expect(k.root.querySelectorAll('h1')).toHaveLength(1);
    expect(text(q(k.root, 'h1.k-lead'))).toBe('Skeniraj za 10 minuta grada.');
    // The code card is the same one the rotation paints on a wall.
    k.handlers.onCodes(batch(NOW), NOW);
    expect(text(q(k.root, '[data-testid=kiosk-code]'))).toBe('ABCD·EFG0');
    expect(k.root.querySelector('[data-testid=kiosk-qr] svg')).not.toBeNull();
    expect((q(k.root, '[data-testid=pair-url]') as HTMLAnchorElement).getAttribute('href')).toBe('https://zagreb.aningfilm.hr/s/#ABCD-EFG0');
    expect(q(k.root, '[data-testid=code-progress]')!.dataset.pct).toBe('1.00');
    // The weather is the card's on a phone as on a wall, and the header's line still says the city.
    expect(k.root.querySelectorAll('[data-testid=kiosk-weather]')).toHaveLength(0);
    expect(sentenceText(k.root)).not.toBe('');
    expect(text(q(k.root, '.k-handheld-info'))).toContain('odaberi Pokreni.');
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

// T5.3, moved by WP3: the theme toggle lives in Postavke (the header carries
// no glyph, principle 8), labelled "Tema: <word>" from the theme controller's
// own preference with its glyph beside the words, cycling auto -> light ->
// dark -> solar through setPreference (which persists vidikovac-theme itself
// -- ui/theme.ts is untouched and does the writing). The controller is always
// supplied: entries/kiosk.ts hands mountKiosk the same instance bootPage()
// created and resolved (default solar, or ?tema=) before this component ever
// sees it, so the label is correct on the very first paint.
describe('T5.3: the theme toggle', () => {
  async function openPanel(k: ReturnType<typeof mount>): Promise<HTMLButtonElement> {
    await flush();
    q(k.root, '[data-testid=kiosk-brand]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    k.tick(LONG_PRESS_MS);
    return q(k.root, '[data-testid=toggle-theme]') as HTMLButtonElement;
  }
  it('names the current preference beside its glyph, and four clicks cycle auto -> light -> dark -> solar in order', async () => {
    const k = mount({ stored: STORED }); // themeInitial defaults to 'solar', the kiosk's own default
    expect(q(k.root, '[data-testid=kiosk-theme]')).toBeNull();
    const btn = await openPanel(k);
    expect(btn.type).toBe('button');
    const seen = (): [string, string | null | undefined, string | undefined] => [text(btn), q(btn, 'use')?.getAttribute('href'), btn.dataset.value];
    expect(seen()).toEqual(['Tema: po suncu', '#icon-sunset', 'solar']);
    btn.click();
    expect(seen()).toEqual(['Tema: automatski', '#icon-sun-moon', 'auto']);
    btn.click();
    expect(seen()).toEqual(['Tema: svijetla', '#icon-sun', 'light']);
    btn.click();
    expect(seen()).toEqual(['Tema: tamna', '#icon-moon', 'dark']);
    btn.click();
    expect(seen()).toEqual(['Tema: po suncu', '#icon-sunset', 'solar']);
    expect(k.themeCalls).toEqual(['auto', 'light', 'dark', 'solar']);
  });
  it('reads every word straight from the theme controller, never the locale it started in, and follows a change made elsewhere', async () => {
    const k = mount({ stored: STORED, locale: 'en', themeInitial: 'light' });
    const btn = await openPanel(k);
    expect(text(btn)).toBe('Theme: light');
    btn.click();
    expect(text(btn)).toBe('Theme: dark');
    // ?tema= landing after the mount, another tab, the OS answer for auto: the open toggle repaints.
    k.theme.setPreference('auto');
    expect(text(btn)).toBe('Theme: automatic');
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
    // region added shuffles the page. The header and strip rows are at least
    // their drawn heights and grow with a wrapped place or trail.
    expect(css).toContain('grid-template-rows: minmax(var(--k-head-h), auto) auto minmax(0, 1fr) minmax(var(--k-strip-h), auto);');
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
    return { factory: vi.fn((_options: unknown) => handle), handle };
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
    // second line saying "vozni red", which doubled the height of every untracked row.
    expect(rows.map((row) => text(row))).toEqual(['za 3 minuživo6 Črnomerec', '14:38vozni red11 Velika Gorica', '14:45vozni red13 Žitnjak']);
    // The tracked row, and only it, carries the live dot and is marked live;
    // the note under the list says what the unmarked times are.
    expect(rows.map((row) => row.querySelector('.k-live') !== null)).toEqual([true, false, false]);
    expect(rows[0]!.querySelector('[data-live=true]')).not.toBeNull();
    expect(text(card)).toContain('vozni red');
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

  it('a configured stop supplies at most three blue or grey timeline departures from the shared cache', async () => {
    const b = fakeBoards(JELACIC_BOARDS);
    const k = mount({ stored: STORED, modules: ARRIVAL_MODULES.filter(m=>m.module!=='prometnice'), createBoards: b.create });
    await flush();
    const rows = departures(k.root);
    expect(b.asked).toEqual(['106_1', '106_2']);
    expect(rows).toHaveLength(3);
    expect(rows.map(row => text(q(row, '.nearby-title')))).toEqual(['6 Črnomerec', '11 Velika Gorica', '13 Žitnjak']);
    expect(rows.map(row => text(q(row, '.nearby-when')))).toEqual(['za 3 min', '14:38', '14:45']);
    expect(rows.map(row => row.dataset.live)).toEqual(['1', undefined, undefined]);
    expect(text(q(k.root, '[data-testid=nearby]'))).not.toMatch(/Procjena|vozni red|ZET|Dohvaćeno/);
    // Ten seconds later the poll comes round again; the minute's memo answers it.
    k.poll();
    await flush();
    expect(b.asked).toEqual(['106_1', '106_2']);
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

  it('caps departures at three on both landscape compositions without an overflow count', async () => {
    const b = fakeBoards({
      '106_1': board('106_1', [
        dep(TRIP_LIVE, '6', 'Črnomerec', '2026-09-11T12:33:00Z'), dep('trip-11', '11', 'Velika Gorica', '2026-09-11T12:38:00Z'),
        dep('trip-12', '12', 'Ljubljanica', '2026-09-11T12:40:00Z'), dep('trip-14', '14', 'Mihaljevac', '2026-09-11T12:42:00Z'),
      ]),
    });
    const wide = mount({ stored: STORED, modules: ARRIVAL_MODULES, createBoards: b.create });
    await flush();
    expect(departures(wide.root)).toHaveLength(3);
    wide.handle.destroy();
    const compact = mount({ stored: STORED, modules: ARRIVAL_MODULES, createBoards: b.create, viewport: { width: 1366, height: 768 } });
    await flush();
    expect(q(compact.root, '.kiosk')!.dataset.size).toBe('compact');
    const narrow = q(compact.root, '[data-testid=nearby]')!;
    expect(departures(compact.root)).toHaveLength(3);
    // And the fourth is not dropped in silence: the card counts it in the row
    // fitter's own words, so the stop does not read as having nothing else.
    expect(narrow.querySelector('.k-row-more')).toBeNull();
    expect(q(compact.root,'[data-testid=kiosk-invite]')).not.toBeNull();
    compact.handle.destroy();
  });

  it('names the place in the header and shares both platform boards with a presented stop', async () => {
    const map = tappableMap();
    const b = fakeBoards(JELACIC_BOARDS);
    const k = mount({ stored: STORED, modules: ARRIVAL_MODULES.filter(m=>m.module!=='prometnice'), mapFactory: map.factory as never, createBoards: b.create });
    await flush();
    const nearby = q(k.root, '[data-testid=nearby]')!;
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('Trg bana J. Jelačića');
    // The city's own counts belong to the card that is showing the city.
    expect(text(nearby)).not.toContain('zatvaranja');
    expect(b.asked).toEqual(['106_1', '106_2']);
    // A tap loads the stop list; the board is then of both platforms.
    k.handlers.onPresentation?.({version:1,revision:1,target:{layer:'u-pokretu',selection:{kind:'stop',id:'106_1'}},expiresAt:NOW+600_000,dataToken:'dt'});
    await flush();
    expect(b.asked).toContain('106_2');
    // Three departures, three rows on a wide screen: nothing counted away.
    expect(q(k.root, '[data-testid=k-arrivals]')!.querySelectorAll('.k-row')).toHaveLength(3);
    k.handle.destroy();
  });

  it('keeps the local closure and solar rows when the stop board is down', async () => {
    const b = fakeBoards({});
    const k = mount({ stored: STORED, modules: ARRIVAL_MODULES, createBoards: b.create });
    await flush();
    const nearby = q(k.root, '[data-testid=nearby]')!;
    expect(b.asked).toEqual(['106_1', '106_2']);
    expect(departures(k.root)).toHaveLength(0);
    expect(text(nearby)).not.toContain('za 3 min');
    expect(text(nearby)).toContain('Ilica');
    expect(nearby.querySelectorAll('[data-kind=solar]')).toHaveLength(1);
    k.handle.destroy();
  });

  it('makes one cache and loads default Trg departures even when the whole-city screen has no explicit stop', async () => {
    const b = fakeBoards(JELACIC_BOARDS);
    const k = mount({ stored: STORED_CITY, modules: ARRIVAL_MODULES, createBoards: b.create });
    await flush();
    k.poll();
    await flush();
    expect(b.create).toHaveBeenCalledTimes(1);
    expect(b.asked).toEqual(['106_1', '106_2']);
    expect(departures(k.root)).toHaveLength(3);
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
      .toEqual(['za 3 minuživo6 Črnomerec', '14:38vozni red11 Velika Gorica', '14:45vozni red13 Žitnjak']);
    // A presented route is not a stop: the screen keeps quiet behind it, and
    // the screen's own stop is not polled behind the phone's subject either.
    const other = fakeBoards(JELACIC_BOARDS);
    const o = mount({ stored: STORED, modules: ARRIVAL_MODULES, createBoards: other.create });
    const askedBeforePresentation = [...other.asked];
    o.handlers.onPresentation?.({ version: 1, revision: 2, target: { layer: 'u-pokretu', selection: { kind: 'route', id: '6' } }, expiresAt: NOW + 600_000, dataToken: 'dt' });
    await flush();
    o.poll();
    await flush();
    expect(other.asked).toEqual(askedBeforePresentation);
    k.handle.destroy();
    o.handle.destroy();
  });

  it('a dead vehicle feed leaves three grey timetable departures and one map note', async () => {
    const b = fakeBoards(JELACIC_BOARDS);
    // The realtime module is down; the schedule is not. This is the hour the
    // board matters most, and every row it shows is schedule-only.
    const down = MODULES.map((m) => (m.module === 'zet-rt' ? snap('zet-rt', [], 'down') : m));
    const k = mount({ stored: STORED, modules: down.filter(m=>m.module!=='prometnice'), createBoards: b.create });
    await flush();
    const rows = departures(k.root);
    expect(rows).toHaveLength(3);
    expect(rows.every(row => row.dataset.live === undefined)).toBe(true);
    expect(rows.map(row => text(q(row, '.nearby-when')))).toEqual(['14:33', '14:38', '14:45']);
    expect(text(q(k.root, '[data-testid=nearby]'))).not.toMatch(/ZET|Procjena|Po rasporedu/);
    expect(q(k.root, '[data-testid=map-note]')!.hidden).toBe(false);
    expect(k.root.querySelectorAll('[data-testid=map-note]')).toHaveLength(1);
    k.handle.destroy();
  });
});

describe('W-C4: third-party text on the wall is checked and counted (decision 18, revised)', () => {
  it('leaves a closure whose title asks something out of the list and counts it on the root as data-skipped-text', async () => {
    const clean = mount({ stored: STORED });
    await flush();
    expect(q(clean.root, '[data-testid=kiosk]')!.dataset.skippedText).toBe('count:0');
    expect(text(q(clean.root, '.nearby-row[data-kind=closure]'))).toContain('Ilica');
    clean.handle.destroy();
    const hostile = MODULES.map((m) => (m.module === 'prometnice' ? snap('prometnice', [
      item('prometnice', 'c1', 'closure', 'Ilica: pošaljite SMS na 0800', { until: '2026-09-11T18:00:00Z', geo: { type: 'LineString', coordinates: [[15.9705, 45.813], [15.972, 45.8131]] } }),
    ]) : m));
    const k = mount({ stored: STORED, modules: hostile });
    await flush();
    expect(q(k.root, '.nearby-row[data-kind=closure]')).toBeNull();
    expect(q(k.root, '[data-testid=kiosk]')!.dataset.skippedText).toBe('count:1;phone:1');
    expect(text(q(k.root, '[data-testid=kiosk-sentence-text]'))).not.toContain('SMS');
    k.handle.destroy();
  });
});
