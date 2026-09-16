// The engine core, assembled once per loaded network and trip index: the
// matcher (match.ts), the timetable as a TimesProvider (times.ts) and the
// network itself, which the planner (plan.ts) and the laws (laws.ts) read
// directly. The Durable Object builds one when both static assets have
// loaded and rebuilds it when either changes; a tick without an engine
// (no geometry loaded) still publishes free-plane plans (tick.ts).

import { emptyAggregates, type LearnedAggregates } from '../../shared/motion/learn';
import { createMatcher, type Matcher } from '../../shared/motion/match';
import type { GraphNetwork } from '../../shared/motion/network';
import { learnedTimes, scheduleTimes, type TimesProvider } from '../../shared/motion/times';
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
  matcher: Matcher;
}

/** A timetable that knows nothing: under the learned wrapper it leaves null
 *  wherever no band is thick, so the learner never prices a dwell sample's
 *  travel off a schedule that may be as wrong as what it is trying to learn. */
const NO_TIMES: TimesProvider = { segmentSeconds: () => null, dwellSeconds: () => null };

export function createEngine(net: GraphNetwork, index: TripIndex, learned: LearnedAggregates = emptyAggregates()): Engine {
  const schedule = scheduleTimes(net, index);
  return { net, index, schedule, times: learnedTimes(schedule, learned, net), learnedOnly: learnedTimes(NO_TIMES, learned, net), learned, matcher: createMatcher(net) };
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
