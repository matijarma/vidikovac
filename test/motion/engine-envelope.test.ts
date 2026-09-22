import { describe, expect, it } from 'vitest';
import { toPlane } from '../../shared/motion/geo';
import { enforceOrder, HEADWAY_M } from '../../shared/motion/order';
import { createMatcher } from '../../shared/motion/match';
import { buildPlan, evalPathPlan, SILENCE_HOLD_S } from '../../shared/motion/plan';
import { estimateSpeed } from '../../shared/motion/speed';
import type { TimesProvider } from '../../shared/motion/times';
import { lastFix, newTrack, type Plan, type Track } from '../../shared/motion/track';
import { simulate } from './simulator';
import { corridorSpec, syntheticNetwork } from './synthetic-network';

// The engine over twenty simulated minutes: six trams alternating between
// route 1 (east) and route 2 (north) share the trunk, with GPS noise, a
// two-in-three refresh per tick and 2 to 25 s of latency. What a viewer must
// never see: an overtake on the shared track, a tram running backwards, a
// tram whose direction is unknown after its first fix, or a first plan that
// stands still.
//
// The accuracy pin moved with F11. The planner is now late BY DESIGN -- it
// books stretches and dwells at a quantile, holds a tram it cannot prove has
// left its platform, and refuses a TripUpdate's "you have departed" about the
// very next stop -- so the UNSIGNED p95 over this perfectly punctual
// simulated fleet grew from 50 m to 89 m. That is the error moving to the
// side the round wants it on, not the engine getting worse: the plans 50 m or
// more AHEAD of their tram fell from 9 of 224 to 5, and the signed p95 (the
// ahead tail) from 40 m to 30 m. Those two are what this test now pins,
// because "a mark ahead that has to come back reads as a broken app" is the
// failure the round forbids and "a mark behind reads as GPS lag" is not.
//
// T8 splits the fleet. A tram whose newest fix is more than SILENCE_HOLD_S
// old when its plan is made is held at its next stop, so that plan sits
// behind a punctual tram by design: here about one plan in six, since the
// simulator's 2 to 25 s latency is harsher than ZET's (about one tram tick in
// eleven carries a fix that old on Monday 21 Sep). Such a plan must never be
// ahead of its tram; the unsigned bound is the moving fleet's, where T8
// changes nothing.
describe('the engine on the corridor (20 min, 6 trams)', () => {
  it('keeps order on the shared trunk, never reverses, knows every direction from the first fix, moves from the first plan, and keeps its 30 s error behind the tram', () => {
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
    /** Per frame, the trams whose plan was made silent (T8). */
    const silentByFrame: Set<string>[] = [];
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
      const silent = new Set<string>();
      for (const track of tracks.values()) {
        if (!track.plan || track.plan.on === 'free') continue;
        const fix = lastFix(track);
        if (fix && nowSec - fix.atSec > SILENCE_HOLD_S) silent.add(track.id);
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
      silentByFrame.push(silent);
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

    // Hindsight: the plan published three ticks ago, read at this header,
    // against the truth now -- unsigned, and signed (plan minus truth, so
    // positive is the plan AHEAD of the tram).
    const errors: number[] = [];
    const signed: number[] = [];
    const movingErrors: number[] = [];
    const silentSigned: number[] = [];
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
        signed.push(predicted - truth.s);
        if (silentByFrame[k - 3].has(id)) silentSigned.push(predicted - truth.s);
        else movingErrors.push(Math.abs(predicted - truth.s));
      }
    });
    errors.sort((a, b) => a - b);
    signed.sort((a, b) => a - b);
    movingErrors.sort((a, b) => a - b);
    const p95 = errors[Math.floor(errors.length * 0.95)];
    const movingP95 = movingErrors[Math.floor(movingErrors.length * 0.95)];
    const silentAheadBy50 = silentSigned.filter((d) => d >= 50).length;
    const p50 = errors[Math.floor(errors.length * 0.5)];
    const signedP95 = signed[Math.floor(signed.length * 0.95)];
    const aheadBy50 = signed.filter((d) => d >= 50).length;
    const behindBy50 = signed.filter((d) => d <= -50).length;
    console.log(
      `envelope: pairs ${pairs}, overtakes ${overtakes}, reversals ${reversals}, hindsight n=${errors.length} p50 ${p50.toFixed(1)} m p95 ${p95.toFixed(1)} m, ` +
        `signed p95 ${signedP95.toFixed(1)} m, ahead>=50 m ${aheadBy50}, behind>=50 m ${behindBy50}, unknown direction ${directionUnknownAfterFirstFix}, still first plans ${firstPlansStill}, ` +
        `moving p95 ${movingP95.toFixed(1)} m (n=${movingErrors.length}), silent n=${silentSigned.length} ahead>=50 m ${silentAheadBy50}`,
    );

    expect(pairs).toBeGreaterThan(50);
    expect(overtakes).toBe(0);
    expect(reversals).toBe(0);
    expect(directionUnknownAfterFirstFix).toBe(0);
    expect(firstPlansStill).toBe(0);
    expect(errors.length).toBeGreaterThan(200);
    // The round's own bound: the plan may be late, it may not be early.
    expect(aheadBy50).toBeLessThanOrEqual(6); // 9 before F11
    expect(signedP95).toBeLessThanOrEqual(40); // 40 before F11
    expect(behindBy50).toBeGreaterThan(aheadBy50); // the error sits on the side that reads as GPS lag
    // A silent tram's plan (T8) is held behind, never ahead.
    expect(silentSigned.length).toBeGreaterThan(0);
    expect(silentAheadBy50).toBe(0);
    // And the moving fleet's unsigned error stays inside a stop spacing's third either way.
    expect(movingErrors.length).toBeGreaterThan(150);
    expect(movingP95).toBeLessThan(100);
  });
});
