import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HRT_FEEDS, HRT_ITEMS_PER_FEED, fetchHrtNews, parseHrtRss } from '../../worker/feed/modules/hrt-news';

const vijesti = readFileSync(new URL('../fixtures/hrt-vijesti.xml', import.meta.url), 'utf8');
const sljeme = readFileSync(new URL('../fixtures/hrt-sljeme.xml', import.meta.url), 'utf8');

describe('parseHrtRss', () => {
  const items = parseHrtRss(vijesti, 'HRT vijesti');

  it('reads headline, link and time, never the body', () => {
    expect(items.length).toBe(HRT_ITEMS_PER_FEED);
    const first = items[0];
    expect(first.kind).toBe('news');
    expect(first.title).toBe('Prošao prijedlog Bosanca - Gospićani dolaze u Europski parlament');
    expect(first.link).toBe(
      'https://vijesti.hrt.hr/hrvatska/prosao-prijedlog-bosanca-gospicani-dolaze-u-europski-parlament-12902294',
    );
    expect(first.id).toBe(first.link);
    expect(first.at).toBe('2026-09-11T09:25:44.000Z');
    expect(first.dateBasis).toBe('published');
    expect(first.data).toEqual({ source: 'HRT vijesti' });
    expect(first.summary).toContain('Slučaj Gospić stiže u Europski parlament.');
    // content:encoded carries the article body and an <img>; it is never read.
    expect(JSON.stringify(items)).not.toContain('<img');
    expect(JSON.stringify(items)).not.toContain('api.hrt.hr/media');
  });

  it('labels the Sljeme feed as its own source', () => {
    const radio = parseHrtRss(sljeme, 'Radio Sljeme');
    expect(radio.length).toBe(HRT_ITEMS_PER_FEED);
    expect(radio[0].data).toEqual({ source: 'Radio Sljeme' });
    expect(radio[0].title).toBe('VIO Zagreb ostaje bez pet gradova i općina?');
  });

  it('drops an entry without a link but rejects a non-RSS body as failure, not an empty feed', () => {
    const partial = parseHrtRss(
      `<rss><channel><item><title>Bez poveznice</title></item>` +
        `<item><title>S poveznicom</title><link>https://vijesti.hrt.hr/a-1</link>` +
        `<pubDate>Fri, 11 Sep 2026 09:00:00 +0000</pubDate></item></channel></rss>`,
      'HRT vijesti',
    );
    expect(partial.map((item) => item.title)).toEqual(['S poveznicom']);
    expect(() => parseHrtRss('<html></html>', 'HRT vijesti')).toThrow(/RSS/);
    expect(() => parseHrtRss('<rss><channel>', 'HRT vijesti')).toThrow(/XML/);
    expect(parseHrtRss('<rss><channel/></rss>', 'HRT vijesti')).toEqual([]);
  });

  it('retains only a plain-string lede and never falls back to a fetch date', () => {
    const [item] = parseHrtRss(
      '<rss><channel><item><title>Naslov</title><link>https://vijesti.hrt.hr/a</link>' +
      '<description><![CDATA[<p>Kratak <b>tekst</b> &amp; izvor</p>]]></description>' +
      '<pubDate>bad date</pubDate><content:encoded>FULL BODY</content:encoded></item></channel></rss>',
      'HRT vijesti',
    );
    expect(item.summary).toBe('Kratak tekst & izvor');
    expect(item.at).toBeUndefined();
    expect(item.dateBasis).toBe('unknown');
    expect(JSON.stringify(item)).not.toContain('FULL BODY');
  });
});

