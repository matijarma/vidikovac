// Tijek (app/src/snimka/strip.ts): a missing minute is a gap in the curve,
// never a zero; the cursor sits at the axis's ends at the window's ends and
// never past them; the readout says every panel's value at the minute in
// words, "bez podatka" where the recording has nothing; and on the page a
// pointer press seeks, the cursor moves by one transform, and the readout
// changes on pause and seek only.
import { Window } from 'happy-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SNIMKA_WINDOW, type Col, type SeriesFile } from '../../shared/snimka';
import { createReplayClock } from '../../app/src/snimka/clock';
import { createLayerStore, type SnimkaContext } from '../../app/src/snimka/context';
import type { FrameLoop } from '../../app/src/snimka/frames';
import {
  areaPath, comparisonMinute, cursorFraction, dayLines, linePath, mountStrip, readoutText, readoutValues, renderStrip, runsOf, seekTime, stateClass, subpaths, columnsPath,
} from '../../app/src/snimka/strip';
import { MARKS, buildComparisonSeries, buildWindowSeries } from '../../e2e/snimka-fixtures';

const START = SNIMKA_WINDOW.fromSec * 1000;
const END = SNIMKA_WINDOW.toSec * 1000;
const series = buildWindowSeries();
const comparison = buildComparisonSeries();
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
    expect(text).toContain('bicikli na stanicama ');
    expect(text).toContain('prazne stanice ');
    expect(text).toContain(`zaslon je rekao ${series.published!.vehicles[m]}`);
    expect(text).toMatch(/medijski naslovi po satu \d/);
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
    series, comparison, events: [], clock, frames, data: { get: vi.fn(), url: (r: { path: string } | string) => String(typeof r === 'string' ? r : r.path) },
    comparisons: [{ id: 'cet-0924', day: '2026-09-24', weekday: 4, fromSec: comparison.t0, series: comparison, routes: null }],
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
  it('draws six panels, each with a legend in words and its table of hours', () => {
    const { ctx } = context(MARKS.monday0745 * 1000);
    const root = document.createElement('div');
    root.setAttribute('aria-busy', 'true');
    document.body.append(root);
    const off = mountStrip(ctx, root);
    const panels = [...root.querySelectorAll<HTMLElement>('.sn-panel')].map((p) => p.dataset.panel);
    expect(panels).toEqual(['fleet', 'state', 'bikes', 'feed', 'ghosts', 'news']);
    expect(root.hasAttribute('aria-busy')).toBe(false);
    for (const p of root.querySelectorAll('.sn-panel')) {
      expect(p.querySelector('.st-table summary')?.textContent).toBe('Brojevi po satu');
      expect(p.querySelectorAll('.st-table tbody tr').length).toBe(112);
    }
    expect(root.querySelector('[data-panel="fleet"] .st-legend')?.textContent).toContain('po voznom redu');
    expect(root.querySelector('[data-panel="state"] .st-legend')?.textContent).toContain('izračunano naknadno');
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
    expect(cursors.length).toBe(7); // fleet, state, two bike plots, feed, ghosts, news
    expect(cursors.every((c) => c.style.transform === 'translateX(0.0000%)')).toBe(true);
    frames.emit(END);
    expect(cursors.every((c) => c.style.transform === 'translateX(100.0000%)')).toBe(true);
    frames.emit(START + (END - START) / 2);
    expect(cursors[3]!.style.transform).toBe('translateX(50.0000%)');
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
  it('the ghosts panel draws a column only in the minutes the ghost rule counts, on its own scale', () => {
    const { ctx } = context(MARKS.monday0745 * 1000);
    const root = document.createElement('div');
    document.body.append(root);
    const off = mountStrip(ctx, root);
    const panel = root.querySelector<HTMLElement>('[data-panel="ghosts"]')!;
    expect(panel.querySelector('h3')!.textContent).toBe('Vozila koja je zaslon brojio, a nisu imala položaj');
    // The fixture publishes five more than seen on Monday 17:00 to 21:00, in the silence: one run of columns at 5.
    expect(panel.querySelector('.sn-scale')!.textContent).toBe('5');
    const d = panel.querySelector('path.sn-cols-ghost')!.getAttribute('d')!;
    expect((d.match(/Z/g) ?? []).length).toBe(1);
    expect(d.startsWith(`M${minuteOf(Date.UTC(2026, 8, 28, 15, 0) / 1000) - 0.5} 100V0h1`)).toBe(true);
    const rows = [...panel.querySelectorAll('.st-table tbody tr')];
    expect(rows.length).toBe(112);
    const at17 = rows.find((r) => r.querySelector('th')!.textContent === 'pon 28. 9. u 17:00')!;
    expect([...at17.querySelectorAll('td')].map((c) => c.textContent)).toEqual(['5', '60 min']);
    const at07 = rows.find((r) => r.querySelector('th')!.textContent === 'pon 28. 9. u 07:00')!;
    expect([...at07.querySelectorAll('td')].map((c) => c.textContent)).toEqual(['0', '0 min']);
    // Before the first published minute (Sunday 22:07) there is nothing to compare.
    expect([...rows[0]!.querySelectorAll('td')].map((c) => c.textContent)).toEqual(['bez podatka', 'bez podatka']);
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
    expect([...root.querySelectorAll<HTMLElement>('.sn-panel')].map((p) => p.dataset.panel)).toEqual(['fleet', 'state', 'feed']);
    handle.setReadout(MARKS.monday0745 * 1000);
    expect(root.querySelector('.sn-strip-readout')!.textContent).not.toContain('bicikli');
    handle.destroy();
  });
});
