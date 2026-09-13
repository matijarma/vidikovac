// Sada: the overview. A compact weather line leads, the transport action from
// this screen's stop follows, then the safety state, the next event starts,
// the news lead and the gazette issue. Composed and unequal, one title per
// block; every value is real and a missing source reads as unknown.
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import type { LayerId } from '../../../worker/protocol';
import { ZET_ROUTES } from '../data/routes';
import { attrs, itemSelection, navLink } from '../experience/blocks';
import { delayTone } from '../experience/delay';
import { safetyState, type SafetyState } from '../experience/safety-state';
import { listState, provenanceBlock, stateBlock, statusBadge, statusLine, unconfirmed } from '../experience/status';
import { compassWord, conditionText, dayHeading, distanceKm, eventWhen, numberText, pointOf, relativeTime, windBearing, ZAGREB_LON_LAT } from '../experience/text';
import { zagrebTime, zagrebWeekdayDate } from '../format';
import type { I18n } from '../i18n/i18n';
import { dataNumber, dataText } from '../panels/panel';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { rangeBar } from '../ui/graphics';
import { iconMarkup, type IconName } from '../ui/icons';
import { cultureEvents, ongoingEvents, upcomingEvents, venueOutsideZagreb } from './kultura';
import { delayWord, vehicleCount } from './shared';
import type { LayerContext } from './types';
import { routeDelays } from './u-pokretu';

const MAX_STOP_ROUTES = 6;
const MAX_DEVIATING = 5;
const MAX_EVENTS = 4;

interface BlockOptions {
  id: string;
  tone: string;
  title: string;
  badge?: string;
  body: string;
  more?: { layer: LayerId; label: string };
  extra?: Record<string, string>;
}

/** One overview block: a titled area with its own shape, never a repeated card. */
function block(o: BlockOptions): string {
  const more = o.more ? navLink(o.more.layer, o.more.label, { className: 'ov-more' }) : '';
  return `<section class="ov-block ${escapeAttribute(o.id)}" id="${escapeAttribute(o.id)}" data-key="${escapeAttribute(o.id)}" data-tone="${escapeAttribute(o.tone)}" ${attrs(o.extra ?? {})} aria-labelledby="${escapeAttribute(o.id)}-title"><header class="ov-block-head"><h3 class="ov-block-title" id="${escapeAttribute(o.id)}-title">${escapeHtml(o.title)}</h3>${o.badge ?? ''}${more}</header>${o.body}</section>`;
}

function crossRow(layer: LayerId, selection: object, body: string, key: string, testid?: string): string {
  return `<li class="row" data-key="${escapeAttribute(key)}"${testid ? ` data-testid="${testid}"` : ''}><button type="button" class="row-button" data-action="nav" data-layer="${layer}" data-selection="${escapeAttribute(JSON.stringify(selection))}">${body}${iconMarkup('chevron-right', undefined, 'icon row-chevron')}</button></li>`;
}

