// Zamjene (app/src/snimka/alternatives.ts): the stations that emptied first
// after Monday 05:00, the rail sentences per day, line 228 by the hour and
// the press beats, each on data whose answer is known by construction; then
// the section on a page: the ten rows, "Pokaži na karti" sets the subject,
// pauses and seeks, and the press items are links that open a new tab
// without the opener.
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BAJS_STEP_S, ROUTES_STEP_S, SNIMKA_WINDOW, type NewsFile, type ScreenIndex, type StationsFile } from '../../shared/snimka';
import { BAJS_MISSING, BAJS_NOT_RENTING, ROUTES_MISSING, encodeBajs, encodeRoutes } from '../../shared/snimka-codec';
import {
  LINE228_HOURS, MONDAY_FIVE_S, PRESS_BEATS, TUESDAY_S, emptiedFirst, mountAlternatives, pressByBeat, railByDay, route228ByHour, routeByHour,
} from '../../app/src/snimka/alternatives';
import { createLayerStore, createViewStore, type SnimkaContext } from '../../app/src/snimka/context';
import { buildBajs, buildNews, buildNotices, buildRoutes, buildSnimkaFixture, buildStations, buildWindowSeries, MARKS, zg } from '../../e2e/snimka-fixtures';

const T0 = SNIMKA_WINDOW.fromSec;
const N = (SNIMKA_WINDOW.minutes * 60) / BAJS_STEP_S;
const slotOf = (sec: number): number => (sec - T0) / BAJS_STEP_S;

function stations(n: number): StationsFile {
  return { v: 1, stations: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `Stanica ${String.fromCharCode(65 + i)}`, lon: 15.9, lat: 45.8, capacity: 10 })) };
}

describe('emptiedFirst', () => {
  it('takes the first fall to zero after 05:00 on that day, the earliest first, with the 05:00 count', () => {
    const five = slotOf(MONDAY_FIVE_S);
    const rows = [
      // s0: 6 at 05:00, empty at 07:00
      (j: number) => (j >= five + 24 ? 0 : 6),
      // s1: 3 at 05:00, empty at 06:00
      (j: number) => (j >= five + 12 ? 0 : 3),
      // s2: already empty at 05:00 and all day: it did not empty
      () => 0,
      // s3: empty at 05:00, refilled at 06:00, empty again at 08:00: counts at 08:00
      (j: number) => (j < five + 12 ? 0 : j < five + 36 ? 2 : 0),
      // s4: missing and not renting slots do not empty it; empties on Tuesday only (not that day)
      (j: number) => (j === five + 5 ? BAJS_MISSING : j === five + 6 ? BAJS_NOT_RENTING : j >= five + 24 * 12 ? 0 : 4),
      // s5: missing at 05:00, first known slot 4, empty at 06:00: the 05:00 count is no number
      (j: number) => (j <= five ? BAJS_MISSING : j >= five + 12 ? 0 : 4),
    ];
    const matrix = rows.map((f) => Uint8Array.from({ length: N }, (_, j) => f(j)));
    const bajs = encodeBajs(T0, BAJS_STEP_S, rows.map((_, i) => `s${i}`), matrix);
    const r = emptiedFirst(bajs, stations(6), MONDAY_FIVE_S);
    expect(r.map((s) => s.id)).toEqual(['s1', 's5', 's0', 's3']);
    // A tie at 06:00: the fuller station at 05:00 first, a station without a count after it.
    expect(r[0]).toEqual({ id: 's1', name: 'Stanica B', emptySec: MONDAY_FIVE_S + 3600, atFive: 3 });
    expect(r[1]!.atFive).toBeNull();
    expect(r[3]).toEqual({ id: 's3', name: 'Stanica D', emptySec: MONDAY_FIVE_S + 3 * 3600, atFive: 0 });
    expect(emptiedFirst(bajs, stations(6), MONDAY_FIVE_S, 2)).toHaveLength(2);
  });
  it('on the fixture: the seven stations that run dry (every ninth), in time order, each after 05:00 on Monday', () => {
    const bajs = buildBajs(buildWindowSeries());
    const r = emptiedFirst(bajs, buildStations(), MONDAY_FIVE_S);
    expect(r).toHaveLength(7);
    for (let i = 1; i < r.length; i++) expect(r[i]!.emptySec).toBeGreaterThanOrEqual(r[i - 1]!.emptySec);
    for (const s of r) {
      expect(s.emptySec).toBeGreaterThan(MONDAY_FIVE_S);
      expect(s.emptySec).toBeLessThan(zg(9, 29, 0, 0));
      expect(s.id).not.toBe('bajs-7'); // the station that never rents
    }
  });
});

