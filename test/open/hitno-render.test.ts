import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../app/src/kiosk/districts';
import { ATTRIBUTION } from '../../worker/feed/registry';
import type { FeedItem, ModuleSnapshot } from '../../worker/feed/schema';
import { ASSEMBLY_PAGE, renderHitnoPage } from '../../worker/hitno/render';
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

/** An assembly point; `district` as the feed spells it (R-K4), or none. */
function point(n: number, district?: string): FeedItem {
  return {
    id: `z${n}`,
    module: 'ckan-geo',
    kind: 'poi',
    tier: 'open',
    title: `Zborno mjesto ${n}`,
    summary: `Ulica ${n}`,
    geo: { type: 'Point', coordinates: [15.9 + n / 1000, 45.8] },
    data: { layer: ZBORNA_MJESTA_LAYER, ...(district === undefined ? {} : { district }) },
  };
}

/** The `<main>` of a page, so the inline <style> never satisfies a markup assertion. */
function mainOf(html: string): string {
  return html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
}

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

  it('is named Sigurnost, with the lede, the title and the accent on the question mark of the wordmark', () => {
    expect(html).toContain('<title>Sigurnost · Kaj ima?</title>');
    expect(html).toContain('<h1>Sigurnost</h1>');
    expect(html).not.toContain('<h1>Hitno</h1>');
    expect(html).toContain('<p class="lede">Hitni brojevi, upozorenja i pomoć u Zagrebu. Radi bez skeniranja.</p>');
    expect(html).toContain('<a class="brand" href="/">Kaj ima<span class="mark">?</span></a>');
  });

  it('keeps the six-anchor table of contents as one nav and the skip link to the numbers', () => {
    expect(html).toContain('<a class="skip" href="#brojevi">Preskoči na brojeve za hitne slučajeve</a>');
    const toc = html.slice(html.indexOf('<nav class="toc" aria-label="Sadržaj">'), html.indexOf('</nav>'));
    expect(toc.match(/<li><a href="#[a-z-]+">/g)).toHaveLength(6);
    for (const id of ['brojevi', 'upozorenja', 'potresi', 'prometnice', 'zborna-mjesta', 'ljekarne']) {
      expect(toc).toContain(`href="#${id}"`);
      expect(html).toContain(`<section id="${id}" aria-labelledby="h-${id}">`);
    }
  });

  it('lists the CAP warning in words with its severity, times and description', () => {
    expect(html).toContain('Žuto upozorenje za grmljavinsku oluju');
    expect(html).toContain('<span class="sev sev-moderate">žuto upozorenje</span>');
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

  it('ends with the shared footer set, the current page marked', () => {
    const footer = html.slice(html.indexOf('<footer class="page">'));
    expect(footer).toContain('<a href="/hitno" aria-current="page">Sigurnost</a>');
    expect(footer).toContain('<a href="/s/">Upiši kod</a>');
    expect(footer).toContain('<a href="/izvori/">Izvori</a>');
    expect(footer).toContain('<a href="/open/">Otvoreni podaci</a>');
    expect(footer).toContain('<a href="/privatnost/">Privatnost</a>');
    expect(footer).toContain('<a href="/pristupacnost/">Pristupačnost</a>');
    expect(footer).not.toContain('Izvori i licence');
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
    expect(out).toContain('<span class="sev sev-extreme">crveno upozorenje</span>');
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

  it('marks a stale snapshot as such, from the moment the live fetch first failed', () => {
    const stale = snapshot('prometnice', [], 'stale');
    const out = renderHitnoPage(selectHitno([stale], NOW), NOW);
    expect(out).toContain('Zastarjelo');
    // staleSince 07:30Z is 09:30 in Zagreb; fetchedAt 07:58Z is 09:58.
    expect(out).toContain('Zastarjelo od <time datetime="2026-09-11T07:30:00.000Z">09:30</time>');
    expect(out).toContain('posljednji uspješan dohvat <time datetime="2026-09-11T07:58:00.000Z">09:58</time>');
    expect(out).toContain('Stanje prometnica nije potvrđeno.');
    expect(out).not.toContain('Nema aktivnih zatvaranja.');
  });

  it('keeps the status sentence in one span beside the shape, so a flex gap never splits it', () => {
    expect(html).toContain('<span class="dot" aria-hidden="true">●</span> <span>Živo: ');
    expect(html).toContain('<span class="dot" aria-hidden="true">○</span> <span>Izvor trenutačno nedostupan.</span>');
  });

  it('names the copy neutrally when the source time shown is from another day and the fetch is not live', () => {
    const old = new Date('2026-09-11T08:20:00Z'); // 20 minutes after the fetch: not live
    const dated: ModuleSnapshot = { ...CAP, sourceUpdatedAt: '2026-09-09T06:00:00Z' };
    const out = renderHitnoPage(selectHitno([dated], old), old);
    expect(out).toContain('<span>Stanje: ažurirano <time datetime="2026-09-09T06:00:00.000Z">9. 9. 08:00</time>.</span>');
    expect(out).not.toContain('Danas: ažurirano <time datetime="2026-09-09');
    const sameDay = renderHitnoPage(selectHitno([CAP], old), old);
    expect(sameDay).toContain('<span>Danas: dohvaćeno <time datetime="2026-09-11T07:58:00.000Z">09:58</time>.</span>');
  });

  it('says "dohvaćeno" when only a fetch time exists and "ažurirano" only for a source time (R-25)', () => {
    // The fixture snapshot has no sourceUpdatedAt: the fetch time is a fetch time.
    expect(html).toContain('Živo: dohvaćeno <time datetime="2026-09-11T07:58:00.000Z">09:58</time>.');
    expect(mainOf(html)).not.toContain('ažurirano');
    const dated: ModuleSnapshot = { ...CAP, sourceUpdatedAt: '2026-09-11T07:40:00Z' };
    const out = renderHitnoPage(selectHitno([dated], NOW), NOW);
    expect(out).toContain('Živo: ažurirano <time datetime="2026-09-11T07:40:00.000Z">09:40</time>.');
    expect(out).not.toContain('ažurirano <time datetime="2026-09-11T07:58:00.000Z">');
  });

  it('prints a source time from another day with its date, never a bare clock', () => {
    const dated: ModuleSnapshot = { ...CAP, sourceUpdatedAt: '2026-09-09T06:00:00Z' };
    const out = renderHitnoPage(selectHitno([dated], NOW), NOW);
    expect(out).toContain('Živo: ažurirano <time datetime="2026-09-09T06:00:00.000Z">9. 9. 08:00</time>.');
  });

  describe('assembly points', () => {
    it('groups them under one <details> per gradska četvrt, in the order of districts.ts, with the count in the summary', () => {
      const geo = snapshot('ckan-geo', [
        point(1, 'Trnje'),
        point(2, 'Donji grad'),
        point(3, 'Gornji Grad-Medveščak'), // the feed's spelling of the table's "Gornji grad – Medveščak"
        point(4, 'Trnje'),
        point(5, 'Nepoznata četvrt'),
        point(6),
      ]);
      const out = mainOf(renderHitnoPage(selectHitno([geo], NOW), NOW));
      const groups = [...out.matchAll(/<details class="district"><summary>(.*?)<\/summary>/g)].map((m) => m[1]);
      expect(groups).toEqual([
        'Donji grad <span class="count">· 1 mjesto</span>',
        'Gornji grad – Medveščak <span class="count">· 1 mjesto</span>',
        'Trnje <span class="count">· 2 mjesta</span>',
        'Nepoznata četvrt <span class="count">· 1 mjesto</span>',
        'Četvrt nije navedena <span class="count">· 1 mjesto</span>',
      ]);
      expect(DISTRICTS.findIndex((d) => d.name === 'Donji grad')).toBeLessThan(DISTRICTS.findIndex((d) => d.name === 'Trnje'));
      // Every point is inside its group, none is paged.
      const trnje = out.slice(out.indexOf('Trnje <span'), out.indexOf('Nepoznata četvrt <span'));
      expect(trnje).toContain('Zborno mjesto 1');
      expect(trnje).toContain('Zborno mjesto 4');
      expect(out).not.toContain('Prikaži još');
      expect(out).toContain('Na popisu je <b>6</b> mjesta');
    });

    it(`without a district shows the first ${ASSEMBLY_PAGE} and folds the rest behind "Prikaži još"`, () => {
      const geo = snapshot('ckan-geo', Array.from({ length: ASSEMBLY_PAGE + 6 }, (_, i) => point(i + 1)));
      const out = mainOf(renderHitnoPage(selectHitno([geo], NOW), NOW));
      expect(out).not.toContain('<details class="district">');
      const fold = out.indexOf('<details><summary>Prikaži još (6)</summary>');
      expect(fold).toBeGreaterThan(0);
      const titles = [...out.matchAll(/<span class="title">(Zborno mjesto \d+)<\/span>/g)].map((m) => m[1]);
      expect(titles).toHaveLength(ASSEMBLY_PAGE + 6);
      const before = out.slice(0, fold).match(/<span class="title">Zborno mjesto \d+<\/span>/g) ?? [];
      expect(before).toHaveLength(ASSEMBLY_PAGE);
    });

    it('needs no fold and no groups for a short list without districts', () => {
      const out = mainOf(html);
      expect(out).not.toContain('Prikaži još');
      expect(out).not.toContain('<details class="district">');
      expect(out).toContain('<span class="title">Zborno mjesto Zrinjevac</span>');
    });

    it('states the register’s true size from the assembly source, not the number of rows or the module total that counts districts too', () => {
      const geo: ModuleSnapshot = {
        ...snapshot('ckan-geo', [point(1, 'Trnje'), point(2, 'Trnje')]),
        sources: {
          'gradske-cetvrti': { status: 'live', itemCount: 17, totalItems: 17, fetchedAt: '2026-09-11T07:58:00Z' },
          [ZBORNA_MJESTA_LAYER]: { status: 'live', itemCount: 2, totalItems: 512, fetchedAt: '2026-09-11T07:58:00Z' },
        },
        coverage: { shown: 19, total: 529, limited: true },
      };
      const out = mainOf(renderHitnoPage(selectHitno([geo], NOW), NOW));
      expect(out).toContain('Na popisu je <b>512</b> mjesta u Gradu Zagrebu.');
      expect(out).not.toContain('<b>529</b>');
      expect(out).not.toContain('<b>2</b> mjesta');
    });
  });

  it('shows five closures and folds the rest', () => {
    const closures = snapshot('prometnice', Array.from({ length: 8 }, (_, i) => ({
      ...PROMETNICE.items[0]!,
      id: `c${i}`,
      title: `Ulica ${i}`,
    })));
    const out = mainOf(renderHitnoPage(selectHitno([closures], NOW), NOW));
    expect(out).toContain('<details><summary>Prikaži preostala zatvaranja (3)</summary>');
    expect((out.slice(0, out.indexOf('<details>')).match(/<span class="title">Ulica \d<\/span>/g) ?? []).length).toBe(5);
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
    const main = mainOf(out);
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
