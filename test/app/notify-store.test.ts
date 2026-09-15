// The kvart alert switches: local, opt-in tile highlighting only ("Ništa se
// ne šalje"), never a push. Storage-backed like every store in
// app/src/core; unknown keys and non-boolean values from a hand-edited or
// stale localStorage row never reach the flags a caller reads.
import { describe, expect, it } from 'vitest';
import { activeCount, createNotifyStore, NOTIFY_KEYS, NOTIFY_STORAGE_KEY, type NotifyFlags } from '../../app/src/core/notify-store';

function fakeStorage(initial: Record<string, string> = {}) {
  const raw = { ...initial };
  return { raw, getItem: (k: string) => (k in raw ? raw[k]! : null), setItem: (k: string, v: string) => { raw[k] = v; } };
}

describe('NOTIFY_KEYS / NOTIFY_STORAGE_KEY', () => {
  it('names the four alert keys in order and the documented storage key (D15)', () => {
    expect(NOTIFY_KEYS).toEqual(['delays', 'works', 'waste', 'dhmz']);
    expect(NOTIFY_STORAGE_KEY).toBe('kajima:notify:v1');
  });
});

describe('createNotifyStore', () => {
  it('defaults every key to off with no storage', () => {
    const store = createNotifyStore({ storage: null });
    expect(store.snapshot()).toEqual({ delays: false, works: false, waste: false, dhmz: false });
  });
  it('set() flips one key, persists, and notifies subscribers', () => {
    const storage = fakeStorage();
    const store = createNotifyStore({ storage });
    const seen: NotifyFlags[] = [];
    store.subscribe((f) => seen.push(f));
    store.set('works', true);
    expect(store.snapshot().works).toBe(true);
    expect(JSON.parse(storage.raw[NOTIFY_STORAGE_KEY]!)).toEqual({ delays: false, works: true, waste: false, dhmz: false });
    expect(seen).toHaveLength(2);
  });
  it('toggle() flips the current value back and forth', () => {
    const store = createNotifyStore({ storage: fakeStorage() });
    store.toggle('dhmz');
    expect(store.snapshot().dhmz).toBe(true);
    store.toggle('dhmz');
    expect(store.snapshot().dhmz).toBe(false);
  });
  it('ignores an unknown key at runtime, e.g. a stray dataset value', () => {
    const store = createNotifyStore({ storage: fakeStorage() });
    const setAny = store.set as (key: string, on: boolean) => void;
    setAny('bogus', true);
    expect(store.snapshot()).toEqual({ delays: false, works: false, waste: false, dhmz: false });
  });
  it('discards unknown keys and non-boolean values from stored data', () => {
    const storage = fakeStorage({ [NOTIFY_STORAGE_KEY]: JSON.stringify({ delays: true, works: 'yes', bogus: true }) });
    const store = createNotifyStore({ storage });
    expect(store.snapshot()).toEqual({ delays: true, works: false, waste: false, dhmz: false });
  });
  it('falls back to all-off on garbage stored JSON', () => {
    const storage = fakeStorage({ [NOTIFY_STORAGE_KEY]: 'not json' });
    const store = createNotifyStore({ storage });
    expect(store.snapshot()).toEqual({ delays: false, works: false, waste: false, dhmz: false });
  });
  it('tolerates a storage that throws on read and write', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const store = createNotifyStore({ storage: throwing });
    expect(store.snapshot()).toEqual({ delays: false, works: false, waste: false, dhmz: false });
    expect(() => store.set('delays', true)).not.toThrow();
    expect(store.snapshot().delays).toBe(true);
  });
  it('subscribe emits the current flags immediately, then on every change', () => {
    const store = createNotifyStore({ storage: fakeStorage() });
    const seen: NotifyFlags[] = [];
    store.subscribe((f) => seen.push(f));
    store.toggle('waste');
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ delays: false, works: false, waste: false, dhmz: false });
    expect(seen[1]).toEqual({ delays: false, works: false, waste: true, dhmz: false });
  });
});

describe('activeCount', () => {
  it('counts only the keys named, in a flags set with others on', () => {
    const flags: NotifyFlags = { delays: true, works: true, waste: true, dhmz: false };
    expect(activeCount(flags, ['delays', 'works', 'waste', 'dhmz'])).toBe(3);
    expect(activeCount(flags, ['delays', 'works', 'dhmz'])).toBe(2);
  });
  it('is zero with nothing on', () => {
    expect(activeCount({ delays: false, works: false, waste: false, dhmz: false }, NOTIFY_KEYS)).toBe(0);
  });
});
