// Grad: the Assembly's next session as a date, the Official Gazette's issue as
// a numeral over a searchable list of acts, and the communal works register
// with the phases and amounts it lists. Three blocks on one canvas, hairline
// apart; a head is a body or a source name, a status word lives in the badge.
// No invented progress, expenditure or legal summary; where the register is
// cut, the coverage line says so.
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import type { DogadanjaSourceId } from '../../../worker/feed/modules/dogadanja';
import { SKUPSTINA_YOUTUBE_URL } from '../../../worker/feed/modules/dogadanja/skupstina';
import { canExportCalendarItem } from '../export';
import { actionButton, chip, externalLink, filterChips, findSelected, isSelected, itemActions, itemRow, listDetail, searchField, section, sectionHead } from '../experience/blocks';
import { coverageText, listState, provenanceBlock, statusBadge } from '../experience/status';
import { eventWhen, intlLocale, numberText } from '../experience/text';
import { ZAGREB_TZ, zagrebTime, zagrebWeekdayDate } from '../format';
import type { I18n } from '../i18n/i18n';
import { dataNumber, dataText } from '../panels/panel';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { bars } from '../ui/graphics';
import { iconMarkup } from '../ui/icons';
import { filterBySource, sourceStatusEmptyText } from './kultura';
import type { LayerContext } from './types';
import { consultationsMarkup } from '../city/conditions';

/** One default page of Gazette acts; the search field narrows the list first, so a search always covers every act. */
const ACTS_PAGE = 10;
/** One default page of communal works; the phase chips and the search narrow the list first, so a filter always covers every match. */
const WORKS_PAGE = 8;
/** Sessions listed as rows after the next one's lockup, and past sessions kept when nothing is announced. */
const SESSION_ROWS = 3;

const CITY_WORK_SOURCE_TUPLE = ['skupstina', 'komunalne'] as const;
type CityWorkSource = (typeof CITY_WORK_SOURCE_TUPLE)[number];

/** The two of dogadanja's six sources that are the City's own administration. */
export const CITY_WORK_SOURCES: readonly DogadanjaSourceId[] = CITY_WORK_SOURCE_TUPLE;

const SOURCE_NAME: Record<CityWorkSource, string> = {
  skupstina: 'Skupština Grada Zagreba',
  komunalne: 'Plan komunalnih aktivnosti',
};
/** Per-source attribution naming the licence, as a civic item's detail prints it. */
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

// Zagreb wall-clock formatters for the session date, one per locale: the
// numeral of the day and the month word ("14" over "ruj"), and the short
// weekday ("pon") that opens the time line. format.ts keeps the full dates;
// these two parts are the calendar tile's own.
const DAY_MONTH = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY = new Map<string, Intl.DateTimeFormat>();
function formatter(cache: Map<string, Intl.DateTimeFormat>, locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let f = cache.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: ZAGREB_TZ, ...options });
    cache.set(locale, f);
  }
  return f;
}

/** The session's calendar tile: the day numeral over the month word, `l` for the next session, `s` for the rows after it. */
function dateTile(i18n: I18n, at: string, size: 'l' | 's'): string {
  const parts = formatter(DAY_MONTH, intlLocale(i18n), { day: 'numeric', month: 'short' }).formatToParts(new Date(at));
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `<span class="row-lead cv-date" data-size="${size}"><span class="cv-day">${escapeHtml(part('day'))}</span><span class="cv-month">${escapeHtml(part('month'))}</span></span>`;
}

/** "pon 11:00", or "pon, cijeli dan" when the source gave the day alone: the tile already carries the date. */
function sessionWhen(i18n: I18n, item: FeedItem): string {
  const weekday = formatter(WEEKDAY, intlLocale(i18n), { weekday: 'short' }).format(new Date(item.at!));
  return dataText(item, 'precision') === 'time' ? `${weekday} ${zagrebTime(item.at)}` : `${weekday}, ${i18n.t('time.allDay')}`;
}

/**
 * A session row: the date tile, the title, the weekday, time and venue. The
 * row is the select control (blocks.ts itemRow's protocol: `data-action`,
 * `data-module`, `data-item-id`, `aria-current`), built here because the
 * next session also carries the livestream link, which must sit beside the
 * button, never inside it.
 */
