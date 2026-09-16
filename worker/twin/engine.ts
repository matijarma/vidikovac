// The engine core, assembled once per loaded network and trip index: the
// matcher (match.ts), the timetable as a TimesProvider (times.ts) and the
// network itself, which the planner (plan.ts) and the laws (laws.ts) read
// directly. The Durable Object builds one when both static assets have
// loaded and rebuilds it when either changes; a tick without an engine
// (no geometry loaded) still publishes free-plane plans (tick.ts).

import { createMatcher, type Matcher } from '../../shared/motion/match';
import type { GraphNetwork } from '../../shared/motion/network';
import { scheduleTimes, type TimesProvider } from '../../shared/motion/times';
import type { VehicleKind } from '../../shared/motion/track';
import type { TripIndex } from '../../shared/motion/trips';
import type { ZetRoutes } from '../feed/modules/zet-routes';

export interface Engine {
  net: GraphNetwork;
  index: TripIndex;
  times: TimesProvider;
  matcher: Matcher;
}

export function createEngine(net: GraphNetwork, index: TripIndex): Engine {
  return { net, index, times: scheduleTimes(net, index), matcher: createMatcher(net) };
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
