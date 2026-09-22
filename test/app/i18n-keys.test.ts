// WP0 step 9 (T2): every key app/src names literally exists in both catalogues.
// i18n.t() returns the key itself when a catalogue lacks it (app/src/i18n/i18n.ts),
// which is how the raw 'kiosk.qrLabel' reached screen readers on the share dialog.
// What counts as a reference is the shared scanner's decision (seam S8,
// test/app/i18n-scan.ts); WP5's orphan test reads the same scan the other way round.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import { MIN_I18N_KEYS, emptyScan, keyCount, scanI18n, scanI18nSource, type I18nRef, type I18nScan } from './i18n-scan';

type Catalogue = Record<string, unknown>;
const CATALOGUES: ReadonlyArray<readonly [locale: string, catalogue: Catalogue]> = [
  ['hr', hr as unknown as Catalogue],
  ['en', en as unknown as Catalogue],
];
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function leaf(catalogue: Catalogue, key: string): string | undefined {
  const node = key.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Catalogue)[part] : undefined), catalogue);
  return typeof node === 'string' ? node : undefined;
}

/** Every plural form the locale selects for a whole count (hr: one, few, other; en: one, other). */
function pluralForms(locale: string, base: string): string[] {
  return new Intl.PluralRules(locale).resolvedOptions().pluralCategories.map((category) => `${base}_${category}`).sort();
}

type SourceOf = (file: string) => string;
const fromDisk: SourceOf = (file) => readFileSync(join(ROOT, file), 'utf8');

/**
 * Whether a reference reaches i18n.t() with a `count`, the only way a plural base resolves
 * (i18n.ts picks `${key}_${category}` only when `vars.count` is a number): a `.t(…)` call or a
 * local wrapper whose second argument is an object literal naming `count`, on the line the scan
 * recorded, whose key argument holds the key's literal. data-i18n attributes, group() lists,
 * tr() and anything the scanner followed through a variable never do.
 */
function countBearing(ref: I18nRef, key: string, sourceOf: SourceOf, cache: Map<string, ts.SourceFile>): boolean {
  if (ref.via !== 'i18n.t' && ref.via !== 'wrapper') return false;
  let sf = cache.get(ref.file);
  if (!sf) {
    sf = ts.createSourceFile(ref.file, sourceOf(ref.file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    cache.set(ref.file, sf);
  }
  const file = sf;
  const literals = (node: ts.Node, out: string[] = []): string[] => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    ts.forEachChild(node, (child) => { literals(child, out); });
    return out;
  };
  const namesKey = (text: string): boolean => text === key || (ref.via === 'wrapper' && key.endsWith(`.${text}`));
  const hasCount = (vars: ts.Expression | undefined): boolean => !!vars && ts.isObjectLiteralExpression(vars)
    && vars.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === 'count');
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node) && file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 === ref.line) {
      const callee = node.expression;
      const isT = ref.via === 'i18n.t' ? ts.isPropertyAccessExpression(callee) && callee.name.text === 't' : ts.isIdentifier(callee);
      const [keyArg, vars] = node.arguments;
      if (isT && keyArg && literals(keyArg).some(namesKey) && hasCount(vars)) found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * A literal key resolves when it is a string in the catalogue, or when it is a plural base
 * whose every form for the locale is a string AND the reference passes a `count`
 * (`i18n.t('base', { count })`); without one i18n.t() prints the base itself. A plural base
 * named through forms()/trPlural() must have all its forms.
 */
function missingKeys(scan: I18nScan, sourceOf: SourceOf = fromDisk): string[] {
  const missing: string[] = [];
  const cache = new Map<string, ts.SourceFile>();
  const where = (refs: readonly I18nRef[]): string => refs.map((r) => `${r.file}:${r.line}`).join(', ');
  for (const [locale, catalogue] of CATALOGUES) {
    for (const [key, refs] of scan.keys) {
      if (leaf(catalogue, key) !== undefined) continue;
      const plural = pluralForms(locale, key).every((form) => leaf(catalogue, form) !== undefined);
      const unresolved = plural ? refs.filter((ref) => !countBearing(ref, key, sourceOf, cache)) : refs;
      if (unresolved.length > 0) missing.push(`${locale}: ${key} (${where(unresolved)})`);
    }
    for (const [base, refs] of scan.plurals) {
      const absent = pluralForms(locale, base).filter((form) => leaf(catalogue, form) === undefined);
      if (absent.length > 0) missing.push(`${locale}: ${absent.join(', ')} (${where(refs)})`);
    }
  }
  return missing.sort();
}

/** Scans fixture sources and checks them against the real catalogues. */
function missingIn(sources: Record<string, string>): string[] {
  const scan = emptyScan();
  for (const [file, source] of Object.entries(sources)) scanI18nSource(file, source, scan);
  return missingKeys(scan, (file) => sources[file]!);
}

describe('the missing-key check', () => {
  it('names the two keys that reached the page raw before WP0', () => {
    expect(missingIn({
      'app/src/dashboard.ts': "i18n.t('kiosk.qrLabel', { code }); i18n.t('kiosk.invite.qrLabel', { code });",
      'app/src/layers/grad-teaser.ts': "i18n.t('kiosk.teaserPublished', { time }); i18n.t('kiosk.story.published', { time });",
    })).toEqual([
      'en: kiosk.qrLabel (app/src/dashboard.ts:1)',
      'en: kiosk.teaserPublished (app/src/layers/grad-teaser.ts:1)',
      'hr: kiosk.qrLabel (app/src/dashboard.ts:1)',
      'hr: kiosk.teaserPublished (app/src/layers/grad-teaser.ts:1)',
    ]);
  });

  it('accepts a plural base only with every form of the locale', () => {
    expect(missingIn({
      'app/src/a.ts': "i18n.t('time.minutesAgo', { count }); i18n.t('time.noSuchCount', { count });",
      'app/src/kiosk/strings.ts': "forms('lines', 'nearby'); forms('lines', 'noSuchBase');",
    })).toEqual([
      'en: kiosk.lines.noSuchBase_one, kiosk.lines.noSuchBase_other (app/src/kiosk/strings.ts:1)',
      'en: time.noSuchCount (app/src/a.ts:1)',
      'hr: kiosk.lines.noSuchBase_few, kiosk.lines.noSuchBase_one, kiosk.lines.noSuchBase_other (app/src/kiosk/strings.ts:1)',
      'hr: time.noSuchCount (app/src/a.ts:1)',
    ]);
  });

  it('accepts a plural base only where the reference passes a count', () => {
    expect(missingIn({
      'app/src/a.ts': [
        "i18n.t('time.minutesAgo', { count: Math.floor(s / 60) });",
        "i18n.t(live ? 'landing.live.warnings' : 'landing.live.warningsStale', { count });",
        "i18n.t('time.minutesAgo');",
        "i18n.t('time.hoursAgo', { hours });",
        'const html = `<span data-i18n="time.minutesAgo"></span>`;',
      ].join('\n'),
    })).toEqual([
      'en: time.hoursAgo (app/src/a.ts:4)',
      'en: time.minutesAgo (app/src/a.ts:3, app/src/a.ts:5)',
      'hr: time.hoursAgo (app/src/a.ts:4)',
      'hr: time.minutesAgo (app/src/a.ts:3, app/src/a.ts:5)',
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
