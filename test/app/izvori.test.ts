import { describe, expect, it } from 'vitest';
import izvori from '../../app/src/data/izvori.json';
import { renderIzvoriHtml } from '../../app/src/izvori-render';

const registryMissing = await import('../../worker/feed/registry').then(
  () => false,
  () => true,
);

const EXPECTED: Record<string, { url: string; text: string; licence: string }> = {
  prometnice: {
    url: 'https://data.zagreb.hr/dataset/prometnice',
    text: "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup 'Zatvaranje prometnica na području Grada Zagreba', posljednja izmjena {datum}",
    licence: 'Otvorena dozvola (NN 67/17)',
  },
  'ckan-geo': {
    url: 'https://data.zagreb.hr/',
    text: "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup '{naziv}', posljednja izmjena {datum}",
    licence: 'Otvorena dozvola (NN 67/17)',
  },
  'dhmz-cap': {
    url: 'https://meteo.hr/proizvodi.php?section=podaci&param=xml_korisnici',
    text: 'Izvor: DHMZ, Otvorena dozvola, {vrijeme}',
    licence: 'Otvorena dozvola (NN 67/17)',
  },
  'dhmz-now': {
    url: 'https://meteo.hr/proizvodi.php?section=podaci&param=xml_korisnici',
    text: 'Izvor: DHMZ, Otvorena dozvola, {vrijeme}',
    licence: 'Otvorena dozvola (NN 67/17)',
  },
  'dhmz-forecast': {
    url: 'https://meteo.hr/proizvodi.php?section=podaci&param=xml_korisnici',
    text: 'Izvor: DHMZ, Otvorena dozvola, {vrijeme}',
    licence: 'Otvorena dozvola (NN 67/17)',
  },
  emsc: { url: 'https://www.seismicportal.eu/', text: 'Izvor: EMSC, seismicportal.eu', licence: 'EMSC terms' },
  'zet-rt': {
    url: 'http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669',
    text: 'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669',
    licence: 'Otvorena dozvola (NN 67/17)',
  },
  'hrt-news': {
    url: 'https://feed.hrt.hr/vijesti/page.xml',
    text: 'Izvor: HRT, {naslov}, poveznica na izvornik',
    licence: 'HRT uvjeti korištenja, tekst uz navođenje izvora i poveznicu',
  },
  glasnik: {
    url: 'https://www1.zagreb.hr/sluzbeni-glasnik/',
    text: 'Izvor: Službeni glasnik Grada Zagreba, {broj}/{godina}, akt {id}',
    licence: 'Otvorena dozvola (NN 67/17)',
  },
};

describe('app/src/data/izvori.json', () => {
  it('lists exactly the nine modules, once each', () => {
    const ids = izvori.sources.map((s) => s.module);
    expect([...ids].sort()).toEqual(Object.keys(EXPECTED).sort());
  });
  it('carries the ruling R-08 attribution values verbatim', () => {
    for (const source of izvori.sources) {
      const expected = EXPECTED[source.module]!;
      expect({ url: source.url, text: source.text, licence: source.licence }).toEqual(expected);
    }
  });
  it('names every source in Croatian for the page', () => {
    for (const source of izvori.sources) {
      expect(source.naziv.length).toBeGreaterThan(3);
      expect(source.tier === 'open' || source.tier === 'session').toBe(true);
    }
  });
});

describe.skipIf(registryMissing)('parity with worker/feed/registry.ts', () => {
  it('every registry attribution equals the JSON the page is built from', async () => {
    const { MODULES } = await import('../../worker/feed/registry');
    for (const source of izvori.sources) {
      const spec = MODULES[source.module as keyof typeof MODULES];
      expect(spec.attribution.text).toBe(source.text);
      expect(spec.attribution.url).toBe(source.url);
      expect(spec.attribution.licence).toBe(source.licence);
    }
    expect(Object.keys(MODULES).sort()).toEqual(izvori.sources.map((s) => s.module).sort());
  });
});

describe('renderIzvoriHtml', () => {
  it('renders one article per source with the text, link and licence', () => {
    const html = renderIzvoriHtml();
    expect((html.match(/<article class="izvor"/g) ?? []).length).toBe(9);
    expect(html).toContain('Public dataset by ZET provided under Open license');
    expect(html).toContain('href="https://www.seismicportal.eu/"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it('escapes the values instead of trusting the JSON', () => {
    const html = renderIzvoriHtml([
      { module: 'emsc', naziv: '<script>x</script>', tier: 'open', url: 'https://x.test/"onload="1', text: 'a & b', licence: 'l' },
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
    // The raw breakout the payload attempts (a literal quote immediately
    // around the injected attribute) must be neutralised; the letters
    // "onload=" themselves are ordinary data and legitimately survive
    // escaping (as they would for any real URL containing that text) inside
    // the now-inert &quot;...&quot; wrapper.
    expect(html).not.toContain('"onload="');
  });
});
