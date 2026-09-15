// The nine producers of A.6, each over its own small fixture: the exact
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
  newsProducer,
  safetyProducer,
  safetyVerdict,
  transitProducer,
  worksProducer,
  type LastRun,
} from '../../app/src/experience/producers';
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
  return { columns, surface: 'desktop', kvart: null, bucket: (at, until, allDay) => bucketOf(now, columns, at, until, allDay), ...over };
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
    ...({ saved: { list: () => ids.map((id) => ({ kind: 'route' as const, id })) } } as Partial<LayerContext>),
  });

  it('boards the stop’s lines with saved lines prepended, each badge, delay word, tone and vehicle-count glyph', () => {
    const tiles = transitProducer.produce(savedList(['12']), options());
    expect(tiles.map((t) => t.selection)).toEqual([{ kind: 'route', id: '12' }, { kind: 'route', id: '6' }, { kind: 'route', id: '101' }, { kind: 'route', id: '99' }]);

    const six = tiles.find((t) => t.key === 'zet-rt:route:6')!;
    expect(six.label).toBe('Linija 6');
    expect(six.labelMarkup).toContain('data-kind="tram"');
    expect(six.value).toBe('kasni 2 min');
    expect(six.valueTone).toBe('late');
    expect(six.valueSize).toBe('l');
    expect(six.contextMarkup).toContain('icon-tram-front');
    expect(six.contextMarkup).toContain('>2<');
    expect(six.aria).toBe('Linija 6, Črnomerec-Sopot, kasni 2 min, 2 vozila');
    expect(six.testid).toBe('tile-transit');
    expect(six.bucket).toBe('sada');
    expect(six.layer).toBe('u-pokretu');
    expect(six.domain).toBe('transit');

    const bus = tiles.find((t) => t.key === 'zet-rt:route:101')!;
    expect(bus.value).toBe('rani 2 min');
    expect(bus.valueTone).toBe('early');
    expect(bus.contextMarkup).toContain('icon-bus-front');
    expect(bus.contextMarkup).toContain('>5<');
    expect(bus.labelMarkup).toContain('data-kind="bus"');

    const unmatched = tiles.find((t) => t.key === 'zet-rt:route:99')!;
    expect(unmatched.value).toBe('nema podataka');
    expect(unmatched.valueTone).toBe('none');
    expect(unmatched.valueSize).toBe('m');
    expect(unmatched.contextMarkup).toBeUndefined();
    expect(unmatched.aria).toBe('Linija 99, 99, nema podataka');
  });

  it('without a stop, ranks by delay: only a figure the helper declines to assert is left out, most-delayed first', () => {
    const tiles = transitProducer.produce(ctx({ snapshots: { 'zet-rt': ZET } }), options());
    expect(tiles.map((t) => t.key)).toEqual(['zet-rt:route:101', 'zet-rt:route:6', 'zet-rt:route:12']);
  });

  it('is empty without a stop, saved lines or deviation (the no-stop branch with nothing to show)', () => {
    expect(transitProducer.produce(ctx({ snapshots: { 'zet-rt': base('zet-rt', []) } }), options())).toEqual([]);
  });

  it('words its "+ N" foot, naming the stop only when one exists', () => {
    const withStop = transitProducer.moreLabel!(hr, 4, ctx({ screen: { surface: 'phone', locale: 'hr', theme: 'light', themePreference: 'light', lightweight: false, reducedMotion: false, stop: STOP } }));
    expect(withStop).toEqual({ text: '+ 4 linije', aria: '+ 4 linije, Sa stanice Trg bana J. Jelačića' });
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
    expect(tiles[0]).toMatchObject({ key: 'mobility:closures', domain: 'mobility', variant: 'band', tone: 'mobility', icon: 'car-front', title: 'Grada Vukovara', bucket: 'sada', testid: 'tile-closures' });
    expect(tiles[0]!.value).toBe(`do ${zagrebTime('2026-09-11T20:00:00Z')}`);
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
});

