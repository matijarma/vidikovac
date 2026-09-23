// The phone gates: what the plan promises a person holding the phone, made
// testable on the fixture spine (a routed WebSocket and routed /api/data, so
// no real screen and no upstream). Runs in the `mobile` project only (Pixel 7:
// isMobile, hasTouch, a real device scale factor); the viewport is set per test
// because the same shell must hold at 390, 320 and in landscape.
//
// Every assertion here fails on its own check with a sentence naming the
// plan's target (`.ki-head`, `[data-testid=notice]`, `data-sheet`, 13 px,
// 44 px), never on a selector timeout: a missing target is read from the page
// and reported as the finding it is. Against main c3de057 most of these are
// red for the reasons the plan documents (banners overlay content, the map
// swipe traps the page, the header scrolls away, 12 px labels); each turns
// green when its area lands. The thresholds and the rules (geometry, type
// floor, targets) come from ./geometry, the one source this gate shares with
// scripts/audit-production.mjs.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import type { LayerId } from '../worker/protocol';
import { experienceSnapshots, FIXTURE_DASHBOARD, installExperienceFixture, type FixtureSession } from './experience-fixtures';
import { EDGE_TOLERANCE_PX, geometryIssues, PHONE_SHELL, PHONE_TYPE_FLOOR, ruleViolations, SOURCE_LINK_TARGETS, TARGET_MIN_PX, TYPE_FLOOR_PX } from './geometry';

// --- the numbers the plan fixes ------------------------------------------------
const PHONE = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
const LANDSCAPE = { width: 844, height: 390 };
const DESK = { width: 1440, height: 900 };
type Viewport = typeof PHONE;

const LAYERS: readonly LayerId[] = ['grad-sada', 'u-pokretu', 'zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'kultura'];
const DETENTS = ['peek', 'half', 'open'] as const;
type Detent = (typeof DETENTS)[number];
/** Sheet detents: peek 5rem; half 50% of the stage; open leaves 2.5rem of the stage. */
const PEEK_PX = 120;
const PEEK_TOLERANCE_PX = 2;
const HALF_TOLERANCE = 0.02;
const OPEN_GAP_PX = 40;
const OPEN_GAP_TOLERANCE_PX = 4;
/** Sada's promise at 390×844: three tiles of the city's now are on the first screen without a scroll. */
const SADA_FOLD_PX = 700;
const SADA_TILES_IN_FOLD = 3;
/** A lane snapped into place starts at the row's content edge within this much (sub-pixel layout, the row's 2 px inline padding). */
const LANE_SNAP_PX = 2;
/** A lane-changing swipe travels this much of the row: past half a lane pitch (the lane plus the 1.25rem gap, 378 px at 390) once the touch slop is spent; the mandatory snap then takes the nearer lane. 200 px lands within 4 px of the midpoint. */
const LANE_SWIPE_FRACTION = 0.6;
/** Bounded page heights with fixtures (plan, "Test updates", new test 7): the document a reader scrolls, layer and shell together. */
const GRAD_MAX_HEIGHT_PX = 3_000;
const SIGURNOST_MAX_HEIGHT_PX = 2_500;
/** The phone FAB's clearance (B.5): with data-fab main's foot is calc(var(--ki-tabs) + 5rem) against the base calc(var(--ki-tabs) + var(--sp-6)), 5rem − 1.5rem = 56 px more document under the last row, so the FAB never covers it. The bounds above predate the FAB; the allowance is granted only when the FAB is on the page. */
const FAB_CLEARANCE_PX = 56;
/** A long scroll, past any first viewport. */
const SCROLL_PX = 1_500;
/** One finger, 200 px, twelve moves 16 ms apart: the shape a real swipe has. */
const SWIPE_PX = 200;
const SWIPE_STEPS = 12;
const SWIPE_STEP_MS = 16;
/** How long the finger rests on a snapping row before it lifts (see touchPath). */
const SWIPE_HOLD_MS = 200;
/** The sheet transition is 220 ms; the map's camera ease is shorter. */
const SETTLE_MS = 600;
/** Session clock marks the notices hang on: 600 s session, 60 s and 20 s warnings. */
const SESSION_MS = 600_000;
const WARN_60_MS = 60_000;
const WARN_20_MS = 20_000;

const HR = JSON.parse(readFileSync(fileURLToPath(new URL('../app/src/i18n/hr.json', import.meta.url)), 'utf8')) as { session: { connecting: string } };

// --- helpers -------------------------------------------------------------------
interface Box { x: number; y: number; width: number; height: number; top: number; bottom: number; left: number; right: number; cx: number; cy: number }

/** The first match's box in CSS px, or null when there is none to measure. */
async function boxOf(page: Page, selector: string): Promise<Box | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return null;
    return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }, selector);
}

