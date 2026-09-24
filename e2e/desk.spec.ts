// The desk at the zoom levels people use (screen iteration round 2, desktop).
//
// A browser zoom of Z on a window of W×H device px lays the page out at W/Z × H/Z CSS px with a device scale
// factor of Z, which is exactly what each describe below sets: 1440×900 and 1920×1080 at 100, 125, 150 and 200 %.
// Round 1 found the desk pair's map 6 px wide at 1920×1080 and 200 % (960 CSS px) and 198 px at 1440×900 and 125 %
// (F1), the same departures and "U blizini" twice beside each other (F3), a Zaslon panel Escape could not close
// (F6), and the focus dropped to <body> after a stop chosen from the search with the keyboard (F7).
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { experienceSnapshots, FIXTURE_DASHBOARD, installExperienceFixture } from './experience-fixtures';
import { DESKTOP_MIN_PX } from './lib';

const WINDOWS = [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }] as const;
const ZOOMS = [1, 1.25, 1.5, 2] as const;
/** The least map a desk person gets beside the feed, in CSS px: wide enough for the place's circle and its names. */
const MAP_MIN_WIDTH_PX = 480;
/** Sada's column never narrows below the phone's reading width (dashboard.css, 22rem). */
const SADA_MIN_WIDTH_PX = 352;
/** The idle board is one bar under the map: the map keeps most of the Karta column's height. */
const MAP_MIN_SHARE_OF_COLUMN = 0.7;

async function open(page: Page): Promise<void> {
  await installExperienceFixture(page, await experienceSnapshots());
  await page.goto(FIXTURE_DASHBOARD);
  await expect(page.getByTestId('session-label')).toBeVisible();
  await expect(page.getByTestId('sada-place')).toBeVisible();
}

const box = async (page: Page, selector: string) => page.locator(selector).first().boundingBox();

for (const window of WINDOWS) for (const zoom of ZOOMS) {
  const viewport = { width: Math.round(window.width / zoom), height: Math.round(window.height / zoom) };
  test.describe(`desk ${window.width}×${window.height} at ${Math.round(zoom * 100)} % (${viewport.width}×${viewport.height} CSS px)`, () => {
    test.use({ viewport, deviceScaleFactor: zoom, locale: 'hr-HR' });

    test('the map stays a map beside Sada, and nothing is listed twice', async ({ page }) => {
      await open(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), 'no horizontal scroll').toBeLessThanOrEqual(viewport.width + 1);
      if (viewport.width < DESKTOP_MIN_PX) {
        // Below the shell's breakpoint the phone layout takes over: one layer, the tab bar.
        await expect(page.locator('.ki-desk')).toHaveCount(0);
        await expect(page.locator('.ki-tabbar')).toBeVisible();
        return;
      }
      await expect(page.locator('.ki')).toHaveAttribute('data-stage', 'desk');
      await expect(page.getByTestId('transport-workspace')).toHaveAttribute('data-idle', 'true');
      const sada = (await box(page, '#layer-grad-sada'))!;
      const karta = (await box(page, '[data-testid=transport-workspace]'))!;
      const map = (await box(page, '[data-testid=transport-map]'))!;
      expect(sada.width, 'Sada keeps its reading width').toBeGreaterThanOrEqual(SADA_MIN_WIDTH_PX - 1);
      expect(map.width, `the map is ${Math.round(map.width)} px wide`).toBeGreaterThanOrEqual(MAP_MIN_WIDTH_PX);
      expect(map.width, 'the board never takes the map\'s width').toBeGreaterThanOrEqual(karta.width - 4);
      expect(map.height / karta.height, 'the idle board is a bar under the map').toBeGreaterThanOrEqual(MAP_MIN_SHARE_OF_COLUMN);
      expect(map.x, 'the map stands beside Sada').toBeGreaterThanOrEqual(sada.x + sada.width);
      // The idle bar never squeezes the place's name onto several lines.
      const strong = page.locator('[data-testid=transport-peek] strong');
      await expect(strong).toHaveText(/\S/);
      // Measured in one turn: the peek is re-set on every render, so a handle may meet a replaced node.
      const lines = await page.evaluate(() => {
        const el = document.querySelector('[data-testid=transport-peek] strong')!;
        return el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).fontSize);
      });
      expect(lines, 'the place\'s name on one line in the idle bar').toBeLessThan(2.2);
      // One "U blizini" on the page: Sada's (F3).
      await expect(page.locator('[data-testid=nearby]')).toHaveCount(1);
      await expect(page.locator('[data-testid=transport-workspace] [data-kind=departure]')).toHaveCount(0);
    });
  });
}

test.describe('desk 1440×900 keyboard', () => {
  test.use({ viewport: { width: 1440, height: 900 }, locale: 'hr-HR' });

  test('Escape closes the Zaslon panel and gives the focus back to its control; Jos closes it too (F6)', async ({ page }) => {
    await open(page);
    const control = page.getByTestId('screen-control');
    await control.click();
    const panel = page.getByTestId('presentation-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Ovaj pogled');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(control).toBeFocused();
    await expect(control).toHaveAttribute('aria-expanded', 'false');
    await control.click();
    await expect(panel).toBeVisible();
    await page.getByTestId('status-more').click();
    await expect(panel).toHaveCount(0);
  });

  test('a stop chosen from the search with the keyboard keeps the focus on its board, and the list scrolls by keyboard (F7)', async ({ page }) => {
    await open(page);
    const search = page.getByTestId('transport-search');
    await search.click();
    await search.fill('Trg bana');
    await expect(page.locator('[data-testid=transport-results] [role=option][data-action=select-stop]').first()).toBeVisible({ timeout: 20_000 });
    const results = await new AxeBuilder({ page }).include('[data-testid=transport-workspace]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice']).analyze();
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    await page.keyboard.press('ArrowDown');
    const chosen = await search.getAttribute('aria-activedescendant');
    expect(chosen).toContain('-opt-stop-');
    await page.keyboard.press('Enter');
    const title = page.getByTestId('stop-title');
    await expect(title).toBeVisible();
    await expect(title).toBeFocused();
    // A poll later (the fixture's feed refreshes every few seconds) the board still holds the focus.
    await page.waitForTimeout(6_000);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    await expect(page.getByTestId('transport-detail')).toHaveAttribute('tabindex', '0');
  });
});
