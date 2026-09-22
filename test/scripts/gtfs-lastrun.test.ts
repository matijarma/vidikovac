import { describe, expect, it, vi } from 'vitest';
import { crc32, deflateRawSync } from 'node:zlib';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HORIZON_DAYS,
  OUTPUT_DIR,
  SOURCE,
  buildLastRun,
  formatGtfsTime,
  main,
  parseGtfsTime,
  servicesByDate,
} from '../../scripts/gtfs-lastrun.mjs';
import { lastDeparture, type LastRunSnapshot } from '../../app/src/core/lastrun';

// scripts/gtfs-lastrun.mjs cuts ZET's static GTFS into one small JSON per stop
// (app/public/data/lastrun/<stopId>.json): for every line that departs from
// the stop, the latest departure per GTFS service date over 21 days from the
// run plus the service day before it. GTFS's own clock is kept ("24:15" on a
// Saturday is Sunday 00:15; the app's loader resolves it), the trip's last
// stop is an arrival and never counts, and a no-pickup row is not a departure.

interface ZipInput { name: string; data: string; method: 0 | 8 }

/** Builds a valid zip (local headers, central directory, EOCD) with no library; the helper gtfs-routes.test.ts and gtfs-shapes.test.ts use. */
function makeZip(files: ZipInput[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const raw = enc.encode(f.data);
    const packed = f.method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const crc = crc32(raw);

    const local = new Uint8Array(30 + nameBytes.length + packed.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, f.method, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, packed.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(packed, 30 + nameBytes.length);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, f.method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const chunk of [...locals, ...centrals, eocd]) {
    out.set(chunk, p);
    p += chunk.length;
  }
  return out;
}

const CALENDAR = `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
WD,1,1,1,1,1,0,0,20260901,20261231
SAT,0,0,0,0,0,1,0,20260901,20261231
`;
// A weekday dropped (2), the Saturday timetable added on it (1), and a service that exists only here.
const CALENDAR_DATES = `service_id,date,exception_type
WD,20260916,2
SAT,20260916,1
HOL,20260917,1
`;
const TRIPS = `route_id,service_id,trip_id,trip_headsign,direction_id
6,WD,t6wd1,Sopot,0
6,WD,t6wd2,Sopot,0
6,SAT,t6sat,Sopot,0
11,WD,t11wd,Dubec,0
11,HOL,t11hol,Dubec,0
`;
// Rows deliberately out of trip and sequence order; S2 is every trip's terminus.
const STOP_TIMES = `trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type
t6wd1,24:05:00,24:05:00,S2,2,0
t6wd1,23:50:00,23:50:00,S1,1,0
t6wd2,22:10:00,22:10:00,S1,1,0
t6wd2,22:25:00,22:25:00,S2,2,0
t6sat,24:15:00,24:15:00,S1,1,0
t6sat,24:30:00,24:30:00,S2,2,0
t11wd,21:10:00,21:10:00,S2,3,0
t11wd,21:00:00,21:00:00,S1,1,0
t11wd,21:04:00,21:04:00,S3,2,0
t11hol,20:00:00,20:00:00,S1,1,1
t11hol,20:05:00,20:05:00,S3,2,0
t11hol,20:10:00,20:10:00,S2,3,0
`;
const FEED_INFO = `feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version
"ZET","http://www.zet.hr","hr",20260901,20301231,"000395"
`;

function feed(): Uint8Array<ArrayBuffer> {
  return makeZip([
    { name: 'calendar.txt', data: CALENDAR, method: 8 },
    { name: 'calendar_dates.txt', data: CALENDAR_DATES, method: 0 },
    { name: 'trips.txt', data: TRIPS, method: 8 },
    { name: 'stop_times.txt', data: STOP_TIMES, method: 8 },
    { name: 'feed_info.txt', data: FEED_INFO, method: 8 },
  ]);
}

const TODAY = '2026-09-14'; // Monday, the run's Zagreb date
const GENERATED_AT = '2026-09-14T04:00:00.000Z';
const STOP_IDS = ['S1', 'S2', 'S3', 'S9'];

describe('GTFS time', () => {
  it('parses HH:MM:SS into seconds, hours past 24 included, and formats seconds back to GTFS HH:MM', () => {
    expect(parseGtfsTime('23:50:00')).toBe(23 * 3600 + 50 * 60);
    expect(parseGtfsTime('24:05:00')).toBe(24 * 3600 + 5 * 60);
    expect(parseGtfsTime('29:38:30')).toBe(29 * 3600 + 38 * 60 + 30);
    expect(parseGtfsTime('7:05:00')).toBe(7 * 3600 + 5 * 60);
    expect(parseGtfsTime('')).toBeNull();
    expect(parseGtfsTime('24:05')).toBeNull();
    expect(formatGtfsTime(24 * 3600 + 5 * 60)).toBe('24:05');
    expect(formatGtfsTime(7 * 3600 + 5 * 60 + 59)).toBe('07:05');
  });
});

describe('servicesByDate', () => {
  it('resolves weekday flags within the calendar range, then applies added and removed dates', () => {
    const days = ['2026-09-13', '2026-09-14', '2026-09-16', '2026-09-17', '2026-09-19', '2027-01-04'];
    const active = servicesByDate(CALENDAR, CALENDAR_DATES, days);
    expect([...active.get('2026-09-13')!]).toEqual([]); // Sunday: nothing runs
    expect([...active.get('2026-09-14')!]).toEqual(['WD']);
    expect([...active.get('2026-09-16')!]).toEqual(['SAT']); // WD removed, SAT added
    expect([...active.get('2026-09-17')!].sort()).toEqual(['HOL', 'WD']);
    expect([...active.get('2026-09-19')!]).toEqual(['SAT']);
    expect([...active.get('2027-01-04')!]).toEqual([]); // past end_date
  });
  it('works without a calendar.txt, as ZET publishes: every service comes from calendar_dates', () => {
    const active = servicesByDate('', CALENDAR_DATES, ['2026-09-16', '2026-09-17']);
    expect([...active.get('2026-09-16')!]).toEqual(['SAT']);
    expect([...active.get('2026-09-17')!]).toEqual(['HOL']);
  });
});

describe('buildLastRun', () => {
  it('writes the latest departure per line and service date for every requested stop, in GTFS hours', async () => {
    const files = await buildLastRun(feed(), { stopIds: STOP_IDS, today: TODAY, generatedAt: GENERATED_AT });
    expect([...files.keys()].sort()).toEqual(STOP_IDS);
    const s1 = files.get('S1')!;
    expect(s1.source).toBe(SOURCE);
    expect(s1.generatedAt).toBe(GENERATED_AT);
    expect(Object.keys(s1.routes)).toEqual(['6', '11']);
    expect(s1.routes['6']['2026-09-14']).toBe('23:50'); // the later of two weekday trips
    expect(s1.routes['6']['2026-09-15']).toBe('23:50');
    expect(s1.routes['6']['2026-09-16']).toBe('24:15'); // the Saturday timetable on a dropped weekday
    expect(s1.routes['6']['2026-09-19']).toBe('24:15'); // the Saturday-only trip, kept as GTFS writes it
    expect(s1.routes['6']['2026-09-13']).toBeUndefined(); // Sunday: no service
    expect(s1.routes['6']['2026-09-20']).toBeUndefined();
    expect(s1.routes['11']['2026-09-14']).toBe('21:00');
    expect(s1.routes['11']['2026-09-16']).toBeUndefined(); // no Saturday trip on line 11
  });
  it('covers the service day before the run and 21 days from it, in order, and stops there', async () => {
    const files = await buildLastRun(feed(), { stopIds: ['S1'], today: TODAY, generatedAt: GENERATED_AT });
    const days = Object.keys(files.get('S1')!.routes['6']);
    expect(days[0]).toBe('2026-09-14'); // Sunday 13. 9. has no service, so the first key is Monday
    expect(days.at(-1)).toBe('2026-10-03'); // the last Saturday inside 13. 9. + 21 days
    expect(HORIZON_DAYS).toBe(21);
    expect(days.every((d) => d >= '2026-09-13' && d <= '2026-10-04')).toBe(true);
  });
  it('never counts a trip’s last stop (an arrival) nor a no-pickup row as a departure', async () => {
    const files = await buildLastRun(feed(), { stopIds: STOP_IDS, today: TODAY, generatedAt: GENERATED_AT });
    expect(files.get('S2')!.routes).toEqual({}); // every trip ends at S2
    expect(files.get('S1')!.routes['11']['2026-09-17']).toBe('21:00'); // HOL's 20:00 at S1 is pickup_type 1
    expect(files.get('S3')!.routes['11']['2026-09-17']).toBe('21:04'); // HOL's 20:05 at S3 is a real departure but earlier
    expect(files.get('S9')!.routes).toEqual({}); // a stop no trip serves still gets its file
  });
  it('a 24:15 departure on Saturday’s service date resolves to Sunday 00:15 through the app’s loader', async () => {
    const files = await buildLastRun(feed(), { stopIds: ['S1'], today: TODAY, generatedAt: GENERATED_AT });
    const file = files.get('S1')!;
    const snapshot: LastRunSnapshot = { status: 'live', fetchedAt: GENERATED_AT, sourceUpdatedAt: file.generatedAt, validUntil: file.validUntil, routes: file.routes };
    expect(lastDeparture(snapshot, '6', Date.parse('2026-09-19T21:00:00Z'))).toEqual({ at: Date.parse('2026-09-19T22:15:00Z') }); // Sat 23:00 → Sun 00:15 CEST
    expect(lastDeparture(snapshot, '6', Date.parse('2026-09-19T22:10:00Z'))).toEqual({ at: Date.parse('2026-09-19T22:15:00Z') }); // Sun 00:10: still Saturday’s
  });
  it('validUntil is the last instant the file speaks for: the latest resolved departure, or the window’s end for a stop with none', async () => {
    const files = await buildLastRun(feed(), { stopIds: STOP_IDS, today: TODAY, generatedAt: GENERATED_AT });
    expect(files.get('S1')!.validUntil).toBe('2026-10-03T22:15:00.000Z'); // Sat 3. 10. "24:15" = Sun 4. 10. 00:15 CEST
    expect(files.get('S2')!.validUntil).toBe('2026-10-04T22:00:00.000Z'); // midnight ending Sun 4. 10. CEST
  });
  it('keeps every file small: a few kilobytes at most', async () => {
    const files = await buildLastRun(feed(), { stopIds: STOP_IDS, today: TODAY, generatedAt: GENERATED_AT });
    for (const file of files.values()) expect(JSON.stringify(file).length).toBeLessThan(4096);
  });
  it('refuses an archive without stop_times.txt', async () => {
    const zip = makeZip([{ name: 'trips.txt', data: TRIPS, method: 8 }]);
    await expect(buildLastRun(zip, { stopIds: ['S1'], today: TODAY, generatedAt: GENERATED_AT })).rejects.toThrow(/stop_times\.txt/);
  });
});

describe('main', () => {
  async function scratch(): Promise<{ cwd: string; out: string; stopsPath: string }> {
    const cwd = await mkdtemp(join(tmpdir(), 'vidikovac-lastrun-'));
    const stopsPath = 'stops.json';
    await writeFile(join(cwd, stopsPath), JSON.stringify(STOP_IDS.map((id) => ({ id, name: id, lon: 16, lat: 45.8, routes: [] }))));
    return { cwd, out: 'lastrun', stopsPath };
  }

  it('downloads the feed the way gtfs-shapes does, writes one file per stop from stops.json, removes files of stops no longer listed and reports', async () => {
    const { cwd, out, stopsPath } = await scratch();
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(cwd, out), { recursive: true });
    await writeFile(join(cwd, out, 'GONE_1.json'), '{}');
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)['user-agent']).toMatch(/^Vidikovac\//);
      return new Response(feed(), { status: 200, headers: { 'last-modified': 'Thu, 10 Sep 2026 03:00:00 GMT' } });
    });
    const log = vi.fn();
    const result = await main({ fetchImpl: fetchImpl as unknown as typeof fetch, out, stopsPath, cwd, log, now: () => new Date('2026-09-14T04:00:00Z') });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://www.zet.hr/gtfs-scheduled/latest');
    expect((await readdir(join(cwd, out))).sort()).toEqual(['S1.json', 'S2.json', 'S3.json', 'S9.json']);
    const s1 = JSON.parse(await readFile(join(cwd, out, 'S1.json'), 'utf8'));
    expect(s1).toMatchObject({ generatedAt: '2026-09-14T04:00:00.000Z', source: 'ZET GTFS' });
    expect(s1.routes['6']['2026-09-19']).toBe('24:15');
    expect(await readFile(join(cwd, out, 'S1.json'), 'utf8')).toMatch(/\n$/);
    expect(result).toMatchObject({ stops: 4, written: 4, removed: 1, feedVersion: '000395' });
    expect(result.bytes).toBeGreaterThan(0);
    expect(log.mock.calls.flat().join('\n')).toMatch(/4 stops/);
  });
  it('reads a local archive when given a path and never downloads', async () => {
    const { cwd, out, stopsPath } = await scratch();
    await writeFile(join(cwd, 'zet.zip'), feed());
    const fetchImpl = vi.fn();
    const result = await main({ fetchImpl: fetchImpl as unknown as typeof fetch, zipPath: 'zet.zip', out, stopsPath, cwd, log: () => {}, now: () => new Date('2026-09-14T04:00:00Z') });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.written).toBe(4);
  });
  it('fails loudly on a failed download', async () => {
    const { cwd, out, stopsPath } = await scratch();
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 }));
    await expect(main({ fetchImpl: fetchImpl as unknown as typeof fetch, out, stopsPath, cwd, log: () => {} })).rejects.toThrow(/HTTP 503/);
  });
  it('names the output directory the app fetches from', () => {
    expect(OUTPUT_DIR).toBe('app/public/data/lastrun');
  });
});
