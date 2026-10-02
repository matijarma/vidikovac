// The faces of the deck (decisions V3-14, V3-15): three panels, each setting
// the instant against a normal day so the anomaly reads in two seconds.
// Vozila: the state badge, "4 u pokretu" and the two-bar glyph against the
// weekday-matched normal day, the subline "običan dan (pon 21. 9.) u isto
// doba: 321". Mreža: the twin minimaps with their counts in the captions
// (minimap.ts; one definition of scheduled, live-network.ts scheduledCount).
// Bicikli: the empty stations against Thursday 1 October's same minute (the
// only normal day with BAJS data), the bikes in the subline.
// The text model is pure (vozilaFace, mrezaFace, bicikliFace, bar2Widths,
// bikesReference, dataPathText) so the tests read the words without a DOM;
// the faces write by textContent and bar widths only, and only when the
// minute (or the five-minute sample) changes. Missing is never zero: a null
// reads "bez podatka" and a glyph without a figure draws no fill.
import { ROUTES_STEP_S, ZAGREB_OFFSET_S, type SeriesFile, type SnimkaState } from '../../../shared/snimka';
import { comparisonFor, comparisonMinute, type SnimkaContext } from './context';
import type { PanelId, PanelSpec, RoutesLike } from './contracts';
import { count, num, zagrebDateTime, zagrebDay } from './format';
import { networkCounts } from './live-network';
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
const zagrebWeekday = (atSec: number): number => new Date((atSec + ZAGREB_OFFSET_S) * 1000).getUTCDay();
const timeOfDay = (atSec: number): number => (((Math.floor(atSec) + ZAGREB_OFFSET_S) % 86_400) + 86_400) % 86_400;
/** Zagreb wall time as a UTC second (CEST throughout the window). */
const zg = (month: number, day: number, hour = 0, minute = 0): number => Date.UTC(2026, month - 1, day, hour, minute) / 1000 - ZAGREB_OFFSET_S;

// ---- the two-bar glyph ----------------------------------------------------------------------------

export interface Bar2Widths { normal: number; now: number | null }

/**
 * The two bars on one scale: the outline is the normal day, the fill is now. The scale is the larger of the two,
 * so with now at or under the normal day the outline spans the glyph and the fill is now/normal of it; with now
 * over it (empty stations on a strike morning) the fill spans and the outline is normal/now. A missing now draws
 * no fill (null, never a zero-width bar); a missing normal day leaves no glyph at all (null).
 */
export function bar2Widths(now: number | null, normal: number | null): Bar2Widths | null {
  if (normal === null || normal < 0) return null;
  const scale = Math.max(normal, now ?? 0);
  if (scale <= 0) return { normal: 1, now: now === null ? null : 0 };
  return { normal: normal / scale, now: now === null ? null : now / scale };
}

export interface Bar2Options {
  /** A visible label after the bars ("čet 1. 10.: 43"). */
  label?: string;
  /** The accessible name of the bars; readout.bar2Aria by default. */
  aria?: string;
  doc?: Document;
}

export interface Bar2Handle {
  readonly root: HTMLElement;
  update(now: number | null, normal: number | null, opts?: Omit<Bar2Options, 'doc'>): void;
}

const pct = (x: number): string => `${(Math.max(0, Math.min(1, x)) * 100).toFixed(2)}%`;
const setText = (node: HTMLElement, text: string): void => { if (node.textContent !== text) node.textContent = text; };

