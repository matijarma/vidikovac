import { describe, expect, it } from 'vitest';
import { createMatcher } from '../../shared/motion/match';
import { buildPlan, evalFreePlan, evalPathPlan, silenceDecay } from '../../shared/motion/plan';
import { serviceDayStartSec } from '../../shared/motion/bands';
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

    // An implausible ETA (4 s for 100 m at 10 m/s, outside the [0.5x, 2x] band) is ignored for the kinematic arrival.
    const rushed = tramOn1('b', [[100, 1000], [200, 1010]]);
    buildPlan(rushed, net, eightMs, { stopId: 'T300', timeSec: 1014, delaySec: 0 }, nowSec, headerSec, BANDS);
    expect(at(rushed, 1014, headerSec)).toBeLessThan(260);
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
    expect(times.dwellSeconds('T0', 12, 0)).toBeNull(); // R-TE34: a timetable dwell of 0 is unknown, not zero
    expect(times.dwellSeconds('nowhere', 12, 0)).toBeNull();
    expect(times.segmentSeconds(pathIdx('2_0'), 0, 300, 12, 0)).toBeNull(); // no pattern on that path

    // R-TE34: ZET writes arrival = departure at intermediate stops, so the
    // stop's real standing time hides inside the segment that arrives at it.
    // The planner's default dwell is booked out of that segment (never below a
    // third of it) and the stop reads as unknown; a terminus is left alone.
    const folded = scheduleTimes(net, { ...index, patterns: [{ ...patterns[0], dwell: [0, 0, 0] }] });
    expect(folded.segmentSeconds(p, 0, 300, 12, 0)).toBe(10); // 30 - 20
    expect(folded.segmentSeconds(p, 0, 300, 7, 0)).toBe(25); // 45 - 20
    expect(folded.segmentSeconds(p, 300, 600, 12, 0)).toBe(40); // into the terminus: untouched
    expect(folded.dwellSeconds('T300', 12, 0)).toBeNull();
  });
});

// The vehicle's own state decides the first stretch (R-TE46 to R-TE49): a
// cruising tram keeps its speed before the timetable takes over, a tram
// standing off any platform is expected to stand a while longer, a stand
// already past the dwell ends a tick from now rather than this instant, and
// a trip that has not started waits for its first departure.
describe('buildPlan reads the vehicle state', () => {
  it('holds own speed on the first stretch, holds a stand away from stops, extends a stand past the dwell, and waits for the trip start', () => {
    // (a) 10 m/s between T300 and T600 (both fixes clear of the stop zones): the next 10 s run at that speed, not at the timetable's 8 m/s.
    const cruising = tramOn1('cr', [[350, 1000], [450, 1010]]);
    buildPlan(cruising, net, eightMs, null, 1012, 1012, BANDS);
    expect(at(cruising, 1020, 1012) - at(cruising, 1010, 1012)).toBeGreaterThanOrEqual(98);

    // (a') both fixes inside T300's stop zone and 40 m apart in 10 s: no clean
    // interval, so the vehicle's own pace (4 m/s) runs the first stretch, not the timetable's 8.
    const pacing = tramOn1('pc', [[280, 1000], [320, 1010]]);
    expect(pacing.speed).toBeCloseTo(4, 1);
    buildPlan(pacing, net, eightMs, null, 1012, 1012, BANDS);
    expect(Math.abs(at(pacing, 1020, 1012) - 360)).toBeLessThan(3);

    // (b) 20 s standing at x = 450, no platform within 40 m: it stands as long again before moving.
    const standing = tramOn1('st', [[450, 1000], [450, 1010], [450, 1020]]);
    buildPlan(standing, net, eightMs, null, 1022, 1022, BANDS);
    expect(at(standing, 1039, 1022)).toBeCloseTo(450, 0);
    expect(at(standing, 1080, 1022)).toBeGreaterThan(450);

    // (c) at platform T600 for 40 s, twice the dwell: departure is a tick away, not now.
    const held = tramOn1('hd', [[600, 1000], [600, 1010], [600, 1020], [600, 1030], [600, 1040]]);
    buildPlan(held, net, eightMs, null, 1042, 1042, BANDS);
    expect(at(held, 1050, 1042)).toBeCloseTo(600, 0);
    expect(at(held, 1075, 1042)).toBeGreaterThan(600);

    // (d) at the terminus T0 with a trip scheduled to start at 1060 and 30 s late: the plan waits until 1090.
    const early = tramOn1('ea', [[0, 1000], [0, 1010]]);
    early.tripStartSec = 1060;
    buildPlan(early, net, eightMs, { stopId: 'T0', timeSec: null, delaySec: 30 }, 1012, 1012, BANDS);
    expect(at(early, 1085, 1012)).toBeCloseTo(0, 0);
    expect(at(early, 1101, 1012)).toBeGreaterThan(50);
    // The service day a realtime startDate names begins at Zagreb midnight (CEST on this date).
    expect(serviceDayStartSec('20260916')).toBe(Date.UTC(2026, 8, 15, 22) / 1000);
  });
});
