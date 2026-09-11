// Browser side of the RoomDO WebSocket. One instance per page load. Knows the
// wire contract, the resume rule (sessionStorage 'vidikovac-resume', one live
// socket per resume token) and the clock offset; knows nothing about the DOM.
import {
  CLOSE_SESSION_EXPIRED,
  type ClientEvent,
  type CodeSlot,
  type LayerId,
  type Role,
  type RoomClientMessage,
  type RoomServerMessage,
} from '../../worker/protocol';

export const RESUME_KEY = 'vidikovac-resume';

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
}

export type SessionPhase = 'idle' | 'connecting' | 'live' | 'expired' | 'closed';

export interface SessionSnapshot {
  phase: SessionPhase;
  role: Role | null;
  expiresAt: number | null;
  dataToken: string | null;
  participants: number;
  secondsLeft: number;
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

  let socket: WebSocketLike | null = null;
  let phase: SessionPhase = 'idle';
  let role: Role | null = null;
  let expiresAt: number | null = null;
  let dataToken: string | null = null;
  let participants = 0;
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
  const snapshot = (): SessionSnapshot => ({ phase, role, expiresAt, dataToken, participants, secondsLeft: secondsLeft() });

  function send(message: RoomClientMessage): void {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
  }

  function fireExpired(): void {
    if (expiredFired) return;
    expiredFired = true;
    phase = 'expired';
    try { storage?.removeItem(RESUME_KEY); } catch { /* ignore */ }
    expired.forEach((l) => l());
  }

  function handle(message: RoomServerMessage): void {
    switch (message.t) {
      case 'joined':
        role = message.role;
        expiresAt = message.expiresAt;
        dataToken = message.dataToken;
        participants = message.participants;
        offset = message.serverNow - now();
        phase = 'live';
        try { storage?.setItem(RESUME_KEY, JSON.stringify({ roomId: deps.roomId, resumeToken: message.resumeToken } satisfies StoredResume)); } catch { /* ignore */ }
        joined.forEach((l) => l(snapshot()));
        return;
      case 'view': view.forEach((l) => l(message.layer, message.params)); return;
      case 'codes': codes.forEach((l) => l(message.batch, message.serverNow)); return;
      case 'count': participants = message.participants; count.forEach((l) => l(participants)); return;
      case 'expiring': expiring.forEach((l) => l(message.secondsLeft)); return;
      case 'expired': fireExpired(); return;
      case 'error': error.forEach((l) => l(message.error)); return;
      default: return;
    }
  }

  return {
    connect() {
      if (socket) return;
      phase = 'connecting';
      socket = createSocket(roomSocketUrl(deps.roomId, wsBase));
      socket.addEventListener('open', () => {
        const resumeToken = readResume(storage, deps.roomId);
        if (deps.ticket) send({ t: 'join', ticket: deps.ticket });
        else if (resumeToken) send({ t: 'resume', resumeToken });
        else {
          phase = 'closed';
          error.forEach((l) => l('no-ticket'));
          socket?.close(1000, 'no-ticket');
        }
      });
      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        let parsed: unknown;
        try { parsed = JSON.parse(event.data); } catch { return; }
        if (parsed && typeof parsed === 'object' && typeof (parsed as { t?: unknown }).t === 'string') handle(parsed as RoomServerMessage);
      });
      socket.addEventListener('close', (event) => {
        if (event.code === CLOSE_SESSION_EXPIRED) { fireExpired(); return; }
        if (phase !== 'expired') phase = 'closed';
        closed.forEach((l) => l(event.code));
      });
      socket.addEventListener('error', () => { error.forEach((l) => l('socket')); });
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
    close() { socket?.close(1000, 'leave'); },
  };
}

function safeSessionStorage(): Storage | null {
  try { return globalThis.sessionStorage; } catch { return null; }
}
