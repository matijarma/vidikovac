// T12: the open screen must fit and the vehicles must be seen (R-V1, R-V2).
//
// Both defects this file guards were found on a production screenshot of the
// locked kiosk at 1920 by 1080 and were invisible to the unit suite and to
// axe: the catalogue rows printed over the safety strip, and fifteen trams in
// frame with not one visible, because ink-coloured trams lay on ink-coloured
// lines. So the proof here is geometric and optical, in a real browser, in
// both faces (the theme is resolved from prefers-color-scheme at script-load
// time, exactly as the axe sweep drives it):
//
//   - bounding boxes: the catalogue ends above the strip, the schematic
//     canvas is at least 360 CSS px tall, no two direct children of the stage
//     overlap, and the headline is one line;
//   - pixels: with the teaser stubbed to place three trams on real tram
//     track inside the crop, the vehicle canvas read back at each tram's
//     projected position is closer to the ink tone than to the line tone,
//     and the route canvas alone at that same pixel is the line tone.
//
// A screenshot per face lands in test-results/kiosk-1080p-<face>.png so the
// controller can look at the same thing a person in front of the screen sees.
import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dist, toLonLat, type XY } from '../app/src/motion/geo';
import { decodeNetwork, type Network } from '../app/src/motion/network';
import { DEFAULT_CROP, layoutSchematic, ROUTE_TYPE_TRAM } from '../app/src/motion/schematic';
import { APP_URL, provisionKiosk } from './helpers';

const KIOSK = { width: 1920, height: 1080 };
const FACES = ['dark', 'light'] as const;
type Face = (typeof FACES)[number];

/** R-V1: at least this much air between the catalogue and the strip. */
const STRIP_CLEARANCE_PX = 8;
/** R-V1: the schematic is the stage's dominant element. */
const MIN_CANVAS_HEIGHT_PX = 360;
/** The two canvases are sized at ui/canvas.ts's DENSITY (2 device px per
 *  CSS px) regardless of the viewer's own device pixel ratio. */
const DENSITY = 2;
/** Playwright's own outputDir, cleared at the start of every run. */
const SHOTS_DIR = 'test-results';

// Deliberately not a real ZET route id (those are '1'..'99'-shaped), so the
// three trams below never match a shape in the real network artefact the
// browser fetches (R-L4) and stay in the model's free-plane branch: their
// drawn position is exactly the last fix once the ease has run, which is
// what makes the pixel readback deterministic. Their *coordinates*, though,
// are vertices of a real tram shape, so each tram lies on a drawn line.
const ROUTE_ID = 'E2E12';
/** Gap between the three fixes of one tram, and so the free-plane ease span. */
const FIX_INTERVAL_MS = 3000;
/** After the ease has run the model parks; a little more than the span. */
const SETTLE_MS = FIX_INTERVAL_MS + 800;
/** Trams this far apart on screen cannot share a pixel or a halo. */
const MIN_SEPARATION_PX = 40;

interface Rgb { r: number; g: number; b: number }

function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`expected a #rrggbb tone, got ${JSON.stringify(hex)}`);
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function colourDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** `over` at `alpha` composited onto an opaque `under`. */
function blend(over: Rgb, alpha: number, under: Rgb): Rgb {
  return {
    r: over.r * alpha + under.r * (1 - alpha),
    g: over.g * alpha + under.g * (1 - alpha),
    b: over.b * alpha + under.b * (1 - alpha),
  };
}

interface Box { x: number; y: number; width: number; height: number }

function overlaps(a: Box, b: Box): boolean {
  if (a.width === 0 || a.height === 0 || b.width === 0 || b.height === 0) return false;
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function box(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).first().boundingBox();
  expect(b, `${selector} must have a bounding box`).not.toBeNull();
  return b!;
}

/** The stage's own direct children as laid out (hidden ones report an
 *  empty box, which `overlaps` treats as absent). */
function stageChildBoxes(page: Page): Promise<Array<{ name: string } & Box>> {
  return page.$eval('[data-testid=kiosk-stage]', (stage) =>
    Array.from(stage.children).map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.className || el.tagName, x: r.left, y: r.top, width: r.width, height: r.height };
    }),
  );
}

