// worker/feed/geo/streets.ts and scripts/street-points.mjs (U3, M3): a street named in a text to a
// point of the street index the app ships. The names below are the ones the HEP, VIO and HAK
// fixtures write (test/fixtures/hep-ods-bez-struje-*.html, vio-obavijesti.html).
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_BYTES, buildStreetPoints, serialise } from '../../scripts/street-points.mjs';
import { splitHouseNumbers, streetPoint } from '../../worker/feed/geo/streets';
import { distanceM } from '../../shared/city/geo';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('streetPoint', () => {
  it('finds the street, not the street of the same first word', () => {
    // "Jarunska obala" is the shore path beside it, 300 m away: the bare word names the street.
    const jarunska = streetPoint('JARUNSKA');
    expect(jarunska?.name).toBe('Jarunska ulica');
    expect(jarunska?.district).toBe('tresnjevka-jug');
    // The house number is not part of the name.
    expect(streetPoint('JARUNSKA 6')).toEqual(jarunska);
  });

  it('matches a street the index writes with "Ulica" in front', () => {
    expect(streetPoint('JURJA NEIDHARDTA')?.name).toBe('Ulica Jurja Neidhardta');
    expect(streetPoint('JURJA NEIDHARDTA 2-6 par')?.name).toBe('Ulica Jurja Neidhardta');
    expect(streetPoint('Ulica Božidara Rašice')?.name).toBe('Ulica Božidara Rašice');
    expect(streetPoint('BOŽIDARA RAŠICE 1')?.name).toBe('Ulica Božidara Rašice');
  });

  it('takes the settlement\'s street when a name stands in two places', () => {
    // Zagrebačka cesta runs in Zagreb and in Sesvete, 17 km apart: no settlement, no point.
    expect(streetPoint('ZAGREBAČKA CESTA')).toBeNull();
    const sesvete = streetPoint('ZAGREBAČKA CESTA 40-66 par', 'SESVETE');
    expect(sesvete?.name).toBe('Zagrebačka cesta');
    expect(sesvete?.district).toBe('sesvete');
    const zagreb = streetPoint('ZAGREBAČKA CESTA', 'ZAGREB');
    expect(zagreb?.name).toBe('Zagrebačka cesta');
    expect(distanceM(sesvete!, zagreb!)).toBeGreaterThan(10_000);
    // A settlement written in a case ending still names the settlement.
    expect(streetPoint('Zagrebačka cesta', 'Sesvetama')).toEqual(sesvete);
  });

  it('reads a street in a case ending as the street', () => {
    const aleja = streetPoint('Aleji Seljačke bune');
    expect(aleja?.name).toBe('Aleja Seljačke bune');
    expect(streetPoint('ALEJA SELJAČKE BUNE 28-40 par')).toEqual(aleja);
    // The source spells the street with a soft c; the index with a hard one.
    expect(streetPoint('Jagodišće')?.name).toBe('Jagodišče');
    expect(streetPoint('Meglenjak')?.name).toBe('Meglenjak');
  });

  it('places "Vinskoj cesti" on the Vinska cesta of Adamovec, which the index holds', () => {
    // The package expects null here ("not indexed"); the index does hold Vinska cesta, in Adamovec, and the
    // VIO notice is about that street. A correct place is not a guess (report U3-modules, decisions).
    const vinska = streetPoint('Vinskoj cesti', 'Adamovcu');
    expect(vinska?.name).toBe('Vinska cesta');
    expect(vinska!.lon).toBeGreaterThan(16.0);
    expect(vinska!.lat).toBeGreaterThan(45.85);
  });

  it('has no point for a street that stands only outside the settlement the source names', () => {
    // One Vinska cesta in the index, in Adamovec: "Vinska cesta u Sesvetama" or "u Zagrebu" is another street.
    expect(streetPoint('Vinskoj cesti', 'Sesvete')).toBeNull();
    expect(streetPoint('Vinskoj cesti', 'Zagrebu')).toBeNull();
    expect(streetPoint('Vinskoj cesti', 'Adamovcu')?.name).toBe('Vinska cesta');
    // One Jarunska ulica, in Zagreb.
    expect(streetPoint('JARUNSKA 6', 'SESVETE')).toBeNull();
    expect(streetPoint('JARUNSKA 6', 'ZAGREB')).toEqual(streetPoint('JARUNSKA'));
    // A part of Zagreb the index holds as no settlement ("u Podsusedu") is read by the city district that names it.
    for (const name of ['Aleja Seljačke bune', 'Jagodišće', 'Meglenjak']) expect(streetPoint(name, 'Podsusedu')?.district, name).toBe('podsused-vrapce');
    expect(streetPoint('JARUNSKA', 'Podsusedu')).toBeNull();
  });

  it('has no point for a street the index does not hold', () => {
    expect(streetPoint('Draga Svetojanska')).toBeNull();
    expect(streetPoint('SAVSKA CESTA I. i II. ODVOJAK', 'SESVETE')).toBeNull();
    expect(streetPoint('VUKOVDOL 1-9 obje')).toBeNull();
    expect(streetPoint('')).toBeNull();
    expect(streetPoint('12')).toBeNull();
  });

  it('never matches a bare "ulica"', () => {
    expect(streetPoint('ulica')).toBeNull();
    expect(streetPoint('Ulica')).toBeNull();
  });

  it('keeps a number that starts the name and an ordinal inside it', () => {
    expect(splitHouseNumbers('1. Zagrebački odvojak')).toEqual({ name: '1. Zagrebački odvojak', numbers: '' });
    expect(splitHouseNumbers('SAVSKA CESTA I. i II. ODVOJAK')).toEqual({ name: 'SAVSKA CESTA I. i II. ODVOJAK', numbers: '' });
    expect(splitHouseNumbers('GREDICE 98-do kraja par, 135-do kraja nep')).toEqual({ name: 'GREDICE', numbers: '98-do kraja par, 135-do kraja nep' });
    expect(splitHouseNumbers('BRESTOVEČKA 1/A')).toEqual({ name: 'BRESTOVEČKA', numbers: '1/A' });
    expect(splitHouseNumbers('Nova ulica bb')).toEqual({ name: 'Nova ulica', numbers: 'bb' });
    expect(streetPoint('Aleja pomoraca bb')?.name).toBe('Aleja pomoraca');
  });
});

