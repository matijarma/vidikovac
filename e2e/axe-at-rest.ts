import type { Page } from '@playwright/test';

/**
 * Runs an axe pass over the page at rest. A poll's change on the session page
 * settles its words in over a moment (ui/dom/reconcile.ts data-changed, an
 * opacity animation), and axe reads the contrast of a word caught mid-settle
 * as a failure; under reduced motion the page draws every change at once
 * (signage.css), which is the page as a reader sees it a moment later. Motion
 * is put back afterwards, so what a test measures next (a Tab walk, a fade) is
 * the page as shipped.
 */
export async function analyzeAtRest<T>(page: Page, run: () => Promise<T>): Promise<T> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    return await run();
  } finally {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
}
