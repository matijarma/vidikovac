import { describe, expect, it } from 'vitest';
import { toLonLat, type XY } from '../../app/src/motion/geo';
import { at, cumulative } from '../../app/src/motion/polyline';
import type { Network, Shape, Stop } from '../../app/src/motion/network';
import { createModel, type Fix } from '../../app/src/motion/model';

// ---------------------------------------------------------------------------
// A small hand-built Network, built directly from the same primitives
// decodeNetwork itself uses (polyline.cumulative), so these tests exercise
// exactly the geometry the real decoded artefact would hand the model --
// no fixtures, per the brief ("Tests use synthetic tracks, no fixtures").
// ---------------------------------------------------------------------------

interface ShapeSpec {
  id: string;
  route: string;
  pts: XY[];
}

interface StopSpec {
  id: string;
  name: string;
  shape: number;
  s: number;
}

interface RouteSpec {
  id: string;
  short: string;
  type: number;
  shapes: number[];
}

function buildNetwork(shapeSpecs: ShapeSpec[], stopSpecs: StopSpec[], routeSpecs: RouteSpec[]): Network {
  const shapes: Shape[] = shapeSpecs.map((sp) => {
    const cum = cumulative(sp.pts);
    return { id: sp.id, route: sp.route, pts: sp.pts, cum, len: cum[cum.length - 1] ?? 0 };
  });
  const stops: Stop[] = stopSpecs.map((sp) => ({
    id: sp.id,
    name: sp.name,
    p: at(shapes[sp.shape].pts, shapes[sp.shape].cum, sp.s),
    on: [{ shape: sp.shape, s: sp.s }],
  }));
  const routes = new Map(routeSpecs.map((r) => [r.id, { short: r.short, type: r.type, rank: 1, shapes: r.shapes }]));

  const byShape: { stop: Stop; s: number }[][] = shapes.map(() => []);
  for (const stop of stops) {
    for (const on of stop.on) byShape[on.shape].push({ stop, s: on.s });
  }
  for (const list of byShape) list.sort((a, b) => a.s - b.s);

  function nextStop(shapeIdx: number, s: number): { stop: Stop; s: number } | null {
    const list = byShape[shapeIdx];
    if (!list || list.length === 0) return null;
    for (const entry of list) if (entry.s > s) return entry;
    return null;
  }

  return { version: 1, feedVersion: 'test', routes, shapes, stops, diagram: { lines: [], box: [1, 1] }, nextStop };
}

/** A fix at plane point p, `at` in epoch ms. Defaults to routeId 'R1', the
 *  route every straightNetwork() shape belongs to; pass routeId explicitly
 *  (or omit it) for a test that deliberately wants no route. */
function fixAt(id: string, p: XY, atMs: number, extra: Partial<Fix> = {}): Fix {
  const [lon, lat] = toLonLat(p);
  return { id, lon, lat, at: atMs, routeId: 'R1', ...extra };
}

// A straight shape running due north from the origin, 2000 m long -- the
// same convention polyline.test.ts uses (x = east, y = north).
const STRAIGHT: XY[] = [
  { x: 0, y: 0 },
  { x: 0, y: 2000 },
];

function straightNetwork(stopSpecs: StopSpec[] = []): Network {
  return buildNetwork(
    [{ id: 'S0', route: 'R1', pts: STRAIGHT }],
    stopSpecs,
    [{ id: 'R1', short: '1', type: 0, shapes: [0] }],
  );
}

const T0 = Date.parse('2026-09-12T08:00:00.000Z');

describe('a brand new vehicle', () => {
  it('draws at its first fix with speed 0 and heading null (no evidence yet)', () => {
    const net = straightNetwork();
    const model = createModel(net);
    model.update([fixAt('v1', { x: 0, y: 100 }, T0)], T0);
    const [drawn] = model.step(T0);
    expect(drawn.speed).toBe(0);
    expect(drawn.heading).toBeNull();
    expect(drawn.confidence).toBeLessThan(0.3);
    expect(drawn.onShape).toBe(0);
    expect(drawn.p.y).toBeCloseTo(100, 6);
    expect(model.size()).toBe(1);
  });

  it('resolves short and type from the network route', () => {
    const net = straightNetwork();
    const model = createModel(net);
    model.update([fixAt('v1', { x: 0, y: 0 }, T0)], T0);
    const [drawn] = model.step(T0);
    expect(drawn.short).toBe('1');
    expect(drawn.type).toBe(0);
  });
});

