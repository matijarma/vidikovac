// @vitest-environment happy-dom
// WP2 step 9, the wall's read-only touch [O-58]: a stop ring on the map opens
// that stop's board for 60 s, a row of "U blizini" its detail, the pharmacy
// its address and phone; nothing else reacts, the camera never moves, and the
// wall returns by itself (the timer, the deadline read on every tick and poll,
// an outage, anything else taking the stage). Proven at three levels: the hit
// arithmetic (kiosk/mapview.ts), the panel and its builders (kiosk/timeline.ts)
// and the controller's wiring (kiosk.ts) with every dependency faked.
import '../../shared/kiosk/external-text';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import type { ScreenMetadata } from '../../worker/protocol';
import type { ArrivalRow } from '../../shared/city/arrivals';
import { emptyCity, type DepartureBoard, type ScheduledDeparture } from '../../shared/city/types';
import { BEACON_STORAGE_KEY } from '../../app/src/beacon';
import { createBoardCache, type BoardCache } from '../../app/src/city/boards';
import type { ScreenStop } from '../../app/src/core/contracts';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { CODE_TICK_MS, mountKiosk, type KioskDeps } from '../../app/src/kiosk';
import { FIELD_DESIGN_HEIGHT, FIELD_DESIGN_WIDTH } from '../../app/src/kiosk/layout';
import { drawnStops, fieldPixel, KIOSK_HIT_TOLERANCE_PX, pharmacyRing, touchAt } from '../../app/src/kiosk/mapview';
import { nearestPharmacy, pharmaciesByDistance, type OnDutyPharmacy } from '../../app/src/kiosk/pharmacies';
import { kioskStrings } from '../../app/src/kiosk/strings';
import {
  loadStopBoardRows, mountTouchPanel, pharmacyDetailVariants, rowDetailVariants, STOP_BOARD_ROWS, stopBoardVariants, TIMETABLE_LINE_TRIPS, TOUCH_MS,
  type TimelineMeasure, type TimelineRow,
} from '../../app/src/kiosk/timeline';
import { STOP_DEPARTURES_FIRST } from '../../app/src/transport/view';
import { POLL_FALLBACK_MS } from '../../app/src/motion/loop';
import type { ThemeController } from '../../app/src/ui/theme';
import { fakeCityStore } from '../city/fake-store';

const i18n = createDefaultI18n('hr');
const s = kioskStrings('hr');
const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb
const iso = (ms: number): string => new Date(ms).toISOString();
const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const flush = async (): Promise<void> => { for (let i = 0; i < 24; i += 1) await Promise.resolve(); };
const isTram = (routeId: string): boolean => ['6', '11', '12', '13', '14', '17'].includes(routeId);

const STOP: ScreenStop = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '11', '12', '13', '14', '17'] };
const SIBLING: ScreenStop = { id: '106_2', name: 'Trg bana J. Jelačića', lon: 15.9779, lat: 45.81286, routes: ['6', '11'] };
/** A tram stop a few hundred metres south-east of the place: its own ring on the frame. */
const ZRINJEVAC: ScreenStop = { id: '107_1', name: 'Zrinjevac', lon: 15.9795, lat: 45.8085, routes: ['6', '13'] };
/** A bus-only stop on the frame: drawn only while the buses are. */
const BUS_STOP: ScreenStop = { id: '300_1', name: 'Draškovićeva', lon: 15.9845, lat: 45.8115, routes: ['215'] };
const STOPS: ScreenStop[] = [STOP, SIBLING, ZRINJEVAC, BUS_STOP];

// --- the hit arithmetic ---------------------------------------------------------------

