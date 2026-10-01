// Read-only touch content, loaded on the first gesture, never on the wall's first paint.
// Selection, external-text checks and rich-to-lean variants are unchanged from timeline.ts.
import type { ArrivalRow, ArrivalsStatus } from '../../../shared/city/arrivals';
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';
import type { I18n } from '../i18n/i18n';
import { escapeAttribute as a, escapeHtml as e } from '../ui/dom/escape';
import { vettedArrival } from './arrivals';
import { kindOfRoute } from './exceptions';
import { clock } from './format';
import type { OnDutyPharmacy } from './pharmacies';
import { dayLabel, isTimeless, rowTextKinds, timeLabel, vettedTimelineRow, type TimelineRow } from './timeline';

/** A stop's board leads with Sada's three departures, never more [O-27]. */
export const STOP_BOARD_ROWS = 3;
/** Trips after the three departures in the timetable line. */
export const TIMETABLE_LINE_TRIPS = 4;
export const STOP_BOARD_TIMETABLE_ROWS = STOP_BOARD_ROWS + TIMETABLE_LINE_TRIPS;

type TransportView = Pick<typeof import('../transport/view'), 'departureRow'>;
let transportView: TransportView | null = null;
let transportViewLoad: Promise<boolean> | null = null;
let transportViewFailed = false;
/** The shared phone row loads once; a failed request can be retried on the next gesture. */
export function loadStopBoardRows(): Promise<boolean> {
  if (transportView) return Promise.resolve(true);
  transportViewLoad ??= import('../transport/view').then((module) => {
    transportView = module;
    transportViewFailed = false;
    return true;
  }, () => {
    transportViewLoad = null;
    transportViewFailed = true;
    return false;
  });
  return transportViewLoad;
}

export interface StopBoardModel {
  name: string;
  rows: readonly ArrivalRow[];
  timetable: readonly ArrivalRow[];
  status: ArrivalsStatus;
}
const tripKey = (row: ArrivalRow): string => row.tripId || `${row.routeId}|${row.atMs}`;

function timetableLine(i18n: I18n, trips: readonly ArrivalRow[]): string {
  const items = trips.map((trip) => {
    const route = vetExternal('headsign', trip.routeName, 'row');
    return route === null ? '' : `<span class="k-touch-trip">${e(route)} <time datetime="${a(new Date(trip.atMs).toISOString())}">${e(clock(trip.atMs))}</time></span>`;
  }).filter(Boolean);
  if (items.length === 0) return '';
  return `<p class="k-touch-timetable" data-testid="stop-board-timetable"><span class="k-touch-timetable-head">${e(i18n.t('arrivals.timetable'))}</span> · ${items.join(' · ')}</p>`;
}

/** Whole departures first, then timetable trips, with leaner variants for a smaller box. */
export function stopBoardVariants(i18n: I18n, board: StopBoardModel): string[] {
  const title = vetExternal('name', board.name, 'row') ?? i18n.t('arrivals.title');
  const view = transportView;
  const lead = view ? board.rows.filter(vettedArrival).slice(0, STOP_BOARD_ROWS) : [];
  const leadKeys = new Set(lead.map(tripKey));
  const later = view ? board.timetable.filter(vettedArrival).filter((row) => !leadKeys.has(tripKey(row))).slice(0, TIMETABLE_LINE_TRIPS) : [];
  const empty = !view
    ? i18n.t(transportViewFailed ? 'arrivals.down' : 'status.loading')
    : board.rows.length > 0 || board.status === 'down' ? i18n.t('arrivals.down') : board.status === 'none' ? i18n.t('status.loading') : i18n.t('arrivals.none');
  const variant = (rows: number, trips: number): string => `<div class="k-touch-body" data-testid="stop-board">`
    + `<h2 class="k-touch-title">${e(title)}</h2>`
    + (view && lead.length > 0 ? `<ul class="k-touch-rows">${lead.slice(0, rows).map((row) => view.departureRow(i18n, row, kindOfRoute)).join('')}</ul>` : `<p class="k-touch-line">${e(empty)}</p>`)
    + (trips > 0 ? timetableLine(i18n, later.slice(0, trips)) : '')
    + '</div>';
  return [...new Set([variant(STOP_BOARD_ROWS, TIMETABLE_LINE_TRIPS), variant(STOP_BOARD_ROWS, 2), variant(STOP_BOARD_ROWS, 0), variant(2, 0), variant(1, 0)])];
}

/** A row's own whole words and time; an address yields before the supplied short labels. */
export function rowDetailVariants(i18n: I18n, row: TimelineRow, now: number, address?: string | null): string[] {
  if (!vettedTimelineRow(row)) return [];
  const kinds = rowTextKinds(row);
  const title = vetExternal(kinds.title, row.title, 'row');
  if (title === null) return [];
  const sub = row.sub ? vetExternal(kinds.sub, row.sub, 'row') : null;
  const titleShort = row.titleShort ? vetExternal(kinds.title, row.titleShort, 'row') : null;
  const subShort = row.subShort ? vetExternal(kinds.sub, row.subShort, 'row') : null;
  const where = address ? vetExternal('address', address, 'row') : null;
  const timeless = isTimeless(row);
  const when = e(timeLabel(row, now, i18n));
  const day = dayLabel(row, now, i18n);
  const moment = timeless ? `<span>${when}</span>` : `<time datetime="${a(new Date(row.atMs!).toISOString())}">${when}</time>`;
  const variant = (heading: string, line: string | null, place: string | null): string =>
    `<div class="k-touch-body" data-testid="touch-detail" data-kind="${a(row.kind)}">`
    + `<p class="k-touch-when">${moment}${day ? ` <span class="k-touch-day">${e(day)}</span>` : ''}</p>`
    + `<h2 class="k-touch-title">${e(heading)}</h2>`
    + (line ? `<p class="k-touch-line">${e(line)}</p>` : '')
    + (place ? `<p class="k-touch-line">${e(place)}</p>` : '')
    + '</div>';
  return [...new Set([variant(title, sub, where), variant(title, sub, null), variant(title, subShort ?? sub, null), variant(titleShort ?? title, subShort ?? sub, null), variant(titleShort ?? title, null, null)])];
}

/** The City's curated phone display form, not arbitrary feed text. */
const PHONE_DISPLAY = /^0\d{1,2}(?: \d{2,4}){1,3}$/u;
export function pharmacyDetailVariants(i18n: I18n, words: { caption: string; hours: string }, pharmacy: OnDutyPharmacy): string[] {
  const address = vetExternal('address', pharmacy.label, 'row');
  const caption = address === null ? words.hours : words.caption.replace('{address}', address);
  const name = vetExternal('name', pharmacy.name, 'row');
  const phone = pharmacy.phoneDisplay !== null && PHONE_DISPLAY.test(pharmacy.phoneDisplay) ? pharmacy.phoneDisplay : null;
  const call = phone === null ? i18n.t('safety.noPhone') : i18n.t('safety.call', { number: phone });
  const variant = (named: boolean): string => `<div class="k-touch-body" data-testid="touch-detail" data-kind="pharmacy">`
    + `<p class="k-touch-kicker"><span class="k-touch-cross" aria-hidden="true"></span>${e(caption)}</p>`
    + (named && name ? `<h2 class="k-touch-title">${e(name)}</h2>` : '')
    + `<p class="k-touch-line k-touch-phone">${e(call)}</p>`
    + '</div>';
  return [...new Set([variant(true), variant(false)])];
}
