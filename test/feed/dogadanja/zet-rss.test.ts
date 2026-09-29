import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FetchContext } from '../../../worker/feed/schema';
import { SUMMARY_MAX, ZET_RSS_NOVOSTI_URL, ZET_RSS_PROMET_URL, fetchZetRss, noticeSummary } from '../../../worker/feed/modules/dogadanja/zet-rss';
import { SAMPLED_NOTICE_SUMMARIES } from '../../fixtures/external-text-corpus';

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

const fixture = (name: string): string => readFileSync(new URL(`../../fixtures/dogadanja/${name}`, import.meta.url), 'utf8');
const NOVOSTI_FIXTURES = ['zet-rss-novosti.xml', 'zet-rss-novosti-2026-09-29.xml'];
const PROMET_FIXTURES = ['zet-rss-promet.xml', 'zet-rss-promet-2026-09-27.xml', 'zet-rss-promet-2026-09-29.xml'];

/** One feed's saved copy through the module, the other feed empty. */
async function itemsOf(url: string, file: string) {
  const empty = '<rss><channel></channel></rss>';
  const result = await fetchZetRss(makeContext({
    [url]: () => new Response(fixture(file)),
    [url === ZET_RSS_NOVOSTI_URL ? ZET_RSS_PROMET_URL : ZET_RSS_NOVOSTI_URL]: () => new Response(empty),
  }));
  return result.items;
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

  it('reads the first real novosti item as headline, link, publish time and the start of its description, tagged with its own feed', async () => {
    const result = await fetchZetRss(makeContext());
    const item = byId(result.items, 'zet-novosti:10123');
    expect(item).toEqual({
      id: 'zet-novosti:10123',
      title: 'Dan otvorenih vrata ZET-a',
      link: 'https://www.zet.hr/default.aspx?id=10123',
      // <pubDate>Tue, 08 Sep 2026 22:00:00 +0200</pubDate> (see the fixture).
      at: '2026-09-08T20:00:00.000Z',
      // The first sentence of <description>: ZET's own words, whole (upgrade U1).
      summary: 'U sklopu proslave 135. rođendana, Zagrebački električni tramvaj u subotu, 12. rujna, od 9 do 19 sati, organizira manifestaciju „Dan otvorenih vrata“, koja će se održati u krugu tvrtke na trešnjevačkoj Remizi.',
      dateBasis: 'published',
      data: { source: 'zet-novosti', precision: 'time' },
    });
  });

  it('reads the first real promet item as headline, link, publish time and the start of its description, tagged with its own feed', async () => {
    const result = await fetchZetRss(makeContext());
    const item = byId(result.items, 'zet-promet:10146');
    expect(item).toEqual({
      id: 'zet-promet:10146',
      title: 'Radovi u subotu skreću linije 102 i 105',
      link: 'https://www.zet.hr/default.aspx?id=10146',
      // <pubDate>Fri, 11 Sep 2026 09:00:00 +0200</pubDate> (see the fixture).
      at: '2026-09-11T07:00:00.000Z',
      summary: 'U subotu, 12. rujna, od 8 do 15 sati, autobusne linije 102 (Britanski trg - Mihaljevac) i 105 (Kaptol - Britanski trg) prometovat će izmijenjenim trasama zbog radova u Ulici Nova Ves i Tuškanac.',
      dateBasis: 'published',
      data: { source: 'zet-promet', precision: 'time' },
    });
  });

  it('carries a publish time from <pubDate> (R-E1) and, since the October 2026 brief, the start of the description as `summary`, but never a description or a date read out of prose', async () => {
    const result = await fetchZetRss(makeContext());
    for (const item of result.items) {
      expect(item.at).toBeTypeOf('string');
      expect(Number.isFinite(Date.parse(item.at as string))).toBe(true);
      expect(item.data.precision).toBe('time');
      expect(item).not.toHaveProperty('until');
      expect(item).not.toHaveProperty('description');
    }
    const serialized = JSON.stringify(result.items);
    // Sentences after the first one stay in the feed: only whole sentences up
    // to the limit are taken, and the courtesy sentence never is.
    expect(serialized).not.toContain('Korisnike ljubazno molimo za razumijevanje');
    expect(serialized).not.toContain('facebook logo');
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

  it('keeps one feed when the other fails, the allSettled shape both ZET feeds share', async () => {
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

  it('links every item of the saved copies back to a real www.zet.hr notice', async () => {
    for (const [url, files] of [[ZET_RSS_NOVOSTI_URL, NOVOSTI_FIXTURES], [ZET_RSS_PROMET_URL, PROMET_FIXTURES]] as const) {
      for (const file of files) for (const item of await itemsOf(url, file)) expect(item.link.startsWith('https://www.zet.hr/')).toBe(true);
    }
  });
});

// The start of a notice's description, as whole sentences (upgrade U1, step 3):
// what the "ZET javlja" row prints under its title.
describe('the summary of the five saved ZET copies', () => {
  const all = async () => [
    ...(await Promise.all(NOVOSTI_FIXTURES.map((file) => itemsOf(ZET_RSS_NOVOSTI_URL, file)))).flat(),
    ...(await Promise.all(PROMET_FIXTURES.map((file) => itemsOf(ZET_RSS_PROMET_URL, file)))).flat(),
  ];

  it('is at most 240 characters or absent, never with markup, an entity, a trailing colon or the courtesy sentence', async () => {
    const items = await all();
    expect(items).toHaveLength(73);
    for (const item of items) {
      if (item.summary === undefined) continue;
      expect(item.summary.length).toBeLessThanOrEqual(SUMMARY_MAX);
      expect(item.summary).not.toMatch(/[<>&]/);
      expect(item.summary).not.toMatch(/:$/);
      expect(item.summary).not.toMatch(/Korisnike (ljubazno )?molimo/);
      expect(item.summary).toBe(item.summary.trim());
      expect(item.summary).not.toMatch(/\s{2}| [,.]/);
    }
  });

  it('reads the two sentences of the brief exactly', async () => {
    const promet = await itemsOf(ZET_RSS_PROMET_URL, 'zet-rss-promet-2026-09-27.xml');
    expect(byId(promet, 'zet-promet:10160').summary).toBe(
      'U nedjelju, 27. rujna bit će obustavljen tramvajski promet Ulicom grada Vukovara na dijelu od Avenije Marina Držića do Savske ceste, zbog automobilističkog događanja Red Bull Showrun.',
    );
    expect(byId(promet, 'zet-promet:8134').summary).toBe(
      'U nedjelju, 27. rujna, od 13 do 16.45 sati, autobusna linija 113 (Ljubljanica - Jarun) neće prometovati oko Jarunskog jezera, već će prometovati do starog okretišta Jarun, zbog održavanja međunarodne biciklističke utrke CRO Race.',
    );
  });

  it('keeps the funicular notice and the emergency line, and none for the strike notice whose first sentence is over the limit', async () => {
    const promet = await itemsOf(ZET_RSS_PROMET_URL, 'zet-rss-promet-2026-09-29.xml');
    expect(byId(promet, 'zet-promet:1794').summary).toBe('Zbog redovnog mjesečnog servisa, zagrebačka uspinjača neće prometovati u srijedu, 30. rujna, od 6.30 do 14 sati.');
    const novosti = await itemsOf(ZET_RSS_NOVOSTI_URL, 'zet-rss-novosti-2026-09-29.xml');
    expect(byId(novosti, 'zet-novosti:10164')).not.toHaveProperty('summary');
    expect(byId(novosti, 'zet-novosti:10166').summary).toBe('Uprava ZET-a i sindikati su danas ujutro stupili u kontakt radi zajedničke inicijative za uspostavu autobusne linije 228 na relaciji Borongaj - Rebro - Borongaj (4 autobusa).');
  });

  it('is there for 22 of the 27 distinct traffic notices, and every one of them is in the corpus the policy test checks', async () => {
    const notices = new Map<string, string | undefined>();
    for (const file of PROMET_FIXTURES) for (const item of await itemsOf(ZET_RSS_PROMET_URL, file)) notices.set(item.title, item.summary);
    expect(notices.size).toBe(27);
    expect([...notices.values()].filter((summary) => summary !== undefined)).toHaveLength(22);
    for (const summary of notices.values()) if (summary !== undefined) expect(SAMPLED_NOTICE_SUMMARIES).toContain(summary);
  });

  it('drops a footnote mark: "* Objavljeno u ponedjeljak" is the feed\'s note, not the notice', async () => {
    const promet = await itemsOf(ZET_RSS_PROMET_URL, 'zet-rss-promet.xml');
    const summary = byId(promet, 'zet-promet:9564').summary!;
    expect(summary).toMatch(/vozit će autobusi\.$/);
    expect(summary).not.toContain('*');
  });
});

describe('noticeSummary', () => {
  it('takes tags and entities out and breaks lines at the markup that breaks them', () => {
    expect(noticeSummary('<div style="x"><strong>Linija 5</strong> ne vozi&nbsp;do Črnomerca&nbsp;&ndash; radovi na pruzi.</div>')).toBe('Linija 5 ne vozi do Črnomerca – radovi na pruzi.');
    expect(noticeSummary('Prva rečenica ovdje &bdquo;u navodnicima&rdquo; &amp; dalje&#8230;<br>Druga rečenica dolazi u drugom retku.')).toBe('Prva rečenica ovdje „u navodnicima” & dalje… Druga rečenica dolazi u drugom retku.');
  });

  it('closes up " ," and " ." and collapses the source\'s own wrapping without breaking a sentence', () => {
    expect(noticeSummary('Zbog radova na <b>Ilici</b> , linija 6\r\n   ne vozi do Dubca .')).toBe('Zbog radova na Ilici, linija 6 ne vozi do Dubca.');
  });

  it('splits before a capital or a quote but not after a lowercase word, a number or an initial', () => {
    expect(noticeSummary('Radovi u Ulici Dominika Mandića traju do 27. rujna. Linija 137 vozi kružno.')).toBe('Radovi u Ulici Dominika Mandića traju do 27. rujna. Linija 137 vozi kružno.');
    // The first piece alone is over the limit when the second is not taken: split proven by what stops at 240.
    const first = `Radovi u Ulici D. Mandića traju ${'dugo '.repeat(20)}dok se ne završe.`;
    const second = 'Druga rečenica ne stane u ostatak dopuštene duljine jer je prva već gotovo cijela ' + 'duga '.repeat(12) + 'do kraja.';
    expect(first.length).toBeLessThan(SUMMARY_MAX);
    expect(first.length + second.length).toBeGreaterThan(SUMMARY_MAX);
    expect(noticeSummary(`${first} ${second}`)).toBe(first);
    expect(noticeSummary('Uprava se obratila u ulici Dominika Mandića 5. Nova rečenica počinje ovdje.')).toBe('Uprava se obratila u ulici Dominika Mandića 5. Nova rečenica počinje ovdje.');
  });

  it('skips headings under 20 characters and colon lead-ins under 40, and drops the courtesy sentence', () => {
    expect(noticeSummary('<u>Noćna linija 31:</u><br>Zbog sanacije kolosijeka noćnu liniju 31 zamjenjuju autobusi.<br>Korisnike ljubazno molimo za razumijevanje.')).toBe('Zbog sanacije kolosijeka noćnu liniju 31 zamjenjuju autobusi.');
    expect(noticeSummary('Izmjene trasa u subotu:<br>Linija 6 vozi do Črnomerca zbog radova na Ilici.')).toBe('Linija 6 vozi do Črnomerca zbog radova na Ilici.');
    expect(noticeSummary('Korisnike molimo da prate obavijesti na mrežnim stranicama.')).toBeUndefined();
  });

  it('ends a summary at a colon sentence and turns its colon into a full stop', () => {
    expect(noticeSummary('Zbog radova na Savskoj cesti mijenjaju se trase sljedećih linija:<br>Linija 5 ide preko Kvaternikova trga.')).toBe('Zbog radova na Savskoj cesti mijenjaju se trase sljedećih linija.');
  });

  it('ends a summary before a footnote or a bullet, and before a piece still holding markup or an entity', () => {
    expect(noticeSummary('Linija 6 ne vozi do Črnomerca zbog radova.<br>* Objavljeno u ponedjeljak, 7. rujna')).toBe('Linija 6 ne vozi do Črnomerca zbog radova.');
    expect(noticeSummary('Linija 6 ne vozi do Črnomerca zbog radova.<br>Vidi &foo; ili &lt;script&gt; ovdje u tekstu.')).toBe('Linija 6 ne vozi do Črnomerca zbog radova.');
  });

  it('never cuts inside a piece: a first sentence over 240 gives no summary and a later one stops the join', () => {
    const long = `Autobusna linija ${'vrlo '.repeat(50)}dugačka.`;
    expect(long.length).toBeGreaterThan(SUMMARY_MAX);
    expect(noticeSummary(long)).toBeUndefined();
    expect(noticeSummary(`Kratka obavijest o linijama.<br>${long}`)).toBe('Kratka obavijest o linijama.');
  });

  it('gives nothing for an empty or wordless description', () => {
    expect(noticeSummary('')).toBeUndefined();
    expect(noticeSummary('<div>&nbsp;</div><img src="x.jpg">')).toBeUndefined();
  });
});
