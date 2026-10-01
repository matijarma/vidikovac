// The wall's "U blizini" list (docs/companion-2026-09-22.md §11, §12, principle
// 7): the rows app/src/city/nearby.ts selects, drawn beside the map over the
// QR card. The component owns only the drawing; the controller (kiosk.ts)
// owns every clock and cache and calls update() on each paint, at least once
// a minute so a countdown stays true.
//
// Calm motion [O-24], [O-33]: rows are reconciled by id (ui/dom/reconcile.ts,
// keyed on data-key), so a row that stays keeps its node and only a changed
// text node is touched. Rows leave at the top and enter at the bottom of
// their block: a departure whose moment has passed is removed, and the next
// one is inserted once, at its time position under the departures that stay
// (a new timed row lands above "uvijek"), where it fades in once (never on
// the first paint, never under reduced motion). On the wall's compositions the
// departures stand as one line of up to three cells (R1, groupDepartures): the
// line keeps its node, and a departure leaves and enters as a cell, reconciled
// the same way one level down (a cell leaving, a cell entering: two records).
// Two or more departing cells use an atomic replacement (reveal run decision 3):
// the sole possible survivor keeps its exact node, briefly detached in that step.
// Nothing is appended elsewhere
// and moved later: a node move is two childList records to a MutationObserver
// (removed, then added), so the D2 recorder (e2e/wall.ts CALM_MOTION_*) would
// read one entering row as three. A row that stops being true elsewhere in
// the list (a cancelled event) leaves where it stands, because keeping it
// would show something false. The mutation budget counts structure: an idle
// update writes nothing, an idle minute at most two childList records (one
// row leaving, one entering); the text of a <time> that counts down is
// content and changes as often as it is true. On a beat that carries a
// reveal (R2, shared/kiosk/takt.ts; the view the controller passes to
// update) the list swaps at most two rows for two it had no room for (four
// records: two leaving, two entering at their time positions), or the line
// shows the next three departures in its cells in place under "zatim" (the
// atomic replacement, one record); on the next beat the rows and cells return
// the same way, on the very nodes that left (kept aside for the beat, so no
// staying row is ever re-created), and only a reveal's rows slide in (the
// fade with a rise of one row, data-slide); a reduced wall cuts. The beat's
// budget is six records (e2e/wall.ts REVEAL_MUTATIONS_MAX), the idle
// minute's two hold everywhere else.
//
// Whole rows, whole words: nothing on the wall is cut with an ellipsis or
// clipped (principles 4 and 5). Titles and subs wrap; a row takes the height
// its words need, never less than the row budget's 64 to 92 px. Content
// selection makes it fit: a title that takes more than one line, or a sub
// more than two, is replaced by the row's shorter complete label when the
// selection layer supplies one (titleShort, subShort), and a label without one
// wraps whole; when the list still overflows its box, every label that takes
// more than one line gives way to its short one, then whole rows are dropped:
// a later day's rows first, then the row of the lowest value (shared/kiosk/takt.ts,
// brief §5.2(a): its kind's base value times how near its moment is). First/last
// trams, the ZET notice, the first departure (on an ungrouped list, a handheld's),
// one "uvijek" row and the departures line are reserved (decision 27, R1): the
// line is one row of the budget and never gives up a cell for room; its cells
// print their destinations where they fit whole on one line (cells 2 and 3
// leave theirs out first) and, in a box too narrow for "za 10 min", their
// countdowns as clock times, decided once per box. The fit is measured once
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
// data-key duplicates data-id for reconcile.ts. The departures line (R1) is
// li.nearby-row[data-id=departures][data-kind=departures][data-cells=N]
// [data-when][data-live][data-source] holding span.k-dep-cell[data-id]
// [data-cell=1..3][data-when][data-live][data-route][data-source]
// [data-headsign=0 when it prints none] with .k-line-badge, time.nearby-when
// and .k-dep-headsign (present, and empty when left out); a cell carries no
// data-kind, so no [data-kind=departure] probe ever matches one.
import type { ArrivalRow } from '../../../shared/city/arrivals';
import { CLOCK_RANGE_TAIL, MAX_DEPARTURES, nearbyHead, rowBudget, type NearbyKind, type NearbyRow, ROW_MIN_PX } from '../city/nearby';
import { candidateValue, PAGE_MAX_ROWS, REVEAL_EXEMPT_KINDS, REVEAL_IMMINENT_MS, type TaktCandidate, type TaktKind, type TaktReveal } from '../../../shared/kiosk/takt';
import type { I18n } from '../i18n/i18n';
import { escapeAttribute as a, escapeHtml as e } from '../ui/dom/escape';
import { morph, reconcile } from '../ui/dom/reconcile';
import { kindOfRoute } from './exceptions';
import { clock, dayKey, dayMonth } from './format';
import { kBadge } from './markup';
import type { ExternalTextKind } from '../../../shared/kiosk/external-text';
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';
import { optionalExternal } from './external';

/**
 * A row as the timeline reads it: the S5 NearbyRow, whose departure rows
 * carry their `arrival` (the line badge leads the title), and whose
 * `titleShort` / `subShort` are the shorter complete labels the selection
 * layer offers from the source's own words (an event's own title where a
 * machine brief stands in for it, the stop's shorter name, the venue without
 * the tram to it), never a cut; the wall prints one only when the full label
 * does not fit, and wraps the full one where none is offered.
 */
export type TimelineRow = NearbyRow & {
  arrival?: Pick<ArrivalRow, 'routeId' | 'routeName'>;
};

/** The wall's one departures row (docs/reveal-2026-10-plan/R1.md; brief §5.2 (c)). */
export interface DeparturesLine { kind: 'departures'; id: 'departures'; cells: readonly NearbyRow[]; atMs: number; always: false; live: boolean; }
export type WallRow = NearbyRow | DeparturesLine;
export const DEPARTURES_LINE_ID = 'departures';
export function isDeparturesLine(row: WallRow): row is DeparturesLine { return row.kind === 'departures'; }
/** The first contiguous run of departure rows as one line of at most MAX_DEPARTURES cells; no departure, no line. */
export function groupDepartures(rows: readonly NearbyRow[]): WallRow[] {
  const start = rows.findIndex((row) => row.kind === 'departure');
  if (start === -1) return [...rows];
  let end = start;
  while (end < rows.length && rows[end]!.kind === 'departure') end++;
  // selectNearby never gives more than MAX_DEPARTURES; the slice is a guard. A departure after another kind (never
  // produced today) stays a row, and the trains the policy puts first (railFirst) stay above the line.
  const cells = rows.slice(start, end).slice(0, MAX_DEPARTURES);
  const line: DeparturesLine = { kind: 'departures', id: 'departures', cells, atMs: cells[0]!.atMs!, always: false, live: cells.some((c) => c.live) };
  return [...rows.slice(0, start), line, ...rows.slice(end)];
}

/** What the fit reads from the layout; the DOM by default, a fake in tests (happy-dom lays nothing out). */
export interface TimelineMeasure {
  /** The list box in CSS px, and whether its rows run past it; read too for a departures cell (its time runs past it)
   *  and a cell's headsign (a word longer than its room). */
  box(list: HTMLElement): { height: number; width: number; overflow: boolean };
  /** How many lines an element's text takes; 0 before layout or when it is empty. */
  lines(el: HTMLElement): number;
  /** A row's laid-out height in CSS px (the advance's line against the painted line, R2); the DOM's offsetHeight. */
  height?(li: HTMLElement): number;
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
  /** Draw the departures as one line (the wall's three compositions); false keeps one row per departure (a handheld).
   *  Read on every update; omitted, the line is drawn exactly when the design height is finite. */
  departuresLine?: () => boolean;
  /** Test seam: the layout the fit reads. */
  measure?: TimelineMeasure;
}

/** What the beat scheduler decided for this paint (R2): the reveal on, and the rows an advance draws in the line. */
export interface TimelineView {
  /** The beat's reveal (takt), or null when none is on. */
  reveal: TaktReveal | null;
  /** The rows an advance draws in the line (nextDepartures, seam (d)); [] otherwise. */
  next: readonly TimelineRow[];
}

