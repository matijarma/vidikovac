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
import { selectNearby, type NearbyRow } from '../../app/src/city/nearby';
import type { LastRunLive } from '../../app/src/core/lastrun';
import { emptyCity } from '../../shared/city/types';
import { departuresBoard } from '../../e2e/departures-fixture';
import { CALM_MOTION_SPEC, CALM_MOTION_START_IN_PAGE, CALM_MOTION_READ_IN_PAGE, calmMotionFailures, calmChurnFailures } from '../../e2e/wall';
import { LEGIBILITY_IN_PAGE, pageSpec, WALL_1920 as LEGIBILITY_WALL } from '../../e2e/legibility';
import {
  COUNTDOWN_HORIZON_MIN, ENTER_CLEAR_MS, GROW_FROM_PX, SUB_MAX_LINES, TITLE_MAX_LINES, dayLabel, dropCandidate, fitRows, mountTimeline, rowsMarkup,
  timeLabel, typeScale, type TimelineHandle, type TimelineMeasure, type TimelineRow,
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
    expect(rows.map((li) => li.dataset.kind)).toEqual(['departure', 'departure', 'departure', 'closure', 'event', 'solar', 'always']);
    for (const li of rows) {
      expect(li.dataset.id).toBeTruthy();
      expect(li.dataset.key).toBe(li.dataset.id);
      expect(li.dataset.source).toBeTruthy();
      // The per-row structure is always the same three probes.
      expect(li.querySelectorAll('.nearby-when')).toHaveLength(1);
      expect(li.querySelectorAll('.nearby-title')).toHaveLength(1);
      expect(li.querySelectorAll('.nearby-sub')).toHaveLength(1);
      expect(li.hasAttribute('hidden')).toBe(false);
      // Exactly one of the two time attributes.
      expect(li.hasAttribute('data-when') !== li.hasAttribute('data-always')).toBe(true);
    }
    const first = byId('dep:1');
    expect(first.dataset.when).toBe(new Date(NOW + 4 * MIN).toISOString());
    expect(first.dataset.live).toBe('1');
    expect(first.querySelector('time.nearby-when')!.getAttribute('datetime')).toBe(first.dataset.when);
    expect(byId('dep:2').hasAttribute('data-live')).toBe(false);
    const story = byId('always:story:trg');
    expect(story.dataset.always).toBe('1');
    expect(story.querySelector('time')).toBeNull();
    expect(text(story.querySelector('.nearby-sub'))).toBe('hrvatski ban, 1848-1859; 1801-1859');
    expect(section().getAttribute('aria-labelledby')).toBe(host.querySelector('[data-testid=nearby-head]')!.id);
  });

  it('keeps an empty, stable .nearby-sub on a departure and a solar row', () => {
    const t = mount();
    t.update(scene(), 2000, NOW);
    for (const id of ['dep:1', 'dep:2', 'solar:sunset:2026-09-22']) {
      const li = byId(id);
      const sub = li.querySelector('.k-nearby-text > .nearby-sub');
      expect(sub, id).not.toBeNull();
      expect(text(sub), id).toBe('');
      expect(li.querySelector('.k-nearby-at > .nearby-when'), id).not.toBeNull();
      expect(li.querySelector('.k-nearby-text > .nearby-title'), id).not.toBeNull();
    }
    const sub = byId('solar:sunset:2026-09-22').querySelector('.nearby-sub');
    t.update(scene(), 2000, NOW + 20_000);
    expect(byId('solar:sunset:2026-09-22').querySelector('.nearby-sub')).toBe(sub);
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

  it('leads a departure that carries its arrival with the line badge', () => {
    const t = mount();
    t.update(scene(), 2000, NOW);
    const title = byId('dep:1').querySelector('.nearby-title')!;
    const badge = title.querySelector('.k-line-badge')!;
    expect(text(badge)).toBe('6');
    expect(badge.getAttribute('data-kind')).toBe('tram');
    expect(text(title)).toBe('6 Črnomerec');
    expect(byId('dep:2').querySelector('.k-line-badge')).toBeNull();
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
  });

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
      expect(ids().slice(0, 3)).toEqual(['dep:1', 'dep:2', 'dep:3']);
      const nodes = new Map(items().map((li) => [li.dataset.id, li]));
      const w = structure();
      expect(CALM_MOTION_START_IN_PAGE(CALM_MOTION_SPEC)).toBe(7);
      for (let s = 1; s <= 60; s++) t.update(rows(NOW + s * 1000), 2200, NOW + s * 1000);
      const reading = CALM_MOTION_READ_IN_PAGE(CALM_MOTION_SPEC);
      const records = w.records();
      w.stop();
      expect(reading.left).toEqual(['departure|dep:1']);
      expect(reading.entered).toEqual(['departure|dep:4']);
      expect(reading.rebuilt).toEqual([]);
      expect(reading.kept).toBe(6);
      // Exactly the two content changes, one record each; no node is taken out and put back (a move is two records).
      expect(records, JSON.stringify(records)).toEqual([{ added: [], removed: ['li[dep:1]'] }, { added: ['li[dep:4]'], removed: [] }]);
      expect(reading.mutations).toBe(2);
      expect(calmMotionFailures(reading)).toEqual([]);
      // The entering row sits at its time position from its first paint, and the rows that stayed are the same nodes in the same order.
      expect(ids()).toEqual(['dep:2', 'dep:3', 'dep:4', 'solar:sunset:2026-09-22', 'closure:gunduliceva', 'closure:palmoticeva', 'always:heritage:zgrada']);
      for (const id of ['dep:2', 'dep:3', 'solar:sunset:2026-09-22', 'closure:gunduliceva', 'closure:palmoticeva', 'always:heritage:zgrada']) expect(byId(id)).toBe(nodes.get(id));
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
      /** The fixture row on the list, wherever the paint put it. */
      const third = (): string | undefined => ids().find((id) => id.startsWith('dep:fixture-'));
      t.update(rows(), 2200, NOW);
      expect(ids()[2]).toBe('dep:fixture-106_1-12-2026-09-22T15:58');
      const w = structure();
      expect(CALM_MOTION_START_IN_PAGE(CALM_MOTION_SPEC)).toBe(7);
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
      expect(reading.left).toEqual(['departure|dep:fixture-106_1-12-2026-09-22T15:58']);
      expect(reading.entered).toEqual(['departure|dep:fixture-106_1-12-2026-09-22T15:59']);
      expect(reading.rebuilt).toEqual([]);
      expect(reading.kept).toBe(6);
      // One removal and one insertion per identity change, in landing order, and no node taken out and put back.
      const key = (platform: number, minute: string): string => `li[dep:fixture-106_${platform}-12-2026-09-22T${minute}]`;
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
    const before = items();
    expect(before.some((li) => li.hasAttribute('data-enter'))).toBe(false);
    t.update(scene(), 2000, NOW + 20_000);
    const after = items();
    expect(after).toHaveLength(before.length);
    after.forEach((li, i) => expect(li).toBe(before[i]));
    expect(after.some((li) => li.hasAttribute('data-enter'))).toBe(false);
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
    expect(ids()).toEqual(next.map((r) => r.id));
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

  it('lets a departed row leave at the top without moving the rows that stay', () => {
    const t = mount();
    t.update(scene(), 2000, NOW);
    const [, ...stay] = items();
    const w = watch();
    t.update(scene().slice(1), 2000, NOW);
    const records = w.structural();
    w.stop();
    expect(items()).toEqual(stay);
    // One removal at the top; the rows below keep their place.
    expect(records.filter((r) => r.type === 'childList' && r.removedNodes.length > 0)).toHaveLength(1);
    expect(records.filter((r) => r.type === 'childList' && r.addedNodes.length > 0)).toHaveLength(0);
  });

  it('runs a departure sequence: the top leaves, the next one enters under the departures that stay, nodes survive throughout', () => {
    const t = mount();
    const rows = (first: number): TimelineRow[] => [dep(first), dep(first + 1), dep(first + 2), always()];
    t.update(rows(1), 2000, NOW);
    const node2 = byId('dep:2');
    const node3 = byId('dep:3');
    const nodeAlways = byId('always:story:trg');
    // dep:1 has left, dep:4 is the next one: it enters at the bottom of the departures, above "uvijek", in the same update.
    const w = watch();
    t.update(rows(2), 2000, NOW + 5 * MIN);
    const records = w.structural().filter((r) => r.type === 'childList');
    expect(ids()).toEqual(['dep:2', 'dep:3', 'dep:4', 'always:story:trg']);
    expect(byId('dep:2')).toBe(node2);
    expect(byId('dep:3')).toBe(node3);
    expect(byId('always:story:trg')).toBe(nodeAlways);
    // One removal, one insertion: the two content changes and nothing else.
    expect(records.map((r) => [[...r.addedNodes].length, [...r.removedNodes].length])).toEqual([[0, 1], [1, 0]]);
    w.stop();
    const later = watch();
    t.update(rows(2), 2000, NOW + 5 * MIN + 20_000);
    expect(later.structural().filter((r) => r.type === 'childList')).toHaveLength(0);
    later.stop();
    expect(ids()).toEqual(['dep:2', 'dep:3', 'dep:4', 'always:story:trg']);
    expect(byId('dep:2')).toBe(node2);
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
    expect(text(byId('dep:1').querySelector('.nearby-when'))).toBe('za 3 min');
    expect(w.structural().length).toBeLessThanOrEqual(2);
    expect(w.structural()).toHaveLength(0);
    expect(w.text()).toHaveLength(1);
    w.stop();
  });

  it('keeps the structural budget with three tracked countdowns: three truthful text changes a minute, nothing else', () => {
    const t = mount();
    const rows = [dep(1, { atMs: NOW + 3 * MIN }), dep(2, { atMs: NOW + 6 * MIN }), dep(3, { atMs: NOW + 9 * MIN }), always()];
    t.update(rows, 2000, NOW);
    const nodes = items();
    const w = watch();
    for (let s = 20; s <= 60; s += 20) t.update(rows, 2000, NOW + s * 1000);
    expect(items().map((li) => text(li.querySelector('.nearby-when')))).toEqual(['za 2 min', 'za 5 min', 'za 8 min', 'uvijek']);
    expect(w.structural().length).toBeLessThanOrEqual(2);
    expect(w.structural()).toHaveLength(0);
    expect(w.text()).toHaveLength(3);
    for (const r of w.text()) expect((r.target.parentElement as Element).matches('time.nearby-when')).toBe(true);
    expect(items()).toEqual(nodes);
    w.stop();
  });
});

