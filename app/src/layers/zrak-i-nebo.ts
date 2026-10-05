// Vrijeme, mobile-first (irritation pass, 5 Oct 2026): one column on a phone,
// read top to bottom as a person asks. DHMZ's warnings first while any is in
// force or announced; the Maksimir observation as the largest object with its
// three facts (wind, humidity, pressure) on one row under it; DHMZ's hourly
// steps for Grič (dhmz-hourly) as a grid of cells, two rows of six in a phone's
// room and one row of twelve in a wider one, never a strip that scrolls
// sideways; today's and tomorrow's forecast range with the measured value on
// today's; the sun path computed on the device; DHMZ's radar crop around
// Zagreb. Everything else (the warnings' empty confirmation, the heat and cold
// waves, the bio forecast, air, the Sava and the week's quakes) is one
// disclosure, "Više", under them. No dial and no gauge: a number a person reads
// is text, and the only figures are the range bars, the sun path, the radar
// image and the quake radar (plan "Vrijeme").
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
import { iconMarkup, type IconName } from '../ui/icons';
import { sunTimes } from '../ui/solar';
import type { LayerContext } from './types';
import { conditionsMarkup } from '../city/conditions';
import { bioForecastToday, forecastDayWord, radarNow, waveDays } from '../kiosk/local';

const QUAKE_RADIUS_KM = 150;
const QUAKE_WINDOW_MS = 7 * 86_400_000;
/** Five rows, then "Prikaži još"; a week inside 150 km rarely holds more than a dozen. */
const QUAKES_PAGE = 5;
const QUAKES_STEP = 10;
const DAY_MS = 86_400_000;
const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

type WeatherModule = 'dhmz-now' | 'dhmz-forecast' | 'dhmz-cap' | 'emsc' | 'dhmz-hourly' | 'dhmz-bio' | 'dhmz-waves' | 'dhmz-radar';

/** Twelve hourly steps from the current hour (R0): two rows of six on a phone, one row of twelve in a wider room. */
const HOURLY_STEPS = 12;
/** A step's chance of rain is printed from this percentage, and its cell is tinted. */
const HOURLY_RAIN_FROM = 30;
/** dhmz-hourly's own wet rule (worker/feed/modules/dhmz-hourly.ts WET_MM, WET_PROBABILITY; kiosk/local.ts isWetStep). */
const HOURLY_WET_MM = 0.2;
const HOURLY_WET_PROBABILITY = 60;

/**
 * A step's glyph and its name. DHMZ's hourly file carries no legend for its sky symbols, so no sky is drawn for a dry
 * step (weather-icon.ts: the only real failure is drawing the wrong sky); a wet step draws the rain the worker named
 * by its amount, and a wet step with no word (near freezing, where it may be snow) the plain drops.
 */
function hourGlyph(i18n: I18n, item: FeedItem): { icon: IconName; label: string } | null {
  switch (dataText(item, 'weather')) {
    case 'slaba kiša': return { icon: 'cloud-drizzle', label: i18n.t('kiosk.nearby.rain.slaba') };
    case 'kiša': return { icon: 'cloud-rain', label: i18n.t('kiosk.nearby.rain.kisa') };
    case 'jaka kiša': return { icon: 'cloud-rain', label: i18n.t('kiosk.nearby.rain.jaka') };
    default: break;
  }
  const precip = dataNumber(item, 'precip');
  const prob = dataNumber(item, 'prob');
  const wet = (precip !== null && precip >= HOURLY_WET_MM) || (prob !== null && prob >= HOURLY_WET_PROBABILITY);
  return wet ? { icon: 'droplets', label: i18n.t('weather.hourWet') } : null;
}

/** The step's chance of rain when it is printed (30 % or more), whole. */
function hourChance(item: FeedItem): number | null {
  const prob = dataNumber(item, 'prob');
  return prob !== null && prob >= HOURLY_RAIN_FROM ? Math.round(prob) : null;
}

/**
 * One hourly cell: the hour, the glyph (or its empty slot, so the cells of a row line up), the temperature in whole
 * degrees, and the chance of rain where it is 30 % or more, its words for a reader of the tree and "70 %" on screen.
 * `rainSlots` false (no step of the grid is wet or has a chance to print) leaves the glyph slot and the rain line
 * out, so a dry day's cells are the hour over the temperature.
 */
