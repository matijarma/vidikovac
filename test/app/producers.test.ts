// The eight producers of A.6, each over its own small fixture: the exact
// tiles they hand buildTimeband, not the band's own sorting/capping/staleness
// machinery (timeband.test.ts owns that, with hand-made producer stubs).
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import type { ScreenStop } from '../../worker/protocol';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import type { LayerContext } from '../../app/src/layers/types';
import { zagrebTime, zagrebWeekdayShort } from '../../app/src/format';
import {
  assemblyProducer,
  closuresProducer,
  eventsProducer,
  gazetteProducer,
  lastRunProducer,
  safetyProducer,
  safetyVerdict,
  transitProducer,
  worksProducer,
} from '../../app/src/experience/producers';
import type { LastRunSnapshot } from '../../app/src/core/lastrun';
import { bucketOf, columnsFor, type ProduceOptions } from '../../app/src/experience/timeband';
import { itemSelection } from '../../app/src/experience/blocks';
import { safetyState } from '../../app/src/experience/safety-state';

const hr = createDefaultI18n('hr');
const NOW = Date.parse('2026-09-11T12:32:00Z'); // Friday 14:32 in Zagreb

const attr = (text: string) => ({ text, url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' });
const base = (module: ModuleSnapshot['module'], items: ModuleSnapshot['items']): ModuleSnapshot => ({
  module, tier: 'open', status: 'live', fetchedAt: new Date(NOW - 60_000).toISOString(), attribution: attr(`Izvor: ${module}`), items,
});

function ctx(over: Partial<LayerContext> = {}): LayerContext {
  return { i18n: hr, snapshots: {}, now: NOW, ...over };
}

function options(over: Partial<ProduceOptions> = {}, now = NOW): ProduceOptions {
  const columns = columnsFor(hr, now);
  return { columns, surface: 'desktop', bucket: (at, until, allDay) => bucketOf(now, columns, at, until, allDay), ...over };
}

// ---------------------------------------------------------------------------
// transit

describe('transitProducer', () => {
  const STOP: ScreenStop = { id: 'st1', name: 'Trg bana J. Jelačića', lon: 15.977, lat: 45.812, routes: ['6', '101', '99'] };
  const ZET: ModuleSnapshot = base('zet-rt', [
    { id: 'route:6', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', data: { routeId: '6', medianDelaySeconds: 90, vehicles: 2 } },
    { id: 'route:101', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '101', data: { routeId: '101', medianDelaySeconds: -120, vehicles: 5 } },
    { id: 'route:12', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '12', data: { routeId: '12', medianDelaySeconds: 5, vehicles: 1 } },
  ]);
  const savedList = (ids: string[]): LayerContext => ({
    ...ctx({ snapshots: { 'zet-rt': ZET }, screen: { surface: 'phone', locale: 'hr', theme: 'light', themePreference: 'light', lightweight: false, reducedMotion: false, stop: STOP } }),
    ...({ saved: { list: () => ids.map((id) => ({ kind: 'route' as const, id })) } } as unknown as Partial<LayerContext>), // no has(): the producer only lists
  });

  it('boards the stop’s lines with saved lines prepended, each badge, delay word, tone and vehicle-count glyph', () => {
    const tiles = transitProducer.produce(savedList(['12']), options());
    expect(tiles.map((t) => t.selection)).toEqual([{ kind: 'route', id: '12' }, { kind: 'route', id: '6' }, { kind: 'route', id: '101' }, { kind: 'route', id: '99' }]);

    const six = tiles.find((t) => t.key === 'zet-rt:route:6')!;
    expect(six.label).toBe('Linija 6');
    expect(six.labelMarkup).toContain('data-kind="tram"');
    expect(six.value).toBe('kasni 2');
    expect(six.unit).toBe('min');
    expect(six.valueTone).toBe('late');
    expect(six.valueSize).toBe('l');
    expect(six.title).toBe('Črnomerec – Sopot');
    expect(six.contextMarkup).toContain('icon-tram-front');
    expect(six.contextMarkup).toContain('>2 · Trg bana J. Jelačića<');
    expect(six.aria).toBe('Linija 6, Črnomerec – Sopot, kasni 2 min, 2 vozila, Trg bana J. Jelačića');
    expect(six.testid).toBe('tile-transit');
    expect(six.bucket).toBe('sada');
    expect(six.layer).toBe('u-pokretu');
    expect(six.domain).toBe('transit');

    const bus = tiles.find((t) => t.key === 'zet-rt:route:101')!;
    expect(bus.value).toBe('rani 2');
    expect(bus.unit).toBe('min');
    expect(bus.valueTone).toBe('early');
    expect(bus.contextMarkup).toContain('icon-bus-front');
    expect(bus.contextMarkup).toContain('>5 · Trg bana J. Jelačića<');
    expect(bus.labelMarkup).toContain('data-kind="bus"');

    const unmatched = tiles.find((t) => t.key === 'zet-rt:route:99')!;
    expect(unmatched.value).toBe('nema podataka');
    expect(unmatched.unit).toBeUndefined();
    expect(unmatched.valueTone).toBe('none');
    expect(unmatched.valueSize).toBe('m');
    expect(unmatched.title).toBeUndefined();
    expect(unmatched.contextMarkup).toBeUndefined();
    expect(unmatched.aria).toBe('Linija 99, nema podataka');
  });

  it('without a stop, ranks by delay: only a figure the helper declines to assert is left out, most-delayed first; the context counts without a stop name', () => {
    const tiles = transitProducer.produce(ctx({ snapshots: { 'zet-rt': ZET } }), options());
    expect(tiles.map((t) => t.key)).toEqual(['zet-rt:route:101', 'zet-rt:route:6', 'zet-rt:route:12']);
    expect(tiles[1]!.contextMarkup).toContain('>2<');
    expect(tiles[1]!.aria).toBe('Linija 6, Črnomerec – Sopot, kasni 2 min, 2 vozila');
    // On time keeps the whole phrase at l; it has no unit to split.
    expect(tiles[2]).toMatchObject({ value: 'na vrijeme', valueSize: 'l' });
    expect(tiles[2]!.unit).toBeUndefined();
  });

  it('is empty without a stop, saved lines or deviation (the no-stop branch with nothing to show)', () => {
    expect(transitProducer.produce(ctx({ snapshots: { 'zet-rt': base('zet-rt', []) } }), options())).toEqual([]);
  });

  it('words its "+ N" foot, naming the stop only when one exists', () => {
    const withStop = transitProducer.moreLabel!(hr, 4, ctx({ screen: { surface: 'phone', locale: 'hr', theme: 'light', themePreference: 'light', lightweight: false, reducedMotion: false, stop: STOP } }));
    expect(withStop).toEqual({ text: '+ 4 linije', aria: '+ 4 linije, Sa stajališta Trg bana J. Jelačića' });
    const withoutStop = transitProducer.moreLabel!(hr, 2, ctx());
    expect(withoutStop).toEqual({ text: '+ 2 linije', aria: undefined });
  });
});

// ---------------------------------------------------------------------------
// closures / mobility

describe('closuresProducer', () => {
  it('bands a single active closure with its own title and its own end', () => {
    const prometnice = base('prometnice', [
      { id: 'c1', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Grada Vukovara', at: '2026-04-18T07:00:00Z', until: '2026-09-11T20:00:00Z' },
    ]);
    const tiles = closuresProducer.produce(ctx({ snapshots: { prometnice } }), options());
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ key: 'mobility:closures', domain: 'mobility', variant: 'band', tone: 'komunalno', icon: 'hard-hat', label: 'Zatvaranja', title: 'Grada Vukovara', bucket: 'sada', testid: 'tile-closures' });
    expect(tiles[0]!.value).toBe(`do ${zagrebTime('2026-09-11T20:00:00Z')}`);
  });

  it('city-wide with several stamped closures, counts them rather than naming one', () => {
    const prometnice = base('prometnice', [
      { id: 'far', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Ilica 200', at: '2026-09-01T07:00:00Z', geo: { type: 'LineString', coordinates: [[15.93, 45.81], [15.94, 45.81]] }, data: { district: 'donji-grad' } },
      { id: 'near', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Amruševa', at: '2026-09-11T07:00:00Z', until: '2026-09-11T16:00:00Z', geo: { type: 'LineString', coordinates: [[15.979, 45.812], [15.981, 45.812]] }, data: { district: 'donji-grad' } },
      { id: 'other', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Vukovarska', at: '2026-09-01T07:00:00Z', geo: { type: 'LineString', coordinates: [[15.99, 45.80], [15.995, 45.80]] }, data: { district: 'trnje' } },
    ]);
    const stop = { surface: 'phone' as const, locale: 'hr' as const, theme: 'light' as const, themePreference: 'light' as const, lightweight: false, reducedMotion: false, stop: { id: 'st1', name: 'Trg bana J. Jelačića', lon: 15.977, lat: 45.812, routes: ['6'] } };
    const city = closuresProducer.produce(ctx({ snapshots: { prometnice }, screen: stop }), options())[0]!;
    expect(city).toMatchObject({ label: 'Zatvaranja', title: '3 zatvaranja', value: '' });
  });

  it('names the end by weekday when it falls on another day, and says so plainly when there is none', () => {
    const laterDay = base('prometnice', [{ id: 'c1', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Ilica', at: '2026-09-01T07:00:00Z', until: '2026-09-20T20:00:00Z' }]);
    expect(closuresProducer.produce(ctx({ snapshots: { prometnice: laterDay } }), options())[0]!.value).toBe(`do ${zagrebWeekdayShort('2026-09-20T20:00:00Z')}`);
    const noEnd = base('prometnice', [{ id: 'c1', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Ilica', at: '2026-09-01T07:00:00Z' }]);
    expect(closuresProducer.produce(ctx({ snapshots: { prometnice: noEnd } }), options())[0]!.value).toBe('kraj nije najavljen');
  });

  it('counts several active closures instead of naming one, with no single end to show', () => {
    const many = base('prometnice', [
      { id: 'c1', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Ilica', at: '2026-09-01T00:00:00Z', until: '2026-09-20T00:00:00Z' },
      { id: 'c2', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Vlaška', at: '2026-09-01T00:00:00Z', until: '2026-09-20T00:00:00Z' },
    ]);
    const tile = closuresProducer.produce(ctx({ snapshots: { prometnice: many } }), options())[0]!;
    expect(tile.title).toBe('2 zatvaranja');
    expect(tile.value).toBe('');
  });

  it('lists a closure that has not started yet as a time tile, worded from the register’s own vocabulary', () => {
    const planned = base('prometnice', [
      { id: 'c9', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Savska cesta', at: '2026-09-15T06:00:00Z', until: '2026-09-15T18:00:00Z', data: { subtype: 'ROAD_CLOSED_EVENT', direction: 'BOTH_DIRECTIONS' } },
    ]);
    const tiles = closuresProducer.produce(ctx({ snapshots: { prometnice: planned } }), options());
    expect(tiles).toEqual([{
      key: 'prometnice:c9', domain: 'mobility', variant: 'time', label: 'događanje', title: 'Savska cesta',
      at: '2026-09-15T06:00:00Z', until: '2026-09-15T18:00:00Z', context: 'oba smjera', layer: 'u-pokretu', testid: 'tile-closure',
    }]);
  });

  it('is empty with no closures at all, and words its "+ N" foot', () => {
    expect(closuresProducer.produce(ctx({ snapshots: { prometnice: base('prometnice', []) } }), options())).toEqual([]);
    expect(closuresProducer.moreLabel!(hr, 3, ctx())).toEqual({ text: '+ 3 zatvaranja' });
  });

  it('falls back to the generic word and drops the context when a planned closure has no subtype/direction at all', () => {
    const planned = base('prometnice', [
      { id: 'c10', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Heinzelova', at: '2026-09-15T06:00:00Z', until: '2026-09-15T18:00:00Z' },
    ]);
    const tiles = closuresProducer.produce(ctx({ snapshots: { prometnice: planned } }), options());
    expect(tiles).toEqual([{
      key: 'prometnice:c10', domain: 'mobility', variant: 'time', label: 'zatvoreno', title: 'Heinzelova',
      at: '2026-09-15T06:00:00Z', until: '2026-09-15T18:00:00Z', context: '', layer: 'u-pokretu', testid: 'tile-closure',
    }]);
  });

  it('falls back the same way when the City publishes a subtype/direction code outside today’s vocabulary', () => {
    const planned = base('prometnice', [
      {
        id: 'c11', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Slavonska avenija',
        at: '2026-09-15T06:00:00Z', until: '2026-09-15T18:00:00Z',
        data: { subtype: 'ROAD_CLOSED_FUTURE_CODE', direction: 'DIAGONAL' },
      },
    ]);
    const tile = closuresProducer.produce(ctx({ snapshots: { prometnice: planned } }), options())[0]!;
    expect(tile.label).toBe('zatvoreno');
    expect(tile.context).toBe('');
  });
});

// ---------------------------------------------------------------------------
// works / komunalno

describe('worksProducer', () => {
  const work = (id: string, phase: string, district?: string): ModuleSnapshot['items'][number] => ({
    id, module: 'dogadanja', kind: 'event', tier: 'session', title: `Radovi ${id}`, at: '2026-06-01T00:00:00Z',
    data: { source: 'komunalne', phase, status: 'U tijeku', amount: 100, precision: 'day', ...(district ? { district } : {}) },
  });

  it('counts the city’s works in progress, always city-wide', () => {
    const dogadanja = base('dogadanja', [work('w1', 'Radovi u tijeku'), work('w2', 'Radovi u tijeku'), work('w3', 'U pripremi')]);
    const tile = worksProducer.produce(ctx({ snapshots: { dogadanja } }), options())[0]!;
    expect(tile.value).toBe('2');
    expect(tile.title).toBe('Radovi u gradu');
    expect(tile.aria).toBe('Radovi, 2 rada u tijeku, Radovi u gradu');
    expect(tile.testid).toBe('tile-works');
    expect(tile.bucket).toBe('sada');
  });

  it('counts every district’s works together, never scoped to one', () => {
    const dogadanja = base('dogadanja', [work('w1', 'Radovi u tijeku', 'trnje'), work('w2', 'Radovi u tijeku', 'maksimir'), work('w3', 'Radovi u tijeku', 'trnje')]);
    const tile = worksProducer.produce(ctx({ snapshots: { dogadanja } }), options())[0]!;
    expect(tile.value).toBe('3');
    expect(tile.title).toBe('Radovi u gradu');
  });

  it('shows no tile with nothing "u tijeku"', () => {
    const dogadanja = base('dogadanja', [work('w1', 'Završeni radovi')]);
    expect(worksProducer.produce(ctx({ snapshots: { dogadanja } }), options())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// safety

describe('safetyProducer', () => {
  it('reads calm, confirmed, once every source has answered clean', () => {
    const tile = safetyProducer.produce(ctx({ snapshots: { 'dhmz-cap': base('dhmz-cap', []), emsc: base('emsc', []), prometnice: base('prometnice', []) } }), options())[0]!;
    expect(tile).toMatchObject({ key: 'safety', domain: 'safety', variant: 'band', tone: 'calm', icon: 'check-circle', testid: 'tile-safety', bucket: 'sada', data: { level: 'calm' } });
    expect(tile.title).toBe('Nema hitnih upozorenja');
    expect(tile.value).toMatch(/^potvrđeno \d{2}:\d{2}$/);
  });

  it('reads unknown, never all-clear, while a source is missing or down', () => {
    const loading = safetyProducer.produce(ctx({ snapshots: {} }), options())[0]!;
    expect(loading.tone).toBe('unknown');
    expect(loading.title).toBe('Stanje nije potvrđeno');
    expect(loading.value).toBe('');
    const down = safetyProducer.produce(ctx({ snapshots: { 'dhmz-cap': { ...base('dhmz-cap', []), status: 'down' }, emsc: base('emsc', []), prometnice: base('prometnice', []) } }), options())[0]!;
    expect(down.tone).toBe('unknown');
  });

  it('names a level only when that level is the reason: a felt quake with minor warnings reads the urgent word, not a warning it did not cause', () => {
    const minorWarnings = base('dhmz-cap', [
      { id: 'w2', module: 'dhmz-cap', kind: 'warning', tier: 'open', title: 'Vjetar u gorju', severity: 'minor', at: '2026-09-11T06:00:00Z', until: '2026-09-11T20:00:00Z' },
      { id: 'w3', module: 'dhmz-cap', kind: 'warning', tier: 'open', title: 'Promjena vremena', severity: 'info', at: '2026-09-11T06:00:00Z', until: '2026-09-11T20:00:00Z' },
    ]);
    const felt = base('emsc', [{ id: 'q2', module: 'emsc', kind: 'quake', tier: 'open', title: 'ZAGREB', at: '2026-09-11T09:00:00Z', data: { mag: 3.5, depth: 8 } }]);
    const tile = safetyProducer.produce(ctx({ snapshots: { 'dhmz-cap': minorWarnings, emsc: felt, prometnice: base('prometnice', []) } }), options())[0]!;
    expect(tile.tone).toBe('urgent');
    expect(tile.title).toBe('Hitno sada');

    const withModerate = base('dhmz-cap', [...minorWarnings.items, { id: 'w1', module: 'dhmz-cap' as const, kind: 'warning' as const, tier: 'open' as const, title: 'Grmljavinsko nevrijeme', severity: 'moderate' as const, at: '2026-09-11T06:00:00Z', until: '2026-09-11T20:00:00Z' }]);
    const named = safetyProducer.produce(ctx({ snapshots: { 'dhmz-cap': withModerate, emsc: felt, prometnice: base('prometnice', []) } }), options())[0]!;
    expect(named.title).toBe('žuto upozorenje: Grmljavinsko nevrijeme');
  });

  it('safetyVerdict is the same word the tile’s title carries', () => {
    const state = safetyState({ 'dhmz-cap': base('dhmz-cap', []), emsc: base('emsc', []), prometnice: base('prometnice', []) }, NOW);
    expect(safetyVerdict(hr, state)).toBe('Nema hitnih upozorenja');
  });
});

// ---------------------------------------------------------------------------
// events

describe('eventsProducer', () => {
  const DOGADANJA = base('dogadanja', [
    { id: 'kulturpunkt:1', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Koncert u parku', at: '2026-09-12T18:00:00Z', data: { source: 'kulturpunkt', category: 'koncert', precision: 'time' } },
    { id: 'etnografski:2', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Izložba tradicijskog nakita', at: '2026-09-10T09:00:00Z', until: '2026-10-01T18:00:00Z', data: { source: 'etnografski', category: 'izlozba', venue: 'Studentski centar', precision: 'time' } },
    { id: 'kvartovske:3', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Novo igralište', at: '2026-09-11T00:00:00Z', data: { source: 'kvartovske', precision: 'day' } },
    { id: 'kulturpunkt:4', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Koncert na rivi', at: '2026-09-12T19:00:00Z', data: { source: 'kulturpunkt', category: 'koncert', precision: 'time', venue: 'Dioklecijanova palača, Split' } },
    { id: 'kulturpunkt:5', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Predstava sada', at: '2026-09-11T12:00:00Z', until: '2026-09-11T15:00:00Z', data: { source: 'kulturpunkt', category: 'izvedba', precision: 'time' } },
    { id: 'kulturpunkt:6', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Za mjesec dana', at: '2026-10-20T18:00:00Z', data: { source: 'kulturpunkt', category: 'koncert', precision: 'time' } },
  ]);

  it('lists the next starts in Zagreb, category-labelled, venue then source, running and beyond-band items dropped', () => {
    const tiles = eventsProducer.produce(ctx({ snapshots: { dogadanja: DOGADANJA } }), options());
    expect(tiles.map((t) => t.key)).toEqual(['dogadanja:kvartovske:3', 'dogadanja:kulturpunkt:1']);
    const concert = tiles.find((t) => t.key === 'dogadanja:kulturpunkt:1')!;
    expect(concert.label).toBe('Koncerti');
    expect(concert.context).toBe('Kulturpunkt');
    expect(concert.allDay).toBe(false);
    const playground = tiles.find((t) => t.key === 'dogadanja:kvartovske:3')!;
    expect(playground.allDay).toBe(true);
    expect(playground.context).toBe('Kvartovske novosti');
    // The Split venue and the still-running exhibition never became agenda items; the far-future one is beyond the band.
    expect(tiles.some((t) => t.title === 'Koncert na rivi')).toBe(false);
    expect(tiles.some((t) => t.title === 'Izložba tradicijskog nakita')).toBe(false);
    expect(tiles.some((t) => t.title === 'Za mjesec dana')).toBe(false);
    expect(tiles.some((t) => t.title === 'Predstava sada')).toBe(false);
  });

  it('names the venue first and the source after it; the source alone when there is no venue', () => {
    const withVenue = base('dogadanja', [
      { id: 'kulturpunkt:venue', module: 'dogadanja', kind: 'event', tier: 'session', title: 'U dvorani', at: '2026-09-12T18:00:00Z', data: { source: 'kulturpunkt', category: 'koncert', venue: 'Lisinski', precision: 'time' } },
    ]);
    const tiles = eventsProducer.produce(ctx({ snapshots: { dogadanja: withVenue } }), options());
    // Venue first, then the source, so the useful word survives an ellipsis (kajimafix, cross-cutting).
    expect(tiles[0]!.context).toBe('Lisinski · Kulturpunkt');
    // The fixture's own kulturpunkt item carries no venue: falls back to the source name.
    const noVenue = eventsProducer.produce(ctx({ snapshots: { dogadanja: DOGADANJA } }), options()).find((t) => t.key === 'dogadanja:kulturpunkt:1')!;
    expect(noVenue.context).toBe('Kulturpunkt');
  });

  it('drops an item whose bucket is sada even when upcomingEvents kept it', () => {
    const runningNow = base('dogadanja', [
      { id: 'kulturpunkt:now', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Baš sada', at: new Date(NOW).toISOString(), until: '2026-09-11T16:00:00Z', data: { source: 'kulturpunkt', category: 'koncert', precision: 'time' } },
    ]);
    expect(eventsProducer.produce(ctx({ snapshots: { dogadanja: runningNow } }), options())).toEqual([]);
  });

  it('adds nearest-stop line badges only when the shell hands over a stop catalogue (dormant in wave 2)', () => {
    const pinned = base('dogadanja', [
      { id: 'kulturpunkt:pin', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Na trgu', at: '2026-09-12T18:00:00Z', geo: { type: 'Point', coordinates: [15.977, 45.812] }, data: { source: 'kulturpunkt', category: 'koncert', precision: 'time' } },
    ]);
    const withoutStops = eventsProducer.produce(ctx({ snapshots: { dogadanja: pinned } }), options())[0]!;
    expect(withoutStops.contextMarkup).toBeUndefined();
    const stops: ScreenStop[] = [{ id: 'st1', name: 'Blizu', lon: 15.9772, lat: 45.8121, routes: ['6'] }, { id: 'st2', name: 'Daleko', lon: 16.2, lat: 46.0, routes: ['101'] }];
    const withStops = eventsProducer.produce({ ...ctx({ snapshots: { dogadanja: pinned } }), ...({ stops } as Partial<LayerContext>) }, options())[0]!;
    expect(withStops.contextMarkup).toContain('data-size="xs"');
    expect(withStops.contextMarkup).toContain('>6<');
  });

  it('words its "+ N" foot', () => {
    expect(eventsProducer.moreLabel!(hr, 5, ctx())).toEqual({ text: '+ 5 događanja' });
  });
});

// ---------------------------------------------------------------------------
// assembly / civic

describe('assemblyProducer', () => {
  it('carries the next Assembly session while it stands within the band', () => {
    const dogadanja = base('dogadanja', [
      { id: 'skupstina:past', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Prošla sjednica', at: '2026-09-01T09:00:00Z', data: { source: 'skupstina', precision: 'time' } },
      { id: 'skupstina:4', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Poziv na 13. sjednicu', at: '2026-09-14T09:00:00Z', data: { source: 'skupstina', venue: 'Stara gradska vijećnica', precision: 'time' } },
      { id: 'skupstina:later', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Sljedeća poslije', at: '2026-09-20T09:00:00Z', data: { source: 'skupstina', precision: 'time' } },
    ]);
    const tiles = assemblyProducer.produce(ctx({ snapshots: { dogadanja } }), options());
    expect(tiles).toEqual([{
      key: 'dogadanja:skupstina:4', domain: 'civic', variant: 'ink', label: 'Gradska skupština', title: 'Poziv na 13. sjednicu',
      at: '2026-09-14T09:00:00Z', allDay: false, context: 'Stara gradska vijećnica',
      selection: itemSelection(dogadanja.items[1]!), layer: 'uprava-i-pravo', testid: 'tile-assembly',
    }]);
  });

  it('shows nothing when the next session lies beyond the band’s horizon', () => {
    const dogadanja = base('dogadanja', [{ id: 'skupstina:far', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Daleko', at: '2026-10-01T09:00:00Z', data: { source: 'skupstina', precision: 'time' } }]);
    expect(assemblyProducer.produce(ctx({ snapshots: { dogadanja } }), options())).toEqual([]);
  });

  it('shows nothing with no announced session at all', () => {
    expect(assemblyProducer.produce(ctx({ snapshots: { dogadanja: base('dogadanja', []) } }), options())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// gazette / civic

describe('gazetteProducer', () => {
  it('reads the issue number, when it was published and how many acts it carries', () => {
    const glasnik = base('glasnik', [
      { id: 'a1', module: 'glasnik', kind: 'act', tier: 'open', title: 'Odluka', at: '2026-09-10T00:00:00Z', data: { broj: '21', godina: '2026' } },
      { id: 'a2', module: 'glasnik', kind: 'act', tier: 'open', title: 'Odluka 2', data: {} },
    ]);
    const tile = gazetteProducer.produce(ctx({ snapshots: { glasnik } }), options())[0]!;
    expect(tile).toMatchObject({ key: 'glasnik:issue', domain: 'civic', variant: 'value', label: 'Glasnik', value: '21/2026', valueSize: 'xl', bucket: 'sada', testid: 'tile-gazette' });
    // The day and month and the count alone (kajimafix 01.6): the verb and the weekday ellipsised a three-digit count; the aria keeps the sentence.
    expect(tile.context).toBe('10. 9. · 2 akta');
    expect(tile.aria).toBe('Glasnik, 21/2026, objavljen 10. 9., 2 akta');
  });

  it('shows nothing without any acts', () => {
    expect(gazetteProducer.produce(ctx({ snapshots: { glasnik: base('glasnik', []) } }), options())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// last run (behind FEED_LASTRUN, T3.1): GTFS static, never zet-rt, never an arrival

describe('lastRunProducer', () => {
  // The fixture stop's own lines on Fri 11. 9. (service date) as ZET's GTFS writes them:
  // 13 and 14 roll past midnight, 12 and 17 do not, 11 ends earliest; 31 is a night tram
  // whose Friday service ends Saturday 05:38, after the band's 04:00 cut.
  const snapshot: LastRunSnapshot = {
    status: 'live', fetchedAt: '2026-09-11T12:00:00Z', sourceUpdatedAt: '2026-09-10T03:00:00Z', validUntil: '2026-10-02T04:00:00Z',
    routes: {
      '6': { '2026-09-11': '24:27', '2026-09-12': '23:48' },
      '11': { '2026-09-11': '24:09', '2026-09-12': '24:03' },
      '12': { '2026-09-11': '23:45', '2026-09-12': '23:43' },
      '13': { '2026-09-11': '24:30', '2026-09-12': '24:21' },
      '14': { '2026-09-11': '24:31', '2026-09-12': '24:22' },
      '17': { '2026-09-11': '24:01', '2026-09-12': '24:06' },
      '31': { '2026-09-11': '29:38', '2026-09-12': '28:48' },
    },
  };
  const withLastRun = (over: Partial<LayerContext> = {}): LayerContext => ctx({ lastRun: snapshot, ...over });

  it('Fri 14:32: the two lines departing last tonight, in order, as time tiles with the xs badge, the destination and the schedule context', () => {
    const tiles = lastRunProducer.produce(withLastRun(), options());
    expect(tiles.map((t) => t.selection)).toEqual([{ kind: 'route', id: '13' }, { kind: 'route', id: '14' }]);
    const first = tiles[0]!;
    expect(first).toMatchObject({
      key: 'transit:lastrun:13', domain: 'transit', variant: 'time', layer: 'u-pokretu', testid: 'tile-lastrun',
      label: 'Zadnji polazak', title: 'Žitnjak-Kvatern. trg', at: '2026-09-11T22:30:00.000Z', context: 'vozni red',
    });
    expect(first.labelMarkup).toContain('data-size="xs"');
    expect(first.labelMarkup).toContain('data-kind="tram"');
    expect(first.labelMarkup).toContain('>13<');
    expect(zagrebTime(first.at)).toBe('00:30');
    expect(options().bucket(first.at)).toBe('veceras');
    expect(tiles[1]!.at).toBe('2026-09-11T22:31:00.000Z');
  });

  it('never says an arrival: no tile text carries "dolazak", and the context names the timetable', () => {
    for (const tile of lastRunProducer.produce(withLastRun(), options())) {
      const words = [tile.label, tile.title, tile.context, tile.value, tile.aria].join(' ').toLowerCase();
      expect(words).not.toContain('dolazak');
      expect(tile.context).toBe('vozni red');
      expect(tile.value).toBeUndefined();
    }
  });

  it('Sat 00:10: only departures still ahead tonight; a line whose last one has left falls to tomorrow night and is kept off the band', () => {
    const now = Date.parse('2026-09-11T22:10:00Z'); // Sat 12. 9. 00:10 CEST: night mode
    const tiles = lastRunProducer.produce(withLastRun({ now }), options({}, now));
    // 11 (00:09) and 17 (00:01) have left: their next last departure is Sunday night, in sutra, never shown as tonight's.
    // 12 ended 23:45 Friday: Saturday's 23:43 is tomorrow night too. 6 (00:27), 13 (00:30), 14 (00:31) remain; the two latest win.
    expect(tiles.map((t) => t.selection)).toEqual([{ kind: 'route', id: '13' }, { kind: 'route', id: '14' }]);
    expect(tiles.every((t) => options({}, now).bucket(t.at) === 'veceras')).toBe(true);
  });

  it('Sat 05:00: tonight is Saturday night, so the day lines’ Sunday 00:2x departures are the two latest; a night tram whose Friday service ends at 05:38 still counts as this service day’s and lands in the day lane', () => {
    const now = Date.parse('2026-09-12T03:00:00Z'); // Sat 12. 9. 05:00 CEST: day mode
    const tiles = lastRunProducer.produce(withLastRun({ now }), options({}, now));
    expect(tiles.map((t) => t.selection)).toEqual([{ kind: 'route', id: '13' }, { kind: 'route', id: '14' }]);
    expect(tiles.map((t) => t.at)).toEqual(['2026-09-12T22:21:00.000Z', '2026-09-12T22:22:00.000Z']);
    const nightOnly = lastRunProducer.produce(withLastRun({ now, lastRun: { ...snapshot, routes: { '31': snapshot.routes['31']! } } }), options({}, now));
    expect(nightOnly.map((t) => t.selection)).toEqual([{ kind: 'route', id: '31' }]);
    expect(nightOnly[0]!.at).toBe('2026-09-12T03:38:00.000Z');
    expect(options({}, now).bucket(nightOnly[0]!.at)).toBe('danas');
  });

  it('shows nothing after validUntil, on a down snapshot, and without ctx.lastRun', () => {
    expect(lastRunProducer.produce(withLastRun({ lastRun: { ...snapshot, validUntil: '2026-09-11T12:00:00Z' } }), options())).toEqual([]);
    expect(lastRunProducer.produce(withLastRun({ lastRun: { status: 'down', fetchedAt: '2026-09-11T12:00:00Z' } }), options())).toEqual([]);
    expect(lastRunProducer.produce(withLastRun({ lastRun: null }), options())).toEqual([]);
    expect(lastRunProducer.produce(ctx(), options())).toEqual([]);
  });

  it('names an unknown line by its id and kind "other", so a new line never hides', () => {
    const tiles = lastRunProducer.produce(withLastRun({ lastRun: { ...snapshot, routes: { '999': { '2026-09-11': '23:00' } } } }), options());
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ title: '999', selection: { kind: 'route', id: '999' } });
    expect(tiles[0]!.labelMarkup).toContain('data-kind="other"');
  });

  it('carries the flag and no module: the band never asks it while FEED_LASTRUN is off, and never paints zet-rt’s state on a schedule', () => {
    expect(lastRunProducer.flag).toBe('FEED_LASTRUN');
    expect(lastRunProducer.modules).toEqual([]);
    expect(lastRunProducer.skeleton).toBeNull();
  });
});
