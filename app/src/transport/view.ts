// The transport sheet's markup, as strings a workspace sets into its stable
// containers: route and stop rows, the search listbox, the overview, the
// four detail views and the closures-and-notices list. Pure and escaped --
// every interpolated value goes through escapeHtml/escapeAttribute (dom/
// escape.ts), and every interactive element carries a `data-action` the
// workspace's one delegated click handler reads, never a closure handler on
// a node the next render discards. Long lists are bounded: every row is in
// the DOM (a reader or a test can count them), the tail hidden behind one
// labelled fold button, and every row has a stable id so a poll's re-render
// puts focus back where it was.
import type { FeedItem } from '../../../worker/feed/schema';
import { zagrebDateTime } from '../format';
import type { I18n } from '../i18n/i18n';
import type { RouteSummaryRow } from '../layers/route-summary';
import { delayWord } from '../layers/shared';
import { vehicleKind, type MapStatus, type VehicleInfo } from '../map/city-map';
import { dataText } from '../panels/panel';
import { escapeAttribute as attr, escapeHtml as esc } from '../ui/dom/escape';
import type { RouteStop } from './catalogue';
import type { RouteEntry, SearchResults, StopGroup } from './search';
import { tr, trPlural, type TransportKey } from './strings';

/** Route badges the rows show before "+n". */
const ROW_BADGES = 6;
/** Line badges the peek shows before "+n". */
export const PEEK_BADGES = 4;
/** Rows a list shows before its fold. */
export const RUNNING_ROWS = 8;
export const CLOSURE_ROWS = 4;
export const STOP_ROWS = 12;
/** ZET notices the overview lists. */
export const NOTICE_ROWS = 3;

/** The folds a person opens in place. The delays block keeps its own `toggle-delays` action. */
export type Fold = 'routes' | 'closures' | 'stops';

/** s in dense rows and the peek, m on boards, l on a detail head. */
export type BadgeSize = 's' | 'm' | 'l';

/** The number on the front of the vehicle, in its mode's colour and shape.
 *  `line` and the data attributes are the shared badge component's contract
 *  (wave 2 restyles it without touching this markup); `t-badge` still carries
 *  today's styles. */
export function badge(short: string, type: number, size: BadgeSize = 'm'): string {
  return `<span class="t-badge line" data-kind="${vehicleKind(type)}" data-size="${size}">${esc(short)}</span>`;
}

export const safeId = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, '_');
/** A stable id per row (t-row-route-6, t-row-stop-106_1) so swapBody restores focus across polls. */
export const rowId = (kind: string, id: string): string => `t-row-${kind}-${safeId(id)}`;

/** "tramvaj" / "autobus" / "vozilo" for a GTFS route type. */
export function kindWord(i18n: I18n, type: number): string {
  const kind = vehicleKind(type);
  return kind === 'other' ? tr(i18n, 'vehicle').toLocaleLowerCase(i18n.getLocale()) : tr(i18n, kind);
}

export interface ButtonSpec {
  action: string;
  label: string;
  id?: string;
  data?: Record<string, string>;
  pressed?: boolean;
  primary?: boolean;
  className?: string;
}

export function button(spec: ButtonSpec): string {
  const data = Object.entries(spec.data ?? {}).map(([k, v]) => ` data-${k}="${attr(v)}"`).join('');
  const id = spec.id ? ` id="${attr(spec.id)}"` : '';
  const pressed = spec.pressed === undefined ? '' : ` aria-pressed="${spec.pressed ? 'true' : 'false'}"`;
  const cls = spec.className ?? (spec.primary ? 'btn t-action' : 'btn-ghost t-action');
  return `<button type="button" class="${attr(cls)}"${id} data-action="${attr(spec.action)}"${data}${pressed}>${esc(spec.label)}</button>`;
}

/** The one button under a bounded list: "još 3 linije" / "sve zatvaranja (6)" closed, "Skupi" open. */
function foldButton(i18n: I18n, fold: Fold, open: boolean, moreLabel: string): string {
  return button({ action: 'toggle-fold', id: `t-fold-${fold}`, label: open ? tr(i18n, 'collapse') : moreLabel, className: 'btn-ghost t-action t-fold', data: { fold }, pressed: open });
}

