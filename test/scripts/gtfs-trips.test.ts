import { describe, expect, it } from 'vitest';
import { crc32, deflateRawSync, gzipSync } from 'node:zlib';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildTripIndex,
  chainDecodeDeltas,
  chainDecodeIds,
  chainEncodeDeltas,
  chainEncodeIds,
  main,
  median,
} from '../../scripts/gtfs-trips.mjs';

interface ZipInput {
  name: string;
  data: string;
  method: 0 | 8;
}

/** Builds a valid zip (local headers, central directory, EOCD) with no library.
 *  Copied from test/scripts/gtfs-routes.test.ts's helper of the same shape. */
function makeZip(files: ZipInput[]): Uint8Array {
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
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const parts = [...locals, ...centrals, eocd];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

// A small synthetic feed built to exercise every rule in the A1 brief:
//
//  - pattern P1: route 10, direction 0, shape shp1, stops A -> B -> C.
//    Three trips (t1, t2, t3) at hours 8, 8 and 20, so band 8 gets a
//    two-sample median (even count -> lower of the two) and band 20 a
//    one-sample median, leaving every other band to fill from the nearest
//    of {8, 20} -- band 14 sits exactly between them (a tie, broken toward
//    the lower band).
//  - pattern P2: route 10, direction 1, shape '' (shapeless, like tram
//    route 1 in the real feed), stops reversed C -> B -> A. A single trip
//    (t4), so route 10 shows up in the "trips without shape" report.
//  - pattern P3: route 20, direction 0, shape shp2, stops D -> E. Three
//    trips: t5 (block BLK1, shared with t1 -- the multi-route block), t6
//    (departs past 24:00, wraps into band 1), t7 (a second band-8 sample so
//    band 8's median is a genuine two-sample pick here too).
//
// trip_headsign carries one minority spelling per multi-trip pattern
// (t3: "Centar-varijanta" against t1/t2's "Centar"; t7: "Sesvete" against
// t5/t6's "Vukomerec") so the "most common headsign" rule has real work to
// do, and P2's single trip exercises the trivial one-trip case.
const TRIPS_TXT =
  'route_id,service_id,trip_id,trip_headsign,trip_short_name,direction_id,block_id,shape_id\n' +
  '10,wd,t1,Centar,,0,BLK1,shp1\n' +
  '10,wd,t2,Centar,,0,BLK2,shp1\n' +
  '10,wd,t3,Centar-varijanta,,0,BLK3,shp1\n' +
  '10,we,t4,Ban Jelačić,,1,BLK4,\n' +
  '20,wd,t5,Vukomerec,,0,BLK1,shp2\n' +
  '20,wd,t6,Vukomerec,,0,BLK5,shp2\n' +
  '20,wd,t7,Sesvete,,0,BLK6,shp2\n';

const STOP_TIMES_HEADER = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type,shape_dist_traveled\n';

function stopTimeRow(tripId: string, arr: string, dep: string, stopId: string, seq: number): string {
  return `${tripId},${arr},${dep},${stopId},${seq},,,,\n`;
}

const STOP_TIMES_TXT =
  STOP_TIMES_HEADER +
  // t1: A 08:00:00 / B 08:05:00-08:05:10 (dwell 10) / C 08:12:00 -- AB=300s, BC=410s, band 8
  stopTimeRow('t1', '08:00:00', '08:00:00', 'A', 1) +
  stopTimeRow('t1', '08:05:00', '08:05:10', 'B', 2) +
  stopTimeRow('t1', '08:12:00', '08:12:00', 'C', 3) +
  // t2: A 08:30:00 / B 08:34:00-08:34:20 (dwell 20) / C 08:41:00 -- AB=240s, BC=400s, band 8
  stopTimeRow('t2', '08:30:00', '08:30:00', 'A', 1) +
  stopTimeRow('t2', '08:34:00', '08:34:20', 'B', 2) +
  stopTimeRow('t2', '08:41:00', '08:41:00', 'C', 3) +
  // t3: A 20:00:00 / B 20:04:00-20:04:15 (dwell 15) / C 20:10:00 -- AB=240s, BC=345s, band 20
  stopTimeRow('t3', '20:00:00', '20:00:00', 'A', 1) +
  stopTimeRow('t3', '20:04:00', '20:04:15', 'B', 2) +
  stopTimeRow('t3', '20:10:00', '20:10:00', 'C', 3) +
  // t4: C 09:00:00 / B 09:05:00 / A 09:10:00 -- CB=300s, BA=300s, band 9
  stopTimeRow('t4', '09:00:00', '09:00:00', 'C', 1) +
  stopTimeRow('t4', '09:05:00', '09:05:00', 'B', 2) +
  stopTimeRow('t4', '09:10:00', '09:10:00', 'A', 3) +
  // t5: D 08:20:00 / E 08:26:00 -- DE=360s, band 8
  stopTimeRow('t5', '08:20:00', '08:20:00', 'D', 1) +
  stopTimeRow('t5', '08:26:00', '08:26:00', 'E', 2) +
  // t6: D 25:10:00 / E 25:20:00 -- DE=600s, past midnight, band (25 % 24) = 1
  stopTimeRow('t6', '25:10:00', '25:10:00', 'D', 1) +
  stopTimeRow('t6', '25:20:00', '25:20:00', 'E', 2) +
  // t7: D 08:00:00 / E 08:09:00 -- DE=540s, band 8
  stopTimeRow('t7', '08:00:00', '08:00:00', 'D', 1) +
  stopTimeRow('t7', '08:09:00', '08:09:00', 'E', 2);

const FEED_INFO_TXT =
  'feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version\n' +
  'ZET,https://www.zet.hr,hr,20260901,20301231,000777\n';

function makeFullZip(opts: { extraTripsRow?: string } = {}): Uint8Array {
  const tripsTxt = TRIPS_TXT + (opts.extraTripsRow ?? '');
  return makeZip([
    { name: 'trips.txt', data: tripsTxt, method: 8 },
    { name: 'stop_times.txt', data: STOP_TIMES_TXT, method: 8 },
    { name: 'feed_info.txt', data: FEED_INFO_TXT, method: 8 },
  ]);
}

describe('median', () => {
  it('takes the lower of the two middle values for an even count, the true middle for odd', () => {
    expect(median([10, 20])).toBe(10);
    expect(median([10, 15, 20])).toBe(15);
    expect(median([600])).toBe(600);
  });

  it('throws on an empty array', () => {
    expect(() => median([])).toThrow();
  });
});

describe('chainEncodeIds / chainDecodeIds', () => {
  it('front-codes a sorted id array and reconstructs it exactly', () => {
    const ids = ['0_20_10101_101_10005', '0_20_10101_101_10006', '0_20_10101_101_10011', '0_27_907_9_31181'];
    const { common, suffix } = chainEncodeIds(ids);
    expect(common).toEqual([0, 19, 18, 3]);
    expect(suffix).toEqual(['0_20_10101_101_10005', '6', '11', '7_907_9_31181']);
    expect(chainDecodeIds(common, suffix)).toEqual(ids);
  });

  it('round-trips an empty array', () => {
    const { common, suffix } = chainEncodeIds([]);
    expect(chainDecodeIds(common, suffix)).toEqual([]);
  });
});

describe('chainEncodeDeltas / chainDecodeDeltas', () => {
  it('encodes the first value absolute and the rest as differences, reconstructing exactly', () => {
    const values = [28800, 30600, 72000, 32400];
    const deltas = chainEncodeDeltas(values);
    expect(deltas).toEqual([28800, 1800, 41400, -39600]); // may go negative: trips are sorted by id, not by start
    expect(chainDecodeDeltas(deltas)).toEqual(values);
  });

  it('round-trips an empty array', () => {
    expect(chainDecodeDeltas(chainEncodeDeltas([]))).toEqual([]);
  });
});

describe('buildTripIndex', () => {
  it('builds the documented artefact shape from a synthetic zip', async () => {
    const zip = makeFullZip();
    const { artefact, report } = await buildTripIndex(zip, { now: () => new Date('2026-09-16T12:00:00.000Z') });

    expect(artefact.version).toBe(1);
    expect(artefact.feedVersion).toBe('000777');
    expect(artefact.builtAt).toBe('2026-09-16T12:00:00.000Z');
    expect(artefact.source).toBe('ZET GTFS');

    // Pattern keying: three distinct patterns, none merged despite P1/P2
    // sharing a route and P1/P3 sharing a direction -- (route, direction,
    // shape-or-'', stop sequence) is the real key.
    expect(artefact.patterns.route).toHaveLength(3);
    expect(report.patterns).toBe(3);

    // Deterministic order: route (numeric-aware), then direction, then shape.
    expect(artefact.patterns.route).toEqual(['10', '10', '20']);
    expect(artefact.patterns.direction).toEqual([0, 1, 0]);
    expect(artefact.patterns.shape).toEqual(['shp1', '', 'shp2']);
    expect(artefact.patterns.stops).toEqual([
      ['A', 'B', 'C'],
      ['C', 'B', 'A'],
      ['D', 'E'],
    ]);
    expect(artefact.patterns.trips).toEqual([3, 1, 3]);

    // Headsign dictionary: one entry per pattern's *winning* spelling, in
    // pattern order, minority spellings never appearing.
    expect(artefact.headsigns).toEqual(['Centar', 'Ban Jelačić', 'Vukomerec']);
    expect(artefact.patterns.headsign).toEqual([0, 1, 2]);

    // Sched medians per band (see the file header comment for exactly what
    // a sample is): band 8 is a genuine two-sample median (lower of the
    // two) on both patterns that have one; band 20 and band 1 are single
    // samples.
    expect(artefact.patterns.sched[0][8]).toEqual([240, 400]); // pattern P1, A-B and B-C
    expect(artefact.patterns.sched[0][20]).toEqual([240, 345]);
    expect(artefact.patterns.sched[2][8]).toEqual([360]); // pattern P3, D-E
    expect(artefact.patterns.sched[2][1]).toEqual([600]);

    // Nearest-band fill, independently per stop pair: band 14 sits exactly
    // between 8 and 20 (distance 6 both ways) -- the tie is broken toward
    // the lower band index (8). Band 10 is nearer 8, band 17 nearer 20.
    expect(artefact.patterns.sched[0][14]).toEqual([240, 400]);
    expect(artefact.patterns.sched[0][10]).toEqual([240, 400]);
    expect(artefact.patterns.sched[0][17]).toEqual([240, 345]);
    // Pattern P3 has only bands 1 and 8 populated; band 4 is nearer 1, band 12 nearer 8.
    expect(artefact.patterns.sched[2][4]).toEqual([600]);
    expect(artefact.patterns.sched[2][12]).toEqual([360]);

    // Dwell: median scheduled departure - arrival per stop. B's three dwells
    // (10, 20, 15) give the true middle (15, odd count); every other stop
    // in every pattern is a clean 0.
    expect(artefact.patterns.dwell[0]).toEqual([0, 15, 0]);
    expect(artefact.patterns.dwell[1]).toEqual([0, 0, 0]);
    expect(artefact.patterns.dwell[2]).toEqual([0, 0]);

    // Trips: sorted by id; pattern/block/service are dictionary indices.
    // id, start, pattern and block are all byte-budget encodings on the wire
    // (see the file header comment in shared/motion/trips.ts) -- decode them
    // the same way that file's decodeTripIndex does before asserting on the
    // logical values. service is the one dictionary index left un-encoded.
    const tripIds = chainDecodeIds(artefact.trips.idCommon, artefact.trips.idSuffix);
    const tripStarts = chainDecodeDeltas(artefact.trips.start);
    const tripPatterns = chainDecodeDeltas(artefact.trips.pattern);
    const tripBlocks = chainDecodeDeltas(artefact.trips.block);
    expect(tripIds).toEqual(['t1', 't2', 't3', 't4', 't5', 't6', 't7']);
    expect(tripPatterns).toEqual([0, 0, 0, 1, 2, 2, 2]);
    expect(tripStarts).toEqual([28800, 30600, 72000, 32400, 30000, 90600, 28800]);

    // Blocks: BLK1 spans t1 (route 10) and t5 (route 20) -- the multi-route
    // block. Six distinct blocks, ordered alphabetically, one of them spans
    // two routes. There is no blocks.trips array on the wire (see the file
    // header comment in shared/motion/trips.ts): it is fully derivable from
    // trips.block + trips.start, so it is asserted here from those two
    // columns directly, the same way decodeTripIndex reconstructs it.
    expect(artefact.blocks.id).toEqual(['BLK1', 'BLK2', 'BLK3', 'BLK4', 'BLK5', 'BLK6']);
    expect((artefact.blocks as { trips?: unknown }).trips).toBeUndefined();
    expect(report.blocks).toBe(6);
    expect(report.multiRouteBlocks).toBe(1);
    const blk1Index = artefact.blocks.id.indexOf('BLK1');
    const t1Idx = tripIds.indexOf('t1');
    const t5Idx = tripIds.indexOf('t5');
    expect(tripBlocks[t1Idx]).toBe(blk1Index);
    expect(tripBlocks[t5Idx]).toBe(blk1Index);
    // Departure order within the block: t1 (08:00) before t5 (08:20).
    expect(tripStarts[t1Idx]).toBeLessThan(tripStarts[t5Idx]);

    // Service index: two distinct service ids, sorted, "wd" before "we".
    // Not chain-delta encoded (see the wire type comment), so asserted
    // directly against the raw column.
    expect(artefact.services.id).toEqual(['wd', 'we']);
    expect(artefact.trips.service[tripIds.indexOf('t4')]).toBe(artefact.services.id.indexOf('we'));
    expect(artefact.trips.service[tripIds.indexOf('t1')]).toBe(artefact.services.id.indexOf('wd'));

    // Trips without a shape, by route: only t4 (route 10, pattern P2).
    expect(report.tripsWithoutShapeByRoute).toEqual({ '10': 1 });
  });

  it('throws on a trip whose stop_times are missing', async () => {
    const zip = makeFullZip({ extraTripsRow: '10,wd,t8,Orphan,,0,BLK7,shp1\n' });
    await expect(buildTripIndex(zip, {})).rejects.toThrow(/t8/);
  });
});

describe('main', () => {
  it('downloads, builds, and writes the artefact, reporting sizes', async () => {
    const zip = makeFullZip();
    const dir = await mkdtemp(join(tmpdir(), 'zet-trips-'));
    const fetchImpl = async () => new Response(zip, { status: 200 });
    const logs: string[] = [];
    const result = await main({
      fetchImpl,
      cwd: dir,
      out: 'data/zet-trips.json',
      log: (s: string) => logs.push(s),
      now: () => new Date('2026-09-16T12:00:00.000Z'),
    });
    expect(result.patterns).toBe(3);
    expect(result.trips).toBe(7);
    expect(result.rawBytes).toBeGreaterThan(0);
    expect(result.gzipBytes).toBeGreaterThan(0);

    const writtenRaw = await readFile(join(dir, 'data/zet-trips.json'), 'utf8');
    const written = JSON.parse(writtenRaw);
    expect(written.feedVersion).toBe('000777');
    expect(gzipSync(Buffer.from(writtenRaw, 'utf8')).length).toBe(result.gzipBytes);
    expect(logs.join('\n')).toContain('patterns');
  });

  it('fails on a non-2xx download', async () => {
    const fetchImpl = async () => new Response('nope', { status: 503 });
    await expect(main({ fetchImpl, log: () => {} })).rejects.toThrow(/HTTP 503/);
  });
});
