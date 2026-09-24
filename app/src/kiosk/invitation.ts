// The passive public overview: one map, the nearby timeline and the QR.
// Each has its own region and lifetime; a feed refresh never remounts them.
import type { FrameStops } from '../../../shared/city/frame';
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { ROW_MIN_PX, type NearbyRow } from '../city/nearby';
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

/** Where the compact landscape wall puts its QR card and its legend (lanes w-labels and w-labels2, 24 Sep).
 *  Decision 50 put the card under the map so the "U blizini" list has the whole aside; on a short window that
 *  left the map a strip (669 x 162 at 1280 x 800, 714 x 116 at 1366 x 768). The order is decision 50's with the
 *  map's floor in it: the list's promises (the first and last trams, the timeless row, the lead departure: the
 *  rows its fit never drops) first, then the map's legible minimum (map/frame.ts MAP_MIN_HEIGHT_PX), then the
 *  rest of the departures, then more map. Three arrangements, by the map they leave:
 *  'map'    decision 50: card and legend under the map, the list the whole aside;
 *  'aside'  the card under the list, the map the whole left column over its legend (by day);
 *  'legend' the card under the map and the legend straight under the list, no gap between (lane w-labels3:
 *           the gap was the four pixels lastTrams2240's second departure lacked);
 *           at night at 1366 x 768 the card under the
 *           list leaves it 154 px for 236 to 322 px of promises, and the map under card and legend is 159 px).
 *  The card goes under the list whenever the list keeps its promises there (the map is then the largest it
 *  can be; lane w-labels, as D5.9 ships by day); else the legend goes under the list if the map is legible
 *  and the list keeps its promises there (at night); else decision 50's stands (the promises win). All px
 *  are the display's; nothing measured (0) moves nothing. */
export type CompactPlacement = 'map' | 'aside' | 'legend';
export interface CompactBox {
  windowPx: number; gapPx: number; cardPx: number; legendPx: number; listOverheadPx: number; minMapPx: number;
  /** The rows the fit never drops: first/last trams, the timeless row, the lead departure. */
  floorPx: number;
  /** Those plus the second and third departures the timetable offers, at the smallest row (lane w-labels3). */
  fullPx?: number;
}
/** Decision 50 refined (lane w-labels3): the promises first, then departures up to three, then map height -- but
 *  the map never below its legible minimum. So the largest map is taken among the arrangements whose map is
 *  legible and whose list holds the promises AND the departures on offer (fullPx); only when none does is the
 *  list held to its promises alone (floorPx, one departure); decision 50's is the last word. */
