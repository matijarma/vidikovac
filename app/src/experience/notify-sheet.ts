// The bell sheet (plan B.5, D7): the kvart alert switches as "istakni"
// highlights, never a push -- toggling one only lifts a matching tile's
// state in this browser, said once in the note under the rows.
import type { NotifyFlags, NotifyKey } from '../core/notify-store';
import type { I18n } from '../i18n/i18n';
import { createDialog, type DialogHandle } from '../ui/dialog';
import { createElementFromHTML, escapeHtml } from '../ui/dom/escape';
import { reconcileChildren } from '../ui/dom/reconcile';

export interface NotifySheetState {
  flags: NotifyFlags;
  /** The switches shown, flag-gated (`waste` only under FLAGS.FEED_WASTE). */
  keys: readonly NotifyKey[];
}

export interface NotifySheetDeps {
  i18n: I18n;
  state: () => NotifySheetState;
  onToggle: (key: NotifyKey) => void;
}

export interface NotifySheet {
  open(): void;
  close(): void;
  /** Reconciles the body against the current state, like the session sheet: a toggled row keeps its focus. */
  refresh(): void;
  isOpen(): boolean;
  destroy(): void;
}

/** One 44 px switch row (`role=switch`, never a checkbox: nothing here is a form). */
function rowMarkup(i18n: I18n, key: NotifyKey, on: boolean): string {
  return `<button type="button" class="nt-row" role="switch" aria-checked="${on ? 'true' : 'false'}" data-key="${key}" data-sheet-action="notify-toggle" data-testid="notify-${key}"><span class="nt-text">${escapeHtml(i18n.t(`notify.${key}`))}</span><span class="nt-knob" aria-hidden="true"></span></button>`;
}

function bodyMarkup(i18n: I18n, s: NotifySheetState): string {
  const rows = s.keys.map((key) => rowMarkup(i18n, key, s.flags[key])).join('');
  return `<div class="sheet-sec nt-list" role="group" data-key="list">${rows}</div><p class="nt-note sheet-label" data-key="note">${escapeHtml(i18n.t('notify.note'))}</p>`;
}

export function createNotifySheet(deps: NotifySheetDeps): NotifySheet {
  const { i18n } = deps;
  let dialog: DialogHandle | null = null;
  const ensure = (): DialogHandle => {
    if (dialog) return dialog;
    dialog = createDialog({ titleId: 'notify-sheet-title', title: i18n.t('notify.title'), closeLabel: i18n.t('common.close'), className: 'dialog-notify dialog-sheet' });
    dialog.element.dataset.testid = 'notify-sheet';
    // The dialog lives in the top layer outside the shell root, so its switches are handled here.
    dialog.body.addEventListener('click', (event) => {
      const row = (event.target as Element | null)?.closest<HTMLElement>('[data-sheet-action=notify-toggle]');
      if (!row?.dataset.key) return;
      deps.onToggle(row.dataset.key as NotifyKey);
      refresh();
    });
    return dialog;
  };
  const refresh = (): void => {
    if (!dialog) return;
    const titleEl = dialog.element.querySelector<HTMLElement>('.dialog-title');
    if (titleEl) titleEl.textContent = i18n.t('notify.title');
    reconcileChildren(dialog.body, createElementFromHTML(`<div>${bodyMarkup(i18n, deps.state())}</div>`));
  };
  return {
    open() {
      const handle = ensure();
      refresh();
      handle.open();
    },
    close() { dialog?.close(); },
    refresh,
    isOpen: () => dialog?.isOpen() ?? false,
    destroy() {
      dialog?.destroy();
      dialog = null;
    },
  };
}
