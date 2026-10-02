// The card "I danas" (app/src/snimka/live.ts, decision S-10): readLive says
// numbers only for a judged state with whole counts, through the product's
// own seam (serviceStateOf, serviceNumbers, aboutExpected), and "nije
// dostupno" for everything else; fetchLive turns a refused answer, a timeout
// and malformed JSON into the same; the card reads once, when it comes into
// view, and always shows its links and its method line.
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { LIVE_TIMEOUT_MS, TEASER_URL, fetchLive, liveLines, mountLive, readLive, type FetchLike } from '../../app/src/snimka/live';

const NOW = Date.parse('2026-10-02T12:00:30.000Z');
const FRESH = '2026-10-02T12:00:00.000Z';

type Service = { state: string; seen: unknown; expected: unknown };
function teaser(service: Service | null, o: { status?: string; sourceAt?: string; module?: string } = {}): unknown {
  return {
    generatedAt: FRESH,
    modules: [
      { module: 'dhmz-now', tier: 'open', status: 'live', fetchedAt: FRESH, items: [] },
      {
        module: o.module ?? 'zet-rt', tier: 'live', status: o.status ?? 'live', fetchedAt: FRESH, sourceUpdatedAt: o.sourceAt ?? FRESH, items: [],
        sources: service ? { zet: { status: 'live', sourceUpdatedAt: o.sourceAt ?? FRESH, service: { since: '2026-10-02T05:00:00.000Z', ratio: 0.9, confidence: 0.9, baseline: 'declared', byMode: { tram: [1, 1], bus: [1, 1] }, ...service } } } : {},
      },
    ],
  };
}

describe('readLive', () => {
  it('normal: the two counts, the timetable rounded as every surface says it, the age of the source', () => {
    expect(readLive(teaser({ state: 'normal', seen: 380, expected: 404 }), NOW)).toEqual({ kind: 'numbers', seen: 380, expected: 400, state: 'normal', ageS: 30 });
  });
  it('reduced and silent: the numbers the seam gives while the city deviates', () => {
    expect(readLive(teaser({ state: 'reduced', seen: 120, expected: 400 }), NOW)).toMatchObject({ kind: 'numbers', seen: 120, expected: 400, state: 'reduced' });
    expect(readLive(teaser({ state: 'silent', seen: 2, expected: 37 }), NOW)).toMatchObject({ kind: 'numbers', seen: 2, expected: 35, state: 'silent' });
  });
  it('unknown, down, unconfirmed, loading and no service are unavailable', () => {
    expect(readLive(teaser({ state: 'unknown', seen: 380, expected: 400 }), NOW)).toEqual({ kind: 'unavailable' });
    expect(readLive(teaser(null, { status: 'down' }), NOW)).toEqual({ kind: 'unavailable' });
    // A source over three minutes old is unconfirmed, whatever its verdict says.
    expect(readLive(teaser({ state: 'normal', seen: 380, expected: 400 }, { sourceAt: '2026-10-02T11:56:00.000Z' }), NOW)).toEqual({ kind: 'unavailable' });
    expect(readLive(teaser(null, { module: 'dhmz-hourly' }), NOW)).toEqual({ kind: 'unavailable' }); // no zet-rt: loading
    expect(readLive(teaser(null), NOW)).toEqual({ kind: 'unavailable' }); // no sources.zet.service: unknown
  });
  it('never a number without a whole count', () => {
    for (const [seen, expected] of [[380.5, 400], [380, null], ['380', 400], [-1, 400], [380, 0], [undefined, 400]] as const) {
      expect(readLive(teaser({ state: 'normal', seen, expected }), NOW), `${String(seen)} / ${String(expected)}`).toEqual({ kind: 'unavailable' });
      expect(readLive(teaser({ state: 'reduced', seen, expected }), NOW), `${String(seen)} / ${String(expected)}`).toEqual({ kind: 'unavailable' });
    }
  });
  it('malformed answers are unavailable, never a throw', () => {
    for (const json of [null, 'x', 42, [], {}, { modules: 'x' }, { modules: [null, 1, 'x'] }, { modules: [{ module: 'zet-rt' }] }]) {
      expect(readLive(json, NOW)).toEqual({ kind: 'unavailable' });
    }
  });
  it('a summary without any source time still gives the numbers, without an age', () => {
    const json = teaser({ state: 'normal', seen: 300, expected: 330 }) as { modules: Record<string, unknown>[] };
    const zet = json.modules[1]!;
    delete zet.sourceUpdatedAt;
    delete ((zet.sources as Record<string, Record<string, unknown>>).zet).sourceUpdatedAt;
    expect(readLive(json, NOW)).toEqual({ kind: 'numbers', seen: 300, expected: 330, state: 'normal', ageS: null });
  });
});

