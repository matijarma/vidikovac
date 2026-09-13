import { expect, test } from '@playwright/test';
import { experienceSnapshots, FIXTURE_DASHBOARD, installExperienceFixture } from './experience-fixtures';

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
  test(`initial vector map at ${viewport.width}px stays same-origin and below the 1.5 MB tile budget`, async ({ page, baseURL }) => {
    await page.setViewportSize(viewport);
    const completed: Promise<{ url: string; bytes: number; status: number }>[] = [];
    const foreign = new Set<string>();
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(baseURL!).origin) foreign.add(url.origin);
    });
    page.on('requestfinished', (request) => {
      if (!/\/maps\/zagreb-v1\/\d+\/\d+\/\d+\.mvt$/.test(request.url())) return;
      completed.push((async () => {
        const response = await request.response();
        const size = await request.sizes();
        return { url: request.url(), bytes: size.responseBodySize, status: response?.status() ?? 0 };
      })());
    });
    await installExperienceFixture(page, await experienceSnapshots());
    await page.goto(`${FIXTURE_DASHBOARD}&layer=u-pokretu`);
    await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-map-status', 'ready', { timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    const tiles = await Promise.all(completed);
    const total = tiles.reduce((sum, tile) => sum + tile.bytes, 0);
    expect(tiles.length, 'real map tiles must load, not an empty successful page').toBeGreaterThan(0);
    expect(tiles.every((tile) => tile.status === 200 || tile.status === 204)).toBe(true);
    expect(total, 'initial received tile bodies').toBeLessThan(1_500_000);
    expect(total).toBeGreaterThan(0);
    expect([...foreign], 'map, fonts, scripts and fixture API calls remain same-origin').toEqual([]);
    console.log(`[map budget] ${viewport.width}px: ${tiles.length} tile responses, ${total} transferred bytes`);
  });
}
