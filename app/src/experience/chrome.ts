// The shell around the workspace: one status line for both surfaces (the
// wordmark, Zaslon, "Podijeli grad", the session pill and the safety control,
// plus Još at the desk), the phone tab bar Sada · Karta · Još, and the banners
// for the session's own states. Pure markup builders over a ShellState; the
// dashboard reconciles each region in place. The rail, the sidebar and the
// desk's six-domain bar are gone (plan D4, D10; companion WP4).
import type { LayerId, Role } from '../../../worker/protocol';
import type { CastReason } from '../core/contracts';
import type { NotifyFlags, NotifyKey } from '../core/notify-store';
import { countdown, zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import type { SessionPhase } from '../session';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { ring } from '../ui/graphics';
import { iconMarkup, type IconName } from '../ui/icons';
import { weatherStatusMarkup, type WeatherStatus } from './weather-status';
import type { PresentationState } from '../../../worker/presentation';
import { presentationButton } from './presentation';

export type Surface = 'phone' | 'desktop';
/** A phone tab: a domain, a shell surface and never a LayerId (D9). */
export type PhoneTab = { kind: 'layer'; layer: LayerId };
/** Sada · Karta, then Još [O-51]: Događanja is a Još row now, no longer a tab. */
export const PHONE_TABS: readonly PhoneTab[] = [{ kind: 'layer', layer: 'grad-sada' }, { kind: 'layer', layer: 'u-pokretu' }];
/** Još's destinations in the owner's order [O-60]: the week's agenda first, then Vrijeme, Grad and Sigurnost. */
export const MORE_LAYERS: readonly LayerId[] = ['kultura', 'zrak-i-nebo', 'uprava-i-pravo', 'sigurnost'];

export const LAYER_ICONS: Record<LayerId, IconName> = {
  'grad-sada': 'home',
  'u-pokretu': 'tram-front',
  'zrak-i-nebo': 'cloud-sun',
  sigurnost: 'shield',
  'uprava-i-pravo': 'landmark',
  kultura: 'calendar-days',
};

/** The one in-flow notice: the 60 s and 20 s marks, a share refusal (8 s). The unlock itself gets none: the pill says it. */
export type NoticeKind = 'expiring60' | 'expiring20' | 'refusal';
export interface ShellNotice { kind: NoticeKind; text: string; until: number | null }

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
  /** Shown in the banners row; the hidden live regions do the announcing, so it carries no role. */
  notice: ShellNotice | null;
  /** Active modules whose last fetch failed or whose snapshot is down, said once in a quiet banner. */
  sourcesDown: number;
  surface: Surface;
  /** The screen stop's name, for the cast reason line. */
  stopName: string | null;
  hasScreen: boolean;
  canCast: boolean;
  castReason: CastReason | null;
  /** True for the moment after a cast, while the polite region says so: the FAB carries data-sent. */
  castSent: boolean;
  presentation?: PresentationState;
  presentationOpen?: boolean;
  notify: NotifyFlags;
  notifyActive: number;
  notifyKeys: readonly NotifyKey[];
}

export function remainingText(seconds: number): string {
  return countdown(seconds);
}

/** The frozen view's date, said the same way everywhere: "podaci od 13:57" (LayerContext.frozenAt). */
export function snapshotLine(i18n: I18n, frozenAt: number): string {
  return i18n.t('session.snapshotAt', { time: zagrebTime(frozenAt) });
}

/** The domain's one word, the same in the tab, the title and the kiosk pill: "Karta" for u-pokretu (layers.*). */
function layerLabel(i18n: I18n, layer: LayerId): string {
  return i18n.t(`layers.${layer}`);
}

function sessionRing(s: ShellState): string {
  const total = s.totalSeconds ?? Math.max(1, s.secondsLeft);
  return ring(s.frozen ? 0 : s.secondsLeft / total);
}

