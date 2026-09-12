import { describe, expect, it } from 'vitest';
import { crc32, deflateRawSync, gzipSync } from 'node:zlib';
import { readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  DIAGRAM_SIMPLIFY_METRES,
  LINE_KEYS,
  ON_FRAC_SCALE,
  ORIGIN,
  ROUTE_KEYS,
  SCALE,
  SHAPE_KEYS,
  STOP_KEYS,
  STOP_SHAPE_MAX_METRES,
  buildNetwork,
  buildOctilinearLine,
  chainDecodeXY,
  chainEncodeXY,
  decodeStopOn,
  dpIndices,
  fromColumnar,
  main,
  snapOctant,
  toMetres,
} from '../../scripts/gtfs-shapes.mjs';

/** The wire format is struct-of-arrays (see toColumnar in the script); tests
 *  read it back as the row-major objects the brief's interface sketch shows. */
function routesOf(net: any): any[] {
  return fromColumnar(net.routes, ROUTE_KEYS);
}
function shapesOf(net: any): any[] {
  return fromColumnar(net.shapes, SHAPE_KEYS);
}
function stopsOf(net: any): any[] {
  return fromColumnar(net.stops, STOP_KEYS).map((s: any) => ({ ...s, on: decodeStopOn(s.on) }));
}
function linesOf(net: any): any[] {
  return fromColumnar(net.diagram.lines, LINE_KEYS);
}

/** Inverse of buildNetwork's own deltaEncode: turns one chain-decoded integer
 *  (x, y) unit pair back into lon/lat degrees, so a shape's `d` (or a run of
 *  stops' `p`) can be checked against known fixture coordinates, not just
 *  against its own array length. */
function unitsToLonLat([x, y]: [number, number]): { lon: number; lat: number } {
  return { lon: ORIGIN[0] + x * SCALE, lat: ORIGIN[1] + y * SCALE };
}

/** Every stop's `p` is chain-delta encoded across the *whole* stops array
 *  (see buildNetwork), not per-stop, so decoding one stop's position means
 *  chain-decoding the concatenation of every stop's `p` up to and including
 *  it, in array order -- exactly what chainDecodeXY expects. Returns each
 *  stop's absolute lon/lat keyed by stop id. */
function stopLonLatById(net: any): Record<string, { lon: number; lat: number }> {
  const stops = fromColumnar(net.stops, STOP_KEYS);
  const flatP = stops.flatMap((s: any) => s.p as [number, number]);
  const units = chainDecodeXY(flatP);
  const out: Record<string, { lon: number; lat: number }> = {};
  stops.forEach((s: any, i: number) => {
    out[s.id] = unitsToLonLat(units[i] as [number, number]);
  });
  return out;
}

/** Perpendicular distance from a point to the nearest segment of a polyline
 *  (metre-space XY). An independent re-implementation of buildNetwork's own
 *  internal pointSegmentDistance/nearestOnPolyline (not exported), so the
 *  R-T1 regression test below checks the real artefact's `on` list against a
 *  distance computed separately from the code under test, not against its
 *  own logic circularly. */
function distanceToPolyline(p: { x: number; y: number }, points: { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best) best = d;
  }
  return best;
}

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

// A small synthetic feed, built to exercise every rule in the T1 brief:
//
//  - route T1 (tram): a shape that is a straight north-south line with a
//    perfectly collinear midpoint, which Douglas-Peucker at 5 m must drop.
//  - route T2 (tram): an L-shaped shape (a real corner), whose two trips'
//    endpoints are deliberately placed FAR (200 m) from the shape geometry,
//    to exercise the stop-transfer override (T1 checklist item 1): a stop
//    outside the 40 m geometric radius still gets linked at the shape's own
//    endpoint, because stop_times.txt names it as that trip's first/last stop.
//  - route B1 (bus, 3 trips): a bendy shape with short (<120 m) zig-zag
//    segments, to exercise the diagram's second (120 m) simplification pass
//    without breaking the octilinear invariant.
//  - route B2 (bus, 1 trip): ranks below B1 among buses, so with
//    diagramBusCount=1 it must be excluded from the diagram while still
//    appearing in the top-level `routes` and `shapes` arrays.
const ROUTES_TXT =
  'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color\n' +
  'T1,0,"1","Tram jedan",,0,,,\n' +
  'T2,0,"2","Tram dva",,0,,,\n' +
  'B1,0,"101","Bus sto jedan",,3,,,\n' +
  'B2,0,"102","Bus sto dva",,3,,,\n';

