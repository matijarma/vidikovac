import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { crc32, deflateRawSync, gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  BUS_ON_FRAC_SCALE,
  CONNECTOR_SNAP_METRES,
  EDGE_KEYS,
  HOP_DETOUR_EXCESS_METRES,
  HOP_DETOUR_FACTOR,
  LINE_KEYS,
  LOOP_DIRECTION,
  LOOP_ID_PREFIX,
  LOOP_LEAD_METRES,
  LOOP_MAX_METRES,
  LOOP_PAIR_MAX_METRES,
  ORIGIN,
  PATH_KEYS,
  ROUTE_KEYS,
  SCALE,
  SERVED_STOP_MAX_METRES,
  SHAPE_KEYS,
  SNAP_METRES,
  STOP_KEYS,
  STOP_SHAPE_MAX_METRES,
  TERMINUS_STOP_MAX_METRES,
  TERMINUS_TRIM_STOPS,
  buildNetwork,
  buildRailGraph,
  decodeEdgeChain,
  decodeStopOn,
  decodeStopOnEdge,
  fromColumnar,
  graphHashOf,
  main,
  pathThroughStops,
  stopSequenceHash,
  toMetres,
} from '../../scripts/gtfs-shapes.mjs';
import { FEED_VERSION } from '../../app/src/motion/network-meta';
import { toLonLat } from '../../shared/motion/geo';
import { decodeNetwork } from '../../shared/motion/network';
import { mapPatternsToPaths } from '../../shared/motion/times';
import { decodeTripIndex } from '../../shared/motion/trips';

// The wire is struct-of-arrays; the tests read it back as rows.
const routesOf = (net: any): any[] => fromColumnar(net.routes, ROUTE_KEYS);
const shapesOf = (net: any): any[] => fromColumnar(net.shapes, SHAPE_KEYS);
const edgesOf = (net: any): any[] => fromColumnar(net.edges, EDGE_KEYS);
const pathsOf = (net: any): any[] => fromColumnar(net.paths, PATH_KEYS);
const stopsOf = (net: any): any[] => fromColumnar(net.stops, STOP_KEYS).map((s: any) => ({ ...s, on: decodeStopOn(s.on), onEdge: decodeStopOnEdge(s.onEdge) }));
const linesOf = (net: any): any[] => fromColumnar(net.diagram.lines, LINE_KEYS);
const unitsToLonLat = ([x, y]: [number, number]) => ({ lon: ORIGIN[0] + x * SCALE, lat: ORIGIN[1] + y * SCALE });

/** An independent point-to-polyline distance, so the real-artefact check
 *  does not test the builder against its own arithmetic. */
function distanceToPolyline(p: { x: number; y: number }, points: { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}
const polylineLength = (points: { x: number; y: number }[]): number =>
  points.reduce((len, p, i) => (i === 0 ? 0 : len + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y)), 0);

interface ZipInput {
  name: string;
  data: string;
  method: 0 | 8;
}

/** A valid zip (local headers, central directory, EOCD) with no library. */
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
    lv.setUint16(8, f.method, true);
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
    cv.setUint16(10, f.method, true);
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

// A small synthetic feed: T1 a straight tram shape with a collinear midpoint
// (two trips, only one of which has stop_times),
// T2 an L-shaped tram shape whose trip's terminus stops sit 186 to 189 m off it
// (the override), T3 a tram route whose trip has no shape_id (a synthetic
// path over T1's edge), B1 a zig-zag bus with a stop on it, B2 a quiet bus.
const ROUTES_TXT =
  'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color\n' +
  'T1,0,"1","Tram jedan",,0,,,\nT2,0,"2","Tram dva",,0,,,\nT3,0,"3","Tram tri",,0,,,\nB1,0,"101","Bus sto jedan",,3,,,\nB2,0,"102","Bus sto dva",,3,,,\n';
const TRIPS_TXT =
  'route_id,service_id,trip_id,trip_headsign,trip_short_name,direction_id,block_id,shape_id\n' +
  'T1,wd,t1_trip_1,,,0,,T1_shape\nT1,wd,t1_trip_2,,,0,,T1_shape\nT2,wd,t2_trip_1,,,1,,T2_shape\nT3,wd,t3_trip_1,,,0,,\n' +
  'B1,wd,b1_trip_1,,,0,,B1_shape\nB1,wd,b1_trip_2,,,1,,B1_shape\nB1,wd,b1_trip_3,,,0,,B1_shape\nB2,wd,b2_trip_1,,,0,,B2_shape\n';
const T1_LON = 15.9;
const T1_LAT_0 = 45.75;
const T1_LAT_1 = 45.76;
const T2_A = { lon: 15.92, lat: 45.75 };
const T2_B = { lon: 15.92, lat: 45.751 };
const T2_C = { lon: 15.9214, lat: 45.751 };
const B1_PTS = [
  { lon: 15.95, lat: 45.8 },
  { lon: 15.9505, lat: 45.8 },
  { lon: 15.9505, lat: 45.8005 },
  { lon: 15.951, lat: 45.8005 },
  { lon: 15.951, lat: 45.802 },
];
const B2_PTS = [
  { lon: 16.0, lat: 45.82 },
  { lon: 16.001, lat: 45.822 },
];
const shapesRow = (id: string, seq: number, p: { lon: number; lat: number }): string => `${id},${p.lat},${p.lon},${seq},\n`;
const SHAPES_TXT =
  'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled\n' +
  shapesRow('T1_shape', 1, { lon: T1_LON, lat: T1_LAT_0 }) +
  shapesRow('T1_shape', 2, { lon: T1_LON, lat: (T1_LAT_0 + T1_LAT_1) / 2 }) +
  shapesRow('T1_shape', 3, { lon: T1_LON, lat: T1_LAT_1 }) +
  shapesRow('T2_shape', 1, T2_A) +
  shapesRow('T2_shape', 2, T2_B) +
  shapesRow('T2_shape', 3, T2_C) +
  B1_PTS.map((p, i) => shapesRow('B1_shape', i + 1, p)).join('') +
  B2_PTS.map((p, i) => shapesRow('B2_shape', i + 1, p)).join('');
const S_CLOSE = { id: 'S_close', name: 'Blizu', lon: T1_LON, lat: (T1_LAT_0 + T1_LAT_1) / 2 };
const S_CLOSE2 = { id: 'S_close2', name: 'Blizu dva', lon: T1_LON, lat: T1_LAT_0 + 0.8 * (T1_LAT_1 - T1_LAT_0) };
const S_FAR = { id: 'S_far', name: 'Daleko', lon: 16.2, lat: 45.9 };
// 189 m and 186 m off T2's two ends: past the 40 m radius, so only the
// terminus override links them, and inside TERMINUS_STOP_MAX_METRES, which
// the served list holds every linked platform to.
const S_T2_START = { id: 'S_t2_start', name: 'T2 pocetak', lon: T2_A.lon, lat: T2_A.lat - 0.0017 };
const S_T2_END = { id: 'S_t2_end', name: 'T2 kraj', lon: T2_C.lon + 0.0024, lat: T2_C.lat };
// 50 m east of T2's first leg: past the 40 m geometric radius, so it gets no
// onEdge link at all, and inside SERVED_STOP_MAX_METRES, so the served list
// still places it (one x unit is ~0.78 m here).
const S_T2_SIDE = { id: 'S_t2_side', name: 'T2 sa strane', lon: T2_A.lon + 0.000644, lat: (T2_A.lat + T2_B.lat) / 2 };
const S_BUS = { id: 'S_bus', name: 'Autobusno', lon: 15.951, lat: 45.8015 };
const STOPS_TXT =
  'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station\n' +
  [S_CLOSE, S_CLOSE2, S_FAR, S_T2_START, S_T2_SIDE, S_T2_END, S_BUS].map((s) => `${s.id},,${s.name},,${s.lat},${s.lon},,,0,\n`).join('') +
  'S_blank_type,,Prazan location_type,,45.85,16.05,,,,\nS_parent,,Cvoriste (nadredena postaja),,45.86,16.06,,,1,\n';
const STOP_TIMES_TXT =
  'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type\n' +
  't2_trip_1,08:00:00,08:00:00,S_t2_start,1,,,\nt2_trip_1,08:02:00,08:02:00,S_t2_side,2,,,\n' +
  't2_trip_1,08:05:00,08:05:00,S_close,3,,,\nt2_trip_1,08:10:00,08:10:00,S_t2_end,4,,,\n' +
  't3_trip_1,09:00:00,09:00:00,S_close,1,,,\nt3_trip_1,09:03:00,09:03:00,S_close2,2,,,\n' +
  // t1_trip_2 gives T1_shape a served list (F8); t1_trip_1 stays without
  // stop_times, so the terminus override still leaves S_close at its arc.
  't1_trip_2,07:00:00,07:00:00,S_close,1,,,\nt1_trip_2,07:04:00,07:04:00,S_close2,2,,,\n';
const FEED_INFO_TXT = 'feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version\nZET,https://www.zet.hr,hr,20260901,20301231,000123\n';

/** T2's trip calls at S_close, a kilometre off T2's own rails: a shape's own
 *  platform off its drawn rails fails the build unless the overrides file
 *  names the gap, so every build of the full feed allows that one. */
const FULL_OVERRIDES = {
  servedGaps: [{ path: 'T2_shape', stop: 'S_close', reason: 'Test: T2 calls at a platform a kilometre off its rails.' }],
};

function makeFullZip(opts: { withFeedInfo?: boolean; stopTimes?: string } = {}): Uint8Array {
  const files: ZipInput[] = [
    { name: 'routes.txt', data: ROUTES_TXT, method: 8 },
    { name: 'trips.txt', data: TRIPS_TXT, method: 8 },
    { name: 'shapes.txt', data: SHAPES_TXT, method: 8 },
    { name: 'stops.txt', data: STOPS_TXT, method: 8 },
    { name: 'stop_times.txt', data: opts.stopTimes ?? STOP_TIMES_TXT, method: 8 },
  ];
  if (opts.withFeedInfo !== false) files.push({ name: 'feed_info.txt', data: FEED_INFO_TXT, method: 8 });
  return makeZip(files);
}

// Shapes come in as integer units (1e-5 deg); near ORIGIN one y unit is
// ~1.11 m and one x unit ~0.78 m, so 90 y units are ~100 m and 3 x units ~2.3 m.
type Units = [number, number][];
const yLine = (x: number, ys: number[]): Units => ys.map((y) => [x, y]);

describe('the rail graph', () => {
  it('cuts shared corridors into edges where the set of lines changes, keeps the two directions apart, merges a near-duplicate digitisation, and leaves an at-grade crossing as a junction', () => {
    // A corridor three lines share in overlapping stretches.
    const corridor = buildRailGraph([yLine(0, [0, 90, 180, 270]), yLine(0, [90, 180, 270, 360]), yLine(0, [0, 90, 180])]);
    expect(corridor.edges).toHaveLength(4);
    expect(corridor.nodeCount).toBe(5);
    const owners = corridor.edges.map((e: any) => [...e.owners].sort());
    expect(owners).toEqual(expect.arrayContaining([[0, 2], [0, 1, 2], [0, 1], [1]]));
    for (const seq of corridor.shapeEdges) for (let k = 1; k < seq.length; k++) expect(corridor.edges[seq[k]].from).toBe(corridor.edges[seq[k - 1]].to);
    expect(corridor.shapeEdges[0].slice(1)).toEqual(corridor.shapeEdges[1].slice(0, 2));

    // The same run both ways: two opposite edges, never one.
    const bothWays = buildRailGraph([yLine(0, [0, 90, 180]), yLine(0, [180, 90, 0])]);
    expect(bothWays.edges).toHaveLength(2);
    expect(bothWays.edges[0].from).toBe(bothWays.edges[1].to);
    expect(bothWays.edges[0].to).toBe(bothWays.edges[1].from);

    // A second digitisation 2.3 m off over 200 m merges into the first geometry;
    // the other track 7.8 m off does not, nor does a 20 m duplicate; a bent
    // twin with an extra collinear vertex adopts the reference geometry.
    const F = yLine(0, [0, 90, 180]);
    const merged = buildRailGraph([F, yLine(3, [0, 90, 180])]);
    expect(merged.edges).toHaveLength(1);
    expect([...merged.edges[0].owners].sort()).toEqual([0, 1]);
    expect(merged.edges[0].units).toEqual(F);
    expect(merged.shapeEdges).toEqual([[0], [0]]);
    expect(merged.report.snappedRuns).toBe(1);
    expect(merged.report.residualPairs).toEqual([]);
    expect(buildRailGraph([F, yLine(10, [0, 90, 180])]).edges).toHaveLength(2);
    expect(buildRailGraph([F, yLine(3, [0, 18])]).report.snappedRuns).toBe(0);
    const adopted = buildRailGraph([F, yLine(0, [0, 45, 180])]);
    expect(adopted.edges).toHaveLength(1);
    expect(adopted.edges[0].units).toEqual(F);
    // With snapping off the same duplicate is reported as a residual, never hidden.
    expect(buildRailGraph([F, yLine(3, [0, 90, 180])], { snap: false }).report.residualPairs).toHaveLength(1);

    // Two lines crossing at grade through one shared point: four edges, five nodes, no merge.
    const crossing = buildRailGraph([
      [[-100, 0], [0, 0], [100, 0]],
      [[0, -100], [0, 0], [0, 100]],
    ]);
    expect(crossing.edges).toHaveLength(4);
    expect(crossing.nodeCount).toBe(5);
    expect(crossing.report.snappedRuns).toBe(0);
    for (const e of crossing.edges) expect([...e.owners]).toHaveLength(1);
  });
});

