// The reveal scheduler (shared/kiosk/takt.ts, reveal pass R2; docs/reveal-2026-10-plan/R2.md §0.2 is the rule text):
// the beat grid, page 1 by the static value, the quiet rule, the advance and page-turn cadences with their lead,
// row and imminence rules, the gap, freshness on page 2 only, the history and determinism; then the fixture day
// (test/fixtures/takt/day-2026-09-30.json) replayed through the real candidate builder into the committed beat log.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADVANCE_EVERY_BEATS, ADVANCE_LEAD_MS, beatIndex, candidateValue, EMPTY_HISTORY, FRESH_AFTER_MS, FRESH_MS, PAGE_EVERY_BEATS, PAGE_MAX_ROWS,
  REVEAL_EXEMPT_KINDS, REVEAL_GAP_BEATS, REVEAL_IMMINENT_MS, SOON_MS, takt, type TaktCandidate, type TaktHistory, type TaktKind, type TaktOptions,
} from '../../shared/kiosk/takt';
import { groupDepartures, taktCandidates } from '../../app/src/kiosk/timeline';
import type { NearbyRow } from '../../app/src/city/nearby';
import { sunTimes } from '../../app/src/ui/solar';

const MIN = 60_000;
const RHYTHM = 20_000;
/** Wednesday 30 September 2026, 12:00 Zagreb (CEST), moved onto a beat with b % 12 === 0 so both cadences are eligible. */
const B0 = Math.floor(Date.parse('2026-09-30T12:00:00+02:00') / RHYTHM / 12) * 12;
const at = (b: number): number => b * RHYTHM;
const NOW = at(B0);

function c(id: string, kind: TaktKind, over: { at?: number; until?: number; reserved?: boolean; imminent?: boolean } = {}): TaktCandidate {
  return {
    id, kind,
    ...(over.at !== undefined ? { atMs: over.at } : {}),
    ...(over.until !== undefined ? { untilMs: over.until } : {}),
    reserved: over.reserved ?? false,
    imminent: over.imminent ?? (over.at !== undefined && over.at - NOW <= REVEAL_IMMINENT_MS),
  };
}
const options = (over: Partial<TaktOptions> = {}): TaktOptions => ({ capacity: 7, rhythmMs: RHYTHM, quiet: false, reduced: false, ...over });

/** A midday wall: the line, the notice, the trams' promises, one timeless row, and the discretionary rows by value. */
function wall(now = NOW): TaktCandidate[] {
  return [
    c('departures', 'departures', { at: now + 5 * MIN, reserved: true }),
    c('notice:zet:1', 'notice', { reserved: true }),
    c('closure:ilica', 'closure', { until: now + 4 * 3_600_000 }),
    c('rail:hz:1215', 'rail', { at: now + 20 * MIN }),
    c('event:a', 'event', { at: now + 3 * 3_600_000 }),
    c('event:b', 'event', { at: now + 60 * MIN }),
    c('opening:m', 'opening', { at: now + 3 * 3_600_000 }),
    c('solar:sunset:2026-09-30', 'solar', { at: now + 5 * 3_600_000 }),
    c('opennow:p', 'open', { until: now + 2 * 3_600_000 }),
    c('first:2026-10-01', 'first', { at: now + 16 * 3_600_000, reserved: true }),
    c('last:2026-09-30', 'last', { at: now + 12 * 3_600_000, reserved: true }),
    c('always:heritage:x', 'always', { reserved: true }),
    c('always:story:y', 'always'),
  ];
}
const nexts = (now = NOW): TaktCandidate[] => [1, 2, 3].map((n) => c(`dep:n${n}`, 'next-departures', { at: now + (5 + 4 * n) * MIN }));
const still = (x: TaktCandidate, now = NOW): number => candidateValue(x, now, null);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

describe('beatIndex: the absolute grid of the epoch', () => {
  it('floors the instant onto the rhythm and returns -1 off the grid', () => {
    expect(beatIndex(20_000 * 7 + 19_999, 20_000)).toBe(7);
    expect(beatIndex(20_000 * 8, 20_000)).toBe(8);
    expect(beatIndex(20_000 * 8, 0)).toBe(-1);
    expect(beatIndex(20_000 * 8, -20_000)).toBe(-1);
    expect(beatIndex(20_000 * 8, Number.NaN)).toBe(-1);
    expect(beatIndex(Number.NaN, 20_000)).toBe(-1);
    expect(beatIndex(Number.POSITIVE_INFINITY, 20_000)).toBe(-1);
  });
  it('the constants are the brief §3 numbers, one number each', () => {
    expect([ADVANCE_EVERY_BEATS, PAGE_EVERY_BEATS, REVEAL_GAP_BEATS, PAGE_MAX_ROWS]).toEqual([4, 3, 3, 2]);
    expect(ADVANCE_LEAD_MS).toBe(600_000);
    expect(REVEAL_IMMINENT_MS).toBe(1_800_000);
    expect(REVEAL_IMMINENT_MS).toBe(SOON_MS);
    expect(FRESH_MS).toBe(600_000);
    expect(FRESH_MS).toBe(FRESH_AFTER_MS);
    expect(REVEAL_EXEMPT_KINDS).toEqual(['closure']);
  });
});

