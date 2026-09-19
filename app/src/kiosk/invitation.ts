// The unpaired composition: the city's front page. The map is the page --
// the whole left column, the live window on Zagreb -- and the right column is
// the three things a passer-by cannot read off a map (the sky, the network's
// exceptions, what is on tonight) over the card that hands the city to a
// phone. Built once; update() re-reads the panels and paints each through
// ui/dom/reconcile.ts, so only the rows whose content changed are touched,
// the map container the controller hosts is never rewritten by a poll, and
// the card the rotation paints is never re-rendered.
//
//   ┌ the city, live ───────────────────────┬ weather (now, danas, sutra) ┐
//   │ (tram network, plates, BAJS, closures,├ promet (exceptions only) ───┤
//   │  the on-duty pharmacy)                ├ tonight (venues, fills) ────┤
//   │                                       │                             │
//   │ [Istraži grad]                        ├ card (QR, lead, hint, code) ┤
//   └───────────────────────────────────────┴─────────────────────────────┘
//
// The header carries the ticker (kiosk/ticker.ts) and the strip the safety
// words, so nothing here says either. The events card's row budget is the
// room the aside measures, never a constant: two rows at least, and a
// populated panel is never emptied to make a box fit. A phone gets the same
// page in one column and scrolls.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { ScreenStop } from '../core/contracts';
import type { LastRunSnapshot } from '../core/lastrun';
import type { I18n } from '../i18n/i18n';
import { reconcile } from '../ui/dom/reconcile';
import { escapeHtml } from '../ui/dom/escape';
import { mountField, type FieldHandle } from './field';
import { frontPanels, panelMarkup, type PanelId } from './front';
import type { Composition } from './layout';
import { codeBlockMarkup, hintMarkup } from './markup';
import type { KioskStrings } from './strings';
import type { CityState } from '../../../shared/city/types';
import { locatedEvents,activeVenues } from '../../../shared/city/events';
import { distanceM,located } from '../../../shared/city/geo';
import { ct } from '../city/strings';

/** The three cards the aside carries, in reading order. The other two
 *  producers (around, city) are the paired compositions' (kiosk/paired.ts):
 *  closures are on the map and in the ticker, the gazette is in the ticker. */
export const FRONT_PANEL_IDS: readonly PanelId[] = ['weather', 'promet', 'tonight'];

/** The events card's floor: a card with one venue is not a card (T3). */
const MIN_EVENT_ROWS = 2;
/** The budget before the aside has been laid out once (happy-dom, a cold first paint). */
const SEED_EVENT_ROWS: Readonly<Record<Composition, number>> = { wide: 6, compact: 3, portrait: 5, handheld: 4 };

export interface InvitationDeps {
  strings: KioskStrings;
  i18n: I18n;
  locale: string;
  lightweight: boolean;
  /** The origin the QR points at; the hint names its hostname. Production when absent. */
  codeBase?: string;
}

export interface InvitationModel {
  city?:CityState;
  modules: readonly ModuleSnapshot[];
  stop: ScreenStop | null;
  now: number;
  /** The stop's last-departure table (R-KP6), null until it answers or without one. */
  lastRun: LastRunSnapshot | null;
  /** Which of the four drawings this is (kiosk/layout.ts); the sheet lays the panels out by it. */
  composition: Composition;
}

export interface InvitationHandle {
  element: HTMLElement;
  /** The field's map host, the box the controller hosts the one map in; null under lagano, which has no map. */
  readonly mapHost: HTMLElement | null;
  update(model: InvitationModel): void;
  /** The field's laid-out width for the camera (kiosk/field.ts); 0 before layout. */
  measureWidth(): number;
  /** The field's laid-out height, which with the width sets the street names' padding (kiosk/mapview.ts labelPadding); 0 before layout. */
  measureHeight(): number;
  /** Contract 3: the map's placed major street names, counted, onto the map host. */
  setMajorLabels(count: number): void;
  /** Re-measures the aside: how many event rows its room holds, and whether any
   *  panel overflows. Runs after every update, when the controller says the box
   *  changed (a resize) and once by itself when the fonts arrive. */
  fit(): void;
  destroy(): void;
}

/** The card the rotation paints (R-KP21): the QR beside one column of words --
 *  the lead, the typed address, then the code and its bar, all at the same
 *  left edge. Reading order is the lead, the hint, the code, the QR; the lead
 *  is the page's one h1. */
export function cardMarkup(s: KioskStrings, codeBase?: string): string {
  return `<article class="k-invite" data-testid="kiosk-invite">
      <div class="k-invite-side"><h1 class="k-lead">${escapeHtml(s.invitation.lead)}</h1>${hintMarkup(s, codeBase)}${codeBlockMarkup(s)}</div>
      <div class="k-qr" data-testid="kiosk-qr"><p class="k-qr-waiting">${escapeHtml(s.invitation.qrWaiting)}</p></div>
    </article>`;
}

function panelShell(id: PanelId): string {
  return `<section class="k-panel" data-panel="${id}" data-testid="kiosk-panel-${id}"${id === 'promet' ? ' data-say="transit"' : ''}></section>`;
}