async function openLockedKiosk(page: Page, face: Face, kioskUrl: string): Promise<void> {
  await page.setViewportSize(KIOSK);
  await page.emulateMedia({ colorScheme: face });
  await page.goto(kioskUrl);
  await expect(page.getByTestId('pair-code')).toBeVisible({ timeout: 30_000 });
  // The stage's schematic mounts once the network artefact has arrived and
  // the loop has drawn at least once (motion/loop.ts's `frames()`, written to
  // data-frames for exactly this kind of proof).
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid=kiosk-live] [data-testid=schematic]') as HTMLElement | null;
      return el !== null && el.dataset.frames !== undefined && el.dataset.frames !== '0';
    },
    undefined,
    { timeout: 30_000 },
  );
  await expect(page.locator('[data-testid=teaser-card] .teaser-title')).toBeVisible();
}

/** The layout assertions R-V1 asks for, shared by the real-data screenshot
 *  test and the stubbed vehicle test (whose teaser card is the two-line
 *  invitation, so the headline row is proven with both shapes of headline). */
async function assertStageFits(page: Page, face: Face): Promise<void> {
  const catalogue = await box(page, '[data-testid=kiosk-catalogue]');
  const strip = await box(page, '[data-testid=safety-strip]');
  expect(catalogue.y + catalogue.height, `${face}: the catalogue must end above the safety strip with ${STRIP_CLEARANCE_PX} px to spare`).toBeLessThanOrEqual(strip.y - STRIP_CLEARANCE_PX);

  const canvas = await box(page, '[data-testid=kiosk-live] [data-testid=schematic-vehicles]');
  expect(canvas.height, `${face}: the schematic canvas must be at least ${MIN_CANVAS_HEIGHT_PX} px tall`).toBeGreaterThanOrEqual(MIN_CANVAS_HEIGHT_PX);

  const children = await stageChildBoxes(page);
  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      expect(overlaps(children[i], children[j]), `${face}: stage children must not overlap: ${children[i].name} vs ${children[j].name}`).toBe(false);
    }
  }
  // Nothing in the stage may reach past its own box either (overflow:hidden
  // is the last defence, not the layout).
  const stage = await box(page, '[data-testid=kiosk-stage]');
  for (const child of children) {
    if (child.width === 0 || child.height === 0) continue;
    expect(child.y + child.height, `${face}: ${child.name} must end inside the stage`).toBeLessThanOrEqual(stage.y + stage.height + 0.5);
  }

  // The headline: one line, ellipsised rather than wrapped. The invitation
  // card is the one exception by design -- its second sentence is its own
  // block under the first -- so the first line's box is what is measured.
  const title = page.locator('[data-testid=teaser-card] .teaser-title');
  const lead = await title.evaluate((h1) => {
    const range = document.createRange();
    const textNode = Array.from(h1.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
    if (!textNode) return null;
    range.selectNodeContents(textNode);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
    const style = getComputedStyle(h1);
    return { lines: new Set(rects.map((r) => Math.round(r.top))).size, lineHeight: parseFloat(style.lineHeight), fontSize: parseFloat(style.fontSize), whiteSpace: style.whiteSpace, textOverflow: style.textOverflow };
  });
  expect(lead, `${face}: the headline must carry text`).not.toBeNull();
  expect(lead!.lines, `${face}: the headline's first sentence must sit on one line`).toBe(1);
  expect(lead!.whiteSpace).toBe('nowrap');
  expect(lead!.textOverflow).toBe('ellipsis');
  expect(Math.round(lead!.fontSize), `${face}: the teaser title is 52 px at scale 1 (R-V1)`).toBe(52);
}

// --- The stubbed teaser: three trams on real track -------------------------

interface Fix { id: string; lon: number; lat: number; at: number }

function vehicleItem(fix: Fix) {
  return {
    id: `vehicle:${fix.id}`,
    module: 'zet-rt',
    kind: 'vehicle',
    tier: 'open',
    title: `Tramvaj ${ROUTE_ID}`,
    at: new Date(fix.at).toISOString(),
    geo: { type: 'Point', coordinates: [fix.lon, fix.lat] },
    data: { routeId: ROUTE_ID, routeType: ROUTE_TYPE_TRAM },
  };
}

