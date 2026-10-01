// Two declared fleets as one (snimka pass, lane S1). The window of the strike
// replay runs on feed 000396, whose calendar starts on Monday 28 September
// 2026: alone it cannot say what was expected on Sunday evening, or in the
// small hours of the 28th, when Sunday's night runs are still in service
// (expect.ts sums yesterday's service day and today's). Merged with feed
// 000395, every date before the cut takes the fallback's services and every
// date from the cut the primary's, so the replay never reads `no-calendar`
// where a calendar did know the day. Services are namespaced by feed version
// (`000396:0_23`, `000395:0_23`): both feeds name their services alike, and
// a block count of one feed must never be read under the other's calendar.
// Pure: no I/O, the inputs are not changed.

import type { ExpectIndex, ModeSlots } from '../../shared/motion/expect';

const pad = (counts: readonly number[], slots: number): number[] => {
  const out = counts.slice(0, slots);
  // A shorter service day has no run in the slots it does not reach.
  while (out.length < slots) out.push(0);
  return out;
};

/**
 * The calendar of `fallback` for dates before `cutDate` (YYYY-MM-DD) and of
 * `primary` from it on; the blocks and trips of both, namespaced. The slot
 * length must agree; the slot count is the larger of the two.
 */
export function mergeExpectIndexes(primary: ExpectIndex, fallback: ExpectIndex, cutDate: string): ExpectIndex {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutDate)) throw new Error(`mergeExpectIndexes: cut date ${cutDate} is not YYYY-MM-DD`);
  if (primary.slotSec !== fallback.slotSec) throw new Error(`mergeExpectIndexes: slot ${primary.slotSec} s against ${fallback.slotSec} s`);
  if (primary.feedVersion === fallback.feedVersion) throw new Error(`mergeExpectIndexes: both indexes are feed ${primary.feedVersion}`);
  const slots = Math.max(primary.slots, fallback.slots);
  const ns = (index: ExpectIndex, service: string): string => `${index.feedVersion}:${service}`;

  const calendar = new Map<string, string[]>();
  for (const [date, services] of fallback.calendar) if (date < cutDate) calendar.set(date, services.map((s) => ns(fallback, s)));
  for (const [date, services] of primary.calendar) if (date >= cutDate) calendar.set(date, services.map((s) => ns(primary, s)));
  const sorted = new Map([...calendar].sort((a, b) => a[0].localeCompare(b[0])));
  const dates = [...sorted.keys()];

  const blocks = new Map<string, ModeSlots>();
  const trips = new Map<string, Map<string, number[]>>();
  for (const index of [fallback, primary]) {
    for (const [service, modes] of index.blocks) {
      blocks.set(ns(index, service), { all: pad(modes.all, slots), tram: pad(modes.tram, slots), bus: pad(modes.bus, slots) });
    }
    for (const [service, byRoute] of index.trips) {
      trips.set(ns(index, service), new Map([...byRoute].map(([route, counts]) => [route, pad(counts, slots)] as const)));
    }
  }
  // The primary names the route types where both know a route.
  const routeType = new Map([...fallback.routeType, ...primary.routeType]);

  return {
    feedVersion: `${primary.feedVersion}+${fallback.feedVersion}`,
    builtAt: primary.builtAt,
    slotSec: primary.slotSec,
    slots,
    services: [...fallback.services.map((s) => ns(fallback, s)), ...primary.services.map((s) => ns(primary, s))],
    calendar: sorted,
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
    routeType,
    blocks,
    trips,
  };
}
