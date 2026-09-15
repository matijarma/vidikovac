// The bell sheet (plan B.5, D7): the kvart alert switches as "istakni"
// highlights, never a push. This file is the T2.6 signature stub the
// dashboard wires to (open, close, refresh, destroy, and the toggle
// delegation into the store); T2.7 fills the switch rows and the note, and
// tests them in notify-sheet.test.ts.
import type { NotifyFlags, NotifyKey } from '../core/notify-store';
import type { I18n } from '../i18n/i18n';
import { createDialog, type DialogHandle } from '../ui/dialog';
import { createElementFromHTML } from '../ui/dom/escape';
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

function bodyMarkup(): string {
  return `<div class="sheet-sec nt-list" role="group" data-key="list"></div>`;
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
    reconcileChildren(dialog.body, createElementFromHTML(`<div>${bodyMarkup()}</div>`));
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
