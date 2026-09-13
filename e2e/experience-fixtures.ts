// Browser-test fixtures only. The shipped app has no demo route or fake grant.
// Real parser snapshots are supplied through Playwright's request/socket mocks
// so UI state tests are deterministic and never depend on upstream availability.
import type { Page } from '@playwright/test';
import type { ModuleId, ModuleSnapshot } from '../worker/feed/schema';
import { MODULE_IDS, MODULES } from '../worker/feed/registry';
import { FIXTURE_CONTEXTS, FIXTURE_NOW } from '../test/feed/fixture-contexts';

export type FixtureState = 'ready' | 'empty' | 'down' | 'stale';
const FIXTURE_ROOM = '0000000000000000';

export async function experienceSnapshots(state: FixtureState = 'ready'): Promise<Record<ModuleId, ModuleSnapshot>> {
  const result = {} as Record<ModuleId, ModuleSnapshot>;
  await Promise.all(MODULE_IDS.map(async (id) => {
    const parsed = await MODULES[id].fetcher(FIXTURE_CONTEXTS[id]);
    const snapshot: ModuleSnapshot = {
      ...parsed, status: state === 'down' ? 'down' : state === 'stale' ? 'stale' : 'live',
      ...(state === 'stale' ? { staleSince: FIXTURE_NOW.toISOString() } : {}),
      items: state === 'down' || state === 'empty' ? [] : parsed.items,
    };
    // Fixture vehicle reports were captured earlier than FIXTURE_NOW. Give all
    // test reports this test clock, without modifying any production source.
    if (id === 'zet-rt') {
      snapshot.sourceUpdatedAt = FIXTURE_NOW.toISOString();
      snapshot.items = snapshot.items.map((item) => item.id.startsWith('vehicle:')
        ? { ...item, at: FIXTURE_NOW.toISOString() } : item);
    }
    if (snapshot.sources) snapshot.sources = Object.fromEntries(Object.entries(snapshot.sources).map(([key, value]) => [
      key, {
        ...value,
        status: snapshot.status,
        ...(state === 'empty' || state === 'down' ? { itemCount: 0, ...(state === 'empty' ? { totalItems: 0 } : {}) } : {}),
      },
    ]));
    result[id] = snapshot;
  }));
  return result;
}

export interface FixtureSession {
  expire(): void;
  requests: string[];
  events: Record<string, unknown>[];
}

export async function installExperienceFixture(
  page: Page,
  snapshots: Record<ModuleId, ModuleSnapshot>,
): Promise<FixtureSession> {
  const now = FIXTURE_NOW.getTime();
  await page.clock.install({ time: now });
  const requests: string[] = [];
  const events: Record<string, unknown>[] = [];
  const sockets: { send(message: string): void }[] = [];
  await page.route('**/api/data/**', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1) as ModuleId;
    requests.push(id);
    const snapshot = snapshots[id];
    await route.fulfill({
      status: snapshot ? 200 : 404, contentType: 'application/json',
      body: JSON.stringify(snapshot ?? { error: 'not-found' }),
    });
  });
  await page.routeWebSocket('**/ws/room/**', (socket) => {
    sockets.push(socket);
    socket.onMessage((raw) => {
      if (typeof raw !== 'string') return;
      const message = JSON.parse(raw) as Record<string, unknown>;
      events.push(message);
      if (message.t === 'join' || message.t === 'resume') socket.send(JSON.stringify({
        t: 'joined', role: 'scanner', expiresAt: now + 600_000, serverNow: now,
        resumeToken: 'fixture-resume', dataToken: 'fixture-data-token', participants: 1,
        screen: { kind: 'temporary', expiresAt: now + 86_400_000,
          stop: { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '11', '12', '13', '14', '17'] } },
      }));
      if (message.t === 'share') socket.send(JSON.stringify({
        t: 'codes', serverNow: now,
        batch: [{ code: 'ABCDEFGH', slotStart: now, slotEnd: now + 30_000 }],
      }));
    });
  });
  return {
    requests, events,
    expire() { for (const socket of sockets) socket.send(JSON.stringify({ t: 'expired' })); },
  };
}

export const FIXTURE_DASHBOARD = `/d/#room=${FIXTURE_ROOM}&ticket=fixture-ticket`;