/** The reusable two-bar glyph (sn-ro-bar2): outline = the normal day, fill = now, updated by widths and textContent only. */
export function bar2(now: number | null, normal: number | null, opts: Bar2Options = {}): Bar2Handle {
  const doc = opts.doc ?? document;
  const fillBar = el(doc, 'span', { class: 'sn-ro-bar2-now' });
  const outline = el(doc, 'span', { class: 'sn-ro-bar2-normal' });
  const track = el(doc, 'span', { class: 'sn-ro-bar2-track', role: 'img' }, outline, fillBar);
  const label = el(doc, 'span', { class: 'sn-ro-bar2-label' });
  const missing = el(doc, 'span', { class: 'sn-ro-bar2-missing', text: NV, hidden: true });
  const root = el(doc, 'span', { class: 'sn-ro-bar2', 'data-sn-bar2': '' }, track, label, missing);
  const handle: Bar2Handle = {
    root,
    update(n, m, o = {}) {
      const w = bar2Widths(n, m);
      root.hidden = w === null;
      root.dataset.snBar2 = w === null ? 'none' : w.now === null ? 'missing' : 'ok';
      if (w) {
        outline.style.inlineSize = pct(w.normal);
        fillBar.hidden = w.now === null;
        if (w.now !== null) fillBar.style.inlineSize = pct(w.now);
      }
      missing.hidden = !w || w.now !== null;
      track.setAttribute('aria-label', o.aria ?? fill(SN.readout.bar2Aria, { now: nv(n), normal: nv(m) }));
      label.hidden = !o.label;
      setText(label, o.label ?? '');
    },
  };
  handle.update(now, normal, opts);
  return handle;
}

// ---- Vozila -------------------------------------------------------------------------------------------

/** The badge's tone per state: a word and a shape, never colour alone (base.css .badge). */
export const STATE_TONE: Record<SnimkaState, string> = { normal: 'live', reduced: 'stale', silent: 'down', unknown: 'info' };
const STATE_WORD: Record<SnimkaState, string> = { normal: SN.badge.normal, reduced: SN.badge.reduced, silent: SN.badge.silent, unknown: SN.badge.unknown };

/** The normal day's fleet at the same time of day (the weekday-matched comparison, S-12), or null. */
export function normalSeenAt(ctx: Pick<SnimkaContext, 'comparisons'>, atSec: number): number | null {
  if (!ctx.comparisons.length) return null;
  const m = comparisonMinute(ctx, atSec);
  return m === null ? null : (comparisonFor(ctx, atSec).series.seen.all[m] ?? null);
}

export interface VozilaFace {
  state: SnimkaState | null; word: string; tone: string; retro: boolean;
  now: number | null; normal: number | null;
  /** "4" (the figure before "u pokretu"), "bez podatka" for a missing minute. */
  figure: string;
  /** "običan dan (pon 21. 9.) u isto doba: 321"; on Sunday "Nedjelja nema usporedbe." (V3-8). */
  sub: string;
}

export function vozilaFace(ctx: Pick<SnimkaContext, 'series' | 'comparisons' | 'manifest'>, atSec: number): VozilaFace {
  const s = ctx.series;
  const m = minuteIn(s, atSec);
  const state = at(s.service.state, m);
  const now = at(s.seen.all, m);
  const sunday = zagrebWeekday(atSec) === 0;
  const normal = sunday ? null : normalSeenAt(ctx, atSec);
  let sub: string = SN.layers.compareSunday;
  if (!sunday && ctx.comparisons.length) {
    const c = comparisonFor(ctx, atSec);
    sub = fill(SN.readout.normalDaySub, { day: zagrebDay((c.fromSec + timeOfDay(atSec)) * 1000), n: nv(normal) });
  } else if (!sunday) sub = fill(SN.readout.normalDaySub, { day: NV, n: NV });
  return {
    state, word: state ? STATE_WORD[state] : NV, tone: state ? STATE_TONE[state] : 'info',
    retro: atSec < ctx.manifest.serviceLiveFromSec, now, normal, figure: nv(now), sub,
  };
}

/**
 * The data-path line of the Vozila depth (decision S-18): what ZET sent, what was in the depots and parked, what
 * moved and what the screen said. Shown only when those numbers part by two or more (otherwise the path is the
 * plain one and the line says nothing); null then, and null where nothing was recorded.
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

// ---- Mreža ----------------------------------------------------------------------------------------------

/** "linije s vozilom: 2 od 120" now (one definition of scheduled, live-network.ts scheduledCount); bez podatka outside the file. */
export function mrezaFace(routes: RoutesLike, atSec: number): { alive: number | null; scheduled: number | null; text: string } {
  const c = networkCounts(routes, atSec);
  if (!c) return { alive: null, scheduled: null, text: NV };
  return { alive: c.alive, scheduled: c.scheduled, text: fill(SN.twins.count, { alive: num(c.alive), scheduled: num(c.scheduled) }) };
}

