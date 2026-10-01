// The wall's acceptance (brief §16.3, WP6 step 6): eight fake-clock scenes at
// 1920×1080, the evening peak also at 1080×1920, measured with the instruments
// that also judge production (e2e/wall.ts, e2e/inventory.ts, e2e/legibility.ts,
// e2e/recorders.ts; the observer is scripts/observe-production.mjs).
//
// Red by design until WP1–WP3 land (D2) and the read-only touch lands (D3). A
// red row is a finding, never skipped: every check is a soft assertion whose
// message names the probe and the target, so one run lists every row a scene
// misses. The touch block (stop-board) runs since D3 (WP2 step 9).
//
// Per scene, on one page: (A) the first-viewport inventory, the "U blizini"
// head, the QR card's lead; (B) one reading of the header, list, map, QR card
// and footer, plus what the scene itself says (e2e/scenes.ts); (G) 3-metre
// legibility; (C) the ten-minute rotation (300 readings 2 s apart); (D) one
// idle minute of calm motion; (E) the settings behind a 900 ms hold on the
// brand; (I) the recorders; then (H) a DPR 0.25 proxy of the scene on a second
// screen for the eye. (F) read-only touch is its own test per scene.
//
// Fixtures: the kiosk feed stamped for the scene (then re-stamped to the page's
// clock as it advances), the departures board and the last-run file of
// e2e/departures-fixture.ts at the scene clock, map tiles 404 (ACCEPT_TILES=public
// bridges them), a local screen from the admin bypass on the stop 106_1.
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { APP_URL, E2E_STOP_ID, isolateLocalNetwork, localContext, provisionKiosk } from '../helpers';
import { installKioskFeedFixture } from '../experience-fixtures';
import { installCityFixture } from '../city-fixtures';
import { departuresBoard, lastRunSnapshot, PLATFORM_IDS, serviceDays } from '../departures-fixture';
import { firstViewport, firstViewportFailures, PHONE_PROBES } from '../inventory';
import { legibilityReport, WALL_1920 } from '../legibility';
import { attachRecorders, TILE_REQUESTS, type Recorder } from '../recorders';
import { PORTRAIT_SCENES, PROXY_DEVICE_SCALE_FACTOR, SCENE_IDS, SCENES, WALL_LANDSCAPE, WALL_PORTRAIT, type Scene } from '../scenes';
import {
  CLOCK_RE, departureFailures, ELLIPSIS_RE, isSampleError, LEAD_TEXT, revealCadenceFailures, revealEpisodes, ROTATION_SETTLE_MS, ROTATION_STEP_MS, rotationFailures,
  sampleFailures, sampleRotation, SETTINGS_HOLD_MS, summariseRotation, WALL_PROBES, wallSample, type WallSample,
} from '../wall';
import {
  ACCEPT_ARTEFACTS, attrOf, CALM_MOTION_MARK_IN_PAGE, CALM_MOTION_READ_IN_PAGE, CALM_MOTION_SPEC, CALM_MOTION_START_IN_PAGE, calmMotionFailures, HEADINGS, HEADINGS_IN_PAGE,
  IDLE_MINUTE_MS, nearbyHeadFailures, pageNow, rotationSceneFailures, routeSceneTeaser, routeTiles, sceneClock, sceneReadingFailures,
  textOf, TOUCH_BOARD_MS, visibleOf, writeArtefact, type SceneClock,
} from './support';

/**
 * Load, settle, one reading, 3 m, 300 readings, one idle minute, the settings, a proxy page: well past the project's 300 s.
 * A harness budget, never a verdict: the 300 fake-clock steps cost real CPU, and on a host shared with other gates a
 * scene has taken 10 minutes of real time (D2-e2e re-run, load 16), so a timeout cut the rotation and dropped its rows.
 */
const SCENE_TIMEOUT_MS = 1_800_000;
/** How long the wall may take to paint its invitation (harness: provisioning, fixtures and clock work at all). */
const LOAD_MS = 30_000;
/** How long the map may stay at data-map-status=loading, and the timeline empty, before the first reading. */
const SETTLE_MS = 30_000;
/** How long the map may take to draw its first vehicle in a scene that has them. */
const VEHICLES_MS = 10_000;
/** The proxy page settles on a shorter leash: it is an artefact, never a verdict. */
const PROXY_SETTLE_MS = 15_000;
/** How long a touched stop's board may say it is loading: its rows are Sada's own row, whose module loads on the first touch (kiosk/timeline.ts loadStopBoardRows; lane-w-WP2T's handoff: "allow the spec's 5 s"). */
const TOUCH_ROWS_MS = 5_000;

