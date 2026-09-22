// The city's own points on a map somebody reads from a step away: the wall's
// frame (kiosk/mapview.ts) and the phone's Karta, which reuses the same rule.
// The map curates rather than lists: every BAJS station is a disc with its
// count in it (a grey "0" when it has no bike, a grey disc without a number
// when the count is unknown or the station is not renting, never "?"), a
// culture venue is on it only with a programme in the window (tonight on the
// wall) and then with its name, the air stations are an option the wall
// leaves off, and nothing is ever merged into a geographic "+N" bubble.
// Pure: no DOM, no clock of its own.
import type { CityState, Place } from '../../../shared/city/types';
import { activeVenues, locatedEvents, type EventWindow } from '../../../shared/city/events';
import { located } from '../../../shared/city/geo';
import type { FeedItem } from '../../../worker/feed/schema';
import type { MapPoint } from '../map/city-map';
import { dynamicPlaces } from './discovery';

export interface CuratedOptions {
  /** Which venues are on the map: a venue is drawn only with a programme in
   *  this window ('tonight' on the wall, shared/city/events.ts). */
  venues: EventWindow;
  /** The air-quality stations as marks. An option: the wall leaves them off. */
  air: boolean;
  /** The unframed window onto the whole city (a screen with no place of its
   *  own): each BAJS station stays a small dot without its number, because a
   *  hundred counted discs over the whole town bury the trams. The points
   *  carry `far: true` and map/city-layers.ts draws them so. Default false. */
  far?: boolean;
}

/** The wall's curation: tonight's venues, no air stations, counted discs. */
export const CURATED_WALL: Readonly<CuratedOptions> = Object.freeze({ venues: 'tonight', air: false });

/** What a BAJS station's disc says. `spent` greys the disc: a station with
 *  nothing to give is still on the map, because somebody walking to it needs
 *  to know it is there, but it recedes behind the ones that can be used. */
export interface BikeDisc {
  /** The count of bikes standing in it, "0", or '' when that is not known. */
  badge: string;
  spent: boolean;
}

/** Reads the facts dynamicPlaces() (city/discovery.ts) writes for a BAJS
 *  station, as shared/city/bikes.ts bikeAvailability reads them, but never
 *  answers "?" or "—": an unknown count or a station that is not renting is
 *  a grey disc without a number. */
export function bikeDisc(place: Place): BikeDisc {
  const facts = place.facts;
  if (!facts?.fresh || !facts.operational) return { badge: '', spent: true };
  const bikes = facts.bikes;
  if (typeof bikes !== 'number' || !Number.isFinite(bikes) || bikes < 0) return { badge: '', spent: true };
  return bikes > 0 ? { badge: String(bikes), spent: false } : { badge: '0', spent: true };
}

/** Every located BAJS station, every located venue with a programme in
 *  `o.venues`, and with `o.air` every fresh air station, as city points. The
 *  titles are carried: the layer (CityLabels, map/city-layers.ts) decides
 *  which kinds are named. The shapes are discover()'s own, so a tap reaches
 *  the same place through the same properties whichever built it. */
export function curatedCityPoints(city: CityState, dogadanja: readonly FeedItem[], now: number, o: CuratedOptions = CURATED_WALL): MapPoint[] {
  const out: MapPoint[] = [];
  const dynamic = dynamicPlaces(city, now);
  for (const place of dynamic) {
    if (place.sourceId !== 'bajs' || !located(place)) continue;
    const disc = bikeDisc(place);
    out.push({ id: place.id, title: place.name, lon: place.lon, lat: place.lat, place: 'city',
      props: { category: 'bikes', badge: disc.badge, spent: disc.spent, eventCount: 0, priority: 2, ...(o.far ? { far: true } : {}) } });
  }
  for (const venue of activeVenues(locatedEvents(dogadanja, city.places, now, o.venues), city.places)) {
    if (!located(venue.place)) continue;
    out.push({ id: venue.place.id, title: venue.place.name, lon: venue.place.lon, lat: venue.place.lat, place: 'city',
      props: { category: venue.place.category, badge: String(venue.count), eventCount: venue.count, priority: 0 } });
  }
  if (o.air) {
    for (const place of dynamic) {
      if (place.sourceId !== 'air' || !located(place) || !place.facts?.fresh) continue;
      out.push({ id: place.id, title: place.name, lon: place.lon, lat: place.lat, place: 'city',
        props: { category: 'air', badge: '', eventCount: 0, priority: 3 } });
    }
  }
  return out;
}
