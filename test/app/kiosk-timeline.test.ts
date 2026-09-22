// @vitest-environment happy-dom
// The wall's "U blizini" list (app/src/kiosk/timeline.ts): the §15.6 probe
// markup, the time words (blue countdown, grey clock, "uvijek", "do …",
// "sutra"), calm motion (a row keeps its node, an idle update writes nothing,
// only a new row fades in) and whole rows from the row budget. happy-dom has
// no layout, so the list is never measured and designHeightPx stands in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import { createI18n, type I18n, type MessageCatalog } from '../../app/src/i18n/i18n';
import type { NearbyRow } from '../../app/src/city/nearby';
import {
  COUNTDOWN_HORIZON_MIN, ENTER_CLEAR_MS, STACK_MIN_PX, dayLabel, fitRows, mountTimeline, rowsMarkup, timeLabel, typeScale,
  type TimelineHandle, type TimelineRow,
} from '../../app/src/kiosk/timeline';

// kiosk.nearby.* is WP1-D's key group; until it lands the test carries the
// same words, and once it is in the catalogue the catalogue's words win.
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
const dep = (n: number, over: Partial<TimelineRow> = {}): TimelineRow =>
  row({ id: `dep:${n}`, kind: 'departure', atMs: NOW + n * 4 * MIN, live: true, ...over });
const always = (over: Partial<TimelineRow> = {}): TimelineRow =>
  row({ id: 'always:story:trg', kind: 'always', atMs: null, always: true, title: 'Trg bana Jelačića', sub: 'Trg nosi ime bana Josipa Jelačića.', source: 'city', ...over });

