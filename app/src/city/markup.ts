import type { CityState, Place, StreetStory, DepartureBoard } from '../../../shared/city/types';
import { located, distanceM } from '../../../shared/city/geo';
import { airIndexLabel } from './air';
import type { LocatedEvent } from '../../../shared/city/events';
import type { I18n } from '../i18n/i18n';
import { escapeHtml as e, escapeHtml as escapePhone, escapeAttribute as a } from '../ui/dom/escape';
import { zagrebTime, zagrebWeekdayDate } from '../format';
import { ct } from './strings';
import { publicItemKey } from '../core/contracts';
import {bikeAvailability} from '../../../shared/city/bikes';
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';
import { externalHtml } from '../kiosk/external';
import { intlLocale } from '../experience/text';
/** What a distance is measured from: the phone's place (city/place.ts PlaceContext) or a map reference (city/location.ts). */
export interface DistanceReference { lon: number; lat: number; name: string }
const button=(action:string,id:string,label:string)=>`<button type="button" class="city-row" data-action="${action}" data-id="${a(id)}"><span>${e(label)}</span><span aria-hidden="true">↗</span></button>`;
/** The register facts a place detail may print, each labelled by city.fact-<key>; any other fact stays unprinted. */
const SAFE_FACTS = [
  'payment','maintenance','type','sport','sockets','connector','capacity','designated-accessible-spaces','charging-points','racks',
  'paper','plastic','glass','metal','batteries','biowaste','tyres','electronics','period','classification','registry',
] as const;
type SafeFact = typeof SAFE_FACTS[number];
/** The facts whose label is a caveat on the phone ("Kapacitet, ne slobodna mjesta", "Stanje prema registru",
 *  "Punjači prema registru"): without it the figure would read as live availability, and the wall prints no
 *  caveat (companion brief §12, §13 #12), so a public display leaves these facts out. */
