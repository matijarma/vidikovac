// worker/feed/modules/programi against the saved pages 1 and 2 of the programme of Knjižnice grada Zagreba (U3, M6):
// test/fixtures/kgz-dogadjanja-p1.html and -p2.html, saved on 29 Sep 2026 with the server's CRLF line endings and
// its tabs. Twenty listings a page; the ones a person can go to at an hour are the events.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATA_KEYS } from '../../worker/feed/schema';
import { fetchProgrami, mergePages } from '../../worker/feed/modules/programi';
import { KGZ_URL, kgzPageUrl, parseKgzPage, startTime } from '../../worker/feed/modules/programi/kgz';
import { DOGADANJA_SOURCE_CAP } from '../../worker/feed/modules/dogadanja';
import { U3_FIXTURE_NOW } from './fixture-contexts';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const PAGE_1 = fixture('kgz-dogadjanja-p1.html');
const PAGE_2 = fixture('kgz-dogadjanja-p2.html');
const NOW = U3_FIXTURE_NOW;

/** One listing as the site writes it, for the cases the saved pages do not hold. */
function listing(over: { date?: string; when?: string | null; id?: number; title?: string; branch?: string } = {}): string {
  const { date = '30.09.2026.', when = 'srijeda, 30. 9. 2026. u 18 sati', id = 90001, title = 'Nešto', branch = 'Knjižnica Testna' } = over;
  return `<div class='dogadanje_holder'>\t<div class='dog_txt_hold'>\t\t<div class='date_dog'>${date}</div>\t\t<div class='kat_dog'>Radionica</div>\t\t<span class='dogExtraInfo imeknjiznice_kat'><a class='btnplavi' href='https://www.kgz.hr/hr/knjiznice/testna/1'>${branch}</a></span>     ${when === null ? '' : `<div class='kat_dog'>Početak događanja: ${when}</div>`}\t\t<div class='clear'></div>\t\t<a class='naslov_god' href='https://www.kgz.hr/hr/dogadjanja/nesto/${id}'>${title}</a>\t\t<div class='detalji_dog'>OPIS-NE-SMIJE-PROCI</div>\t</div>\t<div class='clear'></div></div>`;
}
const page = (...listings: string[]) => `<html><body><div class='dogadanje_holder2'>Rezultata: 286</div><div class='clear'></div>${listings.join('')}</body></html>`;

