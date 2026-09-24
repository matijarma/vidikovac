// @vitest-environment happy-dom
// The /d/ shell on the real core stores: navigation, session states, polling
// aligned to the feed, reconciliation that keeps focus and typed text, the
// session sheet, sharing, expiry and exports. Every browser global is injected.
import { NEARBY_HOLD_MS } from '../../app/src/city/feed';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import type { LayerId } from '../../worker/protocol';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import type { SessionClient, SessionSnapshot } from '../../app/src/session';
import { LAST_POLL_GUARD_MS, LAYER_STORAGE_KEY, mountDashboard, parseSessionHash, type DashboardDeps } from '../../app/src/dashboard';
import { POLL_FALLBACK_MS } from '../../app/src/motion/loop';
import { THEME_PREFERENCES } from '../../app/src/ui/theme';
import { SAVED_STORAGE_KEY } from '../../app/src/core/saved-store';
import { createCityMap, type CityMapOptions } from '../../app/src/map/city-map';
import type { LastRunSnapshot } from '../../app/src/core/lastrun';
import { loadSadaFeed } from '../../app/src/city/feed';
import { stubLocalStorage, stubSessionStorage } from './helpers';
import type { PresentationCommand, PresentationResult, PresentationState } from '../../worker/presentation';
import { fakeCityStore } from '../city/fake-store';
import { decodeNetwork } from '../../shared/motion/network';
import { toPlane } from '../../shared/motion/geo';
import graphBefore from '../fixtures/graph-migration/before.json';
import graphAfter from '../fixtures/graph-migration/after.json';

