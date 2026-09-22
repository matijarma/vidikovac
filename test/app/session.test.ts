import { describe, expect, it, vi } from 'vitest';
import { CLOSE_SESSION_EXPIRED } from '../../worker/protocol';
import { createSessionClient, DATA_TOKEN_KEY, HANDSHAKE_TIMEOUT_MS, INITIAL_CONNECT_WINDOW_MS, RESUME_KEY, roomSocketUrl } from '../../app/src/session';
import { FakeSocket } from './helpers';

function storage(initial: Record<string, string> = {}) {
  const raw = { ...initial };
  return { raw, getItem: (k: string) => raw[k] ?? null, setItem: (k: string, v: string) => { raw[k] = v; }, removeItem: (k: string) => { delete raw[k]; } };
}
function boot(opts: { ticket?: string | null; store?: ReturnType<typeof storage>; now?: () => number } = {}) {
  const sockets: FakeSocket[] = [];
  const retries: { fn: () => void; ms: number; id: number }[] = [];
  let timerId = 0;
  const st = opts.store ?? storage();
  let clock = 1_000_000;
  const client = createSessionClient({
    roomId: 'room1', ticket: opts.ticket === undefined ? 'tick1' : opts.ticket,
    createSocket: (url) => { const s = new FakeSocket(url); sockets.push(s); return s; },
    storage: st,
    now: opts.now ?? (() => clock),
    wsBase: 'wss://x.test',
    setTimeout: (fn, ms) => { const id = ++timerId; retries.push({ fn, ms, id }); return id; },
    clearTimeout: (id) => { const index = retries.findIndex((timer) => timer.id === id); if (index >= 0) retries.splice(index, 1); },
  });
  client.connect();
  return {
    client, st, sockets, retries,
    get sock() { return sockets[sockets.length - 1]!; },
    advance: (ms: number) => { clock += ms; },
    runRetry: () => { const next = retries.shift(); next?.fn(); return next; },
  };
}
const JOINED = { t: 'joined', role: 'scanner', expiresAt: 1_600_000, serverNow: 1_010_000, resumeToken: 'res1', dataToken: 'dt1', participants: 2 };

