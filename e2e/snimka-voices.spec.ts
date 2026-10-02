// The voices of /snimka/ in a browser, on the synthetic v2 dataset of
// snimka-fixtures.ts: the feed fills in time order while the replay plays, a
// click on the line-228 headline moves the replay to its minute and makes the
// line the subject, "Sve teme" clears it; the subtitle marks the record
// ("Zapis") inside a run and today's rules ("Današnja pravila") between runs;
// the Zaslon section shows five mornings with every picture loaded in view,
// and its source control switches the rows of the miniature.
import { expect, test, type Page } from '@playwright/test';
import { buildSnimkaFixture, routeSnimka } from './snimka-fixtures';

const fixture = buildSnimkaFixture();

const feed = (page: Page) => page.locator('[data-sn-slot="voices"]');
const feedItems = (page: Page) => page.locator('[data-sn-slot="voices"] .sn-feed-list:not(.sn-feed-older-list) > .sn-feed-item');
const subtitle = (page: Page) => page.locator('[data-sn-slot="subtitle"] .sn-sub');
const screen = (page: Page) => page.locator('[data-sn-mount="screen"]');

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

  test('Zaslon shows five mornings with every picture loaded in view, and its source control switches the rows', async ({ page }) => {
    await open(page, '/snimka/?t=2026-09-28T07:50&brzina=600');
    await page.locator('#zaslon').scrollIntoViewIfNeeded();
    await expect(screen(page)).toHaveAttribute('data-sn-screen-source', 'observed');
    const rows = screen(page).locator('.sn-mini .sn-mini-row');
    await expect(rows).toHaveCount(4);
    await screen(page).getByRole('button', { name: 'Današnja pravila' }).click();
    await expect(screen(page)).toHaveAttribute('data-sn-screen-source', 'replayed');
    await expect(screen(page).locator('.sn-mini')).toHaveAttribute('data-view', 'replayed');
    await expect(rows).toHaveCount(2);
    await expect(screen(page).locator('.sn-screen-note')).toBeVisible();
    await expect(screen(page).getByRole('button', { name: 'Današnja pravila' })).toHaveAttribute('aria-pressed', 'true');
    await screen(page).getByRole('button', { name: 'Zapis' }).click();
    await expect(rows).toHaveCount(4);

    const mornings = screen(page).locator('.sn-quartet-item');
    await expect(mornings).toHaveCount(5);
    await expect(mornings.locator('figcaption')).toHaveCount(5);
    await expect(mornings.nth(4).locator('figcaption')).toContainText('Drugo uobičajeno jutro.');
    await page.locator('.sn-quartet').scrollIntoViewIfNeeded();
    await expect(mornings.first().locator('.sn-screen-replayed-text')).toHaveText('U pokretu su 2 vozila, po voznom redu oko 230.');
    const images = screen(page).locator('img');
    expect(await images.count()).toBeGreaterThanOrEqual(3);
    await expect.poll(() => images.evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
    for (const img of await screen(page).locator('.sn-quartet-item img').all()) {
      await expect(img).toHaveAttribute('loading', 'eager');
      await expect(img).toHaveAttribute('fetchpriority', 'low');
    }
  });
});
