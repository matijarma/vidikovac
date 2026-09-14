// One fetch context per module, answering from the real upstream samples in
// test/fixtures. Shared by the module contract tests here and by the
// feed-to-layers integration test, so both areas exercise byte-identical
// upstream bodies and a fixture can never drift between the two.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchContext, ModuleId } from '../../worker/feed/schema';
import { ZBORNA_MJESTA_URL } from '../../worker/feed/modules/ckan-geo';

export const FIXTURE_NOW = new Date('2026-09-11T12:00:00.000Z');

// Resolved through node:path, not `new URL(..., import.meta.url)`: under
// happy-dom the global URL resolves a relative path against the document's
// http://localhost origin instead of this file.
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const text = (name: string) => readFileSync(join(FIXTURE_DIR, name), 'utf8');
const bytes = (name: string) => new Uint8Array(readFileSync(join(FIXTURE_DIR, name)));

/** Answers each upstream from the first fixture whose key the URL contains. */
function fixtureContext(routes: [string, () => BodyInit][]): FetchContext {
  return {
    now: () => FIXTURE_NOW,
    fetch: async (url) => {
      const match = routes.find(([needle]) => url.includes(needle));
      if (!match) throw new Error(`no fixture for ${url}`);
      return new Response(match[1]());
    },
  };
}

const AKTI = JSON.stringify({ data: [{ id: 'a1b2', naziv: 'Odluka o proračunu Grada Zagreba' }] });
const ZBORNA_RECORDS = JSON.stringify([{ naziv: 'Zrinjevac', adresa: 'Trg N. Š. Zrinskog', lat: 45.811, lon: 15.978 }]);

// dogadanja's own real, saved fixtures (test/fixtures/dogadanja/*, task E1),
// one route per real URL fragment. Both real Skupština session-page URLs
// answer with the one saved session-page fixture, exactly as
// test/feed/dogadanja/skupstina.test.ts already does (only one was ever
// fetched live; the two rokovnik rows share one CMS template).
function dogadanjaFixtureContext(): FetchContext {
  const at = (name: string) => text(`dogadanja/${name}`);
  const routes: [string, () => BodyInit][] = [
    ['kp_22_announcement', () => at('kulturpunkt.json')],
    ['rokovnik-sjednica', () => at('skupstina-rokovnik.html')],
    ['poziv-na-13-sjednicu-gradske-skupstine-grada-zagreba', () => at('skupstina-sjednica.html')],
    ['15-sjednica-odbora-za-financije', () => at('skupstina-sjednica.html')],
    ['kvartovske-novosti', () => at('kvartovske-novosti.html')],
    ['f90738b6-8bfa-4dd9-9db7-b3c532d90c97', () => at('komunalne-aktivnosti.json')],
    ['rss_novosti.aspx', () => at('zet-rss-novosti.xml')],
    ['rss_promet.aspx', () => at('zet-rss-promet.xml')],
    ['wp/v2/dogadjanja', () => at('etnografski-dogadjanja.json')],
    ['wp/v2/izlozbe', () => at('etnografski-izlozbe.json')],
  ];
  return fixtureContext(routes);
}

export const FIXTURE_CONTEXTS: Record<ModuleId, FetchContext> = {
  'zet-rt': fixtureContext([['gtfs-rt-protobuf', () => bytes('zet-rt.pb')]]),
  prometnice: fixtureContext([['data.json', () => text('prometnice.json')]]),
  'dhmz-now': fixtureContext([['hrvatska1_n.xml', () => text('hrvatska1_n.xml')]]),
  'dhmz-forecast': fixtureContext([['prognoza_danas.xml', () => text('prognoza_danas.xml')]]),
  'dhmz-cap': fixtureContext([['cap_hr_today.xml', () => text('cap_hr_today.xml')]]),
  emsc: fixtureContext([['seismicportal.eu', () => text('emsc.json')]]),
  'hrt-news': fixtureContext([
    ['vijesti/page.xml', () => text('hrt-vijesti.xml')],
    ['sljeme/latest.xml', () => text('hrt-sljeme.xml')],
  ]),
  glasnik: fixtureContext([
    ['sifarnici', () => text('glasnik_sifarnici.json')],
    ['akti', () => AKTI],
  ]),
  'ckan-geo': fixtureContext([
    ['Gradske_cetvrti', () => text('gradske_cetvrti.geojson')],
    [ZBORNA_MJESTA_URL, () => ZBORNA_RECORDS],
  ]),
  dogadanja: dogadanjaFixtureContext(),
};