stubSessionStorage();
stubLocalStorage();
// The workspace's fallback catalogue is not an upstream call in a unit test.
vi.mock('../../app/src/core/screens', () => ({ loadStops: vi.fn(async () => []) }));
// The stop's last-departure file is a static fetch too; the resolver beside it stays real for the band's tiles.
vi.mock('../../app/src/core/lastrun', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../app/src/core/lastrun')>()), loadLastRun: vi.fn(async () => null) }));

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb
const EXPIRES = NOW + 10 * 60_000; // 14:42

function fakeSession(now: () => number = () => NOW) {
  const listeners = {
    joined: [] as ((s: SessionSnapshot) => void)[], expiring: [] as ((n: number) => void)[], expired: [] as (() => void)[],
    count: [] as ((n: number) => void)[], codes: [] as ((batch: unknown[], serverNow: number) => void)[],
    error: [] as ((code: string, reason?: 'revoked' | 'no-ticket') => void)[], close: [] as ((code: number) => void)[],
    presentation: [] as ((state: PresentationState) => void)[],
    result: [] as ((result: PresentationResult) => void)[],
  };
  let snapshot: SessionSnapshot = { phase: 'connecting', role: null, expiresAt: null, dataToken: null, participants: 0, secondsLeft: 0 };
  let runOut = false;
  const sent: { layer: LayerId; params?: Record<string, string> }[] = [];
  const events: { name: string; dim?: string }[] = [];
  const presentations: PresentationCommand[] = [];
  const client: SessionClient = {
    connect: vi.fn(), snapshot: () => snapshot, serverNow: () => now(),
    secondsLeft: () => (runOut ? 0 : Math.max(0, Math.floor(((snapshot.expiresAt ?? now()) - now()) / 1000))),
    onJoined: (l) => { listeners.joined.push(l); return () => {}; },
    onExpiring: (l) => { listeners.expiring.push(l); return () => {}; },
    onExpired: (l) => { listeners.expired.push(l); return () => {}; },
    onView: () => () => {},
    onPresentation: l => { listeners.presentation.push(l); return () => {}; },
    onPresentationResult: l => { listeners.result.push(l); return () => {}; },
    present: command => { presentations.push(command); },
    refreshPresentation: vi.fn(),
    onCodes: (l) => { listeners.codes.push(l as never); return () => {}; },
    onCount: (l) => { listeners.count.push(l); return () => {}; },
    onError: (l) => { listeners.error.push(l); return () => {}; },
    onClose: (l) => { listeners.close.push(l); return () => {}; },
    sendView: (layer, params) => { sent.push(params ? { layer, params } : { layer }); },
    share: vi.fn(), event: (name, dim) => { events.push({ name, dim }); }, close: vi.fn(),
  };
  return {
    client, sent, events, presentations,
    join(role: 'scanner' | 'phone' = 'scanner', screen?: SessionSnapshot['screen']) {
      snapshot = { phase: 'live', role, expiresAt: EXPIRES, dataToken: 'dt1', participants: 2, secondsLeft: 600, ...(screen ? { screen } : {}), ...(screen && role === 'scanner' ? { presentation: { version: 1 as const, revision: 0, target: null, owner: null, expiresAt: null, status: 'idle' as const, online: true, supported: true } } : {}) };
      listeners.joined.forEach((l) => l(snapshot));
    },
    presentation(state: PresentationState) { snapshot = { ...snapshot, presentation: state }; listeners.presentation.forEach(l => l(state)); },
    result(result: PresentationResult) { listeners.result.forEach(l => l(result)); },
    expiring: (n: number) => listeners.expiring.forEach((l) => l(n)),
    expire() { snapshot = { ...snapshot, phase: 'expired' }; listeners.expired.forEach((l) => l()); },
    drop() { snapshot = { ...snapshot, phase: 'connecting' }; listeners.close.forEach((l) => l(1006)); },
    runOut() { runOut = true; },
    codes: (batch: unknown[], serverNow: number) => listeners.codes.forEach((l) => l(batch, serverNow)),
    count(n: number) { snapshot = { ...snapshot, participants: n }; listeners.count.forEach((l) => l(n)); },
    error: (code: string, reason?: 'revoked' | 'no-ticket') => listeners.error.forEach((l) => l(code, reason)),
  };
}
const attr = (module: string) => ({ text: `Izvor: ${module}`, url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' });
const base = (module: ModuleId, items: ModuleSnapshot['items'] = []): ModuleSnapshot =>
  ({ module, tier: 'open', status: 'live', fetchedAt: new Date(NOW - 30_000).toISOString(), attribution: attr(module), items });
const FIXTURE: Partial<Record<ModuleId, ModuleSnapshot>> = {
  'dhmz-now': base('dhmz-now', [{ id: 'o1', module: 'dhmz-now', kind: 'observation', tier: 'open', title: 'Zagreb-Maksimir', at: '2026-09-11T12:00:00Z', data: { temp: 21, humidity: 54, windDir: 'NW', windSpeed: 2, weather: 'vedro' } }]),
  dogadanja: base('dogadanja', [
    { id: 'kp:1', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Koncert u parku', link: 'https://kulturpunkt.hr/1', at: '2026-09-12T18:00:00Z', dateBasis: 'event', data: { source: 'kulturpunkt', category: 'koncert', precision: 'time', venue: 'Park Ribnjak' } },
    { id: 'kp:2', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Radionica keramike', at: '2026-09-13T10:00:00Z', dateBasis: 'event', data: { source: 'kulturpunkt', category: 'radionica', precision: 'time' } },
  ]),
};
const snapshotOf = (module: ModuleId): ModuleSnapshot => FIXTURE[module] ?? base(module);

interface MountOptions {
  wide?: boolean;
  snapshot?: (module: ModuleId) => ModuleSnapshot;
  mapFactory?: unknown;
  lightweight?: boolean;
  loadNetwork?: () => Promise<null>;
  /** A movable clock shared by the dashboard and the fake session's remaining time. */
  now?: () => number;
  deps?: Partial<DashboardDeps>;
}

function mount(opts: MountOptions = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const now = opts.now ?? (() => NOW);
  const session = fakeSession(now);
  const ticks: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const fetchData = vi.fn(async (module: ModuleId, _token: string) => (opts.snapshot ?? snapshotOf)(module));
  const handle = mountDashboard(root, {
    cityStore:fakeCityStore(),
    createBoards:()=>({get:()=>undefined,ensure:vi.fn(),destroy:vi.fn()}),
    i18n: createDefaultI18n('hr'), session: session.client, now, fetchData: fetchData as never,
    label: 'Kavana Velebit', mapFactory: opts.mapFactory as never, lightweight: opts.lightweight ?? false,
    loadNetwork: opts.loadNetwork ?? (async () => null), matchMedia: () => ({ matches: Boolean(opts.wide) }),
    setInterval: (fn: () => void, ms: number) => { const t = { fn, ms, cleared: false }; ticks.push(t); return t; },
    clearInterval: (h: unknown) => { (h as { cleared: boolean }).cleared = true; },
    ...opts.deps,
  });
  const tick = (): void => { for (const t of [...ticks]) if (!t.cleared) t.fn(); };
  const armed = (): number[] => ticks.filter((t) => !t.cleared).map((t) => t.ms).sort((a, b) => a - b);
  return { root, session, handle, fetchData, ticks, tick, armed };
}
const flush = async (): Promise<void> => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
interface Root { querySelector<E extends Element = Element>(selectors: string): E | null }
function click(root: Root, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  expect(el, selector).not.toBeNull();
  el!.click();
  return el!;
}
/** Opens a domain the tab bar does not carry, the way a reader does: Još, then its directory row. */
function openViaMore(root: Root, layer: LayerId): void {
  const primary = root.querySelector<HTMLElement>(`.ki-tabs [data-layer="${layer}"]`);
  if (primary) { primary.click(); return; }
  click(root, '[data-testid=tab-more]');
  click(root, `[data-testid=dir-${layer}]`);
}

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
// Sada's list and sentence load as one chunk after the first paint (city/feed.ts); in hand before any mount,
// so every draw here is the finished one and no late repaint lands inside another test.
beforeAll(async () => { expect(await loadSadaFeed()).not.toBeNull(); });

it('reconciles an open phone Karta and refreshes the shared network loader after a graph change', async () => {
  const oldNet = decodeNetwork(graphBefore);
  const newNet = decodeNetwork(graphAfter);
  let deployed = false;
  const loadNetwork = vi.fn(async () => deployed ? newNet : oldNet);
  const factory = vi.fn((options: CityMapOptions) => createCityMap(options, {
    now: () => NOW, loadMaplibre: async () => { throw new Error('no WebGL'); },
  }));
  const d = mount({
    mapFactory: factory, deps: { loadNetwork },
    snapshot: module => module !== 'zet-rt' ? snapshotOf(module) : {
      ...base('zet-rt'), sourceUpdatedAt: new Date(NOW).toISOString(),
      items: [{
        id: 'vehicle:1', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6',
        at: new Date(NOW - 12_000).toISOString(),
        geo: { type: 'Point', coordinates: [15.978, 45.808] },
        data: { routeId: '6', routeType: 0, confidence: 0.9 },
        motion: {
          path: 'path:6:1:e641be7c', network: (deployed ? newNet : oldNet).graphHash,
          generatedAt: NOW + (deployed ? 1000 : 0),
          plan: [[0, deployed ? 8427.7 : 10924.2], [90, deployed ? 8427.7 : 10924.2]],
        },
      }],
    },
  });
  try {
    d.session.join();
    d.handle.selectLayer('u-pokretu');
    await flush();
    const index = factory.mock.calls.findIndex(([o]) => o.container.dataset.testid === 'map-canvas');
    expect(index).toBeGreaterThanOrEqual(0);
    const map = factory.mock.results[index].value;
    const options = factory.mock.calls[index][0];
    expect(map.network?.()).toBe(oldNet);
    deployed = true;
    d.tick();
    await flush();
    await flush();
    expect(map.network?.()).toBe(newNet);
    const vehicle = map.vehicles!()[0];
    const p = toPlane(vehicle.lon, vehicle.lat);
    const expected = newNet.toPathPoint(0, 8427.7);
    expect(Math.hypot(p.x - expected.x, p.y - expected.y)).toBeLessThan(1);
    expect(options.reloadNetwork).toBeTypeOf('function');
    expect(await options.loadNetwork!()).toBe(newNet);
    expect(loadNetwork).toHaveBeenCalledTimes(2);
  } finally { d.handle.destroy(); }
});

// After one deploy the map and the schematic host both ask the shared loader
// for the artefact past the cache; while one such request is pending the
// second joins it (review of lane/t-schema, finding 2).
it('coalesces concurrent forced network reloads into one request, and a later one asks again', async () => {
  const net = decodeNetwork(graphBefore);
  let finish!: (value: typeof net | null) => void;
  const loadNetwork = vi.fn(() => new Promise<typeof net | null>((resolve) => { finish = resolve; }));
  const factory = vi.fn((options: CityMapOptions) => createCityMap(options, {
    now: () => NOW, loadMaplibre: async () => { throw new Error('no WebGL'); },
  }));
  const d = mount({ mapFactory: factory, deps: { loadNetwork } });
  try {
    d.session.join();
    d.handle.selectLayer('u-pokretu');
    await flush();
    finish(net);
    await flush();
    const options = factory.mock.calls.find(([o]) => o.container.dataset.testid === 'map-canvas')![0];
    expect(loadNetwork).toHaveBeenCalledTimes(1);
    const first = options.reloadNetwork!();
    const second = options.reloadNetwork!();
    expect(loadNetwork).toHaveBeenCalledTimes(2);
    finish(net);
    expect(await first).toBe(net);
    expect(await second).toBe(net);
    // Settled: the next forced call is a new request, and the plain loader now answers with it.
    const third = options.reloadNetwork!();
    expect(loadNetwork).toHaveBeenCalledTimes(3);
    finish(net);
    expect(await third).toBe(net);
    expect(await options.loadNetwork!()).toBe(net);
    expect(loadNetwork).toHaveBeenCalledTimes(3);
  } finally { d.handle.destroy(); }
});

describe('parseSessionHash', () => {
  it('reads room, ticket and label from the fragment /s/ navigates to', () => {
    expect(parseSessionHash('#room=r1&ticket=t1&label=Kavana%20Velebit')).toEqual({ roomId: 'r1', ticket: 't1', label: 'Kavana Velebit' });
    expect(parseSessionHash('#room=r2&label=phone')).toEqual({ roomId: 'r2', ticket: null, label: 'phone' });
    expect(parseSessionHash('#nothing')).toBeNull();
  });
});
describe('the stop catalogue failing (WP4)', () => {
  const TRG = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '11'] };
  it('says once that the timetable is unavailable, in one row that is not busy, and asks again at most three times', async () => {
    const load = vi.mocked((await import('../../app/src/core/screens')).loadStops);
    load.mockClear();
    load.mockImplementation(async () => { throw new Error('stops-unavailable'); });
    try {
      const { root, session, tick } = mount();
      session.join('scanner', { kind: 'venue', expiresAt: null, stop: null });
      await flush();
      const list = root.querySelector('[data-testid=day-departures]')!;
      expect(list.hasAttribute('aria-busy')).toBe(false);
      expect(text(list)).toBe('Vozni red trenutačno nije dostupan.');
      for (let i = 0; i < 5; i += 1) { tick(); await flush(); }
      expect(load).toHaveBeenCalledTimes(3);
      expect(root.querySelector('[data-testid=day-departures]')?.hasAttribute('aria-busy')).toBe(false);
    } finally {
      load.mockImplementation(async () => []);
    }
  });
  it('a retry that answers boards Trg bana J. Jelačića again', async () => {
    const load = vi.mocked((await import('../../app/src/core/screens')).loadStops);
    load.mockClear();
    load.mockImplementationOnce(async () => { throw new Error('stops-unavailable'); }).mockImplementationOnce(async () => [TRG]);
    const { root, session, tick } = mount();
    session.join('scanner', { kind: 'venue', expiresAt: null, stop: null });
    // The draw after the failure asks again; the second answer lands.
    for (let i = 0; i < 3; i += 1) { tick(); await flush(); }
    expect(load).toHaveBeenCalledTimes(2);
    const section = root.querySelector('section.sada-departures')!;
    expect(section.getAttribute('aria-label')).toBe('Sljedeći polasci, Trg bana J. Jelačića');
    expect(text(section)).not.toContain('nije dostupan');
  });
});
describe('shell and navigation', () => {
  it('renders the wordmark, one session element, the safety shortcut and three phone tabs Sada · Karta · Još; no kvart select, no sidebar, no canvas', () => {
    const { root } = mount();
    expect(text(root.querySelector('.ki-wordmark'))).toBe('Kaj ima?');
    expect(root.querySelectorAll('[data-testid=session-label]')).toHaveLength(1);
    expect(root.querySelector('[data-testid=safety-shortcut]')?.getAttribute('data-layer')).toBe('sigurnost');
    expect([...root.querySelectorAll('.ki-tabs .ki-tab')].map((t) => text(t))).toEqual(['Sada', 'Karta', 'Još']);
    // Događanja is a Još row now [O-51], never a tab.
    expect(root.querySelector('.ki-tabs [data-layer=kultura]')).toBeNull();
    expect(root.querySelector('[data-testid=tab-more]')).not.toBeNull();
    expect(root.querySelectorAll('.ki-side-link')).toHaveLength(0);
    expect(root.querySelector('[data-testid=kvart-select]')).toBeNull();
    expect(root.querySelector('main#ki-main')).not.toBeNull();
    expect(root.querySelectorAll('canvas')).toHaveLength(0);
    expect(root.querySelector('#layer-grad-sada')).not.toBeNull();
  });
  it('names the app and the active domain in the one hidden h1 and the document title', () => {
    const { root } = mount();
    const title = root.querySelector<HTMLElement>('[data-testid=dash-title]')!;
    expect(title.tagName).toBe('H1');
    expect(title.classList.contains('visually-hidden')).toBe(true);
    expect(text(title)).toBe('Kaj ima? · Sada');
    openViaMore(root, 'kultura');
    expect(text(title)).toBe('Kaj ima? · Događanja');
    expect(document.title).toBe('Kaj ima? · Događanja');
    // One word for the map everywhere: the tab, the title and the kiosk pill say Karta (layers.u-pokretu).
    click(root, '.ki-tabs [data-action=nav][data-layer=u-pokretu]');
    expect(document.title).toBe('Kaj ima? · Karta');
  });
  it('opens a domain from the tab bar: the workspace swaps, the tab is current, and the room is told nothing (D5: casting is explicit)', () => {
    const { root, session } = mount();
    click(root, '.ki-tabs [data-action=nav][data-layer=u-pokretu]');
    expect(root.querySelector('#layer-u-pokretu')).not.toBeNull();
    expect(root.querySelector('#layer-grad-sada')).toBeNull();
    expect(session.sent).toEqual([]);
    expect(session.events.at(-1)).toEqual({ name: 'panel_open', dim: 'u-pokretu' });
    expect(root.querySelector('.ki-tabs [data-layer=u-pokretu]')?.getAttribute('aria-current')).toBe('page');
    expect(root.querySelector('.ki-tabs [data-layer=grad-sada]')?.getAttribute('aria-current')).toBe('false');
  });
  it('Još opens the labelled directory: Spremljeno, then the week’s agenda with its count line, Vrijeme, Grad and Sigurnost, then the settings; it names the open domain on its tab', async () => {
    const { root, session } = mount();
    session.join();
    click(root, '[data-testid=tab-more]');
    await flush();
    expect(root.querySelector('#layer-directory')).not.toBeNull();
    expect(text(root.querySelector('#layer-directory'))).not.toContain('Ostale domene');
    expect([...root.querySelectorAll('.dir-item[data-layer]')].map((a) => a.getAttribute('data-layer'))).toEqual(['kultura', 'zrak-i-nebo', 'uprava-i-pravo', 'sigurnost']);
    expect([...root.querySelectorAll('#layer-directory h3')].map((h) => text(h))).toEqual(['Spremljeno', 'Odredišta', 'Osobne postavke']);
    expect(text(root.querySelector('[data-testid=saved-section] .city-meta'))).toBe('Spremi liniju, stajalište ili mjesto na karti. Ovdje ih možeš ponovno otvoriti na ovom uređaju.');
    // The fixture's two dated events fall inside the page's seven-day window; nothing is running.
    expect(text(root.querySelector('[data-testid=dir-kultura] .row-title'))).toBe('Događanja ovaj tjedan');
    expect(text(root.querySelector('[data-testid=dir-kultura] .row-sub'))).toBe('2 događanja');
    expect(text(root.querySelector('[data-testid=dir-kultura] .row-sub'))).toMatch(/događanj/);
    expect(root.querySelector('[data-testid=tab-more]')?.getAttribute('aria-expanded')).toBe('true');
    expect(text(root.querySelector('[data-testid=dir-session] .row-title'))).toBe('Otključano do 14:42');
    click(root, '[data-testid=dir-session]');
    expect(document.querySelector('[data-testid=session-sheet]')).not.toBeNull();
    click(root, '[data-testid=dir-zrak-i-nebo]');
    expect(root.querySelector('#layer-zrak-i-nebo')).not.toBeNull();
    expect(text(root.querySelector('[data-testid=tab-more]'))).toBe('Vrijeme');
    expect(root.querySelector('[data-testid=tab-more]')?.getAttribute('aria-current')).toBe('page');
  });
  it('carries the notify row the Kvart panel used to be the only way to reach the bell through; its action opens the same sheet', () => {
    const { root } = mount();
    click(root, '[data-testid=tab-more]');
    expect(text(root.querySelector('[data-testid=dir-notify] .row-title'))).toBe('Isticanje u aplikaciji, isključene');
    expect(text(root.querySelector('[data-testid=dir-notify] .row-sub'))).toBe('Ništa se ne šalje: uključena obavijest samo ističe pločice u ovom pregledniku.');
    click(root, '[data-testid=dir-notify]');
    expect(document.querySelector('[data-testid=notify-sheet]')).not.toBeNull();
  });
  it('the safety shortcut opens Sigurnost in one tap and marks itself current', () => {
    const { root } = mount();
    click(root, '[data-testid=safety-shortcut]');
    expect(root.querySelector('#layer-sigurnost')).not.toBeNull();
    expect(root.querySelector('[data-testid=safety-shortcut]')?.getAttribute('aria-current')).toBe('page');
  });
  it('remembers the last layer for the next unlock and ignores an invalid stored value (R-60)', () => {
    const first = mount();
    click(first.root, '[data-action=nav][data-layer=sigurnost]');
    expect(sessionStorage.getItem(LAYER_STORAGE_KEY)).toBe('sigurnost');
    first.handle.destroy();
    const second = mount();
    expect(second.root.querySelector('#layer-sigurnost')).not.toBeNull();
    second.handle.destroy();
    sessionStorage.setItem(LAYER_STORAGE_KEY, 'not-a-real-layer');
    expect(mount().root.querySelector('#layer-grad-sada')).not.toBeNull();
  });
});
describe('session states', () => {
  it('keeps the safety shortcut usable after expiry without reopening session data', () => {
    const { root, session } = mount();
    session.join();
    session.expire();
    const link = root.querySelector<HTMLAnchorElement>('[data-testid=safety-shortcut]')!;
    expect(link.getAttribute('href')).toBe('/hitno');
    expect(link.hasAttribute('data-action')).toBe(false);
    expect(link.getAttribute('aria-disabled')).not.toBe('true');
  });
  it('announces the join politely, shows the remaining time and the shared expiry, and focuses the title once', () => {
    const { root, session } = mount();
    session.join();
    expect(text(root.querySelector('[data-testid=announce-polite]'))).toBe('Otključano do 14:42');
    const label = root.querySelector<HTMLElement>('[data-testid=session-label]')!;
    expect(label.dataset.expiresAt).toBe(String(EXPIRES));
    expect(text(label)).toContain('Otključano · Kavana Velebit · do 14:42');
    expect(text(root.querySelector('[data-testid=countdown]'))).toBe('10:00');
    expect(document.activeElement).toBe(root.querySelector('[data-testid=dash-title]'));
  });
  it('warns at 60 s politely and at 20 s assertively, once each, with the approved sentences', () => {
    const { root, session } = mount();
    session.join();
    session.expiring(60);
    expect(text(root.querySelector('[data-testid=announce-polite]'))).toBe('Još minuta.');
    session.expiring(20);
    const alert = root.querySelector('[data-testid=announce-assertive]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(text(alert)).toBe('Još dvadeset sekundi.');
  });
  it('the session sheet offers sharing to the scanner only, pauses refreshing, hides the countdown and switches the language live', async () => {
    const scanner = mount();
    scanner.session.join();
    click(scanner.root, '[data-testid=session-label]');
    const sheet = document.querySelector<HTMLElement>('[data-testid=session-sheet]')!;
    expect(sheet).not.toBeNull();
    expect(text(sheet.querySelector('[data-testid=sheet-time]'))).toBe('Preostalo 10:00');
    click(sheet, '[data-testid=share-city-sheet]');
    expect(scanner.session.client.share).toHaveBeenCalledTimes(1);
    click(scanner.root, '[data-testid=session-label]');
    click(sheet, '[data-testid=toggle-refresh]');
    expect(scanner.root.querySelector('[data-testid=paused-banner]')).not.toBeNull();
    scanner.fetchData.mockClear();
    scanner.tick();
    await flush();
    expect(scanner.fetchData).not.toHaveBeenCalled();
    click(scanner.root, '[data-testid=paused-banner] [data-action=resume]');
    expect(scanner.root.querySelector('[data-testid=paused-banner]')).toBeNull();
    click(sheet, '[data-testid=toggle-countdown]');
    expect(scanner.handle.element.dataset.countdown).toBe('hidden');
    expect(text(scanner.root.querySelector('[data-testid=countdown]'))).toBe('Sesija');
    click(sheet, '[data-sheet-action=lang][data-value=en]');
    expect(text(sheet.querySelector('.dialog-title'))).toBe('Unlocked until 14:42');
    expect(text(sheet.querySelector('[data-testid=toggle-countdown]'))).toBe('Show the countdown');
    expect(text(scanner.root.querySelector('[data-testid=dash-title]'))).toBe('Kaj ima? · Now');
    expect([...scanner.root.querySelectorAll('.ki-tabs .ki-tab')].map((t) => text(t))).toEqual(['Now', 'Map', 'More']);
    expect(text(scanner.root.querySelector('[data-testid=share-city]'))).toBe('Share the city');
    scanner.handle.destroy();

    const peer = mount();
    peer.session.join('phone');
    click(peer.root, '[data-testid=session-label]');
    expect(document.querySelector('[data-testid=session-sheet] [data-testid=share-city-sheet]')).toBeNull();
  });
  it('the header share button "Podijeli grad" stands beside the session pill for the scanner, labelled, and asks the room for the code in one tap [O-61]', () => {
    const { root, session } = mount();
    expect(root.querySelector('[data-testid=share-city]'), 'nothing to share before the join').toBeNull();
    session.join();
    const share = root.querySelector<HTMLButtonElement>('[data-testid=status-line] [data-testid=share-city]')!;
    expect(share).not.toBeNull();
    expect(share.tagName).toBe('BUTTON');
    expect(share.dataset.action).toBe('share-city');
    expect(share.dataset.key).toBe('share');
    expect(text(share)).toBe('Podijeli grad');
    expect(share.getAttribute('aria-label')).toBe('Podijeli grad');
    expect(share.getAttribute('aria-haspopup')).toBe('dialog');
    expect(share.querySelector('svg use')?.getAttribute('href')).toBe('#icon-share-2');
    // Beside the pill: the share button is the session element's previous sibling.
    expect(share.nextElementSibling?.getAttribute('data-testid')).toBe('session-label');
    share.click();
    expect(session.client.share).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid=session-sheet]'), 'the header button opens no sheet on the way').toBeNull();
    // The sheet's own row has its own probe, so one test id never names two controls.
    click(root, '[data-testid=session-label]');
    expect(document.querySelectorAll('[data-testid=share-city]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid=session-sheet] [data-testid=share-city-sheet]')).toHaveLength(1);
  });
  it('the header share button is absent for a peer, after a share refusal and after the freeze, and present at the desk', () => {
    const peer = mount();
    peer.session.join('phone');
    expect(peer.root.querySelector('[data-testid=share-city]')).toBeNull();
    peer.handle.destroy();
    const refused = mount();
    refused.session.join();
    expect(refused.root.querySelector('[data-testid=share-city]')).not.toBeNull();
    refused.session.error('share-not-allowed');
    expect(refused.root.querySelector('[data-testid=share-city]')).toBeNull();
    refused.handle.destroy();
    const frozen = mount();
    frozen.session.join();
    frozen.session.expire();
    expect(frozen.root.querySelector('[data-testid=share-city]')).toBeNull();
    frozen.handle.destroy();
    const desk = mount({ wide: true });
    desk.session.join();
    expect(text(desk.root.querySelector('[data-testid=status-line] [data-testid=share-city]'))).toBe('Podijeli grad');
    desk.handle.destroy();
  });
  it('without the screen label (a reload of an older tab) the pill names the screen’s stop, never the bare word "zaslon" (T5)', () => {
    const stop = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.9773, lat: 45.8131, routes: ['6'] };
    const { root, session } = mount({ deps: { label: null } });
    session.join('scanner', { kind: 'venue', expiresAt: null, stop });
    expect(text(root.querySelector('[data-testid=session-label]'))).toContain('Otključano · Trg bana J. Jelačića · do 14:42');
    expect(text(root.querySelector('[data-testid=session-label]'))).not.toContain('zaslon');
  });
  it('the sheet is a bottom sheet in plain words: unlocked until, the remaining time, the screen and its stop, the devices, 48 px action rows, the theme words read from the catalogue in preference order, and the four pages', () => {
    const stop = { id: 's1', name: 'Trg bana J. Jelačića', lon: 15.98, lat: 45.81, routes: ['6', '11'] };
    const theme = { getPreference: () => 'auto' as const, getResolvedTheme: () => 'light' as const, setPreference: vi.fn(), onChange: () => () => {}, destroy: vi.fn() };
    const { root, session } = mount({ deps: { theme } });
    session.join('scanner', { kind: 'venue', expiresAt: null, stop });
    click(root, '[data-testid=session-label]');
    const sheet = document.querySelector<HTMLElement>('[data-testid=session-sheet]')!;
    expect(sheet.classList.contains('dialog-sheet')).toBe(true);
    expect(text(sheet.querySelector('.dialog-title'))).toBe('Otključano do 14:42');
    expect(text(sheet.querySelector('[data-testid=sheet-time]'))).toBe('Preostalo 10:00');
    const body = text(sheet.querySelector('.dialog-body'));
    expect(body).toContain('Sa zaslona Kavana Velebit, stajalište Trg bana J. Jelačića.');
    expect(body).toContain('Ovaj je pogled otvoren na 2 uređaja.');
    expect(body).not.toMatch(/stanje sesije/i);
    expect(body).not.toContain('skenirano sa zaslona');
    expect(body).not.toContain('Sesija i postavke');
    expect(body).not.toContain('Vrijedi do');
    for (const testid of ['share-city-sheet', 'toggle-refresh', 'toggle-countdown', 'refresh-now']) {
      expect(sheet.querySelector(`[data-testid=${testid}]`)?.classList.contains('sheet-btn'), testid).toBe(true);
    }
    expect(text(sheet.querySelector('[data-testid=share-city-sheet]'))).toBe('Podijeli grad Pet minuta za osobu pokraj tebe, jednom.');
    expect(text(sheet.querySelector('[data-testid=toggle-refresh]'))).toBe('Zaustavi osvježavanje');
    expect(text(sheet.querySelector('[data-testid=toggle-countdown]'))).toBe('Sakrij odbrojavanje');
    expect(text(sheet.querySelector('[data-testid=refresh-now]'))).toBe('Osvježi sada');
    // The words themselves belong to `common.theme.*` (T6.3's catalogue), so the sheet is held to reading them, not to their spelling.
    expect([...sheet.querySelectorAll('[data-sheet-action=theme]')].map((b) => text(b))).toEqual(THEME_PREFERENCES.map((pref) => hr.common.theme[pref]));
    expect([...sheet.querySelectorAll('.sheet-links a')].map((a) => a.getAttribute('href'))).toEqual(['/hitno', '/izvori/', '/privatnost/', '/pristupacnost/']);
    expect(text(sheet.querySelector('.sheet-links'))).not.toContain('Upiši kod');
  });
  it('the sheet body is reconciled: a toggle keeps the pressed button node focused and the body scroll where it was', () => {
    const { root, session } = mount();
    session.join();
    click(root, '[data-testid=session-label]');
    const sheet = document.querySelector<HTMLElement>('[data-testid=session-sheet]')!;
    const body = sheet.querySelector<HTMLElement>('.dialog-body')!;
    body.scrollTop = 120;
    const button = sheet.querySelector<HTMLButtonElement>('[data-testid=toggle-countdown]')!;
    button.focus();
    expect(document.activeElement).toBe(button);
    button.click();
    expect(text(button)).toBe('Pokaži odbrojavanje');
    expect(sheet.querySelector('[data-testid=toggle-countdown]')).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(body.scrollTop).toBe(120);
    click(sheet, '[data-testid=toggle-refresh]');
    expect(sheet.querySelector('[data-testid=toggle-countdown]')).toBe(button);
    expect(text(sheet.querySelector('[data-testid=toggle-refresh]'))).toBe('Nastavi osvježavanje');
    expect(sheet.querySelector('[data-testid=refresh-now]')).toBeNull();
  });
  it('a peer session says whose five minutes these are, a temporary screen says how long it stands, and the frozen sheet says the end without a countdown or toggles', () => {
    const peer = mount();
    peer.session.join('phone');
    click(peer.root, '[data-testid=session-label]');
    const peerSheet = document.querySelector<HTMLElement>('[data-testid=session-sheet]')!;
    expect(text(peerSheet.querySelector('.dialog-body'))).toContain('Pet minuta od osobe pokraj tebe.');
    expect(text(peerSheet.querySelector('.dialog-body'))).not.toContain('Sa zaslona');
    peer.handle.destroy();

    const temp = mount();
    temp.session.join('scanner', { kind: 'temporary', expiresAt: Date.parse('2026-09-12T11:47:00Z'), stop: null });
    click(temp.root, '[data-testid=session-label]');
    const sheet = document.querySelector<HTMLElement>('[data-testid=session-sheet]')!;
    let body = text(sheet.querySelector('.dialog-body'));
    expect(body).toContain('Sa zaslona Kavana Velebit.');
    expect(body).toContain('Zaslon vrijedi do sutra 13:47.');
    expect(body).not.toContain('privremeni zaslon');
    temp.session.expire();
    expect(sheet.hasAttribute('open')).toBe(false);
    click(temp.root, '[data-testid=session-label]');
    expect(sheet.hasAttribute('open')).toBe(true);
    expect(text(sheet.querySelector('.dialog-title'))).toBe('Sesija je završila');
    expect(sheet.querySelector('[data-testid=sheet-time]')).toBeNull();
    expect(sheet.querySelector('[data-testid=toggle-refresh]')).toBeNull();
    expect(sheet.querySelector('[data-testid=toggle-countdown]')).toBeNull();
    body = text(sheet.querySelector('.dialog-body'));
    expect(body).toContain(hr.session.expiredHint);
    expect(body).not.toContain('Ovaj je pogled otvoren na');
    expect(sheet.querySelector('[data-sheet-action=lang][data-value=en]')).not.toBeNull();
    temp.handle.destroy();
  });
  it('a reloaded view names no screen but still says where it came from; a reconnecting view keeps its end, its remaining time and its toggles', () => {
    const { root, session } = mount({ deps: { label: null } });
    session.join('scanner', { kind: 'venue', expiresAt: null, stop: null });
    click(root, '[data-testid=session-label]');
    const sheet = document.querySelector<HTMLElement>('[data-testid=session-sheet]')!;
    expect(text(sheet.querySelector('.dialog-body'))).toContain('Sa zaslona u blizini.');
    expect(text(sheet.querySelector('.dialog-body'))).not.toContain('Sa zaslona zaslon');
    session.drop();
    click(root, '[data-testid=session-label]');
    expect(text(sheet.querySelector('.dialog-title'))).toBe('Otključano do 14:42');
    expect(text(sheet.querySelector('[data-testid=sheet-time]'))).toBe('Preostalo 10:00');
    expect(sheet.querySelector('[data-testid=toggle-countdown]')).not.toBeNull();
    expect(text(sheet.querySelector('.dialog-body'))).not.toContain('Povezivanje');
  });
  it('the share dialog rotates the peer code as a QR with the letters, a rotation bar and a read-aloud line, copies the code, notes a joined device, and withdraws sharing on the room’s refusal', async () => {
    const slot = (code: string, index: number) => ({ code, slotStart: NOW + index * 30_000, slotEnd: NOW + (index + 1) * 30_000 });
    let at = NOW;
    const { root, session, tick } = mount({ now: () => at });
    session.join();
    session.codes([slot('ABCDEFGH', 0), slot('JKMNPQRS', 1)], NOW);
    const dialog = document.querySelector<HTMLElement>('[data-testid=share-dialog]')!;
    expect(dialog.classList.contains('dialog-sheet')).toBe(true);
    const status = dialog.querySelector<HTMLElement>('[data-testid=share-status]')!;
    expect(status.getAttribute('role'), 'the live region is in the tree, empty, before it has news').toBe('status');
    expect(text(status)).toBe('');
    expect(text(dialog.querySelector('[data-testid=share-code]'))).toBe('ABCD-EFGH');
    expect(dialog.querySelector('.qr')?.getAttribute('role')).toBe('img');
    expect(dialog.querySelector('.qr')?.getAttribute('aria-label'), 'the QR is announced in Croatian with the spelled code, never as a raw key').toBe('QR kod za otključavanje. Kod: A B C D, E F G H');
    expect(text(dialog)).toContain('Dobiva vlastitih pet minuta; tvoje se vrijeme ne mijenja.');
    expect(text(dialog)).toContain(`upiše slova na ${location.host}/s.`);
    expect(text(dialog.querySelector('.share-read'))).toBe('Pročitaj naglas: A B C D, E F G H');
    const fill = dialog.querySelector<HTMLElement>('.share-progress-fill')!;
    expect(fill.style.transform).toBe('scaleX(0)');
    expect(text(dialog.querySelector('.share-rotates'))).toBe('Novi kod za 30 s');
    at = NOW + 18_000;
    tick();
    expect(fill.style.transform).toBe('scaleX(0.6)');
    expect(text(dialog.querySelector('.share-rotates'))).toBe('Novi kod za 12 s');
    at = NOW + 30_000;
    tick();
    expect(text(dialog.querySelector('[data-testid=share-code]'))).toBe('JKMN-PQRS');
    expect(text(dialog.querySelector('.share-read'))).toBe('Pročitaj naglas: J K M N, P Q R S');
    expect(dialog.querySelector('.qr')?.getAttribute('aria-label')).toBe('QR kod za otključavanje. Kod: J K M N, P Q R S');
    expect(fill.style.transform).toBe('scaleX(0)');
    expect(fill.style.transition, 'the reset switches the transition off only for the committed zero').toBe('');
    at = NOW + 31_000;
    tick();
    expect(fill.style.transform).toBe('scaleX(0.033)');
    expect(fill.style.transition).toBe('');
    expect(text(dialog.querySelector('.share-rotates'))).toBe('Novi kod za 29 s');
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const copy = click(dialog, '[data-action=copy-share-code]');
    expect(text(copy)).toBe('Kopiraj kod');
    expect(writeText).toHaveBeenCalledWith('JKMN-PQRS');
    await flush();
    expect(text(status)).toBe('Kod je kopiran.');
    click(dialog, '[data-action=copy-share-code]');
    await flush();
    expect(status.querySelectorAll('p'), 'a second copy re-says the line, it does not repeat it').toHaveLength(1);
    writeText.mockRestore();
    session.count(3);
    expect([...status.querySelectorAll('p')].map((p) => text(p))).toEqual(['Kod je kopiran.', 'Pridružio se još jedan uređaj.']);
    session.error('share-not-allowed');
    expect(text(root.querySelector('[data-testid=announce-assertive]'))).toBe('Ova je sesija dobivena od druge osobe i ne može se dalje dijeliti.');
    click(root, '[data-testid=session-label]');
    expect(document.querySelector('[data-testid=session-sheet] [data-testid=share-city-sheet]')).toBeNull();
  });
});
describe('polling on the feed store', () => {
  it('fetches the active domain’s modules with the data token, then only the new domain’s after a switch', async () => {
    const { root, session, fetchData, tick } = mount();
    session.join();
    await flush();
    expect(fetchData.mock.calls.map((c) => c[0]).sort()).toEqual(['dhmz-cap', 'dhmz-forecast', 'dhmz-now', 'dogadanja', 'emsc', 'glasnik', 'prometnice', 'zet-rt']);
    expect(fetchData.mock.calls[0]![1]).toBe('dt1');
    // Kultura is a Još row now: the directory's own refresh is cleared away, the row's switch is what is measured.
    click(root, '[data-testid=tab-more]');
    await flush();
    fetchData.mockClear();
    click(root, '[data-testid=dir-kultura]');
    await flush();
    expect(fetchData.mock.calls.map((c) => c[0])).toEqual(['dogadanja']);
    fetchData.mockClear();
    tick();
    await flush();
    expect(fetchData).toHaveBeenCalledTimes(1);
  });
  it('polls transit on its own beat (fallback, source phase or validUntil) and everything else every 30 s, refreshing only the due lane (R-TE4)', async () => {
    const { session, armed, fetchData, ticks } = mount();
    session.join();
    await flush();
    // Whatever the active domain's modules are today, the slow lane is all of them but transit.
    const active = [...new Set(fetchData.mock.calls.map((c) => c[0]))];
    expect(armed()).toEqual([1_000, POLL_FALLBACK_MS, 30_000]);
    fetchData.mockClear();
    ticks.find((t) => !t.cleared && t.ms === POLL_FALLBACK_MS)!.fn();
    await flush();
    expect(fetchData.mock.calls.map((c) => c[0])).toEqual(['zet-rt']);
    fetchData.mockClear();
    ticks.find((t) => !t.cleared && t.ms === 30_000)!.fn();
    await flush();
    expect(fetchData.mock.calls.map((c) => c[0]).sort()).toEqual(active.filter((m) => m !== 'zet-rt').sort());

    const aligned = mount({ snapshot: (module) => ({ ...snapshotOf(module), ...(module === 'zet-rt' ? { sourceUpdatedAt: new Date(NOW - 5_000).toISOString() } : {}) }) });
    aligned.session.join();
    await flush();
    expect(aligned.armed()).toEqual([1_000, 8_500, 30_000]);
    const twin = mount({ snapshot: (module) => ({ ...snapshotOf(module), ...(module === 'zet-rt' ? { sourceUpdatedAt: new Date(NOW - 5_000).toISOString(), validUntil: new Date(NOW + 6_500).toISOString() } : {}) }) });
    twin.session.join();
    await flush();
    expect(twin.armed()).toEqual([1_000, 8_000, 30_000]);
  });
});

describe('reconciliation across polls', () => {
  it('preserves a transport search and its caret before a renderer can reparent the controller', async () => {
    const { root, session, tick, handle } = mount();
    session.join();
    await flush();
    handle.selectLayer('u-pokretu');
    const input = root.querySelector<HTMLInputElement>('[data-testid=transport-search]')!;
    input.focus();
    input.value = 'Trg';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.setSelectionRange(1, 2);
    tick();
    await flush();
    expect(root.querySelector('[data-testid=transport-search]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Trg');
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(2);
    handle.destroy();
  });
  it('keeps the workspace node, the focused search field and its typed text through a poll, filtering as you type', async () => {
    const { root, session, tick } = mount();
    session.join();
    await flush();
    openViaMore(root, 'kultura');
    await flush();
    const section = root.querySelector('#layer-kultura')!;
    const input = root.querySelector<HTMLInputElement>('#events-search')!;
    input.focus();
    input.value = 'keramik';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const rows = () => [...root.querySelectorAll('[data-testid=event-row]')].map(text).join(' ');
    expect(rows()).toContain('Radionica keramike');
    expect(rows()).not.toContain('Koncert u parku');
    tick();
    await flush();
    expect(root.querySelector('#layer-kultura')).toBe(section);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('keramik');
    expect(rows()).not.toContain('Koncert u parku');
  });
  it('opens an item detail in place and sends no view frame for it (D5), and Back returns to the list', async () => {
    const { root, session } = mount();
    session.join();
    await flush();
    openViaMore(root, 'kultura');
    await flush();
    click(root, '[data-testid=event-row] [data-action=select]');
    expect(root.querySelector('.ws-split')?.getAttribute('data-detail-open')).toBe('true');
    expect(text(root.querySelector('#ws-detail-title'))).toBe('Koncert u parku');
    expect(session.sent).toEqual([]);
    click(root, '[data-action=back]');
    expect(root.querySelector('.ws-split')?.getAttribute('data-detail-open')).toBe('false');
  });
  it('item actions read the current item through delegation, never a closure from an earlier render', async () => {
    const onItemCopy = vi.fn();
    const onItemShare = vi.fn();
    const { root, session } = mount({ deps: { onItemCopy, onItemShare } });
    session.join();
    await flush();
    openViaMore(root, 'kultura');
    await flush();
    click(root, '[data-testid=event-row] [data-action=select]');
    click(root, '[data-action=copy-item]');
    expect(onItemCopy.mock.calls[0]![0].title).toBe('Koncert u parku');
    click(root, '[data-action=share-item]');
    expect(onItemShare.mock.calls[0]![0].link).toBe('https://kulturpunkt.hr/1');
  });
});
describe('failure and recovery', () => {
  it('keeps the last good data marked stale when a module fails, and a failed module offers a retry that fetches again', async () => {
    let failNow = false;
    const { root, session, fetchData, tick, handle } = mount({ snapshot: (module) => {
      if (module === 'glasnik') throw new Error('down');
      if (failNow && module === 'dhmz-now') throw new Error('boom');
      return snapshotOf(module);
    } });
    session.join();
    await flush();
    // Sada says one sentence and names no source's trouble: the retry lives with the module's own page.
    const sentence = text(root.querySelector('[data-testid=sada-sentence][data-kicker]'));
    expect(sentence).not.toBe('');
    expect(root.querySelector('#layer-grad-sada [data-action=retry]')).toBeNull();
    failNow = true;
    tick();
    await flush();
    // The weather failed after a good answer: Sada keeps its sentence, Vrijeme keeps 21 °C marked stale.
    expect(text(root.querySelector('[data-testid=sada-sentence][data-kicker]'))).toBe(sentence);
    handle.selectLayer('zrak-i-nebo');
    await flush();
    expect(root.querySelector('#layer-zrak-i-nebo [data-testid=panel-status][data-status=stale]')).not.toBeNull();
    expect(text(root.querySelector('#layer-zrak-i-nebo'))).toContain('21 °C');
    handle.selectLayer('uprava-i-pravo');
    await flush();
    fetchData.mockClear();
    click(root, '#layer-uprava-i-pravo [data-action=retry][data-module=glasnik]');
    await flush();
    expect(fetchData.mock.calls.map((c) => c[0])).toEqual(['glasnik']);
  });
  it('a lost socket shows reconnecting, and a spent ticket shows the way back to a new code', () => {
    const { root, session } = mount();
    session.join();
    session.drop();
    expect(root.querySelector('[data-testid=reconnecting]')).not.toBeNull();
    session.join();
    expect(root.querySelector('[data-testid=reconnecting]')).toBeNull();
    session.error('no-ticket');
    expect(text(root.querySelector('.ki-banners'))).toContain('Skeniraj kod ponovno');
    expect(root.querySelector('.ki-banners a[href="/s/"]')).not.toBeNull();
  });
  it('an invalid grant stops refreshing and map movement while preserving a scan-recovery action', async () => {
    const pause = vi.fn();
    const factory = vi.fn(() => ({ update: vi.fn(), destroy: vi.fn(), pause, resume: vi.fn() }));
    const { root, session, handle, fetchData, tick } = mount({ mapFactory: factory });
    session.join();
    await flush();
    handle.selectLayer('u-pokretu');
    await flush();
    fetchData.mockClear();
    session.error('no-ticket');
    tick();
    await flush();
    expect(pause).toHaveBeenCalled();
    expect(fetchData).not.toHaveBeenCalled();
    expect(root.querySelector('.ki-banners a[href="/s/"]')).not.toBeNull();
    handle.destroy();
  });
  // WP4 step 11, [O-59], [O-62]: the end of the ten minutes clears the content. What remains is the invitation to
  // scan again and the way to /hitno; no snapshot line, no export, no fetch, navigation off.
  it('the end of the session clears the content to the scan invitation: the way to a new session and to /hitno, no fetches, navigation off, no exports', async () => {
    const onItemCopy = vi.fn();
    const { root, session, fetchData, tick, ticks } = mount({ deps: { onItemCopy } });
    session.join();
    await flush();
    openViaMore(root, 'kultura');
    await flush();
    click(root, '[data-testid=event-row] [data-action=select]');
    expect(root.querySelector('[data-action=copy-item]')).not.toBeNull();
    fetchData.mockClear();
    session.expire();
    const ended = root.querySelector<HTMLElement>('[data-testid=session-ended]')!;
    expect(ended).not.toBeNull();
    expect(text(ended)).toContain(hr.session.expired);
    expect(ended.querySelector('a[href^="/s/"]')).not.toBeNull();
    expect(ended.querySelector('a[href="/hitno"]')).not.toBeNull();
    // The content is gone with its exports and its date line; the retired probes are absent.
    expect(root.querySelector('#layer-kultura')).toBeNull();
    expect(root.querySelector('[data-testid=dash-view] .layer')).toBeNull();
    expect(root.querySelector('[data-action=copy-item], [data-action=share-item], [data-action=export], [data-action=ics-item], [data-action=print-item]')).toBeNull();
    expect(root.querySelector('[data-testid=frozen-line]')).toBeNull();
    expect(root.querySelector('.ki-snapshot')).toBeNull();
    expect(text(root.querySelector('[data-testid=countdown]'))).toBe(hr.session.frozenBadge);
    tick();
    await flush();
    expect(fetchData).not.toHaveBeenCalled();
    expect(ticks.every((t) => t.cleared)).toBe(true);
    click(root, '.ki-tabs [data-action=nav][data-layer=u-pokretu]');
    expect(root.querySelector('#layer-u-pokretu')).toBeNull();
    expect(root.querySelector('[data-testid=session-ended]')).toBe(ended);
    expect(onItemCopy).not.toHaveBeenCalled();
  });
  it('ends on the clock alone when the socket died and no expired frame arrives', async () => {
    const { root, session, fetchData, tick } = mount();
    session.join();
    await flush();
    fetchData.mockClear();
    session.runOut();
    tick();
    await flush();
    expect(root.querySelector('[data-testid=session-ended]')).not.toBeNull();
    expect(fetchData).not.toHaveBeenCalled();
  });
  it('a refused Access check shows the way back to the protected entrance, and a rejected data token ends the session', async () => {
    const denied = mount({ snapshot: () => { throw new Error('data request failed with 403'); } });
    denied.session.join();
    await flush();
    expect(text(denied.root.querySelector('[data-testid=access-banner]'))).toContain('odbijen');
    expect(denied.root.querySelector('[data-testid=access-banner] a[href="/"]')).not.toBeNull();
    denied.handle.destroy();
    const rejected = mount({ snapshot: () => { throw new Error('data request failed with 401'); } });
    rejected.session.join();
    await flush();
    expect(rejected.root.querySelector('[data-testid=session-ended]')).not.toBeNull();
  });
  it('keeps the ended view when the clock runs out after a socket drop', async () => {
    const { root, session, fetchData, tick } = mount();
    session.join();
    await flush();
    fetchData.mockClear();
    session.runOut();
    tick();
    await flush();
    expect(root.querySelector('[data-testid=session-ended]')).not.toBeNull();
    expect(fetchData).not.toHaveBeenCalled();
  });
});

describe('the full map view (transport)', () => {
  it('history fetches the restored domain immediately and sends no view frame (D5)', async () => {
    const { session, handle, fetchData } = mount();
    session.join();
    await flush();
    fetchData.mockClear();
    handle.restore('#room=r1&layer=sigurnost&q=private-text');
    await flush();
    expect(fetchData.mock.calls.map((call) => call[0]).sort()).toEqual(['ckan-geo', 'dhmz-cap', 'emsc', 'prometnice']);
    expect(session.sent).toEqual([]);
    fetchData.mockClear();
    session.expire();
    handle.restore('#room=r1&layer=kultura');
    await flush();
    expect(handle.activeLayer()).toBe('sigurnost');
    expect(fetchData).not.toHaveBeenCalled();
    handle.destroy();
  });
  it('records the input modality so a pointer tap paints no heading ring while keyboard focus keeps it', () => {
    const { root } = mount();
    const shell = root.querySelector<HTMLElement>('.ki')!;
    expect(shell.dataset.modality).toBeUndefined();
    shell.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(shell.dataset.modality).toBe('pointer');
    shell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(shell.dataset.modality).toBe('keyboard');
    shell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
    expect(shell.dataset.modality).toBe('keyboard');
  });
  it('Jos is one history entry: opening it pushes, Back through the fragment closes it, closing it by its tab or by Escape steps back off it, so no two entries alike are left (round 1, desktop F5)', async () => {
    const pushes: string[] = [];
    const replaces: string[] = [];
    const location = { pathname: '/d/', search: '', hash: '#room=r1' };
    // The browser's stack of fragments: push adds one above the current, replace rewrites it, back steps down.
    const stack: string[] = [location.hash];
    let at = 0;
    const history = {
      pushState: (_s: unknown, _t: string, url?: string | URL | null) => { pushes.push(String(url)); location.hash = String(url).split('#')[1] ? `#${String(url).split('#')[1]}` : ''; stack.splice(++at, Infinity, location.hash); },
      replaceState: (_s: unknown, _t: string, url?: string | URL | null) => { replaces.push(String(url)); location.hash = String(url).split('#')[1] ? `#${String(url).split('#')[1]}` : ''; stack[at] = location.hash; },
      back: () => { at = Math.max(0, at - 1); location.hash = stack[at]!; handle.restore(location.hash); },
    };
    const { root, session, handle } = mount({ deps: { location, history } });
    session.join();
    await flush();
    const before = pushes.length;
    root.querySelector<HTMLElement>('[data-testid=tab-more]')!.click();
    expect(root.querySelector('#layer-directory, [data-testid=tab-more][aria-expanded="true"]')).not.toBeNull();
    expect(pushes.length).toBe(before + 1);
    expect(pushes.at(-1)).toContain('jos=1');
    // Back: the browser lands on the entry under Jos, whose fragment carries no mark.
    handle.restore('#room=r1&layer=grad-sada');
    expect(root.querySelector('[data-testid=tab-more]')!.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('#layer-grad-sada')).not.toBeNull();
    // Forward: the marked entry opens Jos again.
    handle.restore('#room=r1&layer=grad-sada&jos=1');
    expect(root.querySelector('[data-testid=tab-more]')!.getAttribute('aria-expanded')).toBe('true');
    // Escape closes it by a step back off Jos's entry: no copy of the layer's entry is left for the next Back.
    const replacesBefore = replaces.length;
    root.querySelector<HTMLElement>('.ki')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.querySelector('[data-testid=tab-more]')!.getAttribute('aria-expanded')).toBe('false');
    expect(replaces.length).toBe(replacesBefore);
    expect(location.hash).not.toContain('jos');
    // Its tab closes it the same way (review of round 1, note 1): the stack holds one entry per state, never two alike.
    root.querySelector<HTMLElement>('[data-testid=tab-more]')!.click();
    expect(stack.slice(0, at + 1).at(-1)).toContain('jos=1');
    const depth = at;
    root.querySelector<HTMLElement>('[data-testid=tab-more]')!.click();
    expect(root.querySelector('[data-testid=tab-more]')!.getAttribute('aria-expanded')).toBe('false');
    expect(at).toBe(depth - 1);
    expect(replaces.length).toBe(replacesBefore);
    expect(location.hash).not.toContain('jos');
    const live = stack.slice(0, at + 1);
    expect(new Set(live).size, `the entries a Back walks through: ${live.join(' | ')}`).toBe(live.length);
  });

  it('sends no data poll inside the session\'s last 2 s by its clock, so a client behind the server\'s clock never polls past the end (observe-d521b)', async () => {
    let clock = NOW;
    const { root, session, fetchData, tick } = mount({ now: () => clock });
    session.join();
    await flush();
    clock = EXPIRES - LAST_POLL_GUARD_MS - 3_000;
    fetchData.mockClear();
    tick();
    await flush();
    expect(fetchData, 'a poll with time to spare goes out').toHaveBeenCalled();
    fetchData.mockClear();
    clock = EXPIRES - LAST_POLL_GUARD_MS + 500;
    tick();
    await flush();
    expect(fetchData, 'no poll in the last 2 s').not.toHaveBeenCalled();
    expect(root.querySelector('[data-testid=session-ended]')).toBeNull();
    clock = EXPIRES + 100;
    tick();
    await flush();
    expect(fetchData).not.toHaveBeenCalled();
    expect(root.querySelector('[data-testid=session-ended]')).not.toBeNull();
  });

  it('writes one history entry per place, none per poll, and Back through the fragment closes the detail', async () => {
    const pushes: string[] = [];
    const replaces: string[] = [];
    const location = { pathname: '/d/', search: '', hash: '#room=r1' };
    const history = {
      pushState: (_s: unknown, _t: string, url?: string | URL | null) => { pushes.push(String(url)); location.hash = String(url).split('#')[1] ? `#${String(url).split('#')[1]}` : ''; },
      replaceState: (_s: unknown, _t: string, url?: string | URL | null) => { replaces.push(String(url)); location.hash = String(url).split('#')[1] ? `#${String(url).split('#')[1]}` : ''; },
    };
    const { root, session, tick, handle } = mount({ deps: { location, history } });
    session.join();
    await flush();
    openViaMore(root, 'kultura');
    await flush();
    click(root, '[data-testid=event-row] [data-action=select]');
    // Jos itself is one entry (round 1, desktop F5), then the layer, then the place.
    expect(pushes).toHaveLength(3);
    expect(pushes[0]).toMatch(/jos=1/);
    expect(pushes[1]).not.toMatch(/jos/);
    expect(pushes[2]).toMatch(/room=r1/);
    expect(pushes[2]).toMatch(/layer=kultura&kind=item&id=[0-9a-f]{16}&module=dogadanja/);
    expect(pushes[2]).not.toMatch(/ticket|jos/);
    tick();
    await flush();
    tick();
    await flush();
    expect(pushes).toHaveLength(3); // polls never touch history
    // Back: the browser restores the previous fragment and the entry hands it to the dashboard.
    handle.restore('#room=r1&layer=kultura');
    expect(root.querySelector('.ws-split')?.getAttribute('data-detail-open')).toBe('false');
    expect(pushes).toHaveLength(3);
    click(root, '[data-testid=event-row] [data-action=select]');
    click(root, '[data-testid=event-row] [data-action=select]');
    expect(pushes).toHaveLength(4); // the same selection again replaces instead of pushing
  });
  it('is a view mode on the shell with the session chrome kept; Escape and another domain leave it', async () => {
    const mapFactory = vi.fn((_options: CityMapOptions) => ({ update: vi.fn(), destroy: vi.fn(), pause: vi.fn(), resume: vi.fn() }));
    const { root, session, handle } = mount({ wide: true, mapFactory });
    session.join();
    await flush();
    handle.selectLayer('u-pokretu');
    await flush();
    const dash = root.querySelector<HTMLElement>('.ki')!;
    // The full-map button went with Karta's map menu (WP4); the desk's chevron is what collapses the board into
    // the page's map view.
    expect(root.querySelector('[data-testid=map-full-toggle]')).toBeNull();
    const chevron = root.querySelector<HTMLButtonElement>('.t-sheet-toggle')!;
    chevron.focus();
    chevron.click();
    expect(dash.dataset.view).toBe('map');
    // Karta's own maps; Sada's band (sada-map-canvas) is a map of its own, released when Karta opens.
    const karta = () => mapFactory.mock.calls.map(([o], i) => ({ o, i })).filter(({ o }) => o.container.dataset.testid === 'map-canvas');
    expect(karta()).toHaveLength(1);
    expect(root.querySelector('[data-testid=session-label]')).not.toBeNull();
    // The map/schema switch stays in the sheet's head, with no group to pick first [O-72].
    const mode = root.querySelector<HTMLButtonElement>('[data-testid=map-mode-toggle]')!;
    mode.focus();
    mode.click();
    expect(karta()).toHaveLength(2);
    expect(karta()[1]?.o.renderer).toBe('schema');
    expect(mapFactory.mock.results[karta()[0]!.i]?.value.destroy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('kajima:map-mode:v1')).toBe('schema');
    expect(dash.dataset.view).toBe('map');
    expect(document.activeElement).toBe(mode);
    expect(session.sent).toEqual([]);
    dash.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dash.dataset.view).toBe('layers');
    handle.selectLayer('kultura');
    expect(root.querySelector('[data-testid=map-canvas]')).toBeNull();
    handle.destroy();
    // A new desktop session restores schema only for Promet.
    mapFactory.mockClear();
    const desk = mount({ wide: true, mapFactory });
    desk.session.join();
    await flush();
    desk.handle.selectLayer('u-pokretu');
    await flush();
    expect(mapFactory.mock.calls.find(([o])=>o.container.dataset.testid==='map-canvas')?.[0].renderer).toBe('schema');
    await flush();
    expect(mapFactory.mock.calls.filter(([o]) => o.container.dataset.testid === 'map-canvas').at(-1)?.[0].renderer).toBe('schema');
    desk.handle.destroy();
  });
});

describe('the sticky header and notices in flow', () => {
  const clock = () => { let at = NOW; return { now: () => at, set(ms: number) { at = ms; } }; };
  const notice = (root: Root, kind?: string): HTMLElement | null =>
    root.querySelector<HTMLElement>(kind ? `[data-testid=notice][data-kind=${kind}]` : '[data-testid=notice]');
  const noticeText = (root: Root, kind: string): string => text(notice(root, kind)?.querySelector('.banner-text'));

  it('groups the wordmark, the session pill and the safety control in one status line (no desktop search on the phone, no kvart select), and keeps the assertive region visually hidden', () => {
    const { root } = mount();
    const head = root.querySelector<HTMLElement>('header.ki-head');
    expect(head).not.toBeNull();
    expect(head!.dataset.testid).toBe('status-line');
    expect(head!.querySelector('.ki-wordmark')).not.toBeNull();
    expect(head!.querySelector('[data-testid=kvart-select]')).toBeNull();
    expect(head!.querySelector('[data-testid=session-label]')).not.toBeNull();
    expect(head!.querySelector('[data-testid=safety-shortcut]')).not.toBeNull();
    expect(head!.querySelector('[data-testid=status-search]')).toBeNull();
    expect(text(root.querySelector('.ki-wordmark'))).toBe('Kaj ima?');
    expect(text(root.querySelector('.ki-wordmark .ki-wordmark-mark'))).toBe('?');
    const alert = root.querySelector<HTMLElement>('[data-testid=announce-assertive]')!;
    expect(alert.classList.contains('visually-hidden')).toBe(true);
    expect(alert.classList.contains('ki-alert')).toBe(true);
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(head!.contains(alert)).toBe(false);
  });
  it('reports the poll on the shell: data-loading is true while a fetch is pending and false once it lands', async () => {
    const pending = mount({ deps: { fetchData: () => new Promise<never>(() => {}) } });
    pending.session.join();
    await flush();
    expect(pending.handle.element.dataset.loading).toBe('true');
    pending.handle.destroy();
    const landed = mount();
    landed.session.join();
    await flush();
    expect(landed.handle.element.dataset.loading).toBe('false');
  });
  it('confirms the unlock in the polite region and the pill alone: no in-flow notice (kajimafix 01.1; the banners row is for the session\'s troubles and the two expiry marks)', () => {
    const time = clock();
    const { root, session, tick } = mount({ now: time.now });
    session.join();
    expect(notice(root)).toBeNull();
    expect(text(root.querySelector('[data-testid=announce-polite]'))).toBe('Otključano do 14:42');
    expect(root.querySelector('[data-testid=session-label]')?.getAttribute('aria-label')).toBe('Otključano do 14:42, otvori postavke');
    time.set(NOW + 4_000);
    tick();
    expect(notice(root)).toBeNull();
    // A peer session: the same polite sentence and the same pill, and no notice either.
    const peer = mount({ deps: { label: null } });
    peer.session.join('phone');
    expect(notice(peer.root)).toBeNull();
    expect(text(peer.root.querySelector('[data-testid=announce-polite]'))).toBe('Otključano do 14:42');
    expect(peer.root.querySelector('[data-testid=session-label]')?.getAttribute('aria-label')).toBe('Otključano do 14:42, otvori postavke');
  });
  it('shows the 60 s and 20 s warnings in flow with the approved sentences, then clears the notice and the alert on the freeze', () => {
    const time = clock();
    const { root, session, tick } = mount({ now: time.now });
    session.join();
    time.set(EXPIRES - 60_000);
    tick();
    expect(noticeText(root, 'expiring60')).toBe(hr.session.expiring60);
    expect(text(root.querySelector('[data-testid=announce-polite]'))).toBe(hr.session.expiring60);
    time.set(EXPIRES - 20_000);
    tick();
    expect(root.querySelectorAll('[data-testid=notice]')).toHaveLength(1);
    expect(noticeText(root, 'expiring20')).toBe(hr.session.expiring20);
    expect(text(root.querySelector('[data-testid=announce-assertive]'))).toBe(hr.session.expiring20);
    time.set(EXPIRES);
    tick();
    expect(root.querySelector('[data-testid=session-ended]')).not.toBeNull();
    expect(notice(root)).toBeNull();
    expect(text(root.querySelector('[data-testid=announce-assertive]'))).toBe('');
  });
  it('a share refusal stays in the assertive region and shows as an in-flow notice for eight seconds', () => {
    const time = clock();
    const { root, session, tick } = mount({ now: time.now });
    session.join();
    session.error('share-not-allowed');
    expect(text(root.querySelector('[data-testid=announce-assertive]'))).toBe(hr.session.shareUnavailable);
    expect(noticeText(root, 'refusal')).toBe(hr.session.shareUnavailable);
    time.set(NOW + 7_999);
    tick();
    expect(notice(root, 'refusal')).not.toBeNull();
    time.set(NOW + 8_000);
    tick();
    expect(notice(root)).toBeNull();
  });
  it('the 44 px dismiss control removes the notice at once', () => {
    const { root, session } = mount();
    session.join();
    session.error('share-not-allowed');
    expect(notice(root, 'refusal')).not.toBeNull();
    const dismiss = click(root, '[data-testid=notice] [data-action=dismiss-notice]');
    expect(dismiss.getAttribute('aria-label')).toBe(hr.common.dismiss);
    expect(dismiss.classList.contains('icon-btn')).toBe(true);
    expect(notice(root)).toBeNull();
  });
  it('after the freeze the disabled tabs and Još leave the Tab order while the safety link stays reachable', () => {
    const { root, session } = mount();
    session.join();
    session.expire();
    const tabs = [...root.querySelectorAll<HTMLElement>('.ki-tab[aria-disabled="true"]')];
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) expect(tab.getAttribute('tabindex')).toBe('-1');
    expect(root.querySelector('[data-testid=safety-shortcut]')?.getAttribute('tabindex')).toBeNull();
  });
  it('a peer\'s pill says whose minutes these are, never a device\'s slug', () => {
    const { root, session } = mount({ deps: { label: null } });
    session.join('phone');
    const sentence = text(root.querySelector('[data-testid=session-label] .ki-session-sentence'));
    expect(sentence).toBe('Pet minuta od osobe pokraj tebe · do 14:42');
    expect(sentence).not.toContain('phone');
    expect(sentence).not.toContain('zaslon');
    expect(root.querySelector('[data-testid=session-label]')?.getAttribute('aria-label')).toBe('Otključano do 14:42, otvori postavke');
  });
  it('the session pill names the expiry and the action for readers, and turns warn at 60 s and alert at 20 s', () => {
    const time = clock();
    const { root, session, tick } = mount({ now: time.now });
    const pill = (): HTMLElement => root.querySelector<HTMLElement>('[data-testid=session-label]')!;
    expect(pill().dataset.urgency).toBe('none');
    expect(pill().getAttribute('aria-label')).toBe(hr.session.connecting);
    session.join();
    expect(pill().dataset.urgency).toBe('none');
    expect(pill().getAttribute('aria-label')).toContain('Otključano do 14:42');
    expect(text(pill())).toContain('Otključano · Kavana Velebit · do 14:42');
    time.set(EXPIRES - 45_000);
    tick();
    expect(pill().dataset.urgency).toBe('warn');
    time.set(EXPIRES - 15_000);
    tick();
    expect(pill().dataset.urgency).toBe('alert');
    session.expire();
    expect(pill().dataset.urgency).toBe('none');
    expect(pill().getAttribute('aria-label')).toBe(hr.session.expiredTitle);
  });
  it('counts the silent sources once in a quiet status banner, with Croatian plurals', async () => {
    const failing = (...down: ModuleId[]) => (module: ModuleId): ModuleSnapshot => {
      if (down.includes(module)) throw new Error('down');
      return snapshotOf(module);
    };
    const one = mount({ snapshot: failing('glasnik') });
    one.session.join();
    await flush();
    const banner = one.root.querySelector<HTMLElement>('[data-testid=sources-down]');
    expect(text(banner)).toBe('1 izvor ne odgovara.');
    expect(banner?.getAttribute('role')).toBe('status');
    one.handle.destroy();
    const two = mount({ snapshot: failing('glasnik', 'emsc') });
    two.session.join();
    await flush();
    expect(text(two.root.querySelector('[data-testid=sources-down]'))).toBe('2 izvora ne odgovaraju.');
    two.handle.destroy();
    const none = mount();
    none.session.join();
    await flush();
    expect(none.root.querySelector('[data-testid=sources-down]')).toBeNull();
  });
  it('a layer change or a closed directory on the phone scrolls the document to the top; the desktop keeps its scroll', () => {
    const win = globalThis as { scrollTo?: (options: ScrollToOptions) => void };
    const original = win.scrollTo;
    const scrollTo = vi.fn();
    win.scrollTo = scrollTo;
    try {
      const phone = mount();
      click(phone.root, '.ki-tabs [data-action=nav][data-layer=u-pokretu]');
      expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
      scrollTo.mockClear();
      click(phone.root, '[data-testid=tab-more]');
      click(phone.root, '[data-testid=dir-zrak-i-nebo]');
      expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
      phone.handle.destroy();
      scrollTo.mockClear();
      const desk = mount({ wide: true });
      click(desk.root, '[data-testid=status-more]');
      click(desk.root, '[data-testid=dir-kultura]');
      expect(desk.root.querySelector('#layer-kultura')).not.toBeNull();
      expect(scrollTo).not.toHaveBeenCalled();
      desk.handle.destroy();
    } finally {
      win.scrollTo = original;
    }
  });

  // T4.1 / WP4 step 11: the session's moments. The end is a designed closing card standing in the workspace alone,
  // with no banner left; a room closed under a live session gets its own title; nothing of the content is dated or kept.
  it('the end leaves one closing card in the workspace and no banner: the approved sentence as its title, the hint, a primary way to a new session and the way to /hitno', () => {
    const time = clock();
    const { root, session, tick } = mount({ now: time.now });
    session.join();
    time.set(EXPIRES - 20_000);
    tick();
    expect(notice(root, 'expiring20')).not.toBeNull();
    time.set(EXPIRES);
    tick();
    const banners = root.querySelector<HTMLElement>('[data-testid=banners]')!;
    expect(banners.children).toHaveLength(0);
    const main = root.querySelector<HTMLElement>('[data-testid=dash-view]')!;
    expect(main.children).toHaveLength(1);
    const card = main.firstElementChild as HTMLElement;
    expect(card.dataset.testid).toBe('session-ended');
    expect(card.getAttribute('role')).toBe('alert');
    expect(card.classList.contains('closing')).toBe(true);
    expect(text(card.querySelector('.closing-title'))).toBe(hr.session.expired);
    expect(text(card.querySelector('.session-ended-hint'))).toBe(hr.session.expiredHint);
    const cta = card.querySelector<HTMLAnchorElement>('a.btn-primary[href="/s/"]')!;
    expect(text(cta)).toBe(hr.session.expiredCta);
    expect(cta.querySelector('svg use')?.getAttribute('href')).toBe('#icon-qr-code');
    const safety = card.querySelector<HTMLAnchorElement>('a[href="/hitno"]')!;
    expect(text(safety)).toBe(hr.nav.safety);
    // Byte-exact owner strings [O-59].
    expect(hr.session.expired).toBe('Deset minuta je prošlo. Zaslon u blizini otključava novih 10 minuta.');
    expect(hr.session.expiredHint).toBe('Sigurnost ostaje otvorena na /hitno.');
    expect(hr.session.expiredCta).toBe('Skeniraj za novih 10 minuta');
  });
  it('after the end the workspace is the closing card alone, with no date line, re-said in the other language', () => {
    const time = clock();
    const { root, session, tick } = mount({ now: time.now });
    session.join();
    expect(root.querySelector('[data-testid=session-ended]')).toBeNull();
    time.set(EXPIRES);
    tick();
    const main = root.querySelector<HTMLElement>('[data-testid=dash-view]')!;
    expect(main.firstElementChild?.getAttribute('data-testid')).toBe('session-ended');
    expect(main.querySelector('.ki-snapshot')).toBeNull();
    expect(main.querySelector('#layer-grad-sada')).toBeNull();
    click(root, '[data-testid=session-label]');
    click(document, '[data-testid=session-sheet] [data-sheet-action=lang][data-value=en]');
    expect(main.children).toHaveLength(1);
    expect(text(main.querySelector('[data-testid=session-ended] .closing-title'))).toBe(en.session.expired);
    expect(text(main.querySelector('[data-testid=session-ended] a.btn-primary'))).toBe(en.session.expiredCta);
    expect(document.title).toBe('Kaj ima? · Now');
  });
  it('a room closed under a live session is told apart from a spent ticket: the content clears behind the revoked card with its own way out', async () => {
    const { root, session, fetchData, tick } = mount();
    session.join();
    await flush();
    fetchData.mockClear();
    session.error('no-ticket', 'revoked');
    const card = root.querySelector<HTMLElement>('[data-testid=session-ended]');
    expect(card).not.toBeNull();
    expect(text(card!.querySelector('.closing-title'))).toBe(hr.session.revoked);
    expect(text(card!.querySelector('.session-ended-hint'))).toBe(hr.session.expiredHint);
    expect(text(card!.querySelector('a.btn-primary[href="/s/"]'))).toBe(hr.session.revokedCta);
    expect(card!.querySelector('a[href="/hitno"]')).not.toBeNull();
    expect(root.querySelector('[data-key=no-ticket]')).toBeNull();
    expect(root.querySelector('#layer-grad-sada')).toBeNull();
    expect(text(root.querySelector('[data-testid=countdown]'))).toBe(hr.session.frozenBadge);
    tick();
    await flush();
    expect(fetchData).not.toHaveBeenCalled();
    // A spent ticket is not a closed room: its warning banner stays and the content stays.
    const spent = mount();
    spent.session.join();
    spent.session.error('no-ticket', 'no-ticket');
    expect(spent.root.querySelector('[data-testid=session-ended]')).toBeNull();
    expect(spent.root.querySelector('[data-key=no-ticket]')).not.toBeNull();
    expect(spent.root.querySelector('#layer-grad-sada')).not.toBeNull();
  });
  it('a page the room refused a ticket to settles its list and band after the hold\'s own limit instead of holding reserved rows for good (round 1 finding F16)', () => {
    let t = NOW;
    const { root, session, tick, armed } = mount({ now: () => t });
    session.error('no-ticket', 'no-ticket');
    expect(root.querySelector('[data-key=no-ticket]')).not.toBeNull();
    expect(root.querySelectorAll('[data-testid=nearby] .nearby-row-empty').length).toBeGreaterThan(0);
    expect(armed()).toContain(NEARBY_HOLD_MS + 100);
    t += NEARBY_HOLD_MS + 200;
    tick();
    expect(root.querySelectorAll('[data-testid=nearby] .nearby-row-empty')).toHaveLength(0);
    expect(root.querySelector('[data-testid=nearby]')?.getAttribute('aria-busy')).toBeNull();
    expect(armed()).not.toContain(NEARBY_HOLD_MS + 100);
  });

  it('a closed room reported before any join is a spent credential: the no-ticket banner, nothing ended', () => {
    const { root, session } = mount();
    session.error('no-ticket', 'revoked');
    expect(root.querySelector('[data-testid=session-ended]')).toBeNull();
    expect(root.querySelector('[data-key=no-ticket]')).not.toBeNull();
    expect(root.querySelector('#layer-grad-sada')).not.toBeNull();
    expect(text(root.querySelector('[data-testid=countdown]'))).not.toBe(hr.session.frozenBadge);
  });
  it('a phone that hears of the end late still ends: the card stands and the pill says the session is over', () => {
    const time = clock();
    const { root, session } = mount({ now: time.now });
    session.join();
    // A phone whose socket dropped in the background hears of the end five minutes after it.
    time.set(EXPIRES + 5 * 60_000);
    session.expire();
    expect(root.querySelector('[data-testid=session-ended]')).not.toBeNull();
    expect(text(root.querySelector('[data-testid=countdown]'))).toBe(hr.session.frozenBadge);
    expect(root.querySelector('[data-testid=session-label]')?.getAttribute('aria-label')).toBe(hr.session.expiredTitle);
  });
  it('the visible reconnecting banner says the countdown goes on, while the pill sentence for readers keeps the disconnected line', () => {
    const { root, session } = mount();
    session.join();
    session.drop();
    expect(text(root.querySelector('[data-testid=reconnecting] .banner-text'))).toBe('Veza se obnavlja. Odbrojavanje ide dalje.');
    expect(text(root.querySelector('[data-testid=session-label] .ki-session-sentence'))).toBe(hr.session.disconnected);
  });
  it('the directory session row tells the truth: connecting before the join, the expiry while unlocked; the end clears the directory too', () => {
    const { root, session } = mount();
    click(root, '[data-testid=tab-more]');
    const title = (): string => text(root.querySelector('[data-testid=dir-session] .row-title'));
    expect(title()).toBe(hr.session.connecting);
    session.join();
    expect(title()).toBe('Otključano do 14:42');
    session.expire();
    expect(root.querySelector('#layer-directory')).toBeNull();
    expect(root.querySelector('[data-testid=session-ended]')).not.toBeNull();
    expect(root.querySelector('[data-testid=tab-more]')?.getAttribute('aria-expanded')).toBe('false');
  });
});

