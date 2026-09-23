// Događanja: a dated agenda from the culture and community sources of the
// dogadanja module (Kulturpunkt, Etnografski muzej, kvartovske novosti). The
// search and one row of category chips come first, a count line under them,
// then the agenda under day heads, what is running apart with its end date,
// the undated notices in a well and venues outside Zagreb folded away. A
// date-only entry is all day; a notice without an event date is never
// today's listing.
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import type { DogadanjaSourceId } from '../../../worker/feed/modules/dogadanja';
import { canExportCalendarItem } from '../export';
import { actionButton, chip, externalLink, filterChips, findSelected, isSelected, itemActions, itemRow, listDetail, searchField, section, sectionHead } from '../experience/blocks';
import { attributionFoot, coverageText, downSources, listState, statusBadge } from '../experience/status';
import { coversDay, dayOffset, eventWhen } from '../experience/text';
import { parseIso, ZAGREB_TZ, zagrebDayKey, zagrebTime, type TimeInput } from '../format';
import type { I18n } from '../i18n/i18n';
import { dataText } from '../panels/panel';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import type { LayerContext } from './types';
import { eventVenueLinks } from '../city/day';
import { deduplicateEvents } from '../../../shared/city/events';
import { ct } from '../city/strings';

/** One default page of agenda rows; the chips and the search narrow the list first, so a filter always covers every match. */
const AGENDA_PAGE = 12;
/** Running exhibitions shown before "Još N" reveals the rest. */
const ONGOING_ROWS = 4;
/** One default page of undated notices. */
const UNDATED_PAGE = 6;
/** One default page of venues outside Zagreb, inside the folded details. */
const OUTSIDE_PAGE = 8;
/** The blocks are flat sections on the canvas, hairline apart, never cards; the attribute declares it for the tests and the stylesheet. */
const FLAT = { 'data-flat': '' };

const CULTURE_EVENT_SOURCE_TUPLE = ['kulturpunkt', 'etnografski', 'kvartovske'] as const;
type CultureEventSource = (typeof CULTURE_EVENT_SOURCE_TUPLE)[number];

/** The three of dogadanja's six sources that are culture or community content, not city administration. */
export const CULTURE_EVENT_SOURCES: readonly DogadanjaSourceId[] = CULTURE_EVENT_SOURCE_TUPLE;

const SOURCE_NAME: Record<CultureEventSource, string> = {
  kulturpunkt: 'Kulturpunkt',
  etnografski: 'Etnografski muzej',
  kvartovske: 'Kvartovske novosti',
};
/** Per-source attribution naming the licence; the kiosk card (grad-teaser.ts) reuses the kvartovske string. */
export const CULTURE_SOURCE_ATTRIBUTION: Record<CultureEventSource, string> = {
  kulturpunkt: 'Kulturpunkt (CC BY-SA 3.0 HR)',
  etnografski: 'Etnografski muzej',
  kvartovske: 'Kvartovske novosti, Grad Zagreb (Otvorena dozvola)',
};

/** The subset of the merged dogadanja snapshot whose `data.source` is one of `sources`, in the module's own order. */
export function filterBySource(snapshot: ModuleSnapshot | undefined, sources: readonly string[]): FeedItem[] {
  const set = new Set(sources);
  return (snapshot?.items ?? []).filter((item) => set.has(dataText(item, 'source')));
}

/**
 * The honest empty sentence: which of the panel's own sources answered with
 * nothing and which did not answer, from the module's sourceCounts.
 */
