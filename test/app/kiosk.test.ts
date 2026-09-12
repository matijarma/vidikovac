// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import type { CodeSlot } from '../../worker/protocol';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import type { I18n } from '../../app/src/i18n/i18n';
import { BEACON_STORAGE_KEY } from '../../app/src/beacon';
import { catalogueRows, ESSENTIALS_IDLE_MS, essentialsRows, mountKiosk, safetyStripText, TEASER_ROTATE_MS, teaserCards } from '../../app/src/kiosk';
import { zagrebTime, zagrebWeekdayDate } from '../../app/src/format';
import { POLL_FALLBACK_MS } from '../../app/src/motion/loop';
import { LJEKARNE, LJEKARNE_SOURCE } from '../../worker/hitno/ljekarne';

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
  snap('emsc', [{ id: 'q1', module: 'emsc', kind: 'quake', tier: 'open', title: 'Potres magnitude 1,6', at: '2026-09-11T10:11:00Z', data: { mag: 1.6, depth: 10, region: 'CROATIA' } }]),
  snap('hrt-news', [{ id: 'n1', module: 'hrt-news', kind: 'news', tier: 'open', title: 'Naslov vijesti', link: 'https://vijesti.hrt.hr/clanak' }]),
  snap('ckan-geo', [{ id: 'p1', module: 'ckan-geo', kind: 'poi', tier: 'open', title: 'Ljekarna Centar, Ilica 1', data: { category: 'ljekarne', duty: 'da' } }]),
  // The teaser's reduced zet-rt shape (registry.teaserSubset): one summary
  // item carrying the live count, the same shape vehicleCount() and the
  // panorama/catalogue read.
  snap('zet-rt', [{ id: 'vozila', module: 'zet-rt', kind: 'vehicle', tier: 'open', title: '156 vozila u pokretu', data: { vehicles: 156 } }]),
  // The teaser's reduced dogadanja shape (registry.teaserSubset): only the
  // Otvorena dozvola city rows, in the module's own soonest-first order.
  snap('dogadanja', [
    { id: 'skupstina:13', module: 'dogadanja', kind: 'event', tier: 'session', title: '13. sjednica Gradske skupštine', at: '2026-09-17T07:00:00Z', link: 'https://skupstina.zagreb.hr/sjednica/13', data: { source: 'skupstina', precision: 'time' } },
    { id: 'zet-promet:1', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Obilazak linija 6 i 11', at: '2026-09-11T09:10:00Z', data: { source: 'zet-promet', precision: 'time' } },
    { id: 'komunalne:1', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Ilica 1', at: '2026-07-02T00:00:00Z', data: { source: 'komunalne', phase: 'u tijeku', amount: 1000, precision: 'day' } },
  ]),
];

// Every code in a real batch is distinct; the rotation merges batches by code
// (R-51), so a fixture that repeated one would silently lose slots.
const CODE_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function batch(start: number, count = 20): CodeSlot[] {
  return Array.from({ length: count }, (_, i) => ({
    code: `ABCDEFG${CODE_CHARS[i]}`,
    slotStart: start + i * 30_000,
    slotEnd: start + (i + 1) * 30_000,
  }));
}

function mount(opts: { hash?: string; stored?: string | null; reducedMotion?: boolean; lightweight?: boolean; fetchTeaser?: () => Promise<{ modules: ModuleSnapshot[] }>; loadNetwork?: () => Promise<null>; mapFactory?: unknown; i18n?: I18n } = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const raw: Record<string, string> = {};
  if (opts.stored) raw[BEACON_STORAGE_KEY] = opts.stored;
  const storage = { getItem: (k: string) => raw[k] ?? null, setItem: (k: string, v: string) => { raw[k] = v; }, removeItem: (k: string) => { delete raw[k]; } };
  const beacon = { connect: vi.fn(), requestMore: vi.fn(), status: () => 'live' as const, close: vi.fn() };
  let handlers: Parameters<NonNullable<Parameters<typeof mountKiosk>[1]['createBeacon']>>[0] | null = null;
  // Every setInterval registration keeps its own delay and its own cleared
  // flag (the handle IS the entry, so clearInterval just flags it) instead of
  // one flat list of callbacks: the essentials idle timer (ESSENTIALS_IDLE_MS)
  // shares this same injected pair with the meander tick and the 20s
  // rotation, and its arm/rearm/cancel behaviour has to be provable on its
  // own, by delay, rather than firing every registered timer at once.
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const requestFullscreen = vi.fn(async () => {});
  const requestWakeLock = vi.fn(async () => {});
  let sessionExpired: (() => void) | null = null;
  let sessionView: ((layer: string) => void) | null = null;
  let secondsLeft = 600;
  const fetchData = vi.fn(async (module: ModuleId) => snap(module, []));
  const sessions: { close: ReturnType<typeof vi.fn> }[] = [];
  const handle = mountKiosk(root, {
    i18n: opts.i18n ?? createDefaultI18n('hr'),
    hash: opts.hash ?? '',
    storage,
    now: () => NOW,
    codeBase: 'https://zagreb.aningfilm.hr',
    reducedMotion: opts.reducedMotion ?? false,
    lightweight: opts.lightweight ?? false,
    fetchTeaser: opts.fetchTeaser ?? (async () => ({ modules: MODULES })),
    // The network artefact is never fetched under test; null is loadNetwork()'s
    // own honest answer to a failed load (every vehicle free-planes).
    loadNetwork: opts.loadNetwork ?? (async () => null),
    mapFactory: opts.mapFactory as never,
    fetchData,
    createBeacon: (deps) => { handlers = deps; return beacon; },
    createSession: () => {
      const s = { connect: vi.fn(), snapshot: () => ({ phase: 'live', role: 'kiosk', expiresAt: NOW + 600_000, dataToken: 'dt1', participants: 2, secondsLeft: 600 }), serverNow: () => NOW, secondsLeft: () => secondsLeft, onJoined: (l: (snapshot: unknown) => void) => { queueMicrotask(() => l({ phase: 'live', role: 'kiosk', expiresAt: NOW + 600_000, dataToken: 'dt1', participants: 2, secondsLeft: 600 })); return () => {}; }, onExpiring: () => () => {}, onExpired: (l: () => void) => { sessionExpired = l; return () => {}; }, onView: (l: (layer: string) => void) => { sessionView = l; return () => {}; }, onCodes: () => () => {}, onCount: () => () => {}, onError: () => () => {}, onClose: () => () => {}, sendView: vi.fn(), share: vi.fn(), event: vi.fn(), close: vi.fn() };
      sessions.push(s);
      return s as ReturnType<NonNullable<Parameters<typeof mountKiosk>[1]['createSession']>>;
    },
    setInterval: (fn: () => void, ms: number) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearInterval: (h: unknown) => { (h as { cleared: boolean }).cleared = true; },
    requestFullscreen,
    requestWakeLock,
  });
  return {
    root, handle, beacon, timers, storage, raw, requestFullscreen, requestWakeLock, sessions, fetchData,
    get handlers() { return handlers!; },
    expire: () => sessionExpired?.(),
    view: (layer: string) => sessionView?.(layer),
    runOut: () => { secondsLeft = 0; },
    // The latest still-armed (not cleared) registration at a given delay —
    // used to reach the essentials idle timer (ESSENTIALS_IDLE_MS)
    // specifically, distinct from the meander tick and the 20s rotation that
    // share this same injected setInterval/clearInterval pair.
    fire: (ms: number) => [...timers].reverse().find((t) => t.ms === ms && !t.cleared),
  };
}
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('teaser content', () => {
  const i18n = createDefaultI18n('hr');
  it('builds weather, the last quake, the closure count, one HRT headline, one city row and the invitation, in that order', () => {
    const cards = teaserCards(MODULES, i18n, NOW);
    // R-59: every card is live open-tier data; no "Uskoro" sign on a public screen.
    expect(cards.map((c) => c.id)).toEqual(['weather', 'quake', 'closures', 'news', 'city', 'invitation']);
    expect(cards[0]!.title).toBe('Vrijeme sada');
    expect(cards[0]!.body).toContain('21 °C');
    expect(cards[1]!.title).toBe('Posljednji potres');
    expect(cards[1]!.body).toBe('M 1.6 · CROATIA');
    expect(cards[1]!.attribution?.text).toBe('Izvor: emsc');
    expect(cards[2]!.title).toBe('Zatvorene prometnice');
    expect(cards[2]!.body).toBe('1 zatvaranje');
    expect(cards[2]!.attribution?.text).toBe('Izvor: prometnice');
    expect(cards[3]!.body).toBe('Naslov vijesti');
    expect(cards[3]!.attribution?.text).toBe('Izvor: hrt-news');
    expect(cards[4]!.title).toBe('Grad javlja');
    expect(cards[4]!.body).toBe('13. sjednica Gradske skupštine · čet 17. 9. 2026.');
    expect(cards[4]!.attribution).toEqual({
      text: 'Izvor: Skupština Grada Zagreba (Otvorena dozvola)',
      url: 'https://skupstina.zagreb.hr/sjednica/13',
      licence: 'Otvorena dozvola (NN 67/17)',
    });
    expect(cards[5]!.body).toBe('Skeniraj za 10 minuta grada. Manje ekrana, više Zagreba.');
    expect(cards.some((c) => c.body === i18n.t('kiosk.teaserSoon'))).toBe(false);
  });
  it('says so honestly when the quake feed is empty or still loading', () => {
    const empty = teaserCards([...MODULES.filter((m) => m.module !== 'emsc'), snap('emsc', [])], i18n, NOW);
    expect(empty[1]!.body).toBe('Nema zabilježenih potresa u posljednjih 7 dana.');
    const loading = teaserCards(MODULES.filter((m) => m.module !== 'emsc' && m.module !== 'prometnice'), i18n, NOW);
    expect(loading[1]!.body).toBe('učitavanje podataka');
    expect(loading[2]!.body).toBe('učitavanje podataka');
  });
  it('the city card carries only Otvorena dozvola rows, labels a komunalne last-change date as such and stamps a ZET notice with its publish time', () => {
    const city = (items: ModuleSnapshot['items']) =>
      teaserCards([...MODULES.filter((m) => m.module !== 'dogadanja'), snap('dogadanja', items)], i18n, NOW).find((c) => c.id === 'city')!;
    const rows = MODULES.find((m) => m.module === 'dogadanja')!.items;
    // A CC BY-SA row that somehow reached the payload is still never shown: the card filters by licence itself.
    const kulturpunkt = { id: 'kulturpunkt:1', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Koncert u Močvari', at: '2026-09-12T18:00:00Z', data: { source: 'kulturpunkt' } } as const;
    expect(city([kulturpunkt, ...rows]).body).toBe('13. sjednica Gradske skupštine · čet 17. 9. 2026.');
    expect(city([kulturpunkt]).body).toBe('Trenutačno nema gradskih obavijesti.');
    expect(city([kulturpunkt]).attribution?.text).toBe('Izvor: dogadanja'); // the payload's own module statement, as the closures card does
    expect(city([]).body).toBe('Trenutačno nema gradskih obavijesti.');
    // ZET: publish time, to the minute, as its precision says.
    const zet = city(rows.filter((r) => r.id.startsWith('zet-')));
    expect(zet.body).toBe('Obilazak linija 6 i 11 · objavljeno 11. 9. 11:10');
    expect(zet.attribution?.text).toBe('Izvor: ZET (Otvorena dozvola)');
    // komunalne: the register's last-change stamp is labelled, never shown as a scheduled date (E7).
    const works = city(rows.filter((r) => r.id.startsWith('komunalne')));
    expect(works.body).toBe('Ilica 1 · zadnja izmjena čet 2. 7. 2026.');
    expect(works.attribution?.text).toBe('Izvor: Plan komunalnih aktivnosti, Grad Zagreb (Otvorena dozvola)');
    // Nothing loaded yet: the same honest word every other card uses.
    expect(teaserCards(MODULES.filter((m) => m.module !== 'dogadanja'), i18n, NOW).find((c) => c.id === 'city')!.body).toBe('učitavanje podataka');
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
    // The end-to-end contract (R-52): the whole code in one element, and the
    // QR's payload as a real link carrying it in the fragment.
    expect(text(root.querySelector('[data-testid=pair-code]'))).toBe('ABCD-EFG0');
    const link = root.querySelector<HTMLAnchorElement>('[data-testid=pair-url]')!;
    expect(link.getAttribute('href')).toBe('https://zagreb.aningfilm.hr/s#ABCD-EFG0');
    expect(link.hidden).toBe(false);
  });
  it('keeps the code link out of the page until there is a code to link to', () => {
    const { root } = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
    // A link with no text is a serious axe violation, and the kiosk page is
    // loaded without a session in the accessibility run.
    expect(root.querySelector<HTMLAnchorElement>('[data-testid=pair-url]')!.hidden).toBe(true);
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
    timers.forEach((t) => { if (!t.cleared) t.fn(); });
    expect(text(root.querySelector('[data-testid=teaser-card]'))).toContain('Posljednji potres');
    expect(text(root.querySelector('[data-testid=safety-strip]'))).toContain('žuto upozorenje');
    expect(text(root.querySelector('[data-testid=safety-strip]'))).toContain('Ljekarna Centar, Ilica 1');
  });
  it('never splits a live news headline into a two-tone headline: only the invitation card gets that treatment', async () => {
    // A realistic HRT headline with Croatian date notation ("11. rujna"),
    // which contains a bare ". " that is not a sentence boundary.
    const headline = 'Gradska skupština 11. rujna donijela odluku o prometnicama.';
    const newsModules = MODULES.map((m) =>
      m.module === 'hrt-news' ? { ...m, items: [{ ...m.items[0]!, title: headline }] } : m,
    );
    const { root, timers } = mount({ fetchTeaser: async () => ({ modules: newsModules }) });
    await flush();
    // Rotate weather -> quake -> closures -> news (three rotations).
    timers.forEach((t) => { if (!t.cleared) t.fn(); });
    timers.forEach((t) => { if (!t.cleared) t.fn(); });
    timers.forEach((t) => { if (!t.cleared) t.fn(); });
    const card = root.querySelector('[data-testid=teaser-card]')!;
    expect(text(card)).toContain(headline);
    expect(card.querySelector('.teaser-tagline')).toBeNull();
  });
  it('the meander is a canvas that sweeps by default, on a fresh slot', () => {
    const plain = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
    plain.handlers.onCodes(batch(NOW), NOW);
    const ring = plain.root.querySelector('[data-testid=code-ring]')!;
    expect(ring.tagName).toBe('CANVAS');
    expect(ring.getAttribute('data-motion')).toBe('sweep');
    // A fresh slot has just started (elapsed 0), so the full interval remains.
    expect(ring.getAttribute('data-pct')).toBe('1.00');
  });
  it('quantises to ten steps under reduced motion, still on a canvas', () => {
    const still = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }), reducedMotion: true });
    // The batch's first slot started 7s ago: 7/30 of the interval elapsed.
    still.handlers.onCodes(batch(NOW - 7_000), NOW);
    const ring = still.root.querySelector('[data-testid=code-ring]')!;
    expect(ring.tagName).toBe('CANVAS');
    expect(ring.getAttribute('data-motion')).toBe('segments');
    expect(ring.getAttribute('data-pct')).toBe('0.70');
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
    const label = k.root.querySelector<HTMLElement>('[data-testid=session-label]')!;
    expect(label).not.toBeNull();
    expect(label.dataset.expiresAt).toBe(String(NOW + 600_000));
    expect(text(label)).toBe('Otključano do 14:42');
    k.expire();
    expect(k.root.querySelector('[data-testid=kiosk]')?.getAttribute('data-mode')).toBe('teaser');
    // Gone from the DOM, not merely hidden: a screen back on the teaser must
    // not still claim it is unlocked (R-52).
    expect(k.root.querySelector('[data-testid=session-label]')).toBeNull();
    expect(text(k.root.querySelector('[data-testid=teaser-card]'))).toContain('Vrijeme sada');
  });
  it('re-polls the driver’s layer on every tick while unlocked', async () => {
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
    k.handlers.onCodes(batch(NOW), NOW);
    k.handlers.onUnlocked({ roomId: 'r1', ticket: 't1', expiresAt: NOW + 600_000 });
    await flush();
    k.fetchData.mockClear();
    k.timers.forEach((t) => { if (!t.cleared) t.fn(); });
    await flush();
    // R-55: the big screen is the one nobody touches, so it has to move itself.
    expect(k.fetchData).toHaveBeenCalled();
    expect(k.root.querySelector('[data-testid=kiosk]')?.getAttribute('data-mode')).toBe('unlocked');
  });

  it('returns to the teaser when the room’s clock runs out, with or without an expired frame', async () => {
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
    k.handlers.onCodes(batch(NOW), NOW);
    k.handlers.onUnlocked({ roomId: 'r1', ticket: 't1', expiresAt: NOW + 600_000 });
    await flush();
    // The room socket dies (Wi-Fi blip) so no 'expired' ever arrives (R-53).
    k.runOut();
    k.timers.forEach((t) => { if (!t.cleared) t.fn(); });
    await flush();
    expect(k.root.querySelector('[data-testid=kiosk]')?.getAttribute('data-mode')).toBe('teaser');
    expect(k.root.querySelector('[data-testid=session-label]')).toBeNull();
    expect(k.sessions[0]!.close).toHaveBeenCalled();
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
    timers.forEach((t) => { if (!t.cleared) t.fn(); });
    await flush();
    expect((root.querySelector('[data-testid=kiosk-alert]') as HTMLElement).hidden).toBe(true);
  });
  it('keeps polling the teaser even when the load rejects outright: a failure past its own catch is logged and the next poll is still armed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The fetch is down and the outage alert cannot even be painted (its copy
    // throws), so loadTeaser rejects past its own catch. The chain must not
    // depend on that catch: the poll is re-armed regardless.
    const real = createDefaultI18n('hr');
    const i18n: I18n = { ...real, t: (key, vars) => { if (key === 'status.down') throw new Error('copy unavailable'); return real.t(key, vars); } };
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }), i18n, fetchTeaser: async () => { throw new Error('down'); } });
    // The rotation is armed synchronously at mount; the poll only once the first load has settled.
    const rotation = k.timers.filter((t) => t.ms === TEASER_ROTATE_MS);
    expect(rotation).toHaveLength(1);
    await flush();
    // The chain is alive: a fallback poll registered beside the rotation, not counted through it.
    expect(k.timers.filter((t) => !t.cleared && t.ms === POLL_FALLBACK_MS && t !== rotation[0])).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledTimes(1); // and the failure was reported, not swallowed
    errorSpy.mockRestore();
  });
  it('the header shows the clock and the Croatian weekday date', () => {
    const { root } = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
    expect(text(root.querySelector('[data-testid=kiosk-date]'))).toBe(zagrebWeekdayDate(NOW));
    expect(text(root.querySelector('[data-testid=kiosk-clock]'))).toBe(zagrebTime(NOW));
  });
  it("the panorama's caption and its aria-label are identical and both name the live vehicle count", async () => {
    const { root } = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
    await flush();
    const canvas = root.querySelector('[data-testid=panorama]')!;
    const legend = root.querySelector('[data-testid=panorama-legend]')!;
    expect(text(legend)).toContain('156 U POKRETU');
    expect(text(legend)).toContain('14:32');
    expect(canvas.getAttribute('aria-label')).toBe(text(legend));
  });
  it('shows the honest loading legend, with no count, before the first teaser poll resolves', () => {
    const { root } = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
    expect(text(root.querySelector('[data-testid=panorama-legend]'))).toBe('SL. 1 — ZAGREBAČKA PANORAMA · UČITAVANJE PODATAKA');
  });
  it("the catalogue renders three rows with the fixture's values", async () => {
    const { root } = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
    await flush();
    const catalogue = text(root.querySelector('[data-testid=kiosk-catalogue]'));
    expect(catalogue).toContain('MAKSIMIR SADA');
    expect(catalogue).toContain('21 °C');
    expect(catalogue).toContain('vedro');
    expect(catalogue).toContain('ZET U POKRETU');
    expect(catalogue).toContain('156');
    expect(catalogue).toContain('vozila');
    expect(catalogue).toContain('PROMETNICE');
    expect(catalogue).toContain('zatvorena');
  });
  it('lightweight mode renders no canvas anywhere in the kiosk, and the meander bar carries the quantised width', () => {
    const { root, handlers } = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }), lightweight: true });
    expect(root.querySelectorAll('canvas')).toHaveLength(0);
    // 9s of a 30s slot elapsed -> 70% of the interval remains, quantised to
    // ten steps even though reducedMotion was never set (R-L1/R-L2: lightweight
    // alone forces quantisation).
    handlers.onCodes(batch(NOW - 9_000), NOW);
    const bar = root.querySelector<HTMLElement>('[data-testid=code-ring]')!;
    expect(bar.tagName).toBe('DIV');
    expect(bar.style.width).toBe('70%');
    expect(root.querySelectorAll('canvas')).toHaveLength(0);
  });

  describe('the essentials view (R-P7 / M3b: a locked kiosk answers without a phone)', () => {
    it('carries the essentials-open button on a locked kiosk, and hides it the moment a session goes live', async () => {
      const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
      await flush();
      const btn = k.root.querySelector<HTMLButtonElement>('[data-testid=kiosk-essentials-open]')!;
      expect(btn).not.toBeNull();
      expect(btn.hidden).toBe(false);
      k.handlers.onCodes(batch(NOW), NOW);
      k.handlers.onUnlocked({ roomId: 'r1', ticket: 't1', expiresAt: NOW + 600_000 });
      await flush();
      expect(k.root.querySelector<HTMLButtonElement>('[data-testid=kiosk-essentials-open]')!.hidden).toBe(true);
      // A programmatic click can't be stopped by `hidden` alone (a real
      // screen never dispatches one on a hidden button, but the guard in
      // openEssentials() has to be the real reason, not just CSS): the panel
      // stays shut even so, because the driver's own layer already shows
      // more than this (R-P7).
      k.root.querySelector<HTMLButtonElement>('[data-testid=kiosk-essentials-open]')!.click();
      expect(k.root.querySelector<HTMLElement>('[data-testid=kiosk-essentials]')!.hidden).toBe(true);
    });

    it('clicking it reveals the panel, hides the stage, focuses the heading, and shows the rows with no raw brace in any attribution', async () => {
      const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
      await flush();
      k.root.querySelector<HTMLButtonElement>('[data-testid=kiosk-essentials-open]')!.click();
      const panel = k.root.querySelector<HTMLElement>('[data-testid=kiosk-essentials]')!;
      const stage = k.root.querySelector<HTMLElement>('[data-testid=kiosk-stage]')!;
      expect(panel.hidden).toBe(false);
      expect(stage.hidden).toBe(true);
      expect(document.activeElement?.getAttribute('id')).toBe('ess-title');
      const rows = text(k.root.querySelector('[data-testid=kiosk-essentials-rows]'));
      expect(rows).toContain('žuto upozorenje');
      expect(rows).toContain('Grmljavina');
      expect(rows).toContain('1 zatvaranje');
      expect(rows).toContain('Grada Vukovara');
      expect(rows).toContain('21 °C');
      const attrs = [...k.root.querySelectorAll('[data-testid=kiosk-essentials-rows] .ess-attr')];
      expect(attrs.length).toBeGreaterThan(0);
      expect(attrs.every((el) => !(el.textContent ?? '').includes('{'))).toBe(true);
    });

    it('Escape closes the panel, restores the stage and returns focus to the open button', async () => {
      const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
      await flush();
      const btn = k.root.querySelector<HTMLButtonElement>('[data-testid=kiosk-essentials-open]')!;
      btn.click();
      const panel = k.root.querySelector<HTMLElement>('[data-testid=kiosk-essentials]')!;
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(panel.hidden).toBe(true);
      expect(k.root.querySelector<HTMLElement>('[data-testid=kiosk-stage]')!.hidden).toBe(false);
      expect(document.activeElement).toBe(btn);
    });

    it('the close button also closes it', async () => {
      const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
      await flush();
      k.root.querySelector<HTMLButtonElement>('[data-testid=kiosk-essentials-open]')!.click();
      k.root.querySelector<HTMLButtonElement>('[data-testid=kiosk-essentials-close]')!.click();
      expect(k.root.querySelector<HTMLElement>('[data-testid=kiosk-essentials]')!.hidden).toBe(true);
    });

    it('advancing the injected idle timer by 90 s closes the panel on its own', async () => {
      const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
      await flush();
      k.root.querySelector<HTMLButtonElement>('[data-testid=kiosk-essentials-open]')!.click();
      expect(ESSENTIALS_IDLE_MS).toBe(90_000);
      const idle = k.fire(ESSENTIALS_IDLE_MS)!;
      idle.fn();
      expect(k.root.querySelector<HTMLElement>('[data-testid=kiosk-essentials]')!.hidden).toBe(true);
      expect(k.root.querySelector<HTMLElement>('[data-testid=kiosk-stage]')!.hidden).toBe(false);
    });

    it('a pointerdown inside the panel cancels the ninety-second clock and arms a fresh one, postponing the close', async () => {
      const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
      await flush();
      k.root.querySelector<HTMLButtonElement>('[data-testid=kiosk-essentials-open]')!.click();
      const panel = k.root.querySelector<HTMLElement>('[data-testid=kiosk-essentials]')!;
      const firstIdle = k.fire(ESSENTIALS_IDLE_MS)!;
      // Standing in at 80s of a 90s clock: the touch has to cancel that clock
      // outright, not merely be ignored by it.
      panel.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(firstIdle.cleared).toBe(true);
      expect(panel.hidden).toBe(false);
      const secondIdle = k.fire(ESSENTIALS_IDLE_MS)!;
      expect(secondIdle).not.toBe(firstIdle);
      secondIdle.fn();
      expect(panel.hidden).toBe(true);
    });

    it('a keydown inside the panel also rearms the idle clock, but Escape closes instead of rearming', async () => {
      const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
      await flush();
      k.root.querySelector<HTMLButtonElement>('[data-testid=kiosk-essentials-open]')!.click();
      const panel = k.root.querySelector<HTMLElement>('[data-testid=kiosk-essentials]')!;
      const firstIdle = k.fire(ESSENTIALS_IDLE_MS)!;
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(firstIdle.cleared).toBe(true);
      expect(panel.hidden).toBe(false);
    });

    it('with every module down, the panel renders exactly one row: the honest sentence', async () => {
      const down = (module: ModuleId): ModuleSnapshot => ({
        module, tier: 'open', status: 'down', fetchedAt: new Date(NOW).toISOString(), attribution: attr(''), items: [],
      });
      const k = mount({
        stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }),
        fetchTeaser: async () => ({ modules: (['dhmz-cap', 'prometnice', 'zet-rt', 'dhmz-now', 'ckan-geo'] as ModuleId[]).map(down) }),
      });
      await flush();
      k.root.querySelector<HTMLButtonElement>('[data-testid=kiosk-essentials-open]')!.click();
      const rowEls = k.root.querySelectorAll('[data-testid=kiosk-essentials-rows] [data-testid=ess-row]');
      expect(rowEls).toHaveLength(1);
      expect(text(k.root.querySelector('[data-testid=kiosk-essentials-rows]'))).toBe('Izvor trenutačno ne odgovara. Sigurnosni sloj radi na /hitno.');
    });
  });
});

