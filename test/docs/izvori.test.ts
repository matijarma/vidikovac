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

  it('still lists exactly the original ten ModuleId rows in "sources" (M owns that count -- test/app/izvori.test.ts)', () => {
    expect((izvoriJson as { sources: unknown[] }).sources).toHaveLength(10);
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

describe('R-P5: the two dropped sources are named in docs/izvori.md with the robots.txt reason', () => {
  const izvori = read('docs/izvori.md');

  it('names Guru za kulturu and the disallowed path', () => {
    expect(izvori).toContain('Guru za kulturu');
    expect(izvori).toContain('kultura.zagreb.hr');
    expect(izvori).toMatch(/robots\.txt/);
  });

  it('names the Skupština YouTube Atom feed, the disallowed path, and links the channel instead', () => {
    expect(izvori).toContain('YouTube');
    expect(izvori).toContain('feeds/videos.xml');
    expect(izvori).toContain(SKUPSTINA_YOUTUBE_URL);
    expect(izvori).toMatch(/(poveznica|linkanje|linking)[^.]*nije[^.]*(dohvat|crawl)/i);
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
