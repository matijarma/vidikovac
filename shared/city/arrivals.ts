// What comes next at one stop, as the owner ruled it: the scheduled board and
// the live fleet merged into one list, so a tapped stop first says which trams
// come next and in how many minutes. A trip with a tracked vehicle is timed
// from the schedule plus ZET's own reported delay, refined by the twin's
// next-stop ETA when that vehicle is on its way to this very platform; the
// rest keep their timetable moment and are shown as a clock time.
//
// Pure on purpose: no DOM, no fetch, no clock of its own. It runs in the
// phone sheet, the desktop board and the kiosk card, and could run in the
// Worker; every surface passes the same boards, the same vehicles and its own
// `nowMs`, so every surface says the same thing at the same second.

import { DEPOT_RUNS, depotRunOf, type DepotCode } from './depot-run';
import type { DepartureBoard } from './types';

/** A live vehicle as `arrivalsAt` needs it: the client's VehicleInfo and the
 *  twin's own wire row both satisfy it, so neither side needs a converter. */
export interface LiveVehicleRef {
  id: string;
  tripId?: string;
  routeId?: string;
  /** ZET's TripUpdate delay at the vehicle's next stop, seconds; negative is early. */
  delaySeconds?: number;
  nextStopId?: string;
  /** The twin's own planned arrival at `nextStopId`, epoch ms. */
  nextStopEtaMs?: number;
}

/** One row of the arrivals list. `minutes` is null past the live horizon:
 *  that row shows the clock time of `atMs` instead of a countdown. */
export interface ArrivalRow {
  tripId: string;
  routeId: string;
  routeName: string;
  headsign: string;
  /** The moment this trip is now expected, epoch ms: the ETA, not the timetable. */
  atMs: number;
  /** True when a tracked vehicle carries this trip; drives the live dot. */
  live: boolean;
  vehicleId?: string;
  minutes: number | null;
  /** A pull-in (depot-run.ts): `routeName` is then ST or SD and `headsign`
   *  the depot, not the line it left; `routeId` stays the line's. */
  depot?: DepotCode;
}

export interface ArrivalsOptions {
  /** Beyond this many minutes a row shows a clock time, not a countdown. */
  horizonMin?: number;
  /** How many rows the caller wants. */
  rows?: number;
  /** How long a departure stays on the list after its ETA has passed. */
  pastGraceS?: number;
  /** Every platform id of the tapped stop (a named stop has siblings). */
  stopIds: readonly string[];
  /**
   * Trips ZET's no-service alerts name that no tracked vehicle carries (the
   * twin's `sources.zet.noServiceTrips`, U1). A ZET departure on such a trip
   * is not listed unless a vehicle in `vehicles` carries it: then the row
   * stays, live. Only ZET's namespace is asked, so an HZ id that collides
   * with one is never touched. ZET's CANCELED marker is deliberately absent:
   * 114 of 143 trips so marked were driven on schedule.
   */
  cancelled?: ReadonlySet<string>;
}

/** Ten minutes: past it a countdown is a guess dressed as a fact. */
const HORIZON_MIN = 10;
/** Six rows fit every surface, from the phone sheet to the kiosk card. */
const ROWS = 6;
/** A minute of grace: a tram due at 10:00 is still the tram you are waiting
 *  for at 10:00:45, and dropping it the second it is due empties the list. */
const PAST_GRACE_S = 60;
/** The phone sheet names at most this many lines with cancelled departures. */
const CANCELLED_ROUTES_MAX = 3;

export type ArrivalsStatus = 'live' | 'stale' | 'down' | 'none';

interface Candidate {
  row: ArrivalRow;
  /** The row came off a board whose own status is 'live'. */
  fromLive: boolean;
}

/**
 * The status of the answer as a whole:
 *   'none'  no board at all -- this stop publishes no schedule.
 *   'down'  every board failed; nothing is known about this stop right now.
 *   'live'  every board answered live, or a live board put a row on this list.
 *   'stale' anything between: a sibling platform is stale or down, and what is
 *           on the list did not come from a live board.
 * An all-live stop with nothing left to come today is still 'live': the
 * source is answering, the service is simply over.
 */
function statusOf(boards: readonly DepartureBoard[], shown: readonly Candidate[]): ArrivalsStatus {
  if (boards.length === 0) return 'none';
  if (boards.every((b) => b.status === 'down')) return 'down';
  if (boards.every((b) => b.status === 'live')) return 'live';
  return shown.some((c) => c.fromLive) ? 'live' : 'stale';
}