describe('railByDay', () => {
  const run = (id: string, fromSec: number, rail?: number): ScreenIndex['runs'][number] => ({
    id, kind: 'slot', fromSec, toSec: fromSec + 600, readings: 30, file: { path: `screen/${id}.0123456789abcdef.json`, bytes: 1, sha256: '0'.repeat(64) },
    captures: { kiosk: null, phone: null }, summary: { sentences: rail === undefined ? { solar: 30 } : { rail, solar: 30 - rail }, departureRows: 3, liveRows: 0 },
  });
  it('sums the rail sentences per Zagreb day; a day with runs and none is a counted zero; a day without runs is absent', () => {
    const r = railByDay({ v: 1, runs: [run('a', zg(9, 28, 7, 45)), run('b', zg(9, 29, 7, 45), 4), run('c', zg(9, 29, 23, 50), 2), run('d', zg(9, 30, 0, 10), 1)] });
    expect(r).toEqual([
      { day: zg(9, 28, 0, 0), count: 0, runs: 1 },
      { day: zg(9, 29, 0, 0), count: 6, runs: 2 },
      { day: zg(9, 30, 0, 0), count: 1, runs: 1 },
    ]);
  });
});

describe('route228ByHour', () => {
  it('takes the most in motion and the most scheduled per hour; an hour without a known slot is null', () => {
    const t0 = TUESDAY_S;
    const n = 3 * 12;
    const seen = [Uint8Array.from({ length: n }, (_, j) => (j < 12 ? ROUTES_MISSING : j < 24 ? (j === 15 ? 3 : 1) : 0))];
    const expected = [Uint8Array.from({ length: n }, (_, j) => (j < 12 ? ROUTES_MISSING : 4))];
    const routes = encodeRoutes(t0, ROUTES_STEP_S, [{ id: '228', shortName: '228', type: 3 }], seen, expected);
    expect(route228ByHour(routes, t0, 4)).toEqual([
      { hourSec: t0, seen: null, expected: null },
      { hourSec: t0 + 3600, seen: 3, expected: 4 },
      { hourSec: t0 + 7200, seen: 0, expected: 4 },
      { hourSec: t0 + 10_800, seen: null, expected: null }, // past the file
    ]);
    expect(routeByHour(routes, '17', t0, 2).every((h) => h.seen === null && h.expected === null)).toBe(true);
  });
  it('on the fixture: nothing before Tuesday 09:56, two from then by day, 48 hours from Tuesday midnight', () => {
    const r = route228ByHour(buildRoutes());
    expect(r).toHaveLength(LINE228_HOURS);
    expect(r[0]!.hourSec).toBe(zg(9, 29, 0, 0));
    expect(r[8]!.seen).toBe(0); // 08:00
    expect(r[9]!.seen).toBe(0); // 09:00: the slot of 09:55 starts before 09:56
    expect(r[10]!.seen).toBe(2); // 10:00
    expect(r[3]!.seen).toBe(0); // the frame gap 03:00 to 03:05 is one missing slot; the rest of the hour counts
  });
});

describe('pressByBeat', () => {
  it('keeps the five beats in their order, each in time order, and leaves an empty beat out', () => {
    const item = (id: string, beat: string | null, pubSec: number): NewsFile['items'][number] => ({ id, outlet: 'n1', title: id, link: `https://n1info.hr/${id}`, pubSec, beat, focus: { kind: 'none' }, facts: [], mentions: {} });
    const groups = pressByBeat({ items: [item('b', 'taksi', 20), item('a', 'taksi', 10), item('c', 'bajs', 5), item('d', 'presuda', 1), item('e', null, 2)] });
    expect(groups.map((g) => g.beat)).toEqual(['taksi', 'bajs']);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(PRESS_BEATS).toEqual(['taksi', 'volonteri', 'skole', 'guzve', 'bajs']);
  });
});

