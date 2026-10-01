// The page's state in its address, so a link shows what its sender saw:
// ?t=2026-09-28T07:45 (Zagreb time, inside the window), &brzina=600 (one of
// SPEEDS) and &usporedba=1 (the comparison overlay). Written by replaceState,
// never pushed: the back button leaves the page, it does not scrub it.
import { SNIMKA_WINDOW, SPEEDS, type Speed } from '../../../shared/snimka';
import { formatZagrebLocal, parseZagrebLocal } from './format';

export interface AddressRead { t: number | null; speed: Speed | null; compare: boolean }
export interface AddressState { t: number; speed: Speed; compare: boolean }

export const WINDOW_START_MS = SNIMKA_WINDOW.fromSec * 1000;
export const WINDOW_END_MS = SNIMKA_WINDOW.toSec * 1000;

const OWN_KEYS = ['t', 'brzina', 'usporedba'];

export function readAddress(search: string): AddressRead {
  let q: URLSearchParams;
  try { q = new URLSearchParams(search); } catch { return { t: null, speed: null, compare: false }; }
  const rawT = q.get('t');
  let t: number | null = null;
  if (rawT) {
    const ms = parseZagrebLocal(rawT);
    if (ms !== null && ms >= WINDOW_START_MS && ms <= WINDOW_END_MS) t = ms;
  }
  // The speed is one of four literal words; "600.0" or " 600" is nobody's link.
  const rawSpeed = q.get('brzina');
  const speed = SPEEDS.find((s) => String(s) === rawSpeed) ?? null;
  return { t, speed, compare: q.get('usporedba') === '1' };
}

export type Replace = (data: unknown, unused: string, url: string) => void;
export interface AddressLocation { pathname: string; search: string; hash: string }

/** Writes the state into the address (own keys first, every other parameter kept) and returns the URL it wrote. */
export function writeAddress(state: AddressState, replace: Replace = history.replaceState.bind(history), loc: AddressLocation = location): string {
  const rest = new URLSearchParams(loc.search);
  for (const key of OWN_KEYS) rest.delete(key);
  // The time keeps its colon: URLSearchParams would write 07%3A45, which no one wants to read in a shared link.
  const own = [`t=${formatZagrebLocal(Math.min(WINDOW_END_MS, Math.max(WINDOW_START_MS, state.t)))}`, `brzina=${state.speed}`];
  if (state.compare) own.push('usporedba=1');
  const tail = rest.toString();
  const url = `${loc.pathname}?${own.join('&')}${tail ? `&${tail}` : ''}${loc.hash}`;
  replace(null, '', url);
  return url;
}
