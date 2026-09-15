// Saved lines and stops (spec's kvart "Spremljeno" list): capped, deduped,
// validated on read against the worker's own ID rule so a saved ref is
// always a valid PublicSelection and never needs sanitising before it is
// used to navigate or (never) sent to the room.
import { describe, expect, it } from 'vitest';
import { createSavedStore, SAVED_MAX, SAVED_STORAGE_KEY, type SavedRef } from '../../app/src/core/saved-store';

function fakeStorage(initial: Record<string, string> = {}) {
  const raw = { ...initial };
  return { raw, getItem: (k: string) => (k in raw ? raw[k]! : null), setItem: (k: string, v: string) => { raw[k] = v; } };
}

describe('SAVED_STORAGE_KEY / SAVED_MAX', () => {
  it('are the documented values (D15)', () => {
    expect(SAVED_STORAGE_KEY).toBe('kajima:saved:v1');
    expect(SAVED_MAX).toBe(12);
  });
});

describe('createSavedStore', () => {
  it('starts empty with no storage', () => {
    const store = createSavedStore({ storage: null });
    expect(store.list()).toEqual([]);
  });
  it('add() appends, has()/list() reflect it, and it persists as JSON', () => {
    const storage = fakeStorage();
    const store = createSavedStore({ storage });
    store.add({ kind: 'route', id: '6' });
    expect(store.has('route', '6')).toBe(true);
    expect(store.has('stop', '6')).toBe(false);
    expect(store.list()).toEqual([{ kind: 'route', id: '6' }]);
    expect(JSON.parse(storage.raw[SAVED_STORAGE_KEY]!)).toEqual([{ kind: 'route', id: '6' }]);
  });
  it('add() dedupes an already-saved ref', () => {
    const store = createSavedStore({ storage: fakeStorage() });
    store.add({ kind: 'stop', id: '200_1' });
    store.add({ kind: 'stop', id: '200_1' });
    expect(store.list()).toEqual([{ kind: 'stop', id: '200_1' }]);
  });
  it('stops at SAVED_MAX and ignores a 13th distinct ref', () => {
    const store = createSavedStore({ storage: fakeStorage() });
    for (let i = 0; i < SAVED_MAX; i += 1) store.add({ kind: 'route', id: String(i) });
    expect(store.list()).toHaveLength(SAVED_MAX);
    store.add({ kind: 'route', id: 'overflow' });
    expect(store.list()).toHaveLength(SAVED_MAX);
    expect(store.has('route', 'overflow')).toBe(false);
  });
  it('remove() drops a saved ref and is a silent no-op otherwise', () => {
    const store = createSavedStore({ storage: fakeStorage() });
    store.add({ kind: 'route', id: '6' });
    store.remove({ kind: 'route', id: '6' });
    expect(store.list()).toEqual([]);
    expect(() => store.remove({ kind: 'stop', id: 'x' })).not.toThrow();
  });
  it('toggle() adds when absent and removes when present, returning the resulting state', () => {
    const store = createSavedStore({ storage: fakeStorage() });
    expect(store.toggle({ kind: 'route', id: '6' })).toBe(true);
    expect(store.has('route', '6')).toBe(true);
    expect(store.toggle({ kind: 'route', id: '6' })).toBe(false);
    expect(store.has('route', '6')).toBe(false);
  });
  it('toggle() cannot add past SAVED_MAX and returns false', () => {
    const store = createSavedStore({ storage: fakeStorage() });
    for (let i = 0; i < SAVED_MAX; i += 1) store.add({ kind: 'route', id: String(i) });
    expect(store.toggle({ kind: 'route', id: 'overflow' })).toBe(false);
    expect(store.has('route', 'overflow')).toBe(false);
  });
  it('discards an invalid persisted entry: bad kind, bad id shape, missing id, or a non-object row', () => {
    const storage = fakeStorage({
      [SAVED_STORAGE_KEY]: JSON.stringify([
        { kind: 'route', id: '6' },
        { kind: 'bus', id: '6' },
        { kind: 'stop', id: 'has spaces' },
        { kind: 'stop' },
        'not-an-object',
      ]),
    });
    const store = createSavedStore({ storage });
    expect(store.list()).toEqual([{ kind: 'route', id: '6' }]);
  });
  it('falls back to empty on garbage stored JSON', () => {
    const storage = fakeStorage({ [SAVED_STORAGE_KEY]: 'not json' });
    const store = createSavedStore({ storage });
    expect(store.list()).toEqual([]);
  });
  it('tolerates a storage that throws on read and write', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const store = createSavedStore({ storage: throwing });
    expect(store.list()).toEqual([]);
    expect(() => store.add({ kind: 'route', id: '6' })).not.toThrow();
    expect(store.has('route', '6')).toBe(true);
  });
  it('subscribe emits the current list immediately, then on every change', () => {
    const store = createSavedStore({ storage: fakeStorage() });
    const seen: (readonly SavedRef[])[] = [];
    store.subscribe((list) => seen.push(list));
    store.add({ kind: 'route', id: '6' });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual([]);
    expect(seen[1]).toEqual([{ kind: 'route', id: '6' }]);
  });
});
