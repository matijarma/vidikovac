import { SELF, createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { SNIMKA_API } from '../../shared/snimka';
import type { Env } from '../../worker/env';
import { SNIMKA_R2_PREFIX, handleSnimka, snimkaObjectPath } from '../../worker/routes/snimka';
import { DATA_SECURITY_HEADERS } from '../../worker/security-headers';

const testEnv = env as unknown as Env;

const MANIFEST = JSON.stringify({ version: 1, title: 'Tri dana bez tramvaja' });
const CHUNK_PATH = 'motion/396-20260928-0745.0123456789abcdef.json';
const CHUNK = JSON.stringify({ v: 1, net: '396', t0: 1790574300, step: 10, n: 60, vehicles: [] });
const IMAGE_PATH = 'captures/kiosk-0745.fedcba9876543210.webp';
// "RIFF", a length, "WEBP": enough bytes to be an image to anything that looks at the first twelve.
const IMAGE = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

const allow = { limit: async () => ({ success: true }) } as unknown as Env['RL_OPEN'];
const deny = { limit: async () => ({ success: false }) } as unknown as Env['RL_OPEN'];

/** Isolated storage rolls the bucket back after every test, so each one seeds its own. */
async function seed(): Promise<void> {
  const bucket = testEnv.RECORDINGS!;
  await bucket.put(SNIMKA_R2_PREFIX + 'manifest.json', MANIFEST);
  await bucket.put(SNIMKA_R2_PREFIX + CHUNK_PATH, CHUNK);
  await bucket.put(SNIMKA_R2_PREFIX + IMAGE_PATH, IMAGE);
  // Neighbours of the prefix that the route must never reach.
  await bucket.put('archive/strike-2026-09/private/secret.json', '{"secret":true}');
  await bucket.put('zet-rt/2026/09/28/055000-1790574600.pb', 'raw frame');
  await bucket.put(SNIMKA_R2_PREFIX + 'frames/000000-1790574600.pb', 'raw frame under the prefix');
}

interface Counters {
  limiter: number;
  gets: number;
  heads: number;
}

/** A bucket that counts what the route asks of it. */
function counting(counters: Counters, over: Partial<R2Bucket> = {}): R2Bucket {
  const real = testEnv.RECORDINGS!;
  return {
    get: (key: string) => {
      counters.gets += 1;
      return real.get(key);
    },
    head: (key: string) => {
      counters.heads += 1;
      return real.head(key);
    },
    ...over,
  } as unknown as R2Bucket;
}

interface Called {
  response: Response | null;
  counters: Counters;
}

async function call(
  host: string,
  path: string,
  options: { method?: string; limiter?: Env['RL_OPEN']; counters?: Counters; bucket?: R2Bucket | null } = {},
): Promise<Called> {
  const counters = options.counters ?? { limiter: 0, gets: 0, heads: 0 };
  const base = options.limiter ?? allow;
  const limiter = {
    limit: async (args: { key: string }) => {
      counters.limiter += 1;
      return base.limit(args);
    },
  } as unknown as Env['RL_OPEN'];
  const request = new Request(`https://${host}${path}`, { method: options.method ?? 'GET' });
  const ctx = createExecutionContext();
  const bucket = options.bucket === undefined ? counting(counters) : options.bucket;
  const response = await handleSnimka(request, { ...testEnv, RL_OPEN: limiter } as Env, ctx, new URL(request.url), {
    bucket: () => bucket ?? undefined,
  });
  await waitOnExecutionContext(ctx);
  return { response, counters };
}

function expectDataHeaders(response: Response): void {
  for (const [name, value] of Object.entries(DATA_SECURITY_HEADERS)) expect(response.headers.get(name), name).toBe(value);
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
}

beforeEach(seed);

describe('snimkaObjectPath', () => {
  it('maps a dataset path under the public prefix and nowhere else', () => {
    expect(SNIMKA_R2_PREFIX).toBe('archive/strike-2026-09/public/v1/');
    expect(snimkaObjectPath('manifest.json')).toBe(`${SNIMKA_R2_PREFIX}manifest.json`);
    expect(snimkaObjectPath(CHUNK_PATH)).toBe(`${SNIMKA_R2_PREFIX}${CHUNK_PATH}`);
    expect(snimkaObjectPath(IMAGE_PATH)).toBe(`${SNIMKA_R2_PREFIX}${IMAGE_PATH}`);
    expect(snimkaObjectPath('a/b/c/d.json')).not.toBeNull();
  });

  it.each([
    ['', 'empty'],
    ['/', 'a lone slash'],
    ['/manifest.json', 'a leading slash'],
    ['manifest.json/', 'a trailing slash'],
    ['a//b.json', 'an empty segment'],
    ['../manifest.json', 'dot dot first'],
    ['a/../manifest.json', 'dot dot inside'],
    ['a..b.json', 'dot dot inside a name'],
    ['./manifest.json', 'a dot segment'],
    ['.hidden.json', 'a name starting with a dot'],
    ['Manifest.json', 'upper case'],
    ['a/B.json', 'upper case in a later segment'],
    ['manifest.JSON', 'upper case extension'],
    ['frames/000000-1790574600.pb', 'a raw frame'],
    ['manifest', 'no extension'],
    ['manifest.json.gz', 'another extension'],
    ['manifest.png', 'an image type we do not store'],
    ['a/b/c/d/e.json', 'five segments'],
    ['a%2fb.json', 'an escaped slash'],
    ['a%2e%2e%2fb.json', 'an escaped dot dot'],
    ['a\\b.json', 'a backslash'],
    ['a b.json', 'a space'],
    ['ž.json', 'a non-ASCII letter'],
    [`${'a'.repeat(156)}.json`, 'one past the length limit'],
  ])('refuses %j (%s)', (rest) => {
    expect(snimkaObjectPath(rest)).toBeNull();
  });

  it('accepts exactly 160 characters', () => {
    expect(snimkaObjectPath(`${'a'.repeat(155)}.json`)).not.toBeNull();
    expect(snimkaObjectPath(`${'a'.repeat(155)}.json`)!.length).toBe(SNIMKA_R2_PREFIX.length + 160);
  });
});

describe('/api/snimka/v1/', () => {
  it('serves the manifest unchanged, cached a minute in the browser and five at the edge', async () => {
    const { response } = await call('sn-manifest.test', `${SNIMKA_API}manifest.json`);
    expect(response!.status).toBe(200);
    expect(response!.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response!.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
    expect(response!.headers.get('etag')).toBeTruthy();
    expectDataHeaders(response!);
    expect(await response!.text()).toBe(MANIFEST);
  });

  it('serves a hashed chunk as immutable JSON', async () => {
    const { response } = await call('sn-chunk.test', `${SNIMKA_API}${CHUNK_PATH}`);
    expect(response!.status).toBe(200);
    expect(response!.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response!.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response!.headers.get('etag')).toBeTruthy();
    expectDataHeaders(response!);
    expect(await response!.text()).toBe(CHUNK);
  });

  it('serves a hashed WebP as an immutable image, byte for byte', async () => {
    const { response } = await call('sn-image.test', `${SNIMKA_API}${IMAGE_PATH}`);
    expect(response!.status).toBe(200);
    expect(response!.headers.get('content-type')).toBe('image/webp');
    expect(response!.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expectDataHeaders(response!);
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(IMAGE);
  });

  it('never marks an object whose name carries no hash as immutable', async () => {
    await testEnv.RECORDINGS!.put(`${SNIMKA_R2_PREFIX}notes.json`, '{}');
    const { response } = await call('sn-unhashed.test', `${SNIMKA_API}notes.json`);
    expect(response!.status).toBe(200);
    expect(response!.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
  });

  it('ignores a query string: one path, one cache entry', async () => {
    const first = await call('sn-query.test', `${SNIMKA_API}${CHUNK_PATH}?bust=1`);
    expect(first.response!.status).toBe(200);
    const second = await call('sn-query.test', `${SNIMKA_API}${CHUNK_PATH}?bust=2`);
    expect(second.response!.status).toBe(200);
    expect(second.counters.gets).toBe(0);
  });

  it('answers HEAD with the headers and no body, from storage and from the cache', async () => {
    const miss = await call('sn-head.test', `${SNIMKA_API}${CHUNK_PATH}`, { method: 'HEAD' });
    expect(miss.response!.status).toBe(200);
    expect(await miss.response!.text()).toBe('');
    expect(miss.response!.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(miss.response!.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(miss.response!.headers.get('content-length')).toBe(String(CHUNK.length));
    expectDataHeaders(miss.response!);
    expect(miss.counters).toEqual({ limiter: 1, gets: 0, heads: 1 });

    // A GET fills the cache; a later HEAD is answered from it with no body.
    await (await call('sn-head.test', `${SNIMKA_API}${CHUNK_PATH}`)).response!.arrayBuffer();
    const hit = await call('sn-head.test', `${SNIMKA_API}${CHUNK_PATH}`, { method: 'HEAD', limiter: deny });
    expect(hit.response!.status).toBe(200);
    expect(await hit.response!.text()).toBe('');
    expect(hit.counters).toEqual({ limiter: 0, gets: 0, heads: 0 });

    const absent = await call('sn-head.test', `${SNIMKA_API}nothing.0123456789abcdef.json`, { method: 'HEAD' });
    expect(absent.response!.status).toBe(404);
    expect(await absent.response!.text()).toBe('');
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses %s with 405 and Allow, before touching anything', async (method) => {
    const { response, counters } = await call('sn-method.test', `${SNIMKA_API}manifest.json`, { method });
    expect(response!.status).toBe(405);
    expect(response!.headers.get('allow')).toBe('GET, HEAD');
    expect(response!.headers.get('cache-control')).toBe('no-store');
    expectDataHeaders(response!);
    expect(counters).toEqual({ limiter: 0, gets: 0, heads: 0 });
  });

  it('answers 404 JSON for an object that is not there, and never caches the answer', async () => {
    const path = `${SNIMKA_API}series.aaaaaaaaaaaaaaaa.json`;
    const missing = await call('sn-missing.test', path);
    expect(missing.response!.status).toBe(404);
    expect(missing.response!.headers.get('content-type')).toContain('application/json');
    expect(missing.response!.headers.get('cache-control')).toBe('no-store');
    expect(await missing.response!.json()).toEqual({ error: 'not-found' });
    expectDataHeaders(missing.response!);

    // The dataset lands later: the same URL now answers, so the 404 was not kept.
    await testEnv.RECORDINGS!.put(`${SNIMKA_R2_PREFIX}series.aaaaaaaaaaaaaaaa.json`, '{"v":1}');
    const found = await call('sn-missing.test', path);
    expect(found.response!.status).toBe(200);
    expect(await found.response!.text()).toBe('{"v":1}');
  });

  it.each([
    ['an upper-case name', 'Manifest.json'],
    ['a raw frame under the prefix', 'frames/000000-1790574600.pb'],
    ['an encoded slash and dot dot', '..%2fprivate%2fsecret.json'],
    ['a dot dot inside a name', 'a..b.json'],
    ['five segments', 'a/b/c/d/e.json'],
    ['an unknown extension', 'manifest.txt'],
    ['no extension', 'manifest'],
    ['an empty path', ''],
    ['a trailing slash', 'motion/'],
    ['too long', `${'a'.repeat(160)}.json`],
  ])('answers 404 for %s without touching storage or the budget', async (_label, rest) => {
    const { response, counters } = await call('sn-bad.test', `${SNIMKA_API}${rest}`);
    expect(response!.status).toBe(404);
    expect(response!.headers.get('cache-control')).toBe('no-store');
    expectDataHeaders(response!);
    expect(counters).toEqual({ limiter: 0, gets: 0, heads: 0 });
  });

  it('answers 404 for a valid name that sits outside the prefix, which it cannot reach', async () => {
    // The key exists at archive/strike-2026-09/private/secret.json; the route only ever adds its own prefix.
    for (const rest of ['private/secret.json', 'zet-rt/2026/09/28/055000-1790574600.json']) {
      const { response } = await call('sn-outside.test', `${SNIMKA_API}${rest}`);
      expect(response!.status, rest).toBe(404);
    }
    // A dot-dot segment is folded by the URL parser before the route sees it, so it lands outside the route altogether.
    const folded = new URL(`https://sn-outside.test${SNIMKA_API}../private/secret.json`);
    expect(folded.pathname).toBe('/api/snimka/private/secret.json');
    const ctx = createExecutionContext();
    expect(await handleSnimka(new Request(folded), testEnv, ctx, folded)).toBeNull();
  });

  it('declines every path that is not under /api/snimka/v1/', async () => {
    for (const path of ['/api/snimka/v2/manifest.json', '/api/snimka/manifest.json', '/api/snimka/v1', '/api/snimka', '/snimka/', '/api/statistika']) {
      const { response } = await call('sn-decline.test', path);
      expect(response, path).toBeNull();
    }
  });

  it('answers 503 without the bucket binding, never cached, and 429 only when the budget is spent', async () => {
    const none = await call('sn-503.test', `${SNIMKA_API}manifest.json`, { bucket: null });
    expect(none.response!.status).toBe(503);
    expect(none.response!.headers.get('cache-control')).toBe('no-store');
    expect(none.response!.headers.get('retry-after')).toBe('60');
    expectDataHeaders(none.response!);
    // The default seam reads env.RECORDINGS, which this env leaves out.
    const request = new Request(`https://sn-503.test${SNIMKA_API}manifest.json`);
    const ctx = createExecutionContext();
    const bare = await handleSnimka(request, { ...testEnv, RECORDINGS: undefined, RL_OPEN: allow } as Env, ctx, new URL(request.url));
    expect(bare!.status).toBe(503);
  });

  it('answers 503 when storage throws, and does not cache that either', async () => {
    const broken = counting({ limiter: 0, gets: 0, heads: 0 }, {
      get: (async () => {
        throw new Error('r2 is having a moment');
      }) as unknown as R2Bucket['get'],
    });
    const failed = await call('sn-throw.test', `${SNIMKA_API}manifest.json`, { bucket: broken });
    expect(failed.response!.status).toBe(503);
    expect(failed.response!.headers.get('cache-control')).toBe('no-store');
    const later = await call('sn-throw.test', `${SNIMKA_API}manifest.json`);
    expect(later.response!.status).toBe(200);
  });

  it('answers 429 with Retry-After on a miss when the per-IP budget is spent, and reads nothing', async () => {
    const { response, counters } = await call('sn-429.test', `${SNIMKA_API}manifest.json`, { limiter: deny });
    expect(response!.status).toBe(429);
    expect(response!.headers.get('retry-after')).toBe('60');
    expect(response!.headers.get('cache-control')).toBe('no-store');
    expectDataHeaders(response!);
    expect(counters).toEqual({ limiter: 1, gets: 0, heads: 0 });

    const head = await call('sn-429.test', `${SNIMKA_API}manifest.json`, { method: 'HEAD', limiter: deny });
    expect(head.response!.status).toBe(429);
    expect(await head.response!.text()).toBe('');
  });

  it('serves a cached hit without spending the rate limit or reading storage', async () => {
    const path = `${SNIMKA_API}${CHUNK_PATH}`;
    const first = await call('sn-hit.test', path);
    expect(first.response!.status).toBe(200);
    expect(await first.response!.text()).toBe(CHUNK);
    expect(first.counters).toEqual({ limiter: 1, gets: 1, heads: 0 });

    const counters: Counters = { limiter: 0, gets: 0, heads: 0 };
    for (let i = 0; i < 3; i += 1) {
      // With the budget spent and the bucket gone, only the cache can answer.
      const hit = await call('sn-hit.test', path, { limiter: deny, counters, bucket: null });
      expect(hit.response!.status).toBe(200);
      expect(hit.response!.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expectDataHeaders(hit.response!);
      expect(await hit.response!.text()).toBe(CHUNK);
    }
    expect(counters).toEqual({ limiter: 0, gets: 0, heads: 0 });
  });

  it('serves the manifest through the whole Worker', async () => {
    const response = await SELF.fetch(`https://sn-self.test${SNIMKA_API}manifest.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
    expectDataHeaders(response);
    expect(await response.json()).toEqual(JSON.parse(MANIFEST));

    const missing = await SELF.fetch(`https://sn-self.test${SNIMKA_API}series.bbbbbbbbbbbbbbbb.json`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not-found' });
  });
});
