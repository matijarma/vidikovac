// Sigurnost: the same content /hitno shows everyone without a script, inside
// the session and in the same order of priority: the state now, the numbers,
// warnings, closures, pharmacies, quakes and assembly points. An unavailable
// source is unknown, never all-clear.
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import { EMERGENCY_NUMBERS, EMERGENCY_NUMBERS_SOURCE } from '../../../worker/hitno/brojevi';
import { LJEKARNE, LJEKARNE_CHECKED_ON, LJEKARNE_SOURCE } from '../../../worker/hitno/ljekarne';
import { externalLink, moduleExport, searchField, section, sectionHead } from '../experience/blocks';
import { isActiveWarning, safetyState, type SafetyState } from '../experience/safety-state';
import { attributionFoot, coverageText, listState, stateBlock, unconfirmed } from '../experience/status';
import { distanceKm, numberText, pointOf, relativeTime, ZAGREB_LON_LAT } from '../experience/text';
import { zagrebDateTime, zagrebTime, zagrebWeekdayDate } from '../format';
import type { I18n } from '../i18n/i18n';
import { dataNumber, dataText } from '../panels/panel';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import type { LayerContext } from './types';

export const ASSEMBLY_LAYER = 'zborna-mjesta';
const ASSEMBLY_PREVIEW = 12;

function sourceFoot(text: string, url: string, i18n: I18n): string {
  return `<footer class="source"><p class="source-line"><span class="source-text">${escapeHtml(text)}</span> ${externalLink(url, i18n.t('common.openSource'), 'source-link')}</p></footer>`;
}

function levelHeader(i18n: I18n, state: SafetyState): string {
  const icon = state.level === 'urgent' ? 'siren' : state.level === 'calm' ? 'check-circle' : 'alert-circle';
  const title = state.level === 'urgent' ? i18n.t('safety.urgent') : state.level === 'calm' ? i18n.t('safety.calm') : i18n.t('directory.safetySummaryUnknown');
  const note = state.level === 'calm' && state.confirmedAt
    ? i18n.t('safety.calmNote', { time: zagrebTime(state.confirmedAt) })
    : state.level === 'unknown' ? i18n.t('safety.unknownNote') : '';
  return `<div class="sf-level" data-level="${state.level}" data-testid="safety-level" role="status"><p class="sf-level-title">${iconMarkup(icon)}<span>${escapeHtml(title)}</span></p>${note ? `<p class="meta">${escapeHtml(note)}</p>` : ''}<p class="meta">${escapeHtml(i18n.t('safety.intro'))} <a href="/hitno" data-testid="hitno-link">${escapeHtml(i18n.t('safety.openHitno'))}</a></p></div>`;
}

function numbersSection(i18n: I18n): string {
  const items = EMERGENCY_NUMBERS.map((n, index) =>
    `<li><a class="sf-number${index === 0 ? ' sf-number-primary' : ''}" href="tel:${escapeAttribute(n.number)}" aria-label="${escapeAttribute(`${i18n.t('safety.call', { number: n.number })}: ${n.label}`)}"><span class="sf-number-value">${escapeHtml(n.number)}</span><span class="sf-number-label">${escapeHtml(n.label)}</span></a></li>`).join('');
  return section({
    id: 'sf-numbers', tone: 'urgency', className: 'sf-wide', testid: 'sf-numbers',
    body: sectionHead(i18n, { title: i18n.t('safety.numbers'), id: 'sf-numbers-title', noStatus: true }) + `<ul class="sf-numbers" role="list">${items}</ul>` + sourceFoot(EMERGENCY_NUMBERS_SOURCE.text, EMERGENCY_NUMBERS_SOURCE.url, i18n),
  });
}
function warningRow(i18n: I18n, w: FeedItem, now: number): string {
  const severity = w.severity ?? 'info';
  const until = w.until ? ` · ${escapeHtml(i18n.t('panels.until', { time: zagrebDateTime(w.until) }))}` : '';
  return `<li data-key="${escapeAttribute(w.id)}" data-testid="safety-warning"><span class="row-main"><span class="row-title"><span class="badge badge-sev" data-tone="${severity}">${escapeHtml(i18n.t(`panels.severity.${severity}`))}</span> ${escapeHtml(w.title)}</span><span class="row-meta">${escapeHtml(i18n.t(isActiveWarning(w, now) ? 'weather.active' : 'weather.announced'))}${until}</span>${w.summary ? `<span class="detail-summary">${escapeHtml(w.summary)}</span>` : ''}</span></li>`;
}

function warningsSection(i18n: I18n, ctx: LayerContext, state: SafetyState): string {
  const cap = ctx.snapshots['dhmz-cap'];
  const items = state.warnings;
  const list = listState(i18n, cap, 'dhmz-cap', items.length, i18n.t('weather.warningsNone'), ctx.errors?.['dhmz-cap'])
    || `<ul class="rows-plain" role="list" data-testid="safety-warnings">${items.map((w) => warningRow(i18n, w, ctx.now)).join('')}</ul>`;
  return section({
    id: 'sf-warnings', tone: 'urgency', testid: 'sf-warnings',
    body: sectionHead(i18n, { title: i18n.t('safety.warnings'), snapshot: cap, error: ctx.errors?.['dhmz-cap'], id: 'sf-warnings-title' }) + list + attributionFoot(i18n, cap),
  });
}

