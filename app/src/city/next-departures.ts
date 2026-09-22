// The departures block (companion WP4 step 2): up to three departures at the
// platform the phone chose (city/place.ts departuresStop), in the row the
// stop's sheet shows too (transport/view.ts departureRow), read from the same
// page-owned board cache and calculation (shared/city/arrivals.ts).
//
// One empty rule [O-32]: a departure row always exists. The board spans the
// whole service day, so once it is in hand there is a timetable row; until it
// lands one row-sized placeholder holds the place (aria-busy), and only a
// source that cannot answer says so, in one line in that same row. No prompt
// and no word per row: the blue countdown with its dot is a tracked vehicle,
// a grey clock the timetable [O-27]; Sada's provenance block credits ZET
// below the fold and the stop's sheet carries arrivals.note once.
import { arrivalsAt } from '../../../shared/city/arrivals';
import type { DepartureBoard } from '../../../shared/city/types';
import type { LayerContext } from '../layers/types';
import { vehicleFixes } from '../motion/fixes';
import { platformIds } from '../kiosk/arrivals';
import { kindOfRoute } from '../kiosk/exceptions';
import { departureRow } from '../transport/view';
import { escapeHtml as e, escapeAttribute as a } from '../ui/dom/escape';
import { resolvePlace, type PlaceContext } from './place';

export { departureRow };

/** Sada shows three departures, never more [O-27]. */
export const DEPARTURE_ROWS = 3;

export interface DeparturesOptions {
  rows?: number;
  /** Name the stop above its rows; the block leaves it out when the stop is the place itself. */
  heading?: boolean;
}

/** One row in the rows' own box: a placeholder while the board is on its way, else one short sentence. */
const emptyRow = (text: string | null): string => text === null
  ? '<li class="sada-departure-empty" aria-hidden="true"><span class="skeleton"></span></li>'
  : `<li class="sada-departure-empty">${e(text)}</li>`;

export function departuresBlock(ctx: LayerContext, place: PlaceContext, opts: DeparturesOptions = {}): string {
  const { i18n } = ctx;
  const stop = place.departuresStop;
  // The catalogue is in hand and no platform is within reach of the place: nothing to board.
  if (!stop && ctx.stops) return '';
  const frozen = ctx.frozenAt !== undefined || Boolean(ctx.session?.frozen);
  let body: string;
  let busy = false;
  if (!stop) {
    // The catalogue is still on its way; a frozen view will not receive it.
    busy = !frozen;
    body = emptyRow(frozen ? i18n.t('arrivals.frozen') : null);
  } else {
    const ids = platformIds(stop, ctx.stops);
    if (!frozen) ctx.boards?.ensure('zet', ids, ctx.onLocalData);
    const held = ids.map((id) => ctx.boards?.get('zet', id)).filter((b): b is DepartureBoard => Boolean(b));
    const answer = arrivalsAt(held, vehicleFixes(ctx.snapshots['zet-rt'], ctx.now), ctx.now, { stopIds: ids, rows: opts.rows ?? DEPARTURE_ROWS });
    if (answer.rows.length) {
      body = answer.rows.map((row) => departureRow(i18n, row, kindOfRoute, ctx.frozenAt)).join('');
    } else if (answer.status === 'none') {
      // No board in hand: on its way while live, never coming once frozen.
      busy = !frozen;
      body = emptyRow(frozen ? i18n.t('arrivals.frozen') : null);
    } else {
      body = emptyRow(i18n.t(answer.status === 'down' ? 'arrivals.down' : 'arrivals.none'));
    }
  }
  const label = stop ? i18n.t('sada.departuresAt', { stop: stop.name }) : i18n.t('arrivals.title');
  const heading = opts.heading && stop && stop.name.trim() !== place.name.trim()
    ? `<h3 class="sada-departures-title">${e(stop.name)}</h3>` : '';
  return `<section class="sada-departures" aria-label="${a(label)}">${heading}<ul class="sada-departure-list" data-testid="day-departures"${busy ? ' aria-busy="true"' : ''}>${body}</ul></section>`;
}

/** The old entry point, kept until Sada calls departuresBlock itself (WP4 chunk B): the page's place, else one resolved from the context. */
export const nextDepartures = (ctx: LayerContext): string =>
  departuresBlock(ctx, ctx.place ?? resolvePlace({ screen: ctx.screen, saved: ctx.saved, stops: ctx.stops, location: ctx.location }), { heading: true });
