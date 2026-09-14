import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FetchContext } from '../../worker/feed/schema';
import { fetchDogadanja } from '../../worker/feed/modules/dogadanja';
import { ARCGIS_CETVRTI_URL, ZBORNA_MJESTA_URL, fetchCkanGeo } from '../../worker/feed/modules/ckan-geo';

// The robots guarantee (R-P5, task E6's own name for it): a test that records
// every URL the dogadanja module actually requests through an injected fetch,
// and fails the moment one matches a prefix or host a robots.txt this project
// has read disallows. The four concrete examples come straight from the
// research sweep recorded in the area E preamble and R-P5:
//   - kultura.zagreb.hr/robots.txt disallows /api/ and /_next/ (task-E1's own
//     report confirms this live; "Guru za kulturu" events live only behind
//     that disallowed /api/ path, so the whole host stays out of this module).
//   - youtube.com/robots.txt disallows /feeds/videos.xml -- the Skupština
//     channel's own Atom feed path; skupstina.ts links the channel's live page
//     instead (linking is not crawling) and never fetches this path.
//   - Muzika.hr and InfoZagreb are excluded entirely (not partially), per the
//     brief's own phrasing, so both hosts are disallowed in full rather than
//     by a single path prefix.
// This is deliberately independent of what the six sub-fetchers do today: the
// guard below is tested against the four examples directly (so the check
// itself is proven sound), and separately against a full live run of the real
// module (so a regression that adds a seventh, disallowed request is caught
// the moment it starts happening) -- "what keeps R-P5 true after the next
// person edits the file."

const DISALLOWED_PREFIXES = [
  'https://kultura.zagreb.hr/api/',
  'https://kultura.zagreb.hr/_next/',
  'http://kultura.zagreb.hr/api/',
  'http://kultura.zagreb.hr/_next/',
  'https://www.youtube.com/feeds/videos.xml',
  'https://youtube.com/feeds/videos.xml',
  // data.zagreb.hr/robots.txt disallows /api/ (read 12 and 14 Sept 2026): the
  // portal's datasets are read from their resource download URLs, never CKAN.
  'https://data.zagreb.hr/api/',
  'http://data.zagreb.hr/api/',
];

// These two hosts are excluded entirely -- no prefix carve-out, unlike
// kultura.zagreb.hr (whose /robots.txt allows plenty else on the same host).
const DISALLOWED_HOSTS = new Set(['muzika.hr', 'www.muzika.hr', 'infozagreb.hr', 'www.infozagreb.hr']);

/** Throws when `url` matches a disallowed prefix or sits on a fully-disallowed host. */
function assertRobotsAllow(url: string): void {
  for (const prefix of DISALLOWED_PREFIXES) {
    if (url.startsWith(prefix)) throw new Error(`robots.txt disallows this path: ${url}`);
  }
  const { hostname } = new URL(url);
  if (DISALLOWED_HOSTS.has(hostname)) throw new Error(`this host is excluded entirely: ${url}`);
}

describe('assertRobotsAllow (the guard itself)', () => {
  it('flags every one of the four concrete examples the research found', () => {
    expect(() => assertRobotsAllow('https://kultura.zagreb.hr/api/events?page=1')).toThrow();
    expect(() => assertRobotsAllow('https://kultura.zagreb.hr/_next/static/chunks/main.js')).toThrow();
    expect(() => assertRobotsAllow('https://www.youtube.com/feeds/videos.xml?channel_id=UCRMm4Xt9ruoQ8FG7NpIHCsA')).toThrow();
    expect(() => assertRobotsAllow('https://muzika.hr/dogadjanja')).toThrow();
    expect(() => assertRobotsAllow('https://www.infozagreb.hr/en/events')).toThrow();
    expect(() => assertRobotsAllow('https://data.zagreb.hr/api/3/action/package_show?id=zborna-mjesta')).toThrow();
  });

  it('allows the real URLs the six sub-fetchers actually use today', () => {
    const realUrls = [
      'https://kulturpunkt.hr/wp-json/wp/v2/kp_22_announcement?_fields=id,link,title,excerpt,class_list,date&per_page=40&orderby=date&order=desc',
      'https://skupstina.zagreb.hr/rokovnik-sjednica/76',
      'https://skupstina.zagreb.hr/poziv-na-13-sjednicu-gradske-skupstine-grada-zagreba/8711',
      'https://www.youtube.com/channel/UCRMm4Xt9ruoQ8FG7NpIHCsA',
      'https://aktivnosti.zagreb.hr/kvartovske-novosti/134585',
      'https://data.zagreb.hr/dataset/fddb4f87-c002-4e3c-b988-adf013997ecc/resource/f90738b6-8bfa-4dd9-9db7-b3c532d90c97/download/data.json',
      'https://www.zet.hr/rss_novosti.aspx',
      'https://www.zet.hr/rss_promet.aspx',
      'https://emz.hr/wp-json/wp/v2/dogadjanja?_fields=id,link,title,type,meta,class_list,date&per_page=20&orderby=date&order=desc',
      'https://emz.hr/wp-json/wp/v2/izlozbe?_fields=id,link,title,type,meta,class_list,date&per_page=20&orderby=date&order=desc',
    ];
    for (const url of realUrls) expect(() => assertRobotsAllow(url), url).not.toThrow();
  });

  it('does not over-block: kultura.zagreb.hr paths outside /api/ and /_next/ are allowed', () => {
    expect(() => assertRobotsAllow('https://kultura.zagreb.hr/dogadjanja/nesto')).not.toThrow();
  });
});

