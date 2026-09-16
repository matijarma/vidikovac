// The public screen's geometry, in a real browser, at both landscape design
// sizes, the 1080 x 1920 portrait totem, and both faces (the theme resolves
// from prefers-color-scheme at script load). The invitation is the city's
// front page for the stop (kiosk/invitation.ts, kiosk/front.ts): five panels
// and the map among them, nothing rotates, so every size measures the one
// composition the reader sees:
//
//   - the QR is at least 240 CSS px and the code is whole inside its card;
//   - nothing in the stage overflows its block (no half row, no text over a
//     credit line), no two blocks overlap, the stage ends above the strip;
//     the invitation has the page's one h1;
//   - the header and the strip keep their fixed 96 px (wide) / 72 px
//     (compact, portrait) row, scaled by the kiosk's own zoom;
//   - every one of the five panels has something to read (rows, or one
//     honest sentence), fits its box whole after the composition's own fit,
//     and the map host fills its field with nothing on the picture but
//     MapLibre's attribution;
//   - the prozor profile places at most eight major street names in the map
//     panel at every size, read off data-major-labels (contract 3, R-KP19)
//     once the map is ready and a poll has passed;
//   - the basics panel fits its rows without a scroller;
//   - once a phone unlocks the screen, each of the six paired compositions
//     obeys the same clip and overlap rules, the header names the mirrored
//     domain, and no column or strip line is cut by its box.
//
// A screenshot per size and face lands in test-results/kiosk-<w>-<face>.png,
// and one per paired composition in kiosk-<w>-<face>-paired-<layer>.png.
import { expect, test, type Page } from '@playwright/test';
import { APP_URL, E2E_STOP_ID, provisionKiosk, readPairing, unlockOnPhone } from './helpers';
import { KIOSK_WIDE_MIN_PX } from './lib';

/** The two landscape design sizes and the portrait totem; every composition, invitation and paired, is measured at all three. */
const SIZES = [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1080, height: 1920 }] as const;
const FACES = ['light', 'dark'] as const;
type Face = (typeof FACES)[number];
/** The six mirrored domains and the word the kiosk's header names each by (i18n layers.*). */
const LAYERS = { 'grad-sada': 'Sada', 'u-pokretu': 'Promet', 'zrak-i-nebo': 'Vrijeme', sigurnost: 'Sigurnost', 'uprava-i-pravo': 'Grad', kultura: 'Događanja' } as const;
const SHOTS_DIR = 'test-results';
const MIN_QR_PX = 240;
/** frame.ts's fixed row height at wide vs. the compact tokens (compact and portrait share them); C.4. */
const HEAD_STRIP_PX = { wide: 96, compact: 72 } as const;
/** The five panels of the front page (kiosk/front.ts PANEL_IDS). */
const PANELS = ['tonight', 'weather', 'city', 'promet', 'around'] as const;
/** The totem's map panel is at least this tall (kiosk.css, the portrait section), scaled by the kiosk's zoom. */
const MIN_PORTRAIT_FIELD_PX = 340;
/** The most major street names the prozor profile places in the map panel (plan D3, R-KP17), read off data-major-labels (contract 3). */
const MAX_MAJOR_LABELS = 8;
/** How long the placed-labels count is waited for once the map is ready: the controller stamps it once at ready
 *  and then on every map paint, which rides the teaser poll (app/src/motion/loop.ts nextPollDelay, at most 13.5 s). */
const MAJOR_LABELS_WAIT_MS = 20_000;
const MAJOR_LABELS_POLL_MS = 14_000;

