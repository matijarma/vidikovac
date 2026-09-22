// app/src/kiosk/places.ts (WP3 step 2): what the one field "Adresa ili
// stajalište" suggests. The real stop table (app/public/data/stops.json) and a
// hand-made index of twenty streets (values as scripts/streets-geo.mjs writes
// them); the committed index is read once through loadStreets at the end.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import stopsJson from '../../app/public/data/stops.json';
import { loadStreets } from '../../app/src/core/screens';
import {
  MAX_SEGMENTS,
  anchorOf,
  parseAddressQuery,
  placeInputOf,
  suggestPlaces,
  type PlaceSuggestion,
  type StreetGeo,
} from '../../app/src/kiosk/places';
import { CITY_CENTRE, fold, isTramStop, routeType, stopById } from '../../app/src/kiosk/stops';
import { TRAM_NEAR_M, derivePlace } from '../../shared/city/place';
import { distanceM } from '../../shared/city/geo';
import type { ScreenStop } from '../../worker/protocol';

const STOPS = stopsJson as ScreenStop[];
const isTram = (routeId: string) => routeType(routeId) === 0;

const street = (
  name: string, settlement: 'Zagreb' | 'Sesvete', id: string | null, lon: number, lat: number,
  bbox: [number, number, number, number], lengthM: number, stops: string[] = [],
): StreetGeo => ({
  name, ...(id ? { id } : {}), settlementId: settlement === 'Zagreb' ? '72150' : '57363', settlement, lon, lat, bbox, lengthM, stops,
});

const STREETS: StreetGeo[] = [
  street('Bogovićeva ulica', 'Zagreb', '721500247', 15.97532, 45.8122, [15.9742, 45.8121, 15.9764, 45.8123], 159),
  street('Gajeva ulica', 'Sesvete', '573630056', 16.09373, 45.82301, [16.0928, 45.8227, 16.0948, 45.8233], 195),
  street('Gajeva ulica', 'Zagreb', '721500789', 15.97631, 45.80929, [15.9762, 45.8056, 15.9767, 45.8129], 796, ['106_2']),
  street('Horvatova ulica', 'Zagreb', null, 15.97794, 45.76015, [15.9715, 45.7509, 15.9887, 45.765], 4304, ['1187_24']),
  street('Ilica', 'Zagreb', '721501047', 15.93589, 45.81484, [15.8961, 45.8113, 15.9763, 45.8149], 6683,
    ['136_27', '1673_22', '135_21', '164_21', '468_22', '467_21', '99_36', '100_1', '101_1', '102_2', '663_23', '2026_24', '103_2', '169_1', '105_1', '106_2']),
  street('Ilirski trg', 'Zagreb', '721501052', 15.975, 45.81923, [15.9745, 45.8187, 15.9754, 45.8196], 177, ['1852_23', '425_21']),
  street('Jurišićeva ulica', 'Zagreb', '721501221', 15.98094, 45.81232, [15.9784, 45.8121, 15.9836, 45.8127], 401),
  street('Kvaternikova ulica', 'Zagreb', '721501636', 15.92772, 45.82625, [15.9264, 45.8168, 15.931, 45.8376], 2732, ['461_24']),
  street('Masarykova ulica', 'Zagreb', '721501920', 15.97265, 45.81073, [15.971, 45.8102, 15.9743, 45.8113], 275),
  street('Petrinjska ulica', 'Zagreb', '721502361', 15.98012, 45.80873, [15.979, 45.8051, 15.9805, 45.8124], 831),
  street('Savska cesta', 'Sesvete', null, 16.11844, 45.81127, [16.1181, 45.8029, 16.1201, 45.8195], 2013, ['1408_24', '1407_23', '1406_23', '1402_21']),
  street('Savska cesta', 'Zagreb', '721502847', 15.96055, 45.79693, [15.9501, 45.7846, 15.9677, 45.8074], 3057,
    ['271_21', '1428_23', '262_4', '310_4', '305_3', '314_3', '288_3', '294_1', '232_1', '224_3']),
  street('Tkalčićeva ulica', 'Zagreb', '721503260', 15.97632, 45.81725, [15.9761, 45.8137, 15.9768, 45.821], 831, ['1849_23', '429_24']),
  street('Trg bana Josipa Jelačića', 'Zagreb', '721503305', 15.97735, 45.81287, [15.9762, 45.8126, 15.9785, 45.8131], 175, ['106_1']),
  street('Trg Eugena Kvaternika', 'Zagreb', '721501635', 15.99757, 45.81466, [15.9961, 45.8141, 15.9978, 45.8152], 303, ['236_10', '303_3']),
  street('Trg kralja Tomislava', 'Sesvete', '573630292', 16.16779, 45.81702, [16.1673, 45.8162, 16.1686, 45.8176], 328),
  street('Trg kralja Tomislava', 'Zagreb', '721503266', 15.97937, 45.80618, [15.9778, 45.8049, 15.9795, 45.8077], 614, ['109_1']),
  street('Ulica grada Vukovara', 'Zagreb', '721503440', 15.98945, 45.80087, [15.9538, 45.7992, 16.0249, 45.8048], 11827,
    ['295_2', '314_1', '312_1', '1375_1', '248_2', '239_2', '235_2', '284_2', '114_2', '251_1', '263_1', '221_2', '203_2', '225_1', '213_1']),
  street('Ulica kneza Branimira', 'Zagreb', '721501371', 16.04182, 45.81782, [15.9794, 45.805, 16.0907, 45.8359], 14132,
    ['109_1', '111_1', '112_2', '2112_21', '1133_21', '1134_21', '1135_21', '1136_21', '1137_21', '1140_22', '1139_21', '1919_21', '2025_24']),
  street('Vlaška ulica', 'Zagreb', '721503563', 15.98717, 45.81374, [15.9787, 45.8132, 15.9962, 45.8148], 1460, ['124_3', '311_1', '254_2', '236_1']),
];

