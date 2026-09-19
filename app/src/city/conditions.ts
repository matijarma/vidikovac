import type { LayerContext } from '../layers/types';
import { ct } from './strings';
import { escapeHtml as e,escapeAttribute as a } from '../ui/dom/escape';
import { zagrebTime } from '../format';
import { distanceM } from '../../../shared/city/geo';
export function conditionsMarkup(ctx:LayerContext):string {
  const live=ctx.city?.live;if(!live)return '';
  const ref=ctx.screen?.stop??{lon:15.97726,lat:45.81286};
  const air=live.air.slice().sort((x,y)=>distanceM(ref,x)-distanceM(ref,y));
  const airSource=live.sources.find(s=>s.id==='air');
  const riverSource=live.sources.find(s=>s.id==='river');
  const en=ctx.i18n.getLocale().startsWith('en');
  const labels=en?['Good','Fair','Moderate','Poor','Very poor','Extremely poor']:['Dobra','Prihvatljiva','Umjerena','Loša','Vrlo loša','Izrazito loša'];
  const rows=air.slice(0,6).map(s=>{
    const fresh=airSource?.status==='live'&&s.observedAt&&ctx.now>=Date.parse(s.observedAt)&&ctx.now-Date.parse(s.observedAt)<=21600000;
    return `<a class="city-row" href="#layer=u-pokretu&kind=place&id=air-${a(s.id)}" data-action="nav" data-layer="u-pokretu" data-selection="${a(JSON.stringify({kind:'place',id:`air-${s.id}`}))}"><span><strong>${e(s.name)}</strong><span class="city-meta">${e(s.observedAt?`${ct(ctx.i18n,'observed')} ${zagrebTime(s.observedAt)}`:ct(ctx.i18n,'unknown'))}</span></span><span>${e(fresh&&s.index!==null?labels[s.index-1]??ct(ctx.i18n,'unknown'):ct(ctx.i18n,'freshUnknown'))}</span></a>`;
  }).join('');
  return `<section class="city-condition wx-sec"><h3>${ct(ctx.i18n,'air')}</h3>${rows||`<p>${ct(ctx.i18n,'unavailable')}</p>`}<p class="city-meta">${e(en?'Station observations are preliminary, not a citywide assessment. PM indices use rolling averages.':'Opažanja postaja su preliminarna, ne ocjena za cijeli grad. Indeksi čestica koriste pomične prosjeke.')}</p></section>
    <section class="city-condition wx-sec"><h3>${ct(ctx.i18n,'river')}</h3>${live.river?`<p lang="hr">${e(live.river.text)}</p><p class="city-meta">DHMZ · ${e(live.river.period)} · ${e(live.river.publishedAt)}${riverSource?.status!=='live'?` · ${ct(ctx.i18n,'stale')}`:''}</p>`:`<p>${ct(ctx.i18n,'unavailable')}</p>`}</section>`;
}
export function consultationsMarkup(ctx:LayerContext):string {
  const live=ctx.city?.live;if(!live)return '';
  const source=live.sources.find(s=>s.id==='consultations');
  return `<section class="city-condition cv-sec"><h3>${ct(ctx.i18n,'consultation')}</h3><p class="city-meta">${ctx.i18n.getLocale().startsWith('en')?'National sources, not Zagreb City consultations.':'Nacionalni izvori, ne savjetovanja Grada Zagreba.'}</p>
    ${live.consultations.slice(0,6).map(c=>`<a class="city-event" href="${a(c.url)}" target="_blank" rel="noopener noreferrer"><strong>${e(c.title)}</strong><span>${e(c.institution)} · ${e(c.end)}</span></a>`).join('')||`<p>${ct(ctx.i18n,source?.status==='live'?'noConsultations':'unavailable')}</p>`}
    <p class="city-meta">eSavjetovanja${source?.fetchedAt?` · ${ct(ctx.i18n,'fetched')} ${e(source.fetchedAt.slice(0,10))}`:''}${source?.status==='stale'?` · ${ct(ctx.i18n,'stale')}`:''} · Otvorena dozvola</p></section>`;
}
