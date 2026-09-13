// Grad: the Assembly's announced sessions, the communal works plan with the
// phases and amounts the register lists, and the searchable Official Gazette.
// No invented progress, expenditure or legal summary.
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import type { DogadanjaSourceId } from '../../../worker/feed/modules/dogadanja';
import { SKUPSTINA_YOUTUBE_URL } from '../../../worker/feed/modules/dogadanja/skupstina';
import { canExportCalendarItem } from '../export';
import { chip, externalLink, filterChips, findSelected, isSelected, itemActions, itemRow, listDetail, moduleExport, searchField, section, sectionHead } from '../experience/blocks';
import { coverageText, listState, provenanceBlock, statusBadge } from '../experience/status';
import { eventWhen, numberText } from '../experience/text';
import { zagrebWeekdayDate } from '../format';
import type { I18n } from '../i18n/i18n';
import { dataNumber, dataText } from '../panels/panel';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { bars } from '../ui/graphics';
import { filterBySource, sourceStatusEmptyText } from './kultura';
import type { LayerContext } from './types';

const CITY_WORK_SOURCE_TUPLE = ['skupstina', 'komunalne'] as const;
type CityWorkSource = (typeof CITY_WORK_SOURCE_TUPLE)[number];

/** The two of dogadanja's six sources that are the City's own administration. */
export const CITY_WORK_SOURCES: readonly DogadanjaSourceId[] = CITY_WORK_SOURCE_TUPLE;

const SOURCE_NAME: Record<CityWorkSource, string> = {
  skupstina: 'Skupština Grada Zagreba',
  komunalne: 'Plan komunalnih aktivnosti',
};
/** The kiosk card (grad-teaser.ts) reuses both strings. */
export const CITY_WORK_SOURCE_ATTRIBUTION: Record<CityWorkSource, string> = {
  skupstina: 'Skupština Grada Zagreba (Otvorena dozvola)',
  komunalne: 'Plan komunalnih aktivnosti, Grad Zagreb (Otvorena dozvola)',
};

/** The register's own closed phase vocabulary, in the order the works move through it. */
export const KNOWN_PHASES: readonly string[] = ['U pripremi', 'Ugovaranje', 'Provedba javne nabave', 'Izvođač uveden u posao', 'Radovi u tijeku', 'Završeni radovi'];

export function cityWorkEvents(snapshot: ModuleSnapshot | undefined): FeedItem[] {
  return filterBySource(snapshot, CITY_WORK_SOURCE_TUPLE);
}

export function cityWorkEmptyText(i18n: I18n, snapshot: ModuleSnapshot | undefined): string {
  return sourceStatusEmptyText(i18n, snapshot, CITY_WORK_SOURCE_TUPLE, SOURCE_NAME, 'panels.cityWorkEmpty');
}

function bySource(snapshot: ModuleSnapshot | undefined, source: CityWorkSource): FeedItem[] {
  return cityWorkEvents(snapshot).filter((item) => dataText(item, 'source') === source);
}

function sessionRow(i18n: I18n, item: FeedItem, ctx: LayerContext): string {
  const kind = i18n.t(dataText(item, 'category') === 'sjednica-skupstine' ? 'civic.plenary' : 'civic.committee');
  const organiser = dataText(item, 'organiser');
  const venue = dataText(item, 'venue');
  const body = `<span class="row-main"><span class="row-meta">${escapeHtml(kind)}${organiser ? ` · ${escapeHtml(organiser)}` : ''}</span><span class="row-title">${escapeHtml(item.title)}</span><span class="row-meta">${escapeHtml(eventWhen(i18n, item, ctx.now))}${venue ? ` · ${escapeHtml(venue)}` : ''}</span></span>`;
  return itemRow(item, body, { selected: isSelected(item, ctx.view?.selection), testid: 'city-work-row' });
}
function assemblySection(i18n: I18n, ctx: LayerContext): string {
  const dogadanja = ctx.snapshots.dogadanja;
  const sessions = bySource(dogadanja, 'skupstina');
  const upcoming = sessions
    .filter((item) => item.at && Date.parse(item.until ?? item.at) >= ctx.now)
    .sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!));
  const shown = upcoming.length ? upcoming : sessions.slice(0, 5);
  const state = listState(i18n, dogadanja, 'dogadanja', shown.length, i18n.t('civic.assemblyNone'), ctx.errors?.dogadanja);
  return section({
    id: 'cv-assembly', tone: 'civic', testid: 'cv-assembly',
    body: sectionHead(i18n, { kicker: SOURCE_NAME.skupstina, title: i18n.t(upcoming.length ? 'civic.assemblyUpcoming' : 'civic.assembly'), snapshot: dogadanja, error: ctx.errors?.dogadanja, id: 'cv-assembly-title' }) +
      (state || `<ul class="rows" role="list" data-testid="assembly-sessions">${shown.map((item) => sessionRow(i18n, item, ctx)).join('')}</ul>`),
  });
}

