// Seam S8 (docs/companion-2026-09-22.md §15.2): the one scanner of i18n key
// references in app/src. WP0's test/app/i18n-keys.test.ts (every referenced
// key exists) and WP5's test/app/i18n-orphans.test.ts (every catalogue key is
// referenced) both import it, so the two can never disagree about what
// "referenced" means.
//
// It reads the TypeScript syntax tree (the repository's own `typescript`), not
// raw text, so comments never count and a ternary's condition is never taken
// for a key. What counts as a reference:
//   - a literal first argument of any `.t(…)` call (`i18n.t('k')`, `ctx.i18n.t('k')`);
//   - a local wrapper such as `const t = (key) => escapeHtml(i18n.t(\`presentation.${key}\`))`
//     (app/src/experience/presentation.ts; the prefix is read from the wrapper) or the
//     pass-through `const t = (key) => i18n.t(key)` of app/src/kiosk/strings.ts and
//     app/src/experience/timeband.ts;
//   - app/src/kiosk/strings.ts `group('name', ['a', …])` (kiosk.name.a), `forms('name', 'base')`
//     (a plural base) and `record([...], (k) => \`prefix${k}\`)`;
//   - `tr(i18n, 'k')` (transport.k), `trPlural(i18n, 'base', n)` (a plural base under
//     transport.) and `ct(i18n, 'k')` (a word of app/src/city/strings.ts, not a catalogue key);
//   - `data-i18n`, `data-i18n-placeholder` and `data-i18n-aria-label` attributes in any string
//     of app/src and in the static HTML entries (app/*.html, app/<dir>/index.html);
//   - every string of a ternary (or `??` / `||`) in any of those argument positions.
// A template-literal key is a dynamic reference by its static prefix; every prefix must be on
// DYNAMIC_PREFIXES (the test says so), so a new one is a decision, not an accident. A key held
// in a variable is listed under `unresolved` and counts for nothing.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export type I18nVia = 'i18n.t' | 'wrapper' | 'group' | 'forms' | 'record' | 'tr' | 'trPlural' | 'ct' | 'data-i18n';

export interface I18nRef {
  /** Repository-relative path. */
  file: string;
  line: number;
  via: I18nVia;
}

export interface I18nScan {
  /** Catalogue keys (dotted paths into app/src/i18n/hr.json and en.json) referenced literally. */
  keys: Map<string, I18nRef[]>;
  /** Plural bases: the catalogue holds `${base}_one`, `${base}_few` (where the locale has one) and `${base}_other`. */
  plurals: Map<string, I18nRef[]>;
  /** Words of app/src/city/strings.ts read through ct(); they are not catalogue keys. */
  cityWords: Map<string, I18nRef[]>;
  /** Template-literal keys by their static prefix. */
  dynamic: Map<string, I18nRef[]>;
  /** Calls whose key is a variable or an expression the scanner cannot read. */
  unresolved: I18nRef[];
  /** Files read. */
  files: string[];
}

/** The key prefixes app/src reads through a template literal (a grep for `.t(\`` and record()). */
export const DYNAMIC_PREFIXES: readonly string[] = Object.freeze([
  'common.theme.',
  'events.category.',
  'events.sources.',
  'freshness.',
  'kiosk.events.',
  'kiosk.header.themeWord.',
  'landing.alt.',
  'layers.',
  'motion.compass.',
  'notify.',
  'panels.closureType.',
  'panels.direction.',
  'panels.severity.',
  'presentation.',
  'scan.errors.',
  'scan.venue.',
  'timeband.',
  'weather.points.',
]);

/** A scan of the real tree that finds fewer keys than this has lost a reference form. */
export const MIN_I18N_KEYS = 500;

/** Files whose group()/forms()/record() helpers build kiosk keys. */
const STRINGS_FILES = new Set(['app/src/kiosk/strings.ts']);
/** Helper definitions whose inner `.t(…)` is their implementation, not a reference. */
const STRINGS_HELPERS = new Set(['group', 'forms', 'record']);
/** app/src/transport/strings.ts implements tr()/trPlural() over `.t(\`transport.${key}\`)`. */
const TRANSPORT_FILE = 'app/src/transport/strings.ts';
const TRANSPORT_HELPERS = new Set(['tr', 'trPlural']);

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function emptyScan(): I18nScan {
  return { keys: new Map(), plurals: new Map(), cityWords: new Map(), dynamic: new Map(), unresolved: [], files: [] };
}

function add(map: Map<string, I18nRef[]>, key: string, ref: I18nRef): void {
  const refs = map.get(key);
  if (refs) refs.push(ref);
  else map.set(key, [ref]);
}

