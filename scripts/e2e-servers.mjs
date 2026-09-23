#!/usr/bin/env node
// The two local servers of the Playwright harness, started by hand one after
// the other (the way the accept and e2e runs on this host start them):
//
//   node scripts/e2e-servers.mjs start    app server, then the short-session server
//   node scripts/e2e-servers.mjs status   what the state file says, and whether each answers
//   node scripts/e2e-servers.mjs stop     both process groups, by the pids the start wrote
//
// Why one after the other. wrangler.jsonc gives `wrangler dev` a custom build
// (`npm run build`), so every server rebuilds app/dist when it starts. Two
// servers started a few seconds apart ran two `vite build`s into the same
// app/dist at once, and the app server then answered GET /kiosk/ with 404 while
// /api/health said 200 (D2-e2e full re-run, 23 September: the first wall scene
// never painted its invitation). So the short server starts only once the app
// server serves the wall page itself, and the app server is read again after
// the second build, before anything is run against either.
//
// Both run `wrangler dev --local`: without it wrangler 4 opens a remote proxy
// session for the AI binding and stops without a Cloudflare login. Ports come
// from E2E_PORT (scripts/e2e-ports.mjs), exactly as playwright.config.ts
// derives them, so Playwright's `reuseExistingServer` picks these servers up.
// Local only: nothing here reads E2E_APP_URL or talks to a hosted target.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { e2ePorts, localOrigin } from './e2e-ports.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Where `start` records the process groups for `stop` (.wrangler/ is gitignored). */
export const STATE_FILE = '.wrangler/e2e-servers.json';
/** A server is ready when each of these answers 200: the Worker, and the wall page from the built assets. */
export const READY_PATHS = Object.freeze(['/api/health', '/kiosk/']);
/** A cold start is one `npm run build` plus workerd: about 30 s here, far more on a loaded host. */
export const READY_TIMEOUT_MS = 300_000;
export const POLL_MS = 1_000;

/**
 * @typedef {{ name: 'app' | 'short', port: number, args: string[] }} ServerCommand
 * @typedef {{ name: string, port: number, pid: number, log?: string }} StartedServer
 */

/**
 * The two servers, in start order: the app server (.dev.vars, SESSION_MINUTES 10) and the short-session
 * server (SESSION_MINUTES 0.2, its own Durable Object store), as playwright.config.ts's webServer entries.
 * @param {import('./e2e-ports.mjs').E2EPorts} ports
 * @returns {ServerCommand[]}
 */
export function serverCommands(ports) {
  return [
    { name: 'app', port: ports.app, args: ['wrangler', 'dev', '--local', '--port', String(ports.app), '--inspector-port', String(ports.appInspector), '--var', 'APP_ENV:test'] },
    {
      name: 'short', port: ports.short,
      args: ['wrangler', 'dev', '--local', '--port', String(ports.short), '--inspector-port', String(ports.shortInspector), '--var', 'APP_ENV:test', '--var', 'SESSION_MINUTES:0.2', '--persist-to', '.wrangler/state-e2e-short'],
    },
  ];
}

/**
 * Wait until every READY_PATHS answers 200 at `origin`. A 404 on /kiosk/ with a healthy Worker is not ready:
 * that is the half-built app/dist of two overlapping builds.
 * @param {string} origin
 * @param {{ fetchImpl?: (url: string) => Promise<{ status: number }>, sleep?: (ms: number) => Promise<void>, now?: () => number, timeoutMs?: number }} [deps]
 * @returns {Promise<void>}
 */
export async function waitReady(origin, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? ((url) => fetch(url, { redirect: 'manual' }));
  const sleep = deps.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? READY_TIMEOUT_MS;
  const end = now() + timeoutMs;
  /** @type {Record<string, number | string>} */
  let last = {};
  for (;;) {
    last = {};
    for (const path of READY_PATHS) {
      try { last[path] = (await fetchImpl(`${origin}${path}`)).status; } catch (error) { last[path] = String(error instanceof Error ? error.message : error); }
    }
    if (READY_PATHS.every((path) => last[path] === 200)) return;
    if (now() >= end) throw new Error(`${origin} not ready after ${Math.round(timeoutMs / 1000)} s: ${READY_PATHS.map((path) => `${path} ${last[path]}`).join(', ')}`);
    await sleep(POLL_MS);
  }
}

