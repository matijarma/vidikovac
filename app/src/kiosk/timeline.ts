// The wall's "U blizini" list (docs/companion-2026-09-22.md §11, §12, principle
// 7): the rows app/src/city/nearby.ts selects, drawn beside the map over the
// QR card. The component owns only the drawing; the controller (kiosk.ts)
// owns every clock and cache and calls update() on each paint, at least once
// a minute so a countdown stays true.
//
// Calm motion [O-24], [O-33]: rows are reconciled by id (ui/dom/reconcile.ts,
// keyed on data-key), so a row that stays keeps its node and only a changed
// text node is touched. Rows enter at the bottom and leave at the top: a new
// row is appended below the others and fades in once (never on the first
// paint, never under reduced motion), then settles into its time position on
// the next update; a row whose moment has passed leaves from the top. A row
// that stops being true elsewhere in the list (a cancelled event) leaves
// where it stands, because keeping it would show something false. The
// mutation budget counts structure: an idle update writes nothing, an idle
// minute at most two childList/attribute changes; the text of a <time> that
// counts down is content and changes as often as it is true.
//
// Whole rows, whole words: nothing on the wall is cut with an ellipsis or
// clipped (principles 4 and 5). Titles and subs wrap; a row takes the height
// its words need, never less than the row budget's 64 to 92 px. Content
// selection makes it fit: a title that takes more than one line, or a sub
// more than two, is replaced by the row's shorter complete label when the
// selection layer supplies one (titleShort, subShort); when the list still
// overflows its box, every label that takes more than one line gives way to
// its short one, then whole rows are dropped, the latest timed rows first, then
// departures beyond the first. One "uvijek" row is reserved. The fit is measured once
// per change of content or box and remembered, so a steady wall does not
// re-measure or re-insert anything.
//
// Honesty by selection, not by caption (principle 5): a tracked departure is
// a blue countdown ("za 4 min") or a blue clock past the countdown horizon, a
// timetable departure a grey clock; no word says which. The probe contract
// (§15.6) is the markup: section[data-testid=nearby] > nearby-head +
// ol[data-testid=nearby-rows] > li.nearby-row[data-id][data-kind]
// [data-when|data-always][data-live][data-source] with .nearby-when (<time>),
// .nearby-title and .nearby-sub (present, and empty when the row has none);
// data-key duplicates data-id for reconcile.ts.
import type { ArrivalRow } from '../../../shared/city/arrivals';
import { nearbyHead, rowBudget, type NearbyRow } from '../city/nearby';
import type { I18n } from '../i18n/i18n';
import { escapeAttribute as a, escapeHtml as e } from '../ui/dom/escape';
import { reconcile } from '../ui/dom/reconcile';
import { kindOfRoute } from './exceptions';
import { clock, dayKey, dayMonth } from './format';
import { kBadge } from './markup';

/**
 * A row as the timeline reads it: the S5 NearbyRow, whose departure rows
 * carry their `arrival` (the line badge leads the title), plus two optional
 * shorter labels the selection layer may offer. A short label is complete in
 * itself ("Gradska štedionica" for "Zgrada nekadašnje Gradske štedionice"),
 * never a cut; the wall prints it only when the full one does not fit.
 */
export type TimelineRow = NearbyRow & {
  arrival?: Pick<ArrivalRow, 'routeId' | 'routeName'>;
  titleShort?: string;
  subShort?: string;
};

/** What the fit reads from the layout; the DOM by default, a fake in tests (happy-dom lays nothing out). */
export interface TimelineMeasure {
  /** The list box in CSS px, and whether its rows run past it. */
  box(list: HTMLElement): { height: number; width: number; overflow: boolean };
  /** How many lines an element's text takes; 0 before layout or when it is empty. */
  lines(el: HTMLElement): number;
}

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
  /** Test seam: the layout the fit reads. */
  measure?: TimelineMeasure;
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
/** A row's type grows from this height up to 92 px (never below the tier floors). */
export const GROW_FROM_PX = 80;
/** How much the type grows by 92 px. */
export const TYPE_GROWTH = 0.1;
/** The longest a full label may run before its short one is printed instead. */
export const TITLE_MAX_LINES = 1;
export const SUB_MAX_LINES = 2;
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

/**
 * The row to drop when the rows do not fit, or null: the latest timed row
 * that is not a departure, then the latest departure while more than one
 * is left. Keep one timeless row as well (owner decision 10).
 */
export function dropCandidate<T extends NearbyRow>(rows: readonly T[]): T | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    if (!isTimeless(row) && row.kind !== 'departure') return row;
  }
  const departures = rows.filter((row) => row.kind === 'departure');
  if (departures.length > 1) return departures[departures.length - 1]!;
  const timeless = rows.filter(isTimeless);
  return timeless.length > 1 ? timeless[timeless.length - 1]! : null;
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

/** Which of a row's labels print short (only where the row offers a short one). */
export interface ShortLabels { title?: boolean; sub?: boolean }

