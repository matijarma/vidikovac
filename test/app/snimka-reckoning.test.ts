// The numbers of Što se vidjelo and the hero (app/src/snimka/reckoning.ts),
// each on a synthetic series whose answer is known by construction: a
// missing minute counts for nothing, a function that finds nothing says so
// (null), never a zero it did not see. The last block reads the e2e fixture's
// strike outline end to end through the hero tiles.
import { describe, expect, it } from 'vitest';
import { SNIMKA_COMPARISON, SNIMKA_WINDOW, type Col, type ScreenIndex, type SeriesFile, type SnimkaState } from '../../shared/snimka';
import {
  FROZEN_AFTER_S, bikeDrain, feedHealth, ghostInflation, heroTiles, longestSilent, midnightOf, minutesText, peakAt0745, returnDuration, sentenceFamilies, silentMinutes,
} from '../../app/src/snimka/reckoning';
import { MARKS, buildComparisonSeries, buildWindowSeries } from '../../e2e/snimka-fixtures';

const T0 = SNIMKA_WINDOW.fromSec; // Sun 27 Sep 20:00 Zagreb
const N = SNIMKA_WINDOW.minutes;
const at = (m: number): number => T0 + m * 60;
/** Minute index of a Zagreb wall time in the window. */
const zm = (month: number, day: number, hour: number, minute = 0): number => (Date.UTC(2026, month - 1, day, hour, minute) / 1000 - 7200 - T0) / 60;

function nulls<T>(n: number = N): Col<T> {
  return new Array<T | null>(n).fill(null);
}

/** A window series with every column missing; tests fill what they need. */
function blank(n: number = N, t0: number = T0): SeriesFile {
  return {
    v: 1, t0, step: 60, n,
    seen: { all: nulls(n), tram: nulls(n), bus: nulls(n) },
    expected: { all: nulls(n), tram: nulls(n), bus: nulls(n) },
    service: { state: nulls<SnimkaState>(n), since: nulls(n), ratio: nulls(n), hold: nulls(n) },
    feed: { headerAgeS: nulls(n), entities: nulls(n), rejectedFuture: nulls(n), hiddenDepot: nulls(n), hiddenParked: nulls(n) },
    published: { vehicles: nulls(n), itemCount: nulls(n), status: nulls(n), service: nulls(n) },
    bikes: { total: nulls(n), empty: nulls(n), reporting: nulls(n) },
    closures: { active: nulls(n), version: nulls(n) },
    hourly: { t0, n: Math.ceil(n / 60), tempC: nulls(Math.ceil(n / 60)), weather: nulls(Math.ceil(n / 60)), newsPulse: new Array(Math.ceil(n / 60)).fill(0) },
  };
}

const fillRange = <T,>(col: Col<T>, from: number, to: number, value: T | ((m: number) => T)): void => {
  for (let m = from; m < to; m++) col[m] = typeof value === 'function' ? (value as (m: number) => T)(m) : value;
};

describe('silentMinutes', () => {
  it('counts the silent minutes per Zagreb day, carried minutes included, and names the first and the last', () => {
    const s = blank();
    // 40 minutes on Sunday evening (23:20 to 24:00) and 60 on Monday (00:00 to 01:00).
    fillRange(s.service.state, 200, 300, 'silent');
    s.service.hold[250] = 'gap'; // a minute without a frame carries the state and still counts
    fillRange(s.service.state, 300, 400, 'reduced');
    s.service.state[1000] = 'unknown';
    const r = silentMinutes(s);
    expect(r.total).toBe(100);
    expect(r.byDay.map((d) => d.minutes)).toEqual([40, 60, 0, 0, 0]);
    expect(r.byDay[1]!.day).toBe(midnightOf(at(240)));
    expect(r.fromSec).toBe(at(200));
    expect(r.toSec).toBe(at(300));
  });
  it('without a silent minute there is nothing to name', () => {
    const r = silentMinutes(blank());
    expect(r.total).toBe(0);
    expect(r.fromSec).toBeNull();
    expect(r.toSec).toBeNull();
  });
});

describe('peakAt0745', () => {
  it('reads every morning at 07:45 and the comparison day at the same minute; a missing morning stays missing', () => {
    const s = blank();
    s.seen.all[zm(9, 28, 7, 45)] = 5;
    s.expected.all[zm(9, 28, 7, 45)] = 230;
    s.seen.all[zm(9, 30, 7, 45)] = 3;
    s.seen.all[zm(10, 1, 7, 45)] = 231;
    s.seen.all[zm(9, 29, 7, 46)] = 99; // the minute after does not count
    const c = blank(SNIMKA_COMPARISON.minutes, SNIMKA_COMPARISON.fromSec);
    c.seen.all[7 * 60 + 45] = 234;
    const r = peakAt0745(s, c);
    expect(r.days.map((d) => d.atSec)).toEqual([at(zm(9, 28, 7, 45)), at(zm(9, 29, 7, 45)), at(zm(9, 30, 7, 45)), at(zm(10, 1, 7, 45))]);
    expect(r.days.map((d) => d.seen)).toEqual([5, null, 3, 231]);
    expect(r.days[0]!.expected).toBe(230);
    expect(r.normal).toBe(234);
    expect(peakAt0745(s, null).normal).toBeNull();
  });
});

