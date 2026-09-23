// axe-core over every public surface, in both colour schemes, against WCAG 2.x A
// and AA rules. Serious and critical violations fail the run; moderate and minor
// ones are printed for the record. The pages are loaded without a session, which
// is exactly how a person without a phone meets them.
import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test, type Page, type Route } from '@playwright/test';
import { APP_URL, E2E_STOP_ID, health, localContext, provisionKiosk, readPairing, unlockOnPhone } from './helpers';
import { DESKTOP_MIN_PX } from './lib';
import { installWallFixture } from './experience-fixtures';

// The two sizes newdesignsystem.md and Vidikovac.dc.html were drawn at: kiosk 1080p
// and the /d phone artboard (390×844). Every surface is swept at whichever
// of the two (or both) it is actually laid out for.
const KIOSK = { width: 1920, height: 1080 };
const PHONE = { width: 390, height: 844 };

const PAGES: { path: string; viewport: typeof KIOSK }[] = [
  { path: '/', viewport: KIOSK },
  { path: '/', viewport: PHONE },
  { path: '/hitno', viewport: PHONE },
  { path: '/kiosk/', viewport: KIOSK },
  { path: '/s/', viewport: PHONE },
  { path: '/d/', viewport: PHONE },
  { path: '/d/', viewport: KIOSK },
  { path: '/prijava/', viewport: PHONE },
  { path: '/prijava/', viewport: KIOSK },
];
const SCHEMES = ['light', 'dark'] as const;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['serious', 'critical']);

type Violation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];
const describeViolation = (v: Violation) =>
  `${v.impact} ${v.id}: ${v.help}\n  ${v.helpUrl}\n` +
  v.nodes
    .slice(0, 5)
    .map((n) => `  - ${n.target.join(' ')}: ${(n.failureSummary ?? '').split('\n')[0]}`)
    .join('\n');

for (const { path, viewport } of PAGES) {
  for (const scheme of SCHEMES) {
    // The viewport width rides in the title so /d/ and / (each swept at both
    // sizes) don't collide on a repeated title.
    test(`axe ${path} @${viewport.width} (${scheme}): no serious or critical violations`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      const response = await page.goto(`${APP_URL}${path}`);
      expect(response?.status(), `${path} must answer 200`).toBe(200);
      await page.waitForLoadState('networkidle');

      // R-M1: /d had no h1 at all; every surface in the matrix must have
      // exactly one, the one landmark a page's accessible name hangs off.
      const h1Count = await page.locator('h1').count();
      expect(h1Count, `${path} @${viewport.width} must have exactly one h1`).toBe(1);

      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

      const advisory = results.violations.filter((v) => !v.impact || !BLOCKING.has(v.impact));
      if (advisory.length > 0) console.log(`[axe advisory] ${path} (${scheme})\n${advisory.map(describeViolation).join('\n')}`);

      const blocking = results.violations.filter((v) => v.impact && BLOCKING.has(v.impact));
      expect(blocking, blocking.map(describeViolation).join('\n\n')).toEqual([]);
    });
  }
}

// --- R-F5: the moving map has a text path. ----------------------------------
// The matrix above meets every surface without a session, which is how a
// person without a phone meets them -- but it therefore never sees a drawn
// vehicle, the tap card, or the full MapLibre map, and a green sweep said
// nothing about them. These two sweeps put a tram on the wire (the same
// stubbed feed e2e/motion.spec.ts proves the motion with) and assert three
// things per surface: no nested-interactive violation anywhere, a name on
// every element a Tab can reach, and the vehicle list among those stops.

// Trg bana Jelačića: inside the locked kiosk's crop and any session's
// whole-network crop alike (motion/schematic.ts's DEFAULT_CROP centre).
const CENTRE_LON = 15.9769;
const CENTRE_LAT = 45.813;
const ROUTE_ID = '6';

/** A `zet-rt` snapshot with one vehicle in the crop, reported twice five
 *  seconds apart so the model has fix-to-fix evidence from a single poll. */