describe('page 1 by the static value', () => {
  it('F11: measured page 1 replaces the count approximation without inventing painted rows', () => {
    const rows = wall();
    const measuredPage1 = ['departures', 'notice:zet:1', 'solar:sunset:2026-09-30', 'closure:ilica', 'always:heritage:x'];
    const r = takt(rows, EMPTY_HISTORY, at(B0 + 3), options({ capacity: 5, measuredPage1 }));
    expect(r.page1).toEqual(rows.filter(c => measuredPage1.includes(c.id)).map(c => c.id));
    expect(r.reveal?.replaces).toEqual(['solar:sunset:2026-09-30']);
    expect(r.reveal?.ids).toEqual(['rail:hz:1215']);
    expect(r.reveal?.alternatives).toContain('event:b');
    expect(r.history.shownAt['first:2026-10-01']).toBeUndefined();
    expect(takt(rows, EMPTY_HISTORY, NOW, options({ measuredPage1: [] })).page1).toEqual([]);
  });
  it('F11: measured fallback candidates retain the repeat gate, protections and bounded value order', () => {
    const rows = wall();
    const measuredPage1 = ['departures', 'notice:zet:1', 'solar:sunset:2026-09-30', 'always:heritage:x'];
    const history = { ...EMPTY_HISTORY, shownAt: { 'rail:hz:1215': NOW } };
    const r = takt(rows, history, at(B0 + 3), options({ measuredPage1 }));
    const offered = [...r.reveal!.ids, ...r.reveal!.alternatives ?? []];
    expect(offered[0]).toBe('event:b');
    expect(offered).not.toContain('rail:hz:1215');
    expect(offered).not.toContain('closure:ilica');
    expect(offered).not.toContain('first:2026-10-01');
    expect(offered.length).toBeGreaterThan(2);
    expect(offered.length).toBeLessThanOrEqual(12);
  });
  it('holds every reserved candidate, then the most valuable of the rest, in candidate order', () => {
    const rows = wall();
    const { page1 } = takt(rows, EMPTY_HISTORY, NOW, options({ capacity: 7 }));
    const reserved = rows.filter((x) => x.reserved).map((x) => x.id);
    for (const id of reserved) expect(page1).toContain(id);
    const rest = rows.filter((x) => !x.reserved).sort((x, y) => still(y) - still(x) || rows.indexOf(x) - rows.indexOf(y));
    expect(rest.slice(0, 2).map((x) => x.id)).toEqual(['closure:ilica', 'rail:hz:1215']);
    expect(page1).toEqual(rows.filter((x) => x.reserved || x.id === 'closure:ilica' || x.id === 'rail:hz:1215').map((x) => x.id));
    expect(page1).toHaveLength(7);
  });
  it('breaks a value tie by candidate order', () => {
    const rows = [c('departures', 'departures', { at: NOW + 5 * MIN, reserved: true }), c('event:late', 'event', { at: NOW + 3 * 3_600_000 }), c('event:early', 'event', { at: NOW + 3 * 3_600_000 })];
    expect(still(rows[1]!)).toBe(still(rows[2]!));
    expect(takt(rows, EMPTY_HISTORY, NOW, options({ capacity: 2 })).page1).toEqual(['departures', 'event:late']);
    expect(takt([rows[0]!, rows[2]!, rows[1]!], EMPTY_HISTORY, NOW, options({ capacity: 2 })).page1).toEqual(['departures', 'event:early']);
  });
  it('a capacity under the reserved count gives the reserved only; a fractional or non-finite capacity floors to the rows', () => {
    const rows = wall();
    const reserved = rows.filter((x) => x.reserved).map((x) => x.id);
    expect(takt(rows, EMPTY_HISTORY, NOW, options({ capacity: 3 })).page1).toEqual(reserved);
    expect(takt(rows, EMPTY_HISTORY, NOW, options({ capacity: 0 })).page1).toEqual(reserved);
    expect(takt(rows, EMPTY_HISTORY, NOW, options({ capacity: 6.9 })).page1).toHaveLength(6);
    expect(takt(rows, EMPTY_HISTORY, NOW, options({ capacity: Number.NaN })).page1).toEqual(reserved);
  });
  it('never puts a next-departures candidate on page 1, whatever the capacity', () => {
    const rows = [...wall(), ...nexts()];
    const { page1 } = takt(rows, EMPTY_HISTORY, NOW, options({ capacity: 100 }));
    expect(page1).toHaveLength(wall().length);
    expect(page1.some((id) => id.startsWith('dep:n'))).toBe(false);
  });
  it('freshness never changes page 1: shown and unshown ids give the same page 1 as an empty history', () => {
    const rows = wall();
    const history: TaktHistory = { beat: B0 - 1, shownAt: { 'closure:ilica': NOW, 'rail:hz:1215': NOW, 'event:b': NOW - 11 * MIN }, lastReveal: null };
    expect(takt(rows, history, NOW, options()).page1).toEqual(takt(rows, EMPTY_HISTORY, NOW, options()).page1);
  });
});

describe('quiet', () => {
  it('returns page 1 and no reveal, keeps the beat and the last reveal, and still records page 1 as shown', () => {
    const rows = [...wall().map((x) => (x.id === 'departures' ? c('departures', 'departures', { at: NOW + 30 * MIN, reserved: true }) : x)), ...nexts()];
    const last = { kind: 'page' as const, beat: B0 - 10 };
    for (const b of [B0 + 3, B0 + 4]) {
      const loud = takt(rows, { ...EMPTY_HISTORY, lastReveal: last }, at(b), options({ capacity: 9, quiet: false }));
      expect(loud.reveal?.kind).toBe(b === B0 + 3 ? 'page' : 'advance');
      const quiet = takt(rows, { ...EMPTY_HISTORY, lastReveal: last }, at(b), options({ capacity: 9, quiet: true }));
      expect(quiet.reveal).toBeNull();
      expect(quiet.page1).toEqual(loud.page1);
      expect(quiet.history.beat).toBe(b);
      expect(quiet.history.lastReveal).toEqual(last);
      for (const id of quiet.page1) expect(quiet.history.shownAt[id]).toBe(at(b));
    }
  });
});

