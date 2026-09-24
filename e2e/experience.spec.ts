import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { experienceSnapshots, FIXTURE_DASHBOARD, installExperienceFixture } from './experience-fixtures';
import type { LayerId } from '../worker/protocol';
import { FIXTURE_NOW } from '../test/feed/fixture-contexts';
import { DESKTOP_MIN_PX } from './lib';

const LAYERS: LayerId[] = ['grad-sada', 'u-pokretu', 'zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'kultura'];
/** The desk's pair (WP4 step 8): Sada's feed and Karta's map side by side, in this order. */
const DESK_PAIR: readonly LayerId[] = ['grad-sada', 'u-pokretu'];
/** Sada's promise at 390×844: the three departures at the chosen stop are on the first screen without a scroll, above the tab bar (WP4). */
const SADA_FOLD_PX = 700;
const SADA_DEPARTURES_IN_FOLD = 3;
/** Sada's rows at the chosen stop (the probe of brief §15.6); the fixture's board gives them at FIXTURE_NOW. */
const SADA_DEPARTURES = '[data-testid=day-departures] > li.sada-departure';

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
      await expect(page.getByTestId('sada-place')).toBeVisible();
      for (const layer of LAYERS) {
        await openLayer(page, layer);
        // The desk is the phone, wider (WP4 step 8): Sada or Karta opens the .ki-desk pair, Sada then Karta and
        // nothing else; every other domain, and every layer on the phone, is one workspace alone.
        if (viewport.width >= DESKTOP_MIN_PX && DESK_PAIR.includes(layer)) {
          const pair = page.locator('[data-testid="dash-view"] > .ki-desk > .layer');
          await expect.poll(() => pair.evaluateAll((els) => els.map((el) => el.getAttribute('data-layer'))), { message: `the desk pair holds Sada and Karta when ${layer} is open` })
            .toEqual([...DESK_PAIR]);
          await expect(page.locator('[data-testid="dash-view"] > .layer'), 'no workspace stands outside the pair').toHaveCount(0);
        } else {
          await expect(page.locator('[data-testid="dash-view"] > .layer'), `${layer} is the one workspace`).toHaveCount(1);
          await expect(page.locator('[data-testid="dash-view"] .ki-desk'), `no desk pair around ${layer}`).toHaveCount(0);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
        await expect(page.getByTestId('dash-view')).not.toContainText('[object Object]');
      }
      await expect(page.locator('canvas[data-testid="panorama"], [data-testid="meander-legend"]')).toHaveCount(0);
    });

    test('Sada reads the place, one sentence, the departures and U blizini in that order, with no time filters and no date line', async ({ page }) => {
      await installExperienceFixture(page, await experienceSnapshots());
      await page.goto(FIXTURE_DASHBOARD);
      await expect(page.getByTestId('sada-place')).toHaveText(/\S/);
      await expect(page.locator(SADA_DEPARTURES).first()).toBeVisible();
      // Sada's own list: the desk pair shows Karta's beside it (chunk E), so the probe is scoped to the feed.
      await expect(page.locator('#layer-grad-sada [data-testid=nearby]')).toBeVisible();
      const order = await page.locator('#layer-grad-sada').evaluate((sada) => {
        const parts = ['sada-place', 'sada-sentence', 'day-departures', 'nearby'];
        const nodes = parts.map((id) => sada.querySelector(`[data-testid="${id}"]`));
        return {
          missing: parts.filter((_, i) => !nodes[i]),
          inOrder: nodes.every((node, i) => i === 0 || !node || !nodes[i - 1] || Boolean(nodes[i - 1]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)),
          filters: sada.querySelectorAll('[data-filter-key="tb-col"]').length,
          clock: sada.querySelectorAll('.day-clock, .day-date').length,
        };
      });
      expect(order.missing, 'the place, the sentence, the departures and U blizini are all on Sada').toEqual([]);
      expect(order.inOrder, 'Sada reads place, sentence, departures, then U blizini (WP4 step 3)').toBe(true);
      expect(order.filters, 'Sada has no time filters any more').toBe(0);
      expect(order.clock, 'Sada has no date line or clock of its own [O-12]').toBe(0);
      await expect(page.getByTestId('dash-view')).not.toContainText(/Ovdje i sada|Što slijedi|Sada u gradu/);
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
      // Drawing: ready, or tiles-failed where the local server has no basemap tiles (the overlays still draw).
      await expect(map).toHaveAttribute('data-map-status', /^(ready|tiles-failed)$/, { timeout: 30_000 });
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
      // The desk pair's board sits under the map (round 2, desktop F1): its map view folds the board to a strip, so
      // the map grows in height and keeps the column's width.
      else {
        await expect.poll(async () => (await uncovered()).height).toBeGreaterThan(before.height + 8);
        expect((await uncovered()).width).toBeGreaterThanOrEqual(before.width - 1);
      }
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
  await expect(page.getByTestId('sada-place')).toBeVisible();
  await expect(page.getByTestId('day-departures'), 'the departures must have their board before the fold is measured').not.toHaveAttribute('aria-busy', 'true');
  const rows = page.locator(SADA_DEPARTURES);
  await expect.poll(async () => {
    const boxes = await rows.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON() as { top: number; bottom: number }));
    return boxes.filter((box) => box.top < SADA_FOLD_PX && box.bottom > 0).length;
  }, { message: `at least ${SADA_DEPARTURES_IN_FOLD} departures (${SADA_DEPARTURES}) must reach into the first ${SADA_FOLD_PX} px` }).toBeGreaterThanOrEqual(SADA_DEPARTURES_IN_FOLD);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
});

