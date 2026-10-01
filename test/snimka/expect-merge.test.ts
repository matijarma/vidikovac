import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mergeExpectIndexes } from '../../scripts/snimka/expect-merge';
import { decodeExpectIndex, expectedAt, type ExpectIndex } from '../../shared/motion/expect';
import { expectationAt } from '../../worker/twin/service';

const load = (path: string): ExpectIndex => decodeExpectIndex(JSON.parse(readFileSync(path, 'utf8')) as unknown);
const at = (iso: string): number => Date.parse(iso) / 1000;

/** A tiny index: one service per date, `runs` vehicle runs in every slot. */
function tiny(feedVersion: string, dates: Record<string, string>, runs: Record<string, number>, slots = 4): ExpectIndex {
  const services = Object.keys(runs);
  return {
    feedVersion, builtAt: '2026-09-01T00:00:00Z', slotSec: 300, slots, services,
    calendar: new Map(Object.entries(dates).map(([date, service]) => [date, [service]])),
    firstDate: Object.keys(dates).sort()[0] ?? null, lastDate: Object.keys(dates).sort().at(-1) ?? null,
    routeType: new Map([['1', 0], ['100', 3]]),
    blocks: new Map(services.map((s) => [s, { all: Array(slots).fill(runs[s]), tram: Array(slots).fill(runs[s]), bus: Array(slots).fill(0) }])),
    trips: new Map(services.map((s) => [s, new Map([['1', Array(slots).fill(runs[s])]])])),
  };
}

describe('mergeExpectIndexes', () => {
  it('takes the fallback calendar before the cut and the primary from it, with namespaced services', () => {
    const primary = tiny('000396', { '2026-09-28': '0_30', '2026-09-29': '0_30' }, { '0_30': 7 });
    const fallback = tiny('000395', { '2026-09-27': '0_30', '2026-09-28': '0_30' }, { '0_30': 3 }, 6);
    const merged = mergeExpectIndexes(primary, fallback, '2026-09-28');
    expect([...merged.calendar]).toEqual([
      ['2026-09-27', ['000395:0_30']],
      ['2026-09-28', ['000396:0_30']],
      ['2026-09-29', ['000396:0_30']],
    ]);
    expect(merged.firstDate).toBe('2026-09-27');
    expect(merged.lastDate).toBe('2026-09-29');
    expect(merged.slots).toBe(6);
    expect(merged.blocks.get('000396:0_30')!.all).toEqual([7, 7, 7, 7, 0, 0]);
    expect(merged.blocks.get('000395:0_30')!.all).toEqual([3, 3, 3, 3, 3, 3]);
    expect(merged.trips.get('000396:0_30')!.get('1')).toEqual([7, 7, 7, 7, 0, 0]);
    expect(merged.feedVersion).toBe('000396+000395');
    // The inputs are not changed.
    expect(primary.blocks.get('0_30')!.all).toEqual([7, 7, 7, 7]);
    expect([...fallback.calendar.keys()]).toEqual(['2026-09-27', '2026-09-28']);
  });

  it('refuses a slot length mismatch, one feed twice and a malformed cut', () => {
    const a = tiny('000396', {}, { x: 1 });
    expect(() => mergeExpectIndexes(a, { ...tiny('000395', {}, { x: 1 }), slotSec: 600 }, '2026-09-28')).toThrow(/slot/);
    expect(() => mergeExpectIndexes(a, tiny('000396', {}, { x: 1 }), '2026-09-28')).toThrow(/both/);
    expect(() => mergeExpectIndexes(a, tiny('000395', {}, { x: 1 }), '28.9.2026')).toThrow(/cut date/);
  });

  describe('over the committed artefacts (000396 primary, 000395 fallback, cut 2026-09-28)', () => {
    const p396 = load('app/public/data/zet-expect.json');
    const p395 = load('test/fixtures/frames/zet-expect-000395.json');
    const merged = mergeExpectIndexes(p396, p395, '2026-09-28');

    it('knows Sunday evening and the small hours of Monday, which 000396 alone does not', () => {
      for (const iso of ['2026-09-27T18:00:00Z', '2026-09-27T22:30:00Z', '2026-09-28T03:00:00Z']) {
        expect(expectedAt(p396, at(iso)).known).toBe(false);
        expect(expectedAt(merged, at(iso)).known).toBe(true);
      }
      // Sunday evening is 000395 alone: the same counts the fallback gives.
      expect(expectedAt(merged, at('2026-09-27T18:00:00Z')).blocks).toEqual(expectedAt(p395, at('2026-09-27T18:00:00Z')).blocks);
    });

    it('answers exactly as 000396 once yesterday is from the cut on', () => {
      for (const iso of ['2026-09-29T05:45:00Z', '2026-09-30T17:05:00Z', '2026-10-01T05:45:00Z']) {
        expect(expectationAt(merged, at(iso)).blocks).toEqual(expectationAt(p396, at(iso)).blocks);
      }
    });

    it('sums Sunday night runs of 000395 with Monday runs of 000396 across midnight', () => {
      const t = at('2026-09-27T22:30:00Z');
      const before = { ...p395, calendar: new Map([...p395.calendar].filter(([date]) => date < '2026-09-28')) };
      const sundayNight = expectedAt(before, t).blocks;
      const monday = expectedAt(p396, t).blocks;
      expect(sundayNight.all).toBeGreaterThan(0);
      expect(expectedAt(merged, t).blocks).toEqual({ all: sundayNight.all + monday.all, tram: sundayNight.tram + monday.tram, bus: sundayNight.bus + monday.bus });
      expect(merged.routeType.get('1')).toBe(p396.routeType.get('1'));
    });
  });
});
