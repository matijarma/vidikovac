// F2: the lightweight promise, in a real browser (R-F3, R-F4, R-L4).
// F5/R-F8: the lightweight list actually shows the lines it counts.
//
// docs/prijava/prijedlog-projekta.md §1.10 files a measurable lightweight mode;
// test/app/budget.test.ts measures its build graph. This spec watches the wire
// and the layout of the locked kiosk at 1920 by 1080 with `?lagano=1`, the
// way a donated laptop would load it:
//
//   - no request for a font file or the fonts stylesheet, and no @font-face
//     declared in the page at all (R-F3: the system stack is the typography);
//   - no request for the network artefact (R-L4);
//   - no <canvas> anywhere (R-L2);
//   - the pairing code inside the viewport with nothing to scroll -- a screen
//     nobody touches must show the code without help;
//   - the code's remaining-time bar is a visible bar with a box of its own,
//     never a hairline (R-F4);
//   - with the teaser stubbed to place vehicles in the box, the lines board
//     in the map column actually has rows (R-F8) rather than the production
//     defect it once printed ("Trenutačno nema stavki." under a nonzero
//     count), and those rows never overflow the board or the stage.
//
// The screenshot lands in test-results/kiosk-lagano.png.
import { expect, test, type Page, type Route } from '@playwright/test';
import { APP_URL, provisionKiosk } from './helpers';

const KIOSK = { width: 1920, height: 1080 };
const SHOTS_DIR = 'test-results';
const MIN_METER_HEIGHT_PX = 2;

async function expectBoardFits(page: Page): Promise<void> {
  // One browser-frame measurement. Separate boundingBox calls can resolve
  // handles on opposite sides of a legitimate source/metadata reconciliation.
  const box = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('[data-testid=kiosk-live] [data-testid=kiosk-lines]');
    const stage = document.querySelector<HTMLElement>('[data-testid=kiosk-stage]');
    if (!list || !stage) return null;
    const rect = list.getBoundingClientRect();
    return { width: rect.width, height: rect.height, bottom: rect.bottom, stageBottom: stage.getBoundingClientRect().bottom, overflow: list.scrollHeight - list.clientHeight };
  });
  expect(box, 'the visible board and stage must both exist').not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);
  expect(box!.bottom, 'the board stays inside the stage, never over the safety strip').toBeLessThanOrEqual(box!.stageBottom + 0.5);
  expect(box!.overflow, 'the board never overflows its box').toBeLessThanOrEqual(1);
}

const FONT_REQUEST = /\.(woff2?|ttf|otf)(\?|$)|\/assets\/fonts-/;
const NETWORK_ARTEFACT = /zet-network\.json/;

// Trg bana Jelačića -- motion/schematic.ts's own DEFAULT_CROP centre and
// R-P1's own teaser-box centre, so a pin here sits inside the locked
// kiosk's crop without any real track geometry (the lightweight path never
// loads the geometry file that would supply one, R-L4).
const CENTRE_LON = 15.9769;
const CENTRE_LAT = 45.813;

function vehiclePin(id: string, routeId: string) {
  return {
    id: `vehicle:${id}`,
    module: 'zet-rt',
    kind: 'vehicle',
    tier: 'open',
    title: routeId,
    geo: { type: 'Point', coordinates: [CENTRE_LON, CENTRE_LAT] },
    data: { routeId, routeType: 0 },
  };
}

function routeSummary(routeId: string, medianDelaySeconds: number) {
  return {
    id: `route:${routeId}`,
    module: 'zet-rt',
    kind: 'vehicle',
    tier: 'open',
    title: `Linija ${routeId}`,
    data: { routeId, routeShortName: routeId, medianDelaySeconds, vehicles: 1 },
  };
}

/** Fulfils `/api/teaser` with one fixed `zet-rt` module carrying two tram
 *  pins inside the box, so the lightweight list has real routes to show
 *  instead of depending on whatever the real ZET feed happens to run at
 *  test time. */
async function stubTeaserWithVehicles(page: Page): Promise<void> {
  const zet = {
    module: 'zet-rt',
    tier: 'open',
    status: 'live',
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: new Date().toISOString(),
    attribution: {
      text: 'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669',
      url: 'https://www.zet.hr/gtfs-rt-protobuf',
      licence: 'Otvorena dozvola',
    },
    items: [vehiclePin('e2e-lagano-1', '6'), vehiclePin('e2e-lagano-2', '11'), routeSummary('6', 120), routeSummary('11', 0)],
  };
  await page.route('**/api/teaser', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modules: [zet] }) });
  });
}

