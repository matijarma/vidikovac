import { defineConfig, devices } from '@playwright/test';
import { e2ePorts, localOrigin } from './scripts/e2e-ports.mjs';

// Two local servers, both `wrangler dev` on the same code:
//   app    .dev.vars as committed in .dev.vars.example (SESSION_MINUTES=10, NETWORK_CHECK=off)
//   short  the same plus --var SESSION_MINUTES:0.2, so the expiry spec sees a
//          12-second session without touching the main instance's state
//          (separate --persist-to so the two local DO stores never mix).
// Their ports come from E2E_PORT (scripts/e2e-ports.mjs): app on E2E_PORT, short
// on the next one, each devtools inspector at a fixed offset; unset, the ports
// this harness always used. A second run on the same host sets another E2E_PORT
// and runs from another checkout, since both runs rebuild app/dist and one tree
// shares its .wrangler/ state.
// Point the suite at production with:
//   E2E_NO_WEBSERVER=1 E2E_APP_URL=https://zagreb.aningfilm.hr E2E_KIOSK_URL=<provisioning URL of the E2E screen> npx playwright test
// Same-network pairing must work on every environment. The expiry spec is
// skipped for a hosted target unless E2E_SHORT_URL names a dedicated server
// running with SESSION_MINUTES=0.2.
const PORTS = e2ePorts();
const APP_URL = process.env.E2E_APP_URL ?? localOrigin(PORTS.app);
const SHORT_URL = process.env.E2E_SHORT_URL ?? localOrigin(PORTS.short);
const MANAGED_SERVERS = !process.env.E2E_NO_WEBSERVER;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts', // vitest collects *.test.ts only, so the two never overlap
  fullyParallel: false, // one shared kiosk per spec; the expiry spec measures wall-clock time
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: APP_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'hr-HR',
    timezoneId: 'Europe/Zagreb',
  },
  // Three projects. `chromium` is the desk: every behavioural spec, at whatever
  // viewport each test sets. `mobile` is a Pixel 7 (isMobile, hasTouch, a real
  // device scale factor) and runs only the phone gates and the fixture-backed
  // session sweep, so the wall clock grows by minutes, not by a second run of
  // the whole suite. `accept` is the companion acceptance tier (e2e/accept/**),
  // red by design until the packages it measures land; `npm run e2e` names
  // chromium and mobile only and `npm run accept:e2e` runs this one. All three
  // share the servers, the single worker and the env switches above.
  // Fold-back rule: when every accept spec is green, drop the --project filters
  // from "e2e" in package.json and the e2e/accept ignores below, so the tier
  // becomes plain regression.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/mobile.spec.ts', '**/a11y-session.spec.ts', 'e2e/accept/**'],
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: ['**/mobile.spec.ts', '**/a11y-session.spec.ts', '**/schema.spec.ts'],
      testIgnore: ['e2e/accept/**'],
    },
    {
      name: 'accept',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['e2e/accept/**/*.spec.ts'],
      timeout: 300_000,
    },
  ],
  webServer: MANAGED_SERVERS
    ? [
        {
          command: `npm run build && npm run dev -- --port ${PORTS.app} --inspector-port ${PORTS.appInspector} --var APP_ENV:test`,
          url: `${APP_URL}/api/health`,
          timeout: 240_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          command:
            `node scripts/require-app-build.mjs && npx wrangler dev --port ${PORTS.short} --inspector-port ${PORTS.shortInspector} --var APP_ENV:test --var SESSION_MINUTES:0.2 --persist-to .wrangler/state-e2e-short`,
          url: `${SHORT_URL}/api/health`,
          timeout: 120_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      ]
    : undefined,
});
