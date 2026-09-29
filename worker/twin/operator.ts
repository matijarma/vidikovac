// What ZET itself says about its service, folded from the frame's Alert
// entities and cancellation markers (upgrade U1). Pure: decode gives the raw
// alerts (feed-decode.ts), this keeps the statements the boards may act on,
// publish.ts puts them on the wire (sources.zet.noServiceTrips, and
// service.operator once U2's judgement carries the summary).
//
// The one rule that removes anything: a trip-level NO_SERVICE alert (an
// informed entity that names a trip and no stop). Measured on 21 and 24 Sep:
// 83 bus trips so announced, 1 ran (1.2 %). The CANCELED trip marker is not
// that: 114 of the 143 trips marked CANCELED were driven on schedule, so it is
// counted here and never removes or restyles a row. Stop-level entities (one
// alert in two days), route-level ones (none recorded) and SKIPPED stops (0 of
// 2.8 million) are decoded and counted only: applying them needs a calendar
// the twin does not have.

import type { DecodedFeed, RawAlert } from './feed-decode';

/** The wire carries at most this many trip ids (about 30 on a recorded day). */
export const OPERATOR_TRIPS_MAX = 400;

/** What one frame said, counted. The trip map below is replaced by every
 *  frame; so are these. They go to the `twin_state_size` log and, for the
 *  alerts, into U2's `service.operator`. */
export interface OperatorCounts {
  /** Alert entities with effect NO_SERVICE. */
  noServiceAlerts: number;
  /** Informed entities of those alerts, by kind: a trip and no stop, a stop
   *  (with or without a trip), a route alone. */
  tripEntities: number;
  stopEntities: number;
  routeEntities: number;
  /** Trip updates whose descriptor says CANCELED. */
  canceledUpdates: number;
  /** Stop time updates that say SKIPPED. */
  skippedStops: number;
  /** Alerts with a run of three letters in their header or description. */
  textAlerts: number;
}

export interface OperatorState {
  /** Trips the latest frame's trip-level NO_SERVICE alerts name, each with the
   *  end of the alert's announced period in epoch seconds, null when the alert
   *  has no period or one without an end. Replaced by every frame: ZET
   *  re-issues an alert every frame while it holds and drops it when it stops. */
  noServiceTrips: Record<string, number | null>;
  counts: OperatorCounts;
  /** The header time of the last frame that carried an alert with words. */
  textAtSec: number | null;
}

/** The shape U2 reserves for `service.operator` in shared/city/service-wire.ts. */
export interface OperatorSummary {
  cancelledTrips: number;
  noServiceAlerts: number;
  noticesAt: string | null;
}

export function emptyOperatorCounts(): OperatorCounts {
  return { noServiceAlerts: 0, tripEntities: 0, stopEntities: 0, routeEntities: 0, canceledUpdates: 0, skippedStops: 0, textAlerts: 0 };
}

export function emptyOperator(): OperatorState {
  return { noServiceTrips: {}, counts: emptyOperatorCounts(), textAtSec: null };
}

/** The end of an alert's announced period: the latest end of its periods,
 *  null when it has none or any of them is open-ended. */
function periodEnd(alert: RawAlert): number | null {
  if (alert.periods.length === 0) return null;
  let latest = -Infinity;
  for (const [, end] of alert.periods) {
    if (end === null) return null;
    if (end > latest) latest = end;
  }
  return latest;
}

/** Folds one decoded frame into the statement. A frame replaces the trip map
 *  and the counts; `textAtSec` only moves forward when an alert has words. */
export function foldOperator(prev: OperatorState, feed: DecodedFeed): OperatorState {
  const counts = emptyOperatorCounts();
  const noServiceTrips: Record<string, number | null> = {};
  let anyText = false;

  for (const alert of feed.alerts ?? []) {
    if (alert.text) {
      counts.textAlerts++;
      anyText = true;
    }
    if (!alert.noService) continue;
    counts.noServiceAlerts++;
    const end = periodEnd(alert);
    for (const entity of alert.informed) {
      if (entity.stopId !== undefined) {
        counts.stopEntities++;
      } else if (entity.tripId !== undefined) {
        counts.tripEntities++;
        // Open-ended wins over any end: the alert that never says when it stops.
        const known = noServiceTrips[entity.tripId];
        noServiceTrips[entity.tripId] = known === null || end === null ? null : Math.max(known ?? end, end);
      } else if (entity.routeId !== undefined) {
        counts.routeEntities++;
      }
    }
  }

  for (const update of feed.tripUpdates) {
    if (update.canceled) counts.canceledUpdates++;
    for (const stop of update.stops) if (stop.skipped) counts.skippedStops++;
  }

  return { noServiceTrips, counts, textAtSec: anyText && feed.headerTs !== null ? feed.headerTs : prev.textAtSec };
}

/** Every statement still standing at `nowSec` that no tracked vehicle
 *  contradicts, sorted. A trip whose announced period ended is over; a trip a
 *  positioned vehicle carries is being driven (the one alert trip in 83 that
 *  ran, and the rule's fallback: the row stays live). */
function standing(operator: OperatorState, carried: ReadonlySet<string>, nowSec: number): string[] {
  const ids: string[] = [];
  for (const [tripId, end] of Object.entries(operator.noServiceTrips)) {
    if (end !== null && end <= nowSec) continue;
    if (carried.has(tripId)) continue;
    ids.push(tripId);
  }
  return ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The trip ids for `sources.zet.noServiceTrips`: at most OPERATOR_TRIPS_MAX,
 *  sorted, carriers removed. */
export function noServiceTripIds(operator: OperatorState, carried: ReadonlySet<string>, nowSec: number): string[] {
  return standing(operator, carried, nowSec).slice(0, OPERATOR_TRIPS_MAX);
}

/** U2's `service.operator`: the trips count is taken before the cap. */
export function operatorSummary(operator: OperatorState, carried: ReadonlySet<string>, nowSec: number): OperatorSummary {
  return {
    cancelledTrips: standing(operator, carried, nowSec).length,
    noServiceAlerts: operator.counts.noServiceAlerts,
    noticesAt: operator.textAtSec === null ? null : new Date(operator.textAtSec * 1000).toISOString(),
  };
}
