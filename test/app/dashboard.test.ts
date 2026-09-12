// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import type { LayerId } from '../../worker/protocol';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import type { SessionClient, SessionSnapshot } from '../../app/src/session';
import { LAYER_STORAGE_KEY, mountDashboard, parseSessionHash, POLL_MS } from '../../app/src/dashboard';
import { stubSessionStorage } from './helpers';

// See stubSessionStorage's doc comment: Node's own `sessionStorage` global
// shadows happy-dom's real one under this vitest version.
stubSessionStorage();

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb
const EXPIRES = NOW + 10 * 60_000; // 14:42

function fakeSession() {
  const listeners = {
    joined: [] as ((s: SessionSnapshot) => void)[],
    expiring: [] as ((n: number) => void)[],
    expired: [] as (() => void)[],
    view: [] as ((l: LayerId) => void)[],
    count: [] as ((n: number) => void)[],
    codes: [] as ((batch: unknown[], serverNow: number) => void)[],
    error: [] as ((code: string) => void)[],
  };
  let snapshot: SessionSnapshot = { phase: 'connecting', role: null, expiresAt: null, dataToken: null, participants: 0, secondsLeft: 0 };
  let runOut = false;
  const sent: { layer: LayerId }[] = [];
  const events: { name: string; dim?: string }[] = [];
  const client: SessionClient = {
    connect: vi.fn(),
    snapshot: () => snapshot,
    serverNow: () => NOW,
    secondsLeft: () => (runOut ? 0 : Math.max(0, Math.floor(((snapshot.expiresAt ?? NOW) - NOW) / 1000))),
    onJoined: (l) => { listeners.joined.push(l); return () => {}; },
    onExpiring: (l) => { listeners.expiring.push(l); return () => {}; },
    onExpired: (l) => { listeners.expired.push(l); return () => {}; },
    onView: (l) => { listeners.view.push(l as never); return () => {}; },
    onCodes: (l) => { listeners.codes.push(l as never); return () => {}; },
    onCount: (l) => { listeners.count.push(l); return () => {}; },
    onError: (l) => { listeners.error.push(l); return () => {}; },
    onClose: () => () => {},
    sendView: (layer) => { sent.push({ layer }); },
    share: vi.fn(),
    event: (name, dim) => { events.push({ name, dim }); },
    close: vi.fn(),
  };
  return {
    client, sent, events,
    join() {
      snapshot = { phase: 'live', role: 'scanner', expiresAt: EXPIRES, dataToken: 'dt1', participants: 2, secondsLeft: 600 };
      listeners.joined.forEach((l) => l(snapshot));
    },
    expiring: (n: number) => listeners.expiring.forEach((l) => l(n)),
    expire() {
      snapshot = { ...snapshot, phase: 'expired' };
      listeners.expired.forEach((l) => l());
    },
    view: (l: LayerId) => listeners.view.forEach((fn) => fn(l)),
    /** The clock passes the expiry with no 'expired' frame: a dropped socket. */
    runOut() { runOut = true; },
    /** A room another phone opened: RoomDO reports role 'phone' (roleFor). */
    joinAsPeer() {
      snapshot = { phase: 'live', role: 'phone', expiresAt: EXPIRES, dataToken: 'dt1', participants: 2, secondsLeft: 300 };
      listeners.joined.forEach((l) => l(snapshot));
    },
    codes: (batch: unknown[], serverNow: number) => listeners.codes.forEach((l) => l(batch, serverNow)),
    error: (code: string) => listeners.error.forEach((l) => l(code)),
  };
}

