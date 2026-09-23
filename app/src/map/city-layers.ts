import type { OverlayPalette, StyleLayerLike } from './basemap';
import { MAP_FONTS } from './basemap';
import { nameAnchorOffsets } from './overlays';
export const CITY_POINTS = 'city-places';
export const CITY_PATHS = 'city-paths';
export const CITY_LAYERS = ['city-place-dots','city-place-badges','city-place-labels','city-place-selection','city-path-lines'] as const;
/** The one city-place layer that belongs OVER the vehicles: a selection ring
 *  marks what a person just tapped and a pill passing through must not hide
 *  it. Every other city layer goes under the vehicle marks (city-map.ts). */
export const CITY_SELECTION = 'city-place-selection';
/** A BAJS station is a disc with its count in it at every zoom: 10 px before
 *  the surface's symbol scale, 20 px on the wall's scale 2, room for two
 *  digits of BIKE_COUNT_PX (24 px there). A count is the one thing about a
 *  station a passer-by can act on from across a room. */
export const BIKE_DISC_RADIUS_PX = 10;
/** The count inside the disc: the size of a pill's line number. */
export const BIKE_COUNT_PX = 12;
/** The unframed window onto the whole city (points carrying `far`, from
 *  city/curated.ts) keeps each station a small dot without its number: a
 *  hundred counted discs over the whole town would bury the trams. */
export const BIKE_FAR_RADIUS_PX = 3;
/** What shared/city/bikes.ts bikeAvailability writes for a station with
 *  nothing to give (no bike, not renting, a source gone quiet). A point from
 *  city/curated.ts says so with `spent` instead; both read grey. */
const SPENT_BADGES: readonly string[] = ['0', '—', '?'];
/** Which of the city places' own names the map draws: 'all'; 'venues', the
 *  framed wall's, where a venue with a programme tonight is named and a BAJS
 *  station or an air station is its disc alone; 'none', the unframed window
 *  onto the whole city, badges and dots only, because a hundred names over
 *  the tram network is a list, not a map. A boolean is the older switch:
 *  true is 'all', false is 'none'. */
export type CityLabels = 'all' | 'venues' | 'none';
export function cityLayers(p:OverlayPalette, selected:string|null,scale=1,labels:CityLabels|boolean='all'):StyleLayerLike[] {
  const mode:CityLabels=labels===true?'all':labels===false?'none':labels;
  const isBike=['==',['get','category'],'bikes'];
  const far=['all',isBike,['==',['get','far'],true]];
  const spent=['all',isBike,['any',['==',['get','spent'],true],['in',['get','badge'],['literal',SPENT_BADGES]]]];
  // Every city place is drawn at full strength at every zoom: a station with
  // nothing to give is grey, never faded, and no mark is a merged cluster.
  const color=['case',spent,p.other,['match',['get','category'],'bikes',p.bike,'culture',p.event,'heritage',p.other,'air',p.other,p.place]];
  const radius=['*',scale,['case',far,BIKE_FAR_RADIUS_PX,isBike,BIKE_DISC_RADIUS_PX,['>',['get','eventCount'],0],['min',18,['+',11,['sqrt',['get','eventCount']]]],8]];
  return [
    {id:'city-path-lines',type:'line',source:CITY_PATHS,paint:{'line-color':p.bike,'line-width':2*scale,'line-dasharray':[2,2]}},
    {id:'city-place-dots',type:'circle',source:CITY_POINTS,paint:{
      'circle-radius':radius,'circle-color':color,'circle-stroke-color':p.halo,'circle-stroke-width':['case',isBike,1,2]}},
    // A count is never dropped by a collision (text-allow-overlap takes no
    // per-feature value, so it holds for every badge): each disc keeps its number.
    {id:'city-place-badges',type:'symbol',source:CITY_POINTS,layout:{
      'text-field':['case',far,'',['get','badge']],'text-font':[MAP_FONTS.medium],'text-size':['*',scale,['case',isBike,BIKE_COUNT_PX,12]],'text-allow-overlap':true,
      'symbol-sort-key':['get','priority']},paint:{'text-color':['case',spent,p.otherText,isBike,p.bikeText,p.halo],'text-halo-width':0}},
    // The framed wall names its curated venues at every zoom its Kadar can
    // frame (Trg at Kadar 8 on 1920 is about 12.86): a venue without its
    // name is a programme count nobody can place. Everywhere else the names
    // come in from 13, where the phone's places stop being a crowd.
    {id:'city-place-labels',type:'symbol',source:CITY_POINTS,...(mode==='venues'?{}:{minzoom:13}),
      ...(mode==='venues'?{filter:['!',['in',['get','category'],['literal',['bikes','air']]]]}:{}),layout:{
      visibility:mode==='none'?'none':'visible',
      'text-field':['get','title'],'text-font':[MAP_FONTS.medium],'text-size':12*scale,
      // The framed wall's venue names move before they yield to a passing
      // pill (overlays.ts decision 17); every other surface keeps the one place.
      ...(mode==='venues'?{'text-variable-anchor-offset':nameAnchorOffsets(1.5),'text-justify':'auto'}:{'text-anchor':'top','text-offset':[0,1.5]}),
      'text-max-width':12,'text-optional':true,'symbol-sort-key':['get','priority']},
      paint:{'text-color':p.label,'text-halo-color':p.halo,'text-halo-width':2}},
    {id:'city-place-selection',type:'circle',source:CITY_POINTS,filter:['==',['get','id'],selected??''],
      paint:{'circle-radius':20*scale,'circle-opacity':0,'circle-stroke-color':p.selection,'circle-stroke-width':3}},
  ];
}
