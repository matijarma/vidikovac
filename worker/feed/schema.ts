// Internal feed contract. Every upstream source (GTFS-RT protobuf, CAP XML,
// DHMZ XML, CKAN JSON, EMSC GeoJSON, gazette JSON, RSS) is normalised into
// ModuleSnapshot so panels, the kiosk teaser and the /open exports share one
// shape. Nothing in this file knows about any particular source.

import type { VehicleMotion } from '../../shared/motion/wire';
import type { FeedPayload } from './payload';

export type ModuleId =
  | 'zet-rt'
  | 'prometnice'
  | 'dhmz-now'
  | 'dhmz-forecast'
  | 'dhmz-cap'
  | 'emsc'
  | 'glasnik'
  | 'ckan-geo'
  | 'dogadanja';

/** open: readable without a session (safety tier, kiosk teaser). session: needs a data token. */
export type Tier = 'open' | 'session';

export type ItemKind =
  | 'vehicle'
  | 'closure'
  | 'observation'
  | 'forecast'
  | 'warning'
  | 'quake'
  | 'act'
  | 'poi'
  | 'event';

export type Severity = 'info' | 'minor' | 'moderate' | 'severe' | 'extreme';

export interface Geo {
  type: 'Point' | 'LineString';
  /** [lon, lat] for Point; [[lon, lat], ...] for LineString (GeoJSON order). */
  coordinates: number[] | number[][];
}

export interface FeedItem {
  /** Stable within a module; used for client-side diffing. */
  id: string;
  module: ModuleId;
  kind: ItemKind;
  tier: Tier;
  title: string;
  summary?: string;
  severity?: Severity;
  /** ISO 8601 start or observation time. */
  at?: string;
  /** What `at` means. Never substitute fetch time for a missing source date. */
  dateBasis?: 'event' | 'published' | 'updated' | 'observed' | 'unknown';
  /** ISO 8601 end, expiry or expected reopening. */
  until?: string;
  geo?: Geo;
  /** Link to the source item (act, event, notice). */
  link?: string;
  /** Flat, source-specific extras (route id, delay seconds, magnitude...). */
  data?: Record<string, string | number | boolean>;
  /** Vehicle items only (R-TE2): the fix history the twin publishes in
   *  phase A, the motion plan from phase B. A typed object beside `data`
   *  because neither is a scalar; times relative to `sourceUpdatedAt`. See
   *  shared/motion/wire.ts. */
  motion?: VehicleMotion;
  /** Retired (WP5 B1): the one-line machine summary the header ticker read.
   *  Nothing writes it any more; it stays optional for one deploy so a cached
   *  payload that still carries it parses, then goes with its last reader
   *  (app/src/city/nearby.ts). */
  brief?: string;
}

export type SnapshotStatus = 'live' | 'stale' | 'down';

export interface SourceAvailability {
  status: SnapshotStatus;
  itemCount: number;
  fetchedAt?: string;
  sourceUpdatedAt?: string;
  /** Number before a documented per-source cap, if known. */
  totalItems?: number;
}

export interface Attribution {
  /** Rendered verbatim in the panel footer, /izvori and every export. */
  text: string;
  url: string;
  licence: string;
}

export interface ModuleSnapshot {
  module: ModuleId;
  tier: Tier;
  status: SnapshotStatus;
  /** When the Worker fetched or last successfully fetched the source. */
  fetchedAt: string;
  /** Source's own timestamp when it publishes one. */
  sourceUpdatedAt?: string;
  /** Set when status is 'stale': the moment the live fetch first failed. */
  staleSince?: string;
  /** When the producer knows its next change (the twin's next tick, R-TE4);
   *  the cache layer keeps the snapshot until then and a client may align
   *  its next poll to it. */
  validUntil?: string;
  attribution: Attribution;
  items: FeedItem[];
  /** Independent source health, including successful empty responses. */
  sources?: Record<string, SourceAvailability>;
  /** The shown collection is not necessarily the entire city's dataset. */
  coverage?: { shown: number; total?: number; limited: boolean };
}

export interface FetchContext {
  /** Fetch with the project's User-Agent and a 6 s timeout already applied. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  now: () => Date;
  /** The twin's current payload, injected by the cache layer for a module
   *  the twin feeds (`ModuleSpec.twin`, R-TE2/R-TE8); absent in a fixture
   *  context, where the module fetches its source directly. */
  twin?: () => Promise<FeedPayload>;
}

