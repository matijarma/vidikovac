// T11: the motion model, proven end to end. The wave-1 review found two of
// its own findings refuted only because nothing mounted the model yet
// ("nothing mounts the model until T9, which is a reason to re-run this
// review after wave 2, not to discount it" -- R-X1's closing paragraph).
// This file is that re-run: it proves, in a real browser against the real
// mounted surfaces, that the frame loop actually advances (motion/loop.ts's
// own `frames()`, exported for exactly this) and that a vehicle's drawn
// position is the model's own continuous estimate rather than a redrawn
// fix -- it moves between two frames 500 ms apart while the snapshot behind
// it has not changed, which is the observable shape of R-P2's rule: a
// reported position is evidence, never output.
//
// Every scenario mocks the one HTTP call the motion model's evidence comes
// through (`/api/teaser` for a locked kiosk, `/api/data/*` for a session) at
// the browser network layer, so the suite never depends on the real ZET
// feed being reachable, or on it happening to carry a moving vehicle at
// test time -- exactly the reachability gap the wave-1 review flagged, and
// exactly why R-X1 asked for this to be re-run once something actually
// mounts the model. Two fixes for the same vehicle id inside one response
// are enough to hand the model real fix-to-fix evidence (initVehicle() then
// applyFix(), model.ts's own two-step contract) from a single poll, so nothing
// here waits on a second real 20 s cycle for that.
import { devices, expect, test, type Page, type Route } from '@playwright/test';
import { APP_URL, health, provisionKiosk, readPairing, unlockOnPhone } from './helpers';

// Trg bana Jelačića -- motion/schematic.ts's own DEFAULT_CROP centre, so a
// fix here sits inside both the locked kiosk's crop and any session's
// whole-network crop without special-casing either.
const CENTRE_LON = 15.9769;
const CENTRE_LAT = 45.813;
// ~67 m north (1 degree latitude is ~111,320 m here): above DEAD_ZONE_M
// (15 m), so the model actually eases instead of sitting still; comfortably
// under DISCREPANCY_LIMIT_M (150 m), so it glides instead of snapping.
const MOVED_LAT = CENTRE_LAT + 0.0006;
// The two fixes are 5 s apart by their own `at`, not by wall clock: the
// free-plane branch (model.ts) eases over exactly that span starting the
// moment update() runs, so a sample 500 ms later is still mid-ease however
// long the mocked response itself took to arrive.
const FIX_INTERVAL_MS = 5000;
// Deliberately not a real ZET route id (those are '1'..'99'-shaped): this
// guarantees the vehicle never matches a real shape in the real network
// artefact (which the browser really does fetch, R-L4), so every scenario
// exercises the model's free-plane branch, not a live geometry match whose
// exact stop spacing this test cannot see and does not need to.
const ROUTE_ID = 'E2E6';

interface Fix {
  id: string;
  lon: number;
  lat: number;
  at: number;
  routeType?: number;
}

function vehicleItem(fix: Fix) {
  return {
    id: `vehicle:${fix.id}`,
    module: 'zet-rt',
    kind: 'vehicle',
    tier: 'open',
    title: 'Tramvaj E2E6',
    at: new Date(fix.at).toISOString(),
    geo: { type: 'Point', coordinates: [fix.lon, fix.lat] },
    data: {
      routeId: ROUTE_ID,
      ...(fix.routeType !== undefined ? { routeType: fix.routeType } : {}),
    },
  };
}

/**
 * A `zet-rt` ModuleSnapshot carrying two fixes for one vehicle id, in order:
 * model.update() folds an array of fixes in sequence, so the first entry
 * seeds initVehicle() and the second immediately runs applyFix() against
 * it -- real fix-to-fix speed and direction evidence from a single poll,
 * standing in for two real ones ~20 s apart. `routeType` is included only
 * when the caller wants the vehicle to pass a trams-only filter (R-P1's
 * locked-kiosk default); a session sees every type and does not need it.
 */
function zetSnapshot(vehicleId: string, routeType?: number) {
  const now = Date.now();
  const fixes: Fix[] = [
    { id: vehicleId, lon: CENTRE_LON, lat: CENTRE_LAT, at: now - FIX_INTERVAL_MS, routeType },
    { id: vehicleId, lon: CENTRE_LON, lat: MOVED_LAT, at: now, routeType },
  ];
  return {
    module: 'zet-rt',
    tier: 'open',
    status: 'live',
    fetchedAt: new Date(now).toISOString(),
    sourceUpdatedAt: new Date(now).toISOString(),
    attribution: {
      text: 'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669',
      url: 'https://www.zet.hr/gtfs-rt-protobuf',
      licence: 'Otvorena dozvola',
    },
    items: fixes.map(vehicleItem),
  };
}

