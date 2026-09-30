// @vitest-environment happy-dom
// The wall's "U blizini" list (app/src/kiosk/timeline.ts): the §15.6 probe
// markup, the time words (blue countdown, grey clock, "uvijek", "do …",
// "sutra"), calm motion (a row keeps its node, an idle update writes nothing,
// a new row enters at the bottom and settles, a departed one leaves at the
// top), whole rows and whole words (no ellipsis: shorter complete labels, then
// whole rows dropped), and the 3-metre floors in every wall composition.
// happy-dom lays nothing out, so the fit reads a simulated layout
// (TimelineMeasure) and the computed sizes are evaluated from the real sheets.
import { readFileSync } from 'node:fs';
import { compactArrangement } from '../../app/src/kiosk/invitation';
import { MAP_MIN_HEIGHT_PX } from '../../app/src/map/frame';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import { createI18n, type I18n, type MessageCatalog } from '../../app/src/i18n/i18n';
import { noticeShortTitle, selectNearby, type NearbyRow } from '../../app/src/city/nearby';
import type { LastRunLive } from '../../app/src/core/lastrun';
import { emptyCity } from '../../shared/city/types';
import { BASE_VALUE, imminence } from '../../shared/kiosk/takt';
import { departuresBoard } from '../../e2e/departures-fixture';
import { CALM_MOTION_SPEC, CALM_MOTION_START_IN_PAGE, CALM_MOTION_MARK_IN_PAGE, CALM_MOTION_READ_IN_PAGE, calmMotionFailures, calmChurnFailures } from '../../e2e/wall';
import { LEGIBILITY_IN_PAGE, pageSpec, WALL_1920 as LEGIBILITY_WALL } from '../../e2e/legibility';
import { cellLines, cellOverflow, lineHeight, LINE_1366, LINE_1920, LINE_PORTRAIT, type Layout as MeasureLayout } from './timeline-measure';
import {
  COUNTDOWN_HORIZON_MIN, ENTER_CLEAR_MS, EVENT_TITLE_MAX_LINES, GROW_FROM_PX, IMMINENT_ROW_MIN, NOTICE_TITLE_MAX_LINES, SUB_MAX_LINES, TITLE_MAX_LINES, dayLabel, dropCandidate, fitRows, mountTimeline, onLaterDay, rowsMarkup,
  timeLabel, typeScale, type TimelineHandle, type TimelineMeasure, type TimelineRow,
  FIT_RESTORE_HOLD_MS, byValue, departuresLineMarkup, groupDepartures, isDeparturesLine, type DeparturesLine, type WallRow,
} from '../../app/src/kiosk/timeline';

// kiosk.nearby.* is WP1-D's key group (WP1-A adds it too); until it lands the
// test carries the same words, and once it is in the catalogue the catalogue's words win.
function withNearby(catalog: MessageCatalog, words: Record<string, string>): MessageCatalog {
  const kiosk = catalog.kiosk as Record<string, MessageCatalog>;
  return { ...catalog, kiosk: { ...kiosk, nearby: { ...words, ...(kiosk.nearby ?? {}) } } };
}
const CATALOGS = {
  hr: withNearby(hr as MessageCatalog, { always: 'uvijek', until: 'do' }),
  en: withNearby(en as MessageCatalog, { always: 'always', until: 'until' }),
};
const i18nFor = (locale: 'hr' | 'en'): I18n => createI18n({ catalogs: CATALOGS, defaultLocale: 'hr', locale });
const i18n = i18nFor('hr');

// Tuesday 22 September 2026, 17:45 in Zagreb (CEST, UTC+2).
const NOW = Date.parse('2026-09-22T15:45:00Z');
const MIN = 60_000;
const at = (iso: string): number => Date.parse(iso);

const row = (over: Partial<TimelineRow> & Pick<TimelineRow, 'id' | 'kind'>): TimelineRow => ({
  atMs: NOW + 5 * MIN, always: false, title: 'Črnomerec', sub: '', live: false, source: 'zet', ...over,
});
const dep = (n: number, over: Omit<Partial<TimelineRow>, 'arrival'> & {
  arrival?: Pick<NonNullable<NearbyRow['arrival']>, 'routeId' | 'routeName'>;
} = {}): TimelineRow => {
  const { arrival, ...rest } = over;
  const atMs = rest.atMs ?? NOW + n * 4 * MIN;
  return row({ id: `dep:${n}`, kind: 'departure', atMs, live: true, ...rest,
    ...(arrival ? { arrival: { ...arrival, tripId: `trip:${n}`, headsign: rest.title ?? 'Črnomerec',
      atMs, live: rest.live ?? true, minutes: Math.round((atMs - NOW) / MIN) } } : {}),
  });
};
const always = (over: Partial<TimelineRow> = {}): TimelineRow =>
  row({ id: 'always:story:trg', kind: 'always', atMs: null, always: true, title: 'Trg bana Josipa Jelačića', sub: 'hrvatski ban, 1848-1859; 1801-1859', source: 'city', ...over });

/** A 17:45 list: three departures, a closure, an event, the sunset and the place story. */
function scene(): TimelineRow[] {
  return [
    dep(1, { arrival: { routeId: '6', routeName: '6' } }),
    dep(2, { live: false, title: 'Sopot' }),
    dep(3, { title: 'Dubec', atMs: NOW + 25 * MIN }),
    row({ id: 'closure:ilica', kind: 'closure', atMs: at('2026-09-22T16:00:00Z'), title: 'Ilica', sub: 'Zatvoren kolnik kod Frankopanske', source: 'prometnice' }),
    row({ id: 'event:gavella', kind: 'event', atMs: at('2026-09-22T18:00:00Z'), title: 'Gospoda Glembajevi', sub: 'Gradsko dramsko kazalište Gavella · tramvaj 6', source: 'dogadanja' }),
    row({ id: 'solar:sunset:2026-09-22', kind: 'solar', atMs: at('2026-09-22T17:07:00Z'), title: 'Zalazak sunca', source: 'solar' }),
    always(),
  ];
}

let host: HTMLElement;
let handle: TimelineHandle | null = null;
function mount(over: Partial<Parameters<typeof mountTimeline>[1]> = {}): TimelineHandle {
  handle = mountTimeline(host, { i18n, reduced: false, designHeightPx: 520, ...over });
  return handle;
}
const items = (): HTMLLIElement[] => [...host.querySelectorAll<HTMLLIElement>('li.nearby-row')];
const ids = (): string[] => items().map((li) => li.dataset.id ?? '');
const byId = (id: string): HTMLLIElement => host.querySelector<HTMLLIElement>(`li[data-id="${id}"]`)!;
/** The departures line's li (R1) and its cells. */
const line = (): HTMLLIElement | null => host.querySelector<HTMLLIElement>('li.nearby-row[data-kind="departures"]');
const cells = (): HTMLElement[] => [...(line()?.querySelectorAll<HTMLElement>(':scope > .k-dep-cell') ?? [])];
const cellIds = (): string[] => cells().map((cell) => cell.dataset.id ?? '');
const cell = (id: string): HTMLElement => host.querySelector<HTMLElement>(`.k-dep-cell[data-id="${id}"]`)!;
/** The list's ids with the line replaced by its cells' ids, in order: what the wall shows, departure by departure. */
const expanded = (): string[] => items().flatMap((li) => (li.dataset.kind === 'departures' ? [...li.querySelectorAll<HTMLElement>('.k-dep-cell')].map((c) => c.dataset.id ?? '') : [li.dataset.id ?? '']));
/** The departures the wall shows: the line's cells, or the departure rows of an ungrouped list. */
const shownDepartures = (): string[] => expanded().filter((id) => id.startsWith('dep:'));
const text = (el: Element | null | undefined): string => el?.textContent ?? '';
const section = (): HTMLElement => host.querySelector<HTMLElement>('[data-testid=nearby]')!;

/** Records every mutation under the section; `structural` leaves out text changes (a countdown ticking). */
function watch(): { structural(): MutationRecord[]; text(): MutationRecord[]; stop(): void } {
  const observer = new MutationObserver(() => undefined);
  observer.observe(section(), { subtree: true, childList: true, attributes: true, characterData: true });
  let records: MutationRecord[] = [];
  const take = (): MutationRecord[] => (records = [...records, ...observer.takeRecords()]);
  return {
    structural: () => take().filter((r) => r.type !== 'characterData'),
    text: () => take().filter((r) => r.type === 'characterData'),
    stop: () => observer.disconnect(),
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  host.className = 'k-nearby-host';
  document.body.appendChild(host);
});
afterEach(() => {
  handle?.destroy();
  handle = null;
  vi.useRealTimers();
});

describe('the probe markup (§15.6)', () => {
  it('draws the section, the head for the measured circle and one li per row with the contract attributes', () => {
    const t = mount();
    t.update(scene(), 2000, NOW);
    expect(host.querySelector('section[data-testid=nearby] > h2[data-testid=nearby-head]')).not.toBeNull();
    expect(text(host.querySelector('[data-testid=nearby-head]'))).toBe('U blizini · 2 km · ~15 min');
    const rows = items();
    expect(host.querySelectorAll('ol[data-testid=nearby-rows] > li.nearby-row')).toHaveLength(rows.length);
    // R1: the three departures are one row, the line, at the top.
    expect(rows.map((li) => li.dataset.kind)).toEqual(['departures', 'closure', 'event', 'solar', 'always']);
    for (const li of rows) {
      expect(li.dataset.id).toBeTruthy();
      expect(li.dataset.key).toBe(li.dataset.id);
      expect(li.dataset.source).toBeTruthy();
      expect(li.hasAttribute('hidden')).toBe(false);
      // Exactly one of the two time attributes.
      expect(li.hasAttribute('data-when') !== li.hasAttribute('data-always')).toBe(true);
      if (li.dataset.kind === 'departures') continue;
      // The per-row structure is always the same three probes.
      expect(li.querySelectorAll('.nearby-when')).toHaveLength(1);
      expect(li.querySelectorAll('.nearby-title')).toHaveLength(1);
      expect(li.querySelectorAll('.nearby-sub')).toHaveLength(1);
    }
    const first = cell('dep:1');
    expect(first.dataset.when).toBe(new Date(NOW + 4 * MIN).toISOString());
    expect(first.dataset.live).toBe('1');
    expect(first.querySelector('time.nearby-when')!.getAttribute('datetime')).toBe(first.dataset.when);
    expect(cell('dep:2').hasAttribute('data-live')).toBe(false);
    expect(line()!.dataset.when).toBe(first.dataset.when);
    const story = byId('always:story:trg');
    expect(story.dataset.always).toBe('1');
    expect(story.querySelector('time')).toBeNull();
    expect(text(story.querySelector('.nearby-sub'))).toBe('hrvatski ban, 1848-1859; 1801-1859');
    expect(section().getAttribute('aria-labelledby')).toBe(host.querySelector('[data-testid=nearby-head]')!.id);
  });

  it('keeps an empty, stable .nearby-sub on a solar row, and a stable destination span in a departure cell', () => {
    const t = mount();
    t.update(scene(), 2000, NOW);
    const li = byId('solar:sunset:2026-09-22');
    const sub = li.querySelector('.k-nearby-text > .nearby-sub');
    expect(sub).not.toBeNull();
    expect(text(sub)).toBe('');
    expect(li.querySelector('.k-nearby-at > .nearby-when')).not.toBeNull();
    expect(li.querySelector('.k-nearby-text > .nearby-title')).not.toBeNull();
    const head = cell('dep:2').querySelector('.k-dep-headsign');
    expect(text(head)).toBe('Sopot');
    t.update(scene(), 2000, NOW + 20_000);
    expect(byId('solar:sunset:2026-09-22').querySelector('.nearby-sub')).toBe(sub);
    expect(cell('dep:2').querySelector('.k-dep-headsign')).toBe(head);
  });

  it('prints the measured radius with a decimal comma and repaints the head only when it changes', () => {
    const t = mount();
    t.update(scene(), 2170, NOW);
    const head = host.querySelector('[data-testid=nearby-head]')!;
    expect(text(head)).toBe('U blizini · 2,2 km · ~16 min');
    expect(text(head.querySelector('.k-nearby-heading-title'))).toBe('U blizini');
    const before = head.firstChild;
    t.update(scene(), 2170, NOW);
    expect(head.firstChild).toBe(before);
    t.update(scene(), 1300, NOW);
    expect(text(head)).toMatch(/^U blizini · 1,3 km · ~\d+ min$/);
  });

  it('leads a departure cell that carries its arrival with the line badge', () => {
    const t = mount();
    t.update(scene(), 2000, NOW);
    const first = cell('dep:1');
    const badge = first.querySelector('.k-line-badge')!;
    expect(text(badge)).toBe('6');
    expect(badge.getAttribute('data-kind')).toBe('tram');
    expect(first.dataset.route).toBe('6');
    expect(text(first)).toBe('6za 4 minČrnomerec');
    expect(cell('dep:2').querySelector('.k-line-badge')).toBeNull();
    expect(cell('dep:2').hasAttribute('data-route')).toBe(false);
  });

  it('keeps one row per departure where the design height is unbounded (a handheld) or the deps say so', () => {
    const t = mount({ designHeightPx: Number.POSITIVE_INFINITY });
    t.update(scene(), 2000, NOW);
    expect(items().map((li) => li.dataset.kind)).toEqual(['departure', 'departure', 'departure', 'closure', 'event', 'solar', 'always']);
    expect(line()).toBeNull();
    t.destroy();
    handle = null;
    let grouped = false;
    const u = mount({ departuresLine: () => grouped });
    u.update(scene(), 2000, NOW);
    expect(items().filter((li) => li.dataset.kind === 'departure')).toHaveLength(3);
    // Read on every update: the composition may change without a remount.
    grouped = true;
    u.update(scene(), 2000, NOW);
    expect(items().map((li) => li.dataset.kind)).toEqual(['departures', 'closure', 'event', 'solar', 'always']);
  });
});

// R1 (docs/reveal-2026-10-plan/R1.md): the wall's three departure rows become one row of up to three cells.
describe('the departures line (R1)', () => {
  const lineOf = (rows: readonly WallRow[]): DeparturesLine => rows.find(isDeparturesLine)!;

  it('groups the first run of departures into one line of three cells, live when a cell is', () => {
    const grouped = groupDepartures(scene());
    expect(grouped.map((r) => r.id)).toEqual(['departures', 'closure:ilica', 'event:gavella', 'solar:sunset:2026-09-22', 'always:story:trg']);
    const l = lineOf(grouped);
    expect(l.cells.map((c) => c.id)).toEqual(['dep:1', 'dep:2', 'dep:3']);
    expect(l).toMatchObject({ kind: 'departures', id: 'departures', atMs: NOW + 4 * MIN, always: false, live: true });
    expect(lineOf(groupDepartures([dep(2, { live: false }), always()])).live).toBe(false);
  });

  it('leaves a list without departures as it is, keeps a train the policy put first above the line, and keeps three cells of a longer run', () => {
    const rows = scene().filter((r) => r.kind !== 'departure');
    expect(groupDepartures(rows)).toEqual(rows);
    const rail = row({ id: 'rail:2201', kind: 'rail', atMs: NOW + 12 * MIN, title: 'Savski Marof', source: 'hz' });
    expect(groupDepartures([rail, dep(1), dep(2), always()]).map((r) => r.id)).toEqual(['rail:2201', 'departures', 'always:story:trg']);
    const four = groupDepartures([dep(1), dep(2), dep(3), dep(4), always()]);
    expect(lineOf(four).cells.map((c) => c.id)).toEqual(['dep:1', 'dep:2', 'dep:3']);
    // A departure after another kind (never produced today) stays a row.
    expect(groupDepartures([dep(1), always(), dep(2)]).map((r) => r.id)).toEqual(['departures', 'always:story:trg', 'dep:2']);
  });

  it('never gives the line up: dropCandidate never returns it and byValue keeps it first among the kept', () => {
    const lists: WallRow[][] = [groupDepartures(scene()), groupDepartures(longRows()), groupDepartures(nightList0400())];
    for (const list of lists) {
      let left = list;
      for (let drop = dropCandidate(left, NOW); drop; drop = dropCandidate(left, NOW)) {
        expect(isDeparturesLine(drop)).toBe(false);
        left = left.filter((r) => r !== drop);
      }
      expect(left.some(isDeparturesLine)).toBe(true);
      expect(byValue(list, NOW)[0]!.kind).toBe('departures');
      expect(fitRows(list, 1).map((r) => r.id)).toContain('departures');
    }
  });

  it('at 04:00 the sunrise and the far openings go before the closures: the value order, the line never (DR1)', () => {
    const night4 = at('2026-09-27T04:00:00+02:00');
    const order: string[] = [];
    for (let left = groupDepartures(nightList0400()), drop = dropCandidate(left, night4); drop; left = left.filter((r) => r !== drop), drop = dropCandidate(left, night4)) order.push(drop.id);
    // R1: the line holds the three departures and never yields. DR1: R0's value order replaces decision 67 (outlivedBy
    // is retired, INTEGRATOR.md): the sunrise at 06:48 (20 x 0.5 = 10), the openings at 10:00 (30 x 0.5 = 15, the later
    // row first), then the closures (60, the later first).
    expect(order).toEqual(['solar:sunrise:2026-09-27', 'open:culture-karas:2026-09-27', 'open:culture-d62358d5d2fc659f:2026-09-27', 'closure:gunduliceva', 'closure:amruseva']);
    // With one cell the value order is the same: the row of the lowest value goes first.
    const one = groupDepartures([nightList0400()[0]!, ...nightList0400().slice(3)]);
    expect(dropCandidate(one, night4)?.id).toBe('solar:sunrise:2026-09-27');
  });

  it('draws the probe attributes: the li counts its cells, each cell carries its row’s id, route and time, and no data-kind', () => {
    const html = departuresLineMarkup(lineOf(groupDepartures(scene())), NOW, i18n);
    const box = document.createElement('ol');
    box.innerHTML = html;
    const li = box.querySelector<HTMLElement>('li')!;
    expect(li.className).toBe('nearby-row');
    expect(li.dataset).toMatchObject({ id: 'departures', key: 'departures', kind: 'departures', cells: '3', when: new Date(NOW + 4 * MIN).toISOString(), live: '1', source: 'zet' });
    const spans = [...li.children] as HTMLElement[];
    expect(spans.map((c) => c.className)).toEqual(['k-dep-cell', 'k-dep-cell', 'k-dep-cell']);
    spans.forEach((c, i) => {
      expect(c.dataset.cell).toBe(String(i + 1));
      expect(c.dataset.key).toBe(`dep:${i + 1}`);
      expect(c.dataset.id).toBe(c.dataset.key);
      expect(c.hasAttribute('data-kind')).toBe(false);
      expect(c.querySelector('time.nearby-when')!.getAttribute('datetime')).toBe(c.dataset.when);
      expect(c.querySelectorAll('.k-dep-headsign')).toHaveLength(1);
    });
    expect(spans[0]!.dataset.route).toBe('6');
    // A live countdown, blue ("za 4 min", data-live); a timetable clock, grey (no data-live).
    expect(text(spans[0]!.querySelector('.nearby-when'))).toBe('za 4 min');
    expect(text(spans[1]!.querySelector('.nearby-when'))).toBe('17:53');
    expect(spans[1]!.hasAttribute('data-live')).toBe(false);
    // No whitespace between the elements (reconcile.ts matches text nodes by position).
    expect(html).not.toMatch(/>\s+</);
    // No live cell, no data-live on the li.
    const grey = document.createElement('ol');
    grey.innerHTML = departuresLineMarkup(lineOf(groupDepartures([dep(2, { live: false }), dep(3, { live: false })])), NOW, i18n);
    expect(grey.querySelector('li')!.hasAttribute('data-live')).toBe(false);
    expect(grey.querySelector('li')!.dataset.cells).toBe('2');
    for (const markup of [html, grey.innerHTML]) expect(markup).not.toMatch(/…|\.\.\./);
  });

  it('prints a departure without a destination of its own as an empty span with data-headsign="0"', () => {
    const noHeadsign = dep(1, { title: '6', arrival: { routeId: '6', routeName: '6' } });
    const box = document.createElement('ol');
    box.innerHTML = departuresLineMarkup(lineOf(groupDepartures([noHeadsign, dep(2, { title: 'Sopot' })])), NOW, i18n);
    const [first, second] = [...box.querySelectorAll<HTMLElement>('.k-dep-cell')];
    expect(first!.dataset.headsign).toBe('0');
    expect(text(first!.querySelector('.k-dep-headsign'))).toBe('');
    expect(second!.hasAttribute('data-headsign')).toBe(false);
    expect(text(second!.querySelector('.k-dep-headsign'))).toBe('Sopot');
  });

  it('prints the clock of a live countdown where the box took the clock form, still blue, and leaves out cells 2 and 3’s destinations on "first"', () => {
    const l = lineOf(groupDepartures(scene()));
    const box = document.createElement('ol');
    box.innerHTML = departuresLineMarkup(l, NOW, i18n, { clocks: true, headsigns: 'first' });
    const [first, second, third] = [...box.querySelectorAll<HTMLElement>('.k-dep-cell')];
    expect(text(first!.querySelector('.nearby-when'))).toBe('17:49');
    expect(first!.dataset.live).toBe('1');
    // Past the horizon a live row is a clock anyway.
    expect(text(third!.querySelector('.nearby-when'))).toBe('18:10');
    expect(text(first!.querySelector('.k-dep-headsign'))).toBe('Črnomerec');
    for (const c of [second!, third!]) {
      expect(c.dataset.headsign).toBe('0');
      expect(text(c.querySelector('.k-dep-headsign'))).toBe('');
    }
    box.innerHTML = departuresLineMarkup(l, NOW, i18n, { headsigns: 'none' });
    expect([...box.querySelectorAll<HTMLElement>('.k-dep-cell')].map((c) => c.dataset.headsign)).toEqual(['0', '0', '0']);
    // The fit's probe: every cell prints the widest countdown.
    box.innerHTML = departuresLineMarkup(l, NOW, i18n, { probe: true });
    expect([...box.querySelectorAll('.nearby-when')].map(text)).toEqual(['za 10 min', 'za 10 min', 'za 10 min']);
  });

  it('draws no cell whose row fails the text check, and counts the drawn cells', () => {
    const l = lineOf(groupDepartures([dep(1, { title: 'Submit passcode' }), dep(2), dep(3)]));
    const box = document.createElement('ol');
    box.innerHTML = departuresLineMarkup(l, NOW, i18n);
    const li = box.querySelector<HTMLElement>('li')!;
    expect(li.dataset.cells).toBe('2');
    expect([...li.children].map((c) => (c as HTMLElement).dataset.cell)).toEqual(['1', '2']);
    expect(li.dataset.when).toBe(new Date(NOW + 8 * MIN).toISOString());
    expect(box.textContent).not.toContain('passcode');
    expect(departuresLineMarkup(lineOf(groupDepartures([dep(1, { title: 'Submit passcode' })])), NOW, i18n)).toBe('');
  });

  describe('the fit pass (1b): the destinations and the countdown form, per box', () => {
    const board = (heads: readonly string[], over: Partial<TimelineRow>[] = []): TimelineRow[] => [
      ...heads.map((title, i) => dep(i + 1, { title, atMs: NOW + (3 + 3 * i) * MIN, arrival: { routeId: ['6', '13', '17'][i]!, routeName: ['6', '13', '17'][i]! }, ...over[i] })),
      row({ id: 'closure:ilica', kind: 'closure', atMs: at('2026-09-22T16:00:00Z'), title: 'Ilica', source: 'prometnice' }),
      always(),
    ];
    const heads = (): string[] => cells().map((c) => text(c.querySelector('.k-dep-headsign')));

    it('keeps three destinations of at most nine characters at 1920 x 1080', () => {
      mount({ measure: simulated(WALL_1920) }).update(board(['Črnomerec', 'Dubrava', 'Prečko']), 2000, NOW);
      expect(heads()).toEqual(['Črnomerec', 'Dubrava', 'Prečko']);
      expect(cells().some((c) => c.hasAttribute('data-headsign'))).toBe(false);
    });

    it('leaves out cells 2 and 3’s destinations when one of them runs long, and every cell’s when the first’s does', () => {
      mount({ measure: simulated(WALL_1920) }).update(board(['Črnomerec', 'Savski most', 'Prečko']), 2000, NOW);
      expect(heads()).toEqual(['Črnomerec', '', '']);
      expect(cells().map((c) => c.dataset.headsign ?? '')).toEqual(['', '0', '0']);
      handle?.destroy();
      host.innerHTML = '';
      mount({ measure: simulated(WALL_1920) }).update(board(['Kvaternikov trg', 'Dubrava', 'Prečko']), 2000, NOW);
      expect(heads()).toEqual(['', '', '']);
      expect(cells().map((c) => c.dataset.headsign)).toEqual(['0', '0', '0']);
    });

    it('prints the countdowns as clock times, still blue, in a box whose cell does not hold "za 10 min", and as countdowns where it does', () => {
      const compact = (cellTimeChars: number): Layout => ({ boxPx: 451, titleChars: 16, subChars: 25, ...LINE_1366, cellTimeChars });
      mount({ measure: simulated(compact(8)) }).update(board(['Dubrava', 'Prečko', 'Dubec']), 2000, NOW);
      expect(cells().map((c) => text(c.querySelector('.nearby-when')))).toEqual(['17:48', '17:51', '17:54']);
      expect(cells().map((c) => c.dataset.live)).toEqual(['1', '1', '1']);
      handle?.destroy();
      host.innerHTML = '';
      mount({ measure: simulated(compact(9)) }).update(board(['Dubrava', 'Prečko', 'Dubec'], [{}, {}, { atMs: NOW + 10 * MIN }]), 2000, NOW);
      expect(cells().map((c) => text(c.querySelector('.nearby-when')))).toEqual(['za 3 min', 'za 6 min', 'za 10 min']);
    });

    it('remembers the result: a second identical update measures nothing', () => {
      const measure = simulated(WALL_1920);
      const lines = vi.fn(measure.lines);
      const t = mount({ measure: { ...measure, lines } });
      t.update(board(['Črnomerec', 'Savski most', 'Prečko']), 2000, NOW);
      expect(lines).toHaveBeenCalled();
      lines.mockClear();
      t.update(board(['Črnomerec', 'Savski most', 'Prečko']), 2000, NOW);
      expect(lines).not.toHaveBeenCalled();
      expect(heads()).toEqual(['Črnomerec', '', '']);
    });
  });
});