// ---- Bicikli --------------------------------------------------------------------------------------------

/** BAJS's normal day is inside the window (the comparison days carry no bikes): Thursday 1 October, and Friday 2 October for the night before Monday 07:00. */
export const BIKES_REF = { thursday: zg(10, 1), friday: zg(10, 2), mondayMorning: zg(9, 28, 7), until: zg(10, 2, 12) } as const;
/** The day the strings name ("čet 1. 10."), replaced where the reference is Friday. */
const THURSDAY_WORDS = 'čet 1. 10.';

/**
 * The reference instant for the bikes at `atSec` (R2): the same minute of Thursday 1 October; before Monday 07:00
 * the same minute of Friday 2 October (Thursday's small hours still carried the strike's empty racks), falling
 * back to Thursday where Friday's minute lies past the recording; from Friday 12:00 on none (missing, never 0).
 */
export function bikesReference(s: Pick<SeriesFile, 't0' | 'n'>, atSec: number): { atSec: number; day: string } | null {
  if (atSec >= BIKES_REF.until) return null;
  const tod = timeOfDay(atSec);
  let ref = (atSec < BIKES_REF.mondayMorning ? BIKES_REF.friday : BIKES_REF.thursday) + tod;
  if (minuteIn(s, ref) === null || ref >= s.t0 + s.n * 60) ref = BIKES_REF.thursday + tod;
  return { atSec: ref, day: zagrebDay(ref * 1000) };
}

const withDay = (template: string, day: string): string => (day === THURSDAY_WORDS ? template : template.split(THURSDAY_WORDS).join(day));

export interface BicikliFace {
  now: number | null; normal: number | null;
  /** "84 praznih stanica", "bez podatka". */
  figure: string;
  /** The glyph's label: "čet 1. 10.: 43". */
  label: string;
  /** The glyph's accessible name: "sada 84, čet 1. 10.: 43". */
  aria: string;
  /** "bicikala 989 · čet 1. 10.: 1.300". */
  sub: string;
  refDay: string;
}

export function bicikliFace(s: SeriesFile, atSec: number): BicikliFace {
  const m = minuteIn(s, atSec);
  const now = at(s.bikes?.empty, m);
  const total = at(s.bikes?.total, m);
  const ref = bikesReference(s, atSec);
  const rm = ref ? minuteIn(s, ref.atSec) : null;
  const normal = at(s.bikes?.empty, rm);
  const normalTotal = at(s.bikes?.total, rm);
  const day = ref?.day ?? THURSDAY_WORDS;
  const label = `${day}: ${nv(normal)}`;
  return {
    now, normal, refDay: day, label,
    figure: now === null ? NV : count(now, SN.readout.emptyForms),
    aria: fill(SN.readout.bar2Aria.replace('običan dan {normal}', '{normal}'), { now: nv(now), normal: label }),
    sub: fill(withDay(SN.readout.bikesVs, day), { n: nv(total), normal: nv(normalTotal) }),
  };
}

// ---- the faces ------------------------------------------------------------------------------------------

/** Builds a panel's depth into an element and returns its teardown (panel-depths.ts, handed in by deckSpecs). */
export type DepthMounter = (id: PanelId, el: HTMLElement) => (() => void) | Promise<() => void>;

/** The face's chevron: the same shape on every face, turned by CSS when the panel is open. */
function chevron(doc: Document): HTMLElement {
  return el(doc, 'span', { class: 'sn-panel-chevron', 'aria-hidden': 'true' });
}

function faceHead(face: HTMLElement, title: string): HTMLElement {
  const doc = face.ownerDocument;
  const head = el(doc, 'span', { class: 'sn-ro-head' }, el(doc, 'span', { class: 'sn-panel-name', text: title }));
  face.replaceChildren(head);
  return head;
}

/**
 * The three panel specs in the deck's DOM order (Vozila, Mreža, Bicikli; on a phone CSS shows Mreža first).
 * `depth` builds a panel's depth; `teardowns` collects what the faces hold beyond the deck (the Mreža twins).
 * panel-depths.ts deckSpecs(ctx) is the entry the stage calls.
 */