const fmt = (n: number): string => `${Math.round(n * 10) / 10} px`;
const boxText = (b: Box): string => `top ${fmt(b.top)}, bottom ${fmt(b.bottom)}, left ${fmt(b.left)}, right ${fmt(b.right)}`;
const insideViewport = (b: Box, vp: Viewport): boolean => b.top >= -1 && b.left >= -1 && b.bottom <= vp.height + 1 && b.right <= vp.width + 1;

/** The fixture-backed session at the given viewport, with Sada painted. */
async function openDashboard(page: Page, viewport: Viewport, url = FIXTURE_DASHBOARD): Promise<FixtureSession> {
  await page.setViewportSize(viewport);
  const fixture = await installExperienceFixture(page, await experienceSnapshots());
  await page.goto(url);
  await expect(page.getByTestId('tb'), 'Sada must paint from the fixture').toBeVisible();
  await expect(page.getByTestId('session-label')).toBeVisible();
  return fixture;
}

/**
 * The phone's tab when the domain has one; otherwise the directory (Još in the
 * desk's status line, the tab bar's Još on the phone, D10), then the domain's
 * row or any other way in. A Sada tile also carries data-action=nav with a
 * selection, so the tab and the directory come first.
 */
async function openLayer(page: Page, layer: LayerId): Promise<void> {
  // The desk pair (WP4 chunk E) shows Sada and Karta side by side inside .ki-desk: either is already on the page.
  const shown = page.locator(`[data-testid="dash-view"] .layer[data-layer="${layer}"]`);
  const tab = page.locator(`.ki-tab[data-layer="${layer}"]:visible`).first();
  if (await tab.count()) {
    await tab.click();
  } else if (!(await shown.count())) {
    await page.locator('[data-testid="status-more"]:visible, [data-testid="tab-more"]:visible').first().click();
    await page.locator(`[data-testid="dir-${layer}"], [data-action="nav"][data-layer="${layer}"]:visible`).first().click();
  }
  await expect(shown).toBeVisible();
}

/** The layer's own data has arrived and been painted: the fixture's request count stops moving, then a frame passes. */
async function settle(page: Page, fixture: FixtureSession): Promise<void> {
  let seen = -1;
  await expect.poll(async () => {
    const count = fixture.requests.length;
    await page.waitForTimeout(400);
    const stable = fixture.requests.length === count && count === seen;
    seen = fixture.requests.length;
    return stable;
  }, { message: 'the fixture requests must settle', timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(150);
}

async function scrollDocument(page: Page, y: number): Promise<void> {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await page.waitForTimeout(150);
}

const scrollY = (page: Page): Promise<number> => page.evaluate(() => window.scrollY);

interface Point { x: number; y: number }

/**
 * A one-finger drag through the real touch pipeline (CDP), from one point to
 * another, as a person swipes; `holdMs` keeps the finger still before it
 * lifts. A lift straight after fast moves reads as a fling the synthetic
 * events carry no velocity for, so a snapping scroller neither flings nor
 * snaps; a finger that rests first makes the release a plain scroll end,
 * which the browser snaps to the nearest lane.
 */
async function touchPath(cdp: CDPSession, page: Page, from: Point, to: Point, holdMs = 0): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= SWIPE_STEPS; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / SWIPE_STEPS, y: from.y + ((to.y - from.y) * i) / SWIPE_STEPS }] });
    await page.waitForTimeout(SWIPE_STEP_MS);
  }
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(SETTLE_MS);
}

/** A vertical swipe at x, from y0 to y1: a scroll or a sheet drag. */
const touchDrag = (cdp: CDPSession, page: Page, x: number, y0: number, y1: number): Promise<void> => touchPath(cdp, page, { x, y: y0 }, { x, y: y1 });
/** A horizontal swipe at y, from x0 to x1, the finger resting before it lifts: a pan across the snapping lane row. */
const touchDragX = (cdp: CDPSession, page: Page, y: number, x0: number, x1: number): Promise<void> => touchPath(cdp, page, { x: x0, y }, { x: x1, y }, SWIPE_HOLD_MS);

/** The map has settled into a state the stage can be measured in. */
async function waitForMap(page: Page, states: RegExp): Promise<void> {
  await expect(page.getByTestId('map-canvas'), 'the Promet map must reach a settled status').toHaveAttribute('data-map-status', states, { timeout: 30_000 });
  await page.waitForTimeout(300);
}

const workspace = (page: Page) => page.locator('[data-testid=transport-workspace]');
const detentOf = async (page: Page): Promise<string | null> => workspace(page).getAttribute('data-sheet');

