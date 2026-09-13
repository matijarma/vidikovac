import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

describe('MapLibre v6 deployment', () => {
  it('emits a self-contained worker instead of relying on an absent sibling file', async () => {
    const result = await build({
      configFile: resolve(import.meta.dirname, '../../vite.config.ts'),
      logLevel: 'silent',
      build: { write: false, minify: false },
    });
    const builds = Array.isArray(result) ? result : [result];
    const output = builds.flatMap((entry) => 'output' in entry ? entry.output : []);
    const workers = output.filter((entry) => /maplibre-gl-worker.*\.js$/.test(entry.fileName));
    expect(workers.length).toBeGreaterThan(0);
    for (const worker of workers) {
      const body = worker.type === 'chunk' ? worker.code : String(worker.source);
      expect(body).not.toMatch(/(?:from\s*|import\s*)['"]\.\/maplibre-gl-shared\.mjs/);
      expect(body.length).toBeGreaterThan(10_000);
    }
  }, 60_000);
});