function zetSnapshot(fixes: Fix[]) {
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
    items: fixes.map(vehicleItem),
  };
}

/** Fulfils `/api/teaser` with one fixed `zet-rt` module, built once so the
 *  fixes' `at` never advance between polls (a repeat fix is not new evidence
 *  to model.ts, so the trams stay where the first poll put them). */
async function stubTeaser(page: Page, body: unknown): Promise<void> {
  await page.route('**/api/teaser', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modules: [body] }) });
  });
}

let networkCache: Network | null = null;
/** The same artefact the browser fetches, decoded in node with the same code. */
function realNetwork(): Network {
  networkCache ??= decodeNetwork(JSON.parse(readFileSync('app/public/data/zet-network.json', 'utf8')));
  return networkCache;
}

interface TramPath { from: XY; via: XY; to: XY }

/**
 * Three vertex triples from real tram shapes, each wholly inside the crop and
 * the destination of each at least MIN_SEPARATION_PX from the others on the
 * canvas given (so no two trams share pixels or halos). A vertex lies on the
 * stroked line by construction, so the route canvas under the tram is the
 * line itself, not empty cloth.
 */
function tramPaths(net: Network, canvasW: number, canvasH: number): TramPath[] {
  const layout = layoutSchematic(net, DEFAULT_CROP, canvasW, canvasH, DENSITY, new Set([ROUTE_TYPE_TRAM]));
  // Stay well inside the crop so the ease never leaves the circle.
  const inner = DEFAULT_CROP.radius * 0.7;
  const chosen: TramPath[] = [];
  const chosenPx: XY[] = [];
  for (let idx = 0; idx < net.shapes.length && chosen.length < 3; idx++) {
    const shape = net.shapes[idx];
    if (net.routes.get(shape.route)?.type !== ROUTE_TYPE_TRAM) continue;
    for (let i = 0; i + 2 < shape.pts.length && chosen.length < 3; i++) {
      const [from, via, to] = [shape.pts[i], shape.pts[i + 1], shape.pts[i + 2]];
      if ([from, via, to].some((p) => dist(p, DEFAULT_CROP.centre) > inner)) continue;
      if (dist(from, to) < 60) continue; // a real glide, above the model's own dead zone
      const px = layout.toPx(to);
      if (chosenPx.some((q) => Math.hypot(q.x - px.x, q.y - px.y) < MIN_SEPARATION_PX * DENSITY)) continue;
      chosen.push({ from, via, to });
      chosenPx.push(px);
    }
  }
  expect(chosen, 'the artefact must offer three tram vertex triples inside the crop').toHaveLength(3);
  return chosen;
}

function fixesFor(paths: TramPath[], now: number): Fix[] {
  const fixes: Fix[] = [];
  paths.forEach((path, k) => {
    [path.from, path.via, path.to].forEach((p, step) => {
      const [lon, lat] = toLonLat(p);
      fixes.push({ id: `e2e-tram-${k}`, lon, lat, at: now - (2 - step) * FIX_INTERVAL_MS });
    });
  });
  return fixes;
}

interface Pixel { r: number; g: number; b: number; a: number }