describe('programi on the saved pages', () => {
  it('keeps the listings of one day with one start time and counts the others out', () => {
    const one = parseKgzPage(PAGE_1, NOW);
    const two = parseKgzPage(PAGE_2, NOW);
    expect([one.listings, two.listings]).toEqual([20, 20]);
    expect([one.results, two.results]).toEqual([286, 286]);
    // Page 1: 11 events; 5 listings run over several days, 4 repeat every week or fortnight.
    expect(one.items).toHaveLength(11);
    expect(one.dropped).toEqual({ multiDay: 5, recurring: 4, noTime: 0 });
    // Page 2: 10 events; 9 multi-day (an exhibition, a season of workshops), 1 weekly.
    expect(two.items).toHaveLength(10);
    expect(two.dropped).toEqual({ multiDay: 9, recurring: 1, noTime: 0 });
    expect(one.items.length + one.dropped.multiDay + one.dropped.recurring + one.dropped.noTime).toBe(20);
    expect(two.items.length + two.dropped.multiDay + two.dropped.recurring + two.dropped.noTime).toBe(20);
  });

  it('reads the free-text start time in every form the pages use, in Zagreb time', () => {
    const items = [...parseKgzPage(PAGE_1, NOW).items, ...parseKgzPage(PAGE_2, NOW).items];
    const at = (id: number) => items.find((item) => item.id.startsWith(`programi:kgz:${id}:`))!.at;
    expect(at(74738)).toBe('2026-09-29T16:00:00.000Z'); // "utorak, 29. 9. 2026. u 18 sati"
    expect(at(74633)).toBe('2026-09-29T08:30:00.000Z'); // "10:30 sati"
    expect(at(74842)).toBe('2026-09-29T16:00:00.000Z'); // "18:00"
    expect(at(72700)).toBe('2026-09-30T09:30:00.000Z'); // "11.30"
    expect(at(74724)).toBe('2026-09-30T08:00:00.000Z'); // "10 sati"
    expect(at(74839)).toBe('2026-10-01T16:00:00.000Z'); // "18.00"
    expect(at(71975)).toBe('2026-10-05T13:15:00.000Z'); // "15:15"
  });

  it('gives each event its branch, its listing page and no coordinate, description or end', () => {
    const { items } = parseKgzPage(PAGE_1, NOW);
    const first = items.find((item) => item.id === 'programi:kgz:74738:2026-09-29')!;
    expect(first).toEqual({
      id: 'programi:kgz:74738:2026-09-29',
      kind: 'event',
      title: 'Egli Ilić: Mačji kodeks uspjeha',
      at: '2026-09-29T16:00:00.000Z',
      dateBasis: 'event',
      link: 'https://www.kgz.hr/hr/dogadjanja/egli-ilic-macji-kodeks-uspjeha/74738',
      data: { source: 'kgz', venue: 'Knjižnica Ivana Gorana Kovačića', category: 'program', precision: 'time' },
    });
    for (const item of [...items, ...parseKgzPage(PAGE_2, NOW).items]) {
      expect(item.geo).toBeUndefined();
      expect(item.until).toBeUndefined();
      expect(item.summary).toBeUndefined();
      for (const key of Object.keys(item.data!)) expect(DATA_KEYS.event, key).toContain(key);
    }
    // The description of that listing ("Nadahnuta ponašanjem svojega mačka Maua...") is on the page and nowhere in the items.
    expect(PAGE_1).toContain('Nadahnuta ponašanjem');
    expect(JSON.stringify(items)).not.toContain('Nadahnuta');
  });

  it('reads the same page whatever its line endings', () => {
    expect(PAGE_1).toContain('\r\n');
    expect(parseKgzPage(PAGE_1.replace(/\r\n/g, '\n'), NOW)).toEqual(parseKgzPage(PAGE_1, NOW));
  });

  it('asks for pages 1 and 2 of the listing and nothing else, and returns 21 events sorted like every dogadanja source', async () => {
    const requested: string[] = [];
    const payload = await fetchProgrami({
      now: () => NOW,
      fetch: async (url) => {
        requested.push(url);
        return new Response(url === kgzPageUrl(1) ? PAGE_1 : PAGE_2);
      },
    });
    expect(requested.sort()).toEqual(['https://www.kgz.hr/hr/dogadjanja/10?page=1', 'https://www.kgz.hr/hr/dogadjanja/10?page=2']);
    expect(KGZ_URL).toBe('https://www.kgz.hr/hr/dogadjanja/10');
    expect(payload.items).toHaveLength(21);
    // Not over yet, soonest first; what began before 17:45 comes last.
    const ids = payload.items.map((item) => item.id);
    expect(ids[0]).toBe('programi:kgz:74738:2026-09-29');
    expect(ids.slice(-2)).toEqual(['programi:kgz:74912:2026-09-29', 'programi:kgz:74633:2026-09-29']);
    // Only the first two of 15 pages are read: the coverage says so, and how many listings the site holds.
    expect(payload.coverage).toEqual({ shown: 21, total: 286, limited: true });
  });
});

