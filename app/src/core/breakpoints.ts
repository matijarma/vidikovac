// The three widths the layout decides on, in CSS px. Pure constants with no
// DOM, so the Playwright tier (through e2e/lib.ts) and the unit tier read the
// same numbers the CSS is written against; test/app/breakpoints.test.ts holds
// the CSS and these values together.

/** The shell's single breakpoint: phone below, desktop (rail, columns) from here. 60rem at a 16 px root. */
export const DESKTOP_MIN_PX = 960;
/** A kiosk opened on something narrower than this is a handheld: the wizard renders in one column and offers the provisioning link. */
export const KIOSK_HANDHELD_MAX_PX = 900;
/** The wide kiosk composition (1920-class screens) starts here; below it the compact one (1366-class). */
export const KIOSK_WIDE_MIN_PX = 1700;
