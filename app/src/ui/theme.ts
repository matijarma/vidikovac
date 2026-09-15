// Theme controller. Ported from psdlat packages/ui/src/theme.ts (AGPL-3.0-or-later)
// with a fourth preference, `solar`: light between sunrise and sunset in
// Zagreb, dark otherwise, re-evaluated once a minute. `auto` follows the OS
// live via matchMedia. Every preference writes BOTH `data-theme` (the choice)
// and `data-theme-resolved` (light|dark); tokens.css switches on the latter.
import { isDaylight } from './solar';

export type ThemePreference = 'auto' | 'light' | 'dark' | 'solar';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeState { preference: ThemePreference; resolved: ResolvedTheme }

export interface ThemeControllerOptions {
  root?: HTMLElement;
  defaultPreference?: ThemePreference;
  media?: MediaQueryList;
  /** `null` disables persistence; omitted uses window.localStorage when readable. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  storageKey?: string;
  documentRef?: Document;
  now?: () => Date;
  daylight?: (at: Date) => boolean;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  solarTickMs?: number;
}

export interface ThemeController {
  getPreference(): ThemePreference;
  getResolvedTheme(): ResolvedTheme;
  setPreference(next: ThemePreference): void;
  onChange(listener: (state: ThemeState) => void): () => void;
  destroy(): void;
}

export const THEME_STORAGE_KEY = 'vidikovac-theme';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['auto', 'light', 'dark', 'solar'];
const ALLOWED = new Set<ThemePreference>(THEME_PREFERENCES);
/** Matches --palette-*-canvas in tokens.css; used only when the property cannot be read. */
const THEME_COLOR_FALLBACK: Record<ResolvedTheme, string> = { light: '#f4f2ec', dark: '#0b1150' };

export function createThemeController(options: ThemeControllerOptions = {}): ThemeController {
  const root = options.root ?? document.documentElement;
  const defaultPreference = options.defaultPreference ?? 'auto';
  const media = options.media ?? window.matchMedia('(prefers-color-scheme: dark)');
  const storage = options.storage === undefined ? safeLocalStorage() : options.storage ?? undefined;
  const storageKey = options.storageKey ?? THEME_STORAGE_KEY;
  const documentRef = options.documentRef ?? document;
  const now = options.now ?? (() => new Date());
  const daylight = options.daylight ?? isDaylight;
  const setTimer = options.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearTimer = options.clearInterval ?? ((h) => globalThis.clearInterval(h as never));
  const solarTickMs = options.solarTickMs ?? 60_000;

  let preference = readStored(storage, storageKey, defaultPreference);
  let lastResolved: ResolvedTheme | null = null;
  let solarTimer: unknown = null;
  const listeners = new Set<(state: ThemeState) => void>();

  const handleMediaChange = (): void => { if (preference === 'auto') notify(); };

  apply(preference, false);
  attachMediaListener(media, handleMediaChange);

  function resolve(): ResolvedTheme {
    if (preference === 'auto') return media.matches ? 'dark' : 'light';
    if (preference === 'solar') return daylight(now()) ? 'light' : 'dark';
    return preference;
  }

  function armSolar(): void {
    if (preference === 'solar' && solarTimer === null) {
      solarTimer = setTimer(() => { if (resolve() !== lastResolved) notify(); }, solarTickMs);
    } else if (preference !== 'solar' && solarTimer !== null) {
      clearTimer(solarTimer);
      solarTimer = null;
    }
  }

  function apply(next: ThemePreference, persist: boolean): void {
    preference = sanitize(next, defaultPreference);
    root.setAttribute('data-theme', preference);
    if (persist && storage) {
      try { storage.setItem(storageKey, preference); } catch { /* private mode or quota */ }
    }
    armSolar();
    notify();
  }

  function notify(): void {
    const resolved = resolve();
    lastResolved = resolved;
    root.setAttribute('data-theme-resolved', resolved);
    const meta = documentRef.querySelector('meta[name="theme-color"]');
    if (meta) {
      let css = '';
      try { css = getComputedStyle(root).getPropertyValue('--color-canvas').trim(); } catch { css = ''; }
      meta.setAttribute('content', css || THEME_COLOR_FALLBACK[resolved]);
    }
    const state: ThemeState = { preference, resolved };
    listeners.forEach((l) => l(state));
  }

  return {
    getPreference: () => preference,
    getResolvedTheme: () => resolve(),
    setPreference(next) { apply(next, true); },
    onChange(listener) {
      listeners.add(listener);
      listener({ preference, resolved: resolve() });
      return () => { listeners.delete(listener); };
    },
    destroy() {
      detachMediaListener(media, handleMediaChange);
      if (solarTimer !== null) { clearTimer(solarTimer); solarTimer = null; }
      listeners.clear();
    },
  };
}

function safeLocalStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}
function readStored(storage: Pick<Storage, 'getItem'> | undefined, key: string, fallback: ThemePreference): ThemePreference {
  if (!storage) return fallback;
  try { return sanitize(storage.getItem(key), fallback); } catch { return fallback; }
}
function sanitize(value: unknown, fallback: ThemePreference): ThemePreference {
  return typeof value === 'string' && ALLOWED.has(value as ThemePreference) ? (value as ThemePreference) : fallback;
}
function attachMediaListener(media: MediaQueryList, listener: () => void): void {
  if (typeof media.addEventListener === 'function') { media.addEventListener('change', listener); return; }
  (media as unknown as { addListener?: (l: () => void) => void }).addListener?.(listener);
}
function detachMediaListener(media: MediaQueryList, listener: () => void): void {
  if (typeof media.removeEventListener === 'function') { media.removeEventListener('change', listener); return; }
  (media as unknown as { removeListener?: (l: () => void) => void }).removeListener?.(listener);
}
