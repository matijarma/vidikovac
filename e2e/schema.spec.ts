import { expect, test } from '@playwright/test';
import { FIXTURE_NOW } from '../test/feed/fixture-contexts';
import { experienceSnapshots, FIXTURE_DASHBOARD, installExperienceFixture } from './experience-fixtures';
import { APP_URL, provisionKiosk } from './helpers';
import { schemaSnapshot } from './schema-fixtures';

test('the transport switch draws moving trams on the SVG diagram and restores the city map', async ({ page }) => {
  const snapshots = await experienceSnapshots();
  snapshots['zet-rt'] = schemaSnapshot(FIXTURE_NOW.getTime());
  await installExperienceFixture(page, snapshots);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(FIXTURE_DASHBOARD);
  await page.locator('[data-action=nav][data-layer=u-pokretu]:visible').first().click();
  await page.getByTestId('transport-search').focus();
  await page.locator('[data-action=city-group][data-group=transport]').click();
  if(test.info().project.name==='mobile'){
    for(let i=0;i<3&&await page.getByTestId('transport-workspace').getAttribute('data-sheet')!=='peek';i++)
      await page.locator('[data-action=toggle-sheet]').click();
  }
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
  await page.goto(FIXTURE_DASHBOARD.replace('#', '#layer=u-pokretu&kind=route&id=6&'));
  await expect(page.getByTestId('schema-vehicles')).toBeVisible();
  if (test.info().project.name === 'mobile') expect(requested.some(u => /maplibre-(entry|gl-worker)/.test(u))).toBe(false);
  requested.length = 0;
  await page.goto(FIXTURE_DASHBOARD.replace('/d/', '/d/?lagano=1').replace('#', '#layer=u-pokretu&kind=route&id=6&'));
  await page.clock.runFor(3000);
  await expect(page.getByTestId('map-mode-toggle')).toBeHidden();
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
