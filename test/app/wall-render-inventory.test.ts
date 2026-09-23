import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Seeded by rg 'escapeHtml|textContent|fillText|text-field' on the kiosk entry,
// its components and the shared renderers it calls. Parse expressions rather
// than grep comments. The exact sink inventory (including trusted copy) is
// pinned: new files/sinks, changed arguments and removed guards require review.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILES = [
  'app/src/kiosk.ts',
  ...readdirSync(resolve(ROOT, 'app/src/kiosk')).filter(f => f.endsWith('.ts')).map(f => `app/src/kiosk/${f}`),
  'app/src/city/markup.ts', 'app/src/map/city-map.ts', 'app/src/map/external-labels.ts', 'app/src/map/external-features.ts',
  'app/src/map/overlays.ts', 'app/src/map/city-layers.ts',
  'app/src/motion/schema-paint.ts', 'app/src/motion/schema-map.ts', 'app/src/motion/schematic-view.ts',
  'shared/kiosk/sentence.ts',
].sort();

function owner(node: ts.Node): ts.FunctionDeclaration | null {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) && parent.name) return parent;
  }
  return null;
}
const EXTERNAL_FIELD = /\b(?:item|row|act|p|s|strip|weather|observed|panel|stop|named|w|q|d|x\.item)\.(?:title|name|sub|summary|headsign|longName|condition|station|description|address|hours|value|detail|attribution|settlement)\b/;
const INDIRECT_GUARDS: Record<string, string> = {
  'app/src/kiosk/arrivals.ts#arrivalCells': 'if (!vettedArrival(row)) return',
  'app/src/kiosk/timeline.ts#rowMarkup': 'if (!vettedTimelineRow(row)) return',
};
// This renderer is used by phone discovery only. The wall calls placeDetail
// with publicDisplay=true, never placesMarkup. Keep the exception exact.
const PHONE_ONLY = new Set(['app/src/city/markup.ts#placesMarkup', 'app/src/city/markup.ts#departuresMarkup']);

const program = ts.createProgram(FILES.map(file => resolve(ROOT, file)), { noResolve: true, noLib: true });
const checker = program.getTypeChecker();
function initializer(node: ts.Identifier): ts.Expression | undefined {
  const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
  // Only immutable aliases prove value flow. An unrelated vet call, or an
  // unused vetted variable, cannot authorize a later write of the raw value.
  return declaration && ts.isVariableDeclaration(declaration)
    && ts.isVariableDeclarationList(declaration.parent)
    && (declaration.parent.flags & ts.NodeFlags.Const) !== 0 ? declaration.initializer : undefined;
}
const same = (a: ts.Node, b: ts.Node): boolean => a.getText() === b.getText();
const fixedCopy = (node: ts.Node): boolean =>
  /^(?:s|ctx\.strings)\.paired\.(?:closures|warnings)$/u.test(node.getText());

/** Prove the complete rendered expression is a vetted return (or fixed
 * fallback), following const aliases rather than searching a function body. */
function guardedValue(node: ts.Expression, seen = new Set<ts.Node>()): boolean {
  if (seen.has(node)) return false;
  const next = new Set(seen).add(node);
  if (ts.isStringLiteralLike(node) || node.kind === ts.SyntaxKind.NullKeyword || fixedCopy(node)) return true;
  if (ts.isIdentifier(node)) {
    const init = initializer(node);
    return Boolean(init && guardedValue(init, next));
  }
  if (ts.isParenthesizedExpression(node)) return guardedValue(node.expression, next);
  if (ts.isCallExpression(node)) {
    const name = node.expression.getText();
    if (name === 'vetExternal') return node.arguments.length === 3 && /^(?:'row'|'header')$/u.test(node.arguments[2]!.getText());
    if (name === 'externalHtml') return node.arguments.length === 2;
    if (/^(?:e|escapeHtml)$/u.test(name)) return Boolean(node.arguments[0] && guardedValue(node.arguments[0], next));
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return guardedValue(node.left, next) && guardedValue(node.right, next);
  }
  if (ts.isConditionalExpression(node)) {
    if (guardedValue(node.whenTrue, next) && guardedValue(node.whenFalse, next)) return true;
    // i18n's missing-key return must flow only into the equality check; the
    // rendered branch substitutes existing fixed copy, never that key.
    const condition = node.condition;
    if (ts.isBinaryExpression(condition) && condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      && same(condition.left, node.whenFalse) && ts.isIdentifier(node.whenFalse) && fixedCopy(node.whenTrue)) {
      const translated = initializer(node.whenFalse);
      return Boolean(translated && ts.isCallExpression(translated) && /\.t$/u.test(translated.expression.getText())
        && translated.arguments[0] && same(translated.arguments[0], condition.right));
    }
  }
  return false;
}

