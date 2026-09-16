// The twin's memory of the fleet between ticks: one track per vehicle with a
// short ring of its own fixes, and the latest trip update per trip. Folding
// a decoded frame into the previous state is pure, so the unit project can
// prove every rule below without a Durable Object; the DO persists the
// result as one row per tick (persist.ts) and publishes it (publish.ts).
//
// Rules, each from an observed property of ZET's feed (16 Sept 2026):
//   - the feed is FULL_DATASET every 10 s and repeats a vehicle's last report
//     until the vehicle sends a new one, so a fix counts only when its own
//     timestamp is newer than the last one kept;
//   - a frame occasionally carries two entities for one vehicle id; the
//     newer timestamp wins, the other is a stale duplicate;
//   - a fix without a timestamp (ZET omits it now and then) is dated at the
//     header time, the source's own vouching, never at the fetch time;
//   - a new trip id is a terminus turnaround (Zagreb trams are single-ended
//     and turn on loops): the old fixes lie on the other track and are not
//     comparable evidence, so the ring restarts;
//   - a track silent for TRACK_STALE_S is gone, not flagged, matching the
//     client model's own eviction (R-F2) and the module's maxStale.

import { HISTORY_FIXES } from '../../shared/motion/wire';
import type { DecodedFeed, RawFix } from './feed-decode';

/** Silence after which a vehicle leaves the twin, in seconds; the client
 *  model evicts at the same age (STALE_S), so both sides agree on who is
 *  still on the map. */
export const TRACK_STALE_S = 300;

/** [seconds since the epoch, lon, lat]: absolute here, made relative to the
 *  header time only on the wire (publish.ts). */
export type TrackFix = [atSec: number, lon: number, lat: number];

export interface Track {
  vehicleId: string;
  routeId: string | null;
  tripId: string | null;
  startDate: string | null;
  /** Oldest first, at most HISTORY_FIXES. */
  fixes: TrackFix[];
}

/** The next stop of one trip as ZET's TripUpdate names it, plus every delay
 *  the update carried (the per-route median row is built from those). */
export interface NextStop {
  routeId: string | null;
  seq: number | null;
  stopId: string | null;
  delaySec: number | null;
  timeSec: number | null;
  delays: number[];
}

export interface TwinState {
  /** The last frame's header time in seconds, null before the first frame. */
  headerTs: number | null;
  /** The last frame's ETag, for the conditional GET. */
  etag: string | null;
  /** Wall clock of the tick that produced this state, epoch ms. */
  tickAtMs: number;
  vehicles: Record<string, Track>;
  tripUpdates: Record<string, NextStop>;
}

export interface FoldResult {
  state: TwinState;
  /** Fixes that were genuinely new evidence this frame. */
  newFixes: number;
  /** Tracks removed for silence this frame. */
  evicted: number;
}

export function emptyState(): TwinState {
  return { headerTs: null, etag: null, tickAtMs: 0, vehicles: {}, tripUpdates: {} };
}

/** One entry per vehicle id, the newest report winning a duplicate. */
function dedupe(vehicles: readonly RawFix[], fallbackAt: number): Map<string, RawFix & { atSec: number }> {
  const byId = new Map<string, RawFix & { atSec: number }>();
  for (const raw of vehicles) {
    const dated = { ...raw, atSec: raw.atSec ?? fallbackAt };
    const current = byId.get(raw.vehicleId);
    if (!current || dated.atSec > current.atSec) byId.set(raw.vehicleId, dated);
  }
  return byId;
}

/** The update to keep for a trip: the earliest stop still ahead of the header
 *  (ZET lists a passed stop or two beside the next one), else the last in
 *  sequence order. Delays are kept in sequence order for the route median. */
function nextStopOf(feed: DecodedFeed): Record<string, NextStop> {
  const out: Record<string, NextStop> = {};
  for (const update of feed.tripUpdates) {
    if (!update.tripId) continue;
    const stops = [...update.stops].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const ahead = feed.headerTs === null ? [] : stops.filter((s) => s.timeSec !== null && s.timeSec >= feed.headerTs!);
    const chosen = ahead.length > 0 ? ahead.reduce((best, s) => (s.timeSec! < best.timeSec! ? s : best)) : stops[stops.length - 1];
    out[update.tripId] = {
      routeId: update.routeId ?? null,
      seq: chosen?.seq ?? null,
      stopId: chosen?.stopId ?? null,
      delaySec: chosen?.delaySec ?? null,
      timeSec: chosen?.timeSec ?? null,
      delays: stops.map((s) => s.delaySec).filter((d): d is number => d !== null),
    };
  }
  return out;
}

export function foldFeed(prev: TwinState, feed: DecodedFeed, nowMs: number): FoldResult {
  const headerTs = feed.headerTs ?? prev.headerTs;
  const nowSec = Math.floor(nowMs / 1000);
  const fallbackAt = feed.headerTs ?? nowSec;
  const vehicles: Record<string, Track> = { ...prev.vehicles };
  let newFixes = 0;

  for (const raw of dedupe(feed.vehicles, fallbackAt).values()) {
    const before = vehicles[raw.vehicleId];
    const tripChanged = before !== undefined && before.tripId !== null && raw.tripId !== undefined && before.tripId !== raw.tripId;
    const fixes: TrackFix[] = before && !tripChanged ? before.fixes : [];
    const last = fixes.length > 0 ? fixes[fixes.length - 1][0] : null;
    const isNew = last === null || raw.atSec > last;
    if (!isNew && !tripChanged && before) {
      // Nothing new: keep the track as it was (its identity fields included).
      continue;
    }
    const nextFixes = isNew ? [...fixes, [raw.atSec, raw.lon, raw.lat] as TrackFix] : fixes;
    if (nextFixes.length > HISTORY_FIXES) nextFixes.splice(0, nextFixes.length - HISTORY_FIXES);
    if (isNew) newFixes++;
    vehicles[raw.vehicleId] = {
      vehicleId: raw.vehicleId,
      routeId: raw.routeId ?? before?.routeId ?? null,
      tripId: raw.tripId ?? before?.tripId ?? null,
      startDate: raw.startDate ?? before?.startDate ?? null,
      fixes: nextFixes,
    };
  }

  let evicted = 0;
  for (const [id, track] of Object.entries(vehicles)) {
    const last = track.fixes.length > 0 ? track.fixes[track.fixes.length - 1][0] : null;
    if (last === null || last < nowSec - TRACK_STALE_S) {
      delete vehicles[id];
      evicted++;
    }
  }

  return {
    state: { headerTs, etag: prev.etag, tickAtMs: nowMs, vehicles, tripUpdates: nextStopOf(feed) },
    newFixes,
    evicted,
  };
}
