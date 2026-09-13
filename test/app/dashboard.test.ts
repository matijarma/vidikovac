// @vitest-environment happy-dom
// The /d/ shell on the real core stores: navigation, session states, polling
// aligned to the feed, reconciliation that keeps focus and typed text, the
// session sheet, sharing, expiry and exports. Every browser global is injected.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import type { LayerId } from '../../worker/protocol';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import type { SessionClient, SessionSnapshot } from '../../app/src/session';
import { LAYER_STORAGE_KEY, mountDashboard, parseSessionHash, type DashboardDeps } from '../../app/src/dashboard';
import { POLL_FALLBACK_MS } from '../../app/src/motion/loop';
import { stubSessionStorage } from './helpers';

stubSessionStorage();

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb
const EXPIRES = NOW + 10 * 60_000; // 14:42

function fakeSession() {
  const listeners = {
    joined: [] as ((s: SessionSnapshot) => void)[], expiring: [] as ((n: number) => void)[], expired: [] as (() => void)[],
    count: [] as ((n: number) => void)[], codes: [] as ((batch: unknown[], serverNow: number) => void)[],
    error: [] as ((code: string) => void)[], close: [] as ((code: number) => void)[],
  };
  let snapshot: SessionSnapshot = { phase: 'connecting', role: null, expiresAt: null, dataToken: null, participants: 0, secondsLeft: 0 };
  let runOut = false;
  const sent: { layer: LayerId; params?: Record<string, string> }[] = [];
  const events: { name: string; dim?: string }[] = [];
  const client: SessionClient = {
    connect: vi.fn(), snapshot: () => snapshot, serverNow: () => NOW,
    secondsLeft: () => (runOut ? 0 : Math.max(0, Math.floor(((snapshot.expiresAt ?? NOW) - NOW) / 1000))),
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
    error: (code: string) => listeners.error.forEach((l) => l(code)),
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
  deps?: Partial<DashboardDeps>;
}

function mount(opts: MountOptions = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const session = fakeSession();
  const ticks: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const fetchData = vi.fn(async (module: ModuleId, _token: string) => (opts.snapshot ?? snapshotOf)(module));
  const handle = mountDashboard(root, {
    i18n: createDefaultI18n('hr'), session: session.client, now: () => NOW, fetchData: fetchData as never,
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
    const { root } = mount();
    click(root, '[data-testid=tab-more]');
    expect(root.querySelector('#layer-directory')).not.toBeNull();
    expect([...root.querySelectorAll('.dir-item')].map((a) => a.getAttribute('data-layer'))).toEqual(['zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'vijesti']);
    expect(root.querySelector('[data-testid=tab-more]')?.getAttribute('aria-expanded')).toBe('true');
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
    expect(text(scanner.root.querySelector('[data-testid=dash-title]'))).toBe('Kaj ima? · Now');
    expect([...scanner.root.querySelectorAll('.ki-tabs .ki-tab')].map((t) => text(t))).toEqual(['Now', 'Transit', 'Events', 'More']);
    scanner.handle.destroy();

    const peer = mount();
    peer.session.join('phone');
    click(peer.root, '[data-testid=session-label]');
    expect(document.querySelector('[data-testid=session-sheet] [data-testid=share-city]')).toBeNull();
  });
  it('rotates the peer code as a QR with the letters, and withdraws sharing on the room’s refusal', () => {
    const slot = (code: string, index: number) => ({ code, slotStart: NOW + index * 30_000, slotEnd: NOW + (index + 1) * 30_000 });
    const { root, session } = mount();
    session.join();
    session.codes([slot('ABCDEFGH', 0), slot('JKMNPQRS', 1)], NOW);
    const dialog = document.querySelector<HTMLElement>('[data-testid=share-dialog]')!;
    expect(text(dialog.querySelector('[data-testid=share-code]'))).toBe('ABCD-EFGH');
    expect(dialog.querySelector('.qr')?.getAttribute('role')).toBe('img');
    expect(text(dialog)).toContain('Dobiva vlastitih pet minuta; tvoje se vrijeme ne mijenja.');
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
});

describe('the full map view (transport)', () => {
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