describe('the time words', () => {
  const when = (r: TimelineRow, now = NOW): string => timeLabel(r, now, i18n);

  it('counts a tracked departure down inside the horizon and prints a clock past it; the timetable is always a clock', () => {
    expect(when(dep(1))).toBe('za 4 min');
    expect(when(dep(1, { atMs: NOW + 20_000 }))).toBe('sada');
    expect(when(dep(1, { atMs: NOW - 30_000 }))).toBe('sada');
    expect(when(dep(1, { atMs: NOW + COUNTDOWN_HORIZON_MIN * MIN }))).toBe(`za ${COUNTDOWN_HORIZON_MIN} min`);
    expect(when(dep(1, { atMs: NOW + 25 * MIN }))).toBe('18:10');
    expect(when(dep(1, { live: false }))).toBe('17:49');
  });

  it('ends a closure "do 18:00" today and "do 25. 9." on another day', () => {
    const closure = (iso: string): TimelineRow => row({ id: 'closure:x', kind: 'closure', atMs: at(iso), title: 'Ilica' });
    expect(when(closure('2026-09-22T16:00:00Z'))).toBe('do 18:00');
    expect(when(closure('2026-09-25T14:00:00Z'))).toBe('do 25. 9.');
    expect(dayLabel(closure('2026-09-25T14:00:00Z'), NOW, i18n)).toBe('');
  });

  it('says "uvijek" for a row with no moment, the pharmacy at night included', () => {
    expect(when(always())).toBe('uvijek');
    expect(when(row({ id: 'always:pharmacy', kind: 'pharmacy', atMs: null, always: true, title: '24/7', sub: 'Trg bana J. Jelačića 3' }))).toBe('uvijek');
  });

  it('puts "sutra" or the weekday over a later row, never over tonight\'s trams', () => {
    const late = Date.parse('2026-09-22T21:40:00Z'); // 23:40 in Zagreb
    const sunrise = row({ id: 'solar:sunrise:2026-09-23', kind: 'solar', atMs: at('2026-09-23T04:52:00Z'), title: 'Izlazak sunca' });
    expect(dayLabel(sunrise, late, i18n)).toBe('sutra');
    expect(timeLabel(sunrise, late, i18n)).toBe('06:52');
    expect(dayLabel(sunrise, Date.parse('2026-09-22T23:30:00Z'), i18n)).toBe(''); // 01:30: the same calendar day
    const lastTrams = row({ id: 'last:2026-09-22', kind: 'last', atMs: at('2026-09-22T22:04:00Z'), title: 'Zadnji tramvaji' });
    expect(dayLabel(lastTrams, late, i18n)).toBe('');
    expect(dayLabel(dep(1, { atMs: at('2026-09-22T22:02:00Z') }), late, i18n)).toBe('');
    const event = row({ id: 'event:x', kind: 'event', atMs: at('2026-09-24T17:00:00Z'), title: 'Koncert' });
    expect(dayLabel(event, NOW, i18n)).toBe('čet');
    expect(dayLabel(event, NOW, i18nFor('en'))).toBe('Thu');
    expect(dayLabel(scene()[4]!, NOW, i18n)).toBe('');
  });

  it('draws the day word in the time cell, under the time, not inside the <time>', () => {
    const t = mount();
    const first = row({ id: 'first:2026-09-23', kind: 'first', atMs: at('2026-09-23T02:16:00Z'), title: 'Prvi tramvaj', sub: '4 04:16 · 6 04:22' });
    t.update([first, always()], 2000, Date.parse('2026-09-22T21:40:00Z'));
    const li = byId('first:2026-09-23');
    expect(text(li.querySelector('.nearby-when'))).toBe('04:16');
    expect(text(li.querySelector('.k-nearby-at > .k-nearby-day'))).toBe('sutra');
  });

  it('never prints a caption, a freshness word, a source word or an ellipsis', () => {
    const markup = rowsMarkup(scene(), NOW, i18n) + rowsMarkup(scene().map((r) => ({ ...r, live: false })), NOW, i18n);
    for (const word of [/uživo/i, /vozni red/i, /procjen/i, /zastarjel/i, /nepotvrđen/i, /registra/i, /nije provjera/i, /Obuhvat/, /Dohvaćeno/, /nedostup/i, /…|\.\.\./]) {
      expect(markup).not.toMatch(word);
    }
  });

  it('speaks English where the wall does', () => {
    const en = i18nFor('en');
    expect(timeLabel(always(), NOW, en)).toBe(en.t('kiosk.nearby.always'));
    expect(timeLabel(dep(1), NOW, en)).toBe('in 4 min');
    expect(timeLabel(row({ id: 'closure:x', kind: 'closure', atMs: at('2026-09-22T16:00:00Z') }), NOW, en)).toBe(`${en.t('kiosk.nearby.until')} 18:00`);
  });
});

describe('calm motion (principle 7)', () => {
  it('keeps ten idle minutes within the recorder budget when rejected rows change on every poll', () => {
    const measure = simulated(WALL_1920);
    const t = mount({ measure });
    t.update(longRows(), 2000, NOW);
    const kept = items();
    const minutes: number[] = [];
    for (let minute = 0; minute < 10; minute++) {
      CALM_MOTION_START_IN_PAGE(CALM_MOTION_SPEC);
      for (let poll = 1; poll <= 6; poll++) {
        const rows = longRows().map(r => r.kind === 'event' ? { ...r, sub: `${r.sub} ${minute * 6 + poll}` } : r);
        t.update(rows, 2000, NOW + minute * MIN + poll * 10_000);
      }
      const reading = CALM_MOTION_READ_IN_PAGE(CALM_MOTION_SPEC);
      minutes.push(reading.mutations);
      expect(calmMotionFailures(reading), JSON.stringify(minutes)).toEqual([]);
      expect(reading.rebuilt).toEqual([]);
      expect(items()).toEqual(kept);
    }
    expect(minutes).toEqual(Array(10).fill(0));
  }, 30_000);

  it('measures candidate words in a hidden same-width sibling, never in the live list', () => {
    const measure = simulated(WALL_1920);
    const lines = vi.fn((el: HTMLElement) => {
      expect(el.closest('ol')).not.toBe(host.querySelector('[data-testid=nearby-rows]'));
      expect(el.isConnected).toBe(true);
      expect(getComputedStyle(el).visibility).toBe('hidden');
      expect(el.closest('ol')!.style.width).toBe(`${WALL_1920.titleChars}px`);
      return measure.lines(el);
    });
    const t = mount({ measure: { ...measure, lines } });
    t.update(longRows(), 2000, NOW);
    expect(lines).toHaveBeenCalled();
    expect(host.children).toHaveLength(1);
  });

  // The D2 gate as the browser runs it (e2e/accept/wall.spec.ts block D): the accept recorder on
  // [data-testid=nearby], childList records with an element node, over one idle minute in which
  // kiosk.ts repaints the timeline on every 1 s code tick and once more per platform board that
  // lands (city/boards.ts, 60 s TTL). The earlier simulated minute drove six polls with a fixed
  // departure set, so it never saw what a departure that leaves or changes identity costs.
  describe('the accept recorder mirrored: one second per update, the rows of peak1745', () => {
    /** The timed rows the 10ed458 re-run read at 17:45 (reading-peak1745.json): the sunset, two closures, the place row. */
    const timed = (): TimelineRow[] => [
      row({ id: 'solar:sunset:2026-09-22', kind: 'solar', atMs: at('2026-09-22T16:57:00Z'), title: 'Zalazak sunca', source: 'solar' }),
      row({ id: 'closure:gunduliceva', kind: 'closure', atMs: at('2026-09-22T19:45:00Z'), title: 'Gundulićeva', source: 'prometnice' }),
      row({ id: 'closure:palmoticeva', kind: 'closure', atMs: at('2026-09-22T20:45:00Z'), title: 'Palmotićeva', source: 'prometnice' }),
      row({ id: 'always:heritage:zgrada', kind: 'always', atMs: null, always: true, title: 'Povijesna zgrada', source: 'heritage' }),
    ];
    /** childList records under the section that add or remove an element: what the recorder counts, node by node. */
    function structure(): { records(): { added: string[]; removed: string[] }[]; stop(): void } {
      const observer = new MutationObserver(() => undefined);
      observer.observe(section(), { subtree: true, childList: true });
      const keyed = (nodes: NodeList): string[] => [...nodes].filter((n): n is Element => n.nodeType === 1).map((n) => `${n.tagName.toLowerCase()}[${n.getAttribute('data-key') ?? ''}]`);
      return {
        records: () => observer.takeRecords().filter((r) => r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1))
          .map((r) => ({ added: keyed(r.addedNodes), removed: keyed(r.removedNodes) })),
        stop: () => observer.disconnect(),
      };
    }

    it('spends two records on a departure turnover: the one that left, the one that entered under the departures that stay', () => {
      const measure = simulated(WALL_1920);
      const t = mount({ measure });
      const board = [
        dep(1, { atMs: NOW + 30_000, title: 'Dubrava', arrival: { routeId: '12', routeName: '12' } }),
        dep(2, { atMs: NOW + 4 * MIN, title: 'Dubrava', arrival: { routeId: '12', routeName: '12' } }),
        dep(3, { atMs: NOW + 8 * MIN, live: false, title: 'Borongaj', source: 'zet-gtfs', arrival: { routeId: '17', routeName: '17' } }),
        dep(4, { atMs: NOW + 14 * MIN, live: false, title: 'Dubrava', source: 'zet-gtfs', arrival: { routeId: '12', routeName: '12' } }),
      ];
      // A departure whose moment has passed leaves the board; the next one takes the third row.
      const rows = (now: number): TimelineRow[] => [...board.filter((d) => d.atMs! >= now).slice(0, 3), ...timed()];
      t.update(rows(NOW), 2200, NOW);
      expect(cellIds()).toEqual(['dep:1', 'dep:2', 'dep:3']);
      const nodes = new Map([...items(), ...cells()].map((el) => [el.dataset.id, el]));
      const w = structure();
      // The line, its three cells and the four timed rows.
      expect(CALM_MOTION_START_IN_PAGE(CALM_MOTION_SPEC)).toBe(8);
      for (let s = 1; s <= 60; s++) t.update(rows(NOW + s * 1000), 2200, NOW + s * 1000);
      const reading = CALM_MOTION_READ_IN_PAGE(CALM_MOTION_SPEC);
      const records = w.records();
      w.stop();
      // A cell carries no data-kind (R1): its recorder key is "|id".
      expect(reading.left).toEqual(['|dep:1']);
      expect(reading.entered).toEqual(['|dep:4']);
      expect(reading.rebuilt).toEqual([]);
      expect(reading.kept).toBe(7);
      // Exactly the two content changes, one record each; no node is taken out and put back (a move is two records).
      expect(records, JSON.stringify(records)).toEqual([{ added: [], removed: ['span[dep:1]'] }, { added: ['span[dep:4]'], removed: [] }]);
      expect(reading.mutations).toBe(2);
      expect(calmMotionFailures(reading)).toEqual([]);
      // The entering cell sits at its time position from its first paint, and the rows and cells that stayed are the same nodes in the same order.
      expect(ids()).toEqual(['departures', 'solar:sunset:2026-09-22', 'closure:gunduliceva', 'closure:palmoticeva', 'always:heritage:zgrada']);
      expect(cellIds()).toEqual(['dep:2', 'dep:3', 'dep:4']);
      for (const id of ['departures', 'dep:2', 'dep:3', 'solar:sunset:2026-09-22', 'closure:gunduliceva', 'closure:palmoticeva', 'always:heritage:zgrada']) expect(host.querySelector(`[data-id="${id}"]`), id).toBe(nodes.get(id));
    });

    it('spends two records per identity change of the third departure, so four platform boards landing cost eight, never sixteen', () => {
      // The accept fixture (e2e/departures-fixture.ts, lane V-H's items a and b) gives each of the four Trg platforms a
      // line-12 row at its own fetch instant, so every board that lands makes another platform's row the earliest:
      // four identity changes a minute (calm-peak1745.json: left …T16:09, entered …T16:10, sixteen mutations).
      const measure = simulated(WALL_1920);
      const t = mount({ measure });
      const fetchedAt = [1, 2, 3, 4].map((platform) => NOW - 40_000 + platform);
      const fixture = (platform: number): TimelineRow => {
        const atMs = fetchedAt[platform - 1]! + 14 * MIN;
        return dep(platform, {
          atMs, live: false, title: 'Dubrava', source: 'zet-gtfs', arrival: { routeId: '12', routeName: '12' },
          id: `dep:fixture-106_${platform}-12-${new Date(atMs).toISOString().slice(0, 16)}`,
        });
      };
      const rows = (): TimelineRow[] => {
        const departures = [
          dep(10, { atMs: NOW + 2 * MIN, title: 'Dubrava', arrival: { routeId: '12', routeName: '12' } }),
          dep(11, { atMs: NOW + 8 * MIN, live: false, title: 'Borongaj', source: 'zet-gtfs', arrival: { routeId: '17', routeName: '17' } }),
          ...[1, 2, 3, 4].map(fixture),
        ].sort((a, b) => a.atMs! - b.atMs!).slice(0, 3);
        return [...departures, ...timed()];
      };
      /** The fixture cell on the line, wherever the paint put it. */
      const third = (): string | undefined => cellIds().find((id) => id.startsWith('dep:fixture-'));
      t.update(rows(), 2200, NOW);
      expect(cellIds()[2]).toBe('dep:fixture-106_1-12-2026-09-22T15:58');
      const w = structure();
      expect(CALM_MOTION_START_IN_PAGE(CALM_MOTION_SPEC)).toBe(8);
      let flips = 0;
      for (let s = 1; s <= 60; s++) {
        const now = NOW + s * 1000;
        if (s >= 20 && s <= 23) {
          // The four boards land a step apart, each landing repaints the wall (kiosk.ts onBoardSettled) before the next tick.
          const platform = s - 19;
          fetchedAt[platform - 1] = now + platform;
          const shown = third();
          t.update(rows(), 2200, now);
          if (third() !== shown) flips++;
        }
        t.update(rows(), 2200, now);
      }
      const reading = CALM_MOTION_READ_IN_PAGE(CALM_MOTION_SPEC);
      const records = w.records();
      w.stop();
      expect(flips).toBe(4);
      expect(reading.left).toEqual(['|dep:fixture-106_1-12-2026-09-22T15:58']);
      expect(reading.entered).toEqual(['|dep:fixture-106_1-12-2026-09-22T15:59']);
      expect(reading.rebuilt).toEqual([]);
      expect(reading.kept).toBe(7);
      // One removal and one insertion per identity change, in landing order, and no node taken out and put back.
      const key = (platform: number, minute: string): string => `span[dep:fixture-106_${platform}-12-2026-09-22T${minute}]`;
      expect(records).toEqual([
        { added: [], removed: [key(1, '15:58')] }, { added: [key(2, '15:58')], removed: [] },
        { added: [], removed: [key(2, '15:58')] }, { added: [key(3, '15:58')], removed: [] },
        { added: [], removed: [key(3, '15:58')] }, { added: [key(4, '15:58')], removed: [] },
        { added: [], removed: [key(4, '15:58')] }, { added: [key(1, '15:59')], removed: [] },
      ]);
      expect(reading.mutations).toBe(2 * flips);
    });
  });

  it('keeps every node across updates with the same rows and fades nothing in', () => {
    const t = mount();
    t.update(scene(), 2000, NOW);
    const before = [...items(), ...cells()];
    expect(before.some((el) => el.hasAttribute('data-enter'))).toBe(false);
    t.update(scene(), 2000, NOW + 20_000);
    const after = [...items(), ...cells()];
    expect(after).toHaveLength(before.length);
    after.forEach((el, i) => expect(el).toBe(before[i]));
    expect(after.some((el) => el.hasAttribute('data-enter'))).toBe(false);
  });

  it('lets a new row enter at its time position in one insertion, fade in once there, and never move afterwards', () => {
    vi.useFakeTimers();
    const t = mount();
    t.update(scene(), 2000, NOW);
    const kept = items();
    const next = scene();
    next.splice(5, 0, row({ id: 'opening:dolac', kind: 'opening', atMs: at('2026-09-22T16:30:00Z'), title: 'Tržnica Dolac' }));
    // Update 1: the new row is inserted where its time puts it; the others keep their order and nodes. One record, no move.
    const first = watch();
    t.update(next, 2000, NOW);
    const records = first.structural().filter((r) => r.type === 'childList');
    first.stop();
    expect(ids()).toEqual(groupDepartures(next).map((r) => r.id));
    expect(items().filter((li) => li !== byId('opening:dolac'))).toEqual(kept);
    expect(records.map((r) => [[...r.addedNodes].length, [...r.removedNodes].length])).toEqual([[1, 0]]);
    expect(items().filter((li) => li.dataset.enter === '1').map((li) => li.dataset.id)).toEqual(['opening:dolac']);
    const entering = byId('opening:dolac');
    // An update while the row is still fading keeps the fade and moves nothing.
    vi.advanceTimersByTime(100);
    const w = watch();
    t.update(next, 2000, NOW + 20_000);
    expect(w.structural()).toHaveLength(0);
    expect(byId('opening:dolac')).toBe(entering);
    expect(entering.dataset.enter).toBe('1');
    vi.advanceTimersByTime(ENTER_CLEAR_MS);
    expect(entering.hasAttribute('data-enter')).toBe(false);
    // Update 3: still nothing moves.
    t.update(next, 2000, NOW + 40_000);
    expect(w.structural().filter((r) => r.type === 'childList')).toHaveLength(0);
    w.stop();
  });

  it('lets a departed departure leave the line at the start without moving the cells or the rows that stay', () => {
    const t = mount();
    t.update(scene(), 2000, NOW);
    const rows = items();
    const [, ...stay] = cells();
    const w = watch();
    t.update(scene().slice(1), 2000, NOW);
    const records = w.structural();
    w.stop();
    // The line keeps its node; its first cell leaves, the others keep their place.
    expect(items()).toEqual(rows);
    expect(cells()).toEqual(stay);
    expect(line()!.dataset.cells).toBe('2');
    const childList = records.filter((r) => r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1));
    expect(childList.filter((r) => r.removedNodes.length > 0)).toHaveLength(1);
    expect(childList.filter((r) => r.addedNodes.length > 0)).toHaveLength(0);
  });

  it('runs a departure sequence: the first cell leaves, the next one enters after the cells that stay, nodes survive throughout', () => {
    const t = mount();
    const rows = (first: number): TimelineRow[] => [dep(first), dep(first + 1), dep(first + 2), always()];
    t.update(rows(1), 2000, NOW);
    const li = line()!;
    const node2 = cell('dep:2');
    const node3 = cell('dep:3');
    const nodeAlways = byId('always:story:trg');
    // dep:1 has left, dep:4 is the next one: it enters as the last cell of the line, in the same update.
    const w = watch();
    t.update(rows(2), 2000, NOW + 5 * MIN);
    const records = w.structural().filter((r) => r.type === 'childList');
    expect(ids()).toEqual(['departures', 'always:story:trg']);
    expect(cellIds()).toEqual(['dep:2', 'dep:3', 'dep:4']);
    expect(line()).toBe(li);
    expect(cell('dep:2')).toBe(node2);
    expect(cell('dep:3')).toBe(node3);
    expect(byId('always:story:trg')).toBe(nodeAlways);
    // One removal, one insertion: the two content changes and nothing else.
    expect(records.map((r) => [[...r.addedNodes].length, [...r.removedNodes].length])).toEqual([[0, 1], [1, 0]]);
    expect(cells().map((c) => c.dataset.cell)).toEqual(['1', '2', '3']);
    w.stop();
    const later = watch();
    t.update(rows(2), 2000, NOW + 5 * MIN + 20_000);
    expect(later.structural().filter((r) => r.type === 'childList')).toHaveLength(0);
    later.stop();
    expect(cellIds()).toEqual(['dep:2', 'dep:3', 'dep:4']);
    expect(cell('dep:2')).toBe(node2);
  });

  it('inserts a newcomer earlier than a staying cell before it in one record', () => {
    const t = mount();
    t.update([dep(1), dep(3), always()], 2000, NOW);
    const [one, three] = cells();
    const w = watch();
    t.update([dep(1), dep(2), dep(3), always()], 2000, NOW);
    const records = w.structural().filter((r) => r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1));
    w.stop();
    expect(cellIds()).toEqual(['dep:1', 'dep:2', 'dep:3']);
    expect(cell('dep:1')).toBe(one);
    expect(cell('dep:3')).toBe(three);
    expect(records.map((r) => [[...r.addedNodes].map((n) => (n as HTMLElement).dataset.id), r.removedNodes.length])).toEqual([[['dep:2'], 0]]);
  });

  it('changes the destinations the fit leaves out without an element record: the span stays, only its words change', () => {
    const layout: Layout = { ...WALL_1920 };
    const measure = simulated(layout);
    const t = mount({ measure });
    t.element.style.setProperty('--k-read-scale', '1');
    const rows = [
      dep(1, { title: 'Dubrava', arrival: { routeId: '12', routeName: '12' } }),
      dep(2, { title: 'Prečko', arrival: { routeId: '17', routeName: '17' } }),
      dep(3, { title: 'Borongaj', arrival: { routeId: '17', routeName: '17' } }),
      always(),
    ];
    t.update(rows, 2000, NOW);
    const heads = (): string[] => cells().map((c) => text(c.querySelector('.k-dep-headsign')));
    expect(heads()).toEqual(['Dubrava', 'Prečko', 'Borongaj']);
    const spans = cells().map((c) => c.querySelector('.k-dep-headsign'));
    const w = watch();
    // The dark read tier narrows the cell's destination line: "Borongaj" no longer fits, cells 2 and 3 leave theirs out.
    layout.cellHeadChars = 7;
    t.element.style.setProperty('--k-read-scale', '1.1');
    t.update(rows, 2000, NOW + 1000);
    expect(heads()).toEqual(['Dubrava', '', '']);
    expect(cells().map((c) => c.dataset.headsign ?? '')).toEqual(['', '0', '0']);
    layout.cellHeadChars = 9;
    t.element.style.setProperty('--k-read-scale', '1');
    t.update(rows, 2000, NOW + 2000);
    expect(heads()).toEqual(['Dubrava', 'Prečko', 'Borongaj']);
    const elements = w.structural().filter((r) => r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1));
    w.stop();
    expect(elements).toEqual([]);
    expect(cells().map((c) => c.querySelector('.k-dep-headsign'))).toEqual(spans);
  });

  it('fades a new departure in its cell, never the line, never on the first paint, and not under reduced motion', () => {
    vi.useFakeTimers();
    const t = mount();
    t.update([dep(1), dep(2), always()], 2000, NOW);
    expect([...items(), ...cells()].some((el) => el.hasAttribute('data-enter'))).toBe(false);
    t.update([dep(1), dep(2), dep(3), always()], 2000, NOW);
    expect(cells().filter((c) => c.dataset.enter === '1').map((c) => c.dataset.id)).toEqual(['dep:3']);
    expect(line()!.hasAttribute('data-enter')).toBe(false);
    // A repaint while it fades keeps the fade; animationend on the cell clears it.
    t.update([dep(1), dep(2), dep(3), always()], 2000, NOW + 1000);
    expect(cell('dep:3').dataset.enter).toBe('1');
    cell('dep:3').dispatchEvent(new Event('animationend', { bubbles: true }));
    expect(cell('dep:3').hasAttribute('data-enter')).toBe(false);
    // A line that enters fades as a row, its cells with it.
    t.update([always()], 2000, NOW + 2000);
    t.update([dep(4), always()], 2000, NOW + 3000);
    expect(line()!.dataset.enter).toBe('1');
    expect(cell('dep:4').hasAttribute('data-enter')).toBe(false);
    vi.advanceTimersByTime(ENTER_CLEAR_MS);
    expect(line()!.hasAttribute('data-enter')).toBe(false);
    t.destroy();
    handle = null;
    const u = mount({ reduced: true });
    u.update([dep(1), always()], 2000, NOW);
    u.update([dep(1), dep(2), always()], 2000, NOW);
    expect(cells().some((c) => c.hasAttribute('data-enter'))).toBe(false);
  });

  it('clears the fade on animationend', () => {
    const t = mount();
    t.update([dep(1)], 2000, NOW);
    t.update([dep(1), always()], 2000, NOW);
    const li = byId('always:story:trg');
    expect(li.dataset.enter).toBe('1');
    li.dispatchEvent(new Event('animationend', { bubbles: true }));
    expect(li.hasAttribute('data-enter')).toBe(false);
  });

  it('does not fade the first paint, and never under reduced motion', () => {
    const t = mount({ reduced: true });
    t.update([], 2000, NOW);
    t.update(scene(), 2000, NOW);
    expect(items().some((li) => li.hasAttribute('data-enter'))).toBe(false);
    t.destroy();
    handle = null;
    const u = mount();
    u.update(scene(), 2000, NOW);
    expect(items().some((li) => li.hasAttribute('data-enter'))).toBe(false);
  });

  // The budget counts structure (childList and attribute changes): an idle
  // update writes nothing and an idle minute at most two structural changes.
  // The text of a <time> that counts down is content: it changes once a
  // minute per tracked row, as often as it is true, and is not suppressed.
  it('writes nothing on an idle update and no structural change in a minute of one ticking countdown', () => {
    const t = mount();
    t.update(scene(), 2000, NOW);
    const w = watch();
    t.update(scene(), 2000, NOW + 20_000);
    t.update(scene(), 2000, NOW + 25_000);
    expect(w.structural()).toHaveLength(0);
    expect(w.text()).toHaveLength(0);
    t.update(scene(), 2000, NOW + MIN);
    expect(text(cell('dep:1').querySelector('.nearby-when'))).toBe('za 3 min');
    expect(w.structural().length).toBeLessThanOrEqual(2);
    expect(w.structural()).toHaveLength(0);
    expect(w.text()).toHaveLength(1);
    w.stop();
  });

  it('keeps the structural budget with three tracked countdowns: three truthful text changes a minute, nothing else', () => {
    const t = mount();
    const rows = [dep(1, { atMs: NOW + 3 * MIN }), dep(2, { atMs: NOW + 6 * MIN }), dep(3, { atMs: NOW + 9 * MIN }), always()];
    t.update(rows, 2000, NOW);
    const nodes = [...items(), ...cells()];
    const w = watch();
    for (let s = 20; s <= 60; s += 20) t.update(rows, 2000, NOW + s * 1000);
    expect(cells().map((c) => text(c.querySelector('.nearby-when')))).toEqual(['za 2 min', 'za 5 min', 'za 8 min']);
    expect(text(byId('always:story:trg').querySelector('.nearby-when'))).toBe('uvijek');
    expect(w.structural().length).toBeLessThanOrEqual(2);
    expect(w.structural()).toHaveLength(0);
    expect(w.text()).toHaveLength(3);
    for (const r of w.text()) expect((r.target.parentElement as Element).matches('time.nearby-when')).toBe(true);
    expect([...items(), ...cells()]).toEqual(nodes);
    w.stop();
  });
});

