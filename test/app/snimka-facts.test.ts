// The fact chips (app/src/snimka/facts.ts): the series at the item's minute,
// a line's five-minute sample, a station's bikes once the stations arrive.
// Missing is never zero: a null reads "bez podatka" and is marked missing; an
// observed zero is a word; a state before the app published its own is retro.
import { describe, expect, it } from 'vitest';
import type { HashedRef } from '../../shared/snimka';
import type { SnimkaContext } from '../../app/src/snimka/context';
import { chipsLabel, factChips, onStationData, seriesMinute, stationData } from '../../app/src/snimka/facts';
import { buildBajs, buildRoutes, buildStations, buildWindowSeries, MARKS, zg } from '../../e2e/snimka-fixtures';

const series = buildWindowSeries();
const routes = buildRoutes();

function ctx(objects = new Map<string, unknown>([['stations', buildStations()], ['bajs', buildBajs(series)]])) {
  const requested: string[] = [];
  const c = {
    series, routes,
    manifest: { serviceLiveFromSec: MARKS.serviceLive, files: { stations: 'stations', bajs: 'bajs' } },
    data: {
      url: (r: HashedRef | string) => String(r),
      get: async <T,>(r: HashedRef | string, decode?: (raw: unknown) => T): Promise<T> => {
        const path = typeof r === 'string' ? r : r.path;
        requested.push(path);
        if (!objects.has(path)) throw new Error(`404 ${path}`);
        return decode ? decode(objects.get(path)) : (objects.get(path) as T);
      },
    },
  } as unknown as SnimkaContext;
  return { ctx: c, requested };
}
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
const texts = (chips: { text: string }[]): string[] => chips.map((c) => c.text);
/** A chip that shows a count of zero for a value the recording does not have would read "0" on its own. */
const ZERO = /(?<![\d.,])0(?![\d.,])/;

describe('factChips', () => {
  it('reads the series at the minute: counts with their words, the state lower-case', () => {
    const { ctx: c } = ctx();
    const m = seriesMinute(series, MARKS.thursday0745);
    const chips = factChips(['seen', 'expected', 'state', 'bikes', 'bikesEmpty', 'closures', 'temp'], c, MARKS.thursday0745);
    expect(chips.map((x) => x.key)).toEqual(['seen', 'expected', 'state', 'bikes', 'bikesEmpty', 'closures', 'temp']);
    expect(chips[0]!.text).toBe(`u pokretu ${series.seen.all[m]!.toLocaleString('hr-HR')}`);
    expect(chips[1]!.text).toMatch(/^po voznom redu oko \d/);
    expect(chips[2]!.text).toBe('stanje: uobičajeno');
    expect(chips[2]!.retro).toBe(false);
    expect(chips[6]!.text).toMatch(/^\d+ °C$/);
    expect(chips.every((x) => !x.missing)).toBe(true);
  });
  it('a minute the recording does not have reads "bez podatka", never 0, and is marked missing', () => {
    const { ctx: c } = ctx();
    // Before the series starts (Sunday 21:00) and in the frame gap of Tuesday 03:00.
    for (const at of [zg(9, 27, 21, 0), MARKS.frameGapFrom + 60, MARKS.windowStart - 86_400]) {
      const chips = factChips(['seen', 'expected', 'state', 'route:228', 'temp'], c, at);
      for (const chip of chips.filter((x) => x.key !== 'expected' || at < MARKS.seriesStart)) {
        if (series.seen.all[seriesMinute(series, at)] === null || seriesMinute(series, at) < 0) {
          if (chip.key === 'seen') expect(chip).toMatchObject({ text: 'u pokretu: bez podatka', missing: true });
        }
        expect(chip.text, chip.key).not.toMatch(ZERO);
      }
    }
    const before = factChips(['seen', 'expected', 'state', 'temp', 'feed'], c, MARKS.windowStart - 86_400);
    expect(texts(before)).toEqual(['u pokretu: bez podatka', 'po voznom redu: bez podatka', 'stanje: bez podatka', 'bez podatka DHMZ-a', 'ZET-ovi podaci: bez podatka']);
    expect(before.every((x) => x.missing)).toBe(true);
  });
  it('a line: its count against the timetable, the word for none when it ran nothing, the gap as missing', () => {
    const { ctx: c } = ctx();
    expect(texts(factChips(['route:228'], c, zg(9, 29, 12, 0)))).toEqual(['linija 228: 2 od 4']);
    expect(texts(factChips(['route:228'], c, zg(9, 28, 12, 0)))).toEqual(['linija 228: nijedno vozilo']);
    const gap = factChips(['route:228'], c, MARKS.frameGapFrom + 60);
    expect(gap).toEqual([{ key: 'route:228', text: 'linija 228: bez podatka', retro: false, missing: true }]);
    expect(factChips(['route:9999'], c, zg(9, 29, 12, 0))[0]).toMatchObject({ text: 'linija 9999: bez podatka', missing: true });
  });
  it('the state is retro before the app published its own, and says so whatever it was', () => {
    const { ctx: c } = ctx();
    const monday = factChips(['state'], c, MARKS.monday0745)[0]!;
    expect(monday).toMatchObject({ text: 'stanje: gotovo bez vozila', retro: true, missing: false });
    expect(factChips(['state'], c, MARKS.serviceLive)[0]!.retro).toBe(false);
  });
  it('the feed chip speaks only when the feed stood still or came empty', () => {
    const { ctx: c } = ctx();
    expect(texts(factChips(['feed'], c, MARKS.feedFrozenFrom + 600))).toEqual(['ZET-ovi podaci stoje']);
    expect(texts(factChips(['feed'], c, MARKS.feedEmptyFrom + 120))).toEqual(['ZET bez vozila']);
    expect(factChips(['feed'], c, MARKS.thursday0745)).toEqual([]);
  });
  it('a station: pending while the stations load, then its bikes or "prazna"; never 0', async () => {
    const { ctx: c, requested } = ctx();
    const first = factChips(['station:bajs-1'], c, MARKS.monday0745);
    expect(first[0]).toMatchObject({ text: 'bajs-1: bez podatka', missing: true, pending: true });
    let settled = 0;
    onStationData(c, () => { settled += 1; });
    await settle();
    expect(settled).toBe(1);
    expect(stationData(c)).not.toBeNull();
    const later = factChips(['station:bajs-1', 'station:bajs-7', 'station:bajs-10'], c, MARKS.monday0745);
    expect(later[0]!.text).toMatch(/^Stanica 1: (?:\d+|prazna)$/);
    // Station 7 is not renting in the fixture: no count to give.
    expect(later[1]).toMatchObject({ text: 'Stanica 7: bez podatka', missing: true });
    expect(later.every((x) => !x.pending)).toBe(true);
    for (const chip of later) expect(chip.text).not.toMatch(ZERO);
    // One load for the page, whoever asks.
    factChips(['station:bajs-2'], c, MARKS.monday0745);
    expect(requested.filter((p) => p === 'bajs').length).toBe(1);
  });
  it('a station file that cannot load leaves the chip missing and stops asking', async () => {
    const { ctx: c, requested } = ctx(new Map());
    factChips(['station:bajs-1'], c, MARKS.monday0745);
    await settle();
    const again = factChips(['station:bajs-1'], c, MARKS.monday0745);
    expect(again[0]).toMatchObject({ missing: true, pending: true });
    expect(requested.filter((p) => p === 'bajs').length).toBe(1);
  });
  it('the label over the chips: the minute of publication for a headline', () => {
    expect(chipsLabel({ atPublish: true })).toBe('U minuti objave');
    expect(chipsLabel()).toBe('U toj minuti');
  });
});
