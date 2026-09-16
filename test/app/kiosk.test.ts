// @vitest-environment happy-dom
// The kiosk controller with every dependency faked: the setup wizard, the
// invitation (one field, one column, one map), codes, the paired
// compositions, expiry and revocation, the basics panel, alerts, polling and
// disposal. say.ts is mocked at its contract (global constraints, contracts 4
// and 5): the ranker and the markup are area P2's; what is proven here is
// that the controller hands them the right input on the right beats and
// reconciles what they return.
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
import { CODE_SWAP_MS, CODE_TICK_MS, ESSENTIALS_IDLE_MS, mountKiosk, REFRESH_MS, type KioskDeps } from '../../app/src/kiosk';
import { FIELD_DESIGN_WIDTH, SAY_BADGE_CAP, SAY_SLOTS, SAY_VALUE_CHARS } from '../../app/src/kiosk/layout';
import { FIELD_SPAN_M, fieldZoom, HANDHELD_SPAN_M, KIOSK_EMPHASIS } from '../../app/src/kiosk/mapview';
import type { SayInput, Slot, Statement } from '../../app/src/kiosk/say';
import type * as SayModule from '../../app/src/kiosk/say';
import { POLL_FALLBACK_MS } from '../../app/src/motion/loop';
import { THEME_PREFERENCES, type ThemeController, type ThemePreference } from '../../app/src/ui/theme';

const say = vi.hoisted(() => ({ rank: vi.fn(), markup: vi.fn() }));
// The ranker and the markup are faked at their contract; everything else say.ts exports (SAY_KINDS, which layout.ts sizes the handheld's "all" from) is the real thing.
vi.mock('../../app/src/kiosk/say', async (importOriginal) => ({ ...(await importOriginal<typeof SayModule>()), rankStatements: say.rank, sayMarkup: say.markup }));
const realSay = await vi.importActual<typeof SayModule>('../../app/src/kiosk/say');

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb
const STOP = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '11', '12', '13', '14', '17', '31', '32', '34'] };
const STOPS = [STOP, { id: '106_2', name: 'Trg bana J. Jelačića', lon: 15.9779, lat: 45.81286, routes: ['6', '11'] }, { id: '200_1', name: 'Zapruđe', lon: 15.99, lat: 45.77, routes: ['7'] }];
const SCREEN: ScreenMetadata = { kind: 'temporary', expiresAt: NOW + 20 * 3_600_000, stop: STOP };
const STORED = JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna', screen: SCREEN });
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
    item('zet-rt', 'route:6', 'vehicle', '6', { data: { routeId: '6', routeShortName: '6', medianDelaySeconds: 130, vehicles: 12 } }),
  ]),
  snap('emsc', [item('emsc', 'q1', 'quake', 'Potres', { at: '2026-09-11T10:11:00Z', data: { mag: 1.6, depth: 10, region: 'CROATIA' } })]),
  snap('dogadanja', [item('dogadanja', 'skupstina:13', 'event', '13. sjednica Gradske skupštine', { at: '2026-09-17T07:00:00Z', dateBasis: 'event', data: { source: 'skupstina', precision: 'time' } })]),
  snap('ckan-geo', [item('ckan-geo', 'p1', 'poi', 'Ljekarna Centar, Ilica 1', { data: { category: 'ljekarne' } })]),
];
const CODE_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function batch(start: number, count = 20): CodeSlot[] {
  return Array.from({ length: count }, (_, i) => ({ code: `ABCDEFG${CODE_CHARS[i]}`, slotStart: start + i * 30_000, slotEnd: start + (i + 1) * 30_000 }));
}

/** A statement in the contract's shape (contract 5), the transit kind by default. */
function statement(key: string, value: string, over: Partial<Statement> = {}): Slot {
  return { key, statement: { key, domain: 'transit', say: 'transit', weight: 100, label: 'Promet', value, aria: value, ...over } };
}
/** The contract-4 markup for a set of slots, as say.ts writes it: a keyed article, the value with its crossfade signature. */
function sayHtml(slots: readonly Slot[]): string {
  return slots.map(({ statement: st }) =>
    `<article class="k-say" data-key="${st.key}" data-domain="${st.domain}" data-testid="kiosk-say" data-say="${st.say}">`
    + `<p class="k-say-label"><span class="k-say-kicker">${st.label}</span>${st.badgesMarkup ?? ''}</p>`
    + `<p class="k-say-value" data-replace data-sig="${st.value}">${st.value}</p>${st.context ? `<p class="k-say-context">${st.context}</p>` : ''}</article>`).join('');
}
/** The last SayInput the ranker received. */
const lastInput = (): SayInput => say.rank.mock.calls.at(-1)![0] as SayInput;

beforeEach(() => {
  // By default the ranker has nothing to say and the markup is the real one, so a loading column shows say.ts's own skeleton (contract 5) and a loaded one nothing.
  say.rank.mockReset().mockImplementation(() => []);
  say.markup.mockReset().mockImplementation(realSay.sayMarkup);
});

interface Timer { fn: () => void; ms: number; cleared: boolean }
type MountOptions = Partial<Pick<KioskDeps, 'hash' | 'reducedMotion' | 'lightweight' | 'fetchTeaser' | 'mapFactory' | 'createScreen' | 'loadStops' | 'viewport' | 'locale' | 'now' | 'i18n' | 'codeBase' | 'loadLastRun'>> & { stored?: string | null; themeInitial?: ThemePreference } & { modules?: ModuleSnapshot[] };

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