function loadingOrDown(i18n: I18n, ctx: LayerContext, module: ModuleSnapshot['module']): string {
  const error = ctx.errors?.[module];
  return stateBlock(i18n, error ? 'down' : 'loading', i18n.t(error ? 'status.unknown' : 'status.loading'), error ? { retry: module } : {});
}
function weatherBlock(i18n: I18n, ctx: LayerContext): string {
  const observation = ctx.snapshots['dhmz-now'];
  const forecast = ctx.snapshots['dhmz-forecast'];
  const o = observation?.items[0];
  const f = forecast?.items[0];
  const temp = dataNumber(o, 'temp');
  const tmin = dataNumber(f, 'tmin');
  const tmax = dataNumber(f, 'tmax');
  const badge = statusBadge(i18n, observation, ctx.errors?.['dhmz-now']);
  let body: string;
  if (!observation) body = loadingOrDown(i18n, ctx, 'dhmz-now');
  else if (!o || temp === null) body = listState(i18n, observation, 'dhmz-now', 0, i18n.t('status.empty'), ctx.errors?.['dhmz-now']);
  else {
    const condition = conditionText(dataText(o, 'weather'));
    const windSpeed = dataNumber(o, 'windSpeed');
    const windDir = dataText(o, 'windDir');
    const bearing = windSpeed ? windBearing(windDir) : null;
    const humidity = dataNumber(o, 'humidity');
    const wind = windSpeed === null ? '' : windSpeed === 0
      ? i18n.t('weather.windCalm')
      : i18n.t('weather.windValue', { dir: bearing === null ? windDir : compassWord(i18n, bearing), speed: numberText(i18n, windSpeed, 1) });
    const facts = [
      wind ? `<li>${iconMarkup('wind')}<span>${escapeHtml(wind)}</span></li>` : '',
      humidity !== null ? `<li>${iconMarkup('droplets')}<span>${escapeHtml(i18n.t('panels.humidity', { value: humidity }))}</span></li>` : '',
    ].join('');
    const rangeText = tmin !== null && tmax !== null ? i18n.t('overview.todayRange', { min: numberText(i18n, tmin), max: numberText(i18n, tmax) }) : '';
    const range = tmin !== null && tmax !== null
      ? `<div class="ov-range">${rangeBar({ min: tmin, max: tmax, now: temp, minLabel: `${numberText(i18n, tmin)}°`, maxLabel: `${numberText(i18n, tmax)}°`, nowLabel: `${numberText(i18n, temp, 1)}°`, label: `${rangeText}, ${i18n.t('weather.rangeNow', { value: numberText(i18n, temp, 1) })}` })}<p class="meta ov-range-text">${escapeHtml(rangeText)}</p></div>`
      : '';
    body = `<div class="ov-weather-row"><p class="ov-temp" data-testid="temp">${escapeHtml(i18n.t('panels.temperature', { value: numberText(i18n, temp, 1) }))}</p><div class="ov-weather-text">${condition ? `<p class="ov-cond">${escapeHtml(condition)}</p>` : ''}<p class="meta">${escapeHtml(o.at ? i18n.t('overview.observedAt', { time: zagrebTime(o.at) }) : i18n.t('time.unknown'))}</p><ul class="ov-weather-facts">${facts}</ul></div>${range}</div>`;
  }
  return block({ id: 'ov-weather', tone: 'weather', title: i18n.t('overview.weatherKicker'), badge, body, more: { layer: 'zrak-i-nebo', label: i18n.t('layers.zrak-i-nebo') } });
}
function routeRow(i18n: I18n, routeId: string, delay: number | undefined): string {
  const route = ZET_ROUTES[routeId];
  const tone = delayTone(i18n, delay);
  const word = delay === undefined ? i18n.t('transit.noDelayData') : delayWord(i18n, delay);
  const selection = JSON.stringify({ kind: 'route', id: routeId });
  return `<li data-key="${escapeAttribute(routeId)}"><button type="button" class="route-link" data-action="nav" data-layer="u-pokretu" data-selection="${escapeAttribute(selection)}" aria-label="${escapeAttribute(i18n.t('transit.openRoute', { route: route?.shortName ?? routeId }))}"><span class="route-no"${route ? ` data-type="${route.type}"` : ''}>${escapeHtml(route?.shortName ?? routeId)}</span><span class="route-name">${escapeHtml(route?.longName ?? '')}</span><span class="route-delay" data-state="${tone}">${escapeHtml(word)}</span></button></li>`;
}