// B.5: the rail is gone, and so is the kvart aside. One shell of five regions
// in reading order on both surfaces; the CSS orders and sizes them but never
// hides a control that exists.
describe('the shell regions', () => {
  it('is five children in order: the status line, the presentation panel, banners, main and the tab bar, with no rail, no sidebar, no kvart aside and no FAB slot', () => {
    const { root } = mount();
    const shell = root.querySelector<HTMLElement>('.ki')!;
    const order = [...shell.children].filter((el) => !el.matches('h1, p')).map((el) => el.className);
    expect(order).toEqual(['ki-head ki-status', 'ki-presentation', 'ki-banners', 'ki-main', 'ki-tabbar']);
    expect(shell.querySelector('.ki-rail')).toBeNull();
    expect(shell.querySelector('nav.ki-side')).toBeNull();
    expect(shell.querySelector('.ki-kvart')).toBeNull();
    const head = shell.querySelector<HTMLElement>('header.ki-head')!;
    expect(head.parentElement).toBe(shell);
    expect(head.dataset.region).toBe('status');
    expect(shell.querySelector('[data-region=fab]')).toBeNull();
    expect(shell.querySelector('nav.ki-tabbar')?.getAttribute('aria-label')).toBe('Domene');
    expect(shell.dataset.fab).toBeUndefined();
  });
});

