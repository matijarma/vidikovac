// The timeline bar (app/src/snimka/timeline.ts): the three tick lanes from
// the dataset (chapters; ZET's notices with the court; the press), the day
// labels (Sunday's four hours left unlabelled), the thinned fleet lane that
// keeps a gap a gap, the 6,720-minute scrubber and the keyboard map.
import { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SNIMKA_WINDOW } from '../../shared/snimka';
import { createReplayClock } from '../../app/src/snimka/clock';
import { createLayerStore, createViewStore, type SnimkaContext } from '../../app/src/snimka/context';
import { bandRuns, bindKeys, dayMarks, LANES, mountTimeline, thin, timelineMarkers } from '../../app/src/snimka/timeline';
import { MARKS, buildEvents, buildNews, buildNotices, buildWindowSeries } from '../../e2e/snimka-fixtures';

const START = SNIMKA_WINDOW.fromSec * 1000;
const END = SNIMKA_WINDOW.toSec * 1000;
const series = buildWindowSeries();
const events = buildEvents().events;
const notices = buildNotices();
const news = buildNews();

describe('timelineMarkers', () => {
  const markers = timelineMarkers({ events, notices, news });
  it('puts the chapters, the notices with the court and the press on their own lanes, in time order', () => {
    expect(LANES).toEqual(['chapter', 'notice', 'press']);
    expect(markers.filter((m) => m.lane === 'chapter').map((m) => m.id)).toEqual(events.filter((e) => e.chapter).map((e) => e.id));
    const noticeIds = markers.filter((m) => m.lane === 'notice').map((m) => m.id);
    expect(noticeIds).toEqual(expect.arrayContaining(notices.items.map((n) => `zet-${n.id}`)));
    for (const e of events.filter((x) => x.kind === 'court' && !x.chapter)) expect(noticeIds).toContain(e.id);
    expect(markers.filter((m) => m.lane === 'press')).toHaveLength(news.items.length);
    expect(markers.every((m, i) => i === 0 || markers[i - 1]!.atSec <= m.atSec)).toBe(true);
  });
});

describe('dayMarks, thin and the band', () => {
  it('labels the five midnights of the window and leaves Sunday evening unlabelled', () => {
    const marks = dayMarks(START, END);
    expect(marks.map((m) => m.label)).toEqual(['pon 28. 9.', 'uto 29. 9.', 'sri 30. 9.', 'čet 1. 10.', 'pet 2. 10.']);
    expect(marks[0]!.x).toBeCloseTo(4 / 112, 6);
    expect(dayMarks(START - 4 * 3_600_000, END)[0]!.label).toBe('ned 27. 9.');
  });
  it('thins five minutes to their largest value and keeps a gap a gap', () => {
    expect(thin([1, 5, 2, null, 3, null, null, null, null, null, 7], 5)).toEqual([5, null, 7]);
    expect(thin(series.seen.all).length).toBe(series.n / 5);
  });
  it('the state band falls back to the series runs and covers every minute', () => {
    const runs = bandRuns(series);
    expect(runs[0]!.from).toBe(0);
    expect(runs.reduce((a, r) => a + (r.to - r.from), 0)).toBe(series.n);
    expect(runs.some((r) => r.cls === 'silent')).toBe(true);
  });
});