/** Presses the chevron until the sheet reports `target`; an unreachable detent is the finding. */
async function cycleTo(page: Page, target: Detent): Promise<void> {
  const seen: (string | null)[] = [await detentOf(page)];
  for (let i = 0; i < DETENTS.length && seen[seen.length - 1] !== target; i++) {
    await page.locator('[data-action=toggle-sheet]').click();
    await page.waitForTimeout(SETTLE_MS);
    seen.push(await detentOf(page));
  }
  expect(seen[seen.length - 1], `the chevron must be able to reach data-sheet="${target}"; cycling produced ${seen.join(' → ')}`).toBe(target);
}

/** How much of the sheet is on the stage: its box clipped to the stage's box. */
async function visibleSheetHeight(page: Page): Promise<{ sheet: number; stage: number }> {
  return page.evaluate(() => {
    const sheet = document.querySelector('[data-testid=transport-sheet]')?.getBoundingClientRect();
    const stage = document.querySelector('.transport-body')?.getBoundingClientRect();
    if (!sheet || !stage) return { sheet: -1, stage: -1 };
    const visible = Math.max(0, Math.min(sheet.bottom, stage.bottom) - Math.max(sheet.top, stage.top));
    return { sheet: visible, stage: stage.height };
  });
}

/** A hash of the map's free pixels: the canvas box above the sheet (the whole canvas when the sheet is elsewhere), so a
 *  moving sheet body cannot masquerade as a camera move. WebGL need not preserve its buffer; a page screenshot reads the composed frame. */
async function mapHash(page: Page): Promise<string> {
  const clip = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid=map-canvas]')?.getBoundingClientRect();
    if (!canvas) return null;
    const sheet = document.querySelector('[data-testid=transport-sheet]')?.getBoundingClientRect();
    const top = Math.max(0, canvas.top);
    const overlaps = sheet && sheet.top < canvas.bottom && sheet.bottom > canvas.top && sheet.left < canvas.right && sheet.right > canvas.left;
    const bottom = Math.min(innerHeight, overlaps ? Math.min(canvas.bottom, sheet.top) : canvas.bottom);
    return { x: Math.max(0, canvas.left), y: top, width: Math.min(innerWidth, canvas.right) - Math.max(0, canvas.left), height: bottom - top };
  });
  expect(clip, 'the map canvas must be on the page to compare its pixels').not.toBeNull();
  expect(clip!.height, `the free map strip above the sheet must be tall enough to compare (got ${fmt(clip!.height)})`).toBeGreaterThanOrEqual(16);
  const shot = await page.screenshot({ clip: clip!, animations: 'disabled', caret: 'hide' });
  return createHash('sha256').update(shot).digest('hex');
}

/** Two frames half a second apart agree: tiles are in, nothing eases, the next difference is the swipe's. */
async function waitForStillMap(page: Page): Promise<string> {
  let last = '';
  await expect.poll(async () => {
    const a = await mapHash(page);
    await page.waitForTimeout(500);
    const b = await mapHash(page);
    last = b;
    return a === b;
  }, { message: 'the map must settle before a swipe is measured (its pixels kept changing for 20 s)', timeout: 20_000 }).toBe(true);
  return last;
}

// --- 1. geometry at three sizes ----------------------------------------------------
for (const viewport of [PHONE, SMALL, LANDSCAPE]) {
  test(`the shell fits a ${viewport.width}×${viewport.height} phone: nothing overlays Sada, the tab bar is flush with the bottom, and the session pill and safety control survive a long scroll on Događanja and Sigurnost`, async ({ page }) => {
    const fixture = await openDashboard(page, viewport);
    await settle(page, fixture);
    expect(await geometryIssues(page, PHONE_SHELL), `Sada at ${viewport.width}×${viewport.height}`).toEqual([]);

    if (viewport === PHONE) {
      // The composition, not the scroll: three tiles of the city's now are on the first screen (a skeleton is not the city).
      const tiles = await page.evaluate((fold) => [...document.querySelectorAll('[data-testid=tb-lane-sada] .tl:not([data-skeleton])')].map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.getAttribute('data-key') ?? el.getAttribute('data-testid') ?? el.className, top: Math.round(r.top), bottom: Math.round(r.bottom), inFold: r.top < fold && r.bottom > 0 };
      }), SADA_FOLD_PX);
      const inFold = tiles.filter((t) => t.inFold);
      expect(inFold.length, `at least ${SADA_TILES_IN_FOLD} sada tiles ([data-testid=tb-lane-sada] .tl, skeletons excluded) must reach into the first ${SADA_FOLD_PX} px of Sada at ${PHONE.width}×${PHONE.height}; the tiles measure ${tiles.map((t) => `${t.id} ${t.top}→${t.bottom}`).join(', ') || 'nothing'}`).toBeGreaterThanOrEqual(SADA_TILES_IN_FOLD);
    }

    for (const layer of ['kultura', 'sigurnost'] as const) {
      await openLayer(page, layer);
      await settle(page, fixture);
      await scrollDocument(page, SCROLL_PX);
      const scrolled = await scrollY(page);
      for (const testid of ['session-label', 'safety-shortcut'] as const) {
        const box = await boxOf(page, `[data-testid=${testid}]`);
        expect(box, `after scrolling to ${scrolled} px on ${layer} at ${viewport.width}×${viewport.height}, [data-testid=${testid}] must still be rendered`).not.toBeNull();
        expect(insideViewport(box!, viewport), `after scrolling to ${scrolled} px on ${layer} at ${viewport.width}×${viewport.height}, [data-testid=${testid}] must stay in the viewport; its box is ${boxText(box!)}`).toBe(true);
      }
    }
  });
}

