// Trams on the synthetic corridor, as the twin would see them through ZET's
// feed: truth motion with dwell at every stop, a GPS fix with noise at a
// random latency for about two vehicles in three per 10 s tick, and one
// TripUpdate per trip naming the next stop and its true arrival time.
// Deterministic under a seed, so an envelope that fails reproduces.
import type { GraphNetwork } from '../../shared/motion/network';
import { lonLatOf } from './synthetic-network';

export interface SimOptions {
  trams: number;
  /** Seconds between departures from the trunk's start. */
  headwaySec: number;
  cruiseMs: number;
  dwellSec: number;
  /** GPS noise, one standard deviation, metres. */
  noiseM: number;
  /** Probability a vehicle reports a new fix in a tick. */
  refreshP: number;
  latencyMinSec: number;
  latencyMaxSec: number;
  tickSec: number;
  durationSec: number;
  seed: number;
  /** Header time of the first frame, epoch seconds. */
  startSec: number;
}

export interface SimFix {
  id: string;
  routeId: string;
  tripId: string;
  shapeId: string;
  direction: 0 | 1;
  lon: number;
  lat: number;
  atSec: number;
}

export interface SimUpdate {
  tripId: string;
  stopId: string;
  timeSec: number;
}

export interface SimFrame {
  headerSec: number;
  fixes: SimFix[];
  updates: SimUpdate[];
}

export interface SimTram {
  id: string;
  routeId: string;
  tripId: string;
  pathIdx: number;
  shapeId: string;
  direction: 0 | 1;
  departSec: number;
  /** Arc along the path at absolute time t, and whether the tram is dwelling. */
  truth(tSec: number): { s: number; dwelling: boolean; started: boolean; nextStopId: string | null; nextArrivalSec: number | null };
}

export interface Simulation {
  frames: SimFrame[];
  trams: SimTram[];
}

/** mulberry32: small, seeded, good enough for noise and coin flips. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  // Box-Muller; both draws strictly inside (0, 1).
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Truth along one path: cruise at `cruiseMs`, stand `dwellSec` at every stop
 * strictly ahead of the start, and hold at the path end (a terminus dwell
 * until the trip changes, which the simulation never does).
 */
function truthOnPath(net: GraphNetwork, pathIdx: number, departSec: number, cruiseMs: number, dwellSec: number): SimTram['truth'] {
  const stops = net.stopsOnPath(pathIdx).filter((entry) => entry.s > 0);
  const len = net.paths[pathIdx].len;
  // Arrival and departure times at each stop, in order.
  const schedule: { s: number; arrive: number; depart: number; stopId: string }[] = [];
  let t = departSec;
  let s = 0;
  for (const entry of stops) {
    t += (entry.s - s) / cruiseMs;
    s = entry.s;
    schedule.push({ s, arrive: t, depart: t + dwellSec, stopId: entry.stop.id });
    t += dwellSec;
  }
  const endSec = t + (len - s) / cruiseMs;
  return (tSec) => {
    if (tSec < departSec) return { s: 0, dwelling: true, started: false, nextStopId: schedule[0]?.stopId ?? null, nextArrivalSec: schedule[0]?.arrive ?? null };
    let prevDepart = departSec;
    let prevS = 0;
    for (const entry of schedule) {
      if (tSec < entry.arrive) {
        return { s: prevS + (tSec - prevDepart) * cruiseMs, dwelling: false, started: true, nextStopId: entry.stopId, nextArrivalSec: entry.arrive };
      }
      if (tSec < entry.depart) {
        const following = schedule[schedule.indexOf(entry) + 1];
        return { s: entry.s, dwelling: true, started: true, nextStopId: following?.stopId ?? null, nextArrivalSec: following?.arrive ?? null };
      }
      prevDepart = entry.depart;
      prevS = entry.s;
    }
    if (tSec < endSec) return { s: prevS + (tSec - prevDepart) * cruiseMs, dwelling: false, started: true, nextStopId: null, nextArrivalSec: null };
    return { s: len, dwelling: true, started: true, nextStopId: null, nextArrivalSec: null };
  };
}

/**
 * Trams alternate between the paths given (route '1' path 1_0 and route '2'
 * path 2_0 on the corridor), departing `headwaySec` apart.
 */
export function simulate(net: GraphNetwork, pathIds: string[], options: SimOptions): Simulation {
  const rand = prng(options.seed);
  const trams: SimTram[] = [];
  for (let i = 0; i < options.trams; i++) {
    const pathId = pathIds[i % pathIds.length];
    const pathIdx = net.paths.findIndex((p) => p.id === pathId);
    const path = net.paths[pathIdx];
    const departSec = options.startSec + i * options.headwaySec;
    trams.push({
      id: `tram-${i + 1}`,
      routeId: path.route,
      tripId: `trip-${i + 1}`,
      pathIdx,
      shapeId: path.id,
      direction: path.direction === 1 ? 1 : 0,
      departSec,
      truth: truthOnPath(net, pathIdx, departSec, options.cruiseMs, options.dwellSec),
    });
  }

  const frames: SimFrame[] = [];
  const lastFixAt = new Map<string, number>();
  for (let headerSec = options.startSec; headerSec <= options.startSec + options.durationSec; headerSec += options.tickSec) {
    const fixes: SimFix[] = [];
    const updates: SimUpdate[] = [];
    for (const tram of trams) {
      const latency = options.latencyMinSec + rand() * (options.latencyMaxSec - options.latencyMinSec);
      const atSec = Math.floor(headerSec - latency);
      const state = tram.truth(atSec);
      if (!state.started) continue;
      const previous = lastFixAt.get(tram.id) ?? -Infinity;
      if (atSec > previous && rand() < options.refreshP) {
        const p = net.toPathPoint(tram.pathIdx, state.s);
        const noisy = { x: p.x + gaussian(rand) * options.noiseM, y: p.y + gaussian(rand) * options.noiseM };
        const { lon, lat } = lonLatOf(noisy);
        fixes.push({ id: tram.id, routeId: tram.routeId, tripId: tram.tripId, shapeId: tram.shapeId, direction: tram.direction, lon: Math.round(lon * 1e5) / 1e5, lat: Math.round(lat * 1e5) / 1e5, atSec });
        lastFixAt.set(tram.id, atSec);
      }
      const nowState = tram.truth(headerSec);
      if (nowState.nextStopId && nowState.nextArrivalSec !== null) {
        updates.push({ tripId: tram.tripId, stopId: nowState.nextStopId, timeSec: Math.round(nowState.nextArrivalSec) });
      }
    }
    frames.push({ headerSec, fixes, updates });
  }
  return { frames, trams };
}
