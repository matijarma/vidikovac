import { expect, test } from '@playwright/test';
import { readPairing } from './helpers';

test.describe('real self-service screen', () => {
  test.use({ viewport: { width: 1366, height: 768 }, locale: 'hr-HR' });

  test('sets up a named stop and pairs a second browser through the real code', async ({ page, browser }) => {
    await page.goto('/kiosk/');
    await expect(page.getByTestId('kiosk-setup')).toBeVisible();
    await page.getByTestId('setup-next').click();
    await expect(page.getByTestId('setup-stops')).toBeVisible();
    const search = page.getByTestId('setup-search');
    await search.fill('Jela');
    const stop = page.locator('input[name="stop"][value="106_1"]');
    if (await stop.count()) await stop.check();
    else await page.locator('input[name="stop"]').first().check();
    await page.getByTestId('setup-create').click();
    await expect(page.getByTestId('kiosk-invitation')).toBeVisible({ timeout: 30_000 });
    const origin = new URL(page.url()).origin;
    // The shown code carries a middle dot; readPairing joins its two groups the way the URL and a person type it.
    const { scanUrl } = await readPairing(page, origin);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'hr-HR' });
    try {
      const phone = await context.newPage();
      await phone.goto(scanUrl);
      await expect(phone.getByTestId('confirm-card')).toBeVisible();
      await phone.getByRole('button', { name: 'Otključaj', exact: true }).click();
      await expect(phone.getByTestId('session-label')).toBeVisible({ timeout: 30_000 });
      await expect(phone.getByTestId('session-label')).toHaveAttribute('data-state', 'live', { timeout: 30_000 });
      await expect(page.locator('.kiosk')).toHaveAttribute('data-phase', 'paired');
      // The same-context network is ordinary: no Wi-Fi refusal and no fake grant.
      expect(new URL(phone.url()).pathname).toBe('/d/');
      const session = await phone.evaluate(() => sessionStorage.getItem('vidikovac.dataToken'));
      expect(session).toBeTruthy();
      const gate = await phone.request.get(`${origin}/api/data/zet-rt`);
      expect(gate.status()).toBe(401);
    } finally { await context.close(); }
  });
});
