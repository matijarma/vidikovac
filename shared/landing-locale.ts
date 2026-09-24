// The landing's capture locale, read the way the page reads its own (app/src/i18n/create-default-i18n.ts
// resolveInitialLocale with no stored choice), for the Worker that names the captures in the HTML
// (worker/routes/landing.ts). Pure: no DOM, no Worker types, so both sides' tests can hold the parity.
export type LandingLocale = 'hr' | 'en';

/** The first supported language among the header's tags, in the browser's own order; Croatian otherwise. */
export function landingLocale(acceptLanguage: string | null | undefined): LandingLocale {
  for (const part of (acceptLanguage ?? '').split(',')) {
    const code = part.split(';')[0]!.trim().slice(0, 2).toLowerCase();
    if (code === 'hr' || code === 'en') return code;
  }
  return 'hr';
}

/** A landing capture path (/landing/<name>-<locale>-<theme>-<width>.webp), with its locale set; anything else as it is. */
const CAPTURE = /(^|[\s,])(\/landing\/[a-z]+-)(hr|en)(-(?:light|dark)-\d+\.webp)/g;
export function localizeCaptureUrls(value: string, locale: LandingLocale): string {
  return value.replace(CAPTURE, (_all, lead: string, head: string, _locale: string, tail: string) => `${lead}${head}${locale}${tail}`);
}

