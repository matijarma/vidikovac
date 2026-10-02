// The depths of the deck (plan section 3.2): Stanje the state band with the
// rules in words and the data-path line; Vozila seen against the timetable
// over the window with the normal day dashed, trams and buses as two small
// plots; Linije the heatmap, or with a line as the subject that line's
// five-minute curve; Mreža the two minimaps large with the legend; Bicikli
// the two curves and the stations sorted by emptiness at the instant; Vrijeme
// the temperature line with DHMZ's words at each change. Every depth is built
// when its panel opens and torn down when it closes; its cursor follows the
// frame loop by one transform. Curves reuse strip.ts's pure paths.
import { BAJS_STEP_S, isBajsFile, isStationsFile, type BajsFile, type Col, type SeriesFile, type StationsFile } from '../../../shared/snimka';
import { BAJS_MISSING, BAJS_NOT_RENTING, decodeBajs, decodeBase64, ROUTES_MISSING } from '../../../shared/snimka-codec';
import { tableDetails } from '../statistika/charts';
import { comparisonFor, comparisonMinute, type SnimkaContext } from './context';
import type { PanelId, Subject } from './contracts';
import { num, zagrebDateTime } from './format';
import { mountHeatmap } from './heatmap';
import { el } from './panels';
import { dataPathText } from './readouts';
import { routeSample } from './route-series';
import { SN, fill } from './strings';
import { areaPath, comparisonColumn, linePath, PLOT_H, runsOf, stateClass, type StateClass } from './strip';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface PathSpec { d: string; cls: string }

