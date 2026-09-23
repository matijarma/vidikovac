// The phone and the desktop after WP4 (companion brief §11 and §16.4, WP4 step 9),
// in the regression tier: what the ten-minute visit shows before any tap, Karta's
// cold open, a stop's departures above the fold, the three tabs and the week's
// agenda in Još, the header's "Podijeli grad", the desktop at 1440×900 and the end
// of the session. e2e/accept/phone.spec.ts measures the same surfaces as soft
// findings against the production observer's verdicts; this spec holds them as
// ordinary assertions once D3 has landed.
//
// Every selector comes from PHONE_PROBES (e2e/inventory.ts, the probe contract of
// brief §15.6), and the first-viewport census is the inventory's classifier, the
// port of the walkthrough's INSTR and COUNTRE rules: a raw regex over every text
// node would count a line badge ("6") as a quantity.
//
// Fixtures: the session spine of e2e/experience-fixtures.ts (routed room socket
// and /api/data, the fake clock at FIXTURE_NOW, the screen stop 106_1, sentence
// requests answered with no model sentence), the city API of e2e/city-fixtures.ts
// with the departures board and last-run file of e2e/departures-fixture.ts at the
// page's clock (tracked trips give live rows), and the basemap's tiles answering
// 404, so the map draws its overlays over the background as in round-f.spec.ts.
//
// Runs in the chromium project; the phone block emulates a Pixel 7 at the plan's
// 390×844. Assertions that read DOM the lane/p integrator is still building (the
// desktop pair of step 8, the end of session of step 11, the sentence request of
// step 12) carry the comment `// needs lane/p integrator`: they are written to the
// contract and run with the rest once lane/p is merged.
import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { SENTENCE_KICKERS } from '../shared/kiosk/sentence';
import { FIXTURE_NOW } from '../test/feed/fixture-contexts';
import { installCityFixture } from './city-fixtures';
import { departuresBoard, lastRunSnapshot, serviceDays } from './departures-fixture';
import { experienceSnapshots, FIXTURE_DASHBOARD, installExperienceFixture, type FixtureSession } from './experience-fixtures';
import {
  EXPIRY_READ_IN_PAGE, EXPIRY_SPEC, expiryFailures, firstViewport, KARTA_PILLS_WITHIN_MS, PHONE_DEPARTURES, PHONE_PROBES, PHONE_SLOP_RE,
  SHARE_CITY_LABEL, STOP_SEARCH_QUERY, TAB_LABELS, WEEK_EVENTS_LABEL, type FirstViewport, type InventoryClass,
} from './inventory';
import { CODE_RE } from './lib';

/** The plan's phone (WP4 step 9): the first viewport is 390×844 CSS px. */
const PHONE = Object.freeze({ width: 390, height: 844 });
/** The desktop the phone widens to ([O-56]). */
const DESK = Object.freeze({ width: 1440, height: 900 });
/** Text sizes the desktop must hold without a sideways scroll (plan acceptance A6). */
const TEXT_ZOOMS: readonly number[] = [100, 125, 200];
/** The header button that opens the share code (probe §15.6: both attributes). */
const SHARE_BUTTON = `${PHONE_PROBES.shareCity}[data-action=share-city]`;
/** A stop's sheet after a search: its departures lead, then "Vozni red" (WP4 step 6). */
const STOP_ARRIVALS = '[data-testid=stop-arrivals]';
const STOP_LEAD_ROWS = `${STOP_ARRIVALS} [data-testid=arrival-rows] > li.sada-departure`;
const TIMETABLE_WORD = 'Vozni red';
/** Karta's retired disclosures, as words (brief §11, "Phone, Karta"). */
const KARTA_RETIRED_WORDS: readonly string[] = ['Alati karte', 'Što tražiš?'];
/** How long the session may take to join and Sada or a sheet to paint (the routed socket, /api/data and the boards). */
const JOIN_MS = 30_000;
const PAINT_MS = 15_000;
/** How long Karta's map may take to start drawing (MapLibre, the style and the network artefact). */
const MAP_MS = 30_000;
/** Past the shell's 30 s data poll: no /api/data request may follow once the session has ended. */
const AFTER_EXPIRY_MS = 31_000;
/** The phone's sentence request (WP4 step 12): 80 characters, at most once a minute (the route is rate-limited per IP). */
const SENTENCE_BUDGET = 80;
const SENTENCE_EVERY_MS = 60_000;

