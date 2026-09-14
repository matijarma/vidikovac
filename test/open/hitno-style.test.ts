import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OUTPUT_PATH, PALETTE, TOKENS_PATH, buildStyles, readPalette } from '../../scripts/build-hitno-style.mjs';

// /hitno and /open/ paint the app's palette, but they may not load tokens.css
// (default-src 'none', one inline <style>). scripts/build-hitno-style.mjs
// copies the sRGB literals into worker/hitno/style.generated.ts at build time;
// this file proves the committed copy is that copy, so the palette cannot drift.
const ROOT = join(import.meta.dirname, '..', '..');
const TOKENS = readFileSync(TOKENS_PATH, 'utf8');
const GENERATED = readFileSync(OUTPUT_PATH, 'utf8');

/** `--palette-<scheme>-<name>: <literal>` as tokens.css writes it (the hex or rgba line, never the OKLCH twin). */
function tokenLiteral(scheme: 'light' | 'dark', name: string): string {
  const m = new RegExp(String.raw`--palette-${scheme}-${name}:\s*(#[0-9a-fA-F]{6}|rgba?\([^)]*\))\s*;`).exec(TOKENS);
  if (!m) throw new Error(`tokens.css has no sRGB literal for --palette-${scheme}-${name}`);
  return m[1]!.toLowerCase();
}

/** The `:root{...}` declarations of one scheme inside a generated stylesheet. */
function rootBlock(css: string, scheme: 'light' | 'dark'): string {
  const m = scheme === 'light'
    ? /^:root\{([^}]*)\}/m.exec(css)
    : /@media \(prefers-color-scheme:dark\)\{:root\{([^}]*)\}\}/.exec(css);
  if (!m) throw new Error(`generated style has no ${scheme} :root block`);
  return m[1]!;
}

function declared(block: string, property: string): string {
  const m = new RegExp(`(?:^|;)--${property}:([^;]+)`).exec(block);
  if (!m) throw new Error(`generated :root declares no --${property}`);
  return m[1]!.trim();
}

const { HITNO_STYLE, OPEN_STYLE, PAGE_PALETTE } = await import('../../worker/hitno/style.generated');

describe('the generated /hitno and /open/ style', () => {
  it('is exactly what the generator writes from tokens.css today (run node scripts/build-hitno-style.mjs when this fails)', () => {
    expect(GENERATED).toBe(buildStyles(TOKENS).source);
  });

  it('names the thirteen palette colours the brief lists, and nothing else, as custom properties', () => {
    expect(PALETTE.map(([token]) => token)).toEqual([
      'canvas', 'canvas-deep', 'surface-1', 'surface-2', 'text-primary', 'text-muted',
      'accent', 'accent-deep', 'warning', 'danger', 'success', 'border', 'border-strong',
    ]);
  });

  describe.each(['light', 'dark'] as const)('%s scheme', (scheme) => {
    it.each(PALETTE)('--palette-%s is copied verbatim as --%s', (token, property) => {
      const literal = tokenLiteral(scheme, token);
      expect(readPalette(TOKENS, scheme)[property]).toBe(literal);
      for (const css of [HITNO_STYLE, OPEN_STYLE, PAGE_PALETTE]) {
        expect(declared(rootBlock(css, scheme), property)).toBe(literal);
      }
    });
  });

  it('carries no colour literal outside the print block that is not a token value', () => {
    const tokens = new Set<string>();
    for (const scheme of ['light', 'dark'] as const) for (const [token] of PALETTE) tokens.add(tokenLiteral(scheme, token));
    for (const css of [HITNO_STYLE, OPEN_STYLE]) {
      const withoutPrint = css.replace(/@media print\{[\s\S]*$/, '');
      for (const hex of withoutPrint.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
        expect(tokens.has(hex.toLowerCase()), `${hex} is not a palette token`).toBe(true);
      }
    }
  });

  it('keeps the page contract: system stack, no font face, no import, no external URL, no script', () => {
    for (const css of [HITNO_STYLE, OPEN_STYLE]) {
      expect(css).toContain('system-ui');
      expect(css).not.toMatch(/@(import|font-face)/);
      expect(css).not.toMatch(/url\(/);
      expect(css).not.toContain('<');
      expect(css).not.toContain('!important');
    }
    expect(HITNO_STYLE).toContain('--r-lg:1rem');
    expect(HITNO_STYLE).toContain('--r-md:.75rem');
  });

  it('lays /hitno out as the brief says: sticky one-row TOC at 48 px, scroll padding, the numbers grid with 112 spanning two tracks, 44 px inline links', () => {
    expect(HITNO_STYLE).toContain('html{scroll-padding-top:3.5rem}');
    expect(HITNO_STYLE).toMatch(/nav\.toc\{[^}]*position:sticky/);
    expect(HITNO_STYLE).toMatch(/nav\.toc ul\{[^}]*flex-wrap:nowrap[^}]*overflow-x:auto/);
    expect(HITNO_STYLE).toMatch(/nav\.toc a\{[^}]*height:3rem/);
    expect(HITNO_STYLE).toMatch(/\.numbers\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(min\(9rem,45%\),1fr\)\)/);
    expect(HITNO_STYLE).toContain('.numbers li:first-child{grid-column:span 2}');
    expect(HITNO_STYLE).toMatch(/\.numbers span\{[^}]*font-size:\.875rem/);
    expect(HITNO_STYLE).toContain('.meta a,.src a,.stamp a,.empty a{display:inline-block;padding:.75rem .25rem;margin:0 -.25rem;line-height:1.25rem}');
    expect(HITNO_STYLE).toContain('.brand .mark{color:var(--accent)}');
  });

  it('lays /open/ out as the brief says: 46rem measure, a skip link, breakpoints at 30rem and 60rem', () => {
    expect(OPEN_STYLE).toMatch(/\.wrap\{[^}]*max-width:46rem/);
    expect(OPEN_STYLE).toMatch(/\.skip\{/);
    expect(OPEN_STYLE).toContain('@media (max-width:30rem){');
    expect(OPEN_STYLE).toContain('@media (min-width:60rem){');
  });

  it('is the only place a palette hex lives: the two renderers carry none', () => {
    for (const file of ['worker/hitno/render.ts', 'worker/open/index-page.ts']) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source.match(/#[0-9a-fA-F]{6}\b/g) ?? [], `${file} paints a literal colour`).toEqual([]);
    }
  });

  it('runs first in npm run build so a palette change reaches the pages', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.build.startsWith('node scripts/build-hitno-style.mjs && ')).toBe(true);
  });
});
