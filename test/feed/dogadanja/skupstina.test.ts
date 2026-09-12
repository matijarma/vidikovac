import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FetchContext } from '../../../worker/feed/schema';
import { zagrebIso } from '../../../worker/feed/time';
import {
  SKUPSTINA_ROKOVNIK_URL,
  SKUPSTINA_YOUTUBE_URL,
  fetchSkupstina,
} from '../../../worker/feed/modules/dogadanja/skupstina';

// The instant test/fixtures/dogadanja/sources.json records for these two
// fetches (rokovnik 00:45:28Z, sjednica 00:45:43Z) -- close enough together,
// and both same-day in Zagreb, that reusing hr-date.test.ts's own FETCH_NOW
// keeps every area-E test dated against one shared, real moment.
const FETCH_NOW = new Date('2026-09-12T00:44:38Z');

const rokovnikHtml = readFileSync(new URL('../../fixtures/dogadanja/skupstina-rokovnik.html', import.meta.url), 'utf8');
const sjednicaHtml = readFileSync(new URL('../../fixtures/dogadanja/skupstina-sjednica.html', import.meta.url), 'utf8');

const PLENARY_SESSION_URL = 'https://skupstina.zagreb.hr/poziv-na-13-sjednicu-gradske-skupstine-grada-zagreba/8711';
const COMMITTEE_SESSION_URL = 'https://skupstina.zagreb.hr/15-sjednica-odbora-za-financije-8744/8744';

// Only ONE real session page was ever fetched live -- the plenary invite
// (test/fixtures/dogadanja/sources.json names exactly one). The committee
// row's own session page was never separately saved, so this context answers
// that URL with the SAME real HTML: both rows share one CMS template (the
// header/nav/page-text/footer shape is byte-identical across the two saved
// fixtures), so reusing it here proves the parser generalises across rows
// rather than being special-cased to the one page we happened to fetch.
function makeContext(overrides: Record<string, () => Response> = {}, now: Date = FETCH_NOW): FetchContext {
  return {
    now: () => now,
    fetch: async (url) => {
      if (overrides[url]) return overrides[url]();
      if (url === SKUPSTINA_ROKOVNIK_URL) return new Response(rokovnikHtml);
      if (url === PLENARY_SESSION_URL || url === COMMITTEE_SESSION_URL) return new Response(sjednicaHtml);
      throw new Error(`unexpected url: ${url}`);
    },
  };
}

function byId<T extends { id: string }>(items: T[], id: string): T {
  const item = items.find((row) => row.id === id);
  if (!item) throw new Error(`item ${id} not found`);
  return item;
}