/** A small plot: the curves (a viewBox in samples, strokes that never scale), the day lines, the scale and the cursor. */
function plot(doc: Document, n: number, paths: readonly PathSpec[], days: readonly number[], scale: string | null, tall = false): { root: HTMLElement; cursor: HTMLElement } {
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
  const root = el(doc, 'div', { class: `sn-panel-plot${tall ? ' sn-panel-plot-tall' : ''}`, 'aria-hidden': 'true' }, svg);
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
  const first = Math.ceil((t0 + 7200) / 86_400) * 86_400 - 7200;
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

// ---- Stanje -------------------------------------------------------------------------------------

const STATE_WORD: Record<StateClass, string> = { normal: SN.badge.normal, reduced: SN.badge.reduced, silent: SN.badge.silent, unknown: SN.badge.unknown, none: SN.strip.stateNone };

function stanje(ctx: SnimkaContext, host: HTMLElement): () => void {
  const doc = ctx.doc;
  const s = ctx.series;
  const runs = runsOf<StateClass>(s.n, (m) => stateClass(s, m));
  const band = el(doc, 'div', { class: 'sn-panel-band', 'aria-hidden': 'true' });
  for (const r of runs) {
    const seg = el(doc, 'span', { class: `sn-panel-seg sn-panel-state-${r.cls}` });
    seg.style.setProperty('--x', (r.from / s.n).toFixed(5));
    seg.style.setProperty('--w', ((r.to - r.from) / s.n).toFixed(5));
    band.append(seg);
  }
  const cursor = el(doc, 'span', { class: 'sn-panel-cursor' });
  const bandBox = el(doc, 'div', { class: 'sn-panel-plot sn-panel-plot-band', 'aria-hidden': 'true' }, band, cursor);
  const legend = el(doc, 'ul', { class: 'st-legend sn-panel-legend' },
    ...(['normal', 'reduced', 'silent', 'unknown', 'none'] as const).map((c) => key(doc, `sn-panel-state-${c}`, STATE_WORD[c])));
  const rules = el(doc, 'ul', { class: 'sn-panel-rules' }, ...[SN.readout.rules.reduced, SN.readout.rules.silent, SN.readout.rules.lift, SN.readout.rules.normal, SN.readout.rules.hold].map((t) => el(doc, 'li', { text: t })));
  const pathLine = el(doc, 'p', { class: 'sn-panel-datapath', 'data-sn': 'data-path', hidden: true });
  const table = tableDetails(`${SN.strip.state}, ${SN.strip.table}`, [SN.strip.hour, SN.strip.state],
    hourly(s, (m) => [STATE_WORD[stateClass(s, m)]]), SN.strip.table);
  host.replaceChildren(bandBox, legend, el(doc, 'h4', { class: 'sn-panel-subhead', text: SN.readout.dataPathTitle }), pathLine,
    el(doc, 'h4', { class: 'sn-panel-subhead', text: SN.readout.rules.title }), rules, el(doc, 'p', { class: 'sn-panel-note', text: SN.readout.rail }), table);
  let lastMinute = -1;
  const offPath = ctx.frames.subscribe((t) => {
    const m = Math.floor(t / 60_000);
    if (m === lastMinute) return;
    lastMinute = m;
    const text = dataPathText(s, t / 1000);
    pathLine.hidden = text === null;
    if (text !== null && pathLine.textContent !== text) pathLine.textContent = text;
  });
  const offCursor = cursors(ctx, [{ cursor, t0: s.t0, seconds: s.n * 60 }]);
  const text = dataPathText(s, ctx.clock.now() / 1000);
  pathLine.hidden = text === null;
  pathLine.textContent = text ?? '';
  return () => { offPath(); offCursor(); };
}

function hourly<T extends string>(s: SeriesFile, row: (m: number) => T[]): string[][] {
  const out: string[][] = [];
  for (let m = 0; m < s.n; m += 60) out.push([zagrebDateTime((s.t0 + m * 60) * 1000), ...row(m)]);
  return out;
}
const cell = (v: number | null | undefined): string => (v === null || v === undefined ? SN.strip.noValue : num(v));

// ---- Vozila ---------------------------------------------------------------------------------------

function vozila(ctx: SnimkaContext, host: HTMLElement): () => void {
  const doc = ctx.doc;
  const s = ctx.series;
  const days = midnights(s.t0, s.n * 60);
  const list: { cursor: HTMLElement; t0: number; seconds: number }[] = [];
  const one = (seen: Col<number>, expected: Col<number>, normal: (number | null)[], tall: boolean): HTMLElement => {
    const max = colMax(seen, expected, normal);
    const p = plot(doc, s.n, [
      { d: areaPath(expected, max), cls: 'sn-panel-area-expected' },
      { d: linePath(normal, max), cls: 'sn-panel-line-normal' },
      { d: linePath(seen, max), cls: 'sn-panel-line-seen' },
    ], days, num(max), tall);
    list.push({ cursor: p.cursor, t0: s.t0, seconds: s.n * 60 });
    return p.root;
  };
  const legend = el(doc, 'ul', { class: 'st-legend sn-panel-legend' },
    key(doc, 'sn-panel-key-seen', SN.readout.moving), key(doc, 'sn-panel-key-expected', SN.readout.expected), key(doc, 'sn-panel-key-normal', SN.readout.normal));
  const all = comparisonColumn(ctx, s, (c) => c.seen.all);
  const tram = comparisonColumn(ctx, s, (c) => c.seen.tram);
  const bus = comparisonColumn(ctx, s, (c) => c.seen.bus);
  const table = tableDetails(`${SN.readout.vehicles}, ${SN.strip.table}`, [SN.strip.hour, SN.readout.moving, SN.readout.expected, SN.readout.normal, SN.strip.tram, SN.strip.bus],
    hourly(s, (m) => [cell(s.seen.all[m]), cell(s.expected.all[m]), cell(all[m]), cell(s.seen.tram[m]), cell(s.seen.bus[m])]), SN.strip.table);
  host.replaceChildren(
    legend, one(s.seen.all, s.expected.all, all, true),
    el(doc, 'h4', { class: 'sn-panel-subhead', text: SN.strip.tram }), one(s.seen.tram, s.expected.tram, tram, false),
    el(doc, 'h4', { class: 'sn-panel-subhead', text: SN.strip.bus }), one(s.seen.bus, s.expected.bus, bus, false),
    table,
  );
  return cursors(ctx, list);
}

// ---- Linije: the heatmap, or one line's curve ------------------------------------------------------

/** One route's five-minute seen and expected as nullable columns (255 is a gap, never zero). */
export function routeColumns(routes: SnimkaContext['routes'], id: string): { seen: (number | null)[]; expected: (number | null)[] } | null {
  const i = routes.routes.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const v = (b: number): number | null => (b === ROUTES_MISSING ? null : b);
  return { seen: [...decodeBase64(routes.seen[i]!)].map(v), expected: [...decodeBase64(routes.expected[i]!)].map(v) };
}

function routeDepth(ctx: SnimkaContext, host: HTMLElement, subject: Extract<Subject, { kind: 'route' }>): () => void {
  const doc = ctx.doc;
  const routes = ctx.routes;
  const meta = routes.routes.find((r) => r.id === subject.id);
  const cols = routeColumns(routes, subject.id);
  const title = el(doc, 'h4', { class: 'sn-panel-subhead', text: fill(SN.subject.line, { short: meta?.shortName ?? subject.id }) });
  const now = el(doc, 'p', { class: 'sn-panel-now', 'data-sn': 'subject-now' });
  const clear = el(doc, 'button', { type: 'button', class: 'btn-ghost sn-panel-clear', text: SN.subject.clear });
  clear.addEventListener('click', () => ctx.view.set({ subject: null }, 'user'));
  if (!cols) {
    host.replaceChildren(title, el(doc, 'p', { class: 'sn-panel-note', text: SN.readout.failed }), clear);
    return () => {};
  }
  // The comparison day's same line aligned by time of day, per sample, the weekday-matched day (S-12).
  const normal: (number | null)[] = new Array<number | null>(routes.n).fill(null);
  for (const c of ctx.comparisons) {
    const ci = c.routes.routes.findIndex((r) => r.id === subject.id);
    if (ci < 0) continue;
    const row = decodeBase64(c.routes.seen[ci]!);
    for (let j = 0; j < routes.n; j++) {
      const atSec = routes.t0 + j * routes.step;
      if (comparisonFor(ctx, atSec).id !== c.id) continue;
      const tod = (((atSec + 7200) % 86_400) + 86_400) % 86_400;
      const cj = Math.floor((c.fromSec + tod - c.routes.t0) / c.routes.step);
      const b = cj >= 0 && cj < c.routes.n ? row[cj]! : ROUTES_MISSING;
      normal[j] = b === ROUTES_MISSING ? null : b;
    }
  }
  const max = colMax(cols.seen, cols.expected, normal);
  const days = midnights(routes.t0, routes.n * routes.step);
  const p = plot(doc, routes.n, [
    { d: areaPath(cols.expected, max), cls: 'sn-panel-area-expected' },
    { d: linePath(normal, max), cls: 'sn-panel-line-normal' },
    { d: linePath(cols.seen, max), cls: 'sn-panel-line-seen' },
  ], days, num(max), true);
  const legend = el(doc, 'ul', { class: 'st-legend sn-panel-legend' },
    key(doc, 'sn-panel-key-seen', SN.readout.moving), key(doc, 'sn-panel-key-expected', SN.readout.expected), key(doc, 'sn-panel-key-normal', SN.readout.normal));
  host.replaceChildren(title, now, el(doc, 'p', { class: 'sn-panel-caption', text: SN.subject.mini }), legend, p.root, clear);
  let last = '';
  const offNow = ctx.frames.subscribe((t) => {
    const k = String(Math.floor(t / 1000 / routes.step));
    if (k === last) return;
    last = k;
    const r = routeSample(routes, subject.id, t / 1000);
    now.textContent = fill(SN.subject.now, { seen: cell(r.seen), expected: cell(r.expected) });
  });
  const r = routeSample(routes, subject.id, ctx.clock.now() / 1000);
  now.textContent = fill(SN.subject.now, { seen: cell(r.seen), expected: cell(r.expected) });
  const offCursor = cursors(ctx, [{ cursor: p.cursor, t0: routes.t0, seconds: routes.n * routes.step }]);
  return () => { offNow(); offCursor(); };
}

function linije(ctx: SnimkaContext, host: HTMLElement): () => void {
  let off: () => void = () => {};
  let shown = '';
  const draw = (): void => {
    const subject = ctx.view.get().subject;
    const k = subject?.kind === 'route' ? subject.id : '';
    if (k === shown && host.childElementCount) return;
    shown = k;
    off();
    host.dataset.snSubject = k || 'none';
    off = subject?.kind === 'route' ? routeDepth(ctx, host, subject) : mountHeatmap(ctx, host);
  };
  draw();
  const offView = ctx.view.onChange((state, prev) => { if (state.subject !== prev.subject) draw(); });
  return () => { offView(); off(); };
}

// ---- Mreža --------------------------------------------------------------------------------------------

function mreza(ctx: SnimkaContext, host: HTMLElement): () => void {
  const doc = ctx.doc;
  const minis = el(doc, 'div', { class: 'sn-panel-minis-large', 'aria-hidden': 'true' });
  const legend = el(doc, 'ul', { class: 'st-legend sn-panel-legend' },
    key(doc, 'sn-panel-key-alive', SN.legend.alive), key(doc, 'sn-panel-key-dead', SN.legend.dead), key(doc, 'sn-panel-key-quiet', SN.legend.quiet));
  host.replaceChildren(el(doc, 'p', { class: 'sn-panel-caption', text: SN.twins.title }), minis, legend, el(doc, 'p', { class: 'sn-panel-note', text: SN.layers.liveNote }));
  let off: (() => void) | null = null;
  let gone = false;
  if (!ctx.lagano) {
    void import('./minimap').then(({ mountMinimaps }) => { if (!gone) off = mountMinimaps(ctx, minis, { large: true }); }, () => {});
  }
  return () => { gone = true; off?.(); };
}

// ---- Bicikli --------------------------------------------------------------------------------------------

const decodeBajsFile = (raw: unknown): BajsFile => { if (!isBajsFile(raw)) throw new Error('bajs'); return raw; };
const decodeStations = (raw: unknown): StationsFile => { if (!isStationsFile(raw)) throw new Error('stations'); return raw; };

export interface StationRow { id: string; name: string; bikes: number | null; capacity: number | null; renting: boolean }

/** The stations at one sample, emptiest first (no bikes, then the fewest; not renting and missing last), names as the tie-break. */
export function stationsAt(stations: StationsFile, file: Pick<BajsFile, 'stations'>, rows: readonly Uint8Array[], sample: number): StationRow[] {
  const byId = new Map(stations.stations.map((st) => [st.id, st]));
  const out: StationRow[] = file.stations.map((id, i) => {
    const b = sample >= 0 ? (rows[i]?.[sample] ?? BAJS_MISSING) : BAJS_MISSING;
    const st = byId.get(id);
    return { id, name: st?.name ?? id, capacity: st?.capacity ?? null, bikes: b === BAJS_MISSING || b === BAJS_NOT_RENTING ? null : b, renting: b !== BAJS_NOT_RENTING };
  });
  const rank = (r: StationRow): number => (r.bikes === null ? 1e6 : r.bikes);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'hr'));
}

