import { describe, expect, it } from 'vitest';
import type { MetricsDailyRow } from '../../worker/metrics-do';
import { DEFAULT_DAYS, MAX_DAYS, renderStatsPage } from '../../worker/stats/page';

const row = (day: string, hour: number, event: string, dim1: string, dim2: string, count: number): MetricsDailyRow => ({
  day,
  hour,
  event,
  dim1,
  dim2,
  count,
});

const ROWS: MetricsDailyRow[] = [
  row('2026-09-10', 10, 'session_start', 'kiosk', 'donji-grad', 23),
  row('2026-09-10', 10, 'session_start', 'phone', '', 3),
  row('2026-09-10', 10, 'session_end', 'expired', '10m', 20),
  row('2026-09-10', 10, 'session_end', 'left', '<1m', 6),
  row('2026-09-10', 11, 'scan_fail', 'code-expired', '', 2),
  row('2026-09-10', 12, 'hitno_view', 'page', '', 12),
  row('2026-09-10', 12, 'kiosk_online', 'donji-grad', '', 1),
  row('2026-09-10', 12, 'source_fetch', 'zet-rt', 'ok', 118),
  row('2026-09-10', 12, 'source_fetch', 'zet-rt', 'stale', 2),
  row('2026-09-10', 13, 'panel_open', 'u-pokretu', 'kiosk', 9),
  row('2026-09-10', 13, 'export', 'sigurnost', 'ics', 4),
  row('2026-09-10', 13, 'over_cap', '', '', 1),
  row('2026-09-11', 9, 'session_start', 'kiosk', 'donji-grad', 5),
  row('2026-09-11', 9, 'twin_tick', 'ok', 'warm', 800),
  row('2026-09-11', 9, 'twin_tick', 'unchanged', 'warm', 60),
  row('2026-09-11', 9, 'twin_tick', 'error', 'cold', 3),
  row('2026-09-11', 10, 'static_watch', 'newer', '', 2),
  row('2026-09-11', 10, 'static_watch', 'current', '', 21),
  row('2026-09-11', 11, 'twin_hindsight', '30s', 'lt25', 80),
  row('2026-09-11', 11, 'twin_hindsight', '30s', 'lt50', 15),
  row('2026-09-11', 11, 'twin_hindsight', '30s', 'lt100', 4),
  row('2026-09-11', 11, 'twin_hindsight', '30s', 'ge200', 1),
  row('2026-09-11', 11, 'twin_hindsight_sign', '30s', 'ahead_ge50', 12),
  row('2026-09-11', 11, 'twin_hindsight_sign', '30s', 'within50', 80),
  row('2026-09-11', 11, 'twin_hindsight_sign', '30s', 'behind_ge50', 8),
];

const VIEW = { days: 7, since: '2026-09-05', today: '2026-09-11', rows: ROWS };