/** Frozen controls stay visible for orientation but leave the Tab order. */
function frozenAttrs(s: ShellState): string {
  return s.frozen ? ' aria-disabled="true" tabindex="-1"' : '';
}

/**
 * The status line: ONE builder paints keyed children by surface, so the DOM is
 * honest for axe and the target rule (CSS orders and sizes, never hides a
 * control that exists). Phone: wordmark · Zaslon · Podijeli grad · session ·
 * safety. Desktop: wordmark · spacer · Zaslon · Podijeli grad · session · Još
 * · safety, one row with no clock and no domain bar (the desk is the phone,
 * wider [O-56]). Zaslon stands while a scanner's session has a screen, the
 * share button while the session can share [O-61].
 */
export function statusLineMarkup(i18n: I18n, s: ShellState): string {
  // Frozen: a plain `#layer=` link would replace the fragment and lose `room=`, so the wordmark
  // becomes the way home instead (the session is over), as on the empty page.
  const wordmark = wordmarkMarkup(i18n, s.frozen ? { href: '/' } : { href: '#layer=grad-sada', layer: 'grad-sada' });
  const session = sessionMarkup(i18n, s);
  const safety = safetyMarkup(i18n, s);
  const display = s.hasScreen && s.role === 'scanner' ? presentationButton(i18n, Boolean(s.presentationOpen), s.presentation) : '';
  const share = shareButtonMarkup(i18n, s);
  if (s.surface === 'phone') return `${wordmark}${display}${share}${session}${safety}`;
  return `${wordmark}<div class="ki-status-space" data-key="space"></div>${display}${share}${session}${moreButtonMarkup(i18n, s)}${safety}`;
}

/**
 * "Podijeli grad" [O-61]: a labelled header button beside the session pill on
 * every screen of a session that can share (the scanner, live, not refused);
 * it asks the room for the code and opens the code and QR dialog. The word is
 * visible; where the header is too narrow for it the icon stays and the
 * aria-label keeps the name. '' when the session cannot share.
 */
export function shareButtonMarkup(i18n: I18n, s: ShellState): string {
  if (!s.canShare) return '';
  const label = escapeAttribute(i18n.t('session.share'));
  return `<button type="button" class="ki-share" data-key="share" data-action="share-city" data-testid="share-city" aria-haspopup="dialog" aria-label="${label}" title="${label}">${iconMarkup('share-2')}<span>${escapeHtml(i18n.t('session.share'))}</span></button>`;
}

/**
 * The wordmark, the one brand gesture: the question mark in the brand tone.
 * The empty page keeps `/`; inside `/d/` the status line points it at Sada
 * (`layer`), the desk's one way home now that the rail is gone (B.10).
 */
export function wordmarkMarkup(i18n: I18n, home: { href: string; layer?: LayerId } = { href: '/' }): string {
  const name = i18n.t('common.appName');
  const mark = name.endsWith('?');
  const stem = mark ? name.slice(0, -1) : name;
  const label = home.layer ? i18n.t('shell.wordmarkSada') : i18n.t('shell.wordmarkLabel');
  const nav = home.layer ? ` data-action="nav" data-layer="${home.layer}"` : '';
  return `<a class="ki-wordmark" data-key="wordmark" href="${escapeAttribute(home.href)}"${nav} aria-label="${escapeAttribute(label)}"><span class="ki-wordmark-text">${escapeHtml(stem)}${mark ? '<span class="ki-wordmark-mark">?</span>' : ''}</span></a>`;
}

/** Desktop: Još opens the directory of the MORE domains (D10). Current while the directory is open. */
export function moreButtonMarkup(i18n: I18n, s: ShellState): string {
  const current = s.directory;
  return `<button type="button" class="ki-more" data-key="more" data-action="directory" data-testid="status-more" aria-expanded="${s.directory ? 'true' : 'false'}" aria-current="${current ? 'page' : 'false'}"${frozenAttrs(s)}>${iconMarkup('ellipsis')}<span>${escapeHtml(i18n.t('nav.more'))}</span></button>`;
}

