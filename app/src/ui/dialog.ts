// ONE modal primitive, wrapping the native <dialog> element — replaces v1's
// 4 bespoke modals (pairing/welcome/console/confirm all had their own
// hand-rolled overlay + focus-trap code). `showModal()` gives us, for free:
//   - a real focus trap (Tab/Shift+Tab can't leave the top-layer dialog)
//   - Escape-to-close (fires 'cancel' then 'close' unless prevented)
//   - a ::backdrop we style via CSS, no manual scrim element
// so this wrapper's only real job is: mount/open/close lifecycle, restoring
// focus to whatever triggered `open()`, and `aria-labelledby` wiring.
import { escapeAttribute, escapeHtml, createElementFromHTML } from './dom/escape';
import { iconMarkup } from './icons';

export interface DialogOptions {
  /** id assigned to the heading; wired to `aria-labelledby` automatically. */
  titleId: string;
  /** Localized dialog title. */
  title: string;
  /** Localized aria-label for the close (X) button. */
  closeLabel: string;
  /** Body content. Prefer a real Node (built with textContent/DOM APIs — no
   * escaping to think about); a string is inserted via innerHTML as-is, so
   * the CALLER must have already escaped any interpolated values. */
  body?: Node | string;
  /** Extra class(es) appended to the root `.dialog` element. */
  className?: string;
  /**
   * Action row, PINNED below the scrolling body.
   *
   * Without this every caller put its buttons at the end of the body, which is
   * the scroll container — so on a phone, and in the extension popup, the
   * confirm button sat below the fold and pairing became "scroll down to
   * finish". `position: sticky` cannot fix that from inside: the buttons are
   * the last child, so there is no room left to stick to.
   *
   * `.dialog` is already `display:flex; flex-direction:column`, so a third
   * flex child pins to the bottom with no other layout change.
   */
  footer?: Node | string;
}

export interface DialogHandle {
  readonly element: HTMLDialogElement;
  /** The scrolling content region. Exposed because every consumer was digging
   *  it out with `querySelector('.dialog-body')` anyway. */
  readonly body: HTMLElement;
  /** The pinned action row, present only when `footer` was supplied. */
  readonly footer: HTMLElement | null;
  /** Remembers the current `document.activeElement` as the opener, then `showModal()`s. */
  open(): void;
  /** No-op if already closed. */
  close(returnValue?: string): void;
  isOpen(): boolean;
  /** Detaches listeners and removes the element from the DOM. */
  destroy(): void;
}

// Open modal dialogs, in the order `showModal()` was called — which IS top-layer
// order, so the last entry is the one painted on top and the one a dismiss
// gesture should close.
//
// Tracked here rather than derived from `document.querySelectorAll('dialog[open]')`
// because that returns DOM order, which says nothing about which dialog is on
// top once two are open. Module-level state is safe: it holds only dialogs that
// are currently open, `close` always removes (the listener is attached for the
// dialog's whole life, and `destroy()` fires nothing, so `destroy()` prunes too).
const openDialogs: HTMLDialogElement[] = [];

function forget(dialog: HTMLDialogElement): void {
  const at = openDialogs.indexOf(dialog);
  if (at !== -1) openDialogs.splice(at, 1);
}

/**
 * Closes the topmost open modal dialog and reports whether there was one.
 *
 * Exists for platform dismiss gestures that the browser does not map to a
 * dialog by itself — specifically Android's system Back button, which a WebView
 * delivers to the app and not to the top layer. Escape and the close button are
 * unaffected and still go through the normal path.
 */
export function closeTopmostDialog(): boolean {
  // Pops past stale entries rather than trusting the top of the stack. A dialog
  // detached from the DOM without being closed (a container's innerHTML
  // replaced, say) never fires `close`, and one stale entry would otherwise
  // wedge every future dismiss: the gesture would report "handled" forever while
  // closing nothing.
  while (openDialogs.length > 0) {
    const top = openDialogs.pop()!;
    if (top.open && top.isConnected) {
      top.close();
      return true;
    }
  }
  return false;
}

/** True when any modal dialog is open. */
export function hasOpenDialog(): boolean {
  return openDialogs.some((dialog) => dialog.open && dialog.isConnected);
}