// T2.7: motion that reports a fact. A workspace switch fades the incoming
// layer in (signage.css's ki-enter); a poll that repaints the same place, or
// a reduced-motion/lightweight session, never sees it move at all.
describe('motion: the workspace fades in on a switch, never on a redraw', () => {
  const main = (root: Root): HTMLElement => root.querySelector<HTMLElement>('[data-testid=dash-view]')!;

  it('marks main with data-enter on a layer switch and clears it once the fallback timer fires', () => {
    const { root, tick } = mount();
    expect(main(root).dataset.enter).toBeUndefined();
    click(root, '.ki-tabs [data-action=nav][data-layer=u-pokretu]');
    expect(main(root).dataset.enter).toBe('1');
    tick();
    expect(main(root).dataset.enter).toBeUndefined();
  });

  it('marks main again when the directory opens, and again when it closes back to a domain', () => {
    const { root } = mount();
    click(root, '[data-testid=tab-more]');
    expect(main(root).dataset.enter).toBe('1');
    click(root, '[data-testid=dir-zrak-i-nebo]');
    expect(main(root).dataset.enter).toBe('1');
  });

  it('never sets it under reducedMotion, even across a real layer switch', () => {
    const { root } = mount({ deps: { reducedMotion: true } });
    click(root, '.ki-tabs [data-action=nav][data-layer=u-pokretu]');
    expect(main(root).dataset.enter).toBeUndefined();
  });

  it('never sets it on the lightweight path', () => {
    const { root } = mount({ lightweight: true });
    click(root, '.ki-tabs [data-action=nav][data-layer=u-pokretu]');
    expect(main(root).dataset.enter).toBeUndefined();
  });

  it('does not mark main on the initial paint, nor on a poll re-render that keeps the same layer', async () => {
    const { root, session } = mount();
    expect(main(root).dataset.enter).toBeUndefined();
    session.join();
    await flush();
    expect(main(root).dataset.enter).toBeUndefined();
  });
});

