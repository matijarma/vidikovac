// The operator page over MetricsDO counters: raw numbers, Croatian, zero JS,
// one inline <style>, no external request (so Task D4 can pin
// `default-src 'none'`). Rounding and folding happen only in the City export
// (worker/stats/export.ts); this page is where the operator sees the truth.
import type { MetricsDailyRow } from '../metrics-do';
import type { TwinTables } from '../do/twin-do';
import { escapeHtml } from '../open/html';

export const MAX_DAYS = 365;
export const DEFAULT_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_OPTIONS: readonly number[] = [7, 30, 90, 365];

/** Rows of the two live twin tables /stats shows: enough to read the shape
 *  of the fleet's platforms without turning the page into a thousand-row
 *  listing of "20 s, nothing measured". The tables arrive already sorted by
 *  how much is known about each entry. */
export const TWIN_TABLE_ROWS = 120;

export interface StatsView {
  days: number;
  /** First Zagreb day of the window, YYYY-MM-DD. */
  since: string;
  /** Today's Zagreb day, YYYY-MM-DD. */
  today: string;
  rows: MetricsDailyRow[];
  /** The twin's live dwell and junction tables (F11), or null when the twin
   *  did not answer. Not counters: what the planner is using right now. */
  twin?: TwinTables | null;
}

type Pivot = Map<string, Map<string, number>>;