function bicikli(ctx: SnimkaContext, host: HTMLElement): () => void {
  const doc = ctx.doc;
  const s = ctx.series;
  const list: { cursor: HTMLElement; t0: number; seconds: number }[] = [];
  const parts: HTMLElement[] = [];
  if (s.bikes) {
    const days = midnights(s.t0, s.n * 60);
    for (const [col, label] of [[s.bikes.total, SN.strip.bikes], [s.bikes.empty, SN.strip.bikesEmpty]] as const) {
      const max = colMax(col);
      const p = plot(doc, s.n, [{ d: areaPath(col, max), cls: 'sn-panel-area-bike' }, { d: linePath(col, max), cls: 'sn-panel-line-bike' }], days, num(max));
      list.push({ cursor: p.cursor, t0: s.t0, seconds: s.n * 60 });
      parts.push(el(doc, 'h4', { class: 'sn-panel-subhead', text: label }), p.root);
    }
  }
  const status = el(doc, 'p', { class: 'sn-panel-note', text: SN.readout.loading });
  const stationList = el(doc, 'ol', { class: 'sn-panel-stations', 'aria-label': SN.readout.stations });
  parts.push(el(doc, 'h4', { class: 'sn-panel-subhead', text: SN.readout.stations }), status, stationList);
  host.replaceChildren(...parts);
  const offCursor = cursors(ctx, list);
  let gone = false;
  let offFrames: () => void = () => {};
  let offView: () => void = () => {};
  void Promise.all([ctx.data.get(ctx.manifest.files.bajs, decodeBajsFile), ctx.data.get(ctx.manifest.files.stations, decodeStations)]).then(([file, stations]) => {
    if (gone) return;
    status.remove();
    const rows = decodeBajs(file);
    let lastSample = -2;
    let lastSubject = '';
    const draw = (t: number, force = false): void => {
      const sample = Math.floor((t / 1000 - file.t0) / BAJS_STEP_S);
      const subject = ctx.view.get().subject;
      const sid = subject?.kind === 'station' ? subject.id : '';
      if (!force && sample === lastSample && sid === lastSubject) return;
      lastSample = sample;
      lastSubject = sid;
      const inside = sample >= 0 && sample < file.n ? sample : -1;
      const all = stationsAt(stations, file, rows, inside);
      // The subject's station first, then the emptiest twelve.
      const chosen = all.find((r) => r.id === sid);
      const shown = [...(chosen ? [chosen] : []), ...all.filter((r) => r.id !== sid).slice(0, 12)];
      stationList.replaceChildren(...shown.map((r) => {
        const b = el(doc, 'button', { type: 'button', class: 'sn-panel-station', 'data-station': r.id, 'aria-pressed': r.id === sid ? 'true' : 'false' },
          el(doc, 'span', { class: 'sn-panel-station-name', text: r.name }),
          el(doc, 'span', { class: 'sn-panel-station-n', text: r.bikes === null ? SN.facts.none : r.id === sid && r.capacity !== null ? fill(SN.subject.bikesNow, { n: num(r.bikes), capacity: num(r.capacity) }) : num(r.bikes) }));
        b.addEventListener('click', () => ctx.view.set({ subject: { kind: 'station', id: r.id } }, 'user'));
        return el(doc, 'li', {}, b);
      }));
    };
    draw(ctx.clock.now(), true);
    offFrames = ctx.frames.subscribe((t) => draw(t));
    offView = ctx.view.onChange(() => draw(ctx.clock.now(), true));
  }, () => { if (!gone) status.textContent = SN.readout.failed; });
  return () => { gone = true; offCursor(); offFrames(); offView(); };
}

