import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Multi-page static build. Every HTML entry listed here becomes a real static
// asset served by Cloudflare's asset store without invoking the Worker.
export default defineConfig({
  root: 'app',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'app/index.html'),
        s: resolve(__dirname, 'app/s/index.html'),
      },
    },
  },
});
