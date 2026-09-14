// Sada: the whole city on one composed page, in the order a person standing
// at a stop needs it. A place line says where "here" is, the weather is one
// lockup, safety one band, the stop's lines a departure board, then what
// starts next, what was published and what the city decided. Every block is a
// link into its domain and none of them is a card; a source that has not
// answered yet paints the shape it is about to fill instead of a word.
//
// The blocks are written in the order they are read, so the eye, the Tab key
// and a screen reader travel the page in one sequence (WCAG 2.2 SC 2.4.3).
// They are grouped into three column stacks (`.ov-col`), each a contiguous
// slice of that one order, so the desk composition is a CSS change and never a
// second render and never a second order; on a phone the columns are
// `display: contents` and the page reads straight down.
import type { FeedItem, ModuleId, ModuleSnapshot } from '../../../worker/feed/schema';
import type { LayerId } from '../../../worker/protocol';
import { ZET_ROUTES } from '../data/routes';
import { attrs, itemSelection, lineBadge, navLink } from '../experience/blocks';
import { delayTone } from '../experience/delay';
import { safetyState, type SafetyLevel, type SafetyState } from '../experience/safety-state';
import { listState, provenanceBlock, stateBlock, statusBadge, statusLine } from '../experience/status';
import { compassWord, conditionText, dayHeading, eventWhen, numberText, relativeTime, windBearing } from '../experience/text';
import { weatherIcon } from '../experience/weather-icon';
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
const MAX_DEVIATING = 6;
const MAX_EVENTS = 3;

interface BlockOptions {
  id: string;
  tone: string;
  body: string;
  /** The block is waiting for its first snapshot; the body is its skeleton. */
  busy?: boolean;
  /** The id of the heading that names the block, when it has one. */
  labelledBy?: string;
  extra?: Record<string, string>;
}

/** One block of the page: an area with its own shape on the canvas, never a card. */
function block(o: BlockOptions): string {
  const rest = attrs({
    'aria-busy': o.busy ? 'true' : undefined,
    'aria-labelledby': o.labelledBy,
    ...(o.extra ?? {}),
  });
  return `<section class="ov-block ${escapeAttribute(o.id)}" id="${escapeAttribute(o.id)}" data-key="${escapeAttribute(o.id)}" data-tone="${escapeAttribute(o.tone)}" ${rest}>${o.body}</section>`;
}

/** The block head: a place or a source name, the live status word when there is one, the way into the domain. */
function head(i18n: I18n, id: string, title: string, badge: string, more: { layer: LayerId; label: string }): string {
  return `<header class="ov-head"><h3 class="ov-title" id="${escapeAttribute(id)}-title">${escapeHtml(title)}</h3>${badge}${navLink(more.layer, more.label, { className: 'ov-more' })}</header>`;
}

/** The one word a reader hears while a block is still empty; it is never painted. */
function loadingLabel(i18n: I18n): string {
  return `<span class="visually-hidden">${escapeHtml(i18n.t('status.loading'))}</span>`;
}

/**
 * One bar of a skeleton. `role` is the type role the text it stands in for is
 * set in, so the bar occupies that line's box exactly and the block keeps its
 * finished geometry while it waits; `width` is which of the two standard bar
 * widths it takes.
 */
const skeleton = (role: string, width: 'sk-line' | 'sk-line-short' | '' = 'sk-line'): string =>
  `<span class="sk ${width} ${role}"></span>`;

/** A skeleton row in the box a real row will have: whatever stands in its first cell, then a line per line of text its rows carry. */
function skeletonRow(key: string, lines: readonly string[], lead = ''): string {
  const bars = lines.map((role, i) => skeleton(role, i === 0 ? 'sk-line' : 'sk-line-short')).join('');
  return `<li class="row" data-key="${escapeAttribute(key)}">${lead}<span class="row-main">${bars}</span></li>`;
}

const skeletonRows = (count: number, lines: readonly string[], lead = ''): string =>
  Array.from({ length: count }, (_, i) => skeletonRow(`sk-${i}`, lines, lead)).join('');

