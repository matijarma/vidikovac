// The session and settings sheet: expiry, screen, share, refresh, countdown,
// language, theme and the open pages. One dialog per dashboard, rebuilt on
// each open; `refresh()` updates the live time while it is open.
import type { ScreenMetadata } from '../../../worker/protocol';
import { zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import { LOCALE_LABELS, SUPPORTED_LOCALES } from '../i18n/create-default-i18n';
import type { SessionSnapshot } from '../session';
import { createDialog, type DialogHandle } from '../ui/dialog';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import { THEME_PREFERENCES, type ThemePreference } from '../ui/theme';

export type SheetAction = 'share-city' | 'pause' | 'resume' | 'hide-countdown' | 'show-countdown' | 'refresh' | 'lang' | 'theme';

export interface SheetState {
  session: SessionSnapshot;
  frozen: boolean;
  paused: boolean;
  countdownHidden: boolean;
  canShare: boolean;
  label: string | null;
  themePreference: ThemePreference | null;
  lastRefresh: number | null;
}

export interface SessionSheetDeps {
  i18n: I18n;
  state: () => SheetState;
  onAction: (action: SheetAction, value?: string) => void;
  scanUrl?: string;
}

export interface SessionSheet {
  open(): void;
  close(): void;
  refresh(): void;
  isOpen(): boolean;
  destroy(): void;
}

function screenLine(i18n: I18n, screen: ScreenMetadata | undefined, label: string | null): string {
  const parts: string[] = [];
  if (label) parts.push(`<p class="sheet-row"><span class="sheet-k">${escapeHtml(i18n.t('session.screenLabel'))}</span><span class="sheet-v">${escapeHtml(label)}</span></p>`);
  if (screen?.stop) parts.push(`<p class="sheet-row"><span class="sheet-k">${escapeHtml(i18n.t('session.stopLabel'))}</span><span class="sheet-v">${escapeHtml(screen.stop.name)}</span></p>`);
  if (screen?.kind === 'temporary' && screen.expiresAt) parts.push(`<p class="sheet-row meta">${escapeHtml(i18n.t('session.screenTemporary'))} · ${escapeHtml(i18n.t('session.screenExpires', { time: zagrebTime(screen.expiresAt) }))}</p>`);
  return parts.join('');
}

function toggleRow(action: SheetAction, label: string, pressed: boolean, icon: 'pause' | 'play' | 'eye' | 'eye-off' | 'share-2' | 'refresh-cw', testid: string): string {
  return `<button type="button" class="btn-ghost sheet-btn" data-sheet-action="${action}" data-testid="${testid}" aria-pressed="${pressed ? 'true' : 'false'}">${iconMarkup(icon)}<span>${escapeHtml(label)}</span></button>`;
}

function segmented(name: string, options: { value: string; label: string; lang?: string }[], current: string | null, action: SheetAction): string {
  return `<div class="segmented" role="group" aria-label="${escapeAttribute(name)}">${options
    .map((o) => `<button type="button" class="segment" data-sheet-action="${action}" data-value="${escapeAttribute(o.value)}" aria-pressed="${o.value === current ? 'true' : 'false'}"${o.lang ? ` lang="${escapeAttribute(o.lang)}"` : ''}>${escapeHtml(o.label)}</button>`)
    .join('')}</div>`;
}
export function createSessionSheet(deps: SessionSheetDeps): SessionSheet {
  const { i18n } = deps;
  const scanUrl = deps.scanUrl ?? '/s/';
  let dialog: DialogHandle | null = null;

  function timeText(s: SheetState): string {
    if (s.frozen) return i18n.t('session.expiredTitle');
    if (s.session.phase !== 'live') return i18n.t('session.connecting');
    return i18n.t('shell.remaining', { time: `${Math.floor(s.session.secondsLeft / 60)}:${String(s.session.secondsLeft % 60).padStart(2, '0')}` });
  }

  function bodyMarkup(): string {
    const s = deps.state();
    const live = s.session.phase === 'live' && !s.frozen;
    const facts = [
      s.session.expiresAt !== null ? i18n.t('session.endsAt', { time: zagrebTime(s.session.expiresAt) }) : '',
      s.session.participants > 0 ? i18n.t('session.participants', { count: s.session.participants }) : '',
      s.session.role ? i18n.t(`session.role.${s.session.role}`) : '',
    ].filter(Boolean);
    const actions = [
      s.canShare && live ? toggleRow('share-city', i18n.t('session.share'), false, 'share-2', 'share-city') : '',
      !s.frozen ? toggleRow(s.paused ? 'resume' : 'pause', i18n.t(s.paused ? 'session.resumeRefresh' : 'session.pauseRefresh'), s.paused, s.paused ? 'play' : 'pause', 'toggle-refresh') : '',
      !s.frozen ? toggleRow(s.countdownHidden ? 'show-countdown' : 'hide-countdown', i18n.t(s.countdownHidden ? 'session.showCountdown' : 'session.hideCountdown'), s.countdownHidden, s.countdownHidden ? 'eye' : 'eye-off', 'toggle-countdown') : '',
      live && !s.paused ? toggleRow('refresh', i18n.t('session.refreshNow'), false, 'refresh-cw', 'refresh-now') : '',
    ].filter(Boolean);
    const langs = SUPPORTED_LOCALES.map((code) => ({ value: code, label: LOCALE_LABELS[code], lang: code }));
    const themes = THEME_PREFERENCES.map((pref) => ({ value: pref, label: i18n.t(`common.theme.${pref}`) }));
    const links: [string, string][] = [
      ['/hitno', i18n.t('common.links.hitno')], [scanUrl, i18n.t('common.links.scan')], ['/izvori/', i18n.t('common.links.izvori')],
      ['/privatnost/', i18n.t('common.links.privatnost')], ['/pristupacnost/', i18n.t('common.links.pristupacnost')],
    ];
    return `<section class="sheet-sec" aria-label="${escapeAttribute(i18n.t('session.statusLabel'))}">
<p class="kicker">${escapeHtml(i18n.t('session.statusLabel'))}</p>
<p class="sheet-time tabular" data-sheet-time data-testid="sheet-time">${escapeHtml(timeText(s))}</p>
${facts.length ? `<p class="sheet-row">${facts.map(escapeHtml).join(' · ')}</p>` : ''}
${screenLine(i18n, s.session.screen, s.label)}
${s.frozen ? `<p class="sheet-row">${escapeHtml(i18n.t('session.expiredHint'))}</p><a class="btn btn-primary" href="${escapeAttribute(scanUrl)}">${escapeHtml(i18n.t('session.expiredCta'))}</a>` : ''}
${s.lastRefresh !== null ? `<p class="sheet-row meta">${escapeHtml(i18n.t('session.lastRefresh', { time: zagrebTime(s.lastRefresh) }))}</p>` : ''}
</section>
${actions.length ? `<section class="sheet-sec sheet-actions">${actions.join('')}${s.canShare && live ? `<p class="meta">${escapeHtml(i18n.t('session.shareHint'))}</p>` : ''}</section>` : ''}
<section class="sheet-sec"><p class="kicker" id="sheet-lang">${escapeHtml(i18n.t('common.language'))}</p>${segmented(i18n.t('common.language'), langs, i18n.getLocale(), 'lang')}</section>
${s.themePreference ? `<section class="sheet-sec"><p class="kicker">${escapeHtml(i18n.t('common.theme.label'))}</p>${segmented(i18n.t('common.theme.label'), themes, s.themePreference, 'theme')}</section>` : ''}
<nav class="sheet-links" aria-label="${escapeAttribute(i18n.t('directory.pages'))}">${links.map(([href, label]) => `<a href="${escapeAttribute(href)}">${escapeHtml(label)}</a>`).join('')}</nav>`;
  }

  function render(): void {
    if (!dialog) return;
    dialog.body.innerHTML = bodyMarkup();
    const title = dialog.element.querySelector('.dialog-title');
    if (title) title.textContent = i18n.t('session.sheetTitle');
  }

  function handleClick(event: Event): void {
    const target = (event.target as Element).closest<HTMLElement>('[data-sheet-action]');
    if (!target) return;
    deps.onAction(target.dataset.sheetAction as SheetAction, target.dataset.value);
    render();
  }

  return {
    open() {
      if (!dialog) {
        dialog = createDialog({ titleId: 'session-sheet-title', title: i18n.t('session.sheetTitle'), closeLabel: i18n.t('common.close'), className: 'dialog-session' });
        dialog.element.dataset.testid = 'session-sheet';
        dialog.body.addEventListener('click', handleClick);
      }
      render();
      dialog.open();
    },
    close() { dialog?.close(); },
    refresh() {
      if (!dialog?.isOpen()) return;
      const node = dialog.body.querySelector('[data-sheet-time]');
      if (node) node.textContent = timeText(deps.state());
    },
    isOpen: () => dialog?.isOpen() ?? false,
    destroy() { dialog?.destroy(); dialog = null; },
  };
}
