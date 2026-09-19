import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pairedShell } from '../../app/src/kiosk/paired';
import { kioskStrings } from '../../app/src/kiosk/strings';

// The old suite pinned the rejected composition, including row hiding.
// Keep structural invariants here; rendered geometry and useful content are
// verified by e2e/redesign.spec.ts across the actual display sizes.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const css = read('app/src/ui/kiosk.css').replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = read('app/src/ui/tokens.css');
const invitation = read('app/src/kiosk/invitation.ts');
const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)}`).exec(css)?.[1] ?? '';
};

describe('public-screen design invariants', () => {
  it('uses the shared semantic palette, including the scanner-safe QR pair', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    for (const role of ['surface-canvas', 'surface-1', 'text-primary', 'text-muted', 'action-brand', 'qr-ink', 'qr-plate']) {
      expect(css).toContain(`var(--tone-${role})`);
    }
  });
  it('has distinct landscape, compact, portrait and handheld compositions', () => {
    for (const selector of ["data-size='wide'", "data-size='compact'", "data-portrait='1'", "data-size='handheld'"]) expect(css).toContain(selector);
    expect(css).toContain('.k-geography');
    expect(css).toContain('.k-context-stack');
    expect(rule('.k-front')).toContain('grid-template-columns');
    expect(css).toContain("data-size='compact']:not([data-portrait='1']) .k-front");
  });
  it('keeps the QR at a 240px design floor with a separate sign scale', () => {
    expect(rule(".kiosk[data-size='wide']")).toContain('--k-qr: calc(240px * var(--k-sign-zoom))');
    expect(rule(".kiosk[data-size='compact']")).toContain('--k-qr: calc(240px * var(--k-sign-zoom))');
    expect(rule('.k-invite')).toContain('var(--k-qr)');
    expect(rule('.k-qr .qr')).toContain('var(--k-qr-plate)');
  });
  it('uses tabular numerals and a bounded monospace pairing code', () => {
    expect(rule('.k-code')).toContain('var(--font-mono)');
    expect(rule('.k-code')).toContain('font-variant-numeric: tabular-nums');
    expect(rule('.k-code')).toContain('clamp(');
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
