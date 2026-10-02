// The voices feed on the page (app/src/snimka/voices-feed.ts): newest on top,
// filling as the clock passes, each item with its kind word, tone, time,
// title (headlines as external links), source line and chips; fourteen
// visible and the rest under "Starije"; a click pauses, seeks and sets the
// subject; the header names the subject with "Sve teme"; passive play adds
// items at most every 400 ms, and slides them in only without reduced motion.
import { Window } from 'happy-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SNIMKA_WINDOW, type HashedRef } from '../../shared/snimka';
import { createReplayClock } from '../../app/src/snimka/clock';
import { createViewStore, type SnimkaContext } from '../../app/src/snimka/context';
import type { FrameLoop } from '../../app/src/snimka/frames';
import { FEED_CADENCE_MS, FEED_COPY, mountVoicesFeed } from '../../app/src/snimka/voices-feed';
import { plural } from '../../app/src/snimka/format';
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
  const off = mountVoicesFeed(ctx, root);
  const emit = (t: number): void => { for (const fn of [...subs]) fn(t); };
  return { ctx, clock, root, off, emit, setWall: (ms: number) => { wall = ms; } };
}
const ids = (root: HTMLElement): string[] => [...root.querySelectorAll<HTMLElement>('.sn-feed-list:not(.sn-feed-older-list) > .sn-feed-item')].map((li) => li.dataset.id!);

