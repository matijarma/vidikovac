import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { crc32, deflateRawSync, gzipSync } from 'node:zlib';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RUN_GAP_S, SLOTS, SLOT_SEC, buildExpectIndex, calendarDates, main, mergeRuns } from '../../scripts/gtfs-expect.mjs';
import { decodeExpectIndex, expectedAt } from '../../shared/motion/expect';

// scripts/gtfs-expect.mjs cuts the declared fleet out of ZET's static GTFS:
// per service, per five-minute slot of a 31-hour service day, the vehicle runs
// (blocks, split at a pull-in longer than the mode's parked limit) in service
// by mode and the trips in service per route, plus the services of every date
// the calendar names. Here on a mini feed with two services, a night trip past
// 24:00 and a calendar_dates removal, then on the committed artefact.

interface ZipInput {
  name: string;
  data: string;
}

/** A valid stored-or-deflated zip with no library (the shape of gtfs-trips.test.ts's helper). */
function makeZip(files: ZipInput[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const raw = enc.encode(f.data);
    const packed = new Uint8Array(deflateRawSync(raw));
    const crc = crc32(raw);
    const local = new Uint8Array(30 + nameBytes.length + packed.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, packed.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(packed, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
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
  const parts = [...locals, ...centrals, eocd];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

// Two services: `wd` Monday to Friday 5 to 9 October 2026, `we` on the
// weekend after. Thursday 8 October is a holiday: calendar_dates removes `wd`
// and adds `we`. On `wd`, tram block BT1 runs t1 07:00-07:20 and t2 07:30-07:50
// (a layover between), bus block BB1 runs b1 07:02-07:12 (its rows out of
// order in the file), the night tram block BN1 runs n1 24:30-25:10. On `we`,
// BW1 runs w1 09:00-09:30 and w2 (no block_id: its own run) 10:00-10:04.
const ROUTES_TXT = 'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type\nT,0,1,Tram,,0\nB,0,101,Bus,,3\nN,0,31,Noćni,,0\n';
const TRIPS_TXT =
  'route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n' +
  'T,wd,t1,,0,BT1,\nT,wd,t2,,1,BT1,\nB,wd,b1,,0,BB1,\nN,wd,n1,,0,BN1,\nT,we,w1,,0,BW1,\nB,we,w2,,0,,\n';
const row = (trip: string, arr: string, dep: string, stop: string, seq: number) => `${trip},${arr},${dep},${stop},${seq}\n`;
const STOP_TIMES_TXT =
  'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n' +
  row('t1', '07:00:00', '07:00:00', 'A', 1) + row('t1', '07:10:00', '07:10:30', 'M', 2) + row('t1', '07:20:00', '07:20:00', 'Z', 3) +
  row('t2', '07:30:00', '07:30:00', 'Z', 1) + row('t2', '07:50:00', '07:50:00', 'A', 2) +
  row('b1', '07:12:00', '07:12:00', 'Q', 2) + row('b1', '07:02:00', '07:02:00', 'P', 1) +
  row('n1', '24:30:00', '24:30:00', 'A', 1) + row('n1', '25:10:00', '25:10:00', 'Z', 2) +
  row('w1', '09:00:00', '09:00:00', 'A', 1) + row('w1', '09:30:00', '09:30:00', 'Z', 2) +
  row('w2', '10:00:00', '10:00:00', 'P', 1) + row('w2', '10:04:00', '10:04:00', 'Q', 2);
const CALENDAR_TXT =
  'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
  'wd,1,1,1,1,1,0,0,20261005,20261009\nwe,0,0,0,0,0,1,1,20261010,20261011\n';
const CALENDAR_DATES_TXT = 'service_id,date,exception_type\nwd,20261008,2\nwe,20261008,1\n';
const FEED_INFO_TXT = 'feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version\nZET,https://www.zet.hr,hr,20261005,20261011,000777\n';

function miniZip(stopTimes = STOP_TIMES_TXT): Uint8Array<ArrayBuffer> {
  return makeZip([
    { name: 'routes.txt', data: ROUTES_TXT },
    { name: 'trips.txt', data: TRIPS_TXT },
    { name: 'stop_times.txt', data: stopTimes },
    { name: 'calendar.txt', data: CALENDAR_TXT },
    { name: 'calendar_dates.txt', data: CALENDAR_DATES_TXT },
    { name: 'feed_info.txt', data: FEED_INFO_TXT },
  ]);
}

const slot = (hh: number, mm = 0) => (hh * 60 + mm) / 5;

describe('the expectation builder on a mini feed', () => {
  it('writes the documented shape: version, feed, slots, services, calendar, routes, blocks by mode, trips by route', async () => {
    const { artefact, report } = await buildExpectIndex(miniZip(), { builtAt: '2026-10-01T00:00:00.000Z' });
    expect(artefact).toMatchObject({ version: 1, feedVersion: '000777', builtAt: '2026-10-01T00:00:00.000Z', slotSec: 300, slots: 372 });
    expect(SLOTS * SLOT_SEC).toBe(31 * 3600);
    expect(artefact.services).toEqual(['wd', 'we']);
    expect(artefact.routes).toEqual({ id: ['B', 'N', 'T'], type: [3, 0, 0] });
    // The holiday: Thursday runs the weekend service, and every date between
    // the first and the last the calendar names is listed.
    expect(artefact.calendar).toEqual({
      '2026-10-05': [0], '2026-10-06': [0], '2026-10-07': [0], '2026-10-08': [1], '2026-10-09': [0], '2026-10-10': [1], '2026-10-11': [1],
    });
    expect(report).toMatchObject({ trips: 6, services: 2, blocks: 5, runs: 5, mixedRuns: 0, firstDate: '2026-10-05', lastDate: '2026-10-11', dates: 7 });
    for (const service of artefact.services) {
      for (const mode of ['all', 'tram', 'bus'] as const) expect(artefact.blocks[service][mode]).toHaveLength(SLOTS);
      for (const counts of Object.values(artefact.trips[service])) expect(counts).toHaveLength(SLOTS);
    }
  });

  // A block is one vehicle, but not one run: a gap between two consecutive
  // trips longer than the mode's parked limit (RUN_GAP_S: 30 min tram, 46 min
  // bus, upgrade decision 29) is a pull-in, and the next trip starts a new run.
  // Trip t2 of tram block BT1 is moved so that the gap after t1 (ends 07:20)
  // is 29 min, then 31 min; bus block BB1 gets a second trip 45 min after b1.
  describe('ends a vehicle run at a pull-in, by mode', () => {
    const t2At = (start: string, end: string) =>
      STOP_TIMES_TXT.replace(row('t2', '07:30:00', '07:30:00', 'Z', 1), row('t2', start, start, 'Z', 1)).replace(row('t2', '07:50:00', '07:50:00', 'A', 2), row('t2', end, end, 'A', 2));

    it('a tram block whose trips are 29 min apart is one run, layover included, by mode, with a trip per route over its own span', async () => {
      expect(RUN_GAP_S).toEqual({ tram: 1800, bus: 2760 });
      const { artefact, report } = await buildExpectIndex(miniZip(t2At('07:49:00', '08:09:00')), { builtAt: '2026-10-01T00:00:00.000Z' });
      const wd = artefact.blocks.wd;
      expect(report).toMatchObject({ blocks: 5, runs: 5 });
      expect([wd.all[slot(6, 55)], wd.all[slot(7)], wd.tram[slot(7)], wd.bus[slot(7)]]).toEqual([0, 2, 1, 1]);
      // b1 07:02-07:12 meets slots 07:00, 07:05, 07:10; its rows were out of order in the file.
      expect(wd.bus.slice(slot(7), slot(7, 20))).toEqual([1, 1, 1, 0]);
      // BT1 from 07:00 to 08:09, through the 07:20-07:49 layover: every slot from 07:00 to 08:05.
      expect(wd.tram.slice(slot(7), slot(8, 15))).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
      // The trips count over their own spans: none in service during the layover.
      expect(artefact.trips.wd.T.slice(slot(7), slot(8, 15))).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0]);
      // The night tram stays on the service day that owns it, past 24:00.
      expect(wd.tram.slice(slot(24, 25), slot(25, 20))).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
      expect(artefact.trips.wd.N[slot(24, 30)]).toBe(1);
      expect(wd.all.reduce((n: number, c: number) => n + c, 0)).toBe(14 + 3 + 9);
      // A trip without block_id is its own run; a four-minute trip counts in the slot it falls in.
      const we = artefact.blocks.we;
      expect(we.bus[slot(10)]).toBe(1);
      expect(we.bus[slot(10, 5)]).toBe(0);
      expect(we.tram.slice(slot(9), slot(9, 35))).toEqual([1, 1, 1, 1, 1, 1, 1]);
      expect(Object.keys(artefact.trips.we)).toEqual(['B', 'T']);
    });

    it('a tram block whose trips are 31 min apart is two runs: the pull-in between them is not service', async () => {
      const { artefact, report } = await buildExpectIndex(miniZip(t2At('07:51:00', '08:11:00')), { builtAt: '2026-10-01T00:00:00.000Z' });
      const wd = artefact.blocks.wd;
      expect(report).toMatchObject({ blocks: 5, runs: 6 });
      // t1 07:00-07:20 meets the slots to 07:20; t2 07:51-08:11 those from 07:50; nothing in between.
      expect(wd.tram.slice(slot(7), slot(8, 15))).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
      expect(wd.all.slice(slot(7, 25), slot(7, 50))).toEqual([0, 0, 0, 0, 0]);
      expect(wd.all.reduce((n: number, c: number) => n + c, 0)).toBe(10 + 3 + 9);
      // The trips themselves are unchanged by the split.
      expect(artefact.trips.wd.T.slice(slot(7), slot(8, 15))).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
    });

    it('a bus block whose trips are 45 min apart is one run: a bus may stand 46 min', async () => {
      const withB2 = STOP_TIMES_TXT + row('b2', '07:57:00', '07:57:00', 'Q', 1) + row('b2', '08:07:00', '08:07:00', 'P', 2);
      const trips = TRIPS_TXT + 'B,wd,b2,,1,BB1,\n';
      const zip = makeZip([
        { name: 'routes.txt', data: ROUTES_TXT },
        { name: 'trips.txt', data: trips },
        { name: 'stop_times.txt', data: withB2 },
        { name: 'calendar.txt', data: CALENDAR_TXT },
        { name: 'calendar_dates.txt', data: CALENDAR_DATES_TXT },
        { name: 'feed_info.txt', data: FEED_INFO_TXT },
      ]);
      const { artefact, report } = await buildExpectIndex(zip, { builtAt: '2026-10-01T00:00:00.000Z' });
      expect(report).toMatchObject({ trips: 7, blocks: 5, runs: 5 });
      // BB1 from 07:02 to 08:07 through the 07:12-07:57 gap: every slot from 07:00 to 08:05.
      expect(artefact.blocks.wd.bus.slice(slot(7), slot(8, 15))).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
      expect(artefact.trips.wd.B.slice(slot(7), slot(8, 15))).toEqual([1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0]);
      // The same two spans 47 min apart are two runs (mergeRuns is what the builder applies per block).
      expect(mergeRuns([{ start: 7 * 3600 + 120, end: 7 * 3600 + 720 }, { start: 7 * 3600 + 720 + 47 * 60, end: 8 * 3600 + 540 }], RUN_GAP_S.bus)).toHaveLength(2);
    });
  });

  it('refuses a trip that ends at or past 31:00, naming it', async () => {
    const late = STOP_TIMES_TXT.replace('n1,25:10:00,25:10:00,Z,2', 'n1,31:00:00,31:00:00,Z,2');
    await expect(buildExpectIndex(miniZip(late), { builtAt: 'x' })).rejects.toThrow(/trip n1 ends at 31:00, past the 31-hour service day/);
  });

  it('lists a calendar from calendar_dates alone, the way ZET publishes it (every weekday flag 0)', () => {
    const flagless = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"0_30",0,0,0,0,0,0,0,20260928,20301231\n';
    const dates = calendarDates(flagless, 'service_id,date,exception_type\n"0_30",20260928,1\n"0_30",20260930,1\n');
    expect([...dates].map(([day, set]) => [day, [...set]])).toEqual([['2026-09-28', ['0_30']], ['2026-09-29', []], ['2026-09-30', ['0_30']]]);
    expect(calendarDates(flagless, '').size).toBe(0);
  });

  it('writes the file with --zip, reads --built-at, and reports its size', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zet-expect-'));
    await writeFile(join(dir, 'feed.zip'), miniZip());
    const logs: string[] = [];
    const result = await main({ zipPath: 'feed.zip', builtAt: '2026-10-01T08:00:00Z', cwd: dir, out: 'data/zet-expect.json', log: (s: string) => logs.push(s) });
    const text = await readFile(join(dir, 'data/zet-expect.json'), 'utf8');
    expect(JSON.parse(text).builtAt).toBe('2026-10-01T08:00:00.000Z');
    expect(result.rawBytes).toBe(Buffer.byteLength(text));
    expect(result.gzipBytes).toBe(gzipSync(Buffer.from(text)).length);
    expect(logs.join('\n')).toContain('Public dataset by ZET provided under Open license');
    // The same bytes again: a build is a function of the archive and the stamp.
    await main({ zipPath: 'feed.zip', builtAt: '2026-10-01T08:00:00Z', cwd: dir, out: 'data/again.json', log: () => {} });
    expect(await readFile(join(dir, 'data/again.json'), 'utf8')).toBe(text);
  });
});

// The committed artefact, built from the archive the other ZET artefacts were
// cut from. Budget pins: at most 1 MiB raw and 120 KiB gzipped (upgrade plan
// P-U2d). Measured on feed 000396 (28 Sep 2026) with the runs split at a
// pull-in: 761,168 B raw, 38,315 B gzip, seven services, 2,299 blocks as
// 2,822 runs, calendar 2026-09-28 to 2026-12-31.
describe('the committed zet-expect.json', () => {
  const rawText = readFileSync(new URL('../../app/public/data/zet-expect.json', import.meta.url), 'utf8');
  const raw = JSON.parse(rawText);
  const RAW_BUDGET_BYTES = 1024 * 1024;
  const GZIP_BUDGET_BYTES = 120 * 1024;

  it('is inside the budget and cut from the feed the trip index is', () => {
    const bytes = Buffer.byteLength(rawText);
    const gzipped = gzipSync(Buffer.from(rawText)).length;
    console.log(`zet-expect.json: ${bytes} B raw (budget ${RAW_BUDGET_BYTES} B), ${gzipped} B gzipped (budget ${GZIP_BUDGET_BYTES} B)`);
    expect(bytes).toBeLessThanOrEqual(RAW_BUDGET_BYTES);
    expect(gzipped).toBeLessThanOrEqual(GZIP_BUDGET_BYTES);
    const trips = JSON.parse(readFileSync(new URL('../../app/public/data/zet-trips.json', import.meta.url), 'utf8'));
    expect(raw.feedVersion).toBe(trips.feedVersion);
    expect(raw).toMatchObject({ version: 1, slotSec: SLOT_SEC, slots: SLOTS });
  });

  it('names only routes the route index knows, and splits them by the same type', () => {
    const routes = JSON.parse(readFileSync(new URL('../../app/src/data/zet-routes.json', import.meta.url), 'utf8')) as Record<string, { type: number }>;
    expect(raw.routes.id.length).toBeGreaterThan(100);
    raw.routes.id.forEach((id: string, i: number) => {
      expect(routes[id], `route ${id}`).toBeDefined();
      expect(routes[id].type, `route ${id}`).toBe(raw.routes.type[i]);
    });
    for (const byRoute of Object.values(raw.trips) as Record<string, number[]>[]) for (const id of Object.keys(byRoute)) expect(routes[id], `route ${id}`).toBeDefined();
  });

  it('declares between 250 and 500 vehicles at 07:00 on every working day it names, and a calendar without gaps', () => {
    const index = decodeExpectIndex(raw);
    expect(index.firstDate).not.toBeNull();
    const dates = [...index.calendar.keys()];
    for (let i = 1; i < dates.length; i++) expect(Date.parse(dates[i]) - Date.parse(dates[i - 1]), dates[i]).toBe(86_400_000);
    let weekdays = 0;
    for (const date of dates) {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      const services = index.calendar.get(date)!;
      const at7 = services.reduce((n, service) => n + index.blocks.get(service)!.all[slot(7)], 0);
      // A holiday on a working day runs the Sunday service (1 Nov, 18 Nov, 25 and 26 Dec).
      if (at7 < 250) continue;
      weekdays++;
      expect(at7, date).toBeLessThanOrEqual(500);
      // What expectedAt answers at 07:02 Zagreb on that date is the same service day's slot.
      const nowSec = Date.parse(`${date}T07:02:00+0${date < '2026-10-25' ? 2 : 1}:00`) / 1000;
      expect(expectedAt(index, nowSec).blocks.all, date).toBe(at7);
    }
    expect(weekdays).toBeGreaterThan(40);
  });
});
