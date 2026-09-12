// RoomDO: one per session — a kiosk unlock (two tickets: scanner and kiosk) or
// a peer grant (one ticket, five minutes, no screen). It holds the tickets, the
// participants and the code batch a phone may share, forwards the driver's
// chosen view to the screen, and runs the idempotent expiry chain
// live -> warned60 -> warned20 -> closed, wiping itself at the end.
//
// Privacy: nothing here identifies anyone. A participant is a random resume
// token, a role and a joined-at; the socket attachment holds those three fields
// and nothing else (no address, no netKey, no user agent), so a hibernated
// socket carries no identifier through the runtime either.
//
// Socket idioms ported from D:\scratch\psdlat\worker\src\mesh-do.ts:
// the hibernation upgrade (476-527), the webSocketClose/webSocketError pair
// with the `socketsGone` double-fire guard (529-575), and the idempotent,
// self-rearming alarm (2726-2829).
import { DurableObject } from 'cloudflare:workers';
import { codeRotateSeconds, peerMinutes } from '../config';
import type { Env } from '../env';
import { logError } from '../log';
import { recordMetric } from '../metrics';
import { alignSlotStart, codeWindow, mintBatch } from '../pairing/codes';
import { randomId, signDataToken } from '../pairing/tokens';
import { parseSelection, selectionParams } from '../public-selection';
import {
  CLIENT_EVENTS,
  CLOSE_REPLACED,
  CLOSE_SESSION_EXPIRED,
  CODES_PER_BATCH,
  CODE_GRACE_MS,
  EXPORT_KINDS,
  KEEPALIVE_REQUEST,
  KEEPALIVE_RESPONSE,
  LAYERS,
  type BeaconKind,
  type ClientEvent,
  type CodeSlot,
  type LayerId,
  type Role,
  type RoomClientMessage,
  type RoomServerMessage,
  type ScanError,
  type ScanOk,
  type VenueType,
  type ScreenMetadata,
  type ServerEvent,
} from '../protocol';
import { indexStub } from './index-do';

/** randomId(10) → 16 Crockford symbols. */
export const ROOM_ID_SHAPE = /^[0-9A-HJKMNP-TV-Z]{16}$/;
/** randomId(16) → 26 Crockford symbols (tickets and resume tokens). */
const TICKET_SHAPE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
/** Counters a single socket may contribute in one session; beyond this they are dropped. */
export const EVENTS_PER_SOCKET_MAX = 60;
export const WARN_60_MS = 60_000;
export const WARN_20_MS = 20_000;

const PARAMS_MAX_KEYS = 8;
const PARAMS_MAX_CHARS = 64;
const FRAME_MAX_CHARS = 2048;
const TICKETS_MAX = 4;

export type Phase = 'none' | 'live' | 'warned60' | 'warned20' | 'closed';

const PHASE_ORDER: Record<Phase, number> = { none: 0, live: 1, warned60: 2, warned20: 3, closed: 4 };

export interface RoomTicket {
  ticket: string;
  role: Role;
}

export interface RoomOpenInput {
  roomId: string;
  /** Unix ms; the session dies here whatever happens. */
  expiresAt: number;
  beaconType: BeaconKind;
  venueType: VenueType | null;
  /** Area slug for the counters; null for a phone-granted room. */
  area: string | null;
  screenLabel: string | null;
  screen?: ScreenMetadata;
  tickets: RoomTicket[];
}

/** Everything a hibernated socket needs, and nothing that could identify a person. */
export interface RoomAttachment {
  role: Role;
  joinedAt: number;
  resumeToken: string;
}

export type RedeemPeerResult = { ok: true; scan: ScanOk } | { ok: false; error: ScanError };

/** Coarse buckets for the session_end counter (R-24: dimension values, not a vocabulary). */
export type DurationBucket = '<1min' | '1-5min' | '5-10min' | '10min';

