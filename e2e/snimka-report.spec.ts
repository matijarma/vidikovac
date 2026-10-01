// /snimka/'s report in a browser (lane S3): Zaslon shows the recorded
// reading of the minute with its line badges, the nearest capture and the
// quartet of four mornings; a press or a drag on Tijek seeks the replay, which
// the readout and the address follow; Što se vidjelo carries every card with
// its method line; the page never scrolls sideways and axe finds nothing
// serious in either theme. Everything is answered from the synthetic fixture
// (e2e/snimka-fixtures.ts), widened here to four 07:45 slot runs so the
// quartet is whole. With SNIMKA_SHOTS_DIR set, the last test saves the report
// at 1366 and 390 px in both themes there.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HashedRef, ScreenIndex, ScreenRun } from '../shared/snimka';
import { contentPath } from '../shared/snimka-codec';
import { buildSnimkaFixture, routeSnimka, TINY_WEBP, zg, type SnimkaFixture } from './snimka-fixtures';

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** The fixture with a Tuesday and a Thursday slot run at 07:45 beside its Monday and Wednesday ones, each with a capture. */
function withQuartet(): SnimkaFixture {
  const fixture = buildSnimkaFixture();
  const index = fixture.objects.get(fixture.manifest.files.screenIndex.path) as ScreenIndex;
  const monday = index.runs[0]!;
  const mondayRun = fixture.objects.get(monday.file.path) as ScreenRun;
  const extra = (id: string, fromSec: number, sentence: string): ScreenIndex['runs'][number] => {
    const run: ScreenRun = {
      ...mondayRun, id, fromSec, toSec: fromSec + (mondayRun.toSec - mondayRun.fromSec),
      readings: mondayRun.readings.map((r, i) => ({ ...r, at: fromSec + i * 20, sentence })),
    };
    const text = JSON.stringify(run);
    const runHash = sha(text);
    const file: HashedRef = { path: contentPath(`screen/run-${id}`, runHash, 'json'), bytes: Buffer.byteLength(text), sha256: runHash };
    fixture.objects.set(file.path, run);
    const picHash = sha(TINY_WEBP);
    const kiosk: HashedRef = { path: contentPath(`captures/${id}-kiosk`, picHash, 'webp'), bytes: TINY_WEBP.length, sha256: picHash };
    fixture.objects.set(kiosk.path, TINY_WEBP);
    return { ...monday, id, fromSec, toSec: run.toSec, file, captures: { kiosk, phone: null } };
  };
  const runs = [...index.runs, extra('tue-0745', zg(9, 29, 7, 45), 'Tramvaj 6 prema Črnomercu polazi u 07:52 po voznom redu.'), extra('thu-0745', zg(10, 1, 7, 45), 'Tramvaj 11 prema Dupcu polazi za 3 min.')]
    .sort((a, b) => a.fromSec - b.fromSec);
  const next: ScreenIndex = { v: 1, runs };
  const text = JSON.stringify(next);
  const hash = sha(text);
  const ref: HashedRef = { path: contentPath('screen/index', hash, 'json'), bytes: Buffer.byteLength(text), sha256: hash };
  fixture.objects.set(ref.path, next);
  fixture.manifest.files.screenIndex = ref;
  return fixture;
}