const titleOf = (row: TimelineRow, short?: ShortLabels): string => (short?.title && row.titleShort ? row.titleShort : row.title);
const subOf = (row: TimelineRow, short?: ShortLabels): string => (short?.sub && row.subShort !== undefined ? row.subShort : row.sub);

/** One row's markup: time cell (the time, the day word under it), the spine mark, title and sub (always present, empty when there is none). */
export function rowMarkup(row: TimelineRow, now: number, i18n: I18n, short?: ShortLabels): string {
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
  return `<li ${attrs}><span class="k-nearby-at">${when}${day ? `<span class="k-nearby-day">${e(day)}</span>` : ''}</span>`
    + `<span class="k-nearby-mark" aria-hidden="true"></span>`
    + `<span class="k-nearby-text"><span class="nearby-title">${badge}${e(titleOf(row, short))}</span><span class="nearby-sub">${e(subOf(row, short))}</span></span></li>`;
}

/** The rows' markup in order; the phone (WP4) can draw the same list with its own sheet. */
export function rowsMarkup(rows: readonly TimelineRow[], now: number, i18n: I18n, short?: ReadonlyMap<string, ShortLabels>): string {
  return rows.map((row) => rowMarkup(row, now, i18n, short?.get(row.id))).join('');
}

/** How a row's type grows with its height: 1 up to GROW_FROM_PX, 1 + TYPE_GROWTH at 92 px. */
export function typeScale(rowPx: number): number {
  if (rowPx <= GROW_FROM_PX) return 1;
  return 1 + (TYPE_GROWTH * (Math.min(rowPx, ROW_MAX) - GROW_FROM_PX)) / (ROW_MAX - GROW_FROM_PX);
}

/** "U blizini" and " · 2 km · ~15 min" as two spans, so the head's text is nearbyHead's exactly. */
function headMarkup(head: string): string {
  const cut = head.indexOf(' · ');
  if (cut === -1) return `<span class="k-nearby-heading-title">${e(head)}</span>`;
  return `<span class="k-nearby-heading-title">${e(head.slice(0, cut))}</span><span class="k-nearby-heading-pill">${e(head.slice(cut))}</span>`;
}

/** The layout as a browser lays it out: the list's box, and a text's lines from its height over its line height. */
export const DOM_MEASURE: TimelineMeasure = {
  box(list) {
    return { height: list.clientHeight, width: list.clientWidth, overflow: list.scrollHeight > list.clientHeight + 1 };
  },
  lines(el) {
    const height = el.offsetHeight;
    if (!(height > 0)) return 0;
    const style = getComputedStyle(el);
    let line = Number.parseFloat(style.lineHeight);
    if (!(line > 0)) line = Number.parseFloat(style.fontSize) * 1.15;
    return line > 0 ? Math.round(height / line) : 1;
  },
};

/** Everything a fit depends on except the ticking time words: when it is unchanged, so is the fit. */
function fitSignature(rows: readonly TimelineRow[], now: number, i18n: I18n, rowPx: number, box: { height: number; width: number }): string {
  const parts = rows.map((r) => [r.id, r.kind, r.title, r.titleShort ?? '', r.sub, r.subShort ?? '', r.arrival?.routeName ?? '', dayLabel(r, now, i18n)].join('\u0001'));
  return `${parts.join('\u0002')}|${rowPx}|${box.height}|${box.width}`;
}

