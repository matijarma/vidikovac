import { expect, test, type Page } from '@playwright/test';
import { experienceSnapshots, FIXTURE_DASHBOARD, installExperienceFixture, type FixtureOptions, type FixtureSession } from './experience-fixtures';

const frames = (fixture: FixtureSession) => fixture.events.filter(event => event.t === 'present');
async function open(page: Page, desktop = false, options: FixtureOptions = {}) {
  await page.setViewportSize(desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 });
  const fixture = await installExperienceFixture(page, await experienceSnapshots(), options);
  await page.goto(FIXTURE_DASHBOARD);
  await expect(page.getByTestId('session-label')).toHaveAttribute('data-state', 'live');
  await expect(page.getByTestId('tb')).toBeVisible();
  return fixture;
}

test('phone: navigation is private; one explicit request waits for acknowledgement', async ({ page }) => {
  const fixture = await open(page);
  await page.locator('.ki-tabs [data-layer=u-pokretu]').click();
  await page.locator('.ki-tabs [data-layer=grad-sada]').click();
  expect(frames(fixture)).toEqual([]);
  await expect(page.getByTestId('cast-fab')).toHaveCount(0);
  await page.getByTestId('screen-control').click();
  expect(frames(fixture)).toEqual([]);
  await page.getByTestId('present-view').click();
  await expect.poll(() => frames(fixture).length).toBe(1);
  expect(frames(fixture)[0]).toMatchObject({ command: { version: 1, action: 'present', expectedRevision: 0, target: { layer: 'grad-sada' } } });
  await expect(page.getByTestId('presentation-feedback')).toContainText('Čekamo potvrdu');
  fixture.acknowledgePresentation();
  await expect(page.getByTestId('presentation-feedback')).toContainText('Prikazano');
  await page.getByTestId('stop-presentation').click();
  await expect.poll(() => frames(fixture).length).toBe(2);
  expect(frames(fixture)[1]).toMatchObject({ command: { action: 'stop', expectedRevision: 1 } });
});

test('desktop: the visible transport selection is the public target, with no competing map sidebar', async ({ page }) => {
  const fixture = await open(page, true);
  await expect(page.getByTestId('kvart-aside')).toHaveCount(0);
  await page.locator('.ki-domains [data-layer=u-pokretu]').click();
  await page.getByTestId('transport-search').fill('6');
  await page.locator('[data-action=select-route][data-id="6"]').first().click();
  expect(frames(fixture)).toEqual([]);
  await page.getByTestId('screen-control').click();
  await page.getByTestId('present-view').click();
  await expect.poll(() => frames(fixture).length).toBe(1);
  expect(frames(fixture)[0]).toMatchObject({ command: { target: { layer: 'u-pokretu', selection: { kind: 'route', id: '6' } } } });
});

for (const options of [{ role: 'phone' } as FixtureOptions, { screen: false } as FixtureOptions]) {
  test(`no public-screen control for ${options.role ?? 'a screenless session'}`, async ({ page }) => {
    const fixture = await open(page, false, options);
    await expect(page.getByTestId('screen-control')).toHaveCount(0);
    await expect(page.getByTestId('cast-fab')).toHaveCount(0);
    expect(frames(fixture)).toEqual([]);
  });
}
