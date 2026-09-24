// The landing's captures are chosen by the Worker (worker/routes/landing.ts, shared/landing-locale.ts), so a visitor whose browser reads
// English downloads each screenshot once, in English, instead of the Croatian one the static HTML names and then
// the English one landing/images.ts swaps in (lane/v-lh P5: 115 to 140 kB extra per visit). The Worker can only
// see the Accept-Language header, so it must resolve it exactly as the page resolves navigator.languages
// (i18n/create-default-i18n.ts resolveInitialLocale, with no stored choice): a disagreement would fetch twice again.
import { describe, expect, it } from 'vitest';
import { landingLocale, localizeCaptureUrls } from '../../shared/landing-locale';
import { DEFAULT_LOCALE, resolveInitialLocale } from '../../app/src/i18n/create-default-i18n';

/** The tags a browser sends, in its own order (the q-values follow that order). */
const tags = (header: string): string[] => header.split(',').map((part) => part.split(';')[0]!.trim()).filter(Boolean);

describe('landingLocale: the page\'s own rule, read from Accept-Language', () => {
  const headers = [
    'en-GB,en;q=0.9', 'en-US', 'hr-HR,hr;q=0.9,en-US;q=0.8,en;q=0.7', 'hr', 'de-DE,de;q=0.9,en;q=0.8', 'de-DE,de;q=0.9,hr;q=0.8,en;q=0.7',
    'fr-FR', '', '*', 'EN-gb', 'sr-Latn-RS,sr;q=0.9', 'en-HR,hr;q=0.9', ' hr-HR ; q=1 , en ; q=0.5',
  ];
  it.each(headers)('%j', (header) => {
    expect(landingLocale(header)).toBe(resolveInitialLocale(null, tags(header)) ?? DEFAULT_LOCALE);
  });
  it('Croatian without a header', () => {
    expect(landingLocale(null)).toBe('hr');
  });
});

describe('localizeCaptureUrls: only the locale part of a capture path changes', () => {
  it('rewrites every candidate of a srcset and keeps widths, theme and descriptors', () => {
    expect(localizeCaptureUrls('/landing/kiosk-hr-light-720.webp 720w, /landing/kiosk-hr-light-1280.webp 1280w', 'en'))
      .toBe('/landing/kiosk-en-light-720.webp 720w, /landing/kiosk-en-light-1280.webp 1280w');
    expect(localizeCaptureUrls('/landing/phone-hr-dark-390.webp', 'en')).toBe('/landing/phone-en-dark-390.webp');
    expect(localizeCaptureUrls('/landing/phone-hr-dark-390.webp', 'hr')).toBe('/landing/phone-hr-dark-390.webp');
  });
  it('leaves anything that is not a landing capture alone', () => {
    for (const value of ['/landing/share.jpg', '/assets/hr-light-1.webp', 'https://example.test/landing/kiosk-hr-light-720.webp']) {
      expect(localizeCaptureUrls(value, 'en')).toBe(value);
    }
  });
});