describe('whole rows from the row budget', () => {
  /** n wall rows: the departures line (one departure, R1), n - 2 events and the place row. */
  const many = (n: number): TimelineRow[] => [dep(1), ...Array.from({ length: n - 2 }, (_, i) => row({ id: `event:${i + 2}`, kind: 'event', atMs: NOW + (i + 2) * 4 * MIN, title: 'Koncert' })), always()];

  it('re-fits the same rows when the dark read multiplier changes without a resize', () => {
    const measure: TimelineMeasure = {
      box: list => ({ height: 400, width: 472, overflow: list.children.length * 80 * Number(section().style.getPropertyValue('--k-read-scale')) > 400 }),
      lines: () => 1,
    };
    const t = mount({ measure });
    t.element.style.setProperty('--k-read-scale', '1');
    t.update(many(5), 2000, NOW);
    expect(t.shown()).toBe(5);
    t.element.style.setProperty('--k-read-scale', '1.1');
    t.update(many(5), 2000, NOW);
    expect(t.shown()).toBe(4);
    expect(section().dataset.fitOverflow).toBe('0');
    t.element.style.setProperty('--k-read-scale', '1');
    t.update(many(5), 2000, NOW);
    // R1: the row that went is an event (the departures are the line), so it returns after the restore hold.
    expect(t.shown()).toBe(4);
    t.update(many(5), 2000, NOW + FIT_RESTORE_HOLD_MS);
    expect(t.shown()).toBe(5);
  });
  it('reserves first, last and uvijek before both the initial row cap and the measured drop pass (decision 27)', () => {
    const last = row({ id: 'last:night', kind: 'last', title: 'Zadnji tramvaji' });
    const first = row({ id: 'first:morning', kind: 'first', title: 'Prvi tramvaj' });
    const rows = [dep(1), dep(2), dep(3), row({ id: 'event:next', kind: 'event', title: 'Koncert' }), last, first, always()];
    const required = ['dep:1', last.id, first.id, always().id];
    // An ungrouped list (a handheld's, the phone's cap) reserves its first departure.
    expect(fitRows(rows, 4).map(r => r.id)).toEqual(required);
    const measure: TimelineMeasure = {
      box: list => ({ height: 400, width: 472, overflow: list.children.length > 4 }),
      lines: () => 1,
    };
    const t = mount({ measure });
    t.update(rows, 2000, NOW);
    // R1: on the wall the line is the reserved row and holds the three departures; the event gives way.
    expect(ids()).toEqual(['departures', last.id, first.id, always().id]);
    expect(cellIds()).toEqual(['dep:1', 'dep:2', 'dep:3']);
    expect(measure.box(host.querySelector('ol')!).overflow).toBe(false);
    expect(dropCandidate([last, first, always()])).toBeNull();
  });
  it('grows three rows to 92 px and shrinks twelve to whole 64 px rows', () => {
    const t = mount({ designHeightPx: 520 });
    t.update(many(3), 2000, NOW);
    expect(section().style.getPropertyValue('--k-nearby-row')).toBe('92px');
    expect(section().style.getPropertyValue('--k-nearby-scale')).toBe('1.1');
    expect(t.shown()).toBe(3);
    t.update(many(12), 2000, NOW);
    expect(section().style.getPropertyValue('--k-nearby-row')).toBe('64px');
    expect(section().style.getPropertyValue('--k-nearby-scale')).toBe('1');
    // floor(520 / 64) = 8 whole rows, none of them hidden.
    expect(t.shown()).toBe(8);
    expect(items()).toHaveLength(8);
    expect(items().some((li) => li.hasAttribute('hidden'))).toBe(false);
  });

  it('keeps the "uvijek" row when the budget cuts the list: the latest timed rows give way', () => {
    const t = mount({ designHeightPx: 520 });
    t.update(many(12), 2000, NOW);
    expect(ids().at(-1)).toBe('always:story:trg');
    expect(ids().slice(0, 7)).toEqual(['departures', 'event:2', 'event:3', 'event:4', 'event:5', 'event:6', 'event:7']);
  });

  it('shows every row of an unbounded list (a handheld) and never measures it', () => {
    const t = mount({ designHeightPx: Number.POSITIVE_INFINITY });
    t.update(many(20), 2000, NOW);
    expect(t.shown()).toBe(20);
    expect(section().style.getPropertyValue('--k-nearby-row')).toBe('64px');
  });

  it('reads a function for the design height on every update', () => {
    let height = 520;
    const t = mount({ designHeightPx: () => height });
    t.update(many(12), 2000, NOW);
    expect(t.shown()).toBe(8);
    height = 300;
    t.update(many(12), 2000, NOW);
    expect(t.shown()).toBe(4);
    expect(t.measureHeight()).toBe(0);
  });

  it('fits rows, drops them in the order that keeps a departure, and scales type by the rules the CSS is written for', () => {
    const rows = [dep(1), dep(2), always(), dep(3)];
    expect(fitRows(rows, 4)).toEqual(rows);
    expect(fitRows(rows, 2).map((r) => r.id)).toEqual(['dep:1', 'always:story:trg']);
    expect(fitRows(rows, 0)).toEqual([rows[2]]); // A zero estimate never removes the reserved place row.
    const closure = row({ id: 'closure:x', kind: 'closure', atMs: NOW + 30 * MIN });
    const solar = row({ id: 'solar:x', kind: 'solar', atMs: NOW + 60 * MIN });
    // The value order (shared/kiosk/takt.ts, R0 §0.5 item 1): without `now` every row counts its base value, so the
    // sunset (20) goes before the closure (60) and the second departure (100).
    expect(dropCandidate([dep(1), dep(2), closure, solar, always()])?.id).toBe('solar:x');
    // With `now` a row counts its base value times its imminence (1 within 30 min, 0.8 within 2 h, 0.5 within 6 h);
    // decision 67's bound is subsumed: a far solar, opening or event row is worth less than any departure within 2 h.
    const solarSoon = row({ id: 'solar:soon', kind: 'solar', atMs: NOW + 6 * MIN });
    const solarFar = row({ id: 'solar:far', kind: 'solar', atMs: NOW + 90 * MIN });
    const opening = row({ id: 'opening:x', kind: 'opening', atMs: NOW + 75 * MIN });
    const event = row({ id: 'event:x', kind: 'event', atMs: NOW + 90 * MIN });
    expect(IMMINENT_ROW_MIN).toBe(60);
    expect(dropCandidate([dep(1), dep(2), closure, solarFar, always()])?.id).toBe('solar:far'); // 20 < 60 < 100
    expect(dropCandidate([dep(1), dep(2), closure, solarFar, always()], NOW)?.id).toBe('solar:far');
    expect(dropCandidate([dep(1), dep(2), closure, solarSoon, always()], NOW)?.id).toBe('solar:soon'); // 20 < 60
    expect(dropCandidate([dep(1), dep(2), closure, row({ id: 'solar:hour', kind: 'solar', atMs: NOW + IMMINENT_ROW_MIN * MIN }), always()], NOW)?.id).toBe('solar:hour'); // 16 < 60
    expect(dropCandidate([dep(1), dep(2), dep(3), opening, solarFar, always()], NOW)?.id).toBe('solar:far');
    expect(dropCandidate([dep(1), dep(2), dep(3), opening, always()], NOW)?.id).toBe('opening:x');
    expect(dropCandidate([dep(1), dep(2, { atMs: NOW + 120 * MIN }), solarFar, always()], NOW)?.id).toBe('solar:far'); // 16 < 80
    // An event 90 minutes away (48) yields before the second departure (100).
    expect(dropCandidate([dep(1), dep(2), event, always()], NOW)?.id).toBe('event:x');
    // An event within 30 minutes (60) and a closure under way (60) tie; the tie goes to the row later in the list.
    expect(dropCandidate([dep(1), row({ id: 'event:noon', kind: 'event', atMs: NOW + 10 * MIN }), closure, always()], NOW)?.id).toBe('closure:x');
    expect(dropCandidate([dep(1), closure, solarSoon, always()], NOW)?.id).toBe('solar:soon');
    expect(dropCandidate([dep(1), dep(2), always()])?.id).toBe('dep:2');
    // A closure (60) goes before a second departure (100); the first departure is reserved.
    expect(dropCandidate([dep(1), dep(2), closure, always()])?.id).toBe('closure:x');
    expect(dropCandidate([dep(1), closure, always()])?.id).toBe('closure:x');
    expect(dropCandidate([dep(1), always()])).toBeNull();
    expect(dropCandidate([dep(1), dep(2)])?.id).toBe('dep:2');
    expect(dropCandidate([dep(1)])).toBeNull();
    // Round 1 (24 Sep, the live evening list): a row for a later day goes before the second and third departures,
    // the latest first; a closure ending tomorrow is closed now (60, under way) and goes before the second departure
    // (100); today's rows go by value too.
    const DAY = 24 * 60 * MIN;
    const openingTomorrow = row({ id: 'opening:muzej', kind: 'opening', atMs: NOW + DAY });
    const sunriseTomorrow = row({ id: 'solar:sunrise', kind: 'solar', atMs: NOW + 13 * 60 * MIN });
    const closureTomorrow = row({ id: 'closure:tomorrow', kind: 'closure', atMs: NOW + DAY });
    expect(dropCandidate([dep(1), dep(2), dep(3), openingTomorrow, always()], NOW)?.id).toBe('opening:muzej');
    expect(dropCandidate([dep(1), dep(2), sunriseTomorrow, openingTomorrow, always()], NOW)?.id).toBe('opening:muzej');
    expect(dropCandidate([dep(1), dep(2), sunriseTomorrow, always()], NOW)?.id).toBe('solar:sunrise');
    expect(dropCandidate([dep(1), openingTomorrow, always()], NOW)?.id).toBe('opening:muzej');
    expect(dropCandidate([dep(1), dep(2), closureTomorrow, always()], NOW)?.id).toBe('closure:tomorrow'); // 60 < 100
    expect(dropCandidate([dep(1), dep(2), closure, solar, always()], NOW)?.id).toBe('solar:x'); // 16 < 60
    const first = row({ id: 'first:morning', kind: 'first', atMs: NOW + DAY });
    expect(dropCandidate([dep(1), first, always()], NOW)).toBeNull();
    expect([openingTomorrow, sunriseTomorrow].map((r) => onLaterDay(r, NOW))).toEqual([true, true]);
    expect([closureTomorrow, first, dep(1), always(), closure, solar].map((r) => onLaterDay(r, NOW))).toEqual([false, false, false, false, false, false]);
    expect(typeScale(64)).toBe(1);
    expect(typeScale(GROW_FROM_PX)).toBe(1);
    expect(typeScale(92)).toBeCloseTo(1.1);
    // A two-line row at the floors (44 + 32 px of line boxes, scaled) fits its budget from GROW_FROM_PX on.
    for (let px = GROW_FROM_PX; px <= 92; px += 1) expect((40 * 1.1 + 28 * 1.15) * typeScale(px)).toBeLessThanOrEqual(px - 1);
  });

  it('keeps three departures over tomorrow\u2019s openings when the box holds three rows (round 1, 24 Sep; R1: the line is one row)', () => {
    const DAY = 24 * 60 * MIN;
    const rows = [dep(1), dep(2), dep(3), row({ id: 'opening:a', kind: 'opening', atMs: NOW + DAY, title: 'Galerija Harmica' }),
      row({ id: 'opening:b', kind: 'opening', atMs: NOW + DAY, title: 'Hrvatski športski muzej' }), always()];
    const measure: TimelineMeasure = {
      box: list => ({ height: 400, width: 472, overflow: list.children.length > 3 }),
      lines: () => 1,
    };
    const t = mount({ measure });
    t.update(rows, 2000, NOW);
    expect(ids()).toEqual(['departures', 'opening:a', 'always:story:trg']);
    expect(cellIds()).toEqual(['dep:1', 'dep:2', 'dep:3']);
    // The evening of 24 Sep on the live wall: eleven candidates in a box for eight, the last, sunrise and two openings tomorrow.
    const evening = [dep(1), dep(2), dep(3), row({ id: 'last:tonight', kind: 'last', atMs: NOW + 3 * 60 * MIN, title: 'Zadnji tramvaji' }),
      row({ id: 'solar:sunrise', kind: 'solar', atMs: NOW + 13 * 60 * MIN, title: 'Izlazak sunca' }),
      row({ id: 'opening:a', kind: 'opening', atMs: NOW + DAY, title: 'Galerija Harmica' }),
      row({ id: 'opening:b', kind: 'opening', atMs: NOW + DAY, title: 'Hrvatski športski muzej' }), always()];
    t.destroy();
    host.innerHTML = '';
    // R1: eight candidates, six wall rows, in a box for four.
    const tight = mount({ measure: { box: list => ({ height: 400, width: 472, overflow: list.children.length > 4 }), lines: () => 1 } });
    tight.update(evening, 2000, NOW);
    expect(ids()).toEqual(['departures', 'last:tonight', 'solar:sunrise', 'always:story:trg']);
    expect(cellIds()).toEqual(['dep:1', 'dep:2', 'dep:3']);
  });
  it('lets the second departure in where the trains placed first were too tall to keep (production 29 Sep 23:25, portrait: one departure, 74 px unused)', () => {
    // The reduced state puts two trains before the departures (railPolicy). The row budget of a 498 px totem box
    // holds seven candidates: four reserved rows, the first departure and, because a train placed first is not a
    // facts-breadth row, the two trains; the second and third departures never enter the measured fit. The trains
    // (a two-line headsign over the station) are 128 px each and the measured pass drops both, leaving 74 px the
    // 64 px second departure would fill: the measured fit must try the rows the estimate left out.
    const NIGHT = at('2026-09-29T21:25:00Z');
    const H = 60 * MIN;
    const train = (n: number, headsign: string, atMs: number): TimelineRow =>
      row({ id: `rail:${n}`, kind: 'rail', atMs, title: headsign, sub: 'Zagreb Glavni kolodvor', source: 'hz', arrival: { routeId: 'i-tr1063', routeName: 'Vlak', tripId: `rail:${n}`, headsign, atMs, live: false, minutes: null } });
    const rows = [
      train(1, 'Zagreb Glavni kolodvor - Koprivnica', NIGHT + 13 * MIN), train(2, 'Harmica - Dugo Selo', NIGHT + 31 * MIN),
      dep(1, { atMs: NIGHT + 2 * MIN, live: false, title: 'Z. kolodvor', arrival: { routeId: '1', routeName: '1' } }),
      dep(2, { atMs: NIGHT + 4 * MIN, live: false, title: 'Borongaj', arrival: { routeId: '17', routeName: '17' } }),
      dep(3, { atMs: NIGHT + 5 * MIN, live: false, title: 'Črnomerec', arrival: { routeId: '11', routeName: '11' } }),
      row({ id: 'notice:zet-novosti:10166', kind: 'notice', atMs: NIGHT - 13 * H, title: 'Uspostavljena autobusna linija 228 (Borongaj – Rebro – Borongaj)', source: 'zet-novosti' }),
      row({ id: 'last:2026-09-29', kind: 'last', atMs: NIGHT + 6 * MIN, title: 'Zadnji tramvaji', sub: '1 23:31 · 12 23:45' }),
      row({ id: 'closure:vukovara', kind: 'closure', atMs: NIGHT + 6 * H, title: 'Grada Vukovara', source: 'prometnice', endKnown: false }),
      row({ id: 'first:2026-09-30', kind: 'first', atMs: NIGHT + 4 * H + 48 * MIN, title: 'Prvi tramvaj', sub: '12 04:13 · 17 04:24' }),
      row({ id: 'solar:sunrise', kind: 'solar', atMs: NIGHT + 7 * H + 27 * MIN, title: 'Izlazak sunca', source: 'solar' }),
      row({ id: 'event:putnici', kind: 'event', atMs: NIGHT + 11 * H, title: 'Izložba „Putnici“', sub: 'Etnografski muzej', source: 'kultura-zg' }),
      row({ id: 'always:pharmacy', kind: 'pharmacy', atMs: null, always: true, title: '24/7', sub: 'Trg bana J. Jelačića 3', source: 'ljekarne' }),
    ];
    const measure = simulated(TOTEM_1080);
    const t = mount({ measure, designHeightPx: TOTEM_1080.boxPx });
    t.update(rows, 2200, NIGHT);
    // R1: the line holds the three departures in one 84 px row (the totem's inline cell and its destination line), so
    // the trains' room goes to the closure; the sunrise and the event yield as before (496 px of 498).
    expect(ids()).toEqual(['departures', 'notice:zet-novosti:10166', 'last:2026-09-29', 'closure:vukovara', 'first:2026-09-30', 'always:pharmacy']);
    expect(cellIds()).toEqual(['dep:1', 'dep:2', 'dep:3']);
    expect(measure.sum(host.querySelector('ol')!)).toBeLessThanOrEqual(TOTEM_1080.boxPx);
    expect(section().dataset.fitDropped).toBe('rail rail solar event');
    expect(measure.box(host.querySelector('ol')!).overflow).toBe(false);
  });
});

