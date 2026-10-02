// Tijek (app/src/snimka/strip.ts): a missing minute is a gap in the curve,
// never a zero; the cursor sits at the axis's ends at the window's ends and
// never past them; the readout says every panel's value at the minute in
// words, "bez podatka" where the recording has nothing; and on the page a
// pointer press seeks, the cursor moves by one transform, and the readout
// changes on pause and seek only.
import { Window } from 'happy-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SNIMKA_COMPARISONS, SNIMKA_WINDOW, type Col, type SeriesFile } from '../../shared/snimka';
import { createReplayClock } from '../../app/src/snimka/clock';
import { createLayerStore, createViewStore, type SnimkaContext } from '../../app/src/snimka/context';
import type { FrameLoop } from '../../app/src/snimka/frames';
import {
  areaPath, bikesColumns, bikesHeadline, comparisonColumn, comparisonMinute, cursorFraction, frozenMinute, dayLines, linePath, mountStrip, readoutText, readoutValues, renderStrip, rugRuns, runsOf, seekTime, stateClass, subpaths, columnsPath, tintClass, tintRuns,
} from '../../app/src/snimka/strip';
import { bikesOnThursday } from '../../app/src/snimka/reckoning';
import { MARKS, buildComparisonRoutes, buildComparisonSeries, buildRoutes, buildWindowSeries } from '../../e2e/snimka-fixtures';

const START = SNIMKA_WINDOW.fromSec * 1000;
const END = SNIMKA_WINDOW.toSec * 1000;
const series = buildWindowSeries();
const comparison = buildComparisonSeries();
const routes = buildRoutes();
const minuteOf = (sec: number): number => (sec - series.t0) / 60;

describe('linePath', () => {
  it('breaks the line at every null and draws a real zero on the baseline', () => {
    expect(linePath([1, 2, null, null, 3, 3, 3, null, 5], 10)).toBe('M0 90l1 -10M4 70h2M8 50h0');
    expect(linePath([0, 0], 10)).toBe('M0 100h1');
    expect(linePath([null, null], 10)).toBe('');
    expect(subpaths(linePath([1, null, 1, null, 1], 10))).toBe(3);
  });
  it('the window series is drawn with a gap where the frames are missing', () => {
    const d = linePath(series.seen.all, 240);
    // One stretch before the frame gap of Tuesday 03:00 and one after it.
    expect(subpaths(d)).toBe(2);
    const gapStart = minuteOf(MARKS.frameGapFrom);
    expect(d).toContain(`M${minuteOf(MARKS.frameGapTo)} `);
    expect(d.startsWith('M0 ')).toBe(true);
    expect(series.seen.all[gapStart]).toBeNull();
  });
  it('clamps values above the scale to its top and never steps below the baseline', () => {
    expect(linePath([20, -5], 10)).toBe('M0 0l1 100');
  });
});

describe('areaPath and columnsPath', () => {
  it('a silhouette closes once per stretch of values', () => {
    const d = areaPath([1, 1, null, 2], 10);
    expect((d.match(/Z/g) ?? []).length).toBe(2);
    expect(d).toBe('M-0.5 100V90h0.5h1h0.5V100ZM2.5 100V80h0.5h0.5V100Z');
  });
  it('columns stand on the baseline one minute wide, a null minute has none', () => {
    const values: Col<number> = [5, 5, 2, null, 10];
    const d = columnsPath(values, 10);
    expect(d).toBe('M-0.5 100V50h1h1V80h1V100ZM3.5 100V0h1V100Z');
    expect((d.match(/Z/g) ?? []).length).toBe(2);
    expect(columnsPath([null, null], 10)).toBe('');
  });
});

