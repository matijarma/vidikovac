// BeaconDO: one per public screen. Authenticates the kiosk socket with a
// nonce challenge, mints code batches aligned to wall-clock slots, registers
// them with IndexDO, and turns a redeemed code into a RoomDO session. Socket
// attachments hold only {phase} once authenticated; the challenge
// phase adds the nonce and the attempt counter for its few seconds of life.
import { DurableObject } from 'cloudflare:workers';
import { codeRotateSeconds, sessionMinutes, type NetworkCheck } from '../config';
import type { Env } from '../env';
import { logError } from '../log';
import { recordMetric, zagrebDayHour } from '../metrics';
import { areaName, isAreaSlug, isVenueType } from '../pairing/areas';
import { alignSlotStart, codeWindow, mintBatch } from '../pairing/codes';
import { screenStop, withDistrict } from '../pairing/stops';
import { base64UrlDecode, base64UrlEncode, constantTimeEqual, hmacSha256, randomBytes, randomId, signDataToken } from '../pairing/tokens';
import { parsePresentationCommand, type PresentationCommand, type PresentationResult, type PresentationState, type PresentationTarget } from '../presentation';
import {
  CODES_PER_BATCH,
  CODE_GRACE_MS,
  KEEPALIVE_REQUEST,
  KEEPALIVE_RESPONSE,
  type BeaconClientMessage,
  type BeaconServerMessage,
  type CodeSlot,
  type ScanError,
  type ScanOk,
  type VenueType,
  type ScreenMetadata,
  type ScreenStop,
} from '../protocol';
import { indexStub } from './index-do';
import { roomStub, type RoomOpenInput } from './room-do';

export const BEACON_ID_SHAPE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
// B6's own close codes. Same values as protocol.ts's CLOSE_AUTH_EXHAUSTED /
// CLOSE_REVOKED (shared with the browser), declared locally here by design
// (see task-B6-report.md "Rulings": the B7/C4 scan's ruling on close codes
// says these two are B6's affair and are not copied into room-do.ts).
export const CLOSE_AUTH_EXHAUSTED = 4002;
export const CLOSE_REVOKED = 4003;
export const MAX_AUTH_ATTEMPTS = 3;
export const SLOW_DOWN_FAILS = 20;
export const SLOW_DOWN_WINDOW_MS = 60_000;
export const CAP_PER_HOUR = 30;
export const CAP_PER_DAY = 200;
const CHALLENGE_MAX_AGE_MS = 10 * 60 * 1000;
const NONCE_BYTES = 32;
const OPERATOR_LABEL_MAX = 80;
const STOP_ID_SHAPE = /^[0-9A-Za-z_-]{1,32}$/;
// Provisioning secret shape: randomId(n) output (worker/routes/admin.ts mints
// 32 chars from 20 bytes), same alphabet as BEACON_ID_SHAPE. Bounded
// generously since the exact byte count is the admin route's concern, not
// BeaconDO's — only the character set and a sane length are enforced here.
const SECRET_SHAPE = /^[0-9A-HJKMNP-TV-Z]{16,64}$/;
/** One 'screen-set' per socket per this window; the rest are answered 'screen-set-rate' and change nothing (a settings panel must not be a way to mint batches). */
export const SCREEN_SET_MIN_MS = 5_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface BeaconCreateInput {
  beaconId: string;
  venueType: VenueType;
  area: string;
  operatorLabel: string;
  stopId: string | null;
  /**
   * The raw provisioning secret, shown once to the operator and never
   * re-derivable afterwards. Stored as-is and used directly as the kiosk
   * challenge's HMAC key, per protocol.ts's BEACON_AUTH: hmac =
   * base64url_unpadded(HMAC-SHA256(key = utf8(secret), message = utf8(nonce))) —
   * no hashing of the secret before use (rulings.md R-32; matches the kiosk's
   * own derivation so both sides key the HMAC identically).
   */
  secret: string;
  kind?: 'temporary' | 'venue';
  screenExpiresAt?: number;
  stop?: ScreenStop;
}

export type RedeemResult = { ok: true; scan: ScanOk } | { ok: false; error: ScanError };

type ChallengeAttachment = { phase: 'challenge'; nonce: string; issuedAt: number; attempts: number };
type AuthedAttachment = { phase: 'authed'; presentationVersion?: 1; capabilities?: string[]; screenSetAt?: number };
type SocketAttachment = ChallengeAttachment | AuthedAttachment;