/** Desktop: the search launcher, a pill that reads like a field and opens Karta's search. Unused since the desk lost its second row (WP5 deletes it). */
export function searchLaunchMarkup(i18n: I18n, s: ShellState): string {
  return `<button type="button" class="ki-search" data-key="search" data-action="search" data-testid="status-search" aria-label="${escapeAttribute(i18n.t('transport.search'))}"${frozenAttrs(s)}>${iconMarkup('search', undefined, 'icon icon-sm')}<span>${escapeHtml(i18n.t('transport.search'))}</span></button>`;
}

/**
 * Unused since the desk header lost its clock [O-56] (WP5 deletes it with its CSS).
 * Desktop: the clock, wrapping the shared weather group (weather-status.ts) in
 * the link into Vrijeme. Without an observation the time stands alone: never a
 * dash (D11). The aria says time, condition, temperature, sunset, then the way.
 * Frozen it leaves the Tab order like the tabs and keeps its handler, so the
 * fragment (and `room=` in it) is never replaced by a bare hash navigation.
 */
export function clockMarkup(i18n: I18n, s: ShellState, now: number, weather: WeatherStatus | null): string {
  const time = zagrebTime(now);
  const label = weather ? i18n.t('shell.clockLabel', { time, weather: weather.aria }) : i18n.t('shell.clockOnly', { time });
  return `<a class="ki-clock tabular" data-key="clock" href="#layer=zrak-i-nebo" data-action="nav" data-layer="zrak-i-nebo" data-testid="status-clock" aria-label="${escapeAttribute(label)}"${frozenAttrs(s)}><time datetime="${new Date(now).toISOString()}">${escapeHtml(time)}</time>${weather ? `<span class="ki-weather">${weatherStatusMarkup(weather)}</span>` : ''}</a>`;
}

/** Desktop: the bell opens the notify sheet; its label counts the switches that are on, the dot shows any. */
export function bellMarkup(i18n: I18n, s: ShellState): string {
  const state = s.notifyActive > 0 ? i18n.t('kvart.notifyOn', { count: s.notifyActive }) : i18n.t('kvart.notifyOff');
  return `<button type="button" class="ki-bell btn-quiet icon-btn" data-key="bell" data-action="notify" data-testid="status-bell" data-active="${s.notifyActive}" aria-haspopup="dialog" aria-label="${escapeAttribute(i18n.t('notify.bellLabel', { state }))}">${iconMarkup('bell')}</button>`;
}

/** One-tap safety, icon-only on both surfaces: the word lives in the aria-label and the title. Frozen keeps /hitno open. */
export function safetyMarkup(i18n: I18n, s: ShellState): string {
  const current = s.layer === 'sigurnost' && !s.directory;
  return `<a class="ki-safety" data-key="safety" href="${s.frozen ? '/hitno' : '#layer=sigurnost'}"${s.frozen ? '' : ' data-action="nav"'} data-layer="sigurnost" data-testid="safety-shortcut" aria-label="${escapeAttribute(i18n.t('nav.safety'))}" title="${escapeAttribute(i18n.t('nav.safetyHint'))}" aria-current="${current ? 'page' : 'false'}">${iconMarkup('shield')}</a>`;
}

/** A phone tab; frozen it keeps its handler (navigate() declines) so its hash never replaces the fragment. */
function layerTab(i18n: I18n, s: ShellState, layer: LayerId): string {
  const current = s.layer === layer && !s.directory;
  if (s.frozen && layer === 'sigurnost') {
    return `<li><a class="ki-tab" href="/hitno" data-layer="sigurnost">${iconMarkup(LAYER_ICONS[layer])}<span class="ki-nav-label">${escapeHtml(layerLabel(i18n, layer))}</span></a></li>`;
  }
  return `<li><a class="ki-tab" href="#layer=${layer}" data-action="nav" data-layer="${layer}" aria-current="${current ? 'page' : 'false'}"${frozenAttrs(s)}>${iconMarkup(LAYER_ICONS[layer])}<span class="ki-nav-label">${escapeHtml(layerLabel(i18n, layer))}</span></a></li>`;
}

