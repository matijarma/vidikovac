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
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';
import type { LayerContext } from '../layers/types';
import { platformIds, vettedArrival } from '../kiosk/arrivals';
import { kindOfRoute } from '../kiosk/exceptions';
import { departureRow } from '../transport/view';
import { escapeHtml as e, escapeAttribute as a } from '../ui/dom/escape';
import { externalTextReady, liveFixes } from './feed';
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
  // One frozen moment for the whole block: the shell's own, else now when only the session flag says so.
  const frozenAt = ctx.frozenAt ?? (ctx.session?.frozen ? ctx.now : undefined);
  const frozen = frozenAt !== undefined;
  let body: string;
  let busy = false;
  if (!stop) {
    // No catalogue yet: on its way while live, down when its load failed, never coming once frozen.
    busy = !frozen && !ctx.stopsDown;
    body = emptyRow(frozen ? i18n.t('arrivals.frozen') : ctx.stopsDown ? i18n.t('arrivals.down') : null);
  } else {
    const ids = platformIds(stop, ctx.stops);
    if (!frozen) ctx.boards?.ensure('zet', ids, ctx.onLocalData);
    const held = ids.map((id) => ctx.boards?.get('zet', id)).filter((b): b is DepartureBoard => Boolean(b));
    // Live only while the feed is (city/feed.ts liveFixes): no live time during an outage or off a stale fix.
    const answer = arrivalsAt(held, liveFixes(ctx.snapshots['zet-rt'], ctx.now), ctx.now, { stopIds: ids, rows: opts.rows ?? DEPARTURE_ROWS });
    // Every row's line and headsign are ZET's text (kiosk/arrivals.ts vettedArrival): a row that fails the check is
    // left out; until the policy is in hand the rows hold their place rather than say the timetable is missing.
    const rows = answer.rows.filter(vettedArrival);
    if (rows.length) {
      body = rows.map((row) => departureRow(i18n, row, kindOfRoute, frozenAt)).join('');
    } else if (answer.rows.length) {
      busy = !frozen && !externalTextReady();
      body = emptyRow(busy ? null : i18n.t(frozen ? 'arrivals.frozen' : 'arrivals.down'));
    } else if (answer.status === 'none') {
      // No board in hand: on its way while live, never coming once frozen.
      busy = !frozen;
      body = emptyRow(frozen ? i18n.t('arrivals.frozen') : null);
    } else {
      body = emptyRow(i18n.t(answer.status === 'down' ? 'arrivals.down' : 'arrivals.none'));
    }
  }
  // The stop's name is ZET's text too: vetted before it names the block or heads it.
  const stopName = stop ? vetExternal('name', stop.name, 'row') : null;
  const label = stopName !== null ? i18n.t('sada.departuresAt', { stop: stopName }) : i18n.t('arrivals.title');
  const heading = opts.heading && stopName !== null && stopName.trim() !== place.name.trim()
    ? `<h3 class="sada-departures-title">${e(stopName)}</h3>` : '';
  return `<section class="sada-departures" aria-label="${a(label)}">${heading}<ul class="sada-departure-list" data-testid="day-departures"${busy ? ' aria-busy="true"' : ''}>${body}</ul></section>`;
}

/** The old entry point, kept until Sada calls departuresBlock itself (WP4 chunk B): the page's place, else one resolved from the context. */
export const nextDepartures = (ctx: LayerContext): string =>
  departuresBlock(ctx, ctx.place ?? resolvePlace({ screen: ctx.screen, saved: ctx.saved, stops: ctx.stops, location: ctx.location }), { heading: true });
