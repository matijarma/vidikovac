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
  server: { middlewareMode: true },
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
