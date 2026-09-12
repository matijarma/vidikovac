import { describe, expect, it } from 'vitest';
import { ATTRIBUTION } from '../../worker/feed/registry';
import type { FeedItem, ModuleSnapshot } from '../../worker/feed/schema';
import { renderHitnoPage } from '../../worker/hitno/render';
import { ZBORNA_MJESTA_LAYER, selectHitno } from '../../worker/hitno/select';

const NOW = new Date('2026-09-11T08:00:00Z'); // 10:00 in Zagreb

function snapshot(
  module: ModuleSnapshot['module'],
  items: FeedItem[],
  status: ModuleSnapshot['status'] = 'live',
): ModuleSnapshot {
  return {
    module,
    tier: 'open',
    status,
    fetchedAt: '2026-09-11T07:58:00Z',
    ...(status === 'stale' ? { staleSince: '2026-09-11T07:30:00Z' } : {}),
    attribution: {
      text: `Izvor: ${module.toUpperCase()}, Otvorena dozvola`,
      url: `https://example.test/${module}`,
      licence: 'Otvorena dozvola',
    },
    items,
  };
}

const CAP = snapshot('dhmz-cap', [
  {
    id: 'w1',
    module: 'dhmz-cap',
    kind: 'warning',
    tier: 'open',
    title: 'Žuto upozorenje za grmljavinsku oluju',
    summary: 'Lokalno mogući obilniji pljuskovi praćeni grmljavinom. Količina oborine > 20 mm',
    severity: 'moderate',
    at: '2026-09-11T05:00:00+02:00',
    until: '2026-09-11T17:00:00+02:00',
  },
]);

const PROMETNICE = snapshot('prometnice', [
  {
    id: 'c1',
    module: 'prometnice',
    kind: 'closure',
    tier: 'open',
    title: 'Sarajevska cesta',
    summary: 'Zatvoreno zbog radova, oba smjera',
    at: '2026-04-30T11:46:00+00:00',
    until: '2026-09-11T18:00:00+00:00',
    geo: { type: 'LineString', coordinates: [[16.0071, 45.7646], [16.0077, 45.7631]] },
  },
]);

const CKAN = snapshot('ckan-geo', [
  {
    id: 'z1',
    module: 'ckan-geo',
    kind: 'poi',
    tier: 'open',
    title: 'Zborno mjesto Zrinjevac',
    summary: 'Trg Nikole Šubića Zrinskog',
    geo: { type: 'Point', coordinates: [15.9785, 45.8093] },
    data: { layer: ZBORNA_MJESTA_LAYER },
  },
]);

