// Zamjene (question q1, "Što sam mogao umjesto tramvaja?"): the BAJS stations
// that emptied first on Monday, the train in the screen's header, line 228 by
// the hour, and what the press recorded about taxis, volunteers, schools,
// traffic and bikes (plan section 4). Every number comes from the dataset by
// a pure function below, with its method line under it on the page; the
// press items are titles and links only (decision S-2).
//
// Missing is never zero: a slot the recording lacks (255) or a station that
// was not renting (254) is no count, an hour without one known slot is null
// and reads as a gap, never a 0.
import { SNIMKA_WINDOW, ZAGREB_OFFSET_S, isBajsFile, isScreenIndex, isStationsFile, type BajsFile, type NewsFile, type ScreenIndex, type StationsFile } from '../../../shared/snimka';
import { BAJS_MISSING, BAJS_NOT_RENTING, ROUTES_MISSING, SnimkaError, decodeBajs, decodeRoutes } from '../../../shared/snimka-codec';
import { card, columns, empty, tableDetails } from '../statistika/charts';
import { escapeHtml } from '../ui/dom/escape';
import type { Mount, SnimkaContext } from './context';
import type { RoutesLike } from './contracts';
import { num, zagrebClock, zagrebDateTime, zagrebDay } from './format';
import { SN, fill } from './strings';

const A = SN.alternatives;
const HOUR_S = 3600;
const DAY_S = 86_400;

/** Strings Appendix B lacks (new for the read-through; the orchestrator may move them into strings.ts). */
export const ALTERNATIVES_TEXT = {
  /** The aria-label of a row's button: "Pokaži na karti: Stanica 3". */
  showOnMapNamed: '{action}: {name}',
  /** The column head of line 228's table twin and its readout. */
  line228Hour: 'Sat',
  line228Seen: 'najviše vozila u pokretu',
  line228Expected: 'po voznom redu',
  line228Value: '{n} u pokretu',
  line228Summary: 'Najviše {n} vozila linije 228 u pokretu u jednom satu.',
  line228Notice: 'Obavijest ZET-a 10166',
  railNone: 'U zapisima zaslona nema rečenice o vlaku.',
  bikesNone: 'U ponedjeljak se nijedna stanica nije ispraznila nakon 05:00.',
  pressNone: 'Za ove teme nema odabranog naslova.',
  pressMeta: '{outlet} · {time}',
} as const;
const T = ALTERNATIVES_TEXT;

/** Monday 28 September 05:00 Zagreb: the first morning without trams, from which the stations are watched. */
export const MONDAY_FIVE_S = Date.UTC(2026, 8, 28, 5, 0) / 1000 - ZAGREB_OFFSET_S;
/** Tuesday 29 September 00:00 Zagreb: line 228 is drawn from here (its first trips ran that morning). */
export const TUESDAY_S = Date.UTC(2026, 8, 29, 0, 0) / 1000 - ZAGREB_OFFSET_S;
/** Line 228 is drawn for 48 hours, to the Thursday midnight after the return. */
export const LINE228_HOURS = 48;
/** The beats of the press list, in the order the section names them. */
export const PRESS_BEATS = ['taksi', 'volonteri', 'skole', 'guzve', 'bajs'] as const;

const midnightOf = (sec: number): number => Math.floor((sec + ZAGREB_OFFSET_S) / DAY_S) * DAY_S - ZAGREB_OFFSET_S;
const known = (v: number): boolean => v !== BAJS_MISSING && v !== BAJS_NOT_RENTING;

// ---- the pure functions --------------------------------------------------------------

export interface EmptiedStation { id: string; name: string; emptySec: number; atFive: number | null }

/**
 * The stations whose count first fell to zero after `fromSec` and before the end of that Zagreb day, the earliest
 * first (ties: the fuller one at `fromSec` first, then by name), at most `limit`. A station already empty at `fromSec`
 * (or at its first known slot after it) is not one that emptied; a missing or not-renting slot neither empties nor
 * refills a station.
 */