/** The phone tab bar: Sada, Karta and Još, which names the open extra domain. Nothing at the desk. */
export function tabbarMarkup(i18n: I18n, s: ShellState): string {
  if (s.surface === 'desktop') return '';
  const inMore = MORE_LAYERS.includes(s.layer);
  const showsLayer = inMore && !s.directory;
  const moreCurrent = s.directory || inMore;
  const moreLabel = showsLayer ? layerLabel(i18n, s.layer) : i18n.t('nav.more');
  const tabs = PHONE_TABS.map((tab) => layerTab(i18n, s, tab.layer)).join('');
  return `<ul class="ki-tabs" role="list">${tabs}<li><button type="button" class="ki-tab" data-action="directory" data-testid="tab-more" aria-current="${moreCurrent ? 'page' : 'false'}" aria-expanded="${s.directory ? 'true' : 'false'}"${frozenAttrs(s)}>${iconMarkup(showsLayer ? LAYER_ICONS[s.layer] : 'ellipsis')}<span class="ki-nav-label">${escapeHtml(moreLabel)}</span></button></li></ul>`;
}

/**
 * "Na zaslon" (D5): the phone's one primary touch action, for a scanner with a
 * screen, on every place but Promet (whose detail head carries the ghost cast
 * button) and the directory. '' when hidden.
 */
export function fabMarkup(i18n: I18n, s: ShellState): string {
  // One stable header control on every workspace. Never cover city content.
  return '';
}

/**
 * The one session element, keyed into the status line on both surfaces: a
 * compact pill with the ring and the remaining time. It carries the same
 * expiry the screen shows (data-expires-at) and opens the session sheet.
 */
export function sessionMarkup(i18n: I18n, s: ShellState): string {
  const time = remainingText(s.secondsLeft);
  // The screen's label, kept across a reload (entries/dashboard.ts, T5); without one the
  // screen's stop names it, and "zaslon" is left only for a screen with neither.
  const screen = s.label ?? s.stopName ?? i18n.t('session.labelScreen');
  const sentence = s.frozen
    ? i18n.t('session.expiredTitle')
    : s.phase === 'live' && s.expiresAt !== null
      ? i18n.t('session.unlocked', { label: screen, time: zagrebTime(s.expiresAt) })
      : s.reconnecting
        ? i18n.t('session.disconnected')
        : i18n.t('session.connecting');
  const timeText = s.frozen ? i18n.t('session.frozenBadge') : s.countdownHidden ? i18n.t('shell.session') : s.phase === 'live' ? time : '';
  const state = s.frozen ? 'frozen' : s.reconnecting ? 'reconnecting' : s.phase;
  const expires = s.expiresAt !== null ? ` data-expires-at="${s.expiresAt}"` : '';
  // Amber at the last minute, rose at the last twenty seconds: the CSS recolours the pill and its ring.
  const urgency = s.frozen || s.phase !== 'live' ? 'none' : s.secondsLeft <= 20 ? 'alert' : s.secondsLeft <= 60 ? 'warn' : 'none';
  const label = s.frozen
    ? i18n.t('session.expiredTitle')
    : s.expiresAt !== null && s.phase === 'live'
      ? i18n.t('session.pillLabel', { time: zagrebTime(s.expiresAt) })
      : i18n.t('session.connecting');
  return `<button type="button" class="ki-session" data-key="session" data-action="session" data-testid="session-label" data-state="${state}" data-urgency="${urgency}"${expires} title="${escapeAttribute(label)}" aria-label="${escapeAttribute(label)}">${sessionRing(s)}<span class="ki-session-text"><span class="ki-session-sentence">${escapeHtml(sentence)}</span><span class="ki-session-time tabular" data-testid="countdown"${timeText ? '' : ' hidden'}>${escapeHtml(timeText)}</span></span>${iconMarkup('chevron-right', undefined, 'icon ki-session-more')}</button>`;
}

