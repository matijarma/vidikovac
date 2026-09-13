// Događanja: a dated agenda from the culture and community sources of the
// dogadanja module (Kulturpunkt, Etnografski muzej, kvartovske novosti),
// with category controls, search and an item detail. Date-only entries are
// all-day; notices without a date stand apart and are never today's listing.
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import type { DogadanjaSourceId } from '../../../worker/feed/modules/dogadanja';
import { canExportCalendarItem } from '../export';
import { chip, externalLink, filterChips, findSelected, isSelected, itemActions, itemRow, listDetail, searchField, section, sectionHead } from '../experience/blocks';
import { attributionFoot, coverageText, downSources, listState } from '../experience/status';
import { coversDay, dayHeading, eventWhen } from '../experience/text';
import { zagrebDayKey, zagrebTime, zagrebWeekdayDate } from '../format';
import type { I18n } from '../i18n/i18n';
import { dataText } from '../panels/panel';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import type { LayerContext } from './types';

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

function isAllDay(item: FeedItem): boolean {
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
  const place = normalise(`${dataText(item, 'venue')} ${dataText(item, 'organiser')}`);
  return OUTSIDE_ZAGREB.test(place) && !place.includes('zagreb');
}

function leadCell(i18n: I18n, item: FeedItem): string {
  const precision = item.data?.precision;
  const allDay = precision === 'day' || precision === 'range' || /^\d{4}-\d{2}-\d{2}$/.test(item.at ?? '');
  return allDay ? `<span class="ev-allday">${escapeHtml(i18n.t('time.allDay'))}</span>` : `<span class="ev-time">${escapeHtml(zagrebTime(item.at))}</span>`;
}

function eventRow(i18n: I18n, item: FeedItem, ctx: LayerContext, ongoing = false): string {
  const venue = dataText(item, 'venue');
  const untilKey = item.until ? zagrebDayKey(item.until) : '';
  const multiDay = untilKey !== '' && untilKey !== zagrebDayKey(item.at);
  const meta = [
    venue ? escapeHtml(venue) : '',
    `<span class="ev-source">${escapeHtml(i18n.t(`events.sources.${dataText(item, 'source')}`))}</span>`,
    ongoing ? escapeHtml(i18n.t('events.ongoingUntil', { date: zagrebWeekdayDate(item.until) })) : multiDay ? escapeHtml(i18n.t('events.untilDate', { date: zagrebWeekdayDate(item.until) })) : '',
  ].filter(Boolean).join(' · ');
  const lead = ongoing ? `<span class="ev-allday">${escapeHtml(i18n.t('events.ongoing'))}</span>` : leadCell(i18n, item);
  const body = `<span class="row-lead">${lead}</span><span class="row-main"><span class="row-title">${escapeHtml(item.title)}</span><span class="row-meta">${meta}</span></span>`;
  return itemRow(item, body, { selected: isSelected(item, ctx.view?.selection), testid: 'event-row' });
}
/** Rows grouped under day heads; an event still running today is listed under today. */
function agendaRows(i18n: I18n, items: readonly FeedItem[], ctx: LayerContext): string {
  let last = '';
  return items.map((item) => {
    const today = coversDay(item, ctx.now);
    const key = today ? zagrebDayKey(ctx.now) : zagrebDayKey(item.at);
    const label = today ? i18n.t('events.today') : dayHeading(i18n, item.at, ctx.now);
    const head = key !== last ? `<li class="agenda-day" data-key="day-${escapeAttribute(key)}" role="presentation">${escapeHtml(label)}</li>` : '';
    last = key;
    return head + eventRow(i18n, item, ctx);
  }).join('');
}

/** Notices whose source gives no event date: shown apart, never as today's listing. */
function undatedSection(i18n: I18n, items: readonly FeedItem[], ctx: LayerContext): string {
  if (!items.length) return '';
  const rows = items.map((item) => itemRow(item,
    `<span class="row-lead"><span class="row-lead-small">${escapeHtml(i18n.t('events.timeUnknown'))}</span></span><span class="row-main"><span class="row-title">${escapeHtml(item.title)}</span><span class="row-meta"><span class="ev-source">${escapeHtml(i18n.t(`events.sources.${dataText(item, 'source')}`))}</span></span></span>`,
    { selected: isSelected(item, ctx.view?.selection), testid: 'undated-row', className: 'ev-undated' })).join('');
  return section({
    id: 'ev-undated', className: 'sec-undated', testid: 'ev-undated',
    body: sectionHead(i18n, { title: i18n.t('events.undated'), id: 'ev-undated-title', noStatus: true, level: 3 }) + `<p class="sec-note">${escapeHtml(i18n.t('events.undatedNote'))}</p><ul class="rows" role="list">${rows}</ul>`,
  });
}

