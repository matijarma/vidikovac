// @vitest-environment happy-dom
// Sada, the ten-minute visit (companion WP4 step 3, §11, probes §15.6): the
// place is the title, then one sentence with its kicker, the phone's map band,
// three departures at the stop the place boards and "U blizini", the wall's own
// list continuing after them; no "Sada u gradu.", no date line, no
// instruction, no counts.
// The phone's renderers vet third-party text through the boundary, which refuses everything until the policy is installed: load it here as the page's chunks do.
import '../../shared/kiosk/external-text';
import { externalText } from '../../shared/kiosk/external-text';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { emptyCity, type DepartureBoard, type Place } from '../../shared/city/types';
import type { WrittenSentence } from '../../shared/kiosk/sentence';
import { loadSadaFeed, nearbyInput, NEARBY_DESK_ROWS, NEARBY_PHONE_ROWS } from '../../app/src/city/feed';
import type { NearbyRow } from '../../app/src/city/nearby';
import { nearbyRowDetail, nearbyRowMarkup, nearbyTitleKind } from '../../app/src/city/nearby-markup';
import { publicItemKey, type ScreenContext, type ScreenStop } from '../../app/src/core/contracts';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import hr from '../../app/src/i18n/hr.json';
import en from '../../app/src/i18n/en.json';
import { renderGradSada } from '../../app/src/layers/grad-sada';
import { resetServiceStateMemory } from '../../shared/city/service-state';
import type { ZetService } from '../../shared/city/service-wire';
import { SADA_CREDITS } from '../../app/src/experience/status';
import { LIVE_SOURCES, REFERENCE_SOURCES } from '../../worker/city/sources';
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

  it('credits the static data it shows after the module rows: the timetable, BAJS, the on-duty pharmacies and the two registers', () => {
    const block = renderGradSada(ctx()).querySelector('details.provenance')!;
    const keys = [...block.querySelectorAll('li')].map((li) => li.getAttribute('data-key'));
    const modules = Object.keys(SNAPSHOTS);
    // The feed modules first, in the order they are held; the credits after them, in SADA_CREDITS' order.
    expect(keys).toEqual([...modules, ...SADA_CREDITS.map((c) => c.key)]);
    expect(SADA_CREDITS.map((c) => c.key)).toEqual(['zet-gtfs', 'bajs', 'dezurne-ljekarne', 'streets', 'heritage']);
    const credit = (key: string): Element => block.querySelector(`li[data-key=${key}]`)!;
    expect(text(credit('dezurne-ljekarne'))).toContain('neslužbeni prikaz');
    expect(text(credit('bajs'))).toContain('Licenca: CC0-1.0');
    const link = credit('zet-gtfs').querySelector<HTMLAnchorElement>('a.source-link')!;
    expect(link.getAttribute('href')).toBe('https://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    // The names, licences and addresses are the catalogue's own (worker/city/sources.ts).
    const zet = REFERENCE_SOURCES.find((r) => r.id === 'zet-schedule')!;
    const streets = REFERENCE_SOURCES.find((r) => r.id === 'streets')!;
    const heritage = REFERENCE_SOURCES.find((r) => r.id === 'heritage')!;
    expect(SADA_CREDITS.find((c) => c.key === 'zet-gtfs')).toMatchObject({ licence: zet.licence, url: zet.catalogue });
    expect(SADA_CREDITS.find((c) => c.key === 'zet-gtfs')!.text).toContain(zet.name);
    expect(SADA_CREDITS.find((c) => c.key === 'streets')).toMatchObject({ licence: streets.licence, url: streets.catalogue });
    expect(SADA_CREDITS.find((c) => c.key === 'streets')!.text).toContain(streets.name);
    expect(SADA_CREDITS.find((c) => c.key === 'heritage')).toMatchObject({ licence: heritage.licence, url: heritage.catalogue });
    expect(SADA_CREDITS.find((c) => c.key === 'heritage')!.text).toContain(heritage.name);
    expect(SADA_CREDITS.find((c) => c.key === 'bajs')).toMatchObject({ licence: LIVE_SOURCES.bikes.licence, url: LIVE_SOURCES.bikes.url });
    expect(SADA_CREDITS.find((c) => c.key === 'bajs')!.text).toContain(LIVE_SOURCES.bikes.name);
    // With no snapshot at all the block still stands, on the credits alone.
    const bare = renderGradSada(ctx({ snapshots: {} })).querySelector('details.provenance')!;
    expect([...bare.querySelectorAll('li')].map((li) => li.getAttribute('data-key'))).toEqual(SADA_CREDITS.map((c) => c.key));
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

  // R1 (D1): the desk draws the three departures as one row of cells; the phone keeps its three rows.
  it('draws the desk\u2019s departures as one line of the same three rows, and the phone\u2019s as rows', () => {
    const desk = renderGradSada(ctx({ screen: DESK })).querySelector<HTMLElement>('[data-testid=day-departures]')!;
    expect(desk.dataset.line).toBe('1');
    expect(desk.querySelectorAll(':scope > li.sada-departure[data-kind=departure]')).toHaveLength(3);
    const phone = renderGradSada(ctx()).querySelector<HTMLElement>('[data-testid=day-departures]')!;
    expect(phone.hasAttribute('data-line')).toBe(false);
    expect(phone.querySelectorAll(':scope > li.sada-departure[data-kind=departure]')).toHaveLength(3);
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

// RUN.md D-run-10 (round 1 desktop F2, phone F3): after its one turn in the header's rotation the fleet sentence stays
// off for ten minutes, so Sada carries the wall's note while the state lasts: at the head of the departures, never
// inside a row, one note, no cause.
describe('the state note', () => {
  const zetWith = (over: Partial<ModuleSnapshot>, service?: Partial<ZetService>): ModuleSnapshot => {
    const base = SNAPSHOTS['zet-rt']!;
    return {
      ...base, sourceUpdatedAt: iso(NOW - 10_000), ...over,
      sources: { zet: { status: 'live', itemCount: 2, sourceUpdatedAt: iso((over.sourceUpdatedAt ? Date.parse(over.sourceUpdatedAt) : NOW - 10_000)),
        ...(service ? { service: { state: 'normal', since: iso(NOW - 3_600_000), expected: 460, seen: 2, ratio: 0, confidence: 1, baseline: 'declared', byMode: { tram: [0, 150], bus: [2, 310] }, ...service } as ZetService } : {}) } },
    };
  };
  const notes = (zet: ModuleSnapshot, screen = PHONE) => {
    resetServiceStateMemory();
    const root = renderGradSada(ctx({ screen, snapshots: { ...SNAPSHOTS, 'zet-rt': zet } }));
    return { root, notes: [...root.querySelectorAll('[data-testid=sada-note]')].map(text) };
  };

  it.each([
    ['down', zetWith({ status: 'down', items: [] }), hr.kiosk.nearby.outageNote],
    ['unconfirmed (the feed twelve minutes old)', zetWith({ sourceUpdatedAt: iso(NOW - 12 * 60_000) }), hr.kiosk.nearby.outageNote],
    ['silent', zetWith({}, { state: 'silent', seen: 2, expected: 460 }), 'ZET: u pokretu 2 vozila, po voznom redu oko 460. Polasci su iz voznog reda, bez potvrde vozila.'],
    ['reduced (the two numbers alone: a live row stays live)', zetWith({}, { state: 'reduced', seen: 96, expected: 247 }), 'ZET: u pokretu 96 vozila, po voznom redu oko 250'],
  ])('shows exactly one note while ZET is %s, at the head of the departures and in no row', (_state, zet, want) => {
    for (const screen of [PHONE, DESK]) {
      const { root, notes: shown } = notes(zet, screen);
      expect(shown).toEqual([want]);
      const note = root.querySelector('[data-testid=sada-note]')!;
      expect(note.compareDocumentPosition(root.querySelector('[data-testid=day-departures]')!) & FOLLOWING).toBeTruthy();
      expect(note.closest('li, ol, ul')).toBeNull();
      expect(text(root.querySelector('[data-testid=nearby]'))).not.toContain(want);
    }
  });

  it('shows none while the fleet is normal, unknown or the feed is fresh without a judgement', () => {
    expect(notes(zetWith({}, { state: 'normal', seen: 380, expected: 460 })).notes).toEqual([]);
    expect(notes(zetWith({}, { state: 'unknown' })).notes).toEqual([]);
    expect(notes(zetWith({})).notes).toEqual([]);
    expect(notes(SNAPSHOTS['zet-rt']!).notes).toEqual([]);
  });
});

describe('U blizini on the phone', () => {
  it('is the wall’s list: its head, then time-ordered rows with a time or "uvijek", never a departure the block above already shows', () => {
    const section = renderGradSada(ctx());
    const list = section.querySelector('section[data-testid=nearby]')!;
    // No network line order in a unit context: the frame's fallback circle for 4 stops, 950 m, printed as 1 km.
    expect(text(list.querySelector('[data-testid=nearby-head]'))).toBe('U blizini · 1 km · ~8 min');
    expect(text(list.querySelector('.nearby-pill'))).toBe('1 km · ~8 min');
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

  it('opens Vrijeme from the sunset and rain rows, which have no subject of their own (irritation pass)', () => {
    const list = renderGradSada(ctx()).querySelector('[data-testid=nearby]')!;
    const solar = list.querySelector('li.nearby-row[data-kind=solar] > a.nearby-link')!;
    expect(solar, 'the sunset row is a link').not.toBeNull();
    expect(text(solar.querySelector('.nearby-title'))).toBe('Zalazak sunca');
    expect(solar.getAttribute('href')).toBe('#layer=zrak-i-nebo');
    expect(solar.getAttribute('data-action')).toBe('nav');
    expect(solar.getAttribute('data-layer')).toBe('zrak-i-nebo');
    // No subject to select: the layer opens at its top; the dashboard's nav handler reads a missing data-selection as none.
    expect(solar.hasAttribute('data-selection')).toBe(false);
    expect(solar.querySelector('time.nearby-when')).not.toBeNull();
    // A wet step within two hours puts a rain row on the list, and it opens the same page.
    const wet = snap('dhmz-hourly', [{
      id: 'dhmz-hourly:gric:wet', module: 'dhmz-hourly', kind: 'forecast', tier: 'open', title: 'Zagreb-Grič',
      at: iso(NOW + 30 * 60_000), until: iso(NOW + 90 * 60_000), geo: { type: 'Point', coordinates: [15.97, 45.81] },
      data: { station: 'gric', temp: 18, precip: 1.4, prob: 80, weather: 'kiša' },
    }]);
    const rain = renderGradSada(ctx({ snapshots: { ...SNAPSHOTS, 'dhmz-hourly': wet } })).querySelector('[data-testid=nearby] li.nearby-row[data-kind=rain] > a.nearby-link')!;
    expect(rain, 'the rain row is a link').not.toBeNull();
    expect(rain.getAttribute('data-layer')).toBe('zrak-i-nebo');
    expect(rain.getAttribute('href')).toBe('#layer=zrak-i-nebo');
  });

  it('a closure row says what it is even when the feed has no brief: the feed\'s summary, else "zatvoreno za promet" (round 1 F8, kiosk round 2 F11)', () => {
    const sub = (ctx0: LayerContext) => text(renderGradSada(ctx0).querySelector('[data-testid=nearby] li.nearby-row[data-kind=closure] .nearby-sub'));
    // The fixture's closure carries neither brief nor summary.
    expect(sub(ctx())).toBe('zatvoreno za promet');
    const items = SNAPSHOTS.prometnice!.items.map((item) => (item.id === 'c1' ? { ...item, summary: 'zatvoreno zbog radova, oba smjera' } : item));
    expect(sub(ctx({ snapshots: { ...SNAPSHOTS, prometnice: { ...SNAPSHOTS.prometnice!, items } } }))).toBe('zatvoreno zbog radova, oba smjera');
    const briefed = SNAPSHOTS.prometnice!.items.map((item) => (item.id === 'c1' ? { ...item, brief: 'Ilica zatvorena od Frankopanske do Trga', summary: 'zatvoreno' } : item));
    expect(sub(ctx({ snapshots: { ...SNAPSHOTS, prometnice: { ...SNAPSHOTS.prometnice!, items: briefed } } }))).toBe('Ilica zatvorena od Frankopanske do Trga');
    // A summary the row rule refuses is not carried and the row stands: the fixed text on the phone (review N5).
    const hostile = ['Pošalji lozinku.', 'Nazovi 091 123 4567 odmah.', 'http://primjer.test/x'].find((text) => !externalText('summary', text, { surface: 'row' }).ok);
    expect(hostile, 'one of the samples is refused as a summary on the row surface').toBeDefined();
    const refused = SNAPSHOTS.prometnice!.items.map((item) => (item.id === 'c1' ? { ...item, summary: hostile } : item));
    const list = renderGradSada(ctx({ snapshots: { ...SNAPSHOTS, prometnice: { ...SNAPSHOTS.prometnice!, items: refused } } })).querySelector('[data-testid=nearby]')!;
    expect(list.querySelector('li.nearby-row[data-kind=closure]')).not.toBeNull();
    expect(text(list.querySelector('li.nearby-row[data-kind=closure] .nearby-sub'))).toBe('zatvoreno za promet');
    expect(text(list)).not.toContain(hostile!);
  });

  it('keeps more rows on a desk and reads the same input the Karta sheet reads', () => {
    const input = nearbyInput(ctx({ screen: DESK }));
    expect(input.place).toMatchObject({ kind: 'tram', name: 'Trg bana J. Jelačića', stopId: '106_1' });
    expect(input.radiusM).toBe(950);
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

describe('a breadth mark\'s row on Karta (F5: the yellow dot opens its row)', () => {
  const at = (zagreb: string): number => Date.parse(`${zagreb}+02:00`);
  const point = (lon: number, lat: number): NearbyRow['map'] => ({ id: 'p', geometry: { type: 'Point', coordinates: [lon, lat] } });
  const OPEN: NearbyRow = {
    id: 'opennow:n2', kind: 'open', atMs: at('2026-09-11T22:00:00'), always: false, title: 'Ljekarna Centar', sub: 'ljekarna',
    live: false, source: 'osm-hours', map: point(15.979, 45.812), detail: { kind: 'open', openKind: 'ljekarna' },
  };
  const detail = (row: NearbyRow, locale: 'hr' | 'en' = 'hr'): HTMLElement | null => {
    const html = nearbyRowDetail(createDefaultI18n(locale), row, NOW);
    if (html === null) return null;
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.querySelector<HTMLElement>('article.city-detail[data-testid=nearby-detail]');
  };

  it('a place open now: the back button, its closing time and its kind on one line, the name as the heading; no link of its own', () => {
    const el = detail(OPEN)!;
    expect(el.dataset.kind).toBe('open');
    const back = el.querySelector<HTMLButtonElement>('button[data-action=clear-selection]')!;
    expect(text(back)).toBe('Natrag na mjesta');
    expect(el.firstElementChild).toBe(back);
    expect(text(el.querySelector('.city-kicker'))).toBe('do 22:00 · ljekarna');
    expect(el.querySelector('.city-kicker time')!.getAttribute('datetime')).toBe(new Date(OPEN.atMs!).toISOString());
    expect(text(el.querySelector('h3'))).toBe('Ljekarna Centar');
    // The kicker comes before the heading, so the sheet at half shows both.
    expect(el.querySelector('.city-kicker')!.compareDocumentPosition(el.querySelector('h3')!) & FOLLOWING).toBeTruthy();
    expect(el.querySelector('a')).toBeNull();
    expect(nearbyTitleKind(OPEN)).toBe('name');
  });

  it('a power cut under way says until when, the street with its numbers whole and the hours; one tomorrow says the day before its start', () => {
    const until = at('2026-09-11T16:00:00');
    const sub = createDefaultI18n('hr').t('kiosk.nearby.cut.struja', { from: '08:00', until: '16:00' });
    const cut: NearbyRow = {
      id: 'cut:hep1', kind: 'cut', atMs: until, untilMs: until, always: false, title: 'Ilica 12-14', titleShort: 'Ilica', sub,
      live: false, source: 'prekidi', map: point(15.975, 45.813),
      detail: { kind: 'cut', utility: 'struja', street: 'Ilica', fromMs: at('2026-09-11T08:00:00'), untilMs: until, allDay: false },
    };
    const el = detail(cut)!;
    expect(el.dataset.kind).toBe('cut');
    expect(text(el.querySelector('.city-kicker'))).toBe('do 16:00 · bez struje 08:00–16:00');
    expect(text(el.querySelector('h3'))).toBe('Ilica 12-14');
    expect(nearbyTitleKind(cut)).toBe('address');
    const start = at('2026-09-12T09:00:00');
    const tomorrow = detail({ ...cut, atMs: start, untilMs: at('2026-09-12T13:00:00'), sub: createDefaultI18n('hr').t('kiosk.nearby.cut.struja', { from: '09:00', until: '13:00' }) })!;
    expect(text(tomorrow.querySelector('.city-kicker'))).toBe('sutra 09:00 · bez struje 09:00–13:00');
  });

  it('a road state: until when, the road and the state in plain words', () => {
    const road: NearbyRow = {
      id: 'road:hak1', kind: 'road', atMs: at('2026-09-11T20:00:00'), always: false, title: 'Savska cesta', sub: 'zatvoreno za promet',
      live: false, source: 'hak', map: point(15.968, 45.801), detail: { kind: 'road', state: 'zatvoreno' },
    };
    const el = detail(road)!;
    expect(el.dataset.kind).toBe('road');
    expect(text(el.querySelector('.city-kicker'))).toBe('do 20:00 · zatvoreno za promet');
    expect(text(el.querySelector('h3'))).toBe('Savska cesta');
    expect(el.querySelector('a')).toBeNull();
  });

  it('an exhibition carries the list row\'s own link into Događanja', () => {
    const selection = { kind: 'item' as const, id: publicItemKey('kultura-zg', 'kzg-77'), module: 'kultura-zg' as const };
    const exhibit: NearbyRow = {
      id: 'open:exhibit:kzg-77:2026-09-11', kind: 'opening', atMs: at('2026-09-11T19:00:00'), untilMs: at('2026-09-11T19:00:00'), always: false,
      title: 'Ivan Meštrović: crteži', sub: 'Galerija Klovićevi dvori', live: false, source: 'kultura-zg', selection,
      map: point(15.973, 45.815), detail: { kind: 'exhibit', venue: 'Galerija Klovićevi dvori', openNow: true },
    };
    const el = detail(exhibit)!;
    expect(el.dataset.kind).toBe('opening');
    expect(text(el.querySelector('.city-kicker'))).toBe('do 19:00 · Galerija Klovićevi dvori');
    expect(text(el.querySelector('h3'))).toBe('Ivan Meštrović: crteži');
    const link = el.querySelector<HTMLAnchorElement>('a[data-action=nav]')!;
    expect(text(link)).toBe('Otvori u Događanjima');
    expect(link.dataset.layer).toBe('kultura');
    expect(JSON.parse(link.dataset.selection!)).toEqual(selection);
    expect(link.getAttribute('href')).toMatch(/^#layer=kultura&kind=item&id=[^&]+&module=kultura-zg$/);
    // The list row of the same row opens the same page with the same selection.
    const host = document.createElement('ol');
    host.innerHTML = nearbyRowMarkup(createDefaultI18n('hr'), exhibit, NOW);
    const rowLink = host.querySelector<HTMLAnchorElement>('a.nearby-link')!;
    for (const name of ['href', 'data-action', 'data-layer', 'data-selection']) expect(link.getAttribute(name)).toBe(rowLink.getAttribute(name));
    expect(nearbyTitleKind(exhibit)).toBe('title');
    const en = detail(exhibit, 'en')!;
    expect(text(en.querySelector('button[data-action=clear-selection]'))).toBe('Back to places');
    expect(text(en.querySelector('a[data-action=nav]'))).toBe('Open in Events');
  });

  it('prints nothing for a row whose text the check refuses, as the list leaves it out', () => {
    const hostile = ['Nazovi 091 123 4567 odmah.', 'http://primjer.test/x', 'Pošalji lozinku.'].find((value) => !externalText('name', value, { surface: 'row' }).ok);
    expect(hostile, 'one sample is refused as a name on the row surface').toBeDefined();
    expect(nearbyRowDetail(createDefaultI18n('hr'), { ...OPEN, title: hostile! }, NOW)).toBeNull();
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

describe('the trains on Sada (U3.md S3; owner 5 Oct 2026: behind the departures block\'s toggle, not a row)', () => {
  const station: Place = { id: 'rail-hz-gk', category: 'rail', name: 'Zagreb Glavni kolodvor', lon: 15.9784, lat: 45.8046, sourceId: 'hz-schedule', sourceRecord: 'HZ-GK' };
  const hz: DepartureBoard = {
    operator: 'hz', stopId: 'HZ-GK', stopName: 'Zagreb Glavni kolodvor', status: 'live', generatedAt: iso(NOW - 60_000),
    departures: [
      { operator: 'hz', tripId: '2201', routeId: 'R1', routeName: 'R1', headsign: 'Savski Marof', at: iso(NOW + 20 * 60_000) },
      { operator: 'hz', tripId: '2203', routeId: 'R2', routeName: 'Regionalni vlak', headsign: 'Dugo Selo', at: iso(NOW + 28 * 60_000) },
      { operator: 'hz', tripId: '2205', routeId: 'R1', routeName: 'R1', headsign: 'Harmica', at: iso(NOW + 41 * 60_000) },
      { operator: 'hz', tripId: '2207', routeId: 'R1', routeName: 'R1', headsign: 'Savski Marof', at: iso(NOW + 55 * 60_000) },
    ],
  };
  const city = { ...emptyCity(), places: [station] };
  const view = (filters: Record<string, string>): LayerContext['view'] => ({ layer: 'grad-sada', selection: null, filters });
  it('lists no train row: the list asks for the station\'s board, the block carries the train toggle, and the three trams stay', () => {
    const cache = boards([board(TRG, [3, 9, 16, 24]), board(TRG_2, [6]), hz]);
    const section = renderGradSada(ctx({ boards: cache, city }));
    expect(section.querySelectorAll('[data-testid=nearby] li.nearby-row[data-kind=rail]')).toHaveLength(0);
    expect(cache.ensure).toHaveBeenCalledWith('hz', ['HZ-GK'], undefined);
    const toggle = section.querySelector<HTMLButtonElement>('[data-testid=departures-trains]')!;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.dataset.action).toBe('filter');
    expect(toggle.dataset.filterKey).toBe('departures');
    expect(toggle.dataset.filterValue).toBe('hz');
    expect(toggle.getAttribute('aria-label')).toBe('Prikaži vlakove, Glavni kolodvor');
    // Small and subtle (owner, 5 Oct 2026): the glyph alone, its word as the title; no head row without a heading,
    // the list keeps a 44 px rail for it instead.
    expect(text(toggle)).toBe('');
    expect(toggle.getAttribute('title')).toBe('Vlakovi');
    expect(toggle.classList.contains('btn-quiet') && toggle.classList.contains('icon-btn')).toBe(true);
    expect(toggle.querySelector('svg use')?.getAttribute('href')).toBe('#icon-train-front');
    expect(section.querySelector('.sada-departures-head')).toBeNull();
    expect(toggle.parentElement?.classList.contains('sada-departures')).toBe(true);
    expect(section.querySelector<HTMLElement>('[data-testid=day-departures]')?.dataset.rail).toBe('1');
    expect(toggle.hasAttribute('data-hint'), 'ZET is live: no dot').toBe(false);
    expect(section.querySelectorAll('[data-testid=day-departures] > li.sada-departure')).toHaveLength(3);
    expect(section.querySelector('[data-testid=day-departures]')?.hasAttribute('data-mode')).toBe(false);
    // No trains shown: no HŽ credit yet.
    expect(section.querySelector('.provenance li[data-key="hz-schedule"]')).toBeNull();
  });
  it('with the toggle on, the block shows the station\'s next three trains as timetable rows that open the station on Karta, and credits HŽ', () => {
    const cache = boards([board(TRG, [3, 9, 16, 24]), board(TRG_2, [6]), hz]);
    const section = renderGradSada(ctx({ boards: cache, city, view: view({ departures: 'hz' }) }));
    const list = section.querySelector<HTMLElement>('[data-testid=day-departures]')!;
    expect(list.dataset.mode).toBe('hz');
    expect(text(section.querySelector('.sada-departures-title'))).toBe('Vlakovi · Glavni kolodvor');
    expect(section.querySelector('section.sada-departures')?.getAttribute('aria-label')).toBe('Vlakovi · Glavni kolodvor');
    // With a heading the toggle ends the heading's row and the list needs no rail.
    expect(section.querySelector('.sada-departures-head [data-testid=departures-trains]')).not.toBeNull();
    expect(list.hasAttribute('data-rail')).toBe(false);
    const rows = [...list.querySelectorAll<HTMLElement>('li.sada-departure')];
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.dataset.live === 'false' && row.dataset.kind === 'timetable')).toBe(true);
    expect(rows.map((row) => text(row.querySelector('.sada-dest')))).toEqual(['Savski Marof', 'Dugo Selo', 'Harmica']);
    // The badge is the HŽ short name; a long one reads as "Vlak".
    expect(rows.map((row) => text(row.querySelector('.line')))).toEqual(['R1', 'Vlak', 'R1']);
    const link = rows[0]!.querySelector<HTMLAnchorElement>('a.sada-departure-link')!;
    expect(link.dataset.action).toBe('nav');
    expect(link.dataset.layer).toBe('u-pokretu');
    expect(JSON.parse(link.dataset.selection!)).toEqual({ kind: 'place', id: 'rail-hz-gk' });
    expect(link.getAttribute('href')).toContain('#layer=u-pokretu');
    const toggle = section.querySelector<HTMLButtonElement>('[data-testid=departures-trains]')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.dataset.filterValue).toBe('zet');
    expect(toggle.getAttribute('aria-label')).toBe('Prikaži tramvaje i autobuse');
    const source = REFERENCE_SOURCES.find((entry) => entry.id === 'hz-schedule')!;
    const credit = section.querySelector('.provenance li[data-key="hz-schedule"]');
    expect(credit).not.toBeNull();
    expect(text(credit)).toContain(source.name);
    expect(text(credit)).toContain(source.licence);
    expect(credit!.querySelector('a')?.getAttribute('href')).toBe(source.catalogue);
  });
  it('without a station in the circle there is no toggle, and a toggle left on shows the trams again', () => {
    const none = renderGradSada(ctx({ view: view({ departures: 'hz' }) }));
    expect(none.querySelector('[data-testid=departures-trains]')).toBeNull();
    expect(none.querySelector('[data-testid=day-departures]')?.hasAttribute('data-mode')).toBe(false);
    expect(none.querySelectorAll('[data-testid=day-departures] > li.sada-departure')).toHaveLength(3);
    expect(none.querySelector('.provenance li[data-key="hz-schedule"]')).toBeNull();
  });
  it('while the station\'s board is on its way the trains hold one busy row; with no train left the row says so', () => {
    const waiting = renderGradSada(ctx({ city, view: view({ departures: 'hz' }) }));
    const list = waiting.querySelector<HTMLElement>('[data-testid=day-departures]')!;
    expect(list.getAttribute('aria-busy')).toBe('true');
    expect(list.querySelectorAll('li.sada-departure-empty')).toHaveLength(1);
    const spent: DepartureBoard = { ...hz, departures: [] };
    const done = renderGradSada(ctx({ boards: boards([board(TRG, [3, 9]), spent]), city, view: view({ departures: 'hz' }) }));
    expect(text(done.querySelector('[data-testid=day-departures] li.sada-departure-empty'))).toBe('Danas više nema vlakova.');
  });
  it('marks the toggle with a dot while ZET sends no positions (the wall\'s rail policy), without switching by itself', () => {
    resetServiceStateMemory();
    const base = SNAPSHOTS['zet-rt']!;
    const zet: ModuleSnapshot = { ...base, sourceUpdatedAt: iso(NOW - 10_000), sources: { zet: { status: 'live', itemCount: 2, sourceUpdatedAt: iso(NOW - 10_000),
      service: { state: 'silent', since: iso(NOW - 3_600_000), expected: 460, seen: 2, ratio: 0, confidence: 1, baseline: 'declared', byMode: { tram: [0, 150], bus: [2, 310] } } as ZetService } } };
    const section = renderGradSada(ctx({ boards: boards([board(TRG, [3, 9]), hz]), city, snapshots: { ...SNAPSHOTS, 'zet-rt': zet } }));
    const toggle = section.querySelector<HTMLButtonElement>('[data-testid=departures-trains]')!;
    expect(toggle.dataset.hint).toBe('1');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(section.querySelector('[data-testid=day-departures]')?.hasAttribute('data-mode')).toBe(false);
  });
});
