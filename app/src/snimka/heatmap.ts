// The heatmap "Sve linije, svaki sat" (Tijek's third chart, decision V3-23):
// rows are the 19 tram lines, then the bus lines that ran during the strike
// (a vehicle in at least six five-minute samples), then one aggregate row of
// every other bus line (all of them one disclosure away); columns are the
// window's 112 hours; a cell is the mean of the hour's twelve ratios
// min(1, seen/expected). The ramp (snimka-report.css, validated with the
// dataviz validator in both themes): 0 = a pale wash of the silent tone (so
// the strike's hole reads at a glance), 1 to 4 = brand blue light to dark at
// <= 25 / 50 / 75 / > 75 %; not scheduled = the plain page (no rect); missing =
// hatch (never a zero). One inline SVG of <rect>s built once, one tip per
// cell, the shared cursor, a table twin per route and day, and the row labels
// as buttons that set the route subject (on a phone the rows are plain text
// and a tapped cell writes its words into the strip's readout).
import { ROUTES_STEP_S, ZAGREB_OFFSET_S } from '../../../shared/snimka';
import { ROUTES_MISSING, decodeBase64 } from '../../../shared/snimka-codec';
import { hideTip, showTip, tableDetails } from '../statistika/charts';
import { escapeHtml } from '../ui/dom/escape';
import type { SnimkaContext } from './context';
import type { RoutesLike } from './contracts';
import { num, zagrebDay } from './format';
import { el } from './panels';
import { SN, fill } from './strings';

const SLOTS_PER_HOUR = 3600 / ROUTES_STEP_S;
/** The strike days for the row choice: a bus line with a vehicle in at least STRIKE_MIN_SAMPLES samples from Mon 28 Sep 03:30 to Wed 30 Sep 18:00 Zagreb (the relight began at 18:10) gets its own row. */
export const STRIKE_FROM_SEC = Date.UTC(2026, 8, 28, 3, 30) / 1000 - ZAGREB_OFFSET_S;
export const STRIKE_TO_SEC = Date.UTC(2026, 8, 30, 18, 0) / 1000 - ZAGREB_OFFSET_S;
/** Half an hour of service: fewer samples with a vehicle is a stray run (172's two samples on the real data), folded into the aggregate. */
export const STRIKE_MIN_SAMPLES = 6;
/** The viewBox size of one cell: an hour is 6 units wide, a row 24 units tall (the label buttons' height in px). */
export const CELL_W = 6;
export const ROW_H = 24;

/** One cell: a ratio in [0, 1], 'off' where nothing was scheduled, null where the recording has nothing. */
export type HeatCell = number | 'off' | null;

export interface HeatRow {
  id: string;
  label: string;
  kind: 'tram' | 'strike' | 'bus' | 'aggregate';
  cells: HeatCell[];
  /** The hour's mean counts over its known samples, for the tip ("3 od 4"); null where none is known. */
  seen: (number | null)[];
  expected: (number | null)[];
}

export interface HeatModel { t0: number; hours: number; trams: HeatRow[]; strike: HeatRow[]; aggregate: HeatRow | null; others: HeatRow[] }

const rowsCache = new WeakMap<RoutesLike, { seen: Uint8Array[]; expected: Uint8Array[] }>();
function rowsOf(routes: RoutesLike): { seen: Uint8Array[]; expected: Uint8Array[] } {
  let r = rowsCache.get(routes);
  if (!r) {
    r = { seen: routes.seen.map(decodeBase64), expected: routes.expected.map(decodeBase64) };
    rowsCache.set(routes, r);
  }
  return r;
}

/**
 * Per hour, the cell and the mean counts of a set of sample pairs. A sample counts toward the ratio when both
 * bytes are known and something was scheduled; an hour with none of those is 'off' when at least one sample
 * was known (expected 0), and null when every sample was missing. The same rule as route-series.ts hourMeans.
 */
