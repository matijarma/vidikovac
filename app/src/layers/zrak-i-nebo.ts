// Vrijeme: the Maksimir observation as the largest object on the page with
// three facts on one strip, today's forecast range with the measured value
// placed on it and the DHMZ narrative as prose, the sun path computed on the
// device, DHMZ warnings as rows, and the week's quakes as rows first, then
// placed by their own distance and bearing. No hourly curve: DHMZ publishes
// none. No dial and no gauge: a number a person reads is text, and the only
// figures are the range bar, the sun path and the radar (plan "Vrijeme").
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import { actionButton, section, sectionHead, signRow, type Tone } from '../experience/blocks';
import { isActiveWarning } from '../experience/safety-state';
import { listState, provenanceBlock, stateBlock, statusBadge } from '../experience/status';
import { bearingDeg, compassWord, conditionText, distanceKm, numberText, pointOf, windBearing, ZAGREB_LON_LAT } from '../experience/text';
import { weatherIcon } from '../experience/weather-icon';
import { zagrebDateTime, zagrebDayKey, zagrebTime, zagrebWeekdayDate } from '../format';
import type { I18n } from '../i18n/i18n';
import { dataNumber, dataText } from '../panels/panel';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { radar, rangeBar, sunPath } from '../ui/graphics';
import { iconMarkup } from '../ui/icons';
import { sunTimes } from '../ui/solar';
import type { LayerContext } from './types';
import { conditionsMarkup } from '../city/conditions';

const QUAKE_RADIUS_KM = 150;
const QUAKE_WINDOW_MS = 7 * 86_400_000;
/** Five rows, then "Prikaži još"; a week inside 150 km rarely holds more than a dozen. */
const QUAKES_PAGE = 5;
const QUAKES_STEP = 10;
const DAY_MS = 86_400_000;
const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

type WeatherModule = 'dhmz-now' | 'dhmz-forecast' | 'dhmz-cap' | 'emsc';

function loadingOrDown(i18n: I18n, ctx: LayerContext, module: WeatherModule): string {
  const error = ctx.errors?.[module];
  return stateBlock(i18n, error ? 'down' : 'loading', i18n.t(error ? 'status.unknown' : 'status.loading'), error ? { retry: module } : {});
}

/** A flat weather section: no card, a hairline and air above it (layers.css `.wx-sec`); it carries its id as a class too, the hook its own rules use. */
function wxSection(o: { id: string; tone: Tone; wide?: boolean; body: string }): string {
  return section({ id: o.id, tone: o.tone, className: `wx-sec ${o.id}${o.wide ? ' wx-wide' : ''}`, testid: o.id, body: o.body });
}

/** The eight-point abbreviation for a bearing ("JZ"): the strip's short form; the full word goes to the arrow's name. */
function pointAbbrev(i18n: I18n, bearing: number): string {
  const index = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return i18n.t(`weather.points.${COMPASS8[index]}`);
}

/** "12 h 42 min", or the minutes alone under an hour; "h" and "min" read the same in both languages. */
function durationText(i18n: I18n, minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? i18n.t('time.duration', { hours, minutes: minutes % 60 }) : `${minutes % 60} min`;
}

/** "Maksimir · izmjereno 13:00", with the source's state word when it is not live. */
function observed(i18n: I18n, o: FeedItem, snapshot: ModuleSnapshot | undefined, error?: string): string {
  const line = [o.title, o.at ? i18n.t('weather.observedAt', { time: zagrebTime(o.at) }) : i18n.t('time.unknown')].filter(Boolean).join(' · ');
  return `<span>${escapeHtml(line)}</span>${statusBadge(i18n, snapshot, error)}`;
}

