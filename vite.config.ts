import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { renderIzvoriHtml } from './app/src/izvori-render';
import { markPrintStylesheets } from './app/src/print-media';

// Multi-page static build. Every HTML entry listed here becomes a real static
// asset served by Cloudflare's asset store without invoking the Worker.
// `import.meta.dirname` (not __dirname) so the config is importable from vitest.
const page = (name: string): string => resolve(import.meta.dirname, name);

/** /izvori is rendered from app/src/data/izvori.json at build time, so the
 *  attribution page works with JavaScript switched off. */
function izvoriHtmlPlugin(): Plugin {
  return {
    name: 'vidikovac-izvori',
    transformIndexHtml: {
      order: 'pre',
      handler(html: string, ctx: { path: string }): string {
        if (!ctx.path.includes('/izvori/')) return html;
        return html.replace('<!--IZVORI-->', renderIzvoriHtml());
      },
    },
  };
}

/** A stylesheet that is nothing but `@media print` (ui/print.css) is linked with media="print", so it never
 *  blocks the first render (app/src/print-media.ts). Runs after Vite has written the page's links. */
function printMediaPlugin(): Plugin {
  return {
    name: 'vidikovac-print-media',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;
        return markPrintStylesheets(html, (href) => {
          const asset = bundle[href.replace(/^\//, '')];
          return asset?.type === 'asset' ? String(asset.source) : undefined;
        });
      },
    },
  };
}

export default defineConfig({
  root: 'app',
  publicDir: 'public',
  plugins: [izvoriHtmlPlugin(), printMediaPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: page('app/index.html'),
        s: page('app/s/index.html'),
        d: page('app/d/index.html'),
        kiosk: page('app/kiosk/index.html'),
        izvori: page('app/izvori/index.html'),
        privatnost: page('app/privatnost/index.html'),
        pristupacnost: page('app/pristupacnost/index.html'),
        prijava: page('app/prijava/index.html'),
      },
    },
  },
});
