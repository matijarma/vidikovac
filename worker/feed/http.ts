import type { FetchContext } from './schema';

// Every upstream request in this project goes through upstreamFetch. Two global
// constraints live here and nowhere else: the identifying User-Agent (so a data
// owner can see who is calling and reach us) and the 6 s ceiling (a Worker
// request must never hang on a slow source).

export const USER_AGENT = 'Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)';
export const UPSTREAM_TIMEOUT_MS = 6000;

async function identifiedFetch(url: string, init: RequestInit, extraHeaders: Record<string, string>): Promise<Response> {
  const headers = new Headers(init.headers as HeadersInit | undefined);
  headers.set('user-agent', USER_AGENT);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  return fetch(url, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

export async function upstreamFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await identifiedFetch(url, init, {});
  // A module fetcher must throw on any upstream failure (worker/feed/schema.ts),
  // so the cache layer can fall back to the KV last-good copy.
  if (!response.ok) {
    throw new Error(`upstream ${response.status} ${response.statusText} for ${url}`);
  }
  return response;
}

/**
 * The conditional form the twin polls with (R-TE8): sends `If-None-Match`
 * when an ETag is known and lets a 304 through as the answer it is, so ten
 * seconds of nothing new costs the source a header, not a body. Same
 * User-Agent, same 6 s ceiling; every other non-2xx still throws.
 */
export async function upstreamFetchConditional(url: string, etag: string | null, init: RequestInit = {}): Promise<Response> {
  const response = await identifiedFetch(url, init, etag ? { 'if-none-match': etag } : {});
  if (!response.ok && response.status !== 304) {
    throw new Error(`upstream ${response.status} ${response.statusText} for ${url}`);
  }
  return response;
}

/** The only FetchContext modules ever see: identified, time-boxed, injectable
 *  clock, for the module the twin feeds the twin's payload (R-TE8), and, for
 *  the five modules with long texts, the one-line briefer (WP6). */
export function makeFetchContext(
  now: () => Date = () => new Date(),
  twin?: FetchContext['twin'],
  brief?: FetchContext['brief'],
): FetchContext {
  return {
    fetch: (url, init) => upstreamFetch(url, init),
    now,
    ...(twin ? { twin } : {}),
    ...(brief ? { brief } : {}),
  };
}
