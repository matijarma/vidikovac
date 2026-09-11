// One button that flips hr <-> en. Its label is the OTHER language, in that
// language, with a matching `lang` attribute so screen readers pronounce it.
import { LOCALE_LABELS, storeLocale, type SupportedLocale } from './create-default-i18n';
import type { I18n, LocaleCode } from './i18n';

export interface LanguageToggleDeps {
  storage?: Pick<Storage, 'setItem'>;
  documentRef?: Document;
  onChange?: (locale: LocaleCode) => void;
}

export function createLanguageToggle(i18n: I18n, deps: LanguageToggleDeps = {}): HTMLButtonElement {
  const doc = deps.documentRef ?? document;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'btn-ghost lang-toggle';
  button.setAttribute('data-testid', 'lang-toggle');

  function other(): SupportedLocale { return i18n.getLocale() === 'hr' ? 'en' : 'hr'; }
  function paint(): void {
    const next = other();
    button.textContent = LOCALE_LABELS[next];
    button.setAttribute('lang', next);
    button.setAttribute('aria-label', `${LOCALE_LABELS[next]} (${next.toUpperCase()})`);
  }
  paint();
  button.addEventListener('click', () => {
    const next = i18n.setLocale(other());
    storeLocale(next, deps.storage);
    doc.documentElement.lang = next;
    i18n.translatePage(doc);
    paint();
    deps.onChange?.(next);
  });
  return button;
}
