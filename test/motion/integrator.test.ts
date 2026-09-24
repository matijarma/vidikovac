import { describe, expect, it } from 'vitest';
import { toLonLat, toPlane } from '../../shared/motion/geo';
import { HEADWAY_M, enforceOrder } from '../../shared/motion/order';
import { createMatcher } from '../../shared/motion/match';
import { buildPlan, evalPathPlan } from '../../shared/motion/plan';
import { estimateSpeed } from '../../shared/motion/speed';
import type { TimesProvider } from '../../shared/motion/times';
import { lastFix, newTrack, type Track } from '../../shared/motion/track';
import { createIntegrator, type Drawn, type Fix } from '../../app/src/motion/integrator';
import { simulate } from './simulator';
import { corridorSpec, straight, syntheticNetwork, type SynthSpec } from './synthetic-network';
import { createLoop } from '../../app/src/motion/loop';

describe('stale polls through the real planner and frame loop', () => {
  function planned(generationDelay = 0) {
    const net = syntheticNetwork(corridorSpec());
    const matcher = createMatcher(net);
    const track = newTrack('stale', '1', 't1', 'tram');
    const t = 1_800_000_000;
    for (const [x, atSec] of [[400, t - 10], [500, t]]) {
      const [lon, lat] = toLonLat({ x, y: 0 });
      matcher.matchFix(track, { x, y: 0, lon, lat, atSec }, matcher.priorFor('1_0', '1', 0), null);
    }
    track.speed = 10;
    buildPlan(track, net, { segmentSeconds: (_p, a, b) => (b - a) / 10, dwellSeconds: () => 20 },
      null, t + generationDelay, t, { hourBand: 12, dayType: 0 });
    const plan = track.plan!;
    if (plan.on !== 'path') throw new Error('expected a real path plan');
    expect(track.next?.s).toBe(600);
    expect(evalPathPlan(plan.knots, 60)).toBeGreaterThan(600);
    const [lon, lat] = toLonLat(net.toPathPoint(plan.pathIdx, 500));
    const fix: Fix & { generatedAt: number } = {
      id: track.id, lon, lat, at: t * 1000, generatedAt: (t + generationDelay) * 1000,
      routeId: '1', type: 0, path: '1_0', speed: track.speed, confidence: track.confidence,
      nextStopId: track.next!.stopId,
      plan: { on: 'path', knots: plan.knots.map(([s, arc]) => [t * 1000 + s * 1000, arc]) },
    };
    return { net, fix, now: t * 1000 };
  }

  it.each([false, true])('does not renew hold, confidence or eviction on 12 s stale repaints (reduced=%s)', reducedMotion => {
    const { net, fix, now: start } = planned();
    const model = createIntegrator(net);
    let now = start;
    let frame: (() => void) | undefined;
    let drawn: Drawn[] = [];
    model.update([fix], now);
    const loop = createLoop(() => { drawn = model.step(now); return true; }, {
      now: () => now, reducedMotion,
      raf: cb => { frame = () => cb(now); return 1; }, cancel: () => { frame = undefined; },
      setTimer: cb => { frame = cb; return 1; }, clearTimer: () => {},
    });
    loop.start();
    const step = reducedMotion ? 1000 : 1000 / 12;
    for (let elapsed = step; elapsed <= 181_000 + 1; elapsed += step) {
      now = start + Math.round(elapsed);
      if (Math.round(elapsed) % 12_000 === 0) model.update([structuredClone(fix)], now);
      frame?.();
      if (now - start >= 60_000 && now - start < 60_000 + step) {
        expect(drawn[0].s).toBeLessThanOrEqual(600);
        expect(drawn[0].held).toBe(true);
        expect(drawn[0].confidence).toBeCloseTo(fix.confidence! * 0.8, 3);
      }
      if (now - start >= 140_000 && drawn.length) expect(drawn[0].heading).toBeNull();
    }
    expect(drawn).toEqual([]);
    loop.stop();
  });

  it('accepts a genuinely new plan with the same report and rejects an older response', () => {
    const { net, fix, now } = planned();
    const model = createIntegrator(net);
    model.update([fix], now);
    const newer = { ...fix, generatedAt: now + 12_000, confidence: 0.5 };
    model.update([newer], now + 12_000);
    expect(model.step(now + 12_000)[0].confidence).toBe(0.5);
    model.update([fix], now + 24_000);
    expect(model.step(now + 24_000)[0].confidence).toBe(0.5);
  });

  it.each([false, true])('holds and fades from the last report when the real plan is generated 12 s later (reduced=%s)', reducedMotion => {
    const { net, fix, now: reportAt } = planned(12);
    const model = createIntegrator(net);
    let now = fix.generatedAt;
    let frame: (() => void) | undefined;
    let drawn: Drawn[] = [];
    model.update([fix], now);
    const loop = createLoop(() => { drawn = model.step(now); return true; }, {
      now: () => now, reducedMotion,
      raf: cb => { frame = () => cb(now); return 1; }, cancel: () => { frame = undefined; },
      setTimer: cb => { frame = cb; return 1; }, clearTimer: () => {},
    });
    loop.start();
    const framesPerSecond = reducedMotion ? 1 : 12;
    try {
      for (let frameNo = 1; frameNo <= 168 * framesPerSecond; frameNo++) {
        now = fix.generatedAt + Math.round(frameNo * 1000 / framesPerSecond);
        if (frameNo % (12 * framesPerSecond) === 0) model.update([structuredClone(fix)], now);
        frame?.();
        if (now === reportAt + 60_000) {
          expect(drawn[0].s).toBeLessThanOrEqual(600);
          expect(drawn[0].held).toBe(true);
          expect(drawn[0].confidence).toBeCloseTo(fix.confidence! * 0.8, 3);
        }
        if (now === reportAt + 140_000) expect(drawn[0].heading).toBeNull();
        if (now === reportAt + 179_000) expect(drawn).toHaveLength(1);
      }
      expect(now).toBe(reportAt + 180_000);
      expect(drawn).toEqual([]);
    } finally { loop.stop(); }
  });

  it('does not evaluate a versioned arc on another graph in alternate renderers', () => {
    const { net, fix, now } = planned();
    const model = createIntegrator(net);
    model.update([{ ...fix, network: net.graphHash }], now);
    expect(model.step(now)).toHaveLength(1);
    model.update([{ ...fix, generatedAt: now + 12_000, network: 'other-graph' }], now + 12_000);
    expect(model.step(now + 12_000)).toEqual([]);
  });

  it('recognizes cloned legacy plans without producer metadata', () => {
    const { net, fix, now } = planned();
    delete (fix as Partial<Fix>).generatedAt;
    const model = createIntegrator(net);
    model.update([fix], now);
    let last: Drawn[] = [];
    for (let elapsed = 0; elapsed <= 60_000; elapsed += 1000) {
      if (elapsed % 12_000 === 0) model.update([structuredClone(fix)], now + elapsed);
      last = model.step(now + elapsed);
    }
    expect(last[0].s).toBeLessThanOrEqual(600);
    expect(last[0].confidence).toBeCloseTo(fix.confidence! * 0.8, 3);
  });

  it.each([true, false])('does not restart the report lifetime on a first delivery at 60 s (versioned=%s)', versioned => {
    const { net, fix, now: reportAt } = planned(12);
    if (!versioned) delete (fix as Partial<Fix>).generatedAt;
    const model = createIntegrator(net);
    model.update([fix], reportAt + 60_000);
    const drawn = model.step(reportAt + 60_000)[0];
    expect(drawn.s).toBeLessThanOrEqual(600);
    expect(drawn.confidence).toBeCloseTo(fix.confidence! * 0.8, 3);
    expect(model.step(reportAt + 179_000)).toHaveLength(1);
    expect(model.step(reportAt + 180_000)).toEqual([]);
  });

  it('extends confidence already decayed by a producer without fading it twice', () => {
    const { net, fix, now: reportAt } = planned();
    const model = createIntegrator(net);
    model.update([{ ...fix, generatedAt: reportAt + 60_000, confidence: 0.9 * 0.8 }], reportAt + 60_000);
    expect(model.step(reportAt + 60_000)[0].confidence).toBeCloseTo(0.9 * 0.8, 3);
    expect(model.step(reportAt + 90_000)[0].confidence).toBeCloseTo(0.9 * 0.6, 3);
  });

  it('preserves a real post-silence plan hold when two platform zones overlap', () => {
    const spec = corridorSpec();
    spec.stops.push({ id: 'T650', edge: 0, s: 650 });
    spec.routes[0].paths![0].served!.push('T650');
    const net = syntheticNetwork(spec);
    const matcher = createMatcher(net);
    const track = newTrack('overlap', '1', 't1', 'tram');
    const t = 1_800_000_000;
    for (const [x, atSec] of [[583, t - 10], [633, t]]) {
      const [lon, lat] = toLonLat({ x, y: 0 });
      matcher.matchFix(track, { x, y: 0, lon, lat, atSec }, matcher.priorFor('1_0', '1', 0), null);
    }
    track.speed = 5;
    buildPlan(track, net, { segmentSeconds: (_p, a, b) => (b - a) / 5, dwellSeconds: () => 20 },
      null, t + 42, t + 42, { hourBand: 12, dayType: 0 });
    expect(track.next?.stopId).toBe('T650'); // nearest platform, not the first within 40 m
    const plan = track.plan!;
    if (plan.on !== 'path') throw new Error('expected a real path plan');
    const [lon, lat] = toLonLat(net.toPathPoint(plan.pathIdx, 633));
    const fix: Fix = {
      id: track.id, lon, lat, at: t * 1000, generatedAt: (t + 42) * 1000,
      routeId: '1', type: 0, path: '1_0', speed: 5, confidence: track.confidence,
      plan: { on: 'path', knots: plan.knots.map(([s, arc]) => [(t + 42 + s) * 1000, arc]) },
    };
    const model = createIntegrator(net);
    model.update([fix], (t + 42) * 1000);
    const drawn = model.step((t + 60) * 1000)[0];
    expect(drawn.s).toBe(650);
    expect(drawn.held).toBe(true);
    expect(drawn.confidence).toBeCloseTo(0.9 * 0.8, 3);
    expect(model.step((t + 180) * 1000)).toEqual([]);
  });

  it.each([false, true])('chooses the next forward stop unless the report explicitly holds the platform behind (held=%s)', held => {
    const { net, fix, now } = planned(12);
    const report: Fix = {
      ...fix, held, nextStopId: 'T900',
      plan: { on: 'path', knots: held
        ? [[now, 633], [now + 30_000, 633], [now + 90_000, 1200]]
        : [[now, 633], [now + 20_000, 900], [now + 40_000, 900], [now + 90_000, 1200]] },
    };
    const model = createIntegrator(net);
    model.update([report], now + 12_000);
    let drawn: Drawn[] = [];
    for (let sec = 12; sec <= 60; sec++) {
      if (sec % 12 === 0) model.update([structuredClone(report)], now + sec * 1000);
      drawn = model.step(now + sec * 1000);
    }
    expect(drawn[0].s).toBeLessThanOrEqual(900);
    if (held) expect(drawn[0].s).toBe(633);
    else expect(drawn[0].s).toBeGreaterThan(895);
    expect(drawn[0].confidence).toBeCloseTo(0.9 * 0.8, 3);
  });
});

