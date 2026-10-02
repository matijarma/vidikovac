// The three replayed segments of the snimka dataset (lanes S1 and V1): the
// window (Sun 27 Sep 20:00 to Fri 2 Oct 12:00) on feed 000396 with the merged
// expectation, and the two normal days on feed 000395: Thu 24 Sep (the 23rd
// is gone from R2, so its first two hours are missing) and Mon 21 Sep (its
// first two Zagreb hours sit in the 20 Sep UTC folder).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadExpectIndexFile } from '../replay-core';
import type { ExpectIndex } from '../../shared/motion/expect';
import { SNIMKA_COMPARISONS, SNIMKA_WINDOW } from '../../shared/snimka';
import { mergeExpectIndexes } from './expect-merge';
import type { Paths } from './paths';

export type SegmentKey = 'window' | 'day-0924' | 'day-0921';
export const SEGMENT_KEYS: readonly SegmentKey[] = ['window', 'day-0924', 'day-0921'];
export type DayKey = Exclude<SegmentKey, 'window'>;
export const DAY_KEYS: readonly DayKey[] = ['day-0924', 'day-0921'];
/** The comparison of the contract a day segment builds. */
export const COMPARISON_OF: Record<DayKey, (typeof SNIMKA_COMPARISONS)[number]> = { 'day-0924': SNIMKA_COMPARISONS[0], 'day-0921': SNIMKA_COMPARISONS[1] };

export interface Segment {
  key: SegmentKey;
  net: '395' | '396';
  fromSec: number;
  minutes: number;
  /** Recorded frames before `fromSec` folded in only to warm the twin's state. */
  warmupSec: number;
  /** Recording folders (UTC days) that can hold frames of the segment. */
  dirs: string[];
  network: string;
  trips: string;
  overrides: string;
}

/** The cut of the merged expectation: 000396's calendar starts on this date. */
export const EXPECT_CUT = '2026-09-28';

export function segmentOf(paths: Paths, key: SegmentKey): Segment {
  const rec = (day: string): string => join(paths.inputs, 'companion', 'recordings', ...day.split('/'));
  const overrides = join(paths.repo, 'app/public/data/stop-dwell-overrides.json');
  if (key === 'window') {
    return {
      key, net: '396', fromSec: SNIMKA_WINDOW.fromSec, minutes: SNIMKA_WINDOW.minutes,
      // Fifteen minutes of Sunday evening so the tracks and the service state exist at 20:00.
      warmupSec: 900,
      dirs: ['2026/09/27', '2026/09/28', '2026/09/29', '2026/09/30', '2026/10/01', '2026/10/02'].map(rec),
      network: join(paths.repo, 'app/public/data/zet-network.json'),
      trips: join(paths.repo, 'app/public/data/zet-trips.json'),
      overrides,
    };
  }
  const fixture = join(paths.repo, 'test/fixtures/frames/2026-09-21-1715-1744/artefacts');
  const day = COMPARISON_OF[key];
  // A Zagreb day starts at 22:00Z of the UTC day before: that folder holds its first two hours (and the warm-up) when it exists.
  const folders = key === 'day-0924' ? ['2026/09/23', '2026/09/24'] : ['2026/09/20', '2026/09/21'];
  return {
    key, net: '395', fromSec: day.fromSec, minutes: day.minutes,
    warmupSec: 900,
    dirs: folders.map(rec).filter((dir) => existsSync(dir)),
    network: join(fixture, 'zet-network.json'),
    trips: join(fixture, 'zet-trips.json'),
    overrides,
  };
}

export const EXPECT_FILES = (paths: Paths): { e396: string; e395: string } => ({
  e396: join(paths.repo, 'app/public/data/zet-expect.json'),
  e395: join(paths.repo, 'test/fixtures/frames/zet-expect-000395.json'),
});

/** The declared fleet a segment is judged against: 000396 merged with 000395 at the cut for the window, 000395 for the day. */
export async function loadSegmentExpect(paths: Paths, key: SegmentKey): Promise<ExpectIndex> {
  const files = EXPECT_FILES(paths);
  const e395 = await loadExpectIndexFile(files.e395);
  if (key !== 'window') return e395;
  return mergeExpectIndexes(await loadExpectIndexFile(files.e396), e395, EXPECT_CUT);
}

export const ROUTES_FILE = (paths: Paths): string => join(paths.repo, 'app/src/data/zet-routes.json');
