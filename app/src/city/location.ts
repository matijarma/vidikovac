import type { ScreenContext } from '../core/contracts';
export interface LocationContext {
  kind: 'screen' | 'area' | 'device' | 'city';
  lon: number; lat: number; name: string;
}
/** The reference point a distance is measured from: the screen's stop, else Trg bana J. Jelačića (city/place.ts DEFAULT_PLACE_NAME). */
export function defaultLocation(screen?: ScreenContext): LocationContext {
  return screen?.stop ? {kind:'screen',lon:screen.stop.lon,lat:screen.stop.lat,name:screen.stop.name} :
    {kind:'city',lon:15.97726,lat:45.81286,name:'Trg bana J. Jelačića'};
}
