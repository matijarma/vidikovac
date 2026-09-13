// Read-only production audit of the Kaj ima? prototype on emulated phones, a desktop and a kiosk.
//
// Usage, from the repo root, with the Access service token in the environment (never in a file):
//
//   CF_ACCESS_CLIENT_ID=… CF_ACCESS_CLIENT_SECRET=… node scripts/audit-production.mjs
//
// Optional environment:
//   AUDIT_APP_URL   the deployment to audit; default https://zagreb.aningfilm.hr
//   AUDIT_OUT       where screenshots, text dumps, audit.log and result.json land;
//                   default review.local/audit-<timestamp>/ (gitignored through *.local)
//
// What it does. It creates ONE temporary self-service screen through the kiosk wizard, the evaluator's own
// path (the Worker allows SCREEN_QUOTA_PER_HOUR self-service screens per hour per network, so run this at most
// a few times an hour), then walks the journey a person walks: landing, /s/, /hitno, scan, confirm, unlock,
// all seven domains, the Promet interactions, Još, the session sheet and share, dark, English, landscape,
// 200% text, a Pixel 7 in dark, a throttled Pixel 7, a 1440 desktop, the 60 s expiry warning and the frozen
// state, and the kiosk invitation (1366 and 1920) and paired compositions. WebKit (an emulated iPhone 13) is
// used when the repo's Playwright has it installed; otherwise the iPhone descriptor runs in Chromium and
// result.json says so (`engine`).
//
// Every capture records metrics (result.json, `metrics`) and evaluates four rules with the thresholds below:
// geometry (a sticky header above the content, banners in flow, the tab bar flush with the bottom), type floor
// (TYPE_FLOOR_PX on phone-class widths, attribution lines excepted), targets (TARGET_MIN_PX) and overflow (no
// wider than the viewport). Exit code 0 when every rule holds on every capture, 1 when any rule fails
// (`violations` lists each), 2 when the journey itself could not run (no credentials, screen creation refused,
// no browser). Nothing in the repo or the deployment changes; the temporary screen expires on its own.
import { chromium, devices, webkit } from '@playwright/test';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// --- thresholds -------------------------------------------------------------------------
/** No visible text below this on a phone, except attribution lines (WCAG 2.2 AA as the constraints state it). */
const TYPE_FLOOR_PX = 13;
/** Every interactive element is at least this in both dimensions. */
const TARGET_MIN_PX = 44;
/** The sticky header: 48 px plus a safe-area inset at most. */
const HEADER_MAX_PX = 56;
/** Sub-pixel rounding allowance for edges and widths. */
const EDGE_TOLERANCE_PX = 1;
/** Phone-class captures are narrower than the shell's desktop breakpoint (app/src/core/breakpoints.ts, DESKTOP_MIN_PX). */
const DESKTOP_MIN_PX = 960;
/** The one exception to the type floor. */
const TYPE_FLOOR_EXEMPT = '.provenance, .panel-attr, .source-line, .maplibregl-ctrl-attrib';
/** The Worker's self-service quota; this script spends one of them. */
const SCREEN_QUOTA_PER_HOUR = 5;
const DEFAULT_APP_URL = 'https://zagreb.aningfilm.hr';
/** How long before the session's expiry the warning capture is taken (the 60 s mark, with slack). */
const EXPIRY_WARNING_LEAD_MS = 50_000;
/** No single action or wait may hang the run: a control that never appears is an error, not a stall. */
const ACTION_TIMEOUT_MS = 20_000;
/** The shell's selectors the geometry rules read. */
const SHELL = { root: '.ki', header: '.ki-head', tabbar: '.ki-tabbar', main: '[data-testid=dash-view]', banners: '[data-testid=banners]' };
const THRESHOLDS = { typeFloor: TYPE_FLOOR_PX, target: TARGET_MIN_PX, headerMax: HEADER_MAX_PX, edge: EDGE_TOLERANCE_PX, desktopMin: DESKTOP_MIN_PX, exempt: TYPE_FLOOR_EXEMPT, shell: SHELL };

