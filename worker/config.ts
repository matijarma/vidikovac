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
export function networkCheck(env: Env): NetworkCheck {
  const v = (env.NETWORK_CHECK ?? 'enforce').toLowerCase();
  return v === 'warn' || v === 'off' ? v : 'enforce';
}

function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
