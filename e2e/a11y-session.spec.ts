// axe over a fixture-backed session on /d/: the surfaces a person actually
// unlocks (Sada, Promet, Sigurnost), at the phone and the desk sizes, in both
// colour schemes, against WCAG 2.x A and AA plus 2.2 AA (target size, focus
// not obscured), and on the phone the Kvart tab's panel as well (a shell
// surface of its own, D9; the desk audits the same body in its aside beside
// every layer). e2e/a11y.spec.ts sweeps the public pages without a session;
// this file is the session half the plan adds. Serious and critical violations
// fail the run; moderate and minor ones are printed for the record.
//
// Then a Tab walk: every element a Tab reaches must lie inside the viewport
// minus the sticky header and the fixed tab bar, so the focus is never parked
// under the chrome (WCAG 2.2 focus not obscured). The walk has the same shape
// as a11y.spec.ts's, measuring boxes instead of names.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { LayerId } from '../worker/protocol';
import { experienceSnapshots, FIXTURE_DASHBOARD, installExperienceFixture } from './experience-fixtures';

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1920, height: 1080 };
const SIZES = [PHONE, DESK] as const;
const SCHEMES = ['light', 'dark'] as const;
const LAYERS: readonly LayerId[] = ['grad-sada', 'u-pokretu', 'sigurnost'];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['serious', 'critical']);
const HEADER = '.ki-head';
const TABBAR = '.ki-tabbar';
/** Presses before the walk gives up on a page whose nodes keep being rebuilt under it. */
const TAB_LIMIT = 150;

type Violation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];
const describeViolation = (v: Violation) =>
  `${v.impact} ${v.id}: ${v.help}\n  ${v.helpUrl}\n` +
  v.nodes
    .slice(0, 5)
    .map((n) => `  - ${n.target.join(' ')}: ${(n.failureSummary ?? '').split('\n')[0]}`)
    .join('\n');

/**
 * The phone's tab when the domain has one; otherwise the directory (Još in the
 * desk's status line, the tab bar's Još on the phone, D10), then the domain's
 * row or any other way in. A Sada tile also carries data-action=nav with a
 * selection, so the tab and the directory come first.
 */
async function openLayer(page: Page, layer: LayerId): Promise<void> {
  const tab = page.locator(`.ki-tab[data-layer="${layer}"]:visible`).first();
  if (await tab.count()) {
    await tab.click();
  } else {
    await page.locator('[data-testid="status-more"]:visible, [data-testid="tab-more"]:visible').first().click();
    await page.locator(`[data-testid="dir-${layer}"], [data-action="nav"][data-layer="${layer}"]:visible`).first().click();
  }
  await expect(page.locator(`[data-testid="dash-view"] > [data-layer="${layer}"]`)).toBeVisible();
  if (layer === 'u-pokretu') {
    await expect(page.getByTestId('map-canvas'), 'the Promet map must reach a settled status').toHaveAttribute('data-map-status', /^(ready|tiles-failed|unavailable)$/, { timeout: 30_000 });
  }
  await page.waitForTimeout(400);
}

interface FocusStop {
  where: string;
  /** The id of the workspace section (.layer) the stop lies in; '' outside every workspace. */
  layer: string;
  /** Empty when the focused box lies inside the viewport minus the chrome. */
  problem: string;
}

/**
 * Presses Tab around the document once and reports every stop whose box is
 * not wholly inside the viewport minus the header and the tab bar. Visited
 * elements are marked so the walk ends when it comes round; a Tab that leaves
 * the document is followed, because the next one re-enters at the top.
 */
