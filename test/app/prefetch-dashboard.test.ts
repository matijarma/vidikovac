// @vitest-environment happy-dom
// The /s/ page carries /d/'s static graph as inert modulepreload links in a template, and the scan entry moves them
// into the head only while the page idles (app/src/prefetch-dashboard.ts through vite.config.ts and
// app/src/entries/scan.ts; round 3, phone F3 and its review B1). test/app/scan-graph-build.test.ts holds the same
// against a real build.
import { describe, expect, it } from 'vitest';
import { activateDashboardGraph, DASHBOARD_GRAPH_ID, dashboardGraphLinks, entryChunkFor, staticGraph, withDashboardGraph, type BundleChunkLike } from '../../app/src/prefetch-dashboard';

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
const LINKS = [
  '<link rel="modulepreload" crossorigin fetchpriority="low" href="/assets/d-1.js">',
  '<link rel="modulepreload" crossorigin fetchpriority="low" href="/assets/base-1.js">',
  '<link rel="modulepreload" crossorigin fetchpriority="low" href="/assets/qr-1.js">',
];

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

describe('withDashboardGraph', () => {
  it('appends one inert modulepreload per script /s/ does not already link, at the lowest priority, inside a template before </body>; no stylesheet', () => {
    expect(dashboardGraphLinks(S_HTML, BUNDLE)).toEqual(LINKS);
    const out = withDashboardGraph(S_HTML, BUNDLE);
    expect(out).toContain(`<template id="${DASHBOARD_GRAPH_ID}">\n${LINKS.join('\n')}\n</template>\n</body>`);
    // boot-1.js is the page's own modulepreload in its head: not appended a second time.
    expect(out.split('href="/assets/boot-1.js"').length - 1).toBe(1);
    expect(out).not.toContain('.css">\n');
    expect(out).not.toContain('rel="prefetch"');
    // Outside the template the page is as it was: nothing of /d/ is fetched by the markup itself.
    expect(out.slice(0, out.indexOf('<template'))).toBe(S_HTML.slice(0, S_HTML.indexOf('</body>')));
  });
  it('leaves a page without the entry, or without a body, as it was', () => {
    expect(withDashboardGraph(S_HTML, { 'assets/s-1.js': BUNDLE['assets/s-1.js']! })).toBe(S_HTML);
    expect(withDashboardGraph('<html></html>', BUNDLE)).toBe('<html></html>');
  });
});

describe('activateDashboardGraph', () => {
  it('moves the template\'s links into the head once; nothing without a template, nothing the second time', () => {
    document.documentElement.innerHTML = `<head></head><body><main></main><template id="${DASHBOARD_GRAPH_ID}">${LINKS.join('')}</template></body>`;
    expect(document.head.querySelectorAll('link').length).toBe(0);
    expect(activateDashboardGraph(document)).toBe(3);
    const links = [...document.head.querySelectorAll('link')];
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/assets/d-1.js', '/assets/base-1.js', '/assets/qr-1.js']);
    expect(links.every((l) => l.getAttribute('rel') === 'modulepreload' && l.hasAttribute('crossorigin') && l.getAttribute('fetchpriority') === 'low')).toBe(true);
    expect(activateDashboardGraph(document)).toBe(0);
    expect(document.head.querySelectorAll('link').length).toBe(3);
    document.documentElement.innerHTML = '<head></head><body></body>';
    expect(activateDashboardGraph(document)).toBe(0);
  });
});
