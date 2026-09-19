// The time band (newdesignsystem.md §4.2, plan A.3 and A.4): time is the only
// axis of Sada. Five columns, sada · poslijepodne · večeras · sutra · tjedan,
// cut at 18:00 and at the service day's 04:00 in Zagreb wall-clock time; after
// 18:00 the afternoon leaves and the axis shifts left one bucket (four
// columns), because no data reaches beyond day+6. Every domain writes into
// that axis: a producer describes tiles, `bucketOf` tells which lane a start
// belongs to, `buildTimeband` sorts, caps and marks stale, and the two
// renderers write the segments and the band. This module holds the clock
// arithmetic, the model and the band's markup; a tile's markup lives in
// tiles.ts, and the phone's segment-to-lane sync in timeband-sync.ts.
import type { ModuleId, ModuleSnapshot } from '../../../worker/feed/schema';
import type { LayerId } from '../../../worker/protocol';
import { FLAGS, type Flag } from '../core/flags';
import { zagrebDayKey, zagrebHour, zagrebTime, zagrebWeekdayShort } from '../format';
import type { I18n } from '../i18n/i18n';
import type { LayerContext } from '../layers/types';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import { attrs } from './blocks';
import { DEFAULT_PRODUCERS } from './producers';
import { stateBlock, statusBadge } from './status';
import { DOMAIN_ORDER, skeletonTileMarkup, tileMarkup, type Bucket, type Tile, type TileDomain, type TileVariant } from './tiles';
import { weatherStatus, weatherStatusMarkup, type WeatherStatus } from './weather-status';

/** One column of the band: its lane id, the time word, the segment word, the head line and its half-open window. */
export interface ColumnSpec {
  id: Bucket;
  /** The time word the head and the h3 read: sada, poslijepodne, večeras, noćas, sutra, tjedan. */
  label: string;
  /** The shorter word the phone's segment button shows (popodne for poslijepodne). */
  seg: string;
  /** "do 18:00", "od 18:00", "sub 12. 9.", "do čet 17. 9."; '' for sada, where the clock stands. */
  head: string;
  start: number;
  end: number;
}

/** The service day starts at 04:00: a night bus at 01:30 still belongs to the evening before. */
export const DAY_START_HOUR = 4;
export const EVENING_HOUR = 18;
export const NOON_HOUR = 12;
export const HORIZON_DAYS = 7;
/** Tiles per time lane before the "+ N" foot. */
export const LANE_CAP = { phone: 4, desktop: 6 } as const;
/** Tiles per domain in the sada lane; every domain not named here shows one. */
export const SADA_DOMAIN_CAP = { transit: { phone: 2, desktop: 4 } } as const;
/** The phone's sada lane ends with this many tiles from the following lanes under a "Zatim" kicker (concept 02). */
export const NEXT_CAP = 2;
/** The view-store filter key that carries the selected column (view-store rejects dotted keys). */
export const FILTER_KEY = 'tb-col';

const HOUR_MS = 3_600_000;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `dayKey` shifted by whole days, in the same 'YYYY-MM-DD' form; '' when the key is not a date. */
function shiftDay(dayKey: string, days: number): string {
  const m = DAY_KEY.exec(dayKey);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * The UTC instant at which Zagreb's wall clock reads `hour`:00 on `dayKey`.
 * The guess assumes CEST (UTC+2); when the clock disagrees, the difference in
 * hours (counting a day boundary the guess may have crossed) is subtracted,
 * at most twice, which settles on either side of a DST cut. The band's cuts
 * (04:00, 12:00, 18:00) never fall inside the repeated or the skipped hour.
 * NaN for a key that is not a date, so every comparison against it is false.
 */
export function zagrebInstant(dayKey: string, hour: number): number {
  const m = DAY_KEY.exec(dayKey);
  if (!m) return NaN;
  let guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour) - 2 * HOUR_MS;
  for (let i = 0; i < 2; i += 1) {
    const day = zagrebDayKey(guess);
    const dayOffset = day < dayKey ? -1 : day > dayKey ? 1 : 0;
    const delta = (zagrebHour(guess) ?? hour) - hour + 24 * dayOffset;
    if (delta === 0) break;
    guess -= delta * HOUR_MS;
  }
  return guess;
}