function readPixel(page: Page, selector: string, x: number, y: number): Promise<Pixel> {
  return page.$eval(
    selector,
    (el, [px, py]) => {
      const ctx = (el as HTMLCanvasElement).getContext('2d')!;
      const d = ctx.getImageData(px, py, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    },
    [x, y] as [number, number],
  );
}

/** The three tones the schematic paints with, read off the page the same
 *  way schematic-view.ts reads them (computed style, `--tone-*`). */
function readTones(page: Page): Promise<{ ink: string; line: string; canvas: string }> {
  return page.$eval('[data-testid=kiosk-live] [data-testid=schematic-vehicles]', (el) => {
    const s = getComputedStyle(el);
    return {
      ink: s.getPropertyValue('--tone-text-primary').trim(),
      line: s.getPropertyValue('--tone-label').trim(),
      canvas: s.getPropertyValue('--tone-surface-canvas').trim(),
    };
  });
}

test.describe('the open screen at 1920 by 1080 (T12)', () => {
  for (const face of FACES) {
    test(`${face} face: the stage fits above the strip, the schematic dominates, nothing overlaps -- screenshot saved`, async ({ page, request }) => {
      const { kioskUrl } = await provisionKiosk(request, APP_URL);
      await openLockedKiosk(page, face, kioskUrl);
      // Let the real teaser (and whatever the local Worker could fetch) settle
      // so the screenshot shows the catalogue rows a person would see.
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${SHOTS_DIR}/kiosk-1080p-${face}.png`, fullPage: false });
      await assertStageFits(page, face);
    });

    test(`${face} face: three trams on real track read back as ink on a label-blue line`, async ({ page, request }) => {
      const net = realNetwork();
      // Pixel positions depend on the canvas's own size, which the page
      // decides; the paths are chosen against a nominal box and re-projected
      // against the real one below (the separation check is generous enough
      // that a few px of difference cannot merge two trams).
      const nominal = tramPaths(net, 1136 * DENSITY, 380 * DENSITY);
      const snapshot = zetSnapshot(fixesFor(nominal, Date.now()));
      await stubTeaser(page, snapshot);
      const { kioskUrl } = await provisionKiosk(request, APP_URL);
      await openLockedKiosk(page, face, kioskUrl);
      await assertStageFits(page, face);

      // Wait for the glide to finish and the loop to park on the final frame.
      await page.waitForTimeout(SETTLE_MS);
      await expect(page.locator('[data-testid=kiosk-live] [data-testid=schematic-legend]')).toContainText('3');

      const vehiclesSel = '[data-testid=kiosk-live] [data-testid=schematic-vehicles]';
      const routesSel = '[data-testid=kiosk-live] [data-testid=schematic-routes]';
      const size = await page.$eval(vehiclesSel, (el) => ({ w: (el as HTMLCanvasElement).width, h: (el as HTMLCanvasElement).height }));
      const layout = layoutSchematic(net, DEFAULT_CROP, size.w, size.h, DENSITY, new Set([ROUTE_TYPE_TRAM]));
      const tones = await readTones(page);
      const ink = parseHex(tones.ink);
      const label = parseHex(tones.line);
      const cloth = parseHex(tones.canvas);
      // What a line pixel looks like on the screen: label blue at 0.55 over the cloth.
      const lineOnCloth = blend(label, 0.55, cloth);

      for (const [k, path] of nominal.entries()) {
        const p = layout.toPx(path.to);
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        expect(x, `tram ${k} must project inside the canvas`).toBeGreaterThan(0);
        expect(y, `tram ${k} must project inside the canvas`).toBeGreaterThan(0);

        // The route layer alone: the line tone, at the line's own alpha.
        const line = await readPixel(page, routesSel, x, y);
        expect(line.a, `${face}: tram ${k} sits on a drawn route line`).toBeGreaterThan(0.35);
        expect(colourDistance(line, label), `${face}: the route layer under tram ${k} is label blue, not ink`).toBeLessThan(colourDistance(line, ink));

        // The vehicle layer: opaque (the halo is under the mark) and closer
        // to ink than to what the line looks like on the cloth.
        const vehicle = await readPixel(page, vehiclesSel, x, y);
        expect(vehicle.a, `${face}: tram ${k}'s pixel is opaque (halo under mark)`).toBeGreaterThan(0.95);
        const toInk = colourDistance(vehicle, ink);
        const toLine = colourDistance(vehicle, lineOnCloth);
        expect(toInk, `${face}: tram ${k} at (${x},${y}) reads as ink (d=${toInk.toFixed(1)}) rather than as the line (d=${toLine.toFixed(1)})`).toBeLessThan(toLine);
      }
      await page.screenshot({ path: `${SHOTS_DIR}/kiosk-1080p-${face}-trams.png`, fullPage: false });
    });
  }

  test('the two-line invitation fits the same 96 px headline row (R-V1)', async ({ page, request }) => {
    // The invitation is the last of six cards, twenty seconds apart
    // (kiosk.ts's TEASER_ROTATE_MS): a hundred seconds of wall clock, so the
    // page's clock is installed before load and wound forward instead.
    await page.clock.install({ time: Date.now() });
    const { kioskUrl } = await provisionKiosk(request, APP_URL);
    await openLockedKiosk(page, 'light', kioskUrl);
    const tagline = page.locator('[data-testid=teaser-card] .teaser-tagline');
    for (let step = 0; step < 6 && (await tagline.count()) === 0; step++) {
      await page.clock.runFor(20_000);
    }
    await expect(tagline).toBeVisible();
    await expect(tagline).toHaveText('Manje ekrana, više Zagreba.');

    const scale = await page.$eval('.kiosk', (el) => parseFloat(getComputedStyle(el).getPropertyValue('--kiosk-scale')) || 1);
    const card = await box(page, '[data-testid=teaser-card]');
    const title = await box(page, '[data-testid=teaser-card] .teaser-title');
    const tag = await box(page, '[data-testid=teaser-card] .teaser-tagline');
    // The card is exactly its grid row; nothing in it may spill past.
    expect(card.height, 'the headline row is 96 px at scale 1').toBeLessThanOrEqual(96 * scale + 0.5);
    expect(tag.y, "the invitation's second line sits under the first").toBeGreaterThanOrEqual(title.y + 40 * scale);
    expect(tag.y + tag.height, "the invitation's second line sits inside the headline row").toBeLessThanOrEqual(card.y + card.height + 0.5);
    await assertStageFits(page, 'light');
    await page.screenshot({ path: `${SHOTS_DIR}/kiosk-1080p-light-invitation.png`, fullPage: false });
  });
});

