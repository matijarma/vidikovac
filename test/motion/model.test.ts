import { describe, expect, it } from 'vitest';
import { toLonLat, type XY } from '../../app/src/motion/geo';
import { at, cumulative } from '../../app/src/motion/polyline';
import type { Network, Shape, Stop } from '../../app/src/motion/network';
import { catchUpCap, createModel, type Fix } from '../../app/src/motion/model';

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
      // second fix exists), so the second fix lands 300 m ahead of a mark
      // that has not moved; tick 1 is that gap being caught up at the raised
      // cap (R-F1a, "brief test 4" below exercises it on its own). This
      // test's own claim is about *steady-state* motion once the model is
      // level with its evidence, so ticks 0 and 1 warm it up and are not
      // sampled.
      const tick = Math.floor((i - 1) / framesPerTick);
      if (tick > 1) samples.push(drawn.p.y);
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
  it('does not teleport anything: a report older than the last one is no new evidence', () => {
    const net = straightNetwork();
    const model = createModel(net);
    let t = T0;
    model.update([fixAt('v1', { x: 0, y: 0 }, t)], t);
    t += 30_000;
    model.update([fixAt('v1', { x: 0, y: 100 }, t)], t);
    t += 5_000;
    const before = model.step(t).find((d) => d.id === 'v1')!.p.y;

    // A poll now carries a fix whose own timestamp is 20 minutes older than
    // the evidence already folded in (the probe's "a few fixes are up to 20
    // minutes stale"), reported far away. It is out of order, so it is not
    // evidence at all: the drawn position does not move because of it.
    model.update([fixAt('v1', { x: 0, y: 900 }, t - 20 * 60_000)], t);
    const after = model.step(t).find((d) => d.id === 'v1')!;
    expect(after.p.y).toBeCloseTo(before, 6);
    expect(after.p.y).not.toBeCloseTo(900, 3);
  });

  it('a vehicle whose every report is 20 minutes stale on arrival is not drawn at all (R-F2: evicted, not carried)', () => {
    const model = createModel(straightNetwork());
    // The fix's own `at` is 20 minutes behind the wall clock it arrives on.
    model.update([fixAt('v1', { x: 0, y: 0 }, T0 - 20 * 60_000)], T0);
    expect(model.step(T0)).toHaveLength(0);
    expect(model.size()).toBe(0);
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

describe('a 200 m along-track discrepancy (brief test 4, R-F1a)', () => {
  it('catches up at the raised cap and never jumps: being behind on the same shape is lag, not error', () => {
    const net = straightNetwork();
    const model = createModel(net);
    let t = T0;
    model.update([fixAt('v1', { x: 0, y: 0 }, t)], t);
    t += 1000;
    model.step(t);

    // A fix 200 m ahead of the still-converged drawn position, 1.1 s after
    // the first: the interval reads as 22 m/s (the MAX_SPEED_MS clamp), so
    // the raised cap is 44 m/s. The old model teleported here; this one
    // closes the gap in bounded steps.
    t += 100;
    model.update([fixAt('v1', { x: 0, y: 200 }, t)], t);

    const first = model.step(t).find((d) => d.id === 'v1')!;
    // 100 ms since the last frame: at most 4.4 m of movement, nowhere near the fix.
    expect(first.p.y).toBeLessThanOrEqual(44 * 0.1 + 1e-6);
    expect(first.p.y).not.toBeCloseTo(200, 3);
    expect(first.lastSnapAt).toBeUndefined();

    let last = first.p.y;
    let arrivedAt: number | null = null;
    for (let f = 0; f < 60; f++) {
      t += 500;
      const drawn = model.step(t).find((d) => d.id === 'v1')!;
      const delta = drawn.p.y - last;
      expect(delta).toBeGreaterThanOrEqual(0);
      expect(delta).toBeLessThanOrEqual(catchUpCap(Infinity, drawn.speed) * 0.5 + 1e-6);
      expect(drawn.lastSnapAt).toBeUndefined();
      last = drawn.p.y;
      // The target itself dead-reckons on at 22 m/s, so "arrived" is being
      // within the dead zone of where the fix says the tram now is.
      const target = 200 + 22 * ((t - (T0 + 1100)) / 1000);
      if (arrivedAt === null && target - drawn.p.y < 50) arrivedAt = t;
    }
    // About one poll interval to close the gap, the brief's own yardstick.
    expect(arrivedAt).not.toBeNull();
    expect((arrivedAt! - (T0 + 1100)) / 1000).toBeLessThanOrEqual(20);
  });
});

describe('the stop gate (brief test 5, R-F1b)', () => {
  // Stop sits 40 m ahead of the last confirmed fix (s = 120 + 40); the one
  // after it 140 m on -- close enough for the released, decaying reckoning
  // (it eases to a halt within about 155 s' worth of travel) to reach.
  const gated = () => {
    const net = straightNetwork([
      { id: 'ST', name: 'Stop', shape: 0, s: 160 },
      { id: 'ST2', name: 'Following', shape: 0, s: 300 },
    ]);
    const model = createModel(net);
    let t = T0;
    // Two fixes 30 s apart, 120 m apart -- a 4 m/s baseline, so dead
    // reckoning alone would want to carry it 120 m past this fix (to 240),
    // well past the stop at 160.
    model.update([fixAt('v1', { x: 0, y: 0 }, t)], t);
    t += 30_000;
    model.update([fixAt('v1', { x: 0, y: 120 }, t)], t);
    model.step(t);
    return { model, t };
  };
  const at = (model: ReturnType<typeof createModel>, t: number) => model.step(t).find((d) => d.id === 'v1')!;

  it('a vehicle whose next stop is 40 m ahead and whose speed says 120 m stops at the stop, and stays for one dwell', () => {
    const { model, t: fixAtMs } = gated();
    let t = fixAtMs;
    // Reckoning reaches the stop 10 s after the fix (40 m at 4 m/s); for the
    // GATE_DWELL_S = 25 s after that the mark is held there, facing unknown.
    // (Sampled to +34 s: the release at exactly +35 s is a floating-point
    // knife edge, and the second test below covers what follows.)
    let lastY = 0;
    for (let f = 0; f < 68; f++) {
      t += 500;
      const drawn = at(model, t);
      expect(drawn.p.y).toBeLessThanOrEqual(160 + 1e-6);
      if (t - fixAtMs > 10_000) {
        expect(drawn.held).toBe(true);
        expect(drawn.confidence).toBeLessThan(0.3);
        expect(drawn.heading).toBeNull();
      }
      lastY = drawn.p.y;
    }
    expect(lastY).toBeGreaterThan(140); // it did get close to the stop, not stuck at 120
  });

  it('after the dwell it goes on at half speed with confidence lowered, and never past the following stop', () => {
    const { model, t: fixAtMs } = gated();
    // Reckoning passed the stop at +10 s and the dwell ends at +35 s. At
    // +55 s it has been released for 20 s: 2 m/s (half of 4) times 20 s is
    // 40 m past the stop, give or take the convergence dead zone -- clearly
    // moving, clearly not at full speed (80 m).
    const settle = at(model, fixAtMs + 34_000);
    expect(settle.held).toBe(true);
    let t = fixAtMs + 35_000;
    let last = settle.p.y;
    for (let f = 0; f < 40; f++) {
      t += 500;
      const drawn = at(model, t);
      expect(drawn.p.y).toBeGreaterThanOrEqual(last - 1e-6); // forward only
      last = drawn.p.y;
    }
    const released = at(model, t);
    expect(released.held).toBeUndefined();
    expect(released.p.y).toBeGreaterThan(170);
    expect(released.p.y).toBeLessThan(200);
    // Evidence for the departure is a guess: the 0.6 one confirming
    // movement earned, less the 0.2 release penalty.
    expect(released.confidence).toBeCloseTo(0.4, 2);

    // Nobody has confirmed it past the following stop either: the released
    // reckoning ends there, held again (sampled to +255 s, inside the five
    // minutes after which the vehicle is evicted, R-F2).
    for (let f = 0; f < 400; f++) {
      t += 500;
      const drawn = at(model, t);
      expect(drawn.p.y).toBeLessThanOrEqual(300 + 1e-6);
    }
    expect(at(model, t).held).toBe(true);
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

describe('silence for 310 s (brief test 8, R-F2)', () => {
  it('is gone: evicted from the model, not drawn frozen', () => {
    const net = straightNetwork();
    const model = createModel(net);
    let t = T0;
    model.update([fixAt('v1', { x: 0, y: 0 }, t)], t);
    t += 30_000;
    model.update([fixAt('v1', { x: 0, y: 100 }, t)], t);
    model.step(t);

    // Under the 90 s hold and through the decay it is still drawn, slowing
    // down; past five minutes it is not a vehicle any more.
    t += 200_000;
    const fading = model.step(t).find((d) => d.id === 'v1')!;
    expect(fading).toBeDefined();
    expect(fading.speed).toBeLessThan(100 / 30);
    expect(fading.stale).toBe(false);

    t += 110_000;
    expect(model.step(t)).toHaveLength(0);
    expect(model.size()).toBe(0);
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

  it('when the current shape itself drifts past the residual gate, a valid sibling under the gate is picked instead of free-plane', () => {
    // Two parallel north-running shapes on route R1: A directly under the
    // vehicle's first fix, B 15 m east of it. The second fix lands 155 m
    // off A (just past the 150 m gate) and 140 m off B (well inside it) --
    // but only 15 m closer than A, short of the 25 m hysteresis margin.
    // Hysteresis is meant to defend a *valid* current shape from a
    // narrowly-better rival, not to keep a vehicle glued to a shape whose
    // own residual has already drifted past the gate: A's score no longer
    // qualifies as a baseline to defend, so the vehicle must fall through
    // to B (a genuinely valid candidate) rather than being bumped to
    // lower-confidence free-plane with a valid track sitting right there.
    const A: XY[] = [
      { x: 0, y: 0 },
      { x: 0, y: 2000 },
    ];
    const B: XY[] = [
      { x: 15, y: 0 },
      { x: 15, y: 2000 },
    ];
    const net = buildNetwork(
      [
        { id: 'A', route: 'R1', pts: A },
        { id: 'B', route: 'R1', pts: B },
      ],
      [],
      [{ id: 'R1', short: '1', type: 0, shapes: [0, 1] }],
    );
    const model = createModel(net);
    let t = T0;
    model.update([fixAt('v1', { x: 0, y: 100 }, t)], t); // exactly on A, 15 m off B: A wins outright
    model.step(t);
    t += 30_000;
    // 155 m off A (past the gate), 140 m off B (inside it, but only 15 m
    // closer than A -- short of the 25 m margin). Both shapes run north,
    // same as this movement, so neither takes the direction penalty.
    model.update([fixAt('v1', { x: 155, y: 130 }, t)], t);
    expect(model.step(t)[0].onShape).toBe(1); // B, not free-plane
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

describe('the wire route type (R-P1)', () => {
  it('falls back to the fix type when there is no network, and to -1 when the fix has none either', () => {
    const model = createModel(null);
    model.update([fixAt('tram', { x: 0, y: 0 }, T0, { type: 0 }), fixAt('bus', { x: 50, y: 0 }, T0, { type: 3 }), fixAt('none', { x: 100, y: 0 }, T0)], T0);
    const drawn = new Map(model.step(T0).map((d) => [d.id, d]));
    expect(drawn.get('tram')!.type).toBe(0);
    expect(drawn.get('bus')!.type).toBe(3);
    expect(drawn.get('none')!.type).toBe(-1);
  });
  it('lets the network artefact win when it knows the route', () => {
    const model = createModel(straightNetwork()); // R1 is type 0 there
    model.update([fixAt('v1', { x: 0, y: 0 }, T0, { type: 3 })], T0);
    expect(model.step(T0)[0].type).toBe(0);
  });
  it('is re-read on a route change, exactly like the network answer', () => {
    const model = createModel(null);
    model.update([fixAt('v1', { x: 0, y: 0 }, T0, { routeId: 'RA', type: 0 })], T0);
    model.update([fixAt('v1', { x: 0, y: 100 }, T0 + 30_000, { routeId: 'RB', type: 3 })], T0 + 30_000);
    expect(model.step(T0 + 30_000)[0].type).toBe(3);
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

// ---------------------------------------------------------------------------
// R-F1: the public kiosk in steady state -- the reviewer's reproduction, as a
// named scenario. A tram runs a straight line with a stop every 450 m; the
// feed samples it every 30 s; the kiosk polls every 20 s and each fix reaches
// the model only after the feed's own latency. The old model held the tram at
// the gate while the real one carried on, then teleported it onto the next
// fix (210 to 465 m in one frame, about once a minute). Being behind along
// the same shape is the model lagging, never the model being wrong, so it
// must catch up and never snap.
// ---------------------------------------------------------------------------

interface SteadyStateStats {
  /** The largest single-frame move beyond that frame's own catch-up cap. */
  worstOvershootM: number;
  /** Whether any drawn frame carried a snap timestamp after the first fix. */
  snapped: boolean;
  /** Share of frames the stop gate held the tram, in [0, 1]. */
  heldShare: number;
  /** 95th percentile of |true position - drawn position|, in metres. */
  lagP95M: number;
}

/**
 * Truth: cruise at `speedMs` between stops 450 m apart, standing `dwellS`
 * at every stop (a real tram opens its doors; 0 is the harshest case for the
 * gate, a tram that never stops). Fixes are the exact true position at 30 s
 * ticks; a poll every 20 s hands the model the newest fix that is at least
 * `latencyS` old. Frames run at 60 Hz for `minutes`. Measurement starts two
 * minutes in, once the model has fix-to-fix evidence to reckon with.
 */
function runSteadyState(opts: { speedMs: number; latencyS: number; dwellS: number; minutes?: number }): SteadyStateStats {
  const STOP_SPACING_M = 450;
  const SHAPE_LEN_M = 20_000;
  const FIX_EVERY_MS = 30_000;
  const POLL_EVERY_MS = 20_000;
  const FRAME_MS = 1000 / 60;
  const minutes = opts.minutes ?? 20;
  const stops: StopSpec[] = [];
  for (let s = STOP_SPACING_M; s < SHAPE_LEN_M; s += STOP_SPACING_M) stops.push({ id: `ST${s}`, name: `Stop ${s}`, shape: 0, s });
  const net = buildNetwork(
    [{ id: 'S0', route: 'R1', pts: [{ x: 0, y: 0 }, { x: 0, y: SHAPE_LEN_M }] }],
    stops,
    [{ id: 'R1', short: '1', type: 0, shapes: [0] }],
  );
  const cruiseS = STOP_SPACING_M / opts.speedMs;
  const cycleS = cruiseS + opts.dwellS;
  const trueS = (tMs: number): number => {
    const t = tMs / 1000;
    const k = Math.floor(t / cycleS);
    const phase = t - k * cycleS;
    return k * STOP_SPACING_M + Math.min(STOP_SPACING_M, opts.speedMs * phase);
  };

  const model = createModel(net);
  const totalMs = minutes * 60_000;
  const measureFromMs = 2 * 60_000;
  let deliveredUpTo = -1; // index of the newest fix handed to the model
  let framesMeasured = 0;
  let heldFrames = 0;
  let worstOvershootM = 0;
  let snapped = false;
  const lags: number[] = [];
  let prev: { y: number; t: number } | null = null;

  for (let frame = 0; frame * FRAME_MS <= totalMs; frame++) {
    const t = frame * FRAME_MS;
    const now = T0 + t;
    // A poll lands every 20 s and carries the newest fix old enough to have
    // arrived: the same "latest VehiclePosition per vehicle" the feed sends.
    if (frame > 0 && Math.floor(t / POLL_EVERY_MS) > Math.floor((t - FRAME_MS) / POLL_EVERY_MS)) {
      const newest = Math.floor((t - opts.latencyS * 1000) / FIX_EVERY_MS);
      if (newest > deliveredUpTo) {
        deliveredUpTo = newest;
        const fixT = newest * FIX_EVERY_MS;
        model.update([fixAt('tram', { x: 0, y: trueS(fixT) }, T0 + fixT)], now);
      }
    }
    const drawn = model.step(now).find((d) => d.id === 'tram');
    if (!drawn) continue;
    if (t >= measureFromMs) {
      framesMeasured++;
      if (drawn.held) heldFrames++;
      if (drawn.lastSnapAt !== undefined) snapped = true;
      lags.push(Math.abs(trueS(t) - drawn.p.y));
      if (prev) {
        const dt = (t - prev.t) / 1000;
        const cap = Math.max(2 * drawn.speed, 8) * dt + 0.01;
        worstOvershootM = Math.max(worstOvershootM, Math.abs(drawn.p.y - prev.y) - cap);
      }
    }
    prev = { y: drawn.p.y, t };
  }
  lags.sort((a, b) => a - b);
  return {
    worstOvershootM,
    snapped,
    heldShare: framesMeasured ? heldFrames / framesMeasured : 0,
    lagP95M: lags[Math.min(lags.length - 1, Math.floor(lags.length * 0.95))] ?? 0,
  };
}

/** The acceptance envelope for the dwelling tram, per latency/speed run
 *  (task-F1-report.md, Rulings 7, amending the brief's 15 % and 60 m, which
 *  the constants R-F1 fixes cannot deliver: a 25 s hold at a stop every 65
 *  to 84 s is 30 to 38 % of frames by itself unless a fix cuts it short,
 *  and the fix that confirms a departure arrives 25 to 75 s after it, with
 *  the release at half speed until then -- a sweep of the release factor up
 *  to 1.0 and the sub-50 m cap up to twice the speed left the held share
 *  unchanged and the p95 lag at 92 to 254 m at best). Each bound sits about
 *  one percentage point and five to ten metres above the measured value,
 *  so a regression of the size that matters fails here (the old model held
 *  over half of all frames and lagged 166 to 353 m at p95) and a benign
 *  reordering of arithmetic does not. */
const DWELLING_TRAM_ENVELOPE: Record<string, { heldUnder: number; lagP95UnderM: number }> = {
  '25/7': { heldUnder: 0.26, lagP95UnderM: 190 }, // measured 25.34 %, 183.7 m
  '25/10': { heldUnder: 0.22, lagP95UnderM: 280 }, // measured 21.29 %, 270.6 m
  '2/7': { heldUnder: 0.27, lagP95UnderM: 125 }, // measured 26.13 %, 116.1 m
  '2/10': { heldUnder: 0.23, lagP95UnderM: 270 }, // measured 21.99 %, 260.7 m
};

describe('the public kiosk in steady state (R-F1: 450 m stops, 30 s fixes on a 20 s poll, 20 minutes)', () => {
  const latencies = [25, 2];
  const speeds = [7, 10];
  for (const latencyS of latencies) {
    for (const speedMs of speeds) {
      const envelope = DWELLING_TRAM_ENVELOPE[`${latencyS}/${speedMs}`]!;
      it(`${latencyS} s latency, ${speedMs} m/s, doors open 20 s at every stop: no frame outruns the catch-up cap, nothing snaps, the gate holds under ${Math.round(envelope.heldUnder * 100)} % of frames and the p95 lag is under ${envelope.lagP95UnderM} m`, () => {
        const stats = runSteadyState({ speedMs, latencyS, dwellS: 20 });
        expect(stats.worstOvershootM).toBeLessThanOrEqual(0);
        expect(stats.snapped).toBe(false);
        expect(stats.heldShare).toBeLessThan(envelope.heldUnder);
        expect(stats.lagP95M).toBeLessThan(envelope.lagP95UnderM);
      });
      it(`${latencyS} s latency, ${speedMs} m/s, a tram that never stops: still no frame outruns the catch-up cap and nothing snaps`, () => {
        const stats = runSteadyState({ speedMs, latencyS, dwellS: 0 });
        expect(stats.worstOvershootM).toBeLessThanOrEqual(0);
        expect(stats.snapped).toBe(false);
      });
    }
  }
});

describe('eviction (R-F2)', () => {
  it('a vehicle absent from the fixes for STALE_S + 1 seconds is gone from size(), not merely flagged', () => {
    const model = createModel(straightNetwork());
    model.update([fixAt('v1', { x: 0, y: 0 }, T0), fixAt('v2', { x: 0, y: 10 }, T0)], T0);
    expect(model.size()).toBe(2);
    const later = T0 + 301_000;
    model.update([fixAt('v1', { x: 0, y: 100 }, later)], later);
    expect(model.size()).toBe(1);
    expect(model.step(later).map((d) => d.id)).toEqual(['v1']);
  });

  it('a vehicle nobody has polled for goes at the same age on step(), so a paused feed does not keep ghosts', () => {
    const model = createModel(straightNetwork());
    model.update([fixAt('v1', { x: 0, y: 0 }, T0)], T0);
    expect(model.step(T0 + 299_000)).toHaveLength(1);
    expect(model.step(T0 + 301_000)).toHaveLength(0);
    expect(model.size()).toBe(0);
  });
});