describe('liveLines', () => {
  it('the sentence of Appendix B with the state word, and the age; or the one unavailable line', () => {
    expect(liveLines({ kind: 'numbers', seen: 380, expected: 400, state: 'normal', ageS: 30 })).toEqual(['Sada: u pokretu 380, po voznom redu oko 400, stanje uobičajeno.', 'Podatak star manje od minute.']);
    expect(liveLines({ kind: 'numbers', seen: 2, expected: 35, state: 'silent', ageS: 125 })).toEqual(['Sada: u pokretu 2, po voznom redu oko 35, stanje gotovo bez vozila.', 'Podatak star 2 min.']);
    expect(liveLines({ kind: 'unavailable' })).toEqual(['Trenutačno stanje nije dostupno.']);
  });
});

const ok = (body: string, status = 200): Response => new Response(body, { status, headers: { 'content-type': 'application/json' } });

describe('fetchLive', () => {
  it('reads /api/teaser once with a four-second signal', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok(JSON.stringify(teaser({ state: 'normal', seen: 380, expected: 400 }))));
    expect(await fetchLive(fetchImpl, () => NOW)).toMatchObject({ kind: 'numbers', seen: 380 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe(TEASER_URL);
    expect(fetchImpl.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
    expect(LIVE_TIMEOUT_MS).toBe(4000);
  });
  it('a 503, malformed JSON, a network error and a timeout are unavailable', async () => {
    expect(await fetchLive(async () => ok('{"error":"x"}', 503), () => NOW)).toEqual({ kind: 'unavailable' });
    expect(await fetchLive(async () => ok('{not json'), () => NOW)).toEqual({ kind: 'unavailable' });
    expect(await fetchLive(async () => { throw new TypeError('offline'); }, () => NOW)).toEqual({ kind: 'unavailable' });
    const hanging: FetchLike = (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError'))));
    expect(await fetchLive(hanging, () => NOW, 20)).toEqual({ kind: 'unavailable' });
  });
});

describe('the card', () => {
  function page(): { root: HTMLElement; doc: Document } {
    const win = new Window({ url: 'http://localhost/snimka/' });
    const doc = win.document as unknown as Document;
    const root = doc.createElement('div');
    root.setAttribute('aria-busy', 'true');
    doc.body.append(root);
    return { root: root as unknown as HTMLElement, doc };
  }
  it('shows the kicker, the links and the method at once, reads nothing until it is in view, then reads once', async () => {
    const { root } = page();
    let enter: (() => void) | null = null;
    const observe = vi.fn((_el: HTMLElement, fn: () => void) => { enter = fn; return () => { enter = null; }; });
    const fetchImpl = vi.fn<FetchLike>(async () => ok(JSON.stringify(teaser({ state: 'normal', seen: 380, expected: 400 }))));
    const off = mountLive(root, { fetchImpl, observe, now: () => NOW });
    expect(root.hasAttribute('aria-busy')).toBe(false);
    expect(root.dataset.snLive).toBe('pending');
    expect(root.querySelector('.sn-live-kicker')!.textContent).toBe('Uživo, nije snimka');
    expect([...root.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/', '/statistika/']);
    expect(root.querySelector('.sn-live-method')!.textContent).toContain('ništa se ne broji i ne šalje');
    expect(fetchImpl).not.toHaveBeenCalled();
    enter!();
    await vi.waitFor(() => expect(root.dataset.snLive).toBe('numbers'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.sn-live-line')!.textContent).toBe('Sada: u pokretu 380, po voznom redu oko 400, stanje uobičajeno.');
    expect(root.querySelector('.sn-live-age')!.textContent).toBe('Podatak star manje od minute.');
    off();
  });
  it('says unavailable on a down summary, and the links stay', async () => {
    const { root } = page();
    mountLive(root, { fetchImpl: async () => ok(JSON.stringify(teaser(null, { status: 'down' }))), observe: (_el, fn) => { fn(); return () => {}; }, now: () => NOW });
    await vi.waitFor(() => expect(root.dataset.snLive).toBe('unavailable'));
    expect(root.querySelector('[data-sn="live-now"]')!.textContent).toBe('Trenutačno stanje nije dostupno.');
    expect(root.querySelectorAll('a')).toHaveLength(2);
  });
});
