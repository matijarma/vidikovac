// Isolated visual review of the real application. Source samples and sockets
// are test-only; no public screen or session is created. Only map tiles are
// read from the existing public deployment.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = process.cwd();
const base = process.env.REVIEW_APP_URL ?? 'http://127.0.0.1:5178';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Review is local only.');
const out = resolve(root, 'test-results/redesign');
mkdirSync(out, { recursive: true });
const loader = await createServer({ configFile: false, root, appType: 'custom', cacheDir: resolve(out, 'ssr'), server: { middlewareMode: true, hmr: false, watch: null } });
const browser = await chromium.launch({ headless: true });
const records = [];
try {
  const fixtures = await loader.ssrLoadModule('/e2e/experience-fixtures.ts');
  const { teaserSubset } = await loader.ssrLoadModule('/worker/feed/registry.ts');
  const snapshots = await fixtures.experienceSnapshots(process.env.REVIEW_STATE ?? 'ready');
  const now = Date.parse(snapshots['zet-rt'].sourceUpdatedAt);
  // What the one-button start makes, and so what the review must look at first:
  // a whole-city screen with no stop at all. The stop scene below is the other
  // half of the round -- a screen somebody later set a stop on in Postavke.
  const CITY_SCREEN = { kind: 'temporary', expiresAt: now + 86_400_000, stop: null, area: 'zagreb' };
  const STOP_SCREEN = { kind: 'temporary', expiresAt: now + 86_400_000, stop: fixtures.FIXTURE_STOP, area: 'zagreb' };
  // The screen every socket reports right now; a scene moves it and tells the
  // wall through the ordinary `codes` frame, exactly as the DO answers a save.
  let screenMeta = CITY_SCREEN;
  let current = { version: 1, revision: 0, target: null, expiresAt: null, status: 'idle' };
  let owner = null;
  const clients = new Map();
  let beacon;
  const publicState = id => ({ ...current, owner: owner === null ? null : owner === id ? 'self' : 'other', online: true, supported: true });
  const screenState = () => ({ version: 1, revision: current.revision, target: current.target, expiresAt: current.expiresAt, ...(current.target ? { dataToken: 'fixture-data-token' } : {}) });
  const notify = () => { for (const [id, socket] of clients) socket.send(JSON.stringify({ t: 'presentation', state: publicState(id) })); };
  async function pageFor(viewport, name, theme = 'light') {
    const context = await browser.newContext({ viewport, locale: 'hr-HR', timezoneId: 'Europe/Zagreb', colorScheme: theme, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.on('pageerror', error => records.push({ name, error: error.message }));
    await fixtures.installExperienceFixture(page, snapshots);
    await page.addInitScript(({ theme }) => {
      localStorage.setItem('vidikovac-theme', theme);
      localStorage.setItem('vidikovac-locale', 'hr');
      localStorage.setItem('vidikovac-lagano', '0');
    }, { theme });
    await page.route('**/maps/**', async route => {
      try {
        const u = new URL(route.request().url());
        const response = await route.fetch({ url: `https://zagreb.aningfilm.hr${u.pathname}${u.search}`, timeout: 20_000 });
        await route.fulfill({ response });
      } catch { try { await route.abort(); } catch { /* closing context */ } }
    });
    await page.routeWebSocket('**/ws/room/**', socket => {
      clients.set(name, socket);
      socket.onMessage(raw => {
        const m = JSON.parse(String(raw));
        if (m.t === 'join' || m.t === 'resume') socket.send(JSON.stringify({
          t: 'joined', role: 'scanner', expiresAt: now + 600000, serverNow: now, resumeToken: `fixture-${name}`, dataToken: 'fixture-data-token',
          participants: 1, screen: screenMeta, presentation: publicState(name),
        }));
        if (m.t === 'presentation-get') socket.send(JSON.stringify({ t: 'presentation', state: publicState(name) }));
        if (m.t === 'present') {
          const c = m.command;
          let error;
          if (c.expectedRevision !== current.revision) error = 'changed';
          else if (owner && owner !== name && !c.takeover) error = 'occupied';
          else {
            owner = c.action === 'present' ? name : null;
            current = { version: 1, revision: current.revision + 1, target: c.target ?? null, expiresAt: owner ? now + 600000 : null, status: owner ? 'pending' : 'idle' };
            beacon?.send(JSON.stringify({ t: 'presentation', presentation: screenState() }));
            notify();
          }
          socket.send(JSON.stringify({ t: 'presentation-result', result: { requestId: c.requestId, state: publicState(name), ...(error ? { error } : {}) } }));
        }
      });
    });
    return page;
  }
  async function capture(page, name) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: false });
    const geometry = await page.evaluate(() => ({
      viewport: [innerWidth, innerHeight], overflow: document.documentElement.scrollWidth - innerWidth,
      panels: [...document.querySelectorAll('.k-panel[data-panel]')].map(el => ({
        id: el.getAttribute('data-panel'), box: [el.clientWidth, el.clientHeight],
        rows: el.querySelectorAll('.k-fr').length, overflow: [el.scrollWidth - el.clientWidth, el.scrollHeight - el.clientHeight],
      })),
      maps: [...document.querySelectorAll('[data-map-status]')].map(el => el.getAttribute('data-map-status')),
    }));
    records.push({ name, ...geometry });
    console.log(name, JSON.stringify(geometry));
  }
  const kiosk = await pageFor({ width: 1920, height: 1080 }, 'kiosk');
  await kiosk.addInitScript(screen => localStorage.setItem('vidikovac-beacon', JSON.stringify({ beaconId: 'ABCDEFGH', secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', screen })), CITY_SCREEN);
  // The teaser is the screen's own: stopless for the city window, stop-scoped once a stop is set.
  await kiosk.route('**/api/teaser*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ generatedAt: new Date(now).toISOString(), modules: Object.values(snapshots).map(s => teaserSubset(s, screenMeta.stop)) }) }));
  await kiosk.routeWebSocket('**/ws/beacon/**', socket => {
    beacon = socket;
    socket.onMessage(raw => {
      const m = JSON.parse(String(raw));
      if (m.t === 'auth' || m.t === 'more') {
        sendCodes();
        if (m.t === 'auth') socket.send(JSON.stringify({ t: 'presentation', presentation: screenState() }));
      }
      // The settings panel's save, as the DO answers it: store the screen and
      // reply with the ordinary codes frame, which re-frames the wall.
      if (m.t === 'screen-set') {
        screenMeta = { ...screenMeta, stop: m.stopId ? fixtures.FIXTURE_STOP : null, area: m.area };
        sendCodes();
      }
      if (m.t === 'presented' && m.revision === current.revision) { current.status = m.status; notify(); }
      if (m.t === 'presentation-stop') { owner = null; current = { version: 1, revision: current.revision + 1, target: null, status: 'idle', expiresAt: null }; socket.send(JSON.stringify({ t: 'presentation', presentation: screenState() })); notify(); }
    });
    socket.send(JSON.stringify({ t: 'challenge', nonce: 'review-only' }));
  });
  /** One code batch carrying the screen the wall should be framing now. */
  const sendCodes = () => beacon?.send(JSON.stringify({ t: 'codes', serverNow: now, screen: screenMeta, batch: [{ code: 'ABCDEFGH', slotStart: now, slotEnd: now + 30000 }] }));
  /** Move the screen the way Postavke does, and wait for the wall to take it. */
  const setScreen = async (screen) => {
    screenMeta = screen;
    sendCodes();
    await kiosk.waitForTimeout(1500);
  };
  await kiosk.goto(`${base}/kiosk/`);
  await kiosk.getByTestId('kiosk-invitation').waitFor();
  await kiosk.waitForFunction(() => ['ready', 'tiles-failed', 'unavailable'].includes(document.querySelector('[data-testid=kiosk-map]')?.getAttribute('data-map-status')), null, { timeout: 30_000 });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1080, height: 1920 }]) {
    await kiosk.setViewportSize(viewport);
    await capture(kiosk, `kiosk-${viewport.width}-light`);
  }
  await kiosk.setViewportSize({ width: 1920, height: 1080 });
  // The other half of the round: the same screen after somebody set a stop in
  // Postavke -- the camera on the stop, the Promet card its board.
  await setScreen(STOP_SCREEN);
  await capture(kiosk, 'kiosk-1920-light-stop');
  await setScreen(CITY_SCREEN);
  await kiosk.evaluate(() => localStorage.setItem('vidikovac-theme', 'dark'));
  await kiosk.reload();
  await kiosk.getByTestId('kiosk-invitation').waitFor();
  await kiosk.waitForTimeout(1500);
  await capture(kiosk, 'kiosk-1920-dark');
  const phone = await pageFor({ width: 390, height: 844 }, 'phone');
  await phone.goto(`${base}${fixtures.FIXTURE_DASHBOARD}`);
  await phone.getByTestId('tb').waitFor();
  await capture(phone, 'phone-sada');
  await phone.locator('.ki-tab[data-layer="u-pokretu"]').click();
  await phone.waitForFunction(() => ['ready', 'tiles-failed', 'unavailable'].includes(document.querySelector('[data-testid=map-canvas]')?.getAttribute('data-map-status')), null, { timeout: 30_000 });
  await capture(phone, 'phone-promet');
  await phone.getByTestId('transport-search').fill('6');
  await phone.locator('[data-action=select-route][data-id="6"]').first().click();
  await phone.getByTestId('screen-control').click();
  await capture(phone, 'phone-presentation');
  await phone.getByTestId('present-view').click();
  await kiosk.getByTestId('kiosk-layer').waitFor();
  await phone.waitForFunction(() => document.querySelector('[data-testid=presentation-feedback]')?.textContent?.includes('Prikazano'), null, { timeout: 20_000 });
  await capture(kiosk, 'kiosk-route-presented');
  await capture(phone, 'phone-confirmed');
  await phone.getByTestId('stop-presentation').click();
  await kiosk.getByTestId('kiosk-invitation').waitFor();
  await phone.locator('[data-action=presentation-close]').click();
  const desk = await pageFor({ width: 1440, height: 900 }, 'desktop');
  await desk.goto(`${base}${fixtures.FIXTURE_DASHBOARD}`);
  await desk.getByTestId('tb').waitFor();
  await capture(desk, 'desktop-sada');
  await desk.locator('.ki-domains [data-layer="u-pokretu"]').click();
  await desk.waitForTimeout(1200);
  await capture(desk, 'desktop-promet');
  for (const layer of ['kultura', 'zrak-i-nebo', 'uprava-i-pravo', 'sigurnost']) {
    await desk.locator(`.ki-domains [data-layer="${layer}"]`).click();
    await capture(desk, `desktop-${layer}`);
  }
} finally {
  writeFileSync(resolve(out, 'review.json'), JSON.stringify(records, null, 2));
  await browser.close();
  await loader.close();
}