type Sink = { literal(text: string): void; dynamic(prefix: string): void; unresolved(): void };

/**
 * The initializer of the `const` an identifier names, looked up in the blocks that enclose the
 * use (`const key = \`events.sources.${source}\`; i18n.t(key)`); undefined for anything else.
 */
function constInitializer(id: ts.Identifier): ts.Expression | undefined {
  for (let scope: ts.Node | undefined = id.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === id.text && decl.initializer) return decl.initializer;
      }
    }
  }
  return undefined;
}

/**
 * Walks a key expression: literals, templates, both branches of a ternary or a fallback, and
 * a local `const` holding any of those.
 */
function readKey(expr: ts.Expression | undefined, sink: Sink, depth = 0): void {
  if (!expr) return sink.unresolved();
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return sink.literal(expr.text);
  if (ts.isTemplateExpression(expr)) return sink.dynamic(expr.head.text);
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isNonNullExpression(expr)) {
    return readKey(expr.expression, sink, depth);
  }
  if (ts.isConditionalExpression(expr)) {
    readKey(expr.whenTrue, sink, depth);
    readKey(expr.whenFalse, sink, depth);
    return;
  }
  if (ts.isBinaryExpression(expr) && (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || expr.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
    readKey(expr.left, sink, depth);
    readKey(expr.right, sink, depth);
    return;
  }
  if (ts.isIdentifier(expr) && depth < 3) {
    const init = constInitializer(expr);
    if (init) return readKey(init, sink, depth + 1);
  }
  sink.unresolved();
}

/** `const NAME = (key, …) => …i18n.t(key | \`prefix${key}\`)…`: the wrapper's name and prefix. */
function wrapperOf(decl: ts.VariableDeclaration): { name: string; prefix: string } | null {
  if (!ts.isIdentifier(decl.name) || !decl.initializer || !ts.isArrowFunction(decl.initializer)) return null;
  const param = decl.initializer.parameters[0];
  if (!param || !ts.isIdentifier(param.name)) return null;
  const key = param.name.text;
  let prefix: string | null = null;
  const visit = (node: ts.Node): void => {
    if (prefix !== null) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't') {
      const arg = node.arguments[0];
      if (arg && ts.isIdentifier(arg) && arg.text === key) prefix = '';
      else if (arg && ts.isTemplateExpression(arg) && arg.templateSpans.length === 1
        && ts.isIdentifier(arg.templateSpans[0]!.expression) && arg.templateSpans[0]!.expression.text === key
        && arg.templateSpans[0]!.literal.text === '') prefix = arg.head.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(decl.initializer.body);
  return prefix === null ? null : { name: decl.name.text, prefix };
}

function ancestorNamed(node: ts.Node, names: ReadonlySet<string>): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isVariableDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name && ts.isIdentifier(n.name) && names.has(n.name.text)) return true;
  }
  return false;
}

