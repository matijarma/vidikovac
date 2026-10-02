// Otvoreni podaci (app/src/snimka/open.ts): file sizes in words, the
// downloads exactly as the manifest lists them (a hashed link and the stable
// alias, never a hash written in the page), the signals table and the
// reproducibility line with the manifest's commit.
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { SNIMKA_API } from '../../shared/snimka';
import { downloadsOf, mountOpen, shortCommit, signalRows, sizeWords } from '../../app/src/snimka/open';
import type { SnimkaContext } from '../../app/src/snimka/context';
import { buildSnimkaFixture } from '../../e2e/snimka-fixtures';

describe('sizeWords', () => {
  it('kilobytes under a megabyte, never 0 KB for a file with bytes; one decimal under ten megabytes', () => {
    expect(sizeWords(0)).toBe('0 KB');
    expect(sizeWords(1)).toBe('1 KB');
    expect(sizeWords(499)).toBe('1 KB');
    expect(sizeWords(1500)).toBe('2 KB');
    expect(sizeWords(812_345)).toBe('812 KB');
    expect(sizeWords(999_400)).toBe('999 KB');
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

describe('downloadsOf', () => {
  const { manifest } = buildSnimkaFixture();
  const downloads = downloadsOf(manifest);
  it('lists the nine exports of the manifest in its order, with the hashed path and the stable alias', () => {
    expect(downloads.map((d) => d.name)).toEqual(['series', 'hourly', 'routes-5min', 'bikes-5min', 'stations', 'sentences', 'events', 'closures', 'opis']);
    manifest.files.exports.forEach((ref, i) => {
      const d = downloads[i]!;
      expect(d.href).toBe(`${SNIMKA_API}${ref.path}`);
      expect(d.latest).toBe(`${SNIMKA_API}exports/latest/${ref.name}.${ref.format}`);
      expect(d.text).toBe(`${ref.title} (${ref.format.toUpperCase()}, ${sizeWords(ref.bytes)})`);
    });
  });
  it('says the rows with their Croatian forms, and nothing for a file without rows', () => {
    expect(downloads[0]!.rows).toBe('3 retka');
    expect(downloads[1]!.rows).toBe('1 redak');
    expect(downloads.find((d) => d.name === 'events')!.rows).toBeNull();
  });
});

describe('the section', () => {
  it('draws the six signals, the nine downloads, the catalogue links and the commit, from the manifest alone', () => {
    const win = new Window({ url: 'http://localhost/snimka/' });
    const doc = win.document as unknown as Document;
    const root = doc.createElement('div');
    root.setAttribute('aria-busy', 'true');
    const { manifest } = buildSnimkaFixture();
    manifest.build.commit = '0123456789abcdef0123456789abcdef01234567';
    const off = mountOpen({ manifest, doc } as unknown as SnimkaContext, root as unknown as HTMLElement);
    expect(root.hasAttribute('aria-busy')).toBe(false);
    expect(root.querySelectorAll('.sn-open-signals tbody tr')).toHaveLength(signalRows().length);
    expect(signalRows()).toHaveLength(6);
    const items = root.querySelectorAll('[data-sn="downloads"] li');
    expect(items).toHaveLength(9);
    const first = items[0]!.querySelector('a.sn-open-file')!;
    expect(first.getAttribute('href')).toBe(`${SNIMKA_API}${manifest.files.exports[0]!.path}`);
    expect(first.hasAttribute('download')).toBe(true);
    expect(items[0]!.querySelector('a.sn-open-latest')!.getAttribute('href')).toBe('/api/snimka/v2/exports/latest/series.csv');
    const hrefs = [...root.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/open/catalog.json');
    expect(hrefs).toContain('/open/#snimka-2026-09');
    expect(root.querySelector('[data-sn="repro"]')!.textContent).toContain('npm run build:snimka na predaji 0123456789ab');
    expect(hrefs).toContain('https://github.com/matijarma/vidikovac/commit/0123456789abcdef0123456789abcdef01234567');
    expect(root.textContent).toContain('Otvorena dozvola, uz navođenje izvora');
    expect(root.textContent).toContain('Nisu u preuzimanjima');
    off();
  });
  it('shortCommit keeps a non-hash as it is', () => {
    expect(shortCommit('fixture')).toBe('fixture');
    expect(shortCommit('a'.repeat(40))).toBe('a'.repeat(12));
  });
});
