// The frame refits to every box it is laid out in (lane p-map; the owner, 24
// Sep: toggling fullscreen on a desktop browser left part of Zagreb off the
// map). A viewport change stands in for fullscreen here -- headless Chromium
// has no window chrome to leave -- and sends the same resize the wall's
// refit (ui/canvas.ts repaintOn, REFIT_SETTLE_MS) and the workspace's stage
// observer answer. At 1280 x 800, at 1920 x 1080 and back at 1280 x 800:
//
//   1. the placed wall (Trg bana J. Jelačića, Kadar 6): every stop of the
//      frame lies inside the map's canvas;
//   2. the whole-city window: CITY_WINDOW's four corners lie inside it;
//   3. the desktop pair: every stop of the Karta's frame (the "U blizini"
//      circle the Sada side prints) lies inside the Karta's canvas.
//
// Each position is projected from the map's own camera (data-center,
// data-zoom) onto its own box, in Web Mercator's 512 px tiles as MapLibre
// draws them. Local only: the feed is the recorded fixture, the basemap
// tiles answer "no tile".
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_URL, E2E_STOP_ID, isolateLocalNetwork, provisionKiosk } from './helpers';
import { experienceSnapshots, FIXTURE_DASHBOARD, installExperienceFixture, installKioskFeedFixture, installWallFixture } from './experience-fixtures';
import { installCityFixture, WALL_BIKES } from './city-fixtures';
import { departuresBoard, lastRunSnapshot, serviceDays } from './departures-fixture';
import { PHONE_PROBES } from './inventory';
import { routeTiles, sceneClock } from './accept/support';
import { FIXTURE_NOW } from '../test/feed/fixture-contexts';
import { inFrame } from '../app/src/map/frame';
import { DEFAULT_FRAME_STOPS, frameLinesOf, frameRadiusM, frameStopsFrom } from '../shared/city/frame';
import { placeFromStop } from '../shared/city/place';
import { decodeNetwork } from '../shared/motion/network';
import type { ScreenStop } from '../worker/protocol';

const root = resolve(import.meta.dirname, '..');
const read = <T>(path: string): T => JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T;
const ROUTE_TYPES = read<Record<string, { type: number }>>('app/src/data/zet-routes.json');
const isTram = (routeId: string): boolean => ROUTE_TYPES[routeId]?.type === 0;
const STOPS = read<ScreenStop[]>('app/public/data/stops.json');
const TRG = placeFromStop(STOPS.find((s) => s.id === E2E_STOP_ID)!, isTram);
/** The wall's measured Kadar 6 around 106_1, as e2e/wall-map.spec.ts states it. */
const RADIUS_M = frameRadiusM(TRG, frameStopsFrom(STOPS, isTram, frameLinesOf(decodeNetwork(read('app/public/data/zet-network.json')))), DEFAULT_FRAME_STOPS);
/** kiosk/mapview.ts CITY_WINDOW (pinned by test/app/map.test.ts), written out: that module's graph reaches JSON a
 *  Playwright program cannot import without an attribute. */
const CITY_WINDOW = { west: 15.925, south: 45.775, east: 16.035, north: 45.838 } as const;
const SMALL = { width: 1280, height: 800 };
const LARGE = { width: 1920, height: 1080 };
/** How long a refit may take after the viewport changes: the settle, a repaint, the jump. */
const REFIT_MS = 10_000;

interface Camera { lon: number; lat: number; zoom: number; width: number; height: number }

async function cameraOf(map: Locator): Promise<Camera | null> {
  return map.evaluate((el) => {
    const d = (el as HTMLElement).dataset;
    const [lon, lat] = (d.center ?? '').split(',').map(Number);
    const zoom = Number(d.zoom);
    return Number.isFinite(lon) && Number.isFinite(lat) && Number.isFinite(zoom) && el.clientWidth > 0
      ? { lon: lon!, lat: lat!, zoom, width: el.clientWidth, height: el.clientHeight } : null;
  });
}

/** A point on the canvas, in CSS px from its top left corner. */
function project(camera: Camera, point: { lon: number; lat: number }): { x: number; y: number } {
  const world = 512 * 2 ** camera.zoom;
  const x = (lon: number): number => ((lon + 180) / 360) * world;
  const y = (lat: number): number => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * world;
  return { x: camera.width / 2 + x(point.lon) - x(camera.lon), y: camera.height / 2 + y(point.lat) - y(camera.lat) };
}

/** The points of `points` that do not lie inside the canvas (a pixel's rounding of data-zoom allowed). */
function outside(camera: Camera, points: readonly { id: string; lon: number; lat: number }[]): string[] {
  return points.filter((p) => {
    const at = project(camera, p);
    return at.x < -2 || at.y < -2 || at.x > camera.width + 2 || at.y > camera.height + 2;
  }).map((p) => `${p.id} at ${Math.round(project(camera, p).x)},${Math.round(project(camera, p).y)} of ${camera.width}x${camera.height} (z${camera.zoom})`);
}