export function arrivalsAt(
  boards: readonly DepartureBoard[],
  vehicles: readonly LiveVehicleRef[],
  nowMs: number,
  options: ArrivalsOptions,
): { rows: ArrivalRow[]; status: ArrivalsStatus; cancelledRoutes: string[] } {
  const horizonMs = (options.horizonMin ?? HORIZON_MIN) * 60_000;
  const wanted = options.rows ?? ROWS;
  const cutoff = nowMs - (options.pastGraceS ?? PAST_GRACE_S) * 1000;
  const platforms = new Set(options.stopIds);
  const cancelled = options.cancelled;
  // Departures left off because ZET cancelled them, kept for the phone sheet's
  // note: which line, and when the timetable had it.
  const skipped: Array<{ routeName: string; scheduledMs: number }> = [];

  // First vehicle wins a trip id: the twin publishes one pin per vehicle, and
  // two vehicles claiming one trip is a feed fault, not a choice to make here.
  const byTrip = new Map<string, LiveVehicleRef>();
  for (const v of vehicles) if (v.tripId !== undefined && v.tripId !== '' && !byTrip.has(v.tripId)) byTrip.set(v.tripId, v);

  // One row per trip, at its earliest ETA: the same trip is on the board of
  // every sibling platform it calls at, and the rider waits for it once.
  const best = new Map<string, Candidate>();
  for (const board of boards) {
    const fromLive = board.status === 'live';
    for (const departure of board.departures) {
      const scheduled = Date.parse(departure.at);
      if (!Number.isFinite(scheduled)) continue;
      // Only ZET runs tracked vehicles. An HŽ board keeps clock times whatever
      // its trip ids look like: the two operators number trips in their own
      // namespaces, and a collision must not put a tram on a train's row.
      const vehicle = departure.operator !== 'zet' || departure.tripId === '' ? undefined : byTrip.get(departure.tripId);
      // ZET said it will not run this trip and no vehicle has taken it: the
      // departure is not a departure. A vehicle on the trip keeps the row (the
      // alert trip that ran, 1 in 83, and the vehicle is the better witness).
      // A ZET pull-in is shown as its depot, under ST or SD (depot-run.ts).
      const depot = departure.operator === 'zet' ? depotRunOf(departure.headsign) : null;
      const routeName = depot ?? departure.routeName;
      if (cancelled && departure.operator === 'zet' && departure.tripId !== '' && cancelled.has(departure.tripId) && vehicle === undefined) {
        skipped.push({ routeName, scheduledMs: scheduled });
        continue;
      }
      let atMs = scheduled;
      if (vehicle) {
        atMs = scheduled + (vehicle.delaySeconds ?? 0) * 1000;
        // The twin planned this vehicle's arrival at the platform in front of
        // it. When that platform is the one being asked about, that ETA is
        // closer to the truth than the timetable plus a delay measured
        // somewhere else, and it wins.
        if (vehicle.nextStopId !== undefined && platforms.has(vehicle.nextStopId)
          && vehicle.nextStopEtaMs !== undefined && Number.isFinite(vehicle.nextStopEtaMs)) atMs = vehicle.nextStopEtaMs;
      }
      if (atMs < cutoff) continue;
      const row: ArrivalRow = {
        tripId: departure.tripId,
        routeId: departure.routeId,
        routeName,
        headsign: depot ? DEPOT_RUNS[depot].name : departure.headsign,
        atMs,
        live: vehicle !== undefined,
        ...(vehicle ? { vehicleId: vehicle.id } : {}),
        minutes: atMs - nowMs <= horizonMs ? Math.max(0, Math.round((atMs - nowMs) / 60_000)) : null,
        ...(depot ? { depot } : {}),
      };
      // A board without trip ids (none is expected, but the field is a plain
      // string) must not fold its own departures into one row.
      const key = departure.tripId === '' ? `${board.stopId}|${departure.routeId}|${departure.at}` : departure.tripId;
      const held = best.get(key);
      if (!held || row.atMs < held.row.atMs) best.set(key, { row, fromLive: fromLive || (held?.fromLive ?? false) });
      else if (fromLive) held.fromLive = true;
    }
  }

  const sorted = [...best.values()].sort((a, b) => a.row.atMs - b.row.atMs || a.row.routeName.localeCompare(b.row.routeName));
  const shown = sorted.slice(0, wanted);
  return { rows: shown.map((c) => c.row), status: statusOf(boards, shown), cancelledRoutes: cancelledRoutesOf(skipped, cutoff, shown, wanted) };
}

/** The lines whose cancelled departures fall inside what the list shows: at or
 *  after the cutoff and no later than the last shown row (any time when the
 *  list is not full), in time order, each once, at most three. A cancelled
 *  departure hours past a full list is not news to the rider looking at it. */
function cancelledRoutesOf(skipped: readonly { routeName: string; scheduledMs: number }[], cutoff: number, shown: readonly Candidate[], wanted: number): string[] {
  const last = shown.length >= wanted && shown.length > 0 ? shown[shown.length - 1].row.atMs : Infinity;
  const names: string[] = [];
  for (const entry of [...skipped].sort((a, b) => a.scheduledMs - b.scheduledMs || a.routeName.localeCompare(b.routeName))) {
    if (entry.scheduledMs < cutoff || entry.scheduledMs > last) continue;
    if (!names.includes(entry.routeName)) names.push(entry.routeName);
    if (names.length === CANCELLED_ROUTES_MAX) break;
  }
  return names;
}