/** The transport action: the lines from this screen's stop and how they run now; without a stop, the lines deviating most. */
function transitBlock(i18n: I18n, ctx: LayerContext): string {
  const zet = ctx.snapshots['zet-rt'];
  const stop = ctx.screen?.stop;
  const delays = routeDelays(zet);
  const byRoute = new Map(delays.map((d) => [d.routeId, d.meanDelay]));
  const count = vehicleCount(zet);
  const title = stop ? i18n.t('transit.fromStop', { stop: stop.name }) : i18n.t('transit.mostDeviating');
  // Without a stop, only figures the shared helper asserts as a delay are ranked; a word it declines to assert never leads the list.
  const routeIds = stop
    ? stop.routes.slice(0, MAX_STOP_ROUTES)
    : delays.filter((d) => delayTone(i18n, d.meanDelay) !== 'none').slice(0, MAX_DEVIATING).map((d) => d.routeId);
  const state = listState(i18n, zet, 'zet-rt', routeIds.length, i18n.t('overview.transitEmpty'), ctx.errors?.['zet-rt']);
  const list = state || `<ul class="route-list" role="list" data-testid="overview-routes">${routeIds.map((id) => routeRow(i18n, id, byRoute.get(id))).join('')}</ul>`;
  const meta = zet && count !== null ? `<p class="meta" data-testid="vehicle-count">${escapeHtml(i18n.t('transit.vehiclesMoving', { count }))} · ${escapeHtml(statusLine(i18n, zet))}</p>` : '';
  const note = stop ? '' : `<p class="sec-note">${escapeHtml(i18n.t('transit.noStop'))}</p>`;
  return block({
    id: 'ov-transit', tone: 'transit', title, badge: statusBadge(i18n, zet, ctx.errors?.['zet-rt']),
    body: `${note}${list}${meta}<p class="sec-note">${escapeHtml(i18n.t('transit.delayNote'))}</p>`,
    more: { layer: 'u-pokretu', label: i18n.t('layers.u-pokretu') },
  });
}
function strip(level: 'urgent' | 'calm' | 'unknown' | 'info', icon: IconName, text: string): string {
  return `<li data-level="${level}">${iconMarkup(icon)}<span class="ov-strip-text">${escapeHtml(text)}</span></li>`;
}

const SEVERITY_RANK: Record<string, number> = { extreme: 4, severe: 3, moderate: 2, minor: 1, info: 0 };

/** The safety state now: warnings, closures and the latest quake, unknown while a source is unconfirmed. */
function safetyBlock(i18n: I18n, ctx: LayerContext): string {
  const state: SafetyState = safetyState(ctx.snapshots, ctx.now);
  const cap = ctx.snapshots['dhmz-cap'];
  const roads = ctx.snapshots.prometnice;
  const lines: string[] = [];
  if (unconfirmed(cap)) lines.push(strip('unknown', 'triangle-alert', i18n.t('overview.warningsUnknown')));
  else if (state.activeWarnings.length) {
    const top = [...state.activeWarnings].sort((a, b) => (SEVERITY_RANK[b.severity ?? 'info'] ?? 0) - (SEVERITY_RANK[a.severity ?? 'info'] ?? 0))[0]!;
    const more = state.activeWarnings.length - 1;
    lines.push(strip('urgent', 'triangle-alert', `${i18n.t(`panels.severity.${top.severity ?? 'info'}`)} · ${top.title}${more > 0 ? ` (+${more})` : ''}`));
  } else lines.push(strip('calm', 'check-circle', i18n.t('overview.allClear')));
  if (unconfirmed(roads)) lines.push(strip('unknown', 'hard-hat', i18n.t('overview.closuresUnknown')));
  else if (state.activeClosures.length) lines.push(strip('info', 'hard-hat', i18n.t('overview.closuresNow', { count: state.activeClosures.length })));
  else lines.push(strip('calm', 'hard-hat', i18n.t('overview.closuresNone')));
  const quake = state.quakes72h[0];
  if (quake) {
    const mag = dataNumber(quake, 'mag');
    const point = pointOf(quake);
    const km = point ? Math.round(distanceKm(point[0], point[1], ZAGREB_LON_LAT[0], ZAGREB_LON_LAT[1])) : null;
    const when = relativeTime(i18n, quake.at, ctx.now);
    const text = mag !== null && km !== null ? i18n.t('overview.quakeRecent', { mag: numberText(i18n, mag, 1), when, distance: km }) : `${quake.title} · ${when}`;
    lines.push(strip(mag !== null && mag >= 3 ? 'urgent' : 'info', 'activity', text));
  }
  const title = state.level === 'urgent' ? i18n.t('safety.urgent') : state.level === 'calm' ? i18n.t('safety.calm') : i18n.t('directory.safetySummaryUnknown');
  const note = state.level === 'calm' && state.confirmedAt
    ? i18n.t('overview.allClearConfirmed', { time: zagrebTime(state.confirmedAt) })
    : state.level === 'unknown' ? i18n.t('safety.unknownNote') : '';
  return block({
    id: 'ov-safety', tone: 'urgency', title, extra: { 'data-level': state.level },
    body: `<ul class="ov-strip" role="list" data-testid="safety-strip">${lines.join('')}</ul>${note ? `<p class="meta">${escapeHtml(note)}</p>` : ''}<div class="ov-safety-links"><a class="link-ext" href="/hitno" data-testid="hitno-link">${escapeHtml(i18n.t('safety.openHitno'))}</a></div>`,
    more: { layer: 'sigurnost', label: i18n.t('layers.sigurnost') },
  });
}
function eventLead(i18n: I18n, item: FeedItem): string {
  const precision = item.data?.precision;
  const allDay = precision === 'day' || precision === 'range' || /^\d{4}-\d{2}-\d{2}$/.test(item.at ?? '');
  return allDay ? `<span class="ev-allday">${escapeHtml(i18n.t('time.allDay'))}</span>` : `<span class="ev-time">${escapeHtml(zagrebTime(item.at))}</span>`;
}

