// The timeline bar (app/src/snimka/timeline.ts, V3-18): the range laid over
// the fleet lane, the silhouette tinted by state with the dashed edge before
// the app published its own, the rug, one marker row (numbered chapter pins
// that seek, ZET/court dots; no press) from the fixed markersFor, the next
// chapter line, the ← → tooltips, the Poglavlja popover, the fullscreen
// icon, the day labels, the 6,720-minute scrubber and the keyboard map.
import { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SNIMKA_WINDOW } from '../../shared/snimka';
import { createReplayClock } from '../../app/src/snimka/clock';
import { createLayerStore, createViewStore, type SnimkaContext } from '../../app/src/snimka/context';
import { bandRuns, bindKeys, chapterTargets, dayMarks, markersFor, mountTimeline, nextLine, rugRuns, thin } from '../../app/src/snimka/timeline';
import { MARKS, buildEvents, buildNews, buildNotices, buildWindowSeries } from '../../e2e/snimka-fixtures';

const START = SNIMKA_WINDOW.fromSec * 1000;
const END = SNIMKA_WINDOW.toSec * 1000;
const series = buildWindowSeries();
const events = buildEvents().events;
const notices = buildNotices();
const news = buildNews();

describe('markersFor', () => {
  it('no longer throws: one row of chapter pins and ZET/court dots from the feed, in time order, no press', () => {
    const markers = markersFor({ events, notices, news });
    expect(markers.filter((m) => m.lane === 'chapter').map((m) => m.id)).toEqual(events.filter((e) => e.chapter && !e.internal).map((e) => `event:${e.id}`));
    expect(markers.filter((m) => m.lane === 'notice').map((m) => m.id)).toEqual(expect.arrayContaining(['notice:10164', 'notice:10168']));
    expect(markers.filter((m) => m.lane === 'press')).toEqual([]);
    expect(markers.every((m, i) => i === 0 || markers[i - 1]!.atSec <= m.atSec)).toBe(true);
  });
  it('the next chapter line and the ← → targets', () => {
    const ch = events.filter((e) => e.chapter && !e.internal).sort((a, b) => a.atSec - b.atSec);
    expect(nextLine(ch, MARKS.monday0745)).toBe('Sljedeće: 18:42 · ZET šalje podatke bez ijednog vozila');
    expect(nextLine(ch, MARKS.feedEmptyFrom)).toBe('Sljedeće: uto 29. 9. u 06:28 · ZET-ovi podaci se ne mijenjaju');
    expect(nextLine(ch, SNIMKA_WINDOW.toSec)).toBeNull();
    const clockChapters = ch.map((e) => ({ at: e.atSec * 1000, title: e.title }));
    expect(chapterTargets(clockChapters, MARKS.monday0745 * 1000)).toEqual({ prev: 'Početak štrajka', next: 'ZET šalje podatke bez ijednog vozila' });
    expect(chapterTargets(clockChapters, MARKS.monday0745 * 1000 + 5000).prev).toBe('Prvo jutro');
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
  it('the rug marks the minutes ZET sent no vehicles or its data stood still', () => {
    const rug = rugRuns(series);
    expect(rug.length).toBeGreaterThan(0);
    const m = (sec: number) => Math.floor((sec - series.t0) / 60);
    expect(rug.some((r) => r.from <= m(MARKS.feedFrozenFrom) && m(MARKS.feedFrozenFrom) < r.to)).toBe(true);
    expect(rug.some((r) => r.from <= m(MARKS.thursday0745) && m(MARKS.thursday0745) < r.to)).toBe(false);
  });
  it('the state runs cover every minute', () => {
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
    const frames = { subscribe: () => () => {}, kick() {}, destroy() {} };
    return { clock, frames, series, events, notices, news, manifest: { serviceLiveFromSec: MARKS.serviceLive }, doc: document, reducedMotion: false, layers: createLayerStore(), view: createViewStore() } as unknown as SnimkaContext;
  }
  it('the range lies over the fleet lane; the silhouette is tinted by state; one marker row; equal speed names', () => {
    const ctx = context();
    const root = document.createElement('div');
    document.body.append(root);
    const tl = mountTimeline(ctx, root);
    const range = root.querySelector<HTMLInputElement>('[data-sn="scrubber"]')!;
    expect(range.max).toBe('6720');
    expect(range.getAttribute('aria-valuetext')).toBe('pon 28. 9. u 07:45');
    // The lane is the track: the range and the fleet lane share one box.
    const track = root.querySelector<HTMLElement>('[data-sn="track"]')!;
    expect(range.parentElement).toBe(track);
    expect(track.querySelector('svg[data-sn="fleet-lane"]')).not.toBeNull();
    expect(root.querySelector('.sn-tl-band, .sn-tl-ticks, .sn-tl-cursor')).toBeNull();
    const tints = [...root.querySelectorAll('.sn-tl-svg rect.sn-tl-tint')].map((r) => r.getAttribute('class'));
    expect(tints.some((c) => c!.includes('sn-tl-tint-silent'))).toBe(true);
    expect(tints.some((c) => c!.includes('sn-tl-tint-normal'))).toBe(true);
    expect(root.querySelector('.sn-tl-svg g')!.getAttribute('clip-path')).toMatch(/^url\(#/);
    expect(root.querySelector('.sn-tl-retro')!.textContent).toBe('izračunano naknadno');
    expect(root.querySelector('.sn-tl-retro-edge')).not.toBeNull();
    expect(root.querySelector('[data-sn="rug"]')!.getAttribute('title')).toBe('ZET ne šalje podatke ili se ne osvježavaju');
    // One marker row: numbered pins, ZET/court dots.
    const marks = root.querySelector<HTMLElement>('[data-sn="marks"]')!;
    const pins = [...marks.querySelectorAll<HTMLButtonElement>('button.sn-tl-pin')];
    expect(pins.length).toBe(events.filter((e) => e.chapter && !e.internal).length);
    expect(pins.map((p) => p.textContent).slice(0, 3)).toEqual(['1', '2', '3']);
    expect(pins[0]!.getAttribute('aria-label')).toBe('Idi na: Večer prije');
    expect(marks.querySelectorAll('.sn-tl-dot').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('[data-sn="marks"]').length).toBe(1);
    // A pin seeks.
    ctx.clock.play();
    pins[3]!.click();
    expect(ctx.clock.playing()).toBe(false);
    expect(ctx.clock.now()).toBe(MARKS.monday0745 * 1000);
    // Play and pause words, the next line, the ← → tooltips, the speeds unchanged in words.
    expect(root.querySelector('[data-sn="play"]')!.textContent).toBe('Pokreni');
    tl.update(MARKS.monday0745 * 1000 + 60_000);
    expect(root.querySelector('[data-sn="next-chapter"]')!.textContent).toBe('Sljedeće: 18:42 · ZET šalje podatke bez ijednog vozila');
    expect(root.querySelector<HTMLButtonElement>('button[data-sn="next"]')!.title).toBe('Idi na: ZET šalje podatke bez ijednog vozila');
    expect(root.querySelector<HTMLButtonElement>('button[data-sn="prev"]')!.title).toBe('Idi na: Prvo jutro');
    expect([...root.querySelectorAll('.sn-tl-speed [data-speed] > span:first-child')].map((x) => x.textContent)).toEqual(['stvarno vrijeme', '1 min/s', '10 min/s', '1 h/s']);
    expect(root.querySelector('.sn-tl-speed [data-speed="600"]')!.getAttribute('aria-pressed')).toBe('true');
    // Fullscreen is a 44 px icon with its name in aria-label.
    const present = root.querySelector<HTMLButtonElement>('[data-sn="present"]')!;
    expect(present.getAttribute('aria-label')).toBe('Cijeli zaslon');
    expect(present.textContent).toBe('⛶');
    expect([...root.querySelectorAll('.sn-tl-day')].map((d) => d.textContent)).toEqual(['pon 28. 9.', 'uto 29. 9.', 'sri 30. 9.', 'čet 1. 10.', 'pet 2. 10.']);
    tl.update(END);
    expect(range.value).toBe('6720');
    // Scrubbing pauses and seeks.
    ctx.clock.play();
    range.value = '60';
    range.dispatchEvent(new Event('input'));
    expect(ctx.clock.playing()).toBe(false);
    expect(ctx.clock.now()).toBe(START + 60 * 60_000);
    root.querySelector<HTMLButtonElement>('.sn-tl-speed [data-speed="3600"]')!.click();
    expect(ctx.clock.speed()).toBe(3600);
    expect(root.querySelector<HTMLSelectElement>('[data-sn="speed-select"]')!.value).toBe('3600');
    tl.destroy();
    expect(root.querySelector('.sn-tl')).toBeNull();
  });
  it('Poglavlja opens the agenda as a popover: aria-current on the chapter, arrows move, Enter opens, Escape closes', () => {
    const ctx = context();
    const root = document.createElement('div');
    document.body.append(root);
    const opened: string[] = [];
    const tl = mountTimeline(ctx, root, undefined, { openChapter: (id) => opened.push(id) });
    const button = root.querySelector<HTMLButtonElement>('[data-sn="agenda"]')!;
    const pop = root.querySelector<HTMLElement>('[data-sn="agenda-pop"]')!;
    expect(button.textContent).toBe('Poglavlja');
    expect(pop.hidden).toBe(true);
    button.click();
    expect(pop.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const steps = [...pop.querySelectorAll<HTMLButtonElement>('.sn-agenda-step')];
    expect(steps.length).toBe(events.filter((e) => e.chapter && !e.internal).length);
    const current = pop.querySelector<HTMLButtonElement>('[aria-current="step"]')!;
    expect(current.dataset.chapter).toBe('prvo-jutro');
    expect(document.activeElement).toBe(current);
    current.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(steps[steps.indexOf(current) + 1]);
    (document.activeElement as HTMLButtonElement).click();
    expect(opened).toEqual(['bez-vozila']);
    expect(pop.hidden).toBe(true);
    button.click();
    pop.querySelector('.sn-agenda-step')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(pop.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    tl.destroy();
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
