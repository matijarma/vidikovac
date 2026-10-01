// Tijek: six small multiples on one shared 84-hour axis, one cursor that
// follows the replay clock, and a readout line of real text. Curves are
// inline SVG paths drawn once at mount (viewBox in minutes, strokes that do
// not scale); bands and marks are HTML spans placed by percent. Per frame the
// strip only moves its cursors (a transform each, no layout read); the
// readout changes on pause and seek only, so a playing replay never floods a
// screen reader. A pointer press on a plot pauses and seeks, dragging keeps
// seeking; hovering shows the values at the pointer without moving anything.
//
// Every panel says what it draws in words (a legend with a mark beside each
// word) and carries its numbers in a table, "Brojevi po satu".
import { ZAGREB_OFFSET_S, type Col, type SeriesFile, type SnimkaState } from '../../../shared/snimka';
import { columns, hideTip, showTip, tableDetails } from '../statistika/charts';
import { escapeHtml } from '../ui/dom/escape';
import type { SnimkaContext } from './context';
import { num, zagrebClock, zagrebDateTime, zagrebDay } from './format';
import { FROZEN_AFTER_S, frozenAt, ghostSeries, midnightOf } from './reckoning';
import { SN, fill } from './strings';

/** The viewBox height of every curve; x runs in minutes. */
export const PLOT_H = 100;
const MINUTE_MS = 60_000;
const STEP_SMALL_MS = 10 * MINUTE_MS;
const STEP_LARGE_MS = 60 * MINUTE_MS;

// ---- pure geometry ---------------------------------------------------------------

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Where an instant sits on the axis, 0 at the window's start, 1 at its end, clamped. */
export function cursorFraction(tMs: number, startMs: number, endMs: number): number {
  if (!(endMs > startMs) || !Number.isFinite(tMs)) return 0;
  return clamp01((tMs - startMs) / (endMs - startMs));
}

/** The instant under a fraction of the axis, on a whole minute, inside the window. */
export function seekTime(fraction: number, startMs: number, endMs: number): number {
  const t = startMs + clamp01(fraction) * (endMs - startMs);
  return Math.min(endMs, Math.max(startMs, Math.round(t / MINUTE_MS) * MINUTE_MS));
}

/** Tenths of a viewBox unit, so relative steps never drift; values outside [0, max] stay on the plot's edges. */
const tenths = (v: number, max: number): number => {
  const share = max > 0 ? Math.min(1, Math.max(0, v / max)) : 0;
  return Math.round((PLOT_H - share * PLOT_H) * 10);
};
const fmt = (t: number): string => String(t / 10);

/** Relative steps through points one minute apart (dx 1 forward, -1 backward), runs of equal values as `h`. */
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
 * A line through a minute column: x is the minute index (the viewBox starts at -0.5 so a minute's point sits at
 * its middle), y the value against `max`. A null is a gap: the line stops and starts again at the next value,
 * so missing is never drawn as zero. A lone value is a zero-length step, which the round cap draws as a dot.
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

/** Columns from the baseline, one minute wide, for the present values only (a null minute has no column). */
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

export type StateClass = SnimkaState | 'none';
export interface Run<T extends string> { cls: T; from: number; to: number }

/** Consecutive minutes of one class, as [from, to) minute indices. */
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

/** The class of a minute on the service band: its state where the machine judged it, "none" where it held. */
export function stateClass(s: SeriesFile, m: number): StateClass {
  const state = s.service.state[m];
  if (state === null || state === undefined || s.service.hold[m] !== null) return 'none';
  return state;
}

export function isFrozen(age: number | null | undefined): boolean {
  return age !== null && age !== undefined && age > FROZEN_AFTER_S;
}

/** The Zagreb midnights strictly inside the window, as fractions of the axis. */
export function dayLines(startMs: number, endMs: number): { at: number; x: number }[] {
  const out: { at: number; x: number }[] = [];
  for (let d = midnightOf(startMs / 1000) * 1000 + 86_400_000; d < endMs; d += 86_400_000) out.push({ at: d, x: cursorFraction(d, startMs, endMs) });
  return out;
}

// ---- values at an instant ----------------------------------------------------------

