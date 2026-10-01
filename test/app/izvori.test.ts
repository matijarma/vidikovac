import { describe, expect, it } from 'vitest';
import izvori from '../../app/src/data/izvori.json';
import { DOGADANJA_DROPPED, DOGADANJA_SOURCES, OBRADA, STATIC_SOURCES, renderIzvoriHtml, renderStaticSources } from '../../app/src/izvori-render';

const registryMissing = await import('../../worker/feed/registry').then(
  () => false,
  () => true,
);

const EXPECTED: Record<string, { url: string; text: string; licence: string }> = {
  prometnice: {
    url: 'https://data.zagreb.hr/dataset/prometnice',
    text: "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup 'Zatvaranje prometnica na području Grada Zagreba'",
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
  glasnik: {
    url: 'https://www1.zagreb.hr/sluzbeni-glasnik/',
    text: 'Izvor: Službeni glasnik Grada Zagreba, {broj}/{godina}, akt {id}',
    licence: 'Otvorena dozvola (NN 67/17)',
  },
  dogadanja: {
    url: 'https://kulturpunkt.hr/wp-json/wp/v2/kp_22_announcement?_fields=id,link,title,excerpt,class_list,date&per_page=40&orderby=date&order=desc',
    text:
      'Šest izvora zagrebačkih događanja: Kulturpunkt (CC BY-SA 3.0 HR), Skupština Grada Zagreba, kvartovske novosti, ' +
      'plan komunalnih aktivnosti i ZET (Otvorena dozvola), Etnografski muzej; licenca i poveznica navedeni uz svaku stavku prema polju "source"',
    licence: 'Više licenci, vidi izvor uz svaku stavku',
  },
  // The October 2026 modules (U3): the strings of the plan's Data table, character for character.
  'kultura-zg': {
    url: 'https://kultura.zagreb.hr/',
    text: 'Izvor: Guru za kulturu, Grad Zagreb (kultura.zagreb.hr), uz poveznicu na svako događanje',
    licence: 'Ponovna uporaba uz navođenje izvora i poveznicu (kultura.zagreb.hr/pravila-koristenja)',
  },
  programi: {
    url: 'https://www.kgz.hr/hr/dogadjanja/10',
    text: 'Izvor: Knjižnice grada Zagreba; neslužbeni prikaz',
    licence: 'Licenca nije navedena',
  },
  'dhmz-hourly': {
    url: 'https://meteo.hr/proizvodi.php?section=podaci&param=xml_korisnici',
    text: 'Izvor: DHMZ, Otvorena dozvola, {vrijeme}',
    licence: 'Otvorena dozvola (NN 67/17)',
  },
  hak: {
    url: 'https://www.hak.hr/info/stanje-na-cestama/',
    text: 'Izvor: HAK, stanje na cestama, {vrijeme}; neslužbeni prikaz',
    licence: 'Uvjeti korištenja HAK-a, čl. 8: ograničen izbor uz izvor, vrijeme i poveznicu',
  },
  prekidi: {
    url: 'https://www.hep.hr/ods/bez-struje/19?dp=zagreb',
    text: 'Izvor: HEP ODS Elektra Zagreb, Vodoopskrba i odvodnja i Gradska plinara Zagreb; neslužbeni prikaz',
    licence: 'Licenca nije navedena',
  },
  // The more-city modules (R3).
  'dhmz-radar': {
    url: 'https://meteo.hr/podaci.php?section=podaci_mjerenja&param=radari',
    text: 'Izvor: DHMZ, radarski kompozit',
    licence: 'Otvorena dozvola (NN 67/17)',
  },
  'dhmz-bio': {
    url: 'https://meteo.hr/prognoze.php?section=prognoze_specp&param=bio',
    text: 'Izvor: DHMZ, biometeorološka prognoza',
    licence: 'Otvorena dozvola (NN 67/17)',
  },
  'dhmz-waves': {
    url: 'https://meteo.hr/prognoze.php?section=prognoze_specp&param=toplinskival_5',
    text: 'Izvor: DHMZ, upozorenja na toplinske i hladne valove',
    licence: 'Otvorena dozvola (NN 67/17)',
  },
};

describe('app/src/data/izvori.json', () => {
  it('lists exactly the seventeen modules, once each', () => {
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
      // R-58: the page told readers four session modules were open.
      expect(spec.tier, source.module).toBe(source.tier);
    }
    expect(Object.keys(MODULES).sort()).toEqual(izvori.sources.map((s) => s.module).sort());
  });
});

