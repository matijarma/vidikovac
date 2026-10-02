// The numbers of Što se vidjelo and the hero (app/src/snimka/reckoning.ts),
// each on a synthetic series whose answer is known by construction: a
// missing minute counts for nothing, a function that finds nothing says so
// (null), never a zero it did not see. The last block reads the e2e fixture's
// strike outline end to end through the hero tiles.
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { FROZEN_AFTER_S as SHARED_FROZEN_AFTER_S, ROUTES_STEP_S, SNIMKA_COMPARISONS, SNIMKA_WINDOW, type Col, type RoutesFile, type ScreenIndex, type SeriesFile, type SnimkaState } from '../../shared/snimka';
import { ROUTES_MISSING, encodeRoutes } from '../../shared/snimka-codec';
import {
  FROZEN_AFTER_S, GHOST_SETTLED_MIN, LINES_TO_SEC, STRIKE_END_SEC, STRIKE_FROM_SEC, bikeDrain, bikesOnThursday, feedAlerts, frozenAt, ghostExcess, ghostSeries, ghostsAt, feedHealth, ghostInflation, heroTiles, linesByDay, linesRan,
  longestSilent, midnightOf, minutesText, mornings, peakAt0745, renderHero, renderReckoning, returnDuration, returnShares, sentenceFamilies, silentMinutes,
} from '../../app/src/snimka/reckoning';
import { SN } from '../../app/src/snimka/strings';
import { MARKS, buildComparisonSeries, buildRoutes, buildWindowSeries, zg } from '../../e2e/snimka-fixtures';

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
    v: 2, t0, step: 60, n,
    seen: { all: nulls(n), tram: nulls(n), bus: nulls(n) },
    expected: { all: nulls(n), tram: nulls(n), bus: nulls(n) },
    service: { state: nulls<SnimkaState>(n), since: nulls(n), ratio: nulls(n), hold: nulls(n) },
    feed: { headerAgeS: nulls(n), entities: nulls(n), rejectedFuture: nulls(n), hiddenDepot: nulls(n), hiddenParked: nulls(n), frozen: nulls(n), alerts: nulls(n), cancelledTrips: nulls(n) },
    published: { vehicles: nulls(n), itemCount: nulls(n), status: nulls(n), service: nulls(n) },
    bikes: { total: nulls(n), empty: nulls(n), reporting: nulls(n) },
    closures: { active: nulls(n), version: nulls(n) },
    hourly: { t0, n: Math.ceil(n / 60), tempC: nulls(Math.ceil(n / 60)), weather: nulls(Math.ceil(n / 60)), newsPulse: new Array(Math.ceil(n / 60)).fill(0) },
  };
}

