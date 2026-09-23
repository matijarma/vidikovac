// The Sada feed's one adapter (companion WP4 step 3; seams S2, S5, S6): what
// the phone hands the "U blizini" selection (city/nearby.ts selectNearby) and
// the sentence writer (city/sentence.ts), read from the layer context, and the
// one door to the module that draws both (city/nearby-markup.ts). Sada and the
// Karta sheet read the same rows through this file, so a rename on the
// selection side touches nothing else.
//
// No fallback of its own: the rows are WP1's selection, the markup is the
// wall's (kiosk/timeline.ts), the sentence WP1's templates. They carry the
// external-text policy and the kiosk's helpers, more than the phone's first
// screen may weigh (test/app/budget.test.ts, the 200 kB promise), so they
// load as one chunk once Sada first asks, and the page draws again when it
// is in hand (ctx.onLocalData). Until then the list and the sentence hold
// their place with one busy row each; a chunk that will not load leaves both
// out rather than promising them.
import { DEFAULT_FRAME_STOPS, frameRadiusM, frameStopsFrom, type FrameLine, type FrameStop } from '../../../shared/city/frame';
import type { ScreenPlace } from '../../../shared/city/place';
import { emptyCity, type DepartureBoard } from '../../../shared/city/types';
import type { ScreenStop } from '../core/contracts';
import { platformIds } from '../kiosk/arrivals';
import { routeType } from '../kiosk/stops';
import type { LayerContext } from '../layers/types';
import { vehicleFixes } from '../motion/fixes';
import type { NearbyInput } from './nearby';
import { resolvePlace, type PlaceContext } from './place';

/** The rows "U blizini" shows on the phone and beside the map on a desk (§12 bounds; one timeless row is kept). */
export const NEARBY_PHONE_ROWS = 8;
export const NEARBY_DESK_ROWS = 12;

const isTram = (routeId: string): boolean => routeType(routeId) === 0;

/** The page's place, else one resolved from the context (a unit context, a surface with no dashboard). */
export function feedPlace(ctx: LayerContext): PlaceContext {
  return ctx.place ?? resolvePlace({ screen: ctx.screen, saved: ctx.saved, stops: ctx.stops, location: ctx.location });
}

/**
 * The place as the selection reads it (seam S3's ScreenPlace): the place's own
 * stop, or for Trg bana J. Jelačića the stop its departures come from, with its
 * mode; otherwise the point as an address.
 */
export function nearbyPlace(place: PlaceContext): ScreenPlace {
  const stop = place.stop ?? (place.kind === 'city' ? place.departuresStop : null);
  if (stop) return { kind: stop.routes.some(isTram) ? 'tram' : 'bus', name: place.name, lon: place.lon, lat: place.lat, stopId: stop.id };
  return { kind: 'address', name: place.name, lon: place.lon, lat: place.lat };
}

/** The frame's view of a stop table, built once per catalogue and line set (a poll redraws with the same arrays). */
const tables = new WeakMap<readonly ScreenStop[], { lines: readonly FrameLine[] | undefined; table: FrameStop[] }>();
function frameTable(stops: readonly ScreenStop[], lines: readonly FrameLine[] | undefined): FrameStop[] {
  const held = tables.get(stops);
  if (held && held.lines === lines) return held.table;
  const table = frameStopsFrom(stops, isTram, lines ?? []);
  tables.set(stops, { lines, table });
  return table;
}

/** The circle around the place, metres: the screen's Kadar measured per place (shared/city/frame.ts frameRadiusM). */
export function feedRadiusM(ctx: LayerContext, place: ScreenPlace): number {
  const table = ctx.stops?.length ? frameTable(ctx.stops, ctx.frameLines) : [];
  return frameRadiusM(place, table, ctx.frame ?? DEFAULT_FRAME_STOPS);
}

/** The boards the page already holds for the departures stop's platforms (the departures block asks for them). */
function heldBoards(ctx: LayerContext, stop: ScreenStop | null): DepartureBoard[] {
  if (!stop || !ctx.boards) return [];
  return platformIds(stop, ctx.stops).map((id) => ctx.boards!.get('zet', id)).filter((b): b is DepartureBoard => Boolean(b));
}

/**
 * Everything selectNearby reads, from the layer context: the place, its
 * circle, the boards and vehicles the departures block reads, the feeds, the
 * city, the place's last-run file, one clock (the frozen moment once the
 * session ended). Pure: it asks for nothing.
 */
export function nearbyInput(ctx: LayerContext, placeContext: PlaceContext = feedPlace(ctx)): NearbyInput {
  const now = ctx.frozenAt ?? ctx.now;
  const place = nearbyPlace(placeContext);
  return {
    place,
    radiusM: feedRadiusM(ctx, place),
    now,
    boards: heldBoards(ctx, placeContext.departuresStop),
    fixes: vehicleFixes(ctx.snapshots['zet-rt'], now),
    snapshots: ctx.snapshots,
    city: ctx.city ?? emptyCity(),
    lastRun: ctx.lastRun ?? null,
    locale: ctx.i18n.getLocale(),
    i18n: ctx.i18n,
    ...(ctx.stops ? { stops: ctx.stops } : {}),
  };
}

// --- the feed module, loaded once ------------------------------------------------

export type SadaFeedModule = typeof import('./nearby-markup');

/** How often a chunk that failed to load is asked for again (one per draw) before the feed is left out. */
export const FEED_ATTEMPTS = 3;

let feedModule: SadaFeedModule | null = null;
let feedLoad: Promise<SadaFeedModule | null> | null = null;
let feedFailures = 0;
/** Whom to tell once the chunk is in hand: each page's repaint, once however often it drew meanwhile. */
const waiting = new Set<() => void>();

/** Loads the feed module (once; a failure is asked again on a later call, FEED_ATTEMPTS times in all). */
export function loadSadaFeed(): Promise<SadaFeedModule | null> {
  if (feedModule) return Promise.resolve(feedModule);
  if (feedFailures >= FEED_ATTEMPTS) return Promise.resolve(null);
  feedLoad ??= import('./nearby-markup').then((module) => {
    feedModule = module;
    const told = [...waiting];
    waiting.clear();
    for (const repaint of told) repaint();
    return module;
  }, () => {
    feedFailures += 1;
    feedLoad = null;
    return null;
  });
  return feedLoad;
}

/**
 * The feed module when it is in hand; otherwise starts the load, remembers the
 * page's repaint and answers 'loading', or 'down' once the chunk failed
 * FEED_ATTEMPTS times.
 */
export function sadaFeed(onReady?: () => void): SadaFeedModule | 'loading' | 'down' {
  if (feedModule) return feedModule;
  if (feedFailures >= FEED_ATTEMPTS) return 'down';
  if (onReady) waiting.add(onReady);
  void loadSadaFeed();
  return 'loading';
}
