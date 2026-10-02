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
import { emptyHoursVsThu } from '../app/src/snimka/alternatives';
import { heroTiles } from '../app/src/snimka/reckoning';
import { seekTime } from '../app/src/snimka/strip';
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

// ---- lane W4a (v3): Što snimka pokazuje and Tijek --------------------------------------------------------------

const minuteOf = (sec: number): string => new Date((sec + 7200) * 1000).toISOString().slice(0, 16);
const stageTop = (page: Page): Promise<number> => page.locator('[data-sn-stage]').evaluate((el) => el.getBoundingClientRect().top);

test.describe('Pokazuje', () => {
  test('three tiles; a tile pauses, seeks to its moment and brings the instrument in under the sticky nav', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await open(page);
    await expect(page.locator('[data-sn="kpis"]')).not.toHaveAttribute('aria-busy', /.*/);
    const tiles = page.locator('#pokazuje [data-sn="kpis"] .st-kpi');
    await expect(tiles).toHaveCount(3);
    await expect(page.locator('[data-sn="kpi-peak"], [data-sn="kpi-alerts"]')).toHaveCount(0);
    const expected = heroTiles(buildWindowSeries());
    await expect(page.locator('#pokazuje .sn-kpi-button')).toHaveCount(3);
    await expect(page.locator('[data-sn="kpi-silent"] .st-kpi-value')).toHaveText(expected[0]!.value);
    await expect(page.locator('[data-sn="kpi-bikes"] .st-kpi-sub')).toHaveText(expected[1]!.sub!);
    for (const [i, key] of (['silent', 'bikes', 'return'] as const).entries()) {
      await page.locator('#pokazuje').scrollIntoViewIfNeeded();
      await page.locator(`[data-sn="kpi-${key}"] .sn-kpi-button`).click();
      await expect.poll(() => tParam(page)).toBe(minuteOf(expected[i]!.atSec!));
      await expect.poll(() => stageTop(page)).toBeGreaterThanOrEqual(61);
      expect(await stageTop(page)).toBeLessThan(200);
    }
    // Paused: the address keeps its minute.
    await page.waitForTimeout(1500);
    expect(tParam(page)).toBe(minuteOf(expected[2]!.atSec!));
  });

  test('six cards, each with its method line', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await open(page);
    const cards = page.locator('[data-sn-mount="reckoning"] .st-card');
    await expect(cards).toHaveCount(6);
    await expect(cards.locator('h3')).toHaveText(['Tri dana gotovo bez vozila', 'Pet jutara u 07:45', 'Što je vozilo', 'Broj koji nije bio točan', 'Što je ZET javio u podacima', 'Povratak']);
    for (let i = 0; i < 6; i++) await expect(cards.nth(i).locator('.st-method')).not.toHaveText('');
    await expect(page.locator('[data-card="zet"] .sn-card-lines li').first()).toHaveText(/: 0 upozorenja i 0 otkazanih vožnji$/);
  });

  test('the block: a ranked table, "Pokaži na karti" seeks and sets the station; line 228; six press links', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await open(page);
    const expected = emptyHoursVsThu(buildBajs(buildWindowSeries()), buildStations());
    await page.locator('#zamjene-bajs').scrollIntoViewIfNeeded();
    const rows = page.locator('#zamjene-bajs tbody tr');
    await expect(rows).toHaveCount(Math.min(10, expected.length));
    await expect(page.locator('#zamjene-bajs thead th')).toHaveCount(4);
    await rows.first().locator('.sn-alt-show').click();
    await expect.poll(() => tParam(page)).toBe(minuteOf(expected[0]!.atSec));
    await expect(page).toHaveURL(new RegExp(`[?&]stanica=${expected[0]!.id}(&|$)`));
    await expect.poll(() => stageTop(page)).toBeGreaterThanOrEqual(61);
    await expect(page.locator('#zamjene-228 path')).toHaveCount(2);
    await expect(page.locator('#zamjene-vlak')).toHaveCount(0);
    const links = page.locator('#zamjene-mediji a');
    expect(await links.count()).toBeLessThanOrEqual(6);
    for (const a of await links.all()) await expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('on a phone: the name is the button and nothing in the section is clipped', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await open(page);
    await page.locator('#zamjene-bajs').scrollIntoViewIfNeeded();
    await expect(page.locator('#zamjene-bajs [aria-busy]')).toHaveCount(0);
    await expect(page.locator('#zamjene-bajs tbody tr').first().locator('.sn-alt-name-button')).toBeVisible();
    await expect(page.locator('#zamjene-bajs tbody tr').first().locator('.sn-alt-show')).toBeHidden();
    for (const mount of ['brojke', 'reckoning', 'alternatives']) {
      const [sw, cw] = await page.locator(`[data-sn-mount="${mount}"]`).evaluate((el) => [el.scrollWidth, el.clientWidth]);
      expect(sw, mount).toBeLessThanOrEqual(cw);
    }
  });
});

test.describe('Tijek', () => {
  test('three charts; a click on the fleet chart pauses and seeks', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await open(page);
    const strip = page.locator('[data-sn-mount="strip"]');
    await expect(strip.locator('.sn-panel')).toHaveCount(3);
    await expect(strip.locator('.sn-panel h3')).toHaveText(['Vozila u pokretu', 'Prazne stanice BAJS-a', 'Sve linije, svaki sat']);
    await expect(strip.locator('[data-sn-heatmap]')).toHaveCount(1);
    await expect(strip.locator('.sn-panel > .st-table')).toHaveCount(2);
    const plot = strip.locator('[data-plot="fleet"]');
    await plot.scrollIntoViewIfNeeded();
    const box = (await plot.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    const fraction = 0.5;
    const target = seekTime(fraction, Date.UTC(2026, 8, 27, 18, 0), Date.UTC(2026, 9, 2, 10, 0));
    await expect.poll(() => tParam(page)).not.toBe('2026-09-28T07:45');
    const t = tParam(page)!;
    const got = Date.parse(`${t}:00Z`) - 7_200_000;
    expect(Math.abs(got - target)).toBeLessThanOrEqual(15 * 60_000);
    await expect(strip.locator('.sn-strip-readout')).toContainText('u pokretu');
  });

  test('no horizontal overflow at 360, and the heatmap fits the phone width', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await open(page);
    await page.locator('#zamjene-bajs').scrollIntoViewIfNeeded();
    await expect(page.locator('#zamjene-bajs [aria-busy]')).toHaveCount(0);
    await page.locator('#tijek').scrollIntoViewIfNeeded();
    expect(await horizontalOverflow(page)).toBe(0);
    const [sw, cw] = await page.locator('[data-sn-mount="strip"]').evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(sw).toBeLessThanOrEqual(cw);
    const fit = await page.locator('[data-sn-heatmap] .sn-hm-scroll').first().evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(fit[0]).toBeLessThanOrEqual(fit[1]!);
    // 16 px rows on a phone; the row labels are text (the table twin carries the rows as targets).
    const rowH = await page.locator('[data-sn-heatmap] .sn-hm-label').first().evaluate((el) => el.getBoundingClientRect().height);
    expect(Math.round(rowH)).toBe(16);
    await expect(page.locator('[data-sn-heatmap] .sn-hm-row').first()).toBeHidden();
  });
});