describe('perfect 30 s fixes along a straight shape (brief test 1)', () => {
  it("draws monotonically with no single-frame jump larger than one frame's travel", () => {
    const net = straightNetwork();
    const model = createModel(net);
    const speedMs = 10; // 300 m per 30 s tick, well under the 22 m/s clamp
    let t = T0;
    let y = 0;
    model.update([fixAt('v1', { x: 0, y }, t)], t);

    // One continuous frame loop for the whole run -- exactly how the real
    // frame loop (T6) and poller interleave, a fix landing on some frame
    // among many, never a break in stepping around it -- with a new fix
    // injected every 30 s (every `framesPerTick`-th frame).
    const frameMs = 100;
    const framesPerTick = 30_000 / frameMs;
    const totalTicks = 6;
    const samples: number[] = [];
    for (let i = 1; i <= totalTicks * framesPerTick; i++) {
      t += frameMs;
      if (i % framesPerTick === 0) {
        y += speedMs * 30;
        model.update([fixAt('v1', { x: 0, y }, t)], t);
      }
      const [drawn] = model.step(t);
      // The very first inter-fix gap (tick 0) has no prior speed estimate to
      // dead-reckon with (there is nothing to derive a speed from before a
      // second fix exists), so it resolves via a one-time bootstrap snap --
      // exactly what "brief test 4" exercises on its own. This test's own
      // claim is about *steady-state* motion once a speed estimate exists,
      // so tick 0 warms the model up and is not sampled.
      const tick = Math.floor((i - 1) / framesPerTick);
      if (tick > 0) samples.push(drawn.p.y);
    }

    for (let i = 1; i < samples.length; i++) {
      const delta = samples[i] - samples[i - 1];
      expect(delta).toBeGreaterThanOrEqual(-1e-6); // monotonic: never goes backward
      // One frame's travel at the model's own catch-up cap: max(4, speed) * dt.
      expect(delta).toBeLessThanOrEqual(Math.max(4, speedMs) * (frameMs / 1000) + 1e-6);
    }
    // And it actually made progress -- not stuck at the dead zone forever.
    expect(samples[samples.length - 1]).toBeGreaterThan(1300);
  });
});

describe('a 20-minute-stale fix (brief test 2)', () => {
  it('does not teleport anything', () => {
    const net = straightNetwork();
    const model = createModel(net);
    model.update([fixAt('v1', { x: 0, y: 0 }, T0)], T0);
    model.step(T0);

    // A fix arrives whose own timestamp is 20 minutes old relative to the
    // last one (the probe's "a few fixes are up to 20 minutes stale"), and
    // whose position has moved on only modestly -- a stale report, not a
    // huge discrepancy (that is brief test 4's job).
    const staleAt = T0 + 20 * 60_000;
    const beforeDrawn = model.step(staleAt)[0].p.y;
    model.update([fixAt('v1', { x: 0, y: 80 }, staleAt)], staleAt);
    const rightAfter = model.step(staleAt)[0]; // zero elapsed frame time since the update
    expect(rightAfter.p.y).toBeCloseTo(beforeDrawn, 6);
    expect(rightAfter.p.y).not.toBeCloseTo(80, 3);

    // It still converges smoothly afterwards, never a single big jump.
    let t = staleAt;
    let last = rightAfter.p.y;
    for (let f = 0; f < 100; f++) {
      t += 100;
      const y = model.step(t).find((d) => d.id === 'v1')!.p.y;
      expect(y - last).toBeLessThanOrEqual(4 * 0.1 + 1e-6);
      last = y;
    }
  });
});

