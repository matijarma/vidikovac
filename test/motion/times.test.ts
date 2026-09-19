// The timetable over the two committed artefacts: which path each pattern of
// the trip index runs, and how many of the network's tram paths end up with
// segments. Before F8 a shapeless pattern was handed the first synthetic path
// of its route and direction -- so every one of line 1's six variants pointed
// at two paths between them -- and a pattern whose path could not place one of
// its stops was thrown away whole. 38 of the 145 tram paths had no segments,
// and the planner fell back to raw geometry over every metre of them.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeNetwork, type GraphNetwork } from '../../shared/motion/network';
import { mapPatternsToPaths, scheduleTimes } from '../../shared/motion/times';
import { decodeTripIndex, type TripIndex } from '../../shared/motion/trips';

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const net: GraphNetwork = decodeNetwork(read('app/public/data/zet-network.json'));
const index: TripIndex = decodeTripIndex(read('app/public/data/zet-trips.json'));

/** Whether the schedule answers anywhere along the path (in 20 slices). */
function hasSegments(times: { segmentSeconds: (p: number, a: number, b: number, band: number, day: 0 | 1) => number | null }, pathIdx: number): boolean {
  const len = net.paths[pathIdx].len;
  for (let k = 0; k < 20; k++) {
    if (times.segmentSeconds(pathIdx, (len * k) / 20, (len * (k + 1)) / 20, 8, 0) !== null) return true;
  }
  return false;
}

describe('the timetable over the committed artefacts', () => {
  it('maps every pattern to its own path and gives every tram path segments', () => {
    expect(net.feedVersion).toBe(index.feedVersion);
    const mapping = mapPatternsToPaths(net, index);
    // Every shapeless pattern now reaches a path of its own: nothing is left
    // guessing (firstOfRouteAndDirection) or unmapped. Before F8b the seven
    // patterns of routes 2, 5 and 13 whose stops the 40 m router could not
    // chain counted 6 unmapped and 1 guessed. The three trimmed are line 1's,
    // whose rails past Zapadni kolodvor no shape in the feed draws.
    expect(mapping.report).toEqual({
      byShape: 100,
      exact: 49,
      trimmed: 3,
      firstOfRouteAndDirection: 0,
      unmapped: 0,
      nonTram: 450,
    });
    // A pattern and its path must agree on route and direction.
    index.patterns.forEach((pattern, i) => {
      const idx = mapping.pathOf[i];
      if (idx === null) return;
      expect(net.paths[idx].route, `pattern ${i}`).toBe(pattern.route);
      expect(net.paths[idx].direction, `pattern ${i}`).toBe(pattern.direction);
      expect(mapping.pathIdOf[i]).toBe(net.paths[idx].id);
    });

    const times = scheduleTimes(net, index);
    const tram = net.paths.map((p, i) => [p, i] as const).filter(([p]) => net.routes.get(p.route)?.type === 0);
    expect(tram).toHaveLength(152);
    const withSegments = tram.filter(([, i]) => hasSegments(times, i));
    const without = tram.filter(([, i]) => !hasSegments(times, i)).map(([p]) => p.id);
    expect(times.report.pathsWithSegments).toBe(152);
    expect(without, 'tram paths the timetable says nothing about').toEqual([]);
    expect(withSegments).toHaveLength(152);
    expect(times.report.unusable).toBe(0);
    // Three patterns name a stop their path cannot place -- line 1's trimmed
    // off-graph terminus stretches. The segment spanning such a stop carries
    // its time, so those paths keep their timetable rather than losing it.
    // (Olipska accounted for another nine until the served radius grew to
    // SERVED_STOP_MAX_METRES; the fourth was the route-13 pattern that used to
    // be handed a sibling path and now has its own, F8b.)
    expect(times.report.clipped).toBe(3);
  });
});
