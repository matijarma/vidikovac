// The engine core, assembled once per loaded network and trip index: the
// matcher (match.ts), the timetable as a TimesProvider (times.ts) and the
// network itself, which the planner (plan.ts) and the register (order.ts) read
// directly. The Durable Object builds one when both static assets have
// loaded and rebuilds it when either changes; a tick without an engine
// (no geometry loaded) still publishes free-plane plans (tick.ts).

import { createDwellTable, type DwellOverride, type DwellRecent, type DwellTable } from '../../shared/motion/dwell';
import { createJunctionTable, type JunctionTable } from '../../shared/motion/junction';
import { emptyAggregates, type LearnedAggregates } from '../../shared/motion/learn';
import { createMatcher, type Matcher } from '../../shared/motion/match';
import type { GraphNetwork } from '../../shared/motion/network';
import { learnedTimes, mapPatternsToPaths, scheduleTimes, type TimesProvider } from '../../shared/motion/times';
import type { VehicleKind } from '../../shared/motion/track';
import type { TripIndex } from '../../shared/motion/trips';
import type { ZetRoutes } from '../feed/modules/zet-routes';

export interface Engine {
  net: GraphNetwork;
  index: TripIndex;
  /** The timetable, as the fallback the learned wrapper falls through to. */
  schedule: TimesProvider;
  /** What the planner asks: learned medians where thick, the schedule elsewhere (C1). */
  times: TimesProvider;
  /** Learned medians only, null where a band is thin: what prices the travel inside a dwell sample. */
  learnedOnly: TimesProvider;
  /** The live aggregates `times` reads; the twin adds every tick's evidence here. */
  learned: LearnedAggregates;
  /** The one answer to "how long does this platform hold a tram" (F11): the
   *  owner's overrides, the rolling recent window, the learned histogram and
   *  the timetable, in that order. The planner books its dwells from it, the
   *  speed estimator charges it per stop, and the learner prices the other
   *  stops inside a dwell sample with it, so the three cannot disagree. */
  dwell: DwellTable;
  /** The live recent window the table reads; the twin appends every measured
   *  dwell here, and it is persisted beside the histograms. */
  dwellRecent: DwellRecent;
  /** Where the rails branch and how long a tram waits there (F11): the
   *  planner books the median wait at a crossing trams actually stop at. */
  junctions: JunctionTable;
  matcher: Matcher;
  /** The path id each pattern of the index runs, resolved once here so a
   *  trip's join carries it and the matcher's prior and the timetable pick
   *  the same path for a shapeless variant (F8). */
  patternPathIds: readonly (string | null)[];
}

/** A timetable that knows nothing: under the learned wrapper it leaves null
 *  wherever no band is thick, so the learner never prices a dwell sample's
 *  travel off a schedule that may be as wrong as what it is trying to learn. */
const NO_TIMES: TimesProvider = { segmentSeconds: () => null, dwellSeconds: () => null };

export interface EngineOptions {
  /** The owner's hand-edited dwell table (F11), already parsed. */
  overrides?: readonly DwellOverride[];
  /** The rolling window of measured dwells, by reference: the twin keeps
   *  appending to the object it hands in, and the table reads it live. */
  dwellRecent?: DwellRecent;
}

export function createEngine(net: GraphNetwork, index: TripIndex, learned: LearnedAggregates = emptyAggregates(), options: EngineOptions = {}): Engine {
  const schedule = scheduleTimes(net, index);
  const dwellRecent = options.dwellRecent ?? {};
  return {
    net,
    index,
    schedule,
    times: learnedTimes(schedule, learned, net),
    learnedOnly: learnedTimes(NO_TIMES, learned, net),
    learned,
    dwell: createDwellTable({ net, schedule, aggregates: learned, overrides: options.overrides ?? [], recent: dwellRecent }),
    dwellRecent,
    junctions: createJunctionTable({ net, aggregates: learned }),
    matcher: createMatcher(net),
    patternPathIds: mapPatternsToPaths(net, index).pathIdOf,
  };
}

/** Tram or bus, from the network's route table first (the same static GTFS
 *  the artefact was cut from), else the routes file the module titles with;
 *  an unknown route is a bus: it may overtake and reverse, a tram may not. */
export function kindOf(engine: Engine | null, routes: ZetRoutes, routeId: string): VehicleKind {
  const fromNet = engine?.net.routes.get(routeId)?.type;
  if (fromNet !== undefined) return fromNet === 0 ? 'tram' : 'bus';
  const fromRoutes = routes[routeId]?.type;
  return fromRoutes !== undefined && Number(fromRoutes) === 0 ? 'tram' : 'bus';
}