const TRIPS_TXT =
  'route_id,service_id,trip_id,trip_headsign,trip_short_name,direction_id,block_id,shape_id\n' +
  'T1,wd,t1_trip_1,,,0,,T1_shape\n' +
  'T2,wd,t2_trip_1,,,0,,T2_shape\n' +
  'B1,wd,b1_trip_1,,,0,,B1_shape\n' +
  'B1,wd,b1_trip_2,,,1,,B1_shape\n' +
  'B1,wd,b1_trip_3,,,0,,B1_shape\n' +
  'B2,wd,b2_trip_1,,,0,,B2_shape\n';

// T1_shape: due north along lon 15.9000, from lat 45.7500 to 45.7600, with a
// perfectly collinear midpoint at 45.7550 (zero perpendicular deviation ->
// Douglas-Peucker at 5 m must remove it regardless of the projection's exact
// constants).
const T1_LAT_0 = 45.75;
const T1_LAT_MID = 45.755;
const T1_LAT_1 = 45.76;
const T1_LON = 15.9;

// T2_shape: an L corner well away from T1, so the DP pass keeps the corner
// (a ~110 m jog, far past the 5 m tolerance).
const T2_A = { lon: 15.92, lat: 45.75 };
const T2_B = { lon: 15.92, lat: 45.751 }; // ~111 m north of A
const T2_C = { lon: 15.9214, lat: 45.751 }; // ~109 m east of B, at ~45.8N

// B1_shape: several short zig-zag jogs (each well under 120 m), so the
// diagram's second simplification pass has real work to do.
const B1_PTS = [
  { lon: 15.95, lat: 45.8 },
  { lon: 15.9505, lat: 45.8 }, // ~39 m east
  { lon: 15.9505, lat: 45.8005 }, // ~56 m north
  { lon: 15.951, lat: 45.8005 }, // ~39 m east
  { lon: 15.951, lat: 45.802 }, // ~167 m north (the real corner to keep)
];

const B2_PTS = [
  { lon: 16.0, lat: 45.82 },
  { lon: 16.001, lat: 45.822 },
];

function shapesRow(id: string, seq: number, p: { lon: number; lat: number }): string {
  return `${id},${p.lat},${p.lon},${seq},\n`;
}

const SHAPES_TXT =
  'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled\n' +
  shapesRow('T1_shape', 1, { lon: T1_LON, lat: T1_LAT_0 }) +
  shapesRow('T1_shape', 2, { lon: T1_LON, lat: T1_LAT_MID }) +
  shapesRow('T1_shape', 3, { lon: T1_LON, lat: T1_LAT_1 }) +
  shapesRow('T2_shape', 1, T2_A) +
  shapesRow('T2_shape', 2, T2_B) +
  shapesRow('T2_shape', 3, T2_C) +
  B1_PTS.map((p, i) => shapesRow('B1_shape', i + 1, p)).join('') +
  B2_PTS.map((p, i) => shapesRow('B2_shape', i + 1, p)).join('');

// Stops: one sitting exactly on T1's line (midpoint, so its arc-fraction
// should land near 0.5), one far from every shape (empty `on`), and two
// placed 200 m off T2's own endpoints -- outside the 40 m geometric radius --
// that only get linked via the stop-transfer override in stop_times.txt.
const S_CLOSE = { id: 'S_close', name: 'Blizu', lon: T1_LON, lat: (T1_LAT_0 + T1_LAT_1) / 2 };
const S_FAR = { id: 'S_far', name: 'Daleko', lon: 16.2, lat: 45.9 };
// ~200 m south of T2_A along the meridian (1e-5 deg lat ~= 1.11 m).
const S_T2_START = { id: 'S_t2_start', name: 'T2 pocetak', lon: T2_A.lon, lat: T2_A.lat - 0.0018 };
// ~200 m east of T2_C.
const S_T2_END = { id: 'S_t2_end', name: 'T2 kraj', lon: T2_C.lon + 0.0026, lat: T2_C.lat };
// A blank location_type (GTFS default: 0, an actual boarding stop) and an
// explicit location_type=1 (a parent "station" grouping several boarding
// stops, never itself a place a vehicle stops) -- parseStopsTxt's filter
// must keep the former and drop the latter. Positioned far from every
// defined shape; only their presence/absence in the built artefact matters.
const S_BLANK_TYPE = { id: 'S_blank_type', name: 'Prazan location_type', lon: 16.05, lat: 45.85 };
const S_PARENT = { id: 'S_parent', name: 'Cvoriste (nadredena postaja)', lon: 16.06, lat: 45.86 };

