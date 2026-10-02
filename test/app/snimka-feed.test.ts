// Objave on the page (app/src/snimka/voices-feed.ts, V3-16): two levels, the
// current item (the latest at or before the instant: kicker, time, a 16 px
// title that is a headline's link, at most two chips and only on ZET, court
// and chapter items) over a compact log (time · kicker · title rows under
// day headings, chapters as heading rows); a click pauses, seeks, sets the
// subject and flies to a headline's place; the filter is one line "Samo
// linija 228 · skriveno n" with "Prikaži sve"; passive play adds items at
// most every 400 ms and slides the new current item in only without reduced
// motion.
import { Window } from 'happy-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SNIMKA_WINDOW, type HashedRef } from '../../shared/snimka';
import { createReplayClock } from '../../app/src/snimka/clock';
import { createViewStore, type SnimkaContext } from '../../app/src/snimka/context';
import type { FrameLoop } from '../../app/src/snimka/frames';
import { FEED_CADENCE_MS, mountVoicesFeed } from '../../app/src/snimka/voices-feed';
import { plural } from '../../app/src/snimka/format';
import { SN } from '../../app/src/snimka/strings';
import { buildSnimkaFixture, MARKS, zg } from '../../e2e/snimka-fixtures';

const fixture = buildSnimkaFixture();
const objects = fixture.objects;
let page: Window | null = null;
beforeAll(() => { page = new Window({ url: 'http://localhost/snimka/' }); });
afterAll(async () => { await page?.happyDOM.close(); });
afterEach(() => { vi.useRealTimers(); if (page) page.document.body.innerHTML = ''; });

function mount(at: number, o: { reducedMotion?: boolean; extraNews?: number; bare?: boolean } = {}) {
  const subs = new Set<(t: number) => void>();
  const frames: FrameLoop = { subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; }, kick() {}, destroy() {} };
  let wall = 0;
  const clock = createReplayClock({ start: SNIMKA_WINDOW.fromSec * 1000, end: SNIMKA_WINDOW.toSec * 1000, at: at * 1000, playing: false, now: () => wall });
  const news = objects.get(fixture.manifest.files.news.path) as SnimkaContext['news'];
  const extra = Array.from({ length: o.extraNews ?? 0 }, (_, i) => ({ ...news.items[0]!, id: `x${i}`, beat: null, pubSec: zg(9, 28, 9, 0) + i * 60, title: `Naslov ${i}` }));
  const ctx = {
    manifest: fixture.manifest,
    series: objects.get(fixture.manifest.files.series.path), routes: objects.get(fixture.manifest.files.routes.path),
    events: o.bare ? [] : (objects.get(fixture.manifest.files.events.path) as { events: SnimkaContext['events'] }).events,
    notices: o.bare ? { v: 2, items: [] } : objects.get(fixture.manifest.files.notices.path), news: { ...news, items: o.bare ? [] : [...news.items, ...extra] }, places: objects.get(fixture.manifest.files.places.path),
    clock, frames, view: createViewStore(), doc: page!.document as unknown as Document, reducedMotion: o.reducedMotion ?? false,
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
  const flown: unknown[] = [];
  const off = mountVoicesFeed(ctx, root, { flyTo: (f) => { flown.push(f); } });
  const emit = (t: number): void => { for (const fn of [...subs]) fn(t); };
  return { ctx, clock, root, off, emit, flown, setWall: (ms: number) => { wall = ms; } };
}
const logIds = (root: HTMLElement): string[] => [...root.querySelectorAll<HTMLElement>('.sn-feed-log > .sn-feed-row')].map((li) => li.dataset.id!);
/** The current item, then the log: the whole list newest first. */
const ids = (root: HTMLElement): string[] => [root.dataset.snFeedCurrent!, ...logIds(root)].filter(Boolean);

