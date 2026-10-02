// The block "Čime se moglo umjesto tramvaja" (app/src/snimka/alternatives.ts,
// v3): the stations ranked by empty hours on Monday 06 to 20 h against the
// same hours on Thursday 1 October, the names in normal capitalisation, line
// 228 over its timetable's silhouette, six press links in three beats, each on
// data whose answer is known by construction; then the block on a page: the
// rows, "Pokaži na karti" (the name on a phone) sets the subject, pauses and
// seeks, the press items are links that open a new tab without the opener,
// and the tiles' seek binding fires once.
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BAJS_STEP_S, SNIMKA_WINDOW, type NewsFile, type StationsFile } from '../../shared/snimka';
import { BAJS_MISSING, BAJS_NOT_RENTING, encodeBajs } from '../../shared/snimka-codec';
import {
  LINE228_FROM_S, LINE228_HOURS, LINE228_TO_S, MONDAY_SIX_S, PRESS_BEATS, THURSDAY_SIX_S, bindTileSeeks, emptyHoursVsThu, mountAlternatives, pressByBeat, route228ByHour, routeSlots, showOnStage, stationName,
} from '../../app/src/snimka/alternatives';
import { createLayerStore, createViewStore, type SnimkaContext } from '../../app/src/snimka/context';
import { buildBajs, buildNews, buildNotices, buildRoutes, buildSnimkaFixture, buildStations, buildWindowSeries, MARKS, zg } from '../../e2e/snimka-fixtures';

const T0 = SNIMKA_WINDOW.fromSec;
const N = (SNIMKA_WINDOW.minutes * 60) / BAJS_STEP_S;
const slotOf = (sec: number): number => (sec - T0) / BAJS_STEP_S;
const HOUR_SLOTS = 3600 / BAJS_STEP_S;

function stations(n: number): StationsFile {
  return { v: 1, stations: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `Stanica ${String.fromCharCode(65 + i)}`, lon: 15.9, lat: 45.8, capacity: 10 })) };
}
/** A row of `v` everywhere, with `empty` hours set to 0 from a start (Monday or Thursday 06:00 plus an offset in hours). */
function row(v: number, empties: { from: number; hours: number }[] = [], fill: { from: number; slots: number; value: number }[] = []): Uint8Array {
  const r = new Uint8Array(N).fill(v);
  for (const e of empties) r.fill(0, slotOf(e.from), slotOf(e.from) + e.hours * HOUR_SLOTS);
  for (const f of fill) r.fill(f.value, slotOf(f.from), slotOf(f.from) + f.slots);
  return r;
}

describe('emptyHoursVsThu', () => {
  it('ranks by Monday\'s empty hours minus Thursday\'s, leaves out a station not emptier on Monday or unknown on either day', () => {
    const rows = [
      row(5, [{ from: MONDAY_SIX_S, hours: 14 }]), // A: all day empty on Monday, never on Thursday: +14
      row(5, [{ from: MONDAY_SIX_S, hours: 7 }, { from: THURSDAY_SIX_S, hours: 7 }]), // B: the same on both days: out
      row(5, [{ from: MONDAY_SIX_S + 3600, hours: 2 }, { from: MONDAY_SIX_S + 6 * 3600, hours: 4 }]), // C: 6 h, the longest from 12:00
      row(5, [{ from: MONDAY_SIX_S, hours: 10 }], [{ from: THURSDAY_SIX_S, slots: 14 * HOUR_SLOTS, value: BAJS_MISSING }]), // D: Thursday unknown: out
      row(5, [{ from: MONDAY_SIX_S, hours: 3 }], [{ from: MONDAY_SIX_S, slots: 14 * HOUR_SLOTS, value: BAJS_NOT_RENTING }]), // E: Monday not renting: out
      row(5, [{ from: MONDAY_SIX_S, hours: 6 }, { from: THURSDAY_SIX_S, hours: 1 }]), // F: 6 - 1 = 5
    ];
    const bajs = encodeBajs(T0, BAJS_STEP_S, rows.map((_, i) => `s${i}`), rows);
    const out = emptyHoursVsThu(bajs, stations(rows.length));
    expect(out.map((r) => [r.name, r.monday, r.thursday])).toEqual([['Stanica A', 14, 0], ['Stanica C', 6, 0], ['Stanica F', 6, 1]]);
    // The "Pokaži na karti" moment: the first minute of Monday's longest empty stretch.
    expect(out[1]!.atSec).toBe(MONDAY_SIX_S + 6 * 3600);
    expect(out[0]!.atSec).toBe(MONDAY_SIX_S);
    expect(emptyHoursVsThu(bajs, stations(rows.length), { limit: 1 })).toHaveLength(1);
  });
  it('on the fixture: at most ten, Monday always emptier, never the station that does not rent', () => {
    const out = emptyHoursVsThu(buildBajs(buildWindowSeries()), buildStations());
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(10);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]!.monday).toBeGreaterThan(out[i]!.thursday);
      expect(out[i]!.id).not.toBe('bajs-7');
      if (i > 0) expect(out[i - 1]!.monday - out[i - 1]!.thursday).toBeGreaterThanOrEqual(out[i]!.monday - out[i]!.thursday);
    }
  });
});