/** The next event starts in Zagreb by day; exhibitions already running are counted, never listed as starts. */
function agendaBlock(i18n: I18n, ctx: LayerContext): string {
  const dogadanja = ctx.snapshots.dogadanja;
  const local = cultureEvents(dogadanja).filter((item) => !venueOutsideZagreb(item));
  const upcoming = upcomingEvents(local, ctx.now).slice(0, MAX_EVENTS);
  const ongoing = ongoingEvents(local, ctx.now).length;
  let lastDay = '';
  const rows = upcoming.map((item) => {
    const day = dayHeading(i18n, item.at, ctx.now);
    const head = day !== lastDay ? `<li class="agenda-day" data-key="day-${escapeAttribute(day)}" role="presentation">${escapeHtml(day)}</li>` : '';
    lastDay = day;
    const meta = [dataText(item, 'venue'), i18n.t(`events.sources.${dataText(item, 'source')}`)].filter(Boolean).join(' · ');
    return head + crossRow('kultura', itemSelection(item), `<span class="row-lead">${eventLead(i18n, item)}</span><span class="row-main"><span class="row-title">${escapeHtml(item.title)}</span><span class="row-meta">${escapeHtml(meta)}</span></span>`, item.id, 'ov-event');
  }).join('');
  const state = listState(i18n, dogadanja, 'dogadanja', upcoming.length, i18n.t('overview.noEvents'), ctx.errors?.dogadanja);
  const ongoingLine = ongoing ? `<p class="meta" data-testid="ov-ongoing">${escapeHtml(i18n.t('events.ongoingCount', { count: ongoing }))}</p>` : '';
  return block({
    id: 'ov-agenda', tone: 'events', title: i18n.t('overview.nextEvents'), badge: statusBadge(i18n, dogadanja, ctx.errors?.dogadanja),
    body: (state || `<ul class="rows agenda" role="list">${rows}</ul>`) + ongoingLine,
    more: { layer: 'kultura', label: i18n.t('layers.kultura') },
  });
}
const NEWS_SOURCES = ['HRT vijesti', 'Radio Sljeme'] as const;

