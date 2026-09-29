import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FEED_VERSION } from '../../app/src/motion/network-meta';

// The committed timetable artefacts come from one feed and stay valid for a
// week ahead (scripts/check-artefacts.mjs, U0 of October 2026). Clock-free:
// every instant below is computed from the files themselves, so a
// regeneration never breaks the test, and the archive's HEAD never runs here.

const root = fileURLToPath(new URL('../../', import.meta.url));
const data = (name: string) => JSON.parse(readFileSync(`${root}app/public/data/${name}`, 'utf8')) as Record<string, unknown>;
const lastrunDir = `${root}app/public/data/lastrun`;
const validUntil = readdirSync(lastrunDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({ name, at: Date.parse(String((JSON.parse(readFileSync(`${lastrunDir}/${name}`, 'utf8')) as { validUntil?: unknown }).validUntil)) }));
const DAY_MS = 86_400_000;

const check = (now: string) =>
  spawnSync(process.execPath, [`${root}scripts/check-artefacts.mjs`, '--offline', '--now', now], { cwd: root, encoding: 'utf8' });

describe('the committed artefacts', () => {
  it('carry one feed version: network-meta.ts and the four data files', () => {
    const names = ['zet-network.json', 'zet-trips.json', 'zet-schema.json', 'zet-expect.json'];
    expect(FEED_VERSION).toMatch(/^\d{6}$/);
    expect(Object.fromEntries(names.map((name) => [name, data(name).feedVersion]))).toEqual(Object.fromEntries(names.map((name) => [name, FEED_VERSION])));
  });

  it('give every last-tram file a validUntil that parses', () => {
    expect(validUntil.length).toBeGreaterThan(0);
    expect(validUntil.filter((file) => !Number.isFinite(file.at)).map((file) => file.name)).toEqual([]);
  });

  it('pass the offline check eight days before the median validUntil and fail it six days before', () => {
    const sorted = validUntil.map((file) => file.at).sort((a, b) => a - b);
    const median = sorted[(sorted.length - 1) >> 1];
    const pass = check(new Date(median - 8 * DAY_MS).toISOString());
    expect(pass.status, pass.stdout + pass.stderr).toBe(0);
    const fail = check(new Date(median - 6 * DAY_MS).toISOString());
    expect(fail.status, fail.stdout + fail.stderr).toBe(1);
    expect(fail.stdout).toMatch(/^FAIL {4}lastrun: /m);
  });
});
