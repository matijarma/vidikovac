// The framed wall in a real browser (WP2 step 7; the probe contract of
// docs/companion-2026-09-22.md §15.6). A screen whose place somebody chose --
// here the admin route's stop, Trg bana J. Jelačića (106_1), which the Durable
// Object reads back as a chosen place (placeSet) -- frames its map on the
// Kadar around that place, 6 stops by default, measured along the tram lines
// (shared/city/frame.ts). On that frame:
//
//   1. the camera's zoom is frameView's for the measured radius and the map
//      host's own laid-out box, within 0.05;
//   2. the buses stay on the picture [O-71]: a bus route is among the pills;
//   3. the pills list whole line numbers, never a "+N" fold, and no pill's
//      label runs past the three-row budget (decision 23: at most
//      PILL_MAX_LINES rows of PILL_MAX_CHARS_CLUSTER characters);
//   4. every BAJS station is a disc that says something: its number, the grey
//      "0", or the grey disc without a number for a station that is not
//      renting -- and no drawn mark is left without a count or a name
//      (`data-unlabelled` 0);
//   5. the legend is three plain items, never a "?";
//   6. the map host carries the Kadar (`data-frame`) and the map the
//      public-display profile.
//
//   7. the screen's own name is always drawn (decision 19: under the
//      pills, a pill may cross it); no other name crosses a pill (decision
//      17: on the wall the vehicle marks take their place first and a name
//      moves or yields), so `data-overlaps` names is 0; a BAJS number under a pill is a pill
//      passing (its count stays drawn under it), so `discs` is never more
//      than `data-disc-pills`, the pills over those numbers; the names the
//      collision pass held back (`data-hidden-names`) are recorded.
//
// The census attributes are read off what MapLibre drew (city-map.ts,
// writeRenderProbe and markerCensus), taken at the map's idle.
//
// A third test takes the feed down under a wall that has drawn its fleet:
// the vehicle marks leave the map and the census, the stations stay.
//
// Local only: the feed is the recorded fixture (installKioskFeedFixture), the
// city API the fixture of e2e/city-fixtures.ts with WALL_BIKES, and the
// basemap tiles, which a developer machine does not carry, answer "no tile"
// at the browser (the glyphs and sprites are ordinary static assets).
import { expect, test, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_URL, E2E_STOP_ID, provisionKiosk } from './helpers';
import { installKioskFeedFixture, installWallFixture } from './experience-fixtures';
import { installCityFixture, WALL_BIKES } from './city-fixtures';
import { frameView } from '../app/src/map/frame';
import { PILL_MAX_CHARS_CLUSTER, PILL_MAX_LINES, pillRows } from '../app/src/motion/pills';
import { DEFAULT_FRAME_STOPS, frameLinesOf, frameRadiusM, frameStopsFrom } from '../shared/city/frame';
import { placeFromStop } from '../shared/city/place';
import { decodeNetwork } from '../shared/motion/network';
import type { ScreenStop } from '../worker/protocol';

const root = resolve(import.meta.dirname, '..');
const read = <T>(path: string): T => JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T;
/** GTFS route_type per route id, from the table the app and the Worker both read. */
const ROUTE_TYPES = read<Record<string, { type: number }>>('app/src/data/zet-routes.json');
const isTram = (routeId: string): boolean => ROUTE_TYPES[routeId]?.type === 0;
const isBus = (routeId: string): boolean => ROUTE_TYPES[routeId]?.type === 3;

/**
 * The wall's measured radius around 106_1 at the default Kadar, as kiosk.ts
 * wallRadiusM() reckons it once the stop table and the network artefact are
 * in: the same modules over the same committed files (stops.json, the call
 * order of zet-network.json), so the spec states the number the camera must
 * frame instead of trusting the kiosk's own.
 */
function measuredFrame(): { place: { lon: number; lat: number }; radiusM: number } {
  const stops = read<ScreenStop[]>('app/public/data/stops.json');
  const stop = stops.find((s) => s.id === E2E_STOP_ID);
  if (!stop) throw new Error(`${E2E_STOP_ID} is not in stops.json`);
  const place = placeFromStop(stop, isTram);
  const network = decodeNetwork(read('app/public/data/zet-network.json'));
  return { place, radiusM: frameRadiusM(place, frameStopsFrom(stops, isTram, frameLinesOf(network)), DEFAULT_FRAME_STOPS) };
}

/** Every line number the pill census carries, a merged pill's ("6·11", or a
 *  wrapped hub's rows) split into its lines. */
function numbersIn(pills: string | null): string[] {
  return (pills ?? '').split('|').filter(Boolean).flatMap((label) => label.split(/[·\n]/));
}

