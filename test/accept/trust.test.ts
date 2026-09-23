// WP6 step 8: the trust and slop guards of the companion plan
// (docs/companion-2026-09-22.md §7 P0 items, §13 slop register, §15), as one
// accept-tier file: `npm run accept -- test/accept/trust.test.ts`. Rows whose
// package has landed are green now and must stay green; the others are red by
// design until their package lands (never `skip` one). Each row names the
// package that turns it green, and the file prints the red list when it ends,
// the way test/accept/probes.test.ts does.
//
//   (a) every literal i18n key resolves in both catalogues (seam S8's scanner, test/app/i18n-scan.ts)
//   (b) the closures attribution prints no clock time: all three copies of the template, rendered alike
//   (c) a cluster pill writes its lines, never a "+N" count
//   (d) the wall renders no operator control: the invitation and a presentation mounted here offer
//       only the permitted controls, and no control or key ends a presentation; source scans supplement
//   (e) the §13 "out" strings are absent outside their allowed files; the pharmacy is a symbol, 24/7
//       and an address, not the label "Dežurna ljekarna:"; no fetch time and no "Zaustavi" is a wall
//       string; one word for the transport tab; no real screen secret in e2e/, scripts/, docs/ or test/
//
// The source scans are proxies (a string in the code, a key the wall reads);
// e2e/accept/wall.spec.ts and phone.spec.ts check the rendered DOM in a browser.
// Fold-back rule (vitest.config.ts): when a row is green for good it moves to the unit tier.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fillAttribution } from '../../app/src/attribution';
import { BEACON_STORAGE_KEY } from '../../app/src/beacon';
import { createBoardCache } from '../../app/src/city/boards';
import { ct, type CityWord } from '../../app/src/city/strings';
import izvori from '../../app/src/data/izvori.json';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import * as kioskModule from '../../app/src/kiosk';
import * as frame from '../../app/src/kiosk/frame';
import { kioskStrings } from '../../app/src/kiosk/strings';
import { clusterLabel, pillChars, pillWidthPx } from '../../app/src/motion/pills';
import type { ThemeController, ThemePreference } from '../../app/src/ui/theme';
import { ATTRIBUTION } from '../../worker/feed/registry';
import type { Attribution, ModuleSnapshot } from '../../worker/feed/schema';
import { fillAttribution as fillAttributionServer } from '../../worker/open/attribution';
import { OPEN_DATASETS } from '../../worker/open/catalog';
import { fakeCityStore } from '../city/fake-store';
import { ATTRIBUTION_CASES } from '../fixtures/attribution-cases';
import { emptyScan, scanI18n, scanI18nSource, type I18nRef, type I18nScan } from '../app/i18n-scan';
import { FIXTURE_PHARMACY_ADDRESSES } from '../../e2e/experience-fixtures';
import { pharmacyFailures } from '../../e2e/wall';

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
/** The static HTML entries Vite serves: app/*.html and every app/<dir>/index.html (app/dist is output). */
const STATIC_HTML = [
  ...readdirSync(join(ROOT, 'app')).filter((name) => name.endsWith('.html')).map((name) => `app/${name}`),
  ...readdirSync(join(ROOT, 'app'))
    .filter((dir) => dir !== 'dist' && statSync(join(ROOT, 'app', dir)).isDirectory() && readdirSync(join(ROOT, 'app', dir)).includes('index.html'))
    .map((dir) => `app/${dir}/index.html`),
].sort();
/** The wall's own code: app/src/kiosk*.ts and everything under app/src/kiosk/. */
const WALL_TS = APP_TS.filter((file) => /^app\/src\/kiosk[^/]*\.ts$/.test(file) || file.startsWith('app/src/kiosk/'));
const LITERALS = new Map(APP_TS.map((file) => [file, stringLiterals(file, read(file))] as const));
const WALL_CODE = new Map(WALL_TS.map((file) => [file, withoutComments(file, read(file))] as const));

/** One string a surface can print: the file it lives in (exact, repository-relative), where in it, and the text. */
interface Place { file: string; where: string; text: string }

