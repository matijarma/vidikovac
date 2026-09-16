import { devices, expect, test, type Page, type Route } from '@playwright/test';
import { APP_URL, readPairing } from './helpers';

const sample = () => {
  const time = new Date().toISOString();
  const make = (module: string, items: unknown[]) => ({
    module, tier: 'open', status: 'live', fetchedAt: time, sourceUpdatedAt: time,
    attribution: { text: 'Test source', url: 'https://example.test', licence: 'Open' }, items,
  });
  return { modules: [
    make('dhmz-now', [{ id: 'weather', kind: 'observation', at: time, data: { temp: 21.4 } }]),
    make('zet-rt', [{ id: 'vozila', kind: 'vehicle', data: { vehicles: 12 } }]),
    make('dhmz-cap', []),
  ] };
};
async function stubSources(page: Page) {
  let failed = false;
  let count = 0;
  await page.route('**/api/teaser', async (route: Route) => {
    count++;
    if (failed) await route.abort();
    else await route.fulfill({ json: sample() });
  });
  await page.route('**/api/health', (route) => route.fulfill({ json: { ok: true, time: new Date().toISOString() } }));
  return { fail(value: boolean) { failed = value; }, count: () => count };
}
async function fonts(page: Page) {
  await page.evaluate(() => document.fonts.ready);
}

test('the homepage is a public introduction, not an automatic session or full app instance', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const sources = await stubSources(page);
  const writes: string[] = [];
  const sockets: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST') writes.push(new URL(r.url()).pathname); });
  page.on('websocket', (socket) => sockets.push(socket.url()));
  await page.goto('/');
  await fonts(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Manje zaslona. Više grada.');
  await expect(page.getByTestId('cta-story')).toBeInViewport();
  await expect(page.locator('.ld-hero-visual')).toBeInViewport();
  expect(sources.count()).toBe(0);
  await page.getByTestId('cta-try').click();
  await expect(page).toHaveURL(/#isprobaj$/);
  await expect(page.getByTestId('cta-kiosk')).toBeVisible();
  await expect(page.getByTestId('cta-kiosk')).toHaveAttribute('target', '_blank');
  expect(writes).toEqual([]);
  expect(sockets).toEqual([]);
  await expect(page.locator('canvas,iframe,video')).toHaveCount(0);
});

test('desktop choreography survives reverse scrolling, jumps and a reduced-motion change', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await fonts(page);
  await expect(page.locator('body')).toHaveAttribute('data-story-motion', '1');
  for (const index of [0, 1, 3, 2, 0, 3]) {
    await page.locator('.ld-chapter').nth(index).evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(page.locator('[data-story-stage]')).toHaveAttribute('data-chapter', String(index));
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('body')).not.toHaveAttribute('data-story-motion', '1');
  for (const figure of await page.locator('.ld-chapter-figure').all()) await expect(figure).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('body')).not.toHaveAttribute('data-story-motion', '1');
});

test('the current-data strip loads on approach, retains honest stale data and recovers', async ({ page }) => {
  const sources = await stubSources(page);
  await page.goto('/');
  await page.locator('[data-live-region]').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('live-weather')).toHaveText('21,4 °C');
  await expect(page.getByTestId('live-safety')).toHaveText('Nema aktivnih upozorenja');
  sources.fail(true);
  await page.locator('[data-live-refresh]').click();
  await expect(page.getByTestId('live-weather')).toHaveAttribute('data-freshness', 'stale');
  await expect(page.getByTestId('live-weather')).toHaveText('21,4 °C');
  await expect(page.getByTestId('live-safety')).toHaveText('Stanje nije potvrđeno');
  sources.fail(false);
  await page.locator('[data-live-refresh]').click();
  await expect(page.getByTestId('live-weather')).toHaveAttribute('data-freshness', 'live');
  await expect(page.getByTestId('live-safety')).toHaveText('Nema aktivnih upozorenja');
});