describe('whole rows from the row budget', () => {
  const many = (n: number): TimelineRow[] => [...Array.from({ length: n - 1 }, (_, i) => dep(i + 1)), always()];

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
    expect(t.shown()).toBe(5);
  });
  it('reserves first, last and uvijek before both the initial row cap and the measured drop pass (decision 27)', () => {
    const last = row({ id: 'last:night', kind: 'last', title: 'Zadnji tramvaji' });
    const first = row({ id: 'first:morning', kind: 'first', title: 'Prvi tramvaj' });
    const rows = [dep(1), dep(2), dep(3), row({ id: 'event:next', kind: 'event', title: 'Koncert' }), last, first, always()];
    const required = ['dep:1', last.id, first.id, always().id];
    expect(fitRows(rows, 4).map(r => r.id)).toEqual(required);
    const measure: TimelineMeasure = {
      box: list => ({ height: 400, width: 472, overflow: list.children.length > 4 }),
      lines: () => 1,
    };
    const t = mount({ measure });
    t.update(rows, 2000, NOW);
    expect(ids()).toEqual(required);
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
    expect(ids().slice(0, 7)).toEqual(['dep:1', 'dep:2', 'dep:3', 'dep:4', 'dep:5', 'dep:6', 'dep:7']);
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
    expect(dropCandidate([dep(1), dep(2), closure, solar, always()])?.id).toBe('solar:x');
    expect(dropCandidate([dep(1), dep(2), always()])?.id).toBe('dep:2');
    // The next thing that is not a departure outlasts a second departure, and goes before the first one.
    expect(dropCandidate([dep(1), dep(2), closure, always()])?.id).toBe('dep:2');
    expect(dropCandidate([dep(1), closure, always()])?.id).toBe('closure:x');
    expect(dropCandidate([dep(1), always()])).toBeNull();
    expect(dropCandidate([dep(1), dep(2)])?.id).toBe('dep:2');
    expect(dropCandidate([dep(1)])).toBeNull();
    expect(typeScale(64)).toBe(1);
    expect(typeScale(GROW_FROM_PX)).toBe(1);
    expect(typeScale(92)).toBeCloseTo(1.1);
    // A two-line row at the floors (44 + 32 px of line boxes, scaled) fits its budget from GROW_FROM_PX on.
    for (let px = GROW_FROM_PX; px <= 92; px += 1) expect((40 * 1.1 + 28 * 1.15) * typeScale(px)).toBeLessThanOrEqual(px - 1);
  });
});

