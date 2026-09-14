import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The signage sheet read as text: one badge, one row, one tile, one band and
// one skeleton for phone, desk and kiosk, painted from tokens alone. The
// literals pinned here are the contract the sibling tasks build on (T2.2's
// Sada, wave 3's domain rows, wave 5's kiosk board), so a change to a size or
// a role has to be made here on purpose.
const ui = (name: string): string => readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', name), 'utf8');
const entry = (name: string): string => readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'entries', name), 'utf8');
const CSS = ui('signage.css');
const BASE_CSS = ui('base.css');
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

describe('signage.css paints from tokens alone', () => {
  it('carries no hex literal outside its comments', () => {
    expect(withoutComments(CSS)).not.toMatch(/#[0-9a-fA-F]{3}/);
  });
  it('uses no !important and no hover rule: a badge is not a control', () => {
    expect(withoutComments(CSS)).not.toContain('!important');
    expect(withoutComments(CSS)).not.toContain(':hover');
  });
});

describe('the line badge: shape carries the mode, colour repeats it', () => {
  it('gives the bus the transit role in a capsule', () => {
    const bus = decls(".line[data-kind='bus']", CSS);
    expect(bus.background).toBe('var(--tone-transit)');
    expect(bus['border-radius']).toBe('var(--r-pill)');
  });
  it('gives the tram the brand fill in the rounded rectangle the base rule sets, on the brand ink', () => {
    expect(decls(".line[data-kind='tram']", CSS).background).toBe('var(--tone-action-brand)');
    const base = decls('.line', CSS);
    expect(base['border-radius']).toBe('0.25rem');
    expect(base.background).toBe('var(--tone-text-muted)');
    expect(base.color).toBe('var(--tone-action-brand-fg)');
    expect(base['font-variant-numeric']).toBe('tabular-nums');
  });
  it('carries the four sizes: s in dense rows, m on boards, l on a detail head, k on the kiosk', () => {
    const heights = { s: '1.5rem', m: '2rem', l: '2.5rem', k: '2.875rem' };
    for (const [size, height] of Object.entries(heights)) {
      const rule = decls(`.line[data-size='${size}']`, CSS);
      expect(rule['block-size'], size).toBe(height);
      expect(rule['min-inline-size'], size).toBeTruthy();
      expect(rule['font-size'], size).toBeTruthy();
    }
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

describe('the skeleton shimmers only where motion reports a fact', () => {
  it('has a designed twin under reduced motion and on the lightweight path', () => {
    const reduced = atRule('@media (prefers-reduced-motion: reduce)', CSS);
    expect(reduced).toContain('.sk');
    expect(reduced).toContain('animation: none');
    expect(body(":root[data-lagano='1'] .sk", CSS)).toContain('animation: none');
  });
});

describe('every page that shows a badge loads the sheet', () => {
  it.each(['dashboard.ts', 'kiosk.ts', 'landing.ts'])('%s imports it statically', (name) => {
    expect(entry(name)).toContain("import '../ui/signage.css';");
  });
  it('loads it directly after base.css, so the retargeted badge rules win at equal specificity', () => {
    for (const name of ['dashboard.ts', 'kiosk.ts']) {
      expect(entry(name), name).toContain("import '../ui/base.css';\nimport '../ui/signage.css';");
    }
  });
  // /s/ is styled from the first paint (T4.3): its sheets are <link>s in
  // <head>, in the same order, so the entry imports none of them.
  it('/s/ links it from <head> directly after base.css', () => {
    const html = readFileSync(join(import.meta.dirname, '..', '..', 'app', 's', 'index.html'), 'utf8');
    expect(html).toContain('<link rel="stylesheet" href="/src/ui/base.css">\n<link rel="stylesheet" href="/src/ui/signage.css">');
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

describe('the badges that exist today already render as the new component', () => {
  it('base.css paints .route-no exactly as .line[data-kind=tram][data-size=s], so T2.2 swaps the markup and nothing moves', () => {
    const tramS = { ...decls('.line', CSS), ...decls(".line[data-kind='tram']", CSS), ...decls(".line[data-size='s']", CSS) };
    expect(decls('.route-no', BASE_CSS)).toEqual(tramS);
  });
  it('base.css paints .route-no[data-type="3"] exactly as the bus variant', () => {
    expect(decls(".route-no[data-type='3']", BASE_CSS)).toEqual(decls(".line[data-kind='bus']", CSS));
  });
  it('map.css leaves the transport badge’s size and colour to .line and keeps only the spacing around it', () => {
    // `.t-badges` and `.t-badge-more` stay; the badge itself is styled nowhere here any more.
    expect(MAP_CSS).not.toMatch(/\.t-badge[\s{[]/);
    expect(MAP_CSS).toContain('.t-badges {');
    expect(MAP_CSS).toContain('.t-badge-more {');
  });
});
