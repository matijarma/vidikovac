// The kiosk's scene field: the map, and the three chapters the invitation
// rotates through over it (Promet with the line tiles, Večeras with today's
// dated events, Grad with the next session and the city rows), the pure
// readers behind them, each chapter's markup with its diffable regions, and
// the mounted field that swaps between them on the controller's clock. The
// map is built into the field once and stands through all three: what a swap
// changes is the chip on the picture's corner and the rail on its foot.
//
// Order: Promet and Grad always; Večeras only while eventsTonight() has a row
// (C.7: the open tier rarely has one, so the scene fills the day an
// open-licence events source lands). A `?prizor=` pin (D13) shows one scene
// and stops the rotation; the same pin reaches the empty Večeras.
//
// Honest data, as everywhere on the screen: every tile keeps the loading /
// stale / down split of kiosk/local.ts; a down source keeps its place with
// the honest word (a hole in a fixed frame reads as a fault, C.7), a count is
// never printed for an outage, and the works band says which scope it counts
// (D18: the kvart when the stop knows its district and the rows carry one,
// the whole city otherwise).
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import { isOpenLicenceEvent } from '../../../worker/feed/modules/dogadanja/licence';
import type { ScreenStop } from '../core/contracts';
import { delayTone } from '../experience/delay';
import type { I18n } from '../i18n/i18n';
import { delayWord } from '../layers/shared';
import { dataText } from '../panels/panel';
import { routeEnds } from '../transport/catalogue';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup, type IconName } from '../ui/icons';
import { clock, dayTime, fmtDistance, sameZagrebDay, weekdayDayMonth } from './format';
import { kBadge, lineRows, linesMarkup } from './invitation';
import { railColumns } from './layout';
import {
  byModule, cityKicker, closuresNear as closuresNearby, isLive, linesAtStop, NEARBY_CLOSURE_M, routeDelays, sourceState, stories, windowOf,
  type LineRow, type LinesBoard, type SourceState, type Story,
} from './local';
import { stopDistanceM } from './stops';
import { fill, plural, type KioskStrings } from './strings';

export type SceneId = 'promet' | 'veceras' | 'grad';
export const SCENE_ORDER: readonly SceneId[] = ['promet', 'veceras', 'grad'];
/** How long the leaving item fades before it is removed (kiosk.css `k-scene-out`). */
export const SCENE_LEAVE_MS = 180;
/** The entering item's rise (kiosk.css `k-scene-in`); exported so the CSS literal is pinned by a test. */
export const SCENE_ENTER_MS = 220;
/** Closures "u blizini" for the right column's value tile: local.ts's nearby radius under the scene contract's name. */
export const WORKS_RADIUS_M = NEARBY_CLOSURE_M;
/** The fewest members a chapter asks its rail for, however little room it
 *  has: at one column the rail stands them up as rows, and three of those is
 *  the least a chapter says. The room decides the rest, and fitRail hides
 *  what it turns out not to hold. */
export const TONIGHT_ROW_FLOOR = 3;
export const GRAD_ROW_FLOOR = 3;
const LINE_TILE_FLOOR = 3;
/** Promet fills the rail with the works band and its lines, Večeras with the
 *  evening's tiles, Grad with the ink tile and the city's rows. */
const prometMembers = (columns: number): number => Math.max(LINE_TILE_FLOOR, columns);
const tonightRows = (columns: number): number => Math.max(TONIGHT_ROW_FLOOR, columns);
const gradRowCap = (columns: number): number => Math.max(GRAD_ROW_FLOOR, columns - 1);
/** The register's phase for works one can see on the street (komunalne.ts's closed vocabulary). */
const WORKS_ONGOING_PHASE = 'Radovi u tijeku';

export interface SceneContext {
  modules: readonly ModuleSnapshot[];
  stop: ScreenStop | null;
  now: number;
  strings: KioskStrings;
  i18n: I18n;
  locale: string;
  lightweight: boolean;
  size: 'wide' | 'compact';
  /** Members this chapter's rail has room for: the columns its own minimum
   *  buys in the rail's measured width (mountScenes asks kiosk/layout.ts's
   *  railColumns), or the drawing's own count before anything is laid out --
   *  6 wide, 4 compact, 3 handheld, 10 lightweight. */
  columns: number;
}

export interface SceneModel extends SceneContext {
  /** The controller's rotation counter; the scene is `order[index % order.length]` while rotating. */
  index: number;
  pinned: SceneId | null;
  rotate: boolean;
}

export interface ScenesDeps {
  /** Runs `fn` once after `ms` and returns its cancel: the controller's clock, so the leaving item goes on the timers the tests drive and destroy() leaves nothing armed. */
  defer?: (fn: () => void, ms: number) => () => void;
  /** D12: no map under lagano, so the field is a head over the lines board rather than a chip and a rail over a picture. */
  lightweight?: boolean;
}