const WALL_OMITTED_FACTS: ReadonlySet<SafeFact> = new Set(['capacity', 'maintenance', 'charging-points']);
const isSafeFact=(key:string):key is SafeFact=>(SAFE_FACTS as readonly string[]).includes(key);
/** "Original text in Croatian": said only in English, above a register's Croatian description. */
function sourceLanguageNote(i18n:I18n):string {
  if (!i18n.getLocale().startsWith('en')) return '';
  return `<p class="city-meta">${ct(i18n,'sourceLanguage')}</p>`;
}
/** HTTP Last-Modified and ISO source timestamps share a readable date label. */
export function referenceDate(value:string):string{
  const time=Date.parse(value);
  return Number.isFinite(time)?new Date(time).toISOString().slice(0,10):'';
}
export function placeCategory(i18n:I18n,p:Place):string {
  return p.sourceId==='bajs'?'BAJS':p.sourceId==='air'?ct(i18n,'air'):ct(i18n,p.category);
}
export function placesMarkup(i18n:I18n,places:readonly Place[],events:readonly LocatedEvent[],limit=20,bikeMode:'rent'|'return'='rent',reference?:DistanceReference):string {
  return `<div class="city-results" data-testid="city-results">${places.slice(0,limit).map(p=>{
    const at=events.filter(x=>x.venueIds.includes(p.id));
    return `<button type="button" class="city-row" data-action="select-place" data-id="${a(p.id)}" id="city-result-${a(p.id)}">
      <span class="city-row-main"><span class="city-kicker">${e(placeCategory(i18n,p))}</span><strong>${externalHtml('name',p.name)}</strong>
      <span class="city-meta">${p.address?externalHtml('address',p.address):''}${reference&&located(p)?` · ${Math.round(distanceM(reference,p))} m`:''}${at.length?` · ${at.length} ${ct(i18n,'events')}`:''}${!located(p)?` · ${ct(i18n,'noLocation')}`:''}</span></span>
      <span class="city-row-value">${at.length?e(String(at.length)):p.sourceId==='bajs'?`<span class="city-bike-count">${e(bikeAvailability(p,bikeMode))}</span><span class="city-meta">${ct(i18n,bikeMode==='return'?'returns':'available')}</span>`:'↗'}</span></button>`;
  }).join('')}${places.length>limit?button('city-more','',`${ct(i18n,'more')} (${places.length-limit})`):''}</div>`;
}
export function eventLinks(i18n:I18n,events:readonly LocatedEvent[],interactive=true):string {
  if (!interactive) events = events.filter(x => vetExternal('title', x.item.title, 'row') !== null);
  const tag=interactive?'button':'div';
  const publishers:Record<string,string>={kulturpunkt:'Kulturpunkt · CC BY-SA 3.0 HR',etnografski:'Etnografski muzej',kvartovske:'Grad Zagreb · Otvorena dozvola'};
  return events.map(x=>`<${tag} class="city-event"${interactive?` type="button" data-action="nav" data-layer="kultura" data-selection="${a(JSON.stringify({kind:'item',module:'dogadanja',id:publicItemKey('dogadanja',x.item.id)}))}"`:''}><time>${e(x.ongoing?ct(i18n,'ongoing'):x.item.data?.precision==='time'?`${zagrebWeekdayDate(x.item.at!)} · ${zagrebTime(x.item.at!)}`:zagrebWeekdayDate(x.item.at!))}</time><strong>${e(x.item.title)}</strong><span class="city-meta">${e(publishers[String(x.item.data?.source)]??ct(i18n,'source'))}${interactive?' ↗':''}${x.location==='multiple'?` · ${ct(i18n,'multiVenue')}`:''}</span></${tag}>`).join('');
}
export function placeDetail(i18n:I18n,p:Place,state:CityState,events:readonly LocatedEvent[],saved=false,publicDisplay=false,reference?:DistanceReference):string {
  if (publicDisplay && vetExternal('name', p.name, 'row') === null) return '';
  // The public component's default text escape checks every optional field,
  // including facts/provenance. The phone keeps its own escape for its fixed
  // copy and vets every third-party field under its kind below (WP4 review):
  // the same row rule on both surfaces, never unchecked text on either.
  const e = publicDisplay ? (value: unknown) => typeof value === 'string' ? externalHtml('summary', value) : escapePhone(value) : escapePhone;
  // The name and the address under their own kinds, never as prose: a house-number range ("Petrinjska 50-52") is data there.
  const nameHtml = externalHtml('name', p.name);
  const addressHtml = !p.address ? '' : externalHtml('address', p.address);
  const source=state.manifest?.sources.find(s=>s.id===p.sourceId)??state.live?.sources.find(s=>s.id===p.sourceId);
  const program=events.filter(x=>x.venueIds.includes(p.id));
  const facts=Object.entries(p.facts??{}).filter(([key])=>isSafeFact(key)&&!(publicDisplay&&WALL_OMITTED_FACTS.has(key))).map(([key,value])=>`<div><dt>${e(ct(i18n,`fact-${key as SafeFact}`))}</dt><dd>${externalHtml('summary',value)}</dd></div>`).join('');
  // The wall (publicDisplay) prints no observation time, note or caveat (companion brief §12, §13 #12,
  // #13): a count that is not fresh says the stale word, the air index stands alone. The phone keeps them.
  const bikeMeta=publicDisplay?(p.facts?.fresh?'':`<p class="city-meta">${e(ct(i18n,'stale'))}</p>`):`<p class="city-meta">${e(ct(i18n,p.facts?.fresh?'observed':'freshUnknown'))}${p.updatedAt?` · ${zagrebTime(p.updatedAt)}`:''}</p>`;
  // An unknown count is a dash on the wall (our own mark, as city.bikeCountUnknown says it), never "?"
  // (§13 #14) and never an empty cell; the phone keeps its "?".
  const count=(mode:'rent'|'return'):string=>{const value=bikeAvailability(p,mode);return publicDisplay&&value==='?'?'–':e(value);};
  const bike=p.sourceId==='bajs'?`<div class="city-bike-values"><div><strong class="city-bike-count">${count('rent')}</strong><span>${e(ct(i18n,'available'))}</span></div><div><strong class="city-bike-count">${count('return')}</strong><span>${e(ct(i18n,'returns'))}</span></div></div>${bikeMeta}`:'';
  const air=p.sourceId==='air'?`<p>${e(ct(i18n,'air'))}: ${e(airIndexLabel(i18n,p.facts?.index))}</p>${publicDisplay?'':`<p class="city-meta">${e(ct(i18n,'airNote'))} ${p.updatedAt?`${ct(i18n,'observed')} ${zagrebTime(p.updatedAt)}`:''}</p><div data-city-air="${a(p.sourceRecord)}"></div>`}`:'';
  return `<article class="city-detail" data-testid="city-detail" data-place-id="${a(p.id)}">
    ${publicDisplay?'':`<button type="button" class="btn-quiet" data-action="clear-selection">${e(ct(i18n,'back'))}</button>`}
    <p class="city-kicker">${e(placeCategory(i18n,p))}</p><h3 tabindex="-1" id="city-detail-title">${nameHtml}</h3>
    ${addressHtml?`<p>${addressHtml}</p>`:''}${!located(p)?`<p class="city-meta">${e(ct(i18n,'noLocation'))}</p>`:''}
    ${reference&&located(p)?`<p class="city-meta">${e(Math.round(distanceM(reference,p)).toLocaleString(intlLocale(i18n)))} m${reference.name.trim()?` · ${e(reference.name.trim())}`:''}</p>`:''}
    ${bike}${air}${facts?`<dl class="city-facts">${facts}</dl>`:''}
    ${p.hours?`<p class="city-meta">${externalHtml('summary',p.hours)}</p>`:''}
    ${p.description?`<div class="city-description" lang="hr">${sourceLanguageNote(i18n)}<p>${externalHtml('summary',p.description)}</p></div>`:''}
    ${p.category==='heritage'&&!publicDisplay?`<p class="city-meta">${ct(i18n,'siteNote')}</p>`:''}
    ${p.category==='culture'?`<section><h4>${ct(i18n,'program')}</h4>${program.length?eventLinks(i18n,program,!publicDisplay):`<p class="city-meta">${ct(i18n,'noProgram')}</p>`}</section>`:''}
    ${p.category==='rail'?`<div data-city-departures="hz" data-stop="${a(p.sourceRecord)}"></div>`:''}
    ${publicDisplay?'':`<div class="city-actions">${p.website?`<a class="btn-ghost" href="${a(p.website)}" target="_blank" rel="noopener noreferrer">${e(p.sourceId==='bajs'?ct(i18n,'rent'):ct(i18n,'original'))} ↗</a>`:''}
    ${located(p)?`<button type="button" class="btn-quiet" data-action="fit-selection">${ct(i18n,'onMap')}</button>`:''}
    ${source?.url?`<a class="btn-quiet" href="${a(source.url)}" target="_blank" rel="noopener noreferrer">${ct(i18n,'source')} ↗</a>`:''}
    <button type="button" class="btn-quiet" data-action="city-save" data-id="${a(p.id)}">${ct(i18n,saved?'saved':'save')}</button>
    <button type="button" class="btn-quiet" data-action="city-copy" data-id="${a(p.id)}">${ct(i18n,'copy')}</button></div>`}
    <p class="city-meta">${externalHtml('summary',source?.name??p.sourceId)}${source?.status==='stale'?` · ${ct(i18n,'stale')}`:''}${source?.licence?` · ${externalHtml('summary',source.licence)}`:''}</p>
    ${!publicDisplay&&p.sourceId!=='bajs'&&p.sourceId!=='air'?`<p class="city-meta">${ct(i18n,'reference')}${p.updatedAt&&referenceDate(p.updatedAt)?` · ${e(referenceDate(p.updatedAt))}`:''}</p>`:''}
  </article>`;
}
export function streetDetail(i18n:I18n,s:StreetStory,publicDisplay=false):string {
  if (publicDisplay && (vetExternal('name', s.name, 'row') === null || vetExternal('register-text', s.description, 'row') === null)) return '';
  const e = publicDisplay ? (value: unknown) => typeof value === 'string' ? externalHtml('summary', value) : escapePhone(value) : escapePhone;
  // The register's own fields under their kinds on both surfaces (WP4 review): never unchecked text on the phone either.
  const nameHtml = externalHtml('name', s.name);
  const settlementHtml = externalHtml('name', s.settlement);
  // The wall has no control and no register date (companion brief §12, [O-43]); the phone keeps both.
  const credit = publicDisplay ? 'Grad Zagreb · Registar naziva ulica · Otvorena dozvola' : `Grad Zagreb · Registar naziva ulica · ${e(s.updatedAt??'')} · Otvorena dozvola`;
  return `<article class="city-detail" data-testid="street-story">${publicDisplay?'':`<button class="btn-quiet" data-action="clear-selection">${ct(i18n,'back')}</button>`}<p class="city-kicker">${ct(i18n,'whyStreet')}</p><h3 tabindex="-1">${nameHtml}</h3><p class="city-meta">${settlementHtml}</p><p lang="hr">${externalHtml('register-text', s.description)}</p><p class="city-meta">${credit}</p></article>`;
}
/** A minute of grace: a train due at 10:00 is still the one you are running
 *  for at 10:00:45. Anything older has left. */
