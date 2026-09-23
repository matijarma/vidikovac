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
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import { createI18n, type I18n, type MessageCatalog } from '../../app/src/i18n/i18n';
import type { NearbyRow } from '../../app/src/city/nearby';
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
    for (const word of [/uživo/i, /po redu vožnje/i, /procjen/i, /zastarjel/i, /nepotvrđen/i, /registra/i, /nije provjera/i, /Obuhvat/, /Dohvaćeno/, /nedostup/i, /…|\.\.\./]) {
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

  it('lets a new row enter at the bottom, fade in once and settle into its time position on the next update', () => {
    vi.useFakeTimers();
    const t = mount();
    t.update(scene(), 2000, NOW);
    const kept = items();
    const next = scene();
    next.splice(5, 0, row({ id: 'opening:dolac', kind: 'opening', atMs: at('2026-09-22T16:30:00Z'), title: 'Tržnica Dolac' }));
    // Update 1: the new row is appended below every row that was there, the others keep their order and nodes.
    t.update(next, 2000, NOW);
    expect(ids()).toEqual(['dep:1', 'dep:2', 'dep:3', 'closure:ilica', 'event:gavella', 'solar:sunset:2026-09-22', 'always:story:trg', 'opening:dolac']);
    expect(items().slice(0, kept.length)).toEqual(kept);
    expect(items().filter((li) => li.dataset.enter === '1').map((li) => li.dataset.id)).toEqual(['opening:dolac']);
    const entering = byId('opening:dolac');
    // An update while the row is still fading keeps the fade.
    vi.advanceTimersByTime(100);
    // Update 2: it settles into its time position; every node is the same one.
    t.update(next, 2000, NOW + 20_000);
    expect(ids()).toEqual(next.map((r) => r.id));
    expect(byId('opening:dolac')).toBe(entering);
    expect(entering.dataset.enter).toBe('1');
    for (const li of kept) expect(items()).toContain(li);
    vi.advanceTimersByTime(ENTER_CLEAR_MS);
    expect(entering.hasAttribute('data-enter')).toBe(false);
    // Update 3: nothing moves any more.
    const w = watch();
    t.update(next, 2000, NOW + 40_000);
    expect(w.structural()).toHaveLength(0);
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

  it('runs a departure sequence: the top leaves, a later one enters at the bottom, nodes survive throughout', () => {
    const t = mount();
    const rows = (first: number): TimelineRow[] => [dep(first), dep(first + 1), dep(first + 2), always()];
    t.update(rows(1), 2000, NOW);
    const node2 = byId('dep:2');
    const node3 = byId('dep:3');
    // dep:1 has left, dep:4 is the next one: it is appended at the bottom (below "uvijek") for one update.
    t.update(rows(2), 2000, NOW + 5 * MIN);
    expect(ids()).toEqual(['dep:2', 'dep:3', 'always:story:trg', 'dep:4']);
    expect(byId('dep:2')).toBe(node2);
    expect(byId('dep:3')).toBe(node3);
    t.update(rows(2), 2000, NOW + 5 * MIN + 20_000);
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
    expect(fitRows(rows, 0)).toEqual([]);
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

describe('whole words: no ellipsis, content selection, then whole rows', () => {
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

  it('at 1920 x 1080 shortens the long labels, keeps the three departures and drops the latest rows whole', () => {
    const measure = simulated(WALL_1920);
    const t = mount({ designHeightPx: 486, measure });
    t.update(longRows(), 2000, NOW);
    expect(ids()).toEqual(['dep:1', 'dep:2', 'dep:3', 'closure:vukovarska', 'always:heritage:stedionica']);
    // "Ulica grada Vukovara" and its three-line sub give way to their complete short twins.
    expect(text(byId('closure:vukovarska').querySelector('.nearby-title'))).toBe('Vukovarska');
    expect(text(byId('closure:vukovarska').querySelector('.nearby-sub'))).toBe('Savska – Miramarska');
    // "Zgrada nekadašnje Gradske štedionice" takes three title lines there; "Gradska štedionica" wraps onto two, whole.
    expect(text(byId('always:heritage:stedionica').querySelector('.nearby-title'))).toBe('Gradska štedionica');
    // "Zapadni kolodvor" has no shorter twin: it wraps onto a second line, whole.
    expect(text(byId('dep:2').querySelector('.nearby-title'))).toBe('11 Zapadni kolodvor');
    expect(measure.rowHeight(byId('dep:2'))).toBe(96);
    expect(measure.sum(host.querySelector('ol')!)).toBe(436);
  });

  it('at 1080 x 1920 has the width for the full labels and keeps more rows', () => {
    const measure = simulated(TOTEM_1080);
    const t = mount({ designHeightPx: 498, measure });
    t.update(longRows(), 2000, NOW);
    expect(ids()).toEqual(['dep:1', 'dep:2', 'dep:3', 'closure:vukovarska', 'event:gavella', 'always:heritage:stedionica']);
    expect(text(byId('event:gavella').querySelector('.nearby-title'))).toBe('Gospoda Glembajevi');
    expect(text(byId('event:gavella').querySelector('.nearby-sub'))).toBe('Gradsko dramsko kazalište Gavella · tramvaj 6');
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
    const DEPARTURES = { kvaternik: { light: 3, dark: 2 }, trg: { light: 2, dark: 1 } } as const;
    for (const variant of ['kvaternik', 'trg'] as const) for (const theme of ['light', 'dark'] as const) {
      const kept = DEPARTURES[variant][theme];
      it(`${variant}, ${theme}: the event stays with its whole title wrapped beside ${kept} departure${kept > 1 ? 's' : ''}`, () => {
        const measure = measured(theme);
        const t = mount({ designHeightPx: BOX_PX, measure });
        t.update(wall(variant), 2000, T);
        expect(ids().slice(0, kept + 1)).toEqual([...['dep:1', 'dep:2', 'dep:3'].slice(0, kept), 'event:vis']);
        expect(ids().at(-1)).toBe(`always:story:${variant}`);
        expect(text(byId('event:vis').querySelector('.nearby-title'))).toBe(LONG);
        expect(text(byId('event:vis').querySelector('.nearby-sub'))).toBe(variant === 'kvaternik' ? 'Dom kulture Kvaternik' : 'Gradsko dramsko kazalište Gavella');
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
    t.update([row({ id: 'first:x', kind: 'first', atMs: at('2026-09-23T02:16:00Z'), title: 'Prvi tramvaj', sub: '4 04:16' }), ...[1, 2, 3, 4, 5, 6].map((n) => dep(n)), always()], 2000, NOW);
    const out: Record<string, number> = {};
    for (const sel of ['.nearby-title', '.nearby-when', '.nearby-sub', '.k-nearby-day', '.k-nearby-heading']) out[sel] = px(getComputedStyle(root.querySelector(sel)!).fontSize);
    t.destroy();
    delete document.documentElement.dataset.themeResolved;
    return out;
  }
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
