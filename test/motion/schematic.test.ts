import { describe, expect, it } from 'vitest';
import { dist, toPlane, type XY } from '../../app/src/motion/geo';
import { cumulative } from '../../app/src/motion/polyline';
import type { Network, Shape, Stop } from '../../app/src/motion/network';
import type { Drawn } from '../../app/src/motion/integrator';
import {
  BUS_SIDE_PX,
  clipToCircle,
  DEFAULT_CROP,
  HALO_PX,
  HIT_RADIUS_CSS_PX,
  hitVehicle,
  layoutSchematic,
  paintRoutes,
  paintVehicles,
  MIN_VEHICLE_ALPHA,
  ROUTE_ALPHA,
  TRAM_LENGTH_PX,
  TRAM_WIDTH_PX,
  vehicleMarks,
  wholeNetworkCrop,
  type Crop,
  type SchematicContext,
} from '../../app/src/motion/schematic';

// Every test here runs in plain node: the geometry is pure, and the two
// painters are exercised against a recording context that only knows the
// SchematicContext surface -- exactly the canvas-free pattern area M set for
// panorama.ts and meander.ts.

const GTFS_TRAM = 0;
const GTFS_BUS = 3;

function shapeOf(id: string, route: string, pts: XY[]): Shape {
  const cum = cumulative(pts);
  return { id, route, pts, cum, len: cum[cum.length - 1] };
}

function buildNetwork(shapes: Shape[], routes: Array<{ id: string; short: string; type: number }>, stops: Stop[] = []): Network {
  const map = new Map<string, { short: string; type: number; rank: number; shapes: number[] }>();
  routes.forEach((r, i) => {
    map.set(r.id, {
      short: r.short,
      type: r.type,
      rank: i + 1,
      shapes: shapes.map((s, k) => (s.route === r.id ? k : -1)).filter((k) => k >= 0),
    });
  });
  return {
    version: 1,
    feedVersion: 'test',
    routes: map,
    shapes,
    stops,
    diagram: { lines: [], box: [1, 1] },
    nextStop: () => null,
  };
}

const CENTRE: XY = { x: 0, y: 0 };

/** A straight west-east tram line through the centre (x from -2000 to 2000)
 *  and a bus line running south-north 500 m east of it. */
function crossNetwork(): Network {
  const tram = shapeOf('T', 'R-tram', [{ x: -2000, y: 0 }, { x: 2000, y: 0 }]);
  const bus = shapeOf('B', 'R-bus', [{ x: 500, y: -2000 }, { x: 500, y: 2000 }]);
  return buildNetwork([tram, bus], [
    { id: 'R-tram', short: '6', type: GTFS_TRAM },
    { id: 'R-bus', short: '109', type: GTFS_BUS },
  ]);
}

function drawn(over: Partial<Drawn> & { id: string; p: XY; type: number }): Drawn {
  return { heading: null, speed: 0, confidence: 1, onShape: null, ...over };
}

interface Call { op: string; args: unknown[] }

/** Records every call and every style assignment in order, so a test can
 *  assert on the sequence a real canvas would have received. */
function recorder(): { ctx: SchematicContext; calls: Call[] } {
  const calls: Call[] = [];
  const props: Record<string, unknown> = {
    strokeStyle: '', fillStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, globalAlpha: 1,
  };
  const method = (op: string) => (...args: unknown[]): void => { calls.push({ op, args }); };
  const target: Record<string, unknown> = {
    save: method('save'), restore: method('restore'), beginPath: method('beginPath'),
    moveTo: method('moveTo'), lineTo: method('lineTo'), rect: method('rect'), clip: method('clip'),
    stroke: method('stroke'), fillRect: method('fillRect'), clearRect: method('clearRect'),
    translate: method('translate'), rotate: method('rotate'),
  };
  const ctx = new Proxy(target, {
    get: (t, key: string) => (key in t ? t[key] : props[key]),
    set: (_t, key: string, value: unknown) => { props[key] = value; calls.push({ op: `set ${key}`, args: [value] }); return true; },
  }) as unknown as SchematicContext;
  return { ctx, calls };
}

