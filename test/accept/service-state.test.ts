// U2's acceptance A4 (upgrade package U2 §6, plan row U2-3): the service
// state machine (worker/twin/service.ts) replayed over the committed strike
// cuts and the normal cut of 21 September, through the same runTick every
// production tick goes through (scripts/replay-core.ts
// replayServiceDirectory: no engine, the fixes alone), judged against the
// expectation artefact of each cut's feed. The measured instants of prep-E
// (review.local/upgrade/analysis/strike-ratio.md) sit in the comments; the
// assertions are the package's, in whole Zagreb minutes. Accept tier:
//
//   npx vitest run --project accept test/accept/service-state.test.ts
//
// The strike cuts are deviation fixtures (each README's first line): never a
// normal-behaviour replay, tuning or fixture day. The collapse case reads
// `seen` through U0's fleetSeen once integrated (the ghosts stamped 24 h
// ahead and the parked rule); on this branch alone it reads the stand-in.
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import routes from '../../app/src/data/zet-routes.json';
import { loadExpectIndexFile, replayServiceDirectory, serviceChanges, zagrebClock, zagrebDay, type ServiceLogLine } from '../../scripts/replay-core';
import type { ExpectIndex } from '../../shared/motion/expect';
import type { ZetRoutes } from '../../worker/feed/modules/zet-routes';
import { MIN_EXPECTED } from '../../worker/twin/service';

const root = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const FRAMES = 'test/fixtures/frames';
const ROUTES = routes as ZetRoutes;

/** `HH:MM` Zagreb of a minute line. */
const clock = (line: ServiceLogLine): string => zagrebClock(line.atSec).slice(0, 5);
const lineAt = (lines: readonly ServiceLogLine[], hhmm: string): ServiceLogLine => {
  const line = lines.find((l) => clock(l) === hhmm);
  if (!line) throw new Error(`no minute ${hhmm} in the log (${clock(lines[0])} to ${clock(lines[lines.length - 1])})`);
  return line;
};

/** The header time of the first frame of a cut, from the file names (`HHMMSS-<headerTs>.pb`). */
async function firstFrameSec(dir: string): Promise<number> {
  const headers = (await readdir(dir)).map((name) => /-(\d+)\.pb$/.exec(name)?.[1]).filter((h): h is string => h !== undefined).map(Number);
  return Math.min(...headers);
}

function report(name: string, lines: readonly ServiceLogLine[]): void {
  const changes = serviceChanges(lines).map((c) => `${zagrebDay(c.atSec)} ${zagrebClock(c.atSec)} ${c.from} -> ${c.to}`);
  const first = lines[0];
  const last = lines[lines.length - 1];
  console.log(`${name}: ${lines.length} minutes ${clock(first)} to ${clock(last)}, ends ${last.state} (${last.seen} of ${last.expected}); changes: ${changes.join('; ') || 'none'}`);
}