function closureRow(i18n: I18n, c: FeedItem): string {
  const type = i18n.t(`panels.closureType.${dataText(c, 'subtype') || 'ROAD_CLOSED'}`);
  const direction = i18n.t(`panels.direction.${dataText(c, 'direction') || 'BOTH_DIRECTIONS'}`);
  const since = c.at ? ` · ${escapeHtml(i18n.t('safety.since', { time: zagrebDateTime(c.at) }))}` : '';
  const end = c.until ? i18n.t('safety.reopening', { time: zagrebDateTime(c.until) }) : i18n.t('safety.noEnd');
  return `<li data-key="${escapeAttribute(c.id)}" data-testid="closure-row"><span class="row-main"><span class="row-title">${escapeHtml(c.title)}</span><span class="row-meta">${escapeHtml(type)} · ${escapeHtml(direction)}${since} · ${escapeHtml(end)}</span></span></li>`;
}

function closuresSection(i18n: I18n, ctx: LayerContext, state: SafetyState): string {
  const roads = ctx.snapshots.prometnice;
  const items = state.activeClosures;
  const list = listState(i18n, roads, 'prometnice', items.length, i18n.t('safety.closuresNone'), ctx.errors?.prometnice)
    || `<ul class="rows-plain" role="list" data-testid="safety-closures">${items.map((c) => closureRow(i18n, c)).join('')}</ul>`;
  const exports = roads && roads.items.length
    ? `<div class="actions">${moduleExport('geojson', 'prometnice', i18n.t('export.geojsonAll'))}${moduleExport('ics', 'prometnice', i18n.t('export.icsAll'))}</div>`
    : '';
  return section({
    id: 'sf-closures', tone: 'transit', testid: 'sf-closures',
    body: sectionHead(i18n, { title: i18n.t('safety.closures'), snapshot: roads, error: ctx.errors?.prometnice, id: 'sf-closures-title' }) + list + exports + attributionFoot(i18n, roads),
  });
}
function pharmaciesSection(i18n: I18n): string {
  const rows = LJEKARNE.map((p, index) => {
    const call = p.phoneE164 && p.phoneDisplay
      ? `<a class="btn-ghost sf-call" href="tel:${escapeAttribute(p.phoneE164)}">${iconMarkup('phone')}<span>${escapeHtml(i18n.t('safety.call', { number: p.phoneDisplay }))}</span></a>`
      : `<span class="row-meta">${escapeHtml(i18n.t('safety.noPhone'))}</span>`;
    return `<li data-key="ph-${index}" data-testid="pharmacy"><div class="sf-pharmacy"><span class="row-title">${escapeHtml(p.label)}</span><span class="row-meta">${escapeHtml(p.address)}</span><span class="row-meta">${escapeHtml(p.hours)} · ${escapeHtml(p.operator)}</span>${call}</div></li>`;
  }).join('');
  const checked = zagrebWeekdayDate(`${LJEKARNE_CHECKED_ON}T12:00:00Z`);
  return section({
    id: 'sf-pharmacies', tone: 'action', testid: 'sf-pharmacies',
    body: sectionHead(i18n, { title: i18n.t('safety.pharmacies'), id: 'sf-pharmacies-title', noStatus: true }) +
      `<p class="sec-note">${escapeHtml(i18n.t('safety.pharmaciesNote', { date: checked }))}</p><ul class="rows-plain" role="list">${rows}</ul>` + sourceFoot(LJEKARNE_SOURCE.text, LJEKARNE_SOURCE.url, i18n),
  });
}

function quakeRow(i18n: I18n, q: FeedItem, now: number): string {
  const mag = dataNumber(q, 'mag');
  const depth = dataNumber(q, 'depth');
  const point = pointOf(q);
  const km = point ? Math.round(distanceKm(point[0], point[1], ZAGREB_LON_LAT[0], ZAGREB_LON_LAT[1])) : null;
  const meta = [relativeTime(i18n, q.at, now), km !== null ? i18n.t('weather.quakeDistance', { km }) : '', depth !== null ? i18n.t('panels.quakeDepth', { depth }) : ''].filter(Boolean).join(' · ');
  return `<li data-key="${escapeAttribute(q.id)}" data-testid="safety-quake"><span class="row-main"><span class="row-title">${escapeHtml(i18n.t('panels.quakeMag', { mag: numberText(i18n, mag ?? 0, 1) }))} · ${escapeHtml(dataText(q, 'region') || q.title)}</span><span class="row-meta">${escapeHtml(meta)}</span></span></li>`;
}