export interface ScenesHandle {
  element: HTMLElement;
  /** The field's own map host: the map is the field, so it stands through every chapter and is null only under lagano, which has no map at all. */
  readonly mapHost: HTMLElement | null;
  update(model: SceneModel): void;
  current(): SceneId;
  order(): readonly SceneId[];
  /** Re-measures every titled tile and gives its title one line when two overflow; called after every update and on the 1 s tick. */
  fit(): void;
  /** The rail's measured height where it hangs over the map, for the map's own bottom padding; 0 when nothing is laid out or the rail stands under the picture rather than on it. */
  railPad(): number;
  destroy(): void;
}

// --- Order and choice -------------------------------------------------------

/** Promet and Grad always; Večeras only with at least one row. */
export function sceneOrder(ctx: SceneContext): SceneId[] {
  return SCENE_ORDER.filter((id) => id !== 'veceras' || eventsTonight(ctx.modules, ctx.now).length > 0);
}

/** `pinned ?? (rotate ? order[index % order.length] : order[0])`. */
export function currentScene(model: SceneModel): SceneId {
  if (model.pinned) return model.pinned;
  const order = sceneOrder(model);
  if (!model.rotate) return order[0]!;
  const n = order.length;
  return order[((model.index % n) + n) % n]!;
}

// --- Pure readers -------------------------------------------------------------

const startOf = (item: FeedItem): number => (item.at ? Date.parse(item.at) : NaN);

/** A row dated by the happening itself: a publication time, a register change or an undated notice never puts a row into an evening. */
const isDatedEvent = (item: FeedItem): boolean => item.dateBasis === 'event' && Number.isFinite(startOf(item));

const hasEnded = (item: FeedItem, now: number): boolean => {
  const end = item.until ? Date.parse(item.until) : NaN;
  return Number.isFinite(end) && end < now;
};

/** Today's dated open-licence rows whose end has not passed, in start order; none before the source answers or while it is down. */
export function eventsTonight(modules: readonly ModuleSnapshot[], now: number): FeedItem[] {
  const dogadanja = byModule(modules).dogadanja;
  if (!isLive(dogadanja)) return [];
  return dogadanja.items
    .filter((item) => isOpenLicenceEvent(item) && isDatedEvent(item) && sameZagrebDay(item.at!, now) && !hasEnded(item, now))
    .sort((a, b) => startOf(a) - startOf(b));
}

export interface Nearest { title: string; distanceM: number | null }
export interface WorksInKvart { state: SourceState; scope: 'kvart' | 'city'; count: number; nearest: Nearest | null }

/** The stop's district slug once area D stamps it (ScreenStop.district, D6); a stop stored before the field existed has none. */
function stopDistrict(stop: ScreenStop | null): string {
  const district = (stop as (ScreenStop & { district?: unknown }) | null)?.district;
  return typeof district === 'string' ? district : '';
}

function pointDistance(item: FeedItem, stop: ScreenStop | null): number | null {
  if (!stop || item.geo?.type !== 'Point') return null;
  const [lon, lat] = item.geo.coordinates as number[];
  return typeof lon === 'number' && typeof lat === 'number' && Number.isFinite(lon) && Number.isFinite(lat) ? stopDistanceM({ lon, lat }, stop) : null;
}

/** Komunalne works in progress in the stop's district, nearest first by geometry (D18); the whole city before the worker stamps districts or when the stop has none. */
export function worksInKvart(modules: readonly ModuleSnapshot[], stop: ScreenStop | null, now: number): WorksInKvart {
  const dogadanja = byModule(modules).dogadanja;
  const ongoing = (isLive(dogadanja) ? dogadanja.items : []).filter((item) =>
    isOpenLicenceEvent(item) && dataText(item, 'source') === 'komunalne' && dataText(item, 'phase') === WORKS_ONGOING_PHASE && windowOf(item, now) !== 'expired');
  // Kvart scope needs both halves of D6: a stop that knows its district and rows the worker has stamped. Live rows without a district
  // prove the worker has not shipped them yet (a kvart count would be a false zero); with no row to judge by, the stop's district decides,
  // so a district stop's band never flips its label while the source is down or loading.
  const district = stopDistrict(stop);
  const scope = district && (ongoing.length === 0 || ongoing.some((item) => dataText(item, 'district') !== '')) ? 'kvart' : 'city';
  const counted = (scope === 'kvart' ? ongoing.filter((item) => dataText(item, 'district') === district) : ongoing)
    .map((item) => ({ item, distanceM: pointDistance(item, stop) }))
    .sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) || 0);
  const first = counted[0];
  return { state: sourceState(dogadanja), scope, count: counted.length, nearest: first ? { title: first.item.title, distanceM: first.distanceM } : null };
}

export interface ClosuresNearby { state: SourceState; count: number; nearest: Nearest | null }

/** local.ts's closuresNear read for the value tile: the count within WORKS_RADIUS_M and the nearest only when it is one of them; without a stop every open closure counts and the first is nearest. */
export function closuresNear(modules: readonly ModuleSnapshot[], stop: ScreenStop | null, now: number): ClosuresNearby {
  const near = closuresNearby(modules, stop, now);
  const nearest = near.nearest;
  const within = nearest !== null && (stop === null || (nearest.distanceM !== null && nearest.distanceM <= WORKS_RADIUS_M));
  return { state: near.state, count: near.nearbyCount, nearest: within && nearest ? { title: nearest.title, distanceM: nearest.distanceM } : null };
}