/** Every string value of a parsed JSON document, with its dotted path (array indices included). */
function jsonStrings(node: unknown, path = ''): Array<[path: string, text: string]> {
  if (typeof node === 'string') return [[path, node]];
  if (node && typeof node === 'object') return Object.entries(node as Catalogue).flatMap(([k, v]) => jsonStrings(v, path ? `${path}.${k}` : k));
  return [];
}
/** Every text node and attribute value of an HTML document, parsed (so markup and entities never count as copy). */
function htmlStrings(html: string): string[] {
  const out: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === 3) out.push(node.textContent ?? '');
    if (node.nodeType === 1) for (const attr of Array.from((node as Element).attributes)) out.push(attr.value);
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  visit(new DOMParser().parseFromString(html, 'text/html').documentElement);
  return out.filter((text) => text.trim() !== '');
}

let appStringsMemo: Place[] | undefined;
/**
 * Every string the app can print, read the way it is printed: the parsed values of every JSON file
 * under app/src (the two catalogues, app/src/data/*.json), the string literals of every TypeScript
 * file under app/src (comments never count), and the text and attribute values of the static HTML.
 */
function appStrings(): Place[] {
  if (appStringsMemo) return appStringsMemo;
  const out: Place[] = [];
  for (const file of APP_JSON) for (const [path, text] of jsonStrings(JSON.parse(read(file)))) out.push({ file, where: `${file} ${path}`, text });
  for (const file of APP_TS) for (const text of LITERALS.get(file)!) out.push({ file, where: file, text });
  for (const file of STATIC_HTML) for (const text of htmlStrings(read(file))) out.push({ file, where: file, text });
  appStringsMemo = out;
  return out;
}

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
const HR_FILE = 'app/src/i18n/hr.json';

let wallStringsMemo: Place[] | undefined;
/**
 * Every Croatian string the wall can print, as far as a source scan can tell: the string literals
 * of its code, the hr value of every key and city word its code reads (a dynamic prefix brings every
 * key under it), and every kiosk.* leaf of hr.json, read or not.
 */
function wallStrings(): Place[] {
  if (wallStringsMemo) return wallStringsMemo;
  const out: Place[] = [];
  for (const file of WALL_TS) for (const text of LITERALS.get(file)!) out.push({ file, where: file, text });
  const scan = wallScan();
  for (const [key, refs] of scan.keys) {
    const value = leaf(HR, key);
    if (value !== undefined) out.push({ file: HR_FILE, where: `hr.json ${key} (read at ${where(refs)})`, text: value });
  }
  for (const [base, refs] of scan.plurals) {
    for (const [key, value] of HR_LEAVES) if (key.startsWith(`${base}_`)) out.push({ file: HR_FILE, where: `hr.json ${key} (read at ${where(refs)})`, text: value });
  }
  for (const [prefix, refs] of scan.dynamic) {
    if (!prefix) continue;
    for (const [key, value] of HR_LEAVES) if (key.startsWith(prefix)) out.push({ file: HR_FILE, where: `hr.json ${key} (read as ${prefix}… at ${where(refs)})`, text: value });
  }
  for (const [word, refs] of scan.cityWords) {
    out.push({ file: 'app/src/city/strings.ts', where: `app/src/city/strings.ts ${word} (read at ${where(refs)})`, text: ct(HR_I18N, word as CityWord) });
  }
  for (const [key, value] of HR_LEAVES) if (key.startsWith('kiosk.')) out.push({ file: HR_FILE, where: `hr.json ${key}`, text: value });
  wallStringsMemo = out;
  return out;
}

// --- A mounted wall (the harness of test/app/kiosk.test.ts, cut to what the (d) rows need) ----

// The file runs in node (the S8 scanner resolves its root from a file: URL, which the web
// transform of a happy-dom environment rewrites), so the DOM the wall and the HTML parser need is a
// happy-dom window whose globals are installed for the file's tests and removed after them: every
// global node lacks, plus the DOM's own window, document, navigator, location and event classes.
const DOM_OVERRIDES = new Set(['window', 'self', 'document', 'navigator', 'location', 'Event', 'CustomEvent', 'EventTarget']);
let removeDom: (() => void) | null = null;
beforeAll(() => {
  const win = new Window({ url: 'https://example.test/kiosk/', width: 1920, height: 1080 });
  const names = new Set<string>();
  for (let o: object | null = win; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const name of Object.getOwnPropertyNames(o)) names.add(name);
  names.add('window');
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const name of names) {
    if (name === 'constructor' || (name in globalThis && !DOM_OVERRIDES.has(name))) continue;
    let value: unknown;
    try { value = name === 'window' || name === 'self' ? win : (win as unknown as Record<string, unknown>)[name]; } catch { continue; }
    // Methods (requestAnimationFrame, matchMedia, getComputedStyle) keep the window as `this`; classes stay as they are.
    if (typeof value === 'function' && !/^[A-Z]/.test(name)) value = (value as (...args: unknown[]) => unknown).bind(win);
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  removeDom = () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
    void win.happyDOM.close();
  };
});
afterAll(() => { removeDom?.(); });

