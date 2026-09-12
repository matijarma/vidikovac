import { describe, expect, it } from 'vitest';
import { detectLagano, LAGANO_STORAGE_KEY, markLagano } from '../../app/src/ui/lagano';

function fakeStorage(initial: Record<string, string> = {}) {
  const raw = { ...initial };
  return {
    raw,
    getItem: (k: string): string | null => (k in raw ? raw[k]! : null),
    setItem: (k: string, v: string): void => { raw[k] = v; },
  };
}

describe('detectLagano', () => {
  it('defaults to false (the modern path) when nothing is injected', () => {
    expect(detectLagano()).toBe(false);
    expect(detectLagano({})).toBe(false);
  });

  it('?lagano=1 forces the light path and remembers it', () => {
    const storage = fakeStorage();
    expect(detectLagano({ search: '?lagano=1', storage })).toBe(true);
    expect(storage.raw[LAGANO_STORAGE_KEY]).toBe('1');
  });

  it('?lagano=0 forces the modern path even on a device that would otherwise auto-detect light', () => {
    const storage = fakeStorage();
    expect(detectLagano({
      search: '?lagano=0',
      storage,
      navigator: { deviceMemory: 0.5 },
      matchMedia: () => ({ matches: true }),
      canWebgl: () => false,
    })).toBe(false);
    expect(storage.raw[LAGANO_STORAGE_KEY]).toBe('0');
  });

  it('the stored answer wins over a fresh detection, so the probe runs once per device', () => {
    const storage = fakeStorage({ [LAGANO_STORAGE_KEY]: '1' });
    // A capable device (plenty of memory, no reduced-data, WebGL available)
    // would auto-detect false, but the stored '1' short-circuits detection.
    expect(detectLagano({
      storage,
      navigator: { deviceMemory: 8 },
      matchMedia: () => ({ matches: false }),
      canWebgl: () => true,
    })).toBe(true);

    const storageFalse = fakeStorage({ [LAGANO_STORAGE_KEY]: '0' });
    expect(detectLagano({ storage: storageFalse, navigator: { deviceMemory: 0.5 } })).toBe(false);
  });

  it('deviceMemory <= 1 triggers the light path in isolation', () => {
    expect(detectLagano({ navigator: { deviceMemory: 1 } })).toBe(true);
    expect(detectLagano({ navigator: { deviceMemory: 0.5 } })).toBe(true);
    expect(detectLagano({ navigator: { deviceMemory: 4 } })).toBe(false);
  });

  it('prefers-reduced-data: reduce triggers the light path in isolation', () => {
    expect(detectLagano({ matchMedia: (q) => ({ matches: q === '(prefers-reduced-data: reduce)' }) })).toBe(true);
    expect(detectLagano({ matchMedia: () => ({ matches: false }) })).toBe(false);
  });

  it('a failed WebGL context triggers the light path in isolation', () => {
    expect(detectLagano({ canWebgl: () => false })).toBe(true);
    expect(detectLagano({ canWebgl: () => true })).toBe(false);
  });

  it('auto-detection is remembered so a second call does not need the probe again', () => {
    const storage = fakeStorage();
    expect(detectLagano({ storage, navigator: { deviceMemory: 0.5 } })).toBe(true);
    expect(storage.raw[LAGANO_STORAGE_KEY]).toBe('1');
    // No navigator/matchMedia/canWebgl this time: the stored answer carries it.
    expect(detectLagano({ storage })).toBe(true);
  });

  it('every access is guarded: a throwing probe still resolves to a boolean instead of throwing', () => {
    const throwing = {
      getItem(): never { throw new Error('storage disabled'); },
      setItem(): never { throw new Error('storage disabled'); },
    };
    expect(() => detectLagano({
      search: '?lagano=1',
      storage: throwing,
      matchMedia: () => { throw new Error('no matchMedia'); },
      canWebgl: () => { throw new Error('no webgl probe'); },
    })).not.toThrow();
  });
});

describe('markLagano', () => {
  it('writes documentElement.dataset.lagano so CSS can answer too', () => {
    const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    markLagano(root, true);
    expect(root.dataset.lagano).toBe('1');
    markLagano(root, false);
    expect(root.dataset.lagano).toBe('0');
  });
});
