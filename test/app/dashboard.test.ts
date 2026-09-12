// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import type { LayerId } from '../../worker/protocol';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import type { SessionClient, SessionSnapshot } from '../../app/src/session';
import { LAYER_STORAGE_KEY, mountDashboard, parseSessionHash } from '../../app/src/dashboard';
import { POLL_FALLBACK_MS } from '../../app/src/motion/loop';
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

function mount(opts: { wide?: boolean; onCopy?: (t: string, a: unknown) => void; mapFactory?: unknown; lightweight?: boolean; loadNetwork?: () => Promise<null>; snapshot?: (module: ModuleId) => ModuleSnapshot } = {}) {
  const root = document.createElement('main');
  document.body.replaceChildren(root);
  const session = fakeSession();
  // Every timer registration keeps its own delay and cleared flag (the handle
  // IS the entry), so the poll chain's re-arming and freeze()'s clearing are
  // each provable on their own.
  const ticks: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const fetchData = vi.fn(async (module: ModuleId) => (opts.snapshot ?? snapshotOf)(module));
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
    // The network artefact is never fetched under test (there is no server);
    // null is loadNetwork()'s own honest answer to a failed load.
    loadNetwork: opts.loadNetwork ?? (async () => null),
    setInterval: (fn: () => void, ms: number) => { const t = { fn, ms, cleared: false }; ticks.push(t); return t; },
    clearInterval: (h: unknown) => { (h as { cleared: boolean }).cleared = true; },
  });
  /** Fires every still-armed timer once, whatever its delay. */
  const tick = (): void => { for (const t of [...ticks]) if (!t.cleared) t.fn(); };
  /** The delays of the timers still armed, sorted. */
  const armed = (): number[] => ticks.filter((t) => !t.cleared).map((t) => t.ms).sort((a, b) => a - b);
  return { root, session, handle, fetchData, ticks, tick, armed };
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

describe('the document title (R-M1: /d has no other h1)', () => {
  it('is a visually-hidden, unfocusable-by-tab h1 naming the app and the active layer', () => {
    const { root } = mount();
    const title = root.querySelector<HTMLElement>('[data-testid=dash-title]')!;
    expect(title.tagName).toBe('H1');
    expect(title.parentElement).toBe(root.querySelector('.dash-head'));
    expect(root.querySelector('.dash-head')?.firstElementChild).toBe(title);
    expect(title.classList.contains('visually-hidden')).toBe(true);
    expect(title.tabIndex).toBe(-1);
    expect(text(title)).toBe('Vidikovac · Grad sada');
  });
  it('changes when a tab is chosen', () => {
    const { root } = mount();
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role=tab]')];
    tabs[1]!.click();
    expect(text(root.querySelector('[data-testid=dash-title]'))).toBe('Vidikovac · U pokretu');
  });
  it('receives focus on join, in place of the layer heading', () => {
    const { root, session } = mount();
    session.join();
    expect(document.activeElement).toBe(root.querySelector('[data-testid=dash-title]'));
  });
});

