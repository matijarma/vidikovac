// The public screen's geometry, in a real browser, at both landscape design
// sizes, the 1080 x 1920 portrait totem, and both faces (the theme resolves
// from prefers-color-scheme at script load). The invitation is one fixed
// window (plan "Frame", R-KP1): nothing rotates, so every size measures the
// one composition the reader sees:
//
//   - the QR is at least 240 CSS px and the code is whole inside its card;
//   - nothing in the stage overflows its block (no half statement, no text
//     over a source line), no two blocks overlap, the stage ends above the
//     strip; the invitation has the page's one h1;
//   - the header and the strip keep their fixed 96 px (wide) / 72 px
//     (compact, portrait) row, scaled by the kiosk's own zoom;
//   - the map IS the field: in landscape at least 0.60 of the invitation by
//     area, with nothing on the picture but MapLibre's attribution and the
//     column never crossing it; in portrait the field is half the stage or
//     more with the statements left of the card under it;
//   - every statement value fits its box in at most two lines and is never
//     ellipsised (R-KP5: the composer shortens by rule and by measurement);
//   - the frame holds its statements: with the plan's own three statements
//     in the column, both landscape sizes show two whole over the card and
//     the totem's row three, the transit label within the rows its badge
//     cap budgets, a long title cut at a word (kiosk.css "The column");
//   - the prozor profile places at most eight major street names in the
//     field, read off data-major-labels (contract 3, R-KP19) once the map is
//     ready and a paint has counted them (Jelačić always has named roads in
//     view, so the count is a positive number);
//   - the basics panel fits its rows without a scroller;
//   - once a phone unlocks the screen, each of the six paired compositions
//     obeys the same clip and overlap rules, the header names the mirrored
//     domain, and no column or strip line is cut by its box.
//
// A screenshot per size and face lands in test-results/kiosk-<w>-<face>.png,
// and one per paired composition in kiosk-<w>-<face>-paired-<layer>.png.
import { expect, test, type Page } from '@playwright/test';
import { SAY_BADGE_CAP, type Composition } from '../app/src/kiosk/layout';
import { APP_URL, provisionKiosk, readPairing, unlockOnPhone } from './helpers';
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
/** The map's least share of the invitation by area in landscape (plan "Frame": 0.73 at 1920, 0.68 at 1366). */
const MIN_MAP_SHARE = 0.6;
/** The field's least share of a portrait stage's height (plan "Frame"). */
const MIN_PORTRAIT_FIELD = 0.5;
/** The most major street names the prozor profile places in the field (plan D3), read off data-major-labels (contract 3). */
const MAX_MAJOR_LABELS = 8;
/** How long a positive placed-labels count is waited for once the map is ready: the controller stamps it once at
 *  ready (when the tiles may not have rendered a name yet) and then on every map paint, which rides the teaser poll
 *  (app/src/motion/loop.ts nextPollDelay, at most 13.5 s), so one poll after ready plus rendering slack. */
const MAJOR_LABELS_WAIT_MS = 20_000;
/** A statement value is at most this many lines (R-KP5). */
const MAX_VALUE_LINES = 2;
/** The 1 s tick fits the column (kiosk.ts fitAll); a sample put into it is measured within this. */
const FIT_WAIT_MS = 10_000;

/** What the frame holds at each design size, measured with the plan's own
 *  three statements (plan "The column": the transit verdict with the stop's
 *  line badges and a two-line worst case, a closure, a session with a long
 *  title) put into the live column and fitted by the composition
 *  (kiosk/invitation.ts fit()). Full HD holds two whole statements over the
 *  card at both landscape sizes -- a third needs about 400 px where the
 *  520 px column has 373 beside the 240 px QR card with its two-line lead
 *  (kiosk.css "The column") -- and the totem's row holds three. The label
 *  rows are the badge cap's budget (kiosk/layout.ts SAY_BADGE_CAP): two at
 *  wide, one at compact; the totem's eight badges take one or two. */
