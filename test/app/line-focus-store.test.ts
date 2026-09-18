// Round F, task F0: the line-focus device preference (plan §C, assumption
// R-F6a — "only this line" is the default, persisted per device). Same shape
// as map-mode-store.ts: snapshot/set/subscribe, validated read, a storage
// write that never throws out of the store.
import { describe, expect, it } from 'vitest';
import { createLineFocusStore, LINE_FOCUS_STORAGE_KEY } from '../../app/src/core/line-focus-store';

function fakeStorage(initial: Record<string, string> = {}) {
  const raw = { ...initial };
  return { raw, getItem: (k: string) => (k in raw ? raw[k]! : null), setItem: (k: string, v: string) => { raw[k] = v; } };
}

describe('LINE_FOCUS_STORAGE_KEY', () => {
  it('is the documented kajima key', () => {
    expect(LINE_FOCUS_STORAGE_KEY).toBe('kajima:line-focus:v1');
  });
});

describe('createLineFocusStore', () => {
  it('defaults to true with no storage', () => {
    const store = createLineFocusStore({ storage: null });
    expect(store.snapshot()).toBe(true);
  });

  it('set(false) persists the string "false" and notifies subscribers', () => {
    const storage = fakeStorage();
    const store = createLineFocusStore({ storage });
    const seen: boolean[] = [];
    store.subscribe((focus) => seen.push(focus));
    store.set(false);
    expect(store.snapshot()).toBe(false);
    expect(storage.raw[LINE_FOCUS_STORAGE_KEY]).toBe('false');
    expect(seen).toEqual([true, false]);
  });

  it('reads a garbage stored value as true', () => {
    const storage = fakeStorage({ [LINE_FOCUS_STORAGE_KEY]: 'not-a-boolean' });
    const store = createLineFocusStore({ storage });
    expect(store.snapshot()).toBe(true);
  });
});