describe('buildNetwork', () => {
  it('cuts a synthetic feed into the version 3 artefact: trams on the graph, buses as polylines, stops at exact arcs and terminal flags, a synthetic path through its stops, a served list per path, a decodable superset, and it refuses a path it cannot route', async () => {
    const net = await buildNetwork(makeFullZip(), { diagramBusCount: 1, overrides: FULL_OVERRIDES });
    expect(net.version).toBe(3);
    expect(net.feedVersion).toBe('000123');
    for (const key of SHAPE_KEYS) expect(net.shapes[key]).toHaveLength(4);
    for (const key of EDGE_KEYS) expect(net.edges[key]).toHaveLength(2);
    for (const key of PATH_KEYS) expect(net.paths[key]).toHaveLength(1);
    for (const key of STOP_KEYS) expect(net.stops[key]).toHaveLength(8); // S_parent (location_type 1) is dropped

    const routes = routesOf(net);
    expect(new Set(routes.map((r: any) => r.rank)).size).toBe(5);
    expect(routes.filter((r: any) => ['T1', 'T2', 'T3'].includes(r.id)).every((r: any) => r.rank <= 3)).toBe(true);
    expect(routes.find((r: any) => r.id === 'T3').shapes).toEqual([]);

    const shapes = shapesOf(net);
    const t1 = shapes.find((s: any) => s.id === 'T1_shape');
    const t2 = shapes.find((s: any) => s.id === 'T2_shape');
    const b1 = shapes.find((s: any) => s.id === 'B1_shape');
    expect(t1).toMatchObject({ d: [], dir: 0 });
    expect(t1.e).toHaveLength(1);
    expect(t2).toMatchObject({ dir: 1 });
    expect(t2.e).toHaveLength(1);
    expect(t1.e[0]).not.toBe(t2.e[0]);
    expect(b1).toMatchObject({ e: [], dir: -1 });
    expect(b1.d.length).toBeGreaterThanOrEqual(4);
    const edgeUnits = decodeEdgeChain(edgesOf(net).map((e: any) => e.d));
    const t1Points = edgeUnits[t1.e[0]].map(unitsToLonLat);
    const t2Points = edgeUnits[t2.e[0]].map(unitsToLonLat);
    expect(t1Points).toHaveLength(2); // the collinear midpoint is gone from the edge interior
    expect(t2Points).toHaveLength(3); // the corner survives
    expect(t1Points[0].lat).toBeCloseTo(T1_LAT_0, 4);
    expect(t1Points[1].lat).toBeCloseTo(T1_LAT_1, 4);
    expect(t2Points[2].lon).toBeCloseTo(T2_C.lon, 4);

    const stops = stopsOf(net);
    const byId = Object.fromEntries(stops.map((s: any) => [s.id, s]));
    const t1Len = polylineLength(t1Points.map((p) => toMetres(p.lon, p.lat)));
    const t2Len = polylineLength(t2Points.map((p) => toMetres(p.lon, p.lat)));
    expect(byId.S_close.onEdge).toEqual([[t1.e[0], expect.closeTo(t1Len / 2, 0)]]);
    expect(byId.S_close2.onEdge).toEqual([[t1.e[0], expect.closeTo(0.8 * t1Len, 0)]]);
    expect(byId.S_close.on).toEqual([]);
    expect(byId.S_far.on).toEqual([]);
    expect(byId.S_far.onEdge).toEqual([]);
    expect(byId.S_t2_start.onEdge).toEqual([[t2.e[0], 0]]); // the terminus override, 189 m off the rails
    expect(byId.S_t2_end.onEdge).toEqual([[t2.e[0], expect.closeTo(t2Len, 0)]]);
    const busOn = byId.S_bus.on.find((e: any) => e[0] === shapes.indexOf(b1));
    expect(busOn[1]).toBeGreaterThan(0.5);
    expect(busOn[1]).toBeLessThan(1);
    expect(byId.S_bus.onEdge).toEqual([]);

    const [path] = pathsOf(net);
    expect(path).toMatchObject({ id: `path:T3:0:${stopSequenceHash(['S_close', 'S_close2'])}`, route: 'T3', dir: 0, e: [t1.e[0]], stops: ['S_close', 'S_close2'] });

    // F8, the served list: the platforms a path's own trips call at, in arc
    // order, as [stopIdx, decimetres]. T1's own trip calls at both platforms
    // on its edge. T2's trip also calls at S_close, which lies over a
    // kilometre off T2's rails: dropped, never invented at an arc of its own,
    // and allowed only because the overrides file names the gap. A bus shape
    // runs no path and serves nothing.
    const servedIds = (row: any) => row.served.map(([i, dm]: [number, number]) => [stops[i].id, dm / 10]);
    expect(servedIds(t1)).toEqual([['S_close', expect.closeTo(t1Len / 2, 0)], ['S_close2', expect.closeTo(0.8 * t1Len, 0)]]);
    // S_t2_side has no edge link (50 m off the rails) but lies inside the
    // served radius, so the served list projects it onto the path; S_close,
    // over a kilometre away, is dropped and reported instead.
    expect(byId.S_t2_side.onEdge).toEqual([]);
    expect(servedIds(t2).map(([id]: [string, number]) => id)).toEqual(['S_t2_start', 'S_t2_side', 'S_t2_end']);
    const [, sideArc] = servedIds(t2)[1];
    expect(sideArc).toBeGreaterThan(50); // halfway along the 111 m first leg
    expect(sideArc).toBeLessThan(60);
    expect(servedIds(t2)[2][1]).toBeCloseTo(t2Len, 0);
    expect(b1.served).toEqual([]);
    expect(servedIds(path)).toEqual([['S_close', expect.closeTo(t1Len / 2, 0)], ['S_close2', expect.closeTo(0.8 * t1Len, 0)]]);
    const { report } = await buildNetwork(makeFullZip(), { diagramBusCount: 1, overrides: FULL_OVERRIDES });
    expect(report.servedDropped).toEqual([{ path: 'T2_shape', route: 'T2', stop: 'S_close', name: 'Blizu', metres: expect.any(Number) }]);
    expect(report.servedGapsAllowed).toEqual([
      { path: 'T2_shape', route: 'T2', stop: 'S_close', name: 'Blizu', metres: expect.any(Number), allowed: FULL_OVERRIDES.servedGaps[0].reason },
    ]);
    expect(report.servedGapsAllowed[0].metres).toBeGreaterThan(1000);

    // Terminal: the first or last stop of some trip, wherever it is.
    expect(stops.filter((s: any) => s.terminal === 1).map((s: any) => s.id).sort()).toEqual(['S_close', 'S_close2', 'S_t2_end', 'S_t2_start']);

    const lines = linesOf(net);
    expect(new Set(lines.map((l: any) => l.route))).toEqual(new Set(['T1', 'T2', 'B1']));
    const eighth = Math.PI / 4;
    for (const line of lines) {
      for (let i = 1; i < line.pts.length; i++) {
        const angle = Math.atan2(line.pts[i][1] - line.pts[i - 1][1], line.pts[i][0] - line.pts[i - 1][0]);
        const mod = ((angle % eighth) + eighth) % eighth;
        expect(Math.min(mod, eighth - mod)).toBeLessThan(1e-4);
      }
    }

    // The shared decoder reads it back as the version 1 superset the client draws from.
    const decoded = decodeNetwork(net);
    const t1Idx = shapes.indexOf(t1);
    expect(decoded.shapes[t1Idx].pts).toHaveLength(2);
    expect(decoded.shapes[t1Idx].len).toBeCloseTo(t1Len, 0);
    expect(decoded.stops.find((s) => s.id === 'S_close')!.on.find((o) => o.shape === t1Idx)?.s).toBeCloseTo(t1Len / 2, 0);
    expect(decoded.nextStop(t1Idx, 0)?.stop.id).toBe('S_close');
    expect(decoded.nextStop(t1Idx, t1Len / 2 + 1)?.stop.id).toBe('S_close2');
    expect(decoded.paths.filter((p) => p.shape === null).map((p) => p.route)).toEqual(['T3']);
    expect(decoded.paths[0].served?.map((e) => decoded.stops[e.stop].id)).toEqual(['S_close', 'S_close2']);
    expect(decoded.stops.find((s) => s.id === 'S_close')!.terminal).toBe(true);
    expect(decoded.stops.find((s) => s.id === 'S_bus')!.terminal).toBe(false);

    // The CLI writes the artefact and the meta constants for the same feed.
    const dir = await mkdtemp(join(tmpdir(), 'zet-network-'));
    const result = await main({
      fetchImpl: async () => new Response(makeFullZip(), { status: 200 }),
      cwd: dir,
      out: 'data/zet-network.json',
      metaOut: 'motion/network-meta.ts',
      diagramBusCount: 1,
      log: () => {},
      now: () => new Date('2026-09-12T12:00:00.000Z'),
      overrides: FULL_OVERRIDES,
    });
    expect(result).toMatchObject({ routeCount: 5, edgeCount: 2, pathCount: 1 });
    expect(JSON.parse(await readFile(join(dir, 'data/zet-network.json'), 'utf8'))).toMatchObject({ version: 3, feedVersion: '000123', builtAt: '2026-09-12T12:00:00.000Z' });
    const meta = await readFile(join(dir, 'motion/network-meta.ts'), 'utf8');
    expect(meta).toContain('export const FEED_VERSION = "000123";');
    expect(meta).toContain('export const EDGE_COUNT = 2;');

    // A shapeless pattern whose stop is off the rails fails the build, naming the route.
    const offRails = STOP_TIMES_TXT.replace('t3_trip_1,09:03:00,09:03:00,S_close2,2,,,', 't3_trip_1,09:03:00,09:03:00,S_far,2,,,');
    await expect(buildNetwork(makeFullZip({ stopTimes: offRails }), { diagramBusCount: 1, overrides: FULL_OVERRIDES })).rejects.toThrow(/T3/);
    // Without feed_info.txt the archive's mtime names the feed; without either the build refuses.
    expect((await buildNetwork(makeFullZip({ withFeedInfo: false }), { fallbackMtime: '2026-08-15T00:00:00.000Z', diagramBusCount: 1, overrides: FULL_OVERRIDES })).feedVersion).toBe('2026-08-15T00:00:00.000Z');
    await expect(buildNetwork(makeFullZip({ withFeedInfo: false }), {})).rejects.toThrow(/feedVersion/);
  });
});

// Measured on feed 000395 (WP0): the platforms of a tram pattern that lie
// more than SERVED_STOP_MAX_METRES from the pattern's own path, by path and
// stop. A first or last stop within TERMINUS_STOP_MAX_METRES: Zapruđe 1780_18,
// 130 m past the end of line 8's rails, and Zapadni kolodvor on two of line
// 1's paths. Trimmed off a synthetic path's end: line 1 out of Zapadni
// kolodvor and past Talovčeva, where no shape draws the rails.
const TERMINUS_CASES = ['8_18 1780_18', '8_42 1780_18', 'path:1:0:cd13fb90 317_1', 'path:1:1:43a84913 317_2', 'path:8:0:dce55b90 1780_18'];
const TRIMMED_CASES = ['path:1:0:102900d1 317_1', 'path:1:1:7e51cfc2 293_4', 'path:1:1:7e51cfc2 317_2'];

