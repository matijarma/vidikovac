// Vijesti: HRT headlines as text with the source line and a link to the
// original. Never the article body, never an embedded player.
import { zagrebTime } from '../format';
import { createLayerSection, createPanel, listMarkup } from '../panels/panel';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import type { LayerContext } from './types';

export function renderVijesti(ctx: LayerContext): HTMLElement {
  const { i18n, snapshots, now } = ctx;
  const { section, panels } = createLayerSection('vijesti', i18n.t('layers.vijesti'));
  const news = snapshots['hrt-news'];

  const rows = (news?.items ?? []).map((item) => {
    const link = item.link
      ? ` <a href="${escapeAttribute(item.link)}" rel="noopener noreferrer" target="_blank">${escapeHtml(i18n.t('common.openSource'))}</a>`
      : '';
    return `<span data-testid="news-row"><strong>${escapeHtml(item.title)}</strong><span class="panel-sub"> HRT · ${escapeHtml(zagrebTime(item.at))}</span>${link}</span>`;
  });

  panels.appendChild(
    createPanel({
      i18n, now, id: 'vijesti-news', title: i18n.t('panels.news'), snapshot: news,
      body: listMarkup(rows, i18n.t('status.empty')),
      onCopy: ctx.onCopy,
      copyText: (news?.items ?? []).map((n) => `${n.title} — ${n.link ?? ''}`).join('\n') || undefined,
    }).element,
  );

  return section;
}