/**
 * Rounded to the nearest minute, so a ten-minute session that closes a few
 * milliseconds before its nominal expiry is still counted as a full one.
 */
export function durationBucket(ms: number): DurationBucket {
  const minutes = Math.round(Math.max(0, ms) / 60_000);
  if (minutes < 1) return '<1min';
  if (minutes <= 5) return '1-5min';
  if (minutes < 10) return '5-10min';
  return '10min';
}

type MetaRow = { key: string; value: string };
type TicketRow = { ticket: string; role: string; used: number };
type ParticipantRow = { resume_token: string; role: string; joined_at: number; events: number };
type CodeRow = { code: string; slot_start: number; slot_end: number; used: number };

export function roomStub(env: Env, roomId: string): DurableObjectStub<RoomDO> {
  const namespace = env.ROOM_DO as DurableObjectNamespace<RoomDO>;
  return namespace.get(namespace.idFromName(roomId));
}

function frame(message: RoomServerMessage): string {
  return JSON.stringify(message);
}

function isLayer(value: unknown): value is LayerId {
  return typeof value === 'string' && (LAYERS as readonly string[]).includes(value);
}

function isRole(value: unknown): value is Role {
  return value === 'kiosk' || value === 'scanner' || value === 'phone';
}

// R-17/R-24: the allowlist is membership in the protocol's own array, not a second list.
const CLIENT_EVENT_SET: ReadonlySet<string> = new Set(CLIENT_EVENTS);

function isClientEvent(value: unknown): value is ClientEvent {
  return typeof value === 'string' && CLIENT_EVENT_SET.has(value);
}