const snapshotOf = (module: ModuleId): ModuleSnapshot => ({
  module, tier: 'open', status: 'live', fetchedAt: new Date(NOW - 30_000).toISOString(),
  attribution: { text: `Izvor: ${module}`, url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' },
  items: [],
});

function mount(opts: { wide?: boolean; onCopy?: (t: string, a: unknown) => void; mapFactory?: unknown; lightweight?: boolean } = {}) {
  const root = document.createElement('main');
  document.body.replaceChildren(root);
  const session = fakeSession();
  const ticks: (() => void)[] = [];
  const fetchData = vi.fn(async (module: ModuleId) => snapshotOf(module));
  const handle = mountDashboard(root, {
    i18n: createDefaultI18n('hr'),
    session: session.client,
    now: () => NOW,
    fetchData: fetchData as never,
    wide: opts.wide ?? false,
    label: 'Kavana Velebit',
    onCopy: opts.onCopy,
    mapFactory: opts.mapFactory as never,
    lightweight: opts.lightweight ?? false,
    setInterval: (fn: () => void) => { ticks.push(fn); return ticks.length; },
    clearInterval: () => { ticks.length = 0; },
  });
  return { root, session, handle, fetchData, ticks };
}
const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

beforeEach(() => {
  sessionStorage.clear();
});

describe('parseSessionHash', () => {
  it('reads room, ticket and label from the fragment C4 navigates to', () => {
    expect(parseSessionHash('#room=r1&ticket=t1&label=Kavana%20Velebit')).toEqual({ roomId: 'r1', ticket: 't1', label: 'Kavana Velebit' });
    expect(parseSessionHash('#room=r2&label=phone')).toEqual({ roomId: 'r2', ticket: null, label: 'phone' });
    expect(parseSessionHash('#nothing')).toBeNull();
    expect(parseSessionHash('')).toBeNull();
  });
});

describe('layer switcher', () => {
  it('renders seven tabs in the contract order with roving tabindex', () => {
    const { root } = mount();
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role=tab]')];
    expect(tabs.map((t) => t.dataset.layer)).toEqual(['grad-sada', 'u-pokretu', 'zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'kultura', 'vijesti']);
    expect(tabs[0]!.textContent).toBe('Grad sada');
    expect(root.querySelector('[role=tablist]')?.getAttribute('aria-label')).toBe('Slojevi');
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]!.tabIndex).toBe(0);
    expect(tabs[1]!.tabIndex).toBe(-1);
  });
  it('arrow keys, Home and End move selection and wrap', () => {
    const { root, session } = mount();
    const list = root.querySelector('[role=tablist]')!;
    const tab = (i: number) => [...root.querySelectorAll<HTMLButtonElement>('[role=tab]')][i]!;
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(tab(1).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab(1));
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(tab(6).getAttribute('aria-selected')).toBe('true');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(tab(0).getAttribute('aria-selected')).toBe('true');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(tab(6).getAttribute('aria-selected')).toBe('true');
    expect(session.sent.at(-1)).toEqual({ layer: 'vijesti' });
    expect(session.events.at(-1)).toEqual({ name: 'panel_open', dim: 'vijesti' });
  });
  it('shows one layer on a narrow viewport and all seven on a wide one', () => {
    const narrow = mount({ wide: false });
    expect(narrow.root.querySelectorAll('.layer')).toHaveLength(1);
    const wide = mount({ wide: true });
    expect(wide.root.querySelectorAll('.layer')).toHaveLength(7);
  });
});

