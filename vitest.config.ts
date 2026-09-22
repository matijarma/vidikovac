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
        },
      },
    ],
    exclude: ['**/node_modules/**', 'app/dist/**', 'e2e/**', 'video/**'],
  },
});