/** One lead story per HRT source, with its real publication time. */
function newsBlock(i18n: I18n, ctx: LayerContext): string {
  const news = ctx.snapshots['hrt-news'];
  const rows = NEWS_SOURCES.map((source) => {
    if (news?.sources?.[source]?.status === 'down') return `<li class="row row-static" data-key="${escapeAttribute(source)}"><span class="row-meta">${escapeHtml(i18n.t('news.sourceDown', { source }))}</span></li>`;
    const item = news?.items.find((candidate) => dataText(candidate, 'source') === source || (source === NEWS_SOURCES[0] && !dataText(candidate, 'source')));
    if (!item) return '';
    const when = item.at && item.dateBasis !== 'unknown' ? relativeTime(i18n, item.at, ctx.now) : i18n.t('news.publishedUnknown');
    return crossRow('vijesti', itemSelection(item), `<span class="row-main"><span class="row-meta">${escapeHtml(source)} · ${escapeHtml(when)}</span><span class="row-title">${escapeHtml(item.title)}</span></span>`, item.id, 'ov-news-row');
  }).filter(Boolean);
  const state = listState(i18n, news, 'hrt-news', rows.length, i18n.t('news.empty'), ctx.errors?.['hrt-news']);
  return block({
    id: 'ov-news', tone: 'neutral', title: i18n.t('layers.vijesti'), badge: statusBadge(i18n, news, ctx.errors?.['hrt-news']),
    body: state || `<ul class="rows" role="list">${rows.join('')}</ul>`,
    more: { layer: 'vijesti', label: i18n.t('layers.vijesti') },
  });
}

/** The gazette issue as a number lockup, and the next Assembly session when one is announced. */
function civicBlock(i18n: I18n, ctx: LayerContext): string {
  const glasnik = ctx.snapshots.glasnik;
  const act = glasnik?.items[0];
  const next = (ctx.snapshots.dogadanja?.items ?? [])
    .filter((item) => dataText(item, 'source') === 'skupstina' && item.at && Date.parse(item.at) >= ctx.now)
    .sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!))[0];
  const issue = act && glasnik
    ? `<div class="cv-issue"><span class="cv-issue-no">${escapeHtml(`${dataText(act, 'broj')}/${dataText(act, 'godina')}`)}</span><span class="meta">${escapeHtml(act.at ? i18n.t('civic.issuePublished', { date: zagrebWeekdayDate(act.at) }) : '')}${act.at ? ' · ' : ''}${escapeHtml(i18n.t('civic.actsCount', { count: glasnik.items.length }))}</span></div>`
    : listState(i18n, glasnik, 'glasnik', 0, i18n.t('civic.actsEmpty'), ctx.errors?.glasnik);
  const assembly = next
    ? `<ul class="rows" role="list">${crossRow('uprava-i-pravo', itemSelection(next), `<span class="row-main"><span class="row-meta">${escapeHtml(i18n.t('civic.assemblyNext'))}</span><span class="row-title">${escapeHtml(i18n.t('overview.assemblyNext', { when: eventWhen(i18n, next, ctx.now) }))}</span></span>`, next.id, 'ov-assembly')}</ul>`
    : '';
  return block({
    id: 'ov-civic', tone: 'civic', title: i18n.t('civic.gazette'), badge: statusBadge(i18n, glasnik, ctx.errors?.glasnik),
    body: issue + assembly,
    more: { layer: 'uprava-i-pravo', label: i18n.t('layers.uprava-i-pravo') },
  });
}
export function renderGradSada(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  return createElementFromHTML(`<section class="layer ws ws-overview" id="layer-grad-sada" data-layer="grad-sada" data-reconcile aria-labelledby="layer-title-grad-sada">
<h2 class="layer-title visually-hidden" id="layer-title-grad-sada" tabindex="-1">${escapeHtml(i18n.t('layers.grad-sada'))}</h2>
<div class="ov">${weatherBlock(i18n, ctx)}${transitBlock(i18n, ctx)}${safetyBlock(i18n, ctx)}${agendaBlock(i18n, ctx)}${newsBlock(i18n, ctx)}${civicBlock(i18n, ctx)}</div>
${provenanceBlock(i18n, Object.values(ctx.snapshots) as (ModuleSnapshot | undefined)[])}
</section>`);
}
