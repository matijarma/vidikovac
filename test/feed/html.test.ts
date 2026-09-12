import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeEntities, selectAll, selectText, stripTags } from '../../worker/feed/html';

const komunalneJson = readFileSync(new URL('../fixtures/dogadanja/komunalne-aktivnosti.json', import.meta.url), 'utf8');
const komunalne = JSON.parse(komunalneJson) as { ID: string; Lokacija: string; Aktivnost: string; FazaAkcije: string }[];

function komunalneField(id: string, field: 'Lokacija' | 'Aktivnost' | 'FazaAkcije'): string {
  const record = komunalne.find((row) => row.ID === id);
  if (!record) throw new Error(`fixture record ${id} not found`);
  return record[field];
}

const kvartovskeHtml = readFileSync(new URL('../fixtures/dogadanja/kvartovske-novosti.html', import.meta.url), 'utf8');
const rokovnikHtml = readFileSync(new URL('../fixtures/dogadanja/skupstina-rokovnik.html', import.meta.url), 'utf8');
const sjednicaHtml = readFileSync(new URL('../fixtures/dogadanja/skupstina-sjednica.html', import.meta.url), 'utf8');

describe('decodeEntities', () => {
  // Table-driven over real strings, not invented ones: the komunalne aktivnosti
  // JSON is the fixture the brief names explicitly, so every diacritic case here
  // is copied verbatim (by record ID) from test/fixtures/dogadanja/komunalne-aktivnosti.json.
  it.each([
    ['numeric č (record 9DA1E439..., Lokacija)', komunalneField('9DA1E43976E50C84C1258C0E00450394', 'Lokacija'), 'Brezovička cesta 100'],
    [
      'numeric č twice (record 6938D397..., Lokacija)',
      komunalneField('6938D3974E327241C1258CF9002508C5', 'Lokacija'),
      'Hudi Bitek, Hudobička ulica III. odvojak od Brezovičke ceste',
    ],
    ['numeric đ (record 6938D397..., Aktivnost)', komunalneField('6938D3974E327241C1258CF9002508C5', 'Aktivnost'), 'Uređenje kolnika'],
    [
      'numeric ž, č, ć together (record D488F594..., Lokacija)',
      komunalneField('D488F5946401D3A9C1258D5C003AFC08', 'Lokacija'),
      'Odranski Obrež, Dragonožečka cesta (od ulice Prilaz Rožićima)',
    ],
    [
      'numeric đ, č together (record D488F594..., FazaAkcije)',
      komunalneField('D488F5946401D3A9C1258D5C003AFC08', 'FazaAkcije'),
      'Izvođač uveden u posao',
    ],
  ])('%s', (_label, input, expected) => {
    expect(decodeEntities(input)).toBe(expected);
  });

  it('decodes the named entities that occur in the ZET RSS fixtures (bdquo/ldquo Croatian quotes)', () => {
    expect(decodeEntities('U organizaciji manifestaciju &bdquo;Dan otvorenih vrata&ldquo;, koja')).toBe(
      'U organizaciji manifestaciju „Dan otvorenih vrata“, koja',
    );
  });

  it.each([
    ['&amp;', '&'],
    ['&quot;', '"'],
    ['&nbsp;', ' '],
    ['&bull;', '•'],
    ['&euro;', '€'],
    ['&rsquo;', '’'],
    ['&rdquo;', '”'],
  ])('decodes the named entity %s', (entity, char) => {
    expect(decodeEntities(`x${entity}y`)).toBe(`x${char}y`);
  });

  it('decodes the curly quotes and ellipsis that occur in the Kulturpunkt fixture', () => {
    expect(decodeEntities('Antisezona&#8230;')).toBe('Antisezona…');
    expect(decodeEntities('&#8220;wellbeing&#8221;')).toBe('“wellbeing”');
    expect(decodeEntities('&#8216;x&#8217; &#8211; y')).toBe('‘x’ – y');
  });

  it('decodes a hex numeric reference', () => {
    expect(decodeEntities('&#x160;kola')).toBe('Škola');
  });

  it('leaves an unknown named entity untouched rather than dropping it', () => {
    expect(decodeEntities('Tom &amp; Jerry &unknownentity; end')).toBe('Tom & Jerry &unknownentity; end');
  });

  it('leaves plain text with a bare ampersand untouched', () => {
    expect(decodeEntities('Q&A vecer')).toBe('Q&A vecer');
  });
});