export function hourCells(n: number, sample: (j: number) => { s: number; e: number } | null): Pick<HeatRow, 'cells' | 'seen' | 'expected'> {
  const hours = Math.ceil(n / SLOTS_PER_HOUR);
  const cells: HeatCell[] = [];
  const seen: (number | null)[] = [];
  const expected: (number | null)[] = [];
  for (let h = 0; h < hours; h++) {
    let ratio = 0;
    let ratios = 0;
    let known = 0;
    let sumS = 0;
    let sumE = 0;
    for (let j = h * SLOTS_PER_HOUR; j < Math.min(n, (h + 1) * SLOTS_PER_HOUR); j++) {
      const p = sample(j);
      if (!p) continue;
      known += 1;
      sumS += p.s;
      sumE += p.e;
      if (p.e > 0) { ratio += Math.min(1, p.s / p.e); ratios += 1; }
    }
    cells.push(ratios ? ratio / ratios : known ? 'off' : null);
    seen.push(known ? sumS / known : null);
    expected.push(known ? sumE / known : null);
  }
  return { cells, seen, expected };
}

/** The rows of the heatmap from the routes file (pure; the tests read it without a DOM). */
export function heatmapModel(routes: RoutesLike, strike: { from: number; to: number } = { from: STRIKE_FROM_SEC, to: STRIKE_TO_SEC }): HeatModel {
  const { seen, expected } = rowsOf(routes);
  const n = routes.n;
  const known = (i: number, j: number): { s: number; e: number } | null => {
    const s = seen[i]![j]!;
    const e = expected[i]![j]!;
    return s === ROUTES_MISSING || e === ROUTES_MISSING ? null : { s, e };
  };
  const j0 = Math.max(0, Math.floor((strike.from - routes.t0) / ROUTES_STEP_S));
  const j1 = Math.min(n, Math.ceil((strike.to - routes.t0) / ROUTES_STEP_S));
  const ranInStrike = (i: number): boolean => {
    let samples = 0;
    for (let j = j0; j < j1; j++) { const s = seen[i]![j]!; if (s !== ROUTES_MISSING && s > 0 && ++samples >= STRIKE_MIN_SAMPLES) return true; }
    return false;
  };
  const trams: HeatRow[] = [];
  const strikeRows: HeatRow[] = [];
  const others: HeatRow[] = [];
  const otherIdx: number[] = [];
  routes.routes.forEach((r, i) => {
    const kind: HeatRow['kind'] = r.type === 0 ? 'tram' : ranInStrike(i) ? 'strike' : 'bus';
    const row: HeatRow = { id: r.id, label: r.shortName, kind, ...hourCells(n, (j) => known(i, j)) };
    if (kind === 'tram') trams.push(row);
    else if (kind === 'strike') strikeRows.push(row);
    else { others.push(row); otherIdx.push(i); }
  });
  const byNumber = (a: HeatRow, b: HeatRow): number => (Number.parseInt(a.label, 10) || 0) - (Number.parseInt(b.label, 10) || 0) || a.label.localeCompare(b.label, 'hr');
  trams.sort(byNumber);
  strikeRows.sort(byNumber);
  others.sort(byNumber);
  // The aggregate: per sample, the summed vehicles over the summed timetable of every other bus line with both known.
  const aggregate: HeatRow | null = others.length ? {
    id: 'ostali', label: fill(SN.heatmap.otherBuses, { n: num(others.length) }), kind: 'aggregate',
    ...hourCells(n, (j) => {
      let s = 0;
      let e = 0;
      let any = false;
      for (const i of otherIdx) { const p = known(i, j); if (p) { any = true; s += p.s; e += p.e; } }
      return any ? { s, e } : null;
    }),
  } : null;
  return { t0: routes.t0, hours: Math.ceil(n / SLOTS_PER_HOUR), trams, strike: strikeRows, aggregate, others };
}