/** Polls until every point is inside the canvas at this viewport, then reports the camera. */
async function inside(page: Page, map: Locator, points: readonly { id: string; lon: number; lat: number }[], label: string): Promise<Camera> {
  let last: string[] = ['no camera yet'];
  await expect.poll(async () => {
    const camera = await cameraOf(map);
    last = camera ? outside(camera, points) : ['no camera yet'];
    return last;
  }, { timeout: REFIT_MS, message: `${label}: every point inside the canvas` }).toEqual([]);
  return (await cameraOf(map))!;
}

const frameStops = (radiusM: number, place = TRG): { id: string; lon: number; lat: number }[] =>
  STOPS.filter((s) => inFrame(s, { lon: place.lon, lat: place.lat, radiusM })).map((s) => ({ id: s.id, lon: s.lon, lat: s.lat }));

async function openWall(page: Page, request: Parameters<typeof provisionKiosk>[0], stopId?: string): Promise<Locator> {
  await page.setViewportSize(SMALL);
  await installKioskFeedFixture(page, 'ready');
  await installCityFixture(page, Date.now(), WALL_BIKES);
  await installWallFixture(page);
  await page.route('**/maps/zagreb-v1/**', (route) => route.fulfill({ status: 404, body: '' }));
  const { kioskUrl } = await provisionKiosk(request, APP_URL, stopId ? { stopId } : {});
  await page.goto(kioskUrl);
  const map = page.getByTestId('kiosk-map');
  await expect(map).toHaveAttribute('data-map-status', 'ready', { timeout: 30_000 });
  return map;
}

test('the placed wall keeps its frame’s stops inside the canvas at 1280×800, 1920×1080 and back', async ({ page, request }) => {
  const map = await openWall(page, request, E2E_STOP_ID);
  const stops = frameStops(RADIUS_M);
  expect(stops.length).toBeGreaterThan(6);
  const small = await inside(page, map, stops, '1280x800');
  await page.setViewportSize(LARGE);
  const large = await inside(page, map, stops, '1920x1080');
  expect(large.zoom).toBeGreaterThan(small.zoom);
  await page.setViewportSize(SMALL);
  const again = await inside(page, map, stops, '1280x800 again');
  expect(again.zoom).toBe(small.zoom);
});

test('the whole-city window stays whole at 1280×800, 1920×1080 and back', async ({ page, request }) => {
  const map = await openWall(page, request);
  const w = CITY_WINDOW;
  const corners = [
    { id: 'north-west', lon: w.west, lat: w.north }, { id: 'north-east', lon: w.east, lat: w.north },
    { id: 'south-west', lon: w.west, lat: w.south }, { id: 'south-east', lon: w.east, lat: w.south },
  ];
  const small = await inside(page, map, corners, '1280x800');
  await page.setViewportSize(LARGE);
  await inside(page, map, corners, '1920x1080');
  await page.setViewportSize(SMALL);
  const again = await inside(page, map, corners, '1280x800 again');
  expect(again.zoom).toBe(small.zoom);
});

test('the desktop pair keeps the Karta’s frame inside its canvas at 1280×800, 1920×1080 and back', async ({ page }) => {
  await page.setViewportSize(SMALL);
  await isolateLocalNetwork(page.context());
  const snapshots = await experienceSnapshots();
  await installExperienceFixture(page, snapshots);
  const clock = sceneClock(FIXTURE_NOW.getTime());
  const vehicles = snapshots['zet-rt']?.items ?? [];
  const days = serviceDays(FIXTURE_NOW.getTime());
  await installCityFixture(page, FIXTURE_NOW.getTime(), {
    departures: (stopId) => departuresBoard({ now: clock.now(), stopId, vehicles }),
    lastRun: (stopId) => lastRunSnapshot(stopId, days),
  });
  await routeTiles(page);
  await page.goto(FIXTURE_DASHBOARD);
  const map = page.locator(`${PHONE_PROBES.desktopKarta} ${PHONE_PROBES.mapCanvas}`).first();
  await expect(map).toHaveAttribute('data-map-status', /^(ready|tiles-failed)$/, { timeout: 30_000 });
  // The circle the Karta frames is the "U blizini" one the Sada side prints ("U blizini · 2,2 km · ~16 min"):
  // its stops, less the pill's rounding to a tenth of a kilometre.
  const head = (await page.locator(`${PHONE_PROBES.nearbyHead} >> visible=true`).first().innerText()).replace(/\s+/g, ' ');
  const km = Number(/(\d+(?:,\d)?) km/.exec(head)?.[1]?.replace(',', '.'));
  expect(Number.isFinite(km), `a radius in "${head}"`).toBe(true);
  const stops = frameStops(km * 1000 - 50);
  expect(stops.length).toBeGreaterThan(0);
  await inside(page, map, stops, 'desk 1280x800');
  await page.setViewportSize(LARGE);
  await inside(page, map, stops, 'desk 1920x1080');
  await page.setViewportSize(SMALL);
  await inside(page, map, stops, 'desk 1280x800 again');
});
