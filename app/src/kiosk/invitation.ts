// The passive public overview: one map, the nearby timeline and the QR.
// Each has its own region and lifetime; a feed refresh never remounts them.
import type { FrameStops } from '../../../shared/city/frame';
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { NearbyRow } from '../city/nearby';
import type { ScreenStop } from '../core/contracts';
import type { I18n } from '../i18n/i18n';
import { escapeHtml as e } from '../ui/dom/escape';
import { mountField } from './field';
import type { Composition } from './layout';
import { codeBlockMarkup, hintMarkup } from './markup';
import type { KioskStrings } from './strings';
import { mountTimeline } from './timeline';
import { MAP_MIN_HEIGHT_PX } from '../map/frame';

/** The ol's design-height fallback only; its measured box wins after layout. Compact: the whole aside
 *  (decision 50: the QR card stands under the map), 513 px minus the list's heading and padding. */
export const NEARBY_DESIGN_HEIGHT: Readonly<Record<Composition, number>> = {
  wide: 480, compact: 450, portrait: 490, handheld: Number.POSITIVE_INFINITY,
};
export interface InvitationDeps {
  strings: KioskStrings; i18n: I18n; locale: string; lightweight: boolean;
  reducedMotion: boolean; codeBase?: string;
  /** The map pane changed size because the QR card moved (cardPlacement): the kiosk re-measures and re-frames the map. */
  onMapBox?: () => void;
}

/** Where the compact landscape wall's QR card stands (lane w-labels, 24 Sep). Decision 50 put it under
 *  the map so the "U blizini" list has the whole aside; on a short window that left the map a strip
 *  (669 x 162 at 1280 x 800). The order is decision 50's with the map's floor in it: the list's promises
 *  (the first and last trams, the timeless row, the lead departure: the rows its fit never drops) first,
 *  then the map's legible minimum (map/frame.ts MAP_MIN_HEIGHT_PX), then the rest of the departures, then
 *  more map. So the card stays under the map while the map is legible there ('map'), moves under the list
 *  when the list keeps its promises in the smaller box ('aside'), and otherwise stays, the map a strip.
 *  All px are the display's; 0 means not measured, and nothing moves. */
