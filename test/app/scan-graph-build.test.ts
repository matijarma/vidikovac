// The built /s/ page's inert template holds exactly /d/'s static graph (vite.config.ts dashboardGraphPlugin over
// app/src/prefetch-dashboard.ts): a chunk-layout change that moved the entry, split a chunk or renamed a file would
// leave the template listing the wrong files, and this build guards it (round 3 review, B1).
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { DASHBOARD_GRAPH_ID, entryChunkFor, staticGraph, type BundleChunkLike } from '../../app/src/prefetch-dashboard';

describe('the /s/ page and /d/\'s static graph', () => {
  it('carries every script of /d/\'s static graph that /s/ does not link itself, inert, and nothing else of /d/', async () => {
    const result = await build({ configFile: resolve(import.meta.dirname, '../../vite.config.ts'), logLevel: 'silent', build: { write: false, minify: false } });
    const builds = Array.isArray(result) ? result : [result];
    const output = builds.flatMap((entry) => 'output' in entry ? entry.output : []);
    const bundle: Record<string, BundleChunkLike> = Object.fromEntries(output.map((o) => [o.fileName, o as unknown as BundleChunkLike]));
    const sPage = output.find((o) => o.fileName === 's/index.html');
    const dPage = output.find((o) => o.fileName === 'd/index.html');
    expect(sPage?.type).toBe('asset');
    expect(dPage?.type).toBe('asset');
    const sHtml = String((sPage as { source: unknown }).source);
    const dHtml = String((dPage as { source: unknown }).source);
    const template = /<template id="dashboard-graph">([\s\S]*?)<\/template>/.exec(sHtml);
    expect(template, 'the template is on the built /s/ page').not.toBeNull();
    const hrefs = [...template![1]!.matchAll(/<link rel="modulepreload" crossorigin fetchpriority="low" href="([^"]+)">/g)].map((m) => m[1]!);
    // The graph as the bundle says it, minus what /s/ links in its own head.
    const entry = entryChunkFor(bundle, '/entries/dashboard.ts');
    expect(entry?.fileName).toMatch(/^assets\/d-[^/]+\.js$/);
    const head = sHtml.slice(0, sHtml.indexOf('<template'));
    const expected = staticGraph(bundle, entry!.fileName).scripts.filter((f) => !head.includes(`/${f}"`)).map((f) => `/${f}`);
    expect(hrefs).toEqual(expected);
    expect(hrefs.length).toBeGreaterThanOrEqual(5);
    // Every warmed file is a real chunk of this build and a script /d/ itself loads (its entry by src, the rest by modulepreload).
    for (const href of hrefs) {
      expect(bundle[href.slice(1)]?.type, href).toBe('chunk');
      expect(dHtml.includes(`href="${href}"`) || dHtml.includes(`src="${href}"`), `${href} on /d/`).toBe(true);
    }
    // Outside the template /s/ links nothing of /d/: the entry's chunk appears only inside the template.
    expect(head).not.toContain(`/${entry!.fileName}`);
    expect(hrefs).toContain(`/${entry!.fileName}`);
    expect(DASHBOARD_GRAPH_ID).toBe('dashboard-graph');
  }, 180_000);
});
