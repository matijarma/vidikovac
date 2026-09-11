// Internal feed contract. Every upstream source (GTFS-RT protobuf, CAP XML,
// DHMZ XML, CKAN JSON, EMSC GeoJSON, gazette JSON, RSS) is normalised into
// ModuleSnapshot so panels, the kiosk teaser and the /open exports share one
// shape. Nothing in this file knows about any particular source.

export type ModuleId =
  | 'zet-rt'
  | 'prometnice'
  | 'dhmz-now'
  | 'dhmz-forecast'
  | 'dhmz-cap'
  | 'emsc'
  | 'hrt-news'
  | 'glasnik'
  | 'ckan-geo';

/** open: readable without a session (safety tier, kiosk teaser). session: needs a data token. */
export type Tier = 'open' | 'session';

export type ItemKind =
  | 'vehicle'
  | 'closure'
  | 'observation'
  | 'forecast'
  | 'warning'
  | 'quake'
  | 'news'
  | 'act'
  | 'poi';

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
  /** ISO 8601 end, expiry or expected reopening. */
  until?: string;
  geo?: Geo;
  /** Link to the source item (news article, act, event). */
  link?: string;
  /** Flat, source-specific extras (route id, delay seconds, magnitude...). */
  data?: Record<string, string | number | boolean>;
}

export type SnapshotStatus = 'live' | 'stale' | 'down';

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
  attribution: Attribution;
  items: FeedItem[];
}

export interface FetchContext {
  /** Fetch with the project's User-Agent and a 6 s timeout already applied. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  now: () => Date;
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
  vehicle: ['routeId', 'tripId', 'vehicleId', 'routeShortName', 'bearing', 'speed', 'medianDelaySeconds', 'vehicles'],
  closure: ['type', 'subtype', 'direction', 'street'],
  observation: ['temp', 'humidity', 'pressure', 'windDir', 'windSpeed', 'weather'],
  forecast: ['tmin', 'tmax', 'weather', 'text'],
  warning: ['event', 'certainty', 'urgency'],
  quake: ['mag', 'depth', 'magType', 'region'],
  news: ['source'],
  act: ['broj', 'godina', 'category'],
  poi: ['layer', 'category'],
};