describe('fetchDogadanja never requests a disallowed URL', () => {
  const FETCH_NOW = new Date('2026-09-12T00:45:30Z');
  const FIXTURE_DIR = new URL('../fixtures/dogadanja/', import.meta.url);
  const text = (name: string) => readFileSync(new URL(name, FIXTURE_DIR), 'utf8');

  const ROUTES: [string, () => BodyInit][] = [
    ['kp_22_announcement', () => text('kulturpunkt.json')],
    ['rokovnik-sjednica', () => text('skupstina-rokovnik.html')],
    ['poziv-na-13-sjednicu-gradske-skupstine-grada-zagreba', () => text('skupstina-sjednica.html')],
    ['15-sjednica-odbora-za-financije', () => text('skupstina-sjednica.html')],
    ['kvartovske-novosti', () => text('kvartovske-novosti.html')],
    ['f90738b6-8bfa-4dd9-9db7-b3c532d90c97', () => text('komunalne-aktivnosti.json')],
    ['rss_novosti.aspx', () => text('zet-rss-novosti.xml')],
    ['rss_promet.aspx', () => text('zet-rss-promet.xml')],
    ['wp/v2/dogadjanja', () => text('etnografski-dogadjanja.json')],
    ['wp/v2/izlozbe', () => text('etnografski-izlozbe.json')],
  ];

  function makeRecordingContext(): { ctx: FetchContext; requested: string[] } {
    const requested: string[] = [];
    const ctx: FetchContext = {
      now: () => FETCH_NOW,
      fetch: async (url) => {
        requested.push(url);
        const match = ROUTES.find(([needle]) => url.includes(needle));
        if (!match) throw new Error(`no fixture route for ${url}`);
        return new Response(match[1]());
      },
    };
    return { ctx, requested };
  }

  it('records every URL a full live run of the module requests, and every one clears the guard', async () => {
    const { ctx, requested } = makeRecordingContext();
    await fetchDogadanja(ctx);
    expect(requested.length).toBeGreaterThan(0);
    for (const url of requested) expect(() => assertRobotsAllow(url), url).not.toThrow();
  });

  it('never once requests kultura.zagreb.hr, muzika.hr, infozagreb.hr, or the disallowed YouTube feed path', async () => {
    const { ctx, requested } = makeRecordingContext();
    await fetchDogadanja(ctx);
    for (const url of requested) {
      const { hostname } = new URL(url);
      expect(hostname).not.toBe('kultura.zagreb.hr');
      expect(hostname).not.toBe('muzika.hr');
      expect(hostname).not.toBe('infozagreb.hr');
      expect(url).not.toContain('/feeds/videos.xml');
    }
  });
});

describe('fetchCkanGeo never requests data.zagreb.hr/api/', () => {
  it('reads both spatial layers from direct download URLs that clear the guard', async () => {
    const requested: string[] = [];
    await fetchCkanGeo({
      now: () => new Date('2026-09-12T00:45:30Z'),
      fetch: async (url) => {
        requested.push(url);
        return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }));
      },
    });
    expect(requested).toEqual([ARCGIS_CETVRTI_URL, ZBORNA_MJESTA_URL]);
    for (const url of requested) expect(() => assertRobotsAllow(url), url).not.toThrow();
  });
});
