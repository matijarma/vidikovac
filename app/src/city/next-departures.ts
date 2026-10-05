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
import { railPolicy, serviceStateOf } from '../../../shared/city/service-state';
import type { DepartureBoard } from '../../../shared/city/types';
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';
import type { PublicSelection } from '../../../worker/public-selection';
import { selectionHref } from '../experience/blocks';
import type { LayerContext } from '../layers/types';
import { platformIds, vettedArrival } from '../kiosk/arrivals';
import { kindOfRoute } from '../kiosk/exceptions';
import { departureRow } from '../transport/view';
import { escapeHtml as e, escapeAttribute as a } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import { cancelledTrips, externalTextReady, liveFixes, railNearest, railPlaceName, RAIL_SHORT_NAME } from './feed';
import { resolvePlace, type PlaceContext } from './place';

export { departureRow };

/** Sada shows three departures, never more [O-27]. */
export const DEPARTURE_ROWS = 3;

/**
 * The train toggle's key in the view state (core/view-store.ts, per layer): 'hz' slides the trains of the nearest
 * HŽ station in place of the trams and buses (owner, 5 Oct 2026: the trains are not a row of the timeline; they wait
 * behind a small train button on the departures block, one tap to see them, a tap on a train to open the station).
 */
export const DEPARTURES_FILTER = 'departures';

/** Whether the block shows the trains: the toggle is on and a station is inside the circle (city/feed.ts railNearest). */
export function trainsShown(ctx: LayerContext, place: PlaceContext): boolean {
  return ctx.view?.filters[DEPARTURES_FILTER] === 'hz' && railNearest(ctx, place) !== null;
}

export interface DeparturesOptions {
  rows?: number;
  /** Name the stop above its rows; the block leaves it out when the stop is the place itself. */
  heading?: boolean;
  /** One row of cells: the desk (R1, the wall's departures line in the desk's type); omitted, the desktop surface draws
   *  it and the phone keeps its three rows. */
  line?: boolean;
  /** False leaves the train toggle out (a caller without the city catalogue); omitted, the toggle stands whenever a
   *  station is inside the circle. */
  rail?: boolean;
}

/** The train rows: the station's next trips as timetable rows, each a link that opens the station on Karta. */
function trainRows(ctx: LayerContext, station: { id: string }, board: DepartureBoard, rows: number, frozenAt: number | undefined): { rows: string[]; status: ReturnType<typeof arrivalsAt>['status'] } {
  const { i18n } = ctx;
  const selection: PublicSelection = { kind: 'place', id: station.id };
  const link = `href="${a(selectionHref('u-pokretu', selection))}" data-action="nav" data-layer="u-pokretu" data-selection="${a(JSON.stringify(selection))}"`;
  const answer = arrivalsAt([board], [], ctx.now, { stopIds: [board.stopId], rows });
  const out = answer.rows
    // The timetable's times, never live; the badge is the HŽ short name, "Vlak" where there is none (as the wall's row).
    .map((row) => ({ ...row, routeName: RAIL_SHORT_NAME.test(row.routeName) ? row.routeName : i18n.t('arrivals.train'), live: false, minutes: null }))
    .filter(vettedArrival)
    .map((row) => departureRow(i18n, row, () => 'other', frozenAt, 'timetable', ctx.now, undefined, link));
  return { rows: out, status: answer.status };
}

/** One row in the rows' own box: a placeholder while the board is on its way, else one short sentence. */
const emptyRow = (text: string | null): string => text === null
  ? '<li class="sada-departure-empty" aria-hidden="true"><span class="skeleton"></span></li>'
  : `<li class="sada-departure-empty">${e(text)}</li>`;

