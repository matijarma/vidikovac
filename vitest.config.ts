import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Three projects, selected with `npx vitest run --project unit|workers|accept`.
//   unit:    pure modules, node environment, files test/**/*.test.ts
//   workers: anything touching bindings or Durable Objects, runs inside workerd
//            with the real wrangler.jsonc, files test/**/*.workers.test.ts
//   accept:  the companion acceptance tier (test/accept/**), red by design until
//            the packages it measures land; `npm test` runs unit + workers only.
//            Fold-back rule: when every accept row is green, drop the --project
//            filters from "test" in package.json and the test/accept exclusion
//            below, so the tier becomes plain regression.
// With vitest 4 the workers pool is a Vite plugin (cloudflareTest), scoped to
// the workers project so it never touches the node project.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['test/**/*.workers.test.ts', 'test/accept/**', '**/node_modules/**', 'video/**', 'e2e/**'],
          // happy-dom pages sit at http://localhost:3000: a relative fetch fails there without a connection.
          setupFiles: ['test/setup/dom-offline.ts'],
        },
      },
      {
        test: {
          name: 'accept',
          environment: 'node',
          include: ['test/accept/**/*.test.ts'],
          testTimeout: 180_000,
          hookTimeout: 180_000,
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            // Integration tests use local bindings; never start a paid AI
            // proxy or require production credentials just to run the suite.
            remoteBindings: false,
            // Each test file gets its own storage; DO state never leaks between files.
            isolatedStorage: true,
            miniflare: {
              bindings: {
                SESSION_SECRET: 'test-session-secret',
                APP_ENV: 'test',
                NET_KEY_SECRET: 'test-net-key-secret',
                NETWORK_CHECK: 'off',
                E2E_ADMIN_BYPASS: 'test-admin-bypass-value-0123456789',
              },
            },
          }),
        ],
        test: {
          name: 'workers',
          include: ['test/**/*.workers.test.ts'],
          // The host is shared: two worktrees' suites at once (load 13, 24 Sep 22:44) starve workerd, and a
          // Durable Object round trip that takes 50 ms alone takes seconds. vitest's 5 s default then times a
          // test out, and its leaked work (the module seams stay installed) breaks the next test in the file.
          // A passing test returns as fast as before; only a stalled one waits longer.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
    exclude: ['**/node_modules/**', 'app/dist/**', 'e2e/**', 'video/**'],
    // Stopping a workers-pool runner disposes its workerd; on a loaded host that outlasts the 10 s default and the
    // next file's runner failed to start ("socket hang up", two suites at once, 24 Sep 23:15).
    teardownTimeout: 60_000,
  },
});
