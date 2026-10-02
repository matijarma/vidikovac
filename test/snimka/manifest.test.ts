// decodeManifest accepts a contract-exact v2 manifest and rejects what the page
// must never trust: a version other than 2, a window or comparison that is
// not the constants', a missing file key, a board without its stop, an
// export whose name does not end in its format, a path that is absolute or
// climbs, and a ref whose name does not carry its own hash.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentTypeOf } from '../../scripts/snimka/stage-manifest';
import { SNIMKA_COMPARISONS, SNIMKA_WINDOW, type BoardRef, type ExportRef, type HashedRef, type SnimkaManifest } from '../../shared/snimka';
import { SnimkaError, checkRefPath, contentPath, decodeManifest, type ContentExt } from '../../shared/snimka-codec';

const sha = (seed: string): string => {
  // A deterministic 64-hex string per name; the test needs a stable hash, not a real one.
  let out = '';
  let s = 0;
  for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  while (out.length < 64) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += s.toString(16).padStart(8, '0');
  }
  return out.slice(0, 64);
};
const ref = (name: string, ext: ContentExt = 'json', bytes = 1234): HashedRef => {
  const h = sha(name);
  return { path: contentPath(name, h, ext), bytes, sha256: h };
};
const board = (stop: string, name: string): BoardRef => ({ ...ref(`boards/${stop}`), stop, name, samples: 1344 });
const exp = (name: string, format: ExportRef['format'], title: string, rows: number | null): ExportRef => ({
  ...ref(`exports/${name}`, format), name, format, mediaType: format === 'csv' ? 'text/csv' : format === 'json' ? 'application/json' : 'application/geo+json', title, rows,
});

export function sample(): SnimkaManifest {
  return {
    version: 2,
    builtAt: '2026-10-02T15:00:00.000Z',
    title: 'Tri dana bez tramvaja',
    build: { commit: '7b0f00d0', inputs: { frames: 'abc', series: 'def' } },
    window: { ...SNIMKA_WINDOW, tz: 'Europe/Zagreb', utcOffsetMin: 120 },
    comparisons: SNIMKA_COMPARISONS.map((c) => ({ ...c, files: { series: ref(`series/day-${c.id}`), routes: ref(`routes/day-${c.id}`) }, notes: [] })),
    serviceLiveFromSec: 1790716620,
    networks: {
      '395': { ...ref('networks/zet-network-000395'), feedVersion: '000395', graphHash: '7ad4834435980e22', paths: 120, shapes: 300 },
      '396': { ...ref('networks/zet-network-000396'), feedVersion: '000396', graphHash: 'b0ac946be55f8f79', paths: 121, shapes: 301 },
    },
    files: {
      series: ref('series'),
      motionIndex: ref('motion/index'),
      routes: ref('routes/window'),
      stations: ref('stations'),
      bajs: ref('bajs'),
      closures: ref('closures'),
      events: ref('events'),
      notices: ref('notices'),
      news: ref('news'),
      places: ref('places'),
      screenIndex: ref('screen/index'),
      boards: [board('106_1', 'Trg bana J. Jelačića'), board('109_1', 'Glavni kolodvor')],
      voiceIndex: ref('voice/index'),
      exports: [exp('series', 'csv', 'Stanje usluge po minuti', 6721), exp('events', 'json', 'Događaji', null), exp('closures', 'geojson', 'Zatvorene ulice', null)],
      opis: ref('exports/opis'),
      grid: null,
    },
    attribution: [
      { id: 'zet', text: 'Public dataset by ZET provided under Open license', url: 'http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669', licence: 'Open license', adaptation: 'položaji vozila izvedeni modelom kretanja iz snimljenih podataka' },
      { id: 'court', text: 'Županijski sud u Zagrebu: rješenja o štrajku od 30. rujna 2026.', url: 'https://n1info.hr/vijesti/strajk-zet-odluka-suda-o-zakonitosti-30-09-2026/', licence: 'javna objava', adaptation: null },
      { id: 'osm', text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL', adaptation: null },
    ],
    notes: ['Minutne serije počinju 27. rujna u 22:07.'],
  };
}

const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(sample())) as Record<string, unknown>;
const files = (raw: Record<string, unknown>): Record<string, unknown> => raw.files as Record<string, unknown>;

