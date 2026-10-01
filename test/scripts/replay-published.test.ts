// replayPublished (snimka pass, lane S1): the twin's published state over a
// committed strike cut, with the engine and the expectation in one pass. The
// fixture is a deviation fixture of the ZET strike (its README says so); the
// test only checks that the driver streams and folds it as replay() does.

import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadExpectIndexFile, loadFrameFiles, loadRealEngine, loadZetRoutesFile, orderFrames, replay, replayPublished, type FleetFrame, type PublishedTick } from '../../scripts/replay-core';
import type { ExpectIndex } from '../../shared/motion/expect';
import type { ZetRoutes } from '../../worker/feed/modules/zet-routes';

const DIR = 'test/fixtures/frames/2026-09-28-0530-0630-peak';
const DATA = 'app/public/data';
const engineOf = () => loadRealEngine(`${DATA}/zet-network.json`, `${DATA}/zet-trips.json`, `${DATA}/stop-dwell-overrides.json`);

describe('replayPublished over the first strike morning (deviation fixture)', () => {
  let expectIndex: ExpectIndex;
  let routes: ZetRoutes;
  let names: string[];
  const ticks: PublishedTick[] = [];
  let result: { frames: number; dropped: number };
  let tmp: string;

  beforeAll(async () => {
    expectIndex = await loadExpectIndexFile(`${DATA}/zet-expect.json`);
    routes = await loadZetRoutesFile('app/src/data/zet-routes.json');
    names = (await readdir(DIR)).filter((name) => /^\d{6}-\d+\.pb$/.test(name));
    result = await replayPublished([DIR], await engineOf(), { expect: expectIndex, routes, onTick: (tick) => ticks.push(tick) });
    tmp = await mkdtemp(join(tmpdir(), 'replay-published-'));
  }, 120_000);

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('folds every recorded frame once, in header order', () => {
    expect(result).toEqual({ frames: names.length, dropped: 0 });
    expect(ticks).toHaveLength(names.length);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].headerSec).toBeGreaterThan(ticks[i - 1].headerSec);
    expect(ticks[0].headerSec).toBe(Math.min(...names.map((name) => Number(name.slice(7, -3)))));
  });

  it('hands over the payload, the service memory and the frame counts of each tick', () => {
    for (const tick of ticks) {
      const pins = tick.payload.items.filter((item) => item.id.startsWith('vehicle:'));
      expect(tick.payload.sources?.zet?.itemCount).toBe(pins.length);
      expect(Date.parse(tick.payload.sourceUpdatedAt!)).toBe(tick.headerSec * 1000);
      expect(tick.entities).toBeGreaterThanOrEqual(0);
      expect(tick.hidden.depot + tick.hidden.parked).toBeGreaterThanOrEqual(0);
      expect(tick.rejectedFuture).toBe(0);
    }
    // Monday 07:30 to 08:30 Zagreb: a handful of vehicles against about 450 runs.
    expect(Math.max(...ticks.map((t) => t.payload.sources!.zet!.itemCount!))).toBeLessThan(20);
    const last = ticks.at(-1)!.service;
    expect(last.state).toBe('silent');
    expect(last.last!.expected).toBeGreaterThan(300);
    expect(ticks.some((t) => t.service.state === 'reduced')).toBe(true);
    // The pins carry the twin's plans: every motion names a geometry of the engine's network.
    const motions = ticks.flatMap((t) => t.payload.items.filter((i) => i.id.startsWith('vehicle:') && i.motion));
    expect(motions.length).toBeGreaterThan(0);
  });

  it('publishes exactly what replay() publishes over the same frames, with the same evidence fed back', async () => {
    const engine = await engineOf();
    const frames: FleetFrame[] = [];
    const { ordered } = orderFrames(await loadFrameFiles(DIR));
    replay(ordered, engine, routes, { onFrame: (frame) => frames.push(frame) });
    expect(frames.map((f) => [f.h, f.ids.join(',')])).toEqual(
      ticks.map((t) => [t.headerSec, t.payload.items.filter((i) => i.id.startsWith('vehicle:')).map((i) => i.id.slice(8)).join(',')]),
    );
    expect(frames.map((f) => f.rejectedFuture)).toEqual(ticks.map((t) => t.rejectedFuture));
    const again = await engineOf();
    await replayPublished([DIR], again, { expect: null, routes, onTick: () => {} });
    expect(Object.keys(again.learned.edges).length).toBe(Object.keys(engine.learned.edges).length);
    expect(Object.keys(again.learned.stops).length).toBe(Object.keys(engine.learned.stops).length);
    expect(Object.keys(again.dwellRecent).sort()).toEqual(Object.keys(engine.dwellRecent).sort());
  }, 120_000);

  it('reads only HHMMSS-<epoch>.pb names, keeps the bounds and drops a repeated header', async () => {
    const sorted = [...names].sort();
    const pick = sorted.slice(10, 16);
    for (const name of pick) await copyFile(join(DIR, name), join(tmp, name));
    // A 30-second copy as the strike recorder names it, and a repeat of one frame under another epoch.
    await copyFile(join(DIR, pick[0]), join(tmp, `${pick[0].slice(0, 6)}.pb`));
    const repeatEpoch = Number(pick[5].slice(7, -3)) + 1;
    await copyFile(join(DIR, pick[5]), join(tmp, `${pick[5].slice(0, 6)}-${repeatEpoch}.pb`));
    const seen: number[] = [];
    const engine = await engineOf();
    const fromSec = Number(pick[1].slice(7, -3));
    const out = await replayPublished([tmp], engine, { expect: expectIndex, routes, fromSec, onTick: (t) => seen.push(t.headerSec) });
    expect(out).toEqual({ frames: 5, dropped: 1 });
    expect(seen).toEqual(pick.slice(1).map((name) => Number(name.slice(7, -3))));
    const bounded: number[] = [];
    await replayPublished([tmp], await engineOf(), { expect: expectIndex, routes, toSec: Number(pick[3].slice(7, -3)), onTick: (t) => bounded.push(t.headerSec) });
    expect(bounded).toEqual(pick.slice(0, 3).map((name) => Number(name.slice(7, -3))));
  }, 120_000);
});
