// shared/city/osm-hours.ts: which places near a point are open now (docs/upgrade-2026-10-plan/U3.md O3).
// A small file written here pins the rules (past midnight, 24/7, a closed day, the 30-minute margin, a
// holiday, a change of clock); the committed file is decoded once to prove the two formats agree.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeOsmHours, openPlacesNear, osmVenues, type OpenKind, type OsmHoursFile } from '../../shared/city/osm-hours';

/** Trg bana J. Jelačića. */
const HERE = { lon: 15.97726, lat: 45.81286 };
const EVERY = (field: string) => Array(7).fill(field).join('|');

function file(records: { name: string; kind: OpenKind | 'venue'; lon: number; lat: number; week: string | null }[]): OsmHoursFile {
  const kinds = ['ljekarna', 'kafic', 'pekara', 'bar', 'trgovina', 'venue'] as const;
  const origin: [number, number] = [1_587_000, 4_572_000];
  let [x, y] = origin;
  const out: OsmHoursFile = {
    version: 1, builtAt: '2026-09-29T16:00:00Z', osmDate: '2026-09-28T20:23:05Z', licence: 'ODbL 1.0', attribution: '© OpenStreetMap contributors',
    count: records.filter((r) => r.week !== null).length, venues: records.filter((r) => r.week === null).length, dropped: 0, origin,
    kinds, name: [], kind: [], lon: [], lat: [], week: [],
  };
  for (const r of records) {
    const lon = Math.round(r.lon * 1e5), lat = Math.round(r.lat * 1e5);
    (out.name as string[]).push(r.name);
    (out.kind as number[]).push(kinds.indexOf(r.kind as (typeof kinds)[number]));
    (out.lon as number[]).push(lon - x);
    (out.lat as number[]).push(lat - y);
    (out.week as (string | null)[]).push(r.week);
    x = lon; y = lat;
  }
  return out;
}

const near = (dLon: number) => ({ lon: HERE.lon + dLon, lat: HERE.lat });
const INDEX = decodeOsmHours(file([
  { name: 'Noćna ljekarna', kind: 'ljekarna', ...near(0.001), week: EVERY('0700-0100') },
  { name: 'Uvijek otvoreno', kind: 'kafic', ...near(0.002), week: EVERY('0000-2400') },
  { name: 'Pekara radnim danom', kind: 'pekara', ...near(0.003), week: '0600-2000|0600-2000|0600-2000|0600-2000|0600-2000||' },
  { name: 'Bar dvije smjene', kind: 'bar', ...near(0.004), week: EVERY('1000-1400,1400-2300') },
  { name: 'Subotnja noć', kind: 'bar', ...near(0.005), week: '|||||2200-0400|' },
  { name: 'Daleka trgovina', kind: 'trgovina', lon: 16.1, lat: 45.85, week: EVERY('0000-2300') },
  { name: 'Galerija bez sati', kind: 'venue', ...near(0.001), week: null },
]));
const open = (iso: string, holiday = false) =>
  Object.fromEntries(openPlacesNear(INDEX, HERE, 2_000, Date.parse(iso), holiday).map((p) => [p.name, new Date(p.closesAt).toISOString()]));

describe('openPlacesNear', () => {
  it('decodes a well-formed file and refuses a foreign one', () => {
    expect(INDEX?.size).toBe(7);
    expect(decodeOsmHours({ version: 2 })).toBeNull();
    expect(decodeOsmHours('<!doctype html>')).toBeNull();
    const broken = file([{ name: 'X', kind: 'kafic', ...near(0), week: '0700-2500||||||' }]);
    expect(decodeOsmHours(broken)).toBeNull();
    expect(openPlacesNear(null, HERE, 2_000, Date.parse('2026-09-29T10:00:00Z'), false)).toEqual([]);
  });

  it('counts yesterday\'s range that runs past midnight, and lists the nearest first', () => {
    // Tuesday 29 September 2026, 00:20 in Zagreb (CEST): Monday's 07:00-01:00 is still open.
    expect(open('2026-09-28T22:20:00Z')).toEqual({ 'Noćna ljekarna': '2026-09-28T23:00:00.000Z' });
    // Tuesday 23:00: today's range runs to Wednesday 01:00.
    const late = openPlacesNear(INDEX, HERE, 2_000, Date.parse('2026-09-29T21:00:00Z'), false);
    expect(late.map((p) => [p.name, new Date(p.closesAt).toISOString()])).toEqual([['Noćna ljekarna', '2026-09-29T23:00:00.000Z']]);
    expect(late[0]).toMatchObject({ kind: 'ljekarna', id: expect.stringMatching(/^osm-[0-9a-f]{16}$/) });
  });

  it('keeps a place out once it closes within 30 minutes', () => {
    // Tuesday 00:31: Monday's range closes at 01:00, 29 minutes away.
    expect(open('2026-09-28T22:31:00Z')).toEqual({});
    // Tuesday 22:30: the bar closes at 23:00, exactly 30 minutes away, and stays.
    expect(open('2026-09-29T20:30:00Z')).toMatchObject({ 'Bar dvije smjene': '2026-09-29T21:00:00.000Z' });
  });

  it('never lists a 24/7 place (no closing time to say), a closed day or a venue without hours', () => {
    // Saturday 3 October, 11:00: the bakery is closed on Saturdays.
    const saturday = open('2026-10-03T09:00:00Z');
    expect(Object.keys(saturday).sort()).toEqual(['Bar dvije smjene', 'Noćna ljekarna']);
  });

  it('joins ranges that touch into one stretch', () => {
    // Tuesday 12:00: 10:00-14:00 and 14:00-23:00 are one opening, until 23:00.
    expect(open('2026-09-29T10:00:00Z')['Bar dvije smjene']).toBe('2026-09-29T21:00:00.000Z');
  });

  it('keeps to the radius', () => {
    expect(Object.keys(open('2026-09-29T10:00:00Z'))).not.toContain('Daleka trgovina');
  });

  it('says nothing on a holiday', () => {
    expect(open('2026-09-29T10:00:00Z', true)).toEqual({});
  });

  it('closes by the Zagreb clock across the end of summer time', () => {
    // Sunday 25 October 2026, 01:30 CEST: Saturday's 22:00-04:00 closes at 04:00 CET, after the clocks go back.
    expect(open('2026-10-24T23:30:00Z')).toMatchObject({ 'Subotnja noć': '2026-10-25T03:00:00.000Z' });
  });
});

describe('the committed file', () => {
  it('decodes, and yields its venue names for the gazetteer', () => {
    const raw = JSON.parse(readFileSync(new URL('../../app/public/data/osm-hours.json', import.meta.url), 'utf8')) as OsmHoursFile;
    const index = decodeOsmHours(raw);
    expect(index?.size).toBe(raw.count + raw.venues);
    expect(index).toMatchObject({ builtAt: raw.builtAt, osmDate: raw.osmDate });
    const venues = osmVenues(index);
    expect(venues.length).toBeGreaterThanOrEqual(raw.venues);
    expect(venues.some((v) => v.name === 'Močvara')).toBe(true);
    // A Tuesday noon at the square: something is open, each a real kind, each at least 30 minutes from closing.
    const noon = Date.parse('2026-09-29T10:00:00Z');
    const places = openPlacesNear(index, HERE, 2_182, noon, false);
    expect(places.length).toBeGreaterThan(20);
    expect(places.every((p) => p.closesAt - noon >= 30 * 60_000)).toBe(true);
  });
});
