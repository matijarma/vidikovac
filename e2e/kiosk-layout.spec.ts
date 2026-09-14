// The public screen's geometry, in a real browser, at both landscape design
// sizes, the 1080 x 1920 portrait totem, and both faces (the theme resolves
// from prefers-color-scheme at script load):
//
//   - the QR is at least 240 CSS px and the code is whole inside its card;
//   - nothing in the stage overflows its block (no half row, no text over a
//     source line), no two blocks overlap, the stage ends above the strip;
//   - the map column is the stage's dominant element and the lines board
//     leaves most of it visible;
//   - the basics panel fits its rows without a scroller;
//   - a portrait screen stacks the stage (plan, Kiosk (i)): the map on top at
//     55% of the stage with the board over its foot, the invitation card
//     across the width under it, the weather and the story side by side,
//     the strip at the bottom, on the compact tiers with the 240 px QR;
//   - once a phone unlocks the screen, each of the seven paired compositions
//     obeys the same rules, the header names the mirrored domain, and no
//     column or strip line is cut by its box.
//
// A screenshot per size and face lands in test-results/kiosk-<w>-<face>.png,
// and one per paired composition in kiosk-<w>-<face>-paired-<layer>.png.
import { expect, test, type Page } from '@playwright/test';
import { APP_URL, provisionKiosk, readPairing, unlockOnPhone } from './helpers';
import { KIOSK_WIDE_MIN_PX } from './lib';

/** The two landscape design sizes and the portrait totem; every composition, invitation and paired, is measured at all three. */
const SIZES = [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1080, height: 1920 }] as const;
const FACES = ['light', 'dark'] as const;
type Face = (typeof FACES)[number];
/** The seven mirrored domains and the word the kiosk's header names each by (kiosk/strings-hr.ts layers). */
const LAYERS = { 'grad-sada': 'Sada', 'u-pokretu': 'Promet', 'zrak-i-nebo': 'Vrijeme', sigurnost: 'Sigurnost', 'uprava-i-pravo': 'Grad', kultura: 'Događanja', vijesti: 'Vijesti' } as const;
const SHOTS_DIR = 'test-results';
const MIN_QR_PX = 240;

/** Every geometry rule in one page-side pass; an empty list is the proof. */
function geometryIssues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const shown = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => el.offsetParent !== null);
    const tag = (el: HTMLElement): string => `${el.className.split(' ')[0]}${el.dataset.testid ? `[${el.dataset.testid}]` : ''}`;
    // The side column's block box and the strip's line box clip their children when a column or a third line does not fit.
    for (const el of shown('.k-block, .k-invite, .k-story, .k-weather, .k-lines, .k-join, .k-ess-row, .k-block-body, .k-side-blocks, .k-strip-items')) {
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
    // A title squeezed to no height by its flex column would pass the clip check above with nothing on screen.
    if (title && title.clientHeight === 0) out.push('story title has no height');
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
  // Geometry is measured in the final face: Manrope loaded, not the wider fallback.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
}

for (const size of SIZES) {
  const portrait = size.height > size.width;
  for (const face of FACES) {
    test(`the invitation at ${size.width} by ${size.height}, ${face}: whole code, QR of ${MIN_QR_PX} px or more, nothing overflows or overlaps, basics fit`, async ({ page, request }) => {
      const { kioskUrl } = await provisionKiosk(request, APP_URL);
      await openInvitation(page, face, size, kioskUrl);
      const root = page.getByTestId('kiosk');
      // A portrait screen is the compact drawing stood up (kiosk/layout.ts), never the wide one on its side.
      await expect(root).toHaveAttribute('data-size', !portrait && size.width >= KIOSK_WIDE_MIN_PX ? 'wide' : 'compact');
      await expect(root).toHaveAttribute('data-portrait', portrait ? '1' : '0');
      const qr = (await page.getByTestId('kiosk-qr').boundingBox())!;
      expect(qr.width, 'the QR is readable from steps away').toBeGreaterThanOrEqual(MIN_QR_PX);
      expect(qr.height).toBeGreaterThanOrEqual(MIN_QR_PX);
      const map = (await page.getByTestId('kiosk-live').boundingBox())!;
      const stage = (await page.getByTestId('kiosk-stage').boundingBox())!;
      if (portrait) {
        // Plan, Kiosk (i): the map on top at 55% of the stage, the card across the width under it, the weather and the story side by side.
        expect(map.height / stage.height, 'the map is the top half or more of a portrait stage').toBeGreaterThanOrEqual(0.5);
        expect(map.width / stage.width, 'the map spans the width').toBeGreaterThan(0.9);
        const invite = (await page.getByTestId('kiosk-invite').boundingBox())!;
        const weather = (await page.getByTestId('kiosk-weather').boundingBox())!;
        const story = (await page.getByTestId('kiosk-story').boundingBox())!;
        expect(invite.y, 'the card sits under the map').toBeGreaterThanOrEqual(map.y + map.height);
        expect(invite.width / stage.width, 'the card spans the width').toBeGreaterThan(0.9);
        expect(weather.y, 'the two tiles sit under the card').toBeGreaterThanOrEqual(invite.y + invite.height);
        expect(Math.abs(story.y - weather.y), 'the weather and the story share a row').toBeLessThan(1);
        expect(story.x, 'the story sits beside the weather').toBeGreaterThanOrEqual(weather.x + weather.width);
      } else {
        expect(map.width / stage.width, 'the map column is the dominant element').toBeGreaterThan(0.55);
      }
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

for (const size of SIZES) {
  for (const face of FACES) {
    test(`paired at ${size.width} by ${size.height}, ${face}: the phone unlocks the screen and every mirrored composition obeys the same geometry`, async ({ browser, request }) => {
      const kioskCtx = await browser.newContext({ viewport: size, colorScheme: face });
      const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      try {
        const { kioskUrl } = await provisionKiosk(request, APP_URL);
        const kiosk = await kioskCtx.newPage();
        await openInvitation(kiosk, face, size, kioskUrl);
        const { scanUrl } = await readPairing(kiosk, APP_URL);
        const phone = await phoneCtx.newPage();
        await unlockOnPhone(phone, scanUrl, '10 minuta');
        await expect(kiosk.getByTestId('session-label')).toBeVisible({ timeout: 30_000 });
        await expect(kiosk.getByTestId('kiosk-layer')).toBeVisible();
        await expect(kiosk.locator('[data-testid=corner-qr] .qr')).toBeVisible();
        await expect(kiosk.getByTestId('kiosk-essentials-open')).toBeHidden();
        for (const [layer, word] of Object.entries(LAYERS)) {
          // The phone steers through its own history: the dashboard restores the hash and relays the view to the room.
          await phone.evaluate((id) => { location.hash = `#layer=${id}`; }, layer);
          await expect(kiosk.locator(`[data-testid=kiosk-layer][data-layer="${layer}"]`)).toBeVisible({ timeout: 15_000 });
          await expect(kiosk.getByTestId('session-label'), 'the header names the mirrored domain').toContainText(`· ${word}`);
          // The layer's own data has arrived and the row fitter has run on the final face.
          await kiosk.waitForTimeout(2500);
          expect(await geometryIssues(kiosk), layer).toEqual([]);
          await kiosk.screenshot({ path: `${SHOTS_DIR}/kiosk-${size.width}-${face}-paired-${layer}.png`, fullPage: false });
        }
      } finally {
        await phoneCtx.close();
        await kioskCtx.close();
      }
    });
  }
}

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