const names = (rows: PlaceSuggestion[]) => rows.map((row) => (row.kind === 'stop' ? row.stop.name : row.street.name));
const kinds = (rows: PlaceSuggestion[]) => rows.map((row) => row.kind);
/** A stop of the fixture only (never the real table's). */
const fake = (id: string, name: string, lon: number, lat: number, routes: string[]): ScreenStop => ({ id, name, lon, lat, routes });

describe('the stop helpers places.ts relies on', () => {
  it('folds case and diacritics, knows a tram stop and names the city centre', () => {
    expect(fold('  Zapruđe  ŠALATA ')).toBe('zaprude salata');
    expect(isTramStop({ routes: ['101', '6'] })).toBe(true);
    expect(isTramStop({ routes: ['101'] })).toBe(false);
    expect(isTramStop({ routes: [] })).toBe(false);
    const trg = stopById(STOPS, '106_1')!;
    expect({ lon: CITY_CENTRE.lon, lat: CITY_CENTRE.lat }).toEqual({ lon: trg.lon, lat: trg.lat });
  });

  it('knows every stop the fixture streets name', () => {
    for (const s of STREETS) for (const id of s.stops) expect(stopById(STOPS, id), `${s.name} ${id}`).not.toBeNull();
  });
});

describe('parseAddressQuery', () => {
  it('splits a trailing house number off the street', () => {
    expect(parseAddressQuery('Ilica 25')).toEqual({ street: 'Ilica', number: '25' });
    expect(parseAddressQuery('  Ilica   25a ')).toEqual({ street: 'Ilica', number: '25a' });
    expect(parseAddressQuery('Trg kralja Petra Krešimira IV.')).toEqual({ street: 'Trg kralja Petra Krešimira IV.' });
    expect(parseAddressQuery('144 brigade')).toEqual({ street: '144 brigade' });
    expect(parseAddressQuery('25')).toEqual({ street: '25' });
    expect(parseAddressQuery('Ilica 123456')).toEqual({ street: 'Ilica 123456' });
  });
});