/** The line badge's box on the board, and the time column's box in the agenda. */
const SK_BADGE = skeleton('ov-sk-badge', '');
const SK_TIME = `<span class="row-lead">${skeleton('ov-sk-lead', '')}</span>`;

/** A day head in the agenda skeleton, in the box the violet day word will take. */
const skeletonDay = (index: number): string =>
  `<li class="agenda-day" data-key="sk-day-${index}">${skeleton('ov-sk-sub', 'sk-line-short')}</li>`;

/** An agenda row: the title, then the venue and source line that usually runs to two. */
const AGENDA_SK = ['ov-sk-title', 'ov-sk-sub', 'ov-sk-sub'] as const;

/** A source that answered with a failure: the honest sentence and the way to ask again. */
function unavailable(i18n: I18n, module: ModuleId): string {
  return stateBlock(i18n, 'down', i18n.t('status.unknown'), { retry: module });
}

/** A row that opens something in another domain; the whole row is the control. */
function crossRow(layer: LayerId, selection: object, body: string, key: string, testid?: string): string {
  return `<li data-key="${escapeAttribute(key)}"${testid ? ` data-testid="${testid}"` : ''}><button type="button" class="ov-row row" data-action="nav" data-layer="${layer}" data-selection="${escapeAttribute(JSON.stringify(selection))}">${body}</button></li>`;
}

/**
 * Weather: the measured number, the sky in a word and a picture, where and
 * when it was measured, today's range. The whole block opens Vrijeme, so the
 * lockup is the control and carries no separate link.
 */
function weatherBlock(i18n: I18n, ctx: LayerContext): string {
  const observation = ctx.snapshots['dhmz-now'];
  const forecast = ctx.snapshots['dhmz-forecast'];
  const error = ctx.errors?.['dhmz-now'];
  const title = `<h3 class="visually-hidden" id="ov-weather-title">${escapeHtml(i18n.t('layers.zrak-i-nebo'))}</h3>`;
  if (!observation && !error) {
    return block({
      id: 'ov-weather', tone: 'weather', busy: true, labelledBy: 'ov-weather-title',
      body: `${title}${loadingLabel(i18n)}<div class="ov-weather-row">${skeleton('ov-sk-numeral', '')}<div class="ov-weather-text">${skeleton('ov-sk-cond')}${skeleton('ov-sk-obs', 'sk-line-short')}</div><div class="ov-weather-side">${skeleton('ov-sk-sub', 'sk-line-short')}${skeleton('ov-sk-sub')}</div></div><div class="ov-range">${skeleton('ov-sk-figure', '')}${skeleton('ov-sk-sub')}</div>`,
    });
  }
  const o = observation?.items[0];
  const f = forecast?.items[0];
  const temp = dataNumber(o, 'temp');
  if (!observation) return block({ id: 'ov-weather', tone: 'weather', labelledBy: 'ov-weather-title', body: title + unavailable(i18n, 'dhmz-now') });
  if (!o || temp === null) {
    return block({ id: 'ov-weather', tone: 'weather', labelledBy: 'ov-weather-title', body: title + listState(i18n, observation, 'dhmz-now', 0, i18n.t('status.empty'), error) });
  }
  const tmin = dataNumber(f, 'tmin');
  const tmax = dataNumber(f, 'tmax');
  const condition = conditionText(dataText(o, 'weather'));
  const icon = weatherIcon(condition);
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
    ? `<div class="ov-range">${rangeBar({ min: tmin, max: tmax, now: temp, minLabel: `${numberText(i18n, tmin)}°`, maxLabel: `${numberText(i18n, tmax)}°`, nowLabel: `${numberText(i18n, temp, 1)}°`, label: `${rangeText}, ${i18n.t('weather.rangeNow', { value: numberText(i18n, temp, 1) })}` })}</div>`
    : '';
  // The station names itself and dates its own reading; a stale source says so on that same line.
  const observed = [o.title, o.at ? i18n.t('overview.observedAt', { time: zagrebTime(o.at) }) : i18n.t('time.unknown')].filter(Boolean).join(' · ');
  const body = `<a class="ov-link" href="#layer=zrak-i-nebo" data-action="nav" data-layer="zrak-i-nebo">${title}<div class="ov-weather-row"><p class="ov-temp" data-testid="temp">${escapeHtml(i18n.t('panels.temperature', { value: numberText(i18n, temp, 1) }))}</p><div class="ov-weather-text">${condition ? `<p class="ov-cond">${icon ? iconMarkup(icon) : ''}<span>${escapeHtml(condition)}</span></p>` : ''}<p class="ov-obs">${escapeHtml(observed)}${statusBadge(i18n, observation, error)}</p></div><div class="ov-weather-side">${rangeText ? `<p class="meta ov-range-text">${escapeHtml(rangeText)}</p>` : ''}<ul class="ov-weather-facts">${facts}</ul></div></div>${range}</a>`;
  return block({ id: 'ov-weather', tone: 'weather', labelledBy: 'ov-weather-title', body });
}