// --- environment -------------------------------------------------------------------------
const clientId = process.env.CF_ACCESS_CLIENT_ID;
const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('audit-production: CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be set in the environment (see the header comment).');
  process.exit(2);
}
const HEADERS = { 'CF-Access-Client-Id': clientId, 'CF-Access-Client-Secret': clientSecret };
const ORIGIN = new URL(process.env.AUDIT_APP_URL ?? DEFAULT_APP_URL).origin;
const root = resolve(import.meta.dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = resolve(root, process.env.AUDIT_OUT ?? `review.local/audit-${stamp}`);
mkdirSync(resolve(OUT, 'text'), { recursive: true });

const result = { startedAt: new Date().toISOString(), origin: ORIGIN, thresholds: { TYPE_FLOOR_PX, TARGET_MIN_PX, HEADER_MAX_PX, EDGE_TOLERANCE_PX, DESKTOP_MIN_PX }, engine: null, health: null, steps: [], errors: [], metrics: {}, timings: {}, violations: [] };
const t0 = Date.now();
let fatal = false;
function log(msg) {
  const line = `[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`;
  console.log(line);
  appendFileSync(resolve(OUT, 'audit.log'), line + '\n');
}
function fail(where, e) {
  const m = `${where}: ${(e && e.message ? e.message : String(e)).slice(0, 500)}`;
  result.errors.push(m);
  log('ERR ' + m);
}

// --- browser contexts ----------------------------------------------------------------------
const contexts = [];
async function newCtx(browser, name, opts) {
  const context = await browser.newContext({ locale: 'hr-HR', timezoneId: 'Europe/Zagreb', extraHTTPHeaders: HEADERS, ...opts });
  context.setDefaultTimeout(ACTION_TIMEOUT_MS);
  contexts.push(context);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) {
      // The app promises no foreign requests; one is recorded and refused.
      if (['http:', 'https:'].includes(url.protocol)) { result.errors.push(`${name} foreign-origin:${url.origin}`); await route.abort(); return; }
      await route.continue();
      return;
    }
    await route.continue({ headers: { ...route.request().headers(), ...HEADERS } });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => result.errors.push(`${name} pageerror: ${e.message.slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') result.errors.push(`${name} console.${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('requestfailed', (r) => result.errors.push(`${name} requestfailed: ${r.url().slice(0, 200)} ${r.failure() && r.failure().errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) result.errors.push(`${name} http${r.status()}: ${r.url().slice(0, 200)}`); });
  return page;
}

async function shot(page, name, full = false) {
  try {
    await page.screenshot({ path: resolve(OUT, `${name}.png`) });
    if (full) await page.screenshot({ path: resolve(OUT, `${name}-full.png`), fullPage: true }).catch(() => {});
    log(`shot ${name}`);
  } catch (e) { fail(`shot ${name}`, e); }
}

// --- metrics and rules, evaluated inside the page ---------------------------------------------
const METRICS_FN = (th) => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const name = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const testid = el.dataset && el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : '';
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls}${testid}`;
  };
  const px = (n) => `${Math.round(n * 10) / 10} px`;
  const violations = [];
  const phoneClass = innerWidth < th.desktopMin;

  // Targets: every interactive element at least th.target in both dimensions.
  const targets = [...document.querySelectorAll('a[href],button,input,select,textarea,summary,[role=button],[role=tab],[tabindex]:not([tabindex="-1"])')].filter(vis);
  const small = targets.map((el) => { const r = el.getBoundingClientRect(); return { where: name(el), text: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((t) => t.w < th.target - th.edge || t.h < th.target - th.edge);
  for (const t of small) violations.push({ rule: 'target', detail: `${t.where} "${t.text}" is ${t.w}×${t.h} px, under ${th.target} px` });

  // Type floor: visible text nodes on phone-class widths, attribution lines excepted.
  const textEls = [...document.querySelectorAll('body *')].filter((el) => vis(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  const sizes = textEls.map((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40), where: name(el), exempt: Boolean(el.closest(th.exempt)) }));
  const underFloor = sizes.filter((s) => !s.exempt && s.size < th.typeFloor);
  if (phoneClass) for (const s of underFloor) violations.push({ rule: 'type-floor', detail: `${s.where} "${s.text}" at ${Math.round(s.size * 100) / 100} px, under ${th.typeFloor} px` });

  // Overflow: the document no wider than the viewport.
  const scrollWidth = document.documentElement.scrollWidth;
  if (scrollWidth > innerWidth + th.edge) violations.push({ rule: 'overflow', detail: `document ${scrollWidth} px wide in a ${innerWidth} px viewport` });

  // Geometry of the /d/ shell: sticky header above content, banners in flow, tab bar flush with the bottom.
  const shell = document.querySelector(th.shell.root);
  if (shell) {
    const header = document.querySelector(th.shell.header);
    const main = document.querySelector(th.shell.main);
    const banners = document.querySelector(th.shell.banners);
    const tabbar = document.querySelector(th.shell.tabbar);
    const mainChildren = main ? [...main.children].filter(vis) : [];
    const bannerNodes = [...(banners ? [...banners.children] : []), ...document.querySelectorAll('[data-testid=notice]')].filter((el, i, all) => all.indexOf(el) === i && vis(el));
    if (phoneClass) {
      if (!header || !vis(header)) violations.push({ rule: 'geometry', detail: `the sticky header ${th.shell.header} is missing or hidden` });
      else {
        const h = header.getBoundingClientRect();
        const reference = bannerNodes[0] || mainChildren[0];
        if (reference && h.bottom > reference.getBoundingClientRect().top + 0.5) violations.push({ rule: 'geometry', detail: `the header ends at ${px(h.bottom)} but ${name(reference)} starts at ${px(reference.getBoundingClientRect().top)}: it overlays content` });
        if (h.height > th.headerMax + 0.5) violations.push({ rule: 'geometry', detail: `the header is ${px(h.height)} tall, above ${th.headerMax} px` });
      }
      if (!tabbar || !vis(tabbar)) violations.push({ rule: 'geometry', detail: `the tab bar ${th.shell.tabbar} is missing or hidden` });
      else {
        const t = tabbar.getBoundingClientRect();
        if (Math.abs(t.bottom - innerHeight) > th.edge) violations.push({ rule: 'geometry', detail: `the tab bar ends at ${px(t.bottom)} while the viewport ends at ${innerHeight} px` });
      }
    }
    for (const banner of bannerNodes) {
      const b = banner.getBoundingClientRect();
      for (const child of mainChildren) {
        const c = child.getBoundingClientRect();
        if (b.left < c.right - 1 && c.left < b.right - 1 && b.top < c.bottom - 1 && c.top < b.bottom - 1) violations.push({ rule: 'geometry', detail: `the banner ${name(banner)} overlaps ${name(child)}: banners must sit in flow` });
      }
    }
  }

  const fixed = [...document.querySelectorAll('body *')].filter((el) => { const p = getComputedStyle(el).position; return p === 'fixed' || p === 'sticky'; }).map((el) => { const r = el.getBoundingClientRect(); return { sel: name(el), pos: getComputedStyle(el).position, top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) }; });
  const firstViewport = textEls.filter((el) => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }).map((el) => el.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean).join(' | ').slice(0, 2500);
  const fam = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).fontFamily.slice(0, 60) : null; };
  const canvas = document.querySelector('[data-testid=map-canvas]');
  const cr = canvas ? canvas.getBoundingClientRect() : null;
  const sess = document.querySelector('[data-testid=session-label]');
  const workspace = document.querySelector('[data-testid=transport-workspace]');
  return {
    innerWidth, innerHeight, scrollWidth, scrollHeight: document.documentElement.scrollHeight, phoneClass,
    targets: targets.length, smallTargets: small.length, smallTargetSamples: small.slice(0, 15),
    textEls: sizes.length, underFloor: underFloor.length, underFloorSamples: underFloor.slice(0, 12), minFont: sizes.length ? Math.min(...sizes.map((s) => s.size)) : null,
    fixed, firstViewport,
    loading: (document.body.innerText.match(/učitavanje|loading/gi) || []).length,
    actions: [...new Set([...document.querySelectorAll('[data-action]')].map((el) => el.getAttribute('data-action')))],
    testids: [...new Set([...document.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid')))],
    fonts: { body: fam('body'), h1: fam('h1'), session: fam('[data-testid=session-label]') },
    colors: { bg: getComputedStyle(document.body).backgroundColor, fg: getComputedStyle(document.body).color },
    session: sess ? { text: sess.textContent.trim().replace(/\s+/g, ' ').slice(0, 80), state: sess.getAttribute('data-state'), urgency: sess.getAttribute('data-urgency'), rect: (() => { const r = sess.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) }; })() } : null,
    stage: shell ? shell.getAttribute('data-stage') : null,
    sheet: workspace ? workspace.getAttribute('data-sheet') : null,
    map: canvas ? { status: canvas.getAttribute('data-map-status'), top: Math.round(cr.top), height: Math.round(cr.height), width: Math.round(cr.width), viewportShare: +(cr.height / innerHeight).toFixed(2), touchAction: getComputedStyle(canvas).touchAction, cooperative: Boolean(document.querySelector('.maplibregl-cooperative-gesture-screen')), markers: document.querySelectorAll('.maplibregl-marker').length } : null,
    title: document.title, lang: document.documentElement.lang, theme: document.documentElement.getAttribute('data-theme-resolved'), url: location.href.replace(/#.*/, '#…'),
    violations,
  };
};

async function metrics(page, name) {
  try {
    const m = await page.evaluate(METRICS_FN, THRESHOLDS);
    const { violations, ...rest } = m;
    result.metrics[name] = rest;
    for (const v of violations) result.violations.push({ capture: name, ...v });
    writeFileSync(resolve(OUT, 'text', `${name}.txt`), await page.evaluate(() => document.body.innerText));
    log(`metrics ${name}: overflow=${m.scrollWidth - m.innerWidth} small=${m.smallTargets}/${m.targets} <${TYPE_FLOOR_PX}px=${m.underFloor}/${m.textEls} loading=${m.loading} map=${m.map ? m.map.viewportShare : '-'} violations=${violations.length}`);
  } catch (e) { fail(`metrics ${name}`, e); }
}

async function fontsCheck(page, name) {
  try {
    const f = await page.evaluate(async () => {
      await document.fonts.ready;
      const el = document.querySelector('.ki-wordmark-text, h1') || document.body;
      const cs = getComputedStyle(el);
      return { faces: [...document.fonts].map((x) => ({ family: x.family, weight: x.weight, style: x.style, status: x.status })), check400: document.fonts.check('400 16px Manrope'), check700: document.fonts.check('700 16px Manrope'), sample: { text: el.textContent.trim().slice(0, 20), family: cs.fontFamily.slice(0, 50), weight: cs.fontWeight, size: cs.fontSize } };
    });
    result.metrics[`fonts-${name}`] = f;
    log(`fonts ${name}: check700=${f.check700} faces=${f.faces.map((x) => `${x.family}/${x.weight}:${x.status}`).join(' ')} sample=${JSON.stringify(f.sample)}`);
  } catch (e) { fail(`fonts ${name}`, e); }
}

// --- the journey's steps -------------------------------------------------------------------------
async function openDomain(page, layer) {
  let nav = page.locator(`[data-action=nav][data-layer="${layer}"]:visible`).first();
  if (!(await nav.count())) { await page.getByTestId('tab-more').click(); await page.waitForTimeout(400); nav = page.locator(`[data-action=nav][data-layer="${layer}"]:visible`).first(); }
  await nav.click();
  await page.locator(`[data-testid=dash-view] > [data-layer="${layer}"]`).waitFor({ timeout: 15_000 });
  if (layer === 'u-pokretu') await page.waitForFunction(() => ['ready', 'tiles-failed', 'unavailable'].includes(document.querySelector('[data-testid=map-canvas]') && document.querySelector('[data-testid=map-canvas]').getAttribute('data-map-status')), null, { timeout: 30_000 }).catch(() => log('map status not settled in 30 s'));
  await page.waitForTimeout(1500);
}

async function waitData(page, ms = 25_000) {
  const start = Date.now();
  await page.waitForFunction(() => !/učitavanje/i.test(document.body.innerText), null, { timeout: ms }).catch(() => {});
  return Date.now() - start;
}

const usedCodes = new Set();
/** The screen's current code, never one this run has spent. */
async function freshCode(kiosk) {
  const norm = (s) => (s || '').replace(/\s+/g, '');
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline) {
    for (const tid of ['pair-code', 'join-code']) {
      const el = kiosk.getByTestId(tid);
      if ((await el.count()) && (await el.first().isVisible())) {
        const c = norm(await el.first().textContent());
        if (c && /^[0-9A-Z]{4}-?[0-9A-Z]{4}$/.test(c) && !usedCodes.has(c)) { usedCodes.add(c); log(`fresh code from ${tid}`); return c; }
      }
    }
    await kiosk.waitForTimeout(1000);
  }
  throw new Error('no fresh code within 75 s');
}

/** Landing, the empty /s/ and /hitno on a phone, before any code is scanned. */
async function publicPages(page, name) {
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => !/učitavanje/.test((document.querySelector('[data-testid=live-weather]') || {}).textContent || ''), null, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, `${name}-landing`, true);
  await metrics(page, `${name}-landing`);
  await page.goto(`${ORIGIN}/s/`);
  await page.waitForTimeout(3500);
  await shot(page, `${name}-scan-empty`, true);
  await metrics(page, `${name}-scan-empty`);
  await page.goto(`${ORIGIN}/hitno`);
  await page.waitForTimeout(1500);
  await shot(page, `${name}-hitno`, true);
  await metrics(page, `${name}-hitno`);
}

/** Scan URL, confirm card, Otključaj, the live session label; returns the session's expiry. */
async function unlock(page, code, name) {
  const start = Date.now();
  await page.goto(`${ORIGIN}/s/#${code}`);
  await page.getByTestId('confirm-card').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  await shot(page, `${name}-confirm`, true);
  await metrics(page, `${name}-confirm`);
  await page.getByRole('button', { name: 'Otključaj', exact: true }).click();
  await page.getByTestId('session-label').waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid=session-label]') && document.querySelector('[data-testid=session-label]').getAttribute('data-state') === 'live', null, { timeout: 30_000 });
  result.timings[`${name}-unlock-ms`] = Date.now() - start;
  await shot(page, `${name}-overview-0s`);
  result.timings[`${name}-data-after-unlock-ms`] = await waitData(page);
  await page.waitForTimeout(1200);
  await shot(page, `${name}-overview`, true);
  await metrics(page, `${name}-overview`);
  return Number(await page.getByTestId('session-label').getAttribute('data-expires-at'));
}

async function clickFirstItem(page, layer, name) {
  const scope = page.locator(`[data-testid=dash-view] > [data-layer="${layer}"]`);
  const candidates = ['[data-action=select]', '[data-action=open]', '[data-action=item]', '[data-action=detail]', 'li button', 'li a', 'article a', 'article button'];
  for (const sel of candidates) {
    const loc = scope.locator(sel).filter({ visible: true });
    if (await loc.count()) {
      const el = loc.first();
      const txt = ((await el.textContent()) || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      await el.click();
      await page.waitForTimeout(1500);
      log(`${name}: clicked ${sel} "${txt}"`);
      await shot(page, name, true);
      await metrics(page, name);
      return true;
    }
  }
  log(`${name}: no clickable item found`);
  return false;
}

async function clickText(page, re, name) {
  const loc = page.locator('[data-testid=dash-view] button, [data-testid=dash-view] a').filter({ hasText: re }).filter({ visible: true }).first();
  if (!(await loc.count())) { log(`${name}: no control matching ${re}`); return false; }
  await loc.click();
  await page.waitForTimeout(1500);
  return true;
}

const mapBox = (page) => page.locator('[data-testid=map-canvas]').boundingBox();

/** The Promet interactions on a phone: expand, details, search a stop and a route, a vehicle, the whole city. */
async function transportJourney(phone, name) {
  const cr = await mapBox(phone);
  result.metrics[`${name}-map-dom`] = await phone.evaluate(() => ({ markers: document.querySelectorAll('.maplibregl-marker').length, canvases: document.querySelectorAll('[data-testid=map-canvas] canvas').length, cooperative: Boolean(document.querySelector('.maplibregl-cooperative-gesture-screen')), touchAction: document.querySelector('[data-testid=map-canvas]') ? getComputedStyle(document.querySelector('[data-testid=map-canvas]')).touchAction : null, sheet: document.querySelector('[data-testid=transport-workspace]') && document.querySelector('[data-testid=transport-workspace]').getAttribute('data-sheet') }));
  if (cr) {
    const before = await phone.evaluate(() => scrollY);
    await phone.mouse.move(cr.x + cr.width / 2, cr.y + cr.height / 2);
    await phone.mouse.wheel(0, 300);
    await phone.waitForTimeout(700);
    const after = await phone.evaluate(() => scrollY);
    result.metrics[`${name}-map-wheel`] = { before, after, mapTop: cr.y, mapH: cr.height };
    log(`wheel over map: scrollY ${before} -> ${after}`);
    await phone.evaluate(() => scrollTo(0, 0));
  }
  if (await clickText(phone, /Proširi kartu/i, 'expand')) {
    await shot(phone, `${name}-promet-expanded`, true);
    await metrics(phone, `${name}-promet-expanded`);
    const expanded = await mapBox(phone);
    await phone.keyboard.press('Escape');
    await phone.waitForTimeout(800);
    const restored = await mapBox(phone);
    log(`expanded map ${JSON.stringify(expanded)} -> after Escape ${JSON.stringify(restored)}`);
    if (restored && expanded && Math.abs(restored.height - expanded.height) < 5 && (await clickText(phone, /Skupi kartu|Smanji|Zatvori/i, 'unexpand'))) log('collapsed via control');
  }
  if (await clickText(phone, /^Detalji$/i, 'detalji')) {
    await shot(phone, `${name}-promet-detalji`, true);
    await metrics(phone, `${name}-promet-detalji`);
    await phone.keyboard.press('Escape');
    await phone.waitForTimeout(600);
  }
  const workspace = phone.getByTestId('transport-workspace');
  if ((await workspace.count()) && (await workspace.getAttribute('data-sheet')) === 'peek') {
    const chevron = phone.locator('[data-action=toggle-sheet]').filter({ visible: true }).first();
    if (await chevron.count()) { await chevron.click(); await phone.waitForTimeout(600); }
  }
  const search = phone.getByTestId('transport-search').filter({ visible: true });
  if (await search.count()) {
    const results = '[data-testid=dash-view] [data-layer="u-pokretu"] [role=option], [data-testid=dash-view] [data-layer="u-pokretu"] li button, [data-testid=dash-view] [data-layer="u-pokretu"] li a';
    await search.fill('Kvatern');
    await phone.waitForTimeout(1200);
    await shot(phone, `${name}-promet-search`, true);
    await metrics(phone, `${name}-promet-search`);
    const stop = phone.locator(results).filter({ visible: true }).first();
    if (await stop.count()) { log(`stop result "${((await stop.textContent()) || '').trim().slice(0, 60)}"`); await stop.click(); await phone.waitForTimeout(2500); await shot(phone, `${name}-promet-stop`, true); await metrics(phone, `${name}-promet-stop`); }
    else log('no search result element matched');
    await search.fill('6');
    await phone.waitForTimeout(1200);
    const route = phone.locator(results).filter({ visible: true }).first();
    if (await route.count()) { log(`route result "${((await route.textContent()) || '').trim().slice(0, 60)}"`); await route.click(); await phone.waitForTimeout(3000); await shot(phone, `${name}-promet-route`, true); await metrics(phone, `${name}-promet-route`); }
    await search.fill('');
  } else log('no transport-search on the phone');
  const vehicle = phone.locator('.maplibregl-marker').first();
  if (await vehicle.count()) { await vehicle.click({ force: true }); await phone.waitForTimeout(1500); await shot(phone, `${name}-promet-vehicle`, true); }
  if (await clickText(phone, /Cijeli grad/i, 'city')) { await phone.waitForTimeout(2500); await shot(phone, `${name}-promet-city`); await metrics(phone, `${name}-promet-city`); }
}

/** A one-finger swipe through the real touch pipeline (Chromium only). */
async function touchSwipe(cdp, page, x, y0, y1) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / steps }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(700);
}

