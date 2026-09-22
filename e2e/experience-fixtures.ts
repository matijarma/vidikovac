// Browser-test fixtures only. The shipped app has no demo route or fake grant.
// Real parser snapshots are supplied through Playwright's request/socket mocks
// so UI state tests are deterministic and never depend on upstream availability.
import type { Page } from '@playwright/test';
import type { ModuleId, ModuleSnapshot } from '../worker/feed/schema';
import { MODULE_IDS, MODULES, teaserSubset } from '../worker/feed/registry';
import type { Role, RoomServerMessage, ScreenStop } from '../worker/protocol';
import { FIXTURE_CONTEXTS, FIXTURE_NOW } from '../test/feed/fixture-contexts';
import type { PresentationState } from '../worker/presentation';

export type FixtureState = 'ready' | 'empty' | 'down' | 'stale';
const FIXTURE_ROOM = '0000000000000000';

/** The screen's stop: Trg bana J. Jelačića lies in Gornji grad – Medveščak by the City's own boundary data (R-DG19). */
export const FIXTURE_STOP: ScreenStop = {
  id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286,
  routes: ['6', '11', '12', '13', '14', '17'], district: 'gornji-grad-medvescak',
};

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
  acknowledgePresentation(): void;
  requests: string[];
  events: Record<string, unknown>[];
}

/** How the room answers the join: the driver with a screen by default; the two cases in which casting is disabled (D5) opt out. */
export interface FixtureOptions {
  /** 'scanner' (the room's driver) by default; 'phone' is the one-hop peer whose screen follows the scanning phone. */
  role?: Role;
  /** True by default; false joins a session that has no screen at all. */
  screen?: boolean;
}

export async function installExperienceFixture(
  page: Page,
  snapshots: Record<ModuleId, ModuleSnapshot>,
  options: FixtureOptions = {},
): Promise<FixtureSession> {
  const now = FIXTURE_NOW.getTime();
  await page.clock.install({ time: now });
  const requests: string[] = [];
  const events: Record<string, unknown>[] = [];
  const sockets: { send(message: string): void }[] = [];
  let presentation: PresentationState = { version: 1, revision: 0, target: null, owner: null, expiresAt: null, status: 'idle', online: true, supported: true,capabilities:['city-v1'] };
  const joined: RoomServerMessage = {
    t: 'joined', role: options.role ?? 'scanner', expiresAt: now + 600_000, serverNow: now,
    resumeToken: 'fixture-resume', dataToken: 'fixture-data-token', participants: 1,
    ...(options.screen ?? true ? { screen: { kind: 'temporary', expiresAt: now + 86_400_000, stop: FIXTURE_STOP } } : {}),
    ...((options.role ?? 'scanner') === 'scanner' && (options.screen ?? true) ? { presentation } : {}),
  };
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
      if (message.t === 'join' || message.t === 'resume') socket.send(JSON.stringify(joined));
      if (message.t === 'presentation-get') socket.send(JSON.stringify({ t: 'presentation', state: presentation }));
      if (message.t === 'present') {
        const command = message.command as { requestId: string; action: string; target?: PresentationState['target'] };
        presentation = { ...presentation, revision: presentation.revision + 1, target: command.target ?? null, owner: command.action === 'present' ? 'self' : null, expiresAt: now + 600_000, status: command.action === 'present' ? 'pending' : 'idle' };
        socket.send(JSON.stringify({ t: 'presentation', state: presentation }));
        socket.send(JSON.stringify({ t: 'presentation-result', result: { requestId: command.requestId, state: presentation } }));
      }
      if (message.t === 'share') socket.send(JSON.stringify({
        t: 'codes', serverNow: now,
        batch: [{ code: 'ABCDEFGH', slotStart: now, slotEnd: now + 30_000 }],
      }));
    });
  });
  return {
    requests, events,
    acknowledgePresentation() {
      presentation = { ...presentation, status: 'displayed' };
      for (const socket of sockets) socket.send(JSON.stringify({ t: 'presentation', state: presentation }));
    },
    expire() { for (const socket of sockets) socket.send(JSON.stringify({ t: 'expired' })); },
  };
}

export const FIXTURE_DASHBOARD = `/d/#room=${FIXTURE_ROOM}&ticket=fixture-ticket`;

/** Options of installKioskFeedFixture. */
export interface KioskFeedFixtureOptions {
  /** The instant the feed is stamped for: the page's fake clock (`page.clock.install({ time: now })`) in the wall scenes; the real clock when omitted. Drives both the shift of every recorded time and the teaser's `generatedAt`. */
  now?: number;
}

/** Deterministic feed content with a real clock (or the scene's `now`). No pairing/socket mocks:
 * use with a real local screen for presentation and display-state tests.
 * Resolves to the shifted snapshots, so a spec can read the zet-rt vehicles it serves
 * (e2e/departures-fixture.ts departuresBoard takes its tracked trip ids from them). */
export async function installKioskFeedFixture(page: Page, state: FixtureState = 'ready', options: KioskFeedFixtureOptions = {}): Promise<Record<ModuleId, ModuleSnapshot>> {
  const snapshots = await experienceSnapshots(state);
  const now = options.now ?? Date.now();
  const delta = now - FIXTURE_NOW.getTime();
  const shift = (value: string | undefined) => value ? new Date(Date.parse(value) + delta).toISOString() : undefined;
  for (const snapshot of Object.values(snapshots)) {
    snapshot.fetchedAt = shift(snapshot.fetchedAt)!;
    snapshot.sourceUpdatedAt = shift(snapshot.sourceUpdatedAt);
    snapshot.validUntil = shift(snapshot.validUntil);
    snapshot.items = snapshot.items.map(item => ({ ...item, at: shift(item.at), until: shift(item.until) }));
  }
  await page.route('**/api/teaser*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ generatedAt: new Date(options.now ?? Date.now()).toISOString(), modules: Object.values(snapshots).map(snapshot => teaserSubset(snapshot, FIXTURE_STOP)) }),
  }));
  await page.route('**/api/data/**', route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1) as ModuleId;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshots[id]) });
  });
  return snapshots;
}
