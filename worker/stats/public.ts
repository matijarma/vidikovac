// The public report behind /statistika/: counter rows in, the PublicStats
// wire shape out (shared/statistika.ts). Pure, so the unit project pins it.
//
// People. The venue scope is the City's own set, cityRows (export.ts), cell
// for cell: every number here about people is a sum of cells grad.csv would
// carry. The evaluation scope (temporary screens, which the City's set leaves
// out) goes through the same foldCells after its rows are unwrapped from
// `evaluation/<event>/<dim>` back to `<event>/<dim>`, so an "ostalo" keeps its
// event name and no evaluation cell ever merges with a venue cell. The page
// never sees a raw usage count: /privatnost/ point 7, "naš javni izvještaj
// koristi isključivo iste zaokružene i sažete brojeve".
//
// System. Source fetches and the tram model's counters carry no person, so
// they are summed exactly. The model's live tables arrive already shaped by
// shapeLive, without the owner's override text or unmatched entries: those
// are operator matters and stay on /stats.
import { HORIZONS_S, BUCKETS, SIGN_BUCKETS } from '../../shared/motion/hindsight';
import { PLAN_EVENTS } from '../../shared/motion/plan';
import type { DwellRow } from '../../shared/motion/dwell';
import type { JunctionRow } from '../../shared/motion/junction';
import { toLonLat, type XY } from '../../shared/motion/geo';
import {
  FOLDED_KEY,
  PEOPLE_EVENTS,
  type LiveTables,
  type PeopleEvent,
  type PeopleEventName,
  type PublicStats,
  type Share,
  type SourceStats,
  type StatistikaWindow,
  type SystemStats,
  type UsageScope,
} from '../../shared/statistika';
import type { MetricsDailyRow, MetricsTotalRow } from '../metrics-do';
import { areaName, isAreaSlug } from '../pairing/areas';
import { CITY_MIN_CELL, CITY_ROUND_TO, OSTALO, cityRows, foldCells, type CityRow, type FoldCell } from './export';

/** The hourly events the people part reads (over_cap is never public: overflow is not demand). */
export const PUBLIC_USAGE_EVENTS = [...PEOPLE_EVENTS, 'hitno_view', 'evaluation'] as const;

/** The system events, read as sums over hours. */
export const PUBLIC_SYSTEM_EVENTS = [
  'source_fetch',
  'twin_tick',
  'twin_hindsight',
  'twin_hindsight_sign',
  'twin_order',
  'twin_plan',
  'static_watch',
] as const;

/** The source modules in the order the page lists them (worker/feed/schema.ts ModuleId). */
export const SOURCE_ORDER = ['zet-rt', 'prometnice', 'dhmz-now', 'dhmz-forecast', 'dhmz-cap', 'emsc', 'glasnik', 'ckan-geo', 'dogadanja'] as const;

const TICK_DIMS = ['ok', 'unchanged', 'error', 'stale_index', 'overrides_unreadable'] as const;
const ORDER_DIMS = ['established', 'dropped', 'hold', 'push', 'concession', 'swap'] as const;
const WATCH_DIMS = ['current', 'newer', 'unknown', 'error'] as const;

/** Rows of each live table the page draws. */
export const LIVE_ROWS = 12;
/** A crossing is named after the nearest stop this close to it, metres. */
export const JUNCTION_NAME_RADIUS_M = 250;

export interface PublicStatsInput {
  days: StatistikaWindow;
  since: string;
  today: string;
  now: Date;
  /** Hourly rows of PUBLIC_USAGE_EVENTS on or after `since`. */
  usageRows: readonly MetricsDailyRow[];
  /** PUBLIC_SYSTEM_EVENTS summed over the window (day ''). */
  systemTotals: readonly MetricsTotalRow[];
  /** twin_tick summed per day. */
  tickDaily: readonly MetricsTotalRow[];
  live: LiveTables | null;
}