/**
 * The severities that make the city urgent, ranked. It is the same predicate
 * `safetyState` raises `urgent` from, so a warning may name the verdict only
 * when it is itself a reason for it; `minor` and `info` are real DHMZ
 * severities and neither is.
 */
const URGENT_RANK: Record<string, number> = { extreme: 3, severe: 2, moderate: 1 };
const SAFETY_ICON: Record<SafetyLevel, IconName> = { calm: 'check-circle', urgent: 'triangle-alert', unknown: 'alert-circle' };

/** The safety verdict in the words the domain uses: the top warning when one is the reason, otherwise calm, unconfirmed, or the urgent word. */
function safetyVerdict(i18n: I18n, state: SafetyState): string {
  if (state.level === 'calm') return i18n.t('safety.calm');
  if (state.level === 'unknown') return i18n.t('directory.safetySummaryUnknown');
  // Urgency can come from the quake instead. Then the band says so in the
  // domain's own word rather than borrowing the colour of a warning that is
  // not the reason ("zeleno" is never a level word anywhere, R-K1).
  const top = [...state.activeWarnings]
    .filter((w) => URGENT_RANK[w.severity ?? ''] !== undefined)
    .sort((a, b) => (URGENT_RANK[b.severity!] ?? 0) - (URGENT_RANK[a.severity!] ?? 0))[0];
  if (!top) return i18n.t('safety.urgent');
  return `${i18n.t(`panels.severity.${top.severity}`)}: ${top.title}`;
}

/** One band, the only tint on the page: the state now, when it was confirmed, and the way into Sigurnost. */
function safetyBlock(i18n: I18n, ctx: LayerContext): string {
  const state = safetyState(ctx.snapshots, ctx.now);
  const verdict = safetyVerdict(i18n, state);
  const confirmed = state.level === 'calm' && state.confirmedAt ? i18n.t('overview.allClearConfirmed', { time: zagrebTime(state.confirmedAt) }) : '';
  const body = `<a class="band" data-level="${state.level}" href="#layer=sigurnost" data-action="nav" data-layer="sigurnost">${iconMarkup(SAFETY_ICON[state.level])}<span class="band-title">${escapeHtml(verdict)}</span><span class="band-meta">${escapeHtml(confirmed)}</span></a>`;
  return block({ id: 'ov-safety', tone: 'urgency', extra: { 'data-level': state.level }, body });
}

/** One line of the board: the number on the front of the vehicle, where it goes, how it runs now. */
function routeRow(i18n: I18n, routeId: string, delay: number | undefined): string {
  const route = ZET_ROUTES[routeId];
  const kind = route?.type === 0 ? 'tram' : route?.type === 3 ? 'bus' : 'other';
  const tone = delayTone(i18n, delay);
  const word = delay === undefined ? i18n.t('transit.noDelayData') : delayWord(i18n, delay);
  const selection = JSON.stringify({ kind: 'route', id: routeId });
  return `<li data-key="${escapeAttribute(routeId)}"><button type="button" class="route-link row" data-action="nav" data-layer="u-pokretu" data-selection="${escapeAttribute(selection)}">${lineBadge(route?.shortName ?? routeId, kind, 'm')}<span class="row-main"><span class="row-title">${escapeHtml(route?.longName ?? routeId)}</span></span><span class="route-delay" data-state="${tone}">${escapeHtml(word)}</span></button></li>`;
}