/** The Assembly's next session that has not ended (its stated end, else its start), or null. */
export function nextSession(modules: readonly ModuleSnapshot[], now: number): FeedItem | null {
  const dogadanja = byModule(modules).dogadanja;
  const sessions = (isLive(dogadanja) ? dogadanja.items : [])
    .filter((item) => isOpenLicenceEvent(item) && dataText(item, 'source') === 'skupstina' && Number.isFinite(startOf(item)))
    .filter((item) => {
      const end = item.until ? Date.parse(item.until) : NaN;
      return (Number.isFinite(end) ? end : startOf(item)) >= now;
    })
    .sort((a, b) => startOf(a) - startOf(b));
  return sessions[0] ?? null;
}

/** stories() minus the Assembly (the ink tile says it), at most what the rail has room for beside that tile; the gazette is session tier and never among them. */
export function gradRows(ctx: SceneContext): Story[] {
  return stories(ctx.modules, ctx.strings, ctx.locale, ctx.now).filter((story) => !story.id.startsWith('city:skupstina:')).slice(0, gradRowCap(ctx.columns));
}

// --- Markup -------------------------------------------------------------------

export interface SceneMarkup {
  /** The scene's title and meta without the dots; mountScenes builds the positioned head through sceneHeadMarkup. */
  head: string;
  body: string;
  /** Inner markup by testid, for a same-scene poll that rewrites only what changed. */
  regions: Record<string, string>;
}

const glyph = (name: IconName): string => iconMarkup(name, undefined, 'icon k-glyph');
const hidden = (text: string): string => `<span class="k-visually-hidden">${escapeHtml(text)}</span>`;
const bar = (role: string): string => `<span class="sk tl-sk-${role}"></span>`;
const staleBadge = (s: KioskStrings): string => `<span class="badge" data-tone="stale">${escapeHtml(s.paired.stale)}</span>`;

/** Who publishes an open-licence city row, for a context line or a credit: the Assembly and ZET their own, the City its registers and notices. */
function publisherOf(source: string): string {
  if (source === 'skupstina') return 'Skupština Grada Zagreba';
  if (source === 'zet-promet' || source === 'zet-novosti') return 'ZET';
  return 'Grad Zagreb';
}

function sceneTitle(id: SceneId, s: KioskStrings): string {
  return id === 'promet' ? s.layers['u-pokretu'] : id === 'grad' ? s.layers['uprava-i-pravo'] : s.scenes.tonight;
}

/** A band that carries a sentence: a confirmed empty (calm), or a source that does not answer or a stale copy nothing confirms (unknown, with its state). */
function noteBand(level: 'calm' | 'unknown', glyphName: IconName, label: string, title: string, state?: 'down' | 'stale'): string {
  const head = label ? `<p class="tl-label">${escapeHtml(label)}</p>` : '';
  return `<div class="tl" data-variant="band" data-level="${level}"${state ? ` data-state="${state}"` : ''}>${glyph(glyphName)}<div class="tl-main">${head}<p class="tl-title">${escapeHtml(title)}</p></div></div>`;
}

/** Nothing to list: a live answer is a true empty; a stale copy is unconfirmed; a down source is said so. */
function emptyBand(state: SourceState, glyphName: IconName, label: string, empty: string, s: KioskStrings): string {
  if (state === 'down') return noteBand('unknown', glyphName, label, s.paired.sourceDown, 'down');
  if (state === 'stale') return noteBand('unknown', glyphName, label, s.paired.unconfirmed, 'stale');
  return noteBand('calm', glyphName, label, empty);
}

interface BuiltScene {
  body: string;
  regions: Record<string, string>;
  meta: string;
  /** The chip's "još N" once fitRail has hidden `hidden` members it turns out the room does not hold; `meta` is this at zero. */
  more(hidden: number): string;
}

// Promet: the map spanning the rows of column 1, the line tiles, the works band.

function lineTile(row: LineRow, delay: number | undefined, state: SourceState, ctx: SceneContext): string {
  const { strings: s, i18n, locale } = ctx;
  const tone = row.word === '' ? 'unknown' : delayTone(i18n, delay);
  const kindWord = row.kind === 'tram' ? s.lines.tram : row.kind === 'bus' ? s.lines.bus : '';
  const near = row.nearby > 0 ? plural(locale, s.lines.nearby, row.nearby) : s.lines.noneNearby;
  // The context is the vehicles-near glyph and the count, never the word; the count is heard once, through the hidden sentence.
  const context = state === 'stale'
    ? staleBadge(s)
    : `<p class="tl-context">${glyph(row.kind === 'bus' ? 'bus-front' : 'tram-front')}<span aria-hidden="true">${row.nearby}</span>${hidden(near)}</p>`;
  // Badge, then the line's two ends on their own line, the state word in its tone, the vehicles glyph and count (kajimafix 03.3).
  return `<li class="tl k-tl-line" data-route="${escapeAttribute(row.routeId)}" data-kind="${row.kind}" data-tone="${tone === 'none' ? 'unknown' : tone}">`
    + `<p class="tl-label">${kBadge(row.label, row.kind, `${kindWord} ${row.label}`.trim())}</p>`
    + `<p class="k-tl-name">${escapeHtml(routeEnds(row.longName))}</p>`
    + `<p class="tl-value">${escapeHtml(row.word || delayWord(i18n, undefined))}</p>${context}</li>`;
}

