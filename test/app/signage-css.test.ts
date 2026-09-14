import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The signage sheet read as text: one badge, one row, one tile, one band, one
// time-band tile family and one skeleton for phone, desk and kiosk, painted
// from tokens alone. The literals pinned here are the contract the sibling
// tasks build on (the time band's producers and composition, the kiosk
// scenes, the domain workspaces), so a change to a size or a role has to be
// made here on purpose.
const ROOT = join(import.meta.dirname, '..', '..');
const ui = (name: string): string => readFileSync(join(ROOT, 'app', 'src', 'ui', name), 'utf8');
const entry = (name: string): string => readFileSync(join(ROOT, 'app', 'src', 'entries', name), 'utf8');
const CSS = ui('signage.css');
const BASE_CSS = ui('base.css');
const PRINT_CSS = ui('print.css');
const MAP_CSS = ui('map.css');

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The declarations of the first flat rule for `selector` (rules in these files never nest). */
function body(selector: string, css: string): string {
  const match = new RegExp(`(?:^|\\n)\\s*${escape(selector)} \\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1]!;
}
/** A rule's declarations as a property -> value map, so two rules can be compared as rules. */
function decls(selector: string, css: string): Record<string, string> {
  return Object.fromEntries(
    body(selector, css).split(';').map((d) => d.trim()).filter(Boolean)
      .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
  );
}
/** The body of an at-rule, brace-matched, so a one-line block reads like a formatted one.
 *  A page can hold more than one block sharing the same prelude (two separate
 *  `@media (prefers-reduced-motion: reduce)` rules, say); `mustContain`, when given,
 *  skips a block whose body lacks it instead of settling for the first match. */
function atRule(prelude: string, css: string, mustContain?: string): string {
  let from = 0;
  for (;;) {
    const start = css.indexOf(prelude, from);
    if (start < 0) throw new Error(`no ${prelude}${mustContain ? ` containing ${mustContain}` : ''}`);
    const open = css.indexOf('{', start);
    let depth = 0;
    let end = -1;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}' && (depth -= 1) === 0) { end = i; break; }
    }
    if (end < 0) throw new Error(`unbalanced ${prelude}`);
    const body = css.slice(open + 1, end);
    if (!mustContain || body.includes(mustContain)) return body;
    from = end + 1;
  }
}
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** Every .ts file under a directory, so a selector can be checked against every builder that could write it. */
function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? tsFiles(path) : name.endsWith('.ts') ? [path] : [];
  });
}

describe('signage.css paints from tokens alone', () => {
  it('carries no hex literal outside its comments', () => {
    expect(withoutComments(CSS)).not.toMatch(/#[0-9a-fA-F]{3}/);
  });
  it('uses no !important and no hover rule: a badge is not a control, and the tile family leaves hover and press to layers.css', () => {
    expect(withoutComments(CSS)).not.toContain('!important');
    expect(withoutComments(CSS)).not.toContain(':hover');
  });
  it('sets every font-size from a --type-* role, the xs badge and the kiosk badge included (the 13 px floor applies to badges too)', () => {
    const sizes = [...withoutComments(CSS).matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(sizes.length).toBeGreaterThan(10);
    for (const size of sizes) expect(size).toMatch(/^var\(--type-[a-z-]+\)$/);
  });
});

describe('the line badge: shape carries the mode, colour repeats it', () => {
  it('gives the bus the transit role in a capsule', () => {
    const bus = decls(".line[data-kind='bus']", CSS);
    expect(bus.background).toBe('var(--tone-transit)');
    expect(bus['border-radius']).toBe('var(--r-pill)');
  });
  it('gives the tram the brand fill in the 5 px rounded rectangle the base rule sets, on the brand ink', () => {
    expect(decls(".line[data-kind='tram']", CSS).background).toBe('var(--tone-action-brand)');
    const base = decls('.line', CSS);
    expect(base['border-radius']).toBe('0.3125rem');
    expect(base.background).toBe('var(--tone-text-muted)');
    expect(base.color).toBe('var(--tone-action-brand-fg)');
    expect(base['font-variant-numeric']).toBe('tabular-nums');
  });
  it('carries the five sizes: xs where a line is mentioned, s in dense rows, m on boards, l on a detail head, k on the kiosk', () => {
    const heights = { xs: '1.125rem', s: '1.5rem', m: '2rem', l: '2.5rem', k: '2.875rem' };
    for (const [size, height] of Object.entries(heights)) {
      const rule = decls(`.line[data-size='${size}']`, CSS);
      expect(rule['block-size'], size).toBe(height);
      expect(rule['min-inline-size'], size).toBeTruthy();
      expect(rule['font-size'], size).toBeTruthy();
    }
  });
  it('keeps the xs badge readable: 13 px type, a 3 px radius and a 1.5rem minimum width', () => {
    const xs = decls(".line[data-size='xs']", CSS);
    expect(xs['font-size']).toBe('var(--type-secondary)');
    expect(xs['border-radius']).toBe('0.1875rem');
    expect(xs['min-inline-size']).toBe('1.5rem');
  });
  it('sets the kiosk badge at the display role rather than a literal', () => {
    expect(decls(".line[data-size='k']", CSS)['font-size']).toBe('var(--type-display)');
  });
  it('marks a closure with a bar in the urgency role, so the word never carries the state alone', () => {
    expect(decls('.mark-closure', CSS).background).toBe('var(--tone-urgency)');
  });
});

describe('the row is three columns: lead, main, trail', () => {
  it('lays the three tracks out with the lead and the trail at their natural size', () => {
    const row = decls('.row', CSS);
    expect(row.display).toBe('grid');
    expect(row['grid-template-columns']).toBe('auto minmax(0, 1fr) auto');
  });
  // Every list that has not moved to signRow yet is still one `.row-button`
  // inside `li.row` (blocks.ts itemRow, grad-sada). In a three-column grid that
  // child would sit in the first track and end at its own content width, which
  // measured 1006 vs 514 px on Događanja at 1440: the chevron floated in the
  // middle of the row. A single child takes the whole row -- true for the new
  // markup too, when a row has neither a lead nor a trail.
  it('gives a row with one child the whole width, so the lists keep their geometry until wave 3 migrates them', () => {
    expect(decls('.row > :only-child', CSS)['grid-column']).toBe('1 / -1');
  });
  // Source order is not placement: a row whose lead is empty (signRow's `lead:
  // ''`) has two children, so auto-placement would drop the main part into the
  // lead track and the trail into the flexible one. Measured at 390 with an
  // empty lead and a long title: the title track grew to 336 px and the delay
  // word was squeezed to 0. The main part is therefore placed by name.
  it('places the main part in the middle track by name, so an empty lead cannot push it into the lead track', () => {
    expect(decls('.row-main', CSS)['grid-column']).toBe('2');
  });
  // ... and when it really is first, it takes the empty lead track with it, so
  // the title starts at the row's edge (x=0, not x=12) and the trail still ends
  // at it. Disjoint from the :only-child rule above, which spans all three.
  it('lets a leadless main part take the empty lead track, so nothing is indented by a gap that leads nowhere', () => {
    expect(decls('.row > .row-main:first-child:not(:only-child)', CSS)['grid-column']).toBe('1 / 3');
  });
});

