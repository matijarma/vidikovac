import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FetchContext } from '../../../worker/feed/schema';
import {
  ETNOGRAFSKI_DOGADJANJA_URL,
  ETNOGRAFSKI_IZLOZBE_URL,
  fetchEtnografski,
} from '../../../worker/feed/modules/dogadanja/etnografski';

// The instant test/fixtures/dogadanja/sources.json records for these two
// fetches (dogadjanja 00:46:49Z, izlozbe 00:46:50Z) -- one second apart, both
// well after every event boundary this fixture actually turns on, so one
// shared `now` dates both exactly as the research actually saw them live.
const FETCH_NOW = new Date('2026-09-12T00:46:49Z');

const dogadjanja = readFileSync(new URL('../../fixtures/dogadanja/etnografski-dogadjanja.json', import.meta.url), 'utf8');
const izlozbe = readFileSync(new URL('../../fixtures/dogadanja/etnografski-izlozbe.json', import.meta.url), 'utf8');

function makeContext(overrides: Record<string, () => Response> = {}, now: Date = FETCH_NOW): FetchContext {
  return {
    now: () => now,
    fetch: async (url) => {
      if (overrides[url]) return overrides[url]();
      if (url === ETNOGRAFSKI_DOGADJANJA_URL) return new Response(dogadjanja);
      if (url === ETNOGRAFSKI_IZLOZBE_URL) return new Response(izlozbe);
      throw new Error(`unexpected url: ${url}`);
    },
  };
}

function byId<T extends { id: string }>(items: T[], id: string): T {
  const item = items.find((row) => row.id === id);
  if (!item) throw new Error(`item ${id} not found`);
  return item;
}

