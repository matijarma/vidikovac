// The page's state in its address, so a link shows what its sender saw:
// ?t=2026-09-28T07:45 (Zagreb time, inside the window), &brzina=600 (one of
// SPEEDS), &usporedba=0 (the comparison overlay off; on by default, S-17),
// &panel=<PanelId> (the expanded panel), &linija=228 or &stanica=<id> (the
// subject), &mreza=0 (the living network off) and &prati=0 (the camera not
// following the recording). Written by replaceState, never pushed: the back
// button leaves the page, it does not scrub it.
import { SNIMKA_WINDOW, SPEEDS, type Speed } from '../../../shared/snimka';
import type { PanelId, Subject } from './contracts';
import { formatZagrebLocal, parseZagrebLocal } from './format';

export interface AddressRead { t: number | null; speed: Speed | null; compare: boolean; panel: PanelId | null; subject: Subject | null; live: boolean; following: boolean }
export interface AddressState { t: number; speed: Speed; compare: boolean; panel: PanelId | null; subject: Subject | null; live: boolean; following: boolean }

export const WINDOW_START_MS = SNIMKA_WINDOW.fromSec * 1000;
export const WINDOW_END_MS = SNIMKA_WINDOW.toSec * 1000;

export const PANEL_IDS: readonly PanelId[] = ['stanje', 'vozila', 'linije', 'mreza', 'bicikli', 'vrijeme', 'poglavlja'];
const OWN_KEYS = ['t', 'brzina', 'usporedba', 'panel', 'linija', 'stanica', 'mreza', 'prati'];
/** A subject id as a link carries it: a route's GTFS id or a BAJS station id, short and plain. */
const ID = /^[A-Za-z0-9_.:-]{1,40}$/;

const ABSENT: AddressRead = { t: null, speed: null, compare: true, panel: null, subject: null, live: true, following: true };

export function readAddress(search: string): AddressRead {
  let q: URLSearchParams;
  try { q = new URLSearchParams(search); } catch { return { ...ABSENT }; }
  const rawT = q.get('t');
  let t: number | null = null;
  if (rawT) {
    const ms = parseZagrebLocal(rawT);
    if (ms !== null && ms >= WINDOW_START_MS && ms <= WINDOW_END_MS) t = ms;
  }
  // The speed is one of four literal words; "600.0" or " 600" is nobody's link.
  const rawSpeed = q.get('brzina');
  const speed = SPEEDS.find((s) => String(s) === rawSpeed) ?? null;
  const rawPanel = q.get('panel');
  const panel = PANEL_IDS.find((p) => p === rawPanel) ?? null;
  const linija = q.get('linija');
  const stanica = q.get('stanica');
  const subject: Subject | null = linija && ID.test(linija) ? { kind: 'route', id: linija } : stanica && ID.test(stanica) ? { kind: 'station', id: stanica } : null;
  return { t, speed, compare: q.get('usporedba') !== '0', panel, subject, live: q.get('mreza') !== '0', following: q.get('prati') !== '0' };
}

export type Replace = (data: unknown, unused: string, url: string) => void;
export interface AddressLocation { pathname: string; search: string; hash: string }

/** Writes the state into the address (own keys first, every other parameter kept) and returns the URL it wrote.
 *  A default (compare, live and following on, no panel, no subject) writes nothing, so a plain link stays short. */
export function writeAddress(state: AddressState, replace: Replace = history.replaceState.bind(history), loc: AddressLocation = location): string {
  const rest = new URLSearchParams(loc.search);
  for (const key of OWN_KEYS) rest.delete(key);
  // The time keeps its colon: URLSearchParams would write 07%3A45, which no one wants to read in a shared link.
  const own = [`t=${formatZagrebLocal(Math.min(WINDOW_END_MS, Math.max(WINDOW_START_MS, state.t)))}`, `brzina=${state.speed}`];
  if (!state.compare) own.push('usporedba=0');
  if (state.panel) own.push(`panel=${state.panel}`);
  if (state.subject?.kind === 'route' && ID.test(state.subject.id)) own.push(`linija=${state.subject.id}`);
  else if (state.subject?.kind === 'station' && ID.test(state.subject.id)) own.push(`stanica=${state.subject.id}`);
  if (!state.live) own.push('mreza=0');
  if (!state.following) own.push('prati=0');
  const tail = rest.toString();
  const url = `${loc.pathname}?${own.join('&')}${tail ? `&${tail}` : ''}${loc.hash}`;
  replace(null, '', url);
  return url;
}
