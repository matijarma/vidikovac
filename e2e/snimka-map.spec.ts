// The map of /snimka/ v3 in a browser, on the synthetic dataset of
// snimka-fixtures.ts (routeSnimka answers every /api/snimka/v2/ request):
// the ghost swarm and why it is absent (a comparison chunk the index lacks,
// a Sunday, one hour per second, the chip), the BAJS layer's probe with the
// Monday rim and none on Thursday, the glyph mode, the passive network frame,
// the follow toggle in the control stack, the route subject from the address
// and Escape, the director's fly on the linija-228 chapter and its hold after
// a drag. The local harness serves no basemap tiles, so everything is read
// off the data-sn-* probes, never off pixels. The fixture carries motion for
// Mon 28 Sep 07:40 to 07:50 (five vehicles) and Thu 24 Sep 07:40 to 07:50
// (five ghosts) only, so the dots mode (over twelve vehicles) is proven in
// test/app/snimka-positions.test.ts and on the real dataset, not here.
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

test.describe('/snimka/ map v3', () => {
  test('Monday 07:45 draws the recorded fleet as pills, says the comparison day has no record here, and never a living-network probe', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45');
    await mapUp(page);
    await expect(map(page)).toHaveAttribute('data-sn-drawn', '5', { timeout: 30_000 });
    await expect(map(page)).toHaveAttribute('data-sn-glyphs', 'pills');
    // Monday compares with Monday 21 September, which the fixture's index lacks: a gap, said, never 0 ghosts as "nothing".
    await expect(map(page)).toHaveAttribute('data-sn-compare', 'gap', { timeout: 30_000 });
    await expect(map(page)).toHaveAttribute('data-sn-ghosts', '0');
    await expect(map(page)).not.toHaveAttribute('data-sn-alive', /./);
    await expect(map(page)).toHaveAttribute('data-sn-at', '2026-09-28T07:45');
  });

  test('Tuesday 07:45 draws five ghosts of Thursday 24 September aligned by time of day; usporedba=0 draws none', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-29T07:45');
    await mapUp(page);
    await expect(map(page)).toHaveAttribute('data-sn-ghosts', '5', { timeout: 30_000 });
    await expect(map(page)).toHaveAttribute('data-sn-compare', 'ok');
    await open(page, '/snimka/?t=2026-09-29T07:45&usporedba=0');
    await mapUp(page);
    await expect(map(page)).toHaveAttribute('data-sn-compare', 'off', { timeout: 15_000 });
    expect((await map(page).getAttribute('data-sn-ghosts')) ?? '0').toBe('0');
  });

  test('the BAJS probe: rims on Monday 09:00 against Thursday, none on Thursday 09:00, nothing before the recorders on Sunday (and no comparison on a Sunday)', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T09:00');
    await mapUp(page);
    await expect(map(page)).toHaveAttribute('data-sn-bajs', /^\d+\/[1-9]\d*$/, { timeout: 30_000 });
    const monday = (await map(page).getAttribute('data-sn-bajs'))!.split('/').map(Number);
    expect(monday[0]).toBeGreaterThanOrEqual(59);
    await open(page, '/snimka/?t=2026-10-01T09:00');
    await mapUp(page);
    await expect(map(page)).toHaveAttribute('data-sn-bajs', /^\d+\/0$/, { timeout: 30_000 });
    expect(Number((await map(page).getAttribute('data-sn-bajs'))!.split('/')[0])).toBeGreaterThanOrEqual(59);
    await open(page, '/snimka/?t=2026-09-27T22:00');
    await mapUp(page);
    await expect(map(page)).toHaveAttribute('data-sn-bajs', '0/0', { timeout: 30_000 });
    await expect(map(page)).toHaveAttribute('data-sn-compare', 'sunday');
  });

  test('at one hour per second no vehicle and no ghost is drawn while the stations still are', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45&brzina=3600');
    await mapUp(page);
    await expect(map(page)).toHaveAttribute('data-sn-drawn', '0', { timeout: 30_000 });
    await expect(map(page)).toHaveAttribute('data-sn-compare', 'speed');
    await expect(map(page)).toHaveAttribute('data-sn-bajs', /^[1-9]\d*\/\d+$/, { timeout: 30_000 });
    // The same instant at ten minutes a second draws the recorded fleet, so the zero above is the speed's rule, not a missing chunk.
    await open(page, '/snimka/?t=2026-09-28T07:45&brzina=600');
    await expect(map(page)).toHaveAttribute('data-sn-drawn', '5', { timeout: 30_000 });
    // Tuesday noon has no chunk: nothing drawn, and a fleet this small is pills whatever the speed.
    await open(page, '/snimka/?t=2026-09-29T12:00&brzina=600');
    await mapUp(page);
    await expect(map(page)).toHaveAttribute('data-sn-glyphs', 'pills', { timeout: 30_000 });
    await expect(map(page)).toHaveAttribute('data-sn-at', '2026-09-29T12:00');
  });

  test('the passive frame is the whole tram network, computed once the artefact is in; the follow toggle sits in the control stack with aria-pressed', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-29T07:45');
    await mapUp(page);
    await expect(map(page)).toHaveAttribute('data-sn-frame', /^1[0-2]\.\d\d$/, { timeout: 30_000 });
    const zoom = Number(await map(page).getAttribute('data-sn-frame'));
    expect(zoom).toBeGreaterThanOrEqual(10.5);
    expect(zoom).toBeLessThanOrEqual(12.6);
    const toggle = map(page).locator('.maplibregl-ctrl button[data-sn="follow"]');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAttribute('aria-label', 'Karta prati događaje');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page).toHaveURL(/prati=0/);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
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
    await expect(map(page)).toHaveAttribute('data-sn-frame', /./, { timeout: 30_000 });
    await expect(map(page)).toHaveAttribute('data-center', /./, { timeout: 15_000 });
    const [lon0] = await center(page);
    await play(page).click();
    await expect(play(page)).toHaveText(/Zaustavi|Pauziraj/);
    // Route 228's main shape runs from 15.997 to 16.020 east (Kaptol to Rebro): a fit on it lands the centre east of the frame's centre.
    await expect.poll(async () => (await center(page))[0], { timeout: 15_000, message: 'the camera east of where it opened' }).toBeGreaterThan(lon0 + 0.004);
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
    await play(page).click();
    await expect(play(page)).toHaveText(/Zaustavi|Pauziraj/);
    // Six replay minutes to the chapter at one minute a second, then two more: the cue passed within 20 s of the drag and was skipped.
    await page.waitForTimeout(8500);
    await expect(map(page)).toHaveAttribute('data-sn-at', /^2026-09-29T09:5[7-9]|^2026-09-29T10:0/);
    const [lon2, lat2] = await center(page);
    expect(Math.abs(lon2 - lon1)).toBeLessThan(0.0005);
    expect(Math.abs(lat2 - lat1)).toBeLessThan(0.0005);
  });
});
