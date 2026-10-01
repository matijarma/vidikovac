// worker/feed/modules/prekidi against the saved pages of HEP ODS and VIO (U3, M4): the outages of 29 and 30
// September 2026 (test/fixtures/hep-ods-bez-struje-{today,tomorrow}.html) and the notices of VIO
// (test/fixtures/vio-obavijesti.html), saved with the servers' own CRLF line endings.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../worker/env';
import type { FetchContext } from '../../worker/feed/schema';
import { getModules } from '../../worker/feed/cache';
import { DATA_KEYS } from '../../worker/feed/schema';
import { fetchPrekidi } from '../../worker/feed/modules/prekidi';
import { HEP_URL, hepUrl, parseHep, splitStreets } from '../../worker/feed/modules/prekidi/hep';
import { VIO_URL, noticeStreets, parseVio } from '../../worker/feed/modules/prekidi/vio';
import { GPZ_URL } from '../../worker/feed/modules/prekidi/gpz';
import { U3_FIXTURE_NOW } from './fixture-contexts';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const TODAY_PAGE = fixture('hep-ods-bez-struje-today.html');
const TOMORROW_PAGE = fixture('hep-ods-bez-struje-tomorrow.html');
const VIO_PAGE = fixture('vio-obavijesti.html');
const NOW = U3_FIXTURE_NOW;
const TODAY = { year: 2026, month: 9, day: 29 };
const TOMORROW = { year: 2026, month: 9, day: 30 };

function context(pages: Record<string, string | Error>): FetchContext {
  return {
    now: () => NOW,
    fetch: async (url) => {
      const page = Object.entries(pages).find(([needle]) => url.includes(needle))?.[1];
      if (page === undefined) throw new Error(`no fixture for ${url}`);
      if (page instanceof Error) throw page;
      return new Response(page);
    },
  };
}
// GPZ's list of 1 Oct 2026 (R3): its newest notice is of 26 August, more than 30 days before NOW, so GPZ is live and names no cut.
const GPZ_LIST = fixture('gpz-novosti.html');
const PAGES = { 'datum=29.09.2026': TODAY_PAGE, 'datum=30.09.2026': TOMORROW_PAGE, 'vio.hr': VIO_PAGE, 'plinara-zagreb.hr/novosti/50': GPZ_LIST };

describe('the fixtures are the servers\' bodies', () => {
  it('keep their CRLF line endings, which the parsers must cope with', () => {
    for (const page of [TODAY_PAGE, TOMORROW_PAGE, VIO_PAGE]) expect(page).toContain('\r\n');
  });
});