// --- 2. sticky chrome -----------------------------------------------------------------
test('the header stays pinned: after scrolling 1,500 px on Sada, .ki-head still starts at the top edge', async ({ page }) => {
  const fixture = await openDashboard(page, PHONE);
  await settle(page, fixture);
  await scrollDocument(page, SCROLL_PX);
  const scrolled = await scrollY(page);
  const head = await boxOf(page, PHONE_SHELL.header);
  expect(head, `the sticky header ${PHONE_SHELL.header} must exist so the session pill and the safety control never scroll away; none is rendered`).not.toBeNull();
  expect(Math.abs(head!.top), `after scrolling to ${scrolled} px the header ${PHONE_SHELL.header} must start at 0 ± 1 px; it starts at ${fmt(head!.top)}`).toBeLessThanOrEqual(1);
});

// --- 3. detents ------------------------------------------------------------------------
test('the Promet sheet cycles search-visible peek, 38% detail and open; handle and body drags snap between detents', async ({ page }) => {
  await openDashboard(page, PHONE);
  await openLayer(page, 'u-pokretu');
  await waitForMap(page, /^(ready|tiles-failed|unavailable)$/);

  const start = await detentOf(page);
  expect(DETENTS as readonly string[], `data-sheet must be one of peek, half, open; it reads "${start}"`).toContain(start ?? '');
  const startIndex = DETENTS.indexOf(start as Detent);
  const expected = [1, 2, 3].map((i) => DETENTS[(startIndex + i) % DETENTS.length]);
  const seen: (string | null)[] = [];
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-action=toggle-sheet]').click();
    await page.waitForTimeout(SETTLE_MS);
    seen.push(await detentOf(page));
  }
  expect(seen, `from "${start}" the chevron must cycle peek → half → open and return; it produced ${seen.join(' → ')}`).toEqual(expected);

  await cycleTo(page, 'peek');
  const peek = await visibleSheetHeight(page);
  expect(peek.stage, 'the stage .transport-body must have a box').toBeGreaterThan(0);
  expect(Math.abs(peek.sheet - PEEK_PX), `at peek the sheet shows ${PEEK_PX} ± ${PEEK_TOLERANCE_PX} px of itself; it shows ${fmt(peek.sheet)} of a ${fmt(peek.stage)} stage`).toBeLessThanOrEqual(PEEK_TOLERANCE_PX);

  await cycleTo(page, 'half');
  const half = await visibleSheetHeight(page);
  expect(Math.abs(half.sheet - half.stage * 0.38), `the detail detent preserves the map and covers 38% of the stage; it shows ${fmt(half.sheet)} of ${fmt(half.stage)}`).toBeLessThanOrEqual(HALF_TOLERANCE * half.stage);

  await cycleTo(page, 'open');
  const open = await visibleSheetHeight(page);
  expect(Math.abs(open.stage - open.sheet - OPEN_GAP_PX), `at open the sheet leaves ${OPEN_GAP_PX} ± ${OPEN_GAP_TOLERANCE_PX} px of the stage visible; it leaves ${fmt(open.stage - open.sheet)}`).toBeLessThanOrEqual(OPEN_GAP_TOLERANCE_PX);

  const cdp = await page.context().newCDPSession(page);
  await cycleTo(page, 'half');
  const head = await boxOf(page, '.t-sheet-head');
  expect(head, 'the sheet head .t-sheet-head must be rendered to drag').not.toBeNull();
  await touchDrag(cdp, page, head!.cx, head!.cy, head!.cy - SWIPE_PX);
  expect(await detentOf(page), `a ${SWIPE_PX} px upward drag on the sheet head from half must end at open`).toBe('open');

  await cycleTo(page, 'open');
  const body = page.locator('[data-testid=transport-detail]');
  await body.evaluate((el) => { el.scrollTop = 0; });
  const bodyBox = await boxOf(page, '[data-testid=transport-detail]');
  expect(bodyBox, 'the sheet body [data-testid=transport-detail] must be rendered to drag').not.toBeNull();
  await touchDrag(cdp, page, bodyBox!.cx, bodyBox!.cy, bodyBox!.cy + SWIPE_PX);
  expect(await detentOf(page), `a ${SWIPE_PX} px downward drag on the sheet body at scrollTop 0 from open must end at half`).toBe('half');
});

