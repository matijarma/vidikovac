import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Two projects, selected with `npx vitest run --project unit|workers`.
//   unit:    pure modules, node environment, files test/**/*.test.ts
//   workers: anything touching bindings or Durable Objects, runs inside workerd
//            with the real wrangler.jsonc, files test/**/*.workers.test.ts
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
          exclude: ['test/**/*.workers.test.ts', '**/node_modules/**', 'video/**', 'e2e/**'],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            // Each test file gets its own storage; DO state never leaks between files.
            isolatedStorage: true,
            miniflare: {
              bindings: {
                SESSION_SECRET: 'test-session-secret',
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