describe('worker/data/street-points.json', () => {
  it('is what scripts/street-points.mjs writes from the street index, byte for byte', () => {
    const fresh = serialise(buildStreetPoints(JSON.parse(read('app/public/data/streets-geo.json'))));
    expect(read('worker/data/street-points.json')).toBe(fresh);
  });

  it('carries the name, settlement, point and box of every street, inside its budget', () => {
    const size = statSync(new URL('../../worker/data/street-points.json', import.meta.url)).size;
    expect(size).toBeLessThanOrEqual(240_000);
    expect(MAX_BYTES).toBeLessThanOrEqual(240_000);
    const wire = JSON.parse(read('worker/data/street-points.json')) as Record<string, unknown[]>;
    const streets = JSON.parse(read('app/public/data/streets-geo.json')) as { streets: { name: unknown[] } };
    for (const column of ['name', 'settlement', 'lon', 'lat', 'bbox']) expect(wire[column], column).toHaveLength(streets.streets.name.length);
    expect(Object.keys(wire).sort()).toEqual([
      'attribution', 'bbox', 'lat', 'licence', 'lon', 'name', 'origin', 'pointScale', 'settlement', 'settlements', 'shapeScale', 'source', 'version',
    ]);
    // Sorted by name, so two builds agree.
    const names = wire.name as string[];
    expect(names.every((name, i) => i === 0 || names[i - 1]! <= name)).toBe(true);
  });
});