describe('decodeManifest', () => {
  it('accepts a contract-exact manifest, extra fields included, and returns it unchanged', () => {
    const raw = { ...clone(), extra: { anything: true } };
    const m = decodeManifest(raw);
    expect(m).toBe(raw);
    expect(m.files.series.path).toMatch(/^series\.[0-9a-f]{16}\.json$/);
    expect(m.files.grid).toBeNull();
    expect(m.comparisons.map((c) => c.id)).toEqual(['cet-0924', 'pon-0921']);
    expect(m.files.exports[0]!.path).toMatch(/\.csv$/);
  });

  it('rejects a version other than 2, version 1 first of all', () => {
    for (const version of [1, 0, 3, '2', undefined, null]) {
      const raw = clone();
      raw.version = version;
      expect(() => decodeManifest(raw), String(version)).toThrow(SnimkaError);
    }
    expect(() => decodeManifest(null)).toThrow(SnimkaError);
    expect(() => decodeManifest('manifest')).toThrow(SnimkaError);
  });

  it('rejects a window that is not SNIMKA_WINDOW', () => {
    for (const mutate of [
      (w: Record<string, unknown>): void => { w.minutes = 5040; },
      (w: Record<string, unknown>): void => { w.toSec = 1790834400; },
      (w: Record<string, unknown>): void => { w.fromSec = (w.fromSec as number) + 60; },
      (w: Record<string, unknown>): void => { w.tz = 'UTC'; },
    ]) {
      const raw = clone();
      mutate(raw.window as Record<string, unknown>);
      expect(() => decodeManifest(raw)).toThrow(SnimkaError);
    }
  });

  it('rejects comparisons out of order, with a wrong day, a missing ref or a missing notes list', () => {
    const swapped = clone();
    (swapped.comparisons as unknown[]).reverse();
    expect(() => decodeManifest(swapped)).toThrow(SnimkaError);
    const day = clone();
    (day.comparisons as Record<string, unknown>[])[0]!.day = '2026-09-25';
    expect(() => decodeManifest(day)).toThrow(SnimkaError);
    const from = clone();
    (from.comparisons as Record<string, unknown>[])[1]!.fromSec = SNIMKA_COMPARISONS[0].fromSec;
    expect(() => decodeManifest(from)).toThrow(SnimkaError);
    const one = clone();
    (one.comparisons as unknown[]).pop();
    expect(() => decodeManifest(one)).toThrow(SnimkaError);
    const noRoutes = clone();
    delete ((noRoutes.comparisons as Record<string, unknown>[])[0]!.files as Record<string, unknown>).routes;
    expect(() => decodeManifest(noRoutes)).toThrow(SnimkaError);
    const noNotes = clone();
    delete (noNotes.comparisons as Record<string, unknown>[])[1]!.notes;
    expect(() => decodeManifest(noNotes)).toThrow(SnimkaError);
    const legacy = clone();
    delete legacy.comparisons;
    legacy.comparison = { ...SNIMKA_COMPARISONS[0] };
    expect(() => decodeManifest(legacy)).toThrow(SnimkaError);
  });

  it('rejects a missing files key, a grid that is not null, a board without its stop and an export with a wrong extension', () => {
    for (const key of ['series', 'motionIndex', 'routes', 'stations', 'bajs', 'closures', 'events', 'notices', 'news', 'places', 'screenIndex', 'boards', 'voiceIndex', 'exports', 'opis']) {
      const raw = clone();
      delete files(raw)[key];
      expect(() => decodeManifest(raw), key).toThrow(SnimkaError);
    }
    const grid = clone();
    files(grid).grid = ref('grid');
    expect(() => decodeManifest(grid)).toThrow(SnimkaError);
    const noStop = clone();
    delete (files(noStop).boards as Record<string, unknown>[])[0]!.stop;
    expect(() => decodeManifest(noStop)).toThrow(SnimkaError);
    const noSamples = clone();
    (files(noSamples).boards as Record<string, unknown>[])[1]!.samples = '1344';
    expect(() => decodeManifest(noSamples)).toThrow(SnimkaError);
    const badExt = clone();
    const e = (files(badExt).exports as Record<string, unknown>[])[0]!;
    e.path = (e.path as string).replace(/\.csv$/, '.json');
    expect(() => decodeManifest(badExt)).toThrow(SnimkaError);
    const badFormat = clone();
    (files(badFormat).exports as Record<string, unknown>[])[1]!.format = 'xlsx';
    expect(() => decodeManifest(badFormat)).toThrow(SnimkaError);
    const badType = clone();
    (files(badType).exports as Record<string, unknown>[])[2]!.mediaType = 'text/plain';
    expect(() => decodeManifest(badType)).toThrow(SnimkaError);
    const noTitle = clone();
    delete (files(noTitle).exports as Record<string, unknown>[])[0]!.title;
    expect(() => decodeManifest(noTitle)).toThrow(SnimkaError);
    // An empty boards list and an empty exports list are shapes, not errors.
    const empty = clone();
    files(empty).boards = [];
    files(empty).exports = [];
    expect(() => decodeManifest(empty)).not.toThrow();
  });

  it('rejects a path that is absolute or contains ..', () => {
    const cases: ((f: Record<string, HashedRef>) => void)[] = [
      (f) => { f.series = { ...f.series!, path: `/${f.series!.path}` }; },
      (f) => { f.series = { ...f.series!, path: `../${f.series!.path}` }; },
      (f) => { f.bajs = { ...f.bajs!, path: `objects/../${f.bajs!.path}` }; },
      (f) => { f.news = { ...f.news!, path: `https://example.org/${f.news!.path}` }; },
      (f) => { f.events = { ...f.events!, path: `a\\${f.events!.path}` }; },
      (f) => { f.events = { ...f.events!, path: `a//${f.events!.path}` }; },
    ];
    for (const [i, mutate] of cases.entries()) {
      const raw = clone();
      mutate(files(raw) as Record<string, HashedRef>);
      expect(() => decodeManifest(raw), `case ${i}`).toThrow(SnimkaError);
    }
    const nets = clone();
    const n = (nets.networks as Record<string, HashedRef>)['396']!;
    n.path = `/${n.path}`;
    expect(() => decodeManifest(nets)).toThrow(SnimkaError);
    const boardPath = clone();
    const b = (files(boardPath).boards as HashedRef[])[0]!;
    b.path = `/${b.path}`;
    expect(() => decodeManifest(boardPath)).toThrow(SnimkaError);
  });

  it('rejects a ref whose path does not carry the first 16 hex of its sha256', () => {
    const raw = clone();
    const f = files(raw) as Record<string, HashedRef>;
    f.series = { ...f.series!, sha256: sha('something-else') };
    expect(() => decodeManifest(raw)).toThrow(SnimkaError);
    const renamed = clone();
    const f2 = files(renamed) as Record<string, HashedRef>;
    f2.closures = { ...f2.closures!, path: 'closures.json' };
    expect(() => decodeManifest(renamed)).toThrow(SnimkaError);
    const short = clone();
    const f3 = files(short) as Record<string, HashedRef>;
    f3.notices = { ...f3.notices!, sha256: f3.notices!.sha256.slice(0, 40) };
    expect(() => decodeManifest(short)).toThrow(SnimkaError);
    const exportHash = clone();
    const e = (files(exportHash).exports as HashedRef[])[0]!;
    e.sha256 = sha('another');
    expect(() => decodeManifest(exportHash)).toThrow(SnimkaError);
    // The check itself, for callers that validate refs inside other files (the screen index, the voice index).
    expect(() => checkRefPath(ref('screen/run-mon-0745'), 'test')).not.toThrow();
    expect(() => checkRefPath(ref('exports/series', 'csv'), 'test')).not.toThrow();
    expect(() => checkRefPath(ref('exports/closures', 'geojson'), 'test')).not.toThrow();
    expect(() => checkRefPath({ ...ref('x'), path: 'x.0000000000000000.json' }, 'test')).toThrow(SnimkaError);
    expect(() => checkRefPath({ ...ref('x'), path: `x.${sha('x').slice(0, 16)}.txt` }, 'test')).toThrow(SnimkaError);
  });

  it('v3: accepts the court attribution (Županijski sud u Zagrebu, javna objava) and keeps the ZET sentence first', () => {
    const m = decodeManifest(clone());
    const court = m.attribution.find((x) => x.id === 'court')!;
    expect(court).toMatchObject({ licence: 'javna objava', adaptation: null });
    expect(court.text).toContain('Županijski sud u Zagrebu');
    expect(m.attribution[0]!.id).toBe('zet');
  });

  it('rejects a malformed attribution and a malformed notes list', () => {
    const a = clone();
    (a.attribution as Record<string, unknown>[])[0]!.id = 'hrt';
    expect(() => decodeManifest(a)).toThrow(SnimkaError);
    const n = clone();
    n.notes = [1];
    expect(() => decodeManifest(n)).toThrow(SnimkaError);
  });
});

