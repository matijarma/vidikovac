// U pokretu: where the trams and buses are, which streets are shut, and how late
// each route is running right now.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { routeName } from '../data/routes';
import type { MapLine, MapPoint } from '../map/city-map';
import { routeDelayMap, vehicleFixes } from '../motion/fixes';
import { createLayerSection, createPanel, dataNumber, dataText, listMarkup } from '../panels/panel';
import { escapeHtml } from '../ui/dom/escape';
import { closureRow, delayWord } from './shared';
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
      meanDelay: dataNumber(item, 'medianDelaySeconds') ?? 0,
    }))
    .filter((row) => row.routeId !== '')
    .sort((a, b) => Math.abs(b.meanDelay) - Math.abs(a.meanDelay) || a.routeId.localeCompare(b.routeId, 'hr'));
}

/**
 * The zet-rt pins as the full map's points: each one a dated vehicle report
 * (motion/fixes.ts's own dating: the pin's own `at`, else the snapshot's source
 * time, else its fetch time), so the map's motion model treats it as
 * evidence and never as a place to draw (R-P2, T10). The title is the line
 * name the map's accessible label and any future card would say.
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
  const zet = snapshots['zet-rt'];
  const closures = snapshots.prometnice;
  const points = vehiclePoints(zet, now);
  const lines = closureLines(closures);

  // T9: the moving map first -- the layer's face. The page owns the host;
  // this render only moves its stable element into a fresh panel and hands
  // it this poll's evidence (the pins as fixes, the route rows as delays).
  // Every drawn position is the model's own (R-P2); the host's note under
  // the map says so in one sentence.
  const schematic = ctx.schematic;
  if (schematic) {
    schematic.update({ fixes: vehicleFixes(zet, now), delays: routeDelayMap(zet) }, now);
    panels.appendChild(
      createPanel({ i18n, now, id: 'u-pokretu-schematic', title: i18n.t('panels.schematic'), snapshot: zet, body: schematic.mount() }).element,
    );
  }

  // T10: the full MapLibre map. Not rendered at all in lightweight mode
  // (R-L2: no panel, no fallback line, no button -- the schematic's list
  // above is the honest face); elsewhere one live map per page (R-54) fed
  // the dated reports as evidence, plus the full-screen button when the
  // page owns a view mode.
  if (!ctx.lightweight) {
    const mapBody = document.createElement('div');
    mapBody.className = 'map-holder';
    const canvas = ctx.maps?.slot({
      id: 'u-pokretu-map',
      className: 'map-canvas',
      testid: 'map-canvas',
      ariaLabel: `${i18n.t('panels.map')}: ${i18n.t('panels.vehiclesCount', { count: points.length })}, ${i18n.t('panels.closuresCount', { count: lines.length })}`,
      points,
      lines,
      reducedMotion: ctx.reducedMotion,
    });
    if (canvas) {
      mapBody.appendChild(canvas);
      const mapView = ctx.mapView;
      if (mapView) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'btn-ghost map-full-toggle';
        // A stable id: the dashboard re-renders on toggle and hands focus
        // back to the element with this id.
        toggle.id = 'u-pokretu-map-full';
        toggle.dataset.testid = 'map-full-toggle';
        toggle.textContent = i18n.t(mapView.full ? 'panels.mapCollapse' : 'panels.mapExpand');
        toggle.addEventListener('click', () => mapView.toggle());
        mapBody.appendChild(toggle);
      }
    } else {
      const fallback = document.createElement('p');
      fallback.className = 'panel-empty';
      fallback.dataset.testid = 'map-fallback';
      fallback.textContent = i18n.t('panels.mapUnavailable');
      mapBody.appendChild(fallback);
    }
    panels.appendChild(
      createPanel({ i18n, now, id: 'u-pokretu-map', title: i18n.t('panels.map'), snapshot: zet, body: mapBody }).element,
    );
  }

  const delays = routeDelays(zet);
  const delayRows = delays.map((row) => {
    const label = delayWord(i18n, row.meanDelay);
    return `<span data-testid="delay-row"><strong>${escapeHtml(routeName(row.routeId))}</strong><span class="panel-sub"> ${escapeHtml(label)} · ${escapeHtml(i18n.t('panels.vehiclesCount', { count: row.count }))}</span></span>`;
  });
  panels.appendChild(
    createPanel({
      i18n, now, id: 'u-pokretu-delays', title: i18n.t('panels.delays'), snapshot: zet,
      body: listMarkup(delayRows, i18n.t('status.empty')),
      onCopy: ctx.onCopy,
      copyText: delays.length > 0 ? delays.map((d) => `${routeName(d.routeId)}: ${d.meanDelay} s`).join('\n') : undefined,
    }).element,
  );

  panels.appendChild(
    createPanel({
      i18n, now, id: 'u-pokretu-closures', title: i18n.t('panels.closures'), snapshot: closures,
      body: listMarkup((closures?.items ?? []).map((c) => closureRow(c, i18n)), i18n.t('status.empty')),
      extraActions: ctx.onExport
        ? [
            { id: 'geojson', label: i18n.t('export.geojson'), run: () => ctx.onExport?.('geojson', 'prometnice') },
            { id: 'ics', label: i18n.t('export.ics'), run: () => ctx.onExport?.('ics', 'prometnice') },
          ]
        : undefined,
    }).element,
  );

  return section;
}
