// "Još" on the phone: an inline, labelled directory of the four domains the
// tab bar does not carry, each with one line of real current data, plus the
// session and the open pages. Not a layer: a view of the shell.
import type { ModuleId } from '../../../worker/feed/schema';
import type { LayerId } from '../../../worker/protocol';
import type { I18n } from '../i18n/i18n';
import { LAYER_MODULES } from '../layers';
import type { LayerContext } from '../layers/types';
import { dataNumber, dataText } from '../panels/panel';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import { LAYER_ICONS, MORE_LAYERS } from './chrome';
import { safetyState } from './safety-state';
import { unusable } from './status';
import { conditionText } from './text';

/** What the directory polls: the modules of the four domains it summarises. */
export const DIRECTORY_MODULES: readonly ModuleId[] = [...new Set(MORE_LAYERS.flatMap((layer) => LAYER_MODULES[layer]))];

function weatherLine(i18n: I18n, ctx: LayerContext): string {
  const observation = ctx.snapshots['dhmz-now'];
  const o = observation?.items[0];
  const temp = dataNumber(o, 'temp');
  if (!o || temp === null || unusable(observation)) return i18n.t('directory.noSummary');
  const condition = conditionText(dataText(o, 'weather'));
  return condition ? i18n.t('directory.weatherSummary', { temp: temp.toLocaleString(i18n.getLocale() === 'en' ? 'en-GB' : 'hr-HR'), condition }) : `${temp} °C`;
}

function safetyLine(i18n: I18n, ctx: LayerContext): string {
  const state = safetyState(ctx.snapshots, ctx.now);
  if (state.level === 'urgent') return i18n.t('directory.safetySummaryUrgent');
  if (state.level === 'calm') return i18n.t('directory.safetySummaryCalm');
  return i18n.t('directory.safetySummaryUnknown');
}

function civicLine(i18n: I18n, ctx: LayerContext): string {
  const act = ctx.snapshots.glasnik?.items[0];
  if (!act || unusable(ctx.snapshots.glasnik)) return i18n.t('directory.noSummary');
  return i18n.t('directory.civicSummary', { broj: dataText(act, 'broj'), godina: dataText(act, 'godina') });
}

function newsLine(i18n: I18n, ctx: LayerContext): string {
  const news = ctx.snapshots['hrt-news'];
  if (!news || unusable(news)) return i18n.t('directory.noSummary');
  const count = news.items.filter((item) => item.at && ctx.now - Date.parse(item.at) < 86_400_000).length;
  return count > 0 ? i18n.t('directory.newsSummary', { count }) : i18n.t('directory.noSummary');
}

const LINES: Record<string, (i18n: I18n, ctx: LayerContext) => string> = {
  'zrak-i-nebo': weatherLine,
  sigurnost: safetyLine,
  'uprava-i-pravo': civicLine,
  vijesti: newsLine,
};

export function renderDirectory(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  const items = MORE_LAYERS.map((layer: LayerId) => {
    const line = LINES[layer]?.(i18n, ctx) ?? i18n.t('directory.noSummary');
    const current = ctx.view?.layer === layer;
    return `<li data-key="${layer}"><a class="dir-item" href="#layer=${layer}" data-action="nav" data-layer="${layer}" aria-current="${current ? 'page' : 'false'}" data-testid="dir-${layer}">${iconMarkup(LAYER_ICONS[layer])}<span class="dir-text"><span class="dir-title">${escapeHtml(i18n.t(`layers.${layer}`))}</span><span class="dir-line">${escapeHtml(line)}</span></span>${iconMarkup('chevron-right', undefined, 'icon row-chevron')}</a></li>`;
  }).join('');
  const pages: [string, string][] = [
    ['/hitno', i18n.t('common.links.hitno')], ['/izvori/', i18n.t('common.links.izvori')],
    ['/privatnost/', i18n.t('common.links.privatnost')], ['/pristupacnost/', i18n.t('common.links.pristupacnost')],
  ];
  return createElementFromHTML(`<section class="layer ws ws-directory" id="layer-directory" data-layer="directory" data-reconcile aria-labelledby="layer-title-directory">
<header class="ws-head"><h2 class="layer-title" id="layer-title-directory" tabindex="-1">${escapeHtml(i18n.t('nav.moreTitle'))}</h2><p class="meta">${escapeHtml(i18n.t('directory.intro'))}</p></header>
<ul class="dir-list rows" role="list" aria-label="${escapeAttribute(i18n.t('directory.domains'))}">${items}</ul>
<section class="sec" aria-labelledby="dir-session-title"><h3 class="sec-title" id="dir-session-title">${escapeHtml(i18n.t('directory.session'))}</h3><button type="button" class="btn-ghost" data-action="session">${iconMarkup('ticket')}<span>${escapeHtml(i18n.t('shell.settings'))}</span></button></section>
<nav class="dir-pages" aria-label="${escapeAttribute(i18n.t('directory.pages'))}">${pages.map(([href, label]) => `<a href="${escapeAttribute(href)}">${escapeHtml(label)}</a>`).join('')}</nav>
</section>`);
}