// --- the run --------------------------------------------------------------------------------------
log(`audit of ${ORIGIN} -> ${OUT}`);
const chrome = await chromium.launch({ headless: true });
let wk = null;
try { wk = await webkit.launch({ headless: true }); log('webkit launched'); }
catch (e) { fail('webkit-launch', e); log('no WebKit in this Playwright installation; the iPhone descriptor runs in Chromium'); }

let kiosk = null;
let phone = null;
let expiresAt = 0;
try {
  const healthResponse = await fetch(`${ORIGIN}/api/health`, { headers: HEADERS });
  if (!healthResponse.ok) throw new Error(`/api/health answered ${healthResponse.status}`);
  result.health = await healthResponse.json();
  log(`health ${JSON.stringify(result.health)}`);

  // Fonts per engine on the landing page (no session needed).
  for (const [label, browser, dev] of [['webkit-iphone', wk, devices['iPhone 13']], ['chromium-pixel', chrome, devices['Pixel 7']], ['chromium-desktop', chrome, { viewport: { width: 1440, height: 900 } }]]) {
    if (!browser) continue;
    try {
      const p = await newCtx(browser, label, { ...dev });
      await p.goto(`${ORIGIN}/`);
      await p.waitForTimeout(1500);
      await fontsCheck(p, label);
      await p.context().close();
    } catch (e) { fail(`fonts ${label}`, e); }
  }

  // KIOSK: one temporary self-service screen (one of SCREEN_QUOTA_PER_HOUR).
  kiosk = await newCtx(chrome, 'kiosk', { viewport: { width: 1366, height: 768 }, colorScheme: 'light' });
  await kiosk.goto(`${ORIGIN}/kiosk/`);
  await kiosk.getByTestId('kiosk-setup').waitFor({ timeout: 30_000 });
  await kiosk.waitForTimeout(800);
  await shot(kiosk, 'kiosk-setup-1');
  await metrics(kiosk, 'kiosk-setup-1');
  await kiosk.getByTestId('setup-next').click();
  await kiosk.getByTestId('setup-stops').waitFor();
  await kiosk.getByTestId('setup-search').fill('Jela');
  await kiosk.waitForTimeout(700);
  await shot(kiosk, 'kiosk-setup-2');
  await metrics(kiosk, 'kiosk-setup-2');
  await kiosk.locator('input[name=stop][value="106_1"]').check();
  const created = kiosk.waitForResponse((r) => new URL(r.url()).pathname === '/api/screens' && r.request().method() === 'POST', { timeout: 30_000 });
  await kiosk.getByTestId('setup-create').click();
  const creation = await created;
  log(`screen creation ${creation.status()} (quota ${SCREEN_QUOTA_PER_HOUR} per hour)`);
  result.steps.push({ screen: creation.status() });
  if (creation.status() !== 201) throw new Error(`screen creation ${creation.status()} ${(await creation.text()).slice(0, 300)}`);
  await kiosk.getByTestId('pair-code').waitFor({ timeout: 30_000 });
  await kiosk.waitForFunction(() => document.querySelector('[data-testid=kiosk-map]') && document.querySelector('[data-testid=kiosk-map]').getAttribute('data-map-status') === 'ready', null, { timeout: 30_000 }).catch(() => log('kiosk map not ready in 30 s'));
  await kiosk.waitForTimeout(3000);
  await shot(kiosk, 'kiosk-invitation-1366');
  await metrics(kiosk, 'kiosk-invitation-1366');
  try {
    const kcdp = await kiosk.context().newCDPSession(kiosk);
    await kcdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await kiosk.waitForTimeout(3000);
    await kiosk.screenshot({ path: resolve(OUT, 'kiosk-invitation-1920.png'), clip: { x: 0, y: 0, width: 1920, height: 1080 } });
    log('shot kiosk-invitation-1920');
    await metrics(kiosk, 'kiosk-invitation-1920');
    await kcdp.send('Emulation.clearDeviceMetricsOverride');
    await kiosk.waitForTimeout(2000);
  } catch (e) { fail('kiosk-1920', e); }

  // PHONE 1: iPhone 13 (WebKit when available, else the same descriptor in Chromium).
  const iphone = devices['iPhone 13'];
  try {
    if (!wk) throw new Error('no WebKit available');
    phone = await newCtx(wk, 'iphone', { ...iphone, colorScheme: 'light' });
    await publicPages(phone, 'iphone');
    expiresAt = await unlock(phone, await freshCode(kiosk), 'iphone');
    result.engine = 'webkit';
  } catch (e) {
    fail('iphone-webkit', e);
    try { if (phone) await phone.context().close(); } catch {}
    log('falling back to Chromium with the iPhone 13 descriptor');
    phone = await newCtx(chrome, 'iphone', { ...iphone, colorScheme: 'light' });
    await publicPages(phone, 'iphone');
    expiresAt = await unlock(phone, await freshCode(kiosk), 'iphone');
    result.engine = 'chromium-fallback';
  }
  log(`iphone session expires at ${new Date(expiresAt).toISOString()}`);
  await fontsCheck(phone, 'iphone-dashboard');
  await kiosk.waitForFunction(() => document.querySelector('.kiosk') && document.querySelector('.kiosk').getAttribute('data-phase') === 'paired', null, { timeout: 30_000 }).catch(() => log('kiosk not paired in 30 s'));
  await kiosk.waitForTimeout(2000);
  await shot(kiosk, 'kiosk-paired-sada');
  await metrics(kiosk, 'kiosk-paired-sada');

  for (const layer of ['u-pokretu', 'zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'kultura', 'vijesti']) {
    try {
      await openDomain(phone, layer);
      await shot(phone, `iphone-${layer}`, true);
      await metrics(phone, `iphone-${layer}`);
      if (['u-pokretu', 'kultura', 'sigurnost'].includes(layer)) { await kiosk.waitForTimeout(2000); await shot(kiosk, `kiosk-paired-${layer}`); await metrics(kiosk, `kiosk-paired-${layer}`); }
      if (layer === 'u-pokretu') await transportJourney(phone, 'iphone');
      if (layer === 'kultura') await clickFirstItem(phone, layer, 'iphone-kultura-detail');
      if (layer === 'uprava-i-pravo') await clickFirstItem(phone, layer, 'iphone-grad-detail');
      if (layer === 'vijesti') await clickFirstItem(phone, layer, 'iphone-vijesti-detail');
    } catch (e) { fail(`iphone ${layer}`, e); }
  }
  try { await phone.getByTestId('tab-more').click(); await phone.waitForTimeout(900); await shot(phone, 'iphone-more', true); await metrics(phone, 'iphone-more'); } catch (e) { fail('iphone more', e); }
  try {
    await openDomain(phone, 'grad-sada');
    await phone.getByTestId('session-label').click();
    await phone.getByTestId('session-sheet').waitFor({ timeout: 5000 });
    await phone.waitForTimeout(600);
    await shot(phone, 'iphone-session-sheet', true);
    await metrics(phone, 'iphone-session-sheet');
    const share = phone.getByTestId('share-city');
    if (await share.count()) { await share.click(); await phone.getByTestId('share-code').waitFor({ timeout: 10_000 }); await phone.waitForTimeout(600); await shot(phone, 'iphone-share', true); await metrics(phone, 'iphone-share'); }
    await phone.keyboard.press('Escape');
    await phone.waitForTimeout(600);
  } catch (e) { fail('iphone session sheet', e); }
  try {
    await phone.emulateMedia({ colorScheme: 'dark' });
    await phone.waitForTimeout(900);
    await shot(phone, 'iphone-dark-overview', true);
    await metrics(phone, 'iphone-dark-overview');
    await openDomain(phone, 'u-pokretu');
    await shot(phone, 'iphone-dark-promet');
    await openDomain(phone, 'zrak-i-nebo');
    await shot(phone, 'iphone-dark-vrijeme');
    await phone.emulateMedia({ colorScheme: 'light' });
    await openDomain(phone, 'grad-sada');
  } catch (e) { fail('iphone dark', e); }
  try {
    const toggle = phone.locator('[data-lang-toggle] button, [data-action=locale], [data-testid=lang-toggle], button:has-text("EN")').filter({ visible: true }).first();
    if (await toggle.count()) { await toggle.click(); await phone.waitForTimeout(900); await shot(phone, 'iphone-en-overview', true); await metrics(phone, 'iphone-en-overview'); await toggle.click(); await phone.waitForTimeout(500); }
    else log('no language toggle found on the dashboard');
  } catch (e) { fail('iphone en', e); }
  try {
    await phone.setViewportSize({ width: 844, height: 390 });
    await openDomain(phone, 'u-pokretu');
    await shot(phone, 'iphone-landscape-promet');
    await metrics(phone, 'iphone-landscape-promet');
    await openDomain(phone, 'grad-sada');
    await shot(phone, 'iphone-landscape-sada');
    await metrics(phone, 'iphone-landscape-sada');
    await phone.setViewportSize({ width: iphone.viewport.width, height: iphone.viewport.height });
  } catch (e) { fail('iphone landscape', e); }
  try {
    await openDomain(phone, 'grad-sada');
    await phone.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await phone.waitForTimeout(800);
    await shot(phone, 'iphone-zoom200-overview');
    await metrics(phone, 'iphone-zoom200-overview');
    await openDomain(phone, 'u-pokretu');
    await shot(phone, 'iphone-zoom200-promet');
    await metrics(phone, 'iphone-zoom200-promet');
    await phone.evaluate(() => { for (const s of document.querySelectorAll('style')) if (/font-size: 200%/.test(s.textContent || '')) s.remove(); });
    await openDomain(phone, 'grad-sada');
  } catch (e) { fail('iphone zoom200', e); }

  // PHONE 2: Pixel 7 in Chromium, dark; touch swipes over the map and over the content.
  try {
    const droid = await newCtx(chrome, 'android', { ...devices['Pixel 7'], colorScheme: 'dark' });
    await unlock(droid, await freshCode(kiosk), 'android');
    for (const layer of ['u-pokretu', 'zrak-i-nebo']) { await openDomain(droid, layer); await shot(droid, `android-${layer}`, true); await metrics(droid, `android-${layer}`); }
    result.metrics['android-resources'] = await droid.evaluate(() => { const es = performance.getEntriesByType('resource'); const sum = (f) => es.filter(f).reduce((a, e) => a + (e.transferSize || 0), 0); return { count: es.length, js: sum((e) => /\.js/.test(e.name)), css: sum((e) => /\.css/.test(e.name)), fonts: sum((e) => /\.woff2/.test(e.name)), tiles: sum((e) => /\/maps\//.test(e.name)), api: sum((e) => /\/api\//.test(e.name)), total: sum(() => true) }; });
    log(`android resources ${JSON.stringify(result.metrics['android-resources'])}`);
    await openDomain(droid, 'u-pokretu');
    const cdp = await droid.context().newCDPSession(droid);
    const mb = await mapBox(droid);
    if (mb) {
      const before = await droid.evaluate(() => scrollY);
      await touchSwipe(cdp, droid, mb.x + mb.width / 2, mb.y + mb.height * 0.75, mb.y + mb.height * 0.25);
      const afterMap = await droid.evaluate(() => scrollY);
      await shot(droid, 'android-promet-after-map-swipe');
      await openDomain(droid, 'grad-sada');
      const control0 = await droid.evaluate(() => scrollY);
      await touchSwipe(cdp, droid, mb.x + mb.width / 2, 500, 300);
      const afterSada = await droid.evaluate(() => scrollY);
      result.metrics['android-swipe'] = { before, afterMapSwipe: afterMap, sadaBefore: control0, afterSadaSwipe: afterSada, mapBox: mb };
      log(`android swipe: over map scrollY ${before}->${afterMap}; over Sada ${control0}->${afterSada}`);
    }
    await droid.context().close();
  } catch (e) { fail('android', e); }

  // SLOW: Pixel 7, 4x CPU, about 1.6 Mbps, 150 ms latency.
  try {
    const slow = await newCtx(chrome, 'slow', { ...devices['Pixel 7'], colorScheme: 'light' });
    const cdp = await slow.context().newCDPSession(slow);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await slow.goto(`${ORIGIN}/`);
    result.timings['slow-landing'] = await slow.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) }; });
    const code = await freshCode(kiosk);
    const s = Date.now();
    await slow.goto(`${ORIGIN}/s/#${code}`);
    await slow.getByTestId('confirm-card').waitFor({ timeout: 60_000 });
    result.timings['slow-confirm-visible-ms'] = Date.now() - s;
    await slow.getByRole('button', { name: 'Otključaj', exact: true }).click();
    const u = Date.now();
    await slow.waitForFunction(() => document.querySelector('[data-testid=session-label]') && document.querySelector('[data-testid=session-label]').getAttribute('data-state') === 'live', null, { timeout: 60_000 });
    result.timings['slow-unlock-ms'] = Date.now() - u;
    result.timings['slow-data-ms'] = await waitData(slow, 60_000);
    await shot(slow, 'slow-overview');
    const m = Date.now();
    await openDomain(slow, 'u-pokretu');
    result.timings['slow-map-ready-ms'] = Date.now() - m;
    await shot(slow, 'slow-promet');
    log(`slow timings ${JSON.stringify(result.timings)}`);
    await slow.context().close();
  } catch (e) { fail('slow', e); }

  // DESKTOP 1440×900.
  try {
    const desk = await newCtx(chrome, 'desktop', { viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    await desk.goto(`${ORIGIN}/`);
    await desk.waitForTimeout(2500);
    await shot(desk, 'desktop-landing', true);
    await metrics(desk, 'desktop-landing');
    await unlock(desk, await freshCode(kiosk), 'desktop');
    for (const layer of ['u-pokretu', 'zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'kultura', 'vijesti']) { await openDomain(desk, layer); await shot(desk, `desktop-${layer}`); await metrics(desk, `desktop-${layer}`); }
    await openDomain(desk, 'grad-sada');
    await desk.getByTestId('session-label').click();
    await desk.waitForTimeout(700);
    await shot(desk, 'desktop-session-sheet');
    await metrics(desk, 'desktop-session-sheet');
    await desk.context().close();
  } catch (e) { fail('desktop', e); }

  // EXPIRY on the iPhone: the warning, the frozen state, the screen afterwards.
  if (expiresAt) {
    try {
      await openDomain(phone, 'grad-sada');
      const wait = expiresAt - EXPIRY_WARNING_LEAD_MS - Date.now();
      if (wait > 0) { log(`waiting ${Math.round(wait / 1000)} s for the expiry warning`); await phone.waitForTimeout(wait); }
      await shot(phone, 'iphone-expiry-warning', true);
      await metrics(phone, 'iphone-expiry-warning');
      await phone.getByTestId('frozen-line').waitFor({ timeout: Math.max(10_000, expiresAt - Date.now() + 45_000) });
      await phone.waitForTimeout(1500);
      await shot(phone, 'iphone-frozen', true);
      await metrics(phone, 'iphone-frozen');
      try { await phone.locator('[data-action=nav][data-layer="u-pokretu"]:visible').first().click({ timeout: 3000 }); await phone.waitForTimeout(1200); } catch { log('nav after freeze not clickable'); }
      await shot(phone, 'iphone-frozen-after-nav', true);
      await metrics(phone, 'iphone-frozen-after-nav');
      await kiosk.waitForTimeout(3000);
      await shot(kiosk, 'kiosk-after-iphone-expiry');
      await metrics(kiosk, 'kiosk-after-iphone-expiry');
      const basics = kiosk.getByRole('button', { name: /Osnovno/i });
      if (await basics.count()) { await basics.first().click(); await kiosk.waitForTimeout(2500); await shot(kiosk, 'kiosk-basics-1366'); await metrics(kiosk, 'kiosk-basics-1366'); }
    } catch (e) { fail('expiry', e); }
  }
} catch (e) {
  fatal = true;
  fail('main', e);
} finally {
  result.finishedAt = new Date().toISOString();
  const byRule = {};
  for (const v of result.violations) byRule[v.rule] = (byRule[v.rule] || 0) + 1;
  result.summary = { captures: Object.keys(result.metrics).length, violations: result.violations.length, byRule, errors: result.errors.length, fatal };
  writeFileSync(resolve(OUT, 'result.json'), JSON.stringify(result, null, 2));
  for (const c of contexts) { try { await c.close(); } catch {} }
  try { await chrome.close(); } catch {}
  try { if (wk) await wk.close(); } catch {}
  log(`done: ${result.summary.captures} metric sets, ${result.violations.length} rule violations ${JSON.stringify(byRule)}, ${result.errors.length} recorded errors/warnings; ${resolve(OUT, 'result.json')}`);
}
process.exitCode = fatal ? 2 : result.violations.length ? 1 : 0;
