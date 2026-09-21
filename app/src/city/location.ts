import type { ScreenContext } from '../core/contracts';
import type { I18n } from '../i18n/i18n';
export interface LocationContext {
  kind: 'screen' | 'area' | 'device' | 'city';
  lon: number; lat: number; name: string;
}
export function defaultLocation(screen?: ScreenContext): LocationContext {
  return screen?.stop ? {kind:'screen',lon:screen.stop.lon,lat:screen.stop.lat,name:screen.stop.name} :
    {kind:'city',lon:15.97726,lat:45.81286,name:'Trg bana Jelačića'};
}
export function locationLabel(i18n: Pick<I18n,'getLocale'>, location: LocationContext): string {
  const en=i18n.getLocale().startsWith('en');
  if(location.kind==='device')return en?'Your granted device location':'Lokacija uređaja koju si dopustio/la';
  if(location.kind==='area')return en?'Centre of the viewed map area':'Središte pregledanog područja karte';
  return `${location.kind==='screen'?(en?'Screen stop':'Stajalište zaslona'):(en?'City reference':'Gradska referentna točka')}: ${location.name}`;
}