// The client side of the engine (B6, R-TE10): the twin's plans arrive as
// wire fixes every tick, and the integrator turns them into what is drawn
// sixty times a second. What it must never do is jump (R-P2), run a tram
// backwards beyond a small correction, or let two trams on one path draw in
// the wrong order while their marks converge; what it must do is move from
// the very first frame, face along the track, carry the twin's headsign and
// next stop, hold at the estimate before any plan exists, and forget a
// vehicle three minutes after its last report (EVICT_S, T8).
describe('the integrator over the corridor (4 trams, 5 min at 60 Hz)', () => {
  it('never jumps, never reverses beyond the allowance, keeps the plan order on a shared path, moves from the first frame, and evicts after three minutes of silence', () => {
    const net = syntheticNetwork(corridorSpec());
    const matcher = createMatcher(net);
    const cruise = 10;
    const times: TimesProvider = { segmentSeconds: (_p, a, b) => (b - a) / cruise, dwellSeconds: () => 20 };
    const BANDS = { hourBand: 12, dayType: 0 as const };
    const start = 1_800_000_000;
    const sim = simulate(net, ['1_0', '2_0'], {
      trams: 4,
      headwaySec: 60,
      cruiseMs: cruise,
      dwellSec: 20,
      noiseM: 8,
      refreshP: 2 / 3,
      latencyMinSec: 2,
      latencyMaxSec: 25,
      tickSec: 10,
      durationSec: 300,
      seed: 11,
      startSec: start,
    });

    const tracks = new Map<string, Track>();
    const integrator = createIntegrator(net);
    const FRAME_MS = 1000 / 60;
    const pathKeyOf = (d: Drawn): string | null => (d.onShape === null ? null : String(d.onShape));
    const arcOf = (d: Drawn, pathIdx: number): number => net.projectOntoPath(pathIdx, d.p).s;

    let worstJump = 0;
    let worstBackwardPerFrame = 0;
    let worstBackwardPerPlan = 0;
    let orderViolations = 0;
    let firstFramesStill = 0;
    let firstFramesSeen = 0;
    let headingUnknownOnGeometry = 0;
    const seen = new Set<string>();

    for (const frame of sim.frames) {
      const nowSec = frame.headerSec + 2;
      const nextByTrip = new Map(frame.updates.map((u) => [u.tripId, u]));
      for (const f of frame.fixes) {
        let track = tracks.get(f.id);
        if (!track) {
          track = newTrack(f.id, f.routeId, f.tripId, 'tram');
          tracks.set(f.id, track);
        }
        const p = toPlane(f.lon, f.lat);
        matcher.matchFix(track, { x: p.x, y: p.y, lon: f.lon, lat: f.lat, atSec: f.atSec }, matcher.priorFor(f.shapeId, f.routeId, f.direction), nextByTrip.get(f.tripId)?.stopId ?? null);
        track.speed = estimateSpeed(track.fixes, { stopsBetween: matcher.stopsBetween });
      }
      for (const track of tracks.values()) {
        const update = track.tripId ? nextByTrip.get(track.tripId) : undefined;
        buildPlan(track, net, times, update ? { stopId: update.stopId, timeSec: update.timeSec, delaySec: 0 } : null, nowSec, frame.headerSec, BANDS);
      }
      enforceOrder([...tracks.values()], net, nowSec, frame.headerSec);

      // The twin's payload for this tick, as fixes.ts would decode it.
      const fixes: Fix[] = [];
      const pathOf = new Map<string, number>();
      for (const track of tracks.values()) {
        const plan = track.plan;
        const last = lastFix(track);
        if (!plan || plan.on !== 'path' || !last) continue;
        const sNow = evalPathPlan(plan.knots, nowSec - frame.headerSec);
        const [lon, lat] = toLonLat(net.toPathPoint(plan.pathIdx, sNow));
        pathOf.set(track.id, plan.pathIdx);
        fixes.push({
          id: track.id,
          lon,
          lat,
          at: last.atSec * 1000,
          routeId: track.routeId,
          tripId: track.tripId ?? undefined,
          type: 0,
          direction: 0,
          headsign: `Kraj ${track.routeId}`,
          nextStopId: track.next?.stopId,
          path: net.paths[plan.pathIdx].id,
          plan: { on: 'path', knots: plan.knots.map(([t, s]) => [(frame.headerSec + t) * 1000, s] as [number, number]) },
          speed: track.speed,
          confidence: track.confidence,
        });
      }
      const nowMs = nowSec * 1000;
      integrator.update(fixes, nowMs);

      // A tick's worth of frames, the plan order to respect and the arcs drawn.
      const prevArc = new Map<string, number>();
      const lastArc = new Map<string, number>();
      const firstArc = new Map<string, { arc: number; t: number }>();
      const backwardInPlan = new Map<string, number>();
      const planAt = (id: string, tMs: number): number => {
        const f = fixes.find((x) => x.id === id)!;
        const knots = (f.plan as { on: 'path'; knots: readonly (readonly [number, number])[] }).knots;
        return evalPathPlan(knots.map(([ms, s]) => [ms / 1000 - frame.headerSec, s] as [number, number]), tMs / 1000 - frame.headerSec);
      };
      for (let k = 0; k <= 600; k++) {
        const t = nowMs + k * FRAME_MS;
        const drawn = integrator.step(t);
        const arcNow = new Map<string, number>();
        for (const d of drawn) {
          const pathIdx = pathOf.get(d.id);
          if (pathIdx === undefined) continue;
          expect(pathKeyOf(d)).not.toBeNull();
          expect(d.headsign).toBe(`Kraj ${d.routeId}`);
          if (d.confidence >= 0.3 && d.heading === null) headingUnknownOnGeometry++;
          const arc = arcOf(d, pathIdx);
          if (k === 0) {
            // Diagram renderers need the actual post-order-clamp arc, not a
            // projection or a shape id (synthetic paths have no shape).
            expect(d.path).toBe(pathIdx);
            expect(d.s).toBeCloseTo(arc, 3);
          }
          arcNow.set(d.id, arc);
          const prev = prevArc.get(d.id);
          if (prev !== undefined) {
            const delta = arc - prev;
            worstJump = Math.max(worstJump, Math.abs(delta));
            if (delta < 0) {
              worstBackwardPerFrame = Math.max(worstBackwardPerFrame, -delta);
              backwardInPlan.set(d.id, (backwardInPlan.get(d.id) ?? 0) - delta);
            }
          } else if (!seen.has(d.id)) {
            seen.add(d.id);
            firstFramesSeen++;
            firstArc.set(d.id, { arc, t });
          }
          prevArc.set(d.id, arc);
          lastArc.set(d.id, arc);
        }
        // Plan order per shared path: whoever the plan puts behind draws behind, one tram length back.
        const byPath = new Map<number, { id: string; planS: number; drawnS: number }[]>();
        for (const d of drawn) {
          const pathIdx = pathOf.get(d.id);
          const f = fixes.find((x) => x.id === d.id);
          if (pathIdx === undefined || !f || !f.plan || f.plan.on !== 'path') continue;
          const planS = evalPathPlan(f.plan.knots.map(([ms, s]) => [ms / 1000 - frame.headerSec, s] as [number, number]), t / 1000 - frame.headerSec);
          const list = byPath.get(pathIdx) ?? [];
          list.push({ id: d.id, planS, drawnS: arcNow.get(d.id) ?? arcOf(d, pathIdx) });
          byPath.set(pathIdx, list);
        }
        for (const list of byPath.values()) {
          list.sort((a, b) => b.planS - a.planS);
          for (let i = 1; i < list.length; i++) {
            if (list[i - 1].planS - list[i].planS < HEADWAY_M) continue; // the plans themselves are within a tram length: unordered
            if (list[i].drawnS > list[i - 1].drawnS - HEADWAY_M + 0.5) orderViolations++;
          }
        }
      }
      for (const b of backwardInPlan.values()) worstBackwardPerPlan = Math.max(worstBackwardPerPlan, b);
      // A vehicle first drawn this tick: by the tick's end its mark has moved
      // whenever its plan did (a plan sitting in a dwell is allowed to stand).
      const tEnd = nowMs + 600 * FRAME_MS;
      for (const [id, first] of firstArc) {
        const planAdvance = planAt(id, tEnd) - planAt(id, first.t);
        const drawnAdvance = (lastArc.get(id) ?? first.arc) - first.arc;
        if (planAdvance >= 5 && drawnAdvance < 1) firstFramesStill++;
      }
    }

    expect(firstFramesSeen).toBeGreaterThanOrEqual(4);
    expect(firstFramesStill).toBe(0);
    expect(headingUnknownOnGeometry).toBe(0);
    // The catch-up cap at 60 Hz: at most max(8, 2 x speed) m/s, never a teleport.
    expect(worstJump).toBeLessThan(0.8);
    // Not a backward frame at all (F9): a mark whose plan has moved behind it
    // holds where it is until the plan catches up, and a tram on rails never
    // reverses on screen, whatever a re-plan says.
    // (The arc here is the drawn point re-projected onto the path, so the
    // tolerance is the projection's own floating-point noise, not a metre.)
    expect(worstBackwardPerFrame).toBeLessThan(1e-6);
    expect(worstBackwardPerPlan).toBeLessThan(1e-6);
    expect(orderViolations).toBe(0);

    // Silence: three minutes after the last report a vehicle is gone, not faded forever.
    const lastAt = Math.max(...[...tracks.values()].map((tr) => lastFix(tr)?.atSec ?? 0)) * 1000;
    expect(integrator.step(lastAt + 179_000).length).toBeGreaterThan(0);
    expect(integrator.step(lastAt + 181_000)).toHaveLength(0);
    expect(integrator.size()).toBe(0);
  }, 30_000); // five simulated minutes at 60 Hz: seconds of work, not the default five

  it('holds at the estimate for a fix without a plan and glides towards a moved one, facing the way it moves; a free-plane plan is followed in lon/lat', () => {
    const integrator = createIntegrator(null);
    const T0 = 1_800_000_000_000;
    const a = { id: 'v', lon: 15.97, lat: 45.81, at: T0, routeId: '6', type: 0 };
    integrator.update([a], T0);
    const first = integrator.step(T0)[0];
    expect(toLonLat(first.p).map((x) => Number(x.toFixed(5)))).toEqual([15.97, 45.81]);
    expect(first.onShape).toBeNull();
    expect(first.path).toBeUndefined();
    expect(first.s).toBeUndefined();
    // A new report 100 m east: the mark converges, never lands on it at once, and faces east.
    const bPlane = { x: toPlane(15.97, 45.81).x + 100, y: toPlane(15.97, 45.81).y };
    const [bLon, bLat] = toLonLat(bPlane);
    integrator.update([{ ...a, lon: bLon, lat: bLat, at: T0 + 10_000 }], T0 + 10_000);
    const after = integrator.step(T0 + 10_000 + 1000 / 60)[0];
    const toB = Math.hypot(after.p.x - bPlane.x, after.p.y - bPlane.y);
    expect(toB).toBeGreaterThan(50);
    expect(toB).toBeLessThan(100);
    expect(after.heading).not.toBeNull();
    expect(after.heading!.x).toBeGreaterThan(0.99);
    // A free-plane plan: the mark follows the twin's line over its own span.
    const c = { ...a, id: 'w', plan: { on: 'free' as const, knots: [[T0, 15.97, 45.81], [T0 + 5000, 15.97, 45.8106]] as [number, number, number][] }, speed: 13, confidence: 0.5 };
    integrator.update([c], T0);
    // Stepped at frame rate, as the loop does: a single frame can never catch up more than a quarter second.
    let mid!: Drawn;
    let end!: Drawn;
    for (let t = T0; t <= T0 + 6000; t += 1000 / 60) {
      const d = integrator.step(t).find((x) => x.id === 'w')!;
      if (t <= T0 + 2500) mid = d;
      end = d;
    }
    expect(toLonLat(mid.p)[1]).toBeGreaterThan(45.8101);
    expect(toLonLat(mid.p)[1]).toBeLessThan(45.8106);
    expect(toLonLat(end.p)[1]).toBeGreaterThan(toLonLat(mid.p)[1]);
    expect(end.confidence).toBeLessThanOrEqual(0.5);
  });
});

