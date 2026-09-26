import { describe, expect, it, vi } from 'vitest';
import { DataError, fetchData, fetchSentences, fetchTeaser, scan } from '../../app/src/api';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('scan', () => {
  it('POSTs the normalised code and returns ScanOk', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('/api/scan');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ code: 'ABCDEFGH' });
      return json({ roomId: 'r1', ticket: 't1', beaconType: 'kiosk', venueType: 'kafic', area: 'Donji grad', expiresAt: 1, participants: 1, screenLabel: 'Kavana' });
    });
    const r = await scan('abcd-efgh', f as unknown as typeof fetch);
    expect('roomId' in r && r.roomId).toBe('r1');
  });
  it('returns ScanFail from a 4xx body and maps a network failure', async () => {
    const fail = await scan('ABCDEFGH', (async () => json({ error: 'code-used', message: 'Iskorišten.' }, 409)) as unknown as typeof fetch);
    expect(fail).toEqual({ error: 'code-used', message: 'Iskorišten.' });
    const net = await scan('ABCDEFGH', (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch);
    expect('error' in net && net.error).toBe('error' in net ? net.error : undefined);
    expect(net).toMatchObject({ error: 'bad-request' });
  });
});

describe('fetchData / fetchTeaser', () => {
  it('aborts a hanging feed request and does not leave a permanent loading state', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('request-timeout')));
      }));
      const request = fetchData('zet-rt', 'tok', fetchImpl as unknown as typeof fetch);
      const assertion = expect(request).rejects.toThrow('request-timeout');
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally { vi.useRealTimers(); }
  });
  it('sends the bearer token and returns the snapshot', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('/api/data/zet-rt');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok');
      return json({ module: 'zet-rt', tier: 'session', status: 'live', fetchedAt: 'x', attribution: { text: 'a', url: 'u', licence: 'l' }, items: [] });
    });
    const s = await fetchData('zet-rt', 'tok', f as unknown as typeof fetch);
    expect(s.module).toBe('zet-rt');
  });
  it('throws DataError with the status on 401', async () => {
    await expect(fetchData('zet-rt', 'bad', (async () => json({ error: 'unauthorized' }, 401)) as unknown as typeof fetch)).rejects.toMatchObject({ name: 'DataError', status: 401 });
    expect(new DataError(401).status).toBe(401);
    await expect(fetchData('zet-rt', 'bad', (async () => new Response('Access denied', { status: 403 })) as typeof fetch))
      .rejects.toMatchObject({ name: 'DataError', status: 403 });
  });
  it('does not mistake an HTML login page for a data snapshot', async () => {
    await expect(fetchData('zet-rt', 'tok', (async () => new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch))
      .rejects.toMatchObject({ name: 'DataError', status: 502 });
  });
  it('fetchTeaser returns the module list', async () => {
    const t = await fetchTeaser((async () => json({ modules: [{ module: 'dhmz-cap', tier: 'open', status: 'live', fetchedAt: 'x', attribution: { text: 'a', url: 'u', licence: 'l' }, items: [] }] })) as unknown as typeof fetch);
    expect(t.modules[0]?.module).toBe('dhmz-cap');
  });
});

describe('fetchSentences', () => {
  const ok = () => new Response(JSON.stringify({ generatedAt: new Date().toISOString(), sentences: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  // A stable fact (shared/kiosk/sentence.ts stableSentenceFacts): typed, no countdown, a finite end still ahead.
  const request = { locale: 'hr' as const, budget: 80, facts: [{ id: 'solar:sunrise', kind: 'vrijeme', text: 'Sunce izlazi u 06:46.', validUntil: Date.now() + 600_000 }] };
  it('asks the caller once its lazy chunk is in hand and sends nothing when the answer is no (the page ended meanwhile)', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => ok());
    expect(await fetchSentences(request as never, fetchImpl as never, { proceed: () => false })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await fetchSentences(request as never, fetchImpl as never, { proceed: () => true })).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('/api/kiosk/sentences');
    // Without the option the request goes out as before.
    await fetchSentences(request as never, fetchImpl as never);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