describe('HEP ODS', () => {
  it('reads the four outages of 29 September and the six of 30 September with their streets', () => {
    expect(TODAY_PAGE.match(/Mjesto:/g)).toHaveLength(4);
    expect(TOMORROW_PAGE.match(/Mjesto:/g)).toHaveLength(6);
    const today = parseHep(TODAY_PAGE, TODAY);
    const tomorrow = parseHep(TOMORROW_PAGE, TOMORROW);
    // Every street the pages name is in the street index, on the day of the page.
    expect(today.total).toBe(11);
    expect(today.items).toHaveLength(11);
    expect(tomorrow.total).toBe(19);
    // "SAVSKA CESTA I. i II. ODVOJAK" and "VUKOVDOL" are not in the index: counted, not shown.
    expect(tomorrow.items).toHaveLength(17);
    expect(today.items.map((item) => item.title)).toEqual([
      'Gredice', 'Jarunska ulica', 'Ulica Jurja Neidhardta', 'Ulica Božidara Rašice', 'Ulica Marijana Haberlea',
      'Brestovečka ulica', 'Zagrebačka cesta', 'Kovinska ulica', 'Samoborska cesta', 'Aleja Seljačke bune', 'Sutinska vrela',
    ]);
    for (const item of [...today.items, ...tomorrow.items]) {
      expect(item.kind).toBe('cut');
      expect(item.dateBasis).toBe('event');
      expect(item.geo?.type).toBe('Point');
      expect(item.data).toMatchObject({ utility: 'struja', source: 'hep-ods', precision: 'time' });
      expect(item.data?.district, item.id).toBeTruthy();
      for (const key of Object.keys(item.data!)) expect(DATA_KEYS.cut, key).toContain(key);
    }
  });

  it('gives each street the hours and the house numbers of its own outage, in Zagreb time', () => {
    const { items } = parseHep(TODAY_PAGE, TODAY);
    const byStreet = (street: string) => items.find((item) => item.data?.street === street)!;
    // 08:00 to 16:00 in summer time is 06:00 to 14:00 UTC.
    expect(byStreet('JARUNSKA')).toMatchObject({
      id: 'prekidi:hep:2026-09-29:jarunska', at: '2026-09-29T06:00:00.000Z', until: '2026-09-29T14:00:00.000Z',
      link: 'https://www.hep.hr/ods/bez-struje/19?dp=zagreb&datum=29.09.2026',
    });
    expect(byStreet('JARUNSKA').data?.houseNumbers).toBe('6');
    // The second range of a street stays with it; the next upper-case word starts the next street.
    expect(byStreet('GREDICE').data?.houseNumbers).toBe('98-do kraja par, 135-do kraja nep');
    expect(byStreet('JURJA NEIDHARDTA').data?.houseNumbers).toBe('2-6 par, 5');
    expect(byStreet('KOVINSKA').data?.houseNumbers).toBe('30, 25/B');
    // 08:30 to 12:00 is Sesvete's; Zagrebačka cesta is that of Sesvete, not the one of Zagreb.
    const zagrebacka = byStreet('ZAGREBAČKA CESTA');
    expect(zagrebacka).toMatchObject({ at: '2026-09-29T06:30:00.000Z', until: '2026-09-29T10:00:00.000Z' });
    expect(zagrebacka.data?.district).toBe('sesvete');
    expect(zagrebacka.data?.houseNumbers).toBe('40-66 par, 66/A');
  });

  it('places a street of the other page by its own place, and drops what the index does not hold', () => {
    const { items } = parseHep(TOMORROW_PAGE, TOMORROW);
    const streets = items.map((item) => item.data?.street);
    expect(streets).toContain('SAVSKA CESTA');
    expect(streets).not.toContain('SAVSKA CESTA I. i II. ODVOJAK');
    expect(streets).not.toContain('VUKOVDOL');
    // The six streets of the first outage and the one of the fifth, both from 10:00, are the streets of Sesvete.
    const sesvete = items.filter((item) => item.at === '2026-09-30T08:00:00.000Z');
    expect(sesvete).toHaveLength(7);
    expect(sesvete.every((item) => item.data?.district === 'sesvete')).toBe(true);
  });

  it('reads the same page whatever its line endings', () => {
    const lf = TODAY_PAGE.replace(/\r\n/g, '\n');
    const cr = TODAY_PAGE.replace(/\r\n/g, '\r');
    expect(parseHep(lf, TODAY)).toEqual(parseHep(TODAY_PAGE, TODAY));
    expect(parseHep(cr, TODAY)).toEqual(parseHep(TODAY_PAGE, TODAY));
  });

  it('runs a range that ends before it starts past midnight, and keeps two outages of one street apart', () => {
    const page = TODAY_PAGE
      .replace('<div class="kada">08:00 - 16:00</div>', '<div class="kada">22:00 - 02:00</div>')
      .replace('KOVINSKA 30, 25/B, SAMOBORSKA CESTA 215-217 nep, 217/A', 'KOVINSKA 30, 25/B, JARUNSKA 8');
    const { items } = parseHep(page, TODAY);
    const night = items.find((item) => item.data?.street === 'GREDICE')!;
    expect(night.at).toBe('2026-09-29T20:00:00.000Z');
    expect(night.until).toBe('2026-09-30T00:00:00.000Z');
    // JARUNSKA stands in two outages of the day: both stay, under ids that do not change between reads.
    const jarunska = items.filter((item) => item.data?.street === 'JARUNSKA');
    expect(jarunska.map((item) => item.id)).toEqual(['prekidi:hep:2026-09-29:jarunska', 'prekidi:hep:2026-09-29:jarunska-2']);
  });

  it('keeps an outage without a clock range out of the items but in the count', () => {
    const page = TODAY_PAGE.replace('<div class="kada">08:00 - 16:00</div>', '<div class="kada">do daljnjeg</div>');
    const { items, total } = parseHep(page, TODAY);
    expect(total).toBe(11);
    expect(items).toHaveLength(6);
  });

  it('refuses a page that is not the day\'s outage list', () => {
    expect(() => parseHep(TODAY_PAGE, TOMORROW)).toThrow(/not the day/);
    expect(() => parseHep('<html><body>Održavanje</body></html>', TODAY)).toThrow(/no outage list/);
    const blind = TODAY_PAGE.replace(/<strong>Mjesto:<\/strong>/g, '').replace(/<strong>Ulica:<\/strong>/g, '');
    expect(() => parseHep(blind, TODAY)).toThrow(/without a place and a street/);
    // A day without outages is a list without blocks, not an error.
    const empty = TODAY_PAGE.slice(0, TODAY_PAGE.indexOf('<div class="mjesto tipR">'));
    expect(parseHep(empty, TODAY)).toEqual({ items: [], total: 0 });
  });

  it('splits a street line at the commas before an upper-case word only', () => {
    expect(splitStreets('GREDICE 98-do kraja par, 135-do kraja nep, JARUNSKA 6')).toEqual(['GREDICE 98-do kraja par, 135-do kraja nep', 'JARUNSKA 6']);
    expect(splitStreets('ŠILETIĆI, ŠILETIĆI I. 6-54 par, ĐURĐEVAČKA 2')).toEqual(['ŠILETIĆI', 'ŠILETIĆI I. 6-54 par', 'ĐURĐEVAČKA 2']);
    expect(hepUrl(TOMORROW)).toBe(`${HEP_URL}&datum=30.09.2026`);
  });
});