/**
 * A layout for the fit: a title line holds `titleChars` characters, a sub line
 * `subChars` (whole words, wrapped), a row is as tall as its lines (44 px a
 * title line, 32 px a sub line, 8 px of padding) and never below the budget.
 * The widths are the wall's text column at 40/28 px Manrope: about 408 px at
 * 1920 x 1080 (the 680 px aside) and 790 px on the 1080 x 1920 totem.
 */
interface Layout { boxPx: number; titleChars: number; subChars: number }
const WALL_1920: Layout = { boxPx: 486, titleChars: 17, subChars: 26 };
const TOTEM_1080: Layout = { boxPx: 498, titleChars: 34, subChars: 51 };
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
function simulated(layout: Layout): TimelineMeasure & { rowHeight(li: Element): number; sum(list: Element): number } {
  const lines = (el: Element): number => wrapLines(el.textContent ?? '', el.classList.contains('nearby-title') ? layout.titleChars : layout.subChars);
  const rowPx = (): number => Number.parseFloat(section().style.getPropertyValue('--k-nearby-row')) || 64;
  const rowHeight = (li: Element): number => Math.max(rowPx(), 44 * lines(li.querySelector('.nearby-title')!) + 32 * lines(li.querySelector('.nearby-sub')!) + 8);
  const sum = (list: Element): number => [...list.children].reduce((acc, li) => acc + rowHeight(li), 0);
  return {
    box: (list) => ({ height: layout.boxPx, width: layout.titleChars, overflow: sum(list) > layout.boxPx }),
    lines: (el) => lines(el),
    rowHeight,
    sum,
  };
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
const COMPACT_1366: Layout = { boxPx: 154, titleChars: 16, subChars: 25 };
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
const COMPACT_1366_D50: Layout = { boxPx: 451, titleChars: 16, subChars: 25 };

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
        const shown = ids();
        const label = `${name} on the ${day}th at ${String(hour % 24).padStart(2, '0')}:20: ${shown.join(', ')}`;
        expect(section().dataset.fitOverflow, label).toBe('0');
        if (rows.some((r) => r.kind === 'departure')) expect(shown.some((id) => id.startsWith('dep:')), label).toBe(true);
        for (const promise of rows.filter((r) => r.kind === 'first' || r.kind === 'last' || r.always)) expect(shown, label).toContain(promise.id);
        for (const li of items()) expect(measure.lines(li.querySelector('.nearby-sub')!), label).toBeLessThanOrEqual(SUB_MAX_LINES);
        if (layout === COMPACT_1366_D50) {
          // Lane w-labels2: the rows the fit never drops, as tall as this layout draws them, and the arrangement
          // the wall picks for them (invitation.ts compactArrangement): the list holds them and the map is legible.
          const lead = items().find((li) => li.dataset.kind === 'departure');
          const kept = items().filter((li) => li.dataset.kind === 'first' || li.dataset.kind === 'last' || li.dataset.always === '1' || li === lead);
          // Each at its content, never under the smallest row: the height it keeps in a smaller box.
          const floorPx = kept.reduce((sum, li) => sum + Math.max(64, 44 * measure.lines(li.querySelector('.nearby-title')!) + 32 * measure.lines(li.querySelector('.nearby-sub')!) + 8), 0);
          const box = compactArrangement({ ...COMPACT_1366_WINDOW, floorPx });
          expect(box.mapPx, `${label}: the map (${box.placement})`).toBeGreaterThanOrEqual(MAP_MIN_HEIGHT_PX);
          expect(box.listPx, `${label}: the list holds its promises (${box.placement})`).toBeGreaterThanOrEqual(floorPx);
        }
        t.destroy();
        handle = null;
        host.innerHTML = '';
      }
    });
  }
});