describe('the time-band tile family .tl (plan A.5): one control, five variants, tokens only', () => {
  it('is a stroked surface-1 grid at least one target tall, with the medium radius and no shadow', () => {
    const tl = decls('.tl', CSS);
    expect(tl.display).toBe('grid');
    expect(tl.border).toBe('1px solid var(--tone-stroke)');
    expect(tl['box-shadow']).toBeUndefined();
    expect(tl.background).toBe('var(--tone-surface-1)');
    expect(tl['border-radius']).toBe('var(--r-md)');
    expect(tl['min-block-size']).toBe('var(--target)');
    expect(tl['min-inline-size']).toBe('0');
    expect(tl['text-decoration']).toBe('none');
    expect(tl['touch-action']).toBe('manipulation');
  });
  it('sets the value at the tile-l role, nowrap with an ellipsis, and the xl and m sizes from their roles', () => {
    const value = decls('.tl-value', CSS);
    expect(value['font-size']).toBe('var(--type-tile-l)');
    expect(value['white-space']).toBe('nowrap');
    expect(value['text-overflow']).toBe('ellipsis');
    expect(value['font-variant-numeric']).toBe('tabular-nums');
    expect(decls(".tl-value[data-size='xl']", CSS)['font-size']).toBe('var(--type-tile-xl)');
    expect(decls(".tl-value[data-size='m']", CSS)['font-size']).toBe('var(--type-tile-m)');
  });
  it('colours the delay word by state in the roles delayTone names: late urgency, early weather, on time live', () => {
    expect(decls(".tl-value[data-state='late']", CSS).color).toBe('var(--tone-urgency)');
    expect(decls(".tl-value[data-state='early']", CSS).color).toBe('var(--tone-weather)');
    expect(decls(".tl-value[data-state='ontime']", CSS).color).toBe('var(--tone-live)');
  });
  it('clamps the title to two lines at the tile-m role and sets the time at the tile-time role', () => {
    const title = decls('.tl-title', CSS);
    expect(title['font-size']).toBe('var(--type-tile-m)');
    expect(title['-webkit-line-clamp']).toBe('2');
    expect(title['line-clamp']).toBe('2');
    expect(title.overflow).toBe('hidden');
    expect(decls('.tl-time', CSS)['font-size']).toBe('var(--type-tile-time)');
  });
  it('keeps the context and the trail on one 13 px muted line that never wraps, with 14 px glyphs and a 20 px band glyph', () => {
    const context = decls('.tl-context, .tl-trail', CSS);
    expect(context['font-size']).toBe('var(--type-secondary)');
    expect(context['white-space']).toBe('nowrap');
    expect(context.color).toBe('var(--tone-text-muted)');
    expect(decls('.tl-ctx-text', CSS)['text-overflow']).toBe('ellipsis');
    expect(decls('.tl-context .icon, .tl-trail .icon', CSS)['inline-size']).toBe('0.875rem');
    expect(decls('.tl-glyph', CSS)['inline-size']).toBe('1.25rem');
  });
  it('colours the kicker by domain, and the safety kicker by level, never by colour alone', () => {
    expect(decls(".tl[data-domain='transit'] .kicker, .tl[data-domain='mobility'] .kicker", CSS).color).toBe('var(--tone-transit)');
    expect(decls(".tl[data-domain='komunalno'] .kicker", CSS).color).toBe('var(--tone-weather)');
    expect(decls(".tl[data-domain='events'] .kicker", CSS).color).toBe('var(--tone-events)');
    expect(decls(".tl[data-domain='civic'] .kicker", CSS).color).toBe('var(--tone-civic)');
    expect(decls(".tl[data-domain='safety'][data-level='calm'] .kicker", CSS).color).toBe('var(--tone-live)');
    expect(decls(".tl[data-domain='safety'][data-level='urgent'] .kicker", CSS).color).toBe('var(--tone-urgency)');
  });
  it('lays the band and the row out as glyph, main, trail', () => {
    const band = decls(".tl[data-variant='band'], .tl[data-variant='row']", CSS);
    expect(band['grid-template-columns']).toBe('auto minmax(0, 1fr) auto');
    expect(band['align-items']).toBe('center');
    expect(decls('.tl-main', CSS)['min-inline-size']).toBe('0');
    expect(decls(".tl[data-variant='band'] .tl-trail", CSS)['justify-self']).toBe('end');
  });
  it('tints komunalno, events, urgent and unknown from the tint roles and drops their stroke', () => {
    expect(decls(".tl[data-tone='komunalno']", CSS)).toEqual({ background: 'var(--tone-tint-weather)', 'border-color': 'transparent' });
    expect(decls(".tl[data-tone='events']", CSS)).toEqual({ background: 'var(--tone-tint-events)', 'border-color': 'transparent' });
    expect(decls(".tl[data-tone='urgent']", CSS)).toEqual({ background: 'var(--tone-tint-urgency)', 'border-color': 'transparent' });
    expect(decls(".tl[data-tone='unknown']", CSS)).toEqual({ background: 'var(--tone-tint-weather)', 'border-color': 'transparent' });
  });
  it('strokes calm and mobility at 1.5 px in their roles with no fill', () => {
    expect(decls(".tl[data-tone='calm']", CSS)).toEqual({ background: 'transparent', border: '1.5px solid var(--tone-live)' });
    expect(decls(".tl[data-tone='mobility']", CSS)).toEqual({ background: 'transparent', border: '1.5px solid var(--tone-transit)' });
  });
  it('fills the ink tile with the primary text colour and sets its text and kicker in the canvas colour (D8), its context in surface-3', () => {
    const ink = decls(".tl[data-variant='ink']", CSS);
    expect(ink.background).toBe('var(--tone-text-primary)');
    expect(ink.color).toBe('var(--tone-surface-canvas)');
    expect(ink['border-color']).toBe('transparent');
    expect(decls(".tl[data-variant='ink'] .kicker", CSS).color).toBe('var(--tone-surface-canvas)');
    expect(decls(".tl[data-variant='ink'] .tl-context", CSS).color).toBe('var(--tone-surface-3)');
  });
  it('crossfades a replaced value at the base duration, with a reduced-motion twin and a lagano twin', () => {
    expect(decls(".tl-value[data-replace]", CSS).animation).toBe('ki-fade var(--dur-base) var(--ease) both');
    expect(atRule('@media (prefers-reduced-motion: reduce)', CSS, '.tl-value')).toContain('animation: none');
    expect(decls(":root[data-lagano='1'] .tl-value[data-replace]", CSS).animation).toBe('none');
  });
  it('gives a skeleton tile the box of the finished one: every bar takes its type role’s line height, the glyph is round, and it is no control', () => {
    expect(decls('.tl[data-skeleton]', CSS).cursor).toBe('default');
    expect(decls('.tl-sk-label', CSS)['block-size']).toBe('calc(var(--type-secondary) * var(--lh-body))');
    expect(decls('.tl-sk-value', CSS)['block-size']).toBe('calc(var(--type-tile-l) * var(--lh-tight))');
    expect(decls('.tl-sk-time', CSS)['block-size']).toBe('calc(var(--type-tile-time) * var(--lh-tight))');
    expect(decls('.tl-sk-title', CSS)['block-size']).toBe('calc(var(--type-tile-m) * var(--lh-title) * 2)');
    expect(decls('.tl-sk-title1', CSS)['block-size']).toBe('calc(var(--type-tile-m) * var(--lh-title))');
    expect(decls('.tl-sk-context', CSS)['block-size']).toBe('calc(var(--type-secondary) * var(--lh-body))');
    expect(decls('.tl-sk-glyph', CSS)['border-radius']).toBe('50%');
  });
  it('leaves the emergency-number tiles (.tile*) and the safety band (.band*) untouched: sigurnost.ts still renders them', () => {
    expect(decls('.tile-value', CSS)['font-size']).toBe('var(--type-tile-xl)');
    expect(decls('.tile-label', CSS)['font-size']).toBe('var(--type-control)');
    expect(decls('.tile-primary', CSS).background).toBe('var(--tone-text-primary)');
    expect(decls(".band[data-level='urgent']", CSS).background).toBe('var(--tone-tint-urgency)');
  });
});

