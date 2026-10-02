// drawnAt interpolates linearly in the arc between ten-second samples on one
// geometry and snaps on a geometry change, a missing neighbour or a hop over
// 400 m; the heading is the tangent, flipped backwards; under a metre the
// vehicle is held; the last tick reads the next chunk; ghosts align by time
// of day; the replay model is stateless and empty when it should be
// (app/src/snimka/positions.ts).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toLonLat } from '../../shared/motion/geo';
import { decodeNetwork } from '../../shared/motion/network';
import { at, tangent } from '../../shared/motion/polyline';
import { MOTION_CHUNK_S, MOTION_TICKS, SNIMKA_COMPARISONS, type MotionChunk } from '../../shared/snimka';
import { encodeMotionChunk, type MotionSample } from '../../shared/snimka-codec';
import { compareInstant, createReplayModel, drawnAt, ghostsAt, HELD_M, NO_VEHICLES_SPEED, placedAt, SNAP_M, tickOf } from '../../app/src/snimka/positions';
import { parseZagrebLocal } from '../../app/src/snimka/format';

const NET = decodeNetwork(JSON.parse(readFileSync(resolve(import.meta.dirname, '../../app/public/data/zet-network.json'), 'utf8')));
const T0 = parseZagrebLocal('2026-09-28T07:40')! / 1000;
const MS = (tick: number, f = 0): number => (T0 + tick * 10 + f * 10) * 1000;

/** Two long tram paths of different routes and the longest bus shape of the artefact. */
const longPaths = NET.paths.map((p, idx) => ({ p, idx })).filter(({ p }) => p.len > 3000).sort((a, b) => b.p.len - a.p.len);
const PATH_A = longPaths[0]!.idx;
const PATH_B = longPaths.find(({ p }) => p.route !== longPaths[0]!.p.route)!.idx;
const BUS = NET.shapes.map((s, idx) => ({ s, idx })).filter(({ s }) => !s.edges && s.len > 2000).sort((a, b) => b.s.len - a.s.len)[0]!.idx;

