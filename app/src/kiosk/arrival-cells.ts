// How an arrival reads on a kiosk board row, the rows shared/city/arrivals.ts
// already merged and sorted, dressed for a wall: the plate a rider looks
// for, the destination, and the time with the word that says what that time
// is worth. Only the wall's views import it (paired.ts); the platform ids
// and the board's own state are arrivals.ts, which the phone reads too.
//
// The wording is the phone's (`arrivals.*` in the one catalogue), not a
// second vocabulary: a person who read "za 3 min · uživo" on the screen and
// then opens the same stop on their phone must not be told it differently.
import type { ArrivalRow } from '../../../shared/city/arrivals';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { vettedArrival, type StopArrivals } from './arrivals';
import { kindOfRoute } from './exceptions';
import { clock } from './format';
import type { FrontRow } from './front';
import { kBadge } from './markup';
import { fill, type KioskStrings } from './strings';

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
  const time = !row.live || row.minutes === null
    ? `<time datetime="${escapeAttribute(new Date(row.atMs).toISOString())}">${escapeHtml(clock(row.atMs))}</time>`
    : escapeHtml(row.minutes === 0 ? s.arrivals.now : fill(s.arrivals.inMinutes, { n: row.minutes }));
  const dot = row.live ? `<span class="k-live" role="img" aria-label="${escapeAttribute(s.arrivals.live)}"></span>` : '';
  return `<span class="${className}"${row.live ? ' data-live="true"' : ''}>${dot}${time}<small class="k-eta-kind">${escapeHtml(row.live?s.arrivals.live:s.arrivals.scheduled)}</small></span>`;
}

/** What a badge is called when it is read out rather than seen: "tramvaj 6",
 *  the same shape the stop's line rows use (front.ts linesRows). */
function badgeLabel(routeId: string, routeName: string, s: KioskStrings): string {
  const kind = kindOfRoute(routeId);
  const word = kind === 'tram' ? s.lines.tram : kind === 'bus' ? s.lines.bus : '';
  return `${word} ${routeName}`.trim();
}

/** The two cells of one arrival on a kiosk board row (paired.ts's `row`): the
 *  plate and the destination, with the time floated at their right. One line,
 *  like every other board row on this screen.
 *
 *  What is NOT here is the per-row "po redu vožnje": a second line under every
 *  untracked row doubled the height of a card read from four metres away. The
 *  distinction survives whole -- a tracked estimate carries the live dot, a
 *  timetable time carries nothing -- and the note under the list says in one
 *  sentence what that means. */
export function arrivalCells(row: ArrivalRow, s: KioskStrings): { main: string; aside: string } {
  if (!vettedArrival(row)) return { main: '', aside: '' };
  return {
    main: `${kBadge(row.routeName, kindOfRoute(row.routeId), badgeLabel(row.routeId, row.routeName, s))} ${escapeHtml(row.headsign || row.routeName)}`,
    aside: etaMarkup(row, s, 'k-eta'),
  };
}

/** The same rows as the front page's Promet card reads them (front.ts
 *  FrontRow): the plate at the lead, the destination across the middle, the
 *  time hard right. One line, the same shape as the exceptions the card shows
 *  when it has no board -- so a stop's arrivals cost the aside the room three
 *  or four exception lines cost it, and the events and QR cards keep theirs. */
export function arrivalFrontRows(arrivals: StopArrivals, s: KioskStrings, limit: number): FrontRow[] {
  return arrivals.rows.filter(vettedArrival).slice(0, Math.max(0, limit)).map((row) => ({
    key: `arrival:${row.tripId}|${row.atMs}`,
    leadMarkup: kBadge(row.routeName, kindOfRoute(row.routeId), badgeLabel(row.routeId, row.routeName, s)),
    title: row.headsign || row.routeName,
    trail: etaMarkup(row, s, 'k-eta'),
  }));
}