function zetSnapshot(vehicleId: string, routeType: number) {
  const now = Date.now();
  const item = (lat: number, at: number) => ({
    id: `vehicle:${vehicleId}`,
    module: 'zet-rt',
    kind: 'vehicle',
    tier: 'open',
    // A real tram line, so the search Karta offers finds it: the one UI path into a line's detail (WP4).
    title: `Tramvaj ${ROUTE_ID}`,
    at: new Date(at).toISOString(),
    geo: { type: 'Point', coordinates: [CENTRE_LON, lat] },
    data: { routeId: ROUTE_ID, routeType },
  });
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
    items: [item(CENTRE_LAT, now - 5000), item(CENTRE_LAT + 0.0006, now)],
  };
}

function emptySnapshot(moduleId: string) {
  return { module: moduleId, tier: 'session', status: 'live', fetchedAt: new Date().toISOString(), attribution: { text: '', url: '', licence: '' }, items: [] };
}

/** The locked kiosk's own open-tier poll. */
async function stubTeaser(page: Page, snapshot: unknown): Promise<void> {
  await page.route('**/api/teaser', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modules: [snapshot] }) }),
  );
}

/** Every `/api/data/<module>` a session asks for: zet-rt gets the fixture,
 *  the rest an honest empty snapshot, so no real upstream is touched. */
async function stubSessionData(page: Page, zet: unknown): Promise<void> {
  await page.route('**/api/data/*', (route: Route) => {
    const moduleId = new URL(route.request().url()).pathname.split('/').filter(Boolean).pop() ?? '';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(moduleId === 'zet-rt' ? zet : emptySnapshot(moduleId)) });
  });
}

/** The vector map has drawn at least once (the shared loop's frame counter). */
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

interface FocusStop {
  /** tag, id, testid and classes -- enough to name the element in a failure. */
  where: string;
  /** The accessible name as a reader would compute it: aria-labelledby, then
   *  aria-label, then a form label, then text and image alternatives, then title. */
  name: string;
  inVehicleList: boolean;
}

/**
 * Presses Tab around the whole document once and returns every stop with its
 * accessible name. Visited elements are marked, so the walk ends when it
 * comes back round to one it has seen (or after `limit` presses, if a
 * re-render swapped the elements under it); a Tab that leaves the document
 * (focus on body) is followed, because the next one re-enters at the top.
 */
