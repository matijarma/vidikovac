import { describe, expect, it } from 'vitest';
import { BIKE_LANES_STORAGE_KEY, createBikeLanesStore } from '../../app/src/core/bike-lanes-store';

const memory = () => { const raw = new Map<string, string>(); return { raw, storage: { getItem: (k: string) => raw.get(k) ?? null, setItem: (k: string, v: string) => { raw.set(k, v); } } }; };

describe('bike lanes store', () => {
  it('defaults to showing the cycle paths only for a selected BAJS station, keeps the choice, and tells listeners', () => {
    const { raw, storage } = memory();
    const store = createBikeLanesStore({ storage });
    expect(store.snapshot()).toBe('bajs');
    const seen: string[] = [];
    store.subscribe((mode) => seen.push(mode));
    store.set('always');
    expect(raw.get(BIKE_LANES_STORAGE_KEY)).toBe('always');
    expect(createBikeLanesStore({ storage }).snapshot()).toBe('always');
    expect(seen).toEqual(['bajs', 'always']);
  });

  it('ignores an unknown stored value and survives denied storage', () => {
    const { raw, storage } = memory();
    raw.set(BIKE_LANES_STORAGE_KEY, 'sometimes');
    expect(createBikeLanesStore({ storage }).snapshot()).toBe('bajs');
    const denied = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const store = createBikeLanesStore({ storage: denied });
    store.set('always');
    expect(store.snapshot()).toBe('always');
  });
});
