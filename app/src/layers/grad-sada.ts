// Sada: the whole city on one time axis (newdesignsystem.md §4.2, plan A.4).
// The workspace is the band and nothing else. First the phone's segmented
// control (sticky under the header; a desk hides it by CSS and reads the five
// heads instead), then the band itself: the heads, the axis and the lanes in
// time order, sada · poslijepodne · večeras · sutra · tjedan, then one line of
// provenance. Every fact on the page is a tile a producer described
// (experience/producers) and buildTimeband placed, capped and marked, so a
// finger, a Tab key and a screen reader travel one order on every surface and
// this file composes without a block builder of its own. Weather is status in
// the sada head on the phone (D4, D11), never a tile; the desktop's status
// line carries it instead. The root is reconciled in place, so a poll swaps
// only the values that changed.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { provenanceBlock } from '../experience/status';
import { buildTimeband, FILTER_KEY } from '../experience/timeband';
import { tileMarkup, skeletonTileMarkup, type Tile } from '../experience/tiles';
import { weatherStatus } from '../experience/weather-status';
import { zagrebDayKey, zagrebWeekdayDate, zagrebTime } from '../format';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import type { LayerContext } from './types';
import { dayOpportunities } from '../city/day';
import { nextDepartures } from '../city/next-departures';