function sessionRow(i18n: I18n, item: FeedItem, ctx: LayerContext, next: boolean): string {
  const venue = dataText(item, 'venue');
  const sub = [sessionWhen(i18n, item), venue].filter(Boolean).join(' · ');
  const selected = isSelected(item, ctx.view?.selection);
  const live = next && dataText(item, 'live') === 'youtube' ? externalLink(SKUPSTINA_YOUTUBE_URL, i18n.t('civic.live'), 'link-ext cv-live') : '';
  return `<li class="row${next ? ' cv-next' : ''}" data-key="${escapeAttribute(item.id)}" data-testid="city-work-row"><button type="button" class="row-button" data-action="select" data-module="${escapeAttribute(item.module)}" data-item-id="${escapeAttribute(item.id)}" aria-current="${selected ? 'true' : 'false'}">${dateTile(i18n, item.at!, next ? 'l' : 's')}<span class="row-main"><span class="row-title">${escapeHtml(item.title)}</span><span class="row-sub">${escapeHtml(sub)}</span></span>${iconMarkup('chevron-right', undefined, 'icon row-chevron')}</button>${live}</li>`;
}

/** Gradska skupština: the next session as a date, up to three more as rows; past sessions only under their own word when nothing is announced. */
function sessionsSection(i18n: I18n, ctx: LayerContext): string {
  const dogadanja = ctx.snapshots.dogadanja;
  const sessions = bySource(dogadanja, 'skupstina').filter((item) => item.at && Number.isFinite(Date.parse(item.at)));
  const upcoming = sessions
    .filter((item) => Date.parse(item.until ?? item.at!) >= ctx.now)
    .sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!));
  const state = listState(i18n, dogadanja, 'dogadanja', upcoming.length, i18n.t('civic.assemblyNone'), ctx.errors?.dogadanja);
  let body: string;
  if (!state) {
    const [next, ...rest] = upcoming;
    body = `<ul class="rows" role="list" data-testid="assembly-sessions">${sessionRow(i18n, next, ctx, true)}${rest.slice(0, SESSION_ROWS).map((item) => sessionRow(i18n, item, ctx, false)).join('')}</ul>`;
  } else {
    const past = sessions.filter((item) => !upcoming.includes(item)).sort((a, b) => Date.parse(b.at!) - Date.parse(a.at!)).slice(0, SESSION_ROWS);
    body = state + (past.length && dogadanja?.status !== 'down'
      ? `<p class="cv-subhead">${escapeHtml(i18n.t('civic.pastSessions'))}</p><ul class="rows" role="list" data-testid="assembly-sessions">${past.map((item) => sessionRow(i18n, item, ctx, false)).join('')}</ul>`
      : '');
  }
  return section({
    id: 'cv-sessions', tone: 'civic', className: 'cv-sec', testid: 'cv-sessions',
    body: sectionHead(i18n, { title: i18n.t('civic.assembly'), snapshot: dogadanja, error: ctx.errors?.dogadanja, id: 'cv-sessions-title' }) + body,
  });
}

/** A work: where, the phase word under it, the planned amount tabular at the row's end. What the work is stays with its detail. */
function workRow(i18n: I18n, item: FeedItem, ctx: LayerContext): string {
  const amount = dataNumber(item, 'amount');
  const phase = dataText(item, 'phase');
  const trail = amount !== null ? `<span class="cv-amount">${escapeHtml(i18n.t('civic.amountValue', { amount: numberText(i18n, amount) }))}</span>` : '';
  const body = `<span class="row-main"><span class="row-title">${escapeHtml(item.title)}</span>${phase ? `<span class="row-sub">${escapeHtml(phase)}</span>` : ''}</span>${trail}`;
  return itemRow(item, body, { selected: isSelected(item, ctx.view?.selection), testid: 'city-work-row' });
}