describe('suggestPlaces', () => {
  it('offers nothing for fewer than two characters', () => {
    expect(suggestPlaces('', STOPS, STREETS)).toEqual([]);
    expect(suggestPlaces(' k ', STOPS, STREETS)).toEqual([]);
    expect(suggestPlaces('Kv', STOPS, STREETS).length).toBeGreaterThan(0);
    expect(suggestPlaces('Kvatern', STOPS, STREETS, CITY_CENTRE, 0)).toEqual([]);
  });

  it('puts the stop Kvaternikov trg first (a tram platform), then the streets by prefix, then by word', () => {
    const rows = suggestPlaces('Kvatern', STOPS, STREETS);
    const first = rows[0]!;
    expect(first.kind).toBe('stop');
    if (first.kind !== 'stop') return;
    expect(first.stop.name).toBe('Kvaternikov trg');
    expect(first.stop.id).toMatch(/^236_/);
    expect(isTramStop(first.stop)).toBe(true);
    const lastStop = kinds(rows).lastIndexOf('stop');
    expect(kinds(rows).slice(0, lastStop + 1).every((kind) => kind === 'stop')).toBe(true);
    // Kvaternikova ulica is long but has one stop only: one row, not a segment.
    expect(rows.slice(lastStop + 1).map((row) => [row.kind, names([row])[0]])).toEqual([
      ['street', 'Kvaternikova ulica'],
      ['street', 'Trg Eugena Kvaternika'],
    ]);
  });

  it('turns a picked stop into the tram place Kvaternikov trg, sent by its id only', () => {
    const [row] = suggestPlaces('Kvatern', STOPS, STREETS);
    const place = derivePlace(anchorOf(row!), STOPS, isTram);
    expect(place).toMatchObject({ kind: 'tram', name: 'Kvaternikov trg' });
    expect(placeInputOf(place)).toEqual({ kind: 'stop', stopId: place.stopId });
  });

  it('offers a long street as up to four parts at its stops, spread along it, keeping the typed number', () => {
    const rows = suggestPlaces('Ilica 25', STOPS, STREETS);
    const ilica = STREETS.find((s) => s.name === 'Ilica')!;
    expect(rows).toHaveLength(MAX_SEGMENTS);
    const stops = rows.map((row) => {
      expect(row).toMatchObject({ kind: 'segment', number: '25', street: ilica });
      return row.kind === 'segment' ? row.stop.id : '';
    });
    const along = stops.map((id) => ilica.stops.indexOf(id));
    expect(along[0]).toBe(0);
    expect(along[along.length - 1]).toBe(ilica.stops.length - 1);
    expect([...along].sort((a, b) => a - b)).toEqual(along);
    const [part] = rows;
    if (part!.kind !== 'segment') throw new Error('segment expected');
    expect(anchorOf(part!)).toEqual({ lon: part.stop.lon, lat: part.stop.lat, name: 'Ilica', address: 'Ilica 25' });
    expect(anchorOf({ ...part, number: undefined })).toMatchObject({ name: 'Ilica', address: `Ilica · ${part.stop.name}` });
  });

  it('offers a short street once, at its own point, with the number as the address', () => {
    const rows = suggestPlaces('Masarykova 12', STOPS, STREETS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'street', number: '12', street: { name: 'Masarykova ulica' } });
    const anchor = anchorOf(rows[0]!);
    expect(anchor).toEqual({ lon: 15.97265, lat: 45.81073, name: 'Masarykova ulica', address: 'Masarykova ulica 12' });
    const place = derivePlace(anchor, STOPS, isTram);
    const tram = STOPS.filter((s) => s.routes.some(isTram)).map((s) => distanceM(anchor, s));
    expect(place.kind).toBe(Math.min(...tram) <= TRAM_NEAR_M ? 'tram' : 'bus');
    expect(place.address).toBe('Masarykova ulica 12');
  });

  it('matches without diacritics and offers a long street with two stops as two parts', () => {
    expect(names(suggestPlaces('zaprude', STOPS, STREETS))[0]).toBe('Zapruđe');
    const rows = suggestPlaces('tkalciceva', STOPS, STREETS);
    expect(rows.filter((row) => row.kind === 'segment').map((row) => (row.kind === 'segment' ? row.stop.id : ''))).toEqual(['1849_23', '429_24']);
  });

  it('lists streets of the same name nearest first, each with its settlement', () => {
    const central = suggestPlaces('Gajeva', [], STREETS);
    expect(central.map((row) => (row.kind === 'street' ? row.street.settlement : ''))).toEqual(['Zagreb', 'Sesvete']);
    const east = suggestPlaces('Gajeva', [], STREETS, { lon: 16.09, lat: 45.82 });
    expect(east.map((row) => (row.kind === 'street' ? row.street.settlement : ''))).toEqual(['Sesvete', 'Zagreb']);
  });

  it('puts a tram stop before a bus-only stop of equal rank, and shows a name by its tram platform', () => {
    const stops = [
      fake('b1', 'Borongaj', 15.98, 45.81, ['101']),
      fake('t1', 'Borongajska', 16.05, 45.82, ['6']),
      fake('a1', 'Alpha', 15.98, 45.812, ['101']),
      fake('a2', 'Alpha', 16.1, 45.9, ['6']),
    ];
    expect(names(suggestPlaces('borong', stops, []))).toEqual(['Borongajska', 'Borongaj']);
    const [alpha] = suggestPlaces('alpha', stops, []);
    expect(alpha).toMatchObject({ kind: 'stop', stop: { id: 'a2' } });
  });

  it('gives streets at least half the rows when stops and streets both match', () => {
    const rows = suggestPlaces('trg', STOPS, STREETS);
    expect(rows).toHaveLength(8);
    expect(kinds(rows)).toEqual(['stop', 'stop', 'stop', 'stop', 'street', 'street', 'street', 'street']);
    expect(names(rows).slice(4)).toEqual(['Trg bana Josipa Jelačića', 'Trg kralja Tomislava', 'Trg Eugena Kvaternika', 'Trg kralja Tomislava']);
    expect(kinds(suggestPlaces('trg', STOPS, STREETS, CITY_CENTRE, 3))).toEqual(['stop', 'stop', 'street']);
    expect(kinds(suggestPlaces('trg', STOPS, [], CITY_CENTRE, 3))).toEqual(['stop', 'stop', 'stop']);
  });
});

