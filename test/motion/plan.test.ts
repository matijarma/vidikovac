import { describe, expect, it } from 'vitest';
import { createMatcher } from '../../shared/motion/match';
import { buildPlan, evalFreePlan, evalPathPlan, silenceDecay } from '../../shared/motion/plan';
import { serviceDayStartSec } from '../../shared/motion/bands';
import { createBranchTable } from '../../shared/motion/branches';
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
// a silent vehicle held at its next stop while its confidence fades (T8);
// the free plane for a vehicle off every geometry.
describe('buildPlan', () => {
  it('uses the published decimetre anchor for the silent platform boundary', () => {
    for (const x of [340, 340.037, 340.049]) {
      const tram = tramOn1(`boundary-${x}`, [[280, 1000], [x, 1010]]);
      buildPlan(tram, net, eightMs, null, 1050, 1050, BANDS);
      expect(tram.next?.stopId).toBe('T300');
      for (const [, s] of knotsOf(tram)) expect(s).toBe(340);
    }
    // One decimetre beyond the zone is genuinely on the next stretch.
    const beyond = tramOn1('beyond-boundary', [[280, 1000], [340.06, 1010]]);
    buildPlan(beyond, net, eightMs, null, 1050, 1050, BANDS);
    expect(beyond.next?.stopId).toBe('T600');
    expect(knotsOf(beyond).at(-1)?.[1]).toBe(600);
  });

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

    // Silence (T8): the last fix is 102 s old. The plan reaches the next stop
    // (T300) and is flat there to the horizon, never past it; the confidence
    // has faded linearly (whole to 30 s, 0 at 180 s) but not died.
    const stale = tramOn1('c', [[100, 900], [200, 910]]);
    buildPlan(stale, net, eightMs, null, nowSec, headerSec, BANDS);
    expect(at(stale, nowSec, headerSec)).toBeCloseTo(300, 0);
    expect(at(stale, nowSec + 30, headerSec)).toBe(at(stale, nowSec, headerSec));
    expect(at(stale, nowSec + 90, headerSec)).toBe(at(stale, nowSec, headerSec));
    for (const [, s] of knotsOf(stale)) expect(s).toBeLessThanOrEqual(300);
    expect(stale.next).toMatchObject({ stopId: 'T300', s: 300 });
    expect(silenceDecay(102)).toBeCloseTo(1 - 72 / 150, 3);
    expect(stale.confidence).toBeCloseTo(0.9 * (1 - 72 / 150), 3);
    expect(stale.confidence).toBeGreaterThan(0);
    expect(stale.confidence).toBeLessThan(0.5);
    expect(silenceDecay(20)).toBe(1);
    expect(silenceDecay(30)).toBe(1);
    expect(silenceDecay(105)).toBeCloseTo(0.5, 6);
    expect(silenceDecay(180)).toBe(0);
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

  // T8: a vehicle silent for more than 30 s is held at its next stop and never
  // planned past it -- wherever it was last seen: running, at a platform the
  // dwell history reads as already left, or standing off every platform.
  it('holds a silent tram at its next stop: after a run, at the platform it was leaving, and where it stood', () => {
    const headerSec = 2000;
    const nowSec = 2000;
    const flat = (track: Track, s: number) => {
      for (const dt of [0, 30, 60, 90]) expect(at(track, nowSec + dt, headerSec), `at +${dt} s`).toBeCloseTo(s, 1);
      for (const [, ks] of knotsOf(track)) expect(ks).toBeLessThanOrEqual(s + 0.05);
    };

    // 45 s silent, running at 10 m/s, 100 m before T600: the plan reaches 600 and holds.
    const running = tramOn1('silent-run', [[400, nowSec - 55], [500, nowSec - 45]]);
    buildPlan(running, net, eightMs, null, nowSec, headerSec, BANDS);
    flat(running, 600);
    expect(running.next?.stopId).toBe('T600');
    expect(running.confidence).toBeCloseTo(0.9 * (1 - 15 / 150), 3);
    // The same tram 25 s after its last fix is not silent yet: it dwells at T600 and runs on.
    const fresh = tramOn1('fresh-run', [[400, nowSec - 35], [500, nowSec - 25]]);
    buildPlan(fresh, net, eightMs, null, nowSec, headerSec, BANDS);
    expect(at(fresh, nowSec + 60, headerSec)).toBeGreaterThan(600);
    expect(fresh.confidence).toBeCloseTo(0.9, 6);

    // 45 s silent, last seen 20 m past T300 and moving: the dwell history
    // says it has left (dwellRemaining null), but the hold does not ask it.
    // It stays where it was seen, in T300's zone, never run on to T600 and
    // never drawn back to the stop point.
    const leaving = tramOn1('silent-leave', [[280, nowSec - 55], [320, nowSec - 45]]);
    buildPlan(leaving, net, eightMs, null, nowSec, headerSec, BANDS);
    flat(leaving, 320);
    expect(leaving.next?.stopId).toBe('T300');

    // The same, but the last published plan had already drawn it at 350 m:
    // the floor lifts the anchor out of T300's zone, and the platform is
    // still read off the observed fix. Held at the floor, never run on to
    // T600, never drawn back.
    const floored = tramOn1('silent-floor', [[290, nowSec - 55], [330, nowSec - 45]]);
    buildPlan(floored, net, eightMs, null, nowSec, headerSec, BANDS, { publishedArcS: 350 });
    expect(knotsOf(floored)[0][1]).toBeCloseTo(350, 1); // the floor did apply
    flat(floored, 350);
    expect(floored.next?.stopId).toBe('T300');

    // 45 s silent, last seen standing between T300 and T600: it stays there;
    // the next stop is still T600, with no planned time since the plan does not reach it.
    const stood = tramOn1('silent-stand', [[440, nowSec - 65], [450, nowSec - 55], [452, nowSec - 45]]);
    buildPlan(stood, net, eightMs, null, nowSec, headerSec, BANDS);
    flat(stood, 452);
    expect(stood.next).toMatchObject({ stopId: 'T600', etaSec: null });
  });

  // F8: the plan books a dwell only where the line actually calls. The trunk
  // carries W750 (the westbound platform of the same place) and X750 (the
  // platform only route 2 calls at); both lie on path 1_0's edges and neither
  // is in its served list, so no plan of route 1 may stand at either.
  it('books no dwell at a phantom platform on the shared trunk', () => {
    const headerSec = 1012;
    // The last fix sits at 740 m -- inside the 40 m stop zone of both
    // phantoms and clear of every platform route 1 calls at.
    const tram = tramOn1('phantom', [[640, 1000], [740, 1010]]);
    buildPlan(tram, net, eightMs, null, headerSec, headerSec, BANDS);
    const knots = knotsOf(tram);
    const dwellArcs: number[] = [];
    for (let i = 1; i < knots.length; i++) {
      if (knots[i][0] > knots[i - 1][0] && Math.abs(knots[i][1] - knots[i - 1][1]) < 0.01) dwellArcs.push(knots[i][1]);
    }
    expect(dwellArcs.some((s) => Math.abs(s - 900) < 1)).toBe(true); // T900, which route 1 does call at
    for (const s of dwellArcs) expect(Math.abs(s - 750), `a dwell at arc ${s}, beside the phantom platforms`).toBeGreaterThan(40);
    // And the stop it aims at past 600 m is T900, never one of the phantoms.
    expect(tram.next?.stopId).toBe('T900');
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

describe('buildPlan holds a diverted tram at the next branch of its line (rail round 2)', () => {
  // The diversion corridor of the matcher's tests: the own path runs the
  // trunk east, variant A turns north at x = 1500. A tram the matcher names
  // diverted (TramTrack.diverted), placed on variant A while still on the
  // trunk, has an unknown way ahead of the branch: the plan runs to it and
  // holds there until a fix says which way it went (line 11 on Sunday
  // 20 Sep: the plan ran on along each depot variant past the junction
  // while the tram turned, a 100 to 400 m correction). The same tram
  // without the flag, or past the branch, is planned as before.
  const corridor = syntheticNetwork({
    edges: [
      { from: 0, to: 1, pts: [{ x: 0, y: 0 }, { x: 1500, y: 0 }] },
      { from: 1, to: 2, pts: [{ x: 1500, y: 0 }, { x: 2700, y: 0 }] },
      { from: 1, to: 3, pts: [{ x: 1500, y: 0 }, { x: 1500, y: 1200 }] },
    ],
    routes: [{ id: '11', type: 0, paths: [
      { id: 'own', direction: 0, edges: [0, 1], served: ['S1450'] },
      { id: 'variantA', direction: 0, edges: [0, 2], served: ['S1450'] },
    ] }],
    stops: [{ id: 'S1450', edge: 0, s: 1450 }],
  });
  const m = createMatcher(corridor);
  const branches = createBranchTable(corridor);
  const onVariantA = (id: string, diverted: boolean): Track => {
    const t = newTrack(id, '11', 'trip', 'tram');
    const p = m.priorFor('variantA', '11', 0);
    for (const [x, at] of [[1200, 1000], [1300, 1010], [1400, 1020]] as const) m.matchFix(t, fix(x, 0, at), p, null);
    t.speed = estimateSpeed(t.fixes);
    if (diverted) (t as { diverted?: true }).diverted = true;
    return t;
  };

  it('runs to the branch and holds there, the platform before it still booked', () => {
    const t = onVariantA('diverted', true);
    buildPlan(t, corridor, eightMs, null, 1022, 1022, BANDS, { branches });
    const knots = knotsOf(t);
    expect(Math.max(...knots.map(([, s]) => s))).toBe(1500);
    expect(knots.at(-1)).toEqual([90, 1500]);
    expect(t.next?.stopId).toBe('S1450');
    expect(at(t, 1112, 1022)).toBe(1500);
  });

  it('plans the same tram without the flag, or without a branch table, past the branch', () => {
    const plain = onVariantA('plain', false);
    buildPlan(plain, corridor, eightMs, null, 1022, 1022, BANDS, { branches });
    expect(Math.max(...knotsOf(plain).map(([, s]) => s))).toBeGreaterThan(1500);
    const noTable = onVariantA('no-table', true);
    buildPlan(noTable, corridor, eightMs, null, 1022, 1022, BANDS);
    expect(Math.max(...knotsOf(noTable).map(([, s]) => s))).toBeGreaterThan(1500);
  });

  it('plans a diverted tram past the last branch to the path\'s end as before', () => {
    const t = newTrack('past-branch', '11', 'trip', 'tram');
    const p = m.priorFor('variantA', '11', 0);
    for (const [y, at] of [[100, 1000], [200, 1010], [300, 1020]] as const) m.matchFix(t, fix(1500, y, at), p, null);
    t.speed = estimateSpeed(t.fixes);
    (t as { diverted?: true }).diverted = true;
    buildPlan(t, corridor, eightMs, null, 1022, 1022, BANDS, { branches });
    expect(Math.max(...knotsOf(t).map(([, s]) => s))).toBeGreaterThan(1800);
  });
});

describe('buildPlan names one next stop per visit (rail round 3)', () => {
  // The wall carries a tracked tram as "sada" while the wire names the
  // place's platform as its next stop; a next stop that moves past the
  // platform and comes back makes the row vanish and return (lane W fix10's
  // residual). The tram's own next stop is the platform whose zone its anchor
  // lies in, whether it stands there or is read moving past the stop point,
  // and it never moves back along the path within a trip unless the anchor
  // itself moved back beyond a stop zone.
  it('keeps the platform as the next stop while the anchor is in its zone, moving or not', () => {
    // 35 m past T600's point, moving at 8 m/s (the dwell history says it has left).
    const moving = tramOn1('past-the-point', [[520, 1000], [600, 1010], [635, 1015]]);
    buildPlan(moving, net, eightMs, null, 1017, 1017, BANDS);
    expect(moving.next?.stopId).toBe('T600');
    expect(moving.next?.etaSec).toBe(1015);
    expect(at(moving, 1040, 1017)).toBeGreaterThan(700); // the plan itself runs on
    // 45 m past the point: beyond the zone, the next stop is T900.
    const beyond = tramOn1('beyond-the-zone', [[530, 1000], [610, 1010], [645, 1015]]);
    buildPlan(beyond, net, eightMs, null, 1017, 1017, BANDS);
    expect(beyond.next?.stopId).toBe('T900');
  });

  it('does not move the next stop back to a platform the anchor scattered around the edge of', () => {
    const tram = tramOn1('scatter', [[560, 1000], [645, 1010]]);
    buildPlan(tram, net, eightMs, null, 1012, 1012, BANDS);
    expect(tram.next?.stopId).toBe('T900');
    // The next fix reads 8 m back, inside T600's zone again: the wire keeps T900.
    matcher.matchFix(tram, fix(637, 0, 1020), matcher.priorFor('1_0', '1', 0), null);
    tram.speed = estimateSpeed(tram.fixes);
    buildPlan(tram, net, eightMs, null, 1022, 1022, BANDS);
    expect(tram.next?.stopId).toBe('T900');
    // A fix a whole zone further back is a real reversal (or another tram's fix under this id): the platform is named again.
    matcher.matchFix(tram, fix(590, 0, 1030), matcher.priorFor('1_0', '1', 0), null);
    tram.speed = estimateSpeed(tram.fixes);
    buildPlan(tram, net, eightMs, null, 1032, 1032, BANDS);
    expect(tram.next?.stopId).toBe('T600');
  });
});

describe('buildPlan keeps the later next stop through a T8 hold inside a zone the tram had left (rail round 3)', () => {
  it('holds the silent tram where it stood and still names the platform ahead', () => {
    // 467 at the Mihaljevac loop stand, 20 Sep 02:07: named the departure
    // platform with the anchor past the arrival platform's zone, then a fix
    // 8 m back inside the zone and 33 s of silence named the arrival platform
    // again. The hold stays at the fix; the name does not go back.
    const tram = tramOn1('silent-in-zone', [[560, 1000], [645, 1010]]);
    buildPlan(tram, net, eightMs, null, 1012, 1012, BANDS);
    expect(tram.next?.stopId).toBe('T900');
    matcher.matchFix(tram, fix(637, 0, 1020), matcher.priorFor('1_0', '1', 0), null);
    tram.speed = estimateSpeed(tram.fixes);
    buildPlan(tram, net, eightMs, null, 1022, 1022, BANDS);
    expect(tram.next?.stopId).toBe('T900');
    buildPlan(tram, net, eightMs, null, 1060, 1060, BANDS); // 40 s silent: held at 637, in T600's zone
    for (const [, s] of knotsOf(tram)) expect(s).toBeLessThanOrEqual(637.05);
    expect(tram.next?.stopId).toBe('T900');
  });
});

describe('buildPlan names the first platform ahead when the horizon does not reach it (rail round 3)', () => {
  // 101007 standing 112 m short of Šubićeva, 21 Sep 08:43:54: a 40 s stand
  // hold and a learned junction wait ahead ate the 90 s horizon, the plan
  // named no platform for a tick and ZET's stop behind went on the wire.
  const junction = (waitSec: number) => ({ aheadOf: (_pathIdx: number, s: number) => (s < 150 ? [{ s: 150, waitSec }] : []) });

  it('names it without a time, and with the plan\'s arrival when the plan reaches it', () => {
    const tram = tramOn1('short-horizon', [[100, 1000], [100, 1045]]);
    buildPlan(tram, net, eightMs, null, 1045, 1045, BANDS, { junctions: junction(60) });
    for (const [, s] of knotsOf(tram)) expect(s).toBeLessThanOrEqual(150.05);
    expect(tram.next).toEqual({ stopId: 'T300', s: 300, etaSec: null });
    const reached = tramOn1('reaches', [[100, 1000], [100, 1045]]);
    buildPlan(reached, net, eightMs, null, 1045, 1045, BANDS, { junctions: junction(10) });
    expect(reached.next?.stopId).toBe('T300');
    expect(typeof reached.next?.etaSec).toBe('number');
  });

  it('names nothing for a diverted tram held at a branch short of the platform', () => {
    const tram = tramOn1('branch', [[100, 1000], [100, 1045]]);
    (tram as { diverted?: true }).diverted = true;
    buildPlan(tram, net, eightMs, null, 1045, 1045, BANDS, { branches: { aheadOf: () => 150 } });
    expect(tram.next).toBeNull();
  });
});
