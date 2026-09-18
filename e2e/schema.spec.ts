import { expect, test } from '@playwright/test';
import { FIXTURE_NOW } from '../test/feed/fixture-contexts';
import { experienceSnapshots, FIXTURE_DASHBOARD, installExperienceFixture } from './experience-fixtures';
import { APP_URL, provisionKiosk } from './helpers';
import { schemaSnapshot, TWO_TRAM_PATH_ROUTE, twoTramSnapshot } from './schema-fixtures';

test('the transport switch draws moving trams on the SVG diagram and restores the city map', async ({ page }) => {
  const snapshots = await experienceSnapshots();
  snapshots['zet-rt'] = schemaSnapshot(FIXTURE_NOW.getTime());
  await installExperienceFixture(page, snapshots);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(FIXTURE_DASHBOARD);
  await page.locator('[data-action=nav][data-layer=u-pokretu]:visible').first().click();
  await page.locator('.t-map-menu > summary').click();
  const toggle = page.getByTestId('map-mode-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // The disclosure can stay open while several filters are adjusted.
  // Close it before gesturing on the map underneath.
  await page.locator('.t-map-menu > summary').click();
  const canvas = page.getByTestId('schema-vehicles');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-map-status', 'ready');
  // Geometry readiness is not feed readiness. The built app can load the
  // diagram before its HTTP fixture arrives; an empty renderer correctly
  // parks after eight unchanged frames. Measure only once evidence exists.
  await expect(page.locator('.schema-map [data-testid=vehicle-list] button')).toHaveCount(1);
  await page.clock.runFor(1000);
  const before = await canvas.evaluate(c => ({ frames: Number(c.dataset.frames ?? 0), pixels: (c as HTMLCanvasElement).toDataURL() }));
  await page.clock.runFor(1500);
  const after = await canvas.evaluate(c => ({ frames: Number(c.dataset.frames ?? 0), pixels: (c as HTMLCanvasElement).toDataURL() }));
  expect(after.frames).toBeGreaterThan(before.frames);
  expect(after.pixels).not.toBe(before.pixels);
  expect(await page.evaluate(() => localStorage.getItem('kajima:map-mode:v1'))).toBe('schema');
  await expect(page.locator('.transport-map .maplibregl-canvas')).toHaveCount(0);
  const diagram = page.getByTestId('schema-map');
  await expect(diagram).toHaveAttribute('data-labels', 'false');
  const rect = (await canvas.boundingBox())!;
  if (test.info().project.name === 'mobile') {
    // Two fingers through Chromium's actual touch pipeline, not synthetic
    // canvas handlers. Stay below the tools and above the phone sheet.
    const cdp = await page.context().newCDPSession(page);
    const cx = rect.x + rect.width / 2, y = rect.y + 240;
    const pair = (radius: number) => [{ id: 0, x: cx - radius, y }, { id: 1, x: cx + radius, y }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pair(18) });
    for (const radius of [35, 60, 90, 120, 145]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pair(radius) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.wheel(0, -1000);
  }
  await expect(diagram).toHaveAttribute('data-labels', 'true');
  await canvas.focus();
  await page.keyboard.press('0');
  await expect(diagram).toHaveAttribute('data-labels', 'false');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('transport-detail')).toContainText('6');
  await expect(page.locator('.schema-map [role=dialog]')).toHaveCount(0);
  await page.locator('.t-map-menu > summary').click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(canvas).toHaveCount(0);
  await expect(page.locator('.transport-map .maplibregl-canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('schema preference loads directly without the transport map, and lightweight mode does not fetch it', async ({ page }) => {
  const snapshots = await experienceSnapshots();
  snapshots['zet-rt'] = schemaSnapshot(FIXTURE_NOW.getTime());
  await installExperienceFixture(page, snapshots);
  await page.addInitScript(() => localStorage.setItem('kajima:map-mode:v1', 'schema'));
  const requested: string[] = [];
  page.on('request', req => requested.push(req.url()));
  await page.goto(FIXTURE_DASHBOARD.replace('#', '#layer=u-pokretu&'));
  await expect(page.getByTestId('schema-vehicles')).toBeVisible();
  if (test.info().project.name === 'mobile') expect(requested.some(u => /maplibre-(entry|gl-worker)/.test(u))).toBe(false);
  requested.length = 0;
  await page.goto(FIXTURE_DASHBOARD.replace('/d/', '/d/?lagano=1').replace('#', '#layer=u-pokretu&'));
  await page.clock.runFor(3000);
  await expect(page.getByTestId('map-mode-toggle')).toHaveCount(0);
  await expect(page.getByTestId('schema-vehicles')).toHaveCount(0);
  expect(requested.some(u => /zet-schema\.json|schema-map-/.test(u))).toBe(false);
});

test('a kiosk keeps the schema setting through provisioning URL cleanup', async ({ page, request }) => {
  const requested: string[] = [];
  page.on('request', req => requested.push(req.url()));
  await page.route('**/api/teaser', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ modules: [schemaSnapshot(Date.now())] }),
  }));
  const { kioskUrl } = await provisionKiosk(request, APP_URL, { stopId: '106_1' });
  const url = new URL(kioskUrl);
  url.searchParams.set('prikaz', 'shema');
  await page.goto(url.href);
  await expect(page.getByTestId('schema-vehicles')).toBeVisible();
  await expect(page.getByTestId('kiosk-map')).toHaveAttribute('data-map-status', 'ready');
  await expect(page.getByTestId('schema-map')).toHaveAttribute('data-labels', 'true');
  expect(new URL(page.url()).searchParams.get('prikaz')).toBe('shema');
  expect(new URL(page.url()).hash).toBe('');
  expect(requested.some(u => /maplibre-(entry|gl-worker)/.test(u))).toBe(false);
});