/** Every geometry rule in one page-side pass; an empty list is the proof. */
function geometryIssues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const shown = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => el.offsetParent !== null);
    const tag = (el: HTMLElement): string => `${el.className.split(' ')[0]}${el.dataset.testid ? `[${el.dataset.testid}]` : ''}`;
    // A panel, the field, a row, the card or a paired block clips its children when a row does not fit.
    for (const el of shown('.k-field, .k-panel, .k-rows, .k-fr, .k-invite, .k-lines, .k-block, .k-join, .k-ess-row, .k-block-body, .k-side-blocks, .k-strip-items')) {
      if (el.scrollHeight > el.clientHeight + 1) out.push(`overflow-y ${tag(el)} ${el.scrollHeight}>${el.clientHeight}`);
      if (el.scrollWidth > el.clientWidth + 1) out.push(`overflow-x ${tag(el)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    // The header keeps one row: neither the row, its clock group nor the session pill may run wider than its box (a pill ellipsised by its slot counts).
    for (const el of shown('.k-head, .k-head-when, .k-session')) if (el.scrollWidth > el.clientWidth + 1) out.push(`overflow-x ${tag(el)} ${el.scrollWidth}>${el.clientWidth}`);
    const code = shown('[data-testid=pair-code]')[0];
    if (code) {
      const c = code.getBoundingClientRect();
      const card = code.closest<HTMLElement>('.k-invite')!.getBoundingClientRect();
      // Tracked, not owned here: an intermittent 'code clipped' on this check is D17's
      // cap (`min(var(--k-display-size), 15cqi)` in kiosk.css) meeting a real random
      // 8-character code whose glyphs run wider than the "ABCD-EFG0" case the cap's
      // own arithmetic was checked against. See task-T2.11-report.md.
      if (c.right > card.right + 0.5 || code.scrollWidth > code.clientWidth + 1) out.push('code clipped');
    }
    // Two boxes may share a patch of screen only when one CONTAINS the other (R-K7), which is how the map container and
    // MapLibre's attribution may sit on the field -- they are its own children -- while any other pair painting over
    // each other is a fault. The header's three groups are boxes too.
    const boxes = shown('.k-stage .k-panel, .k-stage .k-field, .k-stage .k-fr, .k-stage .k-invite, .k-stage .k-map, .k-stage .k-block, .k-stage .k-join, .k-head-brand, .k-head-mid, .k-head-when')
      .map((el) => [tag(el), el, el.getBoundingClientRect()] as const);
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const [ta, ea, a] = boxes[i]!;
        const [tb, eb, b] = boxes[j]!;
        if (ea.contains(eb) || eb.contains(ea)) continue;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`overlap ${ta}/${tb}`);
      }
    }
    const strip = document.querySelector('.k-strip')!.getBoundingClientRect();
    if (document.querySelector('.k-stage')!.getBoundingClientRect().bottom > strip.top + 0.5) out.push('stage over strip');
    for (const el of shown('.k-strip-item')) if (el.scrollWidth > el.clientWidth + 1) out.push(`strip clipped ${el.dataset.testid}`);
    return out;
  });
}

/** What the front page claims, measured rather than assumed: five panels
 *  each with something to read, the map host filling its field with nothing
 *  on the picture but the attribution, the QR readable, and on the totem a
 *  map panel of at least its minimum height. */
function compositionIssues(page: Page, portrait: boolean, minPortraitFieldPx: number): Promise<string[]> {
  return page.evaluate(({ isPortrait, minField, panels }) => {
    const out: string[] = [];
    const front = document.querySelector<HTMLElement>('.k-front');
    const field = document.querySelector<HTMLElement>('.k-front [data-testid=kiosk-live]');
    const host = document.querySelector<HTMLElement>('.k-front [data-testid=kiosk-map-host]');
    const map = document.querySelector<HTMLElement>('.k-front [data-testid=kiosk-map]');
    if (!front || !field || !host || !map || map.offsetParent === null) return ['the front page has no map in its field'];
    const f = field.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    const overlaps = (a: DOMRect, b: DOMRect): boolean => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    // The map's box is the field: the host fills it.
    if (Math.abs(h.width - f.width) > 1 || Math.abs(h.height - f.height) > 1) out.push(`the map host (${h.width.toFixed(0)}x${h.height.toFixed(0)}) is not the field (${f.width.toFixed(0)}x${f.height.toFixed(0)})`);
    // Nothing on the picture but MapLibre's attribution: every visible box inside the field's rectangle is the map's own or the credit.
    for (const el of [...document.querySelectorAll<HTMLElement>('.kiosk *')]) {
      if (el.offsetParent === null || field.contains(el) || el.contains(field)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && overlaps(r, h)) out.push(`${el.className.split(' ')[0]} crosses the map`);
    }
    for (const el of [...field.querySelectorAll<HTMLElement>('*')]) {
      if (el.offsetParent === null || map.contains(el) || el === map || el === host) continue;
      out.push(`${el.className.split(' ')[0]} is drawn on the field`);
    }
    const attribution = field.querySelectorAll('.maplibregl-ctrl-attrib');
    if (attribution.length !== 1) out.push(`${attribution.length} attribution controls on the field`);
    // Five panels, each with rows or one honest sentence, each whole in its box after the composition's fit (rows the box does not hold are hidden, never clipped).
    for (const id of panels) {
      const panel = document.querySelector<HTMLElement>(`[data-testid=kiosk-panel-${id}]`);
      if (!panel || panel.offsetParent === null) { out.push(`no ${id} panel`); continue; }
      const rows = [...panel.querySelectorAll<HTMLElement>('li.k-fr')].filter((el) => !el.hidden);
      const note = panel.querySelector('.k-panel-note');
      const figure = panel.querySelector('.k-panel-figure');
      if (rows.length === 0 && !note && !figure) out.push(`the ${id} panel has nothing to read`);
      if (panel.scrollHeight > panel.clientHeight + 1) out.push(`the ${id} panel overflows ${panel.scrollHeight}>${panel.clientHeight}`);
      if (!panel.querySelector('h2.k-panel-kicker')) out.push(`the ${id} panel has no kicker`);
    }
    // The QR is readable from steps away.
    const qr = document.querySelector<HTMLElement>('[data-testid=kiosk-qr]')?.getBoundingClientRect();
    if (!qr || qr.width < 240 - 0.5 || qr.height < 240 - 0.5) out.push(`the QR is ${qr?.width.toFixed(0)}x${qr?.height.toFixed(0)}`);
    if (isPortrait && f.height < minField - 0.5) out.push(`the totem's map panel is ${f.height.toFixed(0)} px tall`);
    return out;
  }, { isPortrait: portrait, minField: minPortraitFieldPx, panels: PANELS });
}

