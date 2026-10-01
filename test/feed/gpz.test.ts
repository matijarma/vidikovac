// worker/feed/modules/prekidi/gpz.ts against the pages of Gradska plinara Zagreb saved on 1 Oct 2026
// (test/fixtures/README-r3.md): the news list, a notice with one <strong> per street (1576), an index of stages (1577)
// and a stage whose zone is one line of several streets (1579), each with the server's CRLF line endings.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FetchContext } from '../../worker/feed/schema';
import { GPZ_URL, fetchGpz, parseGpzList, parseGpzNotice, splitZone } from '../../worker/feed/modules/prekidi/gpz';
import type { CutsResult } from '../../worker/feed/modules/prekidi/common';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const LIST = fixture('gpz-novosti.html');
const N1576 = fixture('gpz-obavijest-1576.html');
const N1577 = fixture('gpz-obavijest-1577.html');
const N1579 = fixture('gpz-obavijest-1579.html');

const cuts = (result: ReturnType<typeof parseGpzNotice>): CutsResult => {
  if ('children' in result) throw new Error('expected a notice with cuts');
  return result;
};

describe('the GPZ list', () => {
  it('keeps the CRLF line endings of the server', () => {
    for (const page of [LIST, N1576, N1577, N1579]) expect(page).toContain('\r\n');
  });

  it('gives the five notices of the page with their dates', () => {
    const entries = parseGpzList(LIST);
    expect(entries.map((entry) => [entry.href.split('/').pop(), `${entry.published.day}.${entry.published.month}.`])).toEqual([
      ['1576', '26.8.'], ['1575', '4.8.'], ['1570', '23.7.'], ['1577', '17.7.'], ['1567', '17.7.'],
    ]);
    expect(entries[0]!.url).toBe('https://www.plinara-zagreb.hr/ostalo/novosti/obavijst-obustava-ntp-kajfesov-brijeg/1576');
    expect(entries[0]!.title).toBe('OBAVIJST- Obustava NTP KAJFEŠOV BRIJEG');
  });

  it('throws on a page without the list', () => {
    expect(() => parseGpzList('<html><body>Održavanje</body></html>')).toThrow(/article-list/);
  });
});

describe('a GPZ notice', () => {
  it('gives the streets of 1576 as whole-day gas cuts, with the house numbers as written', () => {
    const result = cuts(parseGpzNotice(N1576, new Date('2026-08-30T10:00:00Z'), 'https://example.test/1576'));
    // All three streets are in the street index ("Ulica grada Gualda Tadina", "Dunjevac", "Kajfešov brijeg").
    expect(result.total).toBe(3);
    expect(result.items.map((item) => [item.id, item.title, item.data?.houseNumbers])).toEqual([
      ['prekidi:gpz:2026-08-31:ulica-grada-gualdo-tadino', 'Ulica grada Gualda Tadina', '4,8,8/1,8/2,8/3,10,11,12,12DV,14,16,18,20,22,24,26,28'],
      ['prekidi:gpz:2026-08-31:ulica-dunjevac', 'Dunjevac', '17'],
      ['prekidi:gpz:2026-08-31:kajfesov-brijeg', 'Kajfešov brijeg', '2,4,6,8,10,12,14,16,18,18/1,18/2,18/3,18/4,18/5'],
    ]);
    for (const item of result.items) {
      expect(item).toMatchObject({ kind: 'cut', at: '2026-08-30T22:00:00.000Z', until: '2026-08-31T22:00:00.000Z', dateBasis: 'event', link: 'https://example.test/1576' });
      expect(item.data).toMatchObject({ utility: 'plin', source: 'gpz', precision: 'day', district: 'crnomerec' });
    }
  });

  it('splits the one-line zone of 1579 into Selska and Zagorska; the index places Zagorska only', () => {
    expect(splitZone('<strong>SELSKA &nbsp;32, 34, 43, 44, 45, 46, 47, 49, 50, 52, 52/1 ZAGORSKA 18</strong>')).toEqual([
      { street: 'SELSKA', houseNumbers: '32, 34, 43, 44, 45, 46, 47, 49, 50, 52, 52/1' },
      { street: 'ZAGORSKA', houseNumbers: '18' },
    ]);
    const result = cuts(parseGpzNotice(N1579, new Date('2026-07-29T10:00:00Z')));
    // "Selska" alone is not a street of the index (it holds "Selska cesta"): counted, not placed, never guessed.
    expect(result.total).toBe(2);
    expect(result.items.map((item) => [item.id, item.title, item.data?.houseNumbers])).toEqual([
      ['prekidi:gpz:2026-07-30:zagorska', 'Zagorska ulica', '18'],
    ]);
  });

  it('reads an index of stages as its two children', () => {
    const result = parseGpzNotice(N1577, new Date('2026-07-29T10:00:00Z'));
    expect('children' in result && result.children.map((entry) => entry.href.split('/').pop())).toEqual(['1579', '1578']);
  });

  it('keeps today and the two days after it, nothing later or earlier', () => {
    expect(cuts(parseGpzNotice(N1576, new Date('2026-08-28T10:00:00Z'))).items).toEqual([]);
    expect(cuts(parseGpzNotice(N1576, new Date('2026-08-29T10:00:00Z'))).items).toHaveLength(3);
    expect(cuts(parseGpzNotice(N1576, new Date('2026-09-01T10:00:00Z'))).items).toEqual([]);
  });

  it('reads hours when a notice gives them, and a range of days', () => {
    const timed = N1576.replace('biti &nbsp;obustavljena', 'od 8 do 14 sati biti &nbsp;obustavljena');
    const result = cuts(parseGpzNotice(timed, new Date('2026-08-30T10:00:00Z')));
    expect(result.items[0]).toMatchObject({ at: '2026-08-31T06:00:00.000Z', until: '2026-08-31T12:00:00.000Z', data: { precision: 'time' } });
    const range = N1576.replace('dana <strong>31.8.2026</strong>.', 'od 30.8. do 31.8.2026.');
    expect(cuts(parseGpzNotice(range, new Date('2026-08-30T10:00:00Z'))).items.map((item) => item.id.split(':')[2])).toEqual(['2026-08-30', '2026-08-30', '2026-08-30', '2026-08-31', '2026-08-31', '2026-08-31']);
  });
});

describe('fetchGpz', () => {
  it('follows the recent notices and one level of children, within ten requests', async () => {
    const asked: string[] = [];
    const ctx: FetchContext = {
      now: () => new Date('2026-07-29T10:00:00Z'),
      fetch: async (url) => {
        asked.push(url);
        if (url === GPZ_URL) return new Response(LIST);
        if (url.endsWith('/1576')) return new Response(N1576);
        if (url.endsWith('/1577')) return new Response(N1577);
        if (url.endsWith('/1579')) return new Response(N1579);
        return new Response('<div class="user-content">Obavijest bez zone.<div class="clearfix"></div></div>');
      },
    };
    const result = await fetchGpz(ctx);
    expect(asked.length).toBeLessThanOrEqual(10);
    expect(asked.filter((url) => /\/(1578|1579)$/.test(url))).toHaveLength(2);
    expect(result.items.map((item) => item.id)).toEqual(['prekidi:gpz:2026-07-30:zagorska']);
    expect(result.total).toBe(2);
  });
});