// --- 4. scroll versus pan --------------------------------------------------------------
test('one finger does one thing: a swipe over the Promet map pans the camera and leaves the page put, a swipe over the open sheet body scrolls the body and not the camera, a swipe over Sada scrolls the page', async ({ page }) => {
  await openDashboard(page, PHONE);
  await openLayer(page, 'u-pokretu');
  await waitForMap(page, /^ready$/);
  const cdp = await page.context().newCDPSession(page);

  await cycleTo(page, 'peek');
  const canvas = await boxOf(page, '[data-testid=map-canvas]');
  expect(canvas, 'the map canvas must be on the page').not.toBeNull();
  const before = await waitForStillMap(page);
  const y0 = await scrollY(page);
  await touchDrag(cdp, page, canvas!.cx, canvas!.cy, canvas!.cy - SWIPE_PX);
  const y1 = await scrollY(page);
  expect(y1, `a swipe over the map must not scroll the page: scrollY went ${y0} → ${y1} (Promet is a fixed stage)`).toBe(0);
  expect(await mapHash(page), `a ${SWIPE_PX} px swipe over the map must move the camera: the map pixels are identical before and after`).not.toBe(before);

  await cycleTo(page, 'open');
  const body = page.locator('[data-testid=transport-detail]');
  await body.evaluate((el) => { el.scrollTop = 0; });
  const scrollable = await body.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: getComputedStyle(el).overflowY }));
  // Soft: when the body is not a scroller yet, the Sada fact below still reports.
  expect.soft(scrollable.scrollHeight > scrollable.clientHeight + 1 && /auto|scroll/.test(scrollable.overflowY), `at open the sheet body must be its own scroll container with more content than box: scrollHeight ${scrollable.scrollHeight}, clientHeight ${scrollable.clientHeight}, overflow-y ${scrollable.overflowY}`).toBe(true);
  const bodyBox = await boxOf(page, '[data-testid=transport-detail]');
  expect(bodyBox, 'the sheet body [data-testid=transport-detail] must be rendered').not.toBeNull();
  const camera = await waitForStillMap(page);
  await touchDrag(cdp, page, bodyBox!.cx, Math.min(bodyBox!.cy, PHONE.height - 100), Math.min(bodyBox!.cy, PHONE.height - 100) - SWIPE_PX);
  const bodyScroll = await body.evaluate((el) => el.scrollTop);
  expect.soft(bodyScroll, `a swipe over the open sheet body must scroll the body; its scrollTop is ${bodyScroll}`).toBeGreaterThan(0);
  expect.soft(await scrollY(page), 'a swipe over the sheet body must not scroll the page').toBe(0);
  expect.soft(await mapHash(page), 'a swipe over the sheet body must leave the camera unchanged; the map pixels above the sheet moved').toBe(camera);

  await openLayer(page, 'grad-sada');
  await scrollDocument(page, 0);
  const main = await boxOf(page, PHONE_SHELL.main);
  expect(main, 'Sada must be rendered in main').not.toBeNull();
  const y = Math.min(main!.cy, PHONE.height * 0.6);
  await touchDrag(cdp, page, main!.cx, y, y - SWIPE_PX);
  const sadaScroll = await scrollY(page);
  expect(sadaScroll, `a swipe over Sada must scroll the document; scrollY stayed at ${sadaScroll}`).toBeGreaterThan(0);
});