describe('DEFAULT_CROP', () => {
  it('is centred on Trg bana Jelačića with a radius that shows about five to six stops', () => {
    const jelacic = toPlane(15.9769, 45.8130);
    expect(dist(DEFAULT_CROP.centre, jelacic)).toBeLessThan(1);
    // Zagreb's inner-city tram stops sit 400-500 m apart along a line, so a
    // 1.8 km diameter through the square carries five to six of them.
    expect(DEFAULT_CROP.radius).toBe(900);
  });
});

describe('clipToCircle', () => {
  const c: XY = { x: 0, y: 0 };

  it('keeps a polyline that lies entirely inside as a single run', () => {
    const runs = clipToCircle([{ x: -10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 0 }], c, 100);
    expect(runs).toEqual([[{ x: -10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 0 }]]);
  });

  it('drops a polyline that never enters the circle', () => {
    expect(clipToCircle([{ x: 200, y: 200 }, { x: 300, y: 200 }], c, 100)).toEqual([]);
    // A chord that passes near, but misses, the circle: y = 150, radius 100.
    expect(clipToCircle([{ x: -500, y: 150 }, { x: 500, y: 150 }], c, 100)).toEqual([]);
  });

  it('cuts a segment that crosses the circle at both rims', () => {
    const runs = clipToCircle([{ x: -500, y: 0 }, { x: 500, y: 0 }], c, 100);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(2);
    expect(runs[0][0].x).toBeCloseTo(-100, 6);
    expect(runs[0][1].x).toBeCloseTo(100, 6);
  });

  it('splits into two runs when the line leaves the circle and comes back', () => {
    // In from the west, out the north, along the top (y=300, wholly outside),
    // back in from the north, out the east. Radius 100.
    const pts: XY[] = [
      { x: -500, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 300 }, { x: 50, y: 300 }, { x: 50, y: 0 }, { x: 500, y: 0 },
    ];
    const runs = clipToCircle(pts, c, 100);
    expect(runs).toHaveLength(2);
    // First run: enters at x=-100, passes the centre, exits going north at y=100.
    expect(runs[0][0].x).toBeCloseTo(-100, 6);
    expect(runs[0][runs[0].length - 1].y).toBeCloseTo(100, 6);
    // Second run: re-enters coming south at (50, sqrt(100^2-50^2)), exits east at x=100.
    expect(runs[1][0].y).toBeCloseTo(Math.sqrt(100 * 100 - 50 * 50), 6);
    expect(runs[1][runs[1].length - 1].x).toBeCloseTo(100, 6);
  });

  it('every emitted point lies on or inside the circle', () => {
    const pts: XY[] = [];
    for (let i = 0; i < 60; i++) pts.push({ x: Math.cos(i / 3) * i * 12, y: Math.sin(i / 5) * i * 9 });
    const runs = clipToCircle(pts, c, 250);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.length).toBeGreaterThanOrEqual(2);
      for (const p of run) expect(dist(p, c)).toBeLessThanOrEqual(250 + 1e-6);
    }
  });
});

