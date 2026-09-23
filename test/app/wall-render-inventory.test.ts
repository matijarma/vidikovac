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

interface Site { file: string; line: number; boundary: string; expression: string }
const sites: Site[] = [];
const externalEscapes: { key: string; expression: string; body: string }[] = [];
for (const file of FILES) {
  const source = ts.createSourceFile(file, readFileSync(resolve(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true);
  const add = (node: ts.Node, expression: string): void => {
    sites.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      boundary: owner(node)?.name?.text ?? '<module>', expression: expression.replace(/\s+/gu, ' ') });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source);
      const args = node.arguments.map(arg => arg.getText(source)).join(', ');
      if (/^(?:e|escapeHtml|externalHtml|vetExternal|externalText|setText)$|(?:fillText|strokeText)$/.test(callee)) {
        add(node, node.getText(source));
      }
      if (/^(?:e|escapeHtml)$/.test(callee) && EXTERNAL_FIELD.test(args)) {
        const fn = owner(node);
        externalEscapes.push({ key: `${file}#${fn?.name?.text}`, expression: node.getText(source), body: fn?.getText(source) ?? '' });
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'textContent') add(node, node.getText(source));
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

  it('requires raw external-field escapes to be guarded at the component, not just a producer', () => {
    for (const site of externalEscapes) {
      if (PHONE_ONLY.has(site.key)) continue;
      const guard = INDIRECT_GUARDS[site.key];
      expect(guard ? site.body.includes(guard) : /\b(?:vetExternal|externalHtml)\(/u.test(site.body),
        `${site.key}: ${site.expression}`).toBe(true);
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
