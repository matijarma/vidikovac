import { describe, expect, it, vi } from 'vitest';
import { CLOSE_SESSION_EXPIRED } from '../../worker/protocol';
import { createSessionClient, RESUME_KEY, roomSocketUrl, type WebSocketLike } from '../../app/src/session';

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  closed: { code?: number } | null = null;
  private handlers: Record<string, ((e: never) => void)[]> = {};
  constructor(public url: string) {}
  addEventListener(type: string, l: (e: never) => void): void { (this.handlers[type] ??= []).push(l); }
  send(data: string): void { this.sent.push(data); }
  close(code?: number): void { this.closed = { code }; this.emit('close', { code: code ?? 1000, reason: '' }); }
  emit(type: string, e: unknown = {}): void { if (type === 'open') this.readyState = 1; if (type === 'close') this.readyState = 3; for (const l of this.handlers[type] ?? []) l(e as never); }
  server(msg: unknown): void { this.emit('message', { data: JSON.stringify(msg) }); }
  json(i: number): unknown { return JSON.parse(this.sent[i]!); }
}
function storage(initial: Record<string, string> = {}) {
  const raw = { ...initial };
  return { raw, getItem: (k: string) => raw[k] ?? null, setItem: (k: string, v: string) => { raw[k] = v; }, removeItem: (k: string) => { delete raw[k]; } };
}
function boot(opts: { ticket?: string | null; store?: ReturnType<typeof storage>; now?: () => number } = {}) {
  let sock: FakeSocket | null = null;
  const st = opts.store ?? storage();
  const client = createSessionClient({
    roomId: 'room1', ticket: opts.ticket === undefined ? 'tick1' : opts.ticket,
    createSocket: (url) => (sock = new FakeSocket(url)), storage: st, now: opts.now ?? (() => 1_000_000), wsBase: 'wss://x.test',
  });
  client.connect();
  return { client, sock: sock!, st };
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
  });
  it('treats a 4000 close without a prior message as expiry too', () => {
    const { client, sock } = boot();
    const expired = vi.fn(); client.onExpired(expired);
    sock.emit('open'); sock.server(JOINED);
    sock.emit('close', { code: CLOSE_SESSION_EXPIRED, reason: '' });
    expect(expired).toHaveBeenCalledTimes(1);
  });
  it('an ordinary close while live is reported as closed, not expired', () => {
    const { client, sock } = boot();
    const expired = vi.fn(); const closed = vi.fn();
    client.onExpired(expired); client.onClose(closed);
    sock.emit('open'); sock.server(JOINED);
    sock.emit('close', { code: 1006, reason: '' });
    expect(expired).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledWith(1006);
    expect(client.snapshot().phase).toBe('closed');
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
    client.sendView('vijesti');
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
