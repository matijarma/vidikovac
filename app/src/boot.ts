// One boot for every surface: locale, theme, icon sprite, toast queue, language
// toggle, then a single translatePage pass. Every entry module calls this first
// and differs only in what it mounts afterwards, so a surface-wide decision
// (which locale, which theme, where toasts live) is made in exactly one place.
// No CSS is imported here: the entry modules own the stylesheets (R-37), which
// also keeps this module loadable by a plain node test.
import { bootLocale, createDefaultI18n } from './i18n/create-default-i18n';
import type { I18n, LocaleCode } from './i18n/i18n';
import { createLanguageToggle } from './i18n/toggle';
import { mountIconSprite } from './ui/icons';
import { createThemeController, type ThemeController } from './ui/theme';
import { createToastQueue, type ToastQueue } from './ui/toast';

/** Where a page offers room for the language toggle. Empty in the HTML; bootPage
 *  fills it. C8's static pages carry their own `[data-testid=lang-slot]` and fill
 *  it themselves, so the two conventions never produce two buttons. */
export const LANG_SLOT_SELECTOR = '[data-lang-toggle]';

export interface BootPageOptions {
  /** Written to <html data-page>, so CSS and tests can key on the surface. */
  page: string;
  documentRef?: Document;
  /** Where toasts go; defaults to the queue's own .toast-stack on <body>. */
  toastContainer?: HTMLElement;
  /** Fired after the language toggle switched the locale. */
  onLocaleChange?: (locale: LocaleCode) => void;
}

export interface BootedPage {
  i18n: I18n;
  theme: ThemeController;
  toasts: ToastQueue;
}

export function bootPage(options: BootPageOptions): BootedPage {
  const doc = options.documentRef ?? document;
  const root = doc.documentElement;

  const i18n = createDefaultI18n(bootLocale());
  root.lang = i18n.getLocale();
  root.setAttribute('data-page', options.page);

  // The <head> module already resolved a theme before first paint; this is the
  // controller the page keeps, so `auto` and `solar` stay live while it is open.
  const theme = createThemeController({ root, documentRef: doc });
  mountIconSprite(doc);

  const toasts = createToastQueue({ container: options.toastContainer, maxVisible: 2 });

  const slot = doc.querySelector(LANG_SLOT_SELECTOR);
  if (slot && slot.childElementCount === 0) {
    slot.appendChild(
      createLanguageToggle(i18n, { documentRef: doc, onChange: options.onLocaleChange }),
    );
  }

  i18n.translatePage(doc);
  return { i18n, theme, toasts };
}
