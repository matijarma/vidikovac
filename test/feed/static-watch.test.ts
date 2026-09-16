import { describe, expect, it } from 'vitest';
import { STATIC_GTFS_URL, judgeStaticFeed, watchStaticFeed, type StaticWatchDeps, type WatchOutcome } from '../../worker/feed/static-watch';

// R-TE18: the hourly HEAD of ZET's static GTFS against the artefacts' build
// time, so drift shows on /stats the day it happens.
const BUILT_AT = '2026-09-16T00:00:00.000Z';

function deps(over: Partial<StaticWatchDeps> & { lastChecked?: number | null; lastModified?: string | null }): StaticWatchDeps & { recorded: WatchOutcome[]; saved: string[]; heads: string[] } {
  const recorded: WatchOutcome[] = [];
  const saved: string[] = [];
  const heads: string[] = [];
  return {
    recorded,
    saved,
    heads,
    builtAt: BUILT_AT,
    now: () => Date.parse('2026-09-16T12:00:00.000Z'),
    load: async () => (over.lastChecked == null ? null : String(over.lastChecked)),
    save: async (value) => { saved.push(value); },
    record: (outcome) => { recorded.push(outcome); },
    head: async (url) => {
      heads.push(url);
      return new Response(null, { status: 200, headers: over.lastModified == null ? {} : { 'last-modified': over.lastModified } });
    },
    ...over,
  };
}

describe('the static-feed watch', () => {
  it('judges Last-Modified against the build time and never guesses from a missing or garbled header', () => {
    expect(judgeStaticFeed('Wed, 16 Sep 2026 08:50:29 GMT', BUILT_AT)).toBe('newer');
    expect(judgeStaticFeed('Tue, 01 Sep 2026 08:50:29 GMT', BUILT_AT)).toBe('current');
    expect(judgeStaticFeed('Wed, 16 Sep 2026 00:00:00 GMT', BUILT_AT)).toBe('current');
    expect(judgeStaticFeed(null, BUILT_AT)).toBe('unknown');
    expect(judgeStaticFeed('yesterday-ish', BUILT_AT)).toBe('unknown');
  });

  it('runs at most hourly, remembers the check before asking (so a dead host is asked hourly, not every five minutes), and records the verdict', async () => {
    const recent = deps({ lastChecked: Date.parse('2026-09-16T11:30:00.000Z') });
    await expect(watchStaticFeed(recent)).resolves.toBe('skipped');
    expect(recent.heads).toEqual([]);

    const due = deps({ lastChecked: Date.parse('2026-09-16T10:59:59.000Z'), lastModified: 'Wed, 16 Sep 2026 08:50:29 GMT' });
    await expect(watchStaticFeed(due)).resolves.toBe('newer');
    expect(due.heads).toEqual([STATIC_GTFS_URL]);
    expect(due.recorded).toEqual(['newer']);
    expect(due.saved).toEqual([String(Date.parse('2026-09-16T12:00:00.000Z'))]);

    const first = deps({ lastChecked: null, lastModified: 'Tue, 01 Sep 2026 08:50:29 GMT' });
    await expect(watchStaticFeed(first)).resolves.toBe('current');

    const failing = deps({ lastChecked: null, head: async () => { throw new Error('upstream 503'); } });
    await expect(watchStaticFeed(failing)).resolves.toBe('error');
    expect(failing.recorded).toEqual(['error']);
    expect(failing.saved).toHaveLength(1);
  });
});
