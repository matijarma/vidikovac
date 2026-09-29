// Placeholder of a frozen seam of the U3 package (docs/upgrade-2026-10-plan/U3.md §0.2(c)): the names and the
// signatures U3-osm implements, committed by U3-surfaces so the surfaces compile alone from the base. The gazetteer
// is empty and resolves nothing. U3-osm merges first; on the add/add conflict the integrator keeps its version.
import type { FeedItem } from '../../worker/feed/schema';
import type { VenueEntry } from './osm-hours';
import type { Place } from './types';

export interface Gazetteer { readonly size: number }

/** The venue names with their points: the City's culture register, kultura-zg's venues, the OSM venue records. */
export function buildGazetteer(input: { places: readonly Place[]; kultura: readonly FeedItem[]; osm: readonly VenueEntry[] }): Gazetteer {
  void input;
  return { size: 0 };
}

/** The point of the venue an event names, or null when it is not resolved beyond doubt. */
export function resolveVenuePoint(item: FeedItem, gazetteer: Gazetteer): { lon: number; lat: number } | null {
  void item; void gazetteer;
  return null;
}

/** The name of that same matched venue; additive companion to the frozen point-only helper. */
export function resolveVenueName(item: FeedItem, gazetteer: Gazetteer): string | null {
  void item; void gazetteer;
  return null;
}