async function tabWalk(page: Page, limit = 150): Promise<FocusStop[]> {
  const stops: FocusStop[] = [];
  let leftDocument = 0;
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate((): (FocusStop & { revisit: boolean }) | null => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const revisit = el.hasAttribute('data-e2e-visited');
      el.setAttribute('data-e2e-visited', '1');
      const nameOf = (node: Element): string => {
        const labelledBy = node.getAttribute('aria-labelledby');
        if (labelledBy) {
          const text = labelledBy
            .split(/\s+/)
            .map((id) => {
              const ref = document.getElementById(id);
              return ref ? (ref.getAttribute('aria-label') ?? ref.textContent ?? '') : '';
            })
            .join(' ')
            .trim();
          if (text) return text;
        }
        const label = node.getAttribute('aria-label')?.trim();
        if (label) return label;
        if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement) {
          const byFor = node.id ? document.querySelector(`label[for="${node.id}"]`) : null;
          const text = (byFor ?? node.closest('label'))?.textContent?.trim();
          if (text) return text;
          if (node instanceof HTMLInputElement && (node.type === 'button' || node.type === 'submit') && node.value.trim()) return node.value.trim();
        }
        const alternatives = [...node.querySelectorAll('img[alt], [role=img][aria-label], svg[aria-label]')]
          .map((n) => n.getAttribute('alt') ?? n.getAttribute('aria-label') ?? '')
          .join(' ');
        const text = `${node.textContent ?? ''} ${alternatives}`.trim();
        if (text) return text;
        return node.getAttribute('title')?.trim() ?? '';
      };
      const where = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : ''}${el.className ? `.${String(el.className).trim().split(/\s+/).join('.')}` : ''}`;
      return { revisit, where, name: nameOf(el), inVehicleList: el.closest('[data-testid=route-vehicles], [data-testid=running-routes], [data-testid=transport-search]') !== null };
    });
    if (stop === null) {
      if (++leftDocument > 2) break;
      continue;
    }
    if (stop.revisit) break;
    stops.push({ where: stop.where, name: stop.name, inVehicleList: stop.inVehicleList });
  }
  return stops;
}

async function assertTextPath(page: Page, surface: string, interactiveTransport = true): Promise<void> {
  const nested = await new AxeBuilder({ page }).withRules(['nested-interactive']).analyze();
  expect(nested.violations.map(describeViolation), `${surface}: no interactive element may sit inside one whose children are presentational`).toEqual([]);

  const stops = await tabWalk(page);
  const listing = stops.map((s) => `  ${s.where}: "${s.name}"`).join('\n');
  expect(stops.length, `${surface}: the Tab walk must visit something`).toBeGreaterThan(0);
  expect(
    stops.filter((s) => s.name === '').map((s) => s.where),
    `${surface}: every element a Tab reaches must have an accessible name; the walk was:\n${listing}`,
  ).toEqual([]);
  if (interactiveTransport) {
    expect(stops.some((s) => s.inVehicleList), `${surface}: search or the route/vehicle list must be reachable by Tab; the walk was:\n${listing}`).toBe(true);
  }
}

test.describe('the moving map has a text path (R-F5)', () => {
  test('/kiosk/ has readable passive content beside its named map, no control inside the invitation, and a named settings path', async ({ page, request }) => {
    await stubTeaser(page, zetSnapshot('e2e-a11y-kiosk', 0));
    await installWallFixture(page);
    // The screen's stop: the "U blizini" list reads that stop's departures.
    const { kioskUrl } = await provisionKiosk(request, APP_URL, { stopId: E2E_STOP_ID });
    await page.setViewportSize(KIOSK);
    // One fixed window (R-KP1): the map and the column are there from the first paint, nothing rotates away.
    await page.goto(kioskUrl);
    await expect(page.getByTestId('kiosk-code')).toBeVisible({ timeout: 30_000 });
    await waitForFrames(page, '[data-testid=kiosk-map]');
    await expect(page.getByTestId('kiosk-map')).toHaveAttribute('role', 'region');
    // The wall's safety verdict is a word, not a button (lane/w-D2fix, [O-43]); Osnovno stays on the handheld stage.
    await expect(page.getByTestId('kiosk-essentials-open')).toHaveCount(0);
    await expect(page.locator('span.k-strip-verdict[data-testid=strip-verdict]')).toBeVisible();
    // A public screen's list is glanceable, not a hidden interactive phone
    // list. Its actual controls still need a complete keyboard path.
    await assertTextPath(page, '/kiosk/', false);
    // The passive content is text a screen reader reaches: the list under its
    // heading and the header's one sentence.
    await expect(page.getByTestId('nearby').getByRole('heading')).toBeVisible();
    await expect(page.getByTestId('nearby-head')).toHaveText(/^U blizini · \d+(,\d)? km · ~\d+ min$/);
    await expect(page.getByTestId('kiosk-sentence-text')).not.toBeEmpty();
    // No operator chrome on the visible wall (brief §10, principle 8): not one
    // visible control inside the invitation, and none of the retired ones anywhere.
    await expect(page.locator('[data-testid=kiosk-invitation] :is(button, [role=button], input, select, textarea):visible')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Zaustavi izmjenu' })).toHaveCount(0);
    await expect(page.locator('[data-testid=kiosk-settings], [data-testid=kiosk-theme], [data-action^=pause]')).toHaveCount(0);
    // The settings path is hidden in plain sight and named: the brand is a
    // button called "Postavke zaslona" (a long press opens it on a touch
    // screen, Enter or Space from a keyboard), and Escape closes the panel.
    const brand = page.getByRole('button', { name: 'Postavke zaslona' });
    await expect(brand).toHaveCount(1);
    await expect(brand).toHaveAttribute('data-testid', 'kiosk-brand');
    await brand.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('kiosk-settings-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('kiosk-settings-panel')).toBeHidden();
    await expect(page.getByTestId('kiosk-invitation')).toBeVisible();
    await expect(page.locator('.k-map-legend')).toContainText('Tramvajska linija');
    // Three plain legend items, the bikes one without its old "? nepotvrđeno" (§13 #14).
    await expect(page.locator('.k-map-legend')).toContainText('BAJS: broj bicikala');
    await expect(page.locator('.k-map-legend')).not.toContainText('?');
    await expect(page.locator('[data-action=kiosk-explore], #kiosk-city-search')).toHaveCount(0);
  });

  test('/d/ in a session with U pokretu open: no nested-interactive violation, a name on every Tab stop (the map’s zoom buttons and the OpenStreetMap link included), and the vehicle list among them', async ({
    browser,
    request,
  }) => {
    expect((await health(request, APP_URL)).networkCheck).toBe('off');

    const kioskCtx = await localContext(browser, { ...devices['Desktop Chrome'], viewport: KIOSK });
    const phoneCtx = await localContext(browser, { ...devices['Pixel 7'] });
    try {
      // A stopless screen, as this proof was written for: the text path below walks a line's detail, which the
      // address opens whatever place the screen has.
      const { kioskUrl } = await provisionKiosk(request, APP_URL);
      const kiosk = await kioskCtx.newPage();
      await kiosk.goto(kioskUrl);
      const { scanUrl } = await readPairing(kiosk, APP_URL);

      const phone = await phoneCtx.newPage();
      await stubSessionData(phone, zetSnapshot('e2e-a11y-dash', 0));
      await unlockOnPhone(phone, scanUrl, '10 minuta');
      await phone.locator('[data-action=nav][data-layer="u-pokretu"]:visible').first().click();
      await waitForFrames(phone, '[data-testid=map-canvas]');
      // Karta opens on the place's list, not on a list of running lines (WP4): the line's detail is reached the way
      // a person reaches it, through the one search field and its result.
      const search = phone.getByTestId('transport-search');
      await search.focus();
      await search.fill(ROUTE_ID);
      await phone.locator(`[data-action=select-route][data-id="${ROUTE_ID}"]`).first().click();
      await expect(phone.locator('[data-testid=route-vehicles] button').first()).toBeVisible();

      // The full map (T10) is a named region whose controls and licence
      // credit are exposed by name, not swallowed by an image role.
      // The panel itself is a region named "Karta" (aria-labelledby its title); the
      // map's own label carries the counts after a colon.
      await expect(phone.getByTestId('map-canvas')).toHaveAttribute('role', 'region');
      await expect(phone.getByTestId('map-canvas')).toHaveAttribute('aria-label', /Karta/);
      await expect(phone.locator('.maplibregl-ctrl-zoom-in')).toBeVisible();
      // Below the desktop breakpoint the attribution is compact (R-O2): one
      // 44 px button opens the credit line, so the licence link is reached
      // the way a person reaches it, by pressing that button first.
      // MapLibre opens the compact credit expanded and folds it on the first drag, so the
      // button is pressed only when the credit line is folded (a press on an open credit closes it).
      const attribution = phone.locator('.maplibregl-ctrl-attrib');
      const attributionButton = attribution.locator('.maplibregl-ctrl-attrib-button');
      if ((phone.viewportSize()?.width ?? 0) < DESKTOP_MIN_PX && (await attributionButton.isVisible())) {
        const showing = await attribution.evaluate((el) => el.classList.contains('maplibregl-compact-show'));
        if (!showing) await attributionButton.click();
      }
      await expect(phone.getByRole('link', { name: /OpenStreetMap/ })).toBeVisible();

      await assertTextPath(phone, '/d/ (session)');
    } finally {
      await kioskCtx.close();
      await phoneCtx.close();
    }
  });
});
