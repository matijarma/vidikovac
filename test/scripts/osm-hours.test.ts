// scripts/osm-hours.mjs and scripts/opening-hours.mjs: the OpenStreetMap opening-hours
// extract (docs/upgrade-2026-10-plan/U3.md O2). The Overpass fixture is built through
// --input (the Geofabrik PBF is 200 MB and stays in .cache/osm/); the parser is pinned on
// the forms Zagreb's data carries; the committed app/public/data/osm-hours.json is held to
// its budgets and its floor.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  BBOX,
  MAX_BYTES,
  MAX_GZIP_BYTES,
  MIN_COUNT,
  OPEN_KINDS as SCRIPT_KINDS,
  OUTPUT_PATH,
  main,
  overpassElements,
} from '../../scripts/osm-hours.mjs';
import { parseOpeningHours, weekString } from '../../scripts/opening-hours.mjs';
import { OPEN_KINDS, type OsmHoursFile } from '../../shared/city/osm-hours';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = 'test/fixtures/osm-hours-overpass.json';
const quiet = () => {};
const week = (value: string) => {
  const parsed = parseOpeningHours(value);
  return 'days' in parsed && parsed.days ? weekString(parsed.days) : `dropped: ${parsed.reason}`;
};

async function buildFixture() {
  const out = join(await mkdtemp(join(tmpdir(), 'osm-hours-')), 'osm-hours.json');
  const result = await main({ argv: ['--input', FIXTURE, '--out', out, '--built-at', '2026-09-29T16:00:00Z'], cwd: ROOT, log: quiet });
  const file = JSON.parse(await readFile(out, 'utf8')) as OsmHoursFile;
  return { result, file };
}

/** The records of a file, coordinates back in degrees. */
function records(file: OsmHoursFile) {
  let lon = file.origin[0], lat = file.origin[1];
  return file.name.map((name, i) => {
    lon += file.lon[i]; lat += file.lat[i];
    return { name, kind: file.kinds[file.kind[i]], lon: lon / 1e5, lat: lat / 1e5, week: file.week[i] };
  });
}