const STOPS_TXT =
  'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station\n' +
  [S_CLOSE, S_FAR, S_T2_START, S_T2_END]
    .map((s) => `${s.id},,${s.name},,${s.lat},${s.lon},,,0,\n`)
    .join('') +
  `${S_BLANK_TYPE.id},,${S_BLANK_TYPE.name},,${S_BLANK_TYPE.lat},${S_BLANK_TYPE.lon},,,,\n` +
  `${S_PARENT.id},,${S_PARENT.name},,${S_PARENT.lat},${S_PARENT.lon},,,1,\n`;

// Only T2's trip gets stop_times rows: enough to prove the override fires
// for both the first and last stop, and that trips lacking any stop_times
// (T1, B1, B2's sample trips) leave the override a no-op rather than a crash.
const STOP_TIMES_TXT =
  'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type\n' +
  't2_trip_1,08:00:00,08:00:00,S_t2_start,1,,,\n' +
  't2_trip_1,08:05:00,08:05:00,S_close,2,,,\n' +
  't2_trip_1,08:10:00,08:10:00,S_t2_end,3,,,\n';

const FEED_INFO_TXT =
  'feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version\n' +
  'ZET,https://www.zet.hr,hr,20260901,20301231,000123\n';

function makeFullZip(opts: { withFeedInfo?: boolean } = {}): Uint8Array {
  const files: ZipInput[] = [
    { name: 'routes.txt', data: ROUTES_TXT, method: 8 },
    { name: 'trips.txt', data: TRIPS_TXT, method: 8 },
    { name: 'shapes.txt', data: SHAPES_TXT, method: 8 },
    { name: 'stops.txt', data: STOPS_TXT, method: 8 },
    { name: 'stop_times.txt', data: STOP_TIMES_TXT, method: 8 },
  ];
  if (opts.withFeedInfo !== false) files.push({ name: 'feed_info.txt', data: FEED_INFO_TXT, method: 8 });
  return makeZip(files);
}

describe('toMetres', () => {
  it('is linear, so equal lon/lat steps give equal metre steps', () => {
    const a = toMetres(15.9, 45.75);
    const b = toMetres(15.9, 45.751);
    const c = toMetres(15.9, 45.752);
    expect(b.y - a.y).toBeCloseTo(c.y - b.y, 6);
    expect(a.x).toBe(b.x); // same longitude -> same x
  });
});

describe('snapOctant', () => {
  it('snaps to the nearest multiple of 45 degrees', () => {
    const eighth = Math.PI / 4;
    for (let k = -8; k <= 8; k++) {
      expect(snapOctant(k * eighth)).toBeCloseTo(k * eighth, 9);
    }
    expect(snapOctant(10 * (Math.PI / 180))).toBeCloseTo(0, 9); // 10 deg -> 0
    expect(snapOctant(40 * (Math.PI / 180))).toBeCloseTo(eighth, 9); // 40 deg -> 45
  });
});

describe('chainEncodeXY / chainDecodeXY', () => {
  it('round-trips an arbitrary sequence of integer units exactly', () => {
    const units: [number, number][] = [
      [123, 4567],
      [130, 4570], // small forward step
      [90, 4600], // a step back, both axes
      [90, 4600], // a repeated point (zero-length step)
      [-500, 12000], // a big jump, and negative units
    ];
    const encoded = chainEncodeXY(units);
    expect(encoded).toHaveLength(units.length * 2);
    expect(chainDecodeXY(encoded)).toEqual(units);
  });

  it('encodes small consecutive steps as small deltas', () => {
    // This is the whole point of chain (not origin-offset) delta encoding:
    // points a shape actually visits in sequence are close to each other,
    // even when all of them are far from ORIGIN.
    const farFromOrigin = 250_000;
    const units: [number, number][] = [
      [farFromOrigin, farFromOrigin],
      [farFromOrigin + 40, farFromOrigin + 5],
      [farFromOrigin + 81, farFromOrigin + 12],
    ];
    const encoded = chainEncodeXY(units);
    expect(Math.abs(encoded[0])).toBeGreaterThan(1000); // the first point still anchors on the absolute unit
    expect(Math.abs(encoded[2])).toBeLessThan(100); // every later step is small
    expect(Math.abs(encoded[3])).toBeLessThan(100);
  });
});

