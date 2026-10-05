import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ui = (name: string): string => readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', name), 'utf8');
const LAYERS = ui('layers.css');
const DASHBOARD = ui('dashboard.css');

// The rendered review at 1440 with 200% text found Safety and News pushing the
// page sideways: a nowrap control label widened a section's implicit grid
// track, and the viewport queries kept two columns in a 20rem workspace.
// These hold the systemic answer: reflow by the room the workspace has.
describe('layers.css reflows the workspace by its own room', () => {
  it('the workspace is an inline-size container named ws and wraps any word longer than its box', () => {
    const ws = /\.ws \{[^}]*\}/.exec(LAYERS)?.[0] ?? '';
    expect(ws).toContain('container-type: inline-size');
    expect(ws).toContain('container-name: ws');
    expect(ws).toContain('overflow-wrap: anywhere');
    expect(ws).not.toContain('overflow: hidden');
  });
  it('collapses every inner grid and the open detail in a narrow container, in rem so text zoom counts', () => {
    const block = /@container ws \(max-width: 36rem\) \{([\s\S]*?)\n\}/.exec(LAYERS)?.[1] ?? '';
    expect(block).toMatch(/\.wx-grid, \.cv-grid, \.sf-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(block).toMatch(/\.ws-split\[data-detail-open='true'\] \.ws-primary \{ display: none; \}/);
    expect(block).toMatch(/\.ws-back \{ display: inline-flex; \}/);
    // The container rules come after the viewport rules they override, at equal specificity.
    expect(LAYERS.lastIndexOf('@media (min-width: 80rem)')).toBeLessThan(LAYERS.indexOf('@container ws'));
  });
  it('stacks row leads once the room is about a phone at 200% text', () => {
    const block = /@container ws \(max-width: 16rem\) \{([\s\S]*?)\n\}/.exec(LAYERS)?.[1] ?? '';
    expect(block).toMatch(/\.row-button \{ flex-wrap: wrap; \}/);
    // A row lead can give way instead of pushing the chevron out of the row.
    expect(LAYERS).toMatch(/\.row-lead \{ flex: 0 1 auto;/);
  });
  it('control labels in a workspace wrap instead of widening their column, and auto-fit minimums never exceed the box', () => {
    expect(LAYERS).toMatch(/\.ws \.btn, \.ws \.btn-ghost, \.ws \.btn-quiet \{ white-space: normal;/);
    expect(LAYERS).toContain('.sf-numbers { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(8.5rem, 100%), 1fr));');
    expect(LAYERS).toContain('.wx-figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(8rem, 100%), 1fr));');
  });
  it('never hides overflow or shrinks text to make room', () => {
    const collapse = /@container ws[\s\S]*$/.exec(LAYERS)?.[0] ?? '';
    expect(collapse).not.toMatch(/overflow:\s*hidden/);
    expect(collapse).not.toMatch(/font-size:\s*[\d.]+px/);
  });
});

// The irritation pass (5 Oct 2026): Vrijeme rebuilt mobile-first. The hourly steps are a grid that never scrolls
// sideways (two rows of six in a phone's room, one row of twelve from 36rem); its section, which carries the id
// wx-hourly as a class too, is never the grid; the title stands on a phone; the sun's disc has its own class.
describe('layers.css: Vrijeme on a phone', () => {
  const rule = (selector: string): string => new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(LAYERS)?.[1] ?? '';
  it('lays the hourly steps out as a grid of six columns, twelve from 36rem, and never as a scrolling strip', () => {
    expect(rule('ol.wx-hourly')).toContain('display: grid; grid-template-columns: repeat(6, minmax(0, 1fr));');
    const wide = /@container ws \(min-width: 36rem\) \{([\s\S]*?)\n\}/.exec(LAYERS)?.[1] ?? '';
    expect(wide).toContain('ol.wx-hourly { grid-template-columns: repeat(12, minmax(0, 1fr)); }');
    expect(LAYERS).not.toMatch(/wx-hour[^{]*\{[^}]*overflow-x/);
    // Only the list is the grid: a bare .wx-hourly rule would also lay out its section (head beside the cells).
    expect(LAYERS).not.toMatch(/(^|\n|, )\.wx-hourly[ ,{]/);
    expect(LAYERS).not.toMatch(/(^|\n|, )\.wx-warnings[ ,{]/);
  });
  it('shows the layer title on a phone and keeps the facts at three across in a phone-sized room', () => {
    expect(rule('.wx-head .layer-title')).not.toMatch(/clip|position: absolute/);
    const phone = /@container ws \(min-width: 17rem\) and \(max-width: 36rem\) \{([\s\S]*?)\n\}/.exec(LAYERS)?.[1] ?? '';
    expect(phone).toContain('.wx-figures { grid-template-columns: repeat(3, auto); justify-content: space-between; }');
    expect(phone).toContain('.wx-figures .wx-fact-value { flex-wrap: nowrap; white-space: nowrap; }');
  });
  it('fills the sun disc by its own class, never the figure root', () => {
    expect(rule('.g-sun-disc')).toContain('fill: var(--tone-weather)');
    expect(LAYERS).not.toMatch(/\n\.g-sun \{[^}]*fill/);
  });
});

describe('links on tinted fills use the on-tint brand tone', () => {
  it('scopes --tone-text-brand to the on-tint token on the safety level and state notes', () => {
    expect(LAYERS).toMatch(/\.sf-level, \.ws \.state \{ --tone-text-brand: var\(--tone-text-brand-on-tint\); \}/);
    expect(LAYERS).toMatch(/\.sf-level a:hover \{ color: var\(--tone-text-primary\); \}/);
  });
});

describe('dashboard.css has no side rail', () => {
  it('never reintroduces an aside width variable: the workspace column is the whole width', () => {
    expect(DASHBOARD).not.toContain('--ki-side');
    expect(DASHBOARD).not.toContain('--ki-kvart');
  });
});

describe('Grad: the phase bars are a desk figure', () => {
  it('hides .cv-phases below 60rem, where the chips already carry the counts', () => {
    expect(LAYERS).toContain('@media (max-width: 59.99rem) { .cv-phases { display: none; } }');
  });
});

describe('sections are content, not cards (plan "Surfaces", R-D3)', () => {
  it('.sec and .detail carry no border, background or shadow; the hairline rhythm belongs to each domain rule', () => {
    const sec = /\n\.sec \{([^}]*)\}/.exec(LAYERS)?.[1] ?? '';
    const detail = /\n\.detail \{ display: grid;([^}]*)\}/.exec(LAYERS)?.[1] ?? '';
    for (const rule of [sec, detail]) {
      expect(rule).not.toContain('border: 1px');
      expect(rule).not.toContain('background:');
      expect(rule).not.toContain('box-shadow: var(');
    }
    expect(sec).toContain('display: grid');
  });
});

// Round 5, phone finding A1: at 844x390 the Karta stage was blank. city.css's short-window block (a rule from before
// the companion round: a window under 30rem of height gave the sheet the whole stage and hid the map under it) still
// matched the landscape phone, while map.css's landscape block (round 1) had made the sheet a 45 % side column there,
// so the person saw a side column beside an empty field with the page reporting the map ready and its pills drawn.
describe('the landscape phone shows its map (city.css and map.css agree on a short window)', () => {
  const CITY = ui('city.css');
  const MAP = ui('map.css');
  it('city.css hides the map only in a short portrait window, never in landscape', () => {
    const shortBlock = /@media\(max-height:30rem\) and \(max-width:59\.99rem\) and \(orientation:portrait\)\{([\s\S]*?)\n\}/.exec(CITY)?.[1] ?? '';
    expect(shortBlock, 'the short-window block is scoped to portrait').toContain('.ki[data-stage=map] .transport-map{visibility:hidden}');
    const unscoped = /@media\(max-height:30rem\) and \(max-width:59\.99rem\)\{/.exec(CITY);
    expect(unscoped, 'no short-window block without the orientation').toBeNull();
  });
  it('map.css keeps the landscape stage visible beside the side column', () => {
    const landscape = /@media \(max-height: 30rem\) and \(orientation: landscape\) \{([\s\S]*?)\n\}/.exec(MAP)?.[1] ?? '';
    expect(landscape).toContain('inline-size: 45%');
    // The block hides the handle and, in the page's map view, the sheet's body; never the map region or its canvas.
    expect(landscape).not.toMatch(/\.(transport-map|t-map-canvas)[^{,]*\{[^}]*(visibility: hidden|display: none)/);
  });
});
