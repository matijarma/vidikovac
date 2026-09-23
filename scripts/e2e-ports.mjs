// The local test harness's ports, from one variable. E2E_PORT names the app
// server (the first Playwright webServer, `wrangler dev` with .dev.vars); the
// short-session server listens on the next port, and each server's devtools
// inspector keeps its old distance above the app port (9229 - 8787), so a
// second Playwright run from another checkout (`E2E_PORT=8797`) meets the
// first on no port. Unset or empty, every value is exactly the one the harness
// always used: 8787, 8788, inspectors 9229 and 9230.
// Local only: these are localhost origins. A hosted target still comes from
// E2E_APP_URL / E2E_SHORT_URL, which every caller reads first.

export const DEFAULT_E2E_PORT = 8787;
const INSPECTOR_OFFSET = 9229 - DEFAULT_E2E_PORT;

/** @typedef {{ app: number, short: number, appInspector: number, shortInspector: number }} E2EPorts */

/**
 * @param {number} app
 * @returns {E2EPorts}
 */
function derive(app) {
  return { app, short: app + 1, appInspector: app + INSPECTOR_OFFSET, shortInspector: app + 1 + INSPECTOR_OFFSET };
}

/** The four ports of the default run, which another run must never reuse. */
const DEFAULT_PORTS = Object.values(derive(DEFAULT_E2E_PORT));

/**
 * The harness's four ports for this environment.
 * @param {Record<string, string | undefined>} [env]
 * @returns {E2EPorts}
 */
export function e2ePorts(env = process.env) {
  const raw = (env.E2E_PORT ?? '').trim();
  if (raw === '') return derive(DEFAULT_E2E_PORT);
  const app = /^\d+$/.test(raw) ? Number(raw) : NaN;
  const ports = derive(app);
  if (!Number.isInteger(app) || app < 1024 || ports.shortInspector > 65535) {
    throw new Error(`E2E_PORT must be an integer from 1024 to ${65535 - 1 - INSPECTOR_OFFSET}, got "${raw}".`);
  }
  if (app !== DEFAULT_E2E_PORT) {
    const clash = Object.values(ports).find((port) => DEFAULT_PORTS.includes(port));
    if (clash !== undefined) throw new Error(`E2E_PORT=${app} puts a server on ${clash}, a port of the default run; step by 10 (8797, 8807, ...).`);
  }
  return ports;
}

/**
 * The origin of a harness port. Playwright and Lighthouse use localhost, the
 * review servers 127.0.0.1, as they always did.
 * @param {number} port
 * @param {'localhost' | '127.0.0.1'} [host]
 * @returns {string}
 */
export function localOrigin(port, host = 'localhost') {
  return `http://${host}:${port}`;
}
