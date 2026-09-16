/** The live transit map's renderer, chosen on this device, never relayed to a room. */
export type MapMode = 'map' | 'schema';

export const MAP_MODE_STORAGE_KEY = 'kajima:map-mode:v1';

export interface MapModeStore {
  snapshot(): MapMode;
  set(mode: MapMode): void;
  subscribe(listener: (mode: MapMode) => void): () => void;
}

export interface MapModeStoreDeps {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

function isMapMode(value: unknown): value is MapMode {
  return value === 'map' || value === 'schema';
}

export function createMapModeStore(deps: MapModeStoreDeps = {}): MapModeStore {
  const storage = deps.storage ?? null;
  let mode: MapMode = 'map';
  try {
    const stored = storage?.getItem(MAP_MODE_STORAGE_KEY);
    if (isMapMode(stored)) mode = stored;
  } catch {
    // Storage denied: the city map remains the default.
  }
  const listeners = new Set<(mode: MapMode) => void>();
  return {
    snapshot: () => mode,
    set(next) {
      if (!isMapMode(next) || next === mode) return;
      mode = next;
      try {
        storage?.setItem(MAP_MODE_STORAGE_KEY, next);
      } catch {
        // Private mode or a full quota: the choice still holds for this tab.
      }
      for (const listener of listeners) listener(mode);
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(mode);
      return () => { listeners.delete(listener); };
    },
  };
}
