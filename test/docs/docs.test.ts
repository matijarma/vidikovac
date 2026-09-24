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

describe('the rail graph sentences (T-rail, D3 read-through)', () => {
  const izvori = read('docs/izvori.md');
  const arh = read('docs/arhitektura.md');
  it('count the network in the right grammatical number', () => {
    expect(izvori).toContain('(tri čvora, 345 bridova)');
    expect(izvori).toContain('154 linije, 345 bridova, 591 323 bajta.');
    expect(izvori).not.toMatch(/345 brida|591 323 bajtova/);
  });
  it('name line 1 and the last platform instead of a pronoun standing for them', () => {
    expect(izvori).toContain('bez kojeg se staze linije 1 nisu mogle provesti do Zapadnog kolodvora');
    expect(arh).toContain('bez kojeg se sintetičke staze linije 1 nisu mogle provesti do Zapadnog kolodvora');
    expect(arh).toContain('reže se, kao i petlja, 70 m iza završnog perona.');
    for (const doc of [izvori, arh]) expect(doc).not.toMatch(/njezine (sintetičke )?staze|70 m iza njega/);
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
  // WP3 (22 Sep): one optional field and Pokreni, then click-toggle Postavke behind a long
  // press on the brand. The numbers are the rulings' (0,8 s, 300 m), never the planner's
  // 1,5 s / 250 m, and nothing of the one-button start, the gear or Spremi survives. Prose
  // pins tolerate a line break; the owner's strings are quoted on one line.
  it('documents the one-field setup and the click-toggle settings', () => {
    for (const text of [
      'Postavke su prekidači: svaki klik odmah mijenja stanje; jedan okvir prema poslužitelju najviše svakih pet sekundi',
      '**Adresa ili stajalište**',
      '**Pokreni**',
      '„Na zaslonu: Kvaternikov trg i 6 stajališta uokolo”',
      '„Na zaslonu: cijeli grad.”',
      '„Poslužitelj nije prihvatio mjesto. Odaberi ponovno.”',
    ]) expect(kiosk, text).toContain(text);
    for (const re of [/Dugi\s+pritisak\s+\(0,8\s+s\)/, /unutar\s+400\s+m/, /unutar\s+300\s+m/, /`screen-set`\s+verzije\s+2/, /`bad-place`/, /`bad-frame`/]) {
      expect(kiosk).toMatch(re);
    }
    for (const re of [/Pokreni\s+zaslon/, /1,5\s+s\b/, /\b250\s+m\b/, /\*\*Spremi\*\*/, /nespremljeni\s+unos/, /jednim\s+gumbom/, /zupčanik\s+u\s+zaglavlju\s+otvara/i]) {
      expect(kiosk).not.toMatch(re);
    }
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

// WP5 step 10 (22 Sep): the one §11 rewrite of the four product documents. Every
// retired phrase is matched whitespace-tolerant, so a line break inside it cannot
// hide it from the guard; the owner's strings are asserted as written.
describe('the §11 rewrite of PRODUCT.md, DESIGN.md, docs/kiosk.md and INTEGRATION.md', () => {
  const kiosk = read('docs/kiosk.md');
  const product = read('PRODUCT.md');
  const design = read('DESIGN.md');
  const integration = read('app/src/kiosk/INTEGRATION.md');

  it('docs/kiosk.md opens on the approved public screen and keeps the setup words', () => {
    for (const text of ['## Javni zaslon, odobreno 22. rujna 2026.', 'U blizini', 'Adresa ili stajalište', '„Skeniraj za 10 minuta grada.”', '„uvijek”']) {
      expect(kiosk, text).toContain(text);
    }
    expect(kiosk).toMatch(/Ništa\s+se\s+ne\s+izmišlja/);
    for (const re of [
      /svakih\s+8\s+sekundi/,
      /gumbom\s+za\s+zaustavljanje/,
      /Dodir\s+na\s+stajalište\s+otvara\s+istraživanje\s+grada/,
      /Radovi\s+u\s+gradu/,
      /Procjena\s+iz\s+ZET-ovih\s+podataka\s+o\s+vozilima;\s+ostalo\s+po\s+voznom\s+redu\./,
      /zupčanik/i,
      /tri\s+ploče/,
      /bez\s+dodira\s+vraća\s+prozor/,
      /zamrznuti\s+prikaz\s+i\s+dostupne\s+izvoze/,
      // D3/D4 facts: rows are inserted at their time (W-fix7), the first-tram row
      // follows the lines still to start (decision 27), the wall's footer is text.
      /novi\s+redak\s+ulazi\s+na\s+dnu/,
      /prvi\s+jutarnji\s+tramvaj\s+od\s+22\s+sata\s+dok\s+ne\s+krene/,
      /„Osnovno”,\s+koje\s+se\s+otvara/,
    ]) expect(kiosk).not.toMatch(re);
    for (const re of [/60\s+sekundi\s+pokazuje\s+ploču\s+tog\s+stajališta/, /Vozni\s+red/, /barem\s+jedan\s+ritam/]) {
      expect(kiosk).toMatch(re);
    }
  });

  it('PRODUCT.md dates the approval, marks what it superseded and records the deferred vision', () => {
    expect(product).toMatch(/On\s+22\s+September\s+2026\s+the\s+owner\s+approved\s+the\s+companion\s+round/);
    expect(product).toContain('Superseded 22 September 2026:');
    expect(product).toMatch(/"without\s+too\s+much\s+fuss"/);
    expect(product).toMatch(/remain\s+pinned\s+so\s+that\s+a\s+person\s+can\s+easily\s+walk\s+with\s+it/);
  });

  it('DESIGN.md states the "U blizini" wall and none of the retired rules', () => {
    expect(design).toContain('U blizini');
    for (const re of [
      /one\s+map-linked\s+highlight\s+held\s+for\s+20\s+seconds/,
      /geographic\s+clusters\s+use\s+a\s+distinct\s+plus-count\s+mark/,
      /frozen\s+attributed\s+exports/,
      /Touch\s+exploration\s+has\s+search/,
      /A\s+ZET\s+arrival\s+is\s+an\s+estimate\s+and\s+is\s+labelled\s+one/,
      /enters\s+at\s+the\s+bottom,\s+fades\s+in\s+once\s+and\s+takes\s+its\s+place/,
      /Otherwise\s+touch\s+opens\s+only\s+Osnovno/,
      /Phone\s+destinations\s+are\s+Sada,\s+Karta,\s+Događanja\s+and\s+Još/,
    ]) expect(design).not.toMatch(re);
    expect(design).toMatch(/Sada\s+·\s+Karta\s+·\s+Još/);
  });

  it('INTEGRATION.md names the catalogue adapter and none of the retired testids', () => {
    expect(integration).toContain('kiosk/strings.ts');
    for (const re of [/kiosk-ticker/, /kiosk-lastrun/, /strings-hr\.ts/, /strings-en\.ts/]) expect(integration).not.toMatch(re);
    expect(integration).toContain('[data-testid=stop-board]');
  });

  // §16.8 and WP5 §0 ruling 3: the owner reads every new or changed Croatian
  // string before it ships, and that read-through is the last row of the
  // manual checklist in docs/kaj-verification.md.
  it('ends the manual checklist with the owner\u2019s read-through of the Croatian copy', () => {
    const verification = read('docs/kaj-verification.md');
    const start = verification.indexOf('### Ručne provjere na uređaju');
    expect(start, 'the manual checklist heading').toBeGreaterThan(-1);
    const next = verification.indexOf(NL + '#', start + 1);
    const section = verification.slice(start, next === -1 ? undefined : next);
    const rows = section.split(NL).filter((line) => /^\| R\d+ \|/.test(line));
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[rows.length - 1]).toMatch(/vlasnik\s+čita\s+svaki\s+novi\s+ili\s+promijenjeni\s+hrvatski\s+tekst/);
  });

  it.each([
    ['PRODUCT.md', product], ['DESIGN.md', design], ['docs/kiosk.md', kiosk], ['app/src/kiosk/INTEGRATION.md', integration],
  ])('%s: never "zid", no em dash, no ellipsis character', (name, text) => {
    expect(text, name).not.toMatch(/(?<![\p{L}\p{N}_])zid/iu);
    expect(text, name).not.toContain('—');
    expect(text, name).not.toContain('…');
  });
});