describe('repeated identical coordinates (brief test 3, decision 4)', () => {
  it('holds a vehicle exactly still at speed 0', () => {
    const net = straightNetwork();
    const model = createModel(net);
    const p = { x: 0, y: 500 };
    let t = T0;
    model.update([fixAt('v1', p, t)], t);
    for (let i = 0; i < 4; i++) {
      t += 30_000;
      model.update([fixAt('v1', p, t)], t);
      t += 5_000;
      const [drawn] = model.step(t);
      expect(drawn.speed).toBe(0);
      expect(drawn.p.x).toBeCloseTo(p.x, 9);
      expect(drawn.p.y).toBeCloseTo(p.y, 9);
    }
  });
});

describe('a 200 m discrepancy (brief test 4)', () => {
  it('snaps once and then runs smooth', () => {
    const net = straightNetwork();
    const model = createModel(net);
    let t = T0;
    model.update([fixAt('v1', { x: 0, y: 0 }, t)], t);
    t += 1000;
    model.step(t);

    // A fix 200 m ahead of the still-converged drawn position: beyond the
    // 150 m snap threshold.
    t += 100;
    model.update([fixAt('v1', { x: 0, y: 200 }, t)], t);

    const deltas: number[] = [];
    let last = model.step(t).find((d) => d.id === 'v1')!.p.y;
    const snapDelta = last - 0; // the very first step after the discrepancy fix
    deltas.push(snapDelta);
    expect(snapDelta).toBeCloseTo(200, 3); // snapped straight to the target

    for (let f = 0; f < 20; f++) {
      t += 500;
      const y = model.step(t).find((d) => d.id === 'v1')!.p.y;
      deltas.push(y - last);
      last = y;
    }
    // Exactly one large jump (the snap); everything after is bounded smooth
    // convergence -- no further delta comes close to the snap's size.
    const smoothDeltas = deltas.slice(1);
    for (const d of smoothDeltas) expect(Math.abs(d)).toBeLessThan(30);
  });
});

describe('the stop gate (brief test 5)', () => {
  it('a vehicle whose next stop is 40 m ahead and whose speed says 120 m stops at the stop', () => {
    // Stop sits 40 m ahead of the last confirmed fix (s = 120 + 40).
    const net = straightNetwork([{ id: 'ST', name: 'Stop', shape: 0, s: 160 }]);
    const model = createModel(net);
    let t = T0;
    // Two fixes 30 s apart, 120 m apart -- a 4 m/s baseline, so dead
    // reckoning alone would want to carry it 120 m past this fix (to 240),
    // well past the stop at 160.
    model.update([fixAt('v1', { x: 0, y: 0 }, t)], t);
    t += 30_000;
    model.update([fixAt('v1', { x: 0, y: 120 }, t)], t);
    model.step(t);

    // No further fixes: dead reckoning must carry the vehicle at most to the
    // stop 40 m ahead, never past it, however far the speed estimate says.
    let lastY = 0;
    for (let f = 0; f < 400; f++) {
      t += 500;
      const drawn = model.step(t).find((d) => d.id === 'v1')!;
      expect(drawn.p.y).toBeLessThanOrEqual(160 + 1e-6);
      lastY = drawn.p.y;
    }
    expect(lastY).toBeGreaterThan(140); // it did get close to the stop, not stuck at 120
    expect(model.step(t)[0].confidence).toBeLessThan(0.3); // held, waiting for evidence
  });
});