describe('bikeDrain', () => {
  it('takes the most bikes, then the fewest after that, the most empty stations, and the extremes per day', () => {
    const s = blank();
    const b = s.bikes!;
    b.total[5] = 500; // before the peak: not the drain's end
    b.total[10] = 1866;
    fillRange(b.total, 11, 3000, 1500);
    b.total[3000] = 534;
    fillRange(b.total, 3001, N, 900);
    b.empty[3000] = 110;
    b.empty[20] = 5;
    b.reporting[100] = 199;
    b.reporting[200] = 200;
    const r = bikeDrain(s)!;
    expect(r.maxTotal).toBe(1866);
    expect(r.maxAt).toBe(at(10));
    expect(r.minTotal).toBe(534);
    expect(r.minAt).toBe(at(3000));
    expect(r.maxEmpty).toBe(110);
    expect(r.maxEmptyAt).toBe(at(3000));
    expect(r.stations).toBe(200);
    const drained = r.byDay.find((d) => d.day === midnightOf(at(3000)))!;
    expect(drained).toEqual({ day: midnightOf(at(3000)), minTotal: 534, maxEmpty: 110 });
    expect(r.byDay[0]).toEqual({ day: midnightOf(T0), minTotal: 500, maxEmpty: 5 });
  });
  it('is null without a bike series or without a single count', () => {
    expect(bikeDrain({ ...blank(), bikes: null })).toBeNull();
    expect(bikeDrain(blank())).toBeNull();
  });
});

describe('ghostInflation', () => {
  it('compares only minutes where both numbers exist and finds the largest excess', () => {
    const s = blank();
    fillRange(s.seen.all, 0, 100, 0);
    fillRange(s.published!.vehicles, 0, 100, 0);
    fillRange(s.published!.vehicles, 40, 50, 5);
    s.published!.vehicles[45] = 12;
    s.published!.vehicles[60] = null; // the recorder was down: nothing to compare
    s.seen.all[70] = 10;
    s.published!.vehicles[70] = 4; // less than the feed: not a ghost
    s.published!.vehicles[200] = 50; // no seen value
    const r = ghostInflation(s)!;
    expect(r.max).toBe(12);
    expect(r.maxAt).toBe(at(45));
    expect(r.publishedAtMax).toBe(12);
    expect(r.seenAtMax).toBe(0);
    expect(r.minutes).toBe(10);
    expect(r.fromSec).toBe(at(40));
    expect(r.toSec).toBe(at(50));
  });
  it('a series with nothing published is null; equal numbers are zero minutes, a real count', () => {
    expect(ghostInflation({ ...blank(), published: null })).toBeNull();
    expect(ghostInflation(blank())).toBeNull();
    const s = blank();
    fillRange(s.seen.all, 0, 10, 3);
    fillRange(s.published!.vehicles, 0, 10, 3);
    expect(ghostInflation(s)).toMatchObject({ max: 0, minutes: 0, maxAt: null });
  });
});

describe('returnDuration', () => {
  function strike(): SeriesFile {
    const s = blank();
    fillRange(s.service.state, 0, 300, 'normal');
    fillRange(s.service.state, 300, 3000, 'silent');
    fillRange(s.service.state, 3000, 3100, 'reduced');
    fillRange(s.service.state, 3100, N, 'normal');
    s.service.since[3100] = at(3100) - 30;
    fillRange(s.seen.all, 0, 300, 150);
    fillRange(s.seen.all, 300, 305, 12); // the fleet is still out when the state turns: not the return
    fillRange(s.seen.all, 305, 2990, 3);
    s.seen.all[2990] = 12;
    fillRange(s.seen.all, 2991, 2995, 8); // a blip, not held for five minutes
    s.seen.all[2995] = 11;
    s.seen.all[2996] = null; // a minute without a frame neither confirms nor breaks
    fillRange(s.seen.all, 2997, 3000, 12);
    fillRange(s.seen.all, 3000, 3002, 9); // broken before the fifth minute: the hold starts again
    fillRange(s.seen.all, 3002, N, (m) => Math.min(230, 10 + (m - 3002)));
    // A short silent stretch on Thursday night must not be taken for the strike.
    fillRange(s.service.state, 4900, 4910, 'silent');
    return s;
  }
  it('runs from the first held ten after the fleet fell to the first normal minute after the longest silence', () => {
    const s = strike();
    expect(longestSilent(s)).toEqual([300, 2999]);
    const r = returnDuration(s)!;
    expect(r.fromSec).toBe(at(3002));
    expect(r.toSec).toBe(at(3100) - 30);
    expect(r.minutes).toBe(Math.round((at(3100) - 30 - at(3002)) / 60));
    expect(r.seenFrom).toBe(10);
    expect(r.seenTo).toBe(108);
  });
  it('a gap minute is not the first normal one; a since outside the minute is not trusted', () => {
    const s = strike();
    s.service.hold[3100] = 'gap';
    s.service.since[3101] = at(10); // long before the silence: the minute itself is used
    const r = returnDuration(s)!;
    expect(r.toSec).toBe(at(3101));
  });
  it('is null without a silence or without a normal minute after it', () => {
    expect(returnDuration(blank())).toBeNull();
    const s = strike();
    fillRange(s.service.state, 3100, N, 'reduced');
    expect(returnDuration(s)).toBeNull();
  });
});