/** The pill labels in the census that run past the three-row budget: more rows
 *  than PILL_MAX_LINES, or a row longer than PILL_MAX_CHARS_CLUSTER. */
function overBudget(pills: string | null): string[] {
  return (pills ?? '').split('|').filter(Boolean)
    .filter((label) => pillRows(label).length > PILL_MAX_LINES || pillRows(label).some((row) => row.length > PILL_MAX_CHARS_CLUSTER));
}

/** The census string `name:N;name:N` as numbers. */
function counts(value: string | null): Record<string, number> {
  return Object.fromEntries((value ?? '').split(';').filter(Boolean).map((pair) => {
    const [name, n] = pair.split(':');
    return [name!, Number(n)];
  }));
}

async function hostBox(host: Locator): Promise<{ width: number; height: number }> {
  return host.evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight }));
}

test('the framed wall: the measured Kadar, buses, whole numbers, counted BAJS discs and nothing unlabelled, 1920×1080', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const { place, radiusM } = measuredFrame();
  // A real clock: the BAJS counts are fresh for three minutes after `now`, the fixture's vehicles as long.
  await installKioskFeedFixture(page, 'ready');
  await installCityFixture(page, Date.now(), WALL_BIKES);
  await installWallFixture(page);
  await page.route('**/maps/zagreb-v1/**', (route) => route.fulfill({ status: 404, body: '' }));
  const { kioskUrl } = await provisionKiosk(request, APP_URL, { stopId: E2E_STOP_ID });
  await page.goto(kioskUrl);

  const map = page.getByTestId('kiosk-map');
  const host = page.getByTestId('kiosk-map-host');
  await expect(map).toHaveAttribute('data-map-status', 'ready', { timeout: 30_000 });
  await expect(map).toHaveAttribute('data-presentation-profile', 'public-display');
  await expect(host).toHaveAttribute('data-frame', String(DEFAULT_FRAME_STOPS));

  // 1. The camera: frameView for the measured radius and the host's own box.
  // Until the network artefact lands the Kadar is the fallback table's; the
  // repaint that follows it re-frames the one map.
  let expected = 0;
  await expect.poll(async () => {
    const box = await hostBox(host);
    expected = frameView(place, radiusM, box.width, box.height).zoom;
    return Math.abs(Number(await map.getAttribute('data-zoom')) - expected);
  }, { timeout: 30_000, message: `data-zoom within 0.05 of frameView(106_1, ${radiusM.toFixed(0)} m)` }).toBeLessThanOrEqual(0.05);

  // 2 and 3. The pills: every one whole, a bus among them.
  await expect.poll(async () => numbersIn(await map.getAttribute('data-pills')).some(isBus), { timeout: 20_000, message: 'a bus route in data-pills' }).toBe(true);
  const pills = (await map.getAttribute('data-pills')) ?? '';
  expect(pills).not.toBe('');
  expect(pills).not.toMatch(/\+\d/);
  expect(overBudget(pills), 'pill labels past three rows of forty characters').toEqual([]);

  // 4. The marks: the three stations of WALL_BIKES, each saying what it is, and nothing drawn mute.
  await expect.poll(() => map.getAttribute('data-bajs'), { timeout: 30_000, message: 'data-bajs' }).toBe('counted:1;zero:1;blank:1;far:0');
  await expect(map).toHaveAttribute('data-markers', String(WALL_BIKES.length));
  await expect(map).toHaveAttribute('data-unlabelled', '0');

  // 5. The legend.
  const legend = page.locator('.k-map-legend');
  await expect(legend.locator('span')).toHaveCount(3);
  expect(await legend.innerText()).not.toContain('?');

  // 7. The own name always drawn (decision 19); no other name over a pill; a covered BAJS number is a pill passing.
  await expect(map).toHaveAttribute('data-own-name', 'Trg bana J. Jelačića');
  const overlaps = counts(await map.getAttribute('data-overlaps'));
  expect(Object.keys(overlaps).sort()).toEqual(['discs', 'names']);
  expect(overlaps.names, 'names crossed by a pill').toBe(0);
  const discPills = Number(await map.getAttribute('data-disc-pills'));
  expect(Number.isFinite(discPills)).toBe(true);
  expect(overlaps.discs).toBeLessThanOrEqual(discPills);
  const hiddenNames = Number(await map.getAttribute('data-hidden-names'));
  expect(Number.isFinite(hiddenNames)).toBe(true);
  const census = {
    radiusM: Math.round(radiusM), expectedZoom: Number(expected.toFixed(2)), zoom: await map.getAttribute('data-zoom'),
    host: await hostBox(host), pills: pills.split('|').length, markers: await map.getAttribute('data-markers'),
    longestPill: pills.split('|').reduce((a, b) => (b.length > a.length ? b : a), ''), pillRowsMax: Math.max(...pills.split('|').map((l) => pillRows(l).length)),
    unlabelled: await map.getAttribute('data-unlabelled'), bajs: await map.getAttribute('data-bajs'), overlaps, discPills, hiddenNames,
    ownNameCrossed: await map.getAttribute('data-own-name-crossed'),
  };
  info.annotations.push({ type: 'census', description: JSON.stringify(census) });
  console.log(`wall-map census: ${JSON.stringify(census)}`);
  await page.screenshot({ path: 'test-results/wall-map/wall-1920.png' });
});