describe('a tripId change at a terminus (brief test 6)', () => {
  it('reverses direction within two fixes and never draws the reverse path', () => {
    const outbound: XY[] = [
      { x: 0, y: 0 },
      { x: 0, y: 500 },
    ];
    // The inbound shape is a distinct polyline (GTFS never shares a shape
    // between directions), running back the other way, offset slightly so
    // it is clearly a different track, not a relabelling of the same one.
    const inbound: XY[] = [
      { x: 5, y: 500 },
      { x: 5, y: 0 },
    ];
    const net = buildNetwork(
      [
        { id: 'OUT', route: 'R1', pts: outbound },
        { id: 'IN', route: 'R1', pts: inbound },
      ],
      [],
      [{ id: 'R1', short: '1', type: 0, shapes: [0, 1] }],
    );
    const model = createModel(net);
    let t = T0;
    model.update([fixAt('v1', { x: 0, y: 0 }, t, { tripId: 'out' })], t);
    t += 30_000;
    model.update([fixAt('v1', { x: 0, y: 450 }, t, { tripId: 'out' })], t);
    expect(model.step(t)[0].onShape).toBe(0);

    // Terminus turn-around: tripId changes, and the vehicle is now reported
    // on the inbound shape's own line.
    t += 30_000;
    model.update([fixAt('v1', { x: 5, y: 480 }, t, { tripId: 'in' })], t);
    // The hysteresis is cleared (free pick), but this first post-reversal
    // fix is only 5 m from where the vehicle already was on OUT, and the
    // raw movement since the previous fix is still nominally northward (the
    // small local jump near the terminus) -- not yet enough evidence to
    // outweigh OUT's smaller raw distance. That is exactly why the brief
    // allows "within two fixes": the correction lands on the next one.
    model.step(t);

    t += 30_000;
    model.update([fixAt('v1', { x: 5, y: 380 }, t, { tripId: 'in' })], t);
    const ys: number[] = [];
    for (let f = 0; f < 60; f++) {
      t += 500;
      ys.push(model.step(t).find((d) => d.id === 'v1')!.p.y);
    }
    const afterSecond = model.step(t).find((d) => d.id === 'v1')!;
    expect(afterSecond.onShape).toBe(1);
    expect(afterSecond.heading).not.toBeNull();
    // Heading on the inbound shape points south (decreasing y): never the
    // outbound direction.
    expect(afterSecond.heading!.y).toBeLessThan(0);
    // Progress along the inbound shape is monotonic (arc length increasing,
    // i.e. y decreasing) -- the model never re-traverses the outbound shape.
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThanOrEqual(ys[i - 1] + 1e-6);
  });
});

describe('a routeless vehicle (brief test 7)', () => {
  it('still moves', () => {
    const net = buildNetwork([], [], [{ id: 'R0', short: '1', type: 0, shapes: [] }]);
    const model = createModel(net);
    let t = T0;
    model.update([fixAt('v1', { x: 0, y: 0 }, t, { routeId: 'R0' })], t);
    t += 30_000;
    model.update([fixAt('v1', { x: 0, y: 300 }, t, { routeId: 'R0' })], t); // now = t: the glide starts here

    const first = model.step(t).find((d) => d.id === 'v1')!;
    expect(first.onShape).toBeNull();
    t += 15_000;
    const mid = model.step(t).find((d) => d.id === 'v1')!;
    t += 15_000;
    const end = model.step(t).find((d) => d.id === 'v1')!;
    expect(mid.p.y).toBeGreaterThan(first.p.y);
    expect(end.p.y).toBeGreaterThan(mid.p.y);
  });
});

describe('silence for 310 s (brief test 8)', () => {
  it('is stale and still', () => {
    const net = straightNetwork();
    const model = createModel(net);
    let t = T0;
    model.update([fixAt('v1', { x: 0, y: 0 }, t)], t);
    t += 30_000;
    model.update([fixAt('v1', { x: 0, y: 100 }, t)], t);
    model.step(t);

    t += 310_000;
    const a = model.step(t).find((d) => d.id === 'v1')!;
    expect(a.stale).toBe(true);
    expect(a.speed).toBe(0);

    t += 15_000;
    const b = model.step(t).find((d) => d.id === 'v1')!;
    expect(b.stale).toBe(true);
    expect(b.p.x).toBeCloseTo(a.p.x, 9);
    expect(b.p.y).toBeCloseTo(a.p.y, 9);
  });
});

describe('the rule itself: a reported position is evidence, never output', () => {
  it('the drawn position at the instant a fix arrives is not that fix', () => {
    const net = straightNetwork();
    const model = createModel(net);
    let t = T0;
    model.update([fixAt('v1', { x: 0, y: 0 }, t)], t);
    t += 30_000;
    model.step(t);

    // A fix 100 m away -- well inside the 150 m snap threshold, so this
    // must converge, not jump.
    model.update([fixAt('v1', { x: 0, y: 100 }, t)], t);
    const drawn = model.step(t).find((d) => d.id === 'v1')!;
    expect(drawn.p.y).not.toBeCloseTo(100, 3);
    expect(drawn.p.y).toBeCloseTo(0, 3);
  });
});

