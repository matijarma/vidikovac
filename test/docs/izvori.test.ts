import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import izvoriJson from '../../app/src/data/izvori.json';
import { KULTURPUNKT_URL } from '../../worker/feed/modules/dogadanja/kulturpunkt';
import { SKUPSTINA_ROKOVNIK_URL, SKUPSTINA_YOUTUBE_URL } from '../../worker/feed/modules/dogadanja/skupstina';
import { KVARTOVSKE_URL } from '../../worker/feed/modules/dogadanja/kvartovske';
import { KOMUNALNE_URL } from '../../worker/feed/modules/dogadanja/komunalne';
import { ZET_RSS_NOVOSTI_URL, ZET_RSS_PROMET_URL } from '../../worker/feed/modules/dogadanja/zet-rss';
import { ETNOGRAFSKI_DOGADJANJA_URL, ETNOGRAFSKI_IZLOZBE_URL } from '../../worker/feed/modules/dogadanja/etnografski';

// Task E9: every one of the dogadanja module's real per-source URLs (the
// `data.source` vocabulary the panels attribute by, worker/feed/modules/
// dogadanja/licence.ts) and its licence must appear, character for
// character, in docs/izvori.md, app/src/data/izvori.json and section 5 of
// docs/prijava/prijedlog-projekta.md -- the same three-way parity the plan
// already holds stage 1's nine modules to (test/app/izvori.test.ts). The
// URL constants are imported from the sub-fetchers themselves so this test
// can never drift from what the module actually requests.

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

interface DogadanjaSourceDoc {
  source: string;
  naziv: string;
  url: string;
  licence: string;
}

const CC_BY_SA = 'CC BY-SA 3.0 HR';
const OTVORENA = 'Otvorena dozvola';
const NO_LICENCE = 'Licenca nije navedena';

// One entry per real `data.source` value the merged module emits (licence.ts
// names five of these seven as its Otvorena dozvola set; Kulturpunkt is
// CC BY-SA 3.0 HR; Etnografski states no reuse licence at all and so never
// leaves the session tier either -- see licence.ts's own header).
const EXPECTED: DogadanjaSourceDoc[] = [
  { source: 'kulturpunkt', naziv: 'Kulturpunkt', url: KULTURPUNKT_URL, licence: CC_BY_SA },
  { source: 'skupstina', naziv: 'Skupština Grada Zagreba', url: SKUPSTINA_ROKOVNIK_URL, licence: OTVORENA },
  { source: 'kvartovske', naziv: 'Kvartovske novosti', url: KVARTOVSKE_URL, licence: OTVORENA },
  { source: 'komunalne', naziv: 'Plan komunalnih aktivnosti', url: KOMUNALNE_URL, licence: OTVORENA },
  { source: 'zet-novosti', naziv: 'ZET, obavijesti (opće)', url: ZET_RSS_NOVOSTI_URL, licence: OTVORENA },
  { source: 'zet-promet', naziv: 'ZET, obavijesti (promet)', url: ZET_RSS_PROMET_URL, licence: OTVORENA },
  { source: 'etnografski', naziv: 'Etnografski muzej', url: ETNOGRAFSKI_DOGADJANJA_URL, licence: NO_LICENCE },
];

describe('app/src/data/izvori.json carries a dogadanjaSources entry per data.source value', () => {
  const jsonSources = (izvoriJson as { dogadanjaSources?: DogadanjaSourceDoc[] }).dogadanjaSources ?? [];

  it('lists exactly the seven source ids EXPECTED names, once each', () => {
    expect(jsonSources.map((s) => s.source).sort()).toEqual(EXPECTED.map((s) => s.source).sort());
  });

  it('carries the exact url and licence for every source', () => {
    for (const expected of EXPECTED) {
      const entry = jsonSources.find((s) => s.source === expected.source);
      expect(entry, `no izvori.json entry for ${expected.source}`).toBeDefined();
      expect(entry!.url, `url for ${expected.source}`).toBe(expected.url);
      expect(entry!.licence, `licence for ${expected.source}`).toBe(expected.licence);
    }
  });

  it('lists exactly the fourteen ModuleId rows in "sources" (nine and the five of October 2026, U3; the count is test/app/izvori.test.ts\'s too)', () => {
    expect((izvoriJson as { sources: unknown[] }).sources).toHaveLength(14);
  });
});