export function mountInvitation(host: HTMLElement, deps: InvitationDeps): InvitationHandle {
  const { strings: s, i18n, locale, lightweight } = deps;
  const element = document.createElement('section');
  element.className = 'k-front k-city-window';
  element.dataset.testid = 'kiosk-invitation';
  element.innerHTML = `<div class="k-geography"></div>
    <aside class="k-overview">${FRONT_PANEL_IDS.map(panelShell).join('')}
      <div class="k-discovery-slot"></div><div class="k-panel--card">${cardMarkup(s, deps.codeBase)}</div>
    </aside><button type="button" class="k-explore btn-ghost" data-action="kiosk-explore">${ct(i18n,'preview')}</button>`;
  host.appendChild(element);
  const field: FieldHandle = mountField(element.querySelector<HTMLElement>('.k-geography')!, { lightweight });
  const panels = Object.fromEntries(FRONT_PANEL_IDS.map((id) => [id, element.querySelector<HTMLElement>(`[data-panel="${id}"]`)!])) as Record<PanelId, HTMLElement>;
  const lastHtml: Partial<Record<PanelId, string>> = {};
  let lastModel: InvitationModel | null = null;
  let rowBudget = SEED_EVENT_ROWS.wide;
  /** Null until the browser has laid a row out: the seed stands in until then. */
  let measured: number | null = null;
  let disposed = false;

  /** Content budgets belong to the model. Never make a panel silently empty
   *  to satisfy a geometry test. Unexpected overflow is visible to QA. */
  function markOverflow(): void {
    for (const id of FRONT_PANEL_IDS) {
      const panel = panels[id];
      panel.dataset.overflow = panel.clientHeight > 0 && panel.scrollHeight > panel.clientHeight + 1 ? 'true' : 'false';
    }
  }

  /** How many venue rows the events card's own box holds: its height less the
   *  head, the credit and any note, over one row's measured height. Two at
   *  least; null while nothing has been laid out (happy-dom, a cold first paint). */
  function measureRowBudget(): number | null {
    const panel = panels.tonight;
    const row = panel.querySelector<HTMLElement>('.k-fr');
    const box = panel.clientHeight;
    if (!box || !row?.clientHeight) return null;
    const spent = (['.k-panel-head', '.k-panel-note', '.k-panel-credit'] as const)
      .reduce((sum, sel) => sum + (panel.querySelector<HTMLElement>(sel)?.offsetHeight ?? 0), 0);
    return Math.max(MIN_EVENT_ROWS, Math.floor((box - spent) / row.clientHeight));
  }

  function paint(model: InvitationModel): void {
    const built = frontPanels({ modules: model.modules, stop: model.stop, now: model.now, lastRun: model.lastRun, strings: s, i18n, locale, lightweight, composition: model.composition, prometMode: 'exceptions' });
    if(model.city){
      const events=locatedEvents(model.modules.find(m=>m.module==='dogadanja')?.items??[],model.city.places,model.now);
      const venues=activeVenues(events,model.city.places).sort((a,b)=>model.stop?distanceM(model.stop,a.place as {lon:number;lat:number})-distanceM(model.stop,b.place as {lon:number;lat:number}):0);
      if(venues.length){
        built.tonight.rows=venues.slice(0,rowBudget).map(v=>({
          key:v.place.id,lead:String(v.count),title:v.place.name,sub:v.events[0].item.title,
        }));
        built.tonight.meta=ct(i18n,'week');
        built.tonight.note=undefined;
      }
      if(!built.tonight.rows.length){
        const ref=model.stop??{lon:15.97726,lat:45.81286};
        const p=model.city.places.filter(p=>['culture','heritage'].includes(p.category)&&located(p))
          .sort((a,b)=>distanceM(ref,{lon:a.lon!,lat:a.lat!})-distanceM(ref,{lon:b.lon!,lat:b.lat!}))[0];
        if(p){built.tonight.kicker=ct(i18n,'quiet');built.tonight.meta=undefined;built.tonight.rows=[{key:p.id,title:p.name,sub:p.description?.slice(0,160)??p.address}];built.tonight.note=undefined;built.tonight.credit=model.city.manifest?.sources.find(s=>s.id===p.sourceId)?.name??p.sourceId;}
      }
    }
    for (const id of FRONT_PANEL_IDS) {
      const html = panelMarkup(built[id]);
      if (html === lastHtml[id]) continue;
      lastHtml[id] = html;
      const next = document.createElement('div');
      next.innerHTML = html;
      reconcile(panels[id], next);
      const state = built[id].state;
      if (state) panels[id].dataset.state = state; else delete panels[id].dataset.state;
    }
  }

  /** Measure, then paint once more if the room turned out to hold a different
   *  number of rows than the last paint assumed. One extra pass at most. */
  function fit(): void {
    markOverflow();
    if (!lastModel) return;
    measured = measureRowBudget();
    if (measured === null || measured === rowBudget) return;
    rowBudget = measured;
    paint(lastModel);
    markOverflow();
  }

  // A cold screen paints in the fallback face; the web font arriving changes every wrap, so the panels are fitted once more when the fonts are ready (never on a timer).
  const fonts = (document as { fonts?: { ready?: Promise<unknown> } }).fonts;
  void fonts?.ready?.then(() => { if (!disposed) fit(); });

  return {
    element,
    get mapHost() { return field.mapHost; },
    update(model) {
      lastModel = model;
      if (measured === null) rowBudget = SEED_EVENT_ROWS[model.composition];
      field.update({ modules: model.modules, stop: model.stop, strings: s, i18n, locale });
      paint(model);
      fit();
    },
    measureWidth: () => field.measureWidth(),
    measureHeight: () => field.measureHeight(),
    setMajorLabels: (count) => field.setMajorLabels(count),
    fit,
    destroy() {
      disposed = true;
      field.destroy();
      element.remove();
    },
  };
}
