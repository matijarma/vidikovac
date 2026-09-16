// The corridor as the twin sees it: a trip index whose patterns run the
// synthetic network's paths, and the simulator's frames as decoded feeds
// with the joins the twin would find in its index. Shared by the pure tick
// test and the Durable Object test, so both drive the same world.
import type { DecodedFeed } from '../../worker/twin/feed-decode';
import type { TripJoin } from '../../worker/twin/publish';
import type { GraphNetwork } from '../../shared/motion/network';
import type { TripIndex, TripPattern, TripRecord } from '../../shared/motion/trips';
import type { SimFrame, Simulation } from '../motion/simulator';

/** Cruise the corridor's timetable assumes between stops 300 m apart, and
 *  the dwell it books at every stop (the simulator stands its trams that long). */
export const CORRIDOR_CRUISE_MS = 10;
export const CORRIDOR_DWELL_S = 20;

/** A TripIndex over the network's tram paths: one pattern per path, its stops
 *  in arc order, the scheduled seconds per pair from the cruise, the dwell
 *  the simulator uses, one trip per given id. */
export function corridorIndex(net: GraphNetwork, trips: { tripId: string; pathId: string }[]): TripIndex {
  const patterns: TripPattern[] = net.paths.map((path, pathIdx) => {
    const stops = net.stopsOnPath(pathIdx);
    const seconds = stops.slice(1).map((entry, i) => Math.round((entry.s - stops[i].s) / CORRIDOR_CRUISE_MS));
    return {
      route: path.route,
      direction: path.direction,
      shape: path.shape === null ? '' : path.id,
      headsign: `Kraj ${path.id}`,
      stops: stops.map((entry) => entry.stop.id),
      sched: Array.from({ length: 24 }, () => [...seconds]),
      dwell: stops.map(() => CORRIDOR_DWELL_S),
      trips: 1,
    };
  });
  const tripsById = new Map<string, TripRecord>();
  for (const trip of trips) {
    const pattern = net.paths.findIndex((p) => p.id === trip.pathId);
    if (pattern < 0) throw new Error(`no path ${trip.pathId}`);
    tripsById.set(trip.tripId, { pattern, block: `blk-${trip.tripId}`, start: 0, service: 'wd' });
  }
  const blocks = new Map<string, string[]>();
  for (const [tripId, record] of tripsById) blocks.set(record.block, [tripId]);
  return {
    feedVersion: 'corridor',
    patterns,
    tripsById,
    blocks,
    schedSeconds: (patternIdx, fromStopIdx, hourBand) => patterns[patternIdx].sched[hourBand][fromStopIdx],
  };
}

/** The joins the twin's index lookup would answer for the simulation's trips. */
export function corridorJoins(sim: Simulation): Map<string, TripJoin> {
  return new Map(sim.trams.map((tram) => [tram.tripId, { direction: tram.direction, headsign: `Kraj ${tram.pathIdx}`, shapeId: tram.shapeId }]));
}

/** One simulator frame as the decoded feed the twin folds. */
export function frameAsFeed(frame: SimFrame, sim: Simulation): DecodedFeed {
  const routeOf = new Map(sim.trams.map((tram) => [tram.tripId, tram.routeId]));
  return {
    headerTs: frame.headerSec,
    vehicles: frame.fixes.map((f) => ({ vehicleId: f.id, tripId: f.tripId, routeId: f.routeId, lon: f.lon, lat: f.lat, atSec: f.atSec })),
    tripUpdates: frame.updates.map((u) => ({
      tripId: u.tripId,
      routeId: routeOf.get(u.tripId),
      atSec: frame.headerSec,
      stops: [{ seq: null, stopId: u.stopId, delaySec: 0, timeSec: u.timeSec }],
    })),
  };
}
