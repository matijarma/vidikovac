import { describe, expect, it, vi } from 'vitest';
import type { CodeSlot } from '../../worker/protocol';
import {
  BACKOFF_MS,
  BEACON_STORAGE_KEY,
  createBeaconClient,
  parseProvisionHash,
  readBeacon,
  reloadBeacon,
  storeBeacon,
  type WebSocketLike,
} from '../../app/src/beacon';

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  closedWith: number | null = null;
  private handlers: Record<string, ((e: never) => void)[]> = {};
  constructor(public url: string) {}
  addEventListener(type: string, l: (e: never) => void): void { (this.handlers[type] ??= []).push(l); }
  send(data: string): void { this.sent.push(data); }
  close(code?: number): void { this.closedWith = code ?? 1000; this.emit('close', { code: code ?? 1000, reason: '' }); }
  emit(type: string, e: unknown = {}): void { if (type === 'open') this.readyState = 1; if (type === 'close') this.readyState = 3; for (const l of this.handlers[type] ?? []) l(e as never); }
  server(msg: unknown): void { this.emit('message', { data: JSON.stringify(msg) }); }
  json(i: number): unknown { return JSON.parse(this.sent[i]!); }
}

function batch(start: number, count = 20): CodeSlot[] {
  return Array.from({ length: count }, (_, i) => ({ code: `C${String(i).padStart(7, '0')}`, slotStart: start + i * 30_000, slotEnd: start + (i + 1) * 30_000 }));
}

function boot() {
  const sockets: FakeSocket[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const onCodes = vi.fn();
  const onUnlocked = vi.fn();
  const onRevoked = vi.fn();
  const onStatus = vi.fn();
  const onError = vi.fn();
  const client = createBeaconClient({
    credentials: { beaconId: 'BEACON01', secret: 'tajna' },
    createSocket: (url) => { const s = new FakeSocket(url); sockets.push(s); return s; },
    wsBase: 'wss://x.test',
    hmac: async (secret, nonce) => `mac(${secret}|${nonce})`,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    onCodes, onUnlocked, onRevoked, onStatus, onError,
  });
  return { client, sockets, timers, onCodes, onUnlocked, onRevoked, onStatus, onError };
}
const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

it('reloads only after the existing credential restore path can recover the screen', () => {
  const credentials = { beaconId: 'BEACON01', secret: 'test-only-secret' };
  let value: string | null = null;
  const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; }, removeItem: () => {} };
  const reload = vi.fn(() => { expect(readBeacon(storage)).toEqual(credentials); });
  expect(reloadBeacon(credentials, storage, reload)).toBe(true);
  expect(reload).toHaveBeenCalledTimes(1);
  const unavailable = { ...storage, getItem: () => null, setItem: () => { throw new Error('private mode'); } };
  expect(reloadBeacon(credentials, unavailable, reload)).toBe(false);
  expect(reloadBeacon(credentials, null, reload)).toBe(false);
  expect(reload).toHaveBeenCalledTimes(1);
});

it('persists a reload per identity pair and refuses an unrecordable latch', () => {
  const credentials = { beaconId: 'BEACON01', secret: 'test-only-secret' };
  const raw: Record<string, string> = {};
  const storage = {
    getItem: (key: string) => raw[key] ?? null,
    setItem: (key: string, value: string) => { raw[key] = value; },
    removeItem: (key: string) => { delete raw[key]; },
  };
  const reload = vi.fn();
  const pair = ['bundled-network', 'published-network'] as const;
  for (let mount = 0; mount < 3; mount++) {
    expect(reloadBeacon(credentials, storage, reload, pair)).toBe(mount === 0);
  }
  expect(reload).toHaveBeenCalledTimes(1);
  expect(reloadBeacon(credentials, storage, reload, ['bundled-network', 'next-network'])).toBe(true);
  expect(reloadBeacon(credentials, storage, reload, ['updated-bundle', 'next-network'])).toBe(true);
  const readOnly = { ...storage, setItem: () => {} };
  expect(reloadBeacon(credentials, readOnly, reload, ['bundled-network', 'unrecordable'])).toBe(false);
  expect(reload).toHaveBeenCalledTimes(3);
  expect(readBeacon(storage)).toEqual(credentials);
});

describe('provisioning', () => {
  it('reads beaconId.secret from the fragment and rejects anything else', () => {
    expect(parseProvisionHash('#BEACON01.s3cr3t-value')).toEqual({ beaconId: 'BEACON01', secret: 's3cr3t-value' });
    expect(parseProvisionHash('#BEACON01')).toBeNull();
    expect(parseProvisionHash('')).toBeNull();
    expect(parseProvisionHash('#.secret')).toBeNull();
  });
  it('round-trips through storage under the documented key', () => {
    const raw: Record<string, string> = {};
    const storage = { getItem: (k: string) => raw[k] ?? null, setItem: (k: string, v: string) => { raw[k] = v; }, removeItem: (k: string) => { delete raw[k]; } };
    expect(readBeacon(storage)).toBeNull();
    storeBeacon(storage, { beaconId: 'BEACON01', secret: 'tajna' });
    expect(BEACON_STORAGE_KEY).toBe('vidikovac-beacon');
    expect(JSON.parse(raw[BEACON_STORAGE_KEY]!)).toEqual({ beaconId: 'BEACON01', secret: 'tajna' });
    expect(readBeacon(storage)).toEqual({ beaconId: 'BEACON01', secret: 'tajna' });
    expect(readBeacon({ ...storage, getItem: () => 'nije json' })).toBeNull();
  });
});

