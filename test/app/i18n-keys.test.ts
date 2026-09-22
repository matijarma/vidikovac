// WP0 step 9 (T2): every key app/src names literally exists in both catalogues.
// i18n.t() returns the key itself when a catalogue lacks it (app/src/i18n/i18n.ts),
// which is how the raw 'kiosk.qrLabel' reached screen readers on the share dialog.
// What counts as a reference is the shared scanner's decision (seam S8,
// test/app/i18n-scan.ts); WP5's orphan test reads the same scan the other way round.
import { describe, expect, it } from 'vitest';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import { MIN_I18N_KEYS, emptyScan, keyCount, scanI18n, scanI18nSource, type I18nScan } from './i18n-scan';

type Catalogue = Record<string, unknown>;
const CATALOGUES: ReadonlyArray<readonly [locale: string, catalogue: Catalogue]> = [
  ['hr', hr as unknown as Catalogue],
  ['en', en as unknown as Catalogue],
];

function leaf(catalogue: Catalogue, key: string): string | undefined {
  const node = key.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Catalogue)[part] : undefined), catalogue);
  return typeof node === 'string' ? node : undefined;
}

/** Every plural form the locale selects for a whole count (hr: one, few, other; en: one, other). */
function pluralForms(locale: string, base: string): string[] {
  return new Intl.PluralRules(locale).resolvedOptions().pluralCategories.map((category) => `${base}_${category}`).sort();
}

/**
 * A literal key resolves when it is a string in the catalogue, or when it is a plural base
 * (`i18n.t('base', { count })`) whose every form for the locale is a string. A plural base
 * named through forms()/trPlural() must have all its forms.
 */
function missingKeys(scan: I18nScan): string[] {
  const missing: string[] = [];
  const where = (refs: { file: string; line: number }[]): string => refs.map((r) => `${r.file}:${r.line}`).join(', ');
  for (const [locale, catalogue] of CATALOGUES) {
    for (const [key, refs] of scan.keys) {
      if (leaf(catalogue, key) !== undefined) continue;
      if (pluralForms(locale, key).every((form) => leaf(catalogue, form) !== undefined)) continue;
      missing.push(`${locale}: ${key} (${where(refs)})`);
    }
    for (const [base, refs] of scan.plurals) {
      const absent = pluralForms(locale, base).filter((form) => leaf(catalogue, form) === undefined);
      if (absent.length > 0) missing.push(`${locale}: ${absent.join(', ')} (${where(refs)})`);
    }
  }
  return missing.sort();
}

describe('the missing-key check', () => {
  it('names the two keys that reached the page raw before WP0', () => {
    const scan = emptyScan();
    scanI18nSource('app/src/dashboard.ts', "i18n.t('kiosk.qrLabel', { code }); i18n.t('kiosk.invite.qrLabel', { code });", scan);
    scanI18nSource('app/src/layers/grad-teaser.ts', "i18n.t('kiosk.teaserPublished', { time }); i18n.t('kiosk.story.published', { time });", scan);
    expect(missingKeys(scan)).toEqual([
      'en: kiosk.qrLabel (app/src/dashboard.ts:1)',
      'en: kiosk.teaserPublished (app/src/layers/grad-teaser.ts:1)',
      'hr: kiosk.qrLabel (app/src/dashboard.ts:1)',
      'hr: kiosk.teaserPublished (app/src/layers/grad-teaser.ts:1)',
    ]);
  });

  it('accepts a plural base only with every form of the locale', () => {
    const scan = emptyScan();
    scanI18nSource('app/src/a.ts', "i18n.t('time.minutesAgo', { count }); i18n.t('time.noSuchCount', { count });", scan);
    scanI18nSource('app/src/kiosk/strings.ts', "forms('lines', 'nearby'); forms('lines', 'noSuchBase');", scan);
    expect(missingKeys(scan)).toEqual([
      'en: kiosk.lines.noSuchBase_one, kiosk.lines.noSuchBase_other (app/src/kiosk/strings.ts:1)',
      'en: time.noSuchCount (app/src/a.ts:1)',
      'hr: kiosk.lines.noSuchBase_few, kiosk.lines.noSuchBase_one, kiosk.lines.noSuchBase_other (app/src/kiosk/strings.ts:1)',
      'hr: time.noSuchCount (app/src/a.ts:1)',
    ]);
  });
});

describe('every literal i18n key in app/src', () => {
  const scan = scanI18n();

  it(`is read from a scan of at least ${MIN_I18N_KEYS} keys`, () => {
    expect(keyCount(scan)).toBeGreaterThanOrEqual(MIN_I18N_KEYS);
  });

  it('resolves in hr.json and en.json', () => {
    expect(missingKeys(scan)).toEqual([]);
  });
});