/** The board's rows as the rail's members: tiles across, or -- where the room
 *  holds one column -- the lagano board's own `li.k-line` rows stood up. */
function linesInner(board: LinesBoard, ctx: SceneContext, cap: number, stood: boolean): string {
  const s = ctx.strings;
  if (board.state === 'loading') {
    const tiles = Array.from({ length: cap }, () => `<li class="tl k-tl-line" data-skeleton aria-hidden="true">${bar('label')}${bar('value')}${bar('context')}</li>`);
    return `<li class="k-visually-hidden">${escapeHtml(s.lines.loading)}</li>${tiles.join('')}`;
  }
  if (board.state === 'down') return `<li class="k-board-note" data-state="down">${escapeHtml(s.lines.unavailable)}</li>`;
  if (board.rows.length === 0) return `<li class="k-board-note">${escapeHtml(ctx.stop ? s.lines.noneNearby : s.lines.noStop)}</li>`;
  if (stood) return lineRows(board, s, ctx.locale);
  const delays = routeDelays(byModule(ctx.modules)['zet-rt']);
  return board.rows.map((row) => lineTile(row, delays.get(row.routeId), board.state, ctx)).join('');
}

/** The lines beyond the cap, said once here; nothing while the board is not a board yet. */
function linesMeta(board: LinesBoard, ctx: SceneContext, hidden = 0): string {
  const rest = board.more + hidden;
  return (board.state === 'live' || board.state === 'stale') && rest > 0 ? plural(ctx.locale, ctx.strings.lines.more, rest) : '';
}

/** The works band as the rail's lead member; nothing at all when nothing is ongoing. */
function worksBand(works: WorksInKvart, ctx: SceneContext): string {
  const s = ctx.strings;
  const label = works.scope === 'kvart' ? s.scenes.worksKvart : s.scenes.worksCity;
  const open = '<li class="tl" data-variant="band" data-tone="komunalno" data-testid="kiosk-works"';
  if (works.state === 'loading') return `${open} data-skeleton aria-hidden="true">${bar('glyph')}<span class="tl-main">${bar('label')}${bar('title1')}</span></li>`;
  if (works.state === 'down') return `${open} data-state="down">${glyph('hard-hat')}<div class="tl-main"><p class="tl-label">${escapeHtml(label)}</p><p class="tl-title">${escapeHtml(s.paired.sourceDown)}</p></div></li>`;
  // A zero leaves the rail entirely, a stale one too (kajimafix 03.3): "0 · zastarjelo" is a hole dressed as a fact.
  if (works.count === 0) return '';
  const title = works.nearest ? [works.nearest.title, works.nearest.distanceM === null ? '' : fmtDistance(ctx.locale, works.nearest.distanceM)].filter(Boolean).join(' · ') : '';
  return `${open} data-state="${works.state}">${glyph('hard-hat')}<div class="tl-main"><p class="tl-label">${escapeHtml(label)}</p>`
    + `${title ? `<p class="tl-title">${escapeHtml(title)}</p>` : ''}${works.state === 'stale' ? staleBadge(s) : ''}</div><p class="tl-trail">${works.count}</p></li>`;
}

function promet(ctx: SceneContext): BuiltScene {
  if (ctx.lightweight) {
    // D12: no map under lagano, so the lines board is the whole field, exactly today's left column (li.k-line × cap and .k-line-more,
    // e2e/lagano.spec.ts's contract); the board says its own overflow, so the meta stays quiet.
    const board = linesAtStop(ctx.modules, ctx.stop, ctx.i18n, ctx.columns);
    const lines = linesMarkup(board, ctx.stop, ctx.strings, ctx.locale);
    const body = `<div class="k-scene-grid" data-board="1"><div class="k-map" data-testid="kiosk-live"><div class="k-map-host" data-testid="kiosk-map-host" hidden></div><div class="k-lines k-lines--board" data-testid="kiosk-lines">${lines}</div></div></div>`;
    return { body, regions: { 'kiosk-lines': lines }, meta: '', more: () => '' };
  }
  // The works band is one member of the rail like any other, so the lines take what the rail has left.
  const works = worksBand(worksInKvart(ctx.modules, ctx.stop, ctx.now), ctx);
  const stood = ctx.columns <= 1;
  const cap = Math.max(1, prometMembers(ctx.columns) - (works === '' ? 0 : 1));
  const board = linesAtStop(ctx.modules, ctx.stop, ctx.i18n, cap);
  const inner = `${works}${linesInner(board, ctx, cap, stood)}`;
  const body = `<ul class="k-rail" data-chapter="promet" data-testid="kiosk-lines"${stood ? ' data-rows="1"' : ''}>${inner}</ul>`;
  const more = (hidden: number): string => linesMeta(board, ctx, hidden);
  return { body, regions: { 'kiosk-lines': inner }, meta: more(0), more };
}

