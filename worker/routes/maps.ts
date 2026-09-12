// R2Source and native decompression adapted from the BSD-3-Clause PMTiles
// Cloudflare adapter: github.com/protomaps/PMTiles/serverless/cloudflare.
// The archive is immutable and allowlisted; callers cannot address arbitrary R2 keys.
import { Compression, EtagMismatch, PMTiles, ResolvedValueCache, type RangeResponse, type Source } from 'pmtiles';
import type { RouteHandler } from '../index';
import { json } from '../http';
import { logError } from '../log';

export const MAP_VERSION = 'zagreb-v1';
export const MAP_ARCHIVE = `${MAP_VERSION}.pmtiles`;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const TILE = /^\/maps\/zagreb-v1\/(0|[1-9]\d?)\/(0|[1-9]\d{0,5})\/(0|[1-9]\d{0,5})\.mvt$/;

async function decompress(data: ArrayBuffer, compression: Compression): Promise<ArrayBuffer> {
  if (compression === Compression.None || compression === Compression.Unknown) return data;
  if (compression !== Compression.Gzip) throw new Error('unsupported-map-compression');
  return new Response(new Response(data).body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

const directoryCache = new ResolvedValueCache(32, undefined, decompress);

class R2Source implements Source {
  constructor(private bucket: R2Bucket, private ctx: ExecutionContext) {}
  getKey(): string { return `vidikovac-maps/${MAP_ARCHIVE}`; }
  async getBytes(offset: number, length: number, _signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    const key = new Request(`https://maps.vidikovac.internal/${MAP_VERSION}/range/${offset}/${length}`);
    const cached = offset > 0 ? await caches.default.match(key) : undefined;
    if (cached) {
      const cachedEtag = cached.headers.get('etag') ?? undefined;
      if (!etag || etag === cachedEtag) return { data: await cached.arrayBuffer(), etag: cachedEtag };
    }
    const result = await this.bucket.get(MAP_ARCHIVE, {
      range: { offset, length },
      ...(etag ? { onlyIf: { etagMatches: etag } } : {}),
    });
    if (!result) throw new Error('map-archive-unavailable');
    if (!('body' in result)) throw new EtagMismatch();
    const data = await result.arrayBuffer();
    // Archive header/directories survive isolate eviction without repeat R2 reads.
    if (offset > 0 && length <= 512_000) this.ctx.waitUntil(caches.default.put(key, new Response(data, {
      headers: { 'cache-control': IMMUTABLE, etag: result.etag },
    })));
    return { data, etag: result.etag };
  }
}

export const handleMaps: RouteHandler = async (request, env, ctx, url) => {
  if (!url.pathname.startsWith('/maps/')) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method-not-allowed' }, 405, { allow: 'GET, HEAD' });
  }
  // Glyphs and sprites are versioned with the app build, not proxy-fetched.
  if (/^\/maps\/(?:fonts|sprites)\//.test(url.pathname)) return env.ASSETS.fetch(request);
  const match = TILE.exec(url.pathname);
  if (!match) return json({ error: 'not-found' }, 404);
  const [z, x, y] = match.slice(1).map(Number);
  if (z > 14 || x >= 2 ** z || y >= 2 ** z) return json({ error: 'not-found' }, 404);
  if (!env.MAPS) return json({ error: 'map-unavailable' }, 503, { 'cache-control': 'no-store' });
  const cacheKey = new Request(`${url.origin}${url.pathname}`);
  const hit = await caches.default.match(cacheKey);
  if (hit) return new Response(request.method === 'HEAD' ? null : hit.body, { status: hit.status, headers: hit.headers });
  try {
    const archive = new PMTiles(new R2Source(env.MAPS, ctx), directoryCache, decompress);
    const tile = await archive.getZxy(z, x, y);
    const response = new Response(tile ? tile.data : null, {
      status: tile ? 200 : 204,
      headers: { 'content-type': 'application/vnd.mapbox-vector-tile', 'cache-control': IMMUTABLE, 'x-content-type-options': 'nosniff' },
    });
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
  } catch (error) {
    logError('map-tile-failed', error);
    return json({ error: 'map-unavailable' }, 503, { 'cache-control': 'no-store' });
  }
};
