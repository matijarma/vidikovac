// /statistika/, the public report, and the /prijava/ dialog that frames it.
// Most tests answer /api/statistika from fixtures the real builder made
// (statistika-fixtures.ts), so the page is seen busy, sparse and empty; the
// last one reads the local Worker's own (empty) counters end to end.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { StatistikaWindow } from '../shared/statistika';
import { statistikaFixture, type FixtureShape } from './statistika-fixtures';

async function serve(page: Page, shape: FixtureShape, fail = 0): Promise<{ calls: string[] }> {
  const calls: string[] = [];
  let failures = fail;
  await page.route('**/api/statistika**', async (route) => {
    const days = Number(new URL(route.request().url()).searchParams.get('dani') ?? 30) as StatistikaWindow;
    calls.push(String(days));
    if (failures > 0) {
      failures -= 1;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(statistikaFixture(shape, days)) });
  });
  return { calls };
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe('/statistika/', () => {
  test('draws every section from the report and keeps the window and scope in the address', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const { calls } = await serve(page, 'busy');
    await page.goto('/statistika/');
    await expect(page.locator('[data-st="window"]')).toContainText('Zadnjih 30 dana');
    await expect(page.locator('.st-kpi-value').first()).not.toHaveText('');
    await expect(page.locator('[data-st="usage"] .st-card')).toHaveCount(8);
    await expect(page.locator('[data-st="sources"] .st-stack')).toHaveCount(9);
    await expect(page.locator('[data-st="trams"] .st-card')).toHaveCount(6);
    // Temporary screens outnumber venues in the busy month, so they open first.
    await expect(page.locator('[data-scope="evaluation"]')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('[data-st="range"] [data-days="7"]').click();
    await expect(page.locator('[data-st="window"]')).toContainText('Zadnjih 7 dana');
    await expect(page).toHaveURL(/dani=7/);
    await expect(page.locator('[data-st="range"] [data-days="7"]')).toHaveAttribute('aria-current', 'true');
    expect(calls).toEqual(['30', '7']);

    await page.locator('[data-scope="venue"]').click();
    await expect(page).toHaveURL(/opseg=lokacije/);
    await expect(page.locator('.st-scope-note')).toContainText('ulaze u skup za Grad');
    await expect(page.locator('[data-scope="venue"]')).toBeFocused();

    // A reload shows exactly what the address says.
    await page.reload();
    await expect(page.locator('[data-st="window"]')).toContainText('Zadnjih 7 dana');
    await expect(page.locator('[data-scope="venue"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a chart is one tab stop whose arrows move a readout; its numbers sit in a table', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await serve(page, 'busy');
    await page.goto('/statistika/');
    const chart = page.locator('[data-st="usage"] .st-cols').first();
    const readout = page.locator('[data-st="usage"] .st-readout').first();
    await expect(readout).toContainText('Ukupno');
    await chart.focus();
    await page.keyboard.press('End');
    await expect(readout).toHaveText(/24\. 9\. 2026\.: \d/);
    await page.keyboard.press('ArrowLeft');
    await expect(readout).toHaveText(/23\. 9\. 2026\.: /);
    await page.keyboard.press('Escape');
    await expect(readout).toContainText('Ukupno');
    const table = page.locator('[data-st="usage"] .st-table').first();
    await table.locator('summary').click();
    await expect(table.locator('tbody tr')).toHaveCount(30);
  });

  test('the district map draws the seventeen četvrti when it comes near', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await serve(page, 'busy');
    await page.goto('/statistika/#graf-cetvrti');
    await expect(page.locator('#graf-cetvrti .st-map path')).toHaveCount(17);
    await expect(page.locator('#graf-krizanja')).toBeAttached();
    await page.locator('#graf-krizanja').scrollIntoViewIfNeeded();
    await expect(page.locator('#graf-krizanja .st-dot')).not.toHaveCount(0);
  });

  test('an empty window says what the threshold hides, never a false zero day', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await serve(page, 'empty');
    await page.goto('/statistika/');
    await expect(page.locator('.st-kpi-sub').first()).toHaveText('nijedan dan nije prešao prag od 10');
    await expect(page.locator('[data-st="usage"] .st-empty').first()).toContainText('nijedan dan nije prešao prag od 10 sesija');
    await expect(page.locator('[data-st="sources"]')).toContainText('nema zapisanih dohvata');
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test('a failed load offers a retry that works', async ({ page }) => {
    await serve(page, 'sparse', 1);
    await page.goto('/statistika/');
    const retry = page.locator('.st-retry').first();
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.locator('[data-st="window"]')).toContainText('Zadnjih 30 dana');
    await expect(page.locator('.st-retry')).toHaveCount(0);
  });

  test('the framed view drops the chrome and sends every link to a new tab', async ({ page }) => {
    await serve(page, 'busy');
    await page.goto('/statistika/?ugradeno=1');
    await expect(page.locator('.st-top')).toBeHidden();
    await expect(page.locator('.st-foot')).toBeHidden();
    await expect(page.locator('.st-nav')).toBeVisible();
    await expect(page.locator('a[href="/privatnost/#tocka-4"]').first()).toHaveAttribute('target', '_blank');
    await expect(page.locator('[data-st="sections"] a').first()).not.toHaveAttribute('target', '_blank');
  });

  for (const width of [360, 1366]) {
    test(`reflows at ${width} px, and at 200 % text, without a sideways scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await serve(page, 'busy');
      await page.goto('/statistika/');
      await expect(page.locator('[data-st="usage"] .st-card')).toHaveCount(8);
      expect(await horizontalOverflow(page)).toBe(0);
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await page.setViewportSize({ width: Math.max(width, 640), height: 900 });
      expect(await horizontalOverflow(page)).toBe(0);
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    for (const width of [390, 1366]) {
      test(`axe: no serious or critical violation, ${scheme}, ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme });
        await serve(page, 'busy');
        await page.goto('/statistika/');
        await expect(page.locator('[data-st="trams"] .st-card')).toHaveCount(6);
        // Open one table so its markup is checked too.
        await page.locator('.st-table summary').first().click();
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      });
    }
  }
});

