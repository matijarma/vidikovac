// The front page's two budgeted models (kiosk/front.ts): the events card's
// order of fill and the exceptions card's order of exceptions. Pure: readers
// in, rows out. What the measured room actually is belongs to
// kiosk/invitation.ts and to the e2e; here it is a number.
import { describe, expect, it } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import type { ActiveVenue, LocatedEvent } from '../../shared/city/events';
import type { Place } from '../../shared/city/types';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { eventCardRows, exceptionRows, prometPanel, tonightPanel, type FrontInput } from '../../app/src/kiosk/front';
import { kioskStrings } from '../../app/src/kiosk/strings';

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb, a Friday
const i18n = createDefaultI18n('hr');
const s = kioskStrings('hr');
const attr = { text: 'Izvor: test', url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' };

type Item = ModuleSnapshot['items'][number];
function snap(module: ModuleId, items: Item[], status: ModuleSnapshot['status'] = 'live'): ModuleSnapshot {
  return { module, tier: 'open', status, fetchedAt: new Date(NOW - 30_000).toISOString(), sourceUpdatedAt: new Date(NOW - 40_000).toISOString(), attribution: attr, items };
}
function item(module: ModuleId, id: string, kind: Item['kind'], title: string, extra: Partial<Item> = {}): Item {
  return { id, module, kind, tier: 'open', title, ...extra };
}
/** A route summary row as zet-rt publishes it: the median the twin measured. */
function route(id: string, medianDelaySeconds: number): Item {
  return item('zet-rt', `route:${id}`, 'vehicle', id, { data: { routeId: id, routeShortName: id, medianDelaySeconds, vehicles: 4 } });
}
function input(modules: ModuleSnapshot[], extra: Partial<FrontInput> = {}): FrontInput {
  return { modules, stop: null, now: NOW, lastRun: null, strings: s, i18n, locale: 'hr', lightweight: false, composition: 'wide', ...extra };
}

// --- the events card ----------------------------------------------------------

/** A culture event at a named venue, as the open sources publish it. */
function event(id: string, at: string, title: string, venueName = 'Etnografski muzej'): Item {
  return item('dogadanja', id, 'event', title, { at, dateBasis: 'event', data: { source: 'etnografski', precision: 'time', venue: venueName } });
}
const PLACE: Place = { id: 'emz', category: 'culture', name: 'Etnografski muzej', lon: 15.972, lat: 45.807, sourceId: 'culture', sourceRecord: 'emz' };
function activeVenue(place: Place, items: Item[]): ActiveVenue {
  const events = items.map((it): LocatedEvent => ({ key: it.id, item: it, venueIds: [place.id], location: 'verified', ongoing: false, sources: [it] }));
  return { place, events, count: events.length, ongoing: 0 };
}

describe('eventCardRows: the events card fills the room it measured', () => {
  const tonight = event('e1', '2026-09-11T17:00:00Z', 'Sa zida na zid');
  const rest = [
    event('e2', '2026-09-11T19:00:00Z', 'Tragovi pripadanja', 'Kino Europa'),
    event('e3', '2026-09-12T18:00:00Z', 'Memorijalna intervencija', 'Kino Europa'),
    event('e4', '2026-09-15T20:00:00Z', 'Intersonus', 'Kino Europa'),
  ];
  const dated = tonightPanel(input([snap('dogadanja', [tonight, ...rest])])).rows;

  it('one venue and three dated events fill a five-row budget as 1 + 3, and invent no fifth row', () => {
    const rows = eventCardRows([activeVenue(PLACE, [tonight])], dated, 5);
    expect(rows.map((row) => row.key)).toEqual(['emz', 'event:e2', 'event:e3', 'event:e4']);
    // The venue row leads with its own count and names what is on there.
    expect(rows[0]).toMatchObject({ lead: '1', title: 'Etnografski muzej', sub: 'Sa zida na zid' });
    // Each filled row carries its time, its title and its venue, nearest in time first.
    expect(rows[1]).toMatchObject({ lead: '21:00', title: 'Tragovi pripadanja' });
    expect(rows[1]!.sub).toContain('Kino Europa');
    expect(rows[2]!.day).toBe('sutra');
  });

  it('never says the same event twice: one a venue row stands for is not filled in again', () => {
    const rows = eventCardRows([activeVenue(PLACE, [tonight, rest[0]!])], dated, 5);
    expect(rows.map((row) => row.key)).toEqual(['emz', 'event:e3', 'event:e4']);
  });

  it('honours the budget exactly: the venues first, then the fill, and nothing half-shown', () => {
    expect(eventCardRows([activeVenue(PLACE, [tonight])], dated, 2).map((row) => row.key)).toEqual(['emz', 'event:e2']);
    expect(eventCardRows([activeVenue(PLACE, [tonight])], dated, 1).map((row) => row.key)).toEqual(['emz']);
    expect(eventCardRows([], dated, 2).map((row) => row.key)).toEqual(['event:e1', 'event:e2']);
  });
});

// --- the exceptions card ------------------------------------------------------

describe('prometPanel exceptions: what a rider would notice, and nothing else', () => {
  it('drops an outlier median: half an hour is where news stops and noise starts', () => {
    const { rows, more } = exceptionRows(input([snap('zet-rt', [route('281', -4_440), route('6', 240)])]));
    expect(rows.map((row) => row.title)).toEqual(['kasni 4 min']);
    expect(more).toBe(0);
  });

  it('counts a line as an exception only from three minutes: two is the timetable breathing', () => {
    const modules = [snap('zet-rt', [route('6', 120), route('11', -120), route('12', 180), route('13', -180)])];
    const { rows, more } = exceptionRows(input(modules));
    expect(rows.map((row) => row.key)).toEqual(['line:12', 'line:13']);
    expect(rows.map((row) => row.title)).toEqual(['kasni 3 min', 'rani 3 min']);
    // The ones under the threshold are not counted for the meta either.
    expect(more).toBe(0);
    expect(prometPanel(input(modules, { prometMode: 'exceptions', composition: 'compact' })).meta).toBe('');
    expect(prometPanel(input([snap('zet-rt', [route('6', 120)])], { prometMode: 'exceptions' })).note).toBe('Linije voze po redu');
  });

  it("becomes a stop's board when a caller supplies its arrivals, and says under it where the figures come from", () => {
    const modules = [snap('zet-rt', [route('6', 240)])];
    const supplied = [{ key: 'arrival:t1', leadMarkup: '<span>6</span>', title: 'Črnomerec' }];
    const panel = prometPanel(input(modules, { prometMode: 'exceptions', prometRows: supplied }));
    // The rows are the caller's, not the city's exceptions, and the kicker and
    // credit the card always had are untouched.
    expect(panel.rows).toEqual(supplied);
    // The attribution goes under the rows at the card's credit size, not as a
    // note at row size: a note wrapped to five lines of the aside's column.
    expect(panel.note).toBeUndefined();
    expect(panel.footMarkup).toBe('<p class="k-panel-attrib">Procjena iz ZET-ovih podataka o vozilima; ostalo po voznom redu.</p>');
    expect(panel.kicker).toBe(s.say.transit);
    expect(panel.credit).toContain('ZET');
    // With no rows supplied the card is the city's exceptions, exactly as before.
    expect(prometPanel(input(modules, { prometMode: 'exceptions' })).rows.map((row) => row.title)).toEqual(['kasni 4 min']);
  });

  it('lets the board answer for itself: a dead vehicle feed never speaks under a live board', () => {
    const supplied = [{ key: 'a', leadMarkup: '<span>6</span>', title: 'Črnomerec', trail: '01:07' }];
    // The realtime module is down. Four good scheduled departures must not be
    // captioned "ZET trenutačno ne odgovara" -- they came off the timetable.
    const dead = [snap('zet-rt', [], 'down')];
    const live = prometPanel(input(dead, { prometMode: 'exceptions', prometRows: supplied, prometBoard: { status: 'live', total: 1, platforms: 1 } }));
    expect(live.note).toBeUndefined();
    // Without a board the same dead feed still says so: that is its own card.
    expect(prometPanel(input(dead, { prometMode: 'exceptions' })).note).toBe('ZET trenutačno ne odgovara.');
    // The board's own states, each said as itself.
    const empty = (status: 'down' | 'none' | 'stale' | 'live') =>
      prometPanel(input([snap('zet-rt', [route('6', 240)])], { prometMode: 'exceptions', prometRows: [], prometBoard: { status, total: 0, platforms: 1 } })).note;
    expect(empty('down')).toBe('Vozni red trenutačno nije dostupan.');
    expect(empty('none')).toBe('Učitavanje podataka ZET-a');
    expect(empty('stale')).toBe('Zastarjelo: izvor ne odgovara, stanje nije potvrđeno');
    expect(empty('live')).toBe('Nema najavljenih polazaka.');
  });

  it('captions a board with its own stop and counts the rows it had no room for', () => {
    const supplied = [{ key: 'a', leadMarkup: '<span>6</span>', title: 'Črnomerec', trail: '01:07' }];
    const stop = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.977, lat: 45.813, routes: ['6'] };
    const panel = prometPanel(input([snap('zet-rt', [route('6', 240)])], {
      prometMode: 'exceptions', prometRows: supplied, stop, prometBoard: { status: 'live', total: 6, platforms: 2 },
    }));
    expect(panel.meta).toBe('Trg bana J. Jelačića · 2 perona');
    expect(panel.footMarkup).toContain('<p class="k-line-more k-row-more">prikazano 1 od 6</p>');
    // One platform is not worth saying; the whole board shown is not worth counting.
    const one = prometPanel(input([snap('zet-rt', [route('6', 240)])], {
      prometMode: 'exceptions', prometRows: supplied, stop, prometBoard: { status: 'live', total: 1, platforms: 1 },
    }));
    expect(one.meta).toBe('Trg bana J. Jelačića');
    expect(one.footMarkup).not.toContain('k-row-more');
  });

  it('orders late before early, trams before buses, then the largest first', () => {
    const modules = [snap('zet-rt', [
      route('109', 300), // a bus, late
      route('11', 200),  // a tram, late
      route('6', 900),   // a tram, later
      route('2', -300),  // a tram, early
    ])];
    const { rows } = exceptionRows(input(modules, { composition: 'portrait' }));
    expect(rows.map((row) => row.key)).toEqual(['line:6', 'line:11', 'line:109']);
    expect(rows.map((row) => row.tone)).toEqual(['late', 'late', 'late']);
  });

  it('puts a route the table has no type for after the buses, never before the trams', () => {
    const modules = [snap('zet-rt', [route('X9', 600), route('109', 300), route('6', 200)])];
    const { rows } = exceptionRows(input(modules, { composition: 'portrait' }));
    expect(rows.map((row) => row.key)).toEqual(['line:6', 'line:109', 'line:X9']);
  });

  // A screen standing at a stop, under a header that names it, was printing
  // two late buses that do not call there: it reads as the stop's own board
  // and it is not one. Its own lines come first; the count behind them is
  // still the city's, because a late line elsewhere is still news on a wall.
  it('puts the screen stop’s own lines first, and counts the rest of the city all the same', () => {
    const modules = [snap('zet-rt', [
      route('109', 900), // a bus, the latest in the city, but not this stop's
      route('6', 300),   // a tram this stop is on
      route('11', 200),  // a tram this stop is on, less late
      route('2', 600),   // a tram, later than both, but not this stop's
    ])];
    const stop = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '11'] };
    const own = exceptionRows(input(modules, { stop, composition: 'portrait' }));
    expect(own.rows.map((row) => row.key)).toEqual(['line:6', 'line:11', 'line:2']);
    // Within the stop's own lines and within the rest, the city order is untouched.
    expect(own.more).toBe(1);
    expect(prometPanel(input(modules, { stop, prometMode: 'exceptions', composition: 'portrait' })).meta).toContain('+1 linija kasni');
    // With no stop configured the card is the city's, in the city's own order.
    const city = exceptionRows(input(modules, { composition: 'portrait' }));
    expect(city.rows.map((row) => row.key)).toEqual(['line:2', 'line:6', 'line:11']);
    expect(city.more).toBe(1);
    // A stop whose lines are all running to time does not push anything ahead of the news.
    const calm = { ...stop, routes: ['31', '32'] };
    expect(exceptionRows(input(modules, { stop: calm, composition: 'portrait' })).rows.map((row) => row.key)).toEqual(['line:2', 'line:6', 'line:11']);
  });

  it('caps the card per composition and counts the rest for the meta', () => {
    const modules = [snap('zet-rt', [route('6', 900), route('11', 600), route('12', 400), route('13', 200)])];
    expect(exceptionRows(input(modules)).rows).toHaveLength(3);
    expect(exceptionRows(input(modules)).more).toBe(1);
    expect(exceptionRows(input(modules, { composition: 'compact' })).rows).toHaveLength(2);
    expect(exceptionRows(input(modules, { composition: 'compact' })).more).toBe(2);
    const panel = prometPanel(input(modules, { prometMode: 'exceptions' }));
    expect(panel.meta).toContain('+1 linija kasni');
    expect(panel.note).toBeUndefined();
  });

  it('says the network runs to plan when nothing plausible is left', () => {
    const panel = prometPanel(input([snap('zet-rt', [route('281', -4_440), route('6', 10)])], { prometMode: 'exceptions' }));
    expect(panel.rows).toEqual([]);
    expect(panel.note).toBe('Linije voze po redu');
  });
});
