// The faces of the deck: one headline figure, its label and one subline
// (the delta against the normal day), per panel (plan sections 3.1 and 3.2).
// The text model is pure (stateText, vehiclesText, linesText, bikesText,
// weatherText, dataPathText) so the tests read the words without a DOM; the
// faces write it by textContent only, and only when the minute (or the
// five-minute sample) changes. Missing is never zero: a null reads
// "bez podatka". The depths are built by panel-depths.ts through the
// mounter the stage hands in, so this file never imports the depths.
import { ROUTES_STEP_S, type SeriesFile, type SnimkaState } from '../../../shared/snimka';
import { comparisonFor, comparisonMinute, type SnimkaContext } from './context';
import type { PanelId, PanelSpec, RoutesLike } from './contracts';
import { count, duration, num } from './format';
import { aliveStates, routeSlotAt } from './live-network';
import { el } from './panels';
import { SN, fill } from './strings';

const NV = SN.facts.none;
const nv = (v: number | null | undefined): string => (v === null || v === undefined ? NV : num(v));

/** The series' minute holding `atSec`, the last minute at the window's end, or null outside the file. */
export function minuteIn(s: Pick<SeriesFile, 't0' | 'n'>, atSec: number): number | null {
  const m = Math.floor((atSec - s.t0) / 60);
  if (m === s.n && s.n > 0) return s.n - 1;
  return m >= 0 && m < s.n ? m : null;
}

const at = <T,>(col: readonly (T | null)[] | null | undefined, m: number | null): T | null => (col && m !== null ? (col[m] ?? null) : null);

// ---- Stanje -----------------------------------------------------------------------------------

/** The badge's tone per state: a word and a shape, never colour alone (base.css .badge). */
export const STATE_TONE: Record<SnimkaState, string> = { normal: 'live', reduced: 'stale', silent: 'down', unknown: 'info' };
const STATE_WORD: Record<SnimkaState, string> = { normal: SN.badge.normal, reduced: SN.badge.reduced, silent: SN.badge.silent, unknown: SN.badge.unknown };

export interface StateText { state: SnimkaState | null; word: string; tone: string; retro: boolean; sub: string }

/** The state word with its tone, the "naknadno" mark before the service went live, and the counts or the hold as the subline. */
export function stateText(s: SeriesFile, atSec: number, serviceLiveFromSec: number): StateText {
  const m = minuteIn(s, atSec);
  const state = at(s.service.state, m);
  const seen = at(s.seen.all, m);
  const expected = at(s.expected.all, m);
  const since = at(s.service.since, m);
  const word = state ? STATE_WORD[state] : NV;
  const tone = state ? STATE_TONE[state] : 'info';
  let sub: string;
  if (seen === null) sub = since !== null && since <= atSec ? fill(SN.badge.holds, { duration: duration((atSec - since) * 1000) }) : NV;
  else if (expected === null) sub = fill(SN.badge.countsNoExpected, { seen: num(seen) });
  else sub = fill(SN.badge.counts, { seen: num(seen), expected: num(expected) });
  return { state, word, tone, retro: atSec < serviceLiveFromSec, sub };
}

/**
 * The data-path line of the Stanje depth (decision S-18): what ZET sent, what was in the depots and parked,
 * what moved and what the screen said. Shown only when those numbers part by two or more (otherwise the path
 * is the plain one and the line says nothing); null then, and null where nothing was recorded.
 */
export function dataPathText(s: SeriesFile, atSec: number): string | null {
  const m = minuteIn(s, atSec);
  const entities = at(s.feed.entities, m);
  const seen = at(s.seen.all, m);
  const published = at(s.published?.vehicles, m);
  const known = [entities, seen, published].filter((v): v is number => v !== null);
  if (known.length < 2 || Math.max(...known) - Math.min(...known) < 2) return null;
  return fill(SN.readout.dataPath, {
    entities: nv(entities), depot: nv(at(s.feed.hiddenDepot, m)), parked: nv(at(s.feed.hiddenParked, m)), seen: nv(seen), published: nv(published),
  });
}

// ---- Vozila -------------------------------------------------------------------------------------

export interface VehiclesText { figure: string; sub: string; line: string }

