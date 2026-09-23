// The phone's and the desktop's acceptance (brief §16.4, WP6 step 7): the ten-minute
// visit on a Pixel 7 (Sada first, then Karta, Još, the header's share button, the end
// of the session) and the desktop at 1440×900 with Sada and Karta side by side.
//
// Red by design until WP4 lands (D3). A red row is a finding, never skipped: every
// check is a soft assertion whose message names the probe and the target, and no
// action waits on a probe that may not exist yet (a missing target fails on the
// assertion that names it, never on a selector timeout). The two stop-board rows
// (the canvas tap and the search path) run since D3.
//
// Fixtures: the session spine of e2e/experience-fixtures.ts (a routed room socket and
// /api/data, the fake clock at FIXTURE_NOW, the screen stop 106_1), the departures
// board and last-run file of e2e/departures-fixture.ts at that clock, map tiles 404
// (ACCEPT_TILES=public bridges them). Selectors come from PHONE_PROBES
// (e2e/inventory.ts), the one place the phone's probe names live.
import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test, type Page } from '@playwright/test';
import { FIXTURE_NOW } from '../../test/feed/fixture-contexts';
import { isolateLocalNetwork } from '../helpers';
import { CODE_RE } from '../lib';
import { experienceSnapshots, FIXTURE_DASHBOARD, FIXTURE_STOP, installExperienceFixture, type FixtureSession } from '../experience-fixtures';
import { installCityFixture } from '../city-fixtures';
import { departuresBoard, lastRunSnapshot, serviceDays } from '../departures-fixture';
import {
  EXPIRY_READ_IN_PAGE, EXPIRY_SPEC, expiryFailures, firstViewport, firstViewportFailures, KARTA_PILLS_WITHIN_MS, PHONE_CONTENT_ROWS, PHONE_DEPARTURES,
  PHONE_PROBES, PHONE_SLOP_RE, SEARCH_TAPS_MAX, SHARE_CITY_LABEL, STOP_SEARCH_QUERY, TAB_LABELS, WEEK_EVENTS_LABEL,
} from '../inventory';
import { pillFailures, pillLabels, PLUS_PILL_RE } from '../wall';
import { attachRecorders, TILE_REQUESTS, type Recorder } from '../recorders';
import {
  attrOf, AXE_BLOCKING, AXE_TAGS, DESK_VIEWPORT, intersects, nearbyHeadFailures, PHONE_DEPARTURE_ROWS, PHONE_VIEWPORT, phoneDepartureFailures,
  phoneDepartures, phoneSentenceFailures, phoneSentenceText, routeTiles, sceneClock, textOf, visibleOf, writeArtefact,
} from './support';

/** How long the session may take to join and paint (harness: the routed socket, /api/data and the clock). */
const JOIN_MS = 30_000;
/** How long a WP4 surface may take to appear once the session is up. */
const PAINT_MS = 15_000;
/** How long the Karta map may take to reach data-map-status=ready. */
const MAP_MS = 30_000;
/** Past the shell's 30 s data poll: no request may follow once the session has ended. */
const AFTER_EXPIRY_MS = 31_000;

const softly = expect.configure({ soft: true });
/** Pixel 7: touch, mobile layout and its device scale; the browser type is the project's own. */
const { defaultBrowserType: _browser, ...PIXEL_7 } = devices['Pixel 7'];

interface OpenPhone { fixture: FixtureSession; recorder: Recorder }

/** The fixture session on the dashboard, with the recorders on before the first request. */
async function openPhone(page: Page, label: string): Promise<OpenPhone> {
  await isolateLocalNetwork(page.context());
  const recorder = attachRecorders(page, label, { ignore: [TILE_REQUESTS] });
  const snapshots = await experienceSnapshots();
  const fixture = await installExperienceFixture(page, snapshots);
  const clock = sceneClock(FIXTURE_NOW.getTime());
  const vehicles = snapshots['zet-rt']?.items ?? [];
  const days = serviceDays(FIXTURE_NOW.getTime());
  await installCityFixture(page, FIXTURE_NOW.getTime(), {
    departures: (stopId) => departuresBoard({ now: clock.now(), stopId, vehicles }),
    lastRun: (stopId) => lastRunSnapshot(stopId, days),
  });
  await routeTiles(page);
  await page.goto(FIXTURE_DASHBOARD);
  await expect(page.getByTestId('session-label'), `${label}: the fixture session joins and paints its session pill within ${JOIN_MS / 1000} s (harness)`).toBeVisible({ timeout: JOIN_MS });
  return { fixture, recorder };
}