describe('docs/izvori.md and docs/prijava/prijedlog-projekta.md name every dogadanja source with the same url and licence', () => {
  const izvori = read('docs/izvori.md');
  const prijedlog = read('docs/prijava/prijedlog-projekta.md');

  it('docs/izvori.md contains every source URL and its licence', () => {
    for (const expected of EXPECTED) {
      expect(izvori, `docs/izvori.md missing URL for ${expected.source}`).toContain(expected.url);
      expect(izvori, `docs/izvori.md missing licence for ${expected.source}`).toContain(expected.licence);
    }
  });

  it('docs/izvori.md documents both Etnografski endpoints (dogadjanja and izlozbe)', () => {
    expect(izvori).toContain(ETNOGRAFSKI_DOGADJANJA_URL);
    expect(izvori).toContain(ETNOGRAFSKI_IZLOZBE_URL);
  });

  it('section 5 of prijedlog-projekta.md contains every source URL and its licence', () => {
    for (const expected of EXPECTED) {
      expect(prijedlog, `prijedlog-projekta.md missing URL for ${expected.source}`).toContain(expected.url);
      expect(prijedlog, `prijedlog-projekta.md missing licence for ${expected.source}`).toContain(expected.licence);
    }
  });
});

describe('R-P5 and O-70: the two sources a robots.txt bears on are named in docs/izvori.md with their reason', () => {
  const izvori = read('docs/izvori.md');

  it('names Guru za kulturu, the disallowed path and the ruling that reads it (O-70, 22 September 2026)', () => {
    expect(izvori).toContain('Guru za kulturu');
    expect(izvori).toContain('kultura.zagreb.hr');
    expect(izvori).toMatch(/robots\.txt/);
    expect(izvori).toContain('O-70');
    expect(izvori).toContain('22. rujna 2026.');
    expect(izvori).toContain('Disallow: /api/');
    // The route that is read, once an hour and identified, and the one exception in the guard's test.
    expect(izvori).toContain('kultura.zagreb.hr/api/chatbot/events');
    expect(izvori).toContain('najviše jednom na sat');
    expect(izvori).toContain('OWNER_OVERRIDES');
    // It is no longer called left out.
    expect(izvori).not.toMatch(/Guru za kulturu\*\*[^\n]*isključen/);
  });

  it('names the Skupština YouTube Atom feed, the disallowed path, and links the channel instead', () => {
    expect(izvori).toContain('YouTube');
    expect(izvori).toContain('feeds/videos.xml');
    expect(izvori).toContain(SKUPSTINA_YOUTUBE_URL);
    expect(izvori).toMatch(/(poveznica|linkanje|linking)[^.]*nije[^.]*(dohvat|crawl)/i);
  });
});

describe('R-F7: docs point readers to /izvori for the per-source list now that the page renders it', () => {
  const izvori = read('docs/izvori.md');
  const prijedlog = read('docs/prijava/prijedlog-projekta.md');

  // The page reference, not the doc file: "/izvori" immediately followed by
  // ".md" is a mention of the markdown file, not the live route.
  const PAGE_REF = /\/izvori(?!\.md)/;

  it('docs/izvori.md says the per-source dogadanja table is also on /izvori', () => {
    const section = izvori.slice(izvori.indexOf('### Šest izvora modula'));
    expect(section.slice(0, 400)).toMatch(PAGE_REF);
  });

  it('docs/izvori.md says the two robots.txt cases are also named on /izvori', () => {
    const section = izvori.slice(izvori.indexOf('Dva izvora navedena'));
    expect(section.slice(0, 300)).toMatch(PAGE_REF);
  });

  it('section 5 of the proposal says the per-source list is on /izvori, not only in docs/izvori.md', () => {
    const section = prijedlog.slice(prijedlog.indexOf('Redak "Zagrebački događaji"'));
    expect(section.slice(0, 300)).toMatch(PAGE_REF);
  });
});