describe('the cursor and the seek', () => {
  it('sits at 0 at the window start and at 1 at its end, clamped outside', () => {
    expect(cursorFraction(START, START, END)).toBe(0);
    expect(cursorFraction(END, START, END)).toBe(1);
    expect(cursorFraction(START - 3_600_000, START, END)).toBe(0);
    expect(cursorFraction(END + 3_600_000, START, END)).toBe(1);
    expect(cursorFraction(START + (END - START) / 4, START, END)).toBe(0.25);
  });
  it('a seek lands on a whole minute inside the window', () => {
    expect(seekTime(0, START, END)).toBe(START);
    expect(seekTime(1, START, END)).toBe(END);
    expect(seekTime(-0.2, START, END)).toBe(START);
    expect(seekTime(1.5, START, END)).toBe(END);
    const t = seekTime(0.123456, START, END);
    expect(t % 60_000).toBe(0);
    expect(Math.abs(t - (START + 0.123456 * (END - START)))).toBeLessThanOrEqual(30_000);
  });
  it('the day lines are the five Zagreb midnights inside the window', () => {
    const lines = dayLines(START, END);
    expect(lines.map((l) => new Date(l.at + 7_200_000).toISOString().slice(0, 16))).toEqual(['2026-09-28T00:00', '2026-09-29T00:00', '2026-09-30T00:00', '2026-10-01T00:00', '2026-10-02T00:00']);
    expect(lines[0]!.x).toBeCloseTo(4 / 112, 6);
  });
});

describe('the service band', () => {
  it('a minute the machine held is drawn as no judgement, never as a state', () => {
    const s = buildWindowSeries();
    const gap = minuteOf(MARKS.frameGapFrom);
    expect(s.service.hold[gap]).toBe('gap');
    expect(stateClass(s, gap)).toBe('none');
    expect(stateClass(s, gap - 1)).toBe('silent');
    const runs = runsOf(s.n, (m) => stateClass(s, m));
    expect(runs.map((r) => r.cls)).toEqual(['normal', 'reduced', 'silent', 'none', 'silent', 'reduced', 'normal']);
    expect(runs.reduce((sum, r) => sum + r.to - r.from, 0)).toBe(s.n);
  });
});

describe('the readout', () => {
  const input = { series, comparison, compare: false, serviceLiveFromSec: MARKS.serviceLive };
  it('names the minute and every panel, the state marked as computed afterwards before the product had it', () => {
    const text = readoutText(input, MARKS.monday0745 * 1000 + 25_000);
    const m = minuteOf(MARKS.monday0745);
    expect(text.startsWith('pon 28. 9. u 07:45: ')).toBe(true);
    expect(text).toContain(`u pokretu ${series.seen.all[m]}, po voznom redu ${series.expected.all[m]}`);
    expect(text).toContain('stanje usluge: gotovo bez vozila (izračunano naknadno)');
    expect(text).toContain(`prazne stanice BAJS-a ${series.bikes!.empty[m]}`);
    expect(text).toContain(`čet 1. 10., isto doba ${bikesOnThursday(series, MARKS.monday0745)}`);
    // v3: the screen's number, the bikes total and the headlines per hour left Tijek.
    expect(text).not.toContain('na zaslonu');
    expect(text).not.toContain('bicikli na stanicama');
    expect(text).not.toContain('običan dan');
  });
  it('says "bez podatka" where the frames are missing, never a zero', () => {
    const values = readoutValues(input, (MARKS.frameGapFrom + 120) * 1000);
    expect(values[0]).toBe('u pokretu bez podatka');
    expect(values).toContain('ZET-ovi podaci bez podatka');
    expect(values).toContain('stanje usluge: bez procjene (izračunano naknadno)');
  });
  it('names the empty and the unchanging feed, and the comparison day when it is on', () => {
    expect(readoutValues(input, (MARKS.feedEmptyFrom + 60) * 1000)).toContain('ZET-ovi podaci bez vozila');
    expect(readoutValues(input, (MARKS.feedFrozenFrom + 600) * 1000)).toContain('ZET-ovi podaci ne mijenjaju se');
    const at = MARKS.thursday0745 * 1000;
    const cm = comparisonMinute(comparison, at)!;
    expect(cm).toBe(7 * 60 + 45);
    const on = readoutValues({ ...input, compare: true }, at);
    expect(on).toContain(`običan dan ${comparison.seen.all[cm]}`);
    expect(on).toContain('stanje usluge: uobičajeno');
  });
  it('at the window end reads the last minute', () => {
    expect(readoutText(input, END).startsWith('pet 2. 10. u 12:00: ')).toBe(true);
    expect(readoutValues(input, END)[0]).toBe(`u pokretu ${series.seen.all[series.n - 1]}`);
  });
});

