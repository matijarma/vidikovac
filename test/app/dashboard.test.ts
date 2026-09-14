// @vitest-environment happy-dom
// The /d/ shell on the real core stores: navigation, session states, polling
// aligned to the feed, reconciliation that keeps focus and typed text, the
// session sheet, sharing, expiry and exports. Every browser global is injected.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import type { LayerId } from '../../worker/protocol';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import hr from '../../app/src/i18n/hr.json';
import type { SessionClient, SessionSnapshot } from '../../app/src/session';
import { LAYER_STORAGE_KEY, mountDashboard, parseSessionHash, type DashboardDeps } from '../../app/src/dashboard';
import { POLL_FALLBACK_MS } from '../../app/src/motion/loop';
import { THEME_PREFERENCES } from '../../app/src/ui/theme';
import { stubSessionStorage } from './helpers';

stubSessionStorage();
// The workspace's fallback catalogue is not an upstream call in a unit test.
vi.mock('../../app/src/core/screens', () => ({ loadStops: vi.fn(async () => []) }));

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb
const EXPIRES = NOW + 10 * 60_000; // 14:42

function fakeSession(now: () => number = () => NOW) {
  const listeners = {
    joined: [] as ((s: SessionSnapshot) => void)[], expiring: [] as ((n: number) => void)[], expired: [] as (() => void)[],
    count: [] as ((n: number) => void)[], codes: [] as ((batch: unknown[], serverNow: number) => void)[],
    error: [] as ((code: string, reason?: 'revoked' | 'no-ticket') => void)[], close: [] as ((code: number) => void)[],
  };
  let snapshot: SessionSnapshot = { phase: 'connecting', role: null, expiresAt: null, dataToken: null, participants: 0, secondsLeft: 0 };
  let runOut = false;
  const sent: { layer: LayerId; params?: Record<string, string> }[] = [];
  const events: { name: string; dim?: string }[] = [];
  const client: SessionClient = {
    connect: vi.fn(), snapshot: () => snapshot, serverNow: () => now(),
    secondsLeft: () => (runOut ? 0 : Math.max(0, Math.floor(((snapshot.expiresAt ?? now()) - now()) / 1000))),
    onJoined: (l) => { listeners.joined.push(l); return () => {}; },
    onExpiring: (l) => { listeners.expiring.push(l); return () => {}; },
    onExpired: (l) => { listeners.expired.push(l); return () => {}; },
    onView: () => () => {},
    onCodes: (l) => { listeners.codes.push(l as never); return () => {}; },
    onCount: (l) => { listeners.count.push(l); return () => {}; },
    onError: (l) => { listeners.error.push(l); return () => {}; },
    onClose: (l) => { listeners.close.push(l); return () => {}; },
    sendView: (layer, params) => { sent.push(params ? { layer, params } : { layer }); },
    share: vi.fn(), event: (name, dim) => { events.push({ name, dim }); }, close: vi.fn(),
  };
  return {
    client, sent, events,
    join(role: 'scanner' | 'phone' = 'scanner', screen?: SessionSnapshot['screen']) {
      snapshot = { phase: 'live', role, expiresAt: EXPIRES, dataToken: 'dt1', participants: 2, secondsLeft: 600, ...(screen ? { screen } : {}) };
      listeners.joined.forEach((l) => l(snapshot));
    },
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
  'hrt-news': base('hrt-news', [{ id: 'n1', module: 'hrt-news', kind: 'news', tier: 'open', title: 'Naslov vijesti', link: 'https://vijesti.hrt.hr/1', at: '2026-09-11T11:00:00Z', dateBasis: 'published', data: { source: 'HRT vijesti' } }]),
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

beforeEach(() => { sessionStorage.clear(); });

describe('parseSessionHash', () => {
  it('reads room, ticket and label from the fragment /s/ navigates to', () => {
    expect(parseSessionHash('#room=r1&ticket=t1&label=Kavana%20Velebit')).toEqual({ roomId: 'r1', ticket: 't1', label: 'Kavana Velebit' });
    expect(parseSessionHash('#room=r2&label=phone')).toEqual({ roomId: 'r2', ticket: null, label: 'phone' });
    expect(parseSessionHash('#nothing')).toBeNull();
  });
});
describe('shell and navigation', () => {
  it('renders the wordmark, one session element, the safety shortcut, four phone tabs and seven sidebar domains, with no canvas', () => {
    const { root } = mount();
    expect(text(root.querySelector('.ki-wordmark'))).toBe('Kaj ima?');
    expect(root.querySelectorAll('[data-testid=session-label]')).toHaveLength(1);
    expect(root.querySelector('[data-testid=safety-shortcut]')?.getAttribute('data-layer')).toBe('sigurnost');
    expect([...root.querySelectorAll('.ki-tabs .ki-tab')].map((t) => text(t))).toEqual(['Sada', 'Promet', 'Događanja', 'Još']);
    expect([...root.querySelectorAll('.ki-side-link')].map((a) => a.getAttribute('data-layer'))).toEqual(['grad-sada', 'u-pokretu', 'zrak-i-nebo', 'kultura', 'uprava-i-pravo', 'vijesti', 'sigurnost']);
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
    click(root, '[data-action=nav][data-layer=kultura]');
    expect(text(title)).toBe('Kaj ima? · Događanja');
    expect(document.title).toBe('Kaj ima? · Događanja');
  });
  it('opens a domain from the tab bar: the workspace swaps, the room is told, the heading takes focus, the tab is current', () => {
    const { root, session } = mount();
    click(root, '.ki-tabs [data-action=nav][data-layer=kultura]');
    expect(root.querySelector('#layer-kultura')).not.toBeNull();
    expect(root.querySelector('#layer-grad-sada')).toBeNull();
    expect(session.sent.at(-1)).toEqual({ layer: 'kultura' });
    expect(session.events.at(-1)).toEqual({ name: 'panel_open', dim: 'kultura' });
    expect(document.activeElement?.id).toBe('layer-title-kultura');
    expect(root.querySelector('.ki-tabs [data-layer=kultura]')?.getAttribute('aria-current')).toBe('page');
    expect(root.querySelector('.ki-side-link[data-layer=kultura]')?.getAttribute('aria-current')).toBe('page');
  });
  it('Još opens the labelled directory of the four extra domains and names the open one on its tab', () => {
    const { root, session } = mount();
    session.join();
    click(root, '[data-testid=tab-more]');
    expect(root.querySelector('#layer-directory')).not.toBeNull();
    expect(text(root.querySelector('#layer-directory'))).not.toContain('Ostale domene');
    expect([...root.querySelectorAll('.dir-item[data-layer]')].map((a) => a.getAttribute('data-layer'))).toEqual(['zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'vijesti']);
    expect(root.querySelector('[data-testid=tab-more]')?.getAttribute('aria-expanded')).toBe('true');
    expect(text(root.querySelector('[data-testid=dir-session] .row-title'))).toBe('Otključano do 14:42');
    click(root, '[data-testid=dir-session]');
    expect(document.querySelector('[data-testid=session-sheet]')).not.toBeNull();
    click(root, '[data-testid=dir-zrak-i-nebo]');
    expect(root.querySelector('#layer-zrak-i-nebo')).not.toBeNull();
    expect(text(root.querySelector('[data-testid=tab-more]'))).toBe('Vrijeme');
    expect(root.querySelector('[data-testid=tab-more]')?.getAttribute('aria-current')).toBe('page');
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
    for (const selector of ['[data-testid=safety-shortcut]', '.ki-side-link[data-layer=sigurnost]']) {
      const link = root.querySelector<HTMLAnchorElement>(selector)!;
      expect(link.getAttribute('href')).toBe('/hitno');
      expect(link.hasAttribute('data-action')).toBe(false);
      expect(link.getAttribute('aria-disabled')).not.toBe('true');
    }
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
    expect(text(root.querySelector('[data-testid=announce-polite]'))).toBe('Još minuta. Ono što gledaš ostaje na zaslonu i nakon isteka.');
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
    click(sheet, '[data-testid=share-city]');
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
    expect([...scanner.root.querySelectorAll('.ki-tabs .ki-tab')].map((t) => text(t))).toEqual(['Now', 'Transit', 'Events', 'More']);
    scanner.handle.destroy();

    const peer = mount();
    peer.session.join('phone');
    click(peer.root, '[data-testid=session-label]');
    expect(document.querySelector('[data-testid=session-sheet] [data-testid=share-city]')).toBeNull();
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
    expect(body).toContain('Sa zaslona Kavana Velebit, stanica Trg bana J. Jelačića.');
    expect(body).toContain('Na ovom pogledu su 2 uređaja.');
    expect(body).not.toMatch(/stanje sesije/i);
    expect(body).not.toContain('skenirano sa zaslona');
    expect(body).not.toContain('Sesija i postavke');
    expect(body).not.toContain('Vrijedi do');
    for (const testid of ['share-city', 'toggle-refresh', 'toggle-countdown', 'refresh-now']) {
      expect(sheet.querySelector(`[data-testid=${testid}]`)?.classList.contains('sheet-btn'), testid).toBe(true);
    }
    expect(text(sheet.querySelector('[data-testid=share-city]'))).toBe('Podijeli grad Pet minuta za osobu pokraj tebe, jednom.');
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
    expect(body).not.toContain('Na ovom pogledu');
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
    expect(text(dialog)).toContain('Dobiva vlastitih pet minuta; tvoje se vrijeme ne mijenja.');
    expect(text(dialog)).toContain(`upiše slova na ${location.host}/s.`);
    expect(text(dialog.querySelector('.share-read'))).toBe('Pročitaj naglas: A B C D, E F G H');
    const fill = dialog.querySelector<HTMLElement>('.share-progress-fill')!;
    expect(fill.style.width).toBe('0%');
    expect(text(dialog.querySelector('.share-rotates'))).toBe('Novi kod za 30 s');
    at = NOW + 18_000;
    tick();
    expect(fill.style.width).toBe('60%');
    expect(text(dialog.querySelector('.share-rotates'))).toBe('Novi kod za 12 s');
    at = NOW + 30_000;
    tick();
    expect(text(dialog.querySelector('[data-testid=share-code]'))).toBe('JKMN-PQRS');
    expect(text(dialog.querySelector('.share-read'))).toBe('Pročitaj naglas: J K M N, P Q R S');
    expect(fill.style.width).toBe('0%');
    expect(fill.style.transition, 'the reset switches the transition off only for the committed zero').toBe('');
    at = NOW + 31_000;
    tick();
    expect(fill.style.width).toBe('3.3%');
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
    expect(document.querySelector('[data-testid=session-sheet] [data-testid=share-city]')).toBeNull();
  });
});
describe('polling on the feed store', () => {
  it('fetches the active domain’s modules with the data token, then only the new domain’s after a switch', async () => {
    const { root, session, fetchData, tick } = mount();
    session.join();
    await flush();
    expect(fetchData.mock.calls.map((c) => c[0]).sort()).toEqual(['dhmz-cap', 'dhmz-forecast', 'dhmz-now', 'dogadanja', 'emsc', 'glasnik', 'hrt-news', 'prometnice', 'zet-rt']);
    expect(fetchData.mock.calls[0]![1]).toBe('dt1');
    fetchData.mockClear();
    click(root, '[data-action=nav][data-layer=vijesti]');
    await flush();
    expect(fetchData.mock.calls.map((c) => c[0])).toEqual(['hrt-news']);
    fetchData.mockClear();
    tick();
    await flush();
    expect(fetchData).toHaveBeenCalledTimes(1);
  });
  it('polls on the 20 s fallback without a feed timestamp and 2 s after the feed’s next tick with one', async () => {
    const { session, armed } = mount();
    session.join();
    await flush();
    expect(armed()).toEqual([1_000, POLL_FALLBACK_MS]);
    const aligned = mount({ snapshot: (module) => ({ ...snapshotOf(module), ...(module === 'zet-rt' ? { sourceUpdatedAt: new Date(NOW - 5_000).toISOString() } : {}) }) });
    aligned.session.join();
    await flush();
    expect(aligned.armed()).toEqual([1_000, 27_000]);
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
    click(root, '[data-action=nav][data-layer=kultura]');
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
  it('opens an item detail in place, relays the public selection, and Back returns to the list', async () => {
    const { root, session } = mount();
    session.join();
    await flush();
    click(root, '[data-action=nav][data-layer=kultura]');
    await flush();
    click(root, '[data-testid=event-row] [data-action=select]');
    expect(root.querySelector('.ws-split')?.getAttribute('data-detail-open')).toBe('true');
    expect(text(root.querySelector('#ws-detail-title'))).toBe('Koncert u parku');
    expect(session.sent.at(-1)?.params).toEqual({ kind: 'item', id: expect.stringMatching(/^[0-9a-f]{16}$/), module: 'dogadanja' });
    click(root, '[data-action=back]');
    expect(root.querySelector('.ws-split')?.getAttribute('data-detail-open')).toBe('false');
  });
  it('item actions read the current item through delegation, never a closure from an earlier render', async () => {
    const onItemCopy = vi.fn();
    const onItemShare = vi.fn();
    const { root, session } = mount({ deps: { onItemCopy, onItemShare } });
    session.join();
    await flush();
    click(root, '[data-action=nav][data-layer=kultura]');
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
    const { root, session, fetchData, tick } = mount({ snapshot: (module) => {
      if (module === 'hrt-news') throw new Error('down');
      if (failNow && module === 'dhmz-now') throw new Error('boom');
      return snapshotOf(module);
    } });
    session.join();
    await flush();
    expect(text(root.querySelector('[data-testid=temp]'))).toBe('21 °C');
    expect(root.querySelector('#ov-news [data-action=retry][data-module=hrt-news]')).not.toBeNull();
    failNow = true;
    tick();
    await flush();
    expect(root.querySelector('#ov-weather [data-status=stale]')).not.toBeNull();
    expect(text(root.querySelector('[data-testid=temp]'))).toBe('21 °C');
    fetchData.mockClear();
    click(root, '#ov-news [data-action=retry]');
    await flush();
    expect(fetchData.mock.calls.map((c) => c[0])).toEqual(['hrt-news']);
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
  it('the end of the session freezes the view: the closing line and the way to a new session, no fetches, navigation off, exports on', async () => {
    const onItemCopy = vi.fn();
    const { root, session, fetchData, tick, ticks } = mount({ deps: { onItemCopy } });
    session.join();
    await flush();
    click(root, '[data-action=nav][data-layer=kultura]');
    await flush();
    click(root, '[data-testid=event-row] [data-action=select]');
    fetchData.mockClear();
    session.expire();
    const frozen = root.querySelector<HTMLElement>('[data-testid=frozen-line]')!;
    expect(text(frozen)).toContain('Sesija je završila. Prikaz je zamrznut.');
    expect(frozen.querySelector('a[href="/s/"]')).not.toBeNull();
    expect(text(root.querySelector('[data-testid=countdown]'))).toBe('zamrznuto');
    tick();
    await flush();
    expect(fetchData).not.toHaveBeenCalled();
    expect(ticks.every((t) => t.cleared)).toBe(true);
    click(root, '[data-action=nav][data-layer=vijesti]');
    expect(root.querySelector('#layer-kultura')).not.toBeNull();
    click(root, '[data-action=copy-item]');
    expect(onItemCopy).toHaveBeenCalledTimes(1);
  });
  it('freezes on the clock alone when the socket died and no expired frame arrives', async () => {
    const { root, session, fetchData, tick } = mount();
    session.join();
    await flush();
    fetchData.mockClear();
    session.runOut();
    tick();
    await flush();
    expect(root.querySelector('[data-testid=frozen-line]')).not.toBeNull();
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
    expect(rejected.root.querySelector('[data-testid=frozen-line]')).not.toBeNull();
  });
  it('keeps the frozen view when the clock runs out after a socket drop', async () => {
    const { root, session, fetchData, tick } = mount();
    session.join();
    await flush();
    fetchData.mockClear();
    session.runOut();
    tick();
    await flush();
    expect(root.querySelector('[data-testid=frozen-line]')).not.toBeNull();
    expect(fetchData).not.toHaveBeenCalled();
  });
});

describe('the full map view (transport)', () => {
  it('history fetches the restored domain immediately and mirrors only its public selection', async () => {
    const { session, handle, fetchData } = mount();
    session.join();
    await flush();
    fetchData.mockClear();
    handle.restore('#room=r1&layer=sigurnost&q=private-text');
    await flush();
    expect(fetchData.mock.calls.map((call) => call[0]).sort()).toEqual(['ckan-geo', 'dhmz-cap', 'emsc', 'prometnice']);
    expect(session.sent.at(-1)).toEqual({ layer: 'sigurnost' });
    fetchData.mockClear();
    session.expire();
    handle.restore('#room=r1&layer=vijesti');
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
    click(root, '[data-action=nav][data-layer=kultura]');
    await flush();
    click(root, '[data-testid=event-row] [data-action=select]');
    expect(pushes).toHaveLength(2);
    expect(pushes[1]).toMatch(/room=r1/);
    expect(pushes[1]).toMatch(/layer=kultura&kind=item&id=[0-9a-f]{16}&module=dogadanja/);
    expect(pushes[1]).not.toMatch(/ticket/);
    tick();
    await flush();
    tick();
    await flush();
    expect(pushes).toHaveLength(2); // polls never touch history
    // Back: the browser restores the previous fragment and the entry hands it to the dashboard.
    handle.restore('#room=r1&layer=kultura');
    expect(root.querySelector('.ws-split')?.getAttribute('data-detail-open')).toBe('false');
    expect(pushes).toHaveLength(2);
    click(root, '[data-testid=event-row] [data-action=select]');
    click(root, '[data-testid=event-row] [data-action=select]');
    expect(pushes).toHaveLength(3); // the same selection again replaces instead of pushing
  });
  it('is a view mode on the shell with the session chrome kept; Escape and another domain leave it', async () => {
    const mapFactory = vi.fn(() => ({ update: vi.fn(), destroy: vi.fn(), pause: vi.fn(), resume: vi.fn() }));
    const { root, session, handle } = mount({ mapFactory });
    session.join();
    await flush();
    handle.selectLayer('u-pokretu');
    await flush();
    const dash = root.querySelector<HTMLElement>('.ki')!;
    const button = root.querySelector<HTMLButtonElement>('[data-testid=map-full-toggle]')!;
    button.focus();
    button.click();
    expect(dash.dataset.view).toBe('map');
    expect(mapFactory).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-testid=session-label]')).not.toBeNull();
    dash.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dash.dataset.view).toBe('layers');
    handle.selectLayer('vijesti');
    expect(root.querySelector('[data-testid=map-canvas]')).toBeNull();
    handle.destroy();
  });
});

describe('the sticky header and notices in flow', () => {
  const clock = () => { let at = NOW; return { now: () => at, set(ms: number) { at = ms; } }; };
  const notice = (root: Root, kind?: string): HTMLElement | null =>
    root.querySelector<HTMLElement>(kind ? `[data-testid=notice][data-kind=${kind}]` : '[data-testid=notice]');
  const noticeText = (root: Root, kind: string): string => text(notice(root, kind)?.querySelector('.banner-text'));

  it('groups the wordmark, the session pill and the safety control in one header, and keeps the assertive region visually hidden', () => {
    const { root } = mount();
    const head = root.querySelector<HTMLElement>('header.ki-head');
    expect(head).not.toBeNull();
    expect(head!.querySelector('.ki-wordmark')).not.toBeNull();
    expect(head!.querySelector('[data-testid=session-label]')).not.toBeNull();
    expect(head!.querySelector('[data-testid=safety-shortcut]')).not.toBeNull();
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
  it('confirms the unlock as a success notice with the screen label for four seconds, without a live role', () => {
    const time = clock();
    const { root, session, tick } = mount({ now: time.now });
    session.join();
    expect(noticeText(root, 'joined')).toBe('Otključano do 14:42 · Kavana Velebit');
    expect(notice(root)!.hasAttribute('role')).toBe(false);
    expect(text(root.querySelector('[data-testid=announce-polite]'))).toBe('Otključano do 14:42');
    time.set(NOW + 3_999);
    tick();
    expect(notice(root, 'joined')).not.toBeNull();
    time.set(NOW + 4_000);
    tick();
    expect(notice(root)).toBeNull();
    // A peer session is five minutes from a person, not ten from a screen: the notice says so
    // in its own words, while the polite announcement and the pill keep the plain expiry.
    const peer = mount({ deps: { label: null } });
    peer.session.join('phone');
    expect(noticeText(peer.root, 'joined')).toBe('Pet minuta od osobe pokraj tebe · do 14:42');
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
    expect(root.querySelector('[data-testid=frozen-line]')).not.toBeNull();
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
    expect(notice(root, 'joined')).not.toBeNull();
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
    expect(tabs).toHaveLength(4);
    for (const tab of tabs) expect(tab.getAttribute('tabindex')).toBe('-1');
    const links = [...root.querySelectorAll<HTMLElement>('.ki-side-link[aria-disabled="true"]')];
    expect(links).toHaveLength(6);
    for (const link of links) expect(link.getAttribute('tabindex')).toBe('-1');
    expect(root.querySelector('.ki-side-link[data-layer=sigurnost]')?.getAttribute('tabindex')).toBeNull();
    expect(root.querySelector('[data-testid=safety-shortcut]')?.getAttribute('tabindex')).toBeNull();
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
    const one = mount({ snapshot: failing('hrt-news') });
    one.session.join();
    await flush();
    const banner = one.root.querySelector<HTMLElement>('[data-testid=sources-down]');
    expect(text(banner)).toBe('1 izvor ne odgovara.');
    expect(banner?.getAttribute('role')).toBe('status');
    one.handle.destroy();
    const two = mount({ snapshot: failing('hrt-news', 'emsc') });
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
      click(phone.root, '.ki-tabs [data-action=nav][data-layer=kultura]');
      expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
      expect(document.activeElement?.id).toBe('layer-title-kultura');
      scrollTo.mockClear();
      click(phone.root, '[data-testid=tab-more]');
      click(phone.root, '[data-testid=dir-zrak-i-nebo]');
      expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
      phone.handle.destroy();
      scrollTo.mockClear();
      const desk = mount({ wide: true });
      click(desk.root, '.ki-side-link[data-layer=kultura]');
      expect(scrollTo).not.toHaveBeenCalled();
      desk.handle.destroy();
    } finally {
      win.scrollTo = original;
    }
  });

  // T4.1: the session's moments. The freeze is a designed closing card, the only banner left;
  // a room closed under a live session gets its own card; every frozen workspace is dated.
  it('the freeze leaves one closing card as the only banner: the approved sentence as its title, the hint, and a primary way to a new session', () => {
    const time = clock();
    const { root, session, tick } = mount({ now: time.now });
    session.join();
    time.set(EXPIRES - 20_000);
    tick();
    expect(notice(root, 'expiring20')).not.toBeNull();
    time.set(EXPIRES);
    tick();
    const banners = root.querySelector<HTMLElement>('[data-testid=banners]')!;
    expect(banners.children).toHaveLength(1);
    const card = banners.firstElementChild as HTMLElement;
    expect(card.dataset.testid).toBe('frozen-line');
    expect(card.dataset.key).toBe('frozen');
    expect(card.getAttribute('role')).toBe('alert');
    expect(card.classList.contains('closing')).toBe(true);
    expect(text(card.querySelector('.closing-title'))).toBe(hr.session.expired);
    expect(text(card.querySelector('.banner-sub'))).toBe(hr.session.expiredHint);
    const cta = card.querySelector<HTMLAnchorElement>('a.btn-primary[href="/s/"]')!;
    expect(text(cta)).toBe(hr.session.expiredCta);
    expect(cta.querySelector('svg use')?.getAttribute('href')).toBe('#icon-qr-code');
  });
  it('after the freeze the workspace opens with the snapshot line "podaci od {time}", before the layer, once, and re-said in the other language', () => {
    const time = clock();
    const { root, session, tick } = mount({ now: time.now });
    session.join();
    expect(root.querySelector('.ki-snapshot')).toBeNull();
    time.set(EXPIRES);
    tick();
    const main = root.querySelector<HTMLElement>('[data-testid=dash-view]')!;
    const line = main.firstElementChild as HTMLElement;
    expect(line.classList.contains('ki-snapshot')).toBe(true);
    expect(text(line)).toBe('podaci od 14:42');
    expect(line.nextElementSibling?.id).toBe('layer-grad-sada');
    expect(main.querySelectorAll('.ki-snapshot')).toHaveLength(1);
    click(root, '[data-testid=session-label]');
    click(document, '[data-testid=session-sheet] [data-sheet-action=lang][data-value=en]');
    expect(text(main.querySelector('.ki-snapshot'))).toBe('data from 14:42');
    expect(main.querySelectorAll('.ki-snapshot')).toHaveLength(1);
  });
  it('a room closed under a live session is told apart from a spent ticket: the view freezes behind the revoked card with its own way out', async () => {
    const { root, session, fetchData, tick } = mount();
    session.join();
    await flush();
    fetchData.mockClear();
    session.error('no-ticket', 'revoked');
    const card = root.querySelector<HTMLElement>('[data-testid=frozen-line]');
    expect(card).not.toBeNull();
    expect(text(card!.querySelector('.closing-title'))).toBe(hr.session.revoked);
    expect(text(card!.querySelector('.banner-sub'))).toBe(hr.session.expiredHint);
    expect(text(card!.querySelector('a.btn-primary[href="/s/"]'))).toBe(hr.session.revokedCta);
    expect(root.querySelector('[data-key=no-ticket]')).toBeNull();
    expect(text(root.querySelector('[data-testid=countdown]'))).toBe('zamrznuto');
    expect(text(root.querySelector('.ki-snapshot'))).toBe('podaci od 14:32');
    tick();
    await flush();
    expect(fetchData).not.toHaveBeenCalled();
    // A spent ticket is not a closed room: its warning banner stays and nothing freezes.
    const spent = mount();
    spent.session.join();
    spent.session.error('no-ticket', 'no-ticket');
    expect(spent.root.querySelector('[data-testid=frozen-line]')).toBeNull();
    expect(spent.root.querySelector('[data-key=no-ticket]')).not.toBeNull();
    expect(spent.root.querySelector('.ki-snapshot')).toBeNull();
  });
  it('a closed room reported before any join is a spent credential: the no-ticket banner, nothing frozen, nothing dated', () => {
    const { root, session } = mount();
    session.error('no-ticket', 'revoked');
    expect(root.querySelector('[data-testid=frozen-line]')).toBeNull();
    expect(root.querySelector('[data-key=no-ticket]')).not.toBeNull();
    expect(root.querySelector('.ki-snapshot')).toBeNull();
    expect(text(root.querySelector('[data-testid=countdown]'))).not.toBe('zamrznuto');
  });
  it('the snapshot line dates the data by the end of the session, not by the late moment the end was learnt', () => {
    const time = clock();
    const { root, session } = mount({ now: time.now });
    session.join();
    // A phone whose socket dropped in the background hears of the end five minutes after it.
    time.set(EXPIRES + 5 * 60_000);
    session.expire();
    expect(text(root.querySelector('.ki-snapshot'))).toBe('podaci od 14:42');
    expect(text(root.querySelector('[data-testid=countdown]'))).toBe('zamrznuto');
  });
  it('the visible reconnecting banner says the countdown goes on, while the pill sentence for readers keeps the disconnected line', () => {
    const { root, session } = mount();
    session.join();
    session.drop();
    expect(text(root.querySelector('[data-testid=reconnecting] .banner-text'))).toBe('Veza se obnavlja. Odbrojavanje ide dalje.');
    expect(text(root.querySelector('[data-testid=session-label] .ki-session-sentence'))).toBe(hr.session.disconnected);
  });
  it('the directory session row tells the truth: connecting before the join, the expiry while unlocked, the end once frozen, dated like every workspace', () => {
    const { root, session } = mount();
    click(root, '[data-testid=tab-more]');
    const title = (): string => text(root.querySelector('[data-testid=dir-session] .row-title'));
    expect(title()).toBe(hr.session.connecting);
    session.join();
    expect(title()).toBe('Otključano do 14:42');
    session.expire();
    expect(title()).toBe('Sesija je završila');
    expect(root.querySelector('#layer-directory')).not.toBeNull();
    expect(text(root.querySelector('[data-testid=dash-view] > .ki-snapshot'))).toBe('podaci od 14:32');
  });
});

// T2.3: the header and the sidebar share one wrapper. The phone flattens it
// (display: contents), so the shell grid it lays out is unchanged; the desk
// pins it to the viewport as the rail, with the session card at its foot.
describe('the desktop rail', () => {
  it('wraps the header and the sidebar in one .ki-rail ahead of the banners, main and the tab bar, with every region still found by data-region', () => {
    const { root } = mount();
    const shell = root.querySelector<HTMLElement>('.ki')!;
    const rail = shell.querySelector<HTMLElement>('.ki-rail');
    expect(rail).not.toBeNull();
    expect(rail!.parentElement).toBe(shell);
    expect(rail!.dataset.regionGroup).toBe('rail');
    const head = shell.querySelector<HTMLElement>('header.ki-head')!;
    const side = shell.querySelector<HTMLElement>('nav.ki-side')!;
    expect(head.parentElement).toBe(rail);
    expect(side.parentElement).toBe(rail);
    // The regions painted through the rail: the wordmark, the session card, the seven domain links.
    expect(rail!.querySelector('.ki-top .ki-wordmark')).not.toBeNull();
    expect(rail!.querySelector('.ki-session-slot [data-testid=session-label]')).not.toBeNull();
    expect(rail!.querySelectorAll('.ki-side .ki-side-link')).toHaveLength(7);
    // Document order: rail, banners, main, tab bar; the banners are beside the rail, never inside it.
    const banners = shell.querySelector<HTMLElement>('[data-testid=banners]')!;
    expect(rail!.contains(banners)).toBe(false);
    const order = [...shell.children].filter((el) => el.matches('.ki-rail, .ki-banners, .ki-main, .ki-tabbar')).map((el) => el.className);
    expect(order).toEqual(['ki-rail', 'ki-banners', 'ki-main', 'ki-tabbar']);
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
    click(root, '.ki-tabs [data-action=nav][data-layer=kultura]');
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
    click(root, '.ki-tabs [data-action=nav][data-layer=kultura]');
    expect(main(root).dataset.enter).toBeUndefined();
  });

  it('never sets it on the lightweight path', () => {
    const { root } = mount({ lightweight: true });
    click(root, '.ki-tabs [data-action=nav][data-layer=kultura]');
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
