// Passive overview. Map, conditions, highlight and QR each own a layout
// region. Polling never replaces the map or the independently rotating QR.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { CityState } from '../../../shared/city/types';
import type { ScreenStop } from '../core/contracts';
import type { LastRunSnapshot } from '../core/lastrun';
import type { I18n } from '../i18n/i18n';
import { reconcile } from '../ui/dom/reconcile';
import { escapeHtml as e } from '../ui/dom/escape';
import { mountField } from './field';
import { weatherPanel, panelMarkup, type FrontRow } from './front';
import type { BoardSubject } from './arrivals';
import type { Composition } from './layout';
import { codeBlockMarkup, hintMarkup } from './markup';
import type { KioskStrings } from './strings';
import type { KioskHighlight } from './highlights';

export const FRONT_PANEL_IDS = ['weather'] as const;
export interface InvitationDeps {
  strings: KioskStrings; i18n: I18n; locale: string; lightweight: boolean; codeBase?: string;
}
export interface InvitationModel {
  city?: CityState; modules: readonly ModuleSnapshot[]; stop: ScreenStop | null;
  now: number; lastRun: LastRunSnapshot | null; composition: Composition;
  prometRows?: FrontRow[]; prometBoard?: BoardSubject;
}
export interface InvitationHandle {
  element: HTMLElement; readonly mapHost: HTMLElement | null;
  update(model: InvitationModel): void;
  highlight(item: KioskHighlight | null, paused: boolean, reduced: boolean): void;
  measureWidth(): number; measureHeight(): number; setMajorLabels(count: number): void;
  fit(): void; destroy(): void;
}
export function cardMarkup(s: KioskStrings, codeBase?: string): string {
  return `<article class="k-invite" data-testid="kiosk-invite">
    <div class="k-invite-side"><h1 class="k-lead">${e(s.invitation.lead)}</h1><p class="k-invite-benefit">${e(s.invitation.support)}</p>${hintMarkup(s,codeBase)}${codeBlockMarkup(s)}</div>
    <div class="k-qr" data-testid="kiosk-qr"><p class="k-qr-waiting">${e(s.invitation.qrWaiting)}</p></div></article>`;
}
export function mountInvitation(host: HTMLElement, deps: InvitationDeps): InvitationHandle {
  const {strings:s,i18n,locale,lightweight}=deps;
  const en=locale.startsWith('en');
  const element=document.createElement('section');
  element.className='k-city-window';
  element.dataset.testid='kiosk-invitation';
  element.innerHTML=`<p class="k-handheld-info">${en?'For a public display, open /kiosk/ on that device and choose Start screen. This code opens a personal session; scanning does not change the public display.':'Za javni zaslon otvori /kiosk/ na tom uređaju i odaberi Pokreni zaslon. Ovaj kod otvara osobnu sesiju; skeniranje ne mijenja javni prikaz.'}</p><div class="k-geography"></div>
    <aside class="k-overview">
      <section class="k-panel" data-panel="weather" data-testid="kiosk-panel-weather"></section>
      <section class="k-highlight" data-testid="kiosk-highlight">
        <header class="k-highlight-head"><p class="k-highlight-kicker"></p><button class="k-highlight-pause btn-quiet" type="button" data-action="pause-highlights" aria-pressed="false"></button></header>
        <div class="k-highlight-content"></div></section>
      <div class="k-panel--card">${cardMarkup(s,deps.codeBase)}</div>
    </aside>`;
  host.appendChild(element);
  const geography=element.querySelector<HTMLElement>('.k-geography')!;
  const field=mountField(geography,{lightweight});
  const legend=document.createElement('p');
  legend.className='k-map-legend';
  legend.innerHTML=`<span><b class="k-legend-tram">6</b> ${en?'Tram route':'Tramvajska linija'}</span><span><b class="k-legend-bike">●</b> BAJS: ${en?'bike count, ? unconfirmed':'broj bicikala, ? nepotvrđeno'}</span><span><b class="k-legend-culture">●</b> ${en?'Events this week':'Događanja ovaj tjedan'}</span>`;
  geography.appendChild(legend);
  const weather=element.querySelector<HTMLElement>('[data-panel=weather]')!;
  const content=element.querySelector<HTMLElement>('.k-highlight-content')!;
  const pause=element.querySelector<HTMLButtonElement>('.k-highlight-pause')!;
  const kicker=element.querySelector<HTMLElement>('.k-highlight-kicker')!;
  let lastKey:string|null=null;
  function fit():void {
    for(const region of [weather,content])region.dataset.overflow=String(region.clientHeight>0&&region.scrollHeight>region.clientHeight+1);
  }
  return {
    element,mapHost:field.mapHost,
    update(model){
      field.update({modules:model.modules,stop:model.stop,strings:s,i18n,locale});
      const next=document.createElement('div');
      const panel=weatherPanel({...model,strings:s,i18n,locale,lightweight});
      next.innerHTML=panelMarkup(panel);
      reconcile(weather,next);
      weather.dataset.state=panel.state??'loading';
      fit();
    },
    highlight(item,paused,reduced){
      const key=item?.id??'empty';
      const next=document.createElement('div');
      kicker.textContent=item?.kicker??(en?'The city, live':'Grad uživo');
      next.innerHTML=item?`<h2>${e(item.what)}</h2><p class="k-highlight-where">${e(item.where)}</p><p class="k-highlight-when">${e(item.when)}</p><p class="k-highlight-credit">${e(item.source)} · ${e(item.freshness)}</p>`:
        `<h2>${en?'Waiting for city information':'Čekamo gradske podatke'}</h2><p>${en?'The code still opens a personal session. Unavailable sources are marked on your phone.':'Kod i dalje otvara osobnu sesiju. Nedostupni izvori označeni su na telefonu.'}</p>`;
      reconcile(content,next);
      if(lastKey!==null&&lastKey!==key&&!reduced)content.animate?.([{opacity:0},{opacity:1}],{duration:180,easing:'ease-out'});
      lastKey=key;
      content.dataset.highlight=key;
      pause.textContent=paused?(en?'Resume':'Nastavi'):(en?'Pause':'Zaustavi');
      pause.setAttribute('aria-label',paused?(en?'Resume highlights':'Nastavi izmjenu'):(en?'Pause highlights':'Zaustavi izmjenu'));
      pause.setAttribute('aria-pressed',String(paused));
      fit();
    },
    measureWidth:()=>field.measureWidth(),measureHeight:()=>field.measureHeight(),
    setMajorLabels:count=>field.setMajorLabels(count),fit,
    destroy(){field.destroy();element.remove();},
  };
}
