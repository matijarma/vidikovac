// DEV mode end to end (worker/routes/dev.ts describes it; app/src/core/dev-mode.ts keeps the flag):
// the phone in DEV opens Sada without a code and shows the mark, whose × leaves a page that asks
// for a code; the wall in DEV runs on the network's DEV screen, whose QR opens a phone in DEV too;
// the mark's menu lists the five surfaces; the mark joins the wordmark ("Kaj ima?dev") and adds no
// height anywhere: each header and its first content stand exactly where they stand without DEV,
// on the phone, the desk and the wall, in both themes; /dev/ opened bare turns DEV on and frames
// the four surfaces two by two (wide then narrow, narrow then wide) inside the window, each in DEV;
// /hitno?DEV carries the mark without a script; the four framed pages allow their own origin and
// no other page does. Every test is its own network (localContext), so each has a DEV screen of its
// own. Runs in the chromium project, against the local servers only.
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

interface Surface { name: string; head: string; first: string; wordmark: string; still: string }
/** The three headers that carry the wordmark: what is measured, and what must not move at all. */
const PHONE_HEAD: Surface = { name: 'phone', head: '.ki-head', first: '[data-testid=dash-view] > :first-child', wordmark: '.ki-wordmark', still: '.ki-head > [data-key=session], .ki-head > [data-key=safety], .ki-tabbar' };
const DESK_HEAD: Surface = { name: 'desk', head: '.ki-head', first: '[data-testid=dash-view] > :first-child', wordmark: '.ki-wordmark', still: '.ki-head > [data-key]' };
const WALL_HEAD: Surface = { name: 'wall', head: '.k-head', first: '[data-testid=kiosk-stage]', wordmark: '.k-brand', still: '.k-head-when, .k-head-when > *' };

interface Geometry {
  inHeader: boolean;
  on: { head: Box; first: Box; still: Box[] };
  off: { head: Box; first: Box; still: Box[] };
  wordmark: Box; chip: Box; x: Box | null;
  /** The baselines of the wordmark's text and of the suffix, from a zero-size inline-block set on each line. */
  baseline: { wordmark: number; dev: number };
  font: { wordmark: number; dev: number };
  overflow: number;
}

/**
 * The page with DEV and, in the same page a moment later, without it: the mark taken out and
 * <html data-dev*> cleared, which is every hook DEV has on the layout; then all of it put back.
 */
