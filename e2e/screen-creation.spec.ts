import { expect, test } from '@playwright/test';
import { isolateLocalNetwork, localContext, readPairing } from './helpers';

test.describe('real self-service screen', () => {
  test.use({ viewport: { width: 1366, height: 768 }, locale: 'hr-HR' });

  test('starts from one field, names the picked stop, changes Kadar through a long press on the brand, and pairs a second browser through the real code', async ({ page, browser }) => {
    await isolateLocalNetwork(page.context());
    await page.goto('/kiosk/');
    const setup = page.getByTestId('kiosk-setup');
    await expect(setup).toBeVisible();
    // One optional field; left empty, the line under it says the whole city.
    const field = setup.getByTestId('setup-place');
    const preview = setup.getByTestId('setup-preview');
    await expect(preview).toHaveText('Na zaslonu: cijeli grad.');
    await expect(setup.getByTestId('setup-create')).toHaveText('Pokreni');
    // The stop is picked among the suggestions (stops come first; a street named after the square may follow).
    await field.fill('Kvaternikov');
    await expect(setup.getByTestId('setup-suggestions')).toBeVisible({ timeout: 30_000 });
    await setup.locator('[data-testid=setup-suggestion][data-kind=stop]').filter({ hasText: 'Kvaternikov trg' }).first().click();
    await expect(field).toHaveValue('Kvaternikov trg');
    await expect(preview).toHaveText('Na zaslonu: Kvaternikov trg i 6 stajališta uokolo');
    await setup.getByTestId('setup-create').click();
    await expect(page.getByTestId('kiosk-invitation')).toBeVisible({ timeout: 30_000 });
    // The header names the place the Worker resolved from its own stop table, and carries no operator control.
    await expect(page.getByTestId('kiosk-context')).toHaveText('Kvaternikov trg', { timeout: 30_000 });
    await expect(page.getByTestId('kiosk-settings')).toHaveCount(0);
    await expect(page.getByTestId('kiosk-theme')).toHaveCount(0);
    const shell = page.locator('.kiosk');
    await expect(shell).toHaveAttribute('data-frame', '6');
    // The wall itself holds the keyboard's focus from the moment it mounts (lane/w-settings): the root, never a tab stop.
    const wallHasFocus = () => page.evaluate(() => document.activeElement?.classList.contains('kiosk') ?? false);
    await expect.poll(wallHasFocus, { message: 'the wall takes the focus when the invitation mounts' }).toBe(true);
    await expect(shell).toHaveAttribute('tabindex', '-1');
    // Postavke open only on a press held past LONG_PRESS_MS (800 ms) on the brand.
    await page.getByTestId('kiosk-brand').click({ delay: 900 });
    const panel = page.getByTestId('kiosk-settings-panel');
    await expect(panel).toBeVisible();
    const kadar = panel.getByTestId('toggle-frame');
    await expect(kadar).toHaveAttribute('data-value', '6');
    await kadar.click();
    // The toggle says the new state at once; the shell follows only the DO's answer to the one
    // screen-set version 2 frame the panel sends 0.8 s after the click. The panel stays open.
    await expect(kadar).toHaveAttribute('data-value', '8');
    await expect(kadar).toHaveText('Kadar: 8 stajališta odavde');
    await expect(shell).toHaveAttribute('data-frame', '8', { timeout: 30_000 });
    await expect(panel).toBeVisible();
    await kadar.press('Escape');
    await expect(panel).toBeHidden();
    // The operator's mouse misses the brand and lands on the header's date (nothing focusable): the wall takes
    // the focus back, and Enter on the wall opens Postavke without the brand. Escape closes them again.
    await page.getByTestId('kiosk-date').click();
    await expect.poll(wallHasFocus, { message: 'a press on nothing focusable hands the focus to the wall' }).toBe(true);
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    // "Press and hold anywhere on the wall for about a second": the same 900 ms press on the date opens Postavke too.
    await page.getByTestId('kiosk-date').click({ delay: 900 });
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByTestId('kiosk-context')).toHaveText('Kvaternikov trg');
    const origin = new URL(page.url()).origin;
    // The shown code carries a middle dot; readPairing joins its two groups the way the URL and a person type it.
    const { scanUrl } = await readPairing(page, origin);
    const context = await localContext(browser, { viewport: { width: 390, height: 844 }, locale: 'hr-HR' });
    try {
      const phone = await context.newPage();
      await phone.goto(scanUrl);
      await expect(phone.getByTestId('session-label')).toBeVisible({ timeout: 30_000 });
      await expect(phone.getByTestId('session-label')).toHaveAttribute('data-state', 'live', { timeout: 30_000 });
      await expect(shell).toHaveAttribute('data-phase', 'invitation');
      // The same-context network is ordinary: no Wi-Fi refusal and no fake grant.
      expect(new URL(phone.url()).pathname).toBe('/d/');
      const session = await phone.evaluate(() => sessionStorage.getItem('vidikovac.dataToken'));
      expect(session).toBeTruthy();
      const gate = await phone.request.get(`${origin}/api/data/zet-rt`);
      expect(gate.status()).toBe(401);
    } finally { await context.close(); }
  });
});
