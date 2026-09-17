import { afterEach, describe, expect, it, vi } from 'vitest';
import { fulfillPublicMap } from '../../scripts/review-maps.mjs';

afterEach(() => vi.unstubAllGlobals());
describe('read-only public tile bridge', () => {
  it('does not inherit browser credentials or local network headers and returns decoded bytes', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'application/x-protobuf', 'content-encoding': 'gzip' },
    }));
    vi.stubGlobal('fetch', fetch);
    const fulfill = vi.fn();
    const route = { request: () => ({ url: () => 'http://127.0.0.1:5178/maps/zagreb-v1/13/1/1.mvt' }), fulfill };
    await fulfillPublicMap(route);
    expect(fetch).toHaveBeenCalledWith('https://zagreb.aningfilm.hr/maps/zagreb-v1/13/1/1.mvt', { signal: expect.any(AbortSignal) });
    expect(fulfill).toHaveBeenCalledWith({ status: 200, contentType: 'application/x-protobuf', body: Buffer.from([1, 2, 3]) });
  });
  it('refuses arbitrary origins and non-map paths', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const route = { request: () => ({ url: () => 'http://127.0.0.1:5178/api/data/zet-rt' }), fulfill: vi.fn() };
    await expect(fulfillPublicMap(route)).rejects.toThrow('Only public map assets');
    await expect(fulfillPublicMap(route, 'https://other.example')).rejects.toThrow('Unexpected map origin');
    expect(fetch).not.toHaveBeenCalled();
  });
});