const softly = expect.configure({ soft: true });

interface OpenWall { clock: SceneClock; recorder: Recorder | null }

/** The scene's screen, fixtures and clock, then the wall's own URL; `board` overrides the departures fixture's headsigns. */
async function openWall(page: Page, request: APIRequestContext, scene: Scene, label: string, record: boolean, board?: { headsigns?: Readonly<Record<string, string>> }): Promise<OpenWall> {
  await isolateLocalNetwork(page.context());
  await page.clock.install({ time: scene.now });
  const clock = sceneClock(scene.now);
  const snapshots = await installKioskFeedFixture(page, scene.feedState, { now: scene.now });
  await routeSceneTeaser(page, snapshots, scene.now, clock);
  const vehicles = snapshots['zet-rt']?.items ?? [];
  const days = serviceDays(scene.now);
  await installCityFixture(page, scene.now, {
    departures: (stopId) => departuresBoard({ now: clock.now(), stopId, vehicles, ...(board?.headsigns ? { headsigns: board.headsigns } : {}) }),
    lastRun: (stopId) => lastRunSnapshot(stopId, days),
  });
  await routeTiles(page);
  const recorder = record ? attachRecorders(page, label, { ignore: [TILE_REQUESTS] }) : null;
  const { kioskUrl } = await provisionKiosk(request, APP_URL, { stopId: E2E_STOP_ID });
  await page.goto(kioskUrl);
  return { clock, recorder };
}

