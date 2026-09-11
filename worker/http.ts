// Shared HTTP helpers for every route module. Kept out of worker/index.ts so
// route files can import them without a circular import of the entry module.

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

/** Client address as Cloudflare reports it; empty string when absent (tests). */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? '';
}