/**
 * A layout for the fit: a title line holds `titleChars` characters, a sub line
 * `subChars` (whole words, wrapped), a row is as tall as its lines (44 px a
 * title line, 32 px a sub line, 8 px of padding) and never below the budget.
 * The widths are the wall's text column at 40/28 px Manrope: about 408 px at
 * 1920 x 1080 (the 680 px aside) and 790 px on the 1080 x 1920 totem.
 */
type Layout = MeasureLayout;
const WALL_1920: Layout = { boxPx: 486, titleChars: 17, subChars: 26, ...LINE_1920 };
const TOTEM_1080: Layout = { boxPx: 498, titleChars: 34, subChars: 51, ...LINE_PORTRAIT };
function wrapLines(textIn: string, perLine: number): number {
  if (!textIn) return 0;
  let lines = 1;
  let used = 0;
  for (const word of textIn.split(' ')) {
    const need = used === 0 ? word.length : used + 1 + word.length;
    if (need <= perLine) used = need;
    else { lines += 1; used = word.length; }
  }
  return lines;
}
/** An event title stops at EVENT_TITLE_MAX_LINES on the wall, as its line-clamp does (kiosk-city.css, U0 step 7). */
const clampedEvent = (el: Element, lines: number): number =>
  (el.classList.contains('nearby-title') && el.closest<HTMLElement>('li.nearby-row')?.dataset.kind === 'event' ? Math.min(EVENT_TITLE_MAX_LINES, lines) : lines);
function simulated(layout: Layout): TimelineMeasure & { rowHeight(li: Element): number; sum(list: Element): number } {
  // The departures line's cells (R1) as timeline-measure.ts models them: the destination's lines, the cell's and the
  // destination's overflow, the line's height stacked or inline.
  const lines = (el: Element): number => cellLines(el, layout) ?? clampedEvent(el, wrapLines(el.textContent ?? '', el.classList.contains('nearby-title') ? layout.titleChars : layout.subChars));
  const rowPx = (): number => Number.parseFloat(section().style.getPropertyValue('--k-nearby-row')) || 64;
  const rowHeight = (li: Element): number => lineHeight(li, layout, rowPx())
    ?? Math.max(rowPx(), 44 * lines(li.querySelector('.nearby-title')!) + 32 * lines(li.querySelector('.nearby-sub')!) + 8);
  const sum = (list: Element): number => [...list.children].reduce((acc, li) => acc + rowHeight(li), 0);
  // The measuring list carries the box it is fitted in as its own height (timeline.ts fit), as the DOM measure reads it.
  const heightOf = (list: Element): number => Number.parseFloat((list as HTMLElement).style?.height ?? '') || layout.boxPx;
  return {
    box: (el) => {
      const cell = cellOverflow(el, layout);
      if (cell !== null) return { height: 0, width: 0, overflow: cell };
      return { height: heightOf(el), width: layout.titleChars, overflow: sum(el) > heightOf(el) };
    },
    lines: (el) => lines(el),
    rowHeight,
    sum,
  };
}

/** The night list of Sunday 27 September at 04:00 (decision 67, observe-d530): the ten rows the selection gave. */
function nightList0400(): TimelineRow[] {
  const night = (hhmm: string): number => at(`2026-09-27T${hhmm}:00+02:00`);
  const closure = (id: string, title: string, until: string): TimelineRow => row({ id: `closure:${id}`, kind: 'closure', atMs: night(until), title,
    sub: 'zatvoreno zbog radova, oba smjera', subShort: 'zatvoreno za promet', source: 'prometnice' });
  const opening = (id: string, title: string): TimelineRow => row({ id: `open:culture-${id}:2026-09-27`, kind: 'opening', atMs: night('10:00'), title, sub: 'Kultura', source: 'culture' });
  return [
    dep(1, { atMs: night('04:04'), live: false, title: 'Prečko', source: 'zet-gtfs', arrival: { routeId: '32', routeName: '32' } }),
    dep(2, { atMs: night('04:06'), title: 'Črnomerec', source: 'zet-rt', arrival: { routeId: '31', routeName: '31' } }),
    dep(3, { atMs: night('04:22'), live: false, title: 'Borongaj', source: 'zet-gtfs', arrival: { routeId: '32', routeName: '32' } }),
    row({ id: 'first:2026-09-27', kind: 'first', atMs: night('05:19'), title: 'Prvi tramvaj',
      sub: '11 05:19 · 12 05:20 · 17 05:31 · 6 05:59 · 14 06:16 · 13 06:21', subShort: '11 05:19 · 12 05:20', source: 'zet-gtfs' }),
    row({ id: 'solar:sunrise:2026-09-27', kind: 'solar', atMs: night('06:48'), title: 'Izlazak sunca', source: 'solar' }),
    opening('d62358d5d2fc659f', 'Arheološki muzej u Zagrebu'),
    opening('karas', 'Galerija Karas'),
    closure('amruseva', 'Amruševa', '16:00'),
    closure('gunduliceva', 'Gundulićeva', '18:00'),
    row({ id: 'always:pharmacy', kind: 'pharmacy', atMs: null, always: true, title: '24/7', sub: 'Trg bana J. Jelačića 3', source: 'ljekarne' }),
  ];
}

/** Real rows from the fixtures of 22 September, the long ones with the shorter complete labels the selection layer may offer. */
function longRows(): TimelineRow[] {
  return [
    dep(1, { title: 'Črnomerec', arrival: { routeId: '6', routeName: '6' } }),
    dep(2, { title: 'Zapadni kolodvor', arrival: { routeId: '11', routeName: '11' }, live: false }),
    dep(3, { title: 'Savski most', arrival: { routeId: '13', routeName: '13' } }),
    row({ id: 'closure:vukovarska', kind: 'closure', atMs: at('2026-09-22T16:30:00Z'), title: 'Ulica grada Vukovara', titleShort: 'Vukovarska', sub: 'Zatvoren kolnik između Savske i Miramarske', subShort: 'Savska – Miramarska', source: 'prometnice' }),
    row({ id: 'event:gavella', kind: 'event', atMs: at('2026-09-22T18:00:00Z'), title: 'Gospoda Glembajevi', titleShort: 'Glembajevi', sub: 'Gradsko dramsko kazalište Gavella · tramvaj 6', subShort: 'Gavella · tramvaj 6', source: 'dogadanja' }),
    row({ id: 'solar:sunset:2026-09-22', kind: 'solar', atMs: at('2026-09-22T17:07:00Z'), title: 'Zalazak sunca', source: 'solar' }),
    row({ id: 'last:2026-09-22', kind: 'last', atMs: at('2026-09-22T21:31:00Z'), title: 'Zadnji tramvaji', sub: '1 23:31 · 12 23:45 · 17 00:01 · 11 00:09 · 6 00:27 · 13 00:30 · 14 00:31', subShort: '1 23:31 · 12 23:45 · 17 00:01', source: 'zet-gtfs' }),
    row({ id: 'always:heritage:stedionica', kind: 'always', atMs: null, always: true, title: 'Zgrada nekadašnje Gradske štedionice', titleShort: 'Gradska štedionica', sub: 'Trg bana Jelačića 9 i 10', source: 'city' }),
  ];
}

/**
 * The compact wall as the D2 full run measured it at 1366 x 768 (dark): a 154 px list, a 397 px text column
 * (16 read-tier title characters, 25 walk-up sub characters a line); a row is 44 px a title line, 32 px a sub
 * line, 8 px of padding, never below the row budget. The night promises are the rows of lastTrams2240.
 */
const COMPACT_1366: Layout = { boxPx: 154, titleChars: 16, subChars: 25, ...LINE_1366 };
function nightRows(): TimelineRow[] {
  const night = (hhmm: string, day = '22'): number => at(`2026-09-${day}T${hhmm}:00+02:00`);
  return [
    dep(1, { atMs: night('22:41', '21'), title: 'Dubrava', arrival: { routeId: '12', routeName: '12' } }),
    dep(2, { atMs: night('22:48', '21'), live: false, title: 'Borongaj', source: 'zet-gtfs', arrival: { routeId: '17', routeName: '17' } }),
    dep(3, { atMs: night('22:48', '21'), live: false, title: 'Črnomerec', source: 'zet-gtfs', arrival: { routeId: '6', routeName: '6' } }),
    row({ id: 'last:2026-09-21', kind: 'last', atMs: night('23:31', '21'), title: 'Zadnji tramvaji',
      sub: '1 23:31 · 12 23:45 · 17 00:01 · 11 00:09 · 6 00:27 · 13 00:30 · 14 00:31', subShort: '1 23:31 · 12 23:45', source: 'zet-gtfs' }),
    row({ id: 'first:2026-09-22', kind: 'first', atMs: night('04:13'), title: 'Prvi tramvaj',
      sub: '12 04:13 · 17 04:24 · 1 04:33 · 11 04:51 · 6 04:57 · 14 05:11 · 13 05:27', subShort: '12 04:13 · 17 04:24', source: 'zet-gtfs' }),
    row({ id: 'always:pharmacy', kind: 'pharmacy', atMs: null, always: true, title: '24/7', sub: 'Trg bana J. Jelačića 3', source: 'ljekarne' }),
  ];
}

/** Decision 50: the compact list takes the whole 513 px aside less its heading and padding, 451 px measured. */
const COMPACT_1366_D50: Layout = { boxPx: 451, titleChars: 16, subChars: 25, ...LINE_1366 };

/**
 * The compact wall's column as the accept night scenes measured it at 1366 x 768 (dark; lane w-labels2): the
 * window 513 px, the gap 14, the QR card 284, the list's head and padding 61, and the legend 56: Trg's frame
 * fits 1366 x 768 below the marks' floor in every arrangement (z12.3 at most), so the map draws its rings and
 * pills and the legend lists the tram line alone (one line; mapview.ts legendKinds).
 */
const COMPACT_1366_WINDOW = { windowPx: 513, gapPx: 14, cardPx: 284, legendPx: 56, listOverheadPx: 61, minMapPx: MAP_MIN_HEIGHT_PX };

describe('every hour of the real Trg timetable fits both wall sizes (decision 50)', () => {
  const file = JSON.parse(readFileSync(join(import.meta.dirname, '../../app/public/data/lastrun/106_1.json'), 'utf8'));
  const place = { kind: 'tram' as const, stopId: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286 };
  const platforms = ['106_1', '106_2', '1849_23', '1849_24'];
  for (const [name, layout] of [['1920 x 1080', WALL_1920], ['1366 x 768', COMPACT_1366_D50]] as const) {
    it(`${name}: the promises and at least one departure fit whole in every hour of two days, data-fit-overflow 0${layout === COMPACT_1366_D50 ? ', and the map is never below its legible minimum' : ''}`, () => {
      for (let hour = 0; hour < 48; hour++) {
        const day = hour < 24 ? '21' : '22';
        const now = at(`2026-09-${day}T${String(hour % 24).padStart(2, '0')}:20:00+02:00`);
        const lastRun: LastRunLive = { ...file, status: 'live', fetchedAt: new Date(now).toISOString(), sourceUpdatedAt: file.generatedAt };
        const boards = platforms.map((stopId) => departuresBoard({ now, stopId }));
        const rows = selectNearby({ place, radiusM: 2182, now, locale: 'hr', i18n, lastRun, snapshots: {}, city: emptyCity(), fixes: [], boards });
        const measure = simulated(layout);
        const t = mount({ measure, designHeightPx: layout.boxPx });
        t.update(rows, 2182, now);
        const shown = expanded();
        const label = `${name} on the ${day}th at ${String(hour % 24).padStart(2, '0')}:20: ${shown.join(', ')}`;
        expect(section().dataset.fitOverflow, label).toBe('0');
        if (rows.some((r) => r.kind === 'departure')) expect(shown.some((id) => id.startsWith('dep:')), label).toBe(true);
        // R1: the line holds every departure the selection offered.
        expect(shownDepartures(), label).toEqual(rows.filter((r) => r.kind === 'departure').map((r) => r.id));
        for (const promise of rows.filter((r) => r.kind === 'first' || r.kind === 'last' || r.always)) expect(shown, label).toContain(promise.id);
        for (const li of items()) if (li.dataset.kind !== 'departures') expect(measure.lines(li.querySelector('.nearby-sub')!), label).toBeLessThanOrEqual(SUB_MAX_LINES);
        if (layout === COMPACT_1366_D50) {
          // Lane w-labels2: the rows the fit never drops, as tall as this layout draws them, and the arrangement
          // the wall picks for them (invitation.ts compactArrangement): the list holds them and the map is legible.
          const lead = line();
          const kept = items().filter((li) => li.dataset.kind === 'first' || li.dataset.kind === 'last' || li.dataset.always === '1' || li === lead);
          // Each at its content, never under the smallest row: the height it keeps in a smaller box.
          const floorPx = kept.reduce((sum, li) => sum + (lineHeight(li, layout, 64) ?? Math.max(64, 44 * measure.lines(li.querySelector('.nearby-title')!) + 32 * measure.lines(li.querySelector('.nearby-sub')!) + 8)), 0);
          // Lane w-labels3 (decision 50 refined) with R1: the line holds the second and third departures already
          // (invitation.ts: fullPx is floorPx with the line on the wall).
          const fullPx = floorPx;
          const box = compactArrangement({ ...COMPACT_1366_WINDOW, floorPx, fullPx });
          expect(box.mapPx, `${label}: the map (${box.placement})`).toBeGreaterThanOrEqual(MAP_MIN_HEIGHT_PX);
          expect(box.listPx, `${label}: the list holds its promises (${box.placement})`).toBeGreaterThanOrEqual(floorPx);
          // The list as the wall then fits it, in the box that arrangement leaves.
          t.destroy();
          host.innerHTML = '';
          const inBox = simulated({ ...layout, boxPx: box.listPx });
          const t2 = mount({ measure: inBox, designHeightPx: box.listPx });
          t2.update(rows, 2182, now);
          const departures = shownDepartures().length;
          // At least two wherever decision 50's whole-aside list (ea5439e) showed two or more and the arrangement's box
          // has the room for a second departure at the smallest row beside the promises. Round 1 (24 Sep): with tomorrow's
          // sunrise no longer outliving the second tram, the whole-aside list at 22:20 shows two departures where it showed
          // one, while the legend arrangement's 396 px hold the two-line lead ("13 Kvaternikov trg", 96 px) and the three
          // promises (348 px) but not a second 64 px row, and the map's legible minimum outranks it (decision 50 refined).
          const d50 = shown.filter((id) => id.startsWith('dep:')).length;
          const roomForTwo = box.listPx >= floorPx + 64;
          expect(departures, `${label}: departures in the ${box.placement} arrangement (${box.listPx} px list, room for two: ${roomForTwo}; decision 50's showed ${d50})`).toBeGreaterThanOrEqual(Math.min(2, d50, roomForTwo ? 2 : 1));
          expect(section().dataset.fitOverflow, label).toBe('0');
        }
        handle?.destroy();
        handle = null;
        host.innerHTML = '';
      }
    // Two days of the real timetable, a mount and a fit per hour (two at 1366): 5 to 8 s on a host at load 20 to 40,
    // the same with the module of 03232c88 (round 1, 24 Sep: timed out at the 5 s default inside the four-worker gate).
    }, 30_000);
  }
});

describe('the compact wall and the night promises (decision 27, D2 full run at 1366 x 768)', () => {
  const NIGHT = at('2026-09-21T22:40:00+02:00');

  it('keeps a departure beside the three promises in a box that cannot hold them, and says so, instead of showing none', () => {
    const measure = simulated(COMPACT_1366);
    const t = mount({ measure, designHeightPx: COMPACT_1366.boxPx });
    t.update(nightRows(), 2182, NIGHT);
    const kinds = items().map((li) => li.dataset.kind);
    // The promises stay (decision 27) and the wall never shows zero departures (1 to 3 in every reading). R1: the
    // line is reserved and holds the three; "Borongaj" does not fit the 1366 cell's destination line (7 characters),
    // so cells 2 and 3 print the line and the time only.
    expect(kinds).toEqual(['departures', 'last', 'first', 'pharmacy']);
    expect(cellIds()).toEqual(['dep:1', 'dep:2', 'dep:3']);
    expect(cells().map((c) => c.dataset.headsign ?? '')).toEqual(['', '0', '0']);
    // Every shown sub is its shorter complete twin, never a wrapped three-line list.
    for (const li of items()) if (li !== line()) expect(measure.lines(li.querySelector('.nearby-sub')!)).toBeLessThanOrEqual(SUB_MAX_LINES);
    expect(text(byId('last:2026-09-21').querySelector('.nearby-sub'))).toBe('1 23:31 · 12 23:45');
    expect(text(byId('first:2026-09-22').querySelector('.nearby-sub'))).toBe('12 04:13 · 17 04:24');
    // An impossible box is reported, not hidden by deleting a row: the line's 96 + 3 x 84 = 348 px in 154.
    expect(section().dataset.fitOverflow).toBe('1');
    expect(section().dataset.skippedFit).toBe('0');
    expect(measure.sum(host.querySelector('ol')!)).toBe(348);
  });

  it('at 1920 x 1080 shows the three promises with two-line subs at most and all three departures', () => {
    const measure = simulated(WALL_1920);
    const t = mount({ measure });
    t.update(nightRows(), 2182, NIGHT);
    const kinds = items().map((li) => li.dataset.kind);
    // R1: the line and the three promises, four rows; the three departures in the line.
    expect(shownDepartures()).toEqual(['dep:1', 'dep:2', 'dep:3']);
    expect(kinds).toEqual(['departures', 'last', 'first', 'pharmacy']);
    for (const li of items()) if (li !== line()) expect(measure.lines(li.querySelector('.nearby-sub')!)).toBeLessThanOrEqual(SUB_MAX_LINES);
    expect(section().dataset.fitOverflow).toBe('0');
    expect(measure.sum(host.querySelector('ol')!)).toBeLessThanOrEqual(WALL_1920.boxPx);
  });
});