/** The wall has painted: the invitation is up (hard: nothing else can be judged without it), the map left `loading`, the list has rows, and vehicles are drawn where the scene has them. */
async function settle(page: Page, scene: Scene, leash: number, assert: boolean): Promise<void> {
  const check = assert ? softly : null;
  const poll = async (read: () => Promise<unknown>, until: (v: unknown) => boolean, timeout: number, message: string): Promise<void> => {
    if (check) {
      await check.poll(async () => until(await read()), { timeout, message }).toBe(true);
      return;
    }
    const end = Date.now() + timeout;
    while (Date.now() < end && !until(await read().catch(() => null))) await page.waitForTimeout(250);
  };
  await poll(() => attrOf(page, WALL_PROBES.map, 'data-map-status'), (v) => typeof v === 'string' && v !== '' && v !== 'loading', leash,
    `the wall map (${WALL_PROBES.map}) leaves data-map-status=loading within ${leash / 1000} s`);
  // The census (data-markers, data-unlabelled, …) is taken once the map has settled (map/name-census.ts, MapLibre's
  // idle or a still frame after PROBE_SETTLE_MS), so a reading taken before it measures a map that has not drawn yet.
  // Where vehicles are drawn the data-pills wait below implies it; in the outage nothing else waits for it.
  await poll(() => attrOf(page, WALL_PROBES.map, 'data-unlabelled'), (v) => typeof v === 'string' && v !== '', leash,
    `the wall map (${WALL_PROBES.map}) writes its census (data-unlabelled) within ${leash / 1000} s of loading`);
  await poll(() => page.locator(WALL_PROBES.row).count(), (n) => typeof n === 'number' && n >= 1, leash,
    `the "U blizini" list (${WALL_PROBES.row}) shows at least one row within ${leash / 1000} s`);
  if (scene.expect.pills === 'any') {
    await poll(() => attrOf(page, WALL_PROBES.map, 'data-pills'), (v) => typeof v === 'string' && v.trim() !== '', Math.min(leash, VEHICLES_MS),
      `the wall map draws vehicles (data-pills non-empty) within ${VEHICLES_MS / 1000} s of loading: trams and buses on the frame at every hour, [O-71]`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
}

/** Readings from a rotation, the failed ones dropped (rotationFailures counts them). */
const readings = (rows: Awaited<ReturnType<typeof sampleRotation>>): WallSample[] => rows.filter((r): r is WallSample & { n: number } => !isSampleError(r));

/** (A) and (B): the first viewport and one reading, shared by landscape and portrait. */
async function firstLook(page: Page, scene: Scene, label: string, surface: 'kiosk' | 'kiosk-portrait'): Promise<WallSample> {
  await test.step('(A) first viewport: answer before inventory, the list head, the QR lead', async () => {
    const view = await firstViewport(page, label, { surface, scenario: scene.id });
    writeArtefact(`inventory-${label}.json`, { summary: view.summary, units: view.units.map((u) => ({ class: u.class, tag: u.tag, text: u.text, path: u.path, within: u.within })) });
    softly(firstViewportFailures(view, { wall: true }), `${label}: INSTRUCTION 0, COUNT 0, UNCLASSIFIED 0 in the first viewport and EMPTY/DISCLAIMER 0 in the aside (principles 1 and 5)`).toEqual([]);
    softly(nearbyHeadFailures(await textOf(page, WALL_PROBES.nearbyHead)), `${label}: the "U blizini" head (${WALL_PROBES.nearbyHead})`).toEqual([]);
    softly(await textOf(page, WALL_PROBES.lead), `${label}: the QR card's lead (${WALL_PROBES.lead}) reads byte-exact "${LEAD_TEXT}"`).toBe(LEAD_TEXT);
  });
  return test.step('(B) one reading: place, sentence, list, map, QR card, footer, and the scene\'s own rows', async () => {
    const sample = await wallSample(page);
    const headings = await page.evaluate(HEADINGS_IN_PAGE, HEADINGS);
    writeArtefact(`reading-${label}.json`, { sample, headings });
    softly(sampleFailures(sample), `${label}: one reading against §11 and §16.3 (place, sentence 1–80 characters without overflow or ellipsis, 1–3 departures and the fitted count, every row timed or "uvijek", no control, no retired chrome, data-unlabelled 0, QR ≥ 240 px, footer without HH:MM, ≤ 1 solar row)`).toEqual([]);
    softly(sceneReadingFailures(scene, sample, headings), `${label}: what ${scene.id} (${scene.zagreb} Zagreb) shows (e2e/scenes.ts) and the §15.6 rows the reading does not cover`).toEqual([]);
    return sample;
  });
}

/** (G) 3-metre legibility, with the full report (warnings, symbol sizes) written for the owner's P3 decisions. */
async function threeMetres(page: Page, label: string): Promise<void> {
  await test.step('(G) legibility at 3 m on a 43″ 1080p panel', async () => {
    const report = await legibilityReport(page, WALL_1920);
    writeArtefact(`legibility-${label}.json`, report);
    softly([...report.violations, ...report.otherSmall].map((f) => f.detail),
      `${label}: read tier x-height ≥ 10.5 mm (≥ 38.9 px, ×1.1 in the dark theme), walk-up tier and every other text ≥ 28 px (e2e/legibility.ts WALL_1920)`).toEqual([]);
  });
}

/** (I) the recorders: console errors, page errors, failed requests, HTTP ≥ 400. */
function recordersClean(recorder: Recorder | null, label: string): void {
  if (!recorder) return;
  writeArtefact(`recorders-${label}.json`, recorder.report());
  softly(recorder.problems(), `${label}: no console error, page error, failed request or HTTP ≥ 400 (map tiles excepted)`).toEqual([]);
}

/** (H) the 3-metre proxy: the same scene on a second screen at device scale 0.25, a screenshot for the eye, no verdict. */
async function proxyShot(browser: Browser, request: APIRequestContext, scene: Scene, viewport: { width: number; height: number }, label: string): Promise<void> {
  await test.step('(H) DPR 0.25 proxy screenshot', async () => {
    const context = await localContext(browser, { viewport, deviceScaleFactor: PROXY_DEVICE_SCALE_FACTOR, locale: 'hr-HR', timezoneId: 'Europe/Zagreb' });
    try {
      const proxy = await context.newPage();
      await openWall(proxy, request, scene, `${label}-3m`, false);
      await proxy.getByTestId('kiosk-invitation').waitFor({ state: 'visible', timeout: LOAD_MS });
      await settle(proxy, scene, PROXY_SETTLE_MS, false);
      await proxy.screenshot({ path: resolve(ACCEPT_ARTEFACTS, `wall-${label}-3m.png`) });
    } catch (error) {
      // The proxy is an artefact: a refusal degrades to a missing picture, never to a red row.
      test.info().annotations.push({ type: 'proxy', description: `${label}: the DPR ${PROXY_DEVICE_SCALE_FACTOR} capture failed: ${String(error).slice(0, 300)}` });
    } finally {
      await context.close();
    }
  });
}

test.describe('wall at 1920×1080: eight scenes', () => {
  test.use({ viewport: { ...WALL_LANDSCAPE } });

  for (const id of SCENE_IDS) {
    const scene = SCENES[id];
    const label = id;

    test(`${id} (${scene.zagreb} Zagreb): first viewport, one reading, 3 m, ten minutes, calm motion, settings behind the brand, recorders`, async ({ page, request, browser }) => {
      test.setTimeout(SCENE_TIMEOUT_MS);
      const { clock, recorder } = await openWall(page, request, scene, label, true);
      await expect(page.getByTestId('kiosk-invitation'), `${label}: the wall paints its invitation within ${LOAD_MS / 1000} s (harness: screen, fixtures and clock)`).toBeVisible({ timeout: LOAD_MS });
      await settle(page, scene, SETTLE_MS, true);

      await firstLook(page, scene, label, 'kiosk');
      await threeMetres(page, label);

      await test.step('(C) ten minutes: 300 readings, 2 s apart', async () => {
        const rows = await sampleRotation(page, { onSample: (row) => { if (!isSampleError(row)) clock.sync(row.at); } });
        const summary = summariseRotation(rows);
        writeArtefact(`rotation-${label}.json`, { summary, rows });
        softly(rotationFailures(summary, { sentences: 'template-floor', solarMin: scene.expect.solarMin }),
          `${label}: departures 1–3 and the fitted count in every reading, no caveat row, no closure re-entry, no "+N" pill, ≥ 3 distinct sentences and no consecutive repeat (the wrangler-dev template floor), every turn per fact ≥ 20 s unless its fact expired (a same-fact rewording is a refresh: ${summary.sentenceTurns} turns, ${summary.sentenceRefreshes} refreshes), no overflow, no control, ≤ 1 solar row${scene.expect.solarMin ? ' and ≥ 1 (the next solar event is inside the horizon)' : ''}`).toEqual([]);
        softly(rotationSceneFailures(scene, readings(rows), summary), `${label}: what ${scene.id} never shows, over the ten minutes`).toEqual([]);
      });

      await test.step('(D) calm motion: one idle minute, structural mutations ≤ 2, rows keep their nodes', async () => {
        await page.evaluate(CALM_MOTION_START_IN_PAGE, CALM_MOTION_SPEC);
        for (let t = 0; t < IDLE_MINUTE_MS; t += ROTATION_STEP_MS) {
          await page.clock.runFor(ROTATION_STEP_MS);
          await page.waitForTimeout(ROTATION_SETTLE_MS);
          // Each step is a reading pair for the turnover credit, as in the observer (D5.20).
          await page.evaluate(CALM_MOTION_MARK_IN_PAGE, CALM_MOTION_SPEC);
        }
        clock.sync(await pageNow(page));
        const calm = await page.evaluate(CALM_MOTION_READ_IN_PAGE, CALM_MOTION_SPEC);
        writeArtefact(`calm-${label}.json`, calm);
        softly(calmMotionFailures(calm), `${label}: principle 7 over one idle minute (MutationObserver childList on ${CALM_MOTION_SPEC.root})`).toEqual([]);
      });

      await test.step('(E) settings only behind a 900 ms hold on the brand', async () => {
        const brand = page.locator(WALL_PROBES.brand);
        const panel = page.locator(WALL_PROBES.settingsPanel);
        await softly(brand, `${label}: the brand (${WALL_PROBES.brand}) is the one way into the settings`).toBeVisible({ timeout: 5_000 });
        if (!(await brand.isVisible())) return;
        await brand.click({ timeout: 5_000 });
        await page.clock.runFor(SETTINGS_HOLD_MS);
        await page.waitForTimeout(ROTATION_SETTLE_MS);
        softly(await panel.isVisible(), `${label}: a short tap on the brand opens nothing (${WALL_PROBES.settingsPanel} stays hidden)`).toBe(false);
        await page.keyboard.press('Escape');

        const box = await brand.boundingBox();
        if (!box) return;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.clock.runFor(SETTINGS_HOLD_MS);
        await page.mouse.up();
        clock.sync(await pageNow(page));
        await softly(panel, `${label}: a ${SETTINGS_HOLD_MS} ms hold on the brand opens ${WALL_PROBES.settingsPanel}`).toBeVisible({ timeout: 5_000 });
        if (!(await panel.isVisible())) return;
        for (const probe of [WALL_PROBES.togglePlace, WALL_PROBES.toggleFrame, WALL_PROBES.toggleView, WALL_PROBES.toggleTheme, WALL_PROBES.toggleRhythm]) {
          softly(await panel.locator(probe).count(), `${label}: the settings carry the click-toggle ${probe}`).toBeGreaterThanOrEqual(1);
        }
        softly((await attrOf(page, `${WALL_PROBES.settingsPanel} ${WALL_PROBES.toggleFrame}`, 'data-value')) ?? '', `${label}: Kadar (${WALL_PROBES.toggleFrame}) carries data-value 4, 6 or 8`).toMatch(/^[468]$/);
        await page.keyboard.press('Escape');
        await softly(panel, `${label}: Escape closes the settings`).toBeHidden({ timeout: 5_000 });
      });

      await test.step('(I) recorders', async () => recordersClean(recorder, label));
      await proxyShot(browser, request, scene, WALL_LANDSCAPE, label);
    });

    // (F) Read-only touch [O-58], D3 (WP2 step 9): the ring at the frame's centre is the place's own stop.
    test(`${id} (${scene.zagreb} Zagreb): read-only touch, the place's stop ring opens its departures for 60 s and the wall returns by itself`, async ({ page, request }) => {
      test.setTimeout(SCENE_TIMEOUT_MS);
      await openWall(page, request, scene, `${label}-touch`, false);
      await expect(page.getByTestId('kiosk-invitation'), `${label}: the wall paints its invitation within ${LOAD_MS / 1000} s`).toBeVisible({ timeout: LOAD_MS });
      await settle(page, scene, SETTLE_MS, true);
      const zoom = await attrOf(page, WALL_PROBES.map, 'data-zoom');
      const map = await page.locator(WALL_PROBES.map).boundingBox();
      expect(map, `${label}: the wall map (${WALL_PROBES.map}) has a box to touch`).not.toBeNull();
      // The place's stop is centred on the frame (WP2), so its ring is under the map's centre.
      await page.mouse.click(map!.x + map!.width / 2, map!.y + map!.height / 2);
      const board = page.locator(WALL_PROBES.stopBoard);
      await expect(board, `${label}: a touch on the place's stop ring opens ${WALL_PROBES.stopBoard}`).toBeVisible({ timeout: 5_000 });
      // What the fixture's timetable holds for the place's platforms at the scene's clock: a scene with no departure
      // there reads 0 rows (lane-w-WP2T), and is never asserted 1–3. The board says it is loading until its rows'
      // module is in (TOUCH_ROWS_MS).
      const scheduled = PLATFORM_IDS.reduce((n, stopId) => n + departuresBoard({ now: scene.now, stopId }).departures.length, 0);
      const rowsOnBoard = `${WALL_PROBES.stopBoard} ${PHONE_PROBES.departureRows}`;
      if (scheduled > 0) {
        await expect.poll(async () => (await visibleOf(page, rowsOnBoard)).length, { timeout: TOUCH_ROWS_MS, message: `${label}: the stop board's departures (${rowsOnBoard}) paint within ${TOUCH_ROWS_MS / 1000} s of the touch` }).toBeGreaterThanOrEqual(1);
      }
      const departures = await visibleOf(page, rowsOnBoard);
      if (scheduled > 0) expect(departures.length, `${label}: the stop board lists 1–3 departures (principle 3), read ${departures.length}`).toBeGreaterThanOrEqual(1);
      else expect(departures.length, `${label}: no departure at the scene's clock in the fixture, so the board lists none, read ${departures.length}`).toBe(0);
      expect(departures.length, `${label}: the stop board lists at most 3 departures, read ${departures.length}`).toBeLessThanOrEqual(3);
      for (let t = 0; t <= TOUCH_BOARD_MS; t += ROTATION_STEP_MS) {
        await page.clock.runFor(ROTATION_STEP_MS);
        await page.waitForTimeout(ROTATION_SETTLE_MS);
      }
      await expect(board, `${label}: the stop board closes by itself within ${TOUCH_BOARD_MS / 1000} s`).toBeHidden({ timeout: 5_000 });
      const zoomAfter = await attrOf(page, WALL_PROBES.map, 'data-zoom');
      writeArtefact(`touch-${label}.json`, { scheduled, departures: departures.map((d) => d.text), zoom, zoomAfter });
      expect(zoomAfter, `${label}: a touch never moves the camera (data-zoom unchanged)`).toBe(zoom);
    });
  }

  // R2 (docs/reveal-2026-10-plan/R2.md, step 11): on the header's beat the list swaps its least valuable rows for the
  // ones it had no room for, for exactly one beat, then they return; one region per beat, within the beat budget.
  // The existing midday fixture supplies page 2; assert that measured precondition below.
  test('reveal (midday1230, Ritam 20 s): one page turn and its return over four beats', async ({ page, request }) => {
    test.setTimeout(SCENE_TIMEOUT_MS);
    const scene = SCENES.midday1230;
    const label = 'reveal-midday1230';
    const RHYTHM_S = 20;
    const BEATS = 5;
    const { clock } = await openWall(page, request, scene, label, false);
    await expect(page.getByTestId('kiosk-invitation'), `${label}: the wall paints its invitation within ${LOAD_MS / 1000} s`).toBeVisible({ timeout: LOAD_MS });
    await settle(page, scene, SETTLE_MS, true);
    softly(await attrOf(page, WALL_PROBES.kioskRoot, 'data-rhythm'), `${label}: the wall runs at the default Ritam (${WALL_PROBES.kioskRoot} data-rhythm)`).toBe(String(RHYTHM_S));
    const first = await wallSample(page);
    const page2 = (first.fitDropped ?? []).filter((kind) => kind !== 'departure' && kind !== 'closure');
    softly(page2.length, `${label}: the list has a page 2 (data-fit-dropped ${JSON.stringify(first.fitDropped)} names a kind beside departure and closure)`).toBeGreaterThan(0);

    await test.step(`${BEATS} beats of ${RHYTHM_S} s: a reading every ${ROTATION_STEP_MS / 1000} s with the calm recorder running`, async () => {
      await page.evaluate(CALM_MOTION_START_IN_PAGE, CALM_MOTION_SPEC);
      const readings: WallSample[] = [];
      for (let t = 0; t < BEATS * RHYTHM_S * 1000; t += ROTATION_STEP_MS) {
        await page.clock.runFor(ROTATION_STEP_MS);
        await page.waitForTimeout(ROTATION_SETTLE_MS);
        readings.push(await wallSample(page));
        await page.evaluate(CALM_MOTION_MARK_IN_PAGE, CALM_MOTION_SPEC);
      }
      clock.sync(await pageNow(page));
      const calm = await page.evaluate(CALM_MOTION_READ_IN_PAGE, CALM_MOTION_SPEC);
      writeArtefact(`reveal-${label}.json`, { first, readings: readings.map((r) => ({ at: r.at, reveal: r.reveal, rhythm: r.rhythm, sentence: r.sentence, fact: r.fact, rows: r.rows.map((row) => row.id), fitDropped: r.fitDropped, departures: r.departures })), calm });
      const episodes = revealEpisodes(readings);
      const pages = episodes.filter((e) => e.region === 'list' && e.kind === 'page');
      softly(pages.length, `${label}: at least one page turn (${WALL_PROBES.nearbyRows} data-reveal="page:<beat>") in ${BEATS} beats; episodes ${JSON.stringify(episodes.map((e) => `${e.region} ${e.kind}:${e.beat}`))}`).toBeGreaterThanOrEqual(1);
      for (const e of pages) {
        const i = readings.findIndex((r) => r.at === e.firstAt);
        const j = readings.findIndex((r) => r.at === e.lastAt);
        const before = readings[i - 1];
        const after = readings[j + 1];
        if (!before || !after) continue;
        softly(after.rows.map((row) => row.id), `${label}: the rows return after page:${e.beat} (the reading before it and the first after it list the same ids)`).toEqual(before.rows.map((row) => row.id));
        const swapped = readings[i]!.rows.map((row) => row.id).filter((id) => !before.rows.some((row) => row.id === id));
        softly(swapped.length, `${label}: page:${e.beat} shows rows the reading before did not (${swapped.join(', ')})`).toBeGreaterThanOrEqual(1);
      }
      softly(revealCadenceFailures(readings), `${label}: the reveal cadence (one region per beat, ${BEATS} beats, each standing a beat and ending by the second)`).toEqual([]);
      softly(readings.filter((r) => r.reveal?.list && r.reveal?.line).length, `${label}: no reading carries a reveal on both the list and the line`).toBe(0);
      softly(calmMotionFailures(calm), `${label}: the beat budget (${CALM_MOTION_SPEC.root}: at most 6 records across a reveal's start or return, 2 elsewhere, every staying row on its node)`).toEqual([]);
      for (const r of readings) softly(departureFailures(r), `${label}: 1 to 3 departures and the fitted count at ${new Date(r.at).toISOString()}`).toEqual([]);
      softly(readings.flatMap((r) => r.rows).filter((row) => ELLIPSIS_RE.test(row.text)).map((row) => row.text), `${label}: no row's text is cut by an ellipsis`).toEqual([]);
    });
  });
});

/** Every line's destination the same words (the departures fixture keys its headsigns by route). */
const everyRoute = (headsign: string): Readonly<Record<string, string>> => new Proxy({}, { get: () => headsign });

/** What the departures line draws, as the browser laid it out (docs/reveal-2026-10-plan/R1.md §0.2(e)). */
interface LineLayout {
  lines: number;
  dataCells: string | null;
  departureRows: number;
  height: number;
  cells: {
    cell: string | null; left: number; top: number; width: number; height: number; badge: boolean; time: boolean; live: boolean;
    timeText: string; headsign: string; headsignState: string | null; headsignLines: number; headsignInside: boolean; overflow: boolean; text: string;
  }[];
}
const LINE_LAYOUT_IN_PAGE = (probes: { depLine: string; nearbyRows: string }): LineLayout => {
  const lineEls = Array.from(document.querySelectorAll<HTMLElement>(probes.depLine));
  const line = lineEls[0] ?? null;
  const inside = (r: DOMRect, c: DOMRect): boolean => r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1;
  const cells = line ? Array.from(line.querySelectorAll<HTMLElement>('[data-cell]')).map((cell) => {
    const box = cell.getBoundingClientRect();
    const head = cell.querySelector<HTMLElement>('.k-dep-headsign');
    const headBox = head?.getBoundingClientRect();
    const lineHeight = head ? Number.parseFloat(getComputedStyle(head).lineHeight) || Number.parseFloat(getComputedStyle(head).fontSize) * 1.15 : 0;
    const descendants = Array.from(cell.querySelectorAll<HTMLElement>('*')).filter((el) => el.getBoundingClientRect().width > 0);
    return {
      cell: cell.dataset.cell ?? null, left: box.left, top: box.top, width: box.width, height: box.height,
      badge: Boolean(cell.querySelector('.k-line-badge')), time: Boolean(cell.querySelector('time.nearby-when')), live: cell.dataset.live === '1',
      timeText: (cell.querySelector('.nearby-when')?.textContent ?? '').trim(), headsign: (head?.textContent ?? '').trim(),
      headsignState: cell.dataset.headsign ?? null,
      headsignLines: head && headBox && headBox.height > 0 && lineHeight > 0 ? Math.round(headBox.height / lineHeight) : 0,
      headsignInside: !headBox || headBox.width === 0 || inside(headBox, box),
      overflow: cell.scrollWidth > cell.clientWidth + 1 || descendants.some((el) => !inside(el.getBoundingClientRect(), box)),
      text: (cell.textContent ?? '').trim(),
    };
  }) : [];
  return {
    lines: lineEls.length, dataCells: line?.dataset.cells ?? null, height: line ? line.getBoundingClientRect().height : 0, cells,
    departureRows: document.querySelectorAll(`${probes.nearbyRows} > .nearby-row[data-kind="departure"]`).length,
  };
};

// R1 (docs/reveal-2026-10-plan/R1.md, Step 14): the three departures as one row of cells, drawn per composition.
test.describe('the departures line (R1)', () => {
  const scene = SCENES.peak1745;
  const read = (page: Page): Promise<LineLayout> => page.evaluate(LINE_LAYOUT_IN_PAGE, { depLine: WALL_PROBES.depLine, nearbyRows: WALL_PROBES.nearbyRows });
  const artefact = (size: string, line: LineLayout): void => { writeArtefact(`departures-line-${size}.json`, {
    height: line.height, cellWidths: line.cells.map((c) => Math.round(c.width * 10) / 10),
    headsigns: line.cells.map((c) => ({ cell: c.cell, state: c.headsignState ?? 'shown', text: c.headsign, lines: c.headsignLines })),
    // The box's time form (0.5 item 3): a live cell printing a clock means the box took the clock form.
    liveTimes: line.cells.filter((c) => c.live).map((c) => c.timeText),
    clocks: line.cells.some((c) => c.live && CLOCK_RE.test(c.timeText)),
    cells: line.cells,
  }); };

  test(`1920×1080 (${scene.zagreb} Zagreb): three cells on one row, badge, time and a one-line destination each, and a tap on cell 2 opens the board`, async ({ page, request }) => {
    test.setTimeout(SCENE_TIMEOUT_MS);
    await page.setViewportSize({ ...WALL_LANDSCAPE });
    await openWall(page, request, scene, 'departures-line-1920', false, { headsigns: everyRoute('Dubrava') });
    await expect(page.getByTestId('kiosk-invitation')).toBeVisible({ timeout: LOAD_MS });
    await settle(page, scene, SETTLE_MS, true);
    await expect.poll(async () => (await read(page)).cells.length, { timeout: SETTLE_MS, message: 'the line draws its three cells' }).toBe(3);
    const line = await read(page);
    artefact('1920', line);
    softly(line.lines, 'one departures line').toBe(1);
    softly(line.dataCells, 'data-cells of the line').toBe('3');
    softly(line.departureRows, 'no departure row beside the line').toBe(0);
    const tops = line.cells.map((c) => c.top);
    softly(Math.max(...tops) - Math.min(...tops), 'the three cells stand on one row').toBeLessThanOrEqual(2);
    for (const c of line.cells) {
      softly(c.badge, `cell ${c.cell}: a line badge`).toBe(true);
      softly(c.time, `cell ${c.cell}: a <time>`).toBe(true);
      softly(c.headsign, `cell ${c.cell}: its destination`).toBe('Dubrava');
      softly(c.headsignLines, `cell ${c.cell}: the destination on one line`).toBe(1);
      softly(c.headsignInside, `cell ${c.cell}: the destination inside its cell`).toBe(true);
      softly(c.overflow, `cell ${c.cell}: nothing runs past its cell`).toBe(false);
      softly(ELLIPSIS_RE.test(c.text), `cell ${c.cell}: no ellipsis`).toBe(false);
    }
    softly(line.height, 'the line is at most 110 px tall').toBeLessThanOrEqual(110);
    softly(sampleFailures(await wallSample(page)), 'one reading against §11 and §16.3 with the line').toEqual([]);
    // A tap on the second cell opens the place's board; it closes by itself.
    await page.locator(`${WALL_PROBES.depLine} [data-cell="2"]`).click();
    const board = page.locator(WALL_PROBES.stopBoard);
    await expect(board, 'a tap on cell 2 opens the stop board').toBeVisible({ timeout: 5_000 });
    for (let t = 0; t <= TOUCH_BOARD_MS; t += ROTATION_STEP_MS) {
      await page.clock.runFor(ROTATION_STEP_MS);
      await page.waitForTimeout(ROTATION_SETTLE_MS);
    }
    await expect(board, `the stop board closes by itself within ${TOUCH_BOARD_MS / 1000} s`).toBeHidden({ timeout: 5_000 });
  });

  test(`1366×768 (${scene.zagreb} Zagreb): a destination that does not fit leaves cells 2 and 3, the first is whole or gone, nothing overflows its cell`, async ({ page, request }) => {
    test.setTimeout(SCENE_TIMEOUT_MS);
    await page.setViewportSize({ width: 1366, height: 768 });
    await openWall(page, request, scene, 'departures-line-1366', false, { headsigns: everyRoute('Kvaternikov trg') });
    await expect(page.getByTestId('kiosk-invitation')).toBeVisible({ timeout: LOAD_MS });
    await settle(page, scene, SETTLE_MS, true);
    await expect.poll(async () => (await read(page)).cells.length, { timeout: SETTLE_MS, message: 'the line draws its three cells' }).toBe(3);
    const line = await read(page);
    artefact('1366', line);
    softly(line.dataCells, 'data-cells of the line').toBe('3');
    softly(line.departureRows, 'no departure row beside the line').toBe(0);
    for (const c of line.cells.slice(1)) {
      softly(c.headsignState, `cell ${c.cell}: its destination left out (data-headsign="0")`).toBe('0');
      softly(c.headsign, `cell ${c.cell}: no destination text`).toBe('');
    }
    const first = line.cells[0]!;
    softly(first.headsign === '' || (first.headsignLines === 1 && first.headsignInside), `cell 1: its destination empty, or one line inside its cell (read "${first.headsign}", ${first.headsignLines} line(s))`).toBe(true);
    for (const c of line.cells) {
      softly(c.overflow, `cell ${c.cell}: nothing runs past its cell (${Math.round(c.width)} px, "${c.timeText}")`).toBe(false);
      softly(ELLIPSIS_RE.test(c.text), `cell ${c.cell}: no ellipsis`).toBe(false);
    }
  });
});

test.describe('wall at 1080×1920: portrait', () => {
  test.use({ viewport: { ...WALL_PORTRAIT } });

  for (const id of PORTRAIT_SCENES) {
    const scene = SCENES[id];
    const label = `${id}-portrait`;

    test(`${id} (${scene.zagreb} Zagreb) in portrait: first viewport, one reading with the QR ≥ 240 px, 3 m, recorders`, async ({ page, request, browser }) => {
      test.setTimeout(SCENE_TIMEOUT_MS);
      const { recorder } = await openWall(page, request, scene, label, true);
      await expect(page.getByTestId('kiosk-invitation'), `${label}: the wall paints its invitation within ${LOAD_MS / 1000} s (harness: screen, fixtures and clock)`).toBeVisible({ timeout: LOAD_MS });
      await settle(page, scene, SETTLE_MS, true);
      await firstLook(page, scene, label, 'kiosk-portrait');
      await threeMetres(page, label);
      await test.step('(I) recorders', async () => recordersClean(recorder, label));
      await proxyShot(browser, request, scene, WALL_PORTRAIT, label);
    });
  }
});
