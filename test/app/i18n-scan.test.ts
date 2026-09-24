// Seam S8: the i18n reference scanner, against small fixture sources and once
// against the real tree (≥ 500 keys, every dynamic prefix allowed and met).
import { describe, expect, it } from 'vitest';
import {
  DYNAMIC_PREFIXES,
  MIN_I18N_KEYS,
  emptyScan,
  isReferenced,
  keyCount,
  scanI18n,
  scanI18nSource,
  unknownDynamicPrefixes,
  type I18nRef,
  type I18nScan,
  type I18nVia,
} from './i18n-scan';

const keys = (scan: I18nScan): string[] => [...scan.keys.keys()].sort();
const scanOf = (source: string, file = 'app/src/fixture.ts'): I18nScan => scanI18nSource(file, source);

describe('i18n-scan on fixture sources', () => {
  it('reads literal .t() keys on any receiver, in any quote', () => {
    const scan = scanOf("i18n.t('a.b'); ctx.i18n.t(\"c.d\", { n }); deps.i18n.t(`e.f`);");
    expect(keys(scan)).toEqual(['a.b', 'c.d', 'e.f']);
    const ref: I18nRef = scan.keys.get('c.d')![0]!;
    expect(ref).toEqual<I18nRef>({ file: 'app/src/fixture.ts', line: 1, via: 'i18n.t' });
  });

  it('never counts a comment', () => {
    expect(keys(scanOf("// i18n.t('dead.one')\n/* i18n.t('dead.two') */\nconst x = 1;"))).toEqual([]);
  });

  it('takes every branch of a ternary and a fallback, never the condition', () => {
    const scan = scanOf("i18n.t(status === 'none' ? 'g.one' : live ? 'g.two' : 'g.three'); i18n.t(k ?? 'g.four');");
    expect(keys(scan)).toEqual(['g.four', 'g.one', 'g.three', 'g.two']);
    expect(scan.unresolved).toHaveLength(1);
  });

  it('follows a local const to its literal or template', () => {
    const scan = scanOf("function f(code, live) {\n  const key = `scan.errors.${code}`;\n  const label = live ? 'landing.live.a' : 'landing.live.b';\n  return i18n.t(key) + i18n.t(label);\n}");
    expect(keys(scan)).toEqual(['landing.live.a', 'landing.live.b']);
    expect([...scan.dynamic.keys()]).toEqual(['scan.errors.']);
    expect(scan.unresolved).toEqual([]);
  });

  it('records a template key by its prefix and a variable key as unresolved', () => {
    const scan = scanOf('i18n.t(`notify.${kind}`); i18n.t(key); i18n.t(`secret.${x}`);');
    expect([...scan.dynamic.keys()].sort()).toEqual(['notify.', 'secret.']);
    expect(scan.unresolved).toHaveLength(1);
    expect(unknownDynamicPrefixes(scan)).toEqual(['secret.']);
  });

  it('reads a prefixing wrapper and a pass-through wrapper, not their own bodies', () => {
    const presentation = scanOf("const t = (key: string) => escapeHtml(i18n.t(`presentation.${key}`));\nt('title'); t(open ? 'close' : 'open');");
    expect(keys(presentation)).toEqual(['presentation.close', 'presentation.open', 'presentation.title']);
    expect(presentation.dynamic.size).toBe(0);
    expect(presentation.keys.get('presentation.title')![0]!.via).toBe<I18nVia>('wrapper');
    const timeband = scanOf("const t = (key: string, vars?: Record<string, string>): string => i18n.t(key, vars);\nt('timeband.sada'); t(morning ? 'timeband.today' : 'timeband.afternoon');");
    expect(keys(timeband)).toEqual(['timeband.afternoon', 'timeband.sada', 'timeband.today']);
    expect(timeband.unresolved).toEqual([]);
  });

  it('reads the kiosk group(), forms() and record() lists in app/src/kiosk/strings.ts only', () => {
    const source = [
      'const t = (key: string): string => i18n.t(key);',
      'const group = (name, keys) => Object.fromEntries(keys.map((key) => [key, t(`kiosk.${name}.${key}`)]));',
      'const forms = (name, base) => ({ one: t(`kiosk.${name}.${base}_one`), other: t(`kiosk.${name}.${base}_other`) });',
      'const record = (keys, key) => Object.fromEntries(keys.map((k) => [k, t(key(k))]));',
      "const s = { a: group('setup', ['title', 'create']), b: forms('lines', 'nearby'), c: t('common.appName'),",
      "  d: record(['now', 'live'] as const, (key) => `arrivals.${key}`), e: record(THEMES, (p) => `kiosk.header.themeWord.${p}`) };",
    ].join('\n');
    const scan = scanOf(source, 'app/src/kiosk/strings.ts');
    expect(keys(scan)).toEqual(['arrivals.live', 'arrivals.now', 'common.appName', 'kiosk.setup.create', 'kiosk.setup.title']);
    expect([...scan.plurals.keys()]).toEqual(['kiosk.lines.nearby']);
    expect([...scan.dynamic.keys()]).toEqual(['kiosk.header.themeWord.']);
    expect(scan.unresolved).toEqual([]);
    expect(keys(scanOf(source, 'app/src/elsewhere.ts'))).toEqual(['common.appName']);
  });

  it('reads tr(), trPlural() and ct() argument lists, ternaries included; ct() names city.* keys', () => {
    const scan = scanOf("tr(i18n, 'stopTitle'); trPlural(i18n, 'platforms', n); ct(i18n, heritage ? 'heritage' : 'map'); tr(i18n, open ? 'close' : 'open', { n });");
    expect(keys(scan)).toEqual(['city.heritage', 'city.map', 'transport.close', 'transport.open', 'transport.stopTitle']);
    expect([...scan.plurals.keys()]).toEqual(['transport.platforms']);
    expect([...scan.cityWords.keys()].sort()).toEqual(['heritage', 'map']);
  });

  it('reads the city adapter as the catalogue: ct() and bikeCount() are its helpers, a fact label its one prefix', () => {
    const adapter = scanOf([
      "export function ct(i18n, key, vars) { return catalogue(i18n.getLocale()).t(`city.${key}`, vars); }",
      "export function bikeCount(i18n, value) { return ok ? catalogue(i18n.getLocale()).t('city.bikeCount', { count }) : ct(i18n, 'bikeCountUnknown'); }",
    ].join('\n'), 'app/src/city/strings.ts');
    expect(keys(adapter)).toEqual(['city.bikeCount', 'city.bikeCountUnknown']);
    expect(adapter.dynamic.size).toBe(0);
    const facts = scanOf("ct(i18n, `fact-${key}`); ct(i18n, word);");
    expect([...facts.dynamic.keys()]).toEqual(['city.fact-']);
    expect(facts.cityWords.size).toBe(0);
    expect(facts.unresolved).toHaveLength(1);
  });

  it('reads data-i18n attributes inside strings and templates', () => {
    const scan = scanOf("const html = `<a data-i18n=\"shell.skip\"></a><input data-i18n-placeholder='scan.placeholder'><b data-i18n-aria-label=\"shell.wordmarkLabel\">${x}</b>`;");
    expect(keys(scan)).toEqual(['scan.placeholder', 'shell.skip', 'shell.wordmarkLabel']);
  });

  it('decides what counts as referenced', () => {
    const scan = emptyScan();
    scanI18nSource('app/src/a.ts', "i18n.t('a.b'); i18n.t('c.count', { count }); i18n.t(`notify.${k}`);", scan);
    scanI18nSource('app/src/kiosk/strings.ts', "const forms = (name, base) => ({}); forms('lines', 'nearby');", scan);
    expect(['a.b', 'kiosk.lines.nearby_few', 'c.count_other', 'notify.kiosk'].every((k) => isReferenced(scan, k))).toBe(true);
    expect(['a.c', 'kiosk.lines.nearby', 'weather.points.x'].some((k) => isReferenced(scan, k))).toBe(false);
    expect(keyCount(scan)).toBe(3);
  });
});

describe('i18n-scan on app/src', () => {
  const scan = scanI18n();

  it(`finds at least ${MIN_I18N_KEYS} keys`, () => {
    expect(keyCount(scan)).toBeGreaterThanOrEqual(MIN_I18N_KEYS);
    expect(scan.files.length).toBeGreaterThan(100);
  });

  it('meets every allowed dynamic prefix and no other', () => {
    expect(unknownDynamicPrefixes(scan)).toEqual([]);
    for (const prefix of DYNAMIC_PREFIXES) expect([...scan.dynamic.keys()].some((p) => p.startsWith(prefix)), prefix).toBe(true);
  });

  it('knows the reference forms the plan names', () => {
    expect(scan.keys.has('presentation.takeover')).toBe(true);
    expect(scan.keys.has('kiosk.invite.qrLabel')).toBe(true);
    expect(scan.keys.has('shell.skip')).toBe(true);
    expect(scan.keys.has('arrivals.now')).toBe(true);
    expect(scan.plurals.has('kiosk.lines.nearby')).toBe(true);
    expect(scan.cityWords.has('noLocation')).toBe(true);
    expect(scan.keys.has('city.noLocation')).toBe(true);
    expect(scan.keys.has('none')).toBe(false);
  });
});
