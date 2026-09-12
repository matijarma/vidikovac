import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FetchContext } from '../../../worker/feed/schema';
import type { ItemInput } from '../../../worker/feed/payload';
import { KULTURPUNKT_URL } from '../../../worker/feed/modules/dogadanja/kulturpunkt';
import { SKUPSTINA_ROKOVNIK_URL } from '../../../worker/feed/modules/dogadanja/skupstina';
import { KVARTOVSKE_URL } from '../../../worker/feed/modules/dogadanja/kvartovske';
import { KOMUNALNE_URL } from '../../../worker/feed/modules/dogadanja/komunalne';
import { ZET_RSS_NOVOSTI_URL, ZET_RSS_PROMET_URL } from '../../../worker/feed/modules/dogadanja/zet-rss';
import { ETNOGRAFSKI_DOGADJANJA_URL, ETNOGRAFSKI_IZLOZBE_URL } from '../../../worker/feed/modules/dogadanja/etnografski';
import {
  DOGADANJA_ATTRIBUTION,
  DOGADANJA_SOURCE_CAP,
  DOGADANJA_SOURCE_TIMEOUT_MS,
  capSource,
  compareDogadanja,
  fetchDogadanja,
  raceTimeout,
} from '../../../worker/feed/modules/dogadanja';

// The instant every dedicated sub-fetcher test uses is within the same
// ~3-minute real fetch window (test/fixtures/dogadanja/sources.json,
// 2026-09-12T00:44:38Z..00:46:50Z); a single shared instant anywhere in that
// window reproduces the exact same drop/keep decisions every one of E2-E5's
// own tests already proved, since nothing in that window crosses a calendar
// day (Zagreb, CEST) or a six-month year-inference boundary.
const FETCH_NOW = new Date('2026-09-12T00:45:30Z');

const FIXTURE_DIR = new URL('../../fixtures/dogadanja/', import.meta.url);
const text = (name: string) => readFileSync(new URL(name, FIXTURE_DIR), 'utf8');

const kulturpunkt = text('kulturpunkt.json');
const rokovnik = text('skupstina-rokovnik.html');
const sjednica = text('skupstina-sjednica.html');
const kvartovske = text('kvartovske-novosti.html');
const komunalne = text('komunalne-aktivnosti.json');
const zetNovosti = text('zet-rss-novosti.xml');
const zetPromet = text('zet-rss-promet.xml');
const etnografskiDogadjanja = text('etnografski-dogadjanja.json');
const etnografskiIzlozbe = text('etnografski-izlozbe.json');

// One real, saved fixture per real URL fragment -- the same "byte-identical
// upstream" discipline test/feed/fixture-contexts.ts documents for the other
// eight modules. Skupstina's two distinct real session-page URLs both answer
// with the one saved session-page fixture, exactly as skupstina.test.ts
// itself already does (only one real page was ever fetched live).
type Route = [needle: string, body: () => BodyInit];
const ROUTES: Route[] = [
  ['kp_22_announcement', () => kulturpunkt],
  ['rokovnik-sjednica', () => rokovnik],
  ['poziv-na-13-sjednicu-gradske-skupstine-grada-zagreba', () => sjednica],
  ['15-sjednica-odbora-za-financije', () => sjednica],
  ['kvartovske-novosti', () => kvartovske],
  ['f90738b6-8bfa-4dd9-9db7-b3c532d90c97', () => komunalne],
  ['rss_novosti.aspx', () => zetNovosti],
  ['rss_promet.aspx', () => zetPromet],
  ['wp/v2/dogadjanja', () => etnografskiDogadjanja],
  ['wp/v2/izlozbe', () => etnografskiIzlozbe],
];

function makeContext(overrides: Route[] = [], now: Date = FETCH_NOW): FetchContext {
  const routes = [...overrides, ...ROUTES];
  return {
    now: () => now,
    fetch: async (url) => {
      const match = routes.find(([needle]) => url.includes(needle));
      if (!match) throw new Error(`no fixture route for ${url}`);
      return new Response(match[1]());
    },
  };
}

// Real per-source counts every dedicated E2-E5 unit test already established
// against these exact fixture files (39/2/20/510/35/6); komunalne alone
// exceeds DOGADANJA_SOURCE_CAP (40) and is the only one this cap trims.
const REAL_RAW_COUNTS = {
  kulturpunkt: 39,
  skupstina: 2,
  kvartovske: 20,
  komunalne: 510,
  'zet-rss': 35,
  etnografski: 6,
} as const;

