// The transport workspace's words live in the one catalogue (i18n/hr.json,
// en.json) under `transport.*`; this is the thin typed adapter over it. The
// workspace reuses shared keys wherever one already says the right thing
// (motion.note, motion.direction, panels.vehiclesCount...) through
// i18n.t at the call site and addresses its own by their short name here,
// picked by the page's locale, so a locale switch re-renders the workspace
// in the other language like everything else.
//
// Callers hand in anything with `getLocale` (city-map.ts passes a plain
// `{ getLocale }`), so the sentence is read through an I18n of that locale
// rather than the caller's `t`. Anything that is not English reads Croatian.
import { createDefaultI18n, type SupportedLocale } from '../i18n/create-default-i18n';
import hr from '../i18n/hr.json';
import type { I18n } from '../i18n/i18n';

export type TransportKey = keyof typeof hr.transport;

type PluralBase<K extends string> = K extends `${infer Base}_one` ? Base : never;
/** Keys with `_one/_few/_other` forms, addressed by their base name. */
export type TransportPluralKey = PluralBase<TransportKey>;

const BY_LOCALE = new Map<SupportedLocale, I18n>();

function catalogue(locale: string): I18n {
  const code: SupportedLocale = locale.toLowerCase().startsWith('en') ? 'en' : 'hr';
  let i18n = BY_LOCALE.get(code);
  if (!i18n) {
    i18n = createDefaultI18n(code);
    BY_LOCALE.set(code, i18n);
  }
  return i18n;
}

/** A workspace string in the page's locale, with `{var}` interpolation. */
export function tr(i18n: Pick<I18n, 'getLocale'>, key: TransportKey, vars?: Record<string, string | number>): string {
  return catalogue(i18n.getLocale()).t(`transport.${key}`, vars);
}

/** The plural form of `base` for `count`, by the locale's own rules (Croatian
 *  has one / few / other; English one / other): i18n.t picks `_one`, `_few` or
 *  `_other` from `count` and falls back through `_other`. */
export function trPlural(i18n: Pick<I18n, 'getLocale'>, base: TransportPluralKey, count: number, vars: Record<string, string | number> = {}): string {
  return catalogue(i18n.getLocale()).t(`transport.${base}`, { count, ...vars });
}