/** kiosk/layout.ts's zoom, read off the root: 1 at every design size in SIZES, whatever it is elsewhere. */
function zoomOf(page: Page): Promise<number> {
  return page.evaluate(() => {
    const raw = getComputedStyle(document.querySelector('[data-testid=kiosk]')!).getPropertyValue('--kiosk-zoom').trim();
    return raw === '' ? 1 : Number(raw);
  });
}

async function openInvitation(page: Page, face: Face, size: { width: number; height: number }, kioskUrl: string): Promise<void> {
  await page.emulateMedia({ colorScheme: face });
  await page.setViewportSize(size);
  await page.goto(kioskUrl);
  await expect(page.locator('[data-testid=pair-code][data-state=live]')).toBeVisible({ timeout: 30_000 });
  // Geometry is measured in the final face: Manrope loaded, not the wider fallback; the first teaser has painted the panels.
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[data-testid=kiosk-panel-promet] li.k-fr, [data-testid=kiosk-panel-promet] .k-panel-note').first()).toBeAttached({ timeout: 15_000 });
  await page.waitForTimeout(1500);
}

/** Contract 3, R-KP19: how many distinct major street names the map placed,
 *  as the controller stamped it on the map host once the map was ready and
 *  again after the next paint; read after one whole poll so the tiles have
 *  rendered. Both readings go to the annotations and the log. */
