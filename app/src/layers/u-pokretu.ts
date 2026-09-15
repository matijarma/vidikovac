// U pokretu: the transport workspace -- one map with the motion model's
// vehicles as numbered pills, the route network and named stops, the
// closures, and beside it one sheet of search, running routes and detail
// (transport/workspace.ts). The renderer runs on every poll and returns a
// fresh section; the workspace element inside it is the page's one
// persistent controller, moved in each time, so a poll never throws away
// the camera, the selection, the search text or the focus. The lightweight
// path (R-L2) renders no map, no stage and no geometry, and reads like the
// sheet: a search field, "Linije u pokretu" as a board of signage rows, the
// page's schematic host with its own honest list, the closures and ZET's
// notices; its folds and its search go through the page's view filters
// (dashboard.ts's `filter` action and input delegation), since no workspace
// handler exists on this path.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { routeName } from '../data/routes';
import { searchField } from '../experience/blocks';
import type { I18n } from '../i18n/i18n';
import type { MapLine, MapPoint } from '../map/city-map';
import { routeDelayMap, vehicleFixes } from '../motion/fixes';
import type { Fix } from '../motion/model';
import { createLayerSection, dataNumber, dataText, statusText } from '../panels/panel';
import { routeEntry } from '../transport/catalogue';
import { closureItems, plausibleDelays, zetNotices } from '../transport/detail';
import { searchTransport } from '../transport/search';
import { tr, trPlural } from '../transport/strings';
import { badge, button, closuresMarkup, delayTrail, kindWord, NOTICE_ROWS, RUNNING_ROWS, vehicleCountGlyph } from '../transport/view';
import { workspaceFor } from '../transport/workspace';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { summariseRoutes } from './route-summary';
import { plausibleRouteDelay } from './shared';
import type { LayerContext } from './types';

export interface RouteDelay {
  routeId: string;
  /** Trips the module saw on this route. */
  count: number;
  /** Median delay in whole seconds; negative means early. */
  meanDelay: number;
}

/**
 * The module already publishes one summary row per route (kind 'vehicle',
 * id 'route:<routeId>', R-22): a median over that route's stop-time updates,
 * which is the honest figure. Re-averaging the pins here would be arithmetic
 * over data the pins do not carry.
 */
export function routeDelays(snapshot: ModuleSnapshot | undefined): RouteDelay[] {
  return (snapshot?.items ?? [])
    .filter((item) => item.id.startsWith('route:'))
    .map((item) => ({
      routeId: dataText(item, 'routeId'),
      count: dataNumber(item, 'vehicles') ?? 0,
      meanDelay: dataNumber(item, 'medianDelaySeconds'),
    }))
    .filter((row): row is RouteDelay => row.routeId !== '' && plausibleRouteDelay(row.meanDelay))
    .sort((a, b) => Math.abs(b.meanDelay) - Math.abs(a.meanDelay) || a.routeId.localeCompare(b.routeId, 'hr'));
}

/**
 * The zet-rt pins as the map's points: each one a dated vehicle report
 * (motion/fixes.ts's own dating: the pin's own `at`, else the snapshot's
 * source time, else its fetch time), so the map's motion model treats it as
 * evidence and never as a place to draw (R-P2). The title is the line name
 * the map's accessible label would say.
 */
export function vehiclePoints(snapshot: ModuleSnapshot | undefined, now: number): MapPoint[] {
  const titles = new Map<string, string>();
  for (const item of snapshot?.items ?? []) titles.set(item.id, item.title);
  return vehicleFixes(snapshot, now).map((fix) => ({ ...fix, title: routeName(fix.routeId || titles.get(fix.id) || '') }));
}

export function closureLines(snapshot: ModuleSnapshot | undefined): MapLine[] {
  return (snapshot?.items ?? [])
    .filter((i) => i.kind === 'closure' && i.geo?.type === 'LineString')
    .map((i) => ({ id: i.id, title: i.title, coordinates: i.geo!.coordinates as [number, number][] }));
}

export function renderUPokretu(ctx: LayerContext): HTMLElement {
  const { i18n, snapshots, now } = ctx;
  const { section, panels } = createLayerSection('u-pokretu', i18n.t('layers.u-pokretu'));
  // The page's reconciler (ui/dom/reconcile.ts) may morph this section in
  // place instead of replacing it: the workspace below is never detached by
  // an ordinary poll, so its input, focus, scroll, camera and follow survive.
  section.setAttribute('data-reconcile', '');
  const zet = snapshots['zet-rt'];
  const closures = snapshots.prometnice;
  if (ctx.lightweight) {
    panels.appendChild(renderLightweight(ctx, zet, closures));
    return section;
  }
  const workspace = workspaceFor(ctx);
  workspace.render({ ctx, points: vehiclePoints(zet, now), lines: closureLines(closures) });
  panels.appendChild(persistSlot(workspace.element));
  return section;
}

