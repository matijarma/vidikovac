// Podaci i izvori (app/src/snimka/open.ts, decision V3-24): file sizes in
// words; the downloads as the manifest lists them, one link per file (the
// stable alias, the file name visible), the three primary files first and
// the other six in a disclosure with the catalogue, reproducibility and
// citation lines; the three sentences instead of the signals table; and the
// sources' pure builders the entry uses: the attribution as one <dl> from the
// manifest, the notes once each.
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { SNIMKA_API } from '../../shared/snimka';
import { attributionHtml, downloadsOf, mountOpen, notesHtml, notesOf, shortCommit, sizeWords, type SourceEntry } from '../../app/src/snimka/open';
import type { SnimkaContext } from '../../app/src/snimka/context';
import { buildSnimkaFixture } from '../../e2e/snimka-fixtures';

describe('sizeWords', () => {
  it('kilobytes under a megabyte, never 0 kB for a file with bytes; one decimal under ten megabytes', () => {
    expect(sizeWords(0)).toBe('0 kB');
    expect(sizeWords(1)).toBe('1 kB');
    expect(sizeWords(499)).toBe('1 kB');
    expect(sizeWords(1500)).toBe('2 kB');
    expect(sizeWords(812_345)).toBe('812 kB');
    expect(sizeWords(999_400)).toBe('999 kB');
    expect(sizeWords(999_999)).toBe('1,0 MB');
    expect(sizeWords(1_000_000)).toBe('1,0 MB');
    expect(sizeWords(1_449_000)).toBe('1,4 MB');
    expect(sizeWords(9_960_000)).toBe('10,0 MB');
    expect(sizeWords(12_600_000)).toBe('13 MB');
  });
  it('a size that is not a number is no size', () => {
    expect(sizeWords(Number.NaN)).toBe('bez podatka');
    expect(sizeWords(-1)).toBe('bez podatka');
  });
});

const doc = (): Document => new Window({ url: 'http://localhost/snimka/' }).document as unknown as Document;

describe('downloadsOf', () => {
  const { manifest } = buildSnimkaFixture();
  const downloads = downloadsOf(manifest);
  it('the three primary files first with their own titles, then the other six in the manifest\'s order', () => {
    expect(downloads.map((d) => d.name)).toEqual(['series', 'routes-5min', 'bikes-5min', 'hourly', 'stations', 'sentences', 'events', 'closures', 'opis']);
    expect(downloads.filter((d) => d.primary).map((d) => d.title)).toEqual(['Stanje usluge i vozila po minuti', 'Vozila po liniji svakih pet minuta', 'Bicikli po stanici svakih pet minuta']);
    expect(downloads.filter((d) => !d.primary)).toHaveLength(6);
  });
  it('one stable alias per file, the file name, the format by name (never GEOJSON) and the size in kB', () => {
    for (const d of downloads) {
      const ref = manifest.files.exports.find((e) => e.name === d.name)!;
      expect(d.href).toBe(`${SNIMKA_API}exports/latest/${ref.name}.${ref.format}`);
      expect(d.file).toBe(`${ref.name}.${ref.format}`);
      expect(d.size).toBe(sizeWords(ref.bytes));
      expect(d.size).toMatch(/^\d+ kB$/);
    }
    expect(downloads.find((d) => d.name === 'closures')!.format).toBe('GeoJSON');
    expect(downloads.find((d) => d.name === 'series')!.format).toBe('CSV');
    expect(downloads.find((d) => d.name === 'events')!.format).toBe('JSON');
  });
});

