import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OPEN_DATASETS } from '../../worker/open/catalog';
import { renderOpenIndex } from '../../worker/open/index-page';

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
      expect(html).toContain(d.source.text.replace(/'/g, '&#39;'));
      for (const x of d.distributions) expect(html).toContain(`href="${x.path}"`);
    }
    expect(html).toContain('href="/open/catalog.json"');
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