// Večeras: up to three time tiles, the next one tinted.

function eventRow(item: FeedItem, state: SourceState, next: boolean, ctx: SceneContext): string {
  const s = ctx.strings;
  const source = dataText(item, 'source');
  const time = dataText(item, 'precision') === 'time'
    ? `<time class="tl-time" datetime="${escapeAttribute(item.at!)}">${escapeHtml(clock(item.at))}</time>`
    : `<span class="tl-time" data-allday>${escapeHtml(s.paired.allDay)}</span>`;
  const context = [publisherOf(source), dataText(item, 'venue'), dataText(item, 'live') ? s.scenes.live : ''].filter(Boolean).join(' · ');
  const tail = state === 'stale' ? staleBadge(s) : context ? `<p class="tl-context">${escapeHtml(context)}</p>` : '';
  return `<div class="tl" data-variant="time" data-source="${escapeAttribute(source)}"${next ? ' data-tint="events"' : ''}>${time}`
    + `<div class="tl-main"><p class="tl-label">${escapeHtml(cityKicker(source, s))}</p><p class="tl-title">${escapeHtml(item.title)}</p>${tail}</div></div>`;
}

function tonightMeta(rows: readonly FeedItem[], ctx: SceneContext, hidden = 0): string {
  const shown = Math.max(0, Math.min(rows.length, tonightRows(ctx.columns)) - hidden);
  return rows.length > shown ? plural(ctx.locale, ctx.strings.scenes.moreEvents, rows.length - shown) : '';
}

function veceras(ctx: SceneContext): BuiltScene {
  const s = ctx.strings;
  const state = sourceState(byModule(ctx.modules).dogadanja);
  const rows = eventsTonight(ctx.modules, ctx.now);
  const cap = tonightRows(ctx.columns);
  let inner: string;
  if (state === 'loading') inner = `${hidden(ctx.i18n.t('status.loading'))}${'<div class="sk sk-row" aria-hidden="true"></div>'.repeat(cap)}`;
  else if (rows.length === 0) inner = emptyBand(state, 'calendar-days', state === 'live' ? '' : s.scenes.tonight, s.scenes.tonightEmpty, s);
  else {
    const next = rows.findIndex((row) => startOf(row) >= ctx.now);
    inner = rows.slice(0, cap).map((row, i) => eventRow(row, state, i === next, ctx)).join('');
  }
  const stood = ctx.columns <= 1 ? ' data-rows="1"' : '';
  const more = (hidden: number): string => tonightMeta(rows, ctx, hidden);
  return { body: `<div class="k-rail" data-chapter="veceras" data-testid="kiosk-tonight"${stood}>${inner}</div>`, regions: { 'kiosk-tonight': inner }, meta: more(0), more };
}

// Grad: the one ink tile spanning the rows of column 1, then up to three rows.

function inkTile(session: FeedItem | null, state: SourceState, ctx: SceneContext): string {
  const s = ctx.strings;
  const open = `<div class="tl" data-variant="ink" data-testid="k-city-ink"`;
  if (state === 'loading') return `${open} data-skeleton aria-hidden="true">${bar('time')}${bar('label')}${bar('title')}${bar('context')}</div>`;
  if (state === 'down' || !session) {
    // No session to name: the tile keeps its place with the honest word; a stale copy's "none announced" is unconfirmed and says so.
    const title = state === 'down' ? s.paired.sourceDown : s.paired.sessionsNone;
    return `${open} data-state="${state}"><span class="tl-time"></span><p class="tl-label">${escapeHtml(s.story.assembly)}</p><p class="tl-title">${escapeHtml(title)}</p>${state === 'stale' ? staleBadge(s) : ''}</div>`;
  }
  const time = dataText(session, 'precision') === 'time'
    ? `<time class="tl-time" datetime="${escapeAttribute(session.at!)}">${escapeHtml(clock(session.at))}</time>`
    : `<span class="tl-time" data-allday>${escapeHtml(s.paired.allDay)}</span>`;
  const label = `${s.story.assembly} · ${weekdayDayMonth(ctx.locale, session.at!)}`;
  const context = [dataText(session, 'venue'), s.events[dataText(session, 'category')] ?? ''].filter(Boolean).join(' · ');
  const tail = state === 'stale' ? staleBadge(s) : context ? `<p class="tl-context">${escapeHtml(context)}</p>` : '';
  return `${open} data-state="${state}">${time}<p class="tl-label">${escapeHtml(label)}</p><p class="tl-title">${escapeHtml(session.title)}</p>${tail}</div>`;
}

type StoryKind = 'quake' | 'city';

