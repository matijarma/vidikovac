// Vijesti: HRT's two feeds as two sources with their own health, a lead story
// each, real publication times and the permitted RSS lede as the summary.
// Never the article body, never a player; the original is one link away.
import type { FeedItem, ModuleSnapshot, SourceAvailability } from '../../../worker/feed/schema';
import { externalLink, findSelected, isSelected, itemActions, itemRow, listDetail, section, sectionHead } from '../experience/blocks';
import { attributionFoot, listState, statusBadge } from '../experience/status';
import { relativeTime } from '../experience/text';
import { zagrebDateTime } from '../format';
import type { I18n } from '../i18n/i18n';
import { dataText } from '../panels/panel';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import type { LayerContext } from './types';

/** The two feeds hrt-news.ts merges, in the order they are shown: national, then local. */
export const NEWS_SOURCES = [
  { name: 'HRT vijesti', slug: 'hrt', labelKey: 'news.national', icon: 'newspaper' as const },
  { name: 'Radio Sljeme', slug: 'sljeme', labelKey: 'news.local', icon: 'radio' as const },
] as const;

const PREVIEW_ROWS = 6;

/** The rows of one HRT feed; a legacy row that names no feed belongs to the module's primary one. */
export function newsBySource(snapshot: ModuleSnapshot | undefined, source: string): FeedItem[] {
  const primary = source === NEWS_SOURCES[0].name;
  return (snapshot?.items ?? []).filter((item) => {
    const own = dataText(item, 'source');
    return own === source || (primary && !own);
  });
}

function publishedText(i18n: I18n, item: FeedItem, now: number): string {
  if (!item.at || item.dateBasis === 'unknown') return i18n.t('news.publishedUnknown');
  return i18n.t('news.published', { time: relativeTime(i18n, item.at, now) });
}

function sourceBadge(i18n: I18n, availability: SourceAvailability | undefined): string {
  if (!availability) return '';
  const tone = availability.status;
  const word = tone === 'down' ? i18n.t('status.down') : tone === 'stale' ? i18n.t('freshness.danas') : i18n.t('freshness.zivo');
  return `<span class="badge" data-tone="${tone}" data-testid="news-source-status">${escapeHtml(word)}</span>`;
}

function storyRow(i18n: I18n, item: FeedItem, ctx: LayerContext, lead: boolean): string {
  const summary = lead && typeof item.summary === 'string' && item.summary ? `<span class="nw-summary">${escapeHtml(item.summary)}</span>` : '';
  const body = `<span class="row-main"><span class="row-title">${escapeHtml(item.title)}</span><span class="row-meta">${escapeHtml(publishedText(i18n, item, ctx.now))}</span>${summary}</span>`;
  return itemRow(item, body, { selected: isSelected(item, ctx.view?.selection), testid: 'news-row', className: lead ? 'nw-lead' : '' });
}

function sourceSection(i18n: I18n, ctx: LayerContext, source: (typeof NEWS_SOURCES)[number]): string {
  const news = ctx.snapshots['hrt-news'];
  const items = newsBySource(news, source.name);
  const availability = news?.sources?.[source.name];
  const expanded = ctx.view?.filters[`all-${source.slug}`] === '1';
  const shown = expanded ? items : items.slice(0, PREVIEW_ROWS);
  const emptyText = availability?.status === 'down' ? i18n.t('news.sourceDown', { source: source.name }) : i18n.t('news.sourceEmpty', { source: source.name });
  const state = listState(i18n, news, 'hrt-news', items.length, emptyText, ctx.errors?.['hrt-news']);
  const more = !expanded && items.length > shown.length
    ? `<button type="button" class="btn-quiet" data-action="filter" data-filter-key="all-${source.slug}" data-filter-value="1">${escapeHtml(i18n.t('news.showAll', { source: source.name }))} (${items.length})</button>`
    : '';
  const list = state || `<ul class="rows" role="list" data-testid="news-${source.slug}">${shown.map((item, index) => storyRow(i18n, item, ctx, index === 0)).join('')}</ul>${more}`;
  const head = `<header class="sec-head"><div class="sec-title-row nw-source-head">${iconMarkup(source.icon)}<h3 class="sec-title" id="nw-${source.slug}-title">${escapeHtml(source.name)}</h3>${sourceBadge(i18n, availability)}</div><p class="meta">${escapeHtml(i18n.t(source.labelKey))} · ${escapeHtml(i18n.t('news.count', { count: items.length }))}</p></header>`;
  return section({ id: `nw-${source.slug}`, tone: 'neutral', testid: `nw-${source.slug}`, body: head + list });
}
function storyDetail(i18n: I18n, item: FeedItem, ctx: LayerContext): string {
  const source = dataText(item, 'source');
  const when = item.at && item.dateBasis !== 'unknown'
    ? `${zagrebDateTime(item.at)} · ${publishedText(i18n, item, ctx.now)}`
    : i18n.t('news.publishedUnknown');
  const summary = typeof item.summary === 'string' && item.summary ? `<p class="detail-summary">${escapeHtml(item.summary)}</p>` : '';
  return `<article class="detail" data-key="detail-${escapeAttribute(item.id)}" data-testid="news-detail"><p class="kicker">${escapeHtml(source)}</p><h3 class="detail-title" id="ws-detail-title" tabindex="-1">${escapeHtml(item.title)}</h3><p class="meta">${escapeHtml(when)}</p>${summary}<p class="sec-note">${escapeHtml(i18n.t('news.summaryNote'))}</p>${item.link ? externalLink(item.link, i18n.t('news.readOriginal')) : ''}${itemActions(i18n, item)}</article>`;
}

export function renderVijesti(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  const news = ctx.snapshots['hrt-news'];
  const selected = findSelected(news, ctx.view?.selection);
  const list = `<div class="nw-grid">${NEWS_SOURCES.map((source) => sourceSection(i18n, ctx, source)).join('')}</div>`;
  return createElementFromHTML(`<section class="layer ws ws-news" id="layer-vijesti" data-layer="vijesti" data-reconcile aria-labelledby="layer-title-vijesti">
<header class="ws-head"><div class="sec-title-row"><h2 class="layer-title" id="layer-title-vijesti" tabindex="-1">${escapeHtml(i18n.t('layers.vijesti'))}</h2>${statusBadge(i18n, news, ctx.errors?.['hrt-news'])}</div><p class="meta">${escapeHtml(i18n.t('news.summaryNote'))}</p></header>
${listDetail(i18n, { list, detail: selected ? storyDetail(i18n, selected, ctx) : null, detailTitle: i18n.t('news.detailTitle') })}
${attributionFoot(i18n, news)}
</section>`);
}
