// Tijek (v3, decision V3-23): three charts on one shared axis (the window of
// the contract), one cursor that follows the replay clock, and a readout line
// of real text. "Vozila u pokretu" draws the seen line over the weekday-
// matched normal day as a grey silhouette, with the service state as a tint
// behind (a dashed top edge where it was computed afterwards) and a 6 px rug
// under it for the minutes ZET sent no vehicle or its data did not change;
// "Prazne stanice BAJS-a" draws the empty stations against Thursday
// 1 October at the same time of day (the bikes' only normal day); the third
// is the heatmap "Sve linije, svaki sat" (heatmap.ts). Curves are inline SVG
// paths drawn once at mount (viewBox in minutes, strokes that do not scale);
// tints and the rug are HTML spans placed by percent. Per frame the strip
// only moves its cursors (a transform each, no layout read); the readout
// changes on pause and seek only. A pointer press on a plot pauses and seeks,
// dragging keeps seeking; hovering shows the values at the pointer. Every
// chart carries its numbers in one table, "{title}: brojevi po satu".
import { ZAGREB_OFFSET_S, type Col, type SeriesFile, type SnimkaState } from '../../../shared/snimka';
import { hideTip, showTip, tableDetails } from '../statistika/charts';
import { escapeHtml } from '../ui/dom/escape';
import { comparisonFor, comparisonMinute as contextComparisonMinute, type SnimkaContext } from './context';
import { mountHeatmap } from './heatmap';
import { num, zagrebClock, zagrebDateTime, zagrebDay } from './format';
import { PLOT_H, areaPath, colMax, linePath, runsOf } from './paths';
import { BIKES_REF_DAY_SEC, FROZEN_AFTER_S, bikeDrain, bikesOnThursday, frozenAt, midnightOf } from './reckoning';
import { SN, fill } from './strings';

export { PLOT_H, areaPath, columnsPath, linePath, runsOf, subpaths, type Run } from './paths';

const MINUTE_MS = 60_000;
const STEP_SMALL_MS = 10 * MINUTE_MS;
const STEP_LARGE_MS = 60 * MINUTE_MS;
const zg = (month: number, day: number, hour: number, minute = 0): number => Date.UTC(2026, month - 1, day, hour, minute) / 1000 - ZAGREB_OFFSET_S;
/** The bikes chart is drawn to Wednesday 30 September 24:00; after it Thursday is the reference itself. */
export const BIKES_TO_SEC = zg(10, 1, 0, 0);

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

export type StateClass = SnimkaState | 'none';

/** The class of a minute on the service band: its state where the machine judged it, "none" where it held. */
export function stateClass(s: SeriesFile, m: number): StateClass {
  const state = s.service.state[m];
  if (state === null || state === undefined || s.service.hold[m] !== null) return 'none';
  return state;
}

/** The tint behind the fleet chart: the two states that are the story (silent, reduced); "bez procjene", unknown and
 *  normal draw nothing (no hatch, decision V3-23). */
export function tintClass(s: SeriesFile, m: number): 'silent' | 'reduced' | null {
  const c = stateClass(s, m);
  return c === 'silent' || c === 'reduced' ? c : null;
}

/** The tint's runs as [from, to) minute indices, each marked when it lies before the state was published live
 *  (`retro`: the dashed top edge "izračunano naknadno"); a run that crosses the moment is split there. */
export function tintRuns(s: SeriesFile, serviceLiveFromSec: number): { cls: 'silent' | 'reduced'; from: number; to: number; retro: boolean }[] {
  const liveFrom = Math.max(0, Math.min(s.n, Math.ceil((serviceLiveFromSec - s.t0) / 60)));
  return runsOf(s.n, (m) => {
    const c = tintClass(s, m);
    return c === null ? null : `${c}${m < liveFrom ? '-retro' : ''}`;
  }).map((r) => ({ cls: r.cls.replace('-retro', '') as 'silent' | 'reduced', from: r.from, to: r.to, retro: r.cls.endsWith('-retro') }));
}

