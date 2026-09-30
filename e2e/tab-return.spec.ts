// Return to the tab (owner, 30 Sep 2026): "when trams and busses are moving normally they essentially get frozen if
// you close your screen or go to another tab ... they resume moving from positions they were at when you were last on
// the tab", and "bajs locations, when i return to tab they all show as white and empty". The phone's Karta at 390x844,
// a fixture feed whose trams really move while the page is away, and two absences: 100 s (under the integrator's
// 180 s eviction, where the marks used to crawl after their trams for as long again) and three minutes (past the
// BAJS counts' own three minutes, where every disc used to turn blank for up to a minute).
//
// The browser cannot be made to hide a page here: Playwright's Chromium runs with background throttling off and a
// headless page is always visible. So the absence is emulated in the page (init script below): the document says
// `hidden` and dispatches visibilitychange, animation frames are held and run on the return, and Playwright's page
// clock moves on. `background` steps the clock ten seconds at a time so every due timer fires once per step (a desktop
// tab, whose polls keep asking); `frozen` jumps the wall clock and fires nothing (a phone with its screen locked).
//
// What is measured: where the marks are drawn, read off the vehicles collection the map's main thread hands to its
// worker (the only copy of the drawn positions outside the model), against where the fixture puts each tram at that
// instant; and the map's own BAJS census (`data-bajs`, map/city-map.ts), whose healthy reading here is one counted
// station, one empty and one not renting (a genuine blank).
import { devices, expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toLonLat } from '../shared/motion/geo';
import { decodeNetwork } from '../shared/motion/network';
import { decodeSchema, matchSchemaPath } from '../shared/motion/schema';
import { FIXTURE_NOW } from '../test/feed/fixture-contexts';
import type { ModuleSnapshot } from '../worker/feed/schema';
import { installCityFixture, WALL_BIKES } from './city-fixtures';
import { experienceSnapshots, FIXTURE_DASHBOARD, installExperienceFixture } from './experience-fixtures';

const root = resolve(import.meta.dirname, '..');
const net = decodeNetwork(JSON.parse(readFileSync(resolve(root, 'app/public/data/zet-network.json'), 'utf8')));
const schema = decodeSchema(JSON.parse(readFileSync(resolve(root, 'app/public/data/zet-schema.json'), 'utf8')));
const pathIndex = net.paths.findIndex((p, i) => p.route === '6' && matchSchemaPath(schema, net, i).placeable);
if (pathIndex < 0) throw new Error('tab-return E2E: no real line 6 path');
const path = net.paths[pathIndex]!;
const stops = matchSchemaPath(schema, net, pathIndex).stops;
const reference = stops.find((s) => s.name === 'Trg bana J. Jelačića') ?? stops[Math.floor(stops.length / 2)]!;

/** The trams' pace, m/s: an ordinary tram between stops. */
const SPEED = 7;
/** Three trams on the real line 6 path, 350 m apart, the first 700 m before the screen's stop. */
const TRAMS = [0, 1, 2].map((n) => ({ id: `vehicle:tab-return-${n + 1}`, s0: Math.max(0, reference.s - 700 + n * 350) }));
const T0 = FIXTURE_NOW.getTime();
const trueArc = (s0: number, t: number): number => Math.min(path.len - 10, s0 + (SPEED * (t - T0)) / 1000);
const lonLatAt = (s: number): [number, number] => toLonLat(net.toPathPoint(pathIndex, s)) as [number, number];

/** The feed at the page's time `t`: every tram where it truly is, with the twin's 90 s plan from there. */
function scene(t: number): ModuleSnapshot {
  const stamp = new Date(t).toISOString();
  return {
    module: 'zet-rt', tier: 'open', status: 'live', fetchedAt: stamp, sourceUpdatedAt: stamp,
    attribution: { text: 'ZET, test evidence over committed geometry', url: 'https://www.zet.hr', licence: 'Otvorena dozvola' },
    items: TRAMS.map(({ id, s0 }) => {
      const s = trueArc(s0, t);
      const [lon, lat] = lonLatAt(s);
      return {
        id, module: 'zet-rt', kind: 'vehicle', tier: 'open', title: 'Tramvaj 6', at: stamp,
        geo: { type: 'Point', coordinates: [lon, lat] },
        data: { routeId: '6', routeType: 0, confidence: 0.9, speed: SPEED, headsign: stops.at(-1)?.name ?? '6' },
        motion: { path: path.id, plan: [[0, s], [90, Math.min(path.len, s + SPEED * 90)]] },
      };
    }),
  } as ModuleSnapshot;
}

