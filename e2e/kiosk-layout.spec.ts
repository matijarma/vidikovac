// The public screen's geometry, in a real browser, at both design sizes and
// both faces (the theme resolves from prefers-color-scheme at script load):
//
//   - the QR is at least 240 CSS px and the code is whole inside its card;
//   - nothing in the stage overflows its block (no half row, no text over a
//     source line), no two blocks overlap, the stage ends above the strip;
//   - the map column is the stage's dominant element and the lines board
//     leaves most of it visible;
//   - the basics panel fits its rows without a scroller;
//   - once a phone unlocks the screen, the paired composition obeys the same
//     rules.
//
// A screenshot per size and face lands in test-results/kiosk-<w>-<face>.png.
import { expect, test, type Page } from '@playwright/test';
import { APP_URL, provisionKiosk, readPairing, unlockOnPhone } from './helpers';
import { KIOSK_WIDE_MIN_PX } from './lib';

const SIZES = [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }] as const;
const FACES = ['light', 'dark'] as const;
type Face = (typeof FACES)[number];
const SHOTS_DIR = 'test-results';
const MIN_QR_PX = 240;

/** Every geometry rule in one page-side pass; an empty list is the proof. */
function geometryIssues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const shown = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => el.offsetParent !== null);
    const tag = (el: HTMLElement): string => `${el.className.split(' ')[0]}${el.dataset.testid ? `[${el.dataset.testid}]` : ''}`;
    for (const el of shown('.k-block, .k-invite, .k-story, .k-weather, .k-lines, .k-join, .k-ess-row, .k-block-body')) {
      if (el.scrollHeight > el.clientHeight + 1) out.push(`overflow-y ${tag(el)} ${el.scrollHeight}>${el.clientHeight}`);
      if (el.scrollWidth > el.clientWidth + 1) out.push(`overflow-x ${tag(el)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    const code = shown('[data-testid=pair-code]')[0];
    if (code) {
      const c = code.getBoundingClientRect();
      const card = code.closest<HTMLElement>('.k-invite')!.getBoundingClientRect();
      if (c.right > card.right + 0.5 || code.scrollWidth > code.clientWidth + 1) out.push('code clipped');
    }
    const title = shown('.k-story-title')[0];
    if (title && title.getBoundingClientRect().bottom > title.closest<HTMLElement>('.k-story')!.getBoundingClientRect().bottom + 0.5) out.push('story title clipped');
    const boxes = shown('.k-stage .k-block, .k-stage .k-invite, .k-stage .k-story, .k-stage .k-weather, .k-stage .k-join, .k-stage .k-map').map((el) => [tag(el), el.getBoundingClientRect()] as const);
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const [ta, a] = boxes[i]!;
        const [tb, b] = boxes[j]!;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`overlap ${ta}/${tb}`);
      }
    }
    const strip = document.querySelector('.k-strip')!.getBoundingClientRect();
    if (document.querySelector('.k-stage')!.getBoundingClientRect().bottom > strip.top + 0.5) out.push('stage over strip');
    for (const el of shown('.k-strip-item')) if (el.scrollWidth > el.clientWidth + 1) out.push(`strip clipped ${el.dataset.testid}`);
    return out;
  });
}

async function openInvitation(page: Page, face: Face, size: { width: number; height: number }, kioskUrl: string): Promise<void> {
  await page.emulateMedia({ colorScheme: face });
  await page.setViewportSize(size);
  await page.goto(kioskUrl);
  await expect(page.locator('[data-testid=pair-code][data-state=live]')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
}

for (const size of SIZES) {
  for (const face of FACES) {
    test(`the invitation at ${size.width} by ${size.height}, ${face}: whole code, QR of ${MIN_QR_PX} px or more, nothing overflows or overlaps, basics fit`, async ({ page, request }) => {
      const { kioskUrl } = await provisionKiosk(request, APP_URL);
      await openInvitation(page, face, size, kioskUrl);
      expect(await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid=kiosk]')?.dataset.size)).toBe(size.width >= KIOSK_WIDE_MIN_PX ? 'wide' : 'compact');
      const qr = (await page.getByTestId('kiosk-qr').boundingBox())!;
      expect(qr.width, 'the QR is readable from steps away').toBeGreaterThanOrEqual(MIN_QR_PX);
      expect(qr.height).toBeGreaterThanOrEqual(MIN_QR_PX);
      const map = (await page.getByTestId('kiosk-live').boundingBox())!;
      const stage = (await page.getByTestId('kiosk-stage').boundingBox())!;
      expect(map.width / stage.width, 'the map column is the dominant element').toBeGreaterThan(0.55);
      const lines = (await page.getByTestId('kiosk-lines').boundingBox())!;
      expect(lines.height / map.height, 'the lines board leaves most of the map visible').toBeLessThan(0.5);
      expect(await geometryIssues(page)).toEqual([]);
      await page.screenshot({ path: `${SHOTS_DIR}/kiosk-${size.width}-${face}.png`, fullPage: false });

      await page.getByTestId('kiosk-essentials-open').click();
      const panel = page.getByTestId('kiosk-essentials');
      await expect(panel).toBeVisible();
      expect(await panel.evaluate((el) => el.scrollHeight <= el.clientHeight + 1), 'the basics panel never scrolls').toBe(true);
      expect(await geometryIssues(page)).toEqual([]);
      await page.screenshot({ path: `${SHOTS_DIR}/kiosk-${size.width}-${face}-basics.png`, fullPage: false });
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    });
  }
}

test('paired at 1920 by 1080: the phone unlocks the screen and the mirrored composition obeys the same geometry', async ({ browser, request }) => {
  const kioskCtx = await browser.newContext({ viewport: SIZES[0] });
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const { kioskUrl } = await provisionKiosk(request, APP_URL);
    const kiosk = await kioskCtx.newPage();
    await openInvitation(kiosk, 'light', SIZES[0], kioskUrl);
    const { scanUrl } = await readPairing(kiosk, APP_URL);
    await unlockOnPhone(await phoneCtx.newPage(), scanUrl, '10 minuta');
    await expect(kiosk.getByTestId('session-label')).toBeVisible({ timeout: 30_000 });
    await expect(kiosk.getByTestId('kiosk-layer')).toBeVisible();
    await expect(kiosk.locator('[data-testid=corner-qr] .qr')).toBeVisible();
    await expect(kiosk.getByTestId('kiosk-essentials-open')).toBeHidden();
    await kiosk.waitForTimeout(2500);
    expect(await geometryIssues(kiosk)).toEqual([]);
    await kiosk.screenshot({ path: `${SHOTS_DIR}/kiosk-1920-paired.png`, fullPage: false });
  } finally {
    await phoneCtx.close();
    await kioskCtx.close();
  }
});

test('a stale ZET feed holds the map: the screen tells the map the feed state and nothing animates through an outage', async ({ page, request }) => {
  // Every teaser answer arrives with zet-rt marked stale, as the Worker serves a last-good copy during an outage.
  await page.route('**/api/teaser**', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { modules: { module: string; status: string }[] };
    body.modules = body.modules.map((m) => (m.module === 'zet-rt' ? { ...m, status: 'stale' } : m));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const { kioskUrl } = await provisionKiosk(request, APP_URL);
  await openInvitation(page, 'light', SIZES[0], kioskUrl);
  const map = page.getByTestId('kiosk-map');
  await expect(map).toHaveAttribute('data-feed', 'stale', { timeout: 15_000 });
  // The board says so too, and the lines keep their last words rather than a fresh claim.
  await expect(page.getByTestId('kiosk-lines')).toContainText('zastarjelo');
  // The basics panel pauses and resumes the map; the hold survives the resume.
  await page.getByTestId('kiosk-essentials-open').click();
  await page.keyboard.press('Escape');
  await expect(map).toHaveAttribute('data-feed', 'stale');
});