/** The rug under the fleet chart: the minutes in which ZET's data carried no vehicle or did not change (S-19). */
export function rugRuns(s: SeriesFile): { from: number; to: number }[] {
  return runsOf<'on'>(s.n, (m) => (s.feed.entities[m] === 0 || frozenMinute(s, m) === true ? 'on' : null)).map(({ from, to }) => ({ from, to }));
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

/** The empty BAJS stations per window minute up to Wednesday 24:00, and the same time of day on Thursday 1 October
 *  as the reference (null outside that span and where the recording has nothing). */
export function bikesColumns(s: SeriesFile, toSec: number = BIKES_TO_SEC): { now: (number | null)[]; thu: (number | null)[] } {
  const now: (number | null)[] = new Array<number | null>(s.n).fill(null);
  const thu: (number | null)[] = new Array<number | null>(s.n).fill(null);
  if (!s.bikes) return { now, thu };
  for (let m = 0; m < s.n; m++) {
    const sec = s.t0 + m * 60;
    if (sec >= toSec) break;
    now[m] = s.bikes.empty[m] ?? null;
    thu[m] = bikesOnThursday(s, sec);
  }
  return { now, thu };
}

/** The most empty stations on each strike day (Mon, Tue, Wed) and on Thursday 1 October, for the bikes headline. */
export function bikesHeadline(s: SeriesFile): string | null {
  const r = bikeDrain(s);
  if (!r) return null;
  const at = (day: number): number | null => r.byDay.find((d) => d.day === day)?.maxEmpty ?? null;
  const days = [zg(9, 28, 0, 0), zg(9, 29, 0, 0), zg(9, 30, 0, 0), BIKES_REF_DAY_SEC].map(at);
  if (days.every((d) => d === null)) return null;
  const t = (v: number | null): string => (v === null ? SN.strip.noValue : num(v));
  return fill(SN.strip.bikesHeadline, { mon: t(days[0]!), tue: t(days[1]!), wed: t(days[2]!), thu: t(days[3]!) });
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

/** A comparison column aligned to the window by time of day, the weekday-matched day per minute (S-12); null where the day lacks the minute. */
export function comparisonColumn(ctx: Pick<SnimkaContext, 'comparisons'>, s: Pick<SeriesFile, 't0' | 'n'>, pick: (c: SeriesFile) => Col<number>): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(s.n).fill(null);
  if (!ctx.comparisons.length) return out;
  for (let m = 0; m < s.n; m++) {
    const atSec = s.t0 + m * 60;
    const cm = contextComparisonMinute(ctx, atSec);
    out[m] = cm === null ? null : (pick(comparisonFor(ctx, atSec).series)[cm] ?? null);
  }
  return out;
}

/** A minute the series marks frozen (feed.frozen, S-19); the header age where an old series has no column. */
export function frozenMinute(s: SeriesFile, m: number): boolean | null {
  const f = s.feed.frozen?.[m];
  if (f !== undefined && f !== null) return f === 1;
  const age = s.feed.headerAgeS[m];
  return age === null || age === undefined ? null : isFrozen(age);
}

export interface ReadoutInput {
  series: SeriesFile; comparison: SeriesFile | null; compare: boolean; serviceLiveFromSec: number;
  /** The normal day's fleet per window minute (comparisonColumn); when given it replaces the one comparison series. */
  compareCol?: readonly (number | null)[] | null;
}

/** The values of the three charts at an instant, as words: "u pokretu 5, po voznom redu 230, običan dan 321, ...". */
export function readoutValues(o: ReadoutInput, tMs: number): string[] {
  const s = o.series;
  const m = minuteAt(s, tMs);
  const nv = SN.strip.noValue;
  const S = SN.strip;
  const n = (label: string, v: number | null): string => `${label} ${v === null ? nv : num(v)}`;
  const out = [n(S.fleetSeen, value(s.seen.all, m)), n(S.fleetExpected, value(s.expected.all, m))];
  if (o.compare && o.compareCol) out.push(n(S.fleetNormal, o.compareCol[m] ?? null));
  else if (o.compare && o.comparison) {
    const cm = comparisonMinute(o.comparison, tMs);
    out.push(n(S.fleetNormal, cm === null ? null : value(o.comparison.seen.all, cm)));
  }
  const cls = stateClass(s, m);
  const retro = s.t0 + m * 60 < o.serviceLiveFromSec ? ` (${SN.timeline.retro})` : '';
  out.push(`${lowerFirst(SN.badge.label)}: ${cls === 'none' ? S.stateNone : lowerFirst(STATE_WORD[cls])}${retro}`);
  if (s.bikes) {
    const sec = s.t0 + m * 60;
    out.push(n(lowerFirst(S.bikesEmpty), value(s.bikes.empty, m)));
    if (sec < BIKES_TO_SEC) out.push(n(S.bikesRef, bikesOnThursday(s, sec)));
  }
  const entities = value(s.feed.entities, m);
  const age = value(s.feed.headerAgeS, m);
  if (entities === null && age === null) out.push(`${S.feed} ${nv}`);
  else {
    if (entities === 0) out.push(`${S.feed} ${S.feedEmpty}`);
    if (frozenMinute(s, m)) out.push(`${S.feed} ${S.feedFrozen}`);
  }
  return out;
}

/** The readout line under the strip (strings strip.readout). */
export function readoutText(o: ReadoutInput, tMs: number): string {
  const minute = Math.floor(tMs / MINUTE_MS) * MINUTE_MS;
  return fill(SN.strip.readout, { day: zagrebDay(minute), time: zagrebClock(minute), values: readoutValues(o, minute).join(', ') });
}

// ---- the DOM -------------------------------------------------------------------------

type KeyKind = 'line' | 'area' | 'band' | 'hatch' | 'retro' | 'rug';
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

const span = (cls: string, from: number, to: number, n: number): string =>
  `<span class="${cls}" style="--x:${(from / n).toFixed(5)};--w:${((to - from) / n).toFixed(5)}"></span>`;

interface Plot { el: HTMLElement; cursor: HTMLElement; hover: HTMLElement }

/** A plot box: the marks, the day lines, the scale label, the cursor and the hover line. */
function plot(kind: string, inner: (Node | string)[], days: readonly { x: number }[], scale: string | null): Plot {
  const el = document.createElement('div');
  el.className = 'sn-plot sn-strip-plot';
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

function panel(id: string, title: string, items: readonly LegendItem[] | null, body: readonly HTMLElement[], headline?: string | null): HTMLElement {
  const section = document.createElement('section');
  section.className = 'sn-panel sn-strip-chart';
  section.dataset.panel = id;
  const head = document.createElement('div');
  head.className = 'sn-panel-head';
  const h = document.createElement('h3');
  h.className = 'sn-panel-title';
  h.id = `sn-panel-${id}`;
  h.textContent = title;
  section.setAttribute('aria-labelledby', h.id);
  head.append(h);
  if (headline) {
    const p = document.createElement('p');
    p.className = 'sn-strip-headline';
    p.textContent = headline;
    head.append(p);
  }
  if (items) head.append(legend(items));
  section.append(head, ...body);
  return section;
}

const hourRows = <T,>(s: SeriesFile, row: (m: number, hourSec: number) => T[], toSec = Infinity): (string | T)[][] => {
  const rows: (string | T)[][] = [];
  for (let m = 0; m < s.n; m += 60) {
    const sec = s.t0 + m * 60;
    if (sec >= toSec) break;
    rows.push([zagrebDateTime(sec * 1000), ...row(m, sec)]);
  }
  return rows;
};
const cell = (v: number | null | undefined): string => (v === null || v === undefined ? SN.strip.noValue : num(v));
const table = (title: string, head: readonly string[], rows: readonly (readonly string[])[]): HTMLElement =>
  tableDetails(fill(SN.strip.tableCaption, { title }), head, rows, fill(SN.strip.tableCaption, { title }));

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
export interface StripOptions {
  series: SeriesFile; comparison: SeriesFile | null; startMs: number; endMs: number; serviceLiveFromSec: number; compare: boolean; onSeek: (tMs: number) => void;
  /** The weekday-matched normal day per window minute (comparisonColumn); `tram` and `bus` are no longer drawn (v3). */
  compareCols?: { all: readonly (number | null)[]; tram?: readonly (number | null)[]; bus?: readonly (number | null)[] } | null;
  /** The heatmap, built by the caller into the element it is given. */
  lines?: ((host: HTMLElement) => void) | null;
}

export function renderStrip(root: HTMLElement, o: StripOptions): StripHandle {
  const s = o.series;
  const n = s.n;
  const days = dayLines(o.startMs, o.endMs);
  const plots: Plot[] = [];
  const keep = (p: Plot): HTMLElement => { plots.push(p); return p.el; };
  const S = SN.strip;
  let compare = o.compare;
  /** A missing count while ZET's data stood still says so; "bez podatka" is kept for a true gap. */
  const seenCell = (m: number): string => (s.seen.all[m] === null && frozenAt(s, m) ? SN.reckoning.feedFrozen : cell(s.seen.all[m]));
  const stateWord = (m: number): string => {
    const cls = stateClass(s, m);
    const word = cls === 'none' ? S.stateNone : STATE_WORD[cls];
    return s.t0 + m * 60 < o.serviceLiveFromSec ? `${word}, ${SN.timeline.retro}` : word;
  };

  // 1. Vehicles in motion: the seen line over the normal day's silhouette, the state as a tint behind, the rug under.
  const compareCol: (number | null)[] = o.compareCols ? [...o.compareCols.all] : new Array(n).fill(null);
  if (!o.compareCols && o.comparison) {
    for (let m = 0; m < n; m++) {
      const cm = comparisonMinute(o.comparison, (s.t0 + m * 60) * 1000);
      compareCol[m] = cm === null ? null : (o.comparison.seen.all[cm] ?? null);
    }
  }
  const fleetMax = colMax(s.seen.all, compareCol);
  const tints = tintRuns(s, o.serviceLiveFromSec);
  const rug = rugRuns(s);
  const [tintSilent, tintReduced] = S.fleetTint;
  const fleetItems: LegendItem[] = [
    { kind: 'line', tone: 'sn-tone-seen', label: S.fleetSeen },
    { kind: 'area', tone: 'sn-tone-compare', label: S.fleetNormal, layer: 'compare' },
    { kind: 'band', tone: 'sn-strip-tone-silent', label: tintSilent! },
    { kind: 'band', tone: 'sn-strip-tone-reduced', label: tintReduced! },
    ...(tints.some((t) => t.retro) ? [{ kind: 'retro' as const, tone: 'sn-strip-tone-retro', label: SN.timeline.retro }] : []),
    { kind: 'rug', tone: 'sn-strip-tone-rug', label: SN.timeline.rug },
  ];
  const fleetPlot = keep(plot('fleet', [
    `<div class="sn-strip-tints">${tints.map((t) => span(`sn-strip-tint sn-strip-tint-${t.cls}${t.retro ? ' sn-strip-tint-retro' : ''}`, t.from, t.to, n)).join('')}</div>`,
    svg(n, [
      { d: areaPath(compareCol, fleetMax), cls: 'sn-area-compare', layer: 'compare' },
      { d: linePath(s.seen.all, fleetMax), cls: 'sn-line-seen' },
    ]),
  ], days, num(fleetMax)));
  const rugEl = document.createElement('div');
  rugEl.className = 'sn-strip-rug';
  rugEl.dataset.runs = String(rug.length);
  rugEl.setAttribute('aria-hidden', 'true');
  rugEl.innerHTML = rug.map((r) => span('sn-strip-rug-run', r.from, r.to, n)).join('');
  const fleet = panel('fleet', S.fleet, fleetItems, [fleetPlot, rugEl,
    table(S.fleet, [S.hour, S.fleetSeen, S.fleetExpected, S.fleetNormal, SN.badge.label], hourRows(s, (m) => [seenCell(m), cell(s.expected.all[m]), cell(compareCol[m]), stateWord(m)]))]);

  // 2. Empty BAJS stations against Thursday 1 October at the same time of day (Sun 22:07 to Wed 24:00).
  let bikes: HTMLElement | null = null;
  if (s.bikes) {
    const cols = bikesColumns(s);
    const max = colMax(cols.now, cols.thu);
    const from = s.bikes.empty.findIndex((v) => v !== null && v !== undefined);
    const lineLabel = from < 0 ? S.bikesEmpty : `${zagrebDay((s.t0 + from * 60) * 1000)} – ${zagrebDay((BIKES_TO_SEC - 60) * 1000)}`;
    bikes = panel('bikes', S.bikesEmpty, [
      { kind: 'line', tone: 'sn-tone-bike-empty', label: lineLabel },
      { kind: 'area', tone: 'sn-tone-compare', label: S.bikesRef },
    ], [
      keep(plot('bikes', [svg(n, [{ d: areaPath(cols.thu, max), cls: 'sn-area-compare' }, { d: linePath(cols.now, max), cls: 'sn-line-bike' }])], days, num(max))),
      table(S.bikesEmpty, [S.hour, S.bikesEmpty, S.bikesRef], hourRows(s, (m) => [cell(cols.now[m]), cell(cols.thu[m])], BIKES_TO_SEC)),
    ], bikesHeadline(s));
  }

  // 3. Sve linije, svaki sat: the heatmap, drawn by the caller (it needs the page's context).
  let lines: HTMLElement | null = null;
  if (o.lines) {
    const host = document.createElement('div');
    host.className = 'sn-strip-lines';
    lines = panel('lines', SN.heatmap.title, null, [host]);
    o.lines(host);
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
  frame.append(axis, fleet, ...(bikes ? [bikes] : []), ...(lines ? [lines] : []));
  root.replaceChildren(frame, readout);
  root.removeAttribute('aria-busy');

  const readoutInput = (): ReadoutInput => ({ series: s, comparison: o.comparison, compare, serviceLiveFromSec: o.serviceLiveFromSec, compareCol: o.compareCols?.all ?? null });
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
    target instanceof Element ? target.closest<HTMLElement>('.sn-plot') : null;
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
  let heatmapOff: (() => void) | null = null;
  const handle = renderStrip(root, {
    series: ctx.series,
    comparison: ctx.comparisons.find((c) => c.id === 'cet-0924')?.series ?? ctx.comparisons[0]?.series ?? null,
    startMs: ctx.clock.start,
    endMs: ctx.clock.end,
    serviceLiveFromSec: ctx.manifest.serviceLiveFromSec,
    compare: ctx.layers.get().compare,
    compareCols: ctx.comparisons.length ? { all: comparisonColumn(ctx, ctx.series, (c) => c.seen.all) } : null,
    // A tapped heatmap cell writes its words into the strip's readout (on a phone there is no hover tip).
    lines: (host) => { heatmapOff = mountHeatmap(ctx, host, { onCell: (text) => { const r = root.querySelector('.sn-strip-readout'); if (r) r.textContent = text; } }); },
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
    heatmapOff?.();
    handle.destroy();
  };
}
