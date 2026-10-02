// The block "Čime se moglo umjesto tramvaja" of Što snimka pokazuje (v3,
// decision V3-21): the BAJS stations that stood empty on Monday far longer
// than on the normal Thursday 1 October, line 228 (the one line that ran its
// timetable) over its timetable's silhouette, and six press links in three
// beats. Every number comes from the dataset by a pure function below, with
// its method line under it on the page; the press items are titles and links
// only (decision S-2). This file also holds the page's one stage hook
// (showOnStage) and the tiles' seek binding, so the dossier never imports
// report.ts.
//
// Missing is never zero: a slot the recording lacks (255) or a station that
// was not renting (254) is no count, never a 0.
import { ZAGREB_OFFSET_S, isBajsFile, isStationsFile, type BajsFile, type NewsFile, type StationsFile } from '../../../shared/snimka';
import { BAJS_MISSING, BAJS_NOT_RENTING, ROUTES_MISSING, SnimkaError, decodeBajs, decodeRoutes } from '../../../shared/snimka-codec';
import { card, empty, tableDetails } from '../statistika/charts';
import { escapeHtml } from '../ui/dom/escape';
import type { Mount, SnimkaContext } from './context';
import type { RoutesLike } from './contracts';
import { num, zagrebDateTime, zagrebDay } from './format';
import { colMax, miniPlot } from './paths';
import { SN, fill } from './strings';

const A = SN.alternatives;
const HOUR_S = 3600;
const DAY_S = 86_400;
const zg = (month: number, day: number, hour: number, minute = 0): number => Date.UTC(2026, month - 1, day, hour, minute) / 1000 - ZAGREB_OFFSET_S;

/** Monday 28 September 05:00 Zagreb: the first morning without trams (the v2 stations' start; kept for its callers). */
export const MONDAY_FIVE_S = zg(9, 28, 5, 0);
/** The stations are compared from 06:00 to 20:00: Monday 28 September against Thursday 1 October. */
export const MONDAY_SIX_S = zg(9, 28, 6, 0);
export const THURSDAY_SIX_S = zg(10, 1, 6, 0);
export const STATION_HOURS = 14;
/** Tuesday 29 September 00:00 Zagreb (v2's line 228 start; kept for its callers). */
export const TUESDAY_S = zg(9, 29, 0, 0);
/** Line 228 is drawn from Monday 05:00 to Wednesday 22:00 (65 hours). */
export const LINE228_FROM_S = MONDAY_FIVE_S;
export const LINE228_TO_S = zg(9, 30, 22, 0);
export const LINE228_HOURS = (LINE228_TO_S - LINE228_FROM_S) / HOUR_S;
/** The beats of the press list, in the order the block names them, two links each (the first and the last in time). */
export const PRESS_BEATS = ['taksi', 'volonteri', 'bajs'] as const;
export const PRESS_PER_BEAT = 2;
/** How many stations the ranking shows. */
export const STATION_LIMIT = 10;

const known = (v: number): boolean => v !== BAJS_MISSING && v !== BAJS_NOT_RENTING;

// ---- the pure functions --------------------------------------------------------------

/** Words of BAJS station names that stay lower case inside a name (common nouns and function words). */
const LOWER = new Set(['ul.', 'ulica', 'cesta', 'trg', 'okretište', 'centar', 'stajalište', 'avenija', 'tržnica', 'park', 'kolodvor', 'terminal', 'hotel', 'škola',
  'osnovna', 'crkva', 'fakultet', 'sveučilište', 'autobusni', 'autobusno', 'željezničko', 'most', 'naselje', 'knjižnica', 'bazen', 'kampus', 'grada', 'i', 'za', 'samo',
  'sv.', 'mall', 'shopping', 'remiza', 'arena', 'nacionalna', 'sveučilišna', 'filozofski', 'zagrebačka', 'savska', 'radnička', 'selska', 'slavonska', 'žrtava', 'fašizma', 'republike']);