describe('createSessionClient', () => {
  it('builds the room socket URL', () => {
    expect(roomSocketUrl('r1', 'wss://x.test')).toBe('wss://x.test/ws/room/r1');
  });
  it('joins with the ticket, stores the resume token, exposes dataToken and computes the server offset', () => {
    const { client, sock, st } = boot();
    expect(sock.url).toBe('wss://x.test/ws/room/room1');
    sock.emit('open');
    expect(sock.json(0)).toEqual({ t: 'join', ticket: 'tick1' });
    const joined = vi.fn();
    client.onJoined(joined);
    sock.server(JOINED);
    expect(joined).toHaveBeenCalledTimes(1);
    const s = client.snapshot();
    expect(s.phase).toBe('live');
    expect(s.role).toBe('scanner');
    expect(s.dataToken).toBe('dt1');
    expect(s.participants).toBe(2);
    expect(client.serverNow()).toBe(1_010_000);
    expect(client.secondsLeft()).toBe(590);
    expect(JSON.parse(st.raw[RESUME_KEY]!)).toEqual({ roomId: 'room1', resumeToken: 'res1' });
    // Strictly necessary for this session, and gone the moment it ends (R-52).
    expect(st.raw[DATA_TOKEN_KEY]).toBe('dt1');
  });
  it('resumes from sessionStorage when a resume token exists for this room', () => {
    const { sock } = boot({ ticket: null, store: storage({ [RESUME_KEY]: JSON.stringify({ roomId: 'room1', resumeToken: 'res1' }) }) });
    sock.emit('open');
    expect(sock.json(0)).toEqual({ t: 'resume', resumeToken: 'res1' });
  });
  it('prefers the ticket over a stale resume token from another room', () => {
    const { sock } = boot({ store: storage({ [RESUME_KEY]: JSON.stringify({ roomId: 'other', resumeToken: 'old' }) }) });
    sock.emit('open');
    expect(sock.json(0)).toEqual({ t: 'join', ticket: 'tick1' });
  });
  it('reports an error and closes when it has neither ticket nor resume token', () => {
    const { client, sock } = boot({ ticket: null });
    const err = vi.fn();
    client.onError(err);
    sock.emit('open');
    expect(err).toHaveBeenCalledWith('no-ticket');
    expect(client.snapshot().phase).toBe('closed');
  });
  // R-K3 (T4.1): the one additive field. Before any join a closed room is only a credential
  // that opens nothing any more (a reload, or a tab restored after the ten minutes ended): a
  // spent ticket, told with the truthful no-ticket banner. Revoked is the case after this one.
  it.each([
    ['ticket-invalid', 'no-ticket'], ['resume-invalid', 'no-ticket'], ['room-closed', 'no-ticket'],
  ] as const)('recovers from %s by clearing unusable credentials and asking for a fresh scan, naming the reason %s', (error, why) => {
    const b = boot({ store: storage({
      [RESUME_KEY]: JSON.stringify({ roomId: 'room1', resumeToken: 'old' }),
      [DATA_TOKEN_KEY]: 'old-data',
    }) });
    const errors = vi.fn();
    b.client.onError(errors);
    b.sock.emit('open');
    b.sock.server({ t: 'error', error });
    expect(b.client.snapshot().phase).toBe('closed');
    expect(b.client.snapshot().dataToken).toBeNull();
    expect(errors).toHaveBeenCalledWith('no-ticket', why);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(b.st.raw[RESUME_KEY]).toBeUndefined();
    expect(b.st.raw[DATA_TOKEN_KEY]).toBeUndefined();
    expect(b.retries).toHaveLength(0);
  });
  it('a room closed under a live session (the screen switched off) is the same recovery event, named revoked', () => {
    const b = boot();
    const errors = vi.fn();
    b.client.onError(errors);
    b.sock.emit('open');
    b.sock.server(JOINED);
    expect(b.client.snapshot().phase).toBe('live');
    b.sock.server({ t: 'error', error: 'room-closed' });
    expect(b.client.snapshot().phase).toBe('closed');
    expect(b.client.snapshot().dataToken).toBeNull();
    expect(errors).toHaveBeenCalledWith('no-ticket', 'revoked');
    expect(errors).toHaveBeenCalledTimes(1);
    expect(b.st.raw[RESUME_KEY]).toBeUndefined();
    expect(b.st.raw[DATA_TOKEN_KEY]).toBeUndefined();
    expect(b.retries).toHaveLength(0);
  });
  it('treats room-closed after a known deadline as expiry, not a reconnect loop', () => {
    const b = boot();
    const expired = vi.fn();
    b.client.onExpired(expired);
    b.sock.emit('open');
    b.sock.server(JOINED);
    b.advance(700_000);
    b.sock.server({ t: 'error', error: 'room-closed' });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(b.client.snapshot().phase).toBe('expired');
    expect(b.retries).toHaveLength(0);
  });
  it('forwards view, codes, count, expiring and error messages', () => {
    const { client, sock } = boot();
    const view = vi.fn(); const codes = vi.fn(); const count = vi.fn(); const expiring = vi.fn(); const error = vi.fn();
    client.onView(view); client.onCodes(codes); client.onCount(count); client.onExpiring(expiring); client.onError(error);
    sock.emit('open'); sock.server(JOINED);
    sock.server({ t: 'view', layer: 'vijesti', params: { q: '1' } });
    sock.server({ t: 'codes', batch: [{ code: 'A', slotStart: 1, slotEnd: 2 }], serverNow: 5 });
    sock.server({ t: 'count', participants: 3 });
    sock.server({ t: 'expiring', secondsLeft: 60 });
    sock.server({ t: 'error', error: 'share-not-allowed' });
    expect(view).toHaveBeenCalledWith('vijesti', { q: '1' });
    expect(codes).toHaveBeenCalledWith([{ code: 'A', slotStart: 1, slotEnd: 2 }], 5);
    expect(count).toHaveBeenCalledWith(3);
    expect(client.snapshot().participants).toBe(3);
    expect(expiring).toHaveBeenCalledWith(60);
    expect(error).toHaveBeenCalledWith('share-not-allowed');
  });
  it('fires expired exactly once across the expired message and the 4000 close, and clears the resume token', () => {
    const { client, sock, st } = boot();
    const expired = vi.fn();
    client.onExpired(expired);
    sock.emit('open'); sock.server(JOINED);
    sock.server({ t: 'expired' });
    sock.emit('close', { code: CLOSE_SESSION_EXPIRED, reason: 'session-expired' });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(client.snapshot().phase).toBe('expired');
    expect(st.raw[RESUME_KEY]).toBeUndefined();
    expect(st.raw[DATA_TOKEN_KEY]).toBeUndefined();
    expect(client.snapshot().dataToken).toBeNull();
  });
  it('treats a 4000 close without a prior message as expiry too', () => {
    const { client, sock } = boot();
    const expired = vi.fn(); client.onExpired(expired);
    sock.emit('open'); sock.server(JOINED);
    sock.emit('close', { code: CLOSE_SESSION_EXPIRED, reason: '' });
    expect(expired).toHaveBeenCalledTimes(1);
  });
  // R-53: a phone drops its socket the moment the camera app comes up.
  it('reconnects with the resume token after a dropped socket while the room is still open', () => {
    const boot1 = boot();
    const { client, sockets } = boot1;
    const expired = vi.fn(); const closed = vi.fn();
    client.onExpired(expired); client.onClose(closed);
    sockets[0]!.emit('open'); sockets[0]!.server(JOINED);
    sockets[0]!.emit('close', { code: 1006, reason: '' });
    expect(expired).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledWith(1006);
    expect(client.snapshot().phase).toBe('connecting');
    expect(boot1.retries[0]!.ms).toBe(500);

    boot1.runRetry();
    expect(sockets).toHaveLength(2);
    sockets[1]!.emit('open');
    // The ticket was single-use and is spent; the resume token carries the room.
    expect(sockets[1]!.json(0)).toEqual({ t: 'resume', resumeToken: 'res1' });
    sockets[1]!.server(JOINED);
    expect(client.snapshot().phase).toBe('live');
  });

  it('backs off further on every failed attempt and stops when the session has run out', () => {
    const boot1 = boot();
    const { client, sockets } = boot1;
    const expired = vi.fn();
    client.onExpired(expired);
    sockets[0]!.emit('open'); sockets[0]!.server(JOINED);
    sockets[0]!.emit('close', { code: 1006, reason: '' });
    boot1.runRetry();
    sockets[1]!.emit('close', { code: 1006, reason: '' });
    expect(boot1.retries[0]!.ms).toBe(1_000);
    // The room's ten minutes run out while the phone is still away.
    boot1.advance(700_000);
    boot1.runRetry();
    expect(sockets).toHaveLength(2);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(client.snapshot().phase).toBe('expired');
  });

  it('does not reconnect after the page closed the session itself', () => {
    const boot1 = boot();
    const { client, sockets } = boot1;
    sockets[0]!.emit('open'); sockets[0]!.server(JOINED);
    client.close();
    sockets[0]!.emit('close', { code: 1000, reason: 'leave' });
    expect(boot1.retries).toHaveLength(0);
    expect(client.snapshot().phase).toBe('closed');
  });

  it('an ordinary close before a session exists is reported as closed, not expired', () => {
    const { client, sock } = boot();
    const expired = vi.fn(); const closed = vi.fn(); const error = vi.fn();
    client.onError(error);
    client.onExpired(expired); client.onClose(closed);
    sock.emit('open');
    sock.emit('close', { code: 1006, reason: '' });
    expect(expired).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledWith(1006);
    expect(client.snapshot().phase).toBe('closed');
    expect(error).toHaveBeenCalledWith('no-ticket');
  });
  it('retries a failed handshake while the single-use ticket is still unspent', () => {
    const b = boot();
    b.sock.emit('close', { code: 1006, reason: '' });
    expect(b.client.snapshot().phase).toBe('connecting');
    expect(b.retries[0]!.ms).toBe(500);
    b.runRetry();
    b.sock.emit('open');
    expect(b.sock.json(0)).toEqual({ t: 'join', ticket: 'tick1' });
    b.sock.server(JOINED);
    expect(b.client.snapshot().phase).toBe('live');
    expect(b.retries).toHaveLength(0);
  });
  it('retries a resume handshake even before the new page knows the room deadline', () => {
    const b = boot({ ticket: null, store: storage({ [RESUME_KEY]: JSON.stringify({ roomId: 'room1', resumeToken: 'res1' }) }) });
    b.sock.emit('open');
    b.sock.emit('close', { code: 1006, reason: '' });
    expect(b.client.snapshot().phase).toBe('connecting');
    b.runRetry();
    b.sock.emit('open');
    expect(b.sock.json(0)).toEqual({ t: 'resume', resumeToken: 'res1' });
  });
  it('can resume a live session when browser storage is blocked', () => {
    const st = storage();
    st.getItem = () => { throw new Error('storage disabled'); };
    st.setItem = () => { throw new Error('storage disabled'); };
    const b = boot({ store: st });
    b.sock.emit('open');
    b.sock.server(JOINED);
    b.sock.emit('close', { code: 1006, reason: '' });
    expect(b.client.snapshot().phase).toBe('connecting');
    b.runRetry();
    b.sock.emit('open');
    expect(b.sock.json(0)).toEqual({ t: 'resume', resumeToken: 'res1' });
    b.sock.server(JOINED);
    expect(b.client.snapshot().phase).toBe('live');
    b.sock.server({ t: 'expired' });
    b.sock.emit('close', { code: 1006, reason: '' });
    expect(b.retries).toHaveLength(0);
  });
  it('bounds a hanging handshake and ignores late events from the abandoned socket', () => {
    const b = boot();
    const old = b.sock;
    expect(b.retries[0]!.ms).toBe(HANDSHAKE_TIMEOUT_MS);
    b.advance(HANDSHAKE_TIMEOUT_MS);
    b.runRetry();
    expect(b.retries[0]!.ms).toBe(500);
    b.runRetry();
    expect(b.sockets).toHaveLength(2);
    old.emit('open');
    old.server(JOINED);
    old.emit('close', { code: 1006, reason: '' });
    expect(b.client.snapshot().phase).toBe('connecting');
    expect(old.sent).toHaveLength(0);
    b.sock.emit('open');
    b.sock.server(JOINED);
    expect(b.client.snapshot().phase).toBe('live');
  });
  it('ends initial retry attempts with scan recovery, not an endless connecting state', () => {
    const b = boot();
    const errors = vi.fn();
    b.client.onError(errors);
    b.advance(INITIAL_CONNECT_WINDOW_MS);
    b.runRetry();
    expect(b.client.snapshot().phase).toBe('closed');
    expect(errors).toHaveBeenCalledWith('no-ticket');
    expect(b.retries).toHaveLength(0);
  });
  it('serialises outbound messages exactly as the contract types them', () => {
    const { client, sock } = boot();
    sock.emit('open'); sock.server(JOINED);
    client.sendView('u-pokretu', { stop: '123' });
    client.share();
    client.event('panel_open', 'vijesti');
    client.event('export');
    expect(sock.json(1)).toEqual({ t: 'view', layer: 'u-pokretu', params: { stop: '123' } });
    expect(sock.json(2)).toEqual({ t: 'share' });
    expect(sock.json(3)).toEqual({ t: 'event', name: 'panel_open', dim: 'vijesti' });
    expect(sock.json(4)).toEqual({ t: 'event', name: 'export' });
  });
  it('drops outbound messages when the socket is not open', () => {
    const { client, sock } = boot();
    client.sendView('u-pokretu');
    expect(sock.sent).toEqual([]);
  });
  it('ignores malformed frames', () => {
    const { client, sock } = boot();
    sock.emit('open');
    expect(() => sock.emit('message', { data: 'not json' })).not.toThrow();
    expect(() => sock.emit('message', { data: JSON.stringify({ t: 'unknown' }) })).not.toThrow();
    expect(client.snapshot().phase).toBe('connecting');
  });
  it('secondsLeft never goes below zero', () => {
    let now = 1_000_000;
    const { client, sock } = boot({ now: () => now });
    sock.emit('open'); sock.server(JOINED);
    now = 5_000_000;
    expect(client.secondsLeft()).toBe(0);
  });
});