describe('the committed artefact', () => {
  const artefactPath = resolve(process.cwd(), 'app/public/data/zet-network.json');
  // R-TE11: the measured version 2 size plus a fifth. Measured at the first v2
  // build (feed 000395, 16 Sept 2026): 533,535 B raw, 125,866 B gzip; v1 was
  // 542,147 B raw. Pins: 640 KiB raw (655,360 B), 150 KiB gzip (153,600 B).
  // Version 3 (F8) adds the served lists and the terminal flags: 576,279 B
  // raw, 135,611 B gzip on the same feed -- 8 % and 8 % more, still 12 % and
  // 12 % inside the v2 pins, which therefore stand rather than being loosened
  // to fit what was just measured. F8b adds the seven synthetic paths the
  // 40 m router could not build: 581,140 B raw, 136,408 B gzip -- another
  // 0.8 %, and still 11 % inside both pins, which again stand. F8c nodes
  // three crossings (six edges become twelve) and shortens nine plans:
  // 581,016 B raw, 136,412 B gzip -- 124 bytes SMALLER raw, 4 larger gzipped.
  // Both pins stand again. WP0 adds three connectors and sixteen terminus
  // loops, cutting seven long edges where the loops leave them: 582,808 B raw,
  // 136,897 B gzip, 0.3 % and 0.4 % more; the pins stand.
  const RAW_BUDGET_BYTES = 640 * 1024;
  const GZIP_BUDGET_BYTES = 150 * 1024;

  it('is version 3, inside the re-pinned budget, cut from the feed the meta names, gives every tram route rails to run on with the main square on every one that passes it, and carries a served list on every tram path', () => {
    const raw = readFileSync(artefactPath);
    console.log(`zet-network.json: ${raw.byteLength} B raw (budget ${RAW_BUDGET_BYTES} B), ${gzipSync(raw).byteLength} B gzipped (budget ${GZIP_BUDGET_BYTES} B)`);
    expect(raw.byteLength).toBeLessThan(RAW_BUDGET_BYTES);
    expect(gzipSync(raw).byteLength).toBeLessThan(GZIP_BUDGET_BYTES);
    const parsed = JSON.parse(raw.toString('utf8'));
    expect(parsed.version).toBe(3);
    expect(parsed.feedVersion).toBe(FEED_VERSION);
    for (const wireOn of parsed.stops.on) for (const [, scaled] of wireOn) expect(scaled).toBeLessThanOrEqual(BUS_ON_FRAC_SCALE);

    // F8c: the artefact names the rail graph its edge indices belong to, and
    // the name is a function of those edges. Recomputed here from the WIRE
    // columns, not the decoded floats, because that is what the builder
    // hashes -- and independently of the builder's own helper.
    expect(parsed.graphHash).toMatch(/^[0-9a-f]{16}$/);
    const recomputed = createHash('sha256');
    for (let i = 0; i < parsed.edges.from.length; i++) recomputed.update(`${parsed.edges.from[i]}:${parsed.edges.to[i]}:${parsed.edges.d[i].join(',')}
`);
    expect(parsed.graphHash).toBe(recomputed.digest('hex').slice(0, 16));

    const net = decodeNetwork(parsed);
    expect(net.graphHash).toBe(parsed.graphHash);
    // F8c: 287 plus two halves for each of the three junctions noded; WP0: plus
    // the three connectors of gtfs-shapes-overrides.json (Glavni kolodvor, the
    // top of the Mihaljevac loop, a joint in line 12's Dubrava loop) and the
    // seven pieces the terminus loops cut off their long boundary edges.
    expect(net.edges).toHaveLength(303);
    // F8b's seven brought the patterns' own synthetic paths to 52; F8c moved
    // none. The terminus loops are counted in their own test below.
    expect(net.paths.filter((p) => p.shape === null && p.direction !== LOOP_DIRECTION)).toHaveLength(52);
    expect(net.routes.size).toBeGreaterThan(100); // the real ZET feed has 154 routes
    const trams = [...net.routes.entries()].filter(([, r]) => r.type === 0);
    expect(trams.length).toBeGreaterThanOrEqual(15);
    for (const [routeId, route] of trams) {
      const onGraph = route.shapes.some((shapeIdx) => (net.shapes[shapeIdx].edges?.length ?? 0) > 0) || net.paths.some((p) => p.route === routeId && p.shape === null);
      expect(onGraph, `tram route ${routeId} has no path on the graph`).toBe(true);
    }
    expect(net.paths.some((p) => p.route === '1' && p.shape === null)).toBe(true); // line 1 has no shape_id in the feed
    const used = new Set<number>();
    for (const path of net.paths) {
      for (let k = 0; k < path.edges.length; k++) {
        used.add(path.edges[k]);
        if (k > 0) expect(net.edges[path.edges[k]].from).toBe(net.edges[path.edges[k - 1]].to);
      }
    }
    expect(used.size).toBe(net.edges.length);

    // R-T1: the stop gate must see the main square on every tram shape that passes it.
    const square = net.stops.find((s) => s.name === 'Trg bana J. Jelačića')!;
    const onSet = new Set(square.on.map((o) => o.shape));
    const tramRouteIds = new Set(trams.map(([id]) => id));
    let nearTramCount = 0;
    net.shapes.forEach((shape, shapeIdx) => {
      if (!tramRouteIds.has(shape.route)) return;
      if (distanceToPolyline(square.p, shape.pts) <= STOP_SHAPE_MAX_METRES + SNAP_METRES) {
        nearTramCount++;
        expect(onSet.has(shapeIdx), `shape ${shape.id} passes the square but does not list it`).toBe(true);
      }
    });
    expect(nearTramCount).toBeGreaterThan(12);

    // F8: every tram path -- shape path and synthetic alike -- knows the
    // platforms its own trips call at, and that list is a strict, arc-ordered
    // subset of what lies geometrically on its edges. (A terminus loop serves
    // only its two ends, sometimes one: its own test below.)
    const tramPaths = net.paths.filter((p) => net.routes.get(p.route)?.type === 0 && p.direction !== LOOP_DIRECTION);
    expect(tramPaths).toHaveLength(152);
    for (const path of tramPaths) {
      const idx = net.paths.indexOf(path);
      expect(path.served?.length, `path ${path.id} has no served list`).toBeGreaterThan(1);
      const served = net.stopsOnPath(idx);
      const geometric = new Set(net.stopsOnPathGeometric(idx).map((e) => e.stop.id));
      for (let k = 1; k < served.length; k++) expect(served[k].s, `path ${path.id} arcs out of order`).toBeGreaterThanOrEqual(served[k - 1].s);
      for (const entry of served) expect(geometric.has(entry.stop.id) || entry.s <= path.len, `path ${path.id} serves ${entry.stop.id} off its own arc`).toBe(true);
      expect(served.length).toBeLessThanOrEqual(geometric.size);
    }
    // The terminus flag reaches the ends of the network, not every platform.
    const terminals = net.stops.filter((s) => s.terminal);
    expect(terminals.length).toBe(464);
    expect(terminals.length).toBeLessThan(net.stops.length / 2);
    expect(net.stops.find((s) => s.name === 'Trg bana J. Jelačića')!.terminal).toBe(false);
  });


  // F8c: no synthetic path plans a hop the long way round any more. Before
  // F8c nine hops of routes 6, 9, 13 and 17 ran 4.2 to 6.4 times the straight
  // line between their two platforms -- the rail graph had no node where the
  // line turned, because no shape in the feed draws that turn -- and a plan
  // 2 km long for 300 m of ground puts a phantom tram on rails other lines
  // share, where the ordering law then constrains real ones. F8c noded three
  // crossings; the last two legs, Botanički vrt -> Zrinjevac on routes 6 and
  // 9, stood allowlisted at 3,242 m until the Glavni kolodvor connector (WP0).
  it('plans no hop the long way round, and allowlists none', () => {
    const net = decodeNetwork(JSON.parse(readFileSync(artefactPath).toString('utf8')));
    const overrides = JSON.parse(readFileSync(resolve(process.cwd(), 'scripts/gtfs-shapes-overrides.json'), 'utf8'));
    const long: string[] = [];
    for (const path of net.paths) {
      if (path.shape !== null) continue; // a shape path runs geometry that was drawn, not routed
      if (path.direction === LOOP_DIRECTION) continue; // a terminus loop's one hop is the turn itself
      const served = path.served ?? [];
      for (let k = 1; k < served.length; k++) {
        const a = net.stops[served[k - 1].stop];
        const b = net.stops[served[k].stop];
        const along = served[k].s - served[k - 1].s;
        const straight = Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y);
        if (along > straight * HOP_DETOUR_FACTOR && along - straight > HOP_DETOUR_EXCESS_METRES) {
          long.push(`${path.route} ${a.name} -> ${b.name} (${Math.round(along)} m of arc for ${Math.round(straight)} m of ground)`);
        }
      }
    }
    expect(long).toEqual([]);
    expect(overrides.longLegs ?? []).toEqual([]);

    // And the three crossings that were noded are nodes: route 13 turns out
    // of Šubićeva into Kralja Zvonimira, and route 6 out of the southbound
    // centre track into Mihanovićeva, in a few hundred metres rather than two
    // kilometres of arc.
    const hop = (pathId: string, from: string, to: string) => {
      const path = net.paths.find((p) => p.id === pathId)!;
      const served = path.served!;
      const k = served.findIndex((entry, i) => i > 0 && net.stops[served[i - 1].stop].name === from && net.stops[entry.stop].name === to);
      expect(k, `${pathId} does not run ${from} -> ${to}`).toBeGreaterThan(0);
      return served[k].s - served[k - 1].s;
    };
    expect(hop('path:13:1:129fd87e', 'Šubićeva', 'Trg žrt. fašizma')).toBeLessThan(400); // was 1779 m
    expect(hop('path:13:0:096d3646', 'Trg žrt. fašizma', 'Šubićeva')).toBeLessThan(700); // was 2122 m
    expect(hop('path:6:0:840b2879', 'Zrinjevac', 'Botanički vrt')).toBeLessThan(900); // was 3261 m
    // ...and the turn no crossing could express runs the Glavni kolodvor
    // connector: west to north in one hop, as the ground runs.
    expect(hop('path:6:1:e641be7c', 'Botanički vrt', 'Zrinjevac')).toBeLessThan(900); // was 3242 m
    expect(hop('path:9:0:892fe989', 'Botanički vrt', 'Zrinjevac')).toBeLessThan(900); // was 3242 m
  });

  // WP0: the connectors of gtfs-shapes-overrides.json are in the graph, each
  // one directed edge between the two nodes its points name, run only by the
  // lines it names -- and by at least one path of them.
  it('carries each connector the overrides file names as one short edge, run only by its own lines', () => {
    const parsed = JSON.parse(readFileSync(artefactPath).toString('utf8'));
    const net = decodeNetwork(parsed);
    const overrides = JSON.parse(readFileSync(resolve(process.cwd(), 'scripts/gtfs-shapes-overrides.json'), 'utf8'));
    const connectors = overrides.connectors as { from: [number, number]; to: [number, number]; routes: string[]; reason: string }[];
    expect(connectors.length).toBe(3);
    const near = (p: { x: number; y: number }, point: [number, number]) => {
      const [lon, lat] = toLonLat(p);
      const a = toMetres(lon, lat);
      const b = toMetres(point[0], point[1]);
      return Math.hypot(a.x - b.x, a.y - b.y) <= CONNECTOR_SNAP_METRES;
    };
    for (const connector of connectors) {
      expect(connector.reason.length, JSON.stringify(connector.from)).toBeGreaterThan(100);
      const found = net.edges
        .map((edge, idx) => ({ edge, idx }))
        .filter(({ edge }) => near(edge.pts[0], connector.from) && near(edge.pts[edge.pts.length - 1], connector.to));
      expect(found, `connector ${connector.from} -> ${connector.to}`).toHaveLength(1);
      const [{ edge, idx }] = found;
      expect(edge.pts).toHaveLength(2);
      expect(edge.len).toBeLessThan(20);
      const users = net.paths.filter((p) => p.edges.includes(idx));
      expect(users.length).toBeGreaterThan(0);
      for (const user of users) expect(connector.routes, `${user.id} runs the connector at ${connector.from}`).toContain(user.route);
    }
  });

  // F8b: no shapeless tram pattern is left without rails of its own. Before
  // it, seven patterns of routes 2, 5 and 13 (13/0 with 356 trips a day, 13/1
  // with 384, 5/1 with 162, 2/1 with 150) had no synthetic path at all, so
  // their trips were matched onto whichever path of the route happened to lie
  // nearest and planned by another pattern's timetable.
  it('gives every shapeless tram pattern of the trip index a synthetic path over its own stops', () => {
    const net = decodeNetwork(JSON.parse(readFileSync(artefactPath).toString('utf8')));
    const index: any = JSON.parse(readFileSync(resolve(process.cwd(), 'app/public/data/zet-trips.json'), 'utf8'));
    expect(index.feedVersion).toBe(net.feedVersion);
    const tramRouteIds = new Set([...net.routes.entries()].filter(([, r]) => r.type === 0).map(([id]) => id));
    const patterns = index.patterns.route
      .map((route: string, i: number) => ({ route, direction: index.patterns.direction[i], shape: index.patterns.shape[i], stops: index.patterns.stops[i] as string[], trips: index.patterns.trips[i] }))
      .filter((p: any) => p.shape === '' && tramRouteIds.has(p.route));
    expect(patterns).toHaveLength(52);

    const exactByStops = new Map(net.paths.filter((p) => p.shape === null).map((p) => [`${p.route}|${p.direction}|${(p.stops ?? []).join(',')}`, p] as const));
    const withoutExact = patterns.filter((p: any) => !exactByStops.has(`${p.route}|${p.direction}|${p.stops.join(',')}`));
    // The only three left are line 1's, where the rails past Zapadni kolodvor
    // are drawn by no shape in the feed at all: the builder trims that stretch
    // (TERMINUS_TRIM_STOPS) and each still reaches a path that is a contiguous
    // run of its own stops, which is what the timetable mapping asks for.
    expect(withoutExact.map((p: any) => `${p.route}/${p.direction}(${p.stops.length})`)).toEqual(['1/0(14)', '1/1(15)', '1/1(9)']);
    const SEP = '>'; // no stop id contains it, so a run of the joined text is a run of whole ids
    for (const pattern of withoutExact) {
      const runs = net.paths.filter((p) => p.shape === null && p.route === pattern.route && p.direction === pattern.direction)
        .filter((p) => pattern.stops.join(SEP).includes((p.stops ?? []).join(SEP)));
      expect(runs.map((p) => p.id), `pattern ${pattern.route}/${pattern.direction}`).toHaveLength(1);
    }
    // Every one of the 52 reaches a path, and its own stops in order.
    for (const pattern of patterns) {
      const exact = exactByStops.get(`${pattern.route}|${pattern.direction}|${pattern.stops.join(',')}`);
      if (!exact) continue;
      expect(exact.stops, `pattern ${pattern.route}/${pattern.direction}`).toEqual(pattern.stops);
      const idx = net.paths.indexOf(exact);
      expect(net.stopsOnPath(idx).map((e) => e.stop.id), `served of ${exact.id}`).toEqual(pattern.stops);
    }
  });

  // WP0: the build refuses a platform a shape's own trips call at that lies
  // off that shape (servedGaps), and routes every shapeless pattern through
  // its own stops; this is the same promise read back through the trip index
  // the twin uses. Every tram pattern's resolved path passes within the served
  // radius of each of its platforms, bar two kinds of end the feed's shapes do
  // not reach: a terminus set back past the drawn rails (Zapruđe 1780_18,
  // 130 m past the end of line 8's shapes) and the stretch the builder trims
  // off a synthetic path where no shape draws the rails at all (line 1 out of
  // Zapadni kolodvor, TERMINUS_TRIM_STOPS).
  it('lays every tram pattern of the trip index within the served radius of its own path, bar a set-back terminus and the trimmed ends', () => {
    const net = decodeNetwork(JSON.parse(readFileSync(artefactPath).toString('utf8')));
    const index = decodeTripIndex(JSON.parse(readFileSync(resolve(process.cwd(), 'app/public/data/zet-trips.json'), 'utf8')));
    const mapping = mapPatternsToPaths(net, index);
    const byId = new Map(net.stops.map((stop) => [stop.id, stop] as const));
    const off: string[] = [];
    const terminus = new Set<string>();
    const trimmed = new Set<string>();
    let tramPatterns = 0;
    index.patterns.forEach((pattern, patternIdx) => {
      if (net.routes.get(pattern.route)?.type !== 0) return;
      tramPatterns++;
      const pathIdx = mapping.pathOf[patternIdx];
      expect(pathIdx, `pattern ${patternIdx} of route ${pattern.route} has no path`).not.toBeNull();
      const path = net.paths[pathIdx!];
      expect(path.direction).not.toBe(LOOP_DIRECTION); // a loop is never a pattern's path
      pattern.stops.forEach((stopId, k) => {
        const stop = byId.get(stopId)!;
        const { d } = net.projectOntoPath(pathIdx!, stop.p);
        if (d <= SERVED_STOP_MAX_METRES) return;
        const last = pattern.stops.length - 1;
        if ((k === 0 || k === last) && d <= TERMINUS_STOP_MAX_METRES) {
          terminus.add(`${path.id} ${stopId}`);
          return;
        }
        const nearEnd = k < TERMINUS_TRIM_STOPS || k > last - TERMINUS_TRIM_STOPS;
        if (path.shape === null && nearEnd && !(path.stops ?? []).includes(stopId)) {
          trimmed.add(`${path.id} ${stopId}`);
          return;
        }
        off.push(`${path.id} (route ${pattern.route}) ${stopId} "${stop.name}" ${Math.round(d)} m`);
      });
    });
    expect(tramPatterns).toBe(152); // 100 by shape, 49 exact synthetic, 3 trimmed (times.test.ts)
    expect(off).toEqual([]);
    // Pinned by name, measured on feed 000395, so a new such case fails here
    // rather than passing unnoticed.
    expect([...terminus].sort()).toEqual(TERMINUS_CASES);
    expect([...trimmed].sort()).toEqual(TRIMMED_CASES);
  });

  // WP0: terminus loops. A loop runs from one path's last edge to another
  // path's first, of the same line, between a trip's last platform and the
  // next trip's first -- only where the feed's shapes (or a connector) draw the
  // rails between them. The properties, not the list: every such pair whose
  // rails are drawn within LOOP_MAX_METRES has its loop, and every loop is its
  // own line's, joins the two paths it names and is at most LOOP_MAX_METRES
  // long as the artefact carries it, boundary edges included.
  it('joins every trip\'s last platform to the next trip\'s first over the line\'s drawn rails, each loop at most LOOP_MAX_METRES long', () => {
    const net = decodeNetwork(JSON.parse(readFileSync(artefactPath).toString('utf8')));
    const loops = net.paths.map((path, idx) => ({ path, idx })).filter(({ path }) => path.direction === LOOP_DIRECTION);
    expect(loops.length).toBeGreaterThan(0);
    console.log(`zet-network.json: ${loops.length} terminus loops`);
    const own = net.paths.map((path, idx) => ({ path, idx })).filter(({ path }) => path.direction !== LOOP_DIRECTION && net.routes.get(path.route)?.type === 0);
    const at = (id: string) => net.stops.find((stop) => stop.id === id)!.p;
    for (const { path, idx } of loops) {
      expect(path).toMatchObject({ shape: null });
      expect(path.id.startsWith(`${LOOP_ID_PREFIX}${path.route}:`), path.id).toBe(true);
      const [L, F] = path.stops!;
      expect(path.stops).toHaveLength(2);
      expect(L).not.toBe(F);
      expect(Math.hypot(at(L).x - at(F).x, at(L).y - at(F).y)).toBeLessThanOrEqual(LOOP_PAIR_MAX_METRES);
      // Its own line's: it starts on the last edge of a path of that line that
      // ends at L, and ends on the first edge of one that starts at F.
      const arriving = own.filter(({ path: p, idx: i }) => p.route === path.route && p.edges.at(-1) === path.edges[0] && net.stopsOnPath(i).at(-1)?.stop.id === L);
      expect(arriving.length, `${path.id}: no path of line ${path.route} ends at ${L} on edge ${path.edges[0]}`).toBeGreaterThan(0);
      const departing = own.filter(({ path: p, idx: i }) => p.route === path.route && p.edges[0] === path.edges.at(-1) && net.stopsOnPath(i)[0]?.stop.id === F);
      expect(departing.length, `${path.id}: no path of line ${path.route} starts at ${F} on edge ${path.edges.at(-1)}`).toBeGreaterThan(0);
      // The whole exported path, boundary edges and all, is the turn.
      expect(path.len, path.id).toBeLessThanOrEqual(LOOP_MAX_METRES);
      for (let k = 1; k < path.edges.length; k++) expect(net.edges[path.edges[k]].from).toBe(net.edges[path.edges[k - 1]].to);
      // It serves its two ends and nothing else, L no later than F (a join of
      // length 0 has both at one arc).
      const served = net.stopsOnPath(idx);
      expect(served.length, path.id).toBeGreaterThan(0);
      expect(served.every(({ stop }) => stop.id === L || stop.id === F), path.id).toBe(true);
      if (served.length === 2) {
        expect(new Set(served.map(({ stop }) => stop.id))).toEqual(new Set([L, F]));
        const arcOf = (id: string) => served.find(({ stop }) => stop.id === id)!.s;
        expect(arcOf(L), path.id).toBeLessThanOrEqual(arcOf(F));
      }
    }

    // Complete: recomputed here over the decoded graph, every pair (L, F) of a
    // line within LOOP_PAIR_MAX_METRES whose arriving edge reaches one of F's
    // departing edges over drawn rails with the whole exported path -- both
    // boundary edges included -- at most LOOP_MAX_METRES, over the departing
    // edge that makes it shortest, has a loop of that line from L to F that
    // starts on that arriving edge and ends on one of F's departing edges.
    const outgoing = new Map<number, number[]>();
    net.edges.forEach((edge, idx) => outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), idx]));
    /** Cheapest interior cost from the end of edge `from` to every node within the cap. */
    const reach = (from: number) => {
      const cost = new Map<number, number>([[net.edges[from].to, 0]]);
      const open = [net.edges[from].to];
      while (open.length > 0) {
        open.sort((a, b) => cost.get(a)! - cost.get(b)!);
        const node = open.shift()!;
        for (const e of outgoing.get(node) ?? []) {
          const next = net.edges[e].to;
          const c = cost.get(node)! + net.edges[e].len;
          if (c > LOOP_MAX_METRES) continue;
          if (!cost.has(next) || c < cost.get(next)!) {
            cost.set(next, c);
            if (!open.includes(next)) open.push(next);
          }
        }
      }
      return cost;
    };
    const missing: string[] = [];
    let pairs = 0;
    let qualifying = 0;
    for (const route of new Set(own.map(({ path }) => path.route))) {
      const mine = own.filter(({ path }) => path.route === route);
      const ends = new Map<string, Set<number>>();
      const starts = new Map<string, Set<number>>();
      for (const { path, idx } of mine) {
        const served = net.stopsOnPath(idx);
        if (served.length === 0) continue;
        const L = served.at(-1)!.stop.id;
        const F = served[0].stop.id;
        ends.set(L, (ends.get(L) ?? new Set()).add(path.edges.at(-1)!));
        starts.set(F, (starts.get(F) ?? new Set()).add(path.edges[0]));
      }
      for (const [L, lastEdges] of ends) {
        for (const [F, firstEdges] of starts) {
          if (L === F || Math.hypot(at(L).x - at(F).x, at(L).y - at(F).y) > LOOP_PAIR_MAX_METRES) continue;
          pairs++;
          for (const E of lastEdges) {
            const cost = reach(E);
            let shortest = Infinity;
            for (const D of firstEdges) {
              const interior = cost.get(net.edges[D].from);
              if (interior !== undefined) shortest = Math.min(shortest, net.edges[E].len + interior + net.edges[D].len);
            }
            if (shortest > LOOP_MAX_METRES) continue;
            qualifying++;
            const found = loops.some(({ path }) => path.route === route && path.stops![0] === L && path.stops![1] === F && path.edges[0] === E && firstEdges.has(path.edges.at(-1)!));
            if (!found) missing.push(`${route} ${L} -> ${F} from edge ${E} (${Math.round(shortest)} m)`);
          }
        }
      }
    }
    expect(qualifying).toBe(loops.length); // one loop per qualifying pair and arriving edge, none left over
    expect(pairs).toBeGreaterThan(50);
    expect(missing).toEqual([]);
  });
});