describe('dpIndices', () => {
  it('drops a perfectly collinear midpoint and keeps a real corner', () => {
    const collinear = [
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 0, y: 100 },
    ];
    expect(dpIndices(collinear, 5)).toEqual([0, 2]);

    const corner = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(dpIndices(corner, 5)).toEqual([0, 1, 2]);
  });
});

describe('buildOctilinearLine', () => {
  it('is exactly octilinear against its predecessor after snap and after the 120 m simplification pass', () => {
    const raw = B1_PTS.map((p) => toMetres(p.lon, p.lat));
    const line = buildOctilinearLine(raw, DIAGRAM_SIMPLIFY_METRES);
    expect(line.length).toBeGreaterThanOrEqual(2);
    const eighth = Math.PI / 4;
    for (let i = 1; i < line.length; i++) {
      const angle = Math.atan2(line[i].y - line[i - 1].y, line[i].x - line[i - 1].x);
      const mod = ((angle % eighth) + eighth) % eighth;
      const distanceFromGrid = Math.min(mod, eighth - mod);
      expect(distanceFromGrid).toBeLessThan(1e-6);
    }
  });
});

describe('buildNetwork', () => {
  it('produces an artefact matching the documented shape, from a synthetic zip', async () => {
    const zip = makeFullZip();
    const net = await buildNetwork(zip, { diagramBusCount: 1 });

    expect(net.version).toBe(1);
    expect(net.feedVersion).toBe('000123'); // from feed_info.txt
    expect(() => new Date(net.builtAt).toISOString()).not.toThrow();
    expect(net.origin).toEqual(ORIGIN);
    expect(net.scale).toBe(SCALE);

    // The wire format is struct-of-arrays (toColumnar): every field the
    // brief's interface names is present as its own column, index-aligned.
    for (const key of ROUTE_KEYS) expect(net.routes[key]).toHaveLength(4);
    for (const key of SHAPE_KEYS) expect(net.shapes[key]).toHaveLength(4);
    // 4 original stops + S_blank_type (blank location_type keeps its default
    // boarding-stop status); S_parent (location_type=1) is filtered out.
    for (const key of STOP_KEYS) expect(net.stops[key]).toHaveLength(5);

    const routes = routesOf(net);
    for (const r of routes) {
      expect(typeof r.id).toBe('string');
      expect(typeof r.short).toBe('string');
      expect(typeof r.type).toBe('number');
      expect(typeof r.rank).toBe('number');
      expect(Array.isArray(r.shapes)).toBe(true);
    }
    // Both trams rank ahead of both buses; ranks are a dense 1..4 permutation.
    const rankById = Object.fromEntries(routes.map((r: any) => [r.id, r.rank]));
    expect(rankById.T1).toBeLessThanOrEqual(2);
    expect(rankById.T2).toBeLessThanOrEqual(2);
    expect(rankById.B1).toBeGreaterThan(2);
    expect(rankById.B2).toBeGreaterThan(2);
    expect(new Set(routes.map((r: any) => r.rank)).size).toBe(4);

    const shapes = shapesOf(net);
    for (const s of shapes) {
      // d is chain-delta encoded (chainEncodeXY): length is unaffected by
      // that, so it still validates directly against the documented shape.
      expect(s.d.length % 2).toBe(0);
      expect(s.d.length).toBeGreaterThanOrEqual(4); // at least two points
      expect(typeof s.len).toBe('number');
      expect(s.len).toBeGreaterThan(0);
    }
    // T1's collinear midpoint was dropped: exactly the two endpoints remain.
    const t1Shape = shapes.find((s: any) => s.id === 'T1_shape');
    expect(t1Shape.d).toHaveLength(4);
    // T2's corner survives simplification: three points remain.
    const t2Shape = shapes.find((s: any) => s.id === 'T2_shape');
    expect(t2Shape.d).toHaveLength(6);

    // Decode d back to lon/lat (chainDecodeXY, then ORIGIN/SCALE) and check
    // it against the known fixture coordinates, not just its array length --
    // this is the only thing that would catch a swapped axis, a wrong first-
    // point anchor, or double-scaling in how deltaEncode and chainEncodeXY
    // compose, all of which would still pass a length-only check.
    const t1Points = chainDecodeXY(t1Shape.d).map(unitsToLonLat);
    expect(t1Points[0].lon).toBeCloseTo(T1_LON, 4);
    expect(t1Points[0].lat).toBeCloseTo(T1_LAT_0, 4);
    expect(t1Points[1].lon).toBeCloseTo(T1_LON, 4);
    expect(t1Points[1].lat).toBeCloseTo(T1_LAT_1, 4);

    const t2Points = chainDecodeXY(t2Shape.d).map(unitsToLonLat);
    expect(t2Points[0].lon).toBeCloseTo(T2_A.lon, 4);
    expect(t2Points[0].lat).toBeCloseTo(T2_A.lat, 4);
    expect(t2Points[1].lon).toBeCloseTo(T2_B.lon, 4);
    expect(t2Points[1].lat).toBeCloseTo(T2_B.lat, 4);
    expect(t2Points[2].lon).toBeCloseTo(T2_C.lon, 4);
    expect(t2Points[2].lat).toBeCloseTo(T2_C.lat, 4);

    const stops = stopsOf(net); // decodeStopOn already applied: on is [shapeIdx, frac][]
    for (const st of stops) {
      // No cap (R-T1): a stop links to every shape within STOP_SHAPE_MAX_METRES,
      // and this fixture never has more than 4 shapes total, so the only real
      // assertion left here is that every recorded fraction is a valid 0..1.
      for (const [, frac] of st.on) {
        expect(frac).toBeGreaterThanOrEqual(0);
        expect(frac).toBeLessThanOrEqual(1);
      }
    }
    const byId = Object.fromEntries(stops.map((s: any) => [s.id, s]));

    // location_type filtering (parseStopsTxt): blank keeps its GTFS-default
    // boarding-stop status, an explicit 1 (a parent "station") is dropped.
    expect(byId.S_blank_type).toBeDefined();
    expect(byId.S_parent).toBeUndefined();

    // The stop sitting on T1's line is linked to it near its midpoint.
    const t1Idx = shapes.indexOf(t1Shape);
    const closeOn = byId.S_close.on.find((e: any) => e[0] === t1Idx);
    expect(closeOn).toBeDefined();
    expect(closeOn[1]).toBeCloseTo(0.5, 1);

    // The far-away stop is near no shape at all.
    expect(byId.S_far.on).toEqual([]);

    // Decode a couple of stops.p entries the same way, against the fixture's
    // own lon/lat -- p is chain-delta encoded across the whole stops array
    // (not per-stop), so this also proves that composition, not just the
    // per-shape one above.
    const stopLonLat = stopLonLatById(net);
    expect(stopLonLat.S_close.lon).toBeCloseTo(S_CLOSE.lon, 4);
    expect(stopLonLat.S_close.lat).toBeCloseTo(S_CLOSE.lat, 4);
    expect(stopLonLat.S_far.lon).toBeCloseTo(S_FAR.lon, 4);
    expect(stopLonLat.S_far.lat).toBeCloseTo(S_FAR.lat, 4);

    // Stop-transfer override: stops 200 m from T2's geometry are still linked
    // to it, at its start (frac 0) and end (frac 1), because stop_times.txt
    // names them as that trip's first and last stop.
    const t2Idx = shapes.indexOf(t2Shape);
    const startOn = byId.S_t2_start.on.find((e: any) => e[0] === t2Idx);
    const endOn = byId.S_t2_end.on.find((e: any) => e[0] === t2Idx);
    expect(startOn).toBeDefined();
    expect(startOn[1]).toBe(0);
    expect(endOn).toBeDefined();
    expect(endOn[1]).toBe(1);
    // And plain geometry alone would not have linked them (proving the
    // override, not a lucky 40 m hit, did the work): both stops sit ~200 m off.
    const purelyGeometric = byId.S_t2_start.on.filter((e: any) => e[0] !== t2Idx);
    expect(purelyGeometric).toEqual([]);

    // Diagram: with diagramBusCount 1, only the busier bus (B1) makes the
    // cut alongside both trams; B2 is excluded from the diagram lines.
    const lines = linesOf(net);
    const diagramRoutes = new Set(lines.map((l: any) => l.route));
    expect(diagramRoutes.has('T1')).toBe(true);
    expect(diagramRoutes.has('T2')).toBe(true);
    expect(diagramRoutes.has('B1')).toBe(true);
    expect(diagramRoutes.has('B2')).toBe(false);
    expect(net.diagram.box).toHaveLength(2);
    expect(Math.max(...net.diagram.box)).toBeCloseTo(1, 5);

    const eighth = Math.PI / 4;
    for (const line of lines) {
      expect(line.pts.length).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < line.pts.length; i++) {
        const [x0, y0] = line.pts[i - 1];
        const [x1, y1] = line.pts[i];
        const angle = Math.atan2(y1 - y0, x1 - x0);
        const mod = ((angle % eighth) + eighth) % eighth;
        expect(Math.min(mod, eighth - mod)).toBeLessThan(1e-4); // rounded to 4dp on write
      }
    }
  });

  it('falls back to the supplied mtime when feed_info.txt is absent', async () => {
    const zip = makeFullZip({ withFeedInfo: false });
    const net = await buildNetwork(zip, { fallbackMtime: '2026-08-15T00:00:00.000Z', diagramBusCount: 1 });
    expect(net.feedVersion).toBe('2026-08-15T00:00:00.000Z');
  });

  it('throws when neither feed_info.txt nor a fallback mtime is available', async () => {
    const zip = makeFullZip({ withFeedInfo: false });
    await expect(buildNetwork(zip, {})).rejects.toThrow(/feedVersion/);
  });

  it('keeps every shape within 40 m of a stop, with no cap (R-T1)', async () => {
    // 14 shapes, each a short east-west segment 3 m further north than the
    // last, all within the stop's own 40 m radius (39 m at worst). This used
    // to exceed ON_MAX_PER_STOP (12) and lose the two farthest; the
    // controller removed that cap as a correctness defect (R-T1), so all 14
    // must now survive.
    const stop = { lon: 16.05, lat: 45.8 };
    const shapeCount = 14;
    const routesTxt =
      'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color\n' +
      'CAP,0,"900","Cap test",,3,,,\n';
    const tripsTxt =
      'route_id,service_id,trip_id,trip_headsign,trip_short_name,direction_id,block_id,shape_id\n' +
      Array.from({ length: shapeCount }, (_, i) => `CAP,wd,cap_trip_${String(i).padStart(2, '0')},,,0,,cap_${String(i).padStart(2, '0')}\n`).join('');
    const metresPerDegLat = 111320; // matches the script's own EARTH_RADIUS_M closely enough for a 3 m step
    const shapesTxt =
      'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled\n' +
      Array.from({ length: shapeCount }, (_, i) => {
        const lat = stop.lat + (i * 3) / metresPerDegLat;
        return (
          shapesRow(`cap_${String(i).padStart(2, '0')}`, 1, { lon: stop.lon - 0.0005, lat }) +
          shapesRow(`cap_${String(i).padStart(2, '0')}`, 2, { lon: stop.lon + 0.0005, lat })
        );
      }).join('');
    const stopsTxt =
      'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station\n' +
      `S_cap,,Cap stop,,${stop.lat},${stop.lon},,,0,\n`;
    const zip = makeZip([
      { name: 'routes.txt', data: routesTxt, method: 8 },
      { name: 'trips.txt', data: tripsTxt, method: 8 },
      { name: 'shapes.txt', data: shapesTxt, method: 8 },
      { name: 'stops.txt', data: stopsTxt, method: 8 },
      { name: 'stop_times.txt', data: 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n', method: 8 },
      { name: 'feed_info.txt', data: FEED_INFO_TXT, method: 8 },
    ]);

    const net = await buildNetwork(zip, { diagramBusCount: 0 });
    const stops = stopsOf(net);
    expect(stops).toHaveLength(1);
    // No cap: every one of the 14 within-40m shapes is kept, not just the
    // closest 12 -- this is the exact regression T6b exists to prevent.
    expect(stops[0].on).toHaveLength(shapeCount);
    const keptShapeIdx = stops[0].on.map(([idx]: [number, number]) => idx).sort((a: number, b: number) => a - b);
    expect(keptShapeIdx).toEqual(Array.from({ length: shapeCount }, (_, i) => i));
  });
});