test.describe('the lightweight kiosk at 1920 by 1080 (?lagano=1)', () => {
  test('loads no webfont and no network artefact, draws no canvas, and lays the code and its bar out -- screenshot saved', async ({ page, request }) => {
    const requested: string[] = [];
    page.on('request', (req) => requested.push(req.url()));

    const { kioskUrl } = await provisionKiosk(request, APP_URL);
    await page.setViewportSize(KIOSK);
    await page.goto(kioskUrl.replace('#', '?lagano=1#'));
    await expect(page.getByTestId('pair-code')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid=kiosk-live] [data-testid=kiosk-lines]')).toBeAttached();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${SHOTS_DIR}/kiosk-lagano.png`, fullPage: false });

    // The wire (R-F3, R-L4).
    expect(requested.filter((u) => FONT_REQUEST.test(u)), 'no font file or fonts stylesheet on the lightweight wire').toEqual([]);
    expect(requested.filter((u) => NETWORK_ARTEFACT.test(u)), 'the network artefact is never fetched in lightweight mode').toEqual([]);
    const fontFaces = await page.evaluate(() => document.fonts.size);
    expect(fontFaces, 'no @font-face is declared on the lightweight page').toBe(0);
    expect(await page.evaluate(() => document.documentElement.dataset.lagano)).toBe('1');

    // The DOM (R-L2).
    expect(await page.locator('canvas').count(), 'no canvas of any kind on a lightweight page').toBe(0);

    // The layout (R-F4). The code is inside the viewport and the page has
    // nothing to scroll: what the screen shows is the whole page.
    const code = await page.getByTestId('pair-code').boundingBox();
    expect(code).not.toBeNull();
    expect(code!.y, 'the code starts inside the viewport').toBeGreaterThanOrEqual(0);
    expect(code!.y + code!.height, 'the code ends inside the viewport').toBeLessThanOrEqual(KIOSK.height);
    expect(code!.x + code!.width, 'the code ends inside the viewport').toBeLessThanOrEqual(KIOSK.width);
    const scroll = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      width: document.documentElement.scrollWidth,
      top: window.scrollY,
    }));
    expect(scroll.top).toBe(0);
    expect(scroll.height, 'nothing below the fold').toBeLessThanOrEqual(KIOSK.height);
    expect(scroll.width, 'nothing past the right edge').toBeLessThanOrEqual(KIOSK.width);

    const bar = await page.locator('[data-testid=code-progress] .k-progress-bar').first().boundingBox();
    expect(bar, 'the remaining-time bar has a box').not.toBeNull();
    expect(bar!.height, `the bar is taller than ${MIN_METER_HEIGHT_PX} px`).toBeGreaterThan(MIN_METER_HEIGHT_PX);
    const track = await page.getByTestId('code-progress').boundingBox();
    expect(track).not.toBeNull();
    expect(Math.abs(bar!.height - track!.height), 'the bar fills the track top to bottom').toBeLessThan(1);
  });

  test('R-F8: with vehicles in the box, the lightweight lines board actually shows the lines it counts, inside its own box', async ({ page, request }) => {
    await stubTeaserWithVehicles(page);
    const { kioskUrl } = await provisionKiosk(request, APP_URL);
    await page.setViewportSize(KIOSK);
    await page.goto(kioskUrl.replace('#', '?lagano=1#'));
    await expect(page.getByTestId('pair-code')).toBeVisible({ timeout: 30_000 });

    const list = page.locator('[data-testid=kiosk-live] [data-testid=kiosk-lines]');
    await expect(list).toBeAttached();
    // The production defect this task fixes: the legend counted vehicles
    // while the list under it stayed on "Trenutačno nema stavki." -- so the
    // list must actually carry a row, not merely exist.
    await expect(list.locator('li.k-line')).not.toHaveCount(0);
    await expect(list.locator('li.k-line').first()).toBeVisible();
    expect(await page.locator('canvas').count(), 'still no canvas on the lightweight path').toBe(0);

    await expectBoardFits(page);
  });

  // R-V1: "at ten rows of 24 px with 8 px spacing that is 320 px, inside the
  // roughly 380 px available" -- a number that was never measured in a real
  // engine (the same category of gap that produced the original R-V1
  // production incident). This puts eleven routes in the box -- the same
  // "ten rows + još 1 linija" scenario schematic-view.test.ts already proves
  // in jsdom -- through a real Chromium layout, so the cap's arithmetic is
  // checked against a real box model (fonts, borders, line-height) rather
  // than assumed to add up.
  test('R-F8/R-V1: eleven routes in the box render ten rows plus "još 1 linija", still inside the board', async ({ page, request }) => {
    const routeIds = Array.from({ length: 11 }, (_, i) => String(i + 1));
    const zet = {
      module: 'zet-rt',
      tier: 'open',
      status: 'live',
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: new Date().toISOString(),
      attribution: {
        text: 'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669',
        url: 'https://www.zet.hr/gtfs-rt-protobuf',
        licence: 'Otvorena dozvola',
      },
      items: [...routeIds.map((id) => vehiclePin(`e2e-lagano-many-${id}`, id)), ...routeIds.map((id) => routeSummary(id, 0))],
    };
    await page.route('**/api/teaser', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modules: [zet] }) });
    });

    const { kioskUrl } = await provisionKiosk(request, APP_URL);
    await page.setViewportSize(KIOSK);
    await page.goto(kioskUrl.replace('#', '?lagano=1#'));
    await expect(page.getByTestId('pair-code')).toBeVisible({ timeout: 30_000 });

    const list = page.locator('[data-testid=kiosk-live] [data-testid=kiosk-lines]');
    await expect(list).toBeAttached();
    // Eleven distinct routes in the box, ten shown plus the overflow row --
    // the count and the list agree (R-F8's own words), proven here in the
    // real DOM, not just jsdom.
    await expect(list.locator('li.k-line')).toHaveCount(10);
    await expect(list.locator('.k-line-more')).toHaveText('još 1 linija');

    await expectBoardFits(page);
  });
});
