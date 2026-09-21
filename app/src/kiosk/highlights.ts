import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { CityState } from '../../../shared/city/types';
import type { ArrivalRow, ArrivalsStatus } from '../../../shared/city/arrivals';
import { locatedEvents } from '../../../shared/city/events';
import { distanceM, located } from '../../../shared/city/geo';
import type { ScreenStop } from '../core/contracts';
import type { MapHighlight } from '../map/city-map';
import type { I18n } from '../i18n/i18n';
import { dynamicPlaces } from '../city/discovery';
import { ct, bikeCount } from '../city/strings';
import { zagrebDateTime, zagrebTime, zagrebWeekdayDate } from '../format';

export const HIGHLIGHT_HOLD_MS = 20_000;
export interface HighlightBounds {west:number;south:number;east:number;north:number}
/** The fixed camera's visible rectangle, with a safe margin for the ring. */
export function highlightBounds(center:readonly [number,number],zoom:number,width:number,height:number):HighlightBounds {
  const world=512*2**zoom,lat=center[1]*Math.PI/180;
  const y=(1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*world;
  const halfW=Math.max(0,width/2-24),halfH=Math.max(0,height/2-24);
  const latitude=(pixel:number)=>Math.atan(Math.sinh(Math.PI*(1-2*pixel/world)))*180/Math.PI;
  return {west:center[0]-halfW/world*360,east:center[0]+halfW/world*360,north:latitude(y-halfH),south:latitude(y+halfH)};
}
export function inHighlightBounds(map:MapHighlight,bounds?:HighlightBounds):boolean {
  if(!bounds)return true;
  const geometry=map.geometry;
  const points=geometry.type==='Point'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates.flat(2):geometry.coordinates;
  if(!points.length)return false;
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  return Math.min(...xs)<=bounds.east&&Math.max(...xs)>=bounds.west&&Math.min(...ys)<=bounds.north&&Math.max(...ys)>=bounds.south;
}
export interface KioskHighlight {
  id: string;
  subject: 'mobility' | 'city-life';
  kicker: string;
  what: string;
  where: string;
  when: string;
  source: string;
  freshness: string;
  map: MapHighlight;
}

/** Passive facts only: no selections, commands or camera instructions. */
export function kioskHighlights(input: {
  modules: readonly ModuleSnapshot[]; city: CityState; stop: ScreenStop | null;
  arrivals?: readonly ArrivalRow[]; arrivalStatus?:ArrivalsStatus; arrivalUpdatedAt?:string; now: number; i18n: I18n;
  bounds?:HighlightBounds;
}): KioskHighlight[] {
  const { modules, city, stop, now, i18n } = input;
  const en = i18n.getLocale().startsWith('en');
  const ref = stop ?? {lon:15.97726,lat:45.81286};
  const out: KioskHighlight[] = [];
  const point = (id: string, lon: number, lat: number): MapHighlight => ({id, geometry:{type:'Point',coordinates:[lon,lat]}});
  const visiblePoint=(p:{id:string;lon?:number;lat?:number})=>Number.isFinite(p.lon)&&Number.isFinite(p.lat)&&inHighlightBounds(point(p.id,p.lon!,p.lat!),input.bounds);
  const stamp = (snapshot?: ModuleSnapshot) => [
    snapshot?.status !== 'live' ? ct(i18n,'stale') : '',
    snapshot?.fetchedAt ? `${ct(i18n,'fetched')} ${zagrebTime(snapshot.fetchedAt)}` : ct(i18n,'freshUnknown'),
  ].filter(Boolean).join(' · ');
  if (stop) for (const arrival of (input.arrivals ?? []).slice(0,2)) {
    out.push({
      id:`arrival:${arrival.tripId}`,subject:'mobility',kicker:ct(i18n,'departures'),
      what:`${arrival.routeName || arrival.routeId} · ${arrival.headsign}`,where:stop.name,
      when:arrival.live && arrival.minutes!==null ? `${en?'Estimated':'Procjena'}: ${arrival.minutes} min` : `${en?(arrival.live?'Estimated':'Scheduled'):(arrival.live?'Procjena':'Po rasporedu')} ${zagrebTime(arrival.atMs)}`,
      source:'ZET',freshness:[input.arrivalStatus==='stale'?ct(i18n,'stale'):'',input.arrivalUpdatedAt?`${en?'Timetable updated':'Vozni red od'} ${zagrebTime(input.arrivalUpdatedAt)}`:ct(i18n,'reference')].filter(Boolean).join(' · '),
      map:point(stop.id,stop.lon,stop.lat),
    });
  }
  const closures=modules.find(m=>m.module==='prometnice');
  if(closures?.status==='live') for(const item of closures.items.filter(item=>item.kind==='closure'&&item.geo&&(!item.at||Date.parse(item.at)<=now)&&(!item.until||Date.parse(item.until)>=now))){
    const geometry=item.geo!;
    if(geometry.type!=='Point'&&geometry.type!=='LineString')continue;
    if(!inHighlightBounds({id:item.id,geometry:geometry as MapHighlight['geometry']},input.bounds))continue;
    out.push({id:`closure:${item.id}`,subject:'mobility',kicker:en?'Traffic change':'Promjena u prometu',
      what:item.brief??(en?'Road closure':'Zatvorena prometnica'),where:item.title,
      when:item.until?`${en?'Until':'Do'} ${zagrebDateTime(item.until)}`:(en?'Active; end not published':'U tijeku; završetak nije objavljen'),
      source:'Grad Zagreb',freshness:stamp(closures),map:{id:item.id,geometry:geometry as MapHighlight['geometry']}});
  }
  for(const bike of dynamicPlaces(city,now).filter(p=>p.sourceId==='bajs'&&visiblePoint(p)&&p.facts?.fresh&&p.facts.operational&&Number(p.facts.bikes)>0)
    .sort((a,b)=>distanceM(ref,a as {lon:number;lat:number})-distanceM(ref,b as {lon:number;lat:number})).slice(0,3)){
    out.push({id:bike.id,subject:'mobility',kicker:'BAJS',
      what:bikeCount(i18n,bike.facts!.bikes),where:bike.name,
      when:bike.facts?.returning?`${bike.facts.docks} ${ct(i18n,'returns')}`:(en?'Returns unavailable':'Povrat nije dostupan'),
      source:'BAJS',freshness:`${ct(i18n,'observed')} ${zagrebTime(bike.updatedAt!)}`,map:point(bike.id,bike.lon!,bike.lat!)});
  }
  const events=modules.find(m=>m.module==='dogadanja');
  if(events?.status==='live')for(const event of locatedEvents(events.items,city.places,now,'week')){
    const place=city.places.find(p=>event.venueIds.includes(p.id)&&located(p));
    const coord=place&&located(place)?[place.lon,place.lat]:event.item.geo?.type==='Point'?event.item.geo.coordinates as number[]:null;
    if(!coord||!visiblePoint({id:event.item.id,lon:coord[0],lat:coord[1]}))continue;
    const source=String(event.item.data?.source??'');
    const sourceLabel=i18n.t(`events.sources.${source}`);
    const eventDate=event.item.data?.precision==='time'?zagrebDateTime:zagrebWeekdayDate;
    out.push({id:`event:${event.item.id}`,subject:'city-life',kicker:ct(i18n,'culture'),what:event.item.brief??event.item.title,
      where:place?.name??String(event.item.data?.venue??''),when:event.ongoing?`${ct(i18n,'ongoing')}${event.item.until?` · ${en?'until':'do'} ${eventDate(event.item.until)}`:''}`:eventDate(event.item.at!),
      source:sourceLabel.startsWith('events.sources.')?source:sourceLabel,freshness:stamp(events),
      map:point(place?.id??event.item.id,coord[0]!,coord[1]!)});
  }
  // Real records, including their protection boundaries, give a quiet day
  // something to explain. A reference never claims current opening hours.
  for(const place of city.places.filter(p=>['culture','heritage'].includes(p.category)&&visiblePoint(p))
    .sort((a,b)=>distanceM(ref,a as {lon:number;lat:number})-distanceM(ref,b as {lon:number;lat:number})).slice(0,4)){
    const source=city.manifest?.sources.find(s=>s.id===place.sourceId);
    out.push({id:`record:${place.id}`,subject:'city-life',kicker:ct(i18n,'quiet'),what:place.name,
      where:place.address??(en?'Zagreb · city register':'Zagreb · gradski registar'),
      when:place.category==='heritage'?ct(i18n,'siteNote'):ct(i18n,'reference'),
      source:source?.name??place.sourceId,
      freshness:place.updatedAt?`${en?'Record dated':'Zapis od'} ${zagrebDateTime(place.updatedAt)}`:ct(i18n,'reference'),
      map:place.polygons?{id:place.id,geometry:{type:'MultiPolygon',coordinates:place.polygons}}:point(place.id,place.lon!,place.lat!)});
  }
  const count={mobility:0,'city-life':0};
  return out.filter(item=>inHighlightBounds(item.map,input.bounds)&&++count[item.subject]<=8);
}

/** Holds identity through refreshes; pauses never accumulate missed turns. */
export function createHighlightSequence() {
  let current: KioskHighlight | null = null;
  let changedAt = -Infinity;
  let suspended = false;
  const nextIndex = {mobility:0,'city-life':0};
  return {
    read(items: readonly KioskHighlight[], now: number, paused = false): KioskHighlight | null {
      const held=items.find(item=>item.id===current?.id);
      if(paused){suspended=true;current=held??null;return current;}
      if(suspended){suspended=false;changedAt=now;}
      if(held&&now-changedAt<HIGHLIGHT_HOLD_MS){current=held;return held;}
      const other=current?.subject==='mobility'?'city-life':'mobility';
      const candidates=items.filter(item=>item.subject===other);
      const pool=candidates.length?candidates:items;
      if(!pool.length){current=null;return null;}
      const family=pool[0]!.subject;
      current=pool[nextIndex[family]++%pool.length]!;
      changedAt=now;
      return current;
    },
  };
}
