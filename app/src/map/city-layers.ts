import type { OverlayPalette, StyleLayerLike } from './basemap';
import { MAP_FONTS } from './basemap';
export const CITY_POINTS = 'city-places';
export const CITY_PATHS = 'city-paths';
export const CITY_LAYERS = ['city-place-dots','city-place-badges','city-place-labels','city-place-selection','city-path-lines'] as const;
/** The one city-place layer that belongs OVER the vehicles: a selection ring
 *  marks what a person just tapped and a pill passing through must not hide
 *  it. Every other city layer goes under the vehicle marks (city-map.ts). */
export const CITY_SELECTION = 'city-place-selection';
/** The zoom from which a BAJS station is a thing to walk to rather than one
 *  dot in a picture of the whole city: below it the station marks are a size
 *  that lets the tram plates lead (kiosk/mapview.ts CITY_DETAIL_ZOOM is the
 *  same line, one zoom down, where the buses join the trams). */
export const BIKE_NEAR_ZOOM = 14;
export const BIKE_FAR_ZOOM = 13;
/** A station with nothing to give -- no bike ("0"), not renting ("—") or a
 *  source that has gone quiet ("?") -- is still on the map, because a person
 *  walking to it needs to know it is there, but it recedes behind the ones
 *  that can be used (shared/city/bikes.ts bikeAvailability writes the three). */
export const BIKE_SPENT_BADGES: readonly string[] = Object.freeze(['0', '—', '?']);
export const BIKE_SPENT_OPACITY = 0.55;
/** A station's dot, in drawn px before the surface's symbol scale: a minor
 *  mark on the whole city, a small one to walk to in a neighbourhood. */
export const BIKE_FAR_RADIUS_PX = 3;
export const BIKE_NEAR_RADIUS_PX = 5;
/** A merged group of places (city/discovery.ts clusterPlaces) is a counted
 *  dot of this radius, never the 18 px bubble that hid the map beneath it. */
export const CLUSTER_RADIUS_PX = 11;
/** `labels` false leaves the city places' own names off the picture: the
 *  public screen's window onto the whole city is badges and dots only (a BAJS
 *  count, a venue's programme count), because a hundred station names over
 *  the tram network is a list, not a map. The names come back the moment a
 *  person explores (kiosk.ts setCityLabels) or taps one. */
export function cityLayers(p:OverlayPalette, selected:string|null,scale=1,labels=true):StyleLayerLike[] {
  const color=['match',['get','category'],'culture',p.event,'heritage',p.other,'cluster',p.other,'bikes',p.bike,'air',p.other,p.place];
  const isBike=['==',['get','category'],'bikes'];
  // A zoom ramp whose stops are themselves per-category expressions: MapLibre
  // allows ['zoom'] only at the top of a property, so the category case sits
  // INSIDE each stop rather than the interpolation inside a case.
  const byZoom=(far:unknown,near:unknown)=>['interpolate',['linear'],['zoom'],BIKE_FAR_ZOOM,far,BIKE_NEAR_ZOOM,near];
  // A BAJS station is a secondary dot at every zoom -- there are dozens of
  // them, and a hundred large discs bury the trams -- and a merged cluster is
  // a small counted dot, never a bubble. The station's count only appears
  // once the camera is close enough for the number to fit inside the dot.
  const dotRadius=(bike:number)=>['*',scale,['case',isBike,bike,['==',['get','category'],'cluster'],CLUSTER_RADIUS_PX,['>',['get','eventCount'],0],['min',18,['+',11,['sqrt',['get','eventCount']]]],8]];
  const badgeSize=(bike:number)=>['*',scale,['case',isBike,bike,['==',['get','category'],'cluster'],10,12]];
  const spent=['case',['all',isBike,['in',['get','badge'],['literal',BIKE_SPENT_BADGES]]],BIKE_SPENT_OPACITY,1];
  /** The count fades in with the camera: nothing on the whole city, the spent rule once near. */
  const countOpacity=byZoom(['case',isBike,0,1],spent);
  return [
    {id:'city-path-lines',type:'line',source:CITY_PATHS,paint:{'line-color':p.bike,'line-width':2*scale,'line-dasharray':[2,2]}},
    {id:'city-place-dots',type:'circle',source:CITY_POINTS,paint:{
      'circle-radius':byZoom(dotRadius(BIKE_FAR_RADIUS_PX),dotRadius(BIKE_NEAR_RADIUS_PX)),
      'circle-color':color,'circle-stroke-color':p.halo,'circle-stroke-width':['case',isBike,1,2],
      'circle-opacity':spent,'circle-stroke-opacity':spent}},
    {id:'city-place-badges',type:'symbol',source:CITY_POINTS,layout:{
      'text-field':['get','badge'],'text-font':[MAP_FONTS.medium],'text-size':byZoom(badgeSize(7),badgeSize(8)),'text-allow-overlap':false,
      'symbol-sort-key':['get','priority']},paint:{'text-color':['match',['get','category'],'bikes',p.bikeText,p.halo],'text-halo-width':0,'text-opacity':countOpacity}},
    {id:'city-place-labels',type:'symbol',source:CITY_POINTS,minzoom:13,layout:{
      visibility:labels?'visible':'none',
      'text-field':['case',['==',['get','category'],'cluster'],'',['get','title']],'text-font':[MAP_FONTS.medium],'text-size':12*scale,'text-anchor':'top','text-offset':[0,1.5],
      'text-max-width':12,'text-optional':true,'symbol-sort-key':['get','priority']},
      paint:{'text-color':p.label,'text-halo-color':p.halo,'text-halo-width':2}},
    {id:'city-place-selection',type:'circle',source:CITY_POINTS,filter:['==',['get','id'],selected??''],
      paint:{'circle-radius':20*scale,'circle-opacity':0,'circle-stroke-color':p.selection,'circle-stroke-width':3}},
  ];
}
