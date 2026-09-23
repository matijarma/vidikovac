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
import type { WrittenSentence } from '../shared/kiosk/sentence';

export type FixtureState = 'ready' | 'empty' | 'down' | 'stale';
const FIXTURE_ROOM = '0000000000000000';

/** The screen's stop: Trg bana J. Jelačića lies in Gornji grad – Medveščak by the City's own boundary data (R-DG19). */
export const FIXTURE_STOP: ScreenStop = {
  id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286,
  routes: ['6', '11', '12', '13', '14', '17'], district: 'gornji-grad-medvescak',
};
/** The on-duty pharmacy nearest FIXTURE_STOP as worker/hitno/ljekarne.ts writes it: its label and its address, either of which the footer may print. */
export const FIXTURE_PHARMACY_ADDRESSES: readonly string[] = Object.freeze(['Trg bana J. Jelačića 3', 'Trg bana Josipa Jelačića 3']);

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

/** One request the phone made for model-written sentences (POST /api/kiosk/sentences, WP4 step 12). */
export interface SentenceCall {
  /** Node's clock when the request arrived; the page's own clock is the fake one. */
  at: number;
  /** The JSON body as sent (SentenceRequest: locale, budget, facts), or null when it was not JSON. */
  body: unknown;
}

export interface FixtureSession {
  expire(): void;
  acknowledgePresentation(): void;
  requests: string[];
  events: Record<string, unknown>[];
  /** Every sentence request the page made, in order. */
  sentenceRequests: SentenceCall[];
  /** The page's clock as the Node side knows it: FIXTURE_NOW plus the real time since the clock was installed (a spec that jumps the page's clock adds the jump itself). */
  now(): number;
}

/** A departures board for a stop at the page's time (the shape of worker/city/schedules.ts departuresFrom). */
export type FixtureDepartures = (stopId: string, operator: DepartureBoard['operator'], now: number) => DepartureBoard;

/** How the room answers the join (the driver with a screen by default; the two cases in which casting is disabled (D5) opt out) and what the page's departures and sentence requests answer. */
export interface FixtureOptions {
  /** 'scanner' (the room's driver) by default; 'phone' is the one-hop peer whose screen follows the scanning phone. */
  role?: Role;
  /** True by default; false joins a session that has no screen at all. */
  screen?: boolean;
  /**
   * What /api/city/departures answers, at the page's clock (FixtureSession.now): wallDepartures by
   * default, so Sada's departures block and a stop's sheet always have their rows at FIXTURE_NOW (a
   * timetable row always exists, WP4 step 2) instead of a board the local server computes for the
   * real clock. False leaves the request to the server. A route a spec registers later
   * (installCityFixture, installWallFixture) answers first, as Playwright's last route does.
   */
  departures?: false | FixtureDepartures;
  /** The model sentences /api/kiosk/sentences answers; none by default, so Sada shows its template sentence and no run reaches Workers AI. */
  sentences?: readonly WrittenSentence[];
}

export async function installExperienceFixture(
  page: Page,
  snapshots: Record<ModuleId, ModuleSnapshot>,
  options: FixtureOptions = {},
): Promise<FixtureSession> {
  const now = FIXTURE_NOW.getTime();
  await page.clock.install({ time: now });
  const installedAt = Date.now();
  const pageNow = (): number => now + (Date.now() - installedAt);
  const requests: string[] = [];
  const events: Record<string, unknown>[] = [];
  const sentenceRequests: SentenceCall[] = [];
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
  const departures = options.departures ?? ((stopId: string, operator: DepartureBoard['operator'], at: number) => wallDepartures(at, stopId, operator));
  if (departures) await page.route((url) => url.pathname === '/api/city/departures', (route) => {
    const url = new URL(route.request().url());
    const operator = url.searchParams.get('operator') === 'hz' ? 'hz' : 'zet';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(departures(url.searchParams.get('stop') ?? '', operator, pageNow())) });
  });
  await page.route((url) => url.pathname === '/api/kiosk/sentences', (route) => {
    let body: unknown = null;
    try { body = route.request().postDataJSON(); } catch { body = null; }
    sentenceRequests.push({ at: Date.now(), body });
    return route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'cache-control': 'private, no-store' },
      body: JSON.stringify({ generatedAt: new Date(pageNow()).toISOString(), sentences: options.sentences ?? [] }),
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
    requests, events, sentenceRequests,
    now: pageNow,
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
