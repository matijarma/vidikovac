import type { Place, PlaceCategory, CityState, StreetStory } from '../../../shared/city/types';
import { activeVenues, locatedEvents, type ActivityWindow, type LocatedEvent } from '../../../shared/city/events';
import { distanceM, located, normalName } from '../../../shared/city/geo';
import type { FeedItem } from '../../../worker/feed/schema';
import type { MapPoint } from '../map/city-map';
import {bikeAvailability} from '../../../shared/city/bikes';
import { groupWifi } from './search';
const CATEGORY_TERMS: Record<string, string> = {
  water:'voda cesma pitka drinking water',toilet:'wc zahod javni toalet toilet',
  wifi:'wifi wi fi internet',sport:'sport igraliste courts',dogs:'psi pse dog',
  recycling:'recikliranje otpad recycling',market:'trznica market',
  garage:'garaza parking',charging:'punionica charging','cycle-parking':'bicikl stalak bicycle',
  culture:'kultura culture muzej museum',heritage:'bastina heritage',rail:'vlak train',
};
export type CityGroup = 'living' | 'transport' | 'culture' | 'useful' | 'heritage';
export interface DiscoveryOptions { group: CityGroup; category: string; window: ActivityWindow; query: string; center: {lon:number;lat:number}; radius: number; now:number;bikeMode?:'rent'|'return' }
export interface Discovery {
  places: Place[]; events: LocatedEvent[]; count: number;
  points: MapPoint[]; streets: StreetStory[];
}
export function dynamicPlaces(state: CityState, now: number): Place[] {
  const source = state.live?.sources.find(s=>s.id==='bajs');
  const bikes: Place[] = (state.live?.bikes ?? []).map(b => {
    const fresh = source?.status === 'live' && b.observedAt && now - Date.parse(b.observedAt) <= 180_000 && now >= Date.parse(b.observedAt) - 30_000;
    return { id: `bajs-${b.id}`, category:'cycle-parking',name:b.name,lon:b.lon,lat:b.lat,sourceId:'bajs',sourceRecord:b.id,
      subtype:'BAJS',website:b.rentalUrl,updatedAt:b.observedAt,
      facts:{bikes:fresh && b.bikes!==null?b.bikes:'?',docks:fresh && b.docks!==null?b.docks:'?',operational:b.installed&&b.renting,returning:b.installed&&b.returning,fresh:Boolean(fresh)} };
  });
  const airSource=state.live?.sources.find(s=>s.id==='air');
  const air: Place[] = (state.live?.air ?? []).map(a=>{
    const fresh=airSource?.status==='live'&&a.observedAt&&now-Date.parse(a.observedAt)<=21_600_000&&now>=Date.parse(a.observedAt);
    return {id:`air-${a.id}`,category:'water',name:a.name,lon:a.lon,lat:a.lat,
      sourceId:'air',sourceRecord:a.id,subtype:'air',updatedAt:a.observedAt,facts:{index:fresh?a.index??'?':'?',preliminary:true,fresh:Boolean(fresh)}};});
  return [...bikes,...air];
}
export function discover(state: CityState, items: readonly FeedItem[], o: DiscoveryOptions): Discovery {
  const events = locatedEvents(items,state.places,o.now,o.window);
  const venues = new Map(activeVenues(events,state.places).map(v=>[v.place.id,v]));
  const query=normalName(o.query), dynamic=dynamicPlaces(state,o.now);
  const all=groupWifi([...state.places,...dynamic]);
  let places=all.filter(p=>{
    if(query) {
      const text=normalName(`${p.name} ${p.address??''} ${p.subtype??''} ${CATEGORY_TERMS[p.category]??''}`);
      return query.split(' ').every(word=>text.includes(word));
    }
    if(!located(p)||distanceM(o.center,p)>o.radius) return false;
    if(o.category) {
      if(o.category==='bikes')return p.sourceId==='bajs';
      if(o.category==='air')return p.sourceId==='air';
      return p.category===o.category&&p.sourceId!=='bajs'&&p.sourceId!=='air';
    }
    if(o.group==='culture')return p.category==='culture' && (o.category==='culture'||venues.has(p.id));
    if(o.group==='heritage')return p.category==='heritage';
    if(o.group==='useful')return !['culture','heritage','rail'].includes(p.category)&&p.sourceId!=='bajs'&&p.sourceId!=='air';
    if(o.group==='transport')return ['bajs','hz-schedule'].includes(p.sourceId);
    // Active venues first, nearby bike possibilities and one local heritage
    // fallback provide a living city even without alerts or delays.
    return venues.has(p.id)||p.sourceId==='bajs'||p.category==='heritage';
  });
  places.sort((a,b)=>{
    if(o.category==='bikes'){
      const useful=(p:Place)=>p.facts?.fresh&&(o.bikeMode==='return'?p.facts?.returning&&Number(p.facts?.docks)>0:p.facts?.operational&&Number(p.facts?.bikes)>0);
      const available=Number(Boolean(useful(b)))-Number(Boolean(useful(a)));if(available)return available;
    }
    if(o.group==='living'&&!query){const activity=Number(venues.has(b.id))-Number(venues.has(a.id));if(activity)return activity;}
    return (located(a)?distanceM(o.center,a):Infinity)-(located(b)?distanceM(o.center,b):Infinity)||a.name.localeCompare(b.name,'hr');
  });
  if(o.group==='living'&&!query){
    let heritage=0,bikes=0;
    places=places.filter(p=>p.category==='heritage'?++heritage<=2:p.sourceId==='bajs'?++bikes<=3:true);
  }
  const points:MapPoint[]=places.filter(located).map(p=>{
    const activity=venues.get(p.id);
    const type=p.sourceId==='bajs'?'bikes':p.sourceId==='air'?'air':p.category;
    return {id:p.id,title:p.name,lon:p.lon,lat:p.lat,place:'city',
      props:{category:type,eventCount:activity?.count??0,badge:activity?String(activity.count):type==='bikes'?bikeAvailability(p,o.bikeMode):'',
        priority:activity?0:type==='bikes'?2:3}};
  });
  const streets=query?state.streets.filter(s=>normalName(s.name).includes(query)||normalName(s.description).includes(query)):
    o.category==='streets'?[...state.streets].sort((a,b)=>a.name.localeCompare(b.name,'hr')):[];
  return {places,events,count:places.length,points,streets};
}
/** Group nearby markers at the current zoom. Cluster count always means
 * places, never events; a single-venue pin keeps its program count. */