// --- F5 / R-P7: the essentials board must never need scrolling ------------
// Found on production (12 September, kiosk-essentials-prod.png): no CAP
// warning that evening, but a live closures row ("Zatvorene prometnice /
// 38 zatvaranja / Petra i Tome Erdödyja") sat right above "Sljedeći
// polasci", whose unbounded value ("101: po redu") and detail (every route
// in the city, in raw seconds, wrapping line after line) alone filled the
// rest of the 1080 px viewport and ran past it -- Maksimir and the
// pharmacy row were pushed off, not merely scrolled to, since the capture
// itself cuts off mid-route ("214: +112 s ·"). This reproduces that same
// pair -- a real closure, a dozen routes inside the box -- and proves the
// retitled "Linije u blizini" row is now a normal, bounded row (R-F8: at
// most eight routes, one line) that coexists with its neighbour instead of
// swallowing the rest of the screen.

function essentialsVehiclePin(id: string, routeId: string) {
  return {
    id: `vehicle:${id}`, module: 'zet-rt', kind: 'vehicle', tier: 'open', title: routeId,
    geo: { type: 'Point', coordinates: [15.977, 45.813] }, data: { routeId, routeType: ROUTE_TYPE_TRAM },
  };
}

function essentialsRouteSummary(routeId: string, medianDelaySeconds: number) {
  return {
    id: `route:${routeId}`, module: 'zet-rt', kind: 'vehicle', tier: 'open', title: `Linija ${routeId}`,
    data: { routeId, routeShortName: routeId, medianDelaySeconds, vehicles: 1 },
  };
}

const ATTR = { text: 'Izvor: test', url: 'https://example.test', licence: 'Otvorena dozvola' };

/** The production pair (no CAP warning that evening; a real closure) plus
 *  a dozen distinct routes inside the box on zet-rt -- the same load the
 *  wall-of-text bug hit, not an easy case. */