/** Every frame the room accepts, validated into the shared union or rejected. */
function parseClient(message: string | ArrayBuffer): RoomClientMessage | null {
  if (typeof message !== 'string' || message.length > FRAME_MAX_CHARS) return null;
  let parsed: {
    t?: unknown;
    ticket?: unknown;
    resumeToken?: unknown;
    layer?: unknown;
    params?: unknown;
    name?: unknown;
    dim?: unknown;
  };
  try {
    parsed = JSON.parse(message) as typeof parsed;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  switch (parsed.t) {
    case 'join':
      return typeof parsed.ticket === 'string' && parsed.ticket.length <= 64
        ? { t: 'join', ticket: parsed.ticket }
        : null;
    case 'resume':
      return typeof parsed.resumeToken === 'string' && parsed.resumeToken.length <= 64
        ? { t: 'resume', resumeToken: parsed.resumeToken }
        : null;
    case 'view': {
      if (!isLayer(parsed.layer)) return null;
      if (parsed.params === undefined) return { t: 'view', layer: parsed.layer };
      if (typeof parsed.params !== 'object' || parsed.params === null || Array.isArray(parsed.params)) return null;
      const entries = Object.entries(parsed.params as Record<string, unknown>);
      if (entries.length > PARAMS_MAX_KEYS) return null;
      const selection = parseSelection(parsed.params);
      if (entries.length && !selection) return null;
      return { t: 'view', layer: parsed.layer, ...(selection ? { params: selectionParams(selection) } : {}) };
    }
    case 'share':
      return { t: 'share' };
    case 'ping':
      // setWebSocketAutoResponse is best-effort, not a guarantee: a ping that
      // races a wake for another reason can still reach here (beacon-do.ts).
      return { t: 'ping' };
    case 'event': {
      if (!isClientEvent(parsed.name)) return null;
      if (parsed.dim === undefined) return { t: 'event', name: parsed.name };
      if (typeof parsed.dim !== 'string' || parsed.dim.length > PARAMS_MAX_CHARS) return null;
      return { t: 'event', name: parsed.name, dim: parsed.dim };
    }
    default:
      return null;
  }
}

export class RoomDO extends DurableObject<Env> {
  /** psdlat mesh-do 529-575: close and error can both fire for one socket. */
  private socketsGone = new WeakSet<WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ensureSchema();
    });
    // Keepalive answered by the runtime without waking a hibernated object; the
    // pair is matched before webSocketMessage, so 'ping' never reaches parseClient.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(KEEPALIVE_REQUEST, KEEPALIVE_RESPONSE));
  }

  /** Wall clock; a method so tests can pin it with vi.spyOn. */
  now(): number {
    return Date.now();
  }

  private ensureSchema(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    sql.exec(
      `CREATE TABLE IF NOT EXISTS tickets (
         ticket TEXT PRIMARY KEY,
         role TEXT NOT NULL,
         used INTEGER NOT NULL DEFAULT 0
       )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS participants (
         resume_token TEXT PRIMARY KEY,
         role TEXT NOT NULL,
         joined_at INTEGER NOT NULL,
         events INTEGER NOT NULL DEFAULT 0
       )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS codes (
         code TEXT PRIMARY KEY,
         slot_start INTEGER NOT NULL,
         slot_end INTEGER NOT NULL,
         used INTEGER NOT NULL DEFAULT 0
       )`,
    );
  }

  private meta(key: string): string | null {
    return this.ctx.storage.sql.exec<MetaRow>(`SELECT key, value FROM meta WHERE key = ?`, key).toArray()[0]?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }

  private screenMetadata(): ScreenMetadata | undefined {
    const raw = this.meta('screen');
    return raw ? JSON.parse(raw) as ScreenMetadata : undefined;
  }

  isEvaluation(): boolean { return this.screenMetadata()?.kind === 'temporary'; }

  private metric(event: ServerEvent | ClientEvent, dim1 = '', dim2 = ''): void {
    if (this.screenMetadata()?.kind === 'temporary') {
      recordMetric(this.env, 'evaluation', event, dim1);
    } else {
      recordMetric(this.env, event, dim1, dim2);
    }
  }

  phase(): Phase {
    return (this.meta('phase') as Phase | null) ?? 'none';
  }

  private isLive(): boolean {
    const phase = this.phase();
    return (phase === 'live' || phase === 'warned60' || phase === 'warned20') && this.expiresAt() > this.now();
  }

  private expiresAt(): number {
    return Number(this.meta('expiresAt') ?? '0');
  }

  /** A room opened by a phone gives everyone the phone role, whatever the ticket says. */
  private roleFor(ticketRole: Role): Role {
    return this.meta('beaconType') === 'phone' ? 'phone' : ticketRole;
  }

  // --- RPC -------------------------------------------------------------------

  async open(input: RoomOpenInput): Promise<{ participants: number }> {
    if (
      typeof input?.roomId !== 'string' ||
      !ROOM_ID_SHAPE.test(input.roomId) ||
      !Number.isInteger(input.expiresAt) ||
      input.expiresAt <= this.now() ||
      (input.beaconType !== 'kiosk' && input.beaconType !== 'phone') ||
      !Array.isArray(input.tickets) ||
      input.tickets.length === 0 ||
      input.tickets.length > TICKETS_MAX ||
      new Set(input.tickets.map((t) => t?.ticket)).size !== input.tickets.length
    ) {
      throw new Error('room-open-invalid');
    }
    for (const entry of input.tickets) {
      if (typeof entry?.ticket !== 'string' || !TICKET_SHAPE.test(entry.ticket) || !isRole(entry.role)) {
        throw new Error('room-open-invalid');
      }
    }
    if (this.phase() !== 'none') throw new Error('room-already-open');

    this.ctx.storage.transactionSync(() => {
      this.setMeta('roomId', input.roomId);
      this.setMeta('openedAt', String(this.now()));
      this.setMeta('expiresAt', String(input.expiresAt));
      this.setMeta('beaconType', input.beaconType);
      this.setMeta('venueType', input.venueType ?? '');
      this.setMeta('area', input.area ?? '');
      this.setMeta('screenLabel', input.screenLabel ?? '');
      if (input.screen) this.setMeta('screen', JSON.stringify(input.screen));
      this.setMeta('phase', 'live');
      for (const entry of input.tickets) {
        this.ctx.storage.sql.exec(
          `INSERT INTO tickets (ticket, role, used) VALUES (?, ?, 0)`,
          entry.ticket,
          entry.role,
        );
      }
    });
    await this.ctx.storage.setAlarm(Math.max(input.expiresAt - WARN_60_MS, this.now() + 1000));
    return { participants: this.joinedSockets().length };
  }

  /**
   * One hop: a code minted by this room grants a NEW room of its own, never a
   * seat in this one, and that new room is opened by a phone so it can never
   * mint codes in turn.
   */
  async redeemPeer(code: string): Promise<RedeemPeerResult> {
    if (!this.isLive()) return { ok: false, error: 'code-unknown' };
    const now = this.now();
    const row = this.ctx.storage.sql
      .exec<CodeRow>(`SELECT code, slot_start, slot_end, used FROM codes WHERE code = ?`, code)
      .toArray()[0];
    if (row === undefined) return { ok: false, error: 'code-unknown' };
    if (row.used === 1) return { ok: false, error: 'code-used' };
    if (codeWindow({ slotStart: row.slot_start, slotEnd: row.slot_end }, now) !== 'open') {
      return { ok: false, error: 'code-expired' };
    }
    // Flip atomically; a concurrent redeem of the same code sees used = 1.
    if (this.ctx.storage.sql.exec(`UPDATE codes SET used = 1 WHERE code = ? AND used = 0`, code).rowsWritten === 0) {
      return { ok: false, error: 'code-used' };
    }

    const roomId = randomId(10);
    const ticket = randomId(16);
    const expiresAt = now + Math.round(peerMinutes(this.env) * 60_000);
    const opened = await roomStub(this.env, roomId).open({
      roomId,
      expiresAt,
      beaconType: 'phone',
      venueType: null,
      area: null,
      screenLabel: null,
      ...(this.screenMetadata() ? { screen: this.screenMetadata()! } : {}),
      tickets: [{ ticket, role: 'scanner' }],
    });
    this.metric('session_start', 'phone', '');
    return {
      ok: true,
      scan: {
        roomId,
        ticket,
        beaconType: 'phone',
        venueType: null,
        area: null,
        expiresAt,
        participants: opened.participants,
        screenLabel: null,
        ...(this.screenMetadata() ? { screen: this.screenMetadata()! } : {}),
      },
    };
  }

  // --- WebSocket -------------------------------------------------------------

  /**
   * psdlat mesh-do 476-527. No attachment until join or resume: an unjoined
   * socket has no role, receives no broadcast and counts for nobody. The room
   * has no network rule, so it neither reads nor stores the Worker's net key.
   */
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET' || (request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 400 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const parsed = parseClient(message);
    if (parsed === null) {
      this.safeSend(ws, frame({ t: 'error', error: 'bad-frame' }));
      return;
    }
    if (!this.isLive()) {
      this.safeSend(ws, frame({ t: 'error', error: 'room-closed' }));
      return;
    }
    const attachment = ws.deserializeAttachment() as RoomAttachment | null;
    if (attachment === null) {
      if (parsed.t === 'join') await this.handleJoin(ws, parsed.ticket);
      else if (parsed.t === 'resume') await this.handleResume(ws, parsed.resumeToken);
      else this.safeSend(ws, frame({ t: 'error', error: 'join-required' }));
      return;
    }
    switch (parsed.t) {
      case 'join':
      case 'resume':
        this.safeSend(ws, frame({ t: 'error', error: 'already-joined' }));
        return;
      case 'view':
        this.handleView(attachment, parsed.layer, parsed.params);
        return;
      case 'share':
        await this.handleShare(ws, attachment);
        return;
      case 'event':
        this.handleEvent(attachment, parsed.name, parsed.dim);
        return;
      case 'ping':
        // Normally auto-answered by setWebSocketAutoResponse without waking
        // the object; a stray one that reaches here is a no-op (beacon-do.ts).
        return;
    }
  }

  webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    this.noteSocketGone(ws);
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    logError('room-websocket-error', error, { roomId: this.meta('roomId') ?? undefined });
    this.noteSocketGone(ws);
  }

  /**
   * psdlat mesh-do 529-575: shared "this socket is gone" bookkeeping for both
   * callbacks, guarded so the pair firing for one socket broadcasts once.
   */
  private noteSocketGone(ws: WebSocket): void {
    if (this.socketsGone.has(ws)) return;
    this.socketsGone.add(ws);
    if (!this.isLive()) return;
    if ((ws.deserializeAttachment() as RoomAttachment | null) === null) return;
    const remaining = this.joinedSockets([ws]);
    const message = frame({ t: 'count', participants: remaining.length });
    for (const peer of remaining) this.safeSend(peer, message);
  }

  private joinedSockets(exclude: readonly WebSocket[] = []): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((peer) => !exclude.includes(peer) && (peer.deserializeAttachment() as RoomAttachment | null) !== null);
  }

  private safeSend(ws: WebSocket, message: string): void {
    try {
      ws.send(message);
    } catch (error) {
      logError('room-send-failed', error);
    }
  }

  private broadcast(message: string): void {
    for (const peer of this.joinedSockets()) this.safeSend(peer, message);
  }

  private async handleJoin(ws: WebSocket, ticket: string): Promise<void> {
    const sql = this.ctx.storage.sql;
    const row = sql.exec<TicketRow>(`SELECT ticket, role, used FROM tickets WHERE ticket = ?`, ticket).toArray()[0];
    if (
      row === undefined ||
      row.used === 1 ||
      !isRole(row.role) ||
      sql.exec(`UPDATE tickets SET used = 1 WHERE ticket = ? AND used = 0`, ticket).rowsWritten === 0
    ) {
      this.safeSend(ws, frame({ t: 'error', error: 'ticket-invalid' }));
      return;
    }
    const participant: ParticipantRow = {
      resume_token: randomId(16),
      role: this.roleFor(row.role),
      joined_at: this.now(),
      events: 0,
    };
    sql.exec(
      `INSERT INTO participants (resume_token, role, joined_at, events) VALUES (?, ?, ?, 0)`,
      participant.resume_token,
      participant.role,
      participant.joined_at,
    );
    await this.sendJoined(ws, participant, []);
  }

  private async handleResume(ws: WebSocket, resumeToken: string): Promise<void> {
    const participant = this.ctx.storage.sql
      .exec<ParticipantRow>(
        `SELECT resume_token, role, joined_at, events FROM participants WHERE resume_token = ?`,
        resumeToken,
      )
      .toArray()[0];
    if (participant === undefined) {
      this.safeSend(ws, frame({ t: 'error', error: 'resume-invalid' }));
      return;
    }
    // One live socket per resume token: the newcomer replaces the older holder.
    // The replaced socket is marked gone up front so its close callback does not
    // broadcast a second, lower count on top of the one sendJoined is about to send.
    const replaced: WebSocket[] = [];
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws) continue;
      const att = peer.deserializeAttachment() as RoomAttachment | null;
      if (att?.resumeToken !== resumeToken) continue;
      replaced.push(peer);
      this.socketsGone.add(peer);
      try {
        peer.close(CLOSE_REPLACED, 'replaced');
      } catch (error) {
        logError('room-replace-close-failed', error);
      }
    }
    await this.sendJoined(ws, participant, replaced);
  }

  private async sendJoined(
    ws: WebSocket,
    participant: ParticipantRow,
    replaced: readonly WebSocket[],
  ): Promise<void> {
    const roomId = this.meta('roomId')!;
    const expiresAt = this.expiresAt();
    const role = isRole(participant.role) ? participant.role : 'phone';
    const attachment: RoomAttachment = {
      role,
      joinedAt: participant.joined_at,
      resumeToken: participant.resume_token,
    };
    ws.serializeAttachment(attachment);
    const dataToken = await signDataToken(this.env, roomId, expiresAt);
    const participants = this.joinedSockets(replaced).length;
    this.safeSend(
      ws,
      frame({
        t: 'joined',
        role,
        expiresAt,
        serverNow: this.now(),
        resumeToken: participant.resume_token,
        dataToken,
        participants,
        ...(this.screenMetadata() ? { screen: this.screenMetadata()! } : {}),
      }),
    );
    const count = frame({ t: 'count', participants });
    for (const peer of this.joinedSockets([ws, ...replaced])) this.safeSend(peer, count);
  }

  /** Only the driver — the first scanner to join — steers the screen. */
  private isDriver(attachment: RoomAttachment): boolean {
    if (attachment.role !== 'scanner') return false;
    const driver = this.ctx.storage.sql
      .exec<{ resume_token: string }>(
        `SELECT resume_token FROM participants WHERE role = 'scanner' ORDER BY joined_at, resume_token LIMIT 1`,
      )
      .toArray()[0];
    return driver !== undefined && driver.resume_token === attachment.resumeToken;
  }

  /** A view from anyone else is dropped in silence: it is not an error the person made. */
  private handleView(attachment: RoomAttachment, layer: LayerId, params?: Record<string, string>): void {
    if (!this.isDriver(attachment)) return;
    const message = frame(params === undefined ? { t: 'view', layer } : { t: 'view', layer, params });
    for (const peer of this.joinedSockets()) {
      const att = peer.deserializeAttachment() as RoomAttachment | null;
      if (att?.role === 'kiosk') this.safeSend(peer, message);
    }
  }

  /**
   * One hop. Only a scanner in a room a kiosk opened may mint peer codes, and
   * only for as many whole rotation slots as the session has left. A second
   * share repeats the live batch instead of minting a competing one.
   */
  private async handleShare(ws: WebSocket, attachment: RoomAttachment): Promise<void> {
    if (attachment.role !== 'scanner' || this.meta('beaconType') !== 'kiosk') {
      this.safeSend(ws, frame({ t: 'error', error: 'share-not-allowed' }));
      return;
    }
    const now = this.now();
    const sql = this.ctx.storage.sql;
    sql.exec(`DELETE FROM codes WHERE slot_end + ? <= ?`, CODE_GRACE_MS, now);
    let batch: CodeSlot[] = sql
      .exec<CodeRow>(`SELECT code, slot_start, slot_end, used FROM codes WHERE used = 0 ORDER BY slot_start`)
      .toArray()
      .map((row) => ({ code: row.code, slotStart: row.slot_start, slotEnd: row.slot_end }));

    if (batch.length === 0) {
      const slotMs = codeRotateSeconds(this.env) * 1000;
      const slots = Math.min(CODES_PER_BATCH, Math.floor((this.expiresAt() - now) / slotMs));
      if (slots <= 0) {
        this.safeSend(ws, frame({ t: 'error', error: 'share-unavailable' }));
        return;
      }
      batch = mintBatch(alignSlotStart(now, slotMs), slotMs, slots);
      this.ctx.storage.transactionSync(() => {
        for (const slot of batch) {
          sql.exec(
            `INSERT INTO codes (code, slot_start, slot_end, used) VALUES (?, ?, ?, 0)`,
            slot.code,
            slot.slotStart,
            slot.slotEnd,
          );
        }
      });
      const roomId = this.meta('roomId')!;
      await indexStub(this.env).register(
        batch.map((slot) => ({
          code: slot.code,
          kind: 'room' as const,
          ownerId: roomId,
          expiresAt: slot.slotEnd + CODE_GRACE_MS,
        })),
      );
    }
    this.safeSend(ws, frame({ t: 'codes', batch, serverNow: this.now() }));
  }

  /** Counters only: an unknown name or dimension is dropped and costs the socket nothing. */
  private handleEvent(attachment: RoomAttachment, name: ClientEvent, dim: string | undefined): void {
    const sql = this.ctx.storage.sql;
    const row = sql
      .exec<ParticipantRow>(
        `SELECT resume_token, role, joined_at, events FROM participants WHERE resume_token = ?`,
        attachment.resumeToken,
      )
      .toArray()[0];
    if (row === undefined || row.events >= EVENTS_PER_SOCKET_MAX) return;
    const dims = this.eventDims(name, dim);
    if (dims === null) return;
    sql.exec(`UPDATE participants SET events = events + 1 WHERE resume_token = ?`, attachment.resumeToken);
    this.metric(name, dims[0], dims[1]);
  }

  private eventDims(name: ClientEvent, dim: string | undefined): [string, string] | null {
    if (name === 'panel_open') {
      return isLayer(dim) ? [dim, this.meta('beaconType') ?? ''] : null;
    }
    // export: '<layer>/<kind>'
    const parts = (dim ?? '').split('/');
    if (parts.length !== 2) return null;
    const [layer, kind] = parts as [string, string];
    if (!isLayer(layer) || !(EXPORT_KINDS as readonly string[]).includes(kind)) return null;
    return [layer, kind];
  }

  // --- expiry chain ------------------------------------------------------------

  /**
   * psdlat mesh-do 2726-2829: idempotent and self-rearming. Alarms are
   * at-least-once and can arrive late, so the phase to be in is derived from the
   * clock and compared with the stored one; a repeat delivery changes nothing and
   * a session too short for a warning simply skips it rather than lying about the
   * seconds left.
   */
  async alarm(): Promise<void> {
    const stored = this.phase();
    if (stored === 'none') return;
    if (stored === 'closed') {
      // A previous delivery announced the close but died before the wipe.
      await this.wipe();
      return;
    }
    const remaining = this.expiresAt() - this.now();
    if (remaining <= 0) {
      await this.closeRoom('expired');
      return;
    }
    const due: Phase = remaining <= WARN_20_MS ? 'warned20' : remaining <= WARN_60_MS ? 'warned60' : 'live';
    if (PHASE_ORDER[due] > PHASE_ORDER[stored]) {
      this.setMeta('phase', due);
      if (due !== 'live') {
        this.broadcast(frame({ t: 'expiring', secondsLeft: Math.max(1, Math.ceil(remaining / 1000)) }));
      }
    }
    const next =
      due === 'live'
        ? this.expiresAt() - WARN_60_MS
        : due === 'warned60'
          ? this.expiresAt() - WARN_20_MS
          : this.expiresAt();
    await this.ctx.storage.setAlarm(Math.max(next, this.now() + 1000));
  }

  private async closeRoom(reason: string): Promise<void> {
    if (this.phase() === 'none' || this.phase() === 'closed') {
      await this.wipe();
      return;
    }
    const bucket = durationBucket(this.now() - Number(this.meta('openedAt') ?? '0'));
    // Marked closed before anything else: a retried alarm must not send a second
    // 'expired' or count a second session_end.
    this.setMeta('phase', 'closed');
    this.broadcast(frame({ t: 'expired' }));
    for (const ws of this.ctx.getWebSockets()) {
      this.socketsGone.add(ws);
      try {
        ws.close(CLOSE_SESSION_EXPIRED, 'session-expired');
      } catch (error) {
        logError('room-expire-close-failed', error);
      }
    }
    this.metric('session_end', reason, bucket);
    await this.wipe();
  }

  /** Nothing about a finished session is kept: the ten minutes are the whole retention policy. */
  private async wipe(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    // deleteAll drops the tables of a SQLite object; recreate the empty ones so a
    // late frame or RPC reads a clean 'none' room instead of throwing on a
    // missing table.
    this.ensureSchema();
  }
}