/** A station name in normal capitalisation: nextbike's all-capitals words ("UL. GRADA VUKOVARA") become
 *  "Ul. grada Vukovara" (common nouns and function words lower case inside a name, the rest capitalised); short
 *  abbreviations (TC, HAK, RSC, S.D.), numbers and words already in mixed or lower case stay as they are. */
export function stationName(name: string): string {
  let first = true;
  return name.split(/(\s+|-)/).map((w) => {
    if (!/\p{L}/u.test(w)) return w;
    const at = first;
    first = false;
    if (w !== w.toLocaleUpperCase('hr')) return w;
    const lower = w.toLocaleLowerCase('hr');
    const cap = lower.charAt(0).toLocaleUpperCase('hr') + lower.slice(1);
    if (LOWER.has(lower)) return at ? cap : lower;
    if (w.replace(/\./g, '').length <= 3 || /^\p{L}\.\p{L}/u.test(w)) return w;
    return cap;
  }).join('');
}

export interface EmptyHoursRow {
  id: string; name: string;
  /** Hours without a bike from 06:00 to 20:00 on Monday 28 September and on Thursday 1 October (known slots only). */
  monday: number; thursday: number;
  /** The first minute of Monday's longest empty stretch in those hours (the "Pokaži na karti" moment). */
  atSec: number;
}

/** The empty slots of one station's row in [fromSec, fromSec + hours), as hours, and the start of the longest run;
 *  null when the span has no known slot (missing is not empty). */
function emptyHours(bajs: BajsFile, row: Uint8Array, fromSec: number, hours: number): { hours: number; longestAt: number | null } | null {
  const j0 = Math.max(0, Math.ceil((fromSec - bajs.t0) / bajs.step));
  const j1 = Math.min(bajs.n, Math.ceil((fromSec + hours * HOUR_S - bajs.t0) / bajs.step));
  let knownSlots = 0;
  let emptySlots = 0;
  let run = 0;
  let runStart = -1;
  let best = 0;
  let bestStart = -1;
  for (let j = j0; j < j1; j++) {
    const v = row[j]!;
    if (!known(v)) continue; // neither breaks nor extends a run
    knownSlots++;
    if (v === 0) {
      emptySlots++;
      if (run === 0) runStart = j;
      run++;
      if (run > best) { best = run; bestStart = runStart; }
    } else run = 0;
  }
  if (knownSlots === 0) return null;
  return { hours: (emptySlots * bajs.step) / HOUR_S, longestAt: bestStart < 0 ? null : bajs.t0 + bestStart * bajs.step };
}

/** The stations ranked by hours without a bike on Monday 06 to 20 h minus the same hours on Thursday 1 October (the
 *  normal day), most first (ties: more Monday hours, then the name), at most `limit`; a station without a known slot
 *  on either day is left out, and so is one that was not emptier on Monday. */
export function emptyHoursVsThu(bajs: BajsFile, stations: StationsFile, o: { monday?: number; thursday?: number; hours?: number; limit?: number } = {}): EmptyHoursRow[] {
  const monday = o.monday ?? MONDAY_SIX_S;
  const thursday = o.thursday ?? THURSDAY_SIX_S;
  const hours = o.hours ?? STATION_HOURS;
  const matrix = decodeBajs(bajs);
  const names = new Map(stations.stations.map((s) => [s.id, s.name] as const));
  const out: EmptyHoursRow[] = [];
  bajs.stations.forEach((id, i) => {
    const row = matrix[i]!;
    const mon = emptyHours(bajs, row, monday, hours);
    const thu = emptyHours(bajs, row, thursday, hours);
    if (!mon || !thu || mon.longestAt === null || mon.hours <= thu.hours) return;
    out.push({ id, name: stationName(names.get(id) ?? id), monday: mon.hours, thursday: thu.hours, atSec: mon.longestAt });
  });
  return out
    .sort((a, b) => (b.monday - b.thursday) - (a.monday - a.thursday) || b.monday - a.monday || a.name.localeCompare(b.name, 'hr'))
    .slice(0, o.limit ?? STATION_LIMIT);
}

