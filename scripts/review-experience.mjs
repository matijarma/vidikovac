// Local visual acceptance over the actual built application. Parser fixtures
// enter through Playwright only; no demo route or bypass is part of the app.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const base = process.env.REVIEW_APP_URL ?? 'http://127.0.0.1:8787';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Visual fixtures are local-only.');
const output = resolve(root, 'review.local/final');
mkdirSync(output, { recursive: true });
const loader = await createServer({
  configFile: false, root, appType: 'custom',
  cacheDir: resolve(root, 'review.local/ssr-cache'),
  server: { middlewareMode: true, hmr: false, watch: null },
});
const browser = await chromium.launch({ headless: true });
const findings = [];
const records = [];
const layers = ['grad-sada', 'u-pokretu', 'zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'kultura'];
const matrix = [
  { name: 'phone', width: 390, height: 844, theme: 'light', locale: 'hr' },
  { name: 'phone-dark', width: 390, height: 844, theme: 'dark', locale: 'hr' },
  { name: 'tablet', width: 768, height: 1024, theme: 'light', locale: 'hr' },
  { name: 'desktop', width: 1440, height: 1000, theme: 'light', locale: 'hr' },
  { name: 'desktop-dark', width: 1440, height: 1000, theme: 'dark', locale: 'hr' },
  { name: 'phone-en-reduced', width: 390, height: 844, theme: 'dark', locale: 'en', reduced: true },
  { name: 'desktop-text200', width: 1440, height: 1000, theme: 'light', locale: 'hr', textZoom: true },
  { name: 'phone-text200', width: 390, height: 844, theme: 'light', locale: 'hr', textZoom: true },
  // The mobile overhaul's extra scenes: the smallest phone the plan supports,
  // landscape, dark at 200% text (the zoom-compact state), a dark tablet.
  { name: 'phone-320', width: 320, height: 568, theme: 'light', locale: 'hr' },
  { name: 'phone-landscape', width: 844, height: 390, theme: 'light', locale: 'hr' },
  { name: 'phone-dark-text200', width: 390, height: 844, theme: 'dark', locale: 'hr', textZoom: true },
  { name: 'tablet-dark', width: 768, height: 1024, theme: 'dark', locale: 'hr' },
];
// WCAG 2.x A and AA plus 2.2 AA (target size, focus not obscured), the same set the Playwright sweeps use.
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
// Public pages a person meets without a session, captured at the phone size.
const PHONE = { width: 390, height: 844 };
const PAGES = [
  { path: '/', slug: 'home' },
  { path: '/s/', slug: 's' },
  { path: '/hitno', slug: 'hitno' },
  { path: '/open/', slug: 'open' },
];

/** One layer of one scene: axe, the geometry facts, a screenshot, a record; a blocking violation or overflow is a finding. */
async function captureLayer(page, sceneName, layer) {
  // Measure the settled page: a figure crossfade or a workspace fade caught
  // mid-flight blends the text with the canvas and fails contrast for 180 ms.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  await page.waitForTimeout(60);
  const audit = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const blocking = audit.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  for (const violation of blocking) findings.push({
    scene: sceneName, layer, problem: violation.id,
    targets: violation.nodes.map((node) => node.target),
  });
  const geometry = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    regions: document.querySelectorAll('[data-testid=dash-view] > .layer').length,
    lang: document.documentElement.lang,
  }));
  if (geometry.overflow > 1 || geometry.regions !== 1) findings.push({ scene: sceneName, layer, problem: 'geometry', ...geometry });
  const file = `${sceneName}-${layer}.png`;
  await page.screenshot({ path: resolve(output, file), fullPage: false });
  records.push({ scene: sceneName, layer, file, ...geometry, seriousOrCritical: blocking.length });
  console.log(`${sceneName} / ${layer}: overflow=${geometry.overflow}, axe=${blocking.length}`);
}

