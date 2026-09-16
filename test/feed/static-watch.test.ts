import { describe, expect, it, vi } from 'vitest';
import {
  STATIC_GTFS_URL,
  WATCH_INTERVAL_MS,
  judgeStaticFeed,
  watchStaticFeed,
  type StaticWatchDeps,
  type WatchOutcome,
} from '../../worker/feed/static-watch';

// A7 (R-TE18): the twin joins realtime trip ids against a static GTFS cut at
// build time. When ZET publishes a new static feed the join goes dark trip by
// trip; the hourly HEAD compares the feed's Last-Modified with the build time
// of the artefacts and counts what it finds, so /stats shows drift the day it
// happens and the runbook (rebuild, commit, push) is followed on purpose, not
// after a week of "smjer nepoznat".

const BUILT_AT = '2026-09-16T00:00:00.000Z';

describe('judgeStaticFeed', () => {
  it('reads a Last-Modified after the build as newer, at or before it as current', () => {
    expect(judgeStaticFeed('Wed, 16 Sep 2026 08:50:29 GMT', BUILT_AT)).toBe('newer');
    expect(judgeStaticFeed('Tue, 01 Sep 2026 08:50:29 GMT', BUILT_AT)).toBe('current');
    expect(judgeStaticFeed('Wed, 16 Sep 2026 00:00:00 GMT', BUILT_AT)).toBe('current');
  });
  it('says unknown when the header is missing or unparsable, never guesses', () => {
    expect(judgeStaticFeed(null, BUILT_AT)).toBe('unknown');
    expect(judgeStaticFeed('yesterday-ish', BUILT_AT)).toBe('unknown');
  });
});

function deps(over: Partial<StaticWatchDeps> & { lastChecked?: number | null; lastModified?: string | null }): StaticWatchDeps & { recorded: WatchOutcome[]; saved: string[]; heads: string[] } {
  const recorded: WatchOutcome[] = [];
  const saved: string[] = [];
  const heads: string[] = [];
  const nowMs = Date.parse('2026-09-16T12:00:00.000Z');
  return {
    recorded,
    saved,
    heads,
    builtAt: BUILT_AT,
    now: () => nowMs,
    load: async () => (over.lastChecked === undefined || over.lastChecked === null ? null : String(over.lastChecked)),
    save: async (value) => {
      saved.push(value);
    },
    record: (outcome) => {
      recorded.push(outcome);
    },
    head: async (url) => {
      heads.push(url);
      return new Response(null, { status: 200, headers: over.lastModified === null || over.lastModified === undefined ? {} : { 'last-modified': over.lastModified } });
    },
    ...over,
  };
}

describe('watchStaticFeed', () => {
  it('is a no-op within an hour of the last check', async () => {
    const d = deps({ lastChecked: Date.parse('2026-09-16T11:30:00.000Z') });
    await expect(watchStaticFeed(d)).resolves.toBe('skipped');
    expect(d.heads).toEqual([]);
    expect(d.recorded).toEqual([]);
    expect(d.saved).toEqual([]);
  });

  it('HEADs the static feed once the hour is up, records the verdict and remembers the check', async () => {
    const d = deps({ lastChecked: Date.parse('2026-09-16T10:59:59.000Z'), lastModified: 'Wed, 16 Sep 2026 08:50:29 GMT' });
    await expect(watchStaticFeed(d)).resolves.toBe('newer');
    expect(d.heads).toEqual([STATIC_GTFS_URL]);
    expect(d.recorded).toEqual(['newer']);
    expect(d.saved).toEqual([String(Date.parse('2026-09-16T12:00:00.000Z'))]);
  });

  it('runs on the very first cron with nothing remembered', async () => {
    const d = deps({ lastChecked: null, lastModified: 'Tue, 01 Sep 2026 08:50:29 GMT' });
    await expect(watchStaticFeed(d)).resolves.toBe('current');
    expect(d.recorded).toEqual(['current']);
  });

  it('records an error and still remembers the check when the HEAD fails, so a dead host is asked hourly, not every five minutes', async () => {
    const d = deps({ lastChecked: null, head: vi.fn(async () => { throw new Error('upstream 503'); }) });
    await expect(watchStaticFeed(d)).resolves.toBe('error');
    expect(d.recorded).toEqual(['error']);
    expect(d.saved).toHaveLength(1);
  });

  it('keeps the interval at one hour', () => {
    expect(WATCH_INTERVAL_MS).toBe(60 * 60 * 1000);
  });
});
