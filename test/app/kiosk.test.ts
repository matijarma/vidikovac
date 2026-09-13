// @vitest-environment happy-dom
// The kiosk controller with every dependency faked: the setup wizard, the
// invitation, codes, the paired compositions, expiry and revocation, the
// basics panel, alerts, polling and disposal.
import { describe, expect, it, vi } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import type { CodeSlot, ScreenMetadata } from '../../worker/protocol';
import { BEACON_STORAGE_KEY } from '../../app/src/beacon';
import { ScreenError } from '../../app/src/core/screens';
import { publicItemKey } from '../../app/src/core/contracts';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { CODE_TICK_MS, ESSENTIALS_IDLE_MS, mountKiosk, ROTATE_MS, type KioskDeps } from '../../app/src/kiosk';
import { POLL_FALLBACK_MS } from '../../app/src/motion/loop';

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
  snap('hrt-news', [item('hrt-news', 'n1', 'news', 'Naslov vijesti', { at: '2026-09-11T11:10:00Z', data: { source: 'HRT vijesti' } }), item('hrt-news', 'n2', 'news', 'Drugi naslov', { at: '2026-09-11T10:00:00Z' })]),
  snap('emsc', [item('emsc', 'q1', 'quake', 'Potres', { at: '2026-09-11T10:11:00Z', data: { mag: 1.6, depth: 10, region: 'CROATIA' } })]),
  snap('dogadanja', [item('dogadanja', 'skupstina:13', 'event', '13. sjednica Gradske skupštine', { at: '2026-09-17T07:00:00Z', dateBasis: 'event', data: { source: 'skupstina', precision: 'time' } })]),
  snap('ckan-geo', [item('ckan-geo', 'p1', 'poi', 'Ljekarna Centar, Ilica 1', { data: { category: 'ljekarne' } })]),
];
const CODE_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function batch(start: number, count = 20): CodeSlot[] {
  return Array.from({ length: count }, (_, i) => ({ code: `ABCDEFG${CODE_CHARS[i]}`, slotStart: start + i * 30_000, slotEnd: start + (i + 1) * 30_000 }));
}

