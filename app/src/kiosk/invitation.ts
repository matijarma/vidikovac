// The unpaired composition: the city's front page for this stop (plan
// "/kiosk/: a screen a person can use"). Five panels of the teaser's content
// (kiosk/front.ts), the map as one panel among them sized to what it usefully
// shows (this stop, its vehicles, the closures around it), and the invitation
// card at the foot of the right column. Built once; update() re-reads the
// panels and paints each through ui/dom/reconcile.ts, so only the rows whose
// content changed are touched, the map container the controller hosts is
// never rewritten by a poll, and the card the rotation paints is never
// re-rendered.
//
//   ┌ tonight (events, two columns) ───────────────┬ weather (sutra / danas) ┐
//   │                                              ├ city (Skupština, Glasnik,│
//   ├ promet (lines) ┬ field (map) ┬ around ───────┤       kvart)             │
//   │                │             │ (closures,    ├ card (QR, code) ─────────┤
//   └────────────────┴─────────────┴ works) ───────┴──────────────────────────┘
//
// The header carries the weather now (D11) and the strip the safety words, so
// nothing here says either. A panel's rows the box does not hold whole are
// hidden from the foot up (fit), never clipped. A phone gets the same panels
// in one column and scrolls.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { ScreenStop } from '../core/contracts';
import type { LastRunSnapshot } from '../core/lastrun';
import type { I18n } from '../i18n/i18n';
import { reconcile } from '../ui/dom/reconcile';
import { escapeHtml } from '../ui/dom/escape';
import { mountField, type FieldHandle } from './field';
import { frontPanels, PANEL_IDS, panelMarkup, type PanelId } from './front';
import type { Composition } from './layout';
import { codeBlockMarkup, hintMarkup } from './markup';
import type { KioskStrings } from './strings';

export interface InvitationDeps {
  strings: KioskStrings;
  i18n: I18n;
  locale: string;
  lightweight: boolean;
  /** The origin the QR points at; the hint names its hostname. Production when absent. */
  codeBase?: string;
}

export interface InvitationModel {
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
  /** Re-measures every panel: a row the box does not hold whole is hidden from the foot up. Runs after every update, when the controller says the box changed (a resize) and once by itself when the fonts arrive. */
  fit(): void;
  destroy(): void;
}

/** The card the rotation paints (R-KP21): the lead over the hint in one side
 *  wrapper the QR stands beside, then the code and its bar across. Reading
 *  order is the lead, the hint, the QR, the code; the lead is the page's one h1. */
export function cardMarkup(s: KioskStrings, codeBase?: string): string {
  return `<article class="k-invite" data-testid="kiosk-invite">
      <div class="k-invite-side"><h1 class="k-lead">${escapeHtml(s.invitation.lead)}</h1>${hintMarkup(s, codeBase)}</div>
      <div class="k-qr" data-testid="kiosk-qr"><p class="k-qr-waiting">${escapeHtml(s.invitation.qrWaiting)}</p></div>
      ${codeBlockMarkup(s)}
    </article>`;
}

function panelShell(id: PanelId): string {
  return `<section class="k-panel" data-panel="${id}" data-testid="kiosk-panel-${id}"${id === 'promet' ? ' data-say="transit"' : ''}></section>`;
}

export function mountInvitation(host: HTMLElement, deps: InvitationDeps): InvitationHandle {
  const { strings: s, i18n, locale, lightweight } = deps;
  const element = document.createElement('section');
  element.className = 'k-front';
  element.dataset.testid = 'kiosk-invitation';
  element.innerHTML = `<div class="k-local"><div class="k-geography"></div>${panelShell('promet')}</div>
    <aside class="k-overview">${panelShell('weather')}${panelShell('tonight')}
      <div class="k-neighborhood"><div class="k-context-stack">${panelShell('around')}${panelShell('city')}</div>
        <div class="k-panel--card">${cardMarkup(s, deps.codeBase)}</div>
      </div>
    </aside>`;
  host.appendChild(element);
  const field: FieldHandle = mountField(element.querySelector<HTMLElement>('.k-geography')!, { lightweight });
  const panels = Object.fromEntries(PANEL_IDS.map((id) => [id, element.querySelector<HTMLElement>(`[data-panel="${id}"]`)!])) as Record<PanelId, HTMLElement>;
  const lastHtml: Partial<Record<PanelId, string>> = {};
  let disposed = false;

  /** Content budgets belong to the model. Never make a panel silently empty
   *  to satisfy a geometry test. Unexpected overflow is visible to QA. */
  function fit(): void {
    for (const id of PANEL_IDS) {
      const panel = panels[id];
      panel.dataset.overflow = panel.clientHeight > 0 && panel.scrollHeight > panel.clientHeight + 1 ? 'true' : 'false';
    }
  }

  function paint(model: InvitationModel): void {
    const built = frontPanels({ modules: model.modules, stop: model.stop, now: model.now, lastRun: model.lastRun, strings: s, i18n, locale, lightweight, composition: model.composition });
    for (const id of PANEL_IDS) {
      const html = panelMarkup(built[id]);
      if (html === lastHtml[id]) continue;
      lastHtml[id] = html;
      const next = document.createElement('div');
      next.innerHTML = html;
      reconcile(panels[id], next);
      const state = built[id].state;
      if (state) panels[id].dataset.state = state; else delete panels[id].dataset.state;
    }
    fit();
  }

  // A cold screen paints in the fallback face; the web font arriving changes every wrap, so the panels are fitted once more when the fonts are ready (never on a timer).
  const fonts = (document as { fonts?: { ready?: Promise<unknown> } }).fonts;
  void fonts?.ready?.then(() => { if (!disposed) fit(); });

  return {
    element,
    get mapHost() { return field.mapHost; },
    update(model) {
      field.update({ modules: model.modules, stop: model.stop, strings: s, i18n, locale });
      paint(model);
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
