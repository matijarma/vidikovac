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
    for (const line of ['.k-line-name', '.k-line-word', '.k-line-near', '.k-line-more', '.k-story-item .k-story-title', '.k-row-main', '.k-row-sub', '.k-strip']) {
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

// T5.2: the side column composed to R-K7, one badge component, icons at the
// kiosk's sizes, and a rotation that reports a fact and stops under reduced
// motion or lightweight.
describe('T5.2: the composition, the badge, the icons and the rotation', () => {
  it('the invitation side column is a grid of three rows with the card pinned to the second', () => {
    const side = decls('.k-invitation .k-side');
    expect(side.display).toBe('grid');
    expect(side['grid-template-rows']).toBe('auto auto minmax(0, 1fr)');
    expect(decls('.k-invitation .k-weather')['grid-row']).toBe('1');
    expect(decls('.k-invitation .k-invite')['grid-row']).toBe('2');
    expect(decls('.k-invitation .k-story')['grid-row']).toBe('3');
  });
  it('the card is QR-bound: the text column holds the lead and the hint above the code, the host line never wraps', () => {
    expect(decls('.k-invite')['grid-template-areas']).toBe("'qr text' 'code code'");
    expect(decls(".kiosk[data-size='compact'] .k-invite")['grid-template-areas']).toBe("'qr text' 'qr code'");
    const text = decls('.k-invite-text');
    expect(text.display).toBe('flex');
    expect(text['flex-direction']).toBe('column');
    // Scoped under the text column: `.kiosk p { margin: 0 }` would otherwise outrank a bare class.
    expect(decls('.k-invite-text .k-hint')['margin-top']).toBe('auto');
    const host = decls('.k-hint-host');
    expect(host.display).toBe('block');
    expect(host['white-space']).toBe('nowrap');
    expect(host.overflow).toBe('hidden');
    expect(host['text-overflow']).toBe('ellipsis');
    // The support sentence stays on the handheld's card alone (a phone scrolls; the wall's card has no fourth line).
    expect(BARE.match(/\.k-support/g)).toHaveLength(1);
    expect(BARE).toContain(".kiosk[data-size='handheld'] .k-support");
  });
  it('the lockup: a 48 px condition icon, inline icons at 28/22, and the story title clamped by its room', () => {
    const icon = decls('.kiosk .k-weather-icon');
    expect(icon.width).toBe('calc(48px * var(--k-zoom))');
    expect(icon.height).toBe('calc(48px * var(--k-zoom))');
    expect(decls(".kiosk[data-size='wide']")['--k-icon-size']).toBe('calc(28px * var(--k-zoom))');
    expect(decls(".kiosk[data-size='compact']")['--k-icon-size']).toBe('calc(22px * var(--k-zoom))');
    expect(decls('.kiosk .k-icon').width).toBe('var(--k-icon-size)');
    expect(decls('.k-story-item .k-story-title')['-webkit-line-clamp']).toBe('2');
    // The title never shrinks in the flex column: a line without room overflows the block instead, which the fit measures.
    expect(decls('.k-story-item .k-story-title').flex).toBe('none');
    const facts = decls('.k-weather-details');
    expect(facts['white-space']).toBe('nowrap');
    expect(facts['text-overflow']).toBe('ellipsis');
    expect(decls(".k-story[data-lines='1'] .k-story-title")['-webkit-line-clamp']).toBe('1');
    expect(BARE).not.toContain('.k-weather-sun');
  });
  it('one badge: .k-line-badge keeps the kiosk geometry and no colour of its own; .line paints the mode', () => {
    const badge = decls('.kiosk .k-line-badge');
    expect(badge['min-width']).toBe('var(--k-badge)');
    expect(badge.height).toBe('calc(var(--k-badge) * 0.62)');
    expect(badge['font-size']).toBe('var(--k-sup-size)');
    expect(badge.background).toBeUndefined();
    expect(badge.color).toBeUndefined();
    expect(badge['border-radius']).toBeUndefined();
    expect(BARE).not.toContain(".k-line[data-kind='bus'] .k-line-badge");
    expect(BARE).not.toMatch(/\n\.k-line-badge \{/);
  });
  it('the severity badge is the shared .badge at the supporting tier with its shape scaled to the word', () => {
    expect(decls('.k-badge')['font-size']).toBe('var(--k-sup-size)');
    expect(decls('.k-badge::before')['inline-size']).toBe('0.5em');
  });
  it('the departure board keeps five single-line rows: --k-block-min for the board at both sizes', () => {
    expect(decls(".kiosk[data-size='wide'] .k-block--board")['--k-block-min']).toMatch(/^calc\(\d+px \* var\(--k-zoom\)\)$/);
    expect(decls(".kiosk[data-size='compact'] .k-block--board")['--k-block-min']).toMatch(/^calc\(\d+px \* var\(--k-zoom\)\)$/);
    const row = decls('.k-row--line');
    expect(row.display).toBe('flex');
    expect(row['align-items']).toBe('center');
    // The destination column takes what the badge, the word and the count leave; the count has no fixed width to steal from it.
    expect(decls('.k-row--line .k-row-aside')['min-width']).toBeUndefined();
    expect(decls('.k-main .k-weather-details')['white-space']).toBe('normal');
  });
  it('the rotation: the outgoing story fades 180 ms, the incoming settles 220 ms on --ease-enter, the code crossfades 180 ms, the bar keeps its linear second', () => {
    expect(decls('.k-story-item').animation).toBe('k-story-in 220ms var(--ease-enter) both');
    expect(decls('.k-story-item[data-leaving]').animation).toBe('k-story-out 180ms var(--ease-exit) both');
    expect(decls('.k-story-item[data-leaving]').position).toBe('absolute');
    expect(decls(".k-code[data-swap='1']").animation).toBe('k-code-in 180ms var(--ease-enter) both');
    expect(decls('.k-code-ghost').animation).toBe('k-story-out 180ms var(--ease-exit) both');
    expect(decls('.k-progress-bar').transition).toBe('width 1s linear');
    expect(BARE).toMatch(/@keyframes k-story-in \{ from \{ opacity: 0; transform: translateY\(calc\(6px \* var\(--k-zoom\)\)\); \}/);
  });
  it('both animations stop under reduced motion and lightweight, and the leaving copies never show', () => {
    const reduced = BARE.slice(BARE.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const rule of ['.kiosk .k-story-item', ".kiosk .k-code[data-swap='1']", ".kiosk .k-join-code[data-swap='1']"]) expect(reduced).toContain(rule);
    expect(reduced).toMatch(/\.kiosk \.k-story-item\[data-leaving\], \.kiosk \.k-code-ghost \{ display: none; \}/);
    expect(BARE).toMatch(/:root\[data-lagano='1'\] \.k-story-item, :root\[data-lagano='1'\] \.k-code\[data-swap='1'\], :root\[data-lagano='1'\] \.k-join-code\[data-swap='1'\] \{ animation: none; \}/);
    expect(BARE).toMatch(/:root\[data-lagano='1'\] \.k-story-item\[data-leaving\], :root\[data-lagano='1'\] \.k-code-ghost \{ display: none; \}/);
  });
});

// T5.3: the theme button, literally 44 px (the WCAG floor, not a --k-control
// scale) and left of the clock in its own row so the two share a line.
describe('T5.3: the theme button is a literal 44 px target beside the clock', () => {
  it('sets a 44 px minimum height on the button itself, sized from a tier token, not the composition scale', () => {
    const btn = decls('.k-theme');
    expect(btn['min-height']).toBe('44px');
    expect(btn['font-size']).toBe('var(--k-sup-size)');
    expect(btn.cursor).toBe('pointer');
  });
  it('lays the clock row out left to right so the button sits directly before the clock', () => {
    const row = decls('.k-clock-row');
    expect(row.display).toBe('flex');
    expect(row['align-items']).toBe('center');
  });
});

// T5.4: the portrait totem (1080 x 1920; kiosk/layout.ts gives it the compact
// tokens at zoom 1). One column: the map on top at 55% of the stage with the
// board over its foot, the invitation card across the width, the weather and
// the story side by side under it; the paired compositions stack the same
// way. Compact tiers and the compact 240 px QR, nothing re-sized: the
// portrait rules place blocks and set no token.
describe('T5.4: the portrait composition', () => {
  const P = ".kiosk[data-portrait='1']";
  it('stacks the stage: the map (or the paired main region) on top at 55% of the stage, the side column with the rest', () => {
    const stage = decls(`${P} .k-invitation, ${P} .k-paired`);
    expect(stage['grid-template-columns']).toBe('minmax(0, 1fr)');
    // The map at 55% at least and the side at its content height, on the invitation as on a paired map layer.
    expect(stage['grid-template-rows']).toBe('minmax(55%, 1fr) minmax(0, auto)');
  });
  it('lays the invitation side column out as two columns: the card across both, the weather and the story side by side under it', () => {
    const side = decls(`${P} .k-invitation .k-side`);
    expect(side['grid-template-columns']).toBe('repeat(2, minmax(0, 1fr))');
    expect(side['grid-template-rows']).toBe('auto auto');
    expect(side['column-gap']).toBe('var(--k-gap)');
    const card = decls(`${P} .k-invitation .k-invite`);
    expect(card['grid-column']).toBe('1 / -1');
    expect(card['grid-row']).toBe('1');
    const weather = decls(`${P} .k-invitation .k-weather`);
    expect(weather['grid-column']).toBe('1');
    expect(weather['grid-row']).toBe('2');
    const story = decls(`${P} .k-invitation .k-story`);
    expect(story['grid-column']).toBe('2');
    expect(story['grid-row']).toBe('2');
  });
  it('lets the map take the room on a paired map layer: the side column at its content height, never more than the room, the map the rest and 55% at least', () => {
    expect(decls(`${P} .k-paired:has(> .k-map)`)['grid-template-rows']).toBe('minmax(55%, 1fr) minmax(0, auto)');
  });
  it('centres the content of the two tiles in the room the last row has, the leaving story copy with it', () => {
    expect(decls(`${P} .k-invitation .k-weather`)['justify-content']).toBe('center');
    expect(decls(`${P} .k-story-item`)['justify-content']).toBe('center');
  });
  it('keeps the compact tiers and the 240 px QR: the portrait rules place blocks and set no token, and the old content-height stack is gone', () => {
    const start = BARE.indexOf(P);
    const end = BARE.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const portrait = BARE.slice(start, end);
    expect(portrait).not.toMatch(/--k-[a-z-]+:/);
    expect(portrait).not.toContain('font-size');
    expect(BARE).not.toContain(`${P} .k-invitation, ${P} .k-paired { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }`);
    expect(BARE).not.toContain(`${P} .k-side-blocks { flex: none; }`);
  });
});

describe('the compact header holds its date, and an empty side seats the join card at the foot (controller, wave 5 merge)', () => {
  const css = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', 'kiosk.css'), 'utf8');
  it('lays the date beside the clock row in the compact and portrait headers, where stacking them measured 71 px in a 60 px header', () => {
    expect(css).toContain(".kiosk[data-size='compact'] .k-head-when { display: flex; align-items: center; justify-content: flex-end; gap: var(--k-gap); }");
  });
  it('pushes the join card to the foot when the side has no blocks (Vijesti in portrait)', () => {
    expect(css).toContain('.k-side-blocks:empty + .k-join { margin-top: auto; }');
  });
});

