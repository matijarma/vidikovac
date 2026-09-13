import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AA_TEXT, contrastRatio, luminance } from '../../app/src/ui/contrast';
import { deltaE, hexToLinear, mixOklab, parseOklch, toHex, type Linear } from './oklab';

const TOKENS = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', 'tokens.css'), 'utf8');

/** `--palette-<theme>-<name>: #hex` as written in tokens.css. */
function palette(theme: 'dark' | 'light', name: string): string {
  const m = new RegExp(`--palette-${theme}-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(TOKENS);
  if (!m) throw new Error(`tokens.css has no hex for --palette-${theme}-${name}`);
  return m[1]!.toLowerCase();
}

/** `--palette-<theme>-<name>: oklch(...)`, the colour an engine renders, as linear sRGB. */
function rendered(theme: 'dark' | 'light', name: string): Linear {
  const m = new RegExp(`--palette-${theme}-${name}:[ ]*(oklch[(][^)]*[)])`).exec(TOKENS);
  if (!m) throw new Error(`tokens.css has no oklch for --palette-${theme}-${name}`);
  return parseOklch(m[1]!);
}

/** The tints as tokens.css mixes them: `color-mix(in oklab, var(--color-<colour>) <pct>%, var(--color-surface-1))`. */
function tints(): { name: string; colour: string; pct: number }[] {
  return [...TOKENS.matchAll(/--tint-([a-z]+):\s*color-mix\(in oklab, var\(--color-([a-z]+)\) (\d+)%, var\(--color-surface-1\)\)/g)]
    .map((m) => ({ name: m[1]!, colour: m[2]!, pct: Number(m[3]) / 100 }));
}

/** Which palette colour a theme assigns to `--color-<role>`. */
function assigned(theme: 'dark' | 'light', role: string): string {
  const m = new RegExp(`--color-${role}:[ ]*var[(]--palette-${theme}-([a-z0-9-]+)[)]`).exec(TOKENS);
  if (!m) throw new Error(`tokens.css assigns no --palette-${theme}-* colour to --color-${role}`);
  return m[1]!;
}

/** The 8-bit pixel of a tint over surface-1, as rendered. */
const tintHex = (theme: 'dark' | 'light', tint: { colour: string; pct: number }): string =>
  toHex(mixOklab(rendered(theme, tint.colour), tint.pct, rendered(theme, 'surface-1')));

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
  it('maps one on-tint brand tone per theme, the deeper peacock in light and the accent in dark, and carries it on the no-JS dark path too', () => {
    expect(assigned('light', 'link-on-tint')).toBe('accent-deep');
    expect(assigned('dark', 'link-on-tint')).toBe('accent');
    expect(TOKENS).toMatch(/--tone-text-brand-on-tint:\s*var\(--color-link-on-tint\)/);
    expect(TOKENS.match(/--color-link-on-tint:/g)?.length).toBe(3);
  });
  it('switches on data-theme-resolved, never on data-theme, so solar and auto share one path', () => {
    expect(TOKENS).toMatch(/:root\[data-theme-resolved='dark'\]/);
    expect(TOKENS).toMatch(/:root\[data-theme-resolved='light'\]/);
    expect(TOKENS).not.toMatch(/\[data-theme='(dark|light|auto|solar)'\]/);
  });
  it('paints light first and follows a dark OS preference without JavaScript', () => {
    expect(TOKENS).toMatch(/:root,\s*:root\[data-theme-resolved='light'\]/);
    expect(TOKENS).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme-resolved\]\)/);
  });
  it('never uses pure white or pure black as a large surface', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const surface of SURFACES) expect(['#ffffff', '#000000']).not.toContain(palette(theme, surface));
    }
  });
  it('writes every palette colour in OKLCH too, for engines that render it', () => {
    expect(TOKENS).toMatch(/@supports \(color: oklch\(/);
    expect(TOKENS).toMatch(/--palette-light-canvas: oklch\(/);
    expect(TOKENS).toMatch(/--palette-dark-accent: oklch\(/);
  });
});

describe('WCAG contrast arithmetic', () => {
  it('the OKLCH maths is exact at white and round-trips the measured palette', () => {
    expect(toHex(parseOklch('oklch(100% 0 0)'))).toBe('#ffffff');
    expect(toHex(hexToLinear('#08777b'))).toBe('#08777b');
  });
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

// The colours a browser paints are the OKLCH twins and the oklab tints, not
// the hex fallbacks; axe measured the safety block's links on those. This
// models exactly that rendering (8-bit sRGB) and holds it to AA.
describe.each(['dark', 'light'] as const)('%s palette as rendered in OKLCH', (theme) => {
  it('every OKLCH twin paints the same colour as its measured hex fallback', () => {
    for (const name of [...SURFACES, ...TEXTS, 'accent-deep']) {
      expect(deltaE(rendered(theme, name), hexToLinear(palette(theme, name))), `${theme} ${name}`).toBeLessThan(0.003);
    }
  });
  it('mixes six tints over surface-1 in oklab', () => {
    expect(tints().map((t) => t.name).sort()).toEqual(['action', 'events', 'success', 'transit', 'urgency', 'weather']);
  });
  it('on-tint links, muted text and ink meet AA on every tint as rendered', () => {
    const foregrounds = { link: rendered(theme, assigned(theme, 'link-on-tint')), muted: rendered(theme, 'text-muted'), ink: rendered(theme, 'text-primary') };
    for (const tint of tints()) {
      const fill = tintHex(theme, tint);
      for (const [label, fg] of Object.entries(foregrounds)) {
        const ratio = contrastRatio(toHex(fg), fill);
        expect(Number(ratio.toFixed(2)), `${theme} ${label} on tint ${tint.name} (${fill}) = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });
});