/** Visible and clickable now, or a soft failure naming the probe; never an action that waits for a missing element. */
async function present(page: Page, selector: string, message: string, timeout = PAINT_MS): Promise<boolean> {
  const target = page.locator(`${selector} >> visible=true`).first();
  await softly(target, message).toBeVisible({ timeout });
  return target.isVisible();
}

function recordersClean(recorder: Recorder, label: string): void {
  writeArtefact(`recorders-${label}.json`, recorder.report());
  softly(recorder.problems(), `${label}: no console error, page error, failed request or HTTP ≥ 400 (map tiles excepted)`).toEqual([]);
}

async function axeBlocking(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
  return results.violations
    .filter((v) => v.impact && AXE_BLOCKING.includes(v.impact))
    .map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('; ')})`);
}

/** Open Karta by its tab and wait for its map; false when either is missing (already reported). */
async function openKarta(page: Page, label: string): Promise<boolean> {
  if (!(await present(page, PHONE_PROBES.kartaTab, `${label}: the Karta tab (${PHONE_PROBES.kartaTab}) is in the tab bar`))) return false;
  await page.locator(`${PHONE_PROBES.kartaTab} >> visible=true`).first().click({ timeout: 5_000 });
  await softly(page.locator(PHONE_PROBES.mapCanvas), `${label}: the Karta map (${PHONE_PROBES.mapCanvas}) reaches data-map-status=ready within ${MAP_MS / 1000} s`)
    .toHaveAttribute('data-map-status', 'ready', { timeout: MAP_MS });
  return (await attrOf(page, PHONE_PROBES.mapCanvas, 'data-map-status')) === 'ready';
}

test.describe('phone (Pixel 7 at 390×844)', () => {
  test.use({ ...PIXEL_7, viewport: { ...PHONE_VIEWPORT } });

  test('Sada: the place, one sentence, the map band, exactly three departures in the first viewport; no instruction, no count', async ({ page }) => {
    const label = 'phone-sada';
    const { recorder } = await openPhone(page, label);
    await present(page, PHONE_PROBES.sadaPlace, `${label}: Sada names its place (${PHONE_PROBES.sadaPlace})`);
    await softly.poll(async () => (await visibleOf(page, PHONE_DEPARTURE_ROWS)).length, {
      timeout: PAINT_MS, message: `${label}: departure rows (${PHONE_DEPARTURE_ROWS}) paint within ${PAINT_MS / 1000} s`,
    }).toBeGreaterThanOrEqual(1);

    const view = await firstViewport(page, label, { surface: 'phone', scenario: 'sada' });
    writeArtefact(`inventory-${label}.json`, { summary: view.summary, units: view.units.map((u) => ({ class: u.class, tag: u.tag, text: u.text, path: u.path })) });
    softly(firstViewportFailures(view), `${label}: INSTRUCTION 0, COUNT 0, UNCLASSIFIED 0 in the first viewport (principle 1)`).toEqual([]);

    const rows = phoneDepartures(await visibleOf(page, PHONE_DEPARTURE_ROWS), PHONE_VIEWPORT);
    softly(phoneDepartureFailures(rows), `${label}: ${PHONE_DEPARTURES} departures fully inside ${PHONE_VIEWPORT.width}×${PHONE_VIEWPORT.height}, never more (principle 3)`).toEqual([]);

    const kicker = await attrOf(page, PHONE_PROBES.sadaSentence, 'data-kicker');
    const sentenceText = phoneSentenceText(await textOf(page, PHONE_PROBES.sadaSentence), kicker);
    softly(phoneSentenceFailures(sentenceText, kicker), `${label}: one sentence card (${PHONE_PROBES.sadaSentence}) with its kicker`).toEqual([]);
    softly(await page.locator(PHONE_PROBES.sadaMapBand).count(), `${label}: the map band around the stop (${PHONE_PROBES.sadaMapBand}) is on Sada`).toBeGreaterThanOrEqual(1);
    softly(nearbyHeadFailures(await textOf(page, PHONE_PROBES.nearbyHead)), `${label}: the "U blizini" head (${PHONE_PROBES.nearbyHead}) continues the list`).toEqual([]);
    const text = await page.evaluate(() => document.body.innerText);
    softly(text.match(PHONE_SLOP_RE)?.[0] ?? null, `${label}: none of the retired Sada copy (${String(PHONE_SLOP_RE)}) is on the page`).toBeNull();
    recordersClean(recorder, label);
  });

  test('header and tabs: Sada · Karta · Još, "Podijeli grad" at rest, one tap to the share code', async ({ page }) => {
    const label = 'phone-header';
    const { recorder } = await openPhone(page, label);
    await softly.poll(async () => (await visibleOf(page, PHONE_PROBES.tab)).map((t) => t.text), {
      timeout: PAINT_MS, message: `${label}: the visible tabs (${PHONE_PROBES.tab}) read ${TAB_LABELS.join(' · ')}`,
    }).toEqual([...TAB_LABELS]);
    if (await present(page, PHONE_PROBES.shareCity, `${label}: "${SHARE_CITY_LABEL}" (${PHONE_PROBES.shareCity}) is visible in the header at rest, before any tap`)) {
      const share = page.locator(`${PHONE_PROBES.shareCity} >> visible=true`).first();
      softly((await share.innerText()).replace(/\s+/g, ' ').trim(), `${label}: the header button reads "${SHARE_CITY_LABEL}"`).toBe(SHARE_CITY_LABEL);
      await share.click({ timeout: 5_000 });
      await softly(page.locator(PHONE_PROBES.shareCode), `${label}: one tap on "${SHARE_CITY_LABEL}" shows the share code (${PHONE_PROBES.shareCode}) as ABCD-EFGH`).toHaveText(CODE_RE, { timeout: PAINT_MS });
    }
    recordersClean(recorder, label);
  });

  test(`Karta cold open: vehicles drawn within ${KARTA_PILLS_WITHIN_MS} ms of the map being ready with no tap, no disclosures, every marker labelled`, async ({ page }) => {
    const label = 'phone-karta';
    const { recorder } = await openPhone(page, label);
    if (await openKarta(page, label)) {
      await softly.poll(async () => pillLabels(await attrOf(page, PHONE_PROBES.mapCanvas, 'data-pills')).length, {
        timeout: KARTA_PILLS_WITHIN_MS, message: `${label}: at least one vehicle pill (data-pills) within ${KARTA_PILLS_WITHIN_MS} ms of data-map-status=ready, with no further tap`,
      }).toBeGreaterThanOrEqual(1);
      softly(pillFailures(await attrOf(page, PHONE_PROBES.mapCanvas, 'data-pills')), `${label}: every vehicle pill drawn, none folded into "+N" (${String(PLUS_PILL_RE)} on every label of data-pills)`).toEqual([]);
      softly(await page.locator(PHONE_PROBES.kartaDisclosures).count(), `${label}: no map disclosure or group taxonomy (${PHONE_PROBES.kartaDisclosures})`).toBe(0);
      softly(await attrOf(page, PHONE_PROBES.mapCanvas, 'data-unlabelled'), `${label}: every marker carries a label or a count (data-unlabelled "0")`).toBe('0');
      softly(Number(await attrOf(page, PHONE_PROBES.mapCanvas, 'data-markers')), `${label}: curated markers are drawn (data-markers ≥ 1)`).toBeGreaterThanOrEqual(1);
    }
    recordersClean(recorder, label);
  });

  // The two stop-board rows landed with the read-only board of D3.
  test('Karta: a tap on the stop ring at the canvas centre opens the stop board with three departures in the viewport (stop-board, D3)', async ({ page }) => {
    const label = 'phone-karta-tap';
    await openPhone(page, label);
    expect(await openKarta(page, label), `${label}: Karta opens with its map ready`).toBe(true);
    const box = await page.locator(PHONE_PROBES.mapCanvas).boundingBox();
    expect(box, `${label}: the Karta map (${PHONE_PROBES.mapCanvas}) has a box to tap`).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(page.locator(PHONE_PROBES.stopBoard), `${label}: a tap on the stop ring at the canvas centre opens ${PHONE_PROBES.stopBoard}`).toBeVisible({ timeout: PAINT_MS });
    const rows = phoneDepartures(await visibleOf(page, `${PHONE_PROBES.stopBoard} ${PHONE_PROBES.departureRows}`), PHONE_VIEWPORT);
    expect(phoneDepartureFailures(rows, 'the stop board'), `${label}: the board's ${PHONE_DEPARTURES} departures lie inside the viewport`).toEqual([]);
  });

  test(`Karta: the search field reaches a stop's board in at most ${SEARCH_TAPS_MAX} taps, rows in the viewport (stop-board, D3)`, async ({ page }) => {
    const label = 'phone-karta-search';
    await openPhone(page, label);
    let taps = 0;
    expect(await openKarta(page, label), `${label}: Karta opens with its map ready`).toBe(true);
    taps++; // the tab
    await page.locator(`${PHONE_PROBES.transportSearch} >> visible=true`).first().click({ timeout: 5_000 });
    taps++; // the field
    await page.locator(PHONE_PROBES.transportSearch).first().fill(STOP_SEARCH_QUERY);
    // The fixture's stop among the results: the departures fixture keeps the timetable of Trg's platforms only
    // (e2e/departures-fixture.ts), and the first stop for the query can be another one (Bana Josipa Jelačića).
    await page.locator(`${PHONE_PROBES.selectStop} >> visible=true`).filter({ hasText: FIXTURE_STOP.name }).first().click({ timeout: PAINT_MS });
    taps++; // the result
    await expect(page.locator(PHONE_PROBES.stopBoard), `${label}: the stop's board (${PHONE_PROBES.stopBoard}) opens from the search result`).toBeInViewport({ timeout: PAINT_MS });
    expect(taps, `${label}: tab, field and result, at most ${SEARCH_TAPS_MAX} taps`).toBeLessThanOrEqual(SEARCH_TAPS_MAX);
    const rows = phoneDepartures(await visibleOf(page, `${PHONE_PROBES.stopBoard} ${PHONE_PROBES.departureRows}`), PHONE_VIEWPORT);
    expect(phoneDepartureFailures(rows, 'the stop board'), `${label}: the board's ${PHONE_DEPARTURES} departures lie inside the viewport`).toEqual([]);
  });

  test('Još: "Događanja ovaj tjedan" with its count line, and the agenda keeps its count', async ({ page }) => {
    const label = 'phone-jos';
    const { recorder } = await openPhone(page, label);
    if (await present(page, PHONE_PROBES.tabMore, `${label}: the Još tab (${PHONE_PROBES.tabMore}) is in the tab bar`)) {
      await page.locator(`${PHONE_PROBES.tabMore} >> visible=true`).first().click({ timeout: 5_000 });
      if (await present(page, PHONE_PROBES.dirKultura, `${label}: Još lists the agenda row (${PHONE_PROBES.dirKultura})`)) {
        const row = page.locator(`${PHONE_PROBES.dirKultura} >> visible=true`).first();
        const rowText = (await row.innerText()).replace(/\s+/g, ' ').trim();
        softly(rowText, `${label}: the Još row reads "${WEEK_EVENTS_LABEL}"`).toContain(WEEK_EVENTS_LABEL);
        softly(rowText.replace(WEEK_EVENTS_LABEL, ''), `${label}: the Još row carries its count line (a number beside "${WEEK_EVENTS_LABEL}")`).toMatch(/\d/);
        await row.click({ timeout: 5_000 });
        await present(page, PHONE_PROBES.eventCount, `${label}: the week's agenda keeps its count line (${PHONE_PROBES.eventCount})`);
      }
    }
    recordersClean(recorder, label);
  });

  test('end of the ten minutes: the content clears to the scan invitation and /hitno, no exports, no further data requests', async ({ page }) => {
    const label = 'phone-expiry';
    const { fixture, recorder } = await openPhone(page, label);
    await softly.poll(async () => (await visibleOf(page, PHONE_DEPARTURE_ROWS)).length, {
      timeout: PAINT_MS, message: `${label}: Sada paints its departures before the session ends`,
    }).toBeGreaterThanOrEqual(1);
    // The expiry moment itself: every /api/data request from here on is one too many (none may slip in while the page is read).
    const requests = fixture.requests.length;
    fixture.expire();
    await softly(page.locator(PHONE_PROBES.sessionEnded), `${label}: after expiry the page shows ${PHONE_PROBES.sessionEnded} ([O-59])`).toBeVisible({ timeout: PAINT_MS });
    // One verdict with the production observer (e2e/inventory.ts): the ended block with /s/ and /hitno, no content
    // row of any kind retained (${PHONE_CONTENT_ROWS}), no export control.
    softly(expiryFailures(await page.evaluate(EXPIRY_READ_IN_PAGE, EXPIRY_SPEC)), `${label}: the content clears to the scan invitation and /hitno: no ${PHONE_CONTENT_ROWS} row, no ${PHONE_PROBES.exportControls}`).toEqual([]);
    await page.clock.runFor(AFTER_EXPIRY_MS);
    await page.waitForTimeout(500);
    softly(expiryFailures(await page.evaluate(EXPIRY_READ_IN_PAGE, EXPIRY_SPEC), fixture.requests.slice(requests).map((id) => `/api/data/${id}`)), `${label}: still cleared, and no /api/data request in the ${AFTER_EXPIRY_MS / 1000} s after the session ended`).toEqual([]);
    recordersClean(recorder, label);
  });

  test('axe on Sada and Karta: no serious or critical WCAG 2.1 A/AA violation', async ({ page }) => {
    const label = 'phone-axe';
    const { recorder } = await openPhone(page, label);
    await present(page, PHONE_PROBES.sadaPlace, `${label}: Sada names its place (${PHONE_PROBES.sadaPlace}) before axe runs`);
    softly(await axeBlocking(page), `${label}: axe (${AXE_TAGS.join(', ')}) on Sada, ${AXE_BLOCKING.join(' and ')} violations`).toEqual([]);
    if (await openKarta(page, label)) {
      softly(await axeBlocking(page), `${label}: axe (${AXE_TAGS.join(', ')}) on Karta, ${AXE_BLOCKING.join(' and ')} violations`).toEqual([]);
    }
    recordersClean(recorder, label);
  });
});