export function renderGradSada(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  const model = buildTimeband(ctx);
  const sada = model.lanes.find(lane => lane.col === 'sada')!;
  const selected = model.selected;
  const weather = weatherStatus(i18n, ctx.snapshots, ctx.now);
  const observation = ctx.snapshots['dhmz-now']?.items[0];
  const next = model.lanes.filter(lane => lane.col !== 'sada' && (selected === 'sada' || lane.col === selected));
  const local = sada.tiles.filter(tile => tile.domain !== 'civic' && tile.domain !== 'transit');
  const civic = sada.tiles.filter(tile => tile.domain === 'civic');
  const link = (layer: string, label: string, aria?: string, testid?: string) => `<a class="day-link" data-action="nav" data-layer="${layer}" href="#layer=${layer}"${aria ? ` aria-label="${escapeAttribute(aria)}"` : ''}${testid ? ` data-testid="${testid}"` : ''}>${escapeHtml(label)}${iconMarkup('arrow-up-right', undefined, 'icon icon-sm')}</a>`;
  const event = (tile: Tile, col: string) => {
    const date = tile.at && zagrebDayKey(tile.at) !== zagrebDayKey(ctx.now) ? zagrebWeekdayDate(tile.at) : '';
    return `<div class="day-event" data-col="${escapeAttribute(col)}" data-key="ahead:${escapeAttribute(tile.key)}">${date ? `<p class="day-event-date">${escapeHtml(date)}</p>` : ''}${tileMarkup(i18n, tile)}</div>`;
  };
  const choices = model.columns.map(col => `<button class="day-time" type="button" data-action="filter" data-filter-key="${FILTER_KEY}" data-filter-value="${col.id}" aria-pressed="${selected === col.id}"${col.id === 'sada' ? ' data-testid="day-next-all"' : ''}>${escapeHtml(col.id === 'sada' ? i18n.t('timeband.next') : col.seg)}</button>`).join('');
  const feet = sada.foot.filter(foot=>foot.kind==='state'||foot.domain!=='transit').map(foot => foot.kind === 'state' ? foot.markup : link(foot.layer, foot.text, foot.aria, `tb-more-${foot.domain}`)).join('');
  const laneMarkup = next.map(lane => {
    if (!lane.tiles.length && !lane.foot.length && !lane.busy) return '';
    const column=model.columns.find(c=>c.id===lane.col)!;
    const body=lane.tiles.map(tile=>event(tile,lane.col)).join('');
    const more=lane.foot.map(f=>f.kind==='state'?f.markup:link(f.layer,f.text,f.aria,`tb-more-${f.domain}`)).join('');
    return `<section class="day-period" data-col="${lane.col}"><h4>${escapeHtml(column.label)}</h4>${body||more||lane.busy?'':`<p class="day-empty">${escapeHtml(i18n.t('timeband.laneEmpty'))}</p>`}${body}${lane.skeletons.map(s=>skeletonTileMarkup(s.variant,s.key)).join('')}<div class="day-more">${more}</div></section>`;
  }).join('');
  const weatherMarkup = weather
    ? `<a class="day-weather" href="#layer=zrak-i-nebo" data-action="nav" data-layer="zrak-i-nebo" data-testid="tb-weather" data-status="${weather.stale ? 'stale' : 'live'}" aria-label="${escapeAttribute(weather.aria)}"><span class="day-weather-now">${weather.icon ? iconMarkup(weather.icon) : ''}<strong>${escapeHtml(weather.temp)}</strong></span><span>${escapeHtml(weather.condition)}</span><span class="day-weather-source">${escapeHtml(`${weather.stale ? i18n.t('status.staleNote') + ' ' : ''}DHMZ${observation?.at ? ` · ${zagrebTime(observation.at)}` : ''}`)}</span></a>`
    : `<a class="day-weather day-weather-empty" href="#layer=zrak-i-nebo" data-action="nav" data-layer="zrak-i-nebo">${iconMarkup('cloud-sun')}<span>${escapeHtml(i18n.t('layers.zrak-i-nebo'))}</span><span class="day-weather-source">${escapeHtml(i18n.t(ctx.errors?.['dhmz-now'] || ctx.snapshots['dhmz-now']?.status === 'down' ? 'status.down' : 'status.loading'))}</span></a>`;
  return createElementFromHTML(`<section class="layer ws ws-overview" id="layer-grad-sada" data-layer="grad-sada" data-reconcile aria-labelledby="layer-title-grad-sada">
<header class="day-heading"><div><p class="day-date">${escapeHtml(zagrebWeekdayDate(ctx.now))} · <time class="day-clock" datetime="${new Date(ctx.now).toISOString()}">${escapeHtml(model.clock)}</time></p><h2 class="day-title layer-title" id="layer-title-grad-sada" tabindex="-1">${escapeHtml(i18n.t('cityOverview.title'))}</h2></div>${weatherMarkup}</header>
<div class="day-overview" data-testid="tb">
  <section class="day-now" aria-labelledby="day-now-title"><header class="day-section-head"><h3 id="day-now-title">${escapeHtml(i18n.t('cityOverview.nearby'))}</h3>${link('u-pokretu', i18n.t('layers.u-pokretu'))}</header>
    ${nextDepartures(ctx)}
    ${dayOpportunities(ctx)}
    <div class="day-facts" data-testid="tb-lane-sada" data-col="sada" aria-busy="${sada.busy}">${local.map(tile => tileMarkup(i18n, tile)).join('')}</div>
    <div class="day-more">${feet}</div>
  </section>
  <section class="day-ahead" aria-labelledby="day-ahead-title"><header class="day-section-head"><h3 id="day-ahead-title">${escapeHtml(i18n.t('cityOverview.next'))}</h3>${link('kultura', i18n.t('layers.kultura'))}</header>
    <div class="day-times" role="group" aria-label="${escapeAttribute(i18n.t('timeband.segLabel'))}" data-testid="tb-seg">${choices}</div>
    <div class="day-agenda" aria-busy="${next.some(l => l.busy)}">${laneMarkup}</div>
    ${civic.length ? `<section class="day-city"><header class="day-section-head"><h3>${escapeHtml(i18n.t('layers.uprava-i-pravo'))}</h3>${link('uprava-i-pravo', i18n.t('cityOverview.city'))}</header>${civic.map(tile => tileMarkup(i18n, tile)).join('')}</section>` : ''}
  </section>
</div>
${provenanceBlock(i18n, Object.values(ctx.snapshots) as (ModuleSnapshot | undefined)[])}
</section>`);
}
