import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The /d/ shell's grid and header, read as text: the phone shell is a sticky
// 48 px header, banners in flow and one workspace; the desktop dissolves the
// header into the rail grid. Literals pinned here are the ones the geometry
// gates and the sibling tasks (T1.2 tab bar, T1.3 Promet stage) build on.
const CSS = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'src', 'ui', 'dashboard.css'), 'utf8');
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The declarations of the first flat rule for `selector` inside `scope` (rules in this file never nest). */
const rule = (selector: string, scope: string = CSS): string =>
  new RegExp(`(?:^|\\n)\\s*${escape(selector)} \\{([^}]*)\\}`).exec(scope)?.[1] ?? '';
const DESKTOP = /@media \(min-width: 60rem\) \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? '';

describe('dashboard.css phone shell', () => {
  it('lays the shell out as header, banners and main in flow, on a small-viewport height with the 2017 fallback line above it', () => {
    const ki = rule('.ki');
    expect(ki).toContain("grid-template-areas: 'top' 'banners' 'main'");
    expect(ki).toContain('grid-template-rows: auto auto 1fr');
    expect(ki).toMatch(/min-height: 100vh;\n\s*min-height: 100svh;/);
    expect(ki).toContain('--ki-top: calc(3rem + env(safe-area-inset-top, 0px));');
    expect(ki).toContain('--ki-tabs: calc(3.5rem + env(safe-area-inset-bottom, 0px));');
  });
  it('keeps the header sticky, 3rem plus the safe-area inset, on the chrome surface with the polling hairline along its bottom edge', () => {
    const head = rule('.ki-head');
    expect(head).toContain('grid-area: top');
    expect(head).toContain('position: sticky');
    expect(head).toContain('inset-block-start: 0');
    expect(head).toContain('z-index: var(--z-sticky)');
    expect(head).toContain('min-block-size: var(--ki-top)');
    expect(head).toContain('padding-block-start: env(safe-area-inset-top, 0px)');
    expect(head).toContain('background: var(--tone-surface-1)');
    expect(rule('.ki-head::after')).toContain('block-size: 2px');
    expect(rule(".ki[data-loading='true'] .ki-head::after")).toContain('opacity: 1');
  });
  it('places banners in flow between the header and main; only .ki-main takes the main area', () => {
    expect(rule('.ki-banners')).toContain('grid-area: banners');
    expect(rule('.ki-banners:empty')).toContain('display: none');
    expect(CSS.match(/grid-area: main/g)).toHaveLength(1);
    expect(rule('.ki-main')).toContain('grid-area: main');
    expect(CSS).not.toContain('.ki-banners:not(:empty) + .ki-main');
  });
  it('makes the Promet stage the viewport with the dynamic-viewport unit and its fallback line', () => {
    const stage = rule(".ki[data-stage='map']");
    expect(stage).toContain('block-size: 100vh; block-size: 100dvh');
    expect(stage).toContain('overflow: hidden');
    expect(rule(".ki[data-stage='map'] .ki-main")).toContain('padding: 0');
  });
  it('never sets display: none on the assertive live region, which .visually-hidden hides while readers still hear it', () => {
    expect(CSS).not.toMatch(/\.ki-alert[^{]*\{[^}]*display:\s*none/);
  });
  it('uses vh only as the fallback line directly before an svh or dvh twin, and no !important', () => {
    const fallbacks = [...CSS.matchAll(/([a-z-]+): 100vh;\s*([a-z-]+): 100[sd]vh;/g)];
    const bare = CSS.match(/[\d.]+vh\b/g) ?? [];
    expect(bare).toHaveLength(fallbacks.length);
    for (const [, property, twin] of fallbacks) expect(twin).toBe(property);
    expect(CSS).not.toContain('!important');
  });
});

describe('dashboard.css header controls', () => {
  it('the session pill is a 44 px surface-2 pill whose ring and tint turn amber at warn and rose at alert', () => {
    const pill = rule('.ki-session');
    expect(pill).toContain('min-block-size: var(--target)');
    expect(pill).toContain('border-radius: var(--r-pill)');
    expect(pill).toContain('background: var(--tone-surface-2)');
    expect(rule(".ki-session[data-urgency='warn']")).toContain('--tone-action-brand: var(--tone-weather)');
    expect(rule(".ki-session[data-urgency='alert']")).toContain('--tone-action-brand: var(--tone-urgency)');
  });
  it('the safety control shows its word on the urgency tint and drops it only under 360 px, where the aria-label carries it', () => {
    const safety = rule('.ki-safety');
    expect(safety).toContain('background: var(--tone-tint-urgency)');
    expect(safety).toContain('min-block-size: var(--target)');
    expect(rule('.ki-safety .ki-nav-label')).toContain('display: inline');
    const narrow = /@media \(max-width: 22\.4375rem\) \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? '';
    expect(rule('.ki-safety .ki-nav-label', narrow)).toContain('display: none');
    expect(rule('.ki-safety', narrow)).toContain('min-inline-size: var(--target)');
  });
  it('the wordmark keeps its size and paints only the question mark in the brand tone', () => {
    expect(rule('.ki-wordmark-text')).toContain('font-size: var(--text-lg)');
    expect(rule('.ki-wordmark-mark')).toContain('color: var(--tone-action-brand)');
  });
  it('notice banners take the tint of their kind and keep the dismiss control beside the text at every width', () => {
    expect(rule('.banner-notice')).toContain('flex-wrap: nowrap');
    expect(rule('.banner-notice .banner-text')).toContain('min-inline-size: 0');
    expect(rule(".banner-notice[data-kind='joined']")).toContain('background: var(--tone-tint-success)');
    expect(rule(".banner-notice[data-kind='expiring60'], .banner-notice[data-kind='refusal']")).toContain('background: var(--tone-tint-weather)');
    expect(rule(".banner-notice[data-kind='expiring20']")).toContain('background: var(--tone-tint-urgency)');
    expect(rule('.banner-dismiss')).toContain('margin-inline-start: auto');
  });
});

describe('dashboard.css desktop (60rem and up)', () => {
  it('dissolves the header into the rail grid with the banners row beside the wordmark, and moves the hairline to .ki-top', () => {
    expect(rule('.ki', DESKTOP)).toContain("grid-template-areas: 'top banners' 'side main' 'session main'");
    expect(rule('.ki-head', DESKTOP)).toContain('display: contents');
    expect(rule('.ki-head::after', DESKTOP)).toContain('content: none');
    expect(rule('.ki-top', DESKTOP)).toContain('grid-area: top');
    expect(rule('.ki-top', DESKTOP)).toContain('position: relative');
    expect(rule('.ki-top::after', DESKTOP)).toContain('block-size: 2px');
    expect(rule(".ki[data-loading='true'] .ki-top::after", DESKTOP)).toContain('opacity: 1');
    expect(rule('.ki-session-slot', DESKTOP)).toContain('grid-area: session');
    expect(rule('.ki-safety-slot, .ki-tabbar', DESKTOP)).toContain('display: none');
  });
  it('keeps both sidebar clamps byte-identical (pinned by workspace-css.test.ts as well)', () => {
    expect(CSS).toContain('--ki-side: clamp(14rem, 30vw, 17rem);');
    expect(CSS).toContain('.ki { --ki-side: clamp(14rem, 30vw, 19rem); }');
  });
});
