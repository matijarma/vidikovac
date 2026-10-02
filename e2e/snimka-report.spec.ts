// /snimka/'s dossier in a browser (lane V5 of the v2 pass; v3 lanes W4a and
// W4b each own their describe blocks): Brojke has five tiles,
// four when the series has no alerts column; Zamjene lists the stations that
// emptied first and "Pokaži na karti" seeks and sets the station; Što se vidjelo carries nine cards with their
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

// ---- lane W4b: Zaslon, Podaci i izvori, I danas ------------------------------------------------

/** The page at a width, loaded from the fixture with the teaser stub, scrolled to a section. */
async function openAt(page: Page, width: number, o: { teaser?: 'normal' | 'down'; query?: string } = {}): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await routeSnimka(page, buildSnimkaFixture());
  await (o.teaser === 'down' ? stubTeaserDown(page) : stubTeaserNormal(page));
  await page.goto(`/snimka/${o.query ?? '?t=2026-09-28T07:50&brzina=600'}`);
  await expect(page.locator('[data-sn-mount="open"]')).toHaveAttribute('data-sn-open', 'ready');
}

/** Elements inside `selector` wider than it: content clipped by the slot's overflow-x: clip. */
async function overflowOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((el) => el.scrollWidth - el.clientWidth);
}

async function axeClean(page: Page, include: string[]): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
  for (const sel of include) builder = builder.include(sel);
  const results = await builder.analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test.describe('Zaslon', () => {
  test('no toggle; the two lines under the miniature; the photograph inside the run; five mornings in a table', async ({ page }) => {
    await openAt(page, 1366);
    const screen = page.locator('[data-sn-mount="screen"]');
    await screen.scrollIntoViewIfNeeded();
    await expect(screen.locator('button')).toHaveCount(0);
    await expect(screen.locator('.sn-mini')).toHaveAttribute('data-view', 'reading');
    await expect(screen.locator('.sn-screen-lines dt')).toHaveText(['Na zaslonu je pisalo:', /^Po današnjim pravilima pisalo bi:/]);
    await expect(screen.locator('[data-sn="screen-wrote"]')).toHaveText('Tramvaj 6 prema Črnomercu polazi u 07:52 po voznom redu.');
    await expect(screen.locator('[data-sn="screen-would"]')).not.toHaveAttribute('aria-busy', /.*/);
    await expect(screen.locator('[data-sn="screen-capture"] a')).toHaveAttribute('href', /\/api\/snimka\/v2\/captures\//);
    const rows = screen.locator('.sn-screen-table tbody tr');
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0).locator('.sn-screen-said')).toHaveText('Tramvaj 6 prema Črnomercu polazi u 07:52 po voznom redu.');
    await expect(rows.nth(2).locator('.sn-screen-said')).toHaveText('U pokretu su 3 vozila, po voznom redu oko 230.');
    await expect(rows.nth(1).locator('[data-sn="morning-wrote"]')).toHaveText('U ovoj minuti zaslon nije snimljen.');
    await expect(rows.nth(0).locator('[data-sn="morning-would"]')).toHaveText('U pokretu su 2 vozila, po voznom redu oko 230.');
  });
  test('between runs: the board, "nije snimljen" and no photograph', async ({ page }) => {
    await openAt(page, 1366, { query: '?t=2026-09-28T12:00&brzina=600' });
    const screen = page.locator('[data-sn-mount="screen"]');
    await expect(screen.locator('.sn-mini')).toHaveAttribute('data-view', 'board');
    await expect(screen.locator('[data-sn="screen-wrote"]')).toHaveText('U ovoj minuti zaslon nije snimljen.');
    await expect(screen.locator('[data-sn="screen-capture"]')).toBeHidden();
  });
});