// ---------------------------------------------------------------------------
// works / komunalno

describe('worksProducer', () => {
  const work = (id: string, phase: string, district?: string): ModuleSnapshot['items'][number] => ({
    id, module: 'dogadanja', kind: 'event', tier: 'session', title: `Radovi ${id}`, at: '2026-06-01T00:00:00Z',
    data: { source: 'komunalne', phase, status: 'U tijeku', amount: 100, precision: 'day', ...(district ? { district } : {}) },
  });

  it('counts the city’s works in progress when no kvart is chosen', () => {
    const dogadanja = base('dogadanja', [work('w1', 'Radovi u tijeku'), work('w2', 'Radovi u tijeku'), work('w3', 'U pripremi')]);
    const tile = worksProducer.produce(ctx({ snapshots: { dogadanja } }), options({ kvart: null }))[0]!;
    expect(tile.value).toBe('2');
    expect(tile.title).toBe('Radovi u gradu');
    expect(tile.aria).toBe('Radovi, 2 rada u tijeku, Radovi u gradu');
    expect(tile.testid).toBe('tile-works');
    expect(tile.bucket).toBe('sada');
  });

  it('scopes the count and names the kvart once the register carries districts', () => {
    const dogadanja = base('dogadanja', [work('w1', 'Radovi u tijeku', 'trnje'), work('w2', 'Radovi u tijeku', 'maksimir'), work('w3', 'Radovi u tijeku', 'trnje')]);
    const tile = worksProducer.produce(ctx({ snapshots: { dogadanja } }), options({ kvart: 'trnje' }))[0]!;
    expect(tile.value).toBe('2');
    expect(tile.title).toBe('Trnje');
  });

  it('shows no tile for a kvart with no matching works once districts are known', () => {
    const dogadanja = base('dogadanja', [work('w1', 'Radovi u tijeku', 'maksimir')]);
    expect(worksProducer.produce(ctx({ snapshots: { dogadanja } }), options({ kvart: 'trnje' }))).toEqual([]);
  });

  it('falls back to the city-wide title when the kvart is chosen but the register has not shipped districts yet', () => {
    const dogadanja = base('dogadanja', [work('w1', 'Radovi u tijeku')]);
    const tile = worksProducer.produce(ctx({ snapshots: { dogadanja } }), options({ kvart: 'trnje' }))[0]!;
    expect(tile.title).toBe('Radovi u gradu');
    expect(tile.value).toBe('1');
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

  it('carries the venue when the source gives one, the source name only when it does not', () => {
    const withVenue = base('dogadanja', [
      { id: 'kulturpunkt:venue', module: 'dogadanja', kind: 'event', tier: 'session', title: 'U dvorani', at: '2026-09-12T18:00:00Z', data: { source: 'kulturpunkt', category: 'koncert', venue: 'Lisinski', precision: 'time' } },
    ]);
    const tiles = eventsProducer.produce(ctx({ snapshots: { dogadanja: withVenue } }), options());
    expect(tiles[0]!.context).toBe('Lisinski');
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
    const tile = gazetteProducer.produce(ctx({ snapshots: { glasnik } }))[0]!;
    expect(tile).toMatchObject({ key: 'glasnik:issue', domain: 'civic', variant: 'value', label: 'Glasnik', value: '21/2026', valueSize: 'xl', bucket: 'sada', testid: 'tile-gazette' });
    expect(tile.context).toBe(`objavljen ${zagrebWeekdayShort('2026-09-10T00:00:00Z')} · 2 akta`);
  });

  it('shows nothing without any acts', () => {
    expect(gazetteProducer.produce(ctx({ snapshots: { glasnik: base('glasnik', []) } }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// news

describe('newsProducer', () => {
  it('leads with the first HRT vijesti item', () => {
    const news = base('hrt-news', [{ id: 'n1', module: 'hrt-news', kind: 'news', tier: 'open', title: 'Naslov vijesti', at: '2026-09-11T11:00:00Z' }]);
    const tile = newsProducer.produce(ctx({ snapshots: { 'hrt-news': news } }))[0]!;
    expect(tile).toMatchObject({ key: 'hrt-news:n1', domain: 'news', variant: 'row', icon: 'newspaper', label: 'Vijesti', title: 'Naslov vijesti', bucket: 'sada', testid: 'tile-news' });
    expect(tile.context).toMatch(/^HRT vijesti · /);
  });

  it('falls back to Radio Sljeme when HRT vijesti has nothing, and skips a source reporting down', () => {
    const withSljeme = base('hrt-news', [{ id: 's1', module: 'hrt-news', kind: 'news', tier: 'open', title: 'Sa Sljemena', at: '2026-09-11T10:00:00Z', data: { source: 'Radio Sljeme' } }]);
    expect(newsProducer.produce(ctx({ snapshots: { 'hrt-news': withSljeme } }))[0]!.title).toBe('Sa Sljemena');

    const hrtDown: ModuleSnapshot = { ...base('hrt-news', [
      { id: 'h1', module: 'hrt-news', kind: 'news', tier: 'open', title: 'HRT vijest', at: '2026-09-11T10:00:00Z', data: { source: 'HRT vijesti' } },
      { id: 's1', module: 'hrt-news', kind: 'news', tier: 'open', title: 'Sa Sljemena', at: '2026-09-11T10:00:00Z', data: { source: 'Radio Sljeme' } },
    ]), sources: { 'HRT vijesti': { status: 'down', itemCount: 0 }, 'Radio Sljeme': { status: 'live', itemCount: 1 } } };
    expect(newsProducer.produce(ctx({ snapshots: { 'hrt-news': hrtDown } }))[0]!.title).toBe('Sa Sljemena');
  });

  it('shows nothing once both sources are down or empty', () => {
    expect(newsProducer.produce(ctx({ snapshots: { 'hrt-news': base('hrt-news', []) } }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// last run (behind FEED_LASTRUN, forward of T3.1)

describe('lastRunProducer', () => {
  const lastRun: LastRun = {
    validUntil: '2026-09-12T02:00:00Z',
    departures: [
      { routeId: '6', at: '2026-09-11T19:00:00Z' }, // 21:00 Zagreb, evening
      { routeId: '11', at: '2026-09-11T21:00:00Z' }, // 23:00 Zagreb, evening
      { routeId: '12', at: '2026-09-11T21:30:00Z' }, // 23:30 Zagreb, evening (kept: two latest)
      { routeId: '13', at: '2026-09-12T05:00:00Z' }, // after validUntil: dropped
      { routeId: '14', at: '2026-09-11T08:00:00Z' }, // already past "now": bucket is null, dropped
    ],
  };
  const withLastRun = (): LayerContext => ({ ...ctx(), ...({ lastRun } as Partial<LayerContext>) });

  it('emits at most the two latest departures within validUntil that still lie on the band', () => {
    const tiles = lastRunProducer.produce(withLastRun(), options());
    expect(tiles.map((t) => t.selection)).toEqual([{ kind: 'route', id: '11' }, { kind: 'route', id: '12' }]);
    const one = tiles[0]!;
    expect(one).toMatchObject({ key: 'zet-rt:lastrun:11', domain: 'transit', variant: 'time', title: 'Črnomerec - Dubec', at: '2026-09-11T21:00:00Z', context: 'Prema redu vožnje' });
    expect(one.label).toBe('Zadnji polazak');
    expect(one.labelMarkup).toContain('data-size="xs"');
  });

  it('is empty without ctx.lastRun', () => {
    expect(lastRunProducer.produce(ctx(), options())).toEqual([]);
  });

  it('carries the flag, so buildTimeband never asks it while FEED_LASTRUN is off', () => {
    expect(lastRunProducer.flag).toBe('FEED_LASTRUN');
  });
});
