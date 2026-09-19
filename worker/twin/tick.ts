// One tick of the twin, pure: the decoded frame (or none, for a 304 or a
// repeated header) folds into the tracks, every vehicle is matched, its
// speed estimated, its plan built, the ordering register applied over the
// trams, every fresh fix graded against the plans published before it, and the
// module payload assembled. The Durable Object (twin-do.ts) only fetches,
// persists and publishes what comes out of here.
//
// Order of operations (the B3+B4 report's contract): match every fix with
// the TripUpdate's next stop, then the speed from the moving intervals, then
// the plan for every track, then one enforceOrder over all trams, which
// mutates the plans in place. Hindsight grades the fixes that arrived this
// tick against the ring of plans published earlier, then the plans of this
// tick join the ring.

import { dist, toPlane } from '../../shared/motion/geo';
import { countGrades, countSignGrades, emptyCounts, emptySignCounts, gradeFix, rememberPlan, type HindsightCounts, type HindsightSignCounts } from '../../shared/motion/hindsight';
import { enforceOrder, type OrderReport } from '../../shared/motion/order';
import { extractEvidence, recordEvidence, type DwellEvidence, type EdgeEvidence } from '../../shared/motion/learn';
import type { GraphNetwork } from '../../shared/motion/network';
import { buildPlan, CONFIDENCE_FREE_CAP, DWELL_DEFAULT_S, PLAN_AHEAD_S, silenceDecay, type NextStopUpdate } from '../../shared/motion/plan';
import { estimateSpeed, STOP_ZONE_M } from '../../shared/motion/speed';
import { serviceDayStartSec } from '../../shared/motion/bands';
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
  /** The same graded fixes by sign: plan ahead of the fix, within 50 m, behind (F7). */
  hindsightSign: HindsightSignCounts;
  /** The evidence this tick mined from the fresh fixes (C1), already counted into the state's pending aggregates. */
  learned: { edges: EdgeEvidence[]; dwells: DwellEvidence[] };
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

/** The trip's first departure in epoch seconds (R-TE49): the index's start
 *  on the service day the realtime start date names; null without either. */
function tripStartOf(join: TripJoin | undefined, startDate: string | undefined): number | null {
  if (!join || join.startSec === undefined || !startDate) return null;
  const day = serviceDayStartSec(startDate);
  return day === null ? null : day + join.startSec;
}

/**
 * Does the vehicle's next trip continue the run this Track is a record of
 * (D14)? ZET's VEHICLE ids are stable through the day and its TRIP ids
 * change at every terminus, so a trip change is usually the same tram
 * starting its next run: the new trip's path runs the rail it is standing
 * on, or it begins at the platform the tram is standing at. Then the fixes,
 * the speed estimate and the ordering register are evidence about this
 * vehicle and are kept; only the path-derived match state resets, which the
 * matcher does itself on the new prior, and the register's own divergence
 * rule prunes any relation the new path leaves behind. Anything else -- a
 * vehicle id changing hands, a tram towed to the other end of the city -- is
 * a new track, as it was before.
 */
