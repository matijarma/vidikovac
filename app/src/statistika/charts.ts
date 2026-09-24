// The chart pieces of /statistika/. HTML and CSS, not SVG, so every number is
// real text that follows the reader's zoom and theme (the same choice as
// app/src/ui/graphics.ts). Each chart is one tab stop: arrows move through
// its columns, and a visible readout line under it says what the pointer,
// the finger or the keyboard is on. The exact numbers are always one
// disclosure away in a table (tableDetails).
import { escapeHtml } from '../ui/dom/escape';
import { num, pct, type Forms, count } from './format';

let uid = 0;
const nextId = (prefix: string): string => `${prefix}-${++uid}`;

// ---- the shared floating tip -------------------------------------------------

let tipEl: HTMLElement | null = null;

function tip(): HTMLElement | null {
  tipEl ??= document.querySelector<HTMLElement>('[data-st="tip"]');
  return tipEl;
}

/** Shows the tip above an anchor rectangle, kept inside the viewport. */
export function showTip(anchor: DOMRect, html: string): void {
  const el = tip();
  if (!el) return;
  el.innerHTML = html;
  el.hidden = false;
  const box = el.getBoundingClientRect();
  const margin = 8;
  let left = anchor.left + anchor.width / 2 - box.width / 2;
  left = Math.max(margin, Math.min(window.innerWidth - box.width - margin, left));
  let top = anchor.top - box.height - margin;
  if (top < margin) top = anchor.bottom + margin;
  el.style.left = `${Math.round(left + window.scrollX)}px`;
  el.style.top = `${Math.round(top + window.scrollY)}px`;
}

export function hideTip(): void {
  const el = tip();
  if (el) el.hidden = true;
}

// ---- columns: a value per day or per hour -------------------------------------

export interface ColumnOptions {
  values: readonly (number | null)[];
  /** What each column is, for the readout: "24. 9." or "17 h". */
  names: readonly string[];
  /** Axis labels at chosen columns. */
  ticks: readonly { index: number; label: string }[];
  /** How a value reads: "35 sesija", "99,8 %". */
  valueText: (value: number) => string;
  /** The top gridline's label; the largest value by default. */
  scaleText?: (max: number) => string;
  /** A fixed top of the scale (100 for a share); the largest value by default. */
  max?: number;
  /** The chart's name for assistive technology, e.g. "Sesije po danu". */
  label: string;
  /** What the readout says when nothing is pointed at. */
  summary: string;
  /** The word for a column with nothing published. */
  nullText?: string;
}

export function columns(o: ColumnOptions): HTMLElement {
  const n = o.values.length;
  const max = o.max ?? Math.max(0, ...o.values.map((v) => v ?? 0));
  const readoutId = nextId('st-readout');
  const nullText = o.nullText ?? 'ispod praga';
  const wrap = document.createElement('div');
  wrap.className = 'st-colchart';
  const cols = o.values
    .map((v, i) => {
      if (v === null) return `<span class="st-col st-col-null" data-i="${i}"></span>`;
      const h = max > 0 ? v / max : 0;
      return `<span class="st-col${v === 0 ? ' st-col-zero' : ''}" data-i="${i}" style="--h:${h.toFixed(4)}"></span>`;
    })
    .join('');
  const ticks = o.ticks
    .map((t) => `<span class="st-tick" style="--x:${((t.index + 0.5) / n).toFixed(4)}">${escapeHtml(t.label)}</span>`)
    .join('');
  wrap.innerHTML =
    `<div class="st-cols${n > 120 ? ' st-cols-dense' : ''}" tabindex="0" role="group" aria-roledescription="grafikon" aria-label="${escapeHtml(o.label)}" aria-describedby="${readoutId}">` +
    `<div class="st-cols-scale" aria-hidden="true"><span>${max > 0 ? escapeHtml((o.scaleText ?? num)(max)) : ''}</span></div>` +
    `<div class="st-cols-plot" style="--n:${n}" aria-hidden="true">${cols}</div>` +
    `<div class="st-cols-axis" aria-hidden="true">${ticks}</div>` +
    `</div>` +
    `<p class="st-readout" id="${readoutId}" aria-live="polite">${escapeHtml(o.summary)}</p>`;

  const chart = wrap.querySelector<HTMLElement>('.st-cols')!;
  const plot = wrap.querySelector<HTMLElement>('.st-cols-plot')!;
  const readout = wrap.querySelector<HTMLElement>('.st-readout')!;
  const colEls = [...plot.querySelectorAll<HTMLElement>('.st-col')];
  let active = -1;

  const text = (i: number): string => {
    const v = o.values[i];
    return `${o.names[i]}: ${v === null ? nullText : o.valueText(v)}`;
  };
  const set = (i: number, withTip: boolean): void => {
    if (active >= 0) colEls[active]?.classList.remove('is-active');
    active = Math.max(0, Math.min(n - 1, i));
    const el = colEls[active];
    el.classList.add('is-active');
    readout.textContent = text(active);
    if (withTip) {
      const r = el.getBoundingClientRect();
      const plotBox = plot.getBoundingClientRect();
      const top = o.values[active] === null ? plotBox.bottom - 8 : r.top;
      showTip(new DOMRect(r.left, top, r.width, 1), escapeHtml(text(active)));
    }
  };
  const clear = (): void => {
    if (active >= 0) colEls[active]?.classList.remove('is-active');
    active = -1;
    readout.textContent = o.summary;
    hideTip();
  };
  const indexAt = (clientX: number): number => {
    const box = plot.getBoundingClientRect();
    return Math.floor(((clientX - box.left) / box.width) * n);
  };
  plot.addEventListener('pointermove', (e) => set(indexAt(e.clientX), true));
  plot.addEventListener('pointerdown', (e) => set(indexAt(e.clientX), true));
  plot.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') clear();
  });
  chart.addEventListener('keydown', (e) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 };
    if (e.key in step) set((active < 0 ? n : active) + step[e.key], true);
    else if (e.key === 'Home') set(0, true);
    else if (e.key === 'End') set(n - 1, true);
    else if (e.key === 'Escape') clear();
    else return;
    e.preventDefault();
  });
  chart.addEventListener('blur', clear);
  return wrap;
}

