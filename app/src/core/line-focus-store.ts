/** Whether the transport workspace, once a line or vehicle is selected, draws
 *  only that route (network filtered, its pill still the same tram-blue) or
 *  the whole city network dimmed around it — a device preference, never
 *  relayed to a room. Default true: round F's owner decisions take "only this
 *  line" as the assumed default (overridable) whenever a selection is made. */
export const LINE_FOCUS_STORAGE_KEY = 'kajima:line-focus:v1';

export interface LineFocusStore {
  snapshot(): boolean;
  set(focus: boolean): void;
  subscribe(listener: (focus: boolean) => void): () => void;
}

export interface LineFocusStoreDeps {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

function parseStored(value: string | null | undefined): boolean | null {
  return value === 'true' ? true : value === 'false' ? false : null;
}

export function createLineFocusStore(deps: LineFocusStoreDeps = {}): LineFocusStore {
  const storage = deps.storage ?? null;
  let focus = true;
  try {
    const stored = parseStored(storage?.getItem(LINE_FOCUS_STORAGE_KEY));
    if (stored !== null) focus = stored;
  } catch {
    // Storage denied: "only this line" remains the default.
  }
  const listeners = new Set<(focus: boolean) => void>();
  return {
    snapshot: () => focus,
    set(next) {
      if (next === focus) return;
      focus = next;
      try {
        storage?.setItem(LINE_FOCUS_STORAGE_KEY, String(next));
      } catch {
        // Private mode or a full quota: the choice still holds for this tab.
      }
      for (const listener of listeners) listener(focus);
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(focus);
      return () => { listeners.delete(listener); };
    },
  };
}
