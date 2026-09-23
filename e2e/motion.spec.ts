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
// mounts the engine. Since the twin (B5/B6), one response carries the twin's
// plan for each vehicle: a free-plane plan spanning a few seconds is enough
// for the integrator to glide across two frames without a second poll.
import { devices, expect, test, type Page, type Route } from '@playwright/test';
import { createHash } from 'node:crypto';
import { APP_URL, health, localContext, provisionKiosk, readPairing, unlockOnPhone } from './helpers';

// Trg bana Jelačića -- motion/schematic.ts's own DEFAULT_CROP centre, so a
// fix here sits inside both the locked kiosk's crop and any session's
// whole-network crop without special-casing either.
const CENTRE_LON = 15.9769;
const CENTRE_LAT = 45.813;
// ~67 m north (1 degree latitude is ~111,320 m here): above DEAD_ZONE_M
// (15 m), so the model actually eases instead of sitting still; comfortably
// under DISCREPANCY_LIMIT_M (150 m), so it glides instead of snapping.
const MOVED_LAT = CENTRE_LAT + 0.0006;
// The plan spans 5 s from the snapshot's own source time: the integrator
// follows it from the moment update() runs, so a sample 500 ms later is
// still mid-glide however long the mocked response itself took to arrive.
const PLAN_SPAN_S = 5;
// Deliberately not a real ZET route id (those are '1'..'99'-shaped): this
// guarantees the vehicle never matches a real shape in the real network
// artefact (which the browser really does fetch, R-L4), so every scenario
// exercises the model's free-plane branch, not a live geometry match whose
// exact stop spacing this test cannot see and does not need to.
// A real tram line, so the search Karta offers finds it and the fixture's vehicle rides its shape: the one UI path
// into a line's detail now that Karta opens on the place's list (WP4).
const ROUTE_ID = '6';

/**
 * One vehicle as the twin publishes it: its estimate at the source time and
 * a free-plane plan (the fake route matches no geometry) that carries it
 * ~67 m north over PLAN_SPAN_S, plus the twin's confidence so the facing
 * shows. `routeType` is included only when the caller wants the vehicle to
 * pass a trams-only filter (R-P1's locked-kiosk default); a session sees
 * every type and does not need it.
 */
function vehicleItem(vehicleId: string, routeType?: number) {
  return {
    id: `vehicle:${vehicleId}`,
    module: 'zet-rt',
    kind: 'vehicle',
    tier: 'open',
    title: `Tramvaj ${ROUTE_ID}`,
    at: new Date().toISOString(),
    geo: { type: 'Point', coordinates: [CENTRE_LON, CENTRE_LAT] },
    data: {
      routeId: ROUTE_ID,
      speed: 13,
      confidence: 0.5,
      ...(routeType !== undefined ? { routeType } : {}),
    },
    motion: { plan: [[0, CENTRE_LON, CENTRE_LAT], [PLAN_SPAN_S, CENTRE_LON, MOVED_LAT]] },
  };
}

/** A `zet-rt` ModuleSnapshot carrying one vehicle with its plan, dated now. */
function zetSnapshot(vehicleId: string, routeType?: number) {
  const now = Date.now();
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
    items: [vehicleItem(vehicleId, routeType)],
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
 *  frames never changed": across a sampled window it must read 1.
 *
 *  `snapshot` may be a factory instead of a plain value: a caller that also
 *  passes `gate` wants the module built at *fulfil* time, not at call time
 *  (see `deferred` below, whose whole point is delaying that moment).
 *  `gate`, when given, is awaited before the *first* response is fulfilled;
 *  every later poll answers immediately, matching the real endpoint. */
async function stubTeaser(
  page: Page,
  snapshot: unknown | (() => unknown),
  gate?: Promise<void>,
): Promise<{ count(): number }> {
  let count = 0;
  await page.route('**/api/teaser', async (route: Route) => {
    count++;
    if (count === 1 && gate) await gate;
    const body = typeof snapshot === 'function' ? (snapshot as () => unknown)() : snapshot;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modules: [body] }) });
  });
  return { count: () => count };
}

