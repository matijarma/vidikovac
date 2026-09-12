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

/** Beacon ids are 8 characters from CODE_ALPHABET (same alphabet as codes, not secret). */
export const BEACON_ID_LENGTH = 8;

export type BeaconKind = 'kiosk' | 'phone';
export type VenueType = 'kafic' | 'knjiznica' | 'cetvrt' | 'udruga' | 'zet' | 'ostalo';
export type Role = 'kiosk' | 'scanner' | 'phone';

export interface ScreenStop {
  id: string;
  name: string;
  lon: number;
  lat: number;
  routes: string[];
}

export interface ScreenMetadata {
  kind: 'temporary' | 'venue';
  expiresAt: number | null;
  stop: ScreenStop | null;
}

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
  screen?: ScreenMetadata;
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
  screen?: ScreenMetadata;
}

// ---- WebSocket: /ws/beacon/:beaconId (kiosk <-> BeaconDO) ------------------

export type BeaconClientMessage =
  | { t: 'auth'; hmac: string }
  | { t: 'more' } // request the next code batch
  | { t: 'ping' } // keepalive, answered by the DO's auto-response without waking it
  | { t: 'pong' };

export type BeaconServerMessage =
  | { t: 'challenge'; nonce: string }
  | { t: 'codes'; batch: CodeSlot[]; serverNow: number; screen?: ScreenMetadata }
  | { t: 'unlocked'; roomId: string; ticket: string; expiresAt: number }
  | { t: 'revoked' }
  | { t: 'pong' }
  | { t: 'error'; error: string };

/** Keepalive pair for every socket: client sends KEEPALIVE_REQUEST, the DO auto-responds KEEPALIVE_RESPONSE. */
export const KEEPALIVE_REQUEST = '{"t":"ping"}';
export const KEEPALIVE_RESPONSE = '{"t":"pong"}';

// ---- WebSocket: /ws/room/:roomId (scanner, kiosk, phone <-> RoomDO) --------

export type RoomClientMessage =
  | { t: 'join'; ticket: string }
  | { t: 'resume'; resumeToken: string }
  | { t: 'view'; layer: LayerId; params?: Record<string, string> }
  | { t: 'share' }
  | { t: 'event'; name: ClientEvent; dim?: string }
  | { t: 'ping' };

export type RoomServerMessage =
  | {
      t: 'joined';
      role: Role;
      expiresAt: number;
      serverNow: number;
      resumeToken: string;
      dataToken: string;
      participants: number;
      screen?: ScreenMetadata;
    }
  | { t: 'view'; layer: LayerId; params?: Record<string, string> }
  | { t: 'codes'; batch: CodeSlot[]; serverNow: number }
  | { t: 'count'; participants: number }
  | { t: 'expiring'; secondsLeft: number }
  | { t: 'expired' }
  | { t: 'pong' }
  | { t: 'error'; error: string };

/** WebSocket close code sent with 'expired'. */
export const CLOSE_SESSION_EXPIRED = 4000;
/** Beacon socket closed after three failed challenge answers. */
export const CLOSE_AUTH_EXHAUSTED = 4002;
/** Beacon revoked by the operator; codes are void. */
export const CLOSE_REVOKED = 4003;
/** A newer socket replaced this one (same beacon or same resume token). */
export const CLOSE_REPLACED = 4004;

/**
 * Kiosk challenge answer: hmac = base64url_unpadded(HMAC-SHA256(key = utf8(secret),
 * message = utf8(nonce))). The secret is the raw provisioning secret string;
 * no hashing of the secret before use. Implemented identically in
 * worker/do/beacon-do.ts and app/src/beacon.ts.
 */
export const BEACON_AUTH = 'HMAC-SHA256(utf8(secret), utf8(nonce)) as unpadded base64url';

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
export const CLIENT_EVENTS = ['panel_open', 'export'] as const;
export type ClientEvent = (typeof CLIENT_EVENTS)[number];

/** The dim of an 'export' event; shared by the room's allowlist and the app's export actions. */
export const EXPORT_KINDS = ['copy', 'share', 'ics', 'geojson', 'print'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/**
 * Croatian sentences for every ScanError, the single source for the Worker's
 * ScanFail.message and for app/src/i18n/hr.json (scan.errors.*), which a test
 * asserts equal. English lives only in en.json.
 */
export const SCAN_MESSAGES_HR: Record<ScanError, string> = {
  'bad-request': 'Kod nije u ispravnom obliku.',
  'code-unknown': 'Taj kod ne postoji ili je prošao. Pogledaj zaslon i skeniraj ponovno.',
  'code-expired': 'Kod je istekao. Zaslon već pokazuje novi.',
  'code-used': 'Taj je kod već iskorišten. Pričekaj novi na zaslonu.',
  'screen-offline': 'Zaslon je trenutačno bez veze. Pokušaj za minutu.',
  'same-network': 'Ovaj zaslon i tvoj telefon dijele istu mrežu. Isključi Wi-Fi i skeniraj mobilnim podacima.',
  'slow-down': 'Previše pokušaja. Pričekaj minutu.',
  'rate-limited': 'Previše pokušaja s ove mreže. Pričekaj minutu.',
  revoked: 'Ovaj je zaslon isključen.',
};

/** Server-truth counter events written by the Worker and the DOs. */
export const SERVER_EVENTS = [
  'session_start',
  'session_end',
  'scan_fail',
  'kiosk_online',
  'source_fetch',
  'hitno_view',
  'over_cap',
  'evaluation',
] as const;
export type ServerEvent = (typeof SERVER_EVENTS)[number];

// ---- Data token (stateless, verified by the Worker) -------------------------

/** base64url(roomId) + '.' + expiresAtMs + '.' + base64url(HMAC-SHA256(SESSION_SECRET, roomId + '|' + expiresAtMs)) */
export type DataToken = string;