/** Three facts on one strip: wind with an arrow that flies with it, humidity, pressure. */
function facts(i18n: I18n, o: FeedItem): string {
  const windDir = dataText(o, 'windDir');
  const windSpeed = dataNumber(o, 'windSpeed');
  const humidity = dataNumber(o, 'humidity');
  const pressure = dataNumber(o, 'pressure');
  // Calm only when the station reads zero; an unrecognised direction still shows the reading as given.
  const calm = windSpeed === 0;
  const bearing = windSpeed === null || calm ? null : windBearing(windDir);
  const windText = windSpeed === null ? '' : calm
    ? i18n.t('weather.windCalm')
    : i18n.t('weather.windValue', { dir: bearing === null ? windDir : pointAbbrev(i18n, bearing), speed: numberText(i18n, windSpeed, 1) });
  // The arrow flies with the wind: a north-west wind (from 315°) sends the up arrow to the south-east (135°). The
  // span is what turns, named with the full compass word so a reader of the tree hears "sjeverozapad", not "SZ".
  const arrow = bearing === null
    ? ''
    : `<span class="wx-arrow" role="img" aria-label="${escapeAttribute(compassWord(i18n, bearing))}" style="rotate: ${(bearing + 180) % 360}deg">${iconMarkup('arrow-up')}</span>`;
  const cell = (label: string, value: string): string =>
    `<div class="wx-fact"><dt class="wx-fact-label">${escapeHtml(label)}</dt><dd class="wx-fact-value">${value}</dd></div>`;
  const cells = [
    windText ? cell(i18n.t('weather.wind'), `<span data-testid="wind-text">${escapeHtml(windText)}</span>${arrow}`) : '',
    humidity !== null ? cell(i18n.t('weather.humidity'), escapeHtml(`${numberText(i18n, humidity)} %`)) : '',
    // A pressure reading is written without a thousands separator, as the station writes it.
    pressure !== null ? cell(i18n.t('weather.pressure'), escapeHtml(`${Math.round(pressure)} hPa`)) : '',
  ].join('');
  return cells ? `<dl class="wx-figures">${cells}</dl>` : '';
}

function nowSection(i18n: I18n, ctx: LayerContext): string {
  const observation = ctx.snapshots['dhmz-now'];
  const error = ctx.errors?.['dhmz-now'];
  const o = observation?.items[0];
  const temp = dataNumber(o, 'temp');
  let body: string;
  if (!observation) body = loadingOrDown(i18n, ctx, 'dhmz-now');
  else if (!o || temp === null) body = listState(i18n, observation, 'dhmz-now', 0, i18n.t('status.empty'), error);
  else {
    const condition = conditionText(dataText(o, 'weather'));
    const icon = weatherIcon(condition);
    const cond = condition ? `<p class="wx-cond">${icon ? iconMarkup(icon) : ''}<span>${escapeHtml(condition)}</span></p>` : '';
    body = `<div class="wx-lead"><p class="wx-temp" data-testid="temp-now">${escapeHtml(i18n.t('panels.temperature', { value: numberText(i18n, temp, 1) }))}</p>${cond}<p class="wx-obs">${observed(i18n, o, observation, error)}</p></div>${facts(i18n, o)}`;
  }
  // The observation has no visible head: the temperature is the head. The heading stays for readers of the tree.
  return wxSection({ id: 'wx-now', tone: 'weather', wide: true, body: `<h2 class="visually-hidden" id="wx-now-title">${escapeHtml(i18n.t('weather.now'))}</h2>${body}` });
}