/**
 * Session-state banners, all in flow: expired (with the way to a new session),
 * no ticket, access, reconnecting, then the one notice, the silent-sources
 * count and paused. Nothing here overlays the workspace.
 */
export function bannersMarkup(i18n: I18n, s: ShellState, scanUrl: string): string {
  const out: string[] = [];
  if (s.frozen) {
    // The closing card, the one banner left after the end. A room closed under a live session
    // (the screen switched off, error 'revoked') is told apart from the natural expiry by its
    // title and its way out; the hint holds for both, since the view and the exports stay.
    const revoked = s.error === 'revoked';
    out.push(`<div class="banner banner-frozen closing" role="alert" data-testid="frozen-line" data-key="frozen"><p class="closing-title">${escapeHtml(i18n.t(revoked ? 'session.revoked' : 'session.expired'))}</p><p class="banner-sub">${escapeHtml(i18n.t('session.expiredHint'))}</p><a class="btn btn-primary" href="${escapeAttribute(scanUrl)}">${iconMarkup('qr-code')}<span>${escapeHtml(i18n.t(revoked ? 'session.revokedCta' : 'session.expiredCta'))}</span></a></div>`);
  } else if (s.error === 'no-ticket') {
    out.push(`<div class="banner banner-warn" role="alert" data-key="no-ticket"><p class="banner-text">${escapeHtml(i18n.t('session.noTicket'))}</p><a class="btn" href="${escapeAttribute(scanUrl)}">${escapeHtml(i18n.t('common.links.scan'))}</a></div>`);
  } else if (s.error === 'access') {
    out.push(`<div class="banner banner-warn" role="alert" data-key="access" data-testid="access-banner"><p class="banner-text">${escapeHtml(i18n.t('session.accessDenied'))}</p><a class="btn" href="/">${escapeHtml(i18n.t('common.links.home'))}</a></div>`);
  } else if (s.reconnecting) {
    // The visible line says what matters to the person (the clock runs on the server offset); the
    // hidden sentence in the pill keeps session.disconnected for readers.
    out.push(`<div class="banner banner-warn" role="status" data-key="reconnecting" data-testid="reconnecting">${iconMarkup('refresh-cw')}<p class="banner-text">${escapeHtml(i18n.t('session.reconnectingVisible'))}</p></div>`);
  }
  if (s.notice && !s.frozen) {
    out.push(`<div class="banner banner-notice" data-key="notice" data-kind="${s.notice.kind}" data-testid="notice"><p class="banner-text">${escapeHtml(s.notice.text)}</p><button type="button" class="btn-quiet icon-btn banner-dismiss" data-action="dismiss-notice" aria-label="${escapeAttribute(i18n.t('common.dismiss'))}">${iconMarkup('x')}</button></div>`);
  }
  if (s.sourcesDown > 0 && !s.frozen) {
    out.push(`<div class="banner banner-quiet" role="status" data-key="sources" data-testid="sources-down"><p class="banner-text">${escapeHtml(i18n.t('shell.sourcesDown', { count: s.sourcesDown }))}</p></div>`);
  }
  if (s.paused && !s.frozen) {
    const time = s.lastRefresh !== null ? zagrebTime(s.lastRefresh) : '';
    out.push(`<div class="banner banner-quiet" role="status" data-key="paused" data-testid="paused-banner"><p class="banner-text">${escapeHtml(i18n.t('shell.paused', { time }))}</p><button type="button" class="btn-ghost" data-action="resume">${iconMarkup('play')}<span>${escapeHtml(i18n.t('session.resumeRefresh'))}</span></button></div>`);
  }
  return out.join('');
}
