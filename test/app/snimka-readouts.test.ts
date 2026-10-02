// The faces' words (app/src/snimka/readouts.ts): the state word with its
// tone and the retroactive mark, "u pokretu · običan dan · po voznom redu",
// the living lines, the bikes in Croatian plurals, DHMZ's words, and the
// data-path line that speaks only when the numbers part by two or more.
// Missing is never zero: every null reads "bez podatka".
import { describe, expect, it } from 'vitest';
import { SNIMKA_COMPARISONS, type SeriesFile } from '../../shared/snimka';
import { bikesText, dataPathText, linesText, minuteIn, normalSeenAt, stateText, vehiclesText, weatherText } from '../../app/src/snimka/readouts';
import { MARKS, buildComparisonSeries, buildRoutes, buildWindowSeries } from '../../e2e/snimka-fixtures';

const series = buildWindowSeries();
const routes = buildRoutes();
const m = (sec: number): number => minuteIn(series, sec)!;
/** A copy of the series with one minute's columns overwritten. */
function withMinute(sec: number, patch: (s: SeriesFile, i: number) => void): SeriesFile {
  const copy = structuredClone(series);
  patch(copy, m(sec));
  return copy;
}

describe('minuteIn', () => {
  it('holds the window, reads the last minute at the end and nothing outside', () => {
    expect(minuteIn(series, series.t0)).toBe(0);
    expect(minuteIn(series, series.t0 + series.n * 60)).toBe(series.n - 1);
    expect(minuteIn(series, series.t0 - 1)).toBeNull();
    expect(minuteIn(series, series.t0 + series.n * 60 + 60)).toBeNull();
  });
});

describe('stateText', () => {
  it('says the state with its tone and the naknadno mark before the service went live', () => {
    const r = stateText(series, MARKS.monday0745, MARKS.serviceLive);
    expect(r).toMatchObject({ state: 'silent', word: 'Gotovo bez vozila', tone: 'down', retro: true });
    expect(r.sub).toMatch(/^u pokretu \d, po voznom redu oko \d+$/);
    const after = stateText(series, MARKS.thursday0745, MARKS.serviceLive);
    expect(after).toMatchObject({ state: 'normal', word: 'Uobičajeno', tone: 'live', retro: false });
  });
  it('a minute without a count says how long the state holds, never a zero', () => {
    const at = MARKS.frameGapFrom + 60;
    const r = stateText(series, at, MARKS.serviceLive);
    expect(series.seen.all[m(at)]).toBeNull();
    expect(r.sub).toMatch(/^traje \d+ h( \d+ min)?$/);
    const none = stateText(withMinute(at, (s, i) => { s.service.state[i] = null; s.service.since[i] = null; }), at, MARKS.serviceLive);
    expect(none).toMatchObject({ state: null, word: 'bez podatka', sub: 'bez podatka', tone: 'info' });
  });
});

describe('vehiclesText', () => {
  it('reads "u pokretu N · običan dan M · po voznom redu K" against the weekday-matched normal day', () => {
    const ctx = { comparisons: [
      { id: 'cet-0924', day: '2026-09-24', weekday: 4 as const, fromSec: SNIMKA_COMPARISONS[0].fromSec, series: buildComparisonSeries(SNIMKA_COMPARISONS[0]), routes: routes },
      { id: 'pon-0921', day: '2026-09-21', weekday: 1 as const, fromSec: SNIMKA_COMPARISONS[1].fromSec, series: buildComparisonSeries(SNIMKA_COMPARISONS[1]), routes: routes },
    ] };
    const normal = normalSeenAt(ctx, MARKS.monday0745);
    expect(normal).toBe(ctx.comparisons[1]!.series.seen.all[7 * 60 + 45]);
    const r = vehiclesText(series, normal, MARKS.monday0745);
    const i = m(MARKS.monday0745);
    expect(r.figure).toBe(String(series.seen.all[i]));
    expect(r.line).toBe(`u pokretu ${series.seen.all[i]} · običan dan ${normal} · po voznom redu ${series.expected.all[i]}`);
    expect(normalSeenAt({ comparisons: [] }, MARKS.monday0745)).toBeNull();
  });
  it('a missing count or comparison is "bez podatka"', () => {
    const at = MARKS.frameGapFrom + 60;
    const r = vehiclesText(series, null, at);
    expect(r.figure).toBe('bez podatka');
    expect(r.sub).toMatch(/^običan dan bez podatka · po voznom redu /);
  });
});