describe('the advance: one beat in four, only while the first shown departure is more than 10 min away', () => {
  const lineAt = (lead: number, now: number): TaktCandidate[] => [
    ...wall(now).map((x) => (x.id === 'departures' ? c('departures', 'departures', { at: now + lead, reserved: true }) : x)),
    ...nexts(now),
  ];
  it('advances on b % 4 === 0 with the three next ids in order, replacing the line', () => {
    const now = at(B0 + 4);
    const r = takt(lineAt(ADVANCE_LEAD_MS + 1, now), EMPTY_HISTORY, now, options());
    expect(r.reveal).toEqual({ kind: 'advance', ids: ['dep:n1', 'dep:n2', 'dep:n3'], replaces: ['departures'], beat: B0 + 4 });
    expect(r.history.lastReveal).toEqual({ kind: 'advance', beat: B0 + 4 });
  });
  it('does not advance at exactly 10 min, off its beat, or without next departures', () => {
    const now = at(B0 + 4);
    expect(takt(lineAt(ADVANCE_LEAD_MS, now), EMPTY_HISTORY, now, options()).reveal).toBeNull();
    const off = at(B0 + 5);
    expect(takt(lineAt(ADVANCE_LEAD_MS + 1, off), EMPTY_HISTORY, off, options()).reveal).toBeNull();
    expect(takt(lineAt(ADVANCE_LEAD_MS + 1, now).filter((x) => x.kind !== 'next-departures'), EMPTY_HISTORY, now, options()).reveal).toBeNull();
  });
  it('wins over a page turn on b % 12 === 0, and at exactly 10 min the page turn takes that beat', () => {
    const rows = lineAt(ADVANCE_LEAD_MS + 1, NOW);
    expect(takt(rows, EMPTY_HISTORY, NOW, options({ capacity: 9 })).reveal?.kind).toBe('advance');
    expect(takt(lineAt(ADVANCE_LEAD_MS, NOW), EMPTY_HISTORY, NOW, options({ capacity: 9 })).reveal?.kind).toBe('page');
  });
});

describe('the page turn: one beat in three, at most two rows, never a reserved, imminent or closure row', () => {
  const B3 = B0 + 3;
  it('replaces the two lowest-value non-reserved page-1 rows, lowest first, with the top two of page 2 by freshness', () => {
    const rows = wall();
    const r = takt(rows, EMPTY_HISTORY, at(B3), options({ capacity: 9 }));
    // Page 1: the 5 reserved plus closure 72, rail 60, event:b 57.6 (0.8 within 2 h), event:a and opening at 0.5: 36, 18 → the first four by value.
    expect(r.page1).toEqual(['departures', 'notice:zet:1', 'closure:ilica', 'rail:hz:1215', 'event:a', 'event:b', 'first:2026-10-01', 'last:2026-09-30', 'always:heritage:x']);
    // Replaceable on page 1: event:a (36) and event:b (57.6); the rail is imminent, the closure exempt, the rest reserved.
    expect(r.reveal).toEqual({ kind: 'page', ids: ['opennow:p', 'opening:m'], replaces: ['event:a', 'event:b'], beat: B3 });
  });
  it('never puts an imminent row in replaces, even when it is the lowest', () => {
    const rows = wall().map((x) => (x.id === 'event:a' ? { ...x, imminent: true } : x));
    const r = takt(rows, EMPTY_HISTORY, at(B3), options({ capacity: 9 }));
    expect(r.reveal?.replaces).toEqual(['event:b']);
    expect(r.reveal?.ids).toEqual(['opennow:p']);
  });
  it('never replaces a reserved row (the line, the notice, first, last, the first timeless) nor a closure, and never reveals a closure', () => {
    // Rain within the hour (70 × 1 × 1.2 = 84) outranks both closures (72 each); capacity 7 leaves the second closure on page 2.
    const rows = [...wall(), c('closure:gunduliceva', 'closure', { until: NOW + 6 * 3_600_000 }), c('rain:dhmz:1240', 'rain', { at: NOW + 40 * MIN })];
    const r = takt(rows, EMPTY_HISTORY, at(B3), options({ capacity: 7 }));
    expect(r.page1).toContain('closure:ilica');
    expect(r.page1).toContain('rain:dhmz:1240');
    expect(r.page1).not.toContain('closure:gunduliceva');
    const reveal = r.reveal!;
    expect(reveal.kind).toBe('page');
    expect(reveal.replaces).toEqual(['rain:dhmz:1240']);
    expect(reveal.ids).toEqual(['rail:hz:1215']);
    for (const id of ['departures', 'notice:zet:1', 'first:2026-10-01', 'last:2026-09-30', 'always:heritage:x', 'closure:ilica']) expect(reveal.replaces).not.toContain(id);
    expect(reveal.ids).not.toContain('closure:gunduliceva');
    expect(reveal.replaces.length).toBeLessThanOrEqual(PAGE_MAX_ROWS);
  });
  it('ranks page 2 by candidateValue with the history, replaces one row for one page-2 candidate, and none without one', () => {
    const rows = wall();
    const history: TaktHistory = { beat: B3 - 1, shownAt: { 'opennow:p': NOW }, lastReveal: null };
    const r = takt(rows, history, at(B3), options({ capacity: 9 }));
    // opennow:p shown now waits (the repeat gate): the two rows go to the unseen by value, opening:m 18 and the sunset 12.
    expect(r.reveal?.ids).toEqual(['opening:m', 'solar:sunset:2026-09-30']);
    // Nothing seen: the value decides, opennow:p 36 and opening:m 18.
    expect(takt(rows, EMPTY_HISTORY, at(B3), options({ capacity: 9 })).reveal?.ids).toEqual(['opennow:p', 'opening:m']);
    // Every page-2 row seen within ten minutes: the page waits (no reveal) while page 2 holds more than one row.
    const allSeen: TaktHistory = { beat: B3 - 1, shownAt: { 'opennow:p': NOW - 2 * MIN, 'opening:m': NOW - 4 * MIN, 'solar:sunset:2026-09-30': NOW - 3 * MIN, 'always:story:y': NOW - 3 * MIN }, lastReveal: null };
    expect(takt(rows, allSeen, at(B3), options({ capacity: 9 })).reveal).toBeNull();
    const one = takt(rows.filter((x) => x.id !== 'opening:m' && x.id !== 'solar:sunset:2026-09-30' && x.id !== 'always:story:y'), EMPTY_HISTORY, at(B3), options({ capacity: 9 }));
    expect(one.reveal).toEqual({ kind: 'page', ids: ['opennow:p'], replaces: ['event:a'], beat: B3 });
    const none = takt(wall(), EMPTY_HISTORY, at(B3), options({ capacity: 20 }));
    expect(none.reveal).toBeNull();
  });
  it('turns no page when no page-1 row may move, and none off its beat', () => {
    const reservedOnly = wall().filter((x) => x.reserved || x.kind === 'closure' || x.id === 'always:story:y');
    expect(takt(reservedOnly, EMPTY_HISTORY, at(B3), options({ capacity: 6 })).reveal).toBeNull();
    expect(takt(wall(), EMPTY_HISTORY, at(B0 + 1), options({ capacity: 9 })).reveal).toBeNull();
    expect(takt(wall(), EMPTY_HISTORY, at(B0 + 2), options({ capacity: 9 })).reveal).toBeNull();
  });
});

