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
