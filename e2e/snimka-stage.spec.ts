// The instrument of /snimka/ (v2) in a browser, on the synthetic dataset of
// snimka-fixtures.ts (routeSnimka answers every /api/snimka/v2/ request):
// autoplay and Zaustavi, the scrubber's 112 hours, a shared link, the speeds,
// the keyboard map, the panel deck (seven faces, Enter and Escape, the address
// key), the timeline's three lanes, the heatmap's line subject, the layer
// chips, the lightweight mode, reduced motion, the phone's swipe deck,
// presentation mode and axe with a panel open in both themes.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { analyzeAtRest } from './axe-at-rest';
import { buildSnimkaFixture, routeSnimka, type SnimkaFixture } from './snimka-fixtures';

const fixture = buildSnimkaFixture();

const stage = (page: Page) => page.locator('[data-sn-mount="stage"]');
const root = (page: Page) => page.locator('[data-sn-stage]');
const plateTime = (page: Page) => page.locator('.sn-plate-time');
const plateDay = (page: Page) => page.locator('.sn-plate-day');
const play = (page: Page) => page.locator('[data-sn="play"]');
const scrubber = (page: Page) => page.locator('[data-sn="scrubber"]');
const status = (page: Page) => page.locator('[data-sn="status"]');
const face = (page: Page, id: string) => page.locator(`[data-sn-face="${id}"]`);