describe('renderStatsPage', () => {
  const html = renderStatsPage(VIEW);

  it('is Croatian, zero-JS, self-contained HTML', () => {
    expect(html).toContain('<html lang="hr">');
    expect(html).toContain('Statistika');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    expect(html).not.toMatch(/url\(\s*['"]?https?:/);
  });

  it('shows RAW counts, never rounded or folded, and no identifier column', () => {
    // 28 = kiosk/donji-grad session_start summed across both days (23 on 09-10, 5 on 09-11):
    // matrixTable pivots the whole window, not per day, so this is the raw total, not a rounding artefact.
    expect(html).toContain('>28<');
    expect(html).toContain('>3<');
    expect(html).toContain('>2<');
    expect(html).not.toContain('ostalo');
    for (const forbidden of ['IP', 'user-agent', 'roomId', 'beaconId', 'cookie']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('leads with the vitals: sessions, ended, failed scans, hitno views, screens, source health', () => {
    expect(html).toContain('<div class="vital-k">Sesije</div>');
    expect(html).toContain('<div class="vital-v">31</div>'); // 23 + 3 + 5 session_start
    expect(html).toContain('<div class="vital-k">Neuspjeli skenovi</div>');
    expect(html).toContain('<div class="vital-k">Pregledi /hitno</div>');
    expect(html).toContain('<div class="vital-k">Zasloni online</div>');
    expect(html).toContain('<div class="vital-k">Dohvati izvora u redu</div>');
    expect(html).toContain('98,3 %'); // 118 of 120
    expect(html.indexOf('class="vitals"')).toBeLessThan(html.indexOf('<h2>'));
  });

  it('breaks sessions down by screen type and district, and sources by status', () => {
    expect(html).toMatch(/Sesije po vrsti prostora i četvrti[\s\S]*?<th scope="row">kiosk<\/th>[\s\S]*?>28</);
    expect(html).toMatch(/Izvori[\s\S]*?<th scope="row">zet-rt<\/th>[\s\S]*?>118<[\s\S]*?>2</);
    expect(html).toContain('Preko kapaciteta');
  });

  it('renders every day of the window, newest first, as real zeros where nothing happened', () => {
    const dayTable = html.slice(html.indexOf('Po danu'));
    expect(dayTable.indexOf('2026-09-11')).toBeLessThan(dayTable.indexOf('2026-09-10'));
    expect(dayTable).toContain('2026-09-05');
    expect(dayTable).toMatch(/<th scope="row">2026-09-07<\/th><td class="num">0<\/td>/);
  });

  it('renders a 24-row hour table in Zagreb time', () => {
    expect(html).toContain('Po satu (Europe/Zagreb)');
    expect(html).toMatch(/<th scope="row">10<\/th><td class="num">26<\/td>/); // 23 + 3 sessions at 10h
    expect(html).toMatch(/<th scope="row">23<\/th><td class="num">0<\/td>/);
  });

  it('links the three exports for the same window', () => {
    expect(html).toContain('href="/stats/export.csv?days=7"');
    expect(html).toContain('href="/stats/grad.csv?days=7"');
    expect(html).toContain('href="/stats/data.json?days=7"');
  });

  it('says once, plainly, when the window is empty', () => {
    const empty = renderStatsPage({ ...VIEW, rows: [] });
    expect(empty).toContain('Nema brojača u ovom razdoblju');
    expect(empty).not.toContain('<table');
    expect(empty).toContain('/stats?days=90');
  });

  it('exports the window constants the route clamps against', () => {
    expect(DEFAULT_DAYS).toBe(30);
    expect(MAX_DAYS).toBe(365);
  });
});

// A7 (R-TE3, R-TE18): the twin's health on the operator page and the static-feed drift with its runbook.
describe('renderStatsPage: the twin', () => {
  it('leads with the share of good ticks, tabulates ticks by outcome and start, and names the static-feed drift', () => {
    const html = renderStatsPage(VIEW);
    expect(html).toContain('<div class="vital-k">Blizanac u redu</div>');
    expect(html).toContain('<div class="vital-v">99,7 %</div>'); // (800 + 60) / 863 ticks, hr-HR
    expect(html).toContain('863 otkucaja');
    expect(html).toContain('<h2>Blizanac</h2>');
    expect(html).toContain('>800<');
    expect(html).toContain('>unchanged<');
    expect(html).toContain('>cold<');
    expect(html).toContain('2 od 23 provjera');
    expect(html).toContain('npm run build:network &amp;&amp; npm run build:trips');
    // Hindsight: the histogram and the percentiles stated against the bucket bounds (80 % under 25 m, 95 % under 50 m).
    expect(html).toContain('<h3>Ocjena unatrag</h3>');
    expect(html).toContain('>lt25<');
    expect(html).toContain('30 s: p50 ispod 25 m, p95 ispod 50 m');
    // F7: the signed histogram beside it, and the share the round is judged on (12 of 100 graded fixes ahead at 30 s).
    expect(html).toContain('Predznak greške plana po horizontu');
    expect(html).toContain('>ahead_ge50<');
    expect(html).toContain('30 s: 12,0 % ispred');
  });
});

// F11: the twin's two live tables on /stats. These are not counters -- they
// are what the planner is using right now -- so the page takes them beside
// the metric rows and renders nothing where the twin did not answer.
describe('the twin tables on /stats', () => {
  const view = {
    days: DEFAULT_DAYS,
    since: '2026-09-10',
    today: '2026-09-12',
    rows: ROWS,
  };

  it('renders the dwell table, the junction table and the planner interventions', () => {
    const html = renderStatsPage({
      ...view,
      rows: [...ROWS, row('2026-09-11', 11, 'twin_plan', 'floor', 'tram', 42), row('2026-09-11', 11, 'twin_plan', 'stand_fix', 'tram', 7)],
      twin: {
        at: 1_800_000_000,
        overrides: 2,
        unmatched: [{ stop: 'Nepostojeće', route: null }],
        dwell: [
          {
            stopId: '275_1',
            name: 'Selska',
            defaultSec: 60,
            override: { defaultSec: 60, pin: true, route: null, reason: 'terminus' },
            p50: 41,
            pPlan: 58,
            samples: 24,
            recent: 9,
            lastSampleSec: 1_799_999_400,
            plannedSec: 60,
          },
          { stopId: '299_1', name: 'Trg', defaultSec: 20, override: null, p50: null, pPlan: null, samples: 0, recent: 0, lastSampleSec: null, plannedSec: 20 },
        ],
        junctions: [
          { node: 137, passes: 84, waits: 51, share: 51 / 84, p50: 23, booked: true },
          { node: 12, passes: 40, waits: 4, share: 0.1, p50: 18, booked: false },
        ],
      },
    });
    expect(html).toContain('Zadržavanje po stajalištu');
    expect(html).toContain('Selska');
    expect(html).toContain('275_1');
    expect(html).toContain('(fiksno)');
    expect(html).toContain('Čekanje na križanjima');
    expect(html).toContain('137');
    expect(html).toContain('Zahvati planera');
    expect(html).toContain('floor');
    expect(html).toContain('Nepostojeće'); // an override the network no longer knows is shown, never silently dropped
    expect(html).toContain('stop-dwell-overrides.json');
  });

  it('says so plainly when the twin answered nothing', () => {
    const html = renderStatsPage(view);
    expect(html).toContain('blizanac još nije ništa izmjerio');
    expect(html).toContain('još nema dovoljno prolaza ni na jednom čvoru');
    expect(html).toContain('planer još nije morao zahvatiti');
  });
});
