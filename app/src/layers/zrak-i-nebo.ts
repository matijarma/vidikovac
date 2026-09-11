// Zrak i nebo: quakes near the city with a mini map, the warning state, today's
// forecast and the sun times computed on the device (no request leaves for them).
import { zagrebDateTime, zagrebTime } from '../format';
import { createLayerSection, createPanel, dataNumber, listMarkup } from '../panels/panel';
import { escapeHtml } from '../ui/dom/escape';
import { sunTimes } from '../ui/solar';
import { capWarningRow } from './shared';
import type { LayerContext } from './types';

export function renderZrakINebo(ctx: LayerContext): HTMLElement {
  const { i18n, snapshots, now } = ctx;
  const { section, panels } = createLayerSection('zrak-i-nebo', i18n.t('layers.zrak-i-nebo'));

  const emsc = snapshots.emsc;
  const quakePoints = (emsc?.items ?? [])
    .filter((q) => q.geo?.type === 'Point')
    .map((q) => {
      const [lon, lat] = q.geo!.coordinates as number[];
      return { id: q.id, lon: lon!, lat: lat!, title: `${q.title} M ${dataNumber(q, 'mag') ?? '–'}` };
    });

  const quakeBody = document.createElement('div');
  quakeBody.className = 'map-holder';
  if (ctx.mapFactory) {
    const container = document.createElement('div');
    container.className = 'map-canvas map-canvas-mini';
    quakeBody.appendChild(container);
    ctx.mapFactory({
      container,
      ariaLabel: `${i18n.t('panels.map')}: ${i18n.t('panels.quakes')}`,
      points: quakePoints,
      lines: [],
      reducedMotion: ctx.reducedMotion,
    });
  }
  const list = document.createElement('div');
  list.innerHTML = listMarkup(
    (emsc?.items ?? []).map(
      (q) => `<span data-testid="quake-row"><strong>${escapeHtml(i18n.t('panels.quakeMag', { mag: dataNumber(q, 'mag') ?? '–' }))}</strong> · ${escapeHtml(q.title)}<span class="panel-sub"> ${escapeHtml(i18n.t('panels.quakeDepth', { depth: dataNumber(q, 'depth') ?? '–' }))} · ${escapeHtml(zagrebDateTime(q.at))}</span></span>`,
    ),
    i18n.t('panels.quakeNone'),
  );
  quakeBody.appendChild(list);
  panels.appendChild(
    createPanel({
      i18n, now, id: 'zrak-i-nebo-quakes', title: i18n.t('panels.quakes'), snapshot: emsc, body: quakeBody,
      onCopy: ctx.onCopy,
      copyText: (emsc?.items ?? []).map((q) => `M ${dataNumber(q, 'mag') ?? '–'} ${q.title} ${zagrebDateTime(q.at)}`).join('\n') || undefined,
    }).element,
  );

  const cap = snapshots['dhmz-cap'];
  panels.appendChild(
    createPanel({
      i18n, now, id: 'zrak-i-nebo-cap', title: i18n.t('panels.cap'), snapshot: cap,
      body: listMarkup((cap?.items ?? []).map((w) => capWarningRow(w, i18n)), i18n.t('panels.capNone')),
    }).element,
  );

  const forecast = snapshots['dhmz-forecast'];
  const f = forecast?.items[0];
  panels.appendChild(
    createPanel({
      i18n, now, id: 'zrak-i-nebo-forecast', title: i18n.t('panels.forecast'), snapshot: forecast,
      body: f
        ? `<p class="big-number">${escapeHtml(i18n.t('panels.tminTmax', { min: dataNumber(f, 'tmin') ?? '–', max: dataNumber(f, 'tmax') ?? '–' }))}</p><p class="panel-sub">${escapeHtml(f.summary ?? '')}</p>`
        : `<p class="panel-empty">${escapeHtml(i18n.t(forecast ? 'status.empty' : 'status.loading'))}</p>`,
    }).element,
  );

  const sun = sunTimes(new Date(now));
  panels.appendChild(
    createPanel({
      i18n, now, id: 'zrak-i-nebo-sun', title: i18n.t('panels.sun'), freshness: 'danas',
      body: `<ul class="panel-facts">
          <li>${escapeHtml(i18n.t('panels.sunrise', { time: zagrebTime(sun.sunrise) }))}</li>
          <li>${escapeHtml(i18n.t('panels.sunset', { time: zagrebTime(sun.sunset) }))}</li>
        </ul>
        <p class="panel-sub">${escapeHtml(i18n.t('panels.sunComputed'))}</p>`,
    }).element,
  );

  return section;
}
