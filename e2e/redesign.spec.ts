import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { experienceSnapshots, FIXTURE_DASHBOARD, installExperienceFixture } from './experience-fixtures';
import { APP_URL, E2E_STOP_ID, localContext, provisionKiosk, readPairing, unlockOnPhone } from './helpers';
import { teaserSubset } from '../worker/feed/registry';
import type { ModuleId, ModuleSnapshot } from '../worker/feed/schema';
import { FIXTURE_STOP } from './experience-fixtures';
import { fulfillPublicMap } from '../scripts/review-maps.mjs';
import {installCityFixture,cityEvents} from './city-fixtures';

const tags = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

/** Recorded source shapes, shifted together to the test's real clock.
 * Pairing and presentation WebSockets are NOT mocked by this function. */
async function feeds(page: Page, realClock = true) {
  const snapshots = await experienceSnapshots();
  const delta = realClock ? Date.now() - Date.parse(snapshots['zet-rt'].sourceUpdatedAt!) : 0;
  const shift = (value: string | undefined) => value ? new Date(Date.parse(value) + delta).toISOString() : undefined;
  for (const snapshot of Object.values(snapshots)) {
    snapshot.fetchedAt = shift(snapshot.fetchedAt)!;
    snapshot.sourceUpdatedAt = shift(snapshot.sourceUpdatedAt);
    snapshot.validUntil = shift(snapshot.validUntil);
    snapshot.items = snapshot.items.map(item => ({ ...item, at: shift(item.at), until: shift(item.until) }));
  }
  cityEvents(snapshots.dogadanja,Date.parse(snapshots['zet-rt'].sourceUpdatedAt!));
  await installCityFixture(page,Date.parse(snapshots['zet-rt'].sourceUpdatedAt!));
  await page.route('**/api/teaser*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ generatedAt: new Date().toISOString(), modules: Object.values(snapshots).map(s => teaserSubset(s, FIXTURE_STOP)) }) }));
  await page.route('**/api/data/**', route => {
    const module = new URL(route.request().url()).pathname.split('/').at(-1) as ModuleId;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshots[module]) });
  });
  // The real local Worker need not carry a second regional PMTiles archive.
  await page.route('**/maps/**', route => fulfillPublicMap(route));
  return snapshots;
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(tags).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
}

async function noOverflow(page: Page) {
  const result = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    offenders: [...document.querySelectorAll<HTMLElement>('.ki *, main *')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > innerWidth + 1 && !el.closest('[hidden]');
    }).slice(0, 10).map(el => ({ tag: el.tagName, class: el.className, text: el.textContent?.slice(0, 60), width: el.getBoundingClientRect().width })),
  }));
  expect(result.overflow, JSON.stringify(result.offenders)).toBeLessThanOrEqual(1);
}

const displaySizes = [
  { width: 1920, height: 1080 }, { width: 1366, height: 768 },
  { width: 1080, height: 1920 }, { width: 3840, height: 2160 },
];

