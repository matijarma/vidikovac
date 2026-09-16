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
//
// Everything here is composed from the signage vocabulary (ui/signage.css,
// experience/blocks.ts): a `.row` is the board's row -- a lead, a
// destination, a word for the state -- and a `.line` the number on the
// front of the vehicle. Where a row opens something, the whole row is one
// button (`.t-row`, map.css) inside the row, so the target is the row.
import type { FeedItem } from '../../../worker/feed/schema';
import { closureWords as workerClosureWords } from '../../../worker/feed/modules/prometnice';
import type { CastState } from '../core/contracts';
import type { SavedRef } from '../core/saved-store';
import { lineBadge, signRow } from '../experience/blocks';
import { delayTone, type DelayTone } from '../experience/delay';
import { castReasonText } from '../experience/kvart';
import { zagrebDateTime } from '../format';
import type { I18n } from '../i18n/i18n';
import type { RouteSummaryRow } from '../layers/route-summary';
import { delayWord } from '../layers/shared';
import { vehicleKind, type MapStatus, type VehicleInfo } from '../map/city-map';
import { dataText } from '../panels/panel';
import { escapeAttribute as attr, escapeHtml as esc } from '../ui/dom/escape';
import { iconMarkup, type IconName } from '../ui/icons';
import type { RouteStop } from './catalogue';
import type { RouteEntry, SearchResults, StopGroup } from './search';
import { tr, trPlural, type TransportKey } from './strings';

/** The transport detail head's own extras (T2.7, B.5): route and stop details get a save toggle,
 *  every detail gets the ghost cast button ("Na zaslon", disabled with its reason when it cannot fire). */
export interface DetailHeadExtras {
  save?: SavedRef & { on: boolean };
  cast?: CastState;
}

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

/** The number on the front of the vehicle, in its mode's colour and shape: the shared badge component (blocks.ts lineBadge, signage.css .line). */
export function badge(short: string, type: number, size: BadgeSize = 'm'): string {
  return lineBadge(short, vehicleKind(type), size);
}

/** The closure mark (signage.css): a bar in the urgency role, beside the street's name. */
const closureMark = (): string => '<span class="mark-closure" aria-hidden="true"></span>';

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
  /** A toggle's state (follow / unfollow). */
  pressed?: boolean;
  /** A disclosure's state (a fold), with the id of the list it opens. */
  expanded?: boolean;
  controls?: string;
  icon?: IconName;
  primary?: boolean;
  className?: string;
}

export function button(spec: ButtonSpec): string {
  const data = Object.entries(spec.data ?? {}).map(([k, v]) => ` data-${k}="${attr(v)}"`).join('');
  const id = spec.id ? ` id="${attr(spec.id)}"` : '';
  const pressed = spec.pressed === undefined ? '' : ` aria-pressed="${spec.pressed ? 'true' : 'false'}"`;
  const expanded = spec.expanded === undefined ? '' : ` aria-expanded="${spec.expanded ? 'true' : 'false'}"`;
  const controls = spec.controls ? ` aria-controls="${attr(spec.controls)}"` : '';
  const cls = spec.className ?? (spec.primary ? 'btn t-action' : 'btn-ghost t-action');
  return `<button type="button" class="${attr(cls)}"${id} data-action="${attr(spec.action)}"${data}${pressed}${expanded}${controls}>${spec.icon ? iconMarkup(spec.icon) : ''}${esc(spec.label)}</button>`;
}

/** The ids of the lists a fold opens, so the fold button can say which one. */
const listId = (fold: Fold | 'delays'): string => `t-list-${fold}`;

