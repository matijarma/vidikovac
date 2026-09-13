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
/** The body of an at-rule, brace-matched, so a one-line block reads like a formatted one. */
function atRule(prelude: string, css: string): string {
  const start = css.indexOf(prelude);
  if (start < 0) throw new Error(`no ${prelude}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && (depth -= 1) === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unbalanced ${prelude}`);
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
