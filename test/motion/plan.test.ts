import { describe, expect, it } from 'vitest';
import { createMatcher } from '../../shared/motion/match';
import { buildPlan, evalFreePlan, evalPathPlan, silenceDecay } from '../../shared/motion/plan';
import { estimateSpeed } from '../../shared/motion/speed';
import { scheduleTimes, type TimesProvider } from '../../shared/motion/times';
import { newTrack, type PlaneFix, type Track } from '../../shared/motion/track';
import type { TripIndex, TripPattern } from '../../shared/motion/trips';
import { corridorSpec, lonLatOf, syntheticNetwork } from './synthetic-network';

const net = syntheticNetwork(corridorSpec());
const matcher = createMatcher(net);
const pathIdx = (id: string) => net.paths.findIndex((p) => p.id === id);
const BANDS = { hourBand: 12, dayType: 0 as const };

function fix(x: number, y: number, atSec: number): PlaneFix {
  const { lon, lat } = lonLatOf({ x, y });
  return { x, y, lon, lat, atSec };
}

/** A timetable that says 8 m/s between stops and 20 s at each. */
const eightMs: TimesProvider = {
  segmentSeconds: (_path, fromS, toS) => (toS - fromS) / 8,
  dwellSeconds: () => 20,
};

function tramOn1(id: string, fixes: [x: number, atSec: number][]): Track {
  const track = newTrack(id, '1', `trip-${id}`, 'tram');
  const prior = matcher.priorFor('1_0', '1', 0);
  for (const [x, at] of fixes) matcher.matchFix(track, fix(x, 0, at), prior, null);
  track.speed = estimateSpeed(track.fixes);
  return track;
}

const knotsOf = (track: Track) => (track.plan && track.plan.on !== 'free' ? track.plan.knots : []);
const at = (track: Track, tSec: number, headerSec: number) => evalPathPlan(knotsOf(track), tSec - headerSec);