describe('the gap: nothing starts within REVEAL_GAP_BEATS of the last reveal', () => {
  it('a reveal on b gives none on b + 1 and b + 2 where the cadence allows, and may on b + 3', () => {
    const rows = [...wall().map((x) => (x.id === 'departures' ? c('departures', 'departures', { at: NOW + 30 * MIN, reserved: true }) : x)), ...nexts()];
    let history = takt(rows, EMPTY_HISTORY, at(B0), options({ capacity: 9 })).history;
    expect(history.lastReveal).toEqual({ kind: 'advance', beat: B0 });
    // B0 + 1: no cadence; B0 + 2: none; B0 + 3 is a page beat and the gap is met.
    for (const b of [B0 + 1, B0 + 2]) {
      const r = takt(rows, history, at(b), options({ capacity: 9 }));
      expect(r.reveal).toBeNull();
      history = r.history;
    }
    const third = takt(rows, history, at(B0 + 3), options({ capacity: 9 }));
    expect(third.reveal?.kind).toBe('page');
    // From a page turn on a beat with b % 3 === 0, b + 1 and b + 2 carry none even where b + 1 is an advance beat.
    let h2: TaktHistory = { ...EMPTY_HISTORY, lastReveal: { kind: 'page', beat: B0 + 3 } };
    expect(takt(rows, h2, at(B0 + 4), options({ capacity: 9 })).reveal).toBeNull();
    h2 = takt(rows, h2, at(B0 + 4), options({ capacity: 9 })).history;
    expect(takt(rows, h2, at(B0 + 5), options({ capacity: 9 })).reveal).toBeNull();
    expect(takt(rows, h2, at(B0 + 6), options({ capacity: 9 })).reveal).not.toBeNull();
    expect(takt(rows, { ...EMPTY_HISTORY, lastReveal: { kind: 'page', beat: B0 + 5 } }, at(B0 + 8), options({ capacity: 9 })).reveal?.kind).toBe('advance');
    expect(takt(rows, { ...EMPTY_HISTORY, lastReveal: { kind: 'page', beat: B0 + 6 } }, at(B0 + 8), options({ capacity: 9 })).reveal).toBeNull();
  });
  it('the cadence over twelve beats: advance at 0, page at 3, 6, 9, advance at 12', () => {
    // Page 2 holds six rows (the wall's four plus two events), so three page turns of two find rows the gate lets through.
    const rows = [...wall().map((x) => (x.id === 'departures' ? c('departures', 'departures', { at: NOW + 60 * MIN, reserved: true }) : x)),
      c('event:c', 'event', { at: NOW + 4 * 3_600_000 }), c('event:d', 'event', { at: NOW + 4 * 3_600_000 }), ...nexts()];
    let history = EMPTY_HISTORY;
    const beats: string[] = [];
    for (let b = B0; b <= B0 + 12; b++) {
      const r = takt(rows, history, at(b), options({ capacity: 9 }));
      if (r.reveal) beats.push(`${b - B0}:${r.reveal.kind}`);
      history = r.history;
    }
    expect(beats).toEqual(['0:advance', '3:page', '6:page', '9:page', '12:advance']);
  });
});