const FRAME: Record<Exclude<Composition, 'handheld'>, { shown: readonly string[]; labelRowsAtMost: number }> = {
  wide: { shown: ['e2e:transit', 'e2e:closure'], labelRowsAtMost: 2 },
  compact: { shown: ['e2e:transit', 'e2e:closure'], labelRowsAtMost: 1 },
  portrait: { shown: ['e2e:transit', 'e2e:closure', 'e2e:assembly'], labelRowsAtMost: 2 },
};
/** An eleven-line stop (Trg bana Jelačića's trams, then buses), badged to the composition's cap with the "+N" tail as say.ts would. */
const STOP_LINES: readonly (readonly [string, 'tram' | 'bus'])[] = [['1', 'tram'], ['6', 'tram'], ['11', 'tram'], ['12', 'tram'], ['13', 'tram'], ['14', 'tram'], ['17', 'tram'], ['106', 'bus'], ['201', 'bus'], ['203', 'bus'], ['268', 'bus']];
/** The session's title in the plan's example, longer than two lines of the main tier at every size, so the composition has to cut it. */
const ASSEMBLY_TITLE = '25. sjednica Odbora za Statut, Poslovnik i propise Gradske skupštine Grada Zagreba';
/** The plan's own statements in the contract's markup (contract 4), keyed apart from the ranker's and marked as the sample. */
function sampleStatements(composition: Composition): string {
  const cap = SAY_BADGE_CAP[composition];
  const badges = STOP_LINES.slice(0, cap).map(([n, kind]) => `<span class="k-line-badge line" data-kind="${kind}" data-size="k" aria-label="${kind === 'tram' ? 'Tramvaj' : 'Autobus'} ${n}">${n}</span>`).join('');
  const more = STOP_LINES.length > cap ? `<span class="k-say-more">+${STOP_LINES.length - cap}</span>` : '';
  return `<article class="k-say" data-e2e-sample data-key="e2e:transit" data-domain="transit" data-tone="late" data-testid="kiosk-say" data-say="transit">
  <p class="k-say-label"><span class="k-say-kicker">Promet</span><span class="k-say-badges">${badges}${more}</span></p>
  <p class="k-say-value" data-replace data-sig="6 kasni 4 min · 13 kasni 3 min">6 kasni 4 min · 13 kasni 3 min</p>
  <p class="k-say-context">23 vozila u blizini · ZET 14:34</p>
</article>
<article class="k-say" data-e2e-sample data-key="e2e:closure" data-domain="komunalno" data-tone="komunalno" data-testid="kiosk-say" data-say="closure">
  <p class="k-say-label"><span class="k-say-kicker">Zatvoreno</span></p>
  <p class="k-say-value" data-replace data-sig="Amruševa">Amruševa</p>
  <p class="k-say-context">350 m · oba smjera · do 18:00</p>
</article>
<article class="k-say" data-e2e-sample data-key="e2e:assembly" data-domain="civic" data-testid="kiosk-say" data-say="assembly">
  <p class="k-say-label"><span class="k-say-kicker">Gradska skupština</span></p>
  <p class="k-say-value" data-replace data-sig="${ASSEMBLY_TITLE}">${ASSEMBLY_TITLE}</p>
  <p class="k-say-context">sutra 08:30 · Skupština Grada Zagreba</p>
</article>`;
}

interface FrameMeasure {
  /** The sample statements the composition left shown, in order. */
  shown: string[];
  /** The column's box holds everything shown (nothing is clipped). */
  overflow: boolean;
  /** Lines per shown value: the box's height over its line-height. */
  valueLines: Record<string, number>;
  /** The shown values' text, to see a cut title end in an ellipsis. */
  values: Record<string, string>;
  /** Distinct rows the transit label's badges and tail stand on. */
  labelRows: number;
}
/** Puts the sample into the live column (again, if a paint since replaced it) and reads what the composition made of it. */
function measureFrame(page: Page, html: string): Promise<FrameMeasure> {
  return page.evaluate((sample) => {
    const says = document.querySelector<HTMLElement>('[data-testid=kiosk-says]')!;
    if (!says.querySelector('[data-e2e-sample]')) says.innerHTML = sample;
    const items = [...says.querySelectorAll<HTMLElement>('article[data-e2e-sample]')];
    const shownItems = items.filter((el) => el.offsetParent !== null);
    const valueLines: Record<string, number> = {};
    const values: Record<string, string> = {};
    for (const el of shownItems) {
      const value = el.querySelector<HTMLElement>('.k-say-value')!;
      const lineHeight = Number.parseFloat(getComputedStyle(value).lineHeight);
      valueLines[el.dataset.key!] = Math.round(value.clientHeight / lineHeight);
      values[el.dataset.key!] = value.textContent ?? '';
    }
    // A row is a cluster of vertically overlapping boxes: the "+N" tail is shorter than a badge and centred on its row.
    const rows: { top: number; bottom: number }[] = [];
    for (const box of [...says.querySelectorAll<HTMLElement>('[data-key="e2e:transit"] .k-say-badges > *')].map((b) => b.getBoundingClientRect())) {
      const row = rows.find((r) => box.top < r.bottom - 1 && box.bottom > r.top + 1);
      if (row) { row.top = Math.min(row.top, box.top); row.bottom = Math.max(row.bottom, box.bottom); } else rows.push({ top: box.top, bottom: box.bottom });
    }
    return { shown: shownItems.map((el) => el.dataset.key!), overflow: says.scrollHeight > says.clientHeight + 1, valueLines, values, labelRows: rows.length };
  }, html);
}

