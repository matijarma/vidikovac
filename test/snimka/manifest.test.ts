// decodeManifest accepts a contract-exact manifest and rejects the three
// things the page must never trust: a version other than 1, a path that is
// absolute or climbs, and a ref whose name does not carry its own hash.
import { describe, expect, it } from 'vitest';
import { SNIMKA_COMPARISON, SNIMKA_WINDOW, type HashedRef, type SnimkaManifest } from '../../shared/snimka';
import { SnimkaError, checkRefPath, contentPath, decodeManifest } from '../../shared/snimka-codec';

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
const ref = (name: string, ext: 'json' | 'webp' = 'json', bytes = 1234): HashedRef => {
  const h = sha(name);
  return { path: contentPath(name, h, ext), bytes, sha256: h };
};

function sample(): SnimkaManifest {
  return {
    version: 1,
    builtAt: '2026-10-01T18:00:00.000Z',
    title: 'Tri dana bez tramvaja',
    build: { commit: 'f924e64f', inputs: { frames: 'abc', series: 'def' } },
    window: { ...SNIMKA_WINDOW, tz: 'Europe/Zagreb', utcOffsetMin: 120 },
    comparison: { ...SNIMKA_COMPARISON },
    serviceLiveFromSec: 1790716620,
    networks: {
      '395': { ...ref('networks/zet-network-000395'), feedVersion: '000395', graphHash: '7ad4834435980e22', paths: 120, shapes: 300 },
      '396': { ...ref('networks/zet-network-000396'), feedVersion: '000396', graphHash: 'b0ac946be55f8f79', paths: 121, shapes: 301 },
    },
    files: {
      series: ref('series'),
      comparisonSeries: ref('series-2026-09-24'),
      motionIndex: ref('motion/index'),
      stations: ref('stations'),
      bajs: ref('bajs'),
      closures: ref('closures'),
      events: ref('events'),
      notices: ref('notices'),
      news: ref('news'),
      screenIndex: ref('screen/index'),
      board106: ref('board-106-1'),
      grid: null,
    },
    attribution: [
      { id: 'zet', text: 'Public dataset by ZET provided under Open license', url: 'http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669', licence: 'Open license', adaptation: 'položaji vozila izvedeni modelom kretanja iz snimljenih podataka' },
      { id: 'osm', text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL', adaptation: null },
    ],
    notes: ['Minutne serije počinju 27. rujna u 22:07.'],
  };
}

const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(sample())) as Record<string, unknown>;

describe('decodeManifest', () => {
  it('accepts a contract-exact manifest, extra fields included, and returns it unchanged', () => {
    const raw = { ...clone(), extra: { anything: true } };
    const m = decodeManifest(raw);
    expect(m).toBe(raw);
    expect(m.files.series.path).toMatch(/^series\.[0-9a-f]{16}\.json$/);
    expect(m.files.grid).toBeNull();
    const grid = clone();
    (grid.files as Record<string, unknown>).grid = ref('grid');
    expect(decodeManifest(grid).files.grid).not.toBeNull();
  });

  it('rejects a version other than 1', () => {
    for (const version of [0, 2, '1', undefined, null]) {
      const raw = clone();
      raw.version = version;
      expect(() => decodeManifest(raw), String(version)).toThrow(SnimkaError);
    }
    expect(() => decodeManifest(null)).toThrow(SnimkaError);
    expect(() => decodeManifest('manifest')).toThrow(SnimkaError);
  });

  it('rejects a path that is absolute or contains ..', () => {
    const cases: ((files: Record<string, HashedRef>) => void)[] = [
      (files) => { files.series = { ...files.series!, path: `/${files.series!.path}` }; },
      (files) => { files.series = { ...files.series!, path: `../${files.series!.path}` }; },
      (files) => { files.bajs = { ...files.bajs!, path: `objects/../${files.bajs!.path}` }; },
      (files) => { files.news = { ...files.news!, path: `https://example.org/${files.news!.path}` }; },
      (files) => { files.events = { ...files.events!, path: `a\\${files.events!.path}` }; },
      (files) => { files.events = { ...files.events!, path: `a//${files.events!.path}` }; },
    ];
    for (const [i, mutate] of cases.entries()) {
      const raw = clone();
      mutate(raw.files as Record<string, HashedRef>);
      expect(() => decodeManifest(raw), `case ${i}`).toThrow(SnimkaError);
    }
    const nets = clone();
    const n = (nets.networks as Record<string, HashedRef>)['396']!;
    n.path = `/${n.path}`;
    expect(() => decodeManifest(nets)).toThrow(SnimkaError);
  });

  it('rejects a ref whose path does not carry the first 16 hex of its sha256', () => {
    const raw = clone();
    const files = raw.files as Record<string, HashedRef>;
    files.series = { ...files.series!, sha256: sha('something-else') };
    expect(() => decodeManifest(raw)).toThrow(SnimkaError);
    const renamed = clone();
    const f2 = renamed.files as Record<string, HashedRef>;
    f2.closures = { ...f2.closures!, path: 'closures.json' };
    expect(() => decodeManifest(renamed)).toThrow(SnimkaError);
    const short = clone();
    const f3 = short.files as Record<string, HashedRef>;
    f3.notices = { ...f3.notices!, sha256: f3.notices!.sha256.slice(0, 40) };
    expect(() => decodeManifest(short)).toThrow(SnimkaError);
    // The check itself, for callers that validate refs inside other files (the screen index, the motion index).
    expect(() => checkRefPath(ref('screen/run-mon-0745'), 'test')).not.toThrow();
    expect(() => checkRefPath({ ...ref('x'), path: 'x.0000000000000000.json' }, 'test')).toThrow(SnimkaError);
  });

  it('rejects a window or comparison that differs from the constants and a malformed attribution', () => {
    const w = clone();
    (w.window as Record<string, unknown>).minutes = 3600;
    expect(() => decodeManifest(w)).toThrow(SnimkaError);
    const c = clone();
    (c.comparison as Record<string, unknown>).day = '2026-09-25';
    expect(() => decodeManifest(c)).toThrow(SnimkaError);
    const a = clone();
    (a.attribution as Record<string, unknown>[])[0]!.id = 'hrt';
    expect(() => decodeManifest(a)).toThrow(SnimkaError);
    const missing = clone();
    delete (missing.files as Record<string, unknown>).board106;
    expect(() => decodeManifest(missing)).toThrow(SnimkaError);
  });
});