export function departuresBlock(ctx: LayerContext, place: PlaceContext, opts: DeparturesOptions = {}): string {
  const { i18n } = ctx;
  const stop = place.departuresStop;
  // The desk's Sada (the same test as layers/grad-sada.ts): the rows stand side by side as one line (overview.css).
  const line = opts.line ?? ctx.screen?.surface === 'desktop';
  // The nearest HŽ station inside the circle, when the catalogue holds one: the toggle's subject.
  const rail = opts.rail === false ? null : railNearest(ctx, place);
  const trains = rail !== null && ctx.view?.filters[DEPARTURES_FILTER] === 'hz';
  // The catalogue is in hand and no platform is within reach of the place: nothing to board (the trains stay behind
  // their toggle only where there is a stop to stand beside).
  if (!stop && ctx.stops) return '';
  // One frozen moment for the whole block: the shell's own, else now when only the session flag says so.
  const frozenAt = ctx.frozenAt ?? (ctx.session?.frozen ? ctx.now : undefined);
  const frozen = frozenAt !== undefined;
  let body: string;
  let busy = false;
  if (trains) {
    const { station, board } = rail!;
    if (!board) {
      // The station's board is on its way (city/feed.ts askNearby asked for it) while live; never coming once frozen.
      busy = !frozen;
      body = emptyRow(frozen ? i18n.t('arrivals.frozen') : null);
    } else {
      const got = trainRows(ctx, station, board, opts.rows ?? DEPARTURE_ROWS, frozenAt);
      body = got.rows.length ? got.rows.join('') : emptyRow(i18n.t(got.status === 'down' ? 'arrivals.down' : 'sada.noTrains'));
    }
  } else if (!stop) {
    // No catalogue yet: on its way while live, down when its load failed, never coming once frozen.
    busy = !frozen && !ctx.stopsDown;
    body = emptyRow(frozen ? i18n.t('arrivals.frozen') : ctx.stopsDown ? i18n.t('arrivals.down') : null);
  } else {
    const ids = platformIds(stop, ctx.stops);
    if (!frozen) ctx.boards?.ensure('zet', ids, ctx.onLocalData);
    const held = ids.map((id) => ctx.boards?.get('zet', id)).filter((b): b is DepartureBoard => Boolean(b));
    // Live only while the feed is (city/feed.ts liveFixes): no live time during an outage or off a stale fix.
    const answer = arrivalsAt(held, liveFixes(ctx.snapshots['zet-rt'], ctx.now), ctx.now, {
      stopIds: ids, rows: opts.rows ?? DEPARTURE_ROWS, cancelled: cancelledTrips(ctx.snapshots['zet-rt']),
    });
    // Every row's line and headsign are ZET's text (kiosk/arrivals.ts vettedArrival): a row that fails the check is
    // left out; until the policy is in hand the rows hold their place rather than say the timetable is missing.
    const rows = answer.rows.filter(vettedArrival);
    if (rows.length) {
      body = rows.map((row) => departureRow(i18n, row, kindOfRoute, frozenAt, 'departure', ctx.now)).join('');
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
  // The stop's name is ZET's text too, the station's HŽ's: vetted before either names the block or heads it.
  const stopName = stop ? vetExternal('name', stop.name, 'row') : null;
  const stationName = rail ? railPlaceName(vetExternal('name', rail.station.name, 'row') ?? '') : '';
  const label = trains ? i18n.t('sada.trainsAt', { station: stationName })
    : stopName !== null ? i18n.t('sada.departuresAt', { stop: stopName }) : i18n.t('arrivals.title');
  const heading = trains ? `<h3 class="sada-departures-title">${e(label)}</h3>`
    : opts.heading && stopName !== null && stopName.trim() !== place.name.trim() ? `<h3 class="sada-departures-title">${e(stopName)}</h3>` : '';
  // The train toggle (owner, 5 Oct 2026): a small train glyph with its word at the head's end, pressed while the trains
  // show; the tap writes the view's filter, so the state survives a poll and a return to the layer. While ZET's fleet
  // is silent or reduced (the wall's rail policy) a dot on it says the trains are worth a look; nothing switches by itself.
  const hint = rail !== null && !trains && railPolicy(serviceStateOf(ctx.snapshots['zet-rt'], ctx.now).kind) !== undefined;
  const toggle = rail === null ? '' : `<button type="button" class="sada-departures-mode" data-testid="departures-trains" data-action="filter" data-filter-key="${DEPARTURES_FILTER}" data-filter-value="${trains ? 'zet' : 'hz'}" aria-pressed="${trains}" aria-label="${a(i18n.t(trains ? 'sada.transitShow' : 'sada.trainsShow', { station: stationName }))}"${hint ? ' data-hint="1"' : ''}>${iconMarkup('train-front')}<span>${e(i18n.t('sada.trains'))}</span></button>`;
  const head = heading || toggle ? `<div class="sada-departures-head">${heading}${toggle}</div>` : '';
  return `<section class="sada-departures" data-key="departures" aria-label="${a(label)}">${head}<ul class="sada-departure-list" data-testid="day-departures"${line ? ' data-line="1"' : ''}${trains ? ' data-mode="hz"' : ''}${busy ? ' aria-busy="true"' : ''}>${body}</ul></section>`;
}

/** The old entry point, kept until Sada calls departuresBlock itself (WP4 chunk B): the page's place, else one resolved from the context. */
export const nextDepartures = (ctx: LayerContext): string =>
  departuresBlock(ctx, ctx.place ?? resolvePlace({ screen: ctx.screen, saved: ctx.saved, stops: ctx.stops, location: ctx.location }), { heading: true });
