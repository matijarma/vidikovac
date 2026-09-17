// The mobile gates' rule engine has one source: e2e/geometry.ts carries the
// thresholds and the rules, and both consumers read them from there, the
// Playwright gate (e2e/mobile.spec.ts) by import and the production audit
// (scripts/audit-production.mjs) through a throwaway Vite loader. This file
// holds the numbers the plan fixes, checks that the page-side function can be
// shipped into a browser (it may reference nothing but its argument and the
// DOM), and keeps the two consumers from growing a copy of the rules.
// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import {
  ALL_GEOMETRY_RULES, CONTROL_TARGETS, EDGE_TOLERANCE_PX, HEADER_MAX_PX, PHONE_SHELL, PHONE_TYPE_FLOOR, RULES_IN_PAGE,
  SOURCE_LINK_TARGETS, TARGET_MIN_PX, TYPE_FLOOR_EXEMPT, TYPE_FLOOR_PX, geometryIssues, ruleViolations,
} from '../../e2e/geometry';

const root = join(import.meta.dirname, '..', '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

/** A Page that records what evaluate() would ship to the browser and answers with `answer`. */
function recorder(answer: unknown = []): { page: Page; shipped: () => { fn: string; arg: unknown } } {
  let last: { fn: string; arg: unknown } | null = null;
  const page = { evaluate: (fn: unknown, arg: unknown) => { last = { fn: String(fn), arg }; return Promise.resolve(answer); } } as unknown as Page;
  return { page, shipped: () => { if (!last) throw new Error('evaluate was not called'); return last; } };
}

describe('the thresholds the plan fixes', () => {
  it('type floor 13 px, targets 44 px, header at most 56 px, 1 px edge tolerance', () => {
    expect(TYPE_FLOOR_PX).toBe(13);
    expect(TARGET_MIN_PX).toBe(44);
    expect(HEADER_MAX_PX).toBe(56);
    expect(EDGE_TOLERANCE_PX).toBe(1);
  });

  it('exempts exactly the attribution lines from the type floor', () => {
    // .src is /hitno's attribution footer; the map credit is attribution too.
    expect(TYPE_FLOOR_EXEMPT.split(',').map((s) => s.trim()).sort()).toEqual(['.maplibregl-ctrl-attrib', '.panel-attr', '.provenance', '.source-line', '.src']);
    expect(PHONE_TYPE_FLOOR).toEqual({ floorPx: TYPE_FLOOR_PX, exempt: TYPE_FLOOR_EXEMPT });
  });

  it('names the phone shell the geometry rules read, and the five rules in order', () => {
    expect(PHONE_SHELL).toEqual({ header: '.ki-head', tabbar: '.ki-tabbar', main: '[data-testid=dash-view]', banners: '[data-testid=banners]', maxHeaderPx: HEADER_MAX_PX });
    expect(ALL_GEOMETRY_RULES).toEqual(['header', 'overlay', 'tabbar', 'header-height', 'overflow']);
  });

  it('measures a source-line link by height (inline text, plan: Spacing) and every other control in both dimensions', () => {
    expect(SOURCE_LINK_TARGETS).toEqual({ selector: '.provenance a, .source a', minPx: TARGET_MIN_PX, axes: 'height' });
    expect(CONTROL_TARGETS.axes).toBe('both');
    expect(CONTROL_TARGETS.minPx).toBe(TARGET_MIN_PX);
    expect(CONTROL_TARGETS.selector).toContain(':not(.provenance a, .source a, .maplibregl-ctrl-attrib a)');
    for (const control of ['button', 'summary', '[role=button]', '[role=tab]']) expect(CONTROL_TARGETS.selector).toContain(control);
  });
});

describe('ruleViolations ships everything the page needs in its argument', () => {
  it('passes the thresholds and the selectors; the page-side source names no module constant', async () => {
    const { page, shipped } = recorder();
    await ruleViolations(page, { geometry: PHONE_SHELL, typeFloor: PHONE_TYPE_FLOOR, targets: [SOURCE_LINK_TARGETS, CONTROL_TARGETS], openDetails: true });
    const { fn, arg } = shipped();
    expect(arg).toEqual({
      geometry: { header: '.ki-head', tabbar: '.ki-tabbar', main: '[data-testid=dash-view]', banners: '[data-testid=banners]', maxHeaderPx: 56, active: [...ALL_GEOMETRY_RULES] },
      typeFloor: { floorPx: 13, exempt: TYPE_FLOOR_EXEMPT },
      targets: [SOURCE_LINK_TARGETS, CONTROL_TARGETS],
      openDetails: true,
      edge: EDGE_TOLERANCE_PX,
      rounding: 0.5,
    });
    expect(fn).toBe(String(RULES_IN_PAGE));
    expect(fn).not.toMatch(/\b(TYPE_FLOOR_PX|TARGET_MIN_PX|HEADER_MAX_PX|EDGE_TOLERANCE_PX|ROUNDING_PX|PHONE_SHELL|PHONE_TYPE_FLOOR|ALL_GEOMETRY_RULES|SOURCE_LINK_TARGETS|CONTROL_TARGETS)\b/);
  });

  it('a geometry-only call evaluates the requested rules and nothing else', async () => {
    const { page, shipped } = recorder([{ rule: 'overlay', detail: 'x overlaps y' }]);
    const issues = await geometryIssues(page, { ...PHONE_SHELL, rules: ['overlay'] });
    expect(issues).toEqual(['x overlaps y']);
    const arg = shipped().arg as { geometry: { active: string[] }; typeFloor: unknown; targets: unknown[]; openDetails: boolean };
    expect(arg.geometry.active).toEqual(['overlay']);
    expect(arg.typeFloor).toBeNull();
    expect(arg.targets).toEqual([]);
    expect(arg.openDetails).toBe(false);
  });
});

describe('the page-side function in a DOM', () => {
  it('reports a missing shell as sentences, never throws, and measures nothing when there is no text', () => {
    document.body.innerHTML = '<main><p>Sada</p></main>';
    const out = RULES_IN_PAGE({
      geometry: { ...PHONE_SHELL, active: [...ALL_GEOMETRY_RULES] },
      typeFloor: PHONE_TYPE_FLOOR,
      targets: [SOURCE_LINK_TARGETS, CONTROL_TARGETS],
      openDetails: true,
      edge: EDGE_TOLERANCE_PX,
      rounding: 0.5,
    });
    expect(out.map((v) => v.rule)).toEqual(['header', 'tabbar']);
    expect(out[0].detail).toContain('.ki-head');
    expect(out[1].detail).toContain('.ki-tabbar');
  });

  it('measures a visually hidden radio at its label, the box a finger actually hits', () => {
    document.body.innerHTML = `
      <label for="stop-a" id="label-a">Trg bana Jelačića</label><input id="stop-a" type="radio" name="stop">
      <label for="stop-b" id="label-b">Britanski trg</label><input id="stop-b" type="radio" name="stop">`;
    const boxes: Record<string, DOMRect> = {
      'stop-a': { width: 1, height: 1, top: 0, bottom: 1, left: 0, right: 1 } as DOMRect,
      'stop-b': { width: 1, height: 1, top: 0, bottom: 1, left: 0, right: 1 } as DOMRect,
      'label-a': { width: 320, height: 48, top: 0, bottom: 48, left: 0, right: 320 } as DOMRect,
      'label-b': { width: 320, height: 20, top: 48, bottom: 68, left: 0, right: 320 } as DOMRect,
    };
    for (const [id, rect] of Object.entries(boxes)) {
      const el = document.getElementById(id)!;
      el.getBoundingClientRect = () => rect;
      Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => document.body });
    }
    const out = RULES_IN_PAGE({
      targets: [CONTROL_TARGETS],
      edge: EDGE_TOLERANCE_PX,
      rounding: 0.5,
    });
    // The 48 px label passes for its input; the 20 px one is reported, and named as the label.
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe('target');
    expect(out[0].detail).toContain('Britanski trg');
    expect(out[0].detail).toContain('20 px');
  });
});