describe('linesText', () => {
  it('counts the living lines of the scheduled ones (S-16): two on Monday at 07:45, three on Tuesday at noon', () => {
    const mon = linesText(routes, MARKS.monday0745);
    expect(mon.alive).toBe(2);
    expect(mon.sub).toBe(`2 od ${mon.scheduled} linija po voznom redu ima vozilo`);
    expect(mon.scheduled!).toBeGreaterThan(10);
    expect(linesText(routes, MARKS.line228 + 2 * 3600).alive).toBe(3);
    expect(linesText(routes, routes.t0 - 600)).toEqual({ alive: null, scheduled: null, figure: 'bez podatka', sub: 'bez podatka' });
  });
});

describe('bikesText and weatherText', () => {
  it('bikes in Croatian plurals, a missing minute as words', () => {
    const one = withMinute(MARKS.monday0745, (s, i) => { s.bikes!.total[i] = 21; s.bikes!.empty[i] = 3; });
    expect(bikesText(one, MARKS.monday0745)).toEqual({ figure: '21 bicikl', sub: '3 prazne stanice' });
    const many = withMinute(MARKS.monday0745, (s, i) => { s.bikes!.total[i] = 989; s.bikes!.empty[i] = 85; });
    expect(bikesText(many, MARKS.monday0745)).toEqual({ figure: '989 bicikala', sub: '85 praznih stanica' });
    const none = withMinute(MARKS.monday0745, (s, i) => { s.bikes!.total[i] = null; s.bikes!.empty[i] = null; });
    expect(bikesText(none, MARKS.monday0745)).toEqual({ figure: 'bez podatka', sub: 'bez podatka' });
    expect(bikesText({ ...series, bikes: null }, MARKS.monday0745).figure).toBe('bez podatka');
  });
  it('DHMZ words verbatim beside the rounded temperature; the temperature or the words alone; the DHMZ gap', () => {
    const hourly = { t0: series.t0, n: 3, tempC: [12.4, 9.6, null], weather: ['vedro', null, 'lahor'], newsPulse: null };
    expect(weatherText({ hourly }, series.t0 + 60)).toBe('12 °C, vedro');
    expect(weatherText({ hourly }, series.t0 + 3600)).toBe('10 °C');
    expect(weatherText({ hourly }, series.t0 + 7200)).toBe('lahor');
    expect(weatherText({ hourly: { ...hourly, weather: [null, null, null] } }, series.t0 + 7200)).toBe('bez podatka DHMZ-a');
    expect(weatherText({ hourly }, series.t0 + 4 * 3600)).toBe('bez podatka DHMZ-a');
    // The fixture leaves hour 40 (Tue 12:00) empty.
    expect(weatherText(series, series.hourly.t0 + 40 * 3600 + 60)).toBe('bez podatka DHMZ-a');
  });
});

describe('dataPathText', () => {
  it('speaks when ZET, the moving fleet and the screen part by two or more (S-18)', () => {
    const at = MARKS.monday0745;
    const i = m(at);
    const t = dataPathText(series, at)!;
    expect(t).toBe(`ZET šalje ${series.feed.entities[i]}, u spremištu ${series.feed.hiddenDepot[i]}, parkirano ${series.feed.hiddenParked[i]}, u pokretu ${series.seen.all[i]}, zaslon je rekao ${series.published!.vehicles[i]}`);
  });
  it('is silent when the numbers agree and when fewer than two are known; a missing part reads bez podatka', () => {
    const at = MARKS.monday0745;
    const same = withMinute(at, (s, i) => { s.feed.entities[i] = 5; s.seen.all[i] = 4; s.published!.vehicles[i] = 5; });
    expect(dataPathText(same, at)).toBeNull();
    const lone = withMinute(at, (s, i) => { s.feed.entities[i] = null; s.published!.vehicles[i] = null; });
    expect(dataPathText(lone, at)).toBeNull();
    const gap = withMinute(at, (s, i) => { s.feed.entities[i] = 45; s.seen.all[i] = 2; s.published!.vehicles[i] = null; s.feed.hiddenParked[i] = null; });
    expect(dataPathText(gap, at)).toBe(`ZET šalje 45, u spremištu ${series.feed.hiddenDepot[m(at)]}, parkirano bez podatka, u pokretu 2, zaslon je rekao bez podatka`);
  });
});
