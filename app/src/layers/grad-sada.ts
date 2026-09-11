// Grad sada: the one-glance layer. Clock, Maksimir observation, today's forecast,
// the CAP state for HR002, how many ZET vehicles are moving and how many streets
// are closed.
import { escapeHtml } from '../ui/dom/escape';
import { zagrebTime } from '../format';
import {
  createLayerSection,
  createPanel,
  dataNumber,
  dataText,
  listMarkup,
} from '../panels/panel';
import type { LayerContext } from './types';

export function renderGradSada(ctx: LayerContext): HTMLElement {
  const { i18n, snapshots, now } = ctx;
  const { section, panels } = createLayerSection('grad-sada', i18n.t('layers.grad-sada'));
  const actions = ctx.kiosk ? {} : { onCopy: ctx.onCopy };

  panels.appendChild(
    createPanel({
      i18n, now, id: 'grad-sada-clock', title: i18n.t('panels.clock'), freshness: 'zivo',
      body: `<p class="big-number" data-testid="clock">${escapeHtml(zagrebTime(now))}</p>`,
    }).element,
  );

  const observation = snapshots['dhmz-now'];
  const o = observation?.items[0];
  const temp = dataNumber(o, 'temp');
  const obsBody = o
    ? `<p class="big-number" data-testid="temp">${escapeHtml(temp === null ? i18n.t('common.unavailable') : i18n.t('panels.temperature', { value: temp }))}</p>
       <p class="panel-sub">${escapeHtml([o.title, dataText(o, 'weather')].filter(Boolean).join(' · '))}</p>
       <ul class="panel-facts">
         <li>${escapeHtml(i18n.t('panels.humidity', { value: dataNumber(o, 'humidity') ?? '–' }))}</li>
         <li>${escapeHtml(i18n.t('panels.pressure', { value: dataNumber(o, 'pressure') ?? '–' }))}</li>
         <li>${escapeHtml(i18n.t('panels.wind', { dir: dataText(o, 'windDir') || '–', speed: dataNumber(o, 'windSpeed') ?? '–' }))}</li>
       </ul>`
    : `<p class="panel-empty">${escapeHtml(i18n.t(observation ? 'status.empty' : 'status.loading'))}</p>`;
  panels.appendChild(
    createPanel({
      i18n, now, id: 'grad-sada-observation', title: i18n.t('panels.observation'),
      snapshot: observation, body: obsBody, ...actions,
      copyText: o ? `${o.title}: ${temp ?? '–'} °C, ${dataText(o, 'weather')}` : undefined,
    }).element,
  );

  const forecast = snapshots['dhmz-forecast'];
  const f = forecast?.items[0];
  const fcBody = f
    ? `<p class="big-number">${escapeHtml(i18n.t('panels.tminTmax', { min: dataNumber(f, 'tmin') ?? '–', max: dataNumber(f, 'tmax') ?? '–' }))}</p>
       <p class="panel-sub">${escapeHtml(f.summary ?? '')}</p>`
    : `<p class="panel-empty">${escapeHtml(i18n.t(forecast ? 'status.empty' : 'status.loading'))}</p>`;
  panels.appendChild(
    createPanel({
      i18n, now, id: 'grad-sada-forecast', title: i18n.t('panels.forecast'),
      snapshot: forecast, body: fcBody, ...actions,
      copyText: f ? `${i18n.t('panels.forecast')}: ${f.summary ?? ''}` : undefined,
    }).element,
  );

  const cap = snapshots['dhmz-cap'];
  const warnings = (cap?.items ?? []).map(
    (w) =>
      `<strong>${escapeHtml(i18n.t(`panels.severity.${w.severity ?? 'info'}`))}</strong> · ${escapeHtml(w.title)}<span class="panel-sub"> ${escapeHtml(i18n.t('panels.until', { time: zagrebTime(w.until) }))}</span>`,
  );
  panels.appendChild(
    createPanel({
      i18n, now, id: 'grad-sada-cap', title: i18n.t('panels.cap'), snapshot: cap,
      body: cap ? listMarkup(warnings, i18n.t('panels.capNone')) : `<p class="panel-empty">${escapeHtml(i18n.t('status.loading'))}</p>`,
      ...actions,
      copyText: cap && cap.items.length > 0 ? cap.items.map((w) => `${i18n.t(`panels.severity.${w.severity ?? 'info'}`)}: ${w.title}`).join('\n') : undefined,
    }).element,
  );

  const zet = snapshots['zet-rt'];
  const vehicles = (zet?.items ?? []).filter((i) => i.kind === 'vehicle').length;
  panels.appendChild(
    createPanel({
      i18n, now, id: 'grad-sada-vehicles', title: i18n.t('panels.vehicles'), snapshot: zet,
      body: zet
        ? `<p class="big-number" data-testid="vehicle-count">${escapeHtml(i18n.t('panels.vehiclesCount', { count: vehicles }))}</p>`
        : `<p class="panel-empty">${escapeHtml(i18n.t('status.loading'))}</p>`,
    }).element,
  );

  const closures = snapshots.prometnice;
  const closureCount = (closures?.items ?? []).filter((i) => i.kind === 'closure').length;
  panels.appendChild(
    createPanel({
      i18n, now, id: 'grad-sada-closures', title: i18n.t('panels.closures'), snapshot: closures,
      body: closures
        ? `<p class="big-number" data-testid="closure-count">${escapeHtml(i18n.t('panels.closuresCount', { count: closureCount }))}</p>`
        : `<p class="panel-empty">${escapeHtml(i18n.t('status.loading'))}</p>`,
    }).element,
  );

  return section;
}
