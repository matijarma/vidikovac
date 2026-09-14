import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The public screen's sheet read as text. The kiosk paints from the shared
// tokens (every `--k-*` colour is an alias of a `--tone-*` role, so the two
// faces, the OKLCH twins and the contrast proof live in tokens.css alone) and
// sets its type in four tiers per composition. The literals pinned here are
// the contract the rest of wave 5 builds on (T5.2's icons and board, T5.3's
// theme button, T5.4's portrait), so a fifth tier or a private colour has to
// be added here on purpose.
const CSS = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', 'kiosk.css'), 'utf8');
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const BARE = withoutComments(CSS);

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The declarations of the first rule whose prelude is exactly `selector`. */
function body(selector: string): string {
  const match = new RegExp(`(?:^|\\n)\\s*${escape(selector)} \\{([^}]*)\\}`).exec(BARE);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1]!;
}
/** A rule's declarations as a property -> value map. */
function decls(selector: string): Record<string, string> {
  return Object.fromEntries(
    body(selector).split(';').map((d) => d.trim()).filter(Boolean)
      .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
  );
}
/** Every rule (innermost, so a rule inside an at-rule counts on its own) whose declarations reference `var(--token)`. */
function rulesUsing(token: string): string[] {
  return [...BARE.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[2]!.includes(`var(${token})`))
    .map((m) => m[1]!.split(/[{\n]/).pop()!.trim());
}

// The QR plate is the one colour the kiosk owns: pure white with the light ink
// in both faces, because a scanner reads a plate, not a theme. Everything else
// is a token.
const QR_PLATE = [/--k-qr-plate: #[0-9a-f]{6};/, /--k-qr-ink: #[0-9a-f]{6};/];

describe('kiosk.css paints from the shared tokens', () => {
  it('carries no hex literal outside its comments except the two QR plate declarations', () => {
    for (const decl of QR_PLATE) expect(BARE.match(decl), decl.source).not.toBeNull();
    const rest = QR_PLATE.reduce((css, decl) => css.replace(decl, ''), BARE);
    expect(rest).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
  it('paints both QR plates from that pair rather than repeating it', () => {
    for (const selector of ['.k-qr .qr', '.k-join-qr .qr']) {
      const plate = decls(selector);
      expect(plate.background, selector).toBe('var(--k-qr-plate)');
      expect(plate.color, selector).toBe('var(--k-qr-ink)');
    }
  });
  const ALIASES: Record<string, string> = {
    '--k-canvas': '--tone-surface-canvas',
    '--k-surface': '--tone-surface-1',
    '--k-surface-2': '--tone-surface-2',
    '--k-ink': '--tone-text-primary',
    '--k-ink-2': '--tone-text-muted',
    // The kickers and source lines: the private grey measured about 4.0:1 on
    // the light surface; muted is the one secondary ink the design allows.
    '--k-ink-3': '--tone-text-muted',
    '--k-line': '--tone-stroke',
    '--k-action': '--tone-action-brand',
    '--k-action-ink': '--tone-action-brand-fg',
    '--k-action-soft': '--tone-tint-action',
    // Peacock text on the peacock tint (the session pill, a checked choice)
    // fails AA in light with the plain accent; the on-tint tone clears it.
    '--k-action-on-soft': '--tone-text-brand-on-tint',
    '--k-amber': '--tone-weather',
    '--k-amber-soft': '--tone-tint-weather',
    '--k-violet': '--tone-events',
    '--k-violet-soft': '--tone-tint-events',
    '--k-rose': '--tone-urgency',
    '--k-rose-soft': '--tone-tint-urgency',
    '--k-green': '--tone-live',
    '--k-focus': '--tone-focus-ring',
    '--k-glass': '--tone-glass-bg',
    '--k-shadow': '--tone-shadow-soft',
  };
  it.each(Object.entries(ALIASES))('%s is an alias of %s', (name, tone) => {
    expect(decls('.kiosk')[name]).toBe(`var(${tone})`);
  });
  it('declares its colours once: the tokens switch on data-theme-resolved, so the dark twin, the OKLCH twin and the dead face rules are gone', () => {
    expect(BARE).not.toMatch(/\[data-theme-resolved='dark'\][^{]*\.kiosk/);
    expect(BARE).not.toContain('prefers-color-scheme');
    expect(BARE).not.toContain('oklch(');
    expect(BARE).not.toContain('data-face');
    expect(BARE).not.toContain('.k-sunbar');
  });
  it('paints the page behind the screen from the canvas token too', () => {
    expect(decls('.kiosk-body').background).toBe('var(--tone-surface-canvas)');
  });
  it('gives the session pill and the checked choice the on-tint brand tone', () => {
    expect(decls('.k-session').color).toBe('var(--k-action-on-soft)');
    expect(decls('.k-choice input:checked + .k-choice-text').color).toBe('var(--k-action-on-soft)');
  });
});

describe('four type tiers per composition, each a token times --k-zoom', () => {
  const TIERS = {
    wide: { display: 72, main: 40, sup: 28, credit: 20 },
    compact: { display: 52, main: 28, sup: 22, credit: 16 },
  } as const;
  it.each(Object.entries(TIERS))('%s: display, main, supporting and credit', (size, px) => {
    const rule = decls(`.kiosk[data-size='${size}']`);
    expect(rule['--k-display-size']).toBe(`calc(${px.display}px * var(--k-zoom))`);
    expect(rule['--k-main-size']).toBe(`calc(${px.main}px * var(--k-zoom))`);
    expect(rule['--k-sup-size']).toBe(`calc(${px.sup}px * var(--k-zoom))`);
    expect(rule['--k-credit-size']).toBe(`calc(${px.credit}px * var(--k-zoom))`);
  });
  it('retired the two tiers below the brief (22/18 and 18/15 px) and the hero above it', () => {
    expect(BARE).not.toContain('--k-sup-2');
    expect(BARE).not.toContain('--k-meta-size');
    expect(BARE).not.toContain('--k-hero');
    expect(BARE).not.toContain('--k-temp:');
    expect(BARE).not.toContain('--k-code-size');
    expect(BARE).not.toContain('--k-main:');
    expect(BARE).not.toContain('--k-main-2');
    expect(BARE).not.toContain('--k-sup:');
  });
  it('sets every font-size from a tier token', () => {
    const sizes = [...BARE.matchAll(/font-size: ([^;]+);/g)].map((m) => m[1]!);
    expect(sizes.length).toBeGreaterThan(40);
    for (const size of sizes) expect(size).toMatch(/^(?:min\()?var\(--k-(?:display|main|sup|credit)-size\)/);
  });
  it('sets exactly two things at display per composition: the pairing code, capped to its column, and the temperature', () => {
    // A wide code (DQC2-WTMM) overflowed the 1366 card before the cap; the size follows the code column.
    expect(decls('.k-code')['font-size']).toBe('min(var(--k-display-size), 11.5cqi)');
    expect(decls('.k-invite-code')['container-type']).toBe('inline-size');
    expect(decls('.k-temp')['font-size']).toBe('var(--k-display-size)');
    expect(rulesUsing('--k-display-size').sort()).toEqual(['.k-code', '.k-join-code', '.k-temp']);
  });
  // Measured at 1920: a 72 px code leaves 218 px beside it, and the URL line's
  // one unbreakable word is wider than that, so the line ran out of the card.
  it('stacks the URL line under the code at every size, so a display-size code never pushes it out of the card', () => {
    expect(decls('.k-invite-code')['grid-template-columns']).toBe('minmax(0, 1fr)');
    expect(BARE).not.toContain(".kiosk[data-size='wide'] .k-invite-code .k-hint");
  });
  it('reserves the credit tier for attribution lines: .k-meta, which carries every k-source credit', () => {
    expect(rulesUsing('--k-credit-size')).toEqual(['.k-meta']);
  });
  it('gives the strip room for two supporting lines', () => {
    expect(decls(".kiosk[data-size='wide']")['--k-strip-h']).toBe('calc(88px * var(--k-zoom))');
    expect(decls(".kiosk[data-size='compact']")['--k-strip-h']).toBe('calc(72px * var(--k-zoom))');
    expect(decls('.k-strip')['font-size']).toBe('var(--k-sup-size)');
  });
  it('sets heads and lead sentences at main, lines and the story at supporting', () => {
    for (const head of ['.k-lead', '.k-headline', '.k-basics-title', '.k-setup-title', '.k-notice-title', '.k-figure', '.k-ess-value']) {
      expect(decls(head)['font-size'], head).toBe('var(--k-main-size)');
    }
    for (const line of ['.k-line-name', '.k-line-word', '.k-line-near', '.k-line-more', '.k-story-title', '.k-row-main', '.k-row-sub', '.k-strip']) {
      expect(decls(line)['font-size'], line).toBe('var(--k-sup-size)');
    }
  });
  it('carries the four tiers on a handheld too, at phone sizes with the credit line at the 13 px floor', () => {
    const rule = decls(".kiosk[data-size='handheld']");
    expect(rule['--k-display-size']).toBe('40px');
    expect(rule['--k-main-size']).toBe('24px');
    expect(rule['--k-sup-size']).toBe('18px');
    expect(rule['--k-credit-size']).toBe('13px');
  });
});

describe('the header context', () => {
  it('ends a long stop name with an ellipsis instead of a hard clip', () => {
    const context = decls('.k-context');
    expect(context.overflow).toBe('hidden');
    expect(context['text-overflow']).toBe('ellipsis');
    expect(context['white-space']).toBe('nowrap');
  });
});