describe('the touch arithmetic (kiosk/mapview.ts)', () => {
  const camera = { center: [STOP.lon, STOP.lat] as [number, number], zoom: 14 };
  it('puts a coordinate on its pixel under a north-up camera: MapLibre\'s 512 px world, north up, east right', () => {
    expect(fieldPixel(camera, 1000, 800, STOP)).toEqual([500, 400]);
    const [east] = fieldPixel(camera, 1000, 800, { lon: STOP.lon + 360 / (512 * 2 ** 14), lat: STOP.lat });
    expect(east).toBeCloseTo(501, 6);
    const [, north] = fieldPixel(camera, 1000, 800, { lon: STOP.lon, lat: STOP.lat + 0.001 });
    expect(north).toBeLessThan(400);
    // One zoom level doubles every distance from the centre.
    const far = fieldPixel(camera, 1000, 800, ZRINJEVAC);
    const closer = fieldPixel({ ...camera, zoom: 13 }, 1000, 800, ZRINJEVAC);
    expect(far[0] - 500).toBeCloseTo(2 * (closer[0] - 500), 6);
  });

  it('picks the ring nearest the finger within the tolerance, and nothing beyond it', () => {
    const input = { widthPx: 1000, heightPx: 800, camera, stops: [STOP, ZRINJEVAC], pharmacy: null, tolerancePx: KIOSK_HIT_TOLERANCE_PX };
    expect(touchAt({ ...input, x: 500, y: 400 })).toEqual({ kind: 'stop', stop: STOP });
    const [zx, zy] = fieldPixel(camera, 1000, 800, ZRINJEVAC);
    expect(touchAt({ ...input, x: zx + 20, y: zy - 5 })).toEqual({ kind: 'stop', stop: ZRINJEVAC });
    expect(touchAt({ ...input, x: zx + KIOSK_HIT_TOLERANCE_PX + 1, y: zy })).toBeNull();
    expect(touchAt({ ...input, x: 20, y: 20 })).toBeNull();
    // The pharmacy's ring is one of the rings: the nearer of the two wins.
    const ring = pharmacyRing(STOP)!;
    const [px, py] = fieldPixel(camera, 1000, 800, ring);
    expect(touchAt({ ...input, pharmacy: ring, x: px, y: py })).toEqual({ kind: 'pharmacy' });
    expect(touchAt({ ...input, pharmacy: ring, x: 500, y: 400 })).toEqual({ kind: 'stop', stop: STOP });
  });

  it('knows only the rings the overlay set draws: tram stops while the buses are off, the listed routes\' stops when it lists routes', () => {
    expect(drawnStops(STOPS, null, isTram)).toEqual(STOPS);
    expect(drawnStops(STOPS, { networkKinds: ['tram', 'bus'], stopRoutes: null }, isTram)).toEqual(STOPS);
    expect(drawnStops(STOPS, { networkKinds: ['tram'], stopRoutes: null }, isTram)).toEqual([STOP, SIBLING, ZRINJEVAC]);
    expect(drawnStops(STOPS, { networkKinds: ['tram', 'bus'], stopRoutes: ['13'] }, isTram)).toEqual([STOP, ZRINJEVAC]);
  });
});

// --- the board, the detail and the panel --------------------------------------------------

function arrival(tripId: string, routeName: string, headsign: string, minutesFromNow: number, live = false): ArrivalRow {
  return { tripId, routeId: routeName, routeName, headsign, atMs: NOW + minutesFromNow * 60_000, live, minutes: live ? minutesFromNow : null };
}
const doc = (markup: string): HTMLElement => {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host;
};