describe('fetchDogadanja', () => {
  it('merges all six real sources behind one snapshot, capping only the one that exceeds the per-source cap', async () => {
    const result = await fetchDogadanja(makeContext());
    expect(result.sourceCounts).toEqual({
      kulturpunkt: REAL_RAW_COUNTS.kulturpunkt,
      skupstina: REAL_RAW_COUNTS.skupstina,
      kvartovske: REAL_RAW_COUNTS.kvartovske,
      komunalne: DOGADANJA_SOURCE_CAP,
      'zet-rss': REAL_RAW_COUNTS['zet-rss'],
      etnografski: REAL_RAW_COUNTS.etnografski,
    });
    const expectedTotal =
      REAL_RAW_COUNTS.kulturpunkt +
      REAL_RAW_COUNTS.skupstina +
      REAL_RAW_COUNTS.kvartovske +
      DOGADANJA_SOURCE_CAP +
      REAL_RAW_COUNTS['zet-rss'] +
      REAL_RAW_COUNTS.etnografski;
    expect(result.items).toHaveLength(expectedTotal);
  });

  it('stamps module and tier on every merged item and on the snapshot itself', async () => {
    const result = await fetchDogadanja(makeContext());
    expect(result.module).toBe('dogadanja');
    expect(result.tier).toBe('session');
    expect(result.attribution).toEqual(DOGADANJA_ATTRIBUTION);
    expect(result.fetchedAt).toBe(FETCH_NOW.toISOString());
    for (const item of result.items) {
      expect(item.module).toBe('dogadanja');
      expect(item.tier).toBe('session');
    }
  });

  it('emits only keys DATA_KEYS.event declares, across every item from every source', async () => {
    const { DATA_KEYS } = await import('../../../worker/feed/schema');
    const result = await fetchDogadanja(makeContext());
    for (const item of result.items) {
      expect(item.kind).toBe('event');
      for (const key of Object.keys(item.data ?? {})) {
        expect(DATA_KEYS.event, `${item.id} carries ${key}`).toContain(key);
      }
    }
  });

  it('sorts by explicit date semantics and preserves undated source order', async () => {
    const result = await fetchDogadanja(makeContext());
    for (const item of result.items) {
      expect(item.dateBasis).toBe(item.data?.source === 'kvartovske' ? 'unknown'
        : item.data?.source === 'komunalne' ? 'updated'
          : String(item.data?.source).startsWith('zet-') ? 'published' : 'event');
    }
    expect(result.items).toEqual([...result.items].sort((a, b) => compareDogadanja(a, b, FETCH_NOW)));
    const notices = result.items.filter((item) => item.data?.source === 'kvartovske');
    expect(notices.slice(0, 3).map((item) => item.title)).toEqual([
      'Hop-in kino na Jarunu', 'Dani Remetinca', 'Dan Mjesnog odbora Horvati-Srednjaci - Druženje za sve generacije',
    ]);
    expect(notices.every((item) => !item.at)).toBe(true);
  });

  it('reports the per-publisher cap and does not invent an overall total for paginated sources', async () => {
    const result = await fetchDogadanja(makeContext());
    expect(result.sources?.komunalne).toMatchObject({ status: 'live', itemCount: 40, totalItems: 510 });
    expect(result.sources?.kvartovske).toMatchObject({ status: 'live', itemCount: 20 });
    expect(result.sources?.kvartovske.totalItems).toBeUndefined();
    expect(result.sources?.kulturpunkt.totalItems).toBeUndefined(); // full WP page, no total header
    expect(result.sources?.skupstina.totalItems).toBeUndefined(); // first of two HTML pages
    expect(result.coverage).toEqual({ shown: result.items.length, limited: true });
    expect(Object.values(result.sources!).reduce((sum, source) => sum + source.itemCount, 0)).toBe(result.items.length);
  });

  it('distinguishes a successfully empty source from a rejected one, including inner endpoints', async () => {
    const result = await fetchDogadanja(makeContext([
      ['kp_22_announcement', () => '[]'],
      ['rss_novosti.aspx', () => '<rss><channel/></rss>'],
      ['rss_promet.aspx', () => { throw new Error('down'); }],
      ['wp/v2/izlozbe', () => { throw new Error('down'); }],
    ]));
    expect(result.sources?.kulturpunkt).toMatchObject({ status: 'live', itemCount: 0, totalItems: 0 });
    expect(result.sources?.['zet-novosti']).toMatchObject({ status: 'live', itemCount: 0, totalItems: 0 });
    expect(result.sources?.['zet-promet']).toMatchObject({ status: 'down', itemCount: 0 });
    expect(result.sources?.['etnografski-dogadjanja'].status).toBe('live');
    expect(result.sources?.['etnografski-izlozbe'].status).toBe('down');
    expect(result.coverage?.limited).toBe(true);
    expect(result.coverage?.total).toBeUndefined();
  });

  it('places the newest ZET notice above an older communal-works row (R-E1)', async () => {
    const result = await fetchDogadanja(makeContext());
    const zetItems = result.items.filter((item) => item.data?.source === 'zet-novosti' || item.data?.source === 'zet-promet');
    const komunalneItems = result.items.filter((item) => item.data?.source === 'komunalne');
    expect(zetItems.length).toBeGreaterThan(0);
    expect(komunalneItems.length).toBeGreaterThan(0);

    const newestZet = zetItems[0]; // list is already sorted desc, so the first one encountered is the newest.
    const olderKomunalne = komunalneItems.find((item) => Date.parse(item.at!) < Date.parse(newestZet.at!));
    expect(olderKomunalne, 'no komunalne row is older than the newest ZET notice in this fixture').toBeDefined();

    const newestZetIndex = result.items.indexOf(newestZet);
    const olderKomunalneIndex = result.items.indexOf(olderKomunalne!);
    expect(newestZetIndex).toBeLessThan(olderKomunalneIndex);
  });

  it('contributes nothing from a source that rejects, without throwing the module down, and reports it in sourceCounts', async () => {
    const result = await fetchDogadanja(
      makeContext([['f90738b6-8bfa-4dd9-9db7-b3c532d90c97', () => { throw new Error('upstream 503'); }]]),
    );
    expect(result.sourceCounts.komunalne).toBe(0);
    expect(result.sourceCounts.kulturpunkt).toBe(REAL_RAW_COUNTS.kulturpunkt);
    expect(result.sourceCounts.etnografski).toBe(REAL_RAW_COUNTS.etnografski);
    expect(result.items.some((item) => item.data?.source === 'komunalne')).toBe(false);
  });

  it('returns only the sixth source when the other five reject, each at zero in sourceCounts (R-X1)', async () => {
    const ctx: FetchContext = {
      now: () => FETCH_NOW,
      fetch: async (url) => {
        if (url.includes('wp/v2/dogadjanja')) return new Response(etnografskiDogadjanja);
        if (url.includes('wp/v2/izlozbe')) return new Response(etnografskiIzlozbe);
        throw new Error(`upstream down: ${url}`);
      },
    };
    const result = await fetchDogadanja(ctx);
    expect(result.sourceCounts).toEqual({
      kulturpunkt: 0,
      skupstina: 0,
      kvartovske: 0,
      komunalne: 0,
      'zet-rss': 0,
      etnografski: REAL_RAW_COUNTS.etnografski,
    });
    expect(result.items).toHaveLength(REAL_RAW_COUNTS.etnografski);
    expect(result.items.every((item) => item.data?.source === 'etnografski')).toBe(true);
  });

  it('throws when every one of the six sources rejects, so the cache layer can serve the KV last-good copy (R-X1)', async () => {
    const throwing: Route = ['', () => { throw new Error('all down'); }];
    await expect(fetchDogadanja(makeContext([throwing]))).rejects.toThrow(/dogadanja/);
  });

  it('requests only the real, already-verified sub-fetcher URLs, never a Guru za kulturu or YouTube feed path (R-P5)', async () => {
    const seen: string[] = [];
    const ctx: FetchContext = {
      now: () => FETCH_NOW,
      fetch: async (url) => {
        seen.push(url);
        const match = ROUTES.find(([needle]) => url.includes(needle));
        if (!match) throw new Error(`no fixture route for ${url}`);
        return new Response(match[1]());
      },
    };
    await fetchDogadanja(ctx);
    expect(seen).toContain(KULTURPUNKT_URL);
    expect(seen).toContain(SKUPSTINA_ROKOVNIK_URL);
    expect(seen).toContain(KVARTOVSKE_URL);
    expect(seen).toContain(KOMUNALNE_URL);
    expect(seen).toContain(ZET_RSS_NOVOSTI_URL);
    expect(seen).toContain(ZET_RSS_PROMET_URL);
    expect(seen).toContain(ETNOGRAFSKI_DOGADJANJA_URL);
    expect(seen).toContain(ETNOGRAFSKI_IZLOZBE_URL);
    expect(seen.some((url) => url.includes('kultura.zagreb.hr'))).toBe(false);
    expect(seen.some((url) => url.includes('youtube.com/feeds'))).toBe(false);
  });
});