/** A section head in sentence case at head size; h3 in the overview, h4 under a detail title. */
function sectionHead(label: string, level: 3 | 4 = 3): string {
  return `<h${level} class="t-head">${esc(label)}</h${level}>`;
}

/** Up to ROW_BADGES small route badges and a "+n" for the rest. */
export function badgeList(routes: readonly RouteEntry[]): string {
  const shown = routes.slice(0, ROW_BADGES).map((r) => badge(r.short, r.type, 's')).join('');
  const more = routes.length > ROW_BADGES ? `<span class="t-badge-more">+${routes.length - ROW_BADGES}</span>` : '';
  return `<span class="t-badges">${shown}${more}</span>`;
}

function rowInner(lead: string, title: string, sub: string): string {
  return `${lead}<span class="t-row-main"><span class="t-row-title">${title}</span>${sub ? `<span class="t-row-sub">${sub}</span>` : ''}</span>`;
}

/** One route as a row: badge, long name, vehicles moving now and the delay word when known. */
export function routeRowInner(i18n: I18n, route: RouteEntry, count: number | null, delay: number | undefined): string {
  const parts: string[] = [];
  if (count !== null) parts.push(count > 0 ? trPlural(i18n, 'vehiclesNow', count) : tr(i18n, 'noVehiclesNow'));
  if (delay !== undefined) parts.push(delayWord(i18n, delay));
  return rowInner(badge(route.short, route.type), esc(route.long || kindWord(i18n, route.type)), esc(parts.join(' · ')));
}

/** One named stop as a row: its routes as badges, its name, its platform count. */
export function stopRowInner(i18n: I18n, stop: StopGroup, routes: readonly RouteEntry[]): string {
  return rowInner(badgeList(routes), esc(stop.name), esc(trPlural(i18n, 'platforms', stop.ids.length)));
}

export interface ResultIds {
  list: string;
  option: (kind: 'route' | 'stop', id: string) => string;
}

export interface ResultsData {
  query: string;
  results: SearchResults;
  counts: ReadonlyMap<string, number>;
  delays: ReadonlyMap<string, number>;
  routeOf: (id: string) => RouteEntry;
  /** The option id aria-activedescendant points at. */
  active: string | null;
  ids: ResultIds;
}

/** The combobox's listbox: routes first, then stops, one flat list with two headings. */
export function resultsMarkup(i18n: I18n, d: ResultsData): string {
  const total = d.results.routes.length + d.results.stops.length;
  if (total === 0) return `<p class="t-empty" data-testid="transport-no-results">${esc(tr(i18n, 'noResults', { query: d.query }))}</p>`;
  const option = (kind: 'route' | 'stop', id: string, inner: string): string => {
    const oid = d.ids.option(kind, id);
    return `<li role="option" id="${attr(oid)}" class="t-row t-option" data-action="select-${kind}" data-id="${attr(id)}" aria-selected="${d.active === oid ? 'true' : 'false'}">${inner}</li>`;
  };
  const heading = (label: string): string => `<li role="presentation" class="t-group-label">${esc(label)}</li>`;
  const routes = d.results.routes.map((r) => option('route', r.id, routeRowInner(i18n, r, d.counts.get(r.id) ?? 0, d.delays.get(r.id))));
  const stops = d.results.stops.map((s) => option('stop', s.id, stopRowInner(i18n, s, s.routes.map(d.routeOf))));
  return (
    `<p class="visually-hidden" role="status">${esc(trPlural(i18n, 'resultsCount', total))}</p>` +
    `<ul role="listbox" id="${attr(d.ids.list)}" class="t-list t-results" aria-label="${attr(tr(i18n, 'searchResults'))}" data-testid="transport-results">` +
    `${routes.length > 0 ? heading(tr(i18n, 'routes')) + routes.join('') : ''}${stops.length > 0 ? heading(tr(i18n, 'stops')) + stops.join('') : ''}</ul>`
  );
}

export interface PeekData {
  /** The lines the board leads with: this stop's, else the busiest. */
  routes: readonly { short: string; type: number }[];
  /** Lines beyond the badges shown. */
  more: number;
  vehicles: number;
  closures: number;
}

