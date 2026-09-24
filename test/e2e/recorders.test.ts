// e2e/recorders.ts at the end of a session: the page tears the Sada band down the
// moment the session ends, and the browser cancels the band's static fetches in the
// same millisecond. The D3 gate's run (run/logs/d3-e2e/accept-phone-artefacts-run2/
// recorders-phone-expiry.json) recorded exactly that: two MapLibre sprite fetches,
// net::ERR_ABORTED, at the expiry instant, while every content claim held. §11 asks
// for no /api/data after expiry; a cancelled sprite is no data request. So such an
// abort is listed, not counted, and nothing else is let through: an /api/ request,
// an abort before the session ended, a sprite that failed for another reason and an
// HTTP error all stay findings.
import { describe, expect, it } from 'vitest';
import { attachRecorders, problemsAfterTeardown, type RecorderPage } from '../../e2e/recorders';

interface FakeRequest { url: string; method: string; error: string }

/** A page whose requests fail on demand, on a clock the recorder reads. */
function fakePage() {
  const handlers = new Map<string, Array<(arg: unknown) => void>>();
  let now = Date.parse('2026-09-23T22:37:00.000Z');
  const page = { on: (event: string, fn: (arg: unknown) => void) => { handlers.set(event, [...(handlers.get(event) ?? []), fn]); return page; } } as unknown as RecorderPage;
  const fail = (at: string, r: FakeRequest): void => {
    now = Date.parse(at);
    for (const fn of handlers.get('requestfailed') ?? []) fn({ url: () => r.url, method: () => r.method, failure: () => ({ errorText: r.error }), resourceType: () => 'fetch' });
  };
  const answer = (at: string, url: string, status: number): void => {
    now = Date.parse(at);
    for (const fn of handlers.get('response') ?? []) fn({ url: () => url, status: () => status, request: () => ({ method: () => 'GET' }), headers: () => ({}), body: async () => Buffer.from('') });
  };
  return { page, fail, answer, clock: () => new Date(now) };
}

const EXPIRED_AT = '2026-09-23T22:37:09.606Z';
/** The two failed requests of the D3 run's expiry row, as the recorder wrote them. */
const RECORDED: readonly FakeRequest[] = [
  { url: 'http://localhost:8807/maps/sprites/light%402x.json', method: 'GET', error: 'net::ERR_ABORTED' },
  { url: 'http://localhost:8807/maps/sprites/light%402x.png', method: 'GET', error: 'net::ERR_ABORTED' },
];

describe('problems at the end of a session (the phone expiry row)', () => {
  it('the recorded list: the two sprite fetches the teardown cancelled are listed, not counted', () => {
    const f = fakePage();
    const rec = attachRecorders(f.page, 'phone-expiry', { now: f.clock });
    for (const r of RECORDED) f.fail(EXPIRED_AT, r);
    // What the row read before: two failed requests, a red row with every content claim holding.
    expect(rec.problems()).toHaveLength(2);
    const after = problemsAfterTeardown(rec, EXPIRED_AT);
    expect(after.problems).toEqual([]);
    expect(after.tolerated.map((r) => r.url)).toEqual(RECORDED.map((r) => r.url));
  });

  it('images and fonts cancelled by the teardown are the same case', () => {
    const f = fakePage();
    const rec = attachRecorders(f.page, 'phone-expiry', { now: f.clock });
    f.fail(EXPIRED_AT, { url: 'http://localhost:8787/assets/marker.png?v=2', method: 'GET', error: 'net::ERR_ABORTED' });
    f.fail(EXPIRED_AT, { url: 'http://localhost:8787/fonts/manrope-500-normal-latin.woff2', method: 'GET', error: 'net::ERR_ABORTED' });
    f.fail(EXPIRED_AT, { url: 'http://localhost:8787/maps/fonts/Noto%20Sans%20Regular/0-255.pbf', method: 'GET', error: 'net::ERR_ABORTED' });
    expect(problemsAfterTeardown(rec, EXPIRED_AT).problems).toEqual([]);
  });

  it('every /api/ request stays a finding, aborted or not, even a URL that ends like an image', () => {
    const f = fakePage();
    const rec = attachRecorders(f.page, 'phone-expiry', { now: f.clock });
    f.fail('2026-09-23T22:37:10.000Z', { url: 'http://localhost:8807/api/data/zet-rt', method: 'GET', error: 'net::ERR_ABORTED' });
    f.fail('2026-09-23T22:37:10.000Z', { url: 'http://localhost:8807/api/city/icons/pin.png', method: 'GET', error: 'net::ERR_ABORTED' });
    expect(problemsAfterTeardown(rec, EXPIRED_AT).problems).toEqual([
      'failed request: GET http://localhost:8807/api/data/zet-rt (net::ERR_ABORTED)',
      'failed request: GET http://localhost:8807/api/city/icons/pin.png (net::ERR_ABORTED)',
    ]);
  });

  it('a static asset aborted before the session ended, or failed for another reason, stays a finding; so does an HTTP error', () => {
    const f = fakePage();
    const rec = attachRecorders(f.page, 'phone-expiry', { now: f.clock });
    f.fail('2026-09-23T22:37:09.605Z', RECORDED[0]);
    f.fail(EXPIRED_AT, { ...RECORDED[1], error: 'net::ERR_CONNECTION_RESET' });
    f.answer(EXPIRED_AT, 'http://localhost:8807/maps/sprites/light%402x.json', 404);
    expect(problemsAfterTeardown(rec, EXPIRED_AT).problems).toEqual([
      'failed request: GET http://localhost:8807/maps/sprites/light%402x.json (net::ERR_ABORTED)',
      'failed request: GET http://localhost:8807/maps/sprites/light%402x.png (net::ERR_CONNECTION_RESET)',
      'HTTP 404: GET /maps/sprites/light%402x.json',
    ]);
  });
});
