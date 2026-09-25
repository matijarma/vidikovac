// The /s/ page hands over to /d/ within seconds of a scan; the build appends one prefetch link per file of /d/'s static
// graph to /s/, so the hop finds the graph in the HTTP cache (app/src/prefetch-dashboard.ts through vite.config.ts;
// round 3, phone F3).
import { describe, expect, it } from 'vitest';
import { entryChunkFor, staticGraph, withDashboardPrefetch, type BundleChunkLike } from '../../app/src/prefetch-dashboard';

const chunk = (fileName: string, over: Partial<BundleChunkLike> = {}): BundleChunkLike => ({ type: 'chunk', fileName, imports: [], ...over });
const BUNDLE: Record<string, BundleChunkLike> = {
  // As Vite builds an HTML entry: the page's html is the facade, the entry script one of the chunk's modules.
  'assets/d-1.js': chunk('assets/d-1.js', { isEntry: true, facadeModuleId: '/repo/app/d/index.html', modules: { '/repo/app/src/entries/dashboard.ts': {}, '/repo/app/src/dashboard.ts': {} }, imports: ['assets/boot-1.js', 'assets/qr-1.js'], viteMetadata: { importedCss: new Set(['assets/d-1.css', 'assets/base-1.css']) } }),
  'assets/s-1.js': chunk('assets/s-1.js', { isEntry: true, facadeModuleId: '/repo/app/s/index.html', modules: { '/repo/app/src/entries/scan.ts': {} }, imports: ['assets/boot-1.js'] }),
  'assets/boot-1.js': chunk('assets/boot-1.js', { imports: ['assets/base-1.js'], viteMetadata: { importedCss: ['assets/base-1.css'] } }),
  'assets/base-1.js': chunk('assets/base-1.js'),
  'assets/qr-1.js': chunk('assets/qr-1.js', { imports: ['assets/base-1.js'] }),
  'assets/maplibre-1.js': chunk('assets/maplibre-1.js'),
  'assets/d-1.css': { type: 'asset', fileName: 'assets/d-1.css' },
};
const S_HTML = '<html><head><script type="module" crossorigin src="/assets/s-1.js"></script><link rel="modulepreload" crossorigin href="/assets/boot-1.js"><link rel="stylesheet" crossorigin href="/assets/base-1.css"></head><body><main></main></body></html>';

describe('staticGraph', () => {
  it('walks the entry and its static imports once each, the entry first, and collects the stylesheets they carry; a lazy chunk is not in it', () => {
    expect(staticGraph(BUNDLE, 'assets/d-1.js')).toEqual({ scripts: ['assets/d-1.js', 'assets/boot-1.js', 'assets/base-1.js', 'assets/qr-1.js'], styles: ['assets/d-1.css', 'assets/base-1.css'] });
  });
  it('finds the entry by its script among the chunk\'s modules, or by its facade', () => {
    expect(entryChunkFor(BUNDLE, '/entries/dashboard.ts')?.fileName).toBe('assets/d-1.js');
    expect(entryChunkFor(BUNDLE, '/d/index.html')?.fileName).toBe('assets/d-1.js');
    expect(entryChunkFor(BUNDLE, '/entries/kiosk.ts')).toBeUndefined();
  });
});

describe('withDashboardPrefetch', () => {
  it('appends a prefetch link per file /s/ does not already link, scripts with crossorigin as module scripts are fetched, before </body>', () => {
    const out = withDashboardPrefetch(S_HTML, BUNDLE);
    expect(out).toContain('<link rel="prefetch" as="script" crossorigin href="/assets/d-1.js">\n<link rel="prefetch" as="script" crossorigin href="/assets/base-1.js">\n<link rel="prefetch" as="script" crossorigin href="/assets/qr-1.js">\n<link rel="prefetch" as="style" href="/assets/d-1.css">\n</body>');
    expect(out).not.toContain('prefetch" as="script" crossorigin href="/assets/boot-1.js"');
    expect(out).not.toContain('prefetch" as="style" href="/assets/base-1.css"');
    expect(out).not.toContain('maplibre');
    expect(out.startsWith(S_HTML.slice(0, S_HTML.indexOf('</body>')))).toBe(true);
  });
  it('leaves a page without the entry, or without a body, as it was', () => {
    expect(withDashboardPrefetch(S_HTML, { 'assets/s-1.js': BUNDLE['assets/s-1.js']! })).toBe(S_HTML);
    expect(withDashboardPrefetch('<html></html>', BUNDLE)).toBe('<html></html>');
  });
});
