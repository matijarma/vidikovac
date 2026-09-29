// Three cheap joins across sources (docs/upgrade-2026-10-plan/U3.md S5), pure: no DOM, no fetch, no clock of its
// own. The header sentence (city/sentence.ts sentenceFacts) says what they find in its own families.
//   J1 is the rain row's rainAt fact (city/nearby.ts rainRows): the nearest DHMZ station's next wet step.
//   J2 eventLastTram: the soonest timed event today inside the circle that has an end, and the place's last tram
//      that leaves soonest at or after that end, when it leaves within EVENT_LAST_TRAM_MS of it. A tram that leaves
//      before the event ends is never offered: it would be a promise the reader cannot keep.
//   J3 bikesEmpty: the nearest fresh, operational BAJS station inside the circle has no bike and another inside it
//      has some: the sentence names both, and the plain bikes fact is not said that tick.
import { distanceM, located } from '../../../shared/city/geo';
import type { Place } from '../../../shared/city/types';
import { dayKey } from '../kiosk/format';
import type { NearbyRow } from './nearby';

/** The last tram is offered after an event only when it leaves this soon after the event's end. */
export const EVENT_LAST_TRAM_MS = 45 * 60_000;

export interface EventLastTram {
  /** The event row (city/nearby.ts eventRows), whose title the sentence quotes. */
  event: NearbyRow;
  routeId: string;
  /** The line's short name as a rider reads it. */
  route: string;
  /** When that last tram leaves, epoch ms. */
  atMs: number;
}

export interface BikeStationFacts {
  place: Place & { lon: number; lat: number };
  bikes: number;
  /** The station's reading, epoch ms (Place.updatedAt). */
  updatedAt: number;
}

export interface BikesEmpty {
  /** The nearest station, with no bike. */
  empty: BikeStationFacts;
  /** The nearest station inside the circle that has bikes. */
  other: BikeStationFacts;
}

export interface JoinInput {
  /** The rows selectNearby chose for the place (the same the sentence reads). */
  rows: readonly NearbyRow[];
  /** The city's dynamic places (city/discovery.ts dynamicPlaces): the BAJS stations among them. */
  places: readonly Place[];
  place: { lon: number; lat: number };
  /** The measured circle; absent, no bike join. */
  radiusM?: number;
  now: number;
}

export interface Joins {
  eventLastTram: EventLastTram | null;
  bikesEmpty: BikesEmpty | null;
}

/** J2: the soonest timed event today with an end, and the last tram at or after that end, within EVENT_LAST_TRAM_MS. */
export function eventLastTram(rows: readonly NearbyRow[], now: number): EventLastTram | null {
  const today = dayKey(now);
  const event = rows
    .filter((row) => row.kind === 'event' && row.atMs !== null && row.atMs >= now && dayKey(row.atMs) === today
      && row.untilMs !== undefined && row.untilMs > row.atMs)
    .sort((a, b) => a.atMs! - b.atMs! || a.id.localeCompare(b.id))[0];
  if (!event) return null;
  const end = event.untilMs!;
  const service = rows
    .filter((row) => row.kind === 'last')
    .flatMap((row) => row.services ?? [])
    .filter((s) => s.atMs >= end && s.atMs > now)
    .sort((a, b) => a.atMs - b.atMs || a.routeId.localeCompare(b.routeId, 'hr', { numeric: true }))[0];
  if (!service || service.atMs - end > EVENT_LAST_TRAM_MS) return null;
  return { event, routeId: service.routeId, route: service.routeName, atMs: service.atMs };
}

/** The fresh, operational BAJS stations inside the circle with a whole count of bikes, nearest first. */
export function bikeStationsNear(places: readonly Place[], place: { lon: number; lat: number }, radiusM: number): BikeStationFacts[] {
  const out: (BikeStationFacts & { d: number })[] = [];
  for (const p of places) {
    if (p.sourceId !== 'bajs' || !located(p) || p.facts?.fresh !== true || p.facts.operational !== true) continue;
    const bikes = p.facts.bikes;
    const updatedAt = Date.parse(p.updatedAt ?? '');
    if (typeof bikes !== 'number' || !Number.isInteger(bikes) || bikes < 0 || !Number.isFinite(updatedAt)) continue;
    const d = distanceM(place, p);
    if (d <= radiusM) out.push({ place: p, bikes, updatedAt, d });
  }
  return out.sort((a, b) => a.d - b.d || a.place.id.localeCompare(b.place.id)).map(({ d: _d, ...station }) => station);
}

/** J3: the nearest station is empty and another inside the circle has bikes. */
export function bikesEmpty(places: readonly Place[], place: { lon: number; lat: number }, radiusM: number): BikesEmpty | null {
  const stations = bikeStationsNear(places, place, radiusM);
  const nearest = stations[0];
  if (!nearest || nearest.bikes !== 0) return null;
  const other = stations.find((station) => station.bikes > 0);
  return other ? { empty: nearest, other } : null;
}

/** Every join for the place at `now`. */
export function joinFacts(input: JoinInput): Joins {
  const radius = input.radiusM;
  return {
    eventLastTram: eventLastTram(input.rows, input.now),
    bikesEmpty: radius !== undefined && radius > 0 ? bikesEmpty(input.places, input.place, radius) : null,
  };
}
