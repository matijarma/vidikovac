// Reports for the /statistika/ spec, built by the real builder
// (worker/stats/public.ts) from synthetic counter rows, so a fixture can never
// hold a number the fold would not publish. Deterministic: a small LCG, no
// Math.random. Three shapes: busy (a month of temporary screens, a little
// venue use, every system table), sparse (a trickle that the threshold mostly
// swallows) and empty (a fresh deployment).
import type { LiveTables, PublicStats, StatistikaWindow } from '../shared/statistika';
import type { MetricsDailyRow, MetricsTotalRow } from '../worker/metrics-rows';
import { buildPublicStats, foldPublic } from '../worker/stats/public';

export type FixtureShape = 'busy' | 'sparse' | 'empty';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function daysBack(today: string, n: number): string[] {
  const out: string[] = [];
  const t0 = Date.parse(`${today}T00:00:00Z`);
  for (let i = n - 1; i >= 0; i--) out.push(new Date(t0 - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** Share of a day's use in each hour: quiet nights, a morning bump, an evening peak. */
const PROFILE = [0.2, 0.1, 0.05, 0.05, 0.1, 0.3, 0.8, 1.6, 1.8, 1.4, 1.3, 1.5, 1.9, 1.7, 1.5, 1.8, 2.3, 2.8, 2.6, 2.0, 1.5, 1.0, 0.6, 0.4];
const PROFILE_SUM = PROFILE.reduce((a, b) => a + b, 0);

const AREAS = ['donji-grad', 'tresnjevka-sjever', 'maksimir', 'trnje', 'novi-zagreb-zapad', 'sesvete', 'zagreb'];
const LAYERS = ['grad-sada', 'u-pokretu', 'zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'kultura'];
const LAYER_WEIGHT = [0.34, 0.3, 0.14, 0.06, 0.07, 0.09];

const LIVE: LiveTables = {
  at: Date.parse('2026-09-24T15:40:00Z') / 1000,
  stopsKnown: 412,
  junctionsKnown: 58,
  stops: [
    { name: 'Trg bana Jelačića', p50: 34, pPlan: 52, plannedSec: 40, samples: 1840 },
    { name: 'Glavni kolodvor', p50: 28, pPlan: 45, plannedSec: 33, samples: 1512 },
    { name: 'Savski most', p50: 19, pPlan: 30, plannedSec: 22, samples: 1204 },
    { name: 'Frankopanska', p50: 22, pPlan: 36, plannedSec: 25, samples: 1133 },
    { name: 'Draškovićeva', p50: 18, pPlan: 27, plannedSec: 20, samples: 1020 },
    { name: 'Kvaternikov trg', p50: 25, pPlan: 41, plannedSec: 29, samples: 987 },
    { name: 'Autobusni kolodvor', p50: 21, pPlan: 33, plannedSec: 24, samples: 902 },
    { name: 'Črnomerec', p50: 42, pPlan: 70, plannedSec: 48, samples: 861 },
  ],
  junctions: [
    { near: 'Trg bana Jelačića', lon: 15.97718, lat: 45.81317, passes: 2410, waits: 1180, share: 0.49, p50: 24 },
    { near: 'Glavni kolodvor', lon: 15.97791, lat: 45.80568, passes: 1920, waits: 710, share: 0.37, p50: 21 },
    { near: 'Draškovićeva', lon: 15.98464, lat: 45.81012, passes: 1702, waits: 560, share: 0.33, p50: 19 },
    { near: 'Savska cesta', lon: 15.96422, lat: 45.80388, passes: 1488, waits: 402, share: 0.27, p50: 22 },
    { near: 'Kvaternikov trg', lon: 16.00633, lat: 45.81556, passes: 1220, waits: 330, share: 0.27, p50: 17 },
    { near: 'Zagrepčanka', lon: 15.9647, lat: 45.7978, passes: 1100, waits: 240, share: 0.22, p50: 16 },
    { near: null, lon: 15.9311, lat: 45.8055, passes: 640, waits: 100, share: 0.16, p50: 14 },
  ],
};

function busyRows(days: readonly string[], r: () => number, scale: number): { usage: MetricsDailyRow[]; totals: MetricsTotalRow[]; tickDaily: MetricsTotalRow[] } {
  const usage: MetricsDailyRow[] = [];
  const push = (day: string, hour: number, event: string, dim1: string, dim2: string, count: number): void => {
    if (count > 0) usage.push({ day, hour, event, dim1, dim2, count: Math.round(count) });
  };
  days.forEach((day, di) => {
    const weekend = [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
    const growth = 0.6 + (0.8 * di) / Math.max(1, days.length - 1);
    const daily = scale * growth * (weekend ? 0.7 : 1) * (0.8 + 0.4 * r());
    for (let h = 0; h < 24; h++) {
      const perHour = (daily * PROFILE[h]) / PROFILE_SUM;
      // Temporary screens, the prototype's evaluation.
      push(day, h, 'evaluation', 'session_start', 'zagreb', perHour * 0.5 * (0.7 + 0.6 * r()));
      push(day, h, 'evaluation', 'session_start', 'donji-grad', perHour * 0.25 * (0.7 + 0.6 * r()));
      push(day, h, 'evaluation', 'session_start', 'tresnjevka-sjever', perHour * 0.12 * r());
      push(day, h, 'evaluation', 'session_start', 'maksimir', perHour * 0.08 * r());
      push(day, h, 'evaluation', 'session_start', 'phone', perHour * 0.1 * r());
      LAYERS.forEach((layer, li) => push(day, h, 'evaluation', 'panel_open', layer, perHour * 2.4 * LAYER_WEIGHT[li] * (0.7 + 0.6 * r())));
      push(day, h, 'evaluation', 'export', 'u-pokretu', perHour * 0.18 * r());
      push(day, h, 'evaluation', 'export', 'kultura', perHour * 0.14 * r());
      push(day, h, 'evaluation', 'session_end', 'expired', perHour * (0.9 + 0.1 * r()));
      push(day, h, 'evaluation', 'scan_fail', 'code-expired', perHour * 0.06 * r());
      push(day, h, 'hitno_view', 'page', '', perHour * 1.1 * (0.6 + 0.8 * r()));
      // A little venue use: a library and a café, most of it under the threshold.
      push(day, h, 'session_start', 'knjiznica', 'tresnjevka-sjever', perHour * 0.35 * r());
      push(day, h, 'session_start', 'kafic', 'donji-grad', perHour * 0.2 * r());
      push(day, h, 'panel_open', 'u-pokretu', 'kiosk', perHour * 0.4 * r());
      push(day, h, 'panel_open', 'grad-sada', 'kiosk', perHour * 0.3 * r());
      push(day, h, 'export', 'kultura', 'ics', perHour * 0.08 * r());
    }
    push(day, 7, 'evaluation', 'kiosk_online', 'zagreb', 6 + 8 * r() * growth);
    push(day, 7, 'evaluation', 'kiosk_online', 'donji-grad', 3 + 4 * r());
    push(day, 7, 'kiosk_online', 'tresnjevka-sjever', '', 1);
    push(day, 12, 'scan_fail', 'code-used', 'kiosk', 2 * r());
  });

  const n = days.length;
  const totals: MetricsTotalRow[] = [];
  const t = (event: string, dim1: string, dim2: string, count: number): void => {
    totals.push({ day: '', event, dim1, dim2, count: Math.round(count) });
  };
  const perDay = (x: number): number => x * n;
  t('source_fetch', 'zet-rt', 'ok', perDay(8590));
  t('source_fetch', 'zet-rt', 'stale', perDay(38));
  t('source_fetch', 'zet-rt', 'error', perDay(12));
  t('source_fetch', 'prometnice', 'ok', perDay(286));
  t('source_fetch', 'prometnice', 'error', perDay(2));
  t('source_fetch', 'dhmz-now', 'ok', perDay(94));
  t('source_fetch', 'dhmz-now', 'stale', perDay(2));
  t('source_fetch', 'dhmz-forecast', 'ok', perDay(47));
  t('source_fetch', 'dhmz-forecast', 'partial', perDay(1));
  t('source_fetch', 'dhmz-cap', 'ok', perDay(95));
  t('source_fetch', 'emsc', 'ok', perDay(270));
  t('source_fetch', 'emsc', 'error', perDay(18));
  t('source_fetch', 'glasnik', 'ok', perDay(22));
  t('source_fetch', 'glasnik', 'stale', perDay(2));
  t('source_fetch', 'ckan-geo', 'ok', perDay(24));
  t('source_fetch', 'dogadanja', 'ok', perDay(80));
  t('source_fetch', 'dogadanja', 'partial', perDay(14));
  t('twin_tick', 'ok', 'warm', perDay(6100));
  t('twin_tick', 'unchanged', 'warm', perDay(2480));
  t('twin_tick', 'error', 'warm', perDay(40));
  t('twin_tick', 'ok', 'cold', perDay(1.2));
  t('twin_tick', 'stale_index', 'warm', perDay(8));
  const hs: Record<string, number[]> = { '10s': [0.62, 0.22, 0.1, 0.04, 0.02], '30s': [0.44, 0.27, 0.16, 0.08, 0.05], '60s': [0.3, 0.26, 0.21, 0.13, 0.1] };
  const sign: Record<string, number[]> = { '10s': [0.04, 0.88, 0.08], '30s': [0.07, 0.71, 0.22], '60s': [0.11, 0.56, 0.33] };
  for (const h of ['10s', '30s', '60s']) {
    const graded = perDay(52000);
    ['lt25', 'lt50', 'lt100', 'lt200', 'ge200'].forEach((b, i) => t('twin_hindsight', h, b, graded * hs[h][i]));
    ['ahead_ge50', 'within50', 'behind_ge50'].forEach((b, i) => t('twin_hindsight_sign', h, b, graded * sign[h][i]));
  }
  t('twin_plan', 'floor', 'tram', perDay(3100));
  t('twin_plan', 'junction_wait', 'tram', perDay(5400));
  t('twin_plan', 'stand_fix', 'tram', perDay(410));
  t('twin_plan', 'eta_bound_skipped', 'tram', perDay(260));
  t('twin_order', 'established', 'tram', perDay(1900));
  t('twin_order', 'dropped', 'tram', perDay(1850));
  t('twin_order', 'hold', 'tram', perDay(720));
  t('twin_order', 'swap', 'tram', perDay(6));
  t('static_watch', 'current', '', perDay(23.5));
  t('static_watch', 'newer', '', Math.max(1, Math.round(n / 10)));
  t('static_watch', 'error', '', perDay(0.3));

  const tickDaily: MetricsTotalRow[] = days.flatMap((day) => [
    { day, event: 'twin_tick', dim1: 'ok', dim2: 'warm', count: 6100 + Math.round(200 * r()) },
    { day, event: 'twin_tick', dim1: 'unchanged', dim2: 'warm', count: 2480 },
    { day, event: 'twin_tick', dim1: 'error', dim2: 'warm', count: Math.round(10 + 80 * r() * r()) },
  ]);
  return { usage, totals, tickDaily };
}

export function statistikaFixture(shape: FixtureShape, days: StatistikaWindow = 30, today = '2026-09-24'): PublicStats {
  const list = daysBack(today, days);
  const now = new Date(`${today}T15:45:00Z`);
  if (shape === 'empty') {
    return buildPublicStats({ days, since: list[0], today, now, cells: foldPublic([]), systemTotals: [], tickDaily: [], live: null });
  }
  const r = rng(shape === 'busy' ? 20260924 : 7);
  const { usage, totals, tickDaily } = busyRows(list, r, shape === 'busy' ? 420 : 16);
  return buildPublicStats({ days, since: list[0], today, now, cells: foldPublic(usage), systemTotals: totals, tickDaily, live: shape === 'busy' ? LIVE : { ...LIVE, stops: LIVE.stops.slice(0, 3), junctions: [] } });
}
