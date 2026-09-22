// The wall's "U blizini" list (docs/companion-2026-09-22.md §11, §12, principle
// 7): the rows app/src/city/nearby.ts selects, drawn beside the map over the
// QR card. The component owns only the drawing; the controller (kiosk.ts)
// owns every clock and cache and calls update() on each paint, at least once
// a minute so a countdown stays true.
//
// Calm motion [O-24], [O-33]: rows are reconciled by id (ui/dom/reconcile.ts,
// keyed on data-key), so a row that stays keeps its node and only a changed
// text node is touched; an idle update writes nothing. Rows enter at their
// time position (the new ones at the bottom) and leave at the top; only a row
// that was not there before fades in, once, and never under reduced motion.
//
// Whole rows only: the list is an exact number of --k-nearby-row tracks
// (rowBudget, 64 to 92 px at the design size), the rows beyond the budget are
// sliced off here and none is ever hidden. The "uvijek" row survives the cut,
// as in the owner's mock: the latest timed rows go first.
//
// Honesty by selection, not by caption (principle 5): a tracked departure is
// a blue countdown ("za 4 min") or a blue clock past the countdown horizon, a
// timetable departure a grey clock; no word says which. The probe contract
// (§15.6) is the markup: section[data-testid=nearby] > nearby-head +
// ol[data-testid=nearby-rows] > li.nearby-row[data-id][data-kind]
// [data-when|data-always][data-live][data-source] with .nearby-when (<time>),
// .nearby-title, .nearby-sub; data-key duplicates data-id for reconcile.ts.
import type { ArrivalRow } from '../../../shared/city/arrivals';
import { nearbyHead, rowBudget, type NearbyRow } from '../city/nearby';
import type { I18n } from '../i18n/i18n';
import { escapeAttribute as a, escapeHtml as e } from '../ui/dom/escape';
import { reconcile } from '../ui/dom/reconcile';
import { kindOfRoute } from './exceptions';
import { clock, dayKey, dayMonth } from './format';
import { kBadge } from './markup';

/**
 * A departure row may carry the arrival it was built from (WP1-C asked WP1-A
 * for `arrival` on NearbyRow); the row then leads its title with the line
 * badge. Without it the row reads as its title alone.
 */
export type TimelineRow = NearbyRow & { arrival?: Pick<ArrivalRow, 'routeId' | 'routeName'> };

export interface TimelineDeps {
  i18n: I18n;
  /** No entrance fade (prefers-reduced-motion or lagano); kiosk.css also stops it. */
  reduced: boolean;
  /**
   * The list box's height in design px, used while it cannot be measured (no
   * layout yet); Infinity for an unbounded list (a handheld: every row in
   * flow, never measured). A function is read on every update, so a
   * composition change needs no remount.
   */
  designHeightPx: number | (() => number);
}

export interface TimelineHandle {
  element: HTMLElement;
  /** Draws `rows` (selectNearby's order) under the head for the measured circle, timed against `now`. */
  update(rows: readonly TimelineRow[], radiusM: number, now: number): void;
  /** The list box's height in design px (the zoom divided out); 0 before layout. */
  measureHeight(): number;
  /** How many rows the last update drew. */
  shown(): number;
  destroy(): void;
}

/** Past this many minutes a tracked departure shows a clock, as shared/city/arrivals.ts does. */
export const COUNTDOWN_HORIZON_MIN = 10;
/**
 * The lowest row that holds a title line over a sub line at the wall's type
 * (40 px read tier over the 28 px walk-up tier: 44 + 32 px of line boxes);
 * below it a row is one line and the sub follows the title while it fits.
 */
export const STACK_MIN_PX = 80;
/** How much a stacked row's type grows by 92 px (never below the tier floors). */
export const TYPE_GROWTH = 0.1;
/** The entrance fade (kiosk-city.css k-nearby-in) and the moment data-enter is cleared if no animationend came. */
export const ENTER_MS = 220;
export const ENTER_CLEAR_MS = 260;

const ROW_MAX = 92;

/** A row with no moment: the "uvijek" row, the pharmacy at night. */
export function isTimeless(row: NearbyRow): boolean {
  return row.always || row.atMs === null || !Number.isFinite(row.atMs);
}

/**
 * The first `n` rows in order, but the timeless rows are kept and the latest
 * timed rows give way to them: the mock the owner approved always ends with
 * its "uvijek" row, however short the box.
 */