export interface TimelineHandle {
  element: HTMLElement;
  /** Draws `rows` (selectNearby's order) under the head for the measured circle, timed against `now`; `view` (R2) is
   *  the beat's reveal to draw over them, none when absent. */
  update(rows: readonly TimelineRow[], radiusM: number, now: number, view?: TimelineView): void;
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
/** An event title with no shorter form is cut at this many lines on the wall (kiosk-city.css line-clamp, U0 step 7):
 *  the source offers no short form, and on 29 September a nine-line title cost the wall four rows. The phone's list is not clamped. */
export const EVENT_TITLE_MAX_LINES = 2;
export const SUB_MAX_LINES = 2;
/** A closure's sub-line on the wall is one line or none (decision 66): past this it prints its twin, and a twin that
 *  still wraps is left out, never a taller row. Release smoke run 5: the feed's summary under every closure wrapped
 *  at 1920 x 1080 (a 116 px row for 66) and the fit took the second and third departures to keep the closures. */
export const CLOSURE_SUB_MAX_LINES = 1;
/** A ZET notice's title is two lines at most (upgrade U1; the second exception, beside the event title, to "nothing is
 *  cut with an ellipsis"): it is ZET's own headline with no shorter form, and a third line would cost the list a
 *  departure. The stylesheet clamps it (kiosk-city.css); the notice row is reserved (reservedRows). */
export const NOTICE_TITLE_MAX_LINES = 2;
const titleMaxLines = (row: NearbyRow): number => (row.kind === 'notice' ? NOTICE_TITLE_MAX_LINES : TITLE_MAX_LINES);
/** A notice's sub is a closure's rule: one line or none, so the wall shows the title and the phone and the touch detail the summary. */
const subMaxLines = (row: NearbyRow): number => (row.kind === 'closure' || row.kind === 'notice' ? CLOSURE_SUB_MAX_LINES : SUB_MAX_LINES);
/** The entrance fade (kiosk-city.css k-nearby-in) and the moment data-enter is cleared if no animationend came. A row
 *  entering at a reveal's edge (R2) slides too (data-slide, kiosk-city.css k-nearby-slide) under the same ENTER_MS. */
export const ENTER_MS = 220;
export const ENTER_CLEAR_MS = 260;
/** The key of the advanced line's "zatim" label (R2); never a row or a cell, so no probe counts it. */
export const THEN_KEY = 'then';
/**
 * A discretionary row the measured fit dropped comes back only after the list has fitted with it for this long
 * without a break. A list at the edge of its box (D5.16 observer: seven candidates in 483 px, the seventh fitting
 * only while the third departure had a one-line title) otherwise drops and restores the same row on every change
 * of the departures, two records and a re-created node each time. Drops stay immediate: nothing is ever cut.
 */
export const FIT_RESTORE_HOLD_MS = 60_000;

const ROW_MAX = 92;
/** Decision 67's bound; the value order (shared/kiosk/takt.ts) subsumes it. */
export const IMMINENT_ROW_MIN = 60;

/** A row with no moment: the "uvijek" row, the pharmacy at night. */
export function isTimeless(row: Valued): boolean {
  return row.always || row.atMs === null || !Number.isFinite(row.atMs);
}

/** A row as the value order reads it: structural, so a row of any wall type with a takt kind is one. */
type Valued = Pick<NearbyRow, 'id' | 'atMs' | 'always'> & { kind: TaktKind; untilMs?: number; detail?: NearbyRow['detail'] };

/** A row this close to its moment (or under way) is imminent: the scheduler's own number (shared/kiosk/takt.ts, R2). */
const IMMINENT_MS = REVEAL_IMMINENT_MS;

/** Each row as a takt candidate (shared/kiosk/takt.ts, brief §5.2(a)): reserved are the first and last trams, the ZET
 *  notice, a departures line, the first timeless row and the first departure; a fact under way (a closure, a road
 *  state, a cut under way, a place or an exhibition open now) stands by its end, a timeless row by nothing. */
export function rowCandidates<T extends Valued>(rows: readonly T[], now: number): Map<T, TaktCandidate> {
  const reserved = new Set<T>(rows.filter((row) => row.kind === 'first' || row.kind === 'last' || row.kind === 'notice' || row.kind === 'departures'));
  const timeless = rows.find(isTimeless);
  if (timeless) reserved.add(timeless);
  const departure = rows.find((row) => row.kind === 'departure');
  if (departure) reserved.add(departure);
  const out = new Map<T, TaktCandidate>();
  for (const row of rows) {
    let atMs: number | undefined;
    let untilMs: number | undefined;
    if (isTimeless(row)) {
      atMs = undefined;
      untilMs = undefined;
    } else if (row.kind === 'closure' || row.kind === 'road' || cutUnderWay(row) || openNow(row)) {
      untilMs = row.atMs!;
    } else {
      atMs = row.atMs!;
      untilMs = row.untilMs;
    }
    const moment = atMs ?? untilMs;
    out.set(row, {
      id: row.id,
      kind: row.kind,
      ...(atMs !== undefined ? { atMs } : {}),
      ...(untilMs !== undefined ? { untilMs } : {}),
      reserved: reserved.has(row),
      imminent: moment !== undefined && moment <= now + IMMINENT_MS,
    });
  }
  return out;
}

/**
 * The scheduler's candidates (shared/kiosk/takt.ts takt(), reveal pass R2; docs/reveal-2026-10-plan/R2.md §0.2): every
 * row of the wall through R0's mapper (rowCandidates: its id, kind, moment and imminence as the value order reads
 * them), with every stray departure row reserved beside the line, the notice, the first and last trams and the first
 * timeless row; then the next departures (city/nearby.ts nextDepartures, seam (d)) as `next-departures` candidates,
 * in their order, only where the line exists and they are at least as many as its cells (an advance never shows
 * fewer departures than the line). Pure.
 */
export function taktCandidates(rows: readonly WallRow[], next: readonly NearbyRow[], now: number): TaktCandidate[] {
  const mapped = rowCandidates(rows, now);
  const out = rows.map((row) => {
    const candidate = mapped.get(row)!;
    return row.kind === 'departure' && !candidate.reserved ? { ...candidate, reserved: true } : candidate;
  });
  const line = rows.find(isDeparturesLine);
  if (line && next.length >= line.cells.length) {
    for (const row of next) {
      out.push({ id: row.id, kind: 'next-departures', ...(row.atMs !== null && Number.isFinite(row.atMs) ? { atMs: row.atMs } : {}), reserved: false, imminent: false });
    }
  }
  return out;
}

/** A cut under way stands at its end (city/nearby.ts cutRows): it is now, not the day its end falls on. */
function cutUnderWay(row: Valued): boolean {
  return row.kind === 'cut' && row.untilMs !== undefined && row.atMs === row.untilMs;
}

/** A place open now, or an exhibition whose venue is open now: the row stands at its closing time. */
function openNow(row: Valued): boolean {
  return row.kind === 'open' || (row.kind === 'opening' && row.detail?.kind === 'exhibit' && row.detail.openNow);
}

/** A row about now, whatever day its time falls on: a train (a departure), a road state and a cut under way (their
 *  moment is their end, as a closure's), a place or an exhibition open now (its closing time). */
function aboutNow(row: NearbyRow): boolean {
  return row.kind === 'rail' || row.kind === 'road' || openNow(row) || cutUnderWay(row);
}

/** Decision 27: these rows are promises, not overflow candidates; and the departures line (R1), which holds the
 *  wall's one to three departures and never yields a cell for room. */
function reservedRows<T extends WallRow>(rows: readonly T[]): Set<T> {
  const keep = new Set(rows.filter(row => row.kind === 'first' || row.kind === 'last' || row.kind === 'notice'));
  const timeless = rows.find(isTimeless);
  if (timeless) keep.add(timeless);
  const line = rows.find(isDeparturesLine);
  if (line) keep.add(line);
  return keep;
}

/**
 * The rows the estimate keeps, in their order: the reserved rows (rowCandidates; the first departure only when
 * `n > 0`), then the most valuable (byValue) up to `n`. The initial estimate cannot remove the promises; the hidden
 * measurement pass makes other whole rows yield.
 */
export function fitRows<T extends WallRow>(rows: readonly T[], n: number, now?: number): T[] {
  if (rows.length <= n) return [...rows];
  const candidates = rowCandidates(rows, now ?? Number.NaN);
  const departure = rows.find((row) => row.kind === 'departure');
  const keep = new Set(rows.filter((row) => candidates.get(row)!.reserved && (row !== departure || n > 0)));
  for (const row of byValue(rows, now)) {
    if (keep.size >= n) break;
    keep.add(row);
  }
  return rows.filter((row) => keep.has(row));
}

/**
 * A timed row whose moment lies on a later Zagreb day than `now`: an opening or an event tomorrow, tomorrow's
 * sunrise. A closure is never later (its moment is its end, and the street is closed now), the first and last
 * trams are promises (decision 27), and a departure is the wall's first answer.
 */
export function onLaterDay(row: WallRow, now: number): boolean {
  if (row.kind === 'departures' || isTimeless(row) || row.kind === 'departure' || row.kind === 'notice' || row.kind === 'closure' || row.kind === 'first' || row.kind === 'last' || aboutNow(row)) return false;
  return daysAhead(row.atMs!, now) >= 1;
}

/**
 * The row to drop when the rows do not fit, or null. Tomorrow before today (round 1, 24 Sep): the latest row for a
 * later day (onLaterDay) goes first, because at 20:35 the live wall showed one tram and two museums opening at 08:00
 * tomorrow while §11 lists the departures first and tomorrow's openings last. Then the value order (brief §5.2(a),
 * docs/reveal-2026-10-plan/R0.md §0.5 item 1): among the rows that are not reserved (rowCandidates: first/last
 * trams, the ZET notice, a departures line, one timeless row and the first departure, owner decisions 10 and 27,
 * upgrade U1), the one with the lowest candidateValue (shared/kiosk/takt.ts: its kind's base value times how near its
 * moment is), a tie going to the row later in the list. Null when every row is reserved. Without `now` (older
 * callers) the later-day step is skipped and every row counts its base value.
 */
export function dropCandidate<T extends WallRow>(rows: readonly T[], now?: number): T | null {
  if (now !== undefined) {
    const later = rows.filter((row) => onLaterDay(row, now));
    if (later.length > 0) return later[later.length - 1]!;
  }
  const at = now ?? Number.NaN;
  const candidates = rowCandidates(rows, at);
  let drop: T | null = null;
  let lowest = Infinity;
  for (const row of rows) {
    const c = candidates.get(row)!;
    if (c.reserved) continue;
    const value = candidateValue(c, at, null);
    // A tie (within rounding) goes to the later row.
    if (value <= lowest + 1e-9) {
      drop = row;
      lowest = Math.min(lowest, value);
    }
  }
  return drop;
}

/**
 * `rows` from the most valuable to the least: the reserved rows first, then by value, the later-day rows last
 * (dropCandidate's order reversed). The estimate and the measured fit take the rows in this order.
 */
export function byValue<T extends WallRow>(rows: readonly T[], now?: number): T[] {
  let rest = [...rows];
  const drops: T[] = [];
  for (let drop = dropCandidate(rest, now); drop; drop = dropCandidate(rest, now)) {
    drops.push(drop);
    rest = rest.filter((row) => row !== drop);
  }
  return [...rest, ...drops.reverse()];
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
export function dayLabel(row: WallRow, now: number, i18n: I18n): string {
  if (row.kind === 'departures' || isTimeless(row) || row.kind === 'departure' || row.kind === 'notice' || row.kind === 'last' || row.kind === 'closure' || aboutNow(row)) return '';
  const days = daysAhead(row.atMs!, now);
  if (days <= 0) return '';
  if (days === 1) return i18n.t('kiosk.say.tomorrow');
  return (i18n.getLocale().startsWith('en') ? WEEKDAY_EN : WEEKDAY_HR).format(new Date(row.atMs!));
}

/**
 * The row's time as the wall prints it: "uvijek"; a tracked departure inside
 * the horizon "sada" / "za 4 min"; a closure "do 18:00", or "do 25. 9." when
 * it ends on another day, "u tijeku" when its end is a rolling placeholder;
 * everything else its Zagreb clock time.
 */
export function timeLabel(row: NearbyRow, now: number, i18n: I18n): string {
  // A notice has no moment: its publish time in the time cell would read as an event then. ZET is credited instead.
  if (row.kind === 'notice') return i18n.t('kiosk.nearby.zetSays');
  if (isTimeless(row)) return i18n.t('kiosk.nearby.always');
  const atMs = row.atMs!;
  if (row.kind === 'departure' && row.live && atMs - now <= COUNTDOWN_HORIZON_MIN * 60_000) {
    const minutes = Math.max(0, Math.round((atMs - now) / 60_000));
    return minutes === 0 ? i18n.t('arrivals.now') : i18n.t('arrivals.inMinutes', { n: minutes });
  }
  // A rolling end (shared/city/closures.ts) is no end: the street is closed, "u tijeku".
  if (row.kind === 'closure' && row.endKnown === false) return i18n.t('kiosk.nearby.ongoing');
  const until = (end: number): string => `${i18n.t('kiosk.nearby.until')} ${daysAhead(end, now) === 0 ? clock(end) : dayMonth(end)}`;
  // DHMZ's radar sees rain near Zagreb now (R3): the row's moment is the image's, so the column says "sada".
  if (row.kind === 'rain' && row.detail?.kind === 'radar') return i18n.t('arrivals.now');
  if (row.kind === 'closure' || row.kind === 'road') return until(atMs);
  // A whole-day water cut has no hours to print; a cut under way says when it ends; a place open now when it closes.
  if (row.kind === 'cut' && row.detail?.kind === 'cut' && row.detail.allDay) return i18n.t('kiosk.say.allDay');
  if (cutUnderWay(row)) return until(row.untilMs!);
  if (openNow(row)) return `${i18n.t('kiosk.nearby.until')} ${clock(atMs)}`;
  return clock(atMs);
}

/** Which of a row's labels print short (only where the row offers a short one), a sub-line left out (a closure's,
 *  decision 66), and a notice title given a third line from room that is left (lines3). */
export interface ShortLabels {
  title?: boolean; sub?: boolean; subOff?: boolean; lines3?: boolean;
  /** The line's headsigns: 'first' leaves out cells 2 and 3's, 'none' every cell's (R1). */
  headsigns?: 'first' | 'none';
  /** The line prints its countdowns as their clock times: the widest countdown does not fit a cell of this box (R1). */
  clocks?: boolean;
  /** Measurement only (fit()): every cell prints the widest countdown, arrivals.inMinutes with n = COUNTDOWN_HORIZON_MIN. */
  probe?: boolean;
}

const titleOf = (row: TimelineRow, short?: ShortLabels): string => (short?.title && row.titleShort ? row.titleShort : row.title);
const subOf = (row: TimelineRow, short?: ShortLabels): string => (short?.subOff ? '' : short?.sub && row.subShort !== undefined ? row.subShort : row.sub);

/**
 * Each field under the kind selectNearby vetted it with (app/src/city/nearby.ts),
 * never a name or an address as prose: "Petrinjska 50-52" is a house-number
 * range under `name`/`address` and phone-like under every prose kind. The
 * timeless rows are told apart by their ids ("always:heritage:…",
 * "always:story:…"); any other row keeps the prose reading.
 */
export function rowTextKinds(row: TimelineRow): { title: ExternalTextKind; sub: ExternalTextKind } {
  switch (row.kind) {
    case 'departure': return { title: 'headsign', sub: 'summary' };
    case 'notice': return { title: 'title', sub: 'summary' };
    case 'closure': return { title: 'name', sub: 'summary' };
    case 'event': return { title: 'title', sub: 'name' };
    case 'opening': return row.detail?.kind === 'exhibit' ? { title: 'title', sub: 'name' } : { title: 'name', sub: 'summary' };
    case 'pharmacy': return { title: 'title', sub: 'address' };
    case 'rail': return { title: 'headsign', sub: 'name' };
    case 'rain': return { title: 'title', sub: 'summary' };
    case 'cut': return { title: 'address', sub: 'summary' };
    case 'road': return { title: 'name', sub: 'summary' };
    case 'open': return { title: 'name', sub: 'summary' };
    case 'always':
      if (row.id.startsWith('always:heritage:')) return { title: 'name', sub: 'address' };
      if (row.id.startsWith('always:story:')) return { title: 'name', sub: 'register-text' };
      return { title: 'title', sub: 'summary' };
    default: return { title: 'title', sub: 'summary' };
  }
}

export function vettedTimelineRow(row: TimelineRow): boolean {
  const { title: kind, sub: subKind } = rowTextKinds(row);
  const sub = (value: string | undefined): boolean => {
    // Internally composed last/first boards contain several route/time pairs.
    // Validate the complete grammar and EACH external route, never mistake
    // "12 23:45" for a phone number or allow arbitrary prose under this kind.
    if ((row.kind === 'last' || row.kind === 'first') && value
      && /^(?:[A-Za-z0-9]{1,6} (?:[01]\d|2[0-3]):[0-5]\d)(?: · [A-Za-z0-9]{1,6} (?:[01]\d|2[0-3]):[0-5]\d)*$/u.test(value)) {
      return value.split(' · ').every(pair => vetExternal('headsign', pair.split(' ')[0], 'row') !== null);
    }
    // A cut's sub is our own words and our own clock range ("bez struje 08:00–14:00"): the words are read as prose,
    // the range by its grammar, never as a phone number.
    if (row.kind === 'cut' && value && CLOCK_RANGE_TAIL.test(value)) return optionalExternal(subKind, value.replace(CLOCK_RANGE_TAIL, ''));
    return optionalExternal(subKind, value);
  };
  return vetExternal(kind, row.title, 'row') !== null
    && optionalExternal(kind, row.titleShort)
    && sub(row.sub) && sub(row.subShort)
    && (!row.arrival || vetExternal('headsign', row.arrival.routeName, 'row') !== null);
}

/**
 * A departures cell's time: the probe's widest countdown while the fit measures the box; a live countdown as its
 * clock time where the box took the clock form (still blue: data-live stays); else the row's own time word. A
 * departure never carries a day word (dayLabel).
 */
function cellTime(row: NearbyRow, now: number, i18n: I18n, short?: ShortLabels): string {
  if (short?.probe) return i18n.t('arrivals.inMinutes', { n: COUNTDOWN_HORIZON_MIN });
  if (short?.clocks && row.live && row.atMs !== null && row.atMs - now <= COUNTDOWN_HORIZON_MIN * 60_000) return clock(row.atMs);
  return timeLabel(row, now, i18n);
}

/**
 * One cell of the departures line: the line badge, the time and the destination (empty, with data-headsign="0",
 * where the row has none of its own or the fit left it out). No data-kind: every probe of a departure row
 * (the stop board, the phone) selects [data-kind=departure], and the calm-motion recorder keys a node by kind|id.
 */
export function departureCellMarkup(row: TimelineRow, index: number, now: number, i18n: I18n, short?: ShortLabels): string {
  if (!vettedTimelineRow(row)) return '';
  if (isTimeless(row)) return '';
  const iso = new Date(row.atMs!).toISOString();
  const route = row.arrival?.routeName ?? '';
  const badge = route ? kBadge(route, kindOfRoute(row.arrival!.routeId)) : '';
  const left = short?.headsigns === 'none' || (short?.headsigns === 'first' && index > 0);
  const headsign = !left && row.title !== route ? row.title : '';
  const attrs = [
    'class="k-dep-cell"',
    `data-key="${a(row.id)}"`,
    `data-id="${a(row.id)}"`,
    `data-cell="${index + 1}"`,
    `data-when="${iso}"`,
    row.live ? 'data-live="1"' : '',
    route ? `data-route="${a(route)}"` : '',
    `data-source="${a(row.source)}"`,
    headsign ? '' : 'data-headsign="0"',
  ].filter(Boolean).join(' ');
  return `<span ${attrs}>${badge}<time class="nearby-when" datetime="${iso}">${e(cellTime(row, now, i18n, short))}</time><span class="k-dep-headsign">${e(headsign)}</span></span>`;
}

/** The advance drawn on the line (R2): the beat it belongs to, written as data-reveal="advance:<beat>". */
export interface LineAdvance { beat: number }

/** The departures line: one li of up to three cells in the rows' order; no cell drawn, no line. Advanced (R2), the li
 *  carries data-reveal="advance:<beat>" and the "zatim" label (kiosk.nearby.zatim) as its first child, before cell 1. */
export function departuresLineMarkup(line: DeparturesLine, now: number, i18n: I18n, short?: ShortLabels, advance?: LineAdvance): string {
  const cells: string[] = [];
  const drawn: NearbyRow[] = [];
  for (const row of line.cells) {
    const html = departureCellMarkup(row, cells.length, now, i18n, short);
    if (!html) continue;
    cells.push(html);
    drawn.push(row);
  }
  if (cells.length === 0) return '';
  const first = drawn[0]!;
  const attrs = [
    'class="nearby-row"',
    `data-id="${DEPARTURES_LINE_ID}"`,
    `data-key="${DEPARTURES_LINE_ID}"`,
    'data-kind="departures"',
    `data-cells="${cells.length}"`,
    `data-when="${new Date(first.atMs!).toISOString()}"`,
    drawn.some((row) => row.live) ? 'data-live="1"' : '',
    `data-source="${a(first.source)}"`,
    advance ? `data-reveal="advance:${advance.beat}"` : '',
  ].filter(Boolean).join(' ');
  const then = advance ? `<span class="k-dep-then" data-key="${THEN_KEY}">${e(i18n.t('kiosk.nearby.zatim'))}</span>` : '';
  return `<li ${attrs}>${then}${cells.join('')}</li>`;
}

/** One row's markup: time cell (the time, the day word under it), the spine mark, title and sub (always present, empty when there is none). */
export function rowMarkup(row: WallRow, now: number, i18n: I18n, short?: ShortLabels, advance?: LineAdvance): string {
  if (isDeparturesLine(row)) return departuresLineMarkup(row, now, i18n, short, advance);
  if (!vettedTimelineRow(row)) return '';
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
    short?.lines3 ? 'data-title-lines="3"' : '',
  ].filter(Boolean).join(' ');
  const when = timeless ? `<span class="nearby-when">${text}</span>` : `<time class="nearby-when" datetime="${iso}">${text}</time>`;
  const day = dayLabel(row, now, i18n);
  // A train's badge is never a tram's or a bus's colour, whatever its route id reads in ZET's table.
  const badge = row.arrival?.routeName ? `${kBadge(row.arrival.routeName, row.kind === 'rail' ? 'other' : kindOfRoute(row.arrival.routeId))} ` : '';
  return `<li ${attrs}><span class="k-nearby-at">${when}${day ? `<span class="k-nearby-day">${e(day)}</span>` : ''}</span>`
    + `<span class="k-nearby-mark" aria-hidden="true"></span>`
    + `<span class="k-nearby-text"><span class="nearby-title">${badge}${e(titleOf(row, short))}</span><span class="nearby-sub">${e(subOf(row, short))}</span></span></li>`;
}

/** The rows' markup in order; the phone (WP4) can draw the same list with its own sheet. */
export function rowsMarkup(rows: readonly WallRow[], now: number, i18n: I18n, short?: ReadonlyMap<string, ShortLabels>, advance?: LineAdvance): string {
  return rows.map((row) => rowMarkup(row, now, i18n, short?.get(row.id), advance)).join('');
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
    // A departures cell or its destination (R1) runs past its box only sideways: its text at line-height 1.1 overflows
    // its own line box upwards and downwards in Chromium (the glyphs' ascent), which is no overflow of the cell. The
    // accept scene of 30 September read every cell as overflowing: clock times and no destination at 1920 x 1080.
    const sideways = list.classList.contains('k-dep-cell') || list.classList.contains('k-dep-headsign');
    return { height: list.clientHeight, width: list.clientWidth,
      overflow: (!sideways && list.scrollHeight > list.clientHeight + 1) || list.scrollWidth > list.clientWidth + 1 };
  },
  height(li) {
    return li.offsetHeight;
  },
  lines(el) {
    // A block clamped by CSS (the notice title, -webkit-line-clamp) reports its whole text in scrollHeight while its
    // offsetHeight stops at the clamp; an inline span reports 0 there and keeps offsetHeight.
    const height = Math.max(el.offsetHeight, el.scrollHeight);
    if (!(height > 0)) return 0;
    const style = getComputedStyle(el);
    let line = Number.parseFloat(style.lineHeight);
    if (!(line > 0)) line = Number.parseFloat(style.fontSize) * 1.15;
    return line > 0 ? Math.round(height / line) : 1;
  },
};

