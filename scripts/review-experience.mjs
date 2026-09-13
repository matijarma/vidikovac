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
const layers = ['grad-sada', 'u-pokretu', 'zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'kultura', 'vijesti'];
const matrix = [
  { name: 'phone', width: 390, height: 844, theme: 'light', locale: 'hr' },
  { name: 'phone-dark', width: 390, height: 844, theme: 'dark', locale: 'hr' },
  { name: 'tablet', width: 768, height: 1024, theme: 'light', locale: 'hr' },
  { name: 'desktop', width: 1440, height: 1000, theme: 'light', locale: 'hr' },
  { name: 'desktop-dark', width: 1440, height: 1000, theme: 'dark', locale: 'hr' },
  { name: 'phone-en-reduced', width: 390, height: 844, theme: 'dark', locale: 'en', reduced: true },
  { name: 'desktop-text200', width: 1440, height: 1000, theme: 'light', locale: 'hr', textZoom: true },
  { name: 'phone-text200', width: 390, height: 844, theme: 'light', locale: 'hr', textZoom: true },
];

async function openLayer(page, layer) {
  let nav = page.locator(`[data-action=nav][data-layer="${layer}"]:visible`).first();
  if (!(await nav.count())) {
    await page.getByTestId('tab-more').click();
    nav = page.locator(`[data-action=nav][data-layer="${layer}"]:visible`).first();
  }
  await nav.click();
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
    await page.locator('#ov-weather').waitFor();
    if (scene.textZoom) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    for (const layer of layers) {
      await openLayer(page, layer);
      if (layer === 'u-pokretu') {
        await page.waitForFunction(() => ['ready', 'tiles-failed', 'unavailable'].includes(
          document.querySelector('[data-testid=map-canvas]')?.getAttribute('data-map-status')), null, { timeout: 30_000 });
      }
      const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      const blocking = audit.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      for (const violation of blocking) findings.push({
        scene: scene.name, layer, problem: violation.id,
        targets: violation.nodes.map((node) => node.target),
      });
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        regions: document.querySelectorAll('[data-testid=dash-view] > .layer').length,
        lang: document.documentElement.lang,
      }));
      if (geometry.overflow > 1 || geometry.regions !== 1) findings.push({ scene: scene.name, layer, problem: 'geometry', ...geometry });
      const file = `${scene.name}-${layer}.png`;
      await page.screenshot({ path: resolve(output, file), fullPage: false });
      records.push({ scene: scene.name, layer, file, ...geometry, seriousOrCritical: blocking.length });
      console.log(`${scene.name} / ${layer}: overflow=${geometry.overflow}, axe=${blocking.length}`);

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