/** Pixel 7: touch, mobile layout and its device scale; the browser type stays the project's own. */
const { defaultBrowserType: _browser, ...PIXEL_7 } = devices['Pixel 7'];

/** The fixture session on /d/ with its city API, boards and 404 tiles, joined and live. */
async function openSession(page: Page): Promise<FixtureSession> {
  const snapshots = await experienceSnapshots();
  const fixture = await installExperienceFixture(page, snapshots);
  const vehicles = snapshots['zet-rt']?.items ?? [];
  const days = serviceDays(FIXTURE_NOW.getTime());
  // Registered after the session spine, so these boards answer /api/city/departures (the route registered last wins).
  await installCityFixture(page, FIXTURE_NOW.getTime(), {
    departures: (stopId) => departuresBoard({ now: fixture.now(), stopId, vehicles }),
    lastRun: (stopId) => lastRunSnapshot(stopId, days),
  });
  await page.route('**/maps/zagreb-v1/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto(FIXTURE_DASHBOARD);
  await expect(page.getByTestId('session-label'), 'the fixture session joins and goes live').toHaveAttribute('data-state', 'live', { timeout: JOIN_MS });
  return fixture;
}

/** The tops of every element a locator matches, in CSS px from the viewport's top. */
function tops(rows: Locator): Promise<number[]> {
  return rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
}

/** The first viewport's units of one class, as `"text" <tag>` for the failure message. */
function unitsOf(view: FirstViewport, cls: InventoryClass): string[] {
  return view.units.filter((u) => u.class === cls).map((u) => `"${u.text}" <${u.tag}> ${u.path}`);
}

/** Vehicle pills the map reports drawn (`data-pills`, labels joined by "|"). */
const pillCount = (pills: string | null): number => (pills ?? '').split('|').filter(Boolean).length;

/** Karta by its tab, with its map drawing (the tiles answer 404, so the status may say so while the overlays draw). */
async function openKarta(page: Page): Promise<Locator> {
  await page.locator(`${PHONE_PROBES.kartaTab}:visible`).first().click();
  await expect(page.locator(PHONE_PROBES.desktopKarta), 'Karta shows its workspace').toBeVisible({ timeout: PAINT_MS });
  const map = page.locator(PHONE_PROBES.mapCanvas);
  await expect(map, `the Karta map starts drawing within ${MAP_MS / 1000} s`).toHaveAttribute('data-map-status', /^(ready|tiles-failed)$/, { timeout: MAP_MS });
  return map;
}

test.describe(`phone (Pixel 7 at ${PHONE.width}×${PHONE.height})`, () => {
  test.use({ ...PIXEL_7, viewport: { ...PHONE } });

  test('phone first viewport: the place, one sentence, the map band and three departures above 844 px; no instruction, no count', async ({ page }) => {
    await openSession(page);
    await expect(page.locator(PHONE_PROBES.sadaPlace), 'Sada is titled with its place').toHaveText(/\S/);
    const rows = page.locator(PHONE_PROBES.sadaDepartures);
    await expect.poll(async () => (await tops(rows)).filter((top) => top < PHONE.height).length, {
      timeout: PAINT_MS,
      message: `at least ${PHONE_DEPARTURES} departures (${PHONE_PROBES.sadaDepartures}) start above ${PHONE.height} px`,
    }).toBeGreaterThanOrEqual(PHONE_DEPARTURES);
    await expect(rows, `Sada shows ${PHONE_DEPARTURES} departures, never a board`).toHaveCount(PHONE_DEPARTURES);

    const sentence = page.locator(`${PHONE_PROBES.sadaSentence}[data-kicker]`);
    await expect(sentence, 'one sentence card with its kicker').toHaveCount(1);
    await expect(sentence).toBeVisible();
    expect(SENTENCE_KICKERS as readonly string[], 'the kicker is one of the six').toContain(await sentence.getAttribute('data-kicker'));
    await expect(page.locator(PHONE_PROBES.sadaMapBand), 'the map band around the place opens Karta').toBeVisible();

    const view = await firstViewport(page, 'companion-phone-sada', { surface: 'phone', scenario: 'sada' });
    expect(unitsOf(view, 'INSTRUCTION'), 'no instruction in the first viewport (principle 1)').toEqual([]);
    expect(unitsOf(view, 'COUNT'), 'no count without a place or a time in the first viewport [O-12]').toEqual([]);
    expect((await page.locator('body').innerText()).match(PHONE_SLOP_RE)?.[0] ?? null, 'none of the retired Sada copy').toBeNull();
  });

  test(`Sada's sentence: asked once a minute with the phone's ${SENTENCE_BUDGET}-character budget, the template when the model gives none`, async ({ page }) => {
    const fixture = await openSession(page);
    await expect(page.locator(`${PHONE_PROBES.sadaSentence}[data-kicker]`), 'the template sentence stands while the model gives none').toBeVisible({ timeout: PAINT_MS });
    // needs lane/p integrator (step 12): refresh() asks /api/kiosk/sentences for the phone's facts
    await expect.poll(() => fixture.sentenceRequests.length, { timeout: PAINT_MS, message: 'Sada asks for its sentence (POST /api/kiosk/sentences)' }).toBeGreaterThanOrEqual(1);
    const body = fixture.sentenceRequests[0]?.body as { locale?: unknown; budget?: unknown; facts?: unknown } | null | undefined;
    // needs lane/p integrator (step 12)
    expect(body?.budget, `the phone's budget is ${SENTENCE_BUDGET} characters`).toBe(SENTENCE_BUDGET);
    // needs lane/p integrator (step 12)
    expect(body?.locale, 'the request carries the page locale').toBe('hr');
    // needs lane/p integrator (step 12)
    expect(Array.isArray(body?.facts) && (body!.facts as unknown[]).length > 0, 'the request carries the facts of the place').toBe(true);
    const asked = fixture.sentenceRequests.length;
    await page.clock.runFor(SENTENCE_EVERY_MS / 2);
    await page.waitForTimeout(500);
    expect(fixture.sentenceRequests.length, `no second request within ${SENTENCE_EVERY_MS / 1000} s`).toBe(asked);
    await expect(page.locator(`${PHONE_PROBES.sadaSentence}[data-kicker]`), 'the sentence card keeps its kicker').toBeVisible();
  });

  test('tabs Sada · Karta · Još, and Još carries "Događanja ovaj tjedan" with its count line', async ({ page }) => {
    await openSession(page);
    await expect(page.locator(`.ki-tabs ${PHONE_PROBES.tab}:visible`), `the tabs read ${TAB_LABELS.join(' · ')}`).toHaveText([...TAB_LABELS]);
    await page.locator(PHONE_PROBES.tabMore).click();
    const row = page.locator(PHONE_PROBES.dirKultura);
    await expect(row.locator('.row-title'), 'the week\'s agenda is one row in Još').toHaveText(WEEK_EVENTS_LABEL);
    await expect(row.locator('.row-sub'), 'the row carries its count line').toHaveText(/\d+ događanj/);
  });

  test('share: "Podijeli grad" in the header at rest, one tap to the share code', async ({ page }) => {
    await openSession(page);
    const share = page.locator(`${SHARE_BUTTON}:visible`);
    await expect(share, `"${SHARE_CITY_LABEL}" stands in the header before any tap`).toHaveCount(1);
    await expect(share).toHaveText(SHARE_CITY_LABEL);
    await share.click();
    await expect(page.locator(PHONE_PROBES.shareCode), 'one tap shows the share code').toHaveText(CODE_RE, { timeout: PAINT_MS });
  });

  test(`Karta cold open: vehicle pills within ${KARTA_PILLS_WITHIN_MS} ms of the map drawing, tiles answering 404 and no tap; no disclosure, no "Alati karte" or "Što tražiš?"`, async ({ page }) => {
    await openSession(page);
    const map = await openKarta(page);
    await expect.poll(async () => pillCount(await map.getAttribute('data-pills')), {
      timeout: KARTA_PILLS_WITHIN_MS, intervals: [100],
      message: `at least one vehicle pill (data-pills) within ${KARTA_PILLS_WITHIN_MS} ms, with no tap`,
    }).toBeGreaterThanOrEqual(1);
    await expect(page.locator(`${PHONE_PROBES.desktopKarta} details`), 'Karta has no disclosure').toHaveCount(0);
    await expect(page.locator(PHONE_PROBES.kartaDisclosures), 'no map menu, filter disclosure or group taxonomy').toHaveCount(0);
    for (const word of KARTA_RETIRED_WORDS) {
      await expect(page.getByText(word), `no "${word}" on Karta`).toHaveCount(0);
      await expect(page.locator(`[aria-label="${word}"]`), `no control named "${word}"`).toHaveCount(0);
    }
  });

  test(`stop detail: a searched stop's first departure ends above ${PHONE.height} px, three rows lead and "Vozni red" follows`, async ({ page }) => {
    await openSession(page);
    await openKarta(page);
    await page.locator(PHONE_PROBES.transportSearch).fill(STOP_SEARCH_QUERY);
    await page.locator(`${PHONE_PROBES.selectStop}:visible`).first().click();
    const first = page.locator(STOP_LEAD_ROWS).first();
    await expect(first, 'the stop sheet lists its departures').toBeVisible({ timeout: PAINT_MS });
    // The sheet eases to its detent: read the row once it has come to rest.
    await expect.poll(async () => {
      const box = await first.boundingBox();
      return box ? Math.round(box.y + box.height) : Infinity;
    }, { timeout: 5_000, message: `the first departure's bottom lies at or above ${PHONE.height} px` }).toBeLessThanOrEqual(PHONE.height);
    await expect(page.locator(STOP_LEAD_ROWS), 'three departures lead the stop sheet').toHaveCount(PHONE_DEPARTURES);
    await expect(page.locator(STOP_ARRIVALS).getByText(TIMETABLE_WORD, { exact: true }), `"${TIMETABLE_WORD}" heads the rest of the list`).toHaveCount(1);
  });

  test('end of the ten minutes: the content clears to the invitation to scan again and /hitno; no data request follows', async ({ page }) => {
    const fixture = await openSession(page);
    await expect.poll(() => page.locator(PHONE_PROBES.sadaDepartures).count(), { timeout: PAINT_MS, message: 'Sada paints its departures before the session ends' }).toBeGreaterThanOrEqual(1);
    const requests = fixture.requests.length;
    fixture.expire();
    // needs lane/p integrator (step 11): freeze() renders [data-testid=session-ended] in place of the frozen snapshot
    await expect(page.locator(PHONE_PROBES.sessionEnded), 'the ended session shows its invitation ([O-59])').toBeVisible({ timeout: PAINT_MS });
    // needs lane/p integrator (step 11)
    await expect(page.locator(PHONE_PROBES.sessionEndedScan).first(), 'a link to scan again (a[href^="/s/"])').toBeVisible();
    // needs lane/p integrator (step 11)
    await expect(page.locator(PHONE_PROBES.sessionEndedHitno).first(), 'the /hitno link').toBeVisible();
    // needs lane/p integrator (step 11): no content row and no export control outlives the session
    expect(expiryFailures(await page.evaluate(EXPIRY_READ_IN_PAGE, EXPIRY_SPEC)), 'the content clears to the invitation and /hitno').toEqual([]);
    await page.clock.runFor(AFTER_EXPIRY_MS);
    await page.waitForTimeout(500);
    expect(fixture.requests.slice(requests).map((id) => `/api/data/${id}`), `no /api/data request in the ${AFTER_EXPIRY_MS / 1000} s after the end`).toEqual([]);
  });
});

test.describe(`desktop at ${DESK.width}×${DESK.height}`, () => {
  test.use({ viewport: { ...DESK } });

  test('desktop: the phone, wider; Sada and Karta side by side, no six-domain bar, "Podijeli grad" in the header, no sideways scroll at 100, 125 and 200 % text', async ({ page }) => {
    await openSession(page);
    await expect(page.locator(PHONE_PROBES.domains), 'no six-domain bar').toHaveCount(0);
    const share = page.locator(`${SHARE_BUTTON}:visible`);
    await expect(share, `"${SHARE_CITY_LABEL}" stands in the desk header`).toHaveCount(1);
    await expect(share).toHaveText(SHARE_CITY_LABEL);
    // needs lane/p integrator (step 8): the .ki-desk pair draws the Sada feed and the Karta map at once
    await expect.soft(page.locator(PHONE_PROBES.desktopSada), 'the Sada feed is in the viewport').toBeInViewport({ timeout: PAINT_MS });
    // needs lane/p integrator (step 8)
    await expect.soft(page.locator(PHONE_PROBES.desktopKarta), 'the Karta map is in the viewport beside it').toBeInViewport({ timeout: PAINT_MS });
    for (const zoom of TEXT_ZOOMS) {
      await page.addStyleTag({ content: `html { font-size: ${zoom}% !important; }` });
      await expect(page.locator(PHONE_PROBES.sadaPlace), `the place still reads at ${zoom} % text`).toBeVisible();
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width, `no sideways scroll at ${zoom} % text (scrollWidth ${width} px)`).toBeLessThanOrEqual(DESK.width + 1);
    }
  });
});
