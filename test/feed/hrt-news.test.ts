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

  it('drops an entry without a link and survives a non-RSS body', () => {
    const partial = parseHrtRss(
      `<rss><channel><item><title>Bez poveznice</title></item>` +
        `<item><title>S poveznicom</title><link>https://vijesti.hrt.hr/a-1</link>` +
        `<pubDate>Fri, 11 Sep 2026 09:00:00 +0000</pubDate></item></channel></rss>`,
      'HRT vijesti',
    );
    expect(partial.map((item) => item.title)).toEqual(['S poveznicom']);
    expect(parseHrtRss('<html></html>', 'HRT vijesti')).toEqual([]);
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
