import type { ModuleId, ModuleSnapshot } from '../../../worker/feed/schema';
import type { FeedErrors, FeedSnapshots } from './contracts';

export interface FeedStoreState {
  snapshots: FeedSnapshots;
  errors: FeedErrors;
  loading: ReadonlySet<ModuleId>;
  paused: boolean;
}

export interface FeedStoreDeps {
  fetchData: (id: ModuleId, token: string) => Promise<ModuleSnapshot>;
  token: () => string | null;
  now?: () => number;
}

export interface FeedStore {
  snapshot(): FeedStoreState;
  subscribe(listener: (state: FeedStoreState) => void): () => void;
  setModules(ids: readonly ModuleId[]): void;
  refresh(ids?: readonly ModuleId[]): Promise<void>;
  ingest(snapshots: readonly ModuleSnapshot[]): void;
  pause(value: boolean): void;
  destroy(): void;
}

/** Request failures never masquerade as valid empty or erase the last good data. */
export function createFeedStore(deps: FeedStoreDeps): FeedStore {
  const now = deps.now ?? Date.now;
  let state: FeedStoreState = { snapshots: {}, errors: {}, loading: new Set(), paused: false };
  let modules: readonly ModuleId[] = [];
  let disposed = false;
  let epoch = 0;
  const pending = new Map<ModuleId, number>();
  const listeners = new Set<(state: FeedStoreState) => void>();
  const emit = () => { if (!disposed) for (const listener of listeners) listener(state); };
  return {
    snapshot: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
    setModules(ids) { modules = [...new Set(ids)]; },
    async refresh(ids = modules) {
      const token = deps.token();
      if (disposed || state.paused || !token) return;
      const generation = epoch;
      const wanted = [...new Set(ids)].filter((id) => !pending.has(id));
      if (!wanted.length) return;
      wanted.forEach((id) => pending.set(id, generation));
      state = { ...state, loading: new Set(pending.keys()) };
      emit();
      await Promise.all(wanted.map(async (id) => {
        try {
          const snapshot = await deps.fetchData(id, token);
          if (disposed || epoch !== generation || state.paused) return;
          if (snapshot.module !== id || !Array.isArray(snapshot.items)) throw new Error('invalid-snapshot');
          const errors = { ...state.errors };
          delete errors[id];
          state = { ...state, snapshots: { ...state.snapshots, [id]: snapshot }, errors };
        } catch (error) {
          if (disposed || epoch !== generation || state.paused) return;
          const previous = state.snapshots[id];
          const snapshots = { ...state.snapshots };
          if (previous) snapshots[id] = {
            ...previous,
            status: previous.status === 'down' ? 'down' : 'stale',
            staleSince: previous.staleSince ?? new Date(now()).toISOString(),
            ...(previous.sources ? {
              sources: Object.fromEntries(Object.entries(previous.sources).map(([key, source]) => [
                key, { ...source, status: source.status === 'down' ? 'down' as const : 'stale' as const },
              ])),
            } : {}),
            ...(previous.coverage ? { coverage: { ...previous.coverage, limited: true } } : {}),
          };
          state = { ...state, snapshots, errors: { ...state.errors, [id]: error instanceof Error ? error.message : 'request-failed' } };
        } finally {
          if (pending.get(id) === generation) {
            pending.delete(id);
            state = { ...state, loading: new Set(pending.keys()) };
            emit();
          }
        }
      }));
    },
    ingest(values) {
      if (disposed || state.paused) return;
      const snapshots = { ...state.snapshots };
      const errors = { ...state.errors };
      for (const value of values) { snapshots[value.module] = value; delete errors[value.module]; }
      state = { ...state, snapshots, errors };
      emit();
    },
    pause(value) {
      if (state.paused === value) return;
      epoch++;
      pending.clear();
      state = { ...state, paused: value, loading: new Set() };
      emit();
    },
    destroy() { disposed = true; epoch++; listeners.clear(); },
  };
}