describe('freshness ranks page 2 only', () => {
  const B3 = B0 + 3;
  it('the repeat gate: a page-2 row seen in the last 10 min waits while page 2 holds one that was not, whatever the values', () => {
    // A cut within two hours (70 × 0.8 × 1.2 = 67.2) fills page 1 beside the line and may move; page 2 holds two trains and an opening.
    const rows = [
      c('departures', 'departures', { at: NOW + 5 * MIN, reserved: true }),
      c('cut:filler', 'cut', { at: NOW + 60 * MIN, until: NOW + 3 * 3_600_000 }),
      c('rail:soon', 'rail', { at: NOW + 20 * MIN }),
      c('rail:later', 'rail', { at: NOW + 50 * MIN }),
      c('opening:m', 'opening', { at: NOW + 3 * 3_600_000 }),
    ];
    let history: TaktHistory = { beat: B3 - 1, shownAt: {}, lastReveal: null };
    const turn = (b: number): string[] => {
      const r = takt(rows, history, at(b), options({ capacity: 2 }));
      expect(r.page1).toEqual(['departures', 'cut:filler']);
      history = r.history;
      return [...(r.reveal?.ids ?? [])];
    };
    // The train 20 min away (60 fresh) leads page 2; once seen it waits behind the later train (48 fresh) and the opening (18).
    expect(turn(B3)).toEqual(['rail:soon']);
    expect(turn(B3 + 3)).toEqual(['rail:later']);
    expect(turn(B3 + 6)).toEqual(['opening:m']);
    // Every page-2 row seen within ten minutes: the page waits.
    expect(turn(B3 + 9)).toEqual([]);
    expect(turn(B3 + 12)).toEqual([]);
    // Past the window the opening counts as unseen again and goes, whatever its value against the trains'.
    history = { ...history, shownAt: { ...history.shownAt, 'opening:m': at(B3 + 15) - FRESH_MS - 1 } };
    expect(turn(B3 + 15)).toEqual(['opening:m']);
    // A lone page-2 row is revealed on every eligible beat, seen or not.
    const lone = rows.filter((x) => x.id !== 'rail:later' && x.id !== 'opening:m');
    let h: TaktHistory = { beat: B3 - 1, shownAt: {}, lastReveal: null };
    for (const b of [B3, B3 + 3, B3 + 6]) {
      const r = takt(lone, h, at(b), options({ capacity: 2 }));
      expect(r.reveal?.ids, String(b - B3)).toEqual(['rail:soon']);
      h = r.history;
    }
  });
  const base = (): TaktCandidate[] => [
    c('departures', 'departures', { at: NOW + 5 * MIN, reserved: true }),
    c('event:shown', 'event', { at: NOW + 3 * 3_600_000 }),
    c('event:new', 'event', { at: NOW + 3 * 3_600_000 }),
    c('solar:s', 'solar', { at: NOW + 5 * 3_600_000 }),
  ];
  it('between two page-2 rows of equal static value the one shown 5 min ago loses to the one never shown', () => {
    const rows = base();
    const history: TaktHistory = { beat: B3 - 1, shownAt: { 'event:shown': NOW - 5 * MIN }, lastReveal: null };
    const r = takt(rows, history, at(B3), options({ capacity: 2 }));
    expect(r.page1).toEqual(['departures', 'event:shown']);
    expect(r.reveal?.ids).toEqual(['event:new']);
    // Capacity 2 keeps event:shown on page 1 by candidate order; make the solar row the page-1 filler instead.
    const rows2 = [rows[0]!, rows[3]!, rows[1]!, rows[2]!].map((x) => (x.id === 'solar:s' ? { ...x, reserved: true } : x));
    const r2 = takt(rows2, history, at(B3), options({ capacity: 2 }));
    expect(r2.page1).toEqual(['departures', 'solar:s']);
    expect(r2.reveal).toBeNull();
  });
  it('an equal-value pair both shown over 10 min ago reads ×1.2 alike and candidate order decides; the boundary is R0\'s', () => {
    const rows = [c('departures', 'departures', { at: NOW + 5 * MIN, reserved: true }), c('event:x', 'event', { at: NOW + 3 * 3_600_000 }),
      c('event:p', 'event', { at: NOW + 3 * 3_600_000 }), c('event:q', 'event', { at: NOW + 3 * 3_600_000 })];
    const T3 = at(B3);
    const old: TaktHistory = { beat: B3 - 1, shownAt: { 'event:p': T3 - 600_001, 'event:q': T3 - 600_001 }, lastReveal: null };
    expect(takt(rows, old, T3, options({ capacity: 2 })).reveal?.ids).toEqual(['event:p']);
    const swapped = [rows[0]!, rows[1]!, rows[3]!, rows[2]!];
    expect(takt(swapped, old, T3, options({ capacity: 2 })).reveal?.ids).toEqual(['event:q']);
    const pFresh: TaktHistory = { beat: B3 - 1, shownAt: { 'event:p': T3 - 599_999, 'event:q': T3 - 600_001 }, lastReveal: null };
    expect(takt(rows, pFresh, T3, options({ capacity: 2 })).reveal?.ids).toEqual(['event:q']);
    expect(candidateValue(rows[2]!, T3, pFresh)).toBe(candidateValue(rows[2]!, T3, null) / 1.2);
    expect(candidateValue(rows[3]!, T3, pFresh)).toBe(candidateValue(rows[3]!, T3, null));
    const edge: TaktHistory = { beat: B3 - 1, shownAt: { 'event:p': T3 - 600_000 }, lastReveal: null };
    expect(candidateValue(rows[2]!, T3, edge)).toBe(candidateValue(rows[2]!, T3, null) / 1.2);
  });
});