function fmt(n: number): string {
  return n.toLocaleString('hr-HR');
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return '&mdash;';
  return `${((part / whole) * 100).toLocaleString('hr-HR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

function label(value: string): string {
  return value === '' ? '<span class="dim">(bez dimenzije)</span>' : escapeHtml(value);
}

function sum(rows: readonly MetricsDailyRow[], pred: (r: MetricsDailyRow) => boolean): number {
  let total = 0;
  for (const r of rows) if (pred(r)) total += r.count;
  return total;
}

function pivot(rows: readonly MetricsDailyRow[], event: string, rowDim: 'dim1' | 'dim2', colDim: 'dim1' | 'dim2' | null): Pivot {
  const out: Pivot = new Map();
  for (const r of rows) {
    if (r.event !== event) continue;
    const rk = r[rowDim];
    const ck = colDim === null ? 'ukupno' : r[colDim];
    let inner = out.get(rk);
    if (inner === undefined) {
      inner = new Map();
      out.set(rk, inner);
    }
    inner.set(ck, (inner.get(ck) ?? 0) + r.count);
  }
  return out;
}

function rowTotal(m: Map<string, number>): number {
  let t = 0;
  for (const v of m.values()) t += v;
  return t;
}

/** One table: a heading row, one row per first dimension, one column per second dimension, totals. */
function matrixTable(heading: string, rowLabel: string, p: Pivot, empty: string): string {
  if (p.size === 0) return `<h3>${escapeHtml(heading)}</h3><p class="empty">${escapeHtml(empty)}</p>`;
  const cols = [...new Set([...p.values()].flatMap((m) => [...m.keys()]))].sort((a, b) => a.localeCompare(b, 'hr'));
  const rows = [...p.entries()].sort((a, b) => rowTotal(b[1]) - rowTotal(a[1]));
  const colTotals = cols.map((c) => rows.reduce((t, [, m]) => t + (m.get(c) ?? 0), 0));
  const grand = colTotals.reduce((a, b) => a + b, 0);
  const showTotals = cols.length > 1;
  return (
    `<h3>${escapeHtml(heading)}</h3>` +
    `<div class="scroll" tabindex="0" role="region" aria-label="${escapeHtml(heading)}"><table class="tbl"><thead><tr>` +
    `<th scope="col">${escapeHtml(rowLabel)}</th>` +
    cols.map((c) => `<th scope="col" class="num">${label(c)}</th>`).join('') +
    (showTotals ? `<th scope="col" class="num">Ukupno</th>` : '') +
    `</tr></thead><tbody>` +
    rows
      .map(
        ([rk, m]) =>
          `<tr><th scope="row">${label(rk)}</th>` +
          cols.map((c) => `<td class="num${(m.get(c) ?? 0) === 0 ? ' dim' : ''}">${fmt(m.get(c) ?? 0)}</td>`).join('') +
          (showTotals ? `<td class="num">${fmt(rowTotal(m))}</td>` : '') +
          `</tr>`,
      )
      .join('') +
    `</tbody>` +
    (rows.length > 1
      ? `<tfoot><tr><th scope="row">Ukupno</th>${colTotals.map((t) => `<td class="num">${fmt(t)}</td>`).join('')}` +
        (showTotals ? `<td class="num">${fmt(grand)}</td>` : '') +
        `</tr></tfoot>`
      : '') +
    `</table></div>`
  );
}

function secs(value: number | null): string {
  return value === null ? '&mdash;' : `${value.toLocaleString('hr-HR', { maximumFractionDigits: 0 })} s`;
}

/** Zagreb wall clock of an epoch second, HH:MM, for the "last sample" column. */
function clock(atSec: number | null): string {
  if (atSec === null) return '&mdash;';
  return new Intl.DateTimeFormat('hr-HR', { timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(atSec * 1000));
}

/** The per-stop dwell table as the planner reads it right now (F11). */
function dwellTable(twin: TwinTables | null | undefined): string {
  const heading = 'Zadržavanje po stajalištu';
  if (!twin || twin.dwell.length === 0) {
    return `<h3>${heading}</h3><p class="empty">blizanac još nije ništa izmjerio ni dobio ručnu vrijednost</p>`;
  }
  const rows = twin.dwell.slice(0, TWIN_TABLE_ROWS);
  const body = rows
    .map(
      (r) =>
        `<tr><th scope="row">${escapeHtml(r.name)}</th>` +
        `<td>${escapeHtml(r.stopId)}</td>` +
        `<td class="num">${secs(r.defaultSec)}</td>` +
        `<td class="num${r.override === null ? ' dim' : ''}">${r.override === null ? '&mdash;' : `${secs(r.override.defaultSec)}${r.override.pin ? ' (fiksno)' : ''}${r.override.route === null ? '' : ` · linija ${escapeHtml(r.override.route)}`}`}</td>` +
        `<td class="num${r.p50 === null ? ' dim' : ''}">${secs(r.p50)}</td>` +
        `<td class="num${r.p70 === null ? ' dim' : ''}">${secs(r.p70)}</td>` +
        `<td class="num${r.samples === 0 ? ' dim' : ''}">${fmt(r.samples)}</td>` +
        `<td class="num${r.recent === 0 ? ' dim' : ''}">${fmt(r.recent)}</td>` +
        `<td class="num">${clock(r.lastSampleSec)}</td>` +
        `<td class="num">${secs(r.plannedSec)}</td></tr>`,
    )
    .join('');
  const more = twin.dwell.length > rows.length ? `<p class="lede">Prikazano ${fmt(rows.length)} od ${fmt(twin.dwell.length)} perona o kojima se nešto zna.</p>` : '';
  return (
    `<h3>${heading}</h3>` +
    `<div class="scroll" tabindex="0" role="region" aria-label="${heading}"><table class="tbl"><thead><tr>` +
    `<th scope="col">Stajalište</th><th scope="col">Peron</th><th scope="col" class="num">Polazno</th><th scope="col" class="num">Ručno</th>` +
    `<th scope="col" class="num">p50</th><th scope="col" class="num">p70</th><th scope="col" class="num">Uzoraka</th>` +
    `<th scope="col" class="num">Nedavnih</th><th scope="col" class="num">Zadnji</th><th scope="col" class="num">Planira se</th>` +
    `</tr></thead><tbody>${body}</tbody></table></div>` +
    more
  );
}

/** Where the rails branch, how often a tram stops there and for how long (F11). */
function junctionTable(twin: TwinTables | null | undefined): string {
  const heading = 'Čekanje na križanjima';
  if (!twin || twin.junctions.length === 0) {
    return `<h3>${heading}</h3><p class="empty">još nema dovoljno prolaza ni na jednom čvoru</p>`;
  }
  const rows = twin.junctions.slice(0, TWIN_TABLE_ROWS);
  const body = rows
    .map(
      (r) =>
        `<tr><th scope="row">${fmt(r.node)}</th>` +
        `<td class="num">${fmt(r.passes)}</td>` +
        `<td class="num">${fmt(r.waits)}</td>` +
        `<td class="num">${pct(r.waits, r.passes)}</td>` +
        `<td class="num${r.p50 === null ? ' dim' : ''}">${secs(r.p50)}</td>` +
        `<td>${r.booked ? 'da' : 'ne'}</td></tr>`,
    )
    .join('');
  return (
    `<h3>${heading}</h3>` +
    `<div class="scroll" tabindex="0" role="region" aria-label="${heading}"><table class="tbl"><thead><tr>` +
    `<th scope="col">Čvor</th><th scope="col" class="num">Prolaza</th><th scope="col" class="num">Stajanja</th>` +
    `<th scope="col" class="num">p(stane)</th><th scope="col" class="num">Čekanje p50</th><th scope="col">Knjiži se</th>` +
    `</tr></thead><tbody>${body}</tbody></table></div>`
  );
}

/** Every Zagreb day in the window, oldest first, so a gap renders as a zero. */
/** The hindsight buckets in order with the bound a percentile can be stated
 *  against: an error in `lt50` is under 50 m, so "p95 ispod 50 m" is exactly
 *  what the bucket knows, never a guess inside it. */
const HINDSIGHT_BUCKETS: readonly { key: string; label: string }[] = [
  { key: 'lt25', label: 'ispod 25 m' },
  { key: 'lt50', label: 'ispod 50 m' },
  { key: 'lt100', label: 'ispod 100 m' },
  { key: 'lt200', label: 'ispod 200 m' },
  { key: 'ge200', label: '200 m ili više' },
];

/** The bucket that holds the given share of a horizon's graded fixes. */
function hindsightPercentile(rows: readonly MetricsDailyRow[], horizon: string, share: number): string | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    if (r.event !== 'twin_hindsight' || r.dim1 !== horizon) continue;
    counts.set(r.dim2, (counts.get(r.dim2) ?? 0) + r.count);
    total += r.count;
  }
  if (total === 0) return null;
  let cumulative = 0;
  for (const bucket of HINDSIGHT_BUCKETS) {
    cumulative += counts.get(bucket.key) ?? 0;
    if (cumulative / total >= share) return bucket.label;
  }
  return HINDSIGHT_BUCKETS[HINDSIGHT_BUCKETS.length - 1].label;
}

/** The share of a horizon's graded fixes whose plan ran ahead of the tram
 *  by 50 m or more (F7): the round's target at 30 s is 10 % or under. */
function aheadShareLine(rows: readonly MetricsDailyRow[]): string {
  const parts = ['10s', '30s', '60s']
    .map((horizon) => {
      const total = sum(rows, (r) => r.event === 'twin_hindsight_sign' && r.dim1 === horizon);
      if (total === 0) return null;
      const ahead = sum(rows, (r) => r.event === 'twin_hindsight_sign' && r.dim1 === horizon && r.dim2 === 'ahead_ge50');
      return `${escapeHtml(horizon.replace('s', ' s'))}: ${pct(ahead, total)} ispred`;
    })
    .filter((part): part is string => part !== null);
  return parts.length ? `<p>Plan 50 m ili više ispred vozila, po horizontu: ${parts.join('; ')}. Cilj kruga F na 30 s: 10 % ili manje.</p>` : '';
}

function hindsightLine(rows: readonly MetricsDailyRow[]): string {
  const parts = ['10s', '30s', '60s']
    .map((horizon) => {
      const p50 = hindsightPercentile(rows, horizon, 0.5);
      const p95 = hindsightPercentile(rows, horizon, 0.95);
      return p50 && p95 ? `${escapeHtml(horizon.replace('s', ' s'))}: p50 ${escapeHtml(p50)}, p95 ${escapeHtml(p95)}` : null;
    })
    .filter((part): part is string => part !== null);
  return parts.length ? `<p>Greška plana po horizontu: ${parts.join('; ')}.</p>` : '<p>Još nema ocijenjenih planova.</p>';
}

function dayRange(since: string, today: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${since}T00:00:00Z`); days.length <= MAX_DAYS; t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10);
    days.push(day);
    if (day >= today) break;
  }
  return days;
}