function rawExternalFields(node: ts.Node): ts.Expression[] {
  if (ts.isCallExpression(node) && /^(?:vetExternal|externalHtml)$/u.test(node.expression.getText())) return [];
  if (ts.isPropertyAccessExpression(node) && EXTERNAL_FIELD.exec(node.getText())?.[0] === node.getText()) return [node];
  const fields: ts.Expression[] = [];
  ts.forEachChild(node, child => { fields.push(...rawExternalFields(child)); });
  return fields;
}

function rejectsField(condition: ts.Expression, field: ts.Expression | string): boolean {
  const matches = (node: ts.Node) => typeof field === 'string' ? node.getText() === field : same(node, field);
  if (ts.isParenthesizedExpression(condition)) return rejectsField(condition.expression, field);
  if (ts.isBinaryExpression(condition)) {
    if (condition.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      return rejectsField(condition.left, field) || rejectsField(condition.right, field);
    }
    if (condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && condition.right.kind === ts.SyntaxKind.NullKeyword
      && ts.isCallExpression(condition.left) && condition.left.expression.getText() === 'vetExternal') {
      return Boolean(condition.left.arguments[1] && matches(condition.left.arguments[1]));
    }
  }
  return ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken
    && ts.isCallExpression(condition.operand) && condition.operand.expression.getText() === 'optionalExternal'
    && Boolean(condition.operand.arguments[1] && matches(condition.operand.arguments[1]));
}

function dominatingRefusal(node: ts.Node, value: ts.Expression | string): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (!ts.isBlock(parent)) continue;
    if (parent.statements.some(statement => statement.end < node.getStart() && ts.isIfStatement(statement)
      && (ts.isReturnStatement(statement.thenStatement) || ts.isContinueStatement(statement.thenStatement))
      && rejectsField(statement.expression, value))) return true;
  }
  return false;
}

/** `collection.some((row) => vetExternal(kind, row, surface) === null)`:
 * a refusal of the whole collection when any one of its elements fails. */
function rejectsEvery(condition: ts.Expression, collection: string): boolean {
  if (ts.isParenthesizedExpression(condition)) return rejectsEvery(condition.expression, collection);
  if (!ts.isCallExpression(condition) || !ts.isPropertyAccessExpression(condition.expression)) return false;
  if (condition.expression.name.text !== 'some' || condition.expression.expression.getText() !== collection) return false;
  const callback = condition.arguments[0];
  if (condition.arguments.length !== 1 || !callback || !ts.isArrowFunction(callback) || callback.parameters.length !== 1) return false;
  const element = callback.parameters[0]!.name;
  return ts.isIdentifier(element) && !ts.isBlock(callback.body) && rejectsField(callback.body, element.text);
}

function dominatingEveryRefusal(node: ts.Node, collection: string): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (!ts.isBlock(parent)) continue;
    if (parent.statements.some(statement => statement.end < node.getStart() && ts.isIfStatement(statement)
      && (ts.isReturnStatement(statement.thenStatement) || ts.isContinueStatement(statement.thenStatement))
      && rejectsEvery(statement.expression, collection))) return true;
  }
  return false;
}

function guardedCanvas(node: ts.CallExpression): boolean {
  const arg = node.arguments[0]!;
  if (guardedValue(arg)) return true;
  const value = ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    && guardedValue(arg.right) ? arg.left : arg;
  if (dominatingRefusal(node, value)) return true;
  // A multiline name is vetted as a whole before forEach paints its rows,
  // and a wrapped pill label row by row (every row, or the mark is skipped).
  // Resolve the actual callback parameter/collection, not a same-named local.
  const parameter = ts.isIdentifier(value) ? checker.getSymbolAtLocation(value)?.valueDeclaration : undefined;
  if (!parameter || !ts.isParameter(parameter) || !ts.isArrowFunction(parameter.parent)) return false;
  const callback = parameter.parent;
  const call = callback.parent;
  if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)
    || call.expression.name.text !== 'forEach' || callback.parameters[0] !== parameter) return false;
  const collection = call.expression.expression.getText();
  return dominatingRefusal(node, `${collection}.join(' ')`) || dominatingEveryRefusal(node, collection);
}