// The planner: from the last matched fix, to the next stop at the
// TripUpdate's time when plausible, else at own speed blended with the
// timetable; a dwell at each stop; expected times beyond; a terminus hold;
// stale evidence continues on expected times with fading confidence (D2);
// the free plane for a vehicle off every geometry.
describe('buildPlan', () => {
  it('anchors at the last fix, honours a plausible ETA, dwells, continues on expected times, holds at the terminus, fades with silence, and lerps in the free plane', () => {
    const headerSec = 1012;
    const nowSec = 1012;

    // 10 m/s northbound... eastbound on the trunk: fixes at 100 and 200 m.
    const tram = tramOn1('a', [[100, 1000], [200, 1010]]);
    expect(tram.speed).toBeCloseTo(10, 1);
    buildPlan(tram, net, eightMs, { stopId: 'T300', timeSec: 1020, delaySec: 0 }, nowSec, headerSec, BANDS);
    expect(tram.plan?.on).toBe('path');
    const knots = knotsOf(tram);
    for (let i = 1; i < knots.length; i++) {
      expect(knots[i][0]).toBeGreaterThanOrEqual(knots[i - 1][0]);
      expect(knots[i][1]).toBeGreaterThanOrEqual(knots[i - 1][1]);
    }
    expect(at(tram, 1010, headerSec)).toBeCloseTo(200, 0); // the anchor
    expect(at(tram, 980, headerSec)).toBeCloseTo(200, 0); // before the anchor: held, never invented
    expect(at(tram, 1020, headerSec)).toBeCloseTo(300, 0); // the ETA, plausible (kinematic ~11 s)
    expect(at(tram, 1035, headerSec)).toBeCloseTo(300, 0); // dwelling
    // After the 20 s dwell (departure 1040) the next 300 m run on the timetable's 8 m/s.
    expect(Math.abs(at(tram, 1050, headerSec) - 380)).toBeLessThan(2); // whole-second knots (R-TE13) shift a mid-segment reading by up to the speed x 0.5 s
    expect(at(tram, 1090, headerSec)).toBeCloseTo(600, 0); // arrival T600 at 1040 + 37.5 s = 1077.5, dwelling until 1097.5
    expect(knots[knots.length - 1][0]).toBeGreaterThanOrEqual(nowSec + 90 - headerSec);
    expect(tram.next).toMatchObject({ stopId: 'T300', s: 300, etaSec: 1020 });
    expect(tram.confidence).toBeGreaterThan(0.5);

    // An implausible ETA (5 s for 100 m at 10 m/s) is ignored for the kinematic arrival.
    const rushed = tramOn1('b', [[100, 1000], [200, 1010]]);
    buildPlan(rushed, net, eightMs, { stopId: 'T300', timeSec: 1015, delaySec: 0 }, nowSec, headerSec, BANDS);
    expect(at(rushed, 1015, headerSec)).toBeLessThan(260);
    expect(at(rushed, 1022, headerSec)).toBeCloseTo(300, 0);

    // Stale evidence (D2): the last fix is 102 s old; the plan still moves on
    // expected times and the confidence has faded but not died.
    const stale = tramOn1('c', [[100, 900], [200, 910]]);
    buildPlan(stale, net, eightMs, null, nowSec, headerSec, BANDS);
    expect(at(stale, nowSec, headerSec)).toBeGreaterThan(600);
    expect(at(stale, nowSec + 30, headerSec)).toBeGreaterThan(at(stale, nowSec, headerSec));
    expect(silenceDecay(102)).toBeCloseTo(Math.pow(0.5, (102 - 30) / 60), 3);
    expect(stale.confidence).toBeGreaterThan(0);
    expect(stale.confidence).toBeLessThan(0.5);
    expect(silenceDecay(20)).toBe(1);
    expect(silenceDecay(300)).toBe(0);

    // The terminus: path 1_0 ends at 2700 m; the plan reaches it and holds.
    const ending = tramOn1('d', [[2550, 1000], [2650, 1010]]);
    buildPlan(ending, net, eightMs, null, nowSec, headerSec, BANDS);
    expect(at(ending, nowSec + 80, headerSec)).toBeCloseTo(2700, 0);
    for (const [, s] of knotsOf(ending)) expect(s).toBeLessThanOrEqual(2700);
    expect(ending.next).toMatchObject({ stopId: 'C1200', s: 2700 }); // the terminus is itself the last stop

    // Off the graph: the free plane lerps from the previous fix to the latest
    // over their own interval, then holds; confidence never above a half.
    const lost = newTrack('e', '1', 'trip-e', 'tram');
    const prior = matcher.priorFor('1_0', '1', 0);
    matcher.matchFix(lost, fix(700, 400, 990), prior, null);
    matcher.matchFix(lost, fix(740, 420, 1000), prior, null);
    matcher.matchFix(lost, fix(780, 440, 1010), prior, null);
    expect(lost.offGraph).toBe(true);
    buildPlan(lost, net, eightMs, null, nowSec, headerSec, BANDS);
    expect(lost.plan?.on).toBe('free');
    const free = lost.plan!.on === 'free' ? lost.plan!.knots : [];
    const mid = evalFreePlan(free, 1005 - headerSec);
    const { lon: midLon, lat: midLat } = lonLatOf({ x: 760, y: 430 });
    expect(mid[0]).toBeCloseTo(midLon, 5);
    expect(mid[1]).toBeCloseTo(midLat, 5);
    const later = evalFreePlan(free, 1060 - headerSec);
    const { lon: endLon } = lonLatOf({ x: 780, y: 440 });
    expect(later[0]).toBeCloseTo(endLon, 5);
    expect(lost.confidence).toBeLessThanOrEqual(0.5);
  });

  it('reads the timetable onto path arcs: stop-to-stop seconds by hour band, a partial segment by arc share, dwell by stop', () => {
    const patterns: TripPattern[] = [
      {
        route: '1',
        direction: 0,
        shape: '1_0',
        headsign: 'C',
        stops: ['T0', 'T300', 'T600'],
        sched: Array.from({ length: 24 }, (_, band) => [band === 7 ? 45 : 30, 40]),
        dwell: [0, 15, 0],
        trips: 3,
      },
    ];
    const index: TripIndex = {
      feedVersion: 'synthetic',
      patterns,
      tripsById: new Map(),
      blocks: new Map(),
      schedSeconds: (p, i, band) => patterns[p].sched[band][i],
    };
    const times = scheduleTimes(net, index);
    const p = pathIdx('1_0');
    expect(times.segmentSeconds(p, 0, 300, 12, 0)).toBe(30);
    expect(times.segmentSeconds(p, 0, 300, 7, 0)).toBe(45);
    expect(times.segmentSeconds(p, 0, 150, 12, 0)).toBe(15);
    expect(times.segmentSeconds(p, 150, 450, 12, 0)).toBe(35); // half of 30 plus half of 40
    expect(times.segmentSeconds(p, 600, 900, 12, 0)).toBeNull(); // beyond the pattern's last stop: unknown
    expect(times.dwellSeconds('T300', 12, 0)).toBe(15);
    expect(times.dwellSeconds('T0', 12, 0)).toBe(0);
    expect(times.dwellSeconds('nowhere', 12, 0)).toBeNull();
    expect(times.segmentSeconds(pathIdx('2_0'), 0, 300, 12, 0)).toBeNull(); // no pattern on that path
  });
});
