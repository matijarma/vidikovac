// The map of /snimka/ v2 in a browser, on the synthetic dataset of
// snimka-fixtures.ts (routeSnimka answers every /api/snimka/v2/ request):
// the living network's counts, no vehicles at one hour per second while the
// network still draws, the route subject from the address and Escape, the
// director's fly on the linija-228 chapter and its hold after a drag, and
// the comparison day's hollow rings. The local harness serves no basemap
// tiles, so everything is read off the data-sn-* probes, never off pixels.
import { expect, test, type Page } from '@playwright/test';
import { buildSnimkaFixture, routeSnimka, type SnimkaFixture } from './snimka-fixtures';

const fixture = buildSnimkaFixture();

const stage = (page: Page) => page.locator('[data-sn-mount="stage"]');
const map = (page: Page) => page.locator('[data-sn="map"]');
const play = (page: Page) => page.locator('[data-sn="play"]');

async function open(page: Page, path: string, data: SnimkaFixture = fixture): Promise<void> {
  await page.setViewportSize({ width: 1366, height: 900 });
  await routeSnimka(page, data);
  await page.goto(path);
  await expect(stage(page)).not.toHaveAttribute('aria-busy', 'true');
}

/** The probe "alive/dead/quiet" as three numbers. */
async function aliveCounts(page: Page): Promise<[number, number, number] | null> {
  const value = await map(page).getAttribute('data-sn-alive');
  if (!value) return null;
  const parts = value.split('/').map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? (parts as [number, number, number]) : null;
}

async function center(page: Page): Promise<[number, number]> {
  const value = (await map(page).getAttribute('data-center')) ?? '';
  const [lon, lat] = value.split(',').map(Number);
  return [lon, lat];
}

/** The map is up: MapLibre built its canvas and the style settled (ready, or tiles-failed on this tile-less harness). */
async function mapUp(page: Page): Promise<void> {
  await expect(map(page).locator('canvas')).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(async () => map(page).getAttribute('data-map-status'), { timeout: 30_000 }).toMatch(/^(ready|tiles-failed)$/);
}

test.describe('/snimka/ map v2', () => {
  test('the living network counts two lines alive on Monday 07:45 and at least three on Tuesday noon', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45');
    await expect(map(page)).toHaveAttribute('data-sn-alive', /^2\/\d+\/\d+$/, { timeout: 30_000 });
    expect(await aliveCounts(page)).toEqual([2, 26, 4]);
    await open(page, '/snimka/?t=2026-09-29T12:00');
    await expect(map(page)).toHaveAttribute('data-sn-alive', /^\d+\/\d+\/\d+$/, { timeout: 30_000 });
    const counts = (await aliveCounts(page))!;
    expect(counts[0]).toBeGreaterThanOrEqual(3);
    await expect(map(page)).toHaveAttribute('data-sn-at', '2026-09-29T12:00');
  });

  test('at one hour per second no vehicle is drawn while the network still counts its lines', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45&brzina=3600');
    await mapUp(page);
    await expect(map(page)).toHaveAttribute('data-sn-alive', /^2\/\d+\/\d+$/, { timeout: 30_000 });
    await expect(map(page)).toHaveAttribute('data-sn-drawn', '0', { timeout: 30_000 });
    // The same instant at ten minutes a second draws the recorded fleet, so the zero above is the speed's rule, not a missing chunk.
    await open(page, '/snimka/?t=2026-09-28T07:45&brzina=600');
    await expect(map(page)).toHaveAttribute('data-sn-drawn', '5', { timeout: 30_000 });
  });

  test('?linija=228 sets the route subject on the map host; Escape on the map clears it and the address', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-29T12:00&linija=228');
    await expect(map(page)).toHaveAttribute('data-sn-subject', 'route:228');
    await mapUp(page);
    await expect(page).toHaveURL(/linija=228/);
    await map(page).locator('canvas').focus();
    await page.keyboard.press('Escape');
    await expect(map(page)).not.toHaveAttribute('data-sn-subject', /./);
    await expect(page).not.toHaveURL(/linija=/);
  });

  test('the director flies east when the linija-228 chapter passes in play', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-29T09:55&brzina=600');
    await mapUp(page);
    await expect(map(page)).toHaveAttribute('data-sn-alive', /^\d+\/\d+\/\d+$/, { timeout: 30_000 });
    await expect(map(page)).toHaveAttribute('data-center', /./, { timeout: 15_000 });
    const [lon0] = await center(page);
    await play(page).click();
    await expect(play(page)).toHaveText('Zaustavi');
    // Route 228's main shape runs from 15.997 to 16.020 east (Kaptol to Rebro): a fit on it lands the centre east of the opening view at 15.98.
    await expect.poll(async () => (await center(page))[0], { timeout: 15_000, message: 'the camera east of where it opened' }).toBeGreaterThan(lon0 + 0.004);
    await expect(map(page)).toHaveAttribute('data-sn-alive', /^3\/\d+\/\d+$/, { timeout: 15_000 });
  });

  test('a drag on the map holds the director: the chapter passes and the camera stays where the reader left it', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-29T09:50&brzina=60');
    await mapUp(page);
    await expect(map(page)).toHaveAttribute('data-center', /./, { timeout: 15_000 });
    // The stage sits under the hero: the canvas must be in the viewport before the mouse can reach it.
    await map(page).locator('canvas').scrollIntoViewIfNeeded();
    const box = (await map(page).locator('canvas').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 160, y + 60, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    const [lon1, lat1] = await center(page);
    expect(lon1).toBeLessThan(15.98);
    await play(page).click();
    await expect(play(page)).toHaveText('Zaustavi');
    // Six replay minutes to the chapter at one minute a second, then two more: the cue passed within 20 s of the drag and was skipped.
    await page.waitForTimeout(8500);
    await expect(map(page)).toHaveAttribute('data-sn-at', /^2026-09-29T09:5[7-9]|^2026-09-29T10:0/);
    const [lon2, lat2] = await center(page);
    expect(Math.abs(lon2 - lon1)).toBeLessThan(0.0005);
    expect(Math.abs(lat2 - lat1)).toBeLessThan(0.0005);
  });

  test('the comparison day draws hollow rings aligned by time of day; usporedba=0 draws none', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-29T07:45');
    await mapUp(page);
    await expect(map(page)).toHaveAttribute('data-sn-ghosts', '5', { timeout: 30_000 });
    await open(page, '/snimka/?t=2026-09-29T07:45&usporedba=0');
    await mapUp(page);
    await page.waitForTimeout(1500);
    expect((await map(page).getAttribute('data-sn-ghosts')) ?? '0').toBe('0');
  });
});