describe('the daytime wall (D5.8 production observer): rows shrink before a row is dropped, and the recorder excuses any row that turns over', () => {
  /** The 1920 x 1080 list as the observer saw it: seven rows in 483 px, the heritage row with an address line (84 px). */
  const DAY: Layout = { boxPx: 483, titleChars: 17, subChars: 26 };
  const day = (hhmm: string): number => at(`2026-09-24T${hhmm}:00+02:00`);
  const timed = (): TimelineRow[] => [
    row({ id: 'closure:amruseva', kind: 'closure', atMs: day('16:00'), title: 'Amruševa', source: 'prometnice' }),
    row({ id: 'closure:gunduliceva', kind: 'closure', atMs: day('18:00'), title: 'Gundulićeva', source: 'prometnice' }),
    row({ id: 'solar:sunset:2026-09-24', kind: 'solar', atMs: day('18:51'), title: 'Zalazak sunca', source: 'solar' }),
    row({ id: 'always:heritage:zakladni', kind: 'always', atMs: null, always: true, title: 'Zakladni blok', sub: 'Gajeva 2,2a,2b,2c', source: 'heritage' }),
  ];
  const departures = (from: number): TimelineRow[] => [
    dep(1, { atMs: from, title: 'Sopot', arrival: { routeId: '6', routeName: '6' } }),
    dep(2, { atMs: from + 30_000, title: 'Borongaj', arrival: { routeId: '17', routeName: '17' } }),
    dep(3, { atMs: from + 60_000, title: 'Dubec', arrival: { routeId: '11', routeName: '11' } }),
    dep(4, { atMs: from + 4 * MIN, title: 'Žitnjak', arrival: { routeId: '13', routeName: '13' } }),
  ];
  function structure(): { records(): { added: string[]; removed: string[] }[]; stop(): void } {
    const observer = new MutationObserver(() => undefined);
    observer.observe(section(), { subtree: true, childList: true });
    const keyed = (nodes: NodeList): string[] => [...nodes].filter((n): n is Element => n.nodeType === 1).map((n) => `${n.tagName.toLowerCase()}[${n.getAttribute('data-key') ?? ''}]`);
    return {
      records: () => observer.takeRecords().filter((r) => r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1))
        .map((r) => ({ added: keyed(r.addedNodes), removed: keyed(r.removedNodes) })),
      stop: () => observer.disconnect(),
    };
  }

  it('shrinks the rows to 64 px before dropping a discretionary row: seven rows with one 84 px row fit the 483 px box whole', () => {
    const measure = simulated(DAY);
    const t = mount({ measure, designHeightPx: DAY.boxPx });
    const NOW0 = day('13:44');
    const board = departures(NOW0 + 15_000);
    // R1: the three departures are one 96 px row, so the list stands at the edge with one more timed row than the
    // observer's: six wall rows, the budget says 80 px a row; the line, four rows at 80 and the 84 px heritage row are
    // 500 px, over the box. The fitter would drop the event (the latest timed row) instead of giving the rows back
    // their minimum height; at 64 px they are 436.
    const event = row({ id: 'event:koncert', kind: 'event', atMs: day('19:30'), title: 'Koncert', source: 'dogadanja' });
    const [amruseva, gunduliceva, solar, zakladni] = timed();
    t.update([...board.slice(0, 3), amruseva!, gunduliceva!, solar!, event, zakladni!], 2200, NOW0);
    expect(ids()).toEqual(['departures', 'closure:amruseva', 'closure:gunduliceva', 'solar:sunset:2026-09-24', 'event:koncert', 'always:heritage:zakladni']);
    expect(cellIds()).toEqual(['dep:1', 'dep:2', 'dep:3']);
    expect(section().style.getPropertyValue('--k-nearby-row')).toBe('64px');
    expect(section().dataset.skippedFit).toBe('0');
    expect(section().dataset.fitOverflow).toBe('0');
    expect(measure.sum(host.querySelector('ol')!)).toBeLessThanOrEqual(DAY.boxPx);
  });

  it('spends two records on a departure turnover that passes through six candidates, and the sunset row keeps its node (readings 180 to 182, 266 to 268)', () => {
    const measure = simulated(DAY);
    const t = mount({ measure, designHeightPx: DAY.boxPx });
    const NOW0 = day('13:44');
    const board = departures(NOW0 + 15_000);
    /** The board as the wall holds it: a departure leaves when its grace ends; the fourth trip lands with the next poll. */
    const rows = (now: number, fourthLanded: boolean): TimelineRow[] =>
      [...board.filter((d) => d.atMs! >= now - 60_000 && (fourthLanded || d !== board[3])).slice(0, 3), ...timed()];
    t.update(rows(NOW0, false), 2200, NOW0);
    const solar = byId('solar:sunset:2026-09-24');
    const w = structure();
    // The line, its three cells and the four timed rows.
    expect(CALM_MOTION_START_IN_PAGE(CALM_MOTION_SPEC)).toBe(8);
    // The first departure leaves at 13:45:16 (its grace over); for a poll's few seconds the line has two cells (R1: the
    // list keeps its five rows, so no row is at stake); then the fourth enters as the third cell.
    for (let s = 1; s <= 80; s++) t.update(rows(NOW0 + s * 1000, false), 2200, NOW0 + s * 1000);
    expect(ids()).toEqual(['departures', 'closure:amruseva', 'closure:gunduliceva', 'solar:sunset:2026-09-24', 'always:heritage:zakladni']);
    expect(cellIds()).toEqual(['dep:2', 'dep:3']);
    for (let s = 81; s <= 90; s++) t.update(rows(NOW0 + s * 1000, true), 2200, NOW0 + s * 1000);
    expect(cellIds()).toEqual(['dep:2', 'dep:3', 'dep:4']);
    const reading = CALM_MOTION_READ_IN_PAGE(CALM_MOTION_SPEC);
    const records = w.records();
    w.stop();
    expect(records, JSON.stringify(records)).toEqual([{ added: [], removed: ['span[dep:1]'] }, { added: ['span[dep:4]'], removed: [] }]);
    expect(reading.turnovers).toBe(1);
    expect(reading.churn).toBe(0);
    expect(reading.rebuilt).toEqual([]);
    expect(byId('solar:sunset:2026-09-24')).toBe(solar);
    expect(calmChurnFailures(reading)).toEqual([]);
  });

  it('excuses any row entering or leaving as a turnover (the story row alternating, the sunset row entering) and still reads a row that leaves and returns as churn and re-created (reading 70)', () => {
    const measure = simulated(WALL_1920);
    const t = mount({ measure });
    const NOW0 = day('13:39');
    const board = departures(NOW0 + 60_000).slice(0, 3);
    const story = row({ id: 'always:story:721503305', kind: 'always', atMs: null, always: true, title: 'Jelačićev trg', sub: 'hrvatski ban', source: 'streets' });
    const [amruseva, gunduliceva, solar, zakladni] = timed();
    t.update([...board, amruseva!, gunduliceva!, story], 2200, NOW0);
    // The line, its three cells, two closures and the story row.
    expect(CALM_MOTION_START_IN_PAGE(CALM_MOTION_SPEC)).toBe(7);
    // 13:40:01: the twenty-minute alternation brings the heritage row for the story, and the sunset row enters.
    t.update([...board, amruseva!, gunduliceva!, solar!, zakladni!], 2200, NOW0 + 61_000);
    let reading = CALM_MOTION_READ_IN_PAGE(CALM_MOTION_SPEC);
    expect(reading.mutations).toBe(3);
    expect(reading.left).toEqual(['always|always:story:721503305']);
    expect(reading.entered).toEqual(['solar|solar:sunset:2026-09-24', 'always|always:heritage:zakladni']);
    expect(reading.turnovers).toBe(2);
    expect(reading.churn).toBe(0);
    expect(calmChurnFailures(reading)).toEqual([]);
    // A row that leaves and comes back inside the minute is churn, and a re-created row, whatever entered or left.
    expect(CALM_MOTION_START_IN_PAGE(CALM_MOTION_SPEC)).toBe(8);
    t.update([...board, amruseva!, gunduliceva!, zakladni!], 2200, NOW0 + 62_000);
    t.update([...board, amruseva!, gunduliceva!, solar!, zakladni!], 2200, NOW0 + 63_000);
    reading = CALM_MOTION_READ_IN_PAGE(CALM_MOTION_SPEC);
    expect(reading.turnovers).toBe(0);
    expect(reading.churn).toBe(2);
    expect(reading.rebuilt).toEqual(['solar|solar:sunset:2026-09-24']);
    // Two records are inside the churn budget; the re-created row fails the minute on its own.
    expect(calmChurnFailures(reading)).toEqual([expect.stringContaining('re-created: solar|solar:sunset:2026-09-24')]);
  });
});

describe('calm motion credited per reading pair (D5.20 observer, readings 90 to 120)', () => {
  const li = (id: string): HTMLElement => {
    const el = document.createElement('li');
    el.className = 'nearby-row';
    el.dataset.id = id;
    el.dataset.kind = 'departure';
    el.textContent = id;
    return el;
  };
  it('three in-slot replacements inside one minute are three turnovers and no churn; a staying row still keeps its node', () => {
    document.body.innerHTML = '<section data-testid="nearby"><ol></ol></section>';
    const list = document.querySelector('ol')!;
    const first = li('6_12990');
    list.append(first, li('6_13004'), li('11_13100'));
    expect(CALM_MOTION_START_IN_PAGE(CALM_MOTION_SPEC)).toBe(3);
    // The second departure slot: 6_13004 → 6_13037 → 12_12084 → 14_12602, one reading apart each (an add and a remove).
    for (const [out, next] of [['6_13004', '6_13037'], ['6_13037', '12_12084'], ['12_12084', '14_12602']] as const) {
      const old = list.querySelector<HTMLElement>(`[data-id="${out}"]`)!;
      list.insertBefore(li(next), old);
      old.remove();
      CALM_MOTION_MARK_IN_PAGE(CALM_MOTION_SPEC);
    }
    const reading = CALM_MOTION_READ_IN_PAGE(CALM_MOTION_SPEC);
    expect(reading).toMatchObject({ mutations: 6, turnovers: 3, churn: 0, kept: 2, rebuilt: [] });
    expect(calmChurnFailures(reading)).toEqual([]);
    expect(list.firstElementChild).toBe(first);
  });

  it('a move and a staying row re-created between readings stay churn, and the re-created row fails the minute', () => {
    document.body.innerHTML = '<section data-testid="nearby"><ol></ol></section>';
    const list = document.querySelector('ol')!;
    list.append(li('a'), li('b'), li('c'));
    CALM_MOTION_START_IN_PAGE(CALM_MOTION_SPEC);
    list.append(list.querySelector('[data-id="a"]')!); // a move: remove + add of a staying row
    CALM_MOTION_MARK_IN_PAGE(CALM_MOTION_SPEC);
    list.querySelector('[data-id="b"]')!.replaceWith(li('b')); // re-created
    CALM_MOTION_MARK_IN_PAGE(CALM_MOTION_SPEC);
    const reading = CALM_MOTION_READ_IN_PAGE(CALM_MOTION_SPEC);
    expect(reading).toMatchObject({ turnovers: 0, rebuilt: ['departure|b'] });
    expect(reading.churn).toBe(reading.mutations);
    expect(reading.churn).toBeGreaterThan(2);
    expect(calmChurnFailures(reading)).toEqual([expect.stringContaining('structural mutations under the timeline beyond 0 row turnover(s)'), expect.stringContaining('re-created: departure|b')]);
  });
});

describe('a list at the edge of its box (D5.16 and D5.19 production observers): the row of the lowest value yields (the value order, R0), and a dropped row returns only after a minute of room', () => {
  /** The 1920 x 1080 list of that afternoon: 483 px, the heritage row with an address line (84 px); a bus with a long destination wraps its title to two lines (96 px). */
  const DAY: Layout = { boxPx: 483, titleChars: 17, subChars: 26 };
  const day = (hhmm: string): number => at(`2026-09-24T${hhmm}:00+02:00`);
  const timed = (): TimelineRow[] => [
    row({ id: 'closure:amruseva', kind: 'closure', atMs: day('16:00'), title: 'Amruševa', source: 'prometnice' }),
    row({ id: 'closure:gunduliceva', kind: 'closure', atMs: day('18:00'), title: 'Gundulićeva', source: 'prometnice' }),
    row({ id: 'solar:sunset:2026-09-24', kind: 'solar', atMs: day('18:51'), title: 'Zalazak sunca', source: 'solar' }),
    row({ id: 'always:heritage:zakladni', kind: 'always', atMs: null, always: true, title: 'Zakladni blok', sub: 'Gajeva 2,2a,2b,2c', source: 'heritage' }),
  ];
  const NOW0 = day('15:14');
  const tram = (n: number): TimelineRow => dep(n, { atMs: NOW0 + n * 30_000, title: 'Dubrava', arrival: { routeId: '12', routeName: '12' } });
  const bus = (n: number): TimelineRow => dep(n, { atMs: NOW0 + n * 30_000, title: 'Gornji Tuškanac okretište', arrival: { routeId: '150', routeName: '150' } });
  function structure(): { records(): { added: string[]; removed: string[] }[]; stop(): void } {
    const observer = new MutationObserver(() => undefined);
    observer.observe(section(), { subtree: true, childList: true });
    const keyed = (nodes: NodeList): string[] => [...nodes].filter((n): n is Element => n.nodeType === 1).map((n) => `${n.tagName.toLowerCase()}[${n.getAttribute('data-key') ?? ''}]`);
    return {
      records: () => observer.takeRecords().filter((r) => r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1))
        .map((r) => ({ added: keyed(r.addedNodes), removed: keyed(r.removedNodes) })),
      stop: () => observer.disconnect(),
    };
  }

  it('keeps the third departure and every row, when a bus with a long destination takes the third cell: the line keeps its height, the sunset row keeps its node, zero records for the closure rows (R1)', () => {
    const measure = simulated(DAY);
    const t = mount({ measure, designHeightPx: DAY.boxPx });
    t.update([tram(1), tram(2), tram(3), ...timed()], 2200, NOW0);
    expect(ids()).toEqual(['departures', 'closure:amruseva', 'closure:gunduliceva', 'solar:sunset:2026-09-24', 'always:heritage:zakladni']);
    expect(cellIds()).toEqual(['dep:1', 'dep:2', 'dep:3']);
    const nodes = new Map(items().map((li) => [li.dataset.id, li]));
    const w = structure();
    // The third slot alternates between a bus (a different trip) and a tram every five seconds for a minute and a half.
    // Before R1 the bus's three title lines left no room for the sunset at 18:51 (decision 67). On the line the bus's
    // destination does not fit its cell's line, so cells 2 and 3 print the line and the time only, and the line is as
    // tall with the bus as with the tram: the sunset keeps its row and its node.
    for (let s = 1; s <= 90; s++) {
      const third = Math.floor(s / 5) % 2 === 0 ? bus(5) : tram(3);
      t.update([tram(1), tram(2), third, ...timed()], 2200, NOW0 + s * 1000);
      for (const id of ['departures', 'closure:amruseva', 'closure:gunduliceva', 'solar:sunset:2026-09-24', 'always:heritage:zakladni']) expect(byId(id), `${s} s ${id}`).toBe(nodes.get(id));
      expect(cellIds(), `${s} s`).toEqual(['dep:1', 'dep:2', third.id]);
      expect(cells().map((c) => c.dataset.headsign ?? ''), `${s} s`).toEqual(third.id === 'dep:3' ? ['', '', ''] : ['', '0', '0']);
      expect(section().dataset.fitOverflow, `${s} s`).toBe('0');
    }
    const records = w.records();
    w.stop();
    // Every record is the third cell's trip entering or leaving.
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => [...r.added, ...r.removed].every((k) => k === 'span[dep:3]' || k === 'span[dep:5]')), JSON.stringify(records)).toBe(true);
    expect(records.some((r) => [...r.added, ...r.removed].some((k) => k.includes('closure') || k.includes('always') || k.includes('solar')))).toBe(false);
  });

  it('holds a dropped discretionary row out until the list has fitted with it for a minute, and never holds a reserved row or a departure out', () => {
    // R1: on the totem the line is the badge and the time over the destination: 84 px with a destination, 64 without
    // (a departure whose line names none of its own). A 350 px box holds the five rows with the bare departure
    // (64 + 3 x 64 + 84 = 340 px) but not with the named one (360): the sunset row, the latest timed row, must go.
    const SMALL: Layout = { boxPx: 350, titleChars: 17, subChars: 26, ...LINE_PORTRAIT };
    const bare = (n: number): TimelineRow => dep(n, { atMs: NOW0 + n * 30_000, title: '150', arrival: { routeId: '150', routeName: '150' } });
    const measure = simulated(SMALL);
    const t = mount({ measure, designHeightPx: SMALL.boxPx });
    t.update([bare(1), ...timed()], 2200, NOW0);
    expect(ids()).toEqual(['departures', 'closure:amruseva', 'closure:gunduliceva', 'solar:sunset:2026-09-24', 'always:heritage:zakladni']);
    const w = structure();
    // The one departure alternates between the named tram and the bare bus: the sunset row is dropped at once and stays out.
    let s = 1;
    for (; s <= 90; s++) {
      const only = Math.floor(s / 5) % 2 === 0 ? tram(5) : bare(1);
      t.update([only, ...timed()], 2200, NOW0 + s * 1000);
      expect(ids(), `${s} s`).not.toContain('solar:sunset:2026-09-24');
      expect(ids(), `${s} s`).toContain('closure:gunduliceva');
      expect(cellIds(), `${s} s`).toEqual([only.id]);
      expect(section().dataset.fitOverflow, `${s} s`).toBe('0');
      expect(section().dataset.skippedFit, `${s} s`).toBe('1');
    }
    // The bare bus stays: the sunset row is back after FIT_RESTORE_HOLD_MS of steady room, not before.
    const steadyFrom = s;
    for (; s <= steadyFrom + 70; s++) {
      t.update([bare(1), ...timed()], 2200, NOW0 + s * 1000);
      expect(ids().includes('solar:sunset:2026-09-24'), `${s - steadyFrom} s of room`).toBe((s - steadyFrom) * 1000 >= FIT_RESTORE_HOLD_MS);
    }
    const records = w.records();
    w.stop();
    const solarRecords = records.filter((r) => [...r.added, ...r.removed].some((k) => k.includes('solar:sunset')));
    expect(solarRecords).toEqual([{ added: [], removed: ['li[solar:sunset:2026-09-24]'] }, { added: ['li[solar:sunset:2026-09-24]'], removed: [] }]);
    expect(FIT_RESTORE_HOLD_MS).toBe(60_000);
  });

  // D5.25 production observer (25 Sep, 16:41:16 to 16:41:19): the second closure row (Amruševa, "do 26. 9.") left
  // the list and came back re-created three seconds later while the rows, their labels and the feed's closures were
  // the same in every reading: the list's box was smaller meanwhile (the reconnect pill takes the list's height). The
  // round-4 fixer passes held the fitted rows against a smaller box, for five seconds and then for two paints, and
  // both painted the rows the smaller box could not hold cut for the hold's length at every shrink that stays
  // (readable-city's outage reading; release smoke run 5's resize probe, a composition switch shrinking the list
  // from 751 to 462 px while the window grows). Decision 66: no hold. A box that changes refits at once on the
  // ResizeObserver path, after layout and before paint, so no cut row is ever painted, a shrink and a grow alike;
  // the wobble's row is re-created on its return, the residual handed to the pill's layout (round 5).
  it('refits at once on the ResizeObserver path, a shrink and a grow alike, never a cut row, and puts the rows back when the box returns', () => {
    const observers: ResizeObserverCallback[] = [];
    vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { observers.push(callback); } observe(): void {} unobserve(): void {} disconnect(): void {} });
    const resized = (): void => { for (const observe of observers) observe([], {} as ResizeObserver); };
    const layout: Layout = { boxPx: 462, titleChars: 24, subChars: 40 };
    const measure = simulated(layout);
    const t = mount({ measure, designHeightPx: layout.boxPx });
    expect(observers).toHaveLength(1);
    const T = day('16:40');
    const rows = (): TimelineRow[] => [
      dep(13, { atMs: T, live: false, title: 'Kvat. trg', source: 'zet-gtfs', arrival: { routeId: '13', routeName: '13' } }),
      dep(11, { atMs: T + 30_000, title: 'Črnomerec', arrival: { routeId: '11', routeName: '11' } }),
      row({ id: 'closure:gunduliceva', kind: 'closure', atMs: day('18:00'), title: 'Gundulićeva', source: 'prometnice' }),
      row({ id: 'solar:sunset:2026-09-24', kind: 'solar', atMs: day('18:49'), title: 'Zalazak sunca', source: 'solar' }),
      row({ id: 'closure:amruseva', kind: 'closure', atMs: at('2026-09-26T20:00:00+02:00'), title: 'Amruševa', source: 'prometnice' }),
      always({ title: 'Trg bana J. Jelačića', sub: 'hrvatski ban, 1848-1859; 1801-1859' }),
    ];
    // R1: the two departures are the line's cells, one row. The value order (R0): the sunset 129 minutes away
    // (20 × 0.5 = 10) goes before a closure under way (60).
    const all = ['departures', 'closure:gunduliceva', 'solar:sunset:2026-09-24', 'closure:amruseva', 'always:story:trg'];
    const kept = ['departures', 'closure:gunduliceva', 'closure:amruseva', 'always:story:trg'];
    t.update(rows(), 2200, T);
    expect(ids()).toEqual(all);
    expect(cellIds()).toEqual(['dep:13', 'dep:11']);
    const nodes = new Map(items().map((li) => [li.dataset.id!, li]));
    const w = structure();
    // The box is 319 px (four rows of 64 px at most; R1: the line is one of five rows, where the six rows before it
    // were cut at 380) and the observer fires: the last discretionary row goes at once, in the observer's own
    // callback, nothing overflows the box, every other row keeps its node.
    layout.boxPx = 319;
    resized();
    expect(ids()).toEqual(kept);
    expect(measure.sum(host.querySelector('ol')!)).toBeLessThanOrEqual(319);
    expect(section().dataset.fitOverflow).toBe('0');
    for (const id of kept) expect(byId(id), id).toBe(nodes.get(id));
    // The box back: the row returns at once (re-created: the residual), the others on their nodes.
    layout.boxPx = 462;
    resized();
    expect(ids()).toEqual(all);
    for (const id of kept) expect(byId(id), id).toBe(nodes.get(id));
    expect(w.records()).toEqual([{ added: [], removed: ['li[solar:sunset:2026-09-24]'] }, { added: ['li[solar:sunset:2026-09-24]'], removed: [] }]);
    // A box that grows past the fitted one refits at once too: the rows a taller box holds come back.
    layout.boxPx = 319;
    resized();
    expect(ids()).toEqual(kept);
    layout.boxPx = 600;
    resized();
    expect(ids()).toEqual(all);
    expect(measure.sum(host.querySelector('ol')!)).toBeLessThanOrEqual(600);
    const nodesAt600 = new Map(items().map((li) => [li.dataset.id!, li]));
    // A smaller box that still holds every row (the page settling at boot, a legend line: 600 to 462) is taken at
    // once: the rows' heights follow it (the six rows with the story's two-line row fit at the smallest row), none
    // overflows, and every node stays.
    layout.boxPx = 462;
    resized();
    expect(ids()).toEqual(all);
    expect(section().style.getPropertyValue('--k-nearby-row')).toBe('64px');
    expect(measure.sum(host.querySelector('ol')!)).toBeLessThanOrEqual(462);
    for (const id of all) expect(byId(id), id).toBe(nodesAt600.get(id));
    w.stop();
    vi.unstubAllGlobals();
  });
});