export interface EmptiedStation { id: string; name: string; emptySec: number; atFive: number | null }

/**
 * v2's ranking, kept for its callers: the stations whose count first fell to zero after `fromSec` and before the end
 * of that Zagreb day, the earliest first, at most `limit`.
 */
export function emptiedFirst(bajs: BajsFile, stations: StationsFile, fromSec: number, limit = 10): EmptiedStation[] {
  const matrix = decodeBajs(bajs);
  const names = new Map(stations.stations.map((s) => [s.id, s.name] as const));
  const midnight = Math.floor((fromSec + ZAGREB_OFFSET_S) / DAY_S) * DAY_S - ZAGREB_OFFSET_S;
  const j0 = Math.max(0, Math.ceil((fromSec - bajs.t0) / bajs.step));
  const jEnd = Math.min(bajs.n, Math.ceil((midnight + DAY_S - bajs.t0) / bajs.step));
  const out: EmptiedStation[] = [];
  bajs.stations.forEach((id, i) => {
    const row = matrix[i]!;
    const first = row[j0];
    const atFive = first !== undefined && known(first) ? first : null;
    if (atFive === 0) return;
    let seenBikes = atFive !== null;
    for (let j = j0 + (atFive === null ? 0 : 1); j < jEnd; j++) {
      const v = row[j]!;
      if (!known(v)) continue;
      if (v === 0) {
        if (seenBikes) out.push({ id, name: names.get(id) ?? id, emptySec: bajs.t0 + j * bajs.step, atFive });
        return;
      }
      seenBikes = true;
    }
  });
  return out
    .sort((a, b) => a.emptySec - b.emptySec || (b.atFive ?? -1) - (a.atFive ?? -1) || a.name.localeCompare(b.name, 'hr'))
    .slice(0, limit);
}

export interface RouteHour { hourSec: number; seen: number | null; expected: number | null }

/** One route's vehicles per hour from `fromSec`: the most in motion in any five-minute slot of the hour and the most
 *  the timetable had; null for an hour without one known slot (or for a route the file does not carry). */
export function routeByHour(routes: RoutesLike, routeId: string, fromSec: number, hours: number): RouteHour[] {
  const i = routes.routes.findIndex((r) => r.id === routeId);
  const decoded = i < 0 ? null : decodeRoutes(routes as Parameters<typeof decodeRoutes>[0]);
  const seen = decoded?.seen[i] ?? null;
  const expected = decoded?.expected[i] ?? null;
  const out: RouteHour[] = [];
  for (let h = 0; h < hours; h++) {
    const hourSec = fromSec + h * HOUR_S;
    let s: number | null = null;
    let e: number | null = null;
    if (seen && expected) {
      const a = Math.ceil((hourSec - routes.t0) / routes.step);
      const b = Math.ceil((hourSec + HOUR_S - routes.t0) / routes.step);
      for (let j = Math.max(0, a); j < Math.min(routes.n, b); j++) {
        const sv = seen[j]!;
        const ev = expected[j]!;
        if (sv !== ROUTES_MISSING) s = Math.max(s ?? 0, sv);
        if (ev !== ROUTES_MISSING) e = Math.max(e ?? 0, ev);
      }
    }
    out.push({ hourSec, seen: s, expected: e });
  }
  return out;
}

/** Line 228 by the hour, Monday 05:00 to Wednesday 22:00 by default. */
export function route228ByHour(routes: RoutesLike, fromSec: number = LINE228_FROM_S, hours: number = LINE228_HOURS): RouteHour[] {
  return routeByHour(routes, '228', fromSec, hours);
}