/** Every Zagreb day from since to today, oldest first. */
export function dayList(since: string, today: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${since}T00:00:00Z`); days.length <= 366; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    days.push(day);
    if (day >= today) break;
  }
  return days;
}

/** An evaluation row back in the shape of the event it stands for, or null
 *  for one that is never public (over_cap). Temporary screens have no venue
 *  type, so a screen scan's first dimension is 'privremeni'; the room's
 *  events lose their second dimension on the way in (worker/do/room-do.ts
 *  metric), so it stays empty here. */
export function unwrapEvaluation(r: MetricsDailyRow): FoldCell | null {
  const base = { day: r.day, hour: String(r.hour), count: r.count };
  switch (r.dim1) {
    case 'session_start':
      return r.dim2 === 'phone'
        ? { ...base, event: 'session_start', dim1: 'phone', dim2: '' }
        : { ...base, event: 'session_start', dim1: 'privremeni', dim2: r.dim2 };
    case 'session_end':
    case 'scan_fail':
    case 'kiosk_online':
    case 'panel_open':
    case 'export':
      return { ...base, event: r.dim1, dim1: r.dim2, dim2: '' };
    default:
      return null;
  }
}

/** The fold writes 'ostalo' into both dimensions; a venue of type 'ostalo'
 *  still names its district, so the pair tells the two apart. */
function isFolded(r: CityRow): boolean {
  return r.dim1 === OSTALO && r.dim2 === OSTALO;
}

function shares(rows: readonly CityRow[], dim: 'dim1' | 'dim2'): Share[] {
  const sums = new Map<string, number>();
  for (const r of rows) {
    const key = isFolded(r) ? FOLDED_KEY : r[dim];
    sums.set(key, (sums.get(key) ?? 0) + r.count);
  }
  return [...sums.entries()]
    .map(([key, count]): Share => (isAreaSlug(key) ? { key, label: areaName(key), count } : { key, count }))
    .sort((a, b) => Number(a.key === FOLDED_KEY) - Number(b.key === FOLDED_KEY) || b.count - a.count || a.key.localeCompare(b.key, 'hr'));
}

/** One person-event from folded cells. */
export function peopleEvent(cells: readonly CityRow[], event: string, days: readonly string[]): PeopleEvent {
  const own = cells.filter((c) => c.event === event);
  const index = new Map(days.map((d, i) => [d, i]));
  const daily: (number | null)[] = days.map(() => null);
  const hours = Array.from({ length: 24 }, () => 0);
  let total = 0;
  let wholeDay = 0;
  for (const c of own) {
    total += c.count;
    const i = index.get(c.day);
    if (i !== undefined) daily[i] = (daily[i] ?? 0) + c.count;
    if (c.hour === '') wholeDay += c.count;
    else hours[Number(c.hour)] += c.count;
  }
  return { total, daily, hours, wholeDay, dim1: shares(own, 'dim1'), dim2: shares(own, 'dim2') };
}

function scope(cells: readonly CityRow[], days: readonly string[]): UsageScope {
  const out = {} as UsageScope;
  for (const event of PEOPLE_EVENTS) out[event as PeopleEventName] = peopleEvent(cells, event, days);
  return out;
}

function sumWhere(rows: readonly MetricsTotalRow[], pred: (r: MetricsTotalRow) => boolean): number {
  let total = 0;
  for (const r of rows) if (pred(r)) total += r.count;
  return total;
}

function counts(rows: readonly MetricsTotalRow[], event: string, keys: readonly string[], pick: (r: MetricsTotalRow) => string = (r) => r.dim1): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = 0;
  for (const r of rows) {
    if (r.event !== event) continue;
    const k = pick(r);
    out[k] = (out[k] ?? 0) + r.count;
  }
  return out;
}

function orderedShares(record: Record<string, number>, order: readonly string[]): Share[] {
  return order.map((key) => ({ key, count: record[key] ?? 0 }));
}

function system(input: PublicStatsInput, days: readonly string[]): SystemStats {
  const totals = input.systemTotals;
  const byModule = new Map<string, SourceStats>();
  for (const r of totals) {
    if (r.event !== 'source_fetch') continue;
    let s = byModule.get(r.dim1);
    if (!s) {
      s = { module: r.dim1, ok: 0, partial: 0, stale: 0, error: 0 };
      byModule.set(r.dim1, s);
    }
    if (r.dim2 === 'ok' || r.dim2 === 'partial' || r.dim2 === 'stale' || r.dim2 === 'error') s[r.dim2] += r.count;
  }
  const rank = (m: string): number => {
    const i = (SOURCE_ORDER as readonly string[]).indexOf(m);
    return i < 0 ? SOURCE_ORDER.length : i;
  };
  const sources = [...byModule.values()].sort((a, b) => rank(a.module) - rank(b.module) || a.module.localeCompare(b.module));

  const index = new Map(days.map((d, i) => [d, i]));
  const ticksGood = days.map(() => 0);
  const ticksAll = days.map(() => 0);
  for (const r of input.tickDaily) {
    if (r.event !== 'twin_tick' || r.dim1 === 'overrides_unreadable') continue;
    const i = index.get(r.day);
    if (i === undefined) continue;
    ticksAll[i] += r.count;
    if (r.dim1 === 'ok' || r.dim1 === 'unchanged') ticksGood[i] += r.count;
  }

  const hindsight = HORIZONS_S.map((h) => {
    const horizon = `${h}s`;
    return {
      horizon,
      buckets: counts(totals.filter((r) => r.dim1 === horizon), 'twin_hindsight', BUCKETS, (r) => r.dim2),
      sign: counts(totals.filter((r) => r.dim1 === horizon), 'twin_hindsight_sign', SIGN_BUCKETS, (r) => r.dim2),
    };
  });

  return {
    sources,
    ticks: counts(totals, 'twin_tick', TICK_DIMS),
    coldTicks: sumWhere(totals, (r) => r.event === 'twin_tick' && r.dim2 === 'cold'),
    ticksGood,
    ticksAll,
    hindsight,
    plan: orderedShares(counts(totals, 'twin_plan', PLAN_EVENTS), PLAN_EVENTS),
    order: orderedShares(counts(totals, 'twin_order', ORDER_DIMS), ORDER_DIMS),
    timetable: counts(totals, 'static_watch', WATCH_DIMS),
    live: input.live,
  };
}

export function buildPublicStats(input: PublicStatsInput): PublicStats {
  const days = dayList(input.since, input.today);

  const cityCells = cityRows(input.usageRows);
  const venueCells = cityCells.filter((c) => c.event !== 'hitno_view');
  const hitnoCells = cityCells.filter((c) => c.event === 'hitno_view');

  const evaluationCells = foldCells(
    input.usageRows
      .filter((r) => r.event === 'evaluation')
      .map(unwrapEvaluation)
      .filter((c): c is FoldCell => c !== null),
  );

  return {
    version: 1,
    generatedAt: input.now.toISOString(),
    window: { days: input.days, since: input.since, today: input.today, timeZone: 'Europe/Zagreb' },
    days,
    rules: { roundTo: CITY_ROUND_TO, minCell: CITY_MIN_CELL },
    venue: scope(venueCells, days),
    evaluation: scope(evaluationCells, days),
    hitno: peopleEvent(hitnoCells, 'hitno_view', days),
    system: system(input, days),
  };
}

// ---- the model's live tables, shaped for the public ---------------------------

/** What shapeLive needs of the rail graph: node ends and named stops. */
export interface LiveGraph {
  edges: readonly { from: number; to: number; pts: readonly XY[] }[];
  stops: readonly { name: string; p: XY }[];
}

/** Where a rail node lies: an edge's first point is its `from`, its last its `to`. */
function nodePoint(net: LiveGraph, node: number): XY | null {
  for (const e of net.edges) {
    if (e.pts.length === 0) continue;
    if (e.from === node) return e.pts[0];
    if (e.to === node) return e.pts[e.pts.length - 1];
  }
  return null;
}

function nearestStop(net: LiveGraph, p: XY, radius: number): string | null {
  let best: string | null = null;
  let bestD = radius * radius;
  for (const s of net.stops) {
    const dx = s.p.x - p.x;
    const dy = s.p.y - p.y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = s.name;
    }
  }
  return best;
}

/**
 * The live dwell and junction tables as the public sees them: the stops with
 * the most measured stands, and the crossings that cost a tram the most time
 * per pass (share of passes that stood x the median stand), placed on the map
 * and named after the nearest stop. No override text, no unmatched entries.
 */
export function shapeLive(
  tables: { at: number; dwell: readonly DwellRow[]; junctions: readonly JunctionRow[] },
  net: LiveGraph | null,
): LiveTables {
  const stops = tables.dwell
    .filter((r) => r.samples > 0)
    .sort((a, b) => b.samples - a.samples || a.name.localeCompare(b.name, 'hr'))
    .slice(0, LIVE_ROWS)
    .map((r) => ({ name: r.name, p50: r.p50, pPlan: r.pPlan, plannedSec: r.plannedSec, samples: r.samples }));
  const cost = (r: JunctionRow): number => r.share * (r.p50 ?? 0);
  const junctions = [];
  if (net) {
    for (const r of [...tables.junctions].filter((j) => j.waits > 0 && j.p50 !== null).sort((a, b) => cost(b) - cost(a) || b.passes - a.passes)) {
      if (junctions.length >= LIVE_ROWS) break;
      const p = nodePoint(net, r.node);
      if (!p) continue;
      const [lon, lat] = toLonLat(p);
      junctions.push({
        near: nearestStop(net, p, JUNCTION_NAME_RADIUS_M),
        lon: Math.round(lon * 1e5) / 1e5,
        lat: Math.round(lat * 1e5) / 1e5,
        passes: r.passes,
        waits: r.waits,
        share: Math.round(r.share * 1000) / 1000,
        p50: r.p50,
      });
    }
  }
  return {
    at: tables.at,
    stops,
    junctions,
    stopsKnown: tables.dwell.filter((r) => r.samples > 0).length,
    junctionsKnown: tables.junctions.length,
  };
}