const DAY_COLUMNS: readonly { event: string; label: string }[] = [
  { event: 'session_start', label: 'Sesije' },
  { event: 'session_end', label: 'Završene' },
  { event: 'scan_fail', label: 'Neuspjeli skenovi' },
  { event: 'hitno_view', label: '/hitno' },
  { event: 'kiosk_online', label: 'Zasloni' },
  { event: 'panel_open', label: 'Paneli' },
  { event: 'export', label: 'Izvozi' },
  { event: 'over_cap', label: 'Preko kapaciteta' },
];

const HOUR_COLUMNS: readonly { event: string; label: string }[] = [
  { event: 'session_start', label: 'Sesije' },
  { event: 'hitno_view', label: '/hitno' },
  { event: 'scan_fail', label: 'Neuspjeli skenovi' },
];

function dayTable(view: StatsView): string {
  const byDay = new Map<string, Map<string, number>>();
  for (const r of view.rows) {
    let inner = byDay.get(r.day);
    if (inner === undefined) {
      inner = new Map();
      byDay.set(r.day, inner);
    }
    inner.set(r.event, (inner.get(r.event) ?? 0) + r.count);
  }
  const days = dayRange(view.since, view.today).reverse();
  return (
    `<h2>Po danu</h2><p class="lede">Svaki dan razdoblja je u tablici; nula je stvarna nula.</p>` +
    `<div class="scroll" tabindex="0" role="region" aria-label="Po danu"><table class="tbl"><thead><tr><th scope="col">Dan</th>` +
    DAY_COLUMNS.map((c) => `<th scope="col" class="num">${escapeHtml(c.label)}</th>`).join('') +
    `</tr></thead><tbody>` +
    days
      .map(
        (day) =>
          `<tr><th scope="row">${escapeHtml(day)}</th>` +
          DAY_COLUMNS.map((c) => `<td class="num">${fmt(byDay.get(day)?.get(c.event) ?? 0)}</td>`).join('') +
          `</tr>`,
      )
      .join('') +
    `</tbody></table></div>`
  );
}