const lowerFirst = (s: string): string => s.charAt(0).toLocaleLowerCase('hr') + s.slice(1);
const value = (col: Col<number> | undefined | null, m: number): number | null => (col ? (col[m] ?? null) : null);
const STATE_WORD: Record<SnimkaState, string> = { normal: SN.badge.normal, reduced: SN.badge.reduced, silent: SN.badge.silent, unknown: SN.badge.unknown };

/** The minute of the window series at an instant, clamped to the window. */
export function minuteAt(s: SeriesFile, tMs: number): number {
  return Math.max(0, Math.min(s.n - 1, Math.floor((tMs / 1000 - s.t0) / 60)));
}

/** The comparison day's minute at the same Zagreb time of day, or null. */
export function comparisonMinute(c: SeriesFile, tMs: number): number | null {
  const tod = (((Math.floor(tMs / 1000) + ZAGREB_OFFSET_S) % 86_400) + 86_400) % 86_400;
  const m = Math.floor((midnightOf(c.t0) + tod - c.t0) / 60);
  return m >= 0 && m < c.n ? m : null;
}

export interface ReadoutInput { series: SeriesFile; comparison: SeriesFile | null; compare: boolean; serviceLiveFromSec: number }

/** The values of every panel at an instant, as words: "u pokretu 5, po voznom redu 230, ...". */
export function readoutValues(o: ReadoutInput, tMs: number): string[] {
  const s = o.series;
  const m = minuteAt(s, tMs);
  const nv = SN.strip.noValue;
  const n = (label: string, v: number | null): string => `${label} ${v === null ? nv : num(v)}`;
  const out = [n(SN.strip.fleetSeen, value(s.seen.all, m)), n(SN.strip.fleetExpected, value(s.expected.all, m))];
  if (o.compare && o.comparison) {
    const cm = comparisonMinute(o.comparison, tMs);
    out.push(n(SN.strip.fleetCompare, cm === null ? null : value(o.comparison.seen.all, cm)));
  }
  const cls = stateClass(s, m);
  const retro = s.t0 + m * 60 < o.serviceLiveFromSec ? ` (${SN.strip.stateRetro})` : '';
  out.push(`${lowerFirst(SN.strip.state)}: ${cls === 'none' ? SN.strip.stateNone : lowerFirst(STATE_WORD[cls])}${retro}`);
  if (s.bikes) {
    out.push(n(lowerFirst(SN.strip.bikes), value(s.bikes.total, m)));
    out.push(n(lowerFirst(SN.strip.bikesEmpty), value(s.bikes.empty, m)));
  }
  const entities = value(s.feed.entities, m);
  const age = value(s.feed.headerAgeS, m);
  if (entities === null && age === null) out.push(`${SN.strip.feed} ${nv}`);
  else {
    if (entities === 0) out.push(`${SN.strip.feed} ${SN.strip.feedEmpty}`);
    if (isFrozen(age)) out.push(`${SN.strip.feed} ${SN.strip.feedFrozen}`);
  }
  if (s.published) out.push(n(SN.strip.productScreen, value(s.published.vehicles, m)));
  const pulse = s.hourly.newsPulse;
  if (pulse) {
    const h = Math.floor((tMs / 1000 - s.hourly.t0) / 3600);
    out.push(n(lowerFirst(SN.strip.news), h >= 0 && h < pulse.length ? (pulse[h] ?? null) : null));
  }
  return out;
}

/** The readout line under the strip (strings strip.readout). */
export function readoutText(o: ReadoutInput, tMs: number): string {
  const minute = Math.floor(tMs / MINUTE_MS) * MINUTE_MS;
  return fill(SN.strip.readout, { day: zagrebDay(minute), time: zagrebClock(minute), values: readoutValues(o, minute).join(', ') });
}

// ---- the DOM -------------------------------------------------------------------------

type KeyKind = 'line' | 'area' | 'band' | 'hatch' | 'mark' | 'wash' | 'column';
interface LegendItem { kind: KeyKind; tone: string; label: string; layer?: 'compare' }

