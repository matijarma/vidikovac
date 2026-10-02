// The stage's composition (app/src/snimka/stage.ts, V3-11, V3-12, V3-18): one
// row of three chips that are the legend ("● Vozila 2", "● Običan dan 394",
// "◐ Bicikli", "bez podatka" when unknown), the one foot line under the map
// only when it applies, the plate's chapter line for three replay hours and
// never for a recording-internal chapter, the subtitle inside the map box,
// the deck before Objave in the DOM, and autoplay held until the map box is
// half in view.
import { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SNIMKA_WINDOW, type HashedRef } from '../../shared/snimka';
import { createReplayClock } from '../../app/src/snimka/clock';
import { createLayerStore, createViewStore, type SnimkaContext } from '../../app/src/snimka/context';
import type { FrameLoop } from '../../app/src/snimka/frames';
import { chipCount, footLine, legendCountsAt, mountStage, PLATE_CHAPTER_S, plateChapterAt, startWhenVisible } from '../../app/src/snimka/stage';
import { buildEvents, buildSnimkaFixture, MARKS, zg } from '../../e2e/snimka-fixtures';

const events = buildEvents().events;
const fixture = buildSnimkaFixture();
const objects = fixture.objects;

describe('plateChapterAt', () => {
  it('the chapter for three replay hours after it starts, then nothing', () => {
    expect(PLATE_CHAPTER_S).toBe(3 * 3600);
    expect(plateChapterAt(events, MARKS.monday0745)).toBe('Prvo jutro');
    expect(plateChapterAt(events, MARKS.monday0745 + 3 * 3600)).toBe('Prvo jutro');
    expect(plateChapterAt(events, MARKS.monday0745 + 3 * 3600 + 60)).toBeNull();
  });
  it('never a recording-internal chapter: the one before it ages out as usual', () => {
    // Tue 23:17 "Aplikacija dobiva stanje usluge" is internal; the line before it (Tue 09:56) is older than three hours.
    expect(plateChapterAt(events, MARKS.serviceLive + 60)).toBeNull();
    expect(plateChapterAt([{ atSec: 0, chapter: true, internal: true, title: 'x' }], 10)).toBeNull();
  });
});

describe('footLine and the chip counts', () => {
  const ok = { vehicles: 2, ghosts: 394, bikes: 'ok' as const };
  const on = { compare: true, bikes: true };
  it('one line only when it applies, in order: 1 h/s, Sunday, the comparison gap, bikes missing', () => {
    const mon = MARKS.monday0745;
    expect(footLine({ atSec: mon, speed: 600, layers: on, counts: ok, hasComparison: true })).toBeNull();
    expect(footLine({ atSec: mon, speed: 3600, layers: on, counts: ok, hasComparison: true })).toEqual({ key: 'speed', text: 'Pri satu u sekundi karta pokazuje samo bicikle; vozila se vide pri 10 min/s i sporije.' });
    expect(footLine({ atSec: zg(9, 27, 21, 0), speed: 600, layers: on, counts: { ...ok, bikes: 'missing' }, hasComparison: true })?.text).toBe('Nedjelja nema usporedbe.');
    expect(footLine({ atSec: mon, speed: 600, layers: on, counts: { ...ok, ghosts: null }, hasComparison: true })?.text).toBe('Običan dan: bez zapisa za ovo doba.');
    expect(footLine({ atSec: mon, speed: 600, layers: on, counts: { ...ok, bikes: 'missing' }, hasComparison: true })?.text).toBe('Bicikli: bez podataka do 22:05.');
    // A layer that is off says nothing.
    expect(footLine({ atSec: mon, speed: 600, layers: { compare: false, bikes: false }, counts: { ...ok, ghosts: null, bikes: 'missing' }, hasComparison: true })).toBeNull();
  });
  it('a count is the number or "bez podatka", never 0 for missing', () => {
    expect(chipCount(394)).toBe('394');
    expect(chipCount(0)).toBe('0');
    expect(chipCount(null)).toBe('bez podatka');
  });
  it('the series alone gives the counts until the map answers', () => {
    const ctx = { series: objects.get(fixture.manifest.files.series.path), comparisons: [] } as unknown as SnimkaContext;
    const c = legendCountsAt(ctx, MARKS.monday0745);
    expect(c.vehicles).toBe((ctx.series.seen.all[Math.floor((MARKS.monday0745 - ctx.series.t0) / 60)]) ?? null);
    expect(c.ghosts).toBeNull();
    expect(legendCountsAt(ctx, zg(9, 27, 21, 0)).bikes).toBe('missing');
  });
});