describe('catalogueRows', () => {
  const i18n = createDefaultI18n('hr');
  it('returns Maksimir, ZET and Prometnice with the fixture values and Croatian plural units', () => {
    const rows = catalogueRows(MODULES, i18n);
    expect(rows.map((r) => r.label)).toEqual(['MAKSIMIR SADA', 'ZET U POKRETU', 'PROMETNICE']);
    expect(rows[0]!.value).toBe('21 °C');
    expect(rows[0]!.unit).toBe('vedro');
    expect(rows[1]!.value).toBe('156');
    expect(rows[1]!.unit).toBe('vozila');
    expect(rows[2]!.value).toBe('1');
    expect(rows[2]!.unit).toBe('zatvorena'); // count 1 -> Croatian "one" category
  });
  it('shows an honest loading state for closures when the prometnice module has not loaded, never a claimed zero', () => {
    const rows = catalogueRows(MODULES.filter((m) => m.module !== 'prometnice'), i18n);
    const row = rows.find((r) => r.id === 'closures')!;
    // Mirrors the weather row two lines up and the vehicles row: an absent
    // snapshot is "loading", not a rendered "0".
    expect(row.value).toBe(i18n.t('status.loading'));
    expect(row.unit).toBe('');
  });
});

describe('essentialsRows (R-P7 / M3b)', () => {
  const i18n = createDefaultI18n('hr');
  it('builds the CAP warning, the closure count with its nearest street, and the Maksimir observation from the fixture, each with a filled attribution and no raw brace', () => {
    const rows = essentialsRows(MODULES, i18n, NOW);
    // The fixture's zet-rt teaser subset carries only the whole-fleet vehicle
    // count, no pins inside the box, so 'routes' is legitimately absent here
    // (skipped outright, not shown empty) — a dedicated test below covers it
    // once vehicle pins are present.
    expect(rows.map((r) => r.id)).toEqual(['cap', 'closures', 'weather', 'pharmacy']);
    const cap = rows.find((r) => r.id === 'cap')!;
    expect(cap.label).toBe('Upozorenja');
    expect(cap.value).toBe('žuto upozorenje');
    expect(cap.detail).toBe('Grmljavina');
    const closures = rows.find((r) => r.id === 'closures')!;
    expect(closures.label).toBe('Zatvorene prometnice');
    expect(closures.value).toBe('1 zatvaranje');
    expect(closures.detail).toBe('Grada Vukovara');
    const weather = rows.find((r) => r.id === 'weather')!;
    expect(weather.label).toBe('MAKSIMIR SADA');
    expect(weather.value).toBe('21 °C');
    expect(weather.detail).toBe('vedro');
    const pharmacy = rows.find((r) => r.id === 'pharmacy')!;
    expect(pharmacy.value).toBe('Ljekarna Centar, Ilica 1');
    expect(rows.every((r) => !(r.attribution ?? '').includes('{'))).toBe(true);
  });

  it('fills a templated attribution from the snapshot and the item, leaving no raw brace behind', () => {
    const templated = MODULES.map((m) =>
      m.module === 'dhmz-cap' ? { ...m, attribution: { ...m.attribution, text: 'Izvor: {naslov}, {vrijeme}' } } : m,
    );
    const cap = essentialsRows(templated, i18n, NOW).find((r) => r.id === 'cap')!;
    expect(cap.attribution).toContain('Grmljavina');
    expect(cap.attribution).not.toContain('{');
  });

  // R-P7 / R-F8: the row reads "Linije u blizini" from the vehicle pins the
  // teaser's zet-rt subset already carries inside the kiosk's own box
  // (R-P1) -- never the 'route:' summary rows alone, which the production
  // bug (12 September) showed cover every route in the whole city.
  function vehiclePin(id: string, routeId: string, routeType = 0) {
    return { id: `vehicle:${id}`, module: 'zet-rt' as const, kind: 'vehicle' as const, tier: 'open' as const, title: routeId, geo: { type: 'Point' as const, coordinates: [15.977, 45.813] as [number, number] }, data: { routeId, routeType } };
  }
  function routeSummary(routeId: string, medianDelaySeconds: number) {
    return { id: `route:${routeId}`, module: 'zet-rt' as const, kind: 'vehicle' as const, tier: 'open' as const, title: `Linija ${routeId}`, data: { routeId, routeShortName: routeId, medianDelaySeconds, vehicles: 1 } };
  }

  it('shows the routes among the vehicle pins in the box in words, numeric order: the first is the headline value, the rest join the detail line, and no raw seconds appear anywhere', () => {
    const withPins = MODULES.map((m) =>
      m.module === 'zet-rt' ? snap('zet-rt', [...m.items, vehiclePin('t6', '6'), vehiclePin('t12', '12'), routeSummary('6', -10), routeSummary('12', 120)]) : m,
    );
    const routes = essentialsRows(withPins, i18n, NOW).find((r) => r.id === 'routes')!;
    expect(routes.label).toBe('Linije u blizini');
    expect(routes.value).toBe('6 na vrijeme'); // '6' before '12': numeric order, not lexicographic
    expect(routes.detail).toBe('12 kasni 2 min');
    expect(`${routes.value} ${routes.detail}`).not.toMatch(/\d s\b/); // never a raw-seconds figure
  });

  it('prints nothing beyond eight routes: the wall-of-text bug (12 September) had every route in the city on one row', () => {
    const routeIds = Array.from({ length: 10 }, (_, i) => String(i + 1));
    const withPins = MODULES.map((m) =>
      m.module === 'zet-rt' ? snap('zet-rt', [...m.items, ...routeIds.map((id) => vehiclePin(`t${id}`, id))]) : m,
    );
    const routes = essentialsRows(withPins, i18n, NOW).find((r) => r.id === 'routes')!;
    expect(routes.value).toBe('1 na vrijeme');
    expect(routes.detail).toBe('2 na vrijeme · 3 na vrijeme · 4 na vrijeme · 5 na vrijeme · 6 na vrijeme · 7 na vrijeme · 8 na vrijeme');
    expect(routes.detail).not.toContain('9');
    expect(routes.detail).not.toContain('10');
  });

  it('is absent when zet-rt has no vehicle pin in the box at all, even with route summaries present (the fixture case: only the fleet count ships)', () => {
    expect(essentialsRows(MODULES, i18n, NOW).some((r) => r.id === 'routes')).toBe(false);
  });

  it('falls back to the curated on-duty pharmacy, attributed to LJEKARNE_SOURCE, when a live ckan-geo snapshot has no ljekarne-tagged item — the real-world case, since ckan-geo never tags one (see the comment on the LJEKARNE import in kiosk.ts)', () => {
    const withoutTag = MODULES.map((m) =>
      m.module === 'ckan-geo'
        ? snap('ckan-geo', [{ id: 'd1', module: 'ckan-geo', kind: 'poi', tier: 'open', title: 'Zborno mjesto Ribnjak', data: { category: 'okupljalista' } }])
        : m,
    );
    const pharmacy = essentialsRows(withoutTag, i18n, NOW).find((r) => r.id === 'pharmacy')!;
    expect(pharmacy.value).toBe(LJEKARNE[0]!.label);
    expect(pharmacy.attribution).toBe(LJEKARNE_SOURCE.text);
  });

  it('skips a row outright when its module is down or has nothing to say, rather than an empty placeholder', () => {
    const noWarning = MODULES.map((m) => (m.module === 'dhmz-cap' ? snap('dhmz-cap', []) : m));
    expect(essentialsRows(noWarning, i18n, NOW).some((r) => r.id === 'cap')).toBe(false);
    const closuresDown = MODULES.map((m) => (m.module === 'prometnice' ? { ...m, status: 'down' as const } : m));
    expect(essentialsRows(closuresDown, i18n, NOW).some((r) => r.id === 'closures')).toBe(false);
  });

  it('renders exactly one row, the honest sentence, when every module is down — or simply absent', () => {
    const down = (module: ModuleId): ModuleSnapshot => ({
      module, tier: 'open', status: 'down', fetchedAt: new Date(NOW).toISOString(), attribution: attr(''), items: [],
    });
    const allDown = (['dhmz-cap', 'prometnice', 'zet-rt', 'dhmz-now', 'ckan-geo'] as ModuleId[]).map(down);
    const expected = [{ id: 'empty', label: '', value: i18n.t('kiosk.essentialsEmpty') }];
    expect(essentialsRows(allDown, i18n, NOW)).toEqual(expected);
    expect(essentialsRows([], i18n, NOW)).toEqual(expected);
  });
});