function guardedEscape(node: ts.CallExpression, key: string): boolean {
  if (guardedValue(node)) return true;
  const fn = owner(node);
  if (!fn?.body) return false;
  // Shared phone/wall detail renderers bind their escape itself to a vetted
  // return on the public branch. Pin the parameter -> externalHtml -> escape
  // flow; a guard on a different field is not evidence for this escape.
  if (node.expression.getText() === 'e' && ['app/src/city/markup.ts#placeDetail', 'app/src/city/markup.ts#streetDetail'].includes(key)) {
    const init = initializer(node.expression as ts.Identifier);
    if (init?.getText() === "publicDisplay ? (value: unknown) => typeof value === 'string' ? externalHtml('summary', value) : escapePhone(value) : escapePhone") return true;
  }
  const indirect = INDIRECT_GUARDS[key];
  if (indirect && fn.body.getText().includes(indirect)) return true;
  if (key === 'app/src/city/markup.ts#eventLinks') {
    return fn.body.getText().includes("if (!interactive) events = events.filter(x => vetExternal('title', x.item.title, 'row') !== null);")
      && fn.body.getText().includes('return events.map(x=>') && node.arguments[0]?.getText() === 'x.item.title';
  }
  return node.arguments.every(arg => rawExternalFields(arg).every(field =>
    fn.body!.statements.some(statement => statement.end < node.getStart()
      && ts.isIfStatement(statement) && ts.isReturnStatement(statement.thenStatement)
      && rejectsField(statement.expression, field))));
}

