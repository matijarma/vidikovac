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
