// What comes next at one stop, as the public screen asks for it: the
// platforms a rider means, what a card knows about the board it shows, and
// the sentence an empty list says. How a row reads -- the plate, the
// destination, the time with the word that says what it is worth -- is
// arrival-cells.ts, which only the wall's views import; the phone's Sada
// asks this module for the platform ids alone, so the wall's markup stays off
// the lightweight graph (test/app/budget.test.ts).
//
// Pure, like the panel builders beside it: rows in, cells out. The asking is
// the controller's (app/src/kiosk.ts owns the one board cache), the merging
// is the shared module's (shared/city/arrivals.ts).
import { type ArrivalRow, type ArrivalsStatus } from '../../../shared/city/arrivals';
import type { ScreenStop } from '../core/contracts';
import type { KioskStrings } from './strings';
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';

export function vettedArrival(row: ArrivalRow): boolean {
  return vetExternal('headsign', row.routeName, 'row') !== null
    && vetExternal('headsign', row.headsign || row.routeName, 'row') !== null;
}

/** What one surface asked the board cache for, as the shared module answered it. */
export interface StopArrivals {
  rows: readonly ArrivalRow[];
  status: ArrivalsStatus;
}

/** What a card showing a board needs to know about the board itself: its own
 *  state (never the vehicle feed's), how many departures it holds before any
 *  trimming, and how many platforms were merged into it. */
export interface BoardSubject {
  status: ArrivalsStatus;
  total: number;
  platforms: number;
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

/** The sentence a list with no rows says, and each of the four states is a
 *  different sentence because they are different facts: 'none' is "no board in
 *  hand yet", which on a screen that never stops running is almost always the
 *  answer still being on its way rather than a stop that publishes nothing --
 *  so it says it is loading, not that there is no data; 'down' is "every
 *  platform's board failed"; 'stale' is a copy nobody has confirmed, which is
 *  never the same as "nothing is coming"; only a live board with nothing left
 *  on it may say the service is over. */
export function arrivalsEmptyText(status: ArrivalsStatus, s: KioskStrings): string {
  if (status === 'none') return s.arrivals.loading;
  if (status === 'down') return s.arrivals.down;
  return status === 'stale' ? s.paired.unconfirmed : s.arrivals.none;
}
