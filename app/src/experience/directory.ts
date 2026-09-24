// "Još": an inline, labelled directory, the same on both surfaces [O-60]:
// Spremljeno, then the domains the tab bar does not carry (the week's agenda
// as "Događanja ovaj tjedan" with its count line, Vrijeme, Grad, Sigurnost),
// each with one line of real current data, then the personal settings and the
// open pages. Not a layer: a view of the shell.
import type { ModuleId } from '../../../worker/feed/schema';
import type { LayerId } from '../../../worker/protocol';
import { activeCount, NOTIFY_KEYS } from '../core/notify-store';
import { zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import { LAYER_MODULES } from '../layers';
import { eventsCount } from '../layers/kultura';
import type { LayerContext } from '../layers/types';
import { dataNumber, dataText } from '../panels/panel';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import { LAYER_ICONS, MORE_LAYERS, type Surface } from './chrome';
import { safetyState } from './safety-state';
import { unusable } from './status';
import { conditionText } from './text';
import { sourceForPlaceId, dynamicPlaces } from '../city/discovery';
import { routeEntry } from '../transport/catalogue';
import { ct } from '../city/strings';

/** The domains the directory lists: the MORE layers on both surfaces (the desk shows Sada and Karta together). */
export function directoryLayers(_surface: Surface): readonly LayerId[] {
  return MORE_LAYERS;
}

/** What the directory polls: the modules of the domains it summarises, once each. */
export function directoryModules(surface: Surface): readonly ModuleId[] {
  return [...new Set(directoryLayers(surface).flatMap((layer) => LAYER_MODULES[layer]))];
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

/**
 * The week's agenda in one line, the page's own count line [O-53]: "7 događanja · 4 u tijeku",
 * "7 događanja" or "4 događanja u tijeku" (events.countLine / count / ongoingCount, as kultura.ts).
 */
function eventsLine(i18n: I18n, ctx: LayerContext): string {
  const snapshot = ctx.snapshots.dogadanja;
  if (unusable(snapshot)) return i18n.t('directory.noSummary');
  const { count, ongoing } = eventsCount(snapshot, ctx.city, ctx.now);
  if (count && ongoing) return i18n.t('events.countLine', { count, ongoing });
  if (count) return i18n.t('events.count', { count });
  if (ongoing) return i18n.t('events.ongoingCount', { count: ongoing });
  return i18n.t('directory.noSummary');
}

function civicLine(i18n: I18n, ctx: LayerContext): string {
  const act = ctx.snapshots.glasnik?.items[0];
  if (!act || unusable(ctx.snapshots.glasnik)) return i18n.t('directory.noSummary');
  return i18n.t('directory.civicSummary', { broj: dataText(act, 'broj'), godina: dataText(act, 'godina') });
}

/** The week's agenda row [O-51, O-60]: Događanja is reached only from here, under its own title and test id. */
const EVENTS_ROW = { layer: 'kultura', testid: 'dir-kultura' } as const;

const LINES: Record<string, (i18n: I18n, ctx: LayerContext) => string> = {
  'zrak-i-nebo': weatherLine,
  sigurnost: safetyLine,
  kultura: eventsLine,
  'uprava-i-pravo': civicLine,
};

export function renderDirectory(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  const surface: Surface = ctx.screen?.surface === 'desktop' ? 'desktop' : 'phone';
  const refs=ctx.saved?.list()??[];
  const sources=refs.filter(ref=>ref.kind==='place').map(ref=>sourceForPlaceId(ref.id)).filter((source):source is string=>Boolean(source));
  if(sources.length)ctx.ensureCity?.(sources);
  const places=ctx.city?[...ctx.city.places,...dynamicPlaces(ctx.city,ctx.now)]:[];
  const savedRows=refs.map(ref=>{
    const place=ref.kind==='place'?places.find(place=>place.id===ref.id):null;
    const stop=ref.kind==='stop'?ctx.stops?.find(stop=>stop.id===ref.id):null;
    const route=ref.kind==='route'?routeEntry(ref.id):null;
    const name=route?`${route.short} · ${route.long}`:place?.name??stop?.name??i18n.t('directory.savedRecord',{id:ref.id});
    const kind=ref.kind==='route'?i18n.t('directory.route'):ref.kind==='stop'?i18n.t('directory.stop'):ct(i18n,'venues');
    const remove=i18n.t('directory.remove');
    return `<li class="row saved-row" data-key="saved-${ref.kind}-${escapeAttribute(ref.id)}"><a class="dir-item" href="#layer=u-pokretu&kind=${ref.kind}&id=${encodeURIComponent(ref.id)}" data-action="nav" data-layer="u-pokretu" data-selection="${escapeAttribute(JSON.stringify(ref))}"><span class="row-main"><span class="row-title">${escapeHtml(name)}</span><span class="row-sub">${escapeHtml(kind)}</span></span></a><button class="btn-quiet" type="button" data-action="saved-remove" data-kind="${ref.kind}" data-id="${escapeAttribute(ref.id)}" aria-label="${escapeAttribute(`${remove}: ${name}`)}">${escapeHtml(remove)}</button></li>`;
  }).join('');
  const savedSection=`<section class="dir-saved" data-testid="saved-section"><h3>${escapeHtml(i18n.t('directory.saved'))}</h3>${savedRows?`<ul class="rows">${savedRows}</ul>`:`<p class="city-meta">${escapeHtml(i18n.t('directory.savedEmpty'))}</p>`}</section>`;
  const chevron = iconMarkup('chevron-right', undefined, 'icon row-chevron');
  const items = directoryLayers(surface).map((layer: LayerId) => {
    const line = LINES[layer]?.(i18n, ctx) ?? i18n.t('directory.noSummary');
    // The row says "Događanja ovaj tjedan"; the page itself keeps its word, Događanja.
    const events = layer === EVENTS_ROW.layer;
    const title = events ? i18n.t('directory.eventsWeek') : i18n.t(`layers.${layer}`);
    const testid = events ? EVENTS_ROW.testid : `dir-${layer}`;
    return `<li class="row row-dir" data-key="${layer}"><a class="dir-item" href="#layer=${layer}" data-action="nav" data-layer="${layer}" data-testid="${testid}">${iconMarkup(LAYER_ICONS[layer], undefined, 'icon dir-icon')}<span class="row-main"><span class="row-title">${escapeHtml(title)}</span><span class="row-sub">${escapeHtml(line)}</span></span>${chevron}</a></li>`;
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
${savedSection}
${items?`<section><h3>${escapeHtml(i18n.t('directory.destinations'))}</h3><ul class="dir-list rows" role="list" aria-label="${escapeAttribute(i18n.t('directory.domains'))}">${items}</ul></section>`:''}
<section><h3>${escapeHtml(i18n.t('directory.preferences'))}</h3><ul class="dir-list rows" role="list">${notifyRow}${sessionRow}</ul></section>
<nav class="dir-pages" aria-label="${escapeAttribute(i18n.t('directory.pages'))}">${pages.map(([href, label]) => `<a href="${escapeAttribute(href)}">${escapeHtml(label)}</a>`).join('')}</nav>
</section>`);
}
