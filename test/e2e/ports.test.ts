// One variable moves the whole local harness: E2E_PORT names the app server,
// the short-session server takes the next port and both devtools inspectors
// keep their old distance, so a second Playwright run on the host (from another
// checkout) meets the first on no port. Unset, every value and both webServer
// commands are byte for byte what the harness always ran.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaywrightTestConfig } from '@playwright/test';
import { DEFAULT_E2E_PORT, e2ePorts, localOrigin } from '../../scripts/e2e-ports.mjs';
import { localNetworkHeaders } from '../../scripts/local-network.mjs';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('e2ePorts', () => {
  it('defaults to the classic four ports when E2E_PORT is unset, empty or the default itself', () => {
    const classic = { app: 8787, short: 8788, appInspector: 9229, shortInspector: 9230 };
    expect(DEFAULT_E2E_PORT).toBe(8787);
    expect(e2ePorts({})).toEqual(classic);
    expect(e2ePorts({ E2E_PORT: '' })).toEqual(classic);
    expect(e2ePorts({ E2E_PORT: ' ' })).toEqual(classic);
    expect(e2ePorts({ E2E_PORT: '8787' })).toEqual(classic);
  });

  it('follows E2E_PORT: short on the next port, inspectors at the old offset, no port shared with the default run', () => {
    const second = e2ePorts({ E2E_PORT: '8797' });
    expect(second).toEqual({ app: 8797, short: 8798, appInspector: 9239, shortInspector: 9240 });
    expect(e2ePorts({ E2E_PORT: '8807' })).toEqual({ app: 8807, short: 8808, appInspector: 9249, shortInspector: 9250 });
    const all = [...Object.values(e2ePorts({})), ...Object.values(second)];
    expect(new Set(all).size).toBe(8);
  });

  it.each(['abc', '8797.5', '-8797', '0x2261', '80', '1023', '65535', '65094'])('refuses E2E_PORT=%s', (value) => {
    expect(() => e2ePorts({ E2E_PORT: value })).toThrow(/E2E_PORT must be an integer from 1024 to 65092/);
  });

  it.each(['8786', '8788', '8344', '8345', '8346', '9228', '9229', '9230'])('refuses E2E_PORT=%s, which lands on a port of the default run', (value) => {
    expect(() => e2ePorts({ E2E_PORT: value })).toThrow(/a port of the default run/);
  });

  it('keeps the harness local: the derived origins are localhost or 127.0.0.1 and get the synthetic local network', () => {
    const { app, short } = e2ePorts({ E2E_PORT: '8797' });
    expect(localOrigin(app)).toBe('http://localhost:8797');
    expect(localOrigin(short, '127.0.0.1')).toBe('http://127.0.0.1:8798');
    for (const origin of [localOrigin(app), localOrigin(short), localOrigin(app, '127.0.0.1')]) {
      expect(localNetworkHeaders(origin, 'scenario')['CF-Connecting-IP']).toMatch(/^2001:db8:/);
    }
  });
});

describe('playwright.config.ts', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** The real config, loaded under a local environment: no hosted target, managed servers. */
  async function config(port: string | undefined): Promise<{ baseURL: unknown; servers: { command: string; url?: string }[] }> {
    for (const name of ['E2E_APP_URL', 'E2E_SHORT_URL', 'E2E_NO_WEBSERVER']) vi.stubEnv(name, undefined);
    vi.stubEnv('E2E_PORT', port);
    vi.resetModules();
    const loaded = (await import('../../playwright.config')).default as PlaywrightTestConfig;
    const servers = loaded.webServer;
    expect(Array.isArray(servers)).toBe(true);
    return { baseURL: loaded.use?.baseURL, servers: servers as { command: string; url?: string }[] };
  }

  it('without E2E_PORT starts exactly the servers it always started', async () => {
    const { baseURL, servers } = await config(undefined);
    expect(baseURL).toBe('http://localhost:8787');
    expect(servers.map((s) => [s.command, s.url])).toEqual([
      ['npm run build && npm run dev -- --port 8787 --inspector-port 9229 --var APP_ENV:test', 'http://localhost:8787/api/health'],
      [
        'node scripts/require-app-build.mjs && npx wrangler dev --port 8788 --inspector-port 9230 --var APP_ENV:test --var SESSION_MINUTES:0.2 --persist-to .wrangler/state-e2e-short',
        'http://localhost:8788/api/health',
      ],
    ]);
  });

  it('with E2E_PORT=8797 moves both servers, both inspectors and the base URL', async () => {
    const { baseURL, servers } = await config('8797');
    expect(baseURL).toBe('http://localhost:8797');
    expect(servers.map((s) => [s.command, s.url])).toEqual([
      ['npm run build && npm run dev -- --port 8797 --inspector-port 9239 --var APP_ENV:test', 'http://localhost:8797/api/health'],
      [
        'node scripts/require-app-build.mjs && npx wrangler dev --port 8798 --inspector-port 9240 --var APP_ENV:test --var SESSION_MINUTES:0.2 --persist-to .wrangler/state-e2e-short',
        'http://localhost:8798/api/health',
      ],
    ]);
  });
});

describe('no harness file carries a port of its own', () => {
  // Every local-harness origin derives from scripts/e2e-ports.mjs; a literal
  // here would pin one run to the default ports again.
  it.each([
    'playwright.config.ts',
    'e2e/helpers.ts',
    'scripts/integration-server.mjs',
    'scripts/review-server.mjs',
    'scripts/review-experience.mjs',
    'scripts/require-app-build.mjs',
    'scripts/lighthouse-a11y.mjs',
  ])('%s', (file) => {
    const source = read(file);
    expect(source).not.toMatch(/\b(?:8787|8788|9229|9230)\b/);
    expect(source).toContain('e2e-ports.mjs');
  });
});