test.describe('Podaci', () => {
  test('three sentences, three primary downloads and a disclosure with six, each one alias link', async ({ page }) => {
    await openAt(page, 1366);
    const open = page.locator('[data-sn-mount="open"]');
    await expect(open.locator('table')).toHaveCount(0);
    await expect(open.locator('.sn-open-says li')).toHaveCount(3);
    await expect(open.locator('[data-sn="downloads"] li a')).toHaveCount(3);
    const details = open.locator('details.sn-open-others');
    await expect(details.locator('summary')).toHaveText('Ostale datoteke (6)');
    await expect(details.locator('[data-sn="downloads-other"] li a')).toHaveCount(6);
    for (const a of await open.locator('.sn-open-item a').all()) await expect(a).toHaveAttribute('href', /^\/api\/snimka\/v2\/exports\/latest\/[a-z0-9-]+\.(csv|json|geojson)$/);
    for (const t of await open.locator('.sn-open-size').allTextContents()) expect(t).toMatch(/^(CSV|JSON|GeoJSON), \d+ kB$/);
    const sources = page.locator('.sn-sources-block');
    await expect(sources.locator('dl.sn-attr dt')).toHaveCount(8);
    await expect(sources.locator('[data-source="zet"] q[lang="en"]')).toHaveCount(1);
    await expect(page.locator('[data-sn="notes"] details')).toHaveAttribute('open', '');
    await expect(page.locator('[data-sn="notes"] summary')).toHaveText('Napomene uz podatke (5)');
  });
  test('at 390 px nothing is wider than its slot, and the notes start closed', async ({ page }) => {
    await openAt(page, 390);
    await page.locator('#podaci').scrollIntoViewIfNeeded();
    await page.locator('details.sn-open-others summary').click();
    expect(await overflowOf(page, '[data-sn-mount="open"]')).toBeLessThanOrEqual(0);
    expect(await overflowOf(page, '[data-sn="attribution"]')).toBeLessThanOrEqual(0);
    expect(await overflowOf(page, '[data-sn-mount="screen"]')).toBeLessThanOrEqual(0);
    await expect(page.locator('[data-sn="notes"] details')).not.toHaveAttribute('open', /.*/);
    for (const a of await page.locator('[data-sn-mount="open"] a, [data-sn="attribution"] a').all()) {
      const box = await a.boundingBox();
      expect(box!.height, await a.textContent() ?? '').toBeGreaterThanOrEqual(44);
    }
    // The section heights at 390 for the report (lane W4b).
    const heights = await page.evaluate(() => Object.fromEntries(['zaslon', 'podaci', 'danas'].map((id) => [id, Math.round(document.getElementById(id)!.getBoundingClientRect().height)])));
    test.info().annotations.push({ type: 'heights-390', description: JSON.stringify(heights) });
  });
});

test.describe('Danas', () => {
  test('both lines on a normal summary, read once in view', async ({ page }) => {
    const reads: string[] = [];
    page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/teaser') reads.push(r.url()); });
    await openAt(page, 1366);
    const band = page.locator('[data-sn-mount="live"]');
    await expect(band.locator('.sn-live-kicker')).toHaveText('uživo');
    await band.scrollIntoViewIfNeeded();
    await expect(band).toHaveAttribute('data-sn-live', 'numbers');
    await expect(band.locator('.sn-live-line')).toHaveText(/^Sada, u \d\d:\d\d: u pokretu 380 vozila, po voznom redu 400\. Uobičaj(eno jutro|en dan|ena večer|ena noć)\.$/u);
    await expect(band.locator('[data-sn="live-then"]')).toHaveText(/^U ponedjeljak 28\. 9\. u \d\d:\d\d: (u pokretu \d+|bez podatka)\.$/u);
    await expect(band.locator('a')).toHaveText(['Aplikacija uživo →', 'Statistika usluge →']);
    await page.locator('#ukratko').scrollIntoViewIfNeeded();
    await band.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    expect(reads).toHaveLength(1);
  });
  test('"nije dostupno" on a down summary', async ({ page }) => {
    await openAt(page, 1366, { teaser: 'down' });
    const band = page.locator('[data-sn-mount="live"]');
    await band.scrollIntoViewIfNeeded();
    await expect(band).toHaveAttribute('data-sn-live', 'unavailable');
    await expect(band.locator('[data-sn="live-now"]')).toHaveText('Trenutačno stanje nije dostupno.');
  });
  for (const scheme of ['light', 'dark'] as const) {
    for (const width of [390, 1366]) {
      test(`axe: Zaslon, I danas and Podaci i izvori clean, ${scheme}, ${width} px`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await openAt(page, width);
        await page.locator('[data-sn-mount="live"]').scrollIntoViewIfNeeded();
        await expect(page.locator('[data-sn-mount="live"]')).not.toHaveAttribute('data-sn-live', 'pending');
        await page.locator('.sn-screen-table').scrollIntoViewIfNeeded();
        await expect(page.locator('.sn-screen-table tbody tr')).toHaveCount(5);
        await page.locator('details.sn-open-others summary').click();
        await axeClean(page, ['#danas', '#zaslon', '#podaci']);
      });
    }
  }
});