/** The ramp step of a ratio: 0 when nothing ran, then quarters (a sliver of service is step 1, never 0). */
export function rampStep(ratio: number): 0 | 1 | 2 | 3 | 4 {
  if (ratio <= 0) return 0;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

const hourLabel = (sec: number): string => `${new Date((sec + ZAGREB_OFFSET_S) * 1000).getUTCHours()} h`;

/** The tip of a cell: "linija 228, uto 29. 9. u 12 h: 3 od 4", or the word for an unscheduled or missing hour. */
export function cellText(model: Pick<HeatModel, 't0'>, row: HeatRow, h: number): string {
  const sec = model.t0 + h * 3600;
  const cell = row.cells[h] ?? null;
  const where = { short: row.label, day: zagrebDay(sec * 1000), time: hourLabel(sec) };
  const head = `${row.kind === 'aggregate' ? row.label : `linija ${row.label}`}, ${where.day} u ${where.time}`;
  if (cell === null) return `${head}: ${SN.heatmap.missing}`;
  if (cell === 'off') return `${head}: ${SN.heatmap.none}`;
  if (row.kind === 'aggregate') return `${head}: ${num(Math.round(row.seen[h] ?? 0))} od ${num(Math.round(row.expected[h] ?? 0))}`;
  return fill(SN.heatmap.cell, { ...where, seen: num(Math.round(row.seen[h] ?? 0)), expected: num(Math.round(row.expected[h] ?? 0)) });
}

/** The table twin: per route and Zagreb day, the day's mean share ("37 %"), the word where nothing ran on the timetable or nothing was recorded. */
export function dayTable(model: HeatModel, rows: readonly HeatRow[]): { head: string[]; body: string[][] } {
  const days: { label: string; from: number; to: number }[] = [];
  for (let h = 0; h < model.hours; h++) {
    const label = zagrebDay((model.t0 + h * 3600) * 1000);
    const last = days[days.length - 1];
    if (last && last.label === label) last.to = h + 1;
    else days.push({ label, from: h, to: h + 1 });
  }
  const body = rows.map((row) => [row.label, ...days.map((d) => {
    let sum = 0;
    let c = 0;
    let off = false;
    for (let h = d.from; h < d.to; h++) {
      const cell = row.cells[h];
      if (typeof cell === 'number') { sum += cell; c += 1; } else if (cell === 'off') off = true;
    }
    return c ? `${num(Math.round((sum / c) * 100))} %` : off ? SN.heatmap.none : SN.heatmap.missing;
  })]);
  return { head: [SN.heatmap.route, ...days.map((d) => d.label)], body };
}

// ---- the DOM ------------------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

function grid(doc: Document, model: HeatModel, rows: readonly HeatRow[], onRoute: ((id: string) => void) | null, label: string): { root: HTMLElement; plot: HTMLElement; cursor: HTMLElement } {
  const labels = el(doc, 'div', { class: 'sn-hm-labels', role: 'list' });
  for (const row of rows) {
    const item = el(doc, 'div', { class: 'sn-hm-label', role: 'listitem', 'data-kind': row.kind });
    // The name as text always; the button beside it where a row can set the subject (the sheet hides the button and
    // shows the text on a phone, where the 16 px rows are too small a target: the table twin carries the rows there).
    const name = el(doc, 'span', { class: 'sn-hm-name', text: row.label, title: row.label });
    if (onRoute && row.kind !== 'aggregate') {
      const b = el(doc, 'button', { type: 'button', class: 'sn-hm-row', 'data-route': row.id, text: row.label, 'aria-label': fill(SN.subject.line, { short: row.label }) });
      b.addEventListener('click', () => onRoute(row.id));
      name.classList.add('sn-hm-name-alt');
      item.append(name, b);
    } else item.append(name);
    labels.append(item);
  }
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'sn-hm-svg');
  svg.setAttribute('viewBox', `0 0 ${model.hours * CELL_W} ${rows.length * ROW_H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.setProperty('--rows', String(rows.length));
  // The hatch of a missing hour; its id is per SVG so two heatmaps on the page never share one.
  const hatchId = `sn-hm-hatch-${Math.random().toString(36).slice(2, 8)}`;
  let markup = `<defs><pattern id="${hatchId}" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)"><rect class="sn-hm-hatch-bg" width="4" height="4"/><line class="sn-hm-hatch-line" x1="0" y1="0" x2="0" y2="4"/></pattern></defs>`;
  rows.forEach((row, r) => {
    row.cells.forEach((cell, h) => {
      if (cell === 'off') return; // not scheduled: the plain page
      const cls = cell === null ? 'sn-hm-none' : `sn-hm-c${rampStep(cell)}`;
      const fillAttr = cell === null ? ` fill="url(#${hatchId})"` : '';
      markup += `<rect class="${cls}" x="${h * CELL_W}" y="${r * ROW_H}" width="${CELL_W}" height="${ROW_H}"${fillAttr}/>`;
    });
  });
  svg.innerHTML = markup;
  const days = el(doc, 'div', { class: 'sn-hm-days', 'aria-hidden': 'true' });
  for (let h = 1; h < model.hours; h++) {
    const sec = model.t0 + h * 3600;
    if (new Date((sec + ZAGREB_OFFSET_S) * 1000).getUTCHours() !== 0) continue;
    const line = el(doc, 'span', { class: 'sn-hm-dayline' });
    line.style.setProperty('--x', (h / model.hours).toFixed(5));
    days.append(line);
  }
  const cursor = el(doc, 'span', { class: 'sn-hm-cursor', 'aria-hidden': 'true' });
  const plot = el(doc, 'div', { class: 'sn-hm-plot', 'data-rows': String(rows.length) }, svg, days, cursor);
  plot.style.setProperty('--rows', String(rows.length));
  // The day axis rides in the same scrolling grid as the plot, so its labels stay over their columns.
  const root = el(doc, 'div', { class: 'sn-hm-scroll', tabindex: '0', role: 'group', 'aria-label': label },
    el(doc, 'div', { class: 'sn-hm-grid' }, el(doc, 'span', { class: 'sn-hm-corner', 'aria-hidden': 'true' }), axis(doc, model), labels, plot));
  return { root, plot, cursor };
}

