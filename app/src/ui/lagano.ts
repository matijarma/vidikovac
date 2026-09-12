// R-L1: the lightweight-mode flag, decided once per entry and passed down as
// a dependency exactly as `reducedMotion` already is. Every input is
// injected (no direct `navigator`/`location`/`matchMedia` reads here) so this
// stays testable in plain node, and every access is guarded: a probe that
// throws (storage disabled, matchMedia rejecting an odd query) degrades to
// the next check instead of crashing the entry that called it.
export const LAGANO_STORAGE_KEY = 'vidikovac-lagano';

export interface LaganoProbe {
  search?: string;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  navigator?: { deviceMemory?: number };
  matchMedia?: (q: string) => { matches: boolean };
  canWebgl?: () => boolean;
}

function readExplicit(search: string | undefined): boolean | null {
  if (!search) return null;
  try {
    const value = new URLSearchParams(search).get('lagano');
    if (value === '1') return true;
    if (value === '0') return false;
  } catch { /* malformed query string */ }
  return null;
}

function readStored(storage: LaganoProbe['storage']): boolean | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LAGANO_STORAGE_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch { /* private mode or storage disabled */ }
  return null;
}

function writeStored(storage: LaganoProbe['storage'], value: boolean): void {
  if (!storage) return;
  try { storage.setItem(LAGANO_STORAGE_KEY, value ? '1' : '0'); } catch { /* private mode or quota */ }
}

function autoDetect(probe: LaganoProbe): boolean {
  try { if ((probe.navigator?.deviceMemory ?? Infinity) <= 1) return true; } catch { /* hostile navigator shim */ }
  try { if (probe.matchMedia?.('(prefers-reduced-data: reduce)').matches) return true; } catch { /* matchMedia can throw */ }
  try { if (probe.canWebgl?.() === false) return true; } catch { /* WebGL probe itself can throw */ }
  return false;
}

/** True when the device or the URL asks for the light path. Remembers an
 *  auto-detected answer so the probe runs once per device. */
export function detectLagano(probe: LaganoProbe = {}): boolean {
  const explicit = readExplicit(probe.search);
  if (explicit !== null) {
    writeStored(probe.storage, explicit);
    return explicit;
  }
  const stored = readStored(probe.storage);
  if (stored !== null) return stored;
  const detected = autoDetect(probe);
  writeStored(probe.storage, detected);
  return detected;
}

/** Writes documentElement.dataset.lagano so CSS can answer too. */
export function markLagano(root: HTMLElement, lagano: boolean): void {
  root.dataset.lagano = lagano ? '1' : '0';
}
