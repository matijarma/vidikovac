// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import type { CodeSlot } from '../../worker/protocol';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { BEACON_STORAGE_KEY } from '../../app/src/beacon';
import { mountKiosk, safetyStripText, TEASER_ROTATE_MS, teaserCards } from '../../app/src/kiosk';
import { LJEKARNE } from '../../worker/hitno/ljekarne';

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb
const attr = (text: string) => ({ text, url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' });
const snap = (module: ModuleId, items: ModuleSnapshot['items']): ModuleSnapshot => ({
  module, tier: 'open', status: 'live', fetchedAt: new Date(NOW - 30_000).toISOString(),
  attribution: attr(`Izvor: ${module}`), items,
});
const MODULES: ModuleSnapshot[] = [
  snap('dhmz-now', [{ id: 'o1', module: 'dhmz-now', kind: 'observation', tier: 'open', title: 'Maksimir', data: { temp: 21, weather: 'vedro' } }]),
  snap('dhmz-cap', [{ id: 'w1', module: 'dhmz-cap', kind: 'warning', tier: 'open', title: 'Grmljavina', severity: 'moderate' }]),
  snap('prometnice', [{ id: 'c1', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Grada Vukovara' }]),
  snap('hrt-news', [{ id: 'n1', module: 'hrt-news', kind: 'news', tier: 'open', title: 'Naslov vijesti', link: 'https://vijesti.hrt.hr/clanak' }]),
  snap('ckan-geo', [{ id: 'p1', module: 'ckan-geo', kind: 'poi', tier: 'open', title: 'Ljekarna Centar, Ilica 1', data: { category: 'ljekarne', duty: 'da' } }]),
];

function batch(start: number, count = 20): CodeSlot[] {
  return Array.from({ length: count }, (_, i) => ({ code: `ABCDEFG${i % 10}`, slotStart: start + i * 30_000, slotEnd: start + (i + 1) * 30_000 }));
}

function mount(opts: { hash?: string; stored?: string | null; reducedMotion?: boolean; fetchTeaser?: () => Promise<{ modules: ModuleSnapshot[] }> } = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const raw: Record<string, string> = {};
  if (opts.stored) raw[BEACON_STORAGE_KEY] = opts.stored;
  const storage = { getItem: (k: string) => raw[k] ?? null, setItem: (k: string, v: string) => { raw[k] = v; }, removeItem: (k: string) => { delete raw[k]; } };
  const beacon = { connect: vi.fn(), requestMore: vi.fn(), status: () => 'live' as const, close: vi.fn() };
  let handlers: Parameters<NonNullable<Parameters<typeof mountKiosk>[1]['createBeacon']>>[0] | null = null;
  const timers: (() => void)[] = [];
  const requestFullscreen = vi.fn(async () => {});
  const requestWakeLock = vi.fn(async () => {});
  let sessionExpired: (() => void) | null = null;
  let sessionView: ((layer: string) => void) | null = null;
  const sessions: { close: ReturnType<typeof vi.fn> }[] = [];
  const handle = mountKiosk(root, {
    i18n: createDefaultI18n('hr'),
    hash: opts.hash ?? '',
    storage,
    now: () => NOW,
    codeBase: 'https://zagreb.aningfilm.hr',
    reducedMotion: opts.reducedMotion ?? false,
    fetchTeaser: opts.fetchTeaser ?? (async () => ({ modules: MODULES })),
    fetchData: async (module: ModuleId) => snap(module, []),
    createBeacon: (deps) => { handlers = deps; return beacon; },
    createSession: () => {
      const s = { connect: vi.fn(), snapshot: () => ({ phase: 'live', role: 'kiosk', expiresAt: NOW + 600_000, dataToken: 'dt1', participants: 2, secondsLeft: 600 }), serverNow: () => NOW, secondsLeft: () => 600, onJoined: (l: (snapshot: unknown) => void) => { queueMicrotask(() => l({ phase: 'live', role: 'kiosk', expiresAt: NOW + 600_000, dataToken: 'dt1', participants: 2, secondsLeft: 600 })); return () => {}; }, onExpiring: () => () => {}, onExpired: (l: () => void) => { sessionExpired = l; return () => {}; }, onView: (l: (layer: string) => void) => { sessionView = l; return () => {}; }, onCodes: () => () => {}, onCount: () => () => {}, onError: () => () => {}, onClose: () => () => {}, sendView: vi.fn(), share: vi.fn(), event: vi.fn(), close: vi.fn() };
      sessions.push(s);
      return s as ReturnType<NonNullable<Parameters<typeof mountKiosk>[1]['createSession']>>;
    },
    setInterval: (fn: () => void) => { timers.push(fn); return timers.length; },
    clearInterval: () => {},
    requestFullscreen,
    requestWakeLock,
  });
  return {
    root, handle, beacon, timers, storage, raw, requestFullscreen, requestWakeLock, sessions,
    get handlers() { return handlers!; },
    expire: () => sessionExpired?.(),
    view: (layer: string) => sessionView?.(layer),
  };
}
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('teaser content', () => {
  const i18n = createDefaultI18n('hr');
  it('builds weather, departures, air, one HRT headline and the invitation, in that order', () => {
    const cards = teaserCards(MODULES, i18n, NOW);
    expect(cards.map((c) => c.id)).toEqual(['weather', 'departures', 'air', 'news', 'invitation']);
    expect(cards[0]!.title).toBe('Vrijeme sada');
    expect(cards[0]!.body).toContain('21 °C');
    expect(cards[1]!.body).toBe('Uskoro u sljedećoj fazi.');
    expect(cards[2]!.body).toBe('Uskoro u sljedećoj fazi.');
    expect(cards[3]!.body).toBe('Naslov vijesti');
    expect(cards[3]!.attribution?.text).toBe('Izvor: hrt-news');
    expect(cards[4]!.body).toBe('Skeniraj za 10 minuta pogleda na Zagreb. Plaćaš pažnjom, ne novcem.');
  });
  it('the safety strip states the warning, the closure count and the on-duty pharmacy', () => {
    const strip = safetyStripText(MODULES, i18n);
    expect(strip.cap).toBe('žuto upozorenje · Grmljavina');
    expect(strip.closures).toBe('1 zatvaranje');
    expect(strip.pharmacy).toBe('Ljekarna Centar, Ilica 1');
    expect(safetyStripText([], i18n).cap).toBe('Nema upozorenja za Zagrebačku regiju.');
  });
  it('falls back to the curated on-duty pharmacy list when no feed tags one (the real-world case: ckan-geo never sets category)', () => {
    const withoutPharmacyTag = MODULES.map((m) =>
      m.module === 'ckan-geo'
        ? snap('ckan-geo', [{ id: 'p1', module: 'ckan-geo', kind: 'poi', tier: 'open', title: 'Gradska četvrt Centar', data: { layer: 'gradske-cetvrti' } }])
        : m,
    );
    expect(safetyStripText(withoutPharmacyTag, i18n).pharmacy).toBe(LJEKARNE[0]!.label);
    expect(safetyStripText([], i18n).pharmacy).toBe(LJEKARNE[0]!.label);
  });
});

describe('mountKiosk', () => {
  it('refuses to work unprovisioned and says what to do', () => {
    const { root, beacon } = mount();
    expect(text(root.querySelector('[role=alert]'))).toBe('Ovaj zaslon nije postavljen. Otvori poveznicu za postavljanje s administratorskog računa.');
    expect(beacon.connect).not.toHaveBeenCalled();
  });
  it('stores the credentials from the fragment and connects', () => {
    const { raw, beacon } = mount({ hash: '#BEACON01.tajna' });
    expect(JSON.parse(raw[BEACON_STORAGE_KEY]!)).toEqual({ beaconId: 'BEACON01', secret: 'tajna' });
    expect(beacon.connect).toHaveBeenCalledTimes(1);
  });
  it('shows the current code as two groups of four with a QR of the scan URL', () => {
    const { root, handlers } = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
    handlers.onCodes(batch(NOW), NOW);
    expect(text(root.querySelector('[data-testid=code-a]'))).toBe('ABCD');
    expect(text(root.querySelector('[data-testid=code-b]'))).toBe('EFG0');
    const qr = root.querySelector('[data-testid=kiosk-qr] .qr')!;
    expect(qr.getAttribute('role')).toBe('img');
    expect(qr.getAttribute('aria-label')).toContain('A B C D, E F G 0');
    expect(root.querySelector('svg')).not.toBeNull();
  });
  it('asks the beacon for more codes when the rotation runs low', () => {
    const { beacon, handlers } = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
    handlers.onCodes(batch(NOW - 17 * 30_000), NOW);
    expect(beacon.requestMore).toHaveBeenCalledTimes(1);
  });
  it('rotates teaser cards every twenty seconds and pins the safety strip', async () => {
    const { root, timers } = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
    await flush();
    expect(TEASER_ROTATE_MS).toBe(20_000);
    expect(text(root.querySelector('[data-testid=teaser-card]'))).toContain('Vrijeme sada');
    timers.forEach((tick) => tick());
    expect(text(root.querySelector('[data-testid=teaser-card]'))).toContain('Sljedeći polasci');
    expect(text(root.querySelector('[data-testid=safety-strip]'))).toContain('žuto upozorenje');
    expect(text(root.querySelector('[data-testid=safety-strip]'))).toContain('Ljekarna Centar, Ilica 1');
  });
  it('the ring animates by default and becomes static segments under reduced motion', () => {
    const plain = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
    plain.handlers.onCodes(batch(NOW), NOW);
    expect(plain.root.querySelector('[data-testid=code-ring]')?.getAttribute('data-motion')).toBe('sweep');
    const still = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }), reducedMotion: true });
    still.handlers.onCodes(batch(NOW), NOW);
    const ring = still.root.querySelector('[data-testid=code-ring]')!;
    expect(ring.getAttribute('data-motion')).toBe('segments');
    expect(ring.querySelectorAll('[data-testid=ring-segment]')).toHaveLength(6);
  });
  it('asks for fullscreen and a wake lock on the first tap only', () => {
    const { root, requestFullscreen, requestWakeLock } = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
    root.querySelector('[data-testid=kiosk]')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    root.querySelector('[data-testid=kiosk]')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestWakeLock).toHaveBeenCalledTimes(1);
  });
  it('joins the room on unlock, renders the driver layer with a corner QR, and returns to the teaser on expiry', async () => {
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
    k.handlers.onCodes(batch(NOW), NOW);
    k.handlers.onUnlocked({ roomId: 'r1', ticket: 't1', expiresAt: NOW + 600_000 });
    await flush();
    expect(k.root.querySelector('[data-testid=kiosk]')?.getAttribute('data-mode')).toBe('unlocked');
    k.view('vijesti');
    await flush();
    expect(k.root.querySelector('[data-layer=vijesti]')).not.toBeNull();
    expect(k.root.querySelector('[data-testid=corner-qr] .qr')).not.toBeNull();
    k.expire();
    expect(k.root.querySelector('[data-testid=kiosk]')?.getAttribute('data-mode')).toBe('teaser');
    expect(text(k.root.querySelector('[data-testid=teaser-card]'))).toContain('Vrijeme sada');
  });
  it('closes the previous session before opening the next one on a mid-session hand-off', async () => {
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
    k.handlers.onCodes(batch(NOW), NOW);
    k.handlers.onUnlocked({ roomId: 'r1', ticket: 't1', expiresAt: NOW + 600_000 });
    await flush();
    expect(k.sessions).toHaveLength(1);
    // The corner QR keeps minting codes while unlocked; a second scan (the
    // next person joining) must not leak the first RoomDO connection.
    k.handlers.onUnlocked({ roomId: 'r2', ticket: 't2', expiresAt: NOW + 600_000 });
    await flush();
    expect(k.sessions).toHaveLength(2);
    expect(k.sessions[0]!.close).toHaveBeenCalledTimes(1);
    expect(k.sessions[1]!.close).not.toHaveBeenCalled();
  });
  it('a beacon reconnect does not dismiss an unrelated teaser-outage alert', async () => {
    const { root, handlers } = mount({
      stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }),
      fetchTeaser: async () => { throw new Error('down'); },
    });
    await flush();
    expect((root.querySelector('[data-testid=kiosk-alert]') as HTMLElement).hidden).toBe(false);
    handlers.onStatus('offline');
    handlers.onStatus('live'); // the beacon recovers; the teaser fetch is still failing
    expect((root.querySelector('[data-testid=kiosk-alert]') as HTMLElement).hidden).toBe(false);
    expect(text(root.querySelector('[data-testid=kiosk-alert]'))).toBe('izvor nedostupan');
  });
  it('a recovered teaser fetch clears its own outage alert on the next successful poll', async () => {
    let fail = true;
    const { root, timers } = mount({
      stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }),
      fetchTeaser: async () => {
        if (fail) throw new Error('down');
        return { modules: MODULES };
      },
    });
    await flush();
    expect((root.querySelector('[data-testid=kiosk-alert]') as HTMLElement).hidden).toBe(false);
    fail = false;
    timers.forEach((tick) => tick());
    await flush();
    expect((root.querySelector('[data-testid=kiosk-alert]') as HTMLElement).hidden).toBe(true);
  });
});
