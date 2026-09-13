import { describe, expect, it, vi } from 'vitest';
import { handleMaps } from '../../worker/routes/maps';
import type { Env } from '../../worker/env';

const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
const environment = (assets = vi.fn()) => ({ ASSETS: { fetch: assets } }) as unknown as Env;
const call = (path: string, env = environment(), method = 'GET') => {
  const url = new URL(path, 'https://zagreb.aningfilm.hr');
  return handleMaps(new Request(url, { method }), env, ctx, url);
};

describe('bounded versioned map route', () => {
  it('declines unrelated routes and denies unsupported methods', async () => {
    expect(await call('/api/health')).toBeNull();
    expect((await call('/maps/zagreb-v1/12/2000/1000.mvt', environment(), 'POST'))?.status).toBe(405);
  });
  it('rejects arbitrary archive keys and invalid or noncanonical tile coordinates before R2', async () => {
    for (const path of [
      '/maps/private.pmtiles', '/maps/other/0/0/0.mvt',
      '/maps/zagreb-v1/15/0/0.mvt', '/maps/zagreb-v1/3/8/0.mvt',
      '/maps/zagreb-v1/3/0/8.mvt', '/maps/zagreb-v1/03/0/0.mvt',
      '/maps/zagreb-v1/3/00/0.mvt', '/maps/zagreb-v1/3/0/-1.mvt',
    ]) expect((await call(path))?.status, path).toBe(404);
  });
  it('reports absent map storage as unavailable rather than an empty geographic result', async () => {
    const response = await call('/maps/zagreb-v1/13/4459/2920.mvt');
    expect(response?.status).toBe(503);
    expect(response?.headers.get('cache-control')).toBe('no-store');
    expect(await response?.json()).toEqual({ error: 'map-unavailable' });
  });
  it('serves same-origin glyph data with an explicit binary media type', async () => {
    const fetchAssets = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const response = await call('/maps/fonts/Noto%20Sans%20Regular/0-255.pbf', environment(fetchAssets));
    expect(fetchAssets).toHaveBeenCalledTimes(1);
    expect(response?.headers.get('content-type')).toBe('application/x-protobuf');
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});