export function createDialog(options: DialogOptions): DialogHandle {
  const classAttr = options.className ? ` ${options.className}` : '';
  const dialog = createElementFromHTML(
    `<dialog class="dialog${escapeAttribute(classAttr)}" tabindex="-1" aria-labelledby="${escapeAttribute(options.titleId)}">
      <header class="dialog-head">
        <h2 id="${escapeAttribute(options.titleId)}" class="dialog-title">${escapeHtml(options.title)}</h2>
        <button type="button" class="dialog-close" data-dialog-close aria-label="${escapeAttribute(options.closeLabel)}">
          ${iconMarkup('x')}
        </button>
      </header>
      <div class="dialog-body"></div>
      ${options.footer === undefined ? '' : '<footer class="dialog-foot"></footer>'}
    </dialog>`,
  ) as HTMLDialogElement;

  const bodySlot = dialog.querySelector('.dialog-body') as HTMLElement;
  if (options.body instanceof Node) {
    bodySlot.appendChild(options.body);
  } else if (typeof options.body === 'string') {
    bodySlot.innerHTML = options.body;
  }

  const footSlot = dialog.querySelector<HTMLElement>('.dialog-foot');
  if (footSlot) {
    if (options.footer instanceof Node) {
      footSlot.appendChild(options.footer);
    } else if (typeof options.footer === 'string') {
      footSlot.innerHTML = options.footer;
    }
  }

  let opener: HTMLElement | null = null;
  function viewportChanged(): void {
    const viewport=window.visualViewport;
    if(!viewport||!dialog.open)return;
    dialog.style.setProperty('--dialog-visible-height',`${viewport.height}px`);
    dialog.style.setProperty('--dialog-keyboard-inset',`${Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop)}px`);
  }
  window.visualViewport?.addEventListener('resize',viewportChanged);
  window.visualViewport?.addEventListener('scroll',viewportChanged);

  function handleCloseButtonClick(): void {
    dialog.close();
  }

  function handleClose(): void {
    forget(dialog);
    if (opener && document.contains(opener) && typeof opener.focus === 'function') {
      opener.focus();
    }
    opener = null;
  }

  // Native <dialog> has no built-in "click outside to close" — a click that
  // lands directly on the <dialog> element (not one of its children, i.e.
  // the ::backdrop area within the dialog's own box, or — in browsers that
  // paint the backdrop as a pseudo-element outside the padding box — a
  // click that bubbles to the dialog without hitting an inner element)
  // closes it, matching common modal UX.
  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === dialog) {
      dialog.close();
    }
  }

  dialog.querySelector('[data-dialog-close]')?.addEventListener('click', handleCloseButtonClick);
  dialog.addEventListener('close', handleClose);
  dialog.addEventListener('click', handleBackdropClick);

  // Real browsers move focus into an open modal <dialog> on their own (the
  // first `[autofocus]` element, else the first focusable descendant, else
  // the dialog itself) — done explicitly here too rather than relying on
  // that, since it's not universally implemented (notably not in happy-dom,
  // which this package's own tests run under) and explicit beats implicit
  // for something accessibility-load-bearing.
  function moveInitialFocus(): void {
    if (dialog.contains(document.activeElement)) {
      return; // the environment's own showModal() already placed focus inside
    }
    const autofocusTarget = dialog.querySelector<HTMLElement>('[autofocus]');
    const target = autofocusTarget ?? findFirstFocusable(dialog) ?? dialog;
    target.focus();
  }

  return {
    element: dialog,
    body: bodySlot,
    footer: footSlot,
    open() {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!dialog.isConnected) {
        document.body.appendChild(dialog);
      }
      if (!dialog.open) {
        dialog.showModal();
        viewportChanged();
        forget(dialog);
        openDialogs.push(dialog);
        moveInitialFocus();
      }
    },
    close(returnValue) {
      if (dialog.open) {
        dialog.close(returnValue);
      }
    },
    isOpen() {
      return dialog.open;
    },
    destroy() {
      window.visualViewport?.removeEventListener('resize',viewportChanged);
      window.visualViewport?.removeEventListener('scroll',viewportChanged);
      forget(dialog);
      dialog
        .querySelector('[data-dialog-close]')
        ?.removeEventListener('click', handleCloseButtonClick);
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('click', handleBackdropClick);
      dialog.remove();
    },
  };
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function findFirstFocusable(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
}