type Sampler = (tick: number) => MotionSample | null;
function chunk(vehicles: { id: string; route?: string | null; label?: string | null; kind?: 0 | 3 | null; at: Sampler }[], t0 = T0): MotionChunk {
  return encodeMotionChunk({
    net: '396', t0,
    vehicles: vehicles.map((v) => ({ id: v.id, route: v.route === undefined ? '6' : v.route, label: v.label === undefined ? '6' : v.label, kind: v.kind === undefined ? 0 : v.kind, samples: Array.from({ length: MOTION_TICKS }, (_, k) => v.at(k)) })),
  });
}
const onPath = (idx: number, s: number): MotionSample => ({ on: 0, idx, s });
const pathPoint = (idx: number, s: number) => NET.toPathPoint(idx, s);
const near = (a: { x: number; y: number }, b: { x: number; y: number }, tol = 1e-6): void => {
  expect(Math.abs(a.x - b.x)).toBeLessThan(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThan(tol);
};

describe('tickOf', () => {
  it('finds the tick and the fraction inside the chunk, null outside it', () => {
    expect(tickOf({ t0: T0 }, MS(0))).toEqual({ tick: 0, f: 0 });
    expect(tickOf({ t0: T0 }, MS(7, 0.25))).toEqual({ tick: 7, f: 0.25 });
    expect(tickOf({ t0: T0 }, MS(59, 0.999))!.tick).toBe(59);
    expect(tickOf({ t0: T0 }, MS(0) - 1)).toBeNull();
    expect(tickOf({ t0: T0 }, (T0 + MOTION_CHUNK_S) * 1000)).toBeNull();
  });
});

describe('drawnAt on a path', () => {
  const c = chunk([{ id: 'tram', at: (k) => onPath(PATH_A, 100 + 50 * k) }]);

  it('interpolates linearly in the arc between two samples and heads along the tangent', () => {
    const [d] = drawnAt(c, null, MS(3, 0.5), NET);
    expect(d).toBeDefined();
    near(d!.p, pathPoint(PATH_A, 275));
    const geo = NET.pathGeometry(PATH_A);
    near(d!.heading!, tangent(geo.pts, geo.cum, 275));
    expect(d!.speed).toBeCloseTo(5, 9);
    expect(d!.held).toBe(false);
    expect(d!.path).toBe(PATH_A);
    expect(d!.s).toBeCloseTo(275, 9);
    expect(d!.onShape).toBe(NET.paths[PATH_A]!.shape ?? -1);
    expect(d!.type).toBe(0);
    expect(d!.routeId).toBe('6');
    expect(d!.short).toBe('6');
    expect(d!.confidence).toBe(1);
  });

  it('stands exactly on the sample at a whole tick', () => {
    const [d] = drawnAt(c, null, MS(10), NET);
    near(d!.p, pathPoint(PATH_A, 600));
  });

  it('flips the heading when the arc decreases', () => {
    const back = chunk([{ id: 'tram', at: (k) => onPath(PATH_A, 2000 - 40 * k) }]);
    const [d] = drawnAt(back, null, MS(2, 0.5), NET);
    const geo = NET.pathGeometry(PATH_A);
    const t = tangent(geo.pts, geo.cum, 1900);
    near(d!.heading!, { x: -t.x, y: -t.y });
    near(d!.track!, t);
  });

  it('is held under a metre of movement, and is not held when snapped', () => {
    // The codec keeps whole metres, so "under a metre" between two samples is no movement at all.
    const still = chunk([{ id: 'tram', at: () => onPath(PATH_A, 500) }]);
    expect(HELD_M).toBe(1);
    const [stood] = drawnAt(still, null, MS(0, 0.5), NET);
    expect(stood!.held).toBe(true);
    expect(stood!.speed).toBe(0);
    expect(stood!.heading).not.toBeNull();
    const creeping = chunk([{ id: 'tram', at: (k) => onPath(PATH_A, 500 + k) }]);
    expect(drawnAt(creeping, null, MS(0, 0.5), NET)[0]!.held).toBe(false);
    const lone = chunk([{ id: 'tram', at: (k) => (k === 4 ? onPath(PATH_A, 500) : null) }]);
    const [d] = drawnAt(lone, null, MS(4, 0.5), NET);
    expect(d!.held).toBe(false);
    near(d!.p, pathPoint(PATH_A, 500));
  });

  it('snaps on a geometry change, a missing neighbour and a hop over 400 m', () => {
    const change = chunk([{ id: 'tram', at: (k) => (k < 5 ? onPath(PATH_A, 100 + 50 * k) : onPath(PATH_B, 900)) }]);
    near(drawnAt(change, null, MS(4, 0.9), NET)[0]!.p, pathPoint(PATH_A, 300));
    near(drawnAt(change, null, MS(5, 0.5), NET)[0]!.p, pathPoint(PATH_B, 900));
    const gap = chunk([{ id: 'tram', at: (k) => (k === 3 ? null : onPath(PATH_A, 100 + 50 * k)) }]);
    near(drawnAt(gap, null, MS(2, 0.5), NET)[0]!.p, pathPoint(PATH_A, 200));
    expect(drawnAt(gap, null, MS(3, 0.5), NET)).toEqual([]);
    const hop = chunk([{ id: 'tram', at: (k) => onPath(PATH_A, k < 2 ? 100 : 100 + SNAP_M + 1) }]);
    near(drawnAt(hop, null, MS(1, 0.5), NET)[0]!.p, pathPoint(PATH_A, 100));
    const [placed] = placedAt(hop, null, MS(1, 0.5), NET);
    expect(placed!.snapped).toBe(true);
  });

  it('reads the next chunk for the last tick, and snaps without one or with the wrong one', () => {
    const first = chunk([{ id: 'tram', at: (k) => onPath(PATH_A, 100 + 50 * k) }]);
    const second = chunk([{ id: 'tram', at: (k) => onPath(PATH_A, 100 + 50 * (MOTION_TICKS + k)) }], T0 + MOTION_CHUNK_S);
    near(drawnAt(first, second, MS(59, 0.5), NET)[0]!.p, pathPoint(PATH_A, 100 + 50 * 59.5));
    near(drawnAt(first, null, MS(59, 0.5), NET)[0]!.p, pathPoint(PATH_A, 100 + 50 * 59));
    const elsewhere = chunk([{ id: 'tram', at: () => onPath(PATH_A, 0) }], T0 + 2 * MOTION_CHUNK_S);
    near(drawnAt(first, elsewhere, MS(59, 0.5), NET)[0]!.p, pathPoint(PATH_A, 100 + 50 * 59));
    // A vehicle the next chunk does not carry snaps too.
    const without = chunk([{ id: 'other', at: () => onPath(PATH_A, 0) }], T0 + MOTION_CHUNK_S);
    near(drawnAt(first, without, MS(59, 0.5), NET)[0]!.p, pathPoint(PATH_A, 100 + 50 * 59));
  });

  it('skips a geometry index this network does not carry', () => {
    const bad = chunk([{ id: 'tram', at: () => onPath(NET.paths.length + 10, 100) }]);
    expect(drawnAt(bad, null, MS(0), NET)).toEqual([]);
  });

  it('returns nothing for an instant outside the chunk and for no chunk', () => {
    expect(drawnAt(c, null, (T0 + MOTION_CHUNK_S) * 1000, NET)).toEqual([]);
    expect(drawnAt(null, null, MS(0), NET)).toEqual([]);
  });
});

describe('drawnAt on a bus shape and in the free plane', () => {
  it('a bus rides its shape: onShape is the shape, no path', () => {
    const c = chunk([{ id: 'bus', route: '109', label: '109', kind: 3, at: (k) => ({ on: 1, idx: BUS, s: 200 + 30 * k }) }]);
    const [d] = drawnAt(c, null, MS(1, 0.5), NET);
    const shape = NET.shapes[BUS]!;
    near(d!.p, at(shape.pts, shape.cum, 245));
    expect(d!.onShape).toBe(BUS);
    expect(d!.path).toBeUndefined();
    expect(d!.type).toBe(3);
    expect(d!.heading).not.toBeNull();
  });

  it('a free vehicle moves on a straight line between its fixes, with no heading and no shape', () => {
    const c = chunk([{ id: 'free', route: null, label: null, kind: null, at: (k) => ({ on: 2, idx: -1, lon: 15.97 + k * 0.0001, lat: 45.81 }) }]);
    const [d] = drawnAt(c, null, MS(2, 0.5), NET);
    const [lon, lat] = toLonLat(d!.p);
    expect(lon).toBeCloseTo(15.97025, 7);
    expect(lat).toBeCloseTo(45.81, 7);
    expect(d!.heading).toBeNull();
    expect(d!.onShape).toBeNull();
    expect(d!.type).toBe(-1);
    expect(d!.routeId).toBeUndefined();
    expect(d!.short).toBeUndefined();
    // A hop over 400 m in the plane snaps too.
    const hop = chunk([{ id: 'free', route: null, label: null, kind: null, at: (k) => ({ on: 2, idx: -1, lon: 15.97 + (k > 0 ? 0.01 : 0), lat: 45.81 }) }]);
    expect(toLonLat(drawnAt(hop, null, MS(0, 0.5), NET)[0]!.p)[0]).toBeCloseTo(15.97, 7);
  });
});

describe('ghosts', () => {
  it('aligns the comparison day by Zagreb time of day', () => {
    expect(compareInstant(parseZagrebLocal('2026-09-28T07:45')!)).toBe(parseZagrebLocal('2026-09-24T07:45')!);
    expect(compareInstant(parseZagrebLocal('2026-09-30T23:59')!)).toBe(parseZagrebLocal('2026-09-24T23:59')!);
    expect(compareInstant(SNIMKA_COMPARISONS[0].fromSec * 1000 + 4 * 86_400_000)).toBe(SNIMKA_COMPARISONS[0].fromSec * 1000);
  });

  it('answers [lon, lat] for the comparison chunk at the aligned instant', () => {
    const dayT0 = parseZagrebLocal('2026-09-24T07:40')! / 1000;
    const c = chunk([{ id: 'g', at: (k) => onPath(PATH_A, 100 + 50 * k) }], dayT0);
    const ghosts = ghostsAt(c, null, parseZagrebLocal('2026-09-28T07:40')! + 35_000, NET);
    expect(ghosts).toHaveLength(1);
    const [lon, lat] = toLonLat(pathPoint(PATH_A, 275));
    expect(ghosts[0]![0]).toBeCloseTo(lon, 9);
    expect(ghosts[0]![1]).toBeCloseTo(lat, 9);
    expect(ghostsAt(null, null, MS(0), NET)).toEqual([]);
  });
});

describe('createReplayModel', () => {
  const c = chunk([{ id: 'tram', at: (k) => onPath(PATH_A, 100 + 50 * k) }]);
  const base = { now: () => MS(3, 0.5), speed: () => 600 as const, vehiclesOn: () => true, chunksAt: () => ({ current: c, next: null }), net: NET };

  it('steps to the clock it is given, whatever the map says, and counts what it drew', () => {
    const model = createReplayModel(base);
    const drawn = model.step(1);
    expect(drawn).toHaveLength(1);
    near(drawn[0]!.p, pathPoint(PATH_A, 275));
    expect(model.size()).toBe(1);
    model.update([], 0);
    model.resync();
    expect(model.step(999_999_999)).toHaveLength(1);
  });

  it('draws nothing with the layer off, at one hour per second, without a chunk or without a network', () => {
    expect(createReplayModel({ ...base, vehiclesOn: () => false }).step(0)).toEqual([]);
    expect(createReplayModel({ ...base, speed: () => NO_VEHICLES_SPEED }).step(0)).toEqual([]);
    expect(createReplayModel({ ...base, chunksAt: () => null }).step(0)).toEqual([]);
    const model = createReplayModel({ ...base, net: null });
    expect(model.step(0)).toEqual([]);
    expect(model.size()).toBe(0);
  });
});

describe('cost', () => {
  it('places 400 vehicles and 400 ghosts well inside a frame', () => {
    const pool = [PATH_A, PATH_B, ...longPaths.slice(2, 40).map((p) => p.idx)];
    const many = chunk(Array.from({ length: 400 }, (_, i) => ({ id: `v${i}`, at: (k: number) => onPath(pool[i % pool.length]!, 50 + i + 30 * k) })));
    const day = chunk(Array.from({ length: 400 }, (_, i) => ({ id: `g${i}`, at: (k: number) => onPath(pool[i % pool.length]!, 80 + i + 30 * k) })), parseZagrebLocal('2026-09-24T07:40')! / 1000);
    drawnAt(many, null, MS(5, 0.5), NET);
    ghostsAt(day, null, MS(5, 0.5), NET);
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      drawnAt(many, null, MS(5 + (i % 50), 0.5), NET);
      ghostsAt(day, null, MS(5 + (i % 50), 0.5), NET);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    // The plan's manual measure is 4 ms; the gate here is loose because the host is shared.
    expect(times[Math.floor(times.length / 2)]!).toBeLessThan(40);
  });
});
