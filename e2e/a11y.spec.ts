// axe-core over every public surface, in both colour schemes, against WCAG 2.x A
// and AA rules. Serious and critical violations fail the run; moderate and minor
// ones are printed for the record. The pages are loaded without a session, which
// is exactly how a person without a phone meets them.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { APP_URL } from './helpers';

const PAGES: { path: string; viewport: { width: number; height: number } }[] = [
  { path: '/', viewport: { width: 1280, height: 800 } },
  { path: '/hitno', viewport: { width: 412, height: 915 } },
  { path: '/kiosk/', viewport: { width: 1920, height: 1080 } },
  { path: '/s/', viewport: { width: 412, height: 915 } },
  { path: '/d/', viewport: { width: 1280, height: 800 } },
];
const SCHEMES = ['light', 'dark'] as const;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['serious', 'critical']);

for (const { path, viewport } of PAGES) {
  for (const scheme of SCHEMES) {
    test(`axe ${path} (${scheme}): no serious or critical violations`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      const response = await page.goto(`${APP_URL}${path}`);
      expect(response?.status(), `${path} must answer 200`).toBe(200);
      await page.waitForLoadState('networkidle');

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