const DEPARTED_GRACE_MS=60_000;
/** The clock-time board, now HŽ's alone: ZET's stops answer through the
 *  arrivals list (shared/city/arrivals.ts), which merges the live fleet in.
 *  The endpoint also returns the departures of the last quarter hour (the
 *  arrivals list needs them to place a late vehicle); a board printed as it
 *  arrives would open on trains that have already gone, so they are dropped
 *  here rather than at the source. */
export function departuresMarkup(i18n:I18n,board:DepartureBoard,nowMs:number=Date.now()):string {
  const due=board.departures.filter(d=>{const at=Date.parse(d.at);return !Number.isFinite(at)||at>=nowMs-DEPARTED_GRACE_MS;});
  return `<section class="city-departures"><h4>${ct(i18n,'departures')}</h4><p class="city-meta">${e(i18n.t('arrivals.timetable'))} · ${board.operator==='hz'?'HŽPP':'ZET'}${board.status==='stale'?` · ${ct(i18n,'stale')}`:''}</p>
    ${board.status==='down'?`<p>${ct(i18n,'noDepartures')}</p>`:due.length?due.slice(0,6).map(d=>`<div class="city-departure"><strong>${e(zagrebTime(d.at))}</strong><span>${e(d.headsign||d.routeName)}</span></div>`).join(''):`<p>${ct(i18n,'noDepartures')}</p>`}
    <p class="city-meta">${ct(i18n,'scheduleNote')}</p></section>`;
}