describe('mountTimeline and bindKeys', () => {
  const DOM = ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'DOMRect'] as const;
  let page: Window | null = null;
  beforeAll(() => {
    page = new Window({ url: 'http://localhost/snimka/', width: 1366, height: 900 });
    const g = globalThis as Record<string, unknown>;
    for (const key of DOM) g[key] = key === 'window' ? page : (page as unknown as Record<string, unknown>)[key];
  });
  afterAll(async () => {
    const g = globalThis as Record<string, unknown>;
    for (const key of DOM) delete g[key];
    await page?.happyDOM.close();
  });
  function context() {
    const chapters = events.filter((e) => e.chapter).map((e) => ({ at: e.atSec * 1000, title: e.title, id: e.id }));
    const clock = createReplayClock({ start: START, end: END, at: MARKS.monday0745 * 1000, now: () => 0, chapters });
    return { clock, series, events, notices, news, doc: document, reducedMotion: false, layers: createLayerStore(), view: createViewStore() } as unknown as SnimkaContext;
  }
  it('draws the controls, the 6,720-minute scrubber, the fleet lane, the band, three tick lanes and five day labels', () => {
    const ctx = context();
    const root = document.createElement('div');
    document.body.append(root);
    const tl = mountTimeline(ctx, root);
    const range = root.querySelector<HTMLInputElement>('[data-sn="scrubber"]')!;
    expect(range.max).toBe('6720');
    expect(range.getAttribute('aria-valuetext')).toBe('pon 28. 9. u 07:45');
    expect(root.querySelector('[data-sn="play"]')!.textContent).toBe('Pokreni');
    expect(root.querySelectorAll('.sn-tl-speed [data-speed]')).toHaveLength(4);
    expect(root.querySelector('.sn-tl-speed [data-speed="600"]')!.getAttribute('aria-pressed')).toBe('true');
    expect([...root.querySelectorAll<HTMLElement>('.sn-tl-ticks')].map((l) => l.dataset.lane)).toEqual(['chapter', 'notice', 'press']);
    expect(root.querySelector('.sn-tl-lanes')!.getAttribute('aria-hidden')).toBe('true');
    const ticks = root.querySelectorAll<HTMLElement>('.sn-tl-ticks[data-lane="chapter"] .sn-tl-tick');
    expect(ticks.length).toBe(events.filter((e) => e.chapter).length);
    expect(ticks[0]!.title).toMatch(/^\S+ \d+\. \d+\. \d\d:\d\d · /);
    expect([...root.querySelectorAll('.sn-tl-day')].map((d) => d.textContent)).toEqual(['pon 28. 9.', 'uto 29. 9.', 'sri 30. 9.', 'čet 1. 10.', 'pet 2. 10.']);
    expect(root.querySelector('.sn-tl-svg path.sn-tl-seen')!.getAttribute('d')!.length).toBeGreaterThan(10);
    tl.update(END);
    expect(range.value).toBe('6720');
    expect(root.querySelector<HTMLElement>('.sn-tl-cursor')!.style.transform).toBe('translateX(100.000%)');
    // Scrubbing pauses and seeks.
    ctx.clock.play();
    range.value = '60';
    range.dispatchEvent(new Event('input'));
    expect(ctx.clock.playing()).toBe(false);
    expect(ctx.clock.now()).toBe(START + 60 * 60_000);
    // The speed buttons set the clock.
    root.querySelector<HTMLButtonElement>('.sn-tl-speed [data-speed="3600"]')!.click();
    expect(ctx.clock.speed()).toBe(3600);
    expect(root.querySelector<HTMLSelectElement>('[data-sn="speed-select"]')!.value).toBe('3600');
    tl.destroy();
    expect(root.querySelector('.sn-tl')).toBeNull();
  });
  it('the keyboard map steps, walks the chapters, picks a speed and leaves a text field alone', () => {
    const ctx = context();
    const root = document.createElement('div');
    document.body.append(root);
    const off = bindKeys(ctx, root);
    const key = (code: string, extra: KeyboardEventInit = {}, target: Element = root) => target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...extra }));
    key('Comma');
    expect(ctx.clock.now()).toBe(MARKS.monday0745 * 1000 - 60_000);
    key('Period', { shiftKey: true });
    expect(ctx.clock.now()).toBe(MARKS.monday0745 * 1000 + 9 * 60_000);
    key('Digit4');
    expect(ctx.clock.speed()).toBe(3600);
    key('KeyJ');
    expect(ctx.clock.now()).toBe(MARKS.monday0745 * 1000);
    key('Space');
    expect(ctx.clock.playing()).toBe(true);
    const input = document.createElement('input');
    root.append(input);
    key('Digit1', {}, input);
    expect(ctx.clock.speed()).toBe(3600);
    off();
  });
});