/** The weekday over each Zagreb midnight, and over the first column when the first day has at least six hours. */
function axis(doc: Document, model: HeatModel): HTMLElement {
  const box = el(doc, 'div', { class: 'sn-hm-axis', 'aria-hidden': 'true' });
  const firstHour = new Date((model.t0 + ZAGREB_OFFSET_S) * 1000).getUTCHours();
  for (let h = 0; h < model.hours; h++) {
    const sec = model.t0 + h * 3600;
    if (h === 0 ? 24 - firstHour < 6 : new Date((sec + ZAGREB_OFFSET_S) * 1000).getUTCHours() !== 0) continue;
    const label = el(doc, 'span', { class: 'sn-hm-day', text: zagrebDay(sec * 1000).split(' ')[0]! });
    label.style.setProperty('--x', (h / model.hours).toFixed(5));
    box.append(label);
  }
  return box;
}

function legend(doc: Document): HTMLElement {
  const ul = el(doc, 'ul', { class: 'st-legend sn-hm-legend' });
  ul.append(el(doc, 'li', { class: 'sn-hm-legend-label', text: `${SN.heatmap.rampLabel}:` }));
  SN.heatmap.ramp.forEach((word, i) => ul.append(el(doc, 'li', {}, el(doc, 'span', { class: `sn-hm-key sn-hm-key-c${i}`, 'aria-hidden': 'true' }), word)));
  ul.append(el(doc, 'li', {}, el(doc, 'span', { class: 'sn-hm-key sn-hm-key-off', 'aria-hidden': 'true' }), SN.heatmap.none));
  ul.append(el(doc, 'li', {}, el(doc, 'span', { class: 'sn-hm-key sn-hm-key-none', 'aria-hidden': 'true' }), SN.heatmap.missing));
  return ul;
}

export interface HeatmapOptions {
  /** A row's button sets the route subject; without it the labels are plain text. */
  onRoute?: ((id: string) => void) | null;
  /** The routes to draw (the window's by default). */
  routes?: RoutesLike;
  /** Draws the lede and the legend above the plot (the strip has its own head). */
  head?: boolean;
  /** A click or tap on a cell hands its words here (Tijek writes them into its readout; on a phone there is no tip). */
  onCell?: ((text: string) => void) | null;
}

