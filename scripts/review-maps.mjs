// Read-only tile bridge for local browser evidence. Use a separate fetch,
// never the browser context's API client: route.fetch inherits that context's
// default headers even when a per-request header is omitted.
export async function fulfillPublicMap(route, origin = 'https://zagreb.aningfilm.hr') {
  if (origin !== 'https://zagreb.aningfilm.hr') throw new Error('Unexpected map origin.');
  const url = new URL(route.request().url());
  if (!url.pathname.startsWith('/maps/')) throw new Error('Only public map assets may be bridged.');
  const response = await fetch(`${origin}${url.pathname}`, { signal: AbortSignal.timeout(20_000) });
  await route.fulfill({
    status: response.status,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    // Fetch already decodes content-encoding. Do not forward compressed-body
    // headers, browser credentials or synthetic local network headers.
    body: Buffer.from(await response.arrayBuffer()),
  });
}
