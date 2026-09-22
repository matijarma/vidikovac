// Browser-test fixtures only. The shipped app has no demo route or fake grant.
// Real parser snapshots are supplied through Playwright's request/socket mocks
// so UI state tests are deterministic and never depend on upstream availability.
import type { Page } from '@playwright/test';
import type { ModuleId, ModuleSnapshot } from '../worker/feed/schema';
import { MODULE_IDS, MODULES, teaserSubset } from '../worker/feed/registry';
import type { Role, RoomServerMessage, ScreenStop } from '../worker/protocol';
import { FIXTURE_CONTEXTS, FIXTURE_NOW } from '../test/feed/fixture-contexts';
import type { PresentationState } from '../worker/presentation';
import type { DepartureBoard } from '../shared/city/types';

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

/** The wall's own requests beside the teaser (WP1): the place's departures and the header sentences. */
export interface WallFixtureOptions {
  /** The page's clock as the board should read it; the real clock when omitted. Pass the fake
   *  clock's instant (plus whatever the spec has fast-forwarded) when `page.clock` is installed. */
  now?: () => number;
}

/** Departures on the wall fixture's board: one every five minutes, so six fill the next half hour. */
export const WALL_BOARD_ROWS = 6;
const WALL_SLOT_MS = 300_000;
/** A plausible terminus per line of FIXTURE_STOP. Fixture data, not interface copy. */
const WALL_HEADSIGNS: Readonly<Record<string, string>> = { '6': 'Sopot', '11': 'Dubec', '12': 'Dubrava', '13': 'Žitnjak', '14': 'Zapruđe', '17': 'Borongaj' };

/**
 * FIXTURE_STOP's ZET board at `now`: WALL_BOARD_ROWS timetable departures on a
 * five-minute grid, the first at least a minute ahead and the last within 31
 * minutes. The trip ids are the grid slots, so a board fetched a minute later
 * names the same trips and the wall's rows keep their nodes. No trip id is a
 * tracked vehicle's, so every row is a grey timetable time. Any other stop
 * answers an empty live board, so a sibling platform never doubles a row.
 */
export function wallDepartures(now: number, stopId: string = FIXTURE_STOP.id, operator: DepartureBoard['operator'] = 'zet'): DepartureBoard {
  const base = { operator, stopId, status: 'live' as const, generatedAt: new Date(now).toISOString() };
  if (operator !== 'zet' || stopId !== FIXTURE_STOP.id) return { ...base, stopName: stopId, departures: [] };
  const first = Math.floor(now / WALL_SLOT_MS) + 1;
  const departures = Array.from({ length: WALL_BOARD_ROWS }, (_, i) => {
    const slot = first + i;
    const routeId = FIXTURE_STOP.routes[slot % FIXTURE_STOP.routes.length]!;
    return {
      operator, tripId: `wall-fixture-${slot}`, routeId, routeName: routeId,
      headsign: WALL_HEADSIGNS[routeId] ?? 'Črnomerec', at: new Date(slot * WALL_SLOT_MS + 60_000).toISOString(),
    };
  });
  return { ...base, stopName: FIXTURE_STOP.name, departures };
}

/**
 * Stubs the two requests the wall makes besides the teaser: `/api/city/departures`
 * answers wallDepartures at the page's clock, `/api/kiosk/sentences` answers no
 * model sentence, so the header shows the deterministic templates and no run
 * ever reaches Workers AI. Call it after installCityFixture when a spec uses
 * both: the route registered last answers.
 */
export async function installWallFixture(page: Page, options: WallFixtureOptions = {}): Promise<void> {
  const now = options.now ?? Date.now;
  await page.route((url) => url.pathname === '/api/city/departures', (route) => {
    const url = new URL(route.request().url());
    const operator = url.searchParams.get('operator') === 'hz' ? 'hz' : 'zet';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wallDepartures(now(), url.searchParams.get('stop') ?? '', operator)) });
  });
  await page.route((url) => url.pathname === '/api/kiosk/sentences', (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'cache-control': 'private, no-store' },
    body: JSON.stringify({ generatedAt: new Date(now()).toISOString(), sentences: [] }),
  }));
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

/** Deterministic feed content with a real clock. No pairing/socket mocks:
 * use with a real local screen for presentation and display-state tests. */
export async function installKioskFeedFixture(page: Page, state: FixtureState = 'ready'): Promise<void> {
  const snapshots = await experienceSnapshots(state);
  const delta = Date.now() - FIXTURE_NOW.getTime();
  const shift = (value: string | undefined) => value ? new Date(Date.parse(value) + delta).toISOString() : undefined;
  for (const snapshot of Object.values(snapshots)) {
    snapshot.fetchedAt = shift(snapshot.fetchedAt)!;
    snapshot.sourceUpdatedAt = shift(snapshot.sourceUpdatedAt);
    snapshot.validUntil = shift(snapshot.validUntil);
    snapshot.items = snapshot.items.map(item => ({ ...item, at: shift(item.at), until: shift(item.until) }));
  }
  await page.route('**/api/teaser*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ generatedAt: new Date().toISOString(), modules: Object.values(snapshots).map(snapshot => teaserSubset(snapshot, FIXTURE_STOP)) }),
  }));
  await page.route('**/api/data/**', route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1) as ModuleId;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshots[id]) });
  });
}