describe('the service state over the strike cuts and a normal cut', () => {
  let expect395: ExpectIndex;
  let expect396: ExpectIndex;

  beforeAll(async () => {
    expect395 = await loadExpectIndexFile(root(`${FRAMES}/zet-expect-000395.json`));
    expect396 = await loadExpectIndexFile(root('app/public/data/zet-expect.json'));
  });

  // Measured: reduced 00:12:45, silent 00:54:50 (one minute before the night
  // hold, not asserted), never normal again.
  it('the collapse (28 Sep 00:00 to 01:30, 000395): normal at 00:05, reduced by 00:20, never normal after', async () => {
    const lines = await replayServiceDirectory(root(`${FRAMES}/2026-09-27-2200-2330-collapse`), { expect: expect395, routes: ROUTES });
    report('collapse', lines);
    expect(lineAt(lines, '00:05')).toMatchObject({ state: 'normal', hold: null });
    expect(lineAt(lines, '00:20').state).toBe('reduced');
    const firstReduced = lines.findIndex((l) => l.state === 'reduced');
    expect(firstReduced).toBeGreaterThan(0);
    expect(lines.slice(firstReduced).filter((l) => l.state === 'normal')).toHaveLength(0);
  });

  // Measured: first judged 03:55:58, reduced 04:00:58, silent 04:05:58.
  it('the start (28 Sep 03:00 to 04:30, 000395): unknown with below-min until 03:55, silent by 04:10, no change after', async () => {
    const lines = await replayServiceDirectory(root(`${FRAMES}/2026-09-28-0100-0230-start`), { expect: expect395, routes: ROUTES });
    report('start', lines);
    const trough = lines.filter((l) => clock(l) < '03:55');
    expect(trough.length).toBeGreaterThan(40);
    for (const l of trough) expect(l, clock(l)).toMatchObject({ state: 'unknown', hold: 'below-min' });
    for (const l of trough) expect(l.expected, clock(l)).toBeLessThan(MIN_EXPECTED);
    expect(lineAt(lines, '04:10').state).toBe('silent');
    const firstSilent = lines.findIndex((l) => l.state === 'silent');
    expect(firstSilent).toBeGreaterThan(0);
    expect(lines.slice(firstSilent).every((l) => l.state === 'silent')).toBe(true);
  });

  // Measured: first judged 07:30:19, reduced 07:35:41, silent 07:40:54.
  it('the peak (28 Sep 07:30 to 08:30, 000396): silent from the first frame + 11 min to the end, expected at least 400, seen at most 3', async () => {
    const dir = root(`${FRAMES}/2026-09-28-0530-0630-peak`);
    const lines = await replayServiceDirectory(dir, { expect: expect396, routes: ROUTES });
    report('peak', lines);
    const from = (await firstFrameSec(dir)) + 11 * 60;
    const after = lines.filter((l) => l.atSec >= from);
    expect(after.length).toBeGreaterThan(45);
    for (const l of after) expect(l.state, clock(l)).toBe('silent');
    for (const l of lines.filter((l) => l.hold === null)) {
      expect(l.expected, clock(l)).toBeGreaterThanOrEqual(400);
      expect(l.seen, clock(l)).toBeLessThanOrEqual(3);
    }
  });

  // Measured: silent from 05:20:00; the one bus (route 330) from 05:18:48.
  it('the one bus (29 Sep 05:10 to 05:30, 000396): silent from the first frame + 11 min to the end, seen 1 from 05:19', async () => {
    const dir = root(`${FRAMES}/2026-09-29-0310-0330-onebus`);
    const lines = await replayServiceDirectory(dir, { expect: expect396, routes: ROUTES });
    report('onebus', lines);
    const from = (await firstFrameSec(dir)) + 11 * 60;
    const after = lines.filter((l) => l.atSec >= from);
    expect(after.length).toBeGreaterThanOrEqual(9);
    for (const l of after) expect(l.state, clock(l)).toBe('silent');
    for (const l of lines.filter((l) => clock(l) >= '05:19')) expect(l.seen, clock(l)).toBe(1);
    for (const l of lines.filter((l) => clock(l) < '05:18')) expect(l.seen, clock(l)).toBe(0);
    expect(lines[lines.length - 1].byMode.bus[0]).toBe(1);
  });

  it('a normal Monday (21 Sep 17:15 to 17:17, all modes, 000395): every judged minute normal, ratio at least 0.7, expected 380 to 470', async () => {
    const lines = await replayServiceDirectory(root(`${FRAMES}/2026-09-21-1715-1717-all`), { expect: expect395, routes: ROUTES });
    report('normal', lines);
    const judged = lines.filter((l) => l.hold === null);
    expect(judged.length).toBe(lines.length);
    expect(judged.length).toBeGreaterThanOrEqual(2);
    for (const l of judged) {
      expect(l.state, clock(l)).toBe('normal');
      expect(l.ratio, clock(l)).toBeGreaterThanOrEqual(0.7);
      expect(l.expected, clock(l)).toBeGreaterThanOrEqual(380);
      expect(l.expected, clock(l)).toBeLessThanOrEqual(470);
    }
  });
});
