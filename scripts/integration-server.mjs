// Local-only integration of the three author worktrees. Real source files,
// real Worker API and pairing, no mock route or duplicated source checkout.
import { createServer } from 'vite';
import { resolve, dirname, isAbsolute } from 'node:path';
import { e2ePorts, localOrigin } from './e2e-ports.mjs';

const main = resolve(import.meta.dirname, '..');
const parent = resolve(main, '../vidikovac-wt');
const roots = {
  main,
  ui: resolve(parent, 'kaj-ui'),
  map: resolve(parent, 'kaj-map'),
  kiosk: resolve(parent, 'kaj-kiosk'),
};
const slash = (path) => path.replaceAll('\\', '/');
const rootEntries = Object.values(roots).map(slash);
const owner = (relative) => {
  if (relative.startsWith('worker/')) return roots.main;
  if (relative.startsWith('app/src/core/')) return roots.main;
  if (['app/src/layers/shared.ts', 'app/src/layers/route-summary.ts'].includes(relative)) return roots.main;
  if (['app/src/api.ts', 'app/src/beacon.ts', 'app/src/session.ts', 'app/src/export.ts', 'app/src/boot.ts'].includes(relative)) return roots.main;
  if (['app/src/ui/theme.ts', 'app/src/ui/lagano.ts', 'app/src/ui/qrScanner.ts'].includes(relative)) return roots.main;
  if (relative.startsWith('app/src/map/') || relative.startsWith('app/src/transport/')) return roots.map;
  if (['app/src/layers/u-pokretu.ts', 'app/src/ui/map.css'].includes(relative)) return roots.map;
  if (relative.startsWith('app/src/kiosk/') || relative.startsWith('app/kiosk/')) return roots.kiosk;
  if (['app/src/kiosk.ts', 'app/src/entries/kiosk.ts', 'app/src/ui/kiosk.css'].includes(relative)) return roots.kiosk;
  return roots.ui;
};

function mapSource(source, importer) {
  const suffixAt = source.indexOf('?');
  const query = suffixAt >= 0 ? source.slice(suffixAt) : '';
  const bare = suffixAt >= 0 ? source.slice(0, suffixAt) : source;
  let path;
  if (bare.startsWith('/@fs/')) path = bare.slice(5);
  else if (bare.startsWith('/src/')) path = resolve(roots.ui, `app${bare}`);
  else if (bare.startsWith('.') && importer && !importer.startsWith('\0')) path = resolve(dirname(importer.split('?')[0]), bare);
  else if (isAbsolute(bare)) path = bare;
  else return null;
  path = slash(path);
  for (const root of rootEntries) {
    if (!path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) continue;
    let relative = path.slice(root.length + 1);
    if (relative.includes('/node_modules/') || relative.startsWith('node_modules/')) return null;
    // Extensionless TypeScript imports are how most app modules are written.
    if (!/\.[^/]+$/.test(relative)) relative += '.ts';
    if (!relative.startsWith('app/') && !relative.startsWith('worker/')) return null;
    const target = slash(resolve(owner(relative), relative));
    return target === path ? null : target + query;
  }
  return null;
}

// The app server of the local harness (E2E_PORT, scripts/e2e-ports.mjs).
const backend = localOrigin(e2ePorts().app, '127.0.0.1');
const server = await createServer({
  configFile: resolve(roots.ui, 'vite.config.ts'),
  root: resolve(roots.ui, 'app'),
  publicDir: resolve(main, 'app/public'),
  cacheDir: resolve(main, 'review.local/integration-cache'),
  plugins: [{
    name: 'kaj-author-worktree-integration',
    enforce: 'pre',
    async resolveId(source, importer) {
      const target = mapSource(source, importer);
      return target ? this.resolve(target, importer, { skipSelf: true }) : null;
    },
  }],
  server: {
    host: '127.0.0.1', port: 5177, strictPort: true,
    fs: { allow: Object.values(roots) },
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/ws': { target: backend, changeOrigin: false, ws: true },
      '/maps': { target: backend, changeOrigin: false },
      '/hitno': { target: backend, changeOrigin: false },
      '/open': { target: backend, changeOrigin: false },
    },
  },
});
await server.listen();
server.printUrls();
console.log('Kaj ima? local integration: UI + map + kiosk worktrees, real local Worker.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await server.close();
  process.exit(0);
});
