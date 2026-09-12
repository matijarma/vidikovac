// axe-core over every public surface, in both colour schemes, against WCAG 2.x A
// and AA rules. Serious and critical violations fail the run; moderate and minor
// ones are printed for the record. The pages are loaded without a session, which
// is exactly how a person without a phone meets them.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { APP_URL } from './helpers';

// The two sizes design.md and Vidikovac.dc.html were drawn at: kiosk 1080p
// and the /d phone artboard (390×844). Every surface is swept at whichever
// of the two (or both) it is actually laid out for.
const KIOSK = { width: 1920, height: 1080 };
const PHONE = { width: 390, height: 844 };

const PAGES: { path: string; viewport: typeof KIOSK }[] = [
  { path: '/', viewport: KIOSK },
  { path: '/', viewport: PHONE },
  { path: '/hitno', viewport: PHONE },
  { path: '/kiosk/', viewport: KIOSK },
  { path: '/s/', viewport: PHONE },
  { path: '/d/', viewport: PHONE },
  { path: '/d/', viewport: KIOSK },
];
const SCHEMES = ['light', 'dark'] as const;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['serious', 'critical']);

for (const { path, viewport } of PAGES) {
  for (const scheme of SCHEMES) {
    // The viewport width rides in the title so /d/ and / (each swept at both
    // sizes) don't collide on a repeated title.
    test(`axe ${path} @${viewport.width} (${scheme}): no serious or critical violations`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      const response = await page.goto(`${APP_URL}${path}`);
      expect(response?.status(), `${path} must answer 200`).toBe(200);
      await page.waitForLoadState('networkidle');

      // R-M1: /d had no h1 at all; every surface in the matrix must have
      // exactly one, the one landmark a page's accessible name hangs off.
      const h1Count = await page.locator('h1').count();
      expect(h1Count, `${path} @${viewport.width} must have exactly one h1`).toBe(1);

      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      const describe = (v: (typeof results.violations)[number]) =>
        `${v.impact} ${v.id}: ${v.help}\n  ${v.helpUrl}\n` +
        v.nodes
          .slice(0, 5)
          .map((n) => `  - ${n.target.join(' ')}: ${(n.failureSummary ?? '').split('\n')[0]}`)
          .join('\n');

      const advisory = results.violations.filter((v) => !v.impact || !BLOCKING.has(v.impact));
      if (advisory.length > 0) console.log(`[axe advisory] ${path} (${scheme})\n${advisory.map(describe).join('\n')}`);

      const blocking = results.violations.filter((v) => v.impact && BLOCKING.has(v.impact));
      expect(blocking, blocking.map(describe).join('\n\n')).toEqual([]);
    });
  }
}