/** The snapshot and the feed row behind a story (`quake:<id>`, `city:<id>`), for the source's state and the row's own date. */
function storySource(story: Story, modules: readonly ModuleSnapshot[]): { snapshot: ModuleSnapshot | undefined; item: FeedItem | undefined } {
  const cut = story.id.indexOf(':');
  const kind = story.id.slice(0, cut);
  const id = story.id.slice(cut + 1);
  const snapshot = byModule(modules)[kind === 'quake' ? 'emsc' : 'dogadanja'];
  return { snapshot, item: snapshot?.items.find((item) => item.id === id) };
}

function rowGlyph(kind: StoryKind, source: string): IconName {
  if (kind === 'quake') return 'activity';
  if (source === 'komunalne') return 'hard-hat';
  if (source === 'zet-promet' || source === 'zet-novosti') return 'tram-front';
  return 'landmark';
}

/** When a row happened, as short as honesty allows: today's clock alone, another day with its date, a register change or a day-precision date by its day, an undated notice nothing. */
function whenText(item: FeedItem | undefined, now: number, locale: string): string {
  const at = item ? startOf(item) : NaN;
  if (!item || !Number.isFinite(at)) return '';
  const basis = item.dateBasis;
  if (basis === 'unknown' || (basis === undefined && dataText(item, 'source') === 'kvartovske')) return '';
  if (basis === 'updated' || dataText(item, 'precision') === 'day') return weekdayDayMonth(locale, at);
  return sameZagrebDay(at, now) ? clock(at) : dayTime(at);
}

function gradRow(story: Story, ctx: SceneContext): string {
  const { snapshot, item } = storySource(story, ctx.modules);
  const kind: StoryKind = story.tone === 'quake' ? 'quake' : 'city';
  const source = item ? dataText(item, 'source') : '';
  const trail = [kind === 'city' && source ? publisherOf(source) : story.source, whenText(item, ctx.now, ctx.locale)].filter(Boolean).join(' · ');
  // A stale source marks its own rows, after the title (C.3); the trail keeps saying when the row happened.
  const stale = snapshot?.status === 'stale' ? staleBadge(ctx.strings) : '';
  return `<div class="tl" data-variant="row" data-kind="${kind}" data-story="${escapeAttribute(story.id)}" title="${escapeAttribute(story.attribution)}">${glyph(rowGlyph(kind, source))}`
    + `<div class="tl-main"><p class="tl-title">${escapeHtml(story.title)}</p>${stale}</div><p class="tl-trail">${escapeHtml(trail)}</p></div>`;
}

function grad(ctx: SceneContext): BuiltScene {
  const s = ctx.strings;
  const map = byModule(ctx.modules);
  const ink = inkTile(nextSession(ctx.modules, ctx.now), sourceState(map.dogadanja), ctx);
  const rows = gradRows(ctx);
  const sources = [map.dogadanja, map.emsc];
  let rowsHtml: string;
  if (rows.length > 0) rowsHtml = rows.map((story) => gradRow(story, ctx)).join('');
  else if (sources.every((snapshot) => snapshot === undefined)) {
    rowsHtml = `${hidden(ctx.i18n.t('status.loading'))}${`<div class="tl" data-variant="row" data-skeleton aria-hidden="true">${bar('glyph')}<span class="tl-main">${bar('title1')}</span>${bar('context')}</div>`.repeat(gradRowCap(ctx.columns))}`;
  } else {
    // Only an answering source with nothing new is "nothing new": every source down is said so, a stale one among them is unconfirmed.
    const state: SourceState = sources.every((snapshot) => snapshot === undefined || snapshot.status === 'down') ? 'down'
      : sources.some((snapshot) => snapshot?.status === 'stale') ? 'stale' : 'live';
    rowsHtml = emptyBand(state, 'landmark', s.story.city, s.story.empty, s);
  }
  const inner = `${ink}${rowsHtml}`;
  const stood = ctx.columns <= 1 ? ' data-rows="1"' : '';
  // Grad never counted the rows it left out; the rail hides one the room cannot hold exactly as the old cap of three did.
  return { body: `<div class="k-rail" data-chapter="grad" data-testid="kiosk-city"${stood}>${inner}</div>`, regions: { 'kiosk-city': inner }, meta: '', more: () => '' };
}

function buildScene(id: SceneId, ctx: SceneContext): BuiltScene {
  return id === 'promet' ? promet(ctx) : id === 'veceras' ? veceras(ctx) : grad(ctx);
}

/** The head's own meta: the lines beyond the rail, the evening's rows beyond it, nothing for Grad. Each chapter's cap is the rail's own arithmetic, so it is read off the built scene rather than guessed at a second time. */
function sceneMeta(id: SceneId, ctx: SceneContext): string {
  return buildScene(id, ctx).meta;
}

