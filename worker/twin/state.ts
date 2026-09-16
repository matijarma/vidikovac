// The twin's memory between ticks: the engine's per-vehicle Track for every
// vehicle it follows (shared/motion/track.ts: fixes, match, speed, plan,
// order), the latest TripUpdate per trip, and the short ring of published
// plans per vehicle the hindsight grades against. Plain data throughout, so
// one row per tick in SQLite (persist.ts) brings an evicted object back
// knowing the fleet.

import type { PublishedPlan } from '../../shared/motion/hindsight';
import { emptyAggregates, type LearnedAggregates } from '../../shared/motion/learn';
import type { Track } from '../../shared/motion/track';
import type { DecodedFeed } from './feed-decode';

/** Silence after which a vehicle leaves the twin, in seconds; the planner's
 *  own eviction age (plan.ts EVICT_S) and the module's maxStale agree. */
export const TRACK_STALE_S = 300;

/** The next stop of one trip as ZET's TripUpdate names it, plus every delay
 *  the update carried (the per-route median row is built from those). */
export interface TripNext {
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
  tracks: Record<string, Track>;
  tripUpdates: Record<string, TripNext>;
  /** Per vehicle, the plans published in the last ticks, oldest first. */
  published: Record<string, PublishedPlan[]>;
  /** Per vehicle, the report time of the newest fix already mined for
   *  evidence (learn.ts), so a traversal or a dwell is counted once. */
  learnedUpTo: Record<string, number>;
  /** Evidence counted since the last flush to SQLite (C1): rides in the
   *  state row so an eviction between two flushes loses nothing. */
  pendingLearned: LearnedAggregates;
}

export function emptyState(): TwinState {
  return { headerTs: null, etag: null, tickAtMs: 0, tracks: {}, tripUpdates: {}, published: {}, learnedUpTo: {}, pendingLearned: emptyAggregates() };
}

/** The update to keep for a trip: the earliest stop still ahead of the header
 *  (ZET lists a passed stop or two beside the next one), else the last in
 *  sequence order. Delays are kept in sequence order for the route median. */
export function nextStopOf(feed: DecodedFeed): Record<string, TripNext> {
  const out: Record<string, TripNext> = {};
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
