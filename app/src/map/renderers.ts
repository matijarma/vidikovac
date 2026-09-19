// The page factory stays synchronous. Only a requested schema slot imports
// the schema renderer and its CSS; neither enters the lightweight static graph.
import { createCityMap, type CityMapHandle, type CityMapOptions, type MapFactory, type MapSelection, type MapStatus } from './city-map';
import type { Network } from '../../../shared/motion/network';

interface RendererDeps {
  loadSchema?: () => Promise<{ createSchemaMap: MapFactory }>;
}

export function createMapRenderer(options: CityMapOptions, deps: RendererDeps = {}): CityMapHandle {
  if (options.renderer !== 'schema') return createCityMap(options);

  let current: CityMapHandle | null = null;
  let destroyed = false;
  let failed = false;
  let status: MapStatus = 'loading';
  let network: Network | null = null;
  let selection: MapSelection | null = options.selection ??
    (options.selectedRoute ? { kind: 'route', id: options.selectedRoute } : options.selectedStop ? { kind: 'stop', id: options.selectedStop } : null);
  let following = options.follow ?? null;
  // Coalesce repeated polls/setters while a slow import is pending, preserving
  // the order of the latest calls. No unbounded queue of vehicle snapshots.
  const pending = new Map<string, (handle: CityMapHandle) => void>();
  function send(key: string, apply: (handle: CityMapHandle) => void): void {
    if (destroyed || failed) return;
    if (current) apply(current);
    else {
      pending.delete(key);
      pending.set(key, apply);
    }
  }
  options.container.setAttribute('aria-label', options.ariaLabel);
  const guarded: CityMapOptions = {
    ...options,
    onSelect(next) {
      if (destroyed) return;
      selection = next;
      options.onSelect?.(next);
    },
    onStatus(next) {
      if (destroyed) return;
      status = next;
      options.onStatus?.(next);
    },
    onNetwork(next) {
      if (destroyed) return;
      network = next;
      options.onNetwork?.(next);
    },
    onUserMove(camera) {
      if (destroyed) return;
      following = null;
      options.onUserMove?.(camera);
    },
  };
  void Promise.resolve()
    .then(() => {
      if (destroyed) return null;
      return (deps.loadSchema ?? (() => import('../motion/schema-map')))();
    })
    .then((module) => {
      if (!module || destroyed) return;
      const handle = module.createSchemaMap(guarded);
      // A synchronous creation callback may already have caused a slot swap.
      if (destroyed) { handle.destroy(); return; }
      current = handle;
      for (const apply of pending.values()) {
        if (destroyed) break;
        apply(handle);
      }
      pending.clear();
    })
    .catch(() => {
      if (destroyed) return;
      failed = true;
      pending.clear();
      current?.destroy();
      current = null;
      guarded.onStatus?.('unavailable');
    });

  return {
    update: (points, lines) => send('update', (h) => h.update(points, lines)),
    pause: () => send('motion', (h) => h.pause()),
    resume: () => send('motion', (h) => h.resume()),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      pending.clear();
      current?.destroy();
      current = null;
    },
    setTheme: (theme) => send('theme', (h) => h.setTheme?.(theme)),
    setLocale: (locale) => send('locale', (h) => h.setLocale?.(locale)),
    select(next, fit) {
      selection = next;
      send('selection', (h) => h.select?.(next, fit));
    },
    selection: () => current?.selection ? current.selection() : selection,
    follow(next) {
      following = next;
      send('follow', (h) => h.follow?.(next));
    },
    following: () => current?.following ? current.following() : following,
    setView: (view) => send('view', (h) => h.setView?.(view)),
    resize: () => send('resize', (h) => h.resize?.()),
    setModes: (modes) => send('modes', (h) => h.setModes?.(modes)),
    setEmphasis: (emphasis) => send('emphasis', (h) => h.setEmphasis?.(emphasis)),
    setLineFocus: (on) => send('lineFocus', (h) => h.setLineFocus?.(on)),
    setClosuresVisible: (visible) => send('closures', (h) => h.setClosuresVisible?.(visible)),
    setFeedState: (state) => send('feed', (h) => h.setFeedState?.(state)),
    setStop: (stop) => send('stop', (h) => h.setStop?.(stop)),
    setOutline: (outline) => send('outline', (h) => h.setOutline?.(outline)),
    setCityPaths: lines => send('city-paths',h=>h.setCityPaths?.(lines)),
    fit: (target) => send('fit', (h) => h.fit?.(target)),
    setFitPadding: (padding) => send('padding', (h) => h.setFitPadding?.(padding)),
    camera: () => current?.camera?.() ?? null,
    status: () => current?.status?.() ?? status,
    network: () => current?.network ? current.network() : network,
    vehicles: () => current?.vehicles?.() ?? [],
  };
}