// B.5 / B.8: the status line is one builder painting keyed children by surface,
// casting is explicit (D5), the desktop reaches every domain through Još (D10).
describe('the status line', () => {
  const keys = (root: Root): string[] => [...root.querySelector('[data-testid=status-line]')!.children].map((el) => (el as HTMLElement).dataset.key ?? '');

  it('paints the keyed controls in the documented order from the one builder: Zaslon and Podijeli grad beside the pill on both surfaces, one row at the desk without the clock or a domain bar', () => {
    const STOP = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.9773, lat: 45.8131, routes: ['6', '11', '12'] };
    const phone = mount();
    expect(keys(phone.root)).toEqual(['wordmark', 'session', 'safety']);
    expect(phone.root.querySelector('[data-testid=tab-more]')).not.toBeNull();
    phone.session.join();
    expect(keys(phone.root)).toEqual(['wordmark', 'share', 'session', 'safety']);
    phone.handle.destroy();
    const scanner = mount();
    scanner.session.join('scanner', { kind: 'venue', expiresAt: null, stop: STOP });
    expect(keys(scanner.root)).toEqual(['wordmark', 'screen', 'share', 'session', 'safety']);
    scanner.handle.destroy();
    const desk = mount({ wide: true });
    expect(keys(desk.root)).toEqual(['wordmark', 'space', 'session', 'more', 'safety']);
    desk.session.join('scanner', { kind: 'venue', expiresAt: null, stop: STOP });
    expect(keys(desk.root)).toEqual(['wordmark', 'space', 'screen', 'share', 'session', 'more', 'safety']);
    expect(desk.root.querySelector('[data-testid=desk-karta]'), 'no header link into Karta: it stands beside Sada (chunk E)').toBeNull();
    expect(text(desk.root.querySelector('[data-testid=status-more]'))).toBe('Još');
    expect(desk.root.querySelectorAll('.ki-domains [data-layer]')).toHaveLength(0);
    expect(desk.root.querySelector('.ki-domains')).toBeNull();
    expect(desk.root.querySelector('[data-testid=status-clock]')).toBeNull();
    expect(desk.root.querySelector('[data-testid=status-search]')).toBeNull();
    expect(desk.root.querySelector('[data-testid=tab-more]'), 'the desk has no tab bar').toBeNull();
    expect(desk.root.querySelector('[data-testid=cast-fab]')).toBeNull();
    desk.handle.destroy();
  });
  it('the wordmark leads back to Sada inside /d/ and, like every navigation, tells the room nothing', () => {
    const { root, session } = mount();
    const wordmark = root.querySelector<HTMLAnchorElement>('.ki-wordmark')!;
    expect(wordmark.getAttribute('href')).toBe('#layer=grad-sada');
    expect(wordmark.getAttribute('aria-label')).toBe('Kaj ima?, natrag na Sada');
    click(root, '.ki-tabs [data-action=nav][data-layer=u-pokretu]');
    click(root, '.ki-wordmark');
    expect(root.querySelector('#layer-grad-sada')).not.toBeNull();
    expect(session.sent).toEqual([]);
  });
  it('the safety control is icon-only: the shield, the word in its aria-label, a 44 px target by CSS', () => {
    const { root } = mount();
    const safety = root.querySelector<HTMLElement>('[data-testid=safety-shortcut]')!;
    expect(safety.getAttribute('aria-label')).toBe('Sigurnost');
    expect(safety.querySelector('svg use')?.getAttribute('href')).toBe('#icon-shield');
    expect(safety.querySelector('.ki-nav-label')).toBeNull();
    expect(text(safety)).toBe('');
  });
  it('the desk header carries no clock and no weather: the time and the weather are the feed’s, never a second header row [O-56]', async () => {
    const live = mount({ wide: true });
    live.session.join();
    await flush();
    const status = live.root.querySelector<HTMLElement>('[data-testid=status-line]')!;
    expect(status.querySelector('[data-testid=status-clock]')).toBeNull();
    expect(status.querySelector('time')).toBeNull();
    expect(status.querySelector('.ki-weather')).toBeNull();
    expect(text(status)).not.toContain('°C');
    live.handle.destroy();
  });
  it('desktop transport navigation exposes the single search field in lightweight mode: Karta is on the page from the first draw', () => {
    const { root, session } = mount({ wide: true, lightweight: true });
    session.join();
    expect(root.querySelector('#layer-grad-sada')).not.toBeNull();
    expect(root.querySelector('#layer-u-pokretu')).not.toBeNull();
    expect(root.querySelector('#ki-main [data-testid=transport-search]')).not.toBeNull();
    expect(session.sent).toEqual([]);
  });
});

