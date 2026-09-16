// A sharing image composed from the actual homepage and its product captures.
// Only the screenshot's layout changes; no illustration or UI data is invented.
import { chromium } from 'playwright';
import { resolve } from 'node:path';
const base = process.env.LANDING_REVIEW_URL ?? 'http://127.0.0.1:5174';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, colorScheme: 'light', locale: 'hr-HR', reducedMotion: 'reduce' });
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: `
    .ld-head, .ld-actions, .ld-intro, .ld-hero-figure > figcaption { display: none; }
    .ld-hero { padding-block: 32px 0; }
    .ld-hero > .ld-eyebrow { margin-bottom: 18px; font-size: 18px; }
    .ld-hero > .ld-eyebrow::before { content: "Kaj ima? · "; }
    .ld-hero h1 { font-size: 72px; }
    .ld-hero-top { grid-template-columns: 1.7fr 1fr; gap: 32px; }
    .ld-lead { font-size: 20px; }
    .ld-hero-copy { padding-bottom: 12px; }
    .ld-hero-figure { margin-top: 32px; }
    .ld-hero-visual { max-width: 900px; }
  ` });
  await page.locator('.ld-hero img').evaluateAll((images) => Promise.all(images.map((img) => img.decode())));
  await page.screenshot({ path: resolve(import.meta.dirname, '../app/public/landing/share.jpg'), type: 'jpeg', quality: 90 });
} finally {
  await browser.close();
}