describe('mountVoicesFeed', () => {
  it('says nobody has spoken before the first item; then the latest is the current item over the log, newest first', () => {
    const early = mount(MARKS.windowStart, { bare: true });
    expect(early.root.querySelector<HTMLElement>('.sn-feed-empty')!.hidden).toBe(false);
    expect(early.root.querySelector('.sn-feed-empty')!.textContent).toBe('Do ovog trenutka nema objava.');
    expect(early.root.dataset.snFeedCount).toBe('0');
    expect(early.root.querySelector<HTMLElement>('.sn-feed-current')!.hidden).toBe(true);
    early.off();
    const { root, off } = mount(zg(9, 29, 12, 0));
    expect(root.querySelector('.sn-feed-title')!.textContent).toBe('Objave');
    expect(root.dataset.snFeedCurrent).toBe('news:v1');
    const current = root.querySelector<HTMLElement>('.sn-feed-current')!;
    expect(current.dataset.id).toBe('news:v1');
    expect(current.querySelector('.sn-feed-kind')!.textContent).toBe('Večernji list');
    expect(current.querySelector('.sn-feed-time')!.textContent).toBe('uto 29. 9. u 10:30');
    expect(current.querySelector('.sn-feed-seek')!.getAttribute('aria-label')).toBe('Idi na uto 29. 9. u 10:30');
    const a = current.querySelector<HTMLAnchorElement>('.sn-feed-headline a')!;
    expect(a.getAttribute('href')).toBe('https://www.vecernji.hr/zagreb/primjer-2');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttribute('target')).toBe('_blank');
    // No chips on a headline, no beat pill, no source line.
    expect(current.querySelector('.sn-feed-chips')).toBeNull();
    expect(current.querySelector('.sn-feed-beat, .sn-feed-source')).toBeNull();
    const log = logIds(root);
    expect(log).not.toContain('news:v1');
    expect(log[0]).toBe('event:linija-228');
    const times = [...root.querySelectorAll<HTMLElement>('.sn-feed-log > .sn-feed-row')].map((li) => Number(li.dataset.at));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeLessThanOrEqual(times[i - 1]!);
    expect(Number(root.dataset.snFeedCount)).toBe(log.length + 1);
    off();
  });
  it('the log: day headings, chapters as heading rows that seek, rows of time · kicker · title', () => {
    const { root, off, clock } = mount(zg(9, 29, 12, 0));
    const days = [...root.querySelectorAll<HTMLElement>('.sn-feed-log > .sn-feed-day')].map((d) => d.textContent);
    expect(days).toEqual(['uto 29. 9.', 'pon 28. 9.', 'ned 27. 9.']);
    const chapter = root.querySelector<HTMLElement>('.sn-feed-row[data-id="event:prvo-jutro"]')!;
    expect(chapter.querySelector('h4.sn-feed-chapter button')).not.toBeNull();
    expect(chapter.querySelector('.sn-feed-row-kind')!.textContent).toBe('Poglavlje');
    expect(chapter.querySelector('.sn-feed-row-time')!.textContent).toBe('07:45');
    const notice = root.querySelector<HTMLElement>('.sn-feed-row[data-id="notice:10164"]')!;
    expect(notice.dataset.tone).toBe('zet');
    expect(notice.querySelector('.sn-feed-row-kind')!.textContent).toBe('ZET');
    expect(root.querySelector<HTMLElement>('.sn-feed-row[data-id="news:j1"] .sn-feed-row-kind')!.textContent).toBe('Jutarnji list');
    expect(root.querySelector<HTMLElement>('.sn-feed-row[data-id="news:j1"]')!.dataset.tone).toBeUndefined();
    chapter.querySelector<HTMLButtonElement>('button')!.click();
    expect(clock.now()).toBe(MARKS.monday0745 * 1000);
    off();
  });
  it('chips: at most two, and only on ZET, court and chapter items; the court has its own tone', () => {
    const court = mount(zg(9, 30, 11, 14));
    const current = court.root.querySelector<HTMLElement>('.sn-feed-current')!;
    expect(current.dataset.id).toBe('event:sud');
    expect(current.dataset.tone).toBe('court');
    expect(current.querySelector('.sn-feed-kind')!.textContent).toBe('Poglavlje');
    const chips = current.querySelectorAll('.sn-fact-chip');
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThanOrEqual(2);
    court.off();
    const press = mount(zg(9, 28, 12, 31));
    expect(press.root.dataset.snFeedCurrent).toBe('news:j2');
    expect(press.root.querySelector('.sn-feed-current .sn-fact-chip')).toBeNull();
    press.off();
  });
  it('no cap: every item up to the clock is in the log, and the list scrolls', () => {
    const { root, off } = mount(zg(9, 28, 12, 0), { extraNews: 20 });
    const total = Number(root.dataset.snFeedCount);
    expect(ids(root).length).toBe(total);
    expect(total).toBeGreaterThan(20);
    expect(root.querySelector('.sn-feed-older')).toBeNull();
    off();
  });
  it('a click pauses, seeks, sets the subject; the filter is one line with Prikaži sve', () => {
    const { root, ctx, clock, off, emit } = mount(zg(9, 30, 12, 0));
    clock.play();
    root.querySelector<HTMLButtonElement>('.sn-feed-row[data-id="news:v1"] button')!.click();
    expect(clock.playing()).toBe(false);
    expect(clock.now()).toBe(zg(9, 29, 10, 30) * 1000);
    expect(ctx.view.get().subject).toEqual({ kind: 'route', id: '228' });
    emit(clock.now());
    expect(root.dataset.snFeedSubject).toBe('route:228');
    expect(root.dataset.snFeedCurrent).toBe('news:v1');
    const filter = root.querySelector<HTMLElement>('.sn-feed-filter')!;
    expect(filter.hidden).toBe(false);
    expect(filter.querySelector('.sn-feed-filter-text')!.textContent).toMatch(/^Samo linija 228 · skriveno \d+$/);
    expect(ids(root)).toEqual(['news:v1', 'event:linija-228']);
    expect(filter.querySelector('.sn-feed-hidden')).toBeNull();
    filter.querySelector<HTMLButtonElement>('.sn-feed-clear')!.click();
    expect(filter.querySelector<HTMLButtonElement>('.sn-feed-clear')!.textContent).toBe('Prikaži sve');
    expect(ctx.view.get().subject).toBeNull();
    expect(root.dataset.snFeedSubject).toBe('');
    expect(filter.hidden).toBe(true);
    off();
  });
  it('a headline about a place flies the map there; an item with no line keeps the subject as it was', () => {
    const { root, ctx, clock, off, flown, emit } = mount(zg(9, 30, 12, 0));
    root.querySelector<HTMLButtonElement>('.sn-feed-row[data-id="news:j2"] button')!.click();
    expect(clock.now()).toBe(zg(9, 28, 12, 30) * 1000);
    expect(flown).toEqual([{ kind: 'layer', layer: 'bikes' }]);
    expect(ctx.view.get().subject).toBeNull();
    emit(clock.now());
    // The current item's time button is the same click.
    root.querySelector<HTMLButtonElement>('.sn-feed-current .sn-feed-seek')!.click();
    expect(flown.length).toBe(2);
    // A chapter does not move the camera (the director does), nor does a headline with no place.
    root.querySelector<HTMLButtonElement>('.sn-feed-row[data-id="event:prvo-jutro"] button')!.click();
    expect(flown.length).toBe(2);
    off();
  });
  it('passive play adds items at most every 400 ms, several at once, sliding in; a seek draws at once without motion', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    // Twenty headlines a minute apart from Monday 09:00, played at ten minutes a second from 08:59.
    const { root, emit, off, clock, setWall } = mount(zg(9, 28, 8, 59), { extraNews: 20 });
    clock.play();
    const step = async (ms: number): Promise<void> => {
      await vi.advanceTimersByTimeAsync(ms);
      setWall(performance.now());
      emit(clock.now());
    };
    const first = ids(root);
    await step(FEED_CADENCE_MS + 10);   // 09:03:06: four headlines are due and arrive together
    const batch = ids(root);
    expect(batch.slice(0, 4)).toEqual(['news:x3', 'news:x2', 'news:x1', 'news:x0']);
    expect(batch.some((id) => id.startsWith('companion:'))).toBe(false);
    expect(first.every((id) => batch.includes(id))).toBe(true);
    expect(root.querySelector('.sn-feed-current')!.classList.contains('sn-feed-in')).toBe(true);
    await step(100);                    // 09:04:06: one more is due, but the cadence holds it
    expect(ids(root)).toEqual(batch);
    await vi.advanceTimersByTimeAsync(FEED_CADENCE_MS);
    expect(ids(root)[0]).toBe('news:x4');
    // A seek redraws in the same frame, and nothing slides.
    clock.seek(zg(9, 30, 12, 0) * 1000);
    emit(clock.now());
    expect(ids(root)[0]).toBe('news:n1');
    expect(root.querySelector('.sn-feed-current')!.classList.contains('sn-feed-in')).toBe(false);
    off();
  });
  it('under reduced motion nothing slides', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const { root, emit, off, clock, setWall } = mount(zg(9, 28, 8, 59), { reducedMotion: true, extraNews: 20 });
    clock.play();
    vi.advanceTimersByTime(FEED_CADENCE_MS + 10);
    setWall(performance.now());
    emit(clock.now());
    expect(ids(root)[0]).toBe('news:x3');
    expect(root.querySelector('.sn-feed-in')).toBeNull();
    off();
  });
  it('the folded headlines read in Croatian whatever their number', () => {
    expect(plural(1, SN.voices.moreForms).replace('{count}', '+1')).toBe('+1 sličan naslov');
    expect(plural(2, SN.voices.moreForms).replace('{count}', '+2')).toBe('+2 slična naslova');
    expect(plural(5, SN.voices.moreForms).replace('{count}', '+5')).toBe('+5 sličnih naslova');
  });
});
