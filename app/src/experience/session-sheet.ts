// The session sheet, in plain words: "Otključano do 13:57" as its title, the
// remaining time at display size, one sentence for where the session came from
// and one for how many devices share it, 48 px action rows, the language and
// theme controls and the four pages. A bottom sheet on the phone, a centred
// dialog on the desk (dialog.css, .dialog-sheet). One dialog per dashboard; the
// body is reconciled on every render, never rebuilt, so a pressed toggle keeps
// its focus and the body its scroll; `refresh()` updates the live time.
import { zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import { LOCALE_LABELS, SUPPORTED_LOCALES } from '../i18n/create-default-i18n';
import type { SessionSnapshot } from '../session';
import { createDialog, type DialogHandle } from '../ui/dialog';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { reconcileChildren } from '../ui/dom/reconcile';
import { iconMarkup, type IconName } from '../ui/icons';
import { THEME_PREFERENCES, type ThemePreference } from '../ui/theme';
import { dayLabel } from './text';

export type SheetAction = 'share-city' | 'pause' | 'resume' | 'hide-countdown' | 'show-countdown' | 'refresh' | 'lang' | 'theme';

export interface SheetState {
  session: SessionSnapshot;
  frozen: boolean;
  paused: boolean;
  countdownHidden: boolean;
  canShare: boolean;
  label: string | null;
  themePreference: ThemePreference | null;
}

export interface SessionSheetDeps {
  i18n: I18n;
  state: () => SheetState;
  onAction: (action: SheetAction, value?: string) => void;
  /** The shell's clock, so "sutra 13:47" is said against the same now as every other line. */
  now?: () => number;
}

export interface SessionSheet {
  open(): void;
  close(): void;
  refresh(): void;
  isOpen(): boolean;
  destroy(): void;
}

/** Where the session came from, as one sentence; a peer session says whose five minutes these are. */
function originSentence(i18n: I18n, s: SheetState): string {
  if (s.session.role === 'phone') return i18n.t('session.sheetPeer');
  const stop = s.session.screen?.stop?.name ?? null;
  if (s.label && stop) return i18n.t('session.sheetScreen', { label: s.label, stop });
  if (s.label) return i18n.t('session.sheetScreenOnly', { label: s.label });
  if (stop) return i18n.t('session.sheetStop', { stop });
  return '';
}

function actionRow(key: string, action: SheetAction, icon: IconName, label: string, testid: string, sub?: string): string {
  // The space between the two spans keeps the label and its sub-line two words apart in textContent.
  const text = `<span class="sheet-btn-label">${escapeHtml(label)}</span>${sub ? ` <span class="sheet-btn-sub">${escapeHtml(sub)}</span>` : ''}`;
  return `<button type="button" class="sheet-btn" data-key="${key}" data-sheet-action="${action}" data-testid="${testid}">${iconMarkup(icon)}<span class="sheet-btn-text">${text}</span></button>`;
}

function segmented(labelId: string, options: { value: string; label: string; lang?: string }[], current: string | null, action: SheetAction): string {
  return `<div class="segmented" role="group" aria-labelledby="${labelId}">${options
    .map((o) => `<button type="button" class="segment" data-key="${escapeAttribute(o.value)}" data-sheet-action="${action}" data-value="${escapeAttribute(o.value)}" aria-pressed="${o.value === current ? 'true' : 'false'}"${o.lang ? ` lang="${escapeAttribute(o.lang)}"` : ''}>${escapeHtml(o.label)}</button>`)
    .join('')}</div>`;
}

export function createSessionSheet(deps: SessionSheetDeps): SessionSheet {
  const { i18n } = deps;
  const now = deps.now ?? (() => Date.now());
  let dialog: DialogHandle | null = null;

  function titleText(s: SheetState): string {
    if (s.frozen) return i18n.t('session.expiredTitle');
    if (s.session.phase === 'live' && s.session.expiresAt !== null) return i18n.t('session.sheetTitle', { time: zagrebTime(s.session.expiresAt) });
    return i18n.t('session.connecting');
  }

  function timeText(s: SheetState): string {
    if (s.session.phase !== 'live') return i18n.t('session.connecting');
    return i18n.t('shell.remaining', { time: `${Math.floor(s.session.secondsLeft / 60)}:${String(s.session.secondsLeft % 60).padStart(2, '0')}` });
  }

  function bodyMarkup(s: SheetState): string {
    const live = s.session.phase === 'live' && !s.frozen;
    const screen = s.session.screen;
    const temporary = !s.frozen && screen?.kind === 'temporary' && screen.expiresAt !== null
      ? i18n.t('session.sheetTemporary', { when: `${dayLabel(i18n, screen.expiresAt, now())} ${zagrebTime(screen.expiresAt)}` })
      : '';
    // After the end the devices and the screen's own expiry are stale; the origin and the hint stand.
    const lines: [string, string][] = [
      ['origin', originSentence(i18n, s)],
      ['devices', live && s.session.participants > 0 ? i18n.t('session.sheetDevices', { count: s.session.participants }) : ''],
      ['temporary', temporary],
      ['hint', s.frozen ? i18n.t('session.expiredHint') : ''],
    ];
    const actions = [
      s.canShare && live ? actionRow('share', 'share-city', 'share-2', i18n.t('session.share'), 'share-city', i18n.t('session.shareHint')) : '',
      !s.frozen ? actionRow('refresh-toggle', s.paused ? 'resume' : 'pause', s.paused ? 'play' : 'pause', i18n.t(s.paused ? 'session.resumeRefresh' : 'session.pauseRefresh'), 'toggle-refresh') : '',
      !s.frozen ? actionRow('countdown', s.countdownHidden ? 'show-countdown' : 'hide-countdown', s.countdownHidden ? 'eye' : 'eye-off', i18n.t(s.countdownHidden ? 'session.showCountdown' : 'session.hideCountdown'), 'toggle-countdown') : '',
      live && !s.paused ? actionRow('refresh-now', 'refresh', 'refresh-cw', i18n.t('session.refreshNow'), 'refresh-now') : '',
    ].filter(Boolean);
    const langs = SUPPORTED_LOCALES.map((code) => ({ value: code, label: LOCALE_LABELS[code], lang: code }));
    const themes = THEME_PREFERENCES.map((pref) => ({ value: pref, label: i18n.t(`common.theme.${pref}`) }));
    const links: [string, string][] = [
      ['/hitno', i18n.t('common.links.hitno')], ['/izvori/', i18n.t('common.links.izvori')],
      ['/privatnost/', i18n.t('common.links.privatnost')], ['/pristupacnost/', i18n.t('common.links.pristupacnost')],
    ];
    // No whitespace between siblings: every child is a keyed element the reconciler matches by key.
    return [
      `<div class="sheet-sec sheet-status" data-key="status">${s.frozen ? '' : `<p class="sheet-time tabular" data-key="time" data-sheet-time data-testid="sheet-time">${escapeHtml(timeText(s))}</p>`}${lines
        .filter(([, sentence]) => sentence !== '')
        .map(([key, sentence]) => `<p class="sheet-line" data-key="${key}">${escapeHtml(sentence)}</p>`)
        .join('')}</div>`,
      actions.length ? `<div class="sheet-sec sheet-actions" data-key="actions">${actions.join('')}</div>` : '',
      `<div class="sheet-sec" data-key="lang"><p class="sheet-label" id="sheet-lang">${escapeHtml(i18n.t('common.language'))}</p>${segmented('sheet-lang', langs, i18n.getLocale(), 'lang')}</div>`,
      s.themePreference ? `<div class="sheet-sec" data-key="theme"><p class="sheet-label" id="sheet-theme">${escapeHtml(i18n.t('common.theme.label'))}</p>${segmented('sheet-theme', themes, s.themePreference, 'theme')}</div>` : '',
      `<nav class="sheet-links" data-key="links" aria-label="${escapeAttribute(i18n.t('directory.pages'))}">${links.map(([href, label]) => `<a href="${escapeAttribute(href)}">${escapeHtml(label)}</a>`).join('')}</nav>`,
    ].join('');
  }

  function render(): void {
    if (!dialog) return;
    const s = deps.state();
    reconcileChildren(dialog.body, createElementFromHTML(`<div>${bodyMarkup(s)}</div>`));
    const title = dialog.element.querySelector('.dialog-title');
    if (title) title.textContent = titleText(s);
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
        dialog = createDialog({ titleId: 'session-sheet-title', title: titleText(deps.state()), closeLabel: i18n.t('common.close'), className: 'dialog-session dialog-sheet' });
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
