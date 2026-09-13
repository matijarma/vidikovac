// What a screen remembers about itself between reloads, and what its phase
// is. The stored record is the ordinary BeaconCredentials (beacon.ts): the
// id, the secret and -- since real screen creation -- the screen metadata
// (kind, expiry, stop). Nothing here ever renders or logs the secret.
import type { ScreenMetadata } from '../../../worker/protocol';
import { BEACON_STORAGE_KEY, type BeaconCredentials } from '../beacon';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * setup       no credentials: the two-step self-service wizard
 * invitation  credentials, no grant: the map, the QR and the local content
 * paired      a redeemed code opened a room; the screen mirrors the driver
 * expired     a temporary screen past its 24 h: no codes, a manual way back
 * revoked     the operator switched the screen off: no codes, a manual way back
 */
export type KioskPhase = 'setup' | 'invitation' | 'paired' | 'expired' | 'revoked';

/** A temporary screen past its expiry issues no grants (the DO answers
 *  'revoked' to every 'more'); the kiosk says "expired" instead, and never
 *  recreates a screen on its own. */
export function screenExpired(screen: ScreenMetadata | null | undefined, now: number): boolean {
  return Boolean(screen && screen.expiresAt !== null && screen.expiresAt <= now);
}

/** Milliseconds until a screen's expiry; null when it never expires. */
export function msUntilExpiry(screen: ScreenMetadata | null | undefined, now: number): number | null {
  if (!screen || screen.expiresAt === null) return null;
  return Math.max(0, screen.expiresAt - now);
}

/** The same credentials with fresher screen metadata (the beacon's own
 *  'codes' frame carries the authoritative copy), never a new secret. */
export function withScreen(credentials: BeaconCredentials, screen: ScreenMetadata): BeaconCredentials {
  return { beaconId: credentials.beaconId, secret: credentials.secret, screen };
}

/** Forgetting is explicit: only the "set up a new screen" action calls it. */
export function forgetBeacon(storage: StorageLike | null | undefined): void {
  try { storage?.removeItem(BEACON_STORAGE_KEY); } catch { /* storage disabled */ }
}
