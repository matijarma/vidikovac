import { describe, expect, it } from 'vitest';
import type { DwellRow } from '../../shared/motion/dwell';
import { toPlane } from '../../shared/motion/geo';
import type { JunctionRow } from '../../shared/motion/junction';
import { FOLDED_KEY, PEOPLE_EVENTS, type PeopleEvent, type PublicStats } from '../../shared/statistika';
import { statistikaWindow } from '../../shared/statistika';
import type { MetricsDailyRow, MetricsTotalRow } from '../../worker/metrics-do';
import { cityRows } from '../../worker/stats/export';
import { LIVE_ROWS, buildPublicStats, dayList, foldPublic, shapeLive, unwrapEvaluation, type PublicStatsInput } from '../../worker/stats/public';

const row = (day: string, hour: number, event: string, dim1: string, dim2: string, count: number): MetricsDailyRow => ({ day, hour, event, dim1, dim2, count });
const total = (event: string, dim1: string, dim2: string, count: number, day = ''): MetricsTotalRow => ({ day, event, dim1, dim2, count });

const USAGE: MetricsDailyRow[] = [
  // Venue: one cell over the threshold, two under it on the same day.
  row('2026-09-20', 10, 'session_start', 'knjiznica', 'donji-grad', 23),
  row('2026-09-20', 10, 'session_start', 'kafic', 'tresnjevka-sjever', 4),
  row('2026-09-20', 15, 'session_start', 'phone', '', 7),
  row('2026-09-21', 9, 'panel_open', 'u-pokretu', 'kiosk', 12),
  row('2026-09-21', 9, 'panel_open', 'kultura', 'kiosk', 3),
  // Never public: overflow, and a scan no screen can be tied to.
  row('2026-09-20', 11, 'over_cap', 'knjiznica', 'donji-grad', 40),
  row('2026-09-20', 11, 'scan_fail', 'code-unknown', 'unattributed', 30),
  // The open safety page.
  row('2026-09-21', 8, 'hitno_view', 'page', '', 11),
  row('2026-09-21', 20, 'hitno_view', 'page', '', 4),
  // Temporary screens: unwrapped, folded apart.
  row('2026-09-20', 18, 'evaluation', 'session_start', 'zagreb', 14),
  row('2026-09-20', 18, 'evaluation', 'session_start', 'phone', 2),
  row('2026-09-20', 18, 'evaluation', 'panel_open', 'zrak-i-nebo', 16),
  row('2026-09-20', 19, 'evaluation', 'over_cap', 'zagreb', 50),
  row('2026-09-22', 7, 'evaluation', 'kiosk_online', 'maksimir', 3),
];

const SYSTEM: MetricsTotalRow[] = [
  total('source_fetch', 'zet-rt', 'ok', 8639),
  total('source_fetch', 'zet-rt', 'error', 1),
  total('source_fetch', 'dhmz-now', 'stale', 3),
  total('twin_tick', 'ok', 'warm', 900),
  total('twin_tick', 'unchanged', 'warm', 80),
  total('twin_tick', 'error', 'cold', 7),
  total('twin_hindsight', '30s', 'lt25', 120),
  total('twin_hindsight', '30s', 'ge200', 3),
  total('twin_hindsight_sign', '30s', 'ahead_ge50', 9),
  total('twin_plan', 'floor', 'tram', 44),
  total('twin_plan', 'floor', 'bus', 6),
  total('twin_order', 'swap', 'tram', 2),
  total('static_watch', 'current', '', 71),
];

const TICK_DAILY: MetricsTotalRow[] = [
  total('twin_tick', 'ok', 'warm', 500, '2026-09-21'),
  total('twin_tick', 'error', 'cold', 5, '2026-09-21'),
  total('twin_tick', 'overrides_unreadable', 'warm', 9, '2026-09-21'),
];

function input(over: Partial<PublicStatsInput> & { usageRows?: MetricsDailyRow[] } = {}): PublicStatsInput {
  const { usageRows = USAGE, ...rest } = over;
  return {
    days: 7,
    since: '2026-09-18',
    today: '2026-09-24',
    now: new Date('2026-09-24T12:00:00Z'),
    cells: foldPublic(usageRows),
    systemTotals: SYSTEM,
    tickDaily: TICK_DAILY,
    live: null,
    ...rest,
  };
}

function peopleEvents(stats: PublicStats): [string, PeopleEvent][] {
  return [
    ...PEOPLE_EVENTS.map((e) => [`venue.${e}`, stats.venue[e]] as [string, PeopleEvent]),
    ...PEOPLE_EVENTS.map((e) => [`evaluation.${e}`, stats.evaluation[e]] as [string, PeopleEvent]),
    ['hitno', stats.hitno],
  ];
}