export function sourceStatusEmptyText(
  i18n: I18n,
  snapshot: ModuleSnapshot | undefined,
  sources: readonly string[],
  names: Record<string, string>,
  emptyKey: string,
): string {
  const counts = (snapshot as (ModuleSnapshot & { sourceCounts?: Partial<Record<string, number>> }) | undefined)?.sourceCounts;
  if (!counts) return i18n.t('status.empty');
  const responded = sources.filter((s) => (counts[s] ?? 0) > 0).map((s) => names[s]);
  const quiet = sources.filter((s) => (counts[s] ?? 0) === 0).map((s) => names[s]);
  const parts = [i18n.t(emptyKey)];
  if (responded.length) parts.push(i18n.t('panels.sourcesResponded', { list: responded.join(', ') }));
  if (quiet.length) parts.push(i18n.t('panels.sourcesQuiet', { list: quiet.join(', ') }));
  return parts.join(' ');
}

/** The culture/community subset of the merged dogadanja snapshot, in the module's own order. */
export function cultureEvents(snapshot: ModuleSnapshot | undefined): FeedItem[] {
  return filterBySource(snapshot, CULTURE_EVENT_SOURCE_TUPLE);
}

export function cultureEventsEmptyText(i18n: I18n, snapshot: ModuleSnapshot | undefined): string {
  return sourceStatusEmptyText(i18n, snapshot, CULTURE_EVENT_SOURCE_TUPLE, SOURCE_NAME, 'panels.eventsEmpty');
}
const CATEGORY_KEYS: ReadonlySet<string> = new Set([
  'izvedba', 'koncert', 'muzika', 'izlozba', 'film', 'radionica', 'predavanje', 'razgovor', 'festival',
  'sajam', 'predstavljanje', 'program', 'diskurzivno', 'dogadjanje', 'ostalo', 'zajednica',
]);

/** The closed category vocabulary; a neighbourhood notice is community, anything unknown is other. */
export function eventCategory(item: FeedItem): string {
  const raw = dataText(item, 'category');
  if (raw) return CATEGORY_KEYS.has(raw) ? raw : 'ostalo';
  return dataText(item, 'source') === 'kvartovske' ? 'zajednica' : 'ostalo';
}

function categoryLabel(i18n: I18n, key: string): string {
  const label = i18n.t(`events.category.${key}`);
  return label.startsWith('events.category.') ? key : label;
}

/** An event with a real event date; a notice whose basis is unknown or published is not an agenda item. A legacy row without a basis but with a date reads as dated. */
export function isDated(item: FeedItem): boolean {
  return (item.dateBasis === 'event' || item.dateBasis === undefined) && Boolean(item.at);
}

