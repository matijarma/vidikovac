// Wall constants fixed once by the companion plan (docs/companion-2026-09-22.md
// §15.2), so the settings (WP3), the timeline (WP1) and the acceptance specs
// (WP6) read one number.

/**
 * A press on the brand (`[data-testid=kiosk-brand]`) held this long opens the screen's
 * settings; anything shorter, or a finger that moves, opens nothing. WP6's specs hold
 * 900 ms, so the test clears the threshold with room to spare.
 */
export const LONG_PRESS_MS = 800;