async function devGeometry(page: Page, s: Surface): Promise<Geometry> {
  return page.evaluate(({ head, first, wordmark, still }) => {
    const box = (el: Element | null) => {
      const r = el!.getBoundingClientRect();
      return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
    };
    const shown = (el: Element | null) => el && el.getBoundingClientRect().width > 0 ? box(el) : null;
    const q = (selector: string) => document.querySelector(selector);
    const baseline = (host: Element): number => {
      const probe = document.createElement('i');
      probe.style.cssText = 'display:inline-block;inline-size:0;block-size:0';
      // A flex item's text (the wall's brand, the wordmark's text) is wrapped once so the probe shares its line.
      const line = document.createElement('span');
      line.append(...host.childNodes, probe);
      host.append(line);
      const y = probe.getBoundingClientRect().bottom;
      probe.remove();
      host.append(...line.childNodes);
      line.remove();
      return Math.round(y * 100) / 100;
    };
    const measure = () => ({ head: box(q(head)), first: box(q(first)), still: [...document.querySelectorAll(still)].map(box) });
    const mark = q('#dev-mark')!;
    const word = q(wordmark)!;
    const text = word.querySelector('.ki-wordmark-text') ?? word;
    const result = {
      inHeader: q(head)!.contains(mark),
      on: measure(),
      wordmark: box(word), chip: box(q('[data-testid=dev-chip]')), x: shown(q('[data-testid=dev-off]')),
      baseline: { wordmark: baseline(text), dev: baseline(q('.dev-word')!) },
      font: { wordmark: parseFloat(getComputedStyle(text).fontSize), dev: parseFloat(getComputedStyle(q('.dev-word')!).fontSize) },
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
    const root = document.documentElement;
    const [parent, next, dev, chip] = [mark.parentNode!, mark.nextSibling, root.dataset.dev, root.dataset.devChip];
    mark.remove();
    delete root.dataset.dev;
    delete root.dataset.devChip;
    const off = measure();
    parent.insertBefore(mark, next);
    root.dataset.dev = dev!;
    if (chip) root.dataset.devChip = chip;
    return { ...result, off };
  }, { head: s.head, first: s.first, wordmark: s.wordmark, still: s.still });
}

/** The mark joins the wordmark and costs the page nothing: the whole of the owner's "Kaj ima?dev". */
async function expectJoinedWithoutHeight(page: Page, s: Surface, label: string): Promise<void> {
  const g = await devGeometry(page, s);
  expect(g.inHeader, `${label}: the mark is in the header`).toBe(true);
  expect(g.on.head, `${label}: the header is the same box with DEV on and off`).toEqual(g.off.head);
  expect(g.on.first, `${label}: the first content stands where it stands without DEV`).toEqual(g.off.first);
  expect(g.on.still, `${label}: the header's far end and the tab bar do not move`).toEqual(g.off.still);
  expect(Math.abs(g.chip.x - (g.wordmark.x + g.wordmark.width)), `${label}: "dev" starts where the wordmark ends`).toBeLessThanOrEqual(1);
  expect(Math.abs(g.baseline.dev - g.baseline.wordmark), `${label}: "dev" sits on the wordmark's baseline`).toBeLessThanOrEqual(0.5);
  expect(g.font.dev, `${label}: "dev" is smaller than the wordmark`).toBeLessThan(g.font.wordmark);
  expect(g.font.dev, `${label}: and never under the type floor`).toBeGreaterThanOrEqual(13);
  for (const target of [g.chip, g.x]) {
    expect(target, `${label}: the × stands beside the suffix`).not.toBeNull();
    expect(Math.min(target!.width, target!.height), `${label}: 44 px targets`).toBeGreaterThanOrEqual(43.5);
    expect(target!.y + target!.height, `${label}: the targets stay inside the header`).toBeLessThanOrEqual(g.on.head.y + g.on.head.height + 0.5);
  }
  expect(Math.abs(g.x!.x - (g.chip.x + g.chip.width)), `${label}: the × follows the suffix`).toBeLessThanOrEqual(1);
  expect(g.overflow, `${label}: no sideways scroll`).toBeLessThanOrEqual(0);
  // The menu opens from the suffix, and Escape closes it.
  await page.getByTestId('dev-chip').click();
  const menu = await page.getByTestId('dev-menu').boundingBox();
  expect(Math.abs(menu!.x - g.chip.x), `${label}: the menu opens under the suffix`).toBeLessThanOrEqual(1);
  expect(menu!.y, `${label}: the menu opens under the suffix`).toBeGreaterThanOrEqual(g.chip.y + g.chip.height - 5);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dev-menu')).toBeHidden();
}

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
  test('the phone in DEV opens Sada without a code, the mark after its wordmark; the × leaves a page that asks for a code', async ({ browser }) => {
    const context = await localContext(browser, { ...PIXEL_7 });
    try {
      const page = await context.newPage();
      await page.goto('/d/?DEV');
      await expect(page.locator('html')).toHaveAttribute('data-dev', '1');
      await expect(page.getByTestId('dev-chip')).toBeVisible();
      await expect(page.getByTestId('dev-chip')).toHaveText('dev');
      await expect(page.getByTestId('session-label')).toHaveAttribute('data-state', 'live', { timeout: JOIN_MS });
      // The header reads "Kaj ima?dev": the mark right after the wordmark.
      await expect(page.locator('.ki-head > .ki-wordmark + #dev-mark')).toBeVisible();
      await expect(page.locator('.ki-tab[data-layer="grad-sada"]')).toHaveAttribute('aria-current', 'page');
      expect(new URL(page.url()).hash).toMatch(/room=/);
      expect(new URL(page.url()).search).toBe('?DEV');
      // A DEV session is a day long, as the pill's own expiry says.
      const expiresAt = Number(await page.getByTestId('session-label').getAttribute('data-expires-at'));
      expect(expiresAt - Date.now()).toBeGreaterThan(DAY_MS - 5 * 60_000);
      // Nothing else of the header and nothing of the tab bar lies under the mark.
      expect(await coveredBy(page, '.ki-head > :not(.dev), .ki-tabbar')).toEqual([]);
      // A reload resumes the same room; a page reached with neither the flag nor a room stays in DEV
      // (the tab remembers it) and gets a session of its own again.
      const roomOf = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get('room');
      const room = roomOf(page.url());
      await page.reload();
      await expect(page.getByTestId('session-label')).toHaveAttribute('data-state', 'live', { timeout: JOIN_MS });
      expect(roomOf(page.url())).toBe(room);
      await page.goto('/d/');
      await expect(page.locator('.ki-head #dev-mark')).toBeVisible();
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

  test('the wall in DEV runs on a DEV screen with the mark after its wordmark, its QR opens a phone in DEV, and the menu lists the five surfaces', async ({ browser }) => {
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
      await expect(wall.locator('.k-head-brand > .k-brand + #dev-mark')).toBeVisible();
      await expect(wall.getByTestId('kiosk-code')).toHaveAttribute('data-state', 'live', { timeout: JOIN_MS });
      expect(screens).not.toContain('/api/screens');
      // The wall's own credentials stay apart from its DEV screen.
      expect(await wall.evaluate(() => [localStorage.getItem('vidikovac-beacon'), JSON.parse(localStorage.getItem('kajima:dev-beacon') ?? '{}').beaconId]))
        .toEqual([null, screen.beaconId]);
      expect(await coveredBy(wall, '.k-head-brand > :not(.dev), .k-head-mid > :not([hidden]), .k-head-when')).toEqual([]);

      await wall.getByTestId('dev-chip').click();
      const links = wall.getByTestId('dev-menu').locator('a[data-dev-surface]');
      await expect(links).toHaveText(SURFACES);
      expect(await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual(SURFACE_LINKS);
      await expect(links.first()).toHaveAttribute('aria-current', 'page');
      // The wall's header has room for the ×, so the menu's own way out stays folded away.
      await expect(wall.getByTestId('dev-off-menu')).toBeHidden();
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

  test('the mark joins the wordmark and adds no height: the phone, the desk and the wall, in both themes', async ({ browser }) => {
    test.setTimeout(240_000);
    // Each surface in both themes; the desk and the wall at both desk sizes (a theme changes no box).
    const cases = [
      { surface: PHONE_HEAD, path: '/d/?DEV', options: { ...PIXEL_7, viewport: { width: 390, height: 844 } }, schemes: ['light', 'dark'] },
      { surface: DESK_HEAD, path: '/d/?DEV', options: { viewport: { width: 1440, height: 900 } }, schemes: ['light'] },
      { surface: DESK_HEAD, path: '/d/?DEV', options: { viewport: { width: 1920, height: 1080 } }, schemes: ['dark'] },
      { surface: WALL_HEAD, path: '/kiosk/?DEV', options: { viewport: WALL }, schemes: ['light'] },
      { surface: WALL_HEAD, path: '/kiosk/?DEV', options: { viewport: { width: 1440, height: 900 } }, schemes: ['dark'] },
    ] as const;
    for (const { surface, path, options, schemes } of cases) {
      const context = await localContext(browser, options);
      try {
        const page = await context.newPage();
        for (const colorScheme of schemes) {
          await page.emulateMedia({ colorScheme });
          // The wall follows the Zagreb sun by default; ?tema= sets its theme, as an operator would.
          await page.goto(surface === WALL_HEAD ? `${path}&tema=${colorScheme === 'dark' ? 'tamna' : 'svijetla'}` : path);
          if (surface === WALL_HEAD) await expect(page.getByTestId('kiosk-code')).toHaveAttribute('data-state', 'live', { timeout: JOIN_MS });
          else await expect(page.getByTestId('session-label')).toHaveAttribute('data-state', 'live', { timeout: JOIN_MS });
          if (surface === DESK_HEAD) await expect(page.locator('.ki')).toHaveAttribute('data-surface', 'desktop');
          await expect(page.locator('html')).toHaveAttribute('data-theme-resolved', colorScheme);
          await expect(page.locator(`${surface.head} #dev-mark`)).toBeVisible();
          await expectJoinedWithoutHeight(page, surface, `${surface.name} ${options.viewport.width}×${options.viewport.height} ${colorScheme}`);
        }
      } finally {
        await context.close();
      }
    }
  });

  test('/dev/ opened without any query turns DEV on and shows the four frames two by two inside the window, each document in DEV', async ({ browser }) => {
    const context = await localContext(browser, { viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto('/dev/');
      await expect(page.locator('html')).toHaveAttribute('data-dev', '1');
      expect(await page.evaluate(() => sessionStorage.getItem('kajima:dev'))).toBe('1');
      // The grid's own header carries the wordmark and its mark; the × leaves for the home page.
      await expect(page.locator('[data-testid=dev-head] > .dev-brand + #dev-mark')).toBeVisible();
      await expect(page.getByTestId('dev-off')).toHaveAttribute('href', '/');
      await page.getByTestId('dev-chip').click();
      await expect(page.getByTestId('dev-menu').locator('a[data-dev-surface]')).toHaveText(SURFACES);
      await page.keyboard.press('Escape');
      const frames = page.locator('iframe[data-testid=dev-frame]');
      await expect(frames).toHaveCount(4);
      expect(await frames.evaluateAll((els) => els.map((f) => [f.dataset.surface, f.getAttribute('src'), f.getAttribute('width'), f.getAttribute('height')]))).toEqual([
        ['screen', '/kiosk/?DEV', '1920', '1080'], ['phone', '/d/?DEV', '390', '844'], ['hitno', '/hitno?DEV', '390', '844'], ['desktop', '/d/?DEV', '1280', '800'],
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
      const grid = () => page.evaluate(() => {
        const cells = Object.fromEntries([...document.querySelectorAll<HTMLElement>('[data-testid=dev-cell]')].map((cell) => {
          const r = cell.querySelector('.dev-frame-box')!.getBoundingClientRect();
          const frame = cell.querySelector('iframe')!;
          return [cell.dataset.surface!, { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, scaled: frame.getBoundingClientRect().width / Number(frame.getAttribute('width')) }];
        }));
        const docEl = document.documentElement;
        return { cells, scroll: [docEl.scrollWidth - innerWidth, docEl.scrollHeight - innerHeight], view: [innerWidth, innerHeight] };
      });
      for (const size of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
        await page.setViewportSize(size);
        await expect.poll(async () => (await grid()).view).toEqual([size.width, size.height]);
        await expect.poll(async () => Math.abs((await grid()).cells.desktop!.scaled - (await grid()).cells.desktop!.width / 1280)).toBeLessThan(0.01);
        const { cells: { screen, phone, hitno, desktop }, scroll } = await grid();
        const at = `${size.width}×${size.height}`;
        // Two by two, the wide cells alternating: the wall then the phone, Hitno then the desk.
        expect(Math.abs(screen!.y - phone!.y), `${at}: row 1 shares its top`).toBeLessThanOrEqual(1);
        expect(Math.abs(hitno!.y - desktop!.y), `${at}: row 2 shares its top`).toBeLessThanOrEqual(1);
        expect(hitno!.y, `${at}: row 2 is under row 1`).toBeGreaterThan(Math.max(screen!.bottom, phone!.bottom));
        expect(screen!.right, `${at}: row 1 is wide then narrow`).toBeLessThanOrEqual(phone!.x);
        expect(screen!.width, `${at}: row 1 is wide then narrow`).toBeGreaterThan(phone!.width * 3);
        expect(hitno!.right, `${at}: row 2 is narrow then wide`).toBeLessThanOrEqual(desktop!.x);
        expect(desktop!.width, `${at}: row 2 is narrow then wide`).toBeGreaterThan(hitno!.width * 3);
        // The rows are as wide as each other, and the whole grid fits the window without a scroll.
        expect(Math.abs(screen!.x - hitno!.x), `${at}: the rows start together`).toBeLessThanOrEqual(1);
        expect(Math.abs(phone!.right - desktop!.right), `${at}: and end together`).toBeLessThanOrEqual(1);
        expect(Math.max(...[screen, phone, hitno, desktop].map((c) => c!.bottom)), `${at}: inside the window`).toBeLessThanOrEqual(size.height);
        expect(scroll, `${at}: no page scroll`).toEqual([0, 0]);
        // Each frame keeps its device's proportions, scaled to its cell.
        for (const [cell, w, h] of [[screen, 1920, 1080], [phone, 390, 844], [hitno, 390, 844], [desktop, 1280, 800]] as const) {
          expect(Math.abs(cell!.width / cell!.height - w / h), `${at}: ${w}×${h} keeps its shape`).toBeLessThan(0.02);
        }
      }
      // A narrow window stacks them in the same order.
      await page.setViewportSize({ width: 800, height: 900 });
      await expect.poll(async () => (await grid()).view[0]).toBe(800);
      const { cells } = await grid();
      const order = ['screen', 'phone', 'hitno', 'desktop'].map((id) => cells[id]!);
      for (let i = 1; i < order.length; i += 1) expect(order[i]!.y, 'one column, in order').toBeGreaterThan(order[i - 1]!.bottom);
      expect(Math.max(...order.map((c) => c.right)), 'one column inside the window').toBeLessThanOrEqual(800);
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

  test('/hitno?DEV carries the mark after its wordmark without a script, and its × goes back to /hitno', async ({ browser }) => {
    const context = await localContext(browser, { ...PIXEL_7 });
    try {
      const page = await context.newPage();
      await page.goto('/hitno?DEV');
      await expect(page.locator('html')).toHaveAttribute('data-dev', '1');
      await expect(page.locator('script')).toHaveCount(0);
      // The mark follows the page's wordmark on its own line: "Kaj ima?dev", and the header is no taller for it.
      await expect(page.locator('header > .brand + #dev-mark')).toBeVisible();
      const heights = await page.evaluate(() => {
        const header = document.querySelector('header')!;
        const on = header.getBoundingClientRect().height;
        const mark = document.getElementById('dev-mark')!;
        const next = mark.nextSibling;
        mark.remove();
        const off = header.getBoundingClientRect().height;
        header.insertBefore(mark, next);
        return [on, off];
      });
      expect(heights[0]).toBe(heights[1]);
      await page.getByTestId('dev-chip').click();
      await expect(page.getByTestId('dev-menu').locator('a[data-dev-surface]')).toHaveText(SURFACES);
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
