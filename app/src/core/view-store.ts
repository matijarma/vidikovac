import type { LayerId } from '../../../worker/protocol';
import { parseSelection, selectionParams, validLayer, type PublicSelection } from '../../../worker/public-selection';
import type { ViewState } from './contracts';

export interface ViewStoreDeps {
  initialLayer?: LayerId;
  hash?: string;
  history?: Pick<History, 'pushState' | 'replaceState'>;
  location?: Pick<Location, 'pathname' | 'search' | 'hash'>;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

export interface ViewStore {
  snapshot(): ViewState;
  subscribe(listener: (state: ViewState) => void): () => void;
  navigate(layer: LayerId, selection?: PublicSelection | null, replace?: boolean): void;
  setFilter(key: string, value: string): void;
  restore(hash: string): void;
}

export function createViewStore(deps: ViewStoreDeps = {}): ViewStore {
  const perLayer: Partial<Record<LayerId, Record<string, string>>> = {};
  let state: ViewState = { layer: deps.initialLayer ?? 'grad-sada', selection: null, filters: {} };
  const listeners = new Set<(state: ViewState) => void>();
  const emit = () => { for (const listener of listeners) listener(state); };
  function restore(hash: string): void {
    const p = new URLSearchParams(hash.replace(/^#/, ''));
    const candidate = p.get('layer');
    const layer = validLayer(candidate) ? candidate : state.layer;
    const params: Record<string, string> = {};
    for (const key of ['kind', 'id', 'module']) { const value = p.get(key); if (value) params[key] = value; }
    state = { layer, selection: parseSelection(params), filters: perLayer[layer] ?? {} };
    emit();
  }
  function write(replace: boolean): void {
    const location = deps.location;
    if (!location || !deps.history) return;
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    // Ticket has already been spent by the entry; never resurrect one in history.
    p.delete('ticket');
    p.set('layer', state.layer);
    for (const key of ['kind', 'id', 'module']) p.delete(key);
    for (const [key, value] of Object.entries(selectionParams(state.selection) ?? {})) p.set(key, value);
    const url = `${location.pathname}${location.search}#${p}`;
    deps.history[replace ? 'replaceState' : 'pushState'](null, '', url);
  }
  restore(deps.hash ?? deps.location?.hash ?? '');
  return {
    snapshot: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
    navigate(layer, selection = null, replace = false) {
      if (!validLayer(layer)) return;
      state = { layer, selection, filters: perLayer[layer] ?? {} };
      try { deps.storage?.setItem('vidikovac.layer', layer); } catch { /* storage optional */ }
      write(replace);
      emit();
    },
    setFilter(key, value) {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(key)) return;
      const filters = { ...state.filters, [key]: value.slice(0, 200) };
      perLayer[state.layer] = filters;
      state = { ...state, filters };
      // Search text stays in browser memory, not URLs or the shared screen.
      emit();
    },
    restore,
  };
}