describe('fetchEtnografski', () => {
  it('requests the real, saved wp-json urls for both custom post types (robots.txt disallows only /wp-admin/, see sources.json)', () => {
    expect(ETNOGRAFSKI_DOGADJANJA_URL).toBe(
      'https://emz.hr/wp-json/wp/v2/dogadjanja?_fields=id,link,title,type,meta,class_list,date&per_page=20&orderby=date&order=desc',
    );
    expect(ETNOGRAFSKI_IZLOZBE_URL).toBe(
      'https://emz.hr/wp-json/wp/v2/izlozbe?_fields=id,link,title,type,meta,class_list,date&per_page=20&orderby=date&order=desc',
    );
  });

  it('reads webmz_event_date_start/end directly as the item instants, never through parseHrDate', async () => {
    const result = await fetchEtnografski(makeContext());
    // The one dogadjanja item still current at FETCH_NOW (id 22598): a
    // "ciklus" of workshops running 2026-09-10T16:00Z to 2026-10-08T17:30Z,
    // both Unix-second meta fields read straight to an ISO instant.
    const item = byId(result.items, 'etnografski:22598');
    expect(item).toMatchObject({
      title: 'Ciklus „wellbeing” radionica uz izložbu „Joso Bužan: iz fundusa Nacionalnog muzeja moderne umjetnosti i Etnografskog muzeja”',
      link: 'https://emz.hr/dogadjanja/ciklus-wellbeing-radionica-uz-izlozbu-joso-buzan-iz-fundusa-nacionalnog-muzeja-moderne-umjetnosti-i-etnografskog-muzeja/',
      at: '2026-09-10T16:00:00.000Z',
      until: '2026-10-08T17:30:00.000Z',
      data: { source: 'etnografski', category: 'dogadjanje', venue: 'Etnografski muzej, Zagreb', precision: 'time' },
    });
  });

  it('excludes an exhibition whose end date is already in the past at FETCH_NOW (the case the brief names explicitly)', async () => {
    const result = await fetchEtnografski(makeContext());
    // Real izlozbe fixture rows: id 22339 ends 2026-08-16T16:00Z, id 22334 the
    // same -- both before FETCH_NOW (2026-09-12) -- sources.json's own note.
    expect(result.items.find((item) => item.id === 'etnografski:22339')).toBeUndefined();
    expect(result.items.find((item) => item.id === 'etnografski:22334')).toBeUndefined();
  });

  it('keeps an exhibition still running (or not yet ended) at FETCH_NOW, decoding numeric HTML entities in its title', async () => {
    const result = await fetchEtnografski(makeContext());
    // Real fixture: id 13469, title carries literal &#8220;/&#8221; entities,
    // ends 2028-03-26 -- long after FETCH_NOW.
    const item = byId(result.items, 'etnografski:13469');
    expect(item.title).toBe('Izložba “Z/zemlja”');
    expect(item.data).toMatchObject({ source: 'etnografski', category: 'izlozba' });
    expect(JSON.stringify(item)).not.toMatch(/&#/);
  });

  it('reads exactly the real split of current vs. past items across both fixtures (20 dogadjanja, 1 current; 20 izlozbe, 5 current)', async () => {
    const result = await fetchEtnografski(makeContext());
    expect(result.items).toHaveLength(6);
    expect(result.droppedCount).toBe(34);
    const dogadjanjaItems = result.items.filter((item) => item.data.category === 'dogadjanje');
    const izlozbeItems = result.items.filter((item) => item.data.category === 'izlozba');
    expect(dogadjanjaItems).toHaveLength(1);
    expect(izlozbeItems).toHaveLength(5);
  });

  it('keeps every surviving izlozba item, matched by id, exactly the five still current at FETCH_NOW', async () => {
    const result = await fetchEtnografski(makeContext());
    const ids = result.items.filter((item) => item.data.category === 'izlozba').map((item) => item.id).sort();
    expect(ids).toEqual(
      ['etnografski:13469', 'etnografski:22324', 'etnografski:22384', 'etnografski:22500', 'etnografski:22573'].sort(),
    );
  });

  it('carries the venue from webmz_event_place, including a real non-museum venue for a touring exhibition', async () => {
    const result = await fetchEtnografski(makeContext());
    const item = byId(result.items, 'etnografski:22384');
    expect(item.data.venue).toBe('Lođa, Javna ustanova u kulturi Hvar / 1612 Trg sv. Stjepana 6, Hvar');
  });

  it('never states an organiser or a live flag, since this API provides neither', async () => {
    const result = await fetchEtnografski(makeContext());
    for (const item of result.items) {
      expect(item.data).not.toHaveProperty('organiser');
      expect(item.data).not.toHaveProperty('live');
      expect(item).not.toHaveProperty('summary');
    }
  });

  it('keeps one post type when the other endpoint fails, counting nothing extra for the failed one', async () => {
    const result = await fetchEtnografski(
      makeContext({ [ETNOGRAFSKI_IZLOZBE_URL]: () => { throw new Error('upstream 503'); } }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('etnografski:22598');
    expect(result.sources['etnografski-dogadjanja']).toMatchObject({ status: 'live', itemCount: 1 });
    expect(result.sources['etnografski-izlozbe']).toMatchObject({ status: 'down', itemCount: 0 });
  });

  it('throws when both endpoints fail, so the cache layer can fall back', async () => {
    await expect(
      fetchEtnografski(
        makeContext({
          [ETNOGRAFSKI_DOGADJANJA_URL]: () => { throw new Error('upstream 503'); },
          [ETNOGRAFSKI_IZLOZBE_URL]: () => { throw new Error('upstream 503'); },
        }),
      ),
    ).rejects.toThrow(/etnografski/);
  });

  it('drops a row with no readable start/end meta, counting it, never guessing an instant', async () => {
    const malformed = JSON.stringify([
      {
        id: 99999,
        link: 'https://emz.hr/dogadjanja/bez-datuma/',
        title: { rendered: 'Bez datuma' },
        type: 'dogadjanja',
        meta: { webmz_event_place: 'Etnografski muzej, Zagreb' },
        class_list: [],
      },
    ]);
    const result = await fetchEtnografski(
      makeContext({
        [ETNOGRAFSKI_DOGADJANJA_URL]: () => new Response(malformed),
        [ETNOGRAFSKI_IZLOZBE_URL]: () => new Response('[]'),
      }),
    );
    expect(result.items).toHaveLength(0);
    expect(result.droppedCount).toBe(1);
    expect(result.sources['etnografski-izlozbe']).toMatchObject({ status: 'live', itemCount: 0, totalItems: 0 });
  });

  it('does not claim a complete count when a full page has no overall total', async () => {
    const result = await fetchEtnografski(makeContext());
    expect(result.sources['etnografski-dogadjanja'].totalItems).toBeUndefined();
    expect(result.sources['etnografski-izlozbe'].totalItems).toBeUndefined();
    const complete = await fetchEtnografski(makeContext({
      [ETNOGRAFSKI_DOGADJANJA_URL]: () => new Response(dogadjanja, { headers: { 'x-wp-total': '20' } }),
      [ETNOGRAFSKI_IZLOZBE_URL]: () => new Response(izlozbe, { headers: { 'x-wp-total': '20' } }),
    }));
    expect(complete.sources['etnografski-dogadjanja'].totalItems).toBe(1);
    expect(complete.sources['etnografski-izlozbe'].totalItems).toBe(5);
  });
});
