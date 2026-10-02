// The depths of the deck (decisions V3-14, V3-15). Vozila: one curve, the
// moving fleet over the window with the normal day dashed and the state as a
// tint behind, the timetable in the tooltip and in the instant's line, the
// data-path line only when ZET, the fleet and the screen part by two or
// more. Mreža: the twin minimaps large with their one legend, the lines that
// have a vehicle now as chips against the normal day (each sets the route
// subject) and, with a route as the subject, its curve against the normal
// day. Bicikli: twin station dot maps (now and Thursday 1 October's same
// minute, in the minimaps' projection), the stations empty now that were not
// on Thursday, and one weather clause. Every depth is built when its panel
// opens and torn down when it closes; cursors follow the frame loop by one
// transform. Curves reuse strip.ts's pure paths (linePath, PLOT_H); the
// heatmap left the deck for Tijek (W4a). deckSpecs(ctx) is the stage's entry.
import { toPlane } from '../../../shared/motion/geo';
import { BAJS_STEP_S, ZAGREB_OFFSET_S, isBajsFile, isStationsFile, type BajsFile, type SeriesFile, type StationsFile } from '../../../shared/snimka';
import { BAJS_MISSING, BAJS_NOT_RENTING, decodeBajs } from '../../../shared/snimka-codec';
import { tableDetails } from '../statistika/charts';
import { comparisonFor, type SnimkaContext } from './context';
import type { PanelId, PanelSpec, Subject } from './contracts';
import { num, zagrebDateTime, zagrebDay } from './format';
import { networkCounts } from './live-network';
import { el } from './panels';
import { bikesReference, dataPathText, minuteIn, readoutSpecs } from './readouts';
import { routeCurve, routeSample } from './route-series';
import { SN, fill } from './strings';
import { comparisonColumn, linePath, PLOT_H, runsOf, stateClass, type StateClass } from './strip';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NV = SN.facts.none;
const nv = (v: number | null | undefined): string => (v === null || v === undefined ? NV : num(v));
const timeOfDay = (atSec: number): number => (((Math.floor(atSec) + ZAGREB_OFFSET_S) % 86_400) + 86_400) % 86_400;
const isSunday = (atSec: number): boolean => new Date((atSec + ZAGREB_OFFSET_S) * 1000).getUTCDay() === 0;
const setText = (node: Element, text: string): void => { if (node.textContent !== text) node.textContent = text; };

interface PathSpec { d: string; cls: string }