describe('stationName', () => {
  it('writes nextbike\'s capitals in normal capitalisation, keeping abbreviations, numbers and mixed case', () => {
    expect(stationName('UL. GRADA VUKOVARA')).toBe('Ul. grada Vukovara');
    expect(stationName('AUTOBUSNI TERMINAL SESVETE')).toBe('Autobusni terminal Sesvete');
    expect(stationName('MIHALJEVAC OKRETIŠTE')).toBe('Mihaljevac okretište');
    expect(stationName('TRG KRALJA TOMISLAVA')).toBe('Trg Kralja Tomislava');
    expect(stationName('HAK')).toBe('HAK');
    expect(stationName('RSC JARUN - PETRINE')).toBe('RSC Jarun - Petrine');
    expect(stationName('ANINA ULICA 51')).toBe('Anina ulica 51');
    expect(stationName('Baseball Club Zagreb')).toBe('Baseball Club Zagreb');
    expect(stationName('UL. HRVATSKOG SOKOLA - samo za cargo')).toBe('Ul. Hrvatskog Sokola - samo za cargo');
  });
});

describe('line 228 over its timetable', () => {
  it('draws Monday 05:00 to Wednesday 22:00 in five-minute samples, vehicles and timetable, missing as null', () => {
    const routes = buildRoutes();
    const slots = routeSlots(routes, '228');
    expect(LINE228_HOURS).toBe(65);
    expect(slots.fromSec).toBe(LINE228_FROM_S);
    expect(slots.seen).toHaveLength((LINE228_TO_S - LINE228_FROM_S) / 300);
    const at = (sec: number): number => Math.floor((sec - LINE228_FROM_S) / 300);
    // The fixture runs two from Tuesday 09:56 by day; the timetable silhouette is there throughout.
    expect(slots.seen[at(MARKS.line228) + 12]).toBe(2);
    expect(slots.expected[at(MARKS.line228) + 12]).toBeGreaterThan(0);
    expect(slots.seen[at(MARKS.frameGapFrom)]).toBeNull();
    expect(routeSlots(routes, 'nope').seen.every((v) => v === null)).toBe(true);
    const hours = route228ByHour(routes);
    expect(hours).toHaveLength(65);
    expect(hours[0]!.hourSec).toBe(LINE228_FROM_S);
  });
});

describe('pressByBeat', () => {
  it('keeps the three beats in their order, two each: the first and the last in time; an empty beat is left out', () => {
    const it0 = (id: string, beat: string, pubSec: number): NewsFile['items'][number] => ({ id, outlet: 'n1', title: id, link: `https://n1info.hr/${id}`, pubSec, beat, focus: { kind: 'city' }, facts: [], mentions: {} }) as unknown as NewsFile['items'][number];
    const items = [it0('t3', 'taksi', 30), it0('t1', 'taksi', 10), it0('t2', 'taksi', 20), it0('b1', 'bajs', 5), it0('s1', 'skole', 1), it0('g1', 'guzve', 2)];
    expect(PRESS_BEATS).toEqual(['taksi', 'volonteri', 'bajs']);
    expect(pressByBeat({ items }).map((g) => [g.beat, g.items.map((i) => i.id)])).toEqual([['taksi', ['t1', 't3']], ['bajs', ['b1']]]);
  });
});