// F8b: the synthetic-path router over a miniature of the case that defeated
// it on feed 000395. Two tracks of one line run 7.8 m apart; the platform in
// the middle sits 39 m from the rail of the OTHER direction and 46.8 m from
// its own. At the 40 m geometric radius the only rail it reaches is the one
// it is not served from, and no chain exists; at SERVED_STOP_MAX_METRES it
// reaches its own and the chain is the obvious one. That is Olipska 251_2
// (39.4 m from the eastbound rail, 42.8 m from the westbound one it is
// served from), which left seven patterns of routes 2, 5 and 13 pathless.
const MINI_NORTH_X = 0;
const MINI_SOUTH_X = 10; // 7.8 m east: past SNAP_METRES, so the two tracks stay separate edges
const MINI_Y_END = 180; // ~200 m
const MINI_MID_X = 60; // 46.8 m from the north track, 39.0 m from the south one
const miniLonLat = (x: number, y: number) => ({ lon: ORIGIN[0] + x * SCALE, lat: ORIGIN[1] + y * SCALE });
/** An edge's own polyline, in the metre plane, straight off the wire. */
const edgePoints = (net: any, edge: number): { x: number; y: number }[] =>
  decodeEdgeChain(edgesOf(net).map((e: any) => e.d))[edge].map(([x, y]: [number, number]) => toMetres(ORIGIN[0] + x * SCALE, ORIGIN[1] + y * SCALE));
