import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FEED_VERSION } from '../../app/src/motion/network-meta';
import { checkArtefacts, VERSIONED_ARTEFACTS } from '../../scripts/check-artefacts.mjs';

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

describe('artefact guard exit modes', () => {
  const nowMs = Date.parse('2026-09-29T00:00:00Z');
  const builtAt = '2026-09-28T06:34:58Z';
  let fixture: string;
  const head = vi.fn(async () => ({ lastModified: builtAt }));

  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), 'artefact-guard-'));
    mkdirSync(join(fixture, 'app/src/motion'), { recursive: true });
    mkdirSync(join(fixture, 'app/public/data/lastrun'), { recursive: true });
    writeFileSync(join(fixture, 'app/src/motion/network-meta.ts'), `export const FEED_VERSION = "000396";\nexport const BUILT_AT = "${builtAt}";\n`);
    for (const name of VERSIONED_ARTEFACTS) {
      writeFileSync(join(fixture, 'app/public/data', name), JSON.stringify({ feedVersion: '000396' }));
    }
    // An expired minimum must not fail a fresh median. The exact seven-day
    // boundary is current; one millisecond later it needs a rebuild.
    for (const [i, days] of [0, 7, 9].entries()) {
      writeFileSync(join(fixture, 'app/public/data/lastrun', `${i}.json`), JSON.stringify({ validUntil: new Date(nowMs + days * DAY_MS).toISOString() }));
    }
    head.mockReset();
  });

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  it.each(['app/src/motion/network-meta.ts', 'app/public/data/lastrun'])('fails a missing local input %s, not a retryable network answer', async (path) => {
    rmSync(join(fixture, path), { recursive: true });
    const result = await checkArtefacts({ root: fixture, nowMs, offline: true, head });
    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toMatch(/^FAIL /m);
    expect(result.lines.at(-1)).toBe('skipped static archive: --offline');
    expect(head).not.toHaveBeenCalled();
  });

  it('keeps checking after a missing metadata file and lets local failure win over an unknown HEAD', async () => {
    rmSync(join(fixture, 'app/src/motion/network-meta.ts'));
    head.mockResolvedValueOnce({ lastModified: 'unreadable' });
    const result = await checkArtefacts({ root: fixture, nowMs, head });
    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain('lastrun: 3 files');
    expect(result.lines.at(-1)).toMatch(/^unknown static archive:/);
    expect(head).toHaveBeenCalledOnce();
  });

  it('uses the supplied clock, the median, and a strict seven-day freshness boundary without a HEAD offline', async () => {
    expect((await checkArtefacts({ root: fixture, nowMs, offline: true, head })).code).toBe(0);
    expect((await checkArtefacts({ root: fixture, nowMs: nowMs + 1, offline: true, head })).code).toBe(1);
    expect(head).not.toHaveBeenCalled();
  });

  it.each([
    { lastModified: builtAt, code: 0 },
    { lastModified: '2026-09-28T06:34:59Z', code: 1 },
    { lastModified: 'unreadable', code: 2 },
  ])('returns $code for a HEAD Last-Modified of $lastModified', async ({ lastModified, code }) => {
    head.mockResolvedValueOnce({ lastModified });
    expect((await checkArtefacts({ root: fixture, nowMs, head })).code).toBe(code);
    expect(head).toHaveBeenCalledOnce();
  });
});