function rangeSection(i18n: I18n, ctx: LayerContext): string {
  const forecast = ctx.snapshots['dhmz-forecast'];
  const error = ctx.errors?.['dhmz-forecast'];
  const f = forecast?.items[0];
  const tmin = dataNumber(f, 'tmin');
  const tmax = dataNumber(f, 'tmax');
  const temp = dataNumber(ctx.snapshots['dhmz-now']?.items[0], 'temp');
  let body: string;
  if (!forecast) body = loadingOrDown(i18n, ctx, 'dhmz-forecast');
  else if (!f || tmin === null || tmax === null) body = listState(i18n, forecast, 'dhmz-forecast', 0, i18n.t('status.empty'), error);
  else {
    const rangeText = i18n.t('weather.rangeValue', { min: numberText(i18n, tmin), max: numberText(i18n, tmax) });
    const label = temp === null ? rangeText : `${rangeText}, ${i18n.t('weather.rangeNow', { value: numberText(i18n, temp, 1) })}`;
    const validity = [i18n.t('weather.forecast'), f.at ? i18n.t('weather.forecastFor', { date: zagrebWeekdayDate(f.at) }) : ''].filter(Boolean).join(' · ');
    body = rangeBar({ min: tmin, max: tmax, now: temp, minLabel: `${numberText(i18n, tmin)}°`, maxLabel: `${numberText(i18n, tmax)}°`, nowLabel: temp === null ? undefined : `${numberText(i18n, temp, 1)}°`, label }) +
      `<p class="wx-range-text" data-testid="forecast-range">${escapeHtml(rangeText)}</p>` +
      (f.summary ? `<p class="wx-prose">${escapeHtml(f.summary)}</p>` : '') +
      `<p class="sec-note">${escapeHtml(validity)}</p>`;
  }
  return wxSection({
    id: 'wx-range', tone: 'weather',
    body: sectionHead(i18n, { title: i18n.t('freshness.danas'), snapshot: forecast, error, id: 'wx-range-title' }) + body,
  });
}

function sunSection(i18n: I18n, ctx: LayerContext): string {
  // The Zagreb calendar day, not the UTC one: after a Zagreb midnight the times shown are already the new day's.
  const day = new Date(`${zagrebDayKey(ctx.now)}T12:00:00Z`);
  const today = sunTimes(day);
  const sunrise = today.sunrise.getTime();
  const sunset = today.sunset.getTime();
  const up = ctx.now >= sunrise && ctx.now < sunset;
  const dayMinutes = Math.max(0, Math.round((sunset - sunrise) / 60_000));
  // The next crossing: today's sunset while the sun is up, today's sunrise before it, tomorrow's once it has set.
  const next = up ? sunset : ctx.now < sunrise ? sunrise : sunTimes(new Date(day.getTime() + DAY_MS)).sunrise.getTime();
  const until = i18n.t(up ? 'weather.untilSunset' : 'weather.untilSunrise', { duration: durationText(i18n, Math.max(0, Math.round((next - ctx.now) / 60_000))) });
  const parts = [`${i18n.t('weather.sunrise')} ${zagrebTime(sunrise)}`, `${i18n.t('weather.sunset')} ${zagrebTime(sunset)}`, i18n.t('weather.daylight', { duration: durationText(i18n, dayMinutes) })];
  const times = parts.join(' · ');
  // The axis under the arc names its three points in words; the numbers live once, in the line below the figure.
  const figure = sunPath({
    sunrise, sunset, now: ctx.now,
    sunriseLabel: i18n.t('weather.sunrise'), sunsetLabel: i18n.t('weather.sunset'), noonLabel: i18n.t('weather.noon'),
    label: `${i18n.t(up ? 'weather.sunUp' : 'weather.sunDown')}. ${times}.`,
  });
  return wxSection({
    id: 'wx-sun', tone: 'weather',
    body: sectionHead(i18n, { title: i18n.t('weather.sun'), id: 'wx-sun-title', noStatus: true }) + figure +
      // Each part holds together; a narrow line breaks between them, after a separator, never inside "12 h 48 min".
      `<p class="wx-sun-times">${parts.map((part) => `<span class="wx-nowrap">${escapeHtml(part)}</span>`).join(' · ')}</p><p class="wx-sun-until">${escapeHtml(until)}</p><p class="sec-note">${escapeHtml(i18n.t('weather.sunNote'))}</p>`,
  });
}