// ---- on the page ------------------------------------------------------------------

function stubFrames(): FrameLoop & { emit(t: number): void } {
  const subs = new Set<(t: number) => void>();
  return {
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    kick() {},
    destroy() { subs.clear(); },
    emit(t) { for (const fn of subs) fn(t); },
  };
}

function context(at: number, playing = false) {
  const clock = createReplayClock({ start: START, end: END, at, playing, now: () => 1_000 });
  const frames = stubFrames();
  const ctx = {
    manifest: { serviceLiveFromSec: MARKS.serviceLive, window: { ...SNIMKA_WINDOW } },
    series, routes, comparison, events: [], clock, frames, view: createViewStore(), data: { get: vi.fn(), url: (r: { path: string } | string) => String(typeof r === 'string' ? r : r.path) },
    comparisons: [{ id: 'cet-0924', day: '2026-09-24', weekday: 4, fromSec: SNIMKA_COMPARISONS[0].fromSec, series: comparison, routes: buildComparisonRoutes() }],
    layers: createLayerStore({ compare: false }), lagano: false, reducedMotion: false, theme: { resolved: () => 'light', onChange: () => () => {} }, doc: document,
  } as unknown as SnimkaContext;
  return { ctx, clock, frames };
}

// A page for the mount (the e2e fixture's series builders load only in Node's own module mode, so this file runs
// in node and installs a happy-dom window for the page block).
const DOM_GLOBALS = ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'DOMRect'] as const;
let page: Window | null = null;
beforeAll(() => {
  page = new Window({ url: 'http://localhost/snimka/', width: 1366, height: 900 });
  const g = globalThis as Record<string, unknown>;
  for (const key of DOM_GLOBALS) g[key] = key === 'window' ? page : (page as unknown as Record<string, unknown>)[key];
});
afterAll(async () => {
  const g = globalThis as Record<string, unknown>;
  for (const key of DOM_GLOBALS) delete g[key];
  await page?.happyDOM.close();
});
afterEach(() => { if (page) document.body.innerHTML = ''; });

