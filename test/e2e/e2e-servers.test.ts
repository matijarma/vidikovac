// scripts/e2e-servers.mjs starts the harness's two local servers one after the
// other, because each `wrangler dev` rebuilds app/dist (wrangler.jsonc's custom
// build) and two overlapping builds left the app server answering GET /kiosk/
// with 404 behind a healthy /api/health (D2-e2e full re-run, 23 September).
// These cases pin the order and the readiness rule with a fake spawn and a
// fake fetch; no server is started.
import { describe, expect, it } from 'vitest';
import { READY_PATHS, serverCommands, startServers, waitReady } from '../../scripts/e2e-servers.mjs';
import { e2ePorts, localOrigin } from '../../scripts/e2e-ports.mjs';

const ports = e2ePorts({});
const APP = localOrigin(ports.app);
const SHORT = localOrigin(ports.short);

/** A fake host: which servers are up, and what each path answers once up (the wall page may lag the Worker). */
function fakeHost() {
  const events: string[] = [];
  const up = new Set<string>();
  const kioskAfter = new Map<string, number>();
  let clock = 0;
  const fetchImpl = async (url: string) => {
    const origin = new URL(url).origin;
    const path = new URL(url).pathname;
    events.push(`GET ${origin}${path}`);
    if (!up.has(origin)) throw new Error('ECONNREFUSED');
    if (path === '/kiosk/' && clock < (kioskAfter.get(origin) ?? 0)) return { status: 404 };
    return { status: 200 };
  };
  return {
    events, up, kioskAfter,
    fetchImpl,
    now: () => clock,
    sleep: async (ms: number) => { clock += ms; },
  };
}

describe('scripts/e2e-servers.mjs', () => {
  it('runs both servers with --local on the E2E_PORT ports, the short one with its own session length and store', () => {
    const [app, short] = serverCommands(ports);
    expect(app).toMatchObject({ name: 'app', port: ports.app });
    expect(app.args).toEqual(['wrangler', 'dev', '--local', '--port', String(ports.app), '--inspector-port', String(ports.appInspector), '--var', 'APP_ENV:test']);
    expect(short).toMatchObject({ name: 'short', port: ports.short });
    expect(short.args).toEqual(['wrangler', 'dev', '--local', '--port', String(ports.short), '--inspector-port', String(ports.shortInspector), '--var', 'APP_ENV:test', '--var', 'SESSION_MINUTES:0.2', '--persist-to', '.wrangler/state-e2e-short']);
    const moved = serverCommands(e2ePorts({ E2E_PORT: '8797' }));
    expect(moved.map((s) => s.port)).toEqual([8797, 8798]);
  });

  it('is not ready while the Worker is healthy but the wall page answers 404 (the half-built app/dist)', async () => {
    const host = fakeHost();
    host.up.add(APP);
    host.kioskAfter.set(APP, 5_000);
    await waitReady(APP, host);
    expect(READY_PATHS).toEqual(['/api/health', '/kiosk/']);
    expect(host.now()).toBeGreaterThanOrEqual(5_000);
    const early = fakeHost();
    early.up.add(APP);
    early.kioskAfter.set(APP, 10_000);
    await expect(waitReady(APP, { ...early, timeoutMs: 3_000 })).rejects.toThrow('/api/health 200, /kiosk/ 404');
  });

  it('starts the short server only after the app server serves the wall page, then reads the app server again', async () => {
    const host = fakeHost();
    const spawned: string[] = [];
    host.kioskAfter.set(APP, 4_000);
    const started = await startServers({
      ports,
      fetchImpl: host.fetchImpl, sleep: host.sleep, now: host.now,
      spawnServer: (server: { name: 'app' | 'short'; port: number }) => {
        spawned.push(server.name);
        host.events.push(`spawn ${server.name}`);
        host.up.add(localOrigin(server.port));
        return { name: server.name, port: server.port, pid: 100 + spawned.length };
      },
    });
    expect(started.map((s) => s.name)).toEqual(['app', 'short']);
    const spawnShort = host.events.indexOf('spawn short');
    const appKioskOk = host.events.lastIndexOf(`GET ${APP}/kiosk/`, spawnShort);
    expect(appKioskOk).toBeGreaterThan(host.events.indexOf('spawn app'));
    expect(host.now()).toBeGreaterThanOrEqual(4_000);
    expect(host.events.slice(spawnShort)).toContain(`GET ${SHORT}/kiosk/`);
    // The last reads are the app server again, after the short server's build.
    expect(host.events.slice(-2)).toEqual([`GET ${APP}/api/health`, `GET ${APP}/kiosk/`]);
  });

  it('refuses to start when a port already answers, so it never runs beside another run', async () => {
    const host = fakeHost();
    host.up.add(SHORT);
    await expect(startServers({ ports, fetchImpl: host.fetchImpl, sleep: host.sleep, now: host.now, spawnServer: () => { throw new Error('must not spawn'); } }))
      .rejects.toThrow(`port ${ports.short} already answers`);
  });
});
