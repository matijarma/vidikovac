import { defineConfig, devices } from '@playwright/test';

// Two local servers, both `wrangler dev` on the same code:
//   :8787  .dev.vars as committed in .dev.vars.example (SESSION_MINUTES=10, NETWORK_CHECK=off)
//   :8788  the same plus --var SESSION_MINUTES:0.2, so the expiry spec sees a
//          12-second session without touching the main instance's state
//          (separate --persist-to so the two local DO stores never mix).
// Point the suite at production with:
//   E2E_NO_WEBSERVER=1 E2E_APP_URL=https://zagreb.aningfilm.hr E2E_KIOSK_URL=<provisioning URL of the E2E screen> npx playwright test
// Same-network pairing must work on every environment. The expiry spec is
// skipped for a hosted target unless E2E_SHORT_URL names a dedicated server
// running with SESSION_MINUTES=0.2.
const APP_URL = process.env.E2E_APP_URL ?? 'http://localhost:8787';
const SHORT_URL = process.env.E2E_SHORT_URL ?? 'http://localhost:8788';
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
  // Two projects. `chromium` is the desk: every behavioural spec, at whatever
  // viewport each test sets. `mobile` is a Pixel 7 (isMobile, hasTouch, a real
  // device scale factor) and runs only the phone gates and the fixture-backed
  // session sweep, so the wall clock grows by minutes, not by a second run of
  // the whole suite. Both share the servers, the single worker and the env
  // switches above.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/mobile.spec.ts', '**/a11y-session.spec.ts'],
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: ['**/mobile.spec.ts', '**/a11y-session.spec.ts', '**/schema.spec.ts'],
    },
  ],
  webServer: MANAGED_SERVERS
    ? [
        {
          command: 'npm run build && npm run dev -- --port 8787 --inspector-port 9229 --var APP_ENV:test',
          url: `${APP_URL}/api/health`,
          timeout: 240_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          command:
            'node scripts/require-app-build.mjs && npx wrangler dev --port 8788 --inspector-port 9230 --var APP_ENV:test --var SESSION_MINUTES:0.2 --persist-to .wrangler/state-e2e-short',
          url: `${SHORT_URL}/api/health`,
          timeout: 120_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      ]
    : undefined,
});
