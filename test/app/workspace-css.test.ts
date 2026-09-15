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
    expect(block).toMatch(/\.wx-grid, \.cv-grid, \.nw-grid, \.sf-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(block).toMatch(/\.ov \{ grid-template-columns: minmax\(0, 1fr\); grid-template-areas: none;/);
    expect(block).toMatch(/\.ws-split\[data-detail-open='true'\] \.ws-primary \{ display: none; \}/);
    expect(block).toMatch(/\.ws-back \{ display: inline-flex; \}/);
    // The container rules come after the viewport rules they override, at equal specificity.
    expect(LAYERS.lastIndexOf('@media (min-width: 80rem)')).toBeLessThan(LAYERS.indexOf('@container ws'));
  });
  it('caps the overview range wrap together with its svg in a narrow container, so the "now" label stays over its marker (the parked T1.5 finding)', () => {
    const block = /@container ws \(max-width: 36rem\) \{([\s\S]*?)\n\}/.exec(LAYERS)?.[1] ?? '';
    expect(block).toContain('.ov-range .g-range { max-inline-size: 26rem; }');
    expect(block).toContain('.ov-range .g-wrap-range { max-inline-size: 26rem; }');
  });
  it('stacks the weather lead and row leads once the room is about a phone at 200% text', () => {
    const block = /@container ws \(max-width: 16rem\) \{([\s\S]*?)\n\}/.exec(LAYERS)?.[1] ?? '';
    expect(block).toMatch(/\.ov-weather-row \{ grid-template-columns: minmax\(0, 1fr\); \}/);
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
    expect(collapse).not.toMatch(/font-size/);
  });
});

describe('links on tinted fills use the on-tint brand tone', () => {
  it('scopes --tone-text-brand to the on-tint token on the overview safety block, the safety level and state notes', () => {
    expect(LAYERS).toMatch(/\.ov-block\.ov-safety, \.sf-level, \.ws \.state \{ --tone-text-brand: var\(--tone-text-brand-on-tint\); \}/);
    expect(LAYERS).toMatch(/\.ov-block\.ov-safety a:hover, \.sf-level a:hover \{ color: var\(--tone-text-primary\); \}/);
  });
});

describe('dashboard.css kvart aside under text zoom', () => {
  it('pins the aside at 18.75rem, a rem track that grows with the text it holds, beside a workspace column that can shrink to zero', () => {
    expect(DASHBOARD).toContain('--ki-kvart: 18.75rem;');
    expect(DASHBOARD).not.toContain('--ki-side');
    // At the 60rem desktop switch the aside is under a third of the width; at 200% text (30rem viewport) it is 62.5%, and
    // the minmax(0, 1fr) workspace column gives way rather than the page widening (shell-css.test.ts pins the columns).
    expect(18.75 / 60).toBeLessThan(1 / 3);
    expect(18.75 / 30).toBeLessThan(1);
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

