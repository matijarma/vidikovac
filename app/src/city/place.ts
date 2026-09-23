// The phone's place (companion WP4 step 1, [O-26], [O-65]): what Sada is
// titled with and which platform its three departures come from. One rule for
// every personal surface, in this order:
//   1. the screen: the place the wall names (ScreenMetadata.place, seam S1)
//      when its operator chose one, else the screen's stop;
//   2. the first saved stop the catalogue knows;
//   3. near the reference the person gave (their device, the map area they
//      looked at): the nearest tram platform within TRAM_NEAR_M, else the
//      nearest bus platform within BUS_NEAR_M, else that point as an address
//      (seam S3's derivePlace, the rule the wall's setup uses);
//   4. Trg bana J. Jelačića, with its departures from DEFAULT_PLACE_STOP_ID.
// The departures come from the place's own stop, else from the nearest
// platform within DEPARTURES_STOP_M, so an address still has a board beside it.
// Pure: the stop catalogue and the saved list are handed in; without the
// catalogue a place that needs it waits for it (departuresStop null).
import { DEFAULT_PLACE_STOP_ID, derivePlace, type ScreenPlace } from '../../../shared/city/place';
import type { ScreenStop } from '../core/contracts';
import type { SavedStore } from '../core/saved-store';
import { rankStops, routeType, stopById } from '../kiosk/stops';
import { defaultLocation, type LocationContext } from './location';

export { BUS_NEAR_M, TRAM_NEAR_M } from '../../../shared/city/place';

/** The farthest platform the phone boards when the place is not itself a stop. */
export const DEPARTURES_STOP_M = 800;
/** The place without a screen place, a saved stop or a reference [O-65]: the stop's own name. */
export const DEFAULT_PLACE_NAME = 'Trg bana J. Jelačića';
/** Where an unnamed reference point sits when no street is known for it. */
const CITY_NAME = 'Zagreb';
/** Trg bana J. Jelačića's point (DEFAULT_PLACE_STOP_ID, city/location.ts), used until the catalogue is in hand. */
const DEFAULT_POINT = defaultLocation();

export type PlaceKind = 'screen' | 'saved' | 'nearest' | 'address' | 'city';

export interface PlaceContext {
  /** The title of Sada: a stop's or a street's name, never a venue's. */
  name: string;
  lon: number;
  lat: number;
  kind: PlaceKind;
  /** The place's own stop, when the place is one. */
  stop: ScreenStop | null;
  /** The platform the departures block boards; null when none is within DEPARTURES_STOP_M or the catalogue is not in hand. */
  departuresStop: ScreenStop | null;
}

/** What the phone knows of its screen: the room's ScreenMetadata, or the shell's ScreenContext (stop only). */
export interface PlaceScreen {
  stop?: ScreenStop | null;
  place?: ScreenPlace | null;
  /** False when `place` is the read path's default (an empty setup field or "Cijeli grad"). */
  placeSet?: boolean;
}

export interface ResolvePlaceInput {
  screen?: PlaceScreen | null;
  saved?: Pick<SavedStore, 'list'>;
  stops?: readonly ScreenStop[];
  location?: LocationContext;
}

const isTram = (routeId: string): boolean => routeType(routeId) === 0;

/** The nearest platform to a point within DEPARTURES_STOP_M, whatever its mode. */
function departuresNear(point: { lon: number; lat: number }, stops: readonly ScreenStop[] | undefined): ScreenStop | null {
  if (!stops?.length) return null;
  const [nearest] = rankStops(stops, { near: point, limit: stops.length });
  // The catalogue's own row, not the ranked copy with its distance field.
  return nearest && nearest.distanceM !== null && nearest.distanceM <= DEPARTURES_STOP_M ? stopById(stops, nearest.id) : null;
}

const fromStop = (kind: PlaceKind, stop: ScreenStop): PlaceContext =>
  ({ name: stop.name, lon: stop.lon, lat: stop.lat, kind, stop, departuresStop: stop });

export function resolvePlace(input: ResolvePlaceInput): PlaceContext {
  const { screen, saved, stops, location } = input;
  // 1. The screen: the wall's own place, so the phone opens on what the wall names.
  const chosen = screen?.place && screen.placeSet !== false ? screen.place : null;
  if (chosen) {
    const own = chosen.stopId
      ? (stops ? stopById(stops, chosen.stopId) : null) ?? (screen?.stop?.id === chosen.stopId ? screen.stop : null)
      : null;
    return {
      name: chosen.name, lon: chosen.lon, lat: chosen.lat, kind: 'screen',
      stop: own, departuresStop: own ?? screen?.stop ?? departuresNear(chosen, stops),
    };
  }
  if (screen?.stop) return fromStop('screen', screen.stop);
  // 2. The first saved stop the catalogue resolves (a saved id is a platform id).
  if (stops && saved) {
    for (const ref of saved.list()) {
      if (ref.kind !== 'stop') continue;
      const stop = stopById(stops, ref.id);
      if (stop) return fromStop('saved', stop);
    }
  }
  // 3. Near the reference the person gave: tram if near, else bus, else the point itself.
  if (location && location.kind !== 'city') {
    if (stops?.length) {
      const place = derivePlace({ lon: location.lon, lat: location.lat, name: location.name }, stops, isTram);
      const stop = place.stopId ? stopById(stops, place.stopId) : null;
      if (stop) return fromStop('nearest', stop);
    }
    return {
      name: location.name.trim() || CITY_NAME, lon: location.lon, lat: location.lat, kind: 'address',
      stop: null, departuresStop: departuresNear(location, stops),
    };
  }
  // 4. Trg bana J. Jelačića [O-65]: the list and the departures always have a place.
  const trg = stops ? stopById(stops, DEFAULT_PLACE_STOP_ID) : null;
  return {
    name: DEFAULT_PLACE_NAME, lon: trg?.lon ?? DEFAULT_POINT.lon, lat: trg?.lat ?? DEFAULT_POINT.lat, kind: 'city',
    stop: null, departuresStop: trg ?? departuresNear(DEFAULT_POINT, stops),
  };
}
