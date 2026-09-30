// DEV mode end to end (worker/routes/dev.ts describes it; app/src/core/dev-mode.ts keeps the flag):
// the phone in DEV opens Sada without a code and shows the chip, whose × leaves a page that asks
// for a code; the wall in DEV runs on the network's DEV screen, whose QR opens a phone in DEV too;
// the chip's menu lists the five surfaces; /dev/ opened bare turns DEV on and frames the four
// surfaces, each in DEV; /hitno?DEV carries the chip without a script; the four framed pages allow
// their own origin and no other page does. Every test is its own network (localContext), so each
// has a DEV screen of its own. Runs in the chromium project, against the local servers only.
import { devices, expect, test, type Page } from '@playwright/test';
import { APP_URL, localContext } from './helpers';

const { defaultBrowserType: _browser, ...PIXEL_7 } = devices['Pixel 7'];
const WALL = Object.freeze({ width: 1920, height: 1080 });
const JOIN_MS = 30_000;
const DAY_MS = 24 * 60 * 60_000;
const SURFACES = ['Zaslon', 'Telefon', 'Računalo', 'Hitno', 'Sve zajedno'];
const SURFACE_LINKS = ['/kiosk/?DEV', '/d/?DEV', '/d/?DEV', '/hitno?DEV', '/dev/?DEV'];

interface Box { x: number; y: number; width: number; height: number }
const overlaps = (a: Box, b: Box): boolean =>
  a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0
  && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The chip's two targets, and every box of `selector` that one of them covers. */
async function coveredBy(page: Page, selector: string): Promise<string[]> {
  const chip = await page.evaluate(() => ['[data-testid=dev-chip]', '[data-testid=dev-off]'].map((s) => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }));
  const boxes = await page.locator(selector).evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return { name: `${el.tagName.toLowerCase()}.${el.className}`, box: { x: r.x, y: r.y, width: r.width, height: r.height } };
  }));
  return boxes.filter(({ box }) => chip.some((c) => overlaps(c, box))).map(({ name }) => name);
}

