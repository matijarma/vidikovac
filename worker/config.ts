import type { Env } from './env';

export const VERSION = '0.1.0';

export function sessionMinutes(env: Env): number {
  return positive(env.SESSION_MINUTES, 10);
}
export function peerMinutes(env: Env): number {
  return positive(env.PEER_MINUTES, 5);
}
export function codeRotateSeconds(env: Env): number {
  return positive(env.CODE_ROTATE_SECONDS, 30);
}
export type NetworkCheck = 'enforce' | 'warn' | 'off';
/** Compatibility health field. Network-based access restriction was removed. */
export function networkCheck(_env: Env): NetworkCheck {
  return 'off';
}

/** Security defaults to production, independently of any retired network flag. */
export function isTestEnvironment(env: Env): boolean {
  return env.APP_ENV === 'test';
}

function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
