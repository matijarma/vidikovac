// T1.5 (plan "Design system", ruling R-D1): type roles as `--type-*`/`--lh-*`
// tokens in tokens.css Layer 0, the 13 px floor those roles enforce in
// layers.css, and that every pre-existing `--text-*` alias survived.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ui = (name: string): string => readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', name), 'utf8');
const TOKENS = ui('tokens.css');
const LAYERS = ui('layers.css');
const SIGNAGE = ui('signage.css');

// R-D1's exact names and values, verbatim.
const TYPE_ROLES: Record<string, string> = {
  '--type-numeral-xl': '3.5rem',
  '--type-numeral': '2.5rem',
  '--type-display': '1.75rem',
  '--type-title': '1.5rem',
  '--type-head': '1.125rem',
  '--type-body': '1rem',
  '--type-control': '0.875rem',
  '--type-secondary': '0.8125rem',
  '--type-meta': '0.75rem',
  '--type-tile-xl': '2rem',
  '--type-tile-l': '1.5rem',
  '--type-tile-m': '1.0625rem',
  '--type-tile-time': '1.25rem',
};
const LINE_HEIGHTS: Record<string, string> = {
  '--lh-tight': '1',
  '--lh-title': '1.2',
  '--lh-body': '1.4',
  '--lh-prose': '1.5',
};

// Every `--text-*` name tokens.css already defined before T1.5, so this task
// proves it added tokens rather than replacing them (R-D1: "nothing in wave
// 1 deletes a token").
const PRE_EXISTING_TEXT_TOKENS = [
  '--text-2xs', '--text-xs', '--text-sm', '--text-md', '--text-body', '--text-base',
  '--text-lg', '--text-xl', '--text-2xl', '--text-3xl', '--text-4xl', '--text-panel-title', '--text-meta',
];

describe('tokens.css: type roles (R-D1)', () => {
  it.each(Object.entries(TYPE_ROLES))('defines %s: %s', (name, value) => {
    const m = new RegExp(`${name}:\\s*${value.replace('.', '\\.')};`).exec(TOKENS);
    expect(m, `${name} should be ${value} in tokens.css`).not.toBeNull();
  });

  it.each(Object.entries(LINE_HEIGHTS))('defines %s: %s', (name, value) => {
    const m = new RegExp(`${name}:\\s*${value.replace('.', '\\.')};`).exec(TOKENS);
    expect(m, `${name} should be ${value} in tokens.css`).not.toBeNull();
  });

  it('adds the type roles in Layer 0, directly after the existing --text-* lines', () => {
    const textMetaAt = TOKENS.indexOf('--text-meta: 0.75rem;');
    const typeNumeralAt = TOKENS.indexOf('--type-numeral-xl:');
    const leadingTightAt = TOKENS.indexOf('--leading-tight:');
    expect(textMetaAt).toBeGreaterThan(0);
    expect(typeNumeralAt).toBeGreaterThan(textMetaAt);
    expect(leadingTightAt).toBeGreaterThan(typeNumeralAt);
  });

  it('keeps every --text-* token that existed before, unchanged aliases', () => {
    for (const name of PRE_EXISTING_TEXT_TOKENS) {
      expect(TOKENS, `${name} should still be defined`).toMatch(new RegExp(`${name}:\\s*[^;]+;`));
    }
    // Values are untouched, not just present.
    expect(TOKENS).toContain('--text-sm: 0.875rem;');
    expect(TOKENS).toContain('--text-meta: 0.75rem;');
    expect(TOKENS).toContain('--text-body: 1rem;');
  });
});