describe('mountVoicesFeed', () => {
  it('says nobody has spoken before the first item, then fills newest on top with kind, tone, time and title', () => {
    const early = mount(MARKS.windowStart, { bare: true });
    expect(early.root.querySelector<HTMLElement>('.sn-feed-empty')!.hidden).toBe(false);
    expect(early.root.querySelector('.sn-feed-empty')!.textContent).toBe('Još se nitko nije oglasio.');
    expect(early.root.dataset.snFeedCount).toBe('0');
    early.off();
    const { root, off } = mount(zg(9, 29, 12, 0));
    const shown = ids(root);
    expect(shown[0]).toBe('news:v1');
    expect(shown).toContain('notice:10166');
    const times = [...root.querySelectorAll<HTMLElement>('.sn-feed-list > .sn-feed-item')].map((li) => Number(li.dataset.at));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeLessThanOrEqual(times[i - 1]!);
    const v1 = root.querySelector<HTMLElement>('[data-id="news:v1"]')!;
    expect(v1.classList.contains('sn-feed-tone-press')).toBe(true);
    expect(v1.querySelector('.sn-feed-kind')!.textContent).toBe('Mediji');
    expect(v1.querySelector('.sn-feed-beat')!.textContent).toBe('Linija 228');
    expect(v1.querySelector('.sn-feed-time')!.textContent).toBe('uto 29. 9. u 10:30');
    expect(v1.querySelector('.sn-feed-seek')!.getAttribute('aria-label')).toBe('Premjesti snimku na uto 29. 9. u 10:30');
    const a = v1.querySelector<HTMLAnchorElement>('.sn-feed-headline a')!;
    expect(a.getAttribute('href')).toBe('https://www.vecernji.hr/zagreb/primjer-2');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.textContent).toContain('ZET uveo autobusnu liniju do Rebra');
    expect(v1.querySelector('.sn-feed-source')!.textContent).toBe('Večernji list');
    expect(v1.querySelector('.sn-feed-chips')!.getAttribute('aria-label')).toBe('U minuti objave');
    expect(v1.querySelector('.sn-feed-chips')!.textContent).toContain('linija 228: 2 od 4');
    const court = mount(zg(9, 30, 12, 0));
    expect(court.root.querySelector('[data-id="event:sud"]')!.classList.contains('sn-feed-tone-court')).toBe(true);
    expect(court.root.querySelector('[data-id="event:sud"] .sn-feed-kind')!.textContent).toBe('Sud');
    expect(court.root.querySelector('[data-id="notice:10166"] .sn-feed-kind')!.textContent).toBe('ZET');
    // The chips before the live state carry the word for afterwards.
    expect(court.root.querySelector('[data-id="event:pocetak"] .sn-fact-chip[data-retro="true"]')!.textContent).toContain('naknadno');
    court.off();
    off();
  });
  it('fourteen visible, the rest under Starije, drawn when it opens', () => {
    const { root, off } = mount(zg(9, 28, 12, 0), { extraNews: 20 });
    expect(ids(root).length).toBe(14);
    const older = root.querySelector<HTMLDetailsElement>('.sn-feed-older')!;
    expect(older.hidden).toBe(false);
    const total = Number(root.dataset.snFeedCount);
    expect(older.querySelector('summary')!.textContent).toBe(`Starije (${total - 14})`);
    expect(older.querySelectorAll('.sn-feed-item').length).toBe(0);
    older.open = true;
    older.dispatchEvent(new page!.Event('toggle') as unknown as Event);
    expect(older.querySelectorAll('.sn-feed-item').length).toBe(total - 14);
    off();
  });
  it('a click pauses, seeks to the item\'s minute and sets its line as the subject; Sve teme clears it', () => {
    const { root, ctx, clock, off, emit } = mount(zg(9, 30, 12, 0));
    clock.play();
    const v1 = root.querySelector<HTMLElement>('[data-id="news:v1"]')!;
    v1.querySelector<HTMLElement>('.sn-feed-headline')!.click();
    expect(clock.playing()).toBe(false);
    expect(clock.now()).toBe(zg(9, 29, 10, 30) * 1000);
    expect(ctx.view.get().subject).toEqual({ kind: 'route', id: '228' });
    emit(clock.now());
    expect(root.dataset.snFeedSubject).toBe('route:228');
    const filter = root.querySelector<HTMLElement>('.sn-feed-filter')!;
    expect(filter.hidden).toBe(false);
    expect(filter.querySelector('.sn-feed-filter-text')!.textContent).toBe('Tema: Linija 228');
    expect(ids(root)).toEqual(['news:v1', 'notice:10166']);
    const hidden = Number(root.dataset.snFeedCount);
    expect(hidden).toBe(2);
    expect(filter.querySelector('.sn-feed-hidden')!.textContent).toMatch(/^\d+ stavk[aei] bez te teme$/);
    filter.querySelector<HTMLButtonElement>('.sn-feed-clear')!.click();
    expect(ctx.view.get().subject).toBeNull();
    expect(root.dataset.snFeedSubject).toBe('');
    expect(filter.hidden).toBe(true);
    // A link keeps its own click: no seek.
    const before = clock.now();
    root.querySelector<HTMLElement>('[data-id="news:n1"] .sn-feed-headline a')?.dispatchEvent(new page!.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event);
    expect(clock.now()).toBe(before);
    off();
  });
  it('an item with no line keeps the subject as it was; the time button is the keyboard form of the click', () => {
    const { root, ctx, clock, off } = mount(zg(9, 30, 12, 0));
    ctx.view.set({ subject: { kind: 'route', id: '17' } });
    ctx.view.set({ subject: null });
    root.querySelector<HTMLButtonElement>('[data-id="event:prvo-jutro"] .sn-feed-seek')!.click();
    expect(clock.now()).toBe(MARKS.monday0745 * 1000);
    expect(ctx.view.get().subject).toBeNull();
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
    // The companion's own voice of Monday 07:30 arrived with its day file meanwhile.
    expect(batch).toContain('companion:1790573400');
    expect(first.every((id) => batch.includes(id))).toBe(true);
    expect(root.querySelector('[data-id="news:x3"]')!.classList.contains('sn-feed-in')).toBe(true);
    await step(100);                    // 09:04:06: one more is due, but the cadence holds it
    expect(ids(root)).toEqual(batch);
    await vi.advanceTimersByTimeAsync(FEED_CADENCE_MS);
    expect(ids(root)[0]).toBe('news:x4');
    // A seek redraws in the same frame, and nothing slides.
    clock.seek(zg(9, 30, 12, 0) * 1000);
    emit(clock.now());
    expect(ids(root)[0]).toBe('news:n1');
    expect(root.querySelector('.sn-feed-list > .sn-feed-item.sn-feed-in:first-child')).toBeNull();
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
    expect(plural(1, FEED_COPY.more).replace('{count}', '+1')).toBe('+1 naslov iste teme');
    expect(plural(3, FEED_COPY.more).replace('{count}', '+3')).toBe('+3 naslova iste teme');
    expect(plural(1, FEED_COPY.hidden).replace('{count}', '1')).toBe('1 stavka bez te teme');
    expect(plural(3, FEED_COPY.hidden).replace('{count}', '3')).toBe('3 stavke bez te teme');
    expect(plural(7, FEED_COPY.hidden).replace('{count}', '7')).toBe('7 stavki bez te teme');
  });
});
