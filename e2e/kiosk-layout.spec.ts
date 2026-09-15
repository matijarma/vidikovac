// The public screen's geometry, in a real browser, at both landscape design
// sizes, the 1080 x 1920 portrait totem, and both faces (the theme resolves
// from prefers-color-scheme at script load). Every size opens the invitation
// pinned to `?prizor=promet` (D13's operator hook, as lagano.spec does),
// exactly like the scene the reader lands on before rotation ever tries to
// move it, so a slow CI box never measures a field mid-swap:
//
//   - the QR is at least 240 CSS px and the code is whole inside its card;
//   - nothing in the stage overflows its block (no half row, no text over a
//     source line), no two blocks overlap, the stage ends above the strip;
//   - the header and the strip keep their fixed 96 px (wide) / 72 px
//     (compact, portrait) row, scaled by the kiosk's own zoom;
//   - the scene field is the stage's dominant element in landscape and, in
//     portrait, at least 55% of the stage's height and nearly its full width;
//   - a portrait screen stacks the invitation (plan, Kiosk (i)): the scene on
//     top, the two value tiles and the invitation card side by side under it
//     with the card to the right, the two tiles sharing a row of their own;
//   - Večeras and Grad, reached through their own `?prizor=` pins, pass the
//     same clip and overlap checks;
//   - the basics panel fits its rows without a scroller;
//   - once a phone unlocks the screen, each of the seven paired compositions
//     obeys the same clip and overlap rules, the header names the mirrored
//     domain, and no column or strip line is cut by its box.
//
// A screenshot per size and face lands in test-results/kiosk-<w>-<face>.png,
// one per scene in test-results/kiosk-<w>-<face>-<scene>.png, and one per
// paired composition in kiosk-<w>-<face>-paired-<layer>.png.
import { expect, test, type Page } from '@playwright/test';
import { APP_URL, provisionKiosk, readPairing, unlockOnPhone } from './helpers';
import { KIOSK_WIDE_MIN_PX } from './lib';

/** The two landscape design sizes and the portrait totem; every composition, invitation and paired, is measured at all three. */
const SIZES = [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1080, height: 1920 }] as const;
const FACES = ['light', 'dark'] as const;
type Face = (typeof FACES)[number];
/** The seven mirrored domains and the word the kiosk's header names each by (kiosk/strings-hr.ts layers). */
const LAYERS = { 'grad-sada': 'Sada', 'u-pokretu': 'Promet', 'zrak-i-nebo': 'Vrijeme', sigurnost: 'Sigurnost', 'uprava-i-pravo': 'Grad', kultura: 'Događanja', vijesti: 'Vijesti' } as const;
/** kiosk/scenes.ts's SCENE_ORDER, mirrored here so the spec names no import from app code. */
const OTHER_SCENES = ['veceras', 'grad'] as const;
const SHOTS_DIR = 'test-results';
const MIN_QR_PX = 240;
/** frame.ts's fixed row height at wide vs. the compact tokens (compact and portrait share them); C.4. */
const HEAD_STRIP_PX = { wide: 96, compact: 72 } as const;