// WP4 step 12 (seam S6): the phone's sentence is the page's rotation over the model's answers and the templates,
// asked from the route at most once a minute, read through the wall's own sequence with its strict acceptance.
describe('Sada\'s sentence (WP4 step 12)', () => {
  const clock = () => { let at = NOW; return { now: () => at, set(ms: number) { at = ms; } }; };
  type Request = { locale: 'hr' | 'en'; budget: number; facts: { id: string; kind: string; text: string; validUntil: number | null }[] };
  const answerWith = (text: (req: Request) => string) => vi.fn(async (req: Request) => [{
    text: text(req), kicker: req.facts[0]!.kind, refs: [req.facts[0]!.id], validUntil: NOW + 600_000, origin: 'model' as const,
  }]);

  it('asks the route once after the join with the locale, the 80-character budget and the page\'s facts, and shows one sentence with its kicker', async () => {
    const fetchSentences = answerWith((req) => req.facts[0]!.text);
    const { root, session, handle } = mount({ deps: { fetchSentences: fetchSentences as never } });
    expect(fetchSentences).not.toHaveBeenCalled();
    session.join();
    await flush();
    expect(fetchSentences).toHaveBeenCalledTimes(1);
    const request = fetchSentences.mock.calls[0]![0];
    expect(request.locale).toBe('hr');
    expect(request.budget).toBe(80);
    expect(request.facts.length).toBeGreaterThan(0);
    for (const fact of request.facts) expect(fact).toMatchObject({ id: expect.any(String), kind: expect.any(String), text: expect.any(String) });
    const card = root.querySelector<HTMLElement>('[data-testid=sada-sentence]')!;
    expect(card).not.toBeNull();
    expect(card.dataset.kicker).toMatch(/^(promet|kultura|vrijeme|bicikli|nocas|radovi)$/);
    expect(text(card.querySelector('.sada-sentence-text')).length).toBeGreaterThan(0);
    expect(text(card.querySelector('.sada-sentence-text')).length).toBeLessThanOrEqual(80);
    handle.destroy();
  });

  it('asks at most once a minute: the polls inside the minute ask nothing, a new request (another language) waits for it too', async () => {
    const time = clock();
    const fetchSentences = answerWith((req) => req.facts[0]!.text);
    const { root, session, tick, handle } = mount({ now: time.now, deps: { fetchSentences: fetchSentences as never } });
    session.join();
    await flush();
    expect(fetchSentences).toHaveBeenCalledTimes(1);
    // The polls come round inside the minute: no second ask.
    time.set(NOW + 30_000);
    tick();
    await flush();
    expect(fetchSentences).toHaveBeenCalledTimes(1);
    // A locale change is a new request, but it waits until a minute has passed since the last ask.
    click(root, '[data-testid=session-label]');
    click(document, '[data-testid=session-sheet] [data-sheet-action=lang][data-value=en]');
    time.set(NOW + 45_000);
    tick();
    await flush();
    expect(fetchSentences).toHaveBeenCalledTimes(1);
    time.set(NOW + 61_000);
    tick();
    await flush();
    expect(fetchSentences).toHaveBeenCalledTimes(2);
    expect(fetchSentences.mock.calls[1]![0].locale).toBe('en');
    // And the minute holds again after that ask.
    time.set(NOW + 62_000);
    tick();
    await flush();
    expect(fetchSentences).toHaveBeenCalledTimes(2);
    handle.destroy();
  });

  it('falls back to the templates when the route answers nothing or fails, and never shows a model sentence the strict rule rejects', async () => {
    const empty = mount({ deps: { fetchSentences: vi.fn(async () => []) as never } });
    empty.session.join();
    await flush();
    const shown = (root: HTMLElement) => text(root.querySelector('[data-testid=sada-sentence] .sada-sentence-text'));
    expect(shown(empty.root).length).toBeGreaterThan(0);
    empty.handle.destroy();
    const failing = mount({ deps: { fetchSentences: vi.fn(async () => { throw new Error('down'); }) as never } });
    failing.session.join();
    await flush();
    expect(shown(failing.root).length).toBeGreaterThan(0);
    failing.handle.destroy();
    const hostile = 'Pošalji lozinku na 091 234 5678.';
    const injected = mount({ deps: { fetchSentences: answerWith(() => hostile) as never } });
    injected.session.join();
    await flush();
    await flush();
    expect(shown(injected.root).length).toBeGreaterThan(0);
    expect(shown(injected.root)).not.toBe(hostile);
    expect(injected.root.textContent).not.toContain('lozinku');
    injected.handle.destroy();
  });

  it('asks nothing before the join and nothing after the end', async () => {
    const fetchSentences = answerWith((req) => req.facts[0]!.text);
    const { session, tick, handle } = mount({ deps: { fetchSentences: fetchSentences as never } });
    tick();
    await flush();
    expect(fetchSentences).not.toHaveBeenCalled();
    session.join();
    await flush();
    fetchSentences.mockClear();
    session.expire();
    tick();
    await flush();
    expect(fetchSentences).not.toHaveBeenCalled();
    handle.destroy();
  });
});