function workRow(i18n: I18n, item: FeedItem, ctx: LayerContext): string {
  const amount = dataNumber(item, 'amount');
  const changed = item.at ? ` · ${escapeHtml(i18n.t('civic.changed', { date: zagrebWeekdayDate(item.at) }))}` : '';
  const lead = amount !== null ? `<span class="row-lead"><span class="cv-amount">${escapeHtml(i18n.t('civic.amountValue', { amount: numberText(i18n, amount) }))}</span></span>` : '';
  const body = `<span class="row-main"><span class="row-title">${escapeHtml(item.title)}</span><span class="row-meta"><span class="badge badge-plain" data-tone="action">${escapeHtml(dataText(item, 'phase'))}</span> ${escapeHtml(dataText(item, 'status'))}${changed}</span>${item.summary ? `<span class="row-meta">${escapeHtml(item.summary)}</span>` : ''}</span>${lead}`;
  return itemRow(item, body, { selected: isSelected(item, ctx.view?.selection), testid: 'city-work-row' });
}

function normalise(value: string): string {
  return value.toLocaleLowerCase('hr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function matchesWork(item: FeedItem, query: string): boolean {
  const q = normalise(query.trim());
  return !q || [item.title, item.summary ?? '', dataText(item, 'phase')].some((v) => normalise(String(v)).includes(q));
}
function worksSection(i18n: I18n, ctx: LayerContext): string {
  const dogadanja = ctx.snapshots.dogadanja;
  const works = bySource(dogadanja, 'komunalne');
  const phase = ctx.view?.filters.phase ?? '';
  const query = ctx.view?.filters.wq ?? '';
  const counts = new Map<string, number>();
  for (const w of works) counts.set(dataText(w, 'phase'), (counts.get(dataText(w, 'phase')) ?? 0) + 1);
  const phases = KNOWN_PHASES.filter((p) => counts.has(p));
  const filtered = works.filter((w) => (!phase || dataText(w, 'phase') === phase) && matchesWork(w, query));
  const chips = filterChips([
    chip(i18n.t('civic.allPhases'), { action: 'filter', extra: { 'filter-key': 'phase', 'filter-value': '' }, selected: !phase, count: works.length }),
    ...phases.map((p) => chip(p, { action: 'filter', extra: { 'filter-key': 'phase', 'filter-value': p }, selected: phase === p, count: counts.get(p) })),
  ], i18n.t('civic.phase'));
  const figure = phases.length
    ? `<div class="cv-phases"><p class="kicker">${escapeHtml(i18n.t('civic.phasesTitle'))}</p>${bars(phases.map((p) => ({ id: p, label: p, value: counts.get(p)!, valueText: String(counts.get(p)), tone: 'action' as const })), Math.max(...counts.values()), i18n.t('civic.phasesTitle'), 150)}<p class="sec-note">${escapeHtml(i18n.t('civic.phasesNote'))}</p></div>`
    : '';
  const emptyText = phase || query ? i18n.t('civic.worksEmptyFiltered') : cityWorkEmptyText(i18n, dogadanja);
  const state = listState(i18n, dogadanja, 'dogadanja', filtered.length, emptyText, ctx.errors?.dogadanja);
  const coverage = coverageText(i18n, dogadanja);
  const toolbar = `<div class="ws-toolbar">${searchField({ id: 'works-search', key: 'wq', label: i18n.t('civic.searchWorks'), placeholder: i18n.t('civic.searchWorksPlaceholder'), value: query })}${chips}</div>`;
  return section({
    id: 'cv-works', tone: 'civic', className: 'cv-wide', testid: 'cv-works',
    body: sectionHead(i18n, { kicker: SOURCE_NAME.komunalne, title: i18n.t('civic.works'), snapshot: dogadanja, error: ctx.errors?.dogadanja, id: 'cv-works-title' }) +
      `<p class="sec-note">${escapeHtml(i18n.t('civic.worksIntro'))}</p>${figure}${toolbar}` +
      (state || `<ul class="rows" role="list" data-testid="works">${filtered.map((w) => workRow(i18n, w, ctx)).join('')}</ul>`) +
      `<p class="sec-note">${escapeHtml(i18n.t('civic.amountNote'))}${coverage ? ` · ${escapeHtml(coverage)}` : ''}</p>`,
  });
}
function actRow(i18n: I18n, act: FeedItem, ctx: LayerContext): string {
  const issue = i18n.t('civic.issue', { broj: dataText(act, 'broj'), godina: dataText(act, 'godina') });
  const body = `<span class="row-main"><span class="row-title">${escapeHtml(act.title)}</span><span class="row-meta">${escapeHtml(issue)}${act.at ? ` · ${escapeHtml(zagrebWeekdayDate(act.at))}` : ''}</span></span>`;
  return itemRow(act, body, { selected: isSelected(act, ctx.view?.selection), testid: 'act-row' });
}

function gazetteSection(i18n: I18n, ctx: LayerContext): string {
  const glasnik = ctx.snapshots.glasnik;
  const acts = glasnik?.items ?? [];
  const query = ctx.view?.filters.aq ?? '';
  const filtered = query.trim() ? acts.filter((a) => normalise(a.title).includes(normalise(query))) : acts;
  const first = acts[0];
  const issue = first
    ? `<div class="cv-issue" data-testid="gazette-issue"><span class="cv-issue-no">${escapeHtml(`${dataText(first, 'broj')}/${dataText(first, 'godina')}`)}</span><span class="meta">${first.at ? `${escapeHtml(i18n.t('civic.issuePublished', { date: zagrebWeekdayDate(first.at) }))} · ` : ''}${escapeHtml(i18n.t('civic.actsCount', { count: acts.length }))}</span></div>`
    : '';
  const toolbar = acts.length
    ? `<div class="ws-toolbar">${searchField({ id: 'acts-search', key: 'aq', label: i18n.t('civic.searchActs'), placeholder: i18n.t('civic.searchActsPlaceholder'), value: query })}</div>`
    : '';
  const state = listState(i18n, glasnik, 'glasnik', filtered.length, i18n.t(query ? 'civic.actsEmptyFiltered' : 'civic.actsEmpty'), ctx.errors?.glasnik);
  return section({
    id: 'cv-gazette', tone: 'civic', testid: 'cv-gazette',
    body: sectionHead(i18n, { kicker: i18n.t('freshness.referenca'), title: i18n.t('civic.gazette'), snapshot: glasnik, error: ctx.errors?.glasnik, id: 'cv-gazette-title' }) +
      issue + toolbar + (state || `<ul class="rows" role="list" data-testid="acts">${filtered.map((a) => actRow(i18n, a, ctx)).join('')}</ul>`) +
      `<p class="sec-note">${escapeHtml(i18n.t('civic.legalNote'))}</p>`,
  });
}
function facts(rows: [string, string][]): string {
  return `<dl class="detail-facts">${rows.filter(([, v]) => v).map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>`;
}

function detailFor(i18n: I18n, item: FeedItem, ctx: LayerContext): string {
  const source = dataText(item, 'source');
  const open = (id: string, kicker: string, body: string): string =>
    `<article class="detail" data-key="detail-${escapeAttribute(id)}" data-testid="civic-detail"><p class="kicker">${escapeHtml(kicker)}</p><h3 class="detail-title" id="ws-detail-title" tabindex="-1">${escapeHtml(item.title)}</h3>${body}</article>`;
  if (item.module === 'glasnik') {
    const body = facts([[i18n.t('civic.gazette'), i18n.t('civic.issue', { broj: dataText(item, 'broj'), godina: dataText(item, 'godina') })], [i18n.t('civic.issuePublished', { date: '' }).replace(/\s+$/, ''), item.at ? zagrebWeekdayDate(item.at) : '']]) +
      `<p class="sec-note">${escapeHtml(i18n.t('civic.legalNote'))}</p>${item.link ? externalLink(item.link, i18n.t('civic.openAct')) : ''}${itemActions(i18n, item, { print: true })}`;
    return open(item.id, i18n.t('civic.actDetail'), body);
  }
  if (source === 'komunalne') {
    const amount = dataNumber(item, 'amount');
    const body = facts([[i18n.t('civic.phase'), dataText(item, 'phase')], [i18n.t('civic.status'), dataText(item, 'status')], [i18n.t('civic.amount'), amount !== null ? i18n.t('civic.amountValue', { amount: numberText(i18n, amount) }) : ''], [i18n.t('time.labelUpdated', { when: '' }).replace(/:\s*$/, ''), item.at ? zagrebWeekdayDate(item.at) : ''], [i18n.t('events.source'), CITY_WORK_SOURCE_ATTRIBUTION.komunalne]]) +
      (item.summary ? `<p class="detail-summary">${escapeHtml(item.summary)}</p>` : '') + `<p class="sec-note">${escapeHtml(i18n.t('civic.amountNote'))}</p>${itemActions(i18n, item)}`;
    return open(item.id, SOURCE_NAME.komunalne, body);
  }
  const live = dataText(item, 'live') === 'youtube' ? externalLink(SKUPSTINA_YOUTUBE_URL, i18n.t('civic.watchLive')) : '';
  const body = facts([[i18n.t('events.when'), eventWhen(i18n, item, ctx.now)], [i18n.t('events.venue'), dataText(item, 'venue')], [i18n.t('events.organiser'), dataText(item, 'organiser')], [i18n.t('events.source'), CITY_WORK_SOURCE_ATTRIBUTION.skupstina]]) +
    `${item.link ? externalLink(item.link, i18n.t('common.openSource')) : ''}${live}${itemActions(i18n, item, { calendar: canExportCalendarItem(item) })}`;
  return open(item.id, i18n.t(dataText(item, 'category') === 'sjednica-skupstine' ? 'civic.plenary' : 'civic.committee'), body);
}

export function renderUpravaIPravo(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  const dogadanja = ctx.snapshots.dogadanja;
  const glasnik = ctx.snapshots.glasnik;
  const selected = findSelected(glasnik, ctx.view?.selection) ?? findSelected(dogadanja, ctx.view?.selection);
  const detail = selected && (selected.module === 'glasnik' || cityWorkEvents(dogadanja).includes(selected)) ? detailFor(i18n, selected, ctx) : null;
  // Assembly and gazette side by side, the long works register below them.
  const list = `<div class="cv-grid">${assemblySection(i18n, ctx)}${gazetteSection(i18n, ctx)}${worksSection(i18n, ctx)}</div>`;
  return createElementFromHTML(`<section class="layer ws ws-civic" id="layer-uprava-i-pravo" data-layer="uprava-i-pravo" data-reconcile aria-labelledby="layer-title-uprava-i-pravo">
<header class="ws-head"><div class="sec-title-row"><h2 class="layer-title" id="layer-title-uprava-i-pravo" tabindex="-1">${escapeHtml(i18n.t('layers.uprava-i-pravo'))}</h2>${statusBadge(i18n, dogadanja, ctx.errors?.dogadanja)}</div></header>
${listDetail(i18n, { list, detail, detailTitle: i18n.t('civic.actDetail') })}
${provenanceBlock(i18n, [dogadanja, glasnik])}
</section>`);
}
