import { describe, expect, it } from 'vitest';
import { toLonLat, toPlane } from '../../shared/motion/geo';
import { HEADWAY_M, enforceOrder } from '../../shared/motion/laws';
import { createMatcher } from '../../shared/motion/match';
import { buildPlan, evalPathPlan } from '../../shared/motion/plan';
import { estimateSpeed } from '../../shared/motion/speed';
import type { TimesProvider } from '../../shared/motion/times';
import { lastFix, newTrack, type Track } from '../../shared/motion/track';
import { createIntegrator, type Drawn, type Fix } from '../../app/src/motion/integrator';
import { simulate } from './simulator';
import { corridorSpec, syntheticNetwork } from './synthetic-network';

// The client side of the engine (B6, R-TE10): the twin's plans arrive as
// wire fixes every tick, and the integrator turns them into what is drawn
// sixty times a second. What it must never do is jump (R-P2), run a tram
// backwards beyond a small correction, or let two trams on one path draw in
// the wrong order while their marks converge; what it must do is move from
// the very first frame, face along the track, carry the twin's headsign and
// next stop, hold at the estimate before any plan exists, and forget a
// vehicle five minutes after its last report.
describe('the integrator over the corridor (4 trams, 5 min at 60 Hz)', () => {
  it('never jumps, never reverses beyond the allowance, keeps the plan order on a shared path, moves from the first frame, and evicts on silence', () => {
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
    // A backward correction reads as a correction, never as a tram reversing.
    expect(worstBackwardPerFrame).toBeLessThan(1 / 60 + 1e-6);
    expect(worstBackwardPerPlan).toBeLessThanOrEqual(30 + 1e-6);
    expect(orderViolations).toBe(0);

    // Silence: five minutes after the last report a vehicle is gone, not faded forever.
    const lastAt = Math.max(...[...tracks.values()].map((tr) => lastFix(tr)?.atSec ?? 0)) * 1000;
    expect(integrator.step(lastAt + 299_000).length).toBeGreaterThan(0);
    expect(integrator.step(lastAt + 301_000)).toHaveLength(0);
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