test('English updates the copy, captures, facts, and metadata in the active dark theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const sources = await stubSources(page);
  await page.goto('/');
  await page.locator('[data-live-region]').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('live-weather')).toHaveText('21,4 °C');
  const requests = sources.count();
  await page.getByTestId('lang-toggle').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Less screen time. More city.');
  await expect(page).toHaveTitle('Kaj ima? · Less screen time. More city.');
  await expect(page.locator('.ld-hero [data-capture=phone] img')).toHaveAttribute('src', /phone-en-dark/);
  await expect(page.getByTestId('live-weather')).toHaveText('21.4 °C');
  await expect(page.getByTestId('live-safety')).toHaveText('No active warnings');
  expect(sources.count()).toBe(requests);
});

test('the lightweight route keeps the entire story without fonts, map libraries or motion', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  await page.goto('/?lagano=1');
  await expect(page.locator('html')).toHaveAttribute('data-lagano', '1');
  await expect(page.locator('body')).not.toHaveAttribute('data-story-motion', '1');
  await page.locator('#isprobaj').scrollIntoViewIfNeeded();
  expect(urls.filter((url) => /\.woff2|maplibre|zet-network|\/maps\//i.test(url))).toEqual([]);
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.locator('.ld-chapter')).toHaveCount(4);
});

test('no JavaScript still provides the whole narrative and working trial/safety links', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto(APP_URL);
    await expect(page.locator('.ld-chapter')).toHaveCount(4);
    await expect(page.getByTestId('live-weather')).toHaveText('Podaci se učitavaju uz JavaScript.');
    await page.getByTestId('cta-try').click();
    await expect(page).toHaveURL(/#isprobaj$/);
    await expect(page.getByTestId('cta-kiosk')).toHaveAttribute('href', '/kiosk/');
    await expect(page.getByTestId('cta-safety')).toHaveAttribute('href', '/hitno');
    await expect(page.locator('body')).not.toHaveAttribute('data-story-motion', '1');
  } finally { await context.close(); }
});

test('a missing capture leaves readable copy and the real trial actions available', async ({ page }) => {
  await page.route('**/landing/**.webp', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('.ld-hero .ld-media-error').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByTestId('cta-try').click();
  await expect(page.getByTestId('cta-kiosk')).toBeVisible();
});

for (const mode of ['same browser', 'separate phone'] as const) {
  test(`homepage trial: ${mode} completes real screen setup and single-use code redemption`, async ({ page, context, browser }) => {
    test.skip(!['localhost', '127.0.0.1'].includes(new URL(APP_URL).hostname), 'This self-service trial check is local-only.');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');
    await page.getByTestId('cta-try').click();
    const [screen] = await Promise.all([
      context.waitForEvent('page'), page.getByTestId('cta-kiosk').click(),
    ]);
    await screen.getByTestId('setup-next').click();
    await screen.getByTestId('setup-create').click();
    const { code, scanUrl } = await readPairing(screen, APP_URL);
    const phoneContext = mode === 'separate phone'
      ? await browser.newContext({ ...devices['Pixel 7'], locale: 'hr-HR' }) : null;
    try {
      let phone: Page;
      if (phoneContext) {
        phone = await phoneContext.newPage();
        await phone.goto(scanUrl);
      } else {
        [phone] = await Promise.all([
          context.waitForEvent('page'), page.getByTestId('cta-same-device').click(),
        ]);
        await phone.getByTestId('code-input').fill(code);
        await phone.getByTestId('code-submit').click();
      }
      await expect(phone.getByTestId('confirm-card')).toContainText('10 minuta');
      await phone.getByRole('button', { name: 'Otključaj', exact: true }).click();
      await expect(phone.getByTestId('session-label')).toHaveAttribute('data-state', 'live');
      await expect(screen.locator('.kiosk')).toHaveAttribute('data-phase', 'paired');
      expect(Number(await phone.getByTestId('session-label').getAttribute('data-expires-at')) - Date.now()).toBeGreaterThan(540_000);
      expect((await phone.request.get(`${APP_URL}/api/data/zet-rt`)).status()).toBe(401);
      const reuse = await phone.request.post(`${APP_URL}/api/scan`, { data: { code } });
      expect((await reuse.json()).error).toBe('code-used');
    } finally {
      await phoneContext?.close();
      await screen.close();
    }
  });
}
