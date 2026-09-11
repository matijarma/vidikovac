import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  APP_CSP,
  APP_SECURITY_HEADERS,
  DATA_SECURITY_HEADERS,
  PAGE_SECURITY_HEADERS,
  STATS_SECURITY_HEADERS,
  TILE_HOST,
} from '../../worker/security-headers';

/** Parses the Workers static-assets `_headers` format: a path rule line, then indented `Name: value` lines. */
function parseHeadersFile(text: string): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {};
  let current: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = raw.trim();
      rules[current] = {};
      continue;
    }
    if (current === null) throw new Error(`header line before any rule: ${raw}`);
    const idx = raw.indexOf(':');
    rules[current][raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
  }
  return rules;
}

describe('security header policy', () => {
  it('keeps the app CSP strict: no inline or eval scripts, tiles only from the chosen host', () => {
    expect(TILE_HOST).toBe('https://tile.openstreetmap.org');
    expect(APP_CSP).toContain("default-src 'self'");
    expect(APP_CSP).toContain("script-src 'self'");
    expect(APP_CSP).not.toContain("'unsafe-eval'");
    expect(APP_CSP).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(APP_CSP).toContain(`img-src 'self' data: blob: ${TILE_HOST}`);
    expect(APP_CSP).toContain(`connect-src 'self' wss://zagreb.aningfilm.hr ${TILE_HOST}`);
    expect(APP_CSP).toContain("worker-src 'self' blob:"); // MapLibre GL spawns its worker from a blob URL
    expect(APP_CSP).toContain("style-src 'self' 'unsafe-inline'"); // MapLibre and theme.ts set style attributes
    expect(APP_CSP).toContain("object-src 'none'");
    expect(APP_CSP).toContain("frame-ancestors 'none'");
    expect(APP_CSP).toContain("base-uri 'self'");
  });

  it('carries the companion hardening headers with camera and geolocation for this origin only', () => {
    expect(APP_SECURITY_HEADERS['Content-Security-Policy']).toBe(APP_CSP);
    expect(APP_SECURITY_HEADERS['Strict-Transport-Security']).toBe('max-age=31536000');
    expect(APP_SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(APP_SECURITY_HEADERS['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(APP_SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    expect(APP_SECURITY_HEADERS['Permissions-Policy']).toBe(
      'camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), browsing-topics=()',
    );
  });

  it('pins default-src none for the server-rendered pages and the stats page', () => {
    for (const set of [PAGE_SECURITY_HEADERS, STATS_SECURITY_HEADERS]) {
      expect(set['Content-Security-Policy']).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      );
      expect(set['X-Content-Type-Options']).toBe('nosniff');
      expect(set['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
      expect(set['Strict-Transport-Security']).toBe('max-age=31536000');
    }
    expect(PAGE_SECURITY_HEADERS['Permissions-Policy']).toBe(
      'camera=(), geolocation=(), microphone=(), payment=(), usb=(), browsing-topics=()',
    );
    expect(STATS_SECURITY_HEADERS['X-Robots-Tag']).toBe('noindex');
    expect(STATS_SECURITY_HEADERS['Cache-Control']).toBe('no-store');
    expect(PAGE_SECURITY_HEADERS['Cache-Control']).toBeUndefined(); // /hitno keeps its own s-maxage
  });

  it('keeps data responses framing-proof and sniff-proof without touching CORS', () => {
    expect(DATA_SECURITY_HEADERS['Content-Security-Policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(DATA_SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(DATA_SECURITY_HEADERS['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('app/public/_headers carries exactly APP_SECURITY_HEADERS under /*', () => {
    const file = readFileSync(fileURLToPath(new URL('../../app/public/_headers', import.meta.url)), 'utf8');
    const rules = parseHeadersFile(file);
    expect(Object.keys(rules)).toEqual(['/*']);
    expect(rules['/*']).toEqual(APP_SECURITY_HEADERS);
  });
});
