// The transport sheet's markup, as strings a workspace sets into its stable
// containers: route and stop rows and the four detail views. Pure and escaped --
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
import type { ArrivalRow, ArrivalsStatus } from '../../../shared/city/arrivals';
import type { FeedItem } from '../../../worker/feed/schema';
import { closureWords as workerClosureWords } from '../../../worker/feed/modules/prometnice';
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';
import { externalTextReady } from '../city/feed';
import type { CastState } from '../core/contracts';
import type { SavedRef } from '../core/saved-store';
import { lineBadge } from '../experience/blocks';
import { snapshotLine } from '../experience/chrome';
import { delayTone, type DelayTone } from '../experience/delay';
import { zagrebDateTime, zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import { vettedArrival } from '../kiosk/arrivals';
import { delayWord } from '../layers/shared';
import { vehicleKind, type MapStatus, type VehicleInfo } from '../map/city-map';
import { dataText } from '../panels/panel';
import { escapeAttribute as attr, escapeHtml as esc } from '../ui/dom/escape';
import { iconMarkup, type IconName } from '../ui/icons';
import type { RouteStop } from './catalogue';
import type { RouteEntry, SearchResults, StopGroup } from './search';
import { tr, trPlural, type TransportKey } from './strings';

/** The transport detail head's own extras (T2.7, B.5): route and stop details get a save toggle.
 *  `name` is what a stop's save label says: its vetted name, never its id [B-7]. */
export interface DetailHeadExtras {
  save?: SavedRef & { on: boolean; name?: string };
}

/** Route badges the rows show before "+n". */
const ROW_BADGES = 6;
/** Rows a route's stop list shows before its fold. */
export const STOP_ROWS = 12;
/** A stop's sheet leads with this many departures, the same three rows Sada shows, then "Vozni red". */
export const STOP_DEPARTURES_FIRST = 3;
/** What a stop's sheet lists in all: the three, then the timetable to the twelfth (shared/city/arrivals.ts rows). */
export const STOP_ARRIVAL_ROWS = 12;
/** The folds a person opens in place: a route's stops. */
export type Fold = 'routes' | 'closures' | 'stops';

/** s in dense rows and the peek, m on boards, l on a detail head. */
export type BadgeSize = 's' | 'm' | 'l';

/** The number on the front of the vehicle, in its mode's colour and shape: the shared badge component (blocks.ts lineBadge, signage.css .line). */
/** The line badge: the number is GTFS text, vetted as a headsign is (kiosk/arrivals.ts vettedArrival); one that fails draws an empty plate. */
export function badge(short: string, type: number, size: BadgeSize = 'm'): string {
  return lineBadge(vetExternal('headsign', short, 'row') ?? '', vehicleKind(type), size);
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
const listId = (fold: Fold): string => `t-list-${fold}`;

/** The one button under a bounded list: "još 3 linije" / "sve zatvaranja (6)" closed, "Skupi" open. A disclosure, so it says whether the list is open. */
function foldButton(i18n: I18n, fold: Fold, open: boolean, moreLabel: string): string {
  // The stops fold is the one a test names on its own; the workspace hears every fold through toggle-fold and data-fold.
  const data: Record<string, string> = fold === 'stops' ? { fold, testid: 'toggle-stops' } : { fold };
  return button({ action: 'toggle-fold', id: `t-fold-${fold}`, label: open ? tr(i18n, 'collapse') : moreLabel, className: 'btn-ghost t-action t-fold', data, expanded: open, controls: listId(fold) });
}

/** A section head in sentence case at head size; h3 on its own, h4 under a detail title. */
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

/** One route as a row: badge, long name (GTFS text, vetted; the mode's word when it fails or is missing), vehicles moving now as the second line, the delay word at the end when known. */
export function routeRowInner(i18n: I18n, route: RouteEntry, count: number | null, delay: number | undefined): string {
  const sub = count === null ? '' : vehicleCountGlyph(i18n, route.type, count);
  return cells(badge(route.short, route.type), esc(vetExternal('name', route.long, 'row') || kindWord(i18n, route.type)), sub, delayTrail(i18n, delay));
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

/** One named stop as a row: its routes as badges, its name (ZET's text, vetted), its platform count. */
export function stopRowInner(i18n: I18n, stop: StopGroup, routes: readonly RouteEntry[]): string {
  return cells(badgeList(routes), esc(vetExternal('name', stop.name, 'row') ?? ''), esc(trPlural(i18n, 'platforms', stop.ids.length)));
}

/** The map's own state line, or null while it draws. */
export function statusLine(i18n: I18n, status: MapStatus): string | null {
  const key: TransportKey | null = status === 'loading' ? 'mapLoading' : status === 'tiles-failed' ? 'tilesFailed' : status === 'unavailable' ? 'mapUnavailable' : null;
  return key ? tr(i18n, key) : null;
}

function capital(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/** "Tramvaj 6", "Autobus 109", "Vozilo" for a route nobody knows or whose number fails the row rule. */
export function vehicleTitle(i18n: I18n, v: VehicleInfo): string {
  const kind = capital(kindWord(i18n, v.type), i18n.getLocale());
  const short = v.short ? vetExternal('headsign', v.short, 'row') : null;
  return short ? tr(i18n, 'vehicleTitle', { kind, short }) : kind;
}

function actions(buttons: string[]): string {
  return `<div class="t-actions">${buttons.filter(Boolean).join('')}</div>`;
}

const showOnMap = (i18n: I18n): string => button({ action: 'fit-selection', label: tr(i18n, 'showOnMap') });
/** "Samo ova linija na karti" (F5 section C): one switch under a route's or a
 *  vehicle's actions. Its name is constant and
 *  `aria-checked` carries the state, because that is what a switch is: a
 *  label that flipped with the state would have a screen reader announce
 *  "Cijela mreža na karti, prekidač, isključeno" -- the whole network, off --
 *  which says the opposite of what is true. The label is the whole answer, so
 *  the track beside it is decoration and carries no text. Offered only where
 *  there is somewhere to write the answer -- a public screen has no finger to
 *  press it, and a surface with no device store (the lightweight path) would
 *  be showing a control whose choice nothing remembers, exactly as the
 *  map-mode button is withheld there. */
function lineFocusSwitch(i18n: I18n, on: boolean): string {
  // A stable id, like the follow button's: the sheet's body is swapped whole
  // on every poll and swapBody restores focus by id, so pressing Space on
  // this switch must not be what takes the caret off it.
  return `<div class="t-actions"><button type="button" role="switch" id="t-line-focus" aria-checked="${on ? 'true' : 'false'}" data-action="toggle-line-focus" class="switch" data-testid="line-focus"><span class="switch-text">${esc(tr(i18n, 'lineFocusOn'))}</span><span class="switch-track" aria-hidden="true"></span></button></div>`;
}
/** "Natrag": the way out of every detail, a 44 px ghost, first in the head. */
const back = (i18n: I18n): string => button({ action: 'clear-selection', label: i18n.t('common.back'), id: 't-clear-selection', icon: 'arrow-left' });

/** The save toggle (route and stop details only): a filled star once saved, "Ukloni iz spremljenog" generic
 *  once it is (the label already named it on the way in). A route is named by its number, a stop by its
 *  vetted name; a stop whose name was refused is saved as "Spremi stajalište", never by its id. */
function saveButton(i18n: I18n, save: SavedRef & { on: boolean; name?: string }): string {
  const label = save.on
    ? i18n.t('kvart.unsave')
    : save.kind === 'route' ? i18n.t('kvart.saveRoute', { id: save.id }) : i18n.t('kvart.saveStop', { name: save.name ?? '' }).trim();
  return `<button type="button" class="btn-quiet icon-btn t-save" data-action="${save.on ? 'unsave' : 'save'}" data-kind="${attr(save.kind)}" data-id="${attr(save.id)}" aria-pressed="${save.on ? 'true' : 'false'}" aria-label="${attr(label)}">${iconMarkup('star')}</button>`;
}

/** Every detail opens the same way: the way back, the save toggle (route and stop), then the title.
 *  A public screen has no finger to press any of them. */
function detailHead(i18n: I18n, title: string, kiosk: boolean, extras?: DetailHeadExtras): string {
  if (kiosk) return title;
  const buttons = [back(i18n)];
  if (extras?.save) buttons.push(saveButton(i18n, extras.save));
  // Presentation lives in the shared header on every workspace.
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
  /** Whether the map is showing this line alone (core/line-focus-store.ts);
   *  null where there is no device store to write the choice to, and the
   *  switch is then not offered at all. */
  lineFocus: boolean | null;
  /** Unread since the ghost cast button went (WP5 A3); transport/workspace.ts still passes it (plan/WP5/handoff.md). */
  cast?: CastState;
}

/** One vehicle: the l badge and its name, where it faces at body, its line and the line's delay, its state; "Prati vozilo" as the 48 px primary. */
export function vehicleDetailMarkup(i18n: I18n, d: VehicleDetailData): string {
  const { vehicle: v } = d;
  const locale = i18n.getLocale();
  // The route's long name is GTFS text; the direction and the next stop carry a headsign or a stop's name
  // (transport/detail.ts vets those parts, and each line is checked whole here before it is printed).
  const line = [vetExternal('name', d.route?.long ?? '', 'row') ?? '', delayLine(i18n, d.delay)].filter(Boolean).join(' · ');
  const direction = vetExternal('title', d.direction, 'row') ?? i18n.t('motion.directionUnknown');
  const nextStop = d.nextStop ? vetExternal('title', d.nextStop, 'row') : null;
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
    detailHead(i18n, `<h3 class="t-title" data-testid="vehicle-title">${badge(v.short, v.type, 'l')}<span>${esc(vehicleTitle(i18n, v))}</span></h3>`, d.kiosk) +
    `<p class="t-lead" data-testid="vehicle-direction">${esc(capital(direction, locale))}</p>` +
    (nextStop ? `<p class="t-meta" data-testid="vehicle-next-stop">${esc(capital(nextStop, locale))}</p>` : '') +
    `<p class="t-meta">${esc(line)}</p>` +
    (state ? `<p class="t-meta">${esc(capital(state, locale))}</p>` : '') +
    (d.kiosk ? '' : actions([follow, route])) +
    (d.kiosk || d.lineFocus === null ? '' : lineFocusSwitch(i18n, d.lineFocus)) +
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
  /** Whether the map is showing this line alone (core/line-focus-store.ts);
   *  null where there is no device store to write the choice to, and the
   *  switch is then not offered at all. */
  lineFocus: boolean | null;
  /** Whether this route is in the reader's saved-store list; the head's save toggle reflects it. */
  saved?: boolean;
  /** Unread since the ghost cast button went (WP5 A3); transport/workspace.ts still passes it (plan/WP5/handoff.md). */
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
        // A vehicle's direction carries its headsign or a terminus (transport/detail.ts vets those parts; the line is checked whole here too).
        inner: cells(badge(v.short, v.type), esc(capital(vetExternal('title', d.directions.get(v.id) ?? '', 'row') ?? i18n.t('motion.directionUnknown'), locale)), esc(vehicleState(i18n, v))),
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
    .map((s, i) => rowButton({ kind: 'stop', id: s.id, action: 'select-stop', dense: true, hidden: i >= STOP_ROWS && !d.stopsOpen, inner: cells('', esc(vetExternal('name', s.name, 'row') ?? ''), '') }))
    .join('');
  const stopsFold = d.stops.length > STOP_ROWS ? foldButton(i18n, 'stops', d.stopsOpen, tr(i18n, 'allStops', { count: d.stops.length })) : '';
  const stops =
    d.stops.length > 0
      ? `<ol class="t-list t-stops" id="${listId('stops')}" data-testid="route-stops">${stopRows}</ol>${stopsFold}`
      : `<p class="t-empty">${esc(i18n.t(d.hasNetwork ? 'status.empty' : 'status.loading'))}</p>`;
  return (
    detailHead(i18n, `<h3 class="t-title" data-testid="route-title">${badge(route.short, route.type, 'l')}<span>${esc(vetExternal('name', route.long, 'row') || tr(i18n, 'routeTitle', { short: vetExternal('headsign', route.short, 'row') ?? '' }))}</span></h3>`, d.kiosk, { save: { kind: 'route', id: route.id, on: d.saved ?? false } }) +
    `<p class="t-lead" data-testid="route-meta">${esc(meta)}</p>` +
    (d.kiosk ? '' : actions([showOnMap(i18n)])) +
    (d.kiosk || d.lineFocus === null ? '' : lineFocusSwitch(i18n, d.lineFocus)) +
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
  /** Unread since the ghost cast button went (WP5 A3); transport/workspace.ts still passes it (plan/WP5/handoff.md). */
  cast?: CastState;
  /** What comes next here, already merged across the stop's platforms and
   *  sorted (shared/city/arrivals.ts). Never computed in this file: the view
   *  only says, row by row, whether a time is an estimate or the timetable. */
  arrivals: readonly ArrivalRow[];
  /** How much of the answer is trustworthy: 'none' is "no board in hand yet",
   *  'down' is "every platform's board failed". */
  arrivalsStatus: ArrivalsStatus;
  /** The moment the view froze (LayerContext.frozenAt), when it has. A frozen
   *  sheet never says "uživo" -- the live marker reads the shell's own snapshot
   *  sentence instead -- and never waits for a board that will not come. */
  frozenAt?: number;
  /** "Vozni red": the timetable alone, the same boards read without the fleet
   *  (arrivalsAt with no vehicles), so the tail under the three departures is
   *  the schedule and never a live estimate. Absent, the later trips are shown
   *  as their clock. */
  timetable?: readonly ArrivalRow[];
}

/** The GTFS type behind an arrival row, read off the stop's own lines: the
 *  badge is then a tram plate or a bus capsule. A route the catalogue does not
 *  list here keeps the neutral shape rather than being guessed from its number. */
function routeTypeAt(routes: readonly RouteEntry[], routeId: string): number {
  return routes.find((r) => r.id === routeId)?.type ?? -1;
}

/** A row's time at the row's end. A tracked row inside the countdown horizon
 *  says how long the wait is, because that is the question, and `sada` at
 *  zero: a tram due in under half a minute is the one pulling in, not "za 0
 *  min". Beyond the horizon a countdown would be a guess dressed as a fact, so
 *  the row shows a clock; a row off the timetable alone always shows its clock.
 *
 *  What the number is worth is said by its form, never by a word per row
 *  [O-27]: a tracked row carries the live dot (named "uživo" for a screen
 *  reader) and the blue tone, and a tracked row's clock is the schedule plus
 *  ZET's delay, so it keeps the dot exactly as its countdown would; a
 *  timetable row is a plain grey `<time>`. The note under the stop's list
 *  says once where the estimate comes from.
 *
 *  Frozen, the marker stays -- the figure did come off a tracked vehicle -- but
 *  it says the shell's own snapshot sentence (chrome.ts snapshotLine, "podaci
 *  od 13:57") and loses the live tone with it: "uživo" is never said once the
 *  view has stopped. */
export function arrivalTime(i18n: I18n, row: ArrivalRow, frozenAt: number | undefined): string {
  const time = !row.live || row.minutes === null
    ? `<time datetime="${attr(new Date(row.atMs).toISOString())}">${esc(zagrebTime(row.atMs))}</time>`
    : esc(row.minutes === 0 ? i18n.t('arrivals.now') : i18n.t('arrivals.inMinutes', { n: row.minutes }));
  if (!row.live) return `<span class="t-eta">${time}</span>`;
  const label = frozenAt === undefined ? i18n.t('arrivals.live') : snapshotLine(i18n, frozenAt);
  return `<span class="t-eta"${frozenAt === undefined ? ' data-live="true"' : ''}><span class="t-live" role="img" aria-label="${attr(label)}"></span>${time}</span>`;
}

/**
 * One departure, the same row on Sada and in the stop's sheet: the line badge,
 * the destination, the time (arrivalTime). `data-live` says whether a tracked
 * vehicle carries the trip right now; it reads "false" once the view is frozen,
 * like the time's own marker. `kindOf` gives the badge its mode's shape. The
 * line and the headsign are ZET's text: a row that fails the row-surface check
 * (kiosk/arrivals.ts vettedArrival) is not drawn at all.
 */
export function departureRow(i18n: I18n, row: ArrivalRow, kindOf: (routeId: string) => 'tram' | 'bus' | 'other', frozenAt?: number): string {
  if (!vettedArrival(row)) return '';
  const live = row.live && frozenAt === undefined;
  return `<li class="sada-departure" data-key="${attr(`${row.tripId}|${row.atMs}`)}" data-live="${live}">${lineBadge(row.routeName, kindOf(row.routeId), 'm')}<span class="sada-dest">${esc(row.headsign || row.routeName)}</span>${arrivalTime(i18n, row, frozenAt)}</li>`;
}

/** What comes next here, departures first [O-50]: the first three trips as
 *  Sada's own rows, then "Vozni red" with the rest of the list to the twelfth,
 *  then the note that says once where the estimate comes from. Every row is
 *  one departureRow, so no row carries a word for its kind, and the three lead
 *  the sheet under the stop's name with no heading of their own. */
function arrivalsSection(i18n: I18n, d: StopDetailData): string {
  const kindOf = (routeId: string): 'tram' | 'bus' | 'other' => vehicleKind(routeTypeAt(d.routes, routeId));
  const row = (r: ArrivalRow): string => departureRow(i18n, r, kindOf, d.frozenAt);
  const key = (r: ArrivalRow): string => r.tripId || `${r.routeId}|${r.atMs}`;
  // Every row's line and headsign are ZET's text: a row that fails the check is left out (departureRow draws none).
  const vetted = d.arrivals.filter(vettedArrival);
  const lead = vetted.slice(0, STOP_DEPARTURES_FIRST);
  const leadKeys = new Set(lead.map(key));
  // "Vozni red" is the timetable: the caller's scheduled rows when it has them, else the later trips shown as
  // their clock; either way a plain grey <time>, never a live estimate.
  const scheduled = (r: ArrivalRow): ArrivalRow => ({ ...r, live: false, minutes: null });
  const tail = (d.timetable ? d.timetable.filter(vettedArrival).filter((r) => !leadKeys.has(key(r))) : vetted.slice(STOP_DEPARTURES_FIRST))
    .slice(0, STOP_ARRIVAL_ROWS - STOP_DEPARTURES_FIRST).map(scheduled);
  // 'none' is "no board in hand", which live means "still on its way" and
  // frozen means "the session ended first, and none is coming": a frozen sheet
  // that said "učitavanje" would say it for good. Rows in hand that all failed
  // the text check say the timetable is unavailable, once the policy is here
  // to judge them; before that the list is still loading.
  const empty = d.arrivals.length > 0
    ? i18n.t(externalTextReady() ? 'arrivals.down' : 'status.loading')
    : d.arrivalsStatus === 'none'
      ? (d.frozenAt === undefined ? i18n.t('status.loading') : i18n.t('arrivals.frozen'))
      : i18n.t(d.arrivalsStatus === 'down' ? 'arrivals.down' : 'arrivals.none');
  const timetable = tail.length
    ? `${sectionHead(i18n.t('arrivals.timetable'), 4)}<ul class="t-list sada-departure-list t-timetable" data-testid="timetable-rows">${tail.map(row).join('')}</ul>`
    : '';
  const body = lead.length > 0
    ? `<ul class="t-list sada-departure-list" data-testid="arrival-rows">${lead.map(row).join('')}</ul>${timetable}<p class="t-note">${esc(i18n.t('arrivals.note'))}</p>`
    : `<p class="t-empty">${esc(empty)}</p>`;
  return `<section class="t-block" data-testid="stop-arrivals">${body}</section>`;
}

/** One stop: its name at title, then its next three departures and the timetable, then "3 perona" and its lines as rows with their count and delay word. */
export function stopDetailMarkup(i18n: I18n, d: StopDetailData): string {
  const meta = [trPlural(i18n, 'platforms', d.stop.ids.length), d.isScreenStop ? tr(i18n, 'screenStop') : ''].filter(Boolean).join(' · ');
  const rows = d.routes.map((r) => rowButton({ kind: 'route', id: r.id, action: 'select-route', inner: routeRowInner(i18n, r, d.counts.get(r.id) ?? 0, d.delays.get(r.id)) })).join('');
  const moving = d.routes.reduce((sum, r) => sum + (d.counts.get(r.id) ?? 0), 0);
  const lead = moving > 0 ? `<p class="t-lead" data-testid="stop-moving">${esc(trPlural(i18n, 'vehiclesNow', moving))}</p>` : `<p class="t-empty">${esc(tr(i18n, 'noStopVehicles'))}</p>`;
  // The stop's board (probe §15.6 / §16.4 `stop-board`): its name and what comes next, one element a canvas tap
  // lands on; display: contents (map.css), so the sheet's own layout is untouched.
  const name = vetExternal('name', d.stop.name, 'row') ?? '';
  return (
    `<div class="t-stop-board" data-testid="stop-board">` +
    detailHead(i18n, `<h3 class="t-title" data-testid="stop-title">${esc(name)}</h3>`, d.kiosk, { save: { kind: 'stop', id: d.stop.id, name, on: d.saved ?? false } }) +
    arrivalsSection(i18n, d) +
    '</div>' +
    `<p class="t-meta" data-testid="stop-meta">${esc(meta)}</p>` +
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
/** The module's description of a closure, when it wrote one beyond its own paraphrase of the type words: third-party
 *  prose, vetted under the summary kind on the row surface; '' when there is none or it fails. */
function closureDescription(item: FeedItem): string {
  const summary = (item.summary ?? '').trim();
  if (!summary || summary === workerClosureWords(dataText(item, 'subtype') || '', dataText(item, 'direction') || '')) return '';
  return vetExternal('summary', summary, 'row') ?? '';
}

/** One closure: the mark and the street at title, the type words at body, the window as one sentence, then the
 *  description as prose when the module has one (closureDescription). `_cast` is unread since the ghost cast
 *  button went (WP5 A3); transport/workspace.ts still passes it (plan/WP5/handoff.md). */
export function closureDetailMarkup(i18n: I18n, item: FeedItem, kiosk: boolean, _cast?: CastState): string {
  const window = closureWindow(i18n, item);
  const description = closureDescription(item);
  return (
    detailHead(i18n, `<h3 class="t-title" data-testid="closure-title">${closureMark()}<span>${esc(vetExternal('name', item.title, 'row') ?? '')}</span></h3>`, kiosk) +
    `<p class="t-lead">${esc(closureWords(i18n, item))}</p>` +
    (window ? `<p class="t-meta" data-testid="closure-window">${esc(window)}</p>` : '') +
    (description ? `<p class="t-prose">${esc(description)}</p>` : '') +
    (kiosk ? '' : actions([showOnMap(i18n)]))
  );
}