describe('createBeaconClient', () => {
  it('connects to the beacon socket and answers the challenge with the HMAC', async () => {
    const { client, sockets } = boot();
    client.connect();
    expect(sockets[0]!.url).toBe('wss://x.test/ws/beacon/BEACON01');
    sockets[0]!.emit('open');
    sockets[0]!.server({ t: 'challenge', nonce: 'n1' });
    await flush();
    expect(sockets[0]!.json(0)).toEqual({ t: 'auth', hmac: 'mac(tajna|n1)' });
  });
  it('forwards code batches and asks for more when three slots remain', async () => {
    const { client, sockets, onCodes } = boot();
    client.connect();
    sockets[0]!.emit('open');
    sockets[0]!.server({ t: 'codes', batch: batch(1_000_000), serverNow: 1_000_000 });
    expect(onCodes).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ code: 'C0000000' })]), 1_000_000);
    client.requestMore();
    expect(sockets[0]!.json(0)).toEqual({ t: 'more' });
  });
  it('sends the screen the settings panel chose as screen-set version 2, and surfaces the DO\u2019s refusal of it', () => {
    const { client, sockets, onError } = boot();
    client.connect();
    sockets[0]!.emit('open');
    // A stop place travels as its id alone: the DO fills the name and the point from its own table.
    client.setScreen({ place: { kind: 'stop', stopId: '106_1' }, frame: 6 });
    expect(sockets[0]!.json(0)).toEqual({ t: 'screen-set', version: 2, place: { kind: 'stop', stopId: '106_1' }, frame: 6 });
    // The whole city is an explicit null, never an omitted place.
    client.setScreen({ place: null, frame: 8 });
    expect(sockets[0]!.json(1)).toEqual({ t: 'screen-set', version: 2, place: null, frame: 8 });
    client.setScreen({ place: { kind: 'address', name: 'Ilica', lon: 15.97, lat: 45.8135, address: 'Ilica 25' }, frame: 4 });
    expect(sockets[0]!.json(2)).toEqual({ t: 'screen-set', version: 2, place: { kind: 'address', name: 'Ilica', lon: 15.97, lat: 45.8135, address: 'Ilica 25' }, frame: 4 });
    // Nothing of version 1 leaves this client any more.
    expect(sockets[0]!.sent.map((raw) => JSON.parse(raw) as { version?: number }).every((m) => m.version === 2)).toBe(true);
    // The DO's error frame is a word for the caller, never a status change or a reconnect.
    sockets[0]!.server({ t: 'error', error: 'bad-place' });
    expect(onError).toHaveBeenCalledWith('bad-place');
    sockets[0]!.server({ t: 'error', error: 'bad-frame' });
    expect(onError).toHaveBeenCalledWith('bad-frame');
    sockets[0]!.server({ t: 'error', error: 'screen-set-rate' });
    expect(onError).toHaveBeenCalledWith('screen-set-rate');
    expect(client.status()).toBe('connecting');
    expect(sockets).toHaveLength(1);
  });
  it('sends nothing while the socket is not open', () => {
    const { client, sockets } = boot();
    client.connect();
    client.setScreen({ place: null, frame: 6 });
    expect(sockets[0]!.sent).toHaveLength(0);
  });
  it('reports unlocked and revoked, and status changes', () => {
    const { client, sockets, onUnlocked, onRevoked, onStatus } = boot();
    client.connect();
    expect(onStatus).toHaveBeenCalledWith('connecting');
    sockets[0]!.emit('open');
    sockets[0]!.server({ t: 'codes', batch: batch(0, 1), serverNow: 0 });
    expect(onStatus).toHaveBeenCalledWith('live');
    sockets[0]!.server({ t: 'unlocked', roomId: 'r1', ticket: 't1', expiresAt: 99 });
    expect(onUnlocked).toHaveBeenCalledWith({ roomId: 'r1', ticket: 't1', expiresAt: 99 });
    sockets[0]!.server({ t: 'revoked' });
    expect(onRevoked).toHaveBeenCalledTimes(1);
    expect(client.status()).toBe('revoked');
  });
  it('reconnects with exponential backoff and stops after a revoke', () => {
    const { client, sockets, timers } = boot();
    client.connect();
    sockets[0]!.emit('open');
    sockets[0]!.emit('close', { code: 1006, reason: '' });
    expect(timers.at(-1)!.ms).toBe(BACKOFF_MS[0]);
    timers.at(-1)!.fn();
    sockets[1]!.emit('close', { code: 1006, reason: '' });
    expect(timers.at(-1)!.ms).toBe(BACKOFF_MS[1]);
    timers.at(-1)!.fn();
    sockets[2]!.emit('open');
    sockets[2]!.server({ t: 'codes', batch: batch(0, 1), serverNow: 0 });
    sockets[2]!.emit('close', { code: 1006, reason: '' });
    expect(timers.at(-1)!.ms).toBe(BACKOFF_MS[0]); // a healthy session resets the backoff
    const before = timers.length;
    sockets[2]!.server({ t: 'revoked' });
    client.close();
    expect(timers.length).toBe(before);
  });
});
