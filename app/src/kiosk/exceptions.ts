// The readings the exceptions card and the header's line must agree on.
// Both say "what is not going to plan in the city right now" -- the card in
// rows, the ticker in one sentence at a time -- and a screen that draws them
// from two filters says two different things at once: the card omitting a
// line the header leads with, or the header leading with an outlier the card
// has already thrown away (a 74-minute median from a trip update nobody
// closed). One filter, one order, one window, read here by both.
//
// Pure: snapshots in, plain rows out. No DOM, no clock of its own, no copy.
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import { dataText } from '../panels/panel';
import { byModule, isLive, plausibleDelay, routeDelays } from './local';
import { routeType } from './stops';

/** Under three minutes a median is a timetable breathing, not an exception: a
 *  card that names it says nothing a rider would change a plan over, and the
 *  count beside it ("+N linija kasni") would be the whole network. */
export const EXCEPTION_MIN_S = 180;
/** Past half an hour a median is an outlier the feed has not caught up with --
 *  a broken trip update, a vehicle parked mid-route -- and not an exception a
 *  rider can plan around. routeDelays has already dropped the impossible ones
 *  (plausibleDelay); this is where news stops and noise starts. */
export const EXCEPTION_MAX_S = 30 * 60;
/** A ZET notice is worth a card or a line while it is this fresh. */
export const ZET_NOTICE_WINDOW_MS = 48 * 3_600_000;
/** The gazette's first row is the issue's own table of contents, not an act. */
export const GAZETTE_CONTENTS_TITLE = 'Sadržaj';
/** A route the static table has no type for sorts after the buses, never before the trams. */
const UNKNOWN_ROUTE_TYPE = 9;

/** The mode a route number is drawn in: tram, bus, or the plain badge for a route the table does not know. */
export function kindOfRoute(routeId: string): 'tram' | 'bus' | 'other' {
  const type = routeType(routeId);
  return type === 0 ? 'tram' : type === 3 ? 'bus' : 'other';
}

/** One route running outside the on-time band, with what the badge needs. */
export interface RouteException {
  routeId: string;
  /** The median, signed: positive is late, negative is early. */
  seconds: number;
  kind: 'tram' | 'bus' | 'other';
}

/**
 * Every route whose median a rider would notice, in the order a rider reads
 * them: what is running late before what is running early, trams before buses
 * before the routes the table does not know, then the largest first. The
 * caller takes as many as its box holds and counts the rest.
 */
export function rankedExceptions(modules: readonly ModuleSnapshot[]): RouteException[] {
  const zet = byModule(modules)['zet-rt'];
  if (!isLive(zet)) return [];
  return [...routeDelays(zet)]
    .filter(([, seconds]) => plausibleDelay(seconds) && Math.abs(seconds) >= EXCEPTION_MIN_S && Math.abs(seconds) <= EXCEPTION_MAX_S)
    .map(([routeId, seconds]) => ({ routeId, seconds, type: routeType(routeId) ?? UNKNOWN_ROUTE_TYPE, kind: kindOfRoute(routeId) }))
    .sort((a, b) => Number(a.seconds < 0) - Number(b.seconds < 0) || a.type - b.type || Math.abs(b.seconds) - Math.abs(a.seconds))
    .map(({ routeId, seconds, kind }) => ({ routeId, seconds, kind }));
}

/** ZET's own notices about the network while they are fresh, newest first. */
export function zetNotices(modules: readonly ModuleSnapshot[], now: number): FeedItem[] {
  const dogadanja = byModule(modules).dogadanja;
  return (isLive(dogadanja) ? dogadanja.items : [])
    .filter((item) => dataText(item, 'source') === 'zet-promet' && item.at && Date.parse(item.at) <= now && now - Date.parse(item.at) <= ZET_NOTICE_WINDOW_MS)
    .sort((a, b) => Date.parse(b.at!) - Date.parse(a.at!));
}