/** The reckoning's cards on a page of their own (this file runs in node; the cards need a document). */
function renderCards(s: SeriesFile, extras: Parameters<typeof renderReckoning>[3] = {}): HTMLElement {
  const win = new Window({ url: 'http://localhost/snimka/' });
  const g = globalThis as Record<string, unknown>;
  const before = g.document;
  g.document = win.document;
  try {
    const root = win.document.createElement('div') as unknown as HTMLElement;
    renderReckoning(root, s, null, extras);
    return root;
  } finally {
    g.document = before;
  }
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
    expect(r.byDay.map((d) => d.minutes)).toEqual([40, 60, 0, 0, 0, 0]);
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
    const c = blank(SNIMKA_COMPARISONS[0].minutes, SNIMKA_COMPARISONS[0].fromSec);
    c.seen.all[7 * 60 + 45] = 234;
    const r = peakAt0745(s, c);
    expect(r.days.map((d) => d.atSec)).toEqual([at(zm(9, 28, 7, 45)), at(zm(9, 29, 7, 45)), at(zm(9, 30, 7, 45)), at(zm(10, 1, 7, 45)), at(zm(10, 2, 7, 45))]);
    expect(r.days.map((d) => d.seen)).toEqual([5, null, 3, 231, null]);
    expect(r.days[0]!.expected).toBe(230);
    expect(r.normal).toBe(234);
    expect(peakAt0745(s, null).normal).toBeNull();
    expect(r.days.map((d) => d.frozen)).toEqual([false, false, false, false, false]);
  });
  it('a morning without a count while ZET\'s data stood still is marked frozen, a true gap is not', () => {
    const s = blank();
    s.feed.headerAgeS[zm(9, 29, 7, 45)] = 4714; // Tuesday: the header over an hour old, no count
    s.feed.headerAgeS[zm(9, 30, 7, 45)] = 12; // Wednesday: fresh data and still no count is a gap
    const r = peakAt0745(s, null);
    expect(r.days.map((d) => d.frozen)).toEqual([false, true, false, false, false]);
    // The card says which.
    const card = renderCards(s);
    const tuesday = card.querySelector('#vidjelo-jutra [data-key="' + midnightOf(at(zm(9, 29, 7, 45))) + '"] .st-bar-value')!;
    expect(tuesday.textContent).toBe('ZET-ovi podaci ne mijenjaju se');
    const wednesday = card.querySelector('#vidjelo-jutra [data-key="' + midnightOf(at(zm(9, 30, 7, 45))) + '"] .st-bar-value')!;
    expect(wednesday.textContent).toBe('bez podatka');
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

describe('ghostExcess', () => {
  it('counts a difference only where it cannot be the lag between two samples', () => {
    expect(ghostExcess(5, 0)).toBe(5); // vehicles published on an empty feed
    expect(ghostExcess(1, 0)).toBe(1); // even one, while none had a position
    expect(ghostExcess(17, 15)).toBe(2); // a small fleet and at least two more
    expect(ghostExcess(16, 15)).toBeNull(); // one more in a small fleet: sampling
    expect(ghostExcess(41, 20)).toBeNull(); // twenty in motion is a fleet: a big difference there is the collapse's lag
    expect(ghostExcess(0, 0)).toBeNull();
    expect(ghostExcess(3, 5)).toBeNull();
    expect(ghostExcess(null, 0)).toBeNull();
    expect(ghostExcess(4, null)).toBeNull();
  });
});

describe('ghostSeries', () => {
  it('counts a surplus only once the small fleet has settled: a shrinking fleet is the hold, not a ghost', () => {
    const s = blank();
    // A collapse: 150 in motion, then 15 from minute 20; the product still says 31 (the 180 s hold).
    fillRange(s.seen.all, 0, 20, 150);
    fillRange(s.published!.vehicles, 0, 20, 150);
    fillRange(s.seen.all, 20, 60, 15);
    fillRange(s.published!.vehicles, 20, 60, 31);
    s.seen.all[40] = null; // a minute without a frame neither breaks nor extends the run
    const g = ghostSeries(s);
    for (let m = 20; m < 20 + GHOST_SETTLED_MIN; m++) expect(g[m], `minute ${m}`).toBeNull();
    expect(g[20 + GHOST_SETTLED_MIN]).toBe(16);
    expect(g[40]).toBeNull();
    expect(g[59]).toBe(16);
    expect(ghostSeries({ ...blank(), published: null }).every((v) => v === null)).toBe(true);
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
    fillRange(s.seen.all, 100, 200, 150);
    fillRange(s.published!.vehicles, 100, 200, 183); // a normal fleet: the difference is the samples' lag, not ghosts
    s.seen.all[210] = 15;
    s.published!.vehicles[210] = 16; // one more in a small fleet: not counted
    const r = ghostInflation(s, null)!; // the v2 rule without the strike window (the window has its own test)
    expect(r.max).toBe(12);
    expect(r.maxAt).toBe(at(45));
    expect(r.publishedAtMax).toBe(12);
    expect(r.seenAtMax).toBe(0);
    expect(r.minutes).toBe(10);
    expect(r.fromSec).toBe(at(40));
    expect(r.toSec).toBe(at(50));
    // Per day: only Sunday has minutes compared; it said more in ten of them, by twelve at most.
    expect(r.byDay).toEqual([{ day: midnightOf(T0), minutes: 10, max: 12 }]);
  });
  it('a series with nothing published is null; equal numbers are zero minutes, a real count', () => {
    expect(ghostInflation({ ...blank(), published: null })).toBeNull();
    expect(ghostInflation(blank(), null)).toBeNull();
    const s = blank();
    fillRange(s.seen.all, 0, 10, 3);
    fillRange(s.published!.vehicles, 0, 10, 3);
    expect(ghostInflation(s, null)).toMatchObject({ max: 0, minutes: 0, maxAt: null });
  });
  it('v3: counts only strike minutes, Mon 03:30 to Wed 20:16 in the silent or reduced state; the headline is Mon 07:45', () => {
    const s = buildWindowSeries();
    const m = (sec: number): number => (sec - s.t0) / 60;
    // The midnight collapse before the strike (Mon 00:37, reduced) and the normal night fleet (Thu 02:00): ghosts by
    // the v2 rule, not by the strike rule.
    for (const [sec, len] of [[zg(9, 28, 0, 30), 60], [zg(10, 1, 1, 30), 60]] as const) {
      for (let k = m(sec); k < m(sec) + len; k++) { (s.seen.all as (number | null)[])[k] = 1; s.published!.vehicles[k] = 13; }
    }
    // The screen said 7 while 2 had a position at Mon 07:45.
    s.seen.all[m(MARKS.monday0745)] = 2;
    s.published!.vehicles[m(MARKS.monday0745)] = 7;
    const loose = ghostInflation(s, null)!;
    const strict = ghostInflation(s)!;
    expect(loose.minutes).toBeGreaterThan(strict.minutes);
    expect(loose.max).toBe(12);
    // The fixture's ghosts in the strike: +5 on Mon 17:00 to 21:00 and the 07:45 minute.
    expect(strict.max).toBe(5);
    expect(strict.fromSec).toBeGreaterThanOrEqual(STRIKE_FROM_SEC);
    expect(strict.toSec).toBeLessThanOrEqual(STRIKE_END_SEC);
    expect(strict.byDay.find((d) => d.day === zg(9, 28, 0, 0))!.minutes).toBe(241);
    expect(ghostsAt(s)).toEqual({ shown: 7, real: 2 });
    const card = renderCards(s).querySelector('[data-card="ghosts"]')!;
    expect(card.querySelector('.sn-figure-value')!.textContent).toBe('7 umjesto 2');
    expect(card.querySelector('dd')!.textContent).toBe('pon 28. 9.: 4 h 1 min');
    // The Monday two-line plot on one scale: the vehicles with a position, then the screen's number.
    expect([...card.querySelectorAll('path')].map((p) => p.getAttribute('class'))).toEqual(['sn-card-line sn-card-tone-seen', 'sn-card-line sn-card-tone-shown']);
    expect(card.querySelector('.st-legend')!.textContent).toBe('s položajemna zaslonu');
    expect(card.querySelectorAll('.st-table tbody tr')).toHaveLength(24);
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
    fillRange(s.feed.entities, 700, 710, 0); // a second, shorter empty stretch
    fillRange(s.feed.headerAgeS, 200, 320, (m) => 360 + (m - 200) * 60);
    fillRange(s.feed.headerAgeS, 400, 410, FROZEN_AFTER_S + 1);
    s.feed.headerAgeS[500] = FROZEN_AFTER_S; // at the threshold is still changing
    fillRange(s.feed.entities, 600, 605, null);
    fillRange(s.feed.headerAgeS, 600, 605, null);
    const r = feedHealth(s);
    expect(r.emptyMinutes).toBe(70);
    expect(r.emptyFrom).toBe(at(100));
    expect(r.emptyTo).toBe(at(710));
    expect(r.emptyLongest).toEqual({ minutes: 60, fromSec: at(100) });
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
  it('three tiles (v3): the "2 vozila" and the alerts tiles are gone; each seeks to its moment', () => {
    expect(heroTiles(series, comparison).map((t) => t.key)).toEqual(['silent', 'bikes', 'return']);
    expect(tiles.silent!.atSec).toBe(MARKS.silentFrom);
    expect(tiles.bikes!.atSec).toBe(bikeDrain(series)!.maxEmptyAt);
    expect(tiles.return!.atSec).toBe(returnDuration(series)!.fromSec);
    expect(tiles.silent!.label).toBe('sati gotovo bez vozila');
    expect(tiles.return!.label).toBe('minuta od prvih vozila do uobičajenog stanja');
  });
  it('the return: the first held ten at 18:21 to the normal state at 20:20', () => {
    expect(tiles.return!.value).toBe('119');
    expect(tiles.return!.sub).toBe('u srijedu 30. 9. od 18:21 do 20:20');
  });
  it('the bikes drained, with the empty stations and the stations reporting', () => {
    const r = bikeDrain(series)!;
    expect(r.maxAt).toBe(MARKS.seriesStart); // the first minute with a count
    expect(r.minTotal).toBe(534);
    // The drain reaches 534 at Wednesday noon (a rounding may get there a minute early).
    expect(r.minAt).toBeGreaterThanOrEqual(Date.UTC(2026, 8, 30, 9, 58) / 1000);
    expect(r.minAt).toBeLessThanOrEqual(Date.UTC(2026, 8, 30, 10, 0) / 1000);
    // The v2 tile (Appendix B kpi.bikes): the most empty stations, when, and the drain.
    expect(tiles.bikes!.value).toBe('110');
    // v3 (Appendix A kpi.bikes): the form follows the figure; Thursday 1 October at the same time of day.
    expect(tiles.bikes!.label).toBe('od 200 stanica BAJS-a prazno');
    const thu = bikesOnThursday(series, r.maxEmptyAt!);
    expect(thu).toBe(series.bikes!.empty[(r.maxEmptyAt! + 86_400 - series.t0) / 60]);
    expect(tiles.bikes!.sub).toMatch(new RegExp(`^sri 30\\. 9\\. u 1[12]:\\d\\d · čet 1\\. 10\\. u isto doba: ${thu}$`));
  });
  it('minutes text never reads a counted zero as "under a minute"', () => {
    expect(minutesText(0)).toBe('0 min');
    expect(minutesText(61)).toBe('1 h 1 min');
  });
});

describe('the frozen rule of decision S-19', () => {
  it('is the one shared constant of 180 s', () => {
    expect(FROZEN_AFTER_S).toBe(SHARED_FROZEN_AFTER_S);
    expect(FROZEN_AFTER_S).toBe(180);
  });
  it('reads the series\' feed.frozen column where it has a value, the header age only where it has none', () => {
    const s = blank();
    s.feed.headerAgeS[10] = 200; // over 180 s, no flag: frozen by the age
    s.feed.headerAgeS[11] = 200;
    s.feed.frozen[11] = 0; // the column says it was changing: the column wins
    s.feed.headerAgeS[12] = 20;
    s.feed.frozen[12] = 1; // and the other way round
    s.feed.headerAgeS[13] = 180; // at the threshold is still changing
    expect([10, 11, 12, 13, 14].map((m) => frozenAt(s, m))).toEqual([true, false, true, false, false]);
  });
  it('feedHealth counts the flagged minutes; a run without a header age starts at its first minute', () => {
    const s = blank();
    fillRange(s.feed.frozen, 100, 130, 1);
    const r = feedHealth(s);
    expect(r.frozenMinutes).toBe(30);
    expect(r.frozenLongest).toEqual({ minutes: 30, fromSec: at(100) });
  });
});

describe('ZET\'s own alerts (v3: the most in one minute of the strike, never a sum of minutes)', () => {
  it('is the maximum inside the strike window; null when it has no known value, never a 0', () => {
    const s = blank();
    expect(feedAlerts(s)).toBeNull();
    const m = (sec: number): number => (sec - T0) / 60;
    s.feed.alerts[m(STRIKE_FROM_SEC) + 5] = 0;
    expect(feedAlerts(s)).toMatchObject({ alerts: 0, cancelled: 0, episode: null });
    // One alert standing for a day is one alert, not 1,440.
    fillRange(s.feed.alerts, m(STRIKE_FROM_SEC) + 10, m(STRIKE_FROM_SEC) + 1450, 1);
    s.feed.cancelledTrips[m(STRIKE_FROM_SEC) + 20] = 2;
    expect(feedAlerts(s)).toMatchObject({ alerts: 1, cancelled: 2 });
  });
  it('a strike-shaped series reads 0 and 0 in the strike, and the episode after it on its own', () => {
    const s = buildWindowSeries();
    const r = feedAlerts(s)!;
    expect([r.alerts, r.cancelled]).toEqual([0, 0]);
    // The fixture's normal days carry two alerts 07:00 to 09:00 on Thursday and Friday: the first is the longest.
    expect(r.episode).toEqual({ fromSec: zg(10, 1, 7, 0), toSec: zg(10, 1, 9, 0), alerts: 2, cancelled: 1, toEnd: false });
    const card = renderCards(s).querySelector('[data-card="zet"]')!;
    const lines = [...card.querySelectorAll('.sn-card-lines li')].map((li) => li.textContent);
    expect(lines[0]).toBe(SN.reckoning.zetAlerts);
    expect(lines).toContain('U četvrtak 1. 10. od 07:00 do 09:00 u podacima je stajalo do 2 upozorenja s otkazanim vožnjama.');
    expect(lines.some((l) => /^\d+ h( \d+ min)? ZET nije slao nijedno vozilo \(pon 18:42 do uto \d\d:\d\d\)$/.test(l!))).toBe(true);
    // An episode that runs to the end of the recording says so.
    const end = buildWindowSeries();
    fillRange(end.feed.alerts, end.n - 200, end.n, 3);
    expect(feedAlerts(end)!.episode).toMatchObject({ toEnd: true, alerts: 3, toSec: end.t0 + end.n * 60 });
  });
  it('the tiles have no alerts tile, and renderHero removes a v2 alerts or peak tile and binds the seek', () => {
    const win = new Window({ url: 'http://localhost/snimka/' });
    const doc = win.document as unknown as Document;
    doc.body.innerHTML = '<div data-sn="kpis" aria-busy="true">' + ['silent', 'peak', 'bikes', 'return', 'alerts'].map((k) => `<div class="st-kpi" data-sn="kpi-${k}"></div>`).join('') + '</div>';
    const seeks: number[] = [];
    renderHero(doc, buildWindowSeries(), null, null, (t) => seeks.push(t));
    expect(doc.querySelectorAll('.st-kpi')).toHaveLength(3);
    expect(doc.querySelector('[data-sn="kpi-alerts"]')).toBeNull();
    expect(doc.querySelector('[data-sn="kpis"]')!.hasAttribute('aria-busy')).toBe(false);
    const buttons = [...doc.querySelectorAll<HTMLButtonElement>('.sn-kpi-button')];
    expect(buttons).toHaveLength(3);
    expect(buttons.every((b) => b.type === 'button' && b.textContent!.includes('Pokaži u snimci'))).toBe(true);
    buttons[2]!.click();
    expect(seeks).toEqual([returnDuration(buildWindowSeries())!.fromSec]);
    // A tile without a moment is plain text, never a button that seeks nowhere.
    doc.body.innerHTML = '<div data-sn="kpis"><div data-sn="kpi-silent"></div><div data-sn="kpi-bikes"></div><div data-sn="kpi-return"></div></div>';
    renderHero(doc, blank(), null);
    expect(doc.querySelectorAll('.sn-kpi-button')).toHaveLength(0);
    expect(doc.querySelector('[data-sn="kpi-silent"] .st-kpi-value')!.textContent).toBe('bez podatka');
  });
});

describe('the six cards', () => {
  it('are, in order: silent, mornings, lines, ghosts, ZET, return; each with its method line', () => {
    const comparisons = SNIMKA_COMPARISONS.map((c) => ({ id: c.id, fromSec: c.fromSec, series: buildComparisonSeries(c) })).sort((a, b) => a.fromSec - b.fromSec);
    const root = renderCards(buildWindowSeries(), { routes: buildRoutes(), comparisons });
    const cards = [...root.querySelectorAll<HTMLElement>('.st-card')];
    expect(cards.map((c) => c.dataset.card)).toEqual(['silent', 'mornings', 'lines', 'ghosts', 'zet', 'return']);
    expect(cards.map((c) => c.querySelector('h3')!.textContent)).toEqual(['Tri dana gotovo bez vozila', 'Pet jutara u 07:45', 'Što je vozilo', 'Broj koji nije bio točan', 'Što je ZET javio u podacima', 'Povratak']);
    for (const c of cards) expect(c.querySelector('.st-method')!.textContent).not.toBe('');
  });
  it('the silent card: bars Monday to Wednesday, and the days after it in one line', () => {
    const card = renderCards(buildWindowSeries()).querySelector('[data-card="silent"]')!;
    expect([...card.querySelectorAll('.st-bar-label')].map((l) => l.textContent)).toEqual(['pon 28. 9.', 'uto 29. 9.', 'sri 30. 9.']);
    expect(card.querySelector('.sn-card-lines')!.textContent).toBe('čet i pet: 0 min');
  });
  it('the mornings card: vehicles with both normal days, and empty stations with Thursday and Friday', () => {
    const series = buildWindowSeries();
    const comparisons = SNIMKA_COMPARISONS.map((c) => ({ id: c.id, fromSec: c.fromSec, series: buildComparisonSeries(c) })).sort((a, b) => a.fromSec - b.fromSec);
    const card = renderCards(series, { comparisons }).querySelector('[data-card="mornings"]')!;
    const cols = [...card.querySelectorAll('.sn-card-col')];
    expect(cols.map((c) => c.querySelector('h4')!.textContent)).toEqual(['Vozila u pokretu', 'Prazne stanice BAJS-a']);
    expect([...cols[0]!.querySelectorAll('.st-bar-label')].map((l) => l.textContent)).toEqual(['pon 28. 9.', 'uto 29. 9.', 'sri 30. 9.', 'čet 1. 10.', 'pet 2. 10.', 'pon 21. 9., običan dan', 'čet 24. 9., običan dan']);
    const rows = mornings(series);
    expect([...cols[1]!.querySelectorAll('.st-bar-value')].map((v) => v.textContent)).toEqual(rows.map((r) => String(r.empty)));
    expect(cols[1]!.querySelectorAll('.sn-card-bar-normal')).toHaveLength(2);
  });
  it('the return card: trams and buses as shares of their timetable on one % scale, Wed 18:00 to 22:00', () => {
    const series = buildWindowSeries();
    const r = returnShares(series);
    expect(r.tram).toHaveLength(240);
    expect(r.fromSec).toBe(zg(9, 30, 18, 0));
    const m = (zg(9, 30, 21, 0) - series.t0) / 60;
    expect(r.tram[180]).toBeCloseTo((series.seen.tram[m]! / series.expected.tram[m]!) * 100, 0);
    const card = renderCards(series).querySelector('[data-card="return"]')!;
    expect(card.querySelector('.st-legend')!.textContent).toBe('TramvajiAutobusi');
    expect(card.querySelector('.sn-scale')!.textContent).toMatch(/^\d+ %$/);
    expect(card.querySelectorAll('.st-table tbody tr')).toHaveLength(8);
  });
});

describe('linesByDay', () => {
  const routes: RoutesFile['routes'] = [
    { id: '6', shortName: '6', type: 0 }, { id: '17', shortName: '17', type: 0 }, { id: '228', shortName: '228', type: 3 }, { id: '109', shortName: '109', type: 3 },
  ];
  /** Two Zagreb days of five-minute slots from Monday 00:00. */
  function file(fill: (route: number, slot: number) => [seen: number, expected: number]): RoutesFile {
    const t0 = Date.UTC(2026, 8, 28, 0, 0) / 1000 - 7200;
    const n = 2 * 288;
    const seen = routes.map((_, i) => Uint8Array.from({ length: n }, (_, j) => fill(i, j)[0]));
    const expected = routes.map((_, i) => Uint8Array.from({ length: n }, (_, j) => fill(i, j)[1]));
    return encodeRoutes(t0, ROUTES_STEP_S, routes, seen, expected);
  }
  it('counts a route once a day when any slot had a vehicle, against the routes scheduled or seen that day; trams first', () => {
    const r = linesByDay(file((i, j) => {
      const monday = j < 288;
      if (i === 0) return [monday ? 0 : 3, 4]; // 6: scheduled, ran only on Tuesday
      if (i === 1) return [j === 100 ? 1 : 0, 4]; // 17: one slot on Monday
      if (i === 2) return [monday && j > 120 ? 2 : 0, monday ? 0 : 2]; // 228: ran on Monday unscheduled
      return [ROUTES_MISSING, ROUTES_MISSING]; // 109: no data at all
    }));
    expect(r.map((d) => [d.count, d.total])).toEqual([[2, 3], [1, 3]]);
    expect(r[0]!.shortNames).toEqual(['17', '228']);
    expect(r[1]!.shortNames).toEqual(['6']);
  });
  it('a missing slot is no vehicle and no schedule; a day without one known slot is left out', () => {
    const r = linesByDay(file((_, j) => (j < 288 ? [ROUTES_MISSING, ROUTES_MISSING] : [0, 1])));
    expect(r).toHaveLength(1);
    expect(r[0]!.count).toBe(0);
    expect(r[0]!.total).toBe(4);
  });
  it('with a span, only the slots inside it count (v3: Mon 03:30 to Wed 18:00)', () => {
    const f = file((i, j) => (i === 1 && j < 42 ? [1, 1] : [0, 1])); // 17 runs only before 03:30 on Monday
    expect(linesByDay(f)[0]!.shortNames).toEqual(['17']);
    expect(linesByDay(f, { from: STRIKE_FROM_SEC, to: LINES_TO_SEC })[0]!.count).toBe(0);
  });
  it('linesRan: a vehicle in at least one slot of the strike, against every line of the file, with the single-vehicle ones', () => {
    const r = linesRan(file((i, j) => {
      if (i === 0) return [j < 42 ? 3 : 0, 4]; // 6: only before 03:30
      if (i === 1) return [j === 100 ? 1 : 0, 4]; // 17: one vehicle once
      if (i === 2) return [j > 120 ? 4 : 0, 2]; // 228: four
      return [ROUTES_MISSING, ROUTES_MISSING];
    }));
    expect(r).toMatchObject({ count: 2, total: 4, single: 1 });
    expect(r.lines.map((l) => l.shortName)).toEqual(['17', '228']);
    const card = renderCards(buildWindowSeries(), { routes: buildRoutes() }).querySelector('[data-card="lines"]')!;
    const fixture = linesRan(buildRoutes());
    expect(card.querySelector('.sn-figure-value')!.textContent).toBe(`${fixture.count} od ${fixture.total} linije; ${fixture.single} od njih jednim vozilom`); // 32: the "few" form
    expect(card.querySelector('.st-method')!.textContent).toContain('petominutnom');
  });
});