/** The band's frame for one moment: the service day and the cuts every column is built from. */
interface Frame {
  hour: number;
  today: string;
  /** The service day: today, or yesterday before 04:00. */
  d0: string;
  mode: 'day' | 'night';
  b18: number;
  b04: number;
  b04b: number;
  bEnd: number;
}

function frameFor(now: number): Frame {
  const hour = zagrebHour(now) ?? 0;
  const today = zagrebDayKey(now);
  const d0 = hour < DAY_START_HOUR ? shiftDay(today, -1) : today;
  return {
    hour,
    today,
    d0,
    mode: hour >= DAY_START_HOUR && hour < EVENING_HOUR ? 'day' : 'night',
    b18: zagrebInstant(d0, EVENING_HOUR),
    b04: zagrebInstant(shiftDay(d0, 1), DAY_START_HOUR),
    b04b: zagrebInstant(shiftDay(d0, 2), DAY_START_HOUR),
    bEnd: zagrebInstant(shiftDay(d0, HORIZON_DAYS), DAY_START_HOUR),
  };
}

/**
 * The columns for this moment. Day mode (04:00 to 18:00): sada, the day
 * column ("danas" before noon, "poslijepodne" after, to 18:00), večeras (from
 * 18:00 to 04:00), sutra, tjedan. Night mode: sada, noćas (now to 04:00),
 * sutra, tjedan. Between 00:00 and 04:00 the sutra column is this calendar
 * day, so it is labelled "danas" with its date, like dayLabel().
 */
export function columnsFor(i18n: I18n, now: number): ColumnSpec[] {
  const t = (key: string, vars?: Record<string, string | number>): string => i18n.t(key, vars);
  const f = frameFor(now);
  const columns: ColumnSpec[] = [{ id: 'sada', label: t('timeband.sada'), seg: t('timeband.seg.sada'), head: '', start: now, end: now }];
  if (f.mode === 'day') {
    const morning = f.hour < NOON_HOUR;
    columns.push(
      { id: 'danas', label: t(morning ? 'timeband.today' : 'timeband.afternoon'), seg: t(morning ? 'timeband.seg.today' : 'timeband.seg.afternoon'), head: t('timeband.headUntil', { time: zagrebTime(f.b18) }), start: now, end: f.b18 },
      { id: 'veceras', label: t('timeband.tonight'), seg: t('timeband.seg.tonight'), head: t('timeband.headFrom', { time: zagrebTime(f.b18) }), start: f.b18, end: f.b04 },
    );
  } else {
    columns.push({ id: 'veceras', label: t('timeband.night'), seg: t('timeband.seg.night'), head: t('timeband.headUntil', { time: zagrebTime(f.b04) }), start: now, end: f.b04 });
  }
  const nextIsToday = zagrebDayKey(f.b04) === f.today;
  columns.push(
    { id: 'sutra', label: t(nextIsToday ? 'timeband.today' : 'timeband.tomorrow'), seg: t(nextIsToday ? 'timeband.seg.today' : 'timeband.seg.tomorrow'), head: zagrebWeekdayShort(f.b04), start: f.b04, end: f.b04b },
    { id: 'tjedan', label: t('timeband.week'), seg: t('timeband.seg.week'), head: t('timeband.headUntilDate', { date: zagrebWeekdayShort(zagrebInstant(shiftDay(f.d0, HORIZON_DAYS - 1), NOON_HOUR)) }), start: f.b04b, end: f.bEnd },
  );
  return columns;
}

/** The column whose half-open window holds `instant`, the sada column excluded (its window is empty). */
function columnHolding(columns: readonly ColumnSpec[], instant: number): ColumnSpec | undefined {
  return columns.find((c) => c.id !== 'sada' && c.start <= instant && instant < c.end);
}

/**
 * Which lane a start belongs to, or null when it has no place on the band.
 * All-day: the column holding the day's noon; a day whose noon has passed
 * but is still the current service day goes to the first time lane. Timed:
 * running (`start ≤ now < end`) is sada, where the producer decides whether
 * a running thing is a live value or an agenda item to drop; over is null;
 * otherwise the column holding the start, or null beyond the horizon.
 */
