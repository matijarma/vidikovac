import { describe, expect, it } from 'vitest';
import { pageTotal, sourceCoverage } from '../../worker/feed/payload';

describe('sourceCoverage', () => {
  it('counts successful empties, full responses and capped collections without losing totals', () => {
    expect(sourceCoverage({
      a: { status: 'live', itemCount: 0, totalItems: 0 },
      b: { status: 'live', itemCount: 40, totalItems: 510 },
    })).toEqual({ shown: 40, total: 510, limited: true });
    expect(sourceCoverage({ a: { status: 'live', itemCount: 0, totalItems: 0 } }))
      .toEqual({ shown: 0, total: 0, limited: false });
  });

  it('never adds missing or failed sources as zero to a claimed overall total', () => {
    expect(sourceCoverage({
      a: { status: 'live', itemCount: 20, totalItems: 20 },
      b: { status: 'down', itemCount: 0 },
    })).toEqual({ shown: 20, limited: true });
    expect(sourceCoverage({
      a: { status: 'live', itemCount: 20 },
    })).toEqual({ shown: 20, limited: true });
  });
});

describe('WordPress page totals', () => {
  it('recognises bounds without mistaking a full unknown page for the complete dataset', () => {
    expect(pageTotal(new Response('[]'), 20, 20)).toBeUndefined();
    expect(pageTotal(new Response('[]'), 0, 20)).toBe(0);
    expect(pageTotal(new Response('[]', { headers: { 'x-wp-total': '100' } }), 20, 20)).toBe(100);
    expect(pageTotal(new Response('[]', { headers: { 'x-wp-total': '10' } }), 20, 20)).toBeUndefined();
    expect(pageTotal(new Response('[]', { headers: { 'x-wp-total': '-1' } }), 20, 20)).toBeUndefined();
  });
});
