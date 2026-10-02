// The faces' words (app/src/snimka/readouts.ts, decisions V3-14 and V3-30):
// the two-bar glyph's widths and its missing state, Vozila's badge, figure
// and normal-day subline, Mreža's counts from the one scheduledCount, the
// bikes against Thursday 1 October (Friday 2 October before Monday 07:00,
// nothing from Friday 12:00), and the data-path line that speaks only when
// the numbers part by two or more. Missing is never zero.
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { SNIMKA_COMPARISONS, type SeriesFile } from '../../shared/snimka';
import { BIKES_REF, bar2, bar2Widths, bicikliFace, bikesReference, dataPathText, minuteIn, mrezaFace, normalSeenAt, vozilaFace } from '../../app/src/snimka/readouts';
import { scheduledCount } from '../../app/src/snimka/live-network';
import { MARKS, buildComparisonRoutes, buildComparisonSeries, buildRoutes, buildWindowSeries, zg } from '../../e2e/snimka-fixtures';

const document = new Window().document as unknown as Document;
const series = buildWindowSeries();
const routes = buildRoutes();
const m = (sec: number): number => minuteIn(series, sec)!;
const comparisons = SNIMKA_COMPARISONS.map((c) => ({ id: c.id, day: c.day, weekday: c.weekday, fromSec: c.fromSec, series: buildComparisonSeries(c), routes: buildComparisonRoutes(c) }));
const ctx = { series, comparisons, manifest: { serviceLiveFromSec: MARKS.serviceLive } } as unknown as Parameters<typeof vozilaFace>[0];
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
  });
});

