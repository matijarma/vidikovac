// A happy-dom test page lives at happy-dom's default URL, http://localhost:3000, where nothing listens. App code
// that fetches a relative path (the board cache's /api/city/departures, say) used to open a real TCP connection
// there: every `npm test` printed dozens of "connect ECONNREFUSED 127.0.0.1:3000" stacks, which read like a port
// clash between worktrees (24 Sep 22:44) although no test binds that port. Here a request to the page's own origin
// fails at once, as that connection did (a TypeError, "Failed to fetch"), without touching the network. Other
// origins, and every test that stubs fetch itself, are left alone. Node-environment files are untouched.
if (typeof window !== 'undefined' && typeof location !== 'undefined' && typeof globalThis.fetch === 'function') {
  const real = globalThis.fetch.bind(globalThis);
  const own = location.origin;
  const urlOf = (input: RequestInfo | URL): URL | null => {
    try {
      return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    } catch {
      return null;
    }
  };
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (url && url.origin === own) return Promise.reject(new TypeError(`Failed to fetch ${url.pathname}: the test page's origin ${own} has no server (test/setup/dom-offline.ts)`));
    return real(input, init);
  }) as typeof globalThis.fetch;
}