function normalise(value: string): string {
  return value.toLocaleLowerCase('hr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function matchesQuery(item: FeedItem, query: string): boolean {
  const q = normalise(query.trim());
  if (!q) return true;
  return [item.title, dataText(item, 'venue'), dataText(item, 'organiser'), item.summary ?? ''].some((v) => normalise(String(v)).includes(q));
}

const startMs = (item: FeedItem): number => Date.parse(item.at!);
const endMs = (item: FeedItem): number => Date.parse(item.until ?? item.at!);

/** A day- or range-precision entry, or a bare date: all day, never "at midnight". */
export function isAllDay(item: FeedItem): boolean {
  const precision = item.data?.precision;
  return precision === 'day' || precision === 'range' || /^\d{4}-\d{2}-\d{2}$/.test(item.at ?? '');
}

/** An all-day event whose own day is today: today's listing, not something that "started at midnight". */
function allDayToday(item: FeedItem, now: number): boolean {
  return isAllDay(item) && zagrebDayKey(item.at) === zagrebDayKey(now);
}

/** The next starts: dated events that have not begun, soonest first, plus today's all-day events. */
export function upcomingEvents(items: readonly FeedItem[], now: number): FeedItem[] {
  return items
    .filter((item) => isDated(item) && (startMs(item) >= now || allDayToday(item, now)))
    .sort((a, b) => startMs(a) - startMs(b));
}

/** Began earlier and still runs (a multi-day exhibition): shown apart with its end date, soonest end first. */
export function ongoingEvents(items: readonly FeedItem[], now: number): FeedItem[] {
  return items
    .filter((item) => isDated(item) && startMs(item) < now && endMs(item) >= now && !allDayToday(item, now) && coversDay(item, now))
    .sort((a, b) => endMs(a) - endMs(b));
}

// Croatian cities and islands a culture portal lists beside Zagreb, as word
// stems with up to two letters of case ending ("Splitu", "Hvaru", "Rijeci").
// A venue naming one of them is not a Zagreb event and is shown apart; a
// venue that also names Zagreb stays.
const OUTSIDE_ZAGREB = /\b(split|hvar|rijek|osijek|zadar|dubrovnik|pul|varazdin|sibenik|karlov[ac]|sis[ak]|koprivnic|cakov|vukovar|vinkovc|bjelovar|pozeg|rovinj|porec|makarsk|trogir|korcul|opatij|umag|krk)[a-z]{0,2}\b/;

export function venueOutsideZagreb(item: FeedItem): boolean {
  if (item.data?.city && normalise(String(item.data.city)) !== 'zagreb') return true;
  // An organiser's home city is not the event's location. Neither are street
  // names such as Avenija Dubrovnik or Ulica grada Vukovara city segments.
  const place = normalise(dataText(item, 'venue'));
  const withoutStreetNames = place.replace(/\b(?:avenija|av\.|ulica|ul\.|trg|cesta|obala)\s+(?:grada\s+)?[a-z]+/g, '');
  return OUTSIDE_ZAGREB.test(withoutStreetNames) && !place.includes('zagreb');
}

// The agenda's own short dates in the Croatian day-month order format.ts
// uses ("čet 17. 9.", "do 18. 10."), without the year an agenda of the coming
// weeks does not need; a date in another year keeps it.
const SHORT_DATE = new Intl.DateTimeFormat('hr-HR', { timeZone: ZAGREB_TZ, weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' });
function dateParts(value: TimeInput): Record<string, string> | null {
  const date = parseIso(value);
  if (!date) return null;
  const out: Record<string, string> = {};
  for (const part of SHORT_DATE.formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  return out;
}
function yearSuffix(p: Record<string, string>, now: number): string {
  return p.year === dateParts(now)?.year ? '' : ` ${p.year}.`;
}
/** "18. 10.", or "18. 10. 2027." in another year; '' when there is nothing to format. */
function dayMonth(value: TimeInput, now: number): string {
  const p = dateParts(value);
  return p ? `${Number(p.day)}. ${Number(p.month)}.${yearSuffix(p, now)}` : '';
}
/** "Danas", "Sutra", else "čet 17. 9.": the agenda's day head. */
function agendaDay(i18n: I18n, value: TimeInput, now: number): string {
  const offset = dayOffset(zagrebDayKey(value), zagrebDayKey(now));
  if (offset === 0) return i18n.t('events.today');
  if (offset === 1) return i18n.t('events.tomorrow');
  const p = dateParts(value);
  return p ? `${p.weekday} ${Number(p.day)}. ${Number(p.month)}.${yearSuffix(p, now)}` : i18n.t('time.unknown');
}
/** A line of its own opens with a capital: "Sutra 20:00", "Danas, cijeli dan". */
function sentence(text: string): string {
  return text.charAt(0).toLocaleUpperCase('hr') + text.slice(1);
}

/** A start whose end falls on another Zagreb day than its start: an exhibition, a fair, a range of days. */
function runsOn(item: FeedItem): boolean {
  const untilKey = item.until ? zagrebDayKey(item.until) : '';
  return untilKey !== '' && untilKey !== zagrebDayKey(item.at);
}

/**
 * The 3.5rem time column: the start time; for an all-day entry the all-day
 * word, or "do 25. 9." when it runs on for days, never "cijeli dan" for a
 * multi-day item [O-53]. The day and the month stay on one line, so the
 * narrow column breaks after "do".
 */
function timeCell(i18n: I18n, item: FeedItem, now: number): string {
  const inner = !isAllDay(item)
    ? `<span class="ev-time">${escapeHtml(zagrebTime(item.at))}</span>`
    : runsOn(item)
      ? `<span class="ev-allday">${escapeHtml(i18n.t('events.untilDate', { date: dayMonth(item.until, now).replace(' ', '\u00a0') }))}</span>`
      : `<span class="ev-allday">${escapeHtml(i18n.t('time.allDay'))}</span>`;
  return `<span class="row-lead ev-lead">${inner}</span>`;
}

/** The second line: the venue when the source has one, then the source (never a placeholder), then an optional end date. */
function subLine(i18n: I18n, item: FeedItem, until = ''): string {
  const venue = dataText(item, 'venue');
  const parts = [
    venue ? escapeHtml(venue) : '',
    `<span class="ev-source">${escapeHtml(i18n.t(`events.sources.${dataText(item, 'source')}`))}</span>`,
    until ? escapeHtml(until) : '',
  ].filter(Boolean);
  return `<span class="row-sub">${parts.join(' · ')}</span>`;
}

function untilText(i18n: I18n, item: FeedItem, now: number): string {
  return i18n.t('events.untilDate', { date: dayMonth(item.until, now) });
}

/** An agenda row: the time column, the title, the venue or the source; a start that runs on for days says until when, once (an all-day one in its time column). */
function eventRow(i18n: I18n, item: FeedItem, ctx: LayerContext): string {
  const until = runsOn(item) && !isAllDay(item) ? untilText(i18n, item, ctx.now) : '';
  const body = `${timeCell(i18n, item, ctx.now)}<span class="row-main"><span class="row-title">${escapeHtml(item.title)}</span>${subLine(i18n, item, until)}</span>`;
  return itemRow(item, body, { selected: isSelected(item, ctx.view?.selection), testid: 'event-row' });
}

/** A running exhibition: no lead (the head already says the state), the end date at the row's end. */
function ongoingRow(i18n: I18n, item: FeedItem, ctx: LayerContext): string {
  const body = `<span class="row-main"><span class="row-title">${escapeHtml(item.title)}</span>${subLine(i18n, item)}</span><span class="ev-until">${escapeHtml(untilText(i18n, item, ctx.now))}</span>`;
  return itemRow(item, body, { selected: isSelected(item, ctx.view?.selection), testid: 'event-row' });
}

/** A notice without an event date: the title and the source, no time column. */
function undatedRow(i18n: I18n, item: FeedItem, ctx: LayerContext): string {
  const body = `<span class="row-main"><span class="row-title">${escapeHtml(item.title)}</span>${subLine(i18n, item)}</span>`;
  return itemRow(item, body, { selected: isSelected(item, ctx.view?.selection), testid: 'undated-row' });
}

/** Rows grouped under day heads; an event still running today is listed under today. */
function agendaRows(i18n: I18n, items: readonly FeedItem[], ctx: LayerContext): string {
  let last = '';
  return items.map((item) => {
    const today = coversDay(item, ctx.now);
    const key = today ? zagrebDayKey(ctx.now) : zagrebDayKey(item.at);
    const label = today ? i18n.t('events.today') : agendaDay(i18n, item.at, ctx.now);
    const head = key !== last ? `<li class="agenda-day" data-key="day-${escapeAttribute(key)}" role="presentation">${escapeHtml(label)}</li>` : '';
    last = key;
    return head + eventRow(i18n, item, ctx);
  }).join('');
}

/** How many rows of a list the view shows: the filter value once "Prikaži još" was pressed, else the list's own page. */
function shownCount(ctx: LayerContext, key: string, page: number, total: number): number {
  return Math.min(total, Number(ctx.view?.filters[key]) || page);
}

/** "Prikaži još N": a filter button that extends the list by one page, only while something is left. */
function moreButton(i18n: I18n, key: string, shown: number, total: number, page: number): string {
  if (shown >= total) return '';
  return actionButton('filter', i18n.t('common.showMore', { count: Math.min(page, total - shown) }), { className: 'btn-ghost ev-more', extra: { 'filter-key': key, 'filter-value': shown + page } });
}

/** U tijeku: up to four rows with their end dates, then "Još N" reveals the rest at once. */
function ongoingSection(i18n: I18n, items: readonly FeedItem[], ctx: LayerContext): string {
  if (!items.length) return '';
  const shown = shownCount(ctx, 'ongoing', ONGOING_ROWS, items.length);
  const more = shown < items.length
    ? actionButton('filter', i18n.t('events.ongoingMore', { count: items.length - shown }), { className: 'btn-ghost ev-more', extra: { 'filter-key': 'ongoing', 'filter-value': items.length } })
    : '';
  return section({
    id: 'ev-ongoing', tone: 'events', className: 'ev-sec', testid: 'ev-ongoing', extra: FLAT,
    body: sectionHead(i18n, { title: i18n.t('events.ongoingTitle'), id: 'ev-ongoing-title', noStatus: true, level: 3 }) +
      `<ul class="rows" role="list" data-testid="ongoing">${items.slice(0, shown).map((item) => ongoingRow(i18n, item, ctx)).join('')}</ul>${more}`,
  });
}

/** Bez datuma: notices whose source gives no event date, in a sunken well, never as today's listing. */
function undatedSection(i18n: I18n, items: readonly FeedItem[], ctx: LayerContext): string {
  if (!items.length) return '';
  const shown = shownCount(ctx, 'undated', UNDATED_PAGE, items.length);
  return section({
    id: 'ev-undated', tone: 'events', className: 'ev-sec', testid: 'ev-undated', extra: FLAT,
    body: `<div class="ev-well">${sectionHead(i18n, { title: i18n.t('events.undated'), id: 'ev-undated-title', noStatus: true, level: 3 })}<p class="sec-note">${escapeHtml(i18n.t('events.undatedNote'))}</p><ul class="rows" role="list">${items.slice(0, shown).map((item) => undatedRow(i18n, item, ctx)).join('')}</ul>${moreButton(i18n, 'undated', shown, items.length, UNDATED_PAGE)}</div>`,
  });
}

/** Izvan Zagreba: folded by default, the whole count in the summary, eight rows then more; the reconciler keeps an open state across polls. */
function outsideSection(i18n: I18n, items: readonly FeedItem[], ctx: LayerContext): string {
  if (!items.length) return '';
  const shown = shownCount(ctx, 'outside', OUTSIDE_PAGE, items.length);
  return `<details class="ev-sec ev-outside" id="ev-outside" data-key="ev-outside" data-testid="ev-outside"><summary class="ev-summary">${iconMarkup('chevron-down')}<span>${escapeHtml(i18n.t('events.outside'))}</span> <span class="chip-count">${items.length}</span></summary><p class="sec-note">${escapeHtml(i18n.t('events.outsideNote'))}</p><ul class="rows" role="list">${items.slice(0, shown).map((item) => eventRow(i18n, item, ctx)).join('')}</ul>${moreButton(i18n, 'outside', shown, items.length, OUTSIDE_PAGE)}</details>`;
}

/** The open event: the title, when, the facts the source gave, the summary, one row of actions ending in the original. */
function eventDetail(i18n: I18n, item: FeedItem, ctx: LayerContext): string {
  const source = dataText(item, 'source') as CultureEventSource;
  const when = isDated(item) ? eventWhen(i18n, item, ctx.now) : i18n.t('events.timeUnknown');
  const facts: [string, string][] = [
    [i18n.t('events.venue'), dataText(item, 'venue')],
    [i18n.t('events.organiser'), dataText(item, 'organiser')],
    [i18n.t('events.categoryLabel'), categoryLabel(i18n, eventCategory(item))],
    [i18n.t('events.source'), CULTURE_SOURCE_ATTRIBUTION[source] ?? source],
  ];
  const dl = `<dl class="detail-facts">${facts.filter(([, v]) => v).map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>`;
  const summary = typeof item.summary === 'string' && item.summary ? `<p class="detail-summary">${escapeHtml(item.summary)}</p>` : '';
  const calendar = canExportCalendarItem(item);
  const actions = `<div class="ev-actions">${eventVenueLinks(ctx,item)}${itemActions(i18n, item, { calendar })}${item.link ? externalLink(item.link, i18n.t('common.openSource')) : ''}</div>`;
  return `<article class="detail ev-detail" data-key="detail-${escapeAttribute(item.id)}" data-testid="event-detail"><h3 class="detail-title" id="ws-detail-title" tabindex="-1">${escapeHtml(item.title)}</h3><p class="ev-when">${escapeHtml(sentence(when))}</p>${actions}${dl}${summary}${calendar ? '' : `<p class="sec-note">${escapeHtml(i18n.t('events.noCalendar'))}</p>`}</article>`;
}

export function renderKultura(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  const dogadanja = ctx.snapshots.dogadanja;
  const all = deduplicateEvents(cultureEvents(dogadanja),ctx.city?.places??[]);
  const query = ctx.view?.filters.q ?? '';
  const category = ctx.view?.filters.category ?? '';
  const window = ctx.view?.filters['event-window'] ?? 'week';
  const inZagreb = all.filter((item) => !venueOutsideZagreb(item));
  const outside = all.filter(venueOutsideZagreb);
  const upcoming = upcomingEvents(inZagreb, ctx.now).filter(item=>{
    const offset=dayOffset(zagrebDayKey(item.at),zagrebDayKey(ctx.now));
    return window==='today'?offset===0:window==='tomorrow'?offset===1:offset!==null&&offset>=0&&offset<7;
  });
  const ongoing = ongoingEvents(inZagreb, ctx.now);
  const undated = inZagreb.filter((item) => !isDated(item));
  const counts = new Map<string, number>();
  for (const item of upcoming.filter(item=>matchesQuery(item,query))) counts.set(eventCategory(item), (counts.get(eventCategory(item)) ?? 0) + 1);
  const keep = (item: FeedItem): boolean => (!category || eventCategory(item) === category) && matchesQuery(item, query);
  const filtered = upcoming.filter(keep);
  const ongoingShown = ongoing.filter(keep);
  const option = (label: string, value: string, count: number): string =>
    `<option value="${escapeAttribute(value)}"${category === value ? ' selected' : ''}>${escapeHtml(label)} (${count})</option>`;
  const categories = `<label class="ev-category"><span class="visually-hidden">${escapeHtml(i18n.t('events.categoryLabel'))}</span><select data-filter-key="category" data-testid="event-category">${option(i18n.t('events.allCategories'), '', upcoming.length)}${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => option(categoryLabel(i18n, key), key, count)).join('')}</select></label>`;
  // The count line names what the lists below hold; the status word, never a head, sits beside it.
  const countText = filtered.length + ongoingShown.length
    ? ongoingShown.length ? i18n.t('events.countLine', { count: filtered.length, ongoing: ongoingShown.length }) : i18n.t('events.count', { count: filtered.length })
    : '';
  const badge = statusBadge(i18n, dogadanja, ctx.errors?.dogadanja);
  const countLine = countText || badge ? `<p class="ev-count" data-testid="ev-count">${countText ? `<span>${escapeHtml(countText)}</span>` : ''}${badge}</p>` : '';
  // Filters only when there is something to filter; the empty state speaks for itself.
  const days=`<div class="ev-days" role="group" aria-label="${escapeAttribute(ct(i18n,'program'))}">${(['today','tomorrow','week'] as const).map(day=>`<button type="button" class="day-time" data-action="filter" data-filter-key="event-window" data-filter-value="${day}" aria-pressed="${window===day}">${ct(i18n,day)}</button>`).join('')}</div>`;
  const toolbar = `${days}<div class="ws-toolbar ev-toolbar">${searchField({ id: 'events-search', key: 'q', label: i18n.t('events.search'), placeholder: i18n.t('events.searchPlaceholder'), value: query })}${upcoming.length ? categories : ''}${countLine}</div>`;
  const emptyText = query || category ? i18n.t('events.emptyFiltered') : all.length ? i18n.t('events.upcomingNone') : cultureEventsEmptyText(i18n, dogadanja);
  const state = listState(i18n, dogadanja, 'dogadanja', filtered.length, emptyText, ctx.errors?.dogadanja);
  const shown = shownCount(ctx, 'events', AGENDA_PAGE, filtered.length);
  // The agenda has no visible head: the day heads structure it, the hidden one names the region for assistive technology.
  const agenda = section({
    id: 'ev-agenda', tone: 'events', className: 'ev-sec', testid: 'ev-agenda', extra: FLAT,
    body: `<h3 class="visually-hidden" id="ev-agenda-title">${escapeHtml(i18n.t('events.agenda'))}</h3>` +
      (state || `<ul class="rows agenda" role="list" data-testid="agenda">${agendaRows(i18n, filtered.slice(0, shown), ctx)}</ul>${moreButton(i18n, 'events', shown, filtered.length, AGENDA_PAGE)}`),
  });
  const selected = findSelected(dogadanja, ctx.view?.selection);
  const detail = selected && CULTURE_EVENT_SOURCES.includes(dataText(selected,'source') as DogadanjaSourceId) ? eventDetail(i18n, selected, ctx) : null;
  const list = agenda + ongoingSection(i18n, ongoingShown, ctx) + undatedSection(i18n, undated.filter(keep), ctx) + outsideSection(i18n, outside.filter(keep), ctx);
  const down = downSources(dogadanja);
  const notes = [down.length ? i18n.t('status.sourcesDown', { list: down.join(', ') }) : '']
    .filter(Boolean).map((t) => `<p class="sec-note">${escapeHtml(t)}</p>`).join('');
  // The domain's name is the tab's: hidden on the phone, shown as the desk's title (layers.css .ev-title); it stays for aria-labelledby and the focus after a switch.
  return createElementFromHTML(`<section class="layer ws ws-events" id="layer-kultura" data-layer="kultura" data-reconcile aria-labelledby="layer-title-kultura">
<h2 class="layer-title ev-title" id="layer-title-kultura" tabindex="-1">${escapeHtml(i18n.t('layers.kultura'))}</h2>
${toolbar}
${listDetail(i18n, { list, detail, detailTitle: i18n.t('events.detailTitle') })}
${notes}${attributionFoot(i18n, dogadanja)}
</section>`);
}

/**
 * The page's own count line as numbers, for Još's "Događanja ovaj tjedan" row
 * [O-53, O-60]: the same deduplicated Zagreb subset renderKultura lists, the
 * starts of the default seven-day window (today and the six days after) and
 * what is running now. No filter applies: the row counts the page as it opens.
 */
export function eventsCount(snapshot: ModuleSnapshot | undefined, city: { places: Parameters<typeof deduplicateEvents>[1] } | null | undefined, now: number): { count: number; ongoing: number } {
  const inZagreb = deduplicateEvents(cultureEvents(snapshot), city?.places ?? []).filter((item) => !venueOutsideZagreb(item));
  const count = upcomingEvents(inZagreb, now).filter((item) => {
    const offset = dayOffset(zagrebDayKey(item.at), zagrebDayKey(now));
    return offset !== null && offset >= 0 && offset < 7;
  }).length;
  return { count, ongoing: ongoingEvents(inZagreb, now).length };
}