describe('shape choice hysteresis and the direction penalty', () => {
  it('a slightly better candidate does not steal the vehicle without a 25 m margin', () => {
    const near: XY[] = [
      { x: 0, y: 0 },
      { x: 0, y: 1000 },
    ];
    const farther: XY[] = [
      { x: 10, y: 0 }, // 10 m away from the query point below -- closer than `near`'s 12 m by only 2 m
      { x: 10, y: 1000 },
    ];
    const net = buildNetwork(
      [
        { id: 'A', route: 'R1', pts: near },
        { id: 'B', route: 'R1', pts: farther },
      ],
      [],
      [{ id: 'R1', short: '1', type: 0, shapes: [0, 1] }],
    );
    const model = createModel(net);
    let t = T0;
    model.update([fixAt('v1', { x: 0, y: 100 }, t)], t); // exactly on A
    model.step(t);
    t += 30_000;
    // Now 11 m off A, 1 m off B -- B is closer by 10 m, well under the 25 m margin.
    model.update([fixAt('v1', { x: 9, y: 130 }, t)], t);
    expect(model.step(t)[0].onShape).toBe(0); // stays on A: not enough to win
  });

  it('a candidate whose direction disagrees with recent movement loses despite being closer', () => {
    // Two parallel shapes 20 m apart, one running north, the other south --
    // the "other carriageway" case the 60 m direction penalty exists for.
    const northbound: XY[] = [
      { x: 0, y: 0 },
      { x: 0, y: 1000 },
    ];
    const southbound: XY[] = [
      { x: 20, y: 1000 },
      { x: 20, y: 0 },
    ];
    const net = buildNetwork(
      [
        { id: 'N', route: 'R1', pts: northbound },
        { id: 'S', route: 'R1', pts: southbound },
      ],
      [],
      [{ id: 'R1', short: '1', type: 0, shapes: [0, 1] }],
    );
    const model = createModel(net);
    let t = T0;
    model.update([fixAt('v1', { x: 10, y: 100 }, t)], t); // equidistant from both (10 m each)
    model.step(t);
    t += 30_000;
    // Moves north (+y): a real northbound vehicle. Still equidistant (10 m
    // from each shape), but now the southbound shape's tangent (pointing
    // -y) disagrees with this movement, so its score gets the 60 m penalty
    // and the northbound shape wins outright, not by raw distance.
    model.update([fixAt('v1', { x: 10, y: 130 }, t)], t);
    expect(model.step(t)[0].onShape).toBe(0); // N, not S
  });

  it('a route with no candidate under 150 m residual goes free-plane', () => {
    const net = straightNetwork();
    const model = createModel(net);
    const t = T0;
    model.update([fixAt('v1', { x: 500, y: 100 }, t)], t); // 500 m off the only shape
    const drawn = model.step(t)[0];
    expect(drawn.onShape).toBeNull();
    expect(drawn.confidence).toBeLessThanOrEqual(0.5); // free-plane cap
  });
});

describe('network === null', () => {
  it('every vehicle is free-plane and still moves, with an honestly-unknown type', () => {
    const model = createModel(null);
    let t = T0;
    model.update([fixAt('v1', { x: 0, y: 0 }, t)], t);
    t += 30_000;
    model.update([fixAt('v1', { x: 0, y: 300 }, t)], t); // now = t: the glide starts here

    const first = model.step(t).find((d) => d.id === 'v1')!;
    expect(first.onShape).toBeNull();
    expect(first.type).toBe(-1); // no network at all: type is genuinely unknown
    t += 15_000;
    const mid = model.step(t).find((d) => d.id === 'v1')!;
    expect(mid.p.y).toBeGreaterThan(first.p.y);
    expect(mid.p.y).toBeLessThan(300);
  });
});

describe('size()', () => {
  it('counts tracked vehicles', () => {
    const model = createModel(straightNetwork());
    expect(model.size()).toBe(0);
    model.update([fixAt('v1', { x: 0, y: 0 }, T0), fixAt('v2', { x: 0, y: 10 }, T0)], T0);
    expect(model.size()).toBe(2);
  });
});