export interface ModuleSpec {
  id: ModuleId;
  tier: Tier;
  /** Seconds a live snapshot is served from cache before refetching. */
  ttl: number;
  /** Seconds a KV last-good copy may still be served as 'stale'. */
  maxStale: number;
  attribution: Attribution;
  /** Fetch and normalise. Must throw on any upstream failure. */
  fetcher: (ctx: FetchContext) => Promise<Omit<ModuleSnapshot, 'status' | 'staleSince'>>;
  /** The module is served by the twin Durable Object, which the cache layer
   *  offers through `FetchContext.twin` (R-TE8). */
  twin?: boolean;
  /** Whether a non-live entry in `sources` makes the whole snapshot stale
   *  (the default for composite modules whose sub-sources fail one at a
   *  time). False for the twin's module: its snapshot `status` is the twin's
   *  health, and ZET's own silence is told by `sources.zet` (R-TE5). */
  degradeOnSources?: boolean;
}

/**
 * The `data` vocabulary every module emits and every layer reads (R-22, R-50).
 * One closed list per kind: a module that needs another key needs a ruling
 * first, and `test/feed/fixtures.test.ts` fails the moment a fixture produces
 * a key that is not here. Area A and Area C can no longer drift apart
 * silently, which is exactly how the dashboard ended up rendering dashes over
 * healthy data.
 */
export const DATA_KEYS: Record<ItemKind, readonly string[]> = {
  // Both the per-vehicle pin and the one summary row per route (id 'route:<routeId>').
  // No 'bearing' and no ZET 'speed' (R-P3, R-TE1): ZET's feed never sends
  // either; the Worker never forwards a field the feed does not populate.
  // 'routeType' is the GTFS route_type on the pin (R-P1: a locked kiosk keeps
  // to trams before, or without, the network artefact). 'direction',
  // 'headsign' and 'shapeId' are the twin's static-GTFS join of the vehicle's
  // trip and 'delaySeconds' its TripUpdate's (R-TE2, phase A). 'nextStopId' is
  // the platform the twin's own plan names on a rail path (the zone its
  // anchor lies in, else the first served platform ahead, one per visit,
  // nothing past the last platform; rail round 3), ZET's TripUpdate's stop
  // off the rails and at a terminus stand that projects past the trip's
  // first platform. 'nextStopEtaSec' is the twin's OWN planned arrival at that stop in
  // epoch seconds, and rides whenever the 'nextStopId' beside it is the stop
  // the twin planned for, whichever source named that stop; it is withheld
  // only where the twin and ZET disagree about which stop is next (WP5),
  // because an arrival time belongs to the stop it was computed for. It is
  // what refines a tapped stop's 'za N min'.
  // 'speed' (m/s), 'confidence' (0..1) and 'held' are the twin's OWN
  // estimates from history, geometry and timetable (R-TE1), never ZET's
  // position.speed, which the direct parser still drops. 'behind' is the
  // twin's ordering register (E3): the vehicle id of the tram this one is
  // established behind, so the client draws the order the twin reasoned
  // about rather than re-deriving one from two plans between polls. It is
  // read off the register at every publish, so it is withdrawn the tick the
  // relation ends, and absent for a tram the register places nowhere.
  vehicle: ['routeId', 'tripId', 'vehicleId', 'routeShortName', 'routeType', 'medianDelaySeconds', 'vehicles', 'direction', 'headsign', 'shapeId', 'nextStopId', 'nextStopEtaSec', 'delaySeconds', 'speed', 'confidence', 'held', 'behind'],
  closure: ['type', 'subtype', 'direction', 'street', 'district'],
  observation: ['temp', 'humidity', 'pressure', 'windDir', 'windSpeed', 'weather'],
  forecast: ['tmin', 'tmax', 'weather', 'text'],
  warning: ['event', 'certainty', 'urgency'],
  quake: ['mag', 'depth', 'magType', 'region'],
  act: ['broj', 'godina', 'category'],
  poi: ['layer', 'category', 'district'],
  // The dogadanja module's six sub-fetchers between them use every one of
  // these ten keys (worker/feed/modules/dogadanja/index.ts); no single
  // source uses all ten itself, and none uses a key outside this set. The
  // district key is the one every geocoded sub-fetcher can carry (only
  // komunalne.ts does today, R-DG6): districtOf from the item's own
  // coordinates, never guessed for an item without one.
  event: ['source', 'category', 'venue', 'venueHint', 'venueTags', 'city', 'organiser', 'live', 'phase', 'status', 'amount', 'precision', 'district'],
};
