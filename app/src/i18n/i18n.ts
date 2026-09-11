// TS port of v1's `src/i18n/i18n.js`, with two deliberate upgrades over v1:
//   1. `t(key, vars)` interpolates `{var}` placeholders itself (v1 kept a
//      separate `formatTemplate()` helper in `main.js` that callers had to
//      remember to use).
//   2. A missing key falls back to `defaultLocale`'s catalog before falling
//      back to the raw key — required for `hr.json` to be a legitimate
//      "starter" catalog (partial coverage) without users seeing dotted
//      paths for anything not yet translated.
//
// Catalogs are plain imported JSON (see `./locales/*.json`), not fetched
// over the network — a shared library has no stable URL to fetch from, and
// static imports work identically under Vite (pwa), wxt/Vite (extension),
// Vitest, and plain `tsc`.

export type LocaleCode = string;

export type MessageNode = string | { [key: string]: MessageNode };
export type MessageCatalog = Record<string, MessageNode>;

export interface I18nOptions {
  /** One parsed JSON message tree per supported locale, keyed by locale code. */
  catalogs: Record<LocaleCode, MessageCatalog>;
  /** Locale used when a key is missing from the active locale, and when `locale` is unsupported. */
  defaultLocale: LocaleCode;
  /** Initial active locale. Falls back to `defaultLocale` if omitted/unsupported. */
  locale?: LocaleCode;
}

export interface I18n {
  /** Dot-path lookup (`t('pairing.confirm.match')`) with optional `{var}` interpolation.
   *
   *  The example is a REAL key on purpose: the dead-key guard reads source text, so a
   *  made-up or retired key named here counts as a call site and keeps dead copy alive
   *  in four languages. `pairing.confirm.title` sat in the catalog for exactly that
   *  reason — this comment was its only reference anywhere. */
  t(key: string, vars?: Record<string, string | number>): string;
  /** Switches the active locale. Unsupported codes are ignored (stays on the current locale). Returns the resulting active locale. */
  setLocale(next: LocaleCode): LocaleCode;
  getLocale(): LocaleCode;
  getSupportedLocales(): LocaleCode[];
  /** Applies `[data-i18n]` / `[data-i18n-placeholder]` / `[data-i18n-aria-label]` under `root` (default: whole document). */
  translatePage(root?: ParentNode): void;
}

export function createI18n(options: I18nOptions): I18n {
  const { catalogs, defaultLocale } = options;
  const supported = Object.keys(catalogs);
  let locale = sanitizeLocale(options.locale, defaultLocale, supported);

  /** The active locale's string, then the default locale's, or `null` when neither has it. */
  function lookupTemplate(key: string): string | null {
    const fromActive = lookup(catalogs[locale], key);
    if (typeof fromActive === 'string') return fromActive;
    const fromDefault = lookup(catalogs[defaultLocale], key);
    if (typeof fromDefault === 'string') return fromDefault;
    return null;
  }

  function resolveTemplate(key: string): string {
    return lookupTemplate(key) ?? key;
  }

  /**
   * Picks the plural form for `count`, per the ACTIVE locale's rules.
   *
   * Two strings used to read "{count} new message(s)" and "…{count} device(s)", which is the
   * shape you write when there is no plural mechanism — and it is wrong in every language
   * including English. Croatian is the one that makes a `_one`/`_other` pair insufficient: it
   * has three categories (1 / 2-4 / 5+), so a `poruka` / `poruke` / `poruka` distinction needs
   * `_few` as well. `Intl.PluralRules` already knows all of this per locale; nothing here
   * hardcodes a language's rules.
   *
   * Falls back through `key_other` to the bare `key`, so a string that has no plural forms
   * behaves exactly as before and a partially-translated catalog still renders something.
   */
  function resolvePlural(key: string, count: number): string {
    let category = 'other';
    try {
      category = new Intl.PluralRules(locale).select(count);
    } catch {
      // An unrecognised locale tag: `other` is the form every language defines.
    }
    for (const candidate of [`${key}_${category}`, `${key}_other`, key]) {
      const template = lookupTemplate(candidate);
      if (template !== null) return template;
    }
    return key;
  }

  function t(key: string, vars?: Record<string, string | number>): string {
    const count = vars?.['count'];
    const template = typeof count === 'number' ? resolvePlural(key, count) : resolveTemplate(key);
    return interpolate(template, vars);
  }

  return {
    t,
    setLocale(next) {
      locale = sanitizeLocale(next, locale, supported);
      return locale;
    },
    getLocale() {
      return locale;
    },
    getSupportedLocales() {
      return [...supported];
    },
    translatePage(root = document) {
      root.querySelectorAll('[data-i18n]').forEach((node) => {
        const key = node.getAttribute('data-i18n');
        if (key) {
          node.textContent = t(key);
        }
      });
      root.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
        const key = node.getAttribute('data-i18n-placeholder');
        if (key) {
          node.setAttribute('placeholder', t(key));
        }
      });
      root.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
        const key = node.getAttribute('data-i18n-aria-label');
        if (key) {
          node.setAttribute('aria-label', t(key));
        }
      });
    },
  };
}

function sanitizeLocale(
  candidate: LocaleCode | undefined,
  fallback: LocaleCode,
  supported: LocaleCode[],
): LocaleCode {
  return candidate && supported.includes(candidate) ? candidate : fallback;
}

function lookup(catalog: MessageCatalog | undefined, key: string): MessageNode | undefined {
  if (!catalog) {
    return undefined;
  }
  return key.split('.').reduce<MessageNode | undefined>((acc, part) => {
    if (acc && typeof acc === 'object') {
      return acc[part];
    }
    return undefined;
  }, catalog);
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) {
    return template;
  }
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}
