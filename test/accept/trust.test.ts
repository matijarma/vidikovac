// WP6 step 8: the trust and slop guards of the companion plan
// (docs/companion-2026-09-22.md §7 P0 items, §13 slop register, §15), as one
// accept-tier file: `npm run accept -- test/accept/trust.test.ts`. Rows whose
// package has landed are green now and must stay green; the others are red by
// design until their package lands (never `skip` one). Each row names the
// package that turns it green, and the file prints the red list when it ends,
// the way test/accept/probes.test.ts does.
//
//   (a) every literal i18n key resolves in both catalogues (seam S8's scanner, test/app/i18n-scan.ts)
//   (b) the closures attribution prints no clock time and no "posljednja izmjena" value
//   (c) a cluster pill writes its lines, never a "+N" count
//   (d) the wall renders no control that ends a presentation and no gear, theme, pause or copy control
//   (e) the §13 "out" strings are absent outside their allowed files; the pharmacy is a symbol, not
//       the words "Dežurna ljekarna"; no fetch time and no "Zaustavi" is a wall string; one word
//       for the transport tab; no real screen secret in e2e/, scripts/, docs/ or test/
//
// The source scans are proxies (a string in the code, a key the wall reads);
// e2e/accept/wall.spec.ts and phone.spec.ts check the rendered DOM. Fold-back
// rule (vitest.config.ts): when a row is green for good it moves to the unit tier.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { fillAttribution } from '../../app/src/attribution';
import { ct, type CityWord } from '../../app/src/city/strings';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import * as frame from '../../app/src/kiosk/frame';
import { kioskStrings } from '../../app/src/kiosk/strings';
import { clusterLabel, pillChars, pillWidthPx } from '../../app/src/motion/pills';
import { ATTRIBUTION } from '../../worker/feed/registry';
import { ATTRIBUTION_CASES } from '../fixtures/attribution-cases';
import { emptyScan, scanI18n, scanI18nSource, type I18nRef, type I18nScan } from '../app/i18n-scan';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

type Catalogue = Record<string, unknown>;
const HR = hr as unknown as Catalogue;
const EN = en as unknown as Catalogue;
const CATALOGUES: ReadonlyArray<readonly [locale: string, catalogue: Catalogue]> = [['hr', HR], ['en', EN]];

function leaf(catalogue: Catalogue, key: string): string | undefined {
  const node = key.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Catalogue)[part] : undefined), catalogue);
  return typeof node === 'string' ? node : undefined;
}
function leaves(node: unknown, prefix = ''): Array<[key: string, value: string]> {
  if (typeof node === 'string') return [[prefix, node]];
  if (node && typeof node === 'object') return Object.entries(node as Catalogue).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  return [];
}
const HR_LEAVES = leaves(HR);

/** Files under `dir` (repository-relative) whose name passes `keep`. */
function walk(dir: string, keep: (name: string) => boolean, skip: readonly string[] = [], out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (skip.includes(rel)) continue;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, keep, skip, out);
    else if (keep(name)) out.push(rel);
  }
  return out.sort();
}

