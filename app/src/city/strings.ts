// The city words live in the one catalogue (i18n/hr.json, en.json) under
// `city.*`; this is the thin typed adapter over it, shaped like
// transport/strings.ts. Callers address a word by its short name (`ct(i18n,
// 'back')` reads city.back), picked by the page's locale, so a locale switch
// re-renders the city surfaces in the other language like everything else.
//
// Callers hand in anything with `getLocale` (city/air.ts and the map pass a
// plain `{ getLocale }`), so the word is read through an I18n of that locale
// rather than the caller's `t`. Anything that is not English reads Croatian.
import { catalogueLocale, createDefaultI18n, type SupportedLocale } from '../i18n/create-default-i18n';
import hr from '../i18n/hr.json';
import type { I18n } from '../i18n/i18n';

type CityKey = keyof typeof hr.city;
/** A word of `city.*`; the plural forms are read by their base (bikeCount), never one by one. */
export type CityWord = Exclude<CityKey, `${string}_${'one' | 'few' | 'other'}`>;

const BY_LOCALE = new Map<SupportedLocale, I18n>();

function catalogue(locale: string): I18n {
  const code = catalogueLocale(locale);
  let i18n = BY_LOCALE.get(code);
  if (!i18n) {
    i18n = createDefaultI18n(code);
    BY_LOCALE.set(code, i18n);
  }
  return i18n;
}

/** A city word in the page's locale, with `{var}` interpolation. */
export function ct(i18n: Pick<I18n, 'getLocale'>, key: CityWord, vars?: Record<string, string | number>): string {
  return catalogue(i18n.getLocale()).t(`city.${key}`, vars);
}

/** A numeric availability and its noun, on the wall and the phone alike: "5 bicikala", "1 bike".
 *  A count the source did not state is a dash and the noun (city.bikeCountUnknown), never "?". */
export function bikeCount(i18n: Pick<I18n, 'getLocale'>, value: unknown): string {
  const count = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(count)) return ct(i18n, 'bikeCountUnknown');
  return catalogue(i18n.getLocale()).t('city.bikeCount', { count });
}