describe('the skeleton shimmers only where motion reports a fact', () => {
  it('has a designed twin under reduced motion and on the lightweight path', () => {
    const reduced = atRule('@media (prefers-reduced-motion: reduce)', CSS);
    expect(reduced).toContain('.sk');
    expect(reduced).toContain('animation: none');
    expect(body(":root[data-lagano='1'] .sk", CSS)).toContain('animation: none');
  });
});

describe('every page that shows a badge loads the sheet', () => {
  it.each(['dashboard.ts', 'kiosk.ts', 'scan.ts', 'landing.ts'])('%s imports it statically', (name) => {
    expect(entry(name)).toContain("import '../ui/signage.css';");
  });
  it('loads it directly after base.css, so the retargeted badge rules win at equal specificity', () => {
    for (const name of ['dashboard.ts', 'kiosk.ts', 'scan.ts']) {
      expect(entry(name), name).toContain("import '../ui/base.css';\nimport '../ui/signage.css';");
    }
  });
});

describe('motion that reports a fact: a workspace fade and a figure crossfade, with designed twins', () => {
  it('fades the incoming workspace in on a switch, via a keyframe rather than a transition', () => {
    expect(CSS).toContain('@keyframes ki-enter');
    const enter = decls(".ki-main[data-enter='1'] > .layer", CSS);
    expect(enter.animation).toBe('ki-enter var(--dur-fast) var(--ease-enter) both');
  });
  it('crossfades a figure on a real change, at the base duration', () => {
    expect(CSS).toContain('@keyframes ki-fade');
    expect(decls('.g-wrap', CSS).animation).toBe('ki-fade var(--dur-base) var(--ease) both');
  });
  it('eases a press back open on every control that already answers instantly on :active', () => {
    const release = decls('.btn, .btn-ghost, .btn-quiet, .chip, .ki-tab, .row-button, .route-link, .dir-item', CSS);
    expect(release.transition).toBe('background-color var(--dur-fast) var(--ease)');
  });
  it('gives the workspace fade and the figure crossfade a reduced-motion twin, naming both selectors', () => {
    const reduced = atRule('@media (prefers-reduced-motion: reduce)', CSS, '.ki-main');
    expect(reduced).toContain(".ki-main[data-enter='1'] > .layer");
    expect(reduced).toContain('.g-wrap');
    expect(reduced).toContain('animation: none');
  });
  it('gives them the same twin on the lightweight path', () => {
    const lagano = decls(":root[data-lagano='1'] .ki-main > .layer, :root[data-lagano='1'] .g-wrap", CSS);
    expect(lagano.animation).toBe('none');
  });
});

describe('the badge has one name: .route-no is retired', () => {
  // base.css carried `.route-no` declaration for declaration equal to
  // `.line[data-kind=tram][data-size=s]` so the old overview could swap its
  // markup without anything moving. No builder writes the old name any more,
  // so the copy is gone and the badge is painted in one place.
  it('no builder under app/src writes the old class', () => {
    const producer = /route-no(?![\w-])/;
    for (const file of tsFiles(join(ROOT, 'app', 'src'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(producer);
    }
  });
  it('base.css and print.css no longer style it', () => {
    expect(withoutComments(BASE_CSS)).not.toContain('.route-no');
    expect(withoutComments(PRINT_CSS)).not.toContain('.route-no');
    expect(PRINT_CSS).toContain('.t-badge, .line, .badge');
  });
  it('map.css leaves the transport badge’s size and colour to .line and keeps only the spacing around it', () => {
    // `.t-badges` and `.t-badge-more` stay; the badge itself is styled nowhere here any more.
    expect(MAP_CSS).not.toMatch(/\.t-badge[\s{[]/);
    expect(MAP_CSS).toContain('.t-badges {');
    expect(MAP_CSS).toContain('.t-badge-more {');
  });
});