async function open(page: Page, at = '2026-09-28T07:45'): Promise<void> {
  await routeSnimka(page, withQuartet());
  await page.goto(`/snimka/?t=${at}&brzina=600`);
  await expect(page.locator('[data-sn-mount="strip"] .sn-panel')).toHaveCount(6);
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe('/snimka/ report', () => {
  test('Zaslon shows the recorded reading with its line badges, the nearest capture and the four mornings', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await open(page);
    const mini = page.locator('.sn-mini');
    await expect(mini).toHaveAttribute('data-view', 'reading');
    await expect(mini.locator('.sn-mini-text')).toHaveText('Tramvaj 6 prema Črnomercu polazi u 07:52 po voznom redu.');
    await expect(mini.locator('.sn-mini-sentence')).toHaveAttribute('data-kicker', 'promet');
    await expect(mini.locator('.sn-mini-clock')).toHaveText('07:45');
    await expect(mini.locator('.line').first()).toBeVisible();
    await expect(mini.locator('.line').first()).toHaveText('6');
    await expect(mini.locator('.line').first()).toHaveAttribute('data-kind', 'tram');
    await expect(page.locator('.sn-screen-grid .sn-capture img')).toHaveAttribute('alt', 'Snimka zaslona, pon 28. 9. u 07:45');
    const quartet = page.locator('.sn-quartet-item img');
    await expect(quartet).toHaveCount(4);
    for (const alt of await quartet.evaluateAll((imgs) => imgs.map((i) => i.getAttribute('alt') ?? ''))) expect(alt.length).toBeGreaterThan(0);
    await expect(page.locator('.sn-quartet-item[data-day="thu"] figcaption')).toContainText('Uobičajeno jutro.');
  });

  test('between recorded runs the screen gives the timetable board with its note', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await open(page, '2026-09-28T14:00');
    const mini = page.locator('.sn-mini');
    await expect(mini).toHaveAttribute('data-view', 'board');
    await expect(mini).toContainText('Između zapisa zaslona');
    await expect(mini.locator('.line')).toHaveCount(3);
    await expect(page.locator('.sn-screen-grid .sn-capture')).toContainText('Za ovo doba nema snimke zaslona.');
  });

  test('a press and a drag on Tijek seek the replay: the readout and the address follow', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await open(page);
    const readout = page.locator('.sn-strip-readout');
    await expect(readout).toContainText('pon 28. 9. u 07:45: u pokretu');
    const plot = page.locator('[data-plot="fleet"]');
    await plot.scrollIntoViewIfNeeded();
    const box = (await plot.boundingBox())!;
    // Three quarters of 84 hours after Sunday 20:00 is Wednesday 11:00.
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
    await expect(readout).toContainText(/^sri 30\. 9\. u 1[01]:\d\d: /);
    await expect(page).toHaveURL(/[?&]t=2026-09-30T1[01]:\d\d/);
    const cursor = await plot.locator('.sn-cursor').evaluate((el) => (el as HTMLElement).style.transform);
    expect(cursor).toMatch(/^translateX\(7[45](\.\d+)?%\)$/);
    // A drag from a quarter to the middle ends on Tuesday 14:00.
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(readout).toContainText(/^uto 29\. 9\. u 1[34]:\d\d: /);
    await expect(page).toHaveURL(/[?&]t=2026-09-29T1[34]:\d\d/);
    // The keyboard on the strip steps ten minutes.
    const before = new URL(page.url()).searchParams.get('t')!;
    await page.locator('.sn-strip-frame').focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => new URL(page.url()).searchParams.get('t')).not.toBe(before);
  });

  test('the hero numbers and every card of Što se vidjelo, each with its method line', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await open(page);
    await expect(page.locator('[data-sn="kpis"]')).not.toHaveAttribute('aria-busy', /.*/);
    const values = page.locator('[data-sn="kpis"] .st-kpi-value');
    await expect(values).toHaveCount(4);
    await expect(page.locator('[data-sn="kpi-silent"] .st-kpi-value')).toHaveText('65');
    await expect(page.locator('[data-sn="kpi-return"] .st-kpi-sub')).toHaveText('srijeda, od 18:21 do 20:20');
    const cards = page.locator('[data-sn-mount="reckoning"] .st-card');
    await expect(cards).toHaveCount(7);
    await expect(page.locator('[data-card="sentences"]')).not.toHaveAttribute('aria-busy', /.*/);
    for (let i = 0; i < 7; i++) {
      await expect(cards.nth(i).locator('h3')).not.toHaveText('');
      await expect(cards.nth(i).locator('.st-method')).not.toHaveText('');
    }
    await expect(page.locator('#vidjelo-broj .st-card-lede')).toHaveText('U ponedjeljak je zaslon brojio vozila kojih nije bilo: ZET je u ponoć vozilima upisao vrijeme dan unaprijed.');
    // A table twin opens with a row per hour.
    const table = page.locator('[data-panel="fleet"] .st-table');
    await table.locator('summary').click();
    await expect(table.locator('tbody tr')).toHaveCount(84);
  });

  for (const width of [360, 1366]) {
    test(`reflows at ${width} px, and at 200 % text, without a sideways scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      await expect(page.locator('[data-sn-mount="reckoning"] .st-card')).toHaveCount(7);
      expect(await horizontalOverflow(page)).toBe(0);
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await page.setViewportSize({ width: Math.max(width, 640), height: 900 });
      expect(await horizontalOverflow(page)).toBe(0);
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    for (const width of [390, 1366]) {
      test(`axe: no serious or critical violation in the report, ${scheme}, ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme });
        await open(page);
        await expect(page.locator('.sn-quartet-item img')).toHaveCount(4);
        await expect(page.locator('[data-card="sentences"] .st-bars')).toBeVisible();
        // Open one table so its markup is checked too.
        await page.locator('[data-panel="state"] .st-table summary').click();
        const results = await new AxeBuilder({ page })
          .include('#ukratko').include('#zaslon').include('#tijek').include('#vidjelo')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      });
    }
  }

  test('screenshots of the report at 1366 and 390 px in both themes', async ({ page }) => {
    const dir = process.env.SNIMKA_SHOTS_DIR;
    test.skip(!dir, 'SNIMKA_SHOTS_DIR names where the screenshots go');
    mkdirSync(dir!, { recursive: true });
    for (const scheme of ['light', 'dark'] as const) {
      for (const width of [1366, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        // The screen on the first morning (a recorded reading), the rest on Wednesday evening (the return).
        for (const [at, sections] of [['2026-09-28T07:45', ['zaslon']], ['2026-09-30T18:40', ['ukratko', 'tijek', 'vidjelo']]] as const) {
          await open(page, at);
          await expect(page.locator('.sn-mini')).not.toHaveAttribute('data-view', 'loading');
          // The sticky section bar would sit over an element screenshot.
          await page.addStyleTag({ content: '.st-nav { position: static !important; }' });
          for (const name of sections) await page.locator(`#${name}`).screenshot({ path: join(dir!, `${name}-${width}-${scheme}.png`) });
        }
      }
    }
  });
});