/** Every geometry rule in one page-side pass; an empty list is the proof. */
function geometryIssues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const shown = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => el.offsetParent !== null);
    const tag = (el: HTMLElement): string => `${el.className.split(' ')[0]}${el.dataset.testid ? `[${el.dataset.testid}]` : ''}`;
    // The field, the column, a statement, the card or a paired block clips its children when a row or a value does not fit.
    for (const el of shown('.k-field, .k-column, .k-says, .k-say, .k-invite, .k-lines, .k-block, .k-join, .k-ess-row, .k-block-body, .k-side-blocks, .k-strip-items')) {
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
      // cap (`min(var(--k-display-size), 15cqi)` in kiosk.css, the code markup in
      // invitation.ts) meeting a real random 8-character code whose glyphs run wider
      // than the "ABCD-EFG0" case the cap's own arithmetic was checked against. See
      // task-T2.11-report.md, "Findings outside scope" #3, and its fix-round addendum.
      if (c.right > card.right + 0.5 || code.scrollWidth > code.clientWidth + 1) out.push('code clipped');
    }
    // The header's three groups are boxes too: a session pill that paints over the chip or the date is an overlap like any other.
    // Two boxes may share a patch of screen only when one CONTAINS the other (R-K7), which is how the map container and
    // MapLibre's attribution may sit on the field -- they are its own children -- while any other pair painting over
    // each other is a fault.
    const boxes = shown('.k-stage .k-field, .k-stage .k-say, .k-stage .k-invite, .k-stage .k-map, .k-stage .k-block, .k-stage .k-join, .k-head-brand, .k-head-mid, .k-head-when')
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

/** What the invitation's own composition claims, measured rather than assumed
 *  (plan "Frame", R-KP1, R-KP5): the map is the field and the field is the
 *  stage's subject; nothing paints over the picture but the attribution; the
 *  column stands beside (or, in portrait, under) it; every statement value
 *  fits whole in at most two lines with no ellipsis; the QR is readable. */
