// Vrijeme: the actual Maksimir observation, today's forecast range with the
// measured value placed on it, wind and humidity as read, the sun path
// computed on the device, DHMZ warnings, and the week's quakes placed by
// their own distance and bearing. No hourly curve: DHMZ publishes none.
import type { FeedItem } from '../../../worker/feed/schema';
import { externalLink, section, sectionHead } from '../experience/blocks';
import { isActiveWarning } from '../experience/safety-state';
import { attributionFoot, listState, stateBlock, unconfirmed } from '../experience/status';
import { bearingDeg, compassWord, conditionText, distanceKm, numberText, pointOf, relativeTime, windBearing, ZAGREB_LON_LAT } from '../experience/text';
import { zagrebDateTime, zagrebTime, zagrebWeekdayDate } from '../format';
import type { I18n } from '../i18n/i18n';
import { dataNumber, dataText } from '../panels/panel';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { arcGauge, bars, compass, radar, rangeBar, sunPath } from '../ui/graphics';
import { iconMarkup } from '../ui/icons';
import { sunTimes } from '../ui/solar';
import type { LayerContext } from './types';

const QUAKE_RADIUS_KM = 150;
const QUAKE_WINDOW_MS = 7 * 86_400_000;
const MAGNITUDE_SCALE = 6;

function loadingOrDown(i18n: I18n, ctx: LayerContext, module: 'dhmz-now' | 'dhmz-forecast' | 'dhmz-cap' | 'emsc'): string {
  const error = ctx.errors?.[module];
  return stateBlock(i18n, error ? 'down' : 'loading', i18n.t(error ? 'status.unknown' : 'status.loading'), error ? { retry: module } : {});
}

function nowSection(i18n: I18n, ctx: LayerContext): string {
  const observation = ctx.snapshots['dhmz-now'];
  const o = observation?.items[0];
  const temp = dataNumber(o, 'temp');
  let body: string;
  if (!observation) body = loadingOrDown(i18n, ctx, 'dhmz-now');
  else if (!o || temp === null) body = listState(i18n, observation, 'dhmz-now', 0, i18n.t('status.empty'), ctx.errors?.['dhmz-now']);
  else {
    const windDir = dataText(o, 'windDir');
    const windSpeed = dataNumber(o, 'windSpeed');
    const calm = windSpeed === 0 || windSpeed === null;
    const bearing = calm ? null : windBearing(windDir);
    const humidity = dataNumber(o, 'humidity');
    const pressure = dataNumber(o, 'pressure');
    const letters: [string, string, string, string] = i18n.getLocale() === 'en' ? ['N', 'E', 'S', 'W'] : ['S', 'I', 'J', 'Z'];
    // Calm only when the station reads zero; an unrecognised direction still shows the reading as given.
    const windText = windSpeed === null ? '' : calm ? i18n.t('weather.windCalm') : i18n.t('weather.windValue', { dir: bearing === null ? windDir : compassWord(i18n, bearing), speed: numberText(i18n, windSpeed, 1) });
    const figures = [
      windSpeed !== null ? `<div class="wx-figure"><p class="kicker">${escapeHtml(i18n.t('weather.wind'))}</p>${compass({ bearing, value: numberText(i18n, windSpeed, 1), caption: calm ? i18n.t('weather.windCalm') : bearing === null ? windDir : compassWord(i18n, bearing), letters, label: windText })}<p class="meta" data-testid="wind-text">${escapeHtml(windText)}</p></div>` : '',
      humidity !== null ? `<div class="wx-figure"><p class="kicker">${escapeHtml(i18n.t('weather.humidity'))}</p>${arcGauge({ fraction: humidity / 100, value: `${numberText(i18n, humidity)} %`, caption: i18n.t('weather.humidity'), label: i18n.t('panels.humidity', { value: humidity }) })}</div>` : '',
      pressure !== null ? `<div class="wx-figure wx-fact"><p class="kicker">${escapeHtml(i18n.t('weather.pressure'))}</p><p class="wx-fact-value">${escapeHtml(numberText(i18n, pressure, 1))} hPa</p></div>` : '',
    ].join('');
    const condition = conditionText(dataText(o, 'weather'));
    body = `<div class="wx-now"><p class="wx-temp" data-testid="temp">${escapeHtml(i18n.t('panels.temperature', { value: numberText(i18n, temp, 1) }))}</p>${condition ? `<p class="wx-cond">${escapeHtml(condition)}</p>` : ''}<p class="meta">${escapeHtml(o.at ? i18n.t('weather.observedAt', { time: zagrebTime(o.at) }) : i18n.t('time.unknown'))} · ${escapeHtml(i18n.t('weather.station'))}</p></div><div class="wx-figures">${figures}</div>`;
  }
  return section({
    id: 'wx-now', tone: 'weather', className: 'wx-wide', testid: 'wx-now',
    body: sectionHead(i18n, { kicker: i18n.t('weather.now'), title: i18n.t('weather.station'), snapshot: observation, error: ctx.errors?.['dhmz-now'], id: 'wx-now-title' }) + body + attributionFoot(i18n, observation),
  });
}