// ---- bars: a breakdown over the window -------------------------------------------

export interface BarItem {
  key: string;
  label: string;
  count: number;
  /** The fold's remainder: drawn hatched and kept last. */
  folded?: boolean;
  /** A second, quieter line under the label. */
  note?: string;
}

export interface BarOptions {
  /** How the value reads for assistive technology: "25 sesija". */
  forms?: Forms;
  /** How the value reads on screen; the plain number by default. */
  valueText?: (value: number) => string;
  /** Show each bar's share of the total beside its value (breakdowns). */
  shares?: boolean;
  /** Number the rows (a ranking). */
  ordered?: boolean;
}

export function bars(items: readonly BarItem[], label: string, o: BarOptions = {}): HTMLElement {
  const max = Math.max(0, ...items.map((i) => i.count));
  const total = items.reduce((s, i) => s + i.count, 0);
  const list = document.createElement(o.ordered ? 'ol' : 'ul');
  list.className = `st-bars${o.ordered ? ' st-bars-ranked' : ''}`;
  list.setAttribute('aria-label', label);
  const shown = o.valueText ?? num;
  list.innerHTML = items
    .map(
      (i) =>
        `<li class="st-bar${i.folded ? ' st-bar-folded' : ''}" data-key="${escapeHtml(i.key)}">` +
        `<span class="st-bar-label">${escapeHtml(i.label)}${i.note ? `<span class="st-bar-note">${escapeHtml(i.note)}</span>` : ''}</span>` +
        `<span class="st-bar-track" aria-hidden="true"><span class="st-bar-fill" style="--w:${max > 0 ? (i.count / max).toFixed(4) : 0}"></span></span>` +
        `<span class="st-bar-value">${o.forms ? `<span class="visually-hidden">${escapeHtml(count(i.count, o.forms))}</span><span aria-hidden="true">${escapeHtml(shown(i.count))}</span>` : escapeHtml(shown(i.count))}` +
        `${o.shares ? ` <span class="st-bar-share">${pct(i.count, total, 0)}</span>` : ''}</span>` +
        `</li>`,
    )
    .join('');
  return list;
}

// ---- stacks: one row split into parts ---------------------------------------------

export interface StackPart {
  key: string;
  label: string;
  count: number;
  /** A class that colours the part (st-tone-ok, st-ramp-2, st-sign-ahead, ...). */
  tone: string;
}

export interface StackRow {
  label: string;
  parts: readonly StackPart[];
  /** The row's own sentence, right of the bar: "99,8 % u redu". */
  summary: string;
}

