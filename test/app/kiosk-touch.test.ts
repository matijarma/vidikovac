// @vitest-environment happy-dom
// WP2 step 9, the wall's read-only touch [O-58]: a stop ring on the map opens
// that stop's board for 30 s, a row of "U blizini" its detail, the pharmacy
// its address and phone; nothing else reacts, the camera never moves, and the
// wall returns by itself (the timer, the deadline read on every tick and poll,
// an outage, anything else taking the stage) or on a second tap on the detail
// or on what it shows. A press held on any of them opens Postavke instead
// (5 Oct 2026). Proven at three levels: the hit
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
import * as scheduler from '../../shared/kiosk/takt';
import * as sentenceRuntime from '../../app/src/city/sentence';
import * as nearbyRuntime from '../../app/src/city/nearby';
import * as timelineRuntime from '../../app/src/kiosk/timeline';
import { simulated, WALL_1920 } from './timeline-measure';
import { createBoardCache, type BoardCache } from '../../app/src/city/boards';
import type { ScreenStop } from '../../app/src/core/contracts';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { CODE_TICK_MS, mountKiosk, type KioskDeps } from '../../app/src/kiosk';
import { LONG_PRESS_BEAT_MS, LONG_PRESS_MS } from '../../app/src/kiosk/constants';
import { FIELD_DESIGN_HEIGHT, FIELD_DESIGN_WIDTH } from '../../app/src/kiosk/layout';
import { drawnStops, fieldPixel, KIOSK_HIT_TOLERANCE_PX, pharmacyRing, touchAt } from '../../app/src/kiosk/mapview';
import { nearestPharmacy, pharmaciesByDistance, type OnDutyPharmacy } from '../../app/src/kiosk/pharmacies';
import { kioskStrings } from '../../app/src/kiosk/strings';
import {
  mountTouchPanel, TOUCH_FITS, TOUCH_MS, type TimelineMeasure, type TimelineRow, type TouchFit,
} from '../../app/src/kiosk/timeline';
import * as touchContent from '../../app/src/kiosk/touch-content';
import { loadStopBoardRows, pharmacyDetailVariants, rowDetailVariants, STOP_BOARD_ROWS, stopBoardVariants, TIMETABLE_LINE_TRIPS } from '../../app/src/kiosk/touch-content';
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
    // The same row code as the phone's board: the three lead rows alone are departures, the timetable line is no row.
    expect(board.querySelectorAll('li.sada-departure')).toHaveLength(3);
    expect(board.querySelectorAll('[data-kind=timetable]')).toHaveLength(0);
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

  // Owner, 5 Oct 2026: a second press on the "uvijek" row showed only "uvijek". No variant fitted, the leanest stayed
  // as it was, and the body's overflow:hidden cut its title away below the time. The last resort makes it fit.
  it('makes the leanest variant fit when none holds whole: its secondary lines go first, then its title is clamped to two lines, then to one', () => {
    expect(TOUCH_FITS).toEqual(['lean', 'clamp', 'tight']);
    const always = row({ id: 'always:gradska-vijecnica', kind: 'always', always: true, atMs: null, title: 'Zgrada Gradske vijećnice', sub: 'Trg Stjepana Radića 1' });
    const variants = rowDetailVariants(i18n, always, NOW);
    expect(variants.length).toBeGreaterThan(1);
    /** A box that holds the body only from `fit` on (TOUCH_FITS order); `null` never holds it. */
    const holdsFrom = (fit: TouchFit | null): TimelineMeasure => ({
      box: (el) => {
        if (!el.classList.contains('k-touch-body')) return { height: 200, width: 400, overflow: false };
        const at = el.dataset.fit === undefined ? -1 : TOUCH_FITS.indexOf(el.dataset.fit as TouchFit);
        return { height: 200, width: 400, overflow: fit === null || at < TOUCH_FITS.indexOf(fit) };
      },
      lines: () => 1,
    });
    const shown = (fit: TouchFit | null): HTMLElement => {
      const host = document.createElement('div');
      host.className = 'k-nearby-host';
      document.body.replaceChildren(host);
      mountTouchPanel(host, { measure: holdsFrom(fit) }).show('row', variants);
      return host.querySelector<HTMLElement>('.k-touch [data-testid=touch-detail]')!;
    };
    for (const fit of TOUCH_FITS) {
      const body = shown(fit);
      // The leanest variant, its time and its title always there, at the first fit its box holds.
      expect(body.outerHTML.replace(/ data-fit="\w+"/, '')).toBe(doc(variants.at(-1)!).querySelector<HTMLElement>('[data-testid=touch-detail]')!.outerHTML);
      expect(text(body.querySelector('.k-touch-when'))).toBe('uvijek');
      expect(text(body.querySelector('.k-touch-title'))).toBe('Zgrada Gradske vijećnice');
      expect(body.dataset.fit).toBe(fit);
    }
    // A box too small for anything keeps the tightest fit: the time and one line of the title.
    expect(shown(null).dataset.fit).toBe('tight');
    // A variant that holds whole carries no fit at all.
    const roomy = document.createElement('div');
    document.body.replaceChildren(roomy);
    mountTouchPanel(roomy, { measure: { box: () => ({ height: 900, width: 600, overflow: false }), lines: () => 1 } }).show('row', variants);
    expect(roomy.querySelector<HTMLElement>('[data-testid=touch-detail]')!.dataset.fit).toBeUndefined();
    expect([...roomy.querySelectorAll('.k-touch-line')].map(text)).toEqual(['Trg Stjepana Radića 1']);
    // The stylesheet: the secondary lines leave under any fit, the title clamps to two lines and then to one.
    const css = readFileSync(join(import.meta.dirname, '..', '..', 'app/src/ui/kiosk-city.css'), 'utf8');
    expect(css).toContain('.kiosk .k-touch-body[data-fit] .k-touch-line,.kiosk .k-touch-body[data-fit] .k-touch-timetable{display:none}');
    expect(css).toContain('.kiosk .k-touch-body[data-fit=clamp] .k-touch-title,.kiosk .k-touch-body[data-fit=tight] .k-touch-title{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}');
    expect(css).toContain('.kiosk .k-touch-body[data-fit=tight] .k-touch-title{-webkit-line-clamp:1;line-clamp:1}');
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

function mount(opts: { viewport?: { width: number; height: number }; modules?: () => ModuleSnapshot[]; mapMode?: KioskDeps['mapMode']; lightweight?: boolean; camera?: () => { center: [number, number]; zoom: number } | null; screen?: ScreenMetadata; boards?: Record<string, DepartureBoard>; loadTouchContent?: KioskDeps['loadTouchContent'] } = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const raw: Record<string, string> = { [BEACON_STORAGE_KEY]: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna', screen: opts.screen ?? SCREEN }) };
  const storage = { getItem: (k: string) => raw[k] ?? null, setItem: (k: string, v: string) => { raw[k] = v; }, removeItem: (k: string) => { delete raw[k]; } };
  const timers: Timer[] = [];
  let now = NOW;
  let handlers: Parameters<NonNullable<KioskDeps['createBeacon']>>[0] | null = null;
  const map = fakeMap(opts.camera);
  const boards = fakeBoards(opts.boards ?? BOARDS);
  const modules = opts.modules ?? (() => MODULES);
  const handle = mountKiosk(root, {
    cityStore: fakeCityStore(CITY), i18n, hash: '', storage, now: () => now, codeBase: 'https://zagreb.aningfilm.hr',
    reducedMotion: true, lightweight: opts.lightweight ?? false, viewport: opts.viewport ?? { width: 1920, height: 1080 }, mapMode: opts.mapMode,
    fetchTeaser: async () => ({ modules: modules() }), fetchSentences: async () => [], loadNetwork: async () => null,
    fetchData: async (module: ModuleId) => modules().find((m) => m.module === module) ?? snap(module, []),
    mapFactory: map.factory as never, loadStops: async () => STOPS, loadStreets: async () => [], loadLastRun: async () => null,
    createBoards: boards.create, theme, loadPaired: () => import('../../app/src/kiosk/paired'),
    loadTouchContent: opts.loadTouchContent ?? (() => touchContent),
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

describe('lazy touch content (DR2 budget)', () => {
  const tapPharmacy = (k: ReturnType<typeof mount>): void => k.q('[data-testid=strip-pharmacy]')!.click();
  /** The next gesture's finger coming down on the pharmacy (the wall starts the content's load on it); a second tap
   *  would close the open detail (5 Oct 2026). */
  const touchDown = (k: ReturnType<typeof mount>): void => { k.q('[data-testid=strip-pharmacy]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); };

  it('keeps content off startup, shares a pending gesture load and renders the current touch', async () => {
    let deliver!: (value: typeof touchContent) => void;
    const pending = new Promise<typeof touchContent>((resolve) => { deliver = resolve; });
    const load = vi.fn(() => pending);
    const k = mount({ loadTouchContent: load });
    await flush();
    expect(load).not.toHaveBeenCalled();
    tapPharmacy(k);
    touchDown(k);
    expect(load).toHaveBeenCalledTimes(1);
    expect(text(k.q('[data-testid=touch-loading]'))).toBe(i18n.t('status.loading'));
    expect(k.q('[data-testid=kiosk-invitation]')).not.toBeNull();
    expect(k.q('[data-testid=strip-pharmacy]')).not.toBeNull();
    deliver(touchContent);
    await flush();
    expect(k.detail()?.dataset.kind).toBe('pharmacy');
    expect(k.q('[data-testid=touch-loading]')).toBeNull();
    k.handle.destroy();
  });

  it('does not resurrect a touch whose deadline passed while loading', async () => {
    let deliver!: (value: typeof touchContent) => void;
    const k = mount({ loadTouchContent: () => new Promise((resolve) => { deliver = resolve; }) });
    await flush();
    tapPharmacy(k);
    k.setNow(NOW + TOUCH_MS);
    deliver(touchContent);
    await flush();
    expect(k.q('.k-touch')).toBeNull();
    expect(k.nearbyHost().hasAttribute('data-touch')).toBe(false);
    k.handle.destroy();
  });

  it('does not render or load a stop-board dependency after disposal', async () => {
    let deliver!: (value: typeof touchContent) => void;
    const loadRows = vi.fn(async () => true);
    const k = mount({ loadTouchContent: () => new Promise((resolve) => { deliver = resolve; }) });
    await flush();
    tapPharmacy(k);
    k.handle.destroy();
    deliver({ ...touchContent, loadStopBoardRows: loadRows });
    await flush();
    expect(loadRows).not.toHaveBeenCalled();
    expect(k.root.children).toHaveLength(0);
  });

  it.each(['reject', 'throw'] as const)('reports a %s failure and retries on the next gesture, not each tick', async (failure) => {
    let attempts = 0;
    const load = vi.fn(() => {
      if (++attempts > 1) return Promise.resolve(touchContent);
      if (failure === 'throw') throw new Error('chunk unavailable');
      return Promise.reject(new Error('chunk unavailable'));
    });
    const k = mount({ loadTouchContent: load });
    await flush();
    tapPharmacy(k);
    await flush();
    expect(text(k.q('[data-testid=touch-loading]'))).toBe(i18n.t('presentation.unavailable'));
    k.tick(CODE_TICK_MS);
    expect(load).toHaveBeenCalledTimes(1);
    touchDown(k);
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(k.detail()?.dataset.kind).toBe('pharmacy');
    k.handle.destroy();
  });
});

describe('the wall answers a touch (kiosk.ts)', () => {
  beforeAll(async () => { await loadStopBoardRows(); });
  it('opens the place\'s stop board from its ring at the map\'s centre for 30 s, over the list, without moving the camera, then returns by itself', async () => {
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
    // 30 s later the one-shot fires and the wall is the list again.
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

  it('opens another stop\'s board from its ring, asking for its boards, and a touch on another stop restarts the 30 s', async () => {
    const k = mount();
    await flush();
    k.touchMap(ZRINJEVAC);
    expect(k.boards.asked).toContain('107_1');
    await flush();
    const board = k.board()!;
    expect(text(board.querySelector('.k-touch-title'))).toBe('Zrinjevac');
    expect([...board.querySelectorAll('[data-kind=departure] .sada-dest')].map(text)).toEqual(['Sopot', 'Kaptol']);
    k.setNow(NOW + 20_000);
    k.touchMap(STOP);
    expect(text(k.board()!.querySelector('.k-touch-title'))).toBe('Trg bana J. Jelačića');
    k.setNow(NOW + TOUCH_MS + 1_000);
    k.tick(CODE_TICK_MS);
    expect(k.board()).not.toBeNull();
    k.setNow(NOW + 20_000 + TOUCH_MS);
    k.tick(CODE_TICK_MS);
    expect(k.board()).toBeNull();
    k.handle.destroy();
  });

  // lane/w-settings (24 Sep): the two ways a finger is read on the wall coexist. The brand's long press
  // (WP3, the hidden opener) is not a touch and a touch is not a press: neither opens the other's thing,
  // and the wall itself holds the keyboard's focus so Enter reaches Postavke without the brand.
  it('a press held on the brand opens Postavke and no board; the tap that ends it opens nothing; a ring under the open panel is not read', async () => {
    const k = mount();
    await flush();
    const brand = k.q<HTMLButtonElement>('[data-testid=kiosk-brand]')!;
    brand.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    k.tick(LONG_PRESS_MS); k.tick(LONG_PRESS_BEAT_MS);
    const panel = k.q('[data-testid=kiosk-settings-panel]');
    expect(panel).not.toBeNull();
    expect(panel!.hidden).toBe(false);
    expect(k.board()).toBeNull();
    brand.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
    brand.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(k.board()).toBeNull();
    expect(panel!.hidden).toBe(false);
    k.touchMap(STOP);
    expect(k.board()).toBeNull();
    k.handle.destroy();
  });

  it('a short tap on a ring opens the board and not Postavke; Enter on the wall then opens Postavke and the board goes', async () => {
    const k = mount();
    await flush();
    const brand = k.q<HTMLButtonElement>('[data-testid=kiosk-brand]')!;
    brand.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    brand.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
    brand.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    k.tick(LONG_PRESS_MS); k.tick(LONG_PRESS_BEAT_MS);
    k.touchMap(STOP);
    expect(k.board()).not.toBeNull();
    expect(k.q('[data-testid=kiosk-settings-panel]')).toBeNull();
    const wall = k.q('.kiosk')!;
    expect(wall.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(wall);
    wall.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(k.q('[data-testid=kiosk-settings-panel]')!.hidden).toBe(false);
    k.tick(CODE_TICK_MS);
    expect(k.board()).toBeNull();
    // Still no control on the wall's stage.
    expect(k.q('[data-testid=kiosk-invitation]')!.querySelectorAll('button, a[href], input, [tabindex]')).toHaveLength(0);
    k.handle.destroy();
  });

  // lane/w-settings (24 Sep, second step): the operator was told "press and hold anywhere on the wall for about a
  // second". A press held LONG_PRESS_MS anywhere on a screen-sized wall opens Postavke, since 5 Oct 2026 on the
  // touch's own targets too (a stop or pharmacy ring, a row of the list, the footer's pharmacy): the press opens
  // Postavke and its release's click is swallowed, while a tap there still opens the detail and a second tap closes
  // it. Slop 12 px; a handheld keeps only the brand's press.
  describe('a press held anywhere on the wall', () => {
    const pointer = (el: Element, type: string, x = 0, y = 0): boolean =>
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    const click = (el: Element, x = 0, y = 0): boolean => el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    const panel = (k: ReturnType<typeof mount>) => k.q('[data-testid=kiosk-settings-panel]');
    const ring = (k: ReturnType<typeof mount>, point: { lon: number; lat: number }): [number, number] =>
      fieldPixel(k.asked(), FIELD_DESIGN_WIDTH.wide, FIELD_DESIGN_HEIGHT.wide, point);

    it('on the map\'s empty ground for LONG_PRESS_MS opens Postavke and no board; the tap that ends it opens nothing', async () => {
      const k = mount();
      await flush();
      const map = k.q('[data-testid=kiosk-map]')!;
      pointer(map, 'pointerdown', 30, 30);
      expect(panel(k)).toBeNull();
      k.tick(LONG_PRESS_MS); k.tick(LONG_PRESS_BEAT_MS);
      expect(panel(k)).not.toBeNull();
      expect(panel(k)!.hidden).toBe(false);
      expect(k.board()).toBeNull();
      pointer(map, 'pointerup', 30, 30);
      click(map, 30, 30);
      expect(k.board()).toBeNull();
      expect(panel(k)!.hidden).toBe(false);
      k.handle.destroy();
    });

    it('on the header\'s date and on the open board itself opens Postavke too', async () => {
      const k = mount();
      await flush();
      pointer(k.q('[data-testid=kiosk-date]')!, 'pointerdown', 1800, 30);
      k.tick(LONG_PRESS_MS); k.tick(LONG_PRESS_BEAT_MS);
      expect(panel(k)!.hidden).toBe(false);
      pointer(k.q('[data-testid=kiosk-date]')!, 'pointerup', 1800, 30);
      panel(k)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(panel(k)!.hidden).toBe(true);
      k.touchMap(STOP);
      const board = k.board()!;
      expect(board).not.toBeNull();
      pointer(board, 'pointerdown', 1500, 600);
      k.tick(LONG_PRESS_MS); k.tick(LONG_PRESS_BEAT_MS);
      expect(panel(k)!.hidden).toBe(false);
      k.tick(CODE_TICK_MS);
      expect(k.board()).toBeNull();
      k.handle.destroy();
    });

    it('on a stop ring for LONG_PRESS_MS opens Postavke and no board, the release\'s click swallowed; a tap opens the board', async () => {
      const k = mount();
      await flush();
      const map = k.q('[data-testid=kiosk-map]')!;
      const [x, y] = ring(k, STOP);
      pointer(map, 'pointerdown', x, y);
      k.tick(LONG_PRESS_MS); k.tick(LONG_PRESS_BEAT_MS);
      expect(panel(k)!.hidden).toBe(false);
      expect(k.board()).toBeNull();
      pointer(map, 'pointerup', x, y);
      click(map, x, y);
      expect(k.board()).toBeNull();
      panel(k)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(panel(k)!.hidden).toBe(true);
      // A tap on the same ring opens its board; a second tap on it gives the list back.
      pointer(map, 'pointerdown', x, y);
      pointer(map, 'pointerup', x, y);
      click(map, x, y);
      expect(k.board()).not.toBeNull();
      expect(panel(k)!.hidden).toBe(true);
      pointer(map, 'pointerdown', x, y);
      pointer(map, 'pointerup', x, y);
      click(map, x, y);
      expect(k.board()).toBeNull();
      // Another ring on the frame, the same way: held, Postavke.
      const [zx, zy] = ring(k, ZRINJEVAC);
      pointer(map, 'pointerdown', zx, zy);
      k.tick(LONG_PRESS_MS); k.tick(LONG_PRESS_BEAT_MS);
      expect(panel(k)!.hidden).toBe(false);
      k.handle.destroy();
    });

    // Round 1 (24 Sep): the whole-city window (and a strip) draws one ring, the own place's, and no other stop bead
    // (prozor.stopMarks false); at its zoom the 28 px tolerance is 750 m of city, so with every stop a target a
    // press held anywhere on the map met an unseen stop and opened no Postavke, and a tap opened its board.
    it('on the whole-city window only the own ring answers: a press beside an unseen stop opens Postavke, a tap there no board', async () => {
      const place = { kind: 'tram' as const, name: STOP.name, lon: STOP.lon, lat: STOP.lat, stopId: STOP.id };
      const k = mount({ screen: { ...SCREEN, stop: null, place, placeSet: false } as ScreenMetadata });
      await flush();
      const map = k.q('[data-testid=kiosk-map]')!;
      expect((k.map.factory.mock.calls[0]![0] as { prozor?: { stopMarks?: boolean } }).prozor?.stopMarks).toBe(false);
      const [zx, zy] = ring(k, ZRINJEVAC);
      pointer(map, 'pointerdown', zx, zy);
      k.tick(LONG_PRESS_MS); k.tick(LONG_PRESS_BEAT_MS);
      expect(panel(k)).not.toBeNull();
      expect(panel(k)!.hidden).toBe(false);
      pointer(map, 'pointerup', zx, zy);
      panel(k)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(panel(k)!.hidden).toBe(true);
      click(map, zx, zy);
      expect(k.board()).toBeNull();
      // The own ring still opens its board on a tap.
      const [x, y] = ring(k, STOP);
      pointer(map, 'pointerdown', x, y);
      pointer(map, 'pointerup', x, y);
      click(map, x, y);
      expect(k.board()).not.toBeNull();
      expect(panel(k)!.hidden).toBe(true);
      k.handle.destroy();
    });

    // Owner, 5 Oct 2026: a press on the timeline put "uvijek / Zgrada Gradske vijećnice / Trg Stjepana Radića 1"
    // over the list for a minute, with no way back, and never opened Postavke.
    it('on a row of the list and on the footer\'s pharmacy opens Postavke and no detail; a tap opens the detail and a second tap closes it', async () => {
      const k = mount();
      await flush();
      const row = k.q<HTMLElement>('[data-testid=nearby-rows] > .nearby-row[data-kind=event]')!;
      expect(row).not.toBeNull();
      pointer(row, 'pointerdown', 1500, 500);
      k.tick(LONG_PRESS_MS); k.tick(LONG_PRESS_BEAT_MS);
      expect(panel(k)!.hidden).toBe(false);
      pointer(row, 'pointerup', 1500, 500);
      click(row, 1500, 500);
      expect(k.detail()).toBeNull();
      expect(k.nearbyHost().dataset.touch).toBeUndefined();
      panel(k)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(panel(k)!.hidden).toBe(true);
      // A tap opens the row's detail; a second tap on the row gives the list back.
      pointer(row, 'pointerdown', 1500, 500);
      pointer(row, 'pointerup', 1500, 500);
      click(row, 1500, 500);
      expect(k.detail()!.dataset.kind).toBe('event');
      pointer(row, 'pointerdown', 1500, 500);
      pointer(row, 'pointerup', 1500, 500);
      click(row, 1500, 500);
      expect(k.detail()).toBeNull();
      expect(k.nearbyHost().dataset.touch).toBeUndefined();
      // The footer's pharmacy: held, Postavke and no detail; tapped, its detail; tapped on the detail, the list again.
      const pharmacy = k.q('[data-testid=strip-pharmacy]')!;
      pointer(pharmacy, 'pointerdown', 900, 1050);
      k.tick(LONG_PRESS_MS); k.tick(LONG_PRESS_BEAT_MS);
      expect(panel(k)!.hidden).toBe(false);
      pointer(pharmacy, 'pointerup', 900, 1050);
      click(pharmacy, 900, 1050);
      expect(k.detail()).toBeNull();
      panel(k)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      // The strip is drawn again when the panel closes: the pharmacy is found again.
      const again = k.q('[data-testid=strip-pharmacy]')!;
      pointer(again, 'pointerdown', 900, 1050);
      pointer(again, 'pointerup', 900, 1050);
      click(again, 900, 1050);
      expect(text(k.detail()!.querySelector('.k-touch-kicker'))).toBe('Dežurna ljekarna 24/7: Trg bana J. Jelačića 3.');
      const detail = k.q('.k-touch')!;
      pointer(detail, 'pointerdown', 1500, 600);
      pointer(detail, 'pointerup', 1500, 600);
      click(detail, 1500, 600);
      expect(k.detail()).toBeNull();
      expect(k.q('.k-touch')).toBeNull();
      k.handle.destroy();
    });

    it('a short tap anywhere opens nothing, a finger past the 12 px slop opens nothing, and a handheld keeps only the brand\'s press', async () => {
      const k = mount();
      await flush();
      const map = k.q('[data-testid=kiosk-map]')!;
      pointer(map, 'pointerdown', 30, 30);
      pointer(map, 'pointerup', 30, 30);
      click(map, 30, 30);
      k.tick(LONG_PRESS_MS); k.tick(LONG_PRESS_BEAT_MS);
      expect(panel(k)).toBeNull();
      expect(k.board()).toBeNull();
      pointer(map, 'pointerdown', 30, 30);
      pointer(map, 'pointermove', 50, 30);
      k.tick(LONG_PRESS_MS); k.tick(LONG_PRESS_BEAT_MS);
      expect(panel(k)).toBeNull();
      pointer(map, 'pointerup', 50, 30);
      // Leaving the wall disarms as well.
      pointer(map, 'pointerdown', 30, 30);
      k.q('.kiosk')!.dispatchEvent(new PointerEvent('pointerleave', { clientX: -1, clientY: -1 }));
      k.tick(LONG_PRESS_MS); k.tick(LONG_PRESS_BEAT_MS);
      expect(panel(k)).toBeNull();
      k.handle.destroy();
      const phone = mount({ viewport: { width: 390, height: 844 } });
      await flush();
      expect(phone.q('.kiosk')!.dataset.size).toBe('handheld');
      pointer(phone.q('[data-testid=kiosk-date]')!, 'pointerdown', 300, 30);
      phone.tick(LONG_PRESS_MS); phone.tick(LONG_PRESS_BEAT_MS);
      expect(phone.q('[data-testid=kiosk-settings-panel]')).toBeNull();
      pointer(phone.q('[data-testid=kiosk-brand]')!, 'pointerdown', 40, 30);
      phone.tick(LONG_PRESS_MS); phone.tick(LONG_PRESS_BEAT_MS);
      expect(phone.q('[data-testid=kiosk-settings-panel]')!.hidden).toBe(false);
      phone.handle.destroy();
    });
  });

  it('lets nothing else react, the ground and a vehicle; a tap on the open board gives the list back', async () => {
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
    expect(k.board()).not.toBeNull();
    k.board()!.querySelector('li')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(k.board()).toBeNull();
    expect(k.q('.k-touch')).toBeNull();
    expect(k.nearbyHost().dataset.touch).toBeUndefined();
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
    // A second tap on the same row gives the list back at once (5 Oct 2026); the next opens the detail again.
    event.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(k.detail()).toBeNull();
    expect(k.nearbyHost().dataset.touch).toBeUndefined();
    event.querySelector('.nearby-title')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(k.detail()!.dataset.kind).toBe('event');
    // R1: the wall's departures are the cells of one line; a tap on any cell opens the place's board.
    const departures = k.q<HTMLElement>('[data-testid=nearby-rows] > .nearby-row[data-kind=departures]');
    expect(departures).not.toBeNull();
    expect(k.q('[data-testid=nearby-rows] > .nearby-row[data-kind=departure]')).toBeNull();
    // The list sits under the panel now; a touch on the list itself reaches it once the panel is gone.
    k.timers.find((t) => t.ms === TOUCH_MS && !t.cleared)!.fn();
    expect(k.detail()).toBeNull();
    departures!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(text(k.board()!.querySelector('.k-touch-title'))).toBe('Trg bana J. Jelačića');
    k.timers.find((t) => t.ms === TOUCH_MS && !t.cleared)!.fn();
    expect(k.board()).toBeNull();
    const second = departures!.querySelector<HTMLElement>('.k-dep-cell[data-cell="2"]');
    expect(second).not.toBeNull();
    (second!.querySelector('.nearby-when') ?? second)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
    // The handheld keeps one row per departure (R1: no departures line there).
    expect(phone.q('[data-testid=nearby-rows] > .nearby-row[data-kind=departure]')).not.toBeNull();
    expect(phone.q('[data-testid=nearby-rows] > .nearby-row[data-kind=departures]')).toBeNull();
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

describe('a touch quiets the reveals (R2)', () => {
  // docs/reveal-2026-10-plan/R2.md step 7: nothing moves while a touch is open. An evening board, six timetable
  // departures twelve minutes apart, makes an advance eligible on every fourth beat (the first shown departure is
  // more than ten minutes away and three next departures exist); the line advances within 100 s of ticks, and never
  // while a row's detail stands over the list.
  const evening: Record<string, DepartureBoard> = {
    '106_1': board('106_1', STOP.name, [12, 24, 36, 48, 60, 72].map((m, i) => dep(`late-${i}`, ['6', '11', '14', '17', '13', '12'][i]!, ['Črnomerec', 'Dubec', 'Mihaljevac', 'Prečko', 'Žitnjak', 'Dubrava'][i]!, m))),
  };
  const pointer = (el: Element, type: string, x = 0, y = 0): boolean =>
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  const click = (el: Element, x = 0, y = 0): boolean => el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
  const reveals = (k: ReturnType<typeof mount>): string[] => [k.q('[data-testid=nearby-rows]')?.dataset.reveal, k.q('[data-kind=departures]')?.dataset.reveal].filter((v): v is string => Boolean(v));
  const run = (k: ReturnType<typeof mount>, seconds: number): string[] => {
    const seen = new Set<string>();
    for (let s = 1; s <= seconds; s++) {
      k.setNow(NOW + s * 1000);
      k.tick(CODE_TICK_MS);
      for (const v of reveals(k)) seen.add(v);
    }
    return [...seen];
  };

  const serviceZet = (state: 'silent' | 'reduced'): ModuleSnapshot => ({
    ...ZET_LIVE,
    sources: { zet: { status: 'live', itemCount: 1, fetchedAt: iso(NOW), sourceUpdatedAt: iso(NOW),
      service: { state, since: iso(NOW), observedAt: iso(NOW), expected: 38, seen: state === 'silent' ? 0 : 8,
        ratio: state === 'silent' ? 0 : 8 / 38, confidence: 1, baseline: 'declared', byMode: { tram: [0, 17], bus: [0, 21] } } } },
  });

  it.each(['down', 'silent', 'reduced'] as const)('R2 review: the first paint of %s service is already quiet', async state => {
    let zet = ZET_LIVE;
    const k = mount({ boards: evening, modules: () => [zet, ...MODULES.slice(1)] });
    await flush();
    const calls = vi.spyOn(scheduler, 'takt');
    try {
      zet = state === 'down' ? { ...ZET_LIVE, status: 'down', items: [] } : serviceZet(state);
      k.setNow(NOW + 80_000); // An advance-eligible beat, before the next tick.
      k.poll();
      await flush();
      expect(calls).toHaveBeenCalled();
      expect(calls.mock.calls.every(args => args[3].quiet)).toBe(true);
      expect(reveals(k)).toEqual([]);
    } finally {
      calls.mockRestore();
      k.handle.destroy();
    }
  });

  it('R2 review: a recovered service does not lose its first eligible beat to the old header flag', async () => {
    let zet = serviceZet('silent');
    const k = mount({ boards: evening, modules: () => [zet, ...MODULES.slice(1)] });
    await flush();
    const calls = vi.spyOn(scheduler, 'takt');
    try {
      expect(k.q('[data-testid=kiosk]')?.dataset.sentenceLines).toBe('2');
      zet = ZET_LIVE;
      k.setNow(NOW + 80_000);
      k.poll();
      await flush();
      expect(calls).toHaveBeenCalled();
      expect(calls.mock.calls[0]![3].quiet).toBe(false);
      expect(reveals(k).some(v => v.startsWith('advance:'))).toBe(true);
    } finally {
      calls.mockRestore();
      k.handle.destroy();
    }
  });

  it('R2 review: opening a touch cancels an active reveal on that paint', async () => {
    const k = mount({ boards: evening });
    await flush();
    try {
      let found = false;
      for (let s = 1; s <= 100 && !found; s++) {
        k.setNow(NOW + s * 1000);
        k.tick(CODE_TICK_MS);
        found = reveals(k).length > 0;
      }
      expect(found).toBe(true);
      k.q('[data-testid=strip-pharmacy]')!.click();
      expect(k.detail()).not.toBeNull();
      expect(reveals(k)).toEqual([]);
    } finally {
      k.handle.destroy();
    }
  });

  it('R2 review: changing the screen place cancels the old stop advance immediately', async () => {
    const k = mount({ boards: { ...evening, '107_1': BOARDS['107_1']! } });
    await flush();
    try {
      let found = false;
      for (let s = 1; s <= 100 && !found; s++) {
        k.setNow(NOW + s * 1000);
        k.tick(CODE_TICK_MS);
        found = reveals(k).length > 0;
      }
      expect(found).toBe(true);
      k.handlers.onContext?.({ ...SCREEN, stop: ZRINJEVAC });
      expect(reveals(k)).toEqual([]);
    } finally {
      k.handle.destroy();
    }
  });

  it('R2 review: a page proposal the fitter cannot draw produces no reveal sentence fact', async () => {
    const k = mount({ boards: evening });
    await flush();
    const realTakt = scheduler.takt;
    const eventId = k.q('[data-testid=nearby-rows] > [data-kind=event]')!.dataset.id!;
    const calls = vi.spyOn(sentenceRuntime, 'sentenceFacts');
    // The scheduler and measured fit may disagree (R2 §0.5(14)): the proposed incoming row is already painted.
    const proposal = vi.spyOn(scheduler, 'takt').mockImplementation((candidates, history, at, options) => ({
      ...realTakt(candidates, history, at, options),
      reveal: { kind: 'page', ids: [eventId], replaces: [candidates.find(c => c.kind === 'solar')!.id],
        beat: scheduler.beatIndex(at, options.rhythmMs) },
    }));
    try {
      k.setNow(NOW + 20_000);
      k.tick(CODE_TICK_MS);
      expect(proposal).toHaveBeenCalled();
      expect(reveals(k)).toEqual([]);
      expect(calls.mock.results.flatMap(result => result.value as sentenceRuntime.SentenceFact[])
        .some(fact => fact.id.startsWith('reveal:'))).toBe(false);
    } finally {
      proposal.mockRestore();
      calls.mockRestore();
      k.handle.destroy();
    }
  });

  it('F11: a rejected proposal neither stamps unseen ids nor consumes the reveal gap', async () => {
    const k = mount({ boards: evening });
    await flush();
    const realTakt = scheduler.takt;
    const proposal = vi.spyOn(scheduler, 'takt').mockImplementation((candidates, history, at, options) => {
      const r = realTakt(candidates, history, at, options);
      const beat = scheduler.beatIndex(at, options.rhythmMs);
      return { ...r, reveal: { kind: 'page', ids: ['event:unpainted'], replaces: ['solar:missing'], beat },
        history: { ...r.history, shownAt: { ...r.history.shownAt, 'event:unpainted': at }, lastReveal: { kind: 'page', beat } } };
    });
    try {
      k.setNow(NOW + 20_000);
      k.tick(CODE_TICK_MS);
      expect(proposal).toHaveBeenCalled();
      expect(reveals(k)).toEqual([]);
      const before = proposal.mock.calls[0]![1].lastReveal;
      proposal.mockClear();
      k.setNow(NOW + 40_000);
      k.tick(CODE_TICK_MS);
      expect(proposal).toHaveBeenCalled();
      expect(proposal.mock.calls[0]![1].shownAt['event:unpainted']).toBeUndefined();
      expect(proposal.mock.calls[0]![1].lastReveal).toEqual(before);
      expect(proposal.mock.calls[0]![3].measuredPage1).toEqual(
        [...k.q('[data-testid=nearby-rows]')!.children].map(row => row.getAttribute('data-id')));
    } finally {
      proposal.mockRestore();
      k.handle.destroy();
    }
  });

  it('F11: the controller schedules the changed pool on the same measured paint and records only the partial overlay', async () => {
    const H = 3_600_000;
    const tall = 'Vrlo dugačak naziv izložbe koji se proteže preko mnogo redaka';
    let pool: TimelineRow[] = [
      ...[1, 2, 3].map(n => row({ id: `dep:${n}`, kind: 'departure', title: 'Dubec', atMs: NOW + n * 60_000,
        arrival: { tripId: `t${n}`, routeId: '6', routeName: '6', headsign: 'Dubec', atMs: NOW + n * 60_000, live: false, minutes: null } })),
      row({ id: 'notice:zet', kind: 'notice', title: 'ZET javlja' }),
      row({ id: 'closure:ilica', kind: 'closure', title: 'Ilica', atMs: NOW + 4 * H }),
      row({ id: 'event:kept', kind: 'event', title: 'Koncert', atMs: NOW + H }),
      row({ id: 'opennow:old', kind: 'open', title: 'Pekara', atMs: NOW + 2 * H }),
      row({ id: 'opennow:second', kind: 'open', title: 'Kavana', atMs: NOW + 2 * H }),
      row({ id: 'opening:tall', kind: 'opening', title: tall, atMs: NOW + 3 * H }),
      row({ id: 'solar:tall', kind: 'solar', title: tall, atMs: NOW + 5 * H }),
      row({ id: 'solar:short', kind: 'solar', title: 'Zalazak', atMs: NOW + 7 * H }),
      row({ id: 'always:story', kind: 'always', title: 'Trg', always: true, atMs: null }),
    ];
    const selection = vi.spyOn(nearbyRuntime, 'selectNearby').mockImplementation(() => pool);
    const realMount = timelineRuntime.mountTimeline;
    const fitter = vi.spyOn(timelineRuntime, 'mountTimeline').mockImplementation((host, deps) => realMount(host, {
      ...deps, measure: simulated(() => host.querySelector<HTMLElement>('[data-testid=nearby]')!, WALL_1920),
    }));
    const realTakt = scheduler.takt;
    let enable = false;
    const calls = vi.spyOn(scheduler, 'takt').mockImplementation((c, h, at, opts) => realTakt(c, h, at, { ...opts, quiet: !enable || opts.quiet }));
    const k = mount();
    await flush();
    try {
      const fitted = ['departures', 'notice:zet', 'closure:ilica', 'event:kept', 'opennow:new', 'opennow:second', 'always:story'];
      expect([...k.q('[data-testid=nearby-rows]')!.children].map(r => r.getAttribute('data-id')))
        .toEqual(fitted.map(id => id === 'opennow:new' ? 'opennow:old' : id));
      pool = pool.map(r => r.id === 'opennow:old' ? { ...r, id: 'opennow:new', title: 'Nova pekara' } : r);
      enable = true;
      calls.mockClear();
      k.setNow(NOW + 60_000);
      k.tick(CODE_TICK_MS);
      expect(calls.mock.calls[0]![3].measuredPage1).toEqual(fitted);
      expect(calls.mock.calls[0]![3].capacity).toBe(7);
      expect(calls.mock.results[0]!.value.reveal.ids).toEqual(['opening:tall', 'solar:tall']);
      expect(k.q('[data-id="solar:short"]')).not.toBeNull();
      expect(k.q('[data-id="opening:tall"]')).toBeNull();
      expect(k.q('[data-id="solar:tall"]')).toBeNull();
      expect(k.q('[data-id="opennow:second"]')).toBeNull();
      const startBeat = scheduler.beatIndex(NOW + 60_000, 20_000);
      expect(reveals(k)).toEqual([`page:${startBeat}`]);
      // A steady paint retains the accepted fallback, without another scheduler call or an early return.
      const count = calls.mock.calls.length;
      k.setNow(NOW + 61_000);
      k.tick(CODE_TICK_MS);
      expect(calls).toHaveBeenCalledTimes(count);
      expect(k.q('[data-id="solar:short"]')).not.toBeNull();
      calls.mockClear();
      k.setNow(NOW + 80_000);
      k.tick(CODE_TICK_MS);
      const [, history, , opts] = calls.mock.calls[0]!;
      expect(opts.measuredPage1).toEqual(fitted);
      expect(opts.capacity).toBe(7);
      expect(history.shownAt['solar:short']).toBe(NOW + 60_000);
      expect(history.shownAt['opening:tall']).toBeUndefined();
      expect(history.shownAt['solar:tall']).toBeUndefined();
      expect(history.shownAt['opennow:new']).toBe(NOW + 60_000);
      expect(history.lastReveal).toEqual({ kind: 'page', beat: startBeat });
      expect(reveals(k)).toEqual([]);
      expect(k.q('[data-id="opennow:second"]')).not.toBeNull();
    } finally {
      k.handle.destroy();
      calls.mockRestore();
      fitter.mockRestore();
      selection.mockRestore();
    }
  });

  it('R2 review: an advance dwells for one rhythm and a Ritam change reindexes its gap', async () => {
    const k = mount({ boards: evening });
    await flush();
    const calls = vi.spyOn(scheduler, 'takt');
    try {
      let start = NOW;
      for (let s = 1; s <= 100 && reveals(k).length === 0; s++) {
        start = NOW + s * 1000;
        k.setNow(start);
        k.tick(CODE_TICK_MS);
      }
      const active = reveals(k);
      expect(active).toHaveLength(1);
      k.setNow(start + 19_999);
      k.tick(CODE_TICK_MS);
      expect(reveals(k)).toEqual(active);
      k.setNow(start + 20_000);
      k.tick(CODE_TICK_MS);
      expect(reveals(k)).toEqual([]);
      k.q('[data-testid=kiosk]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      k.q('[data-testid=toggle-rhythm]')!.click();
      expect(k.q('[data-testid=kiosk]')?.dataset.rhythm).toBe('30');
      calls.mockClear();
      k.setNow(start + 50_000);
      k.tick(CODE_TICK_MS);
      expect(calls).toHaveBeenCalled();
      expect(calls.mock.calls[0]![1].lastReveal?.beat).toBe(scheduler.beatIndex(start, 30_000));
      expect(calls.mock.calls[0]![3].rhythmMs).toBe(30_000);
    } finally {
      calls.mockRestore();
      k.handle.destroy();
    }
  });

  it('R2 review: a backwards clock rebases the reveal gap instead of waiting for the old future beat', async () => {
    const k = mount({ boards: evening });
    await flush();
    try {
      expect(run(k, 80).some(v => v.startsWith('advance:'))).toBe(true);
      const back = NOW - 3_600_000;
      k.setNow(back);
      k.tick(CODE_TICK_MS);
      expect(reveals(k)).toEqual([]);
      const seen = new Set<string>();
      for (let s = 1; s <= 120; s++) {
        k.setNow(back + s * 1000);
        k.tick(CODE_TICK_MS);
        for (const v of reveals(k)) seen.add(v);
      }
      expect([...seen].some(v => v.startsWith('advance:'))).toBe(true);
    } finally {
      k.handle.destroy();
    }
  });

  it('without a touch the line advances on a beat within 100 s; with a row\'s detail open nothing is revealed for its 30 s', async () => {
    const loud = mount({ boards: evening });
    await flush();
    expect(loud.q('[data-kind=departures]')).not.toBeNull();
    const seen = run(loud, 100);
    expect(seen.some((v) => /^advance:\d+$/.test(v)), seen.join(', ')).toBe(true);
    expect(loud.q('[data-testid=nearby-rows]')?.dataset.reveal).toBeUndefined();
    loud.handle.destroy();

    const k = mount({ boards: evening });
    await flush();
    const row = k.q<HTMLElement>('[data-testid=nearby-rows] > .nearby-row[data-kind=event]')!;
    expect(row).not.toBeNull();
    pointer(row, 'pointerdown', 1500, 500);
    pointer(row, 'pointerup', 1500, 500);
    click(row, 1500, 500);
    expect(k.detail()).not.toBeNull();
    // For the touch's whole 30 s (TOUCH_MS) no beat reveals anything, on the list or the line.
    expect(run(k, TOUCH_MS / 1000 - 1)).toEqual([]);
    expect(k.detail()).not.toBeNull();
    // The wall returns by itself after its 30 s: the beats run again, and the advance is back within the next 100 s.
    const after = new Set<string>();
    for (let s = TOUCH_MS / 1000; s <= TOUCH_MS / 1000 + 100; s++) {
      k.setNow(NOW + s * 1000);
      k.tick(CODE_TICK_MS);
      for (const v of reveals(k)) after.add(v);
    }
    expect([...after].some((v) => /^advance:\d+$/.test(v)), [...after].join(', ')).toBe(true);
    k.handle.destroy();
  });
});