describe('the history', () => {
  it('records every page-1 and revealed id at now, prunes stale and future entries, sorts the keys, and never mutates its inputs', () => {
    const rows = deepFreeze([...wall(), ...nexts()]);
    const T3 = at(B0 + 3);
    const history = deepFreeze<TaktHistory>({ beat: B0 - 7, shownAt: { 'zzz:old': T3 - FRESH_MS - 1, 'aaa:kept': T3 - FRESH_MS, 'mmm:future': T3 + 1 }, lastReveal: { kind: 'page', beat: B0 - 7 } });
    const r = takt(rows, history, T3, options({ capacity: 9 }));
    expect(r.reveal?.kind).toBe('page');
    const keys = Object.keys(r.history.shownAt);
    expect(keys).toEqual([...keys].sort());
    expect(r.history.shownAt['zzz:old']).toBeUndefined();
    expect(r.history.shownAt['mmm:future']).toBeUndefined();
    expect(r.history.shownAt['aaa:kept']).toBe(T3 - FRESH_MS);
    for (const id of [...r.page1, ...r.reveal!.ids]) expect(r.history.shownAt[id]).toBe(T3);
    expect(r.history.beat).toBe(B0 + 3);
    expect(r.history.lastReveal).toEqual({ kind: 'page', beat: B0 + 3 });
    expect(history).toEqual({ beat: B0 - 7, shownAt: { 'zzz:old': T3 - FRESH_MS - 1, 'aaa:kept': T3 - FRESH_MS, 'mmm:future': T3 + 1 }, lastReveal: { kind: 'page', beat: B0 - 7 } });
    const quiet = takt(rows, history, at(B0 + 1), options({ capacity: 9 }));
    expect(quiet.reveal).toBeNull();
    expect(quiet.history.lastReveal).toEqual({ kind: 'page', beat: B0 - 7 });
    expect(quiet.history).not.toBe(history);
  });
});

describe('determinism', () => {
  it('the same inputs twice give deep-equal results, and reduced changes nothing', () => {
    const rows = [...wall(), ...nexts()];
    const history: TaktHistory = { beat: B0 - 5, shownAt: { 'event:b': NOW - 3 * MIN }, lastReveal: { kind: 'page', beat: B0 - 5 } };
    const a = takt(rows, history, at(B0 + 3), options({ capacity: 8, reduced: false }));
    const b = takt(rows, history, at(B0 + 3), options({ capacity: 8, reduced: false }));
    expect(a).toStrictEqual(b);
    expect(takt(rows, history, at(B0 + 3), options({ capacity: 8, reduced: true }))).toStrictEqual(a);
    const adv = takt(rows.map((x) => (x.id === 'departures' ? c('departures', 'departures', { at: NOW + 30 * MIN, reserved: true }) : x)), EMPTY_HISTORY, at(B0 + 4), options({ capacity: 8, reduced: true }));
    expect(adv).toStrictEqual(takt(rows.map((x) => (x.id === 'departures' ? c('departures', 'departures', { at: NOW + 30 * MIN, reserved: true }) : x)), EMPTY_HISTORY, at(B0 + 4), options({ capacity: 8, reduced: false })));
  });
});

// --- The fixture day and the beat log (R2.md step 2) ---------------------------------------------------------------

interface FixtureItem { id: string; kind: TaktKind; at?: string; until?: string; offered?: [string, string]; always?: boolean; every?: [string, string, number]; offeredBefore?: number }
interface FixtureDay {
  date: string; place: string; utcOffset: string; from: string; to: string; rhythmMs: number;
  capacity: [string, number][]; headway: [string, number][]; departuresUntil: string;
  quiet: [string, string, string][]; items: FixtureItem[];
}
const DAY: FixtureDay = JSON.parse(readFileSync(join(__dirname, '../fixtures/takt/day-2026-09-30.json'), 'utf8'));
const ZAGREB_CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/** A Zagreb clock of the fixture day ("HH:MM", "HH:MM:SS", "+1 HH:MM" for tomorrow, "24:00:00" for midnight) as epoch ms. */
function zagreb(day: FixtureDay, text: string): number {
  const tomorrow = text.startsWith('+1 ');
  const clock = tomorrow ? text.slice(3) : text;
  const [h, m, s = 0] = clock.split(':').map(Number) as [number, number, number?];
  const base = Date.parse(`${day.date}T00:00:00${day.utcOffset}`);
  return base + ((tomorrow ? 24 : 0) + h) * 3_600_000 + m * 60_000 + (s ?? 0) * 1000;
}
const hhmm = (ms: number): string => ZAGREB_CLOCK.format(new Date(ms)).slice(0, 5).replace(':', '');

/** The timetable: each headway band from its own start, every `headway` minutes, until the next band's start or departuresUntil. */
function timetable(day: FixtureDay): number[] {
  const out: number[] = [];
  const end = zagreb(day, day.departuresUntil);
  day.headway.forEach(([start, minutes], i) => {
    const next = day.headway[i + 1];
    const until = next ? zagreb(day, next[0]) : end + 1;
    for (let t = zagreb(day, start); t < until && t <= end; t += minutes * 60_000) out.push(t);
  });
  return out;
}