for (const theme of ['light', 'dark'] as const) {
  test(`kiosk: useful regions, unoccluded geography, scannable invitation, ${theme}`, async ({ page, request }) => {
    const { kioskUrl } = await provisionKiosk(request, APP_URL, { stopId: E2E_STOP_ID });
    await feeds(page);
    await page.addInitScript(theme => localStorage.setItem('vidikovac-theme', theme), theme);
    await page.goto(kioskUrl);
    await expect(page.getByTestId('kiosk-code')).toHaveAttribute('data-state', 'live');
    await expect(page.getByTestId('kiosk-map')).toHaveAttribute('data-map-status', 'ready', { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    for (const size of displaySizes) {
      await page.setViewportSize(size);
      await page.waitForTimeout(350);
      await expect(page.getByTestId('kiosk-invitation')).toBeVisible();
      const issues = await page.evaluate(() => {
        const out: string[] = [];
        const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        // The window's grammar: the map inside it, the aside beside or under it, nothing over the picture.
        const front = rect('[data-testid=kiosk-invitation]');
        const map = rect('.k-geography');
        if (map.width < 200 || map.height < 200) out.push('the map is not the page');
        if (map.left < front.left - 1 || map.right > front.right + 1 || map.bottom > front.bottom + 1) out.push('the map leaves the window');
        // The code itself, not its plate: at least 240 CSS px at every wall size (WP1, the 264 px plate).
        const code = document.querySelector('[data-testid=kiosk-qr] svg')?.getBoundingClientRect();
        if (!code || code.width < 240 || code.height < 240) out.push(`QR code below the 240px floor: ${code ? Math.floor(Math.min(code.width, code.height)) : 'none'}`);
        // The aside is the "U blizini" list over the QR card: each fits its box, beside or under the map,
        // and the list is whole rows, sliced by its budget, never hidden and never cut by its own edge.
        for (const region of document.querySelectorAll<HTMLElement>('.k-nearby, .k-panel--card')) {
          const name = region.dataset.testid ?? region.className;
          const box = region.getBoundingClientRect();
          if (box.left < map.right - 1 && box.top < map.bottom - 1) out.push(`${name}: over the map`);
          if (region.scrollHeight > region.clientHeight + 1) out.push(`${name}: vertical overflow`);
          if (region.scrollWidth > region.clientWidth + 1) out.push(`${name}: horizontal overflow`);
          if (!region.textContent?.trim()) out.push(`${name}: empty`);
        }
        const list = document.querySelector<HTMLElement>('[data-testid=nearby-rows]');
        if (!list) out.push('no U blizini list');
        else {
          const rows = [...list.querySelectorAll<HTMLElement>('.nearby-row')];
          const bottom = list.getBoundingClientRect().bottom;
          if (rows.length === 0) out.push('U blizini: no row');
          if (list.scrollHeight > list.clientHeight + 1) out.push('U blizini: rows overflow the list');
          if (rows.some(row => row.getBoundingClientRect().bottom > bottom + 1)) out.push('U blizini: a row cut by the list');
          if (rows.filter(row => row.dataset.kind === 'departure').length > 3) out.push('U blizini: more than three departures');
        }
        if (document.querySelectorAll('.nearby-row[hidden]').length) out.push('hidden rows');
        for (const panel of document.querySelectorAll<HTMLElement>('.k-panel[data-panel]')) {
          // Nothing is drawn over the picture: every card is beside the map or under it.
          const box = panel.getBoundingClientRect();
          if (box.left < map.right - 1 && box.top < map.bottom - 1) out.push(`${panel.dataset.panel}: over the map`);
          if (panel.scrollHeight > panel.clientHeight + 1) out.push(`${panel.dataset.panel}: vertical overflow`);
          if (panel.scrollWidth > panel.clientWidth + 1) out.push(`${panel.dataset.panel}: horizontal overflow`);
          const rows = [...panel.querySelectorAll<HTMLElement>('.k-fr')];
          if (rows.some(row => row.hidden)) out.push(`${panel.dataset.panel}: hidden useful rows`);
          if (!panel.textContent?.trim()) out.push(`${panel.dataset.panel}: empty`);
        }
        const stage = rect('[data-testid=kiosk-stage]');
        if (stage.bottom > rect('[data-testid=safety-strip]').top + 1) out.push('stage covers safety');
        return out;
      });
      expect(issues, JSON.stringify(size)).toEqual([]);
      await noOverflow(page);
      await page.screenshot({ path: `test-results/redesign/kiosk-verified-${size.width}-${theme}.png` });
    }
    await page.setViewportSize(displaySizes[0]!);
    await axe(page);
  });
}

for (const scene of [
  { name: 'phone', width: 390, height: 844, theme: 'light', locale: 'hr', zoom: false },
  { name: 'small', width: 320, height: 568, theme: 'light', locale: 'hr', zoom: false },
  { name: 'landscape', width: 844, height: 390, theme: 'dark', locale: 'en', zoom: false },
  { name: 'tablet', width: 768, height: 1024, theme: 'light', locale: 'en', zoom: false },
  { name: 'desktop', width: 1440, height: 900, theme: 'dark', locale: 'hr', zoom: false },
  { name: 'text200', width: 390, height: 844, theme: 'dark', locale: 'en', zoom: true },
]) {
  test(`client: all six areas, ${scene.name}`, async ({ page }) => {
    await page.setViewportSize(scene);
    await page.addInitScript(({ theme, locale }) => {
      localStorage.setItem('vidikovac-theme', theme);
      localStorage.setItem('vidikovac-locale', locale);
    }, scene);
    await installExperienceFixture(page, await experienceSnapshots());
    await feeds(page, false); // HTTP only; the fixture owns this visual test's socket and clock.
    await page.goto(FIXTURE_DASHBOARD);
    await expect(page.locator('#layer-grad-sada')).toBeVisible();
    if (scene.zoom) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    for (const layer of ['grad-sada', 'u-pokretu', 'zrak-i-nebo', 'kultura', 'uprava-i-pravo', 'sigurnost']) {
      // A phone tab (Sada, Karta), at the desk the wordmark's way home to Sada or the temporary Karta link, else Još and the domain's row.
      const direct = page.locator(`.ki-tab[data-layer="${layer}"]:visible, .ki-wordmark[data-layer="${layer}"]:visible, [data-testid=desk-karta][data-layer="${layer}"]:visible`).first();
      if (await direct.count()) await direct.click();
      else {
        await page.locator('[data-testid=tab-more]:visible, [data-testid=status-more]:visible').first().click();
        await page.getByTestId(`dir-${layer}`).click();
      }
      await expect(page.locator(`[data-testid=dash-view] > [data-layer="${layer}"]`)).toBeVisible();
      await page.waitForTimeout(180);
      await noOverflow(page);
      await axe(page);
      await page.screenshot({ path: `test-results/redesign/${scene.name}-${layer}.png` });
    }
  });
}

test('real kiosk + two scanners: acknowledged subjects, removal/recovery, confirmed takeover, reload and district', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { kioskUrl } = await provisionKiosk(request, APP_URL, { stopId: E2E_STOP_ID });
  const kctx = await localContext(browser, { viewport: { width: 1920, height: 1080 } });
  const actx = await localContext(browser, { viewport: { width: 390, height: 844 } });
  const bctx = await localContext(browser, { viewport: { width: 390, height: 844 } });
  try {
    const kiosk = await kctx.newPage(), a = await actx.newPage(), b = await bctx.newPage();
    const kioskSources = await feeds(kiosk);
    await feeds(a);
    await feeds(b);
    await kiosk.goto(kioskUrl);
    const first = await readPairing(kiosk, APP_URL);
    await unlockOnPhone(a, first.scanUrl, '10 minuta');
    await expect(kiosk.getByTestId('kiosk-invitation')).toBeVisible();
    await a.locator('.ki-tab[data-layer="u-pokretu"]').click();
    await a.getByTestId('transport-search').fill('6');
    await a.locator('[data-action=select-route][data-id="6"]').first().click();
    await expect(kiosk.getByTestId('kiosk-invitation')).toBeVisible();
    await a.getByTestId('screen-control').click();
    await a.getByTestId('present-view').click();
    await expect(a.getByTestId('presentation-feedback')).toContainText('Prikazano', { timeout: 25_000 });
    await expect(kiosk.locator('.k-present-board .k-select-main')).toContainText('Črnomerec');
    const revision = await kiosk.getByTestId('kiosk-layer').getAttribute('data-layer');
    await expect.poll(async () => (await readPairing(kiosk, APP_URL)).code, { timeout: 40_000 }).not.toBe(first.code);
    const second = await readPairing(kiosk, APP_URL);
    await unlockOnPhone(b, second.scanUrl, '10 minuta');
    await expect(kiosk.getByTestId('kiosk-layer')).toHaveAttribute('data-layer', revision!);
    // Događanja is a Još row now: the tab bar's Još on the phone, the status line's at the desk.
    await b.locator('[data-testid=tab-more]:visible, [data-testid=status-more]:visible').first().click();
    await b.getByTestId('dir-kultura').click();
    const eventTitle = (await b.locator('[data-testid=event-row] .row-title').first().innerText()).trim();
    await b.locator('[data-testid=event-row] [data-action=select]').first().click();
    await b.getByTestId('screen-control').click();
    await expect(b.getByTestId('presentation-panel')).toContainText('Druga osoba');
    await b.getByTestId('present-view').click();
    await expect(b.locator('.present-confirm')).toBeVisible();
    await expect(kiosk.getByTestId('kiosk-layer')).toHaveAttribute('data-layer', 'u-pokretu');
    await b.locator('[data-action=present-confirm]').click();
    await expect(b.getByTestId('presentation-feedback')).toContainText('Prikazano', { timeout: 25_000 });
    await expect(kiosk.getByTestId('kiosk-layer')).toHaveAttribute('data-layer', 'kultura');
    await expect(kiosk.locator('.k-select-main')).toHaveText(eventTitle);
    await kiosk.screenshot({ path: 'test-results/redesign/presented-event.png' });
    await expect(a.getByTestId('screen-control')).toHaveAttribute('data-active', 'false');
    await expect(a.getByTestId('route-title')).toContainText('Črnomerec');
    const events = kioskSources.dogadanja;
    kioskSources.dogadanja = { ...events, items: [] };
    await expect(kiosk.getByTestId('k-selection-unavailable')).toBeVisible({ timeout: 25_000 });
    await expect(b.getByTestId('presentation-feedback')).toContainText('više nije dostupan');
    kioskSources.dogadanja = events;
    await expect(kiosk.locator('.k-select-main')).toHaveText(eventTitle, { timeout: 25_000 });
    await expect(b.getByTestId('presentation-feedback')).toContainText('Prikazano');
    await kiosk.reload();
    await expect(kiosk.getByTestId('kiosk-layer')).toHaveAttribute('data-layer', 'kultura');
    await expect(kiosk.locator('.k-select-main')).toHaveText(eventTitle);
    await b.locator('[data-action=presentation-close]').click();
    await b.getByTestId('screen-control').click();
    await b.getByTestId('stop-presentation').click();
    await expect(kiosk.getByTestId('kiosk-invitation')).toBeVisible();
    await expect(b.getByTestId('session-label')).toHaveAttribute('data-state', 'live');
    await b.locator('[data-action=presentation-close]').click();
    await b.locator('.ki-tab[data-layer="u-pokretu"]').click();
    await b.getByTestId('transport-search').fill('Gavella');
    await b.locator('[data-action=select-place]').first().click();
    await b.getByTestId('screen-control').click();
    await b.getByTestId('present-view').click();
    await expect(b.getByTestId('presentation-feedback')).toContainText('Prikazano');
    await expect(kiosk.getByTestId('city-detail')).toContainText('Gavella');
    await expect(kiosk.getByTestId('kiosk-map')).toHaveAttribute('inert','');
    await kiosk.screenshot({path:'test-results/redesign/presented-city-place.png'});
    await b.getByTestId('stop-presentation').click();
    await expect(kiosk.getByTestId('kiosk-invitation')).toBeVisible();
  } finally {
    await Promise.all([kctx.close(), actx.close(), bctx.close()]);
  }
});