describe('mountStage (lightweight)', () => {
  let page: Window | null = null;
  beforeAll(() => { page = new Window({ url: 'http://localhost/snimka/', width: 1366, height: 900 }); });
  afterAll(async () => { await page?.happyDOM.close(); });
  function mount(at: number, playing = false) {
    const subs = new Set<(t: number) => void>();
    const frames: FrameLoop = { subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; }, kick() {}, destroy() {} };
    const evs = (objects.get(fixture.manifest.files.events.path) as { events: SnimkaContext['events'] }).events;
    const clock = createReplayClock({ start: SNIMKA_WINDOW.fromSec * 1000, end: SNIMKA_WINDOW.toSec * 1000, at: at * 1000, playing, now: () => 0, chapters: evs.filter((e) => e.chapter).map((e) => ({ at: e.atSec * 1000, title: e.title, id: e.id })) });
    const ctx = {
      manifest: fixture.manifest,
      series: objects.get(fixture.manifest.files.series.path), routes: objects.get(fixture.manifest.files.routes.path), comparisons: [],
      events: evs, notices: objects.get(fixture.manifest.files.notices.path), news: objects.get(fixture.manifest.files.news.path), places: objects.get(fixture.manifest.files.places.path),
      clock, frames, layers: createLayerStore(), view: createViewStore(), lagano: true, reducedMotion: false,
      theme: { resolved: () => 'light', onChange: () => () => {} },
      doc: page!.document as unknown as Document,
      data: {
        url: (r: HashedRef | string) => String(typeof r === 'string' ? r : r.path),
        get: async <T,>(r: HashedRef | string, decode?: (raw: unknown) => T): Promise<T> => {
          const path = typeof r === 'string' ? r : r.path;
          if (!objects.has(path)) throw new Error(`404 ${path}`);
          return decode ? decode(objects.get(path)) : (objects.get(path) as T);
        },
      },
    } as unknown as SnimkaContext;
    const root = page!.document.createElement('div') as unknown as HTMLElement;
    page!.document.body.append(root as never);
    const off = mountStage(ctx, root);
    return { ctx, root, off };
  }
  it('three chips as the legend, no group labels, no Živa mreža or Zatvorene ulice; the plate; the slots in order', () => {
    const { root, ctx, off } = mount(MARKS.monday0745);
    const chips = [...root.querySelectorAll<HTMLButtonElement>('[data-sn="layers"] .sn-chip')];
    expect(chips.map((c) => c.dataset.layer)).toEqual(['vehicles', 'compare', 'bikes']);
    const seen = ctx.series.seen.all[Math.floor((MARKS.monday0745 - ctx.series.t0) / 60)]!;
    expect(chips[0]!.textContent).toBe(`● Vozila ${seen}`);
    expect(chips[1]!.textContent).toBe('● Običan dan bez podatka');
    expect(chips[2]!.textContent).toBe('◐ Bicikli');
    for (const c of chips) expect(c.getAttribute('aria-pressed')).toBe('true');
    expect(root.textContent).not.toMatch(/Živa mreža|Zatvorene ulice|Karta prati snimku|Kaj ima\? izvodi/);
    expect(root.querySelector('.sn-chip-label, .sn-legend-words')).toBeNull();
    expect(root.querySelector('.sn-plate-chapter')!.textContent).toBe('Prvo jutro');
    // The subtitle rides inside the map box; the deck comes before Objave.
    expect(root.querySelector('.sn-map-box [data-sn-slot="subtitle"]')).not.toBeNull();
    const order = [...root.querySelectorAll<HTMLElement>('[data-sn-slot]')].map((s) => s.dataset.snSlot);
    expect(order.indexOf('deck')).toBeLessThan(order.indexOf('voices'));
    chips[2]!.click();
    expect(ctx.layers.get().bikes).toBe(false);
    expect(chips[2]!.getAttribute('aria-pressed')).toBe('false');
    off();
  });
  it('the plate\'s chapter line is empty three hours after a chapter', () => {
    const { root, off } = mount(MARKS.monday0745 + 3 * 3600 + 120);
    expect(root.querySelector('.sn-plate-chapter')!.textContent).toBe('');
    off();
  });
});

describe('startWhenVisible', () => {
  let page: Window | null = null;
  beforeAll(() => { page = new Window({ url: 'http://localhost/snimka/', width: 390, height: 844 }); });
  afterAll(async () => { await page?.happyDOM.close(); });
  const box = (top: number, height: number): HTMLElement => {
    const el = page!.document.createElement('div') as unknown as HTMLElement;
    el.getBoundingClientRect = () => ({ top, bottom: top + height, height, left: 0, right: 390, width: 390, x: 0, y: top, toJSON() {} }) as DOMRect;
    return el;
  };
  const clockAt = (playing: boolean) => createReplayClock({ start: 0, end: 1e9, at: 1000, playing, now: () => 0 });
  it('a clock already in view plays on; one below the fold waits, paused, and plays once the box is half in view', async () => {
    const inView = clockAt(true);
    startWhenVisible({ clock: inView }, box(100, 400));
    expect(inView.playing()).toBe(true);
    const below = clockAt(true);
    let reveal!: () => void;
    startWhenVisible({ clock: below }, box(900, 470), () => new Promise<void>((r) => { reveal = r; }));
    expect(below.playing()).toBe(false);
    reveal();
    await Promise.resolve();
    await Promise.resolve();
    expect(below.playing()).toBe(true);
  });
  it('a reader\'s own seek cancels the wait; a paused clock is left alone', async () => {
    const c = clockAt(true);
    let reveal!: () => void;
    startWhenVisible({ clock: c }, box(900, 470), () => new Promise<void>((r) => { reveal = r; }));
    c.seek(5000);
    reveal();
    await Promise.resolve();
    await Promise.resolve();
    expect(c.playing()).toBe(false);
    const paused = clockAt(false);
    startWhenVisible({ clock: paused }, box(900, 470), () => Promise.resolve());
    await Promise.resolve();
    expect(paused.playing()).toBe(false);
  });
});
