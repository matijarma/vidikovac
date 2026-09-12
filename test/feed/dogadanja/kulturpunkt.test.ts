import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FetchContext } from '../../../worker/feed/schema';
import { zagrebIso } from '../../../worker/feed/time';
import {
  KULTURPUNKT_URL,
  categoryFromClassList,
  fetchKulturpunkt,
} from '../../../worker/feed/modules/dogadanja/kulturpunkt';

// The exact instant test/fixtures/dogadanja/sources.json records for this
// fixture's fetch, so every "no year written" announcement below is dated
// against the same moment the research actually saw it live.
const FETCH_NOW = new Date('2026-09-12T00:44:38Z');

const fixture = readFileSync(new URL('../../fixtures/dogadanja/kulturpunkt.json', import.meta.url), 'utf8');

function makeContext(now: Date = FETCH_NOW): FetchContext {
  return {
    now: () => now,
    fetch: async (url) => {
      if (url !== KULTURPUNKT_URL) throw new Error(`unexpected url: ${url}`);
      return new Response(fixture);
    },
  };
}

function byId(items: { id: string }[], id: string) {
  const item = items.find((row) => row.id === id);
  if (!item) throw new Error(`item ${id} not found`);
  return item;
}

describe('fetchKulturpunkt', () => {
  it('requests only the fields the panel needs, from the real query url (R-L4)', () => {
    expect(KULTURPUNKT_URL).toBe(
      'https://kulturpunkt.hr/wp-json/wp/v2/kp_22_announcement?_fields=id,link,title,excerpt,class_list,date&per_page=40&orderby=date&order=desc',
    );
  });

  it('drops the one announcement with no readable date, keeping the other 39, and counts the drop', async () => {
    const result = await fetchKulturpunkt(makeContext());
    expect(result.items).toHaveLength(39);
    expect(result.droppedCount).toBe(1);
  });

  it('reads a day range with day precision at both ends ("od 22. do 29. rujna")', async () => {
    const result = await fetchKulturpunkt(makeContext());
    const item = byId(result.items, 'kulturpunkt:85612');
    expect(item).toMatchObject({
      title: 'Antisezona: Antiprostorna',
      link: 'https://kulturpunkt.hr/najava/izvedba/antisezona-antiprostorna/',
      at: zagrebIso(2026, 9, 22, 0, 0),
      until: zagrebIso(2026, 9, 29, 23, 59),
      data: { source: 'kulturpunkt', category: 'izvedba', precision: 'range' },
    });
  });

  it('reads a single day with an attached time window ("u petak, 11. rujna od 19 do 20.30 sati")', async () => {
    const result = await fetchKulturpunkt(makeContext());
    const item = byId(result.items, 'kulturpunkt:85608');
    expect(item).toMatchObject({
      at: zagrebIso(2026, 9, 11, 19, 0),
      until: zagrebIso(2026, 9, 11, 20, 30),
      data: { source: 'kulturpunkt', category: 'predavanje', precision: 'time' },
    });
  });

  it('reads a plain day with no time at all ("Nova sezona zagrebačke Kinoteke započinje 14. rujna")', async () => {
    const result = await fetchKulturpunkt(makeContext());
    const item = byId(result.items, 'kulturpunkt:85560');
    expect(item.until).toBeUndefined();
    expect(item).toMatchObject({
      at: zagrebIso(2026, 9, 14, 0, 0),
      data: { source: 'kulturpunkt', category: 'film', precision: 'day' },
    });
  });

  it('never lets excerpt prose survive into the item (R-P6)', async () => {
    const result = await fetchKulturpunkt(makeContext());
    const item = byId(result.items, 'kulturpunkt:85612');
    const serialized = JSON.stringify(item);
    // Real sentences from this item's excerpt.rendered (see the fixture) that
    // must never reach a produced item, only its parsed date and category.
    expect(serialized).not.toContain('Trideset i prvi programski blok');
    expect(serialized).not.toContain('suvremeni ples');
    expect(item).not.toHaveProperty('summary');
    expect(item).not.toHaveProperty('excerpt');
  });

  it('never states venue or organiser, since this API never provides them', async () => {
    const result = await fetchKulturpunkt(makeContext());
    for (const item of result.items) {
      expect(item.data).not.toHaveProperty('venue');
      expect(item.data).not.toHaveProperty('organiser');
    }
  });

  it('links every item back to the original announcement', async () => {
    const result = await fetchKulturpunkt(makeContext());
    for (const item of result.items) {
      expect(item.link.startsWith('https://kulturpunkt.hr/')).toBe(true);
    }
  });
});

describe('categoryFromClassList', () => {
  it('reads the single category tag off a real class_list', () => {
    expect(
      categoryFromClassList(['post-85565', 'kp_22_announcement', 'kp_22_announcement_cat-koncert']),
    ).toBe('koncert');
  });

  it('picks the first known category when an announcement carries two (real fixture shape, item 85486)', () => {
    expect(
      categoryFromClassList(['kp_22_announcement_cat-program', 'kp_22_announcement_cat-radionica']),
    ).toBe('program');
  });

  it('falls back to "ostalo" for a class_list with no recognised category tag', () => {
    expect(categoryFromClassList(['post-1', 'kp_22_announcement', 'status-publish'])).toBe('ostalo');
  });
});
