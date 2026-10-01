// A session-sheet request does not make Karta load the sheet's renderer on its first paint.
import { createDialog, type DialogHandle } from '../ui/dialog';
import type { SessionSheet, SessionSheetDeps } from './session-sheet';

type Renderer = Pick<typeof import('./session-sheet'), 'createSessionSheet'>;
export type SessionSheetLoader = () => Renderer | Promise<Renderer>;

export function createLazySessionSheet(
  deps: SessionSheetDeps,
  load: SessionSheetLoader = () => import('./session-sheet'),
): SessionSheet {
  let renderer: Renderer | null = null;
  let sheet: SessionSheet | null = null;
  let pending: Promise<void> | null = null;
  let placeholder: DialogHandle | null = null;
  let opener: HTMLElement | null = null;
  let disposed = false;
  const clearPlaceholder = (): void => {
    placeholder?.close();
    placeholder?.destroy();
    placeholder = null;
  };
  const show = (): void => {
    clearPlaceholder();
    if (opener?.isConnected) opener.focus();
    sheet ??= renderer!.createSessionSheet(deps);
    sheet.open();
  };
  const failed = (): void => {
    pending = null;
    if (disposed || !placeholder?.isOpen()) return;
    placeholder.element.querySelector('.dialog-title')!.textContent = deps.i18n.t('common.unavailable');
  };
  const ready = (loaded: Renderer): void => {
    pending = null;
    if (disposed) return;
    renderer = loaded;
    // Escape, close, session expiry or disposal while loading must not resurrect the sheet.
    if (placeholder?.isOpen()) show();
  };
  return {
    open() {
      if (disposed) return;
      if (sheet) { sheet.open(); return; }
      if (!placeholder?.isOpen()) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (renderer) { show(); return; }
      placeholder ??= createDialog({
        titleId: 'session-loading-title', title: deps.i18n.t('status.loading'),
        closeLabel: deps.i18n.t('common.close'), className: 'dialog-session dialog-sheet',
      });
      placeholder.element.dataset.testid = 'session-sheet-loading';
      placeholder.element.querySelector('.dialog-title')!.textContent = deps.i18n.t('status.loading');
      if (!placeholder.isOpen()) placeholder.open();
      if (pending) return;
      try {
        const result = load();
        if ('then' in result) pending = Promise.resolve(result).then(ready).catch(failed);
        else ready(result);
      } catch { failed(); }
    },
    close() { placeholder?.close(); sheet?.close(); },
    refresh() { sheet?.refresh(); },
    isOpen: () => Boolean(placeholder?.isOpen() || sheet?.isOpen()),
    destroy() {
      disposed = true;
      clearPlaceholder();
      sheet?.destroy();
      sheet = null;
      renderer = null;
      opener = null;
    },
  };
}