/** One route's five-minute samples over a span: vehicles in motion and the timetable, null where the recording has none. */
export function routeSlots(routes: RoutesLike, routeId: string, fromSec: number = LINE228_FROM_S, toSec: number = LINE228_TO_S): { seen: (number | null)[]; expected: (number | null)[]; fromSec: number } {
  const i = routes.routes.findIndex((r) => r.id === routeId);
  const decoded = i < 0 ? null : decodeRoutes(routes as Parameters<typeof decodeRoutes>[0]);
  const j0 = Math.ceil((fromSec - routes.t0) / routes.step);
  const j1 = Math.ceil((toSec - routes.t0) / routes.step);
  const seen: (number | null)[] = [];
  const expected: (number | null)[] = [];
  for (let j = j0; j < j1; j++) {
    const inside = decoded && j >= 0 && j < routes.n;
    const sv = inside ? decoded.seen[i]![j]! : ROUTES_MISSING;
    const ev = inside ? decoded.expected[i]![j]! : ROUTES_MISSING;
    seen.push(sv === ROUTES_MISSING ? null : sv);
    expected.push(ev === ROUTES_MISSING ? null : ev);
  }
  return { seen, expected, fromSec: routes.t0 + j0 * routes.step };
}

export type PressItem = NewsFile['items'][number];

/** The press links of the block: per beat in PRESS_BEATS order, the first and the last headline in time (the beat's
 *  start and its end, at most `per`); empty beats left out. */
export function pressByBeat(news: Pick<NewsFile, 'items'>, beats: readonly string[] = PRESS_BEATS, per: number = PRESS_PER_BEAT): { beat: string; items: PressItem[] }[] {
  return beats
    .map((beat) => {
      const all = news.items.filter((i) => i.beat === beat).sort((a, b) => a.pubSec - b.pubSec);
      const items = all.length <= per ? all : per === 1 ? [all[0]!] : [...all.slice(0, per - 1), all[all.length - 1]!];
      return { beat, items };
    })
    .filter((g) => g.items.length > 0);
}

// ---- the stage hook ----------------------------------------------------------------------

/** Pauses the replay, seeks it (epoch seconds) when given an instant, and brings the instrument into view: the stage
 *  section (#snimka) carries the scroll margin of the sticky nav, so the instrument never lands under it. */
export function showOnStage(ctx: Pick<SnimkaContext, 'clock' | 'doc' | 'reducedMotion'>, atSec: number | null): void {
  ctx.clock.pause();
  if (atSec !== null) ctx.clock.seek(atSec * 1000);
  const stage = ctx.doc.querySelector<HTMLElement>('#snimka') ?? ctx.doc.querySelector<HTMLElement>('[data-sn-stage]');
  stage?.scrollIntoView?.({ block: 'start', behavior: ctx.reducedMotion ? 'auto' : 'smooth' });
}

const bound = new WeakSet<HTMLElement>();

/** Binds the tiles' buttons (data-sn-seek, epoch seconds) under `row` once: a click hands the moment to `onSeek`. */
export function bindTileSeeks(row: HTMLElement, onSeek: (atSec: number) => void): void {
  if (bound.has(row)) return;
  bound.add(row);
  row.addEventListener('click', (e) => {
    const button = (e.target as Element | null)?.closest?.<HTMLElement>('[data-sn-seek]');
    const at = Number(button?.dataset.snSeek);
    if (button && Number.isFinite(at)) onSeek(at);
  });
}

// ---- the blocks ------------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const hoursText = (h: number): string => (Number.isInteger(h) ? num(h) : h.toLocaleString('hr-HR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

