// What comes next at one stop, as the public screen says it: the rows
// shared/city/arrivals.ts already merged and sorted, dressed for a wall.
//
// Pure, like the panel builders beside it: rows in, cells out. The asking is
// the controller's (app/src/kiosk.ts owns the one board cache), the merging
// is the shared module's, and this file only decides how a kiosk row reads --
// the plate a rider looks for, the destination, and the time with the word
// that says what that time is worth.
//
// The wording is the phone's (`arrivals.*` in the one catalogue), not a
// second vocabulary: a person who read "za 3 min · uživo" on the screen and
// then opens the same stop on their phone must not be told it differently.
import { type ArrivalRow, type ArrivalsStatus } from '../../../shared/city/arrivals';
import type { ScreenStop } from '../core/contracts';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { kindOfRoute } from './exceptions';
import { clock } from './format';
import type { FrontRow } from './front';
import { kBadge } from './markup';
import { fill, type KioskStrings } from './strings';

/** What one surface asked the board cache for, as the shared module answered it. */
export interface StopArrivals {
  rows: readonly ArrivalRow[];
  status: ArrivalsStatus;
}

/** How many rows a kiosk surface shows: four across a wide screen, three when
 *  the column is narrow (compact and portrait). Fewer than the six the shared
 *  module offers -- a card read from four metres away is not a departure hall
 *  board, and the row under the fourth would be hidden by the row fitter
 *  anyway, counted in a line that says nothing a rider needs. */
export const ARRIVAL_ROWS: Readonly<Record<'wide' | 'compact', number>> = { wide: 4, compact: 3 };

/**
 * Every platform id of the stop a rider means. A named stop has siblings --
 * "Trg bana J. Jelačića" is several platforms with their own ids -- and a
 * rider waiting there waits at the name, not at the id the tap happened to
 * carry; the boards of all of them are one list (shared/city/arrivals.ts
 * folds a trip that appears on several into one row).
 *
 * The name is the join, as it is everywhere else in this codebase
 * (transport/catalogue.ts groups platforms by it, stops.ts dedupes by it).
 * Without the catalogue in hand the stop's own id is the honest answer: one
 * platform's board is a partial truth, and inventing sibling ids from the id's
 * shape would be a guess.
 */
export function platformIds(stop: { id: string; name?: string }, stops?: readonly ScreenStop[] | null): readonly string[] {
  const name = (stop.name ?? stops?.find((s) => s.id === stop.id)?.name ?? '').trim();
  if (!name || !stops?.length) return [stop.id];
  const ids = stops.filter((s) => s.name.trim() === name).map((s) => s.id);
  if (ids.length === 0) return [stop.id];
  return ids.includes(stop.id) ? ids : [stop.id, ...ids];
}

/**
 * A row's time, with the word that says what it is worth -- in BOTH branches,
 * exactly as the phone sheet does it (transport/view.ts arrivalTime).
 *
 * Inside the countdown horizon the row says how long the wait is, because
 * that is the question a person in front of a screen is asking, and `sada` at
 * zero: a tram due in under half a minute is the one pulling in. Beyond the
 * horizon a countdown would be a guess dressed as a fact, so the row shows a
 * clock -- and a tracked row's clock is the schedule plus ZET's delay, not the
 * timetable moment, so it keeps the live dot exactly as its countdown would.
 * An unlabelled clock would read as the timetable and make the note under the
 * list say the wrong thing about it.
 */
function etaMarkup(row: ArrivalRow, s: KioskStrings, className: string): string {
  const time = row.minutes === null
    ? `<time datetime="${escapeAttribute(new Date(row.atMs).toISOString())}">${escapeHtml(clock(row.atMs))}</time>`
    : escapeHtml(row.minutes === 0 ? s.arrivals.now : fill(s.arrivals.inMinutes, { n: row.minutes }));
  const dot = row.live ? `<span class="k-live" role="img" aria-label="${escapeAttribute(s.arrivals.live)}"></span>` : '';
  return `<span class="${className}"${row.live ? ' data-live="true"' : ''}>${dot}${time}</span>`;
}

/** What a badge is called when it is read out rather than seen: "tramvaj 6",
 *  the same shape the stop's line rows use (front.ts linesRows). */
function badgeLabel(routeId: string, routeName: string, s: KioskStrings): string {
  const kind = kindOfRoute(routeId);
  const word = kind === 'tram' ? s.lines.tram : kind === 'bus' ? s.lines.bus : '';
  return `${word} ${routeName}`.trim();
}

/** The three cells of one arrival on a kiosk board row (paired.ts's `row`):
 *  the plate and the destination on the first line, the time floated at its
 *  right, and "po redu vožnje" underneath when nothing tracks this trip. */
export function arrivalCells(row: ArrivalRow, s: KioskStrings): { main: string; sub: string; aside: string } {
  return {
    main: `${kBadge(row.routeName, kindOfRoute(row.routeId), badgeLabel(row.routeId, row.routeName, s))} ${escapeHtml(row.headsign || row.routeName)}`,
    sub: row.live ? '' : s.arrivals.scheduled,
    aside: etaMarkup(row, s, 'k-eta'),
  };
}

/** The same rows as the front page's Promet card reads them (front.ts
 *  FrontRow): the lead cell carries the plate over the time -- the two things
 *  a rider reads first -- and the destination fills the row. */
export function arrivalFrontRows(arrivals: StopArrivals, s: KioskStrings, limit: number): FrontRow[] {
  return arrivals.rows.slice(0, Math.max(0, limit)).map((row) => ({
    key: `arrival:${row.tripId}|${row.atMs}`,
    leadMarkup: `${kBadge(row.routeName, kindOfRoute(row.routeId), badgeLabel(row.routeId, row.routeName, s))}${etaMarkup(row, s, 'k-fr-eta')}`,
    title: row.headsign || row.routeName,
    ...(row.live ? {} : { sub: s.arrivals.scheduled }),
  }));
}

/** The sentence a list with no rows says, and each of the four states is a
 *  different sentence because they are different facts: 'none' is "no board in
 *  hand yet", which on a screen that never stops running means the answer is
 *  still on its way; 'down' is "every platform's board failed"; 'stale' is a
 *  copy nobody has confirmed, which is never the same as "nothing is coming";
 *  only a live board with nothing left on it may say the service is over. */
export function arrivalsEmptyText(status: ArrivalsStatus, s: KioskStrings): string {
  if (status === 'none') return s.paired.noData;
  if (status === 'down') return s.arrivals.down;
  return status === 'stale' ? s.paired.unconfirmed : s.arrivals.none;
}
