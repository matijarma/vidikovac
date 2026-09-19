// Round F in a real browser: the rendering stream F1-F5 landed, proved on the
// city map rather than in a jsdom stand-in.
//
// Four claims, in two scenarios:
//   1. two trams 20 m apart keep BOTH numbers -- two pills or one cluster
//      whose label lists both (F2, design A);
//   2. the direction nose keeps to its band -- drawn at 15.5, gone at 17
//      (F2, design D);
//   3. line focus hides the rest of the network and lights the selected line
//      in ZET's own colour (F5, design C);
//   4. the switch puts the network back and remembers the choice.
//
// The evidence is the same shape motion.spec.ts uses: a `zet-rt` snapshot
// carrying a plan, injected at the browser's network layer, over the real
// committed geometry (e2e/schema-fixtures.ts). Nothing here depends on the
// live ZET feed, and no application route or bypass exists to fake one.
//
// The assertions read the read-only `data-*` attributes the city map writes
// for exactly this (`data-frames` has stood there since T11): `data-zoom`,
// `data-pills`, `data-noses` and `data-focus`. `data-pills` and `data-noses`
// are read off the SCREEN -- one queryRenderedFeatures over the two pill
// layers and the nose layer, taken when MapLibre goes idle -- so "both
// numbers are there" is a statement about what was drawn, not about the
// collection that was handed to it. See the probe block in
// app/src/map/city-map.ts for what each costs and when it is taken.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FIXTURE_NOW } from '../test/feed/fixture-contexts';
import { experienceSnapshots, FIXTURE_DASHBOARD, installExperienceFixture } from './experience-fixtures';
import { twoTramSnapshot, TWO_TRAM_ROUTES } from './schema-fixtures';

const root = resolve(import.meta.dirname, '..');
/** The table scripts/zet-schema.mjs writes beside the artefact (F5): what ZET
 *  prints line 6 in, and therefore what `network-selected` must be painted. */
const ZET_COLOURS = (JSON.parse(readFileSync(resolve(root, 'app/src/data/zet-line-colours.json'), 'utf8')) as
  { colours: Record<string, string> }).colours;
const [ROUTE_A, ROUTE_B] = TWO_TRAM_ROUTES;

const MAP = '[data-testid=map-canvas]';
const CANVAS = `${MAP} canvas`;

/** Every line number the pill layer is carrying, whether as its own pill or
 *  inside a cluster's label ("6·11"), sorted so the assertion does not depend
 *  on which mark the push happened to emit first. */
function numbersIn(pills: string | null): string[] {
  return (pills ?? '').split('|').filter(Boolean).flatMap((label) => label.split('·')).sort();
}

function probe(page: Page, name: 'zoom' | 'pills' | 'noses' | 'focus'): Promise<string | null> {
  return page.locator(MAP).getAttribute(`data-${name}`);
}

/**
 * The dashboard with two trams on one real path, on a clock that runs.
 *
 * `installExperienceFixture` installs Playwright's fake clock and stops it;
 * every scenario here drives the MapLibre camera, whose eases and whose 12 Hz
 * push both live on rAF, so the clock is resumed and the snapshot is rebuilt
 * at fulfil time (the route registered last wins) -- the plan is then always
 * fresh however long the run takes, and the two marks never stop 20 m apart.
 */
async function openTwoTrams(page: Page, routes: readonly [string, string] = TWO_TRAM_ROUTES): Promise<void> {
  const snapshots = await experienceSnapshots();
  snapshots['zet-rt'] = twoTramSnapshot(FIXTURE_NOW.getTime(), routes);
  await installExperienceFixture(page, snapshots);
  const started = Date.now();
  await page.route('**/api/data/zet-rt', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(twoTramSnapshot(FIXTURE_NOW.getTime() + (Date.now() - started), routes)),
  }));
  // The basemap's vector tiles live in an R2 bucket that is empty on a
  // developer's machine, so every one of them is a slow 503 from the single
  // wrangler process -- hundreds of them while MapLibre retries, which is
  // enough to starve the requests the page itself needs. Nothing asserted
  // here is about the basemap, so the tiles are answered at the browser with
  // "no tile" instead. The glyphs and the sprite are ordinary static assets
  // and are left alone: the pills' text needs them.
  await page.route('**/maps/zagreb-v1/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.clock.resume();
  await page.goto(FIXTURE_DASHBOARD);
  await page.locator('[data-action=nav][data-layer=u-pokretu]:visible').first().click();
  // The workspace now opens on the city's own group ("Zivi grad"), where the
  // transport modes are switched off entirely (workspace.ts modesArg) and no
  // vehicle is drawn. "Kretanje" is the transport group; picking it is what a
  // reader looking for a tram does, and it is what the schema spec's own
  // tests do since the city sources landed.
  await page.getByTestId('transport-search').focus();
  await page.locator('[data-action=city-group][data-group=transport]').click();
  // Both marks on the screen before anything is measured. This is also the
  // map's own readiness: `data-pills` is a census of rendered features, so it
  // says nothing until the style is up, the model has stepped and MapLibre
  // has painted.
  await expect.poll(() => probe(page, 'pills').then(numbersIn), { timeout: 30_000 })
    .toEqual([routes[0], routes[1]].sort());
}