function legend(items: readonly LegendItem[]): HTMLElement {
  const ul = document.createElement('ul');
  ul.className = 'st-legend sn-legend';
  for (const it of items) {
    const li = document.createElement('li');
    if (it.layer) li.dataset.series = it.layer;
    const key = document.createElement('span');
    key.className = `sn-key sn-key-${it.kind} ${it.tone}`;
    key.setAttribute('aria-hidden', 'true');
    li.append(key, document.createTextNode(it.label));
    ul.append(li);
  }
  return ul;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(n: number, paths: readonly { d: string; cls: string; layer?: string }[]): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('class', 'sn-curves');
  el.setAttribute('viewBox', `-0.5 0 ${n} ${PLOT_H}`);
  el.setAttribute('preserveAspectRatio', 'none');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  for (const p of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', p.d);
    path.setAttribute('class', p.cls);
    if (p.layer) path.dataset.series = p.layer;
    el.append(path);
  }
  return el;
}

function bandSpans(runs: readonly Run<string>[], n: number, prefix: string): string {
  return runs
    .map((r) => `<span class="sn-seg ${prefix}-${r.cls}" style="--x:${(r.from / n).toFixed(5)};--w:${((r.to - r.from) / n).toFixed(5)}"></span>`)
    .join('');
}

interface Plot { el: HTMLElement; cursor: HTMLElement; hover: HTMLElement }

/** A plot box: the marks, the day lines, the scale label, the cursor and the hover line. */
function plot(kind: string, inner: (Node | string)[], days: readonly { x: number }[], scale: string | null, height: 'tall' | 'short' | 'band' | 'lane'): Plot {
  const el = document.createElement('div');
  el.className = `sn-plot sn-plot-${height}`;
  el.dataset.plot = kind;
  el.setAttribute('aria-hidden', 'true');
  const lines = days.map((d) => `<span class="sn-dayline" style="--x:${d.x.toFixed(5)}"></span>`).join('');
  el.innerHTML = `${scale ? `<span class="sn-scale">${escapeHtml(scale)}</span>` : ''}${lines}`;
  for (const part of inner) {
    if (typeof part === 'string') el.insertAdjacentHTML('beforeend', part);
    else el.append(part);
  }
  el.insertAdjacentHTML('beforeend', '<span class="sn-hover" hidden></span><span class="sn-cursor"></span>');
  return { el, cursor: el.querySelector<HTMLElement>('.sn-cursor')!, hover: el.querySelector<HTMLElement>('.sn-hover')! };
}

