// Objave and the subtitle of /snimka/ in a browser (v3, V3-16 and V3-17), on
// the synthetic dataset of snimka-fixtures.ts: while the replay plays a
// current item stands over a log with a chapter heading; a click on a
// headline row moves the replay to its minute and makes the line the
// subject, "Prikaži sve" clears it; the subtitle marks the record ("zapis")
// inside a run and today's rules ("izračun") between runs and changes at
// most four times in ten seconds at ten minutes a second. (Zaslon is the
// report spec's, W4b.)
import { expect, test, type Page } from '@playwright/test';
import { buildSnimkaFixture, routeSnimka } from './snimka-fixtures';

const fixture = buildSnimkaFixture();

const feed = (page: Page) => page.locator('[data-sn-slot="voices"]');
const subtitle = (page: Page) => page.locator('[data-sn-slot="subtitle"] .sn-sub');

async function open(page: Page, path: string): Promise<void> {
  await page.setViewportSize({ width: 1366, height: 900 });
  await routeSnimka(page, fixture);
  await page.goto(path);
  await expect(page.locator('[data-sn-mount="stage"]')).not.toHaveAttribute('aria-busy', 'true');
  await expect(feed(page).locator('.sn-feed')).toHaveCount(1);
}

test.describe('/snimka/ Objave and the subtitle', () => {
  test('while playing, a current item stands over a log with a chapter heading and day headings', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:40&brzina=600');
    await expect(feed(page).locator('.sn-feed-title')).toHaveText('Objave');
    const before = await feed(page).getAttribute('data-sn-feed-current');
    await page.locator('[data-sn="play"]').click();
    await expect.poll(async () => feed(page).getAttribute('data-sn-feed-current'), { timeout: 10_000 }).not.toBe(before);
    await page.locator('[data-sn="play"]').click();
    const current = feed(page).locator('.sn-feed-current');
    await expect(current).toBeVisible();
    await expect(current.locator('.sn-feed-kind')).not.toHaveText('');
    await expect(feed(page).locator('.sn-feed-log h4.sn-feed-chapter').first()).toBeVisible();
    expect(await feed(page).locator('.sn-feed-log .sn-feed-day').count()).toBeGreaterThan(0);
    // Rows, not cards: a log row is one line of 13 px text in a 44 px target.
    const row = feed(page).locator('.sn-feed-log .sn-feed-row-btn').first();
    const box = (await row.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await row.evaluate((el) => getComputedStyle(el).fontSize)).toBe('13px');
    expect(await current.locator('.sn-feed-headline').evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
    expect(await feed(page).evaluate((el) => getComputedStyle(el).paddingTop)).toBe('12px');
    // No companion items, no beat pills.
    expect(await feed(page).locator('[data-id^="companion:"], .sn-feed-beat').count()).toBe(0);
  });

  test('a headline row seeks to its minute and makes the line the subject; Prikaži sve clears it', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-30T12:00&brzina=600');
    await feed(page).locator('.sn-feed-row[data-id="news:v1"] button').click();
    await expect(feed(page)).toHaveAttribute('data-sn-feed-subject', 'route:228');
    await expect(feed(page)).toHaveAttribute('data-sn-feed-current', 'news:v1');
    await expect(page).toHaveURL(/[?&]t=2026-09-29T10:30(?:&|$)/);
    await expect(page).toHaveURL(/[?&]linija=228(?:&|$)/);
    await expect(feed(page).locator('.sn-feed-filter-text')).toHaveText(/^Samo linija 228 · skriveno \d+$/);
    await expect(feed(page).locator('.sn-feed-current .sn-feed-headline a')).toHaveAttribute('rel', 'noopener noreferrer');
    const filterBox = (await feed(page).locator('.sn-feed-filter').boundingBox())!;
    expect(filterBox.height).toBeGreaterThanOrEqual(44);
    expect(filterBox.height).toBeLessThan(60);
    await feed(page).getByRole('button', { name: 'Prikaži sve' }).click();
    await expect(feed(page)).toHaveAttribute('data-sn-feed-subject', '');
    await expect(feed(page).locator('.sn-feed-filter')).toBeHidden();
    await expect(page).not.toHaveURL(/linija=/);
  });

  test('the subtitle marks the record inside a run and today\'s rules between runs, with the link to Zaslon', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:40&brzina=600');
    await expect(subtitle(page)).toHaveAttribute('data-sn-sub-source', 'replayed');
    await expect(subtitle(page).locator('.sn-sub-mark')).toHaveText('izračun');
    await expect(subtitle(page).locator('.sn-sub-kicker')).toHaveText('Po današnjim pravilima pisalo bi');
    await expect(subtitle(page)).not.toHaveAttribute('aria-live', /.+/);
    await subtitle(page).locator('.sn-sub-mark').focus();
    await expect(subtitle(page).locator('.sn-sub-note')).toBeVisible();
    await expect(subtitle(page).locator('.sn-sub-more')).toHaveAttribute('href', '#zaslon');
    // The band sits inside the map box, over its bottom edge.
    const band = (await subtitle(page).boundingBox())!;
    const map = (await page.locator('.sn-map-box').boundingBox())!;
    expect(band.y + band.height).toBeLessThanOrEqual(map.y + map.height + 1);
    expect(band.y).toBeGreaterThan(map.y + map.height / 2);
    await open(page, '/snimka/?t=2026-09-28T07:50&brzina=600');
    await expect(subtitle(page)).toHaveAttribute('data-sn-sub-source', 'observed');
    await expect(subtitle(page).locator('.sn-sub-mark')).toHaveText('zapis');
    await expect(subtitle(page).locator('.sn-sub-text')).toHaveText('Tramvaj 6 prema Črnomercu polazi u 07:52 po voznom redu.');
  });

  test('at ten minutes a second the subtitle changes at most four times in ten seconds', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:30&brzina=600');
    await page.evaluate(() => {
      const text = document.querySelector('[data-sn-slot="subtitle"] .sn-sub-text')!;
      (window as unknown as { snChanges: number }).snChanges = 0;
      let last = text.textContent;
      new MutationObserver(() => {
        if (text.textContent !== last) { last = text.textContent; (window as unknown as { snChanges: number }).snChanges += 1; }
      }).observe(text, { childList: true, characterData: true, subtree: true });
    });
    await page.locator('[data-sn="play"]').click();
    await page.waitForTimeout(10_000);
    const changes = await page.evaluate(() => (window as unknown as { snChanges: number }).snChanges);
    expect(changes).toBeLessThanOrEqual(4);
  });
});
