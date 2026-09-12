import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AA_TEXT, contrastRatio, luminance } from '../../app/src/ui/contrast';

const TOKENS = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', 'tokens.css'), 'utf8');

/** `--palette-<theme>-<name>: #hex` as written in tokens.css. */
function palette(theme: 'dark' | 'light', name: string): string {
  const m = new RegExp(`--palette-${theme}-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(TOKENS);
  if (!m) throw new Error(`tokens.css has no hex for --palette-${theme}-${name}`);
  return m[1]!.toLowerCase();
}

const SURFACES = ['canvas', 'surface-1', 'surface-2'];
const TEXTS = ['text-primary', 'text-muted', 'text-subtle', 'accent', 'warning', 'danger', 'success', 'label'];

describe.each(['dark', 'light'] as const)('%s palette text pairs meet WCAG AA 4.5:1', (theme) => {
  for (const text of TEXTS) {
    for (const surface of SURFACES) {
      it(`${text} on ${surface}`, () => {
        const ratio = contrastRatio(palette(theme, text), palette(theme, surface));
        expect(Number(ratio.toFixed(2)), `${theme} ${text} on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
      });
    }
  }
  it('on-accent text is readable on the accent fill', () => {
    expect(contrastRatio(palette(theme, 'on-accent'), palette(theme, 'accent'))).toBeGreaterThanOrEqual(AA_TEXT);
  });
  it('keeps subtle and muted distinct so the hierarchy survives', () => {
    expect(palette(theme, 'text-subtle')).not.toBe(palette(theme, 'text-muted'));
  });
});

describe('tokens.css structure', () => {
  it('switches on data-theme-resolved, never on data-theme, so solar and auto share one path', () => {
    expect(TOKENS).toMatch(/:root\[data-theme-resolved='dark'\]/);
    expect(TOKENS).toMatch(/:root\[data-theme-resolved='light'\]/);
    expect(TOKENS).not.toMatch(/\[data-theme='(dark|light|auto|solar)'\]/);
  });
  it('has a no-JS light fallback keyed on the OS preference', () => {
    expect(TOKENS).toMatch(/@media \(prefers-color-scheme: light\)\s*\{\s*:root:not\(\[data-theme-resolved\]\)/);
  });
});

describe('WCAG contrast arithmetic', () => {
  it('black on white is 21:1 and a colour on itself is 1:1', () => {
    expect(Math.round(contrastRatio('#000000', '#ffffff'))).toBe(21);
    expect(contrastRatio('#64748b', '#64748b')).toBeCloseTo(1, 5);
  });
  it('is symmetric and accepts 3-digit hex', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(contrastRatio('#000000', '#ffffff'), 6);
  });
  it('luminance follows the sRGB curve', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 6);
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#808080')).toBeCloseTo(0.2159, 3);
  });
  it('rejects a non-hex value loudly instead of returning NaN', () => {
    expect(() => luminance('rgba(1,2,3,0.5)')).toThrow(/hex/);
  });
  it('the slate pair psdlat shipped really fails AA', () => {
    expect(contrastRatio('#94a3b8', '#f1f5f9')).toBeLessThan(AA_TEXT);
  });
});