test.describe('/prijava/ opens the live statistics in a dialog', () => {
  test('the status-line link opens a framed /statistika/, a new-tab link, and closes back to itself', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await serve(page, 'busy');
    await page.goto('/prijava/');
    const link = page.getByTestId('prijava-stats');
    await expect(link).toHaveAttribute('href', '/statistika/');
    await expect(page.getByTestId('prijava-stats-frame')).toHaveCount(0);
    await link.click();
    const dialog = page.getByTestId('prijava-stats-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('prijava-stats-close')).toBeFocused();
    await expect(page.getByTestId('prijava-stats-tab')).toHaveAttribute('href', '/statistika/');
    await expect(page.getByTestId('prijava-stats-tab')).toHaveAttribute('target', '_blank');
    const frame = page.frameLocator('[data-testid="prijava-stats-frame"]');
    await expect(frame.locator('[data-st="window"]')).toContainText('Zadnjih 30 dana');
    await expect(frame.locator('.st-top')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(link).toBeFocused();
    // Opened again, the frame is the one already loaded.
    await link.click();
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('prijava-stats-frame')).toHaveCount(1);
  });

  test('on a phone the dialog fills the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await serve(page, 'busy');
    await page.goto('/prijava/');
    await page.getByTestId('prijava-stats').click();
    const box = await page.getByTestId('prijava-stats-dialog').boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(389);
    expect(box?.height).toBeGreaterThanOrEqual(800);
  });
});

test('end to end: the Worker serves the page frameable by its own origin and the report without access', async ({ page, request }) => {
  const html = await request.get('/statistika/');
  expect(html.status()).toBe(200);
  expect(html.headers()['x-frame-options']).toBe('SAMEORIGIN');
  // The CSP comes from the asset layer's _headers, which a local `wrangler dev` does not always apply;
  // where it arrives, it must allow this origin and nothing wider.
  const csp = html.headers()['content-security-policy'];
  if (csp !== undefined) {
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("frame-ancestors 'none'");
  }
  const other = await request.get('/privatnost/');
  expect(other.headers()['x-frame-options'] ?? 'DENY').toBe('DENY');
  const json = await request.get('/api/statistika?dani=7');
  expect(json.status()).toBe(200);
  expect(json.headers()['cache-control']).toContain('s-maxage=300');
  const body = await json.json();
  expect(body.days).toHaveLength(7);
  await page.goto('/statistika/?dani=7');
  await expect(page.locator('[data-st="window"]')).toContainText('Zadnjih 7 dana');
});