function mount(opts: MountOptions = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const raw: Record<string, string> = {};
  if (opts.stored) raw[BEACON_STORAGE_KEY] = opts.stored;
  const storage = { getItem: (k: string) => raw[k] ?? null, setItem: (k: string, v: string) => { raw[k] = v; }, removeItem: (k: string) => { delete raw[k]; } };
  const beacon = { connect: vi.fn(), requestMore: vi.fn(), status: () => 'live' as const, close: vi.fn() };
  let handlers: Parameters<NonNullable<KioskDeps['createBeacon']>>[0] | null = null;
  const timers: Timer[] = [];
  const sessions: { close: ReturnType<typeof vi.fn> }[] = [];
  let sessionExpired: (() => void) | null = null;
  let sessionView: ((layer: string, params?: Record<string, string>) => void) | null = null;
  let secondsLeft = 600;
  const modules = opts.modules ?? MODULES;
  const fetchData = vi.fn(async (module: ModuleId) => modules.find((m) => m.module === module) ?? snap(module, []));
  const createScreen = opts.createScreen ?? vi.fn(async () => ({ beaconId: 'NEW00001', secret: 'nova', provisionUrl: 'https://zagreb.aningfilm.hr/kiosk/#NEW00001.nova', screen: SCREEN }));
  const loadStops = opts.loadStops ?? vi.fn(async () => STOPS);
  /** The stop's last-departure table: none by default (the stop is not in the generated set), so nothing reaches the wire from here. */
  const loadLastRun = opts.loadLastRun ?? vi.fn(async () => null);
  const requestFullscreen = vi.fn(async () => {});
  const requestWakeLock = vi.fn(async () => {});
  /** The theme-or-resize listener the controller registers; a test fires it after mutating its viewport object. */
  let repaint: (() => void) | null = null;
  const themeFake = fakeThemeController(opts.themeInitial ?? 'solar');
  const handle = mountKiosk(root, {
    i18n: opts.i18n ?? createDefaultI18n('hr'), hash: opts.hash ?? '', storage, now: opts.now ?? (() => NOW), codeBase: opts.codeBase ?? 'https://zagreb.aningfilm.hr',
    onRepaint: (listener) => { repaint = listener; return () => { repaint = null; }; },
    reducedMotion: opts.reducedMotion ?? false, lightweight: opts.lightweight ?? false, viewport: opts.viewport ?? { width: 1920, height: 1080 }, locale: opts.locale,
    fetchTeaser: opts.fetchTeaser ?? (async () => ({ modules })), loadNetwork: async () => null, mapFactory: opts.mapFactory, fetchData, createScreen, loadStops, loadLastRun,
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

describe('setup: two real steps, one creation per press', () => {
  it('opens the wizard when nothing is provisioned, without touching the beacon; the strip is already there', () => {
    const k = mount();
    expect(k.handle.phase()).toBe('setup');
    expect(q(k.root, '[data-testid=kiosk-setup]')).not.toBeNull();
    expect(text(q(k.root, '[data-testid=setup-step]'))).toBe('Korak 1 od 2');
    expect(k.root.querySelectorAll('input[name=district]')).toHaveLength(17);
    expect((q(k.root, 'input[name=district][value=donji-grad]') as HTMLInputElement).checked).toBe(true);
    expect(k.beacon.connect).not.toHaveBeenCalled();
    expect(q(k.root, '[data-testid=kiosk-essentials-open]')).toBeNull(); // the verdict is a plain word while the wizard or a session owns the screen
    expect(q(k.root, 'span.k-strip-verdict[data-testid=strip-verdict]')).not.toBeNull();
    expect(text(q(k.root, '[data-testid=safety-strip]'))).toContain('Sigurnost');
    expect(q(k.root, '[data-testid=kiosk-alert]')!.hidden).toBe(true);
  });
  it('step two lists stops nearest the district seat with 106_1 chosen, searches by name, creates the screen once and boots the beacon', async () => {
    const k = mount({ createScreen: vi.fn(async () => ({ beaconId: 'NEW00001', secret: 'S3CR3TXYZ', provisionUrl: 'https://zagreb.aningfilm.hr/kiosk/#NEW00001.S3CR3TXYZ', screen: SCREEN })) });
    q(k.root, '[data-testid=setup-next]')!.click();
    await flush();
    expect(k.loadStops).toHaveBeenCalledTimes(1);
    expect(text(q(k.root, '[data-testid=setup-step]'))).toBe('Korak 2 od 2');
    expect((q(k.root, 'input[name=stop]:checked') as HTMLInputElement).value).toBe('106_1');
    expect(text(q(k.root, '[data-testid=setup-summary]'))).toBe('Trg bana J. Jelačića · Donji grad');
    const search = q(k.root, '[data-testid=setup-search]') as HTMLInputElement;
    search.value = 'zapr';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(k.root.querySelectorAll('input[name=stop]')).toHaveLength(1);
    expect(text(q(k.root, '[data-testid=setup-stop-count]'))).toBe('1 stanica');
    const zaprude = q(k.root, 'input[name=stop][value=200_1]') as HTMLInputElement;
    zaprude.checked = true;
    zaprude.dispatchEvent(new Event('change', { bubbles: true }));
    expect(text(q(k.root, '[data-testid=setup-summary]'))).toBe('Zapruđe · Donji grad');
    submit(k.root);
    await flush();
    expect(k.createScreen).toHaveBeenCalledTimes(1);
    expect(k.createScreen).toHaveBeenCalledWith({ area: 'donji-grad', stopId: '200_1' });
    expect(k.handle.phase()).toBe('invitation');
    expect(JSON.parse(k.raw[BEACON_STORAGE_KEY]!)).toEqual({ beaconId: 'NEW00001', secret: 'S3CR3TXYZ', screen: SCREEN });
    expect(k.beacon.connect).toHaveBeenCalledTimes(1);
    expect(k.root.innerHTML).not.toContain('S3CR3TXYZ');
    expect(q(k.root, '[data-testid=kiosk-setup]')).toBeNull();
  });
  it('a 403 ends in the refused-connection sentence with no retry, a 429 counts its retry down, a network failure offers one; nothing loops', async () => {
    const attempts: unknown[] = [new ScreenError('evaluation-access-required', 403), new ScreenError('screen-limit', 429, 90), new TypeError('Failed to fetch')];
    const createScreen = vi.fn(async () => { throw attempts.shift(); });
    const k = mount({ createScreen });
    q(k.root, '[data-testid=setup-next]')!.click();
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
  it('a stop list that fails to load is one sentence and one retry button', async () => {
    const loadStops = vi.fn(async () => { throw new Error('stops-unavailable'); });
    const k = mount({ loadStops });
    q(k.root, '[data-testid=setup-next]')!.click();
    await flush();
    expect(text(q(k.root, '[data-testid=setup-error]'))).toBe('Popis stanica nije dostupan.');
    expect(text(q(k.root, '[data-testid=setup-step]'))).toBe('Korak 1 od 2');
    expect(q(k.root, '[data-testid=setup-retry]')!.hidden).toBe(false);
    expect(loadStops).toHaveBeenCalledTimes(1);
  });
});

describe('invitation: the screen a passer-by sees', () => {
  it('boots the beacon from stored credentials and composes the stop context, one field with its map host, the column of statements over the card, the header weather and the strip', async () => {
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
    // The column: the statements, then the card; no chapters, no rail, no tiles, no dots anywhere.
    const column = q(k.root, '[data-testid=kiosk-invitation] .k-column')!;
    expect(column.tagName).toBe('ASIDE');
    expect([...column.children].map((el) => (el as HTMLElement).dataset.testid)).toEqual(['kiosk-says', 'kiosk-invite']);
    expect(q(column, '[data-testid=kiosk-says]')!.getAttribute('aria-live')).toBe('off');
    for (const gone of ['kiosk-scene', 'kiosk-scene-meta', 'kiosk-tiles', 'tile-vehicles', 'tile-closures', 'kiosk-tonight', 'kiosk-city', 'k-city-ink']) expect(q(k.root, `[data-testid=${gone}]`), gone).toBeNull();
    for (const gone of ['.k-scene', '.k-rail', '.k-side-tiles', '.k-dot', '.k-scene-head']) expect(q(k.root, gone), gone).toBeNull();
    expect(text(q(k.root, '[data-testid=kiosk-weather]'))).toContain('21 °C');
    // One element per testid on the whole screen: the header's group is the only weather (D11; T2.8 report, Ruling 5).
    expect(k.root.querySelectorAll('[data-testid=kiosk-weather]')).toHaveLength(1);
    expect(k.root.querySelectorAll('[data-testid=kiosk-temp]')).toHaveLength(1);
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
    expect(link.getAttribute('href')).toBe('https://zagreb.aningfilm.hr/s#ABCD-EFG0');
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
  it('nothing rotates (R-KP1, R-KP11): the two ticks at mount are the 1 s clock and the 20 s paired refresh, the strip counts nothing down, and twenty seconds change nothing on the invitation', async () => {
    const k = mount({ stored: STORED });
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
    expect(text(board)).toContain('kasni 2 min');
    expect(k.root.querySelectorAll('canvas')).toHaveLength(0);
    expect(q(k.root, '[data-testid=kiosk-says]')).not.toBeNull();
    expect(say.rank).toHaveBeenCalled();
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
    expect(q(k.root, '[data-testid=kiosk-layer] [data-testid=kiosk-map-host]')).not.toBeNull();
    const label = q(k.root, '[data-testid=session-label]')!;
    expect(label.dataset.expiresAt).toBe(String(NOW + 600_000));
    expect(text(label)).toBe('Otključano do 14:42 · Sada');
    expect(q(k.root, '[data-testid=corner-qr] .qr')).not.toBeNull();
    expect(text(q(k.root, '[data-testid=join-code]'))).toBe('ABCD-EFG0');
    expect(q(k.root, '[data-testid=kiosk-essentials-open]')).toBeNull(); // the verdict is a plain word while the wizard or a session owns the screen
    expect(q(k.root, 'span.k-strip-verdict[data-testid=strip-verdict]')).not.toBeNull();
    // The weather is the header's status group; the Sada column holds the warnings and the closures only.
    expect(text(q(k.root, '[data-testid=kiosk-weather]'))).toContain('21 °C');
    expect(q(k.root, '[data-testid=kiosk-layer] [data-testid=k-weather]')).toBeNull();
    expect(text(q(k.root, '[data-testid=k-warnings]'))).toContain('Grmljavina');
    expect(k.fetchData).toHaveBeenCalled();
    expect(q(k.root, '[data-testid=kiosk-invitation]')).toBeNull();
  });
  it('on a calm day the Sada column gives the closures the whole column and shows no warnings block: green notices stay one line on the strip', async () => {
    const calm = MODULES.map((m) => (m.module === 'dhmz-cap' ? snap('dhmz-cap', [item('dhmz-cap', 'w1', 'warning', 'Zeleno upozorenje za vjetar', { severity: 'minor' })]) : m));
    const k = await pairedKiosk({ modules: calm });
    expect(q(k.root, '[data-testid=kiosk-layer]')!.dataset.layer).toBe('grad-sada');
    expect(q(k.root, '[data-testid=k-warnings]')).toBeNull();
    expect(q(k.root, '[data-testid=k-closures]')).not.toBeNull();
    expect(text(q(k.root, '[data-testid=strip-verdict]'))).toBe('mirno');
  });
  it('under a yellow warning the wide Sada column holds the warnings beside the closures', async () => {
    const k = await pairedKiosk();
    expect(q(k.root, '[data-testid=k-warnings]')).not.toBeNull();
    expect(q(k.root, '[data-testid=k-closures]')).not.toBeNull();
  });
  it('under a yellow warning the compact Sada column shows the warnings alone; the strip carries no closures cell', async () => {
    const k = await pairedKiosk({ viewport: { width: 1366, height: 768 } });
    expect(q(k.root, '[data-testid=kiosk]')!.dataset.size).toBe('compact');
    expect(q(k.root, '[data-testid=k-warnings]')).not.toBeNull();
    expect(q(k.root, '[data-testid=k-closures]')).toBeNull();
    expect(q(k.root, '[data-testid=strip-closures]')).toBeNull();
  });
  it('mirrors each of the six domains with its own blocks; the join QR survives every layer change', async () => {
    const k = await pairedKiosk();
    const expectations: [string, string[]][] = [
      ['u-pokretu', ['k-delays', 'kiosk-map-host']],
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
      expect(q(k.root, '[data-testid=corner-qr] .qr'), layer).not.toBeNull();
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
    expect(route).toContain('kasni 2 min');
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
    expect(q(k.root, '[data-testid=corner-qr] .qr')).toBeNull();
    expect(text(q(k.root, '[data-testid=join-code]'))).toBe('Otvorena sesija traje do svog kraja; zaslon zatim prestaje izdavati kodove.');
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
    q(k.root, '[data-testid=setup-next]')!.click();
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
  it('a cold screen waits for readings: the column shows one skeleton statement while zet-rt has not answered, and no weather', async () => {
    const k = mount({ stored: STORED, fetchTeaser: () => new Promise(() => {}) });
    await flush();
    // say.ts's skeleton (contract 5) stands until the ranker has something to say; the composition adds no fallback of its own (R-KP23).
    const skeleton = q(k.root, '[data-testid=kiosk-says] article.k-say[data-skeleton]')!;
    expect(skeleton).not.toBeNull();
    expect(skeleton.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton.querySelectorAll('.sk')).toHaveLength(3);
    expect(text(q(k.root, '[data-testid=kiosk-says]'))).toBe('');
    expect(lastInput().modules).toEqual([]);
    expect(q(k.root, '[data-testid=kiosk-weather]')!.hidden).toBe(true);
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
    // The ranker is told, source by source: the last-good copies are stale, and the field is still one field with its map.
    expect(lastInput().modules.map((m) => m.status)).toEqual(MODULES.map(() => 'stale'));
    expect(q(k.root, '[data-testid=kiosk-weather] .k-chip--stale')).not.toBeNull();
    expect(q(k.root, '[data-testid=kiosk-live] [data-testid=kiosk-map]')).not.toBeNull();
    fail = false;
    k.poll();
    await flush();
    expect(calls.at(-1)).toBe('live');
    expect(lastInput().modules.map((m) => m.status)).toEqual(MODULES.map(() => 'live'));
    expect(q(k.root, '[data-testid=kiosk-alert]')!.hidden).toBe(true);
  });
  it('a fetch that never succeeded reads as down once it fails: unknown, not loading and never clear', async () => {
    const k = mount({ stored: STORED, fetchTeaser: async () => { throw new Error('down'); } });
    await flush();
    expect(text(q(k.root, '[data-testid=strip-warning]'))).toBe('Upozorenja DHMZ-a: podaci trenutačno nedostupni');
    // Every module the teaser would carry is handed to the ranker as down (never absent, which would read as loading), and the column shows no skeleton.
    const input = lastInput();
    expect(input.modules.length).toBeGreaterThan(0);
    expect(input.modules.every((m) => m.status === 'down')).toBe(true);
    expect(q(k.root, '[data-testid=kiosk-says] [data-skeleton]')).toBeNull();
    // The clock stands alone (D11): no sentence and no dash where the reading was.
    expect(q(k.root, '[data-testid=kiosk-weather]')!.hidden).toBe(true);
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
    expect(text(q(k.root, '[data-testid=k-delays]'))).toContain('zastarjelo');
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
    expect(q(k.root, '[data-testid=k-delays]')!.dataset.status).toBe('live');
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
    // Parked while the composition changed, then re-parented into the paired map column.
    const resize = map.calls.lastIndexOf('resize');
    expect(resize).toBeGreaterThan(before);
    expect(map.calls.slice(before, resize)).toEqual(['pause', 'feed:stale']); // parked, then told from the teaser on the paired paint
    expect(map.calls.slice(resize, resize + 3)).toEqual(['resize', 'resume', 'feed:stale']);
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
    expect(text(q(k.root, '[data-testid=kiosk-weather]'))).toContain('21 °C');
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
  it('speaks English when the page does, and hands the ranker the page\u2019s locale', async () => {
    const k = mount({ stored: STORED, locale: 'en' });
    await flush();
    expect(text(q(k.root, '.k-lead'))).toBe('Scan for 10 minutes of the city.');
    expect(lastInput().locale).toBe('en');
    expect(lastInput().strings.lines.title).toBe('Lines from this stop');
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

// The invitation composed (plan "Frame", R-KP1, R-KP5): one field, one column
// of statements over the card, the header's weather group, the strip.
describe('the invitation composition: the card, the header group, the strip', () => {
  it('orders the column statements then card; the header carries the weather group with the condition icon, the reading and the sun time; the card is lead, QR, hint, code', async () => {
    const k = mount({ stored: STORED });
    await flush();
    const column = q(k.root, '[data-testid=kiosk-invitation] .k-column')!;
    expect([...column.children].map((el) => (el as HTMLElement).dataset.testid)).toEqual(['kiosk-says', 'kiosk-invite']);
    const weather = q(k.root, '.k-head .k-clock-row [data-testid=kiosk-weather]')!;
    expect(weather.hidden).toBe(false);
    expect(weather.dataset.state).toBe('live');
    expect(q(weather, '.k-weather-icon use')!.getAttribute('href')).toBe('#icon-sun'); // 'vedro'
    expect(text(q(weather, '[data-testid=kiosk-temp]'))).toBe('21 °C');
    expect(text(q(weather, '.k-sun time'))).toMatch(/^\d\d:\d\d$/);
    expect(q(weather, '.k-weather-details')).toBeNull();
    expect(q(weather, '.k-kicker')).toBeNull();
    expect(q(k.root, '[data-testid=strip-sun]')).toBeNull();
    const card = q(k.root, '[data-testid=kiosk-invite]')!;
    expect(q(card, '.k-support')).toBeNull();
    expect(q(card, '.k-invite-text')).toBeNull();
    expect(text(q(card, 'h1.k-lead'))).toBe('Skeniraj za 10 minuta grada.');
    // The typed address is whole: it may break at its dots beside the QR (kiosk.css), never ellipsise.
    expect(text(q(card, '.k-hint-host'))).toBe('zagreb.aningfilm.hr/s');
    expect(q(card, '.k-hint-host')!.querySelectorAll('wbr').length).toBeGreaterThan(0);
    expect(text(q(card, '.k-hint'))).toBe('ili upiši kod na zagreb.aningfilm.hr/s');
    // The card's four areas in order: the lead across, the QR beside the hint, the code and its bar across.
    expect([...card.children].map((el) => el.className)).toEqual(['k-lead', 'k-qr', 'k-hint', 'k-invite-code']);
    expect(q(card, '.k-invite-code [data-testid=pair-code]')).not.toBeNull();
    expect(q(card, '.k-invite-code [data-testid=code-progress] .k-progress-bar')).not.toBeNull();
    // One h1 on the screen (the card's lead); the field is a labelled section, not a headed one.
    expect(k.root.querySelectorAll('h1')).toHaveLength(1);
    expect(k.root.querySelectorAll('[data-testid=kiosk-invitation] h2')).toHaveLength(0);
  });
  it('DHMZ down: the header weather group hides, the clock stands alone and no dash stands in for the reading', async () => {
    const down = MODULES.map((m) => (m.module === 'dhmz-now' ? snap('dhmz-now', [], 'down') : m));
    const k = mount({ stored: STORED, fetchTeaser: async () => ({ modules: down }) });
    await flush();
    const weather = q(k.root, '[data-testid=kiosk-weather]')!;
    expect(weather.hidden).toBe(true);
    expect(text(weather)).toBe('');
    expect(weather.dataset.state).toBeUndefined();
    expect(text(q(k.root, '[data-testid=kiosk-clock]'))).toBe('14:32');
    const head = text(q(k.root, '.k-head'));
    expect(head).not.toMatch(/[\u2013\u2014]|(^|\s)-(\s|$)/);
    expect(head).not.toContain('°C');
    expect(head).not.toContain('DHMZ');
    expect(q(k.root, '[data-testid=kiosk-temp]')).toBeNull();
    // The rest of the screen is unaffected: the strip still speaks and the ranker still hears every module.
    expect(text(q(k.root, '[data-testid=safety-strip]'))).toContain('Grmljavina');
    expect(lastInput().modules.find((m) => m.module === 'dhmz-now')?.status).toBe('down');
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
    const board = q(k.root, '[data-testid=k-delays]')!;
    const rows = [...board.querySelectorAll<HTMLElement>('.k-row')];
    // Nine lines at the stop, then the five deviations (600, 500, 400, 300, 200 s); line 4 at 100 s is the sixth and stays off.
    expect(rows.map((r) => r.dataset.route)).toEqual(['6', '11', '12', '13', '14', '17', '31', '32', '34', '109', '268', '7', '205', '2']);
    expect(rows.slice(0, 9).every((r) => r.dataset.atStop === '1')).toBe(true);
    expect(rows.slice(9).every((r) => r.dataset.atStop === undefined)).toBe(true);
    const first = rows[0]!;
    expect(q(first, '.line[data-size=k][data-kind=tram]')!.textContent).toBe('6');
    expect(text(q(first, '.k-row-word'))).toBe('kasni 2 min');
    expect(text(q(first, '.k-row-aside'))).toBe('12 vozila');
    expect(text(q(rows[2]!, '.k-row-word'))).toBe('nema podataka');
    expect(text(q(rows[9]!, '.k-row-word'))).toBe('kasni 10 min');
    expect(text(q(rows[10]!, '.k-row-word'))).toBe('rani 8 min');
    expect(text(q(board, '.k-row-more'))).toBe('prikazano 14 od 15 linija');
    expect(board.classList.contains('k-block--board')).toBe(true);
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

  it('one map for the screen\u2019s life: created once at the design width, following the measured width on a resize, parked and returned through a session, never destroyed', async () => {
    const map = spyMap();
    const k = mount({ stored: STORED, mapFactory: map.factory as never });
    await flush();
    expect(map.factory).toHaveBeenCalledTimes(1);
    const options = map.factory.mock.calls[0]![0] as Record<string, unknown>;
    // Before layout the wide drawing's design width stands; the field carries the kiosk emphasis and no selection (R-KP11).
    expect(options.zoom).toBe(fieldZoom(FIELD_DESIGN_WIDTH.wide, STOP.lat, FIELD_SPAN_M));
    expect(options.selectedStop).toBeUndefined();
    expect(options.padding).toBeUndefined();
    expect(options.emphasis).toEqual(KIOSK_EMPHASIS);
    expect((options.prozor as { stopRoutes: string[] }).stopRoutes).toEqual(STOP.routes);
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
    layOut(host, 1500);
    k.repaint();
    expect(map.handle.setView).toHaveBeenCalledTimes(1);
    expect(map.handle.setView).toHaveBeenLastCalledWith({ zoom: fieldZoom(1500, STOP.lat, FIELD_SPAN_M), emphasis: KIOSK_EMPHASIS, center: [STOP.lon, STOP.lat] });
    expect(map.factory).toHaveBeenCalledTimes(1);
    // A session parks the container (paused), the paired Sada view re-hosts it at street zoom with the stop selected; the invitation takes it back.
    k.handlers.onCodes(batch(NOW), NOW);
    k.handlers.onUnlocked({ roomId: 'r1', ticket: 't1', expiresAt: NOW + 600_000 });
    await flush();
    expect(k.handle.phase()).toBe('paired');
    expect(map.calls).toContain('pause');
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

  it('the column is reconciled: an unchanged statement keeps its node, a changed value swaps only the value node, a newcomer joins without rebuilding the rest, and the ranker gets its own last answer back', async () => {
    let slots: Slot[] = [statement('say:transit', 'Sve linije voze redovito', { context: '3 vozila u blizini · ZET 14:32' })];
    say.rank.mockImplementation(() => slots);
    say.markup.mockImplementation((s: readonly Slot[]) => sayHtml(s));
    const k = mount({ stored: STORED });
    await flush();
    const says = q(k.root, '[data-testid=kiosk-says]')!;
    const first = q(says, 'article[data-key="say:transit"]')!;
    const value = q(first, '.k-say-value')!;
    expect(text(value)).toBe('Sve linije voze redovito');
    expect(says.children).toHaveLength(1);
    // The same answer on the next poll: the same nodes stand (a reader mid-glance is never interrupted).
    k.poll();
    await flush();
    expect(q(says, 'article[data-key="say:transit"]')).toBe(first);
    expect(q(first, '.k-say-value')).toBe(value);
    expect(say.rank.mock.calls.at(-1)![1]).toBe(slots); // hysteresis: the previous slots go back in
    // A changed value: the article node stays, the value node is swapped wholesale (data-replace by data-sig), so the k-say-in keyframe replays on insertion.
    slots = [statement('say:transit', '6 kasni 4 min · 13 kasni 3 min', { tone: 'late', context: '3 vozila u blizini · ZET 14:33' })];
    k.poll();
    await flush();
    expect(q(says, 'article[data-key="say:transit"]')).toBe(first);
    const swapped = q(first, '.k-say-value')!;
    expect(swapped).not.toBe(value);
    expect(text(swapped)).toBe('6 kasni 4 min · 13 kasni 3 min');
    expect(swapped.dataset.sig).toBe('6 kasni 4 min · 13 kasni 3 min');
    // A newcomer takes the second slot; the first article is still the same node.
    slots = [...slots, statement('say:closure', 'Amruševa', { domain: 'komunalno', say: 'closure', label: 'Zatvoreno', weight: 90 })];
    k.poll();
    await flush();
    expect([...says.children].map((el) => (el as HTMLElement).dataset.key)).toEqual(['say:transit', 'say:closure']);
    expect(q(says, 'article[data-key="say:transit"]')).toBe(first);
    expect(q(says, 'article[data-key="say:closure"]')!.dataset.domain).toBe('komunalno');
    expect(q(says, '[data-skeleton]')).toBeNull();
  });

  it('the column fits by measurement (R-KP5): a value past two lines is cut at a word with "…" while its signature stays whole, a value of pairs is left alone, and a statement the room does not hold is hidden whole', async () => {
    const long = 'Dvadeset peta sjednica Odbora za Statut, Poslovnik i propise Gradske skupštine Grada Zagreba u velikoj vijećnici';
    const pairs = '<span class="k-say-pair"><span class="k-line-badge line" data-kind="tram" data-size="k">6</span><time>23:58</time></span>';
    say.rank.mockImplementation(() => [statement('say:assembly', long), statement('say:lastrun', '23:58', { say: 'lastrun' }), statement('say:kvart', 'Novi park u Trnju', { say: 'kvart' })]);
    say.markup.mockImplementation((slots: readonly Slot[]) => sayHtml(slots).replace('data-replace data-sig="23:58">23:58', `data-replace data-sig="23:58">${pairs}`));
    const k = mount({ stored: STORED });
    await flush();
    const says = q(k.root, '[data-testid=kiosk-says]')!;
    const [first, second, third] = [...says.children] as HTMLElement[];
    const value = q(first!, '.k-say-value')!;
    // A line every 30 characters at a 44 px line box, and a column that holds two statements of three.
    for (const el of [first!, second!, third!]) Object.defineProperty(el, 'getBoundingClientRect', { value: () => ({ height: 120 }) });
    Object.defineProperty(value, 'clientHeight', { get: () => Math.ceil((value.textContent ?? '').length / 30) * 44 });
    value.style.lineHeight = '44px';
    Object.defineProperty(says, 'clientHeight', { get: () => 300 });
    Object.defineProperty(says, 'scrollHeight', { get: () => [...says.children].filter((el) => !(el as HTMLElement).hidden).length * 120 });
    k.tick(CODE_TICK_MS);
    const cut = value.textContent ?? '';
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(61);
    expect(cut).toMatch(/^Dvadeset peta sjednica Odbora za Statut, Poslovnik/);
    expect(cut).not.toMatch(/\s…$/); // cut at a word boundary, the space with it
    expect(value.dataset.sig).toBe(long); // the whole text stays the reconciler's signature
    expect(q(second!, '.k-say-value')!.innerHTML).toContain('<time>23:58</time>'); // pairs are not text to cut
    expect([first!.hidden, second!.hidden, third!.hidden]).toEqual([false, false, true]);
    // A poll with the same answer keeps the clamp and the hiding (the reconciler kept the nodes, fit ran again).
    k.poll();
    await flush();
    expect(q(says, 'article[data-key="say:assembly"]')).toBe(first);
    expect((q(first!, '.k-say-value')!.textContent ?? '').endsWith('…')).toBe(true);
    expect(third!.hidden).toBe(true);
  });

  it('each composition hands the ranker its own tables (R-KP5): wide 3/7/56, compact 2/4/44, portrait 3/8/48, handheld all/6/40, with the stop, the modules and the moment', async () => {
    const cases: [string, { width: number; height: number }, keyof typeof SAY_SLOTS][] = [
      ['wide', { width: 1920, height: 1080 }, 'wide'], ['compact', { width: 1366, height: 768 }, 'compact'],
      ['portrait', { width: 1080, height: 1920 }, 'portrait'], ['handheld', { width: 390, height: 844 }, 'handheld'],
    ];
    for (const [name, viewport, composition] of cases) {
      mount({ stored: STORED, viewport });
      await flush();
      const input = lastInput();
      expect([input.slots, input.badgeCap, input.valueChars], name).toEqual([SAY_SLOTS[composition], SAY_BADGE_CAP[composition], SAY_VALUE_CHARS[composition]]);
      expect(input.stop, name).toEqual(STOP);
      expect(input.now, name).toBe(NOW);
      expect(input.modules, name).toEqual(MODULES);
      expect(input.lastRun, name).toBeNull();
    }
    expect([SAY_SLOTS.wide, SAY_SLOTS.compact, SAY_SLOTS.portrait]).toEqual([3, 2, 3]);
    // The badge caps are what the label row holds beside the kicker with its "+N" tail (kiosk/layout.ts): two rows at wide, one at compact.
    expect(SAY_BADGE_CAP).toEqual({ wide: 7, compact: 4, portrait: 8, handheld: 6 });
    expect(SAY_VALUE_CHARS).toEqual({ wide: 56, compact: 44, portrait: 48, handheld: 40 });
    // A phone shows every candidate: "all" is every kind say.ts knows, read from say.ts itself so it cannot drift.
    expect(SAY_SLOTS.handheld).toBe(realSay.SAY_KINDS.length);
    expect(realSay.SAY_KINDS).toHaveLength(8);
  });

  it('a handheld frames 1400 m across its band and a totem 2800 m across its full width, each at its design width before layout', async () => {
    const phone = spyMap();
    mount({ stored: STORED, viewport: { width: 390, height: 844 }, mapFactory: phone.factory as never });
    await flush();
    expect((phone.factory.mock.calls[0]![0] as { zoom: number }).zoom).toBe(fieldZoom(FIELD_DESIGN_WIDTH.handheld, STOP.lat, HANDHELD_SPAN_M));
    const totem = spyMap();
    mount({ stored: STORED, viewport: { width: 1080, height: 1920 }, mapFactory: totem.factory as never });
    await flush();
    expect((totem.factory.mock.calls[0]![0] as { zoom: number }).zoom).toBe(fieldZoom(FIELD_DESIGN_WIDTH.portrait, STOP.lat, FIELD_SPAN_M));
  });

  it('last departures (R-KP6): the stop\u2019s table is fetched once on stop change behind FEED_LASTRUN, handed to the ranker, and fetched again once now passes validUntil', async () => {
    let now = NOW;
    const live = (validUntil: number): LastRunSnapshot => ({ status: 'live', fetchedAt: new Date(now).toISOString(), sourceUpdatedAt: '2026-09-15T00:00:00Z', validUntil: new Date(validUntil).toISOString(), routes: { '6': { '2026-09-11': '23:58' } } });
    const loadLastRun = vi.fn(async () => live(NOW + 60_000));
    const k = mount({ stored: STORED, now: () => now, loadLastRun });
    await flush();
    expect(loadLastRun).toHaveBeenCalledTimes(1);
    expect(loadLastRun).toHaveBeenCalledWith('106_1');
    expect(lastInput().lastRun).toEqual(live(NOW + 60_000));
    // Polls within the table's validity never refetch.
    k.poll();
    await flush();
    k.poll();
    await flush();
    expect(loadLastRun).toHaveBeenCalledTimes(1);
    // A new stop drops the old table at once (it must not pose as the new stop's) and fetches the new one.
    k.handlers.onContext!({ kind: 'venue', expiresAt: null, stop: STOPS[2]! });
    expect(lastInput().lastRun).toBeNull();
    await flush();
    expect(loadLastRun).toHaveBeenCalledTimes(2);
    expect(loadLastRun).toHaveBeenLastCalledWith('200_1');
    expect(lastInput().lastRun).toEqual(live(NOW + 60_000));
    // The table expires: the next paint asks again (P2's loader refetches past validUntil; today's returns its cache, which is still one call per expiry).
    now = NOW + 61_000;
    k.poll();
    await flush();
    expect(loadLastRun).toHaveBeenCalledTimes(3);
    expect(loadLastRun).toHaveBeenLastCalledWith('200_1');
  });

  it('statements repaint on every poll and, on the 1 s tick, only when the minute turns (the ZET time in a context)', async () => {
    let now = NOW;
    const k = mount({ stored: STORED, now: () => now });
    await flush();
    const painted = say.rank.mock.calls.length;
    now = NOW + 1_000;
    k.tick(CODE_TICK_MS);
    now = NOW + 2_000;
    k.tick(CODE_TICK_MS);
    expect(say.rank.mock.calls.length).toBe(painted); // the same minute: the column is left alone
    now = Date.parse('2026-09-11T12:33:00Z');
    k.tick(CODE_TICK_MS);
    expect(say.rank.mock.calls.length).toBe(painted + 1);
    expect(lastInput().now).toBe(now);
    k.poll();
    await flush();
    expect(say.rank.mock.calls.length).toBe(painted + 2);
  });

  it('the placed-labels seam (contract 3): a handle that exposes placedNames stamps data-major-labels on the map host once the map is ready; a stub stamps nothing, which the e2e reads as "not yet"', async () => {
    const stub = spyMap();
    const k = mount({ stored: STORED, mapFactory: stub.factory as never });
    await flush();
    k.tick(CODE_TICK_MS);
    expect(q(k.root, '[data-testid=kiosk-map-host]')!.dataset.majorLabels).toBeUndefined();
    let status = 'loading';
    const real = spyMap({ status: () => status, placedNames: (layer: string) => (layer === 'roads_labels_major' ? ['Ilica', 'Savska cesta', 'Ilica'] : []) });
    const seam = mount({ stored: STORED, mapFactory: real.factory as never });
    await flush();
    const host = q(seam.root, '[data-testid=kiosk-map-host]')!;
    expect(host.dataset.majorLabels).toBeUndefined(); // [] before the style loads is not a count of zero
    status = 'ready';
    seam.tick(CODE_TICK_MS);
    expect(host.dataset.majorLabels).toBe('2');
  });

  it('lightweight: no map factory, no fetch for the quarter, the field is the board and the column still ranks', async () => {
    const map = spyMap();
    const k = mount({ stored: STORED, lightweight: true, mapFactory: map.factory as never });
    await flush();
    expect(map.factory).not.toHaveBeenCalled();
    expect(q(k.root, '[data-testid=kiosk-map]')).toBeNull();
    expect(q(k.root, '[data-testid=kiosk-live] [data-testid=kiosk-lines] li.k-line')).not.toBeNull();
    expect(lastInput().slots).toBe(SAY_SLOTS.wide);
  });
});

// T4.4: /kiosk/ opened on a phone. A handheld (kiosk/layout.ts, below
// core/breakpoints.ts KIOSK_HANDHELD_MAX_PX) still asks for no fullscreen and
// no wake lock and still scrolls its wizard -- but there is no separate
// handheld composition: after creation a phone gets the same invitation a
// wall gets, drawn with the handheld tokens, and the address that provisions
// the wall is a footnote under it rather than the page's subject.
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
  it('kiosk.css lets a handheld scroll instead of cropping (the body through :has, no mirrored attribute), keeps the stage padding a wall drops, folds the wizard grids and stands the invitation up under a 280 px map band', () => {
    const css = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', 'kiosk.css'), 'utf8');
    expect(css).toMatch(/\.kiosk\[data-size='handheld'\] \{[^}]*block-size: auto;\s*overflow: visible;/);
    expect(css).toContain(".kiosk-body:has(.kiosk[data-size='handheld']) { overflow: visible; }");
    expect(css).toContain(".kiosk[data-size='handheld'] .k-choice-grid, .kiosk[data-size='handheld'] .k-stop-list { grid-template-columns: repeat(auto-fit, minmax(min(10rem, 100%), 1fr)); }");
    expect(css).not.toContain('data-kiosk-size');
    // No separate handheld composition: the phone draws the invitation with a map band, the column in flow beneath it, the card stood up.
    expect(css).toContain('--k-map-band: 280px;');
    expect(css).toMatch(/\.kiosk\[data-size='handheld'\] \.k-field \{[^}]*height: var\(--k-map-band\);/);
    expect(css).toContain(".kiosk[data-size='handheld'] .k-invitation { grid-template-columns: minmax(0, 1fr); }");
    expect(css).toMatch(/\.kiosk\[data-size='handheld'\]\[data-phase='invitation'\] \.k-stage \{ padding: var\(--k-pad\); \}/);
    for (const dead of ['.k-handheld', '.k-invite-text', '.k-support', '.k-scene', '.k-rail']) expect(css, dead).not.toContain(dead);
  });
  it('after creation gives a phone the whole invitation, with the provisioning address as a footnote under it', async () => {
    const k = mount({ viewport: PHONE });
    expect(k.handle.phase()).toBe('setup');
    q(k.root, '[data-testid=setup-next]')!.click();
    await flush();
    submit(k.root);
    await flush();
    expect(k.handle.phase()).toBe('invitation');
    expect(k.beacon.connect).toHaveBeenCalledTimes(1);
    // The same composition a wall gets: the field with its map host, the column of statements and the card.
    for (const present of ['kiosk-invitation', 'kiosk-live', 'kiosk-map-host', 'kiosk-says', 'kiosk-invite']) {
      expect(q(k.root, `[data-testid=${present}]`), present).not.toBeNull();
    }
    // The address that provisions the wall is an aside with an h2, so the page's one h1 is the invitation's lead here as everywhere.
    const block = q(k.root, '[data-testid=handheld-link-block]')!;
    expect(block).not.toBeNull();
    expect(block.tagName).toBe('ASIDE');
    expect(text(q(block, 'h2'))).toBe('Ovu adresu otvori na zaslonu koji postavljaš.');
    const link = q(block, '[data-testid=handheld-link]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://zagreb.aningfilm.hr/kiosk/#NEW00001.nova');
    expect(text(link)).toBe('https://zagreb.aningfilm.hr/kiosk/#NEW00001.nova');
    expect(k.root.querySelectorAll('h1')).toHaveLength(1);
    expect(text(q(k.root, 'h1.k-lead'))).toBe('Skeniraj za 10 minuta grada.');
    // The code card is the same one the rotation paints on a wall.
    k.handlers.onCodes(batch(NOW), NOW);
    expect(text(q(k.root, '[data-testid=pair-code]'))).toBe('ABCD·EFG0');
    expect(k.root.querySelector('[data-testid=kiosk-qr] svg')).not.toBeNull();
    expect((q(k.root, '[data-testid=pair-url]') as HTMLAnchorElement).getAttribute('href')).toBe('https://zagreb.aningfilm.hr/s#ABCD-EFG0');
    expect(q(k.root, '[data-testid=code-progress]')!.dataset.pct).toBe('1.00');
    // The header's weather group paints on a handheld too (C.3), the only weather there.
    expect(k.root.querySelectorAll('[data-testid=kiosk-weather]')).toHaveLength(1);
    expect(text(q(k.root, '.k-head [data-testid=kiosk-weather]'))).toContain('21 °C');
  });
  it('a stored screen opened on a phone rebuilds the link from its credentials on the code base', () => {
    const k = mount({ stored: STORED, viewport: PHONE });
    expect((q(k.root, '[data-testid=handheld-link]') as HTMLAnchorElement).getAttribute('href')).toBe('https://zagreb.aningfilm.hr/kiosk/#BEACON01.tajna');
  });
  it('speaks English when the page does', () => {
    const k = mount({ stored: STORED, viewport: PHONE, i18n: createDefaultI18n('en'), locale: 'en' });
    expect(text(q(k.root, '[data-testid=handheld-link-block] h2'))).toBe('Open this address on the screen you are setting up.');
    expect(text(q(k.root, '.k-lead'))).toBe('Scan for 10 minutes of the city.');
  });
  it('crossing the handheld bound keeps the invitation both ways: only the provisioning footnote comes and goes', () => {
    const viewport = { ...PHONE };
    const k = mount({ stored: STORED, viewport });
    expect(q(k.root, '[data-testid=handheld-link-block]')).not.toBeNull();
    expect(q(k.root, '[data-testid=kiosk-live]')).not.toBeNull();
    viewport.width = 1366; viewport.height = 768;
    k.repaint();
    expect(q(k.root, '[data-testid=kiosk]')!.dataset.size).toBe('compact');
    expect(q(k.root, '[data-testid=handheld-link-block]')).toBeNull();
    expect(q(k.root, '[data-testid=kiosk-live]')).not.toBeNull();
    expect(text(q(k.root, '.k-lead'))).toBe('Skeniraj za 10 minuta grada.');
    viewport.width = 390; viewport.height = 844;
    k.repaint();
    expect(q(k.root, '[data-testid=handheld-link-block]')).not.toBeNull();
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
