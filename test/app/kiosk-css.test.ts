import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pairedShell } from '../../app/src/kiosk/paired';
import { kioskStrings } from '../../app/src/kiosk/strings';

// The old suite pinned the rejected composition, including row hiding.
// Keep structural invariants here; rendered geometry and useful content are
// verified by e2e/redesign.spec.ts across the actual display sizes.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const css = read('app/src/ui/kiosk.css').replace(/\/\*[\s\S]*?\*\//g, '');
const cityCss = read('app/src/ui/kiosk-city.css').replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = read('app/src/ui/tokens.css');
const invitation = read('app/src/kiosk/invitation.ts');
const ruleIn = (sheet: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)}`).exec(sheet)?.[1] ?? '';
};
const rule = (selector: string) => ruleIn(css, selector);
const windowRule = (selector: string) => ruleIn(cityCss, selector);

describe('public-screen design invariants', () => {
  it('uses the shared semantic palette, including the scanner-safe QR pair', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    for (const role of ['surface-canvas', 'surface-1', 'text-primary', 'text-muted', 'action-brand', 'qr-ink', 'qr-plate']) {
      expect(css).toContain(`var(--tone-${role})`);
    }
  });
  it('draws the window in four compositions: the map beside the aside, stacked on a totem, in one column on a phone', () => {
    for (const selector of ["data-size='wide'", "data-size='compact'", "data-portrait='1'", "data-size='handheld'"]) expect(css).toContain(selector);
    expect(windowRule('.kiosk .k-city-window').replace(/\s/g,'')).toContain('grid-template-columns:minmax(0,1fr)var(--k-side-w)');
    expect(cityCss).toContain(".kiosk[data-portrait='1'] .k-city-window");
    expect(cityCss).toContain(".kiosk[data-size=handheld] .k-city-window");
    // The events card takes the aside's slack: no dead space between the exceptions and the card.
    expect(windowRule('.kiosk .k-city-window .k-overview')).toContain('grid-template-rows:auto minmax(0,1fr) auto');
    expect(cityCss).not.toContain('.k-discovery-slot');
    // The three panels the front page draws, and no shell of the ones it dropped.
    for (const dead of ['k-local', 'k-local-facts', 'k-neighborhood', 'k-context-stack', 'k-column', 'k-bottom', 'k-provision', 'k-front'])
      for (const sheet of [css, cityCss]) expect(sheet, dead).not.toMatch(new RegExp(`\\.${dead}(?![\\w-])`));
  });
  // Postavke's stop list on a wall: it may scroll, but it may not show half a
  // row. The rows are a fixed height and the box is an exact number of them
  // plus the gaps, so the cut always lands between two rows.
  it('bounds the settings stop list to whole rows', () => {
    const list = rule('.k-settings .k-stop-list');
    expect(list).toContain('--k-stop-row');
    expect(list).toContain('grid-auto-rows: var(--k-stop-row)');
    // The list must not be flex-shrunk to whatever the panel's grid leaves it:
    // that lands the edge mid-row whatever the max-height says (measured: a
    // 321 px box against an 84 px row pitch, two rows cut).
    expect(list).toContain('flex: none');
    // The height is rows and gaps only -- no bare rem cap that could land mid-row.
    expect(list).toMatch(/max-height: calc\(var\(--k-stop-row\) \* 3 \+ var\(--k-gap\) \* 0\.6 \* 2\)/);
    expect(list).not.toMatch(/max-height:\s*\d/);
    // The row holds a name over a two-line route list; measured on the panel,
    // that is 132 px, and a shorter row slices the routes through the middle.
    expect(list).toContain('--k-stop-row: 8.25rem');
    // A row that fills its fixed box clips inside it rather than growing past it.
    expect(rule('.k-settings .k-stop-list .k-choice-text')).toContain('height: 100%');
    expect(rule('.k-settings .k-stop-list .k-stop-meta')).toContain('-webkit-line-clamp: 2');
    // The list is still a scroller, so nothing below the fifth row is unreachable.
    expect(rule('.k-stop-list')).toContain('overflow-y: auto');
  });
  it('carries the header ticker on one line, crossfaded and stopped where motion is unwanted', () => {
    expect(rule('.k-ticker')).toContain('font-size: var(--k-ticker-size)');
    expect(rule('.k-ticker-text')).toContain('text-overflow: ellipsis');
    expect(rule(".k-ticker[data-swap='1']")).toContain('animation: k-ticker-in 220ms');
    expect(rule(".kiosk[data-size='wide']")).toContain('--k-ticker-size: calc(26px * var(--k-zoom))');
    expect(rule(".kiosk[data-size='compact']")).toContain('--k-ticker-size: calc(20px * var(--k-zoom))');
    expect(css).toContain(".kiosk .k-ticker[data-swap='1'] { animation: none; }");
    // The header's weather group is gone for good: the card owns the weather (T3).
    expect(css).not.toMatch(/\.k-weather(?![\w-])/);
    expect(css).not.toMatch(/\.k-sun(?![\w-])/);
  });
  it('keeps the QR at a 240px design floor with a separate sign scale', () => {
    expect(rule(".kiosk[data-size='wide']")).toContain('--k-qr: calc(240px * var(--k-sign-zoom))');
    expect(rule(".kiosk[data-size='compact']")).toContain('--k-qr: calc(240px * var(--k-sign-zoom))');
    expect(rule('.k-qr')).toContain('width: var(--k-qr)');
    expect(windowRule('.kiosk .k-city-window .k-invite')).toContain('var(--k-qr)');
    expect(rule('.k-qr .qr')).toContain('var(--k-qr-plate)');
  });
  it('sets the pairing code at a fixed monospace size, left-aligned, its groups a third of a space apart', () => {
    expect(rule('.k-code')).toContain('var(--font-mono)');
    expect(rule('.k-code')).toContain('font-variant-numeric: tabular-nums');
    expect(rule('.k-code')).toContain('justify-content: flex-start');
    expect(rule('.k-code')).toContain('gap: 0.35em');
    expect(rule('.k-code')).toContain('font-size: var(--k-code-size)');
    // Never a container query and never spread across the card: both made the code a decoration.
    expect(rule('.k-code')).not.toContain('clamp(');
    expect(rule('.k-code')).not.toContain('space-between');
    expect(css).not.toContain('container-type');
    expect(rule(".kiosk[data-size='wide']")).toContain('--k-code-size: calc(36px * var(--k-sign-zoom))');
    // The card is one row in the window and stood up in the narrow rails; either way one column of words the code closes.
    expect(windowRule('.kiosk .k-city-window .k-invite')).toContain("grid-template-areas:'qr side'");
    expect(rule('.k-invite')).toContain("grid-template-areas: 'qr' 'side'");
    expect(rule('.k-invite-side')).toContain('grid-area: side');
  });
  it('progress animates by transform, not layout width', () => {
    expect(rule('.k-progress-bar')).toContain('transition: transform');
    expect(rule('.k-progress-bar')).not.toContain('transition: width');
  });
  it('never hides useful overview rows as a fitting strategy', () => {
    expect(invitation).not.toMatch(/\.hidden\s*=\s*true/);
    expect(invitation).toContain('dataset.overflow');
  });
  it('keeps the transit board outside the map in presented mode', () => {
    const shell = pairedShell('u-pokretu', kioskStrings('hr'), false);
    expect(shell).not.toContain('k-lines--overlay');
    expect(shell).toContain('k-present-board');
    expect(shell).toContain('kiosk-map-host');
    expect(shell).toContain('kiosk-qr');
  });
  it('does not make Sada another copy of the transit map, even for a legacy kvart target (it renders as plain Sada)', () => {
    const shell = pairedShell('grad-sada', kioskStrings('hr'), false);
    expect(shell).toContain('kiosk-main');
    expect(shell).not.toContain('kiosk-map-host');
  });
  it('retains reduced-motion and lightweight paths', () => {
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain("data-lagano='1'");
    expect(css).toContain("data-size='handheld']) { overflow: visible;");
  });
  it('retains accessible controls instead of shrinking their hit areas', () => {
    expect(tokens).toContain('--target: 2.75rem');
    expect(tokens).toContain('--target-primary: 3rem');
    expect(rule('.k-return')).toContain('min-height: 44px');
    expect(rule('.k-theme')).toContain('min-width: 44px');
  });
});
