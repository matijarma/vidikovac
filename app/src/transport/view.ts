// The transport sheet's markup, as strings a workspace sets into its stable
// containers: route and stop rows, the search listbox, the overview, the
// four detail views and the closures-and-notices list. Pure and escaped --
// every interpolated value goes through escapeHtml/escapeAttribute (dom/
// escape.ts), and every interactive element carries a `data-action` the
// workspace's one delegated click handler reads, never a closure handler on
// a node the next render discards.
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

/** The number on the front of the vehicle, in its mode's colour. */
export function badge(short: string, type: number): string {
  return `<span class="t-badge" data-kind="${vehicleKind(type)}">${esc(short)}</span>`;
}

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

/** Up to ROW_BADGES route badges and a "+n" for the rest. */
export function badgeList(routes: readonly RouteEntry[]): string {
  const shown = routes.slice(0, ROW_BADGES).map((r) => badge(r.short, r.type)).join('');
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
}

function routeButton(i18n: I18n, row: RouteSummaryRow, route: RouteEntry): string {
  const sub = [trPlural(i18n, 'vehiclesNow', row.count), row.word].filter(Boolean).join(' · ');
  return `<li><button type="button" class="t-row" data-action="select-route" data-id="${attr(row.routeId)}">${rowInner(badge(row.label, row.type), esc(route.long || kindWord(i18n, row.type)), esc(sub))}</button></li>`;
}

