// Wire contract between the Worker, the Durable Objects and the browser code.
// Shared by worker/ and app/src/ (imported by relative path from both), so it
// must stay free of runtime dependencies.

/** Crockford base32: 0-9 and A-Z without I, L, O, U. 32 symbols, `byte % 32` is unbiased. */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 8;
/** Codes are displayed and typed as ABCD-EFGH. */
export const CODE_DISPLAY_SPLIT = 4;
/** Slots per batch a beacon mints at once (20 x 30 s = 10 minutes of display). */
export const CODES_PER_BATCH = 20;
/** A code is redeemable from slotStart - CODE_EARLY_MS to slotEnd + CODE_GRACE_MS. */
export const CODE_EARLY_MS = 5_000;
export const CODE_GRACE_MS = 30_000;

export type BeaconKind = 'kiosk' | 'phone';
export type VenueType = 'kafic' | 'knjiznica' | 'cetvrt' | 'udruga' | 'zet' | 'ostalo';
export type Role = 'kiosk' | 'scanner' | 'phone';

/** Minted code slot, sent to the beacon client in batches. */
export interface CodeSlot {
  code: string;
  /** Unix ms. */
  slotStart: number;
  slotEnd: number;
}

// ---- HTTP: POST /api/scan ------------------------------------------------

export interface ScanRequest {
  code: string;
}

export type ScanError =
  | 'bad-request'
  | 'code-unknown'
  | 'code-expired'
  | 'code-used'
  | 'screen-offline'
  | 'same-network'
  | 'slow-down'
  | 'rate-limited'
  | 'revoked';

export interface ScanOk {
  roomId: string;
  ticket: string;
  beaconType: BeaconKind;
  venueType: VenueType | null;
  /** One of the 17 gradske četvrti, or null for a phone beacon. */
  area: string | null;
  /** Unix ms. */
  expiresAt: number;
  participants: number;
  /** Operator label of the screen, e.g. "Kavana Velebit"; null for a phone. */
  screenLabel: string | null;
}

export interface ScanFail {
  error: ScanError;
  /** Human message in Croatian, safe to show. */
  message: string;
}

// ---- HTTP: POST /api/admin/beacons (Access-gated) -------------------------

export interface CreateBeaconRequest {
  venueType: VenueType;
  area: string;
  operatorLabel: string;
  /** Optional GTFS stop id shown on the kiosk teaser. */
  stopId?: string;
}

export interface CreateBeaconResponse {
  beaconId: string;
  /** Shown once; the kiosk stores it in localStorage. */
  secret: string;
  provisionUrl: string;
}

// ---- WebSocket: /ws/beacon/:beaconId (kiosk <-> BeaconDO) ------------------

export type BeaconClientMessage =
  | { t: 'auth'; hmac: string }
  | { t: 'more' } // request the next code batch
  | { t: 'pong' };

export type BeaconServerMessage =
  | { t: 'challenge'; nonce: string }
  | { t: 'codes'; batch: CodeSlot[]; serverNow: number }
  | { t: 'unlocked'; roomId: string; ticket: string; expiresAt: number }
  | { t: 'revoked' }
  | { t: 'error'; error: string };

// ---- WebSocket: /ws/room/:roomId (scanner, kiosk, phone <-> RoomDO) --------

export type RoomClientMessage =
  | { t: 'join'; ticket: string }
  | { t: 'resume'; resumeToken: string }
  | { t: 'view'; layer: LayerId; params?: Record<string, string> }
  | { t: 'share' }
  | { t: 'event'; name: ClientEvent; dim?: string };

export type RoomServerMessage =
  | {
      t: 'joined';
      role: Role;
      expiresAt: number;
      serverNow: number;
      resumeToken: string;
      dataToken: string;
      participants: number;
    }
  | { t: 'view'; layer: LayerId; params?: Record<string, string> }
  | { t: 'codes'; batch: CodeSlot[]; serverNow: number }
  | { t: 'count'; participants: number }
  | { t: 'expiring'; secondsLeft: number }
  | { t: 'expired' }
  | { t: 'error'; error: string };

/** WebSocket close code sent with 'expired'. */
export const CLOSE_SESSION_EXPIRED = 4000;

export type LayerId =
  | 'grad-sada'
  | 'u-pokretu'
  | 'zrak-i-nebo'
  | 'sigurnost'
  | 'uprava-i-pravo'
  | 'kultura'
  | 'vijesti';

export const LAYERS: readonly LayerId[] = [
  'grad-sada',
  'u-pokretu',
  'zrak-i-nebo',
  'sigurnost',
  'uprava-i-pravo',
  'kultura',
  'vijesti',
];

/** Client-side counter events; anything else is dropped by the room. */
export type ClientEvent = 'panel_open' | 'export';

/** Server-truth counter events written by the Worker and the DOs. */
export type ServerEvent =
  | 'session_start'
  | 'session_end'
  | 'scan_fail'
  | 'kiosk_online'
  | 'source_fetch'
  | 'hitno_view'
  | 'over_cap';

// ---- Data token (stateless, verified by the Worker) -------------------------

/** base64url(roomId) + '.' + expiresAtMs + '.' + base64url(HMAC-SHA256(SESSION_SECRET, roomId + '|' + expiresAtMs)) */
export type DataToken = string;
