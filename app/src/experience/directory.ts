// "Još": an inline, labelled directory, the same on both surfaces [O-60]:
// Spremljeno, then the domains the tab bar does not carry (the week's agenda
// as "Događanja ovaj tjedan" with its count line, Vrijeme, Grad, Sigurnost),
// each with one line of real current data, then the personal settings and the
// open pages. Not a layer: a view of the shell.
//
// "Osobne postavke" is the one place of every personal setting (owner, 30 Sep
// 2026): language, theme, in-app highlighting, cycle paths, refresh, countdown,
// then the session row into the session sheet. Every row is the same shape: an
// icon, the setting's name, its current state as the sub-line, and a tap that
// moves to the next state. A two-state setting is a switch; language and theme
// cycle through their values, and their accessible name says what a tap does.
import type { ModuleId } from '../../../worker/feed/schema';
import type { LayerId } from '../../../worker/protocol';
import { activeCount, NOTIFY_KEYS } from '../core/notify-store';
import { zagrebTime } from '../format';
import { SUPPORTED_LOCALES, catalogueLocale, createDefaultI18n, type SupportedLocale } from '../i18n/create-default-i18n';
import type { I18n, LocaleCode } from '../i18n/i18n';
import { LAYER_MODULES } from '../layers';
import { CULTURE_MODULES, eventsCount } from '../layers/kultura';
import type { LayerContext } from '../layers/types';
import { dataNumber, dataText } from '../panels/panel';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup, type IconName } from '../ui/icons';
import { THEME_PREFERENCES, type ThemePreference } from '../ui/theme';
import { LAYER_ICONS, MORE_LAYERS, type Surface } from './chrome';
import { safetyState } from './safety-state';
import { unusable } from './status';
import { originSentence } from './session-origin';
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
  const { count, ongoing } = eventsCount(snapshot, ctx.city, ctx.now, CULTURE_MODULES.map((id) => ctx.snapshots[id]));
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

/** The language a tap on the language row moves to: the next supported one, in the catalogue's order. */
export function nextLocale(current: LocaleCode): LocaleCode {
  const at = SUPPORTED_LOCALES.indexOf(catalogueLocale(current));
  return SUPPORTED_LOCALES[(at + 1) % SUPPORTED_LOCALES.length]!;
}

/** The theme a tap on the theme row moves to: the next preference in THEME_PREFERENCES' order. */
export function nextTheme(current: ThemePreference): ThemePreference {
  return THEME_PREFERENCES[(THEME_PREFERENCES.indexOf(current) + 1) % THEME_PREFERENCES.length]!;
}

/** One reader per catalogue, for the language row: it speaks the language a tap moves to, in that language's words. */
const LOCALE_READERS = new Map<SupportedLocale, I18n>();
function readerOf(locale: SupportedLocale): I18n {
  let reader = LOCALE_READERS.get(locale);
  if (!reader) { reader = createDefaultI18n(locale); LOCALE_READERS.set(locale, reader); }
  return reader;
}

interface SettingRow { key: string; action: string; testid: string; icon: IconName; title: string; sub: string }

/** The row's two lines; the attributes let a cycle row announce its new value and a line say which language it is in.
 *  The space between the two keeps the name and the state two words apart in a name read from the content (a switch's). */
function rowText(title: string, sub: string, subAttrs = '', titleAttrs = ''): string {
  return `<span class="row-main"><span class="row-title"${titleAttrs}>${escapeHtml(title)}</span> <span class="row-sub"${subAttrs}>${escapeHtml(sub)}</span></span>`;
}

const langAttr = (lang: string | undefined): string => (lang ? ` lang="${escapeAttribute(lang)}"` : '');

