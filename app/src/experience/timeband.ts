// The time band (newdesignsystem.md §4.2, plan A.3 and A.4): time is the only
// axis of Sada. Five columns, sada · poslijepodne · večeras · sutra · tjedan,
// cut at 18:00 and at the service day's 04:00 in Zagreb wall-clock time; after
// 18:00 the afternoon leaves and the axis shifts left one bucket (four
// columns), because no data reaches beyond day+6. Every domain writes into
// that axis: a producer describes tiles, `bucketOf` tells which lane a start
// belongs to, `buildTimeband` sorts, caps and marks stale. This module holds
// the model; the columns and their clock arithmetic live in kiosk/columns.ts
// (re-exported here). The band's renderers and the phone's segment-to-lane
// sync went with Sada's time band (WP4 replaced it; WP5 A3 deleted them).
import type { ModuleId, ModuleSnapshot } from '../../../worker/feed/schema';
import type { LayerId } from '../../../worker/protocol';
import { FLAGS, type Flag } from '../core/flags';
import { zagrebDayKey, zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import { columnsFor, frameFor, NOON_HOUR, zagrebInstant, type ColumnSpec } from '../kiosk/columns';
import type { LayerContext } from '../layers/types';
import { DEFAULT_PRODUCERS } from './producers';
import { stateBlock, statusBadge } from './status';
import { DOMAIN_ORDER, type Bucket, type Tile, type TileDomain, type TileVariant } from './tiles';
import { weatherStatus, type WeatherStatus } from './weather-status';

export { columnsFor, DAY_START_HOUR, EVENING_HOUR, HORIZON_DAYS, NOON_HOUR, zagrebInstant, type ColumnSpec } from '../kiosk/columns';

/** Tiles per time lane before the "+ N" foot. */
export const LANE_CAP = { phone: 4, desktop: 6 } as const;
/** Tiles per domain in the sada lane; every domain not named here shows one. */
export const SADA_DOMAIN_CAP = { transit: { phone: 2, desktop: 4 } } as const;
/** The view-store filter key that carries the selected column (view-store rejects dotted keys). */
export const FILTER_KEY = 'tb-col';

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

/**
 * The shell's one-second tick lands here: when the minute changed, the clock
 * text and its datetime follow. Within a minute nothing is touched. No
 * renderer has emitted a `.day-clock` since WP4 rewrote Sada, so today the
 * tick finds nothing; it goes with this module (WP5 step 9).
 */
export function tickTimebandClock(root: ParentNode, now: number): void {
  const clock = root.querySelector('.day-clock');
  if (!clock) return;
  const time = zagrebTime(now);
  if (clock.textContent === time) return;
  clock.textContent = time;
  clock.setAttribute('datetime', new Date(now).toISOString());
}