function essentialsStressModules(): unknown[] {
  const routeIds = Array.from({ length: 12 }, (_, i) => String(i + 1));
  return [
    { module: 'dhmz-cap', tier: 'open', status: 'live', fetchedAt: new Date().toISOString(), attribution: ATTR, items: [] },
    { module: 'prometnice', tier: 'open', status: 'live', fetchedAt: new Date().toISOString(), attribution: ATTR, items: [{ id: 'c1', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Petra i Tome Erdödyja' }] },
    {
      module: 'zet-rt', tier: 'open', status: 'live', fetchedAt: new Date().toISOString(), sourceUpdatedAt: new Date().toISOString(),
      attribution: {
        text: 'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669',
        url: 'https://www.zet.hr/gtfs-rt-protobuf', licence: 'Otvorena dozvola',
      },
      items: [...routeIds.map((id) => essentialsVehiclePin(`v${id}`, id)), ...routeIds.map((id) => essentialsRouteSummary(id, 90))],
    },
  ];
}

async function stubTeaserModules(page: Page, modules: unknown[]): Promise<void> {
  await page.route('**/api/teaser', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modules }) });
  });
}

test.describe('the essentials board never scrolls under the production load (F5 / R-P7)', () => {
  for (const face of FACES) {
    test(`${face} face: "Osnovno" fits the closures row and the fixed routes row above the safety strip, no internal scroll -- screenshot saved`, async ({ page, request }) => {
      await stubTeaserModules(page, essentialsStressModules());
      const { kioskUrl } = await provisionKiosk(request, APP_URL);
      await openLockedKiosk(page, face, kioskUrl);

      await page.getByTestId('kiosk-essentials-open').click();
      const panel = page.getByTestId('kiosk-essentials');
      await expect(panel).toBeVisible();

      const rows = page.locator('[data-testid=kiosk-essentials-rows] [data-testid=ess-row]');
      const count = await rows.count();
      expect(count, `${face}: closures and the routes row both rendered`).toBe(2);
      const strip = await box(page, '[data-testid=safety-strip]');
      for (let i = 0; i < count; i++) {
        const r = await rows.nth(i).boundingBox();
        expect(r, `${face}: essentials row ${i} has a box`).not.toBeNull();
        expect(r!.y + r!.height, `${face}: essentials row ${i} ends above the safety strip`).toBeLessThanOrEqual(strip.y);
      }

      const fit = await panel.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
      expect(fit.scrollHeight - fit.clientHeight, `${face}: the essentials panel needs no internal scroll`).toBeLessThanOrEqual(1);

      const rowsText = await page.locator('[data-testid=kiosk-essentials-rows]').innerText();
      expect(rowsText, 'the row is retitled').toContain('Linije u blizini');
      expect(rowsText, 'never a raw-seconds figure anywhere on the board').not.toMatch(/\d s\b/);

      await page.screenshot({ path: `${SHOTS_DIR}/kiosk-1080p-essentials-${face}.png`, fullPage: false });
    });
  }
});

// --- F8 / R-F11: the board must fit every combination, not just the pair --
// R-F11 (was P-1): F5 fixed the pair the production screenshot showed and
// flagged that all five rows at once -- a live CAP warning, closures, the
// routes row, weather and the pharmacy -- still scrolled inside the panel,
// which R-P7 promises it never will (a kiosk has no scroll wheel). This
// stubs every one of the five sources with real, unhelpful-length content
// (38 closures, a dozen routes, a long CAP title) and proves the board fits
// on one 1080p screen with no internal scroll, no two rows overlapping, and
// no detail line running past its two-line cap.

/** A CAP title long enough to press the two-line clamp, not merely sit on
 *  one short line -- the same discipline as the closures/routes fixture
 *  above, real trouble rather than an easy case. */
const LONG_CAP_TITLE = 'Upozorenje na obilnu kišu, grmljavinu i olujni vjetar diljem Zagrebačke regije do večernjih sati';