describe('unlock, countdown and announcements', () => {
  it('announces the end time politely and moves focus to the layer heading', () => {
    const { root, session } = mount();
    session.join();
    expect(text(root.querySelector('[data-testid=announce-polite]'))).toBe('Otključano do 14:42');
    expect(root.querySelector('[data-testid=announce-polite]')?.getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(root.querySelector('#layer-title-grad-sada'));
    const label = root.querySelector<HTMLElement>('[data-testid=session-label]')!;
    expect(text(label)).toBe('Otključano · Kavana Velebit · do 14:42');
    // The same expiry the screen carries, to the millisecond (R-52).
    expect(label.dataset.expiresAt).toBe(String(EXPIRES));
  });
  it('shows a minute-grain countdown and the session ring', () => {
    const { root, session } = mount();
    session.join();
    const time = root.querySelector<HTMLTimeElement>('[data-testid=countdown]')!;
    expect(time.textContent).toBe('10 minuta');
    expect(time.getAttribute('datetime')).toBe('PT600S');
    expect(root.querySelector('[data-testid=session-ring]')?.getAttribute('aria-hidden')).toBe('true');
  });
  // R-58: the room sends 'expiring' at 60 s and at 20 s, and the accessibility
  // statement promises exactly those two marks. The 20 s frame used to fall
  // through the 60 s branch and was never announced at all.
  it('warns at 60 s politely and at 20 s assertively, with the approved sentences', () => {
    const { root, session } = mount();
    session.join();
    session.expiring(60);
    expect(text(root.querySelector('[data-testid=announce-polite]'))).toBe('Još minuta. Ono što gledaš ostaje na zaslonu i nakon isteka.');
    session.expiring(20);
    const alert = root.querySelector('[data-testid=announce-assertive]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(text(alert)).toBe('Još dvadeset sekundi.');
  });
});

describe('the panorama and the session meander (M4)', () => {
  it('shows the fine minutes:seconds line beside the promoted countdown after join', () => {
    const { root, session } = mount();
    session.join();
    expect(text(root.querySelector('[data-testid=countdown-fine]'))).toBe('· još 10:00');
  });
  it('names the expiry time in the meander legend', () => {
    const { root, session } = mount();
    session.join();
    expect(text(root.querySelector('[data-testid=meander-legend]'))).toBe('SL. 1 — MEANDAR SESIJE · ISPRAZNI SE DO 14:42');
  });
  it('gives the panorama an img role and a non-empty label', () => {
    const { root } = mount();
    const panorama = root.querySelector('[data-testid=panorama]')!;
    expect(panorama.getAttribute('role')).toBe('img');
    expect(panorama.getAttribute('aria-label')).not.toBe('');
    expect(panorama.tagName).toBe('CANVAS');
  });
  it('renders no canvas anywhere in lightweight mode, and the meander bar carries the quantised width', () => {
    const { root, session } = mount({ lightweight: true });
    expect(root.querySelectorAll('canvas')).toHaveLength(0);
    const panorama = root.querySelector('[data-testid=panorama]')!;
    expect(panorama.tagName).toBe('DIV');
    expect(panorama.getAttribute('role')).toBe('img');
    session.join();
    // A fresh 10-minute join is a full meander; the bar is still a plain DIV.
    const bar = root.querySelector<HTMLElement>('[data-testid=session-ring]')!;
    expect(bar.tagName).toBe('DIV');
    expect(bar.style.width).toBe('100%');
    expect(root.querySelectorAll('canvas')).toHaveLength(0);
  });
  it('"sakrij odbrojavanje" also hides the fine line and the whole meander figure, recorded on the root dataset', () => {
    const { root, session, handle } = mount();
    session.join();
    const toggle = root.querySelector<HTMLButtonElement>('[data-testid=toggle-countdown]')!;
    toggle.click();
    expect(handle.element.dataset.countdown).toBe('hidden');
    expect(root.querySelector<HTMLElement>('[data-testid=countdown-fine]')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.dash-meander')!.hidden).toBe(true);
    toggle.click();
    expect(handle.element.dataset.countdown).toBe('shown');
    expect(root.querySelector<HTMLElement>('[data-testid=countdown-fine]')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.dash-meander')!.hidden).toBe(false);
  });
});

describe('polling and the two toggles', () => {
  it('fetches exactly the modules of the visible layer with the data token', async () => {
    const { root, session, fetchData, ticks } = mount();
    session.join();
    await flush();
    expect(fetchData.mock.calls.map((c) => c[0]).sort()).toEqual(['dhmz-cap', 'dhmz-forecast', 'dhmz-now', 'prometnice', 'zet-rt']);
    expect(fetchData.mock.calls[0]![1]).toBe('dt1');
    fetchData.mockClear();
    [...root.querySelectorAll<HTMLButtonElement>('[role=tab]')][6]!.click();
    await flush();
    expect(fetchData.mock.calls.map((c) => c[0])).toEqual(['hrt-news']);
    fetchData.mockClear();
    ticks.forEach((tick) => tick());
    await flush();
    expect(fetchData).toHaveBeenCalledTimes(1);
    expect(POLL_MS).toBe(20_000);
  });
  it('"zaustavi osvježavanje" stops the polling and flips its own label', async () => {
    const { root, session, fetchData, ticks } = mount();
    session.join();
    await flush();
    const pause = root.querySelector<HTMLButtonElement>('[data-testid=toggle-refresh]')!;
    expect(pause.textContent).toBe('zaustavi osvježavanje');
    pause.click();
    expect(pause.getAttribute('aria-pressed')).toBe('true');
    expect(pause.textContent).toBe('nastavi osvježavanje');
    fetchData.mockClear();
    ticks.forEach((tick) => tick());
    await flush();
    expect(fetchData).not.toHaveBeenCalled();
    expect(text(root.querySelector('[data-testid=refresh-state]'))).toBe('osvježavanje zaustavljeno');
  });
  it('"sakrij odbrojavanje" hides the timer without ending the session', () => {
    const { root, session } = mount();
    session.join();
    const toggle = root.querySelector<HTMLButtonElement>('[data-testid=toggle-countdown]')!;
    expect(toggle.textContent).toBe('sakrij odbrojavanje');
    toggle.click();
    expect(root.querySelector<HTMLElement>('[data-testid=countdown]')!.hidden).toBe(true);
    expect(toggle.textContent).toBe('pokaži odbrojavanje');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('expiry freeze', () => {
  it('keeps one live map across polls instead of re-creating it', async () => {
    const update = vi.fn();
    const destroy = vi.fn();
    const mapFactory = vi.fn(() => ({ update, destroy }));
    const { handle, session, ticks } = mount({ mapFactory });
    handle.selectLayer('u-pokretu');
    session.join();
    await flush();
    ticks.forEach((tick) => tick());
    await flush();
    // R-54: every poll used to allocate a WebGL context, and Chrome drops the
    // oldest after about sixteen — the panel went black mid-session.
    expect(mapFactory).toHaveBeenCalledTimes(1);
    expect(update.mock.calls.length).toBeGreaterThan(0);
    handle.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('freezes on the clock alone when the socket died and no expired frame arrives', async () => {
    const { root, session, fetchData, ticks } = mount();
    session.join();
    await flush();
    fetchData.mockClear();
    session.runOut();
    ticks.forEach((tick) => tick());
    await flush();
    // R-53: the izjava promises the closing line; the socket cannot be trusted
    // to deliver it from a phone that spent a minute in the camera app.
    const frozen = root.querySelector<HTMLElement>('[data-testid=frozen-line]');
    expect(frozen?.hidden).toBe(false);
    expect(text(frozen)).toContain('Sesija je završila.');
    expect(fetchData).not.toHaveBeenCalled();
    for (const tab of root.querySelectorAll<HTMLButtonElement>('[role=tab]')) expect(tab.disabled).toBe(true);
  });

  it('stops polling, disables navigation, keeps exports and states the frozen view', async () => {
    const onCopy = vi.fn();
    const { root, session, fetchData, ticks } = mount({ onCopy });
    session.join();
    await flush();
    const copy = root.querySelector<HTMLButtonElement>('#grad-sada-observation-copy');
    fetchData.mockClear();
    session.expire();
    ticks.forEach((tick) => tick());
    await flush();
    expect(fetchData).not.toHaveBeenCalled();
    for (const tab of root.querySelectorAll<HTMLButtonElement>('[role=tab]')) expect(tab.disabled).toBe(true);
    const frozen = root.querySelector<HTMLElement>('[data-testid=frozen-line]');
    expect(frozen?.hidden).toBe(false);
    expect(text(frozen)).toBe('Sesija je završila. Prikaz je zamrznut. Zaslon u blizini otključava novih deset minuta.');
    expect(root.querySelector('[data-testid=countdown]')?.textContent).toBe('0 minuta');
    expect(copy?.disabled).toBe(false);
    copy?.click();
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});

describe('Podijeli grad', () => {
  const slot = (code: string, index: number) => ({ code, slotStart: NOW + index * 30_000, slotEnd: NOW + (index + 1) * 30_000 });

  it('offers the action to the person who scanned the screen and to nobody else', () => {
    const scanner = mount();
    expect(scanner.root.querySelector<HTMLButtonElement>('[data-testid=share-city]')!.hidden).toBe(true);
    scanner.session.join();
    const button = scanner.root.querySelector<HTMLButtonElement>('[data-testid=share-city]')!;
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe('Podijeli grad');

    const peer = mount();
    peer.session.joinAsPeer();
    expect(peer.root.querySelector<HTMLButtonElement>('[data-testid=share-city]')!.hidden).toBe(true);
  });

  it('asks the room for peer codes and rotates them as a QR with the code in letters', () => {
    const { root, session } = mount();
    session.join();
    root.querySelector<HTMLButtonElement>('[data-testid=share-city]')!.click();
    expect(session.client.share).toHaveBeenCalledTimes(1);
    session.codes([slot('ABCDEFGH', 0), slot('JKMNPQRS', 1)], NOW);
    const dialog = document.querySelector<HTMLElement>('[data-testid=share-dialog]')!;
    expect(dialog).not.toBeNull();
    expect(text(dialog.querySelector('[data-testid=share-code]'))).toBe('ABCD-EFGH');
    expect(dialog.querySelector('.qr')?.getAttribute('role')).toBe('img');
    // The approved copy: five minutes of their own, and the asker's time is untouched.
    expect(text(dialog)).toContain('Dobiva vlastitih pet minuta; tvoje se vrijeme ne mijenja.');
  });

  it('withdraws the action when the room says this session is already the second hop', () => {
    const { root, session } = mount();
    session.join();
    session.error('share-not-allowed');
    expect(root.querySelector<HTMLButtonElement>('[data-testid=share-city]')!.hidden).toBe(true);
    expect(text(root.querySelector('[data-testid=announce-assertive]'))).toBe(
      'Ova je sesija dobivena od druge osobe i ne može se dalje dijeliti.',
    );
  });
});

describe('remembering the last layer (R-60)', () => {
  const selectedLayer = (root: HTMLElement): string | undefined =>
    [...root.querySelectorAll<HTMLButtonElement>('[role=tab]')].find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.layer;

  it('remembers the layer the user switched to and opens it at the next unlock', () => {
    const first = mount();
    first.root.querySelector<HTMLButtonElement>('[role=tab][data-layer=sigurnost]')!.click();
    expect(selectedLayer(first.root)).toBe('sigurnost');
    first.handle.destroy();

    const second = mount();
    expect(selectedLayer(second.root)).toBe('sigurnost');
    expect(sessionStorage.getItem(LAYER_STORAGE_KEY)).toBe('sigurnost');
  });

  it('ignores an invalid stored value and opens the default layer instead', () => {
    sessionStorage.setItem(LAYER_STORAGE_KEY, 'not-a-real-layer');
    const { root } = mount();
    expect(selectedLayer(root)).toBe('grad-sada');
  });
});
