import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { experienceSnapshots, FIXTURE_DASHBOARD, installExperienceFixture } from './experience-fixtures';
import type { LayerId } from '../worker/protocol';
import { FIXTURE_NOW } from '../test/feed/fixture-contexts';
import { DESKTOP_MIN_PX } from './lib';

const LAYERS: LayerId[] = ['grad-sada', 'u-pokretu', 'zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'kultura', 'vijesti'];

async function openLayer(page: Page, layer: LayerId): Promise<void> {
  let navigation = page.locator(`[data-action="nav"][data-layer="${layer}"]:visible`).first();
  if (!(await navigation.count())) {
    await page.getByTestId('tab-more').click();
    navigation = page.locator(`[data-action="nav"][data-layer="${layer}"]:visible`).first();
  }
  await navigation.click();
  await expect(page.locator(`[data-testid="dash-view"] > [data-layer="${layer}"]`)).toBeVisible();
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
  test.describe(`Kaj ima? ${viewport.width}px`, () => {
    test.use({ viewport, locale: 'hr-HR' });

    test('all seven workspaces are discoverable, not seven simultaneous columns', async ({ page }) => {
      const snapshots = await experienceSnapshots();
      await installExperienceFixture(page, snapshots);
      await page.goto(FIXTURE_DASHBOARD);
      await expect(page.getByTestId('session-label')).toBeVisible();
      await expect(page.locator('#ov-weather')).toBeVisible();
      for (const layer of LAYERS) {
        await openLayer(page, layer);
        await expect(page.locator('[data-testid="dash-view"] > .layer')).toHaveCount(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
        await expect(page.getByTestId('dash-view')).not.toContainText('[object Object]');
      }
      await expect(page.locator('canvas[data-testid="panorama"], [data-testid="meander-legend"]')).toHaveCount(0);
    });

    test('source outages never claim no warnings and retain usable navigation', async ({ page }) => {
      await installExperienceFixture(page, await experienceSnapshots('down'));
      await page.goto(FIXTURE_DASHBOARD);
      await expect(page.getByTestId('session-label')).toBeVisible();
      await openLayer(page, 'sigurnost');
      const surface = page.getByTestId('dash-view');
      await expect(surface).not.toContainText('Nema hitnih upozorenja');
      await expect(surface).not.toContainText('Nema upozorenja za Zagrebačku regiju.');
      await expect(surface.locator('a[href="tel:112"]')).toBeVisible();
      await openLayer(page, 'kultura');
      await expect(page.getByTestId('dash-view')).toContainText(/nedostup|nepozn|ne odgovar|potvrđen/);
    });

    test('expiry freezes data but leaves safety and the renewal path available', async ({ page }) => {
      const fixture = await installExperienceFixture(page, await experienceSnapshots());
      await page.goto(FIXTURE_DASHBOARD);
      await expect(page.locator('#ov-weather')).toBeVisible();
      fixture.expire();
      await expect(page.getByTestId('frozen-line')).toBeVisible();
      const requestsAfterExpiry = fixture.requests.length;
      await page.clock.runFor(31_000);
      expect(fixture.requests.length).toBe(requestsAfterExpiry);
      await expect(page.getByTestId('frozen-line').locator('a')).toBeVisible();
      const safety = page.locator('[data-layer=sigurnost][href="/hitno"]:visible').first();
      await expect(safety).toBeVisible();
      await safety.click();
      await expect(page).toHaveURL(/\/hitno\/?$/);
      await expect(page.locator('a[href="tel:112"]')).toBeVisible();
    });

    test('a stale expired warning never becomes a freshly confirmed all-clear', async ({ page }) => {
      const snapshots = await experienceSnapshots('empty');
      snapshots['dhmz-cap'].status = 'stale';
      snapshots['dhmz-cap'].items = [{
        id: 'expired-warning', module: 'dhmz-cap', kind: 'warning', tier: 'open',
        title: 'Ranije upozorenje', severity: 'moderate',
        at: new Date(FIXTURE_NOW.getTime() - 3_600_000).toISOString(),
        until: new Date(FIXTURE_NOW.getTime() - 60_000).toISOString(),
      }];
      await installExperienceFixture(page, snapshots);
      await page.goto(FIXTURE_DASHBOARD);
      await expect(page.getByTestId('session-label')).toBeVisible();
      await openLayer(page, 'sigurnost');
      await expect(page.locator('[data-testid="dash-view"] [data-status="stale"]').first()).toBeVisible();
      await expect(page.getByTestId('dash-view')).not.toContainText('Nema hitnih upozorenja');
      await expect(page.getByTestId('dash-view')).not.toContainText('Nema upozorenja za Zagrebačku regiju.');
    });

    test('expanding the map changes its real size, keeps recovery visible, and retains the same canvas', async ({ page }) => {
      const phone = viewport.width < DESKTOP_MIN_PX;
      const fixture = await installExperienceFixture(page, await experienceSnapshots());
      await page.goto(FIXTURE_DASHBOARD);
      await openLayer(page, 'u-pokretu');
      const map = page.getByTestId('map-canvas');
      await expect(map).toHaveAttribute('data-map-status', 'ready', { timeout: 30_000 });
      const canvas = await map.locator('canvas').elementHandle();
      // On the phone stage the canvas fills the stage and the sheet floats over its lower part, so the map a
      // person sees is the canvas above the sheet's top edge; on the desk the board column takes real width.
      const uncovered = async (): Promise<{ width: number; height: number; stage: number }> => {
        const box = (await map.boundingBox())!;
        const sheet = (await page.getByTestId('transport-sheet').boundingBox())!;
        return { width: box.width, height: Math.min(box.y + box.height, sheet.y) - box.y, stage: box.height };
      };
      const before = await uncovered();
      await page.getByTestId('map-full-toggle').click();
      await expect(page.locator('.ki')).toHaveAttribute('data-view', 'map');
      if (phone) await expect.poll(async () => (await uncovered()).height).toBeGreaterThanOrEqual(before.height + 200);
      else await expect.poll(async () => (await uncovered()).width).toBeGreaterThanOrEqual(before.width + 300);
      expect(await canvas!.evaluate((el) => el === document.querySelector('[data-testid=map-canvas] canvas'))).toBe(true);
      await expect(page.getByTestId('session-label')).toBeVisible();
      if (phone) await expect(page.getByTestId('safety-shortcut')).toBeVisible();
      fixture.expire();
      await expect(page.getByTestId('frozen-line')).toBeVisible();
      await expect(page.getByTestId('frozen-line').locator('a')).toBeInViewport();
      await page.keyboard.press('Escape');
      await expect(page.locator('.ki')).toHaveAttribute('data-view', 'layers');
      // The frozen banner now sits in flow above the stage, so the stage is shorter than before; the sheet is
      // back at half of it (half a stage is what "half" means), and the board column is back at its width.
      await expect.poll(async () => {
        const after = await uncovered();
        if (!phone) return Math.abs(after.width - before.width);
        return Math.abs(after.height - (before.height - (before.stage - after.stage) / 2));
      }).toBeLessThanOrEqual(4);
    });
  });
}

test('phone overview gives the city the first viewport and passes accessibility checks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installExperienceFixture(page, await experienceSnapshots());
  await page.goto(FIXTURE_DASHBOARD);
  await expect(page.locator('#ov-weather')).toBeVisible();
  const boxes = await page.locator('[data-testid="dash-view"] .ov-block').evaluateAll((nodes) =>
    nodes.map((node) => ({ id: node.id, top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom })));
  expect(boxes.filter((box) => box.top < 700 && box.bottom > 0).length).toBeGreaterThanOrEqual(2);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
});

test('without WebGL the transport search still opens a real stop and its routes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (['webgl', 'webgl2', 'experimental-webgl'].includes(type)) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await installExperienceFixture(page, await experienceSnapshots());
  // Explicit full mode exercises the in-workspace fallback. Automatic mode
  // would correctly choose the separate lightweight route list instead.
  await page.goto(FIXTURE_DASHBOARD.replace('/d/', '/d/?lagano=0'));
  await openLayer(page, 'u-pokretu');
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-map-status', 'unavailable', { timeout: 30_000 });
  await expect(page.getByTestId('map-status')).toContainText('Pretraga, linije i stanice rade i bez nje.');
  await page.getByTestId('transport-search').fill('Jela');
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.getByTestId('transport-search').press('ArrowDown');
  await page.getByTestId('transport-search').press('Enter');
  await expect(page.getByTestId('stop-title')).toContainText('Jela');
  await expect(page.getByTestId('stop-routes').locator('button').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('printing selected civic metadata retains provenance even when its disclosure was closed', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await installExperienceFixture(page, await experienceSnapshots());
  await page.goto(FIXTURE_DASHBOARD);
  await openLayer(page, 'uprava-i-pravo');
  await page.getByTestId('act-row').first().locator('button').click();
  await expect(page.getByTestId('civic-detail')).toBeVisible();
  const provenance = page.locator('details.provenance');
  expect(await provenance.getAttribute('open')).toBeNull();
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
  await expect(provenance.locator('li').first()).toBeVisible();
  await expect(page.locator('.ws-primary')).toBeHidden();
  await expect(page.getByTestId('civic-detail')).toBeVisible();
  expect(await page.getByTestId('civic-detail').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(0, 0, 0)');
  expect(await page.getByTestId('civic-detail').locator('.kicker').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(0, 0, 0)');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  expect(await provenance.getAttribute('open')).toBeNull();
});

test('dark-mode safety printing keeps emergency numbers legible without filled backgrounds', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await installExperienceFixture(page, await experienceSnapshots());
  await page.goto(FIXTURE_DASHBOARD);
  await openLayer(page, 'sigurnost');
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
  const number = page.locator('.sf-number-primary');
  await expect(number).toContainText('112');
  const colours = await number.evaluate((el) => {
    const style = getComputedStyle(el);
    return { colour: style.color, background: style.backgroundColor, border: style.borderTopStyle };
  });
  expect(colours).toEqual({ colour: 'rgb(0, 0, 0)', background: 'rgba(0, 0, 0, 0)', border: 'solid' });
  const level = await page.locator('.sf-level').evaluate((el) => ({
    colour: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor,
  }));
  expect(level).toEqual({ colour: 'rgb(0, 0, 0)', background: 'rgba(0, 0, 0, 0)' });
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`safety is readable without JavaScript (${colorScheme})`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false, viewport: { width: 390, height: 844 }, colorScheme,
    });
    try {
      const page = await context.newPage();
      const response = await page.goto(`${baseURL}/hitno`);
      expect(response?.status()).toBe(200);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('a[href="tel:112"]')).toBeVisible();
      expect(await page.locator('body').evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(390);
    } finally { await context.close(); }
  });
}
