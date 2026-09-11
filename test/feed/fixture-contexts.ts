// One fetch context per module, answering from the real upstream samples in
// test/fixtures. Shared by the module contract tests here and by the
// feed-to-layers integration test, so both areas exercise byte-identical
// upstream bodies and a fixture can never drift between the two.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchContext, ModuleId } from '../../worker/feed/schema';
import { CKAN_PACKAGE_SHOW, ZBORNA_MJESTA_DATASET } from '../../worker/feed/modules/ckan-geo';

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
const ZBORNA_PACKAGE = JSON.stringify({
  success: true,
  result: {
    name: ZBORNA_MJESTA_DATASET,
    metadata_modified: '2026-09-01T08:00:00.000000',
    resources: [{ format: 'JSON', url: 'https://data.zagreb.hr/zborna-mjesta.json' }],
  },
});
const ZBORNA_RECORDS = JSON.stringify([{ naziv: 'Zrinjevac', adresa: 'Trg N. Š. Zrinskog', lat: 45.811, lon: 15.978 }]);

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
    [CKAN_PACKAGE_SHOW, () => ZBORNA_PACKAGE],
    ['zborna-mjesta.json', () => ZBORNA_RECORDS],
  ]),
};