describe('opening_hours subset parser', () => {
  it.each([
    ['Mo-Fr 08:00-19:00; Sa 08:00-12:00', '0800-1900|0800-1900|0800-1900|0800-1900|0800-1900|0800-1200|'],
    ['Mo-Th 07:00-01:00', '0700-0100|0700-0100|0700-0100|0700-0100|||'],
    ['24/7', Array(7).fill('0000-2400').join('|')],
    ['11:00-22:00', Array(7).fill('1100-2200').join('|')],
    ['06:00-18:00,20:00-23:00', Array(7).fill('0600-1800,2000-2300').join('|')],
    ['Mo-Tu,We,Th,Su 06:00-00:00; Fr-Sa 06:00-01:00', '0600-2400|0600-2400|0600-2400|0600-2400|0600-0100|0600-0100|0600-2400'],
    ['Mo, We, Fr 12:00-19:00; Tu, Th 08:00-15:00, Sa,Su,PH off', '1200-1900|0800-1500|1200-1900|0800-1500|1200-1900||'],
    // ',' before a weekday is an additional rule: Friday keeps its day and gains the night.
    ['Mo-Fr 10:00-16:00, Fr,Sa 23:00-07:00', '1000-1600|1000-1600|1000-1600|1000-1600|1000-1600,2300-0700|2300-0700|'],
    // ';' replaces the days it names; PH rules are ignored.
    ['Mo-Su 08:00-20:00; Su 09:00-13:00; PH off', '0800-2000|0800-2000|0800-2000|0800-2000|0800-2000|0800-2000|0900-1300'],
    ['Fr-Mo 10:00-12:00', '1000-1200||||1000-1200|1000-1200|1000-1200'],
    ['Mo-Fr 07:00-21:00, Sa 07:00-15:00, Su closed', '0700-2100|0700-2100|0700-2100|0700-2100|0700-2100|0700-1500|'],
    ['Mo-Fr 7:30-20:00; Sa 7:30-15:00; Su Off', '0730-2000|0730-2000|0730-2000|0730-2000|0730-2000|0730-1500|'],
  ])('%s', (value, expected) => {
    expect(week(value)).toBe(expected);
  });

  it.each([
    ['Mo-Sa 07:00-22:00; Su 08:00-21:00 "samo neke"', 'comment, nth weekday or group'],
    ['Mo, We, Fr 08:00-14:00; Sa[1,3] 08:00-14:00', 'comment, nth weekday or group'],
    ['Jan-Dec Mo-Sa 08:00-23:00', 'month or date'],
    ['Mar-Jun: Mo-Fr 08:00-18:00', 'month or date'],
    ['-22:00', 'syntax'],
    ['Mo-Fr 08:00-16:00 || "po dogovoru"', 'comment, nth weekday or group'],
    ['Mo-Fr 18:00+', 'open end'],
    ['Mo-Fr sunrise-sunset', 'variable or open-ended time'],
    ['Mo-Fr 08:00-26:00', 'time'],
    ['Mo-Fr', 'selector without a time'],
    ['PH off', 'holiday rules only'],
  ])('drops %s', (value, reason) => {
    expect(week(value)).toBe(`dropped: ${reason}`);
  });

  it('overrides yesterday\'s spill only for normal rules and closed days', () => {
    expect(week('Sa 16:00-03:00; Su 16:00-23:00')).toBe('|||||1600-2400|1600-2300');
    expect(week('Sa 16:00-03:00, Su 16:00-23:00')).toBe('|||||1600-0300|1600-2300');
    expect(week('Mo-Su 22:00-02:00; Tu off')).toBe('2200-2400||2200-0200|2200-0200|2200-0200|2200-0200|2200-0200');
    expect(week('Su 22:00-02:00; Mo 09:00-17:00')).toBe('0900-1700||||||2200-2400');
  });

  it.each([',Mo 08:00-12:00', 'Mo,,Tu 08:00-12:00', 'Mo, 08:00-12:00', 'Mo 08:00-12:00,,13:00-14:00', 'Mo off off', 'Mo 08:00-12:00;;Tu off'])('refuses malformed separators: %s', (value) => {
    expect(parseOpeningHours(value)).toHaveProperty('reason');
  });

  it('does not coerce a non-string source value into hours', () => {
    expect(parseOpeningHours(['24/7'])).toHaveProperty('reason');
  });
});

