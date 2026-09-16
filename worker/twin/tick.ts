// One tick of the twin, pure: the decoded frame (or none, for a 304 or a
// repeated header) folds into the tracks, every vehicle is matched, its
// speed estimated, its plan built, the ordering law applied over the trams,
// every fresh fix graded against the plans published before it, and the
// module payload assembled. The Durable Object (twin-do.ts) only fetches,
// persists and publishes what comes out of here.
//
// Order of operations (the B3+B4 report's contract): match every fix with
// the TripUpdate's next stop, then the speed from the moving intervals, then
// the plan for every track, then one enforceOrder over all trams, which
// mutates the plans in place. Hindsight grades the fixes that arrived this
// tick against the ring of plans published earlier, then the plans of this
// tick join the ring.

import { toPlane } from '../../shared/motion/geo';
import { countGrades, emptyCounts, gradeFix, rememberPlan, type HindsightCounts } from '../../shared/motion/hindsight';
import { enforceOrder, type OrderReport } from '../../shared/motion/laws';
import { buildPlan, CONFIDENCE_FREE_CAP, PLAN_AHEAD_S, silenceDecay, type NextStopUpdate } from '../../shared/motion/plan';
import { estimateSpeed } from '../../shared/motion/speed';
import { zagrebBands } from '../../shared/motion/times';
import { lastFix, newTrack, pushFix, type FreeKnot, type PlaneFix, type Track } from '../../shared/motion/track';
import type { FeedPayload } from '../feed/payload';
import type { ZetRoutes } from '../feed/modules/zet-routes';
import { kindOf, type Engine } from './engine';
import type { DecodedFeed, RawFix } from './feed-decode';
import { buildPayload, type TripJoin } from './publish';
import { nextStopOf, TRACK_STALE_S, type TwinState } from './state';

export interface TickInput {
  state: TwinState;
  /** The decoded frame, or null when the feed had nothing new (304, same header). */
  feed: DecodedFeed | null;
  nowMs: number;
  /** The static join per realtime trip id (the twin's index), for the vehicles in view. */
  joins: ReadonlyMap<string, TripJoin>;
  routes: ZetRoutes;
  /** The engine, or null when no geometry has loaded: free-plane plans then. */
  engine: Engine | null;
  validUntilMs: number;
}

