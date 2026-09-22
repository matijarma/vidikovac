import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AA_TEXT, contrastRatio, luminance, parseCssColour, parseHex } from '../../app/src/ui/contrast';
import { deltaE, hexToLinear, mixOklab, parseOklch, toHex, type Linear } from './oklab';
import { OVERLAY_DARK, OVERLAY_LIGHT } from '../../app/src/map/basemap';

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
  // The bus: `--tone-action-brand-fg` on `--tone-transit`, the pair the line
  // badge (ui/signage.css), the map pill (map/basemap.ts) and the mode chip
  // all carry. #ffffff on #0c1250 light, #0b1150 on #9fb4ff dark.
  it('on-accent text is readable on the transit fill, which carries the bus badge and the bus pill', () => {
    const ratio = contrastRatio(palette(theme, 'on-accent'), palette(theme, 'transit'));
    expect(Number(ratio.toFixed(2)), `${theme} on-accent on transit = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
  });
  it('keeps subtle and muted distinct so the hierarchy survives', () => {
    expect(palette(theme, 'text-subtle')).not.toBe(palette(theme, 'text-muted'));
  });
});

// BAJS bike-share: one teal in both faces (owner ruling, round F "kiosk
// window"). The dot is a non-text graphic (WCAG 1.4.11's 3:1 floor); the
// count badge painted over it is text and clears the full AA text minimum.
describe.each(['dark', 'light'] as const)('BAJS bike-share teal (WP1)', (theme) => {
  it(`bike reads as a graphic at >= 3:1 on the ${theme} canvas`, () => {
    const ratio = contrastRatio(palette(theme, 'bike'), palette(theme, 'canvas'));
    expect(Number(ratio.toFixed(2)), `${theme} bike on canvas = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });
});
it('the count badge ink reads at 4.5:1 on the bike teal, in both faces', () => {
  for (const p of [OVERLAY_LIGHT, OVERLAY_DARK]) {
    expect(contrastRatio(p.bikeText, p.bike)).toBeGreaterThanOrEqual(AA_TEXT);
  }
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
  it('reads the colour forms the app actually produces, not only the hex fallbacks', () => {
    // tokens.css redefines the palette in OKLCH inside @supports, so this is
    // what --tone-text-primary resolves to in every current browser, and what
    // a canvas painter reading computed style is handed.
    const ink = 'oklch(25.159% 0.03844 252.41)';
    expect(parseCssColour(ink)).toEqual(parseOklch(ink)); // the port is the measured maths
    expect(luminance('rgb(128, 128, 128)')).toBeCloseTo(luminance('#808080'), 9);
    expect(luminance('rgb(100% 100% 100%)')).toBeCloseTo(1, 6);
    expect(luminance('rgba(0, 0, 0, 0.5)')).toBe(0);
  });
  it('rejects a colour nobody here can measure, loudly, instead of returning NaN', () => {
    expect(() => luminance('rebeccapurple')).toThrow(/unsupported colour/);
    expect(() => parseHex('oklch(100% 0 0)')).toThrow(/hex/);
  });
  it('measures a ZET line colour against the real light tones, which is what the schema chips ask it', () => {
    const ink = 'oklch(25.159% 0.03844 252.41)';   // --tone-text-primary
    const paper = 'oklch(96.573% 0.00514 247.88)'; // --tone-surface-canvas
    // The night lines' navy: unreadable in ink, plain in paper. Read as hex
    // before this understood oklch, both tones threw and ink always won.
    expect(Number(contrastRatio('#2f2483', ink).toFixed(2))).toBe(1.29);
    expect(Number(contrastRatio('#2f2483', paper).toFixed(2))).toBe(11.18);
    // And the other way for a line that is nearly paper itself (line 11).
    expect(contrastRatio('#fff481', ink)).toBeGreaterThan(contrastRatio('#fff481', paper));
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
    for (const name of [...SURFACES, ...TEXTS, 'accent-deep', 'transit']) {
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
  it('the accent clears AA on every tint in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const accent = toHex(rendered(theme, 'accent'));
      for (const tint of tints()) {
        expect(contrastRatio(accent, tintHex(theme, tint)), `${theme} accent on ${tint.name}`).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
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

// /hitno and /open/ cannot load tokens.css (default-src 'none'); their inline
// style is generated from the same hex literals (scripts/build-hitno-style.mjs
// -> worker/hitno/style.generated.ts). These are the pairs those pages paint:
// ink and muted text on the canvas, muted labels on the number tiles
// (surface-2), the accent as link colour, the three state colours as the
// severity and freshness words. Measured on the generated copy, not on
// tokens.css, so a stale copy fails here as well as in the parity test.
const GENERATED_STYLE = readFileSync(join(import.meta.dirname, '..', '..', 'worker', 'hitno', 'style.generated.ts'), 'utf8');

/** `--<name>:<hex>` inside the light `:root{}` or the dark `@media` block of the generated page palette. */
function generated(theme: 'dark' | 'light', name: string): string {
  const block = theme === 'light'
    ? /:root\{color-scheme:light dark;([^}]*)\}/.exec(GENERATED_STYLE)
    : /@media \(prefers-color-scheme:dark\)\{:root\{([^}]*)\}\}/.exec(GENERATED_STYLE);
  if (!block) throw new Error(`style.generated.ts has no ${theme} palette block`);
  const m = new RegExp(`(?:^|;)--${name}:(#[0-9a-f]{6})(?:;|$)`).exec(block[1]!);
  if (!m) throw new Error(`style.generated.ts ${theme} block has no hex for --${name}`);
  return m[1]!;
}

describe.each(['dark', 'light'] as const)('%s generated /hitno and /open/ palette meets WCAG AA 4.5:1', (theme) => {
  const pairs: [text: string, surface: string][] = [
    ['ink', 'canvas'], ['ink', 'surface-1'], ['ink', 'surface-2'],
    ['muted', 'canvas'], ['muted', 'surface-1'], ['muted', 'surface-2'],
    ['accent', 'canvas'], ['accent', 'surface-2'],
    ['warning', 'canvas'], ['danger', 'canvas'], ['success', 'canvas'],
    // The 112 tile is inverted: canvas-coloured numeral and label on ink.
    ['canvas', 'ink'],
  ];
  it.each(pairs)('%s on %s', (text, surface) => {
    const ratio = contrastRatio(generated(theme, text), generated(theme, surface));
    expect(Number(ratio.toFixed(2)), `${theme} ${text} on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
  });
  it('is the token palette, not a copy that drifted', () => {
    const roles: [generatedName: string, token: string][] = [
      ['canvas', 'canvas'], ['surface-1', 'surface-1'], ['surface-2', 'surface-2'], ['ink', 'text-primary'],
      ['muted', 'text-muted'], ['accent', 'accent'], ['warning', 'warning'], ['danger', 'danger'], ['success', 'success'],
    ];
    for (const [name, token] of roles) expect(generated(theme, name), name).toBe(palette(theme, token));
  });
});

// The public screen (ui/kiosk.css) paints from the same tokens through `--k-*`
// aliases, and kiosk-css.test.ts forbids a hex there. These resolve each alias
// through tokens.css to the colour a theme renders and hold the pairs the
// kiosk draws to AA: the source lines and kickers (`--k-ink-3`, which the
// private palette rendered at about 4.0:1 in light) and the second ink on
// every surface, the on-tint brand tone on the action tint (the session pill,
// a checked choice), the state words on their tints and on the surface, the
// button ink on the action fill, and the two inverted pills.
const KIOSK_CSS = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', 'kiosk.css'), 'utf8');

/** The `--tone-<role>` a kiosk alias `--k-<name>` points at. */
function kioskAlias(name: string): string {
  const m = new RegExp(`--k-${name}:[ ]*var[(]--tone-([a-z0-9-]+)[)]`).exec(KIOSK_CSS);
  if (!m) throw new Error(`kiosk.css does not alias --k-${name} to a --tone-* token`);
  return m[1]!;
}

/** The layer behind a tone: a `--color-<role>` the themes assign, or a `--tint-<name>` they mix. */
function toneTarget(role: string): { layer: 'color' | 'tint'; name: string } {
  const m = new RegExp(`--tone-${role}:[ ]*var[(]--(color|tint)-([a-z0-9-]+)[)]`).exec(TOKENS);
  if (!m) throw new Error(`tokens.css maps --tone-${role} to no --color-* or --tint-*`);
  return { layer: m[1] as 'color' | 'tint', name: m[2]! };
}

/** The 8-bit pixel a theme paints for a kiosk alias, as rendered (the OKLCH twin, or the oklab tint over surface-1). */
function kioskColour(theme: 'dark' | 'light', name: string): string {
  const target = toneTarget(kioskAlias(name));
  if (target.layer === 'tint') {
    const tint = tints().find((t) => t.name === target.name);
    if (!tint) throw new Error(`tokens.css mixes no --tint-${target.name}`);
    return tintHex(theme, tint);
  }
  return toHex(rendered(theme, assigned(theme, target.name)));
}

describe.each(['dark', 'light'] as const)('%s kiosk aliases meet WCAG AA 4.5:1 as rendered', (theme) => {
  const pairs: [text: string, surface: string][] = [
    ['ink-3', 'surface'], ['ink-3', 'canvas'], ['ink-3', 'surface-2'],
    ['ink-2', 'surface'], ['ink-2', 'canvas'], ['ink-2', 'surface-2'],
    ['ink', 'surface'], ['ink', 'canvas'], ['ink', 'surface-2'],
    ['action', 'surface'], ['action', 'canvas'],
    // The safety strip's calm verdict and a tile's "ontime" state word (C.4).
    ['amber', 'surface'], ['rose', 'surface'], ['violet', 'surface'], ['green', 'surface'],
    ['action-on-soft', 'action-soft'],
    ['amber', 'amber-soft'], ['rose', 'rose-soft'], ['violet', 'violet-soft'],
    ['ink', 'action-soft'], ['ink-2', 'action-soft'], ['ink-2', 'violet-soft'],
    ['action-ink', 'action'],
    // The strip's safety pill is ink inverted; the bus badge is the second ink inverted.
    ['canvas', 'ink'], ['canvas', 'ink-2'],
  ];
  it.each(pairs)('--k-%s on --k-%s', (text, surface) => {
    const ratio = contrastRatio(kioskColour(theme, text), kioskColour(theme, surface));
    expect(Number(ratio.toFixed(2)), `${theme} --k-${text} on --k-${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
  });
  it('resolves the source-line ink to the muted text role and the on-tint ink to the on-tint brand tone', () => {
    expect(kioskAlias('ink-3')).toBe('text-muted');
    expect(kioskAlias('action-on-soft')).toBe('text-brand-on-tint');
  });
});

// The wall of 22 September (WP1), as the kiosk paints it: the header
// sentence's kicker in its colour (Promet the action blue, Kultura violet,
// Vrijeme and Radovi amber, Bicikli the calm green, Noćas the second ink) on
// the header's surface; the "U blizini" rows' times (a live countdown blue, a
// timetable time grey, "uvijek" the muted ink) on the list's surface; the
// footer's green cross and "24/7" on the strip's surface. Every one of them is
// text or a symbol that carries meaning, so each clears the text minimum on the
// surface it sits on and on the canvas a handheld page shows through.
describe.each(['dark', 'light'] as const)('%s wall sentence, timeline and footer colours meet WCAG AA 4.5:1 (WP1)', (theme) => {
  const pairs: [use: string, colour: string][] = [
    ['kicker promet', 'action'], ['kicker kultura', 'violet'], ['kicker vrijeme', 'amber'],
    ['kicker bicikli', 'green'], ['kicker radovi', 'amber'], ['kicker nocas', 'ink-2'],
    ['live time', 'action'], ['timetable time', 'ink-2'], ['uvijek', 'ink-3'],
    ['green cross and 24/7', 'green'],
  ];
  it.each(pairs)('%s: --k-%s on the surface and the canvas', (use, colour) => {
    for (const surface of ['surface', 'canvas']) {
      const ratio = contrastRatio(kioskColour(theme, colour), kioskColour(theme, surface));
      expect(Number(ratio.toFixed(2)), `${theme} ${use} --k-${colour} on --k-${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
  it('the bike teal is a graphic colour and would fail as the Bicikli kicker, so the kicker takes the calm green', () => {
    // 3:1 for the map's discs (above), not the 4.5:1 a word needs.
    expect(contrastRatio(palette(theme, 'bike'), palette(theme, 'surface-1'))).toBeLessThan(AA_TEXT);
    expect(kioskAlias('green')).toBe('live');
  });
});