// --- 4b. the time band's phone form ---------------------------------------------------------
test('time filtering changes the agenda without losing local information or presenting it automatically', async ({ page }) => {
  const fixture = await openDashboard(page, PHONE);
  await settle(page, fixture);
  const segment = (col: string) => page.locator(`[data-testid=tb-seg] .day-time[data-filter-value=${col}]`);
  await expect(segment('sada'), 'the sada segment is pressed at first').toHaveAttribute('aria-pressed', 'true');
  await segment('sutra').click();
  await expect(segment('sutra')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.day-event').evaluateAll(rows => rows.every(row => row.getAttribute('data-col') === 'sutra'))).toBe(true);
  await expect(page.getByTestId('tb-lane-sada')).toBeVisible();
  await segment('veceras').click();
  await expect(segment('veceras')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.day-event').evaluateAll(rows => rows.every(row => row.getAttribute('data-col') === 'veceras'))).toBe(true);
  expect(fixture.events.filter(event => event.t === 'present' || event.t === 'view')).toEqual([]);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `the lane row scrolls inside itself; the document must not widen past ${PHONE.width} px (it is ${scrollWidth} px)`).toBeLessThanOrEqual(PHONE.width + EDGE_TOLERANCE_PX);
});

// --- 5. type floor ----------------------------------------------------------------------
test(`no visible text on any layer at 390 px is set below ${TYPE_FLOOR_PX} px (attribution lines excepted), and every link in a source line is a ${TARGET_MIN_PX} px target`, async ({ page }) => {
  const fixture = await openDashboard(page, PHONE);
  const small = new Map<string, string>();
  const shortLinks: string[] = [];
  for (const layer of LAYERS) {
    await openLayer(page, layer);
    if (layer === 'u-pokretu') await waitForMap(page, /^(ready|tiles-failed|unavailable)$/);
    await settle(page, fixture);
    // The rule engine opens every closed source disclosure first: a closed details renders no links to measure.
    const found = await ruleViolations(page, { typeFloor: PHONE_TYPE_FLOOR, targets: [SOURCE_LINK_TARGETS], openDetails: true });
    for (const { rule, detail } of found) {
      if (rule === 'type-floor') { if (!small.has(detail)) small.set(detail, `${layer}: ${detail}`); }
      else shortLinks.push(`${layer}: ${detail}`);
    }
  }
  const smallList = [...small.values()];
  expect.soft(smallList.length, `${smallList.length} visible text(s) below the ${TYPE_FLOOR_PX} px floor at 390 px:\n${smallList.slice(0, 40).join('\n')}${smallList.length > 40 ? `\n… and ${smallList.length - 40} more` : ''}`).toBe(0);
  expect(shortLinks.length, `${shortLinks.length} link(s) inside .provenance or .source below the ${TARGET_MIN_PX} px target:\n${shortLinks.slice(0, 40).join('\n')}${shortLinks.length > 40 ? `\n… and ${shortLinks.length - 40} more` : ''}`).toBe(0);
});

// --- 6. bounded heights ------------------------------------------------------------------
/** The document height a reader scrolls, and whether the shell has the FAB on this page (a scanner with a screen, any layer but Promet). */
async function documentHeight(page: Page): Promise<{ height: number; fab: boolean }> {
  return page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    fab: document.querySelector('.ki')?.getAttribute('data-fab') === '1',
  }));
}