function headMarkup(id: SceneId, s: KioskStrings, meta: string, position: { index: number; count: number } | null): string {
  const dots = position
    ? `<div class="k-scene-dots" aria-hidden="true">${Array.from({ length: position.count }, (_, i) => `<span class="k-dot"${i === position.index ? ' data-on="1"' : ''}></span>`).join('')}</div>`
      + `<span class="k-visually-hidden" data-testid="kiosk-scene-position">${escapeHtml(fill(s.scenes.position, { index: position.index + 1, count: position.count }))}</span>`
    : '';
  return `<h2 class="k-scene-title" id="k-scene-title">${escapeHtml(sceneTitle(id, s))}</h2><p class="k-scene-meta" data-testid="kiosk-scene-meta">${escapeHtml(meta)}</p>${dots}`;
}

export function sceneMarkup(id: SceneId, ctx: SceneContext): SceneMarkup {
  const built = buildScene(id, ctx);
  return { head: headMarkup(id, ctx.strings, built.meta, null), body: built.body, regions: { ...built.regions, 'kiosk-scene-meta': escapeHtml(built.meta) } };
}

/** The scene's head: its title, the meta, and (when `showDots`) the dots with the reader's position sentence; `position.index` is zero-based. */
export function sceneHeadMarkup(id: SceneId, ctx: SceneContext, position: { index: number; count: number }, showDots: boolean): string {
  return headMarkup(id, ctx.strings, sceneMeta(id, ctx), showDots ? position : null);
}

/** `?prizor=promet|veceras|grad` (D13): one scene, no rotation; anything else is no pin. */
export function parsePinnedScene(search: string): SceneId | null {
  const value = new URLSearchParams(search).get('prizor');
  return value !== null && (SCENE_ORDER as readonly string[]).includes(value) ? (value as SceneId) : null;
}

// --- The mounted field ------------------------------------------------------------

