// Vijesti: HRT's two feeds as two sources with their own health, a lead story
// each set apart by size and space (never a box), and the permitted RSS lede
// as the summary. Never the article body, never a player; the original is
// one link away.
import type { FeedItem, ModuleSnapshot, SourceAvailability } from '../../../worker/feed/schema';
import { actionButton, externalLink, findSelected, isSelected, itemActions, itemRow, listDetail, section } from '../experience/blocks';
import { attributionFoot, listState, statusBadge } from '../experience/status';
import { relativeTime } from '../experience/text';
import { zagrebDateTime, zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import { dataText } from '../panels/panel';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import type { LayerContext } from './types';

/** The two feeds hrt-news.ts merges, in the order they are shown; `linkKey` names the declined form used by "Otvori na ...". */
export const NEWS_SOURCES = [
  { name: 'HRT vijesti', slug: 'hrt', icon: 'newspaper' as const, linkKey: 'news.openHrt' as const },
  { name: 'Radio Sljeme', slug: 'sljeme', icon: 'radio' as const, linkKey: 'news.openSljeme' as const },
] as const;

/** Rows shown per source before "Prikaži još", and the size of each further page. */
const ROWS_INITIAL = 6;
const ROWS_STEP = 10;

/** The rows of one HRT feed; a legacy row that names no feed belongs to the module's primary one. */
export function newsBySource(snapshot: ModuleSnapshot | undefined, source: string): FeedItem[] {
  const primary = source === NEWS_SOURCES[0].name;
  return (snapshot?.items ?? []).filter((item) => {
    const own = dataText(item, 'source');
    return own === source || (primary && !own);
  });
}

/** An item's own time, never prefixed: the source-level head carries "objavljeno"/"dohvaćeno" instead. */
function itemTimeText(i18n: I18n, item: FeedItem, now: number): string {
  if (!item.at || item.dateBasis === 'unknown') return i18n.t('news.publishedUnknown');
  return relativeTime(i18n, item.at, now);
}

/** The source's own build time when the feed states one, else plainly the moment it was fetched. */
function sourceMetaText(i18n: I18n, availability: SourceAvailability | undefined): string {
  if (!availability) return '';
  if (availability.sourceUpdatedAt) return i18n.t('news.published', { time: zagrebTime(availability.sourceUpdatedAt) });
  if (availability.fetchedAt) return i18n.t('status.fetched', { time: zagrebTime(availability.fetchedAt) });
  return '';
}

function sourceBadge(i18n: I18n, availability: SourceAvailability | undefined): string {
  // A feed that answered needs no pill; the stories carry their own publication times.
  if (!availability || availability.status === 'live') return '';
  const tone = availability.status;
  const word = tone === 'down' ? i18n.t('status.down') : i18n.t('status.staleShort', { time: zagrebTime(availability.fetchedAt) });
  return `<span class="badge" data-tone="${tone}" data-testid="news-source-status">${escapeHtml(word)}</span>`;
}

/** The freshest story of a source, larger by size and space alone: no card, no clamp. */
function leadArticle(i18n: I18n, item: FeedItem, ctx: LayerContext): string {
  const selected = isSelected(item, ctx.view?.selection);
  const lede = typeof item.summary === 'string' && item.summary ? `<span class="nw-lead-lede">${escapeHtml(item.summary)}</span>` : '';
  const body = `<span class="row-main"><span class="row-title">${escapeHtml(item.title)}</span>${lede}<span class="row-meta">${escapeHtml(itemTimeText(i18n, item, ctx.now))}</span></span>`;
  return `<article class="nw-lead" data-key="lead-${escapeAttribute(item.id)}"><button type="button" class="row-button" data-action="select" data-module="${escapeAttribute(item.module)}" data-item-id="${escapeAttribute(item.id)}" aria-current="${selected ? 'true' : 'false'}">${body}${iconMarkup('chevron-right', undefined, 'icon row-chevron')}</button></article>`;
}

function storyRow(i18n: I18n, item: FeedItem, ctx: LayerContext): string {
  const body = `<span class="row-main"><span class="row-title">${escapeHtml(item.title)}</span><span class="row-meta">${escapeHtml(itemTimeText(i18n, item, ctx.now))}</span></span>`;
  return itemRow(item, body, { selected: isSelected(item, ctx.view?.selection), testid: 'news-row' });
}

function sourceSection(i18n: I18n, ctx: LayerContext, source: (typeof NEWS_SOURCES)[number]): string {
  const news = ctx.snapshots['hrt-news'];
  const items = newsBySource(news, source.name);
  const availability = news?.sources?.[source.name];
  const [lead, ...rest] = items;
  const shownCount = Math.min(rest.length, Number(ctx.view?.filters[source.slug]) || ROWS_INITIAL);
  const shownRows = rest.slice(0, shownCount);
  const emptyText = availability?.status === 'down' ? i18n.t('news.sourceDown', { source: source.name }) : i18n.t('news.sourceEmpty', { source: source.name });
  const state = listState(i18n, news, 'hrt-news', items.length, emptyText, ctx.errors?.['hrt-news']);
  const more = shownCount < rest.length
    ? actionButton('filter', i18n.t('common.showMore', { count: Math.min(ROWS_STEP, rest.length - shownCount) }), { className: 'btn-quiet', extra: { 'filter-key': source.slug, 'filter-value': shownCount + ROWS_STEP } })
    : '';
  const rows = shownRows.length ? `<ul class="rows" role="list" data-testid="news-${source.slug}">${shownRows.map((item) => storyRow(i18n, item, ctx)).join('')}</ul>${more}` : '';
  const body = state || `${lead ? leadArticle(i18n, lead, ctx) : ''}${rows}`;
  const sectionId = `nw-${source.slug}`;
  const meta = sourceMetaText(i18n, availability);
  const head = `<header class="sec-head"><div class="sec-title-row nw-source-head">${iconMarkup(source.icon)}<h3 class="nw-source-title" id="${sectionId}-title">${escapeHtml(source.name)}</h3>${sourceBadge(i18n, availability)}</div>${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ''}</header>`;
  return section({ id: sectionId, tone: 'neutral', className: 'nw-source', testid: sectionId, body: head + body });
}

function storyDetail(i18n: I18n, item: FeedItem, ctx: LayerContext): string {
  const sourceName = dataText(item, 'source') || NEWS_SOURCES[0].name;
  const sourceEntry = NEWS_SOURCES.find((s) => s.name === sourceName) ?? NEWS_SOURCES[0];
  const relative = itemTimeText(i18n, item, ctx.now);
  const when = (!item.at || item.dateBasis === 'unknown') ? relative : `${zagrebDateTime(item.at)} · ${relative}`;
  const lede = typeof item.summary === 'string' && item.summary ? `<p class="detail-summary">${escapeHtml(item.summary)}</p>` : '';
  const openLink = item.link ? externalLink(item.link, i18n.t(sourceEntry.linkKey), 'btn btn-primary') : '';
  return `<article class="detail" data-key="detail-${escapeAttribute(item.id)}" data-testid="news-detail"><h3 class="detail-title" id="ws-detail-title" tabindex="-1">${escapeHtml(item.title)}</h3><p class="meta">${escapeHtml(when)}</p>${lede}${openLink}${itemActions(i18n, item)}</article>`;
}

export function renderVijesti(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  const news = ctx.snapshots['hrt-news'];
  const selected = findSelected(news, ctx.view?.selection);
  const list = `<div class="nw-grid">${NEWS_SOURCES.map((source) => sourceSection(i18n, ctx, source)).join('')}</div>`;
  return createElementFromHTML(`<section class="layer ws ws-news" id="layer-vijesti" data-layer="vijesti" data-reconcile aria-labelledby="layer-title-vijesti">
<header class="ws-head"><div class="sec-title-row"><h2 class="layer-title" id="layer-title-vijesti" tabindex="-1">${escapeHtml(i18n.t('layers.vijesti'))}</h2>${statusBadge(i18n, news, ctx.errors?.['hrt-news'])}</div></header>
${listDetail(i18n, { list, detail: selected ? storyDetail(i18n, selected, ctx) : null, detailTitle: i18n.t('news.detailTitle') })}
${attributionFoot(i18n, news, `<p class="nw-disclaimer">${escapeHtml(i18n.t('news.summaryNote'))}</p>`)}
</section>`);
}
