// Casting is explicit (plan D5, B.9): moving between domains tells the room
// nothing; one `view` frame leaves the phone when a person presses "Na zaslon"
// or the Kvart panel's "Prebaci na zaslon", and the desk sends the layer with
// its current selection. The fixture spine records every frame the client
// writes to the routed WebSocket, so the room's driver rule is never in the
// way and no real screen is needed. Runs in the chromium project at the
// phone and the desk sizes; the fixture's role and screen options paint the
// two disabled cases (a one-hop peer, a session without a screen).
import { expect, test, type Page } from '@playwright/test';
import { experienceSnapshots, FIXTURE_DASHBOARD, FIXTURE_STOP, installExperienceFixture, type FixtureOptions, type FixtureSession } from './experience-fixtures';

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1440, height: 1000 };
/** The default stop lies in Gornji grad – Medveščak (R-DG19); the Kvart panel's title reads the resolved district. */
const STOP_DISTRICT_NAME = 'Gornji grad – Medveščak';
const CAST_PEER = 'Zaslon prati telefon koji je skenirao kod.';
const CAST_NO_SCREEN = 'Ova sesija nema zaslon.';

const viewFrames = (fixture: FixtureSession): Record<string, unknown>[] => fixture.events.filter((e) => e.t === 'view');

/** A live fixture session at the viewport, Sada painted. */
async function openSession(page: Page, viewport: { width: number; height: number }, options?: FixtureOptions): Promise<FixtureSession> {
  await page.setViewportSize(viewport);
  const fixture = await installExperienceFixture(page, await experienceSnapshots(), options);
  await page.goto(FIXTURE_DASHBOARD);
  await expect(page.getByTestId('tb'), 'Sada must paint from the fixture').toBeVisible();
  await expect(page.getByTestId('session-label'), 'the session must be live').toHaveAttribute('data-state', 'live');
  return fixture;
}

async function openTab(page: Page, layer: 'grad-sada' | 'u-pokretu'): Promise<void> {
  await page.locator(`.ki-tab[data-layer="${layer}"]`).click();
  await expect(page.locator(`[data-testid="dash-view"] > [data-layer="${layer}"]`)).toBeVisible();
}

test('phone: Sada → Promet → Sada sends no view frame; the FAB sends one for Sada and says so; the Kvart panel names the stop\'s district and its primary sends a second', async ({ page }) => {
  const fixture = await openSession(page, PHONE);
  await openTab(page, 'u-pokretu');
  await openTab(page, 'grad-sada');
  expect(viewFrames(fixture), 'navigation must tell the room nothing (D5)').toEqual([]);

  const fab = page.getByTestId('cast-fab');
  await expect(fab, 'a scanner with a screen gets the FAB on Sada').toBeVisible();
  await fab.click();
  await expect.poll(() => viewFrames(fixture), 'one press sends exactly one view frame for Sada').toEqual([{ t: 'view', layer: 'grad-sada' }]);
  await expect(page.getByTestId('announce-polite')).toHaveText('Poslano na zaslon: Sada.');

  await page.getByTestId('tab-kvart').click();
  const panel = page.locator('#layer-kvart');
  await expect(panel).toBeVisible();
  await expect(panel.locator('#layer-title-kvart'), `the Kvart title reads the screen stop's district`).toHaveText(STOP_DISTRICT_NAME);
  await expect(page.getByTestId('cast-fab'), 'the panel carries the primary; no FAB beside it').toHaveCount(0);
  const cast = page.getByTestId('cast-screen');
  await expect(cast).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('cast-why')).toContainText(FIXTURE_STOP.name);
  await cast.click();
  await expect.poll(() => viewFrames(fixture), 'the panel\'s primary sends a second frame for the current layer').toEqual([
    { t: 'view', layer: 'grad-sada' },
    { t: 'view', layer: 'grad-sada' },
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width + 1);
});

test('desk: route 6 selected in Promet, then the aside\'s primary sends the layer with its selection', async ({ page }) => {
  const fixture = await openSession(page, DESK);
  await expect(page.getByTestId('cast-fab'), 'the desk has no FAB').toHaveCount(0);
  await page.getByTestId('status-more').click();
  await page.getByTestId('dir-u-pokretu').click();
  await expect(page.locator('[data-testid="dash-view"] > [data-layer="u-pokretu"]')).toBeVisible();
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-map-status', /^(ready|tiles-failed|unavailable)$/, { timeout: 30_000 });
  await page.getByTestId('transport-search').fill('6');
  await page.locator('[data-testid="transport-results"] [data-action="select-route"][data-id="6"]').click();
  await expect(page.getByTestId('route-title')).toContainText('6');
  expect(viewFrames(fixture), 'selecting a route must tell the room nothing (D5)').toEqual([]);
  await page.locator('[data-testid="kvart-aside"] [data-testid="cast-screen"]').click();
  await expect.poll(() => viewFrames(fixture)).toEqual([{ t: 'view', layer: 'u-pokretu', params: { kind: 'route', id: '6' } }]);
});

for (const { name, options, sentence } of [
  { name: 'a one-hop peer (role phone)', options: { role: 'phone' } as FixtureOptions, sentence: CAST_PEER },
  { name: 'a session without a screen', options: { screen: false } as FixtureOptions, sentence: CAST_NO_SCREEN },
]) {
  test(`${name}: no FAB, the Kvart panel's primary is disabled but readable with its reason, and a press sends nothing`, async ({ page }) => {
    const fixture = await openSession(page, PHONE, options);
    await expect(page.getByTestId('cast-fab'), `${name} never gets the FAB`).toHaveCount(0);
    await page.getByTestId('tab-kvart').click();
    await expect(page.locator('#layer-kvart')).toBeVisible();
    const cast = page.getByTestId('cast-screen');
    await expect(cast, 'the primary stays in the page, readable').toBeVisible();
    await expect(cast).toHaveAttribute('aria-disabled', 'true');
    await expect(cast).toHaveAttribute('title', sentence);
    await expect(page.getByTestId('cast-why')).toHaveText(sentence);
    await cast.dispatchEvent('click');
    await page.waitForTimeout(300);
    expect(viewFrames(fixture), 'a disabled primary sends nothing').toEqual([]);
  });
}