export function stacks(rows: readonly StackRow[], legend: readonly { tone: string; label: string }[], label: string, marker?: { at: number; label: string }): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'st-stacks';
  const legendHtml = `<ul class="st-legend" aria-hidden="true">${legend.map((l) => `<li><span class="st-swatch ${l.tone}"></span>${escapeHtml(l.label)}</li>`).join('')}</ul>`;
  const rowsHtml = rows
    .map((r) => {
      const total = r.parts.reduce((s, p) => s + p.count, 0);
      const parts = r.parts
        .filter((p) => p.count > 0)
        .map(
          (p) =>
            `<span class="st-part ${p.tone}" style="flex-grow:${p.count}" data-tip="${escapeHtml(`${p.label}: ${num(p.count)} (${pct(p.count, total)})`)}"></span>`,
        )
        .join('');
      const sr = r.parts.map((p) => `${p.label} ${pct(p.count, total)}`).join(', ');
      return (
        `<li class="st-stack">` +
        `<span class="st-stack-label">${escapeHtml(r.label)}</span>` +
        `<span class="st-stack-track">${parts || '<span class="st-part st-part-empty"></span>'}${marker ? `<span class="st-marker" style="--x:${marker.at}" title="${escapeHtml(marker.label)}"></span>` : ''}</span>` +
        `<span class="st-stack-summary">${escapeHtml(r.summary)}<span class="visually-hidden">. ${escapeHtml(sr)}</span></span>` +
        `</li>`
      );
    })
    .join('');
  wrap.innerHTML = `${legendHtml}<ul class="st-stack-rows" aria-label="${escapeHtml(label)}">${rowsHtml}</ul>${marker ? `<p class="st-marker-note"><span class="st-marker-key" aria-hidden="true"></span>${escapeHtml(marker.label)}</p>` : ''}`;
  wrap.addEventListener('pointerover', (e) => {
    const part = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (part) showTip(part.getBoundingClientRect(), escapeHtml(part.dataset.tip ?? ''));
  });
  wrap.addEventListener('pointerleave', hideTip);
  return wrap;
}

// ---- meter: one share against a whole ----------------------------------------------

export function meter(part: number, whole: number, label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'st-meter';
  const share = whole > 0 ? part / whole : 0;
  el.innerHTML =
    `<span class="st-meter-value">${pct(part, whole)}</span>` +
    `<span class="st-meter-track" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${(share * 100).toFixed(1)}" aria-label="${escapeHtml(label)}"><span class="st-meter-fill" style="--w:${share.toFixed(4)}"></span></span>`;
  return el;
}

// ---- the numbers behind a chart -------------------------------------------------------

export function tableDetails(caption: string, head: readonly string[], rows: readonly (readonly (string | number)[])[], summary = 'Brojevi u tablici'): HTMLElement {
  const el = document.createElement('details');
  el.className = 'st-table';
  const cell = (v: string | number, i: number): string =>
    i === 0 ? `<th scope="row">${escapeHtml(v)}</th>` : `<td>${escapeHtml(typeof v === 'number' ? num(v) : v)}</td>`;
  el.innerHTML =
    `<summary>${escapeHtml(summary)}</summary>` +
    `<div class="st-table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(caption)}"><table><caption class="visually-hidden">${escapeHtml(caption)}</caption>` +
    `<thead><tr>${head.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody></table></div>`;
  return el;
}

// ---- a card: title, the chart, how it was made ---------------------------------------

export interface CardOptions {
  id?: string;
  title: string;
  /** One line under the title: what the chart answers. */
  lede?: string;
  body: readonly (HTMLElement | string)[];
  /** How the numbers were made, small and muted under the chart. */
  method?: string;
  wide?: boolean;
}

export function card(o: CardOptions): HTMLElement {
  const el = document.createElement('article');
  el.className = `st-card${o.wide ? ' st-card-wide' : ''}`;
  if (o.id) el.id = o.id;
  const titleId = nextId('st-card');
  el.setAttribute('aria-labelledby', titleId);
  el.innerHTML = `<h3 id="${titleId}">${escapeHtml(o.title)}</h3>${o.lede ? `<p class="st-card-lede">${escapeHtml(o.lede)}</p>` : ''}`;
  for (const part of o.body) {
    if (typeof part === 'string') {
      const p = document.createElement('p');
      p.className = 'st-card-text';
      p.textContent = part;
      el.append(p);
    } else el.append(part);
  }
  if (o.method) {
    const m = document.createElement('p');
    m.className = 'st-method';
    m.textContent = o.method;
    el.append(m);
  }
  return el;
}

/** A quiet sentence in place of a chart that has nothing to draw. */
export function empty(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'state st-empty';
  p.textContent = text;
  return p;
}