test('text zoom keeps the place, the departures and U blizini without horizontal overflow', async ({ page }) => {
  const width = 1440;
  await page.setViewportSize({ width, height: 1000 });
  await installExperienceFixture(page, await experienceSnapshots());
  await page.goto(FIXTURE_DASHBOARD);
  await expect(page.getByTestId('sada-place')).toBeVisible();
  for (const zoom of [100, 125, 200]) {
    await page.addStyleTag({ content: `html { font-size: ${zoom}% !important; }` });
    await expect(page.getByTestId('sada-place')).toBeVisible();
    await expect(page.locator(SADA_DEPARTURES).first()).toBeVisible();
    await expect(page.locator('#layer-grad-sada [data-testid=nearby]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
});

test('without WebGL the transport search still opens a real stop and its routes', async ({ page }) => {
  // An exception in the page is the failure itself, not a silent no-op: the Sada band's half-built MapLibre v6 map
  // (no WebGL2) once threw from its teardown inside every render after Karta opened, so Enter on a stop did nothing.
  // Console errors ride along in the messages (a local server answers some city sources 503), never as the verdict.
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => { pageErrors.push(error.stack ?? String(error)); });
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const uncaught = (step: string): string => `no uncaught error ${step}; console errors: ${consoleErrors.join(' | ') || 'none'}`;
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
  await expect(page.getByTestId('map-status')).toContainText('Pretraga, linije i stajališta rade i bez karte.');
  expect(pageErrors, uncaught('opening Karta without WebGL')).toEqual([]);
  await page.getByTestId('transport-search').fill('Jela');
  const options = page.getByTestId('transport-results').getByRole('option');
  await expect(options.first()).toBeVisible();
  // One field over routes, stops, places and streets (WP4): the street stories of the Jelačić streets rank before the
  // stops here, so the keyboard walks down to the first stop and takes it, the way a person would.
  const stopIndex = await options.evaluateAll((els) => els.findIndex((el) => el.getAttribute('data-action') === 'select-stop'));
  expect(stopIndex, 'a stop is among the results').toBeGreaterThanOrEqual(0);
  for (let i = 0; i <= stopIndex; i++) await page.getByTestId('transport-search').press('ArrowDown');
  await page.getByTestId('transport-search').press('Enter');
  expect(pageErrors, uncaught('from the search to the stop')).toEqual([]);
  await expect(page.getByTestId('stop-title')).toContainText('Jela');
  await expect(page.getByTestId('stop-routes').locator('button').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(pageErrors, uncaught('on the stop')).toEqual([]);
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