/** A plot: the curves (a viewBox in samples, strokes that never scale), an optional tint behind, the day lines, the scale and the cursor. */
function plot(doc: Document, n: number, paths: readonly PathSpec[], days: readonly number[], scale: string | null): { root: HTMLElement; cursor: HTMLElement } {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'sn-panel-curves');
  svg.setAttribute('viewBox', `-0.5 0 ${n} ${PLOT_H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const p of paths) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', p.d);
    path.setAttribute('class', p.cls);
    svg.append(path);
  }
  const cursor = el(doc, 'span', { class: 'sn-panel-cursor' });
  const root = el(doc, 'div', { class: 'sn-panel-plot' }, svg);
  for (const x of days) {
    const line = el(doc, 'span', { class: 'sn-panel-dayline' });
    line.style.setProperty('--x', x.toFixed(5));
    root.append(line);
  }
  if (scale) root.append(el(doc, 'span', { class: 'sn-panel-scale', text: scale }));
  root.append(cursor);
  return { root, cursor };
}

function key(doc: Document, cls: string, label: string): HTMLLIElement {
  return el(doc, 'li', {}, el(doc, 'span', { class: `sn-panel-key ${cls}`, 'aria-hidden': 'true' }), label);
}

const colMax = (...cols: (readonly (number | null | undefined)[] | null | undefined)[]): number => {
  let max = 0;
  for (const c of cols) if (c) for (const v of c) if (v !== null && v !== undefined && v > max) max = v;
  return max;
};

/** The Zagreb midnights inside a span, as fractions of it. */
function midnights(t0: number, seconds: number): number[] {
  const out: number[] = [];
  const first = Math.ceil((t0 + ZAGREB_OFFSET_S) / 86_400) * 86_400 - ZAGREB_OFFSET_S;
  for (let d = first; d < t0 + seconds; d += 86_400) if (d > t0) out.push((d - t0) / seconds);
  return out;
}

/** Moves every cursor to an instant, by one transform each, only when its place changes visibly. */
function cursors(ctx: SnimkaContext, list: { cursor: HTMLElement; t0: number; seconds: number }[]): () => void {
  let last = '';
  const move = (t: number): void => {
    const k = String(Math.floor(t / 60_000));
    if (k === last) return;
    last = k;
    for (const c of list) {
      const x = Math.max(0, Math.min(1, (t / 1000 - c.t0) / c.seconds));
      c.cursor.style.transform = `translateX(${(x * 100).toFixed(3)}%)`;
    }
  };
  move(ctx.clock.now());
  return ctx.frames.subscribe(move);
}

/** Runs a per-frame draw once now and then on every frame; returns the unsubscribe. */
function everyFrame(ctx: SnimkaContext, draw: (t: number) => void): () => void {
  draw(ctx.clock.now());
  return ctx.frames.subscribe(draw);
}

function hourly(s: SeriesFile, row: (m: number) => string[]): string[][] {
  const out: string[][] = [];
  for (let m = 0; m < s.n; m += 60) out.push([zagrebDateTime((s.t0 + m * 60) * 1000), ...row(m)]);
  return out;
}

// ---- Vozila -------------------------------------------------------------------------------------

const STATE_WORD: Record<StateClass, string> = { normal: SN.badge.normal, reduced: SN.badge.reduced, silent: SN.badge.silent, unknown: SN.badge.unknown, none: NV };

/** The weekday-matched normal day's moving fleet per window minute; null on Sunday (no comparison, V3-8) and where the day lacks the minute. */
export function normalFleetColumn(ctx: Pick<SnimkaContext, 'comparisons'>, s: Pick<SeriesFile, 't0' | 'n'>): (number | null)[] {
  const col = comparisonColumn(ctx, s, (c) => c.seen.all);
  for (let m = 0; m < s.n; m++) if (isSunday(s.t0 + m * 60)) col[m] = null;
  return col;
}

/** The hover line of the Vozila curve: "pon 28. 9. u 07:45 · u pokretu 4 · običan dan 321 · po voznom redu 449". */
export function vehiclesTip(s: SeriesFile, normal: readonly (number | null)[], m: number): string {
  return [zagrebDateTime((s.t0 + m * 60) * 1000), `${SN.readout.moving} ${nv(s.seen.all[m])}`, `${SN.readout.normalDay} ${nv(normal[m])}`, fill(SN.facts.expected, { n: nv(s.expected.all[m]) })].join(' · ');
}

function vozila(ctx: SnimkaContext, host: HTMLElement): () => void {
  const doc = ctx.doc;
  const s = ctx.series;
  const normal = normalFleetColumn(ctx, s);
  const max = colMax(s.seen.all, normal);
  const p = plot(doc, s.n, [
    { d: linePath(normal, max), cls: 'sn-panel-line-normal' },
    { d: linePath(s.seen.all, max), cls: 'sn-panel-line-seen' },
  ], midnights(s.t0, s.n * 60), num(max));
  p.root.classList.add('sn-panel-plot-tall');
  // The state as a tint behind the curve; the legend names every tone in words.
  const tint = el(doc, 'div', { class: 'sn-panel-tint', 'aria-hidden': 'true' });
  for (const r of runsOf<StateClass>(s.n, (m) => stateClass(s, m))) {
    if (r.cls === 'none') continue;
    const seg = el(doc, 'span', { class: `sn-panel-seg sn-panel-state-${r.cls}` });
    seg.style.setProperty('--x', (r.from / s.n).toFixed(5));
    seg.style.setProperty('--w', ((r.to - r.from) / s.n).toFixed(5));
    tint.append(seg);
  }
  p.root.prepend(tint);
  const tip = el(doc, 'span', { class: 'sn-panel-tip', 'data-sn': 'vozila-tip', hidden: true });
  p.root.append(tip);
  const onMove = (event: PointerEvent): void => {
    const box = p.root.getBoundingClientRect();
    if (box.width <= 0) return;
    const x = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    const m = Math.min(s.n - 1, Math.floor(x * s.n));
    setText(tip, vehiclesTip(s, normal, m));
    tip.style.setProperty('--x', x.toFixed(4));
    tip.hidden = false;
  };
  const onLeave = (): void => { tip.hidden = true; };
  p.root.addEventListener('pointermove', onMove);
  p.root.addEventListener('pointerleave', onLeave);

  const legend = el(doc, 'ul', { class: 'st-legend sn-panel-legend' },
    key(doc, 'sn-panel-key-seen', SN.readout.moving), key(doc, 'sn-panel-key-normal', SN.readout.normalDay),
    ...(['normal', 'reduced', 'silent', 'unknown'] as const).map((c) => key(doc, `sn-panel-key-tint sn-panel-state-${c}`, STATE_WORD[c])));
  const nowLine = el(doc, 'p', { class: 'sn-panel-now', 'data-sn': 'vozila-now' });
  const pathLine = el(doc, 'p', { class: 'sn-panel-datapath', 'data-sn': 'data-path', hidden: true });
  const table = tableDetails(`${SN.readout.vehicles}, ${SN.strip.table}`, [SN.strip.hour, SN.readout.moving, SN.readout.normalDay, SN.readout.expected, SN.badge.label],
    hourly(s, (m) => [nv(s.seen.all[m]), nv(normal[m]), nv(s.expected.all[m]), STATE_WORD[stateClass(s, m)]]), SN.strip.table);
  host.replaceChildren(nowLine, legend, p.root, pathLine, table);
  let lastMinute = -1;
  const offNow = everyFrame(ctx, (t) => {
    const m = Math.floor(t / 60_000);
    if (m === lastMinute) return;
    lastMinute = m;
    const i = minuteIn(s, t / 1000);
    setText(nowLine, i === null ? NV : fill(SN.badge.counts, { seen: nv(s.seen.all[i]), expected: nv(s.expected.all[i]) }));
    const text = dataPathText(s, t / 1000);
    pathLine.hidden = text === null;
    if (text !== null) setText(pathLine, text);
  });
  const offCursor = cursors(ctx, [{ cursor: p.cursor, t0: s.t0, seconds: s.n * 60 }]);
  return () => { offNow(); offCursor(); p.root.removeEventListener('pointermove', onMove); p.root.removeEventListener('pointerleave', onLeave); };
}

// ---- Mreža --------------------------------------------------------------------------------------------

/** The weekday-matched normal day's count on one route per window sample (time of day aligned); null on Sunday and where missing. */
export function normalRouteColumn(ctx: Pick<SnimkaContext, 'comparisons' | 'routes'>, routeId: string): (number | null)[] {
  const routes = ctx.routes;
  const out: (number | null)[] = new Array<number | null>(routes.n).fill(null);
  if (!ctx.comparisons.length) return out;
  for (let j = 0; j < routes.n; j++) {
    const atSec = routes.t0 + j * routes.step;
    if (isSunday(atSec)) continue;
    const c = comparisonFor(ctx, atSec);
    out[j] = routeSample(c.routes, routeId, c.fromSec + timeOfDay(atSec)).seen;
  }
  return out;
}

/** The normal day's count on one route at the instant's time of day; null on Sunday and where missing. */
function normalRouteAt(ctx: SnimkaContext, routeId: string, atSec: number): number | null {
  if (!ctx.comparisons.length || isSunday(atSec)) return null;
  const c = comparisonFor(ctx, atSec);
  return routeSample(c.routes, routeId, c.fromSec + timeOfDay(atSec)).seen;
}

/** One chip's words: "228 3 · običan dan 4". */
export function lineChipText(short: string, seen: number | null, normal: number | null): string {
  return `${short} ${nv(seen)} · ${SN.readout.normalDay} ${nv(normal)}`;
}

function subjectBlock(ctx: SnimkaContext, host: HTMLElement, subject: Extract<Subject, { kind: 'route' }>): () => void {
  const doc = ctx.doc;
  const routes = ctx.routes;
  const short = routes.routes.find((r) => r.id === subject.id)?.shortName ?? subject.id;
  const title = el(doc, 'h4', { class: 'sn-panel-subhead sn-panel-subject', 'data-sn': 'subject-now' });
  const clear = el(doc, 'button', { type: 'button', class: 'btn-ghost sn-panel-clear', text: SN.subject.clear });
  clear.addEventListener('click', () => ctx.view.set({ subject: null }, 'user'));
  const curve = routeCurve(routes, subject.id);
  if (!curve.seen.length) {
    host.replaceChildren(title, el(doc, 'p', { class: 'sn-panel-note', text: SN.readout.failed }), clear);
    setText(title, fill(SN.subject.line, { short }));
    return () => {};
  }
  const normal = normalRouteColumn(ctx, subject.id);
  const max = colMax(curve.seen, normal);
  const p = plot(doc, routes.n, [
    { d: linePath(normal, max), cls: 'sn-panel-line-normal' },
    { d: linePath(curve.seen, max), cls: 'sn-panel-line-seen' },
  ], midnights(routes.t0, routes.n * routes.step), num(max));
  const legend = el(doc, 'ul', { class: 'st-legend sn-panel-legend' }, key(doc, 'sn-panel-key-seen', SN.readout.moving), key(doc, 'sn-panel-key-normal', SN.readout.normalDay));
  host.replaceChildren(title, legend, p.root, clear);
  let last = '';
  const offNow = everyFrame(ctx, (t) => {
    const k = String(Math.floor(t / 1000 / routes.step));
    if (k === last) return;
    last = k;
    const r = routeSample(routes, subject.id, t / 1000);
    setText(title, fill(SN.subject.lineVsNormal, { short, seen: nv(r.seen), normal: nv(normalRouteAt(ctx, subject.id, t / 1000)) }));
  });
  const offCursor = cursors(ctx, [{ cursor: p.cursor, t0: routes.t0, seconds: routes.n * routes.step }]);
  return () => { offNow(); offCursor(); };
}

function mreza(ctx: SnimkaContext, host: HTMLElement): () => void {
  const doc = ctx.doc;
  const routes = ctx.routes;
  const minis = el(doc, 'div', { class: 'sn-panel-minis-large' });
  const chipsLabel = el(doc, 'p', { class: 'sn-panel-caption', id: 'sn-panel-lines-label' });
  const chips = el(doc, 'ul', { class: 'sn-panel-chips', 'aria-labelledby': chipsLabel.id, 'data-sn': 'line-chips' });
  const subjectHost = el(doc, 'div', { class: 'sn-panel-subject-host' });
  host.replaceChildren(minis, chipsLabel, chips, subjectHost);

  // The chips: one per line with a vehicle now, in the file's order (trams, then buses); a chip that stays keeps its node.
  const order = new Map(routes.routes.map((r, i) => [r.id, i]));
  const shown = new Map<string, { li: HTMLLIElement; button: HTMLButtonElement }>();
  const chipFor = (id: string): { li: HTMLLIElement; button: HTMLButtonElement } => {
    const button = el(doc, 'button', { type: 'button', class: 'chip sn-panel-chip', 'data-route': id, 'aria-pressed': 'false' });
    button.addEventListener('click', () => {
      const s = ctx.view.get().subject;
      ctx.view.set({ subject: s?.kind === 'route' && s.id === id ? null : { kind: 'route', id } }, 'user');
    });
    return { li: el(doc, 'li', { 'data-route': id }, button), button };
  };
  const pressed = (): void => {
    const s = ctx.view.get().subject;
    for (const [id, c] of shown) c.button.setAttribute('aria-pressed', s?.kind === 'route' && s.id === id ? 'true' : 'false');
  };
  let lastSlot = '';
  const offChips = everyFrame(ctx, (t) => {
    const atSec = t / 1000;
    const k = String(Math.floor(atSec / routes.step));
    if (k === lastSlot) return;
    lastSlot = k;
    const counts = networkCounts(routes, atSec);
    setText(chipsLabel, counts ? fill(SN.twins.count, { alive: num(counts.alive), scheduled: num(counts.scheduled) }) : NV);
    const alive = counts ? [...counts.states].filter(([, st]) => st === 'alive').map(([id]) => id).sort((a, b) => order.get(a)! - order.get(b)!) : [];
    const keep = new Set(alive);
    for (const [id, c] of shown) if (!keep.has(id)) { c.li.remove(); shown.delete(id); }
    let next: HTMLLIElement | null = null;
    for (let i = alive.length - 1; i >= 0; i--) {
      const id = alive[i]!;
      let c = shown.get(id);
      if (!c) { c = chipFor(id); shown.set(id, c); chips.insertBefore(c.li, next); }
      next = c.li;
      const short = routes.routes[order.get(id)!]?.shortName ?? id;
      setText(c.button, lineChipText(short, routeSample(routes, id, atSec).seen, normalRouteAt(ctx, id, atSec)));
    }
    pressed();
  });

  let offSubject: () => void = () => {};
  let shownSubject = '';
  const drawSubject = (): void => {
    const s = ctx.view.get().subject;
    const k = s?.kind === 'route' ? s.id : '';
    if (k === shownSubject) return;
    shownSubject = k;
    offSubject();
    offSubject = () => {};
    host.dataset.snSubject = k || 'none';
    if (s?.kind === 'route') offSubject = subjectBlock(ctx, subjectHost, s);
    else subjectHost.replaceChildren();
  };
  drawSubject();
  const offView = ctx.view.onChange(() => { drawSubject(); pressed(); });

  let off: (() => void) | null = null;
  let gone = false;
  if (!ctx.lagano) {
    void import('./minimap').then(({ mountMinimaps }) => { if (!gone) off = mountMinimaps(ctx, minis, { large: true }); }, () => {});
  }
  return () => { gone = true; off?.(); offChips(); offView(); offSubject(); };
}

// ---- Bicikli --------------------------------------------------------------------------------------------

const decodeBajsFile = (raw: unknown): BajsFile => { if (!isBajsFile(raw)) throw new Error('bajs'); return raw; };
const decodeStations = (raw: unknown): StationsFile => { if (!isStationsFile(raw)) throw new Error('stations'); return raw; };

/** BAJS's names come in capitals ("TRG KRALJA TOMISLAVA"): normal capitalisation for the list, acronyms and initials kept. */
const ACRONYMS = new Set(['HAK', 'MUP', 'KB', 'KBC', 'RTL', 'SC', 'TC', 'OŠ', 'RSC', 'VMD', 'ŽS', 'XIII']);
const GENERIC = new Set(['ul.', 'ulica', 'cesta', 'avenija', 'trg', 'okretište', 'kolodvor', 'terminal', 'most', 'naselje', 'velesajam', 'centar',
  'tržnica', 'škola', 'fakultet', 'sveučilište', 'knjižnica', 'stajalište', 'dvorana', 'zdravlja', 'hotel', 'bana', 'kralja', 'kneza', 'grada',
  'žrtava', 'fašizma', 'hrvatskih', 'velikana', 'i', 'sv.', 'dr.', 'prilaz', 'šetnica', 'šetalište', 'zvijezda', 'samo', 'za', 'cargo', 'otvoreno',
  'učilište', 'sveučilišna', 'katoličko', 'kulture', 'dobrog', 'pastira', 'mall']);
const cap = (w: string): string => w.charAt(0).toLocaleUpperCase('hr') + w.slice(1).toLocaleLowerCase('hr');

export function stationName(raw: string): string {
  const letters = raw.replace(/[^\p{L}]/gu, '');
  if (!letters || letters !== letters.toLocaleUpperCase('hr')) return raw;
  return raw.split(/(\s+[-–]\s+)/).map((segment, si) => {
    if (si % 2 === 1) return segment;
    return segment.split(' ').map((word, i) => {
      if (!word) return word;
      if (ACRONYMS.has(word)) return word;
      const lower = word.toLocaleLowerCase('hr');
      if (i > 0 && GENERIC.has(lower)) return lower;
      // Initials and hyphenated names: every part capitalised ("S.D.", "I.Brlić-Mažuranić").
      return word.split(/([.-])/).map((part) => (part === '.' || part === '-' ? part : cap(part))).join('');
    }).join(' ');
  }).join('');
}

export type DotState = 'full' | 'empty' | 'off' | 'none';
/** A station's dot by its byte: bikes there (filled), none (hollow), not renting (254, grey), missing (255, not drawn). */
export function dotState(b: number | undefined): DotState {
  if (b === undefined || b === BAJS_MISSING) return 'none';
  if (b === BAJS_NOT_RENTING) return 'off';
  return b > 0 ? 'full' : 'empty';
}

export interface EmptiedRow { id: string; name: string; ref: number }

/** "Prazne sada, a u četvrtak 1. 10. nisu bile": 0 bikes now, at least 3 at the reference minute, the fullest on Thursday first, names as the tie-break. */
export function emptiedStations(stations: StationsFile, file: Pick<BajsFile, 'stations'>, rows: readonly Uint8Array[], sample: number, refSample: number): EmptiedRow[] {
  const byId = new Map(stations.stations.map((st) => [st.id, st]));
  const out: EmptiedRow[] = [];
  file.stations.forEach((id, i) => {
    const now = sample >= 0 ? rows[i]?.[sample] : undefined;
    const ref = refSample >= 0 ? rows[i]?.[refSample] : undefined;
    if (now !== 0 || ref === undefined || ref === BAJS_MISSING || ref === BAJS_NOT_RENTING || ref < 3) return;
    out.push({ id, name: stationName(byId.get(id)?.name ?? id), ref });
  });
  return out.sort((a, b) => b.ref - a.ref || a.name.localeCompare(b.name, 'hr'));
}

/** The stations in the minimaps' projection (shared/motion/geo toPlane, y down), with a padded viewBox. */
export function stationPoints(stations: StationsFile): { points: Map<string, { x: number; y: number }>; viewBox: string } {
  const points = new Map<string, { x: number; y: number }>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const st of stations.stations) {
    const p = toPlane(st.lon, st.lat);
    const x = Math.round(p.x);
    const y = Math.round(-p.y);
    points.set(st.id, { x, y });
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const pad = 400;
  return { points, viewBox: points.size ? `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}` : '0 0 1 1' };
}

interface DotMap { figure: HTMLElement; caption: HTMLElement; svg: SVGSVGElement; dots: SVGCircleElement[] }

function dotMap(doc: Document, ids: readonly string[], pts: ReturnType<typeof stationPoints>, cls: string): DotMap {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'sn-panel-dots');
  svg.setAttribute('viewBox', pts.viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const dots = ids.map((id) => {
    const c = doc.createElementNS(SVG_NS, 'circle');
    const p = pts.points.get(id);
    c.setAttribute('cx', String(p?.x ?? 0));
    c.setAttribute('cy', String(p?.y ?? 0));
    c.setAttribute('r', '110');
    c.setAttribute('class', p ? 'sn-panel-dot' : 'sn-panel-dot sn-panel-dot-none');
    svg.append(c);
    return c;
  });
  const caption = el(doc, 'figcaption', { class: 'sn-panel-dots-caption' });
  const figure = el(doc, 'figure', { class: `sn-panel-dotmap ${cls}` }, svg, caption);
  return { figure, caption, svg, dots };
}

function paintDots(m: DotMap, ids: readonly string[], rows: readonly Uint8Array[], sample: number, hasPoint: (id: string) => boolean): { drawn: number; empty: number } {
  let drawn = 0;
  let empty = 0;
  m.dots.forEach((dot, i) => {
    const st = hasPoint(ids[i]!) ? dotState(sample >= 0 ? rows[i]?.[sample] : undefined) : 'none';
    dot.setAttribute('class', `sn-panel-dot sn-panel-dot-${st}`);
    if (st !== 'none') drawn += 1;
    if (st === 'empty') empty += 1;
  });
  m.svg.dataset.snDots = `${drawn}/${empty}`;
  return { drawn, empty };
}

function bicikli(ctx: SnimkaContext, host: HTMLElement): () => void {
  const doc = ctx.doc;
  const s = ctx.series;
  const status = el(doc, 'p', { class: 'sn-panel-note', text: SN.readout.loading });
  const maps = el(doc, 'div', { class: 'sn-panel-dotmaps', 'data-sn': 'station-maps' });
  const listHead = el(doc, 'h4', { class: 'sn-panel-subhead', id: 'sn-panel-stations-h', text: SN.readout.stations });
  const list = el(doc, 'ol', { class: 'sn-panel-stations', 'aria-labelledby': listHead.id, 'data-sn': 'emptied' });
  const legend = el(doc, 'ul', { class: 'st-legend sn-panel-legend' },
    key(doc, 'sn-panel-key-dot sn-panel-dot-full', SN.layers.bikes), key(doc, 'sn-panel-key-dot sn-panel-dot-empty', SN.readout.emptyForms[0]));
  host.replaceChildren(status, maps, legend, listHead, list, el(doc, 'p', { class: 'sn-panel-note', text: SN.readout.weatherClause }));
  let gone = false;
  let offFrames: () => void = () => {};
  let offView: () => void = () => {};
  void Promise.all([ctx.data.get(ctx.manifest.files.bajs, decodeBajsFile), ctx.data.get(ctx.manifest.files.stations, decodeStations)]).then(([file, stations]) => {
    if (gone) return;
    status.remove();
    const rows = decodeBajs(file);
    const pts = stationPoints(stations);
    const has = (id: string): boolean => pts.points.has(id);
    const nowMap = dotMap(doc, file.stations, pts, 'sn-panel-dotmap-now');
    const refMap = dotMap(doc, file.stations, pts, 'sn-panel-dotmap-ref');
    maps.replaceChildren(nowMap.figure, refMap.figure);
    const sampleOf = (atSec: number): number => {
      const j = Math.floor((atSec - file.t0) / BAJS_STEP_S);
      return j >= 0 && j < file.n ? j : -1;
    };
    let lastKey = '';
    const draw = (t: number, force = false): void => {
      const atSec = t / 1000;
      const sample = sampleOf(atSec);
      const ref = bikesReference(s, atSec);
      const refSample = ref ? sampleOf(ref.atSec) : -1;
      const sid = ctx.view.get().subject;
      const k = `${sample}|${refSample}|${sid?.kind === 'station' ? sid.id : ''}`;
      if (!force && k === lastKey) return;
      lastKey = k;
      paintDots(nowMap, file.stations, rows, sample, has);
      paintDots(refMap, file.stations, rows, refSample, has);
      setText(nowMap.caption, fill(SN.twins.now, { day: zagrebDay(t) }));
      setText(refMap.caption, ref ? fill(SN.twins.normal, { day: ref.day }) : NV);
      const refWord = (ref?.day ?? 'čet 1. 10.').split(' ')[0]!;
      const rowsNow = sample >= 0 && refSample >= 0 ? emptiedStations(stations, file, rows, sample, refSample).slice(0, 12) : [];
      list.replaceChildren(...rowsNow.map((r) => {
        const pressed = sid?.kind === 'station' && sid.id === r.id;
        const b = el(doc, 'button', { type: 'button', class: 'sn-panel-station', 'data-station': r.id, 'aria-pressed': pressed ? 'true' : 'false' },
          el(doc, 'span', { class: 'sn-panel-station-name', text: r.name }),
          el(doc, 'span', { class: 'sn-panel-station-n', text: `0 · ${refWord} ${num(r.ref)}` }));
        b.addEventListener('click', () => ctx.view.set({ subject: { kind: 'station', id: r.id } }, 'user'));
        return el(doc, 'li', {}, b);
      }));
      if (!rowsNow.length) list.append(el(doc, 'li', { class: 'sn-panel-note', text: NV }));
    };
    draw(ctx.clock.now(), true);
    offFrames = ctx.frames.subscribe((t) => draw(t));
    offView = ctx.view.onChange(() => draw(ctx.clock.now(), true));
  }, () => { if (!gone) status.textContent = SN.readout.failed; });
  return () => { gone = true; offFrames(); offView(); };
}

// ---- registration ---------------------------------------------------------------------------------------

const DEPTHS: Record<PanelId, (ctx: SnimkaContext, host: HTMLElement) => () => void> = { vozila, mreza, bicikli };

/** Builds a panel's depth into `el` and returns its teardown; a depth that throws leaves one line of words. */
export function mountPanelDepth(ctx: SnimkaContext, id: PanelId, host: HTMLElement): () => void {
  const build = DEPTHS[id];
  if (!build) return () => {};
  try {
    return build(ctx, host);
  } catch {
    host.replaceChildren(el(ctx.doc, 'p', { class: 'sn-panel-note', text: SN.readout.failed }));
    return () => {};
  }
}

/**
 * The deck's three PanelSpecs (Vozila, Mreža, Bicikli) with their faces (readouts.ts) and these depths: what
 * stage.ts hands createPanelDeck. `teardowns` collects what the faces hold beyond the deck's own teardown (the
 * Mreža face's minimaps); the stage runs them when it unmounts.
 */
export function deckSpecs(ctx: SnimkaContext, teardowns: (() => void)[] = []): PanelSpec[] {
  return readoutSpecs(ctx, (id, host) => mountPanelDepth(ctx, id, host), teardowns);
}