/** Mounts the heatmap into `root`: the cursor follows the frame loop, the tip follows the pointer. */
export function mountHeatmap(ctx: SnimkaContext, root: HTMLElement, opts: HeatmapOptions = {}): () => void {
  const doc = ctx.doc;
  const model = heatmapModel(opts.routes ?? ctx.routes);
  const onRoute = opts.onRoute === undefined ? (id: string) => ctx.view.set({ subject: { kind: 'route', id } }, 'user') : opts.onRoute;
  const mainRows = [...model.trams, ...model.strike, ...(model.aggregate ? [model.aggregate] : [])];
  const main = grid(doc, model, mainRows, onRoute, SN.heatmap.title);
  const parts: HTMLElement[] = [];
  if (opts.head !== false) parts.push(el(doc, 'p', { class: 'sn-hm-lede', text: SN.heatmap.lede }), legend(doc));
  parts.push(main.root);
  const grids = [{ ...main, rows: mainRows }];
  if (model.others.length) {
    const more = grid(doc, model, model.others, onRoute, SN.heatmap.allBuses);
    const details = el(doc, 'details', { class: 'sn-hm-more' }, el(doc, 'summary', { text: SN.heatmap.allBuses }), more.root);
    parts.push(details);
    grids.push({ ...more, rows: model.others });
  }
  const table = dayTable(model, [...mainRows, ...model.others]);
  const caption = fill(SN.strip.tableCaption, { title: SN.heatmap.title });
  parts.push(tableDetails(caption, table.head, table.body, caption));
  const box = el(doc, 'div', { class: 'sn-hm', 'data-sn-heatmap': String(mainRows.length) }, ...parts);
  root.replaceChildren(box);

  // The tip: one listener per plot, the cell from the pointer's place (no listener per rect).
  const cellAt = (g: (typeof grids)[number], e: PointerEvent): { row: HeatRow; h: number } | null => {
    const r = g.plot.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const h = Math.floor(((e.clientX - r.left) / r.width) * model.hours);
    const i = Math.floor(((e.clientY - r.top) / r.height) * g.rows.length);
    const row = g.rows[i];
    return row && h >= 0 && h < model.hours ? { row, h } : null;
  };
  const offs: (() => void)[] = [];
  for (const g of grids) {
    const move = (e: PointerEvent): void => {
      const hit = cellAt(g, e);
      if (!hit) { hideTip(); return; }
      showTip(new DOMRect(e.clientX, e.clientY - 4, 1, 1), escapeHtml(cellText(model, hit.row, hit.h)));
    };
    const click = (e: PointerEvent): void => {
      const hit = cellAt(g, e);
      if (!hit) return;
      opts.onCell?.(cellText(model, hit.row, hit.h));
      // A tap reads the cell; a mouse click also sets the line as the subject (as the row's button does).
      if (e.pointerType !== 'touch' && onRoute && hit.row.kind !== 'aggregate') onRoute(hit.row.id);
    };
    const leave = (): void => hideTip();
    g.plot.addEventListener('pointermove', move);
    g.plot.addEventListener('pointerleave', leave);
    g.plot.addEventListener('click', click as EventListener);
    offs.push(() => {
      g.plot.removeEventListener('pointermove', move);
      g.plot.removeEventListener('pointerleave', leave);
      g.plot.removeEventListener('click', click as EventListener);
    });
  }

  // The shared cursor: one transform per plot, only when the hour changes.
  let lastHour = -1;
  const setCursor = (t: number): void => {
    const h = Math.max(0, Math.min(model.hours, (t / 1000 - model.t0) / 3600));
    const step = Math.floor(h * 4);
    if (step === lastHour) return;
    lastHour = step;
    for (const g of grids) g.cursor.style.setProperty('--x', (h / model.hours).toFixed(5));
  };
  setCursor(ctx.clock.now());
  const offFrames = ctx.frames.subscribe(setCursor);
  return () => {
    offFrames();
    for (const off of offs) off();
    hideTip();
    box.remove();
  };
}