export function clusterPlaces(points:readonly MapPoint[],zoom:number):MapPoint[]{
  const cells=new Map<string,MapPoint[]>(),scale=256*2**Math.min(zoom,20),cell=48;
  for(const p of points){
    const sin=Math.sin(p.lat*Math.PI/180),x=(p.lon+180)/360*scale,y=(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*scale;
    const key=`${Math.floor(x/cell)}:${Math.floor(y/cell)}`;
    cells.set(key,[...(cells.get(key)??[]),p]);
  }
  return [...cells.entries()].map(([key,rows])=>rows.length===1?rows[0]:({
    id:`cluster-${key.replace(':','-')}`,title:`${rows.length}`,lon:rows.reduce((n,p)=>n+p.lon,0)/rows.length,lat:rows.reduce((n,p)=>n+p.lat,0)/rows.length,
    place:'city' as const,props:{category:'cluster',badge:`+${rows.length}`,eventCount:0,priority:0,cluster:true,count:rows.length},
  }));
}
export const CATEGORY_SOURCE:Record<string,readonly string[]>={
  culture:['culture'],water:['water','drinking-water'],toilet:['toilets'],sport:['sport'],dogs:['dogs'],
  recycling:['recycling'],market:['markets'],wifi:['wifi'],'cycle-parking':['cycle-parking'],garage:['garages'],charging:['charging'],
  heritage:['heritage'],streets:['streets','settlements'],rail:['hz-schedule'],bikes:[],air:[],
  'cycle-paths':['cycle-paths'],
};
export const GROUP_SOURCES:Record<CityGroup,readonly string[]>={
  living:['culture','heritage'],transport:['hz-schedule'],culture:['culture'],useful:['water','toilets','sport','dogs','recycling','markets'],heritage:['heritage','streets','settlements'],
};
export function sourceForPlaceId(id:string):string|undefined{
  if(id.startsWith('rail-'))return 'hz-schedule';
  return [...new Set(Object.values(CATEGORY_SOURCE).flat())].sort((a,b)=>b.length-a.length).find(source=>id.startsWith(source+'-'));
}
