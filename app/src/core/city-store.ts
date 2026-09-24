import { emptyCity, type CityState, type CatalogueManifest, type CatalogueChunk, type CityLive } from '../../../shared/city/types';
import { canonicalPlaces } from '../../../shared/city/events';
export interface CityStore {
  snapshot(): CityState;
  start(): Promise<void>;
  ensure(ids: readonly string[]): Promise<void>;
  refresh(): Promise<void>;
  subscribe(fn: () => void): () => void;
  pause(): void;
  destroy(): void;
}
/** One store per surface. Static chunks are never polled with vehicle ticks.
 * Search and device geography never leave the browser. */
/** A failed chunk is retried on its own: Retry-After when the server gives one,
 * otherwise 15 s doubling to 10 min; the last good places stay on screen. */
const CHUNK_RETRY_BASE_MS = 15_000, CHUNK_RETRY_MAX_MS = 600_000;
class CityHttpError extends Error {
  constructor(readonly retryAfterMs: number | null) { super('city-unavailable'); }
}
function retryAfterMs(response: Response): number | null {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}
export function createCityStore(fetcher: typeof fetch = fetch): CityStore {
  let state = emptyCity(), stopped = false, paused = false, started = false, refreshing = false;
  const listeners = new Set<() => void>(), pending = new Map<string, Promise<void>>();
  const chunks = new Map<string, CatalogueChunk>();
  const retryAt = new Map<string, number>(), failures = new Map<string, number>();
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const clearRetries = () => { retryTimers.forEach(t => clearTimeout(t)); retryTimers.clear(); };
  const wanted = new Set<string>(['culture', 'water']);
  let timer: ReturnType<typeof setInterval> | undefined;
  let manifestTime = 0;
  const emit = () => { if (!stopped) listeners.forEach(fn => fn()); };
  async function request<T>(url: string): Promise<T> {
    const response = await fetcher(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new CityHttpError(retryAfterMs(response));
    return response.json() as Promise<T>;
  }
  const rebuild = () => {
    const all = [...chunks.values()];
    state = { ...state, places: canonicalPlaces(all.flatMap(c => c.data.places)), streets: all.flatMap(c => c.data.streets),
      paths: all.flatMap(c => c.data.paths), settlements: all.flatMap(c => c.data.settlements) };
  };
  async function ensure(ids: readonly string[]): Promise<void> {
    ids.forEach(id => wanted.add(id));
    if (stopped || paused || !state.manifest) return;
    await Promise.all(ids.map(async id => {
      if (state.loaded.includes(id)) return;
      if ((retryAt.get(id) ?? 0) > Date.now()) return;
      if (pending.has(id)) return pending.get(id);
      const source = state.manifest!.sources.find(s => s.id === id);
      if (!source || source.chunks.length === 0) return;
      state={...state,loading:true};
      const run = (async () => {
        try {
          const fetched: CatalogueChunk[] = [];
          for (const part of source.chunks.filter(c => !c.part)) {
            const data = await request<CatalogueChunk>(`/api/city/chunks/${part.hash}.json`);
            if (data.schema !== 1 || data.source?.id !== id || !Array.isArray(data.data?.places)) throw new Error('city-invalid-chunk');
            fetched.push(data);
          }
          if (stopped || paused) return;
          for (const [key, c] of chunks) if (c.source.id === id) chunks.delete(key);
          fetched.forEach((c,i) => chunks.set(`${id}:${i}`, c));
          failures.delete(id); retryAt.delete(id);
          state = { ...state, loaded: [...new Set([...state.loaded, id])], errors: state.errors.filter(e => e !== id) };
          rebuild();
        } catch (error) {
          const attempt = (failures.get(id) ?? 0) + 1;
          failures.set(id, attempt);
          const hinted = error instanceof CityHttpError ? error.retryAfterMs : null;
          const delay = Math.min(CHUNK_RETRY_MAX_MS, hinted ?? CHUNK_RETRY_BASE_MS * 2 ** (attempt - 1));
          retryAt.set(id, Date.now() + delay);
          if (!stopped && !paused) {
            state = { ...state, errors: [...new Set([...state.errors, id])] };
            clearTimeout(retryTimers.get(id));
            retryTimers.set(id, setTimeout(() => { retryTimers.delete(id); void ensure([id]); }, delay));
          }
        } finally {
          pending.delete(id);
          if(!stopped&&!paused){state={...state,loading:pending.size>0};emit();}
        }
      })();
      pending.set(id, run);
      return run;
    }));
  }
  async function refresh(): Promise<void> {
    if (stopped || paused || refreshing) return;
    refreshing = true;
    try {
      const live = await request<CityLive>('/api/city/live');
      if (live.schema !== 1 || !Array.isArray(live.bikes) || !Array.isArray(live.sources)) throw new Error('city-invalid-live');
      if (!stopped && !paused) state = { ...state, live, errors: state.errors.filter(e=>e !== 'live') };
    } catch {
      if (!stopped && !paused) state = { ...state, errors: [...new Set([...state.errors, 'live'])],
        live: state.live ? { ...state.live, sources: state.live.sources.map(s=>({...s,status:s.status==='down'?'down':'stale'})) } : null };
    } finally { refreshing = false; emit(); }
    if (Date.now() - manifestTime > 300_000) await manifest();
  }
  async function manifest(): Promise<void> {
    manifestTime = Date.now();
    try {
      const next = await request<CatalogueManifest>('/api/city/manifest');
      if (next.schema !== 1 || !Array.isArray(next.sources)) throw new Error('city-invalid-manifest');
      if (stopped || paused) return;
      const previous = state.manifest;
      const changed = state.loaded.filter(id => JSON.stringify(previous?.sources.find(s=>s.id===id)?.chunks) !== JSON.stringify(next.sources.find(s=>s.id===id)?.chunks));
      state = { ...state, manifest: next, loaded: state.loaded.filter(id=>!changed.includes(id)), errors: state.errors.filter(e=>e!=='manifest') };
      await ensure([...new Set([...wanted, ...changed])]);
    } catch { if (!stopped && !paused) state = { ...state, errors: [...new Set([...state.errors, 'manifest'])] }; }
    if(!stopped&&!paused){state = { ...state, loading: pending.size>0 }; emit();}
  }
  return {
    snapshot: () => state, ensure, refresh,
    async start() {
      if (started || stopped) return;
      started = true; state = { ...state, loading: true };
      await Promise.all([manifest(), refresh()]);
      if (!stopped && !paused) timer = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) void refresh(); }, 60_000);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    pause() { paused = true; if (timer) clearInterval(timer); clearRetries(); },
    destroy() { stopped = true; if (timer) clearInterval(timer); clearRetries(); listeners.clear(); },
  };
}