describe('layoutSchematic', () => {
  it('maps the crop centre to the canvas centre and fits the crop circle into the shorter side', () => {
    const crop: Crop = { centre: { x: 1000, y: 2000 }, radius: 500 };
    const l = layoutSchematic(crossNetwork(), crop, 800, 400);
    expect(l.toPx(crop.centre)).toEqual({ x: 400, y: 200 });
    // 500 m of radius spans half of the shorter side (200 px) -> 0.4 px/m.
    expect(l.scale).toBeCloseTo(0.4, 9);
    // Plane y points north (up); canvas y points down.
    const north = l.toPx({ x: 1000, y: 2500 });
    expect(north.x).toBeCloseTo(400, 9);
    expect(north.y).toBeCloseTo(0, 9);
    const east = l.toPx({ x: 1500, y: 2000 });
    expect(east.x).toBeCloseTo(600, 9);
    expect(east.y).toBeCloseTo(200, 9);
  });

  it('counts device density into the scale so metres per CSS pixel stay the same at 2x', () => {
    const crop: Crop = { centre: CENTRE, radius: 500 };
    const one = layoutSchematic(crossNetwork(), crop, 800, 400, 1);
    const two = layoutSchematic(crossNetwork(), crop, 1600, 800, 2);
    expect(two.scale).toBeCloseTo(one.scale * 2, 9);
    expect(two.density).toBe(2);
  });

  it('clips every route line to the crop circle and keeps them in pixel space', () => {
    const crop: Crop = { centre: CENTRE, radius: 1000 };
    const l = layoutSchematic(crossNetwork(), crop, 400, 400);
    expect(l.lines).toHaveLength(2);
    for (const line of l.lines) {
      for (const p of line.pts) {
        // Canvas centre is (200,200) and the radius is 200 px.
        expect(Math.hypot(p.x - 200, p.y - 200)).toBeLessThanOrEqual(200 + 1e-6);
      }
    }
    const tram = l.lines.find((x) => x.type === GTFS_TRAM);
    expect(tram).toBeDefined();
    if (!tram) return;
    expect(tram.pts[0].x).toBeCloseTo(0, 6);
    expect(tram.pts[tram.pts.length - 1].x).toBeCloseTo(400, 6);
    expect(tram.pts[0].y).toBeCloseTo(200, 6);
  });

  it('restricts the route layer to the requested route types (trams only on a locked kiosk, R-P1)', () => {
    const l = layoutSchematic(crossNetwork(), { centre: CENTRE, radius: 1000 }, 400, 400, 1, new Set([GTFS_TRAM]));
    expect(l.lines.map((x) => x.type)).toEqual([GTFS_TRAM]);
    expect(l.types).toEqual(new Set([GTFS_TRAM]));
  });

  it('leaves out a route that lies wholly outside the crop', () => {
    const l = layoutSchematic(crossNetwork(), { centre: { x: 5000, y: 5000 }, radius: 100 }, 400, 400);
    expect(l.lines).toEqual([]);
  });
});

describe('wholeNetworkCrop', () => {
  it('encloses every shape point of the requested types with a little breathing room', () => {
    const net = crossNetwork();
    const all = wholeNetworkCrop(net);
    // Bounding box of both lines: x -2000..2000, y -2000..2000 -> centre (0,0).
    expect(all.centre.x).toBeCloseTo(0, 6);
    expect(all.centre.y).toBeCloseTo(0, 6);
    for (const sh of net.shapes) for (const p of sh.pts) expect(dist(p, all.centre)).toBeLessThanOrEqual(all.radius);
    // Trams only: x -2000..2000, y 0 -> the tram line's own half-length, padded.
    const trams = wholeNetworkCrop(net, new Set([GTFS_TRAM]));
    expect(trams.centre).toEqual({ x: 0, y: 0 });
    expect(trams.radius).toBeGreaterThanOrEqual(2000);
    expect(trams.radius).toBeLessThan(2000 * 1.2);
  });

  it('falls back to the default crop when nothing matches', () => {
    expect(wholeNetworkCrop(crossNetwork(), new Set([99]))).toEqual(DEFAULT_CROP);
  });
});