/** A promise the caller can resolve from the outside, plus the function to
 *  resolve it with -- the standard "deferred" shape, used here to hold
 *  `stubTeaser`'s first fulfilment open until the test says otherwise. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
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

async function canvasSnapshot(page: Page, selector: string): Promise<string> {
  // WebGL need not preserve its drawing buffer. Chromium's screenshot reads
  // the composed frame, unlike toDataURL() on a cleared WebGL buffer.
  return createHash('sha256').update(await page.locator(selector).screenshot({ animations: 'disabled' })).digest('hex');
}

test.describe('the motion model, mounted end to end (T11)', () => {
  test('a locked kiosk: the frame counter advances, and a vehicle glides between two frames 500 ms apart on one unchanged snapshot', async ({
    page,
    request,
  }) => {
    // The fixture's ease window (FIX_INTERVAL_MS) starts the instant
    // model.update() sees these two fixes -- i.e. the instant this route's
    // first response is actually fulfilled, not when the test happened to
    // set it up. loadTeaser() fires at mount (kiosk.ts), long before
    // `kiosk-code` becomes visible (a BeaconDO WebSocket handshake with a
    // 30 s allowance), so holding that first response gated on `release`
    // and only calling it once pairing is done -- with the fixture itself
    // built at that same moment (`snapshot` is a factory, so its `now` is
    // read at fulfil time) -- ties the ease window's start to the moment
    // this test starts measuring, however long pairing actually took.
    // Without this, a slow handshake (a cold Durable Object, a loaded CI
    // box) lets the vehicle finish easing and the loop park (loop.ts's
    // PARK_AFTER_UNCHANGED) before either assertion below ever samples a
    // frame.
    const gate = deferred();
    const teaser = await stubTeaser(page, () => zetSnapshot('e2e-kiosk-1', 0), gate.promise);
    const { kioskUrl } = await provisionKiosk(request, APP_URL);
    // One fixed window (R-KP1): the map stands for the screen's life, so no wait can outlast it.
    await page.goto(kioskUrl);
    await expect(page.getByTestId('kiosk-code')).toBeVisible({ timeout: 30_000 });
    // Load the real tiles and worker before starting the five-second ease.
    // Otherwise map startup can consume the entire interpolation window.
    await expect(page.getByTestId('kiosk-map')).toHaveAttribute('data-map-status', 'ready', { timeout: 30_000 });
    gate.release();

    const schematicSel = '[data-testid=kiosk-map]';
    const vehiclesCanvasSel = '[data-testid=kiosk-map] canvas';
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
    await expect(page.getByTestId('kiosk-code')).toBeVisible({ timeout: 30_000 });

    const schematicSel = '[data-testid=kiosk-map]';
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

  test('a session on /d: the vector map advances, keyboard-accessible detail names the line, and the shell keeps its session controls', async ({
    browser,
    request,
  }) => {
    expect((await health(request, APP_URL)).networkCheck).toBe('off');

    const kioskCtx = await localContext(browser, { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } });
    const phoneCtx = await localContext(browser, { ...devices['Pixel 7'] });
    try {
      const { kioskUrl } = await provisionKiosk(request, APP_URL);
      const kiosk = await kioskCtx.newPage();
      await kiosk.goto(kioskUrl);
      const { scanUrl } = await readPairing(kiosk, APP_URL);

      const phone = await phoneCtx.newPage();
      phone.setDefaultTimeout(15_000);
      await stubSessionData(phone, zetSnapshot('e2e-dash-1', 0));
      await unlockOnPhone(phone, scanUrl, '10 minuta');

      await phone.locator('[data-action=nav][data-layer="u-pokretu"]:visible').first().click();
      const schematicSel = '[data-testid=map-canvas]';
      await waitForFrames(phone, schematicSel);
      const f1 = await frames(phone, schematicSel);
      await phone.waitForTimeout(300);
      const f2 = await frames(phone, schematicSel);
      expect(f2, 'the dashboard schematic must advance its own frame counter').toBeGreaterThan(f1);
      const credit = phone.locator('details.maplibregl-ctrl-attrib');
      await expect(credit).toHaveJSProperty('open', false);
      const creditToggle = credit.locator('summary');
      await expect(creditToggle).toHaveAttribute('aria-label', 'Izvori karte');
      await creditToggle.click();
      await expect(credit.locator('a').filter({ hasText: 'OpenStreetMap' })).toBeVisible();
      await creditToggle.click();
      await expect(credit).toHaveJSProperty('open', false);

      // The tap card: select the one drawn vehicle with the keyboard rather
      // than clicking a computed pixel, so the assertion does not depend on
      // the crop's own scale. Karta opens on the place's list, not on a list
      // of running lines (WP4): the line's detail is reached the way a person
      // reaches it, through the one search field, and its vehicle row is
      // taken by keyboard.
      const search = phone.getByTestId('transport-search');
      await search.focus();
      await search.fill(ROUTE_ID);
      await phone.locator(`[data-action=select-route][data-id="${ROUTE_ID}"]`).first().click();
      const vehicle = phone.locator('[data-testid=route-vehicles] button').first();
      await vehicle.focus();
      await phone.keyboard.press('Enter');
      await expect(phone.getByTestId('vehicle-title')).toContainText(ROUTE_ID);

      // The working shell stays around the map, not the retired
      // panorama/meander graphic.
      await expect(phone.getByTestId('session-label')).toBeVisible();
      await expect(phone.locator('[data-testid=map-canvas] canvas')).toBeVisible();
      await expect(phone.locator('[data-testid=panorama], [data-testid=meander-legend]')).toHaveCount(0);
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
    await expect(page.getByTestId('kiosk-code')).toBeVisible({ timeout: 30_000 });

    const board = page.locator('[data-testid=kiosk-live] [data-testid=kiosk-lines]');
    await expect(board).toBeVisible();
    await expect(board).toContainText(ROUTE_ID);
    expect(await page.locator('canvas').count(), 'no canvas of any kind on a lightweight page (R-L2)').toBe(0);
  });
});
