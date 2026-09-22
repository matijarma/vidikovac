// The phone's place (companion WP4 step 1, [O-26], [O-65]): screen, then a
// saved stop, then the tram stop near the reference, else the bus stop, else
// the point itself; nothing at all is Trg bana J. Jelačića with its departures
// from 106_1. Distances are built along a meridian from one reference point.
import { describe, expect, it } from 'vitest';
import { BUS_NEAR_M, DEFAULT_PLACE_NAME, DEPARTURES_STOP_M, TRAM_NEAR_M, resolvePlace } from '../../app/src/city/place';
import type { LocationContext } from '../../app/src/city/location';
import type { ScreenStop } from '../../app/src/core/contracts';
import type { SavedRef } from '../../app/src/core/saved-store';

const REF = { lon: 15.95, lat: 45.8 };
const M_PER_DEG_LAT = 111_195;
/** A stop `m` metres north of REF: route '6' is a tram, '101' a bus (zet-routes.json). */
const at = (id: string, name: string, m: number, routes: string[]): ScreenStop =>
  ({ id, name, lon: REF.lon, lat: REF.lat + m / M_PER_DEG_LAT, routes });
const device: LocationContext = { kind: 'device', lon: REF.lon, lat: REF.lat, name: '' };
const savedOf = (...refs: SavedRef[]) => ({ list: () => refs });

const TRG: ScreenStop = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '11', '12', '13', '14', '17'] };
const TRG_2: ScreenStop = { id: '106_2', name: 'Trg bana J. Jelačića', lon: 15.97653, lat: 45.81307, routes: ['6', '11'] };