function panel(id: string, title: string, items: readonly LegendItem[] | null, plots: readonly HTMLElement[], table: HTMLElement, sub?: HTMLElement[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'sn-panel';
  section.dataset.panel = id;
  const head = document.createElement('div');
  head.className = 'sn-panel-head';
  const h = document.createElement('h3');
  h.className = 'sn-panel-title';
  h.id = `sn-panel-${id}`;
  h.textContent = title;
  section.setAttribute('aria-labelledby', h.id);
  head.append(h);
  if (items) head.append(legend(items));
  section.append(head, ...plots, ...(sub ?? []), table);
  return section;
}

const hourRows = <T,>(s: SeriesFile, row: (m: number, hourSec: number) => T[]): (string | T)[][] => {
  const rows: (string | T)[][] = [];
  for (let m = 0; m < s.n; m += 60) {
    const sec = s.t0 + m * 60;
    rows.push([zagrebDateTime(sec * 1000), ...row(m, sec)]);
  }
  return rows;
};
const cell = (v: number | null | undefined): string => (v === null || v === undefined ? SN.strip.noValue : num(v));
const colMax = (...cols: (readonly (number | null | undefined)[] | null | undefined)[]): number => {
  let max = 0;
  for (const c of cols) if (c) for (const v of c) if (v !== null && v !== undefined && v > max) max = v;
  return max;
};

export interface StripHandle {
  /** Moves the cursors to an instant (the frame loop's callback). */
  setCursor(tMs: number): void;
  /** Rewrites the readout for an instant (on pause and seek). */
  setReadout(tMs: number): void;
  /** Shows or hides the comparison day. */
  setCompare(on: boolean): void;
  destroy(): void;
}

/** Builds Tijek into its slot. The clock and the layers are wired by mountStrip. */
export function renderStrip(root: HTMLElement, o: { series: SeriesFile; comparison: SeriesFile | null; startMs: number; endMs: number; serviceLiveFromSec: number; compare: boolean; onSeek: (tMs: number) => void }): StripHandle {
  const s = o.series;
  const n = s.n;
  const days = dayLines(o.startMs, o.endMs);
  const plots: Plot[] = [];
  const keep = (p: Plot): HTMLElement => { plots.push(p); return p.el; };
  const S = SN.strip;
  let compare = o.compare;
  /** A missing count while ZET's data stood still says so; "bez podatka" is kept for a true gap. */
  const seenCell = (m: number): string => (s.seen.all[m] === null && frozenAt(s, m) ? SN.reckoning.feedFrozen : cell(s.seen.all[m]));

  // 1. Vehicles in motion: seen (the line that matters), the timetable as a grey silhouette, the normal day as a grey line.
  const compareCol: (number | null)[] = new Array(n).fill(null);
  if (o.comparison) {
    for (let m = 0; m < n; m++) {
      const cm = comparisonMinute(o.comparison, (s.t0 + m * 60) * 1000);
      compareCol[m] = cm === null ? null : (o.comparison.seen.all[cm] ?? null);
    }
  }
  const fleetMax = colMax(s.seen.all, s.expected.all, compareCol);
  const fleet = panel('fleet', S.fleet, [
    { kind: 'line', tone: 'sn-tone-seen', label: S.fleetSeen },
    { kind: 'area', tone: 'sn-tone-expected', label: S.fleetExpected },
    { kind: 'line', tone: 'sn-tone-compare', label: S.fleetCompare, layer: 'compare' },
  ], [keep(plot('fleet', [svg(n, [
    { d: areaPath(s.expected.all, fleetMax), cls: 'sn-area-expected' },
    { d: linePath(compareCol, fleetMax), cls: 'sn-line-compare', layer: 'compare' },
    { d: linePath(s.seen.all, fleetMax), cls: 'sn-line-seen' },
  ])], days, num(fleetMax), 'tall'))], tableDetails(`${S.fleet}, ${S.table}`, [S.hour, S.fleetSeen, S.fleetExpected, S.fleetCompare], hourRows(s, (m) => [seenCell(m), cell(s.expected.all[m]), cell(compareCol[m])]), S.table));

  // 2. The service state: one band, a hatch where the machine held its verdict, an overlay where it was computed afterwards.
  const liveFrom = Math.max(0, Math.min(n, Math.ceil((o.serviceLiveFromSec - s.t0) / 60)));
  const stateRuns = runsOf<StateClass>(n, (m) => stateClass(s, m));
  const retro = liveFrom > 0
    ? `<span class="sn-band-retro" style="--x:0;--w:${(liveFrom / n).toFixed(5)}"></span>`
    : '';
  const retroLabel = liveFrom > 0
    ? `<div class="sn-band-retro-label" aria-hidden="true" style="--w:${(liveFrom / n).toFixed(5)}"><span>${escapeHtml(S.stateRetro)}</span></div>`
    : '';
  const stateWord = (m: number): string => {
    const cls = stateClass(s, m);
    const word = cls === 'none' ? S.stateNone : STATE_WORD[cls];
    return s.t0 + m * 60 < o.serviceLiveFromSec ? `${word}, ${S.stateRetro}` : word;
  };
  const statePanel = panel('state', S.state, [
    { kind: 'band', tone: 'sn-state-normal', label: SN.badge.normal },
    { kind: 'band', tone: 'sn-state-reduced', label: SN.badge.reduced },
    { kind: 'band', tone: 'sn-state-silent', label: SN.badge.silent },
    { kind: 'band', tone: 'sn-state-unknown', label: SN.badge.unknown },
    { kind: 'hatch', tone: 'sn-state-none', label: S.stateNone },
    ...(liveFrom > 0 ? [{ kind: 'hatch' as const, tone: 'sn-key-retro', label: S.stateRetro }] : []),
  ], [keep(plot('state', [retroLabel, `<div class="sn-band">${bandSpans(stateRuns, n, 'sn-state')}${retro}</div>`], days, null, 'band'))],
  tableDetails(`${S.state}, ${S.table}`, [S.hour, S.state], hourRows(s, (m) => [stateWord(m)]), S.table));

  // 3. Bikes on the stations and empty stations: two plots, each on its own scale (never a second axis on one plot).
  let bikes: HTMLElement | null = null;
  if (s.bikes) {
    const b = s.bikes;
    const totalMax = colMax(b.total);
    const emptyMax = colMax(b.empty);
    const emptyLabel = document.createElement('p');
    emptyLabel.className = 'sn-subplot-title';
    emptyLabel.innerHTML = `<span class="sn-key sn-key-line sn-tone-bike-empty" aria-hidden="true"></span>${escapeHtml(S.bikesEmpty)}`;
    bikes = panel('bikes', S.bikes, null, [
      keep(plot('bikes', [svg(n, [{ d: areaPath(b.total, totalMax), cls: 'sn-area-bike' }, { d: linePath(b.total, totalMax), cls: 'sn-line-bike' }])], days, num(totalMax), 'short')),
      emptyLabel,
      keep(plot('bikes-empty', [svg(n, [{ d: areaPath(b.empty, emptyMax), cls: 'sn-area-bike' }, { d: linePath(b.empty, emptyMax), cls: 'sn-line-bike' }])], days, num(emptyMax), 'short')),
    ], tableDetails(`${S.bikes}, ${S.table}`, [S.hour, S.bikes, S.bikesEmpty], hourRows(s, (m) => [cell(b.total[m]), cell(b.empty[m])]), S.table));
  }

  // 4. ZET's data: two lanes of marks, the minutes it carried no vehicle and the minutes it did not change.
  const emptyRuns = runsOf<'on'>(n, (m) => (s.feed.entities[m] === 0 ? 'on' : null));
  const frozenRuns = runsOf<'on'>(n, (m) => (isFrozen(s.feed.headerAgeS[m]) ? 'on' : null));
  const minutesIn = (m0: number, test: (m: number) => boolean | null): string => {
    let seen = 0;
    let c = 0;
    for (let m = m0; m < Math.min(n, m0 + 60); m++) {
      const t = test(m);
      if (t === null) continue;
      seen++;
      if (t) c++;
    }
    return seen === 0 ? S.noValue : `${num(c)} min`;
  };
  const feedPanel = panel('feed', S.feed, [
    { kind: 'mark', tone: 'sn-tone-feed-empty', label: S.feedEmpty },
    { kind: 'mark', tone: 'sn-tone-feed-frozen', label: S.feedFrozen },
  ], [keep(plot('feed', [
    `<div class="sn-lane" data-lane="empty">${bandSpans(emptyRuns, n, 'sn-feed-empty')}</div>`,
    `<div class="sn-lane" data-lane="frozen">${bandSpans(frozenRuns, n, 'sn-feed-frozen')}</div>`,
  ], days, null, 'lane'))], tableDetails(`${S.feed}, ${S.table}`, [S.hour, S.feedEmpty, S.feedFrozen], hourRows(s, (m) => [
    minutesIn(m, (k) => (s.feed.entities[k] === null || s.feed.entities[k] === undefined ? null : s.feed.entities[k] === 0)),
    minutesIn(m, (k) => (s.feed.headerAgeS[k] === null || s.feed.headerAgeS[k] === undefined ? null : isFrozen(s.feed.headerAgeS[k]))),
  ]), S.table));

  // 5. The vehicles the screen counted that had no position: published minus seen, on its own small scale, only in
  // the minutes where the difference cannot be the lag between two samples or the hold of a shrinking fleet (reckoning.ts ghostSeries).
  let ghosts: HTMLElement | null = null;
  if (s.published) {
    const pub = s.published.vehicles;
    const excess = ghostSeries(s);
    const max = colMax(excess);
    const R = SN.reckoning;
    const hourGhosts = (m0: number): string[] => {
      let compared = 0;
      let minutes = 0;
      let most = 0;
      for (let m = m0; m < Math.min(n, m0 + 60); m++) {
        if (pub[m] === null || pub[m] === undefined || s.seen.all[m] === null || s.seen.all[m] === undefined) continue;
        compared++;
        const e = excess[m];
        if (e === null || e === undefined) continue;
        minutes++;
        most = Math.max(most, e);
      }
      return compared === 0 ? [S.noValue, S.noValue] : [num(most), `${num(minutes)} min`];
    };
    ghosts = panel('ghosts', S.ghosts, null, [keep(plot('ghosts', [svg(n, [{ d: columnsPath(excess, max), cls: 'sn-cols-ghost' }])], days, max > 0 ? num(max) : null, 'short'))],
      tableDetails(`${S.ghosts}, ${S.table}`, [S.hour, R.ghostsMax, R.ghostsMinutes], hourRows(s, (m) => hourGhosts(m)), S.table));
  }

  // 6. Press items per hour: the report's own columns, on the same axis.
  let news: HTMLElement | null = null;
  const pulse = s.hourly.newsPulse;
  if (pulse) {
    const names = pulse.map((_, h) => zagrebDateTime((s.hourly.t0 + h * 3600) * 1000));
    const chart = columns({
      values: pulse, names, ticks: [], valueText: (v) => num(v), label: S.news,
      summary: `${S.news}: ${num(pulse.reduce((a, b) => a + b, 0))}`, nullText: S.noValue,
    });
    chart.classList.add('sn-columns');
    const colsPlot = chart.querySelector<HTMLElement>('.st-cols-plot');
    if (colsPlot) {
      colsPlot.classList.add('sn-cols-plot');
      colsPlot.insertAdjacentHTML('beforeend', `${days.map((d) => `<span class="sn-dayline" style="--x:${d.x.toFixed(5)}"></span>`).join('')}<span class="sn-hover" hidden></span><span class="sn-cursor"></span>`);
      plots.push({ el: colsPlot, cursor: colsPlot.querySelector<HTMLElement>(':scope > .sn-cursor')!, hover: colsPlot.querySelector<HTMLElement>(':scope > .sn-hover')! });
    }
    news = panel('news', S.news, null, [chart], tableDetails(`${S.news}, ${S.table}`, [S.hour, S.news], names.map((name, h) => [name, cell(pulse[h])]), S.table));
  }

  // The shared axis: the day under each midnight line.
  const axis = document.createElement('div');
  axis.className = 'sn-axis';
  axis.setAttribute('aria-hidden', 'true');
  const weekday = (ms: number): string => zagrebDay(ms).split(' ')[0]!;
  axis.innerHTML = `<span class="sn-axis-day sn-axis-start" style="--x:0">${escapeHtml(weekday(o.startMs))}</span>` +
    days.map((d) => `<span class="sn-axis-day" style="--x:${d.x.toFixed(5)}" data-short="${escapeHtml(weekday(d.at))}">${escapeHtml(zagrebDay(d.at))}</span>`).join('');

  const readout = document.createElement('p');
  readout.className = 'st-readout sn-strip-readout';
  readout.id = 'sn-strip-readout';
  readout.setAttribute('aria-live', 'polite');

  const frame = document.createElement('div');
  frame.className = 'sn-strip-frame';
  frame.tabIndex = 0;
  frame.setAttribute('role', 'group');
  frame.setAttribute('aria-label', S.plotsLabel);
  frame.setAttribute('aria-describedby', readout.id);
  frame.append(axis, fleet, statePanel, ...(bikes ? [bikes] : []), feedPanel, ...(ghosts ? [ghosts] : []), ...(news ? [news] : []));
  root.replaceChildren(frame, readout);
  root.removeAttribute('aria-busy');

  const readoutInput = (): ReadoutInput => ({ series: s, comparison: o.comparison, compare, serviceLiveFromSec: o.serviceLiveFromSec });
  const applyCompare = (): void => {
    frame.dataset.compare = compare ? 'on' : 'off';
    for (const el of frame.querySelectorAll<Element>('[data-series="compare"]')) {
      if (compare) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
    }
  };
  applyCompare();

  // ---- the cursor and the pointer ----
  let lastX = -1;
  const setCursor = (tMs: number): void => {
    const x = cursorFraction(tMs, o.startMs, o.endMs);
    if (Math.abs(x - lastX) < 1e-6) return;
    lastX = x;
    const shift = `translateX(${(x * 100).toFixed(4)}%)`;
    for (const p of plots) p.cursor.style.transform = shift;
  };
  const fractionAt = (target: HTMLElement, clientX: number): number => {
    const box = target.getBoundingClientRect();
    return box.width > 0 ? (clientX - box.left) / box.width : 0;
  };
  const plotOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>('.sn-plot, .sn-cols-plot') : null;
  let dragging: { plot: HTMLElement; id: number } | null = null;
  const seekTo = (plotEl: HTMLElement, clientX: number): void => o.onSeek(seekTime(fractionAt(plotEl, clientX), o.startMs, o.endMs));
  const hideHover = (): void => {
    for (const p of plots) p.hover.hidden = true;
    hideTip();
  };
  const showHover = (plotEl: HTMLElement, e: PointerEvent): void => {
    const f = clamp01(fractionAt(plotEl, e.clientX));
    const shift = `translateX(${(f * 100).toFixed(4)}%)`;
    for (const p of plots) {
      p.hover.hidden = false;
      p.hover.style.transform = shift;
    }
    if (plotEl.classList.contains('sn-cols-plot')) return; // the columns draw their own tip
    const t = seekTime(f, o.startMs, o.endMs);
    const box = plotEl.getBoundingClientRect();
    const lines = [`${zagrebDay(t)} u ${zagrebClock(t)}`, ...readoutValues(readoutInput(), t)];
    showTip(new DOMRect(e.clientX, box.top, 1, 1), lines.map((l, i) => (i === 0 ? `<strong>${escapeHtml(l)}</strong>` : escapeHtml(l))).join('<br>'));
  };
  const onDown = (e: PointerEvent): void => {
    const p = plotOf(e.target);
    if (!p || (e.pointerType === 'mouse' && e.button !== 0)) return;
    dragging = { plot: p, id: e.pointerId };
    try { p.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer has nothing to capture */ }
    seekTo(p, e.clientX);
  };
  const onMove = (e: PointerEvent): void => {
    if (dragging && e.pointerId === dragging.id) { seekTo(dragging.plot, e.clientX); return; }
    const p = plotOf(e.target);
    if (p && e.pointerType === 'mouse') showHover(p, e);
  };
  const onUp = (e: PointerEvent): void => {
    if (!dragging || e.pointerId !== dragging.id) return;
    try { dragging.plot.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    dragging = null;
  };
  const onLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && !dragging) hideHover();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.target !== frame) return;
    const current = lastT ?? o.startMs;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = current - (e.shiftKey ? STEP_LARGE_MS : STEP_SMALL_MS);
    else if (e.key === 'ArrowRight') next = current + (e.shiftKey ? STEP_LARGE_MS : STEP_SMALL_MS);
    else if (e.key === 'Home') next = o.startMs;
    else if (e.key === 'End') next = o.endMs;
    if (next === null) return;
    e.preventDefault();
    o.onSeek(Math.min(o.endMs, Math.max(o.startMs, next)));
  };
  let lastT: number | null = null;
  frame.addEventListener('pointerdown', onDown);
  frame.addEventListener('pointermove', onMove);
  frame.addEventListener('pointerup', onUp);
  frame.addEventListener('pointercancel', onUp);
  frame.addEventListener('pointerleave', onLeave);
  frame.addEventListener('keydown', onKey);

  return {
    setCursor(tMs) {
      lastT = tMs;
      setCursor(tMs);
    },
    setReadout(tMs) {
      lastT = tMs;
      readout.textContent = readoutText(readoutInput(), tMs);
    },
    setCompare(on) {
      if (on === compare) return;
      compare = on;
      applyCompare();
    },
    destroy() {
      frame.removeEventListener('pointerdown', onDown);
      frame.removeEventListener('pointermove', onMove);
      frame.removeEventListener('pointerup', onUp);
      frame.removeEventListener('pointercancel', onUp);
      frame.removeEventListener('pointerleave', onLeave);
      frame.removeEventListener('keydown', onKey);
      hideTip();
    },
  };
}

/** Tijek on the page: the strip wired to the clock (cursor every frame, readout on pause and seek) and the layers. */
export function mountStrip(ctx: SnimkaContext, root: HTMLElement): () => void {
  const handle = renderStrip(root, {
    series: ctx.series,
    comparison: ctx.comparison,
    startMs: ctx.clock.start,
    endMs: ctx.clock.end,
    serviceLiveFromSec: ctx.manifest.serviceLiveFromSec,
    compare: ctx.layers.get().compare,
    onSeek: (t) => {
      ctx.clock.pause();
      ctx.clock.seek(t);
    },
  });
  const now = ctx.clock.now();
  handle.setCursor(now);
  handle.setReadout(now);
  const offFrames = ctx.frames.subscribe((t) => handle.setCursor(t));
  const offTick = ctx.clock.onTick((t, reason) => {
    if (reason === 'pause' || reason === 'seek' || reason === 'end') {
      handle.setCursor(t);
      handle.setReadout(t);
    }
  });
  const offLayers = ctx.layers.onChange((next) => {
    handle.setCompare(next.compare);
    if (!ctx.clock.playing()) handle.setReadout(ctx.clock.now());
  });
  return () => {
    offFrames();
    offTick();
    offLayers();
    handle.destroy();
  };
}
