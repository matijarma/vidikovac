// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createThemeController, THEME_STORAGE_KEY } from '../../app/src/ui/theme';

class FakeMedia {
  matches: boolean;
  private listeners = new Set<() => void>();
  constructor(matches: boolean) { this.matches = matches; }
  addEventListener(type: string, l: () => void): void { if (type === 'change') this.listeners.add(l); }
  removeEventListener(type: string, l: () => void): void { if (type === 'change') this.listeners.delete(l); }
  set(matches: boolean): void { this.matches = matches; this.listeners.forEach((l) => l()); }
  get listenerCount(): number { return this.listeners.size; }
}
function fakeStorage(initial: Record<string, string> = {}) {
  const raw = { ...initial };
  return { raw, getItem: (k: string) => (k in raw ? raw[k]! : null), setItem: (k: string, v: string) => { raw[k] = v; } };
}
function fakeTimers() {
  let fn: (() => void) | null = null;
  return {
    setInterval: (f: () => void) => { fn = f; return 7; },
    clearInterval: () => { fn = null; },
    tick: () => fn?.(),
    get armed() { return fn !== null; },
  };
}
const media = (dark: boolean) => new FakeMedia(dark) as unknown as MediaQueryList;

beforeEach(() => { document.head.innerHTML = '<meta name="theme-color" content="">'; });

describe('createThemeController', () => {
  it('defaults to auto and follows the OS', () => {
    const root = document.createElement('html');
    const c = createThemeController({ root, media: media(true), storage: fakeStorage() });
    expect(c.getPreference()).toBe('auto');
    expect(c.getResolvedTheme()).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('auto');
    expect(root.getAttribute('data-theme-resolved')).toBe('dark');
  });
  it('persists under vidikovac-theme and reads it back', () => {
    const root = document.createElement('html');
    const storage = fakeStorage();
    createThemeController({ root, media: media(false), storage }).setPreference('dark');
    expect(storage.raw[THEME_STORAGE_KEY]).toBe('dark');
    const again = createThemeController({ root, media: media(false), storage });
    expect(again.getPreference()).toBe('dark');
  });
  it('ignores an unknown stored value', () => {
    const root = document.createElement('html');
    const c = createThemeController({ root, media: media(false), storage: fakeStorage({ [THEME_STORAGE_KEY]: 'neon' }) });
    expect(c.getPreference()).toBe('auto');
  });
  it('auto follows a live media change; a pinned theme does not', () => {
    const root = document.createElement('html');
    const m = new FakeMedia(false);
    const c = createThemeController({ root, media: m as unknown as MediaQueryList, storage: fakeStorage() });
    m.set(true);
    expect(root.getAttribute('data-theme-resolved')).toBe('dark');
    c.setPreference('light');
    m.set(false); m.set(true);
    expect(c.getResolvedTheme()).toBe('light');
  });
  it('solar picks light in daylight and dark after sunset for Zagreb', () => {
    const root = document.createElement('html');
    const timers = fakeTimers();
    let now = new Date('2026-09-11T10:00:00Z');
    const c = createThemeController({
      root, media: media(true), storage: fakeStorage(), defaultPreference: 'solar',
      now: () => now, setInterval: timers.setInterval, clearInterval: timers.clearInterval,
    });
    expect(c.getPreference()).toBe('solar');
    expect(c.getResolvedTheme()).toBe('light');
    expect(root.getAttribute('data-theme-resolved')).toBe('light');
    now = new Date('2026-09-11T20:00:00Z');
    timers.tick();
    expect(root.getAttribute('data-theme-resolved')).toBe('dark');
  });
  it('solar arms a periodic re-check only while solar is active', () => {
    const root = document.createElement('html');
    const timers = fakeTimers();
    const c = createThemeController({ root, media: media(true), storage: fakeStorage(), setInterval: timers.setInterval, clearInterval: timers.clearInterval });
    expect(timers.armed).toBe(false);
    c.setPreference('solar');
    expect(timers.armed).toBe(true);
    c.setPreference('dark');
    expect(timers.armed).toBe(false);
  });
  it('onChange fires immediately and on change; unsubscribe stops it; destroy detaches media', () => {
    const root = document.createElement('html');
    const m = new FakeMedia(false);
    const c = createThemeController({ root, media: m as unknown as MediaQueryList, storage: fakeStorage() });
    const seen: string[] = [];
    const off = c.onChange((s) => seen.push(s.resolved));
    c.setPreference('dark');
    expect(seen).toEqual(['light', 'dark']);
    off();
    c.setPreference('light');
    expect(seen).toEqual(['light', 'dark']);
    expect(m.listenerCount).toBe(1);
    c.destroy();
    expect(m.listenerCount).toBe(0);
  });
  it('syncs <meta name="theme-color"> from the live --color-canvas', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.style.setProperty('--color-canvas', '#abcdef');
    createThemeController({ root, media: media(false), storage: fakeStorage(), documentRef: document });
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#abcdef');
    root.remove();
  });
  it('falls back to the palette canvas when the custom property is unreadable', () => {
    const root = document.createElement('html'); // detached: computed style is empty
    createThemeController({ root, media: media(true), storage: fakeStorage(), documentRef: document });
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#0b1150');
  });
  it('tolerates a storage that throws', () => {
    const root = document.createElement('html');
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const c = createThemeController({ root, media: media(false), storage: throwing });
    expect(() => c.setPreference('dark')).not.toThrow();
    expect(c.getResolvedTheme()).toBe('dark');
    vi.restoreAllMocks();
  });
});
