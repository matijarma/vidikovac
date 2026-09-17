import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { moduleIdsFromSchema } from '../../scripts/lib/module-ids.mjs';

const NL = String.fromCharCode(10);
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('docs/izvori.md', () => {
  const izvori = read('docs/izvori.md');
  it('documents every ModuleId from worker/feed/schema.ts as a table row', () => {
    const ids = moduleIdsFromSchema(read('worker/feed/schema.ts'));
    expect(ids.length).toBeGreaterThanOrEqual(9);
    for (const id of ids) expect(izvori, `missing row for module ${id}`).toMatch(new RegExp(`^\\| \`${id}\` \\|`, 'm'));
  });
  it('carries the verbatim attribution strings the plan fixes', () => {
    expect(izvori).toContain(
      'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669',
    );
    expect(izvori).toContain('Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom');
    expect(izvori).toContain('Izvor: DHMZ, Otvorena dozvola');
    expect(izvori).toContain('Izvor: EMSC, seismicportal.eu');
    expect(izvori).toContain('https://data.zagreb.hr/dataset/7ff5514d-0a1f-4f6c-86bd-8ed9a3c55eee/resource/e48b6992-add0-45a1-ae95-c5d97d8db259/download/data.json');
  });
  // R-08 and R-58: the registry is the single source, so both columns are its
  // strings character for character. The glasnik row used to drop the "Izvor: "
  // prefix and the emsc row used its own words for the licence.
  it('quotes the registry attribution and licence of every module verbatim', async () => {
    const { MODULES, MODULE_IDS } = await import('../../worker/feed/registry');
    for (const id of MODULE_IDS) {
      const row = izvori.split(NL).find((line) => line.startsWith('| `' + id + '` |'))!;
      expect(row, `no row for ${id}`).toBeDefined();
      const cells = row.split('|').map((cell) => cell.trim());
      expect(cells[cells.length - 2], `attribution of ${id}`).toBe(MODULES[id].attribution.text);
    }
    // The licence column carries the registry's own value where the registry
    // has one that is not a plain Croatian licence name; the other rows may
    // still add the context a reader of the document needs.
    const emsc = izvori.split(NL).find((line) => line.startsWith('| `emsc` |'))!;
    expect(emsc.split('|').map((cell) => cell.trim())[4]).toBe(MODULES.emsc.attribution.licence);
  });
  it('states TTL and maxStale for the nine modules exactly as the plan does', () => {
    for (const pair of ['10 / 300', '180 / 1800', '60 / 3600', '300 / 7200', '600 / 7200', '1800 / 86400', '3600 / 604800', '86400 / 2592000']) {
      expect(izvori, `missing TTL pair ${pair}`).toContain(pair);
    }
  });
});

describe('docs/kiosk.md', () => {
  const kiosk = read('docs/kiosk.md');
  it('documents the actual self-service journey and supported network rule', () => {
    expect(kiosk).toContain('POST /api/screens');
    expect(kiosk).toContain('Isti Wi-Fi je dopušten.');
    expect(kiosk).not.toContain('Ovaj zaslon i tvoj telefon dijele istu mrežu.');
    expect(kiosk).toContain('APP_ENV=test');
    expect(kiosk).toContain('E2E_ADMIN_BYPASS');
    expect(kiosk).toContain('24 sata');
    expect(kiosk).toContain('git push');
    expect(kiosk).toContain('fizička matrica');
  });
});

describe('docs/arhitektura.md and README.md', () => {
  it('names the four Durable Objects and the deploy convention', () => {
    const arh = read('docs/arhitektura.md');
    for (const cls of ['BeaconDO', 'RoomDO', 'IndexDO', 'MetricsDO']) expect(arh).toContain(cls);
    const readme = read('README.md');
    expect(readme).toContain('git push');
    expect(readme).toContain('npm run e2e');
    expect(readme).toContain('AGPL-3.0-or-later');
  });
  it('points to the approved design and identifies the previous system as historical', () => {
    const readme = read('README.md');
    expect(readme).toContain('newdesignsystem.md');
    expect(readme).toContain('DESIGN.md');
    expect(readme).toContain('docs/redesign-2026-09-17.md');
  });
});

describe('docs/implementation-kaj-ima.md', () => {
  it('names the Dan grada system and its plan path', () => {
    const doc = read('docs/implementation-kaj-ima.md');
    expect(doc).toContain('Dan grada');
    expect(doc).toContain('implement-vidikovac-newdesignsystem-md-agile-locket.md');
  });
});