export function hourCell(i18n: I18n, item: FeedItem, rainSlots = true): string {
  const temp = dataNumber(item, 'temp')!;
  const chance = hourChance(item);
  const glyph = hourGlyph(i18n, item);
  const icon = glyph ? iconMarkup(glyph.icon, glyph.label, 'icon wx-hour-icon') : rainSlots ? '<span class="wx-hour-icon" aria-hidden="true"></span>' : '';
  const rain = chance === null ? '' : `<span class="visually-hidden">${escapeHtml(i18n.t('weather.hourChance'))} </span>${chance} %`;
  return `<li class="wx-hour" data-key="${escapeAttribute(item.id)}"${chance === null ? '' : ' data-wet="1"'}><time datetime="${escapeAttribute(item.at!)}">${escapeHtml(zagrebTime(item.at!))}</time>${icon}`
    + `<span class="wx-hour-temp">${escapeHtml(`${numberText(i18n, temp, 0)}°`)}</span>${rainSlots || rain ? `<span class="wx-hour-rain">${rain}</span>` : ''}</li>`;
}

/** DHMZ's hourly steps for Grič (Maksimir where Grič has none), from the current hour, as a grid of cells (hourCell).
 *  A step without a temperature is left out. */
function hourlySection(i18n: I18n, ctx: LayerContext): string {
  const hourly = ctx.snapshots['dhmz-hourly'];
  const error = ctx.errors?.['dhmz-hourly'];
  const at = (item: FeedItem): number => Date.parse(item.at ?? '');
  const from = ctx.now - 3_600_000;
  const steps = (station: string): FeedItem[] => (hourly?.items ?? [])
    .filter((item) => dataText(item, 'station') === station && at(item) >= from && Date.parse(item.until ?? '') > ctx.now
      && Number.isFinite(dataNumber(item, 'temp') ?? Number.NaN))
    .sort((a, b) => at(a) - at(b));
  const gric = steps('gric');
  const shown = (gric.length > 0 ? gric : steps('maksimir')).slice(0, HOURLY_STEPS);
  let body = hourly ? listState(i18n, hourly, 'dhmz-hourly', shown.length, i18n.t('status.unknown'), error) : loadingOrDown(i18n, ctx, 'dhmz-hourly');
  if (!body) {
    const rainSlots = shown.some((item) => hourGlyph(i18n, item) !== null || hourChance(item) !== null);
    body = `<ol class="wx-hourly" role="list" aria-labelledby="wx-hourly-title" data-testid="weather-hourly">${shown.map((item) => hourCell(i18n, item, rainSlots)).join('')}</ol>`;
  }
  return wxSection({
    id: 'wx-hourly', tone: 'weather', wide: true,
    body: sectionHead(i18n, { title: i18n.t('weather.hourly'), snapshot: hourly, error, id: 'wx-hourly-title' }) + body,
  });
}

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

function rangeSection(i18n: I18n, ctx: LayerContext, offset=0): string {
  const forecast = ctx.snapshots['dhmz-forecast'];
  const error = ctx.errors?.['dhmz-forecast'];
  const day=zagrebDayKey(new Date(`${zagrebDayKey(ctx.now)}T12:00:00Z`).getTime()+offset*DAY_MS);
  const f = forecast?.items.find(item=>zagrebDayKey(item.at)===day);
  const tmin = dataNumber(f, 'tmin');
  const tmax = dataNumber(f, 'tmax');
  const temp = offset===0?dataNumber(ctx.snapshots['dhmz-now']?.items[0], 'temp'):null;
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
    id: offset?'wx-tomorrow':'wx-range', tone: 'weather',
    body: sectionHead(i18n, { title: i18n.t(offset?'events.tomorrow':'freshness.danas'), snapshot: forecast, error, id: offset?'wx-tomorrow-title':'wx-range-title' }) + body,
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
  const items = liveWarnings(ctx);
  const list = listState(i18n, cap, 'dhmz-cap', items.length, i18n.t('weather.warningsNone'), error)
    || `<ul class="wx-warnings" role="list" data-testid="warnings">${items.map((w) => warningRow(i18n, w, ctx.now)).join('')}</ul>`;
  return wxSection({
    id: 'wx-warnings', tone: 'urgency', wide: true,
    body: sectionHead(i18n, { title: i18n.t('weather.warnings'), snapshot: cap, error, id: 'wx-warnings-title' }) + list,
  });
}

/** R3: DHMZ's biometeorological forecast for today, its own text in Croatian, with the day it is for; absent without one. */
function bioSection(i18n: I18n, ctx: LayerContext): string {
  const bio = ctx.snapshots['dhmz-bio'];
  const today = bioForecastToday(bio, ctx.now);
  if (!today?.summary) return '';
  return wxSection({
    id: 'wx-bio', tone: 'weather',
    body: sectionHead(i18n, { title: i18n.t('weather.bio'), snapshot: bio, error: ctx.errors?.['dhmz-bio'], id: 'wx-bio-title' })
      + `<p class="wx-prose" lang="hr">${escapeHtml(today.summary!)}</p><p class="sec-note">${escapeHtml(zagrebWeekdayDate(today.at))}</p>`,
  });
}