/** A realistic 17:45 list: three departures, a closure, an event, the sunset and the place story. */
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
const byId = (id: string): HTMLLIElement => host.querySelector<HTMLLIElement>(`li[data-id="${id}"]`)!;
const text = (el: Element | null | undefined): string => el?.textContent ?? '';
const section = (): HTMLElement => host.querySelector<HTMLElement>('[data-testid=nearby]')!;

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
      expect(li.querySelector('.nearby-when')).not.toBeNull();
      expect(li.querySelector('.nearby-title')).not.toBeNull();
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
    expect(text(story.querySelector('.nearby-sub'))).toBe('Trg nosi ime bana Josipa Jelačića.');
    // No empty sub line: a row without one has no .nearby-sub at all.
    expect(byId('solar:sunset:2026-09-22').querySelector('.nearby-sub')).toBeNull();
    expect(section().getAttribute('aria-labelledby')).toBe(host.querySelector('[data-testid=nearby-head]')!.id);
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

  it('draws the day word in the time cell, beside the time, not inside the <time>', () => {
    const t = mount();
    const first = row({ id: 'first:2026-09-23', kind: 'first', atMs: at('2026-09-23T02:16:00Z'), title: 'Prvi tramvaj', sub: '4 04:16 · 6 04:22' });
    t.update([first, always()], 2000, Date.parse('2026-09-22T21:40:00Z'));
    const li = byId('first:2026-09-23');
    expect(text(li.querySelector('.nearby-when'))).toBe('04:16');
    expect(text(li.querySelector('.k-nearby-day'))).toBe('sutra');
  });

  it('never prints a caption, a freshness word or a source word', () => {
    const markup = rowsMarkup(scene(), NOW, i18n) + rowsMarkup(scene().map((r) => ({ ...r, live: false })), NOW, i18n);
    for (const word of [/uživo/i, /po redu vožnje/i, /procjen/i, /zastarjel/i, /nepotvrđen/i, /registra/i, /nije provjera/i, /Obuhvat/, /Dohvaćeno/, /nedostup/i]) {
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

  it('fades in only the row that was not there before, and clears the fade', () => {
    vi.useFakeTimers();
    const t = mount();
    t.update(scene(), 2000, NOW);
    const kept = items();
    const next = scene();
    next.splice(5, 0, row({ id: 'opening:dolac', kind: 'opening', atMs: at('2026-09-22T16:30:00Z'), title: 'Tržnica Dolac' }));
    t.update(next, 2000, NOW);
    expect(items().filter((li) => li.dataset.enter === '1').map((li) => li.dataset.id)).toEqual(['opening:dolac']);
    for (const li of kept) expect(items()).toContain(li);
    // Rows enter at their time position.
    expect(items().map((li) => li.dataset.id).indexOf('opening:dolac')).toBe(5);
    // An update while the row is still fading does not cut the fade short.
    t.update(next, 2000, NOW);
    expect(byId('opening:dolac').dataset.enter).toBe('1');
    vi.advanceTimersByTime(ENTER_CLEAR_MS);
    expect(byId('opening:dolac').hasAttribute('data-enter')).toBe(false);
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

  it('lets a departed row leave at the top without moving the rows that stay', () => {
    const t = mount();
    t.update(scene(), 2000, NOW);
    const [, ...stay] = items();
    const observer = new MutationObserver(() => undefined);
    observer.observe(section(), { subtree: true, childList: true, attributes: true, characterData: true });
    t.update(scene().slice(1), 2000, NOW);
    const records = observer.takeRecords();
    observer.disconnect();
    expect(items()).toEqual(stay);
    // One removal; the rows below keep their place in the list.
    expect(records.filter((r) => r.type === 'childList' && r.removedNodes.length > 0)).toHaveLength(1);
    expect(records.filter((r) => r.type === 'childList' && r.addedNodes.length > 0)).toHaveLength(0);
  });

  it('writes nothing on an idle update and at most two changes in an idle minute', () => {
    const t = mount();
    t.update(scene(), 2000, NOW);
    const observer = new MutationObserver(() => undefined);
    observer.observe(section(), { subtree: true, childList: true, attributes: true, characterData: true });
    t.update(scene(), 2000, NOW + 20_000);
    t.update(scene(), 2000, NOW + 25_000);
    expect(observer.takeRecords()).toHaveLength(0);
    // A minute on: the tracked countdown ticks from "za 4 min" to "za 3 min"; nothing else moves.
    t.update(scene(), 2000, NOW + MIN);
    const records = observer.takeRecords();
    observer.disconnect();
    expect(text(byId('dep:1').querySelector('.nearby-when'))).toBe('za 3 min');
    expect(records.length).toBeGreaterThan(0);
    expect(records.length).toBeLessThanOrEqual(2);
  });
});

describe('whole rows from the row budget', () => {
  const many = (n: number): TimelineRow[] => [...Array.from({ length: n - 1 }, (_, i) => dep(i + 1)), always()];

  it('grows three rows to 92 px, stacked, and shrinks twelve to whole 64 px rows on one line', () => {
    const t = mount({ designHeightPx: 520 });
    t.update(many(3), 2000, NOW);
    expect(section().style.getPropertyValue('--k-nearby-row')).toBe('92px');
    expect(section().dataset.lines).toBe('2');
    expect(section().style.getPropertyValue('--k-nearby-scale')).toBe('1.1');
    expect(t.shown()).toBe(3);
    t.update(many(12), 2000, NOW);
    expect(section().style.getPropertyValue('--k-nearby-row')).toBe('64px');
    expect(section().dataset.lines).toBe('1');
    expect(section().style.getPropertyValue('--k-nearby-scale')).toBe('1');
    // floor(520 / 64) = 8 whole rows, none of them hidden.
    expect(t.shown()).toBe(8);
    expect(items()).toHaveLength(8);
    expect(items().some((li) => li.hasAttribute('hidden'))).toBe(false);
  });

  it('keeps the "uvijek" row when the box cuts the list: the latest timed rows give way', () => {
    const t = mount({ designHeightPx: 520 });
    t.update(many(12), 2000, NOW);
    const ids = items().map((li) => li.dataset.id);
    expect(ids.at(-1)).toBe('always:story:trg');
    expect(ids.slice(0, 7)).toEqual(['dep:1', 'dep:2', 'dep:3', 'dep:4', 'dep:5', 'dep:6', 'dep:7']);
  });

  it('shows every row of an unbounded list (a handheld) and never measures it', () => {
    const t = mount({ designHeightPx: Number.POSITIVE_INFINITY });
    t.update(many(20), 2000, NOW);
    expect(t.shown()).toBe(20);
    expect(section().dataset.lines).toBe('2');
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

  it('fits rows and scales type by the rules the CSS is written for', () => {
    const rows = [dep(1), dep(2), always(), dep(3)];
    expect(fitRows(rows, 4)).toEqual(rows);
    expect(fitRows(rows, 2).map((r) => r.id)).toEqual(['dep:1', 'always:story:trg']);
    expect(fitRows(rows, 0)).toEqual([]);
    expect(typeScale(64)).toBe(1);
    expect(typeScale(STACK_MIN_PX)).toBe(1);
    expect(typeScale(92)).toBeCloseTo(1.1);
    // A stacked row always holds its two lines (44 + 32 px at the wall's 40/28 px type, scaled).
    for (let px = STACK_MIN_PX; px <= 92; px += 1) expect((40 * 1.1 + 28 * 1.15) * typeScale(px)).toBeLessThanOrEqual(px - 1);
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
