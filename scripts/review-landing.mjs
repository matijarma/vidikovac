// Rendered acceptance for the homepage only. Test artifacts are ignored.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.env.LANDING_REVIEW_URL ?? 'http://127.0.0.1:5174';
const output = resolve(import.meta.dirname, '../review.local/landing');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const records = [];
const fast = process.argv.includes('--quick');
const sceneIndex = process.argv.indexOf('--scene');
const selectedScene = sceneIndex >= 0 ? process.argv[sceneIndex + 1] : null;
const matrix = fast ? [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'phone', width: 390, height: 844 },
] : [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'wide', width: 1920, height: 1080 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'narrow', width: 320, height: 568 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop-dark', width: 1440, height: 1000, dark: true },
  { name: 'phone-dark', width: 390, height: 844, dark: true },
  { name: 'desktop-en', width: 1440, height: 1000, en: true },
  { name: 'phone-en', width: 390, height: 844, en: true },
  { name: 'phone-en-dark', width: 390, height: 844, en: true, dark: true },
  { name: 'reduced', width: 1440, height: 1000, reduced: true },
  { name: 'lightweight', width: 390, height: 844, lightweight: true },
  { name: 'no-js', width: 390, height: 844, noJs: true },
  { name: 'desktop-zoom', width: 1440, height: 1000, zoom: true },
  { name: 'phone-zoom', width: 390, height: 844, zoom: true },
];
try {
  for (const scene of matrix.filter((scene) => !selectedScene || scene.name === selectedScene)) {
    const context = await browser.newContext({
      viewport: { width: scene.width, height: scene.height },
      colorScheme: scene.dark ? 'dark' : 'light',
      locale: scene.en ? 'en-GB' : 'hr-HR',
      reducedMotion: scene.reduced ? 'reduce' : 'no-preference',
      javaScriptEnabled: !scene.noJs,
    });
    const page = await context.newPage();
    const errors = [];
    const writes = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (r) => { if (r.method() === 'POST') writes.push(new URL(r.url()).pathname); });
    await page.goto(`${base}/${scene.lightweight ? '?lagano=1' : ''}`);
    if (!scene.noJs) await page.evaluate(() => document.fonts.ready);
    if (scene.zoom) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(output, `${scene.name}-hero.png`) });
    const chapters = page.locator('.ld-chapter');
    const frames = [];
    for (let index = 0; index < 4; index++) {
      await chapters.nth(index).scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      frames.push(await page.locator('[data-story-stage]').getAttribute('data-chapter'));
      await page.screenshot({ path: resolve(output, `${scene.name}-chapter-${index}.png`) });
    }
    await page.locator('#isprobaj').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(output, `${scene.name}-trial.png`) });
    const geometry = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - innerWidth,
      motion: document.body.dataset.storyMotion ?? '0',
      failedImages: [...document.querySelectorAll('img')].filter((img) => img.complete && !img.naturalWidth).map((img) => img.getAttribute('src')),
      smallTargets: [...document.querySelectorAll('a,button')].filter((el) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && b.height < 43.5 && getComputedStyle(el).visibility !== 'hidden';
      }).map((el) => el.textContent.trim()),
    }));
    const audit = scene.noJs ? { violations: [] } : await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const violations = audit.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }));
    records.push({ scene: scene.name, ...geometry, frames, violations, errors, writes });
    console.log(JSON.stringify(records.at(-1)));
    await page.screenshot({ path: resolve(output, `${scene.name}-full.png`), fullPage: true });
    await context.close();
  }
} finally {
  await browser.close();
  writeFileSync(resolve(output, selectedScene ? `review-${selectedScene}.json` : 'review.json'), JSON.stringify(records, null, 2) + '\n');
}
if (records.some((r) => r.overflow > 1 || r.violations.length || r.errors.length || r.writes.length || r.failedImages.length || r.smallTargets.length)) {
  process.exitCode = 1;
}
