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
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { DEFAULT_FRAME_STOPS, frameRadiusM, frameStopsFrom, type FrameLine, type FrameStop } from '../../../shared/city/frame';
import { distanceM, located } from '../../../shared/city/geo';
import { openPlacesNear } from '../../../shared/city/osm-hours';
import { isPublicHoliday } from '../../../shared/city/holidays';
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';
import type { ScreenPlace } from '../../../shared/city/place';
import { emptyCity, type DepartureBoard, type Place } from '../../../shared/city/types';
import type { ScreenStop } from '../core/contracts';
import { loadOpenHours, openHoursIndex, venueNameFor, venuePointFor } from '../core/open-hours';
import { platformIds } from '../kiosk/arrivals';
import { routeType } from '../kiosk/stops';
import type { LayerContext } from '../layers/types';
import { vehicleFixes } from '../motion/fixes';
import { zagrebDayKey } from '../format';
import type { NearbyInput } from './nearby';
import { railPolicy, serviceStateOf } from '../../../shared/city/service-state';
import { resolvePlace, type PlaceContext } from './place';

/** The rows "U blizini" shows on the phone and beside the map on a desk (§12 bounds; one timeless row is kept). */
export const NEARBY_PHONE_ROWS = 8;
export const NEARBY_DESK_ROWS = 12;

const isTram = (routeId: string): boolean => routeType(routeId) === 0;

/**
 * A fix older than this is no evidence a vehicle is still where it was: the twin's own eviction
 * (shared/motion/plan.ts EVICT_S, 180 s), kept as a number here so the phone's first screen does
 * not carry the planner (test/app/next-departures.test.ts pins the two equal).
 */
export const LIVE_FIX_MAX_AGE_MS = 180_000;

/**
 * Whether the transit feed may put a live time on a row now: not during an outage (status 'down')
 * and not once its last word is older than the twin keeps a fix. The wall's rule (city/nearby.ts
 * reads the outage; the twin evicts the fix), applied before any departures list is computed.
 */
export function feedLive(snapshot: ModuleSnapshot | undefined, now: number): boolean {
  if (!snapshot || snapshot.status === 'down') return false;
  const at = Date.parse(snapshot.sourceUpdatedAt ?? snapshot.fetchedAt);
  return !Number.isFinite(at) || now - at <= LIVE_FIX_MAX_AGE_MS;
}

/** The vehicles a departures list may call live: none during an outage, none from a fix the twin would have evicted. */
export function liveFixes(snapshot: ModuleSnapshot | undefined, now: number): ReturnType<typeof vehicleFixes> {
  if (!feedLive(snapshot, now)) return [];
  return vehicleFixes(snapshot, now).filter((fix) => now - fix.at <= LIVE_FIX_MAX_AGE_MS);
}

/** Per snapshot object: a poll hands the same one to every draw, and the set is built from a list of ids. */
const cancelledSets = new WeakMap<ModuleSnapshot, ReadonlySet<string>>();
const NO_TRIPS: ReadonlySet<string> = new Set();

/**
 * The trips ZET's no-service alerts name that no tracked vehicle carries (the twin's `sources.zet.noServiceTrips`,
 * upgrade U1), for arrivalsAt's `cancelled` option: none without a snapshot or while the transit feed is down. ZET's
 * CANCELED marker is not among them: on 21 and 24 Sep it marked 114 of 143 trips its vehicles drove on schedule.
 */
export function cancelledTrips(snapshot: ModuleSnapshot | undefined): ReadonlySet<string> {
  if (!snapshot || snapshot.status === 'down') return NO_TRIPS;
  const held = cancelledSets.get(snapshot);
  if (held) return held;
  const ids = snapshot.sources?.zet?.noServiceTrips ?? [];
  const set: ReadonlySet<string> = ids.length === 0 ? NO_TRIPS : new Set(ids);
  cancelledSets.set(snapshot, set);
  return set;
}

/**
 * Whether the third-party text policy is in hand. The boundary refuses every string until the
 * chunk that carries the policy (this feed's, or the map's) has loaded, so a renderer that would
 * otherwise say the text is missing holds its place instead.
 */
export function externalTextReady(): boolean {
  return vetExternal('name', 'Zagreb', 'row') !== null;
}

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

/** The boards the page already holds for the departures stop's platforms. */
function heldBoards(ctx: LayerContext, stop: ScreenStop | null): DepartureBoard[] {
  if (!stop || !ctx.boards) return [];
  return platformIds(stop, ctx.stops).map((id) => ctx.boards!.get('zet', id)).filter((b): b is DepartureBoard => Boolean(b));
}

/** How many HŽ stations inside the circle the list reads (docs/history/upgrade-2026-10-plan/U3.md S3). */
export const RAIL_STATIONS = 2;

/** The HŽ stations (the catalogue's rail places) inside the circle, the nearest first, RAIL_STATIONS at most: the wall
 *  (kiosk.ts) and the phone ask for the same boards. */
export function railStationsNear(places: readonly Place[], place: { lon: number; lat: number }, radiusM: number): (Place & { lon: number; lat: number })[] {
  return places
    .filter((p): p is Place & { lon: number; lat: number } => p.category === 'rail' && located(p))
    .map((p) => ({ p, d: distanceM(place, p) }))
    .filter(({ d }) => d <= radiusM)
    .sort((a, b) => a.d - b.d || a.p.id.localeCompare(b.p.id))
    .slice(0, RAIL_STATIONS)
    .map(({ p }) => p);
}