describe('mountStrip', () => {
  it('draws its panels, each with a legend in words and its table of hours, the heatmap last', () => {
    const { ctx } = context(MARKS.monday0745 * 1000);
    const root = document.createElement('div');
    root.setAttribute('aria-busy', 'true');
    document.body.append(root);
    const off = mountStrip(ctx, root);
    const panels = [...root.querySelectorAll<HTMLElement>('.sn-panel')].map((p) => p.dataset.panel);
    expect(panels).toEqual(['fleet', 'bikes', 'lines']);
    expect(root.hasAttribute('aria-busy')).toBe(false);
    // One table twin per chart, "{title}: brojevi po satu".
    const summaries = [...root.querySelectorAll('.sn-panel > .st-table > summary, .sn-panel .sn-hm > .st-table > summary')].map((x) => x.textContent);
    expect(summaries).toEqual(['Vozila u pokretu: brojevi po satu', 'Prazne stanice BAJS-a: brojevi po satu', 'Sve linije, svaki sat: brojevi po satu']);
    expect(root.querySelectorAll('[data-panel="fleet"] .st-table tbody tr').length).toBe(112);
    // The bikes are drawn to Wednesday 24:00 (Thursday is the reference): Sunday 20:00 to Thursday 00:00 is 76 hours.
    expect(root.querySelectorAll('[data-panel="bikes"] .st-table tbody tr').length).toBe(76);
    const legend = root.querySelector('[data-panel="fleet"] .st-legend')!.textContent!;
    for (const word of ['u pokretu', 'običan dan', 'gotovo bez vozila', 'smanjeno', 'izračunano naknadno', 'ZET ne šalje podatke ili se ne osvježavaju']) expect(legend).toContain(word);
    // The comparison day is a layer, on by default in v2 (S-17); this page opened with it off.
    expect(root.querySelector('[data-panel="fleet"] li[data-series="compare"]')?.hasAttribute('hidden')).toBe(true);
    off();
  });
  it('moves every cursor by one transform per frame, from 0 % at the start to 100 % at the end', () => {
    const { ctx, frames } = context(START);
    const root = document.createElement('div');
    document.body.append(root);
    const off = mountStrip(ctx, root);
    const cursors = [...root.querySelectorAll<HTMLElement>('.sn-cursor')];
    expect(cursors.length).toBe(2); // the fleet and the bikes (the heatmap has its own cursor)
    expect(cursors.every((c) => c.style.transform === 'translateX(0.0000%)')).toBe(true);
    frames.emit(END);
    expect(cursors.every((c) => c.style.transform === 'translateX(100.0000%)')).toBe(true);
    frames.emit(START + (END - START) / 2);
    expect(cursors[1]!.style.transform).toBe('translateX(50.0000%)');
    off();
  });
  it('a press on a plot pauses and seeks; the readout changes on that seek, not while the clock plays', () => {
    const { ctx, clock, frames } = context(MARKS.monday0745 * 1000, true);
    const root = document.createElement('div');
    document.body.append(root);
    const off = mountStrip(ctx, root);
    const readout = root.querySelector<HTMLElement>('.sn-strip-readout')!;
    expect(readout.getAttribute('aria-live')).toBe('polite');
    const before = readout.textContent;
    expect(before).toContain('pon 28. 9. u 07:45');
    frames.emit(MARKS.wednesday0745 * 1000); // a playing frame: the cursor moves, the readout stays
    expect(readout.textContent).toBe(before);
    const plot = root.querySelector<HTMLElement>('[data-plot="fleet"]')!;
    plot.getBoundingClientRect = () => ({ left: 100, width: 840, top: 0, bottom: 112, right: 940, height: 112, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect;
    plot.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100 + 840 * 0.5, pointerId: 1, pointerType: 'mouse', button: 0 }));
    expect(clock.playing()).toBe(false);
    const target = seekTime(0.5, START, END);
    expect(clock.now()).toBe(target);
    expect(readout.textContent).toBe(readoutText({ series, comparison, compare: false, serviceLiveFromSec: MARKS.serviceLive }, target));
    // Dragging keeps seeking.
    plot.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 100 + 840 * 0.75, pointerId: 1, pointerType: 'mouse', buttons: 1 }));
    expect(clock.now()).toBe(seekTime(0.75, START, END));
    plot.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 0, pointerId: 1, pointerType: 'mouse' }));
    plot.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 100, pointerId: 1, pointerType: 'mouse' }));
    expect(clock.now()).toBe(seekTime(0.75, START, END));
    off();
  });
  it('the fleet draws the seen line over the normal day\'s silhouette, the state tint behind and the rug under', () => {
    const { ctx } = context(MARKS.monday0745 * 1000);
    ctx.layers.set({ compare: true });
    const root = document.createElement('div');
    document.body.append(root);
    const off = mountStrip(ctx, root);
    const fleet = root.querySelector<HTMLElement>('[data-panel="fleet"]')!;
    // Two paths: the normal day as a silhouette (a layer), the seen line over it; no timetable, no sub-plots.
    expect([...fleet.querySelectorAll('path')].map((p) => p.getAttribute('class'))).toEqual(['sn-area-compare', 'sn-line-seen']);
    expect(fleet.querySelectorAll('.sn-subplot-title')).toHaveLength(0);
    const tints = tintRuns(series, MARKS.serviceLive);
    expect(fleet.querySelectorAll('.sn-strip-tint')).toHaveLength(tints.length);
    // Silent from Mon 02:00, a gap minute (no verdict) untinted, then reduced on Wednesday evening.
    expect(tints.map((t) => t.cls)).toEqual(['reduced', 'silent', 'silent', 'silent', 'reduced']);
    // Every run before Tue 23:17 (the live state) carries the dashed edge; the one crossing it is split.
    expect(tints.filter((t) => t.retro).every((t) => series.t0 + t.to * 60 <= MARKS.serviceLive)).toBe(true);
    expect(tints.filter((t) => !t.retro).every((t) => series.t0 + t.from * 60 >= MARKS.serviceLive)).toBe(true);
    expect(fleet.querySelectorAll('.sn-strip-tint-retro').length).toBe(tints.filter((t) => t.retro).length);
    expect(tintClass(series, minuteOf(MARKS.frameGapFrom))).toBeNull();
    // The rug: the empty feed (Mon 18:42 to Tue 06:28) then the frozen stretch (to 09:00); the frame gap of Tue 03:00
    // (no frame: nothing known) breaks it, never drawn as either.
    const rug = rugRuns(series);
    expect(rug).toEqual([{ from: minuteOf(MARKS.feedEmptyFrom), to: minuteOf(MARKS.frameGapFrom) }, { from: minuteOf(MARKS.frameGapTo), to: minuteOf(MARKS.feedFrozenTo) }]);
    expect(fleet.querySelectorAll('.sn-strip-rug .sn-strip-rug-run')).toHaveLength(2);
    off();
  });
  it('the bikes chart sets the empty stations against Thursday 1 October at the same time of day, to Wednesday 24:00', () => {
    const cols = bikesColumns(series);
    const mon = minuteOf(MARKS.monday0745);
    expect(cols.now[mon]).toBe(series.bikes!.empty[mon]);
    expect(cols.thu[mon]).toBe(series.bikes!.empty[minuteOf(MARKS.thursday0745)]);
    expect(cols.now[minuteOf(MARKS.thursday0745)]).toBeNull();
    // Before the BAJS recording (Sunday 22:07) there is nothing, never a zero.
    expect(cols.now[0]).toBeNull();
    expect(bikesHeadline(series)).toMatch(/^iz dana u dan više: \d+ · \d+ · \d+ \(čet 1\. 10\.: \d+\)$/);
    const { ctx } = context(MARKS.monday0745 * 1000);
    const root = document.createElement('div');
    document.body.append(root);
    const off = mountStrip(ctx, root);
    const bikes = root.querySelector<HTMLElement>('[data-panel="bikes"]')!;
    expect(bikes.querySelector('h3')!.textContent).toBe('Prazne stanice BAJS-a');
    expect(bikes.querySelector('.sn-strip-headline')!.textContent).toBe(bikesHeadline(series));
    expect(bikes.querySelector('.st-legend')!.textContent).toContain('čet 1. 10., isto doba');
    expect(bikes.querySelector('.st-legend')!.textContent).not.toContain('obično');
    off();
  });
  it('the keyboard steps the replay ten minutes, an hour with Shift', () => {
    const { ctx, clock } = context(MARKS.monday0745 * 1000);
    const root = document.createElement('div');
    document.body.append(root);
    const off = mountStrip(ctx, root);
    const frame = root.querySelector<HTMLElement>('.sn-strip-frame')!;
    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(clock.now()).toBe(MARKS.monday0745 * 1000 + 600_000);
    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
    expect(clock.now()).toBe(MARKS.monday0745 * 1000 - 3_000_000);
    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(clock.now()).toBe(END);
    off();
  });
  it('the comparison layer shows the normal day and adds it to the readout', () => {
    const { ctx } = context(MARKS.thursday0745 * 1000);
    const root = document.createElement('div');
    document.body.append(root);
    const off = mountStrip(ctx, root);
    const path = root.querySelector('path[data-series="compare"]')!;
    expect(path.hasAttribute('hidden')).toBe(true);
    ctx.layers.set({ compare: true });
    expect(path.hasAttribute('hidden')).toBe(false);
    expect(root.querySelector('.sn-strip-readout')!.textContent).toContain('običan dan ');
    off();
  });
  it('a series without bikes and without a published number draws the panels it has', () => {
    const bare: SeriesFile = { ...series, bikes: null, published: null, hourly: { ...series.hourly, newsPulse: null } };
    const root = document.createElement('div');
    document.body.append(root);
    const handle = renderStrip(root, { series: bare, comparison: null, startMs: START, endMs: END, serviceLiveFromSec: MARKS.serviceLive, compare: false, onSeek: () => {} });
    expect([...root.querySelectorAll<HTMLElement>('.sn-panel')].map((p) => p.dataset.panel)).toEqual(['fleet']);
    handle.setReadout(MARKS.monday0745 * 1000);
    expect(root.querySelector('.sn-strip-readout')!.textContent).not.toContain('bicikli');
    handle.destroy();
  });
});

