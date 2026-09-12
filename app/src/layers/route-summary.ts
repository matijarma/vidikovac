// One row per route among a set of vehicles: how many are in frame right
// now and that route's median delay in words (delayWord -- the one place
// the on-time band lives, shared.ts). Built for R-F8: the lightweight
// schematic list (motion/schematic-view.ts, whose canvas twin draws these
// same vehicles) and the essentials board's "Linije u blizini" row
// (kiosk.ts, R-P7) both read this one helper, so the two surfaces can never
// print two different answers to "what's running near here right now" from
// the same live data. Pure and free of both the network artefact (never
// loaded on the lightweight path, R-L4) and the DOM: a caller's own vehicle
// list in, the rows out.
import type { I18n } from '../i18n/i18n';
import { delayWord } from './shared';

/** One vehicle contributing to the summary. `label` is the caller's own
 *  concern -- a teaser pin already carries `routeShortName` on the wire,
 *  while the lightweight list resolves it from the static GTFS routes
 *  table since the network artefact never loads there -- and `type` is the
 *  GTFS route_type (0 tram, 3 bus) so trams sort before buses. */
export interface RouteVehicle {
  routeId: string;
  label: string;
  type: number;
}

export interface RouteSummaryRow {
  routeId: string;
  label: string;
  type: number;
  /** Vehicles of this route among the input set. */
  count: number;
  /** delayWord()'s own output. A route with no figure in `delays` at all
   *  reads "na vrijeme" rather than "unknown" -- the same fallback the
   *  schematic's old stop list already used for a route's own median. */
  word: string;
}

/**
 * One row per distinct route id in `vehicles`, trams before buses and then
 * by route number the way a person reads it -- numeric, then text (R-F8's
 * own order) -- never the plain lexicographic order that would put '11'
 * before '6'.
 */
export function summariseRoutes(
  vehicles: readonly RouteVehicle[],
  delays: ReadonlyMap<string, number>,
  i18n: I18n,
): RouteSummaryRow[] {
  const rows = new Map<string, { label: string; type: number; count: number }>();
  for (const v of vehicles) {
    const row = rows.get(v.routeId);
    if (row) row.count += 1;
    else rows.set(v.routeId, { label: v.label, type: v.type, count: 1 });
  }
  return [...rows.entries()]
    .map(([routeId, { label, type, count }]) => ({
      routeId,
      label,
      type,
      count,
      word: delayWord(i18n, delays.get(routeId) ?? 0),
    }))
    .sort((a, b) => a.type - b.type || a.label.localeCompare(b.label, 'hr', { numeric: true }));
}