export function fitRows<T extends NearbyRow>(rows: readonly T[], n: number): T[] {
  if (rows.length <= n) return [...rows];
  if (n <= 0) return [];
  const keep = new Set<T>(rows.filter(isTimeless).slice(0, n));
  for (const row of rows) {
    if (keep.size >= n) break;
    if (!isTimeless(row)) keep.add(row);
  }
  return rows.filter((row) => keep.has(row));
}

const WEEKDAY_HR = new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', weekday: 'short' });
const WEEKDAY_EN = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', weekday: 'short' });

/** Whole Zagreb calendar days from `now` to `atMs` (0 today, 1 tomorrow). */
function daysAhead(atMs: number, now: number): number {
  const day = (ms: number): number => Date.parse(`${dayKey(ms)}T00:00:00Z`);
  return Math.round((day(atMs) - day(now)) / 86_400_000);
}

/**
 * The word over a row's time when it is not today: "sutra", then the short
 * weekday ("čet"). A departure and the evening's last departures are tonight
 * by definition (a 00:04 tram is not "sutra" at 23:50), and a closure's end
 * carries its own date.
 */
export function dayLabel(row: NearbyRow, now: number, i18n: I18n): string {
  if (isTimeless(row) || row.kind === 'departure' || row.kind === 'last' || row.kind === 'closure') return '';
  const days = daysAhead(row.atMs!, now);
  if (days <= 0) return '';
  if (days === 1) return i18n.t('kiosk.say.tomorrow');
  return (i18n.getLocale().startsWith('en') ? WEEKDAY_EN : WEEKDAY_HR).format(new Date(row.atMs!));
}

/**
 * The row's time as the wall prints it: "uvijek"; a tracked departure inside
 * the horizon "sada" / "za 4 min"; a closure "do 18:00", or "do 25. 9." when
 * it ends on another day; everything else its Zagreb clock time.
 */
export function timeLabel(row: NearbyRow, now: number, i18n: I18n): string {
  if (isTimeless(row)) return i18n.t('kiosk.nearby.always');
  const atMs = row.atMs!;
  if (row.kind === 'departure' && row.live && atMs - now <= COUNTDOWN_HORIZON_MIN * 60_000) {
    const minutes = Math.max(0, Math.round((atMs - now) / 60_000));
    return minutes === 0 ? i18n.t('arrivals.now') : i18n.t('arrivals.inMinutes', { n: minutes });
  }
  if (row.kind === 'closure') return `${i18n.t('kiosk.nearby.until')} ${daysAhead(atMs, now) === 0 ? clock(atMs) : dayMonth(atMs)}`;
  return clock(atMs);
}

/** One row's markup: time cell (the time, the day word under or before it), the spine mark, title and sub. */
export function rowMarkup(row: TimelineRow, now: number, i18n: I18n): string {
  const timeless = isTimeless(row);
  const text = e(timeLabel(row, now, i18n));
  const iso = timeless ? '' : new Date(row.atMs!).toISOString();
  const attrs = [
    'class="nearby-row"',
    `data-id="${a(row.id)}"`,
    `data-key="${a(row.id)}"`,
    `data-kind="${a(row.kind)}"`,
    timeless ? 'data-always="1"' : `data-when="${iso}"`,
    row.live ? 'data-live="1"' : '',
    `data-source="${a(row.source)}"`,
  ].filter(Boolean).join(' ');
  const when = timeless ? `<span class="nearby-when">${text}</span>` : `<time class="nearby-when" datetime="${iso}">${text}</time>`;
  const day = dayLabel(row, now, i18n);
  const badge = row.arrival?.routeName ? `${kBadge(row.arrival.routeName, kindOfRoute(row.arrival.routeId))} ` : '';
  const sub = row.sub ? `<span class="nearby-sub">${e(row.sub)}</span>` : '';
  return `<li ${attrs}><span class="k-nearby-at">${when}${day ? `<span class="k-nearby-day">${e(day)}</span>` : ''}</span>`
    + `<span class="k-nearby-mark" aria-hidden="true"></span>`
    + `<span class="k-nearby-text"><span class="nearby-title">${badge}${e(row.title)}</span>${sub}</span></li>`;
}

/** The rows' markup in order; the phone (WP4) can draw the same list with its own sheet. */
export function rowsMarkup(rows: readonly TimelineRow[], now: number, i18n: I18n): string {
  return rows.map((row) => rowMarkup(row, now, i18n)).join('');
}

/** How a stacked row's type grows with its height: 1 up to STACK_MIN_PX, 1 + TYPE_GROWTH at 92 px. */
export function typeScale(rowPx: number): number {
  if (rowPx <= STACK_MIN_PX) return 1;
  return 1 + (TYPE_GROWTH * (Math.min(rowPx, ROW_MAX) - STACK_MIN_PX)) / (ROW_MAX - STACK_MIN_PX);
}