/** The rows the wall would list at `t` (the departures first, then the items offered, by their moment, timeless last, ties by id). */
function rowsAt(day: FixtureDay, t: number): { rows: NearbyRow[]; next: NearbyRow[] } {
  const base = (id: string, kind: NearbyRow['kind'], atMs: number | null, always = false): NearbyRow =>
    ({ id, kind, atMs, always, title: id, sub: '', live: false, source: 'fixture' });
  const due = timetable(day).filter((at) => at > t);
  const departure = (at: number): NearbyRow => {
    const dayAfter = at >= zagreb(day, '24:00:00');
    const id = `dep:${dayAfter ? String(24 + Number(hhmm(at).slice(0, 2))).padStart(2, '0') + hhmm(at).slice(2) : hhmm(at)}`;
    return base(id, 'departure', at);
  };
  const cells = due.slice(0, 3).map(departure);
  const next = due.slice(3, 6).map(departure);
  const items: NearbyRow[] = [];
  for (const item of day.items) {
    if (item.every) {
      const [first, last, step] = item.every;
      for (let at = zagreb(day, first); at <= zagreb(day, last); at += step * 60_000) {
        if (t >= at - (item.offeredBefore ?? 0) * 60_000 && t < at) items.push(base(item.id.replace('<HHMM>', hhmm(at)), item.kind as NearbyRow['kind'], at));
      }
      continue;
    }
    const [from, to] = item.offered!;
    if (!(t >= zagreb(day, from) && t < zagreb(day, to))) continue;
    const row = base(item.id, item.kind as NearbyRow['kind'], item.always ? null : zagreb(day, item.at!), Boolean(item.always));
    if (item.until) row.untilMs = zagreb(day, item.until);
    items.push(row);
  }
  items.sort((a, b) => (a.atMs ?? Infinity) - (b.atMs ?? Infinity) || a.id.localeCompare(b.id));
  return { rows: [...cells, ...items], next };
}

interface BeatLine { t: string; b: number; page1?: readonly string[]; reveal?: { kind: string; ids: readonly string[]; replaces: readonly string[] }; quiet?: true }
interface BeatRecord { line: BeatLine | null; t: number; quiet: boolean; candidates: TaktCandidate[]; reveal: ReturnType<typeof takt>['reveal']; page1: readonly string[]; before: TaktHistory }

/** The day replayed beat by beat: the log lines, and every beat's record for the rule pins. */
function beatLog(day: FixtureDay, options: { reduced?: boolean } = {}): { lines: string[]; beats: BeatRecord[] } {
  const bandAt = <T>(bands: [string, T][], t: number): T => bands.filter(([start]) => zagreb(day, start) <= t).map(([, v]) => v).pop()!;
  const quietAt = (t: number): boolean => day.quiet.some(([from, to]) => t >= zagreb(day, from) && t < zagreb(day, to));
  let history: TaktHistory = EMPTY_HISTORY;
  let lastPage1 = '';
  let lastQuiet = false;
  const lines: string[] = [];
  const beats: BeatRecord[] = [];
  for (let t = zagreb(day, day.from); t < zagreb(day, day.to); t += day.rhythmMs) {
    const { rows, next } = rowsAt(day, t);
    const candidates = taktCandidates(groupDepartures(rows), next, t);
    const quiet = quietAt(t);
    const before = history;
    const result = takt(candidates, history, t, { capacity: bandAt(day.capacity, t), rhythmMs: day.rhythmMs, quiet, reduced: options.reduced ?? false });
    history = result.history;
    const line: BeatLine = { t: ZAGREB_CLOCK.format(new Date(t)), b: beatIndex(t, day.rhythmMs) };
    const page1 = result.page1.join('\u0001');
    if (page1 !== lastPage1 || lines.length === 0) { line.page1 = result.page1; lastPage1 = page1; }
    if (result.reveal) line.reveal = { kind: result.reveal.kind, ids: result.reveal.ids, replaces: result.reveal.replaces };
    if (quiet && !lastQuiet) line.quiet = true;
    lastQuiet = quiet;
    const written = line.page1 !== undefined || line.reveal !== undefined || line.quiet !== undefined;
    if (written) lines.push(JSON.stringify(line));
    beats.push({ line: written ? line : null, t, quiet, candidates, reveal: result.reveal, page1: result.page1, before });
  }
  return { lines, beats };
}

describe('taktCandidates over the fixture day', () => {
  it('reserves the line, the notice, the last tram and the first timeless row, never a rail or an event, and marks the imminent ones', () => {
    const t = zagreb(DAY, '21:30:00');
    const { rows, next } = rowsAt(DAY, t);
    const candidates = taktCandidates(groupDepartures(rows), next, t);
    const by = (id: string): TaktCandidate => candidates.find((c) => c.id === id)!;
    expect(by('departures')).toMatchObject({ kind: 'departures', reserved: true, imminent: true });
    expect(by('last:2026-09-30')).toMatchObject({ reserved: true, imminent: false });
    expect(by('always:heritage:heritage-9cae1bf25c9ce440')).toMatchObject({ reserved: true, imminent: false });
    expect(by('rail:fixture-hz-2145')).toMatchObject({ reserved: false, imminent: true });
    expect(by('rail:fixture-hz-2215')).toMatchObject({ reserved: false, imminent: false });
    expect(by('cut:fixture-hep-ods-2026-10-01')).toMatchObject({ reserved: false, imminent: false });
    expect(candidates.filter((c) => c.kind === 'next-departures').map((c) => c.id)).toEqual(['dep:2212', 'dep:2224', 'dep:2236']);
  });
  it('the sunset of the day is the solar module\'s, written as HH:MM', () => {
    const sunset = sunTimes(new Date(`${DAY.date}T12:00:00Z`)).sunset.getTime();
    expect(ZAGREB_CLOCK.format(new Date(sunset)).slice(0, 5)).toBe(DAY.items.find((i) => i.kind === 'solar')!.at);
  });
});