interface Timer { fn: () => void; ms: number; cleared: boolean }
type MountOptions = Partial<Pick<KioskDeps, 'hash' | 'reducedMotion' | 'lightweight' | 'fetchTeaser' | 'mapFactory' | 'createScreen' | 'loadStops' | 'viewport' | 'locale' | 'now'>> & { stored?: string | null };

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
  const fetchData = vi.fn(async (module: ModuleId) => MODULES.find((m) => m.module === module) ?? snap(module, []));
  const createScreen = opts.createScreen ?? vi.fn(async () => ({ beaconId: 'NEW00001', secret: 'nova', provisionUrl: 'https://zagreb.aningfilm.hr/kiosk/#NEW00001.nova', screen: SCREEN }));
  const loadStops = opts.loadStops ?? vi.fn(async () => STOPS);
  const requestFullscreen = vi.fn(async () => {});
  const requestWakeLock = vi.fn(async () => {});
  const handle = mountKiosk(root, {
    i18n: createDefaultI18n('hr'), hash: opts.hash ?? '', storage, now: opts.now ?? (() => NOW), codeBase: 'https://zagreb.aningfilm.hr',
    reducedMotion: opts.reducedMotion ?? false, lightweight: opts.lightweight ?? false, viewport: opts.viewport ?? { width: 1920, height: 1080 }, locale: opts.locale,
    fetchTeaser: opts.fetchTeaser ?? (async () => ({ modules: MODULES })), loadNetwork: async () => null, mapFactory: opts.mapFactory, fetchData, createScreen, loadStops,
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
  return {
    root, handle, beacon, timers, raw, sessions, fetchData, createScreen, loadStops, requestFullscreen, requestWakeLock,
    get handlers() { return handlers!; },
    expire: () => sessionExpired?.(),
    view: (layer: string, params?: Record<string, string>) => sessionView?.(layer, params),
    runOut: () => { secondsLeft = 0; },
    /** The latest still-armed registration at a delay. */
    fire: (ms: number) => [...timers].reverse().find((t) => t.ms === ms && !t.cleared),
    /** Fires every armed timer registered at a delay, oldest first. */
    tick: (ms: number) => { for (const t of [...timers]) if (t.ms === ms && !t.cleared) t.fn(); },
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
    expect(q(k.root, '[data-testid=kiosk-essentials-open]')!.hidden).toBe(true);
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
  it('a 403 ends in the Access sentence with no retry, a 429 counts its retry down, a network failure offers one; nothing loops', async () => {
    const attempts: unknown[] = [new ScreenError('evaluation-access-required', 403), new ScreenError('screen-limit', 429, 90), new TypeError('Failed to fetch')];
    const createScreen = vi.fn(async () => { throw attempts.shift(); });
    const k = mount({ createScreen });
    q(k.root, '[data-testid=setup-next]')!.click();
    await flush();
    submit(k.root);
    await flush();
    expect(text(q(k.root, '[data-testid=setup-error]'))).toBe('Postavljanje traži ocjenjivački pristup (Cloudflare Access). Prijavi se pa pokušaj ponovno.');
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
  it('boots the beacon from stored credentials and composes the stop context, the map column, the lines, the invitation, the weather, a story and the strip', async () => {
    const k = mount({ stored: STORED });
    await flush();
    expect(k.handle.phase()).toBe('invitation');
    expect(k.beacon.connect).toHaveBeenCalledTimes(1);
    expect(q(k.root, '[data-testid=kiosk]')!.dataset.size).toBe('wide');
    expect(q(k.root, '[data-testid=kiosk]')!.dataset.mode).toBe('teaser');
    const context = text(q(k.root, '[data-testid=kiosk-context]'));
    expect(context).toContain('Trg bana J. Jelačića');
    expect(context).toContain('privremeni zaslon · vrijedi do');
    expect(text(q(k.root, '.k-lead'))).toBe('Skeniraj za 10 minuta grada.');
    expect(q(k.root, '[data-testid=kiosk-map-host]')).not.toBeNull();
    const lines = text(q(k.root, '[data-testid=kiosk-lines]'));
    expect(lines).toContain('Linije s ove stanice');
    expect(lines).toContain('kasni 2 min');
    expect(lines).toContain('još 4 linije');
    expect(k.root.querySelectorAll('[data-testid=kiosk-lines] .k-line')).toHaveLength(5);
    expect(text(q(k.root, '[data-testid=kiosk-weather]'))).toContain('21 °C');
    expect(text(q(k.root, '[data-testid=kiosk-story]'))).toContain('13. sjednica Gradske skupštine');
    const strip = text(q(k.root, '[data-testid=safety-strip]'));
    expect(strip).toContain('žuto upozorenje · Grmljavina');
    expect(strip).toContain('1 zatvaranje');
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
    expect(text(q(k.root, '[data-testid=pair-code]'))).toBe('ABCD-EFG0');
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
  it('rotates the story every twenty seconds; the clock tick repaints once a second', async () => {
    const k = mount({ stored: STORED });
    await flush();
    const first = q(k.root, '[data-testid=kiosk-story]')!.dataset.storyId;
    k.tick(ROTATE_MS);
    expect(q(k.root, '[data-testid=kiosk-story]')!.dataset.storyId).not.toBe(first);
    expect(k.timers.filter((t) => t.ms === CODE_TICK_MS && !t.cleared)).toHaveLength(1);
  });
  it('stores fresher screen metadata from the beacon beside the same secret and names the venue', () => {
    const k = mount({ hash: '#BEACON01.tajna' });
    expect(JSON.parse(k.raw[BEACON_STORAGE_KEY]!)).toEqual({ beaconId: 'BEACON01', secret: 'tajna' });
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toBe('');
    k.handlers.onContext!({ kind: 'venue', expiresAt: null, stop: STOP });
    expect(JSON.parse(k.raw[BEACON_STORAGE_KEY]!)).toEqual({ beaconId: 'BEACON01', secret: 'tajna', screen: { kind: 'venue', expiresAt: null, stop: STOP } });
    expect(text(q(k.root, '[data-testid=kiosk-context]'))).toContain('zaslon u prostoru');
  });
  it('draws compact at 1366 x 768 with four lines on the board', async () => {
    const k = mount({ stored: STORED, viewport: { width: 1366, height: 768 } });
    await flush();
    expect(q(k.root, '[data-testid=kiosk]')!.dataset.size).toBe('compact');
    expect(k.root.querySelectorAll('[data-testid=kiosk-lines] .k-line')).toHaveLength(4);
  });
  it('lightweight: the map host is hidden, nothing is a canvas, and the lines board fills the column', async () => {
    const k = mount({ stored: STORED, lightweight: true });
    await flush();
    expect(q(k.root, '[data-testid=kiosk-map-host]')!.hidden).toBe(true);
    expect(q(k.root, '[data-testid=kiosk-lines]')!.classList.contains('k-lines--board')).toBe(true);
    expect(k.root.querySelectorAll('[data-testid=kiosk-lines] .k-line')).toHaveLength(9);
    expect(k.root.querySelectorAll('canvas')).toHaveLength(0);
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
    expect(text(label)).toBe('Otključano do 14:42');
    expect(q(k.root, '[data-testid=corner-qr] .qr')).not.toBeNull();
    expect(text(q(k.root, '[data-testid=join-code]'))).toBe('ABCD-EFG0');
    expect(q(k.root, '[data-testid=kiosk-essentials-open]')!.hidden).toBe(true);
    expect(text(q(k.root, '[data-testid=k-weather]'))).toContain('21 °C');
    expect(text(q(k.root, '[data-testid=k-warnings]'))).toContain('Grmljavina');
    expect(k.fetchData).toHaveBeenCalled();
    expect(q(k.root, '[data-testid=kiosk-invitation]')).toBeNull();
  });
  it('mirrors each of the seven domains with its own blocks; the join QR survives every layer change', async () => {
    const k = await pairedKiosk();
    const expectations: [string, string[]][] = [
      ['u-pokretu', ['k-delays', 'k-closures', 'kiosk-map-host']],
      ['zrak-i-nebo', ['k-weather', 'k-forecast', 'k-sun', 'k-quakes', 'k-warnings']],
      ['sigurnost', ['k-warnings', 'k-closures', 'k-quakes', 'k-assembly', 'k-pharmacies']],
      ['uprava-i-pravo', ['k-acts', 'k-sessions', 'k-works']],
      ['kultura', ['k-today', 'k-tomorrow', 'k-later', 'k-notices']],
      ['vijesti', ['k-lead', 'k-headlines']],
    ];
    for (const [layer, ids] of expectations) {
      k.view(layer);
      await flush();
      expect(q(k.root, '[data-testid=kiosk-layer]')!.dataset.layer).toBe(layer);
      for (const id of ids) expect(q(k.root, `[data-testid=${id}]`), `${layer} ${id}`).not.toBeNull();
      expect(q(k.root, '[data-testid=corner-qr] .qr'), layer).not.toBeNull();
    }
    expect(q(k.root, '[data-testid=kiosk-layer] [data-testid=kiosk-map-host]')).toBeNull();
    expect(text(q(k.root, '[data-testid=k-lead]'))).toContain('Naslov vijesti');
    expect(text(q(k.root, '[data-testid=k-headlines]'))).toContain('Drugi naslov');
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
    k.view('vijesti', { kind: 'item', id: publicItemKey('hrt-news', 'n2'), module: 'hrt-news' });
    await flush();
    expect(text(q(k.root, '[data-testid=k-selection]'))).toContain('Drugi naslov');
    k.view('vijesti', { q: 'private search', lat: '45.8' });
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
    expect(text(q(k.root, '[data-testid=pair-code]'))).toBe('ABCD-EFG0');
    expect(k.sessions[1]!.close).toHaveBeenCalledTimes(1);
  });
  it('re-polls the layer on every tick while paired and returns on its own when the room clock ran out without an expired frame', async () => {
    const k = await pairedKiosk();
    k.fetchData.mockClear();
    k.tick(ROTATE_MS);
    await flush();
    expect(k.fetchData).toHaveBeenCalled();
    expect(k.handle.phase()).toBe('paired');
    k.runOut();
    k.tick(ROTATE_MS);
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
    expect(text(q(k.root, '[data-testid=pair-code]'))).toBe('ABCD-EFG0');
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
  it('never opens over a grant, and the close button closes it', async () => {
    const k = await pairedKiosk();
    (q(k.root, '[data-testid=kiosk-essentials-open]') as HTMLButtonElement).click();
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
    k.view('vijesti');
    await flush();
    expect(map.calls.at(-1)).toBe('pause'); // a domain without a map parks it, never destroys it
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
    expect(text(alert)).toBe('Izvor podataka nedostupan');
    k.handlers.onStatus('offline');
    expect(text(alert)).toBe('Bez veze sa zaslonom — kod se ne može izdati');
    k.handlers.onStatus('live');
    expect(alert.hidden).toBe(false);
    expect(text(alert)).toBe('Izvor podataka nedostupan');
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
  it('speaks English when the page does', async () => {
    const k = mount({ stored: STORED, locale: 'en' });
    await flush();
    expect(text(q(k.root, '.k-lead'))).toBe('Scan for 10 minutes of the city.');
    expect(text(q(k.root, '[data-testid=kiosk-lines]'))).toContain('Lines from this stop');
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
