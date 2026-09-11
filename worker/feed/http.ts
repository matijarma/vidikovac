import type { FetchContext } from './schema';

// Every upstream request in this project goes through upstreamFetch. Two global
// constraints live here and nowhere else: the identifying User-Agent (so a data
// owner can see who is calling and reach us) and the 6 s ceiling (a Worker
// request must never hang on a slow source).

export const USER_AGENT = 'Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)';
export const UPSTREAM_TIMEOUT_MS = 6000;

export async function upstreamFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers as HeadersInit | undefined);
  headers.set('user-agent', USER_AGENT);
  const response = await fetch(url, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  // A module fetcher must throw on any upstream failure (worker/feed/schema.ts),
  // so the cache layer can fall back to the KV last-good copy.
  if (!response.ok) {
    throw new Error(`upstream ${response.status} ${response.statusText} for ${url}`);
  }
  return response;
}

/** The only FetchContext modules ever see: identified, time-boxed, injectable clock. */
export function makeFetchContext(now: () => Date = () => new Date()): FetchContext {
  return { fetch: (url, init) => upstreamFetch(url, init), now };
}