/** The collapsed sheet's one line: up to four small badges, "+n", then "193 vozila u pokretu · 37 zatvaranja". Nothing here is interactive. */
export function peekMarkup(i18n: I18n, d: PeekData): string {
  const badges = d.routes.map((r) => badge(r.short, r.type, 's')).join('');
  const more = d.more > 0 ? `<span class="t-peek-more">+${d.more}</span>` : '';
  const lines = badges ? `<span class="t-peek-lines">${badges}${more}</span> ` : '';
  return `${lines}<span class="t-peek-count">${esc(`${trPlural(i18n, 'vehiclesNow', d.vehicles)} · ${trPlural(i18n, 'closuresNow', d.closures)}`)}</span>`;
}

export interface OverviewData {
  /** Routes with a vehicle moving now, trams first. */
  routes: RouteSummaryRow[];
  /** Vehicles moving now among the admitted modes. */
  total: number;
  /** No zet-rt snapshot has arrived yet. */
  loading: boolean;
  /** The source's own stale/down sentence, or null while it answers. */
  sourceStatus: string | null;
  screenStop: { id: string; name: string; routes: readonly string[] } | null;
  routeOf: (id: string) => RouteEntry;
  kiosk: boolean;
  /** The running-routes fold is open: every row shown. */
  routesOpen: boolean;
}

function routeButton(i18n: I18n, row: RouteSummaryRow, route: RouteEntry, hidden: boolean): string {
  const sub = [trPlural(i18n, 'vehiclesNow', row.count), row.word].filter(Boolean).join(' · ');
  return `<li${hidden ? ' hidden' : ''}><button type="button" class="t-row" id="${rowId('route', row.routeId)}" data-action="select-route" data-id="${attr(row.routeId)}">${rowInner(badge(row.label, row.type), esc(route.long || kindWord(i18n, row.type)), esc(sub))}</button></li>`;
}

/** Nothing selected, nothing typed: what runs now (eight rows, then the fold) and the screen's stop. */
export function overviewMarkup(i18n: I18n, d: OverviewData): string {
  const status = d.sourceStatus ? `<p class="t-status" data-testid="transport-source-status">${esc(d.sourceStatus)}</p>` : '';
  let running: string;
  if (d.loading) running = `<p class="t-empty">${esc(i18n.t('status.loading'))}</p>`;
  else if (d.routes.length === 0) running = `<p class="t-empty" data-testid="transport-none-running">${esc(tr(i18n, 'noRunning'))}</p>`;
  else {
    const rows = d.routes.map((row, i) => routeButton(i18n, row, d.routeOf(row.routeId), i >= RUNNING_ROWS && !d.routesOpen)).join('');
    const folded = d.routes.length - RUNNING_ROWS;
    running =
      `<p class="t-lead" data-testid="transport-total">${esc(trPlural(i18n, 'vehiclesNow', d.total))}</p>` +
      `<ul class="t-list" data-testid="running-routes">${rows}</ul>` +
      (folded > 0 ? foldButton(i18n, 'routes', d.routesOpen, i18n.t('panels.moreRoutes', { count: folded })) : '');
  }
  const stop = d.screenStop
    ? `<section class="t-block" data-testid="screen-stop">${sectionHead(tr(i18n, 'screenStop'))}` +
      `<button type="button" class="t-row" id="${rowId('stop', d.screenStop.id)}" data-action="select-stop" data-id="${attr(d.screenStop.id)}">${rowInner(badgeList(d.screenStop.routes.map(d.routeOf)), esc(d.screenStop.name), '')}</button></section>`
    : '';
  return `<section class="t-block">${sectionHead(tr(i18n, 'runningRoutes'))}${status}${running}</section>${stop}`;
}

/** The map's own state line, or null while it draws. */
export function statusLine(i18n: I18n, status: MapStatus): string | null {
  const key: TransportKey | null = status === 'loading' ? 'mapLoading' : status === 'tiles-failed' ? 'tilesFailed' : status === 'unavailable' ? 'mapUnavailable' : null;
  return key ? tr(i18n, key) : null;
}

