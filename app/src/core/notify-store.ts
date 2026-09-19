/** The reader's alert switches (spec §4.9's bell): purely local tile highlighting, never a
 *  push — `PUSH` stays off (D7) and `notify.note` says so beside the switches. */
export const NOTIFY_KEYS = ['delays', 'works', 'waste', 'dhmz'] as const;
export type NotifyKey = (typeof NOTIFY_KEYS)[number];
export type NotifyFlags = Readonly<Record<NotifyKey, boolean>>;

export const NOTIFY_STORAGE_KEY = 'kajima:notify:v1';

export interface NotifyStore {
  snapshot(): NotifyFlags;
  set(key: NotifyKey, on: boolean): void;
  toggle(key: NotifyKey): void;
  subscribe(listener: (flags: NotifyFlags) => void): () => void;
}

export interface NotifyStoreDeps {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

function isNotifyKey(value: unknown): value is NotifyKey {
  return typeof value === 'string' && (NOTIFY_KEYS as readonly string[]).includes(value);
}

function defaultFlags(): NotifyFlags {
  return { delays: false, works: false, waste: false, dhmz: false };
}

function readStored(storage: Pick<Storage, 'getItem'> | null | undefined): NotifyFlags {
  const base = defaultFlags();
  if (!storage) return base;
  try {
    const raw = storage.getItem(NOTIFY_STORAGE_KEY);
    if (!raw) return base;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return base;
    const next = { ...base };
    for (const key of NOTIFY_KEYS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'boolean') next[key] = value;
    }
    return next;
  } catch {
    return base;
  }
}

/** Read and write inside try/catch like every storage site today. Keys and values are
 *  validated at every entry point: `data-key` on a switch row reaches `set`/`toggle` as a
 *  plain string, and a hand-edited or stale localStorage row reaches `readStored`. */
export function createNotifyStore(deps: NotifyStoreDeps): NotifyStore {
  const storage = deps.storage ?? null;
  let flags: NotifyFlags = readStored(storage);
  const listeners = new Set<(flags: NotifyFlags) => void>();
  const emit = (): void => {
    for (const listener of listeners) listener(flags);
  };
  const persist = (): void => {
    try {
      storage?.setItem(NOTIFY_STORAGE_KEY, JSON.stringify(flags));
    } catch {
      // Private mode or a full quota: the flags still hold for this tab.
    }
  };
  return {
    snapshot: () => flags,
    set(key, on) {
      if (!isNotifyKey(key) || typeof on !== 'boolean') return;
      if (flags[key] === on) return;
      flags = { ...flags, [key]: on };
      persist();
      emit();
    },
    toggle(key) {
      if (!isNotifyKey(key)) return;
      flags = { ...flags, [key]: !flags[key] };
      persist();
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(flags);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Counts only the keys named — the caller passes the flag-gated key set (e.g. `waste`
 *  dropped when `FLAGS.FEED_WASTE` is off) so a hidden switch never inflates the count. */
export function activeCount(flags: NotifyFlags, keys: readonly NotifyKey[]): number {
  return keys.reduce((count, key) => count + (flags[key] ? 1 : 0), 0);
}
