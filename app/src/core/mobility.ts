// The bike-share, parking and waste-pickup tiles (plan T3.2, D7): three
// producers behind FEED_BIKES, FEED_PARKING and FEED_WASTE, all off until
// their upstream source is confirmed (docs/izvori.md "Crveni izvori").
// Nextbike's stations and Zagrebparking's garages both answer to "how many
// free spots, right now, at which point" -- one shape, `MobilityStation`,
// serves both; Čistoća's calendar answers a different question ("what is
// collected on which day"), so waste gets its own `WasteSnapshot`. Neither
// snapshot is a `ModuleSnapshot`: no worker module fills them yet (the app
// union `ModuleId` stays untouched by this task), so they travel as their
// own optional fields on `ExperienceActions` (`ctx.bikes`, `ctx.parking`,
// `ctx.waste`) rather than through `ctx.snapshots`. When a source ships, its
// worker module's own adapter fills these shapes from real `FeedItem`s with
// the `station`/`pickup` `DATA_KEYS` a ruling will add then (not this one).
import type { Attribution, SnapshotStatus } from '../../../worker/feed/schema';
import { zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import { escapeHtml } from '../ui/dom/escape';
import { haversineKm } from './geo';

/**
 * One bike-share or parking station (plan T3.2). `free`/`capacity` are the
 * source's own counts, never derived: `null` is "the source has no figure
 * for this station right now", which honest-data keeps distinct from zero
 * free spots. `district` is the same slug `worker/pairing/areas.ts`
 * defines, present once the worker module can resolve it geometrically.
 */
export interface MobilityStation {
  id: string;
  name: string;
  lon: number;
  lat: number;
  free: number | null;
  capacity: number | null;
  district?: string;
}

export type MobilityModule = 'bikes' | 'parking';

export interface MobilitySnapshot {
  module: MobilityModule;
  status: SnapshotStatus;
  fetchedAt: string;
  sourceUpdatedAt?: string;
  attribution: Attribution;
  stations: readonly MobilityStation[];
}

/**
 * One day's collection at one address point (plan T3.2). `kind` is the
 * source's own word for what is collected (miješani otpad, papir, ...) and
 * is used verbatim as the waste tile's title -- never routed through a
 * closed vocabulary the source itself does not share (unlike a closure's
 * `subtype`, which the register does close).
 */
export interface WastePickup {
  district: string;
  date: string;
  kind: string;
}

export interface WasteSnapshot {
  module: 'waste';
  status: SnapshotStatus;
  fetchedAt: string;
  attribution: Attribution;
  pickups: readonly WastePickup[];
}

/** Nothing nearer than this is worth calling "nearby" on foot. */
const NEAREST_RADIUS_KM = 0.6;

/**
 * The one station a bikes or parking tile shows (plan T3.2): the nearest to
 * the screen's stop when one is within 600 m of it; `null` without a screen
 * stop or without one that close -- a producer with nothing honestly nearby
 * renders no tile rather than a distant, misleading one.
 */
export function nearestStation(
  stations: readonly MobilityStation[],
  stop: { lon: number; lat: number } | undefined,
): MobilityStation | null {
  if (!stop) return null;
  const byDistance = stations.map((station) => ({ station, km: haversineKm(stop.lon, stop.lat, station.lon, station.lat) })).sort((a, b) => a.km - b.km);
  return byDistance.length > 0 && byDistance[0]!.km <= NEAREST_RADIUS_KM ? byDistance[0]!.station : null;
}

/**
 * The stale badge a bikes/parking/waste tile shows in place of its context
 * (fix round 1, T3.2 review): `experience/status.ts`'s `statusBadge` renders
 * the same badge for a module-backed tile, but neither `MobilitySnapshot`
 * nor `WasteSnapshot` is a `ModuleSnapshot` (no `tier`, `items`,
 * `staleSince`), so `buildTimeband`'s per-module gating never sees them
 * (Ruling 9) and each producer marks a stale tile itself instead. One
 * function so bikes.ts, parking.ts and waste.ts render the exact same
 * badge -- honest-data's "fetch time is not observation time" applies to a
 * degraded fetch exactly as it does to a live one: a stale station or
 * pickup count still shows a number, but never as if it were current.
 */
export function mobilityStaleBadge(i18n: I18n, fetchedAt: string): string {
  const word = i18n.t('status.staleShort', { time: zagrebTime(fetchedAt) });
  return `<span class="badge status-badge" data-tone="stale" data-testid="panel-status" data-status="stale">${escapeHtml(word)}</span>`;
}