describe('main', () => {
  it('downloads, builds, and writes both the artefact and network-meta.ts', async () => {
    const zip = makeFullZip();
    const dir = await mkdtemp(join(tmpdir(), 'zet-network-'));
    const fetchImpl = async () => new Response(zip, { status: 200, headers: { 'last-modified': 'Tue, 01 Sep 2026 00:00:00 GMT' } });
    const logs: string[] = [];
    const result = await main({
      fetchImpl,
      cwd: dir,
      out: 'data/zet-network.json',
      metaOut: 'motion/network-meta.ts',
      diagramBusCount: 1,
      log: (s: string) => logs.push(s),
      now: () => new Date('2026-09-12T12:00:00.000Z'),
    });
    expect(result.routeCount).toBe(4);

    const writtenRaw = await readFile(join(dir, 'data/zet-network.json'), 'utf8');
    const written = JSON.parse(writtenRaw);
    expect(written.feedVersion).toBe('000123');
    expect(written.builtAt).toBe('2026-09-12T12:00:00.000Z');
    expect(written.routes.id).toHaveLength(4); // struct-of-arrays: see toColumnar

    const meta = await readFile(join(dir, 'motion/network-meta.ts'), 'utf8');
    expect(meta).toContain('export const FEED_VERSION = "000123";');
    expect(meta).toContain('export const BUILT_AT = "2026-09-12T12:00:00.000Z";');
    expect(meta).toContain('export const ROUTE_COUNT = 4;');
    expect(meta).toMatch(/export const BYTE_SIZE = \d+;/);
    expect(logs.join('\n')).toContain('routes');
  });

  it('fails on a non-2xx download', async () => {
    const fetchImpl = async () => new Response('nope', { status: 503 });
    await expect(main({ fetchImpl, log: () => {} })).rejects.toThrow(/HTTP 503/);
  });
});