/** One MapLibre keyboard step in (+1 zoom, no rounding), settled. */
async function zoomIn(page: Page, to: string): Promise<void> {
  await page.locator(CANVAS).focus();
  await page.keyboard.press('=');
  await expect.poll(() => probe(page, 'zoom'), { timeout: 20_000 }).toBe(to);
}

/** Selects the route through the sheet's own search result row, the way a
 *  reader does; `fit: true` on that action takes the camera to the line. */
async function selectRoute(page: Page, routeId: string): Promise<void> {
  await page.getByTestId('transport-search').fill(routeId);
  await page.locator(`[data-action=select-route][data-id="${routeId}"]`).first().click();
  await expect(page.getByTestId('transport-detail')).toContainText(routeId);
}

test('two trams 20 m apart keep both numbers at zoom 17, and the nose keeps to its band', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openTwoTrams(page);

  // The session's map opens on the screen's stop at zoom 14 (workspace.ts
  // sets that camera once the city sources landed), which is where the
  // fixture parks the pair, so three keyboard steps land on exactly 17 with
  // both marks under the camera. MapLibre's keyboard step is +1 from the zoom
  // it is at, with no rounding, so 14 -> 15 -> 16 -> 17.
  await expect.poll(() => probe(page, 'zoom'), { timeout: 20_000 }).toBe('14.00');
  await zoomIn(page, '15.00');
  await zoomIn(page, '16.00');
  await zoomIn(page, '17.00');
  // Both numbers on the map, 20 m apart at ~0.83 m per px, counted from the
  // pills MapLibre placed: whether that is two pills or one merged mark
  // labelled "6·11" is F2's own arithmetic and either reads correctly. What
  // may never happen is a number going missing at placement time -- which is
  // exactly what allow-overlap and ignore-placement fixed.
  await expect.poll(() => probe(page, 'pills').then(numbersIn), { timeout: 20_000 })
    .toEqual([ROUTE_A, ROUTE_B].sort());
  // Past the band's upper edge (overlays.ts NOSE_MAX_ZOOM 16.5) the rails say
  // the direction themselves, so no nose is drawn at all.
  await expect.poll(() => probe(page, 'noses'), { timeout: 20_000 }).toBe('0');

  // And back into the band the way a reader gets there: pick the line, which
  // fits its whole nine kilometres and so zooms well out, then one of its
  // trams, which city-map.ts's centreOn centres at FOCUS_ZOOM (15.5).
  await selectRoute(page, ROUTE_A);
  await page.locator('[data-testid=route-vehicles] button').first().click();
  await expect.poll(() => probe(page, 'zoom'), { timeout: 20_000 }).toBe('15.50');
  // Inside the band the nose is drawn. The selected tram has its own pair of
  // layers (overlays.ts vehicle-selected-nose), so what `vehicle-noses`
  // renders here is the other one: one nose, not none.
  await expect.poll(() => probe(page, 'noses'), { timeout: 20_000 }).toBe('1');
  // A selected mark is never absorbed, so both numbers are two pills here --
  // one drawn by `vehicles`, the selected one by `vehicle-selected`, and the
  // census covers both layers.
  await expect.poll(() => probe(page, 'pills').then(numbersIn), { timeout: 20_000 })
    .toEqual([ROUTE_A, ROUTE_B].sort());
  expect(errors).toEqual([]);
});

test('line focus draws one line in ZET ink, and the switch puts the network back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openTwoTrams(page);
  await selectRoute(page, ROUTE_A);

  // `data-focus` is "<focused route> <network-tram visibility> <network-selected line-color>",
  // each read back off the live style after the diff was applied.
  const colour = ZET_COLOURS[ROUTE_A];
  expect(colour, 'zet-line-colours.json must know the line the fixture runs').toMatch(/^#[0-9a-f]{6}$/);
  await expect.poll(() => probe(page, 'focus'), { timeout: 20_000 }).toBe(`${ROUTE_A} none ${colour}`);

  const toggle = page.getByTestId('line-focus');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  // The whole network is back, and the selected line keeps ZET's own ink.
  await expect.poll(() => probe(page, 'focus'), { timeout: 20_000 }).toBe(`${ROUTE_A} visible ${colour}`);
  expect(await page.evaluate(() => localStorage.getItem('kajima:line-focus:v1'))).toBe('false');
  expect(errors).toEqual([]);
});