async function majorLabels(page: Page): Promise<number> {
  await expect(page.getByTestId('kiosk-map')).toHaveAttribute('data-map-status', 'ready', { timeout: 30_000 });
  const host = page.getByTestId('kiosk-map-host');
  await expect(host).toHaveAttribute('data-major-labels', /^\d+$/, { timeout: MAJOR_LABELS_WAIT_MS });
  const atReady = Number(await host.getAttribute('data-major-labels'));
  await page.waitForTimeout(MAJOR_LABELS_POLL_MS);
  const count = Number(await host.getAttribute('data-major-labels'));
  const reading = `${count} after a poll (${atReady} at ready)`;
  test.info().annotations.push({ type: 'major-labels', description: reading });
  console.log(`[kiosk-layout] major labels ${page.viewportSize()?.width}x${page.viewportSize()?.height}: ${reading}`);
  return count;
}

for (const size of SIZES) {
  const portrait = size.height > size.width;
  for (const face of FACES) {
    test(`the front page at ${size.width} by ${size.height}, ${face}: whole code, QR of ${MIN_QR_PX} px or more, five panels with something to read, the map among them, nothing overflows or overlaps, basics fit`, async ({ page, request }) => {
      const { kioskUrl } = await provisionKiosk(request, APP_URL, { stopId: E2E_STOP_ID });
      await openInvitation(page, face, size, kioskUrl);
      const root = page.getByTestId('kiosk');
      // A portrait screen is the compact drawing stood up (kiosk/layout.ts), never the wide one on its side.
      const wide = !portrait && size.width >= KIOSK_WIDE_MIN_PX;
      await expect(root).toHaveAttribute('data-size', wide ? 'wide' : 'compact');
      await expect(root).toHaveAttribute('data-portrait', portrait ? '1' : '0');
      await expect(root).toHaveAttribute('data-phase', 'invitation');
      const qr = (await page.getByTestId('kiosk-qr').boundingBox())!;
      expect(qr.width, 'the QR is readable from steps away').toBeGreaterThanOrEqual(MIN_QR_PX);
      expect(qr.height).toBeGreaterThanOrEqual(MIN_QR_PX);

      const zoom = await zoomOf(page);
      const expectedRow = (wide ? HEAD_STRIP_PX.wide : HEAD_STRIP_PX.compact) * zoom;
      const head = (await page.locator('.k-head').boundingBox())!;
      const stripBox = (await page.locator('.k-strip').boundingBox())!;
      expect(Math.abs(head.height - expectedRow), 'the header keeps its fixed row').toBeLessThanOrEqual(1);
      expect(Math.abs(stripBox.height - expectedRow), 'the strip keeps its fixed row').toBeLessThanOrEqual(1);

      // The stage has no padding for the front page: the panels meet the header, the strip and the edges on hairlines.
      const front = (await page.getByTestId('kiosk-invitation').boundingBox())!;
      const stage = (await page.getByTestId('kiosk-stage').boundingBox())!;
      expect(Math.abs(front.x - stage.x), 'the front page starts at the stage edge').toBeLessThanOrEqual(1);
      expect(Math.abs(front.y - stage.y), 'the front page starts under the header').toBeLessThanOrEqual(1);
      expect(Math.abs(front.height - stage.height), 'the front page is the stage’s full height').toBeLessThanOrEqual(1);
      // The stop's lines are the readable route board (the a11y text path reads them): the stop's own routes as rows with badges.
      expect(await page.locator('[data-testid=kiosk-panel-promet] [data-testid=kiosk-lines] li.k-fr .k-line-badge').count(), 'the lines panel lists the stop’s lines').toBeGreaterThan(0);

      // One h1 on the page: the card's lead (e2e/a11y.spec.ts holds the same for every surface without a session); each panel is headed by its kicker.
      expect(await page.locator('h1').count(), 'exactly one h1: the invitation lead').toBe(1);
      expect(await page.locator('[data-testid=kiosk-invitation] h2').count()).toBe(PANELS.length);
      expect(await geometryIssues(page)).toEqual([]);
      expect(await compositionIssues(page, portrait, MIN_PORTRAIT_FIELD_PX * zoom), 'the front page: five panels and the map').toEqual([]);
      const shown = await page.evaluate((panels) => Object.fromEntries(panels.map((id) => [id, [...document.querySelectorAll(`[data-testid=kiosk-panel-${id}] li.k-fr`)].filter((el) => !(el as HTMLElement).hidden).length])), PANELS);
      test.info().annotations.push({ type: 'rows', description: JSON.stringify(shown) });
      console.log(`[kiosk-layout] rows ${size.width}x${size.height} ${face}: ${JSON.stringify(shown)}`);
      await page.screenshot({ path: `${SHOTS_DIR}/kiosk-${size.width}-${face}.png`, fullPage: false });

      // Contract 3: the prozor profile places at most eight major street names in the map panel at every size (R-KP17).
      expect(await majorLabels(page), 'the prozor profile places few major street names in the map panel').toBeLessThanOrEqual(MAX_MAJOR_LABELS);

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
        const { kioskUrl } = await provisionKiosk(request, APP_URL, { stopId: E2E_STOP_ID });
        const kiosk = await kioskCtx.newPage();
        await openInvitation(kiosk, face, size, kioskUrl);
        const { scanUrl } = await readPairing(kiosk, APP_URL);
        const phone = await phoneCtx.newPage();
        await unlockOnPhone(phone, scanUrl, '10 minuta');
        await expect(kiosk.getByTestId('session-label')).toBeVisible({ timeout: 30_000 });
        await expect(kiosk.getByTestId('kiosk-layer')).toBeVisible();
        await expect(kiosk.locator('[data-testid=corner-qr] .qr')).toBeVisible();
        await expect(kiosk.getByTestId('kiosk-essentials-open')).toBeHidden();
        // The paired compositions keep the stage's padding (R-KP8): the phase attribute says so.
        await expect(kiosk.getByTestId('kiosk')).toHaveAttribute('data-phase', 'paired');
        for (const [layer, word] of Object.entries(LAYERS)) {
          // The phone steers through its own history (the dashboard restores the hash), then casts explicitly (D5):
          // the Kvart panel's primary sends the phone's current layer to the room; the screen never follows a tap by itself.
          await phone.evaluate((id) => { location.hash = `#layer=${id}`; }, layer);
          await phone.getByTestId('tab-kvart').click();
          await phone.getByTestId('cast-screen').click();
          await expect(kiosk.locator(`[data-testid=kiosk-layer][data-layer="${layer}"]`)).toBeVisible({ timeout: 15_000 });
          await expect(kiosk.getByTestId('session-label'), 'the header names the mirrored domain').toContainText(`· ${word}`);
          // The layer's own data has arrived and the row fitter has run on the final face.
          await kiosk.waitForTimeout(2500);
          // Depends on fitRows's zero-row floor (kiosk/paired.ts) and the compact
          // block floors in ui/kiosk.css (--k-block-min, the board's floor, the
          // zrak-i-nebo pairing). Provenance: task-T2.11-report.md.
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
  const { kioskUrl } = await provisionKiosk(request, APP_URL, { stopId: E2E_STOP_ID });
  await openInvitation(page, 'light', SIZES[0], kioskUrl);
  const map = page.getByTestId('kiosk-map');
  await expect(map).toHaveAttribute('data-feed', 'stale', { timeout: 15_000 });
  // The lines panel says so too (data-state on the panel): a stale source keeps its rows with the honest word in its credit.
  await expect(page.getByTestId('kiosk-panel-promet')).toHaveAttribute('data-state', 'stale', { timeout: 15_000 });
  await expect(page.locator('[data-testid=kiosk-panel-promet] .k-panel-credit')).toContainText('zastarjelo');
  // The basics panel pauses and resumes the map; the hold survives the resume.
  await page.getByTestId('kiosk-essentials-open').click();
  await page.keyboard.press('Escape');
  await expect(map).toHaveAttribute('data-feed', 'stale');
});