const WALL_NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb
const WALL_STOP = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '11', '12', '13', '14', '17'] };
const WALL_SCREEN = { kind: 'temporary', expiresAt: WALL_NOW + 20 * 3_600_000, stop: WALL_STOP, area: 'gornji-grad-medvescak' };
const CODE_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const flush = async (): Promise<void> => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

function wallSnapshot(module: ModuleSnapshot['module'], items: ModuleSnapshot['items']): ModuleSnapshot {
  return { module, tier: 'open', status: 'live', fetchedAt: new Date(WALL_NOW - 30_000).toISOString(), attribution: { text: 'Izvor: test', url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' }, items };
}
const WALL_MODULES: ModuleSnapshot[] = [
  wallSnapshot('zet-rt', [
    { id: 'vozila', module: 'zet-rt', kind: 'vehicle', tier: 'open', title: '156 vozila u pokretu', data: { vehicles: 156 } },
    { id: 'vehicle:1', module: 'zet-rt', kind: 'vehicle', tier: 'open', title: '6', at: '2026-09-11T12:31:40Z', geo: { type: 'Point', coordinates: [15.977, 45.813] }, data: { routeId: '6', routeType: 0 } },
  ]),
  wallSnapshot('dhmz-cap', []),
  wallSnapshot('emsc', []),
  wallSnapshot('prometnice', []),
];

function fakeTheme(): ThemeController {
  let preference: ThemePreference = 'solar';
  const listeners = new Set<(state: { preference: ThemePreference; resolved: 'light' | 'dark' }) => void>();
  return {
    getPreference: () => preference,
    getResolvedTheme: () => 'light',
    setPreference(next) { preference = next; for (const l of listeners) l({ preference, resolved: 'light' }); },
    onChange(listener) { listeners.add(listener); listener({ preference, resolved: 'light' }); return () => { listeners.delete(listener); }; },
    destroy() { listeners.clear(); },
  };
}

type Handler = ((...args: unknown[]) => void) | undefined;
interface MountedWall {
  root: HTMLElement;
  phase(): string;
  destroy(): void;
  handlers: Record<string, Handler>;
  /** Every beacon command the wall sent, by name (stopPresentation, close, …). */
  beaconCalls: string[];
  screensCreated: () => number;
}

/**
 * The kiosk controller with every dependency faked, a stored screen at Trg bana J. Jelačića and a
 * batch of codes: the invitation. mountKiosk is read through the module namespace and the deps are
 * passed untyped, so a rewrite of the controller turns these rows red with a message instead of
 * breaking `npm run typecheck:tests`.
 */
async function mountWall(): Promise<MountedWall> {
  const mount = (kioskModule as unknown as Record<string, unknown>).mountKiosk;
  if (typeof mount !== 'function') throw new Error('app/src/kiosk.ts no longer exports mountKiosk: point the (d) rows at the wall mount');
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const raw: Record<string, string> = { [BEACON_STORAGE_KEY]: JSON.stringify({ beaconId: 'BEACON01', secret: 'tajna', screen: WALL_SCREEN }) };
  // The beacon answers the calls a showing wall makes (connect, requestMore, status, acknowledge);
  // any other command, whatever its name (close, setScreen, a stop or release of the presentation),
  // is recorded, so a renamed handler cannot hide one.
  const beaconCalls: string[] = [];
  const quiet: Record<string, () => unknown> = { connect: () => {}, requestMore: () => {}, status: () => 'live', acknowledgePresentation: () => {} };
  const beacon = new Proxy(quiet, {
    get: (target, name) => (typeof name === 'string' && !(name in target) && name !== 'then' ? () => { beaconCalls.push(name); } : target[name as string]),
  });
  let handlers: Record<string, Handler> | null = null;
  let created = 0;
  const handle = (mount as (root: HTMLElement, deps: unknown) => { phase(): string; destroy(): void })(root, {
    cityStore: fakeCityStore(), i18n: createDefaultI18n('hr'), hash: '', now: () => WALL_NOW, codeBase: 'https://example.test',
    storage: { getItem: (k: string) => raw[k] ?? null, setItem: (k: string, v: string) => { raw[k] = v; }, removeItem: (k: string) => { delete raw[k]; } },
    onRepaint: () => () => {}, reducedMotion: true, lightweight: false, viewport: { width: 1920, height: 1080 },
    fetchTeaser: async () => ({ modules: WALL_MODULES }), loadNetwork: async () => null,
    fetchData: async (module: string) => WALL_MODULES.find((m) => m.module === module) ?? wallSnapshot(module as ModuleSnapshot['module'], []),
    createScreen: async () => { created += 1; throw new Error('no screen is created by a trust row'); },
    loadStops: async () => [WALL_STOP], loadLastRun: async () => null,
    createBoards: () => createBoardCache({ fetchImpl: (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof globalThis.fetch }),
    theme: fakeTheme(),
    createBeacon: (deps: Record<string, Handler>) => { handlers = deps; return beacon; },
    createSession: () => { throw new Error('no session is joined by a trust row'); },
    setInterval: () => ({}), clearInterval: () => {},
    requestFullscreen: async () => {}, requestWakeLock: async () => {},
  });
  await flush();
  if (!handlers) throw new Error('the wall never created its beacon');
  const codes = Array.from({ length: 20 }, (_, i) => ({ code: `ABCDEFG${CODE_CHARS[i]}`, slotStart: WALL_NOW + i * 30_000, slotEnd: WALL_NOW + (i + 1) * 30_000 }));
  (handlers as Record<string, Handler>).onCodes?.(codes, WALL_NOW);
  await flush();
  return { root, phase: () => handle.phase(), destroy: () => handle.destroy(), handlers, beaconCalls, screensCreated: () => created };
}

/** A presentation of line 6, as a phone asks for one. */
async function present(wall: MountedWall): Promise<void> {
  wall.handlers.onPresentation?.({ version: 1, revision: 1, target: { layer: 'u-pokretu', selection: { kind: 'route', id: '6' } }, expiresAt: WALL_NOW + 600_000, dataToken: 'dt' });
  await flush();
}

/** Anything a person can press, type into or tab to. A control under `hidden`, `inert` or a closed dialog is not rendered. */
const INTERACTIVE = [
  'button', 'a[href]', 'input', 'select', 'textarea', 'summary', '[contenteditable=""]', '[contenteditable=true]',
  '[role=button]', '[role=link]', '[role=switch]', '[role=checkbox]', '[role=tab]', '[role=menuitem]',
  '[tabindex]:not([tabindex="-1"])', '[data-action]',
].join(', ');
/**
 * What the wall may offer a passer-by [O-43]: the brand (settings open by a long press on it) and the
 * QR. The read-only touch of [O-58] (a stop ring, a row, the pharmacy: details that close by
 * themselves) joins this list when D3 lands.
 */
const PERMITTED_WALL_CONTROLS = '[data-testid=kiosk-brand], [data-testid=kiosk-qr]';
function wallControls(root: Element): Element[] {
  return Array.from(root.querySelectorAll(INTERACTIVE)).filter((el) => !el.closest('[hidden], [inert], dialog:not([open])'));
}
function describeControl(el: Element): string {
  const id = el.getAttribute('data-testid');
  const action = el.getAttribute('data-action');
  const cls = el.getAttribute('class')?.split(/\s+/)[0];
  const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
  return `${el.tagName.toLowerCase()}${id ? `[data-testid=${id}]` : ''}${action ? `[data-action=${action}]` : ''}${!id && !action && cls ? `.${cls}` : ''}${label ? ` "${label}"` : ''}`;
}
const unpermitted = (root: Element): string[] => wallControls(root).filter((el) => !el.closest(PERMITTED_WALL_CONTROLS)).map(describeControl);

// --- The row register and the red list ------------------------------------------------------

/** 'now': the package has landed and the row must be green; otherwise the package that turns it green. */
type Due = 'now' | 'WP1' | 'WP2' | 'WP3' | 'WP4' | 'WP5' | 'WP1·WP3';
interface RowResult { id: string; due: Due; title: string; ok: boolean }
const results: RowResult[] = [];

/** One accept row: an `it` whose title carries the row id and its due package, recorded for the summary. */
function row(id: string, due: Due, title: string, body: () => void | Promise<void>): void {
  it(`${id} [${due === 'now' ? 'green now' : `red until ${due}`}] ${title}`, async () => {
    try {
      await body();
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
  const line = (r: RowResult): string => `  ${r.id.padEnd(22)} ${(r.due === 'now' ? '' : r.due).padEnd(7)} ${r.title}`;
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
  const CLOCK = /\b\d{1,2}[:.]\d{2}\b/;
  const CHANGE_WITH_VALUE = /posljednja izmjena\s*\S/;
  /** The three copies of the closures template: the feed's (wall, phone), /open's and /izvori's. */
  const TEMPLATES: ReadonlyArray<readonly [file: string, attribution: Attribution | undefined]> = [
    ['worker/feed/registry.ts', ATTRIBUTION.prometnice],
    ['worker/open/catalog.ts', OPEN_DATASETS.find((d) => d.module === 'prometnice')?.source],
    ['app/src/data/izvori.json', izvori.sources.find((source) => source.module === 'prometnice')],
  ];
  /** The fixture's prometnice snapshots, WP6 step 8's own fetch of 21 Sep 17:36 Zagreb, and the same with a source time. */
  const SNAPSHOTS: ReadonlyArray<Pick<ModuleSnapshot, 'sourceUpdatedAt' | 'fetchedAt'>> = [
    ...ATTRIBUTION_CASES.filter((c) => c.attribution.text === ATTRIBUTION.prometnice.text).map((c) => c.snapshot),
    { fetchedAt: '2026-09-21T15:36:00.000Z' },
    { fetchedAt: '2026-09-21T15:36:00.000Z', sourceUpdatedAt: '2026-09-21T15:30:00.000Z' },
  ];

  row('b-templates', 'now', 'each whole copy of the closures template (registry, /open catalogue, izvori.json) holds no placeholder, no clock time and no "posljednja izmjena"', () => {
    for (const [file, attribution] of TEMPLATES) {
      expect(attribution?.text, `${file} carries the closures template`).toBeTypeOf('string');
      const text = attribution!.text;
      expect(text, file).not.toMatch(/[{}]/);
      expect(text, file).not.toMatch(CLOCK);
      expect(text, file).not.toMatch(/posljednja izmjena|dohvaćeno/i);
    }
  });

  row('b-rendered', 'now', 'the three copies render alike through both fillAttribution copies, with no HH:MM, no fetch time and no "posljednja izmjena" value', () => {
    expect(SNAPSHOTS.length, 'test/fixtures/attribution-cases.ts carries a prometnice case').toBeGreaterThan(2);
    for (const snapshot of SNAPSHOTS) {
      const rendered = TEMPLATES.flatMap(([file, attribution]) => [
        [`${file} (browser copy)`, fillAttribution(attribution!, snapshot)],
        [`${file} (server copy)`, fillAttributionServer(attribution!, snapshot)],
      ] as const);
      const reference = rendered[0]![1];
      for (const [label, text] of rendered) {
        expect(text, `${label} renders as the registry does`).toBe(reference);
        expect(text, label).not.toMatch(CLOCK);
        expect(text, label).not.toMatch(CHANGE_WITH_VALUE);
        expect(text, label).not.toMatch(/dohvaćeno/i);
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
  row('d-presentation', 'now', 'no control and no key at the screen ends a presentation: every control of the presented wall pressed, Escape pressed, the presentation stands', async () => {
    const wall = await mountWall();
    // A pressed link or form must not navigate the test page; what it would reach is not the question here.
    const block = (event: Event): void => { if (event.type === 'submit' || (event.target as Element | null)?.closest?.('a[href]')) event.preventDefault(); };
    document.addEventListener('click', block, true);
    document.addEventListener('submit', block, true);
    try {
      await present(wall);
      expect(wall.phase(), 'the presentation is shown').toBe('paired');
      const pressed = new Set<Element>();
      for (let round = 0; round < 3; round += 1) {
        const fresh = wallControls(wall.root).filter((el) => !pressed.has(el));
        if (!fresh.length) break;
        for (const control of fresh) {
          pressed.add(control);
          (control as HTMLElement).click();
          await flush();
        }
      }
      for (const target of [document, wall.root]) target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
      expect(wall.beaconCalls, 'beacon commands sent while pressing the wall').toEqual([]);
      expect(wall.screensCreated(), 'screens created').toBe(0);
      expect(wall.phase(), `the presentation still stands after ${pressed.size} controls were pressed`).toBe('paired');
    } finally {
      document.removeEventListener('click', block, true);
      document.removeEventListener('submit', block, true);
      wall.destroy();
    }
  });

  row('d-controls-invitation', 'WP1·WP3', 'the invitation offers no control but the brand (long press) and the QR', async () => {
    const wall = await mountWall();
    try {
      expect(wall.phase()).toBe('invitation');
      expect(unpermitted(wall.root)).toEqual([]);
    } finally { wall.destroy(); }
  });

  row('d-controls-presentation', 'WP1·WP3', 'a presentation offers no control but the brand (long press) and the QR', async () => {
    const wall = await mountWall();
    try {
      await present(wall);
      expect(wall.phase()).toBe('paired');
      expect(unpermitted(wall.root)).toEqual([]);
    } finally { wall.destroy(); }
  });

  row('d-controls-rule', 'now', 'the control count reads buttons, links, fields, roles, tab stops and data-action targets, and skips what is not rendered', () => {
    const host = document.createElement('div');
    host.innerHTML = [
      '<button data-testid="kiosk-brand">Kaj ima?</button><a data-testid="kiosk-qr" href="/s/"><img alt=""></a>',
      '<button class="x">x</button><span role="button">y</span><div tabindex="0">z</div><p data-action="go">w</p><a href="/hitno">h</a>',
      '<div hidden><button>hidden</button></div><dialog><button>closed</button></dialog><div tabindex="-1">not a stop</div>',
    ].join('');
    expect(unpermitted(host)).toEqual(['button.x "x"', 'span "y"', 'div "z"', 'p[data-action=go] "w"', 'a "h"']);
  });

  // Supplement: the retired names stay out of the wall's code (comments do not count).
  const stillIn = (re: RegExp): string[] => [...WALL_CODE].filter(([, code]) => re.test(code)).map(([file]) => file);

  row('d-presentation-source', 'now', 'the wall code names no kiosk-stop-presentation, calls no stopPresentation and reads no presentation.stop', () => {
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
  interface SlopOut {
    id: string;
    text: string;
    /** 'includes': anywhere in a string; 'exact': a whole string (a segment word such as "Zatim"). */
    match: 'includes' | 'exact';
    /** Repository-relative files that may keep it, compared exactly. */
    allowedIn: readonly string[];
    scope: 'app' | 'wall';
    due: Due;
    slop: number;
  }
  /** WP6 step 8's table (file:line in review.local/companion/code-reality/copy-audit.md §6), reconciled with §13. */
  const SLOP_OUT: readonly SlopOut[] = [
    { id: 'e-odaberi', text: 'Odaberi i spremi stajalište', match: 'includes', allowedIn: [], scope: 'app', due: 'WP4', slop: 2 },
    { id: 'e-referentna', text: 'Gradska referentna točka', match: 'includes', allowedIn: [], scope: 'app', due: 'WP4', slop: 1 },
    { id: 'e-upoznaj', text: 'Upoznaj ovo mjesto', match: 'includes', allowedIn: [], scope: 'app', due: 'WP5', slop: 12 },
    { id: 'e-obuhvat', text: 'Obuhvat zaštite, ne ulaz', match: 'includes', allowedIn: [], scope: 'app', due: 'WP5', slop: 12 },
    // Once on /izvori, never on the wall [O-27]; WP5 moves it into the page's static HTML (its step 9).
    { id: 'e-registra', text: 'Podatak iz registra, nije provjera uživo.', match: 'includes', allowedIn: ['app/izvori/index.html'], scope: 'app', due: 'WP5', slop: 13 },
    { id: 'e-nepotvrdeno', text: '? nepotvrđeno', match: 'includes', allowedIn: [], scope: 'app', due: 'WP2', slop: 14 },
    { id: 'e-zaustavi', text: 'Zaustavi', match: 'includes', allowedIn: [], scope: 'wall', due: 'WP1', slop: 16 },
    { id: 'e-sto-trazis', text: 'Što tražiš?', match: 'includes', allowedIn: [], scope: 'app', due: 'WP5', slop: 9 },
    { id: 'e-zivi-grad', text: 'Živi grad', match: 'includes', allowedIn: [], scope: 'app', due: 'WP5', slop: 10 },
    { id: 'e-sada-u-gradu', text: 'Sada u gradu.', match: 'includes', allowedIn: [], scope: 'app', due: 'WP5', slop: 5 },
    // The "Zatim" segment (timeband.next): the word alone as a string, not "Zatim uzmi grad sa sobom." (landing).
    { id: 'e-zatim', text: 'Zatim', match: 'exact', allowedIn: [], scope: 'app', due: 'WP5', slop: 8 },
    // The phone's provenance may keep its fetch word ([O-27]); the wall never prints one.
    { id: 'e-dohvaceno', text: 'Dohvaćeno', match: 'includes', allowedIn: [], scope: 'wall', due: 'WP5', slop: 15 },
  ];

  /** Case-insensitive on the wall (a fetch word is the same slop at the start of a sentence or inside one), as written in app/src. */
  function matches(slop: SlopOut, text: string): boolean {
    const [hay, needle] = slop.scope === 'wall' ? [text.toLocaleLowerCase('hr'), slop.text.toLocaleLowerCase('hr')] : [text, slop.text];
    return slop.match === 'exact' ? hay.trim() === needle : hay.includes(needle);
  }

  row('e-scan-reads', 'now', 'the app scan reads parsed catalogue values, TypeScript literals and the static HTML, not file text', () => {
    const files = new Set(appStrings().map((place) => place.file));
    for (const file of ['app/src/i18n/hr.json', 'app/src/i18n/en.json', 'app/src/data/izvori.json', 'app/src/city/strings.ts', 'app/izvori/index.html', 'app/kiosk/index.html']) {
      expect(files.has(file), file).toBe(true);
    }
    // A value, not the JSON around it: the hr.json segment word is read as "Zatim" under its key.
    expect(appStrings().filter((place) => place.where === 'app/src/i18n/hr.json timeband.next').map((place) => place.text)).toEqual([leaf(HR, 'timeband.next')]);
    // Markup never reads as copy.
    expect(htmlStrings('<p class="x">Tekst &amp; <b>još</b></p><!-- komentar -->')).toEqual(['x', 'Tekst & ', 'još']);
  });

  for (const slop of SLOP_OUT) {
    const scopeWords = slop.scope === 'wall' ? 'on the wall (its code, the keys and city words it reads, every kiosk.* key)' : 'in app/src and the static HTML';
    const allowed = slop.allowedIn.length ? ` outside ${slop.allowedIn.join(', ')}` : '';
    const shown = slop.match === 'exact' ? `'${slop.text}' as a whole string` : `'${slop.text}'`;
    row(slop.id, slop.due, `#${slop.slop} ${shown} is absent ${scopeWords}${allowed}`, () => {
      const places = (slop.scope === 'wall' ? wallStrings() : appStrings()).filter((place) => matches(slop, place.text));
      const outside = places.filter((place) => !slop.allowedIn.includes(place.file)).map((place) => place.where);
      expect([...new Set(outside)].sort()).toEqual([]);
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

describe('(e) the pharmacy is a green cross, 24/7 and an address, not the label "Dežurna ljekarna:" (slop #29, [O-39])', () => {
  /** The bare label as each catalogue writes it; "Dežurna ljekarna 24/7: {address}" (WP1's sentence and aria) is not one. */
  const BARE_LABEL: ReadonlyArray<readonly [locale: string, catalogue: Catalogue, label: RegExp]> = [
    ['hr', HR, /^\s*Dežurna ljekarna\s*:?\s*$/i],
    ['en', EN, /^\s*On-duty pharmacy\s*:?\s*$/i],
  ];
  /** The on-duty pharmacy nearest the fixture stop, as worker/hitno/ljekarne.ts writes it: its label and its address (e2e/experience-fixtures.ts). */
  const FIXTURE_PHARMACY = FIXTURE_PHARMACY_ADDRESSES;

  /**
   * What keeps a strip-pharmacy element from being the green cross, 24/7 and the address (empty = it is). The rule
   * itself is e2e/wall.ts pharmacyFailures, the one the wall spec's readings are judged by, so the tiers cannot drift.
   */
  function pharmacyIssues(strip: Element | null, addresses: readonly string[]): string[] {
    if (!strip) return ['no [data-testid=strip-pharmacy]'];
    return pharmacyFailures({ symbols: strip.querySelectorAll('[data-symbol=pharmacy]').length, text: strip.textContent ?? '' }, addresses);
  }
  const stripOf = (markup: string): Element | null => {
    const host = document.createElement('div');
    host.innerHTML = markup;
    return host.querySelector('[data-testid=strip-pharmacy]');
  };

  row('e-pharmacy-rule', 'now', 'the rule passes the cross with 24/7 and the address (with or without "Dežurna ljekarna 24/7:") and fails the label, an empty cross and two crosses', () => {
    const cross = '<svg data-symbol="pharmacy" aria-label="Dežurna ljekarna 24/7: Trg bana J. Jelačića 3"></svg>';
    expect(pharmacyIssues(stripOf(`<span data-testid="strip-pharmacy">${cross} 24/7 Trg bana J. Jelačića 3</span>`), FIXTURE_PHARMACY)).toEqual([]);
    expect(pharmacyIssues(stripOf(`<span data-testid="strip-pharmacy">${cross} Dežurna ljekarna 24/7: Trg bana Josipa Jelačića 3</span>`), FIXTURE_PHARMACY)).toEqual([]);
    // Today's strip: the label, a colon, the address; no cross, no hours.
    expect(pharmacyIssues(stripOf('<span data-testid="strip-pharmacy">Dežurna ljekarna: <strong>Trg bana J. Jelačića 3</strong></span>'), FIXTURE_PHARMACY))
      .toEqual(['0 [data-symbol=pharmacy], not 1', 'no "24/7"', 'the label "Dežurna ljekarna:"']);
    expect(pharmacyIssues(stripOf(`<span data-testid="strip-pharmacy">${cross}</span>`), FIXTURE_PHARMACY)).toEqual(['no "24/7"', 'no address']);
    expect(pharmacyIssues(stripOf(`<span data-testid="strip-pharmacy">${cross}${cross} 24/7 Trg bana J. Jelačića 3</span>`), FIXTURE_PHARMACY)).toEqual(['2 [data-symbol=pharmacy], not 1']);
    expect(pharmacyIssues(stripOf(`<span data-testid="strip-pharmacy">${cross} Dežurna ljekarna: Trg bana J. Jelačića 3, 24/7</span>`), FIXTURE_PHARMACY)).toEqual(['the label "Dežurna ljekarna:"']);
    expect(pharmacyIssues(stripOf('<span></span>'), FIXTURE_PHARMACY)).toEqual(['no [data-testid=strip-pharmacy]']);
  });

  row('e-pharmacy-keys', 'WP1', 'kiosk.safety.pharmacy and kiosk.basics.pharmacy are gone from hr.json and en.json, or are no longer the bare label', () => {
    for (const [locale, catalogue, label] of BARE_LABEL) {
      for (const key of ['kiosk.safety.pharmacy', 'kiosk.basics.pharmacy']) {
        const value = leaf(catalogue, key);
        if (value !== undefined) expect(value, `${key} (${locale})`).not.toMatch(label);
      }
    }
  });

  row('e-pharmacy-strip', 'WP1', 'the rendered strip-pharmacy is one [data-symbol=pharmacy], "24/7" and the fixture address, without the label "Dežurna ljekarna:"', () => {
    // Read through the module namespace, untyped: WP1 rewrites the footer, and a renamed builder
    // must turn this row red with a message, never break `npm run typecheck:tests`.
    const builders = frame as unknown as Record<string, ((...args: unknown[]) => unknown) | undefined>;
    const { frameStrip, stripMarkup } = builders;
    expect(typeof frameStrip === 'function' && typeof stripMarkup === 'function', 'app/src/kiosk/frame.ts no longer exports frameStrip/stripMarkup: point this row at the footer builder').toBe(true);
    const strings = kioskStrings('hr');
    // 04:30 in Zagreb, at Trg bana J. Jelačića: the night the pharmacy row is for.
    const strip = frameStrip!([], WALL_STOP, createDefaultI18n('hr'), strings, Date.parse('2026-09-22T02:30:00Z'));
    const host = document.createElement('div');
    host.innerHTML = String(stripMarkup!(strip, strings, { noBasics: true }));
    expect(host.querySelectorAll('[data-testid=strip-pharmacy]'), 'strip-pharmacy').toHaveLength(1);
    expect(pharmacyIssues(host.querySelector('[data-testid=strip-pharmacy]'), FIXTURE_PHARMACY)).toEqual([]);
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