const PERSIST_TAG = 'kaj-persist';

/**
 * The placeholder that stands for the live workspace in a freshly rendered
 * section. A host that reconciles (dashboard.ts through ui/dom/reconcile.ts)
 * reads `data-persist-for` and keeps the live element where it is, so the
 * element is never detached and the placeholder is never inserted. Any other
 * host (a replaceChildren stage, a unit test) inserts the placeholder, which
 * then swaps the live element into its own place the moment it is connected.
 * Either way the workspace element is one node for the page's life.
 */
interface PersistSlotElement extends HTMLElement {
  live: HTMLElement | null;
}

/** Defined on first use, never at import: a node test that imports this layer has no HTMLElement to extend. */
function definePersistSlot(): boolean {
  if (typeof customElements === 'undefined' || typeof HTMLElement === 'undefined') return false;
  if (!customElements.get(PERSIST_TAG)) {
    customElements.define(PERSIST_TAG, class extends HTMLElement implements PersistSlotElement {
      live: HTMLElement | null = null;
      connectedCallback(): void {
        if (this.live && this.isConnected) this.replaceWith(this.live);
      }
    });
  }
  return true;
}

/** The live element itself while it is not in the document (first mount, a return to the layer, a detached render); the slot only while a poll must leave it where it is. */
function persistSlot(live: HTMLElement): HTMLElement {
  if (!live.isConnected || !definePersistSlot()) return live;
  const slot = document.createElement(PERSIST_TAG) as PersistSlotElement;
  slot.live = live;
  slot.setAttribute('data-persist-for', live.id);
  return slot;
}

/** The view filters the lightweight face reads: its search text and its two folds ('all' when open). */
const LIGHT_FILTER = { query: 'q', routes: 'routes', closures: 'closures' } as const;

/** The fold under a lightweight list: the page's own `filter` action opens or closes it, so no handler is needed here. */
function lightFold(i18n: I18n, key: string, open: boolean, moreLabel: string, controls: string): string {
  return button({ action: 'filter', id: `t-fold-${key}`, label: open ? tr(i18n, 'collapse') : moreLabel, className: 'btn-ghost t-action t-fold', data: { 'filter-key': key, 'filter-value': open ? '' : 'all' }, expanded: open, controls });
}

/**
 * signRow (experience/blocks.ts) escapes its `sub` column by design -- a row's second line is plain text there --
 * but this row's sub carries the vehicle glyph's markup, so the row is built here directly, in the exact shape
 * signRow produces (`.row` > lead, `.row-main` > `.row-title`/`.row-sub`, trail), rather than changing a component
 * this task does not own.
 */
function lightRouteRow(lead: string, title: string, sub: string, trail: string, key: string, hidden: boolean): string {
  return `<li class="row"${hidden ? ' hidden' : ''} data-key="${escapeAttribute(key)}">${lead}<span class="row-main"><span class="row-title">${escapeHtml(title)}</span>${sub ? `<span class="row-sub">${sub}</span>` : ''}</span>${trail}</li>`;
}

/**
 * "Linije u pokretu" as a board: one static row per route with a vehicle moving now (summariseRoutes, the helper the
 * kiosk board reads too, so the two boards can never disagree), trams first, with the small badge, the destination, the
 * count and the delay word in its tone; eight rows, then "još N linija". A query keeps the rows the sheet's own search
 * would find (searchTransport over the running routes' catalogue entries), never a stop: this path has no catalogue.
 */