function rangeSection(i18n: I18n, ctx: LayerContext): string {
  const forecast = ctx.snapshots['dhmz-forecast'];
  const f = forecast?.items[0];
  const tmin = dataNumber(f, 'tmin');
  const tmax = dataNumber(f, 'tmax');
  const temp = dataNumber(ctx.snapshots['dhmz-now']?.items[0], 'temp');
  let body: string;
  if (!forecast) body = loadingOrDown(i18n, ctx, 'dhmz-forecast');
  else if (!f || tmin === null || tmax === null) body = listState(i18n, forecast, 'dhmz-forecast', 0, i18n.t('status.empty'), ctx.errors?.['dhmz-forecast']);
  else {
    body = rangeBar({ min: tmin, max: tmax, now: temp, minLabel: `${numberText(i18n, tmin)}°`, maxLabel: `${numberText(i18n, tmax)}°`, nowLabel: temp === null ? undefined : `${numberText(i18n, temp, 1)}°`, label: i18n.t('weather.rangeValue', { min: tmin, max: tmax }) }) +
      `<p class="ov-lead" data-testid="forecast-range">${escapeHtml(i18n.t('weather.rangeValue', { min: numberText(i18n, tmin), max: numberText(i18n, tmax) }))}</p>` +
      (f.summary ? `<p class="wx-forecast-text">${escapeHtml(f.summary)}</p>` : '') +
      `<p class="sec-note">${escapeHtml(f.at ? i18n.t('weather.forecastFor', { date: zagrebWeekdayDate(f.at) }) : '')} ${escapeHtml(i18n.t('weather.rangeNote'))}</p>`;
  }
  return section({
    id: 'wx-range', tone: 'weather', testid: 'wx-range',
    body: sectionHead(i18n, { kicker: i18n.t('weather.forecast'), title: i18n.t('weather.range'), snapshot: forecast, error: ctx.errors?.['dhmz-forecast'], id: 'wx-range-title' }) + body + attributionFoot(i18n, forecast),
  });
}
function sunSection(i18n: I18n, ctx: LayerContext): string {
  const sun = sunTimes(new Date(ctx.now));
  const sunrise = sun.sunrise.getTime();
  const sunset = sun.sunset.getTime();
  const up = ctx.now >= sunrise && ctx.now < sunset;
  const minutes = Math.max(0, Math.round((sunset - sunrise) / 60_000));
  const duration = i18n.t('time.duration', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  const stateText = i18n.t(up ? 'weather.sunUp' : 'weather.sunDown');
  const figure = sunPath({
    sunrise, sunset, now: ctx.now,
    sunriseLabel: `${i18n.t('weather.sunrise')} ${zagrebTime(sunrise)}`,
    sunsetLabel: `${i18n.t('weather.sunset')} ${zagrebTime(sunset)}`,
    noonLabel: `${i18n.t('weather.noon')} ${zagrebTime(sun.transit)}`,
    label: `${stateText}. ${i18n.t('panels.sunrise', { time: zagrebTime(sunrise) })}, ${i18n.t('panels.sunset', { time: zagrebTime(sunset) })}.`,
  });
  return section({
    id: 'wx-sun', tone: 'weather', testid: 'wx-sun',
    body: sectionHead(i18n, { kicker: i18n.t('freshness.danas'), title: i18n.t('weather.sun'), id: 'wx-sun-title', noStatus: true }) + figure +
      `<p class="ov-lead" data-testid="sun-state">${escapeHtml(stateText)} · ${escapeHtml(i18n.t('weather.daylight', { duration }))}</p><p class="sec-note">${escapeHtml(i18n.t('weather.sunNote'))}</p>`,
  });
}

function severityBadge(i18n: I18n, item: FeedItem): string {
  const severity = item.severity ?? 'info';
  return `<span class="badge badge-sev" data-tone="${severity}">${escapeHtml(i18n.t(`panels.severity.${severity}`))}</span>`;
}

function warningRow(i18n: I18n, w: FeedItem, now: number): string {
  const active = isActiveWarning(w, now);
  const validity = w.at && w.until
    ? i18n.t('weather.validity', { from: zagrebDateTime(w.at), to: zagrebDateTime(w.until) })
    : w.until ? i18n.t('panels.until', { time: zagrebDateTime(w.until) }) : '';
  return `<li data-key="${escapeAttribute(w.id)}" data-testid="warning-row"><span class="row-main"><span class="row-title">${severityBadge(i18n, w)} ${escapeHtml(w.title)}</span><span class="row-meta">${escapeHtml(i18n.t(active ? 'weather.active' : 'weather.announced'))}${validity ? ` · ${escapeHtml(validity)}` : ''}</span>${w.summary ? `<span class="detail-summary">${escapeHtml(w.summary)}</span>` : ''}</span></li>`;
}

function warningsSection(i18n: I18n, ctx: LayerContext): string {
  const cap = ctx.snapshots['dhmz-cap'];
  const items = cap?.items ?? [];
  const state = !cap
    ? loadingOrDown(i18n, ctx, 'dhmz-cap')
    : items.length ? '' : unconfirmed(cap)
      ? stateBlock(i18n, 'unknown', i18n.t('weather.warningsUnknown'), { retry: 'dhmz-cap', testid: 'warnings-unknown' })
      : stateBlock(i18n, 'empty', i18n.t('weather.warningsNone'), { testid: 'warnings-none' });
  const list = state || `<ul class="rows-plain" role="list" data-testid="warnings">${items.map((w) => warningRow(i18n, w, ctx.now)).join('')}</ul>`;
  return section({
    id: 'wx-warnings', tone: 'urgency', testid: 'wx-warnings',
    body: sectionHead(i18n, { kicker: 'DHMZ', title: i18n.t('weather.warnings'), snapshot: cap, error: ctx.errors?.['dhmz-cap'], id: 'wx-warnings-title' }) + list + attributionFoot(i18n, cap),
  });
}
interface PlacedQuake { q: FeedItem; mag: number | null; km: number | null; bearing: number | null }

function placeQuakes(items: readonly FeedItem[]): PlacedQuake[] {
  return items.map((q) => {
    const p = pointOf(q);
    return {
      q, mag: dataNumber(q, 'mag'),
      km: p ? distanceKm(p[0], p[1], ZAGREB_LON_LAT[0], ZAGREB_LON_LAT[1]) : null,
      bearing: p ? bearingDeg(ZAGREB_LON_LAT[0], ZAGREB_LON_LAT[1], p[0], p[1]) : null,
    };
  });
}

function quakeRow(i18n: I18n, p: PlacedQuake): string {
  const depth = dataNumber(p.q, 'depth');
  const meta = [zagrebDateTime(p.q.at), p.km !== null ? i18n.t('weather.quakeDistance', { km: Math.round(p.km) }) : '', depth !== null ? i18n.t('panels.quakeDepth', { depth }) : ''].filter(Boolean).join(' · ');
  return `<li data-key="${escapeAttribute(p.q.id)}" data-testid="quake-row"><span class="row-main"><span class="row-title">${escapeHtml(i18n.t('panels.quakeMag', { mag: numberText(i18n, p.mag ?? 0, 1) }))} · ${escapeHtml(dataText(p.q, 'region') || p.q.title)}</span><span class="row-meta">${escapeHtml(meta)}</span></span></li>`;
}

function quakesSection(i18n: I18n, ctx: LayerContext): string {
  const emsc = ctx.snapshots.emsc;
  // The stated window and radius are the bounds shown; the query's own radius is slightly wider.
  const placed = placeQuakes((emsc?.items ?? []).filter((q) => q.at && ctx.now - Date.parse(q.at) <= QUAKE_WINDOW_MS))
    .filter((p) => p.km === null || p.km <= QUAKE_RADIUS_KM);
  let body = !emsc
    ? loadingOrDown(i18n, ctx, 'emsc')
    : placed.length ? '' : unconfirmed(emsc)
      ? stateBlock(i18n, 'unknown', i18n.t('weather.quakesUnknown'), { retry: 'emsc', testid: 'quakes-unknown' })
      : stateBlock(i18n, 'empty', i18n.t('weather.quakesNone'), { testid: 'quakes-none' });
  if (!body) {
    const located = placed.filter((p) => p.km !== null && p.bearing !== null);
    const figure = radar({
      points: located.map((p) => ({ id: p.q.id, distanceKm: p.km!, bearingDeg: p.bearing!, size: p.mag ?? 0, title: `${i18n.t('weather.magnitude', { mag: numberText(i18n, p.mag ?? 0, 1) })} · ${Math.round(p.km!)} km` })),
      maxKm: QUAKE_RADIUS_KM, rings: ['50 km', '100 km', '150 km'], centreLabel: 'Zagreb', label: i18n.t('weather.quakesWindow'),
    });
    const magnitudes = bars(placed.slice(0, 8).map((p) => ({
      id: p.q.id, label: i18n.t('weather.magnitude', { mag: numberText(i18n, p.mag ?? 0, 1) }), value: p.mag ?? 0,
      valueText: p.km !== null ? `${Math.round(p.km)} km` : '', caption: relativeTime(i18n, p.q.at, ctx.now), tone: (p.mag ?? 0) >= 3 ? 'urgency' : 'neutral',
    })), MAGNITUDE_SCALE, i18n.t('weather.magnitudeNote'));
    body = `<div class="wx-grid"><div>${figure}</div><div>${magnitudes}<p class="sec-note">${escapeHtml(i18n.t('weather.magnitudeNote'))}</p></div></div><ul class="rows-plain" role="list" data-testid="quakes">${placed.map((p) => quakeRow(i18n, p)).join('')}</ul>`;
  }
  return section({
    id: 'wx-quakes', tone: 'urgency', className: 'wx-wide', testid: 'wx-quakes',
    body: sectionHead(i18n, { kicker: i18n.t('weather.quakesWindow'), title: i18n.t('weather.quakes'), snapshot: emsc, error: ctx.errors?.emsc, id: 'wx-quakes-title' }) + body + attributionFoot(i18n, emsc),
  });
}
export function renderZrakINebo(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  return createElementFromHTML(`<section class="layer ws ws-weather" id="layer-zrak-i-nebo" data-layer="zrak-i-nebo" data-reconcile aria-labelledby="layer-title-zrak-i-nebo">
<header class="ws-head"><h2 class="layer-title" id="layer-title-zrak-i-nebo" tabindex="-1">${escapeHtml(i18n.t('layers.zrak-i-nebo'))}</h2></header>
<div class="wx-grid">${nowSection(i18n, ctx)}${rangeSection(i18n, ctx)}${sunSection(i18n, ctx)}${warningsSection(i18n, ctx)}${quakesSection(i18n, ctx)}</div>
</section>`);
}
