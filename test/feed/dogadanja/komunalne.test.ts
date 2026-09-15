import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FetchContext } from '../../../worker/feed/schema';
import { zagrebIso } from '../../../worker/feed/time';
import { KOMUNALNE_URL, fetchKomunalne } from '../../../worker/feed/modules/dogadanja/komunalne';

// The instant test/fixtures/dogadanja/sources.json records for this fetch.
const FETCH_NOW = new Date('2026-09-12T00:46:26Z');

const fixture = readFileSync(new URL('../../fixtures/dogadanja/komunalne-aktivnosti.json', import.meta.url), 'utf8');

function makeContext(now: Date = FETCH_NOW): FetchContext {
  return {
    now: () => now,
    fetch: async (url) => {
      if (url !== KOMUNALNE_URL) throw new Error(`unexpected url: ${url}`);
      return new Response(fixture);
    },
  };
}

function byId(items: { id: string }[], id: string) {
  const item = items.find((row) => row.id === id);
  if (!item) throw new Error(`item ${id} not found`);
  return item;
}

// Zagreb's own administrative area, generously bounded: real geo values across
// the whole 700-record fixture (once the axes are the right way round) fall
// inside lat 45.39-45.91, lon 15.43-16.61. Getting X/Y backwards would put
// every "lon" value around 45.7 (nowhere near this box's longitude range) and
// every "lat" value around 15.8 (nowhere near its latitude range), so this box
// only accepts coordinates that were swapped correctly.
const ZAGREB_BBOX = { minLat: 45.3, maxLat: 46.0, minLon: 15.3, maxLon: 16.7 };

