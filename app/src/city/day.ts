import type { LayerContext } from '../layers/types';
import { ct, bikeCount } from './strings';
import { dynamicPlaces } from './discovery';
import { distanceM,located } from '../../../shared/city/geo';
import { resolveVenues } from '../../../shared/city/events';
import { escapeHtml as e,escapeAttribute as a } from '../ui/dom/escape';
import { zagrebTime } from '../format';
import { defaultLocation } from './location';
import { airIndexLabel } from './air';
/** Compact contextual opportunities, not static-inventory dashboard tiles. */
export function dayOpportunities(ctx:LayerContext):string {
  const city=ctx.city;if(!city)return '';
  const ref=ctx.location??defaultLocation(ctx.screen);
  const bikes=dynamicPlaces(city,ctx.now).filter(p=>p.sourceId==='bajs'&&p.facts?.fresh&&p.facts.operational&&Number(p.facts.bikes)>0&&located(p))
    .sort((x,y)=>distanceM(ref,{lon:x.lon!,lat:x.lat!})-distanceM(ref,{lon:y.lon!,lat:y.lat!}))[0];
  const link=(id:string,text:string,sub:string)=>`<a class="day-opportunity" href="#layer=u-pokretu&kind=place&id=${a(id)}" data-action="nav" data-layer="u-pokretu" data-selection="${a(JSON.stringify({kind:'place',id}))}"><strong>${e(text)}</strong><span>${e(sub)} ↗</span></a>`;
  const air=city.live?.sources.find(source=>source.id==='air')?.status==='live'?city.live.air.filter(s=>s.index!==null&&s.observedAt&&ctx.now>=Date.parse(s.observedAt)&&ctx.now-Date.parse(s.observedAt)<21600000)
    .sort((x,y)=>distanceM(ref,x)-distanceM(ref,y))[0]:undefined;
  return `<div class="day-opportunities">${bikes?link(bikes.id,`BAJS · ${bikeCount(ctx.i18n,bikes.facts!.bikes)}`,bikes.name):''}
    ${air?link(`air-${air.id}`,`${ct(ctx.i18n,'air')} · ${airIndexLabel(ctx.i18n,air.index)}`,`${air.name} · ${zagrebTime(air.observedAt!)}`):''}</div>`;
}
export function eventVenueLinks(ctx:LayerContext,item:import('../../../worker/feed/schema').FeedItem):string {
  if(!ctx.city)return '';
  return resolveVenues(item,ctx.city.places).map(id=>{const p=ctx.city!.places.find(p=>p.id===id)!;
    return `<a class="btn-quiet" href="#layer=u-pokretu&kind=place&id=${a(id)}" data-action="nav" data-layer="u-pokretu" data-selection="${a(JSON.stringify({kind:'place',id}))}">${e(p.name)} · ${ct(ctx.i18n,'onMap')} ↗</a>`;
  }).join('');
}