function hourTable(rows: readonly MetricsDailyRow[]): string {
  const byHour: number[][] = Array.from({ length: 24 }, () => HOUR_COLUMNS.map(() => 0));
  for (const r of rows) {
    if (!Number.isInteger(r.hour) || r.hour < 0 || r.hour > 23) continue;
    HOUR_COLUMNS.forEach((c, i) => {
      if (r.event === c.event) byHour[r.hour][i] += r.count;
    });
  }
  return (
    `<h2>Po satu (Europe/Zagreb)</h2><p class="lede">Zbroj cijelog razdoblja po satu u danu; pokazuje kada su zasloni i /hitno zaista u uporabi.</p>` +
    `<div class="scroll" tabindex="0" role="region" aria-label="Po satu"><table class="tbl"><thead><tr><th scope="col">Sat</th>` +
    HOUR_COLUMNS.map((c) => `<th scope="col" class="num">${escapeHtml(c.label)}</th>`).join('') +
    `</tr></thead><tbody>` +
    byHour
      .map(
        (counts, hour) =>
          `<tr><th scope="row">${hour}</th>${counts.map((n) => `<td class="num">${fmt(n)}</td>`).join('')}</tr>`,
      )
      .join('') +
    `</tbody></table></div>`
  );
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f8f7;--fg:#182423;--muted:#526461;--accent:#08777b;--line:#d6e1de;--card:#fcfdfc}
@media (prefers-color-scheme:dark){:root{--bg:#17201f;--fg:#eff6f3;--muted:#acbdb6;--accent:#63d7c3;--line:#3b4b45;--card:#202d29}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:1rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.wrap{max-width:72rem;margin:0 auto;padding:1.25rem 1.25rem 4rem}
header{display:flex;flex-wrap:wrap;gap:.75rem 1.5rem;align-items:baseline;border-bottom:1px solid var(--line);padding-bottom:1rem}
h1{margin:0;font-size:1.25rem}h1 span{color:var(--muted);font-weight:400}
.window{color:var(--muted);margin:0 auto 0 0;font-variant-numeric:tabular-nums}
nav.range{display:flex;gap:.25rem}
nav.range a,nav.range span{padding:.15rem .5rem;border-radius:.4rem;text-decoration:none;font-variant-numeric:tabular-nums}
nav.range span{background:var(--card);border:1px solid var(--line)}
.exports{font-size:.95rem}
.vitals{display:grid;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));gap:1rem 1.5rem;margin:1.5rem 0 2rem;padding:1rem 0;border-block:1px solid var(--line)}
.vital-k{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.vital-v{font-size:1.75rem;font-variant-numeric:tabular-nums;font-weight:500}
.vital-s{color:var(--muted);font-size:.9rem}
section{margin-top:2rem}
h2{margin:0 0 .25rem;font-size:1.25rem}h3{margin:1.25rem 0 .35rem;font-size:1.05rem}
.lede{margin:0 0 .75rem;color:var(--muted);max-width:70ch}
.tbl{border-collapse:collapse;font-size:.95rem;min-width:100%}
.tbl th,.tbl td{padding:.35rem .75rem .35rem 0;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
.tbl thead th{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
.tbl tfoot th,.tbl tfoot td{border-bottom:0;font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.dim{color:var(--muted)}.empty{color:var(--muted);margin:.25rem 0}
.scroll{overflow-x:auto}
.blank{max-width:36rem;margin:3rem auto;padding:2rem;text-align:center;border:1px dashed var(--line);border-radius:12px;color:var(--muted)}
.blank b{display:block;color:var(--fg);font-size:1.25rem;margin-bottom:.5rem}
`;

function rangeSwitcher(days: number): string {
  return (
    `<nav class="range" aria-label="Razdoblje">` +
    RANGE_OPTIONS.map((n) =>
      n === days ? `<span aria-current="page">${n} d</span>` : `<a href="/stats?days=${n}">${n} d</a>`,
    ).join('') +
    `</nav>`
  );
}

function shell(view: StatsView, body: string): string {
  return `<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="robots" content="noindex">
<title>Kaj ima? · Statistika</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header>
<h1>Kaj ima? <span>/ Statistika</span></h1>
<p class="window">${view.days} dana do ${escapeHtml(view.today)} · od ${escapeHtml(view.since)} · Europe/Zagreb</p>
${rangeSwitcher(view.days)}
<p class="exports"><a href="/stats/export.csv?days=${view.days}">export.csv</a> · <a href="/stats/grad.csv?days=${view.days}">grad.csv (za Grad, zaokruženo)</a> · <a href="/stats/data.json?days=${view.days}">data.json</a></p>
</header>
<main>
${body}
</main>
</div>
</body>
</html>
`;
}

export function renderStatsPage(view: StatsView): string {
  const { rows } = view;
  if (rows.length === 0) {
    return shell(
      view,
      `<div class="blank"><b>Nema brojača u ovom razdoblju</b>` +
        `<p>Između ${escapeHtml(view.since)} i ${escapeHtml(view.today)} nije zabilježen nijedan događaj. ` +
        `Brojači počinju s prvom sesijom ili prvim pregledom /hitno; mirno razdoblje ovdje izgleda isto kao razdoblje prije objave. Odaberi šire razdoblje.</p></div>`,
    );
  }

  const sessions = sum(rows, (r) => r.event === 'session_start');
  const ended = sum(rows, (r) => r.event === 'session_end');
  const scanFails = sum(rows, (r) => r.event === 'scan_fail');
  const hitno = sum(rows, (r) => r.event === 'hitno_view');
  const kiosks = sum(rows, (r) => r.event === 'kiosk_online');
  const fetches = sum(rows, (r) => r.event === 'source_fetch');
  const fetchesOk = sum(rows, (r) => r.event === 'source_fetch' && r.dim2 === 'ok');
  const overCap = sum(rows, (r) => r.event === 'over_cap');
  const panelOpens = sum(rows, (r) => r.event === 'panel_open');
  const exportsN = sum(rows, (r) => r.event === 'export');
  const ticks = sum(rows, (r) => r.event === 'twin_tick');
  const ticksGood = sum(rows, (r) => r.event === 'twin_tick' && (r.dim1 === 'ok' || r.dim1 === 'unchanged'));
  const watches = sum(rows, (r) => r.event === 'static_watch');
  const watchesNewer = sum(rows, (r) => r.event === 'static_watch' && r.dim1 === 'newer');

  const vitals: { k: string; v: string; s: string }[] = [
    { k: 'Sesije', v: fmt(sessions), s: `${fmt(ended)} završenih` },
    { k: 'Neuspjeli skenovi', v: fmt(scanFails), s: `${pct(scanFails, scanFails + sessions)} pokušaja` },
    { k: 'Pregledi /hitno', v: fmt(hitno), s: 'otvoreni sloj, bez skeniranja' },
    { k: 'Zasloni online', v: fmt(kiosks), s: 'dnevnih prijava zaslona' },
    { k: 'Dohvati izvora u redu', v: pct(fetchesOk, fetches), s: `${fmt(fetches)} dohvata` },
    { k: 'Paneli i izvozi', v: fmt(panelOpens), s: `${fmt(exportsN)} izvoza` },
    { k: 'Blizanac u redu', v: pct(ticksGood, ticks), s: `${fmt(ticks)} otkucaja` },
  ];

  const body =
    `<div class="vitals">` +
    vitals
      .map(
        (v) =>
          `<div class="vital"><div class="vital-k">${escapeHtml(v.k)}</div><div class="vital-v">${v.v}</div><div class="vital-s">${v.s}</div></div>`,
      )
      .join('') +
    `</div>` +
    `<section><h2>Sesije</h2><p class="lede">Otključavanja i njihov kraj. Brojevi su sirovi; zaokruživanje i sažimanje primjenjuju se samo u grad.csv.</p>` +
    matrixTable('Sesije po vrsti prostora i četvrti', 'Vrsta prostora', pivot(rows, 'session_start', 'dim1', 'dim2'), 'još nema sesija') +
    matrixTable('Kraj sesije po razlogu i trajanju', 'Razlog', pivot(rows, 'session_end', 'dim1', 'dim2'), 'još nema završenih sesija') +
    matrixTable('Neuspjeli skenovi po razlogu', 'Razlog', pivot(rows, 'scan_fail', 'dim1', null), 'nema neuspjelih skenova') +
    `<h3>Preko kapaciteta</h3><p>${fmt(overCap)} sesija iznad ograničenja po zaslonu (30 na sat, 200 na dan); isključene iz skupa za Grad.</p>` +
    `</section>` +
    `<section><h2>Uporaba</h2><p class="lede">Što ljudi otvaraju i izvoze dok je sesija otključana; klijentski događaji stižu samo autenticiranom utičnicom sobe, najviše 60 po sesiji.</p>` +
    matrixTable('Otvoreni paneli po sloju i vrsti zaslona', 'Sloj', pivot(rows, 'panel_open', 'dim1', 'dim2'), 'još nema otvorenih panela') +
    matrixTable('Izvozi po sloju i vrsti', 'Sloj', pivot(rows, 'export', 'dim1', 'dim2'), 'još nema izvoza') +
    matrixTable('Pregledi otvorenog sloja', 'Stranica', pivot(rows, 'hitno_view', 'dim1', null), 'još nema pregleda /hitno') +
    `</section>` +
    `<section><h2>Izvori</h2><p class="lede">Dohvati po izvoru i ishodu. Stupac <em>error</em> je onaj koji treba gledati; <em>stale</em> znači da je poslužena zadnja dobra kopija.</p>` +
    matrixTable('Dohvati izvora po ishodu', 'Izvor', pivot(rows, 'source_fetch', 'dim1', 'dim2'), 'još nema dohvata') +
    matrixTable('Zasloni online po četvrti', 'Četvrt', pivot(rows, 'kiosk_online', 'dim1', null), 'nijedan zaslon se još nije prijavio') +
    `</section>` +
    `<section><h2>Blizanac</h2><p class="lede">Promatrač ZET-ova feeda u stvarnom vremenu, jedan otkucaj svakih 10 s: <em>ok</em> je novi okvir, <em>unchanged</em> isti okvir ili 304, <em>error</em> izvor koji nije odgovorio, <em>stale_index</em> okvir čije vožnje ugrađeni statični GTFS većinom ne poznaje; <em>cold</em> znači da se objekt probudio iz pohrane.</p>` +
    matrixTable('Otkucaji blizanca po ishodu i startu', 'Ishod', pivot(rows, 'twin_tick', 'dim1', 'dim2'), 'blizanac se još nije oglasio') +
    `<h3>Ocjena unatrag</h3><p class="lede">Svako novo očitanje ocjenjuje planove objavljene 10, 30 i 60 s prije njega: koliko je metara plan bio od mjesta gdje se vozilo zaista našlo.</p>` +
    matrixTable('Greška plana po horizontu i razredu', 'Horizont', pivot(rows, 'twin_hindsight', 'dim1', 'dim2'), 'još nema ocijenjenih planova') +
    hindsightLine(rows) +
    `<p class="lede">Ista očitanja po predznaku: <em>ahead_ge50</em> je plan 50 m ili više ispred vozila (oznaka koja se mora vraćati), <em>behind_ge50</em> plan toliko iza njega (čita se kao kašnjenje GPS-a), <em>within50</em> unutar toga.</p>` +
    matrixTable('Predznak greške plana po horizontu', 'Horizont', pivot(rows, 'twin_hindsight_sign', 'dim1', 'dim2'), 'još nema ocijenjenih planova s predznakom') +
    aheadShareLine(rows) +
    `<h3>Registar redoslijeda</h3><p class="lede">Tko je iza koga na istim tračnicama, zapisano iz očitanja i onda postojano. Svaki redak je <em>događaj</em> otkucaja, jer se tablica zbraja kroz sat: <em>established</em> koliko je odnosa upisano, <em>dropped</em> koliko ih je palo (razišli su se ili je odnos zastario), <em>hold</em> i <em>push</em> koliko je puta odnos stvarno pomaknuo plan, a <em>concession</em> i <em>swap</em> su jedina dva načina na koja se upisani redoslijed smije obrnuti. Koliko odnosa u nekom trenutku stoji nije događaj nego stanje i namjerno nije ovdje.</p>` +
    matrixTable('Registar redoslijeda po događaju', 'Događaj', pivot(rows, 'twin_order', 'dim1', 'dim2'), 'registar još nije ništa zapisao') +
    `<h3>Zahvati planera</h3><p class="lede">Što je planer morao ispraviti, po otkucaju: <em>floor</em> je sidro koje je unutar raspršenja GPS-a iza već objavljenog plana, pa plan kreće od objavljenog luka umjesto da se vrati unatrag; <em>junction_wait</em> je čekanje upisano na križanju na kojem tramvaji doista staju; <em>stand_fix</em> je tramvaj zadržan na peronu kojeg bi staro pravilo otpustilo; <em>eta_bound_skipped</em> je ZET-ova najava „već si otišao” za prvo sljedeće stajalište koju planer nije povjerovao.</p>` +
    matrixTable('Zahvati planera po vrsti', 'Zahvat', pivot(rows, 'twin_plan', 'dim1', 'dim2'), 'planer još nije morao zahvatiti') +
    `<h3>Tablica zadržavanja i križanja</h3><p class="lede">Ovo nisu brojači nego ono čime planer računa <em>sada</em>: za svaki peron o kojem se nešto zna polazna vrijednost (ručna, pa vozni red, pa 20 s), ručni unos iz <code>app/public/data/stop-dwell-overrides.json</code>, naučena razdioba po satu i vrsti dana (p50 i p70), koliko je uzoraka u zadnjih 90 minuta i kada je zadnji, te na kraju sekunde koje planer stvarno knjiži. Ručni unos uredi u toj datoteci i objavi — između nje i blizanca nema koraka gradnje.${view.twin && view.twin.unmatched.length > 0 ? ` <b>Unosa bez perona: ${fmt(view.twin.unmatched.length)}</b> (${escapeHtml(view.twin.unmatched.map((u) => u.stop).join(', '))}) — stajalište je preimenovano ili je u imenu tipfeler.` : ''}</p>` +
    dwellTable(view.twin) +
    junctionTable(view.twin) +
    `<h3>Statični GTFS</h3><p>${fmt(watchesNewer)} od ${fmt(watches)} provjera zatekle su noviji statični GTFS od ugrađenih artefakata. Kad se to dogodi, artefakti se grade iznova i objavljuju: <code>npm run build:network &amp;&amp; npm run build:trips</code>, zatim commit i push.</p>` +
    `</section>` +
    `<section><h2>Evaluacija prototipa</h2><p class="lede">Privremeni zasloni i njihove sesije. Ovi brojevi ostaju odvojeni od korištenja na lokacijama i ne ulaze u grad.csv.</p>` +
    matrixTable('Aktivnosti privremenih zaslona', 'Aktivnost', pivot(rows, 'evaluation', 'dim1', 'dim2'), 'još nema evaluacijskih aktivnosti') +
    `</section>` +
    `<section>${dayTable(view)}</section>` +
    `<section>${hourTable(rows)}</section>`;

  return shell(view, body);
}