describe('the v2 additions', () => {
  it('comparisonColumn sets Monday against Monday 21 September and every other day against Thursday 24 (S-12)', () => {
    const mon = buildComparisonSeries(SNIMKA_COMPARISONS[1]);
    const ctx = { comparisons: [
      { id: 'cet-0924', day: '2026-09-24', weekday: 4 as const, fromSec: SNIMKA_COMPARISONS[0].fromSec, series: comparison, routes },
      { id: 'pon-0921', day: '2026-09-21', weekday: 1 as const, fromSec: SNIMKA_COMPARISONS[1].fromSec, series: mon, routes },
    ] };
    const col = comparisonColumn(ctx, series, (c) => c.seen.all);
    expect(col).toHaveLength(series.n);
    expect(col[minuteOf(MARKS.monday0745)]).toBe(mon.seen.all[7 * 60 + 45]);
    expect(col[minuteOf(MARKS.thursday0745)]).toBe(comparison.seen.all[7 * 60 + 45]);
    expect(comparisonColumn({ comparisons: [] }, series, (c) => c.seen.all).every((v) => v === null)).toBe(true);
  });
  it('the frozen lane reads feed.frozen, the header age only where an old series lacks the column', () => {
    expect(frozenMinute(series, minuteOf(MARKS.feedFrozenFrom))).toBe(true);
    expect(frozenMinute(series, minuteOf(MARKS.monday0745))).toBe(false);
    const old = { ...series, feed: { ...series.feed, frozen: undefined as unknown as typeof series.feed.frozen } };
    expect(frozenMinute(old, minuteOf(MARKS.feedFrozenFrom) + 10)).toBe(true);
    expect(frozenMinute(old, minuteOf(MARKS.monday0745))).toBe(false);
  });
  it('the heatmap is the third chart, with its own head; a tapped cell writes its words into the readout', () => {
    const { ctx } = context(MARKS.monday0745 * 1000);
    const root = document.createElement('div');
    document.body.append(root);
    const off = mountStrip(ctx, root);
    const lines = root.querySelector<HTMLElement>('[data-panel="lines"]')!;
    expect(lines.querySelector('h3')!.textContent).toBe('Sve linije, svaki sat');
    expect(lines.querySelector('[data-sn-heatmap]')).not.toBeNull();
    const plot = lines.querySelector<HTMLElement>('.sn-hm-plot')!;
    plot.getBoundingClientRect = () => ({ left: 0, width: 1120, top: 0, height: 24 * Number(plot.dataset.rows), bottom: 0, right: 1120, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    plot.dispatchEvent(new PointerEvent('click', { bubbles: true, clientX: 5, clientY: 5, pointerType: 'touch' }));
    expect(root.querySelector('.sn-strip-readout')!.textContent).toMatch(/^linija 1, ned 27\. 9\. u 20 h: /);
    // A tap reads; it does not set the line as the subject.
    expect(ctx.view.get().subject).toBeNull();
    off();
    expect(root.querySelector('[data-sn-heatmap]')).toBeNull();
  });
});