/** A public page at the phone size, no session: axe, overflow, a screenshot, a record. */
async function capturePage(browser, { path, slug }) {
  const context = await browser.newContext({ viewport: PHONE, colorScheme: 'light', locale: 'hr-HR' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const response = await page.goto(`${base}${path}`);
    const status = response ? response.status() : 0;
    if (status !== 200) findings.push({ scene: 'phone-page', page: path, problem: 'status', status });
    await page.waitForLoadState('load');
    await page.waitForTimeout(800);
    const audit = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    const blocking = audit.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    for (const violation of blocking) findings.push({ scene: 'phone-page', page: path, problem: violation.id, targets: violation.nodes.map((node) => node.target) });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 1) findings.push({ scene: 'phone-page', page: path, problem: 'geometry', overflow });
    const file = `phone-page-${slug}.png`;
    await page.screenshot({ path: resolve(output, file), fullPage: false });
    records.push({ scene: 'phone-page', page: path, file, status, overflow, seriousOrCritical: blocking.length });
    console.log(`phone-page ${path}: status=${status}, overflow=${overflow}, axe=${blocking.length}`);
    if (errors.length) findings.push({ scene: 'phone-page', page: path, problem: 'page-errors', errors });
  } finally {
    await context.close();
  }
}

/** The phone's tab when the domain has one; otherwise the directory (Još in the desk's status line, the tab bar's Još on the phone, D10), then the domain's row or any other way in. A Sada tile also carries data-action=nav with a selection, so the tab and the directory come first. */
async function openLayer(page, layer) {
  const tab = page.locator(`.ki-tab[data-layer="${layer}"]:visible`).first();
  if (await tab.count()) {
    await tab.click();
  } else {
    await page.locator('[data-testid=status-more]:visible, [data-testid=tab-more]:visible').first().click();
    await page.locator(`[data-testid="dir-${layer}"], [data-action=nav][data-layer="${layer}"]:visible`).first().click();
  }
  await page.locator(`[data-testid=dash-view] > [data-layer="${layer}"]`).waitFor();
}

/** Promet, then its transport group. Since the city sources landed the
 *  workspace opens on the city's own group ("Zivi grad"), where the transport
 *  modes are off and neither a pill nor the diagram is drawn (workspace.ts
 *  modesArg and the renderer choice); "Kretanje" is what a reader looking for
 *  a tram picks, and what e2e/round-f.spec.ts picks. A host that has no city
 *  groups at all (a legacy transport-only view) is already there. */
async function openTransport(page) {
  await openLayer(page, 'u-pokretu');
  const group = page.locator('[data-action=city-group][data-group=transport]');
  if (!(await group.count())) return;
  // Focusing the search first is what raises the sheet on a phone, so the
  // group buttons under it are on screen to be clicked (e2e/schema.spec.ts).
  await page.getByTestId('transport-search').focus();
  await group.first().click();
}