const MINI_STOPS = [
  { id: 'M_a', name: 'Pocetak', ...miniLonLat(MINI_NORTH_X, 0) },
  { id: 'M_mid', name: 'Olipska (mala)', ...miniLonLat(MINI_MID_X, 90) },
  { id: 'M_off', name: 'Izvan tracnica', ...miniLonLat(520, 90) }, // ~406 m east of both tracks
  { id: 'M_c', name: 'Kraj', ...miniLonLat(MINI_NORTH_X, MINI_Y_END) },
];

/** The mini feed: route MR draws both tracks, route MS runs them with no
 *  shape_id, so its pattern needs a synthetic path. `withOffRails` puts a
 *  stop 406 m from every rail in the middle of that pattern. */
function makeMiniZip(opts: { withOffRails?: boolean } = {}): Uint8Array {
  const shapeRows = [
    ...[0, 90, MINI_Y_END].map((y, i) => `MR_north,${miniLonLat(MINI_NORTH_X, y).lat},${miniLonLat(MINI_NORTH_X, y).lon},${i + 1},\n`),
    ...[MINI_Y_END, 90, 0].map((y, i) => `MR_south,${miniLonLat(MINI_SOUTH_X, y).lat},${miniLonLat(MINI_SOUTH_X, y).lon},${i + 1},\n`),
  ].join('');
  const called = opts.withOffRails ? ['M_a', 'M_mid', 'M_off', 'M_c'] : ['M_a', 'M_mid', 'M_c'];
  return makeZip([
    { name: 'routes.txt', data: 'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color\nMR,0,"90","Mali s oblikom",,0,,,\nMS,0,"91","Mali bez oblika",,0,,,\n', method: 8 },
    { name: 'trips.txt', data: 'route_id,service_id,trip_id,trip_headsign,trip_short_name,direction_id,block_id,shape_id\nMR,wd,mr_n,,,0,,MR_north\nMR,wd,mr_s,,,1,,MR_south\nMS,wd,ms_1,,,0,,\n', method: 8 },
    { name: 'shapes.txt', data: `shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled\n${shapeRows}`, method: 8 },
    { name: 'stops.txt', data: 'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station\n' + MINI_STOPS.map((s) => `${s.id},,${s.name},,${s.lat},${s.lon},,,0,\n`).join(''), method: 8 },
    {
      name: 'stop_times.txt',
      data: 'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type\n' +
        called.map((id, i) => `ms_1,0${8 + i}:00:00,0${8 + i}:00:00,${id},${i + 1},,,\n`).join(''),
      method: 8,
    },
    { name: 'feed_info.txt', data: FEED_INFO_TXT, method: 8 },
  ]);
}

describe('the synthetic-path router', () => {
  it('routes a hop the 40 m links cannot, over the served radius, and refuses a stop no rail reaches unless the overrides allow it', async () => {
    const net = await buildNetwork(makeMiniZip(), { diagramBusCount: 0 });
    const stops = stopsOf(net);
    const byId = Object.fromEntries(stops.map((s: any) => [s.id, s]));
    const shapes = shapesOf(net);
    const north = shapes.find((s: any) => s.id === 'MR_north').e[0];
    const south = shapes.find((s: any) => s.id === 'MR_south').e[0];
    expect(north).not.toBe(south);

    // The 40 m picture the wire carries: the middle platform reaches ONLY the
    // rail of the other direction. Its own is 46.8 m away, inside the served radius.
    expect(byId.M_mid.onEdge.map(([e]: [number, number]) => e)).toEqual([south]);
    expect(distanceToPolyline(toMetres(MINI_STOPS[1].lon, MINI_STOPS[1].lat), edgePoints(net, north))).toBeGreaterThan(STOP_SHAPE_MAX_METRES);
    expect(distanceToPolyline(toMetres(MINI_STOPS[1].lon, MINI_STOPS[1].lat), edgePoints(net, north))).toBeLessThan(SERVED_STOP_MAX_METRES);

    // The path exists all the same, over the north track, and serves all three stops.
    const [path] = pathsOf(net);
    expect(path).toMatchObject({ route: 'MS', dir: 0, e: [north], stops: ['M_a', 'M_mid', 'M_c'] });
    expect(path.served.map(([i]: [number, number]) => stops[i].id)).toEqual(['M_a', 'M_mid', 'M_c']);

    // The same router over the same graph, handed the 40 m links, has no chain:
    // the middle stop's only rail runs the other way.
    const edgeUnits = decodeEdgeChain(edgesOf(net).map((e: any) => e.d));
    const edgesRaw = edgesOf(net);
    const lens = edgeUnits.map((units: [number, number][]) => polylineLength(units.map(([x, y]) => toMetres(ORIGIN[0] + x * SCALE, ORIGIN[1] + y * SCALE))));
    const outgoing = new Map<number, number[]>();
    edgesRaw.forEach((e: any, idx: number) => outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), idx]));
    const asLinks = (stop: any) => stop.onEdge.map(([edge, metres]: [number, number]) => ({ edge, s: metres }));
    const at40 = [asLinks(byId.M_a), asLinks(byId.M_mid), asLinks(byId.M_c)];
    expect(() => pathThroughStops(edgesRaw, outgoing, lens, at40, 'mini')).toThrow(/no route over the rail graph/);
    // With its own rail in reach the chain is the north track, end to end.
    const at60 = [at40[0], [...at40[1], { edge: north, s: lens[north] / 2 }], at40[2]];
    expect(pathThroughStops(edgesRaw, outgoing, lens, at60, 'mini')).toEqual([north]);

    // A stop no rail reaches within the served radius stops the build by name,
    // and says where to allow it if that is really right.
    await expect(buildNetwork(makeMiniZip({ withOffRails: true }), { diagramBusCount: 0 })).rejects.toThrow(
      new RegExp(`M_off.*Izvan tracnica.*${SERVED_STOP_MAX_METRES} m.*gtfs-shapes-overrides\.json`),
    );
    // Allowlisted, the build routes past it: the path neither runs to it nor serves it.
    const allowed = await buildNetwork(makeMiniZip({ withOffRails: true }), {
      diagramBusCount: 0,
      overrides: { unreachableStops: [{ id: 'M_off', name: 'Izvan tracnica', reason: 'Test: a platform off every drawn rail.' }] },
    });
    expect(pathsOf(allowed)[0].stops).toEqual(['M_a', 'M_mid', 'M_c']);
    expect(allowed.report.unreachableAllowed).toEqual([
      { path: expect.stringContaining('path:MS:0:'), route: 'MS', stop: 'M_off', name: 'Izvan tracnica', reason: 'Test: a platform off every drawn rail.' },
    ]);
  });
});

// F8c: noding a crossing a pattern needs. Two tracks cross without either
// shape drawing a vertex there, so the graph has no junction and the router
// must go the long way round. The fixture is the shape of the real case
// (Subiceva street crossing Kralja Zvonimira mid-edge, and the eastbound
// Mihanoviceva track crossing the southbound one at Glavni kolodvor): a
// north-south track, an east-west track crossing it, and a bypass that makes
// the detour possible -- so the leg is LONG before noding, not impossible.
// Units: one x unit is ~0.78 m near ORIGIN, one y unit ~1.11 m.
const XJ_NS: [number, number][] = [[2, 600], [1, 200], [-1, -600]]; // crosses y = 0 at x = 0.5, off the lattice
const XJ_WE: [number, number][] = [[600, 0], [-600, 0]];
const XJ_BY: [number, number][] = [[1, 200], [900, 200], [900, 0], [600, 0]]; // the long way round
const XJ_CROSSING: [number, number] = [1, 0]; // (0.5, 0) rounded to the coordinate lattice
const xjLonLat = (x: number, y: number) => ({ lon: ORIGIN[0] + x * SCALE, lat: ORIGIN[1] + y * SCALE });
const xjPlane = (pts: [number, number][]) => pts.map(([x, y]) => toMetres(ORIGIN[0] + x * SCALE, ORIGIN[1] + y * SCALE));
const XJ_STOPS = [
  { id: 'X_a', name: 'Sjever', ...xjLonLat(1, 300) }, // on the north-south track, north of the crossing
  { id: 'X_b', name: 'Zapad', ...xjLonLat(-300, 0) }, // on the east-west track, west of the crossing
];
/** The artefact's own coordinate quantum: the diagonal of one 1e-5 deg cell. */
const XJ_QUANTUM = Math.hypot(
  toMetres(ORIGIN[0] + SCALE, ORIGIN[1]).x - toMetres(ORIGIN[0], ORIGIN[1]).x,
  toMetres(ORIGIN[0], ORIGIN[1] + SCALE).y - toMetres(ORIGIN[0], ORIGIN[1]).y,
);

/** The crossing feed: route XR draws the three shapes, route XS runs the turn
 *  with no shape_id, so its pattern needs a synthetic path. */
function makeCrossZip(): Uint8Array {
  const rows = (id: string, pts: [number, number][]) =>
    pts.map(([x, y], i) => { const p = xjLonLat(x, y); return `${id},${p.lat},${p.lon},${i + 1},\n`; }).join('');
  return makeZip([
    { name: 'routes.txt', data: 'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color\nXR,0,"92","Crta s oblikom",,0,,,\nXS,0,"93","Crta bez oblika",,0,,,\n', method: 8 },
    { name: 'trips.txt', data: 'route_id,service_id,trip_id,trip_headsign,trip_short_name,direction_id,block_id,shape_id\nXR,wd,xr_ns,,,0,,XR_ns\nXR,wd,xr_we,,,1,,XR_we\nXR,wd,xr_by,,,0,,XR_by\nXS,wd,xs_1,,,0,,\n', method: 8 },
    { name: 'shapes.txt', data: `shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled\n${rows('XR_ns', XJ_NS)}${rows('XR_we', XJ_WE)}${rows('XR_by', XJ_BY)}`, method: 8 },
    { name: 'stops.txt', data: 'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station\n' + XJ_STOPS.map((s) => `${s.id},,${s.name},,${s.lat},${s.lon},,,0,\n`).join(''), method: 8 },
    { name: 'stop_times.txt', data: 'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type\nxs_1,08:00:00,08:00:00,X_a,1,,,\nxs_1,08:05:00,08:05:00,X_b,2,,,\n', method: 8 },
    { name: 'feed_info.txt', data: FEED_INFO_TXT, method: 8 },
  ]);
}

