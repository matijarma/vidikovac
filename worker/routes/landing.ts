// The landing page (/), with the captures of the reader's language. The static HTML names the Croatian
// screenshots, and landing/images.ts rewrites them to the page's locale once the script runs; by then the browser
// has already fetched the Croatian ones, so an English reader downloaded every capture twice (lane/v-lh P5:
// 115 to 140 kB per visit). The Worker sees only Accept-Language, and resolves it exactly as the page resolves
// navigator.languages without a stored choice (app/src/i18n/create-default-i18n.ts resolveInitialLocale; the
// parity is pinned in test/open/landing-locale.test.ts): an English browser now gets the English captures named
// in the HTML itself, one request each. A reader whose stored choice differs from the browser's languages is
// corrected by the page as before. The text stays as authored (the page translates it); only capture paths change.
import type { Env } from '../env';
import { landingLocale, localizeCaptureUrls } from '../../shared/landing-locale';

/** The validator of the English page: its own, so the Croatian page's never answers for it. */
const englishTag = (etag: string): string => etag.replace(/"$/, '-en"');

export async function handleLanding(request: Request, env: Env, _ctx: ExecutionContext, url: URL): Promise<Response | null> {
  if (url.pathname !== '/' || (request.method !== 'GET' && request.method !== 'HEAD')) return null;
  const locale = landingLocale(request.headers.get('accept-language'));
  if (locale === 'hr') {
    const response = await env.ASSETS.fetch(request);
    const out = new Response(response.body, response);
    out.headers.append('vary', 'Accept-Language');
    return out;
  }
  // The asset layer knows one page: a conditional request would be answered with the Croatian page's 304.
  const headers = new Headers(request.headers);
  headers.delete('if-none-match');
  headers.delete('if-modified-since');
  const response = await env.ASSETS.fetch(new Request(request, { headers }));
  if (!(response.headers.get('content-type') ?? '').startsWith('text/html')) return response;
  const rewrite = (attribute: 'src' | 'srcset') => ({
    element(element: Element) {
      const value = element.getAttribute(attribute);
      if (value !== null) element.setAttribute(attribute, localizeCaptureUrls(value, locale));
    },
  });
  const out = new HTMLRewriter()
    .on('picture[data-capture] source[srcset]', rewrite('srcset'))
    .on('picture[data-capture] img[src]', rewrite('src'))
    .on('picture[data-capture] img[srcset]', rewrite('srcset'))
    .transform(response);
  const localized = new Response(out.body, out);
  localized.headers.append('vary', 'Accept-Language');
  const etag = response.headers.get('etag');
  if (etag) localized.headers.set('etag', englishTag(etag));
  localized.headers.delete('content-length');
  return localized;
}