describe('the built v2 manifest (test/fixtures/snimka/manifest.sample.json, re-cut from the real build)', () => {
  const built = decodeManifest(JSON.parse(readFileSync('test/fixtures/snimka/manifest.sample.json', 'utf8')) as unknown);

  it('decodes, names every comparison\'s files and notes, and says the plan\'s caveats', () => {
    expect(built.version).toBe(2);
    for (const c of built.comparisons) {
      expect(c.files.routes.path).toMatch(/^routes\/day-09(24|21)\.[0-9a-f]{16}\.json$/);
      expect(c.notes.length).toBeGreaterThan(0);
    }
    const notes = built.notes.join(' ');
    expect(notes).toContain('petak 2. listopada u 12:00');
    expect(notes).toContain('dva okvira');
    expect(notes).toContain('od ponoći do 02:00');
    expect(notes).toContain('predložaka');
    expect(notes).toContain('spremište');
  });

  it('lists the routes, places, voice index and opis as hashed json refs, every export under exports/', () => {
    for (const ref of [built.files.routes, built.files.places, built.files.voiceIndex, built.files.opis]) expect(ref.path).toMatch(/\.[0-9a-f]{16}\.json$/);
    for (const e of built.files.exports) expect(e.path.startsWith(`exports/${e.name}.`)).toBe(true);
    expect(built.files.exports.find((e) => e.name === 'series')!.rows).toBe(6721);
  });

  it('gives every uploaded object its content type by extension', () => {
    expect(contentTypeOf('exports/series.0123456789abcdef.csv')).toBe('text/csv; charset=utf-8');
    expect(contentTypeOf('exports/closures.0123456789abcdef.geojson')).toBe('application/geo+json');
    expect(contentTypeOf('screen/0928-0745-kiosk.0123456789abcdef.webp')).toBe('image/webp');
    expect(contentTypeOf('manifest.json')).toBe('application/json');
    expect(() => contentTypeOf('x.0123456789abcdef.txt')).toThrow();
  });
});