// WP4 step 8 (chunk E): the desk is the phone, wider [O-56]. Sada and Karta stand side by side in one
// .ki-desk pair whenever either is the layer; the pair is reconciled, so the live map is one node for the page's life.
describe('the desk pair (WP4 chunk E)', () => {
  const STOP = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.9773, lat: 45.8131, routes: ['6', '11', '12'] };
  const factory = () => vi.fn((_options: CityMapOptions) => ({ update: vi.fn(), destroy: vi.fn(), pause: vi.fn(), resume: vi.fn() }));
  const kartaMaps = (mapFactory: ReturnType<typeof factory>) => mapFactory.mock.calls.filter(([o]) => o.container.dataset.testid === 'map-canvas');

  it('stands Sada and Karta side by side from the first draw, titled Sada, on its own stage, with Karta\'s one map and no band', async () => {
    const mapFactory = factory();
    const { root, session, handle } = mount({ wide: true, mapFactory });
    session.join();
    await flush();
    const dash = root.querySelector<HTMLElement>('.ki')!;
    expect(dash.dataset.stage).toBe('desk');
    const pair = root.querySelector<HTMLElement>('[data-testid=dash-view] > .ki-desk[data-key=desk]')!;
    expect(pair).not.toBeNull();
    expect([...pair.children].map((el) => el.id)).toEqual(['layer-grad-sada', 'layer-u-pokretu']);
    expect(pair.querySelector('[data-testid=sada-place]')).not.toBeNull();
    expect(pair.querySelector('[data-testid=transport-workspace]')).not.toBeNull();
    expect(pair.querySelector('[data-testid=transport-search]')).not.toBeNull();
    // The desk holds one map, Karta's: the phone's band is not drawn beside it.
    expect(pair.querySelector('[data-testid=sada-map-band]')).toBeNull();
    expect(kartaMaps(mapFactory)).toHaveLength(1);
    expect(mapFactory.mock.calls.some(([o]) => o.container.dataset.testid === 'sada-map-canvas')).toBe(false);
    expect(document.title).toBe('Kaj ima? · Sada');
    expect(text(root.querySelector('[data-testid=dash-title]'))).toBe('Kaj ima? · Sada');
    handle.destroy();
  });

  it('a poll and a switch between the two keep the same pair, the same workspace node and the same map', async () => {
    const mapFactory = factory();
    const { root, session, handle, tick } = mount({ wide: true, mapFactory });
    session.join();
    await flush();
    const pair = root.querySelector('.ki-desk')!;
    const sada = root.querySelector('#layer-grad-sada')!;
    const workspace = root.querySelector('[data-testid=transport-workspace]')!;
    const canvas = root.querySelector('[data-testid=map-canvas]')!;
    tick();
    await flush();
    expect(root.querySelector('.ki-desk')).toBe(pair);
    expect(root.querySelector('#layer-grad-sada')).toBe(sada);
    expect(root.querySelector('[data-testid=transport-workspace]')).toBe(workspace);
    expect(root.querySelector('[data-testid=map-canvas]')).toBe(canvas);
    handle.selectLayer('u-pokretu');
    await flush();
    expect(root.querySelector('.ki-desk')).toBe(pair);
    expect(root.querySelector('[data-testid=transport-workspace]')).toBe(workspace);
    expect(root.querySelector('[data-testid=map-canvas]')).toBe(canvas);
    expect(kartaMaps(mapFactory)).toHaveLength(1);
    expect(document.title).toBe('Kaj ima? · Sada');
    handle.selectLayer('grad-sada');
    await flush();
    expect(root.querySelector('[data-testid=transport-workspace]')).toBe(workspace);
    // Leaving the pair for a Još domain releases Karta's map; coming back draws a new one.
    handle.selectLayer('kultura');
    await flush();
    expect(root.querySelector('.ki-desk')).toBeNull();
    expect(root.querySelector('[data-testid=map-canvas]')).toBeNull();
    expect(mapFactory.mock.results[0]!.value.destroy).toHaveBeenCalledTimes(1);
    handle.destroy();
  });

  it('polls the modules of both halves while the pair is shown', async () => {
    const { session, fetchData, handle } = mount({ wide: true });
    session.join();
    await flush();
    const asked = new Set(fetchData.mock.calls.map((c) => c[0]));
    for (const module of ['zet-rt', 'prometnice', 'dogadanja', 'dhmz-now', 'glasnik']) expect(asked.has(module as ModuleId), module).toBe(true);
    handle.destroy();
  });

  it('Karta opened first (a reload, a saved link) asks for the place\'s boards itself, so U blizini leads with the departures without a visit to Sada (WP4 review)', async () => {
    const board = { operator: 'zet', stopId: STOP.id, stopName: STOP.name, status: 'live', generatedAt: new Date(NOW).toISOString(),
      departures: [4, 12, 25].map((m, i) => ({ operator: 'zet', tripId: `t${i}`, routeId: '6', routeName: '6', headsign: 'Črnomerec', at: new Date(NOW + m * 60_000).toISOString() })) };
    let landed = false;
    const cache = { get: vi.fn((_op: string, id: string) => (landed && id === STOP.id ? board : undefined)), ensure: vi.fn(), destroy: vi.fn() };
    const { root, session, handle } = mount({ deps: { createBoards: () => cache as never, location: { pathname: '/d/', search: '', hash: '#layer=u-pokretu' } } });
    session.join('scanner', { kind: 'venue', expiresAt: null, stop: STOP });
    await flush();
    // Karta alone is on the page: Sada never drew, so nothing but Karta could have asked.
    expect(root.querySelector('#layer-grad-sada')).toBeNull();
    expect(root.querySelector('[data-testid=transport-workspace]')).not.toBeNull();
    expect(cache.ensure).toHaveBeenCalledWith('zet', [STOP.id], expect.any(Function));
    const rows = () => root.querySelectorAll('[data-testid=transport-workspace] [data-testid=nearby] li.nearby-row[data-kind=departure]').length;
    expect(rows()).toBe(0);
    // The board lands: the repaint Karta asked for draws the departures at the head of the list.
    landed = true;
    (cache.ensure.mock.calls[0]![2] as () => void)();
    await flush();
    expect(rows()).toBeGreaterThanOrEqual(1);
    handle.destroy();
  });

  it('the phone keeps one layer at a time and the map stage for Karta', async () => {
    const { root, session, handle } = mount();
    session.join();
    await flush();
    expect(root.querySelector('.ki-desk')).toBeNull();
    expect(root.querySelector('#layer-u-pokretu')).toBeNull();
    handle.selectLayer('u-pokretu');
    await flush();
    expect(root.querySelector('.ki-desk')).toBeNull();
    expect(root.querySelector('#layer-grad-sada')).toBeNull();
    expect(root.querySelector<HTMLElement>('.ki')!.dataset.stage).toBe('map');
    expect(document.title).toBe('Kaj ima? · Karta');
    handle.destroy();
  });

  it('the pair\'s Karta repeats nothing Sada lists beside it: an idle sheet with the place and the circle in its peek, one U blizini on the page (round 2, desktop F3)', async () => {
    const { root, session, handle } = mount({ wide: true });
    session.join('scanner', { kind: 'venue', expiresAt: null, stop: STOP });
    await flush();
    const workspace = root.querySelector<HTMLElement>('[data-testid=transport-workspace]')!;
    expect(workspace.querySelector('[data-testid=nearby], [data-testid=nearby-pending], [data-kind=departure]'), 'no rows of its own beside Sada').toBeNull();
    expect(workspace.dataset.idle).toBe('true');
    expect(root.querySelectorAll('[data-testid=nearby]')).toHaveLength(1);
    expect(root.querySelector('#layer-grad-sada [data-testid=nearby]')).not.toBeNull();
    const peek = workspace.querySelector<HTMLElement>('[data-testid=transport-peek]')!;
    expect(text(peek.querySelector('strong'))).toBe(STOP.name);
    expect(text(peek.querySelector('.t-peek-pill'))).toMatch(/^\d+(,\d)? km · ~\d+ min$/);
    // Sada and Karta print one circle.
    expect(text(peek.querySelector('.t-peek-pill'))).toBe(text(root.querySelector('#layer-grad-sada [data-testid=nearby-head] .nearby-pill')));
    handle.destroy();
  });

  it('the screen\'s Kadar reaches the phone\'s circle: a frame of 8 widens the pill on both halves', async () => {
    const eight = mount({ wide: true });
    eight.session.join('scanner', { kind: 'venue', expiresAt: null, stop: STOP, frame: 8 });
    await flush();
    const pill = (root: HTMLElement) => text(root.querySelector('[data-testid=transport-workspace] .t-peek-pill'));
    // No stop table is loaded here, so the circle is the frame's fallback radius (shared/city/frame.ts FRAME_RADIUS_M).
    expect(pill(eight.root)).toBe('2,7 km · ~20 min');
    expect(text(eight.root.querySelector('#layer-grad-sada .nearby-pill'))).toBe('2,7 km · ~20 min');
    eight.handle.destroy();
    const six = mount({ wide: true });
    six.session.join('scanner', { kind: 'venue', expiresAt: null, stop: STOP });
    await flush();
    expect(pill(six.root)).toBe('2 km · ~15 min');
    six.handle.destroy();
  });

  it('widening a phone into a desk moves the live workspace into the pair without re-creating it', async () => {
    const mapFactory = factory();
    const listeners: (() => void)[] = [];
    const media = { matches: false, addEventListener: (_: 'change', fn: () => void) => { listeners.push(fn); }, removeEventListener: () => {} };
    const { root, session, handle } = mount({ mapFactory, deps: { matchMedia: () => media } });
    session.join();
    await flush();
    handle.selectLayer('u-pokretu');
    await flush();
    const workspace = root.querySelector('[data-testid=transport-workspace]')!;
    const canvas = root.querySelector('[data-testid=map-canvas]')!;
    expect(root.querySelector<HTMLElement>('.ki')!.dataset.stage).toBe('map');
    media.matches = true;
    for (const fn of listeners) fn();
    await flush();
    expect(root.querySelector<HTMLElement>('.ki')!.dataset.stage).toBe('desk');
    expect(root.querySelector('.ki-desk [data-testid=transport-workspace]')).toBe(workspace);
    expect(root.querySelector('.ki-desk [data-testid=map-canvas]')).toBe(canvas);
    expect(root.querySelector('.ki-desk #layer-grad-sada')).not.toBeNull();
    expect(kartaMaps(mapFactory)).toHaveLength(1);
    handle.destroy();
  });
});

