#!/usr/bin/env node
// Lighthouse accessibility category over the five public surfaces. Requires a
// running server (default the wrangler dev app server on E2E_PORT) and a local
// Chrome or Chromium that chrome-launcher can find (CHROME_PATH overrides).
//   node scripts/lighthouse-a11y.mjs
//   E2E_APP_URL=https://zagreb.aningfilm.hr node scripts/lighthouse-a11y.mjs
// Exit 1 when any page scores below LH_MIN_A11Y (default 95).
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';
import { renderTable, summarise } from './lib/lighthouse-report.mjs';
import { e2ePorts, localOrigin } from './e2e-ports.mjs';

const BASE = process.env.E2E_APP_URL ?? localOrigin(e2ePorts().app);
const PAGES = ['/', '/hitno', '/kiosk/', '/s/', '/d/', '/prijava/', '/statistika/'];
const MIN = Number(process.env.LH_MIN_A11Y ?? '95');

const chrome = await launch({ chromeFlags: ['--headless=new', '--no-sandbox', '--window-size=1366,768'] });
const rows = [];
try {
  for (const path of PAGES) {
    const result = await lighthouse(`${BASE}${path}`, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['accessibility'],
      formFactor: 'desktop',
      screenEmulation: { mobile: false, width: 1366, height: 768, deviceScaleFactor: 1, disabled: false },
    });
    if (!result) throw new Error(`Lighthouse returned nothing for ${path}`);
    rows.push(summarise(path, result.lhr));
  }
} finally {
  // chrome-launcher's Windows teardown (taskkill, then an immediate rmSync of
  // the temp profile dir) can lose a race with the OS releasing file handles
  // and throw EPERM even though Chrome is already gone; that must not eat the
  // rows we already computed.
  try {
    await chrome.kill();
  } catch (err) {
    console.error(`chrome-launcher cleanup warning: ${err.message}`);
  }
}

console.log(renderTable(rows));
const failing = rows.filter((r) => r.score < MIN);
if (failing.length > 0) {
  console.error(`\nAccessibility below ${MIN}: ${failing.map((f) => `${f.path} (${f.score})`).join(', ')}`);
  process.exitCode = 1;
}