describe('capSource', () => {
  it('names the per-source cap the brief calls for', () => {
    expect(DOGADANJA_SOURCE_CAP).toBe(40);
  });

  it('keeps the N most recent items when a source exceeds the cap, not merely the first N encountered', () => {
    const items: ItemInput[] = Array.from({ length: 45 }, (_, i) => ({
      id: `x${i}`,
      kind: 'event',
      title: `t${i}`,
      // x0 is the oldest, x44 the most recent.
      at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      data: { source: 'test' },
    }));
    // Deliberately not in date order, so "first 40 encountered" would differ
    // from "40 most recent" if capSource didn't sort before slicing.
    const shuffled = [items[20], items[0], items[44], ...items.slice(1, 20), ...items.slice(21, 44)];
    expect(shuffled).toHaveLength(45);

    const capped = capSource(shuffled);
    expect(capped).toHaveLength(DOGADANJA_SOURCE_CAP);
    expect(capped[0].id).toBe('x44');
    expect(capped.map((item) => item.id)).not.toContain('x0');
    expect(capped.map((item) => item.id)).not.toContain('x4');
    expect(capped.map((item) => item.id)).toContain('x5');
  });

  it('leaves a source under the cap untouched but still sorted', () => {
    const items: ItemInput[] = [
      { id: 'a', kind: 'event', title: 'a', at: new Date(Date.UTC(2026, 0, 1)).toISOString(), data: { source: 'test' } },
      { id: 'b', kind: 'event', title: 'b', at: new Date(Date.UTC(2026, 0, 3)).toISOString(), data: { source: 'test' } },
    ];
    expect(capSource(items).map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('keeps soonest upcoming events before distant ones and undated notices in original order', () => {
    const items: ItemInput[] = [
      { id: 'far', kind: 'event', title: 'far', dateBasis: 'event', at: '2027-01-01T12:00:00Z' },
      { id: 'notice-z', kind: 'event', title: 'Z', dateBasis: 'unknown' },
      { id: 'soon', kind: 'event', title: 'soon', dateBasis: 'event', at: '2026-09-13T12:00:00Z' },
      { id: 'notice-a', kind: 'event', title: 'A', dateBasis: 'unknown' },
      { id: 'updated', kind: 'event', title: 'works', dateBasis: 'updated', at: '2026-09-11T12:00:00Z' },
    ];
    expect(capSource(items, FETCH_NOW).map((item) => item.id)).toEqual(['soon', 'far', 'updated', 'notice-z', 'notice-a']);
    expect(items[0].id).toBe('far'); // does not mutate publisher input
  });

  it('keeps day-precision ranges current through their final Zagreb calendar day', () => {
    const range: ItemInput = {
      id: 'range', title: 'Range', kind: 'event', dateBasis: 'event',
      at: '2026-09-09T22:00:00Z', until: '2026-09-11T22:00:00Z', data: { precision: 'range' },
    };
    const notice: ItemInput = {
      id: 'news', title: 'News', kind: 'event', dateBasis: 'published', at: '2026-09-12T07:00:00Z',
    };
    expect(capSource([notice, range], new Date('2026-09-12T12:00:00Z')).map((item) => item.id)).toEqual(['range', 'news']);
  });
});

describe('raceTimeout', () => {
  it('resolves with the value when the promise settles before the deadline', async () => {
    await expect(raceTimeout(Promise.resolve('ok'), 1000, 'test')).resolves.toBe('ok');
  });

  it('rejects once the deadline passes, for a promise that never settles', async () => {
    await expect(raceTimeout(new Promise(() => {}), 20, 'slow-source')).rejects.toThrow(/slow-source/);
  });

  it('propagates the original rejection when the promise fails before the deadline', async () => {
    await expect(raceTimeout(Promise.reject(new Error('boom')), 1000, 'test')).rejects.toThrow('boom');
  });

  it('names the production per-source deadline the brief calls for', () => {
    expect(DOGADANJA_SOURCE_TIMEOUT_MS).toBe(6000);
  });
});