describe('noding a crossing a pattern needs', () => {
  /** The stop's links to a graph's edges, measured by this file's own
   *  point-to-polyline helper rather than the builder's arithmetic. */
  const linksFor = (edges: any[], p: { x: number; y: number }, radius: number) => {
    const out: { edge: number; s: number }[] = [];
    edges.forEach((e: any, idx: number) => {
      const plane = xjPlane(e.units);
      if (distanceToPolyline(p, plane) > radius) return;
      let best = { d: Infinity, s: 0 };
      let run = 0;
      for (let i = 1; i < plane.length; i++) {
        const a = plane[i - 1];
        const b = plane[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len)));
        const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
        if (d < best.d) best = { d, s: run + t * len };
        run += len;
      }
      out.push({ edge: idx, s: best.s });
    });
    return out;
  };
  /** The cheapest chain from the north stop to the west one, and its arc. */
  const route = (graph: any) => {
    const lens = graph.edges.map((e: any) => polylineLength(xjPlane(e.units)));
    const outgoing = new Map<number, number[]>();
    graph.edges.forEach((e: any, idx: number) => outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), idx]));
    const a = toMetres(XJ_STOPS[0].lon, XJ_STOPS[0].lat);
    const b = toMetres(XJ_STOPS[1].lon, XJ_STOPS[1].lat);
    const links = [linksFor(graph.edges, a, STOP_SHAPE_MAX_METRES), linksFor(graph.edges, b, STOP_SHAPE_MAX_METRES)];
    const path = pathThroughStops(graph.edges, outgoing, lens, links, 'cross');
    let arc = -links[0].find((l: any) => l.edge === path[0])!.s;
    for (const e of path) arc += lens[e];
    arc -= lens[path[path.length - 1]] - links[1].find((l: any) => l.edge === path[path.length - 1])!.s;
    return { path, arc, straight: Math.hypot(a.x - b.x, a.y - b.y) };
  };

  it('routes the long way round while the two polylines only cross, splits both at the crossing when a reported leg needs it, and then routes the turn', async () => {
    const units = [XJ_NS, XJ_WE, XJ_BY].map((pts) => pts.map(([x, y]) => [x, y] as [number, number]));

    // Before: four edges, no node where the two tracks cross, and the only
    // chain from the north stop to the west one is the bypass.
    const before = buildRailGraph(units);
    expect(before.edges).toHaveLength(4);
    const beforeRoute = route(before);
    expect(beforeRoute.path).toHaveLength(3); // the north stub, the bypass, the east-west track
    expect(beforeRoute.arc).toBeGreaterThan(beforeRoute.straight * HOP_DETOUR_FACTOR);
    expect(beforeRoute.arc - beforeRoute.straight).toBeGreaterThan(HOP_DETOUR_EXCESS_METRES);

    // After: the crossing is a vertex of both tracks, so both split there.
    const after = buildRailGraph(units, {
      junctions: [{ u: XJ_CROSSING, segs: [[[1, 200], [-1, -600]], [[600, 0], [-600, 0]]] }],
    });
    expect(after.edges).toHaveLength(6);
    const key = (u: [number, number]) => `${u[0]},${u[1]}`;
    const atJunction = after.edges.filter((e: any) => key(e.units[0]) === key(XJ_CROSSING) || key(e.units[e.units.length - 1]) === key(XJ_CROSSING));
    expect(atJunction).toHaveLength(4); // two in, two out
    // The split point lies on BOTH polylines, within the artefact's own quantum.
    const jPoint = toMetres(ORIGIN[0] + XJ_CROSSING[0] * SCALE, ORIGIN[1] + XJ_CROSSING[1] * SCALE);
    expect(distanceToPolyline(jPoint, xjPlane(XJ_NS))).toBeLessThanOrEqual(XJ_QUANTUM);
    expect(distanceToPolyline(jPoint, xjPlane(XJ_WE))).toBeLessThanOrEqual(XJ_QUANTUM);
    const afterRoute = route(after);
    expect(afterRoute.path).toHaveLength(3); // the north stub, its southern half, the western half
    expect(afterRoute.arc).toBeLessThan(afterRoute.straight * HOP_DETOUR_FACTOR);
    expect(afterRoute.arc).toBeLessThan(beforeRoute.arc / 3);

    // The whole build finds the crossing from the leg it reported, names it,
    // and leaves no long leg behind.
    const net = await buildNetwork(makeCrossZip(), { diagramBusCount: 0 });
    expect(net.report.longLegs).toEqual([]);
    expect(net.report.junctions).toHaveLength(1);
    const [junction] = net.report.junctions;
    expect(junction.legs).toEqual([
      { path: expect.stringContaining('path:XS:0:'), route: 'XS', from: 'Sjever', to: 'Zapad', along: expect.any(Number), straight: expect.any(Number) },
    ]);
    expect(junction.legs[0].along).toBeGreaterThan(junction.legs[0].straight * HOP_DETOUR_FACTOR); // the detour it repaired
    expect(junction.edgesBefore).toHaveLength(2);
    expect(junction.edgesAfter).toHaveLength(4);
    expect(junction.offsetMetres).toBeLessThanOrEqual(XJ_QUANTUM);
    expect(net.edges.from).toHaveLength(6);
    const [xsPath] = pathsOf(net);
    expect(xsPath.e).toHaveLength(3);
    const arcs = xsPath.served.map(([, dm]: [number, number]) => dm / 10);
    expect(arcs[1] - arcs[0]).toBeLessThan(700); // the turn, not the 1970 m bypass

    // Every artefact names the graph it was cut from, and the name follows the edges.
    expect(net.graphHash).toMatch(/^[0-9a-f]{16}$/);
    expect(net.graphHash).toBe(graphHashOf(edgesOf(net)));
    expect((await buildNetwork(makeFullZip(), { diagramBusCount: 1, overrides: FULL_OVERRIDES })).graphHash).not.toBe(net.graphHash);
  });
});

// F8c review: the same two tracks crossing, but with the east-west one drawn
// the OTHER way, so turning onto it at the crossing heads away from the stop
// the leg has to reach. The crossing is still found -- it is a real 90-degree
// meeting of two edges that pass within reach of the leg's platforms -- and
// then pruned, because no path turns there. That is the branch where nothing
// is kept: the artefact must ship the plain graph AND the plain graph's stop
// links, and the leg that still detours must fail the build unless the
// overrides file names it.
const XP_NS: [number, number][] = [[2, 600], [1, 200], [-1, -600]]; // crosses y = 0 at x = 0.5
const XP_WE: [number, number][] = [[-600, 0], [600, 0]]; // west to east: the turn leads away from X_b
const XP_BY: [number, number][] = [[1, 200], [-900, 200], [-900, 0], [-600, 0]]; // joins the east-west track's START
const XP_STOPS = [
  { id: 'X_a', name: 'Sjever', ...xjLonLat(1, 300) },
  { id: 'X_b', name: 'Zapad', ...xjLonLat(-300, 0) }, // reachable only the long way round, crossing or no crossing
];
const XP_ALLOWED = {
  longLegs: [{ route: 'XQ', from: 'Sjever', to: 'Zapad', reason: 'Test: the only crossing between them leads the other way, so no node can express this turn.' }],
};

/** `withPattern: false` drops the shapeless route, so no leg is reported, no
 *  crossing is looked for and the graph is derived exactly once -- the plain
 *  reading of the same rails to compare the stop links against. */
function makePrunedZip(opts: { withPattern?: boolean } = {}): Uint8Array {
  const withPattern = opts.withPattern !== false;
  const rows = (id: string, pts: [number, number][]) =>
    pts.map(([x, y], i) => { const p = xjLonLat(x, y); return `${id},${p.lat},${p.lon},${i + 1},\n`; }).join('');
  return makeZip([
    { name: 'routes.txt', data: 'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color\nXP,0,"94","Crta s oblikom",,0,,,\nXQ,0,"95","Crta bez oblika",,0,,,\n', method: 8 },
    {
      name: 'trips.txt',
      data: 'route_id,service_id,trip_id,trip_headsign,trip_short_name,direction_id,block_id,shape_id\nXP,wd,xp_ns,,,0,,XP_ns\nXP,wd,xp_we,,,1,,XP_we\nXP,wd,xp_by,,,0,,XP_by\n' + (withPattern ? 'XQ,wd,xq_1,,,0,,\n' : ''),
      method: 8,
    },
    { name: 'shapes.txt', data: `shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled\n${rows('XP_ns', XP_NS)}${rows('XP_we', XP_WE)}${rows('XP_by', XP_BY)}`, method: 8 },
    { name: 'stops.txt', data: 'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station\n' + XP_STOPS.map((s) => `${s.id},,${s.name},,${s.lat},${s.lon},,,0,\n`).join(''), method: 8 },
    {
      name: 'stop_times.txt',
      data: 'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type\n' + (withPattern ? 'xq_1,08:00:00,08:00:00,X_a,1,,,\nxq_1,08:05:00,08:05:00,X_b,2,,,\n' : ''),
      method: 8,
    },
    { name: 'feed_info.txt', data: FEED_INFO_TXT, method: 8 },
  ]);
}

describe('a crossing no pattern turns at', () => {
  it('is pruned, leaves the plain graph and ITS stop links in the artefact, and the leg it did not repair fails the build unless the overrides file allows it', async () => {
    // Without an allowlist entry the build refuses the leg by name and says
    // where to allow it -- the condition the whole repair is held to.
    await expect(buildNetwork(makePrunedZip(), { diagramBusCount: 0 })).rejects.toThrow(
      /Sjever -> Zapad.*gtfs-shapes-overrides\.json/s,
    );
    await expect(buildNetwork(makePrunedZip(), { diagramBusCount: 0, overrides: { longLegs: [] } })).rejects.toThrow(/still route past 2x the straight line/);
    // An entry whose route does not match is no entry at all.
    await expect(
      buildNetwork(makePrunedZip(), { diagramBusCount: 0, overrides: { longLegs: [{ ...XP_ALLOWED.longLegs[0], route: 'XP' }] } }),
    ).rejects.toThrow(/Sjever -> Zapad/);

    const net = await buildNetwork(makePrunedZip(), { diagramBusCount: 0, overrides: XP_ALLOWED });
    // One crossing was found and none kept: nothing turns there.
    expect(net.report.junctionsConsidered).toBe(1);
    expect(net.report.junctions).toEqual([]);
    expect(net.report.longLegs).toEqual([]);
    expect(net.report.longLegsAllowed).toEqual([
      { path: expect.stringContaining('path:XQ:0:'), route: 'XQ', from: 'Sjever', to: 'Zapad', along: expect.any(Number), straight: expect.any(Number), allowed: XP_ALLOWED.longLegs[0].reason },
    ]);
    expect(net.edges.from).toHaveLength(4); // the plain graph, not the six-edge one the prune pass looked at

    // ...and the stop links index THAT graph. Against the same rails read
    // once, with no pattern to report a leg and so no second derivation at
    // all: the wire is identical stop for stop.
    const plain = await buildNetwork(makePrunedZip({ withPattern: false }), { diagramBusCount: 0 });
    expect(plain.report.junctionsConsidered).toBe(0);
    expect(net.stops.id).toEqual(plain.stops.id);
    expect(net.stops.onEdge).toEqual(plain.stops.onEdge);
    expect(net.stops.on).toEqual(plain.stops.on);
    expect(net.graphHash).toBe(plain.graphHash);

    // And measured, not just compared: every link lands on the edge it names,
    // within the geometric radius of the stop it belongs to.
    const stops = stopsOf(net);
    for (const stop of stops) {
      expect(stop.onEdge.length, `stop ${stop.id} lost its rails`).toBeGreaterThan(0);
      for (const [edge, metres] of stop.onEdge) {
        const plane = edgePoints(net, edge);
        const here = toMetres(XP_STOPS.find((s) => s.id === stop.id)!.lon, XP_STOPS.find((s) => s.id === stop.id)!.lat);
        expect(distanceToPolyline(here, plane), `stop ${stop.id} on edge ${edge}`).toBeLessThanOrEqual(STOP_SHAPE_MAX_METRES);
        expect(metres, `arc of ${stop.id} on edge ${edge}`).toBeLessThanOrEqual(polylineLength(plane) + 1);
      }
    }
  });
});