export function emptiedFirst(bajs: BajsFile, stations: StationsFile, fromSec: number, limit = 10): EmptiedStation[] {
  const matrix = decodeBajs(bajs);
  const names = new Map(stations.stations.map((s) => [s.id, s.name] as const));
  const j0 = Math.max(0, Math.ceil((fromSec - bajs.t0) / bajs.step));
  const jEnd = Math.min(bajs.n, Math.ceil((midnightOf(fromSec) + DAY_S - bajs.t0) / bajs.step));
  const out: EmptiedStation[] = [];
  bajs.stations.forEach((id, i) => {
    const row = matrix[i]!;
    const first = row[j0];
    const atFive = first !== undefined && known(first) ? first : null;
    if (atFive === 0) return; // already empty at fromSec: it did not empty after it
    let seenBikes = atFive !== null;
    for (let j = j0 + (atFive === null ? 0 : 1); j < jEnd; j++) {
      const v = row[j]!;
      if (!known(v)) continue;
      if (v === 0) {
        // Empty at its first known slot: it did not empty after fromSec either.
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

export interface RailDay { day: number; count: number; runs: number }

/** The screen header's rail sentences per Zagreb day of the recorded runs (`summary.sentences.rail`); a day with a run
 *  and no such sentence is a counted zero, a day without a run is not listed. */
export function railByDay(index: ScreenIndex): RailDay[] {
  const days = new Map<number, RailDay>();
  for (const run of index.runs) {
    const day = midnightOf(run.fromSec);
    const row = days.get(day) ?? { day, count: 0, runs: 0 };
    row.runs++;
    const n = run.summary.sentences.rail;
    if (typeof n === 'number' && n > 0) row.count += n;
    days.set(day, row);
  }
  return [...days.values()].sort((a, b) => a.day - b.day);
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

/** Line 228 by the hour from Tuesday 29 September (plan section 4). */
export function route228ByHour(routes: RoutesLike, fromSec: number = TUESDAY_S, hours: number = LINE228_HOURS): RouteHour[] {
  return routeByHour(routes, '228', fromSec, hours);
}

export type PressItem = NewsFile['items'][number];

/** The headlines of the press beats, grouped in PRESS_BEATS order, each group in time order; empty groups left out. */
export function pressByBeat(news: Pick<NewsFile, 'items'>, beats: readonly string[] = PRESS_BEATS): { beat: string; items: PressItem[] }[] {
  return beats
    .map((beat) => ({ beat, items: news.items.filter((i) => i.beat === beat).sort((a, b) => a.pubSec - b.pubSec) }))
    .filter((g) => g.items.length > 0);
}

// ---- the stage hook ----------------------------------------------------------------------

/** Pauses the replay, seeks it (epoch seconds) when given an instant, and brings the instrument into view. */
export function showOnStage(ctx: Pick<SnimkaContext, 'clock' | 'doc' | 'reducedMotion'>, atSec: number | null): void {
  ctx.clock.pause();
  if (atSec !== null) ctx.clock.seek(atSec * 1000);
  const stage = ctx.doc.querySelector<HTMLElement>('[data-sn-stage]') ?? ctx.doc.querySelector<HTMLElement>('#snimka');
  stage?.scrollIntoView?.({ block: 'start', behavior: ctx.reducedMotion ? 'auto' : 'smooth' });
}

// ---- the blocks ------------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function bikesTable(ctx: SnimkaContext, rows: readonly EmptiedStation[]): HTMLElement {
  const doc = ctx.doc;
  if (rows.length === 0) return empty(T.bikesNone);
  const wrap = el(doc, 'div', 'st-table sn-small-table sn-alt-table');
  const scroll = el(doc, 'div', 'st-table-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', A.bikes);
  const table = el(doc, 'table');
  table.innerHTML = `<caption class="visually-hidden">${escapeHtml(A.bikes)}</caption><thead><tr>` +
    `<th scope="col">${escapeHtml(A.station)}</th><th scope="col">${escapeHtml(A.emptyFrom)}</th><th scope="col">${escapeHtml(A.bikesAtFive)}</th><th scope="col"><span class="visually-hidden">${escapeHtml(A.showOnMap)}</span></th></tr></thead>`;
  const body = el(doc, 'tbody');
  for (const r of rows) {
    const tr = el(doc, 'tr');
    tr.dataset.station = r.id;
    const name = el(doc, 'th', undefined, r.name);
    name.scope = 'row';
    const when = el(doc, 'td', 'sn-alt-num', zagrebClock(r.emptySec * 1000));
    const five = el(doc, 'td', 'sn-alt-num', r.atFive === null ? SN.strip.noValue : num(r.atFive));
    const action = el(doc, 'td');
    const button = el(doc, 'button', 'btn-quiet sn-alt-show', A.showOnMap);
    button.type = 'button';
    button.setAttribute('aria-label', fill(T.showOnMapNamed, { action: A.showOnMap, name: r.name }));
    button.addEventListener('click', () => {
      ctx.view.set({ subject: { kind: 'station', id: r.id } }, 'user');
      showOnStage(ctx, r.emptySec);
    });
    action.append(button);
    tr.append(name, when, five, action);
    body.append(tr);
  }
  table.append(body);
  scroll.append(table);
  wrap.append(scroll);
  return wrap;
}

function railBlock(index: ScreenIndex | null, failed: boolean): HTMLElement {
  if (failed) return empty(SN.error.load);
  if (!index) {
    const sk = document.createElement('span');
    sk.className = 'skeleton sn-skeleton-card';
    return sk;
  }
  const days = railByDay(index);
  if (!days.some((d) => d.count > 0)) return empty(T.railNone);
  const list = document.createElement('ul');
  list.className = 'sn-alt-days';
  list.innerHTML = days
    .map((d) => `<li data-day="${d.day}"><span class="sn-alt-day">${escapeHtml(zagrebDay(d.day * 1000))}</span> <span class="sn-alt-num">${escapeHtml(fill(A.railValue, { count: num(d.count) }))}</span></li>`)
    .join('');
  return list;
}

function line228Block(ctx: SnimkaContext): HTMLElement[] {
  const hours = route228ByHour(ctx.routes);
  if (!hours.some((h) => h.seen !== null)) return [empty(SN.strip.noValue)];
  const max = Math.max(0, ...hours.map((h) => h.seen ?? 0));
  const names = hours.map((h) => zagrebDateTime(h.hourSec * 1000));
  const ticks = hours.flatMap((h, i) => (i % 12 === 0 ? [{ index: i, label: `${zagrebDay(h.hourSec * 1000)} ${zagrebClock(h.hourSec * 1000)}` }] : []));
  const chart = columns({
    values: hours.map((h) => h.seen), names, ticks, label: A.line228,
    valueText: (v) => fill(T.line228Value, { n: num(v) }),
    summary: fill(T.line228Summary, { n: num(max) }),
    nullText: SN.strip.noValue,
  });
  chart.classList.add('sn-alt-cols');
  const twin = tableDetails(A.line228, [T.line228Hour, T.line228Seen, T.line228Expected],
    hours.map((h, i) => [names[i]!, h.seen === null ? SN.strip.noValue : num(h.seen), h.expected === null ? SN.strip.noValue : num(h.expected)]));
  const out: HTMLElement[] = [chart, twin];
  const notice = ctx.notices.items.find((n) => n.id === 10166);
  if (notice) {
    const p = document.createElement('p');
    p.className = 'sn-alt-source';
    p.innerHTML = `<a class="st-link" href="${escapeHtml(notice.link)}" rel="noopener noreferrer" target="_blank">${escapeHtml(T.line228Notice)}<span class="visually-hidden"> ${escapeHtml(SN.news.newTab)}</span><span aria-hidden="true">↗</span></a>`;
    out.push(p);
  }
  return out;
}

function pressBlock(ctx: SnimkaContext): HTMLElement {
  const groups = pressByBeat(ctx.news);
  if (groups.length === 0) return empty(T.pressNone);
  const beats = SN.voices.beat as Record<string, string>;
  const wrap = document.createElement('div');
  wrap.className = 'sn-alt-press';
  wrap.innerHTML = groups
    .map((g) => `<section class="sn-alt-beat" data-beat="${escapeHtml(g.beat)}" aria-label="${escapeHtml(beats[g.beat] ?? g.beat)}"><h4>${escapeHtml(beats[g.beat] ?? g.beat)}</h4><ul class="sn-alt-links">` +
      g.items.map((i) => `<li><a class="sn-alt-link" href="${escapeHtml(i.link)}" rel="noopener noreferrer" target="_blank">${escapeHtml(i.title)}<span class="visually-hidden"> ${escapeHtml(SN.news.newTab)}</span></a>` +
        `<span class="sn-alt-meta">${escapeHtml(fill(T.pressMeta, { outlet: ctx.news.outlets[i.outlet]?.name ?? i.outlet, time: zagrebDateTime(i.pubSec * 1000) }))}</span></li>`).join('') +
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
const decodeIndex = (raw: unknown): ScreenIndex => {
  if (!isScreenIndex(raw)) throw new SnimkaError('screen index: not a screen index');
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
  const grid = ctx.doc.createElement('div');
  grid.className = 'st-grid sn-alt-grid';

  const bikesBody = ctx.doc.createElement('div');
  bikesBody.className = 'sn-alt-bikes';
  bikesBody.setAttribute('aria-busy', 'true');
  const sk = ctx.doc.createElement('span');
  sk.className = 'skeleton sn-skeleton-card';
  bikesBody.append(sk);
  const bikes = card({ id: 'zamjene-bajs', title: A.bikes, body: [bikesBody], method: A.bikesMethod, wide: true });

  const railBody = ctx.doc.createElement('div');
  railBody.append(railBlock(null, false));
  const rail = card({ id: 'zamjene-vlak', title: A.rail, body: [railBody], method: A.railMethod });
  const line = card({ id: 'zamjene-228', title: A.line228, body: line228Block(ctx), method: A.line228Method });
  const press = card({ id: 'zamjene-mediji', title: A.press, lede: A.pressLede, body: [pressBlock(ctx)], wide: true });
  grid.append(bikes, line, rail, press);
  root.replaceChildren(grid);
  root.removeAttribute('aria-busy');
  root.dataset.snAlternatives = 'ready';

  ctx.data.get(ctx.manifest.files.screenIndex, decodeIndex).then(
    (index) => { if (!disposed) railBody.replaceChildren(railBlock(index, false)); },
    () => { if (!disposed) railBody.replaceChildren(railBlock(null, true)); },
  );

  const stop = whenNear(root, () => {
    Promise.all([ctx.data.get(ctx.manifest.files.bajs, decodeBajsFile), ctx.data.get(ctx.manifest.files.stations, decodeStations)]).then(
      ([bajs, stations]) => {
        if (disposed) return;
        const from = Math.max(MONDAY_FIVE_S, SNIMKA_WINDOW.fromSec);
        bikesBody.replaceChildren(bikesTable(ctx, emptiedFirst(bajs, stations, from)));
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