describe('contrast.test.ts keeps parsing tokens.css (brief acceptance check)', () => {
  it('still finds a hex and an oklch for the light and dark accent (the shape contrast.test.ts depends on)', () => {
    expect(TOKENS).toMatch(/--palette-light-accent:\s*#[0-9a-f]{6};/);
    expect(TOKENS).toMatch(/--palette-dark-accent:\s*#[0-9a-f]{6};/);
    expect(TOKENS).toMatch(/--palette-light-accent:\s*oklch\([^)]+\);/);
  });
});

describe('layers.css: the 13 px floor (T1.5)', () => {
  it('moves row seconds lines and timestamps to the secondary role', () => {
    expect(LAYERS).toMatch(/\.row-meta \{[^}]*font-size: var\(--type-secondary\);/);
    expect(LAYERS).toMatch(/\.dir-item \.row-sub \{[^}]*font-size: var\(--type-secondary\);/);
    expect(LAYERS).toMatch(/\.row-lead-small \{[^}]*font-size: var\(--type-secondary\);/);
    expect(LAYERS).toMatch(/\.sec-note \{[^}]*font-size: var\(--type-secondary\);/);
    expect(LAYERS).toMatch(/\.route-name \{[^}]*font-size: var\(--type-secondary\);/);
    expect(LAYERS).toMatch(/\.ev-allday \{[^}]*font-size: var\(--type-secondary\);/);
    expect(LAYERS).toMatch(/^\.agenda-day \{[^}]*font-size: var\(--type-secondary\);/m);
    expect(LAYERS).toMatch(/\.detail-facts div \{[^}]*font-size: var\(--type-secondary\);/);
    expect(LAYERS).toMatch(/\.ws-detail-hint \{[^}]*font-size: var\(--type-secondary\);/);
  });

  it('scopes .meta (base.css) to the secondary role only inside a workspace room, per the brief', () => {
    expect(LAYERS).toContain(".ws .meta { font-size: var(--type-secondary); }");
  });

  it('sets the time band tile family at its roles in signage.css: value tile-l, title tile-m, time tile-time, context and trail secondary, the xs badge secondary', () => {
    expect(SIGNAGE).toMatch(/\.tl-value \{[^}]*font-size: var\(--type-tile-l\);/);
    expect(SIGNAGE).toMatch(/\.tl-title \{[^}]*font-size: var\(--type-tile-m\);/);
    expect(SIGNAGE).toMatch(/\.tl-time \{[^}]*font-size: var\(--type-tile-time\);/);
    expect(SIGNAGE).toMatch(/\.tl-context, \.tl-trail \{[^}]*font-size: var\(--type-secondary\);/);
    expect(SIGNAGE).toMatch(/\.line\[data-size='xs'\] \{[^}]*font-size: var\(--type-secondary\);/);
    // layers.css sizes the band's own type from the roles too: the heads at title, the clock at numeral, the labels at secondary.
    expect(LAYERS).toMatch(/\.tb-h \{[^}]*font-size: var\(--type-title\);/);
    expect(LAYERS).toMatch(/\.tb-clock \{[^}]*font-size: var\(--type-numeral\);/);
    expect(LAYERS).toMatch(/\.tb-seg-btn \{[^}]*font-size: var\(--type-secondary\);/);
    expect(LAYERS).toMatch(/\.tb-empty \{[^}]*font-size: var\(--type-secondary\);/);
    expect(LAYERS).toMatch(/\.tb-more \{[^}]*font-size: var\(--type-control\);/);
  });

  it('leaves the changed rules at the body line height', () => {
    expect(LAYERS).toMatch(/\.row-meta \{[^}]*line-height: var\(--lh-body\);/);
    expect(LAYERS).toMatch(/\.dir-item \.row-sub \{[^}]*line-height: var\(--lh-body\);/);
  });

  it('keeps the attribution-level selectors at the meta size (12 px), never bumped', () => {
    expect(LAYERS).toMatch(/\.source-line \{[^}]*font-size: var\(--text-meta\);/);
    expect(LAYERS).toMatch(/\.provenance \{[^}]*font-size: var\(--text-meta\);/);
    expect(LAYERS).not.toMatch(/\.source-line \{[^}]*font-size: var\(--type-secondary\);/);
  });

  it('never touches the @container ws blocks (R-O1): no font-size appears in or after them', () => {
    const fromFirstContainer = /@container ws[\s\S]*$/.exec(LAYERS)?.[0] ?? '';
    expect(fromFirstContainer).not.toMatch(/font-size/);
  });
});

describe('the 13 px floor holds for the shared labels too (wave 1 merge gate: e2e/mobile.spec.ts test 5)', () => {
  const BASE = ui('base.css');
  it('kickers and badges in base.css sit at the secondary role, not the 12 px meta size', () => {
    expect(BASE).toMatch(/\.kicker \{[^}]*font-size: var\(--type-secondary\);/);
    expect(BASE).toMatch(/\.badge \{[^}]*font-size: var\(--type-secondary\);/);
  });
  it('emergency tile labels read at the control role, bar captions and figure legends at the secondary role, and no SVG text rule survives (T3.1 deleted the dial and the gauge that used them)', () => {
    // T3.2 sets the emergency numbers as signage tiles; the label role lives with the tile component and layers.css keeps no tile type of its own.
    expect(SIGNAGE).toMatch(/\.tile-label \{[^}]*font-size: var\(--type-control\);/);
    expect(LAYERS).not.toMatch(/\.sf-number-(label|value) \{/);
    expect(LAYERS).toMatch(/\.g-bar-caption \{[^}]*font-size: var\(--type-secondary\);/);
    expect(LAYERS).toMatch(/\.g-labels \{[^}]*font-size: var\(--type-secondary\);/);
    expect(LAYERS).not.toMatch(/\.g-(label|caption|value|label-strong) \{/);
  });
  it('the workspace toolbar keeps a scrolling chip row inside its own column instead of widening the page', () => {
    expect(LAYERS).toContain('.ws-toolbar { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-3); }');
    expect(LAYERS).toContain('.ws-toolbar > * { min-inline-size: 0; }');
  });
});