/** "od 14:00 do 22:00" when both ends fall today, otherwise with their dates; one end alone reads "do …" or "od …". */
function windowText(i18n: I18n, w: FeedItem, now: number): string {
  if (!w.at && !w.until) return '';
  const today = zagrebDayKey(now);
  const sameDay = (value: string | undefined): boolean => !value || zagrebDayKey(value) === today;
  const format = sameDay(w.at) && sameDay(w.until) ? zagrebTime : zagrebDateTime;
  if (w.at && w.until) return i18n.t('weather.validity', { from: format(w.at), to: format(w.until) });
  return w.until ? i18n.t('panels.until', { time: format(w.until) }) : i18n.t('panels.from', { time: format(w.at!) });
}

/** "na snazi · od 14:00 do 22:00": whether the warning is in force or only announced, then its window. */
export function warningWindow(i18n: I18n, w: FeedItem, now: number): string {
  return [i18n.t(isActiveWarning(w, now) ? 'weather.active' : 'weather.announced'), windowText(i18n, w, now)].filter(Boolean).join(' · ');
}

/** The level as a word with its shape (R-K1), the event as DHMZ names it, the window, the text as prose. Sigurnost lists its warnings with this same row. */
export function warningRow(i18n: I18n, w: FeedItem, now: number): string {
  const severity = w.severity ?? 'info';
  const event = dataText(w, 'event') || w.title;
  const window = warningWindow(i18n, w, now);
  return `<li class="wx-warning" data-key="${escapeAttribute(w.id)}" data-testid="warning-row"><p class="wx-warning-head"><span class="badge badge-sev" data-tone="${severity}">${escapeHtml(i18n.t(`panels.severity.${severity}`))}</span>${event ? `<span class="wx-warning-event">${escapeHtml(event)}</span>` : ''}</p><p class="wx-warning-window">${escapeHtml(window)}</p>${w.summary ? `<p class="wx-prose">${escapeHtml(w.summary)}</p>` : ''}</li>`;
}

function warningsSection(i18n: I18n, ctx: LayerContext): string {
  const cap = ctx.snapshots['dhmz-cap'];
  const error = ctx.errors?.['dhmz-cap'];
  // A warning whose window has closed is over; only the ones in force or still to come are warnings.
  const items = (cap?.items ?? []).filter((w) => !w.until || Date.parse(w.until) >= ctx.now);
  const list = listState(i18n, cap, 'dhmz-cap', items.length, i18n.t('weather.warningsNone'), error)
    || `<ul class="wx-warnings" role="list" data-testid="warnings">${items.map((w) => warningRow(i18n, w, ctx.now)).join('')}</ul>`;
  return wxSection({
    id: 'wx-warnings', tone: 'urgency',
    body: sectionHead(i18n, { title: i18n.t('weather.warnings'), snapshot: cap, error, id: 'wx-warnings-title' }) + list,
  });
}

export interface PlacedQuake { q: FeedItem; mag: number | null; km: number | null; bearing: number | null }

/** Each quake with its magnitude, and its distance and bearing from Zagreb when it has coordinates. */
export function placeQuakes(items: readonly FeedItem[]): PlacedQuake[] {
  return items.map((q) => {
    const p = pointOf(q);
    return {
      q, mag: dataNumber(q, 'mag'),
      km: p ? distanceKm(p[0], p[1], ZAGREB_LON_LAT[0], ZAGREB_LON_LAT[1]) : null,
      bearing: p ? bearingDeg(ZAGREB_LON_LAT[0], ZAGREB_LON_LAT[1], p[0], p[1]) : null,
    };
  });
}

/** The magnitude leads; the title says how far and how deep (the source's region name when it cannot be placed); the time is the second line. Sigurnost lists its 72 hours with this same row. */
export function quakeRow(i18n: I18n, p: PlacedQuake): string {
  const depth = dataNumber(p.q, 'depth');
  const where = p.km !== null ? i18n.t('weather.quakeDistance', { km: Math.round(p.km) }) : dataText(p.q, 'region') || p.q.title;
  return signRow({
    lead: p.mag === null ? '' : `<span class="wx-mag">${escapeHtml(i18n.t('weather.magnitude', { mag: numberText(i18n, p.mag, 1) }))}</span>`,
    title: [where, depth !== null ? i18n.t('weather.depth', { depth: numberText(i18n, depth, 1) }) : ''].filter(Boolean).join(' · '),
    sub: zagrebDateTime(p.q.at),
    key: p.q.id,
    attrs: { 'data-testid': 'quake-row' },
  });
}