describe('vehicleMarks', () => {
  const crop: Crop = { centre: CENTRE, radius: 1000 };

  // R-V2: minimum on-screen sizes, whatever --kiosk-scale and density do --
  // a bus is a 10 px square, a tram 14 by 5 px: at most half the bus's side,
  // visibly thinner, and still a shape rather than a hairline.
  it('draws a bus as a 10 px square with no rotation and a tram as a 14 by 5 px rectangle, visibly thinner (R-V2)', () => {
    expect(BUS_SIDE_PX).toBe(10);
    expect(TRAM_LENGTH_PX).toBe(14);
    expect(TRAM_WIDTH_PX).toBe(5);
    expect(TRAM_WIDTH_PX).toBeLessThanOrEqual(BUS_SIDE_PX / 2);
    const l = layoutSchematic(crossNetwork(), crop, 400, 400);
    const marks = vehicleMarks(l, [
      drawn({ id: 'bus', p: { x: 500, y: 0 }, type: GTFS_BUS, heading: { x: 0, y: 1 } }),
      drawn({ id: 'tram', p: { x: 0, y: 0 }, type: GTFS_TRAM, heading: { x: 1, y: 0 }, onShape: 0 }),
    ]);
    const bus = marks.find((m) => m.id === 'bus');
    const tram = marks.find((m) => m.id === 'tram');
    expect(bus).toBeDefined();
    expect(tram).toBeDefined();
    if (!bus || !tram) return;
    expect(bus.kind).toBe('bus');
    expect(bus.w).toBe(10);
    expect(bus.h).toBe(10);
    expect(bus.angle).toBe(0); // no rotation, whatever the heading says
    expect(tram.kind).toBe('tram');
    expect(tram.w).toBe(14);
    expect(tram.h).toBe(5);
  });

  it('scales the marks with device density, so 10 CSS px stays 10 CSS px at 2x', () => {
    const l = layoutSchematic(crossNetwork(), crop, 800, 800, 2);
    const [bus] = vehicleMarks(l, [drawn({ id: 'b', p: { x: 500, y: 0 }, type: GTFS_BUS })]);
    expect(bus.w).toBe(20);
    expect(bus.h).toBe(20);
  });

  it('rotates a tram to its heading, in canvas angle (y down)', () => {
    const l = layoutSchematic(crossNetwork(), crop, 400, 400);
    const east = vehicleMarks(l, [drawn({ id: 'e', p: CENTRE, type: GTFS_TRAM, heading: { x: 1, y: 0 } })])[0];
    const north = vehicleMarks(l, [drawn({ id: 'n', p: CENTRE, type: GTFS_TRAM, heading: { x: 0, y: 1 } })])[0];
    expect(east.angle).toBeCloseTo(0, 9);
    // North in the plane is "up" on the canvas: -90 degrees in canvas rotation.
    expect(north.angle).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('lays a tram whose direction is undecided along the track the model hands it, instead of guessing', () => {
    // A north-south tram line; the vehicle stands on it with heading null
    // but the model's own tangent at the drawn position (Drawn.track).
    const ns = shapeOf('NS', 'R-tram', [{ x: 0, y: -1000 }, { x: 0, y: 1000 }]);
    const net = buildNetwork([ns], [{ id: 'R-tram', short: '1', type: GTFS_TRAM }]);
    const l = layoutSchematic(net, crop, 400, 400);
    const [m] = vehicleMarks(l, [drawn({ id: 't', p: { x: 0, y: 100 }, type: GTFS_TRAM, heading: null, onShape: 0, track: { x: 0, y: 1 } })]);
    // Along the track: vertical on the canvas, either sign.
    expect(Math.abs(Math.sin(m.angle))).toBeCloseTo(1, 9);
  });

  it('never re-projects a tram onto its shape per frame: with no heading and no track from the model the mark is unrotated', () => {
    const ns = shapeOf('NS', 'R-tram', [{ x: 0, y: -1000 }, { x: 0, y: 1000 }]);
    const net = buildNetwork([ns], [{ id: 'R-tram', short: '1', type: GTFS_TRAM }]);
    const l = layoutSchematic(net, crop, 400, 400);
    const [m] = vehicleMarks(l, [drawn({ id: 't', p: { x: 0, y: 100 }, type: GTFS_TRAM, heading: null, onShape: 0 })]);
    expect(m.angle).toBe(0);
  });

  it('gives a free-plane tram with no heading an unrotated mark', () => {
    const l = layoutSchematic(crossNetwork(), crop, 400, 400);
    const [m] = vehicleMarks(l, [drawn({ id: 't', p: { x: 100, y: 100 }, type: GTFS_TRAM, heading: null, onShape: null })]);
    expect(m.angle).toBe(0);
  });

  it('carries confidence in alpha as MIN_VEHICLE_ALPHA + (1 - MIN_VEHICLE_ALPHA) * confidence, so the least confident vehicle is still darker than the line under it (R-V2)', () => {
    expect(MIN_VEHICLE_ALPHA).toBe(0.7);
    expect(MIN_VEHICLE_ALPHA).toBeGreaterThanOrEqual(ROUTE_ALPHA);
    const l = layoutSchematic(crossNetwork(), crop, 400, 400);
    const [sure, unsure, none] = vehicleMarks(l, [
      drawn({ id: 'a', p: CENTRE, type: GTFS_TRAM, confidence: 1 }),
      drawn({ id: 'b', p: CENTRE, type: GTFS_TRAM, confidence: 0.5 }),
      drawn({ id: 'c', p: CENTRE, type: GTFS_TRAM, confidence: 0 }),
    ]);
    expect(sure.alpha).toBe(1);
    expect(unsure.alpha).toBeCloseTo(MIN_VEHICLE_ALPHA + (1 - MIN_VEHICLE_ALPHA) * 0.5, 9);
    expect(none.alpha).toBe(MIN_VEHICLE_ALPHA);
  });

  it('leaves out vehicles outside the crop and types the layout excludes', () => {
    const l = layoutSchematic(crossNetwork(), crop, 400, 400, 1, new Set([GTFS_TRAM]));
    const marks = vehicleMarks(l, [
      drawn({ id: 'far', p: { x: 1500, y: 0 }, type: GTFS_TRAM }),
      drawn({ id: 'bus', p: { x: 500, y: 0 }, type: GTFS_BUS }),
      drawn({ id: 'ok', p: { x: 100, y: 0 }, type: GTFS_TRAM }),
    ]);
    expect(marks.map((m) => m.id)).toEqual(['ok']);
  });

  it('places the mark at the drawn position in pixels', () => {
    const l = layoutSchematic(crossNetwork(), crop, 400, 400);
    const [m] = vehicleMarks(l, [drawn({ id: 't', p: { x: 500, y: 500 }, type: GTFS_TRAM })]);
    expect(m.x).toBeCloseTo(300, 9);
    expect(m.y).toBeCloseTo(100, 9);
  });
});

describe('paintRoutes', () => {
  it('clears the layer and strokes every clipped run in the line tone (label blue) at alpha 0.55 and 2 CSS px (R-V2)', () => {
    expect(ROUTE_ALPHA).toBe(0.55);
    const l = layoutSchematic(crossNetwork(), { centre: CENTRE, radius: 1000 }, 800, 800, 2);
    const { ctx, calls } = recorder();
    paintRoutes(ctx, l, '#9db4ff');
    expect(calls[0]).toEqual({ op: 'clearRect', args: [0, 0, 800, 800] });
    expect(calls.filter((c) => c.op === 'stroke')).toHaveLength(2);
    expect(calls.find((c) => c.op === 'set strokeStyle')?.args).toEqual(['#9db4ff']);
    expect(calls.find((c) => c.op === 'set globalAlpha')?.args).toEqual([ROUTE_ALPHA]);
    expect(calls.find((c) => c.op === 'set lineWidth')?.args).toEqual([4]); // 2 CSS px at density 2
    // Every run is stroked as one moveTo followed by lineTo calls.
    expect(calls.filter((c) => c.op === 'moveTo')).toHaveLength(2);
    expect(calls.filter((c) => c.op === 'lineTo').length).toBeGreaterThanOrEqual(2);
    // The painter restores whatever state it changed.
    expect(calls.filter((c) => c.op === 'save')).toHaveLength(calls.filter((c) => c.op === 'restore').length);
    expect(calls.filter((c) => c.op === 'save').length).toBeGreaterThan(0);
  });

  it('does nothing beyond clearing when no route lies in the crop', () => {
    const l = layoutSchematic(crossNetwork(), { centre: { x: 9000, y: 9000 }, radius: 10 }, 100, 100);
    const { ctx, calls } = recorder();
    paintRoutes(ctx, l, '#000');
    expect(calls.map((c) => c.op)).toEqual(['clearRect']);
  });
});

describe('paintVehicles', () => {
  const TONES = { ink: '#16226b', halo: '#f2ead8' };

  it('clears the layer, then for each mark fills a one-pixel halo in the canvas tone and the mark in ink at its own alpha, rotating only trams (R-V2)', () => {
    const l = layoutSchematic(crossNetwork(), { centre: CENTRE, radius: 1000 }, 400, 400);
    const marks = vehicleMarks(l, [
      drawn({ id: 'bus', p: { x: 500, y: 0 }, type: GTFS_BUS, confidence: 0.5 }),
      drawn({ id: 'tram', p: CENTRE, type: GTFS_TRAM, heading: { x: 0, y: 1 }, confidence: 1 }),
    ]);
    const { ctx, calls } = recorder();
    paintVehicles(ctx, l, marks, TONES);
    expect(calls[0]).toEqual({ op: 'clearRect', args: [0, 0, 400, 400] });
    // Halo, then mark, per vehicle: the halo is what separates a vehicle
    // from the line under it and from a neighbour at the same stop.
    expect(calls.filter((c) => c.op === 'set fillStyle').map((c) => c.args[0])).toEqual([TONES.halo, TONES.ink, TONES.halo, TONES.ink]);
    const fills = calls.filter((c) => c.op === 'fillRect').map((c) => c.args);
    expect(HALO_PX).toBe(1);
    // Each mark is drawn centred on its own origin after a translate, so the
    // rect sits at (-w/2, -h/2); the halo is one CSS px larger on every side.
    expect(fills).toEqual([
      [-6, -6, 12, 12],
      [-5, -5, 10, 10],
      [-8, -3.5, 16, 7],
      [-7, -2.5, 14, 5],
    ]);
    const rotates = calls.filter((c) => c.op === 'rotate');
    expect(rotates).toHaveLength(1);
    expect(rotates[0].args[0]).toBeCloseTo(-Math.PI / 2, 9);
    // The halo is always opaque; only the mark carries confidence.
    const alphas = calls.filter((c) => c.op === 'set globalAlpha').map((c) => c.args[0] as number);
    expect(alphas).toEqual([1, MIN_VEHICLE_ALPHA + (1 - MIN_VEHICLE_ALPHA) * 0.5, 1, 1]);
    expect(calls.filter((c) => c.op === 'save')).toHaveLength(2);
    expect(calls.filter((c) => c.op === 'restore')).toHaveLength(2);
  });

  it('scales the halo with device density, so it stays one CSS pixel at 2x', () => {
    const l = layoutSchematic(crossNetwork(), { centre: CENTRE, radius: 1000 }, 800, 800, 2);
    const marks = vehicleMarks(l, [drawn({ id: 'bus', p: { x: 500, y: 0 }, type: GTFS_BUS })]);
    const { ctx, calls } = recorder();
    paintVehicles(ctx, l, marks, TONES);
    const fills = calls.filter((c) => c.op === 'fillRect').map((c) => c.args);
    expect(fills).toEqual([
      [-12, -12, 24, 24],
      [-10, -10, 20, 20],
    ]);
  });

  it('only clears when there is nothing to draw', () => {
    const l = layoutSchematic(crossNetwork(), { centre: CENTRE, radius: 1000 }, 400, 400);
    const { ctx, calls } = recorder();
    paintVehicles(ctx, l, [], TONES);
    expect(calls.map((c) => c.op)).toEqual(['clearRect']);
  });
});

describe('hitVehicle (T9: tap or click a vehicle)', () => {
  const l = layoutSchematic(crossNetwork(), { centre: CENTRE, radius: 1000 }, 400, 400, 2);
  const marks = vehicleMarks(l, [
    drawn({ id: 'bus', p: { x: 500, y: 0 }, type: GTFS_BUS }),
    drawn({ id: 'tram', p: CENTRE, type: GTFS_TRAM }),
  ]);
  // WCAG 2.5.8: a pointer target is at least 24 by 24 CSS px, so a 3.5 px
  // tram is reached through a 12 px radius around its centre, not its ink.
  it('reaches a mark through a 24 CSS px target, scaled by density', () => {
    expect(HIT_RADIUS_CSS_PX).toBe(12);
    const tram = marks.find((m) => m.id === 'tram')!;
    expect(hitVehicle(marks, tram.x + 20, tram.y, l.density)?.id).toBe('tram'); // 20 device px = 10 CSS px at density 2
    expect(hitVehicle(marks, tram.x + 30, tram.y, l.density)).toBeNull(); // 15 CSS px: outside the target
  });
  it('picks the nearest when two targets overlap, and null on empty canvas', () => {
    const near = vehicleMarks(l, [
      drawn({ id: 'a', p: { x: 0, y: 0 }, type: GTFS_BUS }),
      drawn({ id: 'b', p: { x: 20, y: 0 }, type: GTFS_BUS }), // 20 m = 4 device px apart at this scale
    ]);
    const b = near.find((m) => m.id === 'b')!;
    expect(hitVehicle(near, b.x + 1, b.y, l.density)?.id).toBe('b');
    expect(hitVehicle([], 200, 200, l.density)).toBeNull();
  });
});

describe('paintVehicles with a selection', () => {
  it('strokes a square ring around the selected mark only, in ink, after its fill', () => {
    const l = layoutSchematic(crossNetwork(), { centre: CENTRE, radius: 1000 }, 400, 400);
    const marks = vehicleMarks(l, [
      drawn({ id: 'bus', p: { x: 500, y: 0 }, type: GTFS_BUS }),
      drawn({ id: 'tram', p: CENTRE, type: GTFS_TRAM, heading: { x: 1, y: 0 } }),
    ]);
    const { ctx, calls } = recorder();
    paintVehicles(ctx, l, marks, { ink: '#16226b', halo: '#f2ead8' }, 'tram');
    const rects = calls.filter((c) => c.op === 'rect');
    expect(rects).toHaveLength(1);
    const side = TRAM_LENGTH_PX * 2;
    expect(rects[0].args).toEqual([-side / 2, -side / 2, side, side]);
    expect(calls.filter((c) => c.op === 'stroke')).toHaveLength(1);
    // The ring is ink, not halo: it says "this one" in the mark's own voice.
    expect(calls.find((c) => c.op === 'set strokeStyle')?.args).toEqual(['#16226b']);
    // The ring is drawn inside the tram's own save/translate/rotate frame, so
    // it sits on the mark: rect comes after that mark's fillRect and before
    // its restore.
    const ops = calls.map((c) => c.op);
    const fillIdx = ops.lastIndexOf('fillRect');
    expect(ops.indexOf('rect')).toBeGreaterThan(fillIdx);
    expect(ops.indexOf('rect')).toBeLessThan(ops.lastIndexOf('restore'));
  });
  it('draws no ring when the selected id is not among the marks', () => {
    const l = layoutSchematic(crossNetwork(), { centre: CENTRE, radius: 1000 }, 400, 400);
    const marks = vehicleMarks(l, [drawn({ id: 'bus', p: { x: 500, y: 0 }, type: GTFS_BUS })]);
    const { ctx, calls } = recorder();
    paintVehicles(ctx, l, marks, { ink: '#16226b', halo: '#f2ead8' }, 'gone');
    expect(calls.filter((c) => c.op === 'rect')).toHaveLength(0);
  });
});