// U3: hak is the article-8 relay of HAK's terms. Article 10 forbids scripted collection without written approval; the row
// cites 8 and quotes 10, so a reader sees both (owner decision 2 of the preparation phase).
describe('the October modules are documented as module rows, and hak quotes article 10', () => {
  const izvori = read('docs/izvori.md');
  const NL = String.fromCharCode(10);
  const row = (id: string) => izvori.split(NL).find((line) => line.startsWith('| `' + id + '` |'))!;

  it('has a row for each of the five with the plan\'s windows, under the heading of October 2026', () => {
    expect(izvori).toContain('## Moduli uvedeni u listopadu 2026.');
    for (const [id, pair] of [['kultura-zg', '3600 / 259200'], ['programi', '3600 / 259200'], ['dhmz-hourly', '3600 / 21600'], ['hak', '600 / 21600'], ['prekidi', '3600 / 172800']] as const) {
      expect(row(id), id).toBeDefined();
      expect(row(id), id).toContain(` ${pair} |`);
      expect(izvori.indexOf(row(id))).toBeGreaterThan(izvori.indexOf('## Moduli uvedeni u listopadu 2026.'));
    }
  });

  it('cites article 8 in the hak row and quotes article 10 beside it', () => {
    expect(row('hak')).toContain('čl. 8');
    expect(izvori).toContain('Članak 10');
    expect(izvori).toContain('automatizirano preuzimati, indeksirati ili prikupljati sadržaje uporabom robota, programskih skripti, alata za scraping ili drugih automatiziranih sredstava, osim uz prethodno pisano odobrenje HAK-a');
    expect(izvori).toContain('kontinuirano ili automatizirano prenošenje sadržajno ograničenog izbora informacija');
    expect(izvori).toContain('TEASER_MODULES');
  });

  it('lists a live source as a module, never as planned (F28)', () => {
    const planned = izvori.slice(izvori.indexOf('## Izvori planirani za financirano razdoblje'), izvori.indexOf('## Kako navodimo izvore'));
    expect(planned).not.toContain('HAK, stanje na cestama');
    expect(planned).not.toContain('HEP ODS');
    expect(planned).not.toContain('hep.hr/ods/ostalo');
  });

  it('names the two derived static datasets of the round with their licence', () => {
    const statics = izvori.slice(izvori.indexOf('### Statički skupovi'), izvori.indexOf('### ZET-ova shema tramvajskih linija'));
    expect(statics).toContain('Radno vrijeme mjesta');
    expect(statics).toContain('© OpenStreetMap contributors, ODbL 1.0; izvedena baza podataka (radno vrijeme mjesta)');
    expect(statics).toContain('Ulice za smještaj prekida i cestovnih obavijesti');
    expect(statics).toContain('worker/data/street-points.json');
    expect(statics).toContain('npm run build:street-points');
  });

  it('uses no em dash in the lines this round added', () => {
    const october = izvori.slice(izvori.indexOf('## Moduli uvedeni u listopadu 2026.'), izvori.indexOf('### Gradski katalog i uvjeti'));
    expect(october).not.toContain('\u2014');
  });
});

describe('R-X2: docs/izvori.md states the /open licence boundary precisely', () => {
  const izvori = read('docs/izvori.md');
  const derivedSection = izvori.slice(izvori.indexOf('## Izvedeni podaci'));

  it('names which tiers reach /open', () => {
    expect(derivedSection).toContain('open');
    expect(derivedSection).toContain('session');
  });

  it('says plainly that session-tier sources are not republished at /open at all', () => {
    expect(derivedSection).toMatch(/session[\s\S]{0,220}(ne objavljuje|nije objavlj)/i);
  });

  it('names dogadanja explicitly and distinguishes the kiosk teaser from a /open republish', () => {
    expect(derivedSection).toContain('dogadanja');
    expect(derivedSection).toContain(CC_BY_SA);
    expect(derivedSection).toMatch(/kiosk|javnom zaslonu|teaser/i);
  });
});