describe('explicit casting (D5)', () => {
  const STOP = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.9773, lat: 45.8131, routes: ['6', '11', '12'] };
  const screen = { kind: 'venue' as const, expiresAt: null, stop: STOP };
  const state = (over: Partial<PresentationState> = {}): PresentationState => ({ version: 1, revision: 0, target: null, owner: null, expiresAt: null, status: 'idle', online: true, supported: true, ...over });

  it('keeps a single header control on every workspace and never broadcasts navigation', () => {
    const { root, session } = mount();
    session.join('scanner', screen);
    expect(root.querySelector('[data-testid=cast-fab]')).toBeNull();
    for (const layer of ['u-pokretu', 'kultura', 'grad-sada'] as const) {
      openViaMore(root, layer);
      expect(root.querySelectorAll('[data-testid=screen-control]')).toHaveLength(1);
      expect(root.querySelectorAll('[data-testid=share-city]')).toHaveLength(1);
    }
    expect(session.sent).toEqual([]);
    expect(session.presentations).toEqual([]);
    click(root, '[data-testid=screen-control]');
    expect(session.client.refreshPresentation).toHaveBeenCalled();
    expect(session.presentations).toEqual([]);
    click(root, '[data-testid=present-view]');
    expect(session.presentations).toHaveLength(1);
    expect(session.presentations[0]).toMatchObject({ version: 1, action: 'present', expectedRevision: 0, target: { layer: 'grad-sada' } });
    expect(text(root.querySelector('[data-testid=presentation-feedback]'))).toContain('Čekamo potvrdu');
    expect(text(root.querySelector('[data-testid=announce-polite]'))).not.toContain('Prikazano');
  });
  it('announces success only when the screen acknowledges the revision', () => {
    const { root, session } = mount();
    session.join('scanner', screen);
    click(root, '[data-testid=screen-control]');
    click(root, '[data-testid=present-view]');
    const request = session.presentations[0]!;
    session.presentation(state({ revision: 1, target: request.target!, owner: 'self', status: 'pending', expiresAt: EXPIRES }));
    expect(text(root.querySelector('[data-testid=presentation-feedback]'))).not.toContain('Prikazano');
    session.presentation(state({ revision: 1, target: request.target!, owner: 'self', status: 'displayed', expiresAt: EXPIRES }));
    expect(text(root.querySelector('[data-testid=presentation-feedback]'))).toBe('Prikazano na zaslonu.');
    expect(text(root.querySelector('[data-testid=announce-polite]'))).toBe('Prikazano na zaslonu.');
    click(root, '[data-testid=stop-presentation]');
    expect(session.presentations[1]).toMatchObject({ action: 'stop', expectedRevision: 1 });
    expect(session.presentations[1]).not.toHaveProperty('target');
  });
  it('keeps visible and announced feedback when a rendered subject disappears and recovers without another request', () => {
    const { root, session } = mount();
    session.join('scanner', screen);
    const shown = state({ revision: 1, target: { layer: 'kultura' }, owner: 'self', status: 'displayed', expiresAt: EXPIRES });
    session.presentation(shown);
    click(root, '[data-testid=screen-control]');
    session.presentation({ ...shown, status: 'unavailable' });
    expect(text(root.querySelector('[data-testid=presentation-feedback]'))).toBe('Odabrani sadržaj više nije dostupan.');
    expect(text(root.querySelector('[data-testid=announce-polite]'))).toBe('Odabrani sadržaj više nije dostupan.');
    session.presentation(shown);
    expect(text(root.querySelector('[data-testid=presentation-feedback]'))).toBe('Prikazano na zaslonu.');
    expect(text(root.querySelector('[data-testid=announce-polite]'))).toBe('Prikazano na zaslonu.');
    expect(session.presentations).toHaveLength(0);
  });
  it('the desk presents the selected event by public key, never its private browser state', async () => {
    const { root, session } = mount({ wide: true });
    session.join('scanner', screen);
    await flush();
    click(root, '[data-testid=status-more]');
    click(root, '[data-testid=dir-kultura]');
    await flush();
    click(root, '[data-testid=event-row] [data-action=select]');
    expect(session.sent).toEqual([]);
    click(root, '[data-testid=screen-control]');
    expect(text(root.querySelector('[data-testid=presentation-panel]'))).toContain('Koncert u parku');
    click(root, '[data-testid=present-view]');
    expect(session.presentations[0]!.target).toEqual({ layer: 'kultura', selection: { kind: 'item', id: expect.stringMatching(/^[0-9a-f]{16}$/), module: 'dogadanja' } });
  });
  it('the panel closes on Escape with the focus back on its control, and on a move to Jos or another layer; a selection inside the layer keeps it (round 2, desktop F6)', async () => {
    const { root, session, handle } = mount({ wide: true });
    session.join('scanner', screen);
    await flush();
    const panel = () => root.querySelector('[data-testid=presentation-panel]');
    click(root, '[data-testid=screen-control]');
    expect(panel()).not.toBeNull();
    expect(text(panel())).toContain('Ovaj pogled');
    expect(text(panel())).not.toContain('Želiš');
    root.querySelector<HTMLElement>('[data-testid=present-view]')!.focus();
    root.querySelector<HTMLElement>('.ki')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel()).toBeNull();
    expect(root.querySelector('[data-testid=screen-control]')!.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(root.querySelector('[data-testid=screen-control]'));
    // Escape with the panel shut is left to the rest of the page: Jos opened after it still closes on the next one.
    click(root, '[data-testid=screen-control]');
    click(root, '[data-testid=status-more]');
    expect(panel()).toBeNull();
    click(root, '[data-testid=status-more]');
    click(root, '[data-testid=screen-control]');
    click(root, '[data-testid=status-more]');
    expect(panel()).toBeNull();
    click(root, '[data-testid=dir-kultura]');
    await flush();
    click(root, '[data-testid=screen-control]');
    click(root, '[data-testid=event-row] [data-action=select]');
    expect(text(panel())).toContain('Koncert u parku');
    // Back to another layer (the browser's Back): the panel offered the view that has gone, so it closes.
    handle.restore('#room=r1&layer=grad-sada');
    expect(panel()).toBeNull();
  });
  it('does not offer public-screen controls to a peer or a session without a screen', () => {
    const noScreen = mount();
    noScreen.session.join();
    expect(noScreen.root.querySelector('[data-testid=screen-control]')).toBeNull();
    noScreen.handle.destroy();
    const peer = mount();
    peer.session.join('phone', screen);
    expect(peer.root.querySelector('[data-testid=screen-control]')).toBeNull();
    expect(peer.session.presentations).toEqual([]);
    peer.handle.destroy();
  });
  it('the end closes the presentation panel and disables presenting; the content is gone with it', () => {
    const { root, session } = mount();
    session.join('scanner', screen);
    click(root, '[data-testid=screen-control]');
    expect(root.querySelector('[data-testid=presentation-panel]')).not.toBeNull();
    session.expire();
    expect(root.querySelector('#layer-grad-sada')).toBeNull();
    expect(root.querySelector('[data-testid=session-ended]')).not.toBeNull();
    expect(root.querySelector('[data-testid=presentation-panel]')).toBeNull();
    // Opened again after the end, the panel says why nothing can be presented.
    click(root, '[data-testid=screen-control]');
    expect(root.querySelector<HTMLButtonElement>('[data-testid=present-view]')!.disabled).toBe(true);
    expect(text(root.querySelector('[data-testid=presentation-feedback]'))).toContain('Sesija je završila');
    click(root, '[data-testid=present-view]');
    expect(session.presentations).toEqual([]);
  });
  it('requires confirmation before taking over and binds that confirmation to the observed revision', () => {
    const { root, session } = mount();
    session.join('scanner', screen);
    session.presentation(state({ revision: 4, owner: 'other', target: { layer: 'kultura' }, expiresAt: EXPIRES, status: 'displayed' }));
    click(root, '[data-testid=screen-control]');
    click(root, '[data-testid=present-view]');
    expect(session.presentations).toEqual([]);
    expect(text(root.querySelector('.present-confirm'))).toContain('zamijeniti prikaz druge osobe');
    session.presentation(state({ revision: 5, owner: 'other', target: { layer: 'sigurnost' }, expiresAt: EXPIRES, status: 'displayed' }));
    click(root, '[data-action=present-confirm]');
    expect(session.presentations[0]).toMatchObject({ takeover: true, expectedRevision: 4 });
    session.result({ requestId: session.presentations[0]!.requestId, state: state({ revision: 5 }), error: 'changed' });
    expect(text(root.querySelector('[data-testid=presentation-feedback]'))).toContain('Prikaz na zaslonu se promijenio');
  });
  it('reports an unconfirmed request after eight seconds and retries with the same request id', () => {
    let clock = NOW;
    const { root, session, tick } = mount({ now: () => clock });
    session.join('scanner', screen);
    click(root, '[data-testid=screen-control]');
    click(root, '[data-testid=present-view]');
    clock += 8100;
    tick();
    expect(text(root.querySelector('[data-testid=presentation-feedback]'))).toContain('Prikaz nije potvrđen');
    click(root, '[data-action=present-retry]');
    expect(session.presentations).toHaveLength(2);
    expect(session.presentations[1]).toEqual(session.presentations[0]);
  });
  it('save and unsave bubble from any workspace control into the saved store, which persists them', () => {
    const { root } = mount();
    // Probes on the shell root itself, which no region repaint reconciles away; the detail head's own buttons are T2.7's.
    const shell = root.querySelector<HTMLElement>('.ki')!;
    shell.insertAdjacentHTML('beforeend', '<button type="button" data-action="save" data-kind="route" data-id="6" data-testid="probe-save"></button><button type="button" data-action="unsave" data-kind="route" data-id="6" data-testid="probe-unsave"></button>');
    click(root, '[data-testid=probe-save]');
    expect(JSON.parse(localStorage.getItem(SAVED_STORAGE_KEY) ?? 'null')).toEqual([{ kind: 'route', id: '6' }]);
    click(root, '[data-testid=probe-unsave]');
    expect(JSON.parse(localStorage.getItem(SAVED_STORAGE_KEY) ?? 'null')).toEqual([]);
  });
});


describe('the desktop directory (D10)', () => {
  it('the desk lists the same four domains under Još as the phone, the week’s agenda first with its count line, and has no tab bar and no domain bar', async () => {
    const today = { id: 'kp:3', module: 'dogadanja' as const, kind: 'event' as const, tier: 'session' as const, title: 'Večer poezije', at: '2026-09-11T17:00:00Z', dateBasis: 'event' as const, data: { source: 'kulturpunkt', category: 'knjizevnost', precision: 'time' } };
    const running = { id: 'kp:4', module: 'dogadanja' as const, kind: 'event' as const, tier: 'session' as const, title: 'Izložba plakata', at: '2026-09-09T08:00:00Z', until: '2026-09-20T18:00:00Z', dateBasis: 'event' as const, data: { source: 'kulturpunkt', category: 'izlozba', precision: 'range' } };
    const { root, session } = mount({ wide: true, snapshot: (module) => module === 'dogadanja' ? base('dogadanja', [...FIXTURE.dogadanja!.items, today, running]) : snapshotOf(module) });
    session.join();
    await flush();
    expect(root.querySelector('[data-testid=tab-more]')).toBeNull();
    const more = click(root, '[data-testid=status-more]');
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(more.getAttribute('aria-current')).toBe('page');
    expect(root.querySelector('#layer-directory')).not.toBeNull();
    await flush();
    expect([...root.querySelectorAll('.dir-item[data-layer]')].map((a) => a.getAttribute('data-layer'))).toEqual(['kultura', 'zrak-i-nebo', 'uprava-i-pravo', 'sigurnost']);
    expect(root.querySelector('[data-testid=saved-section]')).not.toBeNull();
    expect(root.querySelector('.ki-domains')).toBeNull();
    // Three dated starts this week (today's evening one included) and one exhibition running: the page's own count line.
    expect(text(root.querySelector('[data-testid=dir-kultura] .row-title'))).toBe('Događanja ovaj tjedan');
    expect(text(root.querySelector('[data-testid=dir-kultura] .row-sub'))).toBe('3 događanja · 1 u tijeku');
    click(root, '[data-testid=dir-kultura]');
    expect(root.querySelector('#layer-kultura')).not.toBeNull();
    // The row and the page count the same things.
    expect(text(root.querySelector('[data-testid=ev-count]'))).toContain('3 događanja · 1 u tijeku');
    expect(root.querySelector('[data-testid=status-more]')?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('the place’s last departures (T3.1, FEED_LASTRUN)', () => {
  const SCREEN = { kind: 'venue' as const, expiresAt: null, stop: { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.9773, lat: 45.8131, routes: ['6', '11', '12'] } };
  const snapshot: LastRunSnapshot = {
    status: 'live', fetchedAt: '2026-09-11T12:00:00Z', sourceUpdatedAt: '2026-09-10T03:00:00Z', validUntil: '2026-10-02T04:00:00Z',
    // Lines that stop early at this stop today: at 14:32 their last trams are within four hours, so U blizini lists them as one row.
    routes: { '6': { '2026-09-11': '18:20' }, '11': { '2026-09-11': '18:05' }, '12': { '2026-09-11': '17:45' } },
  };
  const lastRows = (root: Root): HTMLElement[] => [...(root as ParentNode).querySelectorAll<HTMLElement>('[data-testid=nearby] li.nearby-row[data-kind=last]')];

  it('loads the file of the stop the place boards once and threads it into one U blizini row, no second load on a poll', async () => {
    const loadLastRun = vi.fn(async () => snapshot);
    const { root, session, tick } = mount({ deps: { loadLastRun } });
    expect(loadLastRun).not.toHaveBeenCalled();
    session.join('scanner', SCREEN);
    await flush();
    expect(loadLastRun).toHaveBeenCalledTimes(1);
    expect(loadLastRun).toHaveBeenCalledWith('106_1');
    const rows = lastRows(root);
    expect(rows).toHaveLength(1);
    expect(text(rows[0]!.querySelector('.nearby-title'))).toBe('Zadnji tramvaji');
    expect(text(rows[0]!.querySelector('.nearby-sub'))).toBe('12 17:45 · 11 18:05 · 6 18:20');
    expect(rows[0]!.querySelector('time.nearby-when')?.getAttribute('datetime')).toBe('2026-09-11T15:45:00.000Z');
    tick();
    await flush();
    expect(loadLastRun).toHaveBeenCalledTimes(1);
    expect(lastRows(root)).toHaveLength(1);
  });

  it('asks nothing while no stop is within reach of the place: no screen stop, and a catalogue without one near Trg bana J. Jelačića', async () => {
    // This file's loadStops answers an empty catalogue, so the default place has no platform within 800 m.
    const loadLastRun = vi.fn(async () => snapshot);
    const { session } = mount({ deps: { loadLastRun } });
    session.join('scanner', { kind: 'venue', expiresAt: null, stop: null });
    await flush();
    expect(loadLastRun).not.toHaveBeenCalled();
  });

  it('a stop without a file, or a down answer, leaves the row absent and the list whole', async () => {
    for (const answer of [null, { status: 'down' as const, fetchedAt: '2026-09-11T12:00:00Z' }]) {
      const { root, session } = mount({ deps: { loadLastRun: vi.fn(async () => answer) } });
      session.join('scanner', SCREEN);
      await flush();
      expect(lastRows(root)).toHaveLength(0);
      expect(root.querySelectorAll('[data-testid=nearby] li.nearby-row').length).toBeGreaterThan(0);
    }
  });
});
