import type { OverlayPalette, StyleLayerLike } from './basemap';
import { MAP_FONTS } from './basemap';
export const CITY_POINTS = 'city-places';
export const CITY_PATHS = 'city-paths';
export const CITY_LAYERS = ['city-place-dots','city-place-badges','city-place-labels','city-place-selection','city-path-lines'] as const;
export function cityLayers(p:OverlayPalette, selected:string|null,scale=1):StyleLayerLike[] {
  const color=['match',['get','category'],'culture',p.event,'heritage',p.other,'cluster',p.other,'bikes',p.routeTram,'air',p.other,p.place];
  return [
    {id:'city-path-lines',type:'line',source:CITY_PATHS,paint:{'line-color':p.routeTram,'line-width':2*scale,'line-dasharray':[2,2]}},
    {id:'city-place-dots',type:'circle',source:CITY_POINTS,paint:{
      'circle-radius':['*',scale,['case',['==',['get','category'],'cluster'],18,['>', ['get','eventCount'],0],['min',18,['+',11,['sqrt',['get','eventCount']]]],8]],
      'circle-color':color,'circle-stroke-color':p.halo,'circle-stroke-width':2}},
    {id:'city-place-badges',type:'symbol',source:CITY_POINTS,layout:{
      'text-field':['get','badge'],'text-font':[MAP_FONTS.medium],'text-size':12*scale,'text-allow-overlap':false,
      'symbol-sort-key':['get','priority']},paint:{'text-color':p.halo,'text-halo-width':0}},
    {id:'city-place-labels',type:'symbol',source:CITY_POINTS,minzoom:13,layout:{
      'text-field':['case',['==',['get','category'],'cluster'],'',['get','title']],'text-font':[MAP_FONTS.medium],'text-size':12*scale,'text-anchor':'top','text-offset':[0,1.5],
      'text-max-width':12,'text-optional':true,'symbol-sort-key':['get','priority']},
      paint:{'text-color':p.label,'text-halo-color':p.halo,'text-halo-width':2}},
    {id:'city-place-selection',type:'circle',source:CITY_POINTS,filter:['==',['get','id'],selected??''],
      paint:{'circle-radius':20*scale,'circle-opacity':0,'circle-stroke-color':p.selection,'circle-stroke-width':3}},
  ];
}
