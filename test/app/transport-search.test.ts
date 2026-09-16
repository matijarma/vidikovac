import { describe, expect, it } from 'vitest';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { decodeNetwork } from '../../shared/motion/network';
import { routeCatalogue, routeEntry, routeStopSequence, stopGroupById, stopGroupsFromCatalogue, stopGroupsFromNetwork } from '../../app/src/transport/catalogue';
import { compareRouteShort, fold, searchTransport, type StopGroup } from '../../app/src/transport/search';
import { tr, trPlural } from '../../app/src/transport/strings';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STOPS: StopGroup[] = stopGroupsFromCatalogue([
  { id: '1_21', name: 'Trg bana Jelačića', lon: 15.9773, lat: 45.8129, routes: ['6', '11', '12'] },
  { id: '1_22', name: 'Trg bana Jelačića', lon: 15.9765, lat: 45.8131, routes: ['6', '13', '17'] },
  { id: '2_21', name: 'Črnomerec', lon: 15.9377, lat: 45.8119, routes: ['2', '6', '11'] },
  { id: '3_21', name: 'Kvaternikov trg', lon: 16.0009, lat: 45.8126, routes: ['4', '11', '12'] },
  { id: '4_21', name: 'Trešnjevački trg', lon: 15.9540, lat: 45.8000, routes: ['9', '12'] },
]);

describe('fold and route order', () => {
  it('folds Croatian diacritics and case so either spelling finds the other', () => {
    expect(fold('Črnomerec')).toBe('crnomerec');
    expect(fold('Trešnjevački trg')).toBe('tresnjevacki trg');
    expect(fold('Đorđićeva  – Šubićeva')).toBe('dordiceva subiceva');
  });
  it('orders route numbers as read, not as strings', () => {
    expect(['11', '6', '109', '2'].sort(compareRouteShort)).toEqual(['2', '6', '11', '109']);
  });
});

describe('stop groups', () => {
  it('groups platforms by name, unions their routes in reading order and keeps a real platform id as the group id', () => {
    const jelacic = STOPS.find((s) => s.name === 'Trg bana Jelačića')!;
    expect(jelacic.ids).toEqual(['1_21', '1_22']);
    expect(jelacic.id).toBe('1_21');
    expect(jelacic.routes).toEqual(['6', '11', '12', '13', '17']);
    expect(jelacic.lon).toBeCloseTo(15.9769, 4);
    expect(stopGroupById(STOPS, '1_22')).toBe(jelacic);
    expect(STOPS.map((s) => s.name)).toEqual(['Črnomerec', 'Kvaternikov trg', 'Trešnjevački trg', 'Trg bana Jelačića']);
  });
});

describe('searchTransport', () => {
  const routes = routeCatalogue();
  it('a bare number is a route number first: exact, then prefix, trams before buses', () => {
    const one = searchTransport('1', routes, STOPS);
    expect(one.routes[0]!.id).toBe('1');
    expect(one.routes.map((r) => r.short).slice(0, 4)).toEqual(['1', '11', '12', '13']);
    expect(searchTransport('6', routes, STOPS).routes[0]!.id).toBe('6');
    // Six rows by default; the whole prefix family when the caller asks for more.
    expect(searchTransport('10', routes, STOPS).routes).toHaveLength(6);
    expect(searchTransport('10', routes, STOPS, { routes: 20, stops: 8 }).routes.map((r) => r.short)).toContain('109');
  });
  it('words match route names and stop names with diacritics folded, best match first, one row per named stop', () => {
    const q = searchTransport('crnomerec', routes, STOPS);
    expect(q.stops.map((s) => s.name)).toEqual(['Črnomerec']);
    expect(q.routes.map((r) => r.short)).toContain('2');
    const trg = searchTransport('trg', routes, STOPS);
    expect(trg.stops[0]!.name).toBe('Trg bana Jelačića'); // a leading-word match with the most routes wins
    expect(trg.stops.map((s) => s.name)).toContain('Kvaternikov trg');
    expect(searchTransport('trg bana', routes, STOPS).stops.map((s) => s.name)).toEqual(['Trg bana Jelačića']);
  });
  it('answers nothing for an empty or unmatched query', () => {
    expect(searchTransport('   ', routes, STOPS)).toEqual({ routes: [], stops: [] });
    expect(searchTransport('xyzzy', routes, STOPS)).toEqual({ routes: [], stops: [] });
  });
  it('routeEntry answers honestly for an id GTFS does not know', () => {
    expect(routeEntry('6')).toMatchObject({ id: '6', short: '6', type: 0 });
    expect(routeEntry('E2E6')).toEqual({ id: 'E2E6', short: 'E2E6', long: '', type: -1 });
  });
});

describe('the network artefact as a catalogue', () => {
  const net = decodeNetwork(JSON.parse(readFileSync(resolve(import.meta.dirname, '../../app/public/data/zet-network.json'), 'utf8')));
  it('lists the stops of a tram route along its fullest shape in travel order, one per name, with real Zagreb names', () => {
    const seq = routeStopSequence(net, '6');
    expect(seq.length).toBeGreaterThan(15);
    for (let i = 1; i < seq.length; i++) expect(seq[i]!.s).toBeGreaterThanOrEqual(seq[i - 1]!.s);
    expect(new Set(seq.map((s) => s.name)).size).toBe(seq.length);
    // GTFS spells the square "Trg bana J. Jelačića".
    expect(seq.map((s) => s.name)).toContain('Trg bana J. Jelačića');
    expect(routeStopSequence(net, 'no-such-route')).toEqual([]);
  });
  it('groups the artefact\u2019s platforms by name with the routes that call there', () => {
    const groups = stopGroupsFromNetwork(net);
    expect(groups.length).toBeGreaterThan(1000);
    const jelacic = groups.find((g) => g.name === 'Trg bana J. Jelačića')!;
    expect(jelacic.ids.length).toBeGreaterThanOrEqual(2);
    expect(jelacic.routes).toContain('6');
    expect(jelacic.routes).toContain('11');
  });
});

describe('workspace strings', () => {
  it('speak Croatian and English by the page locale, with Croatian plurals', () => {
    const hr = createDefaultI18n('hr');
    const en = createDefaultI18n('en');
    expect(tr(hr, 'trams')).toBe('Tramvaji');
    expect(tr(en, 'trams')).toBe('Trams');
    expect(trPlural(hr, 'vehiclesNow', 1)).toBe('1 vozilo u pokretu');
    expect(trPlural(hr, 'vehiclesNow', 3)).toBe('3 vozila u pokretu');
    expect(trPlural(hr, 'vehiclesNow', 5)).toBe('5 vozila u pokretu');
    expect(trPlural(en, 'vehiclesNow', 1)).toBe('1 vehicle moving');
    expect(trPlural(en, 'vehiclesNow', 2)).toBe('2 vehicles moving');
    expect(tr(hr, 'noResults', { query: 'xy' })).toBe('Nema linije ni stanice za „xy”.');
  });
});