describe('VIO', () => {
  it('gives the three streets of Podsused and the street of Adamovec as whole-day cuts, and none for Jastrebarsko', () => {
    const { items, total } = parseVio(VIO_PAGE, NOW);
    expect(items.map((item) => item.id)).toEqual([
      'prekidi:vio:2026-09-29:aleja-seljacke-bune',
      'prekidi:vio:2026-09-29:jagodisce',
      'prekidi:vio:2026-09-29:meglenjak',
      'prekidi:vio:2026-09-30:vinskoj-cesti',
    ]);
    // The three notices name five streets; Draga Svetojanska lies in Jastrebarsko and is not counted.
    expect(total).toBe(4);
    expect(items.map((item) => item.title)).toEqual(['Aleja Seljačke bune', 'Jagodišče', 'Meglenjak', 'Vinska cesta']);
    for (const item of items) {
      expect(item.kind).toBe('cut');
      expect(item.data).toMatchObject({ utility: 'voda', source: 'vio', precision: 'day' });
      expect(item.data?.houseNumbers).toBeUndefined();
      for (const key of Object.keys(item.data!)) expect(DATA_KEYS.cut, key).toContain(key);
    }
    const [aleja] = items;
    // The whole Zagreb day: 00:00 to 24:00 local.
    expect(aleja).toMatchObject({ at: '2026-09-28T22:00:00.000Z', until: '2026-09-29T22:00:00.000Z', dateBasis: 'event' });
    expect(aleja!.data?.street).toBe('Aleja Seljačke bune');
    expect(aleja!.link).toBe('https://www.vio.hr/zona-za-medije/obavijesti/dana-29-rujna-2026-godine-zbog-planiranih-radova-hep-a-bez-vode-ce-biti-potrosaci-u-ulicama-aleja-seljacke-bune-jagodisce-i-meglenjak-u-podsusedu/2338');
    expect(items.some((item) => JSON.stringify(item).includes('Svetojanska'))).toBe(false);
  });

  it('reads only the notices of today and tomorrow', () => {
    const later = new Date('2026-10-05T10:00:00Z');
    expect(parseVio(VIO_PAGE, later)).toEqual({ items: [], total: 0 });
    // From the evening of the 28th, the 29th is tomorrow and the 30th is not yet in reach.
    const eve = parseVio(VIO_PAGE, new Date('2026-09-28T20:00:00Z'));
    expect(eve.items.map((item) => item.data?.street)).toEqual(['Aleja Seljačke bune', 'Jagodišće', 'Meglenjak']);
  });

  it('reads November in both genitives, "studenoga" and "studenog"', () => {
    const november = new Date('2026-11-03T08:00:00Z');
    for (const month of ['studenoga', 'studenog']) {
      const page = VIO_PAGE.replace(/Dana 29\. rujna 2026\. godine/g, `Dana 3. ${month} 2026. godine`);
      const { items } = parseVio(page, november);
      expect(items.map((item) => item.data?.street), month).toEqual(['Aleja Seljačke bune', 'Jagodišće', 'Meglenjak']);
      expect(items[0], month).toMatchObject({ id: 'prekidi:vio:2026-11-03:aleja-seljacke-bune', at: '2026-11-02T23:00:00.000Z', until: '2026-11-03T23:00:00.000Z' });
    }
  });

  it('splits a notice into streets and the place they stand in', () => {
    expect(noticeStreets('Aleja Seljačke bune, Jagodišće i Meglenjak u Podsusedu')).toEqual({
      streets: ['Aleja Seljačke bune', 'Jagodišće', 'Meglenjak'], settlement: 'Podsusedu', area: undefined,
    });
    expect(noticeStreets('Vinskoj cesti u Adamovcu')).toEqual({ streets: ['Vinskoj cesti'], settlement: 'Adamovcu', area: undefined });
    expect(noticeStreets('Draga Svetojanska na području Jastrebarskog')).toEqual({ streets: ['Draga Svetojanska'], settlement: undefined, area: 'Jastrebarskog' });
    expect(noticeStreets('Jarunskoj ulici 5')).toMatchObject({ streets: ['Jarunskoj ulici 5'] });
  });

  it('refuses a page without a notice list', () => {
    expect(() => parseVio('<html><body>Stranica nije pronađena</body></html>', NOW)).toThrow(/no notice list/);
    // A list none of whose notices is a day's notice is a list.
    const quiet = VIO_PAGE.replace(/Dana \d+\. \w+ 2026\. godine/g, 'Obavijest');
    expect(parseVio(quiet, NOW)).toEqual({ items: [], total: 0 });
  });
});