function stationsTable(ctx: SnimkaContext, rows: readonly EmptyHoursRow[]): HTMLElement {
  const doc = ctx.doc;
  if (rows.length === 0) return empty(A.bikesNone);
  const wrap = el(doc, 'div', 'st-table sn-small-table sn-alt-table');
  const scroll = el(doc, 'div', 'st-table-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', A.bikes);
  const table = el(doc, 'table');
  table.innerHTML = `<caption class="visually-hidden">${escapeHtml(A.bikes)}</caption><thead><tr>` +
    `<th scope="col">${escapeHtml(A.station)}</th><th scope="col" class="sn-alt-num">${escapeHtml(A.emptyMon)}</th><th scope="col" class="sn-alt-num">${escapeHtml(A.emptyThu)}</th><th scope="col" class="sn-alt-action"><span class="visually-hidden">${escapeHtml(A.showOnMap)}</span></th></tr></thead>`;
  const body = el(doc, 'tbody');
  for (const r of rows) {
    const tr = el(doc, 'tr');
    tr.dataset.station = r.id;
    const show = (): void => {
      ctx.view.set({ subject: { kind: 'station', id: r.id } }, 'user');
      showOnStage(ctx, r.atSec);
    };
    const label = fill(A.showOnMapNamed, { action: A.showOnMap, name: r.name });
    // The name is the button on a phone, where the action column is hidden; on wider screens the name is text and
    // the column holds the button. The sheet shows one of the two (display: none takes the other out of the tab
    // order), so a keyboard meets each row once.
    const name = el(doc, 'th', 'sn-alt-name');
    name.scope = 'row';
    const nameButton = el(doc, 'button', 'sn-alt-name-button', r.name);
    nameButton.type = 'button';
    nameButton.setAttribute('aria-label', label);
    nameButton.addEventListener('click', show);
    name.append(el(doc, 'span', 'sn-alt-name-text', r.name), nameButton);
    const mon = el(doc, 'td', 'sn-alt-num', hoursText(r.monday));
    const thu = el(doc, 'td', 'sn-alt-num', hoursText(r.thursday));
    const action = el(doc, 'td', 'sn-alt-action');
    const button = el(doc, 'button', 'btn-quiet sn-alt-show', A.showOnMap);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.addEventListener('click', show);
    action.append(button);
    tr.append(name, mon, thu, action);
    body.append(tr);
  }
  table.append(body);
  scroll.append(table);
  wrap.append(scroll);
  return wrap;
}

function line228Block(ctx: SnimkaContext): HTMLElement[] {
  const slots = routeSlots(ctx.routes, '228');
  if (!slots.seen.some((v) => v !== null)) return [empty(SN.strip.noValue)];
  const n = slots.seen.length;
  const max = Math.max(1, colMax(slots.seen, slots.expected));
  const ticks: { x: number; label: string }[] = [];
  for (let k = 0; k < n; k++) {
    const sec = slots.fromSec + k * ctx.routes.step;
    if ((sec + ZAGREB_OFFSET_S) % DAY_S === 0 || k === 0) ticks.push({ x: k / n, label: k === 0 ? zagrebDateTime(sec * 1000) : zagrebDay(sec * 1000) });
  }
  const chart = miniPlot(ctx.doc, {
    series: [
      { values: slots.expected, kind: 'area', tone: 'sn-card-tone-expected', label: A.line228Expected },
      { values: slots.seen, kind: 'line', tone: 'sn-card-tone-seen', label: SN.strip.fleetSeen },
    ],
    max, scale: num(max), ticks, label: A.line228Lede,
  });
  chart.classList.add('sn-alt-plot');
  const hours = route228ByHour(ctx.routes);
  const twin = tableDetails(fill(SN.strip.tableCaption, { title: A.line228 }), [A.line228Hour, A.line228Seen, A.line228Expected],
    hours.map((h) => [zagrebDateTime(h.hourSec * 1000), h.seen === null ? SN.strip.noValue : num(h.seen), h.expected === null ? SN.strip.noValue : num(h.expected)]), SN.strip.table);
  const out: HTMLElement[] = [chart, twin];
  const notice = ctx.notices.items.find((x) => x.id === 10166);
  if (notice) {
    const p = el(ctx.doc, 'p', 'sn-alt-source');
    p.innerHTML = `<a class="st-link sn-alt-link" href="${escapeHtml(notice.link)}" rel="noopener noreferrer" target="_blank">${escapeHtml(A.line228Notice)}<span class="visually-hidden"> ${escapeHtml(SN.news.newTab)}</span><span aria-hidden="true"> ↗</span></a>`;
    out.push(p);
  }
  return out;
}

