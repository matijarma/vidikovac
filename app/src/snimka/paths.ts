// The SVG path builders of /snimka/'s charts (Tijek, the cards of Što snimka
// pokazuje, line 228 in the block "Čime se moglo umjesto tramvaja"), pure and
// shared: a viewBox in sample units on x and PLOT_H on y, strokes that do not
// scale. Moved out of strip.ts in the v3 pass so reckoning.ts and
// alternatives.ts draw without importing the strip (strip.ts re-exports them).
// Missing is never zero: a null breaks a line and opens a silhouette.
import { escapeHtml } from '../ui/dom/escape';

/** The viewBox height of every curve; x runs in samples (minutes on the strip). */
export const PLOT_H = 100;

/** Tenths of a viewBox unit, so relative steps never drift; values outside [0, max] stay on the plot's edges. */
const tenths = (v: number, max: number): number => {
  const share = max > 0 ? Math.min(1, Math.max(0, v / max)) : 0;
  return Math.round((PLOT_H - share * PLOT_H) * 10);
};
const fmt = (t: number): string => String(t / 10);

/** Relative steps through points one sample apart (dx 1 forward, -1 backward), runs of equal values as `h`. */
function stepsOf(ys: readonly number[], dx: 1 | -1): string {
  let d = '';
  let flat = 0;
  for (let k = 1; k < ys.length; k++) {
    const dy = ys[k]! - ys[k - 1]!;
    if (dy === 0) { flat++; continue; }
    if (flat > 0) d += `h${flat * dx}`;
    flat = 0;
    d += `l${dx} ${fmt(dy)}`;
  }
  if (flat > 0) d += `h${flat * dx}`;
  return d;
}

const present = (v: number | null | undefined): v is number => v !== null && v !== undefined;

/** The runs of present values, as [start, end) indices. */
function presentRuns(values: readonly (number | null | undefined)[]): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  while (i < values.length) {
    if (!present(values[i])) { i++; continue; }
    const start = i;
    while (i < values.length && present(values[i])) i++;
    out.push([start, i]);
  }
  return out;
}

/**
 * A line through a column: x is the sample index (the viewBox starts at -0.5 so a sample's point sits at its
 * middle), y the value against `max`. A null is a gap: the line stops and starts again at the next value, so
 * missing is never drawn as zero. A lone value is a zero-length step, which the round cap draws as a dot.
 */
export function linePath(values: readonly (number | null | undefined)[], max: number): string {
  return presentRuns(values)
    .map(([start, end]) => {
      const ys = values.slice(start, end).map((v) => tenths(v!, max));
      return `M${start} ${fmt(ys[0]!)}${end - start === 1 ? 'h0' : stepsOf(ys, 1)}`;
    })
    .join('');
}

/** The number of separate stretches a path draws (one per run of values between nulls). */
export function subpaths(d: string): number {
  return (d.match(/M/g) ?? []).length;
}

/** A filled silhouette from the baseline up to a column, gaps left open. */
export function areaPath(values: readonly (number | null | undefined)[], max: number): string {
  return presentRuns(values)
    .map(([start, end]) => {
      const ys = values.slice(start, end).map((v) => tenths(v!, max));
      return `M${start - 0.5} ${PLOT_H}V${fmt(ys[0]!)}h0.5${stepsOf(ys, 1)}h0.5V${PLOT_H}Z`;
    })
    .join('');
}

/** Columns from the baseline, one sample wide, for the present values only (a null sample has no column). */
export function columnsPath(values: readonly (number | null | undefined)[], max: number): string {
  return presentRuns(values)
    .map(([start, end]) => {
      let d = `M${start - 0.5} ${PLOT_H}`;
      let prev = -1;
      let flat = 0;
      for (let k = start; k < end; k++) {
        const y = tenths(values[k]!, max);
        if (y === prev) { flat++; continue; }
        if (flat > 0) d += `h${flat}`;
        flat = 0;
        d += `V${fmt(y)}h1`;
        prev = y;
      }
      if (flat > 0) d += `h${flat}`;
      return `${d}V${PLOT_H}Z`;
    })
    .join('');
}

export interface Run<T extends string> { cls: T; from: number; to: number }

/** Consecutive samples of one class, as [from, to) indices. */
export function runsOf<T extends string>(n: number, classOf: (m: number) => T | null): Run<T>[] {
  const out: Run<T>[] = [];
  let cur: Run<T> | null = null;
  for (let m = 0; m < n; m++) {
    const cls = classOf(m);
    if (cur && cls === cur.cls) { cur.to = m + 1; continue; }
    if (cur) out.push(cur);
    cur = cls === null ? null : { cls, from: m, to: m + 1 };
  }
  if (cur) out.push(cur);
  return out;
}

/** The largest present value of the columns (0 when none). */
export function colMax(...cols: (readonly (number | null | undefined)[] | null | undefined)[]): number {
  let max = 0;
  for (const c of cols) if (c) for (const v of c) if (v !== null && v !== undefined && v > max) max = v;
  return max;
}

// ---- a small plot for a card ------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface MiniSeries { values: readonly (number | null)[]; kind: 'line' | 'area'; tone: string; label: string }

/**
 * A card's plot on one scale: the series as lines or silhouettes, a legend in words with a mark beside each, the
 * scale's top as a label, and ticks under the plot (fractions of the width). Decorative for assistive technology:
 * every card plot ships its numbers in words or a table beside it.
 */
export function miniPlot(doc: Document, o: { series: readonly MiniSeries[]; max: number; scale: string; ticks: readonly { x: number; label: string }[]; label: string }): HTMLElement {
  const n = Math.max(1, ...o.series.map((s) => s.values.length));
  const wrap = doc.createElement('figure');
  wrap.className = 'sn-card-plot';
  const legend = doc.createElement('ul');
  legend.className = 'st-legend sn-legend';
  legend.innerHTML = o.series.map((s) => `<li><span class="sn-key sn-key-${s.kind === 'line' ? 'line' : 'area'} ${escapeHtml(s.tone)}" aria-hidden="true"></span>${escapeHtml(s.label)}</li>`).join('');
  const box = doc.createElement('div');
  box.className = 'sn-card-plot-box';
  box.setAttribute('aria-hidden', 'true');
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'sn-curves');
  svg.setAttribute('viewBox', `-0.5 0 ${n} ${PLOT_H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('focusable', 'false');
  for (const s of o.series) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', s.kind === 'line' ? linePath(s.values, o.max) : areaPath(s.values, o.max));
    path.setAttribute('class', s.kind === 'line' ? `sn-card-line ${s.tone}` : `sn-card-area ${s.tone}`);
    svg.append(path);
  }
  box.append(svg);
  box.insertAdjacentHTML('beforeend', `<span class="sn-scale">${escapeHtml(o.scale)}</span>`);
  const ticks = doc.createElement('div');
  ticks.className = 'sn-card-ticks';
  ticks.setAttribute('aria-hidden', 'true');
  ticks.innerHTML = o.ticks.map((t) => `<span style="--x:${t.x.toFixed(4)}">${escapeHtml(t.label)}</span>`).join('');
  const cap = doc.createElement('figcaption');
  cap.className = 'visually-hidden';
  cap.textContent = o.label;
  wrap.append(cap, legend, box, ticks);
  return wrap;
}