const DATA_I18N = /data-i18n(?:-placeholder|-aria-label)?=["']([A-Za-z0-9_.-]+)["']/g;

/** The references in one TypeScript source; `file` is repository-relative and decides the strings.ts rules. */
export function scanI18nSource(file: string, source: string, into: I18nScan = emptyScan()): I18nScan {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  into.files.push(file);
  const lineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const sinkFor = (node: ts.Node, via: I18nVia, prefix: string, target: 'keys' | 'plurals' | 'cityWords'): Sink => {
    const ref = (): I18nRef => ({ file, line: lineOf(node), via });
    return {
      literal: (text) => add(into[target], prefix + text, ref()),
      dynamic: (head) => add(into.dynamic, prefix + head, ref()),
      unresolved: () => into.unresolved.push(ref()),
    };
  };

  const wrappers = new Map<string, string>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      const w = wrapperOf(node);
      if (w) wrappers.set(w.name, w.prefix);
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  const wrapperNames = new Set(wrappers.keys());
  const stringsFile = STRINGS_FILES.has(file);

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      for (const m of node.text.matchAll(DATA_I18N)) add(into.keys, m[1]!, { file, line: lineOf(node), via: 'data-i18n' });
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const args = node.arguments;
      const insideHelper = ancestorNamed(node, wrapperNames) || (stringsFile && ancestorNamed(node, STRINGS_HELPERS))
        || (file === TRANSPORT_FILE && ancestorNamed(node, TRANSPORT_HELPERS));
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 't') {
        if (!insideHelper) readKey(args[0], sinkFor(node, 'i18n.t', '', 'keys'));
      } else if (ts.isIdentifier(callee)) {
        const name = callee.text;
        if (wrappers.has(name) && !insideHelper) readKey(args[0], sinkFor(node, 'wrapper', wrappers.get(name)!, 'keys'));
        else if (name === 'tr' && !insideHelper) readKey(args[1], sinkFor(node, 'tr', 'transport.', 'keys'));
        else if (name === 'trPlural' && !insideHelper) readKey(args[1], sinkFor(node, 'trPlural', 'transport.', 'plurals'));
        else if (name === 'ct') readKey(args[1], sinkFor(node, 'ct', '', 'cityWords'));
        else if (stringsFile && (name === 'group' || name === 'forms') && args[0] && ts.isStringLiteral(args[0])) {
          const prefix = `kiosk.${args[0].text}.`;
          if (name === 'group' && args[1] && ts.isArrayLiteralExpression(args[1])) {
            for (const el of args[1].elements) readKey(el as ts.Expression, sinkFor(el, 'group', prefix, 'keys'));
          } else if (name === 'forms') readKey(args[1], sinkFor(node, 'forms', prefix, 'plurals'));
        } else if (stringsFile && name === 'record' && args[1] && ts.isArrowFunction(args[1])) {
          const body = args[1].body;
          if (ts.isTemplateExpression(body) && body.templateSpans.length === 1 && body.templateSpans[0]!.literal.text === '') {
            let list: ts.Expression | undefined = args[0];
            while (list && (ts.isAsExpression(list) || ts.isParenthesizedExpression(list) || ts.isSatisfiesExpression(list))) list = list.expression;
            if (list && ts.isArrayLiteralExpression(list)) {
              for (const el of list.elements) readKey(el as ts.Expression, sinkFor(el, 'record', body.head.text, 'keys'));
            } else add(into.dynamic, body.head.text, { file, line: lineOf(node), via: 'record' });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return into;
}

/** The static HTML entries Vite serves (app/*.html and app/<dir>/index.html, never app/dist). */
function staticHtml(root: string): string[] {
  const app = join(root, 'app');
  const out = readdirSync(app).filter((name) => name.endsWith('.html')).map((name) => `app/${name}`);
  for (const dir of readdirSync(app)) {
    if (dir === 'dist' || !statSync(join(app, dir)).isDirectory()) continue;
    if (readdirSync(join(app, dir)).includes('index.html')) out.push(`app/${dir}/index.html`);
  }
  return out.sort();
}

function walk(root: string, dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) walk(root, rel, out);
    else if (name.endsWith('.ts')) out.push(rel);
  }
  return out;
}

/** Distinct catalogue references: literal keys plus plural bases. */
export function keyCount(scan: I18nScan): number {
  return scan.keys.size + scan.plurals.size;
}

/**
 * Scans app/src/**\/*.ts and the static HTML entries of the repository at `root`.
 * Throws when it finds fewer than MIN_I18N_KEYS keys, so a regression in the scanner is loud
 * in every test that relies on it.
 */
export function scanI18n(root: string = ROOT): I18nScan {
  const scan = emptyScan();
  for (const file of walk(root, 'app/src').sort()) scanI18nSource(file, readFileSync(join(root, file), 'utf8'), scan);
  for (const file of staticHtml(root)) {
    const text = readFileSync(join(root, file), 'utf8');
    scan.files.push(file);
    for (const m of text.matchAll(DATA_I18N)) {
      add(scan.keys, m[1]!, { file, line: text.slice(0, m.index).split('\n').length, via: 'data-i18n' });
    }
  }
  if (keyCount(scan) < MIN_I18N_KEYS) {
    throw new Error(`i18n-scan found ${keyCount(scan)} keys in ${relative(ROOT, root) || '.'}, fewer than ${MIN_I18N_KEYS}: a reference form was lost`);
  }
  return scan;
}

/** The dynamic prefixes a scan found that DYNAMIC_PREFIXES does not allow. */
export function unknownDynamicPrefixes(scan: I18nScan): string[] {
  return [...scan.dynamic.keys()].filter((prefix) => !DYNAMIC_PREFIXES.some((allowed) => prefix.startsWith(allowed))).sort();
}

/**
 * Whether a catalogue key counts as referenced: named literally, a plural form of a referenced
 * base (or the base of a referenced plural form), or under an allowed dynamic prefix the scan
 * actually met.
 */
export function isReferenced(scan: I18nScan, key: string): boolean {
  if (scan.keys.has(key)) return true;
  const plural = /^(.*)_(one|few|other)$/.exec(key);
  if (plural && (scan.plurals.has(plural[1]!) || scan.keys.has(plural[1]!))) return true;
  return [...scan.dynamic.keys()].some((prefix) => prefix !== '' && key.startsWith(prefix) && DYNAMIC_PREFIXES.some((allowed) => prefix.startsWith(allowed)));
}
