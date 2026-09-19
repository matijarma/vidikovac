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
import { EXCEPTION_LINES, eventCardRows, frontPanels, panelMarkup, type FrontPanel, type PanelId } from './front';
import type { Composition } from './layout';
import { codeBlockMarkup, hintMarkup } from './markup';
import type { KioskStrings } from './strings';
import type { CityState } from '../../../shared/city/types';
import { activeVenues, locatedEvents, type ActiveVenue } from '../../../shared/city/events';
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

/** What the aside's measured room holds: the events card's rows and the promet card's lines. */
interface Budgets { rows: number; lines: number }

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
  element.className = 'k-city-window';
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
  let lineBudget = EXCEPTION_LINES.wide;
  /** Null until the browser has laid a row out: the seeds stand in until then. */
  let measured: Budgets | null = null;
  let disposed = false;

  /** Content budgets belong to the model. Never make a panel silently empty
   *  to satisfy a geometry test. Unexpected overflow is visible to QA. */
  function markOverflow(): void {
    for (const id of FRONT_PANEL_IDS) {
      const panel = panels[id];
      panel.dataset.overflow = panel.clientHeight > 0 && panel.scrollHeight > panel.clientHeight + 1 ? 'true' : 'false';
    }
  }

  /** A card's room for rows: its box less its own padding, its head, its note
   *  and its credit. clientHeight is the padding box, and a card's padding is
   *  not room for a row. */
  function roomFor(panel: HTMLElement): number {
    const box = panel.clientHeight;
    if (!box) return 0;
    const style = getComputedStyle(panel);
    const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const spent = (['.k-panel-head', '.k-panel-note', '.k-panel-credit'] as const)
      .reduce((sum, sel) => sum + (panel.querySelector<HTMLElement>(sel)?.offsetHeight ?? 0), 0);
    return box - pad - spent;
  }

  /** What the aside's measured room holds: how many venue and event rows the
   *  events card can show (two at least, its floor) and how many exception
   *  lines the promet card may keep. The floor comes first -- where the events
   *  card is short, the promet card gives up lines until it is not, and where
   *  a whole line of slack appears it takes one back, up to its cap. Null while
   *  nothing has been laid out (happy-dom, a cold first paint). */
  function measureBudgets(): Budgets | null {
    const room = roomFor(panels.tonight);
    const row = panels.tonight.querySelector<HTMLElement>('.k-fr')?.clientHeight ?? 0;
    if (room <= 0 || !row) return null;
    const line = panels.promet.querySelector<HTMLElement>('.k-fr')?.clientHeight ?? 0;
    const cap = EXCEPTION_LINES[lastModel?.composition ?? 'wide'];
    // The floor is what the promet card yields lines for, not something the
    // events card overflows to honour: where even one exception line cannot buy
    // the second row, the card shows the one row its box holds whole.
    const spare = room - MIN_EVENT_ROWS * row;
    return {
      rows: Math.max(1, Math.floor(room / row)),
      lines: line > 0 ? Math.min(cap, Math.max(1, lineBudget + Math.floor(spare / line))) : lineBudget,
    };
  }

  /** The venues with something on, nearest the screen first; none without a city catalogue. */
  function activeNearby(model: InvitationModel): ActiveVenue[] {
    if (!model.city) return [];
    const events = locatedEvents(model.modules.find(m => m.module === 'dogadanja')?.items ?? [], model.city.places, model.now);
    return activeVenues(events, model.city.places)
      .sort((a, b) => model.stop ? distanceM(model.stop, a.place as { lon: number; lat: number }) - distanceM(model.stop, b.place as { lon: number; lat: number }) : 0);
  }

  /** The one place worth naming on a day with nothing on: the nearest culture
   *  or heritage place, credited to the source that published it. */
  function quietDay(model: InvitationModel, panel: FrontPanel): void {
    if (!model.city) return;
    const ref = model.stop ?? { lon: 15.97726, lat: 45.81286 };
    const place = model.city.places.filter(p => ['culture', 'heritage'].includes(p.category) && located(p))
      .sort((a, b) => distanceM(ref, { lon: a.lon!, lat: a.lat! }) - distanceM(ref, { lon: b.lon!, lat: b.lat! }))[0];
    if (!place) return;
    panel.kicker = ct(i18n, 'quiet');
    panel.meta = undefined;
    panel.note = undefined;
    panel.rows = [{ key: place.id, title: place.name, sub: place.description?.slice(0, 160) ?? place.address }];
    panel.credit = model.city.manifest?.sources.find(s => s.id === place.sourceId)?.name ?? place.sourceId;
  }

  function paint(model: InvitationModel): void {
    // The venues are read first: the events card asks the panel builder for
    // enough dated rows to fill the measured room even after the venues' own
    // events are struck from it (front.ts eventCardRows).
    const venues = activeNearby(model);
    const ownEvents = venues.slice(0, rowBudget).reduce((sum, venue) => sum + venue.count, 0);
    const built = frontPanels({
      modules: model.modules, stop: model.stop, now: model.now, lastRun: model.lastRun, strings: s, i18n, locale,
      lightweight, composition: model.composition, prometMode: 'exceptions', eventRows: rowBudget + ownEvents, prometLines: lineBudget,
    });
    if (venues.length) {
      built.tonight.rows = eventCardRows(venues, built.tonight.rows, rowBudget);
      built.tonight.meta = ct(i18n, 'week');
      built.tonight.note = undefined;
    }
    if (!built.tonight.rows.length) quietDay(model, built.tonight);
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
    // The two budgets feed each other -- a line the promet card gives up is a
    // row the events card gains -- so the measurement is settled rather than
    // read once. Three passes are more than enough; it usually takes one.
    for (let pass = 0; pass < 3; pass += 1) {
      const next = measureBudgets();
      measured = next;
      if (!next || (next.rows === rowBudget && next.lines === lineBudget)) break;
      rowBudget = next.rows;
      lineBudget = next.lines;
      paint(lastModel);
      markOverflow();
    }
  }

  // A cold screen paints in the fallback face; the web font arriving changes every wrap, so the panels are fitted once more when the fonts are ready (never on a timer).
  const fonts = (document as { fonts?: { ready?: Promise<unknown> } }).fonts;
  void fonts?.ready?.then(() => { if (!disposed) fit(); });

  return {
    element,
    get mapHost() { return field.mapHost; },
    update(model) {
      lastModel = model;
      if (measured === null) { rowBudget = SEED_EVENT_ROWS[model.composition]; lineBudget = EXCEPTION_LINES[model.composition]; }
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
