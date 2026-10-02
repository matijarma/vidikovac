// /snimka/'s dossier in a browser (lane V5 of the v2 pass): the four question
// chips act on the instrument (q2 pauses, seeks to the third morning and sets
// line 17 as the subject, which the address carries); Brojke has five tiles,
// four when the series has no alerts column; Zamjene lists the stations that
// emptied first and "Pokaži na karti" seeks and sets the station; the
// downloads list the manifest's nine files with sizes; the live card reads
// the stubbed /api/teaser once in view (numbers on a normal summary, "nije
// dostupno" on a down one); Što se vidjelo carries nine cards with their
// method lines; no sideways scroll at 360 px; axe finds nothing serious in
// the dossier in either theme at 390 and 1366 px. Everything is answered from
// the synthetic v2 fixture (e2e/snimka-fixtures.ts). Zaslon and Tijek are
// their owners' specs now (V4: snimka-voices.spec.ts, V3: snimka-stage.spec.ts).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { SeriesFile } from '../shared/snimka';
import { emptiedFirst, MONDAY_FIVE_S } from '../app/src/snimka/alternatives';
import { buildBajs, buildSnimkaFixture, buildStations, buildWindowSeries, routeSnimka, stubTeaserDown, stubTeaserNormal, type SnimkaFixture } from './snimka-fixtures';

/** The fixture as served; `noAlerts` empties ZET's alerts and cancellations columns (the tile must then be left out). */
function fixture(o: { noAlerts?: boolean } = {}): SnimkaFixture {
  const f = buildSnimkaFixture();
  if (o.noAlerts) {
    const series = f.objects.get(f.manifest.files.series.path) as SeriesFile;
    series.feed.alerts = series.feed.alerts.map(() => null);
    series.feed.cancelledTrips = series.feed.cancelledTrips.map(() => null);
  }
  return f;
}

async function open(page: Page, query = '?t=2026-09-28T07:45&brzina=600', o: { noAlerts?: boolean; teaser?: 'normal' | 'down' } = {}): Promise<void> {
  await routeSnimka(page, fixture(o));
  await (o.teaser === 'down' ? stubTeaserDown(page) : stubTeaserNormal(page));
  await page.goto(`/snimka/${query}`);
  await expect(page.locator('[data-sn-mount="open"]')).toHaveAttribute('data-sn-open', 'ready');
}

/** Brings the lazy parts into view: the BAJS table and the live card. */
async function settle(page: Page): Promise<void> {
  await page.locator('#zamjene').scrollIntoViewIfNeeded();
  await expect(page.locator('#zamjene-bajs [aria-busy]')).toHaveCount(0);
  await page.locator('[data-sn-mount="live"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-sn-mount="live"]')).not.toHaveAttribute('data-sn-live', 'pending');
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

const tParam = (page: Page): string | null => new URL(page.url()).searchParams.get('t');