describe('the public report: people', () => {
  const stats = buildPublicStats(input());

  it('shows only folded numbers: every figure a multiple of 5, every published day at least 10', () => {
    for (const [name, ev] of peopleEvents(stats)) {
      const figures = [ev.total, ev.wholeDay, ...ev.hours, ...ev.dim1.map((s) => s.count), ...ev.dim2.map((s) => s.count)];
      for (const n of figures) expect(n % 5, name).toBe(0);
      for (const d of ev.daily) if (d !== null) expect(d, name).toBeGreaterThanOrEqual(10);
    }
  });

  it('venue sums are exactly the City dataset, cell for cell', () => {
    const city = cityRows(USAGE);
    for (const e of PEOPLE_EVENTS) {
      const expected = city.filter((c) => c.event === e).reduce((s, c) => s + c.count, 0);
      expect(stats.venue[e].total, e).toBe(expected);
    }
    // 23 → 25 kept with its dims; 4 + 7 fold to the hour, still < 10 each hour → the day: 11 → 10.
    expect(stats.venue.session_start.total).toBe(35);
    expect(stats.venue.session_start.dim1).toEqual([
      { key: 'knjiznica', count: 25 },
      { key: FOLDED_KEY, count: 10 },
    ]);
    expect(stats.venue.session_start.dim2[0]).toEqual({ key: 'donji-grad', label: 'Donji grad', count: 25 });
    expect(stats.venue.session_start.wholeDay).toBe(10);
    expect(stats.venue.session_start.hours[10]).toBe(25);
  });

  it('never shows overflow or an unattributed scan', () => {
    const json = JSON.stringify(stats);
    expect(json).not.toContain('over_cap');
    expect(stats.venue.scan_fail.total).toBe(0);
    expect(stats.evaluation.session_start.dim2.some((s) => s.count >= 50)).toBe(false);
  });

  it('keeps temporary screens apart from venues, unwrapped to their own event', () => {
    expect(stats.evaluation.session_start.total).toBe(15); // 14 kept (→ 15); phone 2 dropped
    expect(stats.evaluation.session_start.dim1).toEqual([{ key: 'privremeni', count: 15 }]);
    expect(stats.evaluation.session_start.dim2).toEqual([{ key: 'zagreb', label: 'Zagreb', count: 15 }]);
    expect(stats.evaluation.panel_open.dim1).toEqual([{ key: 'zrak-i-nebo', count: 15 }]);
    expect(stats.evaluation.kiosk_online.total).toBe(0); // 3 cannot be protected
    // Venue totals are the same with or without the evaluation rows.
    const without = buildPublicStats(input({ usageRows: USAGE.filter((r) => r.event !== 'evaluation') }));
    expect(without.venue).toEqual(stats.venue);
  });

  it('aligns the daily series with the window, null where nothing was published', () => {
    expect(stats.days).toEqual(['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']);
    expect(stats.venue.session_start.daily).toEqual([null, null, 35, null, null, null, null]);
    // hitno 11 (hour 8) kept → 10; 4 (hour 20) cannot reach 10 even for the day.
    expect(stats.hitno.daily).toEqual([null, null, null, 10, null, null, null]);
  });

  it('tells a venue of type ostalo from the folded part', () => {
    const own = buildPublicStats(input({ usageRows: [row('2026-09-20', 10, 'session_start', 'ostalo', 'trnje', 12), row('2026-09-20', 11, 'session_start', 'kafic', 'trnje', 6), row('2026-09-20', 12, 'session_start', 'kafic', 'maksimir', 5)] }));
    expect(own.venue.session_start.dim1).toEqual([
      { key: 'ostalo', count: 10 },
      { key: FOLDED_KEY, count: 10 },
    ]);
  });

  it('puts the folded part last in every breakdown', () => {
    for (const [name, ev] of peopleEvents(stats)) {
      for (const list of [ev.dim1, ev.dim2]) {
        const i = list.findIndex((s) => s.key === FOLDED_KEY);
        if (i >= 0) expect(i, name).toBe(list.length - 1);
      }
    }
  });

  it('is a valid, empty report for a window with nothing in it', () => {
    const empty = buildPublicStats(input({ usageRows: [], systemTotals: [], tickDaily: [] }));
    expect(empty.days).toHaveLength(7);
    for (const [, ev] of peopleEvents(empty)) {
      expect(ev.total).toBe(0);
      expect(ev.daily.every((d) => d === null)).toBe(true);
      expect(ev.hours).toHaveLength(24);
    }
    expect(empty.system.sources).toEqual([]);
    expect(empty.rules).toEqual({ roundTo: 5, minCell: 10 });
  });
});

