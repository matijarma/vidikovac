// Transient notifications with a real queue: only `maxVisible` toasts show
// at once; extras wait and get promoted (FIFO) as visible ones dismiss
// (auto-timeout or manual). `role="alert"` for danger (assertive — the user
// needs to know now), `role="status"` for info/success (polite); the
// container itself is `aria-live="polite"` so screen readers announce each
// arrival without stealing focus.
import { escapeAttribute, escapeHtml, createElementFromHTML } from './dom/escape';
import { iconMarkup, type IconName } from './icons';

export type ToastVariant = 'info' | 'success' | 'danger';

export interface ToastOptions {
  /** Pre-localized message text. */
  message: string;
  variant?: ToastVariant;
  /** ms before auto-dismiss. `0` or `Infinity` disables auto-dismiss (manual only). Default 4000. */
  duration?: number;
  /** Localized aria-label for the dismiss (X) button. */
  dismissLabel: string;
}

export interface ToastHandle {
  readonly id: number;
  dismiss(): void;
}

export interface ToastQueueOptions {
  /** Element toasts are appended to. Defaults to a new `.toast-stack` appended to `document.body`. */
  container?: HTMLElement;
  /** Max toasts visible simultaneously; extras queue. Default 3. */
  maxVisible?: number;
  /** Default `duration` for toasts that don't specify one. Default 4000ms. */
  defaultDuration?: number;
}

export interface ToastQueue {
  readonly container: HTMLElement;
  push(options: ToastOptions): ToastHandle;
  dismiss(id: number): void;
  /** Dismisses every visible toast and drops anything still queued. */
  clear(): void;
  /** Visible + still-queued count. */
  readonly size: number;
}

const ICON_BY_VARIANT: Record<ToastVariant, IconName> = {
  info: 'info',
  success: 'check-circle',
  danger: 'alert-circle',
};

interface Entry {
  id: number;
  options: ToastOptions;
  element?: HTMLElement;
  timer?: ReturnType<typeof setTimeout>;
}

let uid = 0;

export function createToastQueue(options: ToastQueueOptions = {}): ToastQueue {
  const container = options.container ?? createDefaultContainer();
  const maxVisible = options.maxVisible ?? 3;
  const defaultDuration = options.defaultDuration ?? 4000;

  const pending: Entry[] = [];
  const visible = new Map<number, Entry>();

  function promote(): void {
    while (visible.size < maxVisible && pending.length > 0) {
      const entry = pending.shift();
      if (entry) {
        show(entry);
      }
    }
  }

  function show(entry: Entry): void {
    const element = renderToast(entry);
    entry.element = element;
    container.appendChild(element);
    visible.set(entry.id, entry);

    const duration = entry.options.duration ?? defaultDuration;
    if (Number.isFinite(duration) && duration > 0) {
      entry.timer = setTimeout(() => dismiss(entry.id), duration);
    }
  }

  function renderToast(entry: Entry): HTMLElement {
    const variant = entry.options.variant ?? 'info';
    const role = variant === 'danger' ? 'alert' : 'status';
    const element = createElementFromHTML(
      `<div class="toast toast-${escapeAttribute(variant)}" role="${role}" data-toast-id="${entry.id}">
        ${iconMarkup(ICON_BY_VARIANT[variant])}
        <p class="toast-message">${escapeHtml(entry.options.message)}</p>
        <button type="button" class="toast-dismiss" data-toast-dismiss aria-label="${escapeAttribute(entry.options.dismissLabel)}">
          ${iconMarkup('x')}
        </button>
      </div>`,
    );
    element
      .querySelector('[data-toast-dismiss]')
      ?.addEventListener('click', () => dismiss(entry.id));
    return element;
  }

  function dismiss(id: number): void {
    const visibleEntry = visible.get(id);
    if (visibleEntry) {
      if (visibleEntry.timer) {
        clearTimeout(visibleEntry.timer);
      }
      visibleEntry.element?.remove();
      visible.delete(id);
      promote();
      return;
    }
    const pendingIndex = pending.findIndex((entry) => entry.id === id);
    if (pendingIndex >= 0) {
      pending.splice(pendingIndex, 1);
    }
  }

  return {
    container,
    push(toastOptions) {
      const entry: Entry = { id: (uid += 1), options: toastOptions };
      pending.push(entry);
      promote();
      return {
        id: entry.id,
        dismiss: () => dismiss(entry.id),
      };
    },
    dismiss,
    clear() {
      // Clear `pending` FIRST — otherwise each `dismiss()` below calls
      // `promote()`, which would immediately backfill a freed slot from the
      // still-populated pending queue.
      pending.length = 0;
      for (const id of [...visible.keys()]) {
        dismiss(id);
      }
    },
    get size() {
      return visible.size + pending.length;
    },
  };
}

function createDefaultContainer(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'toast-stack';
  element.setAttribute('aria-live', 'polite');
  element.setAttribute('aria-atomic', 'false');
  document.body.appendChild(element);
  return element;
}