describe('feedHealth', () => {
  it('counts empty and unchanging minutes, the longest stretch from the moment the data stopped, and minutes without a frame', () => {
    const s = blank();
    fillRange(s.feed.entities, 0, N, 100);
    fillRange(s.feed.headerAgeS, 0, N, 12);
    fillRange(s.feed.entities, 100, 160, 0);
    fillRange(s.feed.headerAgeS, 200, 320, (m) => 360 + (m - 200) * 60);
    fillRange(s.feed.headerAgeS, 400, 410, FROZEN_AFTER_S + 1);
    s.feed.headerAgeS[500] = FROZEN_AFTER_S; // at the threshold is still changing
    fillRange(s.feed.entities, 600, 605, null);
    fillRange(s.feed.headerAgeS, 600, 605, null);
    const r = feedHealth(s);
    expect(r.emptyMinutes).toBe(60);
    expect(r.emptyFrom).toBe(at(100));
    expect(r.emptyTo).toBe(at(160));
    expect(r.frozenMinutes).toBe(130);
    expect(r.frozenLongest).toEqual({ minutes: 120, fromSec: at(200) + 60 - 360 });
    expect(r.missingMinutes).toBe(5);
  });
});

describe('sentenceFamilies', () => {
  it('adds the families of every run, the most frequent first, with the departure rows', () => {
    const run = (id: string, sentences: ScreenIndex['runs'][number]['summary']['sentences'], departureRows: number, liveRows: number): ScreenIndex['runs'][number] => ({
      id, kind: 'slot', fromSec: 0, toSec: 600, readings: 30, file: { path: `screen/${id}.0123456789abcdef.json`, bytes: 1, sha256: '0'.repeat(64) },
      captures: { kiosk: null, phone: null }, summary: { sentences, departureRows, liveRows },
    });
    const r = sentenceFamilies({ v: 1, runs: [run('a', { 'departure-timetable': 20, solar: 10 }, 60, 0), run('b', { service: 25, solar: 5, other: 0 }, 30, 12)] });
    expect(r.families).toEqual([{ family: 'service', count: 25 }, { family: 'departure-timetable', count: 20 }, { family: 'solar', count: 15 }]);
    expect(r.total).toBe(60);
    expect(r.departureRows).toBe(90);
    expect(r.liveRows).toBe(12);
    expect(r.runs).toBe(2);
  });
});

describe('the hero tiles over the fixture strike', () => {
  const series = buildWindowSeries();
  const comparison = buildComparisonSeries();
  const tiles = Object.fromEntries(heroTiles(series, comparison).map((t) => [t.key, t]));
  it('hours almost without vehicles, from Monday 02:00 to the first reduced minute on Wednesday', () => {
    // 65 h 5 min of silence: Mon 02:00 to Wed 19:05.
    expect(silentMinutes(series).total).toBe((MARKS.reducedAt - MARKS.silentFrom) / 60);
    expect(tiles.silent!.value).toBe('65');
    expect(tiles.silent!.sub).toBe('od pon 28. 9. u 02:00 do sri 30. 9. u 19:05');
  });
  it('Monday at 07:45 against the normal Thursday', () => {
    expect(tiles.peak!.value).toBe(String(series.seen.all[(MARKS.monday0745 - series.t0) / 60]));
    expect(tiles.peak!.sub).toBe(`običan četvrtak u isto doba: ${comparison.seen.all[465]}`);
  });
  it('the return: the first held ten at 18:21 to the normal state at 20:20', () => {
    expect(tiles.return!.value).toBe('119');
    expect(tiles.return!.sub).toBe('srijeda, od 18:21 do 20:20');
  });
  it('the bikes drained, with the empty stations and the stations reporting', () => {
    const r = bikeDrain(series)!;
    expect(r.maxAt).toBe(MARKS.seriesStart); // the first minute with a count
    expect(r.minTotal).toBe(534);
    // The drain reaches 534 at Wednesday noon (a rounding may get there a minute early).
    expect(r.minAt).toBeGreaterThanOrEqual(Date.UTC(2026, 8, 30, 9, 58) / 1000);
    expect(r.minAt).toBeLessThanOrEqual(Date.UTC(2026, 8, 30, 10, 0) / 1000);
    expect(tiles.bikes!.sub).toMatch(/^s \d\.?\d{3} na 534; praznih stanica do 110 od 200$/);
  });
  it('minutes text never reads a counted zero as "under a minute"', () => {
    expect(minutesText(0)).toBe('0 min');
    expect(minutesText(61)).toBe('1 h 1 min');
  });
});