function quakesSection(i18n: I18n, ctx: LayerContext): string {
  const emsc = ctx.snapshots.emsc;
  const error = ctx.errors?.emsc;
  // The stated window and radius are the bounds shown; the query's own radius is slightly wider.
  const placed = placeQuakes((emsc?.items ?? []).filter((q) => q.at && ctx.now - Date.parse(q.at) <= QUAKE_WINDOW_MS))
    .filter((p) => p.km === null || p.km <= QUAKE_RADIUS_KM);
  let body = listState(i18n, emsc, 'emsc', placed.length, i18n.t('weather.quakesNone'), error);
  if (!body) {
    const shownCount = Math.min(placed.length, Number(ctx.view?.filters.quakes) || QUAKES_PAGE);
    const more = shownCount < placed.length
      ? actionButton('filter', i18n.t('common.showMore', { count: Math.min(QUAKES_STEP, placed.length - shownCount) }), { className: 'btn-ghost sf-more', extra: { 'filter-key': 'quakes', 'filter-value': shownCount + QUAKES_STEP } })
      : '';
    const located = placed.filter((p) => p.km !== null && p.bearing !== null);
    const figure = radar({
      points: located.map((p) => ({ id: p.q.id, distanceKm: p.km!, bearingDeg: p.bearing!, size: p.mag ?? 0, title: `${i18n.t('weather.magnitude', { mag: numberText(i18n, p.mag ?? 0, 1) })} · ${Math.round(p.km!)} km` })),
      maxKm: QUAKE_RADIUS_KM, rings: ['50 km', '100 km', '150 km'], centreLabel: 'Zagreb', label: i18n.t('weather.quakes'),
    });
    // A quake without coordinates is in the list but cannot be on the figure; the figure says so.
    const onFigure = located.length < placed.length
      ? `<p class="wx-on-figure sec-note">${escapeHtml(i18n.t('weather.onFigure', { shown: located.length, total: placed.length }))}</p>`
      : '';
    body = `<ul class="rows wx-quake-rows" role="list" data-testid="quakes">${placed.slice(0, shownCount).map((p) => quakeRow(i18n, p)).join('')}</ul>${more}${figure}${onFigure}`;
  }
  return wxSection({
    id: 'wx-quakes', tone: 'urgency',
    body: sectionHead(i18n, { title: i18n.t('weather.quakes'), snapshot: emsc, error, id: 'wx-quakes-title' }) + body,
  });
}

export function renderZrakINebo(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  const observation = ctx.snapshots['dhmz-now'];
  const o = observation?.items[0];
  // The layer title is for readers of the tree on a phone; a desk shows it with the observation line beside it (layers.css `.wx-head`).
  const headObs = o ? `<p class="wx-head-obs">${observed(i18n, o, observation, ctx.errors?.['dhmz-now'])}</p>` : '';
  return createElementFromHTML(`<section class="layer ws ws-weather" id="layer-zrak-i-nebo" data-layer="zrak-i-nebo" data-reconcile aria-labelledby="layer-title-zrak-i-nebo">
<header class="ws-head wx-head"><h2 class="layer-title" id="layer-title-zrak-i-nebo" tabindex="-1">${escapeHtml(i18n.t('layers.zrak-i-nebo'))}</h2>${headObs}</header>
<div class="wx-grid">${nowSection(i18n, ctx)}${rangeSection(i18n, ctx)}${sunSection(i18n, ctx)}${conditionsMarkup(ctx)}${warningsSection(i18n, ctx)}${quakesSection(i18n, ctx)}</div>
${provenanceBlock(i18n, [ctx.snapshots['dhmz-now'], ctx.snapshots['dhmz-forecast'], ctx.snapshots['dhmz-cap'], ctx.snapshots.emsc])}
</section>`);
}