export function mountScenes(host: HTMLElement, deps: ScenesDeps): ScenesHandle {
  const defer = deps.defer ?? ((fn, ms) => { const handle = globalThis.setTimeout(fn, ms); return () => globalThis.clearTimeout(handle); });
  /** Cancels of the leave timers still pending, keyed by the item they remove. */
  const leaving = new Map<HTMLElement, () => void>();
  const element = document.createElement('section');
  element.className = 'k-scene';
  element.dataset.testid = 'kiosk-scene';
  element.setAttribute('aria-labelledby', 'k-scene-title');
  // The map is the field, built once and standing through every chapter (D12:
  // under lagano there is no map at all, and the field is a head over the
  // lines board as it always was). The chip and the rail are its children,
  // which is what lets e2e/kiosk-layout.spec.ts keep proving that nothing
  // paints over anything by accident: a pair overlaps unless one contains
  // the other.
  const inner = '<header class="k-scene-head"></header><div class="k-scene-body"></div>';
  if (deps.lightweight) element.innerHTML = inner;
  else {
    element.dataset.map = '1';
    element.innerHTML = `<div class="k-map" data-testid="kiosk-live"><div class="k-map-host" data-testid="kiosk-map-host"></div>${inner}</div>`;
  }
  host.appendChild(element);
  const head = element.querySelector<HTMLElement>('.k-scene-head')!;
  const body = element.querySelector<HTMLElement>('.k-scene-body')!;
  // Read while the body is still empty, so it is the field's own host and never a lagano scene's.
  const mapHostEl = element.querySelector<HTMLElement>('[data-testid=kiosk-map-host]');
  let currentId: SceneId | null = null;
  // Before the first update no row exists, so Večeras is not in the order.
  let order: readonly SceneId[] = SCENE_ORDER.filter((id) => id !== 'veceras');
  let lastHead = '';
  let lastRegions: Record<string, string> = {};
  /** The chapter's own "još N" for a given number of hidden members; fitRail writes it into the chip. */
  let moreText: (hidden: number) => string = () => '';

  const currentItem = (): HTMLElement | null => body.querySelector<HTMLElement>('.k-scene-item:not([data-leaving])');

  /** The item on show leaves under data-leaving (absolute, so the body never moves) while the next enters; the body keeps one item afterwards. Nothing is parked first: what leaves is the chapter's rail, and the map it hangs on stands still. */
  function swap(next: SceneId, html: string): void {
    // A change faster than the fade: the copy already leaving goes at once, its timer with it.
    for (const [stale, cancel] of leaving) { cancel(); stale.remove(); }
    leaving.clear();
    const previous = currentItem();
    const item = document.createElement('div');
    item.className = 'k-scene-item';
    item.dataset.scene = next;
    item.innerHTML = html;
    if (previous) {
      previous.dataset.leaving = '1';
      leaving.set(previous, defer(() => { leaving.delete(previous); previous.remove(); }, SCENE_LEAVE_MS));
    }
    body.appendChild(item);
  }

  /** The rail on show, whichever chapter built it. */
  const railBox = (): HTMLElement | null => currentItem()?.querySelector<HTMLElement>('.k-rail') ?? null;

  /** How many members a chapter's rail has room for, measured off the rail on
   *  show: its width is the map's whatever chapter drew it, and kiosk.css
   *  registers the four minima as lengths so they resolve here. Zero before
   *  anything is laid out (a pre-paint mount, happy-dom), and the caller
   *  falls back to the drawing's own count. */
  function measuredColumns(id: SceneId): number {
    const rail = railBox();
    if (!rail) return 0;
    const width = rail.clientWidth - 1;
    const style = getComputedStyle(rail);
    const gap = Number.parseFloat(style.columnGap);
    const px = (token: string): number => Number.parseFloat(style.getPropertyValue(token));
    if (!(gap >= 0)) return 0;
    // One column of the narrowest member any rail holds: the rail stands its members up as rows and every chapter asks for its floor.
    const across = railColumns(width, px('--k-tile-min'), gap);
    if (across <= 1) return across;
    if (id === 'promet') return across;
    if (id === 'veceras') return railColumns(width, px('--k-time-min'), gap);
    // Grad's ink tile has a lead track of its own; the city's rows fill what is left of the rail.
    return railColumns(width - px('--k-ink-w') - gap, px('--k-row-min'), gap) + 1;
  }

  /** The rail is one row over the map's foot: a member the room turns out not
   *  to hold is hidden and counted in the chip rather than allowed to open a
   *  second row over the picture. Where the rail stands under the picture
   *  instead (a handheld's map band) there is nothing to keep it out of, and
   *  a DOM without layout measures nothing and changes nothing. */
  function fitRail(): void {
    const rail = railBox();
    if (!rail) return;
    const members = [...rail.children].filter((el): el is HTMLElement => el instanceof HTMLElement);
    for (const member of members) member.hidden = false;
    let trimmed = 0;
    if (members.length > 1 && rail.clientHeight > 0) {
      const stood = rail.dataset.rows === '1';
      const limit = railLimit(rail);
      let shown = members.filter((m) => !m.hidden);
      while (shown.length > 1) {
        const wrapped = !stood && shown[shown.length - 1]!.offsetTop > shown[0]!.offsetTop + 1;
        if (!wrapped && !(rail.getBoundingClientRect().height > limit + 1)) break;
        shown[shown.length - 1]!.hidden = true;
        trimmed += 1;
        shown = shown.slice(0, -1);
      }
    }
    const meta = element.querySelector<HTMLElement>('[data-testid=kiosk-scene-meta]');
    const text = moreText(trimmed);
    if (meta && meta.textContent !== text) meta.textContent = text;
  }

  /** The tallest the rail may be: half the picture where it hangs over one, unbounded where it stands beneath it. */
  function railLimit(rail: HTMLElement): number {
    if (!mapHostEl) return Infinity;
    const picture = mapHostEl.getBoundingClientRect();
    if (!(picture.height > 0)) return Infinity;
    return rail.getBoundingClientRect().top < picture.bottom - 1 ? picture.height / 2 : Infinity;
  }

  /** Every titled tile drops data-lines, then gets it back when two lines overflow; a DOM without layout measures nothing and changes nothing. */
  function fit(): void {
    fitRail();
    for (const tile of element.querySelectorAll<HTMLElement>('.k-scene-item:not([data-leaving]) .tl')) {
      if (tile.clientHeight === 0 || !tile.querySelector('.tl-title')) continue;
      delete tile.dataset.lines;
      if (tile.scrollHeight > tile.clientHeight + 1) tile.dataset.lines = '1';
    }
  }

  /** The rail's height where it hangs over the map; 0 when nothing is laid out (happy-dom) or the rail stands under the picture rather than on it (a handheld's map band). */
  function railPad(): number {
    const rail = railBox();
    if (!rail || !mapHostEl) return 0;
    const box = rail.getBoundingClientRect();
    const picture = mapHostEl.getBoundingClientRect();
    if (!(box.height > 0) || box.top >= picture.bottom - 1) return 0;
    return Math.round(box.height);
  }

  return {
    element,
    get mapHost() {
      return mapHostEl;
    },
    update(model) {
      order = sceneOrder(model);
      const id = currentScene(model);
      // The room the rail actually has, asked of the engine's own arithmetic; the model's count stands before the first paint.
      const ctx: SceneModel = { ...model, columns: measuredColumns(id) || model.columns };
      const built = buildScene(id, ctx);
      moreText = built.more;
      const headHtml = headMarkup(id, model.strings, built.meta, model.rotate && order.length > 1 ? { index: Math.max(0, order.indexOf(id)), count: order.length } : null);
      if (headHtml !== lastHead) { head.innerHTML = headHtml; lastHead = headHtml; }
      if (id !== currentId) {
        swap(id, built.body);
        currentId = id;
        element.dataset.scene = id;
      } else {
        // The same scene after a poll: only the regions whose markup changed are rewritten, and the map element is never among them.
        const item = currentItem();
        for (const [testid, html] of Object.entries(built.regions)) {
          if (lastRegions[testid] === html) continue;
          const region = item?.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
          if (region) region.innerHTML = html;
        }
      }
      lastRegions = built.regions;
      fit();
    },
    current: () => currentId ?? order[0]!,
    order: () => order,
    fit,
    railPad,
    destroy() {
      for (const cancel of leaving.values()) cancel();
      leaving.clear();
      element.remove();
    },
  };
}
