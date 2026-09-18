import { describe, expect, it } from 'vitest';
import { crc32, deflateRawSync, gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  BUS_ON_FRAC_SCALE,
  EDGE_KEYS,
  LINE_KEYS,
  ORIGIN,
  PATH_KEYS,
  ROUTE_KEYS,
  SCALE,
  SHAPE_KEYS,
  SNAP_METRES,
  STOP_KEYS,
  STOP_SHAPE_MAX_METRES,
  buildNetwork,
  buildRailGraph,
  decodeEdgeChain,
  decodeStopOn,
  decodeStopOnEdge,
  fromColumnar,
  main,
  stopSequenceHash,
  toMetres,
} from '../../scripts/gtfs-shapes.mjs';
import { FEED_VERSION } from '../../app/src/motion/network-meta';
import { decodeNetwork } from '../../shared/motion/network';

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
// T2 an L-shaped tram shape whose trip's terminus stops sit 200 m off it
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
const S_T2_START = { id: 'S_t2_start', name: 'T2 pocetak', lon: T2_A.lon, lat: T2_A.lat - 0.0018 };
const S_T2_END = { id: 'S_t2_end', name: 'T2 kraj', lon: T2_C.lon + 0.0026, lat: T2_C.lat };
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
    const net = await buildNetwork(makeFullZip(), { diagramBusCount: 1 });
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
    expect(byId.S_t2_start.onEdge).toEqual([[t2.e[0], 0]]); // the terminus override, 200 m off the rails
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
    // kilometre off T2's rails: dropped and reported, never invented at an
    // arc of its own. A bus shape runs no path and serves nothing.
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
    const dropped = (await buildNetwork(makeFullZip(), { diagramBusCount: 1 })).report.servedDropped;
    expect(dropped).toEqual([{ path: 'T2_shape', route: 'T2', stop: 'S_close', name: 'Blizu', metres: expect.any(Number) }]);

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
    });
    expect(result).toMatchObject({ routeCount: 5, edgeCount: 2, pathCount: 1 });
    expect(JSON.parse(await readFile(join(dir, 'data/zet-network.json'), 'utf8'))).toMatchObject({ version: 3, feedVersion: '000123', builtAt: '2026-09-12T12:00:00.000Z' });
    const meta = await readFile(join(dir, 'motion/network-meta.ts'), 'utf8');
    expect(meta).toContain('export const FEED_VERSION = "000123";');
    expect(meta).toContain('export const EDGE_COUNT = 2;');

    // A shapeless pattern whose stop is off the rails fails the build, naming the route.
    const offRails = STOP_TIMES_TXT.replace('t3_trip_1,09:03:00,09:03:00,S_close2,2,,,', 't3_trip_1,09:03:00,09:03:00,S_far,2,,,');
    await expect(buildNetwork(makeFullZip({ stopTimes: offRails }), { diagramBusCount: 1 })).rejects.toThrow(/T3/);
    // Without feed_info.txt the archive's mtime names the feed; without either the build refuses.
    expect((await buildNetwork(makeFullZip({ withFeedInfo: false }), { fallbackMtime: '2026-08-15T00:00:00.000Z', diagramBusCount: 1 })).feedVersion).toBe('2026-08-15T00:00:00.000Z');
    await expect(buildNetwork(makeFullZip({ withFeedInfo: false }), {})).rejects.toThrow(/feedVersion/);
  });
});

describe('the committed artefact', () => {
  const artefactPath = resolve(process.cwd(), 'app/public/data/zet-network.json');
  // R-TE11: the measured version 2 size plus a fifth. Measured at the first v2
  // build (feed 000395, 16 Sept 2026): 533,535 B raw, 125,866 B gzip; v1 was
  // 542,147 B raw. Pins: 640 KiB raw (655,360 B), 150 KiB gzip (153,600 B).
  // Version 3 (F8) adds the served lists and the terminal flags: 576,279 B
  // raw, 135,611 B gzip on the same feed -- 8 % and 8 % more, still 12 % and
  // 12 % inside the v2 pins, which therefore stand rather than being loosened
  // to fit what was just measured.
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

    const net = decodeNetwork(parsed);
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
    // subset of what lies geometrically on its edges.
    const tramPaths = net.paths.filter((p) => net.routes.get(p.route)?.type === 0);
    expect(tramPaths).toHaveLength(145);
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
});