describe('the committed artefact', () => {
  const artefactPath = resolve(process.cwd(), 'app/public/data/zet-network.json');

  // R-T2: the gzip gate is the primary one (what the filed proposal actually
  // cares about, what is transferred) and stays at 130 KiB. The raw gate
  // moved to 600 KiB to make room for R-T1 (no per-stop cap, so `stops.on`
  // is larger). Both constants name their unit (KiB, x1024) so the reading
  // enforced is never ambiguous, per R-T2.
  const RAW_BUDGET_KIB = 600;
  const GZIP_BUDGET_KIB = 130;
  const RAW_BUDGET_BYTES = RAW_BUDGET_KIB * 1024;
  const GZIP_BUDGET_BYTES = GZIP_BUDGET_KIB * 1024;

  it('exists, decodes, and stays inside the R-L4/R-T2 budget: gzip is the primary gate at 130 KiB, raw at 600 KiB', () => {
    const raw = readFileSync(artefactPath);
    const gz = gzipSync(raw);
    // Reported for the task record: both measured sizes against both budgets.
    console.log(
      `zet-network.json: ${raw.byteLength} B raw (budget ${RAW_BUDGET_BYTES} B / ${RAW_BUDGET_KIB} KiB), ` +
        `${gz.byteLength} B gzipped (budget ${GZIP_BUDGET_BYTES} B / ${GZIP_BUDGET_KIB} KiB)`,
    );
    expect(raw.byteLength).toBeLessThan(RAW_BUDGET_BYTES);
    expect(gz.byteLength).toBeLessThan(GZIP_BUDGET_BYTES);

    const parsed = JSON.parse(raw.toString('utf8'));
    expect(parsed.version).toBe(1);
    expect(typeof parsed.feedVersion).toBe('string');
    expect(parsed.routes.id.length).toBeGreaterThan(100); // the real ZET feed has 154 routes
    expect(parsed.shapes.id.length).toBeGreaterThan(100);
    expect(parsed.stops.id.length).toBeGreaterThan(1000);
    for (const d of parsed.shapes.d) expect(d.length % 2).toBe(0);
    for (const wireOn of parsed.stops.on) {
      // No cap any more (R-T1): a busy interchange can legitimately link to
      // several dozen shapes. This is a loose sanity ceiling against a
      // genuine runaway (a bug re-adding every shape to every stop), not a
      // budget or a cap.
      expect(wireOn.length).toBeLessThan(400);
      for (const [, frac] of decodeStopOn(wireOn)) {
        expect(frac).toBeGreaterThanOrEqual(0);
        expect(frac).toBeLessThanOrEqual(1);
      }
    }
    // Every scaled fraction the artefact stores is an integer 0..ON_FRAC_SCALE.
    for (const wireOn of parsed.stops.on) {
      for (const [, scaled] of wireOn) {
        expect(Number.isInteger(scaled)).toBe(true);
        expect(scaled).toBeGreaterThanOrEqual(0);
        expect(scaled).toBeLessThanOrEqual(ON_FRAC_SCALE);
      }
    }

    // Sanity: the file on disk is at least as large as what statSync sees
    // (guards against an accidental empty-file commit).
    expect(statSync(artefactPath).size).toBe(raw.byteLength);
  });

  // R-T1's own regression test: the stop gate must see the main square. A
  // capped `on` list could silently drop Trg bana Jelačića from some of its
  // own tram shapes' stop lists, letting a vehicle be dead-reckoned straight
  // through it; this recomputes, independently of buildNetwork's own
  // internals, which tram shapes actually pass within STOP_SHAPE_MAX_METRES
  // of the real stop and checks every one of them is recorded.
  it('keeps Trg bana Jelačića on every tram shape passing within 40 m of it (R-T1 regression)', () => {
    const raw = JSON.parse(readFileSync(artefactPath, 'utf8'));
    const routes = fromColumnar(raw.routes, ROUTE_KEYS);
    const shapes = fromColumnar(raw.shapes, SHAPE_KEYS);
    const stops = fromColumnar(raw.stops, STOP_KEYS);

    // The GTFS feed's own stop_name for the square is "Trg bana J. Jelačića"
    // (the Ruling in the task report explains the exact-name discrepancy);
    // findIndex takes the first such stop, id 106_1, the square's own hub --
    // not one of the unrelated feed rows that happen to share its name far
    // from the square (id 1849_x) or a same-name-fragment street stop
    // elsewhere in the city ("Bana Josipa Jelačića", id 791_x).
    const stopIdx = stops.findIndex((s: any) => s.name === 'Trg bana J. Jelačića');
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    const stop = stops[stopIdx];

    // Stop positions are chain-delta encoded across the *whole* stops array
    // (see buildNetwork), so decode the full chain and index into it.
    const flatP = stops.flatMap((s: any) => s.p as [number, number]);
    const stopUnits = chainDecodeXY(flatP);
    const [ux, uy] = stopUnits[stopIdx];
    const stopLon = raw.origin[0] + ux * raw.scale;
    const stopLat = raw.origin[1] + uy * raw.scale;
    const stopXY = toMetres(stopLon, stopLat);

    const onSet = new Set(decodeStopOn(stop.on).map(([shapeIdx]: [number, number]) => shapeIdx));
    const tramRouteIds = new Set(routes.filter((r: any) => r.type === 0).map((r: any) => r.id));

    let nearTramCount = 0;
    shapes.forEach((shape: any, shapeIdx: number) => {
      if (!tramRouteIds.has(shape.route)) return;
      const shapeXY = chainDecodeXY(shape.d).map(([x, y]: [number, number]) =>
        toMetres(raw.origin[0] + x * raw.scale, raw.origin[1] + y * raw.scale),
      );
      if (distanceToPolyline(stopXY, shapeXY) <= STOP_SHAPE_MAX_METRES) {
        nearTramCount++;
        expect(onSet.has(shapeIdx)).toBe(true);
      }
    });
    // The regression this task exists to prevent: ON_MAX_PER_STOP (12) used
    // to silently drop every tram shape past the 12th-closest at this stop.
    expect(nearTramCount).toBeGreaterThan(12);
  });
});