type MetaRow = { key: string; value: string };
type CodeRow = { code: string; slot_start: number; slot_end: number; used: number };
interface StoredPresentation {
  revision: number;
  roomId: string | null;
  target: PresentationTarget | null;
  expiresAt: number | null;
  status: PresentationState['status'];
}

export function beaconStub(env: Env, beaconId: string): DurableObjectStub<BeaconDO> {
  const namespace = env.BEACON_DO as DurableObjectNamespace<BeaconDO>;
  return namespace.get(namespace.idFromName(beaconId));
}

function frame(message: BeaconServerMessage): string {
  return JSON.stringify(message);
}

function parseClient(message: string | ArrayBuffer): BeaconClientMessage | null {
  if (typeof message !== 'string' || message.length > 512) return null;
  try {
    const parsed = JSON.parse(message) as { t?: unknown; hmac?: unknown; presentationVersion?: unknown; version?: unknown; revision?: unknown; status?: unknown; capabilities?:unknown; stopId?: unknown; area?: unknown };
    if (parsed.t === 'auth' && typeof parsed.hmac === 'string' && parsed.hmac.length <= 64) return { t: 'auth', hmac: parsed.hmac, ...(parsed.presentationVersion === 1 ? { presentationVersion: 1 } : {}),
      ...(Array.isArray(parsed.capabilities)&&parsed.capabilities.includes('city-v1')?{capabilities:['city-v1']}: {}) };
    if (parsed.t === 'screen-set' && parsed.version === 1 && typeof parsed.area === 'string'
      && (parsed.stopId === null || typeof parsed.stopId === 'string')) {
      return { t: 'screen-set', version: 1, stopId: parsed.stopId as string | null, area: parsed.area };
    }
    if (parsed.version === 1 && Number.isSafeInteger(parsed.revision) && (parsed.revision as number) >= 0) {
      if (parsed.t === 'presented' && (parsed.status === 'displayed' || parsed.status === 'unavailable')) return { t: 'presented', version: 1, revision: parsed.revision as number, status: parsed.status };
      if (parsed.t === 'presentation-stop') return { t: 'presentation-stop', version: 1, revision: parsed.revision as number };
    }
    if (parsed.t === 'more') return { t: 'more' };
    if (parsed.t === 'ping' || parsed.t === 'pong') return { t: parsed.t };
    return null;
  } catch {
    return null;
  }
}