function eventDetail(i18n: I18n, item: FeedItem, ctx: LayerContext): string {
  const source = dataText(item, 'source') as CultureEventSource;
  const category = categoryLabel(i18n, eventCategory(item));
  const facts: [string, string][] = [
    [i18n.t('events.when'), isDated(item) ? eventWhen(i18n, item, ctx.now) : i18n.t('events.timeUnknown')],
    [i18n.t('events.venue'), dataText(item, 'venue')],
    [i18n.t('events.organiser'), dataText(item, 'organiser')],
    [i18n.t('events.categoryLabel'), category],
    [i18n.t('events.source'), CULTURE_SOURCE_ATTRIBUTION[source] ?? source],
  ];
  const dl = facts.filter(([, v]) => v).map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
  const summary = typeof item.summary === 'string' && item.summary ? `<p class="detail-summary">${escapeHtml(item.summary)}</p>` : '';
  const calendar = canExportCalendarItem(item);
  return `<article class="detail" data-key="detail-${escapeAttribute(item.id)}" data-testid="event-detail"><p class="kicker">${escapeHtml(category)}</p><h3 class="detail-title" id="ws-detail-title" tabindex="-1">${escapeHtml(item.title)}</h3><dl class="detail-facts">${dl}</dl>${summary}${item.link ? externalLink(item.link, i18n.t('common.openSource')) : ''}${itemActions(i18n, item, { calendar })}${calendar ? '' : `<p class="sec-note">${escapeHtml(i18n.t('events.noCalendar'))}</p>`}</article>`;
}
export function renderKultura(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  const dogadanja = ctx.snapshots.dogadanja;
  const all = cultureEvents(dogadanja);
  const query = ctx.view?.filters.q ?? '';
  const category = ctx.view?.filters.category ?? '';
  const inZagreb = all.filter((item) => !venueOutsideZagreb(item));
  const outside = all.filter(venueOutsideZagreb);
  const upcoming = upcomingEvents(inZagreb, ctx.now);
  const ongoing = ongoingEvents(inZagreb, ctx.now);
  const undated = inZagreb.filter((item) => !isDated(item));
  const counts = new Map<string, number>();
  for (const item of upcoming) counts.set(eventCategory(item), (counts.get(eventCategory(item)) ?? 0) + 1);
  const keep = (item: FeedItem): boolean => (!category || eventCategory(item) === category) && matchesQuery(item, query);
  const filtered = upcoming.filter(keep);
  const chips = filterChips([
    chip(i18n.t('events.allCategories'), { action: 'filter', extra: { 'filter-key': 'category', 'filter-value': '' }, selected: !category, count: upcoming.length }),
    ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => chip(categoryLabel(i18n, key), { action: 'filter', extra: { 'filter-key': 'category', 'filter-value': key }, selected: category === key, count })),
  ], i18n.t('events.categoryLabel'));
  // Filters only when there is something to filter; the empty state speaks for itself.
  const toolbar = `<div class="ws-toolbar">${searchField({ id: 'events-search', key: 'q', label: i18n.t('events.search'), placeholder: i18n.t('events.searchPlaceholder'), value: query })}${upcoming.length ? chips : ''}</div>`;
  const emptyText = query || category ? i18n.t('events.emptyFiltered') : all.length ? i18n.t('events.upcomingNone') : cultureEventsEmptyText(i18n, dogadanja);
  const state = listState(i18n, dogadanja, 'dogadanja', filtered.length, emptyText, ctx.errors?.dogadanja);
  const agenda = section({
    id: 'ev-agenda', tone: 'events', testid: 'ev-agenda',
    body: sectionHead(i18n, { kicker: i18n.t('events.kicker'), title: i18n.t('events.count', { count: filtered.length }), snapshot: dogadanja, error: ctx.errors?.dogadanja, id: 'ev-agenda-title' }) +
      (state || `<ul class="rows agenda" role="list" data-testid="agenda">${agendaRows(i18n, filtered, ctx)}</ul>`),
  });
  const selected = findSelected(dogadanja, ctx.view?.selection);
  const detail = selected && all.includes(selected) ? eventDetail(i18n, selected, ctx) : null;
  const ongoingShown = ongoing.filter(keep);
  const ongoingSection = ongoingShown.length
    ? section({
      id: 'ev-ongoing', tone: 'events', testid: 'ev-ongoing',
      body: sectionHead(i18n, { title: i18n.t('events.ongoingTitle'), id: 'ev-ongoing-title', noStatus: true, level: 3, aside: `<span class="badge badge-plain" data-tone="events">${escapeHtml(i18n.t('events.ongoingCount', { count: ongoingShown.length }))}</span>` }) +
        `<ul class="rows" role="list" data-testid="ongoing">${ongoingShown.slice(0, 6).map((item) => eventRow(i18n, item, ctx, true)).join('')}</ul>`,
    })
    : '';
  const outsideShown = outside.filter(keep);
  const outsideSection = outsideShown.length
    ? section({
      id: 'ev-outside', className: 'sec-undated', testid: 'ev-outside',
      body: sectionHead(i18n, { title: i18n.t('events.outside'), id: 'ev-outside-title', noStatus: true, level: 3 }) + `<p class="sec-note">${escapeHtml(i18n.t('events.outsideNote'))}</p>` +
        `<ul class="rows" role="list">${outsideShown.slice(0, 8).map((item) => eventRow(i18n, item, ctx)).join('')}</ul>`,
    })
    : '';
  const down = downSources(dogadanja);
  const notes = [coverageText(i18n, dogadanja), down.length ? i18n.t('status.sourcesDown', { list: down.join(', ') }) : '']
    .filter(Boolean).map((t) => `<p class="sec-note">${escapeHtml(t)}</p>`).join('');
  return createElementFromHTML(`<section class="layer ws ws-events" id="layer-kultura" data-layer="kultura" data-reconcile aria-labelledby="layer-title-kultura">
<header class="ws-head"><h2 class="layer-title" id="layer-title-kultura" tabindex="-1">${escapeHtml(i18n.t('layers.kultura'))}</h2></header>
${toolbar}
${listDetail(i18n, { list: agenda + ongoingSection + undatedSection(i18n, undated.filter(keep), ctx) + outsideSection, detail, detailTitle: i18n.t('events.detailTitle') })}
${notes}${attributionFoot(i18n, dogadanja)}
</section>`);
}