/** Nothing selected, nothing typed: what runs now, the screen's stop, how to go on. */
export function overviewMarkup(i18n: I18n, d: OverviewData): string {
  const head = `<h3 class="t-title">${esc(tr(i18n, 'overviewTitle'))}</h3>`;
  const status = d.sourceStatus ? `<p class="t-status" data-testid="transport-source-status">${esc(d.sourceStatus)}</p>` : '';
  let running: string;
  if (d.loading) running = `<p class="t-empty">${esc(i18n.t('status.loading'))}</p>`;
  else if (d.routes.length === 0) running = `<p class="t-empty" data-testid="transport-none-running">${esc(tr(i18n, 'noRunning'))}</p>`;
  else {
    running =
      `<p class="t-lead" data-testid="transport-total">${esc(trPlural(i18n, 'vehiclesNow', d.total))}</p>` +
      `<ul class="t-list" data-testid="running-routes">${d.routes.map((row) => routeButton(i18n, row, d.routeOf(row.routeId))).join('')}</ul>`;
  }
  const stop = d.screenStop
    ? `<section class="t-block" data-testid="screen-stop"><h4 class="t-subtitle">${esc(tr(i18n, 'screenStop'))}</h4>` +
      `<button type="button" class="t-row" data-action="select-stop" data-id="${attr(d.screenStop.id)}">${rowInner(badgeList(d.screenStop.routes.map(d.routeOf)), esc(d.screenStop.name), '')}</button></section>`
    : '';
  const hint = d.kiosk ? '' : `<p class="t-hint">${esc(tr(i18n, 'overviewHint'))}</p>`;
  return `${head}${status}${running}${stop}${hint}`;
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
    `<h3 class="t-title" data-testid="vehicle-title">${badge(v.short, v.type)}<span>${esc(vehicleTitle(i18n, v))}</span></h3>` +
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
      return `<li><button type="button" class="t-row" data-action="select-vehicle" data-id="${attr(v.id)}">${rowInner(badge(v.short, v.type), esc(`${vehicleTitle(i18n, v)} · ${d.directions.get(v.id) ?? i18n.t('motion.directionUnknown')}`), esc(sub))}</button></li>`;
    })
    .join('');
  const more = d.vehicles.length > shown.length ? `<p class="t-meta">${esc(trPlural(i18n, 'moreVehicles', d.vehicles.length - shown.length))}</p>` : '';
  const vehicles =
    d.vehicles.length > 0
      ? `<p class="t-lead">${esc(trPlural(i18n, 'vehiclesNow', d.vehicles.length))}</p><ul class="t-list" data-testid="route-vehicles">${vehicleRows}</ul>${more}`
      : `<p class="t-empty" data-testid="route-no-vehicles">${esc(tr(i18n, 'noVehiclesNow'))}</p>`;
  const stops =
    d.stops.length > 0
      ? `<ol class="t-list t-stops" data-testid="route-stops">${d.stops.map((s) => `<li><button type="button" class="t-row" data-action="select-stop" data-id="${attr(s.id)}">${esc(s.name)}</button></li>`).join('')}</ol>`
      : `<p class="t-empty">${esc(i18n.t(d.hasNetwork ? 'status.empty' : 'status.loading'))}</p>`;
  return (
    `<h3 class="t-title" data-testid="route-title">${badge(route.short, route.type)}<span>${esc(route.long || tr(i18n, 'routeTitle', { short: route.short }))}</span></h3>` +
    `<p class="t-meta" data-testid="route-meta">${esc(meta)}</p>` +
    `<section class="t-block"><h4 class="t-subtitle">${esc(tr(i18n, 'routeVehicles'))}</h4>${vehicles}<p class="t-note">${esc(tr(i18n, 'noArrivals'))}</p></section>` +
    `<section class="t-block"><h4 class="t-subtitle">${esc(tr(i18n, 'routeStops'))}</h4>${stops}</section>` +
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
  const rows = d.routes.map((r) => `<li><button type="button" class="t-row" data-action="select-route" data-id="${attr(r.id)}">${routeRowInner(i18n, r, d.counts.get(r.id) ?? 0, d.delays.get(r.id))}</button></li>`).join('');
  const moving = d.routes.reduce((sum, r) => sum + (d.counts.get(r.id) ?? 0), 0);
  const lead = moving > 0 ? `<p class="t-lead" data-testid="stop-moving">${esc(trPlural(i18n, 'vehiclesNow', moving))}</p>` : `<p class="t-empty">${esc(tr(i18n, 'noStopVehicles'))}</p>`;
  return (
    `<h3 class="t-title" data-testid="stop-title">${esc(d.stop.name)}</h3><p class="t-meta">${esc(meta)}</p>` +
    `<section class="t-block"><h4 class="t-subtitle">${esc(tr(i18n, 'stopRoutes'))}</h4>${lead}<ul class="t-list" data-testid="stop-routes">${rows}</ul><p class="t-note">${esc(tr(i18n, 'noArrivals'))}</p></section>` +
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

/** The closures beside the map and ZET's own notices, as one block of the overview. Static rows when there is no map to show one on. */
export function closuresMarkup(i18n: I18n, closures: readonly FeedItem[], notices: readonly FeedItem[], sourceStatus: string | null, selectedId: string | null, interactive = true): string {
  const status = sourceStatus ? `<p class="t-status">${esc(sourceStatus)}</p>` : '';
  const rows = closures
    .map((c) => {
      const inner = rowInner('<span class="t-mark t-mark-closure" aria-hidden="true"></span>', esc(c.title), esc(closureLine(i18n, c)));
      return interactive
        ? `<li><button type="button" class="t-row" data-action="select-closure" data-id="${attr(c.id)}" aria-pressed="${c.id === selectedId ? 'true' : 'false'}">${inner}</button></li>`
        : `<li><div class="t-row t-row-static">${inner}</div></li>`;
    })
    .join('');
  const list = closures.length > 0 ? `<ul class="t-list" data-testid="transport-closures">${rows}</ul>` : `<p class="t-empty" data-testid="transport-no-closures">${esc(tr(i18n, 'noClosures'))}</p>`;
  const noticeRows = notices
    .map((n) => {
      const when = n.at ? `<span class="t-row-sub">${esc(zagrebDateTime(n.at))}</span>` : '';
      const link = n.link ? `<a class="t-link" href="${attr(n.link)}" rel="noopener noreferrer" target="_blank">${esc(tr(i18n, 'openNotice'))}</a>` : '';
      return `<li class="t-notice"><span class="t-row-main"><span class="t-row-title">${esc(n.title)}</span>${when}</span>${link}</li>`;
    })
    .join('');
  const noticeList = notices.length > 0 ? `<h4 class="t-subtitle">${esc(tr(i18n, 'notices'))}</h4><ul class="t-list" data-testid="transport-notices">${noticeRows}</ul>` : '';
  return `<section class="t-block"><h4 class="t-subtitle">${esc(i18n.t('panels.closures'))}</h4>${status}${list}${noticeList}</section>`;
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
      return `<li data-testid="delay-row"${hidden}><button type="button" class="t-row" data-action="select-route" data-id="${attr(row.routeId)}">${rowInner(badge(route.short, route.type), esc(route.long || kindWord(i18n, route.type)), esc(delayWord(i18n, row.delay)))}</button></li>`;
    })
    .join('');
  const folded = rows.length - DELAY_ROWS;
  const more = folded > 0 ? button({ action: 'toggle-delays', label: open ? tr(i18n, 'collapse') : i18n.t('panels.moreRoutes', { count: folded }), className: 'btn-ghost t-action', pressed: open }) : '';
  return `<section class="t-block" id="u-pokretu-delays" data-testid="transport-delays"><h4 class="t-subtitle">${esc(i18n.t('panels.delays'))}</h4><ul class="t-list">${items}</ul>${more}</section>`;
}