describe('fetchSkupstina', () => {
  it('requests the real, saved rokovnik url', () => {
    expect(SKUPSTINA_ROKOVNIK_URL).toBe('https://skupstina.zagreb.hr/rokovnik-sjednica/76');
  });

  it('reads the real rokovnik page, dropping the eight undated rows and counting them (R-P6: no date, no item)', async () => {
    const result = await fetchSkupstina(makeContext());
    expect(result.items).toHaveLength(2);
    expect(result.droppedCount).toBe(8);
  });

  it("reads the plenary session's full date, time, venue and materials link", async () => {
    const result = await fetchSkupstina(makeContext());
    const item = byId(result.items, 'skupstina:8711');
    expect(item).toMatchObject({
      title: 'Poziv na 13. sjednicu Gradske skupštine Grada Zagreba',
      at: zagrebIso(2026, 9, 16, 9, 0),
      link: 'https://skupstina.zagreb.hr/UserDocsImages/gsgz2025/pozivi na sjednicu/pozivi na sjednice gsgz/Poziv za 13. sjednicu GSGZ.pdf',
      data: {
        source: 'skupstina',
        organiser: 'Gradske skupštine Grada Zagreba',
        category: 'sjednica-skupstine',
        precision: 'time',
        venue: 'Staroj gradskoj vijećnici, Ulica sv. Ćirila i Metoda 5/I., dvorana "A"',
        live: 'youtube',
      },
    });
    expect(item.until).toBeUndefined();
  });

  it('never fetches, and never needs, the disallowed YouTube feed path (R-P5): the channel live page is a fixed constant, not a per-item field', () => {
    expect(SKUPSTINA_YOUTUBE_URL).toBe('https://www.youtube.com/channel/UCRMm4Xt9ruoQ8FG7NpIHCsA');
    expect(SKUPSTINA_YOUTUBE_URL).not.toContain('/feeds/');
  });

  it('gives a committee session no live field and category sjednica-odbora, from its own rokovnik title', async () => {
    const result = await fetchSkupstina(makeContext());
    const item = byId(result.items, 'skupstina:8744');
    expect(item.title).toBe('15. sjednica Odbora za financije');
    expect(item.data.live).toBeUndefined();
    expect(item.data.category).toBe('sjednica-odbora');
    expect(item.data.organiser).toBe('Odbora za financije');
  });

  it('falls back to the rokovnik date at day precision when the session page carries no readable prose date', async () => {
    const result = await fetchSkupstina(
      makeContext({
        [PLENARY_SESSION_URL]: () => new Response('<html><body><div class="page-text">nothing readable here<!--galerija--></div></body></html>'),
      }),
    );
    const item = byId(result.items, 'skupstina:8711');
    expect(item.at).toBe(zagrebIso(2026, 9, 16, 0, 0));
    expect(item.data.precision).toBe('day');
    expect(item.data.venue).toBeUndefined();
    // No materials anchor either in this stub -- link falls back to the
    // session page itself rather than being dropped.
    expect(item.link).toBe(PLENARY_SESSION_URL);
  });

  it('falls back to the session page URL as the item link when no materials anchor is found', async () => {
    const noMaterialsHtml = sjednicaHtml.replace(
      /<a href="[^"]*Poziv[^"]*\.pdf"[^>]*>Poziv na sjednicu<\/a>/,
      '',
    );
    expect(noMaterialsHtml).not.toBe(sjednicaHtml); // sanity: the replace matched real markup
    const result = await fetchSkupstina(makeContext({ [PLENARY_SESSION_URL]: () => new Response(noMaterialsHtml) }));
    const item = byId(result.items, 'skupstina:8711');
    expect(item.link).toBe(PLENARY_SESSION_URL);
    // Time and venue still come through: the materials anchor is unrelated to the prose.
    expect(item.data.precision).toBe('time');
    expect(item.data.venue).toBe('Staroj gradskoj vijećnici, Ulica sv. Ćirila i Metoda 5/I., dvorana "A"');
  });

  it('drops a row whose session page fetch fails, counting it, without losing the other row', async () => {
    const result = await fetchSkupstina(
      makeContext({
        [PLENARY_SESSION_URL]: () => {
          throw new Error('network down');
        },
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(byId(result.items, 'skupstina:8744')).toBeTruthy();
    expect(result.droppedCount).toBe(9);
  });

  it('drops a row whose session page answers with a non-2xx status, counting it', async () => {
    const result = await fetchSkupstina(
      makeContext({ [PLENARY_SESSION_URL]: () => new Response('not found', { status: 404 }) }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.droppedCount).toBe(9);
  });

  it('never copies invitation prose into an item (R-P6): the venue is kept (it is permitted headline metadata) but the surrounding sentence is not', async () => {
    const result = await fetchSkupstina(makeContext());
    for (const item of result.items) {
      expect(item).not.toHaveProperty('summary');
      expect(item).not.toHaveProperty('description');
      const serialized = JSON.stringify(item);
      // The day name and the "s početkom u ... sati" construction are the
      // invitation's own sentence structure, not headline metadata -- only
      // the parsed instant and the venue text after it survive.
      expect(serialized).not.toContain('Srijeda');
      expect(serialized).not.toContain('početkom');
    }
    // The plenary item's venue text itself IS expected to survive: it is the
    // permitted "venue" field, not borrowed description prose.
    expect(byId(result.items, 'skupstina:8711').data.venue).toContain('Ulica sv. Ćirila i Metoda 5');
  });

  it('survives a whitespace and attribute-order change in the rokovnik row markup', async () => {
    // Real content (the plenary row), reformatted: class before href, extra
    // whitespace/newlines and attribute spacing on both <a> and <i> -- the
    // shape a CMS reflow eventually produces (brief's own requirement).
    const reflowedRokovnik = rokovnikHtml.replace(
      "<a href='/poziv-na-13-sjednicu-gradske-skupstine-grada-zagreba/8711' class='news-result'>\n<span><i class='news-date'>16.09.2026.</i>Poziv na 13. sjednicu Gradske skupštine Grada Zagreba</span>\n</a>",
      '<a\n  class="news-result"\n  href="/poziv-na-13-sjednicu-gradske-skupstine-grada-zagreba/8711"\n>\n<span>\n  <i   class="news-date" >16.09.2026.</i>Poziv na 13. sjednicu Gradske skupštine Grada Zagreba\n</span>\n</a>',
    );
    expect(reflowedRokovnik).not.toBe(rokovnikHtml);

    const reflowedContext = makeContext();
    reflowedContext.fetch = async (url) => {
      if (url === SKUPSTINA_ROKOVNIK_URL) return new Response(reflowedRokovnik);
      return new Response(sjednicaHtml);
    };

    const result = await fetchSkupstina(reflowedContext);
    expect(result.droppedCount).toBe(8);
    expect(byId(result.items, 'skupstina:8711')).toMatchObject({
      title: 'Poziv na 13. sjednicu Gradske skupštine Grada Zagreba',
      at: zagrebIso(2026, 9, 16, 9, 0),
    });
  });

  it('survives a whitespace and attribute-order change in the session page markup', async () => {
    const reflowedSjednica = sjednicaHtml
      .replace("<div class='date-published'>16.09.2026.</div>", '<div   class="date-published"   >16.09.2026.</div>')
      .replace(
        '<a href="https://skupstina.zagreb.hr/UserDocsImages/gsgz2025/pozivi na sjednicu/pozivi na sjednice gsgz/Poziv za 13. sjednicu GSGZ.pdf" data-fileid="8223">Poziv na sjednicu</a>',
        '<a data-fileid="8223" href="https://skupstina.zagreb.hr/UserDocsImages/gsgz2025/pozivi na sjednicu/pozivi na sjednice gsgz/Poziv za 13. sjednicu GSGZ.pdf">\n  Poziv na sjednicu\n</a>',
      );
    expect(reflowedSjednica).not.toBe(sjednicaHtml);

    const result = await fetchSkupstina(makeContext({ [PLENARY_SESSION_URL]: () => new Response(reflowedSjednica) }));
    const item = byId(result.items, 'skupstina:8711');
    expect(item.data.venue).toBe('Staroj gradskoj vijećnici, Ulica sv. Ćirila i Metoda 5/I., dvorana "A"');
    expect(item.data.precision).toBe('time');
    expect(item.link).toBe(
      'https://skupstina.zagreb.hr/UserDocsImages/gsgz2025/pozivi na sjednicu/pozivi na sjednice gsgz/Poziv za 13. sjednicu GSGZ.pdf',
    );
  });
});
