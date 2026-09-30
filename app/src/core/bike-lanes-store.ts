/** When Karta draws the City's cycle paths: only while a BAJS station is
 *  selected (the default, so the map stays calm) or always. A device
 *  preference kept in storage, never relayed to a room. */
export const BIKE_LANES_STORAGE_KEY = 'kajima:bike-lanes:v1';

export type BikeLanesMode = 'bajs' | 'always';

export interface BikeLanesStore {
  snapshot(): BikeLanesMode;
  set(mode: BikeLanesMode): void;
  subscribe(listener: (mode: BikeLanesMode) => void): () => void;
}

export interface BikeLanesStoreDeps {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

function parseStored(value: string | null | undefined): BikeLanesMode | null {
  return value === 'always' || value === 'bajs' ? value : null;
}

export function createBikeLanesStore(deps: BikeLanesStoreDeps = {}): BikeLanesStore {
  const storage = deps.storage ?? null;
  let mode: BikeLanesMode = 'bajs';
  try {
    const stored = parseStored(storage?.getItem(BIKE_LANES_STORAGE_KEY));
    if (stored) mode = stored;
  } catch {
    // Storage denied: the default holds.
  }
  const listeners = new Set<(mode: BikeLanesMode) => void>();
  return {
    snapshot: () => mode,
    set(next) {
      if (next === mode) return;
      mode = next;
      try {
        storage?.setItem(BIKE_LANES_STORAGE_KEY, next);
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
