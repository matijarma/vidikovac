// The voices of /snimka/ in a browser, on the synthetic v2 dataset of
// snimka-fixtures.ts: the feed fills in time order while the replay plays, a
// click on the line-228 headline moves the replay to its minute and makes the
// line the subject, "Sve teme" clears it; the subtitle marks the record
// ("Zapis") inside a run and today's rules ("Današnja pravila") between runs;
// Zaslon moved to e2e/snimka-report.spec.ts, describe('Zaslon'), in v3.
import { expect, test, type Page } from '@playwright/test';
import { buildSnimkaFixture, routeSnimka } from './snimka-fixtures';

const fixture = buildSnimkaFixture();

const feed = (page: Page) => page.locator('[data-sn-slot="voices"]');
const feedItems = (page: Page) => page.locator('[data-sn-slot="voices"] .sn-feed-list:not(.sn-feed-older-list) > .sn-feed-item');
const subtitle = (page: Page) => page.locator('[data-sn-slot="subtitle"] .sn-sub');

async function open(page: Page, path: string): Promise<void> {
  await page.setViewportSize({ width: 1366, height: 900 });
  await routeSnimka(page, fixture);
  await page.goto(path);
  await expect(page.locator('[data-sn-mount="stage"]')).not.toHaveAttribute('aria-busy', 'true');
  await expect(feed(page).locator('.sn-feed')).toHaveCount(1);
}

async function itemTimes(page: Page): Promise<number[]> {
  return feedItems(page).evaluateAll((items) => items.map((li) => Number((li as HTMLElement).dataset.at)));
}

test.describe('/snimka/ voices', () => {
  test('the feed fills newest on top while the replay plays', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:40&brzina=600');
    const before = Number(await feed(page).getAttribute('data-sn-feed-count'));
    expect(before).toBeGreaterThan(0);
    await page.locator('[data-sn="play"]').click();
    // Ten minutes a second: Monday 07:45 (Prvo jutro) and 08:34 (the new timetable) arrive within a few seconds.
    await expect.poll(async () => Number(await feed(page).getAttribute('data-sn-feed-count')), { timeout: 10_000 }).toBeGreaterThan(before + 1);
    await page.locator('[data-sn="play"]').click();
    const times = await itemTimes(page);
    expect(times.length).toBeGreaterThan(2);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeLessThanOrEqual(times[i - 1]!);
    await expect(feedItems(page).first().locator('.sn-feed-kind')).not.toHaveText('');
    await expect(feed(page).locator('[data-id="event:prvo-jutro"]')).toHaveCount(1);
  });

  test('a click on the 228 headline seeks to its minute and makes the line the subject; Sve teme clears it', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-30T12:00&brzina=600');
    const headline = feed(page).locator('[data-id="news:v1"]');
    await expect(headline.locator('.sn-feed-headline a')).toHaveAttribute('rel', 'noopener noreferrer');
    await headline.locator('.sn-feed-kind').click();
    await expect(feed(page)).toHaveAttribute('data-sn-feed-subject', 'route:228');
    await expect(page).toHaveURL(/[?&]t=2026-09-29T10:30(?:&|$)/);
    await expect(page).toHaveURL(/[?&]linija=228(?:&|$)/);
    await expect(feed(page).locator('.sn-feed-filter-text')).toHaveText('Tema: Linija 228');
    await expect(feedItems(page)).toHaveCount(2);
    await feed(page).getByRole('button', { name: 'Sve teme' }).click();
    await expect(feed(page)).toHaveAttribute('data-sn-feed-subject', '');
    await expect(feed(page).locator('.sn-feed-filter')).toBeHidden();
    await expect(page).not.toHaveURL(/linija=/);
    expect(await feedItems(page).count()).toBeGreaterThan(2);
  });

  test('the subtitle marks the record inside a run and today\'s rules between runs', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:40&brzina=600');
    await expect(subtitle(page)).toHaveAttribute('data-sn-sub-source', 'replayed');
    await expect(subtitle(page).locator('.sn-sub-mark')).toHaveText('Današnja pravila');
    await expect(subtitle(page).locator('.sn-sub-kicker')).toHaveText('Zaslon bi rekao');
    await expect(subtitle(page)).not.toHaveAttribute('aria-live', /.+/);
    const mark = subtitle(page).locator('.sn-sub-mark');
    await mark.focus();
    await expect(subtitle(page).locator('.sn-sub-note')).toBeVisible();
    await expect(subtitle(page).locator('.sn-sub-note')).toContainText('izračunana naknadno');
    await open(page, '/snimka/?t=2026-09-28T07:50&brzina=600');
    await expect(subtitle(page)).toHaveAttribute('data-sn-sub-source', 'observed');
    await expect(subtitle(page).locator('.sn-sub-mark')).toHaveText('Zapis');
    await expect(subtitle(page).locator('.sn-sub-text')).toHaveText('Tramvaj 6 prema Črnomercu polazi u 07:52 po voznom redu.');
  });
});
