// @vitest-environment happy-dom
// Sada, the ten-minute visit (companion WP4 step 3, §11, probes §15.6): the
// place is the title, then one sentence with its kicker, the phone's map band,
// three departures at the stop the place boards and "U blizini", the wall's own
// list continuing after them; no "Sada u gradu.", no date line, no
// instruction, no counts.
// The phone's renderers vet third-party text through the boundary, which refuses everything until the policy is installed: load it here as the page's chunks do.
import '../../shared/kiosk/external-text';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import type { DepartureBoard } from '../../shared/city/types';
import type { WrittenSentence } from '../../shared/kiosk/sentence';
import { loadSadaFeed, nearbyInput, NEARBY_DESK_ROWS, NEARBY_PHONE_ROWS } from '../../app/src/city/feed';
import type { ScreenContext, ScreenStop } from '../../app/src/core/contracts';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import hr from '../../app/src/i18n/hr.json';
import en from '../../app/src/i18n/en.json';
import { renderGradSada } from '../../app/src/layers/grad-sada';
import type { LayerContext } from '../../app/src/layers/types';
import type { CityMapOptions } from '../../app/src/map/city-map';
import { createMapSlots } from '../../app/src/map/map-slots';
import { reconcile } from '../../app/src/ui/dom/reconcile';

const NOW = Date.parse('2026-09-11T12:32:00Z'); // Friday 14:32 in Zagreb
const iso = (ms: number): string => new Date(ms).toISOString();
const attribution = { text: 'Izvor', url: 'https://example.test/', licence: 'Otvorena dozvola' };
const snap = (module: ModuleSnapshot['module'], items: ModuleSnapshot['items'], over: Partial<ModuleSnapshot> = {}): ModuleSnapshot =>
  ({ module, tier: 'open', status: 'live', fetchedAt: iso(NOW - 60_000), attribution, items, ...over });

const TRG: ScreenStop = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '13'] };
const TRG_2: ScreenStop = { id: '106_2', name: 'Trg bana J. Jelačića', lon: 15.97653, lat: 45.81307, routes: ['6', '13'] };
const KVATERNIK: ScreenStop = { id: '200_1', name: 'Kvaternikov trg', lon: 15.9964, lat: 45.8149, routes: ['4', '13'] };
const BUS: ScreenStop = { id: '300_1', name: 'Heinzelova', lon: 15.9990, lat: 45.8120, routes: ['108'] };
const STOPS = [TRG, TRG_2, KVATERNIK, BUS];

const board = (stop: ScreenStop, minutes: readonly number[]): DepartureBoard => ({
  operator: 'zet', stopId: stop.id, stopName: stop.name, status: 'live', generatedAt: iso(NOW - 60_000),
  departures: minutes.map((m, i) => ({ operator: 'zet', tripId: `${stop.id}-t${i}`, routeId: i % 2 ? '13' : '6', routeName: i % 2 ? '13' : '6', headsign: i % 2 ? 'Žitnjak' : 'Črnomerec', at: iso(NOW + m * 60_000) })),
});
const boards = (held: readonly DepartureBoard[]) => ({ ensure: vi.fn(), get: (_op: string, id: string) => held.find((b) => b.stopId === id), destroy: vi.fn() });

