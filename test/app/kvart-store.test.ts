// The kvart choice: what a reader picked in the district select, and what it
// resolves to (D6). Storage-backed exactly like every other store in
// app/src/core; a garbage or throwing storage never breaks the reader's view.
import { describe, expect, it } from 'vitest';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { createKvartStore, kvartLabel, resolveKvart, KVART_STORAGE_KEY, type KvartChoice } from '../../app/src/core/kvart-store';

function fakeStorage(initial: Record<string, string> = {}) {
  const raw = { ...initial };
  return { raw, getItem: (k: string) => (k in raw ? raw[k]! : null), setItem: (k: string, v: string) => { raw[k] = v; } };
}

describe('KVART_STORAGE_KEY', () => {
  it('is the documented kajima key (D15)', () => {
    expect(KVART_STORAGE_KEY).toBe('kajima:kvart:v1');
  });
});

describe('createKvartStore', () => {
  it('defaults to "screen" with no storage', () => {
    const store = createKvartStore({ storage: null });
    expect(store.snapshot()).toBe('screen');
  });
  it('reads a persisted district choice', () => {
    const storage = fakeStorage({ [KVART_STORAGE_KEY]: 'trnje' });
    const store = createKvartStore({ storage });
    expect(store.snapshot()).toBe('trnje');
  });
  it('falls back to "screen" on a garbage stored value', () => {
    const storage = fakeStorage({ [KVART_STORAGE_KEY]: 'not-a-district' });
    const store = createKvartStore({ storage });
    expect(store.snapshot()).toBe('screen');
  });
  it('set() persists a valid choice and notifies subscribers', () => {
    const storage = fakeStorage();
    const store = createKvartStore({ storage });
    const seen: KvartChoice[] = [];
    store.subscribe((c) => seen.push(c));
    store.set('maksimir');
    expect(store.snapshot()).toBe('maksimir');
    expect(storage.raw[KVART_STORAGE_KEY]).toBe('maksimir');
    expect(seen).toEqual(['screen', 'maksimir']);
  });
  it('set() ignores a value that is neither "screen" nor a known district slug', () => {
    const store = createKvartStore({ storage: fakeStorage() });
    store.set('atlantis' as KvartChoice);
    expect(store.snapshot()).toBe('screen');
  });
  it('tolerates a storage that throws on read and write', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const store = createKvartStore({ storage: throwing });
    expect(store.snapshot()).toBe('screen');
    expect(() => store.set('trnje')).not.toThrow();
    expect(store.snapshot()).toBe('trnje');
  });
  it('subscribe emits the current choice immediately and unsubscribe stops further calls', () => {
    const store = createKvartStore({ storage: null });
    const seen: KvartChoice[] = [];
    const unsubscribe = store.subscribe((c) => seen.push(c));
    expect(seen).toEqual(['screen']);
    unsubscribe();
    store.set('sesvete');
    expect(seen).toEqual(['screen']);
  });
});

describe('resolveKvart', () => {
  it('an explicit district choice resolves to itself, regardless of the stop', () => {
    expect(resolveKvart('trnje', undefined)).toBe('trnje');
    const stop = { id: 's', name: 'x', lon: 0, lat: 0, routes: [], district: 'maksimir' };
    expect(resolveKvart('trnje', stop)).toBe('trnje');
  });
  it('"screen" without a screen stop is the whole city (null)', () => {
    expect(resolveKvart('screen', undefined)).toBeNull();
  });
  it('"screen" with a stop that carries no district is the whole city (null)', () => {
    const stop = { id: 's', name: 'x', lon: 0, lat: 0, routes: [] };
    expect(resolveKvart('screen', stop)).toBeNull();
  });
  it('"screen" with a stop whose district is one of the 17 areas resolves to it', () => {
    const stop = { id: 's', name: 'Trg bana J. Jelačića', lon: 15.9785, lat: 45.8131, routes: ['6'], district: 'donji-grad' };
    expect(resolveKvart('screen', stop)).toBe('donji-grad');
  });
  it('"screen" with an unrecognised district string is the whole city (null)', () => {
    const stop = { id: 's', name: 'x', lon: 0, lat: 0, routes: [], district: 'atlantis' };
    expect(resolveKvart('screen', stop)).toBeNull();
  });
});

describe('kvartLabel', () => {
  const i18n = createDefaultI18n('hr');
  it('names the resolved district', () => {
    expect(kvartLabel(i18n, 'donji-grad')).toBe('Donji grad');
  });
  it('reads "Cijeli grad" for the whole city', () => {
    expect(kvartLabel(i18n, null)).toBe('Cijeli grad');
  });
});
