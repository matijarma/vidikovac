import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The public screen's sheet read as text. The kiosk paints from the shared
// tokens (every `--k-*` colour is an alias of a `--tone-*` role, so the two
// faces, the OKLCH twins and the contrast proof live in tokens.css alone) and
// sets its type in seven tiers per composition. The literals pinned here are
// the contract the compositions build on (kiosk/field.ts, kiosk/invitation.ts,
// the panels kiosk/front.ts writes), so a new tier or a private colour has to
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

describe('seven type tiers per composition, each a token times --k-zoom', () => {
  const TIERS = {
    wide: { display: 84, clock: 48, main: 40, sup: 28, hint: 26, label: 24, credit: 20 },
    compact: { display: 64, clock: 36, main: 28, sup: 22, hint: 20, label: 18, credit: 16 },
  } as const;
  const TOKEN: Record<keyof (typeof TIERS)['wide'], string> = {
    display: '--k-display-size', clock: '--k-clock-size', main: '--k-main-size', sup: '--k-sup-size',
    hint: '--k-hint-size', label: '--k-label-size', credit: '--k-credit-size',
  };
  it.each(Object.entries(TIERS))('%s: every tier token', (size, px) => {
    const rule = decls(`.kiosk[data-size='${size}']`);
    for (const [key, token] of Object.entries(TOKEN) as [keyof typeof px, string][]) {
      expect(rule[token], token).toBe(`calc(${px[key]}px * var(--k-zoom))`);
    }
  });
  it('sets every font-size from a tier token', () => {
    const sizes = [...BARE.matchAll(/font-size: ([^;]+);/g)].map((m) => m[1]!);
    expect(sizes.length).toBeGreaterThan(30);
    for (const size of sizes) expect(size).toMatch(/^(?:min\()?var\(--k-(?:display|clock|main|sup|hint|label|credit)-size\)/);
  });
  it('retired the scene-time and tile tiers with their only users: the panels use the label, supporting, hint, main and credit tiers alone', () => {
    expect(BARE).not.toContain('--k-scene-time-size');
    expect(BARE).not.toContain('--k-tile-size');
  });
  it('reserves display for exactly the pairing codes, capped to their column (D17)', () => {
    expect(decls('.k-code')['font-size']).toBe('min(var(--k-display-size), 15cqi)');
    expect(decls('.k-invite > .k-invite-code')['container-type']).toBe('inline-size');
    expect(rulesUsing('--k-display-size').sort()).toEqual(['.k-code', '.k-join-code']);
  });
  it('keeps .k-temp at main: the header weather group and the paired weather block share the token', () => {
    expect(decls('.k-temp')['font-size']).toBe('var(--k-main-size)');
  });
  it('reserves the credit tier for attribution lines: .k-meta and the panels\u2019 credit', () => {
    expect(rulesUsing('--k-credit-size').sort()).toEqual(['.k-meta', '.k-panel-credit']);
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
  it('pins the column at 520/440 on the sign scale beside the panels that take the rest, joined on 1 px hairlines; the paired side keeps its own token', () => {
    // 1 at both design sizes, so 520 / 440 px is the drawing; capped at 1.35, so above Full HD the column stops growing and the map takes the room.
    expect(decls('.kiosk')['--k-sign-zoom']).toBe('min(var(--k-zoom), 1.35)');
    expect(decls(".kiosk[data-size='wide']")['--k-side-w']).toBe('calc(520px * var(--k-sign-zoom))');
    expect(decls(".kiosk[data-size='compact']")['--k-side-w']).toBe('calc(440px * var(--k-sign-zoom))');
    expect(decls(".kiosk[data-size='wide']")['--k-paired-side-w']).toBe('calc(720px * var(--k-zoom))');
    expect(decls(".kiosk[data-size='compact']")['--k-paired-side-w']).toBe('calc(540px * var(--k-zoom))');
    const front = decls('.k-front');
    expect(front['grid-template-columns']).toBe('minmax(0, 1fr) var(--k-side-w)');
    expect(front['grid-template-rows']).toBe('minmax(0, 1.1fr) minmax(0, 1fr)');
    expect(front.gap).toBe('1px');
    expect(front.background).toBe('var(--k-line)');
    expect(decls('.k-paired')['grid-template-columns']).toBe('minmax(0, 1fr) var(--k-paired-side-w)');
  });
  it('keeps the QR at 240 px at every landscape size, and above Full HD grows it on the sign scale alone -- with the card\u2019s own gap, lead and hint, which are the composition\u2019s gap, supporting and hint sizes on that same scale, so a 4K wall\u2019s doubled type never outgrows the card it stands in', () => {
    expect(decls(".kiosk[data-size='wide']")['--k-qr']).toBe('calc(240px * var(--k-sign-zoom))');
    expect(decls(".kiosk[data-size='compact']")['--k-qr']).toBe('calc(240px * var(--k-sign-zoom))');
    for (const [size, gap, lead, hint] of [['wide', 20, 28, 26], ['compact', 14, 22, 20]] as const) {
      const rule = decls(`.kiosk[data-size='${size}']`);
      expect(rule['--k-card-gap'], size).toBe(`calc(${gap}px * var(--k-sign-zoom))`);
      expect(rule['--k-card-lead'], size).toBe(`calc(${lead}px * var(--k-sign-zoom))`);
      expect(rule['--k-card-hint'], size).toBe(`calc(${hint}px * var(--k-sign-zoom))`);
      expect(rule['--k-gap'], size).toBe(`calc(${gap}px * var(--k-zoom))`);
    }
    // A phone's card tokens are its own gap and tiers (zoom is 1 there): the same card, no second drawing.
    const phone = decls(".kiosk[data-size='handheld']");
    expect([phone['--k-card-gap'], phone['--k-card-lead'], phone['--k-card-hint']]).toEqual([phone['--k-gap'], phone['--k-sup-size'], phone['--k-hint-size']]);
    // The paired corner QR belongs to a composition this wave leaves alone: it keeps the composition scale, 120 px at zoom 1 as it always was.
    expect(decls('.k-join-qr').width).toBe('calc(120px * var(--k-zoom))');
  });
  it('roles: the panel figure at main, a row title and its lead at supporting, the kicker at label, a row context and the hint/date/strip at hint', () => {
    expect(decls('.k-panel-figure')['font-size']).toBe('var(--k-main-size)');
    expect(decls('.k-fr-title')['font-size']).toBe('var(--k-sup-size)');
    expect(decls('.k-fr-lead')['font-size']).toBe('var(--k-sup-size)');
    expect(decls('.k-panel-kicker')['font-size']).toBe('var(--k-label-size)');
    expect(decls('.k-fr-sub')['font-size']).toBe('var(--k-hint-size)');
    expect(decls('.k-hint')['font-size']).toBe('min(var(--k-hint-size), var(--k-card-hint))');
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
    expect(rule['--k-label-size']).toBe('14px');
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

describe('the safety strip: the verdict pill, no countdown, no sun line', () => {
  it('gives the verdict pill a colour per level and drops the old sun sub-line entirely', () => {
    expect(decls(".k-strip-verdict[data-level='calm']").color).toBe('var(--k-green)');
    expect(decls(".k-strip-verdict[data-level='urgent']").background).toBe('var(--k-rose-soft)');
    expect(decls(".k-strip-verdict[data-level='unknown']").background).toBe('var(--k-amber-soft)');
    expect(BARE).not.toContain('.k-strip-sub');
    expect(BARE).not.toContain('.k-strip-item--sun');
    expect(BARE).not.toContain('k-strip--nosun');
    expect(BARE).not.toContain('k-strip--nosub');
  });
  it('has no countdown rule (R-KP11, R-KP23): frame.ts writes no countdown element either; hidden stays the one universal off switch', () => {
    expect(BARE).not.toContain('.k-strip-next');
    expect(BARE).not.toContain('k-strip--nonext');
    expect(BARE).toContain('.kiosk [hidden] { display: none !important; }');
  });
  it('the strip has no Osnovno chip: the verdict is the 44 px button', () => {
    expect(BARE).not.toContain('.k-strip-basics');
    expect(decls('.k-strip-verdict')['min-height']).toBe('44px');
    expect(decls('button.k-strip-verdict').cursor).toBe('pointer');
  });
});

// The invitation (plan "Frame", R-KP1, R-KP5): the field edge to edge, the
// column a surface panel of statements over the card, nothing on the picture.
describe('the invitation: one field, one column', () => {
  it('the stage drops its padding for the invitation alone, through the phase the controller writes on the root; a phone keeps it', () => {
    expect(decls('.k-stage').padding).toBe('var(--k-pad)');
    expect(decls(".kiosk[data-phase='invitation'] .k-stage").padding).toBe('0');
    expect(decls(".kiosk[data-size='handheld'][data-phase='invitation'] .k-stage").padding).toBe('var(--k-pad)');
  });
  it('the field fills its cell with the map host on it and nothing else: no radius, no padding, the attribution left in its own corner', () => {
    const field = decls('.k-field');
    expect(field.position).toBe('relative');
    expect(field.overflow).toBe('hidden');
    expect(field.background).toBe('var(--k-surface-2)');
    expect(field['border-radius']).toBeUndefined();
    expect(field.padding).toBeUndefined();
    // One cell, so the lagano board (the field's only in-flow child) takes the whole field.
    expect(field['grid-template-rows']).toBe('minmax(0, 1fr)');
    const host = decls('.k-map-host');
    expect(host.position).toBe('absolute');
    expect([host.top, host.right, host.bottom, host.left]).toEqual(['0', '0', '0', '0']);
    expect(BARE).not.toContain('.maplibregl-ctrl-bottom-right');
    expect(decls(':root[data-lagano=\'1\'] .k-field').background).toBe('var(--k-surface)');
  });
  it('the bottom row is the lines, the field and the surroundings at 1 : 1.15 : 0.75; the column is the forecast, the city and the card, the card at its foot', () => {
    const bottom = decls('.k-bottom');
    expect(bottom['grid-template-columns']).toBe('minmax(0, 1fr) minmax(0, 1.15fr) minmax(0, 0.75fr)');
    expect(bottom.gap).toBe('1px');
    const column = decls('.k-column');
    expect(column['grid-row']).toBe('1 / span 2');
    expect(column['grid-template-rows']).toBe('auto minmax(0, 1fr) auto');
    expect(decls('.k-panel--card')['align-content']).toBe('end');
    // The old column of statements and its side tiles are gone.
    for (const dead of ['.k-says', '.k-say ', '.k-say-value', '.k-invitation', '.k-side-tiles']) expect(BARE, dead).not.toContain(dead);
    expect(decls('.k-side').display).toBe('flex');
  });
  it('a panel is a surface box that clips at its edge and hides whole rows by measurement: a kicker in the domain colour with a meta line, rows on hairlines with a lead cell, a two-line title and a one-line context, the credit pushed to the foot', () => {
    const panel = decls('.k-panel');
    expect(panel.background).toBe('var(--k-surface)');
    expect(panel.overflow).toBe('hidden');
    expect(panel['border-radius']).toBeUndefined();
    expect(panel['box-shadow']).toBeUndefined();
    expect(decls('.k-panel-kicker')['text-transform']).toBe('uppercase');
    for (const [id, colour] of [['tonight', '--k-violet'], ['weather', '--k-amber'], ['city', '--k-action'], ['promet', '--k-action'], ['around', '--k-amber']]) {
      expect(decls(`.k-panel[data-panel='${id}'] .k-panel-kicker`).color, id).toBe(`var(${colour})`);
    }
    expect(decls(".k-panel[data-panel='tonight'] .k-rows")['grid-template-columns']).toBe('repeat(2, minmax(0, 1fr))');
    const row = decls('.k-fr');
    expect(row['border-top']).toBe('1px solid var(--k-line)');
    expect(row['grid-template-columns']).toBe('auto minmax(0, 1fr)');
    expect(decls('.k-rows > .k-fr:first-child')['border-top']).toBe('0');
    const title = decls('.k-fr-title');
    expect(title['-webkit-line-clamp']).toBe('2');
    expect(title['overflow-wrap']).toBe('anywhere');
    const sub = decls('.k-fr-sub');
    expect(sub['white-space']).toBe('nowrap');
    expect(sub['text-overflow']).toBe('ellipsis');
    for (const [tone, colour] of [['late', '--k-rose'], ['early', '--k-amber'], ['ontime', '--k-green'], ['unknown', '--k-ink-3']]) {
      expect(decls(`.k-fr[data-tone='${tone}'] .k-fr-sub`).color, tone).toBe(`var(${colour})`);
    }
    expect(decls('.k-panel-credit')['margin-top']).toBe('auto');
    expect(decls('.k-panel-note[data-state=\'down\']').color).toBe('var(--k-rose)');
    expect(decls('.k-panel-text')['-webkit-line-clamp']).toBe('3');
  });
  it('the code crossfade is the one animation, by a keyframe and no timer; off under reduced motion and lagano', () => {
    expect(BARE).not.toContain('k-say-in');
    const reduced = BARE.slice(BARE.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const rule of [".kiosk .k-code[data-swap='1']", ".kiosk .k-join-code[data-swap='1']"]) expect(reduced).toContain(rule);
    expect(reduced).toMatch(/\.kiosk \.k-code-ghost \{ display: none; \}/);
    expect(BARE).toMatch(/:root\[data-lagano='1'\] \.k-code\[data-swap='1'\], :root\[data-lagano='1'\] \.k-join-code\[data-swap='1'\] \{ animation: none; \}/);
    expect(BARE).toMatch(/:root\[data-lagano='1'\] \.k-code-ghost \{ display: none; \}/);
    for (const dead of ['k-scene-in', 'k-scene-out', '.k-story-item', 'k-story-in', 'k-story-out']) expect(BARE, dead).not.toContain(dead);
    expect(decls('.k-progress-bar').transition).toBe('width 1s linear');
  });
  it('the card is the QR beside the lead over the hint, then the code spanning (R-KP21): accent-filled, padded by the card gap with its rows 0.6 of it apart, the QR row at least the QR tall and free to grow (the card never clips), the lead at the supporting tier and weight 800, the address wrapping at its own joints and never ellipsised', () => {
    const card = decls('.k-invite');
    expect(card['grid-template-columns']).toBe('var(--k-qr) minmax(0, 1fr)');
    expect(card['grid-template-rows']).toBe('minmax(var(--k-qr), auto) auto');
    expect(card['grid-template-areas']).toBe("'qr side' 'code code'");
    expect(card.overflow).toBeUndefined();
    expect(card.background).toBe('var(--k-action)');
    expect(card.color).toBe('var(--k-action-ink)');
    expect(card.padding).toBe('var(--k-card-gap)');
    expect(card['column-gap']).toBe('var(--k-card-gap)');
    expect(card['row-gap']).toBe('calc(var(--k-card-gap) * 0.6)');
    const side = decls('.k-invite-side');
    expect(side['grid-area']).toBe('side');
    expect(side.display).toBe('grid');
    expect(side['align-content']).toBe('space-between');
    expect(side['min-width']).toBe('0');
    const lead = decls('.k-lead');
    expect(lead['font-size']).toBe('min(var(--k-sup-size), var(--k-card-lead))');
    expect(lead['font-weight']).toBe('800');
    expect(lead['line-height']).toBe('1.15');
    expect(rulesUsing('--k-main-size')).not.toContain('.k-lead');
    const host = decls('.k-hint-host');
    expect(host.display).toBe('block');
    expect(host['overflow-wrap']).toBe('anywhere');
    expect(host['text-overflow']).toBeUndefined();
    expect(host['white-space']).toBeUndefined();
    expect(host.overflow).toBeUndefined();
  });
  it('the totem keeps the lead across the card over the QR-hint row (its card\u2019s height is the statements\u2019 room beside it) and a phone stands the four pieces up; in both the side wrapper dissolves and the lead and the hint take their own areas, at the same lead tier', () => {
    expect(decls(".kiosk[data-portrait='1'] .k-invite")['grid-template-areas']).toBe("'lead lead' 'qr hint' 'code code'");
    expect(decls(".kiosk[data-portrait='1'] .k-invite")['grid-template-rows']).toBe('auto minmax(var(--k-qr), auto) auto');
    expect(decls(".kiosk[data-size='handheld'] .k-invite")['grid-template-areas']).toBe("'lead' 'qr' 'hint' 'code'");
    expect(decls(".kiosk[data-portrait='1'] .k-invite-side, .kiosk[data-size='handheld'] .k-invite-side").display).toBe('contents');
    expect(decls(".kiosk[data-portrait='1'] .k-lead, .kiosk[data-size='handheld'] .k-lead")['grid-area']).toBe('lead');
    expect(decls(".kiosk[data-portrait='1'] .k-hint, .kiosk[data-size='handheld'] .k-hint")['grid-area']).toBe('hint');
    expect(decls(".kiosk[data-portrait='1'] .k-hint")['align-self']).toBe('end');
    expect(BARE).not.toContain('.k-invite-text');
    expect(decls(".kiosk[data-size='handheld'] .k-invite").background).toBe('var(--k-surface)');
    expect(decls(".kiosk[data-size='handheld'] .k-qr").width).toBe('min(var(--k-qr), 100%)');
  });
  it('holds the code to its column at every size (D17), letting the card colour show through it', () => {
    expect(decls('.k-code')['font-size']).toBe('min(var(--k-display-size), 15cqi)');
    expect(decls('.k-code').color).toBe('inherit');
    expect(decls(".kiosk[data-size='handheld'] .k-code").color).toBe('var(--k-action)');
  });
  it('the code\'s dot is dimmed and the 8 px bar fills paper over a quarter-paper track on the accent (kajimafix 03.4)', () => {
    expect(decls('.k-code-dash').opacity).toBe('0.4');
    expect(decls('.k-progress').background).toBe('color-mix(in oklab, var(--k-action-ink) 25%, var(--k-action))');
    expect(decls('.k-progress')['box-shadow']).toBeUndefined();
  });
  it('the chapters, the rail, the tiles, the dots and their tokens are gone; --k-glass keeps its one paired user', () => {
    for (const dead of ['.k-scene', '.k-rail', '.k-side-tiles', '.k-dot', '.k-strip-next', '@property', '--k-tile-min', '--k-row-min', '--k-time-min', '--k-ink-w', '--k-tile-gap', '.kiosk .tl', '.k-tl-line', '.k-tile', "[data-works='0']", '.k-works']) {
      expect(BARE, dead).not.toContain(dead);
    }
    expect(rulesUsing('--k-glass')).toEqual(['.k-lines--overlay']);
  });
});

describe('the portrait composition', () => {
  const P = ".kiosk[data-portrait='1']";
  it('stacks the front page: tonight on top, the bottom row of three at a third each with the field at least 340 px, the column as a row at the foot with the forecast over the city beside the card', () => {
    const front = decls(`${P} .k-front`);
    expect(front['grid-template-columns']).toBe('minmax(0, 1fr)');
    expect(front['grid-template-rows']).toBe('minmax(0, 1fr) auto auto');
    expect(decls(`${P} .k-bottom .k-field`)['min-height']).toBe('calc(340px * var(--k-zoom))');
    const column = decls(`${P} .k-column`);
    expect(column['grid-template-columns']).toBe('minmax(0, 1fr) minmax(0, 1.1fr)');
    expect(column['grid-template-rows']).toBe('auto auto');
    expect(decls(`${P} .k-column > .k-panel--card`)['grid-row']).toBe('1 / span 2');
    // The paired compositions keep their portrait stack as before.
    expect(decls(`${P} .k-paired`)['grid-template-rows']).toBe('minmax(55%, 1fr) minmax(0, auto)');
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

describe('the handheld composition', () => {
  const H = ".kiosk[data-size='handheld']";
  it('the field is a 280 px band among the panels, which stand in one scrolling column, each its own surface with the kiosk radius and no clipping; the card is the same card stood up', () => {
    expect(decls(H)['--k-map-band']).toBe('280px');
    const field = decls(`${H} .k-field`);
    expect(field.height).toBe('var(--k-map-band)');
    expect(field['border-radius']).toBe('var(--k-radius)');
    const stack = decls(`${H} .k-front, ${H} .k-bottom, ${H} .k-column`);
    expect(stack.display).toBe('flex');
    expect(stack['flex-direction']).toBe('column');
    expect(stack.background).toBe('transparent');
    const panel = decls(`${H} .k-panel`);
    expect(panel.overflow).toBe('visible');
    expect(panel['border-radius']).toBe('var(--k-radius)');
    expect(decls(`${H} .k-panel[data-panel='tonight'] .k-rows`)['grid-template-columns']).toBe('minmax(0, 1fr)');
    expect(decls(`${H} .k-invite`)['margin-top']).toBe('var(--k-gap)');
  });
});