/** In the page before anything runs: the drawn marks as the map hands them to its worker, and a hidden tab on demand. */
function pageHooks(): void {
  const w = window as unknown as Record<string, unknown>;
  w.__marks = {};
  const features = (value: unknown, depth: number): unknown[] | null => {
    if (!value || typeof value !== 'object' || depth > 6) return null;
    const o = value as Record<string, unknown>;
    if (Array.isArray(o.features)) return o.features as unknown[];
    for (const key of Object.keys(o)) { const found = features(o[key], depth + 1); if (found) return found; }
    return null;
  };
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
    try {
      const list = features(message, 0) as { properties?: { id?: unknown }; geometry?: { type?: string; coordinates?: number[] } }[] | null;
      if (list && list.some((f) => String(f?.properties?.id ?? '').startsWith('vehicle:')) && list.every((f) => f?.geometry?.type === 'Point')) {
        const marks: Record<string, number[]> = {};
        for (const f of list) marks[String(f.properties!.id)] = f.geometry!.coordinates!;
        w.__marks = marks;
      }
    } catch { /* a probe never breaks the page */ }
    return (post as (...args: unknown[]) => void).call(this, message, ...rest);
  };
  const held = new Map<number, FrameRequestCallback>();
  let next = 1e9;
  let raf: typeof requestAnimationFrame | null = null;
  let caf: typeof cancelAnimationFrame | null = null;
  w.__hide = () => {
    raf = window.requestAnimationFrame;
    caf = window.cancelAnimationFrame;
    window.requestAnimationFrame = (cb) => { const h = ++next; held.set(h, cb); return h; };
    window.cancelAnimationFrame = (h) => { if (!held.delete(h)) caf!(h); };
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  w.__show = () => {
    delete (document as unknown as Record<string, unknown>).visibilityState;
    delete (document as unknown as Record<string, unknown>).hidden;
    window.requestAnimationFrame = raf!;
    window.cancelAnimationFrame = caf!;
    document.dispatchEvent(new Event('visibilitychange'));
    const due = [...held.values()];
    held.clear();
    for (const cb of due) raf!(cb);
  };
}

const MAP = '[data-testid=map-canvas]';
/** What the fixture's three stations say when their counts are known: 4 bikes, none, not renting. */
const HEALTHY_BAJS = 'counted:1;zero:1;blank:1;far:0';
/** The live stations answer this late, so the return's request is visibly on its way while the page repaints. */
const LIVE_LATENCY_MS = 1_500;
/** The owner's "true position": a mark this close to its tram is where the tram is (a pill is ~40 m across here). */
const AT_TRAM_M = 40;
/** How soon after the return every mark must be at its tram. */
const FRESH_WITHIN_MS = 2_000;
/** How long after the return the BAJS census is watched. */
const WATCH_BAJS_MS = 6_000;

function metres(a: readonly number[], b: readonly number[]): number {
  const k = Math.PI / 180;
  const x = (b[0]! - a[0]!) * k * Math.cos(((a[1]! + b[1]!) / 2) * k);
  const y = (b[1]! - a[1]!) * k;
  return Math.hypot(x, y) * 6_371_000;
}

/** How far each drawn mark is from its tram right now, and the census. */
async function read(page: Page): Promise<{ errors: (number | null)[]; bajs: string | null }> {
  const got = await page.evaluate((sel) => ({
    now: Date.now(),
    marks: (window as unknown as { __marks: Record<string, number[]> }).__marks,
    bajs: document.querySelector<HTMLElement>(sel)?.dataset.bajs ?? null,
  }), MAP);
  return {
    errors: TRAMS.map(({ id, s0 }) => (got.marks[id] ? metres(got.marks[id]!, lonLatAt(trueArc(s0, got.now))) : null)),
    bajs: got.bajs,
  };
}

type Absence = 'background' | 'frozen';

/** The page's time as the fixture routes read it: Node's clock plus an offset every jump of the page clock moves. */
interface PageClock { now(): number; jump(ms: number): void; sync(): Promise<void> }

function pageClock(page: Page): PageClock {
  let offset = T0 - Date.now();
  return {
    now: () => Date.now() + offset,
    jump: (ms) => { offset += ms; },
    sync: async () => { offset = (await page.evaluate(() => Date.now())) - Date.now(); },
  };
}

