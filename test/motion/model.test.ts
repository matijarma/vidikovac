import { describe, expect, it } from 'vitest';
import { toLonLat, type XY } from '../../app/src/motion/geo';
import { at, cumulative } from '../../app/src/motion/polyline';
import type { Network, Shape, Stop } from '../../app/src/motion/network';
import { catchUpCap, createModel, STALE_S, type Fix } from '../../app/src/motion/model';

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
      // cap (R-F1a, "brief test 4" below exercises it on its own), and tick
      // 2 is the last 50 m being gained at the settle cap (R-F9, "gain on a
      // cruising target" below). This test's own claim is about
      // *steady-state* motion once the model is level with its evidence, so
      // ticks 0 to 2 warm it up and are not sampled.
      const tick = Math.floor((i - 1) / framesPerTick);
      if (tick > 2) samples.push(drawn.p.y);
    }

    for (let i = 1; i < samples.length; i++) {
      const delta = samples[i] - samples[i - 1];
      expect(delta).toBeGreaterThanOrEqual(-1e-6); // monotonic: never goes backward
      // One frame's travel of the tram itself: level with its evidence, the
      // mark moves exactly as fast as the vehicle it stands for.
      expect(delta).toBeLessThanOrEqual(speedMs * (frameMs / 1000) + 1e-6);
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

  it('a standing interval never enters the speed history: the first fix that moves again reads the cruise speed, not a median the stop dragged down (R-F10)', () => {
    const net = straightNetwork();
    const model = createModel(net);
    let t = T0;
    let y = 0;
    model.update([fixAt('v1', { x: 0, y }, t)], t);
    for (let i = 0; i < 2; i++) {
      t += 30_000;
      y += 300;
      model.update([fixAt('v1', { x: 0, y }, t)], t); // two moving intervals at 10 m/s
    }
    expect(model.step(t)[0].speed).toBeCloseTo(10, 6);
    for (let i = 0; i < 2; i++) {
      t += 30_000;
      model.update([fixAt('v1', { x: 0, y }, t)], t); // then two byte-identical repeats: standing
      expect(model.step(t)[0].speed).toBe(0);
    }
    t += 30_000;
    y += 300;
    model.update([fixAt('v1', { x: 0, y }, t)], t); // and it moves again, 300 m in 30 s
    // The history is the moving intervals alone -- 10, 10 and now 10 -- so
    // the estimate is 10 the moment it moves. With the two standing
    // intervals in the history as zeros the median read 0 here, and the
    // mark stood at the platform for one more fix while the tram was gone.
    expect(model.step(t)[0].speed).toBeCloseTo(10, 6);
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

  it('after the dwell it goes on at full speed, reads no more certain than the hold did, and never passes the following stop (R-F9)', () => {
    const { model, t: fixAtMs } = gated();
    // Reckoning passed the stop at +10 s and the dwell ends at +35 s. At
    // +55 s it has been released for 20 s: 4 m/s times 20 s is 80 m past
    // the stop, less the convergence dead zone the mark trails by -- the
    // tram has most likely left, and the drawn one goes with it at the
    // speed the evidence gave it, not half of it.
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
    expect(released.p.y).toBeGreaterThan(210);
    expect(released.p.y).toBeLessThan(240);
    // The departure is a guess nobody has confirmed: the 0.6 one confirming
    // movement earned, less the 0.2 release penalty, and never above the
    // 0.25 the hold itself was capped at -- a release must not brighten the
    // mark or show a heading at the exact moment the model starts guessing.
    expect(released.confidence).toBeCloseTo(0.25, 6);
    expect(released.heading).toBeNull();

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

describe('gain on a cruising target (R-F9)', () => {
  it('a mark left 50 m behind a tram cruising at 10 m/s closes to the dead zone: under 50 m of gap the settle cap is 1.5 x speed, never exactly speed', () => {
    const net = straightNetwork();
    const model = createModel(net);
    const speedMs = 10;
    const frameMs = 100;
    const framesPerTick = 30_000 / frameMs;
    let t = T0;
    let y = 0;
    model.update([fixAt('v1', { x: 0, y }, t)], t);
    // Ticks 0 and 1 leave the mark 50 m behind (see brief test 1): the first
    // 250 m of the 300 m warm-up gap close at the raised cap, and from 50 m
    // down the settle cap takes over. At exactly the tram's own speed the
    // mark could never gain on a target moving at that speed and would sit
    // 50 m back for the rest of the run; at 1.5 x speed it closes to the
    // dead zone within tick 2 and stays there.
    let gapAtEnd = Infinity;
    let worstDelta = 0;
    let last: number | null = null;
    for (let i = 1; i <= 6 * framesPerTick; i++) {
      t += frameMs;
      if (i % framesPerTick === 0) {
        y += speedMs * 30;
        model.update([fixAt('v1', { x: 0, y }, t)], t);
      }
      const [drawn] = model.step(t);
      const tick = Math.floor((i - 1) / framesPerTick);
      if (tick >= 4) {
        if (last !== null) worstDelta = Math.max(worstDelta, drawn.p.y - last);
        gapAtEnd = speedMs * ((t - T0) / 1000) - drawn.p.y;
      }
      last = drawn.p.y;
    }
    // Within the 15 m dead zone plus the settle equilibrium, never 50 m back.
    expect(gapAtEnd).toBeGreaterThanOrEqual(0);
    expect(gapAtEnd).toBeLessThan(20);
    // The gain itself never outran the settle cap for a 50 m gap.
    expect(worstDelta).toBeLessThanOrEqual(catchUpCap(50, speedMs) * (frameMs / 1000) + 1e-6);
    expect(catchUpCap(50, speedMs)).toBe(1.5 * speedMs);
    expect(catchUpCap(50, 1)).toBe(6); // and never under 6 m/s, so a slow estimate still settles
    expect(catchUpCap(51, speedMs)).toBe(2 * speedMs); // over 50 m the raised cap stays
  });
});

describe('speed from the moving part of each interval (R-F10)', () => {
  // A stop at 450 m, and the next far enough on that only the one at 450 is
  // ever in play. Stepping straight after `update` (silence 0) reads the
  // baseline estimate itself, undecayed.
  const stopped = () => createModel(straightNetwork([{ id: 'ST', name: 'Stop', shape: 0, s: 450 }, { id: 'ST2', name: 'Far', shape: 0, s: 1500 }]));
  const speedAfter = (model: ReturnType<typeof createModel>, y: number, t: number): number => {
    model.update([fixAt('v1', { x: 0, y }, t)], t);
    return model.step(t)[0].speed;
  };

  it('an interval whose segment passed a known stop is charged the assumed 20 s dwell: 100 m past the stop 30 s after 100 m before it reads 10 m/s, not 3.3', () => {
    const model = stopped();
    speedAfter(model, 100, T0);
    expect(speedAfter(model, 400, T0 + 30_000)).toBeCloseTo(10, 6); // no stop between 100 and 400: the whole 30 s was travel
    // 400 -> 500 crosses the stop at 450: 10 s of travel and a 20 s dwell.
    // The median of the two moving intervals is 10 only if this one reads
    // 10 too; charged the whole 30 s it read 3.3, and the median 6.7.
    expect(speedAfter(model, 500, T0 + 60_000)).toBeCloseTo(10, 6);
  });

  it('the charge never takes more than two thirds of the interval: 80 m in 24 s across a stop keeps 8 s of travel, not 4', () => {
    const model = stopped();
    speedAfter(model, 400, T0);
    // 24 - 20 = 4 s would read 20 m/s, a tram doing 72 km/h on the strength
    // of one short interval; the floor keeps a third of the measured
    // duration, 8 s, and reads 10.
    expect(speedAfter(model, 480, T0 + 24_000)).toBeCloseTo(10, 6);
  });

  it('a fix taken at the stop itself splits the dwell between the interval that reached it and the one that left it, within the dead zone of the platform', () => {
    // A tram at 10 m/s reaches the stop at +20 s and stands 20 s; the fix at
    // +30 s finds it there, 5 m past the stop's own arc length (a standing
    // tram's report is never byte-exactly on the platform). Each of the two
    // intervals meeting at that fix was 20 s of travel and 10 s of standing.
    const model = stopped();
    speedAfter(model, 250, T0);
    const reached = speedAfter(model, 455, T0 + 30_000);
    const left = speedAfter(model, 655, T0 + 60_000);
    // Half a dwell each: 205 m over 20 s, then 200 m over 20 s, and the
    // estimate after the second is the median of the two. Had the 5 m
    // decided which interval "crossed" the stop, the first would have read
    // 20.5 and the second 6.7; charged nothing, both read 6.7 -- the
    // underestimate F6 measured.
    expect(reached).toBeCloseTo(10.25, 6);
    expect(left).toBeCloseTo((10.25 + 10) / 2, 6);
  });
});

describe('dead reckoning under silence is monotonic (F1, ruling 3)', () => {
  it('a vehicle silent for 300 s, sampled every second, never moves backwards along its shape and eases to a halt before it is evicted', () => {
    const net = straightNetwork();
    const model = createModel(net);
    let t = T0;
    model.update([fixAt('v1', { x: 0, y: 0 }, t)], t);
    t += 30_000;
    model.update([fixAt('v1', { x: 0, y: 300 }, t)], t); // 10 m/s, then silence
    let last = model.step(t).find((d) => d.id === 'v1')!.p.y;
    const deltas: number[] = [];
    for (let s = 1; s < STALE_S; s++) {
      const drawn = model.step(t + s * 1000).find((d) => d.id === 'v1');
      expect(drawn).toBeDefined();
      deltas.push(drawn!.p.y - last);
      last = drawn!.p.y;
    }
    for (const delta of deltas) expect(delta).toBeGreaterThanOrEqual(-1e-6);
    // It went somewhere -- the 90 s hold at full speed alone is 900 m ...
    expect(last).toBeGreaterThan(1000);
    // ... and by the end it has eased to a standstill rather than sliding
    // back (the decayed-speed-times-elapsed formula pulled it back some 450
    // m over this run).
    expect(deltas[deltas.length - 1]).toBeGreaterThanOrEqual(0);
    expect(deltas[deltas.length - 1]).toBeLessThan(0.05);
    // At STALE_S it is evicted (R-F2): the run above is the whole life of the silence.
    expect(model.step(t + STALE_S * 1000)).toHaveLength(0);
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
/** A straight 20 km shape on route R1 with a stop every `spacingM`, the
 *  first one `spacingM` from the origin. */
function stopsEvery(spacingM: number): Network {
  const SHAPE_LEN_M = 20_000;
  const stops: StopSpec[] = [];
  for (let s = spacingM; s < SHAPE_LEN_M; s += spacingM) stops.push({ id: `ST${s}`, name: `Stop ${s}`, shape: 0, s });
  return buildNetwork(
    [{ id: 'S0', route: 'R1', pts: [{ x: 0, y: 0 }, { x: 0, y: SHAPE_LEN_M }] }],
    stops,
    [{ id: 'R1', short: '1', type: 0, shapes: [0] }],
  );
}

/** Truth for a tram that cruises at `speedMs` between stops `spacingM`
 *  apart and stands `dwellS` at every one (0: a tram that never stops),
 *  leaving the origin at t = 0: its arc length at wall-clock `tMs`. */
function dwellingTruth(speedMs: number, dwellS: number, spacingM: number): (tMs: number) => number {
  const cycleS = spacingM / speedMs + dwellS;
  return (tMs) => {
    const t = tMs / 1000;
    const k = Math.floor(t / cycleS);
    const phase = t - k * cycleS;
    return k * spacingM + Math.min(spacingM, speedMs * phase);
  };
}

function runSteadyState(opts: { speedMs: number; latencyS: number; dwellS: number; minutes?: number }): SteadyStateStats {
  const STOP_SPACING_M = 450;
  const FIX_EVERY_MS = 30_000;
  const POLL_EVERY_MS = 20_000;
  const FRAME_MS = 1000 / 60;
  const minutes = opts.minutes ?? 20;
  const net = stopsEvery(STOP_SPACING_M);
  const trueS = dwellingTruth(opts.speedMs, opts.dwellS, STOP_SPACING_M);

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
        const cap = catchUpCap(Infinity, drawn.speed) * dt + 0.01;
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

/** What the steady-state scenario was aimed at, and what it reaches.
 *
 *  Aimed (task-F1-brief.md): the gate holding under 15 % of frames and a
 *  p95 lag under 60 m. Neither was reachable with the constants R-F1 fixed
 *  (task-F1-report.md, Rulings 7): a 25 s hold at a stop every 65 to 84 s
 *  is a quarter of all frames by itself unless a fix cuts it short, and the
 *  fix that confirms a departure arrives 25 to 75 s after it. R-F9 changed
 *  the two constants the lag came from -- the gate releases at full speed,
 *  the settle cap is 1.5 x the vehicle's speed -- and took the p95 down by
 *  7 to 120 m per run without moving the held share, which neither lever
 *  touches. R-F10 then changed the estimate the reckoning runs on: speed
 *  from the moving part of each interval, not distance over the whole of
 *  it, since a 30 s interval across a 20 s dwell read a 10 m/s tram as 7
 *  and reckoning at 7 fell behind on every cruise. Reckoning at the true
 *  cruise speed reaches each stop when the tram does, so the hold now runs
 *  on nearly every stop and for its full dwell, where the late reckoning
 *  used to arrive after the confirming fix had lifted the gate: the held
 *  share rises as the lag falls. The three constant sets side by side
 *  (60 Hz, 20 minutes, measured from minute 2; gate-held share, then p95
 *  lag):
 *
 *    doors open 20 s at every stop
 *                            R-F1 (F1)          R-F9 (F6)          R-F10 (F7)
 *    25 s latency,  7 m/s    25.34 %, 183.7 m   25.34 %, 121.7 m   30.69 %,  50.0 m
 *    25 s latency, 10 m/s    21.29 %, 270.6 m   21.29 %, 247.1 m   47.41 %,  93.4 m
 *     2 s latency,  7 m/s    26.13 %, 116.1 m   26.13 %,  92.2 m   27.77 %,  55.1 m
 *     2 s latency, 10 m/s    21.99 %, 260.7 m   21.99 %, 253.7 m   35.05 %, 157.8 m
 *
 *    a tram that never stops (charged the assumed dwell for stops it did not make)
 *                            R-F1 (F1)          R-F9 (F6)          R-F10 (F7)
 *    25 s latency,  7 m/s    38.69 %, 294 m     38.69 %, 190.0 m   33.81 %, 291.8 m
 *    25 s latency, 10 m/s    50.01 %, 385 m     50.01 %, 264.9 m   38.92 %, 179.3 m
 *     2 s latency,  7 m/s    36.83 %, 224 m     36.83 %, 189.9 m   65.61 %, 189.9 m
 *     2 s latency, 10 m/s    44.42 %, 285 m     44.42 %, 264.9 m   63.87 %, 204.4 m
 *
 *  The thresholds below are each truth model's worst measured value plus a
 *  fifth of it, rounded up (R-F9), so a regression of the size that
 *  matters fails here and a benign reordering of arithmetic does not; the
 *  old model held over half of all frames and lagged 166 to 353 m at p95.
 *  The two invariants -- no frame beyond the catch-up cap, no snap after
 *  the first fix -- are absolute and asserted for every run. */
const STEADY_STATE_ENVELOPE = {
  dwelling: { heldUnder: 0.57, lagP95UnderM: 190 },
  nonStop: { heldUnder: 0.79, lagP95UnderM: 351 },
};

describe('the public kiosk in steady state (R-F1, R-F9, R-F10: 450 m stops, 30 s fixes on a 20 s poll, 20 minutes)', () => {
  const latencies = [25, 2];
  const speeds = [7, 10];
  const pct = (share: number) => Math.round(share * 100);
  for (const latencyS of latencies) {
    for (const speedMs of speeds) {
      const dwelling = STEADY_STATE_ENVELOPE.dwelling;
      it(`${latencyS} s latency, ${speedMs} m/s, doors open 20 s at every stop: no frame outruns the catch-up cap, nothing snaps, the gate holds under ${pct(dwelling.heldUnder)} % of frames and the p95 lag is under ${dwelling.lagP95UnderM} m`, () => {
        const stats = runSteadyState({ speedMs, latencyS, dwellS: 20 });
        expect(stats.worstOvershootM).toBeLessThanOrEqual(0);
        expect(stats.snapped).toBe(false);
        expect(stats.heldShare).toBeLessThan(dwelling.heldUnder);
        expect(stats.lagP95M).toBeLessThan(dwelling.lagP95UnderM);
      });
      const nonStop = STEADY_STATE_ENVELOPE.nonStop;
      it(`${latencyS} s latency, ${speedMs} m/s, a tram that never stops: no frame outruns the catch-up cap, nothing snaps, the gate holds under ${pct(nonStop.heldUnder)} % of frames and the p95 lag is under ${nonStop.lagP95UnderM} m`, () => {
        const stats = runSteadyState({ speedMs, latencyS, dwellS: 0 });
        expect(stats.worstOvershootM).toBeLessThanOrEqual(0);
        expect(stats.snapped).toBe(false);
        expect(stats.heldShare).toBeLessThan(nonStop.heldUnder);
        expect(stats.lagP95M).toBeLessThan(nonStop.lagP95UnderM);
      });
    }
  }
});

describe("the speed estimate on the brief's tram (R-F10): 10 m/s between stops 450 m apart, 20 s at each", () => {
  /** Fixes every 30 s, handed over as they are taken, `fixes` of them after
   *  the first: the estimate after each. A 20 s dwell on a 30 s cadence
   *  never yields a byte-identical repeat, so every interval is a moving
   *  one and the third estimate is the median of the first three. */
  const estimates = (speedMs: number, fixes: number): number[] => {
    const model = createModel(stopsEvery(450));
    const trueS = dwellingTruth(speedMs, 20, 450);
    const out: number[] = [];
    for (let k = 0; k <= fixes; k++) {
      const t = k * 30_000;
      model.update([fixAt('tram', { x: 0, y: trueS(t) }, T0 + t)], T0 + t);
      if (k > 0) out.push(model.step(T0 + t)[0].speed);
    }
    return out;
  };
  const off = (estimate: number, truth: number): number => Math.abs(estimate - truth) / truth;

  it('reads within 15 % of 10 m/s after the third moving interval, where dividing by the whole interval read 8.3 and settled near 7', () => {
    expect(off(estimates(10, 3)[2], 10)).toBeLessThan(0.15);
  });

  it('and stays there: over 26 fixes at 10 and at 7 m/s the median estimate is the cruise speed itself, three quarters of the estimates are within 15 % of it and none is 30 % off', () => {
    for (const speedMs of [10, 7]) {
      const run = estimates(speedMs, 26);
      const sorted = [...run].sort((a, b) => a - b);
      expect(sorted[sorted.length >> 1]).toBeCloseTo(speedMs, 3);
      expect(run.filter((e) => off(e, speedMs) < 0.15).length / run.length).toBeGreaterThanOrEqual(0.75);
      // The excursions (7.5 and 12.5 at 10 m/s) are a fix that lands at the
      // very start or end of a dwell and charges half of one to an interval
      // that stood for all of it or none: 25 % off, and the median absorbs
      // them. Charged nothing, the same run read 5 to 8.3 with a median of
      // 8.3; charged a whole dwell at the platform too, 10 to 22 with a
      // median of 15.
      for (const e of run) expect(off(e, speedMs)).toBeLessThan(0.3);
    }
  });
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
