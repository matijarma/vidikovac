import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FetchContext } from '../../../worker/feed/schema';
import { ZET_RSS_NOVOSTI_URL, ZET_RSS_PROMET_URL, fetchZetRss } from '../../../worker/feed/modules/dogadanja/zet-rss';

// The instant test/fixtures/dogadanja/sources.json records for this fetch.
const FETCH_NOW = new Date('2026-09-12T00:45:58Z');

const novosti = readFileSync(new URL('../../fixtures/dogadanja/zet-rss-novosti.xml', import.meta.url), 'utf8');
const promet = readFileSync(new URL('../../fixtures/dogadanja/zet-rss-promet.xml', import.meta.url), 'utf8');

function makeContext(overrides: Record<string, () => Response> = {}, now: Date = FETCH_NOW): FetchContext {
  return {
    now: () => now,
    fetch: async (url) => {
      if (overrides[url]) return overrides[url]();
      if (url === ZET_RSS_NOVOSTI_URL) return new Response(novosti);
      if (url === ZET_RSS_PROMET_URL) return new Response(promet);
      throw new Error(`unexpected url: ${url}`);
    },
  };
}

function byId<T extends { id: string }>(items: T[], id: string): T {
  const item = items.find((row) => row.id === id);
  if (!item) throw new Error(`item ${id} not found`);
  return item;
}

describe('fetchZetRss', () => {
  it('requests the real, saved feed urls (robots.txt does not exist on www.zet.hr, see sources.json)', () => {
    expect(ZET_RSS_NOVOSTI_URL).toBe('https://www.zet.hr/rss_novosti.aspx');
    expect(ZET_RSS_PROMET_URL).toBe('https://www.zet.hr/rss_promet.aspx');
  });

  it('reads all 18 real novosti items and all 17 real promet items, 35 total', async () => {
    const result = await fetchZetRss(makeContext());
    expect(result.items).toHaveLength(35);
  });

  it('reads the first real novosti item as headline, link and publish time, tagged with its own feed', async () => {
    const result = await fetchZetRss(makeContext());
    const item = byId(result.items, 'zet-novosti:10123');
    expect(item).toEqual({
      id: 'zet-novosti:10123',
      title: 'Dan otvorenih vrata ZET-a',
      link: 'https://www.zet.hr/default.aspx?id=10123',
      // <pubDate>Tue, 08 Sep 2026 22:00:00 +0200</pubDate> (see the fixture).
      at: '2026-09-08T20:00:00.000Z',
      dateBasis: 'published',
      data: { source: 'zet-novosti', precision: 'time' },
    });
  });

  it('reads the first real promet item as headline, link and publish time, tagged with its own feed', async () => {
    const result = await fetchZetRss(makeContext());
    const item = byId(result.items, 'zet-promet:10146');
    expect(item).toEqual({
      id: 'zet-promet:10146',
      title: 'Radovi u subotu skreću linije 102 i 105',
      link: 'https://www.zet.hr/default.aspx?id=10146',
      // <pubDate>Fri, 11 Sep 2026 09:00:00 +0200</pubDate> (see the fixture).
      at: '2026-09-11T07:00:00.000Z',
      dateBasis: 'published',
      data: { source: 'zet-promet', precision: 'time' },
    });
  });

  it('carries a publish time from <pubDate> (R-E1) but never a summary or any borrowed description prose (R-P6)', async () => {
    const result = await fetchZetRss(makeContext());
    for (const item of result.items) {
      expect(item.at).toBeTypeOf('string');
      expect(Number.isFinite(Date.parse(item.at as string))).toBe(true);
      expect(item.data.precision).toBe('time');
      expect(item).not.toHaveProperty('until');
      expect(item).not.toHaveProperty('summary');
      expect(item).not.toHaveProperty('description');
    }
    const serialized = JSON.stringify(result.items);
    // Real sentences from the first novosti item's <description> (see the
    // fixture) that must never reach a produced item.
    expect(serialized).not.toContain('135. rođendana');
    expect(serialized).not.toContain('Remizi');
    // Real sentence from the first promet item's <description>.
    expect(serialized).not.toContain('Korisnike ljubazno molimo za razumijevanje');
  });

  it('keeps an item with no <pubDate>, or an unparseable one, but with no `at`', async () => {
    const withoutPubDate =
      '<rss><channel><item><title>Bez datuma</title><link>https://www.zet.hr/default.aspx?id=9001</link></item>' +
      '<item><title>Neispravan datum</title><link>https://www.zet.hr/default.aspx?id=9002</link>' +
      '<pubDate>not-a-date</pubDate></item></channel></rss>';
    const result = await fetchZetRss(
      makeContext({
        [ZET_RSS_NOVOSTI_URL]: () => new Response(withoutPubDate),
        [ZET_RSS_PROMET_URL]: () => new Response('<rss><channel></channel></rss>'),
      }),
    );
    expect(result.items).toHaveLength(2);
    for (const item of result.items) {
      expect(item).not.toHaveProperty('at');
      expect(item.dateBasis).toBe('unknown');
      expect(item.data.precision).toBe('time');
    }
  });

  it('keeps one feed when the other fails, the same allSettled shape as hrt-news', async () => {
    const result = await fetchZetRss(
      makeContext({ [ZET_RSS_PROMET_URL]: () => { throw new Error('upstream 503'); } }),
    );
    expect(result.items).toHaveLength(18);
    expect(result.items.every((item) => item.data.source === 'zet-novosti')).toBe(true);
    expect(result.sources['zet-novosti']).toMatchObject({ status: 'live', itemCount: 18, totalItems: 18 });
    expect(result.sources['zet-promet']).toMatchObject({ status: 'down', itemCount: 0 });
  });

  it('throws when both feeds fail, so the cache layer can fall back', async () => {
    await expect(
      fetchZetRss(
        makeContext({
          [ZET_RSS_NOVOSTI_URL]: () => { throw new Error('upstream 503'); },
          [ZET_RSS_PROMET_URL]: () => { throw new Error('upstream 503'); },
        }),
      ),
    ).rejects.toThrow(/zet-rss/);
  });

  it('drops an item without a link or without a title, and survives a non-RSS body', async () => {
    const partial =
      '<rss><channel><item><title>Bez poveznice</title></item>' +
      '<item><title>S poveznicom</title><link>https://www.zet.hr/default.aspx?id=1</link></item></channel></rss>';
    const result = await fetchZetRss(
      makeContext({
        [ZET_RSS_NOVOSTI_URL]: () => new Response(partial),
        [ZET_RSS_PROMET_URL]: () => new Response('<html></html>'),
      }),
    );
    expect(result.items.map((item) => item.title)).toEqual(['S poveznicom']);
    expect(result.sources['zet-promet'].status).toBe('down');
  });

  it('links every item back to a real www.zet.hr notice', async () => {
    const result = await fetchZetRss(makeContext());
    for (const item of result.items) {
      expect(item.link.startsWith('https://www.zet.hr/')).toBe(true);
    }
  });
});
