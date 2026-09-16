import { describe, expect, it } from 'vitest';
import { crc32, deflateRawSync } from 'node:zlib';
import { buildTripIndex } from '../../scripts/gtfs-trips.mjs';
import { decodeTripIndex, SUPPORTED_VERSION, TripIndexVersionError } from '../../shared/motion/trips';

interface ZipInput {
  name: string;
  data: string;
  method: 0 | 8;
}

/** Builds a valid zip (local headers, central directory, EOCD) with no library.
 *  Copied from test/scripts/gtfs-trips.test.ts's helper of the same shape. */
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

// A compact two-pattern feed: pattern 0 (route 5, direction 0, shape shpX,
// stops S1 -> S2) carries two trips so its single populated band (7) is a
// genuine two-sample median; pattern 1 (route 5, direction 1, shape shpY,
// stops S2 -> S1) carries one trip in a different service and block, so
// tripsById/blocks resolve distinct dictionary entries for both.
const TRIPS_TXT =
  'route_id,service_id,trip_id,trip_headsign,trip_short_name,direction_id,block_id,shape_id\n' +
  '5,wd,tA,Sredte,,0,B1,shpX\n' +
  '5,wd,tB,Sredte,,0,B1,shpX\n' +
  '5,we,tC,Povratak,,1,B2,shpY\n';

const STOP_TIMES_TXT =
  'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type,shape_dist_traveled\n' +
  'tA,07:00:00,07:00:00,S1,1,,,,\n' +
  'tA,07:10:00,07:10:00,S2,2,,,,\n' +
  'tB,07:30:00,07:30:00,S1,1,,,,\n' +
  'tB,07:42:00,07:42:00,S2,2,,,,\n' +
  'tC,06:00:00,06:00:00,S2,1,,,,\n' +
  'tC,06:08:00,06:08:00,S1,2,,,,\n';

const FEED_INFO_TXT =
  'feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version\n' +
  'ZET,https://www.zet.hr,hr,20260901,20301231,000777\n';

function makeFixtureZip(): Uint8Array {
  return makeZip([
    { name: 'trips.txt', data: TRIPS_TXT, method: 8 },
    { name: 'stop_times.txt', data: STOP_TIMES_TXT, method: 8 },
    { name: 'feed_info.txt', data: FEED_INFO_TXT, method: 8 },
  ]);
}

describe('decodeTripIndex', () => {
  it('round-trips buildTripIndex\'s wire output through JSON, resolving every dictionary', async () => {
    const zip = makeFixtureZip();
    const { artefact } = await buildTripIndex(zip, { now: () => new Date('2026-09-16T12:00:00.000Z') });
    // Simulate the artefact having gone through app/public/data/zet-trips.json
    // and back, exactly as the twin (A3) will read it: JSON, not the live object.
    const wire = JSON.parse(JSON.stringify(artefact));

    const index = decodeTripIndex(wire);
    expect(index.feedVersion).toBe('000777');
    expect(index.patterns).toHaveLength(2);

    const p0 = index.patterns[0];
    expect(p0.route).toBe('5');
    expect(p0.direction).toBe(0);
    expect(p0.shape).toBe('shpX');
    expect(p0.headsign).toBe('Sredte'); // resolved from the headsigns dictionary, not left as an index
    expect(p0.stops).toEqual(['S1', 'S2']);
    expect(p0.trips).toBe(2);
    expect(p0.dwell).toEqual([0, 0]);

    const p1 = index.patterns[1];
    expect(p1.route).toBe('5');
    expect(p1.direction).toBe(1);
    expect(p1.shape).toBe('shpY');
    expect(p1.headsign).toBe('Povratak');
    expect(p1.stops).toEqual(['S2', 'S1']);
    expect(p1.trips).toBe(1);

    // schedSeconds: band 7 is the genuine two-sample median (600, the lower
    // of 600/720); every other band fills from the nearest populated one --
    // with only one populated band, every band resolves to the same value.
    expect(index.schedSeconds(0, 0, 7)).toBe(600);
    expect(index.schedSeconds(0, 0, 0)).toBe(600);
    expect(index.schedSeconds(0, 0, 23)).toBe(600);
    // Pattern 1's only trip departs S2 at 06:00, arrives S1 at 06:08: 480 s, band 6.
    expect(index.schedSeconds(1, 0, 6)).toBe(480);
    expect(index.schedSeconds(1, 0, 12)).toBe(480);

    // tripsById: block and service resolved back to their string ids, not
    // left as dictionary indices.
    const tA = index.tripsById.get('tA');
    expect(tA).toEqual({ pattern: 0, block: 'B1', start: 25200, service: 'wd' });
    const tC = index.tripsById.get('tC');
    expect(tC).toEqual({ pattern: 1, block: 'B2', start: 21600, service: 'we' });
    expect(index.tripsById.has('nonexistent')).toBe(false);

    // blocks: trip ids (not indices), in departure order.
    expect(index.blocks.get('B1')).toEqual(['tA', 'tB']);
    expect(index.blocks.get('B2')).toEqual(['tC']);

    // A stale artefact of another version fails loudly, never decodes as this one.
    expect(() => decodeTripIndex({ version: SUPPORTED_VERSION + 1 })).toThrow(TripIndexVersionError);
    expect(() => decodeTripIndex({})).toThrow(TripIndexVersionError);
    expect(() => decodeTripIndex(null)).toThrow(TripIndexVersionError);
    expect(() => decodeTripIndex('not an object')).toThrow(TripIndexVersionError);
  });
});