describe('the section', () => {
  it('three sentences, three downloads and six in a disclosure, each one link, with the catalogue, the commit and the citation', () => {
    const d = doc();
    const root = d.createElement('div');
    root.setAttribute('aria-busy', 'true');
    const { manifest } = buildSnimkaFixture();
    manifest.build.commit = '0123456789abcdef0123456789abcdef01234567';
    const off = mountOpen({ manifest, doc: d } as unknown as SnimkaContext, root as unknown as HTMLElement);
    expect(root.hasAttribute('aria-busy')).toBe(false);
    expect(root.querySelector('table')).toBeNull();
    const says = [...root.querySelectorAll('.sn-open-says li')].map((li) => li.textContent);
    expect(says).toHaveLength(3);
    expect(says[0]).toMatch(/^ZET objavljuje položaje vozila/);
    const primary = root.querySelectorAll('[data-sn="downloads"] li');
    expect(primary).toHaveLength(3);
    const details = root.querySelector('details.sn-open-others')!;
    expect(details.querySelector('summary')!.textContent).toBe('Ostale datoteke (6)');
    expect(details.querySelectorAll('[data-sn="downloads-other"] li')).toHaveLength(6);
    for (const li of root.querySelectorAll('.sn-open-item')) {
      const links = li.querySelectorAll('a');
      expect(links).toHaveLength(1);
      expect(links[0]!.getAttribute('href')).toMatch(/^\/api\/snimka\/v2\/exports\/latest\/[a-z0-9-]+\.(csv|json|geojson)$/);
    }
    const first = primary[0]!.querySelector('a')!;
    expect(first.getAttribute('download')).toBe('series.csv');
    expect(first.textContent).toBe(`Stanje usluge i vozila po minuti${'series.csv'} · CSV, ${sizeWords(manifest.files.exports[0]!.bytes)}`);
    expect(root.querySelector('[data-export="closures"] .sn-open-note')!.textContent).toMatch(/^29 zatvora s krajem 30\. 9\./);
    const hrefs = [...details.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/open/catalog.json');
    expect(hrefs).toContain('https://github.com/matijarma/vidikovac/commit/0123456789abcdef0123456789abcdef01234567');
    expect(hrefs).toContain('https://github.com/matijarma/vidikovac/blob/main/docs/snimka-2026-10.md');
    expect(details.querySelector('[data-sn="repro"]')!.textContent).toContain('npm run build:snimka iz inačice koda 0123456789ab');
    expect(details.textContent).toContain('Kako navesti: „Kaj ima? · Snimka, zagreb.aningfilm.hr/snimka/”, Otvorena dozvola.');
    expect(root.textContent).toContain('Nema u preuzimanjima');
    off();
  });
  it('shortCommit keeps a non-hash as it is', () => {
    expect(shortCommit('fixture')).toBe('fixture');
    expect(shortCommit('a'.repeat(40))).toBe('a'.repeat(12));
  });
});

describe('the sources', () => {
  const COURT: SourceEntry = { id: 'court', text: 'Županijski sud u Zagrebu: dvije odluke', url: 'https://example.org/sud', licence: 'službeni dokument', adaptation: null };
  it('one dl from the manifest: the short name, the text and adaptation, the licence and a separate source link', () => {
    const { manifest } = buildSnimkaFixture();
    const d = doc();
    const root = d.createElement('div');
    root.innerHTML = attributionHtml([...manifest.attribution, COURT]);
    const dl = root.querySelector('dl.sn-attr')!;
    expect([...dl.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual(['ZET · GTFS-RT', 'ZET · obavijesti', 'nextbike (BAJS)', 'Grad Zagreb', 'DHMZ', 'Jutarnji, Večernji, N1', 'OpenStreetMap', 'Kaj ima?', 'Županijski sud']);
    const zet = dl.querySelector('[data-source="zet"]')!;
    expect(zet.querySelector('q[lang="en"]')!.textContent).toBe(manifest.attribution[0]!.text);
    expect(zet.querySelector('.sn-attr-verbatim')!.textContent).toBe('atribucija doslovno:');
    expect(zet.querySelector('.sn-attr-adaptation')!.textContent).toBe(manifest.attribution[0]!.adaptation);
    expect(zet.querySelector('.sn-attr-licence')!.textContent).toBe('Open license');
    const link = zet.querySelector('a.sn-attr-link')!;
    expect(link.getAttribute('href')).toBe(manifest.attribution[0]!.url);
    expect(link.textContent).toBe('izvor: ZET · GTFS-RT ↗');
    // A source without a link has none (the press list).
    expect(dl.querySelector('[data-source="news"] a')).toBeNull();
    expect(dl.querySelectorAll('.sn-attr-item')).toHaveLength(9);
  });
  it('the notes once each, the comparison days\' notes included, in a disclosure open only when asked', () => {
    const { manifest } = buildSnimkaFixture();
    manifest.notes.push(manifest.comparisons[0]!.notes[0]!);
    const notes = notesOf(manifest);
    expect(notes).toHaveLength(manifest.notes.length - 1 + manifest.comparisons.length);
    expect(new Set(notes).size).toBe(notes.length);
    const d = doc();
    const root = d.createElement('div');
    root.innerHTML = notesHtml(notes, true);
    expect(root.querySelector('details')!.hasAttribute('open')).toBe(true);
    expect(root.querySelector('summary')!.textContent).toBe(`Napomene uz podatke (${notes.length})`);
    expect(root.querySelectorAll('li')).toHaveLength(notes.length);
    root.innerHTML = notesHtml(notes, false);
    expect(root.querySelector('details')!.hasAttribute('open')).toBe(false);
    expect(notesHtml([], true)).toBe('');
  });
});