describe('bar2', () => {
  it('outline = the normal day, fill = now on one scale: now/normal under it, normal/now over it', () => {
    expect(bar2Widths(4, 321)).toEqual({ normal: 1, now: 4 / 321 });
    expect(bar2Widths(84, 43)).toEqual({ normal: 43 / 84, now: 1 });
    expect(bar2Widths(0, 0)).toEqual({ normal: 1, now: 0 });
  });
  it('a missing now is the outline alone with "bez podatka", never a zero-width fill; a missing normal day draws nothing', () => {
    expect(bar2Widths(null, 321)).toEqual({ normal: 1, now: null });
    expect(bar2Widths(4, null)).toBeNull();
    const g = bar2(null, 321, { doc: document });
    expect(g.root.dataset.snBar2).toBe('missing');
    expect(g.root.querySelector<HTMLElement>('.sn-ro-bar2-now')!.hidden).toBe(true);
    expect(g.root.querySelector<HTMLElement>('.sn-ro-bar2-missing')!.hidden).toBe(false);
    expect(g.root.querySelector('.sn-ro-bar2-missing')!.textContent).toBe('bez podatka');
    expect(g.root.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('sada bez podatka, običan dan 321');
    g.update(4, 321, { label: 'čet 1. 10.: 43' });
    expect(g.root.dataset.snBar2).toBe('ok');
    expect(g.root.querySelector<HTMLElement>('.sn-ro-bar2-now')!.style.inlineSize).toBe('1.25%');
    expect(g.root.querySelector('.sn-ro-bar2-label')!.textContent).toBe('čet 1. 10.: 43');
    expect(g.root.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('sada 4, običan dan 321');
    g.update(null, null);
    expect(g.root.hidden).toBe(true);
  });
});

describe('vozilaFace', () => {
  it('Monday 07:45: the state with its tone and the mark before the service went live, against Monday 21 Sep', () => {
    const r = vozilaFace(ctx, MARKS.monday0745);
    const normal = normalSeenAt(ctx, MARKS.monday0745);
    expect(normal).toBe(comparisons[1]!.series.seen.all[7 * 60 + 45]);
    expect(r).toMatchObject({ state: 'silent', word: 'Gotovo bez vozila', tone: 'down', retro: true, now: series.seen.all[m(MARKS.monday0745)], normal });
    expect(r.figure).toBe(String(r.now));
    expect(r.sub).toBe(`običan dan (pon 21. 9.) u isto doba: ${normal}`);
  });
  it('Thursday 07:45: Uobičajeno without the mark, against Thursday 24 Sep; Sunday has no comparison', () => {
    const r = vozilaFace(ctx, MARKS.thursday0745);
    expect(r).toMatchObject({ state: 'normal', word: 'Uobičajeno', tone: 'live', retro: false });
    expect(r.sub).toMatch(/^običan dan \(čet 24\. 9\.\) u isto doba: \d/);
    const sun = vozilaFace(ctx, zg(9, 27, 23, 0));
    expect(sun.sub).toBe('Nedjelja nema usporedbe.');
    expect(sun.normal).toBeNull();
  });
  it('a missing minute is "bez podatka"', () => {
    const r = vozilaFace(ctx, MARKS.frameGapFrom + 60);
    expect(r.figure).toBe('bez podatka');
    expect(r.now).toBeNull();
  });
});

describe('mrezaFace', () => {
  it('"linije s vozilom: 2 od N" with the one scheduledCount; nothing outside the file', () => {
    const mon = mrezaFace(routes, MARKS.monday0745);
    expect(mon.alive).toBe(2);
    expect(mon.scheduled).toBe(scheduledCount(routes, MARKS.monday0745));
    expect(mon.text).toBe(`linije s vozilom: 2 od ${mon.scheduled}`);
    expect(mrezaFace(routes, MARKS.line228 + 2 * 3600).alive).toBe(3);
    expect(mrezaFace(routes, routes.t0 - 600)).toEqual({ alive: null, scheduled: null, text: 'bez podatka' });
  });
});

describe('bicikliFace and the reference day', () => {
  it('Thursday 1 October at the same minute; Friday 2 October before Monday 07:00; nothing from Friday 12:00', () => {
    expect(bikesReference(series, MARKS.monday0745)).toEqual({ atSec: zg(10, 1, 7, 45), day: 'čet 1. 10.' });
    expect(bikesReference(series, zg(9, 28, 6, 59))).toEqual({ atSec: zg(10, 2, 6, 59), day: 'pet 2. 10.' });
    // Sunday night: Friday's minute lies past the recording, so Thursday's.
    expect(bikesReference(series, zg(9, 27, 23, 0))).toEqual({ atSec: zg(10, 1, 23, 0), day: 'čet 1. 10.' });
    expect(bikesReference(series, BIKES_REF.until)).toBeNull();
    expect(bikesReference(series, zg(10, 2, 13, 0))).toBeNull();
  });
  it('leads with the empty stations, the glyph labelled with the day, the bikes in the subline', () => {
    const at = MARKS.monday0745;
    const one = withMinute(at, (s, i) => { s.bikes!.total[i] = 989; s.bikes!.empty[i] = 84; });
    const j = m(zg(10, 1, 7, 45));
    one.bikes!.total[j] = 1300;
    one.bikes!.empty[j] = 43;
    const r = bicikliFace(one, at);
    expect(r).toMatchObject({ now: 84, normal: 43, figure: '84 prazne stanice', label: 'čet 1. 10.: 43', sub: 'bicikala 989 · čet 1. 10.: 1.300', aria: 'sada 84, čet 1. 10.: 43' });
    const early = bicikliFace(series, zg(9, 28, 5, 0));
    expect(early.label).toMatch(/^pet 2\. 10\.: \d+$/);
    expect(early.sub).toMatch(/· pet 2\. 10\.: /);
  });
  it('missing is never zero: no reference after Friday 12:00, no bikes before the recording', () => {
    const late = bicikliFace(series, zg(10, 2, 13, 0));
    expect(late.normal).toBeNull();
    expect(late.label).toBe('čet 1. 10.: bez podatka');
    const before = bicikliFace(series, zg(9, 27, 21, 0));
    expect(before.figure).toBe('bez podatka');
    expect(before.sub).toMatch(/^bicikala bez podatka/);
  });
});

describe('dataPathText', () => {
  it('speaks when ZET, the moving fleet and the screen part by two or more (S-18)', () => {
    const at = MARKS.monday0745;
    const i = m(at);
    expect(dataPathText(series, at)).toBe(`u ZET-ovim podacima ${series.feed.entities[i]} vozila: u spremištu ${series.feed.hiddenDepot[i]}, stoji izvan spremišta ${series.feed.hiddenParked[i]}, u pokretu ${series.seen.all[i]}; na zaslonu ${series.published!.vehicles[i]}`);
  });
  it('is silent when the numbers agree and when fewer than two are known', () => {
    const at = MARKS.monday0745;
    expect(dataPathText(withMinute(at, (s, i) => { s.feed.entities[i] = 5; s.seen.all[i] = 4; s.published!.vehicles[i] = 5; }), at)).toBeNull();
    expect(dataPathText(withMinute(at, (s, i) => { s.feed.entities[i] = null; s.published!.vehicles[i] = null; }), at)).toBeNull();
  });
});