export function mountTimeline(host: HTMLElement, deps: TimelineDeps): TimelineHandle {
  const { i18n } = deps;
  const measure = deps.measure ?? DOM_MEASURE;
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
  let last: [readonly TimelineRow[], number, number] | null = null;
  /** The last fit: for which content and box, which rows it kept and which labels it shortened. */
  let memo: { sig: string; ids: ReadonlySet<string>; short: ReadonlyMap<string, ShortLabels> } | null = null;
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
    const px = measure.box(list).height;
    return px > 0 ? px / zoom() : 0;
  }
  /** One write per changed value: an idle update must leave the DOM alone. */
  function setVar(name: string, value: string): void {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
  }

  /**
   * Reconciles the list to `shown`: the rows that were there before this
   * update in their time order, then the new ones appended below them (they
   * settle into place on the next update). Departed rows go first, so the
   * rows that stay are matched in place, not moved one by one.
   */
  function paint(shown: readonly TimelineRow[], short: ReadonlyMap<string, ShortLabels>, before: ReadonlySet<string>, now: number): void {
    const settled = painted ? shown.filter((row) => before.has(row.id)) : [...shown];
    const arriving = painted ? shown.filter((row) => !before.has(row.id)) : [];
    const next = document.createElement('ol');
    next.innerHTML = rowsMarkup([...settled, ...arriving], now, i18n, short);
    const live = new Map<string, Element>();
    for (const li of list.children) live.set(li.getAttribute('data-key') ?? '', li);
    const wanted = new Set<string>();
    for (const li of next.children) {
      const key = li.getAttribute('data-key') ?? '';
      wanted.add(key);
      // A row still fading in keeps its data-enter, or the morph would cut the fade short.
      if (live.get(key)?.hasAttribute('data-enter')) li.setAttribute('data-enter', '1');
    }
    for (const [key, li] of live) if (!wanted.has(key)) li.remove();
    reconcile(list, next);
  }

  /** Shortens the labels that run long, then the rest while the rows overflow, then drops whole rows until they fit. */
  function fit(candidates: readonly TimelineRow[], before: ReadonlySet<string>, now: number): { shown: TimelineRow[]; short: Map<string, ShortLabels> } {
    let shown = [...candidates];
    const short = new Map<string, ShortLabels>();
    const byId = new Map(shown.map((row) => [row.id, row] as const));
    const set = (row: TimelineRow, which: keyof ShortLabels): boolean => {
      const offered = which === 'title' ? row.titleShort : row.subShort;
      if (offered === undefined || offered === (which === 'title' ? row.title : row.sub) || short.get(row.id)?.[which]) return false;
      short.set(row.id, { ...short.get(row.id), [which]: true });
      return true;
    };
    paint(shown, short, before, now);
    let changed = false;
    for (const li of list.children) {
      const row = byId.get(li.getAttribute('data-key') ?? '');
      if (!row) continue;
      const title = li.querySelector<HTMLElement>('.nearby-title');
      const sub = li.querySelector<HTMLElement>('.nearby-sub');
      if (title && measure.lines(title) > TITLE_MAX_LINES) changed = set(row, 'title') || changed;
      if (sub && measure.lines(sub) > SUB_MAX_LINES) changed = set(row, 'sub') || changed;
    }
    if (changed) paint(shown, short, before, now);
    if (measure.box(list).overflow) {
      // Still too tall: every label that takes more than one line gives way to its short twin, where that saves a line.
      let more = false;
      for (const li of list.children) {
        const row = byId.get(li.getAttribute('data-key') ?? '');
        if (!row) continue;
        const title = li.querySelector<HTMLElement>('.nearby-title');
        const sub = li.querySelector<HTMLElement>('.nearby-sub');
        if (title && measure.lines(title) > 1) more = set(row, 'title') || more;
        if (sub && measure.lines(sub) > 1) more = set(row, 'sub') || more;
      }
      if (more) paint(shown, short, before, now);
    }
    while (measure.box(list).overflow) {
      const drop = dropCandidate(shown);
      if (!drop) break;
      shown = shown.filter((row) => row !== drop);
      paint(shown, short, before, now);
    }
    return { shown, short };
  }

  const handle: TimelineHandle = {
    element,
    update(rows, radiusM, now) {
      last = [rows, radiusM, now];
      const head = nearbyHead(i18n, radiusM);
      if (head !== headText) {
        heading.innerHTML = headMarkup(head);
        headText = head;
      }
      const design = typeof deps.designHeightPx === 'function' ? deps.designHeightPx() : deps.designHeightPx;
      const unbounded = design === Number.POSITIVE_INFINITY;
      const box = unbounded ? { height: 0, width: 0, overflow: false } : measure.box(list);
      const available = unbounded ? design : box.height > 0 ? box.height / zoom() : design;
      const budget = rowBudget(available, rows.length);
      const candidates = fitRows(rows, budget.rows);
      setVar('--k-nearby-row', `${budget.rowPx}px`);
      setVar('--k-nearby-scale', unbounded ? '1' : String(Math.round(typeScale(budget.rowPx) * 1000) / 1000));

      const before = new Set<string>();
      for (const li of list.children) before.add(li.getAttribute('data-key') ?? '');
      let shown: TimelineRow[] = candidates;
      if (unbounded) {
        paint(shown, new Map(), before, now);
      } else {
        const sig = fitSignature(candidates, now, i18n, budget.rowPx, box);
        if (memo && memo.sig === sig) {
          const kept = memo.ids;
          shown = candidates.filter((row) => kept.has(row.id));
          paint(shown, memo.short, before, now);
        }
        // A new content or box is fitted afresh, and so is a remembered fit the words no longer keep inside the box.
        if (!memo || memo.sig !== sig || measure.box(list).overflow) {
          const fitted = fit(candidates, before, now);
          shown = fitted.shown;
          memo = { sig, ids: new Set(shown.map((row) => row.id)), short: fitted.short };
        }
      }

      if (painted && !deps.reduced) {
        const entered: Element[] = [];
        for (const li of list.children) {
          if (!before.has(li.getAttribute('data-key') ?? '')) {
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
      count = shown.length;
    },
    measureHeight,
    shown: () => count,
    destroy() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      list.removeEventListener('animationend', onAnimationEnd);
      resize?.disconnect();
      fonts?.removeEventListener('loadingdone', refit);
      last = null;
      element.remove();
    },
  };

  // The fit is only as good as the layout it read: a resized box or a web font
  // that arrives after the first paint fits the last rows again.
  const refit = (): void => {
    memo = null;
    if (last) handle.update(...last);
  };
  const resize = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => { if (last && memo && !memo.sig.endsWith(`|${measure.box(list).height}|${measure.box(list).width}`)) refit(); })
    : null;
  resize?.observe(list);
  const fonts = (document as Document & { fonts?: EventTarget }).fonts ?? null;
  fonts?.addEventListener?.('loadingdone', refit);
  return handle;
}
