// The shell around the workspace: phone top bar and tab bar, desktop sidebar,
// and the banners for the session's own states. Pure markup builders over a
// ShellState; the dashboard reconciles each region in place.
import type { LayerId, Role } from '../../../worker/protocol';
import { countdown, zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import type { SessionPhase } from '../session';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { ring } from '../ui/graphics';
import { iconMarkup, type IconName } from '../ui/icons';

export const PHONE_TABS: readonly LayerId[] = ['grad-sada', 'u-pokretu', 'kultura'];
export const MORE_LAYERS: readonly LayerId[] = ['zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'vijesti'];
export const SIDEBAR_LAYERS: readonly LayerId[] = ['grad-sada', 'u-pokretu', 'zrak-i-nebo', 'kultura', 'uprava-i-pravo', 'vijesti', 'sigurnost'];

export const LAYER_ICONS: Record<LayerId, IconName> = {
  'grad-sada': 'home',
  'u-pokretu': 'tram-front',
  'zrak-i-nebo': 'cloud-sun',
  sigurnost: 'shield',
  'uprava-i-pravo': 'landmark',
  kultura: 'calendar-days',
  vijesti: 'newspaper',
};

export interface ShellState {
  layer: LayerId;
  directory: boolean;
  phase: SessionPhase;
  frozen: boolean;
  reconnecting: boolean;
  secondsLeft: number;
  totalSeconds: number | null;
  expiresAt: number | null;
  countdownHidden: boolean;
  paused: boolean;
  loading: boolean;
  canShare: boolean;
  label: string | null;
  role: Role | null;
  participants: number;
  error: string | null;
  lastRefresh: number | null;
  mapFull: boolean;
}

export function remainingText(seconds: number): string {
  return countdown(seconds);
}

function layerLabel(i18n: I18n, layer: LayerId): string {
  return i18n.t(`layers.${layer}`);
}

function sessionRing(s: ShellState): string {
  const total = s.totalSeconds ?? Math.max(1, s.secondsLeft);
  return ring(s.frozen ? 0 : s.secondsLeft / total);
}

/** The phone top bar: wordmark, session chip, one-tap safety. At most 56 px tall (CSS). */
export function topBarMarkup(i18n: I18n, s: ShellState): string {
  const time = s.frozen ? i18n.t('session.frozenBadge') : s.phase === 'live' ? remainingText(s.secondsLeft) : i18n.t('shell.connecting');
  const chipText = s.countdownHidden && !s.frozen ? i18n.t('shell.session') : time;
  const chipLabel = s.frozen ? i18n.t('session.expiredTitle') : i18n.t('session.openSheet', { time: s.countdownHidden ? i18n.t('shell.session') : time });
  return `<a class="ki-wordmark" href="/" aria-label="${escapeAttribute(i18n.t('shell.wordmarkLabel'))}"><span class="ki-wordmark-text">${escapeHtml(i18n.t('common.appName'))}</span></a>
<div class="ki-top-actions">
<button type="button" class="ki-chip" data-action="session" data-testid="session-chip" data-state="${s.frozen ? 'frozen' : s.phase}" aria-label="${escapeAttribute(chipLabel)}">${sessionRing(s)}<span class="ki-chip-time tabular" data-testid="countdown">${escapeHtml(chipText)}</span></button>
<a class="btn-quiet icon-btn ki-safety" href="#layer=sigurnost" data-action="nav" data-layer="sigurnost" data-testid="safety-shortcut" aria-label="${escapeAttribute(i18n.t('nav.safety'))}" title="${escapeAttribute(i18n.t('nav.safetyHint'))}" aria-current="${s.layer === 'sigurnost' && !s.directory ? 'page' : 'false'}">${iconMarkup('shield')}</a>
</div>`;
}

function navItem(i18n: I18n, s: ShellState, layer: LayerId, className: string): string {
  const current = s.layer === layer && !s.directory;
  return `<li><a class="${className}" href="#layer=${layer}" data-action="nav" data-layer="${layer}" aria-current="${current ? 'page' : 'false'}"${s.frozen ? ' aria-disabled="true"' : ''}>${iconMarkup(LAYER_ICONS[layer])}<span class="ki-nav-label">${escapeHtml(layerLabel(i18n, layer))}</span></a></li>`;
}

/** The phone tab bar: Sada, Promet, Događanja and Još, which names the open extra domain. */
export function tabbarMarkup(i18n: I18n, s: ShellState): string {
  const inMore = MORE_LAYERS.includes(s.layer);
  const moreCurrent = s.directory || inMore;
  const moreLabel = inMore && !s.directory ? layerLabel(i18n, s.layer) : i18n.t('nav.more');
  return `<ul class="ki-tabs" role="list">${PHONE_TABS.map((layer) => navItem(i18n, s, layer, 'ki-tab')).join('')}<li><button type="button" class="ki-tab" data-action="directory" data-testid="tab-more" aria-current="${moreCurrent ? 'page' : 'false'}" aria-expanded="${s.directory ? 'true' : 'false'}"${s.frozen ? ' aria-disabled="true"' : ''}>${iconMarkup(inMore && !s.directory ? LAYER_ICONS[s.layer] : 'ellipsis')}<span class="ki-nav-label">${escapeHtml(moreLabel)}</span></button></li></ul>`;
}
/**
 * The one session element, placed by the shell grid: a compact chip in the
 * phone top bar, the session card at the foot of the desktop sidebar. It
 * carries the same expiry the screen shows (data-expires-at) and opens the
 * session sheet.
 */
export function sessionMarkup(i18n: I18n, s: ShellState): string {
  const time = remainingText(s.secondsLeft);
  const sentence = s.frozen
    ? i18n.t('session.expiredTitle')
    : s.phase === 'live' && s.expiresAt !== null
      ? i18n.t('session.unlocked', { label: s.label ?? i18n.t('session.labelScreen'), time: zagrebTime(s.expiresAt) })
      : s.reconnecting
        ? i18n.t('session.disconnected')
        : i18n.t('session.connecting');
  const timeText = s.frozen ? i18n.t('session.frozenBadge') : s.countdownHidden ? i18n.t('shell.session') : s.phase === 'live' ? time : '';
  const state = s.frozen ? 'frozen' : s.reconnecting ? 'reconnecting' : s.phase;
  const expires = s.expiresAt !== null ? ` data-expires-at="${s.expiresAt}"` : '';
  return `<button type="button" class="ki-session" data-action="session" data-testid="session-label" data-state="${state}"${expires} title="${escapeAttribute(i18n.t('session.sheetTitle'))}">${sessionRing(s)}<span class="ki-session-text"><span class="ki-session-sentence">${escapeHtml(sentence)}</span><span class="ki-session-time tabular" data-testid="countdown"${timeText ? '' : ' hidden'}>${escapeHtml(timeText)}</span></span>${iconMarkup('chevron-right', undefined, 'icon ki-session-more')}</button>`;
}

/** The desktop sidebar: seven labelled domains and the footer note. */
export function sidebarMarkup(i18n: I18n, s: ShellState): string {
  const items = SIDEBAR_LAYERS.map((layer) => navItem(i18n, s, layer, 'ki-side-link')).join('');
  return `<ul class="ki-side-list" role="list">${items}</ul><p class="ki-side-foot meta">${escapeHtml(i18n.t('shell.footerNote'))}</p>`;
}

/** The wordmark region, shown on both surfaces. */
export function wordmarkMarkup(i18n: I18n): string {
  return `<a class="ki-wordmark" href="/" aria-label="${escapeAttribute(i18n.t('shell.wordmarkLabel'))}"><span class="ki-wordmark-text">${escapeHtml(i18n.t('common.appName'))}</span></a>`;
}

/** One-tap safety, phone only (the sidebar lists Sigurnost as a domain). */
export function safetyMarkup(i18n: I18n, s: ShellState): string {
  const current = s.layer === 'sigurnost' && !s.directory;
  return `<a class="ki-safety" href="#layer=sigurnost" data-action="nav" data-layer="sigurnost" data-testid="safety-shortcut" aria-label="${escapeAttribute(i18n.t('nav.safety'))}" title="${escapeAttribute(i18n.t('nav.safetyHint'))}" aria-current="${current ? 'page' : 'false'}">${iconMarkup('shield')}<span class="ki-nav-label">${escapeHtml(i18n.t('nav.safety'))}</span></a>`;
}

/** Session-state banners: expired (with the way to a new session), reconnecting, no ticket, paused. */
export function bannersMarkup(i18n: I18n, s: ShellState, scanUrl: string): string {
  const out: string[] = [];
  if (s.frozen) {
    out.push(`<div class="banner banner-frozen" role="alert" data-testid="frozen-line" data-key="frozen"><p class="banner-text">${escapeHtml(i18n.t('session.expired'))}</p><p class="banner-sub">${escapeHtml(i18n.t('session.expiredHint'))}</p><a class="btn btn-primary" href="${escapeAttribute(scanUrl)}">${iconMarkup('qr-code')}<span>${escapeHtml(i18n.t('session.expiredCta'))}</span></a></div>`);
  } else if (s.error === 'no-ticket') {
    out.push(`<div class="banner banner-warn" role="alert" data-key="no-ticket"><p class="banner-text">${escapeHtml(i18n.t('session.noTicket'))}</p><a class="btn" href="${escapeAttribute(scanUrl)}">${escapeHtml(i18n.t('common.links.scan'))}</a></div>`);
  } else if (s.error === 'access') {
    out.push(`<div class="banner banner-warn" role="alert" data-key="access" data-testid="access-banner"><p class="banner-text">${escapeHtml(i18n.t('session.accessDenied'))}</p><a class="btn" href="/">${escapeHtml(i18n.t('common.links.home'))}</a></div>`);
  } else if (s.reconnecting) {
    out.push(`<div class="banner banner-warn" role="status" data-key="reconnecting" data-testid="reconnecting">${iconMarkup('refresh-cw')}<p class="banner-text">${escapeHtml(i18n.t('session.disconnected'))}</p></div>`);
  }
  if (s.paused && !s.frozen) {
    const time = s.lastRefresh !== null ? zagrebTime(s.lastRefresh) : '';
    out.push(`<div class="banner banner-quiet" role="status" data-key="paused" data-testid="paused-banner"><p class="banner-text">${escapeHtml(i18n.t('shell.paused', { time }))}</p><button type="button" class="btn-ghost" data-action="resume">${iconMarkup('play')}<span>${escapeHtml(i18n.t('session.resumeRefresh'))}</span></button></div>`);
  }
  return out.join('');
}
