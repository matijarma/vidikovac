// Published landing imagery comes from the running application, not fixtures.
// Local Worker + ordinary self-service screen + ordinary code redemption.
// No credentials or raw feed payloads are written to the provenance manifest.
import { chromium } from 'playwright';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { localNetworkHeaders } from './local-network.mjs';
import { fulfillPublicMap } from './review-maps.mjs';

const base = process.env.LANDING_CAPTURE_URL ?? 'http://127.0.0.1:5174';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) {
  throw new Error('Capture is local-only. It must not provision public deployment screens.');
}
const root = resolve(import.meta.dirname, '..');
const raw = resolve(root, 'review.local/landing-captures');
const output = resolve(raw, 'optimized');
const published = resolve(root, 'app/public/landing');
mkdirSync(output, { recursive: true });
mkdirSync(raw, { recursive: true });
const records = [];
const browser = await chromium.launch({ headless: true });

const variants = [
  { locale: 'hr', theme: 'light' }, { locale: 'hr', theme: 'dark' },
  { locale: 'en', theme: 'light' }, { locale: 'en', theme: 'dark' },
];
const phoneSize = { width: 390, height: 844 };
const desktopSize = { width: 1440, height: 900 };
const extraHTTPHeaders = localNetworkHeaders(base);
const kioskContext = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'hr-HR', timezoneId: 'Europe/Zagreb', extraHTTPHeaders });
const phoneContext = await browser.newContext({ viewport: phoneSize, deviceScaleFactor: 2, locale: 'hr-HR', timezoneId: 'Europe/Zagreb', extraHTTPHeaders });
const peerContext = await browser.newContext({ viewport: phoneSize, deviceScaleFactor: 2, locale: 'hr-HR', timezoneId: 'Europe/Zagreb', extraHTTPHeaders });
const kiosk = await kioskContext.newPage();
const phone = await phoneContext.newPage();
const peer = await peerContext.newPage();
// The local Worker still owns all data and real pairing. An optional read-only
// tile origin avoids requiring a second PMTiles archive for capture work.
const mapOrigin = process.env.LANDING_MAP_ORIGIN;
if (mapOrigin) {
  if (new URL(mapOrigin).origin !== 'https://zagreb.aningfilm.hr') throw new Error('Unexpected map origin.');
  for (const context of [kioskContext, phoneContext, peerContext]) {
    await context.route('**/maps/**', route => fulfillPublicMap(route, new URL(mapOrigin).origin));
  }
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
}

async function preferences(page, { locale, theme }, reload = true) {
  await page.evaluate(({ locale, theme }) => {
    localStorage.setItem('vidikovac-locale', locale);
    localStorage.setItem('vidikovac-theme', theme);
    localStorage.setItem('vidikovac-lagano', '0');
  }, { locale, theme });
  if (reload) {
    await page.reload();
    await settle(page);
  }
}

async function layer(page, id) {
  const tab = page.locator(`.ki-tab[data-layer="${id}"]:visible`).first();
  if (await tab.count()) await tab.click();
  else if (id === 'grad-sada') await page.locator('.ki-wordmark[data-layer=grad-sada]').click();
  else if (id === 'u-pokretu') await page.getByTestId('status-search').click();
  else {
    await page.locator('[data-testid=status-more]:visible, [data-testid=tab-more]:visible').first().click();
    await page.locator(`[data-testid="dir-${id}"]`).click();
  }
  await page.locator(`[data-testid=dash-view] > [data-layer="${id}"]`).waitFor();
  await settle(page);
}

async function maskCredentials(page, locale) {
  // Only the QR/code area changes. All product data, controls, and timestamps
  // remain exactly as rendered. The caption states that this is a capture.
  return page.addStyleTag({ content: `
    .k-qr, .share-qr, .k-code-box, .share-code { position: relative !important; }
    .k-qr > *, .share-qr > *, .k-code, .k-code-ghost, .share-read { visibility: hidden !important; }
    .k-qr::after, .share-qr::after {
      content: "${locale === 'hr' ? 'Primjer prikaza' : 'Example capture'}";
      position: absolute; inset: 0; display: grid; place-items: center;
      padding: 20px; border: 2px dashed currentColor; border-radius: 12px;
      background: var(--tone-qr-plate); color: var(--tone-qr-ink);
      font: 700 24px/1.3 Manrope, sans-serif; text-align: center;
    }
    .k-code-box::after, .share-code::after {
      content: "${locale === 'hr' ? 'Kod je skriven' : 'Code is hidden'}";
      position: absolute; inset: 0; display: grid; place-items: center;
      font: 500 24px/1.3 Manrope, sans-serif; letter-spacing: 0;
      background: var(--tone-action-brand); color: var(--tone-action-brand-fg);
    }
    .share-code { color: transparent !important; }
    .share-code::after { background: var(--tone-surface-1); color: var(--tone-text-primary); }
  ` });
}