async function away(page: Page, clock: PageClock, mode: Absence, ms: number): Promise<void> {
  await clock.sync();
  await page.evaluate(() => (window as unknown as { __hide(): void }).__hide());
  if (mode === 'background') {
    for (let done = 0; done < ms; done += 10_000) {
      clock.jump(10_000); // before the jump: a poll it fires is answered at the page's new time
      await page.clock.fastForward(10_000);
      await page.waitForTimeout(200); // the polls that fired answer
    }
  } else {
    clock.jump(ms);
    await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + ms);
  }
  await clock.sync();
  await page.evaluate(() => (window as unknown as { __show(): void }).__show());
}

/** After a return: every mark at its tram within FRESH_WITHIN_MS, and no BAJS count blank while WATCH_BAJS_MS lasts. */
async function expectFreshReturn(page: Page, label: string): Promise<void> {
  const returnedAt = Date.now();
  const censuses: string[] = [];
  let fresh = false;
  let last: (number | null)[] = [];
  while (Date.now() - returnedAt < WATCH_BAJS_MS) {
    const now = await read(page);
    if (now.bajs) censuses.push(now.bajs);
    last = now.errors;
    if (!fresh && Date.now() - returnedAt <= FRESH_WITHIN_MS) fresh = now.errors.every((e) => e !== null && e <= AT_TRAM_M);
    await page.waitForTimeout(150);
  }
  expect(fresh, `${label}: every mark within ${AT_TRAM_M} m of its tram within ${FRESH_WITHIN_MS / 1000} s of the return (errors at the end: ${last.map((e) => (e === null ? '-' : Math.round(e))).join(' / ')} m)`).toBe(true);
  expect(last.every((e) => e !== null && e <= AT_TRAM_M), `${label}: and still there ${WATCH_BAJS_MS / 1000} s on`).toBe(true);
  expect([...new Set(censuses)], `${label}: the BAJS discs keep their counts through the return (the census read every 150 ms)`).toEqual([HEALTHY_BAJS]);
}

for (const mode of ['background', 'frozen'] as const) {
  test(`the phone's Karta after a ${mode} absence of 100 s and of three minutes: the trams where they are, the BAJS counts kept`, async ({ browser }) => {
    test.setTimeout(240_000);
    const { defaultBrowserType: _browser, ...PIXEL_7 } = devices['Pixel 7'];
    const context = await browser.newContext({ ...PIXEL_7, viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(pageHooks);
      const snapshots = await experienceSnapshots();
      snapshots['zet-rt'] = scene(T0);
      await installExperienceFixture(page, snapshots);
      const clock = pageClock(page);
      const pageNow = clock.now;
      await page.route('**/api/data/zet-rt', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(scene(pageNow())) }));
      await installCityFixture(page, T0, { bikes: WALL_BIKES });
      await page.route((url) => url.pathname === '/api/city/live', async (route) => {
        await new Promise((r) => setTimeout(r, LIVE_LATENCY_MS));
        const at = new Date(pageNow()).toISOString();
        await route.fulfill({ json: {
          schema: 1, generatedAt: at, air: [], consultations: [],
          sources: [{ id: 'bajs', name: 'BAJS', url: 'https://www.nextbike.hr', licence: 'Otvorena dozvola', status: 'live', count: WALL_BIKES.length, fetchedAt: at }],
          bikes: WALL_BIKES.map((bike) => ({ ...bike, observedAt: at })),
        } });
      });
      // The basemap's tiles are an empty bucket under wrangler dev: answered "no tile" (e2e/round-f.spec.ts).
      await page.route('**/maps/zagreb-v1/**', (route) => route.fulfill({ status: 404, body: '' }));
      await page.clock.resume();
      await page.goto(FIXTURE_DASHBOARD);
      await clock.sync();
      await page.locator('.ki-tab[data-layer=u-pokretu]:visible').first().click();
      await expect(page.locator(MAP)).toBeVisible();
      await expect.poll(async () => (await read(page)).errors.every((e) => e !== null && e <= AT_TRAM_M), { timeout: 45_000, message: 'the three trams are drawn at their places before the page leaves' }).toBe(true);
      await expect.poll(() => page.locator(MAP).getAttribute('data-bajs'), { timeout: 45_000 }).toBe(HEALTHY_BAJS);

      await away(page, clock, mode, 100_000);
      await expectFreshReturn(page, `${mode}, 100 s away`);

      await away(page, clock, mode, 180_000);
      await expectFreshReturn(page, `${mode}, three minutes away`);
    } finally {
      await context.close();
    }
  });
}