/** The departure board: the lines from this screen's stop and how they run now; without a stop, the lines deviating most. */
function transitBlock(i18n: I18n, ctx: LayerContext): string {
  const zet = ctx.snapshots['zet-rt'];
  const error = ctx.errors?.['zet-rt'];
  const stop = ctx.screen?.stop;
  const title = stop ? i18n.t('transit.fromStop', { stop: stop.name }) : i18n.t('transit.mostDeviating');
  const more = { layer: 'u-pokretu' as LayerId, label: i18n.t('layers.u-pokretu') };
  const loading = !zet && !error;
  // The loading word is announced by the block, never painted twice: no badge beside a skeleton.
  const header = head(i18n, 'ov-transit', title, loading ? '' : statusBadge(i18n, zet, error), more);
  if (loading) {
    return block({
      id: 'ov-transit', tone: 'transit', busy: true, labelledBy: 'ov-transit-title',
      body: `${header}${loadingLabel(i18n)}<ul class="route-list" role="list">${skeletonRows(MAX_STOP_ROUTES, ['ov-sk-title'], SK_BADGE)}</ul>${skeleton('ov-sk-sub')}${skeleton('ov-sk-sub', 'sk-line-short')}`,
    });
  }
  const delays = routeDelays(zet);
  const byRoute = new Map(delays.map((d) => [d.routeId, d.meanDelay]));
  const count = vehicleCount(zet);
  // Without a stop, only figures the shared helper asserts as a delay are ranked; a word it declines to assert never leads the list.
  const routeIds = stop
    ? stop.routes.slice(0, MAX_STOP_ROUTES)
    : delays.filter((d) => delayTone(i18n, d.meanDelay) !== 'none').slice(0, MAX_DEVIATING).map((d) => d.routeId);
  const state = listState(i18n, zet, 'zet-rt', routeIds.length, i18n.t('overview.transitEmpty'), error);
  const list = state || `<ul class="route-list" role="list" data-testid="overview-routes">${routeIds.map((id) => routeRow(i18n, id, byRoute.get(id))).join('')}</ul>`;
  const fleet = zet && count !== null ? `<p class="ov-foot" data-testid="vehicle-count">${escapeHtml(i18n.t('transit.vehiclesMoving', { count }))} · ${escapeHtml(statusLine(i18n, zet))}</p>` : '';
  const note = state ? '' : `<p class="ov-foot">${escapeHtml(i18n.t('overview.delayShort'))}</p>`;
  return block({ id: 'ov-transit', tone: 'transit', labelledBy: 'ov-transit-title', body: `${header}${list}${fleet}${note}` });
}

function eventLead(i18n: I18n, item: FeedItem): string {
  const precision = item.data?.precision;
  const allDay = precision === 'day' || precision === 'range' || /^\d{4}-\d{2}-\d{2}$/.test(item.at ?? '');
  return allDay ? `<span class="ev-allday">${escapeHtml(i18n.t('time.allDay'))}</span>` : `<span class="ev-time">${escapeHtml(zagrebTime(item.at))}</span>`;
}

