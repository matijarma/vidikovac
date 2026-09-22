// The wall's own preferences: how often the header sentence turns (Ritam) and
// whether the left of the wall is the map or the schematic network (Prikaz).
// Both belong to this browser, not to the screen's record: the Durable
// Object never hears of them, a reload keeps them, and forgetting the screen
// leaves them where they are (a venue's next screen reads the same). Read and
// written through the injected storage, like the credentials, so a private
// window or a disabled storage still has a working wall with the defaults.
import type { StorageLike } from './credentials';

/** Ritam 20 / 30 / 60 s: how long one written sentence stays in the header. */
export const RHYTHMS = [20, 30, 60] as const;
export type Rhythm = (typeof RHYTHMS)[number];
export const DEFAULT_RHYTHM: Rhythm = 20;
export const RHYTHM_STORAGE_KEY = 'vidikovac-kiosk-rhythm';

/** Prikaz: the map framed on the place, or the schematic network without zoom [O-72]. */
export const WALL_VIEWS = ['map', 'schema'] as const;
export type WallView = (typeof WALL_VIEWS)[number];
export const DEFAULT_WALL_VIEW: WallView = 'map';
export const VIEW_STORAGE_KEY = 'vidikovac-kiosk-view';

export function isRhythm(x: unknown): x is Rhythm {
  return (RHYTHMS as readonly unknown[]).includes(x);
}

export function isWallView(x: unknown): x is WallView {
  return (WALL_VIEWS as readonly unknown[]).includes(x);
}

function read(storage: StorageLike | null | undefined, key: string): string | null {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}

function write(storage: StorageLike | null | undefined, key: string, value: string): void {
  try { storage?.setItem(key, value); } catch { /* private mode: the choice lasts until the reload */ }
}

/** The stored rhythm, or DEFAULT_RHYTHM for anything that is not 20, 30 or 60. */
export function readRhythm(storage: StorageLike | null | undefined): Rhythm {
  const stored = Number(read(storage, RHYTHM_STORAGE_KEY));
  return isRhythm(stored) ? stored : DEFAULT_RHYTHM;
}

export function writeRhythm(storage: StorageLike | null | undefined, rhythm: Rhythm): void {
  write(storage, RHYTHM_STORAGE_KEY, String(rhythm));
}

/** The stored view, or DEFAULT_WALL_VIEW for anything that is not 'map' or 'schema'. */
export function readView(storage: StorageLike | null | undefined): WallView {
  const stored = read(storage, VIEW_STORAGE_KEY);
  return isWallView(stored) ? stored : DEFAULT_WALL_VIEW;
}

export function writeView(storage: StorageLike | null | undefined, view: WallView): void {
  write(storage, VIEW_STORAGE_KEY, view);
}

/** The value after `current` in a click-toggle's cycle (4 → 6 → 8 → 4); an unknown value starts the cycle. */
export function nextInCycle<T>(values: readonly T[], current: T): T {
  const i = values.indexOf(current);
  return values[(i + 1) % values.length]!;
}
