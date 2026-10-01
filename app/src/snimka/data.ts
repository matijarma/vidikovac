// Loading the dataset: the manifest (always fresh) and the hashed, immutable
// objects it names (once each). The page never calls a live API; everything
// comes from SNIMKA_API, where worker/routes/snimka.ts serves R2.
import { SNIMKA_API, type HashedRef, type SnimkaManifest } from '../../../shared/snimka';
import { SnimkaError, decodeManifest } from '../../../shared/snimka-codec';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RefCache {
  /** The parsed JSON of a ref, fetched once per path (a failure retried once, then rejected and forgotten so a later
   *  call tries again); `decode` validates per call, so a bad object rejects every caller. */
  get<T = unknown>(ref: HashedRef | string, decode?: (raw: unknown) => T): Promise<T>;
  /** The URL of a ref, for images and prefetch links. */
  url(ref: HashedRef | string): string;
}

export async function loadManifest(fetchImpl: FetchLike = fetch): Promise<SnimkaManifest> {
  const res = await fetchImpl(`${SNIMKA_API}manifest.json`, { cache: 'no-cache', headers: { accept: 'application/json' } });
  if (!res.ok) throw new SnimkaError(`manifest ${res.status}`);
  return decodeManifest(await res.json());
}

const pathOf = (ref: HashedRef | string): string => (typeof ref === 'string' ? ref : ref.path);

export function createRefCache(fetchImpl: FetchLike = fetch): RefCache {
  const raw = new Map<string, Promise<unknown>>();
  const url = (ref: HashedRef | string): string => `${SNIMKA_API}${pathOf(ref)}`;
  const fetchJson = async (path: string): Promise<unknown> => {
    const res = await fetchImpl(url(path), { headers: { accept: 'application/json' } });
    if (!res.ok) throw new SnimkaError(`${path} ${res.status}`);
    return res.json();
  };
  return {
    url,
    get<T>(ref: HashedRef | string, decode?: (raw: unknown) => T): Promise<T> {
      const path = pathOf(ref);
      let p = raw.get(path);
      if (!p) {
        p = fetchJson(path).catch(() => fetchJson(path));
        p.catch(() => raw.delete(path));
        raw.set(path, p);
      }
      return p.then((value) => (decode ? decode(value) : (value as T)));
    },
  };
}
