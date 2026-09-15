import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { renderIzvoriHtml } from './app/src/izvori-render';

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

export default defineConfig({
  root: 'app',
  publicDir: 'public',
  plugins: [izvoriHtmlPlugin()],
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