/** The one button under a bounded list: "još 3 linije" / "sve zatvaranja (6)" closed, "Skupi" open. A disclosure, so it says whether the list is open. */
function foldButton(i18n: I18n, fold: Fold, open: boolean, moreLabel: string): string {
  // The stops fold is the one a test names on its own; the workspace hears every fold through toggle-fold and data-fold.
  const data: Record<string, string> = fold === 'stops' ? { fold, testid: 'toggle-stops' } : { fold };
  return button({ action: 'toggle-fold', id: `t-fold-${fold}`, label: open ? tr(i18n, 'collapse') : moreLabel, className: 'btn-ghost t-action t-fold', data, expanded: open, controls: listId(fold) });
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

/** The row's cells: a lead (a badge, a mark, nothing), the main part (title, second line), a trail (a state word). `title` and `sub` arrive escaped; `lead` and `trail` are markup other builders produced. */
function cells(lead: string, title: string, sub: string, trail = ''): string {
  return `${lead}<span class="row-main"><span class="row-title">${title}</span>${sub ? `<span class="row-sub">${sub}</span>` : ''}</span>${trail}`;
}

/** The state word at a row's end: the delay in words, in its tone (experience/delay.ts), the same component Sada's board paints. */
function stateWord(word: string, tone: DelayTone): string {
  return word ? `<span class="route-delay" data-state="${tone}">${esc(word)}</span>` : '';
}

/** The delay word for a route whose median is known; nothing at all when it is not -- never "on time" by default. */
export function delayTrail(i18n: I18n, seconds: number | undefined): string {
  return seconds === undefined ? '' : stateWord(delayWord(i18n, seconds), delayTone(i18n, seconds));
}

/** A summary row (route-summary.ts) carries its word, not its seconds: the tone is the word read back against the catalogue's own templates, so it can never disagree with delayTone. */
function toneOfWord(i18n: I18n, word: string): DelayTone {
  if (!word) return 'none';
  if (word === i18n.t('panels.delayOnTime')) return 'ontime';
  const minutes = /\d+/.exec(word)?.[0];
  if (minutes === undefined) return 'none';
  if (word === i18n.t('panels.delayLate', { minutes })) return 'late';
  if (word === i18n.t('panels.delayEarly', { minutes })) return 'early';
  return 'none';
}

interface RowButtonSpec {
  /** The id's kind and value: rowId(kind, id). */
  kind: string;
  id: string;
  action: string;
  /** cells() output. */
  inner: string;
  hidden?: boolean;
  /** A 44 px row (the stop sequence) instead of the board's 52 px. */
  dense?: boolean;
  /** The row is the thing currently open. */
  current?: boolean;
  testid?: string;
}

/** A row of the board that opens something: the whole row is the button (a 52 px target), keyed by a stable id so swapBody restores focus across polls. */
function rowButton(o: RowButtonSpec): string {
  const cls = o.dense ? 'row row-dense' : 'row';
  const testid = o.testid ? ` data-testid="${attr(o.testid)}"` : '';
  const current = o.current ? ' aria-current="true"' : '';
  return `<li class="${cls}"${o.hidden ? ' hidden' : ''}${testid}><button type="button" class="t-row" id="${rowId(o.kind, o.id)}" data-action="${attr(o.action)}" data-id="${attr(o.id)}"${current}>${o.inner}</button></li>`;
}

/** One route as a row: badge, long name, vehicles moving now as the second line, the delay word at the end when known. */
export function routeRowInner(i18n: I18n, route: RouteEntry, count: number | null, delay: number | undefined): string {
  const sub = count === null ? '' : vehicleCountGlyph(i18n, route.type, count);
  return cells(badge(route.short, route.type), esc(route.long || kindWord(i18n, route.type)), sub, delayTrail(i18n, delay));
}

/**
 * "N vozila u pokretu" as the mode's glyph (tram-front or bus-front, the tile grammar's 14 px context sizing) and the
 * bare count, with the sentence as the wrapper's own accessible name: newdesignsystem.md's "vehicles on line" rule says
 * the sign, never the word, where a glyph is defined. A mode without a glyph keeps the sentence rather than guessing a shape.
 */
export function vehicleCountGlyph(i18n: I18n, type: number, count: number): string {
  const sentence = trPlural(i18n, 'vehiclesNow', count);
  const kind = vehicleKind(type);
  const icon: IconName | null = kind === 'tram' ? 'tram-front' : kind === 'bus' ? 'bus-front' : null;
  if (!icon) return esc(sentence);
  return `<span class="tl-context" role="img" aria-label="${attr(sentence)}">${iconMarkup(icon)}<span class="tl-ctx-text" aria-hidden="true">${count}</span></span>`;
}

/** One named stop as a row: its routes as badges, its name, its platform count. */
export function stopRowInner(i18n: I18n, stop: StopGroup, routes: readonly RouteEntry[]): string {
  return cells(badgeList(routes), esc(stop.name), esc(trPlural(i18n, 'platforms', stop.ids.length)));
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
    return `<li role="option" id="${attr(oid)}" class="row t-option" data-action="select-${kind}" data-id="${attr(id)}" aria-selected="${d.active === oid ? 'true' : 'false'}">${inner}</li>`;
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

/** A running route on the board: m badge, the destination, the count under it, the delay word in its tone at the end. */
function routeButton(i18n: I18n, row: RouteSummaryRow, route: RouteEntry, hidden: boolean): string {
  const inner = cells(badge(row.label, row.type), esc(route.long || kindWord(i18n, row.type)), vehicleCountGlyph(i18n, row.type, row.count), stateWord(row.word, toneOfWord(i18n, row.word)));
  return rowButton({ kind: 'route', id: row.routeId, action: 'select-route', hidden, inner });
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
      `<ul class="t-list" id="${listId('routes')}" data-testid="running-routes">${rows}</ul>` +
      (folded > 0 ? foldButton(i18n, 'routes', d.routesOpen, i18n.t('panels.moreRoutes', { count: folded })) : '');
  }
  const stop = d.screenStop
    ? `<section class="t-block" data-testid="screen-stop">${sectionHead(tr(i18n, 'screenStop'))}<ul class="t-list">` +
      rowButton({ kind: 'stop', id: d.screenStop.id, action: 'select-stop', inner: cells(badgeList(d.screenStop.routes.map(d.routeOf)), esc(d.screenStop.name), '') }) +
      '</ul></section>'
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
  return `<div class="t-actions">${buttons.filter(Boolean).join('')}</div>`;
}

const showOnMap = (i18n: I18n): string => button({ action: 'fit-selection', label: tr(i18n, 'showOnMap') });
/** "Natrag": the way out of every detail, a 44 px ghost, first in the head. */
const back = (i18n: I18n): string => button({ action: 'clear-selection', label: i18n.t('common.back'), id: 't-clear-selection', icon: 'arrow-left' });

/** The save toggle (route and stop details only): a filled star once saved, "Ukloni iz spremljenog" generic
 *  once it is (the id already named it on the way in); the panel's own saved chips (kvart.ts) still say
 *  which one by name when removing from there. */
function saveButton(i18n: I18n, save: SavedRef & { on: boolean }): string {
  const label = save.on
    ? i18n.t('kvart.unsave')
    : i18n.t(save.kind === 'route' ? 'kvart.saveRoute' : 'kvart.saveStop', save.kind === 'route' ? { id: save.id } : { name: save.id });
  return `<button type="button" class="btn-quiet icon-btn t-save" data-action="${save.on ? 'unsave' : 'save'}" data-kind="${attr(save.kind)}" data-id="${attr(save.id)}" aria-pressed="${save.on ? 'true' : 'false'}" aria-label="${attr(label)}">${iconMarkup('star')}</button>`;
}

/** The ghost cast button every detail carries (D5): disabled with its reason (kvart.ts's own castReasonText,
 *  the same sentence the Kvart panel's primary and the FAB read) when "Na zaslon" cannot fire. */
function castButton(i18n: I18n, cast: CastState | undefined): string {
  const can = cast?.can ?? false;
  const disabled = can ? '' : ` aria-disabled="true" title="${attr(castReasonText(i18n, cast))}"`;
  return `<button type="button" class="btn-ghost t-cast" data-action="cast" data-testid="detail-cast"${disabled}>${iconMarkup('cast')}<span>${esc(i18n.t('cast.fab'))}</span></button>`;
}

/** Every detail opens the same way: the way back, the save toggle (route and stop), the ghost cast button,
 *  then the title. A public screen has no finger to press any of them. */
function detailHead(i18n: I18n, title: string, kiosk: boolean, extras?: DetailHeadExtras): string {
  if (kiosk) return title;
  const buttons = [back(i18n)];
  if (extras?.save) buttons.push(saveButton(i18n, extras.save));
  buttons.push(castButton(i18n, extras?.cast));
  return actions(buttons) + title;
}

/** The delay in words when the route's median is known, else the catalogue's own "unknown" sentence. */
function delayLine(i18n: I18n, delay: number | undefined): string {
  return delay === undefined ? i18n.t('motion.delayUnknown') : delayWord(i18n, delay);
}

/** "stoji na stanici" when the model holds the vehicle at a stop, "izvan poznate geometrije linije" when it free-planes, else nothing. */
function vehicleState(i18n: I18n, v: VehicleInfo): string {
  return v.held ? tr(i18n, 'held') : v.onShape === null ? tr(i18n, 'freeMotion') : '';
}

export interface VehicleDetailData {
  vehicle: VehicleInfo;
  route: RouteEntry | null;
  /** vehicleDirection()'s sentence. */
  direction: string;
  /** vehicleNextStop()'s sentence, or null. */
  nextStop?: string | null;
  delay: number | undefined;
  following: boolean;
  kiosk: boolean;
  cast?: CastState;
}

/** One vehicle: the l badge and its name, where it faces at body, its line and the line's delay, its state; "Prati vozilo" as the 48 px primary. */
export function vehicleDetailMarkup(i18n: I18n, d: VehicleDetailData): string {
  const { vehicle: v } = d;
  const locale = i18n.getLocale();
  const line = [d.route?.long ?? '', delayLine(i18n, d.delay)].filter(Boolean).join(' · ');
  const state = vehicleState(i18n, v);
  const follow = d.kiosk
    ? ''
    : button({
        action: d.following ? 'unfollow' : 'follow',
        label: tr(i18n, d.following ? 'unfollow' : 'follow'),
        id: 't-follow',
        data: { id: v.id },
        pressed: d.following,
        className: d.following ? 'btn-ghost t-action' : 'btn btn-primary',
      });
  const route = d.route ? button({ action: 'select-route', label: tr(i18n, 'showRoute'), data: { id: d.route.id } }) : '';
  return (
    detailHead(i18n, `<h3 class="t-title" data-testid="vehicle-title">${badge(v.short, v.type, 'l')}<span>${esc(vehicleTitle(i18n, v))}</span></h3>`, d.kiosk, { cast: d.cast }) +
    `<p class="t-lead" data-testid="vehicle-direction">${esc(capital(d.direction, locale))}</p>` +
    (d.nextStop ? `<p class="t-meta" data-testid="vehicle-next-stop">${esc(capital(d.nextStop, locale))}</p>` : '') +
    `<p class="t-meta">${esc(line)}</p>` +
    (state ? `<p class="t-meta">${esc(capital(state, locale))}</p>` : '') +
    (d.kiosk ? '' : actions([follow, route])) +
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
  /** Whether this route is in the reader's saved-store list; the head's save toggle reflects it. */
  saved?: boolean;
  cast?: CastState;
}

/** Vehicles listed on a route before "još n vozila". */
const ROUTE_VEHICLE_ROWS = 8;

/** One route: the l badge and the long name, "tramvaj · kasni 3 min" at body, the arrivals sentence once, its vehicles with where each faces, its stops in travel order (twelve, then all). */
export function routeDetailMarkup(i18n: I18n, d: RouteDetailData): string {
  const { route } = d;
  const locale = i18n.getLocale();
  const meta = `${kindWord(i18n, route.type)} · ${delayLine(i18n, d.delay)}`;
  const shown = d.vehicles.slice(0, ROUTE_VEHICLE_ROWS);
  const vehicleRows = shown
    .map((v) =>
      rowButton({
        kind: 'vehicle',
        id: v.id,
        action: 'select-vehicle',
        inner: cells(badge(v.short, v.type), esc(capital(d.directions.get(v.id) ?? i18n.t('motion.directionUnknown'), locale)), esc(vehicleState(i18n, v))),
      }),
    )
    .join('');
  const more = d.vehicles.length > shown.length ? `<p class="t-meta">${esc(trPlural(i18n, 'moreVehicles', d.vehicles.length - shown.length))}</p>` : '';
  const vehicles =
    d.vehicles.length > 0
      ? `<p class="t-lead">${esc(trPlural(i18n, 'vehiclesNow', d.vehicles.length))}</p><ul class="t-list" data-testid="route-vehicles">${vehicleRows}</ul>${more}`
      : `<p class="t-empty" data-testid="route-no-vehicles">${esc(tr(i18n, 'noVehiclesNow'))}</p>`;
  // The sequence keeps its counter (map.css, a CSS counter on the row) in a dense 44 px row.
  const stopRows = d.stops
    .map((s, i) => rowButton({ kind: 'stop', id: s.id, action: 'select-stop', dense: true, hidden: i >= STOP_ROWS && !d.stopsOpen, inner: cells('', esc(s.name), '') }))
    .join('');
  const stopsFold = d.stops.length > STOP_ROWS ? foldButton(i18n, 'stops', d.stopsOpen, tr(i18n, 'allStops', { count: d.stops.length })) : '';
  const stops =
    d.stops.length > 0
      ? `<ol class="t-list t-stops" id="${listId('stops')}" data-testid="route-stops">${stopRows}</ol>${stopsFold}`
      : `<p class="t-empty">${esc(i18n.t(d.hasNetwork ? 'status.empty' : 'status.loading'))}</p>`;
  return (
    detailHead(i18n, `<h3 class="t-title" data-testid="route-title">${badge(route.short, route.type, 'l')}<span>${esc(route.long || tr(i18n, 'routeTitle', { short: route.short }))}</span></h3>`, d.kiosk, { save: { kind: 'route', id: route.id, on: d.saved ?? false }, cast: d.cast }) +
    `<p class="t-lead" data-testid="route-meta">${esc(meta)}</p>` +
    `<p class="t-note">${esc(tr(i18n, 'noArrivals'))}</p>` +
    (d.kiosk ? '' : actions([showOnMap(i18n)])) +
    `<section class="t-block">${sectionHead(tr(i18n, 'routeVehicles'), 4)}${vehicles}</section>` +
    `<section class="t-block">${sectionHead(tr(i18n, 'routeStops'), 4)}${stops}</section>`
  );
}

export interface StopDetailData {
  stop: StopGroup;
  routes: RouteEntry[];
  counts: ReadonlyMap<string, number>;
  delays: ReadonlyMap<string, number>;
  isScreenStop: boolean;
  kiosk: boolean;
  /** Whether this stop is in the reader's saved-store list; the head's save toggle reflects it. */
  saved?: boolean;
  cast?: CastState;
}

/** One stop: its name at title, "3 perona" under it, the arrivals sentence once, its lines as rows with their count and delay word. */
export function stopDetailMarkup(i18n: I18n, d: StopDetailData): string {
  const meta = [trPlural(i18n, 'platforms', d.stop.ids.length), d.isScreenStop ? tr(i18n, 'screenStop') : ''].filter(Boolean).join(' · ');
  const rows = d.routes.map((r) => rowButton({ kind: 'route', id: r.id, action: 'select-route', inner: routeRowInner(i18n, r, d.counts.get(r.id) ?? 0, d.delays.get(r.id)) })).join('');
  const moving = d.routes.reduce((sum, r) => sum + (d.counts.get(r.id) ?? 0), 0);
  const lead = moving > 0 ? `<p class="t-lead" data-testid="stop-moving">${esc(trPlural(i18n, 'vehiclesNow', moving))}</p>` : `<p class="t-empty">${esc(tr(i18n, 'noStopVehicles'))}</p>`;
  return (
    detailHead(i18n, `<h3 class="t-title" data-testid="stop-title">${esc(d.stop.name)}</h3>`, d.kiosk, { save: { kind: 'stop', id: d.stop.id, on: d.saved ?? false }, cast: d.cast }) +
    `<p class="t-meta" data-testid="stop-meta">${esc(meta)}</p>` +
    `<p class="t-note">${esc(tr(i18n, 'noArrivals'))}</p>` +
    (d.kiosk ? '' : actions([showOnMap(i18n)])) +
    `<section class="t-block">${sectionHead(tr(i18n, 'stopRoutes'), 4)}${lead}<ul class="t-list" data-testid="stop-routes">${rows}</ul></section>`
  );
}

/** "radovi · jedan smjer": what closed the street and which way. */
function closureWords(i18n: I18n, item: FeedItem): string {
  const type = i18n.t(`panels.closureType.${dataText(item, 'subtype') || 'ROAD_CLOSED'}`);
  const direction = i18n.t(`panels.direction.${dataText(item, 'direction') || 'BOTH_DIRECTIONS'}`);
  return `${type} · ${direction}`;
}

/** A closure row's second line: the words, then "do 13. 9. 06:00" when the item names an end. */
function closureLine(i18n: I18n, item: FeedItem): string {
  const until = item.until ? i18n.t('panels.until', { time: zagrebDateTime(item.until) }) : '';
  return [closureWords(i18n, item), until].filter(Boolean).join(' · ');
}

/** The closure's window as one sentence: "od 8. 9. 08:00 do 13. 9. 06:00", or the one end the item names, or nothing. */
function closureWindow(i18n: I18n, item: FeedItem): string {
  const from = item.at ? zagrebDateTime(item.at) : '';
  const until = item.until ? zagrebDateTime(item.until) : '';
  if (from && until) return tr(i18n, 'windowFromUntil', { from, until });
  if (until) return i18n.t('panels.until', { time: until });
  if (from) return i18n.t('panels.from', { time: from });
  return '';
}

/** The closure's description, when the module has one. prometnice.ts writes `summary` for every closure; by default it
 *  is the worker's own wording of the two fields the type words already show ("zatvoreno zbog radova, jedan smjer",
 *  its closureWords), which is a paraphrase and not a description, so it is never repeated: one concept, one line.
 *  Anything else the module writes there is the description and is printed as it came. The comparison uses the
 *  worker's function itself, so a change of wording there can never turn into a repeated line here. */
function closureDescription(item: FeedItem): string {
  const summary = (item.summary ?? '').trim();
  if (!summary || summary === workerClosureWords(dataText(item, 'subtype') || '', dataText(item, 'direction') || '')) return '';
  return summary;
}

/** One closure: the mark and the street at title, the type words at body, the window as one sentence, then the
 *  description as prose when the module has one (closureDescription). */
export function closureDetailMarkup(i18n: I18n, item: FeedItem, kiosk: boolean, cast?: CastState): string {
  const window = closureWindow(i18n, item);
  const description = closureDescription(item);
  return (
    detailHead(i18n, `<h3 class="t-title" data-testid="closure-title">${closureMark()}<span>${esc(item.title)}</span></h3>`, kiosk, { cast }) +
    `<p class="t-lead">${esc(closureWords(i18n, item))}</p>` +
    (window ? `<p class="t-meta" data-testid="closure-window">${esc(window)}</p>` : '') +
    (description ? `<p class="t-prose">${esc(description)}</p>` : '') +
    (kiosk ? '' : actions([showOnMap(i18n)]))
  );
}

/** The closures beside the map (four, then "sve zatvaranja (n)") and ZET's own notices, as two blocks of the overview.
 *  `interactive` rows are buttons that open a closure (the workspace hears select-closure); otherwise the rows are
 *  static signage and the list shows every row (a public screen), unless `staticFold` names a control of the host's own
 *  that opens the rest (the lightweight face's page filter), in which case four show and the control follows. */
export function closuresMarkup(
  i18n: I18n,
  closures: readonly FeedItem[],
  notices: readonly FeedItem[],
  sourceStatus: string | null,
  selectedId: string | null,
  interactive = true,
  open = false,
  staticFold?: string,
): string {
  const status = sourceStatus ? `<p class="t-status">${esc(sourceStatus)}</p>` : '';
  const foldable = interactive || staticFold !== undefined;
  const rows = closures
    .map((c, i) => {
      const hidden = foldable && i >= CLOSURE_ROWS && !open;
      return interactive
        ? rowButton({ kind: 'closure', id: c.id, action: 'select-closure', hidden, current: c.id === selectedId, inner: cells(closureMark(), esc(c.title), esc(closureLine(i18n, c))) })
        : signRow({ lead: closureMark(), title: c.title, sub: closureLine(i18n, c), key: c.id, attrs: hidden ? { hidden: '' } : {} });
    })
    .join('');
  const fold = closures.length > CLOSURE_ROWS ? (interactive ? foldButton(i18n, 'closures', open, tr(i18n, 'allClosures', { count: closures.length })) : (staticFold ?? '')) : '';
  const list = closures.length > 0 ? `<ul class="t-list" id="${listId('closures')}" data-testid="transport-closures">${rows}</ul>${fold}` : `<p class="t-empty" data-testid="transport-no-closures">${esc(tr(i18n, 'noClosures'))}</p>`;
  const noticeRows = notices
    .map((n) => {
      const link = n.link ? `<a class="t-link" href="${attr(n.link)}" rel="noopener noreferrer" target="_blank">${esc(tr(i18n, 'openNotice'))}</a>` : '';
      return signRow({ lead: '', title: n.title, sub: n.at ? zagrebDateTime(n.at) : '', trail: link, key: n.id });
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
      return rowButton({
        kind: 'delay',
        id: row.routeId,
        action: 'select-route',
        hidden: i >= DELAY_ROWS && !open,
        testid: 'delay-row',
        inner: cells(badge(route.short, route.type), esc(route.long || kindWord(i18n, route.type)), '', delayTrail(i18n, row.delay)),
      });
    })
    .join('');
  const folded = rows.length - DELAY_ROWS;
  const more =
    folded > 0
      ? button({ action: 'toggle-delays', id: 't-fold-delays', label: open ? tr(i18n, 'collapse') : i18n.t('panels.moreRoutes', { count: folded }), className: 'btn-ghost t-action t-fold', expanded: open, controls: listId('delays') })
      : '';
  return `<section class="t-block" id="u-pokretu-delays" data-testid="transport-delays">${sectionHead(i18n.t('panels.delays'))}<ul class="t-list" id="${listId('delays')}">${items}</ul>${more}</section>`;
}
