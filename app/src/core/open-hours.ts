// The OpenStreetMap opening hours behind the "U blizini" open row (docs/upgrade-2026-10-plan/U3.md S1, S6): the
// derived database app/public/data/osm-hours.json (ODbL 1.0, cut by scripts/osm-hours.mjs), fetched once a session
// like the stop's last-run file (core/lastrun.ts) and decoded by shared/city/osm-hours.ts. A down answer (refused,
// unreachable, not the file) reads as null and is asked for again an hour later, never on every paint. The same
// index names the venues the gazetteer (shared/city/venues.ts) places an event without a point at.
import type { FeedSnapshots } from './contracts';
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import type { Place } from '../../../shared/city/types';
import { decodeOsmHours, osmVenues, type OsmHoursIndex } from '../../../shared/city/osm-hours';
import { buildGazetteer, resolveVenueName, resolveVenuePoint, type Gazetteer } from '../../../shared/city/venues';

export const OPEN_HOURS_URL = '/data/osm-hours.json';
/** A down answer is asked for again this long after it came (kiosk.ts LASTRUN_DOWN_RETRY_MS's hour). */
export const OPEN_HOURS_RETRY_MS = 3_600_000;
/** The derived database's credit, as the source register lists it (app/src/data/izvori.json `osm-hours`): Sada's
 *  sources name it while an open row is on the list (layers/grad-sada.ts). */
export const OSM_HOURS_CREDIT = Object.freeze({
  text: '© OpenStreetMap contributors, ODbL 1.0; izvedena baza podataka (radno vrijeme mjesta)',
  url: 'https://www.openstreetmap.org/copyright',
  licence: 'ODbL 1.0',
});

let held: OsmHoursIndex | null = null;
let pending: Promise<OsmHoursIndex | null> | null = null;
let downAt: number | null = null;

/**
 * The index, fetched once: a decoded file is kept for the session, a down answer is remembered for
 * OPEN_HOURS_RETRY_MS and answered null meanwhile, a request in flight is joined. `now` defaults to the wall clock.
 */
export function loadOpenHours(fetchImpl: typeof fetch = fetch, now: number = Date.now()): Promise<OsmHoursIndex | null> {
  if (held) return Promise.resolve(held);
  if (pending) return pending;
  if (downAt !== null && now - downAt < OPEN_HOURS_RETRY_MS) return Promise.resolve(null);
  pending = (async () => {
    try {
      const response = await fetchImpl(OPEN_HOURS_URL);
      return response.ok ? decodeOsmHours(await response.json()) : null;
    } catch {
      return null;
    }
  })().then((index) => {
    pending = null;
    held = index;
    downAt = index ? null : now;
    return index;
  });
  return pending;
}

/** The index in hand, or null before it came or while it is down. */
export function openHoursIndex(): OsmHoursIndex | null {
  return held;
}

/** Per places array: the gazetteer built for it, with the kultura-zg copy and the index it was built from. */
const gazetteers = new WeakMap<readonly Place[], { kultura: string | null; index: OsmHoursIndex | null; gazetteer: Gazetteer }>();

/**
 * The venue gazetteer for the city's places, the kultura-zg snapshot and the OSM index, memoised on the three
 * (the places array, the snapshot's fetchedAt, the index), so a paint that changes none of them builds nothing.
 * The module is read by its id as data (U3.md §0.2(d)): the schema that names it is U3-modules'.
 */
export function venueGazetteer(places: readonly Place[], snapshots: FeedSnapshots, index: OsmHoursIndex | null): Gazetteer {
  const kultura = (snapshots as Readonly<Record<string, ModuleSnapshot | undefined>>)['kultura-zg'];
  const usable = kultura && kultura.status !== 'down' ? kultura : undefined;
  const stamp = usable ? `${usable.status}|${usable.fetchedAt}` : null;
  const memo = gazetteers.get(places);
  if (memo && memo.kultura === stamp && memo.index === index) return memo.gazetteer;
  const gazetteer = buildGazetteer({ places, kultura: usable?.items ?? [], osm: osmVenues(index) });
  gazetteers.set(places, { kultura: stamp, index, gazetteer });
  return gazetteer;
}

/** NearbyInput.venuePoint over that gazetteer: an event's venue point when the gazetteer resolves it beyond doubt. */
export function venuePointFor(places: readonly Place[], snapshots: FeedSnapshots, index: OsmHoursIndex | null): (item: FeedItem) => { lon: number; lat: number } | null {
  const gazetteer = venueGazetteer(places, snapshots, index);
  return (item) => resolveVenuePoint(item, gazetteer);
}

/** The matched gazetteer's own name, not a source hint interpreted as display text. */
export function venueNameFor(places: readonly Place[], snapshots: FeedSnapshots, index: OsmHoursIndex | null): (item: FeedItem) => string | null {
  const gazetteer = venueGazetteer(places, snapshots, index);
  return (item) => resolveVenueName(item, gazetteer);
}
