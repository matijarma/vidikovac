import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`project description preserves reading position across code rotations at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.install({ time: new Date('2026-09-17T12:00:01Z') });
    await page.goto('/prijava/');
    await page.evaluate(() => document.fonts.ready);
    const id = '6-kriteriji-iz-priloga-1-programa';
    const position = await page.locator(`[id="${id}"]`).evaluate(section => {
      const y = section.getBoundingClientRect().top + scrollY + 140;
      scrollTo({ top: y, behavior: 'instant' });
      return y;
    });
    await expect(page.locator(`#toc [data-target="${id}"]`)).toHaveAttribute('aria-current', 'true', { timeout: 3000 });
    const code = page.locator('#invite-code');
    const firstSlot = await code.getAttribute('data-slot');
    await page.clock.runFor(1000);
    expect(await page.evaluate(() => scrollY)).toBeCloseTo(position, 0);
    for (let rotation = 0; rotation < 2; rotation++) {
      await page.clock.runFor(30_000);
      expect(await page.evaluate(() => scrollY)).toBeCloseTo(position, 0);
      await expect(code).not.toHaveAttribute('data-slot', firstSlot!);
    }
    // The phone's active contents link is still revealed horizontally.
    if (width === 390) {
      const visible = await page.locator(`#toc [data-target="${id}"]`).evaluate(link => {
        const a = link.getBoundingClientRect(), bar = link.parentElement!.getBoundingClientRect();
        return a.left >= bar.left - 1 && a.right <= bar.right + 1;
      });
      expect(visible).toBe(true);
    }
    await page.screenshot({ path: `review.local/prijava-scroll-${width}.png` });
  });
}

// WP7 (23 September 2026, [O-75]): the hosted page's development-notes layer is off on load,
// opens and closes with its one button, is remembered, and keeps axe serious + critical at 0.
test('the development-notes layer is hidden on load, opens with its button and is remembered', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/prijava/');
  const button = page.getByTestId('prijava-notes');
  const layer = page.getByTestId('prijava-notes-layer');
  await expect(button).toHaveText('Razvojne bilješke od predaje');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(layer).toBeHidden();
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(layer).toBeVisible();
  await expect(layer.getByRole('heading', { level: 2 })).toHaveText('Bilješke o razvoju nakon predaje, nisu dio predanog prijedloga');
  const dated = layer.locator('article.note time[datetime^="2026-09-"]');
  expect(await dated.count()).toBeGreaterThanOrEqual(1);
  await expect(dated.first()).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), scheme).toEqual([]);
  }
  await page.reload();
  await expect(page.getByTestId('prijava-notes')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('prijava-notes-layer')).toBeVisible();
  await page.getByTestId('prijava-notes').click();
  await expect(page.getByTestId('prijava-notes')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('prijava-notes-layer')).toBeHidden();
  await page.reload();
  await expect(page.getByTestId('prijava-notes-layer')).toBeHidden();
});