/** "u pokretu 2 · običan dan 394 · po voznom redu 449": the figure is the first number, the subline the other two. */
export function vehiclesText(s: SeriesFile, normalSeen: number | null, atSec: number): VehiclesText {
  const m = minuteIn(s, atSec);
  const seen = at(s.seen.all, m);
  const expected = at(s.expected.all, m);
  const sub = `${SN.readout.normal} ${nv(normalSeen)} · ${SN.readout.expected} ${nv(expected)}`;
  return { figure: nv(seen), sub, line: `${SN.readout.moving} ${nv(seen)} · ${sub}` };
}

/** The normal day's fleet at the same time of day (the weekday-matched comparison, S-12), or null. */
export function normalSeenAt(ctx: Pick<SnimkaContext, 'comparisons'>, atSec: number): number | null {
  if (!ctx.comparisons.length) return null;
  const m = comparisonMinute(ctx, atSec);
  return m === null ? null : (comparisonFor(ctx, atSec).series.seen.all[m] ?? null);
}

// ---- Linije --------------------------------------------------------------------------------------

export interface LinesText { alive: number | null; scheduled: number | null; figure: string; sub: string }

/** "{alive} od {scheduled} linija po voznom redu ima vozilo": of the routes scheduled in all of the last three samples or alive, how many had a vehicle (S-16). */
export function linesText(routes: RoutesLike, atSec: number): LinesText {
  if (routeSlotAt(routes, atSec) < 0) return { alive: null, scheduled: null, figure: NV, sub: NV };
  let alive = 0;
  let dead = 0;
  for (const state of aliveStates(routes, atSec).values()) {
    if (state === 'alive') alive += 1;
    else if (state === 'dead') dead += 1;
  }
  const scheduled = alive + dead;
  return { alive, scheduled, figure: num(alive), sub: fill(SN.readout.linesCount, { alive: num(alive), scheduled: num(scheduled) }) };
}

// ---- Bicikli and Vrijeme -------------------------------------------------------------------------

/** "989 bicikala" and "84 praznih stanica", "bez podatka" for a missing minute. */
export function bikesText(s: SeriesFile, atSec: number): { figure: string; sub: string } {
  const m = minuteIn(s, atSec);
  const total = at(s.bikes?.total, m);
  const empty = at(s.bikes?.empty, m);
  return {
    figure: total === null ? NV : count(total, SN.readout.bikesForms),
    sub: empty === null ? NV : count(empty, SN.readout.emptyForms),
  };
}

/** "12 °C, vedro" with DHMZ's words verbatim; the temperature alone, the words alone, or "bez podatka DHMZ-a". */
export function weatherText(s: Pick<SeriesFile, 'hourly'>, atSec: number): string {
  const h = Math.floor((atSec - s.hourly.t0) / 3600);
  const inside = h >= 0 && h < s.hourly.n;
  const temp = inside ? (s.hourly.tempC[h] ?? null) : null;
  const words = inside ? (s.hourly.weather[h] ?? null) : null;
  if (temp === null && !words) return SN.readout.weatherNone;
  if (temp === null) return words!;
  const t = num(Math.round(temp));
  return words ? fill(SN.readout.weather, { temp: t, words }) : fill(SN.readout.weatherTempOnly, { temp: t });
}

// ---- the faces --------------------------------------------------------------------------------------

/** Builds a panel's depth into an element and returns its teardown (panel-depths.ts, handed in by the stage). */
export type DepthMounter = (id: PanelId, el: HTMLElement) => (() => void) | Promise<() => void>;

interface FaceParts { fig: HTMLElement; sub: HTMLElement }

function faceParts(face: HTMLElement, title: string, id: PanelId): FaceParts {
  const doc = face.ownerDocument;
  const fig = el(doc, 'span', { class: 'sn-panel-fig', 'data-sn-ro': id });
  const sub = el(doc, 'span', { class: 'sn-panel-sub' });
  face.replaceChildren(el(doc, 'span', { class: 'sn-panel-name', text: title }), fig, sub);
  return { fig, sub };
}

const set = (node: HTMLElement, text: string): void => { if (node.textContent !== text) node.textContent = text; };