// WP0: connectors. Two tracks of the kind that meet at Glavni kolodvor: one
// runs east and ENDS, the other STARTS 5.9 m away and runs north, and no shape
// draws a turn between them, so a pattern that turns there is routed the long
// way round -- here over a 1.3 km bypass -- and the build refuses that leg. A
// connector in the overrides file joins the two nodes.
// Units: one x unit is ~0.78 m near ORIGIN, one y unit ~1.11 m.
const CN_EAST: [number, number][] = [[0, 0], [150, 0], [300, 0]]; // ends at node (300, 0)
const CN_NORTH: [number, number][] = [[305, 4], [305, 100], [305, 200]]; // starts 5.9 m away
const CN_BYPASS: [number, number][] = [[300, 0], [300, -300], [700, -300], [700, 4], [305, 4]]; // the long way round
const CN_ASIDE: [number, number][] = [[0, 300], [0, 400], [0, 500]]; // unrelated track, for a connector nothing runs
const CN_STOPS = [
  { id: 'C_w', name: 'Zapadno', ...xjLonLat(100, 0) },
  { id: 'C_n', name: 'Sjeverno', ...xjLonLat(305, 150) },
];
const cnPoint = ([x, y]: [number, number]): [number, number] => {
  const p = xjLonLat(x, y);
  return [p.lon, p.lat];
};
const CN_CONNECTOR = { from: cnPoint([300, 0]), to: cnPoint([305, 4]), routes: ['CT'], reason: 'Test: the east track ends 5.9 m from where the north one starts.' };

/** Route CR draws the three tracks; route CT runs the turn with no shape_id. */
function makeConnectorZip(): Uint8Array {
  const rows = (id: string, pts: [number, number][]) =>
    pts.map(([x, y], i) => { const p = xjLonLat(x, y); return `${id},${p.lat},${p.lon},${i + 1},\n`; }).join('');
  return makeZip([
    { name: 'routes.txt', data: 'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color\nCR,0,"96","Spoj s oblikom",,0,,,\nCT,0,"97","Spoj bez oblika",,0,,,\n', method: 8 },
    { name: 'trips.txt', data: 'route_id,service_id,trip_id,trip_headsign,trip_short_name,direction_id,block_id,shape_id\nCR,wd,cr_e,,,0,,CR_east\nCR,wd,cr_n,,,0,,CR_north\nCR,wd,cr_b,,,0,,CR_bypass\nCR,wd,cr_a,,,0,,CR_aside\nCT,wd,ct_1,,,0,,\n', method: 8 },
    { name: 'shapes.txt', data: `shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled\n${rows('CR_east', CN_EAST)}${rows('CR_north', CN_NORTH)}${rows('CR_bypass', CN_BYPASS)}${rows('CR_aside', CN_ASIDE)}`, method: 8 },
    { name: 'stops.txt', data: 'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station\n' + CN_STOPS.map((s) => `${s.id},,${s.name},,${s.lat},${s.lon},,,0,\n`).join(''), method: 8 },
    { name: 'stop_times.txt', data: 'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type\nct_1,08:00:00,08:00:00,C_w,1,,,\nct_1,08:05:00,08:05:00,C_n,2,,,\n', method: 8 },
    { name: 'feed_info.txt', data: FEED_INFO_TXT, method: 8 },
  ]);
}

describe('a connector the overrides file names', () => {
  it('joins two tracks that end and start metres apart, so a pattern turning there routes in one hop, and refuses a connector that matches no node, runs no path or carries a line it does not name', async () => {
    // Without it the pattern runs the bypass, and the build refuses the leg.
    await expect(buildNetwork(makeConnectorZip(), { diagramBusCount: 0 })).rejects.toThrow(/Zapadno -> Sjeverno.*gtfs-shapes-overrides\.json/s);

    const net = await buildNetwork(makeConnectorZip(), { diagramBusCount: 0, overrides: { connectors: [CN_CONNECTOR] } });
    const shapes = shapesOf(net);
    const east = shapes.find((s: any) => s.id === 'CR_east').e;
    const north = shapes.find((s: any) => s.id === 'CR_north').e;
    expect(net.edges.from).toHaveLength(5); // four tracks and the connector, appended last
    const [connector] = net.report.connectors;
    expect(connector).toMatchObject({ edge: 4, routes: ['CT'], usedBy: [expect.stringContaining('path:CT:0:')] });
    expect(connector.metres).toBeGreaterThan(5);
    expect(connector.metres).toBeLessThan(7);
    // The connector runs from the east track's end node to the north track's start node.
    const edges = edgesOf(net);
    expect(edges[4].from).toBe(edges[east.at(-1)].to);
    expect(edges[4].to).toBe(edges[north[0]].from);
    const [path] = pathsOf(net);
    expect(path.e).toEqual([...east, 4, ...north]);
    expect(net.report.longLegs).toEqual([]);
    const stops = stopsOf(net);
    expect(path.served.map(([i]: [number, number]) => stops[i].id)).toEqual(['C_w', 'C_n']);
    const [[, fromDm], [, toDm]] = path.served;
    const a = toMetres(CN_STOPS[0].lon, CN_STOPS[0].lat);
    const b = toMetres(CN_STOPS[1].lon, CN_STOPS[1].lat);
    expect((toDm - fromDm) / 10).toBeLessThan(1.5 * Math.hypot(a.x - b.x, a.y - b.y)); // the turn, as the ground runs

    // A point more than CONNECTOR_SNAP_METRES from every node is refused by name.
    await expect(
      buildNetwork(makeConnectorZip(), { diagramBusCount: 0, overrides: { connectors: [{ ...CN_CONNECTOR, from: cnPoint([150, 40]) }] } }),
    ).rejects.toThrow(new RegExp(`no node\\(s\\) where an edge ends within ${CONNECTOR_SNAP_METRES} m.*gtfs-shapes-overrides\\.json`));
    // A connector the pattern runs, named for another line, is refused.
    await expect(
      buildNetwork(makeConnectorZip(), { diagramBusCount: 0, overrides: { connectors: [{ ...CN_CONNECTOR, routes: ['CR'] }] } }),
    ).rejects.toThrow(/run by path:CT:0:\w+ \(route CT\), a line it does not name/);
    // And one that nothing runs is stale.
    const stale = { from: cnPoint([0, 500]), to: cnPoint([0, 300]), routes: ['CR'], reason: 'Test: a turn no pattern takes.' };
    await expect(
      buildNetwork(makeConnectorZip(), { diagramBusCount: 0, overrides: { connectors: [CN_CONNECTOR, stale] } }),
    ).rejects.toThrow(/no path runs it/);
  });
});

// WP0: the served-gap rule. Route GR's one shape runs 444 m north. Its
// sample trip calls at the two ends and the middle; a second trip ends at a
// platform 130 m past the end of the drawn rails (the Zapruđe case); a third,
// in the second feed, calls at a platform 80 m off the middle of the line.
const GP_SHAPE: [number, number][] = [[0, 0], [0, 200], [0, 400]];
const GP_STOPS = [
  { id: 'G_a', name: 'Jug', ...xjLonLat(0, 0) },
  { id: 'G_mid', name: 'Sredina', ...xjLonLat(0, 200) },
  { id: 'G_end', name: 'Sjever', ...xjLonLat(0, 400) },
  { id: 'G_past', name: 'Iza kraja', ...xjLonLat(0, 517) }, // 130 m past the end
  { id: 'G_off', name: 'Sa strane', ...xjLonLat(103, 200) }, // 80 m east of the middle
];
const GP_OVERRIDES = { servedGaps: [{ path: 'G1', stop: 'G_off', reason: 'Test: the line calls at a platform off its drawn rails.' }] };

function makeGapZip(opts: { withOffStop?: boolean; startAt?: [number, number] } = {}): Uint8Array {
  const rows = GP_SHAPE.map(([x, y], i) => { const p = xjLonLat(x, y); return `G1,${p.lat},${p.lon},${i + 1},\n`; }).join('');
  const stops = GP_STOPS.map((s) => (s.id === 'G_a' && opts.startAt ? { ...s, ...xjLonLat(...opts.startAt) } : s));
  const calls: [string, string[]][] = [
    ['g_1', ['G_a', 'G_mid', 'G_end']],
    ['g_2', ['G_a', 'G_mid', 'G_past']],
    ...(opts.withOffStop ? ([['g_3', ['G_a', 'G_off', 'G_end']]] as [string, string[]][]) : []),
  ];
  return makeZip([
    { name: 'routes.txt', data: 'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color\nGR,0,"98","Crta s peronima",,0,,,\n', method: 8 },
    { name: 'trips.txt', data: 'route_id,service_id,trip_id,trip_headsign,trip_short_name,direction_id,block_id,shape_id\n' + calls.map(([trip]) => `GR,wd,${trip},,,0,,G1\n`).join(''), method: 8 },
    { name: 'shapes.txt', data: `shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled\n${rows}`, method: 8 },
    { name: 'stops.txt', data: 'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station\n' + stops.map((s) => `${s.id},,${s.name},,${s.lat},${s.lon},,,0,\n`).join(''), method: 8 },
    {
      name: 'stop_times.txt',
      data: 'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type\n' +
        calls.flatMap(([trip, ids]) => ids.map((id, i) => `${trip},0${8 + i}:00:00,0${8 + i}:00:00,${id},${i + 1},,,\n`)).join(''),
      method: 8,
    },
    { name: 'feed_info.txt', data: FEED_INFO_TXT, method: 8 },
  ]);
}

describe('the platforms a shape\'s own trips call at', () => {
  it('serve a terminus set back past the drawn rails at the path\'s end, and fail the build on a platform off the rails unless the overrides file names the gap', async () => {
    const net = await buildNetwork(makeGapZip(), { diagramBusCount: 0 });
    const stops = stopsOf(net);
    const [shape] = shapesOf(net);
    const served = shape.served.map(([i, dm]: [number, number]) => [stops[i].id, dm / 10]);
    const len = polylineLength(GP_SHAPE.map(([x, y]) => toMetres(xjLonLat(x, y).lon, xjLonLat(x, y).lat)));
    // G_past lies 130 m past the end: served at the end, beside G_end.
    expect(served.map(([id]: [string]) => id)).toEqual(['G_a', 'G_mid', 'G_end', 'G_past']);
    expect(served[3][1]).toBeCloseTo(len, 0);
    expect(net.report.servedTerminus).toEqual([{ path: 'G1', route: 'GR', stop: 'G_past', name: 'Iza kraja', metres: expect.closeTo(130, 0), at: 'end' }]);
    expect(net.report.servedDropped).toEqual([]);

    // A platform 80 m off the middle of the line is no terminus: the build
    // names the shape and the stop, and where to allow it.
    await expect(buildNetwork(makeGapZip({ withOffStop: true }), { diagramBusCount: 0 })).rejects.toThrow(
      /G1 \(route GR\) calls at G_off "Sa strane", \d+\.\d m off its rails.*servedGaps in scripts\/gtfs-shapes-overrides\.json/,
    );
    // Allowlisted, it is left out of the served list and reported with the reason.
    const allowed = await buildNetwork(makeGapZip({ withOffStop: true }), { diagramBusCount: 0, overrides: GP_OVERRIDES });
    expect(shapesOf(allowed)[0].served.map(([i]: [number, number]) => stopsOf(allowed)[i].id)).toEqual(['G_a', 'G_mid', 'G_end', 'G_past']);
    expect(allowed.report.servedGapsAllowed).toEqual([
      { path: 'G1', route: 'GR', stop: 'G_off', name: 'Sa strane', metres: expect.any(Number), allowed: GP_OVERRIDES.servedGaps[0].reason },
    ]);
    expect(allowed.report.servedGapsAllowed[0].metres).toBeGreaterThan(SERVED_STOP_MAX_METRES);
    expect(allowed.report.servedGapsAllowed[0].metres).toBeLessThan(90);
  });

  // The sample trip's first and last stop are linked to the shape's ends
  // whatever the distance (the stop-transfer override); the served list checks
  // the geometry anyway, so a link can never carry a platform past the rule.
  it('hold a linked platform to the same bound: a sample trip\'s first stop 1.55 km off the rails fails the build, 150 m off is a set-back terminus', async () => {
    await expect(buildNetwork(makeGapZip({ startAt: [2000, 0] }), { diagramBusCount: 0 })).rejects.toThrow(
      /G1 \(route GR\) calls at G_a "Jug", 155\d\.\d m off its rails/,
    );
    const setBack = await buildNetwork(makeGapZip({ startAt: [0, -135] }), { diagramBusCount: 0 }); // 150 m short of the start
    expect(setBack.report.servedTerminus).toEqual(
      expect.arrayContaining([{ path: 'G1', route: 'GR', stop: 'G_a', name: 'Jug', metres: expect.closeTo(150, 0), at: 'start' }]),
    );
    expect(shapesOf(setBack)[0].served[0]).toEqual([stopsOf(setBack).findIndex((st: any) => st.id === 'G_a'), 0]);
    await expect(buildNetwork(makeGapZip({ startAt: [0, -190] }), { diagramBusCount: 0 })).rejects.toThrow(/calls at G_a "Jug", 21\d\.\d m off its rails/);
  });
});

