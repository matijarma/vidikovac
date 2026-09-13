// Browser side of the RoomDO WebSocket. One instance per page load. Knows the
// wire contract, the resume rule (sessionStorage 'vidikovac-resume', one live
// socket per resume token) and the clock offset; knows nothing about the DOM.
import {
  CLOSE_SESSION_EXPIRED,
  type ClientEvent,
  type CodeSlot,
  type LayerId,
  type Role,
  type ScreenMetadata,
  type RoomClientMessage,
  type RoomServerMessage,
} from '../../worker/protocol';

export const RESUME_KEY = 'vidikovac-resume';
/**
 * The session's own data token, mirrored into sessionStorage so a reload keeps
 * reading the session tier and so the end-to-end suite can prove the token
 * gates /api/data (R-52). Strictly necessary for the session the person just
 * opened, carries no identifier, and dies with the tab or with the session,
 * whichever comes first.
 */
export const DATA_TOKEN_KEY = 'vidikovac.dataToken';

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (event: { code: number; reason: string }) => void): void;
  addEventListener(type: 'error', listener: () => void): void;
}

export interface SessionClientDeps {
  roomId: string;
  /** Single-use join ticket from /api/scan; null on a reload (resume is used). */
  ticket: string | null;
  createSocket?: (url: string) => WebSocketLike;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  now?: () => number;
  /** 'wss://host'; defaults to the page origin with the ws scheme. */
  wsBase?: string;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/**
 * Backoff between reconnect attempts, the last value repeating. A phone drops
 * its socket the moment the person opens the camera app or locks the screen,
 * and the room keeps the session alive for the full ten minutes: without this
 * the countdown froze, the expiry never arrived, the closing line the izjava
 * promises was never shown and the view counters silently stopped (R-53).
 */
export const RECONNECT_DELAYS_MS: readonly number[] = [500, 1_000, 2_000, 5_000, 10_000];
export const HANDSHAKE_TIMEOUT_MS = 10_000;
export const INITIAL_CONNECT_WINDOW_MS = 30_000;

export type SessionPhase = 'idle' | 'connecting' | 'live' | 'expired' | 'closed';

export interface SessionSnapshot {
  phase: SessionPhase;
  role: Role | null;
  expiresAt: number | null;
  dataToken: string | null;
  participants: number;
  secondsLeft: number;
  screen?: ScreenMetadata;
}

export interface SessionClient {
  connect(): void;
  snapshot(): SessionSnapshot;
  serverNow(): number;
  secondsLeft(): number;
  onJoined(l: (s: SessionSnapshot) => void): () => void;
  onExpiring(l: (secondsLeft: number) => void): () => void;
  onExpired(l: () => void): () => void;
  onView(l: (layer: LayerId, params?: Record<string, string>) => void): () => void;
  onCodes(l: (batch: CodeSlot[], serverNow: number) => void): () => void;
  onCount(l: (participants: number) => void): () => void;
  onError(l: (error: string) => void): () => void;
  onClose(l: (code: number) => void): () => void;
  sendView(layer: LayerId, params?: Record<string, string>): void;
  share(): void;
  event(name: ClientEvent, dim?: string): void;
  close(): void;
}

export function wsBaseFromLocation(loc: { protocol: string; host: string } = location): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}`;
}
export function roomSocketUrl(roomId: string, base: string = wsBaseFromLocation()): string {
  return `${base}/ws/room/${encodeURIComponent(roomId)}`;
}
export function beaconSocketUrl(beaconId: string, base: string = wsBaseFromLocation()): string {
  return `${base}/ws/beacon/${encodeURIComponent(beaconId)}`;
}

interface StoredResume { roomId: string; resumeToken: string }

function readResume(storage: SessionClientDeps['storage'], roomId: string): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredResume>;
    return parsed.roomId === roomId && typeof parsed.resumeToken === 'string' ? parsed.resumeToken : null;
  } catch { return null; }
}

export function createSessionClient(deps: SessionClientDeps): SessionClient {
  const createSocket = deps.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
  const storage = deps.storage === undefined ? safeSessionStorage() : deps.storage;
  const now = deps.now ?? (() => Date.now());
  const wsBase = deps.wsBase ?? wsBaseFromLocation();
  const later = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const cancelLater = deps.clearTimeout ?? ((h) => globalThis.clearTimeout(h as never));

  let socket: WebSocketLike | null = null;
  let ticketSpent = false;
  let leaving = false;
  let attempt = 0;
  let retryHandle: unknown = null;
  let handshakeHandle: unknown = null;
  let firstConnectAt: number | null = null;
  let phase: SessionPhase = 'idle';
  let role: Role | null = null;
  let expiresAt: number | null = null;
  let dataToken: string | null = null;
  let participants = 0;
  let screen: ScreenMetadata | undefined;
  let offset = 0;
  let expiredFired = false;

  const joined = new Set<(s: SessionSnapshot) => void>();
  const expiring = new Set<(n: number) => void>();
  const expired = new Set<() => void>();
  const view = new Set<(layer: LayerId, params?: Record<string, string>) => void>();
  const codes = new Set<(batch: CodeSlot[], serverNow: number) => void>();
  const count = new Set<(n: number) => void>();
  const error = new Set<(e: string) => void>();
  const closed = new Set<(code: number) => void>();
  const sub = <T>(set: Set<T>, l: T): (() => void) => { set.add(l); return () => { set.delete(l); }; };

  const serverNow = (): number => now() + offset;
  const secondsLeft = (): number => (expiresAt === null ? 0 : Math.max(0, Math.floor((expiresAt - serverNow()) / 1000)));
  const snapshot = (): SessionSnapshot => ({ phase, role, expiresAt, dataToken, participants, secondsLeft: secondsLeft(), ...(screen ? { screen } : {}) });

  function send(message: RoomClientMessage): void {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
  }

  function fireExpired(): void {
    if (expiredFired) return;
    expiredFired = true;
    phase = 'expired';
    dataToken = null;
    clearHandshake();
    try { storage?.removeItem(RESUME_KEY); } catch { /* ignore */ }
    try { storage?.removeItem(DATA_TOKEN_KEY); } catch { /* ignore */ }
    expired.forEach((l) => l());
  }

  function clearHandshake(): void {
    if (handshakeHandle !== null) { cancelLater(handshakeHandle); handshakeHandle = null; }
  }

  /** Invalid grants cannot recover by retrying the same ticket or resume token. */
  function rejectGrant(reason: string): void {
    leaving = true;
    clearHandshake();
    if (retryHandle !== null) { cancelLater(retryHandle); retryHandle = null; }
    dataToken = null;
    try { storage?.removeItem(RESUME_KEY); } catch { /* storage optional */ }
    try { storage?.removeItem(DATA_TOKEN_KEY); } catch { /* storage optional */ }
    if (expiresAt !== null && expiresAt <= serverNow()) {
      fireExpired();
    } else {
      phase = 'closed';
      // The existing UI recovery contract is "scan again"; also retain the
      // server reason for diagnostics without exposing it in the interface.
      error.forEach((listener) => listener(reason));
      error.forEach((listener) => listener('no-ticket'));
    }
    socket?.close(1000, 'grant-invalid');
  }

  function handle(message: RoomServerMessage): void {
    switch (message.t) {
      case 'joined':
        clearHandshake();
        role = message.role;
        expiresAt = message.expiresAt;
        dataToken = message.dataToken;
        participants = message.participants;
        screen = message.screen;
        offset = message.serverNow - now();
        phase = 'live';
        attempt = 0;
        try { storage?.setItem(RESUME_KEY, JSON.stringify({ roomId: deps.roomId, resumeToken: message.resumeToken } satisfies StoredResume)); } catch { /* ignore */ }
        try { storage?.setItem(DATA_TOKEN_KEY, message.dataToken); } catch { /* ignore */ }
        joined.forEach((l) => l(snapshot()));
        return;
      case 'view': view.forEach((l) => l(message.layer, message.params)); return;
      case 'codes': codes.forEach((l) => l(message.batch, message.serverNow)); return;
      case 'count': participants = message.participants; count.forEach((l) => l(participants)); return;
      case 'expiring': expiring.forEach((l) => l(message.secondsLeft)); return;
      case 'expired': fireExpired(); return;
      case 'error':
        if (message.error === 'ticket-invalid' || message.error === 'resume-invalid' || message.error === 'room-closed') {
          rejectGrant(message.error);
        } else error.forEach((l) => l(message.error));
        return;
      default: return;
    }
  }

  /** Retry only with a usable credential, within the room or initial deadline.
   * A sent ticket with no joined response cannot safely be spent a second time. */
  function shouldReconnect(): boolean {
    if (leaving || phase === 'expired') return false;
    if (!(deps.ticket && !ticketSpent) && !readResume(storage, deps.roomId)) return false;
    return expiresAt !== null
      ? expiresAt > serverNow()
      : firstConnectAt !== null && now() - firstConnectAt < INITIAL_CONNECT_WINDOW_MS;
  }

  function scheduleReconnect(): void {
    if (retryHandle !== null) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]!;
    attempt += 1;
    retryHandle = later(() => {
      retryHandle = null;
      if (!shouldReconnect()) {
        if (!leaving) {
          if (expiresAt !== null && expiresAt <= serverNow()) fireExpired();
          else { phase = 'closed'; error.forEach((listener) => listener('no-ticket')); }
        }
        return;
      }
      openSocket();
    }, delay);
  }

  function disconnected(code: number): void {
    socket = null;
    clearHandshake();
    if (code === CLOSE_SESSION_EXPIRED) { fireExpired(); return; }
    const reconnecting = shouldReconnect();
    if (reconnecting) {
      phase = 'connecting';
      scheduleReconnect();
    } else if (phase !== 'expired') phase = 'closed';
    closed.forEach((listener) => listener(code));
    if (!reconnecting && !leaving && phase !== 'expired') {
      if (expiresAt !== null && expiresAt <= serverNow()) fireExpired();
      else error.forEach((listener) => listener('no-ticket'));
    }
  }

  function openSocket(): void {
    phase = 'connecting';
    firstConnectAt ??= now();
    let active: WebSocketLike;
    try { active = createSocket(roomSocketUrl(deps.roomId, wsBase)); }
    catch { disconnected(1006); return; }
    socket = active;
    handshakeHandle = later(() => {
      handshakeHandle = null;
      if (socket !== active || phase !== 'connecting') return;
      // Detach this attempt first so a late close/message cannot disturb the
      // next attempt. Some failed handshakes never produce a close event.
      disconnected(1006);
      try { active.close(1000, 'handshake-timeout'); } catch { /* already unavailable */ }
    }, HANDSHAKE_TIMEOUT_MS);
    active.addEventListener('open', () => {
      if (socket !== active || leaving || phase === 'expired') return;
      const resumeToken = readResume(storage, deps.roomId);
      // The ticket is single-use, so only the first attempt may spend it; every
      // later one resumes, which is what RoomDO's one-live-socket rule expects.
      if (deps.ticket && !ticketSpent) {
        ticketSpent = true;
        send({ t: 'join', ticket: deps.ticket });
      } else if (resumeToken) {
        send({ t: 'resume', resumeToken });
      } else {
        leaving = true;
        phase = 'closed';
        clearHandshake();
        error.forEach((l) => l('no-ticket'));
        active.close(1000, 'no-ticket');
      }
    });
    active.addEventListener('message', (event) => {
      if (socket !== active || leaving || phase === 'expired') return;
      if (typeof event.data !== 'string') return;
      let parsed: unknown;
      try { parsed = JSON.parse(event.data); } catch { return; }
      if (parsed && typeof parsed === 'object' && typeof (parsed as { t?: unknown }).t === 'string') handle(parsed as RoomServerMessage);
    });
    active.addEventListener('close', (event) => {
      if (socket === active) disconnected(event.code);
    });
    active.addEventListener('error', () => {
      if (socket === active) error.forEach((l) => l('socket'));
    });
  }

  return {
    connect() {
      if (socket || retryHandle !== null || leaving || phase === 'expired') return;
      openSocket();
    },
    snapshot,
    serverNow,
    secondsLeft,
    onJoined: (l) => sub(joined, l),
    onExpiring: (l) => sub(expiring, l),
    onExpired: (l) => sub(expired, l),
    onView: (l) => sub(view, l),
    onCodes: (l) => sub(codes, l),
    onCount: (l) => sub(count, l),
    onError: (l) => sub(error, l),
    onClose: (l) => sub(closed, l),
    sendView(layer, params) { send(params ? { t: 'view', layer, params } : { t: 'view', layer }); },
    share() { send({ t: 'share' }); },
    event(name, dim) { send(dim === undefined ? { t: 'event', name } : { t: 'event', name, dim }); },
    close() {
      leaving = true;
      clearHandshake();
      if (retryHandle !== null) { cancelLater(retryHandle); retryHandle = null; }
      socket?.close(1000, 'leave');
    },
  };
}

function safeSessionStorage(): Storage | null {
  try { return globalThis.sessionStorage; } catch { return null; }
}