describe('the Overpass fixture through --input', () => {
  it('keeps the named hour kinds, drops the hard forms and counts them', async () => {
    const { result, file } = await buildFixture();
    expect(result.written).toBe(true);
    // 200 nodes: 166 hour records, one venue without hours, 10 hard opening_hours values dropped.
    expect([file.count, file.venues, file.dropped]).toEqual([166, 1, 10]);
    expect(result.reasons).toEqual({ 'month or date': 3, 'comment, nth weekday or group': 6, syntax: 1 });
    expect(file).toMatchObject({ version: 1, builtAt: '2026-09-29T16:00:00Z', osmDate: '2026-09-29T15:42:54Z', licence: 'ODbL 1.0', attribution: '© OpenStreetMap contributors' });
    const rows = records(file);
    // Past midnight: the close before the open.
    expect(rows.find((r) => r.name === "McDonald's" && r.week?.startsWith('0700-0100'))?.week)
      .toBe('0700-0100|0700-0100|0700-0100|0700-0100|0700-0300|0700-0300|0700-0100');
    // 24/7 on four hour kinds; Erste's 24/7 cash machine is not among them (a machine's hours are not a visit).
    expect(rows.filter((r) => r.week === Array(7).fill('0000-2400').join('|')).map((r) => `${r.kind} ${r.name}`).sort())
      .toEqual(['ljekarna Gradske ljekarne Dubrava', 'ljekarna Ljekarna Centar', 'pekara Dubravica', 'restoran Zdravljak Forino']);
    const sorted = rows.map((r) => r.name);
    expect(sorted).toEqual([...sorted].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it.each([
    { type: 'alien', center: { lon: 15.97, lat: 45.81 }, tags: { name: 'Proba', amenity: 'cafe' } },
    { type: 'node', lon: 15.97, lat: 45.81, tags: { name: { text: 'Proba' }, amenity: 'cafe' } },
    { type: 'node', lon: 15.97, lat: 45.81, tags: { name: 'Proba', amenity: 'cafe', opening_hours: ['24/7'] } },
    { type: 'node', lon: 15.97, tags: { name: 'Proba', amenity: 'cafe' } },
    { type: 'way', tags: { name: 'Proba', amenity: 'cafe' } },
  ])('refuses a malformed Overpass element instead of coercing or losing it: %j', (row) => {
    expect(() => overpassElements({ elements: [row] })).toThrow(/osm-hours/);
  });
});

describe('the committed app/public/data/osm-hours.json', () => {
  const raw = readFileSync(join(ROOT, OUTPUT_PATH));
  const file = JSON.parse(raw.toString('utf8')) as OsmHoursFile;

  it('stays within its budgets and above its floor', () => {
    expect(raw.length).toBeLessThanOrEqual(MAX_BYTES);
    expect(gzipSync(raw, { level: 9 }).length).toBeLessThanOrEqual(MAX_GZIP_BYTES);
    expect(file.count).toBeGreaterThanOrEqual(MIN_COUNT);
    expect(file.dropped / (file.count + file.dropped)).toBeLessThan(0.25);
  });

  it('is one well-formed ODbL file inside the Zagreb box', () => {
    expect(SCRIPT_KINDS).toEqual([...OPEN_KINDS]);
    expect(file).toMatchObject({ version: 1, licence: 'ODbL 1.0', kinds: [...OPEN_KINDS, 'venue'] });
    const n = file.name.length;
    expect(n).toBe(file.count + file.venues);
    for (const key of ['kind', 'lon', 'lat', 'week'] as const) expect(file[key]).toHaveLength(n);
    const rows = records(file);
    const [west, south, east, north] = BBOX;
    expect(rows.every((r) => r.lon >= west && r.lon <= east && r.lat >= south && r.lat <= north)).toBe(true);
    expect(rows.every((r) => (r.kind === 'venue') === (r.week === null))).toBe(true);
    expect(rows.filter((r) => r.week !== null).every((r) => /^(?:\d{4}-\d{4}(?:,\d{4}-\d{4})*)?(?:\|(?:\d{4}-\d{4}(?:,\d{4}-\d{4})*)?){6}$/.test(r.week!))).toBe(true);
  });

  it.each([
    [338800281, '0500-0100|0500-0100|0500-0100|0500-0100|0500-0100|0500-2400|0600-0100'],
    [419207575, '0700-0200|0700-0200|0700-0200|0700-0200|0700-0200|0700-2400|0800-0200'],
    [428648489, '0730-0100|0730-0100|0730-0100|0730-2400|0730-0200|0730-2400|1000-0100'],
  ])('stores the corrected overnight overrides for OSM node %i', (id, expected) => {
    const fixture = JSON.parse(readFileSync(join(ROOT, FIXTURE), 'utf8')) as {
      elements: { id: number; lon: number; lat: number; tags: { name: string; opening_hours: string } }[];
    };
    const source = fixture.elements.find((e) => e.id === id)!;
    expect(source).toBeDefined();
    const row = records(file).find((r) => r.name === source.tags.name
      && r.lon === Math.round(source.lon * 1e5) / 1e5 && r.lat === Math.round(source.lat * 1e5) / 1e5);
    expect(week(source.tags.opening_hours)).toBe(expected);
    expect(row?.week).toBe(expected);
  });
});