describe('fetchPrekidi', () => {
  it('merges both sources, in order of start, and says how much of the two lists it could place', async () => {
    const payload = await fetchPrekidi(context(PAGES));
    expect(payload.items).toHaveLength(32);
    expect(payload.items.filter((item) => item.data?.source === 'hep-ods')).toHaveLength(28);
    expect(payload.items.filter((item) => item.data?.source === 'vio')).toHaveLength(4);
    const starts = payload.items.map((item) => Date.parse(item.at!));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(new Set(payload.items.map((item) => item.id)).size).toBe(32);
    expect(payload.sources).toEqual({
      'hep-ods': { status: 'live', itemCount: 28, fetchedAt: NOW.toISOString(), totalItems: 30 },
      vio: { status: 'live', itemCount: 4, fetchedAt: NOW.toISOString(), totalItems: 4 },
      gpz: { status: 'live', itemCount: 0, fetchedAt: NOW.toISOString(), totalItems: 0 },
    });
    // Two streets of the lists could not be placed: the coverage says the shown is not the whole.
    expect(payload.coverage).toEqual({ shown: 32, total: 34, limited: true });
    expect(payload.sourceUpdatedAt).toBeUndefined();
  });

  it('asks HEP for the two Zagreb days, VIO and GPZ for their lists, and nothing else', async () => {
    const requested: string[] = [];
    await fetchPrekidi({
      now: () => NOW,
      fetch: async (url) => {
        requested.push(url);
        return new Response(url.includes('vio.hr') ? VIO_PAGE : url.includes('plinara') ? GPZ_LIST : url.includes('30.09') ? TOMORROW_PAGE : TODAY_PAGE);
      },
    });
    expect(requested.sort()).toEqual([
      'https://www.hep.hr/ods/bez-struje/19?dp=zagreb&datum=29.09.2026',
      'https://www.hep.hr/ods/bez-struje/19?dp=zagreb&datum=30.09.2026',
      VIO_URL,
      GPZ_URL,
    ].sort());
  });

  it('leaves the other source live when one fails', async () => {
    const vioDown = await fetchPrekidi(context({ ...PAGES, 'vio.hr': new Error('upstream 503') }));
    expect(vioDown.sources).toMatchObject({ 'hep-ods': { status: 'live', itemCount: 28 }, vio: { status: 'down', itemCount: 0 } });
    expect(vioDown.items).toHaveLength(28);
    const hepDown = await fetchPrekidi(context({ ...PAGES, 'datum=30.09.2026': new Error('upstream 500') }));
    expect(hepDown.sources).toMatchObject({ 'hep-ods': { status: 'down' }, vio: { status: 'live', itemCount: 4 } });
    expect(hepDown.items.every((item) => item.data?.source === 'vio')).toBe(true);
    // A page of another shape counts as a failure of its source, not as no cuts.
    const changed = await fetchPrekidi(context({ ...PAGES, 'vio.hr': '<html>nova stranica</html>' }));
    expect(changed.sources?.vio?.status).toBe('down');
  });

  it('leaves HEP and VIO live when GPZ rejects', async () => {
    const gpzDown = await fetchPrekidi(context({ ...PAGES, 'plinara-zagreb.hr/novosti/50': new Error('upstream 503') }));
    expect(gpzDown.sources).toMatchObject({ 'hep-ods': { status: 'live', itemCount: 28 }, vio: { status: 'live', itemCount: 4 }, gpz: { status: 'down', itemCount: 0 } });
    expect(gpzDown.items).toHaveLength(32);
  });

  it('throws when no source answers, so the last good copy serves', async () => {
    await expect(fetchPrekidi(context({ 'datum=29.09.2026': new Error('a'), 'datum=30.09.2026': new Error('b'), 'vio.hr': new Error('c'), 'plinara-zagreb.hr': new Error('d') }))).rejects.toThrow(/every source failed/);
  });
});