describe('the beat log of the fixture day', () => {
  const { lines, beats } = beatLog(DAY);
  const movable = (cand: TaktCandidate): boolean => !cand.reserved && cand.kind !== 'departure' && cand.kind !== 'departures' && !REVEAL_EXEMPT_KINDS.includes(cand.kind);
  it('equals the committed snapshot (regenerate with -u only with a reason in the commit body)', async () => {
    await expect(lines.join('\n') + '\n').toMatchFileSnapshot('../fixtures/takt/beat-log.jsonl');
  });
  it('obeys the rules, independent of the snapshot', () => {
    const reveals = beats.filter((x) => x.reveal);
    expect(reveals.length).toBeGreaterThan(0);
    // No reveal inside a quiet window; consecutive reveal beats at least REVEAL_GAP_BEATS apart.
    for (const x of reveals) expect(x.quiet, x.line!.t).toBe(false);
    for (let i = 1; i < reveals.length; i++) expect(reveals[i]!.reveal!.beat - reveals[i - 1]!.reveal!.beat, reveals[i]!.line!.t).toBeGreaterThanOrEqual(REVEAL_GAP_BEATS);
    for (const x of reveals) {
      const r = x.reveal!;
      expect(r.replaces.length, x.line!.t).toBeLessThanOrEqual(PAGE_MAX_ROWS);
      const by = new Map(x.candidates.map((c) => [c.id, c] as const));
      for (const id of r.replaces) {
        const c = by.get(id)!;
        if (r.kind === 'page') {
          expect(c.reserved, `${x.line!.t} ${id} reserved`).toBe(false);
          expect(c.imminent, `${x.line!.t} ${id} imminent`).toBe(false);
          expect(c.kind, `${x.line!.t} ${id} closure`).not.toBe('closure');
        }
      }
      for (const id of r.ids) expect(by.get(id)!.kind, `${x.line!.t} ${id}`).not.toBe('closure');
      if (r.kind === 'advance') {
        const line = by.get('departures')!;
        expect(line.atMs! - x.t, x.line!.t).toBeGreaterThan(ADVANCE_LEAD_MS);
        expect(x.line!.t >= '21:00:00', `${x.line!.t}: an advance before 21:00`).toBe(true);
      }
    }
    expect(reveals.some((x) => x.reveal!.kind === 'advance' && x.line!.t >= '21:00:00')).toBe(true);
    // Every beat where an advance was possible by the lead and the cadence (and not in the gap) carried one.
    for (const x of beats) {
      const line = x.candidates.find((c) => c.id === 'departures')!;
      const b = beatIndex(x.t, DAY.rhythmMs);
      const nextCount = x.candidates.filter((c) => c.kind === 'next-departures').length;
      const previous = beats.filter((y) => y.reveal && y.t < x.t).pop();
      const gap = !previous || b - previous.reveal!.beat >= REVEAL_GAP_BEATS;
      if (!x.quiet && gap && b % ADVANCE_EVERY_BEATS === 0 && line.atMs! - x.t > ADVANCE_LEAD_MS && nextCount > 0) expect(x.reveal?.kind, x.line?.t ?? String(x.t)).toBe('advance');
    }
    // Every page beat that could carry a page turn (not quiet, the gap met, no advance, a page-1 row that may move
    // and a page-2 row to show) carried one: the log is complete against the eligibility, not only within it.
    for (const x of beats) {
      const b = beatIndex(x.t, DAY.rhythmMs);
      const previous = beats.filter((y) => y.reveal && y.t < x.t).pop();
      const gap = !previous || b - previous.reveal!.beat >= REVEAL_GAP_BEATS;
      const page1 = new Set(x.page1);
      const out = x.candidates.some((cand) => page1.has(cand.id) && movable(cand) && !cand.imminent);
      const seenAt = (id: string): boolean => { const s = x.before.shownAt[id]; return s !== undefined && x.t - s <= FRESH_MS; };
      const page2All = x.candidates.filter((cand) => !page1.has(cand.id) && cand.kind !== 'next-departures' && movable(cand) && candidateValue(cand, x.t, null) > 0);
      const page2 = page2All.length > 1 ? page2All.some((cand) => !seenAt(cand.id)) : page2All.length === 1;
      if (!x.quiet && gap && b % PAGE_EVERY_BEATS === 0 && x.reveal?.kind !== 'advance' && out && page2) expect(x.reveal?.kind, x.line?.t ?? String(x.t)).toBe('page');
    }
    // The hours with a page turn on this day: from the rain step at 13:20 to the last train at 23:15. Before 13:20 the
    // wall's five rows beside the line are the notice and the heritage row (reserved), the two closures (exempt) and
    // the train within the hour (imminent from the moment it takes the row): no page-1 row may move, by the rules.
    const hours = new Set(reveals.filter((x) => x.reveal!.kind === 'page').map((x) => x.line!.t.slice(0, 2)));
    expect([...hours].sort()).toEqual(['13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23']);
    expect(beats.filter((x) => x.line?.t !== undefined && x.line.t < '13:20:00' && x.reveal)).toEqual([]);
    // The repeat gate: a page-2 row seen in the last ten minutes is revealed only as the lone page-2 row.
    for (const x of reveals.filter((y) => y.reveal!.kind === 'page')) {
      const page1 = new Set(x.page1);
      const page2 = x.candidates.filter((cand) => !page1.has(cand.id) && cand.kind !== 'next-departures' && movable(cand) && candidateValue(cand, x.t, x.before) > 0);
      for (const id of x.reveal!.ids) {
        const s = x.before.shownAt[id];
        if (s !== undefined && x.t - s <= FRESH_MS) expect(page2.map((cand) => cand.id), `${x.line!.t}: ${id} revealed again within ten minutes`).toEqual([id]);
      }
    }
    expect(lines.join('\n').length).toBeLessThanOrEqual(200 * 1024);
  });
  it('is deterministic over the day, and reduced changes nothing', () => {
    expect(beatLog(DAY).lines).toEqual(lines);
    expect(beatLog(DAY, { reduced: true }).lines).toEqual(lines);
  });
});