describe('unlock, countdown and announcements', () => {
  it('announces the end time politely', () => {
    const { root, session } = mount();
    session.join();
    expect(text(root.querySelector('[data-testid=announce-polite]'))).toBe('Otključano do 14:42');
    expect(root.querySelector('[data-testid=announce-polite]')?.getAttribute('role')).toBe('status');
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
  // Fix round 1: a returning user whose stored layer never fetches zet-rt
  // (e.g. 'vijesti') must not have the panorama claim zero vehicles — it
  // must say the count is unknown, exactly like kiosk.ts's own panorama
  // distinguishes "no snapshot yet" from "snapshot says zero".
  it('names the panorama "loading data", never a false zero, on a layer that never fetches zet-rt', async () => {
    sessionStorage.setItem(LAYER_STORAGE_KEY, 'vijesti');
    const { root, session } = mount();
    const panorama = root.querySelector('[data-testid=panorama]')!;
    // True even before join: the very first render() paints before any
    // fetch has resolved, so this must never read as a real zero either.
    expect(panorama.getAttribute('aria-label')).toBe('Zagrebačka panorama: učitavanje podataka');
    session.join();
    await flush();
    // Still unknown after the layer's own refresh() lands: 'vijesti' only
    // ever fetches hrt-news, never zet-rt, for the whole session.
    expect(panorama.getAttribute('aria-label')).toBe('Zagrebačka panorama: učitavanje podataka');
  });
  it('reports an honest zero once a zet-rt snapshot has actually loaded', async () => {
    // Default layer is grad-sada, whose module list includes zet-rt.
    const { root, session } = mount();
    session.join();
    await flush();
    const panorama = root.querySelector('[data-testid=panorama]')!;
    expect(panorama.getAttribute('aria-label')).toBe('Zagrebačka panorama: 0 vozila ZET-a u pokretu');
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
    const { root, session, fetchData, tick } = mount();
    session.join();
    await flush();
    expect(fetchData.mock.calls.map((c) => c[0]).sort()).toEqual(['dhmz-cap', 'dhmz-forecast', 'dhmz-now', 'prometnice', 'zet-rt']);
    expect(fetchData.mock.calls[0]![1]).toBe('dt1');
    fetchData.mockClear();
    [...root.querySelectorAll<HTMLButtonElement>('[role=tab]')][6]!.click();
    await flush();
    expect(fetchData.mock.calls.map((c) => c[0])).toEqual(['hrt-news']);
    fetchData.mockClear();
    tick();
    await flush();
    expect(fetchData).toHaveBeenCalledTimes(1);
  });
  it('polls again after the fallback 20 s while no snapshot carries a source timestamp, and 2 s after the feed\'s next tick once one does', async () => {
    const { session, tick, armed } = mount();
    session.join();
    await flush();
    // Armed at mount, before any data: the fixed fallback (beside the 1 s meander tick).
    expect(armed()).toEqual([1_000, POLL_FALLBACK_MS]);
    expect(POLL_FALLBACK_MS).toBe(20_000);

    // A poll whose zet-rt snapshot says the feed ticked 5 s ago: the next
    // request is aimed 2 s past its next 30 s tick, 27 s from now.
    const aligned = mount({ snapshot: (module) => ({ ...snapshotOf(module), ...(module === 'zet-rt' ? { sourceUpdatedAt: new Date(NOW - 5_000).toISOString() } : {}) }) });
    aligned.session.join();
    await flush();
    aligned.tick(); // the first poll fires and re-arms from what it fetched
    await flush();
    expect(aligned.armed()).toEqual([1_000, 27_000]);
  });
  it('"zaustavi osvježavanje" stops the polling and flips its own label', async () => {
    const { root, session, fetchData, tick } = mount();
    session.join();
    await flush();
    const pause = root.querySelector<HTMLButtonElement>('[data-testid=toggle-refresh]')!;
    expect(pause.textContent).toBe('zaustavi osvježavanje');
    pause.click();
    expect(pause.getAttribute('aria-pressed')).toBe('true');
    expect(pause.textContent).toBe('nastavi osvježavanje');
    fetchData.mockClear();
    tick();
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
    const mapFactory = vi.fn(() => ({ update, destroy, pause: vi.fn() }));
    const { handle, session, tick } = mount({ mapFactory });
    handle.selectLayer('u-pokretu');
    session.join();
    await flush();
    tick();
    await flush();
    // R-54: every poll used to allocate a WebGL context, and Chrome drops the
    // oldest after about sixteen — the panel went black mid-session.
    expect(mapFactory).toHaveBeenCalledTimes(1);
    expect(update.mock.calls.length).toBeGreaterThan(0);
    handle.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('freezes on the clock alone when the socket died and no expired frame arrives', async () => {
    const { root, session, fetchData, tick } = mount();
    session.join();
    await flush();
    fetchData.mockClear();
    session.runOut();
    tick();
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
    const { root, session, fetchData, tick } = mount({ onCopy });
    session.join();
    await flush();
    const copy = root.querySelector<HTMLButtonElement>('#grad-sada-observation-copy');
    fetchData.mockClear();
    session.expire();
    tick();
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

// --- T9: the moving map on the dashboard ------------------------------------
describe('the schematic on U pokretu (T9)', () => {
  const NOTE = 'Položaj je izračunat iz vlastitih očitanja svakog vozila i geometrije linije; ZET ne objavljuje smjer ni brzinu.';
  it('mounts one schematic host with the honesty note, keeps it across polls and across tab switches, and asks for the network only once', async () => {
    const loadNetwork = vi.fn(async () => null);
    const { root, handle, session, tick } = mount({ loadNetwork });
    session.join();
    await flush();
    expect(loadNetwork).not.toHaveBeenCalled(); // grad-sada is up: nothing fetched for a layer nobody is looking at (R-L4, and no e-waste)
    handle.selectLayer('u-pokretu');
    await flush();
    const host = root.querySelector('[data-testid=schematic-host]');
    expect(host).not.toBeNull();
    expect(loadNetwork).toHaveBeenCalledTimes(1);
    expect(text(root.querySelector('#u-pokretu-schematic [data-testid=schematic-note]'))).toBe(NOTE);
    tick(); // the poll: a re-render
    await flush();
    expect(root.querySelector('[data-testid=schematic-host]')).toBe(host);
    handle.selectLayer('vijesti');
    expect(root.querySelector('[data-testid=schematic-host]')).toBeNull(); // detached with its panel, not destroyed
    handle.selectLayer('u-pokretu');
    expect(root.querySelector('[data-testid=schematic-host]')).toBe(host);
    expect(loadNetwork).toHaveBeenCalledTimes(1);
  });
  it('renders the list and no canvas on U pokretu in lightweight mode, note included (R-L2)', async () => {
    const { root, handle, session } = mount({ lightweight: true });
    session.join();
    await flush();
    handle.selectLayer('u-pokretu');
    await flush();
    expect(root.querySelectorAll('canvas')).toHaveLength(0);
    expect(root.querySelector('[data-testid=schematic-list]')).not.toBeNull();
    expect(text(root.querySelector('[data-testid=schematic-note]'))).toBe(NOTE);
  });
  it('freeze pauses the map as well as the schematic and leaves no timer armed on the page (R-F6)', async () => {
    const pause = vi.fn();
    const mapFactory = vi.fn(() => ({ update: vi.fn(), destroy: vi.fn(), pause }));
    const { handle, session, ticks } = mount({ mapFactory });
    session.join();
    await flush();
    handle.selectLayer('u-pokretu');
    await flush();
    expect(mapFactory).toHaveBeenCalledTimes(1);
    expect(ticks.some((t) => !t.cleared)).toBe(true);
    session.expire();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(ticks.every((t) => t.cleared)).toBe(true); // neither the poll chain nor the meander tick survives a freeze
  });

  it('stops the motion when the session freezes: the frozen view stays where it was', async () => {
    const { root, handle, session } = mount();
    session.join();
    await flush();
    handle.selectLayer('u-pokretu');
    await flush();
    const view = root.querySelector<HTMLElement>('[data-testid=schematic]')!;
    await new Promise((r) => requestAnimationFrame(r));
    session.expire();
    const frozenAt = view.dataset.frames;
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    expect(view.dataset.frames).toBe(frozenAt);
  });
});

// --- T10: the full map ------------------------------------------------------
describe('the full map (T10)', () => {
  const fakeMap = () => vi.fn(() => ({ update: vi.fn(), destroy: vi.fn() }));
  async function onUPokretu(opts: Parameters<typeof mount>[0]) {
    const mounted = mount(opts);
    mounted.session.join();
    await flush();
    mounted.handle.selectLayer('u-pokretu');
    await flush();
    return mounted;
  }

  it('full-screen is a view mode on the dashboard itself, never the Fullscreen API: the meander stays above the map, Escape leaves', async () => {
    const { root } = await onUPokretu({ mapFactory: fakeMap() });
    const dash = root.querySelector<HTMLElement>('.dash')!;
    expect(dash.dataset.view).toBe('layers');
    const button = root.querySelector<HTMLButtonElement>('[data-testid=map-full-toggle]')!;
    button.focus();
    button.click();
    expect(dash.dataset.view).toBe('map');
    expect(document.fullscreenElement ?? null).toBeNull();
    // The meander figure is still a child of the same dashboard, before the
    // map in document order, and not hidden: pinned above it by construction.
    const meander = root.querySelector<HTMLElement>('.dash-meander')!;
    const canvas = root.querySelector<HTMLElement>('[data-testid=map-canvas]')!;
    expect(meander.closest('.dash')).toBe(dash);
    expect(meander.hidden).toBe(false);
    expect(Boolean(meander.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    const again = root.querySelector<HTMLButtonElement>('[data-testid=map-full-toggle]')!;
    expect(text(again)).toBe('Skupi kartu');
    expect(document.activeElement).toBe(again); // focus survives the re-render
    dash.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dash.dataset.view).toBe('layers');
    expect(text(root.querySelector('[data-testid=map-full-toggle]'))).toBe('Proširi kartu');
  });

  it('leaves the full map when another layer is opened', async () => {
    const { root, handle } = await onUPokretu({ mapFactory: fakeMap() });
    root.querySelector<HTMLButtonElement>('[data-testid=map-full-toggle]')!.click();
    const dash = root.querySelector<HTMLElement>('.dash')!;
    expect(dash.dataset.view).toBe('map');
    handle.selectLayer('vijesti');
    expect(dash.dataset.view).toBe('layers');
  });

  // Fix round 1: on the wide grid select() does not re-render (all seven
  // layers are already in the DOM), so a programmatic tab change that left
  // the view mode used to keep a button still reading "Skupi kartu".
  it('on the wide grid, leaving the full map through a tab change re-renders so the button reads the state it leads to', async () => {
    const { root, handle } = await onUPokretu({ mapFactory: fakeMap(), wide: true });
    const dash = root.querySelector<HTMLElement>('.dash')!;
    const button = root.querySelector<HTMLButtonElement>('[data-testid=map-full-toggle]')!;
    button.click();
    expect(dash.dataset.view).toBe('map');
    expect(text(root.querySelector('[data-testid=map-full-toggle]'))).toBe('Skupi kartu');
    handle.selectLayer('vijesti');
    expect(dash.dataset.view).toBe('layers');
    // The wide grid still holds the U pokretu panel and its button; it must
    // have been re-rendered, not left stale.
    const after = root.querySelector<HTMLButtonElement>('[data-testid=map-full-toggle]')!;
    expect(after).not.toBeNull();
    expect(text(after)).toBe('Proširi kartu');
    expect(root.querySelectorAll('.layer')).toHaveLength(7);
  });

  it('lightweight: never creates a map, renders no map panel and no button (R-L2)', async () => {
    const mapFactory = fakeMap();
    const { root } = await onUPokretu({ mapFactory, lightweight: true });
    expect(mapFactory).not.toHaveBeenCalled();
    expect(root.querySelector('#u-pokretu-map')).toBeNull();
    expect(root.querySelector('[data-testid=map-fallback]')).toBeNull();
    expect(root.querySelector('[data-testid=map-full-toggle]')).toBeNull();
    expect(root.querySelector('[data-testid=schematic-list]')).not.toBeNull(); // the honest face stands in
  });

  it('the map and the schematic share one network fetch', async () => {
    const loadNetwork = vi.fn(async () => null);
    const mapFactory = fakeMap();
    await onUPokretu({ mapFactory, loadNetwork });
    expect(loadNetwork).toHaveBeenCalledTimes(1);
    const options = (mapFactory.mock.calls[0] as unknown as [{ loadNetwork?: () => Promise<null> }])[0];
    expect(options.loadNetwork).toBeTypeOf('function');
    await options.loadNetwork!();
    await options.loadNetwork!();
    expect(loadNetwork).toHaveBeenCalledTimes(1);
  });
});