describe('renderIzvoriHtml', () => {
  it('renders one article per source with the text, link and licence', () => {
    const html = renderIzvoriHtml();
    expect((html.match(/<article class="izvor"/g) ?? []).length).toBe(17);
    expect(html).toContain('Public dataset by ZET provided under Open license');
    expect(html).toContain('href="https://www.seismicportal.eu/"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  // The one machine step left is the header sentence (worker/feed/sentences.ts):
  // Workers AI picks among filled templates and writes no text of its own. The
  // per-item summaries the ticker read (FeedItem.brief) are retired (WP5 B1), so
  // the page that names every source says what the model does now, and no more.
  it('says the model only picks the header sentence among filled templates, and condenses nothing', () => {
    const html = renderIzvoriHtml();
    expect(html).toContain('izvor-obrada');
    expect(html).toContain(OBRADA.naslov);
    expect(OBRADA.tekst).toMatch(/Workers AI/);
    expect(OBRADA.tekst).toMatch(/predložak|predložaka|predloške/);
    expect(OBRADA.tekst).toMatch(/ne piše slobodan tekst/);
    expect(`${OBRADA.naslov} ${OBRADA.tekst}`).not.toMatch(/saže|sažim|sažet|traku|traka/i);
    // Still seventeen source articles: the note is a section, not an eighteenth source.
    expect((html.match(/<article class="izvor"/g) ?? []).length).toBe(17);
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

  // R-F7: §5 of the filed proposal points readers at /izvori for "the full
  // per-source list with addresses and licences" of the dogadanja module;
  // before this test the page rendered only the ten-row `sources` summary
  // and never the seven-row `dogadanjaSources` breakdown or the two sources
  // dropped for robots.txt reasons (R-P5), so the promise was false.
  it('renders every dogadanjaSources row (address and licence) under the dogadanja article', () => {
    const html = renderIzvoriHtml();
    const article = html.slice(html.indexOf('id="izvor-dogadanja"'), html.indexOf('</article>', html.indexOf('id="izvor-dogadanja"')));
    for (const source of DOGADANJA_SOURCES) {
      expect(article, `${source.source} url`).toContain(source.url.replace(/&/g, '&amp;'));
      expect(article, `${source.source} licence`).toContain(source.licence);
    }
    // The one source with no reuse licence at all must read exactly that,
    // not a blank or an inherited "Otvorena dozvola".
    const etnografski = DOGADANJA_SOURCES.find((s) => s.source === 'etnografski')!;
    expect(etnografski.licence).toBe('Licenca nije navedena');
    expect(article).toContain('Licenca nije navedena');
  });

  it('renders the two sources a robots.txt bears on with their reason under the dogadanja article: one read under O-70, one left out', () => {
    const html = renderIzvoriHtml();
    const article = html.slice(html.indexOf('id="izvor-dogadanja"'), html.indexOf('</article>', html.indexOf('id="izvor-dogadanja"')));
    expect(DOGADANJA_DROPPED.length).toBe(2);
    for (const dropped of DOGADANJA_DROPPED) {
      expect(article, `${dropped.naziv} naziv`).toContain(dropped.naziv);
      expect(article, `${dropped.naziv} reason`).toContain(dropped.reason);
      expect(article, `${dropped.naziv} reason mentions robots.txt`).toMatch(/robots\.txt/);
    }
    // Guru za kulturu is read, and the page says so under the ruling that allows it; the heading no longer calls it left out.
    const [guru, youtube] = DOGADANJA_DROPPED;
    expect(guru!.naziv).toBe('Guru za kulturu');
    expect(guru!.reason).toContain('O-70');
    expect(guru!.reason).toContain('22. rujna 2026.');
    expect(guru!.reason).toContain('Disallow: /api/');
    expect(guru!.reason).toContain('najviše jednom na sat');
    expect(guru!.reason).toContain('poveznicu');
    expect(guru!.reason).not.toMatch(/Isključeno/);
    expect(youtube!.reason).toMatch(/^Isključeno \(R-P5\)/);
    expect(article).toContain('<h3>Izvori i robots.txt</h3>');
    expect(article).not.toContain('Isključeno zbog robots.txt');
  });
});

// WP3 step 2: the street index behind "Adresa ili stajalište" is OpenStreetMap
// data (ODbL 1.0). It is a static dataset, not a feed module, so the page names
// it in a section of its own and `sources` stays the feed modules; the opening hours of places (U3) are the second.
describe('static datasets', () => {
  it('names the ODbL street index and the ODbL opening hours in their own section, not as more sources', () => {
    expect(izvori.sources.length).toBe(17);
    expect(STATIC_SOURCES.map((s) => s.id)).toEqual(['streets-geo', 'osm-hours', 'zet-gtfs', 'dezurne-ljekarne', 'hitni-brojevi', 'manrope']);
    const [streets, hours] = STATIC_SOURCES;
    expect(hours).toMatchObject({
      licence: 'ODbL 1.0',
      url: 'https://www.openstreetmap.org/copyright',
      text: '© OpenStreetMap contributors, ODbL 1.0; izvedena baza podataka (radno vrijeme mjesta)',
    });
    expect(streets).toMatchObject({ licence: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright', text: '© OpenStreetMap contributors · Protomaps' });
    const html = renderIzvoriHtml();
    expect(html).toContain('aria-labelledby="static-sources-title"');
    expect(html).toContain('id="static-source-streets-geo"');
    expect(html).toContain('id="static-source-osm-hours"');
    expect(html).toContain('© OpenStreetMap contributors · Protomaps');
    expect(html).toContain('© OpenStreetMap contributors, ODbL 1.0; izvedena baza podataka (radno vrijeme mjesta)');
    expect(html).toContain('ODbL 1.0');
    expect((html.match(/<article class="izvor"/g) ?? []).length).toBe(17);
    const section = html.slice(html.indexOf('static-sources-title'));
    expect(section).not.toContain('<article');
  });

  it('credits ZET\'s derived files with its verbatim attribution, the hand-kept lists as unofficial, and the font under its licence', () => {
    const html = renderIzvoriHtml();
    const zetGtfs = STATIC_SOURCES.find((s) => s.id === 'zet-gtfs')!;
    expect(zetGtfs).toMatchObject({ licence: 'Otvorena dozvola (NN 67/17)', text: izvori.sources.find((s) => s.module === 'zet-rt')!.text });
    for (const file of ['zet-routes.json', 'zet-network.json', 'zet-trips.json', 'stops.json', 'lastrun/*.json', 'zet-expect.json']) expect(zetGtfs.opis, file).toContain(file);
    expect(STATIC_SOURCES.find((s) => s.id === 'dezurne-ljekarne')).toMatchObject({ url: 'https://www.zagreb.hr/dezurne-ljekarne/497', text: 'Izvor: Grad Zagreb, dežurne ljekarne; neslužbeni prikaz' });
    expect(STATIC_SOURCES.find((s) => s.id === 'hitni-brojevi')).toMatchObject({ url: 'https://civilna-zastita.gov.hr/' });
    expect(STATIC_SOURCES.find((s) => s.id === 'manrope')).toMatchObject({ licence: 'SIL Open Font License 1.1' });
    for (const id of ['zet-gtfs', 'dezurne-ljekarne', 'hitni-brojevi', 'manrope']) expect(html, id).toContain(`id="static-source-${id}"`);
  });

  it('escapes the static entries too', () => {
    const html = renderStaticSources([{ id: 'x"y', naziv: '<b>n</b>', url: 'https://x.test/"a', text: 't & u', licence: 'l', opis: 'o' }]);
    expect(html).not.toContain('<b>');
    expect(html).toContain('t &amp; u');
    expect(html).not.toContain('"a"');
  });
});
