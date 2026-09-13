// Serve a contributor worktree's actual app against the real local Worker.
// No mock routes, authentication bypass or fixture session is shipped.
import { createServer } from 'vite';
import { resolve } from 'node:path';

const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex === -1 ? 5174 : process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid review port.');
const target = 'http://127.0.0.1:8787';
const server = await createServer({
  configFile: resolve(process.cwd(), 'vite.config.ts'),
  // Worktrees share node_modules through junctions, but Vite's optimised module
  // cache is root/config-specific and must not be shared between dev servers.
  cacheDir: resolve(process.cwd(), 'test-results/vite-cache'),
  server: {
    host: '127.0.0.1', port, strictPort: true,
    // Main-agent shared contracts may be inspected alongside a contributor's
    // worktree. This local-only server is never the deployed asset handler.
    fs: { allow: [process.cwd(), resolve(import.meta.dirname, '..')] },
    proxy: {
      '/api': { target, changeOrigin: false },
      '/ws': { target, ws: true, changeOrigin: false },
      '/maps': { target, changeOrigin: false },
      '/hitno': { target, changeOrigin: false },
      '/open': { target, changeOrigin: false },
    },
  },
});
await server.listen();
server.printUrls();
console.log(`Real app from ${process.cwd()}, real API and pairing from ${target}.`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