function emptySnapshot(moduleId: string) {
  return {
    module: moduleId,
    tier: 'session',
    status: 'live',
    fetchedAt: new Date().toISOString(),
    attribution: { text: '', url: '', licence: '' },
    items: [],
  };
}

/** Fulfils `/api/teaser` (the locked kiosk's own open-tier poll) with a
 *  single `zet-rt` module every time it is asked, however many times that
 *  is -- the count is how a test proves "the snapshot behind these two
 *  frames never changed": across a sampled window it must read 1. */
async function stubTeaser(page: Page, snapshot: unknown): Promise<{ count(): number }> {
  let count = 0;
  await page.route('**/api/teaser', async (route: Route) => {
    count++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modules: [snapshot] }) });
  });
  return { count: () => count };
}

/** Fulfils every `/api/data/<module>` a session's dashboard asks for:
 *  `zet-rt` gets the real fixture, everything else an honest empty snapshot
 *  -- so the suite never depends on the real DHMZ/data.zagreb.hr upstreams
 *  the other layers would otherwise call through the real Worker. */
async function stubSessionData(page: Page, zetSnapshotValue: unknown): Promise<void> {
  await page.route('**/api/data/*', async (route: Route) => {
    const moduleId = new URL(route.request().url()).pathname.split('/').filter(Boolean).pop() ?? '';
    const body = moduleId === 'zet-rt' ? zetSnapshotValue : emptySnapshot(moduleId);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

/** Waits for the schematic's own loop to have drawn at least one frame --
 *  motion/loop.ts's `frames()`, written to `data-frames` by schematic-view.ts
 *  precisely so an end-to-end proof can read it instead of diffing pixels
 *  for "is it animating at all". */
async function waitForFrames(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return el !== null && el.dataset.frames !== undefined && el.dataset.frames !== '0';
    },
    selector,
    { timeout: 30_000 },
  );
}

function frames(page: Page, selector: string): Promise<number> {
  return page.$eval(selector, (el) => Number((el as HTMLElement).dataset.frames ?? '0'));
}

function canvasSnapshot(page: Page, selector: string): Promise<string> {
  return page.$eval(selector, (el) => (el as HTMLCanvasElement).toDataURL());
}

test.describe('the motion model, mounted end to end (T11)', () => {
  test('a locked kiosk: the frame counter advances, and a vehicle glides between two frames 500 ms apart on one unchanged snapshot', async ({
    page,
    request,
  }) => {
    const teaser = await stubTeaser(page, zetSnapshot('e2e-kiosk-1', 0));
    const { kioskUrl } = await provisionKiosk(request, APP_URL);
    await page.goto(kioskUrl);
    await expect(page.getByTestId('pair-code')).toBeVisible({ timeout: 30_000 });

    const schematicSel = '[data-testid=kiosk-live] [data-testid=schematic]';
    const vehiclesCanvasSel = '[data-testid=kiosk-live] [data-testid=schematic-vehicles]';
    await waitForFrames(page, schematicSel);

    // The frame counter: exported by loop.ts for exactly this proof, rather
    // than diffing pixels to answer "is anything being drawn at all".
    const f1 = await frames(page, schematicSel);
    await page.waitForTimeout(300);
    const f2 = await frames(page, schematicSel);
    expect(f2, 'the frame counter must advance while a vehicle is easing onto a new fix').toBeGreaterThan(f1);

    // The position: two canvas snapshots 500 ms apart must differ, while the
    // teaser endpoint answered exactly once across the whole window --
    // the observable form of R-P2 (a reported position is evidence, never
    // output). Only the model's own continuous convergence between polls
    // can explain two different frames drawn from one unchanged snapshot.
    const before = await canvasSnapshot(page, vehiclesCanvasSel);
    await page.waitForTimeout(500);
    const after = await canvasSnapshot(page, vehiclesCanvasSel);
    expect(after, 'the drawn position must move between two frames 500 ms apart').not.toBe(before);
    expect(teaser.count(), 'the teaser snapshot must not have changed during the sampled window').toBe(1);
  });

  test('a locked kiosk under prefers-reduced-motion: the frame counter stops advancing beyond one step a second', async ({
    page,
    request,
  }) => {
    await stubTeaser(page, zetSnapshot('e2e-kiosk-reduced', 0));
    // Read at script-load time by kiosk-entry.ts's own matchMedia call, so
    // this must be set before the page (and its first script) ever loads.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { kioskUrl } = await provisionKiosk(request, APP_URL);
    await page.goto(kioskUrl);
    await expect(page.getByTestId('pair-code')).toBeVisible({ timeout: 30_000 });

    const schematicSel = '[data-testid=kiosk-live] [data-testid=schematic]';
    await waitForFrames(page, schematicSel);
    const f1 = await frames(page, schematicSel);
    await page.waitForTimeout(3200);
    const f2 = await frames(page, schematicSel);
    // loop.ts's REDUCED_MOTION_INTERVAL_MS is 1000 ms; a full-rate loop would
    // have drawn on the order of 190 frames over 3.2 s, so a handful proves
    // the once-a-second cap rather than merely "it still moves eventually".
    expect(f2 - f1, 'reduced motion must draw roughly once a second, not once a frame').toBeGreaterThanOrEqual(1);
    expect(f2 - f1, 'reduced motion must not advance anywhere near full frame rate').toBeLessThanOrEqual(5);
  });

  test('a session on /d: the frame counter advances, the tap card names the line, and full-screen keeps the meander visible', async ({
    browser,
    request,
  }) => {
    const h = await health(request, APP_URL);
    test.skip(h.networkCheck === 'enforce', 'pairing needs NETWORK_CHECK=off or warn to unlock from one machine');

    const kioskCtx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } });
    const phoneCtx = await browser.newContext({ ...devices['Pixel 7'] });
    try {
      const { kioskUrl } = await provisionKiosk(request, APP_URL);
      const kiosk = await kioskCtx.newPage();
      await kiosk.goto(kioskUrl);
      const { scanUrl } = await readPairing(kiosk, APP_URL);

      const phone = await phoneCtx.newPage();
      await stubSessionData(phone, zetSnapshot('e2e-dash-1'));
      await unlockOnPhone(phone, scanUrl, '10 minuta');

      await phone.click('[data-layer="u-pokretu"]');
      const schematicSel = '#u-pokretu-schematic [data-testid=schematic]';
      await waitForFrames(phone, schematicSel);
      const f1 = await frames(phone, schematicSel);
      await phone.waitForTimeout(300);
      const f2 = await frames(phone, schematicSel);
      expect(f2, 'the dashboard schematic must advance its own frame counter').toBeGreaterThan(f1);

      // The tap card: select the one drawn vehicle with the keyboard (T9's
      // own arrow-key contract, schematic-view.ts's onCanvasKey) rather than
      // clicking a computed pixel, so the assertion does not depend on the
      // whole-network crop's own scale.
      await phone.locator('[data-testid=schematic-vehicles]').focus();
      await phone.keyboard.press('ArrowRight');
      await expect(phone.getByTestId('vehicle-card')).toBeVisible();
      await expect(phone.getByTestId('vehicle-line')).toHaveText(ROUTE_ID);

      // Full-screen: R-P1/T10's ring-preserving mode -- the tab row leaves,
      // the session meander (the ring) does not.
      await phone.click('#u-pokretu-map-full');
      await expect(phone.locator('.dash[data-view="map"]')).toBeVisible();
      await expect(phone.locator('.dash-tabs')).toBeHidden();
      await expect(phone.getByTestId('session-ring')).toBeVisible();
    } finally {
      await kioskCtx.close();
      await phoneCtx.close();
    }
  });

  test('?lagano=1 on a locked kiosk: the list renders and no canvas exists anywhere on the page', async ({ page, request }) => {
    await stubTeaser(page, zetSnapshot('e2e-lagano-1', 0));
    const { kioskUrl } = await provisionKiosk(request, APP_URL);
    const lightweightUrl = kioskUrl.replace('#', '?lagano=1#');
    await page.goto(lightweightUrl);
    await expect(page.getByTestId('pair-code')).toBeVisible({ timeout: 30_000 });

    await expect(page.locator('[data-testid=kiosk-live] [data-testid=schematic-list]')).toBeAttached();
    expect(await page.locator('canvas').count(), 'no canvas of any kind on a lightweight page (R-L2)').toBe(0);
  });
});