describe('the public report: system', () => {
  const stats = buildPublicStats(input());

  it('counts sources and ticks exactly', () => {
    expect(stats.system.sources).toEqual([
      { module: 'zet-rt', ok: 8639, partial: 0, stale: 0, error: 1 },
      { module: 'dhmz-now', ok: 0, partial: 0, stale: 3, error: 0 },
    ]);
    expect(stats.system.ticks).toEqual({ ok: 900, unchanged: 80, error: 7, stale_index: 0, overrides_unreadable: 0 });
    expect(stats.system.coldTicks).toBe(7);
    expect(stats.system.ticksAll).toEqual([0, 0, 0, 505, 0, 0, 0]);
    expect(stats.system.ticksGood).toEqual([0, 0, 0, 500, 0, 0, 0]);
  });

  it('reads the hindsight grades, the planner and the timetable', () => {
    const h30 = stats.system.hindsight.find((h) => h.horizon === '30s')!;
    expect(h30.buckets).toEqual({ lt25: 120, lt50: 0, lt100: 0, lt200: 0, ge200: 3 });
    expect(h30.sign).toEqual({ ahead_ge50: 9, within50: 0, behind_ge50: 0 });
    expect(stats.system.hindsight.map((h) => h.horizon)).toEqual(['10s', '30s', '60s']);
    expect(stats.system.plan.find((p) => p.key === 'floor')!.count).toBe(50);
    expect(stats.system.order.find((p) => p.key === 'swap')!.count).toBe(2);
    expect(stats.system.timetable).toEqual({ current: 71, newer: 0, unknown: 0, error: 0 });
  });
});

describe('evaluation rows, unwrapped', () => {
  it('maps every room and screen event back to its own shape and drops overflow', () => {
    const at = (dim1: string, dim2: string) => unwrapEvaluation(row('2026-09-20', 9, 'evaluation', dim1, dim2, 1));
    expect(at('session_start', 'maksimir')).toMatchObject({ event: 'session_start', dim1: 'privremeni', dim2: 'maksimir', hour: '9' });
    expect(at('session_start', 'phone')).toMatchObject({ event: 'session_start', dim1: 'phone', dim2: '' });
    expect(at('panel_open', 'kultura')).toMatchObject({ event: 'panel_open', dim1: 'kultura', dim2: '' });
    expect(at('scan_fail', 'code-expired')).toMatchObject({ event: 'scan_fail', dim1: 'code-expired', dim2: '' });
    expect(at('over_cap', 'maksimir')).toBeNull();
  });
});

describe('the model live tables, shaped for the public', () => {
  const dwell = (name: string, samples: number): DwellRow => ({
    stopId: name,
    name,
    defaultSec: 20,
    override: { defaultSec: 30, pin: true, route: null, reason: 'owner note: private' },
    p50: 18,
    pPlan: 30,
    samples,
    recent: 1,
    lastSampleSec: 1,
    plannedSec: 25,
  });
  const junction = (node: number, passes: number, waits: number, p50: number | null): JunctionRow => ({ node, passes, waits, share: waits / passes, p50, booked: true });
  const a = toPlane(15.977, 45.813);
  const b = toPlane(15.99, 45.8);
  const net = {
    edges: [{ from: 1, to: 2, pts: [a, b] }],
    stops: [
      { name: 'Trg bana Jelačića', p: toPlane(15.9771, 45.8131) },
      { name: 'Daleko', p: toPlane(16.1, 45.9) },
    ],
  };

  it('keeps the busiest stops, the costliest crossings, and no owner text', () => {
    const live = shapeLive(
      {
        at: 100,
        dwell: Array.from({ length: 20 }, (_, i) => dwell(`Stop ${i}`, i)),
        junctions: [junction(1, 100, 50, 20), junction(2, 100, 10, 10), junction(3, 100, 0, null)],
      },
      net,
    );
    expect(live.stops).toHaveLength(LIVE_ROWS);
    expect(live.stops[0]).toEqual({ name: 'Stop 19', p50: 18, pPlan: 30, plannedSec: 25, samples: 19 });
    expect(live.stopsKnown).toBe(19);
    expect(live.junctions.map((j) => j.near)).toEqual(['Trg bana Jelačića', null]);
    expect(live.junctions[0]).toMatchObject({ lon: 15.977, lat: 45.813, passes: 100, waits: 50, share: 0.5, p50: 20 });
    expect(live.junctionsKnown).toBe(3);
    expect(JSON.stringify(live)).not.toContain('owner note');
  });

  it('draws no crossing without a graph to place it on', () => {
    expect(shapeLive({ at: 1, dwell: [], junctions: [junction(1, 10, 5, 3)] }, null).junctions).toEqual([]);
  });
});

describe('windows and days', () => {
  it('normalises dani to an offered window', () => {
    expect(statistikaWindow('7')).toBe(7);
    expect(statistikaWindow('365')).toBe(365);
    expect(statistikaWindow('31')).toBe(30);
    expect(statistikaWindow(null)).toBe(30);
    expect(statistikaWindow('abc')).toBe(30);
  });

  it('lists every Zagreb day of the window', () => {
    expect(dayList('2026-09-24', '2026-09-24')).toEqual(['2026-09-24']);
    expect(dayList('2025-09-25', '2026-09-24')).toHaveLength(365);
  });
});
