// Stage `series` (lanes S1, V1): the minute series of the three segments (brief section
// 5, SeriesFile). What the replayed twin saw and judged comes from the frames
// stage; the declared fleet is expectationAt per minute over the segment's
// calendars; what production said comes from the recorder's teaser.jsonl;
// bikes and closures from their stages; the hourly row is DHMZ's
// Zagreb-Maksimir observation and the press pulse. Missing is null, never 0.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectationAt } from '../../worker/twin/service';
import { SNIMKA_WINDOW, ZAGREB_OFFSET_S, type Col, type HashedRef, type SeriesFile, type SnimkaState } from '../../shared/snimka';
import type { BikesMinutes } from './stage-bajs';
import { stampSec } from './stage-bajs';
import type { ClosuresMinutes } from './stage-closures';
import type { MinutesWork } from './stage-frames';
import { readWork, writeJsonObject, writeWork, type Paths } from './paths';
import { COMPARISON_OF, DAY_KEYS, loadSegmentExpect, type SegmentKey } from './segments';

export interface SeriesRefs { series: HashedRef; comparisons: Record<string, HashedRef>; serviceLiveFromSec: number }

const STATES = new Set(['normal', 'reduced', 'silent', 'unknown']);

interface TeaserLine { ts?: string; zet?: { status?: string; vehicles?: number; src?: { status?: string; itemCount?: number; service?: { state?: string } } } }

/** What production published, minute by minute, from the recorder's teaser.jsonl (the last line of a minute stands for it). */
export function publishedSeries(file: string, t0: number, n: number): NonNullable<SeriesFile['published']> {
  const out: NonNullable<SeriesFile['published']> = { vehicles: new Array(n).fill(null), itemCount: new Array(n).fill(null), status: new Array(n).fill(null), service: new Array(n).fill(null) };
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let d: TeaserLine;
    try {
      d = JSON.parse(line) as TeaserLine;
    } catch {
      continue;
    }
    const at = d.ts ? stampSec(d.ts) : null;
    if (at === null || at < t0 || at >= t0 + n * 60) continue;
    const m = Math.floor((at - t0) / 60);
    const zet = d.zet;
    if (!zet) continue;
    out.vehicles[m] = Number.isInteger(zet.vehicles) ? zet.vehicles! : null;
    out.itemCount[m] = Number.isInteger(zet.src?.itemCount) ? zet.src!.itemCount! : null;
    out.status[m] = zet.status !== 'live' || !zet.src ? 'down' : zet.src.status === 'stale' ? 'stale' : 'live';
    const state = zet.src?.service?.state;
    out.service[m] = typeof state === 'string' && STATES.has(state) ? (state as SnimkaState) : null;
  }
  return out;
}

/** DHMZ's hourly observation at Zagreb-Maksimir: temperature and the weather in words, by Zagreb hour. */
export function dhmzHourly(dir: string, t0: number, hours: number): { tempC: Col<number>; weather: Col<string> } {
  const tempC: Col<number> = new Array(hours).fill(null);
  const weather: Col<string> = new Array(hours).fill(null);
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.xml')).sort()) {
    const xml = readFileSync(join(dir, name), 'utf8');
    const date = /<Datum>\s*(\d{2})\.(\d{2})\.(\d{4})\s*<\/Datum>/.exec(xml);
    const term = /<Termin>\s*(\d{1,2})\s*<\/Termin>/.exec(xml);
    const city = /<GradIme>\s*Zagreb-Maksimir\s*<\/GradIme>([\s\S]*?)<\/Grad>/.exec(xml);
    if (!date || !term || !city) continue;
    const local = Date.UTC(+date[3], +date[2] - 1, +date[1], +term[1]) / 1000;
    const h = Math.floor((local - ZAGREB_OFFSET_S - t0) / 3600);
    if (h < 0 || h >= hours) continue;
    const temp = /<Temp>\s*(-?\d+(?:\.\d+)?)\s*<\/Temp>/.exec(city[1]);
    const words = /<Vrijeme>\s*([^<]*?)\s*<\/Vrijeme>/.exec(city[1]);
    if (temp) tempC[h] = Number(temp[1]);
    if (words && words[1] && words[1] !== '-') weather[h] = words[1];
  }
  return { tempC, weather };
}