describe('whole words: no ellipsis, content selection, then whole rows', () => {
  it.each(['22:40', '04:30'])('%s keeps the real Trg first-tram and pharmacy rows within the 1920 budget', time => {
    const now = at(`2026-09-${time === '22:40' ? '22' : '23'}T${time}:00+02:00`);
    // Feed 000395's file as cut on 22 September: the committed one follows the current feed and its window.
    const file = JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/lastrun-000395/106_1.json'), 'utf8'));
    const lastRun: LastRunLive = { ...file, status: 'live', fetchedAt: new Date(now).toISOString(), sourceUpdatedAt: file.generatedAt };
    const rows = selectNearby({
      place: { kind: 'tram', stopId: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286 },
      radiusM: 2182, now, locale: 'hr', i18n, lastRun, snapshots: {}, city: emptyCity(), fixes: [],
      boards: [{
        operator: 'zet', stopId: '106_1', stopName: 'Trg bana J. Jelačića', status: 'live', generatedAt: new Date(now).toISOString(),
        departures: [1, 2, 3].map(n => ({
          operator: 'zet', tripId: `t${n}`, routeId: '6', routeName: '6', headsign: 'Črnomerec', at: new Date(now + n * MIN).toISOString(),
        })),
      }],
    });
    const measure = simulated(WALL_1920);
    const t = mount({ measure });
    t.update(rows, 2182, now);
    // R1: the departures are the line's cells.
    expect(shownDepartures().length).toBeGreaterThanOrEqual(1);
    expect(shownDepartures().length).toBeLessThanOrEqual(3);
    expect(items().filter(li => li.dataset.kind === 'first')).toHaveLength(1);
    expect(items().filter(li => li.dataset.kind === 'pharmacy')).toHaveLength(1);
    expect(items().filter(li => li.dataset.kind === 'last')).toHaveLength(time === '22:40' ? 1 : 0);
    expect(text(host.querySelector('[data-kind=first] .nearby-sub'))).toMatch(time === '22:40' ? /^12 04:13/ : /^1 04:33/);
    expect(section().dataset.fitOverflow).toBe('0');
    expect(measure.sum(host.querySelector('ol')!)).toBeLessThanOrEqual(WALL_1920.boxPx);
  });
  it.each(['departure', 'always', 'event'] as const)('keeps an oversized %s when it is a promise (a departure, the uvijek row), reports the box, and restores a discretionary row when room returns', kind => {
    let room = 80;
    const measure: TimelineMeasure = {
      box: list => ({ height: room, width: 400, overflow: list.children.length * 240 > room }),
      lines: () => 5,
    };
    const t = mount({ designHeightPx: 80, measure });
    const candidate = row({ id: 'oversized', kind, title: 'Črnomerec', always: kind === 'always' });
    t.update([candidate], 2000, NOW);
    // The departures line (R1: the departure is its one cell) and the timeless row are promises; an event yields to the box.
    const reserved = kind !== 'event';
    const shownId = kind === 'departure' ? 'departures' : 'oversized';
    expect(ids()).toEqual(reserved ? [shownId] : []);
    if (kind === 'departure') expect(cellIds()).toEqual(['oversized']);
    expect(t.shown()).toBe(reserved ? 1 : 0);
    expect(section().dataset.skippedFit).toBe(reserved ? '0' : '1');
    expect(section().dataset.fitOverflow).toBe(reserved ? '1' : '0');
    expect(measure.box(host.querySelector('ol')!).overflow).toBe(reserved);
    t.update([candidate], 2000, NOW + 1000);
    expect(ids()).toEqual(reserved ? [shownId] : []);
    room = 300;
    t.update([candidate], 2000, NOW + 2000);
    // Room returns: a promise was never out; a dropped discretionary row waits FIT_RESTORE_HOLD_MS of steady room.
    expect(ids()).toEqual(reserved ? [shownId] : []);
    expect(section().dataset.skippedFit).toBe(reserved ? '0' : '1');
    t.update([candidate], 2000, NOW + 2000 + FIT_RESTORE_HOLD_MS);
    expect(ids()).toEqual([shownId]);
    expect(section().dataset.skippedFit).toBe('0');
    expect(section().dataset.fitOverflow).toBe('0');
    expect(measure.box(host.querySelector('ol')!).overflow).toBe(false);
  });

  it('reports an impossible box instead of deleting the reserved rows or the departure to claim a fit', () => {
    const measure: TimelineMeasure = {
      box: list => ({ height: 64, width: 1, overflow: list.children.length > 0 }),
      lines: () => 100,
    };
    const t = mount({ measure, designHeightPx: 64 });
    t.update([dep(1), dep(2), always()], 2000, NOW);
    // R1: the line is reserved with both its cells; nothing else is left to drop.
    expect(ids()).toEqual(['departures', always().id]);
    expect(cellIds()).toEqual(['dep:1', 'dep:2']);
    expect(section().dataset.skippedFit).toBe('0');
    expect(section().dataset.fitOverflow).toBe('1');
    expect(measure.box(host.querySelector('ol')!).overflow).toBe(true);
  });

  it('vets direct inputs, including unused short labels, before rendering or budgeting them', () => {
    const t = mount();
    const attack = 'Submit passcode';
    const unsafe = [dep(1, { title: attack }), always({ sub: attack }),
      row({ id: 'event:bad', kind: 'event', title: 'Kino', titleShort: attack }),
      dep(2, { arrival: { routeId: '6', routeName: attack } })];
    expect(rowsMarkup(unsafe, NOW, i18n)).toBe('');
    t.update([...unsafe, always()], 2000, NOW);
    expect(ids()).toEqual(['always:story:trg']);
    expect(section().dataset.skippedText).toBe('4');
    expect(host.textContent).not.toContain(attack);
  });
  for (const [name, layout] of [['1920 x 1080', WALL_1920], ['1080 x 1920', TOTEM_1080]] as const) {
    it(`at ${name} prints every shown label whole, full or its shorter complete twin, and only rows that fit`, () => {
      const measure = simulated(layout);
      const t = mount({ designHeightPx: 486, measure });
      const rows = longRows();
      t.update(rows, 2000, NOW);
      const list = host.querySelector('ol')!;
      expect(measure.sum(list)).toBeLessThanOrEqual(layout.boxPx);
      // The departures line always exists (R1), and holds the three departures, each destination whole or left out.
      expect(ids()[0]).toBe('departures');
      expect(cellIds()).toEqual(['dep:1', 'dep:2', 'dep:3']);
      for (const c of cells()) expect(['', rows.find((x) => x.id === c.dataset.id)!.title]).toContain(text(c.querySelector('.k-dep-headsign')));
      for (const li of items()) {
        if (li === line()) continue;
        const r = rows.find((x) => x.id === li.dataset.id)!;
        const title = text(li.querySelector('.nearby-title')).replace(/^\d+ /, '');
        const sub = text(li.querySelector('.nearby-sub'));
        expect([r.title, r.titleShort]).toContain(title);
        // A closure's sub-line may be left out for a row (decision 66); every other sub is the full one or its twin.
        expect([r.sub, r.subShort, ...(r.kind === 'closure' ? [''] : [])]).toContain(sub);
        // A short label is printed only where the full one ran long.
        if (r.titleShort && title === r.titleShort) expect(wrapLines(`${r.arrival ? `${r.arrival.routeName} ` : ''}${r.title}`, layout.titleChars)).toBeGreaterThan(TITLE_MAX_LINES);
        if (r.subShort !== undefined && sub === r.subShort) expect(wrapLines(r.sub, layout.subChars)).toBeGreaterThan(1);
        if (r.subShort !== undefined && sub === r.sub && wrapLines(r.sub, layout.subChars) > SUB_MAX_LINES) throw new Error(`${r.id}: a sub over ${SUB_MAX_LINES} lines kept beside its short twin`);
        expect(text(li)).not.toMatch(/…|\.\.\./);
      }
      // The rows kept are the earliest in time and the order is the selection's.
      const order = rows.map((r) => r.id).filter((id) => expanded().includes(id));
      expect(expanded()).toEqual(order);
      // A steady wall does not refit: the next update changes no structure.
      const w = watch();
      t.update(rows, 2000, NOW + 20_000);
      expect(w.structural()).toHaveLength(0);
      w.stop();
    });
  }

  it('at 1920 x 1080 shortens the long labels and keeps the line of three beside the reserved last-tram row', () => {
    const measure = simulated(WALL_1920);
    const t = mount({ designHeightPx: 486, measure });
    t.update(longRows(), 2000, NOW);
    // U0 step 7: the event two hours away yields, and the closure's sub-line before it (decision 66). R1: the line
    // holds the three departures in one row; the room the second and third took goes to the sunset.
    expect(ids()).toEqual(['departures', 'closure:vukovarska', 'solar:sunset:2026-09-22', 'last:2026-09-22', 'always:heritage:stedionica']);
    expect(cellIds()).toEqual(['dep:1', 'dep:2', 'dep:3']);
    // "Zapadni kolodvor" and "Savski most" do not fit a cell's destination line: cells 2 and 3 print the line and the time.
    expect(cells().map((c) => text(c.querySelector('.k-dep-headsign')))).toEqual(['Črnomerec', '', '']);
    // "Ulica grada Vukovara" gives way to its complete short twin, and its sub-line to the second departure.
    expect(text(byId('closure:vukovarska').querySelector('.nearby-title'))).toBe('Vukovarska');
    expect(text(byId('closure:vukovarska').querySelector('.nearby-sub'))).toBe('');
    // "Zgrada nekadašnje Gradske štedionice" takes three title lines there; "Gradska štedionica" wraps onto two, whole.
    expect(text(byId('always:heritage:stedionica').querySelector('.nearby-title'))).toBe('Gradska štedionica');
    expect(text(byId('last:2026-09-22').querySelector('.nearby-sub'))).toBe(longRows()[6]!.subShort);
    expect(measure.sum(host.querySelector('ol')!)).toBeLessThanOrEqual(WALL_1920.boxPx);
  });

  it('at 1080 x 1920 has the width for the full labels and keeps more rows', () => {
    const measure = simulated(TOTEM_1080);
    const t = mount({ designHeightPx: 498, measure });
    t.update(longRows(), 2000, NOW);
    // R1: the line holds the three departures, their destinations under them (84 px), so the event two hours away
    // keeps its row too (U0 step 7 let it yield before the third departure row).
    expect(ids()).toEqual(['departures', 'closure:vukovarska', 'event:gavella', 'solar:sunset:2026-09-22', 'last:2026-09-22', 'always:heritage:stedionica']);
    expect(cells().map((c) => text(c.querySelector('.k-dep-headsign')))).toEqual(['Črnomerec', 'Zapadni kolodvor', 'Savski most']);
    expect(text(byId('last:2026-09-22').querySelector('.nearby-title'))).toBe('Zadnji tramvaji');
    expect(text(byId('closure:vukovarska').querySelector('.nearby-title'))).toBe('Ulica grada Vukovara');
    expect(text(byId('always:heritage:stedionica').querySelector('.nearby-title'))).toBe('Gradska štedionica');
    expect(measure.sum(host.querySelector('ol')!)).toBeLessThanOrEqual(TOTEM_1080.boxPx);
  });

  // The lane W wall check of 22 September at 1920 x 1080 (review.local/companion/run/logs/w-e2e/wall-visual.json):
  // the line counts Chromium measured, a 40 px title line box of 44 px (48.4 px in dark, 44 px type) and a 28 px sub
  // line of 32.2 px. The source gives the long event no shorter name, and the words before its colon are not one
  // (review W, P2): the whole title wraps onto three lines. Since U0 step 7 the wall stops an event title at two lines
  // (its one line-clamp); since R0 the rows go by value, so the three departures due within 30 minutes stay.
  describe('the long event title of the 22 September wall check', () => {
    const LONG = 'Večer u Kvaterniku: razgovor o gradu i kulturnoj baštini';
    const LINES: Record<'light' | 'dark', Record<string, number>> = {
      light: {
        [LONG]: 3, 'Dom kulture Kvaternik': 1, 'Gradsko dramsko kazalište Gavella': 1, 'Kvaternikov trg': 1, 'Trg bana Josipa Jelačića': 1,
        'Trg je nazvan po Eugenu Kvaterniku, hrvatskom političaru iz 19. stoljeća.': 2,
        'Središnji zagrebački trg nosi ime bana Josipa Jelačića od 1848. godine.': 3,
      },
      dark: {
        [LONG]: 3, 'Dom kulture Kvaternik': 1, 'Gradsko dramsko kazalište Gavella': 2, 'Kvaternikov trg': 1, 'Trg bana Josipa Jelačića': 2,
        'Trg je nazvan po Eugenu Kvaterniku, hrvatskom političaru iz 19. stoljeća.': 3,
        'Središnji zagrebački trg nosi ime bana Josipa Jelačića od 1848. godine.': 3,
      },
    };
    const LINE_PX = { light: { title: 44, sub: 32.2 }, dark: { title: 48.4, sub: 32.2 } };
    const BOX_PX = 486;
    function measured(theme: 'light' | 'dark'): TimelineMeasure & { sum(list: Element): number } {
      const lines = (el: Element): number => {
        const words = (el.textContent ?? '').replace(/^\d+ /, '');
        return words ? clampedEvent(el, LINES[theme][words] ?? 1) : 0;
      };
      const rowPx = (): number => Number.parseFloat(section().style.getPropertyValue('--k-nearby-row')) || 64;
      // R1: the departures line on the landscape wall is two read-tier lines, the badge and destination over the time
      // (each destination here fits its cell's line).
      const rowHeight = (li: Element): number => Math.max(rowPx(), (li as HTMLElement).dataset.kind === 'departures' ? 2 * LINE_PX[theme].title + 8
        : LINE_PX[theme].title * lines(li.querySelector('.nearby-title')!) + LINE_PX[theme].sub * lines(li.querySelector('.nearby-sub')!) + 8);
      const sum = (list: Element): number => [...list.children].reduce((acc, li) => acc + rowHeight(li), 0);
      const cell = (el: Element): boolean => el.classList.contains('k-dep-cell') || el.classList.contains('k-dep-headsign');
      return { box: (el) => ({ height: BOX_PX, width: 472, overflow: !cell(el) && sum(el) > BOX_PX }), lines, sum };
    }
    const T = at('2026-09-22T17:30:00Z'); // Tue 19:30
    function wall(variant: 'kvaternik' | 'trg'): TimelineRow[] {
      const kv = variant === 'kvaternik';
      const heads = kv ? ['Mihaljevac', 'Prečko', 'Črnomerec'] : ['Dubec', 'Dubrava', 'Žitnjak'];
      // The story's shorter name is the stop's own ("Trg bana J. Jelačića"), a name the source gives.
      const story = kv
        ? { title: 'Kvaternikov trg', sub: 'Trg je nazvan po Eugenu Kvaterniku, hrvatskom političaru iz 19. stoljeća.' }
        : { title: 'Trg bana Josipa Jelačića', titleShort: 'Trg bana J. Jelačića', sub: 'Središnji zagrebački trg nosi ime bana Josipa Jelačića od 1848. godine.' };
      return [
        ...heads.map((title, i) => dep(i + 1, { title, atMs: T + (6 + 5 * i) * MIN, live: false, arrival: { routeId: String(5 + i), routeName: String(5 + i) } })),
        row({ id: 'event:vis', kind: 'event', atMs: at('2026-09-22T18:00:00Z'), title: LONG, sub: kv ? 'Dom kulture Kvaternik' : 'Gradsko dramsko kazalište Gavella', source: 'dogadanja' }),
        row({ id: 'closure:vlaska', kind: 'closure', atMs: at('2026-09-22T20:00:00Z'), title: 'Vlaška', source: 'prometnice' }),
        row({ id: 'last:2026-09-22', kind: 'last', atMs: at('2026-09-22T21:31:00Z'), title: 'Zadnji tramvaji', sub: '1 23:31 · 12 23:45', source: 'zet-gtfs' }),
        row({ id: 'solar:sunrise:2026-09-23', kind: 'solar', atMs: at('2026-09-23T04:43:00Z'), title: 'Izlazak sunca', source: 'solar' }),
        always({ id: `always:story:${variant}`, ...story }),
      ];
    }
    // What stays beside the reserved rows (measured on the DR1 tree, R0 and R1 merged). R1: the line holds the three
    // departures in two read-tier lines (96 px, 105 in dark). R0's value order: tomorrow's sunrise goes first (the
    // later-day step), then of the event at 20:00 (60) and the closure under way (60), a tie, the later row (the
    // closure); where the event's two lines fit beside the line it keeps its row. At Trg in dark the event's sub takes
    // a second line and does not fit: it goes, and the closure and the sunrise return in the room it left (the U0
    // step 7 retry). Before DR1 (R1 alone): the closure and the sunrise in every case.
    const EVENT = ['departures', 'event:vis', 'last:2026-09-22'] as const;
    const SHOWN = {
      kvaternik: { light: EVENT, dark: EVENT },
      trg: { light: EVENT, dark: ['departures', 'closure:vlaska', 'last:2026-09-22', 'solar:sunrise:2026-09-23'] },
    } as const;
    for (const variant of ['kvaternik', 'trg'] as const) for (const theme of ['light', 'dark'] as const) {
      const kept = SHOWN[variant][theme];
      it(`${variant}, ${theme}: the reserved rows and the line of three stay beside ${kept.filter((id) => id.startsWith('event') || id.startsWith('closure')).join(' and ')}, the event title at two lines at most`, () => {
        const measure = measured(theme);
        const t = mount({ designHeightPx: BOX_PX, measure });
        t.update(wall(variant), 2000, T);
        expect(ids()).toEqual([...kept, `always:story:${variant}`]);
        expect(cellIds()).toEqual(['dep:1', 'dep:2', 'dep:3']);
        expect(ids().at(-1)).toBe(`always:story:${variant}`);
        if (ids().includes('event:vis')) {
          const title = byId('event:vis').querySelector<HTMLElement>('.nearby-title')!;
          expect(text(title)).toBe(LONG);
          expect(measure.lines(title)).toBe(EVENT_TITLE_MAX_LINES);
          expect(text(byId('event:vis').querySelector('.nearby-sub'))).toBe(variant === 'kvaternik' ? 'Dom kulture Kvaternik' : 'Gradsko dramsko kazalište Gavella');
        }
        // The story keeps its sentence whole; at Trg in dark its name gives way to the stop's shorter one.
        expect(text(byId(`always:story:${variant}`).querySelector('.nearby-title'))).toBe(variant === 'trg' && theme === 'dark' ? 'Trg bana J. Jelačića' : variant === 'trg' ? 'Trg bana Josipa Jelačića' : 'Kvaternikov trg');
        expect(measure.sum(host.querySelector('ol')!)).toBeLessThanOrEqual(BOX_PX);
        for (const li of items()) expect(text(li)).not.toMatch(/…|\.\.\./);
        t.destroy();
        handle = null;
      });
    }
  });

  it('fits again when the box shrinks, and brings rows back when it grows', () => {
    const layout: Layout = { ...TOTEM_1080 };
    const measure = simulated(layout);
    const t = mount({ designHeightPx: 498, measure });
    t.update(longRows(), 2000, NOW);
    const roomy = t.shown();
    layout.boxPx = 300;
    // A smaller box is taken at once (decision 66: no hold, never a cut row).
    t.update(longRows(), 2000, NOW + 20_000);
    expect(t.shown()).toBeLessThan(roomy);
    expect(measure.sum(host.querySelector('ol')!)).toBeLessThanOrEqual(300);
    layout.boxPx = 498;
    t.update(longRows(), 2000, NOW + 40_000);
    // R1: the rows that went are discretionary (the departures are the line), so they return after the restore hold.
    t.update(longRows(), 2000, NOW + 40_000 + FIT_RESTORE_HOLD_MS);
    expect(t.shown()).toBe(roomy);
  });
});