// F9's rules, each on the smallest geometry that can show it. The plans here
// are written by hand rather than grown by the twin: what is under test is
// what the *client* does with a plan, including the plans the twin should
// never publish and sometimes does (a re-anchor behind the mark, an order the
// wire contradicts).
describe('the integrator never draws a tram backwards, nor two trams across each other', () => {
  const T0 = 1_800_000_000_000;
  const FRAME_MS = 1000 / 60;

  /** One vehicle's poll: a path plan, the twin's speed, and whatever else. */
  function pathFix(id: string, path: string, knots: readonly (readonly [number, number])[], speed: number, extra: Partial<Fix> = {}): Fix {
    return { id, lon: 15.97, lat: 45.81, at: knots[0][0], type: 0, path, plan: { on: 'path', knots }, speed, confidence: 0.9, ...extra };
  }
  /** A plan that stands still: the vehicle is where it is and stays there. */
  const still = (at: number, s: number): readonly (readonly [number, number])[] => [[at, s], [at + 90_000, s]];

  it('holds instead of reversing when every third plan re-anchors forty metres behind the mark (20 min at 60 Hz)', () => {
    const net = syntheticNetwork(corridorSpec());
    const integrator = createIntegrator(net);
    // Two metres a second: twenty minutes of corridor without running off its
    // end, and a forty-metre re-anchor is then twenty seconds of lost ground
    // -- the case the old one-metre-a-second allowance crawled back through
    // for a whole poll interval.
    const CRUISE = 2;
    const REGRESS_M = 40;
    const trams = [
      { id: 'a', path: '1_0', start: 900 },
      { id: 'b', path: '1_0', start: 600 },
      { id: 'c', path: '2_0', start: 300 },
      { id: 'd', path: '2_0', start: 0 },
    ];
    const prev = new Map<string, number>();
    let backward = 0;
    let advanced = 0;
    let holdFrames = 0;
    for (let poll = 0; poll * 10 <= 1200; poll++) {
      const now = T0 + poll * 10_000;
      const fixes = trams.map((t) => {
        const anchor = t.start + poll * 10 * CRUISE - Math.floor(poll / 3) * REGRESS_M;
        return pathFix(t.id, t.path, [[now, anchor], [now + 90_000, anchor + 90 * CRUISE]], CRUISE);
      });
      integrator.update(fixes, now);
      for (let k = 0; k < 600; k++) {
        for (const d of integrator.step(now + k * FRAME_MS)) {
          if (d.s === undefined) continue;
          const before = prev.get(d.id);
          if (before !== undefined) {
            if (d.s < before - 1e-9) backward++;
            else if (d.s > before + 1e-9) advanced++;
          }
          if (d.holding) holdFrames++;
          prev.set(d.id, d.s);
        }
      }
    }
    expect(backward).toBe(0);
    // The regression was absorbed as a hold, and the marks did move: neither
    // a reversal nor twenty minutes of standing still.
    expect(holdFrames).toBeGreaterThan(0);
    expect(advanced).toBeGreaterThan(100_000);
  }, 60_000);

  it('clamps a route 1 tram behind a route 2 tram on the shared trunk, though the two run different paths', () => {
    const net = syntheticNetwork(corridorSpec());
    const integrator = createIntegrator(net);
    // Both marks on the trunk, forty metres apart and each sitting on its own plan.
    integrator.update([pathFix('L', '2_0', still(T0, 700), 2), pathFix('F', '1_0', still(T0, 660), 12)], T0);
    integrator.step(T0);
    // The leader crawls (the twin has it at 2 m/s) while its plan sits two
    // hundred metres ahead of its mark; the follower is quick and its own
    // plan, fifty metres behind the leader's, lies well ahead of the leader's
    // mark. Nothing but the clamp stops the follower driving through it.
    const t1 = T0 + 10_000;
    integrator.update([pathFix('L', '2_0', still(t1, 900), 2), pathFix('F', '1_0', still(t1, 850), 12)], t1);
    let worstOvertake = -Infinity;
    let last = new Map<string, number>();
    for (let k = 0; k <= 60 * 120; k++) {
      const drawn = new Map(integrator.step(t1 + k * FRAME_MS).map((d) => [d.id, d]));
      const l = drawn.get('L')!;
      const f = drawn.get('F')!;
      worstOvertake = Math.max(worstOvertake, f.s! - (l.s! - HEADWAY_M));
      last = new Map([['L', l.s!], ['F', f.s!]]);
    }
    expect(worstOvertake).toBeLessThanOrEqual(1e-6);
    // And neither is stranded: both reach their own plans in the end, bar the
    // dead zone's last metre (a mark does not chase floating point).
    expect(last.get('L')!).toBeGreaterThan(899);
    expect(last.get('L')!).toBeLessThanOrEqual(900);
    expect(last.get('F')!).toBeGreaterThan(849);
    expect(last.get('F')!).toBeLessThanOrEqual(850);
  }, 30_000);

  it('obeys the same clamp for a vehicle whose route type the wire never named, because its plan runs the rails', () => {
    const net = syntheticNetwork(corridorSpec());
    const integrator = createIntegrator(net);
    const untyped = (id: string, path: string, knots: readonly (readonly [number, number])[], speed: number): Fix => ({
      id, lon: 15.97, lat: 45.81, at: knots[0][0], path, plan: { on: 'path', knots }, speed, confidence: 0.9,
    });
    integrator.update([untyped('L', '2_0', still(T0, 700), 2), untyped('F', '1_0', still(T0, 660), 12)], T0);
    expect(integrator.step(T0)[0].type).toBe(-1);
    const t1 = T0 + 10_000;
    integrator.update([untyped('L', '2_0', still(t1, 900), 2), untyped('F', '1_0', still(t1, 850), 12)], t1);
    let worstOvertake = -Infinity;
    for (let k = 0; k <= 60 * 120; k++) {
      const drawn = new Map(integrator.step(t1 + k * FRAME_MS).map((d) => [d.id, d]));
      worstOvertake = Math.max(worstOvertake, drawn.get('F')!.s! - (drawn.get('L')!.s! - HEADWAY_M));
    }
    expect(worstOvertake).toBeLessThanOrEqual(1e-6);
  }, 30_000);

  it('keeps the order the wire named through a plan that flips it, and follows the plans only without one', () => {
    const run = (behind: string | undefined): { a: number; b: number; held: boolean } => {
      const net = syntheticNetwork(corridorSpec());
      const integrator = createIntegrator(net);
      const wire = behind === undefined ? {} : { behind };
      integrator.update([pathFix('B', '1_0', still(T0, 800), 8), pathFix('A', '1_0', still(T0, 700), 8, wire)], T0);
      integrator.step(T0);
      // The next tick's plans put A a hundred metres ahead of B. The wire
      // still says A is the one behind, and the wire is the register.
      const t1 = T0 + 10_000;
      integrator.update([pathFix('B', '1_0', still(t1, 800), 8), pathFix('A', '1_0', still(t1, 900), 8, wire)], t1);
      let held = false;
      let out = new Map<string, Drawn>();
      for (let k = 0; k <= 60 * 120; k++) {
        out = new Map(integrator.step(t1 + k * FRAME_MS).map((d) => [d.id, d]));
        if (out.get('A')!.holding) held = true;
        if (behind !== undefined) expect(out.get('A')!.s!).toBeLessThanOrEqual(out.get('B')!.s! - HEADWAY_M + 1e-6);
      }
      return { a: out.get('A')!.s!, b: out.get('B')!.s!, held };
    };
    // With the wire: A holds a tram length behind B and never takes the lead.
    const wired = run('B');
    expect(wired.a).toBeCloseTo(800 - HEADWAY_M, 1);
    expect(wired.b).toBeCloseTo(800, 1);
    expect(wired.held).toBe(true);
    // Without it there is nothing but the plans to go on, and the plans have
    // swapped the two: A leads. That difference is why the wire exists.
    const bare = run(undefined);
    expect(bare.a).toBeGreaterThan(bare.b);
    expect(bare.a).toBeGreaterThan(899);
    expect(bare.b).toBeCloseTo(800, 6);
  }, 30_000);

  it('reads its ceiling on the lap it is actually running, not the one it ran ten minutes ago', () => {
    // A circuit: line 6's path runs the same two edges twice in one trip, a
    // lap apart along the arc. The follower is on its SECOND lap; its leader
    // runs a one-lap path over the same rails. Mapping the leader's arc by
    // the FIRST occurrence of its edge puts the ceiling a whole lap behind
    // the mark, which is a ceiling the follower can never pass: it would
    // stand still until the twin next spoke (E3, the F9 review's finding).
    const net = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(0, 1000) },
        { from: 1, to: 0, pts: [{ x: 1000, y: 0 }, { x: 1000, y: 500 }, { x: 0, y: 500 }, { x: 0, y: 0 }] },
      ],
      routes: [
        { id: '6', type: 0, paths: [{ id: 'C6', direction: 0, edges: [0, 1, 0, 1], served: ['S0'] }] },
        { id: '7', type: 0, paths: [{ id: 'S7', direction: 0, edges: [0, 1], served: ['S0'] }] },
      ],
      stops: [{ id: 'S0', edge: 0, s: 0, terminal: true }],
    });
    const lap = net.paths[net.paths.findIndex((p) => p.id === 'C6')].offsets[2];
    expect(lap).toBeCloseTo(3000, 6);
    const integrator = createIntegrator(net);
    // The leader stands at 400 m on its own path; the follower is at 3200 m
    // on its second lap -- the same rails, 200 m behind it on the ground --
    // and its plan asks it forward 400 m over the next minute and a half.
    integrator.update(
      [
        pathFix('L', 'S7', still(T0, 400), 0),
        pathFix('F', 'C6', [[T0, lap + 200], [T0 + 90_000, lap + 600]], 6, { behind: 'L' }),
      ],
      T0,
    );
    let out = new Map<string, Drawn>();
    for (let k = 0; k <= 60 * 120; k++) out = new Map(integrator.step(T0 + k * FRAME_MS).map((d) => [d.id, d]));
    // It runs up to one tram length behind the leader ON ITS OWN LAP, and
    // nowhere near the arc the first occurrence would have given it.
    expect(out.get('F')!.s!).toBeGreaterThan(lap + 300);
    expect(out.get('F')!.s!).toBeLessThanOrEqual(lap + 400 - HEADWAY_M + 1e-6);
    expect(out.get('L')!.s!).toBeCloseTo(400, 1);
  }, 30_000);

  it('releases a wire leader whose own plan has fallen a swap limit behind it', () => {
    // The register withdraws `behind` the tick a relation ends, but a wire
    // that is a poll stale (or a twin that has not caught up) can still name
    // a leader the follower has long since left 400 m behind. The client
    // holds the wire's order through a crossing of the plans -- that is what
    // it is for -- but not through THIS: a ceiling that far back would freeze
    // the mark until the twin next spoke. It is dropped until the wire
    // re-asserts it, which the next poll does if the register still means it.
    const net = syntheticNetwork(corridorSpec());
    const integrator = createIntegrator(net);
    integrator.update([pathFix('B', '1_0', still(T0, 400), 8), pathFix('A', '1_0', still(T0, 300), 8, { behind: 'B' })], T0);
    integrator.step(T0);
    // A's plan is now 500 m past B's, well beyond SWAP_LIMIT_M, and the wire
    // still names B. A must reach its own plan rather than stall at B - 35.
    const t1 = T0 + 10_000;
    integrator.update([pathFix('B', '1_0', still(t1, 400), 8), pathFix('A', '1_0', still(t1, 900), 8, { behind: 'B' })], t1);
    let out = new Map<string, Drawn>();
    for (let k = 0; k <= 60 * 120; k++) out = new Map(integrator.step(t1 + k * FRAME_MS).map((d) => [d.id, d]));
    expect(out.get('A')!.s!).toBeGreaterThan(899);
    expect(out.get('B')!.s!).toBeCloseTo(400, 1);
  }, 30_000);

  it('keeps pace with an eight-metre-a-second plan on a once-a-second loop', () => {
    const net = syntheticNetwork(corridorSpec());
    const integrator = createIntegrator(net);
    const SPEED = 8;
    const knots: [number, number][] = [[T0, 100], [T0 + 90_000, 100 + 90 * SPEED]];
    integrator.update([pathFix('v', '1_0', knots, SPEED)], T0);
    const gapAt = (t: number): number => {
      const d = integrator.step(t)[0];
      return 100 + ((t - T0) / 1000) * SPEED - d.s!;
    };
    let gap30 = 0;
    let gap60 = 0;
    for (let t = T0; t <= T0 + 60_000; t += 1000) {
      // This is the live convergence-rate control, not a one-minute
      // outage: renew reports without changing its eight-metre/s target.
      if ((t - T0) % 10_000 === 0) integrator.update([{ ...pathFix('v', '1_0', knots, SPEED), at: t, generatedAt: t }], t);
      const gap = gapAt(t);
      if (t === T0 + 30_000) gap30 = gap;
      if (t === T0 + 60_000) gap60 = gap;
    }
    // The mark keeps pace: the lag settles at the convergence's own steady
    // state (about sixteen metres at this speed) instead of growing by the
    // three quarters of every second the loop used to throw away.
    expect(gap60).toBeLessThan(20);
    expect(Math.abs(gap60 - gap30)).toBeLessThan(1);
  });

  it('re-seeds onto a loop at the arc nearest the one it was drawn at, not at the nearest point on the ground', () => {
    // A stem from (0,0) to (1000,0) and a loop that runs six metres north of
    // it, away to (0,300) and back four metres south of it: a mark at (990,0)
    // is nearer the loop's return leg (arc 3588) than its outbound one (arc
    // 990), and the two are a whole circuit apart.
    const spec: SynthSpec = {
      edges: [
        { from: 0, to: 1, pts: straight(0, 1000) },
        { from: 2, to: 3, pts: straight(0, 1000, 6) },
        { from: 3, to: 4, pts: [{ x: 1000, y: 6 }, { x: 1000, y: 300 }, { x: 0, y: 300 }, { x: 0, y: -4 }] },
        { from: 4, to: 5, pts: straight(0, 1000, -4) },
      ],
      routes: [
        { id: 'S', type: 0, paths: [{ id: 'stem', direction: 0, edges: [0] }] },
        { id: 'L', type: 0, paths: [{ id: 'loop', direction: 0, edges: [1, 2, 3] }] },
      ],
      stops: [],
    };
    const net = syntheticNetwork(spec);
    const loopIdx = net.paths.findIndex((p) => p.id === 'loop');
    expect(net.projectOntoPath(loopIdx, { x: 990, y: 0 }).s).toBeGreaterThan(3000); // the global nearest point is the return leg
    const integrator = createIntegrator(net);
    integrator.update([pathFix('v', 'stem', still(T0, 990), 8)], T0);
    expect(integrator.step(T0)[0].s).toBeCloseTo(990, 6);
    // The trip changes and the vehicle is now planned along the loop.
    const t1 = T0 + 10_000;
    integrator.update([pathFix('v', 'loop', still(t1, 1000), 8)], t1);
    const after = integrator.step(t1)[0];
    expect(after.path).toBe(loopIdx);
    // It re-seeded at the arc it was drawn at (990) and is closing the last
    // ten metres onto the fix's own arc by the ease -- so at or above 990 and
    // never AT 1000, which is what reseedArc falls back to when the window
    // finds nothing. The old band (900 to 1100) admitted that fallback and so
    // was not testing the window at all (the review's M7).
    expect(after.s).toBeGreaterThanOrEqual(990);
    expect(after.s).toBeLessThan(999);
  });

  it('re-seeds a held mark near its drawn point when the new plan window has moved far ahead', () => {
    // Recorded 22139, 21 Sep 13:12:58: held at the end of 6_2, the
    // 6_25 plan is 667 m along its departure, but that path starts only
    // 89 m from the drawn mark. Do not add 667 m of plan lag to the jump.
    const net = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(0, 1000) },
        { from: 2, to: 3, pts: Array.from({ length: 25 }, (_, i) => ({ x: 1089 + 50 * i, y: 0 })) },
      ],
      routes: [{ id: '1', type: 0, paths: [
        { id: 'arrival', direction: 0, edges: [0] },
        { id: 'departure', direction: 1, edges: [1] },
      ] }],
      stops: [],
    });
    const integrator = createIntegrator(net);
    integrator.update([pathFix('v', 'arrival', still(T0, 1000), 0)], T0);
    integrator.step(T0);
    const t1 = T0 + 10_000;
    integrator.update([pathFix('v', 'arrival', still(t1, 900), 0)], t1);
    const before = integrator.step(t1)[0];
    expect(before.holding).toBe(true);
    integrator.update([pathFix('v', 'departure', still(t1, 667), 0)], t1);
    const after = integrator.step(t1)[0];
    expect(after.path).toBe(1);
    expect(after.s).toBe(0);
    expect(Math.hypot(after.p.x - before.p.x, after.p.y - before.p.y)).toBeCloseTo(89, 6);
    expect(after.lastSnapAt).toBe(t1); // still measured as a re-seed
    expect(integrator.size()).toBe(1); // no visibility suppression
    const later = integrator.step(t1 + 1000)[0];
    expect(later.s).toBeGreaterThan(after.s!);
    expect(later.s).toBeLessThan(667);
  });

  it('re-seeds a held mark onto the new geometry it stands on when the plan window has moved ahead of it (rail round 2)', () => {
    // Recorded 102204, 20 Sep 08:27:04: held 73 s at the Dubrava platform on
    // the loop's joint edge, one metre from where 12_11 starts; the 12_11
    // plan is 230 m along when it arrives, the window around it starts 110 m
    // behind, and the mark landed on the window's edge, 110 m from where it
    // stood, then raced on. The nearest compatible geometry behind the
    // window is where the tram itself went: a one-metre re-seed and a
    // catch-up along the rails.
    const net = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(0, 1000) },
        { from: 2, to: 3, pts: Array.from({ length: 25 }, (_, i) => ({ x: 1001 + 50 * i, y: 0 })) },
      ],
      routes: [{ id: '1', type: 0, paths: [
        { id: 'arrival', direction: 0, edges: [0] },
        { id: 'departure', direction: 1, edges: [1] },
      ] }],
      stops: [],
    });
    const integrator = createIntegrator(net);
    integrator.update([pathFix('v', 'arrival', still(T0, 1000), 0, { held: true })], T0);
    integrator.step(T0);
    const t1 = T0 + 73_000;
    const before = integrator.step(t1)[0];
    expect(before.held).toBe(true);
    expect(before.holding).not.toBe(true); // held by the twin's T8 rule, not waiting for a plan behind it
    integrator.update([pathFix('v', 'departure', [[t1 - 11_000, 102], [t1 - 4_000, 166], [t1 + 56_000, 715]], 8, { held: false })], t1);
    const after = integrator.step(t1)[0];
    expect(after.path).toBe(1);
    expect(after.s).toBeLessThan(2);
    expect(Math.hypot(after.p.x - before.p.x, after.p.y - before.p.y)).toBeLessThan(2);
    expect(after.lastSnapAt).toBe(t1);
    const later = integrator.step(t1 + 1000)[0];
    expect(later.s).toBeGreaterThan(after.s!); // catching up along the rails
  });

  it('keeps the plan fold when a held mark is near a later return leg', () => {
    const net = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(0, 1000) },
        { from: 2, to: 3, pts: Array.from({ length: 21 }, (_, i) => ({ x: 50 * i, y: 6 })) },
        { from: 3, to: 4, pts: [{ x: 1000, y: 6 }, { x: 1000, y: 300 }, { x: 0, y: 300 }, { x: 0, y: -4 }] },
        { from: 4, to: 5, pts: straight(0, 1000, -4) },
      ],
      routes: [{ id: '1', type: 0, paths: [
        { id: 'stem', direction: 0, edges: [0] },
        { id: 'loop', direction: 0, edges: [1, 2, 3] },
      ] }],
      stops: [],
    });
    const integrator = createIntegrator(net);
    integrator.update([pathFix('v', 'stem', still(T0, 200), 0)], T0);
    integrator.step(T0);
    const t1 = T0 + 10_000;
    integrator.update([pathFix('v', 'stem', still(t1, 100), 0)], t1);
    expect(integrator.step(t1)[0].holding).toBe(true);
    integrator.update([pathFix('v', 'loop', still(t1, 600), 0)], t1);
    const after = integrator.step(t1)[0];
    expect(after.s).toBeCloseTo(200, 6);
    expect(after.p.y).toBeCloseTo(6, 6); // not the closer, later return leg
  });

  it.each([
    { heading: 'westbound', mirror: false },
    { heading: 'eastbound', mirror: true },
  ])('re-seeds a held $heading mark onto the matching earlier loop segment', ({ mirror }) => {
    // Review P1: (200,0) is 4 m from eastbound s=200, but 6 m from
    // westbound s=1810. Choosing s=200 invents another 1.61 km of travel.
    // Reflect x for the mirror case; segmentation keeps the plan window
    // genuinely empty instead of projecting onto a long segment's end.
    const x = (value: number): number => mirror ? 1000 - value : value;
    const net = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(x(1000), x(0)) },
        { from: 2, to: 3, pts: [
          ...Array.from({ length: 21 }, (_, i) => ({ x: x(50 * i), y: -4 })),
          ...Array.from({ length: 21 }, (_, i) => ({ x: x(1000 - 50 * i), y: 6 })),
          ...Array.from({ length: 20 }, (_, i) => ({ x: x(0), y: 56 + 50 * i })),
        ] },
      ],
      routes: [{ id: '1', type: 0, paths: [
        { id: 'stem', direction: 0, edges: [0] },
        { id: 'loop', direction: 1, edges: [1] },
      ] }],
      stops: [],
    });
    const integrator = createIntegrator(net);
    integrator.update([pathFix('v', 'stem', still(T0, 800), 0)], T0);
    integrator.step(T0);
    const t1 = T0 + 10_000;
    integrator.update([pathFix('v', 'stem', still(t1, 700), 0)], t1);
    const before = integrator.step(t1)[0];
    expect(before.holding).toBe(true);
    expect(before.p).toEqual({ x: x(200), y: 0 });
    expect(before.heading).toEqual({ x: mirror ? 1 : -1, y: 0 });
    const candidates = net.projectionsOntoPath(1, before.p, 0, 2700, 150);
    expect(candidates).toEqual([{ s: 200, d: 4 }, { s: 1810, d: 6 }]);
    integrator.update([pathFix('v', 'loop', still(t1, 2700), 0)], t1);
    const after = integrator.step(t1)[0];
    expect(after.s).toBe(1810);
    expect(after.p).toEqual({ x: x(200), y: 6 });
    expect(after.heading).toEqual(before.heading);
    expect(after.lastSnapAt).toBe(t1);
    expect(integrator.size()).toBe(1);
  });

  it('falls back to the plan when a held mark only has a wrong-direction nearby segment', () => {
    const net = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(1000, 0) },
        { from: 2, to: 3, pts: [
          ...Array.from({ length: 21 }, (_, i) => ({ x: 50 * i, y: -4 })),
          ...Array.from({ length: 40 }, (_, i) => ({ x: 1000, y: 46 + 50 * i })),
        ] },
      ],
      routes: [{ id: '1', type: 0, paths: [
        { id: 'stem', direction: 0, edges: [0] },
        { id: 'departure', direction: 1, edges: [1] },
      ] }],
      stops: [],
    });
    const integrator = createIntegrator(net);
    integrator.update([pathFix('v', 'stem', still(T0, 800), 0)], T0);
    integrator.step(T0);
    const t1 = T0 + 10_000;
    integrator.update([pathFix('v', 'stem', still(t1, 700), 0)], t1);
    const before = integrator.step(t1)[0];
    expect(before.holding).toBe(true);
    expect(before.heading).toEqual({ x: -1, y: 0 });
    expect(net.projectionsOntoPath(1, before.p, 0, 2700, 150)).toEqual([{ s: 200, d: 4 }]);
    integrator.update([pathFix('v', 'departure', still(t1, 2700), 0)], t1);
    const after = integrator.step(t1)[0];
    expect(after.s).toBe(2700);
    expect(after.p).toEqual(net.toPathPoint(1, 2700));
    expect(after.lastSnapAt).toBe(t1);
  });

  it('re-seeds a held mark nearest the plan progress among matching nearby segments', () => {
    const net = syntheticNetwork({
      edges: [
        { from: 0, to: 1, pts: straight(0, 1000) },
        { from: 2, to: 3, pts: [
          ...Array.from({ length: 21 }, (_, i) => ({ x: 50 * i, y: -4 })),
          { x: 1000, y: 306 }, { x: 0, y: 306 }, { x: 0, y: 6 },
          ...Array.from({ length: 20 }, (_, i) => ({ x: 50 + 50 * i, y: 6 })),
          ...Array.from({ length: 20 }, (_, i) => ({ x: 1000, y: 56 + 50 * i })),
        ] },
      ],
      routes: [{ id: '1', type: 0, paths: [
        { id: 'stem', direction: 0, edges: [0] },
        { id: 'loop', direction: 0, edges: [1] },
      ] }],
      stops: [],
    });
    const integrator = createIntegrator(net);
    integrator.update([pathFix('v', 'stem', still(T0, 200), 0)], T0);
    integrator.step(T0);
    const t1 = T0 + 10_000;
    integrator.update([pathFix('v', 'stem', still(t1, 100), 0)], t1);
    const before = integrator.step(t1)[0];
    expect(before.holding).toBe(true);
    expect(net.projectionsOntoPath(1, before.p, 0, 4300, 150)).toEqual([{ s: 200, d: 4 }, { s: 2810, d: 6 }]);
    integrator.update([pathFix('v', 'loop', still(t1, 4300), 0)], t1);
    const after = integrator.step(t1)[0];
    expect(after.s).toBe(2810);
    expect(after.p).toEqual({ x: 200, y: 6 });
    expect(after.heading).toEqual(before.heading);
  });
});