async function buildSeries(paths: Paths, key: SegmentKey): Promise<SeriesFile> {
  const minutes = readWork<MinutesWork>(paths, `minutes-${key}.json`);
  const expect = await loadSegmentExpect(paths, key);
  const { t0, n } = minutes;
  const expected: SeriesFile['expected'] = { all: new Array(n).fill(null), tram: new Array(n).fill(null), bus: new Array(n).fill(null) };
  for (let m = 0; m < n; m++) {
    const e = expectationAt(expect, t0 + m * 60);
    if (!e.known) continue;
    expected.all[m] = e.blocks.all;
    expected.tram[m] = e.blocks.tram;
    expected.bus[m] = e.blocks.bus;
  }
  const hours = n / 60;
  if (key !== 'window') {
    return {
      v: 2, t0, step: 60, n,
      seen: minutes.seen, expected, service: minutes.service, feed: minutes.feed,
      published: null, bikes: null, closures: null,
      // DHMZ was recorded from 27 Sep: a comparison day's hours stay null unless a copy exists.
      hourly: { t0, n: hours, ...dhmzHourly(join(paths.inputs, 'strike', 'context', 'dhmz-now'), t0, hours), newsPulse: null },
    };
  }
  const bikes = readWork<BikesMinutes>(paths, 'bikes-minutes.json');
  const closures = readWork<ClosuresMinutes>(paths, 'closures-minutes.json');
  const pulse = readWork<{ t0: number; n: number; pulse: number[] }>(paths, 'news-pulse.json');
  if (bikes.t0 !== t0 || bikes.n !== n || closures.t0 !== t0 || closures.n !== n || pulse.t0 !== t0 || pulse.n !== hours) throw new Error('series: the window of an upstream stage differs; rerun bajs, closures and news');
  return {
    v: 2, t0, step: 60, n,
    seen: minutes.seen, expected, service: minutes.service, feed: minutes.feed,
    published: publishedSeries(join(paths.inputs, 'strike', 'teaser.jsonl'), t0, n),
    bikes: { total: bikes.total, empty: bikes.empty, reporting: bikes.reporting },
    closures: { active: closures.active, version: closures.version },
    hourly: { t0, n: hours, ...dhmzHourly(join(paths.inputs, 'strike', 'context', 'dhmz-now'), t0, hours), newsPulse: pulse.pulse },
  };
}

export async function stageSeries(paths: Paths, log: (line: string) => void): Promise<boolean> {
  const window = await buildSeries(paths, 'window');
  const live = window.published!.service.findIndex((s) => s !== null);
  if (live < 0) throw new Error('series: no minute of the window carries a published service state');
  const serviceLiveFromSec = SNIMKA_WINDOW.fromSec + live * 60;
  const series = writeJsonObject(paths, 'series/window', window);
  writeWork(paths, 'series-window.json', window);
  const comparisons: Record<string, HashedRef> = {};
  const known = (col: Col<unknown>): number => col.filter((x) => x !== null).length;
  const dayLines: string[] = [];
  for (const key of DAY_KEYS) {
    const day = await buildSeries(paths, key);
    comparisons[COMPARISON_OF[key].id] = writeJsonObject(paths, `series/${key}`, day);
    writeWork(paths, `series-${key}.json`, day);
    dayLines.push(`${key} ${day.n} minutes (seen ${known(day.seen.all)})`);
  }
  writeWork(paths, 'series-refs.json', { series, comparisons, serviceLiveFromSec } satisfies SeriesRefs);
  log(`series: window ${window.n} minutes (seen ${known(window.seen.all)}, expected ${known(window.expected.all)}, published ${known(window.published!.vehicles)}, bikes ${known(window.bikes!.total)}, closures ${known(window.closures!.active)}, temperature ${known(window.hourly.tempC)} of ${window.hourly.n} hours, frozen ${window.feed.frozen.filter((x) => x === 1).length} minutes); ${dayLines.join('; ')}; service published from ${new Date(serviceLiveFromSec * 1000).toISOString()}`);
  return true;
}