describe('stripTags', () => {
  it('removes a real inline link+heading fragment from the Kvartovske novosti fixture', () => {
    expect(stripTags("<a href='/hop-in-kino-na-jarunu/136727'><h4 class='pt-20'>Hop-in kino na Jarunu</h4></a>")).toBe(
      'Hop-in kino na Jarunu',
    );
  });

  it('turns a removed tag into a word-separating space rather than gluing text together', () => {
    expect(stripTags("<a href='/x' class='news-result'>\n<span><i class='news-date'>14.09.2026.</i>15. sjednica Odbora za financije</span>\n</a>")).toBe(
      '14.09.2026. 15. sjednica Odbora za financije',
    );
  });

  it('returns plain text unchanged', () => {
    expect(stripTags('plain text, no markup')).toBe('plain text, no markup');
  });

  it('collapses the whitespace a multi-line real fixture leaves behind', () => {
    expect(stripTags('  <p>a</p>\n\n  <p>b</p>  ')).toBe('a b');
  });
});

describe('selectText', () => {
  it('reads the real <h1> title off the saved Skupština session page', () => {
    expect(selectText(sjednicaHtml, /<h1>([^<]+)<\/h1>/)).toBe('Poziv na 13. sjednicu Gradske skupštine Grada Zagreba');
  });

  it('returns null when the pattern does not match', () => {
    expect(selectText(sjednicaHtml, /<h2>([^<]+)<\/h2>/)).toBeNull();
  });

  it('falls back to the whole match when the pattern has no capture group', () => {
    expect(selectText('<b>Zagreb</b>', /Zagreb/)).toBe('Zagreb');
  });

  it('is not left in a stateful lastIndex from a previous call on a global pattern', () => {
    const pattern = /<h4 class='pt-20'>([^<]*)<\/h4>/g;
    expect(selectText(kvartovskeHtml, pattern)).toBe('Hop-in kino na Jarunu');
    // Calling again with the *same* regex object must still find the first match,
    // proving selectText never depends on (or mutates) the caller's regex state.
    expect(selectText(kvartovskeHtml, pattern)).toBe('Hop-in kino na Jarunu');
  });
});

describe('selectAll', () => {
  it('reads every catalogue title off the real Kvartovske novosti page', () => {
    const titles = selectAll(kvartovskeHtml, /<h4 class='pt-20'>([^<]*)<\/h4>/g);
    expect(titles.length).toBeGreaterThan(10);
    expect(titles.slice(0, 3)).toEqual(['Hop-in kino na Jarunu', 'Dani Remetinca', 'Dan Mjesnog odbora Horvati-Srednjaci - Druženje za sve generacije']);
  });

  it('reads only the two dated rows off the real rokovnik page, tolerating the rows with no date at all', () => {
    // The saved fixture proves this quirk: most <a class='news-result'> rows on
    // this page carry no <span><i class='news-date'> at all (see sources.json).
    const dates = selectAll(rokovnikHtml, /<i class='news-date'>([^<]*)<\/i>/g);
    expect(dates).toEqual(['14.09.2026.', '16.09.2026.']);
  });

  it('returns an empty array rather than null when nothing matches', () => {
    expect(selectAll(kvartovskeHtml, /<h5>([^<]*)<\/h5>/g)).toEqual([]);
  });

  it('accepts a pattern without a global flag and does not throw', () => {
    expect(selectAll(kvartovskeHtml, /<h4 class='pt-20'>([^<]*)<\/h4>/)).toEqual(
      selectAll(kvartovskeHtml, /<h4 class='pt-20'>([^<]*)<\/h4>/g),
    );
  });
});