describe('resolvePlace', () => {
  it('keeps the rule the wall uses: 400 m for a tram stop, 300 m for a bus stop, 800 m for the departures', () => {
    expect([TRAM_NEAR_M, BUS_NEAR_M, DEPARTURES_STOP_M]).toEqual([400, 300, 800]);
  });

  it('the screen stop wins over a saved stop and over the stop nearest the reference', () => {
    const screenStop = at('s1', 'Kvaternikov trg', 2_000, ['6']);
    const saved = at('v1', 'Savski most', 1_000, ['6']);
    const near = at('n1', 'Blizu', 50, ['6']);
    const place = resolvePlace({ screen: { stop: screenStop }, saved: savedOf({ kind: 'stop', id: 'v1' }), stops: [screenStop, saved, near], location: device });
    expect(place).toMatchObject({ kind: 'screen', name: 'Kvaternikov trg', stop: screenStop, departuresStop: screenStop });
  });

  it('the wall’s chosen place titles the phone; the read path’s default does not', () => {
    const stop = at('p1', 'Kvaternikov trg', 0, ['6']);
    const chosen = resolvePlace({ screen: { stop: null, place: { kind: 'tram', name: 'Kvaternikov trg', lon: stop.lon, lat: stop.lat, stopId: 'p1' }, placeSet: true }, stops: [stop] });
    expect(chosen).toMatchObject({ kind: 'screen', name: 'Kvaternikov trg', stop, departuresStop: stop });
    const street = at('p2', 'Maksimirska', 300, ['101']);
    const address = resolvePlace({ screen: { stop: null, place: { kind: 'address', name: 'Ulica kralja Zvonimira', lon: REF.lon, lat: REF.lat }, placeSet: true }, stops: [street] });
    expect(address).toMatchObject({ kind: 'screen', name: 'Ulica kralja Zvonimira', stop: null, departuresStop: street });
    const fallback = resolvePlace({ screen: { stop: null, place: { kind: 'tram', name: 'Trg bana J. Jelačića', lon: TRG.lon, lat: TRG.lat, stopId: '106_1' }, placeSet: false }, saved: savedOf({ kind: 'stop', id: 'p1' }), stops: [stop, TRG] });
    expect(fallback).toMatchObject({ kind: 'saved', name: 'Kvaternikov trg' });
  });

  it('a saved stop beats the stop nearest the reference; a saved route or place does not count', () => {
    const saved = at('v1', 'Savski most', 1_500, ['6']);
    const near = at('n1', 'Blizu', 50, ['6']);
    const place = resolvePlace({ saved: savedOf({ kind: 'route', id: '6' }, { kind: 'stop', id: 'gone' }, { kind: 'stop', id: 'v1' }), stops: [saved, near], location: device });
    expect(place).toMatchObject({ kind: 'saved', name: 'Savski most', stop: saved, departuresStop: saved });
  });

  it('a tram stop at 350 m beats a bus stop at 120 m', () => {
    const tram = at('t1', 'Tramvajska', 350, ['6']);
    const bus = at('b1', 'Autobusna', 120, ['101']);
    const place = resolvePlace({ stops: [bus, tram], location: device });
    expect(place).toMatchObject({ kind: 'nearest', name: 'Tramvajska', stop: tram, departuresStop: tram });
  });

  it('finds the tram stop behind more than a dozen nearer bus platforms (the scan is not capped at 12)', () => {
    const buses = Array.from({ length: 14 }, (_, i) => at(`b${i}`, `Autobusna ${i}`, 20 + i * 10, ['101']));
    const tram = at('t1', 'Tramvajska', 390, ['6']);
    expect(resolvePlace({ stops: [...buses, tram], location: device })).toMatchObject({ kind: 'nearest', name: 'Tramvajska' });
  });

  it('falls back to the bus stop at 250 m when the nearest tram stop is 900 m away', () => {
    const tram = at('t1', 'Tramvajska', 900, ['6']);
    const bus = at('b1', 'Autobusna', 250, ['101']);
    const place = resolvePlace({ stops: [tram, bus], location: device });
    expect(place).toMatchObject({ kind: 'nearest', name: 'Autobusna', stop: bus, departuresStop: bus });
  });

  it('is the address itself when nothing is within the thresholds, and still boards the nearest platform within 800 m', () => {
    const tram = at('t1', 'Tramvajska', 900, ['6']);
    const bus = at('b1', 'Autobusna', 500, ['101']);
    const named: LocationContext = { ...device, kind: 'area', name: 'Ilica 10' };
    const place = resolvePlace({ stops: [tram, bus], location: named });
    expect(place).toMatchObject({ kind: 'address', name: 'Ilica 10', lon: REF.lon, lat: REF.lat, stop: null, departuresStop: bus });
    // An unnamed point (a granted device location) is titled by the city; nothing within 800 m boards nothing.
    const far = resolvePlace({ stops: [at('t1', 'Tramvajska', 1_200, ['6'])], location: device });
    expect(far).toMatchObject({ kind: 'address', name: 'Zagreb', stop: null, departuresStop: null });
  });

  it('with nothing to go on is Trg bana J. Jelačića, boarding 106_1', () => {
    const place = resolvePlace({ stops: [TRG_2, TRG, at('x', 'Drugo', 0, ['6'])], saved: savedOf() });
    expect(place).toMatchObject({ kind: 'city', name: 'Trg bana J. Jelačića', lon: TRG.lon, lat: TRG.lat, stop: null, departuresStop: TRG });
    expect(DEFAULT_PLACE_NAME).toBe('Trg bana J. Jelačića');
    // The city's reference location is the same default, not a nearest-stop search.
    expect(resolvePlace({ stops: [TRG_2, TRG], location: { kind: 'city', lon: TRG.lon, lat: TRG.lat, name: 'Trg bana J. Jelačića' } }).kind).toBe('city');
  });

  it('waits for the catalogue: without it a saved stop is unknown and the departures stop is null', () => {
    const place = resolvePlace({ saved: savedOf({ kind: 'stop', id: '106_1' }) });
    expect(place).toMatchObject({ kind: 'city', name: 'Trg bana J. Jelačića', departuresStop: null });
    // A screen stop needs no catalogue.
    expect(resolvePlace({ screen: { stop: TRG } }).departuresStop).toBe(TRG);
  });
});