/** Every geometry rule in one page-side pass; an empty list is the proof. */
function geometryIssues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const shown = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => el.offsetParent !== null);
    const tag = (el: HTMLElement): string => `${el.className.split(' ')[0]}${el.dataset.testid ? `[${el.dataset.testid}]` : ''}`;
    // A tile, the scene field or the side column's block box clips its children when a row or a title does not fit.
    for (const el of shown('.tl, .k-scene, .k-scene-body, .k-invite, .k-side, .k-lines, .k-block, .k-join, .k-ess-row, .k-block-body, .k-side-blocks, .k-strip-items')) {
      if (el.scrollHeight > el.clientHeight + 1) out.push(`overflow-y ${tag(el)} ${el.scrollHeight}>${el.clientHeight}`);
      if (el.scrollWidth > el.clientWidth + 1) out.push(`overflow-x ${tag(el)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    const code = shown('[data-testid=pair-code]')[0];
    if (code) {
      const c = code.getBoundingClientRect();
      const card = code.closest<HTMLElement>('.k-invite')!.getBoundingClientRect();
      if (c.right > card.right + 0.5 || code.scrollWidth > code.clientWidth + 1) out.push('code clipped');
    }
    // Every visible tile title, in every scene and column: clamped, never overflowing its tile, never squeezed to no height.
    for (const title of shown('.tl-title')) {
      const tile = title.closest<HTMLElement>('.tl')!;
      if (title.getBoundingClientRect().bottom > tile.getBoundingClientRect().bottom + 0.5) out.push(`${tag(tile)} title clipped`);
      if (title.textContent!.trim() !== '' && title.clientHeight === 0) out.push(`${tag(tile)} title has no height`);
    }
    const boxes = shown('.k-stage .tl, .k-stage .k-invite, .k-stage .k-map, .k-stage .k-block, .k-stage .k-join').map((el) => [tag(el), el.getBoundingClientRect()] as const);
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

/** kiosk/layout.ts's zoom, read off the root: 1 at every design size in SIZES, whatever it is elsewhere. */
function zoomOf(page: Page): Promise<number> {
  return page.evaluate(() => {
    const raw = getComputedStyle(document.querySelector('[data-testid=kiosk]')!).getPropertyValue('--kiosk-zoom').trim();
    return raw === '' ? 1 : Number(raw);
  });
}

async function openInvitation(page: Page, face: Face, size: { width: number; height: number }, kioskUrl: string, scene: 'promet' | (typeof OTHER_SCENES)[number] = 'promet'): Promise<void> {
  await page.emulateMedia({ colorScheme: face });
  await page.setViewportSize(size);
  await page.goto(kioskUrl.replace('#', `?prizor=${scene}#`));
  await expect(page.locator('[data-testid=pair-code][data-state=live]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('kiosk-scene')).toHaveAttribute('data-scene', scene, { timeout: 15_000 });
  // Geometry is measured in the final face: Manrope loaded, not the wider fallback.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
}

for (const size of SIZES) {
  const portrait = size.height > size.width;
  for (const face of FACES) {
    test(`the invitation at ${size.width} by ${size.height}, ${face}: whole code, QR of ${MIN_QR_PX} px or more, nothing overflows or overlaps, basics fit`, async ({ page, request }) => {
      const { kioskUrl } = await provisionKiosk(request, APP_URL);
      await openInvitation(page, face, size, kioskUrl, 'promet');
      const root = page.getByTestId('kiosk');
      // A portrait screen is the compact drawing stood up (kiosk/layout.ts), never the wide one on its side.
      const wide = !portrait && size.width >= KIOSK_WIDE_MIN_PX;
      await expect(root).toHaveAttribute('data-size', wide ? 'wide' : 'compact');
      await expect(root).toHaveAttribute('data-portrait', portrait ? '1' : '0');
      const qr = (await page.getByTestId('kiosk-qr').boundingBox())!;
      expect(qr.width, 'the QR is readable from steps away').toBeGreaterThanOrEqual(MIN_QR_PX);
      expect(qr.height).toBeGreaterThanOrEqual(MIN_QR_PX);

      const zoom = await zoomOf(page);
      const expectedRow = (wide ? HEAD_STRIP_PX.wide : HEAD_STRIP_PX.compact) * zoom;
      const head = (await page.locator('.k-head').boundingBox())!;
      const stripBox = (await page.locator('.k-strip').boundingBox())!;
      expect(Math.abs(head.height - expectedRow), 'the header keeps its fixed row').toBeLessThanOrEqual(1);
      expect(Math.abs(stripBox.height - expectedRow), 'the strip keeps its fixed row').toBeLessThanOrEqual(1);

      const scene = (await page.getByTestId('kiosk-scene').boundingBox())!;
      const stage = (await page.getByTestId('kiosk-stage').boundingBox())!;
      if (portrait) {
        // Plan, Kiosk (i): the scene field on top at 55% of the stage or more, the two tiles and the card sharing the row under it, the card to the right.
        expect(scene.height / stage.height, 'the scene field is 55% or more of a portrait stage').toBeGreaterThanOrEqual(0.55);
        expect(scene.width / stage.width, 'the scene field spans nearly the full width').toBeGreaterThan(0.9);
        const tiles = (await page.getByTestId('kiosk-tiles').boundingBox())!;
        const invite = (await page.getByTestId('kiosk-invite').boundingBox())!;
        // "Share a row" means side by side, not a pixel-identical top edge: the
        // tiles column stretches the full row (its own tiles centred inside it,
        // .k-side-tiles's own align-content), while the card sits at its natural
        // height within the same row -- both end up flush with the row's foot.
        expect(tiles.y, 'the tiles and the invitation card share a row').toBeLessThan(invite.y + invite.height);
        expect(invite.y, 'the tiles and the invitation card share a row').toBeLessThan(tiles.y + tiles.height);
        expect(invite.x, 'the card sits to the right of the tiles').toBeGreaterThanOrEqual(tiles.x + tiles.width - 1);
        const tileEls = page.getByTestId('kiosk-tiles').locator('.tl');
        await expect(tileEls, 'the two value tiles').toHaveCount(2);
        const tileBoxes = await Promise.all([tileEls.nth(0).boundingBox(), tileEls.nth(1).boundingBox()]);
        expect(Math.abs(tileBoxes[0]!.y - tileBoxes[1]!.y), 'the two value tiles share a row').toBeLessThan(1);
      } else {
        expect(scene.width / stage.width, 'the scene field is the stage’s dominant element').toBeGreaterThanOrEqual(0.58);
      }
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

      // Večeras and Grad, reached through their own pins (D13): the same clip and overlap proof, one screenshot each.
      for (const other of OTHER_SCENES) {
        await openInvitation(page, face, size, kioskUrl, other);
        expect(await geometryIssues(page), other).toEqual([]);
        await page.screenshot({ path: `${SHOTS_DIR}/kiosk-${size.width}-${face}-${other}.png`, fullPage: false });
      }
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