export function compactArrangement(b: CompactBox): { placement: CompactPlacement; mapPx: number; listPx: number } {
  const map = { placement: 'map' as const, mapPx: b.windowPx - b.gapPx - b.cardPx - b.legendPx, listPx: b.windowPx - b.listOverheadPx };
  if (!(b.windowPx > 0)) return map;
  const aside = { placement: 'aside' as const, mapPx: b.windowPx - b.legendPx, listPx: b.windowPx - b.gapPx - b.cardPx - b.listOverheadPx };
  const legend = { placement: 'legend' as const, mapPx: b.windowPx - b.gapPx - b.cardPx, listPx: b.windowPx - b.listOverheadPx - b.legendPx };
  const byMap = [aside, legend, map];
  for (const need of [Math.max(b.floorPx, b.fullPx ?? 0), b.floorPx]) {
    const pick = byMap.find((a) => a.mapPx >= b.minMapPx && a.listPx >= need);
    if (pick) return pick;
  }
  return map;
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
  let legend:HTMLElement|null=null;
  if(!lightweight){
    legend=document.createElement('p');
    legend.className='k-map-legend';
    // Round 2 F9: the BAJS entries by what the map draws (kiosk/mapview.ts legendKinds): a numbered disc, an empty
    // station's dot, the whole-city window's dot. The chips are the marks' own shapes, the number a sample.
    legend.innerHTML=`<span data-legend="tram"><b class="k-legend-tram">6</b> ${e(s.legend.tram)}</span>`
      +`<span data-legend="bikes"><b class="k-legend-bike k-legend-disc">7</b> ${e(s.legend.bikes)}</span>`
      +`<span data-legend="bikesEmpty"><b class="k-legend-bike k-legend-dot">●</b> ${e(s.legend.bikesEmpty)}</span>`
      +`<span data-legend="bikesFar"><b class="k-legend-bike k-legend-dot">●</b> ${e(s.legend.bikesFar)}</span>`
      +`<span data-legend="culture"><b class="k-legend-culture">●</b> ${e(s.legend.culture)}</span>`;
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
  /** A window box and promise set for which the card was tried under the list and the promises did not fit. */
  let refused:string|null=null;
  /** The height the rows the fit never drops need in a smaller box: each at its content, never under the
   *  smallest row (ROW_MIN_PX), whatever the larger box's budget grew it to. */
  function promisesPx(rows:HTMLElement):number{
    const lis=[...rows.children] as HTMLElement[];
    const kept=new Set<HTMLElement>(lis.filter(li=>li.dataset.kind==='first'||li.dataset.kind==='last'));
    const always=lis.find(li=>li.dataset.always==='1');if(always)kept.add(always);
    const departure=lis.find(li=>li.dataset.kind==='departure');if(departure)kept.add(departure);
    if(kept.size===0)return 0;
    const gap=Number.parseFloat(getComputedStyle(rows).rowGap)||0;
    const zoom=Number.parseFloat(getComputedStyle(element).getPropertyValue('--k-zoom'))||1;
    const content=(li:HTMLElement):number=>{
      const style=getComputedStyle(li);
      const pad=(Number.parseFloat(style.paddingTop)||0)+(Number.parseFloat(style.paddingBottom)||0);
      const inner=Math.max(...[...li.children].map(child=>(child as HTMLElement).offsetHeight||0),0);
      return Math.max(ROW_MIN_PX*zoom,inner+pad);
    };
    return [...kept].reduce((sum,li)=>sum+content(li),0)+gap*(kept.size-1);
  }
  /** The window box and the promise rows (not the departures, which come and go by the minute). */
  function promiseKey(rows:HTMLElement|null):string{
    const ids=[...(rows?.children??[])].filter(li=>{const d=(li as HTMLElement).dataset;return d.kind==='first'||d.kind==='last'||d.always==='1';}).map(li=>li.getAttribute('data-key'));
    return `${element.clientWidth}x${element.clientHeight}|${ids.join(',')}`;
  }
  const nearbyHost=element.querySelector<HTMLElement>('.k-nearby-host')!;
  /** compactArrangement over the laid-out wall; true when the card or the legend moved. */
  function placeCard():boolean{
    const kiosk=element.closest<HTMLElement>('.kiosk');
    const compact=!lightweight&&kiosk?.dataset.size==='compact'&&kiosk.dataset.portrait!=='1';
    const current:CompactPlacement=element.dataset.card==='aside'?'aside':element.dataset.card==='legend'?'legend':'map';
    const set=(next:CompactPlacement):boolean=>{
      if(next===current)return false;
      if(next==='map')delete element.dataset.card;else element.dataset.card=next;
      // The legend stands under the list only in 'legend'; everywhere else it is the map's own footer.
      if(legend){
        if(next==='legend'&&legend.parentElement!==nearbyHost)nearbyHost.appendChild(legend);
        if(next!=='legend'&&legend.parentElement!==geography)geography.insertBefore(legend,note);
      }
      return true;
    };
    if(!compact)return set('map');
    const rows=element.querySelector<HTMLElement>('.k-nearby-rows');
    const windowH=element.clientHeight;
    if(!rows||!(windowH>0))return false;
    const zoom=Number.parseFloat(getComputedStyle(element).getPropertyValue('--k-zoom'))||1;
    const box={
      windowPx:windowH,gapPx:Number.parseFloat(getComputedStyle(element).rowGap)||0,cardPx:card.offsetHeight,
      legendPx:legend?.offsetHeight??0,listOverheadPx:Math.max(0,timeline.element.offsetHeight-rows.clientHeight),
      floorPx:promisesPx(rows),minMapPx:MAP_MIN_HEIGHT_PX*zoom,
    };
    // The second and third departures on offer (the model's, not the ones this box happened to show), at the smallest row.
    const offered=Math.min(3,model?.items.filter(row=>row.kind==='departure').length??0);
    const fullPx=box.floorPx+Math.max(0,offered-1)*ROW_MIN_PX*zoom;
    const next=refused===promiseKey(rows)?'map':compactArrangement({...box,fullPx}).placement;
    element.dataset.mapFloor=String(Math.round(box.minMapPx));
    return set(next);
  }
  function fit():void {
    if(!model)return;
    timeline.update(model.items,model.radiusM,model.now);
    if(!placeCard())return;
    timeline.update(model.items,model.radiusM,model.now);
    // The fit is the proof: the promises did not fit the smaller list after all, so decision 50's arrangement returns.
    if(element.dataset.card&&timeline.element.dataset.fitOverflow==='1'){
      refused=promiseKey(element.querySelector<HTMLElement>('.k-nearby-rows'));
      delete element.dataset.card;
      if(legend&&legend.parentElement!==geography)geography.insertBefore(legend,note);
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
      for(const span of legend?.querySelectorAll<HTMLElement>(':scope > span[data-legend]')??[]){
        const hidden=!kinds.includes(span.dataset.legend??'');
        if(span.hidden!==hidden)span.hidden=hidden;
      }
    },
    destroy(){timeline.destroy();field.destroy();element.remove();},
  };
}