describe('the section on a page', () => {
  // This file runs in node (the fixture reads files from disk); the section gets a happy-dom document of its own,
  // without IntersectionObserver so the lazy BAJS load runs at once.
  let win: Window;
  let document: Document;
  const g = globalThis as Record<string, unknown>;
  let before: unknown;
  beforeEach(() => {
    win = new Window({ url: 'http://localhost/snimka/' });
    delete (win as unknown as Record<string, unknown>).IntersectionObserver;
    document = win.document as unknown as Document;
    before = g.document;
    g.document = document;
  });
  afterEach(() => {
    g.document = before;
    void win.happyDOM.close();
  });
  function context(): { ctx: SnimkaContext; clock: { pause: ReturnType<typeof vi.fn>; seek: ReturnType<typeof vi.fn> } } {
    const fixture = buildSnimkaFixture();
    const clock = { pause: vi.fn(), seek: vi.fn() };
    const ctx = {
      manifest: fixture.manifest, routes: buildRoutes(), notices: buildNotices(), news: buildNews(),
      data: { get: (ref: { path: string } | string, decode?: (raw: unknown) => unknown) => {
        const raw = fixture.objects.get(typeof ref === 'string' ? ref : ref.path);
        return raw === undefined ? Promise.reject(new Error('404')) : Promise.resolve(decode ? decode(raw) : raw);
      }, url: (ref: { path: string }) => ref.path },
      view: createViewStore(), layers: createLayerStore(), clock, doc: document, reducedMotion: true,
    } as unknown as SnimkaContext;
    return { ctx, clock };
  }
  it('draws the stations that emptied, and "Pokaži na karti" sets the station subject, pauses and seeks to its minute', async () => {
    document.body.innerHTML = '<div data-sn-stage></div><div data-sn-mount="alternatives" aria-busy="true"></div>';
    const root = document.querySelector<HTMLElement>('[data-sn-mount="alternatives"]')!;
    const { ctx, clock } = context();
    const off = mountAlternatives(ctx, root);
    expect(root.hasAttribute('aria-busy')).toBe(false);
    await vi.waitFor(() => expect(root.querySelectorAll('#zamjene-bajs tbody tr')).toHaveLength(7));
    const first = root.querySelector<HTMLTableRowElement>('#zamjene-bajs tbody tr')!;
    const button = first.querySelector('button')!;
    expect(button.textContent).toBe('Pokaži na karti');
    expect(button.getAttribute('aria-label')).toMatch(/^Pokaži na karti: Stanica \d+$/);
    button.click();
    expect(ctx.view.get().subject).toEqual({ kind: 'station', id: first.dataset.station });
    expect(clock.pause).toHaveBeenCalled();
    const seekMs = clock.seek.mock.calls[0]![0] as number;
    expect(seekMs).toBeGreaterThan(MONDAY_FIVE_S * 1000);
    expect(seekMs % (BAJS_STEP_S * 1000)).toBe(0);
    // The rail days arrive with the screen index; line 228 has 48 columns and the notice link.
    await vi.waitFor(() => expect(root.querySelector('#zamjene-vlak .sn-alt-days, #zamjene-vlak .st-empty')).not.toBeNull());
    expect(root.querySelectorAll('#zamjene-228 .st-col')).toHaveLength(LINE228_HOURS);
    const notice = root.querySelector<HTMLAnchorElement>('#zamjene-228 .sn-alt-source a')!;
    expect(notice.href).toContain('10166');
    off();
  });
  it('lists the press beats as links with rel noopener noreferrer, titles verbatim', () => {
    document.body.innerHTML = '<div data-sn-mount="alternatives"></div>';
    const root = document.querySelector<HTMLElement>('[data-sn-mount="alternatives"]')!;
    const { ctx } = context();
    mountAlternatives(ctx, root);
    const links = [...root.querySelectorAll<HTMLAnchorElement>('#zamjene-mediji a')];
    const expected = ctx.news.items.filter((i) => (PRESS_BEATS as readonly string[]).includes(i.beat ?? ''));
    expect(links).toHaveLength(expected.length);
    for (const a of links) {
      expect(a.rel).toBe('noopener noreferrer');
      expect(a.target).toBe('_blank');
    }
    if (expected.length > 0) expect(links.map((a) => a.firstChild!.textContent)).toEqual(expect.arrayContaining(expected.map((i) => i.title)));
    void MARKS;
  });
});
