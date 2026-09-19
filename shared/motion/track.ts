// The per-vehicle engine state: what the twin keeps between ticks and
// persists in its state row (B5), and what the integrator reads once it is
// on the wire (B6). Plain arrays and objects only, so a Track survives
// JSON.stringify unchanged. Every field here is either evidence (fixes, the
// match), a judgement the matcher or planner made from it, or the small
// bookkeeping the ordering law needs to remember who was behind whom.

import { HISTORY_FIXES } from './wire';

export type VehicleKind = 'tram' | 'bus';

/** One reported position in the local metre plane (geo.ts) with the
 *  lon/lat it came from, at the vehicle's own report time in epoch seconds. */
export interface PlaneFix {
  x: number;
  y: number;
  lon: number;
  lat: number;
  atSec: number;
  /** Set by the matcher once the fix has been placed on a path or shape:
   *  the geometry (`p<pathIdx>` or `b<shapeIdx>`), the arc along it, and
   *  whether that arc lies within a stop zone (speed.ts skips such
   *  intervals as dwell-contaminated when cleaner ones exist). */
  arc?: { key: string; s: number; atStop: boolean };
}

/** Where the matcher put the vehicle: on a rail path (tram), on a bus shape
 *  (bus), or on neither (both null: the free plane). `s` is the arc along the
 *  path or shape; `residual` how far the fix lay off the geometry. */
export interface Match {
  pathIdx: number | null;
  shapeIdx: number | null;
  /** The rail edge under a tram on a path; null off the graph and for buses. */
  edge: number | null;
  s: number;
  residual: number;
}

/** [seconds relative to the frame header, metres along the path or shape]. */
export type PathKnot = [tSec: number, s: number];
/** [seconds relative to the frame header, lon, lat]. */
export type FreeKnot = [tSec: number, lon: number, lat: number];

export type Plan =
  | { on: 'path'; pathIdx: number; knots: PathKnot[] }
  | { on: 'shape'; shapeIdx: number; knots: PathKnot[] }
  | { on: 'free'; knots: FreeKnot[] };

export interface NextStop {
  stopId: string;
  /** Arc of the stop along the vehicle's path or shape. */
  s: number;
  /** Planned arrival, epoch seconds, when the plan reaches it. */
  etaSec: number | null;
}

/** The ordering register's memory (order.ts, E3): the ONE vehicle this one
 *  is established behind, when that was written, how many consecutive fresh
 *  fixes have contradicted it since, and the per-partner witnesses a pair
 *  collects before any relation is written at all. */
export interface OrderState {
  /** The vehicle id this one is established behind, or null. */
  leader: string | null;
  /** The follower fix time (epoch seconds) the relation was written at. */
  since: number;
  /** Consecutive fresh follower fixes that read ahead of the leader. */
  contradictions: number;
  /** The follower fix time the last contradiction was counted at, so three
   *  passes over one fix count as the one observation they are. */
  countedAt: number;
  /** Per partner vehicle id: consecutive fresh fixes of the pair that read
   *  the same way round (`lead` is the id they put ahead), and the pair
   *  evidence time they were counted at. Kept on the track whose id sorts
   *  first, so one pair is counted once. */
  witnesses: Record<string, { n: number; at: number; lead: string }>;
}

export interface Track {
  id: string;
  routeId: string;
  tripId: string | null;
  kind: VehicleKind;
  /** Oldest first, at most MAX_TRACK_FIXES. */
  fixes: PlaneFix[];
  match: Match;
  /** The path the trip's prior named at the last match; a change means a
   *  new trip (or a re-derived path), and the order bookkeeping restarts. */
  priorPath: number | null;
  /** True after OFF_GRAPH_FIXES fixes far from every edge (match.ts). */
  offGraph: boolean;
  offGraphCount: number;
  /** Consecutive fixes whose on-path residual exceeded the near band. */
  offPathCount: number;
  /** m/s, the speed estimate from the moving intervals (speed.ts). */
  speed: number;
  /** 0..1, the planner's confidence after silence decay (plan.ts). */
  confidence: number;
  plan: Plan | null;
  next: NextStop | null;
  order: OrderState;
  /** The trip's scheduled first departure in epoch seconds, when the join and
   *  the realtime start date give it (R-TE49); null when unknown. */
  tripStartSec: number | null;
}

/** As many fixes as the wire's history carries (wire.ts): about three
 *  minutes at ZET's tick, enough for the speed estimate's three moving
 *  intervals with a dwell in between. */
export const MAX_TRACK_FIXES = HISTORY_FIXES;

export function noMatch(): Match {
  return { pathIdx: null, shapeIdx: null, edge: null, s: 0, residual: Number.POSITIVE_INFINITY };
}

export function newTrack(id: string, routeId: string, tripId: string | null, kind: VehicleKind): Track {
  return {
    id,
    routeId,
    tripId,
    kind,
    fixes: [],
    match: noMatch(),
    priorPath: null,
    offGraph: false,
    offGraphCount: 0,
    offPathCount: 0,
    speed: 0,
    confidence: 0,
    plan: null,
    next: null,
    order: newOrderState(),
    tripStartSec: null,
  };
}

/** Appends a fix when it is newer than the last one; the ring keeps the
 *  latest MAX_TRACK_FIXES. Returns false for a repeat or an older fix. */
export function pushFix(track: Track, fix: PlaneFix): boolean {
  const last = lastFix(track);
  if (last && fix.atSec <= last.atSec) return false;
  track.fixes.push(fix);
  if (track.fixes.length > MAX_TRACK_FIXES) track.fixes.splice(0, track.fixes.length - MAX_TRACK_FIXES);
  return true;
}

export function lastFix(track: Track): PlaneFix | null {
  return track.fixes.length > 0 ? track.fixes[track.fixes.length - 1] : null;
}

export function newOrderState(): OrderState {
  return { leader: null, since: 0, contradictions: 0, countedAt: 0, witnesses: {} };
}

export function resetOrder(track: Track): void {
  track.order = newOrderState();
}
