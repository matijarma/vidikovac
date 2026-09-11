// U pokretu: where the trams and buses are, which streets are shut, and how late
// each route is running right now.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { routeName } from '../data/routes';
import type { MapLine, MapPoint } from '../map/city-map';
import { createLayerSection, createPanel, dataNumber, dataText, listMarkup } from '../panels/panel';
import { escapeHtml } from '../ui/dom/escape';
import { closureRow } from './shared';
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

export function vehiclePoints(snapshot: ModuleSnapshot | undefined): MapPoint[] {
  return (snapshot?.items ?? [])
    .filter((i) => i.id.startsWith('vehicle:') && i.geo?.type === 'Point')
    .map((i) => {
      const [lon, lat] = i.geo!.coordinates as number[];
      return { id: i.id, lon: lon!, lat: lat!, title: routeName(dataText(i, 'routeId') || i.title), routeId: dataText(i, 'routeId') };
    });
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
  const points = vehiclePoints(zet);
  const lines = closureLines(closures);

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

  const delays = routeDelays(zet);
  const delayRows = delays.map((row) => {
    const label =
      row.meanDelay >= -15 && row.meanDelay <= 15
        ? i18n.t('panels.delayOnTime')
        : row.meanDelay > 0
          ? i18n.t('panels.delayLate', { seconds: row.meanDelay })
          : i18n.t('panels.delayEarly', { seconds: Math.abs(row.meanDelay) });
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
