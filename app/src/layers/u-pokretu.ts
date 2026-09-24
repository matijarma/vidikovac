// U pokretu: the transport workspace -- one map with the motion model's
// vehicles as numbered pills, the route network and named stops, the
// closures, and beside it one sheet of search, running routes and detail
// (transport/workspace.ts). The renderer runs on every poll and returns a
// fresh section; the workspace element inside it is the page's one
// persistent controller, moved in each time, so a poll never throws away
// the camera, the selection, the search text or the focus. The lightweight
// path (R-L2) renders the same workspace: the page hands it map slots without
// a factory (dashboard.ts), so the sheet stands with no map, no stage and no
// geometry fetch.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { routeName } from '../data/routes';
import type { MapLine, MapPoint } from '../map/city-map';
import { vehicleFixes } from '../motion/fixes';
import { createLayerSection, dataNumber, dataText } from '../panels/panel';
import { workspaceFor } from '../transport/workspace';
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
  const workspace = workspaceFor(ctx);
  workspace.render({ ctx, points: vehiclePoints(snapshots['zet-rt'], now), lines: closureLines(snapshots.prometnice) });
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
export function persistSlot(live: HTMLElement): HTMLElement {
  if (!live.isConnected || !definePersistSlot()) return live;
  const slot = document.createElement(PERSIST_TAG) as PersistSlotElement;
  slot.live = live;
  slot.setAttribute('data-persist-for', live.id);
  return slot;
}
