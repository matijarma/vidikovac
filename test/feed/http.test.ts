import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPSTREAM_TIMEOUT_MS, USER_AGENT, makeFetchContext, upstreamFetch } from '../../worker/feed/http';

describe('upstreamFetch', () => {
  const original = globalThis.fetch;
  let seen: { url: string; init: RequestInit }[];

  beforeEach(() => {
    seen = [];
    globalThis.fetch = vi.fn(async (input: unknown, init: RequestInit = {}) => {
      seen.push({ url: String(input), init });
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = original;
  });

  it('identifies the project on every request', async () => {
    await upstreamFetch('https://example.test/a.json');
    const headers = new Headers(seen[0].init.headers);
    expect(headers.get('user-agent')).toBe('Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)');
    expect(USER_AGENT).toBe('Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)');
  });

  it('keeps caller headers, method and body and adds a 6 s abort signal', async () => {
    await upstreamFetch('https://example.test/post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    });
    expect(UPSTREAM_TIMEOUT_MS).toBe(6000);
    expect(seen[0].init.method).toBe('POST');
    expect(seen[0].init.body).toBe('{"a":1}');
    const headers = new Headers(seen[0].init.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('user-agent')).toBe(USER_AGENT);
    expect(seen[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(seen[0].init.signal?.aborted).toBe(false);
  });

  it('throws on a non-2xx answer so the cache layer can fall back', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    await expect(upstreamFetch('https://example.test/down')).rejects.toThrow(/503/);
  });

  it('makeFetchContext carries the injected clock', async () => {
    const fixed = new Date('2026-09-11T10:00:00.000Z');
    const ctx = makeFetchContext(() => fixed);
    expect(ctx.now()).toBe(fixed);
    await ctx.fetch('https://example.test/b.json');
    expect(new Headers(seen[0].init.headers).get('user-agent')).toBe(USER_AGENT);
    expect(makeFetchContext().now()).toBeInstanceOf(Date);
  });
});
