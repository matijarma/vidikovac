import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { experienceSnapshots, FIXTURE_DASHBOARD, installExperienceFixture } from './experience-fixtures';
import type { LayerId } from '../worker/protocol';
import { FIXTURE_NOW } from '../test/feed/fixture-contexts';
import { DESKTOP_MIN_PX } from './lib';

const LAYERS: LayerId[] = ['grad-sada', 'u-pokretu', 'zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'kultura', 'vijesti'];
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
  const tab = page.locator(`.ki-tab[data-layer="${layer}"]:visible`).first();
  if (await tab.count()) {
    await tab.click();
  } else {
    await page.locator('[data-testid="status-more"]:visible, [data-testid="tab-more"]:visible').first().click();
    await page.locator(`[data-testid="dir-${layer}"], [data-action="nav"][data-layer="${layer}"]:visible`).first().click();
  }
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
      await expect(page.getByTestId('tb')).toBeVisible();
      for (const layer of LAYERS) {
        await openLayer(page, layer);
        await expect(page.locator('[data-testid="dash-view"] > .layer')).toHaveCount(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
        await expect(page.getByTestId('dash-view')).not.toContainText('[object Object]');
      }
      await expect(page.locator('canvas[data-testid="panorama"], [data-testid="meander-legend"]')).toHaveCount(0);
    });

    test('heading order: the five time words read as h3 headings at FIXTURE_NOW, the lanes follow in time order, and every lane is labelled by its head', async ({ page }) => {
      await installExperienceFixture(page, await experienceSnapshots());
      await page.goto(FIXTURE_DASHBOARD);
      await expect(page.getByTestId('tb')).toBeVisible();
      const band = await page.getByTestId('tb').evaluate((tb) => {
        const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
        const heads = [...tb.querySelectorAll('.tb-heads .tb-head')];
        const lanes = [...tb.querySelectorAll('.tb-lanes > .tb-lane')];
        return {
          heads: heads.map((head) => text(head.querySelector('h3'))),
          headCols: heads.map((head) => head.getAttribute('data-col')),
          lanes: lanes.map((lane) => lane.getAttribute('data-col')),
          headings: tb.querySelectorAll('h3').length,
          headsBeforeLanes: heads.every((head) => lanes.every((lane) => Boolean(head.compareDocumentPosition(lane) & Node.DOCUMENT_POSITION_FOLLOWING))),
          labelledByOwnHead: lanes.every((lane) => lane.getAttribute('role') === 'group'
            && document.getElementById(lane.getAttribute('aria-labelledby') ?? '')?.closest('.tb-head')?.getAttribute('data-col') === lane.getAttribute('data-col')),
        };
      });
      expect(band.heads, 'a reader hears the five time words as headings').toEqual(HEADS_AT_FIXTURE_NOW);
      expect(band.headCols).toEqual(COLUMNS_AT_FIXTURE_NOW);
      expect(band.lanes, 'lanes in time order').toEqual(COLUMNS_AT_FIXTURE_NOW);
      expect(band.headings, 'the band has no heading but the five time words').toBe(COLUMNS_AT_FIXTURE_NOW.length);
      expect(band.headsBeforeLanes, 'heads precede lanes in DOM order').toBe(true);
      expect(band.labelledByOwnHead, 'each lane is a group labelled by its own head').toBe(true);
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

    test('expiry freezes data but leaves safety and the renewal path available', async ({ page }) => {
      const fixture = await installExperienceFixture(page, await experienceSnapshots());
      await page.goto(FIXTURE_DASHBOARD);
      await expect(page.getByTestId('tb')).toBeVisible();
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

test('text zoom collapses the band at 1440: five lanes at 100 %, three at 125 %, one lane and the segments at 200 %', async ({ page }) => {
  const width = 1440;
  await page.setViewportSize({ width, height: 1000 });
  await installExperienceFixture(page, await experienceSnapshots());
  await page.goto(FIXTURE_DASHBOARD);
  await expect(page.getByTestId('tb')).toBeVisible();
  /** The lanes whose box lies in the lane row's box (a lane at display: none has no box; a lane scrolled out of the row is not in view), and whether the segments (the band's sibling in the workspace) show. */
  const band = () => page.locator('#layer-grad-sada').evaluate((ws) => {
    const row = ws.querySelector('[data-testid="tb-lanes"]')!.getBoundingClientRect();
    const seg = ws.querySelector('[data-testid="tb-seg"]')?.getBoundingClientRect();
    const lanes = [...ws.querySelectorAll('.tb-lane')].filter((lane) => {
      const r = lane.getBoundingClientRect();
      return r.width > 0 && Math.min(r.right, row.right) - Math.max(r.left, row.left) >= 8;
    }).map((lane) => lane.getAttribute('data-col'));
    return { lanes, segments: Boolean(seg && seg.width > 0 && seg.height > 0) };
  });
  expect(await band(), 'at 100 % the desk reads all five lanes and no segments').toEqual({ lanes: COLUMNS_AT_FIXTURE_NOW, segments: false });
  await page.addStyleTag({ content: 'html { font-size: 125% !important; }' });
  await expect.poll(band, { message: 'at 125 % sutra and tjedan wait in Događanja: three lanes' }).toEqual({ lanes: ['sada', 'danas', 'veceras'], segments: false });
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect.poll(band, { message: 'at 200 % the band takes its phone form: one lane in view and the segments shown' }).toEqual({ lanes: ['sada'], segments: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'the lane row scrolls inside itself').toBeLessThanOrEqual(width + 1);
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
  // The results' options, not the kvart select's: a closed <select> keeps its options hidden.
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