// WP0: terminus loops over drawn rails. Route LR arrives north on L_in and
// leaves south on L_out, 31 m to the east; the loop between them is drawn by
// route LX's shape, 142 m round. Route LN is the same terminus with no loop
// drawn at all, and route LT's loop is drawn, but three kilometres round.
const LP_TRACKS: Record<string, [number, number][]> = {
  L_in: [[0, 0], [0, 150], [0, 300]],
  L_loop: [[0, 300], [0, 350], [40, 350], [40, 300]],
  L_out: [[40, 300], [40, 150], [40, 0]],
  N_in: [[400, 0], [400, 150], [400, 300]],
  N_out: [[440, 300], [440, 150], [440, 0]],
  T_in: [[800, 0], [800, 150], [800, 300]],
  T_loop: [[800, 300], [800, 1700], [840, 1700], [840, 300]],
  T_out: [[840, 300], [840, 150], [840, 0]],
};
const LP_ROUTE: Record<string, string> = { L_in: 'LR', L_out: 'LR', L_loop: 'LX', N_in: 'LN', N_out: 'LN', T_in: 'LT', T_out: 'LT', T_loop: 'LX' };
const LP_CALLS: [string, string, [string, number, number][]][] = [
  ['li', 'L_in', [['L_s', 0, 10], ['L_end', 0, 290]]],
  ['lo', 'L_out', [['L_start', 40, 290], ['L_s2', 40, 10]]],
  ['ni', 'N_in', [['N_s', 400, 10], ['N_end', 400, 290]]],
  ['no', 'N_out', [['N_start', 440, 290], ['N_s2', 440, 10]]],
  ['ti', 'T_in', [['T_s', 800, 10], ['T_end', 800, 290]]],
  ['to', 'T_out', [['T_start', 840, 290], ['T_s2', 840, 10]]],
];

function makeLoopZip(): Uint8Array {
  const rows = Object.entries(LP_TRACKS)
    .map(([id, pts]) => pts.map(([x, y], i) => { const p = xjLonLat(x, y); return `${id},${p.lat},${p.lon},${i + 1},\n`; }).join(''))
    .join('');
  const stops = LP_CALLS.flatMap(([, , calls]) => calls.map(([id, x, y]) => ({ id, ...xjLonLat(x, y) })));
  const trips = [...LP_CALLS.map(([trip, shape]) => [trip, shape]), ['lx_1', 'L_loop'], ['lx_2', 'T_loop']];
  return makeZip([
    {
      name: 'routes.txt',
      data: 'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color\n' +
        ['LR', 'LN', 'LT', 'LX'].map((id) => `${id},0,"${id}","${id}",,0,,,\n`).join(''),
      method: 8,
    },
    {
      name: 'trips.txt',
      data: 'route_id,service_id,trip_id,trip_headsign,trip_short_name,direction_id,block_id,shape_id\n' +
        trips.map(([trip, shape]) => `${LP_ROUTE[shape]},wd,${trip},,,${shape.endsWith('_out') ? 1 : 0},,${shape}\n`).join(''),
      method: 8,
    },
    { name: 'shapes.txt', data: `shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled\n${rows}`, method: 8 },
    { name: 'stops.txt', data: 'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station\n' + stops.map((s) => `${s.id},,${s.id},,${s.lat},${s.lon},,,0,\n`).join(''), method: 8 },
    {
      name: 'stop_times.txt',
      data: 'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type\n' +
        LP_CALLS.flatMap(([trip, , calls]) => calls.map(([id], i) => `${trip},0${8 + i}:00:00,0${8 + i}:00:00,${id},${i + 1},,,\n`)).join(''),
      method: 8,
    },
    { name: 'feed_info.txt', data: FEED_INFO_TXT, method: 8 },
  ]);
}

describe('terminus loops', () => {
  it('join a trip\'s last platform to the next trip\'s first over the rails the feed draws, and name the pairs whose loop is not drawn or runs too far', async () => {
    const net = await buildNetwork(makeLoopZip(), { diagramBusCount: 0 });
    const shapes = shapesOf(net);
    const edgeOf = (id: string) => shapes.find((s: any) => s.id === id).e;
    const paths = pathsOf(net);
    expect(paths).toHaveLength(1); // no shapeless pattern here: the one path is the loop
    const [loop] = paths;
    expect(loop).toMatchObject({ id: `${LOOP_ID_PREFIX}LR:${stopSequenceHash(['L_end', 'L_start'])}`, route: 'LR', dir: LOOP_DIRECTION, stops: ['L_end', 'L_start'] });
    // The two boundary edges are cut LOOP_LEAD_METRES before the arriving
    // platform and after the departing one, measured where each platform
    // projects: L_in (334 m) now ends in an 81 m piece, L_out starts with
    // one, and the loop runs only those.
    expect(edgeOf('L_in')).toHaveLength(2);
    expect(edgeOf('L_out')).toHaveLength(2);
    expect(loop.e).toEqual([...edgeOf('L_in').slice(-1), ...edgeOf('L_loop'), ...edgeOf('L_out').slice(0, 1)]);
    const along = (pts: [number, number][]) => polylineLength(pts.map(([x, y]) => toMetres(xjLonLat(x, y).lon, xjLonLat(x, y).lat)));
    const inLength = along(LP_TRACKS.L_in);
    const endAt = along([[0, 0], [0, 290]]); // L_end, 11 m short of L_in's end
    const startAt = along([[40, 300], [40, 290]]); // L_start, 11 m into L_out
    expect(net.report.loopCuts.map((c: any) => c.at)).toEqual([[expect.closeTo(endAt - LOOP_LEAD_METRES, 0)], [expect.closeTo(startAt + LOOP_LEAD_METRES, 0)]]);
    const stops = stopsOf(net);
    const served = loop.served.map(([i, dm]: [number, number]) => [stops[i].id, dm / 10]);
    expect(served.map(([id]: [string]) => id)).toEqual(['L_end', 'L_start']);
    expect(net.report.loopPaths.map((l: any) => l.id)).toEqual([loop.id]);
    const [{ metres, between }] = net.report.loopPaths;
    expect(between).toBeGreaterThan(130); // the drawn loop, ~142 m round...
    expect(between).toBeLessThan(155);
    // ...and the two terminal ends it keeps of its boundary edges.
    expect(metres).toBeCloseTo(inLength - (endAt - LOOP_LEAD_METRES) + between + startAt + LOOP_LEAD_METRES, 0);
    // Each sample trip's end platform is linked at its shape's end (the
    // stop-transfer override), so the two served arcs are the loop apart.
    expect(served[0][1]).toBeCloseTo(inLength - (endAt - LOOP_LEAD_METRES), 0);
    expect(served[1][1] - served[0][1]).toBeCloseTo(between, 0);
    // Four pairs per route lie within LOOP_PAIR_MAX_METRES (each path's end
    // with either path's start); only LR's arrival -> departure has a loop.
    expect(net.report.loopPairs).toBe(12);
    const skipped = (from: string, to: string) => net.report.loopSkipped.find((l: any) => l.from === from && l.to === to);
    expect(skipped('N_end', 'N_start')).toMatchObject({ route: 'LN', reason: 'no directed route' });
    expect(skipped('T_end', 'T_start')).toMatchObject({ route: 'LT', reason: 'too long' });
    expect(skipped('T_end', 'T_start').metres).toBeGreaterThan(LOOP_MAX_METRES);
    expect(net.report.loopSkipped).toHaveLength(11);

    // The decoder reads the loop as a path like any other, direction -1,
    // serving its two platforms, and no pattern resolves to it.
    const decoded = decodeNetwork(net);
    const idx = decoded.paths.findIndex((p) => p.id === loop.id);
    expect(decoded.paths[idx]).toMatchObject({ direction: LOOP_DIRECTION, shape: null, stops: ['L_end', 'L_start'] });
    expect(decoded.paths[idx].len).toBeCloseTo(metres, 0); // the length the cap held is the length it has
    expect(decoded.stopsOnPath(idx).map((e) => e.stop.id)).toEqual(['L_end', 'L_start']);
    // The shapes over the cut edges run both pieces, end to end.
    for (const id of ['L_in', 'L_out']) {
      const [a, b] = edgeOf(id);
      expect(edgesOf(net)[a].to).toBe(edgesOf(net)[b].from);
    }
  });
});

// WP0: `--zip`, and the same bytes from the same archive on any machine.
// builtAt is the archive's Last-Modified, handed in with `builtAt` (the CLI's
// --built-at): never the file's own time, which a copy need not keep.
describe('the command-line build from an archive on disk', () => {
  it('reads the archive, stamps it with the Last-Modified it is given, writes the same bytes from two copies with different file times, and refuses to guess a stamp', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zet-network-zip-'));
    const stamp = '2026-09-01T08:50:29.000Z';
    const copies = ['a.zip', 'b.zip'];
    for (const [k, name] of copies.entries()) {
      await writeFile(join(dir, name), makeFullZip());
      const time = new Date(Date.UTC(2026, 8, 1 + 10 * k));
      await utimes(join(dir, name), time, time);
    }
    const run = (zip: string, out: string) =>
      main({ zipPath: join(dir, zip), builtAt: 'Tue, 01 Sep 2026 08:50:29 GMT', cwd: dir, out, metaOut: null, diagramBusCount: 1, log: () => {}, overrides: FULL_OVERRIDES });
    const first = await run('a.zip', 'a.json');
    await run('b.zip', 'b.json');
    expect(first.metaTarget).toBeNull();
    const a = await readFile(join(dir, 'a.json'), 'utf8');
    expect(await readFile(join(dir, 'b.json'), 'utf8')).toBe(a);
    expect(JSON.parse(a)).toMatchObject({ feedVersion: '000123', builtAt: stamp });
    expect(first.builtAt).toBe(stamp);
    await expect(stat(join(dir, 'motion'))).rejects.toThrow(); // no meta written anywhere
    // A download is stamped with its Last-Modified: the same bytes, the same
    // artefact. Without the header it is refused unless --built-at stands in.
    const download = (headers: Record<string, string>) => async () => new Response(makeFullZip(), { status: 200, headers });
    const header = 'Tue, 01 Sep 2026 08:50:29 GMT';
    const fetched = await main({ fetchImpl: download({ 'last-modified': header }), cwd: dir, out: 'd.json', metaOut: null, diagramBusCount: 1, log: () => {}, overrides: FULL_OVERRIDES });
    expect(fetched.builtAt).toBe(stamp);
    expect(await readFile(join(dir, 'd.json'), 'utf8')).toBe(a);
    await expect(main({ fetchImpl: download({}), cwd: dir, out: 'e.json', metaOut: null, log: () => {}, overrides: FULL_OVERRIDES })).rejects.toThrow(/no Last-Modified header.*--built-at/);
    const told = await main({ fetchImpl: download({}), builtAt: header, cwd: dir, out: 'e.json', metaOut: null, diagramBusCount: 1, log: () => {}, overrides: FULL_OVERRIDES });
    expect(told.builtAt).toBe(stamp);
    // Without a stamp a file build does not guess one.
    await expect(main({ zipPath: join(dir, 'a.zip'), cwd: dir, out: 'c.json', metaOut: null, log: () => {}, overrides: FULL_OVERRIDES })).rejects.toThrow(/--zip needs --built-at/);
    await expect(main({ zipPath: join(dir, 'a.zip'), builtAt: 'yesterday', cwd: dir, out: 'c.json', metaOut: null, log: () => {}, overrides: FULL_OVERRIDES })).rejects.toThrow(/not a time/);
  });
});