/** The next starts in Zagreb, by day; exhibitions already running are counted at the foot, never listed as starts. */
function agendaBlock(i18n: I18n, ctx: LayerContext): string {
  const dogadanja = ctx.snapshots.dogadanja;
  const error = ctx.errors?.dogadanja;
  const more = { layer: 'kultura' as LayerId, label: i18n.t('layers.kultura') };
  const loading = !dogadanja && !error;
  const header = head(i18n, 'ov-agenda', i18n.t('overview.nextEvents'), loading ? '' : statusBadge(i18n, dogadanja, error), more);
  if (loading) {
    return block({
      id: 'ov-agenda', tone: 'events', busy: true, labelledBy: 'ov-agenda-title',
      body: `${header}${loadingLabel(i18n)}<ul class="ov-list" role="list">${skeletonDay(0)}${skeletonRow('sk-0', AGENDA_SK, SK_TIME)}${skeletonDay(1)}${skeletonRow('sk-1', AGENDA_SK, SK_TIME)}${skeletonRow('sk-2', AGENDA_SK, SK_TIME)}</ul>${skeleton('ov-sk-sub', 'sk-line-short')}`,
    });
  }
  const local = cultureEvents(dogadanja).filter((item) => !venueOutsideZagreb(item));
  const upcoming = upcomingEvents(local, ctx.now).slice(0, MAX_EVENTS);
  const ongoing = ongoingEvents(local, ctx.now).length;
  let lastDay = '';
  const rows = upcoming.map((item) => {
    const day = dayHeading(i18n, item.at, ctx.now);
    const dayRow = day !== lastDay ? `<li class="agenda-day" data-key="day-${escapeAttribute(day)}" role="presentation">${escapeHtml(day)}</li>` : '';
    lastDay = day;
    const meta = [dataText(item, 'venue'), i18n.t(`events.sources.${dataText(item, 'source')}`)].filter(Boolean).join(' · ');
    const body = `<span class="row-lead">${eventLead(i18n, item)}</span><span class="row-main"><span class="row-title">${escapeHtml(item.title)}</span><span class="row-sub">${escapeHtml(meta)}</span></span>`;
    return dayRow + crossRow('kultura', itemSelection(item), body, item.id, 'ov-event');
  }).join('');
  const state = listState(i18n, dogadanja, 'dogadanja', upcoming.length, i18n.t('overview.noEvents'), error);
  const ongoingLine = ongoing ? `<p class="ov-foot" data-testid="ov-ongoing">${escapeHtml(i18n.t('events.ongoingCount', { count: ongoing }))}</p>` : '';
  return block({
    id: 'ov-agenda', tone: 'events', labelledBy: 'ov-agenda-title',
    body: `${header}${state || `<ul class="ov-list" role="list">${rows}</ul>`}${ongoingLine}`,
  });
}

const NEWS_SOURCES = ['HRT vijesti', 'Radio Sljeme'] as const;

/** One lead story per HRT source, the source and its real publication time above the headline. */
function newsBlock(i18n: I18n, ctx: LayerContext): string {
  const news = ctx.snapshots['hrt-news'];
  const error = ctx.errors?.['hrt-news'];
  const more = { layer: 'vijesti' as LayerId, label: i18n.t('layers.vijesti') };
  const loading = !news && !error;
  const header = head(i18n, 'ov-news', i18n.t('layers.vijesti'), loading ? '' : statusBadge(i18n, news, error), more);
  if (loading) {
    return block({
      id: 'ov-news', tone: 'neutral', busy: true, labelledBy: 'ov-news-title',
      body: `${header}${loadingLabel(i18n)}<ul class="ov-list" role="list">${skeletonRow('sk-0', ['ov-sk-sub', 'ov-sk-title', 'ov-sk-title'])}${skeletonRow('sk-1', ['ov-sk-sub', 'ov-sk-title'])}</ul>`,
    });
  }
  const rows = NEWS_SOURCES.map((source) => {
    if (news?.sources?.[source]?.status === 'down') return `<li class="row row-static" data-key="${escapeAttribute(source)}"><span class="row-sub">${escapeHtml(i18n.t('news.sourceDown', { source }))}</span></li>`;
    const item = news?.items.find((candidate) => dataText(candidate, 'source') === source || (source === NEWS_SOURCES[0] && !dataText(candidate, 'source')));
    if (!item) return '';
    const when = item.at && item.dateBasis !== 'unknown' ? relativeTime(i18n, item.at, ctx.now) : i18n.t('news.publishedUnknown');
    const body = `<span class="row-main"><span class="row-sub">${escapeHtml(source)} · ${escapeHtml(when)}</span><span class="row-title">${escapeHtml(item.title)}</span></span>`;
    return crossRow('vijesti', itemSelection(item), body, item.id, 'ov-news-row');
  }).filter(Boolean);
  const state = listState(i18n, news, 'hrt-news', rows.length, i18n.t('news.empty'), error);
  return block({
    id: 'ov-news', tone: 'neutral', labelledBy: 'ov-news-title',
    body: `${header}${state || `<ul class="ov-list" role="list">${rows.join('')}</ul>`}`,
  });
}