function normalise(value: string): string {
  return value.toLocaleLowerCase('hr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function matchesWork(item: FeedItem, query: string): boolean {
  const q = normalise(query.trim());
  return !q || [item.title, item.summary ?? '', dataText(item, 'phase')].some((v) => normalise(String(v)).includes(q));
}

/** Komunalni radovi: chips, search, eight rows then more, the coverage line, and on a desk the phases counted as bars. */
function worksSection(i18n: I18n, ctx: LayerContext): string {
  const dogadanja = ctx.snapshots.dogadanja;
  const works = bySource(dogadanja, 'komunalne').sort((a,b)=>Number(/tijek|uveden/i.test(dataText(b,'phase')))-Number(/tijek|uveden/i.test(dataText(a,'phase'))));
  const phase = ctx.view?.filters.phase ?? '';
  const query = ctx.view?.filters.wq ?? '';
  const counts = new Map<string, number>();
  for (const w of works) counts.set(dataText(w, 'phase'), (counts.get(dataText(w, 'phase')) ?? 0) + 1);
  const phases = KNOWN_PHASES.filter((p) => counts.has(p));
  const filtered = works.filter((w) => (!phase || dataText(w, 'phase') === phase) && matchesWork(w, query));
  const chips = `<label class="ev-category"><span>${escapeHtml(i18n.t('civic.phase'))}</span><select data-filter-key="phase"><option value="">${escapeHtml(i18n.t('civic.allPhases'))} (${works.length})</option>${phases.map(p=>`<option value="${escapeAttribute(p)}"${phase===p?' selected':''}>${escapeHtml(p)} (${counts.get(p)})</option>`).join('')}</select></label>`;
  // The figure names itself through its caption; the bar list carries no second name of its own.
  const figure = phases.length
    ? `<figure class="cv-phases"><figcaption>${escapeHtml(i18n.t('civic.phasesTitle'))}</figcaption>${bars(phases.map((p) => ({ id: p, label: p, value: counts.get(p)!, valueText: String(counts.get(p)), tone: 'action' as const })), Math.max(...counts.values()))}<p class="sec-note">${escapeHtml(i18n.t('civic.phasesNote'))}</p></figure>`
    : '';
  const emptyText = phase || query ? i18n.t('civic.worksEmptyFiltered') : cityWorkEmptyText(i18n, dogadanja);
  const state = listState(i18n, dogadanja, 'dogadanja', filtered.length, emptyText, ctx.errors?.dogadanja);
  const coverage = coverageText(i18n, dogadanja);
  const toolbar = `<div class="ws-toolbar">${searchField({ id: 'works-search', key: 'wq', label: i18n.t('civic.searchWorks'), placeholder: i18n.t('civic.searchWorksPlaceholder'), value: query })}${chips}</div>`;
  const shownWorks = Math.min(filtered.length, Number(ctx.view?.filters.works) || WORKS_PAGE);
  const moreWorks = shownWorks < filtered.length
    ? actionButton('filter', i18n.t('common.showMore', { count: Math.min(WORKS_PAGE, filtered.length - shownWorks) }), { className: 'btn-ghost sf-more', extra: { 'filter-key': 'works', 'filter-value': shownWorks + WORKS_PAGE } })
    : '';
  return section({
    id: 'cv-works', tone: 'civic', className: 'cv-sec cv-wide', testid: 'cv-works',
    body: sectionHead(i18n, { title: i18n.t('civic.works'), snapshot: dogadanja, error: ctx.errors?.dogadanja, id: 'cv-works-title' }) +
      `<p class="sec-note">${escapeHtml(i18n.t('civic.worksIntro'))}</p>${toolbar}` +
      (state || `<ul class="rows" role="list" data-testid="works">${filtered.slice(0, shownWorks).map((w) => workRow(i18n, w, ctx)).join('')}</ul>${moreWorks}`) +
      (figure?`<details class="cv-phase-reference"><summary>${escapeHtml(i18n.t('civic.phasesTitle'))}</summary>${figure}</details>`:'') +
      `<p class="sec-note">${escapeHtml(i18n.t('civic.amountNote'))}${coverage ? ` · ${escapeHtml(coverage)}` : ''}</p>`,
  });
}

function actRow(i18n: I18n, act: FeedItem, ctx: LayerContext): string {
  const issue = i18n.t('civic.issue', { broj: dataText(act, 'broj'), godina: dataText(act, 'godina') });
  const body = `<span class="row-main"><span class="row-title">${escapeHtml(act.title)}</span><span class="row-sub">${escapeHtml(issue)}${act.at ? ` · ${escapeHtml(zagrebWeekdayDate(act.at))}` : ''}</span></span>`;
  return itemRow(act, body, { selected: isSelected(act, ctx.view?.selection), testid: 'act-row' });
}

/** Službeni glasnik: the source name as head, the issue as a numeral over the line that dates it and names it a reference once, search, ten acts then more. */
function gazetteSection(i18n: I18n, ctx: LayerContext): string {
  const glasnik = ctx.snapshots.glasnik;
  const acts = glasnik?.items ?? [];
  const query = ctx.view?.filters.aq ?? '';
  const matches = query.trim() ? acts.filter((a) => normalise(a.title).includes(normalise(query))) : acts;
  const shown = Math.min(matches.length, Number(ctx.view?.filters.acts) || ACTS_PAGE);
  const visible = matches.slice(0, shown);
  const more = shown < matches.length
    ? actionButton('filter', i18n.t('common.showMore', { count: Math.min(ACTS_PAGE, matches.length - shown) }), { className: 'btn-ghost sf-more', extra: { 'filter-key': 'acts', 'filter-value': shown + ACTS_PAGE } })
    : '';
  // The count line only when the list is cut: "prikazano 10 od 118" beside the button that extends it, never "1 od 1".
  const coverage = shown < matches.length ? `<p class="sec-note">${escapeHtml(i18n.t('status.coverage', { shown, total: matches.length }))}</p>` : '';
  const badge = statusBadge(i18n, glasnik, ctx.errors?.glasnik);
  const first = acts[0];
  const metaText = first
    ? [first.at ? i18n.t('civic.issuePublished', { date: zagrebWeekdayDate(first.at) }) : '', i18n.t('civic.actsCount', { count: acts.length })].filter(Boolean).join(' · ')
    : '';
  const meta = metaText || badge ? `<p class="cv-issue-meta">${metaText ? `<span>${escapeHtml(metaText)}</span>` : ''}${badge}</p>` : '';
  const issue = first
    ? `<div class="cv-issue" data-testid="gazette-issue"><span class="cv-issue-no">${escapeHtml(`${dataText(first, 'broj')}/${dataText(first, 'godina')}`)}</span>${meta}</div>`
    : meta;
  const toolbar = acts.length
    ? `<div class="ws-toolbar">${searchField({ id: 'acts-search', key: 'aq', label: i18n.t('civic.searchActs'), placeholder: i18n.t('civic.searchActsPlaceholder'), value: query })}</div>`
    : '';
  const state = listState(i18n, glasnik, 'glasnik', matches.length, i18n.t(query ? 'civic.actsEmptyFiltered' : 'civic.actsEmpty'), ctx.errors?.glasnik);
  return section({
    id: 'cv-gazette', tone: 'civic', className: 'cv-sec', testid: 'cv-gazette',
    body: sectionHead(i18n, { title: i18n.t('civic.gazette'), id: 'cv-gazette-title', noStatus: true }) +
      issue + toolbar + (state || `<ul class="rows" role="list" data-testid="acts">${visible.map((a) => actRow(i18n, a, ctx)).join('')}</ul>${more}${coverage}`) +
      `<p class="sec-note">${escapeHtml(i18n.t('civic.legalNote'))}</p>`,
  });
}

/** Labelled facts: a noun from the catalogue, then the value; an empty value drops its row. */
function facts(rows: [string, string][]): string {
  return `<dl class="detail-facts">${rows.filter(([, v]) => v).map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>`;
}

function detailFor(i18n: I18n, item: FeedItem, ctx: LayerContext): string {
  const source = dataText(item, 'source');
  // The kind line keeps the `kicker` class name for the print gate
  // (e2e/experience.spec.ts pins `.kicker` inside civic-detail); `.cv-kind`
  // sets it in sentence case at the secondary role, no capitals, no tone.
  const open = (id: string, kind: string, body: string): string =>
    `<article class="detail cv-detail" data-key="detail-${escapeAttribute(id)}" data-testid="civic-detail"><p class="kicker cv-kind">${escapeHtml(kind)}</p><h3 class="detail-title" id="ws-detail-title" tabindex="-1">${escapeHtml(item.title)}</h3>${body}</article>`;
  const date = item.at ? zagrebWeekdayDate(item.at) : '';
  if (item.module === 'glasnik') {
    const body = facts([[i18n.t('civic.labels.number'), `${dataText(item, 'broj')}/${dataText(item, 'godina')}`], [i18n.t('civic.labels.published'), date]]) +
      `<p class="sec-note">${escapeHtml(i18n.t('civic.legalNote'))}</p>${item.link ? externalLink(item.link, i18n.t('common.openSource')) : ''}${itemActions(i18n, item, { print: true })}`;
    return open(item.id, i18n.t('civic.actDetail'), body);
  }
  if (source === 'komunalne') {
    const amount = dataNumber(item, 'amount');
    const body = facts([
      [i18n.t('civic.phase'), dataText(item, 'phase')],
      [i18n.t('civic.status'), dataText(item, 'status')],
      [i18n.t('civic.amount'), amount !== null ? i18n.t('civic.amountValue', { amount: numberText(i18n, amount) }) : ''],
      [i18n.t('civic.labels.sourceChanged'), date],
      [i18n.t('events.source'), CITY_WORK_SOURCE_ATTRIBUTION.komunalne],
    ]) + (item.summary ? `<p class="detail-summary">${escapeHtml(item.summary)}</p>` : '') + `<p class="sec-note">${escapeHtml(i18n.t('civic.amountNote'))}</p>${itemActions(i18n, item)}`;
    return open(item.id, SOURCE_NAME.komunalne, body);
  }
  const live = dataText(item, 'live') === 'youtube' ? externalLink(SKUPSTINA_YOUTUBE_URL, i18n.t('civic.watchLive')) : '';
  const body = facts([
    [i18n.t('civic.labels.when'), eventWhen(i18n, item, ctx.now)],
    [i18n.t('civic.labels.venue'), dataText(item, 'venue')],
    [i18n.t('civic.labels.body'), dataText(item, 'organiser')],
    [i18n.t('events.source'), CITY_WORK_SOURCE_ATTRIBUTION.skupstina],
  ]) + `${item.link ? externalLink(item.link, i18n.t('common.openSource')) : ''}${live}${itemActions(i18n, item, { calendar: canExportCalendarItem(item) })}`;
  return open(item.id, i18n.t(dataText(item, 'category') === 'sjednica-skupstine' ? 'civic.plenary' : 'civic.committee'), body);
}

export function renderUpravaIPravo(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  const dogadanja = ctx.snapshots.dogadanja;
  const glasnik = ctx.snapshots.glasnik;
  const selected = findSelected(glasnik, ctx.view?.selection) ?? findSelected(dogadanja, ctx.view?.selection);
  const detail = selected && (selected.module === 'glasnik' || cityWorkEvents(dogadanja).includes(selected)) ? detailFor(i18n, selected, ctx) : null;
  // Sessions and gazette side by side on a desk, the long works register below them.
  const list = `<div class="cv-grid"><div class="cv-column">${worksSection(i18n, ctx)}</div><div class="cv-column">${sessionsSection(i18n, ctx)}${gazetteSection(i18n, ctx)}${consultationsMarkup(ctx)}</div></div>`;
  // The domain's name is the tab's; it stays for assistive technology and the focus after a switch, not as a repeated title.
  return createElementFromHTML(`<section class="layer ws ws-civic" id="layer-uprava-i-pravo" data-layer="uprava-i-pravo" data-reconcile aria-labelledby="layer-title-uprava-i-pravo">
<h2 class="layer-title visually-hidden" id="layer-title-uprava-i-pravo" tabindex="-1">${escapeHtml(i18n.t('layers.uprava-i-pravo'))}</h2>
<nav class="cv-jump" aria-label="${escapeAttribute(i18n.t('layers.uprava-i-pravo'))}">${[['cv-works',i18n.t('civic.works')],['cv-sessions',i18n.t('civic.assembly')],['cv-gazette',i18n.t('civic.gazette')],['cv-consultations',i18n.t('civic.consultations')]].map(([id,label])=>`<button type="button" data-action="section-jump" data-id="${id}">${escapeHtml(label)}</button>`).join('')}</nav>
${listDetail(i18n, { list, detail, detailTitle: i18n.t('civic.actDetail') })}
${provenanceBlock(i18n, [dogadanja, glasnik])}
</section>`);
}