// ---- Vrijeme -------------------------------------------------------------------------------------------

/** The hours where DHMZ's words change (the first known hour included), at least `gap` hours apart so labels never collide. */
export function weatherChanges(weather: readonly (string | null)[], gap = 6): { h: number; words: string }[] {
  const out: { h: number; words: string }[] = [];
  let prev: string | null = null;
  for (let h = 0; h < weather.length; h++) {
    const w = weather[h] ?? null;
    if (w === null || w === prev) continue;
    prev = w;
    const last = out[out.length - 1];
    if (last && h - last.h < gap) continue;
    out.push({ h, words: w });
  }
  return out;
}

function vrijeme(ctx: SnimkaContext, host: HTMLElement): () => void {
  const doc = ctx.doc;
  const hr = ctx.series.hourly;
  const temps = hr.tempC;
  const known = temps.filter((v): v is number => v !== null);
  const lo = known.length ? Math.floor(Math.min(...known)) - 1 : 0;
  const shifted = temps.map((v) => (v === null ? null : v - lo));
  const max = colMax(shifted);
  const p = plot(doc, hr.n, [{ d: linePath(shifted, max), cls: 'sn-panel-line-temp' }], midnights(hr.t0, hr.n * 3600), known.length ? `${num(lo + max)} °C` : null, true);
  for (const c of weatherChanges(hr.weather)) {
    const label = el(doc, 'span', { class: 'sn-panel-word', text: c.words });
    label.style.setProperty('--x', ((c.h + 0.5) / hr.n).toFixed(5));
    p.root.append(label);
  }
  if (known.length) p.root.append(el(doc, 'span', { class: 'sn-panel-scale sn-panel-scale-low', text: `${num(lo)} °C` }));
  const rows: string[][] = [];
  for (let h = 0; h < hr.n; h++) rows.push([zagrebDateTime((hr.t0 + h * 3600) * 1000), temps[h] === null || temps[h] === undefined ? SN.strip.noValue : `${num(Math.round(temps[h]!))} °C`, hr.weather[h] ?? SN.strip.noValue]);
  const table = tableDetails(`${SN.strip.weather}, ${SN.strip.table}`, [SN.strip.hour, SN.strip.weather, SN.panel.weather], rows, SN.strip.table);
  host.replaceChildren(el(doc, 'p', { class: 'sn-panel-caption', text: `${SN.strip.weather} · ${SN.readout.weatherSource}` }), p.root, table);
  return cursors(ctx, [{ cursor: p.cursor, t0: hr.t0, seconds: hr.n * 3600 }]);
}

const DEPTHS: Partial<Record<PanelId, (ctx: SnimkaContext, host: HTMLElement) => () => void>> = { stanje, vozila, linije, mreza, bicikli, vrijeme };

/** Builds a panel's depth into `el` and returns its teardown; a panel without a depth here (Poglavlja is V4's) gets nothing. */
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
