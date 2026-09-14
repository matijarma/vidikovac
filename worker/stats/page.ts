// The operator page over MetricsDO counters: raw numbers, Croatian, zero JS,
// one inline <style>, no external request (so Task D4 can pin
// `default-src 'none'`). Rounding and folding happen only in the City export
// (worker/stats/export.ts); this page is where the operator sees the truth.
import type { MetricsDailyRow } from '../metrics-do';
import { escapeHtml } from '../open/html';

export const MAX_DAYS = 365;
export const DEFAULT_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_OPTIONS: readonly number[] = [7, 30, 90, 365];

export interface StatsView {
  days: number;
  /** First Zagreb day of the window, YYYY-MM-DD. */
  since: string;
  /** Today's Zagreb day, YYYY-MM-DD. */
  today: string;
  rows: MetricsDailyRow[];
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

/** Every Zagreb day in the window, oldest first, so a gap renders as a zero. */
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

  const vitals: { k: string; v: string; s: string }[] = [
    { k: 'Sesije', v: fmt(sessions), s: `${fmt(ended)} završenih` },
    { k: 'Neuspjeli skenovi', v: fmt(scanFails), s: `${pct(scanFails, scanFails + sessions)} pokušaja` },
    { k: 'Pregledi /hitno', v: fmt(hitno), s: 'otvoreni sloj, bez skeniranja' },
    { k: 'Zasloni online', v: fmt(kiosks), s: 'dnevnih prijava zaslona' },
    { k: 'Dohvati izvora u redu', v: pct(fetchesOk, fetches), s: `${fmt(fetches)} dohvata` },
    { k: 'Paneli i izvozi', v: fmt(panelOpens), s: `${fmt(exportsN)} izvoza` },
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
    `<section><h2>Evaluacija prototipa</h2><p class="lede">Privremeni zasloni i njihove sesije. Ovi brojevi ostaju odvojeni od korištenja na lokacijama i ne ulaze u grad.csv.</p>` +
    matrixTable('Aktivnosti privremenih zaslona', 'Aktivnost', pivot(rows, 'evaluation', 'dim1', 'dim2'), 'još nema evaluacijskih aktivnosti') +
    `</section>` +
    `<section>${dayTable(view)}</section>` +
    `<section>${hourTable(rows)}</section>`;

  return shell(view, body);
}
