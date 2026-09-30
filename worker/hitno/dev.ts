// DEV mode on /hitno (worker/routes/dev.ts describes DEV). The page is edge-cached as it is for
// everyone; a request with ?DEV gets that same page with the chip written into it on the way out,
// so no DEV copy is ever cached and the counter is left alone (route.ts). Still zero JavaScript:
// the chip's menu is a <details> and its × a plain link back to /hitno. Framed by the /dev/ grid
// (Sec-Fetch-Dest: iframe), the page is marked DEV but draws no chip, as the scripted pages do.
import hr from '../../app/src/i18n/hr.json' with { type: 'json' };
import { DEV_CHIP_CSS, devChipMarkup } from '../../shared/dev-chip';

/** The bare DEV key in the query (app/src/core/dev-mode.ts hasDevFlag, the same rule). */
export function isDevRequest(url: URL): boolean {
  return url.searchParams.has('DEV');
}

/** The rendered page as DEV shows it: <html data-dev>, and unless framed the chip's style and the chip itself. */
export function withDevChip(response: Response, request: Request): Response {
  const framed = request.headers.get('sec-fetch-dest') === 'iframe';
  let rewriter = new HTMLRewriter().on('html', {
    element(element) {
      element.setAttribute('data-dev', '1');
      element.setAttribute('data-page', 'hitno');
      if (!framed) element.setAttribute('data-dev-chip', '1');
    },
  });
  if (!framed) {
    rewriter = rewriter
      .on('head', { element(element) { element.append(`<style>${DEV_CHIP_CSS}</style>`, { html: true }); } })
      .on('body', { element(element) { element.prepend(devChipMarkup(hr.dev, { current: 'hitno', offHref: '/hitno' }), { html: true }); } });
  }
  const out = rewriter.transform(response);
  const headers = new Headers(out.headers);
  headers.set('cache-control', 'private, no-store');
  headers.delete('content-length');
  return new Response(out.body, { status: out.status, headers });
}