function lightBoard(ctx: LayerContext, zet: ModuleSnapshot | undefined, fixes: readonly Fix[], delays: ReadonlyMap<string, number>, query: string, open: boolean): string {
  const { i18n, now } = ctx;
  const head = `<h3 class="t-head">${escapeHtml(tr(i18n, 'runningRoutes'))}</h3>`;
  const block = (body: string): string => `<section class="t-block">${head}${body}</section>`;
  if (!zet) return block(`<p class="t-empty">${escapeHtml(i18n.t('status.loading'))}</p>`);
  const status = zet.status !== 'live' ? `<p class="t-status" data-testid="transport-source-status">${escapeHtml(statusText(zet, i18n, now))}</p>` : '';
  const vehicles = fixes.flatMap((fix) => {
    if (fix.routeId === undefined) return [];
    const route = routeEntry(fix.routeId);
    return [{ routeId: fix.routeId, label: route.short, type: route.type === -1 ? (fix.type ?? -1) : route.type }];
  });
  let rows = summariseRoutes(vehicles, delays, i18n).map((row) => (delays.has(row.routeId) ? row : { ...row, word: '' }));
  if (query) {
    const hits = searchTransport(query, rows.map((row) => routeEntry(row.routeId)), [], { routes: rows.length, stops: 0 }).routes;
    const order = new Map(hits.map((hit, i) => [hit.id, i]));
    rows = rows.filter((row) => order.has(row.routeId)).sort((a, b) => order.get(a.routeId)! - order.get(b.routeId)!);
  }
  if (rows.length === 0) {
    const empty = query ? `<p class="t-empty" data-testid="transport-no-results">${escapeHtml(tr(i18n, 'lightNoResults', { query }))}</p>` : `<p class="t-empty" data-testid="transport-none-running">${escapeHtml(tr(i18n, 'noRunning'))}</p>`;
    return block(status + empty);
  }
  const items = rows
    .map((row, i) => {
      const route = routeEntry(row.routeId);
      return lightRouteRow(
        badge(row.label, row.type, 's'),
        route.long || kindWord(i18n, row.type),
        vehicleCountGlyph(i18n, row.type, row.count),
        delayTrail(i18n, delays.get(row.routeId)),
        row.routeId,
        i >= RUNNING_ROWS && !open,
      );
    })
    .join('');
  const folded = rows.length - RUNNING_ROWS;
  const fold = folded > 0 ? lightFold(i18n, LIGHT_FILTER.routes, open, i18n.t('panels.moreRoutes', { count: folded }), 't-list-routes') : '';
  const total = `<p class="t-lead" data-testid="transport-total">${escapeHtml(trPlural(i18n, 'vehiclesNow', fixes.length))}</p>`;
  return block(`${status}${total}<ul class="t-list" id="t-list-routes" data-testid="running-routes">${items}</ul>${fold}`);
}

/** R-L2: no map, no stage, no geometry fetch. The search field first, the board, the schematic host's own list, the closures and the notices. */
function renderLightweight(ctx: LayerContext, zet: ModuleSnapshot | undefined, closures: ModuleSnapshot | undefined): HTMLElement {
  const { i18n, now } = ctx;
  const filters = ctx.view?.filters ?? {};
  const query = filters[LIGHT_FILTER.query] ?? '';
  const wrap = document.createElement('div');
  wrap.className = 'transport t-light';
  wrap.dataset.testid = 'transport-light';
  const fixes = vehicleFixes(zet, now);
  wrap.innerHTML =
    searchField({ id: 'u-pokretu-light-search', key: LIGHT_FILTER.query, label: tr(i18n, 'lightSearchLabel'), placeholder: tr(i18n, 'lightSearch'), value: query }) +
    lightBoard(ctx, zet, fixes, plausibleDelays(routeDelayMap(zet)), query, filters[LIGHT_FILTER.routes] === 'all');
  const schematic = ctx.schematic;
  if (schematic) {
    // R-F8: the snapshot itself rides along, so the list prints the honest
    // stale/down sentence during an outage instead of an empty list.
    schematic.update({ fixes, delays: routeDelayMap(zet), snapshot: zet }, now);
    const block = document.createElement('section');
    block.className = 't-block';
    block.innerHTML = `<h3 class="t-head">${escapeHtml(i18n.t('motion.vehicleList'))}</h3>`;
    block.appendChild(schematic.mount());
    wrap.appendChild(block);
  }
  // The closures (four, then "sve zatvaranja (n)" through the page filter) and ZET's notices, as two blocks beside the others.
  const items = closureItems(closures);
  const closuresOpen = filters[LIGHT_FILTER.closures] === 'all';
  const sourceStatus = closures && closures.status !== 'live' ? statusText(closures, i18n, now) : null;
  const more = lightFold(i18n, LIGHT_FILTER.closures, closuresOpen, tr(i18n, 'allClosures', { count: items.length }), 't-list-closures');
  wrap.insertAdjacentHTML('beforeend', closuresMarkup(i18n, items, zetNotices(ctx.snapshots.dogadanja, NOTICE_ROWS), sourceStatus, null, false, closuresOpen, more));
  // The honesty sentence exactly once on the face: the schematic host carries it under its list (motion/schematic-host.ts,
  // R-P2, verbatim); a page without a host still says it, here.
  if (!schematic) {
    const note = document.createElement('p');
    note.className = 't-sheet-note';
    note.dataset.testid = 'transport-note';
    note.textContent = i18n.t('motion.note');
    wrap.appendChild(note);
  }
  return wrap;
}
