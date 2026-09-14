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