interface Site { file: string; line: number; boundary: string; expression: string }
const sites: Site[] = [];
const externalEscapes: { key: string; node: ts.CallExpression }[] = [];
const renderedValues: { key: string; sink: string; value: ts.Expression }[] = [];
const canvasWrites: ts.CallExpression[] = [];
for (const file of FILES) {
  const source = program.getSourceFile(resolve(ROOT, file))!;
  const add = (node: ts.Node, expression: string): void => {
    sites.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      boundary: owner(node)?.name?.text ?? '<module>', expression: expression.replace(/\s+/gu, ' ') });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source);
      const args = node.arguments.map(arg => arg.getText(source)).join(', ');
      if (/^(?:e|escapeHtml|externalHtml|vetExternal|vetExternalMap|externalText|setText)$|(?:fillText|strokeText)$/.test(callee)) {
        add(node, node.getText(source));
      }
      if (/\.(?:fillText|strokeText)$/u.test(callee)) canvasWrites.push(node);
      if (/\.setAttribute$/u.test(callee) && /^(?:'aria-label'|'title')$/u.test(node.arguments[0]?.getText() ?? '')) {
        add(node, node.getText(source));
        if (file === 'app/src/map/city-map.ts' || file === 'app/src/kiosk/mapview.ts') {
          renderedValues.push({ key: `${file}#${owner(node)?.name?.text}`, sink: callee, value: node.arguments[1]! });
        }
      }
      if (/^(?:e|escapeHtml)$/.test(callee) && EXTERNAL_FIELD.test(args)) {
        const fn = owner(node);
        externalEscapes.push({ key: `${file}#${fn?.name?.text}`, node });
      }
      if (callee === 'escapeHtml' && ['leadText', 'dayText', 'severityLabel', 'type'].includes(args)) {
        renderedValues.push({ key: `${file}#${owner(node)?.name?.text}`, sink: node.getText(), value: node.arguments[0]! });
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left) && ['textContent', 'value', 'title'].includes(node.left.name.text)) {
      if (!node.left.expression.getText().endsWith('.dataset')) add(node, node.getText(source));
      if ((file === 'app/src/kiosk/place-field.ts' && node.left.name.text === 'value')
        || (file === 'app/src/map/city-map.ts' && node.left.name.text === 'title')) {
        renderedValues.push({ key: `${file}#${owner(node)?.name?.text}`, sink: node.left.getText(), value: node.right });
      }
    }
    if (ts.isPropertyAssignment(node) && node.name.getText() === 'ariaLabel' && file === 'app/src/kiosk/mapview.ts') {
      add(node, node.getText(source));
      renderedValues.push({ key: `${file}#${owner(node)?.name?.text}`, sink: 'ariaLabel', value: node.initializer });
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(source).replace(/['"]/gu, '') === 'text-field') add(node, node.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
}

describe('every wall text render boundary', () => {
  it('pins every text escape, DOM write, canvas text call and map text expression', async () => {
    expect(sites.length).toBeGreaterThan(200);
    const inventory = sites.map(s => `${s.file}:${s.line} #${s.boundary} → ${s.expression}`).join('\n') + '\n';
    await expect(inventory).toMatchFileSnapshot('../fixtures/wall-render-sites.txt');
  });

  it('requires each raw rendered field to be the field actually guarded', () => {
    for (const site of externalEscapes) {
      if (PHONE_ONLY.has(site.key)) continue;
      expect(guardedEscape(site.node, site.key), `${site.key}: ${site.node.getText()}`).toBe(true);
    }
  });

  it('follows vetted values into every closing-round lead, fallback, field and map ARIA sink', () => {
    expect(renderedValues).toHaveLength(10);
    for (const site of renderedValues) {
      expect(guardedValue(site.value), `${site.key}: ${site.sink} ← ${site.value.getText()}`).toBe(true);
    }
  });

  it('checks the actual canvas argument, including the guarded whole-name row projection', () => {
    expect(canvasWrites).toHaveLength(4);
    for (const node of canvasWrites) expect(guardedCanvas(node), node.getText()).toBe(true);
  });

  it('accepts a per-row refusal only when it vets each element of the painted collection', () => {
    const condition = (text: string): ts.Expression =>
      (ts.createSourceFile('rows.ts', text, ts.ScriptTarget.Latest, true).statements[0] as ts.ExpressionStatement).expression;
    expect(rejectsEvery(condition("rows.some((row) => vetExternal('name', row, 'row') === null)"), 'rows')).toBe(true);
    for (const text of [
      "rows.some((row) => vetExternal('name', label, 'row') === null)",
      "other.some((row) => vetExternal('name', row, 'row') === null)",
      "rows.every((row) => vetExternal('name', row, 'row') === null)",
      "rows.some((row) => vetExternal('name', row, 'row') !== null)",
      "rows.some((row, i) => vetExternal('name', row, 'row') === null)",
    ]) expect(rejectsEvery(condition(text), 'rows'), text).toBe(false);
  });

  it('does not mistake unused or wrong-field guards for guarded rendered values', () => {
    for (const body of [
      "const safe = vetExternal('title', row.title, 'row'); escapeHtml(row.title);",
      "if (vetExternal('title', row.sub, 'row') === null) return ''; escapeHtml(row.title);",
      "vetExternal('title', row.title, 'row'); escapeHtml(row.title);",
    ]) {
      const source = ts.createSourceFile('negative.ts', `function render(row) { ${body} }`, ts.ScriptTarget.Latest, true);
      const fn = source.statements[0] as ts.FunctionDeclaration;
      const call = (fn.body!.statements.at(-1) as ts.ExpressionStatement).expression as ts.CallExpression;
      expect(guardedEscape(call, 'negative.ts#render'), body).toBe(false);
      expect(guardedCanvas(call), body).toBe(false);
    }
  });

  it('pins the hard-wired header and each indirect render boundary', () => {
    const sentence = readFileSync(resolve(ROOT, 'shared/kiosk/sentence.ts'), 'utf8');
    expect(sentence).toContain("externalText(rule.names, value, { surface: 'header' })");
    expect(sentence).toContain("externalText('headsign', value, { surface: 'header' })");
    const controller = readFileSync(resolve(ROOT, 'app/src/kiosk.ts'), 'utf8');
    expect(controller).toMatch(/function sentenceOverflows[\s\S]*?typedSentenceFact[\s\S]*?\.ok\) return true/);
    expect(controller).toMatch(/function paintSentence[\s\S]*?typedSentenceFact[\s\S]*?\.ok\) currentSentence = null/);
    const timeline = readFileSync(resolve(ROOT, 'app/src/kiosk/timeline.ts'), 'utf8');
    expect(timeline).toContain('rows = rows.filter(vettedTimelineRow)');
    expect(timeline).toContain('if (!vettedTimelineRow(row)) return');
    const map = readFileSync(resolve(ROOT, 'app/src/map/city-map.ts'), 'utf8');
    expect(map).toContain('style: safeStyle as never');
    expect(map).toContain('wallLabels ? l.wallLabelLayers(raw).layers : raw');
    const paired = readFileSync(resolve(ROOT, 'app/src/kiosk/paired.ts'), 'utf8');
    expect(paired).toContain('placeDetail(i18n,p,ctx.city,locatedEvents(ctx.snapshots.dogadanja?.items??[],ctx.city.places,ctx.now),false,true)');
    expect(paired).toContain('streetDetail(i18n,p,true)');
    const schema = readFileSync(resolve(ROOT, 'app/src/motion/schema-map.ts'), 'utf8');
    expect(schema).toContain('externalSelection: true');
    const scene = readFileSync(resolve(ROOT, 'app/src/motion/schematic-view.ts'), 'utf8');
    expect(scene).toContain("deps.externalSelection ? vetExternal('summary', summary, 'row') ?? '' : summary");
    const boundary = readFileSync(resolve(ROOT, 'shared/kiosk/external-text-boundary.ts'), 'utf8');
    expect(boundary).toContain('boundary?.(kind, value, surface) ?? null');
  });
});
