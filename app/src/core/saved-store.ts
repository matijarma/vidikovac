/** A saved line or stop, referenced by kind and the worker's own public id. */
export type SavedKind = 'route' | 'stop';
export interface SavedRef {
  kind: SavedKind;
  id: string;
}

export const SAVED_STORAGE_KEY = 'kajima:saved:v1';
export const SAVED_MAX = 12;

export interface SavedStore {
  list(): readonly SavedRef[];
  has(kind: SavedKind, id: string): boolean;
  add(ref: SavedRef): void;
  remove(ref: SavedRef): void;
  /** Adds when absent, removes when present. Returns whether the ref is saved afterwards. */
  toggle(ref: SavedRef): boolean;
  subscribe(listener: (list: readonly SavedRef[]) => void): () => void;
}

export interface SavedStoreDeps {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

// The worker's own ID rule (worker/public-selection.ts `ID`): a saved ref is
// then always a valid PublicSelection with no further sanitising, and one
// that never qualifies is discarded on read rather than carried around.
const ID = /^[0-9A-Za-z_-]{1,32}$/;

function isSavedRef(value: unknown): value is SavedRef {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (v.kind === 'route' || v.kind === 'stop') && typeof v.id === 'string' && ID.test(v.id);
}

function sameRef(a: SavedRef, b: SavedRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

function readStored(storage: Pick<Storage, 'getItem'> | null | undefined): SavedRef[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(SAVED_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedRef).slice(0, SAVED_MAX);
  } catch {
    return [];
  }
}

/** Read and write inside try/catch like every storage site today; a saved ref is
 *  never sent to the room (D6/B.3 — it is display context only). */
export function createSavedStore(deps: SavedStoreDeps): SavedStore {
  const storage = deps.storage ?? null;
  let list: SavedRef[] = readStored(storage);
  const listeners = new Set<(list: readonly SavedRef[]) => void>();
  const emit = (): void => {
    for (const listener of listeners) listener(list);
  };
  const persist = (): void => {
    try {
      storage?.setItem(SAVED_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Private mode or a full quota: the list still holds for this tab.
    }
  };
  return {
    list: () => list,
    has: (kind, id) => list.some((r) => r.kind === kind && r.id === id),
    add(ref) {
      if (!isSavedRef(ref)) return;
      if (list.some((r) => sameRef(r, ref))) return;
      if (list.length >= SAVED_MAX) return;
      list = [...list, ref];
      persist();
      emit();
    },
    remove(ref) {
      const next = list.filter((r) => !sameRef(r, ref));
      if (next.length === list.length) return;
      list = next;
      persist();
      emit();
    },
    toggle(ref) {
      if (!isSavedRef(ref)) return false;
      if (list.some((r) => sameRef(r, ref))) {
        list = list.filter((r) => !sameRef(r, ref));
        persist();
        emit();
        return false;
      }
      if (list.length >= SAVED_MAX) return false;
      list = [...list, ref];
      persist();
      emit();
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(list);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
