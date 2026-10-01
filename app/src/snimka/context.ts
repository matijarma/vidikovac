// What every part of /snimka/ receives: the dataset the entry loaded, the one
// clock, the one frame loop, the ref cache, the layer switches and the page's
// mode. A part is a Mount: given the context and its root element, it draws
// and returns its teardown. stage.ts (S2) and report.ts (S3) are Mounts.
import type { SeriesFile, SnimkaEvent, SnimkaManifest } from '../../../shared/snimka';
import type { ReplayClock } from './clock';
import type { RefCache } from './data';
import type { FrameLoop } from './frames';

export interface Layers { vehicles: boolean; compare: boolean; bikes: boolean; closures: boolean }

export interface LayerStore {
  get(): Layers;
  set(patch: Partial<Layers>): void;
  onChange(fn: (layers: Layers, previous: Layers) => void): () => void;
}

export interface SnimkaTheme {
  resolved(): 'light' | 'dark';
  onChange(fn: (theme: 'light' | 'dark') => void): () => void;
}

export interface SnimkaContext {
  manifest: SnimkaManifest;
  /** The window series (5040 minutes). */
  series: SeriesFile;
  /** The comparison day, Thu 24 Sep (1440 minutes). */
  comparison: SeriesFile;
  events: SnimkaEvent[];
  clock: ReplayClock;
  frames: FrameLoop;
  data: RefCache;
  layers: LayerStore;
  /** The lightweight mode (?lagano=1 or a weak device): no map. */
  lagano: boolean;
  reducedMotion: boolean;
  theme: SnimkaTheme;
  doc: Document;
}

export type Mount = (ctx: SnimkaContext, root: HTMLElement) => () => void;

export const DEFAULT_LAYERS: Layers = { vehicles: true, compare: false, bikes: true, closures: true };

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