async function open(page: Page, path: string, data: SnimkaFixture = fixture, viewport = { width: 1366, height: 768 }): Promise<void> {
  await page.setViewportSize(viewport);
  await routeSnimka(page, data);
  await page.goto(path);
  await expect(stage(page)).not.toHaveAttribute('aria-busy', 'true');
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe('/snimka/ instrument', () => {
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

  test('Home and End on the scrubber reach the two ends of the 112 hours, with a matching aria-valuetext', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-29T06:30');
    await expect(scrubber(page)).toHaveAttribute('max', '6720');
    await scrubber(page).focus();
    await page.keyboard.press('Home');
    await expect(plateDay(page)).toHaveText('ned 27. 9.');
    await expect(plateTime(page)).toHaveText('20:00');
    await expect(scrubber(page)).toHaveAttribute('aria-valuetext', 'ned 27. 9. u 20:00');
    await page.keyboard.press('End');
    await expect(plateDay(page)).toHaveText('pet 2. 10.');
    await expect(plateTime(page)).toHaveText('12:00');
    await expect(scrubber(page)).toHaveValue('6720');
    await expect(page).toHaveURL(/[?&]t=2026-10-02T12:00&brzina=600/);
    await play(page).click();
    await expect(play(page)).toHaveText('Zaustavi');
    await expect(plateDay(page)).toHaveText('ned 27. 9.');
  });

  test('a shared link opens paused at its minute; the Vozila face says the state with its retroactive mark', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-29T06:30');
    await expect(plateTime(page)).toHaveText('06:30');
    await expect(play(page)).toHaveText('Pokreni');
    await expect(status(page)).toHaveText('Zaustavljeno: uto 29. 9. u 06:30.');
    await page.waitForTimeout(1200);
    await expect(plateTime(page)).toHaveText('06:30');
    await expect(face(page, 'vozila').locator('[data-sn="state-word"]')).toHaveText('Gotovo bez vozila');
    await expect(face(page, 'vozila').locator('[data-sn="retro"]')).toBeVisible();
    // After the service went live the mark leaves.
    await open(page, '/snimka/?t=2026-10-01T07:45');
    await expect(face(page, 'vozila').locator('[data-sn="state-word"]')).toHaveText('Uobičajeno');
    await expect(face(page, 'vozila').locator('[data-sn="retro"]')).toBeHidden();
  });

  test('the instrument stands in the first viewport at 1366×768: #snimka starts under 300 px (decision S-9)', async ({ page }) => {
    await open(page, '/snimka/');
    const top = await page.evaluate(() => document.querySelector('#snimka')!.getBoundingClientRect().top + window.scrollY);
    expect(top).toBeLessThan(300);
    await expect(page.locator('[data-sn="questions"]')).toHaveAttribute('data-sn-questions', 'ready');
    const topAfter = await page.evaluate(() => document.querySelector('#snimka')!.getBoundingClientRect().top + window.scrollY);
    expect(topAfter, 'the upgraded chips keep the hero compact').toBeLessThan(300);
  });

  test('the timeline shows the fleet lane, the state band and three tick lanes with the day labels', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45');
    await expect(page.locator('.sn-tl-ticks')).toHaveCount(3);
    await expect(page.locator('.sn-tl-ticks[data-lane="chapter"] .sn-tl-tick').first()).toHaveAttribute('title', /.+ · .+/);
    expect(await page.locator('.sn-tl-ticks[data-lane="press"] .sn-tl-tick').count()).toBeGreaterThan(0);
    expect(await page.locator('.sn-tl-band .sn-tl-seg-state').count()).toBeGreaterThan(3);
    await expect(page.locator('.sn-tl-day')).toHaveText(['pon 28. 9.', 'uto 29. 9.', 'sri 30. 9.', 'čet 1. 10.', 'pet 2. 10.']);
    await expect(page.locator('.sn-tl-lanes')).toHaveAttribute('aria-hidden', 'true');
  });

  test('one hour per second says the network draws, not the vehicles; the keys 1 to 4 pick the speeds', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45');
    const note = page.locator('[data-sn="speed-note"]');
    await expect(note).toBeHidden();
    await page.locator('.sn-tl-speed [data-speed="3600"]').click();
    await expect(page.locator('.sn-tl-speed [data-speed="3600"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(note).toHaveText('Pri brzini od sata u sekundi crtaju se linije s vozilima i bez njih, ne pojedina vozila.');
    await expect(page).toHaveURL(/brzina=3600/);
    await play(page).focus();
    await page.keyboard.press('Digit2');
    await expect(note).toBeHidden();
    await expect(page).toHaveURL(/brzina=60/);
  });

  test('the keyboard map: J and L walk the chapters, comma and full stop step a minute (ten with Shift), Space plays', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45');
    await play(page).focus();
    await page.keyboard.press('KeyL');
    await expect(plateTime(page)).not.toHaveText('07:45');
    const next = await plateTime(page).textContent();
    await page.keyboard.press('KeyJ');
    await expect(plateTime(page)).toHaveText('07:45');
    await page.keyboard.press('Comma');
    await expect(plateTime(page)).toHaveText('07:44');
    await page.keyboard.press('Shift+Period');
    await expect(plateTime(page)).toHaveText('07:54');
    expect(next).not.toBe('07:54');
    await stage(page).focus();
    await page.keyboard.press('Space');
    await expect(play(page)).toHaveText('Zaustavi');
    await page.keyboard.press('Space');
    await expect(play(page)).toHaveText('Pokreni');
  });

  test('the chips stand in two labelled groups; Običan dan is on at the opening and leaves the address when turned off', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45');
    await expect(page.getByRole('group', { name: 'Izvori' }).locator('.sn-chip')).toHaveText(['Vozila', 'BAJS', 'Zatvorene ulice', 'Običan dan']);
    await expect(page.getByRole('group', { name: 'Kaj ima? izvodi' }).locator('.sn-chip')).toHaveText(['Živa mreža', 'Karta prati snimku']);
    const chip = page.locator('[data-layer="compare"]');
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    // Monday against Monday 21 September (S-12).
    await expect(page.locator('[data-sn="compare-note"]')).toHaveText('Običan dan je ponedjeljak 21. rujna u isto doba dana.');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(page).toHaveURL(/usporedba=0/);
    await expect(page.locator('[data-sn="compare-note"]')).toBeHidden();
    await open(page, '/snimka/?t=2026-09-29T07:45');
    await expect(page.locator('[data-sn="compare-note"]')).toHaveText('Običan dan je četvrtak 24. rujna u isto doba dana.');
  });

  test('the map draws the recorded fleet at the instant behind the persisted host', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45');
    const map = page.locator('[data-sn="map"]');
    await expect(map).toHaveAttribute('data-persist', '');
    await expect(map.locator('canvas')).toHaveCount(1, { timeout: 30_000 });
    await expect(map).toHaveAttribute('data-sn-drawn', '5', { timeout: 30_000 });
    // Opening and closing a panel rebuilds the deck, never the map.
    await map.evaluate((el) => { (el as HTMLElement & { snMark?: number }).snMark = 1; });
    await face(page, 'bicikli').click();
    await expect(root(page)).toHaveAttribute('data-sn-expanded', 'bicikli');
    await face(page, 'bicikli').click();
    await expect(root(page)).toHaveAttribute('data-sn-expanded', 'none');
    expect(await map.evaluate((el) => (el as HTMLElement & { snMark?: number }).snMark)).toBe(1);
  });

  test('?lagano=1 loads no canvas and no network file, reads the v2 manifest, and the clock still advances', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => { requests.push(r.url()); });
    await open(page, '/snimka/?lagano=1');
    await expect(page.locator('[data-sn="lagano"]')).toContainText('Lagani prikaz je bez karte');
    await expect(plateTime(page)).not.toHaveText('07:45', { timeout: 3000 });
    expect(await stage(page).locator('canvas').count()).toBe(0);
    expect(requests.filter((u) => /zet-network|\/networks\/|maplibre|\.woff2?(\?|$)/.test(u))).toEqual([]);
    expect(requests.some((u) => u.includes('/api/snimka/v2/manifest.json'))).toBe(true);
  });

  test('reduced motion never autoplays and says so', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, '/snimka/');
    await expect(play(page)).toHaveText('Pokreni');
    await expect(page.locator('.sn-tl-reduced')).toHaveText('Smanjeno kretanje je uključeno: snimka se ne pokreće sama.');
    await page.waitForTimeout(1500);
    await expect(plateTime(page)).toHaveText('07:45');
  });

  test('presentation mode: Cijeli zaslon marks the stage presenting and the button leaves it (best effort on fullscreen)', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45');
    const button = page.locator('[data-sn="present"]');
    await expect(button).toHaveAccessibleName('Cijeli zaslon');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await button.click();
    await expect(root(page)).toHaveAttribute('data-sn-presenting', /^(fullscreen|pinned)$/, { timeout: 5000 });
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(button).toHaveAccessibleName('Izađi iz cijelog zaslona');
    const box = (await root(page).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(700);
    await button.click();
    await expect(root(page)).not.toHaveAttribute('data-sn-presenting', /.+/, { timeout: 5000 });
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  test('Tijek: a press on the fleet plot pauses and seeks to its minute, and the readout follows', async ({ page }) => {
    await open(page, '/snimka/');
    await expect(play(page)).toHaveText('Zaustavi');
    const plot = page.locator('#tijek [data-plot="fleet"]');
    await plot.scrollIntoViewIfNeeded();
    const box = (await plot.boundingBox())!;
    // Half way along the 6,720 minutes: Wednesday 30 September 04:00.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(play(page)).toHaveText('Pokreni');
    await expect(plateDay(page)).toHaveText('sri 30. 9.');
    await expect(plateTime(page)).toHaveText(/^0(3:5[89]|4:0[012])$/);
    const time = await plateTime(page).textContent();
    await expect(page.locator('.sn-strip-readout')).toHaveText(new RegExp(`^sri 30\\. 9\\. u ${time}: u pokretu `));
    await expect(page).toHaveURL(new RegExp(`t=2026-09-30T${time}`));
    // Dragging keeps seeking: a quarter further on is Thursday.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(plateDay(page)).toHaveText('čet 1. 10.');
  });

  for (const width of [360, 390]) {
    test(`on a phone at ${width} the deck is one swipe row with the voices, the speed is a select, every control 44 px, nothing scrolls sideways`, async ({ page }) => {
      await open(page, '/snimka/?t=2026-09-28T07:45', fixture, { width, height: 844 });
      const row = page.locator('.sn-deck-row');
      expect(await row.evaluate((el) => getComputedStyle(el).scrollSnapType)).toMatch(/^x mandatory/);
      expect(await row.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      const firstItem = page.locator('.sn-deck-item').first();
      const itemBox = (await firstItem.boundingBox())!;
      expect(Math.round(itemBox.width)).toBe(Math.round(width * 0.78));
      expect(await firstItem.evaluate((el) => getComputedStyle(el).scrollSnapAlign)).toMatch(/start/);
      await expect(page.locator('.sn-tl-speed')).toBeHidden();
      await expect(page.locator('[data-sn="speed-select"]')).toBeVisible();
      expect(await page.locator('.sn-slot-timeline').evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
      const mapBox = (await page.locator('.sn-map-box').boundingBox())!;
      expect(Math.abs(mapBox.height - 844 * 0.56)).toBeLessThan(2);
      expect(await horizontalOverflow(page)).toBe(0);
      for (const control of await stage(page).locator('button:not(.maplibregl-ctrl button), select, input[type="range"]').all()) {
        if (!(await control.isVisible())) continue;
        const b = (await control.boundingBox())!;
        if (b.x + b.width < 0 || b.x > width) continue; // a card further along the swipe row
        expect(b.height, await control.evaluate((el) => el.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
      }
      await face(page, 'vozila').click();
      await expect(root(page)).toHaveAttribute('data-sn-expanded', 'vozila');
      expect(await horizontalOverflow(page)).toBe(0);
    });
  }
});

// The deck of v3 (decisions V3-14, V3-15): three faces against the normal day, the grammar, the phone row, axe.
test.describe('Deck', () => {
  test('three faces, each against a normal day: the Vozila badge and glyph, the Mreža counts, the empty stations against Thursday', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45');
    await expect(page.locator('.sn-panel-face')).toHaveCount(3);
    await expect(page.locator('.sn-deck-item')).toHaveCount(3);
    for (const id of ['vozila', 'mreza', 'bicikli']) await expect(face(page, id).locator('.sn-panel-chevron')).toHaveCount(1);
    const vozila = face(page, 'vozila');
    await expect(vozila.locator('[data-sn="state-word"]')).toHaveText('Gotovo bez vozila');
    await expect(vozila.locator('[data-sn="retro"]')).toHaveText('izračunano naknadno');
    await expect(vozila.locator('.sn-ro-fig')).toHaveText(/^\d+ u pokretu$/);
    await expect(vozila.locator('.sn-ro-sub')).toHaveText(/^običan dan \(pon 21\. 9\.\) u isto doba: \d+$/);
    await expect(vozila.locator('[data-sn-bar2]')).toHaveAttribute('data-sn-bar2', 'ok');
    await expect(vozila.locator('.sn-ro-bar2-track')).toHaveAttribute('aria-label', /^sada \d+, običan dan \d+$/);
    const mreza = face(page, 'mreza');
    await expect(mreza.locator('.sn-mm')).toHaveAttribute('data-sn-minimaps', 'ready');
    await expect(mreza.locator('.sn-mm-now .sn-mm-count')).toHaveText(/^linije s vozilom: 2 od \d+$/);
    await expect(mreza.locator('.sn-mm-normal .sn-mm-name')).toHaveText('pon 21. 9., isto doba');
    await expect(mreza).toHaveAccessibleName(/linije s vozilom: 2 od \d+.*pon 21\. 9\., isto doba linije s vozilom: \d+ od \d+/);
    const bicikli = face(page, 'bicikli');
    await expect(bicikli.locator('.sn-ro-fig')).toHaveText(/^\d+ (prazna stanica|prazne stanice|praznih stanica)$/);
    await expect(bicikli.locator('.sn-ro-bar2-label')).toHaveText(/^čet 1\. 10\.: \d+$/);
    await expect(bicikli.locator('.sn-ro-sub')).toHaveText(/^bicikala [\d.]+ · čet 1\. 10\.: [\d.]+$/);
  });

  test('Enter on Vozila expands it in place without reordering; Zatvori closes and gives the focus back', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45');
    const order = async (): Promise<string[]> => page.locator('.sn-deck-item').evaluateAll((items) => items.map((li) => (li as HTMLElement).dataset.key ?? ''));
    const before = await order();
    const tops = async (): Promise<number[]> => page.locator('.sn-panel-face').evaluateAll((faces) => faces.map((f) => f.getBoundingClientRect().top));
    await face(page, 'vozila').focus();
    await page.keyboard.press('Enter');
    await expect(root(page)).toHaveAttribute('data-sn-expanded', 'vozila');
    await expect(face(page, 'vozila')).toHaveAttribute('aria-expanded', 'true');
    await expect(face(page, 'vozila')).toBeFocused();
    expect(await order()).toEqual(before);
    const t = await tops();
    expect(t).toEqual([...t].sort((a, b) => a - b));
    const depth = page.locator('#sn-depth-vozila');
    await expect(depth).toBeVisible();
    await expect(depth).toHaveAttribute('role', 'region');
    await expect(depth.locator('.sn-panel-plot')).toHaveCount(1);
    await expect(depth.locator('[data-sn="vozila-now"]')).toHaveText(/^u pokretu \d+, po voznom redu \d+$/);
    await expect(depth.locator('a.sn-panel-deeper')).toHaveText('Više u odjeljku „Tijek”');
    await expect(page.locator('[data-dim]')).toHaveCount(0);
    await expect(page).toHaveURL(/panel=vozila/);
    await depth.getByRole('button', { name: 'Zatvori' }).click();
    await expect(root(page)).toHaveAttribute('data-sn-expanded', 'none');
    await expect(depth).toBeHidden();
    await expect(face(page, 'vozila')).toBeFocused();
    await expect(page).not.toHaveURL(/panel=/);
    // Escape closes too.
    await page.keyboard.press('Enter');
    await expect(root(page)).toHaveAttribute('data-sn-expanded', 'vozila');
    await page.keyboard.press('Escape');
    await expect(root(page)).toHaveAttribute('data-sn-expanded', 'none');
  });

  test('?panel=mreza opens expanded: large twins with one legend, the lines with a vehicle as chips that set the subject', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45&panel=mreza');
    await expect(root(page)).toHaveAttribute('data-sn-expanded', 'mreza');
    const depth = page.locator('#sn-depth-mreza');
    await expect(depth).toBeVisible();
    await expect(depth.locator('.sn-mm')).toHaveAttribute('data-sn-minimaps', 'ready');
    await expect(depth.locator('.sn-mm-legend')).toHaveCount(1);
    const chips = depth.locator('[data-sn="line-chips"] button');
    await expect(chips).toHaveCount(2);
    await expect(chips.first()).toHaveText(/^\S+ \d+ · običan dan (\d+|bez podatka)$/);
    await chips.first().click();
    await expect(page).toHaveURL(/linija=/);
    await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(depth.locator('[data-sn="subject-now"]')).toHaveText(/^Linija \S+: sada \d+ vozila, običan dan (\d+|bez podatka) u isto doba$/);
    await expect(depth.locator('a.sn-panel-deeper')).toHaveText('Više u odjeljku „Tijek”');
    await depth.getByRole('button', { name: 'Ukloni odabir' }).click();
    await expect(page).not.toHaveURL(/linija=/);
  });

  test('?panel=bicikli opens the twin station maps and the stations empty now that were not on Thursday', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45&panel=bicikli');
    const depth = page.locator('#sn-depth-bicikli');
    await expect(depth.locator('.sn-panel-dots')).toHaveCount(2);
    await expect(depth.locator('.sn-panel-dotmap-now svg')).toHaveAttribute('data-sn-dots', /^\d+\/\d+$/);
    await expect(depth.locator('.sn-panel-dotmap-ref figcaption')).toHaveText('čet 1. 10., isto doba');
    await expect(depth.locator('#sn-ro-stations-h')).toHaveText('Prazne sada, a u četvrtak 1. 10. nisu bile');
    await expect(depth.getByText('Sva tri dana suho, od 8 do 25 °C (DHMZ, Maksimir).')).toBeVisible();
  });

  test('on a phone the swipe row starts at scrollLeft 0 with Mreža first, and nothing scrolls sideways', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:45', fixture, { width: 390, height: 844 });
    const row = page.locator('.sn-deck-row');
    await page.waitForTimeout(300);
    expect(await row.evaluate((el) => el.scrollLeft)).toBe(0);
    const first = await page.locator('.sn-deck-item').evaluateAll((items) => {
      const sorted = [...items].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      return (sorted[0] as HTMLElement).dataset.key;
    });
    expect(first).toBe('mreza');
    const box = (await page.locator('.sn-deck-item[data-key="mreza"]').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await horizontalOverflow(page)).toBe(0);
  });

  for (const [viewport, panel] of [[{ width: 1366, height: 768 }, 'bicikli'], [{ width: 390, height: 844 }, 'mreza']] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`axe @${viewport.width} (${scheme}) with the ${panel} panel expanded: no serious or critical violations`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await open(page, `/snimka/?t=2026-09-28T07:45&panel=${panel}`, fixture, viewport);
        await expect(page.locator(`#sn-depth-${panel}`)).toBeVisible();
        await page.waitForLoadState('networkidle');
        const results = await analyzeAtRest(page, () => new AxeBuilder({ page }).include('[data-sn-mount="stage"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze());
        const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(blocking.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      });
    }
  }
});
