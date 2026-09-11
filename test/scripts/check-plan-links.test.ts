import { describe, expect, it } from 'vitest';
import {
  checkUrl,
  extractUrls,
  findFillFields,
  missingModuleIds,
  moduleIdsFromSchema,
  renderTable,
} from '../../scripts/check-plan-links.mjs';

describe('extractUrls', () => {
  it('finds markdown links and bare URLs, dedupes, strips trailing punctuation, skips templates', () => {
    const md = [
      '| `zet-rt` | ZET | https://www.zet.hr/gtfs-rt-protobuf | OD |',
      'See [the API](https://www1.zagreb.hr/sluzbeni-glasnik-gateway/api/v1/sifarnici).',
      'Repeated: https://www.zet.hr/gtfs-rt-protobuf, and a template https://example.org/{datum} to skip.',
      'Query stays: https://www.seismicportal.eu/fdsnws/event/1/query?lat=45.81&lon=15.98&maxradius=1.5&format=json',
    ].join('\n');
    expect(extractUrls(md)).toEqual([
      'https://www.zet.hr/gtfs-rt-protobuf',
      'https://www1.zagreb.hr/sluzbeni-glasnik-gateway/api/v1/sifarnici',
      'https://www.seismicportal.eu/fdsnws/event/1/query?lat=45.81&lon=15.98&maxradius=1.5&format=json',
    ]);
  });
});

describe('module coverage', () => {
  const schema = `export type ModuleId =\n  | 'zet-rt'\n  | 'prometnice'\n  | 'emsc';\n\nexport type Tier = 'open' | 'session';`;
  it('reads the ModuleId union and reports ids without a table row', () => {
    const ids = moduleIdsFromSchema(schema);
    expect(ids).toEqual(['zet-rt', 'prometnice', 'emsc']);
    const md = '| `zet-rt` | ... |\n| `emsc` | ... |\n';
    expect(missingModuleIds(ids, md)).toEqual(['prometnice']);
  });
});

describe('checkUrl', () => {
  it('reports HEAD success without a GET', async () => {
    const calls: string[] = [];
    const fetchImpl = async (_url: string, init: RequestInit) => {
      calls.push(init.method as string);
      return new Response(null, { status: 200 });
    };
    const row = await checkUrl('https://a.example/x', { fetchImpl });
    expect(row).toMatchObject({ url: 'https://a.example/x', method: 'HEAD', status: 200, ok: true });
    expect(calls).toEqual(['HEAD']);
  });

  it('falls back to GET when HEAD is refused and cancels the body', async () => {
    let cancelled = false;
    const fetchImpl = async (_url: string, init: RequestInit) => {
      if (init.method === 'HEAD') return new Response(null, { status: 405 });
      const body = new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024));
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, { status: 200 });
    };
    const row = await checkUrl('https://a.example/big.zip', { fetchImpl });
    expect(row).toMatchObject({ method: 'GET', status: 200, ok: true });
    expect(cancelled).toBe(true);
  });

  it('reports a network error as not ok with the message', async () => {
    const fetchImpl = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    const row = await checkUrl('https://nope.invalid/', { fetchImpl });
    expect(row.ok).toBe(false);
    expect(row.method).toBe('-');
    expect(row.error).toContain('ENOTFOUND');
  });
});

describe('findFillFields and renderTable', () => {
  it('lists every [[POPUNITI ...]] marker', () => {
    expect(findFillFields('a [[POPUNITI: OIB]] b [[POPUNITI: adresa]] c')).toEqual(['[[POPUNITI: OIB]]', '[[POPUNITI: adresa]]']);
    expect(findFillFields('clean')).toEqual([]);
  });
  it('skips a marker shown as a literal example in a code span, but still catches real ones', () => {
    expect(
      findFillFields('Sva mjesta označena `[[POPUNITI: ...]]` popunjavaju se iz registara.'),
    ).toEqual([]);
    expect(
      findFillFields('Real: [[POPUNITI: OIB]]. Example: `[[POPUNITI: ...]]` describes the convention.'),
    ).toEqual(['[[POPUNITI: OIB]]']);
  });
  it('renders one aligned line per URL', () => {
    const text = renderTable([
      { url: 'https://a.example/', method: 'HEAD', status: 200, ok: true, ms: 120 },
      { url: 'https://b.example/', method: '-', status: 0, ok: false, ms: 10000, error: 'timeout' },
    ]);
    const lines = text.split('\n');
    expect(lines[0]).toMatch(/^OK\s+STATUS\s+METHOD\s+MS\s+URL$/);
    expect(lines[1]).toMatch(/^ok\s+200\s+HEAD\s+120\s+https:\/\/a\.example\/$/);
    expect(lines[2]).toMatch(/^FAIL\s+0\s+-\s+10000\s+https:\/\/b\.example\/ {2}timeout$/);
  });
});
