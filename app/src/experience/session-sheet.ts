// The session sheet, in plain words: "Otključano do 13:57" as its title, the
// remaining time at display size, one sentence for where the session came from
// and one for how many devices share it, then what can be done with this
// session: share the city and refresh now, as 48 px action rows. Nothing here
// is a setting: every personal setting is a row of Još under "Osobne postavke"
// (experience/directory.ts), and Još also lists the four pages. A bottom sheet
// on the phone, a centred dialog on the desk (dialog.css, .dialog-sheet). One
// dialog per dashboard; the body is reconciled on every render, never rebuilt,
// so a pressed row keeps its focus and the body its scroll; `refresh()` updates
// the live time.
import { zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import type { SessionSnapshot } from '../session';
import { createDialog, type DialogHandle } from '../ui/dialog';
import { createElementFromHTML, escapeHtml } from '../ui/dom/escape';
import { reconcileChildren } from '../ui/dom/reconcile';
import { iconMarkup, type IconName } from '../ui/icons';
import { dayLabel } from './text';
import { originSentence } from './session-origin';
export { originSentence, type SessionOrigin } from './session-origin';

export type SheetAction = 'share-city' | 'refresh';

export interface SheetState {
  session: SessionSnapshot;
  frozen: boolean;
  /** Refreshing paused from Još: "Osvježi sada" then waits for the refresh to be switched on again. */
  paused: boolean;
  canShare: boolean;
  label: string | null;
}

export interface SessionSheetDeps {
  i18n: I18n;
  state: () => SheetState;
  onAction: (action: SheetAction) => void;
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

function actionRow(key: string, action: SheetAction, icon: IconName, label: string, testid: string, sub?: string): string {
  // The space between the two spans keeps the label and its sub-line two words apart in textContent.
  const text = `<span class="sheet-btn-label">${escapeHtml(label)}</span>${sub ? ` <span class="sheet-btn-sub">${escapeHtml(sub)}</span>` : ''}`;
  return `<button type="button" class="sheet-btn" data-key="${key}" data-sheet-action="${action}" data-testid="${testid}">${iconMarkup(icon)}<span class="sheet-btn-text">${text}</span></button>`;
}

export function createSessionSheet(deps: SessionSheetDeps): SessionSheet {
  const { i18n } = deps;
  const now = deps.now ?? (() => Date.now());
  let dialog: DialogHandle | null = null;

  // The end of the session is known from the join on and stands while the socket reconnects (the
  // countdown goes on, the banner says so), so the title and the remaining time follow `expiresAt`,
  // not the socket's phase; before the join there is nothing to count and the title says so once.
  function titleText(s: SheetState): string {
    if (s.frozen) return i18n.t('session.expiredTitle');
    if (s.session.expiresAt !== null) return i18n.t('session.sheetTitle', { time: zagrebTime(s.session.expiresAt) });
    return i18n.t('session.connecting');
  }

  function timeText(s: SheetState): string {
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
      ['origin', originSentence(i18n, { role: s.session.role, label: s.label, stop: screen?.stop?.name ?? null })],
      // The count is news once a second device is in the view (a shared code taken up); "1 uređaju" told the
      // person what they held in their hand (round 3, desktop F17).
      ['devices', live && s.session.participants > 1 ? i18n.t('session.sheetDevices', { count: s.session.participants }) : ''],
      ['temporary', temporary],
      ['hint', s.frozen ? i18n.t('session.expiredHint') : ''],
    ];
    const actions = [
      s.canShare && live ? actionRow('share', 'share-city', 'share-2', i18n.t('session.share'), 'share-city-sheet', i18n.t('session.shareHint')) : '',
      live && !s.paused ? actionRow('refresh-now', 'refresh', 'refresh-cw', i18n.t('session.refreshNow'), 'refresh-now') : '',
    ].filter(Boolean);
    // No whitespace between siblings: every child is a keyed element the reconciler matches by key.
    return [
      `<div class="sheet-sec sheet-status" data-key="status">${!s.frozen && s.session.expiresAt !== null ? `<p class="sheet-time tabular" data-key="time" data-sheet-time data-testid="sheet-time">${escapeHtml(timeText(s))}</p>` : ''}${lines
        .filter(([, sentence]) => sentence !== '')
        .map(([key, sentence]) => `<p class="sheet-line" data-key="${key}">${escapeHtml(sentence)}</p>`)
        .join('')}</div>`,
      actions.length ? `<div class="sheet-sec sheet-actions" data-key="actions">${actions.join('')}</div>` : '',
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
    deps.onAction(target.dataset.sheetAction as SheetAction);
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
