// "Još": an inline, labelled directory of the domains the tab bar does not
// carry (the five MORE layers on the phone; Promet ahead of them at the desk,
// where the rail is gone, D10), each with one line of real current data, plus
// the session and the open pages. Not a layer: a view of the shell.
import type { ModuleId } from '../../../worker/feed/schema';
import type { LayerId } from '../../../worker/protocol';
import { activeCount, NOTIFY_KEYS } from '../core/notify-store';
import { zagrebDayKey, zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import { LAYER_MODULES } from '../layers';
import { CULTURE_EVENT_SOURCES, filterBySource, isDated } from '../layers/kultura';
import { vehicleCount } from '../layers/shared';
import type { LayerContext } from '../layers/types';
import { dataNumber, dataText } from '../panels/panel';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import { LAYER_ICONS, MORE_LAYERS, type Surface } from './chrome';
import { safetyState } from './safety-state';
import { unusable } from './status';
import { conditionText } from './text';

/** The domains the directory lists: the MORE layers, with Promet first at the desk (its tab is a phone device). */
export function directoryLayers(surface: Surface): readonly LayerId[] {
  return surface === 'desktop' ? ['u-pokretu', ...MORE_LAYERS] : MORE_LAYERS;
}

/** What the directory polls: the modules of the domains it summarises, once each. */
export function directoryModules(surface: Surface): readonly ModuleId[] {
  return [...new Set(directoryLayers(surface).flatMap((layer) => LAYER_MODULES[layer]))];
}

function transitLine(i18n: I18n, ctx: LayerContext): string {
  const zet = ctx.snapshots['zet-rt'];
  if (unusable(zet)) return i18n.t('directory.noSummary');
  const count = vehicleCount(zet);
  return count === null ? i18n.t('directory.noSummary') : i18n.t('transit.vehiclesMoving', { count });
}

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

/** Today's dated culture and community events (kultura.ts's own source subset and date rule). */
function eventsLine(i18n: I18n, ctx: LayerContext): string {
  const snapshot = ctx.snapshots.dogadanja;
  if (unusable(snapshot)) return i18n.t('directory.noSummary');
  const today = zagrebDayKey(ctx.now);
  const count = filterBySource(snapshot, CULTURE_EVENT_SOURCES).filter((item) => isDated(item) && zagrebDayKey(item.at) === today).length;
  return count > 0 ? i18n.t('directory.eventsSummary', { count }) : i18n.t('directory.noSummary');
}

function civicLine(i18n: I18n, ctx: LayerContext): string {
  const act = ctx.snapshots.glasnik?.items[0];
  if (!act || unusable(ctx.snapshots.glasnik)) return i18n.t('directory.noSummary');
  return i18n.t('directory.civicSummary', { broj: dataText(act, 'broj'), godina: dataText(act, 'godina') });
}

const LINES: Record<string, (i18n: I18n, ctx: LayerContext) => string> = {
  'u-pokretu': transitLine,
  'zrak-i-nebo': weatherLine,
  sigurnost: safetyLine,
  kultura: eventsLine,
  'uprava-i-pravo': civicLine,
};

export function renderDirectory(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  const surface: Surface = ctx.screen?.surface === 'desktop' ? 'desktop' : 'phone';
  const chevron = iconMarkup('chevron-right', undefined, 'icon row-chevron');
  const items = directoryLayers(surface).map((layer: LayerId) => {
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
  // The bell's own row (D7): the Kvart panel used to be the only way to reach the notify
  // sheet; now Još carries it, reusing the bell's own label key and note (no new copy).
  const notifyCount = ctx.notify ? activeCount(ctx.notify, NOTIFY_KEYS) : 0;
  const notifyState = notifyCount > 0 ? i18n.t('kvart.notifyOn', { count: notifyCount }) : i18n.t('kvart.notifyOff');
  const notifyRow = `<li class="row row-dir" data-key="notify"><button type="button" class="dir-item" data-action="notify" data-testid="dir-notify">${iconMarkup('bell', undefined, 'icon dir-icon')}<span class="row-main"><span class="row-title">${escapeHtml(i18n.t('notify.bellLabel', { state: notifyState }))}</span><span class="row-sub">${escapeHtml(i18n.t('notify.note'))}</span></span>${chevron}</button></li>`;
  const pages: [string, string][] = [
    ['/hitno', i18n.t('common.links.hitno')], ['/izvori/', i18n.t('common.links.izvori')],
    ['/privatnost/', i18n.t('common.links.privatnost')], ['/pristupacnost/', i18n.t('common.links.pristupacnost')],
  ];
  return createElementFromHTML(`<section class="layer ws ws-directory" id="layer-directory" data-layer="directory" data-reconcile aria-labelledby="layer-title-directory">
<header class="ws-head"><h2 class="layer-title visually-hidden" id="layer-title-directory" tabindex="-1">${escapeHtml(i18n.t('nav.moreTitle'))}</h2></header>
<ul class="dir-list rows" role="list" aria-label="${escapeAttribute(i18n.t('directory.domains'))}">${items}${notifyRow}${sessionRow}</ul>
<nav class="dir-pages" aria-label="${escapeAttribute(i18n.t('directory.pages'))}">${pages.map(([href, label]) => `<a href="${escapeAttribute(href)}">${escapeHtml(label)}</a>`).join('')}</nav>
</section>`);
}