// Round F on the diagram (F3 pills, F4 names and terminals), read through the
// three attributes the schema renderer writes beside its long-standing
// `data-labels`/`data-scale`/`data-frames`: `data-pills` (the label of every
// pill the vehicle canvas just painted), `data-names` (the names the
// collision pass placed on the last static repaint) and `data-chips` (the
// terminal chips under them). See the comments at their write sites in
// app/src/motion/schema-map.ts.
test('the diagram paints numbered pills, names that give way and come back, and a terminal that ends in chips', async ({ page }) => {
  const snapshots = await experienceSnapshots();
  // Both trams on the diagram: the placer puts a tram on the schema line its
  // own route names (shared/motion/schema.ts), so the pair reports the path's
  // own line rather than the city map's two different numbers.
  snapshots['zet-rt'] = twoTramSnapshot(FIXTURE_NOW.getTime(), [TWO_TRAM_PATH_ROUTE, TWO_TRAM_PATH_ROUTE]);
  await installExperienceFixture(page, snapshots);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('kajima:map-mode:v1', 'schema'));
  await page.goto(FIXTURE_DASHBOARD.replace('#', '#layer=u-pokretu&'));
  const canvas = page.getByTestId('schema-vehicles');
  const diagram = page.getByTestId('schema-map');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.schema-map [data-testid=vehicle-list] button')).toHaveCount(2);
  await page.clock.runFor(1000);

  // At the whole-network fit the diagram is below the scale a name can be
  // read at, so nothing is lettered: F4's pass draws none rather than all.
  await expect(diagram).toHaveAttribute('data-labels', 'false');
  await expect(diagram).toHaveAttribute('data-names', '0');
  await expect(diagram).toHaveAttribute('data-chips', '0');

  // Past the threshold, and on the pair: picking the line and then one of its
  // trams in the sheet centres the diagram on that tram at no less than the
  // scale a name is readable at (schema-map.ts fit('selection')), so the
  // zooms below keep both marks under the middle of the canvas.
  await page.getByTestId('transport-search').fill(TWO_TRAM_PATH_ROUTE);
  await page.locator(`[data-action=select-route][data-id="${TWO_TRAM_PATH_ROUTE}"]`).first().click();
  await page.locator('[data-testid=route-vehicles] button').first().click();
  await page.clock.runFor(200);
  await expect(diagram).toHaveAttribute('data-labels', 'true');
  const near = await count(page, 'names');
  expect(near, 'names begin at LABEL_MIN_PX_PER_UNIT').toBeGreaterThan(0);
  expect(await count(page, 'chips'), 'a terminal in frame ends in numbered chips').toBeGreaterThan(0);

  // The pills themselves: every mark on the vehicle canvas carries its line's
  // number, whether it is one tram's pill or the pair merged into one.
  const pills = ((await diagram.getAttribute('data-pills')) ?? '').split('|').filter(Boolean);
  expect(pills.length, 'the pair is on the canvas').toBeGreaterThan(0);
  for (const label of pills) expect(label).toContain(TWO_TRAM_PATH_ROUTE);

  // Deeper in, the pass lets more names through: one skipped for want of room
  // comes back on zoom-in, which is the whole point of F4's collision pass
  // replacing the old all-or-nothing threshold.
  await canvas.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('+');
  await page.clock.runFor(200);
  expect(await count(page, 'names')).toBeGreaterThan(near);
  expect(((await diagram.getAttribute('data-pills')) ?? '').split('|').filter(Boolean).length,
    'the pair is still on the canvas at the deeper zoom').toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

/** One of the schema's counted attributes as a number. */
async function count(page: import('@playwright/test').Page, name: 'names' | 'chips'): Promise<number> {
  return Number((await page.getByTestId('schema-map').getAttribute(`data-${name}`)) ?? '-1');
}