describe('the compact wall and the night promises (decision 27, D2 full run at 1366 x 768)', () => {
  const NIGHT = at('2026-09-21T22:40:00+02:00');

  it('keeps a departure beside the three promises in a box that cannot hold them, and says so, instead of showing none', () => {
    const measure = simulated(COMPACT_1366);
    const t = mount({ measure, designHeightPx: COMPACT_1366.boxPx });
    t.update(nightRows(), 2182, NIGHT);
    const kinds = items().map((li) => li.dataset.kind);
    // The promises stay (decision 27) and the wall never shows zero departures (1 to 3 in every reading).
    expect(kinds.filter((k) => k === 'departure')).toHaveLength(1);
    expect(kinds).toEqual(['departure', 'last', 'first', 'pharmacy']);
    expect(ids()[0]).toBe('dep:1');
    // Every shown sub is its shorter complete twin, never a wrapped three-line list.
    for (const li of items()) expect(measure.lines(li.querySelector('.nearby-sub')!)).toBeLessThanOrEqual(SUB_MAX_LINES);
    expect(text(byId('last:2026-09-21').querySelector('.nearby-sub'))).toBe('1 23:31 · 12 23:45');
    expect(text(byId('first:2026-09-22').querySelector('.nearby-sub'))).toBe('12 04:13 · 17 04:24');
    // An impossible box is reported, not hidden by deleting a row: 64 + 3 x 84 = 316 px in 154.
    expect(section().dataset.fitOverflow).toBe('1');
    expect(section().dataset.skippedFit).toBe('2');
    expect(measure.sum(host.querySelector('ol')!)).toBe(316);
  });

  it('at 1920 x 1080 shows the three promises with two-line subs at most and all three departures', () => {
    const measure = simulated(WALL_1920);
    const t = mount({ measure });
    t.update(nightRows(), 2182, NIGHT);
    const kinds = items().map((li) => li.dataset.kind);
    // The row budget (81 px rows for six) lets five whole rows in: two departures beside the three promises.
    expect(kinds.filter((k) => k === 'departure').length).toBeGreaterThanOrEqual(2);
    expect(kinds.slice(-3)).toEqual(['last', 'first', 'pharmacy']);
    for (const li of items()) expect(measure.lines(li.querySelector('.nearby-sub')!)).toBeLessThanOrEqual(SUB_MAX_LINES);
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
    t.update([...board.slice(0, 3), ...timed()], 2200, NOW0);
    // Seven candidates: the budget says 69 px a row; six at 69 and the 84 px heritage row are 498 px, over the box. The
    // fitter dropped the sunset row (the latest timed row) instead of giving the rows back their minimum height.
    expect(ids()).toEqual(['dep:1', 'dep:2', 'dep:3', 'closure:amruseva', 'closure:gunduliceva', 'solar:sunset:2026-09-24', 'always:heritage:zakladni']);
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
    expect(CALM_MOTION_START_IN_PAGE(CALM_MOTION_SPEC)).toBe(7);
    // The first departure leaves at 13:45:16 (its grace over); for a poll's few seconds the list has six candidates
    // (the budget says 80 px a row: five at 80 and the 84 px row are 484 px, one over the box); then the fourth enters.
    for (let s = 1; s <= 80; s++) t.update(rows(NOW0 + s * 1000, false), 2200, NOW0 + s * 1000);
    expect(ids()).toEqual(['dep:2', 'dep:3', 'closure:amruseva', 'closure:gunduliceva', 'solar:sunset:2026-09-24', 'always:heritage:zakladni']);
    for (let s = 81; s <= 90; s++) t.update(rows(NOW0 + s * 1000, true), 2200, NOW0 + s * 1000);
    const reading = CALM_MOTION_READ_IN_PAGE(CALM_MOTION_SPEC);
    const records = w.records();
    w.stop();
    expect(records, JSON.stringify(records)).toEqual([{ added: [], removed: ['li[dep:1]'] }, { added: ['li[dep:4]'], removed: [] }]);
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
    expect(CALM_MOTION_START_IN_PAGE(CALM_MOTION_SPEC)).toBe(6);
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
    expect(CALM_MOTION_START_IN_PAGE(CALM_MOTION_SPEC)).toBe(7);
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

describe('whole words: no ellipsis, content selection, then whole rows', () => {
  it.each(['22:40', '04:30'])('%s keeps the real Trg first-tram and pharmacy rows within the 1920 budget', time => {
    const now = at(`2026-09-${time === '22:40' ? '22' : '23'}T${time}:00+02:00`);
    const file = JSON.parse(readFileSync(join(import.meta.dirname, '../../app/public/data/lastrun/106_1.json'), 'utf8'));
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
    expect(items().filter(li => li.dataset.kind === 'departure').length).toBeGreaterThanOrEqual(1);
    expect(items().filter(li => li.dataset.kind === 'departure').length).toBeLessThanOrEqual(3);
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
    // The first departure and the timeless row are promises; an event yields to the box.
    const reserved = kind !== 'event';
    expect(ids()).toEqual(reserved ? ['oversized'] : []);
    expect(t.shown()).toBe(reserved ? 1 : 0);
    expect(section().dataset.skippedFit).toBe(reserved ? '0' : '1');
    expect(section().dataset.fitOverflow).toBe(reserved ? '1' : '0');
    expect(measure.box(host.querySelector('ol')!).overflow).toBe(reserved);
    t.update([candidate], 2000, NOW + 1000);
    expect(ids()).toEqual(reserved ? ['oversized'] : []);
    room = 300;
    t.update([candidate], 2000, NOW + 2000);
    expect(ids()).toEqual(['oversized']);
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
    expect(ids()).toEqual(['dep:1', always().id]);
    expect(section().dataset.skippedFit).toBe('1');
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
      // A departure row always exists, and the first one is never dropped.
      expect(ids()[0]).toBe('dep:1');
      for (const li of items()) {
        const r = rows.find((x) => x.id === li.dataset.id)!;
        const title = text(li.querySelector('.nearby-title')).replace(/^\d+ /, '');
        const sub = text(li.querySelector('.nearby-sub'));
        expect([r.title, r.titleShort]).toContain(title);
        expect([r.sub, r.subShort]).toContain(sub);
        // A short label is printed only where the full one ran long.
        if (r.titleShort && title === r.titleShort) expect(wrapLines(`${r.arrival ? `${r.arrival.routeName} ` : ''}${r.title}`, layout.titleChars)).toBeGreaterThan(TITLE_MAX_LINES);
        if (r.subShort !== undefined && sub === r.subShort) expect(wrapLines(r.sub, layout.subChars)).toBeGreaterThan(1);
        if (r.subShort !== undefined && sub === r.sub && wrapLines(r.sub, layout.subChars) > SUB_MAX_LINES) throw new Error(`${r.id}: a sub over ${SUB_MAX_LINES} lines kept beside its short twin`);
        expect(text(li)).not.toMatch(/…|\.\.\./);
      }
      // The rows kept are the earliest in time and the order is the selection's.
      const order = rows.map((r) => r.id).filter((id) => ids().includes(id));
      expect(ids()).toEqual(order);
      // A steady wall does not refit: the next update changes no structure.
      const w = watch();
      t.update(rows, 2000, NOW + 20_000);
      expect(w.structural()).toHaveLength(0);
      w.stop();
    });
  }

  it('at 1920 x 1080 shortens the long labels and gives later departures to the reserved last-tram row', () => {
    const measure = simulated(WALL_1920);
    const t = mount({ designHeightPx: 486, measure });
    t.update(longRows(), 2000, NOW);
    expect(ids()).toEqual(['dep:1', 'closure:vukovarska', 'last:2026-09-22', 'always:heritage:stedionica']);
    // "Ulica grada Vukovara" and its three-line sub give way to their complete short twins.
    expect(text(byId('closure:vukovarska').querySelector('.nearby-title'))).toBe('Vukovarska');
    expect(text(byId('closure:vukovarska').querySelector('.nearby-sub'))).toBe('Savska – Miramarska');
    // "Zgrada nekadašnje Gradske štedionice" takes three title lines there; "Gradska štedionica" wraps onto two, whole.
    expect(text(byId('always:heritage:stedionica').querySelector('.nearby-title'))).toBe('Gradska štedionica');
    expect(text(byId('last:2026-09-22').querySelector('.nearby-sub'))).toBe(longRows()[6]!.subShort);
    expect(measure.sum(host.querySelector('ol')!)).toBe(392);
  });

  it('at 1080 x 1920 has the width for the full labels and keeps more rows', () => {
    const measure = simulated(TOTEM_1080);
    const t = mount({ designHeightPx: 498, measure });
    t.update(longRows(), 2000, NOW);
    expect(ids()).toEqual(['dep:1', 'dep:2', 'dep:3', 'closure:vukovarska', 'last:2026-09-22', 'always:heritage:stedionica']);
    expect(text(byId('last:2026-09-22').querySelector('.nearby-title'))).toBe('Zadnji tramvaji');
    expect(text(byId('closure:vukovarska').querySelector('.nearby-title'))).toBe('Ulica grada Vukovara');
    expect(text(byId('always:heritage:stedionica').querySelector('.nearby-title'))).toBe('Gradska štedionica');
    expect(measure.sum(host.querySelector('ol')!)).toBeLessThanOrEqual(TOTEM_1080.boxPx);
  });

  // The lane W wall check of 22 September at 1920 x 1080 (review.local/companion/run/logs/w-e2e/wall-visual.json):
  // the line counts Chromium measured, a 40 px title line box of 44 px (48.4 px in dark, 44 px type) and a 28 px sub
  // line of 32.2 px. The source gives the long event no shorter name, and the words before its colon are not one
  // (review W, P2): the whole title wraps onto three lines, and the list makes room with its later departures
  // (the first one always stays), never by cutting the title or dropping the next thing on it.
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
        return words ? LINES[theme][words] ?? 1 : 0;
      };
      const rowPx = (): number => Number.parseFloat(section().style.getPropertyValue('--k-nearby-row')) || 64;
      const rowHeight = (li: Element): number => Math.max(rowPx(),
        LINE_PX[theme].title * lines(li.querySelector('.nearby-title')!) + LINE_PX[theme].sub * lines(li.querySelector('.nearby-sub')!) + 8);
      const sum = (list: Element): number => [...list.children].reduce((acc, li) => acc + rowHeight(li), 0);
      return { box: (list) => ({ height: BOX_PX, width: 472, overflow: sum(list) > BOX_PX }), lines, sum };
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
    // How many departures stay beside the whole title: all three where the rows fit, else the later ones give way.
    const DEPARTURES = { kvaternik: { light: 1, dark: 1 }, trg: { light: 1, dark: 1 } } as const;
    for (const variant of ['kvaternik', 'trg'] as const) for (const theme of ['light', 'dark'] as const) {
      const kept = DEPARTURES[variant][theme];
      it(`${variant}, ${theme}: the reserved rows stay beside ${kept} departure and the event stays whole only if it fits`, () => {
        const measure = measured(theme);
        const t = mount({ designHeightPx: BOX_PX, measure });
        t.update(wall(variant), 2000, T);
        expect(ids()).toEqual(['dep:1', ...(theme === 'light' ? ['event:vis'] : []), 'last:2026-09-22', `always:story:${variant}`]);
        expect(ids().at(-1)).toBe(`always:story:${variant}`);
        if (theme === 'light') {
          expect(text(byId('event:vis').querySelector('.nearby-title'))).toBe(LONG);
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
    t.update(longRows(), 2000, NOW + 20_000);
    expect(t.shown()).toBeLessThan(roomy);
    expect(measure.sum(host.querySelector('ol')!)).toBeLessThanOrEqual(300);
    layout.boxPx = 498;
    t.update(longRows(), 2000, NOW + 40_000);
    expect(t.shown()).toBe(roomy);
  });
});

/** Evaluates a computed font-size such as "calc(max(40px,calc(28px * 1)) * 1)" to px (happy-dom resolves var() but not calc/max). */
function px(value: string): number {
  const js = value.replace(/px/g, '').replace(/calc\(/g, '(').replace(/max\(/g, 'Math.max(').replace(/min\(/g, 'Math.min(');
  if (!/^[\d.\s+\-*/(),]+$/.test(js.replace(/Math\.(max|min)/g, ''))) throw new Error(`not a length: ${value}`);
  return Number(new Function(`return (${js});`)());
}

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
    // Eight rows in the 486 px box: 64 px rows, so the type is at its base (no growth) and the floors are what is measured.
    t.update([row({ id: 'first:x', kind: 'first', atMs: at('2026-09-23T02:16:00Z'), title: 'Prvi tramvaj', sub: '4 04:16' }), ...[1, 2, 3, 4, 5, 6].map((n) => dep(n, { arrival: { routeId: '6', routeName: '6' } })), always()], 2000, NOW);
    const out: Record<string, number> = {};
    for (const sel of ['.nearby-title', '.nearby-when', '.nearby-sub', '.k-nearby-day', '.k-nearby-heading', '.k-line-badge']) out[sel] = px(getComputedStyle(root.querySelector(sel)!).fontSize);
    t.destroy();
    delete document.documentElement.dataset.themeResolved;
    return out;
  }
  it.each(['light', 'dark'])('puts departure badges in the read tier in %s, with the same floor as their titles (decision 26)', theme => {
    const s = sizes('wide', false, 1, theme);
    expect(s['.k-line-badge']).toBe(s['.nearby-title']);
    expect(s['.k-line-badge']).toBeGreaterThanOrEqual(theme === 'dark' ? 44 : 40);
    document.head.innerHTML = '';
    document.documentElement.dataset.themeResolved = theme;
    document.body.innerHTML = `<li class="nearby-row"><span class="nearby-title"><span class="k-line-badge" style="font-size:${s['.k-line-badge']}px">6</span></span></li>`;
    const rect = new DOMRect(0, 0, 60, 60);
    const measure = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    try {
      const spec = pageSpec({ ...LEGIBILITY_WALL, map: undefined });
      const report = LEGIBILITY_IN_PAGE(spec);
      expect(report.violations).toEqual([]);
      expect(report.warnings).toEqual([expect.objectContaining({ tier: 'read', text: '6', px: s['.k-line-badge'] })]);
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
    });
  }
  it('holds the floors below the design size (zoom 0.8) and grows above it (zoom 2)', () => {
    const small = sizes('compact', false, 0.8);
    expect(small['.nearby-title']).toBe(40);
    expect(small['.nearby-sub']).toBe(28);
    const big = sizes('wide', false, 2);
    expect(big['.nearby-title']).toBe(80);
    expect(big['.nearby-sub']).toBe(56);
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
