import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FetchContext } from '../../../worker/feed/schema';
import { KVARTOVSKE_URL, fetchKvartovske } from '../../../worker/feed/modules/dogadanja/kvartovske';

// The instant test/fixtures/dogadanja/sources.json records for this fetch.
const FETCH_NOW = new Date('2026-09-12T00:45:04Z');

const kvartovskeHtml = readFileSync(new URL('../../fixtures/dogadanja/kvartovske-novosti.html', import.meta.url), 'utf8');

function makeContext(html: string = kvartovskeHtml, now: Date = FETCH_NOW): FetchContext {
  return {
    now: () => now,
    fetch: async (url) => {
      if (url !== KVARTOVSKE_URL) throw new Error(`unexpected url: ${url}`);
      return new Response(html);
    },
  };
}

describe('fetchKvartovske', () => {
  it('requests the real, saved page url', () => {
    expect(KVARTOVSKE_URL).toBe('https://aktivnosti.zagreb.hr/kvartovske-novosti/134585');
  });

  it('reads all 20 real items off the page, in the order the page itself lists them', async () => {
    const result = await fetchKvartovske(makeContext());
    expect(result.items).toHaveLength(20);
    expect(result.items.slice(0, 3).map((item) => item.title)).toEqual([
      'Hop-in kino na Jarunu',
      'Dani Remetinca',
      'Dan Mjesnog odbora Horvati-Srednjaci - Druženje za sve generacije',
    ]);
  });

  it('never invents dates or date precision for the undated listing', async () => {
    const result = await fetchKvartovske(makeContext());
    for (const item of result.items) {
      expect(item.dateBasis).toBe('unknown');
      expect(item).not.toHaveProperty('at');
      expect(item.data).not.toHaveProperty('precision');
    }
    expect(result.totalItems).toBeUndefined(); // paginated source, not the city's whole archive
  });

  it('keeps identical IDs, order and content across fetch dates and DST changes', async () => {
    const first = await fetchKvartovske(makeContext());
    const later = await fetchKvartovske(makeContext(kvartovskeHtml, new Date('2026-11-01T23:30:00Z')));
    expect(later.items).toEqual(first.items);
  });

  it('distinguishes an empty listing from an error page or failed request', async () => {
    expect(await fetchKvartovske(makeContext('<h1>Kvartovske novosti</h1>'))).toEqual({ items: [], totalItems: 0 });
    await expect(fetchKvartovske(makeContext('<html>maintenance</html>'))).rejects.toThrow(/listing/);
    await expect(fetchKvartovske({ ...makeContext(), fetch: async () => new Response(kvartovskeHtml, { status: 503 }) }))
      .rejects.toThrow(/503/);
  });

  it('links every item back to its real, absolute aktivnosti.zagreb.hr page, with a stable id', async () => {
    const result = await fetchKvartovske(makeContext());
    const first = result.items[0];
    expect(first.link).toBe('https://aktivnosti.zagreb.hr/hop-in-kino-na-jarunu/136727');
    expect(first.id).toBe('kvartovske:136727');
    for (const item of result.items) {
      expect(item.link.startsWith('https://aktivnosti.zagreb.hr/')).toBe(true);
      expect(item.data.source).toBe('kvartovske');
    }
  });

  it('trims a leading space real titles carry (" KLARINJE 2026. – Vidimo se u Svetoj Klari!")', async () => {
    const result = await fetchKvartovske(makeContext());
    const item = result.items.find((row) => row.id === 'kvartovske:136720');
    expect(item?.title).toBe('KLARINJE 2026. – Vidimo se u Svetoj Klari!');
  });

  it('carries no district field -- the vocabulary has none and this page never states one', async () => {
    const result = await fetchKvartovske(makeContext());
    for (const item of result.items) {
      expect(item.data).not.toHaveProperty('district');
      expect(item).not.toHaveProperty('summary');
      expect(item).not.toHaveProperty('description');
      expect(item).not.toHaveProperty('venue');
      expect(item).not.toHaveProperty('organiser');
    }
  });

  it('survives a whitespace and attribute-order change in the item markup', async () => {
    const reflowed = kvartovskeHtml.replace(
      "<a href='/hop-in-kino-na-jarunu/136727'><h4 class='pt-20'>Hop-in kino na Jarunu</h4></a>",
      '<a\n  class="ignore-me"\n  href="/hop-in-kino-na-jarunu/136727"\n>\n<h4\n  data-x="1"\n  class="  extra pt-20  "\n>\n  Hop-in kino na Jarunu\n</h4>\n</a>',
    );
    expect(reflowed).not.toBe(kvartovskeHtml);
    const result = await fetchKvartovske(makeContext(reflowed));
    expect(result.items).toHaveLength(20);
    expect(result.items[0]).toMatchObject({
      id: 'kvartovske:136727',
      title: 'Hop-in kino na Jarunu',
      link: 'https://aktivnosti.zagreb.hr/hop-in-kino-na-jarunu/136727',
    });
  });
});