async function tabWalkClearOfChrome(page: Page, limit = TAB_LIMIT): Promise<FocusStop[]> {
  const stops: FocusStop[] = [];
  let leftDocument = 0;
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(({ header, tabbar }): (FocusStop & { revisit: boolean }) | null => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const revisit = el.hasAttribute('data-e2e-visited');
      el.setAttribute('data-e2e-visited', '1');
      const where = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : ''}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''}`;
      const layer = el.closest('.layer')?.id ?? '';
      const shownBox = (sel: string): DOMRect | null => {
        const node = document.querySelector(sel);
        const r = node?.getBoundingClientRect();
        return r && r.height > 0 && r.width > 0 && getComputedStyle(node!).visibility !== 'hidden' ? r : null;
      };
      const h = shownBox(header);
      const t = shownBox(tabbar);
      const zoneTop = h ? Math.max(0, h.bottom) : 0;
      const zoneBottom = t ? Math.min(innerHeight, t.top) : innerHeight;
      const r = el.getBoundingClientRect();
      const px = (n: number): string => `${Math.round(n)} px`;
      let problem = '';
      // The chrome's own controls sit inside the chrome, and a <dialog> paints in the top layer above it.
      // The skip link paints over the header on focus by design (z-index above --z-sticky), like a dialog in the top layer.
      const inChrome = el.closest(header) !== null || el.closest(tabbar) !== null || el.closest('dialog') !== null || el.classList.contains('skip-link');
      if (!inChrome && r.width > 0 && r.height > 0) {
        if (r.top < zoneTop - 1) problem = `top ${px(r.top)} is above the header's bottom edge ${px(zoneTop)}`;
        else if (r.bottom > zoneBottom + 1) problem = `bottom ${px(r.bottom)} is below the tab bar's top edge ${px(zoneBottom)} (viewport ${innerHeight} px)`;
        else if (r.left < -1 || r.right > innerWidth + 1) problem = `left ${px(r.left)}, right ${px(r.right)} leave the ${innerWidth} px viewport`;
      }
      return { revisit, where, layer, problem };
    }, { header: HEADER, tabbar: TABBAR });
    if (stop === null) {
      if (++leftDocument > 2) break;
      continue;
    }
    if (stop.revisit) break;
    stops.push({ where: stop.where, layer: stop.layer, problem: stop.problem });
  }
  return stops;
}

/**
 * axe over the surface as painted, then the Tab walk; `within` names the
 * workspace section the walk must have entered (its id), so a panel whose
 * controls a Tab never reaches is a finding too.
 */
async function auditSurface(page: Page, surface: string, within: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const advisory = results.violations.filter((v) => !v.impact || !BLOCKING.has(v.impact));
  if (advisory.length > 0) console.log(`[axe advisory] ${surface}\n${advisory.map(describeViolation).join('\n')}`);
  const blocking = results.violations.filter((v) => v.impact && BLOCKING.has(v.impact));
  expect(blocking.map(describeViolation), `${surface}: no serious or critical violations`).toEqual([]);

  const stops = await tabWalkClearOfChrome(page);
  expect(stops.length, `${surface}: the Tab walk must visit something`).toBeGreaterThan(0);
  expect(stops.some((s) => s.layer === within), `${surface}: the Tab walk must enter #${within}; it visited ${stops.map((s) => s.where).join(', ')}`).toBe(true);
  const obscured = stops.filter((s) => s.problem !== '').map((s) => `  ${s.where}: ${s.problem}`);
  expect(obscured, `${surface}: every focused element must lie inside the viewport minus the header and the tab bar; ${obscured.length} of ${stops.length} stops do not:\n${obscured.join('\n')}`).toEqual([]);
}

for (const viewport of SIZES) {
  for (const scheme of SCHEMES) {
    const kvartToo = viewport === PHONE ? ' and the Kvart tab' : '';
    test(`axe /d/ in a session @${viewport.width} (${scheme}): Sada, Promet and Sigurnost${kvartToo} have no serious or critical violations, and every Tab stop lies clear of the header and the tab bar`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });
      await installExperienceFixture(page, await experienceSnapshots());
      await page.goto(FIXTURE_DASHBOARD);
      await expect(page.getByTestId('tb'), 'Sada must paint from the fixture').toBeVisible();
      await expect(page.getByTestId('session-label')).toBeVisible();

      for (const layer of LAYERS) {
        await openLayer(page, layer);
        await auditSurface(page, `/d/ ${layer} @${viewport.width} (${scheme})`, `layer-${layer}`);
      }
      if (viewport === PHONE) {
        await page.getByTestId('tab-more').click();
        await page.getByTestId('tab-kvart').click();
        await expect(page.locator('#layer-kvart'), 'the Kvart tab must open its panel').toBeVisible();
        const map = page.getByTestId('kvart-map-canvas');
        if (await map.count()) await expect(map, 'the kvart map must reach a settled status').toHaveAttribute('data-map-status', /^(ready|tiles-failed|unavailable)$/, { timeout: 30_000 });
        await page.waitForTimeout(400);
        await auditSurface(page, `/d/ kvart @${viewport.width} (${scheme})`, 'layer-kvart');
      }
    });
  }
}
