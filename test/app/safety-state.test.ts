import { describe, expect, it } from 'vitest';
import type { FeedItem, ModuleSnapshot } from '../../worker/feed/schema';
import { safetyState } from '../../app/src/experience/safety-state';
import { unconfirmed, unusable } from '../../app/src/experience/status';

const NOW = Date.parse('2026-09-11T12:32:00Z');
const attr = { text: 'Izvor', url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' };
const snap = (module: ModuleSnapshot['module'], items: FeedItem[], status: ModuleSnapshot['status'] = 'live', fetchedAt = new Date(NOW - 60_000).toISOString()): ModuleSnapshot =>
  ({ module, tier: 'open', status, fetchedAt, attribution: attr, items });
const expiredWarning: FeedItem = { id: 'w1', module: 'dhmz-cap', kind: 'warning', tier: 'open', title: 'Vjetar', severity: 'severe', at: '2026-09-10T06:00:00Z', until: '2026-09-10T18:00:00Z' };
const activeWarning: FeedItem = { ...expiredWarning, id: 'w2', at: '2026-09-11T06:00:00Z', until: '2026-09-11T18:00:00Z' };

describe('safetyState', () => {
  it('is calm only when every source is live, and confirms with the oldest fetch time', () => {
    const state = safetyState({ 'dhmz-cap': snap('dhmz-cap', []), emsc: snap('emsc', []), prometnice: snap('prometnice', [], 'live', new Date(NOW - 120_000).toISOString()) }, NOW);
    expect(state.level).toBe('calm');
    expect(state.confirmedAt).toBe(new Date(NOW - 120_000).toISOString());
  });
  it('never claims calm from a stale snapshot whose only warning has since expired (Codex review regression)', () => {
    const stale = snap('dhmz-cap', [expiredWarning], 'stale', new Date(NOW - 6 * 3_600_000).toISOString());
    const state = safetyState({ 'dhmz-cap': stale, emsc: snap('emsc', []), prometnice: snap('prometnice', []) }, NOW);
    expect(state.level).toBe('unknown');
    expect(state.confirmedAt).toBeNull();
    expect(state.unknownSources).toEqual(['dhmz-cap']);
    // The last-good warning is still shown, as stale, never silently dropped.
    expect(state.warnings).toHaveLength(1);
    expect(state.activeWarnings).toHaveLength(0);
  });
  it('is unknown when any of the three sources is missing or down, whatever the others say', () => {
    expect(safetyState({ 'dhmz-cap': snap('dhmz-cap', []), emsc: snap('emsc', []) }, NOW).level).toBe('unknown');
    expect(safetyState({ 'dhmz-cap': snap('dhmz-cap', []), emsc: snap('emsc', [], 'down'), prometnice: snap('prometnice', []) }, NOW).level).toBe('unknown');
  });
  it('is urgent on an active moderate-or-worse warning even while another source is unknown', () => {
    const state = safetyState({ 'dhmz-cap': snap('dhmz-cap', [activeWarning]) }, NOW);
    expect(state.level).toBe('urgent');
    expect(state.activeWarnings.map((w) => w.id)).toEqual(['w2']);
  });
  it('keeps quakes to the 72 hour window and closures to the ones open now', () => {
    const quake = (id: string, hoursAgo: number): FeedItem => ({ id, module: 'emsc', kind: 'quake', tier: 'open', title: id, at: new Date(NOW - hoursAgo * 3_600_000).toISOString(), data: { mag: 2 } });
    const closure = (id: string, until?: string): FeedItem => ({ id, module: 'prometnice', kind: 'closure', tier: 'open', title: id, at: '2026-09-01T00:00:00Z', ...(until ? { until } : {}) });
    const state = safetyState({ 'dhmz-cap': snap('dhmz-cap', []), emsc: snap('emsc', [quake('a', 1), quake('b', 80)]), prometnice: snap('prometnice', [closure('open'), closure('ended', '2026-09-10T00:00:00Z'), closure('later', '2026-09-30T00:00:00Z')]) }, NOW);
    expect(state.quakes72h.map((q) => q.id)).toEqual(['a']);
    expect(state.activeClosures.map((c) => c.id)).toEqual(['open', 'later']);
  });
});

describe('unconfirmed and unusable', () => {
  it('treats anything but live as unable to confirm an absence, while stale values stay usable', () => {
    const live = snap('dhmz-cap', [activeWarning]);
    const stale = snap('dhmz-cap', [activeWarning], 'stale');
    expect(unconfirmed(undefined)).toBe(true);
    expect(unconfirmed(live)).toBe(false);
    expect(unconfirmed(stale)).toBe(true);
    expect(unusable(stale)).toBe(false);
    expect(unusable(snap('dhmz-cap', [], 'down'))).toBe(true);
  });
});