function compositionIssues(page: Page, portrait: boolean, maxLines: number, minShare: number, minPortraitField: number): Promise<string[]> {
  return page.evaluate(({ isPortrait, lines, share: minMap, portraitField }) => {
    const out: string[] = [];
    const invitation = document.querySelector<HTMLElement>('.k-invitation');
    const field = document.querySelector<HTMLElement>('.k-invitation [data-testid=kiosk-live]');
    const host = document.querySelector<HTMLElement>('.k-invitation [data-testid=kiosk-map-host]');
    const map = document.querySelector<HTMLElement>('.k-invitation [data-testid=kiosk-map]');
    if (!invitation || !field || !host || !map || map.offsetParent === null) return ['the invitation has no map on its field'];
    const s = invitation.getBoundingClientRect();
    const f = field.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    const overlaps = (a: DOMRect, b: DOMRect): boolean => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    // The map's box is the field: the host fills it.
    if (Math.abs(h.width - f.width) > 1 || Math.abs(h.height - f.height) > 1) out.push(`the map host (${h.width.toFixed(0)}x${h.height.toFixed(0)}) is not the field (${f.width.toFixed(0)}x${f.height.toFixed(0)})`);
    // Landscape: the map is the stage's subject, not one panel of three.
    const mapShare = (h.width * h.height) / (s.width * s.height);
    if (!isPortrait && mapShare < minMap) out.push(`the map is ${mapShare.toFixed(4)} of the invitation`);
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
    const column = document.querySelector<HTMLElement>('.k-invitation .k-column');
    if (!column) out.push('no column');
    else if (overlaps(column.getBoundingClientRect(), h)) out.push('the column crosses the map');
    // The QR is readable from steps away.
    const qr = document.querySelector<HTMLElement>('[data-testid=kiosk-qr]')?.getBoundingClientRect();
    if (!qr || qr.width < 240 - 0.5 || qr.height < 240 - 0.5) out.push(`the QR is ${qr?.width.toFixed(0)}x${qr?.height.toFixed(0)}`);
    // Every statement value shown: whole inside its statement, at most two lines, never ellipsised (R-KP5). Lines are
    // the box's height over its line-height: a tight line box lets the face's ink paint a few pixels past it, which
    // scrollHeight would count and a reader would not.
    for (const value of [...document.querySelectorAll<HTMLElement>('.k-invitation .k-say-value')].filter((el) => el.offsetParent !== null)) {
      const article = value.closest<HTMLElement>('.k-say')!;
      const key = article.dataset.key ?? '?';
      if (value.getBoundingClientRect().bottom > article.getBoundingClientRect().bottom + 0.5) out.push(`${key} value runs past its statement`);
      const style = getComputedStyle(value);
      if (style.textOverflow === 'ellipsis') out.push(`${key} value is ellipsised`);
      const lineHeight = Number.parseFloat(style.lineHeight);
      if (lineHeight > 0 && value.clientHeight / lineHeight > lines + 0.1) out.push(`${key} value runs ${(value.clientHeight / lineHeight).toFixed(1)} lines`);
    }
    if (isPortrait) {
      const stage = document.querySelector<HTMLElement>('[data-testid=kiosk-stage]')!.getBoundingClientRect();
      if (f.height / stage.height < portraitField) out.push(`the field is ${(f.height / stage.height).toFixed(3)} of a portrait stage`);
      const says = document.querySelector<HTMLElement>('[data-testid=kiosk-says]')!.getBoundingClientRect();
      const card = document.querySelector<HTMLElement>('[data-testid=kiosk-invite]')!.getBoundingClientRect();
      if (says.right > card.left + 1) out.push('the statements are not left of the card');
      if (!(says.top < card.bottom && card.top < says.bottom)) out.push('the statements and the card do not share a row');
    }
    return out;
  }, { isPortrait: portrait, lines: maxLines, share: minShare, portraitField: minPortraitField });
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
  // Geometry is measured in the final face: Manrope loaded, not the wider fallback.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
}

/** Contract 3, R-KP19: how many distinct major street names the map placed,
 *  as the controller stamped it on the map host after a paint once the map
 *  was ready. A positive count is waited for: Trg bana Jelačića always has
 *  named roads in view, so zero is "not counted yet", never an answer. */
async function majorLabels(page: Page): Promise<number> {
  await expect(page.getByTestId('kiosk-map')).toHaveAttribute('data-map-status', 'ready', { timeout: 30_000 });
  const host = page.getByTestId('kiosk-map-host');
  await expect(host).toHaveAttribute('data-major-labels', /^[1-9]\d*$/, { timeout: MAJOR_LABELS_WAIT_MS });
  return Number(await host.getAttribute('data-major-labels'));
}