function quakesSection(i18n: I18n, ctx: LayerContext, state: SafetyState): string {
  const emsc = ctx.snapshots.emsc;
  const items = state.quakes72h;
  const list = listState(i18n, emsc, 'emsc', items.length, i18n.t('safety.quakesNone'), ctx.errors?.emsc)
    || `<ul class="rows-plain" role="list" data-testid="safety-quakes">${items.map((q) => quakeRow(i18n, q, ctx.now)).join('')}</ul>`;
  return section({
    id: 'sf-quakes', tone: 'urgency', testid: 'sf-quakes',
    body: sectionHead(i18n, { title: i18n.t('safety.quakes'), snapshot: emsc, error: ctx.errors?.emsc, id: 'sf-quakes-title' }) + list + attributionFoot(i18n, emsc),
  });
}
function normalise(value: string): string {
  return value.toLocaleLowerCase('hr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function assemblyPoints(snapshot: ModuleSnapshot | undefined): FeedItem[] {
  return (snapshot?.items ?? []).filter((item) => dataText(item, 'layer') === ASSEMBLY_LAYER);
}

function osmLink(item: FeedItem): string | null {
  const point = pointOf(item);
  return point ? `https://www.openstreetmap.org/?mlat=${point[1]}&mlon=${point[0]}#map=17/${point[1]}/${point[0]}` : null;
}

function pointRow(i18n: I18n, p: FeedItem): string {
  const osm = osmLink(p);
  const map = osm ? ` · <a href="${escapeAttribute(osm)}" rel="noopener noreferrer" target="_blank">${escapeHtml(i18n.t('safety.mapLink'))}</a>` : '';
  return `<li data-key="${escapeAttribute(p.id)}" data-testid="assembly-point"><span class="row-main"><span class="row-title">${escapeHtml(p.title)}</span><span class="row-meta">${escapeHtml(p.summary ?? '')}${map}</span></span></li>`;
}

function assemblySection(i18n: I18n, ctx: LayerContext): string {
  const geo = ctx.snapshots['ckan-geo'];
  const all = assemblyPoints(geo);
  const query = ctx.view?.filters.zborna ?? '';
  const showAll = ctx.view?.filters['zborna-all'] === '1';
  const filtered = query.trim() ? all.filter((p) => normalise(`${p.title} ${p.summary ?? ''}`).includes(normalise(query))) : all;
  const shown = showAll || query ? filtered : filtered.slice(0, ASSEMBLY_PREVIEW);
  const down = geo?.sources?.[ASSEMBLY_LAYER]?.status === 'down';
  let body = down
    ? stateBlock(i18n, 'down', i18n.t('safety.assemblyUnknown'), { retry: 'ckan-geo', testid: 'assembly-unknown' })
    : listState(i18n, geo, 'ckan-geo', all.length, i18n.t('safety.assemblyUnknown'), ctx.errors?.['ckan-geo']);
  if (!body) {
    const more = !showAll && !query && filtered.length > shown.length
      ? `<button type="button" class="btn-ghost sf-more" data-action="filter" data-filter-key="zborna-all" data-filter-value="1">${escapeHtml(i18n.t('safety.showAll', { count: filtered.length }))}</button>`
      : '';
    const list = filtered.length
      ? `<ul class="rows-plain" role="list" data-testid="assembly-points">${shown.map((p) => pointRow(i18n, p)).join('')}</ul>${more}`
      : stateBlock(i18n, 'empty', i18n.t('safety.assemblyNone'));
    const coverage = coverageText(i18n, geo);
    body = `<p>${escapeHtml(i18n.t('safety.assemblyIntro', { count: all.length }))}</p>${searchField({ id: 'assembly-search', key: 'zborna', label: i18n.t('safety.assemblySearch'), placeholder: i18n.t('safety.assemblySearch'), value: query })}${list}${coverage ? `<p class="sec-note">${escapeHtml(coverage)}</p>` : ''}`;
  }
  return section({
    id: 'sf-assembly', tone: 'action', className: 'sf-wide', testid: 'sf-assembly',
    body: sectionHead(i18n, { title: i18n.t('safety.assembly'), snapshot: geo, error: ctx.errors?.['ckan-geo'], id: 'sf-assembly-title' }) + body + attributionFoot(i18n, geo),
  });
}
export function renderSigurnost(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  const state = safetyState(ctx.snapshots, ctx.now);
  return createElementFromHTML(`<section class="layer ws ws-safety" id="layer-sigurnost" data-layer="sigurnost" data-reconcile aria-labelledby="layer-title-sigurnost" data-level="${state.level}">
<header class="ws-head"><h2 class="layer-title" id="layer-title-sigurnost" tabindex="-1">${escapeHtml(i18n.t('layers.sigurnost'))}</h2></header>
${levelHeader(i18n, state)}
<div class="sf-grid">${numbersSection(i18n)}${warningsSection(i18n, ctx, state)}${closuresSection(i18n, ctx, state)}${pharmaciesSection(i18n)}${quakesSection(i18n, ctx, state)}${assemblySection(i18n, ctx)}</div>
</section>`);
}
