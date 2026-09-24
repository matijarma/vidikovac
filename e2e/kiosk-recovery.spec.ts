import { expect, test } from '@playwright/test';
import { APP_URL, provisionKiosk } from './helpers';

test('a failed teaser request marks the last copy stale, holds the map, and recovers on success', async ({ page, request }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const now = Date.now();
  await page.clock.install({ time: now });
  let failing = false;
  let requests = 0;
  const attribution = { text: 'Test fixture', url: 'https://example.test/source', licence: 'Otvorena dozvola' };
  await page.route('**/api/teaser**', async (route) => {
    requests++;
    if (failing) { await route.abort('connectionfailed'); return; }
    // A missing sourceUpdatedAt intentionally uses the ordinary 20-second
    // fallback poll, avoiding a real upstream clock in this state test.
    const modules = ['dhmz-cap', 'prometnice', 'zet-rt'].map((module) => ({
      module, status: 'live', tier: 'open', fetchedAt: new Date(now).toISOString(), attribution,
      items: module === 'zet-rt' ? [{
        id: 'vehicle:recovery-test', module, kind: 'vehicle', tier: 'open', title: '6',
        at: new Date(now).toISOString(),
        geo: { type: 'Point', coordinates: [15.977, 45.813] },
        data: { routeId: '6', routeType: 0 },
      }] : [],
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modules }) });
  });
  // The basemap's vector tiles answer 503 under wrangler dev (the R2 bucket is empty), which the map reads as
  // tiles-failed and this spec as a red; a developer machine answers "no tile" at the browser instead, as
  // e2e/wall-map.spec.ts does, so the status the spec watches is the feed's, never the bucket's.
  await page.route('**/maps/zagreb-v1/**', (route) => route.fulfill({ status: 404, body: '' }));
  const { kioskUrl } = await provisionKiosk(request, APP_URL);
  // One fixed window (R-KP1): nothing rotates, so the clock can run through two polls with the map in place.
  await page.goto(kioskUrl);
  const map = page.getByTestId('kiosk-map');
  await expect(map).toHaveAttribute('data-map-status', 'ready', { timeout: 30_000 });
  await expect(map).toHaveAttribute('data-feed', 'live');
  const before = requests;
  failing = true;
  await page.clock.runFor(21_000);
  await expect.poll(() => requests).toBeGreaterThan(before);
  await expect(map).toHaveAttribute('data-feed', 'stale');
  await expect(page.getByTestId('strip-warning')).toHaveAttribute('data-state', 'stale');
  await expect(page.getByTestId('strip-warning')).not.toContainText('Nema upozorenja');
  const frames = await map.getAttribute('data-frames');
  await page.clock.runFor(2_000);
  expect(await map.getAttribute('data-frames')).toBe(frames);
  failing = false;
  const failedRequests = requests;
  await page.clock.runFor(21_000);
  await expect.poll(() => requests).toBeGreaterThan(failedRequests);
  await expect(map).toHaveAttribute('data-feed', 'live');
  // Recovered: the calm trail names the sources (kajimafix 03.5), or, under a live DHMZ warning, the warning cell carries a live state; the stale word is gone either way.
  await expect(page.locator('[data-testid=strip-sources], [data-testid=strip-warning][data-state=active], [data-testid=strip-warning][data-state=upcoming]').first()).toBeVisible();
  await expect(page.locator('[data-testid=strip-warning][data-state=stale]')).toHaveCount(0);
});
