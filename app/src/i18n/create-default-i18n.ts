// psdlat packages/ui/src/i18n/create-default-i18n.ts adapted: two locales,
// Croatian first, storage key in this project's naming scheme.
import en from './en.json';
import hr from './hr.json';
import { createI18n, type I18n, type LocaleCode, type MessageCatalog } from './i18n';

export const DEFAULT_LOCALE = 'hr';
export const SUPPORTED_LOCALES = ['hr', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Each language named in itself, so a stranded reader can find their own. */
export const LOCALE_LABELS: Record<SupportedLocale, string> = { hr: 'Hrvatski', en: 'English' };
export const LOCALE_STORAGE_KEY = 'vidikovac-locale';

export function isSupportedLocale(code: string): code is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(code);
}
export function localeLabel(code: string): string {
  return isSupportedLocale(code) ? LOCALE_LABELS[code] : code.toUpperCase();
}
export function resolveInitialLocale(stored: string | null | undefined, preferredTags: readonly string[] = []): LocaleCode | undefined {
  const storedCode = (stored ?? '').slice(0, 2).toLowerCase();
  if (storedCode && isSupportedLocale(storedCode)) return storedCode;
  for (const tag of preferredTags) {
    const code = tag.slice(0, 2).toLowerCase();
    if (isSupportedLocale(code)) return code;
  }
  return undefined;
}
export function storeLocale(locale: LocaleCode, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try { storage?.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* private mode */ }
}
function safeStorage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

const CATALOGS: Record<LocaleCode, MessageCatalog> = { hr, en };

export function createDefaultI18n(locale?: LocaleCode): I18n {
  return createI18n({ catalogs: CATALOGS, defaultLocale: DEFAULT_LOCALE, locale });
}

/** Locale for the page at boot: stored choice, then navigator.languages, then hr. */
export function bootLocale(): LocaleCode {
  let stored: string | null = null;
  try { stored = globalThis.localStorage.getItem(LOCALE_STORAGE_KEY); } catch { stored = null; }
  const nav = typeof navigator === 'undefined' ? [] : navigator.languages ?? [];
  return resolveInitialLocale(stored, nav) ?? DEFAULT_LOCALE;
}