/**
 * Asks for what the facts-breadth rows read (U3 S3, S6): the HŽ stations (the catalogue's hz-schedule), the boards of
 * the nearest two inside the circle once they are in hand, and the OpenStreetMap hours (core/open-hours.ts, once a
 * session). The page redraws when a board or the hours land. Nothing is asked once the session ended.
 */
export function askNearby(ctx: LayerContext, placeContext: PlaceContext = feedPlace(ctx)): void {
  if (ctx.frozenAt !== undefined || ctx.session?.frozen) return;
  ctx.ensureCity?.(['hz-schedule']);
  const place = nearbyPlace(placeContext);
  const stations = railStationsNear(ctx.city?.places ?? [], place, feedRadiusM(ctx, place));
  if (ctx.boards && stations.length > 0) ctx.boards.ensure('hz', stations.map((station) => station.sourceRecord), ctx.onLocalData);
  if (!openHoursIndex()) void loadOpenHours().then((index) => { if (index) ctx.onLocalData?.(); });
}

/**
 * Asks the page's board cache for the departures stop's platforms, so the list leads with the departures wherever it
 * is first drawn: Sada's block asks for them itself, Karta's default sheet did not, and a phone opening on Karta (a
 * reload, a saved link) listed the place without them until Sada was visited. Nothing is asked once the session ended.
 */
export function askBoards(ctx: LayerContext, placeContext: PlaceContext = feedPlace(ctx)): void {
  askNearby(ctx, placeContext);
  const stop = placeContext.departuresStop;
  if (!stop || !ctx.boards || ctx.frozenAt !== undefined || ctx.session?.frozen) return;
  ctx.boards.ensure('zet', platformIds(stop, ctx.stops), ctx.onLocalData);
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
  // Upgrade U2: rail moves forward while ZET's fleet deviates, as on the wall (U3's policy field).
  const policy = railPolicy(serviceStateOf(ctx.snapshots['zet-rt'], now).kind);
  const radiusM = feedRadiusM(ctx, place);
  const city = ctx.city ?? emptyCity();
  const index = openHoursIndex();
  const railBoards = ctx.boards
    ? railStationsNear(city.places, place, radiusM).map((station) => ctx.boards!.get('hz', station.sourceRecord)).filter((b): b is DepartureBoard => b !== undefined)
    : [];
  return {
    place,
    radiusM,
    now,
    boards: heldBoards(ctx, placeContext.departuresStop),
    fixes: liveFixes(ctx.snapshots['zet-rt'], now),
    snapshots: ctx.snapshots,
    city,
    lastRun: ctx.lastRun ?? null,
    locale: ctx.i18n.getLocale(),
    i18n: ctx.i18n,
    ...(ctx.stops ? { stops: ctx.stops } : {}),
    ...(policy ? { policy } : {}),
    ...(railBoards.length > 0 ? { railBoards } : {}),
    // A public holiday (shared/city/holidays.ts): OSM's hours do not say holiday hours, so no place is open.
    openPlaces: openPlacesNear(index, place, radiusM, now, isPublicHoliday(zagrebDayKey(now))),
    venuePoint: venuePointFor(city.places, ctx.snapshots, index),
    venueName: venueNameFor(city.places, ctx.snapshots, index),
  };
}

// --- the list's first draw ---------------------------------------------------------

/** The feeds "U blizini" takes rows from besides the city catalogue (Sada's own modules, layers/index.ts). */
export const NEARBY_SOURCE_MODULES = ['zet-rt', 'prometnice', 'dogadanja'] as const;

/** The longest Sada's list keeps its reserved rows for a source still on its way, from the first draw that held. */
export const NEARBY_HOLD_MS = 4_000;

/** Per page (its repaint hook, the same function on every draw): when its list began to hold, or true once drawn. */
const holds = new WeakMap<object, number | true>();

/**
 * Whether Sada's list should still hold its reserved rows: the city catalogue is loading, or one of
 * NEARBY_SOURCE_MODULES has neither a snapshot nor an error yet. Each source arriving on its own inserted rows
 * between rows already on screen (a first tram at the top, closures and openings in the middle) and moved the rest
 * under the reader's eyes (lane/v-perf: layout shifts on /d/ Sada); holding until they have all answered draws the
 * rows once. The hold ends for good at the first draw that finds nothing pending or NEARBY_HOLD_MS after it began,
 * so a later catalogue load (Karta asking for streets) never takes drawn rows back and a slow source never hides
 * the list for long. A context with no page behind it (no onLocalData: a unit context) and an ended session
 * never hold.
 */
export function nearbyHeld(ctx: LayerContext): boolean {
  const page = ctx.onLocalData;
  if (!page || ctx.frozenAt !== undefined || ctx.session?.frozen) return false;
  const state = holds.get(page);
  if (state === true) return false;
  const pending = Boolean(ctx.city?.loading)
    || NEARBY_SOURCE_MODULES.some((module) => ctx.snapshots[module] === undefined && ctx.errors?.[module] === undefined);
  const since = state ?? ctx.now;
  if (!pending || ctx.now - since >= NEARBY_HOLD_MS) {
    holds.set(page, true);
    return false;
  }
  holds.set(page, since);
  return true;
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
