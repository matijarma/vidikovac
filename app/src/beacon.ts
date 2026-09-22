// Kiosk side of the BeaconDO socket: authenticate with HMAC(secret, nonce),
// receive code batches, ask for the next batch, notice the unlock and the
// revoke, reconnect with backoff. Knows nothing about the DOM.
import type { BeaconClientMessage, BeaconServerMessage, CodeSlot, ScreenMetadata } from '../../worker/protocol';
import type { ScreenPresentation } from '../../worker/presentation';
import { hmacSha256Base64Url } from './crypto';
import { beaconSocketUrl, type WebSocketLike } from './session';

export type { WebSocketLike } from './session';

export const BEACON_STORAGE_KEY = 'vidikovac-beacon';
/** Reconnect delays; the last value repeats. A healthy session resets to the first. */
export const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

export interface BeaconCredentials {
  beaconId: string;
  secret: string;
  screen?: ScreenMetadata;
}

export type BeaconStatus = 'idle' | 'connecting' | 'live' | 'offline' | 'revoked' | 'replaced';

/** '#BEACON01.s3cr3t' from the one-time provisioning URL. */
export function parseProvisionHash(hash: string): BeaconCredentials | null {
  const raw = decodeURIComponent(hash.replace(/^#/, '')).trim();
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;
  return { beaconId: raw.slice(0, dot), secret: raw.slice(dot + 1) };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readBeacon(storage: StorageLike | null | undefined): BeaconCredentials | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(BEACON_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BeaconCredentials>;
    return typeof parsed.beaconId === 'string' && typeof parsed.secret === 'string'
      ? { beaconId: parsed.beaconId, secret: parsed.secret, ...(parsed.screen ? { screen: parsed.screen } : {}) }
      : null;
  } catch {
    return null;
  }
}

export function storeBeacon(storage: StorageLike | null | undefined, credentials: BeaconCredentials): void {
  try {
    storage?.setItem(BEACON_STORAGE_KEY, JSON.stringify(credentials));
  } catch {
    /* private mode: the screen still works until it is reloaded */
  }
}

export interface BeaconClientDeps {
  credentials: BeaconCredentials;
  createSocket?: (url: string) => WebSocketLike;
  wsBase?: string;
  hmac?: (secret: string, nonce: string) => Promise<string>;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  onCodes: (batch: CodeSlot[], serverNow: number) => void;
  onUnlocked: (unlock: { roomId: string; ticket: string; expiresAt: number }) => void;
  onRevoked: () => void;
  onStatus: (status: BeaconStatus) => void;
  onContext?: (screen: ScreenMetadata) => void;
  /** The DO refused a frame this client sent (its `error` word, e.g. 'bad-stop'). */
  onError?: (error: string) => void;
  presentationVersion?: 1;
  capabilities?: string[];
  onPaired?: (expiresAt: number) => void;
  onPresentation?: (presentation: ScreenPresentation) => void;
}

export interface BeaconClient {
  connect(): void;
  requestMore(): void;
  status(): BeaconStatus;
  close(): void;
  acknowledgePresentation(revision: number, status: 'displayed' | 'unavailable'): void;
  /** The settings panel's one frame: what this screen frames from now on. The
   *  DO validates both, stores them and answers with a `codes` frame carrying
   *  the new screen, which reaches onContext like any other. */
  setScreen(stopId: string | null, area: string): void;
}

export function createBeaconClient(deps: BeaconClientDeps): BeaconClient {
  const createSocket = deps.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
  const later = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const cancel = deps.clearTimeout ?? ((h) => globalThis.clearTimeout(h as never));
  const hmac = deps.hmac ?? ((secret, nonce) => hmacSha256Base64Url(secret, nonce));

  let socket: WebSocketLike | null = null;
  let status: BeaconStatus = 'idle';
  let attempt = 0;
  let retry: unknown = null;
  let stopped = false;

  function setStatus(next: BeaconStatus): void {
    if (status === next) return;
    status = next;
    deps.onStatus(next);
  }

  function send(message: BeaconClientMessage): void {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
  }

  function scheduleReconnect(): void {
    if (stopped || status === 'revoked') return;
    const ms = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
    attempt += 1;
    retry = later(() => {
      retry = null;
      open();
    }, ms);
  }

  function handle(message: BeaconServerMessage): void {
    switch (message.t) {
      case 'challenge':
        void hmac(deps.credentials.secret, message.nonce).then((mac) => send({ t: 'auth', hmac: mac, ...(deps.presentationVersion ? { presentationVersion: deps.presentationVersion } : {}),...(deps.capabilities?{capabilities:deps.capabilities}: {}) }));
        return;
      case 'paired': deps.onPaired?.(message.expiresAt); return;
      case 'presentation': deps.onPresentation?.(message.presentation); return;
      case 'codes':
        attempt = 0; // a batch means the screen is healthy; next drop retries fast
        setStatus('live');
        if (message.screen) deps.onContext?.(message.screen);
        deps.onCodes(message.batch, message.serverNow);
        return;
      case 'unlocked':
        deps.onUnlocked({ roomId: message.roomId, ticket: message.ticket, expiresAt: message.expiresAt });
        return;
      case 'error':
        deps.onError?.(message.error);
        return;
      case 'revoked':
        setStatus('revoked');
        deps.onRevoked();
        socket?.close(1000, 'revoked');
        return;
      default:
        return;
    }
  }

  function open(): void {
    setStatus('connecting');
    socket = createSocket(beaconSocketUrl(deps.credentials.beaconId, deps.wsBase));
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (parsed && typeof parsed === 'object' && typeof (parsed as { t?: unknown }).t === 'string') {
        handle(parsed as BeaconServerMessage);
      }
    });
    socket.addEventListener('close', (event) => {
      socket = null;
      if (status === 'revoked' || stopped) return;
      if (event.code === 4004) {
        stopped = true;
        setStatus('replaced');
        return;
      }
      setStatus('offline');
      scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      /* close always follows; the reconnect is armed there */
    });
    socket.addEventListener('open', () => {
      /* the DO challenges first; nothing to send until then */
    });
  }

  return {
    connect() {
      if (socket || stopped) return;
      open();
    },
    requestMore() {
      send({ t: 'more' });
    },
    acknowledgePresentation(revision, status) {
      send({ t: 'presented', version: 1, revision, status });
    },
    setScreen(stopId, area) {
      send({ t: 'screen-set', version: 1, stopId, area });
    },
    status: () => status,
    close() {
      stopped = true;
      if (retry !== null) {
        cancel(retry);
        retry = null;
      }
      socket?.close(1000, 'leave');
      socket = null;
    },
  };
}