test.describe('/snimka/ dossier', () => {
  test('the four questions: q2 pauses, seeks to the third morning and sets line 17, with a link to the answer', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    // No time in the address: the replay plays from the first morning (S-4).
    await open(page, '?brzina=600');
    const chips = page.locator('[data-sn="questions"] button.sn-q-chip');
    await expect(chips).toHaveCount(4);
    await expect(page.locator('[data-sn="questions"] a.sn-q-to')).toHaveCount(4);
    await expect(page.locator('[data-sn="questions"] a.sn-q-to').nth(1)).toHaveAttribute('href', '#tijek');
    await chips.nth(1).click();
    await expect.poll(() => tParam(page)).toBe('2026-09-30T07:45');
    await expect(page).toHaveURL(/[?&]linija=17(&|$)/);
    // Paused: the address keeps its minute while the playing clock would have moved it within two seconds.
    await page.waitForTimeout(2500);
    expect(tParam(page)).toBe('2026-09-30T07:45');
    // The instrument is in view.
    const top = await page.locator('[data-sn-stage]').evaluate((el) => el.getBoundingClientRect().top);
    expect(Math.abs(top)).toBeLessThan(200);
  });

  test('Brojke has five tiles, and four when the series has no alerts column', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await open(page);
    await expect(page.locator('[data-sn="kpis"]')).not.toHaveAttribute('aria-busy', /.*/);
    await expect(page.locator('[data-sn="kpis"] .st-kpi')).toHaveCount(5);
    await expect(page.locator('[data-sn="kpi-silent"] .st-kpi-value')).toHaveText('65');
    await expect(page.locator('[data-sn="kpi-peak"] .st-kpi-sub')).toHaveText(/^pon 21\. 9\., običan dan u isto doba: \d+$/);
    await expect(page.locator('[data-sn="kpi-alerts"] .st-kpi-label')).toHaveText('upozorenja u ZET-ovim podacima');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await open(page, '?t=2026-09-28T07:45&brzina=600', { noAlerts: true });
    await expect(page.locator('[data-sn="kpis"] .st-kpi')).toHaveCount(4);
    await expect(page.locator('[data-sn="kpi-alerts"]')).toHaveCount(0);
  });

  test('Zamjene: the stations that emptied first, and "Pokaži na karti" seeks and sets the station', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await open(page);
    const expected = emptiedFirst(buildBajs(buildWindowSeries()), buildStations(), MONDAY_FIVE_S);
    await page.locator('#zamjene').scrollIntoViewIfNeeded();
    const rows = page.locator('#zamjene-bajs tbody tr');
    await expect(rows).toHaveCount(Math.min(10, expected.length));
    await rows.first().locator('button').click();
    const first = expected[0]!;
    const minute = new Date((first.emptySec + 7200) * 1000).toISOString().slice(0, 16);
    await expect.poll(() => tParam(page)).toBe(minute);
    await expect(page).toHaveURL(new RegExp(`[?&]stanica=${first.id}(&|$)`));
    await expect(page.locator('#zamjene-228 .st-col')).toHaveCount(48);
    for (const a of await page.locator('#zamjene-mediji a').all()) await expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('the downloads list the nine files of the manifest with their sizes and stable links', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await open(page);
    const items = page.locator('[data-sn="downloads"] li');
    await expect(items).toHaveCount(9);
    for (const text of await items.locator('a.sn-open-file').allTextContents()) expect(text).toMatch(/\((CSV|JSON|GEOJSON), \d+ KB\)$/);
    await expect(items.first().locator('a.sn-open-file')).toHaveAttribute('href', /^\/api\/snimka\/v2\/exports\/series\.[0-9a-f]{16}\.csv$/);
    await expect(items.first().locator('a.sn-open-latest')).toHaveAttribute('href', '/api/snimka/v2/exports/latest/series.csv');
    await expect(page.locator('[data-sn="repro"]')).toContainText('na predaji fixture');
  });

  test('the live card reads the summary once in view: numbers on a normal one', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    const reads: string[] = [];
    page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/teaser') reads.push(r.url()); });
    await open(page);
    const card = page.locator('[data-sn-mount="live"]');
    await expect(card.locator('.sn-live-kicker')).toHaveText('Uživo, nije snimka');
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute('data-sn-live', 'numbers');
    await expect(card.locator('.sn-live-line')).toHaveText('Sada: u pokretu 380, po voznom redu oko 400, stanje uobičajeno.');
    await expect(card.locator('a')).toHaveCount(2);
    await page.locator('#ukratko').scrollIntoViewIfNeeded();
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    expect(reads).toHaveLength(1);
  });

  test('the live card says the state is not available on a down summary', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await open(page, undefined, { teaser: 'down' });
    const card = page.locator('[data-sn-mount="live"]');
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute('data-sn-live', 'unavailable');
    await expect(card.locator('[data-sn="live-now"]')).toHaveText('Trenutačno stanje nije dostupno.');
  });

  test('Što se vidjelo carries nine cards, each with its method line', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await open(page);
    const cards = page.locator('[data-sn-mount="reckoning"] .st-card');
    await expect(cards).toHaveCount(9);
    await expect(page.locator('[data-card="sentences"]')).not.toHaveAttribute('aria-busy', /.*/);
    for (let i = 0; i < 9; i++) {
      await expect(cards.nth(i).locator('h3')).not.toHaveText('');
      await expect(cards.nth(i).locator('.st-method')).not.toHaveText('');
    }
    await expect(page.locator('[data-card="lines"] h3')).toHaveText('Linije s vozilom u pokretu');
    await expect(page.locator('[data-card="alerts"] h3')).toHaveText('Što je ZET rekao u podacima');
  });

  test('no sideways scroll at 360 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await open(page);
    await settle(page);
    expect(await horizontalOverflow(page)).toBe(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    for (const width of [390, 1366]) {
      test(`axe: no serious or critical violation in the dossier, ${scheme}, ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme });
        await open(page);
        await settle(page);
        await expect(page.locator('[data-card="sentences"]')).not.toHaveAttribute('aria-busy', /.*/);
        const results = await new AxeBuilder({ page })
          .include('#ukratko').include('#brojke').include('#zamjene').include('#vidjelo').include('#otvoreno')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      });
    }
  }
});