test(`with fixtures at 390 px Grad stays under ${GRAD_MAX_HEIGHT_PX} px of document height`, async ({ page }) => {
  const fixture = await openDashboard(page, PHONE);
  await openLayer(page, 'uprava-i-pravo');
  await settle(page, fixture);
  const { height, fab } = await documentHeight(page);
  const bound = GRAD_MAX_HEIGHT_PX + (fab ? FAB_CLEARANCE_PX : 0);
  expect(height, `Grad renders ${height} px of document; the plan bounds it under ${GRAD_MAX_HEIGHT_PX} px (paged lists, "Prikaži još")${fab ? ` plus the FAB's ${FAB_CLEARANCE_PX} px clearance` : ''}`).toBeLessThan(bound);
});

test(`with fixtures at 390 px Sigurnost stays under ${SIGURNOST_MAX_HEIGHT_PX} px of document height`, async ({ page }) => {
  const fixture = await openDashboard(page, PHONE);
  await openLayer(page, 'sigurnost');
  await settle(page, fixture);
  const { height, fab } = await documentHeight(page);
  const bound = SIGURNOST_MAX_HEIGHT_PX + (fab ? FAB_CLEARANCE_PX : 0);
  expect(height, `Sigurnost renders ${height} px of document; the plan bounds it under ${SIGURNOST_MAX_HEIGHT_PX} px (assembly points paged)${fab ? ` plus the FAB's ${FAB_CLEARANCE_PX} px clearance` : ''}`).toBeLessThan(bound);
});

// --- 7. zoom-compact ----------------------------------------------------------------------
/** The five time words the segments carry (A.4): one pill each, in time order. */
const SEGMENT_COUNT = 5;

/**
 * The zoom-compact facts at 200% text. The document keeps the viewport's width
 * (a document wider than the viewport widens the layout viewport under mobile
 * emulation, the fixed tab bar follows it and a tab's tap lands on a tile);
 * no overflow in the header or the tab bar; on Sada every time segment shows
 * its whole word (WCAG 1.4.4: a pill that clips or ellipsises one loses
 * content for a sighted reader while its aria-label keeps it from AT only);
 * the current tab's label whole. `segments` says whether Sada's segments are
 * expected on the page: the directory replaces the workspace, so they are not there.
 */
async function zoomCompactIssues(page: Page, viewport: Viewport, { segments }: { segments: boolean }): Promise<string[]> {
  return page.evaluate(({ header, tabbar, width, tolerance, segments, count }) => {
    const out: string[] = [];
    const docWidth = document.documentElement.scrollWidth;
    if (docWidth > width + tolerance) out.push(`the document widens past the ${width} px viewport at 200%: scrollWidth ${docWidth} px, layout viewport ${window.innerWidth} px; a widened page moves the fixed tab bar out from under a finger`);
    for (const [label, sel] of [['header', header], ['tab bar', tabbar]] as const) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el || el.getBoundingClientRect().height <= 0) { out.push(`the ${label} ${sel} is missing or hidden`); continue; }
      if (el.scrollWidth > el.clientWidth + 1) out.push(`the ${label} ${sel} overflows horizontally at 200%: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
    }
    if (segments) {
      const seg = document.querySelector<HTMLElement>('[data-testid=tb-seg]');
      const spans = seg ? [...seg.querySelectorAll<HTMLElement>('.day-time')] : [];
      if (!seg || seg.getBoundingClientRect().height <= 0) out.push('the time segments [data-testid=tb-seg] must show on the phone at 200%');
      else if (spans.length !== count) out.push(`the segments carry ${spans.length} words; ${count} time words expected`);
      for (const span of spans) {
        const word = span.textContent?.trim() ?? '';
        const pill = span.getBoundingClientRect();
        if (pill.width < 1 || pill.height < 1) { out.push(`the segment "${word}" has no box at 200%`); continue; }
        // The text's own laid-out extent (a Range rect: layout geometry, unchanged by clipping or by the ellipsis
        // text-overflow paints over it) against the pill it is painted in. The pill has no border, so its rect is the
        // padding box overflow: hidden clips at; text inside it is whole even where it eats the padding, text past
        // it is lost. scrollWidth is not the measure here: a flex container counts its end padding as scrollable
        // overflow, so it reports a word that merely touches the padding as overflowing.
        const range = document.createRange();
        range.selectNodeContents(span);
        const text = range.getBoundingClientRect();
        const lostStart = Math.round(pill.left - text.left);
        const lostEnd = Math.round(text.right - pill.right);
        if (lostStart > tolerance || lostEnd > tolerance) {
          out.push(`the segment "${word}" is not whole at 200%: its text runs ${Math.round(text.width)} px in a ${Math.round(pill.width)} px pill, ${Math.max(0, lostStart)} px lost at the start and ${Math.max(0, lostEnd)} px at the end; the time words never clip or ellipsise`);
        }
      }
    }
    const tab = document.querySelector<HTMLElement>('.ki-tab[aria-current="page"]');
    const text = tab?.querySelector<HTMLElement>('.ki-nav-label');
    if (!tab || !text) { out.push('the current tab .ki-tab[aria-current="page"] must carry a .ki-nav-label'); return out; }
    const r = text.getBoundingClientRect();
    const cs = getComputedStyle(text);
    if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden') out.push(`the current tab's label "${text.textContent?.trim()}" is not visible at 200%`);
    else {
      const t = tab.getBoundingClientRect();
      if (text.scrollWidth > text.clientWidth + 1) out.push(`the current tab's label "${text.textContent?.trim()}" is clipped at 200% (scrollWidth ${text.scrollWidth} > clientWidth ${text.clientWidth}); labels never ellipsise`);
      if (r.left < t.left - 1 || r.right > t.right + 1) out.push(`the current tab's label "${text.textContent?.trim()}" spills out of its tab cell at 200%`);
    }
    return out;
  }, { header: PHONE_SHELL.header, tabbar: PHONE_SHELL.tabbar, width: viewport.width, tolerance: EDGE_TOLERANCE_PX, segments, count: SEGMENT_COUNT });
}

test('at 200% text the document keeps its width, the header and the tab bar have no horizontal overflow, every time segment keeps a whole word and the current tab keeps a whole label, on Sada and with the directory open', async ({ page }) => {
  const fixture = await openDashboard(page, PHONE);
  await settle(page, fixture);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await page.waitForTimeout(300);
  expect(await zoomCompactIssues(page, PHONE, { segments: true }), 'zoom-compact state at 200% text on Sada').toEqual([]);
  await page.getByTestId('tab-more').click();
  await expect(page.locator('#layer-directory'), 'Još must open the directory').toBeVisible();
  await expect(page.getByTestId('tab-more')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('tab-more')).toHaveText('Još');
  await page.waitForTimeout(300);
  expect(await zoomCompactIssues(page, PHONE, { segments: false }), 'zoom-compact state at 200% text with the directory open').toEqual([]);
});

// --- 8. landing -----------------------------------------------------------------------------
test('the landing at 390 px leads with purpose, product imagery and a route to trial without a code', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const response = await page.goto('/');
  expect(response?.status(), '/ must answer 200').toBe(200);
  const found = await page.evaluate(() => {
    const story = document.querySelector('[data-testid=cta-story]');
    const kiosk = document.querySelector('[data-testid=cta-kiosk]');
    const product = document.querySelector('.ld-hero-visual');
    return {
      story: story?.getAttribute('href'),
      kiosk: kiosk?.getAttribute('href'),
      productTop: product?.getBoundingClientRect().top,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  expect(found.story).toBe('#kako-radi');
  expect(found.kiosk).toBe('/kiosk/');
  expect(found.productTop).toBeLessThan(PHONE.height - 100);
  expect(found.overflow).toBeLessThanOrEqual(1);
  await page.getByTestId('cta-try').click();
  await expect(page.getByTestId('cta-kiosk')).toBeVisible();
  await expect(page.locator('.ld-nav a[href="/s/"]')).toHaveCount(1);
});

// --- 9. notice row ------------------------------------------------------------------------------
test('the expiry notices sit in the banners row without covering content: expiring60 at one minute, expiring20 at twenty seconds, then the frozen card and no notice', async ({ page }) => {
  const fixture = await openDashboard(page, PHONE);
  await settle(page, fixture);
  const notice = page.locator('[data-testid=notice]');
  const kinds = async (): Promise<string[]> => notice.evaluateAll((els) => els.map((el) => el.getAttribute('data-kind') ?? '(none)'));

  await page.clock.fastForward(SESSION_MS - WARN_60_MS);
  await page.waitForTimeout(150);
  const at60 = await kinds();
  expect(at60, `at 60 s before expiry a [data-testid=notice][data-kind=expiring60] must be in the banners row (plan: Session lifecycle); found ${at60.length ? at60.join(', ') : 'no notice'}`).toEqual(['expiring60']);
  await expect(notice.first(), 'the expiring60 notice must be visible').toBeVisible();
  expect(await geometryIssues(page, { ...PHONE_SHELL, rules: ['overlay'] }), 'the notice must not intersect any child of main').toEqual([]);

  await page.clock.fastForward(WARN_60_MS - WARN_20_MS);
  await page.waitForTimeout(150);
  const at20 = await kinds();
  expect(at20, `at 20 s before expiry the notice must read data-kind=expiring20; found ${at20.length ? at20.join(', ') : 'no notice'}`).toEqual(['expiring20']);
  expect(await geometryIssues(page, { ...PHONE_SHELL, rules: ['overlay'] }), 'the notice must not intersect any child of main').toEqual([]);

  fixture.expire();
  await expect(page.getByTestId('frozen-line'), 'after expiry the frozen card must be visible').toBeVisible();
  const afterExpiry = await kinds();
  expect(afterExpiry, `after expiry no notice may remain; found ${afterExpiry.join(', ')}`).toEqual([]);
});

// --- 10. desktop first paint ------------------------------------------------------------------------
/** The desk's directory (D10, [O-60]): the same four rows as the phone's Još, the week's agenda first. */
const DESK_DIRECTORY: readonly LayerId[] = ['kultura', 'zrak-i-nebo', 'uprava-i-pravo', 'sigurnost'];

test('at 1440 the desk paints before the session joins, keeps the screen control in the header and opens the domain directory', async ({ page }) => {
  await page.setViewportSize(DESK);
  // A room that never answers: the join is swallowed, so the page stays in its first paint.
  await page.routeWebSocket('**/ws/room/**', () => {});
  await page.goto(FIXTURE_DASHBOARD);
  const label = page.getByTestId('session-label');
  await expect(label, 'the session card must be part of the first paint').toBeVisible();
  await expect(label, `before the join the session card reads "${HR.session.connecting}"`).toContainText(HR.session.connecting);
  await expect(page.locator('nav[data-region=side]'), 'the rail is gone at the desk (D10)').toHaveCount(0);
  const more = page.getByTestId('status-more');
  await expect(more, 'Još must stand in the desk status line before any data arrives').toBeVisible();
  await more.click();
  const rows = page.locator('[data-testid=dash-view] .dir-item[data-layer]');
  await expect(rows, 'the directory lists the four extra domains').toHaveCount(DESK_DIRECTORY.length);
  expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-layer'))), 'the directory rows in order').toEqual(DESK_DIRECTORY);
  for (const layer of DESK_DIRECTORY) await expect(page.getByTestId(`dir-${layer}`), `the directory row dir-${layer}`).toBeVisible();
  await expect(page.getByTestId('kvart-aside'), 'the kvart aside is gone entirely, not merely hidden').toHaveCount(0);
  await expect(page.getByTestId('dir-kultura').locator('.row-title'), 'the agenda row names the week').toHaveText('Događanja ovaj tjedan');
  await expect(page.locator('.ki-domains [data-layer]'), 'the desk has no six-domain bar').toHaveCount(0);
});
