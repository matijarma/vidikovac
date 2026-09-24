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

/** The ol's design-height fallback only; its measured box wins after layout. Compact: the whole aside
 *  (decision 50: the QR card stands under the map), 513 px minus the list's heading and padding. */
export const NEARBY_DESIGN_HEIGHT: Readonly<Record<Composition, number>> = {
  wide: 480, compact: 450, portrait: 490, handheld: Number.POSITIVE_INFINITY,
};
export interface InvitationDeps {
  strings: KioskStrings; i18n: I18n; locale: string; lightweight: boolean;
  reducedMotion: boolean; codeBase?: string;
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
    legend.innerHTML=`<span><b class="k-legend-tram">6</b> ${e(s.legend.tram)}</span><span><b class="k-legend-bike">●</b> ${e(s.legend.bikes)}</span><span><b class="k-legend-culture">●</b> ${e(s.legend.culture)}</span>`;
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
  function fit():void {
    if(model)timeline.update(model.items,model.radiusM,model.now);
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
    destroy(){timeline.destroy();field.destroy();element.remove();},
  };
}