// An outage under a wall that has drawn its fleet (review-w, P1): the feed
// goes down and the vehicle marks leave the map and its census, while the
// stops, the stations and their counts stay where they are.
test('the framed wall in an outage: the vehicles leave the map, the BAJS stations stay', async ({ page, request }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installKioskFeedFixture(page, 'ready');
  await installCityFixture(page, Date.now(), WALL_BIKES);
  await installWallFixture(page);
  await page.route('**/maps/zagreb-v1/**', (route) => route.fulfill({ status: 404, body: '' }));
  const { kioskUrl } = await provisionKiosk(request, APP_URL, { stopId: E2E_STOP_ID });
  await page.goto(kioskUrl);
  const map = page.getByTestId('kiosk-map');
  await expect(map).toHaveAttribute('data-map-status', 'ready', { timeout: 30_000 });
  await expect.poll(async () => ((await map.getAttribute('data-pills')) ?? '') !== '', { timeout: 30_000, message: 'the fleet drawn' }).toBe(true);
  await expect.poll(() => map.getAttribute('data-bajs'), { timeout: 30_000, message: 'data-bajs' }).toBe('counted:1;zero:1;blank:1;far:0');
  // The next poll answers "down" (routes registered later win).
  await installKioskFeedFixture(page, 'down');
  await expect(map).toHaveAttribute('data-feed', 'down', { timeout: 90_000 });
  await expect.poll(() => map.getAttribute('data-pills'), { timeout: 30_000, message: 'no pill drawn in the outage' }).toBe('');
  await expect(map).toHaveAttribute('data-bajs', 'counted:1;zero:1;blank:1;far:0');
  await expect(map).toHaveAttribute('data-markers', String(WALL_BIKES.length));
  await expect(map).toHaveAttribute('data-unlabelled', '0');
  await page.screenshot({ path: 'test-results/wall-map/wall-outage-1920.png' });
});

// The screen nobody placed (the admin route without a stop reads back as Trg
// bana Jelačića with placeSet false [O-52, O-65]) keeps the whole-city window:
// each station is the small dot without its number (city/curated.ts `far`),
// which the census counts apart and never as unlabelled.
// Owner, 24 Sep: on the whole city only a station with a bike is a far dot (the
// empty and the closed one of WALL_BIKES are left to the frame), and of the
// stops only the place's own ring and name are drawn.
test('the whole-city window: the BAJS stations with a bike are far dots, deliberately without a number, the own name is drawn, and nothing is unlabelled', async ({ page, request }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installKioskFeedFixture(page, 'ready');
  await installCityFixture(page, Date.now(), WALL_BIKES);
  await installWallFixture(page);
  await page.route('**/maps/zagreb-v1/**', (route) => route.fulfill({ status: 404, body: '' }));
  const { kioskUrl } = await provisionKiosk(request, APP_URL);
  await page.goto(kioskUrl);
  const map = page.getByTestId('kiosk-map');
  await expect(map).toHaveAttribute('data-map-status', 'ready', { timeout: 30_000 });
  const withBikes = WALL_BIKES.filter((b) => (b.bikes ?? 0) > 0 && b.renting && b.installed).length;
  await expect.poll(() => map.getAttribute('data-bajs'), { timeout: 30_000, message: 'data-bajs' }).toBe(`counted:0;zero:0;blank:0;far:${withBikes}`);
  await expect(map).toHaveAttribute('data-markers', String(withBikes));
  await expect(map).toHaveAttribute('data-own-name', 'Trg bana J. Jelačića');
  await expect(map).toHaveAttribute('data-unlabelled', '0');
  expect((await map.getAttribute('data-pills')) ?? '').not.toMatch(/\+\d/);
  expect(overBudget(await map.getAttribute('data-pills')), 'pill labels past three rows of forty characters').toEqual([]);
});