export function cardPlacement(m: { mapUnderPx: number; listAsidePx: number; floorPx: number; minMapPx: number }): 'map' | 'aside' {
  if (!(m.mapUnderPx > 0) || m.mapUnderPx >= m.minMapPx) return 'map';
  return m.listAsidePx > 0 && m.listAsidePx >= m.floorPx ? 'aside' : 'map';
}
export interface InvitationModel {
  items: readonly NearbyRow[]; radiusM: number; frame: FrameStops; outage: boolean;
  modules: readonly ModuleSnapshot[]; stop: ScreenStop | null;
  now: number; composition: Composition;
}
export interface InvitationHandle {
  element: HTMLElement; readonly mapHost: HTMLElement | null;
  update(model: InvitationModel): void;
  setFrame(frame: FrameStops): void;
  measureWidth(): number; measureHeight(): number; setMajorLabels(count: number): void;
  /** The legend's entries follow what the map draws (kiosk/mapview.ts legendKinds): the others are hidden. */
  setLegend(kinds: readonly string[]): void;
  fit(): void; destroy(): void;
}
/** Shared with presented content: scanning remains possible in every phase. */
export function cardMarkup(s: KioskStrings, codeBase?: string): string {
  return `<article class="k-invite" data-testid="kiosk-invite">
    <div class="k-invite-side"><h1 class="k-lead">${e(s.invitation.lead)}</h1>${codeBlockMarkup(s)}${hintMarkup(s,codeBase)}</div>
    <div class="k-qr" data-testid="kiosk-qr"><p class="k-qr-waiting">${e(s.invitation.qrWaiting)}</p></div></article>`;
}
export function mountInvitation(host: HTMLElement, deps: InvitationDeps): InvitationHandle {
  const {strings:s,i18n,locale,lightweight}=deps;
  const element=document.createElement('section');
  element.className='k-city-window';
  element.dataset.testid='kiosk-invitation';
  element.innerHTML=`<p class="k-handheld-info">${e(s.handheld.info)}</p><div class="k-geography"></div>
    <aside class="k-overview"><div class="k-nearby-host"></div><div class="k-panel--card">${cardMarkup(s,deps.codeBase)}</div></aside>`;
  host.appendChild(element);
  const geography=element.querySelector<HTMLElement>('.k-geography')!;
  const field=mountField(geography,{lightweight});
  // The legend explains the map, so it stands only where there is one (not under lagano's board).
  if(!lightweight){
    const legend=document.createElement('p');
    legend.className='k-map-legend';
    legend.innerHTML=`<span data-legend="tram"><b class="k-legend-tram">6</b> ${e(s.legend.tram)}</span><span data-legend="bikes"><b class="k-legend-bike">●</b> ${e(s.legend.bikes)}</span><span data-legend="culture"><b class="k-legend-culture">●</b> ${e(s.legend.culture)}</span>`;
    geography.appendChild(legend);
  }
  const note=document.createElement('p');
  note.className='k-map-note';
  note.dataset.testid='map-note';
  note.hidden=true;
  note.textContent=s.nearby.outageNote;
  geography.appendChild(note);
  let model:InvitationModel|null=null;
  const timeline=mountTimeline(element.querySelector<HTMLElement>('.k-nearby-host')!,{
    i18n,
    reduced:deps.reducedMotion||lightweight,
    designHeightPx:()=>NEARBY_DESIGN_HEIGHT[model?.composition??'wide'],
  });
  const setFrame=(frame:FrameStops):void=>field.setFrame(frame);
  const card=element.querySelector<HTMLElement>('.k-panel--card')!;
  /** The map pane's height with the card under it, measured while it stood there, per window box. */
  let mapUnder:{key:string;px:number}|null=null;
  /** A window box and promise set for which the card was tried under the list and the promises did not fit. */
  let refused:string|null=null;
  function promisesPx(rows:HTMLElement):number{
    const lis=[...rows.children] as HTMLElement[];
    const kept=new Set<HTMLElement>(lis.filter(li=>li.dataset.kind==='first'||li.dataset.kind==='last'));
    const always=lis.find(li=>li.dataset.always==='1');if(always)kept.add(always);
    const departure=lis.find(li=>li.dataset.kind==='departure');if(departure)kept.add(departure);
    if(kept.size===0)return 0;
    const gap=Number.parseFloat(getComputedStyle(rows).rowGap)||0;
    return [...kept].reduce((sum,li)=>sum+li.offsetHeight,0)+gap*(kept.size-1);
  }
  /** The window box and the promise rows (not the departures, which come and go by the minute). */
  function promiseKey(rows:HTMLElement|null):string{
    const ids=[...(rows?.children??[])].filter(li=>{const d=(li as HTMLElement).dataset;return d.kind==='first'||d.kind==='last'||d.always==='1';}).map(li=>li.getAttribute('data-key'));
    return `${element.clientWidth}x${element.clientHeight}|${ids.join(',')}`;
  }
  /** cardPlacement over the laid-out wall; true when the card moved. */
  function placeCard():boolean{
    const kiosk=element.closest<HTMLElement>('.kiosk');
    const compact=!lightweight&&kiosk?.dataset.size==='compact'&&kiosk.dataset.portrait!=='1';
    const current=element.dataset.card==='aside'?'aside':'map';
    const set=(next:'map'|'aside'):boolean=>{
      if(next===current)return false;
      if(next==='aside')element.dataset.card='aside';else delete element.dataset.card;
      return true;
    };
    if(!compact)return set('map');
    const rows=element.querySelector<HTMLElement>('.k-nearby-rows');
    const windowH=element.clientHeight;
    if(!rows||!(windowH>0))return false;
    const gap=Number.parseFloat(getComputedStyle(element).rowGap)||0;
    const cardH=card.offsetHeight;
    const key=`${element.clientWidth}x${windowH}`;
    const mapNow=field.measureHeight();
    if(current==='map')mapUnder={key,px:mapNow};
    const under=mapUnder?.key===key?mapUnder.px:mapNow-cardH-gap;
    const listAside=current==='aside'?rows.clientHeight:rows.clientHeight-cardH-gap;
    const floor=promisesPx(rows);
    const zoom=Number.parseFloat(getComputedStyle(element).getPropertyValue('--k-zoom'))||1;
    const next=refused===promiseKey(rows)?'map':cardPlacement({mapUnderPx:under,listAsidePx:listAside,floorPx:floor,minMapPx:MAP_MIN_HEIGHT_PX*zoom});
    element.dataset.mapFloor=String(Math.round(MAP_MIN_HEIGHT_PX*zoom));
    return set(next);
  }
  function fit():void {
    if(!model)return;
    timeline.update(model.items,model.radiusM,model.now);
    if(!placeCard())return;
    timeline.update(model.items,model.radiusM,model.now);
    // The fit is the proof: the promises did not fit under the card after all, so the card goes back.
    if(element.dataset.card==='aside'&&timeline.element.dataset.fitOverflow==='1'){
      refused=promiseKey(element.querySelector<HTMLElement>('.k-nearby-rows'));
      delete element.dataset.card;
      timeline.update(model.items,model.radiusM,model.now);
    }
    deps.onMapBox?.();
  }
  return {
    element,mapHost:field.mapHost,
    update(next){
      model=next;
      field.update({modules:model.modules,stop:model.stop,strings:s,i18n,locale});
      setFrame(model.frame);
      const hidden=lightweight||!model.outage;
      if(note.hidden!==hidden)note.hidden=hidden;
      fit();
    },
    measureWidth:()=>field.measureWidth(),measureHeight:()=>field.measureHeight(),
    setFrame,setMajorLabels:count=>field.setMajorLabels(count),fit,
    setLegend(kinds){
      for(const span of geography.querySelectorAll<HTMLElement>('.k-map-legend > span[data-legend]')){
        const hidden=!kinds.includes(span.dataset.legend??'');
        if(span.hidden!==hidden)span.hidden=hidden;
      }
    },
    destroy(){timeline.destroy();field.destroy();element.remove();},
  };
}