describe('fetchKomunalne', () => {
  it('requests the real, pinned CKAN resource download url (already allowed by robots.txt, see sources.json)', () => {
    expect(KOMUNALNE_URL).toBe(
      'https://data.zagreb.hr/dataset/fddb4f87-c002-4e3c-b988-adf013997ecc/resource/f90738b6-8bfa-4dd9-9db7-b3c532d90c97/download/data.json',
    );
  });

  it('reads a full happy-path record: decoded title, day-precision date, phase, status, amount, and axis-swapped geo', async () => {
    const result = await fetchKomunalne(makeContext());
    const item = byId(result.items, 'komunalne:7525EA7F67309623C1258DCC0043728F');
    expect(item).toMatchObject({
      title: 'Horvati, ulica Širanovići, odvojak prema k.br. 34',
      summary: 'izrada projektne dokumentacije za gradnju 50 m vodoopskrbnog cjevovoda',
      at: zagrebIso(2026, 6, 1, 0, 0),
      dateBasis: 'updated',
      data: { source: 'komunalne', phase: 'Ugovaranje', status: 'Gotovo', amount: 1500, precision: 'day' },
    });
  });

  it('swaps X (latitude) and Y (longitude) and lands the coordinate inside Zagreb\'s bounding box, at 5 decimals', async () => {
    const result = await fetchKomunalne(makeContext());
    const item = byId(result.items, 'komunalne:7525EA7F67309623C1258DCC0043728F');
    // Raw fixture: X_Koordinata "45.719667" (latitude), Y_Koordinata "15.795676" (longitude).
    expect(item.geo).toEqual({ type: 'Point', coordinates: [15.79568, 45.71967] });
    const [lon, lat] = item.geo!.coordinates;
    expect(lat).toBeGreaterThanOrEqual(ZAGREB_BBOX.minLat);
    expect(lat).toBeLessThanOrEqual(ZAGREB_BBOX.maxLat);
    expect(lon).toBeGreaterThanOrEqual(ZAGREB_BBOX.minLon);
    expect(lon).toBeLessThanOrEqual(ZAGREB_BBOX.maxLon);
  });

  it('stamps data.district from the geo coordinates when it has one, and carries none when it has no geo at all', async () => {
    const result = await fetchKomunalne(makeContext());
    // districtOf([15.79568, 45.71967]) lands inside Brezovica's own polygon in the generated table.
    const withGeo = byId(result.items, 'komunalne:7525EA7F67309623C1258DCC0043728F');
    expect(withGeo.geo).toBeDefined();
    expect(withGeo.data.district).toBe('brezovica');
    const withoutGeo = byId(result.items, 'komunalne:A781461DDB0D1DD2C1258CF5003BBE09');
    expect(withoutGeo.geo).toBeUndefined();
    expect(withoutGeo.data).not.toHaveProperty('district');
  });

  it('decodes a numeric-entity date format ("17.2.2026.") and a different real phase/status pair', async () => {
    const result = await fetchKomunalne(makeContext());
    const item = byId(result.items, 'komunalne:6938D3974E327241C1258CF9002508C5');
    expect(item).toMatchObject({
      title: 'Hudi Bitek, Hudobička ulica III. odvojak od Brezovičke ceste',
      summary: 'Uređenje kolnika',
      at: zagrebIso(2026, 2, 17, 0, 0),
      data: { phase: 'Ugovaranje', status: 'Gotovo', amount: 127000, precision: 'day' },
    });
  });

  it('reads the "Izvođač uveden u posao" phase (double numeric-entity decode) with its own amount and date', async () => {
    const result = await fetchKomunalne(makeContext());
    const item = byId(result.items, 'komunalne:D488F5946401D3A9C1258D5C003AFC08');
    expect(item).toMatchObject({
      title: 'Odranski Obrež, Dragonožečka cesta (od ulice Prilaz Rožićima)',
      at: zagrebIso(2026, 7, 27, 0, 0),
      data: { phase: 'Izvođač uveden u posao', status: 'Gotovo', amount: 200000, precision: 'day' },
    });
  });

  it('normalises a comma decimal separator in the amount ("1502,5" -> 1502.5) and keeps the description verbatim, quotes included', async () => {
    const result = await fetchKomunalne(makeContext());
    const item = byId(result.items, 'komunalne:6096E838E217C33EC1258C0D004C27CB');
    expect(item.data.amount).toBe(1502.5);
    expect(item.summary).toBe('"izrada projektne dokumentacije za rješavanje oborinske odvodnje"');
    expect(item).toMatchObject({ at: zagrebIso(2025, 1, 12, 0, 0), data: { phase: 'Radovi u tijeku', status: 'U tijeku' } });
  });

  it('keeps a record with no coordinates at all, simply without a geo field, rather than dropping it', async () => {
    const result = await fetchKomunalne(makeContext());
    const item = byId(result.items, 'komunalne:A781461DDB0D1DD2C1258CF5003BBE09');
    expect(item.title).toBe('GČ Črnomerec');
    expect(item.geo).toBeUndefined();
    expect(item.data.amount).toBe(20500);
  });

  it('drops a record with no last-change date at all, never guessing one', async () => {
    const result = await fetchKomunalne(makeContext());
    expect(result.items.find((item) => item.id === 'komunalne:9DA1E43976E50C84C1258C0E00450394')).toBeUndefined();
  });

  it('drops exactly the 190 records with no last-change date, out of 700, and counts them', async () => {
    const result = await fetchKomunalne(makeContext());
    expect(result.items).toHaveLength(510);
    expect(result.droppedCount).toBe(190);
    expect(result.totalItems).toBe(510);
  });

  it('only emits string activity summaries, without treating last-change notices as events', async () => {
    const row = JSON.parse(fixture).find((entry: { ID: string }) => entry.ID === '7525EA7F67309623C1258DCC0043728F');
    const result = await fetchKomunalne({
      ...makeContext(),
      fetch: async () => new Response(JSON.stringify([
        { ...row, Aktivnost: { text: 'not a string' } },
        { ...row, ID: 'html', Aktivnost: '<p>Popravak &amp; obnova</p>' },
      ])),
    });
    expect(result.items.map((item) => item.summary)).toEqual(['', 'Popravak & obnova']);
    expect(result.items.every((item) => item.dateBasis === 'updated')).toBe(true);
  });

  it('only ever emits phase and status values from the closed vocabulary the real fixture defines', async () => {
    const result = await fetchKomunalne(makeContext());
    const knownPhases = ['U pripremi', 'Ugovaranje', 'Provedba javne nabave', 'Izvođač uveden u posao', 'Radovi u tijeku', 'Završeni radovi'];
    const knownStatuses = ['U tijeku', 'Zastoj', 'Gotovo'];
    for (const item of result.items) {
      expect(knownPhases).toContain(item.data.phase);
      expect(knownStatuses).toContain(item.data.status);
    }
  });

  it('never lets a raw HTML entity reach an item (title, summary, phase and status all pass through decodeEntities)', async () => {
    const result = await fetchKomunalne(makeContext());
    for (const item of result.items) {
      const serialized = JSON.stringify(item);
      expect(serialized).not.toMatch(/&#/);
      expect(serialized).not.toMatch(/&[a-zA-Z]+;/);
    }
  });

  it('tags every item with its own source, never venue/organiser/category/live (this source has none of those)', async () => {
    const result = await fetchKomunalne(makeContext());
    for (const item of result.items) {
      expect(item.data.source).toBe('komunalne');
      expect(item.data).not.toHaveProperty('venue');
      expect(item.data).not.toHaveProperty('organiser');
      expect(item.data).not.toHaveProperty('category');
      expect(item.data).not.toHaveProperty('live');
    }
  });
});