// Round 1 phone F1 (29 September 2026): VIO refused the Worker's requests while HEP answered, the cache layer served the
// module 'stale' for the one failed source, and the phone put "1 izvor ne odgovara." over its first viewport. M4: one
// failing source leaves the other live; the module is stale or down only when every source failed.
describe('prekidi as the feed serves it', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  /** The cache layer over empty Cache API and KV, the upstream pages from `pages` (an Error: that source fails). */
  async function served(pages: Record<string, string | Error>) {
    vi.stubGlobal('caches', { default: { match: async () => undefined, put: async () => undefined } });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      const page = Object.entries(pages).find(([needle]) => url.includes(needle))?.[1];
      if (page === undefined || page instanceof Error) return new Response('refused', { status: 503 });
      return new Response(page);
    });
    const env = { FEED: { get: async () => null, put: async () => undefined } } as unknown as Env;
    const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
    const [snapshot] = await getModules(env, ctx, ['prekidi'], { now: () => NOW, recordMetric: () => undefined });
    return snapshot!;
  }

  it('is live while HEP answers and VIO fails, VIO down in its sources and HEP\'s streets served', async () => {
    const snapshot = await served({ ...PAGES, 'vio.hr': new Error('refused') });
    expect(snapshot.status).toBe('live');
    expect(snapshot.staleSince).toBeUndefined();
    expect(snapshot.sources).toMatchObject({ 'hep-ods': { status: 'live', itemCount: 28 }, vio: { status: 'down', itemCount: 0 } });
    expect(snapshot.items).toHaveLength(28);
  });

  it('is live while VIO answers and HEP fails, and down when both fail with no last good copy', async () => {
    const hepDown = await served({ ...PAGES, 'datum=29.09.2026': new Error('a'), 'datum=30.09.2026': new Error('b') });
    expect(hepDown.status).toBe('live');
    expect(hepDown.sources).toMatchObject({ 'hep-ods': { status: 'down' }, vio: { status: 'live', itemCount: 4 } });
    const bothDown = await served({});
    expect(bothDown.status).toBe('down');
    expect(bothDown.items).toEqual([]);
  });
});