export function readoutSpecs(ctx: SnimkaContext, depth: DepthMounter = () => () => {}, teardowns: (() => void)[] = []): PanelSpec[] {
  const s = ctx.series;
  const doc = ctx.doc;
  const fig: Partial<Record<PanelId, HTMLElement>> = {};
  const spec = (id: PanelId, title: string, mountFace: (face: HTMLElement) => (t: number) => void): PanelSpec =>
    ({ id, title, mountFace, mountDepth: (host) => depth(id, host), spotTarget: () => fig[id] ?? null });
  const minuteKey = (t: number): string => String(Math.floor(t / 60_000));

  const vozila = spec('vozila', SN.panel.vehicles, (face) => {
    const head = faceHead(face, SN.panel.vehicles);
    const word = el(doc, 'span', { class: 'badge sn-ro-badge', 'data-sn': 'state-word' });
    const retro = el(doc, 'span', {
      class: 'sn-ro-retro', 'data-sn': 'retro', text: SN.badge.retroShort, hidden: true,
      title: fill(SN.badge.retroNote, { liveFrom: zagrebDateTime(ctx.manifest.serviceLiveFromSec * 1000) }),
    });
    head.append(word, retro, chevron(doc));
    const value = el(doc, 'span', { class: 'sn-ro-num' });
    const figure = el(doc, 'span', { class: 'sn-ro-fig', 'data-sn-ro': 'vozila' }, value, ' ', el(doc, 'span', { class: 'sn-ro-unit', text: SN.readout.moving }));
    fig.vozila = figure;
    const glyph = bar2(null, null, { doc });
    const sub = el(doc, 'span', { class: 'sn-ro-sub' });
    face.append(figure, glyph.root, sub);
    let last = '';
    return (t) => {
      const key = minuteKey(t);
      if (key === last) return;
      last = key;
      const r = vozilaFace(ctx, t / 1000);
      setText(word, r.word);
      word.dataset.tone = r.tone;
      word.dataset.state = r.state ?? 'none';
      retro.hidden = !r.retro;
      setText(value, r.figure);
      glyph.update(r.now, r.normal);
      setText(sub, r.sub);
    };
  });

  const mreza = spec('mreza', SN.panel.network, (face) => {
    const head = faceHead(face, SN.panel.network);
    head.append(chevron(doc));
    const twins = el(doc, 'span', { class: 'sn-ro-twins', 'data-sn-ro': 'mreza' });
    fig.mreza = twins;
    face.append(twins);
    if (ctx.lagano) {
      // No map graph in the lightweight mode: the counts alone, in words.
      const text = el(doc, 'span', { class: 'sn-ro-sub' });
      twins.append(text);
      let last = '';
      return (t) => {
        const key = String(Math.floor(t / 1000 / ROUTES_STEP_S));
        if (key === last) return;
        last = key;
        setText(text, mrezaFace(ctx.routes, t / 1000).text);
      };
    }
    // The two minimaps (minimap.ts) follow the clock themselves; minimap.ts stays off the entry graph.
    let off: (() => void) | null = null;
    let gone = false;
    teardowns.push(() => { gone = true; off?.(); off = null; });
    void import('./minimap').then(({ mountMinimaps }) => {
      if (!gone) off = mountMinimaps(ctx, twins, { large: false });
    }, () => {});
    return () => {};
  });

  const bicikli = spec('bicikli', SN.panel.bikes, (face) => {
    const head = faceHead(face, SN.panel.bikes);
    head.append(chevron(doc));
    const figure = el(doc, 'span', { class: 'sn-ro-fig sn-ro-fig-text', 'data-sn-ro': 'bicikli' });
    fig.bicikli = figure;
    const glyph = bar2(null, null, { doc });
    const sub = el(doc, 'span', { class: 'sn-ro-sub' });
    face.append(figure, glyph.root, sub);
    let last = '';
    return (t) => {
      const key = minuteKey(t);
      if (key === last) return;
      last = key;
      const r = bicikliFace(s, t / 1000);
      setText(figure, r.figure);
      glyph.update(r.now, r.normal, { label: r.label, aria: r.aria });
      setText(sub, r.sub);
    };
  });

  return [vozila, mreza, bicikli];
}