/** The six panel specs of the shell, in the deck's order (V4's Poglavlja comes last). */
export function readoutSpecs(ctx: SnimkaContext, depth: DepthMounter = () => () => {}, teardowns: (() => void)[] = []): PanelSpec[] {
  const s = ctx.series;
  const liveFrom = ctx.manifest.serviceLiveFromSec;
  const specs: PanelSpec[] = [];
  const fig: Partial<Record<PanelId, HTMLElement>> = {};
  const spec = (id: PanelId, title: string, mountFace: (face: HTMLElement) => (t: number) => void): void => {
    specs.push({ id, title, mountFace, mountDepth: (host) => depth(id, host), spotTarget: () => fig[id] ?? null });
  };
  const minuteKey = (t: number): string => String(Math.floor(t / 60_000));

  spec('stanje', SN.panel.state, (face) => {
    const doc = face.ownerDocument;
    const parts = faceParts(face, SN.panel.state, 'stanje');
    fig.stanje = parts.fig;
    const word = el(doc, 'span', { class: 'badge sn-panel-badge', 'data-sn': 'state-word' });
    const retro = el(doc, 'span', { class: 'sn-panel-retro', 'data-sn': 'retro', text: SN.badge.retroShort, hidden: true });
    parts.fig.append(word, ' ', retro);
    let last = '';
    return (t) => {
      const key = minuteKey(t);
      if (key === last) return;
      last = key;
      const r = stateText(s, t / 1000, liveFrom);
      set(word, r.word);
      word.dataset.tone = r.tone;
      word.dataset.state = r.state ?? 'none';
      retro.hidden = !r.retro;
      set(parts.sub, r.sub);
    };
  });

  spec('vozila', SN.panel.vehicles, (face) => {
    const parts = faceParts(face, SN.panel.vehicles, 'vozila');
    fig.vozila = parts.fig;
    const value = el(face.ownerDocument, 'span', { class: 'sn-panel-num' });
    const label = el(face.ownerDocument, 'span', { class: 'sn-panel-unit', text: SN.readout.moving });
    parts.fig.append(value, ' ', label);
    let last = '';
    return (t) => {
      const key = minuteKey(t);
      if (key === last) return;
      last = key;
      const r = vehiclesText(s, normalSeenAt(ctx, t / 1000), t / 1000);
      set(value, r.figure);
      set(parts.sub, r.sub);
    };
  });

  spec('linije', SN.panel.lines, (face) => {
    const parts = faceParts(face, SN.panel.lines, 'linije');
    fig.linije = parts.fig;
    let last = '';
    return (t) => {
      const key = String(Math.floor(t / 1000 / ROUTES_STEP_S));
      if (key === last) return;
      last = key;
      const r = linesText(ctx.routes, t / 1000);
      set(parts.fig, r.figure);
      set(parts.sub, r.sub);
    };
  });

  spec('mreza', SN.panel.network, (face) => {
    const parts = faceParts(face, SN.panel.network, 'mreza');
    fig.mreza = parts.fig;
    parts.fig.classList.add('sn-panel-minis');
    parts.fig.setAttribute('aria-hidden', 'true');
    set(parts.sub, SN.twins.title);
    // The two minimaps (V2) follow the clock themselves; minimap.ts stays off the entry graph.
    let off: (() => void) | null = null;
    let gone = false;
    teardowns.push(() => { gone = true; off?.(); off = null; });
    if (!ctx.lagano) {
      void import('./minimap').then(({ mountMinimaps }) => {
        if (!gone) off = mountMinimaps(ctx, parts.fig, { large: false });
      }, () => {});
    }
    return () => {};
  });

  spec('bicikli', SN.panel.bikes, (face) => {
    const parts = faceParts(face, SN.panel.bikes, 'bicikli');
    fig.bicikli = parts.fig;
    let last = '';
    return (t) => {
      const key = minuteKey(t);
      if (key === last) return;
      last = key;
      const r = bikesText(s, t / 1000);
      set(parts.fig, r.figure);
      set(parts.sub, r.sub);
    };
  });

  spec('vrijeme', SN.panel.weather, (face) => {
    const parts = faceParts(face, SN.panel.weather, 'vrijeme');
    fig.vrijeme = parts.fig;
    set(parts.sub, SN.readout.weatherSource);
    let last = '';
    return (t) => {
      const key = String(Math.floor(t / 3_600_000));
      if (key === last) return;
      last = key;
      set(parts.fig, weatherText(s, t / 1000));
    };
  });

  return specs;
}
