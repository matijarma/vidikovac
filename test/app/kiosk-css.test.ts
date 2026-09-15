import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The public screen's sheet read as text. The kiosk paints from the shared
// tokens (every `--k-*` colour is an alias of a `--tone-*` role, so the two
// faces, the OKLCH twins and the contrast proof live in tokens.css alone) and
// sets its type in eleven tiers per composition. The literals pinned here are
// the contract the rest of the wave builds on (T2.9's scenes, T2.10's
// invitation, T2.11's arithmetic), so a twelfth tier or a private colour has
// to be added here on purpose.
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
  it('paints both QR plates from that pair rather than repeating it, with the D1(d) ink', () => {
    expect(BARE).toMatch(/--k-qr-ink: #0c1250;/);
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
    '--k-ink-3': '--tone-text-muted',
    '--k-line': '--tone-stroke',
    '--k-action': '--tone-action-brand',
    '--k-action-ink': '--tone-action-brand-fg',
    '--k-action-soft': '--tone-tint-action',
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
  it('declares its colours once: the tokens switch on data-theme-resolved, so a dark twin, an OKLCH twin or a dead face rule would be a regression', () => {
    expect(BARE).not.toMatch(/\[data-theme-resolved='dark'\][^{]*\.kiosk/);
    expect(BARE).not.toContain('prefers-color-scheme');
    expect(BARE).not.toContain('oklch(');
    expect(BARE).not.toContain('data-face');
  });
  it('paints the page behind the screen from the canvas token too', () => {
    expect(decls('.kiosk-body').background).toBe('var(--tone-surface-canvas)');
  });
  it('gives the session pill and the checked choice the on-tint brand tone', () => {
    expect(decls('.k-session').color).toBe('var(--k-action-on-soft)');
    expect(decls('.k-choice input:checked + .k-choice-text').color).toBe('var(--k-action-on-soft)');
  });
});

describe('eleven type tiers per composition, each a token times --k-zoom', () => {
  const TIERS = {
    wide: { display: 84, clock: 48, main: 40, sup: 28, hint: 26, sceneTime: 56, label: 24, tile: 32, credit: 20 },
    compact: { display: 64, clock: 36, main: 28, sup: 22, hint: 20, sceneTime: 40, label: 18, tile: 24, credit: 16 },
  } as const;
  const TOKEN: Record<keyof (typeof TIERS)['wide'], string> = {
    display: '--k-display-size', clock: '--k-clock-size', main: '--k-main-size', sup: '--k-sup-size',
    hint: '--k-hint-size', sceneTime: '--k-scene-time-size', label: '--k-label-size', tile: '--k-tile-size', credit: '--k-credit-size',
  };
  it.each(Object.entries(TIERS))('%s: every tier token', (size, px) => {
    const rule = decls(`.kiosk[data-size='${size}']`);
    for (const [key, token] of Object.entries(TOKEN) as [keyof typeof px, string][]) {
      expect(rule[token], token).toBe(`calc(${px[key]}px * var(--k-zoom))`);
    }
  });
  it('sets every font-size from a tier token', () => {
    const sizes = [...BARE.matchAll(/font-size: ([^;]+);/g)].map((m) => m[1]!);
    expect(sizes.length).toBeGreaterThan(40);
    for (const size of sizes) expect(size).toMatch(/^(?:min\()?var\(--k-(?:display|clock|main|sup|hint|scene-time|label|tile|credit)-size\)/);
  });
  it('reserves display for exactly the pairing codes, capped to their column (D17)', () => {
    expect(decls('.k-code')['font-size']).toBe('min(var(--k-display-size), 15cqi)');
    expect(decls('.k-invite > .k-invite-code')['container-type']).toBe('inline-size');
    expect(rulesUsing('--k-display-size').sort()).toEqual(['.k-code', '.k-join-code']);
  });
  it('moves .k-temp from display to main: the header weather group and the paired weather block share the token', () => {
    expect(decls('.k-temp')['font-size']).toBe('var(--k-main-size)');
  });
  it('reserves the credit tier for attribution lines: .k-meta alone', () => {
    expect(rulesUsing('--k-credit-size')).toEqual(['.k-meta']);
  });
  it('gives the header and the strip a fixed 96/72 px row, equal at both', () => {
    expect(decls(".kiosk[data-size='wide']")['--k-head-h']).toBe('calc(96px * var(--k-zoom))');
    expect(decls(".kiosk[data-size='wide']")['--k-strip-h']).toBe('calc(96px * var(--k-zoom))');
    expect(decls(".kiosk[data-size='compact']")['--k-head-h']).toBe('calc(72px * var(--k-zoom))');
    expect(decls(".kiosk[data-size='compact']")['--k-strip-h']).toBe('calc(72px * var(--k-zoom))');
    expect(decls('.k-head').height).toBe('var(--k-head-h)');
    expect(decls('.k-strip').height).toBe('var(--k-strip-h)');
    expect(decls('.k-strip')['font-size']).toBe('var(--k-hint-size)');
  });
  it('pins the invitation and paired side widths as separate tokens', () => {
    expect(decls(".kiosk[data-size='wide']")['--k-side-w']).toBe('calc(600px * var(--k-zoom))');
    expect(decls(".kiosk[data-size='compact']")['--k-side-w']).toBe('calc(520px * var(--k-zoom))');
    expect(decls(".kiosk[data-size='wide']")['--k-paired-side-w']).toBe('calc(720px * var(--k-zoom))');
    expect(decls(".kiosk[data-size='compact']")['--k-paired-side-w']).toBe('calc(540px * var(--k-zoom))');
    expect(decls('.k-invitation')['grid-template-columns']).toBe('minmax(0, 1fr) var(--k-side-w)');
    expect(decls('.k-paired')['grid-template-columns']).toBe('minmax(0, 1fr) var(--k-paired-side-w)');
  });
  it('keeps the QR at 240 px at every landscape size', () => {
    expect(decls(".kiosk[data-size='wide']")['--k-qr']).toBe('calc(240px * var(--k-zoom))');
    expect(decls(".kiosk[data-size='compact']")['--k-qr']).toBe('calc(240px * var(--k-zoom))');
  });
  it('roles: .k-scene-title at main, .kiosk .tl-value at tile, .kiosk .tl-time at scene-time, .kiosk .tl-label at label, .k-hint/.k-date/.k-strip at hint', () => {
    expect(decls('.k-scene-title')['font-size']).toBe('var(--k-main-size)');
    expect(decls('.kiosk .tl-value')['font-size']).toBe('var(--k-tile-size)');
    expect(decls('.kiosk .tl-time')['font-size']).toBe('var(--k-scene-time-size)');
    expect(decls('.kiosk .tl-label')['font-size']).toBe('var(--k-label-size)');
    expect(decls('.k-invite > .k-hint')['font-size']).toBe('var(--k-hint-size)');
    expect(decls('.k-date')['font-size']).toBe('var(--k-hint-size)');
    expect(decls('.k-strip')['font-size']).toBe('var(--k-hint-size)');
  });
  it('carries every tier on a handheld too, at phone sizes with the credit line at the 13 px floor', () => {
    const rule = decls(".kiosk[data-size='handheld']");
    expect(rule['--k-display-size']).toBe('40px');
    expect(rule['--k-clock-size']).toBe('24px');
    expect(rule['--k-main-size']).toBe('24px');
    expect(rule['--k-sup-size']).toBe('18px');
    expect(rule['--k-hint-size']).toBe('18px');
    expect(rule['--k-scene-time-size']).toBe('24px');
    expect(rule['--k-label-size']).toBe('14px');
    expect(rule['--k-tile-size']).toBe('18px');
    expect(rule['--k-credit-size']).toBe('13px');
  });
});

describe('the header context chip', () => {
  it('is an ink pill on paper and a paper pill on night (kajimafix 03.1; the accent stays with badges and the card), ellipsised rather than hard-clipped', () => {
    const context = decls('.k-context');
    expect(context.background).toBe('var(--k-ink)');
    expect(context.color).toBe('var(--k-canvas)');
    expect(BARE).not.toContain('.k-brand-sub');
    expect(BARE).not.toContain('.k-context-sub');
    expect(context.overflow).toBe('hidden');
    expect(context['text-overflow']).toBe('ellipsis');
    expect(context['white-space']).toBe('nowrap');
  });
  it('lays the date and the clock row out in one universal row, right-aligned, the same rule at every size', () => {
    const when = decls('.k-head-when');
    expect(when.display).toBe('flex');
    expect(when['justify-content']).toBe('flex-end');
    expect(when['margin-left']).toBe('auto');
    expect(BARE).not.toMatch(/\[data-size='compact'\] \.k-head-when \{/);
  });
});

describe('the theme button is a literal 44 px target beside the clock, then the weather group', () => {
  it('sets a 44 px minimum square on the button itself, a glyph with no words, sized from the hint tier, not the composition scale', () => {
    const btn = decls('.k-theme');
    expect(btn['min-height']).toBe('44px');
    expect(btn['min-width']).toBe('44px');
    expect(btn.border).toBe('0');
    expect(btn['font-size']).toBe('var(--k-hint-size)');
    expect(btn.cursor).toBe('pointer');
  });
  it('lays the clock row out left to right so the button sits directly before the clock, then the weather group', () => {
    const row = decls('.k-clock-row');
    expect(row.display).toBe('flex');
    expect(row['align-items']).toBe('center');
  });
  it('sizes the condition icon at the large icon token and the clock at its own token', () => {
    expect(decls('.kiosk .k-weather-icon').width).toBe('var(--k-icon-lg)');
    expect(decls(".kiosk[data-size='wide']")['--k-icon-lg']).toBe('calc(48px * var(--k-zoom))');
    expect(decls(".kiosk[data-size='compact']")['--k-icon-lg']).toBe('calc(36px * var(--k-zoom))');
    expect(decls('.k-clock')['font-size']).toBe('var(--k-clock-size)');
  });
});

describe('the safety strip: the verdict pill, the countdown, no sun line', () => {
  it('gives the verdict pill a colour per level and drops the old sun sub-line entirely', () => {
    expect(decls(".k-strip-verdict[data-level='calm']").color).toBe('var(--k-green)');
    expect(decls(".k-strip-verdict[data-level='urgent']").background).toBe('var(--k-rose-soft)');
    expect(decls(".k-strip-verdict[data-level='unknown']").background).toBe('var(--k-amber-soft)');
    expect(BARE).not.toContain('.k-strip-sub');
    expect(BARE).not.toContain('.k-strip-item--sun');
    expect(BARE).not.toContain('k-strip--nosun');
    expect(BARE).not.toContain('k-strip--nosub');
  });
  it('hides the countdown when the field has no room, or is not rotating', () => {
    const rule = body(".k-strip-next[hidden], .k-strip--nonext .k-strip-next");
    expect(rule.trim()).toBe('display: none;');
  });
});

describe('the scene field: transitions and grids', () => {
  it('animates a scene swap on k-scene-in/out, the leaving copy positioned out of flow', () => {
    expect(decls('.k-scene-item').animation).toBe('k-scene-in 220ms var(--ease-enter) both');
    expect(decls('.k-scene-item[data-leaving]').animation).toBe('k-scene-out 180ms var(--ease-exit) both');
    expect(decls('.k-scene-item[data-leaving]').position).toBeUndefined();
    expect(decls('.k-scene-item').position).toBe('absolute');
    expect(decls('.k-code-ghost').animation).toBe('k-scene-out 180ms var(--ease-exit) both');
    expect(decls('.k-progress-bar').transition).toBe('width 1s linear');
    expect(BARE).toMatch(/@keyframes k-scene-in \{ from \{ opacity: 0; transform: translateY\(calc\(6px \* var\(--k-zoom\)\)\); \}/);
  });
  it('lays the Promet grid out as the map beside one column that stacks the lines and the works band from the top at their own height: three tiles across at wide, two at compact (kajimafix 03.3)', () => {
    const grid = decls('.k-scene-grid');
    expect(grid['grid-template-columns']).toBe('minmax(0, 1fr) minmax(0, 2fr)');
    expect(grid['grid-template-rows']).toBe('minmax(0, 1fr)');
    expect(decls('.k-scene-grid > .k-map')['grid-row']).toBe('1 / -1');
    const col = decls('.k-scene-col');
    expect(col['grid-auto-rows']).toBe('max-content');
    expect(col['align-content']).toBe('start');
    const lines = decls('.k-scene-lines');
    expect(lines['grid-template-columns']).toBe('repeat(3, minmax(0, 1fr))');
    expect(lines['grid-auto-rows']).toBe('max-content');
    expect(decls(".kiosk[data-size='compact'] .k-scene-grid")['grid-template-columns']).toBe('minmax(0, 1fr) minmax(0, 1.3fr)');
    expect(decls(".kiosk[data-size='compact'] .k-scene-lines")['grid-template-columns']).toBe('repeat(2, minmax(0, 1fr))');
    expect(BARE).not.toContain("[data-works='0']");
    // The line tile is its content: the badge at control height, the ends line, the state word at main size.
    expect(decls('.kiosk .k-tl-line')['align-content']).toBe('start');
    expect(decls('.kiosk .k-tl-line .k-line-badge').height).toBe('var(--k-control)');
    expect(decls('.kiosk .k-tl-line .tl-value')['font-size']).toBe('var(--k-main-size)');
    expect(decls('.kiosk .k-tl-name')['font-size']).toBe('var(--k-sup-size)');
    // Scene dots (kajimafix 03.2): 10 px, ink when current, a stroke otherwise.
    expect(decls('.k-dot').width).toBe('calc(10px * var(--k-zoom))');
    expect(decls('.k-dot').background).toBe('transparent');
    expect(decls(".k-dot[data-on='1']").background).toBe('var(--k-ink)');
    // The evening's rows are hairline rows from the top, not boxes; an xs badge in a context scales to 28 px.
    expect(decls('.k-scene-rows')['grid-auto-rows']).toBe('max-content');
    expect(decls(".kiosk .k-scene-rows .tl[data-variant='time']").background).toBe('transparent');
    expect(decls(".kiosk .k-scene-rows .tl[data-variant='time'][data-tint='events']")['border-top']).toBe('2px solid var(--k-violet)');
    expect(decls(".kiosk .line[data-size='xs']")['block-size']).toBe('calc(28px * var(--k-zoom))');
  });
  it('gives the lagano board the whole scene (D12): data-board=1 is one column, one row', () => {
    const board = decls(".k-scene-grid[data-board='1']");
    expect(board['grid-template-columns']).toBe('minmax(0, 1fr)');
    expect(board['grid-template-rows']).toBe('minmax(0, 1fr)');
  });
  it('the code\'s dot is dimmed and the 8 px bar fills paper over a quarter-paper track on the accent (kajimafix 03.4)', () => {
    expect(decls('.k-code-dash').opacity).toBe('0.4');
    expect(decls('.k-progress').background).toBe('color-mix(in oklab, var(--k-action-ink) 25%, var(--k-action))');
    expect(decls('.k-progress')['box-shadow']).toBeUndefined();
  });
  it('the strip has no Osnovno chip: the verdict is the 44 px button', () => {
    expect(BARE).not.toContain('.k-strip-basics');
    expect(decls('.k-strip-verdict')['min-height']).toBe('44px');
    expect(decls('button.k-strip-verdict').cursor).toBe('pointer');
  });
  it('spans the ink tile down the Grad grid\'s first column', () => {
    expect(decls('.k-scene-grad')['grid-template-rows']).toBe('repeat(3, minmax(0, 1fr))');
    expect(decls(".k-scene-grad > .tl[data-variant='ink']")['grid-row']).toBe('1 / -1');
  });
  it('both animations stop under reduced motion and lightweight, and the leaving copies never show', () => {
    const reduced = BARE.slice(BARE.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const rule of ['.kiosk .k-scene-item', ".kiosk .k-code[data-swap='1']", ".kiosk .k-join-code[data-swap='1']"]) expect(reduced).toContain(rule);
    expect(reduced).toMatch(/\.kiosk \.k-scene-item\[data-leaving\], \.kiosk \.k-code-ghost \{ display: none; \}/);
    expect(BARE).toMatch(/:root\[data-lagano='1'\] \.k-scene-item, :root\[data-lagano='1'\] \.k-code\[data-swap='1'\], :root\[data-lagano='1'\] \.k-join-code\[data-swap='1'\] \{ animation: none; \}/);
    expect(BARE).toMatch(/:root\[data-lagano='1'\] \.k-scene-item\[data-leaving\], :root\[data-lagano='1'\] \.k-code-ghost \{ display: none; \}/);
    expect(BARE).not.toContain('.k-story-item');
    expect(BARE).not.toContain('k-story-in');
    expect(BARE).not.toContain('k-story-out');
  });
});

describe('the .tl family: sized by tokens alone, coloured by role, no rem surviving from signage.css', () => {
  it('states, roles and the state colours', () => {
    expect(decls('.kiosk .tl-title')['-webkit-line-clamp']).toBe('2');
    expect(decls(".kiosk .tl[data-lines='1'] .tl-title, .kiosk .tl[data-variant='row'][data-lines='1'] .tl-title")['-webkit-line-clamp']).toBe('1');
    expect(decls(".kiosk .k-tl-line[data-tone='late'] .tl-value").color).toBe('var(--k-rose)');
    expect(decls(".kiosk .k-tl-line[data-tone='early'] .tl-value").color).toBe('var(--k-amber)');
    expect(decls(".kiosk .k-tl-line[data-tone='ontime'] .tl-value").color).toBe('var(--k-green)');
    expect(decls(".kiosk .k-tl-line[data-tone='unknown'] .tl-value").color).toBe('var(--k-ink-3)');
    expect(decls(".kiosk .tl[data-state='down'] .tl-value")['font-size']).toBe('var(--k-hint-size)');
  });
  it('the ink tile is the ink fill with canvas text, the one such tile the plan allows (D8)', () => {
    const ink = decls(".kiosk .tl[data-variant='ink']");
    expect(ink.background).toBe('var(--k-ink)');
    expect(ink.color).toBe('var(--k-canvas)');
    expect(decls(".kiosk .tl[data-variant='ink'] .tl-label, .kiosk .tl[data-variant='ink'] .tl-context").color).toBe('var(--k-canvas)');
  });
  it('never sets a rem size: every .tl* declaration in the kiosk sheet is a --k-* token', () => {
    const tlRules = [...BARE.matchAll(/\n(\.kiosk \.tl[^{]*)\{([^}]*)\}/g)];
    expect(tlRules.length).toBeGreaterThan(5);
    for (const [, selector, decl] of tlRules) expect(decl, selector).not.toMatch(/\d+rem/);
  });
});

describe('the invitation column and card', () => {
  it('the side column is two rows: the two value tiles, then the card taking the rest', () => {
    const side = decls('.k-invitation .k-side');
    expect(side.display).toBe('grid');
    expect(side['grid-template-rows']).toBe('auto minmax(0, 1fr)');
    const tiles = decls('.k-side-tiles');
    expect(tiles.display).toBe('grid');
    expect(tiles['grid-template-columns']).toBe('repeat(2, minmax(0, 1fr))');
    expect(tiles.gap).toBe('var(--k-tile-gap)');
  });
  it('the card is accent-filled with a lead, a QR-hint row and a code row spanning the width', () => {
    const card = decls('.k-invite');
    expect(card['grid-template-areas']).toBe("'lead lead' 'qr hint' 'code code'");
    expect(card.background).toBe('var(--k-action)');
    expect(card.color).toBe('var(--k-action-ink)');
    expect(decls('.k-invite > .k-hint')['align-self']).toBe('end');
    const host = decls('.k-hint-host');
    expect(host.display).toBe('block');
    expect(host['white-space']).toBe('nowrap');
    expect(host.overflow).toBe('hidden');
    expect(host['text-overflow']).toBe('ellipsis');
  });
  it('scopes .k-invite-text to the handheld card alone -- the wide/compact card has no such wrapper', () => {
    expect(BARE).not.toMatch(/\n\.k-invite-text \{/);
    expect(BARE).toContain(".kiosk[data-size='handheld'] .k-invite-text {");
    expect(decls(".kiosk[data-size='handheld'] .k-invite-text").display).toBe('flex');
  });
  it('holds the code to its column at every size (D17), letting the card colour show through it', () => {
    expect(decls('.k-code')['font-size']).toBe('min(var(--k-display-size), 15cqi)');
    expect(decls('.k-code').color).toBe('inherit');
    expect(decls(".kiosk[data-size='handheld'] .k-code").color).toBe('var(--k-action)');
  });
});

describe('the portrait composition', () => {
  const P = ".kiosk[data-portrait='1']";
  it('stacks the stage: the scene (or the paired main region) on top at 55% of the stage, the side column with the rest', () => {
    const stage = decls(`${P} .k-invitation, ${P} .k-paired`);
    expect(stage['grid-template-columns']).toBe('minmax(0, 1fr)');
    expect(stage['grid-template-rows']).toBe('minmax(55%, 1fr) minmax(0, auto)');
  });
  it('lays the invitation side out as two columns: the tiles beside the card, both centred in the room the row has', () => {
    const side = decls(`${P} .k-invitation .k-side`);
    expect(side['grid-template-columns']).toBe('minmax(0, 1fr) minmax(0, 1.1fr)');
    expect(side['column-gap']).toBe('var(--k-gap)');
    expect(decls(`${P} .k-side-tiles`)['align-content']).toBe('center');
  });
  it('keeps the compact tiers and the 240 px QR: the portrait rules place blocks and set no token and no font-size', () => {
    const start = BARE.indexOf(P);
    const end = BARE.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const portrait = BARE.slice(start, end);
    expect(portrait).not.toMatch(/--k-[a-z-]+:/);
    expect(portrait).not.toContain('font-size');
  });
});