/** The gazette issue as a number lockup, and the next Assembly session when one is announced. */
function civicBlock(i18n: I18n, ctx: LayerContext): string {
  const glasnik = ctx.snapshots.glasnik;
  const error = ctx.errors?.glasnik;
  const more = { layer: 'uprava-i-pravo' as LayerId, label: i18n.t('layers.uprava-i-pravo') };
  const loading = !glasnik && !error;
  const header = head(i18n, 'ov-civic', i18n.t('layers.uprava-i-pravo'), loading ? '' : statusBadge(i18n, glasnik, error), more);
  if (loading) {
    return block({
      id: 'ov-civic', tone: 'civic', busy: true, labelledBy: 'ov-civic-title',
      body: `${header}${loadingLabel(i18n)}<div class="ov-issue">${skeleton('ov-sk-numeral', '')}${skeleton('ov-sk-meta2')}</div><ul class="ov-list" role="list">${skeletonRow('sk-0', ['ov-sk-sub', 'ov-sk-title', 'ov-sk-title'])}</ul>`,
    });
  }
  const act = glasnik?.items[0];
  const next = (ctx.snapshots.dogadanja?.items ?? [])
    .filter((item) => dataText(item, 'source') === 'skupstina' && item.at && Date.parse(item.at) >= ctx.now)
    .sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!))[0];
  // The gazette, the day it was published and how many acts it carries: one line under the number.
  const issueLine = act && glasnik
    ? [i18n.t('civic.gazette'), act.at ? i18n.t('civic.issuePublished', { date: zagrebWeekdayDate(act.at) }) : '', i18n.t('civic.actsCount', { count: glasnik.items.length })].filter(Boolean).join(' · ')
    : '';
  const issue = act && glasnik
    ? `<div class="ov-issue"><span class="ov-issue-no">${escapeHtml(`${dataText(act, 'broj')}/${dataText(act, 'godina')}`)}</span><span class="meta">${escapeHtml(issueLine)}</span></div>`
    : listState(i18n, glasnik, 'glasnik', 0, i18n.t('civic.actsEmpty'), error);
  const assembly = next
    ? `<ul class="ov-list" role="list">${crossRow('uprava-i-pravo', itemSelection(next), `<span class="row-main"><span class="row-sub">${escapeHtml(i18n.t('civic.assemblyNext'))}</span><span class="row-title">${escapeHtml(i18n.t('overview.assemblyNext', { when: eventWhen(i18n, next, ctx.now) }))}</span></span>`, next.id, 'ov-assembly')}</ul>`
    : '';
  return block({ id: 'ov-civic', tone: 'civic', labelledBy: 'ov-civic-title', body: `${header}${issue}${assembly}` });
}

export function renderGradSada(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  const place = i18n.t('overview.place', { place: ctx.screen?.stop?.name ?? 'Zagreb', date: zagrebWeekdayDate(ctx.now) });
  return createElementFromHTML(`<section class="layer ws ws-overview" id="layer-grad-sada" data-layer="grad-sada" data-reconcile aria-labelledby="layer-title-grad-sada">
<h2 class="layer-title visually-hidden" id="layer-title-grad-sada" tabindex="-1">${escapeHtml(i18n.t('layers.grad-sada'))}</h2>
<p class="ov-place" data-key="place">${escapeHtml(place)}</p>
<div class="ov">
  <div class="ov-col" data-key="col-a">${weatherBlock(i18n, ctx)}${safetyBlock(i18n, ctx)}${transitBlock(i18n, ctx)}</div>
  <div class="ov-col" data-key="col-b">${agendaBlock(i18n, ctx)}</div>
  <div class="ov-col" data-key="col-c">${newsBlock(i18n, ctx)}${civicBlock(i18n, ctx)}</div>
</div>
${provenanceBlock(i18n, Object.values(ctx.snapshots) as (ModuleSnapshot | undefined)[])}
</section>`);
}