/** Every string a TypeScript source can print: string literals and the text parts of templates; comments never count. */
function stringLiterals(file: string, source: string): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      out.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  return out;
}
/** The source as code: every comment dropped, literals kept as written. */
function withoutComments(file: string, source: string): string {
  return ts.createPrinter({ removeComments: true }).printFile(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A test id or data value as a whole token: `pair-copy` never matches `pair-copy-status`. */
const wholeToken = (name: string): RegExp => new RegExp(`(?<![\\w-])${escapeRe(name)}(?![\\w-])`);
const where = (refs: readonly I18nRef[]): string => refs.map((r) => `${r.file}:${r.line}`).join(', ');

const APP_TS = walk('app/src', (name) => name.endsWith('.ts'));
const APP_JSON = walk('app/src', (name) => name.endsWith('.json'));
/** The wall's own code: app/src/kiosk*.ts and everything under app/src/kiosk/. */
const WALL_TS = APP_TS.filter((file) => /^app\/src\/kiosk[^/]*\.ts$/.test(file) || file.startsWith('app/src/kiosk/'));
const LITERALS = new Map(APP_TS.map((file) => [file, stringLiterals(file, read(file))] as const));
const WALL_CODE = new Map(WALL_TS.map((file) => [file, withoutComments(file, read(file))] as const));

let wallScanMemo: I18nScan | undefined;
/** The i18n references of the wall's code alone (the S8 scanner run over WALL_TS), read once. */
function wallScan(): I18nScan {
  if (!wallScanMemo) {
    wallScanMemo = emptyScan();
    for (const file of WALL_TS) scanI18nSource(file, read(file), wallScanMemo);
  }
  return wallScanMemo;
}
const HR_I18N = { getLocale: () => 'hr' as const };

interface WallString { where: string; text: string }
/**
 * Every Croatian string the wall can print, as far as a source scan can tell: the string literals
 * of its code, the hr value of every key and city word its code reads (a dynamic prefix brings every
 * key under it), and every kiosk.* leaf of hr.json, read or not.
 */
let wallStringsMemo: WallString[] | undefined;
function wallStrings(): WallString[] {
  if (wallStringsMemo) return wallStringsMemo;
  const out: WallString[] = [];
  for (const file of WALL_TS) for (const text of LITERALS.get(file)!) out.push({ where: file, text });
  const scan = wallScan();
  for (const [key, refs] of scan.keys) {
    const value = leaf(HR, key);
    if (value !== undefined) out.push({ where: `hr.json ${key} (read at ${where(refs)})`, text: value });
  }
  for (const [base, refs] of scan.plurals) {
    for (const [key, value] of HR_LEAVES) if (key.startsWith(`${base}_`)) out.push({ where: `hr.json ${key} (read at ${where(refs)})`, text: value });
  }
  for (const [prefix, refs] of scan.dynamic) {
    if (!prefix) continue;
    for (const [key, value] of HR_LEAVES) if (key.startsWith(prefix)) out.push({ where: `hr.json ${key} (read as ${prefix}… at ${where(refs)})`, text: value });
  }
  for (const [word, refs] of scan.cityWords) {
    out.push({ where: `app/src/city/strings.ts ${word} (read at ${where(refs)})`, text: ct(HR_I18N, word as CityWord) });
  }
  for (const [key, value] of HR_LEAVES) if (key.startsWith('kiosk.')) out.push({ where: `hr.json ${key}`, text: value });
  wallStringsMemo = out;
  return out;
}

// --- The row register and the red list ------------------------------------------------------

/** 'now': the package has landed and the row must be green; otherwise the package that turns it green. */
type Due = 'now' | 'WP1' | 'WP2' | 'WP3' | 'WP4' | 'WP5';
interface RowResult { id: string; due: Due; title: string; ok: boolean }
const results: RowResult[] = [];

/** One accept row: an `it` whose title carries the row id and its due package, recorded for the summary. */
function row(id: string, due: Due, title: string, body: () => void): void {
  it(`${id} [${due === 'now' ? 'green now' : `red until ${due}`}] ${title}`, () => {
    try {
      body();
      results.push({ id, due, title, ok: true });
    } catch (error) {
      results.push({ id, due, title, ok: false });
      throw error;
    }
  });
}

afterAll(() => {
  const sorted = [...results].sort((a, b) => a.id.localeCompare(b.id));
  const green = sorted.filter((r) => r.ok);
  const byDesign = sorted.filter((r) => !r.ok && r.due !== 'now');
  const regressions = sorted.filter((r) => !r.ok && r.due === 'now');
  const line = (r: RowResult): string => `  ${r.id.padEnd(22)} ${(r.due === 'now' ? '' : r.due).padEnd(4)} ${r.title}`;
  console.log([
    `Trust guards: ${green.length} green, ${byDesign.length} red by design, ${regressions.length} red that must be green`,
    ...(regressions.length ? ['RED, due now (a regression):', ...regressions.map(line)] : []),
    ...(byDesign.length ? ['red by design (waiting for the package named):', ...byDesign.map(line)] : []),
    ...(green.length ? ['green:', ...green.map(line)] : []),
  ].join('\n'));
});

// --- (a) literal i18n keys ------------------------------------------------------------------

describe('(a) every literal i18n key resolves in hr.json and en.json (P0.3)', () => {
  row('a-keys', 'now', 'every key app/src names literally is a string (or a full plural) in both catalogues', () => {
    const scan = scanI18n();
    const missing: string[] = [];
    for (const [locale, catalogue] of CATALOGUES) {
      const forms = (base: string): string[] => new Intl.PluralRules(locale).resolvedOptions().pluralCategories.map((c) => `${base}_${c}`);
      for (const [key, refs] of scan.keys) {
        if (leaf(catalogue, key) !== undefined) continue;
        if (forms(key).every((form) => leaf(catalogue, form) !== undefined)) continue;
        missing.push(`${locale}: ${key} (${where(refs)})`);
      }
      for (const [base, refs] of scan.plurals) {
        const absent = forms(base).filter((form) => leaf(catalogue, form) === undefined);
        if (absent.length) missing.push(`${locale}: ${absent.join(', ')} (${where(refs)})`);
      }
    }
    expect(missing.sort()).toEqual([]);
    // The key that reached the share dialog raw before WP0 (app/src/dashboard.ts, real key kiosk.invite.qrLabel).
    expect(scan.keys.has('kiosk.qrLabel'), 'kiosk.qrLabel is referenced again').toBe(false);
  });
});

// --- (b) the closures attribution -----------------------------------------------------------

describe('(b) the closures attribution prints no clock time (P0.4)', () => {
  const CLOCK = /\b\d{1,2}:\d{2}\b/;
  const CHANGE_WITH_VALUE = /posljednja izmjena\s*\S/;

  row('b-prometnice', 'now', 'fillAttribution(prometnice) prints no HH:MM, no fetch time and no "posljednja izmjena" value', () => {
    const cases = ATTRIBUTION_CASES.filter((c) => c.attribution.text === ATTRIBUTION.prometnice.text);
    expect(cases.length, 'test/fixtures/attribution-cases.ts carries a prometnice case').toBeGreaterThan(0);
    const snapshots = [
      ...cases.map((c) => ({ snapshot: c.snapshot, item: c.item })),
      // WP6 step 8's own moment: the fetch of 21 Sep 17:36 Zagreb, and the same with a source time.
      { snapshot: { fetchedAt: '2026-09-21T15:36:00.000Z' }, item: undefined },
      { snapshot: { fetchedAt: '2026-09-21T15:36:00.000Z', sourceUpdatedAt: '2026-09-21T15:30:00.000Z' }, item: undefined },
    ];
    for (const { snapshot, item } of snapshots) {
      const text = fillAttribution(ATTRIBUTION.prometnice, snapshot, item);
      expect(text).not.toMatch(CLOCK);
      expect(text).not.toMatch(CHANGE_WITH_VALUE);
      expect(text).not.toMatch(/dohvaćeno/i);
    }
  });

  row('b-copies', 'now', 'every copy of the closures template carries no date placeholder and no "posljednja izmjena"', () => {
    const DATASET = "skup 'Zatvaranje prometnica na području Grada Zagreba'";
    for (const file of ['worker/feed/registry.ts', 'worker/open/catalog.ts', 'app/src/data/izvori.json']) {
      const copies = read(file).split('\n').filter((line) => line.includes(DATASET));
      expect(copies.length, `${file} carries the closures template`).toBeGreaterThan(0);
      for (const copy of copies) {
        const after = copy.slice(copy.indexOf(DATASET) + DATASET.length);
        expect(after, file).not.toMatch(/\{(datum|vrijeme)\}|posljednja izmjena/);
      }
    }
  });
});

// --- (c) pills ------------------------------------------------------------------------------

describe('(c) a cluster pill writes every line, never "+N" (P0.2, slop #26)', () => {
  const THIRTEEN = ['4', '5', '6', '7', '8', '11', '12', '13', '14', '15', '31', '33', '34'];
  // Every route of the fourteen Črnomerec platforms in app/public/data/stops.json (trams and
  // buses, all modes), copied here so a GTFS rebuild cannot change the case under the test.
  const CRNOMEREC_27 = [
    '2', '6', '11', '31', '109', '117', '119', '120', '121', '122', '123', '124', '125', '126',
    '127', '128', '130', '131', '134', '135', '136', '137', '144', '146', '172', '176', '177',
  ];

  row('c-pills', 'now', 'clusterLabel of 13 and of 27 labels contains no "+"; the 13-label pill is wider than a 4-character one', () => {
    expect(CRNOMEREC_27).toHaveLength(27);
    const label13 = clusterLabel(THIRTEEN);
    expect(label13).toBe(THIRTEEN.join('·'));
    expect(label13).not.toContain('+');
    expect(pillWidthPx(pillChars(label13))).toBeGreaterThan(pillWidthPx(4));
    const label27 = clusterLabel(CRNOMEREC_27);
    expect(label27).not.toContain('+');
    // Whatever fits is whole lines of the cluster, the lowest first.
    expect(label27.startsWith('2·6·11·31')).toBe(true);
    for (const line of label27.split('·')) expect(CRNOMEREC_27).toContain(line);
  });

  row('c-no-fold', 'now', 'app/src/motion/pills.ts keeps no fold: no CLUSTER_MAX_NUMBERS below 27 and no " +${…}" tail', () => {
    const code = withoutComments('app/src/motion/pills.ts', read('app/src/motion/pills.ts'));
    const cap = /CLUSTER_MAX_NUMBERS\s*=\s*(\d+)/.exec(code);
    if (cap) expect(Number(cap[1]), 'CLUSTER_MAX_NUMBERS').toBeGreaterThanOrEqual(27);
    expect(code).not.toContain(' +${');
  });
});

// --- (d) operator chrome on the wall --------------------------------------------------------

describe('(d) the wall renders no operator control (P0.5, [O-43], slop #16-17)', () => {
  const stillIn = (re: RegExp): string[] => [...WALL_CODE].filter(([, code]) => re.test(code)).map(([file]) => file);

  row('d-presentation', 'now', 'no control at the screen ends a presentation (no kiosk-stop-presentation, no stopPresentation call, no presentation.stop)', () => {
    expect(WALL_TS.length).toBeGreaterThan(10);
    expect(stillIn(wholeToken('kiosk-stop-presentation')), 'kiosk-stop-presentation').toEqual([]);
    expect(stillIn(/\bstopPresentation\b/), 'stopPresentation').toEqual([]);
    const reads = wallScan().keys.get('presentation.stop');
    expect(reads ? where(reads) : '', 'the wall reads presentation.stop ("Vrati pregled grada")').toBe('');
  });

  const RETIRED: ReadonlyArray<readonly [id: string, due: Due, what: string]> = [
    ['kiosk-settings', 'WP3', 'the header gear (settings open by a long press on kiosk-brand)'],
    ['kiosk-theme', 'WP3', 'the header theme button'],
    ['pause-highlights', 'WP1', 'the highlights pause button ("Zaustavi")'],
    ['pair-copy', 'WP1', 'the copy-code button'],
  ];
  for (const [id, due, what] of RETIRED) {
    row(`d-${id}`, due, `${what} is gone: no '${id}' in the wall's code`, () => {
      expect(stillIn(wholeToken(id)), id).toEqual([]);
    });
  }
});

// --- (e) the slop register's "out" strings --------------------------------------------------

describe('(e) the §13 "out" strings are absent outside their allowed files', () => {
  interface SlopOut { id: string; text: string; allowedIn: readonly string[]; scope: 'app' | 'wall'; due: Due; slop: number }
  /** Copied from WP6 step 8 (review.local/companion/code-reality/copy-audit.md §6 for the file:line). */
  const SLOP_OUT: readonly SlopOut[] = [
    { id: 'e-odaberi', text: 'Odaberi i spremi stajalište', allowedIn: [], scope: 'app', due: 'WP4', slop: 2 },
    { id: 'e-referentna', text: 'Gradska referentna točka', allowedIn: [], scope: 'app', due: 'WP4', slop: 1 },
    { id: 'e-upoznaj', text: 'Upoznaj ovo mjesto', allowedIn: [], scope: 'app', due: 'WP5', slop: 12 },
    { id: 'e-registra', text: 'Podatak iz registra, nije provjera uživo.', allowedIn: ['app/src/izvori-render.ts', 'app/src/data/izvori.json'], scope: 'app', due: 'WP5', slop: 13 },
    { id: 'e-nepotvrdeno', text: '? nepotvrđeno', allowedIn: [], scope: 'app', due: 'WP2', slop: 14 },
    { id: 'e-zaustavi', text: 'Zaustavi', allowedIn: [], scope: 'wall', due: 'WP1', slop: 16 },
    { id: 'e-sto-trazis', text: 'Što tražiš?', allowedIn: [], scope: 'app', due: 'WP5', slop: 9 },
    { id: 'e-zivi-grad', text: 'Živi grad', allowedIn: [], scope: 'app', due: 'WP5', slop: 10 },
    { id: 'e-sada-u-gradu', text: 'Sada u gradu.', allowedIn: [], scope: 'app', due: 'WP5', slop: 5 },
    { id: 'e-zatim', text: '"next": "Zatim"', allowedIn: [], scope: 'app', due: 'WP5', slop: 8 },
    // The phone's provenance may keep its fetch word ([O-27]); the wall never prints one.
    { id: 'e-dohvaceno', text: 'Dohvaćeno', allowedIn: [], scope: 'wall', due: 'WP5', slop: 15 },
  ];

  /** Files of app/src that carry `text`: JSON as written (so a `"key": "value"` row matches), TypeScript by its literals. */
  function appFilesWith(text: string): string[] {
    const json = APP_JSON.filter((file) => read(file).includes(text));
    const code = APP_TS.filter((file) => LITERALS.get(file)!.some((literal) => literal.includes(text)));
    return [...json, ...code].sort();
  }
  /** Wall strings that carry `text`, case-insensitively: a fetch word is the same slop at the start of a sentence or inside one. */
  function wallPlaces(text: string): string[] {
    const needle = text.toLocaleLowerCase('hr');
    return [...new Set(wallStrings().filter((s) => s.text.toLocaleLowerCase('hr').includes(needle)).map((s) => s.where))].sort();
  }

  for (const slop of SLOP_OUT) {
    const scopeWords = slop.scope === 'wall' ? 'on the wall (its code, the keys and city words it reads, every kiosk.* key)' : 'in app/src';
    const allowed = slop.allowedIn.length ? ` outside ${slop.allowedIn.join(', ')}` : '';
    row(slop.id, slop.due, `#${slop.slop} '${slop.text}' is absent ${scopeWords}${allowed}`, () => {
      const found = slop.scope === 'wall' ? wallPlaces(slop.text) : appFilesWith(slop.text);
      expect(found.filter((place) => !slop.allowedIn.some((file) => place.startsWith(file)))).toEqual([]);
    });
  }

  // Key-level (WP6 verdict 9): the two catalogue strings the verdict names (hr.json:553 and :723 at
  // b300af3) belong to the phone and the landing page; neither key, nor a kiosk twin of its words,
  // may reach the wall. A literal scan of app/src/kiosk/ alone would not see a key.
  row('e-zaustavi-key', 'now', "'Zaustavi osvježavanje' (session.pauseRefresh, the phone's refresh toggle) is no wall string", () => {
    const reads = wallScan().keys.get('session.pauseRefresh');
    expect(reads ? where(reads) : '', 'the wall reads session.pauseRefresh').toBe('');
    expect(wallStrings().filter((s) => /^zaustavi osvježavanje$/i.test(s.text)).map((s) => s.where)).toEqual([]);
  });

  row('e-dohvaceno-key', 'WP5', "'Dohvaćeno {time}' (landing.live.fetchedAt) is no wall string: no kiosk key prints a fetch time", () => {
    const reads = wallScan().keys.get('landing.live.fetchedAt');
    expect(reads ? where(reads) : '', 'the wall reads landing.live.fetchedAt').toBe('');
    expect(wallStrings().filter((s) => /^dohvaćeno \{time\}$/i.test(s.text)).map((s) => s.where)).toEqual([]);
  });
});

describe('(e) the pharmacy is a green cross, 24/7 and an address, not the words "Dežurna ljekarna" (slop #29, [O-39])', () => {
  row('e-pharmacy-keys', 'WP1', 'kiosk.safety.pharmacy and kiosk.basics.pharmacy are gone from hr.json, or no longer read "Dežurna ljekarna"', () => {
    for (const key of ['kiosk.safety.pharmacy', 'kiosk.basics.pharmacy']) {
      const value = leaf(HR, key);
      if (value !== undefined) expect(value, key).not.toMatch(/^\s*Dežurna ljekarna\s*:?\s*$/);
    }
  });

  row('e-pharmacy-strip', 'WP1', 'strip-pharmacy carries one [data-symbol=pharmacy] and no "Dežurna" in its text', () => {
    // Read through the module namespace, untyped: WP1 rewrites the footer, and a renamed builder
    // must turn this row red with a message, never break `npm run typecheck:tests`.
    const builders = frame as unknown as Record<string, ((...args: unknown[]) => unknown) | undefined>;
    const { frameStrip, stripMarkup } = builders;
    expect(typeof frameStrip === 'function' && typeof stripMarkup === 'function', 'app/src/kiosk/frame.ts no longer exports frameStrip/stripMarkup: point this row at the footer builder').toBe(true);
    const stop = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6'] };
    const strings = kioskStrings('hr');
    const strip = frameStrip!([], stop, createDefaultI18n('hr'), strings, Date.parse('2026-09-22T02:30:00Z'));
    // A private happy-dom window: the file runs in node, where fileURLToPath(import.meta.url) works.
    const host = new Window().document.createElement('div');
    host.innerHTML = String(stripMarkup!(strip, strings, { noBasics: true }));
    const pharmacy = host.querySelectorAll('[data-testid=strip-pharmacy]');
    expect(pharmacy, 'strip-pharmacy').toHaveLength(1);
    expect(pharmacy[0]!.querySelectorAll('[data-symbol=pharmacy]'), '[data-symbol=pharmacy] inside strip-pharmacy').toHaveLength(1);
    expect(pharmacy[0]!.textContent ?? '').not.toMatch(/Dežurna/);
  });
});

describe('(e) one word for the transport destination (slop #11, [O-51])', () => {
  /** The destination's one word. "Promet" survives only as the subject word (the kicker keys kiosk.say.transit, kiosk.ticker.transit), which this row leaves alone. */
  const TRANSPORT_TAB_WORD = 'Karta';

  row('e-tab-word', 'WP4', `the transport tab (layers.u-pokretu) reads '${TRANSPORT_TAB_WORD}'`, () => {
    expect(leaf(HR, 'layers.u-pokretu')).toBe(TRANSPORT_TAB_WORD);
  });

  row('e-tab-synonyms', 'WP5', `app/src/city/strings.ts names the transport surface '${TRANSPORT_TAB_WORD}' or not at all (no 'Kretanje', no 'Prijevoz i raspored')`, () => {
    const literals = LITERALS.get('app/src/city/strings.ts')!;
    expect(literals.filter((literal) => literal === 'Kretanje' || literal === 'Prijevoz i raspored')).toEqual([]);
  });
});

describe('(e) no real screen secret is written down in the repository', () => {
  // A screen URL's fragment is `#<8-character code>.<secret>`; a real secret is at least 24
  // characters, so the short fake ones of the fixtures (s3cr3t-part, nova, S3CR3TXYZ) never match.
  const SECRET = /kiosk\/#[0-9A-HJKMNP-TV-Z]{8}\.[A-Za-z0-9_-]{24,}/;
  const DIRS = ['e2e', 'scripts', 'docs', 'test'];
  const SKIP = ['docs/superpowers'];

  row('e-secret', 'now', `no ${SECRET.source} in ${DIRS.join(', ')} (docs/superpowers excluded)`, () => {
    // The pattern itself must fire on a real-shaped URL, built here so this file never holds one.
    expect(SECRET.test(`https://example.test/kiosk/#${'K7M2P9QX'}.${'a'.repeat(12)}${'B_-9'.repeat(4)}`)).toBe(true);
    expect(SECRET.test('https://example.test/kiosk/#K7M2P9QX.s3cr3t-part')).toBe(false);
    const hits: string[] = [];
    for (const dir of DIRS) {
      for (const file of walk(dir, () => true, SKIP)) {
        const bytes = readFileSync(join(ROOT, file));
        if (bytes.includes(0)) continue; // binary (frames, fonts, images)
        const text = bytes.toString('utf8');
        const match = SECRET.exec(text);
        if (match) hits.push(`${file}:${text.slice(0, match.index).split('\n').length}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