function continuesRun(net: GraphNetwork, track: Track, priorPathIdx: number | null): boolean {
  if (priorPathIdx === null || priorPathIdx >= net.paths.length) return false;
  if (track.match.edge !== null && net.paths[priorPathIdx].edges.includes(track.match.edge)) return true;
  const last = lastFix(track);
  return last !== null && dist(net.toPathPoint(priorPathIdx, 0), last) <= STOP_ZONE_M;
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
  const learnedUpTo = { ...input.state.learnedUpTo };
  const pendingLearned = { edges: { ...input.state.pendingLearned.edges }, stops: { ...input.state.pendingLearned.stops } };
  const learned: TickResult['learned'] = { edges: [], dwells: [] };
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
      const join = tripId !== null ? joins.get(tripId) : undefined;
      const prior = engine ? engine.matcher.priorFor(join?.shapeId ?? null, routeId, join?.direction ?? null, join?.pathId ?? null) : null;
      // A trip change is a terminus turnaround, and a terminus turnaround is
      // the SAME tram (D14): it keeps its Track whenever the new trip
      // continues where this one stands. Otherwise the old fixes lie
      // somewhere else entirely and the vehicle starts over.
      const tripChanged = track !== undefined && track.tripId !== null && tripId !== null && track.tripId !== tripId;
      const continues = tripChanged && engine !== null && continuesRun(engine.net, track!, prior?.pathIdx ?? null);
      if (!track || (tripChanged && !continues)) {
        track = newTrack(raw.vehicleId, routeId, tripId, kindOf(engine, routes, routeId));
        tracks[raw.vehicleId] = track;
        if (tripChanged) {
          delete published[raw.vehicleId];
          delete learnedUpTo[raw.vehicleId];
        }
      } else {
        track.routeId = routeId;
        if (tripId !== null) track.tripId = tripId;
      }
      const plane = toPlane(raw.lon, raw.lat);
      const fix: PlaneFix = { x: plane.x, y: plane.y, lon: raw.lon, lat: raw.lat, atSec: raw.atSec };
      const before = lastFix(track)?.atSec ?? null;
      track.tripStartSec = tripStartOf(join, raw.startDate);
      if (engine && prior) {
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
      delete learnedUpTo[id];
      evicted++;
    }
  }

  const all = Object.values(tracks);
  let order: OrderReport | null = null;
  const hindsight = emptyCounts();
  const hindsightSign = emptySignCounts();
  if (engine) {
    const bands = zagrebBands(headerSec);
    // What a stop is expected to hold a vehicle for: the learned median where
    // it is thick, the timetable's where it is not, the planner's default
    // otherwise. The speed estimator charges it per stop (F8) rather than a
    // flat 20 s, and the learner prices its dwell samples with the same
    // number, so the two never disagree about one platform.
    const dwellOf = (stopId: string): number => engine.times.dwellSeconds(stopId, bands.hourBand, bands.dayType) ?? DWELL_DEFAULT_S;
    for (const track of all) {
      track.speed = estimateSpeed(track.fixes, { stopsBetween: engine.matcher.stopsBetween, dwellOf });
      const update = track.tripId !== null ? tripUpdates[track.tripId] : undefined;
      const next: NextStopUpdate | null = update && update.stopId !== null ? { stopId: update.stopId, timeSec: update.timeSec, delaySec: update.delaySec } : null;
      buildPlan(track, engine.net, engine.times, next, nowSec, headerSec, bands);
    }
    // The register reads ZET's TripUpdates too: two trips whose next stops
    // sit in strict order on the path they share are ordered by ZET itself,
    // which needs no 60 m gap and no second witness (E3).
    order = enforceOrder(all, engine.net, nowSec, headerSec, tripUpdates);
    // What this tick's fresh fixes teach (C1): cruise per edge, standing per
    // stop, each traversal or dwell once, counted into the pending aggregates
    // the Durable Object flushes once a minute.
    const travelOf = (pathIdx: number, fromS: number, toS: number, atSec: number): number | null => {
      const at = zagrebBands(atSec);
      return engine.learnedOnly.segmentSeconds(pathIdx, fromS, toS, at.hourBand, at.dayType);
    };
    for (const id of fresh) {
      const track = tracks[id];
      if (!track) continue;
      const evidence = extractEvidence(engine.net, track, learnedUpTo[id] ?? 0, dwellOf, travelOf);
      learned.edges.push(...evidence.edges);
      learned.dwells.push(...evidence.dwells);
      learnedUpTo[id] = evidence.upTo;
    }
    recordEvidence(pendingLearned, learned);
    // Grade this tick's fresh fixes against what was published before, then
    // remember this tick's plans for the fixes still to come.
    for (const id of fresh) {
      const track = tracks[id];
      const fix = track ? lastFix(track) : null;
      const ring = published[id];
      if (!fix || !ring || ring.length === 0) continue;
      const grades = gradeFix(engine.net, fix, ring);
      countGrades(hindsight, grades);
      countSignGrades(hindsightSign, grades);
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

  const state: TwinState = { headerTs, etag: input.state.etag, tickAtMs: nowMs, tracks, tripUpdates, published, learnedUpTo, pendingLearned };
  const payload = buildPayload(state, joins, routes, nowMs, input.validUntilMs, engine?.net ?? null);
  return { state, payload, newFixes, evicted, order, hindsight, hindsightSign, learned };
}