/**
 * Start the servers one after the other: the next only once the previous serves the wall page, and the app
 * server read again after the last build. Refuses when a port already answers (another run owns it).
 * @param {{ ports: import('./e2e-ports.mjs').E2EPorts, spawnServer: (server: ServerCommand) => StartedServer,
 *   fetchImpl?: (url: string) => Promise<{ status: number }>, sleep?: (ms: number) => Promise<void>, now?: () => number,
 *   timeoutMs?: number, log?: (line: string) => void }} deps
 * @returns {Promise<StartedServer[]>}
 */
export async function startServers(deps) {
  const log = deps.log ?? (() => {});
  const fetchImpl = deps.fetchImpl ?? ((url) => fetch(url, { redirect: 'manual' }));
  const servers = serverCommands(deps.ports);
  for (const server of servers) {
    const answered = await fetchImpl(`${localOrigin(server.port)}/api/health`).then(() => true, () => false);
    if (answered) throw new Error(`port ${server.port} already answers: another run owns it (stop it first, or set E2E_PORT)`);
  }
  /** @type {StartedServer[]} */
  const started = [];
  for (const server of servers) {
    started.push(deps.spawnServer(server));
    log(`${server.name} server starting on ${server.port} (pid ${started.at(-1)?.pid})`);
    await waitReady(localOrigin(server.port), { ...deps, fetchImpl });
    log(`${server.name} server ready: ${READY_PATHS.join(' and ')} answer 200`);
  }
  // The short server's own build rewrote app/dist under the running app server.
  await waitReady(localOrigin(deps.ports.app), { ...deps, fetchImpl });
  log('app server still serves the wall after the second build');
  return started;
}

/** @param {ServerCommand} server @returns {StartedServer} */
function spawnDetached(server) {
  mkdirSync(resolve(ROOT, '.wrangler'), { recursive: true });
  const log = resolve(ROOT, `.wrangler/e2e-server-${server.name}.log`);
  const out = openSync(log, 'w');
  const child = spawn('npx', server.args, { cwd: ROOT, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  if (child.pid === undefined) throw new Error(`could not start the ${server.name} server`);
  return { name: server.name, port: server.port, pid: child.pid, log };
}

/** @returns {StartedServer[]} */
function readState() {
  const file = resolve(ROOT, STATE_FILE);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
}

/** @param {StartedServer[]} servers */
function stop(servers) {
  for (const server of servers) {
    // Each server was spawned detached, so its pid is its process group: npx, wrangler and workerd go together.
    try { process.kill(-server.pid, 'SIGTERM'); console.log(`stopped ${server.name} (group ${server.pid})`); } catch { console.log(`${server.name} (group ${server.pid}) was not running`); }
  }
  rmSync(resolve(ROOT, STATE_FILE), { force: true });
}

async function main() {
  const command = process.argv[2];
  const ports = e2ePorts();
  if (command === 'start') {
    /** @type {StartedServer[]} */
    let started = [];
    try {
      started = await startServers({ ports, spawnServer: (server) => { const s = spawnDetached(server); started.push(s); return s; }, log: (line) => console.log(line) });
    } catch (error) {
      console.error(String(error instanceof Error ? error.message : error));
      if (started.length) stop(started);
      process.exit(1);
    }
    writeFileSync(resolve(ROOT, STATE_FILE), `${JSON.stringify(started, null, 2)}\n`);
    console.log(`both servers ready; pids in ${STATE_FILE}; logs ${started.map((s) => s.log).join(', ')}`);
    return;
  }
  if (command === 'stop') return stop(readState());
  if (command === 'status') {
    for (const server of readState()) {
      const status = await fetch(`${localOrigin(server.port)}/kiosk/`).then((r) => r.status, () => 'down');
      console.log(`${server.name} :${server.port} group ${server.pid} /kiosk/ ${status}`);
    }
    return;
  }
  console.error('usage: node scripts/e2e-servers.mjs start|status|stop');
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