describe('one source for the rules', () => {
  const audit = read('scripts/audit-production.mjs');
  const spec = read('e2e/mobile.spec.ts');
  const thresholds = ['TYPE_FLOOR_PX', 'TARGET_MIN_PX', 'TARGET_PX', 'HEADER_MAX_PX', 'EDGE_TOLERANCE_PX', 'DESKTOP_MIN_PX', 'TYPE_FLOOR_EXEMPT'];

  it('audit-production.mjs loads the rules from e2e/geometry.ts through a Vite loader and declares no threshold or rule of its own', () => {
    expect(audit).toContain("ssrLoadModule('/e2e/geometry.ts')");
    expect(audit).toContain("ssrLoadModule('/app/src/core/breakpoints.ts')");
    expect(audit).toContain('ruleViolations(');
    for (const name of thresholds) expect(audit, `${name} is imported, never redefined`).not.toMatch(new RegExp(`const ${name}\b`));
    expect(audit, 'no type-floor walk of its own').not.toMatch(/createTreeWalker|parseFloat\([^)]*fontSize/);
  });

  it('mobile.spec.ts reads the thresholds from e2e/geometry.ts and walks no text of its own', () => {
    expect(spec).toMatch(/from '\.\/geometry'/);
    expect(spec).toContain('ruleViolations(');
    for (const name of thresholds) expect(spec, `${name} is imported, never redefined`).not.toMatch(new RegExp(`const ${name}\b`));
    expect(spec, 'no type-floor walk of its own').not.toMatch(/createTreeWalker|parseFloat\([^)]*fontSize/);
  });
});
