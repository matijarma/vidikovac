// The twin's memory between ticks: the engine's per-vehicle Track for every
// vehicle it follows (shared/motion/track.ts: fixes, match, speed, plan,
// order), the latest TripUpdate per trip, and the short ring of published
// plans per vehicle the hindsight grades against. Plain data throughout, so
// one row per tick in SQLite (persist.ts) brings an evicted object back
// knowing the fleet.

import type { DwellRecent } from '../../shared/motion/dwell';
import type { PublishedPlan } from '../../shared/motion/hindsight';
import { emptyAggregates, type LearnedAggregates } from '../../shared/motion/learn';
import { EVICT_S, FUTURE_TOLERANCE_S } from '../../shared/motion/plan';
import type { Track } from '../../shared/motion/track';
import type { DecodedFeed } from './feed-decode';
import { emptyOperator, type OperatorState } from './operator';

/** Silence after which a vehicle leaves the twin, in seconds: the planner's
 *  eviction age itself (plan.ts EVICT_S, 180 s, T8), so the twin drops a
 *  track at the moment its confidence reaches 0 and clients drop the mark. */
export const TRACK_STALE_S = EVICT_S;

/** The next stop of one trip as ZET's TripUpdate names it, plus every delay
 *  the update carried (the per-route median row is built from those). */
export interface TripNext {
  routeId: string | null;
  seq: number | null;
  stopId: string | null;
  delaySec: number | null;
  timeSec: number | null;
  delays: number[];
  /** When ZET issued the update (its own timestamp, else the frame header).
   *  The planner's "departed by the header" bound needs it to tell a current
   *  update from one naming the platform a tram is still standing at (F11). */
  atSec: number | null;
  /** The update's trip descriptor says CANCELED. ZET's own marker, carried to
   *  the pin as `tripStatus` and counted; it removes nothing (U1). */
  canceled?: boolean;
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
  /** F11: the rolling window of measured dwells per platform, whole (not
   *  just the unflushed minute). It is small -- thirty numbers per platform
   *  the fleet actually called at -- and carrying it whole means an eviction
   *  wakes up planning from the last ninety minutes rather than from the
   *  timetable while SQLite is read. */
  dwellRecent: DwellRecent;
  /** What ZET's own alerts and markers said in the last frame (U1): about
   *  thirty trip ids on a recorded day, under 2 KB of the row. */
  operator: OperatorState;
}

export function emptyState(): TwinState {
  return { headerTs: null, etag: null, tickAtMs: 0, tracks: {}, tripUpdates: {}, published: {}, learnedUpTo: {}, pendingLearned: emptyAggregates(), dwellRecent: {}, operator: emptyOperator() };
}

/** The update to keep for a trip: the earliest stop still ahead of the header
 *  (ZET lists a passed stop or two beside the next one), else the last in
 *  sequence order. Delays are kept in sequence order for the route median.
 *  An update ZET stamped more than FUTURE_TOLERANCE_S after the header is
 *  skipped, as its vehicle reports are (tick.ts): a stamp a day ahead is
 *  no evidence of the trip now. */
export function nextStopOf(feed: DecodedFeed): Record<string, TripNext> {
  const out: Record<string, TripNext> = {};
  const ceiling = feed.headerTs === null ? null : feed.headerTs + FUTURE_TOLERANCE_S;
  for (const update of feed.tripUpdates) {
    if (!update.tripId) continue;
    if (ceiling !== null && update.atSec !== null && update.atSec > ceiling) continue;
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
      atSec: update.atSec ?? feed.headerTs ?? null,
      ...(update.canceled ? { canceled: true } : {}),
    };
  }
  return out;
}

/** The updates still worth keeping when no new frame came (a 304, a repeated
 *  header): those issued within EVICT_S of now, the age at which the twin
 *  drops a silent vehicle. Without it a frozen feed kept the per-route delay
 *  rows of its last frame long after every vehicle had gone from the map. */
export function ageTripUpdates(updates: Readonly<Record<string, TripNext>>, nowSec: number): Record<string, TripNext> {
  const out: Record<string, TripNext> = {};
  for (const [tripId, update] of Object.entries(updates)) {
    if (update.atSec !== null && update.atSec >= nowSec - EVICT_S) out[tripId] = update;
  }
  return out;
}