/** Evaluates a computed font-size such as "calc(max(40px,calc(28px * 1)) * 1)" to px (happy-dom resolves var() but not calc/max). */
function px(value: string): number {
  const js = value.replace(/px/g, '').replace(/calc\(/g, '(').replace(/max\(/g, 'Math.max(').replace(/min\(/g, 'Math.min(');
  if (!/^[\d.\s+\-*/(),]+$/.test(js.replace(/Math\.(max|min)/g, ''))) throw new Error(`not a length: ${value}`);
  return Number(new Function(`return (${js});`)());
}

describe('a closure\u2019s sub-line on the wall (decision 66, release smoke run 5): one line or none, and it goes before a departure does', () => {
  // The feed's summary under every closure (dd09f213, merged as D5.28) wrapped to two lines at 1920 x 1080 (a 116 px
  // row for 66) and the fit took the second and third departures to keep the closures: one departure in all 300
  // readings of the smoke's live minutes, 1 where run 4 had 3 by day. The rows as the simulation draws them: 44 px a
  // title line, 32 a sub line, 8 of padding; 26 characters a sub line at 1920 x 1080, 51 on the totem.
  const closure = (id: string, title: string): TimelineRow => row({ id: `closure:${id}`, kind: 'closure', atMs: at('2026-09-22T16:00:00Z'), title, sub: 'zatvoreno zbog radova, oba smjera', subShort: 'zatvoreno za promet', source: 'prometnice' });
  const rows = (sunsetAt = at('2026-09-22T17:07:00Z')): TimelineRow[] => [
    dep(1, { title: 'Črnomerec', arrival: { routeId: '6', routeName: '6' } }),
    dep(2, { title: 'Savski most', arrival: { routeId: '13', routeName: '13' } }),
    dep(3, { title: 'Dubrava', arrival: { routeId: '11', routeName: '11' } }),
    row({ id: 'solar:sunset:2026-09-22', kind: 'solar', atMs: sunsetAt, title: 'Zalazak sunca', source: 'solar' }),
    closure('gunduliceva', 'Gundulićeva'),
    closure('amruseva', 'Amruševa'),
    always({ title: 'Trg bana Jelačića', sub: 'hrvatski ban' }),
  ];
  const departures = (): number => shownDepartures().length;
  const closureSubs = (): string[] => items().filter((li) => li.dataset.kind === 'closure').map((li) => li.querySelector('.nearby-sub')!.textContent ?? '');
  const fitted = (layout: Layout, sunsetAt?: number): ReturnType<typeof simulated> => {
    const measure = simulated(layout);
    mount({ measure, designHeightPx: layout.boxPx }).update(rows(sunsetAt), 2200, NOW);
    return measure;
  };
  const subLines = (measure: ReturnType<typeof simulated>): number[] => items().filter((li) => li.dataset.kind === 'closure').map((li) => measure.lines(li.querySelector('.nearby-sub')!));

  it('prints the wall\u2019s own words where the summary would wrap (1920 x 1080): three departures, every closure row one line under its title', () => {
    // 600 px holds the rows at one sub line each; with the summary's two lines the two closures are 116.
    const measure = fitted({ boxPx: 600, titleChars: 17, subChars: 26 });
    expect(departures()).toBe(3);
    expect(closureSubs()).toEqual(['zatvoreno za promet', 'zatvoreno za promet']);
    expect(subLines(measure)).toEqual([1, 1]);
    // R1: the line is its two read-tier lines (96 px); every other row the budget's (five rows: 92 px), never grown.
    expect(measure.rowHeight(line()!)).toBe(96);
    const budget = Number.parseFloat(section().style.getPropertyValue('--k-nearby-row'));
    expect(budget).toBe(92);
    for (const li of items()) if (li !== line()) expect(measure.rowHeight(li)).toBeLessThanOrEqual(budget);
    expect(section().dataset.fitOverflow).toBe('0');
  });
  it('prints the summary whole where a line holds it (the totem)', () => {
    const measure = fitted({ boxPx: 700, titleChars: 34, subChars: 51 });
    expect(departures()).toBe(3);
    expect(closureSubs()).toEqual(['zatvoreno zbog radova, oba smjera', 'zatvoreno zbog radova, oba smjera']);
    expect(subLines(measure)).toEqual([1, 1]);
  });
  it('leaves a closure\u2019s sub-line out where even the words would wrap, and never grows the row', () => {
    const measure = fitted({ boxPx: 600, titleChars: 17, subChars: 12 });
    expect(departures()).toBe(3);
    expect(closureSubs()).toEqual(['', '']);
    expect(subLines(measure)).toEqual([0, 0]);
    const budget = Number.parseFloat(section().style.getPropertyValue('--k-nearby-row'));
    for (const li of items()) if (li !== line()) expect(measure.rowHeight(li)).toBeLessThanOrEqual(budget);
  });
  it('gives up the closure sub-lines before a row, and a row only after them', () => {
    // R1: five wall rows, the line (96 px) among them. 380 px: the budget's row is 76, and the rows are 408 px there
    // even without the closures' words; at the smallest row they are 412 with them and 372 without: the sub-lines go,
    // every row stays.
    fitted({ boxPx: 380, titleChars: 17, subChars: 26 });
    expect(departures()).toBe(3);
    expect(ids()).toHaveLength(5);
    expect(closureSubs()).toEqual(['', '']);
    expect(section().dataset.fitOverflow).toBe('0');
  });
  it('drops a row after the sub-lines, in dropCandidate\u2019s order, and gives the closures their sub-lines back in its room', () => {
    // R1: 360 px holds the five wall rows neither with the sub-lines (420 at the budget's 72 px) nor without (396), not
    // even at the smallest row (372): a whole row goes, and the room it leaves holds the two sub-lines again (324 with
    // none, 348 with both): a sub-line yields to a row, never for nothing. The sunset at 19:07 is 82 minutes away
    // (20 × 0.8 = 16), the lowest value (R0), so the sunset goes and the line stays.
    fitted({ boxPx: 360, titleChars: 17, subChars: 26 });
    expect(departures()).toBe(3);
    expect(ids()).toEqual(['departures', 'closure:gunduliceva', 'closure:amruseva', 'always:story:trg']);
    expect(closureSubs()).toEqual(['zatvoreno za promet', 'zatvoreno za promet']);
    expect(section().dataset.fitOverflow).toBe('0');
    // A sunset at 17:55, within 30 minutes (20), still goes before a closure (60): the value order (R0); the line never
    // yields a cell (R1).
    handle?.destroy();
    host.innerHTML = '';
    fitted({ boxPx: 360, titleChars: 17, subChars: 26 }, NOW + 10 * MIN);
    expect(departures()).toBe(3);
    expect(ids()).toEqual(['departures', 'closure:gunduliceva', 'closure:amruseva', 'always:story:trg']);
    expect(closureSubs()).toEqual(['zatvoreno za promet', 'zatvoreno za promet']);
    expect(section().dataset.fitOverflow).toBe('0');
  });
});

describe('the ZET notice row on the wall (upgrade U1): "ZET javlja" for a time, reserved, two title lines, a sub of one line or none', () => {
  // ZET's headline and the start of its description, published three days ago: the row has no moment of its own, so
  // the time cell says whose word it is, and no day word stands under it.
  const notice = (over: Partial<TimelineRow> = {}): TimelineRow => row({
    id: 'notice:zet-promet:10160', kind: 'notice', atMs: NOW - 3 * 24 * 60 * MIN, title: 'Linije 5 i 13 u nedjelju mijenjaju trase',
    sub: 'Zbog radova na pruzi.', source: 'zet-promet', ...over,
  });
  const LONG_SUB = 'U nedjelju, 27. rujna bit će obustavljen tramvajski promet Ulicom grada Vukovara na dijelu od Avenije Marina Držića do Savske ceste, zbog automobilističkog događanja Red Bull Showrun.';
  const rows = (over: Partial<TimelineRow> = {}): TimelineRow[] => [
    dep(1, { title: 'Črnomerec', arrival: { routeId: '6', routeName: '6' } }),
    dep(2, { title: 'Savski most', arrival: { routeId: '13', routeName: '13' } }),
    dep(3, { title: 'Dubrava', arrival: { routeId: '11', routeName: '11' } }),
    notice(over),
    row({ id: 'closure:gunduliceva', kind: 'closure', atMs: at('2026-09-22T16:00:00Z'), title: 'Gundulićeva', sub: 'zatvoreno za promet', source: 'prometnice' }),
    always({ title: 'Trg bana Jelačića', sub: 'hrvatski ban' }),
  ];

  it('prints ZET\'s name where a time would stand, in both languages, and no day word for a publish time long past or ahead', () => {
    expect(timeLabel(notice(), NOW, i18n)).toBe('ZET javlja');
    expect(timeLabel(notice(), NOW, i18nFor('en'))).toBe('ZET reports');
    for (const atMs of [NOW - 3 * 24 * 60 * MIN, NOW - MIN, NOW + 2 * 24 * 60 * MIN]) {
      expect(dayLabel(notice({ atMs }), NOW, i18n)).toBe('');
      expect(onLaterDay(notice({ atMs }), NOW)).toBe(false);
    }
    const html = rowsMarkup([notice()], NOW, i18n);
    expect(html).toContain('data-kind="notice"');
    expect(html).toContain('>ZET javlja</time>');
    expect(html).not.toContain('k-nearby-day');
    expect(html).toContain('<span class="nearby-title">Linije 5 i 13 u nedjelju mijenjaju trase</span><span class="nearby-sub">Zbog radova na pruzi.</span>');
  });

  it('is a reserved row: a cut list keeps it, and it is never the row to drop', () => {
    const all = rows();
    expect(fitRows(all, 4).map((r) => r.id)).toContain('notice:zet-promet:10160');
    expect(fitRows(all, 3).map((r) => r.id)).toEqual(['dep:1', 'notice:zet-promet:10160', 'always:story:trg']);
    let list = all;
    const dropped: string[] = [];
    for (let guard = 0; guard < 10; guard++) {
      const drop = dropCandidate(list, NOW);
      if (!drop) break;
      dropped.push(drop.id);
      list = list.filter((r) => r !== drop);
    }
    expect(dropped).not.toContain('notice:zet-promet:10160');
    expect(list.map((r) => r.id)).toEqual(['dep:1', 'notice:zet-promet:10160', 'always:story:trg']);
    // The lone departure and the notice: nothing left to drop.
    expect(dropCandidate([dep(1), notice()], NOW)).toBeNull();
  });

  it('holds its title to two lines (the second exception to "nothing is cut with an ellipsis") and the stylesheet clamps it there', () => {
    expect(NOTICE_TITLE_MAX_LINES).toBe(2);
    expect(TITLE_MAX_LINES).toBe(1);
    const css = readFileSync(join(import.meta.dirname, '../../app/src/ui/kiosk-city.css'), 'utf8');
    expect(css).toContain('.kiosk .k-nearby .nearby-row[data-kind="notice"] .nearby-title{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}');
    expect(css).toContain('.kiosk .k-nearby .nearby-row[data-kind="notice"][data-title-lines="3"] .nearby-title{-webkit-line-clamp:3;line-clamp:3}');
  });

  // vis1 F2 (R0 Step 5): the notice title's budget. The measure reads a clamped title's whole text (scrollHeight), the
  // row's height stops at the clamp: two lines, or three where data-title-lines="3". DR1: the departures line (R1) is
  // two read-tier lines, the badge and destination over the time, and a cell never overflows the list's measure.
  const clampedNotice = (layout: Layout): TimelineMeasure & { sum(list: Element): number } => {
    const lines = (el: Element): number => clampedEvent(el, wrapLines(el.textContent ?? '', el.classList.contains('nearby-title') ? layout.titleChars : layout.subChars));
    const rowPx = (): number => Number.parseFloat(section().style.getPropertyValue('--k-nearby-row')) || 64;
    const titlePrinted = (li: Element): number => {
      const n = lines(li.querySelector('.nearby-title')!);
      return li.getAttribute('data-kind') === 'notice' ? Math.min(n, li.getAttribute('data-title-lines') === '3' ? 3 : NOTICE_TITLE_MAX_LINES) : n;
    };
    const rowHeight = (li: Element): number => Math.max(rowPx(), li.getAttribute('data-kind') === 'departures' ? 2 * 44 + 8
      : 44 * titlePrinted(li) + 32 * lines(li.querySelector('.nearby-sub')!) + 8);
    const sum = (list: Element): number => [...list.children].reduce((acc, li) => acc + rowHeight(li), 0);
    const heightOf = (list: Element): number => Number.parseFloat((list as HTMLElement).style?.height ?? '') || layout.boxPx;
    const cell = (el: Element): boolean => el.classList.contains('k-dep-cell') || el.classList.contains('k-dep-headsign');
    return { box: (list) => ({ height: heightOf(list), width: layout.titleChars, overflow: !cell(list) && sum(list) > heightOf(list) }), lines, sum };
  };
  const REAL = 'Uspostavljena autobusna linija 228 (Borongaj – Rebro – Borongaj)';
  const NO_SEPARATOR = 'Tramvaji linija 5 i 13 od subote voze izmijenjenim trasama kroz Savsku i Vodnikovu ulicu sve do utorka navečer';

  it('prints a notice headline that runs past two lines by its own shorter words, and takes a third line only from room that is left', () => {
    // 20 title characters a line: the real headline takes four lines, its words before " (" two.
    const layout: Layout = { boxPx: 700, titleChars: 20, subChars: 26 };
    expect(wrapLines(REAL, 20)).toBe(4);
    const short = noticeShortTitle(REAL);
    expect(short).toBe('Uspostavljena autobusna linija 228');
    expect(wrapLines(short!, 20)).toBe(2);
    mount({ measure: clampedNotice(layout), designHeightPx: layout.boxPx }).update(rows({ title: REAL, titleShort: short }), 2200, NOW);
    expect(text(byId('notice:zet-promet:10160').querySelector('.nearby-title'))).toBe(short);
    expect(byId('notice:zet-promet:10160').hasAttribute('data-title-lines')).toBe(false);
    handle?.destroy();
    host.innerHTML = '';
    // A headline without a separator has no shorter words: in the same box it takes a third line.
    expect(NO_SEPARATOR.length).toBe(110);
    expect(noticeShortTitle(NO_SEPARATOR)).toBeUndefined();
    const roomy = clampedNotice(layout);
    mount({ measure: roomy, designHeightPx: layout.boxPx }).update(rows({ title: NO_SEPARATOR }), 2200, NOW);
    expect(byId('notice:zet-promet:10160').getAttribute('data-title-lines')).toBe('3');
    const shown = ids();
    const tight = roomy.sum(host.querySelector('ol')!) - 44;
    handle?.destroy();
    host.innerHTML = '';
    // A box with no room left for the third line: none, and no row goes for it.
    const snug: Layout = { ...layout, boxPx: tight };
    mount({ measure: clampedNotice(snug), designHeightPx: snug.boxPx }).update(rows({ title: NO_SEPARATOR }), 2200, NOW);
    expect(byId('notice:zet-promet:10160').hasAttribute('data-title-lines')).toBe(false);
    expect(ids()).toEqual(shown);
    expect(section().dataset.fitOverflow).toBe('0');
  });

  it('prints the sub where a line holds it and leaves it out where it would wrap, never growing the row (1920 x 1080, the totem)', () => {
    const wall = simulated({ boxPx: 700, titleChars: 17, subChars: 26 });
    mount({ measure: wall, designHeightPx: 700 }).update(rows({ sub: LONG_SUB }), 2200, NOW);
    expect(ids()).toContain('notice:zet-promet:10160');
    expect(text(byId('notice:zet-promet:10160').querySelector('.nearby-sub'))).toBe('');
    expect(text(byId('notice:zet-promet:10160').querySelector('.nearby-title'))).toBe('Linije 5 i 13 u nedjelju mijenjaju trase');
    handle?.destroy();
    host.innerHTML = '';
    const totem = simulated({ boxPx: 700, titleChars: 51, subChars: 200 });
    mount({ measure: totem, designHeightPx: 700 }).update(rows({ sub: LONG_SUB }), 2200, NOW);
    expect(text(byId('notice:zet-promet:10160').querySelector('.nearby-sub'))).toBe(LONG_SUB);
  });

  it('keeps the notice and the promises when the box is too small for everything: a departure or the closure gives way first', () => {
    // 250 px: the notice, the uvijek row and the first departure are the promises; the rest yields, the notice never.
    mount({ measure: simulated({ boxPx: 250, titleChars: 17, subChars: 26 }), designHeightPx: 250 }).update(rows(), 2200, NOW);
    const kept = expanded();
    expect(kept).toContain('notice:zet-promet:10160');
    expect(kept).toContain('always:story:trg');
    expect(kept).toContain('dep:1');
    // R1: the line is reserved with its three cells, so the closure gives way.
    expect(kept.filter((id) => id.startsWith('dep:'))).toEqual(['dep:1', 'dep:2', 'dep:3']);
    expect(kept).not.toContain('closure:gunduliceva');
    expect(byId('notice:zet-promet:10160').querySelector('.nearby-when')!.textContent).toBe('ZET javlja');
  });

  it('vets a notice under its own kinds: a title that fails the policy leaves the row out whole', () => {
    mount({ measure: simulated(WALL_1920) }).update(rows({ title: 'Linija 13 ne vozi, vidi www.primjer.com' }), 2200, NOW);
    expect(ids()).not.toContain('notice:zet-promet:10160');
    expect(section().dataset.skippedText).toBe('1');
  });
});

describe('the night list at 04:00 (observe-d530, now by the value order): the second and third departures keep their place before a sunrise or an opening', () => {
  // Production D5.30, Sunday 27 September, 03:52 to 04:03: the wall at 1920 x 1080 showed one departure in all 300
  // readings while three were due and the wall's own sentences named them. After midnight the morning rows are
  // today's (onLaterDay protects the departures only against a later day), the museum's name takes two title lines
  // over "Kultura" at 1920 x 1080, and the fit dropped the third and then the second night tram (each the only tram of
  // its line or direction for forty minutes) to keep a sunrise at 06:48 and an opening at 10:00. The ten rows the
  // selection gave, in its order (departures, then the timed rows by time, then the timeless row).
  const night = (hhmm: string): number => at(`2026-09-27T${hhmm}:00+02:00`);
  const NOW4 = night('04:00');
  const MUSEUM = 'open:culture-d62358d5d2fc659f:2026-09-27';
  const SUNRISE = 'solar:sunrise:2026-09-27';
  const rows = nightList0400;
  const departures = (): string[] => shownDepartures();

  it('at 1920 x 1080 shows the three due departures: the rows of the lowest value go first', () => {
    const measure = simulated(WALL_1920);
    const t = mount({ measure, designHeightPx: WALL_1920.boxPx });
    const all = rows();
    t.update(all, 2182, NOW4);
    // R1: the three departures are the line, one row, so the budget's estimate (64 px rows, seven of eight wall rows)
    // is the reserved rows (the line, the first tram, the pharmacy), then the most valuable (the value order, R0): the
    // closures under way (60), the openings at 10:00 (30 × 0.5 = 15), not the sunrise at 06:48 (20 × 0.5 = 10).
    const estimate = fitRows(groupDepartures(all), 7, NOW4);
    expect(estimate.map((r) => r.id)).toEqual(['departures', 'first:2026-09-27', MUSEUM, 'open:culture-karas:2026-09-27', 'closure:amruseva', 'closure:gunduliceva', 'always:pharmacy']);
    expect(wrapLines('Arheološki muzej u Zagrebu', WALL_1920.titleChars)).toBe(2);
    expect(departures()).toEqual(['dep:1', 'dep:2', 'dep:3']);
    // Measured (DR1): Galerija Karas goes (the tie at 15, the later row), then the two-line museum; Karas comes back in
    // the room the museum left (U0 step 7's retry), and the sunrise, which the estimate left out, does not fit after it.
    expect(ids()).toEqual(['departures', 'first:2026-09-27', 'open:culture-karas:2026-09-27', 'closure:amruseva', 'closure:gunduliceva', 'always:pharmacy']);
    expect(text(byId('first:2026-09-27').querySelector('.nearby-sub'))).toBe('11 05:19 · 12 05:20');
    expect(section().dataset.fitOverflow).toBe('0');
    expect(section().dataset.skippedFit).toBe('2');
    expect(measure.sum(host.querySelector('ol')!)).toBeLessThanOrEqual(WALL_1920.boxPx);
    // The whole yield order from that estimate: the openings (15, the later first), then the closures (60, the later
    // first); the line, the first tram and the pharmacy never (R1: the line yields no cell, where the third and second
    // departures went next).
    const order: string[] = [];
    for (let left: WallRow[] = estimate, drop = dropCandidate(left, NOW4); drop; left = left.filter((r) => r !== drop), drop = dropCandidate(left, NOW4)) order.push(drop.id);
    expect(order).toEqual(['open:culture-karas:2026-09-27', MUSEUM, 'closure:gunduliceva', 'closure:amruseva']);
    // From the old estimate of an ungrouped list (the sunrise and the museum in it) the sunrise (10) goes before the
    // museum (15), then the later departures (R0).
    const old = all.filter((r) => ['dep:1', 'dep:2', 'dep:3', 'first:2026-09-27', SUNRISE, MUSEUM, 'always:pharmacy'].includes(r.id));
    const oldOrder: string[] = [];
    for (let left: TimelineRow[] = old, drop = dropCandidate(left, NOW4); drop; left = left.filter((r) => r !== drop), drop = dropCandidate(left, NOW4)) oldOrder.push(drop.id);
    expect(oldOrder).toEqual([SUNRISE, MUSEUM, 'dep:3', 'dep:2']);
  });

  it('in a smaller box the sunrise goes too, never a departure: the line keeps its three cells, the sunrise within the hour and further away alike', () => {
    // DR1: 400 px holds the line, the first tram, the two closures and the pharmacy: the value order (R0) gives the
    // room to the closures (60) before the openings (15) and the sunrise (10).
    mount({ measure: simulated({ ...WALL_1920, boxPx: 400 }), designHeightPx: 400 }).update(rows(), 2182, NOW4);
    expect(ids()).toEqual(['departures', 'first:2026-09-27', 'closure:amruseva', 'closure:gunduliceva', 'always:pharmacy']);
    // 300 px: the closures go too, the later first, and the line keeps its three.
    handle?.destroy();
    host.innerHTML = '';
    mount({ measure: simulated({ ...WALL_1920, boxPx: 300 }), designHeightPx: 300 }).update(rows(), 2182, NOW4);
    expect(departures()).toEqual(['dep:1', 'dep:2', 'dep:3']);
    expect(ids()).toEqual(['departures', 'first:2026-09-27', 'always:pharmacy']);
    expect(section().dataset.fitOverflow).toBe('0');
    // At 05:50 the same sunrise is 58 minutes away (20 × 0.8 = 16): the line yields no cell, so in 300 px the
    // sunrise, the one row left to yield, goes, and in 400 px it stays.
    const dawn = [
      dep(1, { atMs: night('05:52'), live: false, title: 'Prečko', source: 'zet-gtfs', arrival: { routeId: '32', routeName: '32' } }),
      dep(2, { atMs: night('05:58'), title: 'Črnomerec', source: 'zet-rt', arrival: { routeId: '31', routeName: '31' } }),
      dep(3, { atMs: night('06:12'), live: false, title: 'Borongaj', source: 'zet-gtfs', arrival: { routeId: '32', routeName: '32' } }),
      row({ id: 'first:2026-09-27', kind: 'first', atMs: night('06:16'), title: 'Prvi tramvaj', sub: '14 06:16 · 13 06:21', source: 'zet-gtfs' }),
      row({ id: SUNRISE, kind: 'solar', atMs: night('06:48'), title: 'Izlazak sunca', source: 'solar' }),
      rows().at(-1)!,
    ];
    for (const [boxPx, kept] of [[300, ['departures', 'first:2026-09-27', 'always:pharmacy']], [400, ['departures', 'first:2026-09-27', SUNRISE, 'always:pharmacy']]] as const) {
      handle?.destroy();
      host.innerHTML = '';
      mount({ measure: simulated({ ...WALL_1920, boxPx }), designHeightPx: boxPx }).update(dawn, 2182, night('05:50'));
      expect(ids(), String(boxPx)).toEqual(kept);
      expect(departures(), String(boxPx)).toEqual(['dep:1', 'dep:2', 'dep:3']);
      expect(section().dataset.fitOverflow).toBe('0');
    }
  });

  it('the night0430 scene’s list at its 459 px box (e2e/scenes.ts): the line holds the departures due, and the sunrise 2 h 12 min away keeps its row beside them (R1)', () => {
    // The fit probe's first reading of night0430 at 1920 x 1080: 12 Dubrava in 2 minutes, 1 Borongaj 04:33, 17 Borongaj
    // 04:38, the first tram, the sunrise at 06:42, the closure until 08:30, the pharmacy.
    const scene = (hhmm: string): number => at(`2026-09-22T${hhmm}:00+02:00`);
    const list = (due: number): TimelineRow[] => [
      dep(1, { atMs: scene('04:32'), title: 'Dubrava', source: 'zet-rt', arrival: { routeId: '12', routeName: '12' } }),
      dep(2, { atMs: scene('04:33'), live: false, title: 'Borongaj', source: 'zet-gtfs', arrival: { routeId: '1', routeName: '1' } }),
      dep(3, { atMs: scene('04:38'), live: false, title: 'Borongaj', source: 'zet-gtfs', arrival: { routeId: '17', routeName: '17' } }),
    ].slice(0, due).concat([
      row({ id: 'first:2026-09-22', kind: 'first', atMs: scene('04:33'), title: 'Prvi tramvaj', sub: '1 04:33 · 11 04:51 · 6 04:57 · 14 05:11', subShort: '1 04:33 · 11 04:51', source: 'zet-gtfs' }),
      row({ id: 'solar:sunrise:2026-09-22', kind: 'solar', atMs: scene('06:42'), title: 'Izlazak sunca', source: 'solar' }),
      row({ id: 'closure:gunduliceva', kind: 'closure', atMs: scene('08:30'), title: 'Gundulićeva', sub: 'zatvoreno zbog radova, oba smjera', subShort: 'zatvoreno za promet', source: 'prometnice' }),
      row({ id: 'always:pharmacy', kind: 'pharmacy', atMs: null, always: true, title: '24/7', sub: 'Trg bana J. Jelačića 3', source: 'ljekarne' }),
    ]);
    const BOX: Layout = { boxPx: 459, titleChars: 17, subChars: 26 };
    // Before R1, with three due the sunrise gave its row to the third departure; the line takes one row for all three.
    for (const due of [3, 2]) {
      handle?.destroy();
      host.innerHTML = '';
      mount({ measure: simulated(BOX), designHeightPx: BOX.boxPx }).update(list(due), 2182, scene('04:30'));
      expect(ids(), String(due)).toEqual(['departures', 'first:2026-09-22', 'solar:sunrise:2026-09-22', 'closure:gunduliceva', 'always:pharmacy']);
      expect(departures(), String(due)).toEqual(['dep:1', 'dep:2', 'dep:3'].slice(0, due));
      expect(section().dataset.fitOverflow).toBe('0');
    }
  });

  it('by day a sunset yields before a closure, within the hour or beyond it (the value order, R0; the line yields no cell, R1)', () => {
    // R1: a list one row too tall for its 300 px box (the budget's 75 px rows; the line 96, the closure and the place
    // row 84 px with their sub-lines): the line, the sunset, the closure and the place row are 339 px.
    const DAY: Layout = { boxPx: 300, titleChars: 17, subChars: 26 };
    const evening = (hhmm: string): number => at(`2026-09-27T${hhmm}:00+02:00`);
    const list = (departuresAt: readonly string[]): TimelineRow[] => [
      ...departuresAt.map((hhmm, i) => dep(i + 1, { atMs: evening(hhmm), title: ['Črnomerec', 'Dubrava', 'Borongaj'][i]!, arrival: { routeId: ['6', '12', '17'][i]!, routeName: ['6', '12', '17'][i]! } })),
      row({ id: 'solar:sunset:2026-09-27', kind: 'solar', atMs: evening('18:51'), title: 'Zalazak sunca', source: 'solar' }),
      row({ id: 'closure:gunduliceva', kind: 'closure', atMs: evening('21:45'), title: 'Gundulićeva', sub: 'zatvoreno zbog radova, oba smjera', subShort: 'zatvoreno za promet', source: 'prometnice' }),
      always({ title: 'Trg bana Jelačića', sub: 'hrvatski ban' }),
    ];
    // 18:31: the sunset in 20 minutes (20), the closure under way (60): the sunset goes, the closure stays with its words.
    mount({ measure: simulated(DAY), designHeightPx: DAY.boxPx }).update(list(['18:34', '18:40', '19:11']), 2200, evening('18:31'));
    expect(ids()).toEqual(['departures', 'closure:gunduliceva', 'always:story:trg']);
    expect(text(byId('closure:gunduliceva').querySelector('.nearby-sub'))).toBe('zatvoreno za promet');
    expect(departures()).toEqual(['dep:1', 'dep:2', 'dep:3']);
    expect(section().dataset.fitOverflow).toBe('0');
    // 18:01: the sunset in 50 minutes (20 × 0.8 = 16): the sunset goes.
    handle?.destroy();
    host.innerHTML = '';
    mount({ measure: simulated(DAY), designHeightPx: DAY.boxPx }).update(list(['18:04', '18:10', '18:41']), 2200, evening('18:01'));
    expect(ids()).toEqual(['departures', 'closure:gunduliceva', 'always:story:trg']);
    expect(section().dataset.fitOverflow).toBe('0');
    // 17:41: the sunset in 70 minutes, the third departure in 40 (18:21): the sunset goes, the closure stays with its words.
    handle?.destroy();
    host.innerHTML = '';
    mount({ measure: simulated(DAY), designHeightPx: DAY.boxPx }).update(list(['17:44', '17:50', '18:21']), 2200, evening('17:41'));
    expect(ids()).toEqual(['departures', 'closure:gunduliceva', 'always:story:trg']);
    expect(text(byId('closure:gunduliceva').querySelector('.nearby-sub'))).toBe('zatvoreno za promet');
    expect(section().dataset.fitOverflow).toBe('0');
  });
});

describe('the 3-metre floors in every wall composition (computed from the real sheets)', () => {
  const sheets = ['app/src/ui/kiosk.css', 'app/src/ui/kiosk-city.css'].map((f) => readFileSync(join(import.meta.dirname, '..', '..', f), 'utf8')).join('\n');
  it('overrides the generic supporting-size badge with the departure title size on the wall', () => {
    // happy-dom lets an inherited ancestor declaration outrank the badge's
    // own smaller declaration. Pin the override too; D2 measured 28 px.
    expect(sheets).toMatch(/\.kiosk:not\(\[data-size=handheld\]\) \.k-nearby \.nearby-title \.k-line-badge\{[^}]*font-size:inherit;[^}]*height:auto;/);
  });
  function sizes(size: string, portrait: boolean, zoom = 1, theme = 'light'): Record<string, number> {
    document.head.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = sheets;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.className = 'kiosk';
    root.dataset.size = size;
    root.dataset.phase = 'invitation';
    document.documentElement.dataset.themeResolved = theme;
    if (portrait) root.dataset.portrait = '1';
    root.style.setProperty('--kiosk-zoom', String(zoom));
    document.body.replaceChildren(root);
    const t = mountTimeline(root, { i18n, reduced: true, designHeightPx: 486 });
    // Nine rows in the 486 px box: 64 px rows, so the type is at its base (no growth) and the floors are what is measured.
    // R1: the first tram, a train (a row's badge), the departures line (the cells' badge, time and destination), five
    // events and the place row. DR1 (R0's value order): the events stand past two hours (60 x 0.5 = 30), so the train
    // (50) outlasts the two the budget leaves out; the train no longer keeps its row by standing before the line.
    const train = row({ id: 'rail:2201', kind: 'rail', atMs: NOW + 12 * MIN, title: 'Savski Marof', sub: 'Zagreb Glavni kolodvor', source: 'hz',
      arrival: { tripId: '2201', routeId: 'R1', routeName: 'R1', headsign: 'Savski Marof', atMs: NOW + 12 * MIN, live: false, minutes: null } });
    const events = [1, 2, 3, 4, 5].map((n) => row({ id: `event:${n}`, kind: 'event', atMs: NOW + (150 + n) * MIN, title: 'Koncert', source: 'dogadanja' }));
    t.update([row({ id: 'first:x', kind: 'first', atMs: at('2026-09-23T02:16:00Z'), title: 'Prvi tramvaj', sub: '4 04:16' }), train, ...[1, 2, 3].map((n) => dep(n, { arrival: { routeId: '6', routeName: '6' } })), ...events, always()], 2000, NOW);
    const out: Record<string, number> = {};
    for (const sel of ['.nearby-title', '.nearby-when', '.nearby-sub', '.k-nearby-day', '.k-nearby-heading', '.nearby-title .k-line-badge', '.k-dep-cell .k-line-badge', '.k-dep-cell .nearby-when', '.k-dep-headsign']) out[sel] = px(getComputedStyle(root.querySelector(sel)!).fontSize);
    t.destroy();
    delete document.documentElement.dataset.themeResolved;
    return out;
  }
  it.each(['light', 'dark'])('puts departure badges in the read tier in %s, with the same floor as their titles (decision 26)', theme => {
    const s = sizes('wide', false, 1, theme);
    expect(s['.nearby-title .k-line-badge']).toBe(s['.nearby-title']);
    expect(s['.nearby-title .k-line-badge']).toBeGreaterThanOrEqual(theme === 'dark' ? 44 : 40);
    // R1: the line's badge and time are at the row title's size, the read tier.
    expect(s['.k-dep-cell .k-line-badge']).toBeCloseTo(s['.nearby-title']!);
    expect(s['.k-dep-cell .nearby-when']).toBeCloseTo(s['.nearby-title']!);
    document.head.innerHTML = '';
    document.documentElement.dataset.themeResolved = theme;
    document.body.innerHTML = `<li class="nearby-row"><span class="nearby-title"><span class="k-line-badge" style="font-size:${s['.nearby-title .k-line-badge']}px">6</span></span></li>`;
    const rect = new DOMRect(0, 0, 60, 60);
    const measure = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    try {
      const spec = pageSpec({ ...LEGIBILITY_WALL, map: undefined });
      const report = LEGIBILITY_IN_PAGE(spec);
      expect(report.violations).toEqual([]);
      expect(report.warnings).toEqual([expect.objectContaining({ tier: 'read', text: '6', px: s['.nearby-title .k-line-badge'] })]);
      (document.querySelector('.k-line-badge') as HTMLElement).style.fontSize = '28px';
      expect(LEGIBILITY_IN_PAGE(spec).violations).toEqual([expect.objectContaining({ tier: 'read', text: '6', px: 28 })]);
    } finally {
      measure.mockRestore();
      delete document.documentElement.dataset.themeResolved;
    }
  });
  for (const [name, size, portrait] of [['wide 1920 x 1080', 'wide', false], ['compact 1366 x 768', 'compact', false], ['portrait 1080 x 1920', 'compact', true]] as const) {
    it(`${name}: title and time at least 40 px, sub, day word and head at least 28 px`, () => {
      const s = sizes(size, portrait);
      expect(s['.nearby-title']).toBeGreaterThanOrEqual(40);
      expect(s['.nearby-when']).toBeGreaterThanOrEqual(40);
      expect(s['.nearby-sub']).toBeGreaterThanOrEqual(28);
      expect(s['.k-nearby-day']).toBeGreaterThanOrEqual(28);
      expect(s['.k-nearby-heading']).toBeGreaterThanOrEqual(28);
      // R1: the line's time and badge on the read tier, its destination on the walk-up tier, in light and dark.
      const dark = sizes(size, portrait, 1, 'dark');
      for (const [t, floor] of [[s, 40], [dark, 44]] as const) {
        expect(t['.k-dep-cell .nearby-when']).toBeGreaterThanOrEqual(floor - 0.01);
        expect(t['.k-dep-cell .k-line-badge']).toBeGreaterThanOrEqual(floor - 0.01);
        expect(t['.k-dep-headsign']).toBeGreaterThanOrEqual(28);
      }
    });
  }
  it('holds the floors below the design size (zoom 0.8) and grows above it (zoom 2)', () => {
    const small = sizes('compact', false, 0.8);
    expect(small['.nearby-title']).toBe(40);
    expect(small['.nearby-sub']).toBe(28);
    expect(small['.k-dep-cell .nearby-when']).toBe(40);
    expect(small['.k-dep-headsign']).toBe(28);
    const big = sizes('wide', false, 2);
    expect(big['.nearby-title']).toBe(80);
    expect(big['.nearby-sub']).toBe(56);
    expect(big['.k-dep-cell .nearby-when']).toBe(80);
    expect(big['.k-dep-cell .k-line-badge']).toBe(80);
    expect(big['.k-dep-headsign']).toBe(56);
  });
  it.each(['wide', 'compact'])('scales the dark read tier by 1.1 for %s while keeping the walk-up floor', size => {
    const light = sizes(size, false);
    const dark = sizes(size, false, 1, 'dark');
    expect(dark['.nearby-title']).toBeCloseTo(light['.nearby-title']! * 1.1);
    expect(dark['.nearby-when']).toBeCloseTo(light['.nearby-when']! * 1.1);
    expect(dark['.nearby-title']).toBeGreaterThanOrEqual(43);
    expect(dark['.k-nearby-heading']).toBeGreaterThanOrEqual(28);
  });
  it('lets a phone (handheld) read the list at its own tiers', () => {
    const s = sizes('handheld', false);
    expect(s['.nearby-title']).toBeLessThan(40);
  });
});

describe('lifecycle', () => {
  it('mounts into the host and leaves nothing behind', () => {
    vi.useFakeTimers();
    const t = mount();
    t.update([dep(1)], 2000, NOW);
    t.update([dep(1), dep(2)], 2000, NOW);
    expect(host.children).toHaveLength(1);
    t.destroy();
    handle = null;
    expect(host.children).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('accepts the S5 row type as it is', () => {
    const plain: NearbyRow = { id: 'x', kind: 'solar', atMs: NOW, always: false, title: 'Zalazak sunca', sub: '', live: false, source: 'solar' };
    const t = mount();
    t.update([plain], 2000, NOW);
    expect(t.shown()).toBe(1);
  });
});

describe('R0 review: measured fit keeps the value order', () => {
  const threeRows = (tallId?: string): TimelineMeasure => ({
    box: (list) => ({
      height: 210, width: 500,
      overflow: [...list.children].reduce((height, li) => height + (li.getAttribute('data-id') === tallId ? 140 : 64), 0) > 210,
    }),
    lines: vi.fn(() => 1),
  });

  it('R0 review: invalidates the memo when imminence changes the selected order, not on every clock tick', () => {
    const measure = threeRows();
    const rows = [
      dep(1, { live: false, atMs: NOW + 10 * MIN }),
      row({ id: 'rail:boundary', kind: 'rail', title: 'Savski Marof', atMs: NOW + 20 * MIN, source: 'hz' }),
      row({ id: 'event:boundary', kind: 'event', title: 'Koncert', sub: 'Gavella', atMs: NOW + 31 * MIN, source: 'dogadanja' }),
      always(),
    ];
    const timeline = mount({ measure, designHeightPx: 210 });
    timeline.update(rows, 2000, NOW);
    // DR1: on the wall the departure is the line's one cell (R1).
    expect(ids()).toEqual(['departures', 'rail:boundary', 'always:story:trg']);
    const calls = (measure.lines as ReturnType<typeof vi.fn>).mock.calls.length;
    timeline.update(rows, 2000, NOW + 30_000);
    expect((measure.lines as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(calls);
    timeline.update(rows, 2000, NOW + MIN);
    expect(ids()).toEqual(fitRows(groupDepartures(rows), 3, NOW + MIN).map((r) => r.id));
    expect(ids()).toEqual(['departures', 'event:boundary', 'always:story:trg']);
  });

  it('R0 review: restores from the full pool’s order without reserving a second timeless row', () => {
    const rows = [
      dep(1, { live: false }),
      row({ id: 'solar:restore', kind: 'solar', title: 'Zalazak sunca', atMs: NOW + 20 * MIN, source: 'solar' }),
      row({ id: 'closure:tall', kind: 'closure', title: 'Ilica', atMs: NOW + 60 * MIN, source: 'prometnice' }),
      always({ id: 'always:a', title: 'Kamenita vrata', sub: '' }),
      always({ id: 'always:b', title: 'Grički top', sub: '' }),
    ];
    mount({ measure: threeRows('closure:tall'), designHeightPx: 210 }).update(rows, 2000, NOW);
    expect(ids()).toEqual(['departures', 'solar:restore', 'always:a']);
  });
});


// The facts-breadth rows (docs/history/upgrade-2026-10-plan/U3.md S2): a train, rain, a cut, a road state, a place open now.
describe('the facts-breadth rows on the wall (U3 S2)', () => {
  // Route id "6" on purpose: an HŽ id that reads as a ZET tram line in ZET's table still gets no tram badge.
  const rail = row({ id: 'rail:2201', kind: 'rail', atMs: NOW + 12 * MIN, title: 'Savski Marof', sub: 'Zagreb Glavni kolodvor', source: 'hz',
    arrival: { tripId: '2201', routeId: '6', routeName: 'R1', headsign: 'Savski Marof', atMs: NOW + 12 * MIN, live: false, minutes: null } });
  const rain = row({ id: 'rain:gric', kind: 'rain', atMs: NOW + 15 * MIN, untilMs: NOW + 75 * MIN, title: 'Kiša', sub: 'vjerojatnost 90 %', source: 'dhmz-hourly',
    detail: { kind: 'rain', word: 'kisa', percent: 90 } });
  const open = row({ id: 'opennow:n2', kind: 'open', atMs: at('2026-09-22T16:10:00Z'), title: 'Ljekarna Centar', sub: 'ljekarna', source: 'osm-hours',
    detail: { kind: 'open', openKind: 'ljekarna' } });
  const road = row({ id: 'road:hak:b', kind: 'road', atMs: at('2026-09-22T17:00:00Z'), title: 'Ulica grada Vukovara', sub: 'privremena regulacija', source: 'hak',
    detail: { kind: 'road', state: 'regulacija' } });
  const cutDetail = { kind: 'cut' as const, utility: 'struja' as const, street: 'Ilica', fromMs: at('2026-09-23T06:00:00Z'), untilMs: at('2026-09-23T12:00:00Z'), allDay: false };
  const cut = row({ id: 'cut:ilica', kind: 'cut', atMs: cutDetail.fromMs, untilMs: cutDetail.untilMs, title: 'Ilica 12-20', titleShort: 'Ilica', sub: 'bez struje 08:00–14:00',
    source: 'prekidi', detail: cutDetail });
  const closure1 = row({ id: 'closure:ilica', kind: 'closure', atMs: at('2026-09-22T16:30:00Z'), title: 'Ilica', sub: 'zatvoreno za promet', source: 'prometnice' });
  const closure2 = row({ id: 'closure:vlaska', kind: 'closure', atMs: at('2026-09-22T20:00:00Z'), title: 'Vlaška', sub: 'zatvoreno za promet', source: 'prometnice' });
  const event = row({ id: 'event:gavella', kind: 'event', atMs: at('2026-09-22T17:30:00Z'), title: 'Gospoda Glembajevi', sub: 'Gavella', source: 'dogadanja' });
  /** selectNearby's order: the departures, then every timed row by its time. */
  const list = (): TimelineRow[] => [dep(1), dep(2), dep(3), rail, rain, open, closure1, road, event, closure2, cut];

  it('3 departures, 2 closures, an event and the five new kinds in a six-row budget keep the 3 departures, the rain and 2 closures', () => {
    // The value order (R0): the departures (100), the rain within the hour (70) and the closures under way (60) outlast
    // the train (50), the event at 19:30 (60 × 0.8 = 48), the road state (40), the place open now (30) and tomorrow's cut.
    const kept = ['dep:1', 'dep:2', 'dep:3', 'rain:gric', 'closure:ilica', 'closure:vlaska'];
    expect(fitRows(list(), 6, NOW).map((r) => r.id)).toEqual(kept);
    // The measured pass: a box that holds six rows drops by the same values. R1: the three departures are one row, so
    // the room of the second and third goes to the next by value (the train, 50, and the event, 48); the road state,
    // the place open now and tomorrow's cut go.
    const measure: TimelineMeasure = { box: (el) => ({ height: 480, width: 472, overflow: el.children.length > 6 }), lines: () => 1 };
    const t = mount({ measure });
    t.update(list(), 2000, NOW);
    expect(ids()).toEqual(['departures', 'rail:2201', 'rain:gric', 'closure:ilica', 'event:gavella', 'closure:vlaska']);
    expect(cellIds()).toEqual(['dep:1', 'dep:2', 'dep:3']);
  });

  it('drops a later day’s row first, then the row of the lowest value', () => {
    const order: string[] = [];
    for (let left = list(), drop = dropCandidate(left, NOW); drop; left = left.filter((r) => r !== drop), drop = dropCandidate(left, NOW)) order.push(drop.id);
    // The later-day cut first, then by value (R0): the place open now (30), the road state (40), the event at 19:30
    // (48), the train (50), the closures (60, the later first).
    expect(order.slice(0, 7)).toEqual(['cut:ilica', 'opennow:n2', 'road:hak:b', 'event:gavella', 'rail:2201', 'closure:vlaska', 'closure:ilica']);
    // A train the response policy put before the trams (policy.railFirst) is a train like any other (R0 §0.5 item 2):
    // 50 goes before a closure (60) and a second departure (100).
    const promoted = [rail, dep(1), dep(2), closure1];
    expect(dropCandidate(promoted, NOW)?.id).toBe('rail:2201');
    expect(fitRows([rail, dep(1), dep(2), rain], 3).map((r) => r.id)).toEqual(['dep:1', 'dep:2', 'rain:gric']); // 50 < 70 < 100
  });

  it('keeps the reserved rows and drops by value', () => {
    // Every kind at 17:45, all today: the drop order is the value order (shared/kiosk/takt.ts), computed here from
    // BASE_VALUE and the imminence bands; ties go to the later row; the reserved rows never go.
    const exhibit = row({ id: 'open:exhibit:k:2026-09-22', kind: 'opening', atMs: at('2026-09-22T17:00:00Z'), untilMs: at('2026-09-22T17:00:00Z'), title: 'Izložba', sub: 'Galerija',
      source: 'kultura-zg', detail: { kind: 'exhibit', venue: 'Galerija', openNow: true } });
    const solar = row({ id: 'solar:sunset', kind: 'solar', atMs: at('2026-09-22T17:07:00Z'), title: 'Zalazak sunca', source: 'solar' });
    const lastTrams = row({ id: 'last:x', kind: 'last', atMs: at('2026-09-22T21:31:00Z'), title: 'Zadnji tramvaji', source: 'zet-gtfs' });
    const notice = row({ id: 'notice:x', kind: 'notice', atMs: NOW - 60 * MIN, title: 'ZET javlja', source: 'zet-promet' });
    const cutLater = { ...cut, id: 'cut:later', atMs: at('2026-09-22T18:45:00Z'), untilMs: at('2026-09-22T20:00:00Z') };
    const pharmacy = row({ id: 'always:pharmacy', kind: 'pharmacy', atMs: null, always: true, title: '24/7', source: 'ljekarne' });
    const all: TimelineRow[] = [dep(1), dep(2), notice, rail, rain, open, closure1, exhibit, solar, road, event, cutLater, lastTrams, always(), pharmacy];
    const reserved = new Set(['dep:1', 'notice:x', 'last:x', 'always:story:trg']);
    // A fact under way (a closure, a road state, a place or an exhibition open now) stands by its end.
    const underWay = new Set(['closure', 'road', 'open']);
    const value = (r: TimelineRow): number => {
      const now = underWay.has(r.kind) || r.detail?.kind === 'exhibit';
      const imm = r.atMs === null ? 1 : now ? imminence(undefined, r.atMs, NOW) : imminence(r.atMs, r.untilMs, NOW);
      return BASE_VALUE[r.kind] * imm;
    };
    const expected = all.map((r, i) => ({ r, i })).filter(({ r }) => !reserved.has(r.id))
      .sort((a, b) => value(a.r) - value(b.r) || b.i - a.i).map(({ r }) => r.id);
    const order: string[] = [];
    let left = all;
    for (let drop = dropCandidate(left, NOW); drop; left = left.filter((r) => r !== drop), drop = dropCandidate(left, NOW)) order.push(drop.id);
    expect(order).toEqual(expected);
    expect(order.slice(0, 3)).toEqual(['solar:sunset', 'open:exhibit:k:2026-09-22', 'opennow:n2']); // 16, 30, 30 (the later first)
    expect(left.map((r) => r.id).sort()).toEqual([...reserved].sort());
  });

  it('prints each new kind’s time: a train’s clock, a road state and a cut under way by their end, a place open now by its close, a whole day as such', () => {
    const late = at('2026-09-22T21:50:00Z'); // 23:50
    expect([timeLabel(rail, NOW, i18n), dayLabel(rail, NOW, i18n)]).toEqual(['17:57', '']);
    expect(dayLabel({ ...rail, atMs: at('2026-09-22T22:10:00Z') }, late, i18n)).toBe('');
    expect(timeLabel(rain, NOW, i18n)).toBe('18:00');
    expect([timeLabel(road, NOW, i18n), dayLabel(road, NOW, i18n)]).toEqual(['do 19:00', '']);
    expect(timeLabel({ ...road, atMs: at('2026-09-24T08:00:00Z') }, NOW, i18n)).toBe('do 24. 9.');
    expect([timeLabel(open, NOW, i18n), dayLabel(open, NOW, i18n)]).toEqual(['do 18:10', '']);
    expect([timeLabel({ ...open, atMs: at('2026-09-23T00:00:00Z') }, late, i18n), dayLabel({ ...open, atMs: at('2026-09-23T00:00:00Z') }, late, i18n)]).toEqual(['do 02:00', '']);
    // A cut ahead stands at its start ("sutra 08:00"); under way at its end ("do 14:00", today).
    expect([timeLabel(cut, NOW, i18n), dayLabel(cut, NOW, i18n)]).toEqual(['08:00', 'sutra']);
    const running = { ...cut, atMs: cut.untilMs! };
    const morning = at('2026-09-23T08:00:00Z');
    expect([timeLabel(running, morning, i18n), dayLabel(running, morning, i18n), onLaterDay(running, morning)]).toEqual(['do 14:00', '', false]);
    // A whole-day water cut: "cijeli dan", tomorrow's under "sutra", today's with no day word.
    const allDay = { kind: 'cut' as const, utility: 'voda' as const, street: 'Jurišićeva ulica', fromMs: at('2026-09-22T22:00:00Z'), untilMs: at('2026-09-23T22:00:00Z'), allDay: true };
    const water = row({ id: 'cut:vio', kind: 'cut', atMs: allDay.fromMs, untilMs: allDay.untilMs, title: 'Jurišićeva ulica', sub: 'bez vode', source: 'prekidi', detail: allDay });
    expect([timeLabel(water, NOW, i18n), dayLabel(water, NOW, i18n)]).toEqual(['cijeli dan', 'sutra']);
    expect([timeLabel({ ...water, atMs: allDay.untilMs }, morning, i18n), dayLabel({ ...water, atMs: allDay.untilMs }, morning, i18n)]).toEqual(['cijeli dan', '']);
    expect(timeLabel(water, NOW, i18nFor('en'))).toBe('all day');
  });

  it('draws each with the probe markup: a train never live, never a tram’s badge; a cut’s clock range read by its grammar', () => {
    const t = mount({ designHeightPx: Number.POSITIVE_INFINITY });
    t.update([dep(1), rail, rain, open, road, cut], 2000, NOW);
    expect(ids()).toEqual(['dep:1', 'rail:2201', 'rain:gric', 'opennow:n2', 'road:hak:b', 'cut:ilica']);
    const train = byId('rail:2201');
    expect([train.dataset.kind, train.dataset.source, train.hasAttribute('data-live')]).toEqual(['rail', 'hz', false]);
    expect(train.querySelector('.k-line-badge')?.getAttribute('data-kind')).toBe('other');
    expect(text(train.querySelector('.nearby-title'))).toBe('R1 Savski Marof');
    expect(text(byId('cut:ilica').querySelector('.nearby-sub'))).toBe('bez struje 08:00–14:00');
    // Hostile words before a clock range are still read as prose.
    t.update([dep(1), { ...cut, sub: 'nazovi 091 234 5678 08:00–14:00' }], 2000, NOW);
    expect(ids()).toEqual(['dep:1']);
  });
});