describe('the start time of a listing', () => {
  it.each([
    ['utorak, 29. 9. 2026. u 18 sati', [18, 0]],
    ['20 sati', [20, 0]],
    ['10:30 sati', [10, 30]],
    ['11.30', [11, 30]],
    ['18:00', [18, 0]],
    ['17:00 sati', [17, 0]],
    ['petak, 2. 10. 2026. u 9.15 sati', [9, 15]],
    // A floor is no time: "2. kat" is the second storey.
    ['utorak, 29. 9. 2026. u 18 sati, 2. kat', [18, 0]],
    ['u 11 sati, dvorana na 1. katu', [11, 0]],
    ['3. etaža, 10:30', [10, 30]],
  ] as const)('%s is one time', (text, expected) => {
    expect(startTime(text)).toEqual(expected);
  });

  it.each(['', 'sutra', 'od 17 do 18 sati', 'u 18 i u 20 sati', '25 sati', '18:75', 'utorak, 29. 9. 2026.', 'utorak, 29. 9. 2026., 2. kat', '1. katu'])('%j is no single start time', (text) => {
    expect(startTime(text)).toBeNull();
  });
});

describe('listings that are not an hour to go to', () => {
  it('drops a weekly or fortnightly programme, a listing over several days and one without a time, and counts each', () => {
    const result = parseKgzPage(page(
      listing({ id: 1, when: 'utorkom u 18:00' }),
      listing({ id: 2, when: 'srijedom od 17 do 18:30' }),
      listing({ id: 3, when: 'svakog drugog četvrtka od 18 do 19:30' }),
      listing({ id: 4, date: '30.09.2026. - 02.10.2026.', when: '20 sati' }),
      listing({ id: 5, when: null }),
      listing({ id: 6, when: 'od 17 do 18 sati' }),
      listing({ id: 7, when: 'srijeda, 30. 9. 2026. u 19 sati', title: 'Ostaje' }),
    ), NOW);
    expect(result.dropped).toEqual({ multiDay: 1, recurring: 3, noTime: 2 });
    expect(result.items.map((item) => item.title)).toEqual(['Ostaje']);
    expect(JSON.stringify(result)).not.toContain('OPIS-NE-SMIJE-PROCI');
  });

  it('refuses a date that is not on the calendar', () => {
    const result = parseKgzPage(page(listing({ date: '31.09.2026.', when: '18 sati' })), NOW);
    expect(result.items).toEqual([]);
    expect(result.dropped.noTime).toBe(1);
  });
});

describe('a page of another shape', () => {
  it('is refused, and a programme page with no listings is a list without events', () => {
    expect(() => parseKgzPage('<html><body>Stranica nije pronađena</body></html>', NOW)).toThrow(/not a programme page/);
    expect(() => parseKgzPage(`<div class='dogadanje_holder'>bez datuma</div>`, NOW)).toThrow(/without a date or a title/);
    const empty = parseKgzPage(`<div class='dogadanje_holder2'>Rezultata: 0</div>`, NOW);
    expect(empty).toMatchObject({ items: [], listings: 0, results: 0 });
  });

  it('is a failure of the whole read, so the last good copy serves', async () => {
    await expect(fetchProgrami({
      now: () => NOW,
      fetch: async (url) => new Response(url === kgzPageUrl(1) ? PAGE_1 : '<html>nova stranica</html>'),
    })).rejects.toThrow(/not a programme page/);
  });
});

describe('the merged pages', () => {
  it('keep a listing once, cap at the source cap and say the read is limited', () => {
    const many = Array.from({ length: 60 }, (_, n) => listing({ id: 100 + n, date: '01.10.2026.', when: `01.10.2026. u ${8 + (n % 12)} sati`, title: `Događaj ${n}` }));
    const one = parseKgzPage(page(...many.slice(0, 30)), NOW);
    const two = parseKgzPage(page(...many.slice(20)), NOW);
    const merged = mergePages([one, two], NOW);
    expect(merged.items).toHaveLength(DOGADANJA_SOURCE_CAP);
    expect(DOGADANJA_SOURCE_CAP).toBe(40);
    expect(new Set(merged.items.map((item) => item.id)).size).toBe(40);
    expect(merged.coverage).toEqual({ shown: 40, total: 286, limited: true });
    // The same listing on both pages (the pages shift as the day goes) counts once.
    expect(mergePages([one, one], NOW).items).toHaveLength(30);
  });
});