describe('why --tone-text-brand-on-tint exists', () => {
  it('the plain light accent falls under AA on every light tint as rendered, which is what axe measured on the safety block', () => {
    const accent = toHex(rendered('light', 'accent'));
    const failing = tints().filter((tint) => contrastRatio(accent, tintHex('light', tint)) < AA_TEXT);
    expect(failing.map((t) => t.name)).toContain('success');
    expect(failing).toHaveLength(tints().length);
  });
  it('the dark accent already clears AA on the dark tints, so dark keeps its accent', () => {
    const accent = toHex(rendered('dark', 'accent'));
    for (const tint of tints()) expect(contrastRatio(accent, tintHex('dark', tint)), tint.name).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

// The OKLAB mixes must actually win the cascade: the theme blocks select
// :root[data-theme-resolved], so a bare :root inside @supports would lose to
// them and the alpha fallbacks would render instead.
describe('tints in the cascade', () => {
  it('the @supports mix rule matches the theme blocks’ specificity and follows them', () => {
    const supports = TOKENS.indexOf('@supports (color: color-mix(in oklab, red 10%, blue))');
    // After the last theme block (the no-JS dark one), so it wins at equal specificity.
    expect(supports).toBeGreaterThan(TOKENS.indexOf('@media (prefers-color-scheme: dark)'));
    expect(supports).toBeGreaterThan(TOKENS.indexOf(":root[data-theme-resolved='dark'] {"));
    expect(TOKENS.slice(supports)).toMatch(/^[^{]*\{\s*:root\[data-theme-resolved\], :root:not\(\[data-theme-resolved\]\) \{/);
  });
  // Engines without color-mix composite the rgba fallbacks over whatever lies
  // beneath: surface-1 inside a section, the canvas on the overview.
  const fallbacks = [...TOKENS.matchAll(/--tint-([a-z]+):[ ]*rgba[(]([0-9]+), ([0-9]+), ([0-9]+), ([0-9.]+)[)]/g)]
    .map((m) => ({ name: m[1]!, rgb: [Number(m[2]), Number(m[3]), Number(m[4])], alpha: Number(m[5]) }));
  const byTheme = { light: fallbacks.slice(0, 6), dark: fallbacks.slice(6, 12) };
  const over = (tint: { rgb: number[]; alpha: number }, under: string): string => {
    const base = [1, 3, 5].map((i) => parseInt(under.slice(i, i + 2), 16));
    return `#${base.map((b, i) => Math.round(tint.alpha * tint.rgb[i]! + (1 - tint.alpha) * b).toString(16).padStart(2, '0')).join('')}`;
  };
  it('lists six rgba fallbacks per theme block', () => {
    expect(fallbacks).toHaveLength(18);
    expect(byTheme.light.map((t) => t.name)).toEqual(['action', 'weather', 'events', 'urgency', 'transit', 'success']);
  });
  it.each(['light', 'dark'] as const)('%s: on-tint links and muted text meet AA on the composited fallbacks too', (theme) => {
    const link = palette(theme, assigned(theme, 'link-on-tint'));
    const muted = palette(theme, 'text-muted');
    for (const tint of byTheme[theme]) {
      for (const under of [palette(theme, 'surface-1'), palette(theme, 'canvas')]) {
        const fill = over(tint, under);
        expect(contrastRatio(link, fill), `${theme} link on ${tint.name} over ${under} (${fill})`).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrastRatio(muted, fill), `${theme} muted on ${tint.name} over ${under} (${fill})`).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });
});

// Status and severity badges are a coloured word on the matching tint (base.css).
describe.each(['dark', 'light'] as const)('%s badge words on their tints as rendered', (theme) => {
  const pairs: [tint: string, text: string][] = [['weather', 'warning'], ['urgency', 'danger'], ['success', 'success'], ['events', 'events'], ['transit', 'transit']];
  it.each(pairs)('%s tint carries %s text at AA', (tintName, textName) => {
    const tint = tints().find((t) => t.name === tintName)!;
    const ratio = contrastRatio(toHex(rendered(theme, textName)), tintHex(theme, tint));
    expect(Number(ratio.toFixed(2)), `${theme} ${textName} on ${tintName} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
  });
  it('the action tint carries the on-tint brand tone, which layers.css gives the phase badge', () => {
    const tint = tints().find((t) => t.name === 'action')!;
    expect(contrastRatio(toHex(rendered(theme, assigned(theme, 'link-on-tint'))), tintHex(theme, tint))).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