test.describe('DEV mode', () => {
  test('the phone in DEV opens Sada without a code, under the chip; the × leaves a page that asks for a code', async ({ browser }) => {
    const context = await localContext(browser, { ...PIXEL_7 });
    try {
      const page = await context.newPage();
      await page.goto('/d/?DEV');
      await expect(page.locator('html')).toHaveAttribute('data-dev', '1');
      await expect(page.getByTestId('dev-chip')).toBeVisible();
      await expect(page.getByTestId('dev-chip')).toHaveText('DEV');
      await expect(page.getByTestId('session-label')).toHaveAttribute('data-state', 'live', { timeout: JOIN_MS });
      await expect(page.locator('.ki-tab[data-layer="grad-sada"]')).toHaveAttribute('aria-current', 'page');
      expect(new URL(page.url()).hash).toMatch(/room=/);
      expect(new URL(page.url()).search).toBe('?DEV');
      // A DEV session is a day long, as the pill's own expiry says.
      const expiresAt = Number(await page.getByTestId('session-label').getAttribute('data-expires-at'));
      expect(expiresAt - Date.now()).toBeGreaterThan(DAY_MS - 5 * 60_000);
      // Nothing of the header's content and nothing of the tab bar lies under the chip.
      expect(await coveredBy(page, '.ki-head > *, .ki-tabbar')).toEqual([]);
      // A reload resumes the same room; a page reached with neither the flag nor a room stays in DEV
      // (the tab remembers it) and gets a session of its own again.
      const roomOf = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get('room');
      const room = roomOf(page.url());
      await page.reload();
      await expect(page.getByTestId('session-label')).toHaveAttribute('data-state', 'live', { timeout: JOIN_MS });
      expect(roomOf(page.url())).toBe(room);
      await page.goto('/d/');
      await expect(page.getByTestId('dev-chip')).toBeVisible();
      await expect(page.getByTestId('session-label')).toHaveAttribute('data-state', 'live', { timeout: JOIN_MS });
      expect(roomOf(page.url())).not.toBe(room);

      await page.getByTestId('dev-off').click();
      await page.waitForURL((url) => url.pathname === '/d/' && url.search === '' && url.hash === '');
      await expect(page.locator('main.ki-empty')).toBeVisible();
      await expect(page.locator('main.ki-empty a[href="/s/"]')).toBeVisible();
      await expect(page.getByTestId('dev-chip')).toHaveCount(0);
      expect(await page.evaluate(() => ['kajima:dev', 'vidikovac-resume', 'vidikovac.dataToken'].map((k) => sessionStorage.getItem(k)))).toEqual([null, null, null]);
      await page.reload();
      await expect(page.locator('main.ki-empty')).toBeVisible();
      await expect(page.locator('html')).not.toHaveAttribute('data-dev', '1');
      await expect(page.getByTestId('session-label')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('the wall in DEV runs on a DEV screen under the chip, its QR opens a phone in DEV, and the menu lists the five surfaces', async ({ browser }) => {
    const wallContext = await localContext(browser, { viewport: WALL });
    const phoneContext = await localContext(browser, { ...PIXEL_7 });
    try {
      const wall = await wallContext.newPage();
      const screens: string[] = [];
      wall.on('request', (request) => { if (request.method() === 'POST') screens.push(new URL(request.url()).pathname); });
      const devScreen = wall.waitForResponse((response) => new URL(response.url()).pathname === '/api/dev/screen');
      await wall.goto('/kiosk/?DEV');
      const screen = await (await devScreen).json();
      expect(screen.screen).toMatchObject({ kind: 'temporary', area: 'zagreb', dev: true });
      await expect(wall.locator('html')).toHaveAttribute('data-dev', '1');
      await expect(wall.getByTestId('dev-chip')).toBeVisible();
      await expect(wall.getByTestId('kiosk-code')).toHaveAttribute('data-state', 'live', { timeout: JOIN_MS });
      expect(screens).not.toContain('/api/screens');
      // The wall's own credentials stay apart from its DEV screen.
      expect(await wall.evaluate(() => [localStorage.getItem('vidikovac-beacon'), JSON.parse(localStorage.getItem('kajima:dev-beacon') ?? '{}').beaconId]))
        .toEqual([null, screen.beaconId]);
      expect(await coveredBy(wall, '.k-head-brand, .k-head-mid > :not([hidden]), .k-head-when')).toEqual([]);

      await wall.getByTestId('dev-chip').click();
      const links = wall.getByTestId('dev-menu').locator('a');
      await expect(links).toHaveText(SURFACES);
      expect(await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual(SURFACE_LINKS);
      await expect(links.first()).toHaveAttribute('aria-current', 'page');
      await wall.keyboard.press('Escape');
      await expect(wall.getByTestId('dev-menu')).toBeHidden();

      // The QR's link carries ?DEV: the phone that opens it redeems the code and lands in DEV, a day long.
      const payload = (await wall.getByTestId('pair-url').textContent())!.trim();
      expect(payload).toMatch(/\/s\/\?DEV#[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      const phone = await phoneContext.newPage();
      await phone.goto(`${APP_URL}/s/?DEV${new URL(payload).hash}`);
      await phone.waitForURL((url) => url.pathname === '/d/' && url.search === '?DEV', { timeout: JOIN_MS });
      await expect(phone.getByTestId('dev-chip')).toBeVisible();
      await expect(phone.getByTestId('session-label')).toHaveAttribute('data-state', 'live', { timeout: JOIN_MS });
      expect(Number(await phone.getByTestId('session-label').getAttribute('data-expires-at')) - Date.now()).toBeGreaterThan(DAY_MS - 5 * 60_000);

      // The wall's ×: the tab forgets DEV and the DEV screen, and the wall is its ordinary self again.
      await wall.getByTestId('dev-off').click();
      await wall.waitForURL((url) => url.pathname === '/kiosk/' && url.search === '');
      await expect(wall.getByTestId('dev-chip')).toHaveCount(0);
      await expect(wall.locator('html')).not.toHaveAttribute('data-dev', '1');
      expect(await wall.evaluate(() => [sessionStorage.getItem('kajima:dev'), localStorage.getItem('kajima:dev-beacon')])).toEqual([null, null]);
    } finally {
      await wallContext.close();
      await phoneContext.close();
    }
  });

  test('/dev/ opened without any query turns DEV on and shows the four frames, each document in DEV', async ({ browser }) => {
    const context = await localContext(browser, { viewport: { width: 1600, height: 1000 } });
    try {
      const page = await context.newPage();
      await page.goto('/dev/');
      await expect(page.locator('html')).toHaveAttribute('data-dev', '1');
      expect(await page.evaluate(() => sessionStorage.getItem('kajima:dev'))).toBe('1');
      await expect(page.getByTestId('dev-chip')).toBeVisible();
      await page.getByTestId('dev-chip').click();
      await expect(page.getByTestId('dev-menu').locator('a')).toHaveText(SURFACES);
      const frames = page.locator('iframe[data-testid=dev-frame]');
      await expect(frames).toHaveCount(4);
      expect(await frames.evaluateAll((els) => els.map((f) => [f.dataset.surface, f.getAttribute('src'), f.getAttribute('width'), f.getAttribute('height')]))).toEqual([
        ['screen', '/kiosk/?DEV', '1920', '1080'], ['phone', '/d/?DEV', '390', '844'], ['desktop', '/d/?DEV', '1280', '800'], ['hitno', '/hitno?DEV', '390', '844'],
      ]);
      for (const surface of ['screen', 'phone', 'desktop', 'hitno']) {
        const frame = page.frameLocator(`iframe[data-surface=${surface}]`);
        await expect(frame.locator('html'), surface).toHaveAttribute('data-dev', '1', { timeout: JOIN_MS });
        // The grid's header carries the one chip; a framed page draws none.
        await expect(frame.locator('[data-testid=dev-chip]'), surface).toHaveCount(0);
      }
      await expect(page.frameLocator('iframe[data-surface=phone]').getByTestId('session-label')).toHaveAttribute('data-state', 'live', { timeout: JOIN_MS });
      await expect(page.frameLocator('iframe[data-surface=desktop]').locator('.ki')).toHaveAttribute('data-surface', 'desktop', { timeout: JOIN_MS });
      await expect(page.frameLocator('iframe[data-surface=phone]').locator('.ki')).toHaveAttribute('data-surface', 'phone');
      await expect(page.frameLocator('iframe[data-surface=screen]').getByTestId('kiosk-code')).toHaveAttribute('data-state', 'live', { timeout: JOIN_MS });
      // Each frame is scaled into its cell: the four cells share one height and none is wider than the window.
      const cells = await page.locator('.dev-frame-box').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ right: r.right, height: Math.round(r.height) })));
      expect(new Set(cells.map((c) => c.height)).size).toBe(1);
      expect(Math.max(...cells.map((c) => c.right))).toBeLessThanOrEqual(1600);
    } finally {
      await context.close();
    }
  });

  test('/s/?DEV has nothing to type: it goes straight on to /d/ in DEV', async ({ browser }) => {
    const context = await localContext(browser, { ...PIXEL_7 });
    try {
      const page = await context.newPage();
      await page.goto('/s/?DEV');
      await page.waitForURL((url) => url.pathname === '/d/' && url.search === '?DEV');
      await expect(page.getByTestId('session-label')).toHaveAttribute('data-state', 'live', { timeout: JOIN_MS });
    } finally {
      await context.close();
    }
  });

  test('/hitno?DEV carries the chip without a script, and its × goes back to /hitno', async ({ browser }) => {
    const context = await localContext(browser, { ...PIXEL_7 });
    try {
      const page = await context.newPage();
      await page.goto('/hitno?DEV');
      await expect(page.locator('html')).toHaveAttribute('data-dev', '1');
      await expect(page.locator('script')).toHaveCount(0);
      await page.getByTestId('dev-chip').click();
      await expect(page.getByTestId('dev-menu').locator('a')).toHaveText(SURFACES);
      await page.getByTestId('dev-off').click();
      await page.waitForURL((url) => url.pathname === '/hitno' && url.search === '');
      await expect(page.getByTestId('dev-chip')).toHaveCount(0);
      await expect(page.locator('html')).not.toHaveAttribute('data-dev', '1');
    } finally {
      await context.close();
    }
  });

  test('the four pages the grid frames allow their own origin as a frame ancestor; every other page still denies it', async ({ request }) => {
    for (const path of ['/kiosk/', '/d/', '/s/', '/hitno']) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()['x-frame-options'], path).toBe('SAMEORIGIN');
      // The CSP of the static pages comes from _headers, which a local `wrangler dev` does not always apply.
      const csp = response.headers()['content-security-policy'];
      if (csp !== undefined) {
        expect(csp, path).toContain("frame-ancestors 'self'");
        expect(csp, path).not.toContain("frame-ancestors 'none'");
      }
    }
    for (const path of ['/', '/privatnost/', '/izvori/', '/pristupacnost/', '/dev/', '/open/']) {
      const response = await request.get(path);
      expect(response.headers()['x-frame-options'] ?? 'DENY', path).toBe('DENY');
    }
  });
});
