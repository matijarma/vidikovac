// "Još" on the phone: an inline, labelled directory of the four domains the
// tab bar does not carry, each with one line of real current data, plus the
// session and the open pages. Not a layer: a view of the shell.
import type { ModuleId } from '../../../worker/feed/schema';
import type { LayerId } from '../../../worker/protocol';
import { zagrebTime } from '../format';
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
  const chevron = iconMarkup('chevron-right', undefined, 'icon row-chevron');
  const items = MORE_LAYERS.map((layer: LayerId) => {
    const line = LINES[layer]?.(i18n, ctx) ?? i18n.t('directory.noSummary');
    return `<li class="row row-dir" data-key="${layer}"><a class="dir-item" href="#layer=${layer}" data-action="nav" data-layer="${layer}" data-testid="dir-${layer}">${iconMarkup(LAYER_ICONS[layer], undefined, 'icon dir-icon')}<span class="row-main"><span class="row-title">${escapeHtml(i18n.t(`layers.${layer}`))}</span><span class="row-sub">${escapeHtml(line)}</span></span>${chevron}</a></li>`;
  }).join('');
  // The session row tells the truth (T4.1, the T2.4 follow-up): the real expiry while unlocked,
  // the end once frozen, connecting before the join. The pill and the sheet this row opens read
  // the same shell state, so the three never disagree.
  const live = ctx.session;
  const sessionTitle = live?.frozen
    ? i18n.t('directory.sessionFrozen')
    : live?.expiresAt != null
      ? i18n.t('session.unlockedAnnounce', { time: zagrebTime(live.expiresAt) })
      : i18n.t('session.connecting');
  const sessionRow = `<li class="row row-dir" data-key="session"><button type="button" class="dir-item" data-action="session" data-testid="dir-session">${iconMarkup('sliders-horizontal', undefined, 'icon dir-icon')}<span class="row-main"><span class="row-title">${escapeHtml(sessionTitle)}</span><span class="row-sub">${escapeHtml(i18n.t('directory.sessionSub'))}</span></span>${chevron}</button></li>`;
  const pages: [string, string][] = [
    ['/hitno', i18n.t('common.links.hitno')], ['/izvori/', i18n.t('common.links.izvori')],
    ['/privatnost/', i18n.t('common.links.privatnost')], ['/pristupacnost/', i18n.t('common.links.pristupacnost')],
  ];
  return createElementFromHTML(`<section class="layer ws ws-directory" id="layer-directory" data-layer="directory" data-reconcile aria-labelledby="layer-title-directory">
<header class="ws-head"><h2 class="layer-title visually-hidden" id="layer-title-directory" tabindex="-1">${escapeHtml(i18n.t('nav.moreTitle'))}</h2></header>
<ul class="dir-list rows" role="list" aria-label="${escapeAttribute(i18n.t('directory.domains'))}">${items}${sessionRow}</ul>
<nav class="dir-pages" aria-label="${escapeAttribute(i18n.t('directory.pages'))}">${pages.map(([href, label]) => `<a href="${escapeAttribute(href)}">${escapeHtml(label)}</a>`).join('')}</nav>
</section>`);
}