const SNAPSHOTS: LayerContext['snapshots'] = {
  'dhmz-now': snap('dhmz-now', [{ id: 'o1', module: 'dhmz-now', kind: 'observation', tier: 'open', title: 'Maksimir', at: iso(NOW - 30 * 60_000), data: { temp: 21, weather: 'vedro' } }]),
  'zet-rt': snap('zet-rt', [{ id: 'vehicle:1', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', geo: { type: 'Point', coordinates: [15.97, 45.81] }, data: { routeId: '6', routeShortName: '6' } }], { tier: 'session' }),
  prometnice: snap('prometnice', [
    // A closure beside the square, ending tonight; and one across town, outside the circle.
    { id: 'c1', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Ilica', at: '2026-09-01T07:00:00Z', until: '2026-09-11T20:00:00Z', geo: { type: 'LineString', coordinates: [[15.9750, 45.8130], [15.9740, 45.8131]] }, data: { type: 'ROAD_CLOSED', subtype: 'ROAD_CLOSED_CONSTRUCTION' } },
    { id: 'c2', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Sesvetska', at: '2026-09-01T07:00:00Z', until: '2026-09-30T20:00:00Z', geo: { type: 'LineString', coordinates: [[16.11, 45.83], [16.12, 45.83]] }, data: { type: 'ROAD_CLOSED', subtype: 'ROAD_CLOSED_CONSTRUCTION' } },
  ]),
  dogadanja: snap('dogadanja', [
    { id: 'kulturpunkt:1', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Koncert na Trgu', at: '2026-09-11T18:00:00Z', dateBasis: 'event', geo: { type: 'Point', coordinates: [15.9772, 45.8129] }, data: { source: 'kulturpunkt', precision: 'time', venue: 'Trg bana Jelačića' } },
  ], { tier: 'session' }),
};

const PHONE: ScreenContext = { surface: 'phone', locale: 'hr', theme: 'light', themePreference: 'light', lightweight: false, reducedMotion: false };
const DESK: ScreenContext = { ...PHONE, surface: 'desktop' };
const ctx = (over: Partial<LayerContext> = {}): LayerContext => ({
  i18n: createDefaultI18n('hr'), snapshots: SNAPSHOTS, now: NOW, screen: PHONE, stops: STOPS,
  boards: boards([board(TRG, [3, 9, 16, 24]), board(TRG_2, [6])]), ...over,
});
const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING
const fakeMaps = () => {
  const setView = vi.fn();
  const factory = vi.fn((_options: CityMapOptions) => ({ update: vi.fn(), destroy: vi.fn(), pause: vi.fn(), resume: vi.fn(), setView }));
  return { maps: createMapSlots(factory as never), factory, setView };
};

beforeAll(async () => {
  expect(await loadSadaFeed()).not.toBeNull();
});

describe('Sada answers before it explains', () => {
  it('prints no prompt, no "Sada u gradu.", no date line, no count and none of the old time band', () => {
    for (const surface of [PHONE, DESK]) {
      const section = renderGradSada(ctx({ screen: surface }));
      const all = text(section);
      expect(section.querySelector('.day-stop-prompt, [data-testid=tb], .day-overview, .day-date, .day-clock, [data-testid=tb-seg]')).toBeNull();
      expect(all).not.toContain('Sada u gradu');
      expect(all).not.toContain('Odaberi');
      expect(all).not.toContain('Radovi u gradu');
      expect(all).not.toMatch(/\b\d+ zatvaranja\b/);
      expect(all).not.toMatch(/petak|11\. 9\. 2026/);
      expect(all).not.toContain('Promet ↗');
      // The sources stay, crediting ZET for every blue time (§15.8 rule 7).
      expect(section.querySelector('details.provenance')).not.toBeNull();
    }
  });

  it('titles the page with the place: the stop nearest the reference, a tram stop before a nearer bus stop', () => {
    // Nothing on the screen and nothing saved; the device stands 77 m from Heinzelova (bus) and 303 m from Kvaternikov trg (tram).
    const section = renderGradSada(ctx({ location: { kind: 'device', lon: 15.9985, lat: 45.8126, name: '' } }));
    const title = section.querySelector('h2[data-testid=sada-place]')!;
    expect(text(title)).toBe('Kvaternikov trg');
    expect(title.classList.contains('layer-title')).toBe(true);
    expect(title.id).toBe('layer-title-grad-sada');
    expect(title.getAttribute('tabindex')).toBe('-1');
    // Without a reference the place is Trg bana J. Jelačića [O-65].
    expect(text(renderGradSada(ctx()).querySelector('[data-testid=sada-place]'))).toBe('Trg bana J. Jelačića');
  });

  it('shows three departures at the chosen stop, from every platform of it', () => {
    const cache = boards([board(TRG, [3, 9, 16, 24]), board(TRG_2, [6])]);
    const section = renderGradSada(ctx({ boards: cache }));
    expect(cache.ensure).toHaveBeenCalledWith('zet', ['106_1', '106_2'], undefined);
    const rows = section.querySelectorAll('[data-testid=day-departures] > li.sada-departure[data-live]');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows).toHaveLength(3);
  });

  it('reads in the owner’s order: place, sentence, departures, U blizini, sources; the phone without a map has no band', () => {
    const section = renderGradSada(ctx());
    const order = ['[data-testid=sada-place]', '[data-testid=sada-sentence]', '[data-testid=day-departures]', '[data-testid=nearby]', '[data-testid=provenance]']
      .map((selector) => section.querySelector(selector));
    for (const el of order) expect(el).not.toBeNull();
    for (let i = 1; i < order.length; i += 1) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & FOLLOWING).toBe(FOLLOWING);
    expect(section.querySelector('.sada-map, [data-testid=sada-map-band]')).toBeNull();
  });
});

describe('the sentence card', () => {
  it('writes one sentence with its kicker from the facts of this place when the page gives none', () => {
    const card = renderGradSada(ctx()).querySelector<HTMLElement>('article[data-testid=sada-sentence]')!;
    expect(['promet', 'kultura', 'vrijeme', 'bicikli', 'nocas', 'radovi']).toContain(card.dataset.kicker);
    expect(text(card.querySelector('.sada-kicker'))).toBe(hr.kiosk.sentence.kicker[card.dataset.kicker as keyof typeof hr.kiosk.sentence.kicker]);
    const sentence = text(card.querySelector('.sada-sentence-text'));
    expect(sentence.length).toBeGreaterThan(0);
    expect(sentence.length).toBeLessThanOrEqual(80);
    expect(card.hasAttribute('aria-busy')).toBe(false);
  });

  it('prints the page’s own sentence when it has one, and no card when the page says there is none', () => {
    const sentence: WrittenSentence = { kicker: 'kultura', text: 'U 20:00 počinje koncert na Trgu.', refs: ['event:1'], validUntil: NOW + 60_000, origin: 'template' } as WrittenSentence;
    const card = renderGradSada(ctx({ sentence })).querySelector<HTMLElement>('[data-testid=sada-sentence]')!;
    expect(card.dataset.kicker).toBe('kultura');
    expect(text(card)).toBe('KulturaU 20:00 počinje koncert na Trgu.');
    expect(renderGradSada(ctx({ sentence: null })).querySelector('[data-testid=sada-sentence]')).toBeNull();
    const english = renderGradSada(ctx({ i18n: createDefaultI18n('en'), sentence }));
    expect(text(english.querySelector('.sada-kicker'))).toBe(en.kiosk.sentence.kicker.kultura);
  });
});

describe('U blizini on the phone', () => {
  it('is the wall’s list: its head, then time-ordered rows with a time or "uvijek", never a departure the block above already shows', () => {
    const section = renderGradSada(ctx());
    const list = section.querySelector('section[data-testid=nearby]')!;
    // No network line order in a unit context: the frame's fallback circle for 6 stops, 2 km.
    expect(text(list.querySelector('[data-testid=nearby-head]'))).toBe('U blizini · 2 km · ~15 min');
    expect(text(list.querySelector('.nearby-pill'))).toBe('2 km · ~15 min');
    const rows = [...list.querySelectorAll<HTMLElement>('ol[data-testid=nearby-rows] > li.nearby-row')];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(NEARBY_PHONE_ROWS);
    for (const row of rows) {
      expect(row.dataset.id).toBeTruthy();
      expect(row.dataset.kind).not.toBe('departure');
      expect(row.dataset.source).toBeTruthy();
      const when = row.querySelector('.nearby-when')!;
      expect(when.tagName === 'TIME' ? row.dataset.when : row.dataset.always).toBeTruthy();
      expect(row.querySelector('.nearby-title')).not.toBeNull();
      expect(row.querySelector('.nearby-sub')).not.toBeNull();
    }
    const timed = rows.filter((row) => row.dataset.when).map((row) => Date.parse(row.dataset.when!));
    expect(timed).toEqual([...timed].sort((a, b) => a - b));
    // The closure beside the square is listed by its end; the one across town is outside the circle.
    expect(text(list)).toContain('Ilica');
    expect(text(list)).not.toContain('Sesvetska');
  });

  it('opens a row’s subject where it lives: the event in Događanja, the closure on Karta', () => {
    const list = renderGradSada(ctx()).querySelector('[data-testid=nearby]')!;
    const event = list.querySelector('li.nearby-row[data-kind=event] > a.nearby-link')!;
    expect(event.getAttribute('data-action')).toBe('nav');
    expect(event.getAttribute('data-layer')).toBe('kultura');
    expect(JSON.parse(event.getAttribute('data-selection')!)).toMatchObject({ kind: 'item', module: 'dogadanja' });
    expect(event.getAttribute('href')).toMatch(/^#layer=kultura&kind=item&id=[^&]+&module=dogadanja$/);
    expect(text(event.querySelector('.nearby-title'))).toBe('Koncert na Trgu');
    const closure = list.querySelector('li.nearby-row[data-kind=closure] > a.nearby-link')!;
    expect(closure.getAttribute('data-layer')).toBe('u-pokretu');
    expect(JSON.parse(closure.getAttribute('data-selection')!)).toMatchObject({ kind: 'item', module: 'prometnice' });
    // The time, the day word and the texts stay inside the one link.
    expect(event.querySelector('time.nearby-when')).not.toBeNull();
  });

  it('keeps more rows on a desk and reads the same input the Karta sheet reads', () => {
    const input = nearbyInput(ctx({ screen: DESK }));
    expect(input.place).toMatchObject({ kind: 'tram', name: 'Trg bana J. Jelačića', stopId: '106_1' });
    expect(input.radiusM).toBe(2000);
    expect(input.boards.map((b) => b.stopId)).toEqual(['106_1', '106_2']);
    expect(NEARBY_DESK_ROWS).toBeGreaterThan(NEARBY_PHONE_ROWS);
    const rows = renderGradSada(ctx({ screen: DESK })).querySelectorAll('[data-testid=nearby] li.nearby-row');
    expect(rows.length).toBeLessThanOrEqual(NEARBY_DESK_ROWS);
  });

  it('names no missing location and no source placeholder for an event without a venue: such an event is simply not near', () => {
    const unplaced = snap('dogadanja', [{ id: 'kulturpunkt:2', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Predavanje bez mjesta', at: '2026-09-11T17:00:00Z', dateBasis: 'event', data: { source: 'kulturpunkt', precision: 'time' } }], { tier: 'session' });
    const list = renderGradSada(ctx({ snapshots: { ...SNAPSHOTS, dogadanja: unplaced } })).querySelector('[data-testid=nearby]')!;
    expect(text(list)).not.toContain('Predavanje bez mjesta');
    expect(text(list)).not.toContain('Lokacija nije navedena');
  });
});

describe('the map band', () => {
  it('is a still 112 px map around the place on the phone, with one link over it that opens Karta', () => {
    const { maps, factory } = fakeMaps();
    const section = renderGradSada(ctx({ maps }));
    const band = section.querySelector<HTMLElement>('.sada-map[data-testid=sada-map-band]')!;
    expect(band).not.toBeNull();
    // After the sentence, before the departures.
    expect(section.querySelector('[data-testid=sada-sentence]')!.compareDocumentPosition(band) & FOLLOWING).toBe(FOLLOWING);
    expect(band.compareDocumentPosition(section.querySelector('[data-testid=day-departures]')!) & FOLLOWING).toBe(FOLLOWING);
    const open = band.querySelector('a.sada-map-open')!;
    expect(open.getAttribute('href')).toBe('#layer=u-pokretu');
    expect(open.getAttribute('data-action')).toBe('nav');
    expect(open.getAttribute('data-layer')).toBe('u-pokretu');
    expect(open.getAttribute('aria-label')).toBe('Karta oko mjesta Trg bana J. Jelačića. Otvori Kartu.');
    expect(band.querySelector('[data-testid=sada-map-canvas]')).not.toBeNull();
    expect(factory).toHaveBeenCalledTimes(1);
    const options = factory.mock.calls[0]![0];
    expect(options).toMatchObject({ renderer: 'map', interactive: false, still: true, attributionCompact: true, presentationProfile: 'handheld', center: [TRG.lon, TRG.lat] });
    // Lane p-map2: the band draws on news and parks (CityMapOptions.still); the glide is Karta's.
    expect(options.ariaLabel).toBe('Karta oko mjesta Trg bana J. Jelačića. Otvori Kartu.');
    expect(options.zoom).toBeGreaterThanOrEqual(12.7);
    expect(options.zoom).toBeLessThanOrEqual(15.5);
    expect(options.points!.some((p) => p.id === 'vehicle:1')).toBe(true);
    expect(options.lines!.length).toBe(2);
  });

  it('keeps its live map across a poll and moves the camera only when the place moves', () => {
    const { maps, factory, setView } = fakeMaps();
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.appendChild(renderGradSada(ctx({ maps })));
    const canvas = host.querySelector('[data-testid=sada-map-canvas]')!;
    const next = document.createElement('div');
    next.appendChild(renderGradSada(ctx({ maps })));
    reconcile(host, next);
    expect(host.querySelector('[data-testid=sada-map-canvas]')).toBe(canvas);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(setView).not.toHaveBeenCalled();
    const moved = document.createElement('div');
    moved.appendChild(renderGradSada(ctx({ maps, location: { kind: 'device', lon: 15.9985, lat: 45.8126, name: '' } })));
    reconcile(host, moved);
    expect(host.querySelector('[data-testid=sada-map-canvas]')).toBe(canvas);
    expect(setView).toHaveBeenCalledTimes(1);
    expect(setView.mock.calls[0]![0].center).toEqual([KVATERNIK.lon, KVATERNIK.lat]);
    host.remove();
  });

  it('stays off the desk and off lagano', () => {
    for (const over of [{ screen: DESK }, { lightweight: true }] as Partial<LayerContext>[]) {
      const { maps, factory } = fakeMaps();
      expect(renderGradSada(ctx({ maps, ...over })).querySelector('.sada-map')).toBeNull();
      expect(factory).not.toHaveBeenCalled();
    }
  });
});

describe('before the feed module is in hand', () => {
  it('holds the sentence and the list with one busy row each, then draws them once the module arrives', async () => {
    vi.resetModules();
    const fresh = await import('../../app/src/layers/grad-sada');
    const feed = await import('../../app/src/city/feed');
    const onLocalData = vi.fn();
    const first = fresh.renderGradSada(ctx({ onLocalData }));
    expect(first.querySelector('[data-testid=sada-sentence]')?.getAttribute('aria-busy')).toBe('true');
    expect(first.querySelector('[data-testid=nearby]')?.getAttribute('aria-busy')).toBe('true');
    expect(first.querySelectorAll('[data-testid=nearby] li.nearby-row')).toHaveLength(0);
    // The departures and the title hold their place too: the chunk carries the third-party text policy, and the
    // boundary refuses every ZET string until it is in hand (never unchecked text, never a false "no departures").
    expect(first.querySelector('[data-testid=day-departures]')?.getAttribute('aria-busy')).toBe('true');
    expect(first.querySelectorAll('[data-testid=day-departures] > li.sada-departure')).toHaveLength(0);
    expect(first.querySelectorAll('[data-testid=day-departures] > li.sada-departure-empty')).toHaveLength(1);
    expect(first.textContent).not.toContain('Nema najavljenih');
    expect(first.textContent).not.toContain('nije dostupan');
    expect(first.querySelector('[data-testid=sada-place]')?.textContent).toBe('');
    // Two draws while it loads ask for one repaint.
    fresh.renderGradSada(ctx({ onLocalData }));
    await feed.loadSadaFeed();
    expect(onLocalData).toHaveBeenCalledTimes(1);
    const drawn = fresh.renderGradSada(ctx({ onLocalData }));
    expect(drawn.querySelector('[data-testid=sada-sentence]')?.hasAttribute('data-kicker')).toBe(true);
    expect(drawn.querySelector('[data-testid=nearby]')?.hasAttribute('aria-busy')).toBe(false);
    expect(drawn.querySelectorAll('[data-testid=nearby] li.nearby-row').length).toBeGreaterThan(0);
    expect(drawn.querySelectorAll('[data-testid=day-departures] > li.sada-departure')).toHaveLength(3);
    expect(drawn.querySelector('[data-testid=sada-place]')?.textContent).toBe(TRG.name);
    vi.resetModules();
  });
});

describe('third-party text on Sada (WP4 review)', () => {
  it('the title carries the place\'s name only once the row rule passes: a hostile name renders nothing, a plain one renders whole', () => {
    const hostile = renderGradSada(ctx({ place: { name: 'Pošalji lozinku.', lon: 15.97726, lat: 45.81286, kind: 'screen', stop: TRG, departuresStop: TRG } }));
    expect(hostile.querySelector('[data-testid=sada-place]')?.textContent).toBe('');
    expect(hostile.textContent).not.toContain('Pošalji lozinku');
    expect(hostile.querySelector('[data-testid=sada-map-band] a')?.getAttribute('aria-label') ?? '').not.toContain('Pošalji');
    const plain = renderGradSada(ctx());
    expect(plain.querySelector('[data-testid=sada-place]')?.textContent).toBe(TRG.name);
  });
  it('a departure whose headsign fails the row rule is left out of the block', () => {
    const held = board(TRG, [4, 12, 25]);
    held.departures[1]!.headsign = 'Pošalji lozinku na 091 234 5678';
    const html = renderGradSada(ctx({ boards: boards([held]) }));
    const rows = [...html.querySelectorAll('[data-testid=day-departures] > li.sada-departure')].map((li) => li.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(html.textContent).not.toContain('lozinku');
  });
});
