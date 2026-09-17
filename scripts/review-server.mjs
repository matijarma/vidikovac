// Serve a contributor worktree's actual app against the real local Worker.
// No mock routes, authentication bypass or fixture session is shipped.
import { createServer, preview } from 'vite';
import { resolve } from 'node:path';

const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex === -1 ? 5174 : process.argv[portIndex + 1]);
const built = process.argv.includes('--built');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid review port.');
const target = 'http://127.0.0.1:8787';
const mapTarget = process.env.REVIEW_MAP_ORIGIN ?? target;
if (![target, 'https://zagreb.aningfilm.hr'].includes(mapTarget)) throw new Error('Unexpected review map origin.');
const settings = {
    host: '127.0.0.1', port, strictPort: true,
    // Main-agent shared contracts may be inspected alongside a contributor's
    // worktree. This local-only server is never the deployed asset handler.
    fs: { allow: [process.cwd(), resolve(import.meta.dirname, '..')] },
    proxy: {
      '/api': { target, changeOrigin: false },
      '/ws': { target, ws: true, changeOrigin: false },
      '/maps': {
        target: mapTarget, changeOrigin: mapTarget !== target,
        configure(proxy) {
          if (mapTarget === target) return;
          // Simulated E2E addresses belong to the local Worker only. An edge
          // rejects spoofed CF headers; never forward them to the tile host.
          proxy.on('proxyReq', request => request.removeHeader('CF-Connecting-IP'));
        },
      },
      '/hitno': { target, changeOrigin: false },
      '/open': { target, changeOrigin: false },
    },
};
const config = {
  configFile: resolve(process.cwd(), 'vite.config.ts'),
  // Playwright clears test-results between runs. Keep the live development
  // cache outside it; final review uses --built and has no HMR at all.
  cacheDir: resolve(process.cwd(), 'review.local/vite-cache'),
};
const server = built ? await preview({ ...config, preview: settings }) : await createServer({
  ...config, server: settings,
});
if (!built) await server.listen();
server.printUrls();
console.log(`${built ? 'Built' : 'Source'} app from ${process.cwd()}, real API and pairing from ${target}.`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  if (built) await new Promise(resolve => server.httpServer.close(resolve));
  else await server.close();
  process.exit(0);
});
