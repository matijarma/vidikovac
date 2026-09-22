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
const timeline = read('app/src/kiosk/timeline.ts');
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
    // Two regions in the aside: "U blizini" takes the slack above the card.
    expect(windowRule('.kiosk .k-city-window .k-overview')).toContain('grid-template-rows:minmax(0,1fr) auto');
    expect(cityCss).not.toContain('.k-discovery-slot');
    // The three panels the front page draws, and no shell of the ones it dropped.
    for (const dead of ['k-local', 'k-local-facts', 'k-neighborhood', 'k-context-stack', 'k-column', 'k-bottom', 'k-provision', 'k-front'])
      for (const sheet of [css, cityCss]) expect(sheet, dead).not.toMatch(new RegExp(`\\.${dead}(?![\\w-])`));
  });
  // "U blizini" (kiosk/timeline.ts): whole rows and whole words. A row is at
  // least the row budget tall and grows with its words; timeline.ts fits the
  // rows to the box by measuring, so nothing is hidden, clipped or ellipsised.
  // The read tier for title and time, the walk-up tier for the rest, in every
  // wall composition; one fade for a new row, none where motion is unwanted.
  const timelineRules = cityCss.split('\n').filter((line) => /k-nearby|nearby-(row|title|when|sub)/.test(line) && !line.startsWith('.kiosk[data-size=handheld]')).join('\n');
  it('draws the timeline as whole rows at least 64-92 px tall that are sliced, never hidden', () => {
    const rows = windowRule('.kiosk .k-nearby-rows');
    expect(rows).toContain('grid-auto-rows:minmax(calc(var(--k-nearby-row,64px) * var(--k-zoom,1)),auto)');
    expect(rows).toContain('align-content:start');
    const row = windowRule('.kiosk .k-nearby .nearby-row');
    expect(row).toContain('min-height:calc(var(--k-nearby-row,64px) * var(--k-zoom,1))');
    expect(row).toContain('box-sizing:border-box');
    // The time column is the widest time shown; an engine without subgrid keeps the fixed column declared first.
    expect(row).toMatch(/grid-template-columns:4\.8em [^;]+;grid-template-columns:subgrid/);
    expect(windowRule('.kiosk .k-nearby-host')).toContain('grid-template-rows:minmax(0,1fr)');
    expect(cityCss).toContain(".kiosk[data-portrait='1'] .k-overview{grid-template-columns:minmax(0,1fr);grid-template-rows:calc(560px * var(--k-zoom)) auto}");
    expect(cityCss).toContain('.kiosk[data-size=handheld] .k-nearby-host{order:2}');
    expect(windowRule('.kiosk[data-size=handheld] .k-nearby-rows')).toContain('overflow:visible');
    // The component slices and fits; it never hides a row.
    expect(timeline).not.toMatch(/\.hidden\s*=\s*true/);
    expect(timeline).not.toMatch(/setAttribute\('hidden'/);
    expect(timeline).toContain('reconcile(list, next)');
    // The highlight is gone from both sheets.
    for (const sheet of [css, cityCss]) expect(sheet).not.toMatch(/\.k-highlight(?![\w-])/);
  });
  it('never cuts a word: no ellipsis, no clipped title, sub or head, no one-line squeeze', () => {
    expect(timelineRules.length).toBeGreaterThan(0);
    expect(timelineRules).not.toContain('text-overflow');
    expect(timelineRules).not.toContain('line-clamp');
    expect(timelineRules).not.toContain("data-lines");
    for (const selector of ['.kiosk .k-nearby .nearby-title', '.kiosk .k-nearby .nearby-sub', '.kiosk .k-nearby-heading', '.kiosk .k-nearby .nearby-row', '.kiosk .k-nearby-text']) {
      const rule = windowRule(selector);
      expect(rule, selector).not.toBe('');
      expect(rule, selector).not.toContain('nowrap');
      expect(rule, selector).not.toContain('overflow:hidden');
    }
    for (const selector of ['.kiosk .k-nearby .nearby-title', '.kiosk .k-nearby .nearby-sub', '.kiosk .k-nearby-heading']) expect(windowRule(selector), selector).toContain('overflow-wrap:break-word');
    // The time never breaks inside itself ("za 4 min"), and its column is as wide as the widest time, so nothing is cut.
    expect(windowRule('.kiosk .k-nearby-at')).toContain('white-space:nowrap');
    expect(windowRule('.kiosk .k-nearby-rows')).toContain('grid-template-columns:max-content');
  });
  it('sets row title and time on the read tier and the rest of the timeline on the walk-up tier, in every wall composition', () => {
    const nearby = windowRule('.kiosk .k-nearby');
    expect(nearby).toContain('--k-nearby-read-floor:40px');
    expect(nearby).toContain('--k-nearby-walk-floor:28px');
    expect(nearby).toContain('--k-nearby-title-size:max(var(--k-nearby-read-floor),var(--k-main-size))');
    expect(nearby).toContain('--k-nearby-sub-size:max(var(--k-nearby-walk-floor),var(--k-sup-size))');
    expect(windowRule('.kiosk .k-nearby .nearby-title')).toContain('font-size:calc(var(--k-nearby-title-size) * var(--k-nearby-scale,1))');
    expect(windowRule('.kiosk .k-nearby .nearby-when')).toContain('font-size:calc(var(--k-nearby-title-size) * var(--k-nearby-scale,1))');
    expect(windowRule('.kiosk .k-nearby .nearby-sub')).toContain('font-size:calc(var(--k-nearby-sub-size) * var(--k-nearby-scale,1))');
    expect(windowRule('.kiosk .k-nearby-day')).toContain('font-size:calc(var(--k-nearby-sub-size) * var(--k-nearby-scale,1))');
    expect(windowRule('.kiosk .k-nearby-heading')).toContain('font-size:calc(var(--k-nearby-sub-size))');
    // Only a phone leaves the wall floors (test/app/kiosk-timeline.test.ts computes the sizes per composition).
    expect(windowRule('.kiosk[data-size=handheld] .k-nearby')).toContain('--k-nearby-title-size:var(--k-main-size)');
    // The section head and the row titles are two classes, with two rule sets.
    for (const sheet of [css, cityCss]) expect(sheet).not.toMatch(/\.k-nearby-title(?![\w-])/);
    // Blue a tracked departure, grey the timetable, the third ink "uvijek".
    expect(windowRule(".kiosk .k-nearby .nearby-when")).toContain('color:var(--k-ink-2)');
    expect(windowRule(".kiosk .k-nearby .nearby-row[data-live='1'] .nearby-when")).toContain('color:var(--k-action)');
    expect(windowRule(".kiosk .k-nearby .nearby-row[data-always='1'] .nearby-when")).toContain('color:var(--k-ink-3)');
    // The pharmacy row's mark is the green cross.
    expect(windowRule(".kiosk .k-nearby .nearby-row[data-kind='pharmacy'] .k-nearby-mark::after")).toContain('var(--k-green)');
  });
  it('fades a new row in once, and not at all under reduced motion or lagano', () => {
    expect(windowRule(".k-nearby .nearby-row[data-enter='1']")).toContain('animation:k-nearby-in 220ms var(--ease-enter) both');
    expect(cityCss).toContain('@keyframes k-nearby-in{from{opacity:0}}');
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(reduced).toContain(".kiosk .k-nearby .nearby-row[data-enter='1'] { animation: none; }");
    expect(css).toContain(":root[data-lagano='1'] .kiosk .k-nearby .nearby-row[data-enter='1'] { animation: none; }");
  });
  // Postavke's suggestion list stays an exact number of whole control rows.
  it('bounds the settings suggestion list to whole rows', () => {
    const list = rule('.k-settings .k-suggest');
    expect(list).toContain('--k-suggest-row: var(--k-control)');
    expect(list).toContain('grid-auto-rows: var(--k-suggest-row)');
    expect(list).toContain('gap: 0');
    // The list must not be flex-shrunk to whatever the panel's grid leaves it:
    // that lands the edge mid-row whatever the max-height says.
    expect(list).toContain('flex: none');
    // The height is rows only -- no bare rem cap that could land mid-row.
    expect(list).toMatch(/max-height: calc\(var\(--k-suggest-row\) \* 4\)/);
    expect(list).not.toMatch(/max-height:\s*\d/);
    // Inside the panel the box is part of its row, never a layer over the rows below it.
    expect(rule('.k-settings .k-suggest-box')).toContain('position: static');
    // A row that fills its fixed box clips inside it rather than growing past it.
    expect(rule('.k-settings .k-suggest > li')).toContain('height: 100%');
    // The list is still a scroller, so nothing below the last whole row is unreachable,
    // and a hidden list stays hidden under its own display rule.
    expect(list).toContain('overflow-y: auto');
    expect(rule('.k-settings .k-suggest[hidden]')).toContain('display: none');
    // The area/stop panel's list is gone with it.
    expect(css).not.toContain('.k-settings .k-stop-list');
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
    // The settings toggles: never smaller than a finger, whatever the display zoom does to --k-control.
    expect(rule('.k-toggle')).toContain('min-width: 44px');
    expect(rule('.k-toggle')).toContain('min-height: max(44px, var(--k-control))');
  });
});