// --- T9: the moving map on the open screen (R-P1) ---------------------------
describe('the live stage (T9 / R-P1)', () => {
  const NOTE = 'Položaj je izračunat iz vlastitih očitanja svakog vozila i geometrije linije; ZET ne objavljuje smjer ni brzinu.';
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  /** The teaser's zet-rt after teaserSubset (R-P1): the fleet count, the pins
   *  inside the kiosk box with their route type, and the per-route delays. */
  const boxedTeaser = (): ModuleSnapshot[] => [
    ...MODULES.filter((m) => m.module !== 'zet-rt'),
    snap('zet-rt', [
      { id: 'vozila', module: 'zet-rt', kind: 'vehicle', tier: 'open', title: '156 vozila u pokretu', data: { vehicles: 156 } },
      { id: 'vehicle:t1', module: 'zet-rt', kind: 'vehicle', tier: 'open', title: '6', geo: { type: 'Point', coordinates: [15.977, 45.813] }, data: { routeId: '6', routeType: 0 } },
      { id: 'vehicle:b1', module: 'zet-rt', kind: 'vehicle', tier: 'open', title: '109', geo: { type: 'Point', coordinates: [15.977, 45.8135] }, data: { routeId: '109', routeType: 3 } },
      { id: 'route:6', module: 'zet-rt', kind: 'vehicle', tier: 'open', title: '6', data: { routeId: '6', routeShortName: '6', medianDelaySeconds: 40, vehicles: 12 } },
    ]),
  ];
  it('mounts the schematic into the stage slot with the honesty note, and draws the teaser\u2019s trams only', async () => {
    const loadNetwork = vi.fn(async () => null);
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }), fetchTeaser: async () => ({ modules: boxedTeaser() }), loadNetwork });
    await flush();
    const live = k.root.querySelector<HTMLElement>('[data-testid=kiosk-live]')!;
    expect(live.querySelector('[data-testid=schematic-host]')).not.toBeNull();
    expect(text(live.querySelector('[data-testid=schematic-note]'))).toBe(NOTE);
    expect(loadNetwork).toHaveBeenCalledTimes(1);
    await frame();
    // Two pins inside the crop, one of them a bus: a locked kiosk keeps to
    // trams (R-P1), and the bus does not count as "tracked" either -- the
    // legend says tracked trams, of which this many are in frame (R-F2).
    expect(text(live.querySelector('[data-testid=schematic-legend]'))).toBe('1 od 1 praćenih vozila u kadru');
    // The whole-fleet count still drives the panorama and the catalogue.
    expect(text(k.root.querySelector('[data-testid=kiosk-catalogue]'))).toContain('156');
  });
  it('pauses the stage while a session owns the screen and resumes it on the way back to the teaser', async () => {
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }), fetchTeaser: async () => ({ modules: boxedTeaser() }) });
    await flush();
    const view = k.root.querySelector<HTMLElement>('[data-testid=kiosk-live] [data-testid=schematic]')!;
    k.handlers.onCodes(batch(NOW), NOW);
    k.handlers.onUnlocked({ roomId: 'r1', ticket: 't1', expiresAt: NOW + 600_000 });
    await flush();
    expect(k.root.querySelector('[data-testid=kiosk]')?.getAttribute('data-mode')).toBe('unlocked');
    const paused = view.dataset.frames;
    await frame();
    await frame();
    expect(view.dataset.frames).toBe(paused);
    k.expire();
    await frame();
    await frame();
    expect(Number(view.dataset.frames)).toBeGreaterThan(Number(paused));
  });
  it('parks the stage loop while the essentials view covers it, and resumes it on close (R-F6)', async () => {
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }), fetchTeaser: async () => ({ modules: boxedTeaser() }) });
    await flush();
    const view = k.root.querySelector<HTMLElement>('[data-testid=kiosk-live] [data-testid=schematic]')!;
    await frame();
    k.root.querySelector<HTMLButtonElement>('[data-testid=kiosk-essentials-open]')!.click();
    const paused = view.dataset.frames;
    await frame();
    await frame();
    expect(view.dataset.frames).toBe(paused); // hidden behind the essentials: not one frame drawn
    k.root.querySelector<HTMLButtonElement>('[data-testid=kiosk-essentials-close]')!.click();
    await frame();
    const resumed = view.dataset.frames;
    await frame();
    await frame();
    expect(Number(view.dataset.frames)).toBeGreaterThan(Number(resumed)); // drawing again
  });

  it('polls the teaser again 2 s after the feed\'s next 30 s tick when zet-rt carries a source timestamp, else after 20 s', async () => {
    const plain = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }) });
    // The 20 s rotation is armed synchronously at mount; the teaser poll is
    // not yet -- it arms once the first load has settled.
    const rotation = plain.timers.filter((t) => t.ms === TEASER_ROTATE_MS);
    expect(rotation).toHaveLength(1);
    await flush();
    // That load carried no source timestamp, so the poll armed at the 20 s
    // fallback: a second registration, told apart from the rotation by
    // identity, never by the coincidence that the two delays are equal.
    const fallbackPoll = plain.timers.filter((t) => !t.cleared && t.ms === POLL_FALLBACK_MS && t !== rotation[0]);
    expect(fallbackPoll).toHaveLength(1);
    // And they behave differently: the poll is a one-shot that re-arms
    // itself when it fires; the rotation is an interval and stays.
    fallbackPoll[0]!.fn();
    await flush();
    expect(fallbackPoll[0]!.cleared).toBe(true);
    expect(rotation[0]!.cleared).toBe(false);
    expect(plain.timers.filter((t) => !t.cleared && t.ms === POLL_FALLBACK_MS && t !== rotation[0])).toHaveLength(1);

    const stamped = boxedTeaser().map((m) => (m.module === 'zet-rt' ? { ...m, sourceUpdatedAt: new Date(NOW - 5_000).toISOString() } : m));
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }), fetchTeaser: async () => ({ modules: stamped }) });
    await flush();
    expect(k.timers.filter((t) => !t.cleared && t.ms === TEASER_ROTATE_MS)).toHaveLength(1); // the rotation alone
    const poll = k.timers.find((t) => !t.cleared && t.ms === 27_000);
    expect(poll).toBeDefined();
    // Firing it polls once and re-arms the chain (the fetch answers the same
    // timestamp, so the next aim is the same 27 s out on this frozen clock).
    poll!.fn();
    await flush();
    expect(poll!.cleared).toBe(true);
    expect(k.timers.filter((t) => !t.cleared && t.ms === 27_000)).toHaveLength(1);
  });

  it('gives the unlocked U pokretu layer its own whole-network schematic, on the same one network load', async () => {
    const loadNetwork = vi.fn(async () => null);
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }), loadNetwork });
    k.handlers.onCodes(batch(NOW), NOW);
    k.handlers.onUnlocked({ roomId: 'r1', ticket: 't1', expiresAt: NOW + 600_000 });
    await flush();
    k.view('u-pokretu');
    await flush();
    const hosts = k.root.querySelectorAll('[data-testid=schematic-host]');
    expect(hosts).toHaveLength(2); // the paused stage and the session layer
    expect(k.root.querySelector('[data-testid=kiosk-layer] #u-pokretu-schematic [data-testid=schematic-note]')).not.toBeNull();
    expect(loadNetwork).toHaveBeenCalledTimes(1);
  });
  // T10: the full map on the unlocked kiosk layer.
  it('gives the unlocked layer’s map the same one network load, and never creates a map in lightweight mode (R-L2)', async () => {
    const loadNetwork = vi.fn(async () => null);
    const mapFactory = vi.fn(() => ({ update: vi.fn(), destroy: vi.fn() }));
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }), loadNetwork, mapFactory });
    k.handlers.onCodes(batch(NOW), NOW);
    k.handlers.onUnlocked({ roomId: 'r1', ticket: 't1', expiresAt: NOW + 600_000 });
    await flush();
    k.view('u-pokretu');
    await flush();
    expect(mapFactory).toHaveBeenCalledTimes(1);
    const options = (mapFactory.mock.calls[0] as unknown as [{ loadNetwork?: () => Promise<null> }])[0];
    await options.loadNetwork!();
    expect(loadNetwork).toHaveBeenCalledTimes(1);

    const light = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }), lightweight: true, mapFactory });
    light.handlers.onCodes(batch(NOW), NOW);
    light.handlers.onUnlocked({ roomId: 'r1', ticket: 't1', expiresAt: NOW + 600_000 });
    await flush();
    light.view('u-pokretu');
    await flush();
    expect(mapFactory).toHaveBeenCalledTimes(1); // no second map: the lightweight kiosk renders none
    expect(light.root.querySelector('[data-testid=kiosk-layer] #u-pokretu-map')).toBeNull();
  });
  it('lightweight: the stage carries the list and the note, and still no canvas anywhere', async () => {
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }), lightweight: true });
    await flush();
    const live = k.root.querySelector<HTMLElement>('[data-testid=kiosk-live]')!;
    expect(live.querySelector('[data-testid=schematic-list]')).not.toBeNull();
    expect(text(live.querySelector('[data-testid=schematic-note]'))).toBe(NOTE);
    expect(k.root.querySelectorAll('canvas')).toHaveLength(0);
  });
  // R-F8/R-X1: loadTeaser() must hand the stage's own update() the zet-rt
  // snapshot itself, not just the fixes/delays derived from it -- otherwise
  // a genuine zet-rt outage still prints the empty-list sentence on the
  // exact production surface (/kiosk/?lagano=1) the bug report was filed
  // against, just for a different trigger than the missing-geometry one
  // R-F8 was written for. This exercises mountKiosk's real loadTeaser call
  // site end to end (no mock of stageSchematic/createSchematicHost), so it
  // fails if that wiring ever regresses again.
  it('lightweight: a stale zet-rt in the teaser prints the honest stale sentence on the stage list, never "nema stavki"', async () => {
    const staleTeaser = (): ModuleSnapshot[] => [
      ...MODULES.filter((m) => m.module !== 'zet-rt'),
      { ...snap('zet-rt', []), status: 'stale', sourceUpdatedAt: new Date(NOW - 400_000).toISOString() },
    ];
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }), lightweight: true, fetchTeaser: async () => ({ modules: staleTeaser() }) });
    await flush();
    const live = k.root.querySelector<HTMLElement>('[data-testid=kiosk-live]')!;
    expect(text(live.querySelector('[data-testid=schematic-status]'))).toContain('izvor trenutačno ne odgovara');
    expect(live.querySelector('[data-testid=schematic-empty]')).toBeNull();
  });
  it('lightweight: a down zet-rt in the teaser prints the honest down sentence on the stage list, never "nema stavki"', async () => {
    const downTeaser = (): ModuleSnapshot[] => [
      ...MODULES.filter((m) => m.module !== 'zet-rt'),
      { ...snap('zet-rt', []), status: 'down' },
    ];
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }), lightweight: true, fetchTeaser: async () => ({ modules: downTeaser() }) });
    await flush();
    const live = k.root.querySelector<HTMLElement>('[data-testid=kiosk-live]')!;
    expect(text(live.querySelector('[data-testid=schematic-status]'))).toBe('izvor nedostupan');
    expect(live.querySelector('[data-testid=schematic-empty]')).toBeNull();
  });
});