test.describe('desktop at 1440×900', () => {
  test.use({ viewport: { ...DESK_VIEWPORT } });

  test('Sada and Karta side by side in the viewport, no six-domain bar, "Podijeli grad" in the header', async ({ page }) => {
    const label = 'desktop';
    const { recorder } = await openPhone(page, label);
    const both = async (): Promise<boolean> => {
      const [sada] = await visibleOf(page, PHONE_PROBES.desktopSada);
      const [karta] = await visibleOf(page, PHONE_PROBES.desktopKarta);
      return intersects(sada, DESK_VIEWPORT) && intersects(karta, DESK_VIEWPORT);
    };
    await softly.poll(both, {
      timeout: PAINT_MS, message: `${label}: the Sada feed (${PHONE_PROBES.desktopSada}) and the Karta map (${PHONE_PROBES.desktopKarta}) both intersect the ${DESK_VIEWPORT.width}×${DESK_VIEWPORT.height} viewport ([O-56])`,
    }).toBe(true);
    softly(await page.locator(PHONE_PROBES.domains).count(), `${label}: no six-domain bar (${PHONE_PROBES.domains})`).toBe(0);
    await present(page, PHONE_PROBES.shareCity, `${label}: "${SHARE_CITY_LABEL}" (${PHONE_PROBES.shareCity}) is visible in the header`);
    recordersClean(recorder, label);
  });
});