describe('fetchHrtNews', () => {
  it('merges both feeds newest first and names the two endpoints', async () => {
    expect(HRT_FEEDS.map((feed) => feed.url)).toEqual([
      'https://feed.hrt.hr/vijesti/page.xml',
      'https://feed.hrt.hr/sljeme/latest.xml',
    ]);
    const payload = await fetchHrtNews({
      now: () => new Date('2026-09-11T11:00:00.000Z'),
      fetch: async (url) => new Response(url.includes('sljeme') ? sljeme : vijesti),
    });
    expect(payload.items).toHaveLength(HRT_ITEMS_PER_FEED * 2);
    const times = payload.items.map((item) => Date.parse(item.at ?? ''));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(payload.sourceUpdatedAt).toBe('2026-09-11T10:55:29.000Z');
    expect(new Set(payload.items.map((item) => item.data?.source))).toEqual(new Set(['HRT vijesti', 'Radio Sljeme']));
    for (const source of Object.values(payload.sources!)) {
      expect(source.status).toBe('live');
      expect(source.itemCount).toBe(HRT_ITEMS_PER_FEED);
      expect(source.totalItems).toBeGreaterThan(HRT_ITEMS_PER_FEED);
      expect(source.fetchedAt).toBe('2026-09-11T11:00:00.000Z');
    }
    expect(payload.coverage).toEqual({
      shown: 30, total: Object.values(payload.sources!).reduce((sum, source) => sum + source.totalItems!, 0), limited: true,
    });
  });

  it('keeps one feed when the other fails', async () => {
    const payload = await fetchHrtNews({
      now: () => new Date('2026-09-11T11:00:00.000Z'),
      fetch: async (url) => {
        if (url.includes('sljeme')) throw new Error('upstream 503');
        return new Response(vijesti);
      },
    });
    expect(payload.items).toHaveLength(HRT_ITEMS_PER_FEED);
    expect(payload.sources?.['HRT vijesti'].status).toBe('live');
    expect(payload.sources?.['Radio Sljeme']).toMatchObject({ status: 'down', itemCount: 0 });
    expect(payload.sources?.['Radio Sljeme'].totalItems).toBeUndefined();
    expect(payload.coverage).toEqual({ shown: HRT_ITEMS_PER_FEED, limited: true });
  });

  it('reports a valid empty source independently from HTTP and wrong-shape failures', async () => {
    const ctx = {
      now: () => new Date('2026-09-11T11:00:00Z'),
      fetch: async (url: string) => url.includes('sljeme')
        ? new Response('unavailable', { status: 503 }) : new Response('<rss><channel/></rss>'),
    };
    const payload = await fetchHrtNews(ctx);
    expect(payload.items).toEqual([]);
    expect(payload.sources?.['HRT vijesti']).toMatchObject({ status: 'live', itemCount: 0, totalItems: 0 });
    expect(payload.sources?.['Radio Sljeme'].status).toBe('down');
    const allEmpty = await fetchHrtNews({ ...ctx, fetch: async () => new Response('<rss><channel/></rss>') });
    expect(allEmpty.coverage).toEqual({ shown: 0, total: 0, limited: false });
    await expect(fetchHrtNews({ ...ctx, fetch: async () => new Response('<html>maintenance</html>') })).rejects.toThrow(/both/);
  });

  it('puts dated news before undated entries and keeps undated source order stable', async () => {
    const payload = await fetchHrtNews({
      now: () => new Date('2026-09-11T11:00:00Z'),
      fetch: async () => new Response('<rss><channel>' +
        '<item><title>Unknown 1</title><link>https://test/1</link></item>' +
        '<item><title>Known</title><link>https://test/2</link><pubDate>Fri, 11 Sep 2026 09:00:00 +0000</pubDate></item>' +
        '<item><title>Unknown 2</title><link>https://test/3</link></item>' +
        '</channel></rss>'),
    });
    expect(payload.items.map((item) => item.title)).toEqual(['Known', 'Known', 'Unknown 1', 'Unknown 2', 'Unknown 1', 'Unknown 2']);
  });

  it('throws when both feeds fail, so the cache layer can fall back', async () => {
    await expect(
      fetchHrtNews({
        now: () => new Date('2026-09-11T11:00:00.000Z'),
        fetch: async () => {
          throw new Error('upstream 503');
        },
      }),
    ).rejects.toThrow(/hrt-news/);
  });
});