/** A two-state setting: the shared switch semantics (role=switch, aria-checked) and its track at the end of the row. */
function switchRow(r: SettingRow, on: boolean): string {
  return `<li class="row row-dir" data-key="${r.key}"><button type="button" class="dir-item" role="switch" aria-checked="${on ? 'true' : 'false'}" data-action="${r.action}" data-testid="${r.testid}">${iconMarkup(r.icon, undefined, 'icon dir-icon')}${rowText(r.title, r.sub)}<span class="switch-track" aria-hidden="true"></span></button></li>`;
}

/** A setting with more than two values: a plain button whose sub-line is the current value, said again when a tap
 *  changes it (aria-live on the sub-line), and whose name says the value a tap moves to (`label`). `langs` marks a
 *  row that speaks two languages: the name and the title in the one a tap moves to, the sub-line in the page's. */
function cycleRow(r: SettingRow, label: string, langs?: { to: string; sub: string }): string {
  const subAttrs = ` aria-live="polite"${langAttr(langs?.sub)}`;
  return `<li class="row row-dir" data-key="${r.key}"><button type="button" class="dir-item" data-action="${r.action}" data-testid="${r.testid}" aria-label="${escapeAttribute(label)}"${langAttr(langs?.to)}>${iconMarkup(r.icon, undefined, 'icon dir-icon')}${rowText(r.title, r.sub, subAttrs, langAttr(langs?.to))}</button></li>`;
}