describe('the block on a page', () => {
  // This file runs in node (the fixture reads files from disk); the block gets a happy-dom document of its own,
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
  it('ranks the stations, and "Pokaži na karti" (or the name) sets the station subject, pauses and seeks to its moment', async () => {
    document.body.innerHTML = '<section id="snimka"><div data-sn-stage></div></section><div data-sn-mount="alternatives" aria-busy="true"></div>';
    const root = document.querySelector<HTMLElement>('[data-sn-mount="alternatives"]')!;
    const { ctx, clock } = context();
    const expected = emptyHoursVsThu(buildBajs(buildWindowSeries()), buildStations());
    const off = mountAlternatives(ctx, root);
    expect(root.hasAttribute('aria-busy')).toBe(false);
    await vi.waitFor(() => expect(root.querySelectorAll('#zamjene-bajs tbody tr')).toHaveLength(expected.length));
    expect([...root.querySelectorAll('#zamjene-bajs thead th')].map((th) => th.textContent)).toEqual(['Stanica BAJS-a', 'Prazna u pon (h)', 'U čet 1. 10. (h)', 'Pokaži na karti']);
    const first = root.querySelector<HTMLTableRowElement>('#zamjene-bajs tbody tr')!;
    expect(first.dataset.station).toBe(expected[0]!.id);
    const button = first.querySelector<HTMLButtonElement>('.sn-alt-show')!;
    expect(button.textContent).toBe('Pokaži na karti');
    expect(button.getAttribute('aria-label')).toBe(`Pokaži na karti: ${expected[0]!.name}`);
    expect(first.querySelector('.sn-alt-name-button')!.getAttribute('aria-label')).toBe(button.getAttribute('aria-label'));
    button.click();
    expect(ctx.view.get().subject).toEqual({ kind: 'station', id: expected[0]!.id });
    expect(clock.pause).toHaveBeenCalled();
    expect(clock.seek).toHaveBeenCalledWith(expected[0]!.atSec * 1000);
    // The rail card is gone; line 228 draws its line over the silhouette, with its table twin and the notice.
    expect(root.querySelector('#zamjene-vlak')).toBeNull();
    const line = root.querySelector<HTMLElement>('#zamjene-228')!;
    expect(line.querySelector('.st-card-lede')!.textContent).toBe('Od utorka u 10 h vozila je koliko i vozni red; jedina takva linija tih dana.');
    expect([...line.querySelectorAll('path')].map((p) => p.getAttribute('class'))).toEqual(['sn-card-area sn-card-tone-expected', 'sn-card-line sn-card-tone-seen']);
    expect(line.querySelectorAll('.st-table tbody tr')).toHaveLength(65);
    expect(line.querySelector<HTMLAnchorElement>('.sn-alt-source a')!.href).toContain('10166');
    off();
  });
  it('lists at most six press links in three beats, rel noopener noreferrer, titles verbatim', () => {
    document.body.innerHTML = '<div data-sn-mount="alternatives"></div>';
    const root = document.querySelector<HTMLElement>('[data-sn-mount="alternatives"]')!;
    const { ctx } = context();
    mountAlternatives(ctx, root);
    const links = [...root.querySelectorAll<HTMLAnchorElement>('#zamjene-mediji a')];
    const expected = pressByBeat(ctx.news).flatMap((x) => x.items);
    expect(links.length).toBe(expected.length);
    expect(links.length).toBeLessThanOrEqual(6);
    for (const a of links) {
      expect(a.rel).toBe('noopener noreferrer');
      expect(a.target).toBe('_blank');
    }
    expect(links.map((a) => a.firstChild!.textContent)).toEqual(expected.map((i) => i.title));
    expect([...root.querySelectorAll('#zamjene-mediji h4')].every((h) => ['Taksi i prijevoz', 'Volonteri', 'BAJS'].includes(h.textContent!))).toBe(true);
  });
  it('the tiles\' seek binding fires once per click even when bound twice; showOnStage scrolls the instrument into view', () => {
    document.body.innerHTML = '<section id="snimka"><div data-sn-stage></div></section><div data-sn="kpis"><button data-sn-seek="1790561100"><span>63</span></button></div>';
    const row = document.querySelector<HTMLElement>('[data-sn="kpis"]')!;
    const onSeek = vi.fn();
    bindTileSeeks(row, onSeek);
    bindTileSeeks(row, onSeek);
    row.querySelector<HTMLElement>('span')!.click();
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(1790561100);
    const stage = document.querySelector<HTMLElement>('[data-sn-stage]')!;
    const scroll = vi.fn();
    stage.scrollIntoView = scroll;
    const clock = { pause: vi.fn(), seek: vi.fn() };
    showOnStage({ clock, doc: document, reducedMotion: true } as unknown as SnimkaContext, zg(9, 28, 4, 5));
    expect(clock.seek).toHaveBeenCalledWith(zg(9, 28, 4, 5) * 1000);
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
  });
});
