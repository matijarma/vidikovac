import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { experienceSnapshots, FIXTURE_DASHBOARD, installExperienceFixture } from './experience-fixtures';
import type { LayerId } from '../worker/protocol';
import { FIXTURE_NOW } from '../test/feed/fixture-contexts';
import { DESKTOP_MIN_PX } from './lib';

const LAYERS: LayerId[] = ['grad-sada', 'u-pokretu', 'zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'kultura'];
/** Sada's promise at 390×844: the city's now is on the first screen without a scroll. */
const SADA_FOLD_PX = 700;
const SADA_TILES_IN_FOLD = 2;
/** The band at FIXTURE_NOW (Friday 11 September 2026, 14:00 in Zagreb): its five columns and the h3 each head reads, time word then head text. */
const COLUMNS_AT_FIXTURE_NOW = ['sada', 'danas', 'veceras', 'sutra', 'tjedan'];
const HEADS_AT_FIXTURE_NOW = ['sada 14:00', 'poslijepodne do 18:00', 'večeras od 18:00', 'sutra sub 12. 9.', 'tjedan do čet 17. 9.'];
if (FIXTURE_NOW.toISOString() !== '2026-09-11T12:00:00.000Z') throw new Error('HEADS_AT_FIXTURE_NOW pins the band at 2026-09-11T12:00Z; the fixture clock moved');

/**
 * The phone's tab when the domain has one; otherwise the directory (Još in the
 * desk's status line, the tab bar's Još on the phone, D10), then the domain's
 * row or any other way in. A Sada tile also carries data-action=nav with a
 * selection, so the tab and the directory come first.
 */
async function openLayer(page: Page, layer: LayerId): Promise<void> {
  // The desk pair (WP4 chunk E) shows Sada and Karta side by side inside .ki-desk: either is already on the page.
  const shown = page.locator(`[data-testid="dash-view"] .layer[data-layer="${layer}"]`);
  const tab = page.locator(`.ki-tab[data-layer="${layer}"]:visible`).first();
  if (await tab.count()) {
    await tab.click();
  } else if (!(await shown.count())) {
    await page.locator('[data-testid="status-more"]:visible, [data-testid="tab-more"]:visible').first().click();
    await page.locator(`[data-testid="dir-${layer}"], [data-action="nav"][data-layer="${layer}"]:visible`).first().click();
  }
  await expect(shown).toBeVisible();
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
  test.describe(`Kaj ima? ${viewport.width}px`, () => {
    test.use({ viewport, locale: 'hr-HR' });

    test('all six workspaces are discoverable, not six simultaneous columns', async ({ page }) => {
      const snapshots = await experienceSnapshots();
      await installExperienceFixture(page, snapshots);
      await page.goto(FIXTURE_DASHBOARD);
      await expect(page.getByTestId('session-label')).toBeVisible();
      await expect(page.getByTestId('tb')).toBeVisible();
      for (const layer of LAYERS) {
        await openLayer(page, layer);
        await expect(page.locator('[data-testid="dash-view"] > .layer')).toHaveCount(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
        await expect(page.getByTestId('dash-view')).not.toContainText('[object Object]');
      }
      await expect(page.locator('canvas[data-testid="panorama"], [data-testid="meander-legend"]')).toHaveCount(0);
    });

    test('overview has named local and upcoming regions, with explicit time filters and a readable clock', async ({ page }) => {
      await installExperienceFixture(page, await experienceSnapshots());
      await page.goto(FIXTURE_DASHBOARD);
      await expect(page.getByTestId('tb')).toBeVisible();
      const overview = await page.getByTestId('tb').evaluate((tb) => {
        const regions = [...tb.querySelectorAll(':scope > section')];
        return {
          labels: regions.map(region => document.getElementById(region.getAttribute('aria-labelledby') ?? '')?.textContent),
          filters: [...tb.querySelectorAll('[data-filter-key="tb-col"]')].map(button => button.getAttribute('data-filter-value')),
          localBeforeAgenda: Boolean(regions[0]!.compareDocumentPosition(regions[1]!) & Node.DOCUMENT_POSITION_FOLLOWING),
        };
      });
      expect(overview.labels).toEqual(['Ovdje i sada', 'Što slijedi']);
      expect(overview.filters).toEqual(COLUMNS_AT_FIXTURE_NOW);
      expect(overview.localBeforeAgenda).toBe(true);
      await expect(page.locator('.day-clock')).toHaveText('14:00');
    });

    test('source outages never claim no warnings and retain usable navigation', async ({ page }) => {
      await installExperienceFixture(page, await experienceSnapshots('down'));
      await page.goto(FIXTURE_DASHBOARD);
      await expect(page.getByTestId('session-label')).toBeVisible();
      await openLayer(page, 'sigurnost');
      const surface = page.getByTestId('dash-view');
      await expect(surface).not.toContainText('Nema hitnih upozorenja');
      await expect(surface).not.toContainText('Nema upozorenja DHMZ-a za Zagreb.');
      await expect(surface.locator('a[href="tel:112"]')).toBeVisible();
      await openLayer(page, 'kultura');
      await expect(page.getByTestId('dash-view')).toContainText(/nedostup|nepozn|ne odgovar|potvrđen/);
    });

    test('expiry clears the content to the scan invitation and leaves safety and the renewal path available', async ({ page }) => {
      const fixture = await installExperienceFixture(page, await experienceSnapshots());
      await page.goto(FIXTURE_DASHBOARD);
      await expect(page.getByTestId('sada-place')).toBeVisible();
      fixture.expire();
      // The end of the ten minutes (WP4 step 11): the content is gone, the card holds the way to a new session and /hitno.
      const ended = page.getByTestId('session-ended');
      await expect(ended).toBeVisible();
      await expect(page.getByTestId('sada-place')).toHaveCount(0);
      await expect(page.locator('[data-testid=dash-view] .layer')).toHaveCount(0);
      await expect(page.locator('[data-action=copy-item], [data-action=share-item], [data-action=export]')).toHaveCount(0);
      const requestsAfterExpiry = fixture.requests.length;
      await page.clock.runFor(31_000);
      expect(fixture.requests.length).toBe(requestsAfterExpiry);
      await expect(ended.locator('a[href^="/s/"]')).toBeVisible();
      await expect(ended.locator('a[href="/hitno"]')).toBeVisible();
      await page.locator('[data-layer=sigurnost][href="/hitno"]:visible').first().click();
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
      await expect(page.getByTestId('dash-view')).not.toContainText('Nema upozorenja DHMZ-a za Zagreb.');
    });

    test('expanding the map changes its real size, keeps recovery visible, and retains the same canvas', async ({ page }) => {
      const phone = viewport.width < DESKTOP_MIN_PX;
      const fixture = await installExperienceFixture(page, await experienceSnapshots());
      await page.goto(FIXTURE_DASHBOARD);
      await openLayer(page, 'u-pokretu');
      const map = page.getByTestId('map-canvas');
      await expect(map).toHaveAttribute('data-map-status', 'ready', { timeout: 30_000 });
      const canvas = await map.locator('canvas').elementHandle();
      if (phone) {
        await page.locator('.t-sheet-toggle').click();
        await expect(page.getByTestId('transport-workspace')).toHaveAttribute('data-sheet', 'half');
      }
      // On the phone stage the canvas fills the stage and the sheet floats over its lower part, so the map a
      // person sees is the canvas above the sheet's top edge; on the desk the board column takes real width.
      const uncovered = async (): Promise<{ width: number; height: number; stage: number }> => {
        const box = (await map.boundingBox())!;
        const sheet = (await page.getByTestId('transport-sheet').boundingBox())!;
        return { width: box.width, height: Math.min(box.y + box.height, sheet.y) - box.y, stage: box.height };
      };
      const before = await uncovered();
      // The phone lowers its sheet to the peek (the full-map button went with the map menu, WP4); the desk's chevron
      // collapses the board into the page's map view.
      await page.locator('.t-sheet-toggle').click();
      if (phone) {
        await page.locator('.t-sheet-toggle').click();
        await expect(page.getByTestId('transport-workspace')).toHaveAttribute('data-sheet', 'peek');
      } else {
        await expect(page.locator('.ki')).toHaveAttribute('data-view', 'map');
      }
      if (phone) await expect.poll(async () => (await uncovered()).height).toBeGreaterThanOrEqual(before.height + 100);
      else await expect.poll(async () => (await uncovered()).width).toBeGreaterThanOrEqual(before.width + 300);
      expect(await canvas!.evaluate((el) => el === document.querySelector('[data-testid=map-canvas] canvas'))).toBe(true);
      await expect(page.getByTestId('session-label')).toBeVisible();
      if (phone) await expect(page.getByTestId('safety-shortcut')).toBeVisible();
      fixture.expire();
      // The end of the ten minutes (WP4 step 11): the map and its board leave with the content; the closing card's
      // way to a new session is in view, the page's map view is over and the session chrome stays.
      await expect(page.getByTestId('session-ended')).toBeVisible();
      await expect(page.getByTestId('session-ended').locator('a[href^="/s/"]')).toBeInViewport();
      await expect(page.getByTestId('transport-workspace')).toHaveCount(0);
      await expect(page.locator('.ki')).toHaveAttribute('data-view', 'layers');
      await expect(page.getByTestId('session-label')).toBeVisible();
    });
  });
}

test('phone overview gives the city the first viewport and passes accessibility checks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installExperienceFixture(page, await experienceSnapshots());
  await page.goto(FIXTURE_DASHBOARD);
  await expect(page.getByTestId('tb')).toBeVisible();
  await expect(page.getByTestId('tb-lane-sada'), 'the sada lane must have its data before the fold is measured').not.toHaveAttribute('aria-busy', 'true');
  const tiles = page.locator('[data-testid="tb-lane-sada"] .tl:not([data-skeleton])');
  await expect.poll(async () => {
    const boxes = await tiles.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON() as { top: number; bottom: number }));
    return boxes.filter((box) => box.top < SADA_FOLD_PX && box.bottom > 0).length;
  }, { message: `at least ${SADA_TILES_IN_FOLD} sada tiles must reach into the first ${SADA_FOLD_PX} px` }).toBeGreaterThanOrEqual(SADA_TILES_IN_FOLD);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
});

test('text zoom retains both overview regions and every time filter without horizontal overflow', async ({ page }) => {
  const width = 1440;
  await page.setViewportSize({ width, height: 1000 });
  await installExperienceFixture(page, await experienceSnapshots());
  await page.goto(FIXTURE_DASHBOARD);
  await expect(page.getByTestId('tb')).toBeVisible();
  for (const zoom of [100, 125, 200]) {
    await page.addStyleTag({ content: `html { font-size: ${zoom}% !important; }` });
    await expect(page.locator('.day-now')).toBeVisible();
    await expect(page.locator('.day-ahead')).toBeVisible();
    await expect(page.locator('.day-time')).toHaveCount(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
});

test('without WebGL the transport search still opens a real stop and its routes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
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
  await expect(page.getByTestId('transport-results').getByRole('option').first()).toBeVisible();
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