/** A row that opens a sheet (the alert switches, the session): the chevron at the end, and a name that says so. */
function sheetRow(r: SettingRow, chevron: string): string {
  return `<li class="row row-dir" data-key="${r.key}"><button type="button" class="dir-item" data-action="${r.action}" data-testid="${r.testid}" aria-haspopup="dialog">${iconMarkup(r.icon, undefined, 'icon dir-icon')}${rowText(r.title, r.sub)}${chevron}</button></li>`;
}

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
  // the same shell state, so the three never disagree. Its sub-line is where the session came
  // from, said short (the screen's label, else its stop); before the join, what the row opens.
  const live = ctx.session;
  const sessionTitle = live?.frozen
    ? i18n.t('directory.sessionFrozen')
    : live?.expiresAt != null
      ? i18n.t('session.unlockedAnnounce', { time: zagrebTime(live.expiresAt) })
      : i18n.t('session.connecting');
  const origin = originSentence(i18n, { role: live?.role ?? null, label: live?.label ?? null, stop: ctx.screen?.stop?.name ?? null }, true);
  const sessionRow = sheetRow({ key: 'session', action: 'session', testid: 'dir-session', icon: 'clock', title: sessionTitle, sub: origin || i18n.t('directory.sessionSub') }, chevron);
  // The language row speaks the language a tap moves to (owner, 30 Sep 2026): a reader who does not understand the
  // page finds "Language: English" in their own words. The word and the name come from that language's catalogue
  // (common.language, directory.languageName), so a new locale brings its own; the name adds what a tap does, in
  // that language too. The sub-line is for those who read the page: the language it is in now, in its own words.
  const locale = catalogueLocale(i18n.getLocale());
  const nextLang = catalogueLocale(nextLocale(locale));
  const target = readerOf(nextLang);
  const targetName = target.t('directory.languageName');
  const languageTitle = `${target.t('common.language')}: ${targetName}`;
  const languageRow = cycleRow(
    { key: 'language', action: 'lang-next', testid: 'dir-language', icon: 'languages', title: languageTitle, sub: i18n.t('directory.languageCurrent', { name: i18n.t('directory.languageName') }) },
    `${languageTitle}. ${target.t('directory.languageAction', { name: targetName })}`, { to: nextLang, sub: locale },
  );
  // The theme row, while the page has a theme controller: its preference in the catalogue's words (common.theme.*).
  const theme = ctx.settings?.theme ?? null;
  const themeRow = theme ? cycleRow(
    { key: 'theme', action: 'theme-next', testid: 'dir-theme', icon: 'sun-moon', title: i18n.t('common.theme.label'), sub: i18n.t(`common.theme.${theme}`) },
    i18n.t('directory.themeNext', { current: i18n.t(`common.theme.${theme}`), next: i18n.t(`common.theme.${nextTheme(theme)}`) }),
  ) : '';
  // The bell's own row (D7): the Kvart panel used to be the only way to reach the notify sheet; now
  // Još carries it. Several switches stand behind it (NOTIFY_KEYS), so the row opens their sheet and
  // says how many are on; the sheet's note says nothing is sent.
  const notifyCount = ctx.notify ? activeCount(ctx.notify, NOTIFY_KEYS) : 0;
  // "isključeno" follows a colon elsewhere; as the row's whole sub-line it opens the line, capitalised.
  const notifyOff = i18n.t('kvart.notifyOff');
  const notifyState = notifyCount > 0 ? i18n.t('kvart.notifyOn', { count: notifyCount }) : notifyOff.charAt(0).toLocaleUpperCase(locale) + notifyOff.slice(1);
  const notifyRow = sheetRow({ key: 'notify', action: 'notify', testid: 'dir-notify', icon: 'bell', title: i18n.t('notify.title'), sub: notifyState }, chevron);
  // Karta's cycle paths: drawn while a BAJS station is selected, or always when this switch is on.
  const lanesAlways = ctx.bikeLanes?.snapshot() === 'always';
  const bikeLanesRow = ctx.bikeLanes ? switchRow({ key: 'bike-lanes', action: 'bike-lanes-toggle', testid: 'dir-bike-lanes', icon: 'bike', title: i18n.t('directory.bikeLanes'), sub: i18n.t(lanesAlways ? 'directory.bikeLanesAlways' : 'directory.bikeLanesBajs') }, lanesAlways) : '';
  // Refreshing and the header's countdown, this page's own two switches, while the session lasts.
  const settings = ctx.settings;
  const running = settings && !live?.frozen;
  const refreshRow = running ? switchRow({ key: 'refresh', action: 'refresh-toggle', testid: 'dir-refresh', icon: 'refresh-cw', title: i18n.t('directory.refresh'), sub: i18n.t(settings.paused ? 'directory.refreshOff' : 'directory.refreshOn') }, !settings.paused) : '';
  const countdownRow = running ? switchRow({ key: 'countdown', action: 'countdown-toggle', testid: 'dir-countdown', icon: 'eye', title: i18n.t('directory.countdown'), sub: i18n.t(settings.countdownHidden ? 'directory.countdownOff' : 'directory.countdownOn') }, !settings.countdownHidden) : '';
  const pages: [string, string][] = [
    ['/hitno', i18n.t('common.links.hitno')], ['/izvori/', i18n.t('common.links.izvori')],
    ['/privatnost/', i18n.t('common.links.privatnost')], ['/pristupacnost/', i18n.t('common.links.pristupacnost')],
  ];
  return createElementFromHTML(`<section class="layer ws ws-directory" id="layer-directory" data-layer="directory" data-reconcile aria-labelledby="layer-title-directory">
<header class="ws-head"><h2 class="layer-title visually-hidden" id="layer-title-directory" tabindex="-1">${escapeHtml(i18n.t('nav.moreTitle'))}</h2></header>
${savedSection}
${items?`<section><h3>${escapeHtml(i18n.t('directory.destinations'))}</h3><ul class="dir-list rows" role="list" aria-label="${escapeAttribute(i18n.t('directory.domains'))}">${items}</ul></section>`:''}
<section><h3>${escapeHtml(i18n.t('directory.preferences'))}</h3><ul class="dir-list rows" role="list">${languageRow}${themeRow}${notifyRow}${bikeLanesRow}${refreshRow}${countdownRow}${sessionRow}</ul></section>
<nav class="dir-pages" aria-label="${escapeAttribute(i18n.t('directory.pages'))}">${pages.map(([href, label]) => `<a href="${escapeAttribute(href)}">${escapeHtml(label)}</a>`).join('')}</nav>
</section>`);
}