function essentialsFullStressModules(): unknown[] {
  const routeIds = Array.from({ length: 12 }, (_, i) => String(i + 1));
  const closureIds = Array.from({ length: 38 }, (_, i) => i + 1);
  return [
    {
      module: 'dhmz-cap', tier: 'open', status: 'live', fetchedAt: new Date().toISOString(), attribution: ATTR,
      items: [{ id: 'w1', module: 'dhmz-cap', kind: 'warning', tier: 'open', title: LONG_CAP_TITLE, severity: 'moderate' }],
    },
    {
      module: 'prometnice', tier: 'open', status: 'live', fetchedAt: new Date().toISOString(), attribution: ATTR,
      items: closureIds.map((n) => ({ id: `c${n}`, module: 'prometnice', kind: 'closure', tier: 'open', title: `Ulica broj ${n}` })),
    },
    {
      module: 'zet-rt', tier: 'open', status: 'live', fetchedAt: new Date().toISOString(), sourceUpdatedAt: new Date().toISOString(),
      attribution: {
        text: 'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669',
        url: 'https://www.zet.hr/gtfs-rt-protobuf', licence: 'Otvorena dozvola',
      },
      items: [...routeIds.map((id) => essentialsVehiclePin(`v${id}`, id)), ...routeIds.map((id) => essentialsRouteSummary(id, 90))],
    },
    {
      module: 'dhmz-now', tier: 'open', status: 'live', fetchedAt: new Date().toISOString(), attribution: ATTR,
      items: [{ id: 'o1', module: 'dhmz-now', kind: 'observation', tier: 'open', title: 'Maksimir', data: { temp: 24, weather: 'sunčano uz povremenu naoblaku' } }],
    },
    {
      module: 'ckan-geo', tier: 'open', status: 'live', fetchedAt: new Date().toISOString(), attribution: ATTR,
      items: [{ id: 'p1', module: 'ckan-geo', kind: 'poi', tier: 'open', title: 'Ljekarna Centar, Ilica 1', data: { category: 'ljekarne', duty: 'da' } }],
    },
  ];
}

/** Distinct line-box tops inside `selector`'s own text -- the same technique
 *  assertStageFits uses for the teaser headline, generalised to any element. */
async function lineCount(page: Page, handle: ReturnType<Page['locator']>): Promise<number> {
  return handle.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
    return new Set(rects.map((r) => Math.round(r.top))).size;
  });
}

test.describe('the essentials board fits all five rows at once (R-F11)', () => {
  for (const face of FACES) {
    test(`${face} face: "Osnovno" fits every one of the five rows above the strip, no internal scroll, no overlap, no detail past two lines -- screenshot saved`, async ({ page, request }) => {
      await stubTeaserModules(page, essentialsFullStressModules());
      const { kioskUrl } = await provisionKiosk(request, APP_URL);
      await openLockedKiosk(page, face, kioskUrl);

      await page.getByTestId('kiosk-essentials-open').click();
      const panel = page.getByTestId('kiosk-essentials');
      await expect(panel).toBeVisible();

      const rows = page.locator('[data-testid=kiosk-essentials-rows] [data-testid=ess-row]');
      const count = await rows.count();
      expect(count, `${face}: every one of the five sources rendered its row`).toBe(5);

      const strip = await box(page, '[data-testid=safety-strip]');
      const boxes: Box[] = [];
      for (let i = 0; i < count; i++) {
        const r = await rows.nth(i).boundingBox();
        expect(r, `${face}: essentials row ${i} has a box`).not.toBeNull();
        expect(r!.y + r!.height, `${face}: essentials row ${i} ends above the safety strip`).toBeLessThanOrEqual(strip.y);
        boxes.push(r!);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(overlaps(boxes[i], boxes[j]), `${face}: essentials row ${i} must not overlap row ${j}`).toBe(false);
        }
      }

      const fit = await panel.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
      expect(fit.scrollHeight - fit.clientHeight, `${face}: the essentials panel needs no internal scroll with all five rows populated`).toBeLessThanOrEqual(1);

      const details = page.locator('[data-testid=kiosk-essentials-rows] .ess-detail');
      const detailCount = await details.count();
      expect(detailCount, `${face}: cap, closures, routes and weather each carry a detail line`).toBe(4);
      for (let i = 0; i < detailCount; i++) {
        const lines = await lineCount(page, details.nth(i));
        expect(lines, `${face}: essentials detail ${i} is at most two lines tall`).toBeLessThanOrEqual(2);
      }

      const rowsText = await page.locator('[data-testid=kiosk-essentials-rows]').innerText();
      expect(rowsText, 'never a raw-seconds figure anywhere on the board').not.toMatch(/\d s\b/);

      await page.screenshot({ path: `${SHOTS_DIR}/kiosk-1080p-essentials-full-${face}.png`, fullPage: false });
    });
  }
});