/**
 * R3: DHMZ's heat and cold waves for Zagreb, only while a fresh item has a level of 1 to 3 on a day from today: one line
 * per wave and day, in the header sentence's own words (kiosk.sentence.heatWave / coldWave), so the phone and the wall
 * say the same thing.
 */
function wavesSection(i18n: I18n, ctx: LayerContext): string {
  const waves = ctx.snapshots['dhmz-waves'];
  const lines = waveDays(waves, ctx.now).map(day => {
    const key = day.wave === 'heat' ? 'kiosk.sentence.heatWave' : 'kiosk.sentence.coldWave';
    return `<li class="wx-wave" data-key="${escapeAttribute(day.id)}">${escapeHtml(i18n.t(key, { level: day.level, day: forecastDayWord(i18n, day.at, ctx.now) }))}</li>`;
  });
  if (lines.length === 0) return '';
  return wxSection({
    id: 'wx-waves', tone: 'urgency',
    body: sectionHead(i18n, { title: i18n.t('weather.waves'), snapshot: waves, error: ctx.errors?.['dhmz-waves'], id: 'wx-waves-title' })
      + `<ul class="rows wx-waves" role="list" data-testid="waves">${lines.join('')}</ul>`,
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

/**
 * DHMZ's radar crop around Zagreb (/api/radar/zagreb.png, about 120 km across, the wall's inset), with the credit and
 * the image's time under it, while a fresh radar item stands (kiosk/local.ts radarNow); absent without one. The rain
 * line is said only when the worker found rain near the city: the module never says "no rain".
 */
function radarSection(i18n: I18n, ctx: LayerContext): string {
  const snapshot = ctx.snapshots['dhmz-radar'];
  const now = radarNow(snapshot ? [snapshot] : [], ctx.now);
  if (!now) return '';
  const rain = now.rainNear ? `<p class="wx-radar-rain">${escapeHtml(i18n.t('weather.radarRainNear'))}</p>` : '';
  const figure = `<figure class="wx-radar-figure" data-replace data-sig="${escapeAttribute(now.src)}"><img src="${escapeAttribute(now.src)}" width="120" height="120" alt="${escapeAttribute(i18n.t('weather.radarAlt'))}" decoding="async">`
    + `<figcaption class="sec-note">${escapeHtml(i18n.t('weather.radarCaption', { time: zagrebTime(now.atMs) }))}</figcaption></figure>`;
  return wxSection({
    id: 'wx-radar', tone: 'weather',
    body: sectionHead(i18n, { title: i18n.t('weather.radar'), snapshot, error: ctx.errors?.['dhmz-radar'], id: 'wx-radar-title' }) + rain + figure,
  });
}

/** DHMZ's warnings in force or announced, the ones the page leads with; a closed window is over. */
function liveWarnings(ctx: LayerContext): FeedItem[] {
  return (ctx.snapshots['dhmz-cap']?.items ?? []).filter((w) => !w.until || Date.parse(w.until) >= ctx.now);
}

export function renderZrakINebo(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  // The warnings lead while there is one; otherwise their confirmation (or their loading or down state) waits in "Više".
  const warnings = warningsSection(i18n, ctx);
  const leading = liveWarnings(ctx).length > 0;
  return createElementFromHTML(`<section class="layer ws ws-weather" id="layer-zrak-i-nebo" data-layer="zrak-i-nebo" data-reconcile aria-labelledby="layer-title-zrak-i-nebo">
<header class="ws-head wx-head"><h2 class="layer-title" id="layer-title-zrak-i-nebo" tabindex="-1">${escapeHtml(i18n.t('layers.zrak-i-nebo'))}</h2></header>
<div class="wx-grid">${leading ? warnings : ''}${nowSection(i18n, ctx)}${hourlySection(i18n, ctx)}${rangeSection(i18n, ctx)}${rangeSection(i18n, ctx, 1)}${sunSection(i18n, ctx)}${radarSection(i18n, ctx)}</div>
<details class="wx-reference"><summary>${escapeHtml(i18n.t('weather.reference'))}</summary><div class="wx-grid">${leading ? '' : warnings}${wavesSection(i18n, ctx)}${bioSection(i18n, ctx)}${conditionsMarkup(ctx)}${quakesSection(i18n, ctx)}</div></details>
${provenanceBlock(i18n, [ctx.snapshots['dhmz-now'], ctx.snapshots['dhmz-forecast'], ctx.snapshots['dhmz-hourly'], ctx.snapshots['dhmz-cap'], ctx.snapshots['dhmz-radar'], ctx.snapshots.emsc, ctx.snapshots['dhmz-bio'], ctx.snapshots['dhmz-waves']])}
</section>`);
}