export class BeaconDO extends DurableObject<Env> {
  private socketsGone = new WeakSet<WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ensureSchema();
    });
    // Keepalive answered by the runtime without waking a hibernated object
    // (R-43: the pair is KEEPALIVE_REQUEST/KEEPALIVE_RESPONSE from protocol.ts,
    // shared with RoomDO and the browser).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(KEEPALIVE_REQUEST, KEEPALIVE_RESPONSE));
  }

  private ensureSchema(): void {
    const sql = this.ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS codes (code TEXT PRIMARY KEY, slot_start INTEGER NOT NULL, slot_end INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)');
    sql.exec('CREATE TABLE IF NOT EXISTS sessions (started_at INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS fails (at INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS presentation_rooms (room_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS presentation_requests (room_id TEXT NOT NULL, request_id TEXT NOT NULL, signature TEXT NOT NULL, PRIMARY KEY (room_id, request_id))');
  }

  now(): number {
    return Date.now();
  }

  // --- meta helpers ---------------------------------------------------------

  private meta(key: string): string | null {
    const rows = this.ctx.storage.sql.exec<MetaRow>(`SELECT key, value FROM meta WHERE key = ?`, key).toArray();
    return rows[0]?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.ctx.storage.sql.exec(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, key, value);
  }

  private exists(): boolean {
    return this.meta('beaconId') !== null;
  }

  private isRevoked(): boolean {
    const expiry = Number(this.meta('screenExpiresAt') ?? '0');
    return this.meta('revoked') === '1' || (expiry > 0 && this.now() >= expiry);
  }

  screenMetadata(): ScreenMetadata {
    const expiry = Number(this.meta('screenExpiresAt') ?? '0');
    const raw = this.meta('stop');
    const stop = raw ? JSON.parse(raw) as ScreenStop : null;
    const area = this.meta('area');
    return {
      kind: this.meta('kind') === 'temporary' ? 'temporary' : 'venue',
      expiresAt: expiry || null,
      stop: stop ? withDistrict(stop) : null,
      ...(area ? { area } : {}),
    };
  }

  private authenticatedSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => !this.socketsGone.has(ws) && (ws.deserializeAttachment() as SocketAttachment | null)?.phase === 'authed');
  }

  // The beacon, not the newest scanner's room, owns the public display.
  private presentationRecord(): StoredPresentation {
    const raw = this.meta('presentation');
    return raw ? JSON.parse(raw) as StoredPresentation : { revision: 0, roomId: null, target: null, expiresAt: null, status: 'idle' };
  }

  private presentationSockets(): WebSocket[] {
    return this.authenticatedSockets().filter(ws => (ws.deserializeAttachment() as AuthedAttachment).presentationVersion === 1);
  }

  private stateFor(roomId: string): PresentationState {
    const p = this.presentationRecord();
    return {
      version: 1, revision: p.revision, target: p.target, expiresAt: p.expiresAt, status: p.status,
      owner: p.roomId === null ? null : p.roomId === roomId ? 'self' : 'other',
      online: !this.isRevoked() && this.authenticatedSockets().length > 0,
      supported: this.presentationSockets().length > 0,
      capabilities: this.presentationSockets().some(ws=>(ws.deserializeAttachment() as AuthedAttachment).capabilities?.includes('city-v1'))?['city-v1']:[],
    };
  }

  private prunePresentations(): void {
    this.ctx.storage.sql.exec('DELETE FROM presentation_requests WHERE room_id IN (SELECT room_id FROM presentation_rooms WHERE expires_at <= ?)', this.now());
    this.ctx.storage.sql.exec('DELETE FROM presentation_rooms WHERE expires_at <= ?', this.now());
  }

  private notifyPresentation(): void {
    this.prunePresentations();
    const beaconId = this.meta('beaconId')!;
    // Do not await a callback into the room currently awaiting this beacon.
    const rooms = this.ctx.storage.sql.exec<{ room_id: string }>('SELECT room_id FROM presentation_rooms').toArray();
    this.ctx.waitUntil(Promise.all(rooms.map(({ room_id }) =>
      roomStub(this.env, room_id).presentationChanged(beaconId, this.stateFor(room_id))
        .catch(error => logError('presentation-notify-failed', error)),
    )));
  }

  private async sendPresentation(ws: WebSocket): Promise<void> {
    const p = this.presentationRecord();
    if ((ws.deserializeAttachment() as AuthedAttachment)?.presentationVersion !== 1) return;
    const newSubject=p.target?.selection?.kind==='place'||p.target?.selection?.kind==='street';
    if(newSubject&&!(ws.deserializeAttachment() as AuthedAttachment).capabilities?.includes('city-v1'))return;
    const token = p.roomId && p.expiresAt && p.expiresAt > this.now()
      ? await signDataToken(this.env, p.roomId, p.expiresAt) : undefined;
    // Signing yields: an older frame must not overtake a takeover or stop.
    if (this.presentationRecord().revision !== p.revision || this.isRevoked()) return;
    try {
      ws.send(frame({ t: 'presentation', presentation: {
        version: 1, revision: p.revision, target: p.target, expiresAt: p.expiresAt,
        ...(token ? { dataToken: token } : {}),
      } }));
    } catch (error) { logError('presentation-screen-send-failed', error); }
  }

  private publishPresentation(): void {
    this.notifyPresentation();
    this.ctx.waitUntil(Promise.all(this.presentationSockets().map(ws => this.sendPresentation(ws))));
    this.ctx.waitUntil(this.armPresentationAlarm());
  }

  private clearPresentation(): void {
    const p = this.presentationRecord();
    if (!p.target) return;
    this.setMeta('presentation', JSON.stringify({ revision: p.revision + 1, roomId: null, target: null, expiresAt: null, status: 'idle' } satisfies StoredPresentation));
    this.publishPresentation();
  }

  private expirePresentation(): void {
    const p = this.presentationRecord();
    if (p.expiresAt !== null && p.expiresAt <= this.now()) this.clearPresentation();
  }

  private async armPresentationAlarm(): Promise<void> {
    const screen = Number(this.meta('screenExpiresAt') ?? 0);
    const presentation = this.presentationRecord().expiresAt ?? 0;
    const binding = this.ctx.storage.sql.exec<{ at: number | null }>('SELECT MIN(expires_at) AS at FROM presentation_rooms').one().at ?? 0;
    const times = [screen, presentation, binding].filter(t => t > this.now());
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
    else if (!this.isRevoked()) await this.ctx.storage.deleteAlarm();
  }

  presentationStatus(roomId: string): PresentationState {
    this.expirePresentation();
    return this.stateFor(roomId);
  }

  async present(roomId: string, input: PresentationCommand): Promise<PresentationResult> {
    this.expirePresentation();
    this.prunePresentations();
    const result = (error?: PresentationResult['error']): PresentationResult => ({
      requestId: typeof input?.requestId === 'string' ? input.requestId : '',
      state: this.stateFor(roomId), ...(error ? { error } : {}),
    });
    const command = parsePresentationCommand(input);
    if (!command) return result('invalid-request');
    const binding = this.ctx.storage.sql.exec<{ expires_at: number }>('SELECT expires_at FROM presentation_rooms WHERE room_id = ?', roomId).toArray()[0];
    if (!binding || binding.expires_at <= this.now()) return result('not-allowed');
    if (this.isRevoked() || !this.authenticatedSockets().length) return result('unavailable');
    if (!this.presentationSockets().length) return result('unsupported');
    if((command.target?.selection?.kind==='place'||command.target?.selection?.kind==='street')&&!this.stateFor(roomId).capabilities?.includes('city-v1'))return result('unsupported');
    const signature = JSON.stringify(command);
    const receipt = this.ctx.storage.sql.exec<{ signature: string }>('SELECT signature FROM presentation_requests WHERE room_id = ? AND request_id = ?', roomId, command.requestId).toArray()[0];
    if (receipt) {
      if (receipt.signature !== signature) return result('invalid-request');
      // A retry reads the current truth, never revives a superseded request.
      this.ctx.waitUntil(Promise.all(this.presentationSockets().map(ws => this.sendPresentation(ws))));
      return result();
    }
    const p = this.presentationRecord();
    if (p.revision !== command.expectedRevision) return result('changed');
    if (command.action === 'stop' && p.roomId !== roomId) return result('not-allowed');
    if (command.action === 'present' && p.roomId && p.roomId !== roomId && !command.takeover) return result('occupied');
    const count = this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM presentation_requests WHERE room_id = ?', roomId).one().n;
    if (count >= 120) return result('too-many-requests');
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('INSERT INTO presentation_requests (room_id, request_id, signature) VALUES (?, ?, ?)', roomId, command.requestId, signature);
      this.setMeta('presentation', JSON.stringify({
        revision: p.revision + 1,
        roomId: command.action === 'present' ? roomId : null,
        target: command.action === 'present' ? command.target! : null,
        expiresAt: command.action === 'present' ? binding.expires_at : null,
        status: command.action === 'present' ? 'pending' : 'idle',
      } satisfies StoredPresentation));
    });
    this.publishPresentation();
    return result();
  }

  /** Called by a closing room; another visitor's presentation is unaffected. */
  releasePresentation(roomId: string): void {
    if (this.presentationRecord().roomId === roomId) this.clearPresentation();
    this.ctx.storage.sql.exec('DELETE FROM presentation_requests WHERE room_id = ?', roomId);
    this.ctx.storage.sql.exec('DELETE FROM presentation_rooms WHERE room_id = ?', roomId);
  }

  // --- RPC: provisioning ---------------------------------------------------

  async create(input: BeaconCreateInput): Promise<{ created: boolean }> {
    if (
      typeof input?.beaconId !== 'string' ||
      !BEACON_ID_SHAPE.test(input.beaconId) ||
      !isVenueType(input.venueType) ||
      !isAreaSlug(input.area) ||
      typeof input.operatorLabel !== 'string' ||
      input.operatorLabel.trim().length === 0 ||
      input.operatorLabel.length > OPERATOR_LABEL_MAX ||
      (input.stopId !== null && !STOP_ID_SHAPE.test(input.stopId)) ||
      typeof input.secret !== 'string' ||
      !SECRET_SHAPE.test(input.secret)
      || (input.kind !== undefined && input.kind !== 'temporary' && input.kind !== 'venue')
      || (input.kind === 'temporary' && (!Number.isFinite(input.screenExpiresAt) || input.screenExpiresAt! <= this.now()))
    ) {
      throw new Error('beacon-create-invalid');
    }
    if (this.exists()) return { created: false };
    this.ctx.storage.transactionSync(() => {
      this.setMeta('beaconId', input.beaconId);
      this.setMeta('venueType', input.venueType);
      this.setMeta('area', input.area);
      this.setMeta('operatorLabel', input.operatorLabel.trim());
      this.setMeta('stopId', input.stopId ?? '');
      this.setMeta('secret', input.secret);
      this.setMeta('revoked', '0');
      this.setMeta('createdAt', String(this.now()));
      this.setMeta('kind', input.kind ?? 'venue');
      if (input.screenExpiresAt) this.setMeta('screenExpiresAt', String(input.screenExpiresAt));
      if (input.stop) this.setMeta('stop', JSON.stringify(input.stop));
    });
    if (input.screenExpiresAt) await this.ctx.storage.setAlarm(input.screenExpiresAt);
    return { created: true };
  }

  async revoke(): Promise<void> {
    if (!this.exists()) return;
    this.setMeta('revoked', '1');
    const codes = this.ctx.storage.sql.exec<{ code: string }>(`SELECT code FROM codes`).toArray().map((r) => r.code);
    this.ctx.storage.sql.exec(`DELETE FROM codes`);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(frame({ t: 'revoked' }));
        ws.close(CLOSE_REVOKED, 'revoked');
      } catch (error) {
        logError('beacon-revoke-close-failed', error);
      }
    }
    if (codes.length > 0) {
      // Expire the index rows now rather than waiting for the purge.
      await indexStub(this.env).register(codes.map((code) => ({ code, kind: 'kiosk' as const, ownerId: this.meta('beaconId')!, expiresAt: 0 })));
    }
  }

  status(): { exists: boolean; revoked: boolean; kioskOnline: boolean; codes: number } {
    return {
      exists: this.exists(),
      revoked: this.isRevoked(),
      kioskOnline: this.authenticatedSockets().length > 0,
      codes: this.ctx.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM codes`).one().n,
    };
  }

  // --- WebSocket: kiosk ------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET' || request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 400 });
    }
    if (!this.exists()) return new Response('unknown beacon', { status: 404 });
    if (this.isRevoked()) return new Response('screen expired or revoked', { status: 410 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, ['kiosk']);
    const nonce = base64UrlEncode(randomBytes(NONCE_BYTES));
    const attachment: ChallengeAttachment = { phase: 'challenge', nonce, issuedAt: this.now(), attempts: 0 };
    server.serializeAttachment(attachment);
    server.send(frame({ t: 'challenge', nonce }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (attachment === null) {
      ws.close(CLOSE_AUTH_EXHAUSTED, 'no-session');
      return;
    }
    const parsed = parseClient(message);
    if (attachment.phase === 'challenge') {
      if (parsed?.t !== 'auth') {
        this.rejectChallenge(ws, attachment, 'auth-required');
        return;
      }
      await this.handleAuth(ws, attachment, parsed.hmac, parsed.presentationVersion,parsed.capabilities);
      return;
    }
    if (parsed === null) {
      ws.send(frame({ t: 'error', error: 'bad-frame' }));
      return;
    }
    if (attachment.presentationVersion === 1 && parsed.t === 'presented') {
      this.expirePresentation();
      const p = this.presentationRecord();
      if (p.target && parsed.revision === p.revision) {
        this.setMeta('presentation', JSON.stringify({ ...p, status: parsed.status }));
        this.notifyPresentation();
      }
      return;
    }
    if (attachment.presentationVersion === 1 && parsed.t === 'presentation-stop') {
      if (parsed.revision === this.presentationRecord().revision) this.clearPresentation();
      return;
    }
    if (parsed.t === 'screen-set') {
      await this.setScreen(ws, attachment, parsed.stopId, parsed.area);
      return;
    }
    if (parsed.t === 'more') {
      if (this.isRevoked()) {
        ws.send(frame({ t: 'revoked' }));
        ws.close(CLOSE_REVOKED, 'revoked');
        return;
      }
      await this.sendBatch(ws);
    }
    // 'ping' is normally auto-answered by setWebSocketAutoResponse without
    // waking the object; a stray one that reaches here (e.g. right after a
    // wake for another reason) is a no-op.
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    this.noteSocketGone(ws);
    // The Hibernatable WebSockets API delivers the peer's closing frame here
    // but does not itself finish the closing handshake; this side must also
    // call ws.close(), or the socket lingers and the peer's 'close' event
    // never fires. A harmless no-op when this side closed first (e.g. revoke()).
    try {
      ws.close(code, reason);
    } catch {
      // Already closed from this side; nothing to acknowledge.
    }
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    logError('beacon-websocket-error', error, { beaconId: this.meta('beaconId') ?? undefined });
    this.noteSocketGone(ws);
  }

  /** Double-fire guard (close and error can both fire for one socket). Nothing to broadcast here; kept for symmetry and logging. */
  private noteSocketGone(ws: WebSocket): void {
    if (this.socketsGone.has(ws)) return;
    this.socketsGone.add(ws);
    this.notifyPresentation();
  }

  private async handleAuth(ws: WebSocket, attachment: ChallengeAttachment, hmac: string, presentationVersion?: 1,capabilities?:string[]): Promise<void> {
    if (this.isRevoked()) {
      ws.send(frame({ t: 'revoked' }));
      ws.close(CLOSE_REVOKED, 'revoked');
      return;
    }
    const secret = this.meta('secret');
    const given = base64UrlDecode(hmac);
    if (secret === null || given === null) {
      this.rejectChallenge(ws, attachment, 'auth-failed');
      return;
    }
    // BEACON_AUTH (protocol.ts, R-32): key = utf8(secret) raw, no pre-hash.
    // hmacSha256 accepts a string key/message and utf8-encodes it internally.
    const expected = await hmacSha256(secret, attachment.nonce);
    if (!constantTimeEqual(expected, given)) {
      this.rejectChallenge(ws, attachment, 'auth-failed');
      return;
    }
    const authed: AuthedAttachment = { phase: 'authed', ...(presentationVersion ? { presentationVersion } : {}),...(capabilities?{capabilities}: {}) };
    ws.serializeAttachment(authed);
    await this.markOnline();
    await this.sendBatch(ws);
    if (presentationVersion === 1) {
      // A provisioned screen is a single physical display. A reload replaces
      // the old connection, preventing acknowledgements from a ghost tab.
      for (const previous of this.authenticatedSockets()) {
        if (previous === ws) continue;
        this.socketsGone.add(previous);
        try { previous.close(4004, 'screen-replaced'); } catch { /* already closed */ }
      }
      this.expirePresentation();
      const current = this.presentationRecord();
      if (current.target) {
        // A fresh screen connection must confirm its own paint. An old
        // connection's acknowledgement cannot certify this renderer.
        this.setMeta('presentation', JSON.stringify({ ...current, revision: current.revision + 1, status: 'pending' }));
      }
      await this.sendPresentation(ws);
    }
    this.notifyPresentation();
  }

  private rejectChallenge(ws: WebSocket, attachment: ChallengeAttachment, code: string): void {
    const attempts = attachment.attempts + 1;
    const stale = this.now() - attachment.issuedAt > CHALLENGE_MAX_AGE_MS;
    if (attempts >= MAX_AUTH_ATTEMPTS || stale) {
      ws.close(CLOSE_AUTH_EXHAUSTED, stale ? 'challenge-expired' : 'too-many-attempts');
      return;
    }
    const nonce = base64UrlEncode(randomBytes(NONCE_BYTES));
    ws.serializeAttachment({ ...attachment, nonce, attempts } satisfies ChallengeAttachment);
    ws.send(frame({ t: 'error', error: code }));
    ws.send(frame({ t: 'challenge', nonce }));
  }

  private async markOnline(): Promise<void> {
    const today = zagrebDayHour(new Date(this.now())).day;
    if (this.meta('lastOnlineDay') === today) return;
    this.setMeta('lastOnlineDay', today);
    if (this.screenMetadata().kind === 'temporary') {
      void recordMetric(this.env, 'evaluation', 'kiosk_online', this.meta('area') ?? '');
    } else {
      void recordMetric(this.env, 'kiosk_online', this.meta('area') ?? '');
    }
  }

  // --- codes -----------------------------------------------------------------

  /** Every unused code that is still redeemable, oldest slot first. */
  private liveSlots(now: number): CodeSlot[] {
    return this.ctx.storage.sql
      .exec<{ code: string; slot_start: number; slot_end: number }>(
        `SELECT code, slot_start, slot_end FROM codes WHERE used = 0 AND slot_end + ? > ? ORDER BY slot_start`,
        CODE_GRACE_MS,
        now,
      )
      .toArray()
      .map((row) => ({ code: row.code, slotStart: row.slot_start, slotEnd: row.slot_end }));
  }

  /**
   * Sends the union of every still-valid unused code, minting a fresh batch
   * only when fewer than CODES_PER_BATCH remain (R-51).
   *
   * Sending just the freshly minted slots left the screen codeless: the client
   * replaces its batch on every `codes` frame, so after a `more` (which mints
   * from the end of the previous batch) the new slots all started in the
   * future and there was no current code for a minute, and after a reconnect
   * or a reload — a Wi-Fi blip, a TV browser restart, F5 — for up to ten
   * minutes. The union keeps whatever the screen was already showing valid
   * and redeemable across both paths.
   */
  private async sendBatch(ws: WebSocket): Promise<void> {
    const now = this.now();
    const slotMs = codeRotateSeconds(this.env) * 1000;
    const sql = this.ctx.storage.sql;
    sql.exec(`DELETE FROM codes WHERE slot_end + ? < ?`, CODE_GRACE_MS, now);

    if (this.liveSlots(now).length < CODES_PER_BATCH) {
      const last = sql.exec<{ m: number | null }>(`SELECT MAX(slot_end) AS m FROM codes`).one().m;
      const start = last !== null && last > now ? last : alignSlotStart(now, slotMs);
      let minted: CodeSlot[] = [];
      for (let attempt = 0; attempt < 3 && minted.length === 0; attempt += 1) {
        const candidate = mintBatch(start, slotMs, CODES_PER_BATCH);
        const collision = candidate.some((s) => sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM codes WHERE code = ?`, s.code).one().n > 0);
        if (!collision) minted = candidate;
      }
      if (minted.length === 0) throw new Error('code-collision');
      this.ctx.storage.transactionSync(() => {
        for (const slot of minted) sql.exec(`INSERT INTO codes (code, slot_start, slot_end, used) VALUES (?, ?, ?, 0)`, slot.code, slot.slotStart, slot.slotEnd);
      });
      const beaconId = this.meta('beaconId')!;
      await indexStub(this.env).register(minted.map((s) => ({ code: s.code, kind: 'kiosk' as const, ownerId: beaconId, expiresAt: s.slotEnd + CODE_GRACE_MS })));
    }

    ws.send(frame({ t: 'codes', batch: this.liveSlots(this.now()), serverNow: this.now(), screen: this.screenMetadata() }));
  }

  /**
   * The screen's own settings panel changed what this screen frames: a stop
   * (null for none) and one area. Both are validated here -- the browser is
   * not trusted with either -- and the answer is an ordinary 'codes' frame
   * carrying the new metadata, the same path a DO-side stop change takes, so
   * the kiosk re-frames itself through applyScreen() and nothing else.
   *
   * Only an authenticated kiosk socket reaches this, at most once every
   * SCREEN_SET_MIN_MS: a repeat inside the window writes nothing and mints
   * nothing, so a stuck panel can neither rewrite the meta in a loop nor pull
   * code batches. It is still answered -- with 'screen-set-rate', one small
   * frame -- because a panel that hears nothing at all cannot tell a refusal
   * from a screen that has stopped listening.
   */
  private async setScreen(ws: WebSocket, attachment: AuthedAttachment, stopId: string | null, area: string): Promise<void> {
    if (this.isRevoked()) return;
    if (!isAreaSlug(area)) { ws.send(frame({ t: 'error', error: 'bad-area' })); return; }
    const stop = stopId === null ? null : screenStop(stopId);
    if (stopId !== null && !stop) { ws.send(frame({ t: 'error', error: 'bad-stop' })); return; }
    const now = this.now();
    if (attachment.screenSetAt !== undefined && now - attachment.screenSetAt < SCREEN_SET_MIN_MS) {
      ws.send(frame({ t: 'error', error: 'screen-set-rate' }));
      return;
    }
    ws.serializeAttachment({ ...attachment, screenSetAt: now } satisfies AuthedAttachment);
    this.ctx.storage.transactionSync(() => {
      this.setMeta('area', area);
      this.setMeta('stopId', stop?.id ?? '');
      // An empty blob is no stop: screenMetadata() reads the absence, and the
      // row stays so the key is written in one shape either way.
      this.setMeta('stop', stop ? JSON.stringify(stop) : '');
    });
    await this.sendBatch(ws);
  }

  // --- RPC: redeem -----------------------------------------------------------

  /** Legacy extra arguments are ignored; no network identity is read or stored. */
  async redeem(code: string, _legacyNetworkKey?: string, _legacyMode?: NetworkCheck): Promise<RedeemResult> {
    const now = this.now();
    if (!this.exists()) return { ok: false, error: 'code-unknown' };
    if (this.isRevoked()) return { ok: false, error: 'revoked' };
    const slowUntil = Number(this.meta('slowUntil') ?? '0');
    if (slowUntil > now) return { ok: false, error: 'slow-down' };

    const row = this.ctx.storage.sql.exec<CodeRow>(`SELECT * FROM codes WHERE code = ?`, code).toArray()[0];
    if (row === undefined) return this.fail(now, 'code-unknown');
    if (row.used === 1) return this.fail(now, 'code-used');
    if (codeWindow({ slotStart: row.slot_start, slotEnd: row.slot_end }, now) !== 'open') return this.fail(now, 'code-expired');

    const kioskSockets = this.authenticatedSockets();
    if (kioskSockets.length === 0) return this.fail(now, 'screen-offline');

    // Flip the code atomically; a concurrent redeem of the same code sees used = 1.
    const flipped = this.ctx.storage.sql.exec(`UPDATE codes SET used = 1 WHERE code = ? AND used = 0`, code).rowsWritten;
    if (flipped === 0) return this.fail(now, 'code-used');

    const expiresAt = now + Math.round(sessionMinutes(this.env) * 60_000);
    const roomId = randomId(10);
    const scannerTicket = randomId(16);
    const kioskTicket = randomId(16);
    const venueType = this.meta('venueType') as VenueType;
    const areaSlug = this.meta('area')!;
    const screenLabel = this.meta('operatorLabel')!;
    const open: RoomOpenInput = {
      roomId,
      expiresAt,
      beaconType: 'kiosk',
      venueType,
      area: areaSlug,
      screenLabel,
      screen: this.screenMetadata(),
      beaconId: this.meta('beaconId')!,
      tickets: [
        { ticket: scannerTicket, role: 'scanner' },
        { ticket: kioskTicket, role: 'kiosk' },
      ],
    };
    const opened = await roomStub(this.env, roomId).open(open);
    this.prunePresentations();
    this.ctx.storage.sql.exec('INSERT INTO presentation_rooms (room_id, expires_at) VALUES (?, ?)', roomId, expiresAt);
    this.ctx.waitUntil(this.armPresentationAlarm());

    this.countSession(now, areaSlug);

    for (const ws of kioskSockets) {
      try {
        if ((ws.deserializeAttachment() as AuthedAttachment).presentationVersion === 1) {
          ws.send(frame({ t: 'paired', expiresAt }));
        } else ws.send(frame({ t: 'unlocked', roomId, ticket: kioskTicket, expiresAt }));
      } catch (error) {
        logError('beacon-unlocked-send-failed', error);
      }
    }
    return {
      ok: true,
      scan: {
        roomId,
        ticket: scannerTicket,
        beaconType: 'kiosk',
        venueType,
        area: isAreaSlug(areaSlug) ? areaName(areaSlug) : areaSlug,
        expiresAt,
        participants: opened.participants,
        screenLabel,
        screen: this.screenMetadata(),
      },
    };
  }

  /** Only this screen and its codes expire; already opened rooms keep their grant. */
  async alarm(): Promise<void> {
    this.expirePresentation();
    this.prunePresentations();
    const expiry = Number(this.meta('screenExpiresAt') ?? '0');
    if (!expiry || this.now() < expiry) { await this.armPresentationAlarm(); return; }
    await this.revoke();
    if (this.now() < expiry + 15 * 60_000) {
      await this.ctx.storage.setAlarm(expiry + 15 * 60_000);
    } else {
      await this.ctx.storage.deleteAll();
      this.ensureSchema();
    }
  }

  private fail(now: number, error: ScanError): RedeemResult {
    const sql = this.ctx.storage.sql;
    sql.exec(`DELETE FROM fails WHERE at <= ?`, now - SLOW_DOWN_WINDOW_MS);
    sql.exec(`INSERT INTO fails (at) VALUES (?)`, now);
    const recent = sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM fails`).one().n;
    if (recent >= SLOW_DOWN_FAILS) {
      this.setMeta('slowUntil', String(now + SLOW_DOWN_WINDOW_MS));
      sql.exec(`DELETE FROM fails`);
    }
    return { ok: false, error };
  }

  /**
   * Counted-session caps: 30 per rolling hour, 200 per rolling day. Overflow is a
   * session all the same, just recorded as over_cap. dim1 is the venue type the
   * screen was provisioned with (the City dataset's "vrsta prostora"); a
   * temporary evaluation screen is counted under `evaluation` instead.
   */
  private countSession(now: number, areaSlug: string): void {
    const sql = this.ctx.storage.sql;
    const venueType = this.meta('venueType') ?? 'ostalo';
    sql.exec(`DELETE FROM sessions WHERE started_at <= ?`, now - DAY_MS);
    const hour = sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM sessions WHERE started_at > ?`, now - HOUR_MS).one().n;
    const day = sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM sessions`).one().n;
    if (hour >= CAP_PER_HOUR || day >= CAP_PER_DAY) {
      void recordMetric(this.env, this.screenMetadata().kind === 'temporary' ? 'evaluation' : 'over_cap',
        this.screenMetadata().kind === 'temporary' ? 'over_cap' : venueType, areaSlug);
      return;
    }
    sql.exec(`INSERT INTO sessions (started_at) VALUES (?)`, now);
    void recordMetric(this.env, this.screenMetadata().kind === 'temporary' ? 'evaluation' : 'session_start',
      this.screenMetadata().kind === 'temporary' ? 'session_start' : venueType, areaSlug);
  }
}