describe('renderHitnoPage', () => {
  const html = renderHitnoPage(selectHitno([CAP, PROMETNICE, CKAN], NOW), NOW);

  it('is a Croatian HTML document with no script, no link and no external fetch', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="hr">');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    expect(html).not.toMatch(/url\(\s*['"]?https?:/);
    expect(html).not.toMatch(/@(import|font-face)/);
  });

  it('lists the CAP warning in words with its severity, times and description', () => {
    expect(html).toContain('Žuto upozorenje za grmljavinsku oluju');
    expect(html).toContain('<span class="sev sev-moderate">umjereno</span>');
    expect(html).toContain('11. 9. 05:00');
    expect(html).toContain('11. 9. 17:00');
    expect(html).toContain('Količina oborine &gt; 20 mm');
  });

  it('does not turn a missing quake source into an all-clear and shows the active closure', () => {
    expect(html).toContain('Podaci o potresima trenutačno nisu potvrđeni.');
    expect(html).not.toContain('EMSC nije zabilježio potres');
    expect(html).toContain('Izvor trenutačno nedostupan'); // emsc snapshot missing
    expect(html).toContain('Sarajevska cesta');
    expect(html).toContain('Zatvoreno zbog radova, oba smjera');
  });

  it('renders assembly points with an OpenStreetMap link built from the point', () => {
    expect(html).toContain('Zborno mjesto Zrinjevac');
    expect(html).toContain('https://www.openstreetmap.org/?mlat=45.8093&amp;mlon=15.9785#map=17/45.8093/15.9785');
  });

  it('renders the curated pharmacies marked provjeriti with the source link', () => {
    expect(html).toContain('Dežurne ljekarne');
    expect(html).toContain('Ilica 291');
    expect(html).toContain('href="tel:+38513750321"');
    expect(html).toContain('Ljekarna ZEUS');
    expect(html).toContain('<span class="check">provjeriti</span>');
    expect(html).toContain('https://www.zagreb.hr/dezurne-ljekarne/497');
  });

  it('renders the emergency numbers as tel links', () => {
    for (const n of ['112', '192', '193', '194', '1987']) {
      expect(html).toContain(`href="tel:${n}"`);
    }
    expect(html).toContain('https://civilna-zastita.gov.hr/');
  });

  it('carries every panel attribution verbatim with a link to the original', () => {
    expect(html).toContain('Izvor: DHMZ-CAP, Otvorena dozvola');
    expect(html).toContain('href="https://example.test/dhmz-cap"');
    expect(html).toContain('Izvor: PROMETNICE, Otvorena dozvola');
    expect(html).toContain('Izvor: CKAN-GEO, Otvorena dozvola');
  });

  it('escapes feed text', () => {
    const hostile = snapshot('dhmz-cap', [
      {
        id: 'x',
        module: 'dhmz-cap',
        kind: 'warning',
        tier: 'open',
        title: '<img src=x onerror=alert(1)>',
        severity: 'extreme',
        until: '2026-09-11T23:00:00+02:00',
      },
    ]);
    const out = renderHitnoPage(selectHitno([hostile], NOW), NOW);
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('<span class="sev sev-extreme">izuzetno</span>');
  });

  it('falls back to a safe severity word and class when a feed value is outside the closed vocabulary', () => {
    // FeedItem['severity'] is typed to five literals, but that is a
    // compile-time promise only: a bug in Area A's CAP-severity mapping, an
    // unmapped CAP severity string, or a future field could hand render.ts a
    // value outside that vocabulary. The cast below reproduces that at
    // runtime the way a real bug would, using the exact attribute-breakout
    // shape the finding names.
    const malformed = snapshot('dhmz-cap', [
      {
        id: 'y',
        module: 'dhmz-cap',
        kind: 'warning',
        tier: 'open',
        title: 'Neispravna razina',
        severity: 'moderate"><script>alert(1)</script>' as unknown as FeedItem['severity'],
        until: '2026-09-11T23:00:00+02:00',
      },
    ]);
    const out = renderHitnoPage(selectHitno([malformed], NOW), NOW);
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).not.toContain('moderate">');
    expect(out).not.toContain('sev-moderate"');
    expect(out).toContain('<span class="sev sev-info">obavijest</span>');
  });

  it('marks a stale snapshot as such', () => {
    const stale = snapshot('prometnice', [], 'stale');
    const out = renderHitnoPage(selectHitno([stale], NOW), NOW);
    expect(out).toContain('Zastarjelo');
    expect(out).toContain('Stanje prometnica nije potvrđeno.');
    expect(out).not.toContain('Nema aktivnih zatvaranja.');
  });

  it('fills every attribution template at render time so no brace reaches the page (R-62)', () => {
    // The real R-08 templates, not the plain (already brace-free) fixture
    // attribution the other tests in this file use, so this actually proves
    // the fill runs and none of "{vrijeme}"/"{datum}"/"{naziv}" survive.
    const capTemplated: ModuleSnapshot = { ...CAP, attribution: ATTRIBUTION['dhmz-cap'] };
    const prometniceTemplated: ModuleSnapshot = { ...PROMETNICE, attribution: ATTRIBUTION.prometnice };
    const ckanTemplated: ModuleSnapshot = {
      ...CKAN,
      attribution: ATTRIBUTION['ckan-geo'],
      items: [{ ...CKAN.items[0]!, data: { layer: ZBORNA_MJESTA_LAYER, category: 'Zborno mjesto civilne zaštite' } }],
    };
    const out = renderHitnoPage(selectHitno([capTemplated, prometniceTemplated, ckanTemplated], NOW), NOW);
    // <main>, not the whole document: the inline <style> block is legitimate
    // CSS and is full of braces that have nothing to do with attribution.
    const main = out.slice(out.indexOf('<main>'), out.indexOf('</main>'));
    expect(main).not.toContain('{');
    expect(main).not.toContain('}');
    // fetchedAt '2026-09-11T07:58:00Z' is 09:58 in Zagreb; none of these three
    // modules carries a sourceUpdatedAt in this fixture, so {vrijeme}/{datum}
    // both fall back to the fetch time, labelled as such (R-25).
    expect(out).toContain('Izvor: DHMZ, Otvorena dozvola, dohvaćeno 11. 9. 2026. 09:58');
    expect(out).toContain('posljednja izmjena dohvaćeno 11. 9. 2026. 09:58');
    expect(out).toContain('Zborno mjesto civilne zaštite');
  });
});