// R-F4: a 2017 engine must lay the kiosk out. These read the stylesheets as
// text because the shape being guarded -- a fallback line *before* the modern
// one, an attribute selector instead of :has(), margins instead of flex gap
// on the lightweight-rendered lists -- is a property of the source, not of
// happy-dom's (absent) layout.
describe('a 2017 engine lays the kiosk out (R-F4)', () => {
  // node:path, not `new URL(..., import.meta.url)`: under happy-dom the URL
  // global is the DOM's own and resolves a relative path against the page.
  const css = (path: string): string => readFileSync(resolve(import.meta.dirname, '../../app/src/ui', path), 'utf8');
  // Comments stripped: the sheet's own notes name the features it avoids.
  const uncommented = (sheet: string): string => sheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const kioskCss = uncommented(css('kiosk.css'));
  const baseCss = uncommented(css('base.css'));
  // R-F8: the schematic's own lightweight list is spaced in motion/schematic.css
  // now (one rule for both the kiosk and the phone panel, no kiosk-only
  // override needed any more), not in kiosk.css -- read alongside it below.
  const schematicCss = uncommented(readFileSync(resolve(import.meta.dirname, '../../app/src/motion/schematic.css'), 'utf8'));
  /** Every rule block whose selector list is exactly `selector` (no regex:
   *  the selectors carry dots and spaces). */
  const rulesFor = (sheet: string, selector: string): string[] => {
    const rules: string[] = [];
    for (const line of sheet.split('\n')) {
      const open = line.indexOf('{');
      if (open === -1) continue;
      if (line.slice(0, open).trim() !== selector) continue;
      const from = sheet.indexOf(line);
      rules.push(sheet.slice(from, sheet.indexOf('}', from) + 1));
    }
    return rules;
  };

  it('marks the root data-live once the stage schematic is mounted, so CSS never needs :has()', async () => {
    const k = mount({ stored: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna' }), lightweight: true });
    await flush();
    const root = k.root.querySelector<HTMLElement>('[data-testid=kiosk]')!;
    expect(root.querySelector('[data-testid=kiosk-live]')!.childElementCount).toBeGreaterThan(0);
    expect(root.dataset.live).toBe('1');
    expect(kioskCss).not.toContain(':has(');
    expect(kioskCss).toMatch(/\[data-live='1'\]/);
  });

  it('writes 100vh before 100dvh on the kiosk and on body', () => {
    const kioskRule = /\.kiosk\s*\{[^}]*\}/.exec(kioskCss)![0];
    expect(kioskRule.indexOf('height: 100vh')).toBeGreaterThan(-1);
    expect(kioskRule.indexOf('height: 100vh')).toBeLessThan(kioskRule.indexOf('height: 100dvh'));
    const bodyRule = /\nbody\s*\{[^}]*\}/.exec(baseCss)![0];
    expect(bodyRule.indexOf('min-height: 100vh')).toBeGreaterThan(-1);
    expect(bodyRule.indexOf('min-height: 100vh')).toBeLessThan(bodyRule.indexOf('min-height: 100dvh'));
  });

  it('gives the lightweight meander bar a physical top, bottom and height beside inset-block', () => {
    const bar = /\.kiosk-meander \.meander-bar\s*\{[^}]*\}/.exec(kioskCss)![0];
    for (const decl of ['top: 0', 'bottom: 0', 'height: 100%', 'inset-block: 0']) expect(bar, decl).toContain(decl);
  });

  it('spaces the lightweight-rendered lists with margins, never flex gap alone', () => {
    // Every rule for these selectors: none may rely on `gap`, and each list
    // has a sibling-margin rule so rows never touch on an engine without
    // flex gap (Chrome before 84, Safari before 14.1, 2020 -- there is no
    // reliable @supports probe for flex gap, so margins carry the spacing
    // on every engine).
    for (const [sheet, list, item] of [
      [kioskCss, '.ess-rows', '.ess-row + .ess-row'],
      [kioskCss, '.kiosk-catalogue', '.cat-row + .cat-row'],
      [schematicCss, '.schematic-list', '.schematic-route + .schematic-route'],
    ] as const) {
      const rules = rulesFor(sheet, list);
      expect(rules.length, `${list} has a rule`).toBeGreaterThan(0);
      for (const rule of rules) expect(rule, `${list} must not space with gap`).not.toMatch(/(^|[\s;{])(row-|column-)?gap:(?!\s*0\s*[;}])/);
      expect(sheet, `${item} carries the spacing`).toContain(`${item} {`);
    }
  });
});
