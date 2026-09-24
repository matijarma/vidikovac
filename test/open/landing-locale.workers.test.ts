// The landing page through the Worker (worker/routes/landing.ts): the static HTML names the Croatian captures; a
// browser that reads English gets the same page with the English captures named instead, so each screenshot is
// downloaded once (lane/v-perf). The text stays as authored (the page translates it itself); the response says it
// varies by Accept-Language and never shares a validator with the Croatian page.
import { describe, expect, it, vi } from 'vitest';
import { handleLanding } from '../../worker/routes/landing';
import type { Env } from '../../worker/env';

const HTML = `<!doctype html><html lang="hr"><head><title>Kaj ima?</title></head><body>
<picture data-capture="kiosk"><source media="(prefers-color-scheme: dark)" srcset="/landing/kiosk-hr-dark-720.webp 720w, /landing/kiosk-hr-dark-1280.webp 1280w" sizes="94vw"><img src="/landing/kiosk-hr-light-1280.webp" srcset="/landing/kiosk-hr-light-720.webp 720w, /landing/kiosk-hr-light-1280.webp 1280w" alt="Javni zaslon"></picture>
<picture data-capture="phone"><source media="(prefers-color-scheme: dark)" srcset="/landing/phone-hr-dark-390.webp"><img src="/landing/phone-hr-light-390.webp" loading="lazy" alt="Telefon"></picture>
<img src="/landing/share-hr-light-1.webp" alt="not a capture">
<p>Manje zaslona. Više grada.</p></body></html>`;

const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
function env(seen: Request[] = []): Env {
  return { ASSETS: { fetch: vi.fn(async (request: Request) => {
    seen.push(request);
    return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8', etag: '"abc123"', 'cache-control': 'public, max-age=0, must-revalidate' } });
  }) } } as unknown as Env;
}
const call = (path: string, headers: Record<string, string> = {}, e = env(), method = 'GET') => {
  const url = new URL(path, 'https://zagreb.aningfilm.hr');
  return handleLanding(new Request(url, { method, headers }), e, ctx, url);
};

describe('the landing names the captures of the reader\'s language', () => {
  it('English: every capture candidate in every picture is the English one; the text and other images are untouched', async () => {
    const response = await call('/', { 'accept-language': 'en-GB,en;q=0.9' });
    expect(response?.status).toBe(200);
    const html = await response!.text();
    const pictures = html.match(/<picture[\s\S]*?<\/picture>/g) ?? [];
    expect(pictures).toHaveLength(2);
    for (const picture of pictures) expect(picture).not.toMatch(/\/landing\/[a-z]+-hr-/);
    expect(html).toContain('srcset="/landing/kiosk-en-dark-720.webp 720w, /landing/kiosk-en-dark-1280.webp 1280w"');
    expect(html).toContain('src="/landing/kiosk-en-light-1280.webp"');
    expect(html).toContain('srcset="/landing/kiosk-en-light-720.webp 720w, /landing/kiosk-en-light-1280.webp 1280w"');
    expect(html).toContain('src="/landing/phone-en-light-390.webp" loading="lazy"');
    expect(html).toContain('src="/landing/share-hr-light-1.webp"');
    expect(html).toContain('<p>Manje zaslona. Više grada.</p>');
    expect(html).toContain('lang="hr"');
  });

  it('English has its own validator and says the page varies by language; Croatian is the asset as it is', async () => {
    const en = await call('/', { 'accept-language': 'en' });
    expect(en?.headers.get('vary')).toMatch(/accept-language/i);
    expect(en?.headers.get('etag')).toBe('"abc123-en"');
    const hr = await call('/', { 'accept-language': 'hr-HR,hr;q=0.9' });
    expect(hr?.headers.get('vary')).toMatch(/accept-language/i);
    expect(hr?.headers.get('etag')).toBe('"abc123"');
    expect(await hr!.text()).toBe(HTML);
  });

  it('never lets the asset layer answer an English request with the Croatian page\'s 304', async () => {
    const seen: Request[] = [];
    await call('/', { 'accept-language': 'en', 'if-none-match': '"abc123"' }, env(seen));
    expect(seen[0]!.headers.get('if-none-match')).toBeNull();
  });

  it('only the landing page, only GET and HEAD', async () => {
    expect(await call('/kiosk/', { 'accept-language': 'en' })).toBeNull();
    expect(await call('/index.html', { 'accept-language': 'en' })).toBeNull();
    expect(await call('/', { 'accept-language': 'en' }, env(), 'POST')).toBeNull();
    const head = await call('/', { 'accept-language': 'en' }, env(), 'HEAD');
    expect(head?.status).toBe(200);
  });
});
