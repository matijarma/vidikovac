import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OPEN_DATASETS } from '../../worker/open/catalog';
import { renderOpenIndex, staticAttribution } from '../../worker/open/index-page';

const ORIGIN = 'https://zagreb.aningfilm.hr';
const NOW = new Date('2026-09-11T08:00:00Z');

describe('renderOpenIndex', () => {
  const html = renderOpenIndex(ORIGIN, NOW);

  it('is a zero-JS Croatian page listing every dataset with its distributions and attribution', () => {
    expect(html).toContain('<html lang="hr">');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    for (const d of OPEN_DATASETS) {
      expect(html).toContain(d.title);
      for (const x of d.distributions) expect(html).toContain(`href="${x.path}"`);
    }
    expect(html).toContain('href="/open/catalog.json"');
  });

  // The registry's attribution strings are templates ({vrijeme}, {datum}, {naziv}) filled
  // from a live snapshot where one exists. The human page has none, so the clause that
  // exists only to carry the placeholder is left out and no brace reaches a reader; the
  // footer says where the times live. The DCAT JSON keeps the template verbatim (R-08).
  it('prints every source line without a placeholder clause and without a brace (T6.3)', () => {
    expect(staticAttribution('Izvor: DHMZ, Otvorena dozvola, {vrijeme}')).toBe('Izvor: DHMZ, Otvorena dozvola');
    expect(staticAttribution('Izvor: EMSC, seismicportal.eu')).toBe('Izvor: EMSC, seismicportal.eu');
    expect(staticAttribution("Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup 'Zatvaranje prometnica na području Grada Zagreba', posljednja izmjena {datum}"))
      .toBe("Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup 'Zatvaranje prometnica na području Grada Zagreba'");
    expect(staticAttribution("Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup '{naziv}', posljednja izmjena {datum}"))
      .toBe('Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom');
    expect(staticAttribution('{vrijeme} bez odvajanja')).toBe('bez odvajanja');
    expect(html).toContain('<p class="src">Izvor: DHMZ, Otvorena dozvola · Otvorena dozvola (NN 67/17) · ');
    expect(html).toContain("skup &#39;Zatvaranje prometnica na području Grada Zagreba&#39; · Otvorena dozvola (NN 67/17) · ");
    expect(html).toContain('<p class="src">Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom · Otvorena dozvola (NN 67/17) · ');
    expect(html).not.toMatch(/\{\w+\}/);
  });

  it('states refresh cadence in words and the licence once per dataset', () => {
    expect(html).toContain('svake 3 minute');
    expect(html).toContain('svakih 5 minuta');
    expect(html).toContain('svaku minutu');
    expect(html).toContain('svaki dan');
    expect((html.match(/Otvorena dozvola/g) ?? []).length).toBeGreaterThanOrEqual(OPEN_DATASETS.length);
  });

  it('makes the republishing offer to Grad Zagreb and marks adaptations', () => {
    expect(html).toContain('Ponuda Gradu Zagrebu');
    expect(html).toContain('data.zagreb.hr');
    expect(html).toContain('prilagodba izvora');
  });

  it('robots.txt stays a static asset that allows crawling', () => {
    const robots = readFileSync(fileURLToPath(new URL('../../app/public/robots.txt', import.meta.url)), 'utf8');
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
  });

  // R-F7: the lede used to say "everything the dashboard shows without
  // scanning is published as a machine-readable dataset too", which is false
  // for the kiosk's pre-scan "Grad javlja" events card -- it is drawn from
  // `dogadanja`, a session-tier module, licence-filtered on the way to the
  // teaser (registry.ts teaserSubset), and never archived or offered at
  // /open (docs/izvori.md "## Izvedeni podaci"). The lede must claim
  // republication only for the open-tier modules that OPEN_DATASETS
  // actually lists, and name the events-card exception plainly.
  it('claims republication only for open-tier modules and names the events-card exception (R-F7)', () => {
    expect(html).not.toMatch(/Sve što (nadzorna ploča|kiosk)[^.]*bez skeniranja[^.]*objavljeno/i);
    expect(html).toMatch(/otvorene? razine[^.]*objavljen/i);
    expect(html).toContain('Grad javlja');
    expect(html).toMatch(/sesijske razine/i);
    expect(html).toMatch(/(ne objavljuje|nije objavlj)/i);
  });
});

describe('renderOpenIndex composition (T6.1)', () => {
  const html = renderOpenIndex(ORIGIN, NOW);

  it('opens with a skip link to the main content', () => {
    expect(html).toContain('<a class="skip" href="#sadrzaj">Preskoči na sadržaj</a>');
    expect(html).toContain('<main id="sadrzaj">');
    expect(html).toContain('<a class="brand" href="/">Kaj ima<span class="mark">?</span></a>');
  });

  it('ends with the shared footer set, the current page marked', () => {
    const footer = html.slice(html.indexOf('<footer'));
    expect(footer).toContain('<a href="/hitno">Sigurnost</a>');
    expect(footer).toContain('<a href="/s/">Upiši kod</a>');
    expect(footer).toContain('<a href="/izvori/">Izvori</a>');
    expect(footer).toContain('<a href="/open/" aria-current="page">Otvoreni podaci</a>');
    expect(footer).toContain('<a href="/privatnost/">Privatnost</a>');
    expect(footer).toContain('<a href="/pristupacnost/">Pristupačnost</a>');
    expect(footer).not.toContain('>Hitno<');
  });

  it('keeps the DCAT title and the h1 as they are (T6.3 owns the catalogue strings)', () => {
    expect(html).toContain('<h1>Otvoreni podaci</h1>');
    expect(html).toContain('<title>Otvoreni podaci · Kaj ima?</title>');
  });
});