function pressBlock(ctx: SnimkaContext): HTMLElement {
  const groups = pressByBeat(ctx.news);
  if (groups.length === 0) return empty(A.pressNone);
  const beats = A.beat as Record<string, string>;
  const wrap = el(ctx.doc, 'div', 'sn-alt-press');
  wrap.innerHTML = groups
    .map((g) => `<section class="sn-alt-beat" data-beat="${escapeHtml(g.beat)}" aria-label="${escapeHtml(beats[g.beat] ?? g.beat)}"><h4>${escapeHtml(beats[g.beat] ?? g.beat)}</h4><ul class="sn-alt-links">` +
      g.items.map((i) => `<li><a class="sn-alt-link" href="${escapeHtml(i.link)}" rel="noopener noreferrer" target="_blank">${escapeHtml(i.title)}<span class="visually-hidden"> ${escapeHtml(SN.news.newTab)}</span></a>` +
        `<span class="sn-alt-meta">${escapeHtml(fill(A.pressMeta, { outlet: ctx.news.outlets[i.outlet]?.name ?? i.outlet, time: zagrebDateTime(i.pubSec * 1000) }))}</span></li>`).join('') +
      '</ul></section>')
    .join('');
  return wrap;
}

const decodeBajsFile = (raw: unknown): BajsFile => {
  if (!isBajsFile(raw)) throw new SnimkaError('bajs: not a bajs file');
  return raw;
};
const decodeStations = (raw: unknown): StationsFile => {
  if (!isStationsFile(raw)) throw new SnimkaError('stations: not a stations file');
  return raw;
};

/** Runs `fn` once when `root` comes near the viewport (or at once without IntersectionObserver); returns the teardown. */
function whenNear(root: HTMLElement, fn: () => void): () => void {
  const IO = (root.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.IntersectionObserver;
  if (!IO) { fn(); return () => {}; }
  const io = new IO((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    fn();
  }, { rootMargin: '600px 0px' });
  io.observe(root);
  return () => io.disconnect();
}

export const mountAlternatives: Mount = (ctx, root) => {
  let disposed = false;
  // The tiles of the same section seek through the same hook (idempotent: mountReckoning may bind them too).
  const kpis = ctx.doc.querySelector<HTMLElement>('[data-sn="kpis"]');
  if (kpis) bindTileSeeks(kpis, (atSec) => showOnStage(ctx, atSec));

  const grid = ctx.doc.createElement('div');
  grid.className = 'st-grid sn-alt-grid';
  const bikesBody = ctx.doc.createElement('div');
  bikesBody.className = 'sn-alt-bikes';
  bikesBody.setAttribute('aria-busy', 'true');
  const sk = ctx.doc.createElement('span');
  sk.className = 'skeleton sn-skeleton-card';
  bikesBody.append(sk);
  const bikes = card({ id: 'zamjene-bajs', title: A.bikes, body: [bikesBody], method: A.bikesMethod, wide: true });
  const line = card({ id: 'zamjene-228', title: A.line228, lede: A.line228Lede, body: line228Block(ctx), wide: true });
  const press = card({ id: 'zamjene-mediji', title: A.press, body: [pressBlock(ctx)], wide: true });
  grid.append(bikes, line, press);
  root.replaceChildren(grid);
  root.removeAttribute('aria-busy');
  root.dataset.snAlternatives = 'ready';

  const stop = whenNear(root, () => {
    Promise.all([ctx.data.get(ctx.manifest.files.bajs, decodeBajsFile), ctx.data.get(ctx.manifest.files.stations, decodeStations)]).then(
      ([bajs, stations]) => {
        if (disposed) return;
        bikesBody.replaceChildren(stationsTable(ctx, emptyHoursVsThu(bajs, stations)));
        bikesBody.removeAttribute('aria-busy');
      },
      () => {
        if (disposed) return;
        bikesBody.replaceChildren(empty(SN.error.load));
        bikesBody.removeAttribute('aria-busy');
      },
    );
  });

  return () => {
    disposed = true;
    stop();
    delete root.dataset.snAlternatives;
  };
};