for (const size of SIZES) {
  const portrait = size.height > size.width;
  for (const face of FACES) {
    test(`the invitation at ${size.width} by ${size.height}, ${face}: whole code, QR of ${MIN_QR_PX} px or more, the map is the field, statements whole, nothing overflows or overlaps, basics fit`, async ({ page, request }) => {
      const { kioskUrl } = await provisionKiosk(request, APP_URL);
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

      // The stage has no padding for the invitation: the field meets the header, the strip and the column on hairlines.
      const field = (await page.getByTestId('kiosk-live').boundingBox())!;
      const stage = (await page.getByTestId('kiosk-stage').boundingBox())!;
      expect(Math.abs(field.x - stage.x), 'the field starts at the stage edge').toBeLessThanOrEqual(1);
      expect(Math.abs(field.y - stage.y), 'the field starts under the header').toBeLessThanOrEqual(1);
      if (!portrait) expect(Math.abs(field.height - stage.height), 'the field is the stage’s full height').toBeLessThanOrEqual(1);

      // One h1 on the page: the card's lead (e2e/a11y.spec.ts holds the same for every surface without a session).
      expect(await page.locator('h1').count(), 'exactly one h1: the invitation lead').toBe(1);
      expect(await geometryIssues(page)).toEqual([]);
      expect(await compositionIssues(page, portrait, MAX_VALUE_LINES, MIN_MAP_SHARE, MIN_PORTRAIT_FIELD), 'the map is the field').toEqual([]);
      await page.screenshot({ path: `${SHOTS_DIR}/kiosk-${size.width}-${face}.png`, fullPage: false });

      // Contract 3: the prozor profile places at most eight major street names in the field (R-KP17 measured two to three at Jelačić).
      expect(await majorLabels(page), 'the prozor profile places at most eight major street names in the field').toBeLessThanOrEqual(MAX_MAJOR_LABELS);

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
  const portrait = size.height > size.width;
  const composition: Exclude<Composition, 'handheld'> = portrait ? 'portrait' : size.width >= KIOSK_WIDE_MIN_PX ? 'wide' : 'compact';
  const frame = FRAME[composition];
  test(`the frame at ${size.width} by ${size.height} holds ${frame.shown.length} of the plan's statements whole over the card, the transit label in ${frame.labelRowsAtMost} row(s) at most, every value in two lines, a long title cut at a word`, async ({ page, request }) => {
    const { kioskUrl } = await provisionKiosk(request, APP_URL);
    await openInvitation(page, 'light', size, kioskUrl);
    await expect(page.getByTestId('kiosk')).toHaveAttribute('data-phase', 'invitation');
    const html = sampleStatements(composition);
    // The composition's own fit() runs on the 1 s tick: the statements the room does not hold whole are hidden from the
    // foot up and a value past two lines is cut at a word (R-KP5). Everything fit() decides is polled together, so the
    // reading is of the fitted column: the session's title runs past two lines at every size, so where its statement
    // is shown the cut ("…" on a word) is the proof that fit() has run; where it is hidden, the hiding is.
    await expect.poll(async () => {
      const m = await measureFrame(page, html);
      const assembly = m.values['e2e:assembly'];
      return {
        shown: m.shown,
        overflow: m.overflow,
        valuesInTwoLines: Object.values(m.valueLines).every((lines) => lines <= MAX_VALUE_LINES),
        titleCutAtAWord: assembly === undefined || (/\S…$/.test(assembly) && assembly.length < ASSEMBLY_TITLE.length),
      };
    }, { timeout: FIT_WAIT_MS, message: `the ${composition} frame holds ${frame.shown.join(', ')} whole, fitted` }).toEqual({ shown: [...frame.shown], overflow: false, valuesInTwoLines: true, titleCutAtAWord: true });
    // The label's rows are the sheet's and the cap's, not fit()'s: read once the column is fitted.
    const m = await measureFrame(page, html);
    expect(m.labelRows, 'the transit label stays within the rows its badge cap budgets').toBeLessThanOrEqual(frame.labelRowsAtMost);
    expect(await geometryIssues(page)).toEqual([]);
    expect(await compositionIssues(page, portrait, MAX_VALUE_LINES, MIN_MAP_SHARE, MIN_PORTRAIT_FIELD)).toEqual([]);
    await page.screenshot({ path: `${SHOTS_DIR}/kiosk-${size.width}-frame.png`, fullPage: false });
  });
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
          // zrak-i-nebo pairing). Without them this is deterministically red at
          // 1366x768: grad-sada (k-side-blocks 341>335, k-block-body 90>64), then
          // u-pokretu (a 380 px board floor in a ~335 px column), then zrak-i-nebo
          // (k-block-body 43>22), each masked by the one before because the loop
          // stops at its first failing layer. Provenance: task-T2.11-report.md.
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
  // The transit statement says so too (contract 4: data-state on the article): a stale source keeps its statement with the honest word (R-KP16).
  await expect(page.locator('[data-testid=kiosk-say][data-say=transit]')).toHaveAttribute('data-state', 'stale', { timeout: 15_000 });
  // The basics panel pauses and resumes the map; the hold survives the resume.
  await page.getByTestId('kiosk-essentials-open').click();
  await page.keyboard.press('Escape');
  await expect(map).toHaveAttribute('data-feed', 'stale');
});