/** "U blizini" and " · 2 km · ~15 min" as two spans, so the head's text is nearbyHead's exactly. */
function headMarkup(head: string): string {
  const cut = head.indexOf(' · ');
  if (cut === -1) return `<span class="k-nearby-heading-title">${e(head)}</span>`;
  return `<span class="k-nearby-heading-title">${e(head.slice(0, cut))}</span><span class="k-nearby-heading-pill">${e(head.slice(cut))}</span>`;
}

export function mountTimeline(host: HTMLElement, deps: TimelineDeps): TimelineHandle {
  const { i18n } = deps;
  const element = document.createElement('section');
  element.className = 'k-nearby';
  element.dataset.testid = 'nearby';
  element.setAttribute('aria-labelledby', 'k-nearby-heading');
  element.innerHTML = '<h2 class="k-nearby-heading" id="k-nearby-heading" data-testid="nearby-head"></h2><ol class="k-nearby-rows" data-testid="nearby-rows"></ol>';
  host.appendChild(element);
  const heading = element.querySelector<HTMLElement>('.k-nearby-heading')!;
  const list = element.querySelector<HTMLOListElement>('.k-nearby-rows')!;
  let headText: string | null = null;
  let painted = false;
  let count = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const clearEnter = (li: Element): void => { if (li.hasAttribute('data-enter')) li.removeAttribute('data-enter'); };
  const onAnimationEnd = (event: Event): void => {
    const li = event.target instanceof Element ? event.target.closest('.nearby-row') : null;
    if (li && li.parentElement === list) clearEnter(li);
  };
  list.addEventListener('animationend', onAnimationEnd);

  function zoom(): number {
    const value = Number.parseFloat(getComputedStyle(element).getPropertyValue('--k-zoom'));
    return Number.isFinite(value) && value > 0 ? value : 1;
  }
  function measureHeight(): number {
    const px = list.clientHeight;
    return px > 0 ? px / zoom() : 0;
  }
  /** One write per changed value: an idle update must leave the DOM alone. */
  function setVar(name: string, value: string): void {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
  }
  function setData(name: string, value: string): void {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  return {
    element,
    update(rows, radiusM, now) {
      const head = nearbyHead(i18n, radiusM);
      if (head !== headText) {
        heading.innerHTML = headMarkup(head);
        headText = head;
      }
      const design = typeof deps.designHeightPx === 'function' ? deps.designHeightPx() : deps.designHeightPx;
      const unbounded = design === Number.POSITIVE_INFINITY;
      const available = unbounded ? design : measureHeight() || design;
      const budget = rowBudget(available, rows.length);
      const shownRows = fitRows(rows, budget.rows);
      const stacked = unbounded || budget.rowPx >= STACK_MIN_PX;
      setVar('--k-nearby-row', `${budget.rowPx}px`);
      setVar('--k-nearby-scale', unbounded ? '1' : String(Math.round(typeScale(budget.rowPx) * 1000) / 1000));
      setData('data-lines', stacked ? '2' : '1');

      const next = document.createElement('ol');
      next.innerHTML = rowsMarkup(shownRows, now, i18n);
      const live = new Map<string, Element>();
      for (const li of list.children) live.set(li.getAttribute('data-key') ?? '', li);
      const wanted = new Set<string>();
      for (const li of next.children) {
        const key = li.getAttribute('data-key') ?? '';
        wanted.add(key);
        // A row still fading in keeps its data-enter, or the morph would cut the fade short.
        if (live.get(key)?.hasAttribute('data-enter')) li.setAttribute('data-enter', '1');
      }
      // The rows that left go first, so the ones that stay are matched in place, not moved one by one.
      for (const [key, li] of live) if (!wanted.has(key)) li.remove();
      reconcile(list, next);

      if (painted && !deps.reduced) {
        const entered: Element[] = [];
        for (const li of list.children) {
          if (!live.has(li.getAttribute('data-key') ?? '')) {
            li.setAttribute('data-enter', '1');
            entered.push(li);
          }
        }
        if (entered.length > 0) {
          const timer = setTimeout(() => {
            timers.delete(timer);
            for (const li of entered) clearEnter(li);
          }, ENTER_CLEAR_MS);
          timers.add(timer);
        }
      }
      painted = true;
      count = shownRows.length;
    },
    measureHeight,
    shown: () => count,
    destroy() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      list.removeEventListener('animationend', onAnimationEnd);
      element.remove();
    },
  };
}