export function bucketOf(now: number, columns: readonly ColumnSpec[], at: string | undefined, until?: string, allDay?: boolean): Bucket | null {
  if (!at) return null;
  const start = Date.parse(at);
  if (!Number.isFinite(start)) return null;
  if (allDay) {
    const day = zagrebDayKey(start);
    const held = columnHolding(columns, zagrebInstant(day, NOON_HOUR));
    if (held) return held.id;
    const firstTimeLane = columns.find((c) => c.id !== 'sada');
    return day === frameFor(now).d0 && firstTimeLane ? firstTimeLane.id : null;
  }
  const untilMs = until ? Date.parse(until) : NaN;
  const end = Number.isFinite(untilMs) ? untilMs : start;
  if (start <= now && now < end) return 'sada';
  if (start < now) return null;
  return columnHolding(columns, start)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Producers and the model

export interface ProduceOptions {
  columns: readonly ColumnSpec[];
  surface: 'phone' | 'desktop';
  /** `bucketOf` bound to this moment and these columns. */
  bucket: (at?: string, until?: string, allDay?: boolean) => Bucket | null;
}

export interface TileProducer {
  domain: TileDomain;
  /** The modules read; `modules[0]` decides loading, down and stale. */
  modules: readonly ModuleId[];
  layer: LayerId;
  /** The shape painted while `modules[0]` has not answered: which lane ('next' is the first time lane), which variant, how many at most. Null paints nothing. */
  skeleton: { bucket: Bucket | 'next'; variant: TileVariant; count: number } | null;
  /** Skipped entirely, skeleton included, while FLAGS[flag] is false. */
  flag?: Flag;
  produce(ctx: LayerContext, o: ProduceOptions): Tile[];
  /** The words of the "+ N" foot for this producer's trimmed tiles; timeband.moreItems when absent. */
  moreLabel?(i18n: I18n, count: number, ctx: LayerContext): { text: string; aria?: string };
}

export type LaneFoot =
  | { kind: 'more'; domain: TileDomain; layer: LayerId; count: number; text: string; aria?: string }
  | { kind: 'state'; domain: TileDomain; markup: string };

/** One placeholder tile: the lane paints it, aria-hidden, where the domain's tile will stand. */
export interface LaneSkeleton { domain: TileDomain; variant: TileVariant; key: string }

export interface Lane {
  col: Bucket;
  tiles: Tile[];
  foot: LaneFoot[];
  /** A source this lane waits for has not answered: `aria-busy` and the loading word. */
  busy: boolean;
  skeletons: LaneSkeleton[];
  /** The phone's sada lane only: the first NEXT_CAP tiles of the lanes that follow, shown compact under "Zatim" so the first screen answers now and next without a swipe. */
  next?: Tile[];
}

export interface TimebandModel {
  now: number;
  columns: ColumnSpec[];
  lanes: Lane[];
  mode: 'day' | 'night';
  surface: 'phone' | 'desktop';
  selected: Bucket;
  /** 'HH:MM' in Zagreb: the 40 px clock in the sada head. */
  clock: string;
  /** The phone's weather group beside the clock; null on the desktop (the status line carries it) and without a usable observation. */
  weather: WeatherStatus | null;
}

/**
 * The reader's alert switches (plan T3.3, ctx.notify) surface a matching tile
 * with a stroke, never a push (PUSH stays off, D7): a delay past the
 * threshold on a saved line, the works band once its count clears zero, the
 * safety band gone urgent, or a waste tile (T3.2, `tile-waste`). Local
 * highlighting only; nothing here is sent anywhere.
 */
const DELAY_ALERT_SECONDS = 300;

/** Whether `tile` is the reader's own saved line, read from `ctx.saved` (T2.5) exactly as it reaches the context. */
function isSavedRoute(ctx: LayerContext, tile: Tile): boolean {
  return tile.selection?.kind === 'route' && (ctx.saved?.has('route', tile.selection.id) ?? false);
}

function highlighted(ctx: LayerContext, tile: Tile): boolean {
  const notify = ctx.notify;
  if (!notify) return false;
  if (notify.delays && tile.domain === 'transit' && isSavedRoute(ctx, tile)) {
    const delay = Number(tile.data?.delay);
    if (Number.isFinite(delay) && Math.abs(delay) > DELAY_ALERT_SECONDS) return true;
  }
  if (notify.works && tile.testid === 'tile-works') {
    const count = Number(tile.value);
    if (Number.isFinite(count) && count > 0) return true;
  }
  if (notify.dhmz && tile.domain === 'safety' && tile.data?.level === 'urgent') return true;
  if (notify.waste && tile.testid === 'tile-waste') return true;
  return false;
}

/** DOMAIN_ORDER's place of a domain; a domain outside the order sorts last. */
function domainRank(domain: TileDomain): number {
  const index = DOMAIN_ORDER.indexOf(domain);
  return index === -1 ? DOMAIN_ORDER.length : index;
}

/** A time lane's sort key: the start; an all-day item leads its day from the day's Zagreb midnight; the unparseable trail. */
function startKey(tile: Tile): number {
  const start = tile.at ? Date.parse(tile.at) : NaN;
  if (!Number.isFinite(start)) return Number.POSITIVE_INFINITY;
  return tile.allDay ? zagrebInstant(zagrebDayKey(start), 0) : start;
}

interface Trim { kept: Tile[]; cut: Map<TileDomain, Tile[]> }

function groupByDomain(tiles: readonly Tile[], into = new Map<TileDomain, Tile[]>()): Map<TileDomain, Tile[]> {
  for (const tile of tiles) into.set(tile.domain, [...(into.get(tile.domain) ?? []), tile]);
  return into;
}

/** The sada cap: no domain exceeds `capOf(domain)`; what was cut is grouped by domain in order of first appearance. */
function trimByDomain(tiles: readonly Tile[], capOf: (domain: TileDomain) => number): Trim {
  const shown = new Map<TileDomain, number>();
  const kept: Tile[] = [];
  const cut: Tile[] = [];
  for (const tile of tiles) {
    const n = shown.get(tile.domain) ?? 0;
    if (n < capOf(tile.domain)) {
      shown.set(tile.domain, n + 1);
      kept.push(tile);
    } else {
      cut.push(tile);
    }
  }
  return { kept, cut: groupByDomain(cut) };
}

/** The time-lane cap: the first `cap` tiles stay; the rest are grouped by domain for the feet. */
function trimByCount(tiles: readonly Tile[], cap: number): Trim {
  return { kept: tiles.slice(0, cap), cut: groupByDomain(tiles.slice(cap)) };
}

/**
 * The model of the band for this context: the columns for `ctx.now`, one
 * lane per column, every producer's tiles sorted, capped and marked. A
 * producer's lead module decides its state: not yet answered paints the
 * producer's skeleton in its lane (busy); down paints no tile and one state
 * block with a retry in that lane (once per module and lane); stale marks
 * every tile with the status badge. The safety producer is the one exception
 * and always stands: its band is itself the state word (safetyState says
 * unknown when a source has not vouched); a producer that names no module
 * has no feed to wait for and stands as well. A producer behind a flag that
 * is off is never asked.
 */
export function buildTimeband(ctx: LayerContext, producers: readonly TileProducer[] = DEFAULT_PRODUCERS): TimebandModel {
  const { i18n, now } = ctx;
  const frame = frameFor(now);
  const columns = columnsFor(i18n, now);
  const surface: 'phone' | 'desktop' = ctx.screen?.surface === 'phone' ? 'phone' : 'desktop';
  const options: ProduceOptions = { columns, surface, bucket: (at, until, allDay) => bucketOf(now, columns, at, until, allDay) };

  const lanes = new Map<Bucket, Lane>(columns.map((c) => [c.id, { col: c.id, tiles: [], foot: [], busy: false, skeletons: [] }]));
  const nextLane = lanes.get(columns[1]!.id)!;
  const laneOf = (bucket: Bucket | 'next'): Lane => (bucket === 'next' ? nextLane : lanes.get(bucket) ?? nextLane);
  const domainCaps: Partial<Record<TileDomain, Record<'phone' | 'desktop', number>>> = SADA_DOMAIN_CAP;
  const sadaCap = (domain: TileDomain): number => domainCaps[domain]?.[surface] ?? 1;

  const producerOf = new Map<Tile, TileProducer>();
  const stateFeet = new Map<Bucket, LaneFoot[]>();
  const stated = new Set<string>();

  for (const producer of producers) {
    if (producer.flag && !FLAGS[producer.flag]) continue;
    const lead = producer.modules[0];
    const snapshot: ModuleSnapshot | undefined = lead ? ctx.snapshots[lead] : undefined;
    const error = lead ? ctx.errors?.[lead] : undefined;
    // A producer without a module (the last departure: a schedule on disk) has no feed to wait for and always stands.
    const state = !lead ? 'live' : snapshot ? snapshot.status : error ? 'down' : 'loading';
    const gated = producer.domain !== 'safety';
    if (gated && state === 'loading') {
      if (!producer.skeleton) continue;
      // A skeleton never promises more than the lane would show: the domain's sada cap, or the time lane's cap.
      const lane = laneOf(producer.skeleton.bucket);
      const already = lane.skeletons.filter((s) => s.domain === producer.domain).length;
      const room = lane.col === 'sada' ? sadaCap(producer.domain) - already : LANE_CAP[surface] - lane.skeletons.length;
      for (let i = 0; i < Math.min(producer.skeleton.count, room); i += 1) {
        lane.skeletons.push({ domain: producer.domain, variant: producer.skeleton.variant, key: `sk-${producer.domain}-${already + i}` });
      }
      lane.busy = true;
      continue;
    }
    if (gated && state === 'down' && lead) {
      const lane = producer.skeleton ? laneOf(producer.skeleton.bucket) : laneOf('sada');
      const mark = `${lane.col}:${lead}`;
      if (stated.has(mark)) continue;
      stated.add(mark);
      const markup = stateBlock(i18n, 'down', i18n.t('status.unknown'), { retry: lead, testid: `tb-state-${producer.domain}` });
      stateFeet.set(lane.col, [...(stateFeet.get(lane.col) ?? []), { kind: 'state', domain: producer.domain, markup }]);
      continue;
    }
    const badge = gated && snapshot?.status === 'stale' ? statusBadge(i18n, snapshot) : '';
    for (const tile of producer.produce(ctx, options)) {
      const bucket = tile.bucket ?? options.bucket(tile.at, tile.until, tile.allDay);
      if (!bucket) continue;
      if (badge) tile.stale = badge;
      if (highlighted(ctx, tile)) tile.data = { ...tile.data, highlight: '1' };
      producerOf.set(tile, producer);
      laneOf(bucket).tiles.push(tile);
    }
  }

  for (const lane of lanes.values()) {
    if (lane.col === 'sada') {
      lane.tiles.sort((a, b) => domainRank(a.domain) - domainRank(b.domain));
    } else {
      lane.tiles.sort((a, b) => startKey(a) - startKey(b));
    }
    if (lane.col === 'veceras') {
      const first = lane.tiles.find((t) => t.domain === 'events');
      if (first) first.tone = 'events';
    }
    const { kept, cut } = lane.col === 'sada' ? trimByDomain(lane.tiles, sadaCap) : trimByCount(lane.tiles, LANE_CAP[surface]);
    lane.tiles = kept;
    const more: LaneFoot[] = [...cut.entries()].map(([domain, tiles]) => {
      const producer = producerOf.get(tiles[0]!)!;
      const count = tiles.length;
      const words = producer.moreLabel?.(i18n, count, ctx) ?? { text: i18n.t('timeband.moreItems', { count }) };
      return { kind: 'more', domain, layer: producer.layer, count, text: words.text, aria: words.aria };
    });
    lane.foot = [...more, ...(stateFeet.get(lane.col) ?? [])];
  }

  if (surface === 'phone') {
    const sada = lanes.get('sada')!;
    sada.next = columns.slice(1).flatMap((c) => lanes.get(c.id)!.tiles).slice(0, NEXT_CAP);
  }

  const wanted = ctx.view?.filters[FILTER_KEY];
  const selected: Bucket = wanted && lanes.has(wanted as Bucket) ? (wanted as Bucket) : 'sada';
  return {
    now,
    columns,
    lanes: columns.map((c) => lanes.get(c.id)!),
    mode: frame.mode,
    surface,
    selected,
    clock: zagrebTime(now),
    weather: surface === 'phone' ? weatherStatus(i18n, ctx.snapshots, now) : null,
  };
}

// ---------------------------------------------------------------------------
// Markup

/**
 * The phone's segmented control: one group, `aria-pressed` per button, the
 * time word and its head (the clock for sada) as the label. Rendered on every
 * surface and shown only in the ≤ 36rem room by CSS. Not a tablist: every
 * lane stays in the accessibility tree, so there is no hidden panel to
 * promise. The dashboard routes `data-action="filter"` into `view.setFilter`.
 */
export function renderTimebandSeg(i18n: I18n, model: TimebandModel): string {
  const buttons = model.columns.map((c) => {
    const pressed = c.id === model.selected;
    const label = `${c.label}, ${c.head || model.clock}`;
    return `<button type="button" class="tb-seg-btn" data-action="filter" data-filter-key="${FILTER_KEY}" data-filter-value="${c.id}" aria-pressed="${pressed}" aria-label="${escapeAttribute(label)}"><span>${escapeHtml(c.seg)}</span></button>`;
  });
  // The buttons sit in a surface-2 track (kajimafix 02.3); the sticky wrapper keeps the canvas behind it while the lanes scroll under.
  return `<div class="tb-seg" role="group" aria-label="${escapeAttribute(i18n.t('timeband.segLabel'))}" data-key="tb-seg" data-testid="tb-seg" data-col="${model.selected}"><div class="tb-seg-track">${buttons.join('')}</div></div>`;
}

/** The phone's weather group beside the clock, one link into Vrijeme. */
function weatherMarkup(weather: WeatherStatus): string {
  const a = attrs({
    class: 'tb-weather', href: '#layer=zrak-i-nebo', 'data-action': 'nav', 'data-layer': 'zrak-i-nebo', 'data-testid': 'tb-weather',
    'data-status': weather.stale ? 'stale' : 'live', 'aria-label': weather.aria,
  });
  return `<a ${a}>${weatherStatusMarkup(weather)}</a>`;
}

/** A column head: the time word and its head text as one h3, so a reader hears the time words as headings; sada carries the clock. */
function headMarkup(model: TimebandModel, c: ColumnSpec): string {
  const current = c.id === model.selected;
  const root = attrs({ class: 'tb-head', 'data-col': c.id, 'data-key': `head-${c.id}`, 'data-testid': `tb-head-${c.id}`, 'data-current': current ? 'true' : undefined });
  const h = c.id === 'sada'
    ? `<time class="tb-h tb-clock" data-testid="tb-clock" datetime="${new Date(model.now).toISOString()}">${escapeHtml(model.clock)}</time>`
    : `<span class="tb-h">${escapeHtml(c.head)}</span>`;
  const weather = c.id === 'sada' && model.weather ? weatherMarkup(model.weather) : '';
  return `<div ${root}><h3 class="tb-head-title" id="tb-head-${c.id}"><span class="tb-word kicker">${escapeHtml(c.label)}</span> ${h}</h3>${weather}</div>`;
}

/**
 * The "+ N" foot: a link into the domain in navLink's shape (the words, the
 * arrow), with the reconciler key, the testid and the producer's aria that
 * navLink has no options for.
 */
function moreMarkup(foot: Extract<LaneFoot, { kind: 'more' }>): string {
  const a = attrs({
    class: 'tb-more', 'data-key': `more-${foot.domain}`, 'data-testid': `tb-more-${foot.domain}`, href: `#layer=${foot.layer}`,
    'data-action': 'nav', 'data-layer': foot.layer, 'aria-label': foot.aria,
  });
  return `<a ${a}><span>${escapeHtml(foot.text)}</span>${iconMarkup('arrow-up-right', undefined, 'icon icon-sm')}</a>`;
}

/**
 * A lane's body: skeletons and tiles interleaved so a skeleton stands where
 * its domain's tile will (sada reads in domain order; a time lane reads its
 * tiles by start and waits at the end), then the feet.
 */
function laneBody(i18n: I18n, lane: Lane): string {
  const skeleton = (s: LaneSkeleton): string => skeletonTileMarkup(s.variant, s.key);
  const tile = (t: Tile): string => tileMarkup(i18n, t);
  let body: string;
  if (lane.col === 'sada') {
    const domains = [...new Set([...DOMAIN_ORDER, ...lane.skeletons.map((s) => s.domain), ...lane.tiles.map((t) => t.domain)])];
    body = domains.map((d) => lane.skeletons.filter((s) => s.domain === d).map(skeleton).join('') + lane.tiles.filter((t) => t.domain === d).map(tile).join('')).join('');
  } else {
    body = lane.tiles.map(tile).join('') + lane.skeletons.map(skeleton).join('');
  }
  // The phone's "Zatim" foot: the next tiles keep their href and words but take a compact row form (data-compact), a new key and no testid, so the lane they belong to keeps the one addressable copy.
  if (lane.next?.length) {
    body += `<p class="tb-next kicker" data-key="next-head">${escapeHtml(i18n.t('timeband.next'))}</p>`
      + lane.next.map((t) => tileMarkup(i18n, { ...t, key: `next:${t.key}`, testid: undefined, data: { ...t.data, compact: '1' } })).join('');
  }
  const feet = lane.foot.map((f) => (f.kind === 'more' ? moreMarkup(f) : f.markup)).join('');
  if (!body && !feet && !lane.busy) return `<p class="tb-empty" data-key="empty">${escapeHtml(i18n.t('timeband.laneEmpty'))}</p>`;
  const loading = lane.busy ? `<span class="visually-hidden" data-key="loading">${escapeHtml(i18n.t('status.loading'))}</span>` : '';
  return `${loading}${body}${feet}`;
}

function laneMarkup(i18n: I18n, model: TimebandModel, lane: Lane): string {
  const root = attrs({
    class: 'tb-lane', 'data-col': lane.col, 'data-key': `lane-${lane.col}`, 'data-testid': `tb-lane-${lane.col}`, role: 'group',
    'aria-labelledby': `tb-head-${lane.col}`, 'data-current': lane.col === model.selected ? 'true' : undefined, 'aria-busy': lane.busy ? 'true' : undefined,
  });
  return `<div ${root}>${laneBody(i18n, lane)}</div>`;
}

/**
 * The band: heads, the decorative axis, then the lanes, in time order, so the
 * DOM order is the reading order on every surface (WCAG 2.4.3). Each lane is
 * a group labelled by its head, so on the phone (where the other heads are
 * clipped) every lane still announces its time word.
 */
export function renderTimeband(i18n: I18n, model: TimebandModel): string {
  const heads = model.columns.map((c) => headMarkup(model, c)).join('');
  const dots = model.columns.map((c) => `<span class="tb-dot" data-col="${c.id}"${c.id === 'sada' ? ' data-on="true"' : ''}></span>`).join('');
  const lanes = model.lanes.map((lane) => laneMarkup(i18n, model, lane)).join('');
  return `<section class="tb" data-cols="${model.columns.length}" data-mode="${model.mode}" data-key="tb" data-testid="tb">`
    + `<header class="tb-heads" data-key="heads">${heads}</header>`
    + `<div class="tb-axis" aria-hidden="true" data-key="axis">${dots}</div>`
    + `<div class="tb-lanes" data-key="lanes" data-testid="tb-lanes" data-col="${model.selected}">${lanes}</div>`
    + '</section>';
}

/**
 * The shell's one-second tick lands here: when the minute changed, the clock
 * text and its datetime follow, and so does the sada segment's label, which
 * reads the same clock. Within a minute nothing is touched.
 */
export function tickTimebandClock(root: ParentNode, now: number): void {
  const clock = root.querySelector('.tb-clock, .day-clock');
  if (!clock) return;
  const time = zagrebTime(now);
  if (clock.textContent === time) return;
  clock.textContent = time;
  clock.setAttribute('datetime', new Date(now).toISOString());
  const sada = root.querySelector(`.tb-seg-btn[data-filter-value="sada"]`);
  if (sada) sada.setAttribute('aria-label', `${sada.querySelector('span')?.textContent ?? ''}, ${time}`);
}