describe('the committed index through loadStreets', () => {
  it('loads lazily once, retries after a failure, and suggests from the real streets', async () => {
    const body = readFileSync(new URL('../../app/public/data/streets-geo.json', import.meta.url), 'utf8');
    const failing = vi.fn(async () => new Response('', { status: 503 }));
    await expect(loadStreets(failing as unknown as typeof fetch)).rejects.toThrow('streets-unavailable');
    const ok = vi.fn(async () => new Response(body, { status: 200 }));
    const streets = await loadStreets(ok as unknown as typeof fetch);
    await loadStreets(ok as unknown as typeof fetch);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledWith('/data/streets-geo.json');
    expect(streets.length).toBeGreaterThan(3_000);
    const rows = suggestPlaces('Kvatern', STOPS, streets);
    expect(rows[0]).toMatchObject({ kind: 'stop', stop: { name: 'Kvaternikov trg' } });
    expect(names(rows)).toContain('Trg Eugena Kvaternika');
    // Ilica first, as its parts; later streets match "ilica" inside a word ("Ulica Luke Ilića …").
    const ilica = suggestPlaces('Ilica 25', STOPS, streets);
    expect(ilica.slice(0, MAX_SEGMENTS).map((row) => [row.kind, names([row])[0]])).toEqual(Array(MAX_SEGMENTS).fill(['segment', 'Ilica']));
    expect(ilica.every((row) => row.kind !== 'stop' && row.number === '25')).toBe(true);
    // "Horvatova" names Horvatova ulica before Horvatovac, whose name only begins with it.
    const streetsOnly = suggestPlaces('Horvatova', STOPS, streets).filter((row) => row.kind !== 'stop');
    expect(names(streetsOnly)[0]).toBe('Horvatova ulica');
  });
});
