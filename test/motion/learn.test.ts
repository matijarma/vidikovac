import { describe, expect, it } from 'vitest';
import {
  addSample,
  edgeKey,
  emptyAggregates,
  emptyHistogram,
  extractEvidence,
  histogramCount,
  histogramMedian,
  mergeHistograms,
  parseHistogram,
  recordEvidence,
  serializeHistogram,
  stopKey,
} from '../../shared/motion/learn';
import { LEARN_MIN_SAMPLES, learnedTimes, scheduleTimes, zagrebBands } from '../../shared/motion/times';
import { newTrack, type PlaneFix } from '../../shared/motion/track';
import { createEngine } from '../../worker/twin/engine';
import { emptyState } from '../../worker/twin/state';
import { runTick } from '../../worker/twin/tick';
import { corridorIndex, corridorJoins, frameAsFeed } from '../twin/engine-fixture';
import { simulate } from './simulator';
import { corridorSpec, syntheticNetwork } from './synthetic-network';

// C1: what the twin learns from the fixes it matches, and how the planner
// hears it. Seventy-two trams forty seconds apart run the corridor for an
// hour at 10 m/s with 20 s at every platform, while the timetable the twin
// was handed says twice that: after the run the learned edge medians sit
// near the cruise, the learned dwell near the platform time, the wrapper
// answers with them where the band is thick and with the timetable where
// it is thin, no edge or dwell is counted twice across ticks, a pair from
// inside a stop zone teaches nothing, a dwell is priced only off travel the
// learner can trust, and a histogram survives the SQLite round trip.
//
// The fleet grew with F11. A dwell sample now needs a STATIONARY PAIR inside
// the stop zone -- two fixes the vehicle did not move between -- and at a
// two-in-three refresh a 20 s dwell often leaves only one fix in the zone,
// so the old run of 24 trams over half an hour left every platform with
// fewer than LEARN_MIN_SAMPLES. The trams-per-platform density (one every
// 400 m) is the same; there are simply more of them, for longer.
describe('learning from the corridor', () => {
  const net = syntheticNetwork(corridorSpec());
  const start = 1_800_000_000;
  const { hourBand, dayType } = zagrebBands(start);
  const routes = { '1': { shortName: '1', longName: 'Trunk east', type: 0 }, '2': { shortName: '2', longName: 'Trunk north', type: 0 } };

  it('learns edge times near the cruise and dwell near the platform time, counts nothing twice, and the wrapper prefers learned medians where they are thick', () => {
    const sim = simulate(net, ['1_0', '2_0'], {
      trams: 72,
      headwaySec: 40,
      cruiseMs: 10,
      dwellSec: 20,
      noiseM: 8,
      refreshP: 2 / 3,
      latencyMinSec: 2,
      latencyMaxSec: 25,
      tickSec: 10,
      durationSec: 3600,
      seed: 5,
      startSec: start,
    });
    // A timetable twice as slow as the trams really run: what the planner believes before it learns.
    const index = corridorIndex(net, sim.trams.map((t) => ({ tripId: t.tripId, pathId: t.shapeId })));
    for (const pattern of index.patterns) pattern.sched = pattern.sched.map((row) => row.map((s) => s * 2));
    const learned = emptyAggregates();
    const engine = createEngine(net, index, learned);
    const joins = corridorJoins(sim);
    let state = emptyState();
    let edgeSamples = 0;
    let dwellSamples = 0;
    for (const frame of sim.frames) {
      const result = runTick({ state, feed: frameAsFeed(frame, sim), nowMs: (frame.headerSec + 2) * 1000, joins, routes, engine, validUntilMs: 0 });
      state = result.state;
      recordEvidence(learned, result.learned); // what the Durable Object does with every tick's evidence
      edgeSamples += result.learned.edges.length;
      dwellSamples += result.learned.dwells.length;
    }
    expect(edgeSamples).toBeGreaterThan(10);
    expect(dwellSamples).toBeGreaterThan(10);

    // Edge 0 is the 1500 m trunk (150 s at 10 m/s), edge 1 the 1200 m eastern branch (120 s).
    const e0 = histogramMedian(learned.edges[edgeKey(0, hourBand, dayType)]!)!;
    expect(e0).toBeGreaterThan(150 * 0.85);
    expect(e0).toBeLessThan(150 * 1.15);
    const e1 = histogramMedian(learned.edges[edgeKey(1, hourBand, dayType)]!)!;
    expect(e1).toBeGreaterThan(120 * 0.85);
    expect(e1).toBeLessThan(120 * 1.15);
    // Every tram stood 20 s at T600; the histogram's bin around 20 s reads 18.7.
    const stood = learned.stops[stopKey('T600', hourBand, dayType)]!;
    expect(histogramCount(stood)).toBeGreaterThanOrEqual(LEARN_MIN_SAMPLES);
    const dwell = histogramMedian(stood)!;
    expect(dwell).toBeGreaterThan(20 * 0.8);
    expect(dwell).toBeLessThan(20 * 1.25);

    // Nothing twice: the tracks remember what was already extracted.
    for (const track of Object.values(state.tracks)) {
      const again = extractEvidence(net, track, state.learnedUpTo[track.id] ?? Number.NEGATIVE_INFINITY, () => 20);
      expect(again.edges).toHaveLength(0);
      expect(again.dwells).toHaveLength(0);
    }

    // The wrapper: the learned trunk where the band is thick, the slow timetable where nobody has driven.
    const schedule = scheduleTimes(net, index);
    const times = learnedTimes(schedule, learned, net);
    const p = net.paths.findIndex((path) => path.id === '1_0');
    expect(schedule.segmentSeconds(p, 0, 1500, hourBand, dayType)).toBeCloseTo(300, 5); // four pairs of 60 s plus half of a 600 m pair
    const heard = times.segmentSeconds(p, 0, 1500, hourBand, dayType)!;
    expect(heard).toBeGreaterThan(120);
    expect(heard).toBeLessThan(200);
    expect(times.dwellSeconds('T600', hourBand, dayType)).toBeCloseTo(dwell, 5);
    const quiet = (hourBand + 12) % 24;
    expect(times.segmentSeconds(p, 0, 1500, quiet, dayType)).toBeCloseTo(300, 5);
    expect(times.dwellSeconds('T600', quiet, dayType)).toBe(20);
  });

  it('learns cruise only from clean pairs with no platform between them, prices a dwell only off travel it can trust, and a histogram survives serialisation and merging', () => {
    // Path 2_0 runs edges 0 and 2; edge 2 spans arcs 1500..2724.85 with stops D300, D600, D900 at 1800, 2100, 2400.
    const p = net.paths.findIndex((path) => path.id === '2_0');
    const fixAt = (s: number, atSec: number, atStop: boolean): PlaneFix => ({ x: 0, y: 0, lon: 0, lat: 0, atSec, arc: { key: `p${p}`, s, atStop } });
    const clean = newTrack('clean', '2', 't', 'tram');
    clean.fixes = [fixAt(1850, 1000, false), fixAt(2050, 1020, false)];
    const evidence = extractEvidence(net, clean, Number.NEGATIVE_INFINITY, () => 20);
    expect(evidence.edges.map((e) => e.edge)).toEqual([2]);
    expect(evidence.edges[0].seconds).toBeCloseTo(net.edges[2].len / 10, 1); // 200 m in 20 s: the whole edge at 10 m/s
    expect(evidence.upTo).toBe(1020);

    const fromPlatform = newTrack('platform', '2', 't', 'tram');
    fromPlatform.fixes = [fixAt(1810, 1000, true), fixAt(2050, 1024, false)];
    expect(extractEvidence(net, fromPlatform, Number.NEGATIVE_INFINITY, () => 20).edges).toHaveLength(0);
    const acrossStop = newTrack('across', '2', 't', 'tram');
    acrossStop.fixes = [fixAt(1850, 1000, false), fixAt(2150, 1030, false)]; // D600 at 2100 lies between: an unknown dwell inside
    expect(extractEvidence(net, acrossStop, Number.NEGATIVE_INFINITY, () => 20).edges).toHaveLength(0);

    // A stand at D300 (zone 1760..1840) between clean fixes: one 40 m pair is too short a baseline to price
    // the travel, so it teaches no dwell; the fleet's learned edge prices it, and 34 s less 12 s of travel stood.
    // F11: the two fixes at 1800 and 1802 are the STATIONARY PAIR the sample now needs -- without them the
    // interval would be the same and the tram might simply have crossed the zone between two reports.
    const stood = newTrack('stood', '2', 't', 'tram');
    stood.fixes = [fixAt(1700, 1000, false), fixAt(1740, 1004, false), fixAt(1800, 1012, true), fixAt(1802, 1022, true), fixAt(1860, 1038, false)];
    expect(extractEvidence(net, stood, Number.NEGATIVE_INFINITY, () => 20).dwells).toHaveLength(0);
    const priced = extractEvidence(net, stood, Number.NEGATIVE_INFINITY, () => 20, (_path, fromS, toS) => (toS - fromS) / 10);
    expect(priced.dwells).toEqual([{ stopId: 'D300', seconds: expect.closeTo(22, 5), atSec: 1038 }]);

    // F11, the other half of the same rule: a PASS-THROUGH writes no dwell sample. The same clean bounds,
    // the same interval, but every fix inside D300's zone moved more than the dead zone, so the tram never
    // stood -- and before the check the learner wrote whatever the interval exceeded the travel by, which is
    // how a platform nobody stands at grew a standing time (D1).
    const passing = newTrack('passing', '2', 't', 'tram');
    passing.fixes = [fixAt(1700, 1000, false), fixAt(1770, 1007, true), fixAt(1830, 1013, true), fixAt(1900, 1020, false)];
    expect(extractEvidence(net, passing, Number.NEGATIVE_INFINITY, () => 20, (_path, fromS, toS) => (toS - fromS) / 10).dwells).toHaveLength(0);

    const h = emptyHistogram();
    addSample(h, 30);
    addSample(h, 45);
    addSample(h, 2000); // beyond the range: the top bin, never lost
    const back = parseHistogram(serializeHistogram(h));
    expect(back).toEqual(h);
    const merged = mergeHistograms(h, back);
    expect(histogramCount(merged)).toBe(6);
    expect(histogramMedian(merged)).toBeGreaterThan(30);
    expect(histogramMedian(merged)).toBeLessThan(60);
    expect(histogramMedian(emptyHistogram())).toBeNull();
  });
});
