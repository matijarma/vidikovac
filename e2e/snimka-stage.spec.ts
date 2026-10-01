// The stage of /snimka/ in a browser, on the synthetic dataset of
// snimka-fixtures.ts (routeSnimka answers every /api/snimka/v1/ request):
// autoplay and Zaustavi, the scrubber's ends, a shared link, the speeds, the
// voices, a missing chunk, the lightweight mode and reduced motion.
import { expect, test, type Page } from '@playwright/test';
import { buildSnimkaFixture, MARKS, routeSnimka, type SnimkaFixture } from './snimka-fixtures';

const fixture = buildSnimkaFixture();
const gapped = buildSnimkaFixture({ missingChunkAt: MARKS.motion396[0] });

const stage = (page: Page) => page.locator('[data-sn-mount="stage"]');
const plateTime = (page: Page) => page.locator('.sn-plate-time');
const plateDay = (page: Page) => page.locator('.sn-plate-day');
const play = (page: Page) => page.locator('[data-sn="play"]');
const scrubber = (page: Page) => page.locator('[data-sn="scrubber"]');
const status = (page: Page) => page.locator('[data-sn="status"]');
const badge = (page: Page) => page.locator('[data-sn="badge"]');

async function open(page: Page, path: string, data: SnimkaFixture = fixture, viewport = { width: 1366, height: 900 }): Promise<void> {
  await page.setViewportSize(viewport);
  await routeSnimka(page, data);
  await page.goto(path);
  await expect(stage(page)).not.toHaveAttribute('aria-busy', 'true');
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe('/snimka/ stage', () => {
  test('opens on Monday 07:45 playing at ten minutes a second, and Zaustavi stops it with the instant and the speed in the address', async ({ page }) => {
    await open(page, '/snimka/');
    await expect(plateDay(page)).toHaveText('pon 28. 9.');
    await expect(play(page)).toHaveText('Zaustavi');
    await expect(status(page)).toHaveText('Snimka teče, deset minuta snimke u sekundi.');
    await expect(plateTime(page)).not.toHaveText('07:45', { timeout: 3000 });
    await play(page).click();
    await expect(play(page)).toHaveText('Pokreni');
    await expect(page).toHaveURL(/[?&]t=2026-09-28T0[78]:\d\d&brzina=600(?:&|$)/);
    const stopped = await plateTime(page).textContent();
    await page.waitForTimeout(1200);
    await expect(plateTime(page)).toHaveText(stopped!);
    await expect(status(page)).toHaveText(new RegExp(`^Zaustavljeno: pon 28\\. 9\\. u ${stopped}\\.$`));
    await expect(scrubber(page)).toHaveAttribute('aria-valuetext', `pon 28. 9. u ${stopped}`);
  });

  test('Home and End on the scrubber reach the two ends of the 84 hours, with a matching aria-valuetext', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-29T06:30');
    await expect(scrubber(page)).toHaveAttribute('max', '5040');
    await scrubber(page).focus();
    await page.keyboard.press('Home');
    await expect(plateDay(page)).toHaveText('ned 27. 9.');
    await expect(plateTime(page)).toHaveText('20:00');
    await expect(scrubber(page)).toHaveAttribute('aria-valuetext', 'ned 27. 9. u 20:00');
    await expect(scrubber(page)).toHaveValue('0');
    await page.keyboard.press('End');
    await expect(plateDay(page)).toHaveText('čet 1. 10.');
    await expect(plateTime(page)).toHaveText('08:00');
    await expect(scrubber(page)).toHaveAttribute('aria-valuetext', 'čet 1. 10. u 08:00');
    await expect(scrubber(page)).toHaveValue('5040');
    await expect(page).toHaveURL(/[?&]t=2026-10-01T08:00&brzina=600/);
    // Pokreni at the end starts over from the first minute.
    await play(page).click();
    await expect(play(page)).toHaveText('Zaustavi');
    await expect(plateDay(page)).toHaveText('ned 27. 9.');
  });

  test('a shared link opens paused at its minute, with the retroactive mark and the frozen-feed line the series says', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-29T06:30');
    await expect(plateDay(page)).toHaveText('uto 29. 9.');
    await expect(plateTime(page)).toHaveText('06:30');
    await expect(play(page)).toHaveText('Pokreni');
    await expect(status(page)).toHaveText('Zaustavljeno: uto 29. 9. u 06:30.');
    await page.waitForTimeout(1500);
    await expect(plateTime(page)).toHaveText('06:30');
    await expect(page.locator('[data-sn="retro"]')).toBeVisible();
    await expect(page.locator('[data-sn="retro-note"]')).toContainText('od uto 29. 9. u 23:17');
    await expect(page.locator('[data-sn="feed"]')).toContainText('ZET-ovi podaci nisu se mijenjali od');
    await expect(page.locator('[data-sn="holds"]')).toHaveText(/^traje \d+ h( \d+ min)?$/);
    // No chunk here (the fixture records motion for Monday 07:40 to 08:00 only) while ZET's data is not changing: the
    // recording has no hole, ZET was quiet, so the badge keeps the state word beside the frozen-feed line. "Bez snimke"
    // is for a real hole in the recording (the gapped fixture below).
    await expect(badge(page)).toHaveText('Gotovo bez vozila', { timeout: 30_000 });
    // Inside the recorded chunks the series speaks: the state word and the counts.
    await open(page, '/snimka/?t=2026-09-28T07:52');
    await expect(badge(page)).toHaveText('Gotovo bez vozila', { timeout: 30_000 });
    await expect(page.locator('[data-sn="counts"]')).toHaveText(/^u pokretu \d, po voznom redu oko \d+$/);
    await expect(page.locator('[data-sn="retro"]')).toBeVisible();
    await expect(page.locator('[data-sn="feed"]')).toBeHidden();
  });

  test('one hour per second draws no vehicles and says so; the keys 1 to 4 pick the speeds', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45');
    const note = page.locator('[data-sn="speed-note"]');
    await expect(note).toBeHidden();
    await page.locator('.sn-speed [data-speed="3600"]').click();
    await expect(page.locator('.sn-speed [data-speed="3600"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(note).toBeVisible();
    await expect(note).toHaveText('Pri brzini od sata u sekundi vozila se ne crtaju; brojke su u stanju usluge.');
    await expect(page).toHaveURL(/brzina=3600/);
    await expect(page.locator('[data-sn="map"]')).toHaveAttribute('data-sn-drawn', '0', { timeout: 30_000 });
    await play(page).focus();
    await page.keyboard.press('Digit2');
    await expect(note).toBeHidden();
    await expect(page).toHaveURL(/brzina=60/);
    await expect(status(page)).toHaveText('Zaustavljeno: pon 28. 9. u 07:45.');
  });

  test('the keyboard map: J and L walk the chapters, comma and full stop step a minute (ten with Shift), Space plays', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45');
    await play(page).focus();
    await page.keyboard.press('KeyL');
    await expect(plateTime(page)).toHaveText('18:42');
    await page.keyboard.press('KeyJ');
    await expect(plateTime(page)).toHaveText('07:45');
    await page.keyboard.press('Comma');
    await expect(plateTime(page)).toHaveText('07:44');
    await page.keyboard.press('Shift+Period');
    await expect(plateTime(page)).toHaveText('07:54');
    await expect(play(page)).toHaveText('Pokreni');
    // Space on the stage itself (not on a button) toggles the clock.
    await stage(page).focus();
    await page.keyboard.press('Space');
    await expect(play(page)).toHaveText('Zaustavi');
    await page.keyboard.press('Space');
    await expect(play(page)).toHaveText('Pokreni');
  });

  test('the headline is one external link with its outlet and time, and dies after three hours', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T06:30');
    const link = page.locator('[data-sn="news"] a.sn-headline');
    await expect(link).toContainText('Zagreb bez tramvaja i autobusa');
    await expect(link).toHaveAttribute('href', 'https://www.jutarnji.hr/vijesti/zagreb/primjer-1');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link.locator('.visually-hidden')).toHaveText(/\(otvara se u novoj kartici\)/);
    await expect(page.locator('[data-sn="news"] .sn-card-meta')).toHaveText('Jutarnji list · 06:10');
    expect(await page.locator('[data-sn="news"] a').count()).toBe(1);
    await open(page, '/snimka/?t=2026-09-28T09:30');
    await expect(page.locator('[data-sn="news"]')).toHaveText('U zadnja tri sata nema odabranog naslova.');
  });

  test('ZET javlja keeps the latest notice with its source link; Događaj shows an event for an hour and then leaves', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T06:30');
    const zet = page.locator('[data-sn="zet"]');
    await expect(zet).toContainText('Obavijest o prometu tramvaja i autobusa od ponedjeljka 28. rujna');
    const source = zet.locator('a');
    await expect(source).toContainText('Izvor: ZET');
    await expect(source).toHaveAttribute('href', 'https://www.zet.hr/obavijesti/10164');
    await expect(source).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(zet).toContainText('ned 27. 9. u 16:27');
    await expect(page.locator('.sn-card-marker')).toBeHidden();
    await open(page, '/snimka/?t=2026-09-28T03:45');
    await expect(page.locator('.sn-card-marker')).toBeVisible();
    await expect(page.locator('[data-sn="marker"]')).toContainText('Početak štrajka');
    await expect(page.locator('[data-sn="marker"] a').first()).toHaveAttribute('href', 'https://www.zet.hr/obavijesti/10164');
    await expect(page.locator('[data-sn="marker"]')).toContainText('03:30');
  });

  test('the map draws the recorded fleet at the instant, and a missing chunk says Bez snimke with no vehicles', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45');
    const map = page.locator('[data-sn="map"]');
    await expect(map.locator('canvas')).toHaveCount(1, { timeout: 30_000 });
    await expect(map).toHaveAttribute('data-sn-drawn', '5', { timeout: 30_000 });
    // The pills MapLibre placed (name-census.ts data-pills) in the opening view, 7.6 by 4.6 km around Trg bana Jelačića at
    // 1366 by 900: lines 13 and 33 of the fixture (1.5 and 1.2 km south, under 3.5 km east); line 17 sits 4.7 km west.
    const pillsPlaced = async (): Promise<string[]> => ((await map.getAttribute('data-pills')) ?? '').split('|');
    await expect.poll(async () => ((await map.getAttribute('data-pills')) ?? '') !== '', { timeout: 30_000, message: 'a pill placed after load' }).toBe(true);
    await expect.poll(pillsPlaced, { timeout: 30_000, message: 'lines 13 and 33 placed' }).toEqual(expect.arrayContaining(['13', '33']));
    // Three of the five are on screen, so the small-fleet camera (camera.ts) left the opening view alone.
    await expect(map).toHaveAttribute('data-sn-fit', 'inView');
    expect(await pillsPlaced()).not.toContain('17');
    // Panned west and south by MapLibre's own keys, the stage places line 17 too: the fleet is drawn wherever the
    // camera goes. Each key is a 100 px easeTo of about 300 ms from the camera's current centre, and a press during
    // the ease restarts it from there, so back-to-back presses collapse into a step or two: each press gets its ease,
    // and the camera is read back (data-center) first. The census (name-census.ts) re-reads the pills on a change of
    // its key (zoom, selection, marks, evidence version), never on a pan alone, so a layer toggled off and on (two
    // updates) asks it again.
    await map.locator('canvas').focus();
    for (let i = 0; i < 6; i++) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(400); }
    for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(400); }
    await expect.poll(async () => {
      const [lon, lat] = ((await map.getAttribute('data-center')) ?? '').split(',').map(Number);
      return lon < 15.93 && lat < 45.795;
    }, { timeout: 15_000, message: 'the camera west and south of Jelačić' }).toBe(true);
    await page.locator('[data-layer="closures"]').click();
    await page.locator('[data-layer="closures"]').click();
    await expect(page.locator('[data-layer="closures"]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(pillsPlaced, { timeout: 30_000, message: 'line 17 placed after the pan' }).toContain('17');
    await expect(badge(page)).toHaveText('Gotovo bez vozila');
    await expect(page.locator('[data-sn="counts"]')).toBeVisible();
    // Vozila off: nothing drawn, the counts stay.
    await page.locator('[data-layer="vehicles"]').click();
    await expect(page.locator('[data-layer="vehicles"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(map).toHaveAttribute('data-sn-drawn', '0', { timeout: 10_000 });
    await expect(page.locator('[data-sn="counts"]')).toBeVisible();

    await open(page, '/snimka/?t=2026-09-28T07:45', gapped);
    await expect(badge(page)).toHaveText('Bez snimke', { timeout: 30_000 });
    await expect(page.locator('[data-sn="counts"]')).toBeHidden();
    await expect(page.locator('[data-sn="holds"]')).toBeVisible();
    await expect(page.locator('[data-sn="map"]')).toHaveAttribute('data-sn-drawn', '0');
    // Ten minutes on, the next chunk is recorded: the series speaks again and the fleet is drawn.
    await play(page).focus();
    await page.keyboard.press('Shift+Period');
    await expect(plateTime(page)).toHaveText('07:55');
    await expect(badge(page)).toHaveText('Gotovo bez vozila', { timeout: 30_000 });
    await expect(page.locator('[data-sn="counts"]')).toBeVisible();
    await expect(page.locator('[data-sn="map"]')).toHaveAttribute('data-sn-drawn', '5', { timeout: 30_000 });
  });

  test('Običan dan toggles the comparison layer into the address and back from it', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45');
    const chip = page.locator('[data-layer="compare"]');
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-sn="compare-note"]')).toBeHidden();
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-sn="compare-note"]')).toHaveText('Običan dan je četvrtak 24. rujna u isto doba dana.');
    await expect(page).toHaveURL(/usporedba=1/);
    await page.reload();
    await expect(stage(page)).not.toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('[data-layer="compare"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('?lagano=1 loads no canvas, no network file and no font, and the clock still advances', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => { requests.push(r.url()); });
    await open(page, '/snimka/?lagano=1');
    await expect(page.locator('[data-sn="lagano"]')).toBeVisible();
    await expect(page.locator('[data-sn="lagano"] .sn-lagano-num')).toHaveText(/^\d+$/);
    await expect(page.locator('[data-sn="lagano"]')).toContainText('Lagani prikaz je bez karte');
    await expect(plateTime(page)).not.toHaveText('07:45', { timeout: 3000 });
    await page.waitForTimeout(500);
    expect(await stage(page).locator('canvas').count()).toBe(0);
    expect(requests.filter((u) => /zet-network|\/networks\/|maplibre|\.woff2?(\?|$)/.test(u))).toEqual([]);
    expect(requests.some((u) => u.includes('/api/snimka/v1/manifest.json'))).toBe(true);
    await expect(page).toHaveURL(/lagano=1/);
  });

  test('reduced motion never autoplays and says so', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, '/snimka/');
    await expect(play(page)).toHaveText('Pokreni');
    await expect(page.locator('.sn-reduced-note')).toHaveText('Smanjeno kretanje je uključeno: snimka se ne pokreće sama.');
    await page.waitForTimeout(1500);
    await expect(plateTime(page)).toHaveText('07:45');
    await expect(status(page)).toHaveText('Zaustavljeno: pon 28. 9. u 07:45.');
  });

  test('on a phone the speed is a native select, every control is at least 44 px and nothing scrolls sideways', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45', fixture, { width: 390, height: 844 });
    await expect(page.locator('.sn-speed')).toBeHidden();
    const select = page.locator('[data-sn="speed-select"]');
    await expect(select).toBeVisible();
    await select.selectOption('3600');
    await expect(page.locator('[data-sn="speed-note"]')).toBeVisible();
    await expect(page).toHaveURL(/brzina=3600/);
    expect(await horizontalOverflow(page)).toBe(0);
    // The stage's own controls; MapLibre's zoom and locate buttons are the library's (the same on every map of the app).
    for (const control of await stage(page).locator('button:not(.maplibregl-ctrl button), select, input[type="range"]').all()) {
      if (!(await control.isVisible())) continue;
      const box = (await control.boundingBox())!;
      expect(box.height, await control.evaluate((el) => el.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
    }
  });
});