try {
  const { experienceSnapshots, installExperienceFixture, FIXTURE_DASHBOARD } =
    await loader.ssrLoadModule('/e2e/experience-fixtures.ts');
  for (const scene of matrix) {
    const context = await browser.newContext({
      viewport: { width: scene.width, height: scene.height },
      colorScheme: scene.theme, locale: scene.locale === 'hr' ? 'hr-HR' : 'en-GB',
      reducedMotion: scene.reduced ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const foreignRequests = new Set();
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(base).origin) foreignRequests.add(url.origin);
    });
    await page.addInitScript(({ locale }) => {
      localStorage.setItem('vidikovac-locale', locale);
    }, scene);
    const session = await installExperienceFixture(page, await experienceSnapshots());
    await page.goto(`${base}${FIXTURE_DASHBOARD}`);
    await page.locator('[data-testid=tb]').waitFor();
    if (scene.textZoom) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    for (const layer of layers) {
      await openLayer(page, layer);
      if (layer === 'u-pokretu') {
        await page.waitForFunction(() => ['ready', 'tiles-failed', 'unavailable'].includes(
          document.querySelector('[data-testid=map-canvas]')?.getAttribute('data-map-status')), null, { timeout: 30_000 });
      }
      await captureLayer(page, scene.name, layer);

      if (layer === 'u-pokretu' && scene.name === 'phone') {
        const search = page.getByTestId('transport-search');
        await search.fill('Kvatern');
        await search.evaluate((el) => el.setSelectionRange(2, 5));
        const canvas = await page.locator('[data-testid=map-canvas] canvas').elementHandle();
        await page.clock.runFor(32_000);
        const input = await search.evaluate((el) => ({
          value: el.value, focused: el === document.activeElement, start: el.selectionStart, end: el.selectionEnd,
        }));
        const sameCanvas = await canvas.evaluate((node) => node === document.querySelector('[data-testid=map-canvas] canvas'));
        if (input.value !== 'Kvatern' || !input.focused || input.start !== 2 || input.end !== 5 || !sameCanvas) {
          findings.push({ scene: scene.name, problem: 'transport-input-preservation', ...input, sameCanvas });
        }
        await search.fill('');
      }
    }
    if (foreignRequests.size) findings.push({ scene: scene.name, problem: 'foreign-requests', origins: [...foreignRequests] });
    if (errors.length) findings.push({ scene: scene.name, problem: 'page-errors', errors });
    if (!session.requests.length) findings.push({ scene: scene.name, problem: 'no-data-requests' });
    await context.close();
  }

  for (const entry of PAGES) await capturePage(browser, entry);

  // The ZET schema is another real renderer, fed a real-path plan at the
  // browser boundary. Neither application routes nor production data fake it.
  const { schemaSnapshot, twoTramSnapshot, TWO_TRAM_PATH_ROUTE } = await loader.ssrLoadModule('/e2e/schema-fixtures.ts');
  // The scale at which the diagram starts lettering its stops.
  const { LABEL_MIN_PX_PER_UNIT } = await loader.ssrLoadModule('/app/src/motion/schema-paint.ts');
  const { FIXTURE_NOW } = await loader.ssrLoadModule('/test/feed/fixture-contexts.ts');
  for (const scene of [
    { name: 'schema-phone', width: 390, height: 844, theme: 'light', locale: 'hr' },
    { name: 'schema-phone-dark', width: 390, height: 844, theme: 'dark', locale: 'hr' },
    { name: 'schema-desktop', width: 1440, height: 1000, theme: 'light', locale: 'hr' },
  ]) {
    const context = await browser.newContext({
      viewport: { width: scene.width, height: scene.height }, colorScheme: scene.theme, locale: 'hr-HR',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('kajima:map-mode:v1', 'schema');
      localStorage.setItem('vidikovac-locale', 'hr');
    });
    const snapshots = await experienceSnapshots();
    snapshots['zet-rt'] = schemaSnapshot(FIXTURE_NOW.getTime());
    await installExperienceFixture(page, snapshots);
    await page.goto(`${base}${FIXTURE_DASHBOARD}`);
    await openTransport(page);
    await page.getByTestId('schema-vehicles').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid=map-canvas]')?.getAttribute('data-map-status') === 'ready');
    await page.clock.runFor(1000);
    await captureLayer(page, scene.name, 'u-pokretu');
    await page.getByTestId('schema-vehicles').focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('+');
    await page.clock.runFor(100);
    await captureLayer(page, `${scene.name}-zoom`, 'u-pokretu');
    if (errors.length) findings.push({ scene: scene.name, problem: 'page-errors', errors });
    await context.close();
  }

  // ------------------------------------------------------------- round F ---
  // The round's own rules, each at the zoom it is about: two trams 20 m apart
  // (F2's clustering, F3's pills), the direction nose past its band (F2/D),
  // one line only and then the whole network again (F5), and the diagram's
  // flat names with a terminal's chips (F4). Same fixture the browser gate
  // runs on, so a scene and a spec can never drift apart.

  /** The zoom the round's clustering rule is about: close enough that two
   *  trams 20 m apart are two pills the reader can tell apart (F2). */
  const CLUSTER_SCENE_ZOOM = 17;

  // Is this machine serving the basemap at all? One tile decides it; see
  // openTwoTrams just below for what hangs on the answer.
  const tilesMissing = await fetch(`${base}/maps/zagreb-v1/14/8918/5840.mvt`)
    .then(response => response.status !== 200).catch(() => true);

  /** The dashboard with the pair of trams, on a clock that runs: the camera's
   *  eases and the 12 Hz push both live on rAF, and the plan is rebuilt at
   *  fulfil time so the pair never runs out of it however long a capture
   *  takes. `routes` is what each tram reports -- two different numbers on the
   *  city map (the clustering case), the path's own line twice on the diagram,
   *  which places a tram only on the line its route names. */
  async function openTwoTrams(page, routes) {
    // These scenes let the clock run, so MapLibre's own tile retries run with
    // it. Where the basemap's R2 bucket is empty -- every developer machine --
    // each of those retries is a slow 503, and enough of them starve the
    // requests the page itself needs: the next map in the run comes up
    // `unavailable` and draws nothing. Probed once above, so a machine that
    // really serves the tiles still sees them under the overlays.
    if (tilesMissing) await page.route('**/maps/zagreb-v1/**', route => route.fulfill({ status: 404, body: '' }));
    const snapshots = await experienceSnapshots();
    snapshots['zet-rt'] = twoTramSnapshot(FIXTURE_NOW.getTime(), routes);
    await installExperienceFixture(page, snapshots);
    const started = Date.now();
    await page.route('**/api/data/zet-rt', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(twoTramSnapshot(FIXTURE_NOW.getTime() + (Date.now() - started), routes)),
    }));
    await page.clock.resume();
    await page.goto(`${base}${FIXTURE_DASHBOARD}`);
    await page.locator('[data-testid=tb]').waitFor();
    await openTransport(page);
  }

  /** A read-only probe attribute the renderer writes (city-map.ts, schema-map.ts). */
  const waitForProbe = (page, selector, name, value) => page.waitForFunction(
    ([sel, key, want]) => document.querySelector(sel)?.getAttribute(`data-${key}`) === want,
    [selector, name, value], { timeout: 30_000 });

  // A browser of its own for the round: by this point the run has built and
  // torn down a dozen WebGL contexts, and Chrome keeps about sixteen before it
  // starts losing the oldest (the reason map-slots.ts exists at all). A city
  // map that loses its context reports `unavailable` and draws nothing, which
  // is a lost scene rather than a finding about the product.
  const roundF = await chromium.launch({ headless: true });

  /** The city map's round-F scenes for one viewport: the pair at zoom 17, the
   *  line alone, and the whole network back. Returns false when the map never
   *  came up, so the caller can try once more. */
  async function captureRoundFCity(scene) {
    const context = await roundF.newContext({
      viewport: { width: scene.width, height: scene.height }, colorScheme: 'light', locale: 'hr-HR',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { localStorage.setItem('vidikovac-locale', 'hr'); });
    try {
      await openTwoTrams(page, ['6', '11']);
      await page.waitForFunction(
        () => (document.querySelector('[data-testid=map-canvas]')?.getAttribute('data-pills') ?? '').length > 0,
        null, { timeout: 25_000 });
      // The camera opens where the session and the workspace put it -- the
      // screen's stop at 15 for a paired reader, the city's own zoom since the
      // city sources landed -- and MapLibre's keyboard step is +1 from the
      // rounded zoom it is at *now*. So the steps are taken one at a time from
      // wherever it opened and land on exactly 17, the zoom the cluster rule
      // is about.
      await page.locator('[data-testid=map-canvas] canvas').focus();
      const from = Math.round(Number(await page.getAttribute('[data-testid=map-canvas]', 'data-zoom')));
      for (let stop = from + 1; stop <= CLUSTER_SCENE_ZOOM; stop++) {
        await page.keyboard.press('=');
        await waitForProbe(page, '[data-testid=map-canvas]', 'zoom', stop.toFixed(2));
      }
      await captureLayer(page, scene.name, 'u-pokretu');

      // One line only, then the whole network again, on the same camera.
      await page.getByTestId('transport-search').fill('6');
      await page.locator('[data-action=select-route][data-id="6"]').first().click();
      await page.getByTestId('line-focus').waitFor();
      await page.waitForFunction(
        () => (document.querySelector('[data-testid=map-canvas]')?.getAttribute('data-focus') ?? '').includes(' none '),
        null, { timeout: 30_000 });
      await captureLayer(page, `${scene.name}-focus-on`, 'u-pokretu');
      await page.getByTestId('line-focus').click();
      await page.waitForFunction(
        () => (document.querySelector('[data-testid=map-canvas]')?.getAttribute('data-focus') ?? '').includes(' visible '),
        null, { timeout: 30_000 });
      await captureLayer(page, `${scene.name}-focus-off`, 'u-pokretu');
      if (errors.length) findings.push({ scene: scene.name, problem: 'page-errors', errors });
      return true;
    } catch (error) {
      // Headless Chromium intermittently refuses a WebGL context while the
      // previous one is still being torn down; city-map.ts catches that,
      // reports `unavailable` and draws nothing. That is a lost scene, not
      // something the product did, so it is worth one more go.
      const status = await page.evaluate(
        () => document.querySelector('[data-testid=map-canvas]')?.getAttribute('data-map-status') ?? 'no map',
      ).catch(() => 'unreadable');
      console.log(`${scene.name}: map ${status} -- ${String(error).slice(0, 120)}`);
      return false;
    } finally {
      await context.close();
    }
  }

  for (const scene of [
    { name: 'round-f-city-phone', width: 390, height: 844 },
    { name: 'round-f-city-desktop', width: 1440, height: 1000 },
  ]) {
    if (!(await captureRoundFCity(scene)) && !(await captureRoundFCity(scene))) {
      findings.push({ scene: scene.name, problem: 'map-never-came-up' });
    }
  }

  for (const scene of [
    // The pair stands at Trg bana J. Jelačića. On the desk that frame also
    // holds Črnomerec, the end of their line, 230 artwork units west with its
    // chips under it; a 390 px phone cannot hold 322 px of diagram at the
    // scale a name is readable at, so its scene is the pair and the names
    // around them, with Mihaljevac as the terminal in view.
    { name: 'round-f-schema-phone', width: 390, height: 844, theme: 'light' },
    { name: 'round-f-schema-phone-dark', width: 390, height: 844, theme: 'dark' },
    { name: 'round-f-schema-desktop', width: 1440, height: 1000, theme: 'light' },
  ]) {
    const context = await roundF.newContext({
      viewport: { width: scene.width, height: scene.height }, colorScheme: scene.theme, locale: 'hr-HR',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('kajima:map-mode:v1', 'schema');
      localStorage.setItem('vidikovac-locale', 'hr');
    });
    await openTwoTrams(page, [TWO_TRAM_PATH_ROUTE, TWO_TRAM_PATH_ROUTE]);
    await page.getByTestId('schema-vehicles').waitFor();
    // Picking the line and then one of its trams centres the diagram on that
    // tram at no less than the scale a name is readable at (schema-map.ts
    // fit('selection')), which is what turns the names and chips on.
    await page.getByTestId('transport-search').fill(TWO_TRAM_PATH_ROUTE);
    await page.locator(`[data-action=select-route][data-id="${TWO_TRAM_PATH_ROUTE}"]`).first().click();
    await page.locator('[data-testid=route-vehicles] button').first().click();
    await waitForProbe(page, '[data-testid=schema-map]', 'labels', 'true');
    if (scene.width < 700) {
      // On the phone the sheet opens over most of the stage on a vehicle
      // detail, and folding it back re-fits the diagram to the taller stage
      // (pan-zoom.ts reframe), which drops the scale back under the one a
      // name is readable at. So: follow the tram first -- the controller then
      // keeps it centred whatever the frame does -- fold the sheet down, and
      // zoom back in. That is also the sequence a reader takes to watch one
      // tram on the diagram.
      await page.locator('#t-follow').click();
      await page.waitForTimeout(400);
      const toggle = page.locator('[data-action=toggle-sheet]').first();
      // `data-next` says which way the chevron's next step goes (workspace.ts
      // renderSheetToggle): 'up' is the bottom of the cycle.
      for (let i = 0; i < 3 && (await toggle.getAttribute('data-next')) !== 'up'; i++) {
        await toggle.click();
        await page.waitForTimeout(400);
      }
      await page.getByTestId('schema-vehicles').focus();
      for (let i = 0; i < 6; i++) {
        if (Number(await page.getAttribute('[data-testid=schema-map]', 'data-scale')) >= LABEL_MIN_PX_PER_UNIT) break;
        await page.keyboard.press('+');
        await page.waitForTimeout(250);
      }
    }
    await page.waitForTimeout(200);
    await captureLayer(page, scene.name, 'u-pokretu');
    if (errors.length) findings.push({ scene: scene.name, problem: 'page-errors', errors });
    await context.close();
  }

  await roundF.close();

  // Provision a local test kiosk through the existing test-only admin path.
  {
    const { provisionKiosk } = await loader.ssrLoadModule('/e2e/helpers.ts');
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: 'light', locale: 'hr-HR' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // The kiosk's crop is centred on its own stop, which is where the pair
    // stands, so the public screen's schema shows round F's case too: two
    // pills at one ring, at the screen's doubled symbol scale.
    await page.route('**/api/teaser', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ modules: [twoTramSnapshot(Date.now(), [TWO_TRAM_PATH_ROUTE, TWO_TRAM_PATH_ROUTE])] }),
    }));
    const { kioskUrl } = await provisionKiosk(context.request, base, { stopId: '106_1' });
    const url = new URL(kioskUrl);
    url.searchParams.set('prikaz', 'shema');
    await page.goto(url.href);
    await page.getByTestId('schema-vehicles').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid=kiosk-map]')?.getAttribute('data-map-status') === 'ready');
    const audit = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    const blocking = audit.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
    for (const violation of blocking) findings.push({ scene: 'schema-kiosk', problem: violation.id, targets: violation.nodes.map(n => n.target) });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 1) findings.push({ scene: 'schema-kiosk', problem: 'geometry', overflow });
    const file = 'schema-kiosk.png';
    await page.screenshot({ path: resolve(output, file) });
    records.push({ scene: 'schema-kiosk', file, overflow, seriousOrCritical: blocking.length });
    if (errors.length) findings.push({ scene: 'schema-kiosk', problem: 'page-errors', errors });
    console.log(`schema-kiosk: overflow=${overflow}, axe=${blocking.length}`);
    await context.close();
  }

  // The lightweight face of Promet at the phone size: no stage, no canvas, a scrolling list.
  {
    const context = await browser.newContext({ viewport: PHONE, colorScheme: 'light', locale: 'hr-HR' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => { localStorage.setItem('vidikovac-locale', 'hr'); });
    const session = await installExperienceFixture(page, await experienceSnapshots());
    await page.goto(`${base}${FIXTURE_DASHBOARD.replace('/d/', '/d/?lagano=1')}`);
    await page.locator('[data-testid=tb]').waitFor();
    await openLayer(page, 'u-pokretu');
    if (await page.locator('canvas').count()) findings.push({ scene: 'phone-lagano', layer: 'u-pokretu', problem: 'canvas-on-lightweight-path' });
    await captureLayer(page, 'phone-lagano', 'u-pokretu');
    if (errors.length) findings.push({ scene: 'phone-lagano', problem: 'page-errors', errors });
    if (!session.requests.length) findings.push({ scene: 'phone-lagano', problem: 'no-data-requests' });
    await context.close();
  }
} finally {
  await browser.close();
  await loader.close();
  writeFileSync(resolve(output, 'review.json'), JSON.stringify({ base, capturedAt: new Date().toISOString(), records, findings }, null, 2));
}
console.log(`Visual review: ${records.length} surfaces, ${findings.length} findings. Evidence: review.local/final/review.json`);
if (findings.length) {
  console.log(JSON.stringify(findings, null, 2));
  process.exitCode = 1;
}
