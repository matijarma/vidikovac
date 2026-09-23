import { expect, test, type Page } from '@playwright/test';
import { APP_URL, E2E_STOP_ID, localContext, provisionKiosk, readPairing, unlockOnPhone } from './helpers';
import { installKioskFeedFixture, installWallFixture } from './experience-fixtures';

const sizes = [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1080, height: 1920 }];
const layers = ['grad-sada', 'u-pokretu', 'zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'kultura'] as const;

async function geometry(page: Page) {
  return page.evaluate(() => {
    const visible = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].filter(el => el.getBoundingClientRect().width > 0 && !el.hidden);
    const problems: string[] = [];
    for (const el of visible('.k-panel, .k-block, .k-block-body, .k-invite, .k-present-board, .k-main, .k-side, .k-head')) {
      if (el.scrollWidth > el.clientWidth + 1) problems.push(`${el.className}: horizontal ${el.scrollWidth}/${el.clientWidth}`);
      if (el.scrollHeight > el.clientHeight + 1) problems.push(`${el.className}: vertical ${el.scrollHeight}/${el.clientHeight}`);
    }
    for (const list of visible('.k-block-body .k-rows')) {
      const rows = [...list.querySelectorAll<HTMLElement>(':scope > .k-row')];
      if (rows.length && rows.every(row => row.hidden)) problems.push('a populated panel hides every useful row');
    }
    const qr = document.querySelector('[data-testid=kiosk-qr]')?.getBoundingClientRect();
    if (!qr || qr.width < 239 || qr.height < 239) problems.push('QR smaller than its 240px floor');
    if (document.documentElement.scrollWidth > innerWidth + 1) problems.push('page overflow');
    const stage = document.querySelector('.k-stage')!.getBoundingClientRect();
    const strip = document.querySelector('.k-strip')!.getBoundingClientRect();
    if (stage.bottom > strip.top + 1) problems.push('stage covers safety');
    const board = document.querySelector('.k-present-board')?.getBoundingClientRect();
    const map = document.querySelector('.k-present-local .k-map')?.getBoundingClientRect();
    if (board && map && map.height > 0 && board.top < map.bottom - 1) problems.push('board covers map');
    return problems;
  });
}

for (const size of sizes) for (const theme of ['light', 'dark'] as const) {
  test(`presented domains at ${size.width}×${size.height}, ${theme}: readable subjects, safety and invitation`, async ({ browser, request }) => {
    const kctx = await localContext(browser, { viewport: size, colorScheme: theme, locale: 'hr-HR' });
    const pctx = await localContext(browser, { viewport: { width: 1440, height: 900 }, locale: 'hr-HR' });
    try {
      const { kioskUrl } = await provisionKiosk(request, APP_URL, { stopId: E2E_STOP_ID });
      const kiosk = await kctx.newPage(), phone = await pctx.newPage();
      await Promise.all([installKioskFeedFixture(kiosk), installKioskFeedFixture(phone)]);
      await kiosk.addInitScript(theme => localStorage.setItem('vidikovac-theme', theme), theme);
      await kiosk.goto(kioskUrl);
      const { scanUrl } = await readPairing(kiosk, APP_URL);
      await unlockOnPhone(phone, scanUrl, '10 minuta');
      await expect(kiosk.getByTestId('kiosk-invitation')).toBeVisible();
      for (const layer of layers) {
        await phone.locator(`.ki-domains [data-layer="${layer}"]`).click();
        if (await phone.getByTestId('presentation-panel').count() === 0) await phone.getByTestId('screen-control').click();
        await phone.getByTestId('present-view').click();
        await expect(phone.getByTestId('presentation-feedback')).toContainText('Prikazano', { timeout: 20_000 });
        await expect(kiosk.getByTestId('kiosk-layer')).toHaveAttribute('data-layer', layer);
        await kiosk.evaluate(() => document.fonts.ready);
        await kiosk.waitForTimeout(300);
        expect(await geometry(kiosk), layer).toEqual([]);
        await kiosk.screenshot({ path: `test-results/kiosk-${size.width}-${theme}-${layer}.png` });
      }
      await phone.getByTestId('stop-presentation').click();
      await expect(kiosk.getByTestId('kiosk-invitation')).toBeVisible();
      // The public wall offers no control but the brand and the QR ([O-43], principle 8, trust row
      // d-controls-invitation): its safety verdict is text, and the basics stay on the handheld.
      await expect(kiosk.getByTestId('kiosk-essentials-open')).toHaveCount(0);
      await expect(kiosk.getByTestId('strip-verdict')).toBeVisible();
    } finally { await Promise.all([kctx.close(), pctx.close()]); }
  });
}

// The wall of 22 September says freshness by selection, never by caption
// (brief §10, principle 5): a stale ZET feed leaves the place's timetable
// departures on the list as grey clock times, at most three, and no row, card
// or head names a fetch time or the word "zastarjelo". The fixture board's trip
// ids are no tracked vehicle's, so not one row may claim a live countdown.
const CAPTION_RE = /zastarjel|Dohvaćeno|nepotvrđen|nije provjera|Obuhvat|registra|Čekamo/i;
test('stale transit keeps its timetable rows through basics and never captions them', async ({ page, request }) => {
  await page.setViewportSize(sizes[0]!);
  await installKioskFeedFixture(page, 'stale');
  await installWallFixture(page);
  const { kioskUrl } = await provisionKiosk(request, APP_URL, { stopId: E2E_STOP_ID });
  await page.goto(kioskUrl);
  const departures = page.locator('[data-testid=nearby] .nearby-row[data-kind=departure]');
  const assertRows = async () => {
    await expect.poll(() => departures.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    expect(await departures.count()).toBeLessThanOrEqual(3);
    await expect(page.locator('[data-testid=nearby] .nearby-row[data-live]')).toHaveCount(0);
    for (const when of await departures.locator('.nearby-when').allInnerTexts()) expect(when.trim()).toMatch(/^\d{2}:\d{2}$/);
    for (const region of ['nearby', 'kiosk-invite']) await expect(page.getByTestId(region)).not.toContainText(CAPTION_RE);
  };
  await assertRows();
  // The public wall has no basics control any more ([O-43], principle 8): the verdict is text, so the rows are
  // read again after one more teaser poll (REFRESH_MS 20 s) of the stale feed instead of after a basics round trip.
  await expect(page.getByTestId('kiosk-essentials-open')).toHaveCount(0);
  await expect(page.getByTestId('strip-verdict')).toBeVisible();
  await page.waitForTimeout(25_000);
  await expect(page.getByTestId('kiosk-invitation')).toBeVisible();
  await assertRows();
});