describe('the stop board (kiosk/timeline.ts stopBoardVariants)', () => {
  it('says it is loading until Sada\'s row renderer (its own chunk, off the wall\'s first screen) is in hand', async () => {
    const board = doc(stopBoardVariants(i18n, { name: STOP.name, rows: [arrival('t1', '6', 'Črnomerec', 3, true)], timetable: [], status: 'live' })[0]!);
    expect(text(board.querySelector('.k-touch-title'))).toBe('Trg bana J. Jelačića');
    expect(board.querySelectorAll('[data-kind=departure]')).toHaveLength(0);
    expect(text(board.querySelector('.k-touch-line'))).toBe('učitavanje podataka');
    expect(await loadStopBoardRows()).toBe(true);
    expect(doc(stopBoardVariants(i18n, { name: STOP.name, rows: [arrival('t1', '6', 'Črnomerec', 3, true)], timetable: [], status: 'live' })[0]!).querySelectorAll('[data-kind=departure]')).toHaveLength(1);
    // Sada's three, the same number the phone's sheet leads with.
    expect(STOP_BOARD_ROWS).toBe(STOP_DEPARTURES_FIRST);
  });
  const rows = [arrival('t1', '6', 'Črnomerec', 3, true), arrival('t2', '11', 'Dubec', 6), arrival('t3', '13', 'Žitnjak', 13), arrival('t4', '14', 'Mihaljevac', 18)];
  const timetable = [arrival('t1', '6', 'Črnomerec', 1), arrival('t2', '11', 'Dubec', 6), arrival('t3', '13', 'Žitnjak', 13), arrival('t4', '14', 'Mihaljevac', 18), arrival('t5', '17', 'Prečko', 22), arrival('t6', '12', 'Dubrava', 25), arrival('t7', '6', 'Sopot', 28)];

  it('names the stop, leads with Sada\'s three departures and ends with the timetable line, richest first', () => {
    const variants = stopBoardVariants(i18n, { name: STOP.name, rows, timetable, status: 'live' });
    const board = doc(variants[0]!).querySelector<HTMLElement>('[data-testid=stop-board]')!;
    expect(text(board.querySelector('.k-touch-title'))).toBe('Trg bana J. Jelačića');
    const departures = [...board.querySelectorAll<HTMLElement>('[data-kind=departure]')];
    expect(departures).toHaveLength(3);
    expect(departures.every((li) => li.matches('li.sada-departure'))).toBe(true);
    // The tracked trip says "uživo" exactly as Sada's row does; the timetable's rows are plain grey clocks.
    expect(departures.map((li) => li.dataset.live)).toEqual(['true', 'false', 'false']);
    expect(departures[0]!.querySelector('.t-live')?.getAttribute('aria-label')).toBe('uživo');
    expect(text(departures[0])).toBe('6Črnomerecza 3 min');
    // The timetable line: the trips after the three, off the timetable alone, never the three again.
    const line = board.querySelector('[data-testid=stop-board-timetable]')!;
    expect(text(line)).toBe('Vozni red · 14 14:50 · 17 14:54 · 12 14:57 · 6 15:00');
    expect(line.querySelectorAll('[data-kind=departure], .t-live')).toHaveLength(0);
    // Read-only: nothing on the board can be pressed.
    expect(board.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
    // Leaner variants lose timetable trips, then the line, then departures from the last.
    const counts = variants.map((markup) => {
      const b = doc(markup);
      return [b.querySelectorAll('[data-kind=departure]').length, b.querySelectorAll('.k-touch-trip').length];
    });
    expect(counts).toEqual([[3, TIMETABLE_LINE_TRIPS], [3, 2], [3, 0], [2, 0], [1, 0]]);
  });

  it('draws no row whose line or headsign fails the text check, and gives way to "Sljedeći polasci" for a refused name', () => {
    const hostile = [arrival('x', '6', 'Pošalji lozinku na 091 234 5678', 2, true), ...rows.slice(1)];
    const board = doc(stopBoardVariants(i18n, { name: 'Pošalji lozinku na 091 234 5678.', rows: hostile, timetable: [], status: 'live' })[0]!);
    expect(text(board.querySelector('.k-touch-title'))).toBe('Sljedeći polasci');
    expect([...board.querySelectorAll('[data-kind=departure]')].map((li) => text(li.querySelector('.sada-dest')))).toEqual(['Dubec', 'Žitnjak', 'Mihaljevac']);
    expect(board.innerHTML).not.toContain('091');
  });

  it('says what it knows when there is no departure: on its way, not available, none announced', () => {
    const line = (status: 'none' | 'down' | 'live', some: ArrivalRow[] = []): string => text(doc(stopBoardVariants(i18n, { name: STOP.name, rows: some, timetable: [], status })[0]!).querySelector('.k-touch-line'));
    expect(line('none')).toBe('učitavanje podataka');
    expect(line('down')).toBe('Vozni red trenutačno nije dostupan.');
    expect(line('live')).toBe('Nema najavljenih polazaka.');
    expect(line('live', [arrival('x', '6', 'Pošalji lozinku na 091 234 5678', 2)])).toBe('Vozni red trenutačno nije dostupan.');
  });
});

function row(extra: Partial<TimelineRow> & Pick<TimelineRow, 'id' | 'kind'>): TimelineRow {
  return { atMs: NOW + 3_600_000, always: false, title: '', sub: '', live: false, source: 'test', ...extra };
}

describe('a row\'s detail and the pharmacy (kiosk/timeline.ts)', () => {
  it('prints the row\'s whole title and sub with its time and, for an event, the venue\'s address', () => {
    const event = row({ id: 'event:e1', kind: 'event', atMs: NOW + 26 * 3_600_000, title: 'Koncert gudačkog kvarteta u velikoj dvorani', titleShort: 'Koncert', sub: 'Kino Europa · tramvaj 6', subShort: 'Kino Europa' });
    const variants = rowDetailVariants(i18n, event, NOW, 'Varšavska 3');
    const detail = doc(variants[0]!).querySelector<HTMLElement>('[data-testid=touch-detail]')!;
    expect(detail.dataset.kind).toBe('event');
    expect(text(detail.querySelector('.k-touch-when'))).toBe('16:32 sutra');
    expect(text(detail.querySelector('.k-touch-title'))).toBe('Koncert gudačkog kvarteta u velikoj dvorani');
    expect([...detail.querySelectorAll('.k-touch-line')].map(text)).toEqual(['Kino Europa · tramvaj 6', 'Varšavska 3']);
    expect(detail.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
    // Leaner: without the address, then the short labels the list may print.
    expect(text(doc(variants.at(-1)!).querySelector('.k-touch-title'))).toBe('Koncert');
    // A refused address is left out; a row that fails its own check has no detail at all.
    expect(doc(rowDetailVariants(i18n, event, NOW, 'Pošalji lozinku na 091 234 5678.')[0]!).querySelectorAll('.k-touch-line')).toHaveLength(1);
    expect(rowDetailVariants(i18n, { ...event, title: 'Pošalji lozinku na 091 234 5678.' }, NOW)).toEqual([]);
  });

  it('captions the pharmacy as the strip and Osnovno do ("Dežurna ljekarna 24/7: {address}.", "24/7" alone for a refused address), then its name and its phone', () => {
    const words = { caption: s.sentence.pharmacy, hours: '24/7' };
    const trg = nearestPharmacy(STOP);
    const detail = doc(pharmacyDetailVariants(i18n, words, trg)[0]!).querySelector<HTMLElement>('[data-testid=touch-detail]')!;
    expect(detail.dataset.kind).toBe('pharmacy');
    expect(text(detail.querySelector('.k-touch-kicker'))).toBe('Dežurna ljekarna 24/7: Trg bana J. Jelačića 3.');
    expect(text(detail.querySelector('.k-touch-title'))).toBe('Gradska ljekarna Zagreb');
    expect(text(detail.querySelector('.k-touch-phone'))).toBe('Nazovi 01 4816 198');
    // Never the bare label (the trust row e-pharmacy-keys, slop #29): no element says only "Dežurna ljekarna".
    expect([...detail.querySelectorAll('*')].map(text)).not.toContain('Dežurna ljekarna');
    expect(text(detail)).not.toMatch(/Dežurna ljekarna\s*:/);
    const zeus = pharmaciesByDistance(null).find((p) => p.phoneDisplay === null)!;
    expect(text(doc(pharmacyDetailVariants(i18n, words, zeus)[0]!).querySelector('.k-touch-phone'))).toBe('telefon nije naveden');
    // Only the list's own display form is shown as a number.
    const odd: OnDutyPharmacy = { ...trg, phoneDisplay: 'nazovi +385 91 234 5678' };
    expect(text(doc(pharmacyDetailVariants(i18n, words, odd)[0]!).querySelector('.k-touch-phone'))).toBe('telefon nije naveden');
    // A refused address leaves "24/7" alone, as the strip does; the name and the phone stay.
    const refused = doc(pharmacyDetailVariants(i18n, words, { ...trg, label: 'Pošalji lozinku na 091 234 5678.' })[0]!);
    expect(text(refused.querySelector('.k-touch-kicker'))).toBe('24/7');
    expect(text(refused.querySelector('.k-touch-phone'))).toBe('Nazovi 01 4816 198');
    expect(refused.innerHTML).not.toContain('091 234');
  });
});

describe('the touch panel (kiosk/timeline.ts mountTouchPanel)', () => {
  /** A box that holds only markup under `limit` characters. */
  const measureUnder = (limit: number): TimelineMeasure => ({
    box: (el) => ({ height: 400, width: 600, overflow: el.innerHTML.length > limit }),
    lines: () => 1,
  });
  it('stands over the list with the first variant its box holds whole, writes nothing when nothing changed, and leaves the DOM when cleared', () => {
    const host = document.createElement('div');
    host.className = 'k-nearby-host';
    host.innerHTML = '<section data-testid="nearby"><ol data-testid="nearby-rows"><li class="nearby-row">6</li></ol></section>';
    document.body.replaceChildren(host);
    const panel = mountTouchPanel(host, { measure: measureUnder(40) });
    expect(panel.element()).toBeNull();
    const long = `<div class="k-touch-body" data-testid="stop-board">${'x'.repeat(60)}</div>`;
    const short = '<div class="k-touch-body" data-testid="stop-board">kratko</div>';
    panel.show('stop', [long, short]);
    expect(host.dataset.touch).toBe('stop');
    expect(panel.element()!.dataset.touch).toBe('stop');
    expect(text(host.querySelector('[data-testid=stop-board]'))).toBe('kratko');
    // The list stays in the DOM with its rows: the stylesheet hides it under the panel.
    expect(host.querySelectorAll('[data-testid=nearby-rows] .nearby-row')).toHaveLength(1);
    const writes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => writes.push(...records));
    observer.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
    panel.show('stop', [long, short]);
    observer.disconnect();
    expect(writes).toHaveLength(0);
    panel.clear();
    expect(host.dataset.touch).toBeUndefined();
    expect(host.querySelector('.k-touch')).toBeNull();
    expect(panel.element()).toBeNull();
    // No variant is no panel.
    panel.show('row', []);
    expect(host.querySelector('.k-touch')).toBeNull();
  });
});

// --- the controller ------------------------------------------------------------------------

const attr = { text: 'Izvor: test', url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' };
type Item = ModuleSnapshot['items'][number];
function snap(module: ModuleId, items: Item[], status: ModuleSnapshot['status'] = 'live'): ModuleSnapshot {
  return { module, tier: 'open', status, fetchedAt: new Date(NOW - 30_000).toISOString(), attribution: attr, items };
}
function item(module: ModuleId, id: string, kind: Item['kind'], title: string, extra: Partial<Item> = {}): Item {
  return { id, module, kind, tier: 'open', title, ...extra };
}
const TRIP_LIVE = 'trip-6-live';
const ZET_LIVE = snap('zet-rt', [
  item('zet-rt', 'vehicle:1', 'vehicle', '6', { at: '2026-09-11T12:31:40Z', geo: { type: 'Point', coordinates: [15.977, 45.813] }, data: { routeId: '6', routeType: 0, tripId: TRIP_LIVE, delaySeconds: 120 } }),
]);
const MODULES: ModuleSnapshot[] = [
  ZET_LIVE,
  snap('dogadanja', [item('dogadanja', 'kvartovske:e1', 'event', 'Koncert u kinu', { at: iso(NOW + 2 * 3_600_000), dateBasis: 'event', data: { source: 'kvartovske', venue: 'Kino Europa', precision: 'time' } })]),
];
const CITY = { ...emptyCity(), places: [{ id: 'culture-europa', name: 'Kino Europa', category: 'culture' as const, sourceId: 'culture', sourceRecord: 'e', lon: 15.9754, lat: 45.8127, address: 'Varšavska 3' }] };
const dep = (tripId: string, routeId: string, headsign: string, minutes: number): ScheduledDeparture =>
  ({ operator: 'zet', tripId, routeId, routeName: routeId, headsign, at: iso(NOW + minutes * 60_000) });
const board = (stopId: string, stopName: string, departures: ScheduledDeparture[]): DepartureBoard =>
  ({ operator: 'zet', stopId, stopName, status: 'live', generatedAt: iso(NOW), departures });
const BOARDS: Record<string, DepartureBoard> = {
  // 12:33Z + ZET's own 120 s = "za 3 min" on the tracked 6; the rest is the timetable.
  '106_1': board('106_1', STOP.name, [dep(TRIP_LIVE, '6', 'Črnomerec', 1), dep('t11', '11', 'Dubec', 6), dep('t14', '14', 'Mihaljevac', 18), dep('t17', '17', 'Prečko', 22)]),
  '106_2': board('106_2', STOP.name, [dep('t13', '13', 'Žitnjak', 13), dep('t12', '12', 'Dubrava', 25)]),
  '107_1': board('107_1', 'Zrinjevac', [dep('z6', '6', 'Sopot', 4), dep('z13', '13', 'Kaptol', 9)]),
};
const SCREEN: ScreenMetadata = { kind: 'temporary', expiresAt: NOW + 20 * 3_600_000, stop: STOP, area: 'gornji-grad-medvescak' };

interface Timer { fn: () => void; ms: number; cleared: boolean }

function fakeBoards(available: Record<string, DepartureBoard>) {
  const asked: string[] = [];
  const fetchImpl = vi.fn(async (input: unknown) => {
    const id = decodeURIComponent(String(input).split('stop=')[1] ?? '');
    asked.push(id);
    const found = available[id];
    if (!found) return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
    return { ok: true, status: 200, json: async () => found } as unknown as Response;
  });
  return { create: (): BoardCache => createBoardCache({ fetchImpl: fetchImpl as unknown as typeof globalThis.fetch, now: () => NOW }), asked };
}

function fakeMap(camera: () => { center: [number, number]; zoom: number } | null = () => null) {
  const handle = { update: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(), resize: vi.fn(), setFeedState: vi.fn(), setView: vi.fn(), camera };
  return { factory: vi.fn((_options: Record<string, unknown>) => handle), handle };
}

const theme: ThemeController = {
  getPreference: () => 'solar', getResolvedTheme: () => 'light', setPreference: () => {},
  onChange: (listener) => { listener({ preference: 'solar', resolved: 'light' }); return () => {}; }, destroy: () => {},
};

function mount(opts: { viewport?: { width: number; height: number }; modules?: () => ModuleSnapshot[]; mapMode?: KioskDeps['mapMode']; lightweight?: boolean; camera?: () => { center: [number, number]; zoom: number } | null } = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const raw: Record<string, string> = { [BEACON_STORAGE_KEY]: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna', screen: SCREEN }) };
  const storage = { getItem: (k: string) => raw[k] ?? null, setItem: (k: string, v: string) => { raw[k] = v; }, removeItem: (k: string) => { delete raw[k]; } };
  const timers: Timer[] = [];
  let now = NOW;
  let handlers: Parameters<NonNullable<KioskDeps['createBeacon']>>[0] | null = null;
  const map = fakeMap(opts.camera);
  const boards = fakeBoards(BOARDS);
  const modules = opts.modules ?? (() => MODULES);
  const handle = mountKiosk(root, {
    cityStore: fakeCityStore(CITY), i18n, hash: '', storage, now: () => now, codeBase: 'https://zagreb.aningfilm.hr',
    reducedMotion: true, lightweight: opts.lightweight ?? false, viewport: opts.viewport ?? { width: 1920, height: 1080 }, mapMode: opts.mapMode,
    fetchTeaser: async () => ({ modules: modules() }), fetchSentences: async () => [], loadNetwork: async () => null,
    fetchData: async (module: ModuleId) => modules().find((m) => m.module === module) ?? snap(module, []),
    mapFactory: map.factory as never, loadStops: async () => STOPS, loadStreets: async () => [], loadLastRun: async () => null,
    createBoards: boards.create, theme, loadPaired: () => import('../../app/src/kiosk/paired'),
    createBeacon: (deps) => {
      handlers = deps;
      return { connect: vi.fn(), requestMore: vi.fn(), status: () => 'live', close: vi.fn(), acknowledgePresentation: vi.fn(), setScreen: vi.fn() } as never;
    },
    setInterval: (fn: () => void, ms: number) => { const t: Timer = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearInterval: (h: unknown) => { (h as Timer).cleared = true; },
    requestFullscreen: async () => {}, requestWakeLock: async () => {},
  });
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T | null => root.querySelector<T>(sel);
  /** The camera the kiosk last asked the map for: the creation's, or the last setView. */
  const asked = (): { center: [number, number]; zoom: number } => {
    const last = map.handle.setView.mock.calls.at(-1)?.[0] as { center: [number, number]; zoom: number } | undefined;
    return last ?? (map.factory.mock.calls[0]![0] as unknown as { center: [number, number]; zoom: number });
  };
  const composition = (opts.viewport?.width ?? 1920) >= 1600 ? 'wide' : 'compact';
  /** A click on the map where `point` is drawn (the field has no layout in happy-dom: the design box, as the camera). */
  const touchMap = (point: { lon: number; lat: number }): void => {
    const [x, y] = fieldPixel(asked(), FIELD_DESIGN_WIDTH[composition], FIELD_DESIGN_HEIGHT[composition], point);
    q('[data-testid=kiosk-map]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
  };
  return {
    root, handle, map, timers, boards, q, asked, touchMap,
    get handlers() { return handlers!; },
    setNow: (at: number) => { now = at; },
    tick: (ms: number) => { for (const t of [...timers]) if (t.ms === ms && !t.cleared) t.fn(); },
    poll: () => { const armed = [...timers].reverse().find((t) => t.ms === POLL_FALLBACK_MS && !t.cleared); armed?.fn(); },
    board: () => q('[data-testid=stop-board]'),
    detail: () => q('[data-testid=touch-detail]'),
    nearbyHost: () => q('.k-nearby-host')!,
  };
}

describe('the wall answers a touch (kiosk.ts)', () => {
  beforeAll(async () => { await loadStopBoardRows(); });
  it('opens the place\'s stop board from its ring at the map\'s centre for 60 s, over the list, without moving the camera, then returns by itself', async () => {
    const k = mount();
    await flush();
    expect(k.board()).toBeNull();
    const views = k.map.handle.setView.mock.calls.length;
    const camera = k.asked();
    k.touchMap(STOP);
    const board = k.board()!;
    expect(board).not.toBeNull();
    expect(text(board.querySelector('.k-touch-title'))).toBe('Trg bana J. Jelačića');
    const rows = [...board.querySelectorAll<HTMLElement>('[data-kind=departure]')];
    expect(rows.map((li) => text(li))).toEqual(['6Črnomerecza 3 min', '11Dubec14:38', '13Žitnjak14:45']);
    expect(rows.map((li) => li.dataset.live)).toEqual(['true', 'false', 'false']);
    expect(text(board.querySelector('[data-testid=stop-board-timetable]'))).toBe('Vozni red · 14 14:50 · 17 14:54 · 12 14:57');
    // Over the list, which keeps its rows and its place (the stylesheet hides it under the panel).
    expect(k.nearbyHost().dataset.touch).toBe('stop');
    expect(k.q('[data-testid=nearby] [data-testid=nearby-rows]')!.children.length).toBeGreaterThan(0);
    // Nothing on the wall became a control, and the camera is where it was.
    expect(k.q('[data-testid=kiosk-invitation]')!.querySelectorAll('button, a[href], input, [tabindex]')).toHaveLength(0);
    k.tick(CODE_TICK_MS);
    expect(k.map.handle.setView.mock.calls.length).toBe(views);
    expect(k.asked()).toEqual(camera);
    expect((k.map.factory.mock.calls[0]![0] as { interactive?: boolean }).interactive).toBe(false);
    expect(k.q('[data-testid=kiosk-map]')!.inert).toBe(true);
    // 60 s later the one-shot fires and the wall is the list again.
    const timer = k.timers.find((t) => t.ms === TOUCH_MS && !t.cleared)!;
    expect(timer).toBeDefined();
    k.setNow(NOW + TOUCH_MS);
    timer.fn();
    expect(k.board()).toBeNull();
    expect(k.nearbyHost().dataset.touch).toBeUndefined();
    expect(k.q('.k-touch')).toBeNull();
    k.handle.destroy();
  });

  it('reads the deadline again on every tick, so a lost timer cannot keep the board up', async () => {
    const k = mount();
    await flush();
    k.touchMap(STOP);
    expect(k.board()).not.toBeNull();
    k.setNow(NOW + TOUCH_MS - 1_000);
    k.tick(CODE_TICK_MS);
    expect(k.board()).not.toBeNull();
    k.setNow(NOW + TOUCH_MS);
    k.tick(CODE_TICK_MS);
    expect(k.board()).toBeNull();
    k.handle.destroy();
  });

  it('opens another stop\'s board from its ring, asking for its boards, and a second touch restarts the 60 s', async () => {
    const k = mount();
    await flush();
    k.touchMap(ZRINJEVAC);
    expect(k.boards.asked).toContain('107_1');
    await flush();
    const board = k.board()!;
    expect(text(board.querySelector('.k-touch-title'))).toBe('Zrinjevac');
    expect([...board.querySelectorAll('[data-kind=departure] .sada-dest')].map(text)).toEqual(['Sopot', 'Kaptol']);
    k.setNow(NOW + 30_000);
    k.touchMap(STOP);
    expect(text(k.board()!.querySelector('.k-touch-title'))).toBe('Trg bana J. Jelačića');
    k.setNow(NOW + TOUCH_MS + 1_000);
    k.tick(CODE_TICK_MS);
    expect(k.board()).not.toBeNull();
    k.setNow(NOW + 30_000 + TOUCH_MS);
    k.tick(CODE_TICK_MS);
    expect(k.board()).toBeNull();
    k.handle.destroy();
  });

  it('lets nothing else react: the ground, a vehicle, and the open board itself', async () => {
    const k = mount();
    await flush();
    const [x, y] = [30, 30];
    k.q('[data-testid=kiosk-map]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    k.touchMap({ lon: 15.99, lat: 45.805 });
    expect(k.q('.k-touch')).toBeNull();
    k.q('[data-testid=kiosk-brand]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    k.q('[data-testid=kiosk-qr]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(k.q('.k-touch')).toBeNull();
    k.touchMap(STOP);
    const before = k.board()!.outerHTML;
    k.board()!.querySelector('li')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(k.board()!.outerHTML).toBe(before);
    k.handle.destroy();
  });

  it('shows a row\'s detail from the list: the event with its venue\'s address; a departure opens the place\'s board', async () => {
    const k = mount();
    await flush();
    const event = k.q<HTMLElement>('[data-testid=nearby-rows] > .nearby-row[data-kind=event]')!;
    expect(event).not.toBeNull();
    event.querySelector('.nearby-title')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const detail = k.detail()!;
    expect(detail.dataset.kind).toBe('event');
    expect(text(detail.querySelector('.k-touch-title'))).toBe('Koncert u kinu');
    expect([...detail.querySelectorAll('.k-touch-line')].map(text)).toEqual(['Kino Europa', 'Varšavska 3']);
    expect(k.nearbyHost().dataset.touch).toBe('row');
    const departure = k.q<HTMLElement>('[data-testid=nearby-rows] > .nearby-row[data-kind=departure]');
    // The list sits under the panel now; a touch on the list itself reaches it once the panel is gone.
    k.timers.find((t) => t.ms === TOUCH_MS && !t.cleared)!.fn();
    expect(k.detail()).toBeNull();
    departure!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(text(k.board()!.querySelector('.k-touch-title'))).toBe('Trg bana J. Jelačića');
    k.handle.destroy();
  });

  it('shows the pharmacy\'s address and phone from the footer and from its ring on the map', async () => {
    const k = mount();
    await flush();
    k.q('[data-testid=strip-pharmacy]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(text(k.detail()!.querySelector('.k-touch-kicker'))).toBe('Dežurna ljekarna 24/7: Trg bana J. Jelačića 3.');
    expect(text(k.detail()!.querySelector('.k-touch-phone'))).toBe('Nazovi 01 4816 198');
    k.timers.find((t) => t.ms === TOUCH_MS && !t.cleared)!.fn();
    k.touchMap(pharmacyRing(STOP)!);
    expect(k.detail()!.dataset.kind).toBe('pharmacy');
    k.handle.destroy();
  });

  it('returns when the feed drops out under the board, and on a poll past the deadline', async () => {
    let zet = ZET_LIVE;
    const k = mount({ modules: () => [zet, ...MODULES.slice(1)] });
    await flush();
    k.touchMap(STOP);
    expect(k.board()).not.toBeNull();
    zet = { ...ZET_LIVE, status: 'down', items: [] };
    k.poll();
    await flush();
    expect(k.board()).toBeNull();
    // Opened during the outage, the board stands (timetable only, no live time) until its own deadline.
    k.touchMap(STOP);
    expect(k.board()!.querySelectorAll('[data-live=true]')).toHaveLength(0);
    k.setNow(NOW + TOUCH_MS);
    k.poll();
    await flush();
    expect(k.board()).toBeNull();
    k.handle.destroy();
  });

  it('yields at once to a presentation, and a destroyed wall leaves no timer armed', async () => {
    const k = mount();
    await flush();
    k.touchMap(STOP);
    const timer = k.timers.find((t) => t.ms === TOUCH_MS && !t.cleared)!;
    k.handlers.onPresentation?.({ version: 1, revision: 1, target: { layer: 'u-pokretu', selection: { kind: 'stop', id: '106_1' } }, expiresAt: NOW + 600_000, dataToken: 'dt' });
    await flush();
    expect(k.q('.k-touch')).toBeNull();
    expect(timer.cleared).toBe(true);
    k.handle.destroy();
    const again = mount();
    await flush();
    again.touchMap(STOP);
    const armed = again.timers.find((t) => t.ms === TOUCH_MS && !t.cleared)!;
    again.handle.destroy();
    expect(armed.cleared).toBe(true);
  });

  it('prefers the camera the map reports over the one it was asked for', async () => {
    // The map reports a camera centred on Zrinjevac: a touch at the field's centre is Zrinjevac's ring.
    const k = mount({ camera: () => ({ center: [ZRINJEVAC.lon, ZRINJEVAC.lat], zoom: 14 }) });
    await flush();
    const w = FIELD_DESIGN_WIDTH.wide, h = FIELD_DESIGN_HEIGHT.wide;
    k.q('[data-testid=kiosk-map]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: w / 2, clientY: h / 2 }));
    await flush();
    expect(text(k.board()!.querySelector('.k-touch-title'))).toBe('Zrinjevac');
    k.handle.destroy();
  });

  it('keeps the schema, a handheld and lagano\'s missing map untouched', async () => {
    const schema = mount({ mapMode: 'schema' });
    await flush();
    schema.touchMap(STOP);
    expect(schema.q('.k-touch')).toBeNull();
    schema.handle.destroy();
    const phone = mount({ viewport: { width: 390, height: 844 } });
    await flush();
    phone.q('[data-testid=strip-pharmacy]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    phone.q('[data-testid=nearby-rows] > .nearby-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(phone.q('.k-touch')).toBeNull();
    phone.handle.destroy();
    // Lagano draws no map, but its list and its footer are the same wall.
    const light = mount({ lightweight: true });
    await flush();
    expect(light.q('[data-testid=kiosk-map]')).toBeNull();
    light.q('[data-testid=strip-pharmacy]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(light.detail()!.dataset.kind).toBe('pharmacy');
    light.handle.destroy();
  });
});

// --- the tiers ----------------------------------------------------------------------------

function px(value: string): number {
  const js = value.replace(/px/g, '').replace(/calc\(/g, '(').replace(/max\(/g, 'Math.max(').replace(/min\(/g, 'Math.min(');
  if (!/^[\d.\s+\-*/(),]+$/.test(js.replace(/Math\.(max|min)/g, ''))) throw new Error(`not a length: ${value}`);
  return Number(new Function(`return (${js});`)());
}

describe('the board on the 3-metre tiers (computed from the real sheets)', () => {
  beforeAll(async () => { await loadStopBoardRows(); });
  const sheets = ['app/src/ui/kiosk.css', 'app/src/ui/kiosk-city.css'].map((f) => readFileSync(join(import.meta.dirname, '..', '..', f), 'utf8')).join('\n');
  function sizes(size: string, portrait: boolean, theme: 'light' | 'dark'): Record<string, number> {
    document.head.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = sheets;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.className = 'kiosk';
    root.dataset.size = size;
    root.dataset.phase = 'invitation';
    if (portrait) root.dataset.portrait = '1';
    document.documentElement.dataset.themeResolved = theme;
    const host = document.createElement('div');
    host.className = 'k-nearby-host';
    root.appendChild(host);
    document.body.replaceChildren(root);
    const panel = mountTouchPanel(host);
    const rows = [arrival('t1', '6', 'Črnomerec', 3, true), arrival('t2', '11', 'Dubec', 6)];
    panel.show('stop', stopBoardVariants(i18n, { name: STOP.name, rows, timetable: [...rows, arrival('t5', '17', 'Prečko', 22)], status: 'live' }));
    const out: Record<string, number> = {};
    for (const sel of ['.k-touch-title', '.sada-departure', '.sada-dest', '.t-eta', '.k-touch-timetable']) out[sel] = px(getComputedStyle(host.querySelector(sel)!).fontSize);
    panel.clear();
    delete document.documentElement.dataset.themeResolved;
    return out;
  }
  for (const [name, size, portrait] of [['wide 1920 x 1080', 'wide', false], ['compact 1366 x 768', 'compact', false], ['portrait 1080 x 1920', 'compact', true]] as const) {
    it(`${name}: the stop, its departures, their badges and times on the read tier (x1.1 dark), the timetable line on the walk-up tier`, () => {
      const light = sizes(size, portrait, 'light');
      for (const sel of ['.k-touch-title', '.sada-departure', '.sada-dest', '.t-eta']) expect(light[sel], sel).toBeGreaterThanOrEqual(40);
      expect(light['.k-touch-timetable']).toBeGreaterThanOrEqual(28);
      const dark = sizes(size, portrait, 'dark');
      for (const sel of ['.k-touch-title', '.sada-departure']) expect(dark[sel], sel).toBeGreaterThanOrEqual(44);
    });
  }
  it('sizes the line badge with its row, not with the phone\'s board size', () => {
    const css = readFileSync(join(import.meta.dirname, '..', '..', 'app/src/ui/kiosk-city.css'), 'utf8');
    expect(css).toContain('.kiosk .k-touch .sada-departure .line{font-size:inherit;');
    expect(css).toContain('.kiosk .k-touch{--k-touch-read:max(40px,var(--k-main-size));');
    expect(css).toContain('.kiosk .k-nearby-host[data-touch]>[data-testid=nearby]{visibility:hidden}');
  });
});