export interface TickResult {
  state: TwinState;
  payload: FeedPayload;
  /** Fixes that were genuinely new evidence this tick. */
  newFixes: number;
  /** Vehicles removed for silence this tick. */
  evicted: number;
  order: OrderReport | null;
  hindsight: HindsightCounts;
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

/** The plan a vehicle gets with no geometry loaded at all: a straight line
 *  from its previous fix to its latest over their own interval, then a hold
 *  (the planner's own free-plane branch, without a network to consult). */
function freePlanOnly(track: Track, nowSec: number, headerSec: number): void {
  const last = lastFix(track);
  if (!last) {
    track.plan = null;
    track.confidence = 0;
    return;
  }
  const rel = (tSec: number): number => Math.round(tSec - headerSec);
  const prev = track.fixes.length >= 2 ? track.fixes[track.fixes.length - 2] : null;
  const knots: FreeKnot[] = [];
  if (prev) knots.push([rel(prev.atSec), prev.lon, prev.lat]);
  knots.push([rel(last.atSec), last.lon, last.lat]);
  knots.push([rel(nowSec + PLAN_AHEAD_S), last.lon, last.lat]);
  track.plan = { on: 'free', knots };
  track.next = null;
  track.confidence = CONFIDENCE_FREE_CAP * silenceDecay(nowSec - last.atSec);
}

export function runTick(input: TickInput): TickResult {
  const { feed, nowMs, joins, routes, engine } = input;
  const nowSec = Math.floor(nowMs / 1000);
  const tracks: Record<string, Track> = { ...input.state.tracks };
  const published = { ...input.state.published };
  const headerTs = feed?.headerTs ?? input.state.headerTs;
  const headerSec = headerTs ?? nowSec;
  const tripUpdates = feed ? nextStopOf(feed) : input.state.tripUpdates;
  const fresh = new Set<string>();
  let newFixes = 0;

  if (feed) {
    for (const raw of dedupe(feed.vehicles, feed.headerTs ?? nowSec).values()) {
      const routeId = raw.routeId ?? tracks[raw.vehicleId]?.routeId ?? '';
      const tripId = raw.tripId ?? null;
      let track = tracks[raw.vehicleId];
      // A new trip is a terminus turnaround: the old fixes lie on the other
      // track and are not comparable evidence, so the vehicle starts over.
      const tripChanged = track !== undefined && track.tripId !== null && tripId !== null && track.tripId !== tripId;
      if (!track || tripChanged) {
        track = newTrack(raw.vehicleId, routeId, tripId, kindOf(engine, routes, routeId));
        tracks[raw.vehicleId] = track;
        if (tripChanged) delete published[raw.vehicleId];
      } else {
        track.routeId = routeId;
        if (tripId !== null) track.tripId = tripId;
      }
      const plane = toPlane(raw.lon, raw.lat);
      const fix: PlaneFix = { x: plane.x, y: plane.y, lon: raw.lon, lat: raw.lat, atSec: raw.atSec };
      const before = lastFix(track)?.atSec ?? null;
      if (engine) {
        const join = tripId !== null ? joins.get(tripId) : undefined;
        const prior = engine.matcher.priorFor(join?.shapeId ?? null, routeId, join?.direction ?? null);
        engine.matcher.matchFix(track, fix, prior, tripId !== null ? tripUpdates[tripId]?.stopId ?? null : null);
      } else {
        pushFix(track, fix);
      }
      if ((lastFix(track)?.atSec ?? null) !== before) {
        newFixes++;
        fresh.add(raw.vehicleId);
      }
    }
  }

  let evicted = 0;
  for (const [id, track] of Object.entries(tracks)) {
    const last = lastFix(track);
    if (!last || last.atSec < nowSec - TRACK_STALE_S) {
      delete tracks[id];
      delete published[id];
      evicted++;
    }
  }

  const all = Object.values(tracks);
  let order: OrderReport | null = null;
  const hindsight = emptyCounts();
  if (engine) {
    const bands = zagrebBands(headerSec);
    for (const track of all) {
      track.speed = estimateSpeed(track.fixes, { stopsBetween: engine.matcher.stopsBetween });
      const update = track.tripId !== null ? tripUpdates[track.tripId] : undefined;
      const next: NextStopUpdate | null = update && update.stopId !== null ? { stopId: update.stopId, timeSec: update.timeSec, delaySec: update.delaySec } : null;
      buildPlan(track, engine.net, engine.times, next, nowSec, headerSec, bands);
    }
    order = enforceOrder(all, engine.net, nowSec, headerSec);
    // Grade this tick's fresh fixes against what was published before, then
    // remember this tick's plans for the fixes still to come.
    for (const id of fresh) {
      const track = tracks[id];
      const fix = track ? lastFix(track) : null;
      const ring = published[id];
      if (!fix || !ring || ring.length === 0) continue;
      countGrades(hindsight, gradeFix(engine.net, fix, ring));
    }
  } else {
    for (const track of all) freePlanOnly(track, nowSec, headerSec);
  }
  for (const track of all) {
    if (!track.plan) continue;
    const ring = published[track.id] ? [...published[track.id]] : [];
    rememberPlan(ring, { headerSec, plan: track.plan });
    published[track.id] = ring;
  }

  const state: TwinState = { headerTs, etag: input.state.etag, tickAtMs: nowMs, tracks, tripUpdates, published };
  const payload = buildPayload(state, joins, routes, nowMs, input.validUntilMs, engine?.net ?? null);
  return { state, payload, newFixes, evicted, order, hindsight };
}
