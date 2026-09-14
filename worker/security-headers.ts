// Security headers, one typed definition.
//
// HOW THEY ARE APPLIED. Static assets (everything under app/dist) never invoke
// the Worker: `run_worker_first` in wrangler.jsonc lists only /api/*, /ws/*,
// /hitno, /open, /open/*, /stats and /stats/*. Their headers come from
// `app/public/_headers`, which the asset layer applies without a Worker
// invocation; that file is hand-authored to equal APP_SECURITY_HEADERS and
// test/open/security-headers.test.ts fails when the two drift. Worker-generated
// responses get their set stamped in code: worker/routes/open.ts and
// worker/routes/stats.ts call withSecurityHeaders.
//
// THE APP POLICY (kiosk, scan page, dashboard):
//   script-src 'self'            no inline scripts, no eval. Theme init is an
//                                external module. INLINE_SCRIPT_HASHES exists for
//                                the day a hashed inline bootstrap is unavoidable:
//                                add `sha256-<base64>` computed with
//                                node -e "const c=require('crypto');process.stdout.write('sha256-'+c.createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('base64'))" script.js
//   style-src 'unsafe-inline'    MapLibre GL and theme.ts set style attributes.
//   img-src / connect-src TILE_HOST   raster tiles; MapLibre fetches tiles with
//                                fetch(), so both directives name the host.
//   worker-src 'self' blob:      MapLibre GL spawns its worker from a blob URL.
//   connect-src wss://zagreb.aningfilm.hr   the room and beacon sockets on the
//                                custom domain; 'self' already covers same-origin
//                                WebSockets in current browsers, the explicit
//                                entry is for older Safari.
//   Permissions-Policy camera=(self) for the in-app QR scanner, geolocation=(self)
//   for "departures at the nearest stop" (location stays on the phone).
//
// THE PAGE POLICY (/hitno, /open/): server-rendered, zero JS, one inline
// <style>, no fetch of any kind, so `default-src 'none'` holds.
// THE STATS POLICY adds noindex and no-store: the page sits behind Access.
// THE DATA POLICY (/open/*.json, .geojson): nothing executes, nothing frames.

export const TILE_HOST = 'https://tile.openstreetmap.org';
export const SOCKET_ORIGIN = 'wss://zagreb.aningfilm.hr';

/** `sha256-...` tokens for inline scripts the app cannot avoid. Empty by design. */
export const INLINE_SCRIPT_HASHES: readonly string[] = [];

const scriptSrc = ["'self'", ...INLINE_SCRIPT_HASHES.map((h) => `'${h}'`)].join(' ');

export const APP_CSP = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${TILE_HOST}`,
  `connect-src 'self' ${SOCKET_ORIGIN} ${TILE_HOST}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "font-src 'self'",
  "manifest-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const HSTS = 'max-age=31536000';
const REFERRER = 'strict-origin-when-cross-origin';

export const APP_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': APP_CSP,
  'Strict-Transport-Security': HSTS,
  'Referrer-Policy': REFERRER,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), browsing-topics=()',
};

const NONE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** /hitno and /open/ index: public, cacheable, zero-JS pages. */
export const PAGE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': NONE_CSP,
  'Strict-Transport-Security': HSTS,
  'Referrer-Policy': REFERRER,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=(), browsing-topics=()',
};

/** /open/*.json and .geojson. CORS is set by the route, not here. */
export const DATA_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': HSTS,
  'Referrer-Policy': REFERRER,
  'X-Content-Type-Options': 'nosniff',
};

/** /stats and every response under it, the fail-closed 404s included. */
export const STATS_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': NONE_CSP,
  'Strict-Transport-Security': HSTS,
  'Referrer-Policy': REFERRER,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex',
  'Cache-Control': 'no-store',
};

export function withSecurityHeaders(response: Response, headers: Readonly<Record<string, string>>): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) secured.headers.set(name, value);
  return secured;
}

/**
 * HTML is served as written: `no-transform` tells the edge not to rewrite it (Cloudflare
 * injects the Web Analytics beacon into HTML for the whole zone, and this page's CSP
 * forbids third-party scripts on purpose). Other directives stay; non-HTML is untouched.
 */
export function withoutEdgeTransforms(response: Response): Response {
  const type = response.headers.get('content-type') ?? '';
  if (!type.startsWith('text/html')) return response;
  const current = response.headers.get('cache-control') ?? '';
  if (current.split(',').some((d) => d.trim() === 'no-transform')) return response;
  const out = new Response(response.body, response);
  out.headers.set('cache-control', current ? `${current}, no-transform` : 'no-transform');
  return out;
}

/** Pages get the page set, everything else the data set. */
export function securityHeadersFor(response: Response): Readonly<Record<string, string>> {
  const type = response.headers.get('content-type') ?? '';
  return type.startsWith('text/html') ? PAGE_SECURITY_HEADERS : DATA_SECURITY_HEADERS;
}
