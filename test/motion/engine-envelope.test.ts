import { describe, expect, it } from 'vitest';
import { toPlane } from '../../shared/motion/geo';
import { enforceOrder, HEADWAY_M } from '../../shared/motion/laws';
import { createMatcher } from '../../shared/motion/match';
import { buildPlan, evalPathPlan } from '../../shared/motion/plan';
import { estimateSpeed } from '../../shared/motion/speed';
import type { TimesProvider } from '../../shared/motion/times';
import { newTrack, type Plan, type Track } from '../../shared/motion/track';
import { simulate } from './simulator';
import { corridorSpec, syntheticNetwork } from './synthetic-network';

// The engine over twenty simulated minutes: six trams alternating between
// route 1 (east) and route 2 (north) share the trunk, with GPS noise, a
// two-in-three refresh per tick and 2 to 25 s of latency. What a viewer must
// never see: an overtake on the shared track, a tram running backwards, a
// tram whose direction is unknown after its first fix, or a first plan that
// stands still. What the twin must achieve: hindsight error at 30 s under
// 60 m at the 95th percentile.
describe('the engine on the corridor (20 min, 6 trams)', () => {
  it('keeps order on the shared trunk, never reverses, knows every direction from the first fix, moves from the first plan, and predicts 30 s ahead within 60 m at p95', () => {
    const net = syntheticNetwork(corridorSpec());
    const matcher = createMatcher(net);
    const cruise = 10;
    const times: TimesProvider = { segmentSeconds: (_p, a, b) => (b - a) / cruise, dwellSeconds: () => 20 };
    const BANDS = { hourBand: 12, dayType: 0 as const };
    const start = 1_800_000_000;
    const sim = simulate(net, ['1_0', '2_0'], {
      trams: 6,
      headwaySec: 90,
      cruiseMs: cruise,
      dwellSec: 20,
      noiseM: 8,
      refreshP: 2 / 3,
      latencyMinSec: 2,
      latencyMaxSec: 25,
      tickSec: 10,
      durationSec: 1200,
      seed: 7,
      startSec: start,
    });
    const tramById = new Map(sim.trams.map((t) => [t.id, t]));
    const tracks = new Map<string, Track>();
    const plansByFrame: Map<string, Plan>[] = [];
    let directionUnknownAfterFirstFix = 0;
    let firstPlansStill = 0;
    let reversals = 0;
    const seenFirstPlan = new Set<string>();

    for (const frame of sim.frames) {
      const nowSec = frame.headerSec + 2;
      const nextByTrip = new Map(frame.updates.map((u) => [u.tripId, u]));
      for (const f of frame.fixes) {
        let track = tracks.get(f.id);
        if (!track) {
          track = newTrack(f.id, f.routeId, f.tripId, 'tram');
          tracks.set(f.id, track);
        }
        const prior = matcher.priorFor(f.shapeId, f.routeId, f.direction);
        matcher.matchFix(track, { x: toPlane(f.lon, f.lat).x, y: toPlane(f.lon, f.lat).y, lon: f.lon, lat: f.lat, atSec: f.atSec }, prior, nextByTrip.get(f.tripId)?.stopId ?? null);
        track.speed = estimateSpeed(track.fixes, { stopsBetween: matcher.stopsBetween });
        if (track.match.pathIdx === null) directionUnknownAfterFirstFix++;
      }
      for (const track of tracks.values()) {
        const update = track.tripId ? nextByTrip.get(track.tripId) : undefined;
        buildPlan(track, net, times, update ? { stopId: update.stopId, timeSec: update.timeSec, delaySec: 0 } : null, nowSec, frame.headerSec, BANDS);
      }
      enforceOrder([...tracks.values()], net, nowSec, frame.headerSec);

      const plans = new Map<string, Plan>();
      for (const track of tracks.values()) {
        if (!track.plan || track.plan.on === 'free') continue;
        plans.set(track.id, track.plan);
        const knots = track.plan.knots;
        for (let i = 1; i < knots.length; i++) if (knots[i][1] < knots[i - 1][1] - 1e-6) reversals++;
        if (!seenFirstPlan.has(track.id)) {
          seenFirstPlan.add(track.id);
          const sNow = evalPathPlan(knots, nowSec - frame.headerSec);
          const sLater = evalPathPlan(knots, nowSec + 30 - frame.headerSec);
          if (sLater - sNow < 20) firstPlansStill++;
        }
      }
      plansByFrame.push(plans);
    }

    // Overtakes: for every pair whose truth is on the shared trunk (edge 0,
    // the first 1500 m of both paths) and more than a tram length apart, the
    // planned positions at the header must keep the truth's order.
    let overtakes = 0;
    let pairs = 0;
    sim.frames.forEach((frame, k) => {
      const plans = plansByFrame[k];
      const ids = [...plans.keys()];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const ti = tramById.get(ids[i])!.truth(frame.headerSec);
          const tj = tramById.get(ids[j])!.truth(frame.headerSec);
          if (!ti.started || !tj.started || ti.s >= 1500 || tj.s >= 1500) continue;
          if (Math.abs(ti.s - tj.s) <= HEADWAY_M) continue;
          const pi = evalPathPlan(plans.get(ids[i])!.knots as [number, number][], 0);
          const pj = evalPathPlan(plans.get(ids[j])!.knots as [number, number][], 0);
          pairs++;
          if (Math.sign(pi - pj) !== Math.sign(ti.s - tj.s)) overtakes++;
        }
      }
    });

    // Hindsight: the plan published three ticks ago, read at this header, against the truth now.
    const errors: number[] = [];
    sim.frames.forEach((frame, k) => {
      if (k < 3) return;
      const older = plansByFrame[k - 3];
      for (const [id, plan] of older) {
        const truth = tramById.get(id)!.truth(frame.headerSec);
        if (!truth.started) continue;
        // At the terminus the simulator lets trams share one point while the laws
        // queue them a tram length apart; a standing tram is not a prediction.
        if (truth.s >= net.paths[tramById.get(id)!.pathIdx].len - 1) continue;
        const predicted = evalPathPlan(plan.knots as [number, number][], frame.headerSec - sim.frames[k - 3].headerSec);
        errors.push(Math.abs(predicted - truth.s));
      }
    });
    errors.sort((a, b) => a - b);
    const p95 = errors[Math.floor(errors.length * 0.95)];
    const p50 = errors[Math.floor(errors.length * 0.5)];
    console.log(`envelope: pairs ${pairs}, overtakes ${overtakes}, reversals ${reversals}, hindsight n=${errors.length} p50 ${p50.toFixed(1)} m p95 ${p95.toFixed(1)} m, unknown direction ${directionUnknownAfterFirstFix}, still first plans ${firstPlansStill}`);

    expect(pairs).toBeGreaterThan(50);
    expect(overtakes).toBe(0);
    expect(reversals).toBe(0);
    expect(directionUnknownAfterFirstFix).toBe(0);
    expect(firstPlansStill).toBe(0);
    expect(errors.length).toBeGreaterThan(200);
    expect(p95).toBeLessThan(60);
  });
});