/** Content, time-word widths, typography and the box: unchanged means the fit is reusable. */
function fitSignature(rows: readonly WallRow[], now: number, i18n: I18n, rowPx: number, box: { height: number; width: number }, typography: string): string {
  const parts = rows.map((r) => isDeparturesLine(r)
    ? ['departures', 'departures', ...r.cells.map((c) => [c.id, c.title, c.arrival?.routeName ?? '', c.live ? '1' : '0', timeLabel(c, now, i18n)].join('\u0003'))].join('\u0001')
    : [r.id, r.kind, r.title, r.titleShort ?? '', r.sub, r.subShort ?? '', r.arrival?.routeName ?? '', dayLabel(r, now, i18n), timeLabel(r, now, i18n)].join('\u0001'));
  return `${parts.join('\u0002')}|${rowPx}|${typography}|${box.height}|${box.width}`;
}

/** A reveal as the list drew it (R2): its kind and beat, the rows it took off the wall and the ones it put on. */
interface DrawnReveal { kind: RevealKind; beat: number; replaced: readonly string[]; revealed: readonly string[] }
type RevealKind = TaktReveal['kind'];
/** What paint needs of a reveal: the advance to write on the line, and which leaving rows and cells to keep aside. */
interface PaintReveal { advance?: LineAdvance; park: ReadonlySet<string>; parkCells: boolean }
const NO_REVEAL: PaintReveal = { park: new Set(), parkCells: false };
/** The most rows and cells kept aside at once: a page turn's two rows and their two, the line's three cells. */
const PARKED_MAX = 8;

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
  let last: [readonly TimelineRow[], number, number, TimelineView | undefined] | null = null;
  /** The last fit: for which content and box, which rows it kept and which labels it shortened. */
  let memo: { sig: string; ids: ReadonlySet<string>; short: ReadonlyMap<string, ShortLabels>; rowPx: number } | null = null;
  /** Discretionary rows the fit dropped, with the moment they have fitted again without a break since (null while they do not). */
  const heldOut = new Map<string, number | null>();
  /** The reveal drawn over the fit (R2): for which beat and fit, the rows it displays and their labels, and what it swapped. */
  let overlay: { key: string; ids: readonly string[]; short: ReadonlyMap<string, ShortLabels>; drawn: DrawnReveal | null } | null = null;
  /** The reveal the previous update drew, so its return can slide and rise. */
  let lastDrawn: DrawnReveal | null = null;
  /** Rows and cells a reveal took off the wall, by key, kept for the beat so they return on their own node (R2). */
  const parked = new Map<string, Element>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const clearEnter = (li: Element): void => {
    if (li.hasAttribute('data-enter')) li.removeAttribute('data-enter');
    if (li.hasAttribute('data-slide')) li.removeAttribute('data-slide');
  };
  const onAnimationEnd = (event: Event): void => {
    // A row, or a cell of the departures line (a new departure fades in its cell, the line stays).
    const el = event.target instanceof Element ? event.target.closest('.k-dep-cell, .nearby-row') : null;
    if (el && (el.parentElement === list || el.parentElement?.parentElement === list)) clearEnter(el);
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
   * Reconciles the list to `shown` in its time order. Departed rows go first,
   * so the rows that stay are matched where they stand, not moved one by one;
   * a row that enters is then inserted once, at its time position, and stays
   * there. One childList record per changed row is the whole budget.
   */
  function paint(shown: readonly WallRow[], short: ReadonlyMap<string, ShortLabels>, now: number, reveal: PaintReveal = NO_REVEAL): void {
    const next = document.createElement('ol');
    next.innerHTML = rowsMarkup(shown, now, i18n, short, reveal.advance);
    const live = new Map<string, Element>();
    for (const li of list.children) live.set(li.getAttribute('data-key') ?? '', li);
    const wanted = new Map<string, Element>();
    for (const li of next.children) {
      const key = li.getAttribute('data-key') ?? '';
      wanted.set(key, li);
      // A row still fading in keeps its data-enter (and its slide), or the morph would cut the fade short.
      if (live.get(key)?.hasAttribute('data-enter')) {
        li.setAttribute('data-enter', '1');
        if (live.get(key)!.hasAttribute('data-slide')) li.setAttribute('data-slide', '1');
      }
    }
    // A row a reveal takes off the wall is kept aside (R2) and comes back on its own node at the reveal's edge.
    for (const [key, li] of live) if (!wanted.has(key)) { if (reveal.park.has(key)) parked.set(key, li); li.remove(); }
    restoreParked(list, [...wanted.keys()]);
    // A single departing cell uses the keyed path. Multiple departures use the approved atomic batch below.
    const liveLine = live.get(DEPARTURES_LINE_ID);
    const nextLine = wanted.get(DEPARTURES_LINE_ID);
    if (liveLine && nextLine) {
      const liveCells = new Map<string, Element>();
      for (const cell of liveLine.children) liveCells.set(cell.getAttribute('data-key') ?? '', cell);
      const nextCells = new Set<string>();
      for (const cell of nextLine.children) {
        const key = cell.getAttribute('data-key') ?? '';
        nextCells.add(key);
        if (liveCells.get(key)?.hasAttribute('data-enter')) cell.setAttribute('data-enter', '1');
      }
      const departing = [...liveCells].filter(([key]) => !nextCells.has(key));
      const park = (key: string, cell: Element): void => { if (reveal.parkCells) parked.set(key, cell); };
      if (departing.filter(([key]) => key !== THEN_KEY).length > 1) {
        // At most one of three cells survives. Keep that exact object and trip identity; never recycle a departed
        // cell as another trip. Native replaceChildren batches the change, while a single turnover stays unchanged.
        // A cell an advance took off the line (R2) returns on its own node, morphed to its words of now.
        for (const [key, cell] of departing) park(key, cell);
        const replacement = [...nextLine.children].map((cell) => {
          const key = cell.getAttribute('data-key') ?? '';
          const survivor = liveCells.get(key);
          if (!survivor) {
            const kept = parked.get(key);
            if (!kept) return cell.cloneNode(true);
            parked.delete(key);
            return morph(kept, cell.cloneNode(true) as Element);
          }
          survivor.removeAttribute('data-enter');
          cell.removeAttribute('data-enter');
          return survivor;
        });
        liveLine.replaceChildren(...replacement);
      } else {
        for (const [key, cell] of departing) { park(key, cell); cell.remove(); }
        restoreParked(liveLine, [...nextCells]);
      }
    }
    reconcile(list, next);
  }

  /** Puts the parked nodes among `wantedKeys` back at their positions, before reconcile meets them, so no node moves. */
  function restoreParked(parent: Element, wantedKeys: readonly string[]): void {
    if (parked.size === 0) return;
    const childByKey = (key: string): Element | null => {
      for (const child of parent.children) if (child.getAttribute('data-key') === key) return child;
      return null;
    };
    for (let i = 0; i < wantedKeys.length; i++) {
      const key = wantedKeys[i]!;
      const node = parked.get(key);
      if (!node || childByKey(key)) continue;
      parked.delete(key);
      let before: Element | null = null;
      for (let j = i + 1; j < wantedKeys.length && !before; j++) before = childByKey(wantedKeys[j]!);
      parent.insertBefore(node, before);
    }
  }

  /** Shortens the labels that run long, then the rest while the rows overflow, then drops whole rows until they fit. */
  /** Fits `candidates` (the estimate's, fitRows) into the box; `pool` is the whole vetted list they were taken from, in
   *  list order, whose other rows are tried where the measured rows leave room. */
  /**
   * A detached tree has no layout. This hidden sibling inherits the same kiosk/aside styles and variables but is
   * outside the live timeline. Its list gets exactly the live content box; `fn` measures in it, and it is disposed
   * of before any paint. The fit and the reveal overlay (R2) measure here.
   */
  function withMeasuringList<T>(box: { height: number; width: number }, fn: (list: HTMLOListElement) => T): T {
    const measuring = element.cloneNode(false) as HTMLElement;
    measuring.removeAttribute('data-testid');
    measuring.removeAttribute('aria-labelledby');
    measuring.setAttribute('aria-hidden', 'true');
    measuring.inert = true;
    Object.assign(measuring.style, { position: 'fixed', visibility: 'hidden', pointerEvents: 'none', left: '0', top: '0' });
    const measuringList = list.cloneNode(false) as HTMLOListElement;
    measuringList.removeAttribute('data-testid');
    measuringList.style.boxSizing = 'border-box';
    if (box.width > 0) measuringList.style.width = `${box.width}px`;
    if (box.height > 0) measuringList.style.height = `${box.height}px`;
    measuring.appendChild(measuringList);
    element.parentElement!.appendChild(measuring);
    try {
      return fn(measuringList);
    } finally {
      measuring.remove();
    }
  }

  function fit(candidates: readonly WallRow[], pool: readonly WallRow[], now: number, box: { height: number; width: number }): { shown: WallRow[]; short: Map<string, ShortLabels>; overflow: boolean } {
    return withMeasuringList(box, fitIn);

    function fitIn(list: HTMLOListElement): { shown: WallRow[]; short: Map<string, ShortLabels>; overflow: boolean } {
      let shown = [...candidates];
      const short = new Map<string, ShortLabels>();
      const draw = (): void => { list.innerHTML = rowsMarkup(shown, now, i18n, short); };
      const byId = new Map(pool.map((row) => [row.id, row] as const));
      const set = (row: WallRow, which: 'title' | 'sub'): boolean => {
        if (isDeparturesLine(row)) return false;
        const offered = which === 'title' ? row.titleShort : row.subShort;
        if (offered === undefined || offered === (which === 'title' ? row.title : row.sub) || short.get(row.id)?.[which]) return false;
        short.set(row.id, { ...short.get(row.id), [which]: true });
        return true;
      };
      /** A closure's or a notice's sub-line left out: one line or none on the wall (CLOSURE_SUB_MAX_LINES). */
      const off = (row: WallRow): boolean => {
        if ((row.kind !== 'closure' && row.kind !== 'notice') || short.get(row.id)?.subOff) return false;
        short.set(row.id, { ...short.get(row.id), subOff: true });
        return true;
      };
      /** The closure sub-lines given up for room (not the ones that wrap): they come back where the rows that went leave it. */
      const forRoom = new Set<string>();
      draw();
      // Labels past their lines print their short twin, and a closure's sub-line that still wraps is left out.
      for (let pass = 0; pass < 3; pass++) {
        let changed = false;
        for (const li of list.children) {
          const row = byId.get(li.getAttribute('data-key') ?? '');
          if (!row || isDeparturesLine(row)) continue;
          const title = li.querySelector<HTMLElement>('.nearby-title');
          const sub = li.querySelector<HTMLElement>('.nearby-sub');
          if (title && measure.lines(title) > titleMaxLines(row)) changed = set(row, 'title') || changed;
          if (sub && measure.lines(sub) > subMaxLines(row)) changed = set(row, 'sub') || off(row) || changed;
        }
        if (!changed) break;
        draw();
      }
      // (1b) The departures line (R1), drawn for this box: first its time form, decided once per box and typography,
      // never per minute (every cell probes the widest countdown with no destination; where one does not fit its
      // cell, the box prints its countdowns as clock times, still blue); then the destinations, whole words on one
      // line: where one runs long, cells 2 and 3 leave theirs out, and where the first's still does, it goes too.
      const line = shown.find(isDeparturesLine);
      if (line) {
        const cells = (): HTMLElement[] => {
          const li = [...list.children].find((el) => el.getAttribute('data-key') === DEPARTURES_LINE_ID);
          return li ? [...li.querySelectorAll<HTMLElement>('.k-dep-cell')] : [];
        };
        const was = short.get(line.id) ?? {};
        short.set(line.id, { ...was, probe: true, headsigns: 'none' });
        draw();
        const clocks = cells().some((cell) => measure.box(cell).overflow);
        short.set(line.id, { ...was, ...(clocks ? { clocks: true } : {}) });
        draw();
        const long = (cell: HTMLElement | undefined): boolean => {
          const head = cell?.querySelector<HTMLElement>('.k-dep-headsign');
          return Boolean(head && (head.textContent ?? '') !== '' && (measure.lines(head) > 1 || measure.box(head).overflow));
        };
        if (cells().some(long)) {
          short.set(line.id, { ...short.get(line.id), headsigns: 'first' });
          draw();
          if (long(cells()[0])) {
            short.set(line.id, { ...short.get(line.id), headsigns: 'none' });
            draw();
          }
        }
      }
      if (measure.box(list).overflow) {
        // Still too tall: every label that takes more than one line gives way to its short twin, where that saves a line.
        let more = false;
        for (const li of list.children) {
          const row = byId.get(li.getAttribute('data-key') ?? '');
          if (!row || isDeparturesLine(row)) continue;
          const title = li.querySelector<HTMLElement>('.nearby-title');
          const sub = li.querySelector<HTMLElement>('.nearby-sub');
          if (title && measure.lines(title) > 1) more = set(row, 'title') || more;
          if (sub && measure.lines(sub) > 1) more = set(row, 'sub') || more;
        }
        if (more) draw();
      }
      // Still too tall: the closure sub-lines go before any row does (decision 66: the second and third departures
      // keep their place over a closure's sub-line), the last closure's first; only then do whole rows yield, in
      // dropCandidate's order as before.
      for (const row of [...shown].reverse()) {
        if (!measure.box(list).overflow) break;
        if (off(row)) { forRoom.add(row.id); draw(); }
      }
      const dropped: WallRow[] = [];
      while (shown.length > 0 && measure.box(list).overflow) {
        const reserved = reservedRows(shown);
        // The wall shows one to three departures in every reading: the first one is a promise too, so a
        // box too small for the promises reports data-fit-overflow=1 with the departure on the list rather
        // than an empty departures block (D2 full run, 1366 x 768 at night).
        const departure = shown.find(row => row.kind === 'departure');
        if (departure) reserved.add(departure);
        const drop = dropCandidate(shown, now) ?? [...shown].reverse().find(row => !reserved.has(row));
        // No more discretionary content: never silently remove a reserved row.
        if (!drop) break;
        shown = shown.filter((row) => row !== drop);
        dropped.push(drop);
        draw();
      }
      // A row that fits again after a later drop comes back in the same fit (U0 step 7): a short row dropped before a
      // tall one that went later finds its room again. The most valuable first (reverse drop order), each in its place
      // in the list and kept only while the list still fits.
      const tryIn = (row: WallRow): void => {
        const was = shown;
        shown = pool.filter((candidate) => candidate === row || was.includes(candidate));
        draw();
        if (measure.box(list).overflow) { shown = was; draw(); }
      };
      // The estimate's cap is a count of rows, not of pixels: in reduced and silent the trains the policy puts first
      // took its last two places, the measured pass dropped both (two lines of headsign over the station, 128 px each),
      // and the second departure, never a candidate, could not come back: one departure and 74 px empty in portrait
      // (production 29 Sep 23:25:58, round 1 kiosk F1). So where the drops left places under the cap, the rows the
      // estimate left out are tried with the dropped ones, the most valuable first (byValue), each kept only while the
      // list still fits and never past the estimate's count; with no place left the dropped ones return as before.
      const candidateSet = new Set(candidates);
      const leftOut = pool.filter((row) => !candidateSet.has(row));
      // Rank the whole pool before filtering: a restoration subset must not reserve its own second timeless row.
      const restore = new Set([...dropped, ...leftOut]);
      const order = leftOut.length > 0 && dropped.length > 0 ? byValue(pool, now).filter((row) => restore.has(row)) : dropped.reverse();
      for (const row of order) {
        if (!candidateSet.has(row) && shown.length >= candidates.length) continue;
        tryIn(row);
      }
      // A sub-line yields to a row, never for nothing: where the rows that went left the room, the sub-lines given
      // up for it come back, in list order, each only while the list still holds every row whole.
      for (const row of shown) {
        if (!forRoom.has(row.id)) continue;
        const was = short.get(row.id)!;
        short.set(row.id, { ...was, subOff: false });
        draw();
        if (measure.box(list).overflow) { short.set(row.id, was); draw(); }
      }
      // A notice headline still longer than its two lines, short or full as printed, takes a third line from room
      // that is left; it never costs a row or a sub-line (vis1 F2).
      for (const li of list.children) {
        const row = byId.get(li.getAttribute('data-key') ?? '');
        const title = li.querySelector<HTMLElement>('.nearby-title');
        if (!row || row.kind !== 'notice' || !title || measure.lines(title) <= NOTICE_TITLE_MAX_LINES) continue;
        const was = short.get(row.id);
        short.set(row.id, { ...was, lines3: true });
        draw();
        if (measure.box(list).overflow) {
          if (was) short.set(row.id, was); else short.delete(row.id);
          draw();
        }
        break;
      }
      return { shown, short, overflow: measure.box(list).overflow };
    }
  }

  /** The label rule of the fit's first pass for one revealed row drawn in `list`: short where the full label runs long. */
  function shortenRevealed(list: HTMLOListElement, row: NearbyRow, short: Map<string, ShortLabels>): boolean {
    const li = [...list.children].find((el) => el.getAttribute('data-key') === row.id);
    if (!li) return false;
    const title = li.querySelector<HTMLElement>('.nearby-title');
    const sub = li.querySelector<HTMLElement>('.nearby-sub');
    let changed = false;
    if (title && measure.lines(title) > titleMaxLines(row) && row.titleShort !== undefined && row.titleShort !== row.title) {
      short.set(row.id, { ...short.get(row.id), title: true });
      changed = true;
    }
    if (sub && measure.lines(sub) > subMaxLines(row)) {
      if (row.subShort !== undefined && row.subShort !== row.sub) { short.set(row.id, { ...short.get(row.id), sub: true }); changed = true; }
      else if (row.kind === 'closure' || row.kind === 'notice') { short.set(row.id, { ...short.get(row.id), subOff: true }); changed = true; }
    }
    return changed;
  }

  /**
   * A page turn over the painted rows (R2.md §0.5 item 14): the painted rows among `replaces` leave and the unpainted
   * rows among `ids` enter, pairwise, as many as the box holds whole (measured in the hidden clone, the most first).
   * Null when none fits: the list paints the fit alone.
   */
  function pageOverlay(reveal: TaktReveal, shown: readonly WallRow[], wall: readonly WallRow[], now: number, box: { height: number; width: number }, base: ReadonlyMap<string, ShortLabels>, prior: DrawnReveal | null): { display: WallRow[]; short: Map<string, ShortLabels>; drawn: DrawnReveal } | null {
    const shownIds = new Set(shown.map((row) => row.id));
    const candidates = new Map(taktCandidates(wall, [], now).map((c) => [c.id, c]));
    const movable = (id: string, replacing = false): boolean => {
      const c = candidates.get(id);
      return Boolean(c && !c.reserved && c.kind !== 'departure' && c.kind !== 'departures'
        && !REVEAL_EXEMPT_KINDS.includes(c.kind) && (!replacing || !c.imminent));
    };
    const out = [...new Set(reveal.replaces)].filter((id) => movable(id, true)).map((id) => shown.find((row) => row.id === id)).filter((row): row is WallRow => row !== undefined).slice(0, PAGE_MAX_ROWS);
    const inn = [...new Set(reveal.ids)].filter((id) => movable(id)).map((id) => wall.find((row) => row.id === id && !shownIds.has(id))).filter((row): row is NearbyRow => row !== undefined && !isDeparturesLine(row));
    // A beat's overlay keeps its rows for the whole beat (one region moves once): where the fit changed under it (a
    // label, a departure, a box that grew so it keeps a revealed row itself), the same rows are drawn as long as they
    // still fit whole, and only when they do not is the overlay found again.
    if (prior) {
      // Keep pairs, not independent sets: a cancelled incoming row gives its original row back immediately.
      const pairs = prior.revealed.map((id, i) => ({ incoming: id, outgoing: prior.replaced[i]! }))
        .filter(({ incoming, outgoing }) => movable(incoming) && movable(outgoing, true));
      if (pairs.length === 0) return null;
      const leaving = new Set(pairs.map((pair) => pair.outgoing));
      const entering = new Set(pairs.map((pair) => pair.incoming));
      const display = wall.filter((row) => (shownIds.has(row.id) && !leaving.has(row.id)) || entering.has(row.id));
      const kept = withMeasuringList(box, (list) => {
        const short = new Map<string, ShortLabels>([...base].filter(([id]) => !entering.has(id) || shownIds.has(id)));
        list.innerHTML = rowsMarkup(display, now, i18n, short);
        let changed = false;
        for (const row of wall) if (entering.has(row.id) && !shownIds.has(row.id) && !isDeparturesLine(row)) changed = shortenRevealed(list, row, short) || changed;
        if (changed) list.innerHTML = rowsMarkup(display, now, i18n, short);
        return measure.box(list).overflow ? null : { display, short, drawn: { ...prior, replaced: [...leaving], revealed: [...entering] } };
      });
      if (kept) return kept;
    }
    if (out.length === 0 || inn.length === 0) return null;
    return withMeasuringList(box, (list) => {
      // The revealed rows in their order, each kept only while the list still holds every row whole (a tall one is
      // passed over, the next tried); each takes one replaced row, in `replaces` order.
      const chosen: NearbyRow[] = [];
      let display: WallRow[] = [...shown];
      let short = new Map<string, ShortLabels>(base);
      for (const row of inn) {
        if (chosen.length >= out.length) break;
        const entering = [...chosen, row];
        const enteringIds = new Set(entering.map((r) => r.id));
        const leaving = new Set(out.slice(0, entering.length).map((r) => r.id));
        const tryDisplay = wall.filter((r) => (shownIds.has(r.id) && !leaving.has(r.id)) || enteringIds.has(r.id));
        const tryShort = new Map<string, ShortLabels>([...short].filter(([id]) => id !== row.id));
        list.innerHTML = rowsMarkup(tryDisplay, now, i18n, tryShort);
        if (shortenRevealed(list, row, tryShort)) list.innerHTML = rowsMarkup(tryDisplay, now, i18n, tryShort);
        if (measure.box(list).overflow) continue;
        chosen.push(row);
        display = tryDisplay;
        short = tryShort;
      }
      if (chosen.length === 0) return null;
      return { display, short, drawn: { kind: 'page', beat: reveal.beat, replaced: out.slice(0, chosen.length).map((r) => r.id), revealed: chosen.map((r) => r.id) } };
    });
  }

  /**
   * The advance (R2.md step 4d): the line's cells become the next departures under "zatim", drawn only where the
   * advanced line is no taller than the painted one (its destinations leave from the last cell back, R1's rule) and
   * the list still fits whole. Null otherwise: the line stays as painted this beat.
   */
  function advanceOverlay(reveal: TaktReveal, shown: readonly WallRow[], next: readonly TimelineRow[], now: number, box: { height: number; width: number }, base: ReadonlyMap<string, ShortLabels>): { display: WallRow[]; short: Map<string, ShortLabels>; drawn: DrawnReveal } | null {
    const line = shown.find(isDeparturesLine);
    const cells = next.filter((row) => reveal.ids.includes(row.id) && row.kind === 'departure' && !isTimeless(row) && vettedTimelineRow(row)).slice(0, MAX_DEPARTURES);
    if (!line || cells.length < line.cells.length || cells.length === 0 || cells[0]!.atMs === null) return null;
    const advanced: DeparturesLine = { kind: 'departures', id: DEPARTURES_LINE_ID, cells, atMs: cells[0]!.atMs!, always: false, live: cells.some((row) => row.live) };
    const display = shown.map((row) => (row === line ? advanced : row));
    const advance: LineAdvance = { beat: reveal.beat };
    return withMeasuringList(box, (list) => {
      const lineOf = (): HTMLElement | undefined => [...list.children].find((el) => el.getAttribute('data-key') === DEPARTURES_LINE_ID) as HTMLElement | undefined;
      list.innerHTML = rowsMarkup(shown, now, i18n, base);
      const rowPx = (li: HTMLElement): number => (measure.height ? measure.height(li) : 0);
      const painted = lineOf();
      const paintedPx = painted ? rowPx(painted) : 0;
      const short = new Map<string, ShortLabels>(base);
      let was = base.get(DEPARTURES_LINE_ID) ?? {};
      // "zatim" takes a column: test the countdown form in that narrower geometry too.
      short.set(DEPARTURES_LINE_ID, { ...was, headsigns: 'none', probe: true });
      list.innerHTML = rowsMarkup(display, now, i18n, short, advance);
      if ([...list.querySelectorAll<HTMLElement>('.k-dep-cell')].some((cell) => measure.box(cell).overflow)) was = { ...was, clocks: true };
      const steps: (ShortLabels['headsigns'] | undefined)[] = was.headsigns === 'none' ? ['none'] : was.headsigns === 'first' ? ['first', 'none'] : [undefined, 'first', 'none'];
      const long = (cell: Element): boolean => {
        const head = cell.querySelector<HTMLElement>('.k-dep-headsign');
        return Boolean(head && (head.textContent ?? '') !== '' && (measure.lines(head) > 1 || measure.box(head).overflow));
      };
      for (const headsigns of steps) {
        short.set(DEPARTURES_LINE_ID, { ...was, ...(headsigns ? { headsigns } : {}), probe: false });
        if (!headsigns) short.set(DEPARTURES_LINE_ID, { ...was, probe: false });
        list.innerHTML = rowsMarkup(display, now, i18n, short, advance);
        const li = lineOf();
        if (!li) return null;
        // R1's rule on the next cells first: a destination that runs long leaves (cells 2 and 3's, then every cell's).
        const cellEls = [...li.querySelectorAll<HTMLElement>('.k-dep-cell')];
        if (cellEls.some(long) && headsigns !== 'none') continue;
        if (cellEls.length < line.cells.length || cellEls.some((cell) => measure.box(cell).overflow)) continue;
        if (paintedPx > 0 && rowPx(li) > paintedPx) continue;
        if (measure.box(list).overflow) continue;
        return { display, short, drawn: { kind: 'advance', beat: reveal.beat, replaced: line.cells.map((row) => row.id), revealed: cells.map((row) => row.id) } };
      }
      return null;
    });
  }

  const handle: TimelineHandle = {
    element,
    update(rows, radiusM, now, view) {
      last = [rows, radiusM, now, view];
      const inputCount = rows.length;
      rows = rows.filter(vettedTimelineRow);
      const skippedText = String(inputCount - rows.length);
      if (element.dataset.skippedText !== skippedText) element.dataset.skippedText = skippedText;
      const head = nearbyHead(i18n, radiusM);
      if (head !== headText) {
        heading.innerHTML = headMarkup(head);
        headText = head;
      }
      const design = typeof deps.designHeightPx === 'function' ? deps.designHeightPx() : deps.designHeightPx;
      const unbounded = design === Number.POSITIVE_INFINITY;
      // The wall's compositions draw the departures as one line (R1), a row the budget and the fit count once.
      const grouped = deps.departuresLine ? deps.departuresLine() : Number.isFinite(design);
      const wall: readonly WallRow[] = grouped ? groupDepartures(rows) : rows;
      const box = unbounded ? { height: 0, width: 0, overflow: false } : measure.box(list);
      const available = unbounded ? design : box.height > 0 ? box.height / zoom() : design;
      const budget = rowBudget(available, wall.length);
      const candidates = fitRows(wall, budget.rows, now);
      const rowVars = (rowPx: number): void => {
        setVar('--k-nearby-row', `${rowPx}px`);
        setVar('--k-nearby-scale', unbounded ? '1' : String(Math.round(typeScale(rowPx) * 1000) / 1000));
      };

      const before = new Set<string>();
      const beforeCells = new Set<string>();
      for (const li of list.children) {
        const key = li.getAttribute('data-key') ?? '';
        before.add(key);
        if (key === DEPARTURES_LINE_ID) for (const cell of li.children) beforeCells.add(cell.getAttribute('data-key') ?? '');
      }
      let shown: WallRow[] = candidates;
      /** The reveal drawn this update (R2), none on a handheld or without a view. */
      let drawn: DrawnReveal | null = null;
      if (unbounded) {
        overlay = null;
        parked.clear();
        heldOut.clear();
        if (list.hasAttribute('data-reveal')) delete list.dataset.reveal;
        rowVars(budget.rowPx);
        paint(shown, new Map(), now);
      } else {
        const style = getComputedStyle(element);
        const typography = [style.fontFamily, '--k-read-scale', '--k-main-size', '--k-sup-size', '--k-zoom']
          .map(value => value.startsWith('--') ? style.getPropertyValue(value) : value).join(';');
        // The fit reads the whole list (the rows the estimate left out may take the room the measured rows leave).
        // An imminence boundary can change which rows deserve room without changing any printed time or label.
        // Remember the order, not the clock, so unchanged priority still reuses the measured fit.
        const valueOrder = byValue(wall, now).map((row) => row.id).join('\u0002');
        const sig = `${fitSignature(wall, now, i18n, budget.rowPx, box, typography)}|${budget.rows}|${valueOrder}`;
        if (!memo || memo.sig !== sig) {
          // The fit measures at the budget's height; a remembered fit keeps its own (an idle update writes nothing,
          // where the budget's and the fit's heights differ: the 64 px refit below).
          rowVars(budget.rowPx);
          let fitted = fit(candidates, wall, now, box);
          let rowPx = budget.rowPx;
          // Content before size: when whole rows would go at the budget's height, the rows give back their growth
          // first, down to the minimum, and only then does a row go. Seven rows in a 483 px box are 69 px each, and
          // one row with an address line is 84, so the box overflowed by fifteen pixels and the sunset row left and
          // returned on every turnover that passed through six candidates (D5.8 observer, two records and a
          // re-created row each time); at 64 px they all fit. As many rows with more departures is more too: the refit
          // (U0 step 7) can fill a departure's room at the budget's height with a row that yielded to it, such as a
          // sunset hours away (decision 67), where 64 px keeps the departure.
          if ((fitted.shown.length < candidates.length || fitted.overflow) && budget.rowPx > ROW_MIN_PX) {
            rowVars(ROW_MIN_PX);
            const tighter = fit(candidates, wall, now, box);
            // The departures on the list: the line's cells, or the departure rows of an ungrouped list.
            const departuresIn = (rows: readonly WallRow[]): number => rows.reduce((n, r) => n + (isDeparturesLine(r) ? r.cells.length : r.kind === 'departure' ? 1 : 0), 0);
            if (tighter.shown.length > fitted.shown.length
              || (tighter.shown.length === fitted.shown.length && (departuresIn(tighter.shown) > departuresIn(fitted.shown)
                || (fitted.overflow && !tighter.overflow)))) {
              fitted = tighter;
              rowPx = ROW_MIN_PX;
            }
          }
          memo = { sig, ids: new Set(fitted.shown.map((row) => row.id)), short: fitted.short, rowPx };
        }
        rowVars(memo.rowPx);
        shown = wall.filter((row) => memo!.ids.has(row.id));
        // Restore hysteresis (FIT_RESTORE_HOLD_MS): a row the fit dropped stays out until it has fitted for a whole
        // minute; reserved rows, departures and the departures line are never held out, and a row gone from the
        // candidates is forgotten.
        const fits = new Set(shown.map((row) => row.id));
        const holdable = (row: WallRow): boolean => row.kind !== 'departure' && row.kind !== 'departures' && row.kind !== 'first' && row.kind !== 'last' && !isTimeless(row);
        // R2, the rise: at a page turn's end a revealed row the fit now keeps leaves the hold at once (it has stood on
        // the wall for a whole beat, so it stays instead of leaving and coming back after a minute); while revealed,
        // its hold is frozen, so the overlay is the same for the whole beat.
        const pageOn = view?.reveal?.kind === 'page' ? view.reveal : null;
        if (lastDrawn?.kind === 'page' && !(pageOn && pageOn.beat === lastDrawn.beat)) for (const id of lastDrawn.revealed) if (fits.has(id)) heldOut.delete(id);
        const revealed = new Set(pageOn?.ids ?? []);
        for (const row of candidates) {
          if (!holdable(row) || (revealed.has(row.id) && heldOut.has(row.id))) continue;
          if (!fits.has(row.id)) { heldOut.set(row.id, null); continue; }
          if (!heldOut.has(row.id)) continue;
          const since = heldOut.get(row.id) ?? now;
          if (heldOut.get(row.id) === null) heldOut.set(row.id, now);
          if (now - since >= FIT_RESTORE_HOLD_MS) heldOut.delete(row.id);
        }
        const present = new Set(candidates.map((row) => row.id));
        for (const id of [...heldOut.keys()]) if (!present.has(id)) heldOut.delete(id);
        shown = shown.filter((row) => !heldOut.has(row.id));
        // R2: the beat's reveal over the fit, measured once per beat and fit (the overlay memo); the DOM says what was
        // drawn (data-reveal), the scheduler's history what was decided.
        let display: readonly WallRow[] = shown;
        let displayShort: ReadonlyMap<string, ShortLabels> = memo.short;
        const reveal = view?.reveal ?? null;
        if (reveal) {
          const next = (view?.next ?? []).filter((row) => reveal.ids.includes(row.id) && row.kind === 'departure' && !isTimeless(row) && vettedTimelineRow(row)).slice(0, MAX_DEPARTURES);
          const protections = taktCandidates(wall, [], now).filter((c) => reveal.replaces.includes(c.id))
            .map((c) => `${c.id}:${c.reserved}:${c.imminent}`).join('\u0002');
          const key = `${reveal.kind}:${reveal.beat}|${memo.sig}|${shown.map((row) => row.id).join('\u0002')}|${reveal.ids.join('\u0002')}|${reveal.replaces.join('\u0002')}|${protections}|${fitSignature(groupDepartures(next), now, i18n, memo.rowPx, box, typography)}`;
          if (!overlay || overlay.key !== key) {
            const prior = overlay?.drawn && overlay.drawn.kind === reveal.kind && overlay.drawn.beat === reveal.beat ? overlay.drawn : null;
            const result = reveal.kind === 'page'
              ? pageOverlay(reveal, shown, wall, now, box, memo.short, prior)
              : advanceOverlay(reveal, shown, next, now, box, memo.short);
            overlay = { key, ids: (result?.display ?? shown).map((row) => row.id), short: result?.short ?? memo.short, drawn: result?.drawn ?? null };
          }
          // Cache only the measured selection. Timestamps, live flags and source details still come from this paint.
          const displayed = new Set(overlay.ids);
          display = wall.filter((row) => displayed.has(row.id)).map((row) => overlay!.drawn?.kind === 'advance' && isDeparturesLine(row)
            ? { ...row, cells: next, atMs: next[0]!.atMs!, live: next.some((cell) => cell.live) } : row);
          displayShort = overlay.short;
          drawn = overlay.drawn;
        } else {
          overlay = null;
        }
        const pageMark = drawn?.kind === 'page' ? `page:${drawn.beat}` : undefined;
        if (list.dataset.reveal !== pageMark) { if (pageMark === undefined) delete list.dataset.reveal; else list.dataset.reveal = pageMark; }
        // What leaves at a reveal's edge is kept for its return: a page turn's replaced rows at its start, its revealed
        // rows at its end; the line's cells across an advance's start and end.
        const park = new Set<string>();
        if (drawn?.kind === 'page') for (const id of drawn.replaced) park.add(id);
        if (lastDrawn?.kind === 'page' && !(drawn?.kind === 'page' && drawn.beat === lastDrawn.beat)) for (const id of lastDrawn.revealed) park.add(id);
        const parkCells = drawn?.kind === 'advance' || lastDrawn?.kind === 'advance';
        // The only live-list commit. No rejected row ever enters this tree.
        paint(display, displayShort, now, { ...(drawn?.kind === 'advance' ? { advance: { beat: drawn.beat } } : {}), park, parkCells });
        // Kept-aside nodes outlive one reveal only where their row may return: a replaced row the fit dropped meanwhile
        // is let go at the return, and nothing is kept for a row the wall no longer offers.
        if (lastDrawn?.kind === 'page' && !(drawn?.kind === 'page' && drawn.beat === lastDrawn.beat)) for (const id of lastDrawn.replaced) parked.delete(id);
        const offered = new Set<string>([...wall.map((row) => row.id), ...wall.flatMap((row) => (isDeparturesLine(row) ? row.cells.map((cell) => cell.id) : [])), ...(view?.next ?? []).map((row) => row.id)]);
        for (const id of [...parked.keys()]) if (!offered.has(id)) parked.delete(id);
        while (parked.size > PARKED_MAX) parked.delete(parked.keys().next().value!);
      }

      if (painted && !deps.reduced) {
        const entered: Element[] = [];
        // A row entering at a page turn's edge slides (R2): one revealed at its start, one replaced at its return.
        const slides = new Set<string>(drawn?.kind === 'page' ? drawn.revealed : []);
        if (lastDrawn?.kind === 'page' && !(drawn?.kind === 'page' && drawn.beat === lastDrawn.beat)) for (const id of lastDrawn.replaced) slides.add(id);
        for (const li of list.children) {
          const key = li.getAttribute('data-key') ?? '';
          if (!before.has(key)) {
            li.setAttribute('data-enter', '1');
            if (slides.has(key)) li.setAttribute('data-slide', '1');
            entered.push(li);
          } else if (key === DEPARTURES_LINE_ID) {
            // A line that was there: a new departure fades in its own cell, and the line never fades.
            for (const cell of li.children) {
              if (!cell.classList.contains('k-dep-cell')) continue;
              if (beforeCells.has(cell.getAttribute('data-key') ?? '')) continue;
              cell.setAttribute('data-enter', '1');
              entered.push(cell);
            }
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
      lastDrawn = drawn;
      count = shown.length;
      const skippedFit = String(wall.length - count);
      if (element.dataset.skippedFit !== skippedFit) element.dataset.skippedFit = skippedFit;
      // The kinds of the vetted rows the list did not paint, in list order (U4's fitted-departures observer row reads it).
      const paintedIds = new Set(shown.map((row) => row.id));
      const fitDropped = wall.filter((row) => !paintedIds.has(row.id)).map((row) => row.kind).join(' ');
      if (element.dataset.fitDropped !== fitDropped) element.dataset.fitDropped = fitDropped;
      const overflow = !unbounded && measure.box(list).overflow ? '1' : '0';
      if (element.dataset.fitOverflow !== overflow) element.dataset.fitOverflow = overflow;
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
      memo = null;
      overlay = null;
      lastDrawn = null;
      parked.clear();
      heldOut.clear();
      element.remove();
    },
  };

  // The fit is only as good as the layout it read: a resized box or a web font
  // that arrives after the first paint fits the last rows again, at once. No
  // hold against a smaller box (decision 66): the round-4 fixer passes held the
  // fitted rows for five seconds and then for two paints, and both painted the
  // rows the smaller box could not hold cut for the hold's length at every
  // shrink that stays (readable-city's outage reading; release smoke run 5's
  // resize probe, where a composition switch shrinks the list from 751 to
  // 462 px while the window grows). The ResizeObserver's callback runs after
  // layout and before paint, so a refit here never paints a cut row; a box
  // smaller for one paint (the D5.25 wobble) re-creates its row on the return,
  // the residual handed to the reconnect pill's layout.
  const refit = (): void => {
    memo = memo && { ...memo, sig: '' };
    overlay = overlay && { ...overlay, key: '' };
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

// --- The read-only touch (WP2 step 9, [O-58]) -------------------------------------
//
// A touch on the wall (kiosk.ts) puts one thing in this list's box for TOUCH_MS:
// a stop's board, a row's detail or the on-duty pharmacy, and then the wall
// returns by itself. The list stays laid out under it (kiosk-city.css hides it
// with visibility, never display, and never touches its rows), so its fit is
// still the right one when the box is given back. Every label is vetted where it
// is drawn (decision 22): departureRow vets the line and the headsign itself (the
// same row Sada and Karta print, so "uživo" means the same thing on all three),
// and every other string here is a return of vetExternal. Whole rows and whole
// words: each builder offers its variants from the richest to the leanest, and
// the panel keeps the first its box holds whole.

/** How long a touch keeps its detail before the wall returns by itself [O-58]. */
export const TOUCH_MS = 60_000;

export type TouchKind = 'stop' | 'row' | 'pharmacy';

export interface TouchPanelHandle {
  /** The panel's section while it shows something; null while the box is the list's. */
  element(): HTMLElement | null;
  /** Puts the first of `variants` (richest first) the box holds whole over the list; an empty list gives the box back. */
  show(kind: TouchKind, variants: readonly string[]): void;
  /** Gives the box back to the list: the panel leaves the DOM. */
  clear(): void;
}

/**
 * The panel a touch fills, beside the "U blizini" list in `host` (the aside's
 * `.k-nearby-host`). It is in the DOM only while it shows something, marked
 * `data-touch` on the host (the stylesheet hides the list under it), and an
 * update with the same content and box writes nothing.
 */
export function mountTouchPanel(host: HTMLElement, deps: { measure?: TimelineMeasure } = {}): TouchPanelHandle {
  const measure = deps.measure ?? DOM_MEASURE;
  let section: HTMLElement | null = null;
  let shown = '';
  function clear(): void {
    if (host.dataset.touch !== undefined) delete host.dataset.touch;
    section?.remove();
    section = null;
    shown = '';
  }
  return {
    element: () => section,
    show(kind, variants) {
      if (variants.length === 0) { clear(); return; }
      if (!section) {
        section = document.createElement('section');
        section.className = 'k-touch';
        section.setAttribute('aria-live', 'polite');
        host.appendChild(section);
      }
      if (host.dataset.touch !== kind) host.dataset.touch = kind;
      if (section.dataset.touch !== kind) section.dataset.touch = kind;
      const box = measure.box(section);
      const signature = `${kind}\u0001${box.height}x${box.width}\u0001${variants.join('\u0002')}`;
      if (signature === shown) return;
      shown = signature;
      for (const markup of variants) {
        section.innerHTML = markup;
        const body = section.firstElementChild as HTMLElement | null;
        if (!body || !measure.box(body).overflow) return;
      }
    },
    clear,
  };
}
