// What every part of /snimka/ receives: the dataset the entry loaded (the
// first-paint set of v2), the one clock, the one frame loop, the ref cache,
// the layer switches, the view (panel, subject, following) and the page's
// mode. A part is a Mount: given the context and its root element, it draws
// and returns its teardown. stage.ts (V3) and report.ts (V5) are Mounts.
import { SNIMKA_COMPARISONS, ZAGREB_OFFSET_S, type NewsFile, type NoticesFile, type PlacesFile, type RoutesFile, type SeriesFile, type SnimkaEvent, type SnimkaManifest } from '../../../shared/snimka';
import type { ReplayClock } from './clock';
import type { ViewReason, ViewState, ViewStore } from './contracts';
import type { RefCache } from './data';
import type { FrameLoop } from './frames';

/** The layer chips: the sources (vehicles, compare, bikes, closures) and the companion's own (the living network, the camera following the recording). */
/** v3: `live` (Živa mreža) and `closures` (Zatvorene ulice) left the stage. */
export interface Layers { vehicles: boolean; compare: boolean; bikes: boolean; follow: boolean }

export interface LayerStore {
  get(): Layers;
  set(patch: Partial<Layers>): void;
  onChange(fn: (layers: Layers, previous: Layers) => void): () => void;
}

export interface SnimkaTheme {
  resolved(): 'light' | 'dark';
  onChange(fn: (theme: 'light' | 'dark') => void): () => void;
}

/** One comparison day as loaded: its constant, its series and its per-line routes. */
export interface LoadedComparison { id: string; day: string; weekday: 1 | 4; fromSec: number; series: SeriesFile; routes: RoutesFile }

export interface SnimkaContext {
  manifest: SnimkaManifest;
  /** The window series (6720 minutes). */
  series: SeriesFile;
  /** The window's per-line five-minute counts. */
  routes: RoutesFile;
  /** Both comparison days, in SNIMKA_COMPARISONS order (cet-0924 first), each loaded at boot. */
  comparisons: LoadedComparison[];
  events: SnimkaEvent[];
  notices: NoticesFile;
  news: NewsFile;
  places: PlacesFile;
  clock: ReplayClock;
  frames: FrameLoop;
  data: RefCache;
  layers: LayerStore;
  view: ViewStore;
  /** The lightweight mode (?lagano=1 or a weak device): no map. */
  lagano: boolean;
  reducedMotion: boolean;
  theme: SnimkaTheme;
  doc: Document;
}

export type Mount = (ctx: SnimkaContext, root: HTMLElement) => () => void;

/** The comparison overlay is on at the opening (S-17); the living network and the following camera are on. */
export const DEFAULT_LAYERS: Layers = { vehicles: true, compare: true, bikes: true, follow: true };

export function createLayerStore(initial: Partial<Layers> = {}): LayerStore {
  let layers: Layers = { ...DEFAULT_LAYERS, ...initial };
  const listeners = new Set<(layers: Layers, previous: Layers) => void>();
  return {
    get: () => layers,
    set(patch) {
      const next = { ...layers, ...patch };
      if ((Object.keys(next) as (keyof Layers)[]).every((k) => next[k] === layers[k])) return;
      const previous = layers;
      layers = next;
      for (const fn of [...listeners]) fn(layers, previous);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

export const DEFAULT_VIEW: ViewState = { panel: null, subject: null, following: true };

const sameSubject = (a: ViewState['subject'], b: ViewState['subject']): boolean => (a === null || b === null ? a === b : a.kind === b.kind && a.id === b.id);

/** The view store, the same pattern as the layers: a patch that changes nothing is silent; listeners get the reason. */
export function createViewStore(initial: Partial<ViewState> = {}): ViewStore {
  let state: ViewState = { ...DEFAULT_VIEW, ...initial };
  const listeners = new Set<(state: ViewState, prev: ViewState, reason: ViewReason | undefined) => void>();
  return {
    get: () => state,
    set(patch, reason) {
      const next: ViewState = { ...state, ...patch };
      if (next.panel === state.panel && next.following === state.following && sameSubject(next.subject, state.subject)) return;
      const prev = state;
      state = next;
      for (const fn of [...listeners]) fn(state, prev, reason);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

/** The Zagreb weekday (0 = Sunday) of an instant; CEST throughout the window. */
const zagrebWeekday = (atSec: number): number => new Date((atSec + ZAGREB_OFFSET_S) * 1000).getUTCDay();

/** The normal day to set against an instant of the window: Monday minutes against Mon 21 Sep, every other weekday against Thu 24 Sep (S-12). */
export function comparisonIdFor(atSec: number): string {
  return zagrebWeekday(atSec) === 1 ? SNIMKA_COMPARISONS[1].id : SNIMKA_COMPARISONS[0].id;
}

/** The loaded comparison day for an instant, or the first one when the matched day is not loaded. */
export function comparisonFor(ctx: Pick<SnimkaContext, 'comparisons'>, atSec: number): LoadedComparison {
  const id = comparisonIdFor(atSec);
  return ctx.comparisons.find((c) => c.id === id) ?? ctx.comparisons[0]!;
}

/** The comparison day's minute index at the same Zagreb time of day as `atSec`, or null when its series lacks the minute. */
export function comparisonMinute(ctx: Pick<SnimkaContext, 'comparisons'>, atSec: number): number | null {
  const c = comparisonFor(ctx, atSec);
  const tod = (((Math.floor(atSec) + ZAGREB_OFFSET_S) % 86_400) + 86_400) % 86_400;
  const m = Math.floor((c.fromSec + tod - c.series.t0) / 60);
  return m >= 0 && m < c.series.n ? m : null;
}
