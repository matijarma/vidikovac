import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESKTOP_MIN_PX, KIOSK_HANDHELD_MAX_PX, KIOSK_WIDE_MIN_PX } from '../../app/src/core/breakpoints';
import { WIDE_MIN_WIDTH } from '../../app/src/kiosk/layout';
import * as e2eLib from '../../e2e/lib';

const root = join(import.meta.dirname, '..', '..');
const DASHBOARD_CSS = readFileSync(join(root, 'app', 'src', 'ui', 'dashboard.css'), 'utf8');
/** The root font size the rem media query is written against. */
const ROOT_PX = 16;

// One breakpoint each for the shell (phone below, desktop from here), the
// kiosk wizard on a handheld, and the wide kiosk composition. The e2e tier
// imports them through e2e/lib.ts, so a spec never carries its own literal.
describe('core/breakpoints', () => {
  it('names the three widths the plan fixes', () => {
    expect(DESKTOP_MIN_PX).toBe(960);
    expect(KIOSK_HANDHELD_MAX_PX).toBe(900);
    expect(KIOSK_WIDE_MIN_PX).toBe(1700);
  });

  it('agrees with the shell CSS: the single 60rem media query is 960 px at a 16 px root', () => {
    expect(DASHBOARD_CSS).toContain('@media (min-width: 60rem)');
    expect(60 * ROOT_PX).toBe(DESKTOP_MIN_PX);
  });

  it('agrees with the kiosk layout decision', () => {
    expect(WIDE_MIN_WIDTH).toBe(KIOSK_WIDE_MIN_PX);
  });

  it('is re-exported by e2e/lib.ts for the Playwright tier', () => {
    expect(e2eLib.DESKTOP_MIN_PX).toBe(DESKTOP_MIN_PX);
    expect(e2eLib.KIOSK_HANDHELD_MAX_PX).toBe(KIOSK_HANDHELD_MAX_PX);
    expect(e2eLib.KIOSK_WIDE_MIN_PX).toBe(KIOSK_WIDE_MIN_PX);
  });
});
