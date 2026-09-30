// DEV mode's chip on a scripted page: shared/dev-chip.ts draws it, this mounts it (worker/routes/dev.ts
// describes DEV). Loaded only in DEV, as its own chunk, so no ordinary page carries it. The chip
// opens its menu by itself (a <details>); the script adds the ×'s clean exit, Telefon's phone-sized
// window at a desk, and Escape or a press elsewhere to close the menu.
import { DEV_CHIP_CSS, devChipMarkup, type DevLabels, type DevSurface } from '../../../shared/dev-chip';
import { turnDevOff, withoutDevFlag } from '../core/dev-mode';
import type { I18n } from '../i18n/i18n';

export function devLabels(i18n: I18n): DevLabels {
  return {
    chip: i18n.t('dev.chip'),
    menu: i18n.t('dev.menu'),
    off: i18n.t('dev.off'),
    screen: i18n.t('dev.screen'),
    phone: i18n.t('dev.phone'),
    desktop: i18n.t('dev.desktop'),
    hitno: i18n.t('dev.hitno'),
    all: i18n.t('dev.all'),
  };
}

export interface DevChipOptions {
  i18n: I18n;
  /** The surface this page is, marked in the menu. */
  current: DevSurface | null;
  doc?: Document;
  /** Where the × goes; by default this page without the flag and without its fragment (a DEV room's id lives there). */
  offHref?: string;
}

export interface DevChipHandle {
  element: HTMLElement;
  destroy(): void;
}

function storage(read: () => Storage): Storage | null {
  try { return read(); } catch { return null; }
}

export function mountDevChip(options: DevChipOptions): DevChipHandle {
  const doc = options.doc ?? document;
  const win = doc.defaultView ?? window;
  if (!doc.getElementById('dev-chip-style')) {
    const style = doc.createElement('style');
    style.id = 'dev-chip-style';
    style.textContent = DEV_CHIP_CSS;
    doc.head.appendChild(style);
  }
  const offHref = options.offHref ?? withoutDevFlag(`${win.location.pathname}${win.location.search}`);
  const host = doc.createElement('div');
  host.innerHTML = devChipMarkup(devLabels(options.i18n), { current: options.current, offHref });
  const element = host.firstElementChild as HTMLElement;
  doc.body.prepend(element);
  const details = element.querySelector<HTMLDetailsElement>('details')!;
  const summary = element.querySelector<HTMLElement>('summary')!;

  const onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-testid=dev-off]')) {
      event.preventDefault();
      turnDevOff(storage(() => win.sessionStorage), storage(() => win.localStorage));
      win.location.replace(offHref);
      return;
    }
    // Telefon at a desk: /d/ in a window the size of a phone, so the phone's layout shows. A
    // blocked window, or a narrow screen, follows the link instead.
    const link = target?.closest<HTMLAnchorElement>('a[data-dev-window]');
    if (!link || !win.matchMedia?.('(min-width: 60rem)').matches) return;
    const [width, height] = (link.dataset.devWindow ?? '').split('x');
    const opened = win.open(link.href, 'kajima-dev-phone', `popup,width=${width},height=${height}`);
    if (opened) {
      event.preventDefault();
      details.open = false;
    }
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !details.open) return;
    details.open = false;
    summary.focus();
  };
  const onPointer = (event: PointerEvent): void => {
    if (details.open && !(event.target instanceof Node && element.contains(event.target))) details.open = false;
  };
  element.addEventListener('click', onClick);
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('pointerdown', onPointer);
  return {
    element,
    destroy() {
      element.removeEventListener('click', onClick);
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('pointerdown', onPointer);
      element.remove();
    },
  };
}