function capital(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/** "Tramvaj 6", "Autobus 109", "Vozilo" for a route nobody knows. */
export function vehicleTitle(i18n: I18n, v: VehicleInfo): string {
  const kind = capital(kindWord(i18n, v.type), i18n.getLocale());
  return v.short ? tr(i18n, 'vehicleTitle', { kind, short: v.short }) : kind;
}

function actions(buttons: string[]): string {
  return `<div class="t-actions">${buttons.join('')}</div>`;
}

const showOnMap = (i18n: I18n): string => button({ action: 'fit-selection', label: tr(i18n, 'showOnMap') });
const clear = (i18n: I18n): string => button({ action: 'clear-selection', label: tr(i18n, 'clearSelection'), id: 't-clear-selection' });

export interface VehicleDetailData {
  vehicle: VehicleInfo;
  route: RouteEntry | null;
  /** vehicleDirection()'s sentence. */
  direction: string;
  delay: number | undefined;
  following: boolean;
  kiosk: boolean;
}

export function vehicleDetailMarkup(i18n: I18n, d: VehicleDetailData): string {
  const { vehicle: v } = d;
  const facts = [
    `<li data-testid="vehicle-direction">${esc(d.direction)}</li>`,
    d.route?.long ? `<li>${esc(d.route.long)}</li>` : '',
    `<li>${esc(d.delay === undefined ? i18n.t('motion.delayUnknown') : i18n.t('motion.delay', { word: delayWord(i18n, d.delay) }))}</li>`,
    v.held ? `<li>${esc(capital(tr(i18n, 'held'), i18n.getLocale()))}</li>` : '',
    v.onShape === null ? `<li>${esc(capital(tr(i18n, 'freeMotion'), i18n.getLocale()))}</li>` : '',
  ].join('');
  const follow = d.kiosk
    ? ''
    : button({ action: d.following ? 'unfollow' : 'follow', label: tr(i18n, d.following ? 'unfollow' : 'follow'), id: 't-follow', data: { id: v.id }, pressed: d.following, primary: !d.following });
  const route = d.route ? button({ action: 'select-route', label: tr(i18n, 'showRoute'), data: { id: d.route.id } }) : '';
  return (
    `<h3 class="t-title" data-testid="vehicle-title">${badge(v.short, v.type, 'l')}<span>${esc(vehicleTitle(i18n, v))}</span></h3>` +
    `<ul class="t-facts">${facts}</ul><p class="t-note">${esc(tr(i18n, 'estimated'))}</p>` +
    (d.kiosk ? '' : actions([follow, route, clear(i18n)])) +
    (d.following ? `<p class="t-hint" data-testid="following-note">${esc(tr(i18n, 'followingNote'))}</p>` : '')
  );
}

export interface RouteDetailData {
  route: RouteEntry;
  vehicles: VehicleInfo[];
  /** vehicle id -> vehicleDirection()'s sentence. */
  directions: ReadonlyMap<string, string>;
  delay: number | undefined;
  stops: RouteStop[];
  /** The network artefact is in: an empty stop list means the route has none, not "still loading". */
  hasNetwork: boolean;
  kiosk: boolean;
  /** The stop-sequence fold is open: every stop shown. */
  stopsOpen: boolean;
}

/** Vehicles listed on a route before "još n vozila". */
const ROUTE_VEHICLE_ROWS = 8;

export function routeDetailMarkup(i18n: I18n, d: RouteDetailData): string {
  const { route } = d;
  const delay = d.delay === undefined ? i18n.t('motion.delayUnknown') : i18n.t('motion.delay', { word: delayWord(i18n, d.delay) });
  const meta = `${capital(kindWord(i18n, route.type), i18n.getLocale())} · ${delay}`;
  const shown = d.vehicles.slice(0, ROUTE_VEHICLE_ROWS);
  const vehicleRows = shown
    .map((v) => {
      const sub = v.held ? tr(i18n, 'held') : v.onShape === null ? tr(i18n, 'freeMotion') : '';
      return `<li><button type="button" class="t-row" id="${rowId('vehicle', v.id)}" data-action="select-vehicle" data-id="${attr(v.id)}">${rowInner(badge(v.short, v.type), esc(`${vehicleTitle(i18n, v)} · ${d.directions.get(v.id) ?? i18n.t('motion.directionUnknown')}`), esc(sub))}</button></li>`;
    })
    .join('');
  const more = d.vehicles.length > shown.length ? `<p class="t-meta">${esc(trPlural(i18n, 'moreVehicles', d.vehicles.length - shown.length))}</p>` : '';
  const vehicles =
    d.vehicles.length > 0
      ? `<p class="t-lead">${esc(trPlural(i18n, 'vehiclesNow', d.vehicles.length))}</p><ul class="t-list" data-testid="route-vehicles">${vehicleRows}</ul>${more}`
      : `<p class="t-empty" data-testid="route-no-vehicles">${esc(tr(i18n, 'noVehiclesNow'))}</p>`;
  const stopRows = d.stops
    .map((s, i) => `<li${i >= STOP_ROWS && !d.stopsOpen ? ' hidden' : ''}><button type="button" class="t-row" id="${rowId('stop', s.id)}" data-action="select-stop" data-id="${attr(s.id)}">${esc(s.name)}</button></li>`)
    .join('');
  const stopsFold = d.stops.length > STOP_ROWS ? foldButton(i18n, 'stops', d.stopsOpen, tr(i18n, 'allStops', { count: d.stops.length })) : '';
  const stops =
    d.stops.length > 0
      ? `<ol class="t-list t-stops" data-testid="route-stops">${stopRows}</ol>${stopsFold}`
      : `<p class="t-empty">${esc(i18n.t(d.hasNetwork ? 'status.empty' : 'status.loading'))}</p>`;
  return (
    `<h3 class="t-title" data-testid="route-title">${badge(route.short, route.type, 'l')}<span>${esc(route.long || tr(i18n, 'routeTitle', { short: route.short }))}</span></h3>` +
    `<p class="t-meta" data-testid="route-meta">${esc(meta)}</p>` +
    `<section class="t-block">${sectionHead(tr(i18n, 'routeVehicles'), 4)}${vehicles}<p class="t-note">${esc(tr(i18n, 'noArrivals'))}</p></section>` +
    `<section class="t-block">${sectionHead(tr(i18n, 'routeStops'), 4)}${stops}</section>` +
    (d.kiosk ? '' : actions([showOnMap(i18n), clear(i18n)]))
  );
}

export interface StopDetailData {
  stop: StopGroup;
  routes: RouteEntry[];
  counts: ReadonlyMap<string, number>;
  delays: ReadonlyMap<string, number>;
  isScreenStop: boolean;
  kiosk: boolean;
}

export function stopDetailMarkup(i18n: I18n, d: StopDetailData): string {
  const meta = [tr(i18n, 'stop'), trPlural(i18n, 'platforms', d.stop.ids.length), d.isScreenStop ? tr(i18n, 'screenStop') : ''].filter(Boolean).join(' · ');
  const rows = d.routes
    .map((r) => `<li><button type="button" class="t-row" id="${rowId('route', r.id)}" data-action="select-route" data-id="${attr(r.id)}">${routeRowInner(i18n, r, d.counts.get(r.id) ?? 0, d.delays.get(r.id))}</button></li>`)
    .join('');
  const moving = d.routes.reduce((sum, r) => sum + (d.counts.get(r.id) ?? 0), 0);
  const lead = moving > 0 ? `<p class="t-lead" data-testid="stop-moving">${esc(trPlural(i18n, 'vehiclesNow', moving))}</p>` : `<p class="t-empty">${esc(tr(i18n, 'noStopVehicles'))}</p>`;
  return (
    `<h3 class="t-title" data-testid="stop-title">${esc(d.stop.name)}</h3><p class="t-meta">${esc(meta)}</p>` +
    `<section class="t-block">${sectionHead(tr(i18n, 'stopRoutes'), 4)}${lead}<ul class="t-list" data-testid="stop-routes">${rows}</ul><p class="t-note">${esc(tr(i18n, 'noArrivals'))}</p></section>` +
    (d.kiosk ? '' : actions([showOnMap(i18n), clear(i18n)]))
  );
}

function closureLine(i18n: I18n, item: FeedItem): string {
  const type = i18n.t(`panels.closureType.${dataText(item, 'subtype') || 'ROAD_CLOSED'}`);
  const direction = i18n.t(`panels.direction.${dataText(item, 'direction') || 'BOTH_DIRECTIONS'}`);
  const until = item.until ? i18n.t('panels.until', { time: zagrebDateTime(item.until) }) : '';
  return [type, direction, until].filter(Boolean).join(' · ');
}

export function closureDetailMarkup(i18n: I18n, item: FeedItem, kiosk: boolean): string {
  const facts = [`<li>${esc(closureLine(i18n, item))}</li>`, item.summary ? `<li>${esc(item.summary)}</li>` : ''].join('');
  return (
    `<h3 class="t-title" data-testid="closure-title"><span class="t-mark t-mark-closure" aria-hidden="true"></span><span>${esc(item.title)}</span></h3>` +
    `<p class="t-meta">${esc(tr(i18n, 'closure'))}</p><ul class="t-facts">${facts}</ul>` +
    (kiosk ? '' : actions([showOnMap(i18n), clear(i18n)]))
  );
}

/** The closures beside the map (four, then "sve zatvaranja (n)") and ZET's own notices, as two blocks of the overview.
 *  Static rows and no fold when there is no map to show one on and no handler to open it. */
export function closuresMarkup(i18n: I18n, closures: readonly FeedItem[], notices: readonly FeedItem[], sourceStatus: string | null, selectedId: string | null, interactive = true, open = false): string {
  const status = sourceStatus ? `<p class="t-status">${esc(sourceStatus)}</p>` : '';
  const rows = closures
    .map((c, i) => {
      const inner = rowInner('<span class="t-mark t-mark-closure" aria-hidden="true"></span>', esc(c.title), esc(closureLine(i18n, c)));
      const hidden = interactive && i >= CLOSURE_ROWS && !open ? ' hidden' : '';
      return interactive
        ? `<li${hidden}><button type="button" class="t-row" id="${rowId('closure', c.id)}" data-action="select-closure" data-id="${attr(c.id)}" aria-pressed="${c.id === selectedId ? 'true' : 'false'}">${inner}</button></li>`
        : `<li><div class="t-row t-row-static">${inner}</div></li>`;
    })
    .join('');
  const fold = interactive && closures.length > CLOSURE_ROWS ? foldButton(i18n, 'closures', open, tr(i18n, 'allClosures', { count: closures.length })) : '';
  const list = closures.length > 0 ? `<ul class="t-list" data-testid="transport-closures">${rows}</ul>${fold}` : `<p class="t-empty" data-testid="transport-no-closures">${esc(tr(i18n, 'noClosures'))}</p>`;
  const noticeRows = notices
    .map((n) => {
      const when = n.at ? `<span class="t-row-sub">${esc(zagrebDateTime(n.at))}</span>` : '';
      const link = n.link ? `<a class="t-link" href="${attr(n.link)}" rel="noopener noreferrer" target="_blank">${esc(tr(i18n, 'openNotice'))}</a>` : '';
      return `<li class="t-notice"><span class="t-row-main"><span class="t-row-title">${esc(n.title)}</span>${when}</span>${link}</li>`;
    })
    .join('');
  const noticeList = notices.length > 0 ? `<section class="t-block">${sectionHead(tr(i18n, 'notices'))}<ul class="t-list" data-testid="transport-notices">${noticeRows}</ul></section>` : '';
  return `<section class="t-block">${sectionHead(i18n.t('panels.closures'))}${status}${list}</section>${noticeList}`;
}

export interface DelayRow {
  routeId: string;
  /** The module's median for the route, seconds; negative is early. */
  delay: number;
}

/** Routes shown before the fold of the delays block. */
export const DELAY_ROWS = 8;

/** The module's own per-route medians, worst first: every row is present (a
 *  reader or a test can count them), the tail folded behind one button. In
 *  words, never raw seconds (R-F8), and never an arrival time. */
export function delaysMarkup(i18n: I18n, rows: readonly DelayRow[], routeOf: (id: string) => RouteEntry, open: boolean): string {
  if (rows.length === 0) return '';
  const items = rows
    .map((row, i) => {
      const route = routeOf(row.routeId);
      const hidden = i >= DELAY_ROWS && !open ? ' hidden' : '';
      return `<li data-testid="delay-row"${hidden}><button type="button" class="t-row" id="${rowId('delay', row.routeId)}" data-action="select-route" data-id="${attr(row.routeId)}">${rowInner(badge(route.short, route.type), esc(route.long || kindWord(i18n, route.type)), esc(delayWord(i18n, row.delay)))}</button></li>`;
    })
    .join('');
  const folded = rows.length - DELAY_ROWS;
  const more = folded > 0 ? button({ action: 'toggle-delays', id: 't-fold-delays', label: open ? tr(i18n, 'collapse') : i18n.t('panels.moreRoutes', { count: folded }), className: 'btn-ghost t-action t-fold', pressed: open }) : '';
  return `<section class="t-block" id="u-pokretu-delays" data-testid="transport-delays">${sectionHead(i18n.t('panels.delays'))}<ul class="t-list">${items}</ul>${more}</section>`;
}