async function capture(page, name, variant, widths, route) {
  const { locale, theme } = variant;
  const file = `${name}-${locale}-${theme}`;
  const style = await maskCredentials(page, locale);
  await settle(page);
  for (const map of await page.locator('[data-map-status]').all()) {
    if (!await map.isVisible()) continue;
    await page.waitForFunction(el => el.dataset.mapStatus === 'ready', await map.elementHandle(), { timeout: 30_000 });
  }
  await page.screenshot({ path: resolve(raw, `${file}.png`), fullPage: false });
  await style.evaluate((el) => el.remove());
  for (const width of widths) {
    const result = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', resolve(raw, `${file}.png`),
      '-vf', `scale=${width}:-1:flags=lanczos`, '-c:v', 'libwebp', '-quality', '78',
      '-compression_level', '6', resolve(output, `${file}-${width}.webp`),
    ], { windowsHide: true, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`WebP conversion failed: ${result.stderr}`);
  }
  records.push({ name, locale, theme, widths, viewport: page.viewportSize(), route, capturedAt: new Date().toISOString() });
  console.log(`Captured ${file}`);
  saveManifest();
}

function saveManifest() {
  writeFileSync(resolve(output, 'captures.json'), JSON.stringify({
    provenance: 'Actual application with live source data and real local code redemption. No fixtures or session bypass.',
    masking: 'QR, pairing code, and read-aloud code regions are explicitly masked as example captures. No active credentials are published.',
    frozen: 'Captured after the real ten-minute session expired. No clock or source data is simulated.',
    captures: records,
  }, null, 2) + '\n');
}

async function scan(page, code) {
  await page.goto(`${base}/s/#${code}`);
  await page.getByTestId('session-label').waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid=session-label]')?.getAttribute('data-state') === 'live');
  await settle(page);
}

try {
  await kiosk.goto(`${base}/kiosk/`);
  await preferences(kiosk, variants[0]);
  await kiosk.getByTestId('setup-create').waitFor();
  await kiosk.getByTestId('setup-create').click();
  await kiosk.getByTestId('pair-code').waitFor({ timeout: 30_000 });
  await kiosk.waitForFunction(() => document.querySelector('[data-testid=pair-code]')?.getAttribute('data-state') === 'live');
  // Warm the actual public and session feeds before recording the invitation.
  await kiosk.waitForTimeout(15_000);
  for (const variant of variants) {
    await preferences(kiosk, variant);
    await kiosk.getByTestId('kiosk-invitation').waitFor({ timeout: 30_000 });
    await kiosk.waitForTimeout(2500);
    await capture(kiosk, 'kiosk', variant, [720, 1280], '/kiosk/');
  }
  const code = await kiosk.evaluate(() => ['code-a', 'code-b'].map((id) => document.querySelector(`[data-testid=${id}]`).textContent).join('-'));
  await scan(phone, code);
  await phone.waitForTimeout(6000);
  const expiresAt = await phone.getByTestId('session-label').getAttribute('data-expires-at');
  await phone.getByTestId('session-label').click();
  await phone.getByTestId('share-city').click();
  await phone.getByTestId('share-code').waitFor();
  const peerCode = (await phone.getByTestId('share-code').textContent()).replace(/[·\s]/g, '-');
  await scan(peer, peerCode);
  await phone.locator('[data-testid=share-dialog] .dialog-close').click();
  for (const variant of variants) {
    await preferences(phone, variant);
    await phone.getByTestId('session-label').waitFor();
    await phone.setViewportSize(phoneSize);
    await layer(phone, 'grad-sada');
    await capture(phone, 'phone', variant, [390, 780], '/d/ Sada');
    await layer(phone, 'kultura');
    await capture(phone, 'events', variant, [390, 780], '/d/ Događanja');
    await phone.setViewportSize(desktopSize);
    await layer(phone, 'grad-sada');
    await capture(phone, 'desktop', variant, [720, 1280], '/d/ Sada');
    await layer(phone, 'u-pokretu');
    await phone.waitForTimeout(3000);
    await capture(phone, 'transport', variant, [720, 1280], '/d/ Promet');
    await preferences(peer, variant);
    await peer.getByTestId('session-label').waitFor();
    await capture(peer, 'peer', variant, [390, 780], '/d/ actual five-minute peer session');
  }
  // Keep the real session mounted through its expiry. Language/theme controls
  // still work on the frozen snapshot, without replacing the source data.
  await phone.setViewportSize(phoneSize);
  await layer(phone, 'grad-sada');
  while (Date.now() < Number(expiresAt) + 1500) {
    const left = Math.min(30_000, Number(expiresAt) + 1500 - Date.now());
    console.log('Waiting for the genuine session to end; no clock substitution.');
    await phone.waitForTimeout(Math.max(0, left));
  }
  for (const variant of variants) {
    await phone.getByTestId('session-label').click();
    await phone.locator(`[data-sheet-action=lang][data-value="${variant.locale}"]`).click();
    await phone.locator(`[data-sheet-action=theme][data-value="${variant.theme}"]`).click();
    await phone.locator('[data-testid=session-sheet] .dialog-close').click();
    await capture(phone, 'frozen', variant, [390, 780], '/d/ genuinely expired snapshot');
  }
  // A failed capture never replaces the published set with a partial set.
  // The asset names are fixed by this script, not read from the network.
  if (records.length !== variants.length * 7) throw new Error('Incomplete capture set.');
  saveManifest();
  mkdirSync(published, { recursive: true });
  for (const record of records) for (const width of record.widths) {
    const file = `${record.name}-${record.locale}-${record.theme}-${width}.webp`;
    copyFileSync(resolve(output, file), resolve(published, file));
  }
  copyFileSync(resolve(output, 'captures.json'), resolve(published, 'captures.json'));
} finally {
  saveManifest();
  await browser.close();
}
