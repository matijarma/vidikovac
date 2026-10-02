// The committed sample of the /snimka/ dataset (test/fixtures/snimka/, cut by
// scripts/snimka/fixture-cut.mjs): one motion chunk of the first strike
// morning and a manifest in the v2 shape (hand-updated on 2 October 2026
// until the v2 build is re-cut). A deviation fixture of the ZET strike,
// never a normal day.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeNetwork } from '../../shared/motion/network';
import { MOTION_CHUNK_S, MOTION_TICKS, SNIMKA_COMPARISONS, SNIMKA_WINDOW } from '../../shared/snimka';
import { decodeManifest, decodeMotionChunk, expandVehicle, samplesAt } from '../../shared/snimka-codec';

const DIR = 'test/fixtures/snimka';
const files = readdirSync(DIR);
const chunkName = files.find((f) => /^motion-396-\d{8}-\d{4}\.[0-9a-f]{16}\.json$/.test(f));

describe('the committed snimka fixture', () => {
  it('is one labelled chunk, a sample manifest and a README, under 20,000 bytes in all', () => {
    expect(chunkName).toBeDefined();
    expect(files.sort()).toEqual(['README.md', chunkName!, 'manifest.sample.json'].sort());
    const total = files.reduce((sum, f) => sum + readFileSync(join(DIR, f)).length, 0);
    expect(total).toBeLessThan(20_000);
    const readme = readFileSync(join(DIR, 'README.md'), 'utf8');
    expect(readme.split('\n')[0]).toMatch(/^Deviation fixture: the ZET general strike of 28 to 30 September 2026\./);
    expect(readme).toContain('Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669');
  });

  it('names the chunk by the first 16 hex of its sha256 and decodes it with decodeMotionChunk', () => {
    const bytes = readFileSync(join(DIR, chunkName!));
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(chunkName).toContain(`.${hash.slice(0, 16)}.json`);
    const chunk = decodeMotionChunk(JSON.parse(bytes.toString('utf8')) as unknown);
    expect(chunk.net).toBe('396');
    expect(chunk.t0 % MOTION_CHUNK_S).toBe(0);
    expect(chunk.t0).toBeGreaterThanOrEqual(SNIMKA_WINDOW.fromSec);
    expect(chunk.t0).toBeLessThan(SNIMKA_WINDOW.toSec);
    // Monday 28 September 07:30 Zagreb: the strike morning, a handful of vehicles, never a full fleet.
    expect(new Date((chunk.t0 + 7200) * 1000).toISOString().slice(0, 16)).toBe('2026-09-28T07:30');
    expect(chunk.vehicles.length).toBeGreaterThan(0);
    expect(chunk.vehicles.length).toBeLessThan(20);
    for (let tick = 0; tick < MOTION_TICKS; tick++) expect(samplesAt(chunk, tick).length).toBeLessThanOrEqual(chunk.vehicles.length);
  });

  it("keeps every index and every arc inside the 000396 network's paths and shapes", () => {
    const chunk = decodeMotionChunk(JSON.parse(readFileSync(join(DIR, chunkName!), 'utf8')) as unknown);
    const manifest = decodeManifest(JSON.parse(readFileSync(join(DIR, 'manifest.sample.json'), 'utf8')) as unknown);
    const raw = JSON.parse(readFileSync('app/public/data/zet-network.json', 'utf8')) as { feedVersion: string; graphHash: string };
    const net = decodeNetwork(raw);
    expect(manifest.networks['396'].feedVersion).toBe('000396');
    const counts = { paths: manifest.networks['396'].paths, shapes: manifest.networks['396'].shapes };
    // The artefact the indices were cut against, while it is still the committed one.
    const current = raw.graphHash === manifest.networks['396'].graphHash;
    if (current) expect(counts).toEqual({ paths: net.paths.length, shapes: net.shapes.length });
    for (const v of chunk.vehicles) {
      for (const seg of v.segs) {
        if (seg.on === 0) expect(seg.idx).toBeLessThan(counts.paths);
        if (seg.on === 1) expect(seg.idx).toBeLessThan(counts.shapes);
      }
      if (!current) continue;
      for (const s of expandVehicle(v)) {
        if (s === null || s.on === 2) continue;
        const len = s.on === 0 ? net.paths[s.idx].len : net.shapes[s.idx].len;
        expect(s.s).toBeGreaterThanOrEqual(0);
        expect(s.s).toBeLessThanOrEqual(Math.ceil(len));
      }
    }
  });

  it('carries a v2 manifest that decodes: the 112-hour window, both comparison days, eight boards, nine downloads', () => {
    const manifest = decodeManifest(JSON.parse(readFileSync(join(DIR, 'manifest.sample.json'), 'utf8')) as unknown);
    expect(manifest.version).toBe(2);
    expect(manifest.window.minutes).toBe(6720);
    expect(manifest.window.toSec).toBe(SNIMKA_WINDOW.toSec);
    expect(manifest.comparisons.map((c) => c.id)).toEqual(SNIMKA_COMPARISONS.map((c) => c.id));
    expect(manifest.files.grid).toBeNull();
    expect(manifest.files.boards.map((b) => b.stop)).toEqual(['106_1', '106_2', '98_1', '208_24', '271_24', '236_1', '109_1', '245_1']);
    expect(manifest.files.exports.map((e) => e.name)).toEqual(['series', 'hourly', 'routes-5min', 'bikes-5min', 'stations', 'sentences', 'events', 'closures', 'opis']);
    expect(manifest.files.exports.map((e) => e.format)).toEqual(['csv', 'csv', 'csv', 'csv', 'csv', 'csv', 'json', 'geojson', 'json']);
    expect(manifest.files.opis.path).toBe(manifest.files.exports.find((e) => e.name === 'opis')!.path);
    expect(manifest.attribution.find((a) => a.id === 'zet')?.text).toBe('Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669');
    expect(manifest.serviceLiveFromSec).toBe(Date.parse('2026-09-29T21:18:00Z') / 1000);
    for (const note of [...manifest.notes, ...manifest.comparisons.flatMap((c) => c.notes)]) {
      expect(note).not.toMatch(/—|--|…/);
      expect(note).not.toMatch(/štrajk/i);
    }
  });
});
