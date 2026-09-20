import { expect, test } from '@playwright/test';
import { isolateLocalNetwork, localContext, readPairing } from './helpers';

test.describe('real self-service screen', () => {
  test.use({ viewport: { width: 1366, height: 768 }, locale: 'hr-HR' });

  test('starts with one button, names a stop from the screen’s own settings, and pairs a second browser through the real code', async ({ page, browser }) => {
    await isolateLocalNetwork(page.context());
    await page.goto('/kiosk/');
    await expect(page.getByTestId('kiosk-setup')).toBeVisible();
    // One button: nothing to choose before the screen exists.
    await expect(page.locator('select[name="district"]')).toHaveCount(0);
    await expect(page.locator('input[name="stop"]')).toHaveCount(0);
    await page.getByTestId('setup-create').click();
    await expect(page.getByTestId('kiosk-invitation')).toBeVisible({ timeout: 30_000 });
    // A whole-city screen names no place in the header; the gear does.
    await expect(page.getByTestId('kiosk-context')).toHaveText('');
    await page.getByTestId('kiosk-settings').click();
    const panel = page.getByTestId('kiosk-settings-panel');
    await expect(panel).toBeVisible();
    await panel.getByTestId('settings-search').fill('Jela');
    const stop = panel.locator('input[name="settings-stop"][value="106_1"]');
    if (await stop.count()) await stop.check();
    else await panel.locator('input[name="settings-stop"]').nth(1).check();
    await panel.getByTestId('settings-save').click();
    await expect(panel).toBeHidden();
    // The DO's answer is what re-frames the screen: the header names the stop.
    await expect(page.getByTestId('kiosk-context')).not.toHaveText('', { timeout: 30_000 });
    const origin = new URL(page.url()).origin;
    // The shown code carries a middle dot; readPairing joins its two groups the way the URL and a person type it.
    const { scanUrl } = await readPairing(page, origin);
    const context = await localContext(browser, { viewport: { width: 390, height: 844 }, locale: 'hr-HR' });
    try {
      const phone = await context.newPage();
      await phone.goto(scanUrl);
      await expect(phone.getByTestId('session-label')).toBeVisible({ timeout: 30_000 });
      await expect(phone.getByTestId('session-label')).toHaveAttribute('data-state', 'live', { timeout: 30_000 });
      await expect(page.locator('.kiosk')).toHaveAttribute('data-phase', 'invitation');
      // The same-context network is ordinary: no Wi-Fi refusal and no fake grant.
      expect(new URL(phone.url()).pathname).toBe('/d/');
      const session = await phone.evaluate(() => sessionStorage.getItem('vidikovac.dataToken'));
      expect(session).toBeTruthy();
      const gate = await phone.request.get(`${origin}/api/data/zet-rt`);
      expect(gate.status()).toBe(401);
    } finally { await context.close(); }
  });
});
